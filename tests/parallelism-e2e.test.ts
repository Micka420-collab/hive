// Preuve d'orchestration réelle : plusieurs tâches prêtes partent ensemble
// vers plusieurs Workers connectés, restent en vol jusqu'à leur achèvement,
// puis la tâche suivante peut reprendre. Ce test ne simule pas le scheduler :
// il traverse le serveur et les WebSockets comme une ruche en production.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-parallelisme-suffisamment-long';

type Start = { taskId: string; worker: string; at: number };

type Barrier = {
  entered: Set<string>;
  starts: Start[];
  allEntered: Promise<void>;
  release: () => void;
  enter: (taskId: string, worker: string) => void;
  waitForRelease: () => Promise<void>;
};

function barrierPour(count: number): Barrier {
  let resolveEntered!: () => void;
  let resolveReleased!: () => void;
  let enteredResolved = false;
  const allEntered = new Promise<void>((resolve) => {
    resolveEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resolveReleased = resolve;
  });
  const entered = new Set<string>();
  const starts: Start[] = [];
  return {
    entered,
    starts,
    allEntered,
    release: resolveReleased,
    enter: (taskId, worker) => {
      entered.add(taskId);
      starts.push({ taskId, worker, at: Date.now() });
      if (!enteredResolved && entered.size >= count) {
        enteredResolved = true;
        resolveEntered();
      }
    },
    waitForRelease: () => released,
  };
}

function adapterParallele(worker: string, barrier: Barrier): AgentAdapter {
  return {
    name: `parallel-${worker}`,
    async run(task: Task) {
      barrier.enter(task.id, worker);
      await barrier.waitForRelease();
      return {
        success: true,
        diff: '',
        logs: `travail parallèle ${worker}`,
        subAgents: [],
      };
    },
  };
}

describe('e2e : parallélisme réel du scheduler', () => {
  let server: HiveServer | null = null;
  let root: string | null = null;
  const clients: HiveNodeClient[] = [];

  afterEach(async () => {
    for (const client of clients) client.stop();
    clients.length = 0;
    await server?.stop();
    if (root) rmSync(root, { recursive: true, force: true });
    server = null;
    root = null;
  });

  it(
    'assigne deux tâches indépendantes à deux Workers avant leur libération',
    { timeout: 30_000 },
    async () => {
      root = mkdtempSync(path.join(os.tmpdir(), 'hive-parallelism-'));
      const count = 2;
      const barrier = barrierPour(count);

      const hive = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(root, 'hive.db'),
        simulation: false,
        tickMs: 20,
      });
      server = hive;

      for (const [worker, nodeId] of [
        ['worker-a', 'parallel-a'],
        ['worker-b', 'parallel-b'],
      ] as const) {
        const client = new HiveNodeClient({
          url: `ws://127.0.0.1:${hive.port}/ws`,
          token: TOKEN,
          name: worker,
          ownerName: 'parallelism-e2e',
          agentType: 'custom',
          nodeId,
          maxConcurrency: 1,
          workRoot: path.join(root, worker),
          adapter: adapterParallele(worker, barrier),
          quiet: true,
        });
        client.start();
        clients.push(client);
      }

      const deadline = Date.now() + 10_000;
      while (
        Date.now() < deadline &&
        hive.store.listNodes().filter((node) => node.status === 'online').length < count
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(hive.store.listNodes().filter((node) => node.status === 'online')).toHaveLength(count);

      const project = hive.store.createProject({ name: 'Parallélisme e2e' });
      const first = hive.store.createTask({
        projectId: project.id,
        title: 'Indexer les profils dans src/profils.ts',
        prompt: 'construire le module profils pour la recherche utilisateur',
      });
      const second = hive.store.createTask({
        projectId: project.id,
        title: 'Rafraîchir le tableau dans src/tableau.ts',
        prompt: 'construire le composant tableau pour visualiser les métriques',
      });
      hive.store.patchTask(first.id, { status: 'ready' });
      hive.store.patchTask(second.id, { status: 'ready' });

      await Promise.race([
        barrier.allEntered,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('les deux Workers ne sont pas entrés en parallèle')),
            10_000,
          ),
        ),
      ]);
      expect(barrier.entered).toEqual(new Set([first.id, second.id]));
      expect(new Set(barrier.starts.map((start) => start.worker))).toEqual(
        new Set(['worker-a', 'worker-b']),
      );
      expect(
        hive.store
          .listNodes()
          .map((node) => node.running)
          .sort(),
      ).toEqual([1, 1]);
      const runningDeadline = Date.now() + 2_000;
      while (
        Date.now() < runningDeadline &&
        (hive.store.getTask(first.id)?.status !== 'running' ||
          hive.store.getTask(second.id)?.status !== 'running')
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(hive.store.getTask(first.id)?.status).toBe('running');
      expect(hive.store.getTask(second.id)?.status).toBe('running');

      // Les deux adaptateurs sont encore bloqués : l'assignation est donc
      // prouvée par deux Workers distincts simultanément en vol, pas par deux
      // tâches exécutées l'une après l'autre avec des timestamps proches.
      barrier.release();
      const doneDeadline = Date.now() + 10_000;
      while (
        Date.now() < doneDeadline &&
        (hive.store.getTask(first.id)?.status !== 'done' ||
          hive.store.getTask(second.id)?.status !== 'done')
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(hive.store.getTask(first.id)?.status).toBe('done');
      expect(hive.store.getTask(second.id)?.status).toBe('done');
      expect(hive.store.resultsForTask(first.id)).toHaveLength(1);
      expect(hive.store.resultsForTask(second.id)).toHaveLength(1);
      expect(hive.store.listNodes().map((node) => node.running)).toEqual([0, 0]);

      const events = hive.store.listEvents();
      const assignments = events.filter(
        (event) =>
          event.type === 'task_assigned' &&
          [first.id, second.id].includes(String(event.payload.taskId)),
      );
      expect(assignments).toHaveLength(2);
      expect(new Set(assignments.map((event) => String(event.payload.nodeId)))).toEqual(
        new Set(['parallel-a', 'parallel-b']),
      );
      expect(
        events.some(
          (event) =>
            event.type === 'task_retry' ||
            event.type === 'task_reject' ||
            event.type === 'result_ignored',
        ),
      ).toBe(false);
    },
  );
});
