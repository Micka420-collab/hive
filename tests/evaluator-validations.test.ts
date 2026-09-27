// L'Evaluator et ses deux producteurs de validations — CI GitHub et bac Hive.
//
// Deux décisions du produit sont protégées ici :
//
//   · les validations du bac COMPTENT comme la CI, mais le verdict dit toujours
//     laquelle a parlé : un motif qui tairait sa source ferait passer un vert
//     du bac pour un vert de la CI ;
//   · « non applicable » n'est ni « manquant » ni « vert ». Le typecheck, le
//     build ou le lint qu'un projet ne déclare pas ne bloquent pas ; les TESTS
//     ne sont jamais dispensés — sans eux, rien ne prouve le comportement.
//
// Avant ce lot, `not_applicable` n'existait pas : l'Evaluator le lisait
// `missing` et ne pouvait accepter aucun projet sans typecheck.

import { describe, expect, it } from 'vitest';
import {
  evaluate,
  type EvaluatorInput,
  type ProvenanceBac,
  type ValidationEvidence,
} from '../src/orchestrator/evaluator.js';
import { signatureOf, tally } from '../src/orchestrator/parliament.js';
import type { TaskResult } from '../src/shared/types.js';

const livre: TaskResult = {
  resultId: 7,
  taskId: 'task-1',
  nodeId: 'n1',
  diff: 'diff --git a/src/a.js b/src/a.js\n@@ -1 +1 @@\n-a\n+b',
  logs: '',
  success: true,
  durationMs: 12,
  subAgents: [],
};

const bac: ProvenanceBac = {
  source: 'hive_sandbox',
  taskId: 'task-1',
  projectId: 'p1',
  resultId: 7,
  recordedAt: 1_000,
  nodeId: 'n1',
  baseSha: 'a'.repeat(40),
  details: {
    tests: { raison: 'termine', script: 'test', code: 0, dureeMs: 900 },
    typecheck: { raison: 'non_declare' },
    build: { raison: 'non_declare' },
    lint: { raison: 'termine', script: 'lint', code: 0, dureeMs: 300 },
  },
};

const elu = tally(
  ['n1', 'n2'].map((nodeId) => ({
    nodeId,
    agentType: nodeId === 'n1' ? 'claude-code' : 'codex',
    success: true,
    signature: signatureOf(livre.diff),
    fichiers: ['src/a.js'],
  })),
);

const juger = (validation: ValidationEvidence, extra: Partial<EvaluatorInput> = {}) =>
  evaluate({
    taskId: 'task-1',
    taskStatus: 'done',
    results: [livre],
    inspection: { verdict: 'clean', score: 0, griefs: [] },
    validation,
    validationProvenance: bac,
    consensus: elu,
    ...extra,
  });

describe('Evaluator — les validations du bac Hive', () => {
  it('accepte sur des validations du bac, et dit que c’est le bac qui a parlé', () => {
    const verdict = juger({
      tests: 'passed',
      typecheck: 'not_applicable',
      build: 'not_applicable',
      lint: 'passed',
    });
    expect(verdict.decision).toBe('accepted');
    expect(verdict.evidence).toMatchObject({
      tests: 'passed',
      typecheck: 'not_applicable',
      build: 'not_applicable',
      lint: 'passed',
      validationProvenance: { source: 'hive_sandbox', nodeId: 'n1' },
    });
    expect(verdict.reasons).toContain('validations : bac Hive du nœud n1');
    expect(verdict.reasons).toContain(
      'non applicables, faute de déclaration par le projet : typecheck, build',
    );
  });

  it('ne dispense jamais des TESTS : non applicables, ils demandent une preuve', () => {
    const verdict = juger({
      tests: 'not_applicable',
      typecheck: 'passed',
      build: 'passed',
      lint: 'passed',
    });
    expect(verdict.decision).toBe('additional_test_required');
    expect(verdict.canMerge).toBe(false);
    expect(verdict.reasons[0]).toContain('le projet ne déclare aucun test (bac Hive du nœud n1)');
  });

  it('un manquant bloque, même entouré de verts et de non applicables', () => {
    const verdict = juger({
      tests: 'passed',
      typecheck: 'not_applicable',
      build: 'missing',
      lint: 'passed',
    });
    expect(verdict.decision).toBe('additional_test_required');
    expect(verdict.reasons[0]).toBe('preuves manquantes : build (bac Hive du nœud n1)');
  });

  it('un échec du bac demande une correction, et dit d’où il vient', () => {
    const verdict = juger({
      tests: 'failed',
      typecheck: 'passed',
      build: 'passed',
      lint: 'passed',
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.retryRecommended).toBe(true);
    expect(verdict.reasons[0]).toBe('validation tests en échec (bac Hive du nœud n1)');
  });

  it('nomme la CI GitHub quand c’est elle qui a parlé, et l’absence de tout producteur', () => {
    const ci = juger(
      { tests: 'failed', typecheck: 'passed', build: 'passed', lint: 'passed' },
      {
        validationProvenance: {
          source: 'github_pull_request',
          taskId: 'task-1',
          projectId: 'p1',
          resultId: 7,
          recordedAt: 1_000,
          depot: 'o/r',
          pr: 12,
          branch: 'hive/task-1',
          commitSha: 'b'.repeat(40),
        },
      },
    );
    expect(ci.reasons[0]).toBe('validation tests en échec (CI GitHub, PR #12)');

    const personne = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [livre],
      inspection: { verdict: 'clean', score: 0, griefs: [] },
    });
    expect(personne.decision).toBe('additional_test_required');
    expect(personne.reasons[0]).toContain('aucun producteur de preuve');
  });
});
