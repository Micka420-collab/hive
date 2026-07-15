// Vue Essaim — les ouvrières : cartes des nœuds membres (charge, sous-agents
// en vol) et Waggle Board, la danse frétillante qui classe le nectar butiné.

import { fetchWaggle } from '../api';
import type { NodeNectar, WaggleBoard } from '../api';
import { useT } from '../i18n';
import { formatMs, ProgressBar } from '../ui';
import { timeShort, useApiPoll } from './shared';
import type { ViewProps } from './shared';
import type { HiveNode, SubAgent, Task } from '../../../src/shared/types';
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

function NodeCard({ node, agents }: { node: HiveNode; agents: SubAgent[] }) {
  const t = useT();
  return (
    <article className={`es-node ${node.status}`}>
      <header className="es-node-head">
        <span className="es-node-name" title={node.name}>
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

export default function Essaim({ snapshot, agentsByTask, refreshTick }: ViewProps) {
  const t = useT();
  const waggle = useApiPoll(fetchWaggle, 30_000, refreshTick);
  const online = snapshot.nodes.filter((n) => n.status === 'online').length;
  const board = waggle.data;

  return (
    <div className="mc-view es-view">
      <div className="es-layout">
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
                />
              ))}
            </div>
          )}
        </section>

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
  );
}
