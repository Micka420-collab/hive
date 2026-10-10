// LES ROUTINES D'UN PROJET — du travail planifié ou déclenché (ADR 0014).
//
// Une routine lance une mission ordinaire du projet sans qu'on clique : à une
// heure (cron, dans un fuseau), quand un webhook signé arrive, ou quand la CI
// de la branche principale devient rouge. Ce panneau les liste, en crée, les
// met en pause, et montre leurs derniers déclenchements.
//
// Trois choses que l'écran doit dire, parce qu'elles se perdraient sans bruit :
//
//   · CRÉER, c'est autoriser la dépense à l'avance : la routine part avec
//     l'autorité de qui l'a créée, et le formulaire le dit avant le clic ;
//   · chaque déclenchement a une issue, même quand rien ne part (fusionné,
//     sauté, manqué, hors heures, refusé) : la liste les montre toutes ;
//   · la clé d'un webhook ne s'affiche qu'UNE fois — à la création ou à la
//     régénération. Aucune relecture ne la rend.
//
// Rien ne part au montage : la lecture se demande, comme les missions.

import { useState } from 'react';
import {
  creerRoutine,
  declencherRoutine,
  fetchRoutines,
  regenererCleRoutine,
  reglerRoutine,
  supprimerRoutine,
} from '../api';
import type {
  ConcurrenceRoutine,
  DeclencheurRoutine,
  NouvelleRoutine,
  RattrapageRoutine,
  RoutineVue,
  RunRoutineVue,
} from '../api';
import { useT } from '../i18n';
import type { Project } from '../../../src/shared/types';

