// Le cœur de la ruche : promotion des tâches selon leurs dépendances,
// assignation aux nœuds disponibles, reap des nœuds morts, retries et
// idempotence des résultats. Aucune I/O réseau ici — tout est testable
// unitairement avec un store en mémoire.

import { MAX_ATTEMPTS, NODE_TIMEOUT_MS } from '../shared/types.js';
import type { HiveEvent, HiveNode, SubAgent, Task, TaskResult } from '../shared/types.js';
import type { HiveStore, NodeProfile } from './store.js';

export interface SchedulerOptions {
  maxAttempts?: number;
  nodeTimeoutMs?: number;
  /** Appelé quand une tâche est assignée — le serveur pousse alors `assign_task` au nœud. */
  onAssign?: (nodeId: string, task: Task) => void;
  /** Appelé pour chaque événement journalisé — le serveur le diffuse au dashboard. */
  onEvent?: (event: HiveEvent) => void;
}

export class Scheduler {
  private readonly maxAttempts: number;
  private readonly nodeTimeoutMs: number;

  constructor(
    private readonly store: HiveStore,
    private readonly opts: SchedulerOptions = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.nodeTimeoutMs = opts.nodeTimeoutMs ?? NODE_TIMEOUT_MS;
  }

  /** Journalise la transition et la propage (dashboard, logs). */
  private emit(type: string, payload: Record<string, unknown>): void {
    const event = this.store.appendEvent(type, payload);
    this.opts.onEvent?.(event);
  }

  /** À appeler une fois au démarrage : requalifie les tâches orphelines d'un crash. */
  recoverAtBoot(): void {
    const orphans = this.store.recoverOrphanTasks();
    for (const t of orphans) {
      this.emit('task_requeued', { taskId: t.id, reason: 'boot_recovery' });
    }
    if (orphans.length > 0) this.emit('boot_recovery', { requeued: orphans.length });
  }

  /** Tick périodique : reap des nœuds morts → promotion → assignation. */
  tick(now = Date.now()): void {
    this.reapDeadNodes(now);
    this.promoteAndAssign(now);
  }

  /**
   * Enregistre le nœud SANS assigner de tâche : l'appelant doit d'abord
   * brancher le canal de livraison (socket WS), puis appeler tick().
   */
  registerNode(profile: NodeProfile, now = Date.now()): HiveNode {
    const known = profile.nodeId ? this.store.getNode(profile.nodeId) : undefined;
    const node = this.store.registerNode(profile, now);
    this.emit(known ? 'node_online' : 'node_registered', {
      nodeId: node.id,
      name: node.name,
      agentType: node.agentType,
    });
    return node;
  }

  /**
   * Tâches assignées restées muettes (pas de task_update) au-delà de `ageMs` :
   * candidates à une re-livraison de `assign_task` (message perdu en vol).
   */
  staleAssignedTasks(ageMs: number, now = Date.now()): Task[] {
    return this.store.tasksByStatus('assigned').filter((t) => now - t.updatedAt > ageMs);
  }

  /** Heartbeat découplé de la demande de tâche : il ne fait que prouver la vie du nœud. */
  heartbeat(nodeId: string, now = Date.now()): void {
    const node = this.store.getNode(nodeId);
    if (!node) return;
    this.store.touchNode(nodeId, now);
    if (node.status === 'offline') {
      this.store.setNodeStatus(nodeId, 'online');
      this.emit('node_online', { nodeId, name: node.name });
      this.promoteAndAssign(now);
    }
  }

  /** Déconnexion (WS fermé) ou heartbeat expiré : offline + réaffectation des tâches actives. */
  nodeDisconnected(nodeId: string, reason: string, now = Date.now()): void {
    const node = this.store.getNode(nodeId);
    if (!node || node.status === 'offline') return;
    this.store.setNodeStatus(nodeId, 'offline');
    this.emit('node_offline', { nodeId, name: node.name, reason });
    for (const task of this.store.activeTasksOfNode(nodeId)) {
      this.store.patchTask(task.id, { status: 'ready', assignedNodeId: null }, now);
      this.emit('task_requeued', { taskId: task.id, nodeId, reason });
    }
    this.promoteAndAssign(now);
  }

  /** Le nœud confirme le démarrage effectif (assigned → running) et le progrès des sous-agents. */
  handleTaskUpdate(nodeId: string, taskId: string, subAgents?: SubAgent[], log?: string): void {
    const task = this.store.getTask(taskId);
    // Mise à jour pour une tâche inconnue ou réaffectée ailleurs : ignorée.
    if (!task || task.assignedNodeId !== nodeId) return;
    if (task.status !== 'assigned' && task.status !== 'running') return;
    if (task.status === 'assigned') {
      this.store.patchTask(taskId, { status: 'running' });
      this.emit('task_started', { taskId, nodeId });
    }
    if (subAgents && subAgents.length > 0) {
      this.emit('task_progress', {
        taskId,
        nodeId,
        subAgents,
        ...(log ? { log: log.slice(0, 2000) } : {}),
      });
    }
  }

