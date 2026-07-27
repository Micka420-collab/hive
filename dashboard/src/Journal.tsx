// Journal d'événements : flux temps réel, coloré et à icônes.

import type { HiveEvent } from '../../src/shared/types';
import { useT } from './i18n';
import type { Translate } from './i18n';
import { bandeText, formatDuree } from './ui';

interface Meta {
  icon: string;
  cls: string;
  // `t` injecté au rendu : pas de hook au niveau module.
  text: (p: Record<string, unknown>, t: Translate) => string;
}

const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 8) : '?');

/**
 * La Balance au journal. Le pèse-ruche n'a introduit AUCUN type d'événement :
 * il a rendu ÉCONOMIQUEMENT LISIBLES ceux qui existaient déjà, en ajoutant
 * `durationMs` aux payloads de `task_retry` et `task_failed` — jusque-là, un
 * échec ne disait pas ce qu'il avait coûté, et cette histoire était perdue
 * chaque jour un peu plus.
 *
 * Le champ est donc facultatif à l'affichage : absent des événements
 * journalisés AVANT ce lot (et de `no_working_agent` / `dependency_failed`, qui
 * n'ont aucune durée en main), il rend `null` et la ligne se lit exactement
 * comme avant — jamais un « 0 ms » inventé. Le texte reste reconstruit ici
 * depuis les champs typés du payload, comme tout le reste du journal.
 */
const cout = (v: unknown): string | null =>
  typeof v === 'number' && Number.isFinite(v) ? formatDuree(v) : null;

