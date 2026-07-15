// Table des tâches : filtrable par statut, cliquable (ouvre le tiroir de détail).

import { useState } from 'react';
import type { HiveNode, Task, TaskStatus } from '../../src/shared/types';
import { useLang, useT } from './i18n';
import { activateProps, formatMs, StatusBadge, statusLabel } from './ui';

interface Props {
  tasks: Task[];
  nodes: HiveNode[];
  /** Tâches retenues par le Sting Detector (conflit fichier avec une tâche active). */
  deferred?: Set<string>;
  onSelect: (task: Task) => void;
}

const FILTERS: (TaskStatus | 'all')[] = ['all', 'running', 'ready', 'pending', 'done', 'failed'];

export function TaskTable({ tasks, nodes, deferred, onSelect }: Props) {
  const t = useT();
  const lang = useLang();
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all');
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));
  const shown = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  return (
    <section className="card">
      <header className="panel-head">
        <h2>{t('Tâches', 'Tasks')}</h2>
        <div className="filters">
          {FILTERS.map((f) => {
            const count = f === 'all' ? tasks.length : tasks.filter((t) => t.status === f).length;
            return (
              <button
                key={f}
                className={`chip${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? t('toutes', 'all') : statusLabel(f, lang)}{' '}
                <span className="chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </header>

      {tasks.length === 0 ? (
        <p className="empty pad">
          {t(
            'Aucune tâche. Cliquez « Nouveau projet » pour lancer un premier butinage.',
            'No tasks. Click “New project” to start a first foraging run.',
          )}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="task-table">
            <thead>
              <tr>
                <th>{t('Tâche', 'Task')}</th>
                <th>{t('Statut', 'Status')}</th>
                <th>{t('Nœud', 'Node')}</th>
                <th>{t('Essais', 'Attempts')}</th>
                <th>{t('Durée', 'Duration')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((task) => (
                <tr key={task.id} className="clickable" {...activateProps(() => onSelect(task))}>
                  <td className="cell-title">
                    {task.title}
                    {deferred?.has(task.id) && task.status === 'ready' && (
                      <span
                        className="badge-conflict"
                        title={t(
                          'Différée par le Sting Detector : conflit de fichier avec une tâche active',
                          'Deferred by the Sting Detector: file conflict with an active task',
                        )}
                      >
                        ⏸ {t('conflit', 'conflict')}
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={task.status} />
                  </td>
                  <td>{task.assignedNodeId ? (nodeName.get(task.assignedNodeId) ?? '—') : '—'}</td>
                  <td>{task.attempts > 0 ? task.attempts : '—'}</td>
                  <td>{task.result ? formatMs(task.result.durationMs) : '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    {t(
                      `Aucune tâche « ${statusLabel(filter as TaskStatus, lang)} ».`,
                      `No “${statusLabel(filter as TaskStatus, lang)}” tasks.`,
                    )}
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
