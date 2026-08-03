// LE POSTE — la machine derrière chaque ouvrière, du nœud jusqu'à l'écran.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// « Quelles ouvrières tournent sous Windows ? » doit avoir une réponse à
// l'écran. Le fil complet se prouve ici, maillon par maillon puis de bout en
// bout :
//
//   1. la CORRESPONDANCE `process.platform` → plateforme (pure) ;
//   2. le PROTOCOLE : une plateforme déclarée passe, une inventée REFUSE le
//      message entier — pas de correction en douce ;
//   3. le STORE : la table latérale retient, met à jour, et un client ancien
//      qui ne déclare rien N'EFFACE PAS ce qu'on sait ;
//   4. DE BOUT EN BOUT : un vrai nœud (HiveNodeClient) s'inscrit sur une
//      vraie ruche, et `/api/state` porte la plateforme de CE processus.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { PLATEFORMES, estPlateforme, plateformeDepuis } from '../src/shared/machine.js';
import { parseClientMessage } from '../src/shared/protocol.js';
import type { HiveNode, StateSnapshot } from '../src/shared/types.js';

describe('la correspondance — pure, et dans le bon sens', () => {
  it('les trois plateformes de la CI, traduites vers le mot que l’hôte lit', () => {
    expect(plateformeDepuis('win32')).toBe('windows');
    expect(plateformeDepuis('darwin')).toBe('macos');
    expect(plateformeDepuis('linux')).toBe('linux');
  });

  it('l’inconnu est un CONSTAT, pas une devinette', () => {
    // `freebsd`, `aix`… : la ruche dit « autre », jamais un OS inventé.
    for (const p of ['freebsd', 'aix', 'sunos', '']) {
      expect(plateformeDepuis(p), p).toBe('autre');
    }
  });

  it('la garde ne reconnaît QUE la liste — la même que l’écran', () => {
    for (const p of PLATEFORMES) expect(estPlateforme(p), p).toBe(true);
    for (const mauvais of ['win32', 'Windows', 'WINDOWS', 42, null, undefined, {}]) {
      expect(estPlateforme(mauvais), JSON.stringify(mauvais)).toBe(false);
    }
  });
});

describe('le protocole — une donnée du réseau, jugée comme telle', () => {
  const register = {
    type: 'register',
    token: 'jeton-poste-suffisamment-long',
    name: 'ruche-fenetre',
    ownerName: 'test',
    agentType: 'shell',
    maxConcurrency: 1,
  };

  it('une plateforme déclarée traverse telle quelle', () => {
    const msg = parseClientMessage(JSON.stringify({ ...register, plateforme: 'windows' }));
    expect(msg?.type).toBe('register');
    if (msg?.type === 'register') expect(msg.plateforme).toBe('windows');
  });

  it('sans plateforme, le message passe ET le champ reste absent', () => {
    const msg = parseClientMessage(JSON.stringify(register));
    expect(msg?.type).toBe('register');
    if (msg?.type === 'register') expect(msg.plateforme).toBeUndefined();
  });

  it('UNE PLATEFORME INVENTÉE REFUSE LE MESSAGE ENTIER — pas de correction en douce', () => {
    // Un champ optionnel mal formé est un client qui ment ou qui bogue, et
    // les deux se disent. Corriger en silence cacherait le second.
    for (const mauvais of ['win32', 'amiga', 42, {}]) {
      expect(
        parseClientMessage(JSON.stringify({ ...register, plateforme: mauvais })),
        JSON.stringify(mauvais),
      ).toBeNull();
    }
  });
});

describe('le store — la table latérale retient sans jamais inventer', () => {
  const profil = (plateforme?: 'windows' | 'macos' | 'linux' | 'autre') => ({
    name: 'n1',
    ownerName: 'test',
    agentType: 'shell',
    maxConcurrency: 1,
    ...(plateforme ? { plateforme } : {}),
  });

  it('déclarée, retenue, relue — et mise à jour au ré-enregistrement', () => {
    const store = new HiveStore(':memory:');
    const noeud = store.registerNode(profil('windows'));
    expect(store.getNode(noeud.id)?.plateforme).toBe('windows');
    expect(store.listNodes()[0]?.plateforme).toBe('windows');

    // La machine a changé (le membre a migré) : la déclaration neuve gagne.
    store.registerNode({ ...profil('linux'), nodeId: noeud.id });
    expect(store.getNode(noeud.id)?.plateforme).toBe('linux');
    store.close();
  });

  it('UN CLIENT ANCIEN QUI NE DÉCLARE RIEN N’EFFACE PAS ce qu’on sait', () => {
    const store = new HiveStore(':memory:');
    const noeud = store.registerNode(profil('macos'));
    // Reconnexion d'une version antérieure : pas de champ plateforme.
    store.registerNode({ ...profil(), nodeId: noeud.id });
    expect(store.getNode(noeud.id)?.plateforme, 'le savoir acquis survit aux vieux clients').toBe(
      'macos',
    );
    store.close();
  });

  it('jamais déclarée : null, pas une invention', () => {
    const store = new HiveStore(':memory:');
    const noeud = store.registerNode(profil());
    expect(store.getNode(noeud.id)?.plateforme ?? null).toBeNull();
    store.close();
  });
});

describe('de bout en bout — un vrai nœud, une vraie ruche, l’état porte la machine', () => {
  const TOKEN = 'jeton-poste-machine-long-ici';
  let dir: string;
  let server: HiveServer;
  let client: HiveNodeClient;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-poste-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    const adapter: AgentAdapter = {
      name: 'noop',
      async run() {
        return { success: true, diff: '', logs: 'ok', subAgents: [] };
      },
    };
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'ouvriere-du-poste',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    client.start();
  }, 30_000);

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('l’inscription réelle déclare LA plateforme de ce processus', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'x-hive-token': TOKEN };
    const attendu = plateformeDepuis(process.platform);
    const deadline = Date.now() + 6_000;
    let vu: StateSnapshot | null = null;
    while (Date.now() < deadline) {
      const s = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      if (s.nodes.some((n) => n.status === 'online')) {
        vu = s;
        break;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(vu, 'le nœud doit s’inscrire avant l’échéance').not.toBeNull();
    const noeud = vu?.nodes.find((n: HiveNode) => n.name === 'ouvriere-du-poste');
    expect(noeud?.plateforme, 'l’état de la ruche porte la machine du nœud').toBe(attendu);
  });
});
