// Table détaillée des tâches : statut, nœud assigné, tentatives, branche, durée.

import type { HiveNode, Task } from '../../src/shared/types';

interface Props {
  tasks: Task[];
  nodes: HiveNode[];
}

export function TaskTable({ tasks, nodes }: Props) {
  if (tasks.length === 0) return null;
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));
  return (
    <table className="task-table">
      <thead>
        <tr>
          <th>Tâche</th>
          <th>Statut</th>
          <th>Nœud</th>
          <th>Tentatives</th>
          <th>Branche</th>
          <th>Durée</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <td>{t.title}</td>
            <td>
              <span className={`badge ${t.status}`}>{t.status}</span>
            </td>
            <td>{t.assignedNodeId ? (nodeName.get(t.assignedNodeId) ?? '—') : '—'}</td>
            <td>{t.attempts}</td>
            <td className="mono">{t.branch ?? '—'}</td>
            <td>{t.result ? `${t.result.durationMs} ms` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
