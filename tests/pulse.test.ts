// Tests de Hive Pulse (innovation) : signes vitaux agrégés du journal — module pur.

import { describe, expect, it } from 'vitest';
import { computePulse, percentile } from '../src/orchestrator/pulse.js';
import type { HiveEvent } from '../src/shared/types.js';

const HOUR = 3_600_000;

/** Journal avec timestamps explicites (ids croissants). */
function journal(...specs: Array<[number, string, Record<string, unknown>?]>): HiveEvent[] {
  return specs.map(([ts, type, payload], i) => ({ id: i + 1, ts, type, payload: payload ?? {} }));
}

describe('percentile (nearest-rank)', () => {
  it('cas de base', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([10], 0.5)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });

  it('borne p hors [0,1]', () => {
    expect(percentile([5, 6, 7], -1)).toBe(5);
    expect(percentile([5, 6, 7], 2)).toBe(7);
  });
});

describe('computePulse', () => {
  it('agrège totaux, taux de succès et latences', () => {
    const p = computePulse(
      journal(
        [1000, 'node_online', { nodeId: 'n1' }],
        [1100, 'task_done', { nodeId: 'n1', durationMs: 1000 }],
        [1200, 'task_done', { nodeId: 'n1', durationMs: 3000 }],
        [1300, 'task_done', { nodeId: 'n1', durationMs: 2000 }],
        [1400, 'task_failed', { nodeId: 'n1' }],
      ),
    );
    expect(p.totalDone).toBe(3);
    expect(p.totalFailed).toBe(1);
    expect(p.successRate).toBe(0.75);
    expect(p.latency.count).toBe(3);
    expect(p.latency.p50).toBe(2000); // médiane de [1000,2000,3000]
    expect(p.latency.max).toBe(3000);
    expect(p.latency.avg).toBe(2000);
  });

  it('regroupe le débit par tranche horaire, triées', () => {
    const p = computePulse(
      journal(
        [0, 'task_done', { durationMs: 10 }],
        [HOUR + 5, 'task_done', { durationMs: 10 }],
        [HOUR + 6, 'task_failed', {}],
        [2 * HOUR + 1, 'task_done', { durationMs: 10 }],
      ),
    );
    expect(p.throughput).toHaveLength(3);
    expect(p.throughput[0]).toEqual({ hourStart: 0, done: 1, failed: 0 });
    expect(p.throughput[1]).toEqual({ hourStart: HOUR, done: 1, failed: 1 });
    expect(p.throughput[2]).toEqual({ hourStart: 2 * HOUR, done: 1, failed: 0 });
    expect(p.spanMs).toBe(2 * HOUR + 1);
  });

  it('compte les nœuds actifs (online sans offline ultérieur)', () => {
    const p = computePulse(
      journal(
        [1, 'node_online', { nodeId: 'n1' }],
        [2, 'node_online', { nodeId: 'n2' }],
        [3, 'node_offline', { nodeId: 'n1' }],
        [4, 'node_online', { nodeId: 'n1' }], // n1 revient
      ),
    );
    expect(p.activeNodes).toBe(2);
  });

  it('journal vide → pouls neutre (succès 100%, aucune latence)', () => {
    const p = computePulse([]);
    expect(p).toMatchObject({
      totalDone: 0,
      totalFailed: 0,
      successRate: 1,
      activeNodes: 0,
      spanMs: 0,
    });
    expect(p.latency).toEqual({ count: 0, p50: 0, p95: 0, avg: 0, max: 0 });
    expect(p.throughput).toEqual([]);
  });
});
