import { describe, expect, it } from 'vitest';
import { evaluate, type CrossReviewEvidence } from '../src/orchestrator/evaluator.js';
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

/**
 * Contre-revue telle que le store l'agrège. Le producteur est `claude-code` ;
 * les relecteurs viennent par défaut de deux AUTRES familles, comme
 * `choisirCritiques` les choisit. `relecteurs` fixe l'AUTEUR réel de chaque
 * avis : une relecture remise en file, ou courue à la main, peut être rendue
 * par un autre nœud que celui qu'on avait choisi — y compris de la famille qui
 * a produit.
 */
const crossReview = (
  order: Array<'appliquer' | 'ameliorer'>,
  relecteurs: readonly string[] = ['codex', 'hermes-agent'],
): CrossReviewEvidence => ({
  source: 'hive_counter_review',
  taskId: 'task-1',
  resultId: 1,
  status: order.includes('ameliorer') ? 'improvement_required' : 'applied',
  decision: order.includes('ameliorer') ? 'ameliorer' : 'appliquer',
  reviewers: order.map((decision, index) => ({
    relectureTaskId: `review-${index + 1}`,
    reviewerNodeId: `reviewer-${index + 1}`,
    reviewerAgent: relecteurs[index] ?? 'codex',
    producerAgent: 'claude-code',
    decision,
    reason: decision === 'ameliorer' ? 'le cas limite n’est pas traité' : '',
    recordedAt: index + 1,
  })),
  objections: order.includes('ameliorer') ? ['le cas limite n’est pas traité'] : [],
  reviewerCount: order.length,
  contestingReviewers: order.filter((decision) => decision === 'ameliorer').length,
  approvingReviewers: order.filter((decision) => decision === 'appliquer').length,
  recordedAt: order.length,
});

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

  it('sans contre-revue d une autre famille, le verdict reste humain — et ne parle pas de quorum', () => {
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
    expect(verdict.reasons.join(' ')).toContain('autre famille');
    // Sans avis, l'Evaluator ne sait pas SI le second modèle manquait ou si sa
    // relecture a échoué : le motif nomme les deux plutôt que d'envoyer
    // l'opérateur brancher un agent peut-être déjà branché.
    expect(verdict.reasons.join(' ')).toContain('relecture échouée');
    expect(verdict.reasons.join(' ')).not.toContain('branchez un second agent');
    // Le Parlement n'est plus une condition : l'invoquer serait mentir sur
    // ce qui manque réellement.
    expect(verdict.reasons.join(' ')).not.toContain('quorum');
  });

  // ─── LE CAS QUE L'EVALUATOR NE POUVAIT JAMAIS RENDRE ─────────────────────
  //
  // Deux agents n'écrivent jamais les mêmes octets : sur du code, le Parlement
  // rend `no_quorum`. Tant que `accepted` exigeait `elected`, une production
  // réussie, propre, validée et relue favorablement par une autre famille
  // restait « revue humaine requise » pour toujours.
  it('accepte une production relue favorablement par une autre famille, sans quorum du Parlement', () => {
    const delivered = result(true, 'n1');
    const sansQuorum = tally([
      {
        nodeId: 'n1',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf(delivered.diff),
        fichiers: ['src/a.ts'],
      },
    ]);
    expect(sansQuorum.outcome).toBe('no_quorum');
    const entree = {
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: validations,
      consensus: sansQuorum,
      crossReview: crossReview(['appliquer'], ['codex']),
    };

    const avantHumain = evaluate(entree);
    expect(avantHumain.decision).toBe('accepted');
    expect(avantHumain.retryRecommended).toBe(false);
    // `accepted` est un verdict de qualité : sans l'humain, pas de fusion.
    expect(avantHumain.canMerge).toBe(false);
    expect(avantHumain.reasons.join(' ')).toContain('contre-revue favorable de codex');

    const approuve = evaluate({ ...entree, humanReview: 'approved' });
    expect(approuve.decision).toBe('accepted');
    expect(approuve.canMerge).toBe(true);
  });

  it('un consensus élu reste un signal en plus, jamais une relecture à lui seul', () => {
    const delivered = result(true, 'n1');
    const consensus = tally([
      {
        nodeId: 'n1',
        agentType: 'codex',
        success: true,
        signature: signatureOf(delivered.diff),
        fichiers: ['src/a.ts'],
      },
      {
        nodeId: 'n2',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf(delivered.diff),
        fichiers: ['src/a.ts'],
      },
    ]);
    const entree = {
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: validations,
      consensus,
      humanReview: 'approved' as const,
    };

    const seul = evaluate(entree);
    expect(seul.decision).toBe('human_review_required');
    expect(seul.canMerge).toBe(false);

    const relu = evaluate({ ...entree, crossReview: crossReview(['appliquer']) });
    expect(relu.decision).toBe('accepted');
    expect(relu.canMerge).toBe(true);
    expect(relu.retryRecommended).toBe(false);
    expect(relu.reasons.join(' ')).toContain('Parlement');
  });

  it('un avis favorable de la famille qui a produit ne vaut pas relecture indépendante', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      inspection: clean,
      validation: validations,
      humanReview: 'approved',
      // Le statut agrégé dit `applied` : c'est l'avis, pas le statut, qui
      // doit prouver l'indépendance.
      crossReview: crossReview(['appliquer'], ['claude-code']),
    });
    expect(verdict.evidence.crossReview.status).toBe('applied');
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.canMerge).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('famille d’agent qui a produit');
  });

  it('un avis favorable du `shell` simulé ne vaut pas relecture indépendante', () => {
    // Le `shell` ne lance aucun modèle : son « valide » est un texte fabriqué.
    // `choisirCritiques` ne le choisit jamais ; l'Evaluator applique la même
    // règle à l'auteur réel de l'avis.
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      inspection: clean,
      validation: validations,
      humanReview: 'approved',
      crossReview: crossReview(['appliquer'], ['shell']),
    });
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.canMerge).toBe(false);
    expect(verdict.reasons.join(' ')).toContain('agent simulé');
  });

  it('n accepte pas sur le premier avis favorable tant qu une relecture est en vol', () => {
    const entree = {
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      inspection: clean,
      validation: validations,
      humanReview: 'approved' as const,
      crossReview: crossReview(['appliquer'], ['codex']),
    };
    const enVol = evaluate({ ...entree, crossReviewPending: 1 });
    expect(enVol.decision).toBe('human_review_required');
    expect(enVol.canMerge).toBe(false);
    expect(enVol.retryRecommended).toBe(false);
    expect(enVol.evidence.crossReviewPending).toBe(1);
    expect(enVol.reasons.join(' ')).toContain('contre-revue en cours');

    expect(evaluate({ ...entree, crossReviewPending: 0 }).decision).toBe('accepted');
  });

  // ─── UN REJET HUMAIN N'EST PAS UNE INSPECTION MANQUANTE ──────────────────
  //
  // `HIVE_GARDIENNES=off`, ou une inspection élaguée : l'humain rejette, et
  // l'Evaluator lui répondait « revue humaine requise » — sans retry, sans
  // correction, alors que la revue venait d'être rendue.
  it('un rejet humain demande une correction même sans inspection des Gardiennes', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result()],
      humanReview: 'rejected',
    });
    expect(verdict.evidence.gardiennes).toBe('missing');
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.retryRecommended).toBe(true);
    expect(verdict.canMerge).toBe(false);
    expect(verdict.reasons).toEqual(['la revue humaine a rejeté la production']);
  });

  it('refuse un résultat livré qui ne correspond pas à la faction élue', () => {
    const consensus = tally([
      {
        nodeId: 'n1',
        agentType: 'codex',
        success: true,
        signature: signatureOf('diff A'),
        fichiers: ['src/a.ts'],
      },
      {
        nodeId: 'n2',
        agentType: 'claude-code',
        success: true,
        signature: signatureOf('diff A'),
        fichiers: ['src/a.ts'],
      },
    ]);
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [result(true, 'n1'), { ...result(true, 'n3'), diff: 'diff B' }],
      inspection: clean,
      validation: validations,
      consensus,
      humanReview: 'approved',
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.canMerge).toBe(false);
    expect(verdict.retryRecommended).toBe(true);
    expect(verdict.evidence.resultAlignment).toBe('mismatch');
  });

  it('refuse le résultat si une validation a échoué', () => {
    const delivered = result();
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: { ...validations, tests: 'failed' },
      consensus: tally([
        {
          nodeId: 'n1',
          agentType: 'codex',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
        {
          nodeId: 'n2',
          agentType: 'claude-code',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
      ]),
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.reasons).toContain('validation tests en échec');
  });

  it.each([
    ['contestation puis validation', ['ameliorer', 'appliquer']],
    ['validation puis contestation', ['appliquer', 'ameliorer']],
  ] as const)('%s : une objection reste bloquante', (_label, order) => {
    const delivered = result();
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: validations,
      consensus: tally([
        {
          nodeId: 'n1',
          agentType: 'codex',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
        {
          nodeId: 'n2',
          agentType: 'claude-code',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
      ]),
      humanReview: 'approved',
      crossReview: crossReview([...order]),
    });
    expect(verdict.decision).toBe('correction_required');
    expect(verdict.retryRecommended).toBe(true);
    expect(verdict.evidence.crossReview?.decision).toBe('ameliorer');
    expect(verdict.evidence.crossReview?.status).toBe('improvement_required');
    expect(verdict.reasons.join(' ')).toContain('cas limite');
  });

  it('rend explicite l’absence de contre-revue sans la confondre avec une preuve positive', () => {
    const delivered = { ...result(), resultId: 7 };
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [delivered],
      inspection: clean,
      validation: validations,
      consensus: tally([
        {
          nodeId: 'n1',
          agentType: 'codex',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
        {
          nodeId: 'n2',
          agentType: 'claude-code',
          success: true,
          signature: signatureOf(delivered.diff),
          fichiers: ['src/a.ts'],
        },
      ]),
      humanReview: 'approved',
    });
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.canMerge).toBe(false);
    expect(verdict.evidence.crossReview).toMatchObject({
      status: 'missing',
      taskId: 'task-1',
      resultId: 7,
      reviewerCount: 0,
    });
    expect(verdict.reasons.join(' ')).toContain('aucune contre-revue d’une autre famille');
  });
});

