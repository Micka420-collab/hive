// Éléments d'UI partagés : libellés/icônes de statut, badge, barre de progression.

import type { TaskStatus } from '../../src/shared/types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'en attente',
  ready: 'prête',
  assigned: 'assignée',
  running: 'en cours',
  done: 'terminée',
  failed: 'échouée',
};

export const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  ready: '◇',
  assigned: '◈',
  running: '▶',
  done: '✔',
  failed: '✘',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`badge ${status}`}>
      <span className="badge-icon">{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      className="pbar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="pbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Durée lisible (ms → « 1,2 s » / « 340 ms »). */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
