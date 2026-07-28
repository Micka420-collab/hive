// Tests de résilience : reconnexion d'un nœud après redémarrage de
// l'orchestrateur (même identité), annulation d'une tâche en cours
// d'exécution, et workspace git réel (clone + branche isolée + diff).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { prepareWorkspace } from '../src/node-client/workspace.js';
import { createServer } from '../src/orchestrator/server.js';
import type { ServerConfig } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-resilience-suffisant';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

const config = (dbPath: string, port = 0): ServerConfig => ({
  port,
  host: '127.0.0.1',
  token: TOKEN,
  corsOrigins: ['http://localhost:5173'],
  dbPath,
  simulation: false,
  tickMs: 100,
});

/**
 * fetch avec retry : après un redémarrage du serveur, les connexions keep-alive
 * du pool undici pointent vers des sockets morts (ECONNRESET) — on réessaie.
 */
async function fetchJson<T>(url: string, init?: RequestInit, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 200 * i));
    }
  }
}

async function createProjectWithTask(
  base: string,
  title: string,
): Promise<{ projectId: string; taskId: string }> {
  const project = await fetchJson<{ id: string }>(`${base}/api/projects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `Projet ${title}` }),
  });
  const tasks = await fetchJson<Task[]>(`${base}/api/projects/${project.id}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tasks: [{ title, prompt: 'travail' }] }),
  });
  return { projectId: project.id, taskId: (tasks[0] as Task).id };
}

async function taskStatus(base: string, taskId: string): Promise<string | undefined> {
  try {
    const snapshot = await fetchJson<{ tasks: Task[] }>(`${base}/api/state`, { headers }, 1);
    return snapshot.tasks.find((t) => t.id === taskId)?.status;
  } catch {
    return undefined; // serveur en cours de redémarrage
  }
}

async function waitFor(
  cond: () => Promise<boolean> | boolean,
  timeoutMs: number,
  stepMs = 150,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`condition non atteinte en ${timeoutMs} ms`);
}

