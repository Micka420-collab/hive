// Serveur de l'orchestrateur (Queen) : Fastify pour le REST + le dashboard
// statique, `ws` pour le temps réel nœuds ↔ hub ↔ dashboard.
// Sécurité : CORS restreint (jamais "*"), token obligatoire (non-trivial hors
// simulation), limite de taille des corps, validation de toutes les entrées.

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { encodeInvite, isWsUrl } from '../shared/invite.js';
import { isValidRepoUrl, LIMITS, parseClientMessage } from '../shared/protocol.js';
import type { MergeResultMsg, ServerMessage } from '../shared/protocol.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../shared/types.js';
import type { HiveEvent } from '../shared/types.js';
import { buildHiveContext } from './hive-mind.js';
import { buildMergePlan } from './honeycomb.js';
import { tally, signatureOf } from './parliament.js';
import type { Ballot } from './parliament.js';
import { planBrief } from './planner.js';
import { buildTimeline } from './replay.js';
import { detectConflicts } from './sting-detector.js';
import { Scheduler } from './scheduler.js';
import { HiveStore } from './store.js';
import { buildWaggleBoard } from './waggle.js';

/** Plafond de messages WS traités par socket et par seconde (anti-DoS). */
const WS_MSG_PER_SEC = 100;

/** Nombre d'événements conservés dans le journal (les plus anciens sont purgés). */
const EVENT_RETENTION = 5_000;

/** Nombre de souvenirs Hive Mind conservés (les plus anciens sont purgés). */
const MEMORY_RETENTION = 2_000;

/** Un merge sans résultat au-delà de ce délai est déclaré échoué (orphelin). */
const MERGE_TIMEOUT_MS = 10 * 60_000;

/** Limitation de débit REST : fenêtre et nombre maximal de requêtes /api par IP. */
const REST_RATE_WINDOW_MS = 10_000;
const REST_RATE_MAX = 400;

export interface ServerConfig {
  port: number;
  host: string;
  token: string;
  corsOrigins: string[];
  dbPath: string;
  /** Mode démo : tolère le token par défaut (jamais en production). */
  simulation: boolean;
  /** URL WebSocket publique annoncée dans les invitations (HIVE_PUBLIC_URL). */
  publicUrl?: string;
  /** Périodicité du tick du scheduler (ms). */
  tickMs?: number;
}

/**
 * Devine l'adresse WebSocket joignable de cette machine depuis le réseau local
 * (première IPv4 non interne). Sert d'URL par défaut dans les invitations quand
 * HIVE_PUBLIC_URL n'est pas défini. L'hôte peut toujours la corriger.
 */
export function detectLanWsUrl(port: number): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return `ws://${addr.address}:${port}/ws`;
      }
    }
  }
  return `ws://localhost:${port}/ws`;
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
    ...(env.HIVE_PUBLIC_URL ? { publicUrl: env.HIVE_PUBLIC_URL } : {}),
  };
}

/**
 * Détecte un cycle de dépendances au sein d'un lot de tâches (uniquement les
 * tâches portant un id, seules référençables). Retourne le chemin du cycle, ou
 * null s'il n'y en a pas. DFS à trois couleurs (0 = neuf, 1 = en cours, 2 = fini).
 */
