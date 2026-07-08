// Journal d'événements : flux temps réel, coloré et à icônes.

import type { HiveEvent } from '../../src/shared/types';

interface Meta {
  icon: string;
  cls: string;
  text: (p: Record<string, unknown>) => string;
}

const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 8) : '?');

const EVENTS: Record<string, Meta> = {
  project_created: { icon: '📁', cls: 'info', text: (p) => `projet « ${String(p.name ?? '')} »` },
  task_created: {
    icon: '➕',
    cls: 'muted',
    text: (p) => `tâche : ${String(p.title ?? short(p.taskId))}`,
  },
  task_ready: { icon: '◇', cls: 'muted', text: (p) => `tâche prête (${short(p.taskId)})` },
  task_assigned: {
    icon: '◈',
    cls: 'info',
    text: (p) => `${short(p.taskId)} → nœud ${short(p.nodeId)}`,
  },
  task_started: { icon: '▶', cls: 'run', text: (p) => `butinage démarré (${short(p.taskId)})` },
  task_progress: { icon: '⋯', cls: 'run', text: (p) => `progrès (${short(p.taskId)})` },
  task_readopted: { icon: '↺', cls: 'info', text: (p) => `ré-adoptée (${short(p.taskId)})` },
  task_done: {
    icon: '🍯',
    cls: 'done',
    text: (p) => `terminée (${short(p.taskId)}) en ${String(p.durationMs)} ms`,
  },
  task_retry: {
    icon: '🔁',
    cls: 'warn',
    text: (p) => `échec, essai ${String(p.attempt)}/${String(p.maxAttempts)} (${short(p.taskId)})`,
  },
  task_failed: { icon: '✘', cls: 'fail', text: (p) => `échouée (${short(p.taskId)})` },
  task_cancelled: { icon: '⊘', cls: 'warn', text: (p) => `annulée (${short(p.taskId)})` },
  task_requeued: { icon: '↩', cls: 'warn', text: (p) => `réaffectée (${short(p.taskId)})` },
  task_rejected: { icon: '⇄', cls: 'muted', text: (p) => `refusée (${short(p.taskId)})` },
  node_registered: {
    icon: '🐝',
    cls: 'info',
    text: (p) => `nouveau nœud : ${String(p.name ?? '')}`,
  },
  node_online: { icon: '🟢', cls: 'done', text: (p) => `nœud en ligne : ${String(p.name ?? '')}` },
  node_offline: {
    icon: '⚫',
    cls: 'fail',
    text: (p) => `nœud hors ligne : ${String(p.name ?? '')}`,
  },
  node_reconciled: { icon: '↺', cls: 'muted', text: () => `réconciliation` },
  result_ignored: { icon: '⊘', cls: 'muted', text: (p) => `résultat périmé (${short(p.taskId)})` },
  boot_recovery: {
    icon: '⟲',
    cls: 'info',
    text: (p) => `reprise : ${String(p.requeued)} tâche(s) requalifiée(s)`,
  },
};

export function Journal({ events }: { events: HiveEvent[] }) {
  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>Journal</h2>
        <span className="panel-count">{events.length}</span>
      </header>
      <ul className="journal">
        {[...events]
          .slice(-40)
          .reverse()
          .map((ev) => {
            const meta = EVENTS[ev.type] ?? {
              icon: '•',
              cls: 'muted',
              text: () => ev.type,
            };
            return (
              <li key={ev.id} className={`jrow ${meta.cls}`}>
                <span className="jicon">{meta.icon}</span>
                <span className="jtext">{meta.text(ev.payload)}</span>
                <time className="jtime">{new Date(ev.ts).toLocaleTimeString()}</time>
              </li>
            );
          })}
        {events.length === 0 && <li className="empty">En attente d’événements…</li>}
      </ul>
    </section>
  );
}
