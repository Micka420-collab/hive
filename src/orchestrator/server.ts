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
import { hashPassword, verifyPassword, signJwt, verifyJwt, isValidEmail } from './auth.js';
import { encodeInvite, isWsUrl } from '../shared/invite.js';
import { isValidRepoUrl, LIMITS, parseClientMessage } from '../shared/protocol.js';
import type { MergeResultMsg, ServerMessage } from '../shared/protocol.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../shared/types.js';
import type { HiveEvent, Task } from '../shared/types.js';
import { CORPUS_BALANCE, estimerCout, peserLaRuche, VERSION_BALANCE } from './balance.js';
import type { CompteTache, Devis, Pesee } from './balance.js';
import { leconsDesEchecs } from './brood.js';
import { askConcierge } from './concierge.js';
import type { ConciergeContext } from './concierge.js';
import { detectGhosts } from './ghost.js';
import { buildHiveContext } from './hive-mind.js';
import { buildMergePlan } from './honeycomb.js';
import { tally, signatureOf } from './parliament.js';
import type { Ballot } from './parliament.js';
import { CacheDomaines, domaineDeTache, replierTraces } from './pheromones.js';
import type { Domaine, TraceePheromone } from './pheromones.js';
import { anthropicLlm, llmPlannerAvailable, planBrief } from './planner.js';
import { buildProjectReport } from './project-report.js';
import { computePulse } from './pulse.js';
import { buildTimeline } from './replay.js';
import { detectConflicts } from './sting-detector.js';
import { Scheduler } from './scheduler.js';
import { HiveStore } from './store.js';
import { lireTemperature, FENETRE_MS as FENETRE_THERMO_MS, TYPES_THERMO } from './thermo.js';
import { buildWaggleBoard } from './waggle.js';

/** Plafond de messages WS traités par socket et par seconde (anti-DoS). */
const WS_MSG_PER_SEC = 100;

/** Nombre d'événements conservés dans le journal (les plus anciens sont purgés). */
const EVENT_RETENTION = 5_000;

/** Nombre de souvenirs Hive Mind conservés (les plus anciens sont purgés). */
const MEMORY_RETENTION = 2_000;

/**
 * Nombre de résultats conservés INTACTS. Au-delà, seules les colonnes lourdes
 * (`diff`, `logs`) sont vidées — la ligne, elle, survit pour la Miellerie, le
 * Parlement et les phéromones (voir `HiveStore.pruneResults`). Aligné sur
 * EVENT_RETENTION : les deux racontent la même histoire récente.
 */
const RESULT_RETENTION = 5_000;

/**
 * Mémoïsation de /api/pheromones : le repli est identique d'une seconde à
 * l'autre (corpus de 500 résultats, demi-vie de 7 jours). Sans ce TTL, N
 * dashboards en polling déclenchaient N calculs concurrents sur le même tick.
 */
const PHEROMONES_TTL_MS = 3_000;

/**
 * Mémoïsation de la Balance — même raisonnement que PHEROMONES_TTL_MS : N
 * dashboards en polling sur /api/balance ne doivent pas déclencher N lectures
 * identiques du corpus de 2 000 résultats. Le TTL porte sur la LECTURE (la
 * seule I/O) ; les replis dérivés sont calculés une fois par socle.
 */
const BALANCE_TTL_MS = 3_000;

/** Un merge sans résultat au-delà de ce délai est déclaré échoué (orphelin). */
const MERGE_TIMEOUT_MS = 10 * 60_000;

/**
 * Couveuse : part du hiveContext réservée aux leçons des échecs précédents
 * d'une tâche ré-assignée. Le reste du budget (LIMITS.hiveContext au total)
 * revient à la mémoire Hive Mind.
 */
const BUDGET_COUVEUSE = 3_000;

/** Limitation de débit REST : fenêtre et nombre maximal de requêtes /api par IP. */
const REST_RATE_WINDOW_MS = 10_000;
const REST_RATE_MAX = 400;

