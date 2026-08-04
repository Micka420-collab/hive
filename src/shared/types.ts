// Types communs à l'orchestrateur (Queen), aux nœuds membres et au dashboard.
// Vocabulaire de la ruche : orchestrateur = Queen, machine membre = Node,
// agent = ouvrière, tâche = butinage, crédits de compute = Nectar (palier 4).

import type { PlateformeNoeud } from './machine.js';

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
  taskId: string;
  nodeId: string;
  diff: string;
  logs: string;
  success: boolean;
  durationMs: number;
  subAgents: SubAgent[];
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