export function findCycle(tasks: { id?: string; dependsOn?: string[] }[]): string[] | null {
  const deps = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.id) deps.set(t.id, t.dependsOn ?? []);
  }
  const color = new Map<string, number>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    color.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue; // dépendance hors lot : déjà validée par ailleurs
      const c = color.get(dep) ?? 0;
      if (c === 1) return [...stack.slice(stack.indexOf(dep)), dep]; // cycle trouvé
      if (c === 0) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };

  for (const id of deps.keys()) {
    if ((color.get(id) ?? 0) === 0) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
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
  if (
    !config.simulation &&
    (config.token === DEFAULT_TOKEN || config.token.length < MIN_TOKEN_LENGTH)
  ) {
    throw new Error(
      `HIVE_TOKEN trivial refusé : définissez un token d'au moins ${MIN_TOKEN_LENGTH} caractères, ` +
        'ou activez HIVE_SIMULATION=1 pour une démo strictement locale.',
    );
  }
  if (config.corsOrigins.length === 0 || config.corsOrigins.includes('*')) {
    throw new Error(
      'HIVE_CORS_ORIGIN doit lister explicitement les origines autorisées (jamais "*").',
    );
  }

  const store = new HiveStore(config.dbPath);

  const nodeSockets = new Map<string, WebSocket>();
  const dashboardSockets = new Set<WebSocket>();
  // Honeycomb Merge : dernier résultat de merge par projet + suivi des merges en
  // cours (routage mergeId→projet, nœud, âge — pour détecter les orphelins).
  const mergeResults = new Map<string, MergeResultMsg>();
  const pendingMerges = new Map<string, { projectId: string; nodeId: string; startedAt: number }>();
  // Diffusion d'état "sale" : regroupée toutes les 250 ms pour éviter le spam.
  let stateDirty = false;

  const send = (ws: WebSocket, msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const broadcastState = (): void => {
    if (dashboardSockets.size === 0) return;
    const raw = JSON.stringify({
      type: 'state',
      snapshot: store.getSnapshot(),
    } satisfies ServerMessage);
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
        // Hive Mind : joindre les souvenirs pertinents des tâches déjà réussies.
        const hiveContext = buildHiveContext(
          store.searchMemories(`${task.title} ${task.prompt}`, 3),
        );
        send(ws, {
          type: 'assign_task',
          task,
          repoUrl: project?.repoUrl ?? null,
          ...(hiveContext ? { hiveContext } : {}),
        });
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

  /**
   * Marque un merge en cours comme échoué (nœud déconnecté, timeout) : range un
   * résultat d'échec pour que /merge/result ne reste pas `null` éternellement, et
   * libère l'entrée (anti-fuite mémoire). Honeycomb Merge est advisory/v0 : les
   * merges en cours ne survivent PAS à un redémarrage de l'orchestrateur.
   */
  const failMerge = (mergeId: string, reason: string): void => {
    const pending = pendingMerges.get(mergeId);
    if (!pending) return;
    pendingMerges.delete(mergeId);
    mergeResults.set(pending.projectId, {
      type: 'merge_result',
      mergeId,
      applied: [],
      conflicts: [],
      mergedDiff: '',
      testsRun: false,
      testsPassed: null,
      logs: `[hub] merge interrompu : ${reason}`,
    });
    emitEvent('merge_failed', { projectId: pending.projectId, mergeId, reason });
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

  // Limitation de débit des routes /api par IP (fenêtre glissante) : défense en
  // profondeur contre un flood REST, en complément du plafond côté WebSocket.
  const apiHits = new Map<string, { count: number; resetAt: number }>();
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const now = Date.now();
    let h = apiHits.get(req.ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + REST_RATE_WINDOW_MS };
      apiHits.set(req.ip, h);
    }
    h.count += 1;
    if (h.count > REST_RATE_MAX) {
      return reply.code(429).send({ error: 'trop de requêtes, réessayez dans un instant' });
    }
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

  // Génère une invitation à envoyer à un ami : elle encode l'URL WS publique + le
  // token. L'ami la colle dans `npm run join <invitation>`. ⚠ Elle contient le
  // token : c'est un secret, à transmettre par un canal privé.
  app.get<{ Querystring: { url?: string; label?: string } }>(
    '/api/invite',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', maxLength: 300 },
            label: { type: 'string', maxLength: LIMITS.name },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      // URL joignable : ?url= explicite > HIVE_PUBLIC_URL > IP LAN détectée.
      const wsUrl = req.query.url ?? config.publicUrl ?? detectLanWsUrl(port);
      if (!isWsUrl(wsUrl)) {
        return reply.code(400).send({ error: 'url doit être un ws:// ou wss:// valide' });
      }
      const label = req.query.label ?? `Ruche Hive (${config.host}:${port})`;
      const invite = encodeInvite({ url: wsUrl, token: config.token, label });
      return {
        invite,
        url: wsUrl,
        label,
        joinCommand: `npm run join -- ${invite}`,
        note: "Cette invitation contient le token de la ruche : ne la partagez qu'avec des personnes de confiance.",
      };
    },
  );

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

  // Time-Lapse Replay : rejoue le journal pour renvoyer une frise chronologique
  // (une image par événement) + le résumé de l'état final. Lecture seule. La
  // pagination interne (le store plafonne chaque page à 1000) est bornée par
  // EVENT_RETENTION pour éviter tout abus.
  app.get<{ Querystring: { since?: number; limit?: number } }>(
    '/api/replay',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            since: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: EVENT_RETENTION },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const cap = req.query.limit ?? EVENT_RETENTION;
      const events: HiveEvent[] = [];
      let cursor = req.query.since ?? 0;
      for (;;) {
        const remaining = cap - events.length;
        if (remaining <= 0) break;
        const page = store.listEvents(cursor, Math.min(1000, remaining));
        if (page.length === 0) break;
        events.push(...page);
        const last = page[page.length - 1];
        if (!last) break;
        cursor = last.id;
      }
      return buildTimeline(events);
    },
  );

  // Waggle Board : classement de contribution des nœuds (nectar), calculé en
  // repliant le journal. Lecture seule. Pagination interne bornée par
  // EVENT_RETENTION (le store plafonne chaque page à 1000).
  app.get('/api/waggle', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const events: HiveEvent[] = [];
    let cursor = 0;
    for (;;) {
      if (events.length >= EVENT_RETENTION) break;
      const page = store.listEvents(cursor, Math.min(1000, EVENT_RETENTION - events.length));
      if (page.length === 0) break;
      events.push(...page);
      const last = page[page.length - 1];
      if (!last) break;
      cursor = last.id;
    }
    return buildWaggleBoard(events);
  });

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
      // repoUrl atteint `git clone` sur chaque nœud : refuser tout schéma non sûr
      // (le transport ext:: de git = exécution de commande arbitraire = RCE).
      if (req.body.repoUrl !== undefined && !isValidRepoUrl(req.body.repoUrl)) {
        return reply.code(400).send({
          error: 'repoUrl invalide : schémas autorisés http(s)/git/ssh ou chemin local absolu',
        });
      }
      const project = store.createProject(req.body);
      emitEvent('project_created', { projectId: project.id, name: project.name });
      return reply.code(201).send(project);
    },
  );

  // Queen Bee (Palier 2) : propose un DAG de tâches à partir d'un brief en
  // langage naturel. Sans effet de bord — la sortie est destinée à être revue,
  // ajustée, puis envoyée via POST /api/projects/:id/tasks. Découpage heuristique
  // par défaut (hors-ligne) ; bascule sur l'IA si une clé API locale est présente.
  app.post<{ Body: { brief: string; mode?: 'auto' | 'heuristic' | 'llm' } }>(
    '/api/plan',
    {
      schema: {
        body: {
          type: 'object',
          required: ['brief'],
          additionalProperties: false,
          properties: {
            brief: { type: 'string', minLength: 1, maxLength: 4000 },
            mode: { type: 'string', enum: ['auto', 'heuristic', 'llm'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      try {
        const result = await planBrief(req.body.brief, { mode: req.body.mode ?? 'auto' });
        if (result.tasks.length === 0) {
          return reply.code(422).send({ error: 'brief trop court pour en déduire des tâches' });
        }
        return result;
      } catch (err) {
        // Mode 'llm' explicite ayant échoué : on remonte l'erreur telle quelle.
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // Hive Mind : interroger la mémoire partagée. Sans `q`, renvoie les souvenirs
  // les plus récents ; avec `q`, les plus pertinents (BM25) et leur score.
  app.get<{ Querystring: { q?: string; limit?: number } }>(
    '/api/hive-mind',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 2000 },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const q = req.query.q?.trim();
      const limit = req.query.limit ?? 5;
      const total = store.countMemories();
      if (!q) {
        return { total, memories: store.listMemories(limit).map((m) => ({ ...m, score: null })) };
      }
      const memories = store
        .searchMemories(q, limit)
        .map((s) => ({ ...s.memory, score: Number(s.score.toFixed(3)) }));
      return { total, memories };
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
          if (t.id && dep === t.id) {
            return reply.code(400).send({ error: `tâche dépendante d'elle-même : ${t.id}` });
          }
          if (!existingIds.has(dep) && !batchIds.has(dep)) {
            return reply.code(400).send({ error: `dépendance inconnue : ${dep}` });
          }
        }
      }

      // Détection de cycle intra-lot : sans elle, des tâches mutuellement
      // dépendantes resteraient « pending » à jamais, sans erreur visible.
      const cycle = findCycle(req.body.tasks);
      if (cycle) {
        return reply
          .code(400)
          .send({ error: `cycle de dépendances détecté : ${cycle.join(' → ')}` });
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
      // Sting Detector : signaler (sans bloquer) les conflits potentiels que ce
      // nouveau lot introduit — visible dans le journal du dashboard.
      const newIds = new Set(created.map((t) => t.id));
      for (const c of detectConflicts(store.listTasks(project.id))) {
        if (newIds.has(c.a) || newIds.has(c.b)) {
          emitEvent('conflict_detected', {
            projectId: project.id,
            a: c.a,
            b: c.b,
            severity: c.severity,
            ...(c.sharedPaths.length ? { sharedPaths: c.sharedPaths } : {}),
          });
        }
      }
      scheduler.tick(); // promotion + assignation immédiates
      return reply.code(201).send(created);
    },
  );

  // Sting Detector : conflits potentiels au sein d'un projet (analyse advisory).
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/conflicts',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      return { conflicts: detectConflicts(store.listTasks(project.id)) };
    },
  );

  // Honeycomb Merge (Palier 3) : plan d'intégration d'un projet — ordre de merge
  // (dépendances d'abord) + conflits de lignes entre diffs des tâches terminées.
  // Advisory : n'effectue ni merge git ni exécution de tests (côté nœud, différé).
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/merge',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      const tasks = store.listTasks(project.id);
      const diffs = new Map<string, string>();
      for (const t of tasks) {
        if (t.status !== 'done') continue;
        const success = store
          .resultsForTask(t.id)
          .filter((r) => r.success)
          .at(-1);
        if (success) diffs.set(t.id, success.diff);
      }
      return buildMergePlan(tasks, diffs);
    },
  );

  // Honeycomb Merge — déclenche l'exécution réelle du merge sur un nœud : clone,
  // application des diffs dans l'ordre du plan (conflits git réels), tests
  // optionnels. Asynchrone : le résultat revient via merge_result, à lire sur
  // /merge/result. Ne commit ni ne push jamais.
  app.post<{ Params: { projectId: string }; Body: { testCommand?: string[] } }>(
    '/api/projects/:projectId/merge/run',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            testCommand: {
              type: 'array',
              minItems: 1,
              maxItems: LIMITS.testArgs,
              items: { type: 'string', minLength: 1, maxLength: LIMITS.arg },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      if (!project.repoUrl) {
        return reply
          .code(400)
          .send({ error: 'le projet doit avoir un dépôt (repoUrl) pour un merge' });
      }
      const tasks = store.listTasks(project.id);
      const doneDiffs = new Map<string, string>();
      for (const t of tasks) {
        if (t.status !== 'done') continue;
        const success = store
          .resultsForTask(t.id)
          .filter((r) => r.success)
          .at(-1);
        if (success) doneDiffs.set(t.id, success.diff);
      }
      const plan = buildMergePlan(tasks, doneDiffs);
      if (plan.done === 0) {
        return reply.code(400).send({ error: 'aucune tâche terminée à intégrer' });
      }
      const diffs = plan.order.map((taskId) => ({ taskId, diff: doneDiffs.get(taskId) ?? '' }));
      // Le nœud rejette silencieusement un assign_merge > LIMITS.mergeDiffs : on
      // borne ici pour renvoyer une erreur claire plutôt que de perdre le merge.
      if (diffs.length > LIMITS.mergeDiffs) {
        return reply
          .code(413)
          .send({ error: `trop de tâches à intégrer (> ${LIMITS.mergeDiffs}) pour un merge (v0)` });
      }
      const totalBytes = diffs.reduce((s, d) => s + d.diff.length, 0);
      if (totalBytes > 1_500_000) {
        return reply.code(413).send({ error: 'diffs trop volumineux pour un merge (v0)' });
      }
      // Choisir un nœud en ligne effectivement connecté.
      const node = store.listNodes().find((n) => n.status === 'online' && nodeSockets.has(n.id));
      const ws = node ? nodeSockets.get(node.id) : undefined;
      if (!node || !ws) {
        return reply.code(503).send({ error: 'aucun nœud en ligne pour exécuter le merge' });
      }
      const mergeId = randomUUID();
      pendingMerges.set(mergeId, { projectId: project.id, nodeId: node.id, startedAt: Date.now() });
      send(ws, {
        type: 'assign_merge',
        mergeId,
        repoUrl: project.repoUrl,
        diffs,
        ...(req.body.testCommand ? { testCommand: req.body.testCommand } : {}),
      });
      emitEvent('merge_started', {
        projectId: project.id,
        mergeId,
        nodeId: node.id,
        diffs: diffs.length,
      });
      return reply.code(202).send({ mergeId, nodeId: node.id, order: plan.order });
    },
  );

  // Dernier résultat de merge d'un projet (null tant qu'aucun n'a abouti).
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/merge/result',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      return { result: mergeResults.get(req.params.projectId) ?? null };
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

  // Parlement des Agents : consensus par vote sur les résultats d'une tâche.
  // Lecture seule : on charge les résultats stockés, on en fait des bulletins
  // (signature = empreinte du diff, agentType retrouvé via le nœud) et on
  // dépouille. Utile quand plusieurs nœuds ont produit un résultat pour la même
  // tâche (tentatives multiples, futurs drones).
  app.get<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/consensus',
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
      const ballots: Ballot[] = store.resultsForTask(req.params.taskId).map((r) => ({
        nodeId: r.nodeId,
        agentType: store.getNode(r.nodeId)?.agentType ?? 'inconnu',
        success: r.success,
        signature: signatureOf(r.diff),
      }));
      return tally(ballots);
    },
  );

  // Annulation humaine d'une tâche : le nœud reçoit cancel_task et abandonne.
  app.post<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/cancel',
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
      const task = store.getTask(req.params.taskId);
      if (!task) return reply.code(404).send({ error: 'tâche inconnue' });
      if (task.status === 'done' || task.status === 'failed') {
        return reply.code(409).send({ error: `tâche déjà ${task.status}` });
      }
      const nodeId = task.assignedNodeId;
      const cancelled = scheduler.cancelTask(task.id, 'demande_humaine');
      if (nodeId) {
        const nodeWs = nodeSockets.get(nodeId);
        if (nodeWs) {
          send(nodeWs, { type: 'cancel_task', taskId: task.id, reason: 'annulée par un humain' });
        }
      }
      stateDirty = true;
      return cancelled;
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

    // Limitation de débit par socket (anti-DoS/amplification) : un nœud
    // authentifié ne peut pas noyer le hub et tous les dashboards de messages.
    // Token bucket rechargé chaque seconde.
    let budget = WS_MSG_PER_SEC;
    const budgetTimer = setInterval(() => {
      budget = WS_MSG_PER_SEC;
    }, 1_000);
    budgetTimer.unref?.();

    // Sans authentification dans les 5 s, la connexion est fermée.
    const authTimer = setTimeout(() => {
      if (role === 'unknown') ws.close(4401, 'authentification requise');
    }, 5_000);
    authTimer.unref?.();

    ws.on('message', (data, isBinary) => {
      // Toute exception (ex. écriture SQLite qui échoue) est confinée à ce
      // message : elle ferme la connexion fautive sans abattre l'orchestrateur.
      try {
        if (isBinary) {
          ws.close(4400, 'binaire refusé');
          return;
        }
        if (--budget < 0) {
          ws.close(4429, 'débit de messages excessif');
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
            if (previous && previous !== ws)
              previous.close(4000, 'remplacé par une nouvelle connexion');
            nodeSockets.set(node.id, ws);
            send(ws, { type: 'registered', nodeId: node.id });
            // Réconciliation : requalifier les tâches que le nœud ne fait plus
            // tourner (crash/redémarrage), et demander l'abandon de ses zombies
            // (tâches déjà réaffectées ailleurs après un blip réseau).
            const { zombies } = scheduler.reconcileNode(node.id, msg.activeTasks ?? []);
            for (const taskId of zombies) {
              send(ws, { type: 'cancel_task', taskId, reason: 'tâche réaffectée' });
            }
            // Le socket est branché : on peut maintenant assigner des tâches au nœud.
            scheduler.tick();
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
          case 'task_reject':
            // Refus d'assignation (saturation, ou agent en panne → infra) :
            // requeue sans brûler de tentative ; le token-failover gère l'infra.
            scheduler.rejectTask(nodeId, msg.taskId, msg.reason, msg.infra ?? false);
            break;
          case 'merge_result': {
            // Honeycomb Merge : range le résultat pour le projet demandeur.
            const pending = pendingMerges.get(msg.mergeId);
            if (pending) {
              mergeResults.set(pending.projectId, msg);
              pendingMerges.delete(msg.mergeId);
              emitEvent('merge_completed', {
                projectId: pending.projectId,
                mergeId: msg.mergeId,
                applied: msg.applied.length,
                conflicts: msg.conflicts.length,
                testsPassed: msg.testsPassed,
              });
            }
            break;
          }
          default:
            break; // register/subscribe répétés : ignorés
        }
      } catch (err) {
        console.error(
          `[hive] erreur de traitement WS : ${err instanceof Error ? err.message : err}`,
        );
        try {
          ws.close(1011, 'erreur interne');
        } catch {
          /* socket déjà fermé */
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(budgetTimer);
      if (role === 'node' && nodeId !== null && nodeSockets.get(nodeId) === ws) {
        nodeSockets.delete(nodeId);
        scheduler.nodeDisconnected(nodeId, 'ws_closed');
        // Un merge confié à ce nœud ne reviendra jamais : le déclarer échoué
        // (sinon /merge/result resterait null et l'entrée fuirait).
        for (const [mergeId, pending] of pendingMerges) {
          if (pending.nodeId === nodeId) failMerge(mergeId, 'nœud déconnecté');
        }
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
    // Une exception ici (ex. SQLite verrouillé) ne doit pas arrêter la boucle
    // ni abattre le process : on journalise et on retentera au prochain tick.
    try {
      scheduler.tick();
      // Filet de sécurité : re-livre `assign_task` pour les tâches assignées
      // restées muettes (message perdu en vol). Le client ignore les doublons.
      for (const task of scheduler.staleAssignedTasks(5_000)) {
        const ws = task.assignedNodeId ? nodeSockets.get(task.assignedNodeId) : undefined;
        if (ws) {
          const project = store.getProject(task.projectId);
          send(ws, { type: 'assign_task', task, repoUrl: project?.repoUrl ?? null });
        }
      }
      // Borne la croissance du journal d'événements et de la mémoire Hive Mind.
      store.pruneEvents(EVENT_RETENTION);
      store.pruneMemories(MEMORY_RETENTION);
      // Purge des compteurs de débit expirés (borne la map par IP).
      const now = Date.now();
      for (const [ip, h] of apiHits) {
        if (h.resetAt <= now) apiHits.delete(ip);
      }
      // Merges orphelins (nœud muet au-delà du délai) → échec, pas de blocage.
      for (const [mergeId, pending] of pendingMerges) {
        if (now - pending.startedAt > MERGE_TIMEOUT_MS) failMerge(mergeId, 'délai dépassé');
      }
    } catch (err) {
      console.error(`[hive] erreur de tick : ${err instanceof Error ? err.message : err}`);
    }
  }, config.tickMs ?? 2_000);
  tickTimer.unref();

  const flushTimer = setInterval(() => {
    try {
      if (stateDirty) {
        stateDirty = false;
        broadcastState();
      }
    } catch (err) {
      console.error(
        `[hive] erreur de diffusion d'état : ${err instanceof Error ? err.message : err}`,
      );
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
