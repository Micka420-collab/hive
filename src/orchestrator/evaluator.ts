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
// Un résultat réussi, des Gardiennes propres, les validations vertes (tests
// toujours ; typecheck, build et lint peuvent être non applicables), et
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
//
// Les validations ont deux producteurs : la CI GitHub d'une PR, et le bac Hive
// — des commandes que la BASE du dépôt déclarait, lancées par le code du nœud
// après l'agent, jamais déclarées par l'agent lui-même. Elles comptent autant
// l'une que l'autre ; chaque motif qui s'appuie sur elles nomme sa source.
//
// Les tests du bac en échec se comparent à la base, test par test (G11b,
// `shared/lecture-tests.ts`) : une RÉGRESSION demande une correction qui la
// NOMME — c'est ce que l'ouvrière lira (`BORNES_CRITIQUE`) ; des tests DÉJÀ
// ROUGES à la base, du même échec, ne bloquent plus, et `accepted` les DIT —
// un vert qui les tairait serait un faux ; des tests INSTABLES ne sont ni l'un
// ni l'autre : preuve manquante.
//
// ─── LA PORTE DE SÉCURITÉ ────────────────────────────────────────────────────
//
// À côté des validations, jamais parmi elles (`shared/porte-securite.ts` dit
// pourquoi) : ce que la production AJOUTE — un secret, une dépendance
// vulnérable que la base n'avait pas. Un constat demande une correction, et
// passe AVANT toute règle qui appelle un humain : `human_review_required` ne
// bloque pas la livraison (`VERDICTS_BLOQUANTS`, server.ts), et une
// approbation ne doit pas laisser partir une clé.
//
// Non vérifiée — outil absent, en échec, nœud sans rapport —, elle n'est
// JAMAIS comptée verte : `accepted` le dit dans ses motifs. Elle ne retient
// la production qu'en polyéthisme `strict`, le mode qui a gouverné CETTE
// production (`polyethismeDe`, server.ts) : c'est le mode où la ruche
// promet de ne rien laisser passer qu'elle n'a pas pu juger (polyethisme.ts,
// règle 5, « fermé par défaut »). Ce qu'elle fait alors est ce que fait une
// contre-visite manquante : la production ATTEND un humain
// (`human_review_required`) — pas une correction, que le producteur ne
// saurait pas faire (il n'installe pas l'outil du nœud), et qui brûlerait ses
// essais jusqu'à `MAX_ATTEMPTS`. Hors de `strict` (le défaut `consignes`), la
// ruche guide sans retenir : faire mordre la porte partout changerait toutes
// les ruches installées, sur une décision que personne n'a prise.

