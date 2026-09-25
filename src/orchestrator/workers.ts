import {
  CATEGORIES,
  categoriser,
  classer,
  replierAntecedents,
  recompenseDe,
  type Categorie,
  type Observation,
} from './aiguillage.js';
import type { HiveNode, Task, TaskStatus } from '../shared/types.js';
import type { Suite } from './polyethisme.js';
import type { MetierCycle } from './metier.js';
import type { HiveEvent } from '../shared/types.js';
import { projeterJournalOuvrier } from './journal-ouvriere.js';
import { LIMITES_DELEGATION_DEFAUT, type LimitesDelegation } from './delegation.js';

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
 * `score` est le score UCB de l'Aiguillage quand le modèle a déjà un vécu.
 * Un modèle inconnu reste explicitement à explorer : `null` n'est jamais
 * transformé en zéro, car « inconnu » et « mauvais » ne sont pas le même fait.
 */
export interface ModeleWorkerSnapshot {
  modele: string;
  categories: Record<
    Categorie,
    {
      essais: number;
      moyenne: number | null;
      score: number | null;
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

type LigneObservation = Pick<Observation, 'modele' | 'suite'> & {
  title: string;
  prompt: string;
  nodeId?: string;
  modeleExact?: string;
};

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

const scoreDe = (rang: ReturnType<typeof classer>[number]) => ({
  essais: rang.essais,
  moyenne: rang.essais > 0 ? rang.moyenne : null,
  score: rang.essais > 0 && Number.isFinite(rang.score) ? rang.score : null,
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
  lignes: readonly LigneObservation[],
  activeTasks: readonly Pick<
    Task,
    'id' | 'title' | 'status' | 'assignedNodeId' | 'attempts' | 'branch' | 'updatedAt'
  >[] = [],
  identites: ReadonlyMap<string, WorkerIdentitySnapshot> = new Map(),
  historiques: ReadonlyMap<string, readonly WorkerHistorySnapshot[]> = new Map(),
): WorkerSnapshot[] {
  const antecedents = replierAntecedents(
    lignes.map((ligne) => ({
      categorie: categoriser(ligne.title, ligne.prompt),
      modele: ligne.modele,
      suite: ligne.suite,
    })),
  );

  return nodes.map((node) => {
    const modeles = node.modeles?.slice().sort((a, b) => a.localeCompare(b));
    const lignesDuWorker = lignes.filter((ligne) => ligne.nodeId === node.id);
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
    };

    if (modeles && modeles.length > 0) {
      projection.modeles = modeles.map((modele) => ({
        modele,
        categories: Object.fromEntries(
          CATEGORIES.map((categorie) => {
            const rang = classer(categorie, [modele], antecedents)[0]!;
            return [categorie, scoreDe(rang)];
          }),
        ) as ModeleWorkerSnapshot['categories'],
        reputation: reputationDe(lignesDuWorker.filter((ligne) => ligne.modeleExact === modele)),
      }));
    }

    return projection;
  });
}
