// Client de nœud membre : rejoint la ruche en WebSocket, reçoit des tâches
// poussées par l'orchestrateur, les exécute via un AgentAdapter dans un
// workspace isolé, remonte progrès et résultats. Reconnexion automatique
// avec backoff exponentiel ; heartbeat découplé de l'exécution.
// Consentement (§5.3) : rien ne s'exécute tant que le membre n'a pas lancé
// ce client lui-même.

import path from 'node:path';
import WebSocket from 'ws';
import { getAdapter } from '../adapters/index.js';
import type { AgentAdapter } from '../adapters/index.js';
import { ID_PATTERN, LIMITS, parseServerMessage } from '../shared/protocol.js';
import type { ClientMessage } from '../shared/protocol.js';
import { HEARTBEAT_INTERVAL_MS } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { prepareWorkspace } from './workspace.js';
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
}

export class HiveNodeClient {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private readonly active = new Map<string, AbortController>();
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
        void this.runTask(msg.task, msg.repoUrl ?? null, msg.hiveContext);
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
      this.send({ type: 'heartbeat', running: this.active.size });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
    this.send({ type: 'heartbeat', running: this.active.size });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // ─── Exécution d'une tâche ───────────────────────────────────────────────
  private async runTask(task: Task, repoUrl: string | null, hiveContext?: string): Promise<void> {
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

    const ctrl = new AbortController();
    this.active.set(task.id, ctrl);
    const started = Date.now();
    this.send({ type: 'task_update', taskId: task.id, status: 'running' });
    this.log(`butinage : ${task.title} (tentative ${task.attempts + 1})`);

    let workspace: Workspace | null = null;
    try {
      workspace = await prepareWorkspace(this.workRoot, task, repoUrl, this.opts.keepEnv ?? []);
      // Hive Mind : le contexte reçu du hub est préfixé au prompt pour l'agent.
      // On n'altère que la copie transmise à l'adaptateur (chemins/branche du
      // workspace restent construits sur la tâche d'origine).
      const taskForAgent = hiveContext
        ? { ...task, prompt: `${hiveContext}\n\n${task.prompt}`.slice(0, LIMITS.prompt) }
        : task;
      const result = await this.adapter.run(taskForAgent, {
        cwd: workspace.cwd,
        env: workspace.env,
        attempt: task.attempts + 1,
        signal: ctrl.signal,
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
