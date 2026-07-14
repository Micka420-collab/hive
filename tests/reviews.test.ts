// Tests de la revue humaine partagée (Miellerie côté serveur) :
// store (upsert/effacement) + endpoints POST /api/tasks/:id/review et
// GET /api/reviews (validation, 404, token, événement task_reviewed).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { HiveEvent, Task } from '../src/shared/types.js';

const TOKEN = 'jeton-revue-suffisamment-long';

describe('store : revues humaines', () => {
  it('upsert, remplacement et effacement', () => {
    const store = new HiveStore(':memory:');
    store.setTaskReview('t1', 'approved');
    store.setTaskReview('t2', 'rejected');
    expect(store.listReviews()).toEqual({ t1: 'approved', t2: 'rejected' });
    store.setTaskReview('t1', 'rejected'); // remplacement
    expect(store.listReviews().t1).toBe('rejected');
    store.setTaskReview('t2', null); // effacement
    expect(store.listReviews()).toEqual({ t1: 'rejected' });
    store.close();
  });
});

describe('POST /api/tasks/:id/review + GET /api/reviews', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let task: Task;
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-review-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 1_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Projet Revue' }),
    });
    const project = (await res.json()) as { id: string };
    const created = await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: [{ title: 'à revoir', prompt: 'faire' }] }),
    });
    task = ((await created.json()) as Task[])[0]!;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('enregistre un verdict, le liste, puis l efface (null)', async () => {
    const post = await fetch(`${base}/api/tasks/${task.id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'approved' }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ taskId: task.id, state: 'approved' });

    const list = await fetch(`${base}/api/reviews`, { headers });
    expect(((await list.json()) as { reviews: Record<string, string> }).reviews[task.id]).toBe(
      'approved',
    );

    await fetch(`${base}/api/tasks/${task.id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: null }),
    });
    const after = await fetch(`${base}/api/reviews`, { headers });
    expect(
      ((await after.json()) as { reviews: Record<string, string> }).reviews[task.id],
    ).toBeUndefined();
  });

  it('journalise un événement task_reviewed (synchro multi-opérateurs)', async () => {
    await fetch(`${base}/api/tasks/${task.id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'rejected' }),
    });
    const res = await fetch(`${base}/api/events?limit=1000`, { headers });
    const events = (await res.json()) as HiveEvent[];
    const reviewed = events.filter((e) => e.type === 'task_reviewed');
    expect(reviewed.length).toBeGreaterThan(0);
    expect(reviewed[reviewed.length - 1]!.payload).toMatchObject({
      taskId: task.id,
      state: 'rejected',
    });
  });

  it('refuse un verdict inconnu, une tâche inconnue et l absence de token', async () => {
    const bad = await fetch(`${base}/api/tasks/${task.id}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'peut-etre' }),
    });
    expect(bad.status).toBe(400);

    const ghost = await fetch(`${base}/api/tasks/tache-inconnue/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'approved' }),
    });
    expect(ghost.status).toBe(404);

    const noToken = await fetch(`${base}/api/tasks/${task.id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'approved' }),
    });
    expect(noToken.status).toBe(401);
  });
});
