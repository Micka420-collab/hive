// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA MIELLERIE DIT D'OÙ VIENNENT LES VALIDATIONS.
//
// Les validations du bac Hive comptent pour l'Evaluator comme la CI GitHub —
// c'est une décision du produit —, et c'est pourquoi l'écran doit toujours dire
// laquelle a parlé. Ce banc monte le panneau Evaluator avec l'une puis l'autre
// provenance, et vérifie ce qu'un relecteur lit :
//
//   · la source et son rattachement (nœud et commit de base, ou PR et commit) ;
//   · pour le bac, un constat par validation — ce qui a tourné, ou pourquoi
//     rien n'a tourné — et `not_applicable` affiché tel quel, jamais en vert ;
//   · le bouton « Récupérer les contrôles CI » encore offert après le bac (deux
//     preuves distinctes), retiré une fois la CI rangée.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { EvaluationPanel } from '../dashboard/src/views/Miellerie';
import { texteControle } from '../dashboard/src/views/validations-rendu';
import type { EvaluationResult, ValidationProvenance } from '../src/orchestrator/evaluator';
import { ETATS_PAR_RAISON, type RaisonControle } from '../src/shared/validations-bac';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Le panneau n'appelle l'API qu'au clic sur « Récupérer les contrôles CI » ;
  // le réseau est coupé quand même, comme dans tout banc de rendu.
  couperLeReseau();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function evaluation(provenance: ValidationProvenance): EvaluationResult {
  return {
    version: 1,
    taskId: 't1',
    decision: 'correction_required',
    canMerge: false,
    retryRecommended: true,
    reasons: ['validation lint en échec (bac Hive du nœud n1)'],
    evidence: {
      result: 'passed',
      resultAlignment: 'unknown',
      gardiennes: 'clean',
      consensus: 'no_quorum',
      tests: 'passed',
      typecheck: 'not_applicable',
      build: 'missing',
      lint: 'failed',
      validationProvenance: provenance,
      crossReview: {
        source: 'hive_counter_review',
        taskId: 't1',
        resultId: 4,
        status: 'missing',
        reviewers: [],
        objections: [],
        reviewerCount: 0,
        contestingReviewers: 0,
        approvingReviewers: 0,
        recordedAt: 0,
      },
      humanReview: 'missing',
    },
  };
}

const bac: ValidationProvenance = {
  source: 'hive_sandbox',
  taskId: 't1',
  projectId: 'p1',
  resultId: 4,
  recordedAt: 1_000,
  nodeId: 'n1',
  baseSha: 'c0ffee'.padEnd(40, '0'),
  details: {
    tests: { raison: 'termine', script: 'test', code: 0, dureeMs: 1_500 },
    typecheck: { raison: 'non_declare' },
    build: { raison: 'sans_lockfile', script: 'build' },
    lint: { raison: 'termine', script: 'lint', code: 1, extrait: 'src/a.js: 3 erreurs' },
  },
};

function monter(e: EvaluationResult): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() =>
    racine?.render(<EvaluationPanel evaluation={e} error={null} taskId="t1" resultId={4} />),
  );
  return conteneur;
}

const parTestId = (racine: HTMLElement, id: string): HTMLElement | null =>
  racine.querySelector(`[data-testid="${id}"]`);

describe('panneau Evaluator — la provenance des validations', () => {
  it('bac Hive : la source, le nœud, la base, et un constat par validation', () => {
    const vue = monter(evaluation(bac));

    expect(parTestId(vue, 'mi-validation-provenance')?.textContent).toBe(
      'bac Hive · nœud n1 · base c0ffee00',
    );
    const lignes = [...(parTestId(vue, 'mi-validation-details')?.querySelectorAll('li') ?? [])];
    expect(lignes.map((l) => l.getAttribute('data-etat'))).toEqual([
      'passed',
      'not_applicable',
      'missing',
      'failed',
    ]);
    expect(lignes[0]?.textContent).toContain('npm run test → 0 en 1.5 s');
    expect(lignes[1]?.textContent).toContain('not_applicable · le projet ne déclare pas ce script');
    expect(lignes[2]?.textContent).toContain('sans lockfile');
    // La sortie n'est dépliable que là où elle explique un échec.
    expect(lignes[3]?.querySelector('pre')?.textContent).toBe('src/a.js: 3 erreurs');
    expect(lignes[0]?.querySelector('details')).toBeNull();
    expect(parTestId(vue, 'mi-fetch-ci'), 'la CI reste demandable après le bac').not.toBeNull();
  });

  it('CI GitHub : la PR et son commit, sans constats du bac — et la CI reste relisible', () => {
    const vue = monter(
      evaluation({
        source: 'github_pull_request',
        taskId: 't1',
        projectId: 'p1',
        resultId: 4,
        recordedAt: 2_000,
        depot: 'o/r',
        pr: 9,
        branch: 'hive/t1',
        commitSha: 'abcdef1234',
      }),
    );

    expect(parTestId(vue, 'mi-validation-provenance')?.textContent).toBe(
      'CI GitHub · o/r · PR #9 · hive/t1 · abcdef12',
    );
    expect(parTestId(vue, 'mi-validation-details')).toBeNull();
    // Une CI lue pendant qu'elle tournait doit pouvoir être relue une fois
    // finie : sans le bouton, il n'y avait plus aucun moyen de rafraîchir.
    expect(parTestId(vue, 'mi-fetch-ci'), 'la CI reste relisible').not.toBeNull();
  });

  it('chaque raison a sa phrase, dans les deux langues', () => {
    for (const raison of Object.keys(ETATS_PAR_RAISON) as RaisonControle[]) {
      const detail = { raison, script: 'test', code: 1, dureeMs: 10 };
      const fr = texteControle(detail, (f) => f);
      const en = texteControle(detail, (_f, e) => e);
      expect(fr, raison).toMatch(/\S/);
      expect(en, raison).toMatch(/\S/);
      if (raison !== 'termine') expect(fr, raison).not.toBe(en);
    }
  });
});
