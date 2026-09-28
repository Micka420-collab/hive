import {
  CATEGORIES,
  antecedentsDuVecu,
  categoriser,
  classer,
  recompenseDe,
  type Categorie,
  type ElectionEnVol,
  type Rang,
  type VerdictAiguillage,
} from './aiguillage.js';
import type { HiveNode, Task, TaskStatus } from '../shared/types.js';
import type { Suite } from './polyethisme.js';
import type { MetierCycle } from './metier.js';
import type { HiveEvent } from '../shared/types.js';
import { projeterJournalOuvrier } from './journal-ouvriere.js';
import { LIMITES_DELEGATION_DEFAUT, type LimitesDelegation } from './delegation.js';
import type { EvaluationDecision } from './evaluator.js';
import {
  TYPES_TENTATIVES,
  bilanEconomique,
  tentativeRendue,
  type BilanEconomique,
  type TentativeRendue,
} from '../shared/economie.js';

/** Identité humaine constatée par la Reine, distincte du nœud technique. */
export interface WorkerIdentitySnapshot {
  /** Baptême persistant ; null signifie qu'aucun nom n'a été posé. */
  bapteme: { nom: string; baptiseA: number } | null;
  /** Métier de cycle persistant ; null signifie qu'aucun rôle n'est assigné. */
  metier: { metier: MetierCycle; assigneA: number } | null;
}

/** Faits récents bornés d'un Worker, sans logs, diff, prompt ni secret. */
export interface WorkerHistorySnapshot {
  id: number;
  ts: number;
  type: string;
  taskId?: string;
  childTaskId?: string;
  resultId?: number;
  title?: string;
  status?: string;
  decision?: string;
  reason?: string;
}

/** Limites d'autonomie réellement appliquées à la délégation Hive. */
export interface WorkerAutonomySnapshot {
  delegation: Readonly<LimitesDelegation>;
}

const HISTORIQUE_WORKER_MAX = 5;

/**
 * Réduit le journal durable au contrat de la carte Worker.
 * JournalOuvriere porte déjà l'allowlist et la neutralisation des textes ;
 * cette projection empêche en plus qu'un nouveau champ du journal élargisse
 * silencieusement la réponse de GET /api/workers.
 */
export function projeterHistoriqueWorker(events: readonly HiveEvent[]): WorkerHistorySnapshot[] {
  return projeterJournalOuvrier(events)
    .slice(0, HISTORIQUE_WORKER_MAX)
    .map(({ id, ts, type, payload }) => ({
      id,
      ts,
      type,
      ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
      ...(typeof payload.childTaskId === 'string' ? { childTaskId: payload.childTaskId } : {}),
      ...(typeof payload.resultId === 'number' ? { resultId: payload.resultId } : {}),
      ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
      ...(typeof payload.status === 'string' ? { status: payload.status } : {}),
      ...(typeof payload.decision === 'string' ? { decision: payload.decision } : {}),
      ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
    }));
}

export interface WorkerReputationSnapshot {
  /** Nombre de verdicts reliés à ce Worker par le résultat exact. */
  essais: number;
  appliquer: number;
  ameliorer: number;
  refaire: number;
  moyenne: number | null;
  /** Récompense moyenne de l'Aiguillage, dans [0, 1]. */
  score: number | null;
  /** `absente` signifie qu'aucun résultat exact n'est encore attribuable. */
  attribution: 'exacte' | 'absente';
}

/**
 * Preuve disponible pour un modèle déclaré par une ouvrière.
 *
 * Chaque case est une ligne du `classer` de l'Aiguillage, sur les MÊMES
 * antécédents que l'ordonnanceur (`antecedentsDuVecu` : modèle prouvé,
 * élections en vol) et parmi les modèles déclarés par CE Worker — le calcul
 * exact d'une course de drones sur ce poste. L'assignation ordinaire classe
 * l'union des Workers éligibles : quand d'autres déclarent d'autres modèles,
 * son bonus d'exploration diffère, jamais les essais ni la moyenne.
 *
 * Un modèle jamais jugé reste explicitement à explorer : `moyenne: null` n'est
 * jamais transformé en zéro, car « inconnu » et « mauvais » ne sont pas le même
 * fait. `score` est `null` seulement quand il est infini (ni jugé, ni en vol).
 */
