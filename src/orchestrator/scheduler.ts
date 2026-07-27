// Le cœur de la ruche : promotion des tâches selon leurs dépendances,
// assignation aux nœuds disponibles, reap des nœuds morts, retries et
// idempotence des résultats. Aucune I/O réseau ici — tout est testable
// unitairement avec un store en mémoire.

import { MAX_ATTEMPTS, NODE_TIMEOUT_MS } from '../shared/types.js';
import type { HiveEvent, HiveNode, SubAgent, Task, TaskResult } from '../shared/types.js';
// La Balance n'entre JAMAIS dans le choix du nœud (doctrine, règle 4) : seuls
// le grand livre (comptage additif) et son cache de projets sont importés ici.
// Aucun symbole d'IMPUTATION (`peserLaRuche`, `Pesee`, `Compte`…) ne doit
// jamais apparaître dans ce fichier — verrouillé par
// tests/security-invariants.test.ts.
import { CacheProjets, GrandLivre, LOT_GRAND_LIVRE } from './balance.js';
import { createRace, enlistDrones, recordDroneResult, runningDrones } from './drone-wars.js';
import type { DroneRace } from './drone-wars.js';
import { summarizeTask } from './hive-mind.js';
import { CacheDomaines, meilleurNoeud, replierTraces } from './pheromones.js';
import type { Domaine, TraceePheromone } from './pheromones.js';
import { analyzePair } from './sting-detector.js';
import type { HiveStore, NodeProfile } from './store.js';
import { concurrenceEffective, lireTemperature, FENETRE_MS, TYPES_THERMO } from './thermo.js';
import type { BandeThermo } from './thermo.js';

/** Délai pendant lequel un nœud qui vient de refuser une tâche ne la reçoit pas de nouveau. */
const REJECT_COOLDOWN_MS = 3_000;

/**
 * Hystérésis : nombre de ticks CONSÉCUTIFS passés hors de la bande courante
 * avant de changer de régime. On compte les ticks divergents, pas les lectures
 * identiques : deux bandes divergentes en alternance (chaude, surchauffe,
 * chaude…) ne confirmaient jamais rien et la ruche restait froide.
 */
const TICKS_CONFIRMATION_THERMO = 2;

export interface SchedulerOptions {
  maxAttempts?: number;
  nodeTimeoutMs?: number;
  /** Appelé quand une tâche est assignée — le serveur pousse alors `assign_task` au nœud. */
  onAssign?: (nodeId: string, task: Task) => void;
  /** Appelé pour annuler le travail d'un nœud (drone perdant) — le serveur envoie `cancel_task`. */
  onCancel?: (nodeId: string, taskId: string, reason: string) => void;
  /** Appelé pour chaque événement journalisé — le serveur le diffuse au dashboard. */
  onEvent?: (event: HiveEvent) => void;
  /**
   * Balance : 'off' (le grand livre ne tourne pas du tout), 'observation'
   * (il pèse et se tient à jour, sans JAMAIS rien bloquer — défaut), 'strict'
   * (réservé : bloquera au plafond quand la porte existera).
   *
   * Dans cette version, 'observation' et 'strict' sont RIGOUREUSEMENT
   * indiscernables : aucun plafond ne peut être défini, donc rien ne bloque.
   * L'interrupteur est livré maintenant pour que le contrat de configuration
   * n'ait pas à changer le jour où la porte arrivera.
   */
  balance?: { mode: 'off' | 'observation' | 'strict' };
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
  /**
   * Drone Wars : courses compétitives en vol, EN MÉMOIRE (un redémarrage du hub
   * abandonne la course ; la tâche est alors récupérée par le circuit normal au
   * boot — dégradation sûre, jamais de double comptage). Le store garde le
   * modèle mono-assignation : `assignedNodeId` = drone « primaire » (celui que
   * suivent reap/réconciliation), promu vers un autre drone s'il tombe.
   */
  private readonly races = new Map<string, DroneRace>();

