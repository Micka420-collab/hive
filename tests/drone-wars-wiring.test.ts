// Câblage Drone Wars dans le scheduler : lancement d'une course, victoire du
// premier succès (perdants annulés), promotion du primaire, extinction de la
// course (échecs/refus/pertes de nœuds), annulation humaine. L'invariant
// central est vérifié partout : jamais de tâche requalifiée pendant que des
// drones volent, jamais de double comptage de résultat.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import type { Task, TaskResult } from '../src/shared/types.js';

function profile(name: string, agentType = 'shell'): NodeProfile {
  return { name, ownerName: 'test', agentType, maxConcurrency: 2 };
}

function result(taskId: string, success = true): Omit<TaskResult, 'nodeId'> {
  return {
    taskId,
    success,
    diff: success ? `diff:${taskId}` : '',
    logs: 'x',
    durationMs: 5,
    subAgents: [],
  };
}

describe('Drone Wars : câblage scheduler', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assigned: { nodeId: string; taskId: string }[];
  let cancelled: { nodeId: string; taskId: string; reason: string }[];

  beforeEach(() => {
    store = new HiveStore(':memory:');
    assigned = [];
    cancelled = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task) => assigned.push({ nodeId, taskId: task.id }),
      onCancel: (nodeId, taskId, reason) => cancelled.push({ nodeId, taskId, reason }),
    });
  });

  afterEach(() => store.close());

  /** Prépare une tâche ready + N nœuds online, sans assignation automatique. */
  function setup(nodeCount: number, agentTypes: string[] = []): { task: Task; nodes: string[] } {
    const p = store.createProject({ name: 'P' });
    const task = store.createTask({ projectId: p.id, title: 'critique', prompt: 'x' });
    store.patchTask(task.id, { status: 'ready' });
    const nodes: string[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const n = scheduler.registerNode(profile(`n${i}`, agentTypes[i] ?? 'shell'));
      nodes.push(n.id);
    }
    assigned = []; // ignorer d'éventuelles assignations du registerNode
    return { task: store.getTask(task.id)!, nodes };
  }

  it('lance jusqu à `factor` drones, primaire = 1er, diversité d agents', () => {
    const { task } = setup(4, ['claude-code', 'claude-code', 'codex', 'codex']);
    const started = scheduler.startRace(task.id, 3);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.drones).toHaveLength(3);
    // Diversité : les 2 types présents avant de doubler l'un d'eux.
    const types = started.drones.map((id) => store.getNode(id)!.agentType);
    expect(new Set(types.slice(0, 2)).size).toBe(2);
    // Le store suit le primaire ; les 3 drones ont reçu assign_task.
    const after = store.getTask(task.id)!;
    expect(after.status).toBe('assigned');
    expect(after.assignedNodeId).toBe(started.drones[0]);
    expect(assigned.map((a) => a.taskId)).toEqual([task.id, task.id, task.id]);
  });

  it('refuse une course sur une tâche non prête ou déjà en course', () => {
    const { task } = setup(2);
    expect(scheduler.startRace('inconnue', 3)).toMatchObject({ ok: false });
    scheduler.startRace(task.id, 2);
    const again = scheduler.startRace(task.id, 2);
    expect(again).toMatchObject({ ok: false });
    if (!again.ok) expect(again.error).toContain('déjà en vol');
  });

  it('premier succès gagne : résultat accepté, perdants annulés, souvenir enregistré', () => {
    const { task } = setup(3);
    const started = scheduler.startRace(task.id, 3);
    if (!started.ok) throw new Error('course non lancée');
    const [, second, third] = started.drones;

    // Le succès vient d'un drone NON-primaire : il gagne quand même.
    expect(scheduler.handleTaskResult(second!, result(task.id))).toBe(true);
    const after = store.getTask(task.id)!;
    expect(after.status).toBe('done');
    expect(after.result?.nodeId).toBe(second);
    // Les 2 autres drones encore en vol sont annulés.
    expect(cancelled.map((c) => c.nodeId).sort()).toEqual([started.drones[0]!, third!].sort());
    // Un résultat retardataire du 3e drone est ignoré (course tranchée).
    expect(scheduler.handleTaskResult(third!, result(task.id))).toBe(false);
    expect(store.resultsForTask(task.id)).toHaveLength(1);
  });

  it('échec du primaire → promotion d un autre drone, la tâche reste en vol', () => {
    const { task } = setup(3);
    const started = scheduler.startRace(task.id, 3);
    if (!started.ok) throw new Error('course non lancée');
    const [primary, second] = started.drones;

    expect(scheduler.handleTaskResult(primary!, result(task.id, false))).toBe(true);
    const after = store.getTask(task.id)!;
    expect(['assigned', 'running']).toContain(after.status);
    expect(after.assignedNodeId).not.toBe(primary);
    expect(after.attempts).toBe(0); // la course absorbe l'échec individuel
    // Le second peut encore gagner.
    expect(scheduler.handleTaskResult(second!, result(task.id))).toBe(true);
    expect(store.getTask(task.id)!.status).toBe('done');
  });

  it('tous les drones échouent avec de vrais résultats → UNE tentative brûlée (retry)', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [a, b] = started.drones;
    scheduler.handleTaskResult(a!, result(task.id, false));
    scheduler.handleTaskResult(b!, result(task.id, false));
    const after = store.getTask(task.id)!;
    expect(after.attempts).toBe(1); // une seule tentative pour toute la course
    expect(['ready', 'assigned']).toContain(after.status); // repartie dans le circuit normal
  });

  it('refus d un drone (Night Shift/saturation) : pas de tentative, cooldown, promotion', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [primary, second] = started.drones;

    scheduler.rejectTask(primary!, task.id, 'hors_service_night_shift', false, Date.now(), 60_000);
    let after = store.getTask(task.id)!;
    expect(after.assignedNodeId).toBe(second); // promotion
    expect(after.attempts).toBe(0);

    // Le dernier drone refuse aussi : course éteinte, tâche ready sans tentative.
    scheduler.rejectTask(second!, task.id, 'noeud_sature');
    after = store.getTask(task.id)!;
    expect(after.attempts).toBe(0);
    expect(['ready', 'assigned']).toContain(after.status);
  });

  it('mort du primaire (déconnexion) : promotion ; mort du dernier : requeue sans tentative', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [primary, second] = started.drones;

    scheduler.nodeDisconnected(primary!, 'ws_closed');
    let after = store.getTask(task.id)!;
    expect(after.assignedNodeId).toBe(second);
    expect(['assigned', 'running']).toContain(after.status);

    scheduler.nodeDisconnected(second!, 'ws_closed');
    after = store.getTask(task.id)!;
    expect(after.status).toBe('ready');
    expect(after.attempts).toBe(0);
  });

  it('annulation humaine : tous les drones en vol reçoivent cancel_task', () => {
    const { task } = setup(3);
    const started = scheduler.startRace(task.id, 3);
    if (!started.ok) throw new Error('course non lancée');
    scheduler.cancelTask(task.id, 'annulée par un humain');
    expect(store.getTask(task.id)!.status).toBe('failed');
    expect(cancelled).toHaveLength(3);
    // Un résultat tardif d'un drone annulé est ignoré proprement.
    expect(scheduler.handleTaskResult(started.drones[0]!, result(task.id))).toBe(false);
  });
});
