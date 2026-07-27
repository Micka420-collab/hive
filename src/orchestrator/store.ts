// Persistance SQLite (better-sqlite3) — l'état de la ruche survit aux
// redémarrages de l'orchestrateur. Tout le SQL vit dans cette classe.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LIMITS } from '../shared/protocol.js';
import { CORPUS_BALANCE, LOT_GRAND_LIVRE, VERSION_BALANCE } from './balance.js';
import { CORPUS_GARDIENNES, VERSION_GARDIENNES } from './gardiennes.js';
import type { Grief, LigneGardienne, Verdict } from './gardiennes.js';
import { rankMemories } from './hive-mind.js';
import type { Memory, ScoredMemory } from './hive-mind.js';
import type {
  HiveEvent,
  HiveNode,
  NodeStatus,
  Project,
  StateSnapshot,
  SubAgent,
  Task,
  TaskResult,
  TaskResultSummary,
  TaskStatus,
  User,
} from '../shared/types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  repoUrl     TEXT,
  description TEXT,
  visibility  TEXT NOT NULL DEFAULT 'private',
  ownerId     TEXT,
  createdAt   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  projectId TEXT NOT NULL,
  userId    TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member',
  joinedAt  INTEGER NOT NULL,
  PRIMARY KEY (projectId, userId)
);

CREATE TABLE IF NOT EXISTS nodes (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  ownerName      TEXT NOT NULL,
  agentType      TEXT NOT NULL,
  maxConcurrency INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'offline',
  lastSeen       INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  projectId      TEXT NOT NULL REFERENCES projects(id),
  title          TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  dependsOn      TEXT NOT NULL DEFAULT '[]',
  assignedNodeId TEXT,
  result         TEXT,
  branch         TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  createdAt      INTEGER NOT NULL,
  updatedAt      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_tasks_node ON tasks(assignedNodeId);

CREATE TABLE IF NOT EXISTS results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId     TEXT NOT NULL,
  nodeId     TEXT NOT NULL,
  success    INTEGER NOT NULL,
  diff       TEXT NOT NULL DEFAULT '',
  logs       TEXT NOT NULL DEFAULT '',
  durationMs INTEGER NOT NULL DEFAULT 0,
  subAgents  TEXT NOT NULL DEFAULT '[]',
  createdAt  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_task ON results(taskId);
-- Index COUVRANT du corpus des phéromones : sans lui, « ORDER BY createdAt
-- DESC, id DESC LIMIT 500 » scanne toute la table et la trie dans un B-tree
-- temporaire — en ouvrant au passage les pages de débordement de diff
-- (≤ 1 Mo) et logs (≤ 512 ko), qui précèdent createdAt dans la ligne.
-- Toutes les colonnes lues y figurent : la requête ne touche plus une seule
-- ligne de la table.
CREATE INDEX IF NOT EXISTS idx_results_recent
  ON results(createdAt DESC, id DESC, taskId, nodeId, success);
-- Index COUVRANT de la Balance (le pèse-ruche). Sans lui, la lecture
-- incrémentale du grand livre retombe sur « SEARCH results USING INTEGER
-- PRIMARY KEY » : SQLite ouvre alors la LIGNE, et durationMs est stocké APRÈS
-- diff (≤ 1 Mo) et logs (≤ 512 ko) — il faut traverser toute la chaîne de pages
-- de débordement pour lire un entier. Même raisonnement que le commentaire
-- d'idx_results_recent ci-dessus. Plans mesurés, et verrouillés par
-- tests/store-scaling.test.ts.
-- NE PAS étendre idx_results_recent pour y arriver : CREATE INDEX IF NOT EXISTS
-- ne redéfinit PAS un index existant — les bases déjà en service garderaient
-- l'ancienne définition et perdraient silencieusement leur plan couvrant.
-- Toujours un nom neuf. Les deux index ont des colonnes de tête différentes :
-- aucun des deux n'est redondant, et le nouveau ne détourne pas le planner du
-- corpus des phéromones (prouvé, même fichier de test).
CREATE INDEX IF NOT EXISTS idx_results_balance
  ON results(id, taskId, nodeId, success, durationMs);

-- Plafond de dépense par projet (la Balance — BORNER). Cette table stocke une
-- INTENTION HUMAINE, jamais un calcul : rien de dérivé n'est écrit en base
-- (doctrine, règle 1). Ligne ABSENTE = pas de plafond = comportement d'avant la
-- Balance, à la virgule près. L'absence de ligne EST l'état « éteint » : pas de
-- drapeau actif, pas de plafond nul déguisé.
--
-- PAS de pruneBudgets, JAMAIS (doctrine, règle 3). Cette table est 1:1 avec
-- projects : elle est bornée PAR CONSTRUCTION, sa taille est celle du nombre de
-- projets de la ruche, et aucune ligne ne peut y naître sans qu'un humain l'ait
-- posée. Un élagage « par symétrie » avec pruneEvents ou pruneResults effacerait
-- des intentions humaines encore en vigueur : ce serait un plafond qui se lève
-- tout seul. Cette phrase est ici pour que personne n'en ajoute un dans trois
-- ans.
--
-- version   : version de la SÉMANTIQUE du plafond au moment de la pose. Une v2
--             (plafond glissant, plafond par fenêtre…) pourra cohabiter avec
--             les lignes posées en v1, sans migration ni corpus corrompu.
-- definiPar : userId de l'opérateur, NULLABLE dès le jour 1 — filtrer par
--             opérateur plus tard coûtera une clause WHERE, jamais une
--             modification de colonne. Ce n'est PAS une autorisation, c'est une
--             trace : la garde reste le token du hub.
CREATE TABLE IF NOT EXISTS budgets (
  projectId TEXT PRIMARY KEY REFERENCES projects(id),
  plafondMs INTEGER NOT NULL,
  version   INTEGER NOT NULL DEFAULT 1,
  definiPar TEXT,
  updatedAt INTEGER NOT NULL
);

-- Le Plein Essaim — l'autonomie d'un projet, et rien d'autre.
--
-- UNE INTENTION HUMAINE, pas un calcul (règle 1 : aucune vue dérivée
-- matérialisée). Le niveau d'autonomie et l'inscription du dépôt sont posés à
-- la main par le propriétaire du projet ; rien ici ne naît d'une décision de
-- la ruche. Une ruche autonome qui pourrait élever son PROPRE niveau
-- d'autonomie ne serait pas gouvernée, elle serait échappée.
--
-- BORNE STRUCTURELLE, comme « budgets » (règle 3) : une ligne par projet, donc
-- une taille qui ne croît pas avec l'histoire de la ruche. Pas d'élagueur, et
-- il ne faut jamais en ajouter « par symétrie » — élaguer cette table
-- rendrait silencieusement à « off » un projet que l'humain avait ouvert, ou
-- pire, désinscrirait un dépôt sans que personne le sache.
CREATE TABLE IF NOT EXISTS essaim (
  projectId     TEXT PRIMARY KEY REFERENCES projects(id),
  niveau        TEXT NOT NULL,
  depotInscrit  INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  definiPar     TEXT,
  updatedAt     INTEGER NOT NULL
);

-- La Balance — CACHE RECONSTRUCTIBLE du grand livre. Son nom le dit, et c'est
-- délibéré : balance_ledger_cache n'est PAS une source de vérité. La vérité
-- reste results, et cette table peut être effacée à tout moment sans perdre
-- une seule information — le rattrapage la reconstruit à l'identique. Voir la
-- règle 1 de la doctrine (balance.ts) pour la justification complète de la
-- seule exception à « rien de calculé n'est écrit en base ».
--
-- Elle existe pour une seule raison : sans elle, le filigrane repart de 0 à
-- chaque démarrage et le rattrapage relit TOUT l'historique — O(un an de ruche)
-- au boot, pendant lequel la porte des plafonds reste ouverte (FAIL-OPEN).
--
-- BORNE D'ÉLAGAGE (règle 3), STRUCTURELLE comme celle de budgets : une ligne
-- par projet ayant dépensé, donc ≤ projects. Elle ne croît pas avec l'histoire
-- de la ruche, et n'a donc PAS de pruneLedgerCache.
--
-- filigrane : id du dernier résultat absorbé. IDENTIQUE sur toutes les lignes —
--             elles sont réécrites ensemble, dans une seule transaction. Des
--             filigranes divergents = cache corrompu = reconstruction totale.
-- version   : VERSION_BALANCE au moment de l'écriture. Une v2 de l'imputation
--             invalide le cache sans migration : on le jette, on recompte.
--
-- AUCUNE clé étrangère vers projects, contrairement à budgets — et c'est
-- délibéré : cette table est écrite DANS LE TICK. Une contrainte violée y
-- lèverait une exception sur le chemin chaud pour protéger... un cache, qu'on
-- peut jeter. Un projectId orphelin dans un cache ne coûte rien ; un tick qui
-- explose, si.
CREATE TABLE IF NOT EXISTS balance_ledger_cache (
  projectId  TEXT PRIMARY KEY,
  depenseMs  INTEGER NOT NULL,
  tentatives INTEGER NOT NULL,
  filigrane  INTEGER NOT NULL,
  version    INTEGER NOT NULL
);

-- Les Gardiennes — le contrôle d'entrée du nectar. UNE LIGNE PAR INSPECTION,
-- écrite À LA RÉCEPTION du résultat (scheduler.handleTaskResult).
--
-- POURQUOI UNE TABLE, alors que la doctrine interdit d'écrire un calcul
-- (règle 1) : parce que ce verdict N'EST PAS RECALCULABLE. pruneResults vide
-- diff et logs au-delà de 5 000 résultats ; un verdict recalculé plus tard sur
-- un diff élagué dirait « diff vide » de toutes les productions anciennes.
-- Ce n'est donc pas un cache (rien ne peut le reconstruire), c'est un FAIT
-- DATÉ — la seule catégorie d'écriture que la règle 1 n'a jamais visée.
--
-- POURQUOI PAS UNE COLONNE SUR results : l'y ajouter exigerait la première
-- MIGRATION du dépôt, qui n'a aucun mécanisme pour ça (règle 2) — et le verrou
-- de source de tests/security-invariants.test.ts l'interdit à la lettre. Le piège
-- est pire qu'il n'en a l'air — ajouter une colonne au SELECT des phéromones
-- ferait retomber SILENCIEUSEMENT toutes les bases en service hors de l'index
-- couvrant idx_results_recent, car CREATE INDEX IF NOT EXISTS ne redéfinit PAS
-- un index existant. Table NEUVE, index existants INTACTS — et aucun index
-- ajouté ici : la seule lecture est un parcours ARRIÈRE de la clé primaire,
-- borné par un LIMIT (plan prouvé dans tests/store-scaling.test.ts).
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME commit : pruneGardiennes, aligné sur
-- EVENT_RETENTION et RESULT_RETENTION. Cette table-ci n'est PAS bornée par
-- construction (elle grandit avec l'histoire), contrairement à budgets et à
-- balance_ledger_cache : elle a donc un vrai élagueur, et il SUPPRIME (une
-- ligne allégée de ses griefs ne dirait plus rien).
--
-- resultId : results.id de la production inspectée — le fait pointe sur sa
--            pièce à conviction, tant qu'elle existe. Aucune clé étrangère :
--            la table est écrite sur le chemin d'un résultat, et une contrainte
--            violée y lèverait une exception pour protéger une trace.
-- applique : 1 = le verdict a RÉELLEMENT refusé l'entrée (mode strict
--            seulement). En consultatif, toujours 0 : on annote, on ne
--            contraint pas. C'est ce qui rend les deux modes distinguables
--            APRÈS COUP, sans quoi une campagne d'observation serait illisible.
-- griefs   : JSON des griefs typés (codes anglais snake_case, chemins, comptes,
--            extrait déjà neutralisé). AUCUN texte d'affichage : le bilingue
--            est reconstruit à la lecture.
-- version  : VERSION_GARDIENNES à l'inspection. Une v2 du barème cohabitera
--            avec les lignes v1 sans migration ni corpus corrompu.
CREATE TABLE IF NOT EXISTS gardiennes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  resultId  INTEGER NOT NULL,
  taskId    TEXT NOT NULL,
  nodeId    TEXT NOT NULL,
  verdict   TEXT NOT NULL,
  score     INTEGER NOT NULL,
  applique  INTEGER NOT NULL DEFAULT 0,
  griefs    TEXT NOT NULL DEFAULT '[]',
  version   INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);

