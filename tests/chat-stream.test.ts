// Parseur SSE Anthropic + flux Concierge (deltas → done).

import { describe, expect, it } from 'vitest';
import {
  askConciergeStream,
  buildChatPrompt,
  sousAgentsDepuisEvenements,
} from '../src/orchestrator/concierge.js';
import type { ConciergeContext } from '../src/orchestrator/concierge.js';
import { parserTrameAnthropic } from '../src/orchestrator/planner.js';
import type { HivePulse } from '../src/orchestrator/pulse.js';
import type { ProjectReport } from '../src/orchestrator/project-report.js';

function makePulse(): HivePulse {
  return {
    totalDone: 1,
    totalFailed: 0,
    successRate: 1,
    activeNodes: 1,
    latency: { p50: 1, p95: 1, max: 1, avg: 1, count: 1 },
    throughput: [],
    spanMs: 1,
  };
}

function makeCtx(over: Partial<ConciergeContext> = {}): ConciergeContext {
  return {
    projects: [
      {
        id: 'p1',
        name: 'SaaS',
        repoUrl: null,
        description: null,
        visibility: 'private',
        ownerId: null,
        createdAt: 1,
      },
    ],
    nodes: [
      {
        id: 'n1',
        name: 'alpha',
        ownerName: 'M',
        agentType: 'claude-code',
        maxConcurrency: 1,
        running: 1,
        status: 'online',
        lastSeen: 1,
      },
    ],
    reports: [
      {
        projectId: 'p1',
        name: 'SaaS',
        total: 2,
        byStatus: { pending: 0, ready: 0, assigned: 0, running: 1, done: 1, failed: 0 },
        done: 1,
        failed: 0,
        progressPct: 50,
        complete: false,
        contributingNodes: ['n1'],
        totalAttempts: 1,
      } satisfies ProjectReport,
    ],
    pulse: makePulse(),
    waggle: {
      nodes: [],
      totalTasksDone: 0,
      totalTasksFailed: 0,
      topNodeId: null,
    },
    ghosts: [],
    memories: [],
    races: [],
    recentEvents: [],
    reviews: {},
    finishedTasks: [],
    enCours: [
      {
        taskId: 't1',
        title: 'Landing',
        status: 'running',
        nodeId: 'n1',
        nodeName: 'alpha',
      },
    ],
    sousAgents: [
      {
        taskId: 't1',
        nodeId: 'n1',
        agents: [{ name: 'Explore', status: 'running' }],
      },
    ],
    essaim: {
      niveau: 'propose',
      pas: 'attendre',
      motif: 'calme',
      enPause: false,
      derive: 'saine',
    },
    ...over,
  };
}

describe('parserTrameAnthropic', () => {
  it('extrait un delta texte', () => {
    const c = parserTrameAnthropic(
      JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Bonjour' },
      }),
    );
    expect(c).toEqual({ kind: 'text', text: 'Bonjour' });
  });

  it('extrait l’usage message_delta', () => {
    const c = parserTrameAnthropic(
      JSON.stringify({
        type: 'message_delta',
        usage: { input_tokens: 3, output_tokens: 7 },
      }),
    );
    expect(c).toEqual({ kind: 'usage', usage: { inputTokens: 3, outputTokens: 7 } });
  });

  it('ignore [DONE] et le JSON invalide', () => {
    expect(parserTrameAnthropic('[DONE]')).toBeNull();
    expect(parserTrameAnthropic('{')).toBeNull();
  });

  it('ignore un text_delta vide et les autres types de delta', () => {
    expect(
      parserTrameAnthropic(
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '' },
        }),
      ),
    ).toBeNull();
    expect(
      parserTrameAnthropic(
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{' },
        }),
      ),
    ).toBeNull();
  });

  it('lit l’usage porté par message_start', () => {
    const c = parserTrameAnthropic(
      JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 11, output_tokens: 0 } },
      }),
    );
    expect(c).toEqual({ kind: 'usage', usage: { inputTokens: 11, outputTokens: 0 } });
  });
});

describe('sousAgentsDepuisEvenements', () => {
  it('garde le dernier progrès par tâche', () => {
    const s = sousAgentsDepuisEvenements([
      {
        id: 1,
        ts: 1,
        type: 'task_progress',
        payload: {
          taskId: 't1',
          nodeId: 'n1',
          subAgents: [{ name: 'A', status: 'running' }],
        },
      },
      {
        id: 2,
        ts: 2,
        type: 'task_progress',
        payload: {
          taskId: 't1',
          nodeId: 'n1',
          subAgents: [{ name: 'A', status: 'done' }],
        },
      },
      { id: 3, ts: 3, type: 'task_done', payload: {} },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]?.agents[0]?.status).toBe('done');
  });
});

describe('buildChatPrompt — multi-agents lecture seule', () => {
  it('injecte travailEnCours, sousAgents et essaim', () => {
    const { system } = buildChatPrompt('qui travaille ?', makeCtx());
    expect(system).toContain('Landing');
    expect(system).toContain('Explore');
    expect(system).toContain('propose');
    expect(system).toMatch(/ne réécris JAMAIS le dépôt git/i);
  });
});

describe('askConciergeStream', () => {
  it('sans LLM : un seul done live', async () => {
    const evs = [];
    for await (const e of askConciergeStream('où en est le projet ?', makeCtx())) {
      evs.push(e);
    }
    expect(evs).toHaveLength(1);
    expect(evs[0]?.type).toBe('done');
    if (evs[0]?.type === 'done') {
      expect(evs[0].answer.source).toBe('live');
      expect(evs[0].answer.reply.length).toBeGreaterThan(0);
    }
  });

  it('avec llmStream : deltas puis done llm', async () => {
    async function* stream() {
      yield { kind: 'text' as const, text: 'Hel' };
      yield { kind: 'text' as const, text: 'lo' };
      yield {
        kind: 'usage' as const,
        usage: { inputTokens: 1, outputTokens: 2 },
      };
    }
    const evs = [];
    for await (const e of askConciergeStream('hi', makeCtx(), { llmStream: stream })) {
      evs.push(e);
    }
    expect(evs.filter((e) => e.type === 'delta')).toHaveLength(2);
    const done = evs.find((e) => e.type === 'done');
    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.answer.reply).toBe('Hello');
      expect(done.answer.source).toBe('llm');
      expect(done.answer.usage?.totalTokens).toBe(3);
    }
  });

  it('échec stream → done live', async () => {
    async function* boom(): AsyncGenerator<never> {
      throw new Error('réseau');
      yield undefined as never;
    }
    const evs = [];
    for await (const e of askConciergeStream('hi', makeCtx(), { llmStream: boom })) {
      evs.push(e);
    }
    expect(evs).toHaveLength(1);
    if (evs[0]?.type === 'done') expect(evs[0].answer.source).toBe('live');
  });
});
