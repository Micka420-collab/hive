// Tests du Honeycomb Merge v0 (Palier 3) : parsing de diffs unifiés, détection
// de conflits de lignes, plan de merge (ordre topologique + intégrabilité), et
// endpoint REST bout-en-bout (deux tâches aux diffs conflictuels).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildMergePlan,
  conflictingFiles,
  parseDiff,
  type MergePlan,
} from '../src/orchestrator/honeycomb.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-honeycomb-assez-long';

const diffOn = (file: string, start: number, count: number): string =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${start},${count} +${start},${count + 1} @@\n context\n+ajout\n`;

const task = (id: string, status: Task['status'], dependsOn: string[] = []): Task => ({
  id,
  projectId: 'p',
  title: id,
  prompt: 'p',
  status,
  dependsOn,
  assignedNodeId: null,
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 1,
  updatedAt: 1,
});

describe('parseDiff', () => {
  it('extrait fichiers et plages de lignes de base', () => {
    const d = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -10,6 +10,7 @@\n ctx\n-a\n+b\n@@ -30,2 +31,3 @@\n c\n`;
    const p = parseDiff(d);
    expect([...p.keys()]).toEqual(['x.ts']);
    expect(p.get('x.ts')).toEqual([
      { start: 10, end: 15 },
      { start: 30, end: 31 },
    ]);
  });

  it('gère un nouveau fichier (/dev/null) et un hunk sans compteur', () => {
    const d = `--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,3 @@\n+x\n@@ -5 +8 @@\n y\n`;
    const p = parseDiff(d);
    expect(p.has('new.ts')).toBe(true);
    // hunk « @@ -5 +8 @@ » : compteur omis → 1 ligne.
    expect(p.get('new.ts')).toEqual([
      { start: 0, end: 0 },
      { start: 5, end: 5 },
    ]);
  });
});

describe('conflictingFiles', () => {
  it('détecte le chevauchement de lignes sur un même fichier', () => {
    expect(conflictingFiles(diffOn('src/app.ts', 10, 6), diffOn('src/app.ts', 12, 9))).toEqual([
      'src/app.ts',
    ]);
  });
  it('ignore des plages disjointes du même fichier', () => {
    expect(conflictingFiles(diffOn('src/app.ts', 10, 3), diffOn('src/app.ts', 40, 3))).toEqual([]);
  });
  it('ignore des fichiers différents', () => {
    expect(conflictingFiles(diffOn('a.ts', 1, 5), diffOn('b.ts', 1, 5))).toEqual([]);
  });
});

describe('buildMergePlan', () => {
  it('ordonne par dépendances et détecte un conflit entre tâches terminées', () => {
    const tasks = [task('a', 'done'), task('b', 'done', ['a'])];
    const diffs = new Map([
      ['a', diffOn('src/app.ts', 10, 6)],
      ['b', diffOn('src/app.ts', 12, 9)],
    ]);
    const plan = buildMergePlan(tasks, diffs);
    expect(plan.order).toEqual(['a', 'b']); // dépendance d'abord
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.file).toBe('src/app.ts');
    expect(plan.mergeable).toBe(false); // conflit
    expect(plan.testsRun).toBe(false);
  });

  it('est intégrable quand tout est terminé et sans conflit', () => {
    const tasks = [task('a', 'done'), task('b', 'done')];
    const diffs = new Map([
      ['a', diffOn('src/a.ts', 1, 3)],
      ['b', diffOn('src/b.ts', 1, 3)],
    ]);
    const plan = buildMergePlan(tasks, diffs);
    expect(plan.conflicts).toEqual([]);
    expect(plan.mergeable).toBe(true);
  });

  it('n’est pas intégrable si des tâches ne sont pas terminées', () => {
    const plan = buildMergePlan([task('a', 'done'), task('b', 'running')], new Map());
    expect(plan.done).toBe(1);
    expect(plan.total).toBe(2);
    expect(plan.mergeable).toBe(false);
  });
});

describe('GET /api/projects/:id/merge (intégration)', () => {
  let server: HiveServer;
  let dir: string;
  let client: HiveNodeClient;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-hc-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 80,
    });
    // Adaptateur qui renvoie un diff conflictuel selon la tâche.
    const adapter: AgentAdapter = {
      name: 'diff',
      async run(t) {
        const diff = t.id === 'hb' ? diffOn('src/app.ts', 12, 9) : diffOn('src/app.ts', 10, 6);
        return { success: true, diff, logs: 'ok', subAgents: [] };
      },
    };
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'ouvriere-hc',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 2,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    client.start();
  });

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  it('remonte le plan de merge avec les conflits réels (et exige le token)', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Merge' }),
      })
    ).json()) as { id: string };
    await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tasks: [
          { id: 'ha', title: 'A', prompt: 'p' },
          { id: 'hb', title: 'B', prompt: 'p' },
        ],
      }),
    });

    // Attendre que les deux tâches soient terminées.
    const deadline = Date.now() + 8_000;
    let plan: MergePlan | undefined;
    while (Date.now() < deadline) {
      plan = (await (
        await fetch(`${base}/api/projects/${project.id}/merge`, { headers })
      ).json()) as MergePlan;
      if (plan.done === 2) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(plan?.done).toBe(2);
    expect(plan?.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(plan?.conflicts[0]?.file).toBe('src/app.ts');
    expect(plan?.mergeable).toBe(false);

    const noAuth = await fetch(`${base}/api/projects/${project.id}/merge`, {
      headers: { 'content-type': 'application/json' },
    });
    expect(noAuth.status).toBe(401);
  });
});