const EVENTS: Record<string, Meta> = {
  project_created: {
    icon: '📁',
    cls: 'info',
    text: (p, t) => t(`projet « ${String(p.name ?? '')} »`, `project “${String(p.name ?? '')}”`),
  },
  task_created: {
    icon: '➕',
    cls: 'muted',
    text: (p, t) =>
      t(
        `tâche : ${String(p.title ?? short(p.taskId))}`,
        `task: ${String(p.title ?? short(p.taskId))}`,
      ),
  },
  task_ready: {
    icon: '◇',
    cls: 'muted',
    text: (p, t) => t(`tâche prête (${short(p.taskId)})`, `task ready (${short(p.taskId)})`),
  },
  task_assigned: {
    icon: '◈',
    cls: 'info',
    text: (p, t) =>
      t(
        `${short(p.taskId)} → nœud ${short(p.nodeId)}`,
        `${short(p.taskId)} → node ${short(p.nodeId)}`,
      ),
  },
  task_started: {
    icon: '▶',
    cls: 'run',
    text: (p, t) =>
      t(`butinage démarré (${short(p.taskId)})`, `foraging started (${short(p.taskId)})`),
  },
  task_progress: {
    icon: '⋯',
    cls: 'run',
    text: (p, t) => t(`progrès (${short(p.taskId)})`, `progress (${short(p.taskId)})`),
  },
  task_readopted: {
    icon: '↺',
    cls: 'info',
    text: (p, t) => t(`ré-adoptée (${short(p.taskId)})`, `re-adopted (${short(p.taskId)})`),
  },
  task_done: {
    icon: '🍯',
    cls: 'done',
    text: (p, t) => {
      const ms = cout(p.durationMs);
      return ms === null
        ? t(`terminée (${short(p.taskId)})`, `done (${short(p.taskId)})`)
        : t(`terminée (${short(p.taskId)}) en ${ms}`, `done (${short(p.taskId)}) in ${ms}`);
    },
  },
  task_retry: {
    icon: '🔁',
    cls: 'warn',
    text: (p, t) => {
      const ms = cout(p.durationMs);
      const base = t(
        `échec, essai ${String(p.attempt)}/${String(p.maxAttempts)} (${short(p.taskId)})`,
        `failed, attempt ${String(p.attempt)}/${String(p.maxAttempts)} (${short(p.taskId)})`,
      );
      // Le temps que cette tentative a coûté : imputé en « reprise » par la
      // Balance dès que la tâche aboutit.
      return ms === null ? base : `${base} — ${t(`${ms} en reprise`, `${ms} of rework`)}`;
    },
  },
  task_failed: {
    icon: '✘',
    cls: 'fail',
    text: (p, t) => {
      const ms = cout(p.durationMs);
      const base = t(`échouée (${short(p.taskId)})`, `failed (${short(p.taskId)})`);
      // « coût : X » plutôt qu'un participe accordé : la durée est formatée
      // (« 1 h », « 4 h 12 min », « 340 ms ») et aucun accord français ne tient
      // sur toutes ces formes.
      return ms === null ? base : `${base} — ${t(`coût : ${ms}`, `cost: ${ms}`)}`;
    },
  },
  task_cancelled: {
    icon: '⊘',
    cls: 'warn',
    text: (p, t) => t(`annulée (${short(p.taskId)})`, `cancelled (${short(p.taskId)})`),
  },
  task_requeued: {
    icon: '↩',
    cls: 'warn',
    text: (p, t) => t(`réaffectée (${short(p.taskId)})`, `requeued (${short(p.taskId)})`),
  },
  task_rejected: {
    icon: '⇄',
    cls: 'muted',
    text: (p, t) => t(`refusée (${short(p.taskId)})`, `declined (${short(p.taskId)})`),
  },
  node_registered: {
    icon: '🐝',
    cls: 'info',
    text: (p, t) =>
      t(`nouveau nœud : ${String(p.name ?? '')}`, `new node: ${String(p.name ?? '')}`),
  },
  node_online: {
    icon: '🟢',
    cls: 'done',
    text: (p, t) =>
      t(`nœud en ligne : ${String(p.name ?? '')}`, `node online: ${String(p.name ?? '')}`),
  },
  node_offline: {
    icon: '⚫',
    cls: 'fail',
    text: (p, t) =>
      t(`nœud hors ligne : ${String(p.name ?? '')}`, `node offline: ${String(p.name ?? '')}`),
  },
  node_reconciled: {
    icon: '↺',
    cls: 'muted',
    text: (_p, t) => t('réconciliation', 'reconciliation'),
  },
  memory_recorded: {
    icon: '🧬',
    cls: 'muted',
    text: (p, t) =>
      t(`souvenir consigné (${short(p.taskId)})`, `memory recorded (${short(p.taskId)})`),
  },
  conflict_detected: {
    icon: '🛡️',
    cls: 'warn',
    text: (p, t) =>
      t(
        `conflit ${String(p.severity ?? '')} : ${short(p.a)} ↔ ${short(p.b)}`,
        `conflict ${String(p.severity ?? '')}: ${short(p.a)} ↔ ${short(p.b)}`,
      ),
  },
  task_conflict_deferred: {
    icon: '⏸',
    cls: 'warn',
    text: (p, t) =>
      t(
        `différée (conflit avec ${short(p.conflictsWith)})`,
        `deferred (conflicts with ${short(p.conflictsWith)})`,
      ),
  },
  result_ignored: {
    icon: '⊘',
    cls: 'muted',
    text: (p, t) => t(`résultat périmé (${short(p.taskId)})`, `stale result (${short(p.taskId)})`),
  },
  drone_race_started: {
    icon: '⚔',
    cls: 'info',
    text: (p, t) =>
      t(
        `course lancée : ${String(Array.isArray(p.drones) ? p.drones.length : p.factor)} drone(s) sur ${short(p.taskId)}`,
        `race started: ${String(Array.isArray(p.drones) ? p.drones.length : p.factor)} drone(s) on ${short(p.taskId)}`,
      ),
  },
  drone_won: {
    icon: '🏆',
    cls: 'done',
    text: (p, t) =>
      t(
        `course gagnée par ${short(p.nodeId)} (${short(p.taskId)})`,
        `race won by ${short(p.nodeId)} (${short(p.taskId)})`,
      ),
  },
  drone_cancelled: {
    icon: '⊘',
    cls: 'muted',
    text: (p, t) =>
      t(
        `drone annulé : ${short(p.nodeId)} (course tranchée)`,
        `drone cancelled: ${short(p.nodeId)} (race decided)`,
      ),
  },
  drone_failed: {
    icon: '🪂',
    cls: 'warn',
    text: (p, t) =>
      t(
        `drone tombé : ${short(p.nodeId)}, la course continue`,
        `drone down: ${short(p.nodeId)}, race goes on`,
      ),
  },
  drone_promoted: {
    icon: '⬆',
    cls: 'info',
    text: (p, t) =>
      t(
        `drone promu primaire : ${short(p.nodeId)} (${short(p.taskId)})`,
        `drone promoted to primary: ${short(p.nodeId)} (${short(p.taskId)})`,
      ),
  },
  drone_rejected: {
    icon: '⇄',
    cls: 'muted',
    text: (p, t) =>
      t(
        `drone a décliné : ${short(p.nodeId)} (${short(p.taskId)})`,
        `drone declined: ${short(p.nodeId)} (${short(p.taskId)})`,
      ),
  },
  drone_all_failed: {
    icon: '⚔',
    cls: 'fail',
    text: (p, t) =>
      t(
        `course perdue : tous les drones ont échoué (${short(p.taskId)})`,
        `race lost: every drone failed (${short(p.taskId)})`,
      ),
  },
  // Instinct de ruche : phéromones, thermorégulation, couveuse. Leur payload ne
  // porte QUE des faits typés — le texte bilingue est reconstruit ici, comme
  // pour tout le reste du journal (aucune phrase figée en base).
  pheromone_route: {
    icon: '🐜',
    cls: 'info',
    text: (p, t) => {
      // Le nom du nœud est joint au payload ; repli sur l'id abrégé pour les
      // événements journalisés avant son ajout.
      const noeud = typeof p.nodeName === 'string' ? p.nodeName : short(p.nodeId);
      return t(
        `phéromones : ${short(p.taskId)} → nœud ${noeud} (domaine ${String(p.domaine ?? '')})`,
        `pheromones: ${short(p.taskId)} → node ${noeud} (domain ${String(p.domaine ?? '')})`,
      );
    },
  },
  thermo_shift: {
    icon: '🌡️',
    cls: 'warn',
    text: (p, t) =>
      t(
        `thermorégulation : la ruche passe en ${bandeText(p.bande, t)} (${String(p.temperature ?? '?')}°) — concurrence ×${String(p.facteur ?? '?')}`,
        `thermoregulation: the hive shifts to ${bandeText(p.bande, t)} (${String(p.temperature ?? '?')}°) — concurrency ×${String(p.facteur ?? '?')}`,
      ),
  },
  brood_context: {
    icon: '👶',
    cls: 'info',
    text: (p, t) =>
      t(
        `couveuse : ${short(p.taskId)} repart avec les leçons de ${String(p.echecs ?? '?')} échec(s)`,
        `brood chamber: ${short(p.taskId)} restarts with the lessons of ${String(p.echecs ?? '?')} failure(s)`,
      ),
  },
  boot_recovery: {
    icon: '⟲',
    cls: 'info',
    text: (p, t) =>
      t(
        `reprise : ${String(p.requeued)} tâche(s) requalifiée(s)`,
        `recovery: ${String(p.requeued)} task(s) requeued`,
      ),
  },
};

export function Journal({ events }: { events: HiveEvent[] }) {
  const t = useT();
  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>{t('Journal', 'Journal')}</h2>
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
                <span className="jtext">{meta.text(ev.payload, t)}</span>
                <time className="jtime">{new Date(ev.ts).toLocaleTimeString()}</time>
              </li>
            );
          })}
        {events.length === 0 && (
          <li className="empty">{t('En attente d’événements…', 'Waiting for events…')}</li>
        )}
      </ul>
    </section>
  );
}
