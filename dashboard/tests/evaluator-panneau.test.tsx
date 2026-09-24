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
const nativeFetch = globalThis.fetch;

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
  globalThis.fetch = nativeFetch;
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

  it('expose la contre-revue, le retry et la provenance CI réels', async () => {
    setLang('fr');
    await mount(
      evaluation({
        retryRecommended: true,
        evidence: {
          ...evidence,
          crossReview: {
            ...evidence.crossReview,
            status: 'applied',
            resultId: 7,
            reviewerCount: 2,
            approvingReviewers: 1,
            contestingReviewers: 1,
            objections: ['ajouter un test du chemin sécurisé'],
          },
          validationProvenance: {
            source: 'github_pull_request',
            taskId: 'task-1',
            projectId: 'project-1',
            resultId: 7,
            depot: 'Micka420-collab/hive',
            pr: 417,
            branch: 'feat/mission-control-evidence',
            commitSha: 'deadbeef12345678',
            recordedAt: 1_790_000_000_000,
          },
        },
      }),
    );
    expect(container!.querySelector('[data-testid="mi-cross-review"]')?.textContent).toContain(
      'applied',
    );
    expect(container!.querySelector('[data-testid="mi-cross-review"]')?.textContent).toContain(
      '2 relecteur(s)',
    );
    expect(container!.querySelector('[data-testid="mi-evaluator-retry"]')?.textContent).toContain(
      'recommandé',
    );
    const provenance = container!.querySelector('[data-testid="mi-validation-provenance"]');
    expect(provenance?.textContent).toContain('PR #417');
    expect(provenance?.textContent).toContain('feat/mission-control-evidence');
    expect(provenance?.textContent).toContain('deadbeef');
    expect(
      container!.querySelector('[data-testid="mi-cross-review-objections"]')?.textContent,
    ).toContain('ajouter un test du chemin sécurisé');
  });

  it('déclenche la lecture CI du résultat courant et expose sa réussite', async () => {
    setLang('fr');
    const appels: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      appels.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          taskId: 'task-1',
          resultId: 42,
          validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
          provenance: {
            source: 'github_pull_request',
            taskId: 'task-1',
            projectId: 'project-1',
            resultId: 42,
            depot: 'demo/hive',
            pr: 7,
            branch: 'hive/task-1',
            commitSha: 'abc123',
            recordedAt: 1,
          },
          evaluation: evaluation(),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    let recorded = 0;
    await mount(evaluation());
    // L'action est disponible uniquement quand l'inspection fournit le lien
    // de la tâche et le résultat exact — elle ne peut donc pas viser une
    // production périmée ou en inventer une.
    await act(async () => {
      root!.render(
        <EvaluationPanel
          evaluation={evaluation()}
          error={null}
          taskId="task-1"
          resultId={42}
          onCiRecorded={() => {
            recorded += 1;
          }}
        />,
      );
    });
    const button = container!.querySelector<HTMLButtonElement>('[data-testid="mi-fetch-ci"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    expect(appels).toHaveLength(1);
    expect(appels[0]?.url).toBe('/api/tasks/task-1/evaluation/ci');
    expect(appels[0]?.init?.method).toBe('POST');
    expect(appels[0]?.init?.body).toBe(JSON.stringify({ resultId: 42 }));
    expect(recorded).toBe(1);
    expect(container!.textContent).toContain('Preuve CI enregistrée');
  });
});
