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
  /** Contexte Hive Mind joint à une assignation (borné : injecté dans le prompt). */
  hiveContext: 8_000,
  /** Nombre max de diffs joints à un merge. */
  mergeDiffs: 200,
  /** Nombre max d'arguments d'une commande de test, et longueur de chaque. */
  testArgs: 32,
  arg: 1_000,
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
  /** Tâches réellement en cours côté nœud, pour réconciliation à la reconnexion. */
  activeTasks?: string[];
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

/**
 * Refus d'une assignation (nœud saturé, id invalide) : la tâche est requalifiée
 * SANS consommer de tentative — contrairement à un task_result en échec.
 */
export interface TaskRejectMsg {
  type: 'task_reject';
  taskId: string;
  reason: string;
}

export interface SubscribeMsg {
  type: 'subscribe';
  token: string;
}

/** Conflit signalé lors d'un merge (un diff qui ne s'applique pas proprement). */
export interface MergeConflictReport {
  taskId: string;
  reason: string;
}

/** Résultat d'un merge exécuté par un nœud (Honeycomb Merge, Palier 3). */
export interface MergeResultMsg {
  type: 'merge_result';
  mergeId: string;
  applied: string[];
  conflicts: MergeConflictReport[];
  mergedDiff: string;
  testsRun: boolean;
  testsPassed: boolean | null;
  logs: string;
}

export type ClientMessage =
  | RegisterMsg
  | HeartbeatMsg
  | TaskUpdateMsg
  | TaskResultMsg
  | TaskRejectMsg
  | SubscribeMsg
  | MergeResultMsg;

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
  /** Contexte Hive Mind (souvenirs pertinents) à préfixer au prompt de la tâche. */
  hiveContext?: string;
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

/** Un diff de tâche à intégrer lors d'un merge. */
export interface MergeDiffInput {
  taskId: string;
  diff: string;
}

/** Demande de merge envoyée à un nœud (Honeycomb Merge, Palier 3). */
export interface AssignMergeMsg {
  type: 'assign_merge';
  mergeId: string;
  /** Dépôt à cloner pour l'intégration. */
  repoUrl: string;
  /** Diffs des tâches, dans l'ordre de merge. */
  diffs: MergeDiffInput[];
  /** Commande de test optionnelle (argv, jamais interprétée par un shell). */
  testCommand?: string[];
}

export type ServerMessage =
  RegisteredMsg | AssignTaskMsg | CancelTaskMsg | StateMsg | EventMsg | ErrorMsg | AssignMergeMsg;

const SERVER_MESSAGE_TYPES = new Set([
  'registered',
  'assign_task',
  'cancel_task',
  'state',
  'event',
  'error',
  'assign_merge',
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

/** Liste d'identifiants de tâches (bornée), tolérant l'absence. */
function isIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 1000 && v.every((x) => isId(x));
}

/** Diffs joints à un merge : liste non vide bornée de { taskId, diff }. */
function isMergeDiffs(v: unknown): v is MergeDiffInput[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.mergeDiffs) return false;
  return v.every((d) => {
    if (typeof d !== 'object' || d === null) return false;
    const dd = d as Record<string, unknown>;
    return isId(dd.taskId) && isStrAllowEmpty(dd.diff, LIMITS.diff);
  });
}

/** Rapports de conflits d'un merge : liste bornée de { taskId, reason }. */
function isMergeConflicts(v: unknown): v is MergeConflictReport[] {
  if (!Array.isArray(v) || v.length > LIMITS.mergeDiffs) return false;
  return v.every((c) => {
    if (typeof c !== 'object' || c === null) return false;
    const cc = c as Record<string, unknown>;
    return isId(cc.taskId) && isStrAllowEmpty(cc.reason, LIMITS.arg);
  });
}

/** Commande (argv) : liste non vide et bornée de chaînes courtes non vides. */
function isArgv(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= LIMITS.testArgs &&
    v.every((s) => isStr(s, LIMITS.arg))
  );
}

/** Statut de tâche connu — utilisé pour valider un objet Task reçu du hub. */
const TASK_STATUSES = new Set(['pending', 'ready', 'assigned', 'running', 'done', 'failed']);

/**
 * Valide un objet Task reçu du hub avant de l'utiliser côté nœud. Le nœud ne
 * fait PAS confiance aveuglément à l'orchestrateur : task.id sert à construire
 * des chemins locaux (anti path-traversal), et branch/prompt/title sont bornés.
 */