-- ─── Le trou de vol ─────────────────────────────────────────────────────────
-- Deux tables, une par nature, et surtout PAS une seule : un billet est une
-- invitation éphémère qu'on distribue, une clé de nœud est une identité durable
-- qu'on garde. Les confondre, c'est ce que faisait l'ancien format (un seul
-- token pour tout et pour tous) — et c'est exactement pourquoi on ne pouvait
-- exclure personne sans éjecter l'essaim entier.
--
-- AUCUN SECRET N'EST RANGÉ ICI. Les deux tables ne portent que des empreintes
-- PBKDF2 salées (src/shared/acces.ts) : une base volée ne donne aucun accès.
--
-- BORNE D'ÉLAGAGE (règle 3 de la doctrine), dans le MÊME changement :
-- « pruneAcces », qui supprime les billets morts (révoqués, expirés ou épuisés)
-- au-delà d'une période de grâce. Les billets VIVANTS ne sont jamais élagués —
-- un billet encore valide qui disparaîtrait rendrait une invitation en circulation
-- silencieusement inutilisable. Les clés de nœud, elles, ne sont PAS élaguées
-- automatiquement : ce sont des identités, leur retrait est un geste humain
-- (révocation), exactement comme le merge.
CREATE TABLE IF NOT EXISTS invite_tickets (
  id           TEXT PRIMARY KEY,
  secretHash   TEXT NOT NULL,
  label        TEXT,
  createdBy    TEXT,
  createdAt    INTEGER NOT NULL,
  expiresAt    INTEGER NOT NULL,
  usesLeft     INTEGER NOT NULL,
  usesTotal    INTEGER NOT NULL,
  revokedAt    INTEGER,
  lastUsedAt   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_expiry ON invite_tickets(expiresAt);

-- Une clé par nœud. « nodeId » est la clé primaire : un nœud a UNE identité, et
-- rejoindre à nouveau avec un nouveau billet remplace sa clé (rotation) plutôt
-- que d'en accumuler.
CREATE TABLE IF NOT EXISTS node_keys (
  nodeId     TEXT PRIMARY KEY,
  keyHash    TEXT NOT NULL,
  label      TEXT,
  ticketId   TEXT,
  createdAt  INTEGER NOT NULL,
  lastSeenAt INTEGER,
  revokedAt  INTEGER
);

-- ─── Le Conseil des Éclaireuses ─────────────────────────────────────────────
-- Quatre tables parce qu'il y a quatre natures distinctes : une SESSION (la
-- question posée), les TÂCHES qu'elle a engendrées (le lien vers le travail
-- réel des ouvrières), les PROPOSITIONS rapportées, et les AVIS émis dessus.
--
-- Les propositions et les avis portent du texte écrit par des agents qui ont LU
-- LE WEB. Ils sont donc rangés tels quels — déjà aplatis et bornés par
-- eclaireuse.ts — et ne ressortent JAMAIS dans un prompt autrement que via
-- src/shared/donnees-non-fiables.ts.
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME changement : « pruneConseils », qui
-- ne supprime que des sessions CLOSES au-delà d'un quota. Une session en cours
-- n'est jamais touchée — la faire disparaître laisserait des tâches
-- d'éclaireuses orphelines qui tourneraient pour un conseil inexistant.
CREATE TABLE IF NOT EXISTS conseil_sessions (
  id        TEXT PRIMARY KEY,
  question  TEXT NOT NULL,
  projectId TEXT,
  etat      TEXT NOT NULL,
  tour      INTEGER NOT NULL DEFAULT 1,
  toursSecs INTEGER NOT NULL DEFAULT 0,
  issue     TEXT,
  motif     TEXT,
  version   INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  closedAt  INTEGER
);

