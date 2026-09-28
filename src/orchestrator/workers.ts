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
import { LIMITES_DELEGATION_DEFAUT, type LimitesDelegation } from '../shared/limites-delegation.js';

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
): WorkerSnapshot[] {
  const antecedents = antecedentsDuVecu(vecu.verdicts, vecu.enVol);

  return nodes.map((node) => {
    // Dédupliqués comme l'union de `aiguillerNoeuds` : un modèle déclaré deux
    // fois compterait double dans le total du genre, donc dans le bonus.
    const modeles = node.modeles && [...new Set(node.modeles)].sort((a, b) => a.localeCompare(b));
    const lignesDuWorker = vecu.verdicts.filter((ligne) => ligne.nodeId === node.id);
    const projection: WorkerSnapshot = {
      id: node.id,
      name: node.name,
      ownerName: node.ownerName,
      agentType: node.agentType,
      ...(identites.has(node.id) ? { identite: identites.get(node.id) } : {}),
      status: node.status,
      running: node.running,
      maxConcurrency: node.maxConcurrency,
      // Pour du travail NEUF, un parent qui attend ses enfants tient sa place :
      // il ne la relâche qu'à son propre arbre (`slotsOccupes`, delegation.ts).
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
      }));
    }

    return projection;
  });
}
