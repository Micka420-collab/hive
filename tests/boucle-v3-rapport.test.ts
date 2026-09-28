// LE RAPPORT DE RISQUES — ce qu'un humain lit avant de fusionner ce que Hive a
// écrit sur Hive.
//
// Il doit dire : les fichiers touchés (et combien), la porte et qui l'a
// franchie, les validations avec leur source — une absente reste absente —,
// ce que la QA DÉCLARE (présenté comme déclaré), les verdicts de l'Evaluator
// par phase, les relectures croisées (et une relecture de la même famille
// dite comme telle), un extrait de la note d'architecture. Il part sur GitHub :
// caviardé, borné ; un texte d'ouvrière ne peut pas y fermer son bloc, ni y
// devenir une mention, un lien ou une image postés avec le jeton de l'hôte.

import { describe, expect, it } from 'vitest';
import { jugerDiff } from '../src/boucle-v3/garde.js';
import { MAX_RAPPORT, lireEvaluation, rapportDeRisques } from '../src/boucle-v3/rapport.js';
import type { FaitsRapport } from '../src/boucle-v3/rapport.js';
import { creerCaviardeur } from '../src/shared/caviardage.js';

const JETON_HOTE = 'jeton-de-la-ruche-tres-secret-42';

const DIFF_COMPTES = [
  'diff --git a/src/orchestrator/comptes.ts b/src/orchestrator/comptes.ts',
  '--- a/src/orchestrator/comptes.ts',
  '+++ b/src/orchestrator/comptes.ts',
  '@@ -1,2 +1,3 @@',
  ' garde',
  '-avant',
  '+après',
  '+encore',
  '',
].join('\n');

const DIFF_DOC = [
  'diff --git a/docs/ETAPES.md b/docs/ETAPES.md',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/docs/ETAPES.md',
  '@@ -0,0 +1 @@',
  '+note',
  '',
].join('\n');

const DIFF = DIFF_COMPTES + DIFF_DOC;

const evaluation = (surcharge: Record<string, unknown> = {}) =>
  lireEvaluation({
    decision: 'human_review_required',
    reasons: ['aucune revue humaine', 'build absent'],
    evidence: {
      tests: 'passed',
      typecheck: 'failed',
      build: 'missing',
      lint: 'not_applicable',
      validationProvenance: { source: 'hive_sandbox', nodeId: 'n-bac' },
      crossReview: {
        reviewers: [
          {
            reviewerAgent: 'codex',
            producerAgent: 'claude-code',
            decision: 'appliquer',
            reason: 'ok',
          },
          {
            reviewerAgent: 'claude-code',
            producerAgent: 'claude-code',
            decision: 'ameliorer',
            reason: `fuite HIVE_TOKEN=${JETON_HOTE} et ghp_${'a'.repeat(36)}`,
          },
        ],
      },
      crossReviewPending: 0,
      humanReview: 'approved',
      ...surcharge,
    },
  });

const faits = (surcharge: Partial<FaitsRapport> = {}): FaitsRapport => ({
  mission: 'Durcir les comptes',
  projetId: 'p1',
  architecture: {
    taskId: 'v3-g-architecture',
    statut: 'done',
    evaluation: evaluation(),
    note: 'Toucher comptes.ts\n```\nfin du bloc ? non\n```',
  },
  implementation: {
    taskId: 'v3-g-implementation',
    statut: 'done',
    evaluation: evaluation(),
    note: null,
    resultId: 7,
    diff: DIFF,
  },
  qa: {
    taskId: 'v3-g-qa',
    statut: 'done',
    evaluation: evaluation(),
    note: 'npm run typecheck → 2 (TS2322)',
  },
  garde: jugerDiff(DIFF),
  validation: 'approuvee',
  relecture: 'rendue',
  livraison: {
    pr: 9,
    urlPr: 'https://github.com/o/r/pull/9',
    branche: 'hive/x',
    commitSha: 'abcdef0123456789',
  },
  ...surcharge,
});

const CAVIARDEUR = creerCaviardeur([JETON_HOTE]);

