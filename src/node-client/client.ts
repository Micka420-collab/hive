// Client de nœud membre : rejoint la ruche en WebSocket, reçoit des tâches
// poussées par l'orchestrateur, les exécute via un AgentAdapter dans un
// workspace isolé, remonte progrès et résultats. Reconnexion automatique
// avec backoff exponentiel ; heartbeat découplé de l'exécution.
// Consentement (§5.3) : rien ne s'exécute tant que le membre n'a pas lancé
// ce client lui-même.

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { getAdapter } from '../adapters/index.js';
import type { AgentAdapter } from '../adapters/index.js';
import { argvDe, jugerChantier } from '../shared/chantier.js';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { jugerPreparation } from '../shared/preparation.js';
import { isOnShift, minutesUntilOpen, nightShiftFromEnv } from '../shared/night-shift.js';
import type { NightShiftPolicy } from '../shared/night-shift.js';
import { plateformeDepuis } from '../shared/machine.js';
import { ID_PATTERN, LIMITS, parseServerMessage } from '../shared/protocol.js';
import type { AssignChantierMsg, AssignMergeMsg, ClientMessage } from '../shared/protocol.js';
import { HEARTBEAT_INTERVAL_MS } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { runMerge, runProc } from './merge-runner.js';
import { buildSandboxEnv, cloneRepo, prepareWorkspace } from './workspace.js';
import type { Fournisseur } from './isolement.js';
import type { Workspace } from './workspace.js';

export interface NodeClientOptions {
  /** URL WebSocket de l'orchestrateur, ex. ws://localhost:7777/ws */
  url: string;
  token: string;
  name: string;
  ownerName: string;
  /** shell | claude-code | codex (ou tout adaptateur injecté). */
  agentType: string;
  maxConcurrency: number;
  /**
   * Les modèles que ce nœud DÉCLARE pouvoir faire tourner (ex.
   * `['claude-opus-5', 'claude-fable-5']`), lus de `HIVE_MODELES`. Ce que
   * l'Aiguillage appris consomme pour choisir. Absent/vide : le nœud ne déclare
   * rien, et la ruche ordonnance comme avant.
   */
  modeles?: string[];
  /** Racine des workspaces de tâches (défaut : ./.hive-work/<name>). */
  workRoot?: string;
  /** Adaptateur injectable (tests, agents custom). */
  adapter?: AgentAdapter;
  /** Variables d'environnement à laisser passer dans la sandbox (secrets locaux). */
  keepEnv?: string[];
  /** Identité stable dans la ruche (sinon attribuée par l'orchestrateur). */
  nodeId?: string;
  /** Coupe les logs console (tests). */
  quiet?: boolean;
  /**
   * Bac à sable résolu par l'appelant (main.ts), ou absent.
   *
   * INJECTÉ plutôt que sondé ici : la sonde lance un binaire, et un test de
   * nœud n'a pas à découvrir podman sur la machine de qui fait tourner la
   * suite. C'est le même motif que `adapter`.
   */
  bac?: { fournisseur: Fournisseur; variables: readonly string[] };
}

/**
 * Préfixe le contexte Hive Mind au prompt d'une tâche, pour l'agent. Le prompt
 * d'origine n'est JAMAIS tronqué : ce prompt augmenté reste local (exécuté par
 * l'adaptateur), il ne repart pas au hub — aucune contrainte de taille protocole.
 */
export function composeAgentPrompt(hiveContext: string | undefined, prompt: string): string {
  return hiveContext ? `${hiveContext}\n\n${prompt}` : prompt;
}

export class HiveNodeClient {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private readonly active = new Map<string, AbortController>();
  /** Merges en cours (par mergeId) — anti-doublon si le hub réémet le même id. */
  private readonly activeMerges = new Set<string>();
  private readonly activeChantiers = new Set<string>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1_000;
  private closed = false;
  private readonly adapter: AgentAdapter;
  private readonly workRoot: string;

  constructor(private readonly opts: NodeClientOptions) {
    this.adapter = opts.adapter ?? getAdapter(opts.agentType);
    this.nodeId = opts.nodeId ?? null;
    this.workRoot =
      opts.workRoot ?? path.join('.hive-work', opts.name.replace(/[^A-Za-z0-9_-]+/g, '_'));
  }

