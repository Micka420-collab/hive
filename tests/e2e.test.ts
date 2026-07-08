// Test d'intégration end-to-end : un orchestrateur réel (port éphémère) et
// deux nœuds simulés complètent un projet de 7 tâches avec dépendances,
// sans double exécution et sans nœud zombie. Vérifie aussi les garde-fous
// de sécurité (token, CORS).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-e2e-suffisamment-long';

/** Adaptateur instrumenté : rapide, et compte chaque exécution par tâche. */
function countingAdapter(executions: Map<string, number>): AgentAdapter {
  return {
    name: 'compteur-e2e',
    async run(task: Task) {
      executions.set(task.id, (executions.get(task.id) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 50));
      return { success: true, diff: `diff:${task.id}`, logs: 'ok', subAgents: [] };
    },
  };
}

describe('e2e : orchestrateur + 2 nœuds simulés', () => {
  let server: HiveServer;
  let dir: string;
  const executions = new Map<string, number>();
  const clients: HiveNodeClient[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-e2e-'));
    server = await createServer({
      port: 0, // port éphémère : pas de collision avec un orchestrateur local
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 100,
    });
  });

  afterAll(async () => {
    for (const c of clients) c.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    'complète un projet de 7 tâches avec dépendances, sans double exécution',
    { timeout: 30_000 },
    async () => {
      const base = `http://127.0.0.1:${server.port}`;
      const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

      // 1. Créer le projet et son DAG de 7 tâches via l'API REST.
      const projectRes = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Projet e2e' }),
      });
      expect(projectRes.status).toBe(201);
      const project = (await projectRes.json()) as { id: string };

      const tasksRes = await fetch(`${base}/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tasks: [
            { id: 't1', title: 'Échafaudage', prompt: 'scaffold' },
            { id: 't2', title: 'Schéma BDD', prompt: 'db', dependsOn: ['t1'] },
            { id: 't3', title: 'API auth', prompt: 'auth', dependsOn: ['t2'] },
            { id: 't4', title: 'API facturation', prompt: 'billing', dependsOn: ['t2'] },
            { id: 't5', title: 'Interface web', prompt: 'ui', dependsOn: ['t1'] },
            { id: 't6', title: 'Tests intégration', prompt: 'tests', dependsOn: ['t3', 't4', 't5'] },
            { id: 't7', title: 'Pipeline déploiement', prompt: 'deploy', dependsOn: ['t6'] },
          ],
        }),
      });
      expect(tasksRes.status).toBe(201);

      // 2. Démarrer 2 nœuds membres qui rejoignent la ruche en WebSocket.
      for (const name of ['ruche-alpha', 'ruche-beta']) {
        const client = new HiveNodeClient({
          url: `ws://127.0.0.1:${server.port}/ws`,
          token: TOKEN,
          name,
          ownerName: 'e2e',
          agentType: 'shell',
          maxConcurrency: 2,
          workRoot: path.join(dir, name),
          adapter: countingAdapter(executions),
          quiet: true,
        });
        client.start();
        clients.push(client);
      }

      // 3. Attendre la complétion en interrogeant l'API, comme un vrai client.
      const deadline = Date.now() + 20_000;
      let tasks: Task[] = [];
      while (Date.now() < deadline) {
        const res = await fetch(`${base}/api/state`, { headers });
        const snapshot = (await res.json()) as { tasks: Task[] };
        tasks = snapshot.tasks;
        if (tasks.length === 7 && tasks.every((t) => t.status === 'done')) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      // 4. Tout est done, et chaque tâche a été exécutée exactement une fois.
      expect(tasks).toHaveLength(7);
      for (const t of tasks) expect(t.status).toBe('done');
      expect(executions.size).toBe(7);
      for (const [taskId, count] of executions) {
        expect(count, `la tâche ${taskId} doit être exécutée exactement 1 fois`).toBe(1);
      }

      // 5. L'ordre des dépendances a été respecté.
      const doneAt = new Map(tasks.map((t) => [t.id, t.updatedAt]));
      expect(doneAt.get('t2')!).toBeGreaterThanOrEqual(doneAt.get('t1')!);
      expect(doneAt.get('t6')!).toBeGreaterThanOrEqual(doneAt.get('t3')!);
      expect(doneAt.get('t6')!).toBeGreaterThanOrEqual(doneAt.get('t4')!);
      expect(doneAt.get('t6')!).toBeGreaterThanOrEqual(doneAt.get('t5')!);
      expect(doneAt.get('t7')!).toBeGreaterThanOrEqual(doneAt.get('t6')!);

      // 6. Aucun nœud zombie : les deux nœuds sont online, plus rien ne tourne.
      const stateRes = await fetch(`${base}/api/state`, { headers });
      const snapshot = (await stateRes.json()) as {
        nodes: { status: string; running: number }[];
      };
      expect(snapshot.nodes).toHaveLength(2);
      for (const n of snapshot.nodes) {
        expect(n.status).toBe('online');
        expect(n.running).toBe(0);
      }

      // 7. Le journal d'événements retrace le cycle de vie complet.
      const eventsRes = await fetch(`${base}/api/events?limit=1000`, { headers });
      const events = (await eventsRes.json()) as { type: string }[];
      const types = new Set(events.map((e) => e.type));
      expect(types).toContain('project_created');
      expect(types).toContain('task_created');
      expect(types).toContain('node_registered');
      expect(types).toContain('task_ready');
      expect(types).toContain('task_assigned');
      expect(types).toContain('task_started');
      expect(types).toContain('task_done');
      // Aucune double exécution ni résultat périmé.
      expect(types.has('result_ignored')).toBe(false);
    },
  );

  it("refuse un token invalide sur l'API REST", async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${base}/api/state`, { headers: { 'x-hive-token': 'mauvais' } });
    expect(res.status).toBe(401);
    const res2 = await fetch(`${base}/api/state`);
    expect(res2.status).toBe(401);
  });

  it('valide les entrées : payload de projet invalide → 400', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '', injecte: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('refuse une dépendance vers une tâche inexistante', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
    const projectRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Deps invalides' }),
    });
    const project = (await projectRes.json()) as { id: string };
    const res = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: [{ title: 'X', prompt: 'x', dependsOn: ['fantome'] }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('garde-fous de sécurité au démarrage', () => {
  it('refuse de démarrer hors simulation avec le token par défaut', async () => {
    await expect(
      createServer({
        port: 0,
        host: '127.0.0.1',
        token: 'change-me',
        corsOrigins: ['http://localhost:5173'],
        dbPath: ':memory:',
        simulation: false,
      }),
    ).rejects.toThrow(/trivial/);
  });

  it('refuse un CORS wildcard', async () => {
    await expect(
      createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['*'],
        dbPath: ':memory:',
        simulation: false,
      }),
    ).rejects.toThrow(/origines/);
  });
});