export function isValidTask(v: unknown): v is Task {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    isId(t.id) &&
    isId(t.projectId) &&
    isStr(t.title, LIMITS.title) &&
    isStrAllowEmpty(t.prompt, LIMITS.prompt) &&
    typeof t.status === 'string' &&
    TASK_STATUSES.has(t.status) &&
    isIdList(t.dependsOn) &&
    (t.assignedNodeId === null || isId(t.assignedNodeId)) &&
    (t.branch === null || (typeof t.branch === 'string' && t.branch.length <= LIMITS.name)) &&
    isInt(t.attempts, 0, 1_000_000)
  );
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
        if (m.activeTasks !== undefined) {
          if (!isIdList(m.activeTasks)) return null;
          msg.activeTasks = m.activeTasks;
        }
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
    case 'task_reject': {
      if (isId(m.taskId) && isStr(m.reason, LIMITS.name)) {
        return { type: 'task_reject', taskId: m.taskId, reason: m.reason };
      }
      return null;
    }
    case 'subscribe': {
      if (isStr(m.token, LIMITS.token)) return { type: 'subscribe', token: m.token };
      return null;
    }
    case 'merge_result': {
      if (
        isId(m.mergeId) &&
        isIdList(m.applied) &&
        isMergeConflicts(m.conflicts) &&
        isStrAllowEmpty(m.mergedDiff, LIMITS.diff) &&
        typeof m.testsRun === 'boolean' &&
        (m.testsPassed === null || typeof m.testsPassed === 'boolean') &&
        isStrAllowEmpty(m.logs, LIMITS.log)
      ) {
        return {
          type: 'merge_result',
          mergeId: m.mergeId,
          applied: m.applied,
          conflicts: m.conflicts as MergeConflictReport[],
          mergedDiff: m.mergedDiff,
          testsRun: m.testsRun,
          testsPassed: m.testsPassed as boolean | null,
          logs: m.logs,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Analyse et valide un message venant de l'orchestrateur (côté nœud ou dashboard).
 *
 * Le nœud ne fait PAS confiance aveuglément au hub : le token authentifie le
 * client VERS le hub, pas l'inverse, et le transport peut être un ws:// en clair
 * (MITM possible). Les messages `assign_task`/`cancel_task` — qui pilotent la
 * création de répertoires et le clonage de dépôts — sont donc validés champ par
 * champ, symétriquement à parseClientMessage. `state`/`event` (dashboard, lecture
 * seule) ne sont pas déstructurés en profondeur.
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

  switch (m.type) {
    case 'registered':
      return isId(m.nodeId) ? { type: 'registered', nodeId: m.nodeId } : null;
    case 'assign_task': {
      if (!isValidTask(m.task)) return null;
      if (m.repoUrl !== undefined && m.repoUrl !== null && !isValidRepoUrl(m.repoUrl)) return null;
      if (m.hiveContext !== undefined && !isStrAllowEmpty(m.hiveContext, LIMITS.hiveContext)) {
        return null;
      }
      const msg: AssignTaskMsg = { type: 'assign_task', task: m.task };
      if (m.repoUrl !== undefined) msg.repoUrl = (m.repoUrl as string | null) ?? null;
      if (m.hiveContext !== undefined) msg.hiveContext = m.hiveContext;
      return msg;
    }
    case 'cancel_task':
      return isId(m.taskId) && isStrAllowEmpty(m.reason, LIMITS.name)
        ? { type: 'cancel_task', taskId: m.taskId, reason: m.reason }
        : null;
    case 'assign_merge': {
      // Sensible côté nœud : déclenche un clone + application de patches + tests.
      // Validé champ par champ, comme assign_task.
      if (
        isId(m.mergeId) &&
        isValidRepoUrl(m.repoUrl) &&
        isMergeDiffs(m.diffs) &&
        (m.testCommand === undefined || isArgv(m.testCommand))
      ) {
        const msg: AssignMergeMsg = {
          type: 'assign_merge',
          mergeId: m.mergeId,
          repoUrl: m.repoUrl,
          diffs: m.diffs as MergeDiffInput[],
        };
        if (m.testCommand !== undefined) msg.testCommand = m.testCommand as string[];
        return msg;
      }
      return null;
    }
    default:
      // state / event / error : destinés au dashboard, non sensibles côté nœud.
      return data as ServerMessage;
  }
}

/**
 * Valide un repoUrl : uniquement des schémas de transport sûrs. Bloque le
 * transport `ext::` de git (exécution de commande arbitraire = RCE) et les URL
 * commençant par « - » (injection d'argument dans git clone).
 */
export function isValidRepoUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 500) return false;
  if (v.startsWith('-')) return false;
  // http(s), git, ssh, ou chemin local absolu (démo/tests) — jamais ext::, file::, etc.
  return (
    /^https?:\/\//.test(v) ||
    /^git:\/\//.test(v) ||
    /^ssh:\/\//.test(v) ||
    /^git@[\w.-]+:/.test(v) ||
    /^[A-Za-z]:[\\/]/.test(v) || // chemin Windows (C:\...)
    /^\//.test(v) // chemin POSIX absolu
  );
}
