// Hive Mind — mémoire RAG partagée entre les agents de la ruche.
// Chaque tâche terminée nourrit une base de connaissances consultable
// par les autres agents avant de démarrer une nouvelle tâche.
//
// Palier 1 : FTS5 (full-text search SQLite), pas d'embeddings.
// Palier 2+ : vector embeddings + reranking.

import Database from 'better-sqlite3';
import type { Task } from '../shared/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemoryKind = 'pattern' | 'lesson' | 'snippet' | 'note';

export interface MemoryEntry {
  id: number;
  projectId: string;
  taskId: string | null;
  kind: MemoryKind;
  title: string;
  content: string;
  /** Mots-clés pour la recherche (séparés par des espaces). */
  keywords: string;
  createdAt: number;
}

export interface MemorySearchResult extends MemoryEntry {
  /** Score de pertinence FTS5 (négatif → plus pertinent). */
  rank: number;
}

export interface MemoryIngestInput {
  projectId: string;
  taskId: string | null;
  taskTitle: string;
  kind: MemoryKind;
  title: string;
  content: string;
  keywords?: string;
}

// ─── Schéma FTS5 ──────────────────────────────────────────────────────────────

const MEMORY_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS hive_memory USING fts5(
  projectId UNINDEXED,
  taskId UNINDEXED,
  kind UNINDEXED,
  title,
  content,
  keywords,
  createdAt UNINDEXED,
  tokenize='porter unicode61'
);
`;

// ─── Extraction automatique ───────────────────────────────────────────────────

/**
 * Extrait des apprentissages depuis le diff et les logs d'une tâche terminée.
 * Heuristique simple (Palier 1) — les patterns sont détectés par regex.
 */
export function extractLearnings(
  task: Task,
  diff: string,
  logs: string,
): MemoryIngestInput[] {
  const entries: MemoryIngestInput[] = [];
  const combined = `${diff}\n${logs}`;

  // Pattern : lignes d'erreur
  const errorMatches = combined.match(/^(Error|Traceback|TypeError|ReferenceError|FAIL).*$/gm);
  if (errorMatches && errorMatches.length > 0) {
    entries.push({
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      kind: 'lesson',
      title: `Erreurs rencontrées dans « ${task.title} »`,
      content: errorMatches.slice(0, 10).join('\n'),
      keywords: `erreur ${task.title} echec bug`,
    });
  }

  // Pattern : lignes de succès / solutions
  const successMatches = combined.match(/^(✓|PASS|OK|Succès|installé|compilé|build).*$/gim);
  if (successMatches && successMatches.length > 0) {
    entries.push({
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      kind: 'pattern',
      title: `Solutions validées dans « ${task.title} »`,
      content: successMatches.slice(0, 10).join('\n'),
      keywords: `solution succes ${task.title} pattern`,
    });
  }

  // Snippet : extraits de code du diff (lignes commençant par +)
  const codeMatches = diff.match(/^\+[^+].{20,}$/gm);
  if (codeMatches && codeMatches.length > 0) {
    entries.push({
      projectId: task.projectId,
      taskId: task.id,
      taskTitle: task.title,
      kind: 'snippet',
      title: `Code produit par « ${task.title} »`,
      content: codeMatches.slice(0, 20).join('\n'),
      keywords: `code ${task.title} implementation`,
    });
  }

  return entries;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export class HiveMind {
  constructor(private readonly db: Database.Database) {
    this.db.exec(MEMORY_SCHEMA);
  }

  /** Ajoute manuellement une entrée. */
  insert(entry: MemoryIngestInput, now = Date.now()): number {
    const info = this.db
      .prepare(
        `INSERT INTO hive_memory (projectId, taskId, kind, title, content, keywords, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.projectId,
        entry.taskId,
        entry.kind,
        entry.title,
        entry.content,
        entry.keywords ?? '',
        now,
      );
    return Number(info.lastInsertRowid);
  }

  /** Ingère les apprentissages extraits d'une tâche terminée. */
  ingestFromTask(task: Task, diff: string, logs: string): number {
    const entries = extractLearnings(task, diff, logs);
    let count = 0;
    for (const entry of entries) {
      this.insert(entry);
      count++;
    }
    return count;
  }

  /**
   * Recherche full-text dans la mémoire.
   * Retourne les entrées les plus pertinentes (max 10).
   */
  search(query: string, projectId?: string, limit = 10): MemorySearchResult[] {
    // Nettoyer la query pour FTS5 — on construit une requête OR
    const words = query
      .replace(/[^\w\s\-À-ÿ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    if (words.length === 0) return [];

    const safeQuery = words.join(' OR ');

    const projectFilter = projectId ? `AND projectId = ?` : '';
    const params: (string | number)[] = [safeQuery, limit];
    if (projectId) params.splice(1, 0, projectId);

    const rows = this.db
      .prepare(
        `SELECT *, rank FROM hive_memory
         WHERE hive_memory MATCH ? ${projectFilter}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params) as MemorySearchResult[];

    return rows;
  }

  /**
   * Cherche des apprentissages pertinents pour une tâche donnée.
   * Combine le titre et le prompt pour la recherche.
   */
  relevantForTask(task: Pick<Task, 'title' | 'prompt' | 'projectId'>, limit = 5): MemorySearchResult[] {
    const query = `${task.title} ${task.prompt.slice(0, 200)}`;
    return this.search(query, task.projectId, limit);
  }

  /**
   * Génère un texte de contexte à injecter avant le prompt de la tâche.
   * Format markdown pour les LLMs.
   */
  buildContext(
    task: Pick<Task, 'title' | 'prompt' | 'projectId'>,
    limit = 5,
  ): string | null {
    const memories = this.relevantForTask(task, limit);
    if (memories.length === 0) return null;

    const lines: string[] = [
      '## 🧠 Hive Mind — apprentissages antérieurs',
      '',
      "Voici ce que d'autres agents ont appris en travaillant sur ce projet :",
      '',
    ];

    for (const m of memories) {
      const emoji = m.kind === 'pattern' ? '✅' : m.kind === 'lesson' ? '⚠️' : '📋';
      lines.push(`### ${emoji} ${m.title}`);
      lines.push('');
      lines.push(`> ${m.content.slice(0, 500)}`);
      lines.push('');
    }

    lines.push('*Utilise ces apprentissages pour éviter de répéter les mêmes erreurs.*');
    return lines.join('\n');
  }

  /** Compte le nombre d'entrées pour un projet. */
  count(projectId?: string): number {
    if (projectId) {
      const row = this.db
        .prepare('SELECT COUNT(*) AS n FROM hive_memory WHERE projectId = ?')
        .get(projectId) as { n: number };
      return row.n;
    }
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM hive_memory').get() as { n: number };
    return row.n;
  }

  /** Supprime toutes les entrées d'un projet. */
  clearProject(projectId: string): number {
    const info = this.db
      .prepare('DELETE FROM hive_memory WHERE projectId = ?')
      .run(projectId);
    return info.changes;
  }

  /** Liste les entrées récentes (pour le dashboard). */
  listRecent(projectId: string, limit = 20): MemoryEntry[] {
    return this.db
      .prepare(
        'SELECT * FROM hive_memory WHERE projectId = ? ORDER BY createdAt DESC LIMIT ?',
      )
      .all(projectId, limit) as MemoryEntry[];
  }
}