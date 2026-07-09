// Ghost in the Hive (palier 4) — détection d'anomalies dans la ruche.
//
// « Un fantôme dans la ruche » : un nœud ou une tâche qui se comporte mal sans
// forcément tomber en panne franche. En repliant le journal d'événements (comme
// le Time-Lapse Replay et le Waggle Board), ce module repère des signaux faibles :
//   - flaky_node    : un nœud au taux d'échec anormalement élevé ;
//   - silent_node   : un nœud rejoint la ruche puis repart sans rien butiner ;
//   - looping_task  : une tâche qui rejoue/échoue en boucle ;
//   - rejecting_node: un nœud qui refuse beaucoup de tâches (capacité mal vue) ;
//   - infra_node    : pannes d'infrastructure répétées (auth/quota/tokens).
// But : donner à la Reine de quoi écarter proactivement un contributeur douteux
// AVANT qu'il ne pénalise le projet commun. Module PUR, déterministe, sans I/O.

import type { HiveEvent } from '../shared/types.js';

export type GhostKind =
  'flaky_node' | 'silent_node' | 'looping_task' | 'rejecting_node' | 'infra_node';

export type GhostSeverity = 'low' | 'medium' | 'high';

export interface Ghost {
  kind: GhostKind;
  /** nodeId ou taskId concerné. */
  target: string;
  severity: GhostSeverity;
  /** Explication lisible par un humain. */
  detail: string;
  /** Mesures ayant déclenché l'anomalie (transparence). */
  metrics: Record<string, number>;
}

export interface GhostReport {
  ghosts: Ghost[];
  scanned: { events: number; nodes: number; tasks: number };
}

// ─── Seuils de détection (documentés, ajustables) ────────────────────────────
/** En deçà de ce nombre de tentatives, un taux d'échec n'est pas significatif. */
const FLAKY_MIN_ATTEMPTS = 3;
/** Taux d'échec à partir duquel un nœud est « flaky ». */
const FLAKY_RATE = 0.5;
/** Taux d'échec au-delà duquel c'est grave. */
const FLAKY_RATE_HIGH = 0.75;
/** Nombre de retries d'une tâche à partir duquel elle « boucle ». */
const LOOP_RETRIES = 2;
/** Nombre de refus d'un nœud à partir duquel c'est anormal. */
const REJECT_THRESHOLD = 3;
const REJECT_HIGH = 6;
/** Nombre de pannes d'infra d'un nœud à partir duquel c'est grave. */
const INFRA_HIGH = 3;

interface NodeStat {
  nodeId: string;
  name: string;
  done: number;
  failed: number;
  rejected: number;
  infraRejects: number;
  offlineCount: number;
  timeouts: number;
}

