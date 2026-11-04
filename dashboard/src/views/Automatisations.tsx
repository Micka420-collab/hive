// LES AUTOMATISATIONS — ce que la ruche fait SEULE sur un projet, en un écran.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// La section du rail n'ouvrait que les Chantiers : une liste de scripts, qui
// rend « sans dépôt » sur un projet de labo. Les vrais automatismes de la ruche
// — le Plein Essaim, les garde-fous, les connecteurs — vivaient dans d'autres
// pages, chacun à sa façon, et le geste que demande le propriétaire (« les
// agents valident tout eux-mêmes, et ils se corrigent ») n'existait nulle part.
//
// ─── CE QUE L'ÉCRAN DIT, ET DANS QUEL ORDRE ──────────────────────────────────
//
// 1. LE FULL AUTO, en tête : un interrupteur, ce qu'il autorise et ce qu'il
//    n'autorise pas (la fusion reste un geste humain), ce qu'il a tranché
//    depuis l'activation — validées, corrections, ce qui revient à l'humain —
//    et ses dernières décisions, chacune ouvrant sa tâche. L'allumer se
//    confirme, en disant combien de productions en attente il va trancher.
// 2. LES AUTRES AUTOMATISMES, chacun sur une carte : son état RÉEL lu sur sa
//    route (jamais un « actif » de décor), une phrase, et le chemin vers
//    l'écran qui le règle. Une lecture qui échoue le dit.