  /**
   * Résultat remonté par un nœud. Idempotence : un résultat pour une tâche
   * réaffectée, requalifiée ou déjà terminée est ignoré (et journalisé).
   */
  handleTaskResult(nodeId: string, result: Omit<TaskResult, 'nodeId'>): boolean {
    const task = this.store.getTask(result.taskId);
    if (!task) {
      this.emit('result_ignored', { taskId: result.taskId, nodeId, reason: 'unknown_task' });
      return false;
    }
    const active = task.status === 'assigned' || task.status === 'running';
    if (!active || task.assignedNodeId !== nodeId) {
      this.emit('result_ignored', {
        taskId: task.id,
        nodeId,
        reason: 'stale_assignment',
        status: task.status,
      });
      return false;
    }

    this.store.insertResult({ ...result, nodeId });

    if (result.success) {
      this.store.patchTask(task.id, {
        status: 'done',
        result: { success: true, nodeId, durationMs: result.durationMs },
      });
      this.emit('task_done', { taskId: task.id, nodeId, durationMs: result.durationMs });
    } else {
      const attempts = task.attempts + 1;
      if (attempts >= this.maxAttempts) {
        this.store.patchTask(task.id, {
          status: 'failed',
          attempts,
          assignedNodeId: null,
          result: { success: false, nodeId, durationMs: result.durationMs },
        });
        this.emit('task_failed', { taskId: task.id, nodeId, attempts });
      } else {
        // Échec → réessai : la tâche repart en ready, une autre ouvrière la prendra.
        this.store.patchTask(task.id, { status: 'ready', attempts, assignedNodeId: null });
        this.emit('task_retry', {
          taskId: task.id,
          nodeId,
          attempt: attempts,
          maxAttempts: this.maxAttempts,
        });
      }
    }
    this.promoteAndAssign();
    return true;
  }

  // ─── Interne ───────────────────────────────────────────────────────────────
  private promoteAndAssign(now = Date.now()): void {
    this.promotePendingTasks(now);
    this.assignReadyTasks(now);
  }

  /**
   * pending → ready quand toutes les dépendances sont done.
   * Si une dépendance a échoué (ou n'existe pas), la tâche échoue en cascade.
   * Boucle jusqu'au point fixe pour propager les échecs en chaîne.
   */
  private promotePendingTasks(now = Date.now()): void {
    let changed = true;
    while (changed) {
      changed = false;
      const pending = this.store.tasksByStatus('pending');
      if (pending.length === 0) return;
      const all = new Map(this.store.listTasks().map((t) => [t.id, t]));
      for (const task of pending) {
        const deps = task.dependsOn.map((id) => all.get(id));
        if (deps.some((d) => d === undefined || d.status === 'failed')) {
          this.store.patchTask(task.id, { status: 'failed' }, now);
          this.emit('task_failed', { taskId: task.id, reason: 'dependency_failed' });
          changed = true;
          continue;
        }
        if (deps.every((d) => d !== undefined && d.status === 'done')) {
          this.store.patchTask(task.id, { status: 'ready' }, now);
          this.emit('task_ready', { taskId: task.id });
          changed = true;
        }
      }
    }
  }

  /** ready → assigned sur le nœud online le moins chargé qui a encore de la capacité. */
  private assignReadyTasks(now = Date.now()): void {
    for (const task of this.store.tasksByStatus('ready')) {
      const node = this.store
        .listNodes()
        .filter((n) => n.status === 'online' && n.running < n.maxConcurrency)
        .sort((a, b) => a.running - b.running || a.name.localeCompare(b.name))[0];
      if (!node) return; // plus aucune capacité disponible dans la ruche
      const assigned = this.store.patchTask(
        task.id,
        { status: 'assigned', assignedNodeId: node.id, branch: `hive/${task.id}` },
        now,
      );
      if (!assigned) continue;
      this.emit('task_assigned', { taskId: task.id, nodeId: node.id, branch: assigned.branch });
      this.opts.onAssign?.(node.id, assigned);
    }
  }

  /** Nœud sans heartbeat depuis plus de `nodeTimeoutMs` → offline + réaffectation. */
  private reapDeadNodes(now: number): void {
    for (const node of this.store.staleNodes(now - this.nodeTimeoutMs)) {
      this.nodeDisconnected(node.id, 'heartbeat_timeout', now);
    }
  }
}
