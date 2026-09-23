// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { EvaluationResult } from '../../src/orchestrator/evaluator.js';
import { setLang } from '../src/i18n';
import { EvaluationPanel } from '../src/views/Miellerie';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const evidence: EvaluationResult['evidence'] = {
  result: 'passed',
  resultAlignment: 'unknown',
  gardiennes: 'clean',
  consensus: 'elected',
  tests: 'missing',
  typecheck: 'missing',
  build: 'missing',
  lint: 'missing',
  crossReview: {
    source: 'hive_counter_review',
    taskId: 'task-1',
    resultId: null,
    status: 'missing',
    reviewers: [],
    objections: [],
    reviewerCount: 0,
    contestingReviewers: 0,
    approvingReviewers: 0,
    recordedAt: 0,
  },
  humanReview: 'approved',
};

const evaluation = (patch: Partial<EvaluationResult> = {}): EvaluationResult => ({
  version: 1,
  taskId: 'task-1',
  decision: 'additional_test_required',
  canMerge: false,
  retryRecommended: false,
  reasons: ['preuves manquantes : tests, typecheck, build, lint'],
  evidence,
  ...patch,
});

async function mount(value: EvaluationResult): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<EvaluationPanel evaluation={value} error={null} />);
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Evaluator dans la Miellerie', () => {
  it('affiche explicitement les preuves manquantes', async () => {
    setLang('fr');
    await mount(evaluation());
    const text = container!.textContent ?? '';
    expect(text).toContain('Tests supplémentaires requis');
    expect(text).toContain('Résultat élu');
    expect(text).toContain('missing');
    expect(text).toContain('Aucune autorisation de fusion automatique');
  });

  it('sépare l acceptation de qualité de l action de fusion', async () => {
    setLang('fr');
    await mount(
      evaluation({
        decision: 'accepted',
        canMerge: true,
        reasons: ['résultat réussi, Gardiennes propres, validations vertes et consensus atteint'],
        evidence: {
          ...evidence,
          tests: 'passed',
          typecheck: 'passed',
          build: 'passed',
          lint: 'passed',
        },
      }),
    );
    expect(container!.textContent).toContain('Evaluator : accepté');
    expect(container!.textContent).toContain('la fusion reste un geste humain explicite');
  });
});