import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  fetchChantiers,
  fetchConnecteursProjet,
  fetchEssaim,
  fetchFullAuto,
  fetchGardeFou,
  setFullAuto,
} from '../api';
import type { DecisionFullAutoUi, EtatFullAutoUi, NiveauEssaim } from '../api';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import { ilYA } from '../studio/activite';
import { Icone } from '../studio/Icone';
import type { NomIcone } from '../studio/Icone';
import { useProjetActif } from '../studio/projet-actif';
import type { Project } from '../../../src/shared/types';
import { useApiPoll } from './shared';
import type { ViewId, ViewProps } from './shared';

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function Automatisations({
  snapshot,
  onNavigate,
  onOpenTask,
  onNewProject,
  refreshTick,
  user,
}: ViewProps) {
  const t = useT();
  const [projet] = useProjetActif(snapshot.projects, snapshot.tasks);

  if (!projet) {
    return (
      <div className="mc-view hs-auto">
        <section className="hs-carte hs-auto-vide">
          <Icone nom="automatisations" taille={28} />
          <div>
            <h2>{t('Aucun projet à automatiser', 'No project to automate')}</h2>
            <p className="hs-discret">
              {t(
                'Les automatismes travaillent sur un projet : ses tâches, son dépôt, ses agents.',
                'Automations work on a project: its tasks, repository and agents.',
              )}
            </p>
          </div>
          <button type="button" className="hs-btn primaire" onClick={onNewProject}>
            <Icone nom="plus" taille={16} /> {t('Créer un projet', 'Create a project')}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mc-view hs-auto">
      <p className="hs-discret hs-auto-intro">
        {t(
          `Ce que la ruche fait seule sur « ${projet.name} » — et ce qu'elle te laisse.`,
          `What the hive does on its own on “${projet.name}” — and what it leaves to you.`,
        )}
      </p>
      <CarteFullAuto key={projet.id} projet={projet} tick={refreshTick} onOpenTask={onOpenTask} />
      <h2 className="hs-auto-sous-titre">{t('Les autres automatismes', 'Other automations')}</h2>
      <div className="hs-auto-grille">
        <CartePleinEssaim projet={projet} tick={refreshTick} onNavigate={onNavigate} />
        <CarteGardeFous projet={projet} tick={refreshTick} onNavigate={onNavigate} />
        <CarteChantiers projet={projet} tick={refreshTick} onNavigate={onNavigate} />
        <CarteConnecteurs
          projet={projet}
          tick={refreshTick}
          onNavigate={onNavigate}
          admin={user?.role === 'admin'}
        />
      </div>
    </div>
  );
}

// ─── Le full auto ────────────────────────────────────────────────────────────

function CarteFullAuto({
  projet,
  tick,
  onOpenTask,
}: {
  projet: Project;
  tick: number;
  onOpenTask: (id: string) => void;
}) {
  const t = useT();
  const lu = useApiPoll(() => fetchFullAuto(projet.id), 8_000, tick);
  // La réponse du geste vaut lecture jusqu'à la suivante : l'interrupteur ne
  // revient pas en arrière le temps d'un aller-retour.
  const [reponse, setReponse] = useState<EtatFullAutoUi | null>(null);
  useEffect(() => setReponse(null), [lu.data]);
  const etat = reponse ?? lu.data;
  const [confirmer, setConfirmer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const boutonConfirmer = useRef<HTMLButtonElement>(null);
  const interrupteur = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmer) boutonConfirmer.current?.focus();
  }, [confirmer]);

  const actif = etat?.actif ?? false;
  const regler = (valeur: boolean) => {
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    setFullAuto(projet.id, valeur)
      .then((r) => {
        setReponse(r);
        setConfirmer(false);
        interrupteur.current?.focus();
        lu.refresh();
      })
      .catch((e: unknown) =>
        setErreur(
          e instanceof ApiError && (e.status === 401 || e.status === 403)
            ? t(
                'Seul le propriétaire du projet peut régler le full auto.',
                'Only the project owner can set full auto.',
              )
            : msg(e),
        ),
      )
      .finally(() => setEnvoi(false));
  };

  const b = etat?.bilan;
  const aToi = (b ? b.laissees + b.bloquees : 0) + (etat?.echouees ?? 0);

  return (
    <section
      className={`hs-carte hs-auto-pilote${actif ? ' actif' : ''}`}
      aria-labelledby="hs-fa-titre"
    >
      <header className="hs-auto-pilote-tete">
        <span className="hs-auto-tuile" aria-hidden="true">
          <Icone nom="etincelles" taille={24} />
        </span>
        <div className="hs-auto-pilote-titres">
          <h2 id="hs-fa-titre">{t('Full auto', 'Full auto')}</h2>
          <p id="hs-fa-desc" className="hs-discret">
            {t(
              'Les agents valident leurs productions, se corrigent, et ne t’appellent que lorsqu’ils bloquent.',
              'Agents approve their own productions, fix themselves, and only call you when they are stuck.',
            )}
          </p>
        </div>
        <span className={`hs-pastille ${actif ? 'ton-ok' : 'neutre'}`}>
          <span className="hs-point" aria-hidden="true" />
          {etat === null
            ? t('Lecture…', 'Reading…')
            : actif && etat.depuis !== null
              ? t(
                  `Activé · ${ilYA(etat.depuis, Date.now(), t)}`,
                  `On · ${ilYA(etat.depuis, Date.now(), t)}`,
                )
              : t('Éteint', 'Off')}
        </span>
        <button
          ref={interrupteur}
          type="button"
          role="switch"
          aria-checked={actif}
          aria-labelledby="hs-fa-titre"
          aria-describedby="hs-fa-desc"
          aria-disabled={envoi || etat === null}
          className={`hs-interrupteur${actif ? ' actif' : ''}`}
          onClick={() => {
            if (envoi || etat === null) return;
            if (actif) regler(false);
            else setConfirmer(true);
          }}
        >
          <span className="hs-interrupteur-bouton" aria-hidden="true" />
        </button>
      </header>

      {confirmer && !actif && (
        <div className="hs-auto-confirmer" role="group" aria-labelledby="hs-fa-confirmer">
          <p id="hs-fa-confirmer">
            {t(
              `Allumer le full auto sur « ${projet.name} » ? Plus aucune production n’attendra ton verdict.`,
              `Turn on full auto for “${projet.name}”? No production will wait for your verdict anymore.`,
            )}
            {etat !== null && etat.enAttente > 0 && (
              <>
                {' '}
                <strong>
                  {t(
                    `Les ${etat.enAttente} production(s) qui t’attendent seront tranchées tout de suite.`,
                    `The ${etat.enAttente} production(s) waiting for you will be decided right away.`,
                  )}
                </strong>
              </>
            )}
          </p>
          <div className="hs-auto-confirmer-gestes">
            <button
              ref={boutonConfirmer}
              type="button"
              className="hs-btn primaire"
              onClick={() => regler(true)}
              aria-disabled={envoi}
            >
              <Icone nom="etincelles" taille={16} />
              {envoi
                ? t('Activation…', 'Turning on…')
                : t('Allumer le full auto', 'Turn on full auto')}
            </button>
            <button
              type="button"
              className="hs-btn"
              onClick={() => {
                setConfirmer(false);
                interrupteur.current?.focus();
              }}
            >
              {t('Annuler', 'Cancel')}
            </button>
          </div>
        </div>
      )}

      {(erreur ?? (lu.error && etat === null ? lu.error : null)) && (
        <p className="hs-alerte erreur" role="alert">
          {erreur ?? lu.error}
        </p>
      )}

      <ul className="hs-auto-capacites">
        <Capacite
          icone="coche"
          titre={t('Ils valident', 'They approve')}
          texte={t(
            'Chaque production terminée passe l’Evaluator — Gardiennes, tests, contre-revue — puis est validée sans t’attendre. Sans bac ni CI, aucun test ne tourne : la décision le dit.',
            'Each finished production goes through the Evaluator — guards, tests, cross-review — then is approved without waiting for you. Without a sandbox or CI, no test runs: the decision says so.',
          )}
        />
        <Capacite
          icone="eclair"
          titre={t('Ils se corrigent', 'They fix themselves')}
          texte={t(
            `Production creuse, test rouge, contre-revue qui demande mieux : la tâche repart avec la critique, jusqu’à ${etat?.tentativesMax ?? 3} tentatives.`,
            `Hollow production, red test, a cross-review asking for better: the task goes again with the critique, up to ${etat?.tentativesMax ?? 3} attempts.`,
          )}
        />
        <Capacite
          icone="avertissement"
          titre={t('Ils t’appellent', 'They call you')}
          texte={t(
            'Ce qu’ils ne peuvent pas régler seuls — essais épuisés, panne de machine — reste dans la Validation, et se compte ici.',
            'What they cannot settle alone — attempts exhausted, a machine failure — stays in Review, and is counted here.',
          )}
        />
      </ul>
      <p className="hs-auto-limite">
        <Icone nom="lien" taille={14} />
        {t(
          'La fusion dans ton dépôt reste ton geste — ou celui du Plein Essaim au niveau « plein », sur un dépôt inscrit.',
          'Merging into your repository stays your call — or the Full Swarm’s at the “plein” level, on a registered repository.',
        )}
      </p>

      {etat !== null && (
        <div className="hs-auto-bilan" aria-label={t('Bilan du full auto', 'Full auto summary')}>
          <Chiffre
            valeur={actif && b ? b.validees : null}
            libelle={t('validées', 'approved')}
            ton="ok"
          />
          <Chiffre
            valeur={actif && b ? b.corrigees : null}
            libelle={t('corrections', 'fixes')}
            ton="attention"
          />
          <Chiffre
            valeur={aToi}
            libelle={t('à toi', 'for you')}
            ton={aToi > 0 ? 'echec' : 'neutre'}
          />
          <Chiffre valeur={etat.enAttente} libelle={t('en attente', 'waiting')} ton="neutre" />
          <p className="hs-discret hs-auto-bilan-note">
            {actif
              ? b && b.avecReserve > 0
                ? t(
                    `Depuis l’activation. ${b.avecReserve} validée(s) avec réserve — sans preuve de tests ou sans relecture : le motif est sous chaque décision.`,
                    `Since it was turned on. ${b.avecReserve} approved with a caveat — no test evidence or no review: the reason is under each decision.`,
                  )
                : t('Depuis l’activation.', 'Since it was turned on.')
              : t(
                  'Éteint : chaque production attend ton verdict dans la Validation.',
                  'Off: every production waits for your verdict in Review.',
                )}
          </p>
        </div>
      )}

      {actif && b && b.derniers.length > 0 && (
        <div className="hs-auto-journal">
          <h3>{t('Dernières décisions des agents', 'Latest agent decisions')}</h3>
          <ul>
            {b.derniers.map((d) => (
              <LigneDecision key={d.id} d={d} t={t} onOpenTask={onOpenTask} />
            ))}
          </ul>
        </div>
      )}
      {actif && b && b.derniers.length === 0 && (
        <p className="hs-vide">
          {t(
            'Aucune décision encore : la prochaine production terminée sera jugée ici.',
            'No decision yet: the next finished production will be judged here.',
          )}
        </p>
      )}
    </section>
  );
}

