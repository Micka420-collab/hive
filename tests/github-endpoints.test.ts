// Connecter ses dépôts GitHub, vu du dehors.
//
// Le cas le plus important n'est PAS le parcours nominal : c'est l'absence de
// jeton. C'est l'état par défaut de toute ruche, et une fonctionnalité qui y
// rend un 500 opaque n'est jamais adoptée — l'utilisateur croit qu'elle est
// cassée, pas qu'elle attend une configuration.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-github-assez-long-pour-passer';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer;
let dir: string;
let base: string;

async function demarrer(): Promise<void> {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-gh-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'gh.db'),
    simulation: false,
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
}

afterEach(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  delete process.env.HIVE_GITHUB_TOKEN;
});

describe('sans jeton — l’état par défaut de toute ruche', () => {
  beforeEach(async () => {
    delete process.env.HIVE_GITHUB_TOKEN;
    await demarrer();
  });

  it('IGNORE un GITHUB_TOKEN d’ambiance — un secret se donne explicitement', async () => {
    // Constaté en exécutant : GITHUB_TOKEN est partout (GitHub Actions le pose
    // d'office, beaucoup d'outils aussi). S'en servir enverrait à api.github.com
    // un jeton que l'utilisateur n'a pas choisi de donner à Hive, et rendrait un
    // « jeton refusé » incompréhensible à qui n'a rien configuré.
    process.env.GITHUB_TOKEN = 'ghp_dun_autre_outil';
    await server.stop();
    await demarrer();
    delete process.env.GITHUB_TOKEN;
    expect((await fetch(`${base}/api/github/repos`, { headers })).status).toBe(501);
  });

  it('répond 501 en DISANT quoi faire, pas un 500 opaque', async () => {
    const r = await fetch(`${base}/api/github/repos`, { headers });
    expect(r.status).toBe(501);
    const j = (await r.json()) as { error: string; detail: string };
    expect(j.detail).toContain('HIVE_GITHUB_TOKEN');
    expect(j.detail).toMatch(/settings\/tokens/);
    // Et rappelle la propriété qui rassure : rien n'est écrit en base.
    expect(j.detail).toMatch(/jamais écrit en base/i);
  });

  it('l’import répond pareil, plutôt que d’échouer plus loin', async () => {
    const r = await fetch(`${base}/api/github/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fullName: 'a/b' }),
    });
    expect(r.status).toBe(501);
  });

  it('les deux routes exigent le token de la ruche AVANT tout', async () => {
    expect((await fetch(`${base}/api/github/repos`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/github/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fullName: 'a/b' }),
        })
      ).status,
    ).toBe(401);
  });
});

describe('avec un jeton — mais GitHub injoignable', () => {
  beforeEach(async () => {
    // Un jeton bidon : l'API GitHub n'est pas jointe depuis les tests, donc
    // l'appel échoue au réseau. C'est exactement le cas « mauvaise config »
    // qu'un utilisateur rencontrera, et il doit rester lisible.
    process.env.HIVE_GITHUB_TOKEN = 'ghp_bidon_pour_test';
    process.env.HIVE_GITHUB_API = 'http://127.0.0.1:1/api';
    await demarrer();
  });

  afterEach(() => {
    delete process.env.HIVE_GITHUB_API;
  });

  it('rend un 502 nommé, jamais une trace de pile', async () => {
    const r = await fetch(`${base}/api/github/repos`, { headers });
    expect(r.status).toBe(502);
    const j = (await r.json()) as { error: string; detail: string };
    expect(j.error).toMatch(/injoignable|GitHub/i);
    expect(j.detail.length).toBeGreaterThan(10);
  });

  it('ne laisse JAMAIS fuir le jeton dans la réponse', async () => {
    // Une réponse d'erreur finit dans un rapport de bogue, une capture d'écran,
    // un canal de support. Le jeton n'a rien à y faire.
    const r = await fetch(`${base}/api/github/repos`, { headers });
    expect(await r.text()).not.toContain('ghp_bidon_pour_test');
  });

  it('un nom de dépôt mal formé est refusé en 400, sans appel réseau', async () => {
    const r = await fetch(`${base}/api/github/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fullName: '../../etc/passwd' }),
    });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { detail: string }).detail).toMatch(/owner\/repo/);
  });

  it('le schéma refuse un corps sans nom de dépôt', async () => {
    for (const corps of ['{}', '{"fullName":""}']) {
      const r = await fetch(`${base}/api/github/import`, { method: 'POST', headers, body: corps });
      expect(r.status, corps).toBe(400);
    }
  });

  it('un champ INCONNU est retiré, pas honoré — et surtout pas un 500', async () => {
    // Fastify retire les propriétés hors schéma (`removeAdditional`, actif par
    // défaut) plutôt que de refuser la requête. C'est sûr — le champ est
    // supprimé avant d'atteindre le code, donc rien ne peut être passé en
    // contrebande — mais ce n'est PAS un 400, contrairement à ce qu'on croit
    // spontanément en lisant `additionalProperties: false`.
    //
    // On l'asserte explicitement : c'est la même famille de surprise que la
    // coercition AJV qui transformait `false` en plafond 0 (PR #19). Le
    // comportement par défaut d'AJV mérite d'être verrouillé, pas supposé.
    const r = await fetch(`${base}/api/github/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fullName: 'moi/projet', extra: 'ignoré' }),
    });
    expect(r.status).toBe(502); // la requête a poursuivi jusqu'à l'appel réseau
    expect(r.status).not.toBe(500);
  });
});
