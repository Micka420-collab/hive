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
