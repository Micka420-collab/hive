// `GET /api/preuve` : LE RELEVÉ SORT DU JOURNAL RÉEL, SOUS JETON.
//
// Ce qu'on prouve : la route refuse sans jeton ; avec, elle rend le relevé
// calculé sur les faits que la Reine a elle-même rangés — une production
// rendue, relue par une autre famille, validée dans un bac, au coût déclaré —
// et sur les nœuds tels qu'ils se sont déclarés (isolement compris).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Preuve } from '../src/orchestrator/preuve.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-preuve-assez-long-pour-la-ruche';
const headers = { 'x-hive-token': TOKEN };

describe('GET /api/preuve', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-preuve-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuse sans jeton', async () => {
    expect((await fetch(`${base}/api/preuve`)).status).toBe(401);
  });

  it('une ruche neuve : zéro production, la fenêtre vide, pas élaguée', async () => {
    const p = (await (await fetch(`${base}/api/preuve`, { headers })).json()) as Preuve;
    expect(p.productions.rendues).toBe(0);
    expect(p.fenetre.elague).toBe(false);
    expect(p.noeuds.total).toBe(0);
  });

  it('compte ce que la Reine a rangé : relue, validée, coût déclaré, nœuds isolés', async () => {
    const { store } = server;
    store.registerNode({
      nodeId: 'prod',
      name: 'prod',
      ownerName: 'test',
      agentType: 'claude-code',
      maxConcurrency: 1,
      isolement: { niveau: 'conteneur', fournisseur: 'podman' },
    });
    store.registerNode({
      nodeId: 'relecteur',
      name: 'relecteur',
      ownerName: 'test',
      agentType: 'codex',
      maxConcurrency: 1,
    });
    const projet = store.createProject({ name: 'Preuve', repoUrl: '/repo' }).id;
    const t1 = store.createTask({ projectId: projet, title: 'une', prompt: 'une' });
    const t2 = store.createTask({ projectId: projet, title: 'deux', prompt: 'deux' });
    store.appendEvent('task_done', {
      taskId: t1.id,
      nodeId: 'prod',
      resultId: 1,
      durationMs: 1,
      fournisseur: { coutUsd: 0.42 },
    });
    store.appendEvent('contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId: t1.id,
      resultId: 1,
      producteur: 'claude-code',
      relecteur: 'codex',
      conteste: false,
      objections: [],
    });
    store.appendEvent('validation_recorded', {
      source: 'hive_sandbox',
      taskId: t1.id,
      resultId: 1,
      nodeId: 'prod',
      validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
    });
    store.appendEvent('task_done', { taskId: t2.id, nodeId: 'prod', resultId: 2, durationMs: 1 });
    store.appendEvent('contre_expertise_impossible', {
      taskId: t2.id,
      resultId: 2,
      motif: 'aucune_autre_famille',
    });

    const p = (await (await fetch(`${base}/api/preuve`, { headers })).json()) as Preuve;
    expect(p.productions).toMatchObject({
      rendues: 2,
      reluesParAutreFamille: 1,
      reluesParMemeFamille: 0,
      contestees: 0,
      relectureImpossible: 1,
    });
    expect(p.bac).toMatchObject({ validees: 1, toutPasse: 1, unEchec: 0 });
    expect(p.cout).toEqual({ declarees: 1, inconnues: 1, totalUsd: 0.42 });
    expect(p.noeuds).toMatchObject({ total: 2, isoles: 1, conteneur: 1 });
    expect(p.familles).toHaveLength(2);
    expect(p.fenetre.evenements).toBe(5);
  });
});
