// LE RAPPORT DE RISQUES D'UNE PULL REQUEST DE LA BOUCLE — ce qu'un humain doit
// savoir AVANT de fusionner ce que Hive a écrit sur Hive.
//
// ─── CE QU'IL DIT, ET D'OÙ CHAQUE LIGNE VIENT ───────────────────────────────
//
//   · les fichiers touchés : le parseur de la livraison, sur le diff livré ;
//   · la porte des changements sensibles : son verdict, et la validation
//     humaine lue au journal quand il en fallait une ;
//   · les validations : celles que l'Evaluator a RANGÉES, avec leur source
//     (bac Hive d'un nœud, CI GitHub) — une validation absente est dite
//     absente, jamais verte ; puis le compte rendu de l'ouvrière QA, DÉCLARÉ
//     par elle et présenté comme tel ;
//   · les verdicts de l'Evaluator sur chaque phase ;
//   · les relectures croisées : qui a relu qui, et ce qu'il en a dit ;
//   · un extrait de la note d'architecture.
//
// Rien n'y est estimé. Ce qui manque est écrit « inconnu » ou « absent ».
//
// ─── CE QUI PART CHEZ GITHUB EST CAVIARDÉ ET BORNÉ ──────────────────────────
//
// Le rapport devient un commentaire public de la PR, posté avec le jeton de
// l'hôte. Il cite des textes d'agents (raisons, objections, notes) : chacun
// est rendu INERTE — en code sur une ligne, ou cité en bloc —, jamais en
// Markdown actif. Sinon une ouvrière y glisserait `@quelqu’un` (une
// notification envoyée au nom du propriétaire), un lien ou une image
// traçante. Bornés, et le rapport ENTIER passe par le caviardeur de la ruche
// (`shared/caviardage.ts`) avec les valeurs secrètes de l'hôte avant de
// partir. GitHub refuse un commentaire de plus de 65 536 caractères : le
// rapport s'arrête bien avant, et le dit.
//
// MODULE PUR — aucune I/O.

import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import type { Caviardeur } from '../shared/caviardage.js';
import { analyserRustine } from '../orchestrator/rustine.js';
import type { RelectureCroisee, ValidationHumaine, VerdictGarde } from './garde.js';

/** Borne du rapport — sous la limite d'un commentaire GitHub (65 536). */
export const MAX_RAPPORT = 60_000;

/** Borne d'un extrait de note d'ouvrière dans le rapport. */
const MAX_EXTRAIT = 2_000;

/** Borne d'une raison ou d'une objection citée. */
const MAX_RAISON = 300;

/** Ce que le rapport lit d'une évaluation (`GET /api/tasks/:taskId/evaluation`). */
export interface EvaluationLue {
  decision: string;
  raisons: string[];
  validations: Record<'tests' | 'typecheck' | 'build' | 'lint', string>;
  /** « bac Hive du nœud X », « CI GitHub, PR #n », ou `null`. */
  source: string | null;
  relectures: { relecteur: string; producteur: string; decision: string; raison: string }[];
  relectureImpossible: string | null;
  revueHumaine: string;
  relecturesEnVol: number;
}

const enregistrement = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const chaine = (v: unknown, defaut = ''): string => (typeof v === 'string' ? v : defaut);

/** Lit une évaluation rendue par la Reine ; `null` si ce n'en est pas une. */
export function lireEvaluation(corps: unknown): EvaluationLue | null {
  const e = enregistrement(corps);
  if (typeof e.decision !== 'string') return null;
  const preuve = enregistrement(e.evidence);
  const provenance = enregistrement(preuve.validationProvenance);
  const croisee = enregistrement(preuve.crossReview);
  const source =
    provenance.source === 'hive_sandbox'
      ? `bac Hive du nœud ${chaine(provenance.nodeId, 'inconnu')}`
      : provenance.source === 'github_pull_request'
        ? `CI GitHub, PR #${String(provenance.pr)}`
        : null;
  return {
    decision: e.decision,
    raisons: Array.isArray(e.reasons) ? e.reasons.filter((r) => typeof r === 'string') : [],
    validations: {
      tests: chaine(preuve.tests, 'missing'),
      typecheck: chaine(preuve.typecheck, 'missing'),
      build: chaine(preuve.build, 'missing'),
      lint: chaine(preuve.lint, 'missing'),
    },
    source,
    relectures: (Array.isArray(croisee.reviewers) ? croisee.reviewers : []).map((v) => {
      const r = enregistrement(v);
      return {
        relecteur: chaine(r.reviewerAgent, 'inconnu'),
        producteur: chaine(r.producerAgent, 'inconnu'),
        decision: chaine(r.decision, 'inconnu'),
        raison: chaine(r.reason),
      };
    }),
    relectureImpossible:
      typeof preuve.crossReviewImpossible === 'string' ? preuve.crossReviewImpossible : null,
    revueHumaine: chaine(preuve.humanReview, 'missing'),
    relecturesEnVol: typeof preuve.crossReviewPending === 'number' ? preuve.crossReviewPending : 0,
  };
}