type Traduire = ReturnType<typeof useT>;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Le fuseau du navigateur : le défaut le plus probable pour « 9 h ». */
function fuseauLocal(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function direDeclencheur(r: RoutineVue, t: Traduire): string {
  if (r.declencheur === 'cron') return `⏱ ${r.expression ?? ''} · ${r.fuseau}`;
  if (r.declencheur === 'ci_rouge') {
    return t(`✖ CI rouge sur ${r.branche ?? 'main'}`, `✖ red CI on ${r.branche ?? 'main'}`);
  }
  return t('⇲ webhook signé', '⇲ signed webhook');
}

function direStatut(s: RunRoutineVue['statut'], t: Traduire): string {
  const libelles: Record<RunRoutineVue['statut'], string> = {
    lancee: t('lancée', 'started'),
    fusionnee: t('rejoint le travail en cours', 'joined running work'),
    sautee: t('sautée (travail en cours)', 'skipped (work running)'),
    manquee: t('manquée', 'missed'),
    ignoree: t('ignorée', 'ignored'),
    refusee: t('refusée', 'refused'),
  };
  return libelles[s];
}

const JOURS_OUVRES = [1, 2, 3, 4, 5];

/** Les statuts dont le libellé répète déjà le motif rangé par la Reine. */
const MOTIF_REDIT = new Set<RunRoutineVue['statut']>(['fusionnee', 'sautee']);

export function RoutinesProjet({ project }: { project: Project }) {
  const t = useT();
  const [routines, setRoutines] = useState<RoutineVue[] | null>(null);
  const [ciDisponible, setCiDisponible] = useState(true);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [formulaire, setFormulaire] = useState(false);
  const [cle, setCle] = useState<{ nom: string; url: string; secret: string } | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);

  const charger = () => {
    setChargement(true);
    setErreur(null);
    fetchRoutines(project.id)
      .then((r) => {
        setRoutines(r.routines);
        setCiDisponible(r.ciDisponible);
      })
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setChargement(false));
  };

  /** Un geste sur une routine, puis la liste relue : l'écran dit ce que le serveur a rangé. */
  const geste = (id: string, action: () => Promise<unknown>) => {
    setOccupe(id);
    setErreur(null);
    action()
      .then(charger)
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setOccupe(null));
  };

  return (
    <div className="pj-sub pj-routines" data-testid="routines-projet">
      <div className="pj-sub-head">
        <h4>{t('Routines', 'Routines')}</h4>
        <button className="btn ghost sm" onClick={charger} disabled={chargement}>
          {chargement
            ? t('lecture…', 'reading…')
            : routines
              ? t('relire', 'reload')
              : t('voir les routines', 'show routines')}
        </button>
        {routines && (
          <button
            className="btn ghost sm"
            onClick={() => setFormulaire(!formulaire)}
            aria-expanded={formulaire}
          >
            {t('Nouvelle routine…', 'New routine…')}
          </button>
        )}
      </div>

      {erreur && <p className="panel-error">{erreur}</p>}

      {cle && (
        <div className="pj-rejeu-form" role="status">
          <p className="pj-sub-note">
            {t(
              `Clé du webhook « ${cle.nom} » — copiez-la maintenant, elle ne sera plus affichée. Signez chaque envoi (x-hive-signature: t=<secondes>,v1=<HMAC-SHA256 de « t.corps »>).`,
              `Webhook key for “${cle.nom}” — copy it now, it will not be shown again. Sign each call (x-hive-signature: t=<seconds>,v1=<HMAC-SHA256 of “t.body”>).`,
            )}
          </p>
          <code className="mono">POST {cle.url}</code>
          <code className="mono">{cle.secret}</code>
          <div className="pj-rejeu-actions">
            <button className="btn ghost sm" onClick={() => setCle(null)}>
              {t('j’ai copié la clé', 'I copied the key')}
            </button>
          </div>
        </div>
      )}

      {formulaire && (
        <FormulaireRoutine
          projectId={project.id}
          ciDisponible={ciDisponible && project.repoUrl !== null}
          onAnnule={() => setFormulaire(false)}
          onCree={(r, secret) => {
            setFormulaire(false);
            if (secret && r.webhook) setCle({ nom: r.nom, url: r.webhook, secret });
            charger();
          }}
        />
      )}

      {routines && routines.length === 0 && !formulaire && (
        <p className="pj-sub-vide">
          {t(
            'Aucune routine : la ruche ne travaille que quand on le lui demande.',
            'No routine: the hive only works when asked.',
          )}
        </p>
      )}

      {routines && routines.length > 0 && (
        <ul className="pj-liv-liste pj-routines-liste">
          {routines.map((r) => (
            <li key={r.id} data-testid="routine">
              <span className={`pj-mission-etat ${r.actif ? 'vol' : 'close'}`}>
                {r.actif ? t('active', 'active') : t('en pause', 'paused')}
              </span>
              <span className="pj-liv-titre">
                <strong>{r.nom}</strong> · {direDeclencheur(r, t)}
                {r.plage &&
                  ` · ${t('heures ouvrées', 'business hours')} ${r.plage.debut}–${r.plage.fin}`}
                {r.actif && r.prochaineA !== null && (
                  <>
                    {' · '}
                    {t('prochaine', 'next')}{' '}
                    <time className="mono">{new Date(r.prochaineA).toLocaleString()}</time>
                  </>
                )}
                {' · '}
                {r.autorite === 'compte'
                  ? t(`au nom de ${r.auteur ?? '?'}`, `on behalf of ${r.auteur ?? '?'}`)
                  : t('au nom de la ruche (jeton)', 'on behalf of the hive (token)')}
              </span>
              <span className="pj-rejeu-actions">
                <button
                  className="btn ghost sm"
                  disabled={occupe === r.id}
                  onClick={() => geste(r.id, () => reglerRoutine(project.id, r.id, !r.actif))}
                >
                  {r.actif ? t('pause', 'pause') : t('reprendre', 'resume')}
                </button>
                <button
                  className="btn ghost sm"
                  disabled={occupe === r.id}
                  onClick={() => geste(r.id, () => declencherRoutine(project.id, r.id))}
                >
                  {t('lancer maintenant', 'run now')}
                </button>
                {r.declencheur === 'webhook' && (
                  <button
                    className="btn ghost sm"
                    disabled={occupe === r.id}
                    title={t('L’ancienne clé est révoquée', 'The old key is revoked')}
                    onClick={() =>
                      geste(r.id, () =>
                        regenererCleRoutine(project.id, r.id).then(({ secret }) =>
                          setCle({ nom: r.nom, url: r.webhook ?? '', secret }),
                        ),
                      )
                    }
                  >
                    {t('nouvelle clé', 'new key')}
                  </button>
                )}
                <button
                  className="btn ghost sm"
                  disabled={occupe === r.id}
                  onClick={() => geste(r.id, () => supprimerRoutine(project.id, r.id))}
                >
                  {t('supprimer', 'delete')}
                </button>
              </span>
              {r.derniereErreur && <p className="pj-sub-note">⚠ {r.derniereErreur}</p>}
              {r.runs.length > 0 && (
                <ul className="pj-routines-runs" aria-label={t('Derniers runs', 'Last runs')}>
                  {r.runs.slice(0, 5).map((x) => (
                    <li key={x.id} data-statut={x.statut}>
                      <time className="mono">{new Date(x.creeA).toLocaleString()}</time> ·{' '}
                      {x.source} · {direStatut(x.statut, t)}
                      {/* Le libellé de `fusionnee`/`sautee` dit déjà tout. */}
                      {x.motif && !MOTIF_REDIT.has(x.statut) && ` — ${x.motif}`}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormulaireRoutine({
  projectId,
  ciDisponible,
  onCree,
  onAnnule,
}: {
  projectId: string;
  ciDisponible: boolean;
  onCree: (r: RoutineVue, secret: string | undefined) => void;
  onAnnule: () => void;
}) {
  const t = useT();
  const [nom, setNom] = useState('');
  const [consigne, setConsigne] = useState('');
  const [declencheur, setDeclencheur] = useState<DeclencheurRoutine>('cron');
  const [expression, setExpression] = useState('0 9 * * 1-5');
  const [fuseau, setFuseau] = useState(fuseauLocal);
  const [branche, setBranche] = useState('main');
  const [ouvrees, setOuvrees] = useState(false);
  const [debut, setDebut] = useState('09:00');
  const [fin, setFin] = useState('18:00');
  const [concurrence, setConcurrence] = useState<ConcurrenceRoutine>('coalesce_if_active');
  const [rattrapage, setRattrapage] = useState<RattrapageRoutine>('skip_missed');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const creer = () => {
    const corps: NouvelleRoutine = {
      nom: nom.trim(),
      consigne,
      declencheur,
      fuseau,
      concurrence,
      ...(declencheur === 'cron' ? { expression, rattrapage } : {}),
      ...(declencheur === 'ci_rouge' ? { branche } : {}),
      ...(ouvrees ? { plage: { jours: JOURS_OUVRES, debut, fin } } : {}),
    };
    setEnCours(true);
    setErreur(null);
    creerRoutine(projectId, corps)
      .then((r) => onCree(r.routine, r.secret))
      .catch((e: unknown) => setErreur(errMsg(e)))
      .finally(() => setEnCours(false));
  };

  return (
    <div className="pj-rejeu-form" data-testid="routine-formulaire">
      <label>
        {t('Nom', 'Name')}
        <input value={nom} onChange={(e) => setNom(e.target.value)} maxLength={80} />
      </label>
      <label>
        {t('Consigne de la mission', 'Mission instructions')}
        <textarea value={consigne} onChange={(e) => setConsigne(e.target.value)} rows={3} />
      </label>
      <label>
        {t('Déclencheur', 'Trigger')}
        <select
          value={declencheur}
          onChange={(e) => setDeclencheur(e.target.value as DeclencheurRoutine)}
        >
          <option value="cron">{t('horaire (cron)', 'schedule (cron)')}</option>
          <option value="webhook">{t('webhook signé', 'signed webhook')}</option>
          <option value="ci_rouge" disabled={!ciDisponible}>
            {ciDisponible
              ? t('CI rouge sur une branche', 'red CI on a branch')
              : t(
                  'CI rouge — dépôt GitHub et jeton requis',
                  'red CI — GitHub repo and token needed',
                )}
          </option>
        </select>
      </label>
      {declencheur === 'cron' && (
        <label>
          {t(
            'Expression cron (min h jour mois jour-semaine)',
            'Cron expression (min h dom mon dow)',
          )}
          <input
            className="mono"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            maxLength={120}
          />
        </label>
      )}
      {declencheur === 'ci_rouge' && (
        <label>
          {t('Branche surveillée', 'Watched branch')}
          <input value={branche} onChange={(e) => setBranche(e.target.value)} maxLength={200} />
        </label>
      )}
      <label>
        {t('Fuseau', 'Time zone')}
        <input value={fuseau} onChange={(e) => setFuseau(e.target.value)} maxLength={64} />
      </label>
      <label className="pj-routines-case">
        <input type="checkbox" checked={ouvrees} onChange={() => setOuvrees(!ouvrees)} />{' '}
        {t('Heures ouvrées seulement (lun–ven)', 'Business hours only (Mon–Fri)')}
      </label>
      {ouvrees && (
        <label>
          {t('De … à …', 'From … to …')}
          <span>
            <input type="time" value={debut} onChange={(e) => setDebut(e.target.value)} />{' '}
            <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} />
          </span>
        </label>
      )}
      <label>
        {t('Si le travail précédent vole encore', 'If the previous work is still running')}
        <select
          value={concurrence}
          onChange={(e) => setConcurrence(e.target.value as ConcurrenceRoutine)}
        >
          <option value="coalesce_if_active">{t('le rejoindre', 'join it')}</option>
          <option value="skip_if_active">{t('sauter', 'skip')}</option>
          <option value="always_enqueue">{t('lancer quand même', 'run anyway')}</option>
        </select>
      </label>
      {declencheur === 'cron' && (
        <label>
          {t('Créneaux manqués (Reine arrêtée)', 'Missed slots (Queen stopped)')}
          <select
            value={rattrapage}
            onChange={(e) => setRattrapage(e.target.value as RattrapageRoutine)}
          >
            <option value="skip_missed">{t('un seul rattrapage', 'a single catch-up')}</option>
            <option value="enqueue_missed_with_cap">
              {t('chacun, jusqu’à 25', 'each one, up to 25')}
            </option>
          </select>
        </label>
      )}
      <p className="pj-sub-note">
        {t(
          'Créer une routine autorise la dépense à l’avance : chaque déclenchement lance une mission ordinaire du projet, en votre nom, sous le plafond de La Balance, l’Evaluator et la relecture croisée. Une routine ne fusionne jamais rien.',
          'Creating a routine authorizes the spending in advance: each trigger starts an ordinary mission of the project, on your behalf, under the Balance cap, the Evaluator and cross-review. A routine never merges anything.',
        )}
      </p>
      {erreur && <p className="panel-error">{erreur}</p>}
      <div className="pj-rejeu-actions">
        <button
          className="btn sm"
          onClick={creer}
          disabled={enCours || nom.trim() === '' || consigne.trim() === ''}
        >
          {enCours ? '…' : t('Créer la routine', 'Create the routine')}
        </button>
        <button className="btn ghost sm" onClick={onAnnule} disabled={enCours}>
          {t('annuler', 'cancel')}
        </button>
      </div>
    </div>
  );
}
