// Sandbox Live — les exécutions de la ruche, EN DIRECT.
//
// ─── CE QUE CETTE VUE MET ENSEMBLE ──────────────────────────────────────────
//
// Pendant qu'une ouvrière travaille, ses traces étaient éparses : la console
// dans le tiroir de la tâche, les sous-agents en liste plate dans l'Essaim,
// les fichiers ouverts dans la Chambre, les validations du bac au seul
// résultat. Cette vue les rassemble, exécution par exécution : où elle en est
// (préparation → agent → validations), sur quelle ouvrière, quel agent, quel
// modèle, dans quel bac DÉCLARÉ, ce qui tourne, ce que ça coûte à la machine,
// les sous-agents EN ARBRE, les validations à mesure qu'elles concluent.
//
// ─── CE QU'ELLE PERMET ──────────────────────────────────────────────────────
//
//   · ARRÊTER (l'annulation existante) ;
//   · SUSPENDRE / REPRENDRE — seulement là où l'ouvrière a dit qu'elle savait
//     le faire (`pausable`) ; l'état affiché est celui que l'ouvrière
//     CONFIRME, jamais supposé depuis le clic ;
//   · VOIR LE DIFF — demandé à la main, jamais poussé ;
//   · EXPLIQUER — l'état consigné (raison du routage, phase, dernière sortie),
//     sans aucun nouvel appel de modèle.
//
// ─── CE QU'ELLE N'INVENTE PAS ───────────────────────────────────────────────
//
// Une mesure absente s'écrit « inconnu » ; un modèle que l'Aiguillage n'a pas
// commandé s'écrit « celui de l'agent » ; un bac se dit « déclaré ». Les
// décisions d'affichage vivent dans `bac-direct-rendu.ts`, testées à part.

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { DirectTache } from '../../../src/shared/bac-direct';
import { libelleAgent } from '../../../src/shared/agent-libelle';
import type { HiveNode, SubAgent, Task } from '../../../src/shared/types';
import { cancelTask, fetchDiffDirect, pauseTask } from '../api';
import type { DiffDirect } from '../api';
import { EmptyState, useToast } from '../composants';
import { texteDeConsole, ConsoleDeTache } from '../ConsoleDirecte';
import type { MagasinDirects } from '../directs';
import { useLang, useT } from '../i18n';
import type { Translate } from '../i18n';
import { RoutageTache } from '../RoutageTache';
import type { MagasinSorties } from '../sorties-directes';
import {
  arbreSousAgents,
  controlesAffiches,
  dernieresLignes,
  ETAPES,
  etatsDesEtapes,
  executionsVivantes,
  gestePause,
  mesuresLisibles,
  presencesDe,
} from './bac-direct-rendu';
import type { NoeudSousAgent } from './bac-direct-rendu';
import type { ViewProps } from './shared';
import './bac-direct.css';

interface Props extends ViewProps {
  magasinSorties: MagasinSorties;
  magasinDirects: MagasinDirects;
}

const court = (id: string): string => id.slice(0, 8);

function libellePhase(t: Translate, p: (typeof ETAPES)[number]): string {
  switch (p) {
    case 'preparation':
      return t('Préparation', 'Preparing');
    case 'agent':
      return t('Agent', 'Agent');
    case 'validations':
      return t('Validations', 'Validations');
  }
}

function libelleControle(t: Translate, etat: string | null): string {
  switch (etat) {
    case 'en_cours':
      return t('en cours…', 'running…');
    case 'passed':
      return t('réussie', 'passed');
    case 'failed':
      return t('échouée', 'failed');
    case 'missing':
      return t('sans preuve', 'missing');
    case 'not_applicable':
      return t('non déclarée', 'not declared');
    default:
      return t('à venir', 'pending');
  }
}

/** Le bac DÉCLARÉ par l'ouvrière, dit tel quel — jamais vérifié ici. */
function libelleBac(t: Translate, node: HiveNode | undefined): string {
  const iso = node?.isolement;
  if (!iso) return t('bac non déclaré', 'sandbox not declared');
  if (iso.niveau === 'conteneur') {
    return `${iso.fournisseur ?? t('conteneur', 'container')} (${t('déclaré', 'declared')})`;
  }
  if (iso.niveau === 'processus') return t('processus (déclaré)', 'process (declared)');
  return t('aucun bac (déclaré)', 'no sandbox (declared)');
}