import type { Inspection } from './gardiennes.js';
import { signatureOf, type Verdict as ParliamentVerdict } from './parliament.js';
import { relecteurIndependant } from '../shared/contre-expertise.js';
import { type Constat, constatBloquant } from '../shared/critique-structuree.js';
import {
  DIRE_RAISON_PORTE,
  OUTIL_DU_VOLET,
  PORTE_SANS_RAPPORT,
  VOLETS_PORTE,
} from '../shared/porte-securite.js';
import type { PorteSecurite, VoletPorte } from '../shared/porte-securite.js';
import type { TaskResult } from '../shared/types.js';
import { DIRE_PANNE, VALIDATION_KEYS } from '../shared/validations-bac.js';
import type {
  ComparaisonBase,
  DetailControle,
  TestsNommes,
  ValidationKey,
  ValidationState,
} from '../shared/validations-bac.js';

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
  /**
   * Le nœud qui a RENDU l'avis, et sa famille — l'expéditeur du résultat de
   * relecture, pas le relecteur choisi au lancement : une relecture remise en
   * file peut changer de mains (voir `noterVerdict`, server.ts).
   */
  reviewerNodeId: string;
  reviewerAgent: string;
  /**
   * Famille d'agent qui a PRODUIT le résultat relu, telle que consignée avec
   * l'avis (`producteur`). Avec l'auteur réel de l'avis, c'est ce qui permet à
   * l'Evaluator de VÉRIFIER l'indépendance plutôt que de croire le module qui
   * a choisi les relecteurs.
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
  /**
   * Les constats structurés des relecteurs (marqueur `HIVE_CRITIQUE`), du plus
   * grave au plus léger. Les bloquants et majeurs sont AUSSI dans
   * `objections` — c'est par eux que la revue conteste ; les remarques
   * (mineur, info) ne sont qu'ici, et ne bloquent jamais. Vide pour une
   * critique libre.
   */
  findings: readonly Constat[];
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
    findings: [],
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
  /**
   * La contre-revue de ce résultat est IMPOSSIBLE — sa dernière relecture est
   * tombée sans avis, et ni secours ni relecture en vol ne viendront — avec sa
   * cause (`contre_expertise_impossible`, server.ts). Absent : rien de tel
   * n'a été constaté.
   */
  crossReviewImpossible?: string;
  /**
   * Ce que la porte de sécurité du nœud a vu dans CE résultat
   * (`security_gate_recorded`). Absente : la porte est « non vérifiée » —
   * jamais un vert.
   */
  securite?: { porte: PorteSecurite; nodeId: string };
  /** Le polyéthisme qui a gouverné cette production est `strict` (voir l'en-tête). */
  securiteStricte?: boolean;
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
  /** Cause d'une contre-revue impossible (voir `EvaluatorInput`), si constatée. */
  crossReviewImpossible?: string;
  humanReview: 'approved' | 'rejected' | 'missing';
  /** La porte de sécurité — « rapport absent » sur ses deux volets quand le nœud n'a rien rendu. */
  securite: PorteSecurite;
  /** Le nœud dont la porte a parlé ; absent sans rapport. */
  securiteNodeId?: string;
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

const NOM_DU_VOLET: Readonly<Record<VoletPorte, string>> = {
  secrets: 'secrets',
  dependances: 'dépendances',
};

/** Des éléments en une ligne, et ce que la borne du protocole a laissé tomber. */
function enLigne(elements: readonly string[], total: number): string {
  const reste = total - elements.length;
  return elements.join(' ; ') + (reste > 0 ? ` ; … et ${reste} autre(s)` : '');
}

/**
 * Les motifs d'une porte qui a TROUVÉ, ou `[]`. Trois lignes au plus — le
 * titre et son remède, les secrets, les dépendances : la critique figée pour
 * la correction n'en garde que trois (`BORNES_CRITIQUE.raisons`), et c'est
 * elle qui dit à l'ouvrière quoi reprendre. Aucune valeur : le rapport n'en
 * porte jamais (`--redact`, puis le caviardage du nœud).
 */
function motifsDeLaPorte(porte: PorteSecurite, nodeId: string | undefined): string[] {
  const { secrets, dependances } = porte;
  const s = secrets.etat === 'constat' ? secrets.total : 0;
  const d = dependances.etat === 'constat' ? dependances.total : 0;
  if (s + d === 0) return [];
  // Les lockfiles illisibles viennent en tête des constats (le nœud les y
  // range) : la borne du protocole ne les fait pas tomber, et leur compte est exact.
  const illisibles =
    d > 0 ? dependances.constats.filter((c) => c.genre === 'lockfile_illisible') : [];
  const v = d - illisibles.length;
  const comptes = [
    ...(s > 0 ? [`${s} secret(s) ajouté(s)`] : []),
    ...(v > 0 ? [`${v} vulnérabilité(s) introduite(s)`] : []),
    ...(illisibles.length > 0 ? [`${illisibles.length} lockfile(s) laissé(s) illisible(s)`] : []),
  ].join(', ');
  const remedes = [
    ...(s > 0 ? ['retirez chaque secret du code et lisez-le de l’environnement'] : []),
    ...(v > 0 ? ['passez chaque dépendance à une version corrigée'] : []),
    ...(illisibles.length > 0
      ? [
          'régénérez chaque lockfile avec son gestionnaire de paquets — un fichier ordinaire, lisible',
        ]
      : []),
  ].join(' ; ');
  const motifs = [
    `la porte de sécurité a trouvé ${comptes}${nodeId ? ` (nœud ${nodeId})` : ''} — ${remedes}`,
  ];
  if (s > 0) {
    const lus = secrets.constats.map((c) => `${c.regle} ${c.fichier}:${c.ligne}`);
    motifs.push(
      `secrets, valeurs caviardées par le nœud et jamais transmises : ${enLigne(lus, s)}`,
    );
  }
  if (d > 0) {
    const lus = dependances.constats.map((c) => {
      if (c.genre === 'lockfile_illisible') {
        const comment =
          c.motif === 'mal_forme' ? 'mal formé' : 'remplacé par autre chose qu’un fichier';
        return `${c.fichier} illisible (${comment})`;
      }
      const precisions = [...c.alias, ...(c.gravite ? [c.gravite] : [])];
      const entre = precisions.length > 0 ? ` (${precisions.join(', ')})` : '';
      return `${c.paquet}@${c.version} (${c.ecosysteme}) ${c.avis}${entre} dans ${c.fichier}`;
    });
    motifs.push(`dépendances introduites : ${enLigne(lus, d)}`);
  }
  return motifs;
}

