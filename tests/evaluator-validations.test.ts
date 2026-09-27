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
  type CrossReviewEvidence,
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

// Depuis #460, `accepted` tient à UNE contre-revue favorable d'une autre
// famille que le producteur — le consensus du Parlement n'est plus qu'un
// signal. Le verdict qui accepte en porte donc une, comme la ruche la rangerait.
const relueParCodex: CrossReviewEvidence = {
  source: 'hive_counter_review',
  taskId: 'task-1',
  resultId: 7,
  status: 'applied',
  decision: 'appliquer',
  reviewers: [
    {
      relectureTaskId: 'review-1',
      reviewerNodeId: 'n2',
      reviewerAgent: 'codex',
      producerAgent: 'claude-code',
      decision: 'appliquer',
      reason: '',
      recordedAt: 1,
    },
  ],
  objections: [],
  reviewerCount: 1,
  contestingReviewers: 0,
  approvingReviewers: 1,
  recordedAt: 1,
};

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
    const verdict = juger(
      {
        tests: 'passed',
        typecheck: 'not_applicable',
        build: 'not_applicable',
        lint: 'passed',
      },
      { crossReview: relueParCodex },
    );
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

  it('un projet que le bac ne sait pas lire n’est pas invité à « déclarer un script test »', () => {
    // Sans package.json à la base (cargo, pytest…), le bac ne lit rien : le
    // motif le dit, au lieu d'une consigne fausse pour ce projet.
    const sansManifeste = { raison: 'sans_manifeste' } as const;
    const verdict = juger(
      {
        tests: 'not_applicable',
        typecheck: 'not_applicable',
        build: 'not_applicable',
        lint: 'not_applicable',
      },
      {
        validationProvenance: {
          ...bac,
          details: {
            tests: sansManifeste,
            typecheck: sansManifeste,
            build: sansManifeste,
            lint: sansManifeste,
          },
        },
      },
    );
    expect(verdict.decision).toBe('additional_test_required');
    expect(verdict.reasons[0]).toContain(
      'aucun package.json à la base du dépôt (bac Hive du nœud n1)',
    );
    expect(verdict.reasons.join(' · ')).not.toContain('déclarez un script');
  });

  it('sans bac, le motif dit comment en obtenir un — pas seulement « manquant »', () => {
    const sansBac = (script: string) => ({ raison: 'sans_bac', script }) as const;
    const verdict = juger(
      { tests: 'missing', typecheck: 'not_applicable', build: 'not_applicable', lint: 'missing' },
      {
        validationProvenance: {
          ...bac,
          details: { ...bac.details, tests: sansBac('test'), lint: sansBac('lint') },
        },
      },
    );
    expect(verdict.decision).toBe('additional_test_required');
    expect(verdict.reasons[0]).toBe('preuves manquantes : tests, lint (bac Hive du nœud n1)');
    expect(verdict.reasons[1]).toContain('le nœud n1 n’a pas de bac à sable');
    expect(verdict.reasons[1]).toContain('podman, docker ou bubblewrap');
  });

  // Une relecture impossible appelle l'humain AVANT les preuves absentes —
  // mais celui qui approuve doit lire, dans le même verdict, qu'aucun test
  // n'a tourné : sinon « revue humaine » se lit comme « il ne manque qu'un
  // avis ».
  const CAUSE = 'codex a échoué (3 tentative(s))';

  it('relecture impossible SANS BAC : l’humain lit aussi que rien n’a tourné, et pourquoi', () => {
    const sansBac = (script: string) => ({ raison: 'sans_bac', script }) as const;
    const verdict = juger(
      { tests: 'missing', typecheck: 'not_applicable', build: 'not_applicable', lint: 'missing' },
      {
        validationProvenance: {
          ...bac,
          details: { ...bac.details, tests: sansBac('test'), lint: sansBac('lint') },
        },
        crossReviewImpossible: CAUSE,
      },
    );
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.retryRecommended).toBe(false);
    expect(verdict.reasons[0]).toBe(`relecture impossible : ${CAUSE}`);
    expect(verdict.reasons[1]).toBe('preuves manquantes : tests, lint (bac Hive du nœud n1)');
    expect(verdict.reasons[2]).toContain('le nœud n1 n’a pas de bac à sable');
  });

  it('relecture impossible, projet SANS TEST : le motif le dit aussi', () => {
    const verdict = juger(
      { tests: 'not_applicable', typecheck: 'passed', build: 'passed', lint: 'passed' },
      { crossReviewImpossible: CAUSE },
    );
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.reasons).toEqual([
      `relecture impossible : ${CAUSE}`,
      expect.stringContaining('le projet ne déclare aucun test (bac Hive du nœud n1)'),
    ]);
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