// ─── UNE RELECTURE IMPOSSIBLE APPELLE L'HUMAIN, EN LE DISANT ────────────────
//
// La contre-revue est tombée, secours compris (`contre_expertise_impossible`).
// Sans cette règle, l'Evaluator demandait des « tests supplémentaires » : aucune
// CI ne ferait jamais `accepted` sans avis indépendant, l'opérateur partait
// chercher une preuve qui ne débloquait rien.
describe('Evaluator — relecture impossible', () => {
  const CAUSE =
    'codex a échoué (3 tentative(s)) ; aucune autre famille que claude-code (producteur) et codex n’est en ligne pour la relayer';

  it('DEMANDE LA REVUE HUMAINE EN NOMMANT LA CAUSE, même sans CI — et ne relance pas le producteur', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [{ ...result(), resultId: 1 }],
      inspection: clean,
      crossReviewImpossible: CAUSE,
    });
    expect(verdict.decision).toBe('human_review_required');
    // Sans preuve, la personne qui tranche lit aussi qu'aucun test n'a tourné.
    expect(verdict.reasons).toEqual([
      `relecture impossible : ${CAUSE}`,
      'preuves manquantes : tests, typecheck, build, lint (aucun producteur de preuve : ni bac Hive, ni CI GitHub)',
    ]);
    expect(verdict.retryRecommended).toBe(false);
    expect(verdict.canMerge).toBe(false);
    expect(verdict.evidence.crossReviewImpossible).toBe(CAUSE);
  });

  it('une CI en échec reste une faute du PRODUCTEUR : la correction passe avant', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [{ ...result(), resultId: 1 }],
      inspection: clean,
      validation: { ...validations, tests: 'failed' },
      crossReviewImpossible: CAUSE,
    });
    expect(verdict.decision).toBe('correction_required');
  });

  it('UN AVIS ARRIVÉ GOUVERNE : l’impossibilité consignée ne le masque pas', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [{ ...result(), resultId: 1 }],
      inspection: clean,
      validation: validations,
      crossReview: crossReview(['appliquer']),
      crossReviewImpossible: CAUSE,
    });
    expect(verdict.decision).toBe('accepted');
  });

  it('une relecture encore en vol peut rendre l’avis : pas d’impossibilité prononcée', () => {
    const verdict = evaluate({
      taskId: 'task-1',
      taskStatus: 'done',
      results: [{ ...result(), resultId: 1 }],
      inspection: clean,
      crossReviewPending: 1,
      crossReviewImpossible: CAUSE,
    });
    expect(verdict.reasons.join(' ')).not.toMatch(/relecture impossible/);
  });
});