/** Le dernier modèle commandé par l'Aiguillage pour la tâche, lu au journal. */
function modeleDe(events: ViewProps['events'], taskId: string): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]!;
    if (ev.type === 'task_assigned' && ev.payload.taskId === taskId) {
      return typeof ev.payload.modele === 'string' ? ev.payload.modele : null;
    }
  }
  return null;
}

function Arbre({ noeuds, t }: { noeuds: NoeudSousAgent[]; t: Translate }) {
  return (
    <ul className="bd-arbre">
      {noeuds.map((n) => (
        <li key={n.agent.id}>
          <span className={`bd-sa bd-sa-${n.agent.status}`}>
            <span className="bd-sa-point" aria-hidden="true" />
            {n.agent.name}
            <span className="bd-sa-etat">
              {n.agent.status === 'running'
                ? t('en cours', 'running')
                : n.agent.status === 'done'
                  ? t('terminé', 'done')
                  : t('échoué', 'failed')}
            </span>
          </span>
          {n.enfants.length > 0 && <Arbre noeuds={n.enfants} t={t} />}
        </li>
      ))}
    </ul>
  );
}

function SousAgents({ agents, t }: { agents: SubAgent[] | undefined; t: Translate }) {
  const arbre = useMemo(() => arbreSousAgents(agents ?? []), [agents]);
  if (arbre.length === 0) {
    return <p className="bd-rien">{t('Aucun sous-agent lancé.', 'No sub-agent launched.')}</p>;
  }
  return (
    // Des listes imbriquées, pas un `role="tree"` : un arbre ARIA promet une
    // navigation au clavier (flèches) qu'une lecture seule n'a pas à offrir.
    <div aria-label={t('Sous-agents', 'Sub-agents')} data-testid="bd-arbre">
      <Arbre noeuds={arbre} t={t} />
    </div>
  );
}

/** Quelle mémoire le nœud a lue : celle de l'arbre se dit, jamais ne se devine. */
function natureMemoire(
  nature: ReturnType<typeof mesuresLisibles>['natureMemoire'],
  t: Translate,
): string {
  if (nature === 'pss') return t('Pss — pages partagées réparties', 'PSS — shared pages split');
  if (nature === 'somme_rss') {
    return t(
      'somme des RSS — pages partagées comptées par processus',
      'summed RSS — shared pages counted per process',
    );
  }
  return t('selon le moteur', 'as reported by the engine');
}

function Mesures({ direct, t }: { direct: DirectTache | undefined; t: Translate }) {
  const m = mesuresLisibles(direct, useLang());
  const inconnu = t('inconnu', 'unknown');
  return (
    <dl className="bd-mesures" data-testid="bd-mesures">
      <div>
        <dt>CPU</dt>
        <dd className={m.cpu ? '' : 'bd-inconnu'}>{m.cpu ?? inconnu}</dd>
      </div>
      <div>
        <dt>{t('Mémoire', 'Memory')}</dt>
        <dd className={m.memoire ? '' : 'bd-inconnu'}>
          {m.memoire ?? inconnu}
          {m.memoire && m.natureMemoire && (
            <span className="bd-nature"> ({natureMemoire(m.natureMemoire, t)})</span>
          )}
        </dd>
      </div>
      <div>
        <dt>{t('Processus', 'Processes')}</dt>
        <dd className={m.processus ? '' : 'bd-inconnu'}>{m.processus ?? inconnu}</dd>
      </div>
      <div>
        <dt>{t('Mesuré sur', 'Measured on')}</dt>
        <dd className={m.source ? '' : 'bd-inconnu'}>
          {m.source === 'arbre'
            ? t('l’arbre de processus', 'the process tree')
            : m.source === 'conteneur'
              ? t('le conteneur (moteur)', 'the container (engine)')
              : inconnu}
        </dd>
      </div>
    </dl>
  );
}