describe('résilience', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-resil-'));
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Objets git en lecture seule sous Windows : sans gravité pour un tmpdir.
    }
  });

  it(
    "un nœud se reconnecte après un redémarrage de l'orchestrateur et reprend le travail",
    { timeout: 40_000 },
    async () => {
      const dbPath = path.join(dir, 'reconnect.db');
      const fast: AgentAdapter = {
        name: 'rapide',
        async run() {
          await new Promise((r) => setTimeout(r, 30));
          return { success: true, diff: '', logs: 'ok', subAgents: [] };
        },
      };

      let server = await createServer(config(dbPath));
      const port = server.port;
      const base = `http://127.0.0.1:${port}`;
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${port}/ws`,
        token: TOKEN,
        name: 'phenix',
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: 'node-phenix',
        workRoot: path.join(dir, 'phenix'),
        adapter: fast,
        quiet: true,
      });
      client.start();

      try {
        // Avant le redémarrage : une première tâche aboutit normalement.
        const t1 = await createProjectWithTask(base, 'avant-redemarrage');
        await waitFor(async () => (await taskStatus(base, t1.taskId)) === 'done', 10_000);

        // Redémarrage de l'orchestrateur : même port, même base SQLite.
        await server.stop();
        server = await createServer(config(dbPath, port));
        await waitFor(async () => {
          try {
            return (await fetch(`${base}/api/health`)).ok;
          } catch {
            return false;
          }
        }, 10_000);

        // Le client se reconnecte seul (backoff) et traite une nouvelle tâche.
        const t2 = await createProjectWithTask(base, 'apres-redemarrage');
        await waitFor(async () => (await taskStatus(base, t2.taskId)) === 'done', 20_000);

        // Même identité : un seul nœud connu, en ligne, pas de doublon.
        const snapshot = await fetchJson<{ nodes: { id: string; status: string }[] }>(
          `${base}/api/state`,
          { headers },
        );
        expect(snapshot.nodes).toHaveLength(1);
        expect((snapshot.nodes[0] as { id: string }).id).toBe('node-phenix');
        expect((snapshot.nodes[0] as { status: string }).status).toBe('online');
      } finally {
        client.stop();
        await server.stop();
      }
    },
  );

  it(
    'annule une tâche en cours : le nœud abandonne et la tâche passe failed',
    { timeout: 20_000 },
    async () => {
      const flags = { aborted: false };
      const slow: AgentAdapter = {
        name: 'lent',
        run: (_task, ctx) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => resolve({ success: true, diff: '', logs: 'trop tard', subAgents: [] }),
              8_000,
            );
            ctx.signal.addEventListener(
              'abort',
              () => {
                flags.aborted = true;
                clearTimeout(timer);
                reject(new Error('tâche annulée'));
              },
              { once: true },
            );
          }),
      };

      const server = await createServer(config(path.join(dir, 'cancel.db')));
      const base = `http://127.0.0.1:${server.port}`;
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token: TOKEN,
        name: 'lente',
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: 'node-lent',
        workRoot: path.join(dir, 'lente'),
        adapter: slow,
        quiet: true,
      });
      client.start();

      try {
        const { taskId } = await createProjectWithTask(base, 'longue-a-annuler');
        await waitFor(async () => (await taskStatus(base, taskId)) === 'running', 10_000);

        // Pas de content-type json : le POST d'annulation n'a pas de corps.
        const res = await fetch(`${base}/api/tasks/${taskId}/cancel`, {
          method: 'POST',
          headers: { 'x-hive-token': TOKEN },
        });
        expect(res.status).toBe(200);

        await waitFor(async () => (await taskStatus(base, taskId)) === 'failed', 5_000);
        await waitFor(() => flags.aborted, 5_000);

        // Une deuxième annulation est refusée proprement.
        const again = await fetch(`${base}/api/tasks/${taskId}/cancel`, {
          method: 'POST',
          headers: { 'x-hive-token': TOKEN },
        });
        expect(again.status).toBe(409);

        // Le journal trace l'annulation.
        const evRes = await fetch(`${base}/api/events?limit=1000`, { headers });
        const events = (await evRes.json()) as { type: string }[];
        expect(events.map((e) => e.type)).toContain('task_cancelled');
      } finally {
        client.stop();
        await server.stop();
      }
    },
  );

  it(
    'clone un dépôt local, travaille sur hive/<taskId> et remonte un diff pour revue',
    { timeout: 30_000 },
    async () => {
      // Dépôt d'origine local avec un commit initial.
      const origin = path.join(dir, 'origin');
      mkdirSync(origin, { recursive: true });
      const repo = simpleGit({ baseDir: origin });
      await repo.init();
      await repo.addConfig('user.email', 'test@hive.local');
      await repo.addConfig('user.name', 'Hive Test');
      await repo.addConfig('commit.gpgsign', 'false');
      writeFileSync(path.join(origin, 'README.md'), '# Origine\n');
      await repo.add('.');
      await repo.commit('initial');

      const task: Task = {
        id: 'tache-git',
        projectId: 'p',
        title: 'Git réel',
        prompt: 'x',
        status: 'assigned',
        dependsOn: [],
        assignedNodeId: 'n',
        result: null,
        branch: null,
        attempts: 0,
        createdAt: 0,
        updatedAt: 0,
      };
      const ws = await prepareWorkspace(path.join(dir, 'wsroot'), task, origin);

      // Une tâche = une branche isolée, jamais de travail sur main.
      expect(ws.branch).toBe('hive/tache-git');
      expect(ws.git).not.toBeNull();
      const branches = await ws.git?.branchLocal();
      expect(branches?.current).toBe('hive/tache-git');

      // Un fichier créé par « l'agent » apparaît dans le diff de revue.
      writeFileSync(path.join(ws.cwd, 'nouveau.txt'), 'contenu butiné\n');
      const diff = await ws.collectDiff();
      expect(diff).toContain('nouveau.txt');
      expect(diff).toContain('contenu butiné');

      ws.cleanup();
    },
  );
});