function Capacite({ icone, titre, texte }: { icone: NomIcone; titre: string; texte: string }) {
  return (
    <li>
      <span className="hs-auto-capacite-icone" aria-hidden="true">
        <Icone nom={icone} taille={18} />
      </span>
      <strong>{titre}</strong>
      <span className="hs-discret">{texte}</span>
    </li>
  );
}

function Chiffre({
  valeur,
  libelle,
  ton,
}: {
  valeur: number | null;
  libelle: string;
  ton: 'ok' | 'attention' | 'echec' | 'neutre';
}) {
  return (
    <div className={`hs-auto-chiffre ton-${ton}`}>
      <strong>{valeur === null ? '—' : valeur}</strong>
      <span>{libelle}</span>
    </div>
  );
}

const GESTES: Record<DecisionFullAutoUi['geste'], { icone: NomIcone; ton: string }> = {
  approuver: { icone: 'coche', ton: 'ok' },
  corriger: { icone: 'eclair', ton: 'attention' },
  laisser: { icone: 'avertissement', ton: 'echec' },
  bloquee: { icone: 'avertissement', ton: 'echec' },
};

function LigneDecision({
  d,
  t,
  onOpenTask,
}: {
  d: DecisionFullAutoUi;
  t: Translate;
  onOpenTask: (id: string) => void;
}) {
  const titre = d.titre ?? t(`la tâche ${d.taskId.slice(0, 8)}`, `task ${d.taskId.slice(0, 8)}`);
  const verbe =
    d.geste === 'approuver'
      ? d.raison
        ? t('validée avec réserve', 'approved with a caveat')
        : t('validée', 'approved')
      : d.geste === 'corriger'
        ? t('renvoyée en correction', 'sent back for a fix')
        : d.geste === 'laisser'
          ? t('laissée à toi', 'left to you')
          : t('correction impossible', 'fix impossible');
  const g = GESTES[d.geste];
  return (
    <li className={`ton-${g.ton}`}>
      <span className="hs-auto-journal-icone" aria-hidden="true">
        <Icone nom={g.icone} taille={16} />
      </span>
      <span className="hs-auto-journal-texte">
        <button type="button" className="hs-lien fort" onClick={() => onOpenTask(d.taskId)}>
          {titre}
        </button>{' '}
        {verbe}
        {d.raison && <span className="hs-discret hs-auto-journal-raison">{d.raison}</span>}
      </span>
      <time className="hs-discret" dateTime={new Date(d.ts).toISOString()}>
        {ilYA(d.ts, Date.now(), t)}
      </time>
    </li>
  );
}

