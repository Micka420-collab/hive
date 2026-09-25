// `/api/genome` sur une vraie Reine, après de vraies exécutions : deux nœuds
// réels (HiveNodeClient) déclarent chacun leur modèle, l'un rend, l'autre
// échoue. Le registre replie les événements réellement consignés — rien n'est
// fabriqué dans le journal.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import type { RegistreGenome } from '../src/shared/registre-genome.js';

const JETON = 'jeton-genome-suffisamment-long-pour-le-banc';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let dossier = '';

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

describe('le registre Genome — sur une vraie Reine, après de vraies exécutions', () => {
  it('RANGE CHAQUE FAIT SOUS LE MODÈLE COMMANDÉ, SANS NOTE NI COÛT INVENTÉ', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'genome-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    let appels = 0;
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${serveur.port}/ws`,
      token: JETON,
      name: 'ouvriere-genome',
      ownerName: 'banc',
      agentType: 'claude-code',
      modeles: ['modele-banc'],
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      adapter: {
        name: 'banc',
        async run() {
          appels += 1;
          await new Promise((r) => setTimeout(r, 40));
          // Le premier essai échoue : la tâche est reprise, puis rendue.
          return { success: appels > 1, diff: '', logs: 'ok', subAgents: [] };
        },
      },
      quiet: true,
    });
    client.start();
    const s = serveur;
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({
      projectId: p.id,
      title: 'Implémenter la route',
      prompt: 'ajouter un endpoint',
    });
    s.store.patchTask(t.id, { status: 'ready' });
    await attendre(() => s.store.getTask(t.id)?.status === 'done', 'la tâche ne se termine pas');

    const base = `http://127.0.0.1:${s.port}`;
    const r = await fetch(`${base}/api/genome`, { headers: { 'x-hive-token': JETON } });
    expect(r.status).toBe(200);
    const registre = (await r.json()) as RegistreGenome;

    expect(registre.lignes).toHaveLength(1);
    expect(registre.lignes[0]).toMatchObject({
      modele: 'modele-banc',
      categorie: 'code',
      affectations: 2,
      reprises: 1,
      rendus: 1,
      echecs: 0,
      coutFournisseur: 'inconnu',
    });
    expect(registre.lignes[0]?.dureeMedianeMs).toBeGreaterThanOrEqual(30);
    expect(registre.sansModele.affectations).toBe(0);
    expect(registre.fenetre.tronquee).toBe(false);

    expect((await fetch(`${base}/api/genome`)).status).toBe(401);
  });
});
