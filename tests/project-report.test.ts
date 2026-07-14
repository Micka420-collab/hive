// Tests du rapport par projet (innovation) : repli pur de l'état des tâches.

import { describe, expect, it } from 'vitest';
import { buildProjectReport } from '../src/orchestrator/project-report.js';
import type { Project, Task, TaskStatus } from '../src/shared/types.js';

const project: Project = {
  id: 'p1',
  name: 'SaaS',
  repoUrl: null,
  description: null,
  visibility: 'private',
  ownerId: null,
  createdAt: 1,
};

let seq = 0;
function task(status: TaskStatus, extra: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    projectId: 'p1',
    title: `T${seq}`,
    prompt: 'x',
    status,
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 0,
    createdAt: seq,
    updatedAt: seq,
    ...extra,
  };
}

describe('buildProjectReport', () => {
  it('calcule avancement, répartition et complétude', () => {
    const tasks = [
      task('done', { result: { success: true, nodeId: 'n1', durationMs: 10 } }),
      task('done', { assignedNodeId: 'n2' }),
      task('running', { assignedNodeId: 'n2' }),
      task('failed'),
      task('pending'),
    ];
    const r = buildProjectReport(project, tasks);
    expect(r.total).toBe(5);
    expect(r.done).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.progressPct).toBe(40); // 2/5
    expect(r.complete).toBe(false);
    expect(r.byStatus).toMatchObject({ done: 2, running: 1, failed: 1, pending: 1, ready: 0 });
    expect(r.contributingNodes).toEqual(['n1', 'n2']); // distincts et triés
  });

  it('projet terminé = toutes issues terminales', () => {
    const r = buildProjectReport(project, [task('done'), task('failed'), task('done')]);
    expect(r.complete).toBe(true);
    expect(r.progressPct).toBe(67); // 2/3 arrondi
  });

  it('cumule les tentatives et déduplique les nœuds (assignation + résultat)', () => {
    const tasks = [
      task('failed', { attempts: 3, assignedNodeId: 'n1' }),
      task('done', {
        attempts: 2,
        assignedNodeId: 'n1',
        result: { success: true, nodeId: 'n1', durationMs: 5 },
      }),
    ];
    const r = buildProjectReport(project, tasks);
    expect(r.totalAttempts).toBe(5);
    expect(r.contributingNodes).toEqual(['n1']);
  });

  it('projet sans tâche : 0 %, non terminé, toutes les clés à 0', () => {
    const r = buildProjectReport(project, []);
    expect(r.total).toBe(0);
    expect(r.progressPct).toBe(0);
    expect(r.complete).toBe(false);
    expect(r.contributingNodes).toEqual([]);
    expect(r.byStatus).toEqual({
      pending: 0,
      ready: 0,
      assigned: 0,
      running: 0,
      done: 0,
      failed: 0,
    });
  });
});
