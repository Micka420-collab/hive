// Vue Intendance — les CONNECTEURS externes (src/connectors).
//
// Un seul écran pour les trois gestes que la carte demande : ACTIVER (poser le
// secret d'un connecteur dans l'env Queen), AUTORISER par projet (portées + —
// pour Slack — canaux et usagers), TESTER, et LIRE le journal d'audit. Rien ici
// ne montre la valeur d'un secret : seule sa présence, comme le catalogue de
// clés juste au-dessus. Écran ADMIN — poser un jeton écrit chez l'hôte.

import { useEffect, useState } from 'react';
import {
  autoriserConnecteurProjet,
  fetchConnecteurs,
  fetchConnecteursProjet,
  poserSecretConnecteur,
  revoquerConnecteurProjet,
  testerConnecteurProjet,
  type AutorisationConnecteur,
  type ConnecteurCatalogue,
  type ConnecteurProjetResume,
  type EntreeJournalConnecteur,
  type PorteeConnecteur,
} from '../api';
import { useLang, useT } from '../i18n';
import type { Translate } from '../i18n';

interface Projet {
  id: string;
  name: string;
}

const LIBELLE_PORTEE: Record<PorteeConnecteur, { fr: string; en: string }> = {
  lecture: { fr: 'Lecture', en: 'Read' },
  notification: { fr: 'Notifications', en: 'Notifications' },
  approbation: { fr: 'Approbations', en: 'Approvals' },
  action: { fr: 'Actions', en: 'Actions' },
};

const LIBELLE_RESULTAT: Record<'ok' | 'echec' | 'refuse', { fr: string; en: string }> = {
  ok: { fr: 'ok', en: 'ok' },
  echec: { fr: 'échec', en: 'failed' },
  refuse: { fr: 'refusé', en: 'refused' },
};

export function SectionConnecteurs({ projets }: { projets: Projet[] }) {
  const t = useT();
  const [catalogue, setCatalogue] = useState<ConnecteurCatalogue[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let vivant = true;
    fetchConnecteurs()
      .then((r) => vivant && setCatalogue(r.connecteurs))
      .catch((e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      vivant = false;
    };
  }, [tick]);

  return (
    <section className="card">
      <header className="panel-head">
        <h2>
          <span className="marque" aria-hidden="true" />{' '}
          {t('Connecteurs externes', 'External connectors')}
        </h2>
        {catalogue && (
          <span className="panel-count">
            {catalogue.filter((c) => c.actif).length}/{catalogue.length} {t('actifs', 'active')}
          </span>
        )}
      </header>

      <p className="in-cles-note">
        {t(
          'Un connecteur pousse des faits de la ruche vers l’extérieur (webhook signé, Slack) et — pour Slack — reçoit des approbations, uniquement depuis les canaux et usagers inscrits. Le secret vit chez la Reine, jamais sur un nœud.',
          'A connector pushes hive facts outward (signed webhook, Slack) and — for Slack — receives approvals, only from listed channels and users. The secret lives on the Queen, never on a node.',
        )}
      </p>

      {erreur && <p className="panel-error">{erreur}</p>}
      {catalogue === null && !erreur && (
        <p className="empty pad">{t('Relevé en cours…', 'Loading…')}</p>
      )}

      {catalogue?.map((c) => (
        <CarteConnecteur key={c.id} connecteur={c} t={t} onChange={() => setTick((n) => n + 1)} />
      ))}

      {catalogue && projets.length > 0 && (
        <AutorisationsProjet projets={projets} catalogue={catalogue} t={t} />
      )}
    </section>
  );
}

