// UN RÉSULTAT S'ÉCRIT EN ENTIER OU PAS DU TOUT — sinon il se compte deux fois.
//
// ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
//
// Ranger le résultat d'une tâche, c'est une CHAÎNE d'écritures : la ligne
// `results` (success = 1), puis le statut `done`, puis le journal, le souvenir…
// Tant que chacune était un autocommit séparé, une panne ENTRE deux d'entre
// elles laissait un état à moitié écrit :
//
//     results : 1 succès   ·   tasks : toujours `running`
//
// Et le hub sait très bien quoi faire d'une exception dans un message WS : il
// ferme la socket du nœud (1011), le `close` appelle `nodeDisconnected`, qui
// REQUALIFIE la tâche encore « active ». Elle repart, tourne une deuxième
// fois, et rend un deuxième succès. Deux lignes `success = 1` pour une tâche :
// précisément ce que le banc de crash (tests/resilience-processus.test.ts)
// promet de ne jamais voir.
//
// La panne n'a rien d'exotique : une base prise par UN AUTRE PROCESSUS (une
// sauvegarde, un `sqlite3` ouvert à la main — le scénario C du banc) au mauvais
// moment suffit ; `patchTask` attend 5 s puis lève SQLITE_BUSY. Le banc C
// passait parce que son verrou tombait presque toujours pendant que la Reine
// dormait — une propriété de l'horloge, pas du code.
//
// ─── CE QUE CES BANCS FIXENT ─────────────────────────────────────────────────
//
// On rejoue EXACTEMENT ce que fait server.ts sur une exception (nodeDisconnected
// 'ws_closed'), puis la suite normale (réinscription, tick, résultat), et on
// compte les succès rangés. Trois pannes, trois propriétés du correctif :
//
//   · un autre écrivain qui tente de prendre la base JUSTE APRÈS l'insertion
//     du résultat — sans transaction il y parvient ; avec, il ne peut pas
//     s'intercaler (isolation) ;
//   · une écriture qui échoue après le résultat rangé — la ligne `results`
//     doit disparaître avec elle (tout ou rien) ;
//   · la même chose dans une course de drones — où l'état EN MÉMOIRE de la
//     course ne doit pas avancer non plus quand la base, elle, n'a rien gardé ;
//   · et tout ce qui n'est pas la base attend le COMMIT : ni un enfant délégué
//     annulé chez son nœud, ni un modèle écarté des reprises, pour un
//     résultat que le ROLLBACK a effacé.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import type { TaskResult } from '../src/shared/types.js';

function profil(name: string, nodeId?: string): NodeProfile {
  return {
    name,
    ownerName: 'test',
    agentType: 'shell',
    maxConcurrency: 1,
    ...(nodeId ? { nodeId } : {}),
  };
}

function succes(taskId: string): Omit<TaskResult, 'nodeId'> {
  return { taskId, success: true, diff: '', logs: 'ok', durationMs: 5, subAgents: [] };
}

/** L'erreur que better-sqlite3 lève réellement quand une écriture échoue. */
const disquePlein = () => new Database.SqliteError('database or disk is full', 'SQLITE_FULL');