interface TaskStat {
  taskId: string;
  retries: number;
  terminalFailed: boolean;
  attempts: number;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function ensureNode(map: Map<string, NodeStat>, nodeId: string): NodeStat {
  let s = map.get(nodeId);
  if (!s) {
    s = {
      nodeId,
      name: nodeId,
      done: 0,
      failed: 0,
      rejected: 0,
      infraRejects: 0,
      offlineCount: 0,
      timeouts: 0,
    };
    map.set(nodeId, s);
  }
  return s;
}

function ensureTask(map: Map<string, TaskStat>, taskId: string): TaskStat {
  let s = map.get(taskId);
  if (!s) {
    s = { taskId, retries: 0, terminalFailed: false, attempts: 0 };
    map.set(taskId, s);
  }
  return s;
}

const SEVERITY_RANK: Record<GhostSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Analyse le journal et retourne les anomalies détectées, triées par gravité
 * décroissante (puis par type et cible, pour un ordre stable). Repli tolérant :
 * un type d'événement inconnu est simplement ignoré.
 */
export function detectGhosts(events: HiveEvent[]): GhostReport {
  const nodes = new Map<string, NodeStat>();
  const tasks = new Map<string, TaskStat>();

  for (const event of events) {
    const p = event.payload ?? {};
    const nodeId = str(p, 'nodeId');
    const taskId = str(p, 'taskId');
    switch (event.type) {
      case 'node_registered':
      case 'node_online': {
        if (nodeId) ensureNode(nodes, nodeId).name = str(p, 'name') ?? nodeId;
        break;
      }
      case 'node_offline': {
        if (nodeId) {
          const s = ensureNode(nodes, nodeId);
          s.offlineCount += 1;
          if (str(p, 'reason') === 'heartbeat_timeout') s.timeouts += 1;
        }
        break;
      }
      case 'task_done': {
        if (nodeId) ensureNode(nodes, nodeId).done += 1;
        break;
      }
      case 'task_failed': {
        // Échec imputable à un nœud (pas les dépendances) + trace au niveau tâche.
        if (nodeId) ensureNode(nodes, nodeId).failed += 1;
        if (taskId) {
          const t = ensureTask(tasks, taskId);
          t.terminalFailed = true;
          t.attempts = Math.max(t.attempts, num(p, 'attempts'));
        }
        break;
      }
      case 'task_retry': {
        if (taskId) ensureTask(tasks, taskId).retries += 1;
        break;
      }
      case 'task_rejected': {
        if (nodeId) {
          const s = ensureNode(nodes, nodeId);
          // Le champ `infra` n'existe que si le token-failover est actif : lu de
          // façon défensive (absent ⇒ refus « ordinaire »).
          if (p['infra'] === true) s.infraRejects += 1;
          else s.rejected += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  const ghosts: Ghost[] = [];

  for (const s of nodes.values()) {
    const attempts = s.done + s.failed;
    const failRate = attempts === 0 ? 0 : s.failed / attempts;
    if (attempts >= FLAKY_MIN_ATTEMPTS && failRate >= FLAKY_RATE) {
      ghosts.push({
        kind: 'flaky_node',
        target: s.nodeId,
        severity: failRate >= FLAKY_RATE_HIGH ? 'high' : 'medium',
        detail: `${s.name} échoue ${Math.round(failRate * 100)}% du temps (${s.failed}/${attempts}).`,
        metrics: { done: s.done, failed: s.failed, failRatePct: Math.round(failRate * 100) },
      });
    }
    // Silencieux : a été vu partir (offline) sans jamais rien butiner ni tenter.
    if (s.done === 0 && s.failed === 0 && s.rejected === 0 && s.offlineCount > 0) {
      ghosts.push({
        kind: 'silent_node',
        target: s.nodeId,
        severity: s.timeouts > 0 ? 'medium' : 'low',
        detail: `${s.name} a rejoint la ruche puis est reparti sans butiner aucune tâche.`,
        metrics: { offlineCount: s.offlineCount, timeouts: s.timeouts },
      });
    }
    if (s.rejected >= REJECT_THRESHOLD) {
      ghosts.push({
        kind: 'rejecting_node',
        target: s.nodeId,
        severity: s.rejected >= REJECT_HIGH ? 'high' : 'medium',
        detail: `${s.name} a refusé ${s.rejected} tâches (capacité mal évaluée ?).`,
        metrics: { rejected: s.rejected },
      });
    }
    if (s.infraRejects > 0) {
      ghosts.push({
        kind: 'infra_node',
        target: s.nodeId,
        severity: s.infraRejects >= INFRA_HIGH ? 'high' : 'medium',
        detail: `${s.name} a subi ${s.infraRejects} panne(s) d'infrastructure (auth/quota/tokens).`,
        metrics: { infraRejects: s.infraRejects },
      });
    }
  }

  for (const t of tasks.values()) {
    if (t.terminalFailed || t.retries >= LOOP_RETRIES) {
      ghosts.push({
        kind: 'looping_task',
        target: t.taskId,
        severity: t.terminalFailed ? 'high' : 'medium',
        detail: t.terminalFailed
          ? `Tâche ${t.taskId} a échoué définitivement après ${t.retries} reprise(s).`
          : `Tâche ${t.taskId} a rejoué ${t.retries} fois sans aboutir.`,
        metrics: { retries: t.retries, attempts: t.attempts },
      });
    }
  }

  ghosts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.kind.localeCompare(b.kind) ||
      a.target.localeCompare(b.target),
  );

  return {
    ghosts,
    scanned: { events: events.length, nodes: nodes.size, tasks: tasks.size },
  };
}
