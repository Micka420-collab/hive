import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/orchestrator/evaluator.js';
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
    const consensus = tally([
      {
        nodeId: 'n1',
        agentType: 'codex',
        success: true,
        signature: signatureOf('A'),
        fichiers: ['src/a.ts'],
      },
      {
        nodeId: 'n2',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf('A'),
        fichiers: ['src/a.ts'],
      },
    ]);
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result(true, 'n1')],
      inspection: clean,
      validation: validations,
      consensus,
      humanReview: 'approved',
    });
    expect(verdict.decision).toBe('accepted');
    expect(verdict.canMerge).toBe(true);
    expect(verdict.retryRecommended).toBe(false);
  });

  it('refuse le résultat si une validation a échoué', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      inspection: clean,
      validation: { ...validations, tests: 'failed' },
      consensus: {
        outcome: 'elected',
        winner: null,
        factions: [],
        quorum: 2,
        surfaces: [],
        sansSurface: 0,
      },
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.reasons).toContain('validation tests en échec');
  });
});
