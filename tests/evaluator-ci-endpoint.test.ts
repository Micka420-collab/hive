import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Fetcheur } from '../src/orchestrator/github.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-evaluator-ci-suffisamment-long-42';
const headers = { 'x-hive-token': TOKEN, 'content-type': 'application/json' };

describe('POST /api/tasks/:id/evaluation/ci', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let taskId: string;
  let resultId: number;
  let headRef = '';
  const CI_VERTE = [
    {
      name: 'CI · Tests · Typecheck · Build · Lint',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.test/check/1',
    },
  ];
  let checkRuns: Record<string, unknown>[] = CI_VERTE;
  const previousToken = process.env.HIVE_GITHUB_TOKEN;

  const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const githubFetcher: Fetcheur = async (url) => {
    if (url.endsWith('/pulls/7')) {
      return json({
        state: 'open',
        merged: false,
        mergeable: true,
        head: { sha: 'abc123', ref: headRef },
      });
    }
    if (url.includes('/commits/abc123/check-runs')) return json({ check_runs: checkRuns });
    if (url.endsWith('/pulls/7/reviews?per_page=100')) return json([]);
    return json({ message: 'route GitHub inattendue' }, 404);
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-evaluator-ci-'));
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-de-test';
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
      githubFetcher,
    });
    base = `http://127.0.0.1:${server.port}`;

    const project = server.store.createProject({
      name: 'Evaluator CI',
      repoUrl: 'https://github.com/o/r',
    });
    const task = server.store.createTask({
      projectId: project.id,
      title: 'Prouver la CI',
      prompt: 'enregistrer les validations GitHub',
    });
    taskId = task.id;
    headRef = `hive/${task.id}`;
    server.store.patchTask(task.id, { status: 'done', branch: headRef });
    server.store.registerNode({
      nodeId: 'n-ci',
      name: 'codex',
      ownerName: 'test',
      agentType: 'codex',
      maxConcurrency: 1,
    });
    resultId = server.store.insertResult({
      taskId,
      nodeId: 'n-ci',
      diff: 'diff --git a/a.ts b/a.ts\n+a\n-b',
      logs: '',
      success: true,
      durationMs: 1,
      subAgents: [],
    });
    server.store.setLivraison({
      taskId,
      projectId: project.id,
      depot: 'o/r',
      pr: 7,
      branche: headRef,
      etat: 'ouverte',
    });
    server.store.appendEvent('delivery_opened', {
      taskId,
      projectId: project.id,
      pr: 7,
      branch: headRef,
      commitSha: 'abc123',
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
    if (previousToken === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = previousToken;
  });

  it('persiste la preuve liée au résultat et la réutilise dans le GET', async () => {
    const response = await fetch(`${base}/api/tasks/${taskId}/evaluation/ci`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ resultId }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      validation: Record<string, string>;
      provenance: { commitSha: string; branch: string; resultId: number };
      evaluation: { evidence: Record<string, string> };
    };
    expect(body.validation).toEqual({
      tests: 'passed',
      typecheck: 'passed',
      build: 'passed',
      lint: 'passed',
    });
    expect(body.provenance).toMatchObject({
      commitSha: 'abc123',
      branch: headRef,
      resultId,
    });
    expect(body.evaluation.evidence.validationProvenance).toMatchObject({
      commitSha: 'abc123',
      resultId,
    });

    const reread = await fetch(`${base}/api/tasks/${taskId}/evaluation`, { headers });
    expect(reread.status).toBe(200);
    const evaluation = (await reread.json()) as {
      evidence: Record<string, string>;
    };
    expect(evaluation.evidence.tests).toBe('passed');
    expect(evaluation.evidence.validationProvenance).toMatchObject({
      source: 'github_pull_request',
      commitSha: 'abc123',
      resultId,
    });
    expect(server.store.latestValidation(taskId, resultId)?.provenance).toMatchObject({
      source: 'github_pull_request',
      commitSha: 'abc123',
    });
  });

  it('refuse de ranger une preuve si la branche de la PR ne correspond plus', async () => {
    const eventsBefore = server.store.countEvents();
    headRef = 'main';
    const response = await fetch(`${base}/api/tasks/${taskId}/evaluation/ci`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ resultId }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('provenance_mismatch');
    expect(server.store.countEvents()).toBe(eventsBefore);
    headRef = `hive/${taskId}`;
  });

  // ─── UN INCONNU N'ÉCRASE PAS UN CONNU ───────────────────────────────────────
  //
  // La preuve la plus récente gouverne, entière. Ranger une CI qui tourne
  // encore — ou une PR sans contrôle lisible — mettait quatre `missing`
  // par-dessus les verdicts du bac Hive, et l'Evaluator repassait en
  // `additional_test_required` sans retour possible.
  it.each([
    [
      'une CI qui tourne encore',
      [{ name: 'CI · Tests', status: 'in_progress', conclusion: null, html_url: 'https://g/1' }],
      'ci_running',
    ],
    [
      'une PR sans contrôle lisible',
      [
        {
          name: 'Deploy preview',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://g/2',
        },
      ],
      'ci_without_verdict',
    ],
  ])('ne range pas %s par-dessus les verdicts du bac', async (_cas, controles, code) => {
    server.store.appendEvent('validation_recorded', {
      source: 'hive_sandbox',
      taskId,
      projectId: server.store.getTask(taskId)?.projectId,
      resultId,
      nodeId: 'n-ci',
      validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
      details: {
        tests: { raison: 'termine', script: 'test', code: 0 },
        typecheck: { raison: 'termine', script: 'typecheck', code: 0 },
        build: { raison: 'termine', script: 'build', code: 0 },
        lint: { raison: 'termine', script: 'lint', code: 0 },
      },
      recordedAt: Date.now(),
    });
    const eventsBefore = server.store.countEvents();
    checkRuns = controles;
    try {
      const response = await fetch(`${base}/api/tasks/${taskId}/evaluation/ci`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ resultId }),
      });
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe(code);
    } finally {
      checkRuns = CI_VERTE;
    }
    expect(server.store.countEvents()).toBe(eventsBefore);
    expect(server.store.latestValidation(taskId, resultId)).toMatchObject({
      validation: { tests: 'passed', lint: 'passed' },
      provenance: { source: 'hive_sandbox' },
    });
  });
});
