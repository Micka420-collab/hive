// Evaluator de livraison (v1) : transforme les faits déjà produits par la
// ruche en un verdict indépendant du Worker qui a écrit le résultat.
//
// Le module ne lance rien, ne lit aucune base et ne juge jamais le Worker sur
// sa propre déclaration. Il compose les signaux qui ont chacun un propriétaire
// différent : résultat reçu, inspection des Gardiennes, validations explicites,
// Parlement et revue humaine. Une preuve manquante reste manquante ; elle ne
// devient jamais un succès par défaut.
//
// Les validations ont deux producteurs : la CI GitHub d'une PR, et le bac Hive
// — des commandes que la BASE du dépôt déclarait, lancées par le code du nœud
// après l'agent, jamais déclarées par l'agent lui-même. Elles comptent autant
// l'une que l'autre ; chaque motif qui s'appuie sur elles nomme sa source.

import type { Inspection } from './gardiennes.js';
import { signatureOf, type Verdict as ParliamentVerdict } from './parliament.js';
import type { TaskResult } from '../shared/types.js';
import { VALIDATION_KEYS } from '../shared/validations-bac.js';
import type { DetailControle, ValidationKey, ValidationState } from '../shared/validations-bac.js';

export type { ValidationState } from '../shared/validations-bac.js';

export const VERSION_EVALUATOR = 1;

export type EvaluationDecision =
  | 'accepted'
  | 'correction_required'
  | 'rejected'
  | 'additional_test_required'
  | 'human_review_required';

/** Validation produite par un outil identifiable (CI GitHub, bac Hive). */
export type ValidationEvidence = Record<ValidationKey, ValidationState>;

interface ProvenanceCommune {
  taskId: string;
  projectId: string;
  resultId: number;
  recordedAt: number;
}

/** Contrôles GitHub d'une PR, liés à la branche et au commit livrés. */
export interface ProvenanceGithub extends ProvenanceCommune {
  source: 'github_pull_request';
  depot: string;
  pr: number;
  branch: string;
  commitSha: string;
}

/**
 * Commandes déclarées par le projet, lancées par le nœud producteur dans le bac
 * de la production (`shared/validations-bac.ts`). Elles COMPTENT comme la CI —
 * c'est une décision du produit — mais ne se font jamais passer pour elle : la
 * source reste affichée, et chaque constat dit ce qui a tourné.
 */
export interface ProvenanceBac extends ProvenanceCommune {
  source: 'hive_sandbox';
  nodeId: string;
  baseSha?: string;
  details: Record<ValidationKey, DetailControle>;
}

/** Provenance de la validation, conservée avec le verdict plutôt que déduite. */
export type ValidationProvenance = ProvenanceGithub | ProvenanceBac;

/** Qui a produit la preuve, dit dans les motifs du verdict ; vide sans provenance. */
function origine(provenance: ValidationProvenance | undefined): string {
  if (!provenance) return '';
  return provenance.source === 'hive_sandbox'
    ? `bac Hive du nœud ${provenance.nodeId}`
    : `CI GitHub, PR #${provenance.pr}`;
}

/** Avis individuel d'un Worker distinct sur la production relue. */
export interface CrossReviewVote {
  relectureTaskId: string;
  reviewerNodeId: string;
  reviewerAgent: string;
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

function stateOf(value: ValidationState | undefined): ValidationState {
  return value === 'passed' || value === 'failed' || value === 'not_applicable' ? value : 'missing';
}

/**
 * Rend le verdict de l'Evaluator. L'ordre des règles est volontaire : un
 * échec ou un résultat creux est plus important qu'une validation verte ; une
 * validation absente reste ensuite un manque de preuve, jamais un feu vert.
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
  };

  const reasons: string[] = [];
  const failedValidation = VALIDATION_KEYS.find((key) => validation[key] === 'failed');
  const missingValidation = VALIDATION_KEYS.filter((key) => validation[key] === 'missing');
  const notApplicable = VALIDATION_KEYS.filter((key) => validation[key] === 'not_applicable');
  const source = origine(input.validationProvenance);
  const suffixeSource = source ? ` (${source})` : '';

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
    reasons.push(`validation ${failedValidation} en échec${suffixeSource}`);
    return result(input.taskId, 'correction_required', false, true, reasons, evidence);
  }
  // ─── MANQUANTE ET NON APPLICABLE NE SONT PAS LA MÊME ABSENCE ──────────────
  //
  // `missing` : la preuve devrait exister et n'existe pas (aucun producteur,
  // délai, environnement non préparé…). Elle bloque, toujours.
  //
  // `not_applicable` : le projet ne DÉCLARE pas cette commande. Un projet
  // JavaScript n'a pas de typecheck ; exiger qu'il en ait un rendrait
  // `accepted` inatteignable pour une raison étrangère à la production. Le
  // typecheck, le build et le lint non applicables ne bloquent donc pas — ils
  // restent affichés tels quels, jamais comptés verts. Les TESTS, eux, ne sont
  // jamais dispensés : sans test, rien ne prouve que le code fait ce qu'on lui
  // demande, et l'Evaluator le dit au lieu de conclure.
  if (missingValidation.length > 0) {
    reasons.push(
      `preuves manquantes : ${missingValidation.join(', ')}` +
        (suffixeSource || ' (aucun producteur de preuve : ni bac Hive, ni CI GitHub)'),
    );
    return result(input.taskId, 'additional_test_required', false, false, reasons, evidence);
  }
  if (validation.tests === 'not_applicable') {
    reasons.push(
      `le projet ne déclare aucun test${suffixeSource} : sans test, rien ne prouve le ` +
        'comportement — déclarez un script « test », ou apportez la CI GitHub',
    );
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
  const acceptedReasons = [
    'résultat réussi, Gardiennes propres, validations vertes et consensus atteint',
  ];
  if (source) acceptedReasons.push(`validations : ${source}`);
  if (notApplicable.length > 0) {
    acceptedReasons.push(
      `non applicables, faute de déclaration par le projet : ${notApplicable.join(', ')}`,
    );
  }
  if (crossReview.status === 'applied' || crossReview.decision === 'appliquer') {
    acceptedReasons.push('contre-revue indépendante favorable');
  } else if (crossReview.status === 'missing') {
    acceptedReasons.push(
      'aucune contre-revue indépendante rattachée à ce résultat : preuve séparée manquante',
    );
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