export interface ModeleWorkerSnapshot {
  modele: string;
  categories: Record<
    Categorie,
    {
      /** Verdicts reçus sur ce genre. */
      essais: number;
      /** Élections lancées et pas encore jugées : pèsent sur le score, pas sur la moyenne. */
      enVol: number;
      moyenne: number | null;
      score: number | null;
      /** Aucun verdict reçu : l'Aiguillage l'explore avant de prétendre le connaître. */
      exploration: boolean;
    }
  >;
  /** Vécu de ce modèle sur ce Worker, séparé de l'historique global. */
  reputation: WorkerReputationSnapshot;
  /**
   * Ce que les tentatives de CE Worker commandées à CE modèle ont coûté (voir
   * `economieParWorker`). Absente quand la route n'a pas relu le journal.
   */
  economie?: BilanEconomique;
}

/** Projection observable d'un nœud réel, sans seconde source de vérité. */
export interface WorkerSnapshot {
  id: string;
  name: string;
  ownerName: string;
  agentType: string;
  /** Identité humaine persistée, quand elle est disponible dans la projection. */
  identite?: WorkerIdentitySnapshot;
  status: HiveNode['status'];
  running: number;
  maxConcurrency: number;
  slotsLibres: number;
  /** Tâches réellement attribuées à ce Worker au moment de la lecture. */
  currentTasks?: WorkerCurrentTask[];
  /** Limites de délégation appliquées par la Queen, jamais augmentées par le Worker. */
  autonomie?: WorkerAutonomySnapshot;
  /** Fenêtre d'activité persistée, absente si la source n'est pas disponible. */
  historique?: readonly WorkerHistorySnapshot[];
  plateforme?: HiveNode['plateforme'];
  outils?: HiveNode['outils'];
  /** Réputation du Worker, calculée uniquement sur ses résultats attribués. */
  reputation: WorkerReputationSnapshot;
  /**
   * La même réputation, par catégorie de tâche : un Worker peut exceller en
   * interface et n'avoir jamais été jugé en sécurité. Seules les catégories où
   * ce Worker a des verdicts attribués figurent — une catégorie ABSENTE est
   * une catégorie inconnue, jamais une réputation nulle.
   */
  reputationParCategorie: Partial<Record<Categorie, WorkerReputationSnapshot>>;
  modeles?: ModeleWorkerSnapshot[];
  /**
   * Coût et temps modèle DÉCLARÉS, durée Worker mesurée et sa médiane, sur les
   * tentatives de ce Worker que le journal retient encore (`fenetreEconomie`
   * de la réponse). Absente quand la route n'a pas relu le journal — un
   * Worker sans tentative, lui, a un bilan à zéro et `inconnu`.
   */
  economie?: BilanEconomique;
}

export interface WorkerCurrentTask {
  id: string;
  title: string;
  status: Extract<TaskStatus, 'assigned' | 'running'>;
  attempts: number;
  branch: string | null;
  updatedAt: number;
}

type LigneObservation = VerdictAiguillage & {
  /** Worker qui a produit le résultat relu, quand le lien est encore prouvé. */
  nodeId?: string;
};

/**
 * Le vécu de l'Aiguillage tel que l'ordonnanceur le relit : les verdicts ET
 * les élections en vol. Les deux sont nécessaires pour montrer les scores sur
 * lesquels il décide réellement.
 */
export interface VecuAiguillage {
  verdicts: readonly LigneObservation[];
  enVol: readonly ElectionEnVol[];
}

function reputationDe(lignes: readonly LigneObservation[]): WorkerReputationSnapshot {
  let appliquer = 0;
  let ameliorer = 0;
  let refaire = 0;
  let total = 0;
  for (const ligne of lignes) {
    switch (ligne.suite as Suite) {
      case 'appliquer':
        appliquer += 1;
        break;
      case 'ameliorer':
        ameliorer += 1;
        break;
      case 'refaire':
        refaire += 1;
        break;
    }
    total += recompenseDe(ligne.suite);
  }
  const essais = appliquer + ameliorer + refaire;
  return {
    essais,
    appliquer,
    ameliorer,
    refaire,
    moyenne: essais > 0 ? total / essais : null,
    score: essais > 0 ? total / essais : null,
    attribution: essais > 0 ? 'exacte' : 'absente',
  };
}

/**
 * La réputation par catégorie : les verdicts du Worker regroupés selon la
 * catégorie de la tâche jugée (la même `categoriser` que l'Aiguillage). Une
 * catégorie sans verdict n'apparaît pas : l'absence de données reste une
 * absence, pas un zéro.
 */
