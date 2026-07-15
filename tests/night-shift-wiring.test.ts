// Câblage Night Shift dans le nœud : hors des heures de service (HIVE_SHIFT),
// le nœud REFUSE l'assignation (task_reject) sans brûler de tentative — la
// tâche reste dans la ruche, prête pour un autre nœud ou un autre horaire.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-nightshift-suffisamment-long';

/** Fenêtre de service de 1 h, décalée de +2 h : toujours fermée « maintenant ». */
function closedWindowNow(): string {
  const h = new Date().getHours();
  return `${(h + 2) % 24}-${(h + 3) % 24}`;
}

function neverAdapter(calls: { count: number }): AgentAdapter {
  return {
    name: 'jamais-appele',
    async run() {
      calls.count++;
      return { success: true, diff: '', logs: 'ne devrait jamais tourner', subAgents: [] };
    },
  };
}

describe('Night Shift câblé dans le nœud', () => {
  let server: HiveServer;
  let client: HiveNodeClient;
  let dir: string;
  let base: string;
  const calls = { count: 0 };
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
  let previousShift: string | undefined;

  beforeAll(async () => {
    previousShift = process.env.HIVE_SHIFT;
    process.env.HIVE_SHIFT = closedWindowNow();
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-shift-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 100,
    });
    base = `http://127.0.0.1:${server.port}`;
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'noctambule',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 2,
      workRoot: path.join(dir, 'noctambule'),
      adapter: neverAdapter(calls),
      quiet: true,
    });
    client.start();
  });

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
    if (previousShift === undefined) delete process.env.HIVE_SHIFT;
    else process.env.HIVE_SHIFT = previousShift;
  });

  it(
    "hors service : l'agent ne tourne jamais et aucune tentative n'est brûlée",
    { timeout: 15_000 },
    async () => {
      const res = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Nuit calme' }),
      });
      const project = (await res.json()) as { id: string };
      await fetch(`${base}/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: [{ title: 'attendre l aube', prompt: 'plus tard' }] }),
      });
      // Plusieurs ticks du scheduler : assignation → refus → requalification…
      await new Promise((r) => setTimeout(r, 2_000));
      const state = await fetch(`${base}/api/state`, { headers });
      const snapshot = (await state.json()) as { tasks: Task[] };
      const task = snapshot.tasks.find((t) => t.projectId === project.id)!;
      expect(calls.count).toBe(0); // l'agent n'a jamais été invoqué
      expect(task.attempts).toBe(0); // aucune tentative brûlée
      expect(['ready', 'assigned', 'pending']).toContain(task.status); // jamais failed
    },
  );
});
