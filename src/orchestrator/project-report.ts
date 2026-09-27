// Rapport par projet (innovation) — l'avancement d'un projet en un coup d'œil.
//
// Un porteur de projet veut savoir : où en est MON projet ? Ce module PUR calcule,
// à partir de la liste des tâches du projet, l'avancement (%), la répartition par
// statut, les nœuds qui y ont contribué et le total des tentatives. Aucune I/O :
// la vue est un simple repli de l'état des tâches, donc testable isolément.

import { categoriser, type Categorie } from './aiguillage.js';
import type { SourceCritique } from './brood.js';
import type { EvaluationDecision, EvaluationResult } from './evaluator.js';
import { TYPES_CHRONOLOGIE, chronologieDepuisEvenements } from '../shared/chronologie-tache.js';
import type { ChronologieTache } from '../shared/chronologie-tache.js';
import { sommeDeclaree } from '../shared/declaration-fournisseur.js';
import type { SommeDeclaree } from '../shared/declaration-fournisseur.js';
import {
  TYPES_REGISTRE_GENOME,
  registreGenomeDepuisEvenements,
} from '../shared/registre-genome.js';
import type { RegistreGenome } from '../shared/registre-genome.js';
import type { HiveEvent, Project, Task, TaskStatus } from '../shared/types.js';

const STATUSES: TaskStatus[] = ['pending', 'ready', 'assigned', 'running', 'done', 'failed'];

export interface ProjectReport {
  projectId: string;
  name: string;
  total: number;
  /** Nombre de tâches par statut (toutes les clés présentes, à 0 si aucune). */
  byStatus: Record<TaskStatus, number>;
  done: number;
  failed: number;
  /** done / total × 100, arrondi (0 si aucune tâche). */
  progressPct: number;
  /** Vrai si toutes les tâches ont une issue terminale (done ou failed). */
  complete: boolean;
  /** nodeIds distincts ayant travaillé sur le projet (assignation ou résultat). */
  contributingNodes: string[];
  /** Somme des tentatives sur l'ensemble des tâches. */
  totalAttempts: number;
}

/**
 * Construit le rapport d'un projet à partir de SES tâches (déjà filtrées par
 * projet). Le `project` fournit l'identité ; les compteurs viennent des tâches.
 */
export function buildProjectReport(project: Project, tasks: Task[]): ProjectReport {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  const nodes = new Set<string>();
  let totalAttempts = 0;

  for (const task of tasks) {
    byStatus[task.status] += 1;
    totalAttempts += task.attempts;
    if (task.assignedNodeId) nodes.add(task.assignedNodeId);
    if (task.result?.nodeId) nodes.add(task.result.nodeId);
  }

  const total = tasks.length;
  const done = byStatus.done;
  const failed = byStatus.failed;

  return {
    projectId: project.id,
    name: project.name,
    total,
    byStatus,
    done,
    failed,
    progressPct: total === 0 ? 0 : Math.round((done / total) * 100),
    complete: total > 0 && done + failed === total,
    contributingNodes: [...nodes].sort(),
    totalAttempts,
  };
}

// ─── Le rapport de MISSION — ce que chaque tâche a donné, et ce qu'elle a coûté ─
//
// L'avancement ci-dessus répond « où en est-on ». Il ne dit pas ce que la
// ruche a DÉCIDÉ de chaque production, ni ce que la mission a coûté. Ces faits
// existaient, dispersés entre quatre écrans et autant de routes : l'Evaluator
// (tiroir d'une tâche), la contre-revue (War Room), le temps et la dépense
// déclarée (chronologie d'une tâche), les faits par modèle (Genome, Essaim).
// Personne ne pouvait lire une mission terminée d'un seul regard.
//
// Ce repli les réunit par tâche, SANS rien recalculer à sa façon :
//
//   · l'Evaluator est celui de `evaluate` — la décision COURANTE d'une tâche
//     terminée, que le serveur calcule comme pour son tiroir, jamais un second
//     jugement écrit ici ;
//   · le temps et la dépense sont la `chronologieDepuisEvenements` de la tâche,
//     et les totaux somment ses tentatives avec leur couverture — une tâche
//     muette ne devient pas une tâche gratuite ;
//   · les faits par modèle sont `registreGenomeDepuisEvenements`, restreint aux
//     tâches de la mission ;
//   · les reprises sont comptées PAR SOURCE : un Worker qui tombe, une remise en
//     file (nœud perdu, reprise au boot) et une correction demandée par
//     l'Evaluator (contre-revue, revue humaine, geste explicite) ne racontent
//     pas la même histoire, et un total unique les confondait.
//
// Le journal est borné : `fenetre` dit ce qui a été lu, et `tronquee` qu'un
// fait plus ancien a PU manquer. Module pur — le serveur lit, ceci replie.

