// Liaison temps réel avec l'orchestrateur : le dashboard s'abonne au flux
// WebSocket (snapshots d'état + journal d'événements). Le token est mémorisé
// localement ; en mode simulation, la valeur par défaut suffit.

import { t as tNow } from './i18n';
import { parseServerMessage } from '../../src/shared/protocol';
import type { HiveEvent, Project, StateSnapshot, Task, TaskResult } from '../../src/shared/types';

const TOKEN_KEY = 'hive.token';
export const DEFAULT_TOKEN = 'change-me';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? DEFAULT_TOKEN;
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Erreur API porteuse du statut HTTP (0 = réseau) — permet de distinguer un
 * échec transitoire (réseau, 5xx) d'un échec définitif (404 tâche disparue). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** fetch authentifié qui lève une ApiError lisible sur réponse non-OK. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-hive-token': getToken(), ...init?.headers },
  });
  if (!res.ok) {
    let message = tNow(`Erreur ${res.status}`, `Error ${res.status}`);
    try {
      // Endpoints custom → { error } (déjà précis). Validation de schéma Fastify
      // → { message } détaillé + { error: "Bad Request" } générique : le message
      // est alors le plus utile, on le préfère quand il est présent.
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* corps non-JSON */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export interface NewTaskInput {
  id?: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
}

/** Crée un projet. */
export function createProject(input: {
  name: string;
  repoUrl?: string;
  description?: string;
}): Promise<Project> {
  return api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) });
}

