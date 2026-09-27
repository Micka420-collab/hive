// Evaluator de livraison (v1) : transforme les faits déjà produits par la
// ruche en un verdict indépendant du Worker qui a écrit le résultat.
//
// Le module ne lance rien, ne lit aucune base et ne juge jamais le Worker sur
// sa propre déclaration. Il compose les signaux qui ont chacun un propriétaire
// différent : résultat reçu, inspection des Gardiennes, validations explicites,
// contre-revue, Parlement et revue humaine. Une preuve manquante reste
// manquante ; elle ne devient jamais un succès par défaut.
//
// ─── CE QUI FAIT `accepted` ──────────────────────────────────────────────────
//
// Un résultat réussi, des Gardiennes propres, les quatre validations vertes, et
// UNE contre-revue favorable venue d'une AUTRE famille d'agent que celle qui a
// produit — aucune objection, aucune relecture encore en vol.
//
// Le Parlement n'en fait PAS partie, et c'est voulu. `accepted` exigeait un
// consensus `elected`, que `parliament.ts` déclare lui-même hors d'atteinte sur
// du code libre : deux agents n'écrivent jamais les mêmes octets. L'Evaluator
// ne pouvait donc jamais accepter une vraie production, et il le disait avec un
// motif (« la relecture croisée n'a pas atteint le quorum ») qui contredisait
// la contre-revue favorable affichée juste à côté. `elected` reste un signal
// supplémentaire : cité quand il existe, bloquant quand le résultat livré n'est
// pas celui que le Parlement a élu — jamais une condition.
//
// UNE relecture suffit, pas deux : exiger deux familles distinctes rendrait une
// ruche de deux familles (un producteur, un relecteur) incapable d'accepter
// quoi que ce soit, pour toujours.

import type { Inspection } from './gardiennes.js';
import { signatureOf, type Verdict as ParliamentVerdict } from './parliament.js';
import type { TaskResult } from '../shared/types.js';

export const VERSION_EVALUATOR = 1;

export type EvaluationDecision =
  | 'accepted'
  | 'correction_required'
  | 'rejected'
  | 'additional_test_required'
  | 'human_review_required';

export type ValidationState = 'passed' | 'failed' | 'missing';

/** Validation produite par un outil extérieur identifiable (CI, runner, etc.). */
export interface ValidationEvidence {
  tests: ValidationState;
  typecheck: ValidationState;
  build: ValidationState;
  lint: ValidationState;
}

/** Provenance de la validation, conservée avec le verdict plutôt que déduite. */
export interface ValidationProvenance {
  source: 'github_pull_request';
  taskId: string;
  projectId: string;
  resultId: number;
  depot: string;
  pr: number;
  branch: string;
  commitSha: string;
  recordedAt: number;
}

/** Avis individuel d'un Worker distinct sur la production relue. */
export interface CrossReviewVote {
  relectureTaskId: string;
  reviewerNodeId: string;
  reviewerAgent: string;
  /**
   * Famille d'agent qui a PRODUIT le résultat relu, telle que consignée avec
   * l'avis (`producteur`). Sans elle, l'indépendance du relecteur serait une
   * supposition : c'est ce champ qui permet à l'Evaluator de la VÉRIFIER
   * plutôt que de croire le module qui a choisi les relecteurs.
   */
  producerAgent: string;
  decision: 'appliquer' | 'ameliorer';
  reason: string;
  recordedAt: number;
}

export type CrossReviewStatus = 'missing' | 'applied' | 'improvement_required';

/** Résumé agrégé des contre-revues liées à une production exacte. */
export interface CrossReviewEvidence {
  source: 'hive_counter_review';
  taskId: string;
  resultId: number | null;
  status: CrossReviewStatus;
  decision?: 'appliquer' | 'ameliorer';
  reviewers: readonly CrossReviewVote[];
  objections: readonly string[];
  reviewerCount: number;
  contestingReviewers: number;
  approvingReviewers: number;
  recordedAt: number;
}

/** Preuve explicite qu'aucun avis n'est rattaché à cette production. */
export function missingCrossReviewEvidence(
  taskId: string,
  resultId: number | null,
): CrossReviewEvidence {
  return {
    source: 'hive_counter_review',
    taskId,
    resultId,
    status: 'missing',
    reviewers: [],
    objections: [],
    reviewerCount: 0,
    contestingReviewers: 0,
    approvingReviewers: 0,
    recordedAt: 0,
  };
}

