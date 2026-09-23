import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-evaluator-suffisamment-long-42';
const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-a
+b`;

describe('GET /api/tasks/:id/evaluation', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let taskId: string;
  let secondResultId: number;
  const headers = { 'x-hive-token': TOKEN, 'content-type': 'application/json' };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-evaluator-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    const project = server.store.createProject({ name: 'Evaluator', repoUrl: 'file:///repo' });
    const task = server.store.createTask({
      projectId: project.id,
      title: 'Corriger src/a.ts',
      prompt: 'corriger src/a.ts',
    });
    taskId = task.id;
    server.store.registerNode({
      nodeId: 'n1',
      name: 'codex',
      ownerName: 'test',
      agentType: 'codex',
      maxConcurrency: 1,
    });
    server.store.registerNode({
      nodeId: 'n2',
      name: 'claude',
      ownerName: 'test',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
    server.store.patchTask(task.id, { status: 'done' });
    const first = server.store.insertResult({
      taskId: task.id,
      nodeId: 'n1',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 10,
      subAgents: [],
    });
    const second = server.store.insertResult({
      taskId: task.id,
      nodeId: 'n2',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 11,
      subAgents: [],
    });
    secondResultId = second;
    server.store.enregistrerInspection({
      resultId: first,
      taskId: task.id,
      nodeId: 'n1',
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });
    server.store.enregistrerInspection({
      resultId: second,
      taskId: task.id,
      nodeId: 'n2',
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });
    server.store.setTaskReview(task.id, 'approved');
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('compose les preuves réelles et rend visibles les validations absentes', async () => {
    const response = await fetch(`${base}/api/tasks/${taskId}/evaluation`, { headers });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      decision: string;
      canMerge: boolean;
      evidence: Record<string, string>;
      reasons: string[];
    };
    expect(body.decision).toBe('additional_test_required');
    expect(body.canMerge).toBe(false);
    expect(body.evidence.consensus).toBe('elected');
    expect(body.evidence.humanReview).toBe('approved');
    expect(body.evidence.tests).toBe('missing');
    expect(body.reasons.join(' ')).toContain('tests');
  });

  it('protège la route et ne révèle pas une tâche inconnue', async () => {
    const noToken = await fetch(`${base}/api/tasks/${taskId}/evaluation`);
    expect(noToken.status).toBe(401);
    const unknown = await fetch(`${base}/api/tasks/inconnue/evaluation`, { headers });
    expect(unknown.status).toBe(404);
  });

  it('ne rattache pas une inspection retardée au résultat courant', async () => {
    const latestResultId = server.store.insertResult({
      taskId,
      nodeId: 'n2',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 12,
      subAgents: [],
    });
    server.store.enregistrerInspection({
      resultId: latestResultId,
      taskId,
      nodeId: 'n2',
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });
    // Cette relecture de l'ancienne tentative arrive après la nouvelle. Elle
    // est donc en tête de `listInspections`, tout en pointant vers `second`.
    server.store.enregistrerInspection({
      resultId: secondResultId,
      taskId,
      nodeId: 'n2',
      verdict: 'hollow',
      score: 90,
      applique: true,
      griefs: [],
    });

    const response = await fetch(`${base}/api/tasks/${taskId}/evaluation`, { headers });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      decision: string;
      evidence: Record<string, string>;
    };
    expect(body.evidence.gardiennes).toBe('clean');
    expect(body.decision).toBe('additional_test_required');
  });

  it('réenfile automatiquement un rejet humain via le verdict Evaluator borné', async () => {
    const response = await fetch(`${base}/api/tasks/${taskId}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'rejected', clientId: 'miellerie-test' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      retry?: { ok: boolean; attempt?: number; resultId?: number };
    };
    expect(body.retry?.ok).toBe(true);
    expect(body.retry?.attempt).toBe(1);
    expect(body.retry?.resultId).toBeTypeOf('number');
    expect(server.store.getTask(taskId)?.attempts).toBe(1);
    expect(
      server.store
        .listEvents()
        .some((event) => event.type === 'task_retry' && event.payload.source === 'evaluator'),
    ).toBe(true);
  });

  it("exige l'identifiant du résultat courant pour une demande de retry explicite", async () => {
    const project = server.store.createProject({
      name: 'Retry explicite',
      repoUrl: 'file:///repo',
    });
    const task = server.store.createTask({
      projectId: project.id,
      title: 'Retry exact',
      prompt: 'retry exact',
    });
    server.store.patchTask(task.id, { status: 'done' });
    const first = server.store.insertResult({
      taskId: task.id,
      nodeId: 'n1',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 10,
      subAgents: [],
    });
    const latest = server.store.insertResult({
      taskId: task.id,
      nodeId: 'n2',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 11,
      subAgents: [],
    });
    for (const [resultId, nodeId] of [
      [first, 'n1'],
      [latest, 'n2'],
    ] as const) {
      server.store.enregistrerInspection({
        resultId,
        taskId: task.id,
        nodeId,
        verdict: 'clean',
        score: 0,
        applique: false,
        griefs: [],
      });
    }
    server.store.setTaskReview(task.id, 'rejected');

    const stale = await fetch(`${base}/api/tasks/${task.id}/evaluation/retry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ resultId: first }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('stale_result');

    const current = await fetch(`${base}/api/tasks/${task.id}/evaluation/retry`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ resultId: latest }),
    });
    expect(current.status).toBe(202);
    const body = (await current.json()) as { resultId: number; attempt: number };
    expect(body.resultId).toBe(latest);
    expect(body.attempt).toBe(1);
  });
});
