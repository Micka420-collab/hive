// Fragments Intelligence Core : présence, cohérence, consommation par concierge / queen-bee.

import { describe, expect, it } from 'vitest';
import {
  CONCIERGE_INTELLIGENCE_CORE,
  QUEEN_BEE_INTELLIGENCE_CORE,
  QUEEN_BEE_SYSTEM_PROMPT,
  QUEEN_INTELLIGENCE_CORE_DOC,
} from '../src/orchestrator/queen-intelligence-core.js';
import { buildChatPrompt } from '../src/orchestrator/concierge.js';
import type { ConciergeContext } from '../src/orchestrator/concierge.js';

describe('queen-intelligence-core', () => {
  it('expose le chemin doc canonique', () => {
    expect(QUEEN_INTELLIGENCE_CORE_DOC).toBe('docs/QUEEN-INTELLIGENCE-CORE.md');
  });

  it('fragments contiennent les piliers stratégiques', () => {
    expect(CONCIERGE_INTELLIGENCE_CORE).toMatch(/INTELLIGENCE CORE/);
    expect(CONCIERGE_INTELLIGENCE_CORE).toMatch(/A autonome/);
    expect(QUEEN_BEE_INTELLIGENCE_CORE).toMatch(/Ne réinvente pas/);
    expect(QUEEN_BEE_SYSTEM_PROMPT).toContain(QUEEN_BEE_INTELLIGENCE_CORE);
    expect(QUEEN_BEE_SYSTEM_PROMPT).toMatch(/FORMAT DE RÉPONSE/);
  });

  it('buildChatPrompt injecte CONCIERGE_INTELLIGENCE_CORE', () => {
    const ctx: ConciergeContext = {
      projects: [],
      nodes: [],
      reports: [],
      pulse: {
        totalDone: 0,
        totalFailed: 0,
        successRate: 1,
        activeNodes: 0,
        latency: { p50: 0, p95: 0, max: 0, avg: 0, count: 0 },
        throughput: [],
        spanMs: 0,
      },
      waggle: { nodes: [], totalTasksDone: 0, totalTasksFailed: 0, topNodeId: null },
      ghosts: [],
      memories: [],
      recentEvents: [],
      reviews: {},
      finishedTasks: [],
      races: [],
    };
    const { system } = buildChatPrompt('Comment cadrer mon projet ?', ctx);
    expect(system).toContain('INTELLIGENCE CORE');
    expect(system).toMatch(/contexte JSON/);
  });
});
