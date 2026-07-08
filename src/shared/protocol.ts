// Protocole WebSocket typé entre nœuds, dashboard et orchestrateur.
// Chaque message entrant est validé champ par champ — jamais de confiance aveugle.

import type { HiveEvent, StateSnapshot, SubAgent, Task } from './types.js';

// ─── Limites de taille (validation d'entrée) ─────────────────────────────────
export const LIMITS = {
  /** Taille max d'un message WS — alignée sur maxPayload du serveur ws. */
  message: 2 * 1024 * 1024,
  name: 120,
  token: 256,
  id: 64,
  title: 200,
  prompt: 100_000,
  log: 512 * 1024,
  diff: 1024 * 1024,
  subAgents: 32,
  maxConcurrency: 16,
} as const;

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ─── Messages client → orchestrateur ─────────────────────────────────────────
export interface RegisterMsg {
  type: 'register';
  token: string;
  name: string;
  ownerName: string;
  agentType: string;
  maxConcurrency: number;
  /** Présent lors d'une reconnexion, pour conserver l'identité du nœud. */
  nodeId?: string;
}

export interface HeartbeatMsg {
  type: 'heartbeat';
  /** Nombre de tâches en cours côté nœud (informatif). */
  running: number;
}

export interface TaskUpdateMsg {
  type: 'task_update';
  taskId: string;
  status: 'running';
  subAgents?: SubAgent[];
  log?: string;
}

export interface TaskResultMsg {
  type: 'task_result';
  taskId: string;
  success: boolean;
  diff: string;
  logs: string;
  durationMs: number;
  subAgents: SubAgent[];
}

export interface SubscribeMsg {
  type: 'subscribe';
  token: string;
}

export type ClientMessage =
  | RegisterMsg
  | HeartbeatMsg
  | TaskUpdateMsg
  | TaskResultMsg
  | SubscribeMsg;

// ─── Messages orchestrateur → client ─────────────────────────────────────────
export interface RegisteredMsg {
  type: 'registered';
  nodeId: string;
}

export interface AssignTaskMsg {
  type: 'assign_task';
  task: Task;
  /** Dépôt du projet à cloner côté nœud (null : workspace vierge sans git). */
  repoUrl?: string | null;
}

export interface CancelTaskMsg {
  type: 'cancel_task';
  taskId: string;
  reason: string;
}

export interface StateMsg {
  type: 'state';
  snapshot: StateSnapshot;
}

export interface EventMsg {
  type: 'event';
  event: HiveEvent;
}

export interface ErrorMsg {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | RegisteredMsg
  | AssignTaskMsg
  | CancelTaskMsg
  | StateMsg
  | EventMsg
  | ErrorMsg;

const SERVER_MESSAGE_TYPES = new Set([
  'registered',
  'assign_task',
  'cancel_task',
  'state',
  'event',
  'error',
]);

// ─── Validation ──────────────────────────────────────────────────────────────
function isStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function isStrAllowEmpty(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

function isSubAgents(v: unknown): v is SubAgent[] {
  if (!Array.isArray(v) || v.length > LIMITS.subAgents) return false;
  return v.every((s) => {
    if (typeof s !== 'object' || s === null) return false;
    const sa = s as Record<string, unknown>;
    return (
      isId(sa.id) &&
      isStr(sa.name, LIMITS.name) &&
      (sa.status === 'running' || sa.status === 'done' || sa.status === 'failed')
    );
  });
}

/**
 * Analyse et valide un message entrant côté orchestrateur.
 * Retourne null si le message est invalide (il sera ignoré et la connexion fermée).
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.message) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;

  switch (m.type) {
    case 'register': {
      if (
        isStr(m.token, LIMITS.token) &&
        isStr(m.name, LIMITS.name) &&
        isStr(m.ownerName, LIMITS.name) &&
        isStr(m.agentType, LIMITS.name) &&
        isInt(m.maxConcurrency, 1, LIMITS.maxConcurrency) &&
        (m.nodeId === undefined || isId(m.nodeId))
      ) {
        const msg: RegisterMsg = {
          type: 'register',
          token: m.token,
          name: m.name,
          ownerName: m.ownerName,
          agentType: m.agentType,
          maxConcurrency: m.maxConcurrency,
        };
        if (m.nodeId !== undefined) msg.nodeId = m.nodeId as string;
        return msg;
      }
      return null;
    }
    case 'heartbeat': {
      if (isInt(m.running, 0, 10_000)) return { type: 'heartbeat', running: m.running };
      return null;
    }
    case 'task_update': {
      if (
        isId(m.taskId) &&
        m.status === 'running' &&
        (m.subAgents === undefined || isSubAgents(m.subAgents)) &&
        (m.log === undefined || isStrAllowEmpty(m.log, LIMITS.log))
      ) {
        const msg: TaskUpdateMsg = { type: 'task_update', taskId: m.taskId, status: 'running' };
        if (m.subAgents !== undefined) msg.subAgents = m.subAgents as SubAgent[];
        if (m.log !== undefined) msg.log = m.log as string;
        return msg;
      }
      return null;
    }
    case 'task_result': {
      if (
        isId(m.taskId) &&
        typeof m.success === 'boolean' &&
        isStrAllowEmpty(m.diff, LIMITS.diff) &&
        isStrAllowEmpty(m.logs, LIMITS.log) &&
        isInt(m.durationMs, 0, 86_400_000) &&
        isSubAgents(m.subAgents)
      ) {
        return {
          type: 'task_result',
          taskId: m.taskId,
          success: m.success,
          diff: m.diff,
          logs: m.logs,
          durationMs: m.durationMs,
          subAgents: m.subAgents,
        };
      }
      return null;
    }
    case 'subscribe': {
      if (isStr(m.token, LIMITS.token)) return { type: 'subscribe', token: m.token };
      return null;
    }
    default:
      return null;
  }
}

/**
 * Analyse un message venant de l'orchestrateur côté client (nœud ou dashboard).
 * Le hub est authentifié par le token : validation structurelle légère seulement.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.message) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  if (typeof m.type !== 'string' || !SERVER_MESSAGE_TYPES.has(m.type)) return null;
  return data as ServerMessage;
}
