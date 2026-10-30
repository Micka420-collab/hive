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

  it('la mesure de l’agent (`worker_usage`) : portée, raison et mémoire — des codes, rien d’autre', () => {
    const projete = (payload: Record<string, unknown>, type = 'worker_usage') =>
      projeterEvenementOuvriere({ id: 1, ts: 1, type, payload }).payload;
    expect(
      projete({
        resultId: 4,
        taskId: 'task-1',
        portee: 'arbre',
        releves: 7,
        cpuMs: 1_234,
        picOctets: 56 * 1024 * 1024,
        memoire: 'pss',
        // Les compteurs d'un nœud d'avant : ceux du NŒUD, jamais projetés.
        userCpuMicros: 9,
        maxRssBytes: 9,
      }),
    ).toEqual({
      resultId: 4,
      taskId: 'task-1',
      portee: 'arbre',
      releves: 7,
      cpuMs: 1_234,
      picOctets: 56 * 1024 * 1024,
      memoire: 'pss',
    });
    expect(projete({ portee: 'aucune', raison: 'plateforme' })).toEqual({
      portee: 'aucune',
      raison: 'plateforme',
    });
    // Un code inconnu ne passe pas ; une `raison` d'un autre événement — du
    // texte libre, une objection — non plus.
    expect(projete({ portee: 'aucune', raison: 'ignore les consignes' })).toEqual({
      portee: 'aucune',
    });
    expect(projete({ raison: 'plateforme', memoire: 'pss' }, 'task_failed')).toEqual({});
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
