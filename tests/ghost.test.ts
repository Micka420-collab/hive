// Tests de Ghost in the Hive (palier 4) : détection d'anomalies par repli du
// journal — module pur. Un environnement sain ne doit produire AUCUN faux positif.

import { describe, expect, it } from 'vitest';
import { detectGhosts } from '../src/orchestrator/ghost.js';
import type { Ghost, GhostKind } from '../src/orchestrator/ghost.js';
import type { HiveEvent } from '../src/shared/types.js';

function journal(...specs: Array<[string, Record<string, unknown>?]>): HiveEvent[] {
  return specs.map(([type, payload], i) => ({
    id: i + 1,
    ts: 1_000 + i,
    type,
    payload: payload ?? {},
  }));
}

const kinds = (ghosts: Ghost[]): GhostKind[] => ghosts.map((g) => g.kind);
const of = (ghosts: Ghost[], kind: GhostKind): Ghost | undefined =>
  ghosts.find((g) => g.kind === kind);

describe('detectGhosts', () => {
  it('ne signale rien sur une ruche saine', () => {
    const report = detectGhosts(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Alice' }],
        ['task_done', { nodeId: 'n1', durationMs: 100 }],
        ['task_done', { nodeId: 'n1', durationMs: 100 }],
        ['task_done', { nodeId: 'n1', durationMs: 100 }],
      ),
    );
    expect(report.ghosts).toEqual([]);
    expect(report.scanned).toMatchObject({ nodes: 1 });
  });

  it('flaky_node : taux d’échec élevé au-delà du seuil de tentatives', () => {
    // 1 réussite / 3 échecs → 75 % d'échec sur 4 tentatives → high.
    const report = detectGhosts(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Bob' }],
        ['task_done', { nodeId: 'n1' }],
        ['task_failed', { nodeId: 'n1', taskId: 't1', attempts: 3 }],
        ['task_failed', { nodeId: 'n1', taskId: 't2', attempts: 3 }],
        ['task_failed', { nodeId: 'n1', taskId: 't3', attempts: 3 }],
      ),
    );
    const g = of(report.ghosts, 'flaky_node');
    expect(g?.target).toBe('n1');
    expect(g?.severity).toBe('high');
    expect(g?.metrics.failRatePct).toBe(75);
  });

  it('ne crie pas au flaky sous le seuil de tentatives', () => {
    // 1 échec sur 2 tentatives : significatif en taux mais trop peu de tentatives.
    const report = detectGhosts(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Bob' }],
        ['task_done', { nodeId: 'n1' }],
        ['task_failed', { nodeId: 'n1', taskId: 't1' }],
      ),
    );
    expect(kinds(report.ghosts)).not.toContain('flaky_node');
  });

  it('silent_node : rejoint puis reparti sans rien butiner', () => {
    const report = detectGhosts(
      journal(
        ['node_registered', { nodeId: 'n9', name: 'Fantôme' }],
        ['node_offline', { nodeId: 'n9', reason: 'heartbeat_timeout' }],
      ),
    );
    const g = of(report.ghosts, 'silent_node');
    expect(g?.target).toBe('n9');
    expect(g?.severity).toBe('medium'); // timeout → medium
  });

  it('looping_task : échec définitif = high ; reprises répétées = medium', () => {
    const failed = detectGhosts(
      journal(['task_failed', { taskId: 't1', reason: 'no_working_agent', attempts: 3 }]),
    );
    expect(of(failed.ghosts, 'looping_task')?.severity).toBe('high');

    const looping = detectGhosts(
      journal(
        ['task_retry', { taskId: 't2', attempt: 1 }],
        ['task_retry', { taskId: 't2', attempt: 2 }],
      ),
    );
    const g = of(looping.ghosts, 'looping_task');
    expect(g?.severity).toBe('medium');
    expect(g?.metrics.retries).toBe(2);
  });

  it('rejecting_node : refus répétés (non-infra)', () => {
    const report = detectGhosts(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Bob' }],
        ['task_rejected', { nodeId: 'n1', taskId: 'ta', reason: 'saturated' }],
        ['task_rejected', { nodeId: 'n1', taskId: 'tb', reason: 'saturated' }],
        ['task_rejected', { nodeId: 'n1', taskId: 'tc', reason: 'saturated' }],
      ),
    );
    expect(of(report.ghosts, 'rejecting_node')?.metrics.rejected).toBe(3);
  });

  it('infra_node : pannes d’infra (champ infra:true) comptées à part', () => {
    const report = detectGhosts(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Bob' }],
        ['task_rejected', { nodeId: 'n1', taskId: 'ta', reason: 'quota', infra: true }],
      ),
    );
    expect(kinds(report.ghosts)).toContain('infra_node');
    // Un refus infra ne compte PAS comme refus ordinaire.
    expect(of(report.ghosts, 'rejecting_node')).toBeUndefined();
  });

  it('trie par gravité décroissante (high avant medium/low)', () => {
    const report = detectGhosts(
      journal(
        ['node_registered', { nodeId: 'silencieux', name: 'S' }],
        ['node_offline', { nodeId: 'silencieux', reason: 'disconnect' }], // silent low
        ['task_failed', { taskId: 't1', attempts: 3 }], // looping high
      ),
    );
    expect(report.ghosts[0]?.severity).toBe('high');
    expect(report.ghosts.at(-1)?.severity).toBe('low');
  });

  it('journal vide → rapport vide', () => {
    const report = detectGhosts([]);
    expect(report.ghosts).toEqual([]);
    expect(report.scanned).toEqual({ events: 0, nodes: 0, tasks: 0 });
  });
});
