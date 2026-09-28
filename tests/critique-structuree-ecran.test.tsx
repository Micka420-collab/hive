// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES CONSTATS À L'ÉCRAN — comptés par critère dans la Miellerie et la War
// Room, montrés un à un sous le verdict de l'Evaluator.
//
// Les évaluations viennent du vrai `evaluate`, les constats du vrai lecteur
// de marqueur : le banc ne fabrique pas un état que la Reine ne rendrait pas.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { EvaluationPanel } from '../dashboard/src/views/Miellerie';
import { direEntree } from '../dashboard/src/views/warroom-rendu';
import { evaluate } from '../src/orchestrator/evaluator';
import type { EvaluatorInput } from '../src/orchestrator/evaluator';
import { lireAvis } from '../src/shared/contre-expertise';
import { lireConstats, texteConstat } from '../src/shared/critique-structuree';
import type { Constat } from '../src/shared/critique-structuree';
import { entreesWarRoom } from '../src/shared/war-room';
import { couperLeReseau, type ReseauCoupe } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let reseau: ReseauCoupe | null = null;

beforeEach(() => {
  setLang('fr');
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

const MAJEUR = {
  severite: 'majeur',
  critere: 'securite',
  fichier: 'src/auth.ts',
  preuve: 'le jeton est comparé avec ==',
  proposition: 'timingSafeEqual',
};
const MINEUR = {
  severite: 'mineur',
  critere: 'tests',
  fichier: '',
  preuve: 'le cas du jeton vide n’a pas de test',
  proposition: '',
};

/** La contre-revue de codex, telle que la Reine la rangerait depuis son marqueur. */
function evaluationRelue(findings: readonly Record<string, unknown>[], libres: string[] = []) {
  const constats: Constat[] = lireConstats(findings) ?? [];
  const avis = lireAvis(
    'n2',
    'codex',
    `valide\nHIVE_CRITIQUE ${JSON.stringify({ verdict: 'valide', findings })}`,
  );
  const conteste = !avis.valide;
  const input: EvaluatorInput = {
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
    crossReview: {
      source: 'hive_counter_review',
      taskId: 't1',
      resultId: 1,
      status: conteste ? 'improvement_required' : 'applied',
      decision: conteste ? 'ameliorer' : 'appliquer',
      reviewers: [
        {
          relectureTaskId: 'r1',
          reviewerNodeId: 'n2',
          reviewerAgent: 'codex',
          producerAgent: 'claude-code',
          decision: conteste ? 'ameliorer' : 'appliquer',
          reason: avis.objections[0] ?? '',
          recordedAt: 1,
        },
      ],
      objections: [...avis.objections, ...libres],
      findings: constats,
      reviewerCount: 1,
      contestingReviewers: conteste ? 1 : 0,
      approvingReviewers: conteste ? 0 : 1,
      recordedAt: 1,
    },
  };
  return evaluate(input);
}

function monter(findings: readonly Record<string, unknown>[], libres: string[] = []) {
  const evaluation = evaluationRelue(findings, libres);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<EvaluationPanel evaluation={evaluation} error={null} />));
  return { dom: conteneur, evaluation };
}

describe('Miellerie — les constats sous le verdict de l’Evaluator', () => {
  it('COMPTE PAR CRITÈRE, puis chaque constat : le bloquant marqué, la remarque non', () => {
    const { dom, evaluation } = monter([MAJEUR, MINEUR]);
    expect(evaluation.decision).toBe('correction_required');

    expect(dom.querySelector('[data-testid="mi-cross-review-criteres"]')?.textContent).toBe(
      'sécurité 1 majeur · tests 1 mineur',
    );
    const constats = [...dom.querySelectorAll('[data-testid="mi-cross-review-findings"] li')];
    expect(constats.map((li) => li.getAttribute('data-severite'))).toEqual(['majeur', 'mineur']);
    expect(constats[0]?.classList.contains('high')).toBe(true);
    expect(constats[1]?.classList.contains('high')).toBe(false);
    expect(constats[0]?.textContent).toContain('majeur · sécurité · src/auth.ts');
    expect(constats[0]?.textContent).toContain('le jeton est comparé avec ==');
    expect(constats[0]?.textContent).toContain('→ timingSafeEqual');
  });

  it('un constat bloquant ne se lit pas deux fois ; une objection libre reste listée', () => {
    const [majeur] = lireConstats([MAJEUR]) ?? [];
    const { dom } = monter([MAJEUR], ['le cas vide plante (relecteur en texte libre)']);
    const objections =
      dom.querySelector('[data-testid="mi-cross-review-objections"]')?.textContent ?? '';
    expect(objections).toContain('le cas vide plante');
    expect(objections).not.toContain(texteConstat(majeur!));
  });

  it('une production acceptée garde ses remarques à l’écran', () => {
    const { dom, evaluation } = monter([MINEUR]);
    expect(evaluation.decision).toBe('accepted');
    expect(dom.querySelector('.mi-cons-sens')?.textContent).toContain(
      '1 remarque(s) non bloquante(s)',
    );
    expect(dom.querySelector('[data-testid="mi-cross-review-criteres"]')?.textContent).toBe(
      'tests 1 mineur',
    );
  });

  it('sans constat structuré, le dire — pas une case vide', () => {
    const { dom } = monter([]);
    expect(dom.querySelector('[data-testid="mi-cross-review-criteres"]')?.textContent).toBe(
      'aucun constat structuré',
    );
    expect(dom.querySelector('[data-testid="mi-cross-review-findings"]')).toBeNull();
  });
});

describe('War Room — les comptes suivent l’avis', () => {
  const ligne = (payload: Record<string, unknown>) => {
    const [entree] = entreesWarRoom([
      {
        id: 1,
        ts: 1,
        type: 'contre_expertise_verdict',
        payload: { taskId: 't1', resultId: 1, relecteur: 'codex', objections: [], ...payload },
      },
    ]);
    return direEntree(
      entree!,
      (fr) => fr,
      (id) => id,
    ).texte;
  };

  it('sous un « conteste », sur quoi ; sous un « valide », que des remarques existent', () => {
    expect(ligne({ conteste: true, findings: [MAJEUR, MINEUR] })).toBe(
      'codex conteste — constats : sécurité 1 majeur · tests 1 mineur',
    );
    expect(ligne({ conteste: false, findings: [MINEUR] })).toBe(
      'codex valide la production — constats : tests 1 mineur',
    );
    expect(ligne({ conteste: false })).toBe('codex valide la production');
  });

  it('un marqueur illisible se dit : l’avis a été lu en texte libre', () => {
    expect(ligne({ conteste: true, objections: ['x'], marqueur: 'illisible' })).toBe(
      'codex conteste : x (marqueur HIVE_CRITIQUE illisible — lu en texte libre)',
    );
  });
});