/** Un nom de test dans un motif : cinq tiennent, avec leur contexte, dans une raison. */
const NOM_DANS_UN_MOTIF = 44;

/**
 * Des tests nommés en une ligne : le TOTAL d'abord, puis au plus cinq noms,
 * chacun coupé à `NOM_DANS_UN_MOTIF` caractères. Une raison de la critique
 * figée est bornée (`BORNES_CRITIQUE.raison`, 400 caractères) — c'est elle que
 * lit l'ouvrière — et la borne coupe la FIN : un nom long ne doit emporter ni
 * le compte, ni les noms qui le suivent.
 */
function direTests(tests: TestsNommes): string {
  const noms = tests.noms
    .slice(0, 5)
    .map((nom) =>
      nom.length > NOM_DANS_UN_MOTIF ? `${nom.slice(0, NOM_DANS_UN_MOTIF - 1)}…` : nom,
    );
  const reste = tests.total - noms.length;
  return `${tests.total} test(s) : ${noms.join(' ; ')}${reste > 0 ? ` ; … et ${reste} autre(s)` : ''}`;
}

/** La comparaison à la base des tests du bac, quand il y en a une. */
function comparaisonDesTests(
  provenance: ValidationProvenance | undefined,
): { comparaison: ComparaisonBase; base: string; nodeId: string } | null {
  if (provenance?.source !== 'hive_sandbox') return null;
  const comparaison = provenance.details.tests.comparaison;
  if (!comparaison) return null;
  const base = provenance.baseSha ? `la base ${provenance.baseSha.slice(0, 8)}` : 'la base';
  return { comparaison, base, nodeId: provenance.nodeId };
}

/**
 * Chaque volet en quelques mots : « secrets — outil absent (betterleaks) »,
 * « dépendances — rien trouvé (osv-scanner 2.6.0), 3 paquet(s) introduit(s)
 * non vérifié(s) — source non publique, ou version non épinglée ».
 */
