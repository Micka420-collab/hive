// Vue Essaim — les ouvrières : cartes des nœuds membres (charge, sous-agents
// en vol) et Waggle Board, la danse frétillante qui classe le nectar butiné.

import { fetchPheromones, fetchRaces, fetchWaggle } from '../api';
import type { Domaine, NodeNectar, TraceePheromone, WaggleBoard } from '../api';
import { useT } from '../i18n';
import { formatMs, ProgressBar } from '../ui';
import { timeShort, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import type { HiveNode, StateSnapshot, SubAgent, Task } from '../../../src/shared/types';
import './essaim.css';

/** Sous-agents en vol sur un nœud : agrégés via les tâches qui lui sont assignées. */
function activeAgentsOf(
  nodeId: string,
  tasks: Task[],
  agentsByTask: Record<string, SubAgent[]>,
): SubAgent[] {
  const flying: SubAgent[] = [];
  for (const t of tasks) {
    if (t.assignedNodeId !== nodeId) continue;
    for (const a of agentsByTask[t.id] ?? []) if (a.status === 'running') flying.push(a);
  }
  return flying;
}

function NodeCard({
  node,
  agents,
  racing,
}: {
  node: HiveNode;
  agents: SubAgent[];
  racing: boolean;
}) {
  const t = useT();
  return (
    <article className={`es-node ${node.status}`}>
      <header className="es-node-head">
        <span className="es-node-name" title={node.name}>
          {racing && (
            <span
              className="es-race-badge"
              role="img"
              title={t('en course de drones', 'in a drone race')}
              aria-label={t('en course de drones', 'in a drone race')}
            >
              ⚔
            </span>
          )}
          {node.name}
        </span>
        <span className={`conn ${node.status}`}>
          <span className="conn-dot" />
          {node.status === 'online' ? t('en ligne', 'online') : t('hors ligne', 'offline')}
        </span>
      </header>
      <div className="es-node-meta">
        <span className="chip es-chip">{node.agentType}</span>
        <span>{node.ownerName}</span>
      </div>
      <div className="es-node-load">
        <span className="es-load-txt">
          {node.running}/{node.maxConcurrency}
        </span>
        <ProgressBar value={node.running} max={node.maxConcurrency} />
      </div>
      <div className="es-agents">
        {agents.length === 0 ? (
          <span className="es-agents-none">
            {t('aucun sous-agent en vol', 'no sub-agents in flight')}
          </span>
        ) : (
          agents.slice(0, 6).map((a) => (
            <span key={a.id} className="es-agent-chip" title={a.name}>
              ⚙ {a.name}
            </span>
          ))
        )}
        {agents.length > 6 && <span className="es-agents-none">+{agents.length - 6}</span>}
      </div>
      <footer className="es-node-foot">
        {node.lastSeen === null
          ? t('jamais vu', 'never seen')
          : `${t('vu à', 'seen at')} ${timeShort(node.lastSeen)}`}
      </footer>
    </article>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** Podium des trois meilleurs butineurs — le n°1 danse (waggle dance). */
function Podium({ nodes }: { nodes: NodeNectar[] }) {
  const top = nodes.slice(0, 3);
  // Ordre visuel : 2e à gauche, 1er au centre, 3e à droite.
  const order = [1, 0, 2].filter((i) => i < top.length);
  return (
    <div className="es-podium">
      {order.map((i) => {
        const n = top[i];
        if (!n) return null;
        return (
          <div key={n.nodeId} className={`es-podium-slot es-rank-${i + 1}`}>
            <span className={i === 0 ? 'es-medal es-dance' : 'es-medal'} aria-hidden="true">
              {MEDALS[i]}
            </span>
            <span className="es-podium-name" title={n.name}>
              {n.name}
            </span>
            <span className="es-podium-score">{n.score} 🍯</span>
          </div>
        );
      })}
    </div>
  );
}

/** Liste complète : barres de nectar proportionnelles au score du n°1. */
function NectarList({ board }: { board: WaggleBoard }) {
  const maxScore = Math.max(1, board.nodes[0]?.score ?? 1);
  return (
    <ul className="es-nectar-list">
      {board.nodes.map((n, i) => (
        <li key={n.nodeId} className="es-nectar-row">
          <span className="es-rank">{i + 1}</span>
          <div>
            <div className="es-nectar-head">
              <span className="es-nectar-name" title={n.name}>
                {n.name}
              </span>
              <span className="es-nectar-stats">
                {Math.round(n.successRate * 100)} % · {formatMs(n.avgDurationMs)} · ✔ {n.tasksDone}{' '}
                ✘ {n.tasksFailed}
                {n.raceWins > 0 && <> · ⚔ {n.raceWins}</>}
              </span>
            </div>
            <div className="es-bar">
              <div
                className="es-bar-fill"
                style={{ width: `${Math.round((n.score / maxScore) * 100)}%` }}
              />
            </div>
          </div>
          <span className="es-score">{n.score}</span>
        </li>
      ))}
    </ul>
  );
}

/** Carte « Courses en vol » : rendue seulement s'il y a au moins une course. */
function RacesCard({
  races,
  snapshot,
}: {
  races: { taskId: string; factor: number; drones: { nodeId: string; status: string }[] }[];
  snapshot: ViewProps['snapshot'];
}) {
  const t = useT();
  const titleOf = (taskId: string): string =>
    snapshot.tasks.find((task) => task.id === taskId)?.title ?? `${taskId.slice(0, 8)}…`;
  const nameOf = (nodeId: string): string =>
    snapshot.nodes.find((n) => n.id === nodeId)?.name ?? `${nodeId.slice(0, 8)}…`;
  const ICON: Record<string, string> = { running: '✈', failed: '✘', succeeded: '🏆' };
  // Statuts traduits : le title/aria porte l'état, l'emoji seul ne suffit
  // ni aux lecteurs d'écran ni aux opérateurs non anglophones.
  const statusLabel = (status: string): string =>
    status === 'running'
      ? t('en vol', 'flying')
      : status === 'failed'
        ? t('tombé', 'down')
        : status === 'succeeded'
          ? t('vainqueur', 'winner')
          : status;
  return (
    <section className="card">
      <header className="panel-head">
        <h2>{t('⚔ Courses en vol', '⚔ Races in flight')}</h2>
        <span className="panel-count">{races.length}</span>
      </header>
      <ul className="es-races">
        {races.map((r) => (
          <li key={r.taskId} className="es-race-row">
            <span className="es-race-title" title={titleOf(r.taskId)}>
              {titleOf(r.taskId)}
            </span>
            <span className="es-race-drones">
              {r.drones.map((d) => (
                <span
                  key={d.nodeId}
                  className={`es-race-drone ${d.status}`}
                  role="img"
                  title={statusLabel(d.status)}
                  aria-label={`${nameOf(d.nodeId)} — ${statusLabel(d.status)}`}
                >
                  {ICON[d.status] ?? '?'} {nameOf(d.nodeId)}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Double libellé fr/en (constante de module) — résolu via t au rendu.
const DOMAINE_LABEL: Record<Domaine, { fr: string; en: string }> = {
  api: { fr: 'API', en: 'API' },
  ui: { fr: 'Interface', en: 'UI' },
  db: { fr: 'Base de données', en: 'Database' },
  tests: { fr: 'Tests', en: 'Tests' },
  docs: { fr: 'Documentation', en: 'Docs' },
  infra: { fr: 'Infra', en: 'Infra' },
  general: { fr: 'Général', en: 'General' },
};

/**
 * Phéromones : l'affinité apprise nœud × domaine.
 *
 * PRÉSENTATION — regroupement PAR NŒUD plutôt que matrice nœuds × domaines.
 * La matrice paraît séduisante mais elle est creuse : le serveur ne renvoie
 * que les 30 meilleures traces, et un nœud n'a de trace que sur les domaines
 * qu'il a réellement travaillés — la grille se remplirait surtout de vides.
 * Le regroupement par nœud répond directement à la question de l'opérateur
 * (« sur quoi cette ouvrière est-elle douée, sur quoi se plante-t-elle ? »),
 * ne montre que du signal, et reste lisible avec 2 comme avec 12 nœuds.
 *
 * L'axe de chaque barre est CENTRÉ : attirance à droite (vert), répulsion à
 * gauche (rouge) — la phéromone répulsive est un vrai signal, pas une
 * absence. Le score signé est écrit en toutes lettres à côté : la couleur ne
 * porte jamais l'information seule.
 */
function PheromonesCard({
  traces,
  snapshot,
}: {
  /** `null` : première réponse pas encore arrivée (état de chargement). */
  traces: TraceePheromone[] | null;
  snapshot: StateSnapshot;
}) {
  const t = useT();
  // Traces déjà triées par score décroissant côté serveur : le premier nœud
  // rencontré est le plus fort, et ses domaines restent dans cet ordre.
  const parNoeud = new Map<string, TraceePheromone[]>();
  for (const trace of traces ?? []) {
    const liste = parNoeud.get(trace.nodeId);
    if (liste) liste.push(trace);
    else parNoeud.set(trace.nodeId, [trace]);
  }
  // Échelle commune à tous les nœuds : les barres sont comparables entre eux.
  const maxAbs = Math.max(1, ...(traces ?? []).map((trace) => Math.abs(trace.score)));
  const nameOf = (nodeId: string): string =>
    snapshot.nodes.find((n) => n.id === nodeId)?.name ?? `${nodeId.slice(0, 8)}…`;

  return (
    <section className="card">
      <header className="panel-head">
        <h2>{t('🐜 Phéromones', '🐜 Pheromones')}</h2>
        {traces && (
          <span className="panel-count">
            {traces.length} {t('trace(s)', 'trace(s)')}
          </span>
        )}
      </header>
      {traces === null ? (
        <p className="empty pad">{t('Lecture des pistes…', 'Reading the trails…')}</p>
      ) : traces.length === 0 ? (
        <p className="empty pad">
          {t(
            'La ruche n’a pas encore d’affinité mesurée — les phéromones apparaissent après les premiers résultats.',
            'The hive has no measured affinity yet — pheromones appear after the first results.',
          )}
        </p>
      ) : (
        <ul className="es-phero">
          {[...parNoeud].map(([nodeId, domaines]) => (
            <li key={nodeId} className="es-phero-node">
              <span className="es-phero-name" title={nameOf(nodeId)}>
                {nameOf(nodeId)}
              </span>
              <ul className="es-phero-rows">
                {domaines.map((trace) => {
                  const positif = trace.score >= 0;
                  const libelle = t(
                    DOMAINE_LABEL[trace.domaine].fr,
                    DOMAINE_LABEL[trace.domaine].en,
                  );
                  const sens = positif ? t('attirance', 'attraction') : t('répulsion', 'repulsion');
                  const largeur = (Math.abs(trace.score) / maxAbs) * 50;
                  return (
                    // `title` et non `aria-label` : nommer le <li> masquerait
                    // son contenu aux lecteurs d'écran, alors que celui-ci est
                    // déjà complet (domaine, ✔/✘, score SIGNÉ — la polarité ne
                    // repose donc jamais sur la seule couleur).
                    <li
                      key={trace.domaine}
                      className="es-phero-row"
                      title={`${libelle} — ${sens}, ${t('score', 'score')} ${trace.score}`}
                    >
                      <div>
                        <div className="es-phero-head">
                          <span className="es-phero-dom" title={libelle}>
                            {libelle}
                          </span>
                          <span className="es-phero-stats">
                            ✔ {trace.reussites} ✘ {trace.echecs}
                          </span>
                        </div>
                        <div className="es-phero-axis" aria-hidden="true">
                          <div
                            className={positif ? 'es-phero-bar pos' : 'es-phero-bar neg'}
                            style={{ width: `${largeur}%` }}
                          />
                        </div>
                      </div>
                      <span className={positif ? 'es-phero-score pos' : 'es-phero-score neg'}>
                        {positif ? `+${trace.score}` : trace.score}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Essaim({ snapshot, agentsByTask, refreshTick }: ViewProps) {
  const t = useT();
  const waggle = useApiPoll(fetchWaggle, 30_000, refreshTick);
  const races = useApiPoll(fetchRaces, 15_000, refreshTick);
  // Les phéromones s'évaporent avec une demi-vie de 7 jours : la cadence du
  // Waggle Board suffit largement.
  const pheromones = useApiPoll(fetchPheromones, 30_000, refreshTick);
  const online = snapshot.nodes.filter((n) => n.status === 'online').length;
  const board = waggle.data;
  // Nœuds avec un drone encore en vol : marqués ⚔ sur leur carte. Les courses
  // vivent en mémoire du hub : si le poll tombe en panne, races.data est
  // périmé — on éteint le badge plutôt que d'affirmer une course fantôme.
  const liveRaces = races.error === null ? (races.data?.races ?? []) : [];
  const racingNodes = new Set<string>();
  for (const r of liveRaces)
    for (const d of r.drones) if (d.status === 'running') racingNodes.add(d.nodeId);

  return (
    <div className="mc-view es-view">
      <div className="es-layout">
        <div className="es-left-col">
          <section className="card">
            <header className="panel-head">
              <h2>{t('Ouvrières de la ruche', 'Workers of the hive')}</h2>
              <span className="panel-count">
                {online}/{snapshot.nodes.length} {t('en ligne', 'online')}
              </span>
            </header>
            {snapshot.nodes.length === 0 ? (
              <p className="empty pad">
                {t(
                  'Aucune ouvrière dans l’essaim — invitez un nœud à rejoindre la ruche.',
                  'No workers in the swarm — invite a node to join the hive.',
                )}
              </p>
            ) : (
              <div className="es-node-grid">
                {snapshot.nodes.map((n) => (
                  <NodeCard
                    key={n.id}
                    node={n}
                    agents={activeAgentsOf(n.id, snapshot.tasks, agentsByTask)}
                    racing={racingNodes.has(n.id)}
                  />
                ))}
              </div>
            )}
          </section>
          {/* Dégradation propre : si /api/pheromones n'a JAMAIS répondu et est
              en erreur (orchestrateur plus ancien sans la route, ou réseau),
              la carte disparaît — la vue Essaim, elle, reste intacte. */}
          {!(pheromones.data === null && pheromones.error !== null) && (
            <PheromonesCard traces={pheromones.data?.traces ?? null} snapshot={snapshot} />
          )}
        </div>

        <div className="es-right-col">
          {liveRaces.length > 0 && <RacesCard races={liveRaces} snapshot={snapshot} />}
          <section className="card">
            <header className="panel-head">
              <h2>Waggle Board</h2>
              {board && (
                <span className="panel-count">
                  ✔ {board.totalTasksDone} · ✘ {board.totalTasksFailed}
                </span>
              )}
            </header>
            {waggle.error && <p className="panel-error">{waggle.error}</p>}
            {!board && !waggle.error && (
              <p className="empty pad">{t('Lecture de la danse…', 'Reading the dance…')}</p>
            )}
            {board && board.nodes.length === 0 && (
              <p className="empty pad">
                {t(
                  'La danse frétillante attend le premier nectar.',
                  'The waggle dance awaits its first nectar.',
                )}
              </p>
            )}
            {board && board.nodes.length > 0 && (
              <>
                <Podium nodes={board.nodes} />
                <NectarList board={board} />
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
