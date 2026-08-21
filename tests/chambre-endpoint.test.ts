// Chambre — API lecture (ADR 0010 lot 4). Identités : jeton de ruche seulement.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-chambre-assez-long-pour-tests';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

describe('GET /api/chambre/:nodeId', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-chambre-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60,
    });
    return server;
  }

  it('401 sans jeton — un partage ne lit pas les identités', async () => {
    const srv = await demarrer();
    const res = await fetch(`${srv.url}/api/chambre/n-1`);
    expect(res.status).toBe(401);
  });

  it('404 si ouvrière inconnue', async () => {
    const srv = await demarrer();
    const res = await fetch(`${srv.url}/api/chambre/fantome`, { headers });
    expect(res.status).toBe(404);
  });

  it('sans baptême / métier / présence : null et listes vides — pas de théâtre', async () => {
    const srv = await demarrer();
    srv.store.registerNode({
      nodeId: 'n-1',
      name: 'claude-code',
      ownerName: 'hôte',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
    const res = await fetch(`${srv.url}/api/chambre/n-1`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bapteme: unknown;
      metier: unknown;
      presences: unknown[];
      tasks: unknown[];
      node: { nameTechnique: string };
      caste: string;
    };
    expect(body.bapteme).toBeNull();
    expect(body.metier).toBeNull();
    expect(body.presences).toEqual([]);
    expect(body.tasks).toEqual([]);
    expect(body.node.nameTechnique).toBe('claude-code');
    expect(typeof body.caste).toBe('string');
  });

  it('expose baptême, métier et présence constatés', async () => {
    const srv = await demarrer();
    srv.store.registerNode({
      nodeId: 'n-2',
      name: 'worker',
      ownerName: 'hôte',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    expect(srv.store.baptiser('n-2', 'Capucine', 1000)).toEqual({ ok: true, nom: 'Capucine' });
    expect(srv.store.assignerMetier('n-2', 'edite', 1001)).toEqual({
      ok: true,
      metier: 'edite',
    });
    expect(
      srv.store.remplacerPresences(
        'n-2',
        [{ toolUseId: 'toolu_1', chemin: 'src/a.ts', outil: 'Edit' }],
        't1',
        1002,
      ),
    ).toEqual({ ok: true });

    const res = await fetch(`${srv.url}/api/chambre/n-2`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bapteme: { nom: string };
      metier: { metier: string };
      presences: Array<{ chemin: string; outil: string }>;
    };
    expect(body.bapteme.nom).toBe('Capucine');
    expect(body.metier.metier).toBe('edite');
    expect(body.presences).toEqual([
      expect.objectContaining({ chemin: 'src/a.ts', outil: 'Edit' }),
    ]);
  });
});
