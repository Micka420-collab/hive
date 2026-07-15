// Le cœur de la ruche : promotion des tâches selon leurs dépendances,
// assignation aux nœuds disponibles, reap des nœuds morts, retries et
// idempotence des résultats. Aucune I/O réseau ici — tout est testable
// unitairement avec un store en mémoire.

import { MAX_ATTEMPTS, NODE_TIMEOUT_MS } from '../shared/types.js';
import type { HiveEvent, HiveNode, SubAgent, Task, TaskResult } from '../shared/types.js';
import { summarizeTask } from './hive-mind.js';
import { analyzePair } from './sting-detector.js';
import type { HiveStore, NodeProfile } from './store.js';

/** Délai pendant lequel un nœud qui vient de refuser une tâche ne la reçoit pas de nouveau. */
const REJECT_COOLDOWN_MS = 3_000;

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
  /** clé `taskId:nodeId` → timestamp d'expiration du cooldown de refus. */
  private readonly recentRejections = new Map<string, number>();
  /** Tâches actuellement différées pour cause de conflit (Sting Detector) — dédup des events. */
  private readonly deferredByConflict = new Set<string>();
  /** taskId → nombre de refus « infra » (token-failover) — borne les allers-retours. */
  private readonly infraRejects = new Map<string, number>();

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
   * Réconciliation à la (re)connexion d'un nœud. Le nœud déclare les tâches
   * qu'il exécute RÉELLEMENT (`activeTaskIds`) et le hub aligne son état sur
   * cette vérité de terrain :
   *  - tâche déclarée par le nœud, non assignée ailleurs (ready/null après un
   *    blip, ou toujours à ce nœud) → RÉ-ADOPTÉE (running @ nœud) : on ne tue
   *    jamais un travail en cours ;
   *  - tâche déclarée mais désormais assignée à un AUTRE nœud (déjà réaffectée),
   *    ou déjà terminée/inconnue → « zombie » : on demande au nœud de l'abandonner
   *    (le serveur enverra cancel_task) pour éviter la double exécution ;
   *  - tâche que le hub attribue au nœud mais que le nœud ne déclare PAS
   *    (crash/redémarrage à vide) → requalifiée en ready.
   *
   * NB : n'assigne rien ici. L'appelant envoie d'abord les cancel_task puis
   * déclenche un tick — sinon on risquerait de ré-assigner une tâche qu'on
   * s'apprête à faire annuler.
   */
  reconcileNode(nodeId: string, activeTaskIds: string[], now = Date.now()): { zombies: string[] } {
    const reported = new Set(activeTaskIds);
    const zombies: string[] = [];

    // Un nœud qui se (ré)inscrit repart de zéro : ses cooldowns de refus
    // sautent (ex. Night Shift corrigé puis nœud relancé — ne pas attendre
    // l'expiration d'un cooldown long devenu obsolète).
    for (const key of this.recentRejections.keys()) {
      if (key.endsWith(`:${nodeId}`)) this.recentRejections.delete(key);
    }

    // 1) Aligner sur ce que le nœud déclare exécuter.
    for (const taskId of reported) {
      const task = this.store.getTask(taskId);
      if (!task || task.status === 'done' || task.status === 'failed') {
        zombies.push(taskId); // inconnue ou déjà finie : le nœud doit l'abandonner
        continue;
      }
      if (task.assignedNodeId && task.assignedNodeId !== nodeId) {
        zombies.push(taskId); // réaffectée à un autre nœud : abandon (anti double exécution)
        continue;
      }
      // Non assignée (requalifiée par le blip) ou déjà à nous : on ré-adopte le
      // travail vivant sans le tuer.
      if (task.assignedNodeId !== nodeId || task.status !== 'running') {
        this.store.patchTask(taskId, { status: 'running', assignedNodeId: nodeId }, now);
        this.emit('task_readopted', { taskId, nodeId });
      }
    }

    // 2) Requalifier les tâches que le hub croit à ce nœud mais qu'il ne déclare pas.
    for (const task of this.store.activeTasksOfNode(nodeId)) {
      if (!reported.has(task.id)) {
        this.store.patchTask(task.id, { status: 'ready', assignedNodeId: null }, now);
        this.emit('task_requeued', { taskId: task.id, nodeId, reason: 'reconcile_orphan' });
      }
    }

    if (zombies.length > 0) this.emit('node_reconciled', { nodeId, zombies });
    return { zombies };
  }

  /**
   * Refus d'assignation par un nœud : la tâche repart en `ready` SANS consommer de
   * tentative — contrairement à un échec d'exécution. On mémorise le refus pour ne
   * pas ré-assigner aussitôt la même tâche au même nœud (cooldown), ce qui l'oriente
   * vers un AUTRE nœud.
   *
   * Token-failover (`infra`) : un refus dû à un agent en panne (auth/quota) est
   * compté ; si tous les nœuds refusent ainsi, la tâche finit par échouer proprement
   * (« aucun nœud avec un agent fonctionnel ») plutôt que de rebondir sans fin. Un
   * refus de simple saturation n'est PAS compté (le nœud se libérera).
   */
  rejectTask(
    nodeId: string,
    taskId: string,
    reason: string,
    infra = false,
    now = Date.now(),
    retryAfterMs?: number,
  ): void {
    const task = this.store.getTask(taskId);
    if (!task || task.assignedNodeId !== nodeId) return;
    if (task.status !== 'assigned' && task.status !== 'running') return;
    this.store.patchTask(taskId, { status: 'ready', assignedNodeId: null }, now);
    // Indisponibilité prévisible annoncée par le nœud (Night Shift) : cooldown
    // proportionnel (borné 24 h) — sinon boucle assignation/refus toutes les
    // ~4 s qui noierait le journal pendant toute la fenêtre fermée.
    const cooldown = Math.max(REJECT_COOLDOWN_MS, Math.min(retryAfterMs ?? 0, 24 * 60 * 60 * 1000));
    this.recentRejections.set(`${taskId}:${nodeId}`, now + cooldown);
    this.emit('task_rejected', { taskId, nodeId, reason, ...(infra ? { infra: true } : {}) });

    if (infra) {
      const count = (this.infraRejects.get(taskId) ?? 0) + 1;
      this.infraRejects.set(taskId, count);
      // Seuil proportionnel au nombre de nœuds : laisser une chance à chacun.
      const online = this.store.listNodes().filter((n) => n.status === 'online').length;
      const limit = Math.max(3, online * 3);
      if (count >= limit) {
        this.store.patchTask(taskId, { status: 'failed', assignedNodeId: null }, now);
        this.emit('task_failed', { taskId, reason: 'no_working_agent', infraRejects: count });
        this.infraRejects.delete(taskId);
        this.promoteAndAssign(now); // propager l'échec en cascade aux dépendantes
        return;
      }
    }
    this.promoteAndAssign(now);
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
      // Un nœud exécute enfin la tâche : l'agent fonctionne, on oublie les refus infra.
      this.infraRejects.delete(taskId);
    }
    // Émettre le progrès dès qu'il y a des sous-agents OU un log : les agents
    // réels (claude-code, codex) n'envoient qu'un log, sans sous-agents — sans
    // ce OR, le journal du dashboard resterait vide pendant leur exécution.
    const hasSubAgents = subAgents !== undefined && subAgents.length > 0;
    if (hasSubAgents || log) {
      this.emit('task_progress', {
        taskId,
        nodeId,
        ...(hasSubAgents ? { subAgents } : {}),
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

    // Un résultat (succès ou échec de tâche) est arrivé : l'agent a tourné, on
    // oublie l'historique de refus infra pour cette tâche.
    this.infraRejects.delete(task.id);
    this.store.insertResult({ ...result, nodeId });

    if (result.success) {
      this.store.patchTask(task.id, {
        status: 'done',
        result: { success: true, nodeId, durationMs: result.durationMs },
      });
      this.emit('task_done', { taskId: task.id, nodeId, durationMs: result.durationMs });
      // Hive Mind : la tâche réussie laisse un souvenir réutilisable par la ruche.
      this.store.recordMemory({
        projectId: task.projectId,
        taskId: task.id,
        title: task.title,
        content: summarizeTask(task.title, task.prompt, result.logs),
      });
      this.emit('memory_recorded', { taskId: task.id, projectId: task.projectId });
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

  /**
   * Annulation demandée par un humain : la tâche passe `failed` immédiatement
   * (le nœud est prévenu par le serveur via `cancel_task`) et ses dépendantes
   * échouent en cascade. Sans effet si la tâche est déjà terminée.
   */
  cancelTask(taskId: string, reason = 'cancelled', now = Date.now()): Task | undefined {
    const task = this.store.getTask(taskId);
    if (!task) return undefined;
    if (task.status === 'done' || task.status === 'failed') return task;
    const nodeId = task.assignedNodeId;
    const patched = this.store.patchTask(taskId, { status: 'failed', assignedNodeId: null }, now);
    this.emit('task_cancelled', { taskId, reason, ...(nodeId ? { nodeId } : {}) });
    this.promoteAndAssign(now);
    return patched;
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
    // Tâches déjà actives, enrichie au fil de la passe : une tâche qu'on vient
    // d'assigner doit être prise en compte pour la détection de conflit des
    // suivantes (sinon deux tâches ready mutuellement conflictuelles passeraient).
    const activeNow = this.store.tasksByStatus('assigned', 'running');
    for (const task of this.store.tasksByStatus('ready')) {
      // Sting Detector : ne pas lancer une tâche en conflit FORT (même fichier)
      // avec une tâche déjà active du même projet. On la diffère jusqu'à ce que
      // l'autre se termine — prévention des conflits d'édition concurrents.
      const clash = activeNow.find(
        (t) =>
          t.projectId === task.projectId &&
          t.id !== task.id &&
          analyzePair(task, t).severity === 'high',
      );
      if (clash) {
        if (!this.deferredByConflict.has(task.id)) {
          this.deferredByConflict.add(task.id);
          this.emit('task_conflict_deferred', { taskId: task.id, conflictsWith: clash.id });
        }
        continue;
      }
      this.deferredByConflict.delete(task.id);
      const node = this.store
        .listNodes()
        .filter(
          (n) =>
            n.status === 'online' &&
            n.running < n.maxConcurrency &&
            // Ne pas ré-assigner aussitôt une tâche que ce nœud vient de refuser.
            (this.recentRejections.get(`${task.id}:${n.id}`) ?? 0) <= now,
        )
        .sort((a, b) => a.running - b.running || a.name.localeCompare(b.name))[0];
      if (!node) continue; // aucun nœud éligible pour CETTE tâche (essayer les suivantes)
      const assigned = this.store.patchTask(
        task.id,
        { status: 'assigned', assignedNodeId: node.id, branch: `hive/${task.id}` },
        now,
      );
      if (!assigned) continue;
      // Le contexte Hive Mind est joint côté serveur (onAssign → assign_task),
      // sans réécrire le prompt persisté de la tâche.
      this.emit('task_assigned', { taskId: task.id, nodeId: node.id, branch: assigned.branch });
      this.opts.onAssign?.(node.id, assigned);
      activeNow.push(assigned); // les tâches suivantes tiennent compte de celle-ci
    }
  }

  /** Nœud sans heartbeat depuis plus de `nodeTimeoutMs` → offline + réaffectation. */
  private reapDeadNodes(now: number): void {
    for (const node of this.store.staleNodes(now - this.nodeTimeoutMs)) {
      this.nodeDisconnected(node.id, 'heartbeat_timeout', now);
    }
    // Purge des cooldowns de refus expirés (borne la taille de la map).
    for (const [key, until] of this.recentRejections) {
      if (until <= now) this.recentRejections.delete(key);
    }
  }
}
