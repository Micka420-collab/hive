// Rapport par projet (innovation) — l'avancement d'un projet en un coup d'œil.
//
// Un porteur de projet veut savoir : où en est MON projet ? Ce module PUR calcule,
// à partir de la liste des tâches du projet, l'avancement (%), la répartition par
// statut, les nœuds qui y ont contribué et le total des tentatives. Aucune I/O :
// la vue est un simple repli de l'état des tâches, donc testable isolément.

import type { Project, Task, TaskStatus } from '../shared/types.js';

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
