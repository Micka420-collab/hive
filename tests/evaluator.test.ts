import { describe, expect, it } from 'vitest';
import { evaluate, type CrossReviewEvidence } from '../src/orchestrator/evaluator.js';
import type { TaskResult } from '../src/shared/types.js';
import { signatureOf, tally } from '../src/orchestrator/parliament.js';

const result = (success = true, nodeId = 'n1'): TaskResult => ({
  taskId: 'task-1',
  nodeId,
  diff: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-a\n+b',
  logs: '',
  success,
  durationMs: 12,
  subAgents: [],
});

const clean = { verdict: 'clean' as const, score: 0, griefs: [] };
const validations = {
  tests: 'passed' as const,
  typecheck: 'passed' as const,
  build: 'passed' as const,
  lint: 'passed' as const,
};

const crossReview = (order: Array<'appliquer' | 'ameliorer'>): CrossReviewEvidence => ({
  source: 'hive_counter_review',
  taskId: 'task-1',
  resultId: 1,
  status: order.includes('ameliorer') ? 'improvement_required' : 'applied',
  decision: order.includes('ameliorer') ? 'ameliorer' : 'appliquer',
  reviewers: order.map((decision, index) => ({
    relectureTaskId: `review-${index + 1}`,
    reviewerNodeId: `reviewer-${index + 1}`,
    reviewerAgent: index === 0 ? 'codex' : 'claude-code',
    decision,
    reason: decision === 'ameliorer' ? 'le cas limite n’est pas traité' : '',
    recordedAt: index + 1,
  })),
  objections: order.includes('ameliorer') ? ['le cas limite n’est pas traité'] : [],
  reviewerCount: order.length,
  contestingReviewers: order.filter((decision) => decision === 'ameliorer').length,
  approvingReviewers: order.filter((decision) => decision === 'appliquer').length,
  recordedAt: order.length,
});

describe('Evaluator indépendant', () => {
  it('refuse de conclure quand aucune production n existe', () => {
    const verdict = evaluate({ taskId: 'task-1', taskStatus: 'running', results: [] });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.retryRecommended).toBe(true);
    expect(verdict.evidence.result).toBe('missing');
  });

  it('rejette une production creuse même si elle se déclare réussie', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      inspection: { verdict: 'hollow', score: 3, griefs: [] },
    });
    expect(verdict.decision).toBe('rejected');
    expect(verdict.canMerge).toBe(false);
  });

  it('demande les validations manquantes au lieu de croire les logs', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      inspection: clean,
    });
    expect(verdict.decision).toBe('additional_test_required');
    expect(verdict.reasons[0]).toContain('tests');
    expect(verdict.evidence.tests).toBe('missing');
  });

  it('ne transforme pas une inspection absente en feu vert', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      validation: validations,
      consensus: {
        outcome: 'elected',
        winner: null,
        factions: [],
        quorum: 2,
        surfaces: [],
        sansSurface: 0,
      },
    });
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.evidence.gardiennes).toBe('missing');
  });

  it('requiert une relecture humaine si le Parlement n a pas de quorum', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      inspection: clean,
      validation: validations,
      consensus: tally([
        {
          nodeId: 'n1',
          agentType: 'codex',
          success: true,
          signature: signatureOf('A'),
          fichiers: ['src/a.ts'],
        },
      ]),
    });
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.canMerge).toBe(false);
  });

  it('accepte la qualité après preuves vertes et consensus, sans auto-merger', () => {
    const delivered = result(true, 'n1');
    const consensus = tally([
      {
        nodeId: 'n1',
        agentType: 'codex',
        success: true,
        signature: signatureOf(delivered.diff),
        fichiers: ['src/a.ts'],
      },
      {
        nodeId: 'n2',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf(delivered.diff),
        fichiers: ['src/a.ts'],
      },
    ]);
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: validations,
      consensus,
      humanReview: 'approved',
    });
    expect(verdict.decision).toBe('accepted');
    expect(verdict.canMerge).toBe(true);
    expect(verdict.retryRecommended).toBe(false);
  });

  it('refuse un résultat livré qui ne correspond pas à la faction élue', () => {
    const consensus = tally([
      {
        nodeId: 'n1',
        agentType: 'codex',
        success: true,
        signature: signatureOf('diff A'),
        fichiers: ['src/a.ts'],
      },
      {
        nodeId: 'n2',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf('diff A'),
        fichiers: ['src/a.ts'],
      },
    ]);
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result(true, 'n1'), { ...result(true, 'n3'), diff: 'diff B' }],
      inspection: clean,
      validation: validations,
      consensus,
      humanReview: 'approved',
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.canMerge).toBe(false);
    expect(verdict.retryRecommended).toBe(true);
    expect(verdict.evidence.resultAlignment).toBe('mismatch');
  });

  it('refuse le résultat si une validation a échoué', () => {
    const delivered = result();
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: { ...validations, tests: 'failed' },
      consensus: tally([
        {
          nodeId: 'n1',
          agentType: 'codex',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
        {
          nodeId: 'n2',
          agentType: 'claude-code',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
      ]),
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.reasons).toContain('validation tests en échec');
  });

  it.each([
    ['contestation puis validation', ['ameliorer', 'appliquer']],
    ['validation puis contestation', ['appliquer', 'ameliorer']],
  ] as const)('%s : une objection reste bloquante', (_label, order) => {
    const delivered = result();
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: validations,
      consensus: tally([
        {
          nodeId: 'n1',
          agentType: 'codex',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
        {
          nodeId: 'n2',
          agentType: 'claude-code',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
      ]),
      humanReview: 'approved',
      crossReview: crossReview([...order]),
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.retryRecommended).toBe(true);
    expect(verdict.evidence.crossReview?.decision).toBe('ameliorer');
    expect(verdict.evidence.crossReview?.status).toBe('improvement_required');
    expect(verdict.reasons.join(' ')).toContain('cas limite');
  });

  it('rend explicite l’absence de contre-revue sans la confondre avec une preuve positive', () => {
    const delivered = { ...result(), resultId: 7 };
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: validations,
      consensus: tally([
        {
          nodeId: 'n1',
          agentType: 'codex',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
        {
          nodeId: 'n2',
          agentType: 'claude-code',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
      ]),
      humanReview: 'approved',
    });
    expect(verdict.decision).toBe('accepted');
    expect(verdict.evidence.crossReview).toMatchObject({
      status: 'missing',
      taskId: 'task-1',
      resultId: 7,
      reviewerCount: 0,
    });
    expect(verdict.reasons.join(' ')).toContain('preuve séparée manquante');
  });
});
