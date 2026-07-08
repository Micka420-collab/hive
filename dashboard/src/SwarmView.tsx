// Visualisation de l'essaim : chaque nœud est une alvéole, chaque tâche une
// cellule du rayon ; un fil relie une tâche à l'alvéole qui la butine, et les
// sous-agents actifs pulsent autour du nœud. Rendu SVG pur, mis à jour en
// temps réel par les snapshots WebSocket.

import type { HiveNode, SubAgent, Task } from '../../src/shared/types';

interface Props {
  tasks: Task[];
  nodes: HiveNode[];
  /** Derniers sous-agents remontés par tâche (événements task_progress). */
  agentsByTask: Record<string, SubAgent[]>;
}

const W = 880;
const H = 470;

/** Sommets d'un hexagone pointe en haut. */
function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Position d'une tâche dans le rayon (grille en nid d'abeille, 3 colonnes). */
function taskPos(index: number): { x: number; y: number } {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: 120 + col * 100 + (row % 2) * 50, y: 92 + row * 88 };
}

/** Position d'une alvéole de nœud (colonne de droite). */
function nodePos(index: number, count: number): { x: number; y: number } {
  if (count === 1) return { x: 700, y: H / 2 };
  const spacing = Math.min(170, (H - 160) / (count - 1));
  return { x: 700, y: 100 + index * spacing };
}

export function SwarmView({ tasks, nodes, agentsByTask }: Props) {
  const taskIndex = new Map(tasks.map((t, i) => [t.id, i]));
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));

  return (
    <svg className="swarm" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vue de l'essaim">
      {/* Fils tâche ↔ nœud (assignée : discret ; en cours : animé) */}
      {tasks.map((t) => {
        if (!t.assignedNodeId || (t.status !== 'assigned' && t.status !== 'running')) return null;
        const ti = taskIndex.get(t.id);
        const ni = nodeIndex.get(t.assignedNodeId);
        if (ti === undefined || ni === undefined) return null;
        const a = taskPos(ti);
        const b = nodePos(ni, nodes.length);
        return (
          <line
            key={`lien-${t.id}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className={t.status === 'running' ? 'link running' : 'link'}
          />
        );
      })}

      {/* Cellules du rayon : une par tâche */}
      {tasks.map((t, i) => {
        const { x, y } = taskPos(i);
        return (
          <g key={t.id} className={`cell ${t.status}`}>
            <polygon points={hexPoints(x, y, 34)} />
            <text x={x} y={y - 2} className="cell-label">
              T{i + 1}
            </text>
            <text x={x} y={y + 14} className="cell-status">
              {t.status}
            </text>
            <title>
              {`${t.title} — ${t.status}${t.attempts > 0 ? ` (${t.attempts} tentative(s))` : ''}`}
            </title>
          </g>
        );
      })}

      {/* Alvéoles de nœuds + sous-agents en pulsation */}
      {nodes.map((n, i) => {
        const { x, y } = nodePos(i, nodes.length);
        const active = tasks.filter(
          (t) => t.assignedNodeId === n.id && (t.status === 'running' || t.status === 'assigned'),
        );
        const reported = active.flatMap((t) => agentsByTask[t.id] ?? []);
        // Sans rapport de sous-agents, on fait pulser une ouvrière par tâche active.
        const pulses: SubAgent[] =
          reported.length > 0
            ? reported
            : active.map((t) => ({ id: t.id, name: 'ouvrière', status: 'running' as const }));
        return (
          <g key={n.id} className={`node ${n.status}${active.length > 0 ? ' active' : ''}`}>
            {active.length > 0 && <polygon points={hexPoints(x, y, 62)} className="halo" />}
            <polygon points={hexPoints(x, y, 48)} className="node-hex" />
            <text x={x} y={y - 6} className="node-name">
              {n.name}
            </text>
            <text x={x} y={y + 12} className="node-info">
              {n.running}/{n.maxConcurrency} · {n.agentType}
            </text>
            {pulses.slice(0, 8).map((sa, j) => {
              const angle = (Math.PI * 2 * j) / Math.max(pulses.length, 1) - Math.PI / 2;
              const px = x + Math.cos(angle) * 72;
              const py = y + Math.sin(angle) * 72;
              return (
                <g key={`${sa.id}-${j}`}>
                  <circle cx={px} cy={py} r={7} className={`agent ${sa.status}`} />
                  <title>{sa.name}</title>
                </g>
              );
            })}
            <title>{`${n.name} (${n.ownerName}) — ${n.status}`}</title>
          </g>
        );
      })}

      {nodes.length === 0 && tasks.length === 0 && (
        <text x={W / 2} y={H / 2} className="swarm-empty">
          La ruche attend ses premières ouvrières…
        </text>
      )}
    </svg>
  );
}
