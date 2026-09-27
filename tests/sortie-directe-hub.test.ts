// LA SORTIE EN DIRECT AU HUB — relayée, jamais journalisée, et seulement par
// qui a le droit de parler pour la tâche.
//
// Le journal est élagué PAR NOMBRE (`EVENT_RETENTION`) : quatre morceaux par
// seconde journalisés auraient effacé, en une exécution bavarde, l'histoire de
// la ruche. Et un morceau arrivé derrière le résultat — ou d'un nœud à qui la
// tâche n'appartient plus — ne doit pas rouvrir une console déjà vidée.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { parseClientMessage, parseServerMessage, LIMITS } from '../src/shared/protocol.js';

const profil = (name: string) => ({
  name,
  ownerName: 'banc',
  agentType: 'shell',
  maxConcurrency: 1,
});

let dossier = '';
let store: HiveStore;
let relayes: Array<{ taskId: string; nodeId: string; sortie: string }>;
let scheduler: Scheduler;

beforeEach(() => {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-sortie-hub-'));
  store = new HiveStore(path.join(dossier, 'hive.db'));
  relayes = [];
  scheduler = new Scheduler(store, {
    simulation: true,
    onSortie: (taskId, nodeId, sortie) => relayes.push({ taskId, nodeId, sortie }),
  });
});

afterEach(() => {
  store.close();
  rmSync(dossier, { recursive: true, force: true });
});

describe('Scheduler.handleTaskUpdate — la sortie en direct', () => {
  it('RELAYÉE au serveur, SANS un seul événement au journal', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const n = scheduler.registerNode(profil('n1'));
    scheduler.tick();
    scheduler.handleTaskUpdate(n.id, t.id); // running
    const avant = store.countEvents();

    for (let i = 0; i < 50; i += 1) {
      scheduler.handleTaskUpdate(n.id, t.id, undefined, undefined, undefined, `ligne ${i}\n`);
    }

    expect(relayes).toHaveLength(50);
    expect(relayes[0]).toEqual({ taskId: t.id, nodeId: n.id, sortie: 'ligne 0\n' });
    expect(store.countEvents()).toBe(avant);
  });

  it('ni après le résultat, ni depuis un nœud à qui la tâche n’appartient pas', () => {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'T', prompt: 't' });
    const n1 = scheduler.registerNode(profil('n1'));
    scheduler.tick();
    const n2 = scheduler.registerNode(profil('n2'));
    scheduler.handleTaskUpdate(n1.id, t.id);

    scheduler.handleTaskUpdate(n2.id, t.id, undefined, undefined, undefined, 'intrus\n');
    scheduler.handleTaskResult(n1.id, {
      taskId: t.id,
      success: true,
      diff: '',
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    scheduler.handleTaskUpdate(n1.id, t.id, undefined, undefined, undefined, 'posthume\n');

    expect(relayes).toEqual([]);
  });
});

describe('protocole — sortie bornée dans les deux sens', () => {
  it('task_update : une sortie au-delà de la borne fait tomber le message', () => {
    const base = { type: 'task_update', taskId: 'tache-1', status: 'running' };
    expect(parseClientMessage(JSON.stringify({ ...base, sortie: 'ok\n' }))).toMatchObject({
      sortie: 'ok\n',
    });
    expect(
      parseClientMessage(JSON.stringify({ ...base, sortie: 'x'.repeat(LIMITS.sortie + 1) })),
    ).toBeNull();
  });

  it('task_output : validé côté écran comme ce qu’un nœud a le droit d’envoyer', () => {
    const base = { type: 'task_output', taskId: 'tache-1', nodeId: 'noeud-1' };
    expect(parseServerMessage(JSON.stringify({ ...base, sortie: 'ok\n' }))).toEqual({
      ...base,
      sortie: 'ok\n',
    });
    expect(
      parseServerMessage(JSON.stringify({ ...base, sortie: 'x'.repeat(LIMITS.sortie + 1) })),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ ...base, taskId: '../x', sortie: 'ok' })),
    ).toBeNull();
  });
});
