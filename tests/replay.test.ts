// Tests du Time-Lapse Replay (palier 3) : le journal d'événements est la source
// de vérité ; rejouer un préfixe reconstruit l'état de la ruche à cet instant.

import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildTimeline,
  countTasks,
  initialReplayState,
  reconstructAt,
} from '../src/orchestrator/replay.js';
import type { HiveEvent } from '../src/shared/types.js';

/** Fabrique un journal : ids 1..n, ts croissants, payload par défaut vide. */
function journal(...specs: Array<[string, Record<string, unknown>?]>): HiveEvent[] {
  return specs.map(([type, payload], i) => ({
    id: i + 1,
    ts: 1_000 + i,
    type,
    payload: payload ?? {},
  }));
}

describe('reconstructAt', () => {
  it('reconstruit l’état complet après un cycle de vie nominal', () => {
    const evs = journal(
      ['project_created', { projectId: 'p1', name: 'SaaS' }],
      ['node_online', { nodeId: 'n1', name: 'Alice' }],
      ['task_created', { taskId: 't1', title: 'Échafauder', projectId: 'p1' }],
      ['task_ready', { taskId: 't1' }],
      ['task_assigned', { taskId: 't1', nodeId: 'n1', branch: 'hive/t1' }],
      ['task_started', { taskId: 't1', nodeId: 'n1' }],
      ['task_done', { taskId: 't1', nodeId: 'n1', durationMs: 42 }],
    );
    const state = reconstructAt(evs);
    expect(state.projects.get('p1')).toBe('SaaS');
    expect(state.nodes.get('n1')?.status).toBe('online');
    const t1 = state.tasks.get('t1');
    expect(t1?.status).toBe('done');
    expect(t1?.nodeId).toBe('n1');
    expect(countTasks(state)).toMatchObject({ done: 1, running: 0, pending: 0 });
  });

  it('remonte le temps : uptoId fige l’état à un instant passé', () => {
    const evs = journal(
      ['task_created', { taskId: 't1', title: 'T1' }],
      ['task_ready', { taskId: 't1' }],
      ['task_assigned', { taskId: 't1', nodeId: 'n1' }],
      ['task_started', { taskId: 't1', nodeId: 'n1' }],
      ['task_done', { taskId: 't1', nodeId: 'n1' }],
    );
    // Juste après l'assignation (#3) : la tâche est « assigned », pas encore lancée.
    expect(reconstructAt(evs, 3).tasks.get('t1')?.status).toBe('assigned');
    // Juste après le démarrage (#4) : « running ».
    expect(reconstructAt(evs, 4).tasks.get('t1')?.status).toBe('running');
    // Tout le journal : « done ».
    expect(reconstructAt(evs).tasks.get('t1')?.status).toBe('done');
  });

  it('requeue renvoie la tâche en file et détache le nœud ; retry compte une tentative', () => {
    const evs = journal(
      ['task_created', { taskId: 't1', title: 'T1' }],
      ['task_assigned', { taskId: 't1', nodeId: 'n1' }],
      ['task_started', { taskId: 't1', nodeId: 'n1' }],
      ['task_retry', { taskId: 't1', nodeId: 'n1' }],
      ['task_requeued', { taskId: 't1', reason: 'reconcile_orphan' }],
    );
    const t1 = reconstructAt(evs).tasks.get('t1');
    expect(t1?.status).toBe('pending');
    expect(t1?.nodeId).toBeNull();
    expect(t1?.attempts).toBe(1); // seul task_retry incrémente
  });

  it('node_offline bascule le statut du nœud ; task_cancelled devient terminale', () => {
    const evs = journal(
      ['node_online', { nodeId: 'n1', name: 'Alice' }],
      ['task_created', { taskId: 't1', title: 'T1' }],
      ['node_offline', { nodeId: 'n1', reason: 'timeout' }],
      ['task_cancelled', { taskId: 't1', reason: 'user' }],
    );
    const state = reconstructAt(evs);
    expect(state.nodes.get('n1')?.status).toBe('offline');
    expect(state.tasks.get('t1')?.status).toBe('failed');
  });

  it('ignore les événements informatifs et inconnus sans erreur', () => {
    const evs = journal(
      ['task_created', { taskId: 't1', title: 'T1' }],
      ['task_progress', { taskId: 't1', subAgents: [] }],
      ['result_ignored', { taskId: 't1', nodeId: 'n1', reason: 'unknown_task' }],
      ['boot_recovery', { requeued: 0 }],
      ['un_type_du_futur', { foo: 'bar' }],
    );
    const state = reconstructAt(evs);
    expect(state.tasks.get('t1')?.status).toBe('pending'); // inchangé
    expect(countTasks(state).pending).toBe(1);
  });

  it('applyEvent est tolérant à une tâche/un nœud inconnus (no-op)', () => {
    const state = initialReplayState();
    applyEvent(state, { id: 1, ts: 1, type: 'task_done', payload: { taskId: 'fantome' } });
    applyEvent(state, { id: 2, ts: 2, type: 'node_offline', payload: { nodeId: 'fantome' } });
    expect(state.tasks.size).toBe(0);
    // node_offline crée une entrée offline même sans node_online préalable (robustesse).
    expect(state.nodes.get('fantome')?.status).toBe('offline');
  });
});

describe('buildTimeline', () => {
  it('produit une frame par événement, la dernière résumant l’état final', () => {
    const evs = journal(
      ['project_created', { projectId: 'p1', name: 'SaaS' }],
      ['node_online', { nodeId: 'n1', name: 'Alice' }],
      ['task_created', { taskId: 't1', title: 'T1' }],
      ['task_started', { taskId: 't1', nodeId: 'n1' }],
      ['task_done', { taskId: 't1', nodeId: 'n1' }],
    );
    const r = buildTimeline(evs);
    expect(r.frames).toHaveLength(5);
    expect(r.eventCount).toBe(5);
    expect(r.lastEventId).toBe(5);
    // Frame #2 : 1 projet, 1 nœud en ligne, 0 tâche encore.
    expect(r.frames[1]).toMatchObject({ eventId: 2, projects: 1, nodesOnline: 1, nodesTotal: 1 });
    // Frame finale : tâche done.
    expect(r.finalCounts?.tasks.done).toBe(1);
    expect(r.finalCounts?.eventId).toBe(5);
  });

  it('journal vide → aucune frame, résumé nul', () => {
    const r = buildTimeline([]);
    expect(r.frames).toEqual([]);
    expect(r.finalCounts).toBeNull();
    expect(r.lastEventId).toBe(0);
    expect(r.eventCount).toBe(0);
  });

  it('les compteurs suivent les transitions au fil du temps', () => {
    const evs = journal(
      ['task_created', { taskId: 't1', title: 'A' }],
      ['task_created', { taskId: 't2', title: 'B' }],
      ['task_started', { taskId: 't1', nodeId: 'n1' }],
    );
    const r = buildTimeline(evs);
    expect(r.frames[0]?.tasks.pending).toBe(1);
    expect(r.frames[1]?.tasks.pending).toBe(2);
    expect(r.frames[2]?.tasks).toMatchObject({ pending: 1, running: 1 });
  });
});