function reputationParCategorieDe(
  lignes: readonly LigneObservation[],
): Partial<Record<Categorie, WorkerReputationSnapshot>> {
  const parCategorie = new Map<Categorie, LigneObservation[]>();
  for (const ligne of lignes) {
    const categorie = categoriser(ligne.title, ligne.prompt);
    const groupe = parCategorie.get(categorie);
    if (groupe) groupe.push(ligne);
    else parCategorie.set(categorie, [ligne]);
  }
  const resultat: Partial<Record<Categorie, WorkerReputationSnapshot>> = {};
  for (const categorie of CATEGORIES) {
    const groupe = parCategorie.get(categorie);
    if (!groupe) continue;
    const reputation = reputationDe(groupe);
    if (reputation.essais > 0) resultat[categorie] = reputation;
  }
  return resultat;
}

const scoreDe = (rang: Rang): ModeleWorkerSnapshot['categories'][Categorie] => ({
  essais: rang.essais,
  enVol: rang.enVol,
  moyenne: rang.essais > 0 ? rang.moyenne : null,
  // `+∞` (ni jugé, ni en vol) n'a pas de JSON : `null`, jamais un nombre inventé.
  score: Number.isFinite(rang.score) ? rang.score : null,
  exploration: rang.essais === 0,
});

// ─── L'économie de chaque Worker, et de chacun de ses modèles ───────────────

/** Les types que `economieParWorker` relit : les issues, et les affectations qui nomment le modèle. */
export const TYPES_ECONOMIE_WORKERS = [
  'task_assigned',
  'drone_race_started',
  ...TYPES_TENTATIVES,
] as const;

/** Le bilan d'un Worker, et celui de chaque modèle qui lui a été commandé. */
export interface EconomieWorker {
  total: BilanEconomique;
  parModele: ReadonlyMap<string, BilanEconomique>;
}

const texteNonVide = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/**
 * Replie le journal en bilan économique par Worker, et par Worker + modèle.
 *
 * Le Worker est celui que NOMME l'issue (`nodeId` de l'événement) : aucune
 * attribution n'est déduite. Le modèle est celui que l'Aiguillage a COMMANDÉ
 * à ce nœud pour cette tâche — `task_assigned` pour le primaire,
 * `drone_race_started` pour chaque drone d'une course (le premier ne nomme
 * que le primaire). Une issue dont l'affectation est sortie de la fenêtre, ou
 * qui a tourné sans modèle déclaré, compte pour le Worker et pour AUCUN
 * modèle : la ligne d'un modèle ne reçoit jamais une tentative devinée. La
 * somme des modèles peut donc être inférieure au total du Worker — jamais
 * supérieure.
 */
export function economieParWorker(evenements: readonly HiveEvent[]): Map<string, EconomieWorker> {
  // taskId → nodeId → modèle commandé à la dernière affectation de ce nœud.
  const commandes = new Map<string, Map<string, string | null>>();
  const parNoeud = new Map<
    string,
    { toutes: TentativeRendue[]; parModele: Map<string, TentativeRendue[]> }
  >();
  const commander = (taskId: string, nodeId: string, modele: string | null): void => {
    const parTache = commandes.get(taskId) ?? new Map<string, string | null>();
    parTache.set(nodeId, modele);
    commandes.set(taskId, parTache);
  };

  for (const e of [...evenements].sort((a, b) => a.id - b.id)) {
    const p = e.payload;
    const taskId = texteNonVide(p.taskId);
    if (taskId === null) continue;
    if (e.type === 'task_assigned') {
      const nodeId = texteNonVide(p.nodeId);
      if (nodeId !== null) commander(taskId, nodeId, texteNonVide(p.modele));
      continue;
    }
    if (e.type === 'drone_race_started') {
      const modeles =
        typeof p.modeles === 'object' && p.modeles !== null
          ? (p.modeles as Record<string, unknown>)
          : {};
      for (const brut of Array.isArray(p.drones) ? p.drones : []) {
        const nodeId = texteNonVide(brut);
        if (nodeId !== null) commander(taskId, nodeId, texteNonVide(modeles[nodeId]));
      }
      continue;
    }
    const tentative = tentativeRendue(e);
    if (!tentative) continue;
    const bilan = parNoeud.get(tentative.nodeId) ?? {
      toutes: [] as TentativeRendue[],
      parModele: new Map<string, TentativeRendue[]>(),
    };
    parNoeud.set(tentative.nodeId, bilan);
    bilan.toutes.push(tentative);
    const modele = commandes.get(taskId)?.get(tentative.nodeId) ?? null;
    if (modele !== null) {
      const duModele = bilan.parModele.get(modele) ?? [];
      duModele.push(tentative);
      bilan.parModele.set(modele, duModele);
    }
  }

  return new Map(
    [...parNoeud].map(([nodeId, { toutes, parModele }]) => [
      nodeId,
      {
        total: bilanEconomique(toutes),
        parModele: new Map(
          [...parModele].map(([modele, tentatives]) => [modele, bilanEconomique(tentatives)]),
        ),
      },
    ]),
  );
}

