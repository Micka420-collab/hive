// Serveur de l'orchestrateur (Queen) : Fastify pour le REST + le dashboard
// statique, `ws` pour le temps réel nœuds ↔ hub ↔ dashboard.
// Sécurité : CORS restreint (jamais "*"), token obligatoire (non-trivial hors
// simulation), limite de taille des corps, validation de toutes les entrées.

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { LIMITS, parseClientMessage } from '../shared/protocol.js';
import type { ServerMessage } from '../shared/protocol.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../shared/types.js';
import { Scheduler } from './scheduler.js';
import { HiveStore } from './store.js';

export interface ServerConfig {
  port: number;
  host: string;
  token: string;
  corsOrigins: string[];
  dbPath: string;
  /** Mode démo : tolère le token par défaut (jamais en production). */
  simulation: boolean;
  /** Périodicité du tick du scheduler (ms). */
  tickMs?: number;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number.parseInt(env.HIVE_PORT ?? '7777', 10);
  return {
    port: Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : 7777,
    host: env.HIVE_HOST ?? '127.0.0.1',
    token: env.HIVE_TOKEN ?? DEFAULT_TOKEN,
    corsOrigins: (env.HIVE_CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dbPath: env.HIVE_DB ?? './data/hive.db',
    simulation: env.HIVE_SIMULATION === '1',
  };
}

/** Comparaison de token à temps constant (évite les attaques par chronométrage). */
export function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface HiveServer {
  store: HiveStore;
  scheduler: Scheduler;
  config: ServerConfig;
  /** Port réellement écouté (utile avec port 0 dans les tests). */
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export async function createServer(config: ServerConfig): Promise<HiveServer> {
  // ─── Garde-fous de sécurité, avant toute écoute réseau ─────────────────────
  if (!config.simulation && (config.token === DEFAULT_TOKEN || config.token.length < MIN_TOKEN_LENGTH)) {
    throw new Error(
      `HIVE_TOKEN trivial refusé : définissez un token d'au moins ${MIN_TOKEN_LENGTH} caractères, ` +
        'ou activez HIVE_SIMULATION=1 pour une démo strictement locale.',
    );
  }
  if (config.corsOrigins.length === 0 || config.corsOrigins.includes('*')) {
    throw new Error('HIVE_CORS_ORIGIN doit lister explicitement les origines autorisées (jamais "*").');
  }

  const store = new HiveStore(config.dbPath);

  const nodeSockets = new Map<string, WebSocket>();
  const dashboardSockets = new Set<WebSocket>();
  // Diffusion d'état "sale" : regroupée toutes les 250 ms pour éviter le spam.
  let stateDirty = false;

  const send = (ws: WebSocket, msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const broadcastState = (): void => {
    if (dashboardSockets.size === 0) return;
    const raw = JSON.stringify({ type: 'state', snapshot: store.getSnapshot() } satisfies ServerMessage);
    for (const ws of dashboardSockets) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  };

  const broadcastEvent = (event: ServerMessage): void => {
    for (const ws of dashboardSockets) send(ws, event);
  };

  const scheduler = new Scheduler(store, {
    onAssign: (nodeId, task) => {
      const ws = nodeSockets.get(nodeId);
      // Socket absent ou fermé : le close/reap réaffectera la tâche, rien à faire ici.
      if (ws) {
        const project = store.getProject(task.projectId);
        send(ws, { type: 'assign_task', task, repoUrl: project?.repoUrl ?? null });
      }
    },
    onEvent: (event) => {
      broadcastEvent({ type: 'event', event });
      stateDirty = true;
    },
  });

  /** Événement émis par le serveur lui-même (création de projet/tâches). */
  const emitEvent = (type: string, payload: Record<string, unknown>): void => {
    const event = store.appendEvent(type, payload);
    broadcastEvent({ type: 'event', event });
    stateDirty = true;
  };

  // Reprise après redémarrage : les tâches running orphelines repartent en ready.
  scheduler.recoverAtBoot();

  // ─── HTTP (REST + dashboard) ───────────────────────────────────────────────
  const app = Fastify({ bodyLimit: 1024 * 1024, logger: false });

  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type', 'x-hive-token'],
  });

  const dashboardDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../dashboard/dist',
  );
  if (existsSync(path.join(dashboardDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dashboardDist });
  } else {
    app.get('/', async () => ({
      hive: 'orchestrateur en ligne',
      hint: 'Dashboard non construit : lancez `npm run build:dashboard`.',
    }));
  }

