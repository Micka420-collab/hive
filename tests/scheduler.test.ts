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

  it('promeut pending → ready quand toutes les dépendances sont done', () => {
    const p = store.createProject({ name: 'P' });
    const a = store.createTask({ projectId: p.id, title: 'A', prompt: 'a' });
    const b = store.createTask({ projectId: p.id, title: 'B', prompt: 'b', dependsOn: [a.id] });

    scheduler.tick();
    expect(store.getTask(a.id)?.status).toBe('ready');
    expect(store.getTask(b.id)?.status).toBe('pending');

    const node = scheduler.registerNode(profile('n1'));
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
    expect(store.getTask(t.id)?.assignedNodeId).toBe(n1.id);

    // n1 meurt, la tâche repart en ready puis est réaffectée à n2.
    scheduler.tick(21_000);
    const n2 = scheduler.registerNode(profile('n2'), 21_000);
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

    expect(scheduler.handleTaskResult(node.id, result(t.id))).toBe(true);
    expect(scheduler.handleTaskResult(node.id, result(t.id))).toBe(false);
    expect(store.resultsForTask(t.id)).toHaveLength(1);
  });

  it('réessaie une tâche échouée puis la marque failed après 3 tentatives', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'));

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

    for (let i = 0; i < 3; i++) scheduler.handleTaskResult(node.id, result(a.id, false));

    expect(store.getTask(a.id)?.status).toBe('failed');
    expect(store.getTask(b.id)?.status).toBe('failed');
    expect(store.getTask(c.id)?.status).toBe('failed');
  });

  it('journalise chaque transition dans le journal d’événements', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const node = scheduler.registerNode(profile('n1'));
    scheduler.handleTaskUpdate(node.id, t.id);
    scheduler.handleTaskResult(node.id, result(t.id));

    const types = store.listEvents().map((e) => e.type);
    expect(types).toContain('node_registered');
    expect(types).toContain('task_ready');
    expect(types).toContain('task_assigned');
    expect(types).toContain('task_started');
    expect(types).toContain('task_done');
  });
});