/** L'activation d'un connecteur : poser chaque secret déclaré, sans jamais le relire. */
function CarteConnecteur({
  connecteur,
  t,
  onChange,
}: {
  connecteur: ConnecteurCatalogue;
  t: Translate;
  onChange: () => void;
}) {
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const poser = (envVar: string) => {
    const valeur = (valeurs[envVar] ?? '').trim();
    if (valeur === '') return;
    setBusy(true);
    setErreur(null);
    poserSecretConnecteur(connecteur.id, envVar, valeur)
      .then(() => {
        setValeurs((v) => ({ ...v, [envVar]: '' }));
        onChange();
      })
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="in-connecteur">
      <div className="in-connecteur-tete">
        <strong>{t(connecteur.libelleFr, connecteur.libelleEn)}</strong>
        <span className={connecteur.actif ? 'in-connecteur-actif' : 'in-connecteur-dormant'}>
          {connecteur.actif ? t('actif', 'active') : t('dormant', 'dormant')}
        </span>
        <span className="in-connecteur-mode">
          {connecteur.mode === 'lecture_seule'
            ? t('lecture seule', 'read-only')
            : t('action', 'action')}
        </span>
      </div>
      <p className="in-connecteur-hint">{t(connecteur.hintFr, connecteur.hintEn)}</p>
      {erreur && <p className="panel-error">{erreur}</p>}
      <ul className="in-connecteur-secrets">
        {connecteur.secrets.map((s) => (
          <li key={s.envVar}>
            <label>
              <span className="in-secret-nom">
                {t(s.libelleFr, s.libelleEn)}
                {s.presente && <span className="in-secret-pose"> ✓ {t('posé', 'set')}</span>}
                {!s.requis && (
                  <span className="in-secret-option"> ({t('optionnel', 'optional')})</span>
                )}
              </span>
              <span className="in-secret-hint">{t(s.hintFr, s.hintEn)}</span>
              <span className="in-secret-ligne">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={s.presente ? '••••••••' : s.envVar}
                  value={valeurs[s.envVar] ?? ''}
                  onChange={(e) => setValeurs((v) => ({ ...v, [s.envVar]: e.target.value }))}
                />
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy || (valeurs[s.envVar] ?? '').trim() === ''}
                  onClick={() => poser(s.envVar)}
                >
                  {s.presente ? t('remplacer', 'replace') : t('poser', 'set')}
                </button>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Autoriser un connecteur sur un projet choisi, tester, et lire le journal. */
function AutorisationsProjet({
  projets,
  catalogue,
  t,
}: {
  projets: Projet[];
  catalogue: ConnecteurCatalogue[];
  t: Translate;
}) {
  const lang = useLang();
  const [projetId, setProjetId] = useState(projets[0]?.id ?? '');
  const [autorisations, setAutorisations] = useState<AutorisationConnecteur[]>([]);
  const [journal, setJournal] = useState<EntreeJournalConnecteur[]>([]);
  const [resumes, setResumes] = useState<ConnecteurProjetResume[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (projetId === '') return;
    let vivant = true;
    fetchConnecteursProjet(projetId)
      .then((r) => {
        if (!vivant) return;
        setAutorisations(r.autorisations);
        setJournal(r.journal);
        setResumes(r.connecteurs);
      })
      .catch((e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      vivant = false;
    };
  }, [projetId, tick]);

  const rafraichir = () => setTick((n) => n + 1);
  const quand = (ms: number) => new Date(ms).toLocaleString();

  return (
    <div className="in-connecteurs-projet">
      <h3>{t('Autoriser par projet', 'Authorize per project')}</h3>
      <label className="in-projet-choix">
        {t('Projet', 'Project')}{' '}
        <select value={projetId} onChange={(e) => setProjetId(e.target.value)}>
          {projets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {erreur && <p className="panel-error">{erreur}</p>}
      {message && <p className="in-connecteur-message">{message}</p>}

      {resumes.map((r) => {
        const def = catalogue.find((c) => c.id === r.id);
        const actuelle = autorisations.find((a) => a.connecteurId === r.id);
        return (
          // La clé porte le projet ET la version de l'autorisation : le
          // formulaire s'initialise depuis `actuelle` au montage. Avec `r.id`
          // seul, il gardait les cases du projet précédent, et restait vide
          // quand l'autorisation arrivait après le premier rendu.
          <FormAutorisation
            key={`${projetId}:${r.id}:${actuelle?.majA ?? 0}`}
            resume={r}
            actif={def?.actif ?? false}
            actuelle={actuelle}
            projetId={projetId}
            t={t}
            onChange={rafraichir}
            onMessage={setMessage}
          />
        );
      })}

      <h3>{t('Journal des appels', 'Call journal')}</h3>
      {journal.length === 0 ? (
        <p className="empty pad">
          {t('Aucun appel journalisé pour ce projet.', 'No calls journaled for this project.')}
        </p>
      ) : (
        <ul className="in-connecteurs-journal">
          {journal.map((e) => (
            <li key={e.id} className={`in-journal-${e.resultat}`}>
              <span className="in-journal-quand">{quand(e.creeA)}</span>
              <span className="in-journal-quoi">
                {e.connecteurId} · {e.acte} · {LIBELLE_RESULTAT[e.resultat][lang]}
              </span>
              <span className="in-journal-qui">{e.qui}</span>
              {e.apercu && <span className="in-journal-apercu">{e.apercu}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormAutorisation({
  resume,
  actif,
  actuelle,
  projetId,
  t,
  onChange,
  onMessage,
}: {
  resume: ConnecteurProjetResume;
  actif: boolean;
  actuelle: AutorisationConnecteur | undefined;
  projetId: string;
  t: Translate;
  onChange: () => void;
  onMessage: (m: string | null) => void;
}) {
  const [portees, setPortees] = useState<Set<PorteeConnecteur>>(new Set(actuelle?.portees ?? []));
  const [canaux, setCanaux] = useState((actuelle?.canaux ?? []).join(', '));
  const [usagers, setUsagers] = useState((actuelle?.usagers ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const lang = useLang();
  const estSlack = resume.id === 'slack';

  const basculer = (p: PorteeConnecteur) => {
    setPortees((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  };

  const decouper = (s: string) =>
    s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);

  /** `ok` rend le message à afficher — le résultat d'un test dit s'il est vraiment parti. */
  const agir = <R,>(p: Promise<R>, ok: (r: R) => string) => {
    setBusy(true);
    onMessage(null);
    p.then((r) => {
      onMessage(ok(r));
      onChange();
    })
      .catch((e: unknown) => onMessage(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const autoriser = () => {
    if (portees.size === 0) {
      onMessage(t('Choisissez au moins une portée.', 'Pick at least one scope.'));
      return;
    }
    agir(
      autoriserConnecteurProjet(projetId, resume.id, {
        portees: [...portees],
        ...(estSlack ? { canaux: decouper(canaux), usagers: decouper(usagers) } : {}),
      }),
      () => t('Autorisation enregistrée.', 'Authorization saved.'),
    );
  };

  // Le fait de test suit la portée accordée : un Slack qui n'a que les
  // approbations teste une demande d'approbation (boutons), pas un résumé
  // qu'il n'a pas le droit de poster.
  const tester = () =>
    agir(
      testerConnecteurProjet(
        projetId,
        resume.id,
        actuelle?.portees.includes('notification') ? 'resume_mission' : 'demande_approbation',
      ),
      (r) =>
        r.envoye
          ? t('Test envoyé (voir le journal).', 'Test sent (see the journal).')
          : `${t('Rien n’est parti', 'Nothing was sent')} : ${r.motif ?? '?'}`,
    );

  return (
    <div className="in-autorisation">
      <div className="in-autorisation-tete">
        <strong>{t(resume.libelleFr, resume.libelleEn)}</strong>
        {!actif && (
          <span className="in-connecteur-dormant">{t('secret manquant', 'secret missing')}</span>
        )}
        {actuelle && <span className="in-connecteur-actif">{t('autorisé', 'authorized')}</span>}
      </div>
      <div className="in-portees">
        {resume.portees.map((p) => (
          <label key={p} className="in-portee">
            <input type="checkbox" checked={portees.has(p)} onChange={() => basculer(p)} />
            {LIBELLE_PORTEE[p][lang]}
          </label>
        ))}
      </div>
      {estSlack && (
        <div className="in-slack-listes">
          <label>
            {t(
              'Canaux autorisés (IDs, séparés par des virgules)',
              'Allowed channels (IDs, comma-separated)',
            )}
            <input
              value={canaux}
              onChange={(e) => setCanaux(e.target.value)}
              placeholder="C01234, C05678"
            />
          </label>
          <label>
            {t('Usagers autorisés à approuver (IDs)', 'Users allowed to approve (IDs)')}
            <input
              value={usagers}
              onChange={(e) => setUsagers(e.target.value)}
              placeholder="U01234, U05678"
            />
          </label>
        </div>
      )}
      <div className="in-autorisation-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={autoriser}>
          {actuelle ? t('Mettre à jour', 'Update') : t('Autoriser', 'Authorize')}
        </button>
        <button type="button" className="btn ghost" disabled={busy || !actuelle} onClick={tester}>
          {t('Tester', 'Test')}
        </button>
        <button
          type="button"
          className="btn ghost in-revoquer"
          disabled={busy || !actuelle}
          onClick={() =>
            agir(revoquerConnecteurProjet(projetId, resume.id), () =>
              t('Connecteur révoqué pour ce projet.', 'Connector revoked for this project.'),
            )
          }
        >
          {t('Révoquer', 'Revoke')}
        </button>
      </div>
    </div>
  );
}