// ─── Les autres automatismes ─────────────────────────────────────────────────

interface PropsCarte {
  projet: Project;
  tick: number;
  onNavigate: (vue: ViewId, id?: string) => void;
}

function CarteAutomatisme({
  icone,
  titre,
  etat,
  texte,
  detail,
  action,
}: {
  icone: NomIcone;
  titre: string;
  etat: { mot: string; ton: 'ok' | 'neutre' | 'attention' | 'echec' };
  texte: string;
  detail: string | null;
  action: { libelle: string; faire: () => void } | null;
}) {
  return (
    <section className="hs-carte hs-auto-carte">
      <header>
        <span className="hs-auto-capacite-icone" aria-hidden="true">
          <Icone nom={icone} taille={18} />
        </span>
        <h3>{titre}</h3>
        <span className={`hs-pastille ${etat.ton === 'neutre' ? 'neutre' : `ton-${etat.ton}`}`}>
          {etat.mot}
        </span>
      </header>
      <p className="hs-discret">{texte}</p>
      {detail && <p className="hs-auto-carte-detail">{detail}</p>}
      {action && (
        <button type="button" className="hs-btn petit" onClick={action.faire}>
          {action.libelle}
          <Icone nom="chevronDroite" taille={14} />
        </button>
      )}
    </section>
  );
}

const NIVEAUX: Record<NiveauEssaim, [string, string]> = {
  off: ['Éteint', 'Off'],
  propose: ['Propose', 'Proposes'],
  gouverne: ['Gouverne', 'Governs'],
  plein: ['Plein', 'Full'],
};

function CartePleinEssaim({ projet, tick, onNavigate }: PropsCarte) {
  const t = useT();
  const lu = useApiPoll(() => fetchEssaim(projet.id), 30_000, tick);
  const e = lu.data;
  return (
    <CarteAutomatisme
      icone="ruche"
      titre={t('Plein Essaim', 'Full Swarm')}
      etat={
        e
          ? { mot: t(...NIVEAUX[e.niveau]), ton: e.niveau === 'off' ? 'neutre' : 'ok' }
          : { mot: lu.error ? t('Illisible', 'Unreadable') : '…', ton: 'neutre' }
      }
      texte={t(
        'La ruche décide elle-même de son travail : proposer des tâches, ouvrir des pull requests — jusqu’à fusionner, sur un dépôt inscrit.',
        'The hive decides its own work: propose tasks, open pull requests — up to merging, on a registered repository.',
      )}
      detail={
        e
          ? t(
              `${e.gouvernantes.length} ouvrière(s) éprouvée(s) sur ${e.gouvernantesRequises} requises pour gouverner.`,
              `${e.gouvernantes.length} proven worker(s) out of ${e.gouvernantesRequises} required to govern.`,
            )
          : lu.error
      }
      action={{ libelle: t('Régler', 'Set up'), faire: () => onNavigate('projets', projet.id) }}
    />
  );
}

