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
import { PORTE_SANS_RAPPORT } from '../src/shared/porte-securite';
import {
  ETATS_PAR_RAISON,
  PANNES_ENVIRONNEMENT,
  type PanneEnvironnement,
  type RaisonControle,
} from '../src/shared/validations-bac';
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
      crossReviewPending: 0,
      crossReview: {
        source: 'hive_counter_review',
        taskId: 't1',
        resultId: 4,
        status: 'missing',
        reviewers: [],
        objections: [],
        findings: [],
        reviewerCount: 0,
        contestingReviewers: 0,
        approvingReviewers: 0,
        recordedAt: 0,
      },
      humanReview: 'missing',
      securite: PORTE_SANS_RAPPORT,
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

describe('panneau Evaluator — la porte de sécurité', () => {
  it('NON VÉRIFIÉE SE LIT COMME TELLE — volet par volet, avec sa raison, jamais en vert', () => {
    const vue = monter(evaluation(bac));
    const ligne = parTestId(vue, 'mi-porte-securite')?.textContent ?? '';
    expect(ligne).toContain('secrets non_verifie (aucun rapport du nœud');
    expect(ligne).toContain('dépendances non_verifie');
    expect(ligne).not.toContain('rien_trouve');
  });

  it('UN CONSTAT EST COMPTÉ, AVEC L’OUTIL QUI L’A VU', () => {
    const e = evaluation(bac);
    e.evidence.securite = {
      secrets: {
        etat: 'constat',
        raison: 'trouve',
        outil: { nom: 'betterleaks', version: '1.9.0' },
        constats: [{ regle: 'aws-access-token', fichier: 'src/config.ts', ligne: 2 }],
        total: 1,
      },
      dependances: { etat: 'rien_trouve', raison: 'aucun_lockfile', constats: [], total: 0 },
    };
    const ligne = parTestId(monter(e), 'mi-porte-securite')?.textContent ?? '';
    expect(ligne).toContain('secrets constat ×1 (constat · betterleaks 1.9.0)');
    expect(ligne).toContain('dépendances rien_trouve (aucun lockfile touché)');
  });

  it('UNE RAISON QUE CET ÉCRAN NE CONNAÎT PAS (Reine plus récente) se lit telle quelle — le panneau ne tombe pas', () => {
    const e = evaluation(bac);
    e.evidence.securite = {
      secrets: { etat: 'non_verifie', raison: 'raison_de_demain', constats: [], total: 0 },
      dependances: {
        etat: 'rien_trouve',
        raison: 'analyse_propre',
        outil: { nom: 'osv-scanner', version: '2.6.0' },
        constats: [],
        total: 0,
        nonInterroges: 2,
      },
    } as unknown as typeof e.evidence.securite;
    const ligne = parTestId(monter(e), 'mi-porte-securite')?.textContent ?? '';
    expect(ligne).toContain('secrets non_verifie (raison_de_demain)');
    expect(ligne).toContain(
      'dépendances rien_trouve (rien trouvé · osv-scanner 2.6.0 · 2 non interrogé(s))',
    );
  });

  it('UNE REINE ANTÉRIEURE À LA PORTE n’en rend pas — la ligne le dit, sans inventer un « rien »', () => {
    const e = evaluation(bac);
    delete (e.evidence as Partial<typeof e.evidence>).securite;
    expect(parTestId(monter(e), 'mi-porte-securite')?.textContent).toBe(
      'non rapportée par cette Reine',
    );
  });
});

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

  // Chaque panne a SES mots et SON remède : la mémoire, le disque, le DNS se
  // lèvent sur le nœud ; un démon ou un affichage, le bac n'en a jamais —
  // « libérez » y enverrait l'opérateur nulle part.
  const MOTS: Record<PanneEnvironnement, readonly [string, string, string, string]> = {
    memoire: ['mémoire épuisée', 'libérez de la mémoire', 'out of memory', 'free memory'],
    disque: ['disque plein', 'libérez de la place', 'disk full', 'free disk space'],
    dns: ['DNS indisponible', 'rétablissez la résolution DNS', 'DNS unavailable', 'restore DNS'],
    demon: [
      'démon de conteneurs injoignable',
      'apportez la CI GitHub',
      'container daemon unreachable',
      'bring GitHub CI',
    ],
    affichage: ['aucun affichage', 'apportez la CI GitHub', 'no display', 'bring GitHub CI'],
  };
  it.each(PANNES_ENVIRONNEMENT)('la panne %s se dit, avec son remède', (panne) => {
    const detail = { raison: 'environnement', panne, script: 'test', code: 137 } as const;
    const fr = texteControle(detail, (f) => f);
    const en = texteControle(detail, (_f, e) => e);
    const [nomFr, remedeFr, nomEn, remedeEn] = MOTS[panne];
    expect(fr).toContain(`(${nomFr}), verdict inconnu — `);
    expect(fr).toContain(remedeFr);
    expect(en).toContain(`(${nomEn}), verdict unknown — `);
    expect(en).toContain(remedeEn);
    if (panne === 'demon' || panne === 'affichage') {
      expect(fr, 'rien à libérer dans le bac').not.toContain('libérez');
      expect(en).not.toContain('free ');
    }
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

// G11b — des tests comparés à la base : l'écran dit ce qui bloque, ce qui
// reste rouge SANS bloquer, et ce que la comparaison a coûté. Un `passed` du
// bac qui tairait ses tests rouges serait un vert muet.
describe('panneau Evaluator — les tests comparés à la base (G11b)', () => {
  const aucun = { total: 0, noms: [] };
  const comparaison = {
    format: 'node-test' as const,
    executions: { tete: 2, base: 2 },
    memoire: false,
    surcoutMs: 12_000,
    regressions: aucun,
    dejaRouges: aucun,
    instables: aucun,
    ciblesPassees: aucun,
  };

  it('un test déjà rouge à la base se lit sur la ligne verte — dans les deux langues', () => {
    const detail = {
      raison: 'comparee',
      script: 'test',
      code: 1,
      comparaison: {
        ...comparaison,
        executions: { tete: 1, base: 1 },
        dejaRouges: { total: 3, noms: ['ancien', 'vieux'] },
      },
    } as const;
    const fr = texteControle(detail, (f) => f);
    const en = texteControle(detail, (_f, e) => e);
    expect(fr).toContain('npm run test → 1 · comparé test par test à la base');
    expect(fr).toContain(
      'déjà rouge à la base, du même échec, non bloquant : ancien ; vieux ; … et 1 autre(s)',
    );
    expect(fr).toContain('base rejouée à part, 12 s de plus');
    expect(en).toContain(
      'already red at the base, with the same failure, not blocking: ancien ; vieux ; … and 1 more',
    );
  });

  it('la régression d’abord, nommée — et le panneau la montre sur la ligne des tests', () => {
    const provenance: ValidationProvenance = {
      ...bac,
      details: {
        ...bac.details,
        tests: {
          raison: 'comparee',
          script: 'test',
          code: 1,
          comparaison: {
            ...comparaison,
            regressions: { total: 1, noms: ['additionne'] },
            dejaRouges: { total: 1, noms: ['ancien'] },
          },
        },
      },
    };
    const vue = monter({
      ...evaluation(provenance),
      evidence: { ...evaluation(provenance).evidence, tests: 'failed' },
    });
    const ligne = parTestId(vue, 'mi-validation-details')?.querySelector('li');
    expect(ligne?.getAttribute('data-etat')).toBe('failed');
    expect(ligne?.textContent).toContain(
      'régression : additionne — rouge à chaque exécution, jamais à la base · ' +
        'déjà rouge à la base, du même échec, non bloquant : ancien',
    );
  });

  it('instable : ni régression ni vert ; une base tirée de la mémoire du nœud le dit', () => {
    const detail = {
      raison: 'instable',
      script: 'test',
      code: 1,
      comparaison: {
        ...comparaison,
        memoire: true,
        instables: { total: 1, noms: ['vacille une fois'] },
      },
    } as const;
    const fr = texteControle(detail, (f) => f);
    expect(fr).toContain(
      'instable : vacille une fois — vu rouge à une exécution et vert à une autre, de la production ou de la base',
    );
    expect(fr).toContain('ni régression ni vert, verdict inconnu');
    expect(fr).toContain('base déjà rejouée sur ce nœud');
  });
});
