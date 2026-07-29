// Liaison temps réel avec l'orchestrateur : le dashboard s'abonne au flux
// WebSocket (snapshots d'état + journal d'événements). Le token est mémorisé
// localement ; en mode simulation, la valeur par défaut suffit.

import { t as tNow } from './i18n';
import { parseServerMessage } from '../../src/shared/protocol';
import type { HiveEvent, Project, StateSnapshot, Task, TaskResult } from '../../src/shared/types';
import type { Graphe } from '../../src/shared/cerveau-graphe.js';

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

// ─── Le lien de partage, côté porteur ───────────────────────────────────────
//
// ─── POURQUOI `sessionStorage` ET PAS `localStorage` ────────────────────────
//
// Un lien de partage circule : on le colle dans une conversation, on l'ouvre
// sur un poste qui n'est pas le sien, on le montre à quelqu'un. Le ranger dans
// `localStorage` le laisserait derrière soi — l'onglet fermé, le suivant qui
// ouvre le tableau de bord sur cette machine repartirait en lecture du projet
// de quelqu'un d'autre. `sessionStorage` meurt avec l'onglet, ce qui est
// exactement la durée de vie d'un lien qu'on vous a montré.
//
// Il est AUSSI cloisonné par onglet : une personne peut lire un partage dans
// un onglet et rester connectée à son propre compte dans l'autre, sans que
// l'un contamine l'autre.

const PARTAGE_KEY = 'hive.partage';

export function getPartage(): string | null {
  try {
    return sessionStorage.getItem(PARTAGE_KEY);
  } catch {
    // Navigateur en mode restreint : on lit sans partage plutôt que de tomber.
    return null;
  }
}

export function savePartage(jeton: string): void {
  try {
    sessionStorage.setItem(PARTAGE_KEY, jeton);
  } catch {
    /* rien à faire : la lecture se fera sans mémoire */
  }
}

