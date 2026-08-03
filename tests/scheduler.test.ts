// Tests unitaires du cœur de la ruche : store SQLite + scheduler.
// Couvre : persistance, dépendances, capacité, reap, retries, idempotence.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { Task } from '../src/shared/types.js';

/** Fabrique un résultat de tâche minimal. */
function result(taskId: string, success = true) {
  return { taskId, success, diff: '', logs: '', durationMs: 10, subAgents: [] };
}

const profile = (name: string, maxConcurrency = 1) => ({
  name,
  ownerName: 'test',
  agentType: 'shell',
  maxConcurrency,
});

describe('HiveStore (persistance SQLite)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-store-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("l'état survit à un redémarrage (fichier SQLite)", () => {
    const dbPath = path.join(dir, 'hive.db');
    const store1 = new HiveStore(dbPath);
    const project = store1.createProject({ name: 'Projet' });
    const task = store1.createTask({ projectId: project.id, title: 'T', prompt: 'p' });
    store1.appendEvent('task_created', { taskId: task.id });
    store1.close();

    const store2 = new HiveStore(dbPath);
    expect(store2.getProject(project.id)?.name).toBe('Projet');
    expect(store2.getTask(task.id)?.title).toBe('T');
    expect(store2.listEvents()).toHaveLength(1);
    store2.close();
  });

  it('requalifie les tâches orphelines au boot et repasse les nœuds offline', () => {
    const dbPath = path.join(dir, 'hive.db');
    const store1 = new HiveStore(dbPath);
    const project = store1.createProject({ name: 'P' });
    const node = store1.registerNode(profile('n1'));
    const task = store1.createTask({ projectId: project.id, title: 'T', prompt: 'p' });
    store1.patchTask(task.id, { status: 'running', assignedNodeId: node.id });
    store1.close();

    // Redémarrage simulé de l'orchestrateur.
    const store2 = new HiveStore(dbPath);
    const orphans = store2.recoverOrphanTasks();
    expect(orphans.map((t) => t.id)).toEqual([task.id]);
    expect(store2.getTask(task.id)?.status).toBe('ready');
    expect(store2.getTask(task.id)?.assignedNodeId).toBeNull();
    expect(store2.getNode(node.id)?.status).toBe('offline');
    store2.close();
  });

  it('conserve son identité quand un nœud se ré-enregistre avec son nodeId', () => {
    const store = new HiveStore(':memory:');
    const first = store.registerNode(profile('n1'));
    const again = store.registerNode({ ...profile('n1-renamed'), nodeId: first.id });
    expect(again.id).toBe(first.id);
    expect(store.listNodes()).toHaveLength(1);
    expect(store.getNode(first.id)?.name).toBe('n1-renamed');
    store.close();
  });

  it('borne le journal : pruneEvents ne garde que les N derniers événements', () => {
    const store = new HiveStore(':memory:');
    for (let i = 0; i < 50; i++) store.appendEvent('tick', { i });
    expect(store.countEvents()).toBe(50);

    // Sous le plafond : rien n'est supprimé.
    expect(store.pruneEvents(100)).toBe(0);
    expect(store.countEvents()).toBe(50);

    // Au-dessus du plafond : on ne garde que les 10 plus récents.
    const removed = store.pruneEvents(10);
    expect(removed).toBe(40);
    expect(store.countEvents()).toBe(10);
    const kept = store.listEvents(0, 1000);
    expect(kept).toHaveLength(10);
    // Ce sont bien les plus récents (payload i de 40 à 49).
    expect(kept.map((e) => e.payload.i)).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 49]);
    store.close();
  });
});

