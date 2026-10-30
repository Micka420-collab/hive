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
    const project = server.store.createProject({ name: 'Evaluator', repoUrl: '/repo' });
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

  it('agrège toutes les contre-revues du résultat courant et ignore une ancienne tentative', async () => {
    // Chaque test prépare sa production courante : d'autres cas de ce fichier
    // ajoutent des résultats et l'ordre du tamis ne doit pas changer la cible.
    const reviewedResultId = server.store.insertResult({
      taskId,
      nodeId: 'n2',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 12,
      subAgents: [],
    });
    server.store.enregistrerInspection({
      resultId: reviewedResultId,
      taskId,
      nodeId: 'n2',
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });

    server.store.appendEvent('contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId,
      resultId: reviewedResultId,
      relecture: 'relecture-favorable',
      relecteur: 'codex',
      reviewerNodeId: 'n1',
      producteur: 'claude-code',
      conteste: false,
      objections: [],
      recordedAt: 1,
    });
    server.store.appendEvent('contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId,
      resultId: reviewedResultId,
      relecture: 'relecture-contestee',
      relecteur: 'hermes-agent',
      reviewerNodeId: 'n3',
      producteur: 'claude-code',
      conteste: true,
      objections: ['le cas limite n’est pas traité'],
      recordedAt: 2,
    });

    const reviewed = await fetch(`${base}/api/tasks/${taskId}/evaluation`, { headers });
    expect(reviewed.status).toBe(200);
    const reviewedBody = (await reviewed.json()) as {
      decision: string;
      evidence: {
        crossReview?: {
          status: string;
          decision: string;
          reviewerCount: number;
          contestingReviewers: number;
          approvingReviewers: number;
          objections: string[];
        };
      };
    };
    expect(reviewedBody.decision).toBe('correction_required');
    expect(reviewedBody.evidence.crossReview).toMatchObject({
      status: 'improvement_required',
      decision: 'ameliorer',
      reviewerCount: 2,
      contestingReviewers: 1,
      approvingReviewers: 1,
      objections: ['le cas limite n’est pas traité'],
    });

    // Une nouvelle production de la même tâche ne doit pas récupérer la preuve
    // de la tentative précédente, même si les deux verdicts restent journalisés.
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

    const reread = await fetch(`${base}/api/tasks/${taskId}/evaluation`, { headers });
    expect(reread.status).toBe(200);
    const rereadBody = (await reread.json()) as {
      decision: string;
      evidence: { crossReview?: { status?: string; resultId?: number | null } };
    };
    expect(rereadBody.decision).toBe('additional_test_required');
    expect(rereadBody.evidence.crossReview).toMatchObject({
      status: 'missing',
      resultId: latestResultId,
    });
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
    const project = server.store.createProject({ name: 'Retry humain', repoUrl: '/repo' });
    const task = server.store.createTask({
      projectId: project.id,
      title: 'Rejet humain',
      prompt: 'rejouer après revue',
    });
    server.store.patchTask(task.id, { status: 'done' });
    const results = [
      [
        server.store.insertResult({
          taskId: task.id,
          nodeId: 'n1',
          diff: DIFF,
          logs: 'tests: 0 failed',
          success: true,
          durationMs: 10,
          subAgents: [],
        }),
        'n1',
      ],
      [
        server.store.insertResult({
          taskId: task.id,
          nodeId: 'n2',
          diff: DIFF,
          logs: 'tests: 0 failed',
          success: true,
          durationMs: 11,
          subAgents: [],
        }),
        'n2',
      ],
    ] as const;
    for (const [resultId, nodeId] of results) {
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

    const response = await fetch(`${base}/api/tasks/${task.id}/review`, {
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
    expect(server.store.getTask(task.id)?.attempts).toBe(1);
    expect(server.store.getTaskReview(task.id)).toBeNull();
    expect(
      server.store
        .listEvents()
        .some(
          (event) =>
            event.type === 'task_retry' &&
            event.payload.source === 'evaluator' &&
            event.payload.taskId === task.id,
        ),
    ).toBe(true);
  });

  it("exige l'identifiant du résultat courant pour une demande de retry explicite", async () => {
    const project = server.store.createProject({
      name: 'Retry explicite',
      repoUrl: '/repo',
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

  /**
   * Une production de `claude-code` (n2), inspectée propre, validée par une CI
   * rattachée à ce résultat exact, et relue favorablement par `codex`. Seule en
   * lice : le Parlement n'a qu'un bulletin, donc `no_quorum`.
   */
  function productionRelueParUneAutreFamille(titre: string): { taskId: string; resultId: number } {
    const project = server.store.createProject({ name: titre, repoUrl: '/repo' });
    const task = server.store.createTask({ projectId: project.id, title: titre, prompt: titre });
    server.store.patchTask(task.id, { status: 'done' });
    const resultId = server.store.insertResult({
      taskId: task.id,
      nodeId: 'n2',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 10,
      subAgents: [],
    });
    server.store.enregistrerInspection({
      resultId,
      taskId: task.id,
      nodeId: 'n2',
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });
    server.store.appendEvent('ci_validation_recorded', {
      source: 'github_pull_request',
      taskId: task.id,
      projectId: project.id,
      resultId,
      depot: 'demo/hive',
      pr: 7,
      branch: `hive/${task.id}`,
      commitSha: 'commit-accepte',
      validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
      recordedAt: 1,
    });
    server.store.appendEvent('contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId: task.id,
      resultId,
      relecture: `${task.id}-relecture-codex`,
      relecteur: 'codex',
      reviewerNodeId: 'n1',
      producteur: 'claude-code',
      conteste: false,
      objections: [],
      recordedAt: 1,
    });
    return { taskId: task.id, resultId };
  }

  type Evaluation = {
    decision: string;
    canMerge: boolean;
    reasons: string[];
    evidence: { consensus: string; crossReviewPending: number; crossReview: { status: string } };
  };
  const lireEvaluation = async (id: string): Promise<Evaluation> => {
    const response = await fetch(`${base}/api/tasks/${id}/evaluation`, { headers });
    expect(response.status).toBe(200);
    return (await response.json()) as Evaluation;
  };

  it('accepte une production relue par une autre famille sans quorum, et ne la dit fusionnable qu’après l’humain', async () => {
    const { taskId: id } = productionRelueParUneAutreFamille('Relue par codex');

    const avant = await lireEvaluation(id);
    expect(avant.evidence.consensus).toBe('no_quorum');
    expect(avant.evidence.crossReview.status).toBe('applied');
    expect(avant.decision, avant.reasons.join(' · ')).toBe('accepted');
    expect(avant.canMerge).toBe(false);

    server.store.setTaskReview(id, 'approved');
    const apres = await lireEvaluation(id);
    expect(apres.decision).toBe('accepted');
    expect(apres.canMerge).toBe(true);
  });

  it('retient l’acceptation tant qu’une seconde relecture de ce résultat est en vol', async () => {
    const { taskId: id, resultId } = productionRelueParUneAutreFamille('Seconde relecture');
    const project = server.store.getTask(id)?.projectId ?? '';
    const relecture = server.store.createTask({
      projectId: project,
      title: 'Contre-expertise — Seconde relecture',
      prompt: 'relire',
    });
    server.store.inscrireRelecture({
      relectureTaskId: relecture.id,
      productionTaskId: id,
      relecteurNodeId: 'n3',
      relecteurAgent: 'hermes-agent',
      producteurAgent: 'claude-code',
    });
    server.store.patchTask(relecture.id, { status: 'running', assignedNodeId: 'n3' });
    // Le filigrane du lancement rattache cette relecture au résultat EXACT.
    server.store.appendEvent('contre_expertise', {
      taskId: id,
      resultId,
      possible: true,
      producteur: 'claude-code',
      modeles: ['hermes-agent'],
      relecteurs: ['hermes'],
      relectures: [relecture.id],
    });

    const enVol = await lireEvaluation(id);
    expect(enVol.evidence.crossReviewPending).toBe(1);
    expect(enVol.decision).toBe('human_review_required');
    expect(enVol.reasons.join(' ')).toContain('contre-revue en cours');

    // Terminée sans avis (échec terminal) : elle n'objectera plus, et
    // l'attendre bloquerait l'Evaluator pour toujours.
    server.store.patchTask(relecture.id, { status: 'failed' });
    const terminee = await lireEvaluation(id);
    expect(terminee.evidence.crossReviewPending).toBe(0);
    expect(terminee.decision).toBe('accepted');
  });

  it('réenfile un rejet humain même quand aucune inspection des Gardiennes n’existe', async () => {
    // `HIVE_GARDIENNES=off` n'inspecte rien : le rejet humain doit malgré tout
    // repartir en correction, pas se perdre dans « revue humaine requise ».
    const project = server.store.createProject({
      name: 'Sans Gardiennes',
      repoUrl: '/repo',
    });
    const task = server.store.createTask({
      projectId: project.id,
      title: 'Rejet sans inspection',
      prompt: 'rejouer',
    });
    server.store.patchTask(task.id, { status: 'done' });
    server.store.insertResult({
      taskId: task.id,
      nodeId: 'n1',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 10,
      subAgents: [],
    });

    const response = await fetch(`${base}/api/tasks/${task.id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'rejected', clientId: 'miellerie-test' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { retry?: { ok: boolean } };
    expect(body.retry?.ok).toBe(true);
    expect(server.store.getTask(task.id)?.attempts).toBe(1);
    expect(
      server.store
        .listEvents()
        .some(
          (event) =>
            event.type === 'task_retry' &&
            event.payload.source === 'evaluator' &&
            event.payload.taskId === task.id,
        ),
    ).toBe(true);
  });

  it('un rejet humain resté sans correction le dit au journal', async () => {
    const project = server.store.createProject({ name: 'Essais épuisés', repoUrl: '/repo' });
    const task = server.store.createTask({
      projectId: project.id,
      title: 'Rejet sans essai restant',
      prompt: 'plus d’essai',
    });
    server.store.patchTask(task.id, { status: 'done', attempts: 99 });
    const resultId = server.store.insertResult({
      taskId: task.id,
      nodeId: 'n1',
      diff: DIFF,
      logs: 'tests: 0 failed',
      success: true,
      durationMs: 10,
      subAgents: [],
    });

    const response = await fetch(`${base}/api/tasks/${task.id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'rejected', clientId: 'miellerie-test' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { retry?: { ok: boolean; reason?: string } };
    expect(body.retry).toMatchObject({ ok: false, reason: 'attempts_exhausted' });
    // Mission Control ne lit pas la réponse : sans cette trace, l'opérateur
    // croirait une correction en route.
    const trace = server.store
      .listEvents()
      .find(
        (event) => event.type === 'evaluator_retry_skipped' && event.payload.taskId === task.id,
      );
    expect(trace?.payload).toMatchObject({ resultId, reason: 'attempts_exhausted' });
  });
});