  /**
   * Thermorégulation : bande et facteur EFFECTIFS, c'est-à-dire hystérésés —
   * appliqués à l'assignation. Au boot la ruche est froide (facteur 1) : le
   * comportement par défaut est strictement celui d'avant la ventilation.
   */
  private bandeThermo: BandeThermo = 'froide';
  private facteurThermo = 1;
  /** Ticks consécutifs dont la lecture diverge de la bande appliquée (hystérésis). */
  private ticksDivergents = 0;

  /**
   * Phéromones : domaine mémoïsé par tâche (titre et prompt sont immuables).
   * Cache borné — sur dix ans, la mémoire ne dérive pas.
   */
  private readonly cacheDomaines = new CacheDomaines();

  /**
   * Balance : grand livre de la dépense par projet. CACHE en mémoire, jamais
   * matérialisé — un redémarrage le reconstruit par rattrapage borné.
   */
  private readonly livre = new GrandLivre();
  /** taskId → projectId, mémoïsé et borné (projectId est immuable). */
  private readonly cacheProjets = new CacheProjets();

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

  /** Tick périodique : reap des nœuds morts → thermorégulation → promotion → assignation. */
  tick(now = Date.now()): void {
    this.reapDeadNodes(now);
    // La température n'est prise QU'ICI : les autres chemins (résultats, refus,
    // reconnexions) assignent avec le facteur déjà en vigueur, sans re-lecture.
    this.ventiler(now);
    this.promoteAndAssign(now);
  }

  /** État thermique effectif (hystérésé) — lecture seule, pour l'API. */
  get thermo(): { bande: BandeThermo; facteur: number } {
    return { bande: this.bandeThermo, facteur: this.facteurThermo };
  }

  /**
   * Balance : mode, avancement du rattrapage et soldes par projet — lecture
   * seule, pour l'API (motif `get thermo`). `aJour: false` doit être visible :
   * un solde en cours de rattrapage affiché comme définitif est un mensonge
   * court mais coûteux.
   *
   * Les soldes ne portent volontairement ni plafond ni verdict : la table des
   * intentions humaines (`budgets`) et la porte qui s'en sert sont un travail
   * séparé. Ces deux champs s'ajouteront ici, de façon purement additive.
   */
  get balance(): {
    mode: 'off' | 'observation' | 'strict';
    aJour: boolean;
    soldes: Array<{ projectId: string; depenseMs: number; tentatives: number }>;
  } {
    return {
      mode: this.opts.balance?.mode ?? 'observation',
      aJour: this.livre.aJour,
      soldes: this.livre.soldes(),
    };
  }

