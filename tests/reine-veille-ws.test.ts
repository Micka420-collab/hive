// La veille des sockets côté Reine : une connexion qui ne répond plus aux pings
// est coupée — nœud comme tableau de bord ; une connexion qui répond reste.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// La Reine ne pinguait jamais ses sockets. Une connexion morte en silence
// (onglet d'un portable en veille, réseau disparu sans rien fermer) restait
// dans `dashboardSockets` jusqu'aux délais TCP du noyau, et chaque diffusion
// d'instantané s'accumulait dans son tampon, sur le serveur. Carte Notion
// « Auditer WebSocket, reconnexion et perte de messages », scénario
// « ping/pong expiré ».
//
// Le client « muet » est un vrai client `ws` à qui l'on retire le pong
// automatique (`autoPong: false`) : il continue de lire et d'écrire, il ne
// répond simplement plus aux pings — ce qu'un pair disparu fait, vu du serveur.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-veille-ws-suffisamment-long';
const VIE_MS = 150;

let serveur: HiveServer | null = null;
let dossier = '';
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true });
});

async function reine(): Promise<HiveServer> {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'reine-veille-'));
  serveur = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: JETON,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dossier, 'hive.db'),
    simulation: false,
    tickMs: 60_000,
    wsVieMs: VIE_MS,
  });
  return serveur;
}

/** Ouvre une socket et y envoie `premier` ; rend la socket une fois la réponse attendue reçue. */
function ouvrir(
  port: number,
  premier: object,
  attendu: string,
  autoPong: boolean,
): Promise<{ ws: WebSocket; fermee: Promise<number> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { autoPong });
  clients.push(ws);
  const fermee = new Promise<number>((r) => ws.once('close', (code) => r(code)));
  return new Promise((resolve, reject) => {
    ws.once('open', () => ws.send(JSON.stringify(premier)));
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString()) as { type: string };
      if (msg.type === attendu) resolve({ ws, fermee });
    });
    ws.once('error', reject);
  });
}

function noeud(nodeId: string): object {
  return {
    type: 'register',
    token: JETON,
    nodeId,
    name: nodeId,
    ownerName: 'banc',
    agentType: 'shell',
    maxConcurrency: 1,
  };
}

/** `true` si la promesse se résout avant `ms`. */
async function avant<T>(p: Promise<T>, ms: number): Promise<boolean> {
  return Promise.race([
    p.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ]);
}

describe('la veille des sockets côté Reine', () => {
  it('UN NŒUD QUI NE RÉPOND PLUS AUX PINGS EST COUPÉ — et déclaré déconnecté', async () => {
    const s = await reine();
    const { fermee } = await ouvrir(s.port, noeud('noeud-muet'), 'registered', false);
    expect(s.store.listNodes().find((n) => n.id === 'noeud-muet')?.status).toBe('online');

    // Deux tours de veille suffisent : ping sans pong, puis coupure.
    expect(await avant(fermee, VIE_MS * 6), 'la Reine a gardé une socket muette').toBe(true);
    const fin = Date.now() + 2_000;
    while (
      Date.now() < fin &&
      s.store.listNodes().find((n) => n.id === 'noeud-muet')?.status === 'online'
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(s.store.listNodes().find((n) => n.id === 'noeud-muet')?.status).not.toBe('online');
  });

  it('UN TABLEAU DE BORD MUET EST RETIRÉ DE LA DIFFUSION', async () => {
    const s = await reine();
    const { fermee } = await ouvrir(s.port, { type: 'subscribe', token: JETON }, 'state', false);
    expect(await avant(fermee, VIE_MS * 6), 'la Reine a gardé un tableau de bord muet').toBe(true);
  });

  it('UNE CONNEXION QUI RÉPOND RESTE — la veille ne coupe pas les vivants', async () => {
    const s = await reine();
    const { fermee: noeudFerme } = await ouvrir(s.port, noeud('noeud-vivant'), 'registered', true);
    const { fermee: ecranFerme } = await ouvrir(
      s.port,
      { type: 'subscribe', token: JETON },
      'state',
      true,
    );
    // Dix tours de veille : une veille qui ignorerait les pongs aurait coupé.
    expect(await avant(noeudFerme, VIE_MS * 10), 'la veille a coupé un nœud vivant').toBe(false);
    expect(await avant(ecranFerme, 50), 'la veille a coupé un tableau de bord vivant').toBe(false);
    expect(s.store.listNodes().find((n) => n.id === 'noeud-vivant')?.status).toBe('online');
  });
});