// ─── La qualité d'un Worker : ce que l'Evaluator a accepté ───────────────────

/**
 * En deçà, une part n'est pas une mesure : une production acceptée sur une
 * seule jugée afficherait « 100 % », et deux sur deux ne disent rien de plus.
 * La part reste `inconnu`, ses comptes restent affichés.
 */
export const SEUIL_QUALITE_WORKER = 3;

/** Le sort d'une production de ce Worker, tel que l'Evaluator l'a tranché. */
export interface ProductionJugee {
  resultId: number;
  /**
   * La décision de l'Evaluator sur CETTE production : celle qui l'a renvoyée
   * en correction, ou la décision courante quand elle est encore la
   * production retenue de sa tâche. `null` : sort inconnu (production
   * remplacée sans renvoi constaté, tâche repartie…).
   */
  decision: EvaluationDecision | null;
  /** Renvoyée en correction par l'Evaluator (contre-revue, revue humaine ou geste explicite). */
  corrigee: boolean;
}

/**
 * La qualité d'un Worker, en DEUX mesures séparées — jamais un score composite.
 *
 * `partAcceptee` : parmi les productions sur lesquelles l'Evaluator a TRANCHÉ
 * (acceptée, à corriger, rejetée), la part acceptée. Une production en
 * attente de preuve (`additional_test_required`) ou d'un humain
 * (`human_review_required`) n'est pas jugée : l'Evaluator n'a rien dit de sa
 * qualité, et la compter tirerait la part vers le bas pour une CI absente.
 *
 * `tauxCorrection` : parmi les productions dont le sort est CONNU, la part
 * renvoyée en correction. Une production au sort inconnu (remplacée sans
 * renvoi constaté) n'entre pas au dénominateur : l'y compter comme « non
 * corrigée » tirait le taux vers le bas avec des faits que personne n'a lus.
 */
export interface QualiteWorker {
  /** Productions réussies de ce Worker dans la fenêtre lue (relectures exclues). */
  productions: number;
  /** Celles dont l'Evaluator a dit le sort (`decision` non nulle). */
  sortConnu: number;
  jugees: number;
  acceptees: number;
  /** acceptees / jugees ; `inconnu` sous SEUIL_QUALITE_WORKER productions jugées. */
  partAcceptee: number | 'inconnu';
  corrigees: number;
  /** corrigees / sortConnu ; `inconnu` sous SEUIL_QUALITE_WORKER productions au sort connu. */
  tauxCorrection: number | 'inconnu';
  /**
   * La lecture s'est arrêtée aux N résultats les plus récents
   * (`PRODUCTIONS_QUALITE_MAX`) : la mesure porte sur eux, pas sur toute la
   * fenêtre, et N est dit. `null` : toute la fenêtre a été lue.
   */
  bornee: number | null;
}

/**
 * Au plus tant de résultats relus pour juger un Worker : chacun demande
 * l'Evaluator de sa tâche. Au-delà, la mesure porte sur les plus récents — et
 * le DIT (`bornee`), au lieu de se présenter comme celle de toute la fenêtre.
 */
export const PRODUCTIONS_QUALITE_MAX = 100;

const DECISIONS_TRANCHEES: ReadonlySet<EvaluationDecision> = new Set<EvaluationDecision>([
  'accepted',
  'correction_required',
  'rejected',
]);

