// Tests de tenue à l'échelle du store : plans de requête (EXPLAIN QUERY PLAN),
// lectures ciblées et élagage des résultats. Ce sont des tests STRUCTURELS —
// ils vérifient le plan choisi par SQLite et le travail réellement demandé,
// pas des durées : déterministes aujourd'hui comme dans dix ans.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOT_GRAND_LIVRE } from '../src/orchestrator/balance.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
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

  // ─── La Balance : les deux lectures du grand livre ────────────────────────
  //
  // C'est ICI que se joue la régression silencieuse la plus coûteuse du lot :
  // sans index couvrant, SQLite ouvre la LIGNE de `results` pour lire un entier
  // (`durationMs`), qui est stocké APRÈS `diff` (≤ 1 Mo) et `logs` (≤ 512 ko) —
  // il faut traverser toute leur chaîne de pages de débordement. Ces deux tests
  // prouvent le plan au lieu de le décréter.

  /** Requête EXACTE de `listResultsForLedger` (lecture incrémentale du livre). */
  const SQL_LEDGER = `SELECT id, taskId, nodeId, success, durationMs FROM results
     INDEXED BY idx_results_balance WHERE id > ? ORDER BY id LIMIT ?`;
  /** Requête EXACTE de `listResultsForBalance` (corpus borné de l'imputation). */
  const SQL_CORPUS = `SELECT id, taskId, nodeId, success, durationMs FROM results
     INDEXED BY idx_results_balance ORDER BY id DESC LIMIT ?`;

  it('la lecture incrémentale du grand livre est servie par un index COUVRANT', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const detail = plan(db, SQL_LEDGER, 0, 2_000);
      expect(detail).toContain('COVERING INDEX idx_results_balance');
      // Le plan à éviter : la ligne ouverte, donc les pages de débordement de
      // diff/logs traversées pour lire un entier.
      expect(detail).not.toContain('INTEGER PRIMARY KEY');
      expect(detail).not.toContain('TEMP B-TREE');
    } finally {
      db.close();
    }
  });

  it('le corpus de l’imputation est servi par le même index, sans tri temporaire', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const detail = plan(db, SQL_CORPUS, 2_000);
      expect(detail).toContain('SCAN results USING COVERING INDEX idx_results_balance');
      expect(detail).not.toContain('TEMP B-TREE');
    } finally {
      db.close();
    }
  });

  it('l’index de la Balance ne détourne pas le planner du corpus des phéromones', () => {
    // Non-régression du voisin : un troisième index sur `results` ne doit pas
    // faire perdre à la requête des phéromones son propre index couvrant.
    // `ANALYZE` joué comme sur une base en service : c'est justement lorsque
    // les statistiques existent que le planner change d'avis.
    const ecriture = new Database(dbPath);
    const inserer = ecriture.prepare(
      'INSERT INTO results (taskId, nodeId, success, diff, logs, durationMs, subAgents, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const gros = 'x'.repeat(2_000);
    ecriture.transaction(() => {
      for (let i = 0; i < 2_000; i++) {
        inserer.run(`t${i % 40}`, `n${i % 4}`, i % 2, gros, gros, i, '[]', 1_000 + i);
      }
    })();
    ecriture.exec('ANALYZE');
    try {
      expect(
        plan(
          ecriture,
          'SELECT taskId, nodeId, success, createdAt FROM results ORDER BY createdAt DESC, id DESC LIMIT ?',
          500,
        ),
      ).toContain('COVERING INDEX idx_results_recent');
      // Et les deux lectures de la Balance tiennent AUSSI avec des statistiques.
      expect(plan(ecriture, SQL_LEDGER, 0, 2_000)).toContain('COVERING INDEX idx_results_balance');
      expect(plan(ecriture, SQL_CORPUS, 2_000)).toContain('COVERING INDEX idx_results_balance');
    } finally {
      ecriture.close();
    }
  });

  // ─── La Balance : la table des plafonds (lot 3) ──────────────────────────
  //
  // `budgets` est la SEULE table nouvelle de la Balance, et la seule lecture
  // sans `LIMIT` qu'elle ajoute. Ce qui l'autorise n'est pas une mesure de
  // durée, c'est une propriété STRUCTURELLE : la table est 1:1 avec `projects`,
  // donc sa taille ne croît pas avec l'histoire de la ruche. Ces deux tests
  // prouvent le plan plutôt que de le décréter.

  it('le plafond d’un projet est lu par CLÉ PRIMAIRE, jamais par un parcours', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const detail = plan(
        db,
        'SELECT projectId, plafondMs, version, definiPar, updatedAt FROM budgets WHERE projectId = ?',
        'p',
      );
      expect(detail).toContain('SEARCH budgets');
      expect(detail).not.toContain('SCAN budgets');
    } finally {
      db.close();
    }
  });

  it('la lecture de TOUS les plafonds ne trie rien : l’index de clé primaire suffit', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const detail = plan(
        db,
        'SELECT projectId, plafondMs, version, definiPar, updatedAt FROM budgets ORDER BY projectId',
      );
      // Le tri est celui de la clé primaire : aucun B-tree temporaire, aucun
      // tri en mémoire — même sur une ruche à dix mille projets.
      expect(detail).not.toContain('TEMP B-TREE');
    } finally {
      db.close();
    }
  });

  // ─── La Balance : les verdicts de revue du socle ─────────────────────────
  //
  // `reviews` n'est JAMAIS élaguée : c'est la seule table du socle de la
  // Balance dont la taille croît sans borne avec l'histoire de la ruche. La
  // lire en entier (`SELECT taskId, state FROM reviews`, sans WHERE ni LIMIT)
  // pour n'en garder que les ≤ 2 000 clés du corpus coûtait 159,8 ms à 100 000
  // revues, contre 6,0 ms en lecture ciblée — et cela toutes les 3 s, dans la
  // boucle d'événements, à cause du polling du dashboard sur /api/balance.

  it('les verdicts du socle sont lus par CLÉ PRIMAIRE : SEARCH reviews, jamais SCAN', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      // Requête EXACTE de `listReviewsFor` (un lot de 900 au maximum).
      const ids = Array.from({ length: 900 }, (_, i) => `t${i}`);
      const detail = plan(
        db,
        `SELECT taskId, state FROM reviews WHERE taskId IN (${ids.map(() => '?').join(', ')})`,
        ...ids,
      );
      expect(detail).toContain('SEARCH reviews');
      expect(detail).not.toContain('SCAN reviews');
    } finally {
      db.close();
    }
  });

  it('listReviewsFor ne lit QUE les tâches citées, même avec un corpus de revues bien plus large', () => {
    // Délai explicite : ce test tombait à 5 000 ms sur la CI WINDOWS, et nulle
    // part ailleurs. Ce n'est pas un blocage — il construit un corpus volumineux avant de mesurer le plan de requête ; sous Windows l'écriture SQLite est plus coûteuse, et il a été mesuré à 8,6 s.
    //
    // La distinction compte, et elle a déjà servi ici : trois autres tests
    // tapaient les 30 000 ms AU MILLIÈME PRÈS, ce qui trahissait une attente
    // sans fin et non de la lenteur. On les a corrigés, pas rallongés.
    const projet = store.createProject({ name: 'P' });
    const ids: string[] = [];
    for (let i = 0; i < 1_200; i++) {
      const t = store.createTask({ id: `t${i}`, projectId: projet.id, title: 'T', prompt: 'x' });
      store.setTaskReview(t.id, i % 2 === 0 ? 'approved' : 'rejected');
      ids.push(t.id);
    }
    // Découpage en lots de 900 : le cas > 999 variables liées est couvert.
    const cibles = ids.slice(0, 1_000);
    const verdicts = store.listReviewsFor(cibles);
    expect(Object.keys(verdicts)).toHaveLength(1_000);
    expect(verdicts['t0']).toBe('approved');
    expect(verdicts['t1']).toBe('rejected');
    // Les 200 autres ne sont PAS dans le retour : c'est tout l'objet.
    expect(verdicts['t1100']).toBeUndefined();
    // Ids inconnus : simplement absents, jamais une exception.
    expect(store.listReviewsFor(['inexistante'])).toEqual({});
    expect(store.listReviewsFor([])).toEqual({});
  }, 20_000);

  it('la porte n’ajoute AUCUNE lecture par tick : les plafonds sont mémoïsés', () => {
    // Le chemin du tick ne doit gagner ni un SELECT non borné, ni une lecture
    // par tâche prête. Preuve par comptage : dix ticks, une seule lecture.
    const projet = store.createProject({ name: 'P' });
    store.createTask({ id: 'T1', projectId: projet.id, title: 'T', prompt: 'x' });
    store.setBudget(projet.id, 10_000_000, null, 1_000);
    const scheduler = new Scheduler(store, { balance: { mode: 'strict' } });
    let lectures = 0;
    const vraie = store.listBudgets.bind(store);
    store.listBudgets = () => {
      lectures += 1;
      return vraie();
    };
    for (let i = 0; i < 10; i++) scheduler.tick(2_000 + i);
    expect(lectures).toBe(1);
  });

  // ─── Les Gardiennes : la table des verdicts ──────────────────────────────
  //
  // La table `gardiennes` n'a AUCUN index ajouté, et c'est un choix qui se
  // prouve : sa seule lecture est un parcours ARRIÈRE de la clé primaire, borné
  // par un LIMIT. Un index sur (id DESC) serait redondant avec le rowid, et un
  // index COUVRANT devrait embarquer la colonne `griefs` — c'est-à-dire recopier
  // le JSON dans l'index. Ce qui rend ce parcours bon marché n'est donc pas un
  // index mais la PETITESSE des lignes, bornée à la construction des griefs
  // (voir tests/gardiennes.test.ts, « une ligne de garde reste PETITE »).

  /** Requête EXACTE de `listInspections`. */
  const SQL_GARDIENNES = `SELECT id, resultId, taskId, nodeId, verdict, score, applique, griefs, createdAt
         FROM gardiennes ORDER BY id DESC LIMIT ?`;

  it('la lecture des verdicts ne trie RIEN : le LIMIT arrête le parcours de la clé primaire', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const detail = plan(db, SQL_GARDIENNES, 500);
      // Le plan à éviter absolument : un B-tree temporaire, qui obligerait à
      // lire et trier TOUTE la table pour n'en rendre que 500 lignes.
      expect(detail).not.toContain('TEMP B-TREE');
    } finally {
      db.close();
    }
  });

  it('l’élagage des verdicts est une suppression par PLAGE de clé primaire', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      // `pruneGardiennes` : motif `pruneEvents` à la lettre, plan compris.
      expect(plan(db, 'SELECT MAX(id) AS id FROM gardiennes')).not.toContain('SCAN gardiennes');
      expect(plan(db, 'SELECT id FROM gardiennes WHERE id <= ?', 10)).toContain(
        'INTEGER PRIMARY KEY',
      );
    } finally {
      db.close();
    }
  });

  it('la table des verdicts n’ajoute ni index, ni contrainte au voisinage', () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      const index = (
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'gardiennes'",
          )
          .all() as Array<{ name: string }>
      ).map((i) => i.name);
      // Aucun index explicite : rien à redéfinir un jour, donc rien à perdre
      // silencieusement (doctrine, règle 2 — un index existant ne se modifie
      // JAMAIS, et le plus sûr est de n'en pas créer sans nécessité prouvée).
      expect(index.filter((n) => !n.startsWith('sqlite_autoindex'))).toEqual([]);
      // Et les index des VOISINS sont intacts : la table neuve n'a touché à rien.
      const tous = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{
          name: string;
        }>
      ).map((i) => i.name);
      expect(tous).toContain('idx_results_recent');
      expect(tous).toContain('idx_results_balance');
    } finally {
      db.close();
    }
  });

  it('la table des verdicts arrive sur une base EXISTANTE, sans migration', () => {
    // Même propriété que pour les index : le SCHEMA est rejoué au boot, la
    // table manquante est créée, les données conservées. C'est toute la raison
    // pour laquelle les Gardiennes n'ont pas ajouté une colonne à `results`.
    const ancienDir = mkdtempSync(path.join(os.tmpdir(), 'hive-sans-gardiennes-'));
    const anciennePath = path.join(ancienDir, 'hive.db');
    const ancienne = new Database(anciennePath);
    ancienne.exec(`
      CREATE TABLE results (
        id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, nodeId TEXT NOT NULL,
        success INTEGER NOT NULL, diff TEXT NOT NULL DEFAULT '', logs TEXT NOT NULL DEFAULT '',
        durationMs INTEGER NOT NULL DEFAULT 0, subAgents TEXT NOT NULL DEFAULT '[]',
        createdAt INTEGER NOT NULL);
      INSERT INTO results (taskId, nodeId, success, createdAt) VALUES ('t', 'n', 1, 1);
    `);
    ancienne.close();
    const migre = new HiveStore(anciennePath);
    try {
      expect(migre.countResults()).toBe(1); // rien n'a été perdu
      expect(migre.countInspections()).toBe(0); // la table neuve est là, et vide
      expect(migre.listInspections()).toEqual([]);
    } finally {
      migre.close();
      rmSync(ancienDir, { recursive: true, force: true, maxRetries: 3 });
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

  it('le rattrapage du grand livre est BORNÉ : un tick absorbe exactement LOT_GRAND_LIVRE', () => {
    // Un arriéré hérité (base ouverte pour la première fois par cette version)
    // doit être rattrapé en quelques ticks, jamais figer le premier. La borne
    // est PROUVÉE — pas mesurée en temps, donc déterministe dans dix ans.
    const scheduler = new Scheduler(store);
    const projet = store.createProject({ name: 'P' });
    const tache = store.createTask({ projectId: projet.id, title: 'T', prompt: 'x' });
    const arriere = 3 * LOT_GRAND_LIVRE;
    for (let i = 0; i < arriere; i++) {
      store.insertResult({
        taskId: tache.id,
        nodeId: 'n1',
        success: true,
        diff: '',
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
    }
    const absorbees = (): number =>
      scheduler.balance.soldes.reduce((somme, s) => somme + s.tentatives, 0);

    scheduler.tick();
    expect(absorbees()).toBe(LOT_GRAND_LIVRE);
    // FAIL-OPEN : tant que le livre n'a pas rejoint la table, il le DIT.
    expect(scheduler.balance.aJour).toBe(false);
    scheduler.tick();
    expect(absorbees()).toBe(2 * LOT_GRAND_LIVRE);
    scheduler.tick();
    expect(absorbees()).toBe(arriere);
    // Le dernier lot était PLEIN : le livre ne peut pas encore savoir qu'il a fini.
    expect(scheduler.balance.aJour).toBe(false);
    scheduler.tick();
    expect(absorbees()).toBe(arriere); // rien de neuf : le filigrane ne recule ni ne double
    expect(scheduler.balance.aJour).toBe(true);
    expect(scheduler.balance.soldes).toEqual([
      {
        projectId: projet.id,
        depenseMs: arriere,
        tentatives: arriere,
        plafondMs: null,
        etat: 'passe',
        bloque: false,
      },
    ]);
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

describe('LES BORNES D’ÉLAGAGE NE JETTENT PAS AU HASARD', () => {
  let dir: string;
  let store: HiveStore;
  let projectId: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-elagage-'));
    store = new HiveStore(path.join(dir, 'hive.db'));
    projectId = store.createProject({ name: 'p', description: '' }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  // ─── CE QUE CE BLOC RATTRAPE ───────────────────────────────────────────────
  //
  // Trier sur un HORODATAGE SEUL ne définit aucun ordre entre lignes de même
  // milliseconde : SQLite est libre de les rendre dans n'importe quel ordre.
  // Trois bornes le faisaient, et la CI l'a prouvé — sur un runner rapide,
  // trois conseils ouverts d'affilée ont partagé le même `createdAt` et
  // l'élagage a supprimé la mauvaise session.
  //
  // Ces tests fabriquent l'égalité EXPRÈS, au lieu d'espérer la rencontrer.

  it('LIVRAISONS : le quota est exact même à horodatage identique', () => {
    // Le cas le plus grave, et ce n'était PAS de l'imprévisibilité : la version
    // précédente prenait un seuil puis supprimait `WHERE creeA <= seuil`. Avec
    // cinq livraisons de même `creeA`, le `<=` les emportait TOUTES — garder 2
    // en gardait 0. De la perte de données, pas un ordre discutable.
    const MEME_INSTANT = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) {
      const t = store.createTask({ projectId, title: `t${i}`, prompt: `p${i}` });
      // `now` fixe : c'est LUI qui écrit `creeA`, et l'égalité est le sujet.
      store.setLivraison({
        taskId: t.id,
        projectId,
        depot: 'micka/hive',
        pr: 100 + i,
        branche: `b${i}`,
        etat: 'ouverte',
        now: MEME_INSTANT,
      });
    }
    expect(store.pruneLivraisons(2)).toBe(3);
    expect(store.listLivraisons(projectId).length, 'le quota doit être EXACT').toBe(2);
  });
});
