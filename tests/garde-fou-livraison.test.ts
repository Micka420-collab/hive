// L'AGENT GARDE-FOUS CÂBLÉ DANS LA LIVRAISON (server, lot G4b).
//
// Ce que ce banc protège : c'est ici que la boucle d'apprentissage se FERME. Au
// moment où la ruche décide du sort d'une production (`contreVisiteAutorise`), le
// POLYÉTHISME suit l'échelon du projet opt-in — pas le seul mode global — et
// l'EXIGENCE constatée est RANGÉE. Sans cette exigence, toute production
// « leger »/« standard » resterait EN VOL pour toujours, et le bandit
// n'apprendrait jamais rien d'autre que « strict ».
//
// On déclenche la décision par un GET SYNCHRONE sur `/essaim` (le runner est
// éteint : aucun tick asynchrone, aucun intermittent). Aucun GitHub, aucun
// réseau : `etatEssaim` ne fait que COMPTER les productions à livrer, et ce
// comptage passe par `aLivrer → contreVisiteAutorise`, qui pose l'exigence.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Echelon } from '../src/orchestrator/garde-fou.js';

const TOKEN = 'jeton-garde-fou-livraison-long';
const DIFF = ['diff --git a/a.ts b/a.ts', '@@ -1 +1 @@', '-const a = 1;', '+const a = 2;'].join(
  '\n',
);

describe('Garde-Fous câblé — la livraison (le polyéthisme et l’exigence par projet)', () => {
  let srv: HiveServer;
  let dir: string;
  let base: string;
  const avant = process.env.HIVE_RUNNER;

  beforeEach(async () => {
    delete process.env.HIVE_RUNNER; // runner ÉTEINT : on déclenche à la main, sans tick
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-gf-livr-'));
    srv = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
    });
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterEach(async () => {
    await srv.stop();
    rmSync(dir, { recursive: true, force: true });
    if (avant === undefined) delete process.env.HIVE_RUNNER;
    else process.env.HIVE_RUNNER = avant;
  });

  /**
   * Un projet opt-in à l'échelon donné, avec UNE production livrable (relue,
   * approuvée, à diff non vide), sous un nœud NOURRICE (peu d'antécédents).
   * L'échelon est posé à la main : c'est le câblage de l'assignation (G4a) qui le
   * pose en vrai, éprouvé ailleurs — ici on teste la LIVRAISON.
   */
  function projetLivrable(echelon: Echelon): { projectId: string; taskId: string } {
    const p = srv.store.createProject({ name: 'P', repoUrl: 'https://github.com/x/y.git' }).id;
    srv.store.setGardeFou(p, { actif: true, borneMin: echelon, borneMax: echelon }, 'humain');
    const nodeId = `n-${echelon}`;
    srv.store.registerNode({
      nodeId,
      name: nodeId,
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    srv.store.setNodeStatus(nodeId, 'online');
    const t = srv.store.createTask({ projectId: p, title: 'Passer a à 2', prompt: 'fais-le' });
    srv.store.patchTask(t.id, { status: 'done', assignedNodeId: nodeId });
    srv.store.poserEchelonGardeFou(t.id, echelon, 1_000);
    srv.store.enregistrerInspection({
      resultId: 1,
      taskId: t.id,
      nodeId,
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });
    srv.store.insertResult({
      taskId: t.id,
      nodeId,
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
    srv.store.setTaskReview(t.id, 'approved');
    return { projectId: p, taskId: t.id };
  }

  /** Déclenche la décision de livraison (synchrone) via le statut d'essaim. */
  const decider = (projectId: string): Promise<Response> =>
    fetch(`${base}/api/projects/${projectId}/essaim`, {
      headers: { 'x-hive-token': TOKEN },
    });

  it('LEGER : le polyéthisme non-strict RANGE « dispensee » — la boucle se ferme', async () => {
    const { projectId } = projetLivrable('leger');
    // Avant la décision, la production est EN VOL : échelon + verdict, mais ni
    // contre-visite ni exigence → observationsGardeFou l'écarte.
    expect(srv.store.observationsGardeFou(), 'en vol avant décision').toEqual([]);

    const rep = await decider(projectId);
    expect(rep.status).toBe(200);

    const faits = srv.store.observationsGardeFou();
    expect(faits, 'la production est désormais REPLIABLE').toHaveLength(1);
    expect(faits[0]).toMatchObject({ echelon: 'leger', exigence: 'dispensee', suite: null });
  });

  it('STRICT : le projet ATTEINT la contre-visite malgré le global « consignes »', async () => {
    // Sous l'ancien code (gate global `polyethismeEnVigueur() !== strict`), un
    // projet strict aurait court-circuité — le global par défaut est consignes.
    // Le nœud est une nourrice (une seule inspection) → contre-visite EXIGÉE.
    const { projectId } = projetLivrable('strict');
    const rep = await decider(projectId);
    expect(rep.status).toBe(200);

    const faits = srv.store.observationsGardeFou();
    expect(faits).toHaveLength(1);
    expect(faits[0]).toMatchObject({ echelon: 'strict', exigence: 'exigee' });
  });
});
