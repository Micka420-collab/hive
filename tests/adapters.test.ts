// Tests des garde-fous des adaptateurs : l'exécution réelle est refusée tant
// que le token est trivial (contrainte §5.1 — anti-RCE), et la simulation
// respecte le contrat AgentAdapter (progrès, flaky, annulation).

import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { createShellAdapter } from '../src/adapters/shell.js';
import type { AdapterContext } from '../src/adapters/index.js';
import type { Task } from '../src/shared/types.js';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'task-1',
  projectId: 'p1',
  title: 'Tâche test',
  prompt: 'faire quelque chose',
  status: 'assigned',
  dependsOn: [],
  assignedNodeId: 'n1',
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const ctx = (over: Partial<AdapterContext> = {}): AdapterContext => ({
  cwd: process.cwd(),
  env: {},
  attempt: 1,
  signal: new AbortController().signal,
  onProgress: () => undefined,
  ...over,
});

describe('garde-fous anti-RCE des adaptateurs', () => {
  it('refuse HIVE_REAL_SHELL=1 avec le token par défaut', () => {
    expect(() => createShellAdapter({ realShell: true, token: 'change-me' })).toThrow(/trivial/);
  });

  it('refuse HIVE_REAL_SHELL=1 avec un token trop court', () => {
    expect(() => createShellAdapter({ realShell: true, token: 'abc' })).toThrow(/trivial/);
  });

  it('accepte le mode réel avec un token non-trivial', () => {
    const adapter = createShellAdapter({ realShell: true, token: 'un-vrai-token-de-ruche' });
    expect(adapter.name).toBe('shell');
  });

  it('les adaptateurs claude-code et codex exigent aussi un token non-trivial', () => {
    expect(() => createClaudeCodeAdapter('change-me')).toThrow(/trivial/);
    expect(() => createCodexAdapter('change-me')).toThrow(/trivial/);
    expect(createClaudeCodeAdapter('un-vrai-token-de-ruche').name).toBe('claude-code');
  });
});

describe('adaptateur shell simulé', () => {
  it('termine avec un diff factice et des sous-agents done', async () => {
    const progressed: number[] = [];
    const adapter = createShellAdapter({ realShell: false });
    const result = await adapter.run(
      task(),
      ctx({ onProgress: (p) => progressed.push(p.subAgents?.length ?? 0) }),
    );
    expect(result.success).toBe(true);
    expect(result.diff).toContain('+++');
    expect(result.subAgents.length).toBeGreaterThan(0);
    expect(result.subAgents.every((sa) => sa.status === 'done')).toBe(true);
    expect(progressed.length).toBeGreaterThan(0);
  });

  it('échoue à la première tentative avec le marqueur [flaky], réussit ensuite', async () => {
    const adapter = createShellAdapter({ realShell: false });
    const flaky = task({ prompt: '[flaky] instable' });
    const first = await adapter.run(flaky, ctx({ attempt: 1 }));
    expect(first.success).toBe(false);
    const second = await adapter.run(flaky, ctx({ attempt: 2 }));
    expect(second.success).toBe(true);
  });

  it("s'interrompt proprement quand la tâche est annulée", async () => {
    const controller = new AbortController();
    const adapter = createShellAdapter({ realShell: false });
    const run = adapter.run(task(), ctx({ signal: controller.signal }));
    controller.abort();
    await expect(run).rejects.toThrow(/annulée/);
  });
});
