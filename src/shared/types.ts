// Types communs à l'orchestrateur (Queen), aux nœuds membres et au dashboard.
// Vocabulaire de la ruche : orchestrateur = Queen, machine membre = Node,
// agent = ouvrière, tâche = butinage, crédits de compute = Nectar (palier 4).

import type { PlateformeNoeud } from './machine.js';
import type { OutilConstate } from './protocol.js';

/** Cycle de vie : pending → ready (dépendances done) → assigned → running → done | failed. */
export type TaskStatus = 'pending' | 'ready' | 'assigned' | 'running' | 'done' | 'failed';

export type NodeStatus = 'online' | 'offline';

export interface Project {
  id: string;
  name: string;
  repoUrl: string | null;
  description: string | null;
  visibility: 'public' | 'private';
  ownerId: string | null;
  createdAt: number;
}

/** Machine membre de la ruche. */
export interface HiveNode {
  id: string;
  name: string;
  ownerName: string;
  agentType: string;
  maxConcurrency: number;
  /** Nombre de tâches actives (assigned/running) — toujours dérivé des tâches, jamais stocké. */
  running: number;
  status: NodeStatus;
  lastSeen: number | null;
  /**
   * La machine derrière l'ouvrière (windows/macos/linux/autre), DÉCLARÉE par
   * le nœud à l'inscription. `null`/absent : nœud d'une version antérieure —
   * on affiche alors rien plutôt qu'une plateforme inventée.
   */
  plateforme?: PlateformeNoeud | null;
  /**
   * Les modèles que ce nœud sait faire tourner (ex. `['claude-opus-5',
   * 'claude-fable-5']`), DÉCLARÉS à l'inscription. C'est ce que l'Aiguillage
   * appris consomme pour choisir. Absent/vide : nœud d'avant l'Aiguillage ou
   * agent à modèle unique — la ruche retombe sur son ordonnancement d'avant.
   */
  modeles?: string[];
  /**
   * Les outils IA que ce nœud a CONSTATÉS sur sa machine à l'inscription :
   * binaire trouvé sur le PATH, clé lisible dans l'environnement. C'est un
   * constat de PRÉSENCE, jamais une capacité — jusqu'où la ruche va avec
   * chacun est dit par le catalogue, et les deux ne se croisent qu'à
   * l'affichage (`outils-du-noeud.ts`).
   *
   * Absent : nœud d'avant cette version. L'écran montre alors qu'il ne sait
   * pas, plutôt qu'une liste vide qui se lirait « aucun outil ».
   */
  outils?: OutilConstate[];
  /**
   * Le bac à sable dans lequel ce nœud exécute ses tâches, DÉCLARÉ par lui à
   * l'inscription. Affichage seulement — jamais un critère d'assignation ni un
   * privilège : un nœud peut se tromper ou mentir, l'écran dit « déclaré ».
   * Absent : le nœud ne l'a pas dit à cette inscription, et l'écran le dit.
   */
  isolement?: IsolementDeclare;
}

/** Les niveaux d'isolement qu'un nœud peut déclarer (cf. `node-client/isolement.ts`). */
export const NIVEAUX_ISOLEMENT = ['aucun', 'processus', 'conteneur'] as const;

export interface IsolementDeclare {
  niveau: (typeof NIVEAUX_ISOLEMENT)[number];
  /** Le moteur du bac (`podman`, `docker`, `bubblewrap`) au niveau `conteneur`. */
  fournisseur?: string;
}

/** Sous-agent lancé par un agent sur un nœud (visualisé en pulsation sur le Swarm View). */
export interface SubAgent {
  id: string;
  name: string;
  status: 'running' | 'done' | 'failed';
}

/** Résumé du résultat stocké sur la tâche elle-même (le détail vit dans `results`). */
export interface TaskResultSummary {
  success: boolean;
  nodeId: string;
  durationMs: number;
  /** Mesure locale du processus Worker, absente sur les anciens résultats. */
  usage?: ExecutionUsage;
}

/**
 * Ressources réellement observées par le Worker pendant une tentative.
 *
 * Ces compteurs décrivent le processus Node local. Ils ne sont pas une facture
 * fournisseur et ne doivent jamais être présentés comme un coût monétaire.
 */
export interface ExecutionUsage {
  userCpuMicros: number;
  systemCpuMicros: number;
  maxRssBytes: number;
  rssBytes: number;
  heapUsedBytes: number;
}

