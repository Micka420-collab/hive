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

  it('GET /api/presences : 401 sans jeton ; curseurs avec baptême', async () => {
    const srv = await demarrer();
    expect((await fetch(`${srv.url}/api/presences`)).status).toBe(401);
    srv.store.registerNode({
      nodeId: 'n-3',
      name: 'w',
      ownerName: 'hôte',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    srv.store.baptiser('n-3', 'Iris', 1);
    srv.store.remplacerPresences(
      'n-3',
      [{ toolUseId: 't', chemin: 'src/x.ts', outil: 'Read' }],
      null,
      2,
    );
    const res = await fetch(`${srv.url}/api/presences`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      presences: Array<{ bapteme: string | null; chemin: string }>;
    };
    expect(body.presences).toEqual([
      expect.objectContaining({ bapteme: 'Iris', chemin: 'src/x.ts' }),
    ]);
  });

  it('GET /api/baptemes : 401 sans jeton ; liste constatée', async () => {
    const srv = await demarrer();
    expect((await fetch(`${srv.url}/api/baptemes`)).status).toBe(401);
    srv.store.registerNode({
      nodeId: 'n-b1',
      name: 'tech',
      ownerName: 'hôte',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    srv.store.baptiser('n-b1', 'Capucine', 1);
    const res = await fetch(`${srv.url}/api/baptemes`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      baptemes: Array<{ nodeId: string; nom: string }>;
    };
    expect(body.baptemes).toEqual([expect.objectContaining({ nodeId: 'n-b1', nom: 'Capucine' })]);
  });

  it('POST /api/baptemes et /api/metiers : la Reine nomme et assigne', async () => {
    const srv = await demarrer();
    srv.store.registerNode({
      nodeId: 'n-b2',
      name: 'tech',
      ownerName: 'hôte',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
    const bapt = await fetch(`${srv.url}/api/baptemes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nodeId: 'n-b2', nom: 'Violette' }),
    });
    expect(bapt.status).toBe(200);
    const met = await fetch(`${srv.url}/api/metiers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nodeId: 'n-b2', metier: 'edite' }),
    });
    expect(met.status).toBe(200);
    const ch = await fetch(`${srv.url}/api/chambre/n-b2`, { headers });
    const body = (await ch.json()) as {
      bapteme: { nom: string };
      metier: { metier: string };
    };
    expect(body.bapteme.nom).toBe('Violette');
    expect(body.metier.metier).toBe('edite');
    const collision = await fetch(`${srv.url}/api/baptemes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ nodeId: 'n-b2', nom: 'claude-code' }),
    });
    expect(collision.status).toBe(400);
  });

  it('réquisitions : ouvrir et répondre via API', async () => {
    const srv = await demarrer();
    srv.store.registerNode({
      nodeId: 'n-4',
      name: 'w',
      ownerName: 'hôte',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const cree = await fetch(`${srv.url}/api/requisitions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        nodeId: 'n-4',
        genre: 'cle_api',
        libelle: 'Clé Seedance',
      }),
    });
    expect(cree.status).toBe(200);
    const { id } = (await cree.json()) as { id: string };
    const chambre = await fetch(`${srv.url}/api/chambre/n-4`, { headers });
    const corps = (await chambre.json()) as { requisitions: unknown[] };
    expect(corps.requisitions).toHaveLength(1);
    const rep = await fetch(`${srv.url}/api/requisitions/${id}/repondre`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'accordee', secret: 'sk-test-seedance' }),
    });
    expect(rep.status).toBe(200);
    const corpsRep = (await rep.json()) as { envVar?: string };
    expect(corpsRep.envVar).toBe('SEEDANCE_API_KEY');
  });

  it('expose horizon + fabriques du projet dominant (sinon null / [])', async () => {
    const srv = await demarrer();
    srv.store.registerNode({
      nodeId: 'n-5',
      name: 'w',
      ownerName: 'hôte',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    const sans = await fetch(`${srv.url}/api/chambre/n-5`, { headers });
    const corpsSans = (await sans.json()) as {
      projectId: string | null;
      horizon: unknown;
      fabriques: unknown[];
    };
    expect(corpsSans.projectId).toBeNull();
    expect(corpsSans.horizon).toBeNull();
    expect(corpsSans.fabriques).toEqual([]);

    const p = srv.store.createProject({ name: 'Chambre horizon' });
    const tache = srv.store.createTask({
      projectId: p.id,
      title: 'Édite le pont',
      prompt: 'prompt',
    });
    srv.store.patchTask(tache.id, { assignedNodeId: 'n-5', status: 'running' });
    expect(srv.store.ajouterHorizon(p.id, 'fait', 'Le pont compile', 'test').ok).toBe(true);
    expect(
      srv.store.ouvrirFabrique(p.id, 'script_npm', 'Script lint', { nomScript: 'lint' }).ok,
    ).toBe(true);

    const avec = await fetch(`${srv.url}/api/chambre/n-5`, { headers });
    const corps = (await avec.json()) as {
      projectId: string;
      horizon: { faits: Array<{ texte: string }>; hypotheses: unknown[] };
      fabriques: Array<{ libelle: string }>;
    };
    expect(corps.projectId).toBe(p.id);
    expect(corps.horizon.faits.some((f) => f.texte.includes('pont'))).toBe(true);
    expect(corps.fabriques.some((f) => f.libelle.includes('lint'))).toBe(true);
  });
});
