// Réquisitions via protocole nœud — ouverture WS + décision relayée (ADR 0010 lot 7).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-maitre-de-la-ruche-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer;
let dir: string;
let base: string;
const ouverts: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-reqws-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'ws.db'),
    simulation: false,
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  for (const ws of ouverts.splice(0)) ws.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

async function noeudEnregistre(nodeId: string): Promise<{ ws: WebSocket; recus: unknown[] }> {
  const recus: unknown[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  ouverts.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'register',
          token: TOKEN,
          nodeId,
          name: nodeId,
          ownerName: 'testeur',
          agentType: 'shell',
          maxConcurrency: 1,
        }),
      );
    });
    ws.on('message', (d) => {
      const msg = JSON.parse(String(d)) as { type: string };
      recus.push(msg);
      if (msg.type === 'registered') resolve();
    });
    ws.on('error', reject);
  });
  return { ws, recus };
}

function attendreMessage(
  recus: unknown[],
  type: string,
  timeoutMs = 3_000,
): Promise<Record<string, unknown>> {
  const existant = recus.find((m) => (m as { type: string }).type === type);
  if (existant) return Promise.resolve(existant as Record<string, unknown>);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const hit = recus.find((m) => (m as { type: string }).type === type);
      if (hit) {
        clearInterval(interval);
        resolve(hit as Record<string, unknown>);
      } else if (Date.now() > deadline) {
        clearInterval(interval);
        reject(new Error(`timeout ${type}`));
      }
    };
    const interval = setInterval(tick, 20);
    tick();
  });
}

describe('réquisition — protocole nœud', () => {
  it('requisition_open → ack ; réponse humaine → requisition_result (sans secret)', async () => {
    server.store.registerNode({
      nodeId: 'n-req',
      name: 'w',
      ownerName: 'hôte',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const { ws, recus } = await noeudEnregistre('n-req');
    ws.send(
      JSON.stringify({
        type: 'requisition_open',
        genre: 'cle_api',
        libelle: 'Clé Seedance',
        detail: 'pour vidéo',
      }),
    );
    const ack = await attendreMessage(recus, 'requisition_ack');
    expect(ack).toMatchObject({
      type: 'requisition_ack',
      genre: 'cle_api',
      libelle: 'Clé Seedance',
    });
    expect(typeof ack.id).toBe('string');
    expect(JSON.stringify(ack)).not.toMatch(/sk-|secret/i);

    const rep = await fetch(`${base}/api/requisitions/${ack.id}/repondre`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'accordee' }),
    });
    expect(rep.status).toBe(200);

    const result = await attendreMessage(recus, 'requisition_result');
    expect(result).toEqual({
      type: 'requisition_result',
      id: ack.id,
      statut: 'accordee',
    });
    expect(JSON.stringify(result)).not.toMatch(/sk-|secret/i);
  });

  it('genre inventé → error, pas d’ack', async () => {
    server.store.registerNode({
      nodeId: 'n-bad',
      name: 'w',
      ownerName: 'hôte',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const { ws, recus } = await noeudEnregistre('n-bad');
    ws.send(
      JSON.stringify({
        type: 'requisition_open',
        genre: 'seedance',
        libelle: 'x',
      }),
    );
    const err = await attendreMessage(recus, 'error');
    expect(err.type).toBe('error');
    expect(String(err.message)).toMatch(/genre/i);
    expect(recus.some((m) => (m as { type: string }).type === 'requisition_ack')).toBe(false);
  });
});