/** Reconstitue un abstract depuis l'index inversé d'OpenAlex. */
function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words.push([word, pos]);
  }
  words.sort((a, b) => a[1] - b[1]);
  return words.map(([w]) => w).join(' ');
}

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
  /**
   * HIVE_BALANCE : off | observation | strict. Défaut `observation` — la ruche
   * pèse ce qu'elle dépense sans jamais rien bloquer. Optionnel ici (et non
   * requis comme le reste) pour que tout appelant existant de `createServer`
   * continue de compiler : l'ajout de la Balance ne casse aucun contrat.
   */
  balance?: 'off' | 'observation' | 'strict';
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
    // Toute valeur inconnue retombe sur le défaut : une faute de frappe ne doit
    // jamais éteindre silencieusement la pesée.
    balance:
      env.HIVE_BALANCE === 'off' || env.HIVE_BALANCE === 'strict'
        ? env.HIVE_BALANCE
        : 'observation',
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
  // État de service Night Shift déclaré par chaque nœud (heartbeat.onShift).
  // Absent = disponible. Sert à éviter d'office un nœud hors service pour un
  // merge (les tâches, elles, sont couvertes par task_reject + cooldown).
  const nodeOnShift = new Map<string, boolean>();
  // Honeycomb Merge : dernier résultat de merge par projet + suivi des merges en
  // cours (routage mergeId→projet, nœud, âge — pour détecter les orphelins).
  const mergeResults = new Map<string, MergeResultMsg>();
  const pendingMerges = new Map<string, { projectId: string; nodeId: string; startedAt: number }>();
  // Diffusion d'état "sale" : regroupée toutes les 250 ms pour éviter le spam.
  let stateDirty = false;
  // Phéromones : cache de domaines (borné) et mémoïsation à TTL court du repli
  // servi par /api/pheromones — N dashboards en polling = 1 calcul.
  const cacheDomaines = new CacheDomaines();
  let pheromonesMemo: { calculeA: number; traces: TraceePheromone[] } | null = null;

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

  /** Événement émis par le serveur lui-même (création de projet/tâches). */
  const emitEvent = (type: string, payload: Record<string, unknown>): void => {
    const event = store.appendEvent(type, payload);
    broadcastEvent({ type: 'event', event });
    stateDirty = true;
  };

  /**
   * Contexte joint à `assign_task` : leçons de la Couveuse (tâche déjà échouée)
   * puis souvenirs du Hive Mind, dans le budget total LIMITS.hiveContext.
   * PARTAGÉ par les deux chemins de livraison — l'assignation initiale ET la
   * re-livraison de secours des tâches muettes : sans cela, une tâche re-servie
   * repartait sans les leçons pourtant annoncées par `brood_context`.
   * Ne journalise rien (la re-livraison a lieu à chaque tick) : l'appelant
   * décide s'il émet `brood_context`.
   */
  const construireHiveContext = (task: Task): { hiveContext: string; echecs: number } => {
    // Couveuse : les leçons des échecs précédents viennent EN TÊTE (le plus
    // spécifique d'abord). Le nom du nœud fautif est résolu ici — la table
    // results ne garde que son id.
    const echecs = task.attempts > 0 ? store.listFailedResultsForTask(task.id) : [];
    const lecons =
      echecs.length > 0
        ? leconsDesEchecs(
            echecs.map((e, i) => ({
              attempt: i + 1,
              nodeName: store.getNode(e.nodeId)?.name ?? e.nodeId,
              logs: e.logs,
              createdAt: e.createdAt,
            })),
            BUDGET_COUVEUSE,
          )
        : '';
    // Hive Mind : souvenirs pertinents des tâches déjà réussies, dans le budget
    // RESTANT après la Couveuse (« \n\n » de jonction compris).
    const souvenirs = buildHiveContext(
      store.searchMemories(`${task.title} ${task.prompt}`, 3),
      LIMITS.hiveContext - (lecons ? lecons.length + 2 : 0),
    );
    return {
      hiveContext: [lecons, souvenirs].filter(Boolean).join('\n\n'),
      echecs: lecons ? echecs.length : 0,
    };
  };

  // ─── La Balance : socle de lecture, pesée et devis ─────────────────────────
  //
  // Tout part d'UNE lecture bornée (≤ CORPUS_BALANCE résultats, index couvrant)
  // mémoïsée BALANCE_TTL_MS : la pesée et les échantillons de devis en sont des
  // replis PURS, recalculés une seule fois par socle. Rien n'est jamais écrit.
  interface SocleBalance {
    calculeA: number;
    corpus: ReturnType<HiveStore['listResultsForBalance']>;
    taches: Map<string, CompteTache>;
    /** Replis dérivés, calculés à la demande et gardés le temps du socle. */
    pesee?: Pesee;
    echantillons?: Map<Domaine, number[]>;
  }
  let socleBalance: SocleBalance | null = null;

  const lireSocleBalance = (now = Date.now()): SocleBalance => {
    if (socleBalance && now - socleBalance.calculeA < BALANCE_TTL_MS) return socleBalance;
    const corpus = store.listResultsForBalance();
    // Lecture par clé primaire des SEULES tâches citées par le corpus — jamais
    // un dépliage de la table `tasks`.
    const comptes = store.listTaskComptes([...new Set(corpus.map((r) => r.taskId))]);
    const revues = store.listReviews();
    socleBalance = {
      calculeA: now,
      corpus,
      taches: new Map(
        comptes.map((c) => [
          c.id,
          { projectId: c.projectId, status: c.status, revue: revues[c.id] ?? null },
        ]),
      ),
    };
    return socleBalance;
  };

  const peser = (now = Date.now()): Pesee => {
    const socle = lireSocleBalance(now);
    socle.pesee ??= peserLaRuche(socle.corpus, socle.taches);
    return socle.pesee;
  };

  /**
   * Échantillons de coût par domaine : le TOTAL par tâche (toutes tentatives
   * confondues — reprises comprises, c'est ce qu'une tâche coûte vraiment), sur
   * les seules tâches ABOUTIES du corpus. Une tâche encore en vol n'a pas fini
   * de dépenser : l'inclure sous-estimerait le devis.
   */
  const echantillonsBalance = (now = Date.now()): Map<Domaine, number[]> => {
    const socle = lireSocleBalance(now);
    if (socle.echantillons) return socle.echantillons;
    const totaux = new Map<string, number>();
    for (const r of socle.corpus) {
      if (socle.taches.get(r.taskId)?.status !== 'done') continue;
      totaux.set(r.taskId, (totaux.get(r.taskId) ?? 0) + Math.max(0, r.durationMs));
    }
    const domaines = cacheDomaines.domaines([...totaux.keys()], (manquants) =>
      store.listTaskTexts(manquants),
    );
    const parDomaine = new Map<Domaine, number[]>();
    for (const [taskId, total] of totaux) {
      const domaine = domaines.get(taskId);
      if (!domaine) continue;
      const liste = parDomaine.get(domaine);
      if (liste) liste.push(total);
      else parDomaine.set(domaine, [total]);
    }
    socle.echantillons = parDomaine;
    return parDomaine;
  };

  /** Devis d'un lot de tâches proposées : par tâche, puis en total. */
  interface DevisPlan {
    parTache: Array<{ title: string; domaine: Domaine } & Devis>;
    /**
     * Somme des médianes et somme des p90. Ce ne sont ni la médiane ni le p90
     * de la somme : le total p90 est une borne PESSIMISTE, qui suppose que
     * toutes les tâches ont un mauvais jour en même temps. Assumé et affiché
     * comme tel — un devis se lit comme un ordre de grandeur.
     */
    totalMedianeMs: number;
    totalP90Ms: number;
  }

  /**
   * Chiffre un lot de tâches PROPOSÉES (pas encore en base, donc classées
   * directement par `domaineDeTache`, sans cache par id). Silencieux — `null` —
   * quand aucun domaine n'atteint ECHANTILLON_MIN_DEVIS tâches comparables :
   * jamais de fausse précision.
   *
   * Le devis est un NOMBRE destiné à l'affichage. Aucun texte d'agent n'entre
   * ici, et rien de ceci ne repart dans un prompt : le jour où un titre devrait
   * y retourner, il passerait obligatoirement par `champSurUneLigne` /
   * `blocDonnees` (src/shared/donnees-non-fiables.ts).
   */
  const chiffrerDevis = (
    taches: ReadonlyArray<{ title: string; prompt: string }>,
  ): DevisPlan | null => {
    const echantillons = echantillonsBalance();
    const parTache: DevisPlan['parTache'] = [];
    for (const tache of taches) {
      const domaine = domaineDeTache(tache.title, tache.prompt);
      const devis = estimerCout(domaine, echantillons.get(domaine) ?? []);
      if (devis) parTache.push({ title: tache.title, ...devis });
    }
    if (parTache.length === 0) return null;
    return {
      parTache,
      totalMedianeMs: parTache.reduce((s, d) => s + d.medianeMs, 0),
      totalP90Ms: parTache.reduce((s, d) => s + d.p90Ms, 0),
    };
  };

  /**
   * Enrobage NON BLOQUANT : un devis qui échoue ne casse jamais un plan. La
   * Balance est une lecture ; elle n'a le droit de faire échouer aucune route.
   */
  const devisSansRisque = (
    taches: ReadonlyArray<{ title: string; prompt: string }>,
  ): DevisPlan | null => {
    try {
      return chiffrerDevis(taches);
    } catch (err) {
      console.error(`[hive] devis indisponible : ${err instanceof Error ? err.message : err}`);
      return null;
    }
  };

  const scheduler = new Scheduler(store, {
    // Balance : le grand livre suit la table `results` et n'influence RIEN.
    balance: { mode: config.balance ?? 'observation' },
    // Drone Wars : annuler le travail d'un drone perdant (ou d'une course annulée).
    onCancel: (nodeId, taskId, reason) => {
      const ws = nodeSockets.get(nodeId);
      if (ws) send(ws, { type: 'cancel_task', taskId, reason });
    },
    onAssign: (nodeId, task) => {
      const ws = nodeSockets.get(nodeId);
      // Socket absent ou fermé : le close/reap réaffectera la tâche, rien à faire ici.
      if (ws) {
        const project = store.getProject(task.projectId);
        const { hiveContext, echecs } = construireHiveContext(task);
        // Couveuse : la ré-assignation d'une tâche déjà échouée est journalisée
        // ici seulement (payload de faits typés, texte reconstruit à l'affichage).
        if (echecs > 0) emitEvent('brood_context', { taskId: task.id, nodeId, echecs });
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

  /** Requête authentifiée par JWT utilisateur. */
  interface AuthRequest extends FastifyRequest {
    userId?: string;
  }

  const authorizedUser = (req: FastifyRequest): boolean => {
    const bearer = req.headers.authorization;
    if (!bearer || !bearer.startsWith('Bearer ')) return false;
    const token = bearer.slice(7);
    const payload = verifyJwt(token);
    if (!payload) return false;
    (req as AuthRequest).userId = payload.sub;
    return true;
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/state', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return store.getSnapshot();
  });

  // ─── Auth routes ──────────────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string; displayName: string } }>(
    '/api/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password', 'displayName'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            password: { type: 'string', minLength: 8, maxLength: 256 },
            displayName: { type: 'string', minLength: 2, maxLength: 80 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password, displayName } = req.body;
      if (!isValidEmail(email)) return reply.status(400).send({ error: 'Email invalide' });
      if (!password || password.length < 8)
        return reply.status(400).send({ error: 'Mot de passe trop court (min 8 caractères)' });
      if (!displayName || displayName.length < 2)
        return reply.status(400).send({ error: 'Nom trop court' });
      if (store.getUserByEmail(email))
        return reply.status(409).send({ error: 'Email déjà utilisé' });
      const user = store.createUser({
        email,
        passwordHash: hashPassword(password),
        displayName,
      });
      return { token: signJwt(user.id, user.email) };
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const user = store.getUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash))
        return reply.status(401).send({ error: 'Email ou mot de passe incorrect' });
      return { token: signJwt(user.id, user.email) };
    },
  );

  app.get('/api/auth/me', async (req, reply) => {
    if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
    const userId = (req as AuthRequest).userId!;
    const user = store.getUserById(userId);
    if (!user) return reply.status(404).send({ error: 'Utilisateur introuvable' });
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return publicUser;
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

  // Ghost in the Hive : détection d'anomalies (nœuds flaky/silencieux, tâches en
  // boucle…) par repli du journal. Lecture seule ; pagination interne bornée par
  // EVENT_RETENTION (le store plafonne chaque page à 1000).
  app.get('/api/ghost', async (req, reply) => {
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
    return detectGhosts(events);
  });

  // Hive Pulse : signes vitaux agrégés (débit, latence p50/p95, taux de succès,
  // nœuds actifs) par repli du journal. Lecture seule ; pagination interne bornée.
  app.get('/api/pulse', async (req, reply) => {
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
    return computePulse(events);
  });

  // Thermorégulation : la température INSTANTANÉE (dérivée de la fenêtre de
  // 10 minutes) ET l'état hystérésé réellement APPLIQUÉ par le scheduler — les
  // deux peuvent diverger brièvement, c'est précisément le rôle de
  // l'hystérésis. Deux noms distincts pour deux sémantiques distinctes.
  app.get('/api/thermo', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const now = Date.now();
    const instantane = lireTemperature(
      store.listEventsInWindow(now - FENETRE_THERMO_MS, TYPES_THERMO),
      now,
    );
    return { instantane, applique: scheduler.thermo };
  });

  // Phéromones : affinité apprise nœud × domaine (qui réussit quel TYPE de
  // tâche), repliée à la demande depuis les résultats récents — vue dérivée
  // pure, jamais matérialisée. Lecture seule ; bornée aux 30 premières traces.
  // Chemin BORNÉ, identique à celui du Scheduler : ≤ 500 résultats, domaine
  // résolu par clé primaire pour les seules tâches citées, mémoïsé.
  app.get('/api/pheromones', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const now = Date.now();
    if (!pheromonesMemo || now - pheromonesMemo.calculeA >= PHEROMONES_TTL_MS) {
      const resultats = store.listResultsForPheromones();
      const domaines = cacheDomaines.domaines(
        resultats.map((r) => r.taskId),
        (manquants) => store.listTaskTexts(manquants),
      );
      pheromonesMemo = { calculeA: now, traces: replierTraces(domaines, resultats, now) };
    }
    return { traces: pheromonesMemo.traces.slice(0, 30) };
  });

  // La Balance : où est passé le temps-ouvrière que la ruche a emprunté à ses
  // membres. Vue dérivée PURE, recalculée depuis un corpus borné — jamais
  // matérialisée, jamais écrite. `fenetre` dit sur combien de tentatives
  // l'imputation a été faite, `aJour` si le grand livre a fini son rattrapage :
  // un chiffre qui ne dit pas ce qu'il n'a pas vu est un chiffre qui ment.
  //
  // `durationMs` mesure le temps machine PRÊTÉ, pas le travail accompli : c'est
  // la bonne unité pour dire ce que la ruche a consommé chez ses membres, et
  // une très mauvaise pour juger un nœud. Le tableau par nœud n'est donc jamais
  // trié en « pire contributeur » (balance.ts, doctrine règle 4).
  app.get('/api/balance', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const balance = scheduler.balance;
    return {
      version: VERSION_BALANCE,
      mode: balance.mode,
      aJour: balance.aJour,
      pesee: peser(),
      soldes: balance.soldes,
      fenetre: CORPUS_BALANCE,
    };
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
        // Balance (prévoir) : ce que ce DAG devrait coûter, d'après les tâches
        // comparables déjà terminées. Purement indicatif, jamais bloquant, et
        // `null` tant que l'échantillon est maigre.
        return { ...result, devis: devisSansRisque(result.tasks) };
      } catch (err) {
        // Mode 'llm' explicite ayant échoué : on remonte l'erreur telle quelle.
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // La Reine répond : dialogue en langage naturel avec la ruche. Réponses
  // composées depuis l'état RÉEL (rapports, pouls, nectar, anomalies, mémoire) ;
  // bascule sur l'IA (clé locale à la Queen) si disponible, repli live sinon.
  app.post<{ Body: { message: string; projectId?: string } }>(
    '/api/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 2000 },
            projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
          },
        },
      },
    },
    async (req, reply) => {
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
      const projects = store.listProjects();
      // Focus fourni → un seul rapport à construire (progressReply filtre déjà
      // dessus) ; sinon un rapport par projet.
      const focusId = req.body.projectId ?? null;
      const reportProjects = focusId ? projects.filter((p) => p.id === focusId) : projects;
      const ctx: ConciergeContext = {
        projects,
        nodes: store.listNodes(),
        reports: reportProjects.map((p) => buildProjectReport(p, store.listTasks(p.id))),
        pulse: computePulse(events),
        waggle: buildWaggleBoard(events),
        ghosts: detectGhosts(events).ghosts,
        memories: store.searchMemories(req.body.message, 3).map((s) => s.memory),
        recentEvents: events.slice(-100),
        reviews: store.listReviews(),
        // Scopé sur le projet ciblé quand il est fourni : la Reine ne mélange
        // pas les revues d'un autre projet dans sa réponse.
        finishedTasks: store
          .listTasks(focusId ?? undefined)
          .filter((t) => t.status === 'done' || t.status === 'failed')
          .map((t) => ({ id: t.id, title: t.title, status: t.status as 'done' | 'failed' })),
        races: scheduler.listRaces().map((r) => ({
          taskId: r.taskId,
          title: store.getTask(r.taskId)?.title ?? r.taskId,
          drones: r.drones.map((d) => ({ nodeId: d.nodeId, status: d.status })),
        })),
        focusProjectId: req.body.projectId ?? null,
      };
      const llm = llmPlannerAvailable() ? anthropicLlm() : undefined;
      return askConcierge(req.body.message, ctx, llm ? { llm } : {});
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

  // Rapport d'avancement d'un projet (lecture seule) : avancement %, répartition
  // par statut, nœuds contributeurs. Calculé à partir des tâches du projet.
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/report',
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
      return buildProjectReport(project, store.listTasks(project.id));
    },
  );

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
  app.post<{ Params: { projectId: string }; Body: { testCommand?: string[]; taskIds?: string[] } }>(
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
            // Sélection de revue (Miellerie) : n'intégrer QUE ces tâches.
            taskIds: {
              type: 'array',
              minItems: 1,
              maxItems: LIMITS.mergeDiffs,
              items: { type: 'string', minLength: 1, maxLength: LIMITS.id },
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
      // Le serveur est la SOURCE DE VÉRITÉ des revues : une tâche rejetée en
      // revue ne coule jamais dans le miel, quel que soit le cache du client.
      const reviews = store.listReviews();
      // Sélection optionnelle (revue humaine) : chaque id doit être une tâche
      // done DE CE projet, non rejetée — on refuse explicitement plutôt que
      // d'ignorer.
      const selection = req.body.taskIds ? new Set(req.body.taskIds) : null;
      if (selection) {
        const byId = new Map(tasks.map((t) => [t.id, t]));
        for (const id of selection) {
          const t = byId.get(id);
          if (!t) return reply.code(400).send({ error: `tâche hors projet : ${id}` });
          if (t.status !== 'done') {
            return reply.code(400).send({ error: `tâche non terminée : ${t.title}` });
          }
          if (reviews[id] === 'rejected') {
            return reply.code(400).send({ error: `tâche rejetée en revue : ${t.title}` });
          }
        }
      }
      const doneDiffs = new Map<string, string>();
      let rejectedSkipped = 0;
      for (const t of tasks) {
        if (t.status !== 'done') continue;
        if (selection && !selection.has(t.id)) continue;
        // Sans sélection explicite, les tâches rejetées sont exclues d'office.
        if (!selection && reviews[t.id] === 'rejected') {
          rejectedSkipped++;
          continue;
        }
        const success = store
          .resultsForTask(t.id)
          .filter((r) => r.success)
          .at(-1);
        if (success) doneDiffs.set(t.id, success.diff);
      }
      const plan = buildMergePlan(tasks, doneDiffs);
      if (plan.done === 0 || doneDiffs.size === 0) {
        return reply.code(400).send({
          error:
            rejectedSkipped > 0
              ? 'toutes les tâches terminées sont rejetées en revue — rien à intégrer'
              : 'aucune tâche terminée à intégrer',
        });
      }
      // Ordre topologique du plan, restreint aux tâches réellement à intégrer
      // (sélection de revue et/ou porteuses d'un diff).
      const diffs = plan.order
        .filter((taskId) => doneDiffs.has(taskId))
        .map((taskId) => ({ taskId, diff: doneDiffs.get(taskId) ?? '' }));
      if (diffs.length === 0) {
        return reply.code(400).send({ error: 'aucun diff à intégrer pour cette sélection' });
      }
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
      // Choisir un nœud en ligne, connecté ET de service (Night Shift) : un
      // nœud hors service refuserait le merge — autant l'éviter d'office.
      const node = store
        .listNodes()
        .find(
          (n) => n.status === 'online' && nodeSockets.has(n.id) && (nodeOnShift.get(n.id) ?? true),
        );
      const ws = node ? nodeSockets.get(node.id) : undefined;
      if (!node || !ws) {
        return reply
          .code(503)
          .send({ error: 'aucun nœud en ligne et de service pour exécuter le merge' });
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

  // Revue humaine (Miellerie) : verdict approved/rejected partagé entre tous
  // les opérateurs. `state: null` efface la revue. La revue n'a AUCUN effet de
  // bord sur la tâche — c'est un avis humain, le merge reste un geste séparé.
  app.post<{
    Params: { taskId: string };
    Body: {
      state: 'approved' | 'rejected' | null;
      expectedUpdatedAt?: number | null;
      clientId?: string;
    };
  }>(
    '/api/tasks/:taskId/review',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          required: ['state'],
          additionalProperties: false,
          properties: {
            state: { type: ['string', 'null'], enum: ['approved', 'rejected', null] },
            // Compare-and-set OPT-IN : horodatage du verdict que le client
            // croyait courant (null = « aucun verdict »). 409 si décalage —
            // un geste posé sur une vision périmée ne l'emporte jamais.
            expectedUpdatedAt: { type: ['integer', 'null'] },
            // Identité d'onglet (écho dans task_reviewed) : permet au client
            // de distinguer ses propres échos de ceux des autres opérateurs.
            clientId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const task = store.getTask(req.params.taskId);
      if (!task) return reply.code(404).send({ error: 'tâche inconnue' });
      // Pas de pré-approbation : on ne juge un diff qu'une fois la tâche
      // terminée (409 comme /cancel pour les conflits d'état). L'effacement
      // (null) reste permis quel que soit le statut — toujours sûr.
      if (req.body.state !== null && task.status !== 'done' && task.status !== 'failed') {
        return reply.code(409).send({
          code: 'task_not_terminal',
          error: `tâche ${task.status} — revue possible seulement après terminaison`,
        });
      }
      if (req.body.expectedUpdatedAt !== undefined) {
        const current = store.getTaskReview(task.id);
        const currentTs = current?.updatedAt ?? null;
        if (currentTs !== req.body.expectedUpdatedAt) {
          return reply.code(409).send({
            code: 'review_conflict',
            error: 'verdict modifié par un autre opérateur — rechargez la revue',
            currentState: current?.state ?? null,
            currentUpdatedAt: currentTs,
          });
        }
      }
      store.setTaskReview(task.id, req.body.state);
      emitEvent('task_reviewed', {
        taskId: task.id,
        state: req.body.state,
        ...(req.body.clientId ? { clientId: req.body.clientId } : {}),
      });
      const saved = store.getTaskReview(task.id);
      return { taskId: task.id, state: req.body.state, updatedAt: saved?.updatedAt ?? null };
    },
  );

  // Toutes les revues (dictionnaire taskId → verdict) — hydrate le dashboard.
  // `updatedAt` : horodatages par tâche, pour le compare-and-set opt-in.
  app.get('/api/reviews', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return { reviews: store.listReviews(), updatedAt: store.listReviewTimestamps() };
  });

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

  // Drone Wars : lance une course compétitive — la même tâche (ready) confiée
  // à jusqu'à `factor` nœuds distincts, le premier succès gagne, les perdants
  // sont annulés. Geste explicite (jamais automatique), pour tâches critiques.
  app.post<{ Params: { taskId: string }; Body: { factor?: number } }>(
    '/api/tasks/:taskId/race',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { factor: { type: 'integer', minimum: 2, maximum: 5 } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const started = scheduler.startRace(req.params.taskId, req.body.factor ?? 3);
      if (!started.ok) {
        const code = started.error.includes('inconnue')
          ? 404
          : started.error.includes('aucun nœud')
            ? 503
            : 409;
        return reply.code(code).send({ error: started.error });
      }
      return reply.code(202).send({ taskId: req.params.taskId, drones: started.drones });
    },
  );

  // État d'une course en vol (null si aucune) — pour le dashboard/CLI.
  app.get<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/race',
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
      const race = scheduler.getRace(req.params.taskId) ?? null;
      if (race) return { race, victory: null };
      // Course déjà tranchée : le journal garde la victoire (drone_won) —
      // permet au tiroir d'afficher le vainqueur après coup.
      const won = store.lastEventFor('drone_won', req.params.taskId);
      const victory =
        won && typeof won.payload.nodeId === 'string'
          ? {
              nodeId: won.payload.nodeId,
              cancelled: typeof won.payload.cancelled === 'number' ? won.payload.cancelled : 0,
            }
          : null;
      return { race: null, victory };
    },
  );

  // Toutes les courses en vol — permet au dashboard de marquer d'un ⚔ les
  // nœuds actuellement en course (les courses vivent en mémoire du scheduler).
  app.get('/api/races', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return { races: scheduler.listRaces() };
  });

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
      // La notification cancel_task part du scheduler (onCancel) : primaire en
      // mono, TOUS les drones en course — plus d'envoi manuel dupliqué ici.
      const cancelled = scheduler.cancelTask(task.id, 'annulée par un humain');
      stateDirty = true;
      return cancelled;
    },
  );

  // ─── Queen Bee : découpage IA d'un brief en tâches ──────────────────────────
  interface BriefBody {
    brief: string;
    language?: string;
  }

  app.post<{ Params: { projectId: string }; Body: BriefBody }>(
    '/api/projects/:projectId/brief',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          required: ['brief'],
          additionalProperties: false,
          properties: {
            brief: { type: 'string', minLength: 10, maxLength: 5000 },
            language: { type: 'string', maxLength: 30 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });

      // Import dynamique : le module Queen Bee ne se charge que si on l'utilise.
      const { briefToDAG, loadQueenBeeConfig } = await import('./queen-bee.js');
      const beeConfig = loadQueenBeeConfig(process.env);
      if (!beeConfig.apiKey) {
        return reply.code(500).send({
          error: 'QUEEN_BEE_API_KEY non configurée. Définissez cette variable (clé OpenRouter).',
        });
      }
      if (req.body.language) beeConfig.language = req.body.language;

      try {
        const result = await briefToDAG(req.body.brief, beeConfig);
        // Générer des ids automatiques si absents
        const tasks = result.tasks.map((t, i) => ({
          ...t,
          id: t.id ?? `T${i + 1}`,
        }));
        // Injecter les tâches directement
        const created = tasks.map((t) =>
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
        scheduler.tick();
        return reply.code(201).send({
          tasks: created,
          rationale: result.rationale,
          model: result.model,
          // Balance (prévoir) : même devis indicatif que /api/plan.
          devis: devisSansRisque(created),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(422).send({ error: message });
      }
    },
  );

  // ─── Marketplace ───────────────────────────────────────────────────────────
  // Projets publics — accessible sans authentification.
  app.get('/api/projects/public', async (_req, reply) => {
    const projects = store.listPublicProjects();
    return reply.send(projects);
  });

  // Créer un projet (via JWT utilisateur). Accepte visibility + ownerId.
  app.post<{
    Body: {
      name: string;
      repoUrl?: string;
      description?: string;
      visibility?: 'public' | 'private';
    };
  }>(
    '/api/projects/user',
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
            visibility: { type: 'string', enum: ['public', 'private'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      if (req.body.repoUrl !== undefined && !isValidRepoUrl(req.body.repoUrl)) {
        return reply.code(400).send({
          error: 'repoUrl invalide',
        });
      }
      const userId = (req as AuthRequest).userId!;
      const project = store.createProject({
        ...req.body,
        ownerId: userId,
      });
      // Ajoute automatiquement le créateur comme membre
      store.addMember(project.id, userId, 'owner');
      emitEvent('project_created', { projectId: project.id, name: project.name, userId });
      return reply.code(201).send(project);
    },
  );

  // Rejoindre un projet
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/join',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      const userId = (req as AuthRequest).userId!;
      store.addMember(project.id, userId);
      emitEvent('project_member_joined', { projectId: project.id, userId });
      return reply.send({ joined: true, projectId: project.id });
    },
  );

  // Lister les membres d'un projet
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/members',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      return reply.send(store.listMembers(project.id));
    },
  );

  // Projets de l'utilisateur connecté
  app.get('/api/user/projects', async (req, reply) => {
    if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
    const userId = (req as AuthRequest).userId!;
    return reply.send(store.listUserProjects(userId));
  });

  // ─── OpenAlex : moteur de recherche scientifique ────────────────────────────
  // Proxy vers l'API OpenAlex (gratuite, pas de clé). Accessible sans auth.
  // Docs : https://docs.openalex.org/api-reference
  app.get<{ Querystring: { q?: string; page?: string; filter?: string; sort?: string } }>(
    '/api/openalex/search',
    async (req, reply) => {
      const { q, page, filter, sort } = req.query;
      if (!q || q.length < 2)
        return reply.status(400).send({ error: 'Requête trop courte (min 2 caractères)' });

      const params = new URLSearchParams();
      params.set('search', q);
      if (page) params.set('page', page);
      if (filter) params.set('filter', filter);
      if (sort) params.set('sort', sort);
      else params.set('sort', 'cited_by_count:desc');
      params.set('per_page', '20');

      // Email "polite" pour lever le rate-limit (recommandé par OpenAlex)
      const email = process.env.OPENALEX_EMAIL || 'shellia.delcato@gmail.com';

      try {
        const res = await fetch(`https://api.openalex.org/works?${params}`, {
          headers: { 'User-Agent': `Hive/0.1 (mailto:${email})` },
        });
        if (!res.ok) {
          return reply.status(res.status).send({
            error: `OpenAlex a répondu ${res.status}`,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json()) as any;
        // Formater pour le dashboard : ne garder que les champs utiles
        const results = (data.results ?? []).map((w: Record<string, unknown>) => ({
          id: w.id,
          title: w.title,
          doi: w.doi,
          year: w.publication_year,
          citedBy: w.cited_by_count,
          authors: ((w.authorships as Array<Record<string, unknown>>) ?? [])
            .slice(0, 5)
            .map((a) => a.author && (a.author as Record<string, string>).display_name)
            .filter(Boolean),
          abstract: ((w.abstract_inverted_index as Record<string, number[]>) != null
            ? reconstructAbstract(w.abstract_inverted_index as Record<string, number[]>)
            : null
          )?.slice(0, 500),
          type: w.type,
          openAccess: (w.open_access as Record<string, unknown>)?.is_oa ?? false,
          url: (w.open_access as Record<string, unknown>)?.oa_url ?? w.doi,
        }));
        return reply.send({
          total: data.meta?.count ?? 0,
          page: data.meta?.page ?? 1,
          perPage: data.meta?.per_page ?? 20,
          results,
        });
      } catch (err) {
        return reply
          .status(502)
          .send({ error: `Erreur OpenAlex : ${err instanceof Error ? err.message : err}` });
      }
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
            if (msg.onShift !== undefined) nodeOnShift.set(nodeId, msg.onShift);
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
            // retryAfterMs (Night Shift) allonge le cooldown de re-sollicitation.
            scheduler.rejectTask(
              nodeId,
              msg.taskId,
              msg.reason,
              msg.infra ?? false,
              Date.now(),
              msg.retryAfterMs,
            );
            break;
          case 'merge_result': {
            // Honeycomb Merge : range le résultat pour le projet demandeur.
            // Un REFUS du nœud (Night Shift…) est un échec explicite — jamais
            // consigné comme un merge « réussi » vide.
            if (msg.refused) {
              failMerge(msg.mergeId, msg.refused);
              break;
            }
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
        nodeOnShift.delete(nodeId);
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
      // Pour une course, TOUS les drones en vol sont re-servis (un assign_task
      // perdu vers un drone non-primaire n'est visible nulle part ailleurs).
      for (const task of scheduler.staleAssignedTasks(5_000)) {
        const project = store.getProject(task.projectId);
        const race = scheduler.getRace(task.id);
        const targets = race
          ? race.drones.filter((d) => d.status === 'running').map((d) => d.nodeId)
          : task.assignedNodeId
            ? [task.assignedNodeId]
            : [];
        // Le contexte (Couveuse + Hive Mind) est reconstruit ici AUSSI : une
        // re-livraison nue priverait la tâche des leçons annoncées par
        // brood_context — l'ouvrière refaisait la même erreur.
        const { hiveContext } = construireHiveContext(task);
        for (const nodeId of targets) {
          const ws = nodeSockets.get(nodeId);
          if (ws) {
            send(ws, {
              type: 'assign_task',
              task,
              repoUrl: project?.repoUrl ?? null,
              ...(hiveContext ? { hiveContext } : {}),
            });
          }
        }
      }
      // Borne la croissance du journal, de la mémoire Hive Mind et des résultats.
      store.pruneEvents(EVENT_RETENTION);
      store.pruneMemories(MEMORY_RETENTION);
      store.pruneResults(RESULT_RETENTION);
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