describe('Scheduler (ordonnancement)', () => {
  let store: HiveStore;
  let assigned: { nodeId: string; task: Task }[];
  let scheduler: Scheduler;

  beforeEach(() => {
    store = new HiveStore(':memory:');
    assigned = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task) => assigned.push({ nodeId, task }),
    });
  });

  afterEach(() => {
    store.close();
  });

  it('retryAfterMs (Night Shift) : cooldown long honoré, plafonné à 24 h', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 'p' });
    const node = scheduler.registerNode(profile('n1'));
    const t0 = 1_000_000;

    scheduler.tick(t0);
    expect(store.getTask(t.id)?.status).toBe('assigned');

    // Refus « hors service » : réouverture dans 2 h.
    scheduler.rejectTask(node.id, t.id, 'hors_service_night_shift', false, t0, 2 * 3_600_000);
    expect(store.getTask(t.id)?.status).toBe('ready');
    expect(store.getTask(t.id)?.attempts).toBe(0); // aucune tentative brûlée

    // Bien après le cooldown COURT (3 s) mais avant la réouverture : pas de ré-assignation.
    scheduler.tick(t0 + 60_000);
    expect(store.getTask(t.id)?.status).toBe('ready');
    // Après la réouverture : le nœud est de nouveau sollicité.
    scheduler.tick(t0 + 2 * 3_600_000 + 1);
    expect(store.getTask(t.id)?.status).toBe('assigned');

    // Plafond : un retryAfterMs délirant (10 jours) est borné à 24 h.
    scheduler.rejectTask(node.id, t.id, 'hors_service_night_shift', false, t0, 10 * 86_400_000);
    scheduler.tick(t0 + 24 * 3_600_000 + 1);
    expect(store.getTask(t.id)?.status).toBe('assigned');
  });

  it('la ré-inscription d’un nœud purge ses cooldowns de refus', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 'p' });
    const node = scheduler.registerNode(profile('n1'));
    const t0 = 1_000_000;

    scheduler.tick(t0);
    scheduler.rejectTask(node.id, t.id, 'hive_shift_invalide', false, t0, 10 * 60_000);
    scheduler.tick(t0 + 5_000);
    expect(store.getTask(t.id)?.status).toBe('ready'); // cooldown long actif

    // Le membre corrige sa config et relance le nœud : reconcile purge le cooldown.
    scheduler.registerNode({ ...profile('n1'), nodeId: node.id }, t0 + 6_000);
    scheduler.reconcileNode(node.id, [], t0 + 6_000);
    scheduler.tick(t0 + 7_000);
    expect(store.getTask(t.id)?.status).toBe('assigned');
  });

  it('startRace : le cooldown qui expire EXACTEMENT maintenant libère le nœud (<=, pas <)', () => {
    // La survivante du balayage loupe du 3 août : dans le filtre d'enrôlement
    // des drones, `(rejet ?? 0) <= now` mutée en `<`. À l'instant précis où le
    // refus expire, le nœud resterait exclu — et la course refusée « aucun
    // nœud disponible » alors que la fenêtre vient de se rouvrir.
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 'p' });
    const node = scheduler.registerNode(profile('n1'));
    const t0 = 1_000_000;
    scheduler.tick(t0);
    scheduler.rejectTask(node.id, t.id, 'noeud_sature', false, t0, 60_000);
    const expiration = t0 + 60_000; // max(3 s, min(60 s, 24 h)) = 60 s

    // Une milliseconde AVANT : le refus tient encore — la contre-preuve qui
    // montre que le test sait distinguer les deux côtés de la frontière.
    const avant = scheduler.startRace(t.id, 2, expiration - 1);
    expect(avant.ok, 'le cooldown doit encore tenir à expiration - 1').toBe(false);

    // À l'expiration EXACTE : le nœud est libre, la course part avec lui.
    const pile = scheduler.startRace(t.id, 2, expiration);
    expect(pile.ok, 'à l’expiration exacte, le nœud est éligible (<=)').toBe(true);
    if (pile.ok) expect(pile.drones).toEqual([node.id]);
  });

  it('promeut pending → ready quand toutes les dépendances sont done', () => {
    const p = store.createProject({ name: 'P' });
    const a = store.createTask({ projectId: p.id, title: 'A', prompt: 'a' });
    const b = store.createTask({ projectId: p.id, title: 'B', prompt: 'b', dependsOn: [a.id] });

    scheduler.tick();
    expect(store.getTask(a.id)?.status).toBe('ready');
    expect(store.getTask(b.id)?.status).toBe('pending');

    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();
    expect(store.getTask(a.id)?.status).toBe('assigned');
    expect(store.getTask(a.id)?.branch).toBe(`hive/${a.id}`);

    scheduler.handleTaskUpdate(node.id, a.id);
    expect(store.getTask(a.id)?.status).toBe('running');

    scheduler.handleTaskResult(node.id, result(a.id));
    expect(store.getTask(a.id)?.status).toBe('done');
    // B devient ready puis est aussitôt assignée au nœud libéré.
    expect(store.getTask(b.id)?.status).toBe('assigned');
    expect(assigned.map((x) => x.task.id)).toEqual([a.id, b.id]);
  });

  it("n'assigne jamais au-delà de la capacité d'un nœud", () => {
    const p = store.createProject({ name: 'P' });
    store.createTask({ projectId: p.id, title: 'A', prompt: 'a' });
    store.createTask({ projectId: p.id, title: 'B', prompt: 'b' });
    store.createTask({ projectId: p.id, title: 'C', prompt: 'c' });

    scheduler.registerNode(profile('n1', 2));
    scheduler.tick();
    expect(store.tasksByStatus('assigned')).toHaveLength(2);
    expect(store.tasksByStatus('ready')).toHaveLength(1);
    expect(store.getNode(assigned[0]!.nodeId)?.running).toBe(2);
  });

  it('répartit la charge sur le nœud le moins occupé', () => {
    const n1 = scheduler.registerNode(profile('n1', 4));
    const n2 = scheduler.registerNode(profile('n2', 4));

    const p = store.createProject({ name: 'P' });
    store.createTask({ projectId: p.id, title: 'A', prompt: 'a' });
    store.createTask({ projectId: p.id, title: 'B', prompt: 'b' });
    scheduler.tick();

    // À charge égale, n1 (ordre alphabétique) prend A ; B va au nœud resté libre.
    expect(assigned.map((x) => x.nodeId)).toEqual([n1.id, n2.id]);
  });

  it('réaffecte les tâches d’un nœud mort (reap) sans consommer de tentative', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'), 1_000);
    scheduler.tick(1_000);
    expect(store.getTask(t.id)?.status).toBe('assigned');

    // 20 s plus tard sans heartbeat : le nœud est mort.
    scheduler.tick(21_000);
    expect(store.getNode(node.id)?.status).toBe('offline');
    const after = store.getTask(t.id);
    expect(after?.status).toBe('ready');
    expect(after?.assignedNodeId).toBeNull();
    expect(after?.attempts).toBe(0);
  });

  it('un heartbeat maintient le nœud en vie et le fait revivre après un reap', () => {
    const node = scheduler.registerNode(profile('n1'), 1_000);
    scheduler.heartbeat(node.id, 10_000);
    scheduler.tick(20_000); // dernier heartbeat à 10 s → pas encore mort (fenêtre 15 s)
    expect(store.getNode(node.id)?.status).toBe('online');

    scheduler.tick(40_000); // là, il est mort
    expect(store.getNode(node.id)?.status).toBe('offline');

    scheduler.heartbeat(node.id, 41_000); // il revient
    expect(store.getNode(node.id)?.status).toBe('online');
  });

  it('ignore le résultat d’un nœud dont la tâche a été réaffectée (idempotence)', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const n1 = scheduler.registerNode(profile('n1'), 1_000);
    scheduler.tick(1_000);
    expect(store.getTask(t.id)?.assignedNodeId).toBe(n1.id);

    // n1 meurt, la tâche repart en ready puis est réaffectée à n2.
    scheduler.tick(21_000);
    const n2 = scheduler.registerNode(profile('n2'), 21_000);
    scheduler.tick(21_000);
    expect(store.getTask(t.id)?.assignedNodeId).toBe(n2.id);

    // Résultat tardif de n1 (zombie) : ignoré, sans effet sur la tâche.
    const accepted = scheduler.handleTaskResult(n1.id, result(t.id));
    expect(accepted).toBe(false);
    expect(store.getTask(t.id)?.status).toBe('assigned');
    expect(store.getTask(t.id)?.assignedNodeId).toBe(n2.id);
    expect(store.resultsForTask(t.id)).toHaveLength(0);

    // Résultat légitime de n2 : accepté, une seule exécution comptabilisée.
    expect(scheduler.handleTaskResult(n2.id, result(t.id))).toBe(true);
    expect(store.getTask(t.id)?.status).toBe('done');
    expect(store.resultsForTask(t.id)).toHaveLength(1);
  });

  it('ignore un résultat dupliqué pour une tâche déjà terminée', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();

    expect(scheduler.handleTaskResult(node.id, result(t.id))).toBe(true);
    expect(scheduler.handleTaskResult(node.id, result(t.id))).toBe(false);
    expect(store.resultsForTask(t.id)).toHaveLength(1);
  });

  it('réessaie une tâche échouée puis la marque failed après 3 tentatives', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();

    // Échec 1 et 2 : la tâche repart en ready et est réassignée aussitôt.
    scheduler.handleTaskResult(node.id, result(t.id, false));
    expect(store.getTask(t.id)?.status).toBe('assigned');
    expect(store.getTask(t.id)?.attempts).toBe(1);

    scheduler.handleTaskResult(node.id, result(t.id, false));
    expect(store.getTask(t.id)?.status).toBe('assigned');
    expect(store.getTask(t.id)?.attempts).toBe(2);

    // Échec 3 : terminé, la tâche est failed.
    scheduler.handleTaskResult(node.id, result(t.id, false));
    expect(store.getTask(t.id)?.status).toBe('failed');
    expect(store.getTask(t.id)?.attempts).toBe(3);
    expect(store.getTask(t.id)?.assignedNodeId).toBeNull();
  });

  it('fait échouer en cascade les tâches dont une dépendance a échoué', () => {
    const p = store.createProject({ name: 'P' });
    const a = store.createTask({ projectId: p.id, title: 'A', prompt: 'a' });
    const b = store.createTask({ projectId: p.id, title: 'B', prompt: 'b', dependsOn: [a.id] });
    const c = store.createTask({ projectId: p.id, title: 'C', prompt: 'c', dependsOn: [b.id] });
    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();

    for (let i = 0; i < 3; i++) scheduler.handleTaskResult(node.id, result(a.id, false));

    expect(store.getTask(a.id)?.status).toBe('failed');
    expect(store.getTask(b.id)?.status).toBe('failed');
    expect(store.getTask(c.id)?.status).toBe('failed');
  });

  it('la promotion ne lit que les dépendances citées, jamais toute la table tasks', () => {
    const p = store.createProject({ name: 'P' });
    const a = store.createTask({ projectId: p.id, title: 'A', prompt: 'a' });
    store.createTask({ projectId: p.id, title: 'B', prompt: 'b', dependsOn: [a.id] });
    // 500 tâches sans rapport : un `SELECT *` de la table à chaque passe (et il
    // y en a une par nœud fauché) gelait l'orchestrateur à 100 000 tâches.
    for (let i = 0; i < 500; i++) {
      store.createTask({ projectId: p.id, title: `bruit ${i}`, prompt: 'x' });
    }
    let dépliages = 0;
    const idsLus: string[] = [];
    const vraiListTasks = store.listTasks.bind(store);
    store.listTasks = (projectId?: string) => {
      dépliages += 1;
      return vraiListTasks(projectId);
    };
    const vraisStatuts = store.taskStatuses.bind(store);
    store.taskStatuses = (ids: readonly string[]) => {
      idsLus.push(...ids);
      return vraisStatuts(ids);
    };

    scheduler.tick();

    expect(dépliages).toBe(0);
    // Seule la dépendance réellement citée est lue (une fois par passe de la
    // boucle de point fixe), jamais les 502 tâches de la table.
    expect(new Set(idsLus)).toEqual(new Set([a.id]));
    expect(idsLus.length).toBeLessThanOrEqual(4);
    expect(store.getTask(a.id)?.status).toBe('ready');
  });

  it('journalise chaque transition dans le journal d’événements', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();
    scheduler.handleTaskUpdate(node.id, t.id);
    scheduler.handleTaskResult(node.id, result(t.id));

    const types = store.listEvents().map((e) => e.type);
    expect(types).toContain('node_registered');
    expect(types).toContain('task_ready');
    expect(types).toContain('task_assigned');
    expect(types).toContain('task_started');
    expect(types).toContain('task_done');
  });

  it('émet task_progress sur un log seul (agents réels sans sous-agents)', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();

    scheduler.handleTaskUpdate(node.id, t.id, undefined, 'claude -p démarré');
    const progress = store.listEvents().filter((e) => e.type === 'task_progress');
    expect(progress).toHaveLength(1);
    expect(progress[0]!.payload.log).toBe('claude -p démarré');
  });

  it('rejectTask requalifie SANS consommer de tentative (nœud saturé)', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    // maxConcurrency 0 impossible : on force l'assignation puis on rejette.
    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();
    expect(store.getTask(t.id)?.status).toBe('assigned');

    scheduler.rejectTask(node.id, t.id, 'noeud_sature');
    const after = store.getTask(t.id);
    // Le nœud étant seul et libre, la tâche est aussitôt réassignée, mais sans
    // qu'aucune tentative n'ait été consommée.
    expect(after?.attempts).toBe(0);
    expect(store.listEvents().map((e) => e.type)).toContain('task_rejected');
  });

  it('reconcileNode requalifie les tâches orphelines d’un nœud redémarré à vide', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'));
    scheduler.tick();
    scheduler.handleTaskUpdate(node.id, t.id); // running
    expect(store.getTask(t.id)?.status).toBe('running');

    // Le nœud redémarre et ne déclare plus aucune tâche active.
    const { zombies } = scheduler.reconcileNode(node.id, []);
    expect(zombies).toEqual([]);
    // La tâche running orpheline est requalifiée (puis réassignée au même nœud).
    const types = store.listEvents().map((e) => e.type);
    expect(types).toContain('task_requeued');
    expect(store.getTask(t.id)?.attempts).toBe(0);
  });

  it('reconcileNode signale comme zombie une tâche que le nœud croit encore sienne', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const n1 = scheduler.registerNode(profile('n1'));
    scheduler.tick();
    expect(store.getTask(t.id)?.assignedNodeId).toBe(n1.id);

    // La tâche a été réaffectée ailleurs ; n1 croit encore l'exécuter.
    store.patchTask(t.id, { assignedNodeId: 'autre-noeud', status: 'running' });
    const { zombies } = scheduler.reconcileNode(n1.id, [t.id]);
    expect(zombies).toEqual([t.id]);
  });

  it('reconcileNode RÉ-ADOPTE une tâche vivante requalifiée par un blip (ne la tue pas)', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const n1 = scheduler.registerNode(profile('n1'));
    scheduler.tick();
    scheduler.handleTaskUpdate(n1.id, t.id); // running sur n1

    // Blip : la déconnexion requalifie la tâche en ready (mais le nœud continue).
    scheduler.nodeDisconnected(n1.id, 'ws_closed');
    expect(store.getTask(t.id)?.status).toBe('ready');
    expect(store.getTask(t.id)?.assignedNodeId).toBeNull();

    // Reconnexion : le nœud déclare qu'il exécute toujours T → ré-adoption.
    scheduler.registerNode(profile('n1', 1), 100);
    const { zombies } = scheduler.reconcileNode(n1.id, [t.id], 100);
    expect(zombies).toEqual([]); // AUCUN zombie : le travail est préservé
    const after = store.getTask(t.id);
    expect(after?.status).toBe('running');
    expect(after?.assignedNodeId).toBe(n1.id);
    expect(after?.attempts).toBe(0); // aucune tentative brûlée

    // Le résultat légitime du nœud est ensuite accepté (une seule exécution).
    expect(scheduler.handleTaskResult(n1.id, result(t.id))).toBe(true);
    expect(store.getTask(t.id)?.status).toBe('done');
  });

  it('rejectTask n’assigne pas aussitôt la même tâche au nœud qui vient de la refuser', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const n1 = scheduler.registerNode(profile('n1'));
    scheduler.tick();
    expect(store.getTask(t.id)?.assignedNodeId).toBe(n1.id);

    scheduler.rejectTask(n1.id, t.id, 'noeud_sature');
    // Cooldown actif : la tâche reste ready, pas de ré-assignation immédiate à n1.
    expect(store.getTask(t.id)?.status).toBe('ready');
    scheduler.tick();
    expect(store.getTask(t.id)?.status).toBe('ready');
  });
});
