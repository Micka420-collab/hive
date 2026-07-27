// Tests de tenue à l'échelle du store : plans de requête (EXPLAIN QUERY PLAN),
// lectures ciblées et élagage des résultats. Ce sont des tests STRUCTURELS —
// ils vérifient le plan choisi par SQLite et le travail réellement demandé,
// pas des durées : déterministes aujourd'hui comme dans dix ans.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import { TYPES_THERMO } from '../src/orchestrator/thermo.js';

/** Détail du plan d'exécution, une ligne par étape. */
function plan(db: Database.Database, sql: string, ...params: unknown[]): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map((r) => r.detail).join(' | ');
}

describe('index et plans de requête', () => {
  let dir: string;
  let dbPath: string;
  let store: HiveStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-scaling-'));
    dbPath = path.join(dir, 'hive.db');
    store = new HiveStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('le corpus des phéromones est servi par un index COUVRANT, sans tri temporaire', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const detail = plan(
        db,
        'SELECT taskId, nodeId, success, createdAt FROM results ORDER BY createdAt DESC, id DESC LIMIT ?',
        500,
      );
      // Avant l'index : « SCAN results | USE TEMP B-TREE FOR ORDER BY » — toute
      // la table lue et triée, pages de débordement diff/logs comprises.
      // Après : « SCAN results USING COVERING INDEX idx_results_recent » —
      // parcours de l'index DANS l'ordre voulu (le LIMIT s'arrête au 500e) et
      // COVERING : pas une seule ligne de la table n'est ouverte.
      expect(detail).toContain('COVERING INDEX idx_results_recent');
      expect(detail).not.toContain('TEMP B-TREE');
    } finally {
      db.close();
    }
  });

  it('la fenêtre thermique est servie par idx_events_ts (pas de scan du journal)', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const placeholders = TYPES_THERMO.map(() => '?').join(', ');
      const detail = plan(
        db,
        `SELECT ts, type, payload FROM events WHERE ts >= ? AND type IN (${placeholders}) ORDER BY ts`,
        Date.now(),
        ...TYPES_THERMO,
      );
      expect(detail).toContain('idx_events_ts');
      expect(detail).not.toContain('SCAN events');
    } finally {
      db.close();
    }
  });

  it('les index sont appliqués aux bases EXISTANTES (CREATE INDEX IF NOT EXISTS au boot)', () => {
    // Base d'une version ANTÉRIEURE : tables présentes, index récents absents.
    const ancienDir = mkdtempSync(path.join(os.tmpdir(), 'hive-ancienne-'));
    const anciennePath = path.join(ancienDir, 'hive.db');
    const ancienne = new Database(anciennePath);
    ancienne.exec(`
      CREATE TABLE results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, nodeId TEXT NOT NULL,
        success INTEGER NOT NULL, diff TEXT NOT NULL DEFAULT '', logs TEXT NOT NULL DEFAULT '',
        durationMs INTEGER NOT NULL DEFAULT 0, subAgents TEXT NOT NULL DEFAULT '[]',
        createdAt INTEGER NOT NULL);
      CREATE INDEX idx_results_task ON results(taskId);
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}');
      INSERT INTO results (taskId, nodeId, success, createdAt) VALUES ('t', 'n', 1, 1);
    `);
    const indexAvant = ancienne
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('results', 'events')",
      )
      .all() as Array<{ name: string }>;
    expect(indexAvant.map((i) => i.name)).not.toContain('idx_results_recent');
    ancienne.close();

    // Ouverture par HiveStore : le SCHEMA est rejoué, les index manquants créés,
    // les données conservées. Aucune migration à écrire.
    const migre = new HiveStore(anciennePath);
    try {
      expect(migre.countResults()).toBe(1);
      const db = new Database(anciennePath, { readonly: true });
      const noms = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
          name: string;
        }>
      ).map((i) => i.name);
      expect(noms).toContain('idx_results_recent');
      expect(noms).toContain('idx_events_ts');
      db.close();
    } finally {
      migre.close();
      rmSync(ancienDir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

describe('lectures ciblées et élagage', () => {
  let store: HiveStore;

  beforeEach(() => {
    store = new HiveStore(':memory:');
  });

  afterEach(() => store.close());

  it('listTaskTexts lit par clé primaire, dédoublonne et découpe en lots', () => {
    const p = store.createProject({ name: 'P' });
    const ids: string[] = [];
    for (let i = 0; i < 1_500; i++) {
      ids.push(store.createTask({ projectId: p.id, title: `T${i}`, prompt: `p${i}` }).id);
    }
    // 1 500 ids > 999 variables liées : sans découpage, SQLite refuserait.
    const lus = store.listTaskTexts([...ids, ...ids, 'inconnue']);
    expect(lus).toHaveLength(1_500);
    expect(new Set(lus.map((t) => t.id)).size).toBe(1_500);
    expect(lus.every((t) => t.title.startsWith('T'))).toBe(true);
    expect(store.listTaskTexts([])).toEqual([]);
  });

  it('listEventsInWindow ne rend que la fenêtre et les types demandés, payload compris', () => {
    const now = Date.now();
    store.appendEvent('task_failed', { reason: 'dependency_failed' }, now - 1_000);
    store.appendEvent('task_rejected', { infra: true }, now - 1_000);
    store.appendEvent('task_failed', { reason: 'vieux' }, now - 3_600_000); // hors fenêtre
    for (let i = 0; i < 50; i++) store.appendEvent('task_progress', { i }, now); // hors types

    const fenetre = store.listEventsInWindow(now - 600_000, TYPES_THERMO);
    expect(fenetre.map((e) => e.type)).toEqual(['task_failed', 'task_rejected']);
    expect(fenetre[0]?.payload).toEqual({ reason: 'dependency_failed' });
    expect(fenetre[1]?.payload).toEqual({ infra: true });
    expect(store.listEventsInWindow(now - 600_000, [])).toEqual([]);
  });

  it('pruneResults allège les colonnes lourdes des anciens résultats et garde la ligne', () => {
    const gros = 'x'.repeat(5_000);
    for (let i = 0; i < 12; i++) {
      store.insertResult(
        {
          taskId: `t${i}`,
          nodeId: 'n1',
          success: i % 2 === 0,
          diff: gros,
          logs: gros,
          durationMs: 1,
          subAgents: [],
        },
        1_000 + i,
      );
    }

    expect(store.pruneResults(5)).toBe(7); // les 7 plus anciens sont allégés

    // Les lignes SURVIVENT toutes : la Miellerie, le Parlement et les
    // phéromones continuent de savoir qui a fait quoi.
    expect(store.countResults()).toBe(12);
    const corpus = store.listResultsForPheromones();
    expect(corpus).toHaveLength(12);
    expect(corpus.filter((r) => r.success)).toHaveLength(6);
    // Anciens : allégés. Récents : intacts.
    expect(store.resultsForTask('t0')[0]).toMatchObject({ diff: '', logs: '' });
    expect(store.resultsForTask('t6')[0]).toMatchObject({ diff: '', logs: '' });
    expect(store.resultsForTask('t7')[0]?.diff).toBe(gros);
    expect(store.resultsForTask('t11')[0]?.logs).toBe(gros);

    // Idempotent et borné : une seconde passe ne réécrit rien (filigrane).
    expect(store.pruneResults(5)).toBe(0);
    // Deux résultats de plus : seul le nouveau sortant est traité.
    store.insertResult(
      {
        taskId: 't12',
        nodeId: 'n1',
        success: true,
        diff: gros,
        logs: '',
        durationMs: 1,
        subAgents: [],
      },
      2_000,
    );
    expect(store.pruneResults(5)).toBe(1);
    expect(store.resultsForTask('t7')[0]?.diff).toBe('');
    expect(store.resultsForTask('t8')[0]?.diff).toBe(gros);
  });

  it('pruneResults ne fait rien tant que la rétention n’est pas atteinte', () => {
    for (let i = 0; i < 3; i++) {
      store.insertResult(
        {
          taskId: `t${i}`,
          nodeId: 'n',
          success: true,
          diff: 'd',
          logs: 'l',
          durationMs: 1,
          subAgents: [],
        },
        1_000 + i,
      );
    }
    expect(store.pruneResults(5_000)).toBe(0);
    expect(store.resultsForTask('t0')[0]?.diff).toBe('d');
  });
});