export interface PhaseRapportee {
  taskId: string | null;
  /** `non_lancee` : la phase n'a pas eu lieu, `pourquoi` dit la raison. */
  statut: 'done' | 'failed' | 'non_lancee';
  evaluation: EvaluationLue | null;
  /** La note que l'ouvrière a écrite, lue dans son diff — ou `null`. */
  note: string | null;
  pourquoi?: string;
}

export interface FaitsRapport {
  mission: string;
  projetId: string;
  architecture: PhaseRapportee;
  implementation: PhaseRapportee & { resultId: number; diff: string };
  qa: PhaseRapportee;
  garde: VerdictGarde;
  validation: ValidationHumaine;
  relecture: RelectureCroisee;
  livraison: { pr: number; urlPr: string; branche: string; commitSha: string };
}

const ligne = (texte: string, max = MAX_RAISON) => champSurUneLigne(texte, max);

/**
 * Un texte d'agent sur une ligne, en CODE : ni mention, ni lien, ni image n'y
 * sont interprétés. Ses propres accents graves sont remplacés — un seul
 * suffirait à refermer le code et rendre la suite active.
 */
const enCode = (texte: string, max = MAX_RAISON) => `\`${ligne(texte, max).replaceAll('`', "'")}\``;

/** Un texte d'ouvrière, cité en bloc et borné — jamais interprété comme du Markdown actif. */
function citation(texte: string): string {
  const borne = texte.length > MAX_EXTRAIT ? `${texte.slice(0, MAX_EXTRAIT)}\n…[tronqué]` : texte;
  return ['```text', borne.replaceAll('```', "'''"), '```'].join('\n');
}

const ETAT_VALIDATION: Record<string, string> = {
  passed: '✔ réussie',
  failed: '✘ échouée',
  not_applicable: '— sans objet',
  missing: '? absente',
};

/**
 * Les fichiers du diff livré, avec leurs lignes ajoutées et retirées — le
 * titre les compte, eux : les chemins que seuls nomment les en-têtes (un
 * renommage) sont jugés par la porte, pas écrits par la livraison.
 */
function sectionFichiers(diff: string): string[] {
  try {
    const fichiers = analyserRustine(diff).fichiers.map((f) => {
      const lignes = f.hunks.flatMap((h) => h.lignes);
      const plus = lignes.filter((l) => l.signe === '+').length;
      const moins = lignes.filter((l) => l.signe === '-').length;
      return `- ${enCode(f.chemin, 400)} — ${f.operation} (+${plus} −${moins})`;
    });
    return [`### Fichiers touchés (${fichiers.length})`, ...fichiers];
  } catch {
    return ['### Fichiers touchés (?)', '- ? diff illisible par le parseur de livraison'];
  }
}

function verdictDe(nom: string, phase: PhaseRapportee): string {
  if (phase.statut === 'non_lancee')
    return `- ${nom} : non lancée — ${phase.pourquoi ?? 'inconnu'}`;
  if (!phase.evaluation) return `- ${nom} (${phase.statut}) : évaluation illisible — inconnu`;
  const raisons = phase.evaluation.raisons.slice(0, 3).map((r) => enCode(r));
  return `- ${nom} (${phase.statut}) : ${enCode(phase.evaluation.decision, 40)}${
    raisons.length > 0 ? ` — ${raisons.join(' ; ')}` : ''
  }`;
}

function sectionPorte(
  garde: VerdictGarde,
  validation: ValidationHumaine,
  relecture: RelectureCroisee,
): string[] {
  if (garde.etat === 'libre' && relecture === 'rendue') {
    return [
      '✔ Aucune surface sensible touchée, et relue par une autre famille : la porte a laissé ' +
        'passer sans validation humaine.',
    ];
  }
  const tete =
    garde.etat === 'illisible'
      ? `⚠ Diff illisible par la porte (${enCode(garde.motif ?? 'inconnu')})`
      : garde.etat === 'sensible'
        ? '⚠ Surfaces sensibles touchées'
        : '⚠ Aucune relecture d’une autre famille';
  const qui =
    validation === 'approuvee'
      ? ' — **validées par un humain** (revue approuvée au journal, après la dernière production).'
      : ` — validation humaine : ${validation}.`;
  return [
    tete + qui,
    ...(garde.touches.length > 0
      ? [
          '',
          '| Fichier | Surface | Pourquoi |',
          '| --- | --- | --- |',
          ...garde.touches.map(
            // Dans un tableau, `|` fermerait la cellule même en code.
            (t) =>
              `| ${enCode(t.chemin, 200).replaceAll('|', '\\|')} | ${t.categorie} | ${ligne(t.pourquoi)} |`,
          ),
        ]
      : []),
  ];
}