/** Le diff de l'exécution EN COURS — demandé, jamais poussé. */
function DiffEnCours({ taskId, t }: { taskId: string; t: Translate }) {
  const [diff, setDiff] = useState<DiffDirect | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const demander = (): void => {
    setEnCours(true);
    setErreur(null);
    fetchDiffDirect(taskId)
      .then(setDiff)
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setEnCours(false));
  };
  return (
    <section className="bd-bloc" aria-label={t('Diff en cours', 'Diff so far')}>
      <div className="bd-bloc-tete">
        <h3>{t('Diff en cours', 'Diff so far')}</h3>
        <button
          type="button"
          className="btn"
          aria-disabled={enCours || undefined}
          onClick={() => !enCours && demander()}
          data-testid="bd-diff"
        >
          {enCours
            ? t('Demande à l’ouvrière…', 'Asking the worker…')
            : diff
              ? t('Rafraîchir', 'Refresh')
              : t('Voir le diff', 'Show diff')}
        </button>
      </div>
      {erreur && (
        <p className="bd-erreur" role="alert">
          {erreur}
        </p>
      )}
      {diff?.erreur && (
        <p className="bd-erreur" role="alert">
          {diff.erreur}
        </p>
      )}
      {diff && !diff.erreur && (
        <>
          {diff.tronque && (
            <p className="bd-rien">
              {t(
                'Diff coupé à 256 Kio — le diff complet arrive avec le résultat.',
                'Diff cut at 256 KiB — the full diff comes with the result.',
              )}
            </p>
          )}
          {diff.diff === '' ? (
            <p className="bd-rien">
              {t('Aucune modification pour l’instant.', 'No change so far.')}
            </p>
          ) : (
            <pre className="bd-diff" data-testid="bd-diff-texte">
              {diff.diff}
            </pre>
          )}
        </>
      )}
    </section>
  );
}

/** « Expliquer » : l'état CONSIGNÉ, relu — aucun appel de modèle. */
function Explication({
  task,
  direct,
  magasinSorties,
  nodes,
  t,
}: {
  task: Task;
  direct: DirectTache | undefined;
  magasinSorties: MagasinSorties;
  nodes: readonly HiveNode[];
  t: Translate;
}) {
  const abonner = useCallback(
    (prevenir: () => void) => magasinSorties.abonner(task.id, prevenir),
    [magasinSorties, task.id],
  );
  const sortie = useSyncExternalStore(abonner, () => magasinSorties.lire(task.id));
  const lignes = sortie ? dernieresLignes(texteDeConsole(sortie), 8) : [];
  return (
    <section className="bd-bloc" data-testid="bd-explication">
      <h3>{t('Pourquoi, et où en est-elle', 'Why, and where it stands')}</h3>
      <p className="bd-rien">
        {t(
          'Relu dans le journal et l’état en direct — aucun nouvel appel de modèle.',
          'Read back from the journal and the live state — no new model call.',
        )}
      </p>
      <p>
        <strong>{t('Phase : ', 'Phase: ')}</strong>
        {direct?.phase ? libellePhase(t, direct.phase) : t('inconnue', 'unknown')}
        {direct?.enPause ? ` · ${t('en pause', 'paused')}` : ''}
      </p>
      <RoutageTache taskId={task.id} cle={task.assignedNodeId ?? ''} nodes={nodes} />
      <h4>{t('Dernière sortie', 'Last output')}</h4>
      {lignes.length === 0 ? (
        <p className="bd-rien">{t('Rien d’écrit pour l’instant.', 'Nothing written yet.')}</p>
      ) : (
        <pre className="bd-sortie">{lignes.join('\n')}</pre>
      )}
    </section>
  );
}

