// Test bout-en-bout du câblage Honeycomb Merge (Palier 3) : POST /merge/run →
// le hub envoie assign_merge à un nœud → le nœud clone le dépôt, applique les
// diffs, renvoie merge_result → lisible sur /merge/result.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { MergeResultMsg } from '../src/shared/protocol.js';
import type { StateSnapshot } from '../src/shared/types.js';

const TOKEN = 'jeton-merge-wiring-long';
const FILE = 'sample.txt';
const BASE = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);

function withLine(line: number, value: string): string {
  const lines = [...BASE];
  lines[line - 1] = value;
  return lines.join('\n') + '\n';
}

describe('câblage merge (hub↔nœud)', () => {
  let dir: string;
  let originDir: string;
  let git: SimpleGit;
  let server: HiveServer;
  let client: HiveNodeClient;
  let patchA: string;
  let patchB: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-mw-'));
    originDir = path.join(dir, 'origin');
    await simpleGit().raw(['init', originDir]);
    git = simpleGit({ baseDir: originDir });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    await git.addConfig('core.autocrlf', 'false');
    writeFileSync(path.join(originDir, FILE), BASE.join('\n') + '\n');
    await git.add(FILE);
    await git.commit('base');

    const patchFor = async (value: string, line: number): Promise<string> => {
      writeFileSync(path.join(originDir, FILE), withLine(line, value));
      const d = await git.diff();
      await git.raw(['checkout', '--', '.']);
      return d;
    };
    patchA = await patchFor('l2-A', 2);
    patchB = await patchFor('l10-B', 10);

    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 80,
    });
    const adapter: AgentAdapter = {
      name: 'noop',
      async run() {
        return { success: true, diff: '', logs: 'ok', subAgents: [] };
      },
    };
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'ouvriere-merge',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    client.start();
  });

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  async function waitNodeOnline(base: string): Promise<void> {
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const s = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      if (s.nodes.some((n) => n.status === 'online')) return;
      await new Promise((r) => setTimeout(r, 80));
    }
    throw new Error('nœud non enregistré à temps');
  }

  it('exécute un merge réel de bout en bout', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    await waitNodeOnline(base);

    // État préparé directement : projet avec dépôt + 2 tâches terminées et leurs diffs.
    const project = server.store.createProject({ name: 'Intégration', repoUrl: originDir });
    for (const [id, diff] of [
      ['wa', patchA],
      ['wb', patchB],
    ] as const) {
      server.store.createTask({ id, projectId: project.id, title: id, prompt: 'p' });
      server.store.patchTask(id, { status: 'done' });
      server.store.insertResult({
        taskId: id,
        nodeId: 'seed',
        success: true,
        diff,
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
    }

    // Déclenchement.
    const runRes = await fetch(`${base}/api/projects/${project.id}/merge/run`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(runRes.status).toBe(202);
    const { order } = (await runRes.json()) as { mergeId: string; order: string[] };
    expect(order).toEqual(['wa', 'wb']);

    // Résultat (asynchrone).
    const deadline = Date.now() + 15_000;
    let result: MergeResultMsg | null = null;
    while (Date.now() < deadline) {
      const body = (await (
        await fetch(`${base}/api/projects/${project.id}/merge/result`, { headers })
      ).json()) as { result: MergeResultMsg | null };
      if (body.result) {
        result = body.result;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(result).not.toBeNull();
    expect(result?.applied).toEqual(['wa', 'wb']);
    expect(result?.conflicts).toEqual([]);
    expect(result?.mergedDiff).toContain('l2-A');
    expect(result?.mergedDiff).toContain('l10-B');
  });

  it('refuse un projet sans dépôt et exige le token', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const noRepo = server.store.createProject({ name: 'sans-depot' });
    const res = await fetch(`${base}/api/projects/${noRepo.id}/merge/run`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    expect(res.status).toBe(400);

    const noAuth = await fetch(`${base}/api/projects/${noRepo.id}/merge/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(noAuth.status).toBe(401);
  });
});
