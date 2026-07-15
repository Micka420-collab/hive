// Persistance SQLite (better-sqlite3) — l'état de la ruche survit aux
// redémarrages de l'orchestrateur. Tout le SQL vit dans cette classe.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LIMITS } from '../shared/protocol.js';
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

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);

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
  insertResult(res: TaskResult, now = Date.now()): void {
    this.db
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
    const row = this.db
      .prepare('SELECT * FROM events WHERE type = ? AND payload LIKE ? ORDER BY id DESC LIMIT 1')
      .get(type, `%"taskId":"${taskId}"%`) as EventRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      ts: row.ts,
      type: row.type,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    };
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

  /** Toutes les revues, sous forme de dictionnaire taskId → verdict. */
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
