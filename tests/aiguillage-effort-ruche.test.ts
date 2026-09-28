// L'EFFORT TRAVERSE LA RUCHE — d'un vrai nœud (HiveNodeClient) à son CLI, et
// retour jusqu'à la preuve que jugera la contre-visite.
//
// ─── CE QUE LES BANCS PURS NE VOIENT PAS ─────────────────────────────────────
//
// `aiguillage.test.ts` sait QUEL bras est élu, `aiguillage-scheduler.test.ts`
// que l'ordonnanceur le commande. Entre les deux et le CLI, cinq relais
// peuvent le perdre sans qu'aucun de ces bancs ne bouge : la sonde du nœud
// (`effortsDocumentes`) jusqu'à `register.efforts`, le store qui les range,
// `assign_task.effort`, le contexte de l'adaptateur (`ctx.effort`), la
// re-livraison d'une tâche muette — et, au retour, l'annonce de contre-revue
// qui FIGE le bras du résultat relu (`producteurHarness`, `producteurEffort`,
// `producteurCoutUsd`). Un relais perdu, et le nœud tourne au défaut du CLI
// sous un verdict rangé à l'effort élu : l'Aiguillage apprend sur un bras qui
// n'a jamais tourné.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AdapterContext } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import type { Effort } from '../src/shared/effort.js';

const JETON = 'jeton-effort-ruche-suffisamment-long';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
const sockets: WebSocket[] = [];
const battements: NodeJS.Timeout[] = [];
let dossier = '';

afterEach(async () => {
  for (const c of battements.splice(0)) clearInterval(c);
  for (const ws of sockets.splice(0)) ws.close();
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
});

async function attendre(condition: () => boolean, message: string, ms = 15_000): Promise<void> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

async function ruche(options: { simulation: boolean; relivraisonMinMs?: number }) {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'effort-ruche-'));
  serveur = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: JETON,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dossier, 'hive.db'),
    tickMs: 40,
    ...options,
  });
  return serveur;
}

/**
 * Le vécu qui fait élire `opus` à l'effort `high` sous Claude Code : huit
 * « appliquer » à `high`, huit « refaire » au défaut du CLI.
 */
function vecuHigh(s: HiveServer): void {
  const p = s.store.createProject({ name: 'vecu' });
  const juger = (effort: Effort | null, suite: 'appliquer' | 'refaire', i: number): void => {
    const t = s.store.createTask({ projectId: p.id, title: 'Ajoute un endpoint', prompt: 'x' }).id;
    s.store.poserModeleAiguillage(t, 'opus', 1_000 + i, { harness: 'claude-code', effort });
    s.store.enregistrerContreVisite({
      productionTaskId: t,
      suite,
      raison: '',
      visiteurNodeId: 'v',
      visiteurAgent: 'codex',
      now: 2_000 + i,
    });
    s.store.patchTask(t, { status: 'done' });
  };
  for (let i = 0; i < 8; i++) juger('high', 'appliquer', i);
  for (let i = 0; i < 8; i++) juger(null, 'refaire', 100 + i);
}

describe('l’effort, d’un vrai nœud jusqu’à la preuve de contre-revue', () => {
  it('SONDÉ, DÉCLARÉ, COMMANDÉ AU CLI, PUIS FIGÉ AVEC LE RÉSULTAT RELU', async () => {
    const s = await ruche({ simulation: false });
    vecuHigh(s);
    const contextes: AdapterContext[] = [];
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${s.port}/ws`,
      token: JETON,
      name: 'ouvriere-effort',
      ownerName: 'banc',
      agentType: 'claude-code',
      modeles: ['opus'],
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      adapter: {
        name: 'banc',
        // Ce que `claude --help` aurait documenté : deux niveaux seulement.
        effortsDocumentes: () => Promise.resolve(['low', 'high'] as Effort[]),
        run(_task, ctx) {
          contextes.push(ctx);
          return Promise.resolve({
            success: true,
            diff: 'diff --git a/x.ts b/x.ts\n+export const x = 1;',
            logs: 'ok',
            subAgents: [],
            fournisseur: { source: 'claude-code', coutUsd: 0.05 },
          });
        },
      },
      quiet: true,
    });
    client.start();
    await attendre(
      () => s.store.listNodes().some((n) => n.name === 'ouvriere-effort' && n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    // La sonde a été redite à l'inscription, et rangée.
    const noeud = s.store.listNodes().find((n) => n.name === 'ouvriere-effort');
    expect(noeud?.efforts).toEqual(['low', 'high']);

    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({
      projectId: p.id,
      title: 'Ajoute le composant Ruche',
      prompt: 'implémente l’endpoint',
    });
    s.store.patchTask(t.id, { status: 'ready' });
    await attendre(() => contextes.length > 0, 'l’adaptateur n’a jamais tourné');

    expect(contextes[0]?.modele).toBe('opus');
    expect(contextes[0]?.effort, 'assign_task.effort arrive jusqu’au CLI').toBe('high');

    // La preuve figée au lancement de la contre-revue porte le bras ENTIER du
    // résultat relu : elle survivra à une réassignation de la tâche.
    await attendre(
      () => s.store.evenementsDeTache(t.id, ['contre_expertise']).length > 0,
      'aucune contre-revue annoncée',
    );
    const [annonce] = s.store.evenementsDeTache(t.id, ['contre_expertise']);
    expect(annonce?.payload).toMatchObject({
      producteurModele: 'opus',
      producteurHarness: 'claude-code',
      producteurEffort: 'high',
      producteurCoutUsd: 0.05,
    });
  });

  it('LA RE-LIVRAISON D’UNE TÂCHE MUETTE RENVOIE LE MÊME EFFORT', { timeout: 30_000 }, async () => {
    const s = await ruche({ simulation: true, relivraisonMinMs: 1_000 });
    vecuHigh(s);
    const recues: { modele?: string; effort?: string }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    sockets.push(ws);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string; modele?: string; effort?: string };
      if (m.type === 'assign_task') recues.push({ modele: m.modele, effort: m.effort });
    });
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: JETON,
        name: 'muette',
        ownerName: 'banc',
        agentType: 'claude-code',
        maxConcurrency: 1,
        nodeId: 'muette',
        modeles: ['opus'],
        efforts: ['low', 'high'],
      }),
    );
    // Vivante (elle bat), mais muette sur sa tâche : le filet la re-sert.
    battements.push(
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat', running: 1 }));
        }
      }, 500),
    );
    await attendre(() => s.store.getNode('muette')?.status === 'online', 'nœud non inscrit');
    expect(s.store.getNode('muette')?.efforts, 'register.efforts rangé').toEqual(['low', 'high']);

    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({
      projectId: p.id,
      title: 'Ajoute le composant Ruche',
      prompt: 'implémente l’endpoint',
    });
    s.store.patchTask(t.id, { status: 'ready' });

    await attendre(() => recues.length >= 2, 'aucune re-livraison', 20_000);
    expect(recues[0], 'l’assignation').toEqual({ modele: 'opus', effort: 'high' });
    expect(recues[1], 'la re-livraison').toEqual({ modele: 'opus', effort: 'high' });
  });
});
