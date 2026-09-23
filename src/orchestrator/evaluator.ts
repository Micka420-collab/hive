// Evaluator de livraison (v1) : transforme les faits déjà produits par la
// ruche en un verdict indépendant du Worker qui a écrit le résultat.
//
// Le module ne lance rien, ne lit aucune base et ne juge jamais le Worker sur
// sa propre déclaration. Il compose les signaux qui ont chacun un propriétaire
// différent : résultat reçu, inspection des Gardiennes, validations explicites,
// Parlement et revue humaine. Une preuve manquante reste manquante ; elle ne
// devient jamais un succès par défaut.

import type { Inspection } from './gardiennes.js';
import type { Verdict as ParliamentVerdict } from './parliament.js';
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
}

export interface EvaluationEvidence {
  result: 'passed' | 'failed' | 'missing';
  gardiennes: 'clean' | 'suspect' | 'hollow' | 'missing';
  consensus: 'elected' | 'no_quorum' | 'no_ballots' | 'missing';
  tests: ValidationState;
  typecheck: ValidationState;
  build: ValidationState;
  lint: ValidationState;
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
 * échec ou un résultat creux est plus important qu'une validation verte ; une
 * validation absente reste ensuite un manque de preuve, jamais un feu vert.
 */
export function evaluate(input: EvaluatorInput): EvaluationResult {
  const latest = input.results[input.results.length - 1];
  const validation: ValidationEvidence = {
    tests: stateOf(input.validation?.tests),
    typecheck: stateOf(input.validation?.typecheck),
    build: stateOf(input.validation?.build),
    lint: stateOf(input.validation?.lint),
  };
  const evidence: EvaluationEvidence = {
    result: latest ? (latest.success ? 'passed' : 'failed') : 'missing',
    gardiennes: input.inspection?.verdict ?? 'missing',
    consensus: input.consensus?.outcome ?? 'missing',
    tests: validation.tests,
    typecheck: validation.typecheck,
    build: validation.build,
    lint: validation.lint,
    humanReview: input.humanReview ?? 'missing',
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
  if (failedValidation) {
    reasons.push(`validation ${failedValidation} en échec`);
    return result(input.taskId, 'correction_required', false, true, reasons, evidence);
  }
  if (!allValidationsPassed) {
    reasons.push(`preuves manquantes : ${missingValidation.join(', ')}`);
    return result(input.taskId, 'additional_test_required', false, false, reasons, evidence);
  }
  if (input.consensus?.outcome !== 'elected') {
    reasons.push(
      input.consensus?.outcome === 'no_quorum'
        ? 'la relecture croisée n’a pas atteint le quorum'
        : 'aucun consensus indépendant disponible',
    );
    return result(input.taskId, 'human_review_required', false, false, reasons, evidence);
  }

  // `accepted` est un verdict de qualité de l'Evaluator, pas une autorisation
  // de fusion : le merge reste explicitement humain (`canMerge` ci-dessous).
  return result(
    input.taskId,
    'accepted',
    input.humanReview === 'approved',
    false,
    ['résultat réussi, Gardiennes propres, validations vertes et consensus atteint'],
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
