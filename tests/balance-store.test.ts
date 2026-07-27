// Lectures de la Balance côté store : les deux corpus bornés (incrémental et
// récent), les lectures ciblées de tâches, le recalcul à froid, et le test qui
// protège le socle — `pruneResults` vide `diff`/`logs`, mais `durationMs`
// SURVIT. La confiance survit à la disparition de la preuve.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VERSION_BALANCE } from '../src/orchestrator/balance.js';
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

describe('HiveStore — budgets : l’intention humaine (la Balance, borner)', () => {
  let store: HiveStore;

  beforeEach(() => {
    store = new HiveStore(':memory:');
  });

  afterEach(() => store.close());

  it('T4 — setBudget / getBudget / listBudgets, et `null` SUPPRIME la ligne', () => {
    const p1 = store.createProject({ name: 'P1' });
    const p2 = store.createProject({ name: 'P2' });

    // Aucun plafond : l'absence de ligne EST l'état « éteint ».
    expect(store.getBudget(p1.id)).toBeNull();
    expect(store.listBudgets()).toEqual([]);

    store.setBudget(p1.id, 60_000, 'utilisatrice-1', 1_000);
    store.setBudget(p2.id, 5_000, null, 2_000);
    expect(store.getBudget(p1.id)).toEqual({
      projectId: p1.id,
      plafondMs: 60_000,
      version: VERSION_BALANCE,
      definiPar: 'utilisatrice-1',
      updatedAt: 1_000,
    });
    // `definiPar` null est un cas normal (token du hub sans JWT), pas une erreur.
    expect(store.getBudget(p2.id)?.definiPar).toBeNull();
    expect(
      store
        .listBudgets()
        .map((b) => b.projectId)
        .sort(),
    ).toEqual([p1.id, p2.id].sort());

    // Ré-écriture : la ligne est remplacée, pas dupliquée (clé primaire).
    store.setBudget(p1.id, 90_000, null, 3_000);
    expect(store.listBudgets()).toHaveLength(2);
    expect(store.getBudget(p1.id)).toMatchObject({
      plafondMs: 90_000,
      definiPar: null,
      updatedAt: 3_000,
    });

    // Retrait : la LIGNE disparaît. Pas de drapeau, pas de plafond nul déguisé —
    // un projet sans plafond doit être indiscernable, en base, d'un projet
    // d'avant la Balance.
    store.setBudget(p1.id, null, 'utilisatrice-1', 4_000);
    expect(store.getBudget(p1.id)).toBeNull();
    expect(store.listBudgets().map((b) => b.projectId)).toEqual([p2.id]);
    // Retirer deux fois ne casse rien.
    store.setBudget(p1.id, null, null, 5_000);
    expect(store.listBudgets()).toHaveLength(1);
  });

  it('T4 — un plafond négatif est ramené à 0, jamais stocké tel quel', () => {
    const p = store.createProject({ name: 'P' });
    store.setBudget(p.id, -42, null, 1_000);
    expect(store.getBudget(p.id)?.plafondMs).toBe(0);
    // 0 est un plafond LÉGITIME : « ce projet ne dépense plus rien ».
    expect(store.listBudgets()).toHaveLength(1);
  });

  it('T4 — listBudgets est trié par projet : un ordre stable, comme partout ailleurs', () => {
    const ids = ['c', 'a', 'b'].map((n) => {
      const p = store.createProject({ name: n });
      store.setBudget(p.id, 1_000, null, 1_000);
      return p.id;
    });
    expect(store.listBudgets().map((b) => b.projectId)).toEqual([...ids].sort());
  });

  it('la table `budgets` n’a AUCUN élagage — et ne doit jamais en avoir', () => {
    // Doctrine, règle 3 : bornée par construction (1:1 avec `projects`), donc
    // pas de `pruneBudgets`. Élaguer effacerait des intentions humaines encore
    // en vigueur : ce serait un plafond qui se lève tout seul.
    expect((store as unknown as Record<string, unknown>).pruneBudgets).toBeUndefined();
    const p = store.createProject({ name: 'P' });
    store.setBudget(p.id, 1_000, null, 1_000);
    // Les élagages voisins passent sans toucher au plafond.
    store.pruneEvents(0);
    store.pruneMemories(0);
    store.pruneResults(0);
    expect(store.getBudget(p.id)).toMatchObject({ plafondMs: 1_000 });
  });
});