export function clearPartage(): void {
  try {
    sessionStorage.removeItem(PARTAGE_KEY);
  } catch {
    /* idem */
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

/**
 * Crée un projet — ATTRIBUÉ À SON CRÉATEUR quand il y a un compte.
 *
 * ─── LE DÉFAUT QUE CETTE FONCTION FERMAIT MAL ────────────────────────────────
 *
 * `POST /api/projects` s'authentifie par le JETON DE RUCHE. Il n'a donc
 * personne à qui attribuer le projet, et `createProject` range par défaut
 * `visibility: 'private'`, `ownerId: null`. Autrement dit : TOUT projet créé
 * depuis le bouton « + Projet » naissait privé et orphelin.
 *
 * Une fois le contrôle d'accès posé, la conséquence est absurde — la personne
 * qui vient de créer le projet ne peut ni en lire le code, ni y admettre
 * quelqu'un, ni le partager, sauf si elle est administratrice. C'est le
 * parcours le PLUS courant du produit.
 *
 * `POST /api/projects/user` existait pour ça depuis le début : il attribue le
 * projet au compte appelant et l'inscrit comme membre `owner`. Personne ne
 * l'appelait. Le défaut n'était donc dans aucune route — il était dans ce
 * qu'aucune ne faisait, exactement comme pour l'adoption.
 *
 * Sans compte, on retombe sur l'ancienne porte : le tableau de bord s'utilise
 * sans compte, et un projet orphelin reste adoptable par un administrateur.
 */
export function createProject(input: {
  name: string;
  repoUrl?: string;
  description?: string;
  visibility?: 'public' | 'private';
}): Promise<Project> {
  if (getJwt()) {
    return apiCompte<Project>('/api/projects/user', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  return api<Project>('/api/projects', { method: 'POST', body: JSON.stringify(input) });
}

// ─── Le Conseil des Éclaireuses ─────────────────────────────────────────────
//
// Le Conseil ne change RIEN : son verdict est une PROPOSITION À UN HUMAIN. Un
// mécanisme dont la sortie EST une proposition à un humain, et que cet humain
// ne peut lire qu'en ligne de commande, est le cas le plus net de « mécanisme
// sans écran » — plus net encore que Les Guetteuses, dont la sortie était au
// moins une alerte.

/** Ce que devient un conseil. `quorum` est le seul cas qui recommande. */
export type IssueConseil = 'quorum' | 'depart' | 'sans_quorum' | 'epuise' | 'vide';

export interface DanseConseil {
  id: string;
  titre: string;
  corps: string;
  /** AFFICHÉES, jamais suivies par la ruche. */
  sources: string[];
  eclaireuse: string;
  famille: string;
  qualite: number;
  intensite: number;
  soutiens: string[];
  arrets: string[];
  familles: string[];
  quorum: boolean;
  autoSoutienIgnore: boolean;
  raisons: { type: 'soutien' | 'arret'; raison?: string; eclaireuse: string }[];
}

export interface SessionConseil {
  id: string;
  question: string;
  projectId: string;
  etat: string;
  tour: number;
  issue: IssueConseil;
  motif?: string;
  createdAt: number;
  closedAt?: number | null;
  enVol: number;
  danses: DanseConseil[];
  /** L'identifiant de la danse retenue, ou `null` si rien n'a convergé. */
  retenue: string | null;
}

export interface ConseilResume {
  id: string;
  question: string;
  projectId: string;
  etat: string;
  tour: number;
  issue: IssueConseil | null;
  createdAt: number;
  closedAt?: number | null;
}

export function fetchConseils(): Promise<{ conseils: ConseilResume[] }> {
  return api<{ conseils: ConseilResume[] }>('/api/conseils');
}

export function fetchConseil(sessionId: string): Promise<SessionConseil> {
  return api<SessionConseil>(`/api/conseil/${encodeURIComponent(sessionId)}`);
}

// ─── Connecter un dépôt GitHub ──────────────────────────────────────────────
//
// Ces deux routes vivaient depuis le début sans aucun écran : connecter un
// dépôt se faisait en ligne de commande, alors que c'est le tout premier geste
// de quelqu'un qui découvre la ruche.
//
// Le jeton GitHub, lui, ne passe JAMAIS par ici. Il vit dans l'environnement de
// l'orchestrateur (`HIVE_GITHUB_TOKEN`), en mémoire, le temps du processus —
// le tableau de bord demande « mes dépôts » et reçoit une liste, sans jamais
// voir de quoi la fabriquer. Un écran qui collecterait le jeton en ferait une
// valeur qui traverse le navigateur, l'historique et le presse-papiers.

export interface DepotGithub {
  fullName: string;
  nom: string;
  description: string;
  prive: boolean;
  cloneUrl: string;
  htmlUrl: string;
  langage: string;
  pousseA: number;
  archive: boolean;
  /** Déjà connecté à la ruche : deux projets sur un même dépôt, c'est deux
   *  plans de merge concurrents sur les mêmes fichiers. */
  importe: boolean;
}

export interface DepotsGithub {
  depots: DepotGithub[];
  total: number;
  tronque?: boolean;
}

export function fetchDepotsGithub(q = ''): Promise<DepotsGithub> {
  const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return apiCompte<DepotsGithub>(`/api/github/repos${query}`);
}

/**
 * Connecte un dépôt à la ruche.
 *
 * Signé par le COMPTE en plus du jeton de ruche : le serveur attribue alors le
 * projet à l'appelant. Sans compte (la voie CLI), le projet naît orphelin et
 * doit être adopté — ce qui était le seul comportement possible jusqu'ici.
 */
export function importerDepotGithub(fullName: string): Promise<{ projet: Project }> {
  return apiCompte<{ projet: Project }>('/api/github/import', {
    method: 'POST',
    body: JSON.stringify({ fullName }),
  });
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

/**
 * Proposer une retouche : la modification part comme TÂCHE, jamais comme
 * écriture dans le miroir.
 *
 * Le Rayon est un clone jetable. Écrire dedans ferait croire à une correction
 * qui disparaîtrait au prochain rafraîchissement, sans rien dire.
 */
export function proposerRetouche(
  projectId: string,
  corps: { chemin: string; avant: string; apres: string; note?: string },
): Promise<{ task: { id: string; title: string } }> {
  return apiCompte(`/api/projects/${encodeURIComponent(projectId)}/rayon/retouche`, {
    method: 'POST',
    body: JSON.stringify(corps),
  });
}

/**
 * L'Aperçu — le site du projet, replié en UN document auto-suffisant.
 *
 * Ce document s'injecte dans une `<iframe sandbox>` SANS `allow-same-origin`.
 * Le serveur renvoie le `sandbox` attendu avec le document : le poser en dur
 * côté client laisserait les deux valeurs diverger sans que personne ne s'en
 * aperçoive, et c'est exactement l'attribut qu'il ne faut pas se tromper.
 */
export interface ApercuProjet {
  html: string;
  entree: string;
  inlines: string[];
  sandbox: string;
}

export function fetchApercu(projectId: string): Promise<ApercuProjet> {
  return apiLecture(`/api/projects/${encodeURIComponent(projectId)}/apercu`);
}

/**
 * Les Guetteuses — ce que la ruche a vu passer sur ses leurres.
 *
 * ─── POURQUOI CETTE FONCTION MANQUAIT, ET CE QUE ÇA COÛTAIT ─────────────────
 *
 * `GET /api/guet` existait côté serveur, et AUCUN écran ne l'appelait. Un
 * mécanisme de détection sans écran est pire qu'une absence de détection : on
 * croit surveillé ce qui ne l'est pas. Le seul signal qui sortait était une
 * ligne brute au journal — sans niveau, sans conseil, sans la liste de ce
 * qu'on avait cherché chez vous.
 */
export type NiveauGuet = 'calme' | 'reniflage' | 'balayage';

export interface VerdictGuet {
  niveau: NiveauGuet;
  passages: number;
  sources: number;
  appats: string[];
  conseil: string;
  derniers: { source: string; chemin: string; appat: string; quand: number }[];
}

export function fetchGuet(): Promise<VerdictGuet> {
  return api<VerdictGuet>('/api/guet');
}

/**
 * Les Gardiennes — le contrôle d'entrée du nectar.
 *
 * `GET /api/gardiennes` était servi et n'avait, lui non plus, aucun écran.
 * C'est pourtant une donnée de DÉCISION directe : savoir quel nœud rend des
 * diffs vides, ou annonce des fichiers qu'il ne touche pas, c'est savoir sur
 * qui compter. Sans écran, le seul moyen de l'apprendre était de lire le
 * journal ligne à ligne.
 */
export type VerdictGardienne = 'clean' | 'suspect' | 'hollow';

export interface VueGardiennes {
  version: number;
  inspections: number;
  verdicts: Record<VerdictGardienne, number>;
  /** Combien ont RÉELLEMENT été refusées (mode strict seulement). */
  refusees: number;
  griefs: { code: string; occurrences: number }[];
  recentes: {
    id: number;
    taskId: string;
    nodeId: string;
    verdict: VerdictGardienne;
    score: number;
    applique: boolean;
    griefs: { code: string; detail?: string }[];
    createdAt: number;
  }[];
  mode: 'off' | 'consultatif' | 'strict';
}

export function fetchGardiennes(): Promise<VueGardiennes> {
  return api<VueGardiennes>('/api/gardiennes');
}

/** Phéromones : affinité apprise nœud × domaine (30 meilleures traces). */
export function fetchPheromones(): Promise<{ traces: TraceePheromone[] }> {
  return api<{ traces: TraceePheromone[] }>('/api/pheromones');
}

/** Caste d'une ouvrière : nourrice (encadrée) → bâtisseuse → butineuse (relit). */
export type Caste = 'nourrice' | 'batisseuse' | 'butineuse';

export interface OuvrierePolyethisme {
  nodeId: string;
  name: string;
  agentType: string;
  caste: Caste;
  /** Productions observées : le dénominateur de tout le reste. */
  productions: number;
  /** Jugées creuses par les Gardiennes — le grief le plus lourd. */
  creuses: number;
  /** Jugées suspectes : signal réel, mais heuristique. */
  suspectes: number;
  /** Entre 0 et 1, déjà arrondie au centième côté serveur. */
  fiabilite: number;
}

/**
 * Le polyéthisme — chaque ouvrière au travail que son expérience permet.
 *
 * `mode` est celui qui S'APPLIQUE, `modeDemande` celui qu'on a réglé : les deux
 * diffèrent quand les Gardiennes sont éteintes, puisque sans source de qualité
 * aucune caste ne peut se gagner. Afficher le seul mode demandé laisserait
 * croire à un encadrement qui ne tourne pas.
 */
export interface VuePolyethisme {
  mode: 'off' | 'consignes' | 'strict';
  modeDemande: 'off' | 'consignes' | 'strict';
  /** Taille du corpus d'inspections sur lequel les castes sont calculées. */
  fenetre: number;
  seuils: { batisseuse: number; butineuse: number };
  noeuds: OuvrierePolyethisme[];
}

export function fetchPolyethisme(): Promise<VuePolyethisme> {
  return api<VuePolyethisme>('/api/polyethisme');
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
// ─── Le Plein Essaim : l'autonomie d'un projet ──────────────────────────────

/** Un pas que la ruche prendrait maintenant. Miroir de `Pas` (essaim.ts). */
export type PasEssaim =
  | 'inerte'
  | 'halte'
  | 'plafond'
  | 'deliberer'
  | 'planifier'
  | 'butiner'
  | 'corriger'
  | 'livrer'
  | 'fusionner';

export type NiveauEssaim = 'off' | 'propose' | 'gouverne' | 'plein';

export interface LeconEssaim {
  signature: string;
  noeuds: number;
  taches: number;
  occurrences: number;
  portee: 'isolee' | 'confirmee' | 'systemique';
  confiance: number;
  extrait: string;
  vueA: number;
}

export interface IndicateurDerive {
  cle: 'qualite' | 'entropie' | 'repetition' | 'solitude';
  etat: 'saine' | 'a_surveiller' | 'degradee' | 'indeterminee';
  valeur: number;
  unite: 'points' | 'part' | 'jours';
  seuil: number;
  constat: string;
}

export interface DeriveUi {
  etat: 'saine' | 'a_surveiller' | 'degradee' | 'indeterminee';
  indicateurs: IndicateurDerive[];
  echantillon: number;
  solitudeJours: number;
  motif: string;
}

/**
 * Ce que le RUNNER fait de la décision — à ne pas confondre avec le verdict.
 *
 * OPTIONNEL : un orchestrateur d'avant le runner ne l'envoie pas. Absent, on
 * n'affiche rien plutôt que d'affirmer « éteint », ce qui serait une
 * information inventée.
 */
export interface RunnerUi {
  mode: 'off' | 'on';
  enPause: boolean;
  echecs: number;
  /** Fin du dernier cycle, ou `0` s'il n'a jamais tourné. */
  dernierTourA: number;
}

export interface EtatEssaimUi {
  niveau: NiveauEssaim;
  runner?: RunnerUi;
  derive: DeriveUi;
  decision: { pas: PasEssaim; motif: string; gouvernantes: string[] };
  gouvernantes: Array<{ nodeId: string; nom: string }>;
  gouvernantesRequises: number;
  depotInscrit: boolean;
  plafond: 'passe' | 'alerte' | 'bloque';
  lecons: LeconEssaim[];
  niveaux: NiveauEssaim[];
}

export function fetchEssaim(projectId: string): Promise<EtatEssaimUi> {
  return api<EtatEssaimUi>(`/api/projects/${projectId}/essaim`);
}

/**
 * Règle l'autonomie. `depotInscrit` est l'autorisation de fusionner, donnée
 * une seule fois pour ce dépôt — distincte du niveau, et exigée avec lui.
 */
export function setEssaim(
  projectId: string,
  niveau: NiveauEssaim,
  depotInscrit: boolean,
): Promise<{ niveau: NiveauEssaim; depotInscrit: boolean }> {
  return api(`/api/projects/${projectId}/essaim`, {
    method: 'POST',
    body: JSON.stringify({ niveau, depotInscrit }),
  });
}

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

/**
 * Rapport d'avancement d'un projet.
 *
 * Passe par `apiLecture` : c'est l'acte `voir_avancement` du lien de partage,
 * déclaré depuis toujours et qu'aucune route n'utilisait — un lien « voir
 * l'avancement » ne montrait donc jamais d'avancement.
 */
export function fetchReport(projectId: string): Promise<ProjectReport> {
  return apiLecture<ProjectReport>(`/api/projects/${projectId}/report`);
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
 *
 * - `prepareCommand` : prépare l'environnement AVANT les tests (`npm ci`…).
 *   Sans elle, `npm test` sur un clone frais échoue faute de dépendances.
 * - `taskIds` : sélection de revue (Miellerie) — seules ces tâches sont
 *   intégrées.
 *
 * Un objet plutôt que des positions : trois options optionnelles à la suite,
 * c'est un `runMerge(id, undefined, undefined, x)` qui finit par se tromper de
 * rang un jour.
 */
export function runMerge(
  projectId: string,
  opts: { testCommand?: string[]; prepareCommand?: string[]; taskIds?: string[] } = {},
): Promise<MergeRunStart> {
  return api<MergeRunStart>(`/api/projects/${projectId}/merge/run`, {
    method: 'POST',
    body: JSON.stringify({
      ...(opts.prepareCommand?.length ? { prepareCommand: opts.prepareCommand } : {}),
      ...(opts.testCommand?.length ? { testCommand: opts.testCommand } : {}),
      ...(opts.taskIds?.length ? { taskIds: opts.taskIds } : {}),
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
  /**
   * Verdict de la préparation : absent/`null` si aucune n'a été demandée.
   *
   * `false` veut dire que l'environnement ne s'est pas installé — et non que le
   * code est cassé. C'est pour ça qu'il est distinct de `testsPassed`.
   */
  preparedOk?: boolean | null;
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
  /**
   * `admin` ou `membre`. OPTIONNEL : un orchestrateur d'avant les rôles ne le
   * renvoie pas. Absent ⇒ traité comme `membre` — le défaut sûr : au pire
   * l'écran d'intendance reste caché à quelqu'un qui y aurait droit, alors que
   * l'inverse afficherait des boutons que le serveur refusera de toute façon.
   */
  role?: Role;
}

export type { Role } from '../../src/orchestrator/comptes';
import type { Role } from '../../src/orchestrator/comptes';

/** L'appelant est-il administrateur ? Un `role` absent n'est jamais un oui. */
export function estAdmin(user: AuthUser | null): boolean {
  return user?.role === 'admin';
}

/** Une adhésion à un projet. `displayName` vient de la jointure sur les comptes. */
export interface MembreProjet {
  projectId: string;
  userId: string;
  role: string;
  joinedAt: number;
  displayName?: string;
}

export function fetchMembresProjet(projectId: string): Promise<MembreProjet[]> {
  return apiCompte<MembreProjet[]>(`/api/projects/${projectId}/members`);
}

/**
 * Se déclarer propriétaire d'un projet ORPHELIN.
 *
 * Un dépôt importé depuis GitHub n'a pas de propriétaire : l'import
 * s'authentifie par le jeton de ruche, qui n'est le compte de personne. Sans
 * adoption, il n'a personne pour y admettre des ouvrières.
 */
export function adopterProjet(projectId: string): Promise<{ adopted: boolean }> {
  return apiCompte<{ adopted: boolean }>(`/api/projects/${projectId}/adopter`, { method: 'POST' });
}

export function admettreMembre(
  projectId: string,
  userId: string,
): Promise<{ admitted: boolean; userId: string }> {
  return apiCompte<{ admitted: boolean; userId: string }>(`/api/projects/${projectId}/membres`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

// ─── Les liens de partage en lecture ────────────────────────────────────────

export interface LienPartage {
  id: string;
  label: string;
  creeA: number;
  expireA: number;
  revoqueA: number | null;
  vuA: number | null;
  /** Ni révoqué ni expiré — le seul champ qui décide de ce qu'on affiche. */
  vivant: boolean;
}

/**
 * Le lien fraîchement créé. `jeton` et `lien` ne sont rendus QU'ICI, une seule
 * fois : la liste ne les montrera jamais. C'est ce qui fait qu'un lien perdu se
 * remplace au lieu de se retrouver.
 */
export interface PartageCree {
  id: string;
  jeton: string;
  expireA: number;
  lien: string;
}

export function creerPartage(
  projectId: string,
  opts: { label?: string; ttlMs?: number } = {},
): Promise<PartageCree> {
  return apiCompte<PartageCree>(`/api/projects/${projectId}/partages`, {
    method: 'POST',
    body: JSON.stringify({
      ...(opts.label ? { label: opts.label } : {}),
      ...(opts.ttlMs ? { ttlMs: opts.ttlMs } : {}),
    }),
  });
}

export function fetchPartages(projectId: string): Promise<LienPartage[]> {
  return apiCompte<LienPartage[]>(`/api/projects/${projectId}/partages`);
}

export function revoquerPartage(projectId: string, partageId: string): Promise<{ ok: boolean }> {
  return apiCompte<{ ok: boolean }>(`/api/projects/${projectId}/partages/${partageId}`, {
    method: 'DELETE',
  });
}

export function retirerMembre(
  projectId: string,
  userId: string,
): Promise<{ removed: boolean; userId: string }> {
  return apiCompte<{ removed: boolean; userId: string }>(
    `/api/projects/${projectId}/membres/${userId}`,
    { method: 'DELETE' },
  );
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
  return apiCompte<AuthUser>('/api/auth/me');
}

/**
 * Appel signé par le COMPTE, pas par la ruche.
 *
 * Le jeton de ruche est distribué à chaque nœud membre : s'en servir comme
 * preuve d'administration donnerait les pleins pouvoirs à toute machine qui
 * butine. Le serveur le refuse déjà (401) ; ce helper existe pour qu'aucun
 * appel d'intendance ne parte sans le JWT et n'aille se cogner à ce refus.
 */
function apiCompte<T>(path: string, init?: RequestInit): Promise<T> {
  return api<T>(path, {
    ...init,
    headers: { authorization: `Bearer ${getJwt() ?? ''}`, ...init?.headers },
  });
}

/**
 * Appel de LECTURE : par le lien de partage s'il y en a un, par le compte sinon.
 *
 * ─── POURQUOI UN SEUL HELPER, ET PAS DEUX CHEMINS PARALLÈLES ────────────────
 *
 * Le serveur a exactement cette forme : `projetLisible()` accepte deux portes —
 * un compte qui a affaire au projet, ou un lien valide pour CE projet. Écrire
 * ici deux familles de fonctions (`fetchRayon` et `fetchRayonPartage`…)
 * donnerait deux listes à tenir d'accord, et c'est toujours celle qu'on oublie
 * qui décide. Une seule fonction, qui choisit son en-tête, ne peut pas diverger
 * d'elle-même.
 *
 * Ce helper n'est utilisé QUE par les lectures que le serveur a déclarées
 * accessibles à un lien. Un appel d'écriture qui passerait par ici recevrait
 * 401 côté serveur — la retouche, elle, exige un compte, et c'est le point.
 */
function apiLecture<T>(path: string, init?: RequestInit): Promise<T> {
  const jeton = getPartage();
  return api<T>(path, {
    ...init,
    headers: jeton
      ? { 'x-hive-partage': jeton, ...init?.headers }
      : { authorization: `Bearer ${getJwt() ?? ''}`, ...init?.headers },
  });
}

// ─── Les issues, et ce que devient le travail livré ─────────────────────────
//
// Les deux API existaient et rien ne les montrait. Un travail invisible est un
// travail qui n'a pas été fait, du point de vue de qui regarde l'écran.

export interface IssueVue {
  numero: number;
  titre: string;
  corps: string;
  etat: string;
  auteur: string;
  etiquettes: string[];
  htmlUrl: string;
  verrouillee: boolean;
  commentaires: number;
  majA: number;
}

/**
 * Les issues ouvertes du dépôt d'un projet.
 *
 * LECTURE PAYANTE : chaque appel consomme le quota GitHub de l'hôte. C'est
 * pour cela que le serveur la range parmi les ENGAGEMENTS (ADR 0007), et pour
 * cela que l'écran ne la sonde pas en boucle — elle se demande, elle ne se
 * surveille pas.
 */
export function fetchIssues(
  projectId: string,
): Promise<{ depot: string; issues: IssueVue[]; tronque: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/issues`);
}

/** Prend une issue : la ruche la découpe en tâches. */
export function prendreIssue(
  projectId: string,
  numero: number,
): Promise<{ issue: IssueVue; taches: { id: string; title: string }[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/issues/${numero}`, {
    method: 'POST',
  });
}

export interface LivraisonVue {
  taskId: string;
  depot: string;
  pr: number;
  branche: string;
  titre?: string;
  etat?: string;
  dit?: string;
  reprenable?: boolean;
  /** Présent quand la pull request n'a pas pu être lue — le dire vaut mieux. */
  illisible?: string;
}

/** Ce que deviennent les pull requests ouvertes par la ruche. */
export function fetchLivraisons(projectId: string): Promise<{ livraisons: LivraisonVue[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/livraisons`);
}

/** Reprend une livraison : la CI ou la revue redeviennent du travail. */
export function reprendreLivraison(
  projectId: string,
  taskId: string,
): Promise<{ tache: { id: string; title: string }; etat: string; dit: string }> {
  return api(
    `/api/projects/${encodeURIComponent(projectId)}/livraisons/${encodeURIComponent(taskId)}/reprendre`,
    { method: 'POST' },
  );
}

// ─── L'intendance : les serveurs et les membres ─────────────────────────────
// Réservée aux administrateurs. Cacher les boutons n'est PAS la sécurité — le
// serveur tranche seul, et un membre qui tape l'URL reçoit 403. Ce qui suit
// n'est qu'une manière de ne pas proposer des gestes voués à être refusés.

export type { EtatServeur } from '../../src/orchestrator/serveurs';
import type { EtatServeur, VueServeurs } from '../../src/orchestrator/serveurs';
import type { Serveur } from '../../src/orchestrator/serveurs';

/**
 * Un serveur tel que l'intendance le voit. Étend `Serveur` (le type du module
 * pur — le typecheck casse si un champ y bouge) de trois lectures calculées
 * côté serveur :
 *  - `projet` : le nom, parce qu'un identifiant ne dit pas ce qu'on éteint ;
 *  - `joursAvantSuppression` : `-1` quand la machine n'est pas concernée ;
 *  - `transitions` : les gestes que le serveur ACCEPTERA. L'écran n'en propose
 *    pas d'autres, et il ne recopie pas la matrice — elle dériverait.
 */
export interface ServeurAdmin extends Serveur {
  projet: string;
  joursAvantSuppression: number;
  transitions: EtatServeur[];
}

export interface IntendanceServeurs {
  vue: VueServeurs;
  serveurs: ServeurAdmin[];
  fournisseur: string;
  retentionJours: number;
  serveursMax: number;
}

export function fetchServeurs(): Promise<IntendanceServeurs> {
  return apiCompte<IntendanceServeurs>('/api/admin/serveurs');
}

/**
 * Change l'état d'une machine. `change: false` = l'état demandé était déjà le
 * sien (rejeu, double-clic) : ce n'est pas une erreur, et ça ne doit pas
 * s'afficher comme telle.
 */
export function setServeurEtat(
  id: string,
  etat: EtatServeur,
  motif?: string,
): Promise<{ id: string; etat: EtatServeur; change: boolean }> {
  return apiCompte(`/api/admin/serveurs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ etat, ...(motif ? { motif } : {}) }),
  });
}

// ─── Le Rayon : lire le code du projet ──────────────────────────────────────

export type { Entree as EntreeRayon } from '../../src/shared/rayon';
import type { Entree as EntreeRayon } from '../../src/shared/rayon';

export interface FichierRayon {
  chemin: string;
  contenu: string;
  langage: string;
  taille: number;
  tronque: boolean;
}

/**
 * Le contenu d'un dossier du rayon. `chemin` vide = la racine.
 *
 * Signé par le COMPTE : le serveur décide seul qui lit quel dépôt, et un jeton
 * de ruche — partagé avec chaque nœud — ne prouve rien à ce sujet.
 */
export function fetchRayon(
  projectId: string,
  chemin = '',
): Promise<{ chemin: string; entrees: EntreeRayon[] }> {
  const q = chemin === '' ? '' : `?chemin=${encodeURIComponent(chemin)}`;
  return apiLecture(`/api/projects/${encodeURIComponent(projectId)}/rayon${q}`);
}

export function fetchFichierRayon(projectId: string, chemin: string): Promise<FichierRayon> {
  return apiLecture(
    `/api/projects/${encodeURIComponent(projectId)}/rayon/fichier?chemin=${encodeURIComponent(chemin)}`,
  );
}

/**
 * Le billet de rattachement d'une machine — REMIS UNE SEULE FOIS.
 *
 * Il était auparavant lisible dans `motif`, en clair, durablement. Il vit
 * maintenant en mémoire côté hub et disparaît dès qu'on l'a lu : l'appelant
 * doit donc le GARDER, et l'écran doit le dire. Un second appel rend 404, ce
 * qui n'est pas une panne — c'est le contrat.
 */
export function billetServeur(id: string): Promise<{ billet: string; commande: string }> {
  return apiCompte(`/api/admin/serveurs/${encodeURIComponent(id)}/billet`);
}

export interface MembreAdmin {
  id: string;
  email: string;
  displayName: string;
  /**
   * `string`, et pas `Role` : la base rend ce qui y est rangé, et rien ne
   * garantit à la compilation que ce soit un rôle connu. `roleConnu` tranche à
   * l'affichage plutôt que de mentir dans le type.
   */
  role: string;
  createdAt: number;
}

/** Rôle sûr à afficher. Tout ce qui n'est pas reconnu retombe sur `membre`. */
export function roleConnu(brut: string): Role {
  return brut === 'admin' ? 'admin' : 'membre';
}

export interface IntendanceMembres {
  membres: MembreAdmin[];
  admins: number;
  inscription: { mode: ModeInscription; avertissement: string };
}

export type { ModeInscription } from '../../src/orchestrator/comptes';
import type { ModeInscription } from '../../src/orchestrator/comptes';

export function fetchMembres(): Promise<IntendanceMembres> {
  return apiCompte<IntendanceMembres>('/api/admin/membres');
}

export function setMembreRole(userId: string, role: Role): Promise<{ userId: string; role: Role }> {
  return apiCompte(`/api/admin/membres/${encodeURIComponent(userId)}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

// ─── Les CLÉS de la ruche — distinctes des comptes ──────────────────────────
//
// Ne pas confondre avec `/api/admin/membres`, qui liste les COMPTES. Ici ce
// sont les clés des MACHINES : une par nœud, plus les billets d'invitation qui
// servent à en obtenir une.
//
// Révoquer une clé compromise est l'archétype de la décision d'administration,
// et elle n'existait qu'en ligne de commande. Un tableau de bord qui montre le
// pouls, les anomalies et les castes, mais pas « qui a une clé de ma ruche »,
// ne permet pas de décider ce qui compte le jour où ça compte.

export interface CleNoeud {
  nodeId: string;
  label: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  revoque: boolean;
}

export type EtatBillet = 'vivant' | 'revoque' | 'expire' | 'epuise';

export interface BilletRuche {
  id: string;
  label: string | null;
  createdAt: number;
  expiresAt: number;
  usesLeft: number;
  usesTotal: number;
  etat: EtatBillet;
}

export interface ClesRuche {
  noeuds: CleNoeud[];
  billets: BilletRuche[];
}

export function fetchCles(): Promise<ClesRuche> {
  return api<ClesRuche>('/api/membres');
}

/** Exclure une machine. La révocation MORD tout de suite : le nœud est déconnecté. */
export function revoquerNoeud(nodeId: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/membres/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
}

/** Révoquer un billet : il ne sert plus à obtenir de clé, même s'il reste des usages. */
export function revoquerBillet(billetId: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/billets/${encodeURIComponent(billetId)}`, { method: 'DELETE' });
}

// ─── Mon tableau de bord ────────────────────────────────────────────────────
// Un seul appel : l'écran doit pouvoir dire d'un bloc « voici ce qui va vous
// coûter quelque chose si vous ne faites rien ». Enchaîner une requête par
// projet ferait apparaître les alertes dans l'ordre des latences plutôt que
// dans celui de l'urgence.

export type { Gravite, ProjetRendu, Tableau } from '../../src/orchestrator/tableau';
import type { Alerte as AlerteServeur, Tableau } from '../../src/orchestrator/tableau';

/**
 * Une alerte TELLE QU'ELLE ARRIVE, `details` compris comme facultatif.
 *
 * Le type du serveur le déclare obligatoire, et il l'est — pour le serveur
 * d'aujourd'hui. Mais le dashboard est servi en fichiers statiques : un
 * navigateur qui a déjà le nouveau bundle peut très bien interroger un
 * orchestrateur qui n'a pas encore redémarré. Ce cas n'est pas théorique, il
 * s'est produit en développement, et il faisait planter la vue entière sur un
 * `a.details.serveur` — toute la page blanche pour une phrase manquante.
 *
 * Le type dit donc la vérité du CÂBLE, pas celle du serveur courant.
 */
export type Alerte = Omit<AlerteServeur, 'details'> & {
  details?: AlerteServeur['details'];
};

export interface MonTableau extends Omit<Tableau, 'alertes'> {
  alertes: Alerte[];
  /** `false` ⇒ le grand livre rattrape encore : les dépenses sont incomplètes. */
  balanceAJour: boolean;
  balanceMode: 'off' | 'observation' | 'strict';
}

export function fetchMonTableau(): Promise<MonTableau> {
  return apiCompte<MonTableau>('/api/moi/tableau');
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

// ─── Rejoindre un projet ouvert ─────────────────────────────────────────────
//
// ─── LA PORTE QUI N'AVAIT PAS DE POIGNÉE ────────────────────────────────────
//
// `GET /api/projects/public`, `POST /api/projects/:id/join` et
// `GET /api/user/projects` existaient depuis longtemps. Le refus de `join` est
// soigneusement écrit — il prend la forme EXACTE de l'inexistence, pour qu'une
// liste d'identifiants ne dessine pas la carte des projets privés de la ruche —
// et sa garde `peutRejoindre` est un module pur bien testé.
//
// **Aucun écran ne les appelait.** Ni la CLI. Sur une plateforme
// d'orchestration COMMUNAUTAIRE, « découvrir un projet ouvert et le rejoindre »
// est le parcours qui donne son sens au reste, et il avait un serveur sans
// porte. C'est le même défaut que `POST /api/projects/user` quelques centaines
// de lignes plus haut : le défaut n'est dans aucune route, il est dans ce que
// rien ne fait.

import type { ProjetPublic as ProjetPublicVue } from '../../src/shared/projet-public';
export type { ProjetPublic as ProjetPublicVue } from '../../src/shared/projet-public';

/**
 * Le catalogue des projets ouverts. SANS authentification — c'est voulu.
 *
 * La réponse est la projection `vuePublique`, jamais la ligne de base : ni
 * `repoUrl` porteur d'identifiants, ni `ownerId` qui désignerait une cible.
 */
export function fetchProjetsOuverts(): Promise<ProjetPublicVue[]> {
  return api<ProjetPublicVue[]>('/api/projects/public');
}

/**
 * Rejoindre un projet ouvert. Exige un COMPTE — le jeton de ruche ne dit pas
 * qui vous êtes, et on ne peut pas inscrire « le jeton » comme membre.
 *
 * Un refus arrive en 404, indistinguable d'un projet qui n'existe pas. C'est
 * délibéré côté serveur, et l'appelant NE DOIT PAS le retraduire en « vous
 * n'avez pas le droit » : ce serait reconstruire l'information que le serveur
 * a tue.
 */
export function rejoindreProjet(projectId: string): Promise<{ joined: boolean }> {
  return apiCompte<{ joined: boolean }>(`/api/projects/${encodeURIComponent(projectId)}/join`, {
    method: 'POST',
  });
}

// ─── Le Cerveau, vu comme un graphe ─────────────────────────────────────────
//
// Les types sont RÉUTILISÉS depuis le module partagé plutôt que recopiés ici :
// un graphe redéclaré côté navigateur dérive du serveur au premier champ
// ajouté, et c'est le genre d'écart qui ne se voit qu'à l'écran.

export type { Graphe, NoeudGraphe, AreteGraphe } from '../../src/shared/cerveau-graphe.js';

/** Le graphe, plus le dossier d'où il sort (utile quand il est vide). */
export type CerveauGraphe = Graphe & { dossier: string };

export function fetchCerveau(): Promise<CerveauGraphe> {
  return apiCompte<CerveauGraphe>('/api/admin/cerveau');
}

// ─── Les Chantiers et les workflows ─────────────────────────────────────────
//
// Les types viennent des modules partagés, pas d'une redéclaration : un
// `Chantier` recopié ici dériverait du serveur au premier champ ajouté, et
// c'est l'écart qui ne se voit qu'à l'écran.

export type { Chantier, Nature } from '../../src/shared/chantier.js';
export type { RunWorkflow, Workflow } from '../../src/shared/workflow.js';

import type { Chantier } from '../../src/shared/chantier.js';
import type { RunWorkflow, Workflow } from '../../src/shared/workflow.js';

/** Ce qu'un nœud a rapporté du dernier chantier lancé. */
export interface VerdictChantier {
  nom: string;
  code: number | null;
  sortie: string;
  ok: boolean;
  refused?: string;
}

export function fetchChantiers(projectId: string): Promise<{ chantiers: Chantier[] }> {
  return api<{ chantiers: Chantier[] }>(`/api/projects/${encodeURIComponent(projectId)}/chantiers`);
}

export function fetchVerdictChantier(
  projectId: string,
): Promise<{ resultat: VerdictChantier | null }> {
  return api<{ resultat: VerdictChantier | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/chantiers/result`,
  );
}

export function lancerChantier(
  projectId: string,
  nom: string,
): Promise<{ chantierId: string; nodeId: string; nom: string }> {
  return api(
    `/api/projects/${encodeURIComponent(projectId)}/chantiers/${encodeURIComponent(nom)}/run`,
    { method: 'POST', body: '{}' },
  );
}

export function fetchWorkflows(
  projectId: string,
): Promise<{ workflows: Workflow[]; tronque: boolean }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/workflows`);
}

export function fetchRuns(projectId: string): Promise<{ runs: RunWorkflow[] }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/workflows/runs`);
}

/**
 * Lance un workflow. L'identifiant est un NOMBRE — jamais un nom de fichier.
 *
 * Le typage porte la règle : `POST …/actions/workflows/{id_ou_nom}/dispatches`
 * accepte les deux côté GitHub, et accepter le nom laisserait écrire un
 * morceau d'URL de son API. Ici, on ne peut pas s'y tromper.
 */
export function lancerWorkflowGithub(
  projectId: string,
  workflowId: number,
  ref: string,
): Promise<{ workflow: Workflow; ref: string }> {
  return api(`/api/projects/${encodeURIComponent(projectId)}/workflows/${String(workflowId)}/run`, {
    method: 'POST',
    body: JSON.stringify({ ref }),
  });
}