  const authorized = (req: FastifyRequest): boolean =>
    tokenMatches(req.headers['x-hive-token'], config.token);

  const reject = (reply: FastifyReply) => reply.code(401).send({ error: 'token invalide' });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/state', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return store.getSnapshot();
  });

  app.get<{ Querystring: { since?: number; limit?: number } }>(
    '/api/events',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            since: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      return store.listEvents(req.query.since ?? 0, req.query.limit ?? 200);
    },
  );

  app.post<{ Body: { name: string; repoUrl?: string; description?: string } }>(
    '/api/projects',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            repoUrl: { type: 'string', maxLength: 500 },
            description: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const project = store.createProject(req.body);
      emitEvent('project_created', { projectId: project.id, name: project.name });
      return reply.code(201).send(project);
    },
  );

  interface NewTaskBody {
    tasks: { id?: string; title: string; prompt: string; dependsOn?: string[] }[];
  }

  app.post<{ Params: { projectId: string }; Body: NewTaskBody }>(
    '/api/projects/:projectId/tasks',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          required: ['tasks'],
          additionalProperties: false,
          properties: {
            tasks: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['title', 'prompt'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
                  title: { type: 'string', minLength: 1, maxLength: LIMITS.title },
                  prompt: { type: 'string', minLength: 1, maxLength: LIMITS.prompt },
                  dependsOn: {
                    type: 'array',
                    maxItems: 32,
                    items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });

      // Une dépendance doit référencer une tâche existante du projet, ou une
      // tâche du même lot. Les ids fournis ne doivent pas entrer en collision.
      const existingIds = new Set(store.listTasks(project.id).map((t) => t.id));
      const batchIds = new Set<string>();
      for (const t of req.body.tasks) {
        if (t.id) {
          if (existingIds.has(t.id) || batchIds.has(t.id) || store.getTask(t.id)) {
            return reply.code(400).send({ error: `id de tâche déjà utilisé : ${t.id}` });
          }
          batchIds.add(t.id);
        }
      }
      for (const t of req.body.tasks) {
        for (const dep of t.dependsOn ?? []) {
          if (!existingIds.has(dep) && !batchIds.has(dep)) {
            return reply.code(400).send({ error: `dépendance inconnue : ${dep}` });
          }
        }
      }

      const created = req.body.tasks.map((t) =>
        store.createTask({
          id: t.id,
          projectId: project.id,
          title: t.title,
          prompt: t.prompt,
          dependsOn: t.dependsOn ?? [],
        }),
      );
      for (const t of created) {
        emitEvent('task_created', { taskId: t.id, projectId: project.id, title: t.title });
      }
      scheduler.tick(); // promotion + assignation immédiates
      return reply.code(201).send(created);
    },
  );

  // Le diff d'une tâche remonte pour revue humaine — jamais de merge automatique.
  app.get<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/results',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      return store.resultsForTask(req.params.taskId);
    },
  );

  await app.listen({ port: config.port, host: config.host });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;

  // ─── WebSocket temps réel ──────────────────────────────────────────────────
  const wss = new WebSocketServer({
    server: app.server,
    path: '/ws',
    maxPayload: LIMITS.message,
  });

  wss.on('connection', (ws, req) => {
    // Connexions navigateur : l'origine doit être autorisée (dashboard servi
    // par l'orchestrateur lui-même, ou origine listée dans HIVE_CORS_ORIGIN).
    const origin = req.headers.origin;
    if (origin) {
      const sameHost = origin === `http://${req.headers.host}`;
      if (!sameHost && !config.corsOrigins.includes(origin)) {
        ws.close(4403, 'origine non autorisée');
        return;
      }
    }

    let role: 'unknown' | 'node' | 'dashboard' = 'unknown';
    let nodeId: string | null = null;

    // Sans authentification dans les 5 s, la connexion est fermée.
    const authTimer = setTimeout(() => {
      if (role === 'unknown') ws.close(4401, 'authentification requise');
    }, 5_000);
    authTimer.unref?.();

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        ws.close(4400, 'binaire refusé');
        return;
      }
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        ws.close(4400, 'message invalide');
        return;
      }

      // Premier message : authentification (register = nœud, subscribe = dashboard).
      if (role === 'unknown') {
        if (msg.type === 'register') {
          if (!tokenMatches(msg.token, config.token)) {
            ws.close(4401, 'token invalide');
            return;
          }
          role = 'node';
          clearTimeout(authTimer);
          const node = scheduler.registerNode({
            nodeId: msg.nodeId,
            name: msg.name,
            ownerName: msg.ownerName,
            agentType: msg.agentType,
            maxConcurrency: msg.maxConcurrency,
          });
          nodeId = node.id;
          const previous = nodeSockets.get(node.id);
          if (previous && previous !== ws) previous.close(4000, 'remplacé par une nouvelle connexion');
          nodeSockets.set(node.id, ws);
          send(ws, { type: 'registered', nodeId: node.id });
          stateDirty = true;
        } else if (msg.type === 'subscribe') {
          if (!tokenMatches(msg.token, config.token)) {
            ws.close(4401, 'token invalide');
            return;
          }
          role = 'dashboard';
          clearTimeout(authTimer);
          dashboardSockets.add(ws);
          send(ws, { type: 'state', snapshot: store.getSnapshot() });
        } else {
          ws.close(4401, 'authentification requise');
        }
        return;
      }

      if (role !== 'node' || nodeId === null) return; // le dashboard est en lecture seule

      switch (msg.type) {
        case 'heartbeat':
          scheduler.heartbeat(nodeId);
          break;
        case 'task_update':
          scheduler.handleTaskUpdate(nodeId, msg.taskId, msg.subAgents, msg.log);
          break;
        case 'task_result':
          scheduler.handleTaskResult(nodeId, {
            taskId: msg.taskId,
            success: msg.success,
            diff: msg.diff,
            logs: msg.logs,
            durationMs: msg.durationMs,
            subAgents: msg.subAgents,
          });
          break;
        default:
          break; // register/subscribe répétés : ignorés
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (role === 'node' && nodeId !== null && nodeSockets.get(nodeId) === ws) {
        nodeSockets.delete(nodeId);
        scheduler.nodeDisconnected(nodeId, 'ws_closed');
        stateDirty = true;
      }
      if (role === 'dashboard') dashboardSockets.delete(ws);
    });

    ws.on('error', () => {
      // rien : l'événement close suivra et fera le ménage
    });
  });

  // ─── Boucles périodiques ───────────────────────────────────────────────────
  const tickTimer = setInterval(() => {
    scheduler.tick();
  }, config.tickMs ?? 2_000);
  tickTimer.unref();

  const flushTimer = setInterval(() => {
    if (stateDirty) {
      stateDirty = false;
      broadcastState();
    }
  }, 250);
  flushTimer.unref();

  const stop = async (): Promise<void> => {
    clearInterval(tickTimer);
    clearInterval(flushTimer);
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await app.close();
    store.close();
  };

  return {
    store,
    scheduler,
    config,
    port,
    url: `http://${config.host}:${port}`,
    stop,
  };
}