export default function Sandbox({
  snapshot,
  events,
  agentsByTask,
  selectedId,
  onNavigate,
  onOpenTask,
  magasinSorties,
  magasinDirects,
}: Props) {
  const t = useT();
  const lang = useLang();
  const annoncer = useToast();
  const directs = useSyncExternalStore(magasinDirects.abonner, magasinDirects.lire);
  const [expliquer, setExpliquer] = useState(false);
  const vivantes = useMemo(() => executionsVivantes(snapshot.tasks), [snapshot.tasks]);
  const choisie = vivantes.find((v) => v.id === selectedId) ?? vivantes[0] ?? null;

  const noeud = (id: string | null): HiveNode | undefined =>
    id ? snapshot.nodes.find((n) => n.id === id) : undefined;
  const projet = (id: string): string =>
    snapshot.projects.find((p) => p.id === id)?.name ?? court(id);

  const geste = (task: Task, quoi: 'pause' | 'reprendre' | 'arreter'): void => {
    const envoi =
      quoi === 'arreter' ? cancelTask(task.id) : pauseTask(task.id, quoi === 'reprendre');
    envoi
      .then(() =>
        annoncer({
          ton: 'info',
          message:
            quoi === 'arreter'
              ? t('Arrêt demandé.', 'Stop requested.')
              : quoi === 'pause'
                ? t(
                    'Pause transmise — l’état suit ce que l’ouvrière confirme.',
                    'Pause sent — the state follows what the worker confirms.',
                  )
                : t('Reprise transmise.', 'Resume sent.'),
        }),
      )
      .catch((e: unknown) =>
        annoncer({ ton: 'erreur', message: e instanceof Error ? e.message : String(e) }),
      );
  };

  return (
    <div className="bd-view">
      <header className="card bd-tete">
        <div>
          <h2>Sandbox Live</h2>
          <p>
            {t(
              'Les exécutions en cours dans la ruche : phase, commande, ressources, sous-agents et validations, à mesure qu’elles arrivent.',
              'Runs in progress across the hive: phase, command, resources, sub-agents and validations, as they arrive.',
            )}
          </p>
        </div>
        <span className="bd-compte" data-testid="bd-compte">
          {vivantes.length} {t('exécution(s) en cours', 'run(s) in progress')}
        </span>
      </header>

      {vivantes.length === 0 ? (
        <div className="card">
          <EmptyState
            titre={t('Aucune exécution en cours', 'No run in progress')}
            texte={t(
              'Dès qu’une ouvrière prend une tâche, son exécution apparaît ici.',
              'As soon as a worker takes a task, its run shows up here.',
            )}
          />
        </div>
      ) : (
        <div className="bd-grille">
          <ul className="bd-liste" aria-label={t('Exécutions', 'Runs')}>
            {vivantes.map((task) => {
              const direct = directs[task.id];
              const n = noeud(task.assignedNodeId);
              const selection = choisie?.id === task.id;
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    className={`bd-ligne${selection ? ' bd-ligne-choisie' : ''}`}
                    aria-current={selection || undefined}
                    onClick={() => onNavigate('sandbox', task.id, { replace: true })}
                    data-testid="bd-ligne"
                  >
                    <span className="bd-ligne-titre">{task.title}</span>
                    <span className="bd-ligne-meta">
                      {projet(task.projectId)} · {n?.name ?? t('ouvrière ?', 'worker ?')}
                    </span>
                    <span className="bd-ligne-meta">
                      {direct?.enPause ? (
                        <span className="bd-pastille bd-pastille-pause">
                          {t('en pause', 'paused')}
                        </span>
                      ) : (
                        <span className="bd-pastille">
                          {direct?.phase
                            ? libellePhase(t, direct.phase)
                            : task.status === 'assigned'
                              ? t('assignée', 'assigned')
                              : t('phase inconnue', 'phase unknown')}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {choisie && (
            <DetailExecution
              key={choisie.id}
              task={choisie}
              direct={directs[choisie.id]}
              node={noeud(choisie.assignedNodeId)}
              projet={projet(choisie.projectId)}
              modele={modeleDe(events, choisie.id)}
              presences={presencesDe(events, choisie.id)}
              agents={agentsByTask[choisie.id]}
              magasinSorties={magasinSorties}
              nodes={snapshot.nodes}
              anglais={lang === 'en'}
              expliquer={expliquer}
              onExpliquer={() => setExpliquer((e) => !e)}
              onGeste={(quoi) => geste(choisie, quoi)}
              onOpenTask={onOpenTask}
              t={t}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DetailExecution({
  task,
  direct,
  node,
  projet,
  modele,
  presences,
  agents,
  magasinSorties,
  nodes,
  anglais,
  expliquer,
  onExpliquer,
  onGeste,
  onOpenTask,
  t,
}: {
  task: Task;
  direct: DirectTache | undefined;
  node: HiveNode | undefined;
  projet: string;
  modele: string | null;
  presences: ReturnType<typeof presencesDe>;
  agents: SubAgent[] | undefined;
  magasinSorties: MagasinSorties;
  nodes: readonly HiveNode[];
  anglais: boolean;
  expliquer: boolean;
  onExpliquer: () => void;
  onGeste: (quoi: 'pause' | 'reprendre' | 'arreter') => void;
  onOpenTask: (taskId: string) => void;
  t: Translate;
}) {
  const etapes = etatsDesEtapes(direct?.phase);
  const pause = gestePause(direct);
  const controles = controlesAffiches(direct);
  return (
    <section className="card bd-detail" aria-label={task.title} data-testid="bd-detail">
      <div className="bd-detail-tete">
        <div>
          <h3 className="bd-detail-titre">{task.title}</h3>
          <p className="bd-rien">
            {projet} · <code>{court(task.id)}</code>
          </p>
        </div>
        <div className="bd-gestes">
          {pause && (
            <button
              type="button"
              className="btn"
              onClick={() => onGeste(pause)}
              data-testid="bd-pause"
            >
              {pause === 'pause' ? t('Pause', 'Pause') : t('Reprendre', 'Resume')}
            </button>
          )}
          <button
            type="button"
            className="btn danger-btn"
            onClick={() => onGeste('arreter')}
            data-testid="bd-arreter"
          >
            {t('Arrêter', 'Stop')}
          </button>
          <button
            type="button"
            className="btn ghost"
            aria-pressed={expliquer}
            onClick={onExpliquer}
            data-testid="bd-expliquer"
          >
            {t('Expliquer', 'Explain')}
          </button>
          <button type="button" className="btn ghost" onClick={() => onOpenTask(task.id)}>
            {t('Fiche', 'Details')}
          </button>
        </div>
      </div>

      {direct?.enPause && (
        <p className="bd-bandeau-pause" role="status" data-testid="bd-en-pause">
          {t(
            'En pause — l’agent est suspendu et son délai ne court plus.',
            'Paused — the agent is suspended and its time budget is not running.',
          )}
        </p>
      )}

      <ol className="bd-etapes" aria-label={t('Étapes', 'Steps')}>
        {ETAPES.map((p) => (
          <li
            key={p}
            className={`bd-etape bd-etape-${etapes[p]}`}
            aria-current={etapes[p] === 'en_cours' ? 'step' : undefined}
          >
            {libellePhase(t, p)}
          </li>
        ))}
        <li className="bd-etape bd-etape-a_venir">{t('Terminée', 'Done')}</li>
      </ol>

      <dl className="bd-faits">
        <div>
          <dt>{t('Ouvrière', 'Worker')}</dt>
          <dd>{node?.name ?? t('inconnue', 'unknown')}</dd>
        </div>
        <div>
          <dt>{t('Agent', 'Agent')}</dt>
          <dd>{node ? libelleAgent(node.agentType, anglais) : t('inconnu', 'unknown')}</dd>
        </div>
        <div>
          <dt>{t('Modèle', 'Model')}</dt>
          <dd>{modele ?? t('celui de l’agent (non commandé)', 'the agent’s own (not routed)')}</dd>
        </div>
        <div>
          <dt>{t('Bac', 'Sandbox')}</dt>
          <dd>{libelleBac(t, node)}</dd>
        </div>
      </dl>

      <div className="bd-bloc">
        <h3>{t('Commande', 'Command')}</h3>
        {direct?.commande ? (
          <pre className="bd-commande" data-testid="bd-commande">
            {direct.commande}
          </pre>
        ) : (
          <p className="bd-rien">{t('Aucune commande en cours.', 'No command running.')}</p>
        )}
      </div>

      <div className="bd-bloc">
        <h3>{t('Ressources', 'Resources')}</h3>
        <Mesures direct={direct} t={t} />
      </div>

      {controles.length > 0 && (
        <div className="bd-bloc">
          <h3>{t('Validations du bac', 'Sandbox validations')}</h3>
          <ul className="bd-controles" data-testid="bd-controles">
            {controles.map((c) => (
              <li key={c.cle} className={`bd-controle bd-controle-${c.etat ?? 'a_venir'}`}>
                <span>{c.cle}</span>
                <span>{libelleControle(t, c.etat)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bd-bloc">
        <h3>{t('Sous-agents', 'Sub-agents')}</h3>
        <SousAgents agents={agents} t={t} />
      </div>

      <div className="bd-bloc">
        <h3>{t('Fichiers ouverts constatés', 'Observed open files')}</h3>
        {presences.length === 0 ? (
          <p className="bd-rien">{t('Aucun fichier constaté.', 'No file observed.')}</p>
        ) : (
          <ul className="bd-fichiers">
            {presences.map((p) => (
              <li key={p.toolUseId}>
                <span className="bd-outil">{p.outil}</span> <code>{p.chemin}</code>
              </li>
            ))}
          </ul>
        )}
      </div>

      {expliquer && (
        <Explication
          task={task}
          direct={direct}
          magasinSorties={magasinSorties}
          nodes={nodes}
          t={t}
        />
      )}

      {/* La console porte son propre titre (« Sortie en direct »). */}
      <div className="bd-bloc bd-console">
        <ConsoleDeTache magasin={magasinSorties} taskId={task.id} enCours />
      </div>

      <DiffEnCours taskId={task.id} t={t} />
    </section>
  );
}