describe('HiveStore — balance_ledger_cache : un CACHE, et rien d’autre', () => {
  let store: HiveStore;

  beforeEach(() => {
    store = new HiveStore(':memory:');
  });

  afterEach(() => store.close());

  const soldes = [
    { projectId: 'p1', depenseMs: 400, tentatives: 3 },
    { projectId: 'p2', depenseMs: 700, tentatives: 2 },
  ];

  it('écriture / lecture : un instantané cohérent, ou rien', () => {
    expect(store.lireCacheGrandLivre()).toBeNull(); // base neuve : pas de cache
    store.insertResult(resultat('t1', { durationMs: 1 }));
    store.insertResult(resultat('t2', { durationMs: 1 }));
    store.ecrireCacheGrandLivre(2, soldes);
    expect(store.lireCacheGrandLivre()).toEqual({ filigrane: 2, soldes });

    // Réécriture TOTALE : l'ancien contenu ne survit pas par morceaux.
    store.ecrireCacheGrandLivre(2, [{ projectId: 'p3', depenseMs: 1, tentatives: 1 }]);
    expect(store.lireCacheGrandLivre()?.soldes.map((s) => s.projectId)).toEqual(['p3']);
  });

  it('une VERSION étrangère jette le cache : reconstruction totale, jamais un solde faux', () => {
    store.insertResult(resultat('t1', { durationMs: 1 }));
    store.ecrireCacheGrandLivre(1, soldes);
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare('UPDATE balance_ledger_cache SET version = ?').run(VERSION_BALANCE + 1);
    expect(store.lireCacheGrandLivre()).toBeNull();
    // Et la table a bien été vidée : le doute ne se relit pas au démarrage suivant.
    expect(db.prepare('SELECT COUNT(*) AS n FROM balance_ledger_cache').get()).toEqual({ n: 0 });
  });

  it('des filigranes DIVERGENTS jettent le cache (l’écriture est atomique : c’est une corruption)', () => {
    store.insertResult(resultat('t1', { durationMs: 1 }));
    store.ecrireCacheGrandLivre(1, soldes);
    const db = (store as unknown as { db: Database.Database }).db;
    db.prepare('UPDATE balance_ledger_cache SET filigrane = 99 WHERE projectId = ?').run('p2');
    expect(store.lireCacheGrandLivre()).toBeNull();
  });

  it('un filigrane AU-DELÀ du dernier résultat jette le cache (base revenue en arrière)', () => {
    store.insertResult(resultat('t1', { durationMs: 1 }));
    expect(store.lastResultId()).toBe(1);
    store.ecrireCacheGrandLivre(5_000, soldes);
    expect(store.lireCacheGrandLivre()).toBeNull();
  });

  it('vider le cache est la PROCÉDURE de reconstruction : gratuite et sans perte', () => {
    store.insertResult(resultat('t1', { durationMs: 1 }));
    store.ecrireCacheGrandLivre(1, soldes);
    store.viderCacheGrandLivre();
    expect(store.lireCacheGrandLivre()).toBeNull();
    // La vérité, elle, n'a pas bougé d'un octet : `results` est intacte.
    expect(store.listResultsForLedger(0)).toHaveLength(1);
  });

  it('la table du cache n’a AUCUN élagage — sa borne est structurelle (règle 3)', () => {
    // Une ligne par PROJET, jamais par résultat : elle ne croît pas avec
    // l'histoire. Les élagages voisins ne la touchent pas non plus.
    expect((store as unknown as Record<string, unknown>).pruneLedgerCache).toBeUndefined();
    store.insertResult(resultat('t1', { durationMs: 1 }));
    store.ecrireCacheGrandLivre(1, soldes);
    store.pruneEvents(0);
    store.pruneMemories(0);
    store.pruneResults(0);
    expect(store.lireCacheGrandLivre()).toEqual({ filigrane: 1, soldes });
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
        // `budgets` arrive elle aussi sans migration : une base antérieure la
        // gagne à l'ouverture, une seule fois, et la SEULE table nouvelle de
        // toute la Balance (doctrine, règle 3 — bornée par construction, 1:1
        // avec `projects`, donc sans élagage).
        const tables = (
          inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
            name: string;
          }>
        ).map((t) => t.name);
        expect(tables).toContain('budgets');
        expect(tables.filter((t) => t === 'budgets')).toHaveLength(1);
      } finally {
        inspection.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