  /**
   * Thermorégulation : lit la température de la FENÊTRE de 10 minutes (lecture
   * ciblée par temps et par type — jamais un lot des N derniers événements, qui
   * serait noyé par les `task_progress`) et ajuste le facteur de ventilation
   * avec HYSTÉRÉSIS : la bande ne change qu'après deux ticks consécutifs passés
   * hors de la bande appliquée, pour éviter le clignotement à la frontière.
   */
  private ventiler(now: number): void {
    const events = this.store.listEventsInWindow(now - FENETRE_MS, TYPES_THERMO);
    const lecture = lireTemperature(events, now);
    if (lecture.bande === this.bandeThermo) {
      this.ticksDivergents = 0; // la lecture confirme la bande courante
      return;
    }
    this.ticksDivergents += 1;
    if (this.ticksDivergents < TICKS_CONFIRMATION_THERMO) return;
    this.ticksDivergents = 0;
    this.bandeThermo = lecture.bande;
    this.facteurThermo = lecture.facteur;
    // Payload de FAITS uniquement : le texte (bilingue) est reconstruit à
    // l'affichage — jamais de message figé dans une base qui vivra dix ans.
    this.emit('thermo_shift', {
      bande: lecture.bande,
      temperature: lecture.temperature,
      facteur: lecture.facteur,
    });
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
        // Drone Wars : primaire revenu à vide — sa course continue sans lui
        // (promotion d'un autre drone), la tâche n'est requalifiée que si la
        // course s'éteint. Jamais de requeue pendant que des drones volent.
        if (this.dropDrone(task.id, nodeId, 'reconcile_orphan', now)) continue;
        this.store.patchTask(task.id, { status: 'ready', assignedNodeId: null }, now);
        this.emit('task_requeued', { taskId: task.id, nodeId, reason: 'reconcile_orphan' });
      }
    }

    // Drone Wars : un nœud qui se ré-inscrit repart de zéro — TOUTE course où
    // il volait et dont il ne déclare pas la tâche perd ce drone (couvre les
    // fantômes : crash sans FIN TCP, socket remplacée, assign_task avalé).
    for (const taskId of [...this.races.keys()]) {
      if (!reported.has(taskId)) this.dropDrone(taskId, nodeId, 'reconcile_ghost', now);
    }
    // Et un drone NON-primaire qui redéclare sa tâche a été zombifié ci-dessus
    // (le primaire la porte) — il quitte la course proprement.
    for (const taskId of zombies) this.dropDrone(taskId, nodeId, 'reconcile_zombie', now);

    if (zombies.length > 0) this.emit('node_reconciled', { nodeId, zombies });
    return { zombies };
  }

  /**
   * Retire un drone d'une course (perte d'infrastructure : blip, zombie…).
   * Retourne true si la tâche était bien dans une course où ce nœud volait —
   * l'appelant ne doit alors PAS appliquer sa requalification générique.
   */
  private dropDrone(taskId: string, nodeId: string, reason: string, now: number): boolean {
    const race = this.races.get(taskId);
    if (!race || !race.drones.some((d) => d.nodeId === nodeId && d.status === 'running')) {
      return false;
    }
    const { race: updated, decision } = recordDroneResult(race, nodeId, false);
    this.races.set(taskId, updated);
    this.emit('drone_failed', { taskId, nodeId, reason });
    const task = this.store.getTask(taskId);
    if (!task || task.status === 'done' || task.status === 'failed') {
      this.races.delete(taskId);
      return true;
    }
    if (decision.outcome === 'all_failed') {
      this.races.delete(taskId);
      this.store.patchTask(taskId, { status: 'ready', assignedNodeId: null }, now);
      this.emit('task_requeued', { taskId, nodeId, reason: 'drone_all_lost' });
    } else if (task.assignedNodeId === nodeId) {
      this.promoteNextDrone(updated, taskId, now);
    }
    return true;
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
    // Indisponibilité prévisible annoncée par le nœud (Night Shift) : cooldown
    // proportionnel (borné 24 h) — sinon boucle assignation/refus toutes les
    // ~4 s qui noierait le journal pendant toute la fenêtre fermée.
    const cooldown = Math.max(REJECT_COOLDOWN_MS, Math.min(retryAfterMs ?? 0, 24 * 60 * 60 * 1000));

    // Drone Wars : le refus d'un drone enrôlé (saturation, hors service) n'est
    // qu'un abandon de course — la tâche ne repart en ready que si la course
    // s'éteint (aucune tentative brûlée : rien n'a tourné).
    const race = this.races.get(taskId);
    if (race && race.drones.some((d) => d.nodeId === nodeId && d.status === 'running')) {
      const { race: updated, decision } = recordDroneResult(race, nodeId, false);
      this.races.set(taskId, updated);
      this.recentRejections.set(`${taskId}:${nodeId}`, now + cooldown);
      this.emit('drone_rejected', { taskId, nodeId, reason });
      const task = this.store.getTask(taskId);
      if (!task || task.status === 'done' || task.status === 'failed') {
        this.races.delete(taskId);
        return;
      }
      if (decision.outcome === 'all_failed') {
        this.races.delete(taskId);
        this.store.patchTask(taskId, { status: 'ready', assignedNodeId: null }, now);
        this.emit('task_requeued', { taskId, nodeId, reason: 'drone_all_rejected' });
        this.promoteAndAssign(now);
      } else if (task.assignedNodeId === nodeId) {
        this.promoteNextDrone(updated, taskId, now);
      }
      return;
    }

    const task = this.store.getTask(taskId);
    if (!task || task.assignedNodeId !== nodeId) return;
    if (task.status !== 'assigned' && task.status !== 'running') return;
    this.store.patchTask(taskId, { status: 'ready', assignedNodeId: null }, now);
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
    // Drone Wars d'abord : une course qui continue promeut un nouveau primaire
    // (la tâche change d'assigné et n'est PAS requalifiée par la boucle suivante).
    this.failDronesOfNode(nodeId, now);
    for (const task of this.store.activeTasksOfNode(nodeId)) {
      this.store.patchTask(task.id, { status: 'ready', assignedNodeId: null }, now);
      this.emit('task_requeued', { taskId: task.id, nodeId, reason });
    }
    this.promoteAndAssign(now);
  }

  /** Le nœud confirme le démarrage effectif (assigned → running) et le progrès des sous-agents. */
  handleTaskUpdate(nodeId: string, taskId: string, subAgents?: SubAgent[], log?: string): void {
    const task = this.store.getTask(taskId);
    // Mise à jour pour une tâche inconnue ou réaffectée ailleurs : ignorée —
    // SAUF si le nœud est un drone enrôlé : son progrès est visible (télémétrie
    // de course), sans jamais toucher au statut ni à l'assignation.
    if (!task) return;
    if (task.assignedNodeId !== nodeId) {
      const race = this.races.get(taskId);
      if (race?.drones.some((d) => d.nodeId === nodeId && d.status === 'running')) {
        const hasProgress = (subAgents !== undefined && subAgents.length > 0) || log !== undefined;
        if (hasProgress) {
          this.emit('task_progress', {
            taskId,
            nodeId,
            ...(subAgents && subAgents.length > 0 ? { subAgents } : {}),
            ...(log !== undefined ? { log: log.slice(0, 2000) } : {}),
          });
        }
      }
      return;
    }
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
    // Drone Wars : une course en vol court-circuite le modèle mono-assignation —
    // le résultat de N'IMPORTE quel drone enrôlé est arbitré par la course.
    const race = this.races.get(task.id);
    if (race) return this.handleDroneResult(race, task, nodeId, result);
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
      // Bornée ici aussi, en plus de l'entrée (`isInt(m.durationMs, 0, …)`,
      // protocol.ts) : aucune durée négative n'entre dans le journal, quel que
      // soit l'appelant. La Balance la reborne une troisième fois au repli.
      const durationMs = Math.max(0, result.durationMs);
      if (attempts >= this.maxAttempts) {
        this.store.patchTask(task.id, {
          status: 'failed',
          attempts,
          assignedNodeId: null,
          result: { success: false, nodeId, durationMs: result.durationMs },
        });
        // `durationMs` : le temps machine que cet échec a coûté. Purement
        // ADDITIF — tous les lecteurs actuels lisent en défensif (`num(p, …)
        // → 0` dans waggle.ts, idem pulse.ts) et n'en tiennent aucun compte.
        // Sans lui, deux tentatives sur trois (MAX_ATTEMPTS = 3) pouvaient ne
        // laisser AUCUNE trace de leur coût : une histoire économique
        // définitivement perdue, jour après jour.
        this.emit('task_failed', { taskId: task.id, nodeId, attempts, durationMs });
      } else {
        // Échec → réessai : la tâche repart en ready, une autre ouvrière la prendra.
        this.store.patchTask(task.id, { status: 'ready', attempts, assignedNodeId: null });
        this.emit('task_retry', {
          taskId: task.id,
          nodeId,
          attempt: attempts,
          maxAttempts: this.maxAttempts,
          durationMs,
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
    // Drone Wars : annuler TOUS les drones encore en vol, pas seulement le primaire.
    const race = this.races.get(taskId);
    if (race) {
      for (const droneId of runningDrones(race)) this.opts.onCancel?.(droneId, taskId, reason);
      this.races.delete(taskId);
    } else if (task.assignedNodeId) {
      // Mono : le nœud assigné est prévenu ici aussi — la notification vit dans
      // le scheduler, pas dans chaque appelant (symétrie course/mono).
      this.opts.onCancel?.(task.assignedNodeId, taskId, reason);
    }
    const nodeId = task.assignedNodeId;
    const patched = this.store.patchTask(taskId, { status: 'failed', assignedNodeId: null }, now);
    this.emit('task_cancelled', { taskId, reason, ...(nodeId ? { nodeId } : {}) });
    this.promoteAndAssign(now);
    return patched;
  }

  // ─── Drone Wars : redondance compétitive (opt-in, par tâche) ────────────────

  /**
   * Lance une course : la même tâche est confiée à jusqu'à `factor` nœuds
   * distincts (diversité d'agents maximisée). Le premier succès gagne, les
   * autres drones sont annulés. Uniquement sur une tâche `ready` — le circuit
   * automatique reste mono-nœud, la course est un geste explicite (API/CLI).
   */
  startRace(
    taskId: string,
    factor: number,
    now = Date.now(),
  ): { ok: true; drones: string[] } | { ok: false; error: string } {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, error: 'tâche inconnue' };
    if (this.races.has(taskId)) {
      return { ok: false, error: 'une course est déjà en vol pour cette tâche' };
    }
    if (task.status !== 'ready') {
      return {
        ok: false,
        error: `tâche ${task.status} — une course ne se lance que sur une tâche prête (ready)`,
      };
    }
    // Sting Detector : une course ne contourne JAMAIS la prévention des
    // éditions concurrentes — même garde que l'assignation automatique.
    const clash = this.store
      .tasksByStatus('assigned', 'running')
      .find(
        (t) =>
          t.projectId === task.projectId &&
          t.id !== taskId &&
          analyzePair(task, t).severity === 'high',
      );
    if (clash) {
      return {
        ok: false,
        error: `tâche en conflit fort avec la tâche active « ${clash.title} » — course refusée`,
      };
    }
    // La charge des drones non-primaires n'existe pas dans le store : on
    // l'ajoute ici pour ne pas enrôler des nœuds déjà saturés par une course.
    const extra = this.droneLoad();
    const candidates = this.store
      .listNodes()
      .filter(
        (n) =>
          n.status === 'online' &&
          // Thermorégulation : une course MULTIPLIE la charge sur une ruche qui
          // souffre déjà — elle respecte donc la concurrence effective, comme
          // l'assignation automatique. Décision assumée : le geste explicite
          // choisit QUI travaille, jamais COMBIEN la ruche encaisse. Le
          // plancher de 1 par nœud garantit qu'une course reste possible même
          // en surchauffe.
          n.running + (extra.get(n.id) ?? 0) <
            concurrenceEffective(n.maxConcurrency, this.facteurThermo) &&
          (this.recentRejections.get(`${taskId}:${n.id}`) ?? 0) <= now,
      )
      .sort(
        (a, b) =>
          a.running + (extra.get(a.id) ?? 0) - (b.running + (extra.get(b.id) ?? 0)) ||
          a.name.localeCompare(b.name),
      )
      .map((n) => ({ id: n.id, agentType: n.agentType }));
    const { race, launch } = enlistDrones(createRace(taskId, factor), candidates);
    if (launch.length === 0) return { ok: false, error: 'aucun nœud disponible pour la course' };

    // Le 1er drone devient le « primaire » suivi par le store (reap/reconcile) ;
    // les autres volent en plus — leurs résultats arrivent par le même canal.
    const primary = launch[0] as string;
    const assigned = this.store.patchTask(
      taskId,
      { status: 'assigned', assignedNodeId: primary, branch: `hive/${taskId}` },
      now,
    );
    if (!assigned) return { ok: false, error: 'tâche introuvable' };
    // La tâche part en course : elle n'est plus « différée pour conflit ».
    this.deferredByConflict.delete(taskId);
    this.races.set(taskId, race);
    this.emit('drone_race_started', { taskId, factor: race.factor, drones: launch });
    this.emit('task_assigned', { taskId, nodeId: primary, branch: assigned.branch });
    for (const droneId of launch) this.opts.onAssign?.(droneId, assigned);
    return { ok: true, drones: launch };
  }

  /** Course en vol pour une tâche (lecture seule, pour l'API). */
  getRace(taskId: string): DroneRace | undefined {
    return this.races.get(taskId);
  }

  /** Toutes les courses en vol (lecture seule, pour l'API/dashboard). */
  listRaces(): DroneRace[] {
    return [...this.races.values()];
  }

  /** Arbitre le résultat d'un drone (succès → victoire ; échec → attente/échec). */
  private handleDroneResult(
    race: DroneRace,
    task: Task,
    nodeId: string,
    result: Omit<TaskResult, 'nodeId'>,
    now = Date.now(),
  ): boolean {
    if (task.status === 'done' || task.status === 'failed') {
      this.races.delete(task.id);
      this.emit('result_ignored', { taskId: task.id, nodeId, reason: 'race_task_finished' });
      return false;
    }
    const { race: updated, decision } = recordDroneResult(race, nodeId, result.success);
    if (decision.outcome === 'lost') {
      // Résultat d'un nœud non enrôlé (ou d'un drone déjà sorti de la course).
      this.emit('result_ignored', { taskId: task.id, nodeId, reason: 'drone_not_in_race' });
      return false;
    }
    this.races.set(task.id, updated);
    this.store.insertResult({ ...result, nodeId });

    if (decision.outcome === 'won') {
      this.races.delete(task.id);
      this.infraRejects.delete(task.id);
      this.store.patchTask(
        task.id,
        {
          status: 'done',
          assignedNodeId: nodeId,
          result: { success: true, nodeId, durationMs: result.durationMs },
        },
        now,
      );
      this.emit('task_done', { taskId: task.id, nodeId, durationMs: result.durationMs });
      this.emit('drone_won', { taskId: task.id, nodeId, cancelled: decision.cancel.length });
      for (const loser of decision.cancel) {
        this.emit('drone_cancelled', { taskId: task.id, nodeId: loser });
        this.opts.onCancel?.(loser, task.id, 'course de drones perdue');
      }
      // Hive Mind : même parité que le circuit normal — la victoire laisse un souvenir.
      this.store.recordMemory({
        projectId: task.projectId,
        taskId: task.id,
        title: task.title,
        content: summarizeTask(task.title, task.prompt, result.logs),
      });
      this.emit('memory_recorded', { taskId: task.id, projectId: task.projectId });
      this.promoteAndAssign(now);
      return true;
    }

    if (decision.outcome === 'pending') {
      // Ce drone a échoué mais d'autres volent encore : la course continue.
      this.emit('drone_failed', { taskId: task.id, nodeId });
      if (task.assignedNodeId === nodeId) this.promoteNextDrone(updated, task.id, now);
      return true;
    }

    // all_failed via un VRAI résultat : l'agent a tourné — tentative brûlée,
    // circuit d'échec normal (retry ou failed définitif).
    this.races.delete(task.id);
    this.emit('drone_all_failed', { taskId: task.id, drones: updated.drones.length });
    const attempts = task.attempts + 1;
    // Même enrichissement que le circuit mono : une course perdue coûte au
    // moins aussi cher qu'une tentative solitaire, elle doit se peser pareil.
    const durationMs = Math.max(0, result.durationMs);
    if (attempts >= this.maxAttempts) {
      this.store.patchTask(task.id, {
        status: 'failed',
        attempts,
        assignedNodeId: null,
        result: { success: false, nodeId, durationMs: result.durationMs },
      });
      this.emit('task_failed', { taskId: task.id, nodeId, attempts, durationMs });
    } else {
      this.store.patchTask(task.id, { status: 'ready', attempts, assignedNodeId: null });
      this.emit('task_retry', {
        taskId: task.id,
        nodeId,
        attempt: attempts,
        maxAttempts: this.maxAttempts,
        durationMs,
      });
    }
    this.promoteAndAssign(now);
    return true;
  }

  /**
   * Le drone primaire est tombé (échec, refus, déconnexion) mais la course
   * continue : un autre drone en vol devient le primaire suivi par le store.
   * Promu en `assigned` (pas `running`) : le statut running n'est jamais
   * fabriqué sans preuve — le filet staleAssignedTasks reste armé, et le vrai
   * task_update du promu refera assigned→running comme d'habitude.
   */
  private promoteNextDrone(race: DroneRace, taskId: string, now: number): void {
    const next = runningDrones(race)[0];
    if (next) {
      this.store.patchTask(taskId, { status: 'assigned', assignedNodeId: next }, now);
      this.emit('drone_promoted', { taskId, nodeId: next });
    }
  }

  /**
   * Charge « fantôme » par nœud : les drones NON-primaires en vol n'existent
   * pas dans le store (mono-assignation) — sans ce complément, l'assignation
   * et les courses suivantes sur-réserveraient des nœuds déjà occupés.
   */
  private droneLoad(): Map<string, number> {
    const load = new Map<string, number>();
    for (const race of this.races.values()) {
      const task = this.store.getTask(race.taskId);
      for (const d of race.drones) {
        if (d.status !== 'running') continue;
        if (task?.assignedNodeId === d.nodeId) continue; // primaire déjà compté par le store
        load.set(d.nodeId, (load.get(d.nodeId) ?? 0) + 1);
      }
    }
    return load;
  }

  /**
   * Un nœud vient de mourir (reap/déconnexion) : ses drones échouent. Appelé
   * AVANT la requalification générique — une course qui continue promeut un
   * nouveau primaire (la tâche reste en vol), une course éteinte requalifie la
   * tâche en ready SANS brûler de tentative (perte d'infrastructure, pas d'échec
   * de l'agent).
   */
  private failDronesOfNode(nodeId: string, now: number): void {
    for (const taskId of [...this.races.keys()]) this.dropDrone(taskId, nodeId, 'node_lost', now);
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
      // Statuts des SEULES dépendances citées (lecture par clé primaire) : le
      // dépliage de toute la table `tasks` à chaque passe — et il y en a une
      // par nœud fauché — gelait l'orchestrateur à 100 000 tâches.
      const attendues = new Set<string>();
      for (const task of pending) for (const dep of task.dependsOn) attendues.add(dep);
      const statuts = this.store.taskStatuses([...attendues]);
      for (const task of pending) {
        const deps = task.dependsOn.map((id) => statuts.get(id));
        if (deps.some((d) => d === undefined || d === 'failed')) {
          this.store.patchTask(task.id, { status: 'failed' }, now);
          this.emit('task_failed', { taskId: task.id, reason: 'dependency_failed' });
          changed = true;
          continue;
        }
        if (deps.every((d) => d === 'done')) {
          this.store.patchTask(task.id, { status: 'ready' }, now);
          this.emit('task_ready', { taskId: task.id });
          changed = true;
        }
      }
    }
  }

  /**
   * Fait avancer le grand livre de la Balance en lisant les résultats NOUVEAUX
   * depuis le filigrane. Le compteur suit la TABLE, pas les sites d'appel de
   * `insertResult` : un troisième site d'écriture ajouté dans cinq ans ne peut
   * pas le dérégler. C'est un invariant STRUCTUREL, pas une discipline —
   * c'était la principale réserve contre un accumulateur incrémental.
   *
   * Coût borné : ≤ LOT_GRAND_LIVRE lignes d'un index COUVRANT par passe ; zéro
   * ligne et une seule sonde en régime établi. Jamais de SELECT non borné sur
   * le chemin du tick.
   *
   * Ce comptage n'a AUCUN effet sur l'ordonnancement : il ne décide rien, il
   * observe. La porte qui s'en servira un jour est un travail séparé.
   */
  private avancerGrandLivre(): void {
    if (this.opts.balance?.mode === 'off') return;
    const lot = this.store.listResultsForLedger(this.livre.filigrane, LOT_GRAND_LIVRE);
    if (lot.length === 0) {
      this.livre.marquerRattrape();
      return;
    }
    const projets = this.cacheProjets.resoudre(
      lot.map((r) => r.taskId),
      (manquants) => this.store.listTaskProjects(manquants),
    );
    // Une tentative dont la tâche a disparu est retirée du COMPTE (aucun projet
    // à qui l'imputer) mais PAS du PARCOURS : le filigrane la dépasse quand
    // même, sinon le rattrapage bouclerait sur elle à chaque tick, sans fin.
    const dernier = lot[lot.length - 1]?.id ?? 0;
    this.livre.absorber(
      lot.flatMap((r) => {
        const projectId = projets.get(r.taskId);
        return projectId ? [{ id: r.id, projectId, durationMs: r.durationMs }] : [];
      }),
      dernier,
    );
    // Lot incomplet ⇒ le livre a rejoint la fin de la table.
    if (lot.length < LOT_GRAND_LIVRE) this.livre.marquerRattrape();
  }

  /** ready → assigned sur le nœud online le moins chargé qui a encore de la capacité. */
  private assignReadyTasks(now = Date.now()): void {
    // Balance : le livre avance AVANT toute décision, pour que la lecture
    // exposée par `get balance` ne soit jamais en retard d'un tick. Il
    // n'influence rien ici — voir la règle 4 de la doctrine (balance.ts).
    this.avancerGrandLivre();
    // Tâches déjà actives, enrichie au fil de la passe : une tâche qu'on vient
    // d'assigner doit être prise en compte pour la détection de conflit des
    // suivantes (sinon deux tâches ready mutuellement conflictuelles passeraient).
    const activeNow = this.store.tasksByStatus('assigned', 'running');
    // Drones non-primaires en vol : charge invisible du store, à additionner.
    const extra = this.droneLoad();
    // Phéromones : calculées au plus UNE fois par passe, et seulement si un
    // départage est réellement nécessaire (≥ 2 candidats à charge minimale).
    // Le corpus est BORNÉ de bout en bout : ≤ 500 résultats récents, dont on ne
    // résout le domaine que pour les taskId réellement cités (lecture par clé
    // primaire, mémoïsée). Déplier toute la table `tasks` pour n'en garder que
    // 0,5 % gelait l'orchestrateur à 100 000 tâches.
    let traces: TraceePheromone[] | null = null;
    const lireTraces = (): TraceePheromone[] => {
      if (traces) return traces;
      const resultats = this.store.listResultsForPheromones();
      const domaines = this.cacheDomaines.domaines(
        resultats.map((r) => r.taskId),
        (manquants) => this.store.listTaskTexts(manquants),
      );
      traces = replierTraces(domaines, resultats, now);
      return traces;
    };
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
      const charge = (n: HiveNode): number => n.running + (extra.get(n.id) ?? 0);
      const eligibles = this.store
        .listNodes()
        .filter(
          (n) =>
            n.status === 'online' &&
            // Thermorégulation : sous ventilation, la capacité de chaque nœud
            // est réduite par le facteur en vigueur (plancher 1 — la ruche ne
            // s'arrête pas, elle ralentit).
            charge(n) < concurrenceEffective(n.maxConcurrency, this.facteurThermo) &&
            // Ne pas ré-assigner aussitôt une tâche que ce nœud vient de refuser.
            (this.recentRejections.get(`${task.id}:${n.id}`) ?? 0) <= now,
        )
        .sort((a, b) => charge(a) - charge(b) || a.name.localeCompare(b.name));
      let node = eligibles[0];
      if (!node) continue; // aucun nœud éligible pour CETTE tâche (essayer les suivantes)
      // Phéromones : le critère principal « moins chargé » reste intact — elles
      // ne DÉPARTAGENT que les ex æquo à charge minimale, et seulement sur un
      // signal net (score strictement positif et sans égalité).
      let routePheromone: { domaine: Domaine; score: number } | null = null;
      const chargeMin = charge(node);
      const exAequo = eligibles.filter((n) => charge(n) === chargeMin);
      if (exAequo.length >= 2) {
        const domaine = this.cacheDomaines.domaine(task);
        const elu = meilleurNoeud(
          exAequo.map((n) => n.id),
          domaine,
          lireTraces(),
        );
        const gagnant = elu === null ? undefined : exAequo.find((n) => n.id === elu);
        if (gagnant) {
          node = gagnant;
          const score =
            lireTraces().find((t) => t.nodeId === gagnant.id && t.domaine === domaine)?.score ?? 0;
          routePheromone = { domaine, score };
        }
      }
      const assigned = this.store.patchTask(
        task.id,
        { status: 'assigned', assignedNodeId: node.id, branch: `hive/${task.id}` },
        now,
      );
      if (!assigned) continue;
      if (routePheromone) {
        // Faits typés seulement (dont le NOM du nœud, que le Journal affiche) :
        // le texte bilingue est reconstruit à l'affichage.
        this.emit('pheromone_route', {
          taskId: task.id,
          nodeId: node.id,
          nodeName: node.name,
          domaine: routePheromone.domaine,
          score: routePheromone.score,
        });
      }
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