function direVolets(porte: PorteSecurite, volets: readonly VoletPorte[]): string {
  return volets
    .map((v) => {
      const { raison, outil, nonInterroges } = porte[v];
      const par = outil
        ? ` (${outil.nom} ${outil.version})`
        : raison === 'rapport_absent'
          ? ''
          : ` (${OUTIL_DU_VOLET[v]})`;
      const exclus = nonInterroges
        ? `, ${nonInterroges} paquet(s) introduit(s) non vérifié(s) — source non publique, ou version non épinglée`
        : '';
      return `${NOM_DU_VOLET[v]} — ${DIRE_RAISON_PORTE[raison][0]}${par}${exclus}`;
    })
    .join(' ; ');
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
  const securite = input.securite?.porte ?? PORTE_SANS_RAPPORT;
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
    ...(input.crossReviewImpossible ? { crossReviewImpossible: input.crossReviewImpossible } : {}),
    securite,
    ...(input.securite ? { securiteNodeId: input.securite.nodeId } : {}),
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
    // La porte lit aussi le diff d'un échec (son volet secrets n'exécute
    // rien) : une clé que l'agent a écrite avant d'échouer est nommée ici, et
    // la critique de la correction le dira.
    return result(
      input.taskId,
      'rejected',
      false,
      true,
      ['le dernier résultat a échoué', ...motifsDeLaPorte(securite, input.securite?.nodeId)],
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
  // Avant les Gardiennes suspectes, le rejet humain et toute règle qui appelle
  // un humain : un secret ou une vulnérabilité introduite est un défaut
  // CONSTATÉ, et seul un verdict bloquant arrête la livraison (voir l'en-tête).
  const enEchec = motifsDeLaPorte(securite, input.securite?.nodeId);
  if (enEchec.length > 0) {
    return result(input.taskId, 'correction_required', false, true, enEchec, evidence);
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
  const tests = comparaisonDesTests(input.validationProvenance);
  if (failedValidation) {
    reasons.push(`validation ${failedValidation} en échec${suffixeSource}`);
    // La correction NOMME ce que la production a cassé, et dit ce qui était
    // déjà rouge : sans ça, l'ouvrière « réparerait » aussi ce qu'elle n'a pas
    // touché — ou ne saurait pas lequel de ses tests rouges est le sien.
    if (failedValidation === 'tests' && tests && tests.comparaison.regressions.total > 0) {
      const { regressions, dejaRouges, executions } = tests.comparaison;
      reasons.push(
        `régression comparée à ${tests.base}, ${direTests(regressions)} — rouge(s) à chacune des ` +
          `${executions.tete} exécution(s) de la production, à aucune des ${executions.base} de la base`,
      );
      if (dejaRouges.total > 0) {
        reasons.push(
          `déjà rouge(s) à la base, du même échec, non bloquant(s), ${direTests(dejaRouges)}`,
        );
      }
    }
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
  const bac =
    input.validationProvenance?.source === 'hive_sandbox' ? input.validationProvenance : null;
  const preuvesAbsentes: string[] = [];
  if (missingValidation.length > 0) {
    preuvesAbsentes.push(
      `preuves manquantes : ${missingValidation.join(', ')}` +
        (suffixeSource || ' (aucun producteur de preuve : ni bac Hive, ni CI GitHub)'),
    );
    // Sans bac, le nœud n'a rien lancé — et c'est un choix de sécurité, pas
    // une panne : le motif dit comment en obtenir un, sinon l'opérateur
    // reste devant un « manquant » sans issue.
    if (bac && missingValidation.some((key) => bac.details[key].raison === 'sans_bac')) {
      preuvesAbsentes.push(
        `le nœud ${bac.nodeId} n’a pas de bac à sable : le code d’un agent ne tourne pas ` +
          'sur l’hôte nu — installez podman, docker ou bubblewrap (HIVE_ISOLEMENT=auto ' +
          'les trouve au démarrage du nœud), ou apportez la CI GitHub',
      );
    }
    // Une panne du bac en cours de route n'est pas un verdict sur la
    // production (`panneEnvironnement`) : le motif la nomme, et dit ce qui la
    // lève — sur le nœud (mémoire, disque, DNS) ou nulle part dans le bac
    // (démon, affichage : la CI GitHub). Sans lui, « preuves manquantes :
    // tests » sur un OOM ne disait ni pourquoi, ni où chercher. Il n'innocente
    // pas pour autant la production : `DIRE_PANNE` le dit à chaque remède.
    // (Une panne n'accompagne que la raison `environnement` : `controleDepuis`.)
    for (const key of missingValidation) {
      const panne = bac?.details[key].panne;
      if (!bac || !panne) continue;
      const { nom, remede } = DIRE_PANNE[panne];
      preuvesAbsentes.push(
        `le bac du nœud ${bac.nodeId} est tombé en panne pendant ${key} (${nom[0]}), ` +
          `verdict inconnu : ${remede[0]}`,
      );
    }
    // Un test instable n'est ni une régression (pas de correction : la
    // production n'est peut-être pour rien dans le hasard) ni un vert.
    if (validation.tests === 'missing' && tests && tests.comparaison.instables.total > 0) {
      preuvesAbsentes.push(
        `tests instables sur le bac du nœud ${tests.nodeId}, ${direTests(tests.comparaison.instables)} ` +
          `— vus rouges à une exécution et verts à une autre, de la production ou de ${tests.base} : ` +
          'ni régression ni vert, verdict inconnu — stabilisez-les, ou apportez la CI GitHub',
      );
    }
  } else if (validation.tests === 'not_applicable') {
    // Deux absences différentes : un projet npm sans script « test », et un
    // projet que Hive ne sait pas lire (cargo, pytest…) — lui dire de
    // « déclarer un script test » serait faux.
    preuvesAbsentes.push(
      bac?.details.tests.raison === 'sans_manifeste'
        ? `aucun package.json à la base du dépôt${suffixeSource} : le bac ne lit que les ` +
            'scripts npm, et ne sait pas lancer les tests de ce projet — apportez la CI GitHub'
        : `le projet ne déclare aucun test${suffixeSource} : sans test, rien ne prouve le ` +
            'comportement — déclarez un script « test », ou apportez la CI GitHub',
    );
  }
  // ─── UNE RELECTURE IMPOSSIBLE APPELLE L'HUMAIN, PAS LE PRODUCTEUR ────────
  //
  // Avant les preuves absentes, et c'est voulu : aucune CI ne fera jamais
  // `accepted` sans avis indépendant, et « tests supplémentaires requis »
  // enverrait l'opérateur chercher une preuve qui ne débloquerait rien. La
  // relecture est tombée, secours compris : c'est une personne qui tranche,
  // et le motif dit POURQUOI personne d'autre ne le fera. Pas de relance
  // (`retryRecommended` faux) : le producteur n'est pour rien dans la panne
  // de son relecteur. Une CI en échec, elle, reste une faute du producteur —
  // d'où la place, après elle. Les preuves absentes SUIVENT le motif : la
  // personne qui approuve doit lire qu'aucun test n'a tourné, et pourquoi.
  // ─── LA PORTE NON VÉRIFIÉE, EN POLYÉTHISME STRICT ─────────────────────────
  //
  // Même place que la relecture impossible, et pour la même raison : aucune
  // preuve apportée plus tard ne la vérifiera — la porte tourne sur le nœud,
  // au moment de la production, et nulle part ailleurs. « Tests
  // supplémentaires requis » enverrait chercher ce qui ne débloque rien.
  // En `strict`, ce qui n'a pas été vérifié du tout retient la production ;
  // des paquets non publics à côté d'une analyse faite sont dits, pas retenus.
  const nonVerifies = VOLETS_PORTE.filter((v) => securite[v].etat === 'non_verifie');
  const porteRetenue =
    input.securiteStricte === true && nonVerifies.length > 0
      ? [
          `porte de sécurité non vérifiée, polyéthisme strict : ${direVolets(securite, nonVerifies)}`,
          `rendez-la vérifiable sur ${input.securite ? `le nœud ${input.securite.nodeId}` : 'le nœud producteur'} ` +
            '(`hive doctor` dit ce qui manque), puis relancez la production — ou tranchez en revue humaine',
        ]
      : [];
  if (input.crossReviewImpossible && crossReview.reviewerCount === 0 && crossReviewPending === 0) {
    reasons.push(
      `relecture impossible : ${input.crossReviewImpossible}`,
      ...porteRetenue,
      ...preuvesAbsentes,
    );
    return result(input.taskId, 'human_review_required', false, false, reasons, evidence);
  }
  if (porteRetenue.length > 0) {
    reasons.push(...porteRetenue, ...preuvesAbsentes);
    return result(input.taskId, 'human_review_required', false, false, reasons, evidence);
  }
  if (preuvesAbsentes.length > 0) {
    reasons.push(...preuvesAbsentes);
    return result(input.taskId, 'additional_test_required', false, false, reasons, evidence);
  }
  if (crossReviewPending > 0) {
    reasons.push(
      `contre-revue en cours : ${crossReviewPending} relecture(s) de ce résultat n’ont pas encore rendu d’avis — une objection resterait bloquante`,
    );
    return result(input.taskId, 'human_review_required', false, false, reasons, evidence);
  }

  // L'indépendance se VÉRIFIE avis par avis, entre l'auteur RÉEL de l'avis et
  // la famille consignée du producteur, avec la règle même qui a choisi les
  // relecteurs : un avis favorable de la même famille relit ses propres angles
  // morts, celui du `shell` simulé n'en est pas un — aucun ne compte, même si
  // le statut agrégé dit `applied`.
  const independants = crossReview.reviewers.filter(
    (vote) =>
      vote.decision === 'appliquer' && relecteurIndependant(vote.reviewerAgent, vote.producerAgent),
  );
  if (independants.length === 0) {
    // Le motif ne désigne pas UNE cause qu'il ne connaît pas : sans avis,
    // « aucun second modèle en ligne » et « relecture échouée » se
    // ressemblent d'ici, et renvoyer l'opérateur brancher un agent déjà
    // branché l'enverrait chercher la mauvaise panne.
    reasons.push(
      crossReview.reviewerCount > 0
        ? 'les avis favorables viennent de la famille d’agent qui a produit, ou d’un agent simulé : ce n’est pas une relecture indépendante'
        : 'aucune contre-revue d’une autre famille d’agent n’a rendu d’avis sur ce résultat (aucun second modèle en ligne à son arrivée, ou relecture échouée) : tranchez en revue humaine — un rejet relance la production, relue si un agent d’une autre famille est en ligne',
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
  if (source) acceptedReasons.push(`validations : ${source}`);
  // Des tests rouges ont été excusés : ils l'étaient déjà à la base. Le vert
  // le DIT — l'humain qui approuve lit ce qui reste rouge, et pourquoi.
  if (validation.tests === 'passed' && tests && tests.comparaison.dejaRouges.total > 0) {
    const { dejaRouges, ciblesPassees } = tests.comparaison;
    // « Du même échec », et pas « que la production n'a pas cassé » : le nœud
    // compare l'EMPREINTE de chaque échec — le message que le runner imprime,
    // valeurs attendue et reçue comprises, et son fichier —, pas tout ce que
    // le test aurait pu vérifier après l'assertion qui a lâché la première.
    acceptedReasons.push(
      `tests comparés à ${tests.base} : aucune régression — déjà rouge(s) à la base, du même ` +
        `échec à la base et à la production, non bloquant(s), ${direTests(dejaRouges)}`,
    );
    if (ciblesPassees.total > 0) {
      acceptedReasons.push(
        `cibles passées, ${direTests(ciblesPassees)} — rouge(s) à la base, vert(s) à la production`,
      );
    }
  }
  if (notApplicable.length > 0) {
    acceptedReasons.push(
      `non applicables, faute de déclaration par le projet : ${notApplicable.join(', ')}`,
    );
  }
  // Accepter n'efface pas les remarques : dites ici, elles ne se confondent
  // pas avec « rien à signaler ». Elles n'ont pas bloqué — c'est la règle,
  // mineur et info ne contestent jamais —, mais l'humain qui approuve les lit.
  const remarques = crossReview.findings.filter((constat) => !constatBloquant(constat)).length;
  if (remarques > 0) {
    acceptedReasons.push(
      `${remarques} remarque(s) non bloquante(s) de la contre-revue (mineur ou info)`,
    );
  }
  if (input.consensus?.outcome === 'elected') {
    acceptedReasons.push('le Parlement a aussi élu ce résultat (signal supplémentaire)');
  }
  // Une porte non vérifiée ne retient rien hors de `strict` — mais elle ne se
  // tait pas : l'humain qui approuve lit qu'aucun outil n'a regardé.
  // Des paquets introduits qui ne sont pas partis à osv.dev (source locale,
  // git, registre privé, version non épinglée) : la porte n'est passée qu'EN
  // PARTIE, et le dit.
  const enPartie = VOLETS_PORTE.some((v) => (securite[v].nonInterroges ?? 0) > 0);
  acceptedReasons.push(
    nonVerifies.length > 0
      ? `porte de sécurité non vérifiée (${direVolets(securite, nonVerifies)}) : jamais comptée ` +
          'verte — elle ne retient la production qu’en polyéthisme strict'
      : enPartie
        ? `porte de sécurité passée en partie : ${direVolets(securite, VOLETS_PORTE)} — ` +
          'un paquet qui n’a pas été interrogé n’est jamais compté vert'
        : `porte de sécurité passée : ${direVolets(securite, VOLETS_PORTE)}`,
  );
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