function sectionValidations(faits: FaitsRapport): string[] {
  const evaluation = faits.implementation.evaluation;
  const lignes = evaluation
    ? (['tests', 'typecheck', 'build', 'lint'] as const).map(
        (k) => `- ${k} : ${ETAT_VALIDATION[evaluation.validations[k]] ?? '? inconnue'}`,
      )
    : ['- ? évaluation illisible : aucune validation connue'];
  lignes.push(
    `- source : ${evaluation?.source ?? 'aucune validation rangée par un outil identifiable'}`,
  );
  const qa = faits.qa;
  lignes.push(
    '',
    qa.statut === 'non_lancee'
      ? `QA : non lancée — ${qa.pourquoi ?? 'inconnu'}.`
      : qa.note
        ? `QA (tâche ${qa.taskId ?? '?'}, ${qa.statut}) — compte rendu DÉCLARÉ par l’ouvrière QA, ` +
          'non constaté par la Reine :'
        : `QA (tâche ${qa.taskId ?? '?'}, ${qa.statut}) : aucun compte rendu écrit — inconnu.`,
  );
  if (qa.statut !== 'non_lancee' && qa.note) lignes.push(citation(qa.note));
  return lignes;
}

function sectionRelectures(evaluation: EvaluationLue | null): string[] {
  if (!evaluation) return ['? évaluation illisible : relectures inconnues.'];
  if (evaluation.relectures.length === 0) {
    return [
      evaluation.relectureImpossible
        ? `✘ Aucune relecture croisée : ${enCode(evaluation.relectureImpossible)}.`
        : '✘ Aucune relecture croisée rendue sur cette production.',
    ];
  }
  return evaluation.relectures.map((r) => {
    const croisee = r.relecteur !== r.producteur ? 'croisée' : 'MÊME FAMILLE';
    const raison = r.raison ? ` — ${enCode(r.raison)}` : '';
    return `- ${enCode(r.relecteur, 60)} relit ${enCode(r.producteur, 60)} (${croisee}) : ${enCode(r.decision, 40)}${raison}`;
  });
}

/**
 * Le rapport, en Markdown, caviardé par `caviardeur` et borné à `MAX_RAPPORT`.
 */
export function rapportDeRisques(faits: FaitsRapport, caviardeur: Caviardeur): string {
  const { livraison, implementation } = faits;
  const corps = [
    '## Rapport de risques — boucle Hive → Hive (V3)',
    '',
    `Mission : ${ligne(faits.mission, 400)}`,
    `Projet \`${faits.projetId}\` · production \`${implementation.taskId ?? '?'}\` ` +
      `(résultat #${implementation.resultId}) · branche \`${livraison.branche}\` · ` +
      `commit \`${livraison.commitSha.slice(0, 12)}\``,
    '',
    '### Porte des changements sensibles',
    ...sectionPorte(faits.garde, faits.validation, faits.relecture),
    '',
    ...sectionFichiers(implementation.diff),
    '',
    '### Validations',
    ...sectionValidations(faits),
    '',
    '### Verdicts de l’Evaluator',
    verdictDe('architecture', faits.architecture),
    verdictDe('implémentation', implementation),
    verdictDe('QA', faits.qa),
    '',
    '### Relectures croisées',
    ...sectionRelectures(implementation.evaluation),
    '',
    '### Architecture — extrait de la note (écrite par une ouvrière)',
    faits.architecture.note ? citation(faits.architecture.note) : '? aucune note lue.',
    '',
    '---',
    'Rapport composé par `npm run boucle:v3` depuis ce que la Reine a consigné. ' +
      'La boucle ne fusionne jamais : la fusion reste un geste humain.',
  ].join('\n');
  const caviarde = caviardeur.texte(corps);
  return caviarde.length > MAX_RAPPORT
    ? `${caviarde.slice(0, MAX_RAPPORT)}\n\n…[rapport tronqué à ${MAX_RAPPORT} caractères]`
    : caviarde;
}
