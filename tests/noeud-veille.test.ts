// La veille du nœud : un hub MUET est quitté, un hub silencieux mais VIVANT ne
// l'est pas.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// Mesuré sur une vraie Reine derrière un relais TCP dont le chemin meurt sans
// rien fermer (le Wi-Fi qui décroche, le portable qui se réveille sur un autre
// réseau) : la Reine tenait le nœud pour mort au bout de 15 s et remettait ses
// tâches en file, mais le nœud, lui, ne retentait JAMAIS — il attendait que TCP
// constate la mort, soit le quart d'heure des retransmissions du noyau. La
// mission restait bloquée, tâches prêtes, alors qu'une nouvelle connexion
// aurait abouti.
//
// Les trois bancs parlent au VRAI client, sur de vraies sockets :
//   · un hub dont la socket cesse de lire (ni message, ni pong) → le nœud
//     abandonne cette connexion et en ouvre une autre ;
//   · un hub qui ne dit rien mais répond aux pings → le nœud RESTE (sans quoi
//     la veille couperait toute ruche calme) ;
//   · un hôte qui accepte la connexion TCP mais ne répond jamais à la poignée
//     de main → le nœud n'y pend pas indéfiniment.

import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { HiveNodeClient } from '../src/node-client/client.js';

const SILENCE_MAX_MS = 300;
const PING_MS = 100;

let client: HiveNodeClient | null = null;
let wss: WebSocketServer | null = null;
let tcp: net.Server | null = null;
const socketsTcp = new Set<net.Socket>();
const dossiers: string[] = [];

afterEach(async () => {
  client?.stop();
  client = null;
  if (wss) {
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss!.close(() => r()));
    wss = null;
  }
  if (tcp) {
    // `close` attend la fin des connexions : celles que le banc tient ouvertes
    // exprès ne finiraient jamais d'elles-mêmes.
    for (const s of socketsTcp) s.destroy();
    socketsTcp.clear();
    await new Promise<void>((r) => tcp!.close(() => r()));
    tcp = null;
  }
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

function nouveauClient(url: string): HiveNodeClient {
  const workRoot = mkdtempSync(path.join(os.tmpdir(), 'noeud-veille-'));
  dossiers.push(workRoot);
  return new HiveNodeClient({
    url,
    token: 'jeton-de-banc-suffisamment-long',
    name: 'veilleuse',
    ownerName: 'banc',
    agentType: 'shell',
    maxConcurrency: 1,
    workRoot,
    adapter: {
      name: 'noop',
      async run() {
        return { success: true, diff: '', logs: '', subAgents: [] };
      },
    },
    quiet: true,
    silenceMaxMs: SILENCE_MAX_MS,
    pingMs: PING_MS,
  });
}

async function hubEcoutant(): Promise<{ serveur: WebSocketServer; port: number }> {
  const serveur = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => serveur.once('listening', () => r()));
  const adresse = serveur.address();
  if (adresse === null || typeof adresse === 'string') throw new Error('adresse inattendue');
  return { serveur, port: adresse.port };
}

async function jusqua(condition: () => boolean, delaiMs: number): Promise<boolean> {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return condition();
}

describe('la veille du nœud', () => {
  it('UN HUB MUET EST QUITTÉ — le nœud ouvre une nouvelle connexion au lieu d’attendre TCP', async () => {
    const { serveur, port } = await hubEcoutant();
    wss = serveur;
    let connexions = 0;
    serveur.on('connection', (_ws, req) => {
      connexions++;
      // Le chemin MEURT, rien ne se ferme : la socket du hub cesse de lire,
      // donc ne répond plus aux pings et ne dit plus rien. C'est exactement ce
      // qu'un réseau disparu donne vu du nœud.
      if (connexions === 1) req.socket.pause();
    });

    client = nouveauClient(`ws://127.0.0.1:${port}/ws`);
    client.start();

    expect(await jusqua(() => connexions >= 1, 2_000), 'première connexion').toBe(true);
    // Silence toléré (300 ms) + recul de reconnexion initial (1 s) + marge.
    expect(
      await jusqua(() => connexions >= 2, 3_000),
      'le nœud est resté sur une connexion muette au lieu d’en ouvrir une autre',
    ).toBe(true);
  });

  it('UN HUB CALME MAIS VIVANT N’EST PAS QUITTÉ — le pong suffit comme signe de vie', async () => {
    const { serveur, port } = await hubEcoutant();
    wss = serveur;
    let connexions = 0;
    let fermetures = 0;
    serveur.on('connection', (ws) => {
      connexions++;
      // Aucun message applicatif, jamais : seul le pong automatique de `ws`
      // répond. Une veille qui n'écouterait que les messages couperait ici.
      ws.on('close', () => fermetures++);
    });

    client = nouveauClient(`ws://127.0.0.1:${port}/ws`);
    client.start();

    expect(await jusqua(() => connexions >= 1, 2_000), 'première connexion').toBe(true);
    // Cinq fois le silence toléré : une veille qui ignorerait les pongs aurait
    // coupé au moins une fois.
    await new Promise((r) => setTimeout(r, SILENCE_MAX_MS * 5));
    expect(fermetures, 'la veille a coupé un hub vivant').toBe(0);
    expect(connexions).toBe(1);
  });

  it('UNE POIGNÉE DE MAIN SANS RÉPONSE NE PEND PAS — le nœud abandonne et retente', async () => {
    let connexions = 0;
    // Un hôte qui ACCEPTE la connexion TCP et ne répond jamais à la requête
    // d'upgrade : sans délai de poignée de main, le client y resterait pendu.
    tcp = net.createServer((socket) => {
      connexions++;
      socketsTcp.add(socket);
      socket.on('error', () => undefined);
    });
    await new Promise<void>((r) => tcp!.listen(0, '127.0.0.1', () => r()));
    const adresse = tcp.address();
    if (adresse === null || typeof adresse === 'string') throw new Error('adresse inattendue');

    client = nouveauClient(`ws://127.0.0.1:${adresse.port}/ws`);
    client.start();

    expect(await jusqua(() => connexions >= 1, 2_000), 'première connexion TCP').toBe(true);
    expect(
      await jusqua(() => connexions >= 2, 3_000),
      'le nœud est resté pendu à une poignée de main sans réponse',
    ).toBe(true);
  });
});
