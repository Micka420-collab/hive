import { SECRET_CAVIARDE, SECRET_DANS_TEXTE } from '../shared/caviardage.js';
import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import type { HiveEvent } from '../shared/types.js';

/**
 * Payload exposed by the Worker journal.
 *
 * The event store also contains agent logs, diffs and free-form prompts. They
 * are useful to the owner of a task, but they are not an audit detail and may
 * contain credentials. The Worker journal keeps only the bounded facts needed
 * to explain activity in Mission Control.
 */
export interface JournalOuvriere {
  id: number;
  ts: number;
  type: string;
  payload: Record<string, string | number | boolean>;
}

const TEXT_FIELDS = new Set([
  'taskId',
  'nodeId',
  'childTaskId',
  'parentTaskId',
  'rootTaskId',
  'resultId',
  'title',
  'outil',
  'chemin',
  'modele',
  'agentType',
  'reason',
  'motif',
  'error',
  'status',
  'branch',
  'source',
  'producteur',
  'producteurModele',
  'relecteur',
  'reviewerNodeId',
  'relecture',
  'decision',
  // `worker_usage` : ce qui a été mesuré de l'agent (`RessourcesExecution`).
  'portee',
]);

const NUMBER_FIELDS = new Set([
  'durationMs',
  // Les ressources de l'AGENT. Les compteurs d'avant (`userCpuMicros`…)
  // décrivaient le processus du nœud : ils ne sont plus projetés.
  'cpuMs',
  'picOctets',
  'releves',
  'attempt',
  'maxAttempts',
  'attempts',
  'recordedAt',
  'resultId',
]);

const BOOLEAN_FIELDS = new Set(['infra', 'conteste', 'applique', 'possible']);

function safeText(value: string): string {
  return champSurUneLigne(value, 240).replace(SECRET_DANS_TEXTE, SECRET_CAVIARDE);
}

function safeType(value: string): string {
  return /^[a-z0-9_:-]{1,80}$/i.test(value) ? value : 'worker_event';
}

/**
 * Projects a persisted event into the controlled Worker activity contract.
 * Unknown fields are deliberately omitted; future event types remain visible
 * by name without turning their payload into an unbounded log channel.
 */
export function projeterEvenementOuvriere(event: HiveEvent): JournalOuvriere {
  const payload: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event.payload ?? {})) {
    if (TEXT_FIELDS.has(key) && typeof value === 'string') {
      payload[key] = safeText(value);
      continue;
    }
    if (NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      payload[key] = Math.max(0, Math.trunc(value));
      continue;
    }
    if (BOOLEAN_FIELDS.has(key) && typeof value === 'boolean') payload[key] = value;
  }
  return { id: event.id, ts: event.ts, type: safeType(event.type), payload };
}

/** Projects newest-first events while preserving their order and bounded shape. */
export function projeterJournalOuvrier(events: readonly HiveEvent[]): JournalOuvriere[] {
  return events.map(projeterEvenementOuvriere);
}