export function qualiteDesProductions(
  productions: readonly ProductionJugee[],
  bornee: number | null = null,
): QualiteWorker {
  const connues = productions.filter((p) => p.decision !== null);
  const jugees = connues.filter((p) => DECISIONS_TRANCHEES.has(p.decision!));
  const acceptees = jugees.filter((p) => p.decision === 'accepted').length;
  const corrigees = connues.filter((p) => p.corrigee).length;
  return {
    productions: productions.length,
    sortConnu: connues.length,
    jugees: jugees.length,
    acceptees,
    partAcceptee: jugees.length >= SEUIL_QUALITE_WORKER ? acceptees / jugees.length : 'inconnu',
    corrigees,
    tauxCorrection: connues.length >= SEUIL_QUALITE_WORKER ? corrigees / connues.length : 'inconnu',
    bornee,
  };
}

/**
 * Construit la projection Workers à partir des nœuds et du vécu de l'Aiguillage.
 *
 * La fonction est pure : elle ne choisit pas un nœud, ne modifie pas le store
 * et ne prétend pas mesurer une compétence absente des résultats observés.
 */
export function projeterWorkers(
  nodes: readonly HiveNode[],
  vecu: VecuAiguillage,
  activeTasks: readonly Pick<
    Task,
    'id' | 'title' | 'status' | 'assignedNodeId' | 'attempts' | 'branch' | 'updatedAt'
  >[] = [],
  identites: ReadonlyMap<string, WorkerIdentitySnapshot> = new Map(),
  historiques: ReadonlyMap<string, readonly WorkerHistorySnapshot[]> = new Map(),
  /** `economieParWorker` du journal ; absent : la route n'a pas relu les issues. */
  economies?: ReadonlyMap<string, EconomieWorker>,
): WorkerSnapshot[] {
  const antecedents = antecedentsDuVecu(vecu.verdicts, vecu.enVol);
  const bilanVide = bilanEconomique([]);

  return nodes.map((node) => {
    // Dédupliqués comme l'union de `aiguillerNoeuds` : un modèle déclaré deux
    // fois compterait double dans le total du genre, donc dans le bonus.
    const modeles = node.modeles && [...new Set(node.modeles)].sort((a, b) => a.localeCompare(b));
    const lignesDuWorker = vecu.verdicts.filter((ligne) => ligne.nodeId === node.id);
    const economie = economies?.get(node.id);
    const projection: WorkerSnapshot = {
      id: node.id,
      name: node.name,
      ownerName: node.ownerName,
      agentType: node.agentType,
      ...(identites.has(node.id) ? { identite: identites.get(node.id) } : {}),
      status: node.status,
      running: node.running,
      maxConcurrency: node.maxConcurrency,
      slotsLibres: Math.max(0, node.maxConcurrency - node.running),
      autonomie: { delegation: { ...LIMITES_DELEGATION_DEFAUT } },
      currentTasks: activeTasks
        .filter(
          (
            task,
          ): task is typeof task & {
            assignedNodeId: string;
            status: Extract<TaskStatus, 'assigned' | 'running'>;
          } =>
            task.assignedNodeId === node.id &&
            (task.status === 'assigned' || task.status === 'running'),
        )
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          attempts: task.attempts,
          branch: task.branch,
          updatedAt: task.updatedAt,
        })),
      ...(historiques.has(node.id) ? { historique: historiques.get(node.id) } : {}),
      ...(node.plateforme !== undefined ? { plateforme: node.plateforme } : {}),
      ...(node.outils !== undefined ? { outils: node.outils } : {}),
      reputation: reputationDe(lignesDuWorker),
      reputationParCategorie: reputationParCategorieDe(lignesDuWorker),
      ...(economies ? { economie: economie?.total ?? bilanVide } : {}),
    };

    if (modeles && modeles.length > 0) {
      // Classés ENSEMBLE, genre par genre, comme `classer` le fait pour une
      // élection : le bonus d'exploration dépend du total du genre sur tous
      // les modèles en lice. Classé seul, chaque modèle recevait le bonus d'un
      // genre où il n'aurait eu aucun rival — un score que le routing ne
      // calcule jamais.
      const classements = CATEGORIES.map(
        (categorie) => [categorie, classer(categorie, modeles, antecedents)] as const,
      );
      projection.modeles = modeles.map((modele) => ({
        modele,
        categories: Object.fromEntries(
          classements.map(([categorie, rang]) => [
            categorie,
            scoreDe(rang.find((r) => r.modele === modele)!),
          ]),
        ) as ModeleWorkerSnapshot['categories'],
        reputation: reputationDe(lignesDuWorker.filter((ligne) => ligne.modeleExact === modele)),
        ...(economies ? { economie: economie?.parModele.get(modele) ?? bilanVide } : {}),
      }));
    }

    return projection;
  });
}
