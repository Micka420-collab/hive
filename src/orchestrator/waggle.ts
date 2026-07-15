// Waggle Board / Nectar (palier 4) — le « tableau de la danse frétillante ».
//
// Chez l'abeille, la danse frétillante (waggle dance) signale aux autres où se
// trouve le meilleur nectar. Ici, le Waggle Board classe les NŒUDS par
// contribution réelle à la ruche : qui a butiné le plus de tâches, avec quelle
// fiabilité et quelle rapidité. Objectif humain : rendre visible et valoriser la
// puissance de calcul que chaque membre prête au projet commun.
//
// Comme le Time-Lapse Replay, ce module est PUR et se calcule en repliant le
// journal d'événements (source de vérité) : aucune I/O, aucun état global —
// donc testable et réutilisable côté serveur comme dashboard.

import type { HiveEvent } from '../shared/types.js';

/** Contribution d'un nœud, dérivée du journal. */
export interface NodeNectar {
  nodeId: string;
  name: string;
  agentType: string;
  tasksDone: number;
  tasksFailed: number;
  /** Durée cumulée des tâches terminées avec succès (ms). */
  totalDurationMs: number;
  /** Durée moyenne d'une tâche réussie (ms), 0 si aucune. */
  avgDurationMs: number;
  /** done / (done + failed), dans [0, 1] ; 1 si le nœud n'a jamais échoué. */
  successRate: number;
  /** Victoires en course de drones (Drone Wars) : premier succès sur une tâche disputée. */
  raceWins: number;
  /** Score « nectar » : synthèse déterministe et explicable (voir computeScore). */
  score: number;
}

/** Le tableau complet + quelques totaux de ruche. */
export interface WaggleBoard {
  nodes: NodeNectar[];
  totalTasksDone: number;
  totalTasksFailed: number;
  /** nodeId du meilleur contributeur (tête du classement), sinon null. */
  topNodeId: string | null;
}

interface Acc {
  nodeId: string;
  name: string;
  agentType: string;
  tasksDone: number;
  tasksFailed: number;
  totalDurationMs: number;
  raceWins: number;
}

/** Points par tâche terminée : base du nectar. */
const NECTAR_PER_TASK = 10;

/** Bonus par victoire de course (Drone Wars) — s'ajoute au nectar de la tâche
 * gagnée (le vainqueur émet aussi un `task_done`) : gagner face à d'autres
 * drones vaut une demi-tâche de prestige en plus. */
const RACE_WIN_BONUS = 5;

function num(payload: Record<string, unknown>, key: string): number {
  const v = payload[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function ensure(map: Map<string, Acc>, nodeId: string): Acc {
  let acc = map.get(nodeId);
  if (!acc) {
    acc = {
      nodeId,
      name: nodeId,
      agentType: 'inconnu',
      tasksDone: 0,
      tasksFailed: 0,
      totalDurationMs: 0,
      raceWins: 0,
    };
    map.set(nodeId, acc);
  }
  return acc;
}

/**
 * Score nectar : récompense le travail RÉELLEMENT abouti, pondéré par la
 * fiabilité. Un nœud qui échoue souvent butine « moins bon nectar ».
 *   score = tasksDone × 10 × (½ + ½ × tauxDeSuccès) + victoires × 5
 * Ainsi une tâche vaut 10 points à fiabilité parfaite, et jusqu'à 5 si le nœud
 * est très peu fiable — sans jamais rendre une contribution négative. Une
 * victoire de course (Drone Wars) ajoute un bonus plat de 5 : le vainqueur a
 * déjà son `task_done`, le bonus salue la vitesse face aux concurrents. Formule
 * volontairement simple et monotone (plus de réussites, de fiabilité ou de
 * victoires ⇒ plus de score), donc facile à expliquer à un contributeur.
 */
export function computeScore(tasksDone: number, successRate: number, raceWins = 0): number {
  return (
    Math.round(tasksDone * NECTAR_PER_TASK * (0.5 + 0.5 * successRate)) + raceWins * RACE_WIN_BONUS
  );
}

/**
 * Construit le Waggle Board à partir du journal. On attribue :
 *  - `task_done` {nodeId, durationMs} → une réussite (+ durée) au nœud ;
 *  - `task_failed` {nodeId} → un échec au nœud (les échecs SANS nodeId, ex.
 *    `dependency_failed`, ne sont imputables à personne : ignorés) ;
 *  - `drone_won` {nodeId} → une victoire de course (bonus, en plus du task_done) ;
 *  - `node_registered` / `node_online` {nodeId, name, agentType} → identité.
 * Les `drone_failed` / `drone_cancelled` restent volontairement NEUTRES : la
 * course est de la redondance opt-in — pénaliser les perdants découragerait la
 * participation, un drone annulé n'a commis aucune faute, et l'échec collectif
 * émet déjà un `task_failed` imputable (pas de double peine).
 * Le classement est trié par score décroissant, puis par réussites, puis par
 * nom (ordre stable et déterministe).
 */
export function buildWaggleBoard(events: HiveEvent[]): WaggleBoard {
  const accs = new Map<string, Acc>();

  for (const event of events) {
    const p = event.payload ?? {};
    const nodeId = str(p, 'nodeId');
    switch (event.type) {
      case 'node_registered':
      case 'node_online': {
        if (nodeId) {
          const acc = ensure(accs, nodeId);
          acc.name = str(p, 'name') ?? acc.name;
          acc.agentType = str(p, 'agentType') ?? acc.agentType;
        }
        break;
      }
      case 'task_done': {
        if (nodeId) {
          const acc = ensure(accs, nodeId);
          acc.tasksDone += 1;
          acc.totalDurationMs += num(p, 'durationMs');
        }
        break;
      }
      case 'task_failed': {
        // Seuls les échecs imputables à un nœud comptent (pas les dépendances).
        if (nodeId) ensure(accs, nodeId).tasksFailed += 1;
        break;
      }
      case 'drone_won': {
        if (nodeId) ensure(accs, nodeId).raceWins += 1;
        break;
      }
      default:
        break;
    }
  }

  const nodes: NodeNectar[] = [...accs.values()].map((a) => {
    const attempts = a.tasksDone + a.tasksFailed;
    const successRate = attempts === 0 ? 1 : a.tasksDone / attempts;
    const avgDurationMs = a.tasksDone === 0 ? 0 : Math.round(a.totalDurationMs / a.tasksDone);
    return {
      nodeId: a.nodeId,
      name: a.name,
      agentType: a.agentType,
      tasksDone: a.tasksDone,
      tasksFailed: a.tasksFailed,
      totalDurationMs: a.totalDurationMs,
      avgDurationMs,
      successRate,
      raceWins: a.raceWins,
      score: computeScore(a.tasksDone, successRate, a.raceWins),
    };
  });

  nodes.sort(
    (x, y) => y.score - x.score || y.tasksDone - x.tasksDone || x.name.localeCompare(y.name),
  );

  return {
    nodes,
    totalTasksDone: nodes.reduce((s, n) => s + n.tasksDone, 0),
    totalTasksFailed: nodes.reduce((s, n) => s + n.tasksFailed, 0),
    topNodeId: nodes.length > 0 ? (nodes[0]?.nodeId ?? null) : null,
  };
}