/** Ajoute un lot de tâches (DAG) à un projet. */
export function addTasks(projectId: string, tasks: NewTaskInput[]): Promise<Task[]> {
  return api<Task[]>(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
}

export interface PlanResponse {
  tasks: NewTaskInput[];
  source: 'heuristic' | 'llm';
  note?: string;
  /**
   * La Balance (prévoir) : devis indicatif du DAG proposé. `undefined` sur un
   * orchestrateur plus ancien (la route ne le renvoyait pas), `null` quand
   * aucun domaine n'atteint l'échantillon minimal — les deux se lisent de la
   * même façon à l'affichage : SILENCE, jamais « 0 ».
   */
  devis?: DevisPlan | null;
}

/** Queen Bee : génère un DAG de tâches à partir d'un brief (Palier 2). */
export function planBrief(
  brief: string,
  mode: 'auto' | 'heuristic' | 'llm' = 'auto',
): Promise<PlanResponse> {
  return api<PlanResponse>('/api/plan', { method: 'POST', body: JSON.stringify({ brief, mode }) });
}

/** Résultats (diff/logs) d'une tâche, pour revue humaine. */
export function fetchResults(taskId: string): Promise<TaskResult[]> {
  return api<TaskResult[]>(`/api/tasks/${taskId}/results`);
}

export interface Memory {
  id: number;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
  score: number | null;
}

/** Hive Mind : souvenirs pertinents (avec `q`) ou récents. */
export function fetchMemories(
  q?: string,
  limit = 8,
): Promise<{ total: number; memories: Memory[] }> {
  const query =
    q && q.trim() ? `?q=${encodeURIComponent(q.trim())}&limit=${limit}` : `?limit=${limit}`;
  return api<{ total: number; memories: Memory[] }>(`/api/hive-mind${query}`);
}

export interface Conflict {
  a: string;
  b: string;
  severity: 'high' | 'low';
  sharedPaths: string[];
  sharedTerms: string[];
}

/** Sting Detector : conflits potentiels d'un projet. */
export function fetchConflicts(projectId: string): Promise<{ conflicts: Conflict[] }> {
  return api<{ conflicts: Conflict[] }>(`/api/projects/${projectId}/conflicts`);
}

/** Annule une tâche (le nœud abandonne). */
export function cancelTask(taskId: string): Promise<Task> {
  return api<Task>(`/api/tasks/${taskId}/cancel`, { method: 'POST', body: '{}' });
}

/** Drone Wars : course compétitive sur une tâche prête (2-5 nœuds, 1er succès gagne). */
export function raceTask(
  taskId: string,
  factor = 3,
): Promise<{ taskId: string; drones: string[] }> {
  return api<{ taskId: string; drones: string[] }>(`/api/tasks/${taskId}/race`, {
    method: 'POST',
    body: JSON.stringify({ factor }),
  });
}

export type { DroneRace } from '../../src/orchestrator/drone-wars';
import type { DroneRace } from '../../src/orchestrator/drone-wars';

/** Issue d'une course tranchée, reconstruite depuis le journal (drone_won). */
export interface RaceVictory {
  nodeId: string;
  cancelled: number;
}

/** Course en vol d'une tâche (null si aucune) + victoire passée éventuelle. */
export function fetchRace(
  taskId: string,
): Promise<{ race: DroneRace | null; victory?: RaceVictory | null }> {
  return api<{ race: DroneRace | null; victory?: RaceVictory | null }>(`/api/tasks/${taskId}/race`);
}

/** Toutes les courses en vol (Drone Wars) — pour le badge ⚔ de l'Essaim. */
export function fetchRaces(): Promise<{ races: DroneRace[] }> {
  return api<{ races: DroneRace[] }>('/api/races');
}

export interface InviteResponse {
  invite: string;
  url: string;
  label: string;
  joinCommand: string;
  note: string;
}

/** Demande une invitation à l'orchestrateur (URL WS optionnelle à annoncer). */
export async function fetchInvite(url?: string): Promise<InviteResponse> {
  const query = url ? `?url=${encodeURIComponent(url)}` : '';
  const res = await fetch(`/api/invite${query}`, { headers: { 'x-hive-token': getToken() } });
  if (!res.ok)
    throw new Error(
      tNow(`invitation refusée (${res.status})`, `invitation refused (${res.status})`),
    );
  return (await res.json()) as InviteResponse;
}

// ─── Mission Control : endpoints d'observation et d'action ──────────────────

export type { HivePulse } from '../../src/orchestrator/pulse';
export type { WaggleBoard, NodeNectar } from '../../src/orchestrator/waggle';
export type { Ghost, GhostReport } from '../../src/orchestrator/ghost';
export type { ReplayFrame, ReplayResult, TaskCounts } from '../../src/orchestrator/replay';
export type { ProjectReport } from '../../src/orchestrator/project-report';
export type { Faction, Verdict } from '../../src/orchestrator/parliament';
export type { MergeConflict, MergePlan } from '../../src/orchestrator/honeycomb';
export type { Domaine, TraceePheromone } from '../../src/orchestrator/pheromones';
export type { BandeThermo, LectureThermo } from '../../src/orchestrator/thermo';
export type { Compte, DecisionPlafond, Devis, Pesee, Poste } from '../../src/orchestrator/balance';

import type { HivePulse } from '../../src/orchestrator/pulse';
import type { WaggleBoard } from '../../src/orchestrator/waggle';
import type { GhostReport } from '../../src/orchestrator/ghost';
import type { ReplayResult } from '../../src/orchestrator/replay';
import type { ProjectReport } from '../../src/orchestrator/project-report';
import type { Verdict } from '../../src/orchestrator/parliament';
import type { MergePlan } from '../../src/orchestrator/honeycomb';
import type { Domaine, TraceePheromone } from '../../src/orchestrator/pheromones';
import type { BandeThermo, LectureThermo } from '../../src/orchestrator/thermo';
import type { DecisionPlafond, Devis, Pesee } from '../../src/orchestrator/balance';

/** Hive Pulse : signes vitaux agrégés (débit, latences, taux de succès). */
export function fetchPulse(): Promise<HivePulse> {
  return api<HivePulse>('/api/pulse');
}

/** Waggle Board : classement de contribution des nœuds (nectar). */
export function fetchWaggle(): Promise<WaggleBoard> {
  return api<WaggleBoard>('/api/waggle');
}

/** Ghost in the Hive : anomalies détectées dans le journal. */
export function fetchGhosts(): Promise<GhostReport> {
  return api<GhostReport>('/api/ghost');
}

/**
 * Thermorégulation : `instantane` est la température lue dans la fenêtre de
 * 10 minutes, `applique` l'état HYSTÉRÉSÉ réellement en vigueur dans le
 * scheduler — les deux divergent le temps d'une confirmation, et c'est
 * exactement ce que l'opérateur doit voir. Deux noms pour deux sémantiques :
 * `bande` figurait auparavant des deux côtés avec deux sens différents.
 */
export interface ThermoState {
  instantane: LectureThermo;
  applique: { bande: BandeThermo; facteur: number };
}

/** Thermorégulation : température de la ruche et ventilation appliquée. */
export function fetchThermo(): Promise<ThermoState> {
  return api<ThermoState>('/api/thermo');
}

/** Phéromones : affinité apprise nœud × domaine (30 meilleures traces). */
export function fetchPheromones(): Promise<{ traces: TraceePheromone[] }> {
  return api<{ traces: TraceePheromone[] }>('/api/pheromones');
}

/**
 * La Balance — le pèse-ruche. Deux lectures de natures DIFFÉRENTES cohabitent
 * dans cette réponse, et l'affichage ne doit jamais les confondre :
 *  - `pesee` : l'imputation (utile / reprise / échec / rebuté), recalculée à la
 *    demande sur une FENÊTRE bornée (`fenetre` derniers résultats) ;
 *  - `soldes` : le grand livre, dépense TOTALE par projet depuis toujours —
 *    additive, jamais révisée. `aJour: false` ⇒ son rattrapage n'est pas fini
 *    et les soldes sont encore incomplets : c'est à montrer, pas à masquer.
 *
 * `mode: 'off'` ⇒ le grand livre ne tourne pas du tout : `soldes` reste vide et
 * `aJour` faux. Ce n'est pas une panne, et « 0 » serait un mensonge.
 *
 * L'unité est la SECONDE-OUVRIÈRE : du temps machine prêté par les membres,
 * jamais une somme d'argent — aucun tarif n'existe côté serveur (`enEuros` y
 * est une projection d'affichage qui exige un tarif fourni par l'appelant).
 */
export interface BalanceState {
  version: number;
  mode: 'off' | 'observation' | 'strict';
  aJour: boolean;
  pesee: Pesee;
  soldes: SoldeProjet[];
  /** Taille du corpus lu par l'imputation (CORPUS_BALANCE côté serveur). */
  fenetre: number;
}

/**
 * Le solde d'UN projet au grand livre : ce qu'il a dépensé, ET l'intention
 * humaine qui le borne. Forme LOCALE au serveur (le type vit inline dans
 * `Scheduler.balance`, il n'est exporté par aucun module pur) : on la
 * reconstruit ici depuis `DecisionPlafond`, exporté par balance.ts — même motif
 * que `DevisPlan`, pour que le typecheck du dashboard casse si le verdict bouge.
 *
 * `plafondMs` / `etat` / `bloque` sont OPTIONNELS, et seulement ici : le serveur
 * les envoie toujours, un orchestrateur d'AVANT le geste « borner » ne les
 * connaît pas. Absents ⇒ le dashboard se lit exactement comme avant, sans
 * inventer un « pas de plafond » qui serait une affirmation non vérifiée.
 *
 * Distinguer `etat` de `bloque` est essentiel et n'est pas un doublon :
 * `etat: 'bloque'` est le VERDICT (la dépense a rejoint le plafond), `bloque`
 * dit si l'assignation est RÉELLEMENT arrêtée — c'est-à-dire verdict `bloque`
 * ET ruche en mode `strict`. En `observation`, le premier est vrai et le second
 * faux : la ruche continue de butiner, et l'écran doit le dire.
 */
export interface SoldeProjet {
  projectId: string;
  depenseMs: number;
  tentatives: number;
  /** Plafond posé à la main, en ms. `null` = aucun plafond (l'état normal). */
  plafondMs?: number | null;
  etat?: DecisionPlafond;
  bloque?: boolean;
}

/**
 * La Balance d'UN projet — réponse de `GET` et de `PUT
 * /api/projects/:id/balance`. Elle ajoute au solde la TRACE du geste humain :
 * qui a posé le plafond (`definiPar`, un userId — jamais une autorisation, la
 * garde reste le token de ruche) et quand (`updatedAt`). Les deux valent `null`
 * quand aucun plafond n'est posé, ou quand il l'a été sans session identifiée.
 *
 * La route sert aussi `compte` (la tranche de pesée du projet) et `fenetre` :
 * la carte projet les tient déjà de `/api/balance`, qui couvre toute la ruche en
 * un seul relevé — inutile de les retyper pour les ignorer.
 */
export interface BalanceProjetState extends SoldeProjet {
  version: number;
  mode: BalanceState['mode'];
  aJour: boolean;
  definiPar?: string | null;
  updatedAt?: number | null;
}

/** La Balance d'un projet : son solde, son plafond, et qui l'a posé. */
export function fetchProjectBalance(projectId: string): Promise<BalanceProjetState> {
  return api<BalanceProjetState>(`/api/projects/${projectId}/balance`);
}

/**
 * Pose (ou retire, avec `null`) le plafond de dépense d'un projet.
 *
 * C'est le SEUL geste du dashboard qui peut arrêter la ruche pour cause
 * d'économie, et le seul qui peut la redémarrer : la ruche ne se ré-autorise
 * jamais elle-même à dépenser. `0` est licite et veut dire « ce projet ne
 * dépense plus rien » ; la borne haute est celle du schéma serveur, qui reste
 * l'autorité et refuse le reste avec un message lisible.
 */
export function setProjectPlafond(
  projectId: string,
  plafondMs: number | null,
): Promise<BalanceProjetState> {
  return api<BalanceProjetState>(`/api/projects/${projectId}/balance`, {
    method: 'PUT',
    body: JSON.stringify({ plafondMs }),
  });
}

/** La Balance : où est passé le temps-ouvrière emprunté par la ruche. */
export function fetchBalance(): Promise<BalanceState> {
  return api<BalanceState>('/api/balance');
}

/**
 * Devis d'un lot de tâches proposées, joint à `POST /api/plan` et à
 * `POST /api/projects/:id/brief`. Le serveur garde cette forme LOCALE (elle
 * n'est pas exportée par balance.ts) : on la reconstruit ici à partir des types
 * exportés du module pur, pour que le typecheck du dashboard casse si `Devis`
 * bouge.
 *
 * `totalP90Ms` est la SOMME des p90, pas le p90 de la somme : une borne
 * pessimiste qui suppose que toutes les tâches ont un mauvais jour en même
 * temps. Cette nuance doit rester visible à l'écran.
 */
export interface DevisPlan {
  parTache: Array<{ title: string; domaine: Domaine } & Devis>;
  totalMedianeMs: number;
  totalP90Ms: number;
}

/** Time-Lapse Replay : frise chronologique du journal. */
export function fetchReplay(since = 0): Promise<ReplayResult> {
  return api<ReplayResult>(`/api/replay?since=${since}`);
}

/** Rapport d'avancement d'un projet. */
export function fetchReport(projectId: string): Promise<ProjectReport> {
  return api<ProjectReport>(`/api/projects/${projectId}/report`);
}

/** Honeycomb Merge : plan d'intégration (advisory) d'un projet. */
export function fetchMergePlan(projectId: string): Promise<MergePlan> {
  return api<MergePlan>(`/api/projects/${projectId}/merge`);
}

export interface MergeRunStart {
  mergeId: string;
  nodeId: string;
  order: string[];
}

/**
 * Déclenche l'exécution réelle du merge sur un nœud (asynchrone).
 * `taskIds` : sélection de revue (Miellerie) — seules ces tâches sont intégrées.
 */
export function runMerge(
  projectId: string,
  testCommand?: string[],
  taskIds?: string[],
): Promise<MergeRunStart> {
  return api<MergeRunStart>(`/api/projects/${projectId}/merge/run`, {
    method: 'POST',
    body: JSON.stringify({
      ...(testCommand?.length ? { testCommand } : {}),
      ...(taskIds?.length ? { taskIds } : {}),
    }),
  });
}

export interface MergeRunResult {
  mergeId: string;
  applied: string[];
  conflicts: { taskId: string; reason: string }[];
  mergedDiff: string;
  testsRun: boolean;
  testsPassed: boolean | null;
  logs: string;
}

/** Dernier résultat de merge d'un projet (null tant qu'aucun n'a abouti). */
export function fetchMergeResult(projectId: string): Promise<{ result: MergeRunResult | null }> {
  return api<{ result: MergeRunResult | null }>(`/api/projects/${projectId}/merge/result`);
}

/** Parlement des Agents : verdict de consensus sur les résultats d'une tâche. */
export function fetchConsensus(taskId: string): Promise<Verdict> {
  return api<Verdict>(`/api/tasks/${taskId}/consensus`);
}

export type ReviewVerdict = 'approved' | 'rejected';

/** Toutes les revues humaines (taskId → verdict), partagées entre opérateurs. */
export function fetchReviews(): Promise<{
  reviews: Record<string, ReviewVerdict>;
  updatedAt?: Record<string, number>;
}> {
  return api<{ reviews: Record<string, ReviewVerdict>; updatedAt?: Record<string, number> }>(
    '/api/reviews',
  );
}

/**
 * Enregistre (ou efface avec null) le verdict de revue d'une tâche.
 * `clientId` : identité d'onglet, échouée dans task_reviewed — permet de
 * distinguer nos propres échos WS de ceux des autres opérateurs.
 */
export function postReview(
  taskId: string,
  state: ReviewVerdict | null,
  clientId?: string,
): Promise<{ taskId: string; state: ReviewVerdict | null }> {
  return api<{ taskId: string; state: ReviewVerdict | null }>(`/api/tasks/${taskId}/review`, {
    method: 'POST',
    body: JSON.stringify({ state, ...(clientId ? { clientId } : {}) }),
  });
}

// ─── Comptes utilisateurs (JWT — indépendant du token de ruche) ──────────────
// Le token de ruche (x-hive-token) protège l'accès à l'orchestrateur ; le JWT
// identifie une PERSONNE (register/login). Le dashboard reste pleinement
// utilisable sans compte : la session ne fait qu'ajouter l'identité.

const JWT_KEY = 'hive.jwt';

export function getJwt(): string | null {
  return localStorage.getItem(JWT_KEY);
}

export function saveJwt(token: string): void {
  localStorage.setItem(JWT_KEY, token);
}

export function clearJwt(): void {
  localStorage.removeItem(JWT_KEY);
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  createdAt?: number;
}

export function authRegister(
  email: string,
  password: string,
  displayName: string,
): Promise<{ token: string }> {
  return api<{ token: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

export function authLogin(email: string, password: string): Promise<{ token: string }> {
  return api<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/** Profil de la session courante (401 → ApiError, le JWT est alors périmé). */
export function authMe(): Promise<AuthUser> {
  return api<AuthUser>('/api/auth/me', {
    headers: { authorization: `Bearer ${getJwt() ?? ''}` },
  });
}

export interface FeedHandlers {
  onState: (snapshot: StateSnapshot) => void;
  onEvent: (event: HiveEvent) => void;
  onStatus: (connected: boolean) => void;
}

export interface HiveFeed {
  close(): void;
}

/** Connexion WebSocket auto-reconnectante au flux d'état de la ruche. */
export function connectFeed(handlers: FeedHandlers): HiveFeed {
  let ws: WebSocket | null = null;
  let closed = false;
  let retryMs = 1_000;
  let timer: number | undefined;

  const open = (): void => {
    if (closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => {
      retryMs = 1_000;
      handlers.onStatus(true);
      ws?.send(JSON.stringify({ type: 'subscribe', token: getToken() }));
    };

    ws.onmessage = (e: MessageEvent) => {
      const msg = parseServerMessage(typeof e.data === 'string' ? e.data : '');
      if (!msg) return;
      if (msg.type === 'state') handlers.onState(msg.snapshot);
      else if (msg.type === 'event') handlers.onEvent(msg.event);
    };

    ws.onclose = () => {
      handlers.onStatus(false);
      if (!closed) {
        timer = window.setTimeout(open, retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      }
    };
  };

  open();
  return {
    close(): void {
      closed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      ws?.close();
    },
  };
}
