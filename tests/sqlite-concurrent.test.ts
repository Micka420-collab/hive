// SQLite À DEUX CONNEXIONS — sur un vrai fichier WAL, jamais `:memory:`.
//
// ─── CE QUE CE FICHIER VÉRIFIE, ET POURQUOI IL EXISTE ────────────────────────
//
// Tous les autres tests du store ouvrent UNE connexion, souvent `:memory:`.
// Ils ne peuvent donc rien dire de ce qui se passe quand une seconde connexion
// écrit dans le même fichier : ni des réglages que la base prend en WAL
// (l'un d'eux change APRÈS la première écriture), ni de l'attente d'un verrou
// tenu ailleurs, ni d'une lecture devenue fausse entre deux écritures.
//
// Trois faits, chacun là où il vit :
//
//   1. les quatre réglages du store, relus APRÈS une écriture et une
//      réouverture — l'état où `synchronous` avait trompé une lecture ;
//   2. un écrivain concurrent (un autre FIL, parce que better-sqlite3 est
//      synchrone) fait ATTENDRE le store au lieu de le faire échouer ;
//   3. deux ordonnanceurs sur la même base ne confient jamais une tâche à deux
//      nœuds — la lecture `ready` de l'un est périmée quand il réclame.

import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';

/** La connexion privée du store : les pragmas se lisent SUR elle, pas sur une autre. */
const connexion = (store: HiveStore): Database.Database =>
  (store as unknown as { db: Database.Database }).db;

const reglages = (store: HiveStore) => {
  const db = connexion(store);
  return {
    journal_mode: db.pragma('journal_mode', { simple: true }),
    synchronous: db.pragma('synchronous', { simple: true }),
    foreign_keys: db.pragma('foreign_keys', { simple: true }),
    busy_timeout: db.pragma('busy_timeout', { simple: true }),
  };
};

/** `synchronous` : 1 = NORMAL. Les trois autres, en clair. */
const ATTENDUS = { journal_mode: 'wal', synchronous: 1, foreign_keys: 1, busy_timeout: 5000 };

