// G09a — UN ARRÊT BUDGÉTAIRE N'EST PAS UNE LEÇON DE L'ESSAIM.
//
// La ligne qui ouvre les logs d'un arrêt dit « ni un échec » : elle contient
// « échec », la signature de l'essaim la prenait (chiffres normalisés : tous
// les arrêts la partagent), et dès trois nœuds la leçon devenait SYSTÉMIQUE.
// En autonomie, `deciderPas` choisit alors `corriger` avant tout le reste, et
// la ruche ouvrait « Corriger : [hive] arrêt budgétaire… » — un correctif du
// CODE pour une borne qui avait tenu —, de nouveau à chaque arrêt.
//
// Le banc passe par la VRAIE Reine : trois arrêts rangés par le planificateur
// lui-même, sur trois nœuds, et le runner d'essaim allumé sur une ruche
// gouvernable. Le témoin montre que ces logs, sans le fait, FONT une leçon
// systémique : c'est le fait rangé, pas leur texte, qui les en tient dehors.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { leconsCroisees } from '../src/orchestrator/essaim.js';
import { SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { ligneArretBudgetaire } from '../src/shared/arret-budgetaire.js';

const TOKEN = 'jeton-budget-essaim-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

/** Les logs d'un arrêt, tels que le nœud les rend : la ligne d'arrêt, puis le CLI. */
const LOGS_ARRET = `${ligneArretBudgetaire({
  plafondMicros: 50_000,
  coutUsd: 0.0249456,
  diffJoint: false,
})}\nReached maximum budget ($0.05)`;

let server: HiveServer | null = null;
let dir: string | null = null;
let avant: string | undefined;

afterEach(async () => {
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  dir = null;
  if (avant === undefined) delete process.env.HIVE_RUNNER;
  else process.env.HIVE_RUNNER = avant;
});

async function jusqua<T>(lire: () => T | undefined, msMax = 5_000): Promise<T | undefined> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    const v = lire();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return lire();
}

describe('un arrêt budgétaire n’est pas une leçon de l’essaim', () => {
  it('TROIS NŒUDS, TROIS ARRÊTS : aucune leçon, aucune tâche « Corriger »', async () => {
    avant = process.env.HIVE_RUNNER;
    process.env.HIVE_RUNNER = 'on';
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-budget-essaim-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 30,
    });
    const srv = server;
    const p = srv.store.createProject({ name: 'Ruche autonome' }).id;
    // Gouvernable : deux ouvrières irréprochables et en ligne.
    for (let i = 0; i < 2; i++) {
      const id = `gouv-${i}`;
      srv.store.registerNode({
        nodeId: id,
        name: id,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
      });
      srv.store.setNodeStatus(id, 'online');
      for (let k = 0; k < SEUIL_BUTINEUSE; k++) {
        srv.store.enregistrerInspection({
          resultId: i * 1000 + k + 1,
          taskId: `T${i}-${k}`,
          nodeId: id,
          verdict: 'clean',
          score: 0,
          applique: false,
          griefs: [],
        });
      }
    }
    // Trois enfants délégués, chacun arrêté sur son plafond sur un nœud
    // différent — rangés par le VRAI planificateur, qui écrit le fait.
    srv.store.createTask({ id: 'racine', projectId: p, title: 'Racine', prompt: 'délègue' });
    for (let i = 0; i < 3; i++) {
      const nodeId = `plafonne-${i}`;
      const childTaskId = `enfant-${i}`;
      srv.store.registerNode({
        nodeId,
        name: nodeId,
        ownerName: 'test',
        agentType: 'claude-code',
        maxConcurrency: 1,
      });
      expect(
        srv.store.createDelegatedTask({
          childTaskId,
          parentTaskId: 'racine',
          title: `Lot ${i}`,
          prompt: 'fais ce lot',
          durationMs: 60_000,
          costMicros: 50_000,
          resourceUnits: 1,
        }).ok,
      ).toBe(true);
      srv.store.patchTask(childTaskId, { status: 'assigned', assignedNodeId: nodeId });
      expect(
        srv.scheduler.handleTaskResult(nodeId, {
          taskId: childTaskId,
          success: false,
          diff: '',
          logs: LOGS_ARRET,
          durationMs: 10,
          subAgents: [],
          fournisseur: { source: 'claude-code', coutUsd: 0.0249456 },
          arretBudgetaire: 'cout',
        }),
      ).toBe(true);
    }
    // Le témoin : ces MÊMES logs, lus comme des échecs, font une leçon systémique.
    const temoin = leconsCroisees(
      [0, 1, 2].map((i) => ({
        nodeId: `plafonne-${i}`,
        taskId: `enfant-${i}`,
        logs: LOGS_ARRET,
        createdAt: i,
      })),
    );
    expect(temoin.map((l) => l.portee)).toEqual(['systemique']);
    // Le fait rangé les en tient dehors : aucun échec, aucune leçon — ni pour
    // les phéromones, qui déposaient −6 au nœud sur ce domaine, ni pour la
    // dérive, dont la diversité des causes d'échec tombait (une seule
    // signature) jusqu'à mettre la ruche autonome en halte.
    expect(srv.store.listRecentFailures()).toEqual([]);
    expect(srv.store.listResultsForPheromones()).toEqual([]);
    expect(srv.store.listProductionsPourDerive()).toEqual([]);

    // L'essaim, allumé, ne voit rien à corriger.
    const base = `http://127.0.0.1:${srv.port}`;
    await fetch(`${base}/api/projects/${p}/essaim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ niveau: 'gouverne', depotInscrit: false }),
    });
    const vue = (await (await fetch(`${base}/api/projects/${p}/essaim`, { headers })).json()) as {
      lecons: unknown[];
      decision: { pas: string };
    };
    expect(vue.lecons).toEqual([]);
    expect(vue.decision.pas).not.toBe('corriger');
    const cycle = await jusqua(() =>
      srv.store
        .listEvents(0, 500)
        .find((e) => e.type === 'essaim_cycle' && e.payload.projectId === p),
    );
    expect(cycle, 'le runner n’a fait aucun cycle').toBeDefined();
    expect(cycle?.payload.pas).not.toBe('corriger');
    expect(srv.store.listTasks(p).filter((t) => t.title.startsWith('Corriger : '))).toEqual([]);

    // Le témoin des lecteurs : un échec ORDINAIRE, lui, y entre partout.
    srv.store.insertResult({
      taskId: 'enfant-0',
      nodeId: 'plafonne-0',
      success: false,
      diff: '',
      logs: 'Error: ENOENT no such file or directory',
      durationMs: 10,
      subAgents: [],
    });
    expect(srv.store.listRecentFailures()).toHaveLength(1);
    expect(srv.store.listResultsForPheromones()).toHaveLength(1);
    expect(srv.store.listProductionsPourDerive()).toHaveLength(1);
  });
});