/** Les types que le rapport de mission relit : ceux de la chronologie et du Genome. */
export const TYPES_RAPPORT_MISSION: readonly string[] = [
  ...new Set<string>([...TYPES_CHRONOLOGIE, ...TYPES_REGISTRE_GENOME]),
];

/**
 * D'où vient une reprise. `inconnue` : un renvoi de l'Evaluator journalisé
 * sans sa critique (écrit avant qu'elle ne voyage, ou critique illisible) —
 * on sait que c'est une correction, pas qui l'a demandée.
 */
export type SourceReprise = 'worker' | 'remise_en_file' | SourceCritique | 'inconnue';

export type ReprisesParSource = Record<SourceReprise, number>;

const SOURCES_REPRISE: readonly SourceReprise[] = [
  'worker',
  'remise_en_file',
  'contre_revue',
  'revue_humaine',
  'evaluator',
  'inconnue',
];

const DECISIONS: readonly EvaluationDecision[] = [
  'accepted',
  'correction_required',
  'rejected',
  'additional_test_required',
  'human_review_required',
];

/**
 * La contre-revue de la production retenue, en une issue. L'ordre dit ce qui
 * l'emporte : une objection reçue reste une objection même si une autre
 * relecture est en vol ; un avis favorable ne vaut rien tant qu'une relecture
 * peut encore objecter (la règle de l'Evaluator).
 */
export type IssueRelecture = 'contestee' | 'en_cours' | 'favorable' | 'impossible' | 'absente';

export interface RelectureMission {
  issue: IssueRelecture;
  favorables: number;
  contestataires: number;
  enVol: number;
  /** La cause consignée d'une relecture impossible ; `null` sinon. */
  cause: string | null;
}

export interface LigneMission {
  taskId: string;
  titre: string;
  statut: TaskStatus;
  /**
   * Une relecture croisée est une tâche de la mission : elle coûte, et son
   * temps compte. Mais l'Evaluator ne juge pas une relecture — elle n'a ni
   * décision, ni contre-revue.
   */
  role: 'production' | 'relecture';
  categorie: Categorie;
  /** Modèles commandés à cette tâche, dans l'ordre du journal ; vide sans modèle déclaré. */
  modeles: string[];
  /** Décision COURANTE de l'Evaluator, pour une production terminée ; `null` sinon. */
  evaluator: { decision: EvaluationDecision; raison: string | null; canMerge: boolean } | null;
  relecture: RelectureMission | null;
  reprises: ReprisesParSource;
  chronologie: ChronologieTache;
}

export interface RapportMission {
  taches: LigneMission[];
  totaux: {
    /** Décisions de l'Evaluator sur les productions terminées. */
    decisions: Record<EvaluationDecision, number>;
    reprises: ReprisesParSource;
    /** Tentatives rendues, toutes tâches confondues (dénominateur des couvertures). */
    tentatives: number;
    coutFournisseur: SommeDeclaree | 'inconnu';
    dureeModele: SommeDeclaree | 'inconnu';
    /** Somme des durées Worker connues ; `null` sans aucune. */
    dureeWorkerTotaleMs: number | null;
  };
  /** Faits par modèle et par catégorie, restreints aux tâches de la mission. */
  genome: RegistreGenome;
  fenetre: { evenements: number; depuis: number | null; tronquee: boolean };
}

export interface EntreeMission {
  /** Les tâches du projet. */
  taches: readonly Task[];
  /** Journal lu (types `TYPES_RAPPORT_MISSION`) : peut contenir d'autres projets, filtrés ici. */
  evenements: readonly HiveEvent[];
  /** Borne de la lecture : l'atteindre signale une fenêtre tronquée. */
  borne: number;
  /** Le journal a-t-il déjà perdu des événements (`HiveStore.journalElague`) ? */
  journalElague: boolean;
  /** Tâches qui sont des relectures croisées. */
  relectures: ReadonlySet<string>;
  /** Évaluation courante de chaque production terminée, calculée par le serveur. */
  evaluations: ReadonlyMap<string, EvaluationResult>;
}

const reprisesVides = (): ReprisesParSource =>
  Object.fromEntries(SOURCES_REPRISE.map((s) => [s, 0])) as ReprisesParSource;

function sourceDeReprise(e: HiveEvent): SourceReprise | null {
  if (e.type === 'task_requeued') return 'remise_en_file';
  if (e.type !== 'task_retry') return null;
  if (e.payload.source !== 'evaluator') return 'worker';
  const critique = e.payload.critique;
  const source =
    typeof critique === 'object' && critique !== null
      ? (critique as Record<string, unknown>).source
      : undefined;
  return source === 'contre_revue' || source === 'revue_humaine' || source === 'evaluator'
    ? source
    : 'inconnue';
}

