import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'workers-endpoint-token';
const headers = { 'x-hive-token': TOKEN };

describe('GET /api/workers', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(): Promise<string> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-workers-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    return `http://127.0.0.1:${server.port}`;
  }

  it('refuse une lecture sans jeton', async () => {
    const base = await demarrer();
    const response = await fetch(`${base}/api/workers`);

    expect(response.status).toBe(401);
  });

  it('expose les nœuds réels et les modèles à explorer', async () => {
    const base = await demarrer();
    server!.store.registerNode({
      nodeId: 'worker-1',
      name: 'poste-1',
      ownerName: 'micka',
      agentType: 'claude-code',
      maxConcurrency: 2,
      modeles: ['claude-sonnet'],
    });
    const project = server!.store.createProject({ name: 'Projet' });
    const task = server!.store.createTask({
      id: 'task-observed',
      projectId: project.id,
      title: 'Implémenter endpoint',
      prompt: 'ajouter la route',
    });
    server!.store.poserModeleAiguillage(task.id, 'claude-sonnet', 10);
    const resultId = server!.store.insertResult({
      taskId: task.id,
      nodeId: 'worker-1',
      diff: 'diff --git a/src/api.ts b/src/api.ts',
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 12,
      subAgents: [],
    });
    server!.store.appendEvent('contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId: task.id,
      resultId,
      producteurModele: 'claude-sonnet',
      relecture: 'review-worker-1',
      relecteur: 'codex',
      reviewerNodeId: 'reviewer-1',
      conteste: false,
      objections: [],
      recordedAt: 11,
    });
    server!.store.enregistrerContreVisite({
      productionTaskId: task.id,
      suite: 'appliquer',
      raison: 'ok',
      visiteurNodeId: 'reviewer-1',
      visiteurAgent: 'shell',
      now: 11,
    });

    const response = await fetch(`${base}/api/workers`, { headers });
    const body = (await response.json()) as {
      workers: Array<{
        id: string;
        slotsLibres: number;
        modeles?: Array<{
          modele: string;
          categories: Record<string, { exploration: boolean; essais: number }>;
          reputation: { essais: number; moyenne: number | null; attribution: string };
        }>;
        reputation: { essais: number; moyenne: number | null; attribution: string };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.workers).toHaveLength(1);
    expect(body.workers[0]).toMatchObject({ id: 'worker-1', slotsLibres: 2 });
    expect(body.workers[0]?.modeles?.[0]?.modele).toBe('claude-sonnet');
    expect(body.workers[0]?.modeles?.[0]?.categories.code?.exploration).toBe(false);
    expect(body.workers[0]?.modeles?.[0]?.categories.code?.essais).toBe(1);
    expect(body.workers[0]?.reputation).toMatchObject({
      essais: 1,
      moyenne: 1,
      attribution: 'exacte',
    });
    expect(body.workers[0]?.modeles?.[0]?.reputation).toMatchObject({
      essais: 1,
      moyenne: 1,
      attribution: 'exacte',
    });
  });

  it('expose le travail actif sans divulguer le prompt', async () => {
    const base = await demarrer();
    server!.store.registerNode({
      nodeId: 'worker-live',
      name: 'poste-live',
      ownerName: 'micka',
      agentType: 'claude-code',
      maxConcurrency: 2,
    });
    const project = server!.store.createProject({ name: 'Projet live' });
    const task = server!.store.createTask({
      id: 'task-live',
      projectId: project.id,
      title: 'Corriger le flux',
      prompt: 'secret qui ne doit pas apparaître dans la projection Worker',
    });
    server!.store.patchTask(task.id, {
      status: 'running',
      assignedNodeId: 'worker-live',
      attempts: 2,
      branch: 'hive/task-live',
    });

    const response = await fetch(`${base}/api/workers`, { headers });
    const body = (await response.json()) as {
      workers: Array<{
        currentTasks: Array<{
          id: string;
          title: string;
          status: string;
          attempts: number;
          branch: string | null;
          updatedAt: number;
          prompt?: string;
        }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.workers[0]?.currentTasks).toEqual([
      expect.objectContaining({
        id: 'task-live',
        title: 'Corriger le flux',
        status: 'running',
        attempts: 2,
        branch: 'hive/task-live',
      }),
    ]);
    expect(body.workers[0]?.currentTasks[0]).not.toHaveProperty('prompt');
  });
});