-- Le lien tache <-> role. Sans lui, on ne saurait pas si un resultat qui
-- revient est une exploration ou la verification d'une proposition precise.
CREATE TABLE IF NOT EXISTS conseil_taches (
  taskId        TEXT PRIMARY KEY,
  sessionId     TEXT NOT NULL,
  role          TEXT NOT NULL,
  lentille      TEXT,
  propositionId TEXT,
  tour          INTEGER NOT NULL,
  depouille     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conseil_taches_session ON conseil_taches(sessionId, depouille);

CREATE TABLE IF NOT EXISTS conseil_propositions (
  id         TEXT PRIMARY KEY,
  sessionId  TEXT NOT NULL,
  eclaireuse TEXT NOT NULL,
  famille    TEXT NOT NULL,
  titre      TEXT NOT NULL,
  corps      TEXT NOT NULL,
  qualite    INTEGER NOT NULL,
  sources    TEXT NOT NULL DEFAULT '[]',
  tour       INTEGER NOT NULL,
  createdAt  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conseil_props_session ON conseil_propositions(sessionId);

CREATE TABLE IF NOT EXISTS conseil_avis (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId     TEXT NOT NULL,
  propositionId TEXT NOT NULL,
  eclaireuse    TEXT NOT NULL,
  famille       TEXT NOT NULL,
  type          TEXT NOT NULL,
  force         INTEGER NOT NULL,
  raison        TEXT NOT NULL DEFAULT '',
  tour          INTEGER NOT NULL,
  createdAt     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conseil_avis_session ON conseil_avis(sessionId);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);
-- Lecture par FENÊTRE TEMPORELLE (thermorégulation) : ts en tête pour la
-- borne « ts >= ? », type ensuite pour filtrer sans ouvrir la ligne.
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts, type);

CREATE TABLE IF NOT EXISTS memories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL,
  taskId    TEXT NOT NULL,
  title     TEXT NOT NULL,
  content   TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_task ON memories(taskId);

CREATE TABLE IF NOT EXISTS reviews (
  taskId    TEXT PRIMARY KEY,
  state     TEXT NOT NULL CHECK (state IN ('approved', 'rejected')),
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName  TEXT NOT NULL,
  bio          TEXT DEFAULT '',
  avatarUrl    TEXT DEFAULT '',
  createdAt    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  projectId TEXT NOT NULL REFERENCES projects(id),
  userId    TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL DEFAULT 'member',
  joinedAt  INTEGER NOT NULL,
  PRIMARY KEY (projectId, userId)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(userId);
`;

interface ProjectRow {
  id: string;
  name: string;
  repoUrl: string | null;
  description: string | null;
  visibility: 'public' | 'private';
  ownerId: string | null;
  createdAt: number;
}

interface NodeRow {
  id: string;
  name: string;
  ownerName: string;
  agentType: string;
  maxConcurrency: number;
  status: NodeStatus;
  lastSeen: number | null;
  running: number;
}

interface TaskRow {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  dependsOn: string;
  assignedNodeId: string | null;
  result: string | null;
  branch: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

interface ResultRow {
  taskId: string;
  nodeId: string;
  success: number;
  diff: string;
  logs: string;
  durationMs: number;
  subAgents: string;
}

/** Résultat réduit au strict nécessaire de la Balance (aucune colonne lourde). */
export interface ResultatBalance {
  id: number;
  taskId: string;
  nodeId: string;
  success: boolean;
  durationMs: number;
}

interface ResultatRow {
  id: number;
  taskId: string;
  nodeId: string;
  success: number;
  durationMs: number;
}

function rowToResultatBalance(r: ResultatRow): ResultatBalance {
  return {
    id: r.id,
    taskId: r.taskId,
    nodeId: r.nodeId,
    success: r.success === 1,
    durationMs: r.durationMs,
  };
}

/**
 * Plafond de dépense posé par un humain sur un projet. Ligne de la table
 * `budgets`, rendue telle quelle : aucun calcul, aucune dérivation.
 */
export interface Budget {
  projectId: string;
  plafondMs: number;
  /** Version de la sémantique du plafond au moment de la pose (VERSION_BALANCE). */
  version: number;
  /** userId de l'opérateur — une TRACE, jamais une autorisation. */
  definiPar: string | null;
  updatedAt: number;
}

/**
 * Un billet tel qu'il est RANGÉ : `secretHash` est une empreinte, jamais le
 * secret. Le type le dit dans son nom pour qu'aucun appelant ne croie tenir de
 * quoi reconstruire une invitation — un billet perdu se remplace, il ne se
 * retrouve pas.
 */
export interface BilletRange {
  id: string;
  secretHash: string;
  label: string | null;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usesLeft: number;
  usesTotal: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

/** Idem pour la clé d'un nœud : `keyHash` est une empreinte. */
export interface CleNoeudRangee {
  nodeId: string;
  keyHash: string;
  label: string | null;
  ticketId: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

/** Une session de Conseil telle qu'elle est rangée. */
export interface SessionRangee {
  id: string;
  question: string;
  projectId: string | null;
  etat: 'exploration' | 'verification' | 'clos';
  tour: number;
  toursSecs: number;
  issue: string | null;
  motif: string | null;
  version: number;
  createdAt: number;
  closedAt: number | null;
}

/** Le lien entre une tâche d'ouvrière et son rôle dans le conseil. */
export interface TacheConseil {
  taskId: string;
  sessionId: string;
  role: 'exploration' | 'verification';
  lentille: string | null;
  propositionId: string | null;
  tour: number;
  depouille: number;
}

export interface PropositionRangee {
  id: string;
  sessionId: string;
  eclaireuse: string;
  famille: string;
  titre: string;
  corps: string;
  qualite: number;
  /** JSON : liste d'URLs. Jamais suivies par la ruche. */
  sources: string;
  tour: number;
  createdAt: number;
}

export interface AvisRange {
  id: number;
  sessionId: string;
  propositionId: string;
  eclaireuse: string;
  famille: string;
  type: 'soutien' | 'arret';
  force: number;
  raison: string;
  tour: number;
  createdAt: number;
}

interface EventRow {
  id: number;
  ts: number;
  type: string;
  payload: string;
}

interface MemoryRow {
  id: number;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface NewProject {
  name: string;
  repoUrl?: string | null;
  description?: string | null;
  visibility?: 'public' | 'private';
  ownerId?: string | null;
}

export interface NewTask {
  id?: string;
  projectId: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
}

export interface NodeProfile {
  nodeId?: string;
  name: string;
  ownerName: string;
  agentType: string;
  maxConcurrency: number;
}

export interface TaskPatch {
  status?: TaskStatus;
  assignedNodeId?: string | null;
  result?: TaskResultSummary | null;
  branch?: string | null;
  attempts?: number;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: string;
  joinedAt: number;
  /** Jointure : displayName de l'utilisateur pour l'affichage. */
  displayName?: string;
}

/** Résultats allégés au maximum par passe : borne le coût d'un tick. */
const LOT_ALLEGEMENT = 2_000;

/**
 * Relit les griefs d'une ligne de garde. Tolérant par conception : une ligne
 * illisible (version future, base éditée à la main) vaut « aucun grief connu »,
 * jamais une exception qui ferait tomber toute une page de lecture.
 */
function lireGriefs(brut: string): Grief[] {
  try {
    const lus: unknown = JSON.parse(brut);
    return Array.isArray(lus) ? (lus as Grief[]) : [];
  } catch {
    return [];
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    dependsOn: JSON.parse(row.dependsOn) as string[],
    result: row.result ? (JSON.parse(row.result) as TaskResultSummary) : null,
  };
}

/** `running` est calculé à la volée depuis les tâches actives — jamais stocké. */
const NODE_SELECT = `
  SELECT n.*, (
    SELECT COUNT(*) FROM tasks t
    WHERE t.assignedNodeId = n.id AND t.status IN ('assigned', 'running')
  ) AS running
  FROM nodes n
`;

export class HiveStore {
  private readonly db: Database.Database;
  /**
   * Filigrane d'élagage des résultats : id du dernier résultat déjà allégé.
   * En mémoire seulement — un redémarrage refait une passe complète (idempotente).
   */
  private dernierResultatAllege = 0;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ─── Utilisateurs ───────────────────────────────────────────────────────────
  createUser(input: NewUser): User {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, email, passwordHash, displayName, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.email, input.passwordHash, input.displayName, now);
    return {
      id,
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      bio: '',
      avatarUrl: '',
      createdAt: now,
    };
  }

  getUserById(id: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  }

  getUserByEmail(email: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;
  }

  updateUserProfile(
    id: string,
    patch: { displayName?: string; bio?: string; avatarUrl?: string },
  ): User | undefined {
    const user = this.getUserById(id);
    if (!user) return undefined;
    const next = { ...user, ...patch };
    this.db
      .prepare('UPDATE users SET displayName = ?, bio = ?, avatarUrl = ? WHERE id = ?')
      .run(next.displayName, next.bio, next.avatarUrl, id);
    return next;
  }

  // ─── Projets ───────────────────────────────────────────────────────────────
  createProject(input: NewProject): Project {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      repoUrl: input.repoUrl ?? null,
      description: input.description ?? null,
      visibility: input.visibility ?? 'private',
      ownerId: input.ownerId ?? null,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO projects (id, name, repoUrl, description, visibility, ownerId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        project.id,
        project.name,
        project.repoUrl,
        project.description,
        project.visibility,
        project.ownerId,
        project.createdAt,
      );
    return project;
  }

  getProject(id: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  }

  listProjects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY createdAt').all() as ProjectRow[];
  }

  findProjectByName(name: string): Project | undefined {
    return this.db
      .prepare('SELECT * FROM projects WHERE name = ? ORDER BY createdAt DESC')
      .get(name) as ProjectRow | undefined;
  }

  /** Projets publics, triés du plus récent au plus ancien. */
  listPublicProjects(): Project[] {
    return this.db
      .prepare("SELECT * FROM projects WHERE visibility = 'public' ORDER BY createdAt DESC")
      .all() as ProjectRow[];
  }

  // ─── Membres des projets ────────────────────────────────────────────────────
  addMember(projectId: string, userId: string, role = 'member'): ProjectMember {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT OR IGNORE INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, ?, ?)',
      )
      .run(projectId, userId, role, now);
    return { projectId, userId, role, joinedAt: now };
  }

  listMembers(projectId: string): ProjectMember[] {
    const rows = this.db
      .prepare(
        `SELECT pm.*, u.displayName
         FROM project_members pm
         JOIN users u ON pm.userId = u.id
         WHERE pm.projectId = ?
         ORDER BY pm.joinedAt`,
      )
      .all(projectId) as (ProjectMember & { displayName: string })[];
    return rows;
  }

  listUserProjects(userId: string): (ProjectMember & { projectName: string })[] {
    return this.db
      .prepare(
        `SELECT pm.*, p.name as projectName
         FROM project_members pm
         JOIN projects p ON pm.projectId = p.id
         WHERE pm.userId = ?
         ORDER BY pm.joinedAt DESC`,
      )
      .all(userId) as (ProjectMember & { projectName: string })[];
  }

  // ─── Nœuds ─────────────────────────────────────────────────────────────────
  /** Enregistre (ou ré-enregistre) un nœud et le passe online. */
  registerNode(profile: NodeProfile, now = Date.now()): HiveNode {
    const existing = profile.nodeId ? this.getNode(profile.nodeId) : undefined;
    const id = existing?.id ?? profile.nodeId ?? randomUUID();
    if (existing) {
      this.db
        .prepare(
          'UPDATE nodes SET name = ?, ownerName = ?, agentType = ?, maxConcurrency = ?, status = ?, lastSeen = ? WHERE id = ?',
        )
        .run(
          profile.name,
          profile.ownerName,
          profile.agentType,
          profile.maxConcurrency,
          'online',
          now,
          id,
        );
    } else {
      this.db
        .prepare(
          'INSERT INTO nodes (id, name, ownerName, agentType, maxConcurrency, status, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          profile.name,
          profile.ownerName,
          profile.agentType,
          profile.maxConcurrency,
          'online',
          now,
        );
    }
    return this.getNode(id) as HiveNode;
  }

  getNode(id: string): HiveNode | undefined {
    return this.db.prepare(`${NODE_SELECT} WHERE n.id = ?`).get(id) as NodeRow | undefined;
  }

  listNodes(): HiveNode[] {
    return this.db.prepare(`${NODE_SELECT} ORDER BY n.name`).all() as NodeRow[];
  }

  setNodeStatus(id: string, status: NodeStatus): void {
    this.db.prepare('UPDATE nodes SET status = ? WHERE id = ?').run(status, id);
  }

  /** Met à jour le dernier heartbeat vu (le statut est géré par le scheduler). */
  touchNode(id: string, now = Date.now()): void {
    this.db.prepare('UPDATE nodes SET lastSeen = ? WHERE id = ?').run(now, id);
  }

  /** Nœuds online dont le dernier heartbeat est antérieur à `cutoff`. */
  staleNodes(cutoff: number): HiveNode[] {
    return this.db
      .prepare(
        `${NODE_SELECT} WHERE n.status = 'online' AND (n.lastSeen IS NULL OR n.lastSeen < ?)`,
      )
      .all(cutoff) as NodeRow[];
  }

  // ─── Tâches ────────────────────────────────────────────────────────────────
  createTask(input: NewTask, now = Date.now()): Task {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks (id, projectId, title, prompt, status, dependsOn, attempts, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.prompt,
        JSON.stringify(input.dependsOn ?? []),
        now,
        now,
      );
    return this.getTask(id) as Task;
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  listTasks(projectId?: string): Task[] {
    const rows = (
      projectId
        ? this.db
            .prepare('SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt, id')
            .all(projectId)
        : this.db.prepare('SELECT * FROM tasks ORDER BY createdAt, id').all()
    ) as TaskRow[];
    return rows.map(rowToTask);
  }

  /**
   * Lecture ciblée par CLÉ PRIMAIRE : seules les colonnes et les lignes
   * demandées. Découpée en lots de 900 pour rester sous la limite de variables
   * liées de SQLite (999 par défaut) ; les ids sont dédoublonnés, les inconnus
   * simplement absents du retour.
   *
   * `table` / `cle` par défaut sur `tasks(id)` — le cas de très loin le plus
   * fréquent. `reviews(taskId)` emprunte le même chemin : sa clé primaire est
   * un index, le plan est un SEARCH, jamais un SCAN (verrouillé par
   * tests/store-scaling.test.ts). Ni l'un ni l'autre ne vient jamais de
   * l'extérieur : ce sont des littéraux de ce fichier.
   */
  private lireParIds<T>(
    colonnes: string,
    ids: readonly string[],
    table: 'tasks' | 'reviews' = 'tasks',
    cle: 'id' | 'taskId' = 'id',
  ): T[] {
    const uniques = [...new Set(ids)];
    const LOT = 900;
    const out: T[] = [];
    for (let i = 0; i < uniques.length; i += LOT) {
      const lot = uniques.slice(i, i + LOT);
      const placeholders = lot.map(() => '?').join(', ');
      out.push(
        ...(this.db
          .prepare(`SELECT ${colonnes} FROM ${table} WHERE ${cle} IN (${placeholders})`)
          .all(...lot) as T[]),
      );
    }
    return out;
  }

  /**
   * Titre et prompt des SEULES tâches demandées. Les phéromones n'ont besoin
   * que des tâches citées par les résultats récents (≤ 500) : un `SELECT *` de
   * toute la table `tasks`, avec un `JSON.parse` par ligne, jetait 99,5 % du
   * travail à 100 000 tâches.
   */
  listTaskTexts(ids: readonly string[]): Array<{ id: string; title: string; prompt: string }> {
    return this.lireParIds<{ id: string; title: string; prompt: string }>('id, title, prompt', ids);
  }

  /**
   * Projet et statut des SEULES tâches demandées — ce que la Balance a besoin
   * de savoir pour imputer les tentatives d'un corpus borné. Lecture par clé
   * primaire (`lireParIds`), jamais un `SELECT *` de `tasks` : c'est exactement
   * le péché de performance que le dépôt a déjà combattu pour `listTaskTexts`.
   */
  listTaskComptes(
    ids: readonly string[],
  ): Array<{ id: string; projectId: string; status: TaskStatus }> {
    return this.lireParIds<{ id: string; projectId: string; status: TaskStatus }>(
      'id, projectId, status',
      ids,
    );
  }

  /** Projet des SEULES tâches citées — le grand livre n'a pas besoin du statut. */
  listTaskProjects(ids: readonly string[]): Array<{ id: string; projectId: string }> {
    return this.lireParIds<{ id: string; projectId: string }>('id, projectId', ids);
  }

  /**
   * Statut des SEULES tâches demandées, indexé par id. Sert la promotion des
   * dépendances : seules les tâches DONT DÉPEND une tâche en attente comptent —
   * pas toute la table.
   */
  taskStatuses(ids: readonly string[]): Map<string, TaskStatus> {
    const rows = this.lireParIds<{ id: string; status: TaskStatus }>('id, status', ids);
    return new Map(rows.map((r) => [r.id, r.status]));
  }

  tasksByStatus(...statuses: TaskStatus[]): Task[] {
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY createdAt, id`)
      .all(...statuses) as TaskRow[];
    return rows.map(rowToTask);
  }

  /** Tâches actives (assigned/running) d'un nœud donné. */
  activeTasksOfNode(nodeId: string): Task[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM tasks WHERE assignedNodeId = ? AND status IN ('assigned', 'running') ORDER BY createdAt, id",
      )
      .all(nodeId) as TaskRow[];
    return rows.map(rowToTask);
  }

  patchTask(id: string, patch: TaskPatch, now = Date.now()): Task | undefined {
    const current = this.getTask(id);
    if (!current) return undefined;
    const next: Task = {
      ...current,
      status: patch.status ?? current.status,
      assignedNodeId:
        patch.assignedNodeId !== undefined ? patch.assignedNodeId : current.assignedNodeId,
      result: patch.result !== undefined ? patch.result : current.result,
      branch: patch.branch !== undefined ? patch.branch : current.branch,
      attempts: patch.attempts ?? current.attempts,
      updatedAt: now,
    };
    this.db
      .prepare(
        'UPDATE tasks SET status = ?, assignedNodeId = ?, result = ?, branch = ?, attempts = ?, updatedAt = ? WHERE id = ?',
      )
      .run(
        next.status,
        next.assignedNodeId,
        next.result ? JSON.stringify(next.result) : null,
        next.branch,
        next.attempts,
        next.updatedAt,
        id,
      );
    return next;
  }

  /**
   * Récupération au démarrage : les tâches assigned/running d'un précédent
   * process sont orphelines → elles repartent en ready ; tous les nœuds
   * repartent offline (ils se ré-enregistreront via WebSocket).
   */
  recoverOrphanTasks(now = Date.now()): Task[] {
    const orphans = this.tasksByStatus('assigned', 'running');
    for (const t of orphans) {
      this.patchTask(t.id, { status: 'ready', assignedNodeId: null }, now);
    }
    this.db.prepare("UPDATE nodes SET status = 'offline'").run();
    return orphans;
  }

  // ─── Résultats ─────────────────────────────────────────────────────────────
  /**
   * Range un résultat et rend son `results.id`. Le retour est ADDITIF (les
   * appelants qui l'ignoraient continuent de compiler) : il sert aux Gardiennes
   * à faire pointer leur verdict sur la production exacte qu'elles ont
   * reniflée, plutôt que sur un couple (taskId, nodeId) qui se répète à chaque
   * tentative.
   */
  insertResult(res: TaskResult, now = Date.now()): number {
    const info = this.db
      .prepare(
        'INSERT INTO results (taskId, nodeId, success, diff, logs, durationMs, subAgents, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        res.taskId,
        res.nodeId,
        res.success ? 1 : 0,
        res.diff.slice(0, LIMITS.diff),
        res.logs.slice(0, LIMITS.log),
        res.durationMs,
        JSON.stringify(res.subAgents.slice(0, LIMITS.subAgents)),
        now,
      );
    return Number(info.lastInsertRowid);
  }

  resultsForTask(taskId: string): TaskResult[] {
    const rows = this.db
      .prepare('SELECT * FROM results WHERE taskId = ? ORDER BY id')
      .all(taskId) as ResultRow[];
    return rows.map((r) => ({
      taskId: r.taskId,
      nodeId: r.nodeId,
      success: r.success === 1,
      diff: r.diff,
      logs: r.logs,
      durationMs: r.durationMs,
      subAgents: JSON.parse(r.subAgents) as SubAgent[],
    }));
  }

  /**
   * Échecs enregistrés pour une tâche, du plus ancien au plus récent, réduits
   * au strict nécessaire de la Couveuse (qui a échoué, quand, avec quels
   * logs). `resultsForTask` existe mais n'expose pas createdAt, dont la
   * Couveuse a besoin pour ordonner les leçons.
   */
  listFailedResultsForTask(
    taskId: string,
  ): Array<{ nodeId: string; logs: string; createdAt: number }> {
    return this.db
      .prepare(
        'SELECT nodeId, logs, createdAt FROM results WHERE taskId = ? AND success = 0 ORDER BY createdAt, id',
      )
      .all(taskId) as Array<{ nodeId: string; logs: string; createdAt: number }>;
  }

  /**
   * Résultats les plus récents, réduits au strict nécessaire du calcul des
   * phéromones (qui a réussi/échoué quoi, quand). Corpus borné pour garder le
   * repli rapide — au-delà, le signal est de toute façon évaporé (demi-vie).
   */
  listResultsForPheromones(
    limit = 500,
  ): Array<{ taskId: string; nodeId: string; success: boolean; createdAt: number }> {
    const rows = this.db
      .prepare(
        'SELECT taskId, nodeId, success, createdAt FROM results ORDER BY createdAt DESC, id DESC LIMIT ?',
      )
      .all(Math.max(1, Math.min(limit, 2000))) as {
      taskId: string;
      nodeId: string;
      success: number;
      createdAt: number;
    }[];
    return rows.map((r) => ({
      taskId: r.taskId,
      nodeId: r.nodeId,
      success: r.success === 1,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Lecture INCRÉMENTALE du grand livre de la Balance : les résultats
   * postérieurs au filigrane, par id croissant, plafonnés. En régime établi,
   * renvoie [] au prix d'une seule sonde sur `idx_results_balance`.
   *
   * `INDEXED BY` n'est PAS une coquetterie : plan mesuré sur 5 000 lignes de
   * 10 ko (SQLite 3.53.2), avec `ANALYZE` joué comme sur une base en service.
   *  - sans lui : « SEARCH results USING INTEGER PRIMARY KEY (rowid>?) » — la
   *    LIGNE est ouverte, et `durationMs` étant stocké après `diff` (≤ 1 Mo) et
   *    `logs` (≤ 512 ko), il faut traverser leurs pages de débordement pour
   *    lire un entier ;
   *  - avec lui : « SEARCH results USING COVERING INDEX idx_results_balance
   *    (id>?) » — pas une seule ligne de la table n'est touchée.
   * La conception d'origine pariait sur un « , taskId » redondant dans
   * l'ORDER BY pour faire basculer le planner : la mesure dit que ça ne suffit
   * plus dès que les statistiques existent. Verrouillé par
   * tests/store-scaling.test.ts — si un futur SQLite change encore d'avis, ce
   * test le dira avant la production.
   */
  listResultsForLedger(afterId: number, limit = LOT_GRAND_LIVRE): ResultatBalance[] {
    const rows = this.db
      .prepare(
        `SELECT id, taskId, nodeId, success, durationMs FROM results INDEXED BY idx_results_balance
         WHERE id > ? ORDER BY id LIMIT ?`,
      )
      .all(Math.max(0, afterId), Math.max(1, Math.min(limit, 10_000))) as ResultatRow[];
    return rows.map(rowToResultatBalance);
  }

  /**
   * Corpus BORNÉ de l'imputation : les N résultats les plus récents (id DESC).
   * Plan : « SCAN results USING COVERING INDEX idx_results_balance » — parcours
   * de l'index dans l'ordre voulu, le LIMIT s'arrête au N-ième.
   */
  listResultsForBalance(limit = CORPUS_BALANCE): ResultatBalance[] {
    const rows = this.db
      .prepare(
        `SELECT id, taskId, nodeId, success, durationMs FROM results INDEXED BY idx_results_balance
         ORDER BY id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 10_000))) as ResultatRow[];
    return rows.map(rowToResultatBalance);
  }

  /** Id du dernier résultat inséré (0 si la table est vide). */
  lastResultId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM results').get() as { id: number | null };
    return row.id ?? 0;
  }

  /**
   * Lit le CACHE du grand livre. `null` — et la table est vidée — dès que le
   * moindre doute existe :
   *  - table vide (premier démarrage, ou cache déjà jeté) ;
   *  - `version` ≠ VERSION_BALANCE : la sémantique de l'imputation a changé ;
   *  - filigranes divergents entre lignes : l'écriture est atomique, donc c'est
   *    une corruption ;
   *  - filigrane au-delà du dernier `results.id` : la base a reculé (restaurée
   *    depuis une sauvegarde partielle) et le cache compte des lignes qui
   *    n'existent plus.
   *
   * Dans tous ces cas, la PROCÉDURE DE RECONSTRUCTION TOTALE est la même et
   * elle est gratuite : repartir du filigrane 0 et relire `results`. C'est ce
   * qui autorise ce cache à exister — il n'a aucun moyen de mentir durablement.
   */
  lireCacheGrandLivre(): {
    filigrane: number;
    soldes: Array<{ projectId: string; depenseMs: number; tentatives: number }>;
  } | null {
    const rows = this.db
      .prepare(
        `SELECT projectId, depenseMs, tentatives, filigrane, version
         FROM balance_ledger_cache ORDER BY projectId`,
      )
      .all() as Array<{
      projectId: string;
      depenseMs: number;
      tentatives: number;
      filigrane: number;
      version: number;
    }>;
    if (rows.length === 0) return null;
    const filigrane = rows[0]?.filigrane ?? 0;
    const douteux =
      rows.some((r) => r.version !== VERSION_BALANCE || r.filigrane !== filigrane) ||
      filigrane > this.lastResultId();
    if (douteux) {
      this.viderCacheGrandLivre();
      return null;
    }
    return {
      filigrane,
      soldes: rows.map((r) => ({
        projectId: r.projectId,
        depenseMs: r.depenseMs,
        tentatives: r.tentatives,
      })),
    };
  }

  /**
   * Réécrit le cache EN ENTIER, dans une seule transaction : soit toutes les
   * lignes portent le même filigrane, soit aucune ne change. Un remplacement
   * total (et non un `UPSERT` ligne à ligne) parce que le cache doit être un
   * instantané cohérent, jamais un mélange de deux passes.
   */
  ecrireCacheGrandLivre(
    filigrane: number,
    soldes: ReadonlyArray<{ projectId: string; depenseMs: number; tentatives: number }>,
  ): void {
    const inserer = this.db.prepare(
      `INSERT INTO balance_ledger_cache (projectId, depenseMs, tentatives, filigrane, version)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM balance_ledger_cache').run();
      for (const s of soldes) {
        inserer.run(
          s.projectId,
          Math.max(0, Math.trunc(s.depenseMs)),
          Math.max(0, Math.trunc(s.tentatives)),
          Math.max(0, Math.trunc(filigrane)),
          VERSION_BALANCE,
        );
      }
    })();
  }

  /** Reconstruction totale : on jette, le rattrapage recomptera depuis `results`. */
  viderCacheGrandLivre(): void {
    this.db.prepare('DELETE FROM balance_ledger_cache').run();
  }

  /**
   * Recalcul À FROID de la dépense par projet (JOIN complet sur results).
   * DIAGNOSTIC ET TESTS UNIQUEMENT : jamais sur le chemin d'un tick, jamais
   * exposé par une route. Sert à prouver l'invariant « incrémental == à froid »
   * du grand livre — le seul usage légitime d'un SELECT non borné ici.
   * `max(durationMs, 0)` : même bornage que le repli en mémoire, sinon les deux
   * chemins divergeraient sur une horloge de nœud en retard.
   */
  depensesParProjet(): Map<string, { depenseMs: number; tentatives: number }> {
    const rows = this.db
      .prepare(
        `SELECT t.projectId AS projectId,
                SUM(max(r.durationMs, 0)) AS depenseMs,
                COUNT(*) AS tentatives
         FROM results r JOIN tasks t ON t.id = r.taskId
         GROUP BY t.projectId`,
      )
      .all() as Array<{ projectId: string; depenseMs: number; tentatives: number }>;
    return new Map(
      rows.map((r) => [r.projectId, { depenseMs: r.depenseMs, tentatives: r.tentatives }]),
    );
  }

  // ─── Budgets : les plafonds posés par des humains (la Balance — borner) ────
  //
  // Aucune de ces trois méthodes n'écrit ni ne lit un CALCUL : elles ne
  // manipulent qu'une intention humaine, un entier et une trace d'opérateur.
  // Le solde, lui, est un cache en mémoire reconstruit depuis `results` — il
  // n'est jamais persisté (doctrine, règle 1).

  /**
   * Pose ou retire le plafond d'un projet. `plafondMs === null` SUPPRIME la
   * ligne : l'absence de ligne est l'état « éteint », pas un drapeau — un
   * projet sans plafond doit être indiscernable, en base comme à l'exécution,
   * d'un projet d'avant la Balance.
   *
   * `definiPar` est une TRACE (qui a serré la vis), jamais une autorisation.
   * Le plafond est borné à 0 : un plafond négatif n'a aucun sens, et la porte
   * doit rester lisible (`0` = « ce projet ne dépense plus rien »).
   */
  // ─── Le Plein Essaim : l'autonomie, posée à la main ────────────────────────
  //
  // Aucune écriture ici ne vient de la ruche : `definiPar` porte QUI a décidé,
  // et ce doit toujours être un humain. Voir la table (store.ts) pour pourquoi
  // elle n'a pas d'élagueur.

  /** Pose (ou retire) le réglage d'autonomie d'un projet. */
  setEssaim(
    projectId: string,
    reglage: { niveau: string; depotInscrit: boolean } | null,
    definiPar: string | null = null,
    now = Date.now(),
  ): void {
    if (reglage === null) {
      this.db.prepare('DELETE FROM essaim WHERE projectId = ?').run(projectId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO essaim (projectId, niveau, depotInscrit, version, definiPar, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(projectId) DO UPDATE SET
           niveau = excluded.niveau,
           depotInscrit = excluded.depotInscrit,
           definiPar = excluded.definiPar,
           updatedAt = excluded.updatedAt`,
      )
      .run(projectId, reglage.niveau, reglage.depotInscrit ? 1 : 0, definiPar, now);
  }

  /** Réglage d'autonomie d'un projet. `null` si aucun — donc `off`. */
  getEssaim(projectId: string): {
    projectId: string;
    niveau: string;
    depotInscrit: boolean;
    definiPar: string | null;
    updatedAt: number;
  } | null {
    const row = this.db
      .prepare(
        'SELECT projectId, niveau, depotInscrit, definiPar, updatedAt FROM essaim WHERE projectId = ?',
      )
      .get(projectId) as
      | {
          projectId: string;
          niveau: string;
          depotInscrit: number;
          definiPar: string | null;
          updatedAt: number;
        }
      | undefined;
    if (!row) return null;
    return { ...row, depotInscrit: row.depotInscrit === 1 };
  }

  /**
   * Échecs récents, tous projets et tous nœuds confondus — la matière des
   * leçons croisées.
   *
   * BORNÉ par `limit` et servi par l'index couvrant existant : c'est un
   * parcours arrière de clé primaire, pas un dépliage de `results`.
   */
  listRecentFailures(limit = 300): Array<{
    nodeId: string;
    taskId: string;
    logs: string;
    createdAt: number;
  }> {
    return this.db
      .prepare(
        `SELECT nodeId, taskId, logs, createdAt FROM results
         WHERE success = 0 ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{ nodeId: string; taskId: string; logs: string; createdAt: number }>;
  }

  setBudget(
    projectId: string,
    plafondMs: number | null,
    definiPar: string | null = null,
    now = Date.now(),
  ): void {
    if (plafondMs === null) {
      this.db.prepare('DELETE FROM budgets WHERE projectId = ?').run(projectId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO budgets (projectId, plafondMs, version, definiPar, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(projectId) DO UPDATE SET
           plafondMs = excluded.plafondMs,
           version   = excluded.version,
           definiPar = excluded.definiPar,
           updatedAt = excluded.updatedAt`,
      )
      .run(projectId, Math.max(0, Math.trunc(plafondMs)), VERSION_BALANCE, definiPar, now);
  }

  /** Plafond d'un projet, ou `null` s'il n'en a pas. Lecture par clé primaire. */
  getBudget(projectId: string): Budget | null {
    const row = this.db
      .prepare(
        'SELECT projectId, plafondMs, version, definiPar, updatedAt FROM budgets WHERE projectId = ?',
      )
      .get(projectId) as Budget | undefined;
    return row ?? null;
  }

  /**
   * Tous les plafonds en vigueur, triés par projet (ordre stable, comme partout
   * dans le dépôt). BORNÉ PAR CONSTRUCTION : `budgets` est 1:1 avec `projects`,
   * donc cette lecture ne peut pas croître avec l'histoire de la ruche — c'est
   * ce qui autorise un `SELECT` sans `LIMIT` ici, et nulle part ailleurs sur le
   * chemin du tick. Le Scheduler la mémoïse en plus, et ne la relit qu'après un
   * geste humain.
   */
  listBudgets(): Budget[] {
    return this.db
      .prepare(
        'SELECT projectId, plafondMs, version, definiPar, updatedAt FROM budgets ORDER BY projectId',
      )
      .all() as Budget[];
  }

  /** Nombre de résultats stockés. */
  countResults(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM results').get() as { n: number };
    return row.n;
  }

  /**
   * Élagage des résultats, symétrique de `pruneEvents` / `pruneMemories` — mais
   * qui ALLÈGE au lieu de supprimer : au-delà des `maxKeep` résultats les plus
   * récents, seules les colonnes lourdes (`diff` ≤ 1 Mo, `logs` ≤ 512 ko) sont
   * vidées ; la ligne survit.
   *
   * Pourquoi ne pas supprimer la ligne : `results` est la seule trace durable de
   * QUI a fait QUOI. La Miellerie (revue humaine) et le Parlement lisent
   * `resultsForTask`, les phéromones agrègent (taskId, nodeId, success,
   * createdAt) — supprimer les lignes effacerait l'affinité apprise et
   * l'historique de revue d'une tâche ancienne mais encore ouverte. Or 99,9 %
   * du volume vit dans `diff` et `logs` : une ligne allégée pèse ~100 octets.
   *
   * Rétention retenue : RESULT_RETENTION = 5 000, alignée sur EVENT_RETENTION —
   * les deux décrivent la même histoire récente, et 5 000 résultats couvrent
   * dix fois le corpus des phéromones (500) comme l'arriéré de revue plausible.
   *
   * Coût borné : un filigrane en mémoire (`dernierResultatAllege`) fait que
   * chaque passe ne traite que les résultats FRAÎCHEMENT sortis de la fenêtre —
   * en régime établi, zéro ligne réécrite, une seule sonde sur l'index de clé
   * primaire (~0,6 ms). Et la passe est plafonnée à LOT_ALLEGEMENT lignes : un
   * arriéré hérité (une base de plusieurs Go ouverte pour la première fois par
   * cette version) est rattrapé en quelques ticks au lieu de figer le premier.
   * Retourne le nombre de résultats allégés.
   */
  pruneResults(maxKeep: number): number {
    const keep = Math.max(0, maxKeep);
    // Id du PLUS RÉCENT résultat à ALLÉGER : le parcours arrière du rowid saute
    // les `keep` résultats conservés intacts et rend le suivant — qui est donc
    // le premier hors fenêtre, et il est bien vidé (`id <= borne` ci-dessous).
    const seuil = this.db
      .prepare('SELECT id FROM results ORDER BY id DESC LIMIT 1 OFFSET ?')
      .get(keep) as { id: number } | undefined;
    if (!seuil || seuil.id <= this.dernierResultatAllege) return 0;
    const borne = Math.min(seuil.id, this.dernierResultatAllege + LOT_ALLEGEMENT);
    const info = this.db
      .prepare("UPDATE results SET diff = '', logs = '' WHERE id > ? AND id <= ?")
      .run(this.dernierResultatAllege, borne);
    this.dernierResultatAllege = borne;
    return info.changes;
  }

  // ─── Les Gardiennes : le contrôle d'entrée du nectar ───────────────────────
  //
  // Aucune de ces méthodes ne CALCULE quoi que ce soit : le verdict est produit
  // par le module pur `gardiennes.ts` au moment de la réception du résultat, et
  // seulement rangé ici. Ce qui est écrit n'est pas une vue dérivée mais un
  // FAIT DATÉ, irrécupérable après l'élagage de `results` — voir le commentaire
  // de la table, dans le SCHEMA.

  /**
   * Range le verdict d'une production, tel qu'il a été rendu à la RÉCEPTION.
   * Jamais appelée en mode `off` : dans ce mode, rien n'est ni lu ni écrit, et
   * la ruche est indiscernable de celle d'avant les Gardiennes.
   */
  enregistrerInspection(
    entree: Omit<LigneGardienne, 'id' | 'createdAt'>,
    now = Date.now(),
  ): number {
    const info = this.db
      .prepare(
        `INSERT INTO gardiennes (resultId, taskId, nodeId, verdict, score, applique, griefs, version, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Math.max(0, Math.trunc(entree.resultId)),
        entree.taskId,
        entree.nodeId,
        entree.verdict,
        Math.max(0, Math.trunc(entree.score)),
        entree.applique ? 1 : 0,
        JSON.stringify(entree.griefs),
        VERSION_GARDIENNES,
        now,
      );
    return Number(info.lastInsertRowid);
  }

  /**
   * Les N inspections les plus récentes (id décroissant), corpus BORNÉ — c'est
   * la seule lecture de cette table, et elle sert une vue d'affichage, jamais
   * une décision. Plan : parcours ARRIÈRE de la clé primaire, arrêté par le
   * LIMIT ; aucun tri temporaire (verrouillé par tests/store-scaling.test.ts).
   *
   * Un `griefs` illisible (ligne écrite par une version future, base bricolée à
   * la main) rend une liste VIDE plutôt qu'une exception : une page de lecture
   * ne doit pas tomber parce qu'une ligne sur mille est étrange.
   */
  listInspections(limit = CORPUS_GARDIENNES): LigneGardienne[] {
    const rows = this.db
      .prepare(
        `SELECT id, resultId, taskId, nodeId, verdict, score, applique, griefs, createdAt
         FROM gardiennes ORDER BY id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 2_000))) as Array<{
      id: number;
      resultId: number;
      taskId: string;
      nodeId: string;
      verdict: Verdict;
      score: number;
      applique: number;
      griefs: string;
      createdAt: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      resultId: r.resultId,
      taskId: r.taskId,
      nodeId: r.nodeId,
      verdict: r.verdict,
      score: r.score,
      applique: r.applique === 1,
      griefs: lireGriefs(r.griefs),
      createdAt: r.createdAt,
    }));
  }

  /** Nombre d'inspections rangées. */
  countInspections(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM gardiennes').get() as { n: number };
    return row.n;
  }

  /**
   * Ne conserve que les `maxKeep` inspections les plus récentes (par id) —
   * BORNE D'ÉLAGAGE de la table, livrée dans le même commit qu'elle (doctrine,
   * règle 3). Motif `pruneEvents` à la lettre, et pour la même raison : cette
   * table croît avec l'histoire de la ruche.
   *
   * Elle SUPPRIME au lieu d'alléger, contrairement à `pruneResults` : une ligne
   * de garde privée de ses griefs ne dit plus rien du tout (un verdict sans son
   * motif n'est pas une trace, c'est une accusation), et elle ne sert aucune
   * autre lecture — ni la Miellerie, ni le Parlement, ni les phéromones.
   */
  pruneGardiennes(maxKeep: number): number {
    const dernier = this.db.prepare('SELECT MAX(id) AS id FROM gardiennes').get() as {
      id: number | null;
    };
    const cutoff = (dernier.id ?? 0) - Math.max(0, maxKeep);
    if (cutoff <= 0) return 0;
    return this.db.prepare('DELETE FROM gardiennes WHERE id <= ?').run(cutoff).changes;
  }

  // ─── Le trou de vol : billets et clés de nœud ──────────────────────────────
  //
  // Toutes les lectures se font PAR CLÉ PRIMAIRE. C'est structurel, pas une
  // optimisation : vérifier un secret en parcourant la table obligerait à
  // calculer un PBKDF2 par ligne, offrant à un inconnu un déni de service à
  // coût nul. Le billet porte donc son `id` en clair — l'id sert à TROUVER, le
  // secret à PROUVER.

  creerBillet(billet: {
    id: string;
    secretHash: string;
    label?: string | null;
    createdBy?: string | null;
    expiresAt: number;
    uses: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO invite_tickets (id, secretHash, label, createdBy, createdAt, expiresAt, usesLeft, usesTotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        billet.id,
        billet.secretHash,
        billet.label ?? null,
        billet.createdBy ?? null,
        billet.now ?? Date.now(),
        billet.expiresAt,
        billet.uses,
        billet.uses,
      );
  }

  getBillet(id: string): BilletRange | null {
    const row = this.db.prepare('SELECT * FROM invite_tickets WHERE id = ?').get(id) as
      BilletRange | undefined;
    return row ?? null;
  }

  /**
   * Consomme UN usage, de façon atomique et conditionnelle. Le `WHERE
   * usesLeft > 0` fait tout le travail : deux nœuds qui échangent le même
   * billet à usage unique au même instant ne peuvent pas réussir tous les deux,
   * quel que soit l'entrelacement. Un `SELECT` suivi d'un `UPDATE` aurait
   * laissé cette course ouverte.
   */
  consommerBillet(id: string, now = Date.now()): boolean {
    return (
      this.db
        .prepare(
          `UPDATE invite_tickets SET usesLeft = usesLeft - 1, lastUsedAt = ?
           WHERE id = ? AND usesLeft > 0 AND revokedAt IS NULL AND expiresAt > ?`,
        )
        .run(now, id, now).changes === 1
    );
  }

  revoquerBillet(id: string, now = Date.now()): boolean {
    return (
      this.db
        .prepare('UPDATE invite_tickets SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL')
        .run(now, id).changes === 1
    );
  }

  listBillets(limit = 100): BilletRange[] {
    return this.db
      .prepare('SELECT * FROM invite_tickets ORDER BY createdAt DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 500))) as BilletRange[];
  }

  /**
   * Range la clé d'un nœud. `INSERT OR REPLACE` : rejoindre à nouveau fait une
   * ROTATION de clé plutôt qu'une accumulation — et remet `revokedAt` à NULL,
   * ce qui est voulu : présenter un billet valide est précisément le geste par
   * lequel un membre exclu peut être réadmis, si l'hôte lui redonne un billet.
   */
  poserCleNoeud(cle: {
    nodeId: string;
    keyHash: string;
    label?: string | null;
    ticketId?: string | null;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO node_keys (nodeId, keyHash, label, ticketId, createdAt, lastSeenAt, revokedAt)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(cle.nodeId, cle.keyHash, cle.label ?? null, cle.ticketId ?? null, cle.now ?? Date.now());
  }

  getCleNoeud(nodeId: string): CleNoeudRangee | null {
    const row = this.db.prepare('SELECT * FROM node_keys WHERE nodeId = ?').get(nodeId) as
      CleNoeudRangee | undefined;
    return row ?? null;
  }

  toucherCleNoeud(nodeId: string, now = Date.now()): void {
    this.db.prepare('UPDATE node_keys SET lastSeenAt = ? WHERE nodeId = ?').run(now, nodeId);
  }

  revoquerCleNoeud(nodeId: string, now = Date.now()): boolean {
    return (
      this.db
        .prepare('UPDATE node_keys SET revokedAt = ? WHERE nodeId = ? AND revokedAt IS NULL')
        .run(now, nodeId).changes === 1
    );
  }

  listClesNoeuds(limit = 200): CleNoeudRangee[] {
    return this.db
      .prepare('SELECT * FROM node_keys ORDER BY createdAt DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 500))) as CleNoeudRangee[];
  }

  /**
   * Élague les billets MORTS (révoqués, expirés ou épuisés) plus vieux que la
   * période de grâce. Les billets vivants ne sont jamais touchés : un billet
   * encore valide qui disparaîtrait rendrait une invitation en circulation
   * silencieusement inutilisable — le pire mode d'échec pour une fonctionnalité
   * dont tout l'intérêt est qu'on puisse compter dessus.
   *
   * La grâce existe pour que « ce billet a été révoqué » reste une réponse
   * possible quelque temps, plutôt que « billet inconnu » — qui laisserait
   * croire à une faute de frappe.
   */
  pruneAcces(graceMs: number, now = Date.now()): number {
    const seuil = now - Math.max(0, graceMs);
    return this.db
      .prepare(
        `DELETE FROM invite_tickets
         WHERE createdAt < ?
           AND (revokedAt IS NOT NULL OR expiresAt <= ? OR usesLeft <= 0)`,
      )
      .run(seuil, now).changes;
  }

  // ─── Le Conseil des Éclaireuses ────────────────────────────────────────────

  creerSession(s: {
    id: string;
    question: string;
    projectId?: string | null;
    version: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO conseil_sessions (id, question, projectId, etat, tour, toursSecs, version, createdAt)
         VALUES (?, ?, ?, 'exploration', 1, 0, ?, ?)`,
      )
      .run(s.id, s.question, s.projectId ?? null, s.version, s.now ?? Date.now());
  }

  getSession(id: string): SessionRangee | null {
    return (
      (this.db.prepare('SELECT * FROM conseil_sessions WHERE id = ?').get(id) as
        SessionRangee | undefined) ?? null
    );
  }

  /** Sessions encore vivantes. Bornée : le chemin du tick la relit à chaque passe. */
  sessionsOuvertes(limit = 20): SessionRangee[] {
    return this.db
      .prepare("SELECT * FROM conseil_sessions WHERE etat != 'clos' ORDER BY createdAt LIMIT ?")
      .all(Math.max(1, Math.min(limit, 100))) as SessionRangee[];
  }

  listSessions(limit = 50): SessionRangee[] {
    return this.db
      .prepare('SELECT * FROM conseil_sessions ORDER BY createdAt DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 200))) as SessionRangee[];
  }

  majSession(
    id: string,
    champs: {
      etat?: string;
      tour?: number;
      toursSecs?: number;
      issue?: string | null;
      motif?: string | null;
      closedAt?: number | null;
    },
  ): void {
    const set: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(champs)) {
      if (v === undefined) continue;
      set.push(`${k} = ?`);
      vals.push(v);
    }
    if (set.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE conseil_sessions SET ${set.join(', ')} WHERE id = ?`).run(...vals);
  }

  lierTache(t: {
    taskId: string;
    sessionId: string;
    role: 'exploration' | 'verification';
    lentille?: string | null;
    propositionId?: string | null;
    tour: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO conseil_taches (taskId, sessionId, role, lentille, propositionId, tour, depouille)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(t.taskId, t.sessionId, t.role, t.lentille ?? null, t.propositionId ?? null, t.tour);
  }

  /** Tâches d'une session encore à dépouiller. Index dédié : jamais un SCAN. */
  tachesADepouiller(sessionId: string): TacheConseil[] {
    return this.db
      .prepare('SELECT * FROM conseil_taches WHERE sessionId = ? AND depouille = 0')
      .all(sessionId) as TacheConseil[];
  }

  marquerDepouillee(taskId: string): void {
    this.db.prepare('UPDATE conseil_taches SET depouille = 1 WHERE taskId = ?').run(taskId);
  }

  ajouterProposition(p: {
    id: string;
    sessionId: string;
    eclaireuse: string;
    famille: string;
    titre: string;
    corps: string;
    qualite: number;
    sources: string[];
    tour: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO conseil_propositions (id, sessionId, eclaireuse, famille, titre, corps, qualite, sources, tour, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.sessionId,
        p.eclaireuse,
        p.famille,
        p.titre,
        p.corps,
        p.qualite,
        JSON.stringify(p.sources),
        p.tour,
        p.now ?? Date.now(),
      );
  }

  listPropositions(sessionId: string): PropositionRangee[] {
    return this.db
      .prepare('SELECT * FROM conseil_propositions WHERE sessionId = ? ORDER BY tour, id')
      .all(sessionId) as PropositionRangee[];
  }

  ajouterAvis(a: {
    sessionId: string;
    propositionId: string;
    eclaireuse: string;
    famille: string;
    type: string;
    force: number;
    raison: string;
    tour: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO conseil_avis (sessionId, propositionId, eclaireuse, famille, type, force, raison, tour, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.sessionId,
        a.propositionId,
        a.eclaireuse,
        a.famille,
        a.type,
        a.force,
        a.raison,
        a.tour,
        a.now ?? Date.now(),
      );
  }

  listAvis(sessionId: string): AvisRange[] {
    return this.db
      .prepare('SELECT * FROM conseil_avis WHERE sessionId = ? ORDER BY tour, id')
      .all(sessionId) as AvisRange[];
  }

  /**
   * Élague les vieilles sessions CLOSES au-delà d'un quota, avec leurs enfants.
   *
   * Une session EN COURS n'est jamais touchée : la faire disparaître laisserait
   * des tâches d'éclaireuses orphelines qui tourneraient — et coûteraient du
   * temps-ouvrière — pour un conseil qui n'existe plus.
   */
  pruneConseils(maxSessions: number): number {
    const garder = Math.max(0, maxSessions);
    const aJeter = this.db
      .prepare(
        `SELECT id FROM conseil_sessions WHERE etat = 'clos'
         ORDER BY createdAt DESC LIMIT -1 OFFSET ?`,
      )
      .all(garder) as { id: string }[];
    if (aJeter.length === 0) return 0;
    const jeter = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.db.prepare('DELETE FROM conseil_avis WHERE sessionId = ?').run(id);
        this.db.prepare('DELETE FROM conseil_propositions WHERE sessionId = ?').run(id);
        this.db.prepare('DELETE FROM conseil_taches WHERE sessionId = ?').run(id);
        this.db.prepare('DELETE FROM conseil_sessions WHERE id = ?').run(id);
      }
    });
    jeter(aJeter.map((r) => r.id));
    return aJeter.length;
  }

  // ─── Journal d'événements ──────────────────────────────────────────────────
  appendEvent(type: string, payload: Record<string, unknown>, ts = Date.now()): HiveEvent {
    const info = this.db
      .prepare('INSERT INTO events (ts, type, payload) VALUES (?, ?, ?)')
      .run(ts, type, JSON.stringify(payload));
    return { id: Number(info.lastInsertRowid), ts, type, payload };
  }

  /** Dernier id d'événement journalisé (0 si journal vide). */
  lastEventId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM events').get() as {
      id: number | null;
    };
    return row.id ?? 0;
  }

  /** Nombre d'événements dans le journal. */
  countEvents(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    return row.n;
  }

  /**
   * Ne conserve que les `maxKeep` événements les plus récents (par id). Borne la
   * croissance du journal sur un orchestrateur qui tourne longtemps. Retourne le
   * nombre d'événements supprimés. Appelé périodiquement par le serveur.
   */
  pruneEvents(maxKeep: number): number {
    const cutoff = this.lastEventId() - Math.max(0, maxKeep);
    if (cutoff <= 0) return 0;
    const info = this.db.prepare('DELETE FROM events WHERE id <= ?').run(cutoff);
    return info.changes;
  }

  /**
   * Dernier événement d'un type donné dont le payload mentionne `taskId`.
   * Sert à retrouver l'issue d'une course tranchée (drone_won) : la course
   * elle-même ne vit qu'en mémoire du scheduler et disparaît à la victoire —
   * le journal est la seule trace durable (dans la limite de l'élagage).
   */
  lastEventFor(type: string, taskId: string): HiveEvent | null {
    // json_extract (JSON1, embarqué dans better-sqlite3) : correspondance
    // EXACTE du taskId — un LIKE laisserait les jokers %/_ d'un id fourni par
    // le client (ou par le LLM Queen Bee) matcher la victoire d'une AUTRE
    // tâche (`build_api` matcherait `build-api`).
    const row = this.db
      .prepare(
        "SELECT * FROM events WHERE type = ? AND json_extract(payload, '$.taskId') = ? ORDER BY id DESC LIMIT 1",
      )
      .get(type, taskId) as EventRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      ts: row.ts,
      type: row.type,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    };
  }

  /**
   * Événements d'une FENÊTRE TEMPORELLE, restreints à quelques types. Sert la
   * thermorégulation : borner la lecture à un lot des N derniers événements
   * rendait la fenêtre de 10 minutes fictive dès que la ruche était active (un
   * flot de `task_progress` évinçait les issues). Servi par l'index
   * `idx_events_ts` — pas de tri temporaire, pas de scan complet.
   */
  listEventsInWindow(
    since: number,
    types: readonly string[],
  ): Array<{ type: string; ts: number; payload: Record<string, unknown> }> {
    if (types.length === 0) return [];
    const placeholders = types.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT ts, type, payload FROM events WHERE ts >= ? AND type IN (${placeholders}) ORDER BY ts`,
      )
      .all(since, ...types) as Array<{ ts: number; type: string; payload: string }>;
    return rows.map((r) => ({
      type: r.type,
      ts: r.ts,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }));
  }

  listEvents(sinceId = 0, limit = 200): HiveEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?')
      .all(sinceId, Math.max(1, Math.min(limit, 1000))) as EventRow[];
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      type: r.type,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }));
  }

  // ─── Hive Mind (mémoire partagée) ──────────────────────────────────────────
  /** Enregistre (ou remplace) le souvenir d'une tâche. Un souvenir par tâche. */
  recordMemory(
    m: { projectId: string; taskId: string; title: string; content: string },
    now = Date.now(),
  ): Memory {
    const content = m.content.slice(0, LIMITS.prompt);
    // La dernière réussite fait foi : on remplace tout souvenir antérieur.
    this.db.prepare('DELETE FROM memories WHERE taskId = ?').run(m.taskId);
    const info = this.db
      .prepare(
        'INSERT INTO memories (projectId, taskId, title, content, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(m.projectId, m.taskId, m.title.slice(0, LIMITS.title), content, now);
    return {
      id: Number(info.lastInsertRowid),
      projectId: m.projectId,
      taskId: m.taskId,
      title: m.title.slice(0, LIMITS.title),
      content,
      createdAt: now,
    };
  }

  /** Souvenirs les plus récents (corpus borné pour garder le scoring rapide). */
  listMemories(limit = 500): Memory[] {
    return this.db
      .prepare('SELECT * FROM memories ORDER BY createdAt DESC, id DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 2000))) as MemoryRow[];
  }

  countMemories(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
    return row.n;
  }

  /** Récupère les souvenirs pertinents pour une requête (BM25 sur le corpus récent). */
  searchMemories(query: string, limit = 3): ScoredMemory[] {
    return rankMemories(query, this.listMemories(500), limit);
  }

  /** Ne conserve que les `maxKeep` souvenirs les plus récents. Retourne le nombre supprimé. */
  pruneMemories(maxKeep: number): number {
    const keep = Math.max(0, maxKeep);
    const info = this.db
      .prepare(
        'DELETE FROM memories WHERE id NOT IN (SELECT id FROM memories ORDER BY createdAt DESC, id DESC LIMIT ?)',
      )
      .run(keep);
    return info.changes;
  }

  // ─── Revues humaines (Miellerie) ───────────────────────────────────────────
  /**
   * Enregistre le verdict de revue humaine d'une tâche ; `null` efface la
   * revue. Le verdict est partagé entre tous les opérateurs du dashboard.
   */
  setTaskReview(taskId: string, state: 'approved' | 'rejected' | null): void {
    if (state === null) {
      this.db.prepare('DELETE FROM reviews WHERE taskId = ?').run(taskId);
      return;
    }
    // updatedAt STRICTEMENT croissant par ligne : deux écritures dans la même
    // milliseconde doivent produire des horodatages distincts, sinon le
    // compare-and-set (expectedUpdatedAt) laisserait passer un écrasement ABA.
    const prev = this.getTaskReview(taskId)?.updatedAt ?? 0;
    this.db
      .prepare(
        `INSERT INTO reviews (taskId, state, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(taskId) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`,
      )
      .run(taskId, state, Math.max(Date.now(), prev + 1));
  }

  /**
   * Verdicts des SEULES tâches citées. C'était la dernière lecture NON BORNÉE
   * du socle de la Balance : `listReviews()` dépliait toute la table `reviews`
   * (jamais élaguée, elle) pour n'en garder que les ≤ 2 000 clés du corpus —
   * 159,8 ms mesurées à 100 000 revues, contre 6,0 ms en lecture ciblée. Sur un
   * socle re-lu toutes les 3 s parce que le dashboard interroge `/api/balance`,
   * cela faisait ~160 ms de boucle d'événements BLOQUÉE toutes les 3 secondes,
   * en permanence : chaque blocage retardait le tick du Scheduler et tout le
   * trafic WebSocket.
   *
   * Même découpage en lots de 900 que `lireParIds` sur `tasks`, sur la clé
   * primaire `reviews.taskId`.
   */
  listReviewsFor(ids: readonly string[]): Record<string, 'approved' | 'rejected'> {
    const rows = this.lireParIds<{ taskId: string; state: 'approved' | 'rejected' }>(
      'taskId, state',
      ids,
      'reviews',
      'taskId',
    );
    return Object.fromEntries(rows.map((r) => [r.taskId, r.state]));
  }

  /**
   * Toutes les revues, sous forme de dictionnaire taskId → verdict.
   *
   * NON BORNÉE, et assumée comme telle : elle sert les vues de REVUE (la
   * Miellerie), dont l'objet est justement de montrer tous les verdicts. Elle
   * n'a rien à faire sur un chemin de polling ni dans un tick — pour n'en
   * connaître qu'un sous-ensemble, `listReviewsFor`.
   */
  listReviews(): Record<string, 'approved' | 'rejected'> {
    const rows = this.db.prepare('SELECT taskId, state FROM reviews').all() as {
      taskId: string;
      state: 'approved' | 'rejected';
    }[];
    return Object.fromEntries(rows.map((r) => [r.taskId, r.state]));
  }

  /** Horodatage de chaque verdict (compare-and-set multi-opérateurs). */
  listReviewTimestamps(): Record<string, number> {
    const rows = this.db.prepare('SELECT taskId, updatedAt FROM reviews').all() as {
      taskId: string;
      updatedAt: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.taskId, r.updatedAt]));
  }

  /** Verdict + horodatage d'une tâche (null si aucune revue). */
  getTaskReview(taskId: string): { state: 'approved' | 'rejected'; updatedAt: number } | null {
    const row = this.db
      .prepare('SELECT state, updatedAt FROM reviews WHERE taskId = ?')
      .get(taskId) as { state: 'approved' | 'rejected'; updatedAt: number } | undefined;
    return row ?? null;
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────────
  getSnapshot(): StateSnapshot {
    return { projects: this.listProjects(), nodes: this.listNodes(), tasks: this.listTasks() };
  }
}
