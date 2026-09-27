// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA NOTE SOUS LE VERDICT DE L'EVALUATOR — elle dit à l'humain ce qu'on
// attend encore, et de QUI.
//
// `human_review_required` couvre deux attentes opposées : une contre-revue
// devenue impossible (la décision revient à un humain) et une contre-revue
// encore en vol (c'est l'avis du relecteur qu'on attend). Une seule phrase
// pour les deux faisait trancher l'humain à la place d'un relecteur qui peut
// encore objecter. Les évaluations viennent du vrai `evaluate` : le banc ne
// fabrique pas un état que l'Evaluator ne rendrait jamais.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { EvaluationPanel } from '../dashboard/src/views/Miellerie';
import { evaluate } from '../src/orchestrator/evaluator';
import type { EvaluatorInput } from '../src/orchestrator/evaluator';
import { couperLeReseau, type ReseauCoupe } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let reseau: ReseauCoupe | null = null;

beforeEach(() => {
  setLang('fr');
  // Le panneau n'appelle rien sans tâche ni résultat : couper le réseau le
  // prouve (`appels` vide), au lieu de le supposer.
  reseau = couperLeReseau();
});

afterEach(() => {
  expect(reseau?.appels, 'le panneau a appelé le réseau').toEqual([]);
  reseau?.rendre();
  reseau = null;
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

/** Une production rendue, inspectée propre, toutes validations vertes. */
const BASE: EvaluatorInput = {
  taskId: 't1',
  taskStatus: 'done',
  results: [
    {
      resultId: 1,
      taskId: 't1',
      nodeId: 'n1',
      success: true,
      diff: 'diff --git a/x b/x\n+x',
      logs: '',
      durationMs: 1,
      subAgents: [],
    },
  ],
  inspection: { verdict: 'clean', score: 1, griefs: [] },
  validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
};

function note(input: EvaluatorInput): string {
  const evaluation = evaluate(input);
  expect(evaluation.decision).toBe('human_review_required');
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<EvaluationPanel evaluation={evaluation} error={null} />));
  return conteneur.querySelector('.mi-cons-note')?.textContent ?? '';
}

describe('Miellerie — la note sous le verdict de l’Evaluator', () => {
  it('UNE RELECTURE EN VOL : on attend son avis, pas un humain', () => {
    const texte = note({ ...BASE, crossReviewPending: 1 });
    expect(texte).toMatch(/un avis de contre-revue est encore attendu/);
    expect(texte).not.toMatch(/revient à un humain/);
  });

  it('UNE RELECTURE IMPOSSIBLE : la décision revient à un humain', () => {
    const texte = note({ ...BASE, crossReviewImpossible: 'codex a échoué (3 tentative(s))' });
    expect(texte).toMatch(/la décision revient à un humain/);
  });
});