function CarteGardeFous({ projet, tick, onNavigate }: PropsCarte) {
  const t = useT();
  const lu = useApiPoll(() => fetchGardeFou(projet.id), 30_000, tick);
  const g = lu.data;
  return (
    <CarteAutomatisme
      icone="reglages"
      titre={t('Garde-fous', 'Guard rails')}
      etat={
        g
          ? g.actif
            ? { mot: t('Appris', 'Learnt'), ton: 'ok' }
            : { mot: t('Fixes', 'Fixed'), ton: 'neutre' }
          : { mot: lu.error ? t('Illisible', 'Unreadable') : '…', ton: 'neutre' }
      }
      texte={t(
        'Le contrôle des productions — léger, standard, strict — appris du projet, dans les bornes que tu poses.',
        'How strictly productions are checked — light, standard, strict — learnt from the project, within the bounds you set.',
      )}
      detail={
        g
          ? g.actif && g.bornes
            ? t(
                `Échelon élu : ${g.echelonElu ?? '—'} (entre ${g.bornes.min} et ${g.bornes.max}).`,
                `Elected level: ${g.echelonElu ?? '—'} (between ${g.bornes.min} and ${g.bornes.max}).`,
              )
            : t('Réglage par défaut de la ruche.', 'The hive’s default setting.')
          : lu.error
      }
      action={{ libelle: t('Régler', 'Set up'), faire: () => onNavigate('projets', projet.id) }}
    />
  );
}

function CarteChantiers({ projet, tick, onNavigate }: PropsCarte) {
  const t = useT();
  // La PRÉSENCE d'un dépôt, jamais son adresse : un `repoUrl` peut porter un
  // jeton, et cette carte n'a rien à en montrer (repourl-affichage.test.ts).
  const aUnDepot = projet.repoUrl !== null && projet.repoUrl !== '';
  const lu = useApiPoll(
    () =>
      aUnDepot ? fetchChantiers(projet.id).then((r) => r.chantiers.length) : Promise.resolve(null),
    30_000,
    tick,
  );
  const n = lu.data;
  return (
    <CarteAutomatisme
      icone="code"
      titre={t('Chantiers', 'Works')}
      etat={
        !aUnDepot
          ? { mot: t('Sans dépôt', 'No repository'), ton: 'neutre' }
          : n !== null
            ? { mot: t(`${n} script(s)`, `${n} script(s)`), ton: n > 0 ? 'ok' : 'neutre' }
            : { mot: lu.error ? t('Illisible', 'Unreadable') : '…', ton: 'neutre' }
      }
      texte={t(
        'Les commandes que le dépôt déclare — tests, build — et ses workflows GitHub, lancés par une machine de la ruche.',
        'The commands the repository declares — tests, build — and its GitHub workflows, run by a hive machine.',
      )}
      detail={
        !aUnDepot
          ? t(
              'Ajoute un dépôt au projet pour lancer ses scripts.',
              'Add a repository to the project to run its scripts.',
            )
          : lu.error
      }
      action={{ libelle: t('Ouvrir', 'Open'), faire: () => onNavigate('chantiers') }}
    />
  );
}

function CarteConnecteurs({ projet, tick, onNavigate, admin }: PropsCarte & { admin: boolean }) {
  const t = useT();
  const lu = useApiPoll(() => fetchConnecteursProjet(projet.id), 30_000, tick);
  const actifs = lu.data ? lu.data.connecteurs.filter((c) => c.actif).length : null;
  return (
    <CarteAutomatisme
      icone="lien"
      titre={t('Connecteurs', 'Connectors')}
      etat={
        actifs !== null
          ? { mot: t(`${actifs} actif(s)`, `${actifs} on`), ton: actifs > 0 ? 'ok' : 'neutre' }
          : { mot: t('Avec un compte', 'Needs an account'), ton: 'neutre' }
      }
      texte={t(
        'Slack, webhooks : la ruche prévient quand une production attend ou échoue, et reçoit des verdicts.',
        'Slack, webhooks: the hive notifies when a production waits or fails, and receives verdicts.',
      )}
      detail={
        lu.data
          ? null
          : t(
              'Les connecteurs se règlent avec un compte, par un administrateur de la ruche.',
              'Connectors are set up with an account, by a hive administrator.',
            )
      }
      action={
        admin ? { libelle: t('Régler', 'Set up'), faire: () => onNavigate('intendance') } : null
      }
    />
  );
}