export interface EvaluatorInput {
  taskId: string;
  taskStatus: string;
  results: readonly TaskResult[];
  inspection?: Pick<Inspection, 'verdict' | 'score' | 'griefs'>;
  consensus?: ParliamentVerdict;
  humanReview?: 'approved' | 'rejected' | null;
  /**
   * Les validations ne sont pas déduites des logs : elles doivent être
   * apportées par un producteur de preuve identifié. L'absence est explicite.
   */
  validation?: Partial<ValidationEvidence>;
  validationProvenance?: ValidationProvenance;
  /** Preuve facultative : quand elle existe, le verdict de la contre-revue gouverne. */
  crossReview?: CrossReviewEvidence;
  /**
   * Relectures lancées pour CE résultat et encore en vol. Le premier avis
   * favorable arrivé ne vaut pas acceptation tant qu'un autre relecteur peut
   * encore objecter : une objection reste bloquante, d'où qu'elle vienne.
   * Absent : aucune relecture connue en vol.
   */
  crossReviewPending?: number;
}

export interface EvaluationEvidence {
  result: 'passed' | 'failed' | 'missing';
  /** Le résultat livré doit être celui que le Parlement a élu. */
  resultAlignment: 'aligned' | 'mismatch' | 'unknown';
  gardiennes: 'clean' | 'suspect' | 'hollow' | 'missing';
  consensus: 'elected' | 'no_quorum' | 'no_ballots' | 'missing';
  tests: ValidationState;
  typecheck: ValidationState;
  build: ValidationState;
  lint: ValidationState;
  validationProvenance?: ValidationProvenance;
  crossReview: CrossReviewEvidence;
  /** Relectures de ce résultat lancées et encore sans avis (voir `EvaluatorInput`). */
  crossReviewPending: number;
  humanReview: 'approved' | 'rejected' | 'missing';
}

export interface EvaluationResult {
  version: typeof VERSION_EVALUATOR;
  taskId: string;
  decision: EvaluationDecision;
  /** Peut être affiché sans transformer le verdict en autorisation de merge. */
  canMerge: boolean;
  retryRecommended: boolean;
  reasons: string[];
  evidence: EvaluationEvidence;
}

const validationKeys = ['tests', 'typecheck', 'build', 'lint'] as const;

function stateOf(value: ValidationState | undefined): ValidationState {
  return value === 'passed' || value === 'failed' ? value : 'missing';
}

/**
 * Rend le verdict de l'Evaluator. L'ordre des règles est volontaire : un
 * échec ou un résultat creux est plus important qu'une validation verte ; un
 * rejet humain compte avant une inspection absente ; une validation absente
 * reste ensuite un manque de preuve, jamais un feu vert ; et la contre-revue
 * d'une autre famille ferme la marche — c'est elle qui fait `accepted`.
 */
