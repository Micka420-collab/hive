// LES MODÈLES QU'UN NŒUD DÉCLARE — de la config `HIVE_MODELES` jusqu'à l'état.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
//   1. `parseModeles` SANITISE la config (pur) : vide, doublon, nom démesuré
//      écartés ; rien de valide ⇒ `undefined`. Une liste acceptée ici n'est
//      jamais refusée par le hub — sinon un détail de config empêcherait le nœud
//      de rejoindre.
//   2. DE BOUT EN BOUT : un vrai nœud qui déclare des modèles les voit apparaître
//      dans l'état de la ruche — la preuve que `opts.modeles` traverse bien le
//      register jusqu'au store.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseModeles } from '../src/node-client/modeles.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { LIMITS } from '../src/shared/protocol.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { HiveNode, StateSnapshot } from '../src/shared/types.js';

describe('parseModeles — la config lue en une liste propre, ou rien', () => {
  it('ABSENTE ⇒ undefined — un nœud qui ne configure rien ne déclare rien', () => {
    expect(parseModeles(undefined)).toBeUndefined();
  });

  it('VIDE OU BLANCHE ⇒ undefined — pas une liste vide qui prétendrait déclarer', () => {
    expect(parseModeles('')).toBeUndefined();
    expect(parseModeles('  ,  , ')).toBeUndefined();
  });

  it('DÉCOUPE, ROGNE, ET LAISSE TOMBER LES VIDES', () => {
    expect(parseModeles('claude-opus-5,claude-fable-5')).toEqual([
      'claude-opus-5',
      'claude-fable-5',
    ]);
    expect(parseModeles('  opus , fable ,, ')).toEqual(['opus', 'fable']);
  });

  it('ÉCARTE LES DOUBLONS — un modèle deux fois ne compte qu’une', () => {
    expect(parseModeles('opus,opus,fable,opus')).toEqual(['opus', 'fable']);
  });

  it('ÉCARTE UN NOM DÉMESURÉ — sans faire tomber les valides autour', () => {
    const trop = 'x'.repeat(LIMITS.name + 1);
    expect(parseModeles(`opus,${trop},fable`)).toEqual(['opus', 'fable']);
  });

  it('UN NOM D’EXACTEMENT LIMITS.name PASSE — la borne se tient des DEUX côtés', () => {
    // ─── LE CÔTÉ QUI MANQUAIT, ET QUI A ÉTÉ MESURÉ ─────────────────────────
    //
    // Le banc du dessus n'éprouve que le refus (`LIMITS.name + 1`). Rien ne
    // disait que la longueur MAXIMALE, elle, est acceptée : muter
    // `nom.length > LIMITS.name` en `>=` a laissé la suite ENTIÈRE verte
    // (3 542 tests) pendant que le nom le plus long possible était écarté.
    //
    // Ce que ça coûterait : le nœud déclarerait un modèle de MOINS que ce
    // qu'il sait faire tourner, sans rien dire, et l'Aiguillage n'y
    // enverrait jamais rien. Aucune panne — juste un modèle qui n'existe
    // plus pour la ruche.
    //
    // Et c'est bien la borne du hub qu'on recopie : `isStr` accepte
    // `v.length <= max` (`protocol.ts`). Resserrer ici rendrait le nœud plus
    // strict que la porte qu'il cherche à franchir — l'inverse exact de ce
    // que l'en-tête du module promet.
    const pile = 'x'.repeat(LIMITS.name);
    expect(parseModeles(`opus,${pile},fable`)).toEqual(['opus', pile, 'fable']);
  });

  it('BORNE À LIMITS.modeles — au-delà, on coupe (le hub refuserait tout sinon)', () => {
    const beaucoup = Array.from({ length: LIMITS.modeles + 5 }, (_, i) => `m${String(i)}`).join(
      ',',
    );
    const lu = parseModeles(beaucoup);
    expect(lu?.length).toBe(LIMITS.modeles);
    expect(lu?.[0]).toBe('m0');
  });
});

describe('de bout en bout — un nœud qui déclare ses modèles, l’état les porte', () => {
  const TOKEN = 'jeton-modeles-config-long-ici';
  const MODELES = ['claude-opus-5', 'claude-fable-5'];
  let dir: string;
  let server: HiveServer;
  let client: HiveNodeClient;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-modeles-'));
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
      name: 'ouvriere-a-modeles',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
      modeles: MODELES,
    });
    client.start();
  }, 30_000);

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('l’inscription réelle déclare les modèles, et l’état de la ruche les rend', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'x-hive-token': TOKEN };
    const deadline = Date.now() + 6_000;
    let noeud: HiveNode | undefined;
    while (Date.now() < deadline) {
      const s = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      noeud = s.nodes.find((n) => n.name === 'ouvriere-a-modeles' && n.status === 'online');
      if (noeud) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(noeud, 'le nœud doit s’inscrire avant l’échéance').toBeTruthy();
    expect(noeud?.modeles, 'l’état porte les modèles déclarés par le nœud').toEqual(MODELES);
  });
});

describe('un nœud SANS modèle rejoint quand même la ruche', () => {
  // ─── LA GARDE QUI TIENT CE FIL, ET CE QU'ELLE ÉVITE ───────────────────────
  //
  // Le client ne joint `modeles` au `register` que si la liste n'est pas vide :
  //
  //     ...(this.opts.modeles && this.opts.modeles.length > 0 ? { modeles } : {})
  //
  // Le `&&` seul ne suffit PAS : en JavaScript, `[]` est TRUTHY. C'est donc
  // `.length > 0` — et lui seul — qui empêche d'envoyer `modeles: []`.
  //
  // Or le hub exige `v.length >= 1` (`isModeleList`, `protocol.ts`) et refuse le
  // register ENTIER quand la liste est malformée. Muté en `>= 0`, un nœud dont
  // la liste est vide n'est donc pas « un nœud sans modèles » : c'est un nœud
  // qui NE PEUT PLUS REJOINDRE LA RUCHE, en boucle, sans qu'aucun message ne
  // dise pourquoi.
  //
  // Mesuré avant d'écrire ce banc : la suite entière est restée verte sous
  // cette mutation — 243 fichiers, 3 542 tests.
  //
  // C'est exactement le défaut que l'en-tête de `modeles.ts` promet d'éviter :
  // « une virgule en trop ou un nom vide dans la config empêcherait le nœud de
  // rejoindre — une panne opaque pour un détail ».

  const TOKEN = 'jeton-sans-modele-assez-long';
  let dir: string;
  let server: HiveServer;
  let client: HiveNodeClient;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-sansmodele-'));
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
      name: 'ouvriere-sans-modele',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
      // La liste VIDE, pas l'absence : c'est le cas que la garde doit absorber.
      modeles: [],
    });
    client.start();
  }, 30_000);

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('LISTE VIDE ⇒ le nœud s’inscrit, et ne déclare simplement aucun modèle', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { 'x-hive-token': TOKEN };
    const deadline = Date.now() + 8_000;
    let noeud: HiveNode | undefined;
    while (Date.now() < deadline) {
      const s = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      noeud = s.nodes.find((n) => n.name === 'ouvriere-sans-modele' && n.status === 'online');
      if (noeud) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(noeud, 'une liste de modèles VIDE a empêché le nœud de rejoindre').toBeTruthy();
    // Et il ne prétend rien : pas de liste vide qui se ferait passer pour une
    // déclaration.
    expect(noeud?.modeles ?? []).toEqual([]);
  });
});
