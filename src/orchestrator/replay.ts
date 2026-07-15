// Time-Lapse Replay (palier 3) : rejouer le journal d'événements pour reconstruire
// l'état de la ruche à n'importe quel instant passé, et en dériver une frise
// chronologique « accélérée » (une image par événement).
//
// Le cœur est un RÉDUCTEUR PUR : `applyEvent(state, event)` replie un événement
// sur un état immuable en entrée. Aucune dépendance (ni base, ni réseau) — donc
// testable et réutilisable côté dashboard comme côté serveur. Le journal est la
// source de vérité : l'état courant du store n'est qu'un `reduce` de tous les
// événements depuis le début. Rejouer un préfixe du journal = remonter le temps.

import type { HiveEvent, TaskStatus } from '../shared/types.js';

/** Nœud reconstruit à un instant T (sous-ensemble suffisant pour la frise). */
export interface ReplayNode {
  id: string;
  name: string;
  status: 'online' | 'offline';
}

/** Tâche reconstruite à un instant T. */
export interface ReplayTask {
  id: string;
  title: string;
  status: TaskStatus;
  nodeId: string | null;
  attempts: number;
}

/** État complet de la ruche reconstruit à un instant T. */
export interface ReplayState {
  projects: Map<string, string>; // id → nom
  nodes: Map<string, ReplayNode>;
  tasks: Map<string, ReplayTask>;
}

/** Comptage des tâches par statut — utile pour une frise compacte. */
export type TaskCounts = Record<TaskStatus, number>;

/** Une image de la frise : l'état résumé APRÈS application de l'événement `eventId`. */
export interface ReplayFrame {
  eventId: number;
  ts: number;
  type: string;
  projects: number;
  nodesOnline: number;
  nodesTotal: number;
  tasks: TaskCounts;
}

/** Résultat complet d'un rejeu : la frise + un résumé de l'état final. */
export interface ReplayResult {
  frames: ReplayFrame[];
  finalCounts: ReplayFrame | null;
  lastEventId: number;
  eventCount: number;
}

const TASK_STATUSES: TaskStatus[] = ['pending', 'ready', 'assigned', 'running', 'done', 'failed'];

/** État vide de départ (ruche jamais démarrée). */
export function initialReplayState(): ReplayState {
  return { projects: new Map(), nodes: new Map(), tasks: new Map() };
}

/** Lecture typée et défensive d'un champ chaîne du payload (journal = données brutes). */
function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Fait passer une tâche existante à un nouveau statut (no-op si tâche inconnue). */
function setTaskStatus(
  state: ReplayState,
  taskId: string | null,
  status: TaskStatus,
  nodeId: string | null | undefined = undefined,
): void {
  if (!taskId) return;
  const task = state.tasks.get(taskId);
  if (!task) return;
  task.status = status;
  if (nodeId !== undefined) task.nodeId = nodeId;
}

/**
 * Replie UN événement sur l'état. Mute l'état passé (les collections sont des
 * Map internes au rejeu) et le retourne pour permettre un `reduce`. Les types
 * d'événements inconnus ou purement informatifs (boot_recovery, node_reconciled,
 * result_ignored, task_progress, task_rejected…) ne changent pas l'état
 * reconstruit : ils sont ignorés sans erreur (tolérance aux versions futures).
 */