describe('SQLite à deux connexions, sur un fichier WAL', () => {
  let dir: string;
  let dbPath: string;
  const ouverts: HiveStore[] = [];
  const ouvrir = (): HiveStore => {
    const store = new HiveStore(dbPath);
    ouverts.push(store);
    return store;
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-sqlite-concurrent-'));
    dbPath = path.join(dir, 'hive.db');
  });

  afterEach(() => {
    for (const store of ouverts.splice(0)) store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('les quatre réglages tiennent APRÈS une écriture et une réouverture', () => {
    // Lu à l'ouverture d'une base neuve, `synchronous` valait 2 — c'est ainsi
    // qu'un audit a conclu à FULL. Mais better-sqlite3 est compilé avec
    // `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` : la première écriture en WAL le
    // faisait tomber à 1, et chaque réouverture partait de 1. Ces valeurs
    // étaient déjà celles de la ruche, par défauts de COMPILATION ; ce banc
    // rougit le jour où une dépendance les change sans que Hive l'ait écrit.
    const premier = ouvrir();
    premier.createProject({ name: 'une écriture, pour passer en WAL pour de vrai' });
    expect(reglages(premier), 'après la première écriture').toEqual(ATTENDUS);
    premier.close();
    ouverts.splice(0);

    const rouvert = ouvrir();
    expect(reglages(rouvert), 'à la réouverture d’une base WAL existante').toEqual(ATTENDUS);

    // Et `foreign_keys` n'est pas qu'un chiffre : la contrainte MORD sur la
    // connexion du store.
    expect(() =>
      rouvert.createTask({ projectId: 'projet-inexistant', title: 'orpheline', prompt: 'p' }),
    ).toThrow(/FOREIGN KEY/);
  });

  it('un écrivain concurrent fait ATTENDRE le store — il ne le fait pas échouer', async () => {
    const store = ouvrir();
    store.createProject({ name: 'base prête' });

    // Un AUTRE fil tient le verrou d'écriture du même fichier pendant 400 ms.
    // Dans le même fil, c'est impossible à jouer : better-sqlite3 est
    // synchrone, et le store bloquerait le fil qui devait rendre le verrou.
    const TENU_MS = 400;
    const ecrivain = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads');
       const Database = require(workerData.module);
       const db = new Database(workerData.chemin);
       db.exec('BEGIN IMMEDIATE');
       parentPort.postMessage('tenu');
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.tenuMs);
       db.exec('COMMIT');
       db.close();`,
      {
        eval: true,
        workerData: {
          module: createRequire(import.meta.url).resolve('better-sqlite3'),
          chemin: dbPath,
          tenuMs: TENU_MS,
        },
      },
    );
    try {
      await once(ecrivain, 'message');
      const debut = performance.now();
      // Avec `busy_timeout = 0`, cette ligne lèverait aussitôt
      // « database is locked ».
      store.appendEvent('essai_concurrence', { note: 'écrit pendant que l’autre fil tient' });
      const attente = performance.now() - debut;
      // Il a ATTENDU que l'autre rende la main — donc la contention a bien eu
      // lieu, et ce test n'est pas passé à côté.
      expect(attente).toBeGreaterThanOrEqual(TENU_MS / 2);
      expect(store.listEvents().some((e) => e.type === 'essai_concurrence')).toBe(true);
    } finally {
      await once(ecrivain, 'exit');
    }
  });

  it('deux ordonnanceurs sur la même base ne confient JAMAIS une tâche à deux nœuds', () => {
    // ─── L'ENTRELACEMENT, JOUÉ ─────────────────────────────────────────────
    //
    // La Reine A lit la liste `ready` en début de passe, puis réclame tâche
    // après tâche ; entre deux, `onAssign` rend la main au serveur. C'est là
    // que la Reine B passe : elle prend la seconde tâche. Quand A y arrive, sa
    // lecture dit encore `ready`. Une réclamation qui ne revérifie pas écrase
    // l'assignation de B — la même tâche part sur deux nœuds.
    //
    // Le verrou de la Reine interdit ce montage en production ; ce test garde
    // la ceinture sous les bretelles.
    const baseA = ouvrir();
    const baseB = ouvrir();
    const now = Date.now();
    // Deux places par nœud : sans elles, A ne trouverait plus de nœud libre
    // pour la seconde tâche et passerait — la course ne serait pas jouée.
    for (const name of ['n1', 'n2']) {
      const n = baseA.registerNode({
        name,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 2,
      });
      baseA.setNodeStatus(n.id, 'online');
      baseA.touchNode(n.id, now);
    }
    const projet = baseA.createProject({ name: 'Projet partagé' });
    const taches = ['Rédiger la documentation', 'Ajouter un journal des versions'].map((title) =>
      baseA.createTask({ projectId: projet.id, title, prompt: title }),
    );

    const envois: { reine: 'A' | 'B'; taskId: string; nodeId: string }[] = [];
    const reineB = new Scheduler(baseB, {
      simulation: true,
      onAssign: (nodeId, task) => envois.push({ reine: 'B', taskId: task.id, nodeId }),
    });
    const reineA = new Scheduler(baseA, {
      simulation: true,
      onAssign: (nodeId, task) => {
        envois.push({ reine: 'A', taskId: task.id, nodeId });
        // B passe PENDANT la passe de A — une seule fois.
        if (envois.length === 1) reineB.tick(now);
      },
    });
    reineA.tick(now);

    // L'invariant, pour CHAQUE tâche : envoyée exactement une fois, et au
    // nœud que la base retient. Pas « la seconde tâche est à B » — qui la
    // prend importe peu, qu'elle ne parte qu'une fois importe tout.
    for (const t of taches) {
      const pour = envois.filter((e) => e.taskId === t.id);
      expect(pour, `« ${t.title} » envoyée ${pour.length} fois`).toHaveLength(1);
      expect(baseB.getTask(t.id)?.assignedNodeId).toBe(pour[0]?.nodeId);
    }
    // Et l'entrelacement a bien eu lieu : les DEUX Reines ont réclamé.
    expect(new Set(envois.map((e) => e.reine))).toEqual(new Set(['A', 'B']));
  });

  it('une réclamation échoue si la tâche n’est plus dans le statut lu, sans rien écrire', () => {
    const baseA = ouvrir();
    const baseB = ouvrir();
    const n1 = baseA.registerNode({
      name: 'n1',
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const n2 = baseA.registerNode({
      name: 'n2',
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const projet = baseA.createProject({ name: 'P' });
    const tache = baseA.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
    baseA.patchTask(tache.id, { status: 'ready', attempts: 1 });

    const prise = baseA.reclamerTache({
      taskId: tache.id,
      attendu: 'ready',
      nodeId: n1.id,
      branch: `hive/${tache.id}`,
    });
    expect(prise?.status).toBe('assigned');
    expect(prise?.assignedNodeId).toBe(n1.id);
    // Rendue telle que la base l'a écrite — pas recomposée à partir d'une lecture.
    expect(prise?.attempts).toBe(1);

    // B croit encore la tâche prête : sa réclamation ne touche rien.
    const seconde = baseB.reclamerTache({
      taskId: tache.id,
      attendu: 'ready',
      nodeId: n2.id,
      branch: `hive/${tache.id}`,
    });
    expect(seconde).toBeUndefined();
    expect(baseB.getTask(tache.id)?.assignedNodeId).toBe(n1.id);
    // Une tâche inconnue ne se réclame pas davantage.
    expect(
      baseB.reclamerTache({ taskId: 'inconnue', attendu: 'ready', nodeId: n2.id, branch: null }),
    ).toBeUndefined();
  });
});
