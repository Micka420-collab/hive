// Rangée de KPI : l'état de la ruche en un coup d'œil.

import type { StateSnapshot } from '../../src/shared/types';
import { ProgressBar } from './ui';

interface Props {
  snapshot: StateSnapshot;
  /** Débit : tâches terminées dans la dernière minute (dérivé du journal). */
  throughput: number;
}

export function StatTiles({ snapshot, throughput }: Props) {
  const { nodes, tasks } = snapshot;
  const online = nodes.filter((n) => n.status === 'online').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'assigned').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const capacity = nodes
    .filter((n) => n.status === 'online')
    .reduce((sum, n) => sum + n.maxConcurrency, 0);
  const load = nodes.reduce((sum, n) => sum + n.running, 0);

  return (
    <div className="stat-tiles">
      <div className="tile">
        <div className="tile-value">
          {online}
          <span className="tile-unit">/{nodes.length}</span>
        </div>
        <div className="tile-label">Nœuds en ligne</div>
        <ProgressBar value={online} max={Math.max(nodes.length, 1)} />
      </div>

      <div className="tile accent">
        <div className="tile-value">
          {done}
          <span className="tile-unit">/{tasks.length}</span>
        </div>
        <div className="tile-label">Tâches terminées</div>
        <ProgressBar value={done} max={Math.max(tasks.length, 1)} />
      </div>

      <div className="tile">
        <div className="tile-value">{running}</div>
        <div className="tile-label">En cours</div>
        <ProgressBar value={load} max={Math.max(capacity, 1)} />
        <div className="tile-sub">
          charge {load}/{capacity}
        </div>
      </div>

      <div className={`tile${failed > 0 ? ' danger' : ''}`}>
        <div className="tile-value">{failed}</div>
        <div className="tile-label">Échecs</div>
      </div>

      <div className="tile">
        <div className="tile-value">
          {throughput}
          <span className="tile-unit"> 🍯/min</span>
        </div>
        <div className="tile-label">Débit</div>
      </div>
    </div>
  );
}