export function applyEvent(state: ReplayState, event: HiveEvent): ReplayState {
  const p = event.payload ?? {};
  const taskId = str(p, 'taskId');
  const nodeId = str(p, 'nodeId');

  switch (event.type) {
    case 'project_created': {
      const id = str(p, 'projectId');
      if (id) state.projects.set(id, str(p, 'name') ?? id);
      break;
    }

    case 'task_created': {
      if (taskId) {
        state.tasks.set(taskId, {
          id: taskId,
          title: str(p, 'title') ?? taskId,
          status: 'pending',
          nodeId: null,
          attempts: 0,
        });
      }
      break;
    }
    case 'task_ready':
      setTaskStatus(state, taskId, 'ready', null);
      break;
    case 'task_assigned':
      setTaskStatus(state, taskId, 'assigned', nodeId);
      break;
    case 'task_started':
    case 'task_readopted':
      setTaskStatus(state, taskId, 'running', nodeId);
      break;
    // Drone Wars : le primaire promu porte la tâche (assigned jusqu'à son
    // prochain task_update — le replay le montre repris par le nouveau nœud).
    case 'drone_promoted':
      setTaskStatus(state, taskId, 'assigned', nodeId);
      break;
    case 'task_done':
      setTaskStatus(state, taskId, 'done', nodeId);
      break;
    case 'task_failed':
      setTaskStatus(state, taskId, 'failed');
      break;
    case 'task_retry':
    case 'task_requeued': {
      // Retour en file : la tâche redevient à faire et perd son nœud. On compte
      // une tentative supplémentaire sur un vrai retry.
      const task = taskId ? state.tasks.get(taskId) : undefined;
      if (task) {
        task.status = 'pending';
        task.nodeId = null;
        if (event.type === 'task_retry') task.attempts += 1;
      }
      break;
    }
    case 'task_cancelled':
      // Pas de statut « cancelled » dans le modèle : une tâche annulée quitte le
      // circuit actif — on la reconstruit comme « failed » (terminale) pour la frise.
      setTaskStatus(state, taskId, 'failed', null);
      break;

    case 'node_registered':
    case 'node_online': {
      if (nodeId) {
        state.nodes.set(nodeId, {
          id: nodeId,
          name: str(p, 'name') ?? nodeId,
          status: 'online',
        });
      }
      break;
    }
    case 'node_offline': {
      if (nodeId) {
        const node = state.nodes.get(nodeId);
        if (node) node.status = 'offline';
        else
          state.nodes.set(nodeId, {
            id: nodeId,
            name: str(p, 'name') ?? nodeId,
            status: 'offline',
          });
      }
      break;
    }

    default:
      // Événement informatif ou inconnu : aucun effet sur l'état reconstruit.
      break;
  }
  return state;
}

/** Compte les tâches par statut dans l'état reconstruit. */
export function countTasks(state: ReplayState): TaskCounts {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as TaskCounts;
  for (const task of state.tasks.values()) counts[task.status] += 1;
  return counts;
}

/** Résumé (frame) de l'état reconstruit, étiqueté par le dernier événement appliqué. */
function frameFrom(state: ReplayState, event: HiveEvent): ReplayFrame {
  let online = 0;
  for (const node of state.nodes.values()) if (node.status === 'online') online += 1;
  return {
    eventId: event.id,
    ts: event.ts,
    type: event.type,
    projects: state.projects.size,
    nodesOnline: online,
    nodesTotal: state.nodes.size,
    tasks: countTasks(state),
  };
}

/**
 * Reconstruit l'état complet de la ruche APRÈS avoir rejoué tous les événements
 * dont l'id est ≤ `uptoId` (par défaut : tous). Les événements doivent être
 * triés par id croissant (comme les renvoie le store).
 */
export function reconstructAt(events: HiveEvent[], uptoId = Infinity): ReplayState {
  const state = initialReplayState();
  for (const event of events) {
    if (event.id > uptoId) break;
    applyEvent(state, event);
  }
  return state;
}

/**
 * Construit la frise chronologique : une frame par événement, chacune résumant
 * l'état de la ruche juste après cet événement. C'est la donnée qu'un lecteur
 * « time-lapse » fait défiler pour voir la ruche se remplir, butiner puis finir.
 */
export function buildTimeline(events: HiveEvent[]): ReplayResult {
  const state = initialReplayState();
  const frames: ReplayFrame[] = [];
  for (const event of events) {
    applyEvent(state, event);
    frames.push(frameFrom(state, event));
  }
  return {
    frames,
    finalCounts: frames.length > 0 ? (frames[frames.length - 1] ?? null) : null,
    lastEventId: events.length > 0 ? (events[events.length - 1]?.id ?? 0) : 0,
    eventCount: events.length,
  };
}
