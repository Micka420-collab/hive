// L'AGENT GARDE-FOUS AU TABLEAU DE BORD (endpoints server, lot G5a).
//
// Deux gestes, comme le Plein Essaim : LIRE (l'état — consentement + ce que la
// ruche a appris, échelon par échelon) et RÉGLER (l'opt-in + les bornes, geste
// HUMAIN). Le POST valide les bornes contre l'échelle : seul un échelon connu
// entre. Le GET rend l'ÉLU (le premier du classement) et le classement complet,
// pour que l'écran explique POURQUOI tel échelon gouverne.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Echelon } from '../src/orchestrator/garde-fou.js';
import type { Verdict } from '../src/orchestrator/gardiennes.js';

const TOKEN = 'jeton-garde-fou-endpoint-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

describe('Garde-Fous au tableau de bord — /api/projects/:id/garde-fou', () => {
  let srv: HiveServer;
  let dir: string;
  let base: string;

  beforeEach(async () => {
    delete process.env.HIVE_RUNNER;
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-gf-api-'));
    srv = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
    });
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterEach(async () => {
    await srv.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const projet = (): string => srv.store.createProject({ name: 'P', repoUrl: null }).id;
  const lire = (p: string): Promise<Response> =>
    fetch(`${base}/api/projects/${p}/garde-fou`, { headers });
  const regler = (p: string, corps: unknown): Promise<Response> =>
    fetch(`${base}/api/projects/${p}/garde-fou`, {
      method: 'POST',
      headers,
      body: JSON.stringify(corps),
    });

  /** Du vécu GLOBAL sous un échelon, pour que le classement ait de quoi trancher. */
  function vecu(echelon: Echelon, verdict: Verdict, exigee: boolean, n: number): void {
    const p = srv.store.createProject({ name: 'vecu', repoUrl: null }).id;
    for (let i = 0; i < n; i++) {
      const t = srv.store.createTask({ projectId: p, title: 'x', prompt: 'y' }).id;
      srv.store.poserEchelonGardeFou(t, echelon, 1_000 + i);
      srv.store.enregistrerInspection({
        resultId: i + 1,
        taskId: t,
        nodeId: 'v',
        verdict,
        score: 0,
        applique: false,
        griefs: [],
      });
      srv.store.poserExigenceGardeFou(t, exigee);
      srv.store.patchTask(t, { status: 'done' });
    }
  }

  it('un projet non opt-in : inactif, aucun classement, mais l’échelle est décrite', async () => {
    const rep = await lire(projet());
    expect(rep.status).toBe(200);
    const etat = (await rep.json()) as Record<string, unknown>;
    expect(etat.actif).toBe(false);
    expect(etat.echelonElu).toBeNull();
    expect(etat.classement).toEqual([]);
    expect(etat.echelons).toEqual(['leger', 'standard', 'strict']);
  });

  it('RÉGLER puis LIRE : l’opt-in et les bornes reviennent, l’élu à froid est le strict', async () => {
    const p = projet();
    const post = await regler(p, { actif: true, borneMin: 'leger', borneMax: 'strict' });
    expect(post.status).toBe(200);
    expect(((await post.json()) as Record<string, unknown>).echelonElu).toBe('strict');

    const etat = (await (await lire(p)).json()) as Record<string, unknown>;
    expect(etat.actif).toBe(true);
    expect(etat.bornes).toEqual({ min: 'leger', max: 'strict' });
    expect(etat.definiPar).toBe('humain');
    expect(etat.echelonElu, 'à froid, +∞ partout → le plus strict').toBe('strict');
  });

  it('le classement REFLÈTE le vécu : l’échelon au meilleur compromis passe élu', async () => {
    vecu('leger', 'clean', false, 12); // directe, q=1 → r=1
    vecu('standard', 'suspect', true, 12); // en_attente → r bas
    vecu('strict', 'hollow', true, 12); // en_attente, q=0 → r=0
    const p = projet();
    await regler(p, { actif: true, borneMin: 'leger', borneMax: 'strict' });
    const etat = (await (await lire(p)).json()) as {
      echelonElu: string;
      classement: { echelon: string; essais: number }[];
    };
    expect(etat.echelonElu).toBe('leger');
    expect(etat.classement[0]?.echelon).toBe('leger');
    expect(
      etat.classement.every((r) => r.essais > 0),
      'tous éprouvés',
    ).toBe(true);
  });

  it('une borne HORS échelle est refusée par le schéma (400)', async () => {
    const rep = await regler(projet(), { actif: true, borneMin: 'leger', borneMax: 'béton-armé' });
    expect(rep.status).toBe(400);
  });

  it('projet inconnu : 404 en lecture comme en écriture', async () => {
    expect((await lire('inexistant')).status).toBe(404);
    expect(
      (await regler('inexistant', { actif: true, borneMin: 'leger', borneMax: 'strict' })).status,
    ).toBe(404);
  });
});
