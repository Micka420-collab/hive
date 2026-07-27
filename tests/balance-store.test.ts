// Lectures de la Balance côté store : les deux corpus bornés (incrémental et
// récent), les lectures ciblées de tâches, le recalcul à froid, et le test qui
// protège le socle — `pruneResults` vide `diff`/`logs`, mais `durationMs`
// SURVIT. La confiance survit à la disparition de la preuve.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import type { TaskResult } from '../src/shared/types.js';

function resultat(taskId: string, patch: Partial<TaskResult> = {}): TaskResult {
  return {
    taskId,
    nodeId: 'n1',
    success: true,
    diff: '',
    logs: '',
    durationMs: 0,
    subAgents: [],
    ...patch,
  };
}

describe('HiveStore — corpus de la Balance', () => {
  let store: HiveStore;

  beforeEach(() => {
    store = new HiveStore(':memory:');
  });

  afterEach(() => store.close());

  it('T1 — listResultsForLedger lit par id CROISSANT, plafonné, puis se tait', () => {
    for (let i = 0; i < 25; i++) {
      store.insertResult(resultat(`t${i}`, { durationMs: i, success: i % 2 === 0 }));
    }
    const lot = store.listResultsForLedger(0, 10);
    expect(lot).toHaveLength(10);
    expect(lot.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(lot[0]).toEqual({ id: 1, taskId: 't0', nodeId: 'n1', success: true, durationMs: 0 });
    expect(lot[1]?.success).toBe(false); // le booléen est bien reconstruit

    // Deuxième passe : la suite, sans recouvrement.
    const suite = store.listResultsForLedger(10, 10);
    expect(suite.map((r) => r.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

    // En régime établi : rien de neuf, une seule sonde et un tableau vide.
    expect(store.listResultsForLedger(25)).toEqual([]);
    expect(store.listResultsForLedger(10_000)).toEqual([]);
  });

  it('T2 — listResultsForBalance rend les N PLUS RÉCENTS (id décroissant)', () => {
    for (let i = 0; i < 10; i++) store.insertResult(resultat(`t${i}`, { durationMs: i }));
    const corpus = store.listResultsForBalance(3);
    expect(corpus.map((r) => r.id)).toEqual([10, 9, 8]);
    expect(corpus.map((r) => r.taskId)).toEqual(['t9', 't8', 't7']);
    // Corpus plus large que la table : tout, sans erreur.
    expect(store.listResultsForBalance(10_000)).toHaveLength(10);
  });

  it('T3 — listTaskComptes et listTaskProjects ne lisent que les tâches citées', () => {
    const p1 = store.createProject({ name: 'P1' });
    const p2 = store.createProject({ name: 'P2' });
    const a = store.createTask({ id: 'a', projectId: p1.id, title: 'A', prompt: 'x' });
    store.createTask({ id: 'b', projectId: p1.id, title: 'B', prompt: 'x' });
    const c = store.createTask({ id: 'c', projectId: p2.id, title: 'C', prompt: 'x' });
    store.patchTask(a.id, { status: 'done' });
    store.patchTask(c.id, { status: 'failed' });

    const comptes = store.listTaskComptes(['a', 'c', 'inconnue']);
    expect(comptes.sort((x, y) => x.id.localeCompare(y.id))).toEqual([
      { id: 'a', projectId: p1.id, status: 'done' },
      { id: 'c', projectId: p2.id, status: 'failed' },
    ]);
    expect(store.listTaskProjects(['c'])).toEqual([{ id: 'c', projectId: p2.id }]);
    expect(store.listTaskComptes([])).toEqual([]);
    expect(store.listTaskProjects(['inconnue'])).toEqual([]);
  });

  it('les lectures ciblées dépassent la limite de variables liées de SQLite', () => {
    const p = store.createProject({ name: 'P' });
    const ids: string[] = [];
    for (let i = 0; i < 1_500; i++) {
      ids.push(store.createTask({ projectId: p.id, title: `T${i}`, prompt: 'x' }).id);
    }
    // 1 500 ids > 999 variables : sans découpage en lots, SQLite refuserait.
    expect(store.listTaskComptes([...ids, ...ids])).toHaveLength(1_500);
    expect(store.listTaskProjects(ids)).toHaveLength(1_500);
  });

  it('T5 — pruneResults vide diff et logs, mais durationMs SURVIT (le socle tient)', () => {
    const gros = 'x'.repeat(5_000);
    for (let i = 0; i < 20; i++) {
      store.insertResult(
        resultat(`t${i}`, { diff: gros, logs: gros, durationMs: 100 + i }),
        1_000 + i,
      );
    }
    const avant = store.listResultsForLedger(0);
    expect(store.pruneResults(5)).toBe(15);

    // La preuve (diff, logs) a disparu pour les 15 plus anciens…
    expect(store.resultsForTask('t0')[0]).toMatchObject({ diff: '', logs: '' });
    expect(store.resultsForTask('t19')[0]?.diff).toBe(gros);
    // …mais le grand livre, lui, n'a rien perdu : mêmes lignes, mêmes durées.
    expect(store.listResultsForLedger(0)).toEqual(avant);
    expect(store.listResultsForBalance()).toHaveLength(20);
    expect(store.listResultsForLedger(0).reduce((s, r) => s + r.durationMs, 0)).toBe(
      avant.reduce((s, r) => s + r.durationMs, 0),
    );
  });

  it('T6 — depensesParProjet recalcule à froid la somme exacte, par projet', () => {
    const p1 = store.createProject({ name: 'P1' });
    const p2 = store.createProject({ name: 'P2' });
    const t1 = store.createTask({ projectId: p1.id, title: 'T1', prompt: 'x' });
    const t2 = store.createTask({ projectId: p1.id, title: 'T2', prompt: 'x' });
    const t3 = store.createTask({ projectId: p2.id, title: 'T3', prompt: 'x' });
    store.insertResult(resultat(t1.id, { durationMs: 100 }));
    store.insertResult(resultat(t1.id, { durationMs: 250, success: false }));
    store.insertResult(resultat(t2.id, { durationMs: 50 }));
    store.insertResult(resultat(t3.id, { durationMs: 700 }));
    // Une horloge en retard ne creuse jamais un solde…
    store.insertResult(resultat(t3.id, { durationMs: -900 }));
    // …et une tentative orpheline (tâche absente) n'est imputée à personne.
    store.insertResult(resultat('tache-disparue', { durationMs: 10_000 }));

    expect(store.depensesParProjet()).toEqual(
      new Map([
        [p1.id, { depenseMs: 400, tentatives: 3 }],
        [p2.id, { depenseMs: 700, tentatives: 2 }],
      ]),
    );
    expect(store.depensesParProjet().get('projet-inconnu')).toBeUndefined();
  });

  it('sur une base vide, les trois lectures rendent du vide — jamais une exception', () => {
    expect(store.listResultsForLedger(0)).toEqual([]);
    expect(store.listResultsForBalance()).toEqual([]);
    expect(store.depensesParProjet()).toEqual(new Map());
  });
});

describe('HiveStore — l’index de la Balance arrive sans migration', () => {
  it('T7 — une base ANTÉRIEURE gagne idx_results_balance, et deux ouvertures sont idempotentes', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-balance-ancienne-'));
    const dbPath = path.join(dir, 'hive.db');
    // Base d'une version antérieure : la table `results` existe, l'index de la
    // Balance n'existe pas encore.
    const ancienne = new Database(dbPath);
    ancienne.exec(`
      CREATE TABLE results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, nodeId TEXT NOT NULL,
        success INTEGER NOT NULL, diff TEXT NOT NULL DEFAULT '', logs TEXT NOT NULL DEFAULT '',
        durationMs INTEGER NOT NULL DEFAULT 0, subAgents TEXT NOT NULL DEFAULT '[]',
        createdAt INTEGER NOT NULL);
      CREATE INDEX idx_results_task ON results(taskId);
      INSERT INTO results (taskId, nodeId, success, durationMs, createdAt)
        VALUES ('t', 'n', 1, 4_242, 1);
    `);
    const nomsIndex = (db: Database.Database): string[] =>
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
          name: string;
        }>
      ).map((i) => i.name);
    expect(nomsIndex(ancienne)).not.toContain('idx_results_balance');
    ancienne.close();

    try {
      // Première ouverture : l'index apparaît, la donnée est intacte.
      const premier = new HiveStore(dbPath);
      expect(premier.listResultsForLedger(0)).toEqual([
        { id: 1, taskId: 't', nodeId: 'n', success: true, durationMs: 4_242 },
      ]);
      premier.close();

      // Seconde ouverture : rigoureusement idempotente (CREATE … IF NOT EXISTS).
      const second = new HiveStore(dbPath);
      expect(second.countResults()).toBe(1);
      second.close();

      const inspection = new Database(dbPath, { readonly: true });
      try {
        const noms = nomsIndex(inspection);
        expect(noms).toContain('idx_results_balance');
        expect(noms).toContain('idx_results_task');
        // Un seul index de Balance, pas un par ouverture.
        expect(noms.filter((n) => n === 'idx_results_balance')).toHaveLength(1);
        // Et AUCUNE table n'a été ajoutée par ce lot (doctrine, règle 3).
        const tables = (
          inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
            name: string;
          }>
        ).map((t) => t.name);
        expect(tables).not.toContain('budgets');
      } finally {
        inspection.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