describe('le rapport de risques', () => {
  it('dit les fichiers, la porte, les validations, la QA, les verdicts et les relectures', () => {
    const r = rapportDeRisques(faits(), CAVIARDEUR);
    expect(r).toContain('### Fichiers touchés (2)');
    expect(r).toContain('- `src/orchestrator/comptes.ts` — modification (+2 −1)');
    expect(r).toContain('- `docs/ETAPES.md` — creation (+1 −0)');
    expect(r).toContain('Surfaces sensibles touchées — **validées par un humain**');
    expect(r).toContain('| `src/orchestrator/comptes.ts` | securite |');
    expect(r).toContain('- tests : ✔ réussie');
    expect(r).toContain('- typecheck : ✘ échouée');
    expect(r).toContain('- build : ? absente');
    expect(r).toContain('- lint : — sans objet');
    expect(r).toContain('- source : bac Hive du nœud n-bac');
    expect(r).toMatch(/DÉCLARÉ par l’ouvrière QA, non constaté par la Reine/);
    expect(r).toContain('npm run typecheck → 2 (TS2322)');
    expect(r).toContain(
      '- implémentation (done) : `human_review_required` — `aucune revue humaine` ; `build absent`',
    );
    expect(r).toContain('- `codex` relit `claude-code` (croisée) : `appliquer` — `ok`');
    expect(r).toContain('- `claude-code` relit `claude-code` (MÊME FAMILLE) : `ameliorer`');
    expect(r).toContain('commit `abcdef012345`');
    expect(r).toMatch(/La boucle ne fusionne jamais/);
  });

  it('CE QUI PART CHEZ GITHUB EST CAVIARDÉ — valeur de l’hôte et jeton littéral', () => {
    const r = rapportDeRisques(faits(), CAVIARDEUR);
    expect(r).not.toContain(JETON_HOTE);
    expect(r).not.toContain(`ghp_${'a'.repeat(36)}`);
    expect(r).toContain('[secret]');
  });

  it('un texte d’ouvrière ne ferme pas son bloc de citation', () => {
    const r = rapportDeRisques(faits(), CAVIARDEUR);
    const extrait = r.slice(r.indexOf('### Architecture'));
    // Un seul bloc ouvert, un seul fermé : les ``` de la note sont désamorcés.
    expect(extrait.match(/^```/gm)).toHaveLength(2);
  });

  it('ce qui manque est DIT manquant : QA non lancée, relecture impossible, porte libre', () => {
    const libre = jugerDiff(DIFF_DOC);
    expect(rapportDeRisques(faits({ garde: libre, validation: 'absente' }), CAVIARDEUR)).toContain(
      'Aucune surface sensible touchée, et relue par une autre famille',
    );
    const r = rapportDeRisques(
      faits({
        garde: libre,
        validation: 'approuvee',
        relecture: 'absente',
        qa: {
          taskId: null,
          statut: 'non_lancee',
          evaluation: null,
          note: null,
          pourquoi: 'diff trop long',
        },
        implementation: {
          ...faits().implementation,
          evaluation: evaluation({
            crossReview: { reviewers: [] },
            crossReviewImpossible: 'aucune autre famille',
          }),
        },
      }),
      CAVIARDEUR,
    );
    expect(r).toContain('⚠ Aucune relecture d’une autre famille — **validées par un humain**');
    expect(r).toContain('QA : non lancée — diff trop long.');
    expect(r).toContain('- QA : non lancée — diff trop long');
    expect(r).toContain('Aucune relecture croisée : `aucune autre famille`.');
  });

  it('LE TITRE COMPTE LES FICHIERS LIVRÉS — pas les chemins que seuls nomment les en-têtes', () => {
    const renommage = [
      'diff --git a/src/shared/caviardage.ts b/docs/ancien.ts',
      'similarity index 100%',
      'rename from src/shared/caviardage.ts',
      'rename to docs/ancien.ts',
      '',
    ].join('\n');
    const diff = DIFF_DOC + renommage;
    const r = rapportDeRisques(
      faits({
        garde: jugerDiff(diff),
        implementation: { ...faits().implementation, diff },
      }),
      CAVIARDEUR,
    );
    // La porte a lu trois chemins ; la livraison n'en écrit qu'un.
    expect(jugerDiff(diff).fichiers).toHaveLength(3);
    expect(r).toContain('### Fichiers touchés (1)\n- `docs/ETAPES.md` — creation (+1 −0)');
    expect(r).toContain('| `src/shared/caviardage.ts` | securite |');
  });

  it('UN TEXTE D’AGENT RESTE INERTE : ni mention, ni lien, ni image dans le commentaire', () => {
    const piege = '@Micka420-collab ![x](http://t.example/p.png) [ici](javascript:alert(1)) `fin';
    const r = rapportDeRisques(
      faits({
        implementation: {
          ...faits().implementation,
          evaluation: evaluation({
            crossReview: {
              reviewers: [
                {
                  reviewerAgent: 'codex',
                  producerAgent: 'claude-code',
                  decision: 'appliquer',
                  reason: piege,
                },
              ],
            },
          }),
        },
        qa: {
          ...faits().qa,
          evaluation: lireEvaluation({ decision: 'accepted', reasons: [piege] }),
        },
      }),
      CAVIARDEUR,
    );
    const inerte =
      "`@Micka420-collab ![x](http://t.example/p.png) [ici](javascript:alert(1)) 'fin`";
    expect(r).toContain(`(croisée) : \`appliquer\` — ${inerte}`);
    expect(r).toContain(`- QA (done) : \`accepted\` — ${inerte}`);
    // Hors code, le piège n'apparaît nulle part.
    expect(r.replaceAll(inerte, '')).not.toContain('@Micka420-collab');
  });

  it('borné sous la limite d’un commentaire GitHub', () => {
    const avis = {
      reviewerAgent: 'codex',
      producerAgent: 'claude-code',
      decision: 'ameliorer',
      reason: 'x'.repeat(1_000),
    };
    const bavarde = evaluation({
      crossReview: { reviewers: Array.from({ length: 400 }, () => avis) },
    });
    const r = rapportDeRisques(
      faits({ implementation: { ...faits().implementation, evaluation: bavarde } }),
      CAVIARDEUR,
    );
    expect(r.length).toBeLessThan(65_536);
    expect(r).toContain(`[rapport tronqué à ${MAX_RAPPORT} caractères]`);
  });
});