/**
 * Ce que le CLI de l'agent DÉCLARE pour une exécution — coût, temps passé dans
 * les appels au modèle, modèles exacts, jetons. Hive ne l'estime jamais : un
 * champ absent veut dire « non déclaré », et l'interface le dit « inconnu ».
 *
 * `coutUsd` est le montant rapporté par le CLI (Claude Code : `total_cost_usd`,
 * calculé par le CLI au tarif public). Sur un abonnement, ce n'est pas une
 * facture : c'est la valeur déclarée, et elle est présentée comme telle.
 */
export interface UsageFournisseur {
  /** L'agent dont le CLI a fait la déclaration. */
  source: string;
  coutUsd?: number;
  /** Temps passé dans les appels au modèle, selon le CLI. */
  dureeApiMs?: number;
  /** Modèles exacts ayant servi, tels que nommés par le CLI. */
  modeles?: string[];
  jetonsEntree?: number;
  jetonsSortie?: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  dependsOn: string[];
  assignedNodeId: string | null;
  result: TaskResultSummary | null;
  /** Branche git isolée `hive/<taskId>` — jamais de push automatique sur main. */
  branch: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

/** Résultat complet remonté par un nœud. Le diff reste soumis à revue humaine. */
export interface TaskResult {
  /** Identifiant SQLite de la production — présent quand elle vient du store. */
  resultId?: number;
  taskId: string;
  nodeId: string;
  diff: string;
  logs: string;
  success: boolean;
  durationMs: number;
  subAgents: SubAgent[];
  /** Ressources locales observées, quand le nœud les a mesurées. */
  usage?: ExecutionUsage;
  /** Déclaration du CLI de l'agent, quand il en fait une. */
  fournisseur?: UsageFournisseur;
}

/** Entrée du journal d'événements — base du futur Time-Lapse Replay (palier 3). */
export interface HiveEvent {
  id: number;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
}

/** Photographie complète de l'état, envoyée au dashboard. */
export interface StateSnapshot {
  projects: Project[];
  nodes: HiveNode[];
  /**
   * Une FENÊTRE sur les tâches, pas la table entière.
   *
   * Toutes les tâches vivantes y sont, quel que soit leur âge ; la limite ne
   * rogne que sur les terminées, des plus récentes aux plus vieilles.
   */
  tasks: Task[];
  /**
   * Le nombre RÉEL de tâches, `tasks.length` compris.
   *
   * ─── POURQUOI CE CHAMP EXISTE ──────────────────────────────────────────────
   *
   * Sans lui, un instantané tronqué a exactement l'air d'un instantané complet.
   * C'est le mode de panne que ce dépôt redoute le plus : « un contexte amputé
   * mais qui a l'air complet est pire qu'une erreur, parce que personne ne va
   * vérifier ». Un tableau de bord qui affiche 2 000 tâches sur 20 000 sans le
   * dire fait compter faux à qui le lit.
   *
   * `tasksTotal > tasks.length` est donc la façon dont l'instantané ANNONCE sa
   * propre troncature, et l'écran a de quoi le dire.
   */
  tasksTotal: number;
}

/**
 * Combien de tâches un instantané transporte au plus.
 *
 * 2 000 est mesuré, pas choisi : c'est le dernier palier où la fabrication et
 * la sérialisation d'un instantané tiennent sous ~25 ms au total (14,2 + 8,9),
 * pour 0,91 Mo par tableau de bord connecté. Le palier suivant, 5 000, double
 * déjà la note ; 20 000 la porte à 277 ms — pendant lesquelles l'orchestrateur,
 * mono-thread, ne répond à personne.
 */
export const LIMITE_TACHES_INSTANTANE = 2000;

// ─── Constantes de fonctionnement ────────────────────────────────────────────
/** Nombre maximal de tentatives avant de marquer une tâche `failed`. */
export const MAX_ATTEMPTS = 3;
/** Un nœud sans heartbeat au-delà de ce délai est déclaré offline. */
export const NODE_TIMEOUT_MS = 15_000;
/** Fréquence d'envoi du heartbeat côté nœud. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
// ─── Utilisateurs ────────────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  createdAt: number;
}

/** Utilisateur sérialisé pour l'API (sans le hash). */
export type UserPublic = Omit<User, 'passwordHash'>;

/** Valeur par défaut du token — considérée triviale, refusée hors simulation. */
export const DEFAULT_TOKEN = 'change-me';
/** Longueur minimale d'un token jugé non-trivial. */
export const MIN_TOKEN_LENGTH = 16;
