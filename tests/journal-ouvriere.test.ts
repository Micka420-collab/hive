import { describe, expect, it } from 'vitest';
import { projeterEvenementOuvriere } from '../src/orchestrator/journal-ouvriere.js';

describe('journal Worker contrôlé', () => {
  it('garde les faits utiles, borne le texte et retire logs/diffs/secrets', () => {
    const entry = projeterEvenementOuvriere({
      id: 7,
      ts: 42,
      type: 'task_progress',
      payload: {
        taskId: 'task-1',
        nodeId: 'worker-1',
        title: 'Éditer le pont',
        error: 'HIVE_TOKEN=super-secret',
        logs: 'sk-live-secret et une sortie inutile',
        diff: 'diff --git a/.env b/.env',
        durationMs: -3,
      },
    });

    expect(entry).toEqual({
      id: 7,
      ts: 42,
      type: 'task_progress',
      payload: {
        taskId: 'task-1',
        nodeId: 'worker-1',
        title: 'Éditer le pont',
        error: '[secret]',
        durationMs: 0,
      },
    });
    expect(JSON.stringify(entry)).not.toContain('sk-live-secret');
    expect(JSON.stringify(entry)).not.toContain('super-secret');
    expect(JSON.stringify(entry)).not.toContain('diff --git');
  });

  it('ne transforme pas un identifiant de tâche valide en faux secret', () => {
    const entry = projeterEvenementOuvriere({
      id: 9,
      ts: 44,
      type: 'task_done',
      payload: { taskId: 'task-observed', nodeId: 'worker-1' },
    });

    expect(entry.payload).toMatchObject({ taskId: 'task-observed', nodeId: 'worker-1' });
  });

  it('conserve un événement futur sans laisser passer ses champs inconnus', () => {
    const entry = projeterEvenementOuvriere({
      id: 8,
      ts: 43,
      type: 'future event with spaces',
      payload: { detail: 'instruction libre', attempts: 2, possible: true },
    });

    expect(entry).toEqual({
      id: 8,
      ts: 43,
      type: 'worker_event',
      payload: { attempts: 2, possible: true },
    });
  });
});