describe('un résultat se range en une seule transaction (jamais deux succès)', () => {
  let dir: string;
  let dbPath: string;
  let store: HiveStore;
  let scheduler: Scheduler;
  let verrou: Database.Database | null;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-tout-ou-rien-'));
    // Un VRAI fichier en WAL, comme la Reine : c'est lui que l'autre écrivain
    // tente de prendre, et `:memory:` ne se partage pas entre connexions.
    dbPath = path.join(dir, 'hive.db');
    store = new HiveStore(dbPath);
    scheduler = new Scheduler(store, { simulation: true });
    verrou = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    relacher();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function relacher(): void {
    if (!verrou) return;
    verrou.exec('ROLLBACK');
    verrou.close();
    verrou = null;
  }

  /**
   * Ce que fait server.ts d'un `task_result` : le scheduler, et sur exception
   * la fermeture de la socket, dont le `close` appelle `nodeDisconnected`.
   * Le verrou (s'il a été pris) est relâché avant — un verrou de 8 s finit
   * toujours par tomber, et c'est la SUITE qui compte ici.
   */
  function rejouerCommeLeHub(nodeId: string, taskId: string): void {
    try {
      scheduler.handleTaskResult(nodeId, succes(taskId));
    } catch {
      relacher();
      scheduler.nodeDisconnected(nodeId, 'ws_closed');
    }
  }

  function succesRanges(taskId: string): number {
    return store.resultsForTask(taskId).filter((r) => r.success).length;
  }

  // Chaque panne rend son CONSTAT : la preuve qu'elle a bien mordu — sans lui,
  // un banc dont la panne ne se déclenche plus passerait sans rien prouver.
  it.each([
    {
      panne: 'un autre écrivain tente de prendre la base juste après la ligne `results`',
      armer: (s: HiveStore) => {
        const inserer = s.insertResult.bind(s);
        let obtenue: boolean | undefined;
        vi.spyOn(s, 'insertResult').mockImplementationOnce((res, now) => {
          const id = inserer(res, now);
          // `timeout: 0` : l'autre écrivain n'attend pas. S'il obtient la base,
          // il la garde — et la suite de la chaîne bute sur SQLITE_BUSY.
          const autre = new Database(dbPath, { timeout: 0 });
          try {
            autre.exec('BEGIN EXCLUSIVE');
            verrou = autre;
            obtenue = true;
          } catch {
            autre.close();
            obtenue = false;
          }
          return id;
        });
        return () =>
          expect(obtenue, "l'autre écrivain s'est glissé entre deux écritures").toBe(false);
      },
    },
    {
      panne: 'une écriture échoue après la ligne `results`',
      armer: (s: HiveStore) => {
        const espion = vi.spyOn(s, 'patchTask').mockImplementationOnce(() => {
          throw disquePlein();
        });
        return () => expect(espion.mock.results[0]?.type, "la panne n'a pas mordu").toBe('throw');
      },
    },
  ])('$panne : un seul succès rangé, tâche done', ({ armer }) => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const n = scheduler.registerNode(profil('n1'));
    scheduler.tick();
    expect(store.getTask(t.id)?.assignedNodeId).toBe(n.id);
    scheduler.handleTaskUpdate(n.id, t.id);

    const constat = armer(store);
    rejouerCommeLeHub(n.id, t.id);

    // La suite normale : le nœud se réinscrit sous la même identité, la ruche
    // tique, et s'il a de nouveau la tâche, il la rend.
    scheduler.registerNode(profil('n1', n.id));
    scheduler.tick();
    if (store.getTask(t.id)?.status !== 'done') {
      expect(store.getTask(t.id)?.assignedNodeId).toBe(n.id);
      rejouerCommeLeHub(n.id, t.id);
    }

    expect(store.getTask(t.id)?.status).toBe('done');
    expect(succesRanges(t.id), 'la tâche a été comptée deux fois').toBe(1);
    constat();
  });

  it("un parent dont le résultat ne s'écrit pas n'annule PAS son enfant délégué chez son nœud", () => {
    // L'annulation part au nœud de l'enfant (`cancel_task`) : envoyée avant
    // le COMMIT, elle tuait un enfant que la base, après ROLLBACK, tient
    // encore pour vivant — et que son parent, rejoué, attendra.
    const annulations: string[] = [];
    const sched = new Scheduler(store, {
      simulation: true,
      onCancel: (_nodeId, taskId) => annulations.push(taskId),
    });
    const p = store.createProject({ name: 'P' });
    const parent = store.createTask({ projectId: p.id, title: 'parent', prompt: 'p' });
    const a = sched.registerNode(profil('a'));
    const c = sched.registerNode(profil('c'));
    sched.tick();
    sched.handleTaskUpdate(a.id, parent.id);
    const creation = store.createDelegatedTask({
      childTaskId: 'enfant',
      parentTaskId: parent.id,
      title: 'Sous-tâche',
      prompt: 'Exécute ce lot borné.',
      durationMs: 60_000,
      costMicros: 100_000,
      resourceUnits: 1,
    });
    expect(creation.ok).toBe(true);
    sched.tick();
    expect(store.getTask('enfant')?.assignedNodeId).toBe(c.id);
    sched.handleTaskUpdate(c.id, 'enfant');

    // Le parent aboutit ; la clôture de son sous-arbre bute sur la base.
    const ecrire = store.patchTask.bind(store);
    const espion = vi.spyOn(store, 'patchTask').mockImplementation((id, patch, now) => {
      if (id === 'enfant' && patch.status === 'failed') throw disquePlein();
      return ecrire(id, patch, now);
    });
    expect(() => sched.handleTaskResult(a.id, succes(parent.id))).toThrow();
    expect(
      espion.mock.results.some((r) => r.type === 'throw'),
      "la panne n'a pas mordu",
    ).toBe(true);

    expect(annulations, 'un enfant vivant a été annulé chez son nœud').toEqual([]);
    expect(store.getTask('enfant')?.status).toBe('running');
    expect(store.getTask(parent.id)?.status).toBe('running');
  });

  it("un échec dont l'écriture échoue n'écarte pas son modèle des reprises", () => {
    // L'écart vit EN MÉMOIRE : appliqué avant le COMMIT, il survivait au
    // ROLLBACK — la tentative n'est pas comptée, mais son modèle, lui, était
    // puni pour un échec que la ruche n'a pas gardé.
    const commandes: (string | undefined)[] = [];
    const sched = new Scheduler(store, {
      simulation: true,
      onAssign: (_nodeId, _task, modele) => commandes.push(modele),
    });
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const profilModeles = { ...profil('n1'), modeles: ['fable', 'opus'] };
    const n = sched.registerNode(profilModeles);
    sched.tick();
    expect(commandes).toEqual(['fable']);
    sched.handleTaskUpdate(n.id, t.id);

    const espion = vi.spyOn(store, 'patchTask').mockImplementationOnce(() => {
      throw disquePlein();
    });
    expect(() =>
      sched.handleTaskResult(n.id, { ...succes(t.id), success: false, logs: 'quota' }),
    ).toThrow();
    expect(espion.mock.results[0]?.type, "la panne n'a pas mordu").toBe('throw');
    vi.restoreAllMocks();

    // Ce que fait le hub ensuite : la socket tombe, le nœud revient.
    sched.nodeDisconnected(n.id, 'ws_closed');
    sched.registerNode({ ...profilModeles, nodeId: n.id });
    sched.tick();
    expect(store.getTask(t.id)?.attempts).toBe(0);
    expect(commandes, 'le modèle d’un échec effacé a été écarté').toEqual(['fable', 'fable']);
  });

  it("course de drones : une écriture qui échoue n'avance ni la base ni la course", () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'critique', prompt: 'x' });
    store.patchTask(t.id, { status: 'ready' });
    scheduler.registerNode(profil('a'));
    scheduler.registerNode(profil('b'));
    const course = scheduler.startRace(t.id, 2);
    if (!course.ok) throw new Error(`course non lancée : ${course.error}`);
    const [premier, second] = course.drones as [string, string];

    // Le drone primaire gagne… mais `done` ne s'écrit pas.
    vi.spyOn(store, 'patchTask').mockImplementationOnce(() => {
      throw disquePlein();
    });
    rejouerCommeLeHub(premier, t.id);
    vi.restoreAllMocks();

    // Rien n'a été retenu : la course vole encore, portée par le second drone.
    expect(succesRanges(t.id)).toBe(0);
    expect(scheduler.getRace(t.id)?.drones.find((d) => d.nodeId === second)?.status).toBe(
      'running',
    );
    expect(store.getTask(t.id)?.assignedNodeId).toBe(second);

    rejouerCommeLeHub(second, t.id);
    expect(store.getTask(t.id)?.status).toBe('done');
    expect(succesRanges(t.id), 'la tâche a été comptée deux fois').toBe(1);
  });
});
