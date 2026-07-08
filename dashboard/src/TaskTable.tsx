// Table des tâches : filtrable par statut, cliquable (ouvre le tiroir de détail).

import { useState } from 'react';
import type { HiveNode, Task, TaskStatus } from '../../src/shared/types';
import { activateProps, formatMs, StatusBadge, STATUS_LABEL } from './ui';

interface Props {
  tasks: Task[];
  nodes: HiveNode[];
  onSelect: (task: Task) => void;
}

const FILTERS: (TaskStatus | 'all')[] = ['all', 'running', 'ready', 'pending', 'done', 'failed'];

export function TaskTable({ tasks, nodes, onSelect }: Props) {
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));
  const shown = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <section className="card">
      <header className="panel-head">
        <h2>Tâches</h2>
        <div className="filters">
          {FILTERS.map((f) => {
            const count = f === 'all' ? tasks.length : tasks.filter((t) => t.status === f).length;
            return (
              <button
                key={f}
                className={`chip${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'toutes' : STATUS_LABEL[f]}{' '}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </header>

      {tasks.length === 0 ? (
        <p className="empty pad">
          Aucune tâche. Cliquez « Nouveau projet » pour lancer un premier butinage.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="task-table">
            <thead>
              <tr>
                <th>Tâche</th>
                <th>Statut</th>
                <th>Nœud</th>
                <th>Essais</th>
                <th>Durée</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="clickable" {...activateProps(() => onSelect(t))}>
                  <td className="cell-title">{t.title}</td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>{t.assignedNodeId ? (nodeName.get(t.assignedNodeId) ?? '—') : '—'}</td>
                  <td>{t.attempts > 0 ? t.attempts : '—'}</td>
                  <td>{t.result ? formatMs(t.result.durationMs) : '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    Aucune tâche « {STATUS_LABEL[filter as TaskStatus]} ».
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
