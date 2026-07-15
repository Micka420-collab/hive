// Test d'intégration du contrat Drone Wars consommé par le dashboard :
// POST /api/tasks/:id/race (lancement), GET /api/races (courses en vol,
// badge ⚔ + carte Essaim), GET /api/tasks/:id/race (course en vol puis
// victoire retrouvée au journal une fois la course tranchée).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { DroneRace } from '../src/orchestrator/drone-wars.js';

const TOKEN = 'jeton-courses-suffisamment-long';

interface RaceGet {
  race: DroneRace | null;
  victory: { nodeId: string; cancelled: number } | null;
}

describe('Drone Wars — contrat HTTP races/victory', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let taskId: string;
  let drones: string[];
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-races-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000, // pas de tick pendant le test : la course reste sous contrôle
    });
    base = `http://127.0.0.1:${server.port}`;

    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Projet Courses' }),
    });
    const project = (await res.json()) as { id: string };
    const created = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: [{ title: 'tâche critique', prompt: 'faire vite' }] }),
    });
    const [task] = (await created.json()) as { id: string }[];
    taskId = task!.id;
    // Prête + 2 nœuds en ligne, sans passer par le WS : le scheduler est
    // exposé par le serveur (même approche que la démo).
    server.store.patchTask(taskId, { status: 'ready' });
    for (const name of ['course-alpha', 'course-beta']) {
      server.scheduler.registerNode({
        name,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 2,
      });
    }
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('exige le token sur GET /api/races', async () => {
    const res = await fetch(`${base}/api/races`);
    expect(res.status).toBe(401);
  });

  it('POST race lance la course, GET /api/races la liste, GET race la détaille', async () => {
    const started = await fetch(`${base}/api/tasks/${taskId}/race`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ factor: 2 }),
    });
    expect(started.status).toBe(202);
    const body = (await started.json()) as { taskId: string; drones: string[] };
    expect(body.taskId).toBe(taskId);
    expect(body.drones).toHaveLength(2);
    drones = body.drones;

    const list = await fetch(`${base}/api/races`, { headers });
    const { races } = (await list.json()) as { races: DroneRace[] };
    expect(races).toHaveLength(1);
    expect(races[0]?.taskId).toBe(taskId);
    expect(races[0]?.drones.map((d) => d.status)).toEqual(['running', 'running']);

    const one = (await (
      await fetch(`${base}/api/tasks/${taskId}/race`, { headers })
    ).json()) as RaceGet;
    expect(one.race?.taskId).toBe(taskId);
    expect(one.victory).toBeNull();
  });

  it('après la victoire : race null, victory reconstruite du journal, liste vide', async () => {
    // Le 2e drone gagne (résultat injecté au scheduler, comme un task_result WS).
    const winner = drones[1]!;
    server.scheduler.handleTaskResult(winner, {
      taskId,
      success: true,
      diff: 'diff:course',
      logs: 'ok',
      durationMs: 7,
      subAgents: [],
    });

    const one = (await (
      await fetch(`${base}/api/tasks/${taskId}/race`, { headers })
    ).json()) as RaceGet;
    expect(one.race).toBeNull();
    expect(one.victory).toEqual({ nodeId: winner, cancelled: 1 });

    const list = await fetch(`${base}/api/races`, { headers });
    const { races } = (await list.json()) as { races: DroneRace[] };
    expect(races).toEqual([]);
  });

  it('une tâche terminée sans course n a pas de victoire fantôme', async () => {
    // Nouvelle tâche passée done par le circuit mono-nœud classique.
    const created = await fetch(
      `${base}/api/projects/${server.store.listProjects()[0]!.id}/tasks`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: [{ title: 'tâche mono', prompt: 'faire' }] }),
      },
    );
    const [mono] = (await created.json()) as { id: string }[];
    server.store.patchTask(mono!.id, { status: 'done' });

    const one = (await (
      await fetch(`${base}/api/tasks/${mono!.id}/race`, { headers })
    ).json()) as RaceGet;
    expect(one.race).toBeNull();
    expect(one.victory).toBeNull();
  });
});
