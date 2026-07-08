// Tests du Sting Detector v0 (Palier 2) : détection de conflits (chemins de
// fichiers + recouvrement lexical), conscience des dépendances, sérialisation
// par l'ordonnanceur sur conflit fort, et endpoint REST.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzePair, detectConflicts, extractPaths } from '../src/orchestrator/sting-detector.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { HiveEvent, Task } from '../src/shared/types.js';
import type { NodeProfile } from '../src/orchestrator/store.js';

const TOKEN = 'jeton-sting-detector-long';

const profile = (name: string, cap = 1): NodeProfile => ({
  name,
  ownerName: 'o',
  agentType: 'shell',
  maxConcurrency: cap,
});

describe('extraction de chemins', () => {
  it('reconnaît les fichiers et ignore la prose', () => {
    const p = extractPaths('modifier src/auth.ts et components/Login.tsx, cf package.json');
    expect(p.has('src/auth.ts')).toBe(true);
    expect(p.has('components/login.tsx')).toBe(true);
    expect(p.has('package.json')).toBe(true);
    // Ni « e.g. », ni un nombre, ni « et/ou ».
    expect(extractPaths('par exemple e.g. la version 3.14 et/ou autre').size).toBe(0);
  });
});

describe('analyse de paire', () => {
  it('conflit FORT sur fichier partagé', () => {
    const r = analyzePair(
      { title: 'Refactor auth', prompt: 'réécrire src/auth.ts' },
      { title: 'Corriger bug', prompt: 'bug dans src/auth.ts à corriger' },
    );
    expect(r.severity).toBe('high');
    expect(r.sharedPaths).toContain('src/auth.ts');
  });

  it('conflit faible sur fort recouvrement lexical (sans fichier commun)', () => {
    const r = analyzePair(
      { title: 'Auth', prompt: 'authentification connexion session utilisateur securite' },
      { title: 'Login', prompt: 'authentification connexion session inscription securite' },
    );
    expect(r.severity).toBe('low');
  });

  it('aucun conflit quand les surfaces divergent', () => {
    const r = analyzePair(
      { title: 'UI', prompt: 'réaliser le dashboard react' },
      { title: 'Paiement', prompt: 'intégrer stripe et les webhooks' },
    );
    expect(r.severity).toBeNull();
  });
});

describe('detectConflicts', () => {
  const task = (id: string, prompt: string, dependsOn: string[] = []): Task => ({
    id,
    projectId: 'p1',
    title: id,
    prompt,
    status: 'ready',
    dependsOn,
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 0,
    createdAt: 1,
    updatedAt: 1,
  });

  it('signale deux tâches concurrentes touchant le même fichier', () => {
    const conflicts = detectConflicts([
      task('a', 'modifier src/auth.ts'),
      task('b', 'ajouter un test à src/auth.ts'),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.severity).toBe('high');
  });

  it('ignore une paire liée par une dépendance (jamais concurrente)', () => {
    const conflicts = detectConflicts([
      task('a', 'modifier src/auth.ts'),
      task('b', 'ajouter un test à src/auth.ts', ['a']),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it('ignore les tâches terminées et les projets distincts', () => {
    const done = { ...task('a', 'src/auth.ts'), status: 'done' as const };
    const other = { ...task('c', 'src/auth.ts'), projectId: 'p2' };
    const conflicts = detectConflicts([done, task('b', 'src/auth.ts'), other]);
    expect(conflicts).toHaveLength(0);
  });
});

describe('sérialisation par l’ordonnanceur', () => {
  const setup = () => {
    const store = new HiveStore(':memory:');
    const assigned: { taskId: string; nodeId: string }[] = [];
    const events: HiveEvent[] = [];
    const scheduler = new Scheduler(store, {
      onAssign: (nodeId, t) => assigned.push({ taskId: t.id, nodeId }),
      onEvent: (e) => events.push(e),
    });
    return { store, scheduler, assigned, events };
  };

  it('diffère une tâche en conflit fort avec une tâche active, puis la relance', () => {
    const { store, scheduler, assigned, events } = setup();
    try {
      scheduler.registerNode(profile('n1'));
      scheduler.registerNode(profile('n2'));
      const p = store.createProject({ name: 'P' });
      store.createTask({ id: 'ta', projectId: p.id, title: 'A', prompt: 'éditer src/auth.ts' });
      store.createTask({ id: 'tb', projectId: p.id, title: 'B', prompt: 'tester src/auth.ts' });

      scheduler.tick();
      // Malgré deux nœuds libres, une seule des deux est lancée (conflit fichier).
      expect(assigned).toHaveLength(1);
      const running = assigned[0]!.taskId;
      const deferred = running === 'ta' ? 'tb' : 'ta';
      expect(store.getTask(deferred)?.status).toBe('ready');
      expect(events.some((e) => e.type === 'task_conflict_deferred')).toBe(true);

      // La tâche active réussit → la différée peut enfin partir.
      store.patchTask(running, { status: 'running' });
      scheduler.handleTaskResult(assigned[0]!.nodeId, {
        taskId: running,
        success: true,
        diff: '',
        logs: 'ok',
        durationMs: 5,
        subAgents: [],
      });
      expect(assigned.map((a) => a.taskId)).toContain(deferred);
    } finally {
      store.close();
    }
  });

  it('laisse tourner en parallèle deux tâches en conflit seulement faible', () => {
    const { store, scheduler, assigned } = setup();
    try {
      scheduler.registerNode(profile('n1'));
      scheduler.registerNode(profile('n2'));
      const p = store.createProject({ name: 'P' });
      store.createTask({
        id: 'la',
        projectId: p.id,
        title: 'A',
        prompt: 'authentification connexion session utilisateur securite',
      });
      store.createTask({
        id: 'lb',
        projectId: p.id,
        title: 'B',
        prompt: 'authentification connexion session inscription securite',
      });
      scheduler.tick();
      // Conflit faible (aucun fichier commun) → non bloquant : les deux partent.
      expect(assigned).toHaveLength(2);
    } finally {
      store.close();
    }
  });
});

describe('GET /api/projects/:id/conflicts', () => {
  let server: HiveServer;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-sting-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 200,
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  it('remonte les conflits d’un projet (et exige le token)', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Conflits' }),
      })
    ).json()) as { id: string };
    await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tasks: [
          { id: 'ca', title: 'A', prompt: 'modifier src/server.ts pour le routage' },
          { id: 'cb', title: 'B', prompt: 'ajouter un handler dans src/server.ts' },
        ],
      }),
    });

    const res = await fetch(`${base}/api/projects/${project.id}/conflicts`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conflicts: { a: string; b: string; severity: string; sharedPaths: string[] }[];
    };
    expect(body.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(body.conflicts[0]?.severity).toBe('high');
    expect(body.conflicts[0]?.sharedPaths).toContain('src/server.ts');

    const noAuth = await fetch(`${base}/api/projects/${project.id}/conflicts`, {
      headers: { 'content-type': 'application/json' },
    });
    expect(noAuth.status).toBe(401);
  });
});
