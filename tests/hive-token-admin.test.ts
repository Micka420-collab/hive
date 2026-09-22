// Le jeton de ruche identifie un nœud ; il ne donne pas les privilèges de
// l'administrateur qui agit sur l'hôte ou sur les credentials de la ruche.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-partage-ne-doit-pas-administrer';
const json = { 'content-type': 'application/json' };

describe('frontière HIVE_TOKEN / administration', () => {
  let server: HiveServer | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await server?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    server = undefined;
    dir = undefined;
  });

  async function démarrer(): Promise<{
    base: string;
    tokenAdmin: string;
    tokenMembre: string;
    hive: Record<string, string>;
  }> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-token-admin-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      envPath: path.join(dir, '.env'),
      simulation: true,
      tickMs: 60,
    });
    const base = server.url;
    const register = async (email: string): Promise<string> => {
      const res = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'mot-de-passe-test', displayName: email }),
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { token: string }).token;
    };
    return {
      base,
      tokenAdmin: await register('admin@hive.test'),
      tokenMembre: await register('membre@hive.test'),
      hive: { ...json, 'x-hive-token': TOKEN },
    };
  }

  it('refuse le jeton partagé seul sur chaque capacité globale sensible', async () => {
    const { base, hive } = await démarrer();
    const cases: Array<[string, RequestInit]> = [
      ['/api/atelier/demarrer', { method: 'POST', body: '{}' }],
      [
        '/api/queen/cles',
        {
          method: 'POST',
          body: JSON.stringify({ secret: 'sk-test', envVar: 'OPENROUTER_API_KEY' }),
        },
      ],
      ['/api/invite', {}],
      ['/api/billets', { method: 'POST', body: '{}' }],
      ['/api/membres', {}],
      ['/api/membres/n-1', { method: 'DELETE' }],
      ['/api/billets/b-1', { method: 'DELETE' }],
      ['/api/nodes/n-1/outils/npm/poser', { method: 'POST' }],
      ['/api/baptemes', { method: 'POST', body: JSON.stringify({ nodeId: 'n-1', nom: 'Iris' }) }],
      [
        '/api/metiers',
        { method: 'POST', body: JSON.stringify({ nodeId: 'n-1', metier: 'edite' }) },
      ],
      [
        '/api/requisitions/r-1/repondre',
        { method: 'POST', body: JSON.stringify({ decision: 'refusee' }) },
      ],
    ];
    for (const [route, init] of cases) {
      const res = await fetch(`${base}${route}`, { ...init, headers: hive });
      expect(res.status, route).toBe(401);
    }
  });

  it('refuse le compte membre et accepte le compte admin', async () => {
    const { base, tokenAdmin, tokenMembre, hive } = await démarrer();
    const membre = { ...hive, authorization: `Bearer ${tokenMembre}` };
    const admin = { ...hive, authorization: `Bearer ${tokenAdmin}` };

    const membreVue = await fetch(`${base}/api/membres`, { headers: membre });
    expect(membreVue.status).toBe(403);
    const membreAtelier = await fetch(`${base}/api/atelier/demarrer`, {
      method: 'POST',
      headers: membre,
      body: '{}',
    });
    expect(membreAtelier.status).toBe(403);

    const adminVue = await fetch(`${base}/api/membres`, { headers: admin });
    expect(adminVue.status).toBe(200);
    // L'authentification admin passe ; le mode désactivé reste la décision
    // fonctionnelle suivante et empêche réellement tout compose sur l'hôte.
    const adminAtelier = await fetch(`${base}/api/atelier/demarrer`, {
      method: 'POST',
      headers: admin,
      body: '{}',
    });
    expect(adminAtelier.status).toBe(403);
    expect(((await adminAtelier.json()) as { error: string }).error).toContain('HIVE_ATELIER=off');
  });
});
