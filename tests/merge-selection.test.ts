// Merge sélectif (revue → miel) : POST /merge/run avec `taskIds` n'intègre que
// la sélection approuvée. On vérifie ici la VALIDATION serveur (tâche hors
// projet, non terminée, sélection valide) sans nœud réel — le 503 « aucun nœud
// en ligne » prouve que la sélection a passé toutes les gardes.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-selection-suffisamment-long';

describe('POST /merge/run — sélection de tâches (taskIds)', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let doneTask: Task;
  let pendingTask: Task;
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-sel-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000, // pas d'assignation pendant le test
    });
    base = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Sélection', repoUrl: 'https://example.com/depot.git' }),
    });
    const project = (await res.json()) as { id: string };
    const created = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tasks: [
          { title: 'approuvée', prompt: 'faire' },
          { title: 'pas encore finie', prompt: 'faire aussi' },
        ],
      }),
    });
    const tasks = (await created.json()) as Task[];
    doneTask = tasks[0]!;
    pendingTask = tasks[1]!;
    // La 1re tâche est « terminée avec diff » directement dans le store —
    // aucun nœud réel n'est nécessaire pour tester la validation.
    server.store.patchTask(doneTask.id, { status: 'done' });
    server.store.insertResult({
      taskId: doneTask.id,
      nodeId: 'noeud-fictif',
      success: true,
      diff: 'diff --git a/f.txt b/f.txt\n+contenu\n',
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (taskIds: string[]) =>
    fetch(`${base}/api/projects/${doneTask.projectId}/merge/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ taskIds }),
    });

  it('refuse une tâche qui n appartient pas au projet', async () => {
    const res = await run(['tache-fantome']);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('hors projet');
  });

  it('refuse une tâche non terminée', async () => {
    const res = await run([pendingTask.id]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('non terminée');
  });

  it('accepte une sélection valide (503 = plus aucun garde-fou avant le nœud)', async () => {
    const res = await run([doneTask.id]);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('aucun nœud');
  });
});