export function evaluate(input: EvaluatorInput): EvaluationResult {
  const latest = input.results[input.results.length - 1];
  const crossReview =
    input.crossReview ?? missingCrossReviewEvidence(input.taskId, latest?.resultId ?? null);
  const validation: ValidationEvidence = {
    tests: stateOf(input.validation?.tests),
    typecheck: stateOf(input.validation?.typecheck),
    build: stateOf(input.validation?.build),
    lint: stateOf(input.validation?.lint),
  };
  const resultAlignment =
    latest && input.consensus?.outcome === 'elected'
      ? input.consensus.winner && signatureOf(latest.diff) === input.consensus.winner.signature
        ? 'aligned'
        : 'mismatch'
      : 'unknown';
  const crossReviewPending = input.crossReviewPending ?? 0;
  const evidence: EvaluationEvidence = {
    result: latest ? (latest.success ? 'passed' : 'failed') : 'missing',
    resultAlignment,
    gardiennes: input.inspection?.verdict ?? 'missing',
    consensus: input.consensus?.outcome ?? 'missing',
    tests: validation.tests,
    typecheck: validation.typecheck,
    build: validation.build,
    lint: validation.lint,
    humanReview: input.humanReview ?? 'missing',
    ...(input.validationProvenance ? { validationProvenance: input.validationProvenance } : {}),
    crossReview,
    crossReviewPending,
  };

  const reasons: string[] = [];
  const allValidationsPassed = validationKeys.every((key) => validation[key] === 'passed');
  const failedValidation = validationKeys.find((key) => validation[key] === 'failed');
  const missingValidation = validationKeys.filter((key) => validation[key] === 'missing');

  if (!latest) {
    const motif =
      input.taskStatus === 'pending' || input.taskStatus === 'ready'
        ? 'la tâche n’a pas encore produit de résultat'
        : 'aucun résultat Worker';
    return result(input.taskId, 'correction_required', false, true, [motif], evidence);
  }
  if (!latest.success) {
    return result(
      input.taskId,
      'rejected',
      false,
      true,
      ['le dernier résultat a échoué'],
      evidence,
    );
  }
  if (input.inspection?.verdict === 'hollow') {
    return result(
      input.taskId,
      'rejected',
      false,
      true,
      ['les Gardiennes ont rejeté une production creuse'],
      evidence,
    );
  }
  if (input.inspection?.verdict === 'suspect') {
    return result(
      input.taskId,
      'correction_required',
      false,
      true,
      ['les Gardiennes ont relevé un signal suspect'],
      evidence,
    );
  }
  // Le rejet humain passe AVANT l'inspection manquante. Dans l'ordre inverse,
  // une ruche en `HIVE_GARDIENNES=off` (ou dont l'inspection a été élaguée)
  // répondait « revue humaine requise » à l'humain qui venait justement de la
  // rendre : son rejet ne déclenchait aucune correction, sans rien dire.
  if (input.humanReview === 'rejected') {
    return result(
      input.taskId,
      'correction_required',
      false,
      true,
      ['la revue humaine a rejeté la production'],
      evidence,
    );
  }
  if (!input.inspection) {
    return result(
      input.taskId,
      'human_review_required',
      false,
      false,
      ['aucune inspection indépendante des Gardiennes disponible'],
      evidence,
    );
  }
  if (resultAlignment === 'mismatch') {
    return result(
      input.taskId,
      'correction_required',
      false,
      true,
      ['le dernier résultat ne correspond pas à la faction élue'],
      evidence,
    );
  }
  if (crossReview.status === 'improvement_required' || crossReview.decision === 'ameliorer') {
    return result(
      input.taskId,
      'correction_required',
      false,
      true,
      [
        crossReview.objections[0]
          ? `la contre-revue indépendante demande une amélioration : ${crossReview.objections[0]}`
          : 'la contre-revue indépendante demande une amélioration',
      ],
      evidence,
    );
  }
  if (failedValidation) {
    reasons.push(`validation ${failedValidation} en échec`);
    return result(input.taskId, 'correction_required', false, true, reasons, evidence);
  }
  if (!allValidationsPassed) {
    reasons.push(`preuves manquantes : ${missingValidation.join(', ')}`);
    return result(input.taskId, 'additional_test_required', false, false, reasons, evidence);
  }
  if (crossReviewPending > 0) {
    reasons.push(
      `contre-revue en cours : ${crossReviewPending} relecture(s) de ce résultat n’ont pas encore rendu d’avis — une objection resterait bloquante`,
    );
    return result(input.taskId, 'human_review_required', false, false, reasons, evidence);
  }

  // L'indépendance se VÉRIFIE avis par avis, contre la famille consignée du
  // producteur : un avis favorable de la même famille relit ses propres angles
  // morts, et ne compte pas — même si le statut agrégé dit `applied`.
  const independants = crossReview.reviewers.filter(
    (vote) => vote.decision === 'appliquer' && vote.reviewerAgent !== vote.producerAgent,
  );
  if (independants.length === 0) {
    reasons.push(
      crossReview.reviewerCount > 0
        ? 'les avis favorables viennent de la famille d’agent qui a produit : ce n’est pas une relecture indépendante'
        : 'aucune contre-revue d’une autre famille d’agent n’est rattachée à ce résultat : branchez un second agent, ou tranchez en revue humaine',
    );
    return result(input.taskId, 'human_review_required', false, false, reasons, evidence);
  }

  // `accepted` est un verdict de qualité de l'Evaluator, pas une autorisation
  // de fusion : le merge reste explicitement humain (`canMerge` ci-dessous).
  const relecteurs = [...new Set(independants.map((vote) => vote.reviewerAgent))].sort();
  const producteurs = [...new Set(independants.map((vote) => vote.producerAgent))].sort();
  const acceptedReasons = [
    `résultat réussi, Gardiennes propres, validations vertes et contre-revue favorable de ${relecteurs.join(', ')} sur une production de ${producteurs.join(', ')}`,
  ];
  if (input.consensus?.outcome === 'elected') {
    acceptedReasons.push('le Parlement a aussi élu ce résultat (signal supplémentaire)');
  }
  return result(
    input.taskId,
    'accepted',
    input.humanReview === 'approved',
    false,
    acceptedReasons,
    evidence,
  );
}

function result(
  taskId: string,
  decision: EvaluationDecision,
  canMerge: boolean,
  retryRecommended: boolean,
  reasons: string[],
  evidence: EvaluationEvidence,
): EvaluationResult {
  return {
    version: VERSION_EVALUATOR,
    taskId,
    decision,
    canMerge,
    retryRecommended,
    reasons,
    evidence,
  };
}
