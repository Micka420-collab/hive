// Tests du Waggle Board (palier 4) : classer les nœuds par contribution (nectar)
// en repliant le journal d'événements — module pur.

import { describe, expect, it } from 'vitest';
import { buildWaggleBoard, computeScore } from '../src/orchestrator/waggle.js';
import type { HiveEvent } from '../src/shared/types.js';

function journal(...specs: Array<[string, Record<string, unknown>?]>): HiveEvent[] {
  return specs.map(([type, payload], i) => ({
    id: i + 1,
    ts: 1_000 + i,
    type,
    payload: payload ?? {},
  }));
}

describe('computeScore', () => {
  it('récompense les réussites, pondérées par la fiabilité', () => {
    expect(computeScore(0, 1)).toBe(0);
    // fiabilité parfaite : 10 points/tâche.
    expect(computeScore(3, 1)).toBe(30);
    // fiabilité 50 % : 3 × 10 × (0.5 + 0.25) = 22.5 → 23 (arrondi).
    expect(computeScore(3, 0.5)).toBe(23);
    // jamais négatif, plancher à la moitié.
    expect(computeScore(2, 0)).toBe(10);
  });

  it('est monotone : plus de fiabilité ⇒ score ≥', () => {
    expect(computeScore(5, 1)).toBeGreaterThanOrEqual(computeScore(5, 0.5));
    expect(computeScore(5, 0.5)).toBeGreaterThanOrEqual(computeScore(5, 0));
  });

  it('ajoute un bonus plat de 5 par victoire de course', () => {
    expect(computeScore(3, 1, 0)).toBe(30);
    expect(computeScore(3, 1, 1)).toBe(35);
    expect(computeScore(3, 1, 2)).toBe(40);
    // Le bonus ne dépend pas de la fiabilité (plat, jamais négatif).
    expect(computeScore(2, 0, 1)).toBe(15);
  });
});

describe('buildWaggleBoard', () => {
  it('agrège réussites, échecs, durées et identité par nœud', () => {
    const board = buildWaggleBoard(
      journal(
        ['node_registered', { nodeId: 'n1', name: 'Alice', agentType: 'claude-code' }],
        ['task_done', { nodeId: 'n1', durationMs: 2000 }],
        ['task_done', { nodeId: 'n1', durationMs: 4000 }],
        ['task_failed', { nodeId: 'n1', attempts: 3 }],
      ),
    );
    const n1 = board.nodes.find((n) => n.nodeId === 'n1');
    expect(n1).toMatchObject({
      name: 'Alice',
      agentType: 'claude-code',
      tasksDone: 2,
      tasksFailed: 1,
      totalDurationMs: 6000,
      avgDurationMs: 3000,
    });
    expect(n1?.successRate).toBeCloseTo(2 / 3, 5);
    expect(board.totalTasksDone).toBe(2);
    expect(board.totalTasksFailed).toBe(1);
  });

  it('classe par score décroissant et désigne le meilleur contributeur', () => {
    const board = buildWaggleBoard(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Alice', agentType: 'claude-code' }],
        ['node_online', { nodeId: 'n2', name: 'Bob', agentType: 'codex' }],
        // Alice : 1 réussite. Bob : 3 réussites, aucun échec → meilleur nectar.
        ['task_done', { nodeId: 'n1', durationMs: 1000 }],
        ['task_done', { nodeId: 'n2', durationMs: 1000 }],
        ['task_done', { nodeId: 'n2', durationMs: 1000 }],
        ['task_done', { nodeId: 'n2', durationMs: 1000 }],
      ),
    );
    expect(board.nodes[0]?.nodeId).toBe('n2');
    expect(board.topNodeId).toBe('n2');
    expect(board.nodes[0]?.score).toBeGreaterThan(board.nodes[1]?.score ?? 0);
  });

  it('ignore les échecs non imputables à un nœud (dependency_failed sans nodeId)', () => {
    const board = buildWaggleBoard(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Alice', agentType: 'shell' }],
        ['task_done', { nodeId: 'n1', durationMs: 500 }],
        ['task_failed', { reason: 'dependency_failed' }], // pas de nodeId
      ),
    );
    const n1 = board.nodes.find((n) => n.nodeId === 'n1');
    expect(n1?.tasksFailed).toBe(0);
    expect(n1?.successRate).toBe(1);
    expect(board.totalTasksFailed).toBe(0);
  });

  it('crédite les victoires de course (drone_won) en bonus du task_done', () => {
    const board = buildWaggleBoard(
      journal(
        ['node_online', { nodeId: 'n1', name: 'Alice', agentType: 'claude-code' }],
        ['node_online', { nodeId: 'n2', name: 'Bob', agentType: 'codex' }],
        // Course : Alice gagne (task_done + drone_won), Bob perd (drone_failed).
        ['task_done', { nodeId: 'n1', durationMs: 800 }],
        ['drone_won', { nodeId: 'n1', taskId: 't1', cancelled: 1 }],
        ['drone_failed', { nodeId: 'n2', taskId: 't1' }],
        ['drone_cancelled', { nodeId: 'n2', taskId: 't1' }],
      ),
    );
    const alice = board.nodes.find((n) => n.nodeId === 'n1');
    const bob = board.nodes.find((n) => n.nodeId === 'n2');
    // Alice : 1 tâche (10) + 1 victoire (5) = 15.
    expect(alice?.raceWins).toBe(1);
    expect(alice?.score).toBe(15);
    // Bob : perdre ou être annulé ne pénalise NI les échecs NI la fiabilité.
    expect(bob?.tasksFailed).toBe(0);
    expect(bob?.successRate).toBe(1);
    expect(bob?.raceWins).toBe(0);
  });

  it('journal vide → tableau vide, pas de meilleur nœud', () => {
    const board = buildWaggleBoard([]);
    expect(board.nodes).toEqual([]);
    expect(board.topNodeId).toBeNull();
    expect(board.totalTasksDone).toBe(0);
  });

  it('crée l’entrée d’un nœud jamais « enregistré » mais qui a produit un résultat', () => {
    // Robustesse : le journal a pu être tronqué (prune) avant le node_online.
    const board = buildWaggleBoard(journal(['task_done', { nodeId: 'nX', durationMs: 100 }]));
    const nX = board.nodes.find((n) => n.nodeId === 'nX');
    expect(nX?.tasksDone).toBe(1);
    expect(nX?.name).toBe('nX'); // repli sur l'id faute de nom connu
    expect(nX?.agentType).toBe('inconnu');
  });
});
