// LES CONSTATS D'OUTILS, DU NŒUD JUSQU'À L'ÉCRAN — le fil entier.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// `setOutilsConstates` avait tout : son champ de protocole, son validateur, ses
// bancs — et PERSONNE ne l'appelait. Le message savait porter les constats, le
// nœud n'en mettait jamais dedans, et le tableau de bord montrait une ruche
// sans outils sur des machines qui en portaient quatre.
//
// C'est le § 2 tritrigies du journal : un demi-câblage qui ENREGISTRE sans
// EXÉCUTER fait apprendre un mensonge. Les bancs des deux moitiés étaient
// verts ; le fil, lui, était coupé.
//
// Ce fichier monte donc un VRAI hub et un VRAI nœud, et vérifie que ce que le
// poste a constaté ressort de `/api/state`. Il traverse quatre frontières que
// personne d'autre ne traverse ensemble : le client, le protocole, le hub, la
// table latérale.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { constatsPourLeHub } from '../src/node-client/connexion.js';
import { outilsDuNoeud } from '../src/shared/outils-du-noeud.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { EtatAgent } from '../src/shared/connexion-agent.js';
import type { OutilConstate } from '../src/shared/protocol.js';
import type { HiveNode, StateSnapshot } from '../src/shared/types.js';

describe('constatsPourLeHub — ce qui part, et surtout ce qui NE part PAS', () => {
  const etats: EtatAgent[] = [
    {
      agent: 'claude-code',
      binaire: true,
      cle: 'presente',
      verdict: 'pret',
      installation: ['npm', 'install', '-g', '@anthropic-ai/claude-code'],
      poseAutomatique: false,
    },
    {
      agent: 'cursor',
      binaire: false,
      cle: 'absente',
      verdict: 'rien',
      installation: null,
      poseAutomatique: false,
    },
  ];

  it('ne transmet QUE le constat : ni verdict, ni commande d’installation', () => {
    // Une CONCLUSION transportée est une conclusion qui dérive : le jour où la
    // règle change d'un côté, l'autre continue d'afficher l'ancienne. Le hub
    // rejuge donc à partir des mêmes faits bruts, avec la même fonction pure.
    const partis = constatsPourLeHub(etats);
    expect(partis).toEqual([
      { agent: 'claude-code', binaire: true, cle: 'presente' },
      { agent: 'cursor', binaire: false, cle: 'absente' },
    ]);
    for (const c of partis) {
      expect(Object.keys(c).sort()).toEqual(['agent', 'binaire', 'cle']);
    }
  });

  it('n’invente pas d’entrée et n’en perd pas', () => {
    expect(constatsPourLeHub([])).toEqual([]);
    expect(constatsPourLeHub(etats)).toHaveLength(etats.length);
  });
});

describe('LA SENTINELLE DU CÂBLAGE — `main.ts` pose les constats, et AVANT `start()`', () => {
  // ─── CE QUE CETTE GARDE VAUT, ET CE QU'ELLE NE VAUT PAS ────────────────────
  //
  // Elle LIT la source. C'est un aveu, pas une élégance : le banc de bout en
  // bout ci-dessous appelle `setOutilsConstates` lui-même, donc il resterait
  // VERT si `main.ts` cessait de l'appeler — exactement le demi-câblage que ce
  // fichier entier existe pour dénoncer. Le remède serait de lancer `main.ts`
  // pour de vrai ; il refuse de démarrer sans agent de production sur le poste,
  // et le faire croire en aurait fait un troisième mensonge.
  //
  // Alors la garde lit deux choses que la relecture SAIT établir : que l'appel
  // existe, et qu'il vient avant `start()`. La seconde n'est pas cosmétique —
  // le register part à la première connexion, et des constats posés après
  // seraient arrivés au deuxième essai, c'est-à-dire jamais.
  const source = readFileSync(
    fileURLToPath(new URL('../src/node-client/main.ts', import.meta.url)),
    'utf8',
  );

  it('l’appel existe', () => {
    expect(source).toContain('client.setOutilsConstates(constatsPourLeHub(');
  });

  it('et il précède `client.start()`', () => {
    const pose = source.indexOf('client.setOutilsConstates(');
    const depart = source.indexOf('client.start()');
    expect(pose, 'l’appel doit être présent').toBeGreaterThan(-1);
    expect(depart, '`client.start()` doit être présent').toBeGreaterThan(-1);
    expect(pose).toBeLessThan(depart);
  });

  it('le diagnostic n’est fait QU’UNE fois — il sonde le PATH et l’environnement', () => {
    // Deux sondages coûteraient deux fois pour la même réponse, et pourraient
    // se contredire si le poste change entre les deux.
    const appels = source.match(/diagnostiquerAgents\(/g) ?? [];
    expect(appels).toHaveLength(1);
  });
});

describe('de bout en bout — ce que le poste constate, l’état de la ruche le porte', () => {
  const TOKEN = 'jeton-outils-constates-bout-en-bout';
  const CONSTATS: OutilConstate[] = [
    { agent: 'claude-code', binaire: true, cle: 'presente' },
    { agent: 'windsurf', binaire: true, cle: 'inconnue' },
    { agent: 'cursor', binaire: false, cle: 'absente' },
  ];
  let dir: string;
  let server: HiveServer;
  let client: HiveNodeClient;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-outils-'));
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
      name: 'poste-a-outils',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    // AVANT `start()` : le register part à la première connexion. Des constats
    // posés après seraient arrivés au deuxième essai — c'est-à-dire jamais, sur
    // un réseau qui marche.
    client.setOutilsConstates(CONSTATS);
    client.start();
  }, 30_000);

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function noeud(): Promise<HiveNode | undefined> {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'x-hive-token': TOKEN };
    const echeance = Date.now() + 6_000;
    while (Date.now() < echeance) {
      const s = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      const n = s.nodes.find((x) => x.name === 'poste-a-outils' && x.status === 'online');
      if (n) return n;
      await new Promise((r) => setTimeout(r, 80));
    }
    return undefined;
  }

  it('l’inscription réelle porte les constats jusqu’à `/api/state`', async () => {
    const n = await noeud();
    expect(n, 'le nœud doit s’inscrire avant l’échéance').toBeTruthy();
    expect(n?.outils, 'l’état porte ce que le poste a constaté').toEqual(CONSTATS);
  });

  it('et l’écran peut alors dire ce que la ruche SAIT faire de chacun', async () => {
    // Le constat seul ne suffit pas : Windsurf est là, avec sa clé, et la ruche
    // ne sait que le détecter. C'est le croisement des deux qui produit la
    // seule phrase honnête — et il n'est possible QUE parce que le constat a
    // traversé tout le fil.
    const n = await noeud();
    const vus = outilsDuNoeud(n?.outils ?? []);
    const parId = new Map(vus.map((o) => [o.id, o]));
    expect(parId.get('claude-code')?.pilotable).toBe(true);
    expect(parId.get('windsurf')?.verdict).toBe('cle_inconnue');
    expect(parId.get('windsurf')?.pilotable).toBe(false);
    expect(parId.get('windsurf')?.niveau).toBe('detecte');
    expect(parId.get('cursor')?.pilotable).toBe(false);
  });
});