function modelesCommandes(evenements: readonly HiveEvent[]): string[] {
  const vus = new Set<string>();
  for (const e of evenements) {
    if (e.type === 'task_assigned' && typeof e.payload.modele === 'string' && e.payload.modele) {
      vus.add(e.payload.modele);
    } else if (e.type === 'drone_race_started') {
      const modeles = e.payload.modeles;
      if (typeof modeles !== 'object' || modeles === null) continue;
      for (const m of Object.values(modeles as Record<string, unknown>)) {
        if (typeof m === 'string' && m) vus.add(m);
      }
    }
  }
  return [...vus];
}

function relectureDe(evaluation: EvaluationResult): RelectureMission {
  const { crossReview, crossReviewPending, crossReviewImpossible } = evaluation.evidence;
  const contestataires = crossReview.contestingReviewers;
  const favorables = crossReview.approvingReviewers;
  const issue: IssueRelecture =
    contestataires > 0 || crossReview.status === 'improvement_required'
      ? 'contestee'
      : crossReviewPending > 0
        ? 'en_cours'
        : favorables > 0 || crossReview.status === 'applied'
          ? 'favorable'
          : crossReviewImpossible
            ? 'impossible'
            : 'absente';
  return {
    issue,
    favorables,
    contestataires,
    enVol: crossReviewPending,
    cause: issue === 'impossible' ? (crossReviewImpossible ?? null) : null,
  };
}

/** Le rapport de mission d'un projet, à partir de ses tâches et du journal retenu. */
export function rapportDeMission(entree: EntreeMission): RapportMission {
  const ids = new Set(entree.taches.map((t) => t.id));
  const parTache = new Map<string, HiveEvent[]>();
  const lus: HiveEvent[] = [];
  for (const e of [...entree.evenements].sort((a, b) => a.id - b.id)) {
    const taskId = e.payload.taskId;
    if (typeof taskId !== 'string' || !ids.has(taskId)) continue;
    lus.push(e);
    const liste = parTache.get(taskId);
    if (liste) liste.push(e);
    else parTache.set(taskId, [e]);
  }

  const categories = new Map<string, Categorie>(
    entree.taches.map((t) => [t.id, categoriser(t.title, t.prompt)]),
  );
  const decisions = Object.fromEntries(DECISIONS.map((d) => [d, 0])) as Record<
    EvaluationDecision,
    number
  >;
  const reprisesTotales = reprisesVides();
  const lignes: LigneMission[] = [];

  // L'ordre de création : une mission se lit dans l'ordre où elle a été posée.
  for (const tache of [...entree.taches].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )) {
    const evenements = parTache.get(tache.id) ?? [];
    const role = entree.relectures.has(tache.id) ? 'relecture' : 'production';
    const evaluation =
      role === 'production' && tache.status === 'done'
        ? entree.evaluations.get(tache.id)
        : undefined;
    if (evaluation) decisions[evaluation.decision] += 1;
    const reprises = reprisesVides();
    for (const e of evenements) {
      const source = sourceDeReprise(e);
      if (source === null) continue;
      reprises[source] += 1;
      reprisesTotales[source] += 1;
    }
    lignes.push({
      taskId: tache.id,
      titre: tache.title,
      statut: tache.status,
      role,
      categorie: categories.get(tache.id)!,
      modeles: modelesCommandes(evenements),
      evaluator: evaluation
        ? {
            decision: evaluation.decision,
            raison: evaluation.reasons[0] ?? null,
            canMerge: evaluation.canMerge,
          }
        : null,
      relecture: evaluation ? relectureDe(evaluation) : null,
      reprises,
      chronologie: chronologieDepuisEvenements(tache.createdAt, evenements),
    });
  }

  const tentatives = lignes.flatMap((l) => l.chronologie.tentatives);
  const dureesConnues = tentatives
    .map((t) => t.dureeWorkerMs)
    .filter((d): d is number => d !== null);
  return {
    taches: lignes,
    totaux: {
      decisions,
      reprises: reprisesTotales,
      tentatives: tentatives.length,
      coutFournisseur: sommeDeclaree(tentatives.map((t) => t.coutUsd)),
      dureeModele: sommeDeclaree(tentatives.map((t) => t.dureeModeleMs)),
      dureeWorkerTotaleMs:
        dureesConnues.length > 0 ? dureesConnues.reduce((s, d) => s + d, 0) : null,
    },
    genome: registreGenomeDepuisEvenements(
      lus.filter((e) => (TYPES_REGISTRE_GENOME as readonly string[]).includes(e.type)),
      (taskId) => categories.get(taskId) ?? null,
      Number.POSITIVE_INFINITY,
      entree.journalElague || entree.evenements.length >= entree.borne,
    ),
    fenetre: {
      evenements: lus.length,
      depuis: lus[0]?.ts ?? null,
      tronquee: entree.journalElague || entree.evenements.length >= entree.borne,
    },
  };
}