  /** Rejoint la ruche (et retente sans fin tant que stop() n'est pas appelé). */
  start(): void {
    this.closed = false;
    this.warnIfInsecureTransport();
    this.connect();
  }

  /**
   * Le token et les diffs transitent dans le premier message : sur un ws://
   * non-local, ils sont en clair (capture passive → rejeu ; MITM → injection).
   * On avertit fortement ; utilisez wss:// (proxy TLS) hors de la machine locale.
   */
  private warnIfInsecureTransport(): void {
    try {
      const url = new URL(this.opts.url);
      const host = url.hostname;
      const local =
        host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
      if (url.protocol === 'ws:' && !local) {
        this.log(
          `⚠ SÉCURITÉ : connexion ws:// NON chiffrée vers ${host} — le token et les ` +
            'diffs circulent en clair. Utilisez wss:// (proxy TLS) hors de la machine locale.',
        );
      }
    } catch {
      // URL invalide : la connexion échouera et sera journalisée ailleurs.
    }
  }

  /** Quitte la ruche : annule les tâches en cours et ferme la connexion. */
  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const ctrl of this.active.values()) ctrl.abort();
    this.stopHeartbeat();
    this.ws?.close(1000, 'arrêt du nœud');
    this.ws = null;
  }

  get id(): string | null {
    return this.nodeId;
  }

  get runningCount(): number {
    return this.active.size;
  }

  // ─── Connexion ───────────────────────────────────────────────────────────
  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = 1_000;
      this.send({
        type: 'register',
        token: this.opts.token,
        name: this.opts.name,
        ownerName: this.opts.ownerName,
        agentType: this.opts.agentType,
        maxConcurrency: this.opts.maxConcurrency,
        // En reconnexion, on garde la même identité dans la ruche.
        ...(this.nodeId ? { nodeId: this.nodeId } : {}),
        // Tâches réellement en cours : permet au hub de réconcilier son état
        // (requalifier les tâches qu'on ne fait plus, annuler nos zombies).
        activeTasks: [...this.active.keys()],
        // La machine se DIT : « quelles ouvrières tournent sous Windows ? »
        // doit avoir une réponse à l'écran, pas une devinette (§ 6.2 — la
        // moitié des morsures de ce dépôt sont des morsures Windows).
        plateforme: plateformeDepuis(process.platform),
        // Les modèles déclarés, s'il y en a. Absents : le hub n'invente rien et
        // ordonnance comme avant l'Aiguillage (même règle que la plateforme).
        ...(this.opts.modeles && this.opts.modeles.length > 0
          ? { modeles: this.opts.modeles }
          : {}),
      });
    });

    ws.on('message', (data) => {
      this.onMessage(typeof data === 'string' ? data : data.toString());
    });

    ws.on('close', () => {
      this.stopHeartbeat();
      if (!this.closed) this.scheduleReconnect();
    });

    ws.on('error', () => {
      // L'événement close suit toujours : la reconnexion y est gérée.
    });
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    this.log(`connexion perdue — nouvel essai dans ${Math.round(delay / 1000)} s`);
    // Volontairement NON unref : dans un process de nœud autonome, ce timer est
    // le seul handle qui maintient l'event loop en vie entre deux tentatives.
    // L'unref le ferait s'éteindre en silence au lieu de « retenter sans fin ».
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private onMessage(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case 'registered':
        this.nodeId = msg.nodeId;
        this.startHeartbeat();
        this.log(`enregistré dans la ruche (nodeId=${msg.nodeId.slice(0, 8)}…)`);
        break;
      case 'assign_task':
        void this.runTask(msg.task, msg.repoUrl ?? null, msg.hiveContext, msg.modele);
        break;
      case 'assign_merge':
        void this.runMergeJob(msg);
        break;
      case 'assign_chantier':
        void this.runChantierJob(msg);
        break;
      case 'cancel_task':
        this.active.get(msg.taskId)?.abort();
        break;
      case 'error':
        this.log(`erreur du hub : ${msg.message}`);
        break;
      default:
        break; // state/event : réservés au dashboard
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'heartbeat',
        running: this.active.size,
        onShift: this.offShiftReject() === null,
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
    // onShift : permet au hub d'éviter d'office ce nœud pour un merge quand il
    // est hors heures de service (les tâches, elles, passent par task_reject).
    this.send({
      type: 'heartbeat',
      running: this.active.size,
      onShift: this.offShiftReject() === null,
    });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Politique Night Shift, parsée SANS jamais lever : une HIVE_SHIFT malformée
   * ne doit pas transformer une assignation en exception muette (tâche restée
   * « assigned » en otage côté hub) — on refuse proprement à la place.
   */
  private shiftPolicy(): NightShiftPolicy | 'invalide' {
    try {
      return nightShiftFromEnv();
    } catch (err) {
      if (!this.shiftWarned) {
        this.shiftWarned = true;
        this.log(
          `⚠ HIVE_SHIFT invalide (${err instanceof Error ? err.message : String(err)}) — le nœud refuse le travail tant que la config n'est pas corrigée.`,
        );
      }
      return 'invalide';
    }
  }
  private shiftWarned = false;

  /** Motif de refus Night Shift à joindre à un task_reject, ou null si de service. */
  private offShiftReject(): { reason: string; retryAfterMs?: number } | null {
    const shift = this.shiftPolicy();
    // Config invalide = état durable (corrigée seulement par un redémarrage du
    // nœud, qui purge ses cooldowns à la ré-inscription) : cooldown long pour
    // ne pas réintroduire la boucle assignation/refus qui noie le journal.
    if (shift === 'invalide') return { reason: 'hive_shift_invalide', retryAfterMs: 10 * 60_000 };
    if (shift.windows.length === 0) return null;
    const now = new Date();
    if (isOnShift(shift, now)) return null;
    return {
      reason: 'hors_service_night_shift',
      retryAfterMs: minutesUntilOpen(shift, now) * 60_000,
    };
  }

  // ─── Exécution d'une tâche ───────────────────────────────────────────────
  private async runTask(
    task: Task,
    repoUrl: string | null,
    hiveContext?: string,
    modele?: string,
  ): Promise<void> {
    // Défense en profondeur : l'id sert à construire des chemins locaux — on ne
    // fait pas confiance au hub (anti path-traversal si le hub était compromis).
    if (!ID_PATTERN.test(task.id)) {
      this.send({
        type: 'task_result',
        taskId: task.id.slice(0, 64),
        success: false,
        diff: '',
        logs: '[nœud] id de tâche invalide : refusé',
        durationMs: 0,
        subAgents: [],
      });
      return;
    }
    if (this.active.has(task.id)) return; // assignation dupliquée : déjà en cours
    if (this.active.size >= this.opts.maxConcurrency) {
      // Nœud saturé : on REFUSE l'assignation (task_reject) plutôt que de la
      // marquer en échec — sinon on brûlerait une tentative sans rien exécuter,
      // ce qui pourrait faire échouer définitivement une tâche jamais lancée.
      this.send({ type: 'task_reject', taskId: task.id, reason: 'noeud_sature' });
      return;
    }
    // Night Shift : hors des heures de service du MEMBRE (HIVE_SHIFT, évalué
    // localement sur l'horloge de sa machine), le nœud refuse poliment —
    // aucune tentative brûlée, le hub requalifie et peut servir un autre nœud.
    // retryAfterMs = temps jusqu'à la réouverture : le hub ne re-sollicite pas
    // ce nœud en boucle pendant toute la fenêtre fermée.
    const offShift = this.offShiftReject();
    if (offShift) {
      this.send({ type: 'task_reject', taskId: task.id, ...offShift });
      this.log(`⏾ ${task.title} : ${offShift.reason} → refus`);
      return;
    }

    const ctrl = new AbortController();
    this.active.set(task.id, ctrl);
    const started = Date.now();
    this.send({ type: 'task_update', taskId: task.id, status: 'running' });
    this.log(`butinage : ${task.title} (tentative ${task.attempts + 1})`);

    let workspace: Workspace | null = null;
    try {
      workspace = await prepareWorkspace(
        this.workRoot,
        task,
        repoUrl,
        this.opts.keepEnv ?? [],
        // Isole le répertoire par nœud : deux drones d'une même course sur une
        // même machine (workRoot partagé) ne se marchent pas dessus.
        this.nodeId ? this.nodeId.slice(0, 8) : '',
      );
      // Hive Mind : le contexte reçu du hub est préfixé au prompt pour l'agent.
      // On n'altère que la copie transmise à l'adaptateur (chemins/branche du
      // workspace restent construits sur la tâche d'origine).
      const taskForAgent = hiveContext
        ? { ...task, prompt: composeAgentPrompt(hiveContext, task.prompt) }
        : task;
      const result = await this.adapter.run(taskForAgent, {
        cwd: workspace.cwd,
        env: workspace.env,
        attempt: task.attempts + 1,
        signal: ctrl.signal,
        // Le modèle choisi par l'Aiguillage, s'il en a envoyé un : l'adaptateur
        // le passera à son CLI (`--model`). Absent ⇒ modèle par défaut de l'agent.
        ...(modele ? { modele } : {}),
        ...(this.opts.bac ? { bac: this.opts.bac } : {}),
        onProgress: (p) => {
          this.send({
            type: 'task_update',
            taskId: task.id,
            status: 'running',
            ...(p.subAgents ? { subAgents: p.subAgents } : {}),
            ...(p.log ? { log: p.log } : {}),
          });
        },
      });
      // Échec d'INFRASTRUCTURE (agent injoignable/non authentifié, quota) : on ne
      // brûle PAS une tentative — on demande une réaffectation (token-failover),
      // pour qu'un autre nœud dont l'agent fonctionne reprenne la tâche.
      if (!result.success && result.infra) {
        this.send({
          type: 'task_reject',
          taskId: task.id,
          reason: 'agent indisponible (auth/quota)',
          infra: true,
        });
        this.log(`⇄ ${task.title} : agent indisponible → réaffectation`);
        return;
      }
      // L'adaptateur peut fournir son diff ; sinon le workspace git le calcule.
      const diff = result.diff !== '' ? result.diff : await workspace.collectDiff();
      // Tronquer aux limites du protocole : un diff/log surdimensionné ferait
      // rejeter le message par le hub (fermeture de connexion) et la tâche
      // bouclerait indéfiniment sans jamais aboutir.
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: result.success,
        diff: diff.slice(0, LIMITS.diff),
        logs: result.logs.slice(0, LIMITS.log),
        durationMs: Date.now() - started,
        subAgents: result.subAgents.slice(0, LIMITS.subAgents),
      });
      this.log(`${result.success ? '✔' : '✘'} ${task.title}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: false,
        diff: '',
        logs: `[nœud] exception : ${message}`,
        durationMs: Date.now() - started,
        subAgents: [],
      });
      this.log(`✘ ${task.title} : ${message}`);
    } finally {
      this.active.delete(task.id);
      workspace?.cleanup();
    }
  }

  // ─── Merge (Honeycomb Merge, Palier 3) ───────────────────────────────────
  /**
   * Exécute un merge demandé par le hub : clone le dépôt, applique les diffs dans
   * l'ordre (conflits git réels détectés), lance éventuellement les tests, et
   * remonte le résultat. Ne commit ni ne push jamais (revue humaine).
   */
  private async runMergeJob(msg: AssignMergeMsg): Promise<void> {
    // Anti-doublon : un hub qui réémet le même mergeId ne doit pas lancer deux
    // jobs concurrents sur le même répertoire (course rmSync/clone).
    if (this.activeMerges.has(msg.mergeId)) return;
    // Night Shift : un merge (clone + application des diffs + tests) est du
    // travail au même titre qu'une tâche — refusé hors heures de service.
    const offShift = this.offShiftReject();
    if (offShift) {
      // `refused` : le hub le traite en merge_failed explicite — jamais en
      // succès vide qui écraserait le dernier vrai résultat.
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: `[nœud] ${offShift.reason} : merge refusé (Night Shift)`,
        refused: offShift.reason,
      });
      this.log(`⏾ merge ${msg.mergeId.slice(0, 8)}… : ${offShift.reason} → refus`);
      return;
    }
    // La commande de test s'exécute ICI, sur cette machine. `runMerge` la
    // refuse aussi (c'est la garde qui fait foi) ; on la juge en amont pour ne
    // pas cloner un dépôt pour rien et pour rendre le refus lisible à l'hôte —
    // un « échec du merge » générique ne lui dirait pas qu'on vient de lui
    // demander de lancer un binaire arbitraire.
    //
    // La préparation est jugée ici AUSSI, et pour la même raison : elle
    // s'exécute sur cette machine, et une installation exécute les scripts de
    // ce qu'elle installe.
    const refus = [
      msg.testCommand ? { quoi: 'commande de test', v: jugerCommandeTest(msg.testCommand) } : null,
      msg.prepareCommand ? { quoi: 'préparation', v: jugerPreparation(msg.prepareCommand) } : null,
    ].find((c) => c && !c.v.ok);
    if (refus && !refus.v.ok) {
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: `[nœud] ${refus.quoi} refusée : ${refus.v.motif}`,
        refused: `${refus.quoi} refusée`,
      });
      this.log(`✘ merge ${msg.mergeId.slice(0, 8)}… : ${refus.v.motif}`);
      return;
    }
    this.activeMerges.add(msg.mergeId);
    // mergeId est validé (ID_PATTERN) par le protocole → sûr comme composant de chemin.
    const dir = path.join(
      this.workRoot,
      'merges',
      this.nodeId ? `${msg.mergeId}-${this.nodeId.slice(0, 8)}` : msg.mergeId,
    );
    const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
    this.log(
      `merge ${msg.mergeId.slice(0, 8)}… : clone + intégration de ${msg.diffs.length} diff(s)`,
    );
    try {
      rmSync(dir, rmOpts);
      mkdirSync(path.dirname(dir), { recursive: true });
      await cloneRepo(dir, msg.repoUrl);
      const result = await runMerge({
        repoDir: dir,
        diffs: msg.diffs,
        ...(msg.prepareCommand ? { prepareCommand: msg.prepareCommand } : {}),
        ...(msg.testCommand ? { testCommand: msg.testCommand } : {}),
        // Le bac à sable du nœud suit le merge : la commande de test exécute du
        // code du dépôt, au même titre qu'un agent.
        ...(this.opts.bac ? { bac: this.opts.bac } : {}),
      });
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: result.applied,
        conflicts: result.conflicts,
        mergedDiff: result.mergedDiff.slice(0, LIMITS.diff),
        testsRun: result.testsRun,
        testsPassed: result.testsPassed,
        preparedOk: result.preparedOk,
        logs: result.logs.slice(0, LIMITS.log),
      });
      this.log(
        `merge ${msg.mergeId.slice(0, 8)} : ${result.applied.length} appliqué(s), ${result.conflicts.length} conflit(s)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: `[nœud] échec du merge : ${message}`,
      });
      this.log(`✘ merge ${msg.mergeId.slice(0, 8)} : ${message}`);
    } finally {
      this.activeMerges.delete(msg.mergeId);
      rmSync(dir, rmOpts);
    }
  }

  /**
   * Un CHANTIER : cloner le dépôt, et lancer un travail qu'il DÉCLARE.
   *
   * ─── LA GARDE QUI COMPTE EST ICI, PAS DANS LE HUB ──────────────────────────
   *
   * Le hub a déjà jugé, et son verdict ne suffit pas. Un nœud ne doit pas tenir
   * pour acquis que le hub est bien celui qu'il croit : le jeton de ruche est
   * partagé, les anciennes invitations le portent en clair, et le transport
   * peut être un `ws://` de réseau local. C'est le raisonnement exact qui a
   * fait naître la double garde de `runMerge`, et il vaut à l'identique.
   *
   * Ce qui change tout, ici : le message ne porte AUCUNE commande. Il porte un
   * NOM, et c'est le `package.json` DU CLONE — donc le dépôt lui-même — qui dit
   * ce que ce nom exécute. Un hub compromis ne peut donc désigner que ce que le
   * dépôt déclare déjà. C'est une frontière plus solide que n'importe quelle
   * liste de binaires autorisés, parce qu'elle ne repose sur rien qu'on puisse
   * fournir.
   */
  private async runChantierJob(msg: AssignChantierMsg): Promise<void> {
    // Anti-doublon : un hub qui réémet le même id ne doit pas lancer deux
    // travaux concurrents dans le même répertoire (course rmSync/clone).
    if (this.activeChantiers.has(msg.chantierId)) return;

    const refuser = (raison: string, sortie = ''): void => {
      this.send({
        type: 'chantier_result',
        chantierId: msg.chantierId,
        nom: msg.nom,
        code: null,
        sortie,
        ok: false,
        refused: raison,
      });
      this.log(`✘ chantier « ${msg.nom} » : ${raison}`);
    };

    // Night Shift : un chantier est du travail au même titre qu'un merge.
    const offShift = this.offShiftReject();
    if (offShift) {
      refuser(offShift.reason, `[nœud] ${offShift.reason} : chantier refusé (Night Shift)`);
      return;
    }
    // La préparation s'exécute ICI : une installation exécute les scripts de ce
    // qu'elle installe, et la juger en amont évite de cloner pour rien.
    if (msg.prepareCommand) {
      const v = jugerPreparation(msg.prepareCommand);
      if (!v.ok) {
        refuser('préparation refusée', `[nœud] préparation refusée : ${v.motif}`);
        return;
      }
    }

    this.activeChantiers.add(msg.chantierId);
    // chantierId est validé (ID_PATTERN) par le protocole → sûr en chemin.
    const dir = path.join(
      this.workRoot,
      'chantiers',
      this.nodeId ? `${msg.chantierId}-${this.nodeId.slice(0, 8)}` : msg.chantierId,
    );
    const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
    this.log(`chantier « ${msg.nom} » : clone puis lancement`);
    try {
      rmSync(dir, rmOpts);
      mkdirSync(path.dirname(dir), { recursive: true });
      await cloneRepo(dir, msg.repoUrl);

      // ─── LE DÉPÔT DÉCIDE ────────────────────────────────────────────────
      let scripts: Record<string, string> = {};
      try {
        const brut: unknown = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const bloc =
          typeof brut === 'object' && brut !== null
            ? (brut as Record<string, unknown>).scripts
            : null;
        if (typeof bloc === 'object' && bloc !== null) {
          for (const [k, v] of Object.entries(bloc)) {
            if (typeof v === 'string') scripts[k] = v;
          }
        }
      } catch {
        // Pas de `package.json`, ou illisible : aucun script n'est déclaré.
        // `jugerChantier` le dira mieux que nous, avec le bon message.
        scripts = {};
      }

      const verdict = jugerChantier(scripts, msg.nom);
      if (!verdict.ok) {
        refuser('chantier non déclaré', `[nœud] ${verdict.motif}`);
        return;
      }

      const env = buildSandboxEnv(dir);
      if (msg.prepareCommand && msg.prepareCommand.length > 0) {
        const prep = await runProc(
          msg.prepareCommand,
          dir,
          env,
          10 * 60_000,
          undefined,
          this.opts.bac ? this.opts.bac : undefined,
        );
        // ET SI ELLE ÉCHOUE, ON NE LANCE PAS. Un `npm run test` sur un clone
        // sans `node_modules` échoue pour une raison qui n'a rien à voir avec
        // le code, et le remonter comme un échec de chantier enverrait l'hôte
        // chercher une régression qui n'existe pas.
        if (prep.code !== 0) {
          this.send({
            type: 'chantier_result',
            chantierId: msg.chantierId,
            nom: msg.nom,
            code: prep.code,
            sortie:
              `[nœud] l’environnement n’a pas pu être préparé (code ${prep.code}). Le code du ` +
              `dépôt n’est PAS en cause : vérifiez le réseau de ce nœud, puis son lockfile.\n` +
              prep.output.slice(0, LIMITS.log / 2),
            ok: false,
            refused: 'préparation en échec',
          });
          this.log(`✘ chantier « ${msg.nom} » : préparation en échec`);
          return;
        }
      }

      const { code, output } = await runProc(
        argvDe(msg.nom),
        dir,
        env,
        15 * 60_000,
        undefined,
        this.opts.bac ? this.opts.bac : undefined,
      );
      this.send({
        type: 'chantier_result',
        chantierId: msg.chantierId,
        nom: msg.nom,
        code,
        sortie: output.slice(0, LIMITS.log),
        ok: code === 0,
      });
      this.log(`chantier « ${msg.nom} » : code ${String(code)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        type: 'chantier_result',
        chantierId: msg.chantierId,
        nom: msg.nom,
        code: null,
        sortie: `[nœud] échec du chantier : ${message}`,
        ok: false,
      });
      this.log(`✘ chantier « ${msg.nom} » : ${message}`);
    } finally {
      this.activeChantiers.delete(msg.chantierId);
      rmSync(dir, rmOpts);
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
    // Déconnecté : le message est perdu, mais l'orchestrateur réaffectera la
    // tâche (reap) et l'idempotence des résultats couvre le reste.
  }

  private log(message: string): void {
    if (!this.opts.quiet) console.log(`🐝 [${this.opts.name}] ${message}`);
  }
}
