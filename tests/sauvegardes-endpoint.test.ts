// Timeline de sauvegardes — étapes auto à insertResult + API HTTP (compte).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('HiveStore — sauvegardes d’étape', () => {
  it('crée une étape auto quand un résultat réussi porte un diff', () => {
    const store = new HiveStore(':memory:');
    const p = store.createProject({ name: 'Demo' });
    const n = store.registerNode({
      name: 'n1',
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const tache = store.createTask({
      projectId: p.id,
      title: 'Poser le socle',
      prompt: 'socle',
    });
    const id = store.insertResult({
      taskId: tache.id,
      nodeId: n.id,
      success: true,
      diff: 'diff --git a/a b/a\n+ok',
      logs: '',
      durationMs: 12,
      subAgents: [],
    });
    expect(id).toBeGreaterThan(0);
    const liste = store.listSauvegardes(p.id);
    expect(liste).toHaveLength(1);
    expect(liste[0]!.kind).toBe('etape');
    expect(liste[0]!.label).toContain('Poser le socle');
    expect(liste[0]!.taille).toBeGreaterThan(0);
    const full = store.getSauvegarde(liste[0]!.id);
    expect(full?.patch).toContain('+ok');
    store.close();
  });

  it('n’enregistre pas d’étape sur échec ou diff vide', () => {
    const store = new HiveStore(':memory:');
    const p = store.createProject({ name: 'Demo' });
    const n = store.registerNode({
      name: 'n1',
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const tache = store.createTask({ projectId: p.id, title: 'X', prompt: 'x' });
    store.insertResult({
      taskId: tache.id,
      nodeId: n.id,
      success: false,
      diff: 'diff --git a/a b/a\n+nope',
      logs: 'boom',
      durationMs: 1,
      subAgents: [],
    });
    store.insertResult({
      taskId: tache.id,
      nodeId: n.id,
      success: true,
      diff: '   ',
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    expect(store.listSauvegardes(p.id)).toHaveLength(0);
    store.close();
  });

  it('pruneSauvegardes ne garde que les N plus récentes (tous projets)', () => {
    const store = new HiveStore(':memory:');
    const a = store.createProject({ name: 'A' });
    const b = store.createProject({ name: 'B' });
    for (let i = 0; i < 5; i++) {
      store.creerSauvegarde({
        projectId: i % 2 === 0 ? a.id : b.id,
        label: `m${i}`,
        kind: 'manuel',
        patch: `diff --git a/x b/x\n+${i}`,
        createdAt: 1_000 + i,
      });
    }
    expect(store.listSauvegardes(a.id).length + store.listSauvegardes(b.id).length).toBe(5);
    expect(store.pruneSauvegardes(2)).toBe(3);
    expect(store.listSauvegardes(a.id).length + store.listSauvegardes(b.id).length).toBe(2);
    expect(store.pruneSauvegardes(2)).toBe(0);
    store.close();
  });
});

const TOKEN = 'jeton-sauvegardes-suffisamment-long-42';

describe('API /api/projects/:id/sauvegardes', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projectId: string;
  let jwt = '';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-sg-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 1_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'abeille-sg@example.com',
        password: 'motdepasse-assez-long-42',
        displayName: 'Abeille',
      }),
    });
    jwt = ((await reg.json()) as { token?: string }).token ?? '';
    expect(jwt).toBeTruthy();
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${jwt}` } })
    ).json()) as { id: string };
    projectId = server.store.createProject({
      name: 'Projet SG',
      visibility: 'private',
      ownerId: moi.id,
    }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const auth = () => ({ authorization: `Bearer ${jwt}`, 'content-type': 'application/json' });

  it('liste vide au départ, pose une sauvegarde manuelle, restaure via tâche', async () => {
    const vide = await fetch(`${base}/api/projects/${projectId}/sauvegardes`, {
      headers: auth(),
    });
    expect(vide.status).toBe(200);
    expect(((await vide.json()) as { sauvegardes: unknown[] }).sauvegardes).toEqual([]);

    const cree = await fetch(`${base}/api/projects/${projectId}/sauvegardes`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({
        label: 'Avant migration',
        patch: 'diff --git a/x b/x\n+ligne',
      }),
    });
    expect(cree.status).toBe(201);
    const { sauvegarde } = (await cree.json()) as {
      sauvegarde: { id: string; kind: string; label: string };
    };
    expect(sauvegarde.kind).toBe('manuel');
    expect(sauvegarde.label).toBe('Avant migration');

    const resto = await fetch(
      `${base}/api/projects/${projectId}/sauvegardes/${sauvegarde.id}/restaurer`,
      { method: 'POST', headers: auth(), body: '{}' },
    );
    expect(resto.status).toBe(201);
    const { task } = (await resto.json()) as { task: { title: string; prompt: string } };
    expect(task.title).toContain('Restaurer');
    expect(task.prompt).toContain('Avant migration');
    expect(task.prompt).toContain('+ligne');
  });

  it('refuse une restauration sans patch', async () => {
    const cree = await fetch(`${base}/api/projects/${projectId}/sauvegardes`, {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ label: 'Marqueur seul' }),
    });
    const { sauvegarde } = (await cree.json()) as { sauvegarde: { id: string } };
    const resto = await fetch(
      `${base}/api/projects/${projectId}/sauvegardes/${sauvegarde.id}/restaurer`,
      { method: 'POST', headers: auth(), body: '{}' },
    );
    expect(resto.status).toBe(409);
  });
});
