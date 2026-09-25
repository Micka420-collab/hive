// Le relais OpenAlex est réservé à la ruche : un inconnu ne fait partir AUCUNE
// requête vers api.openalex.org depuis le serveur de l'opérateur.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// `/api/openalex/search` était « accessible sans auth ». Sur une ruche Cloud
// publique, n'importe qui faisait partir des requêtes vers api.openalex.org
// depuis le serveur de l'opérateur, avec son adresse `mailto:` s'il l'a posée.
//
// OpenAlex n'est jamais joint pour de vrai : le `fetch` sortant du serveur est
// intercepté (la Reine tourne dans ce processus), les appels vers la Reine
// elle-même passent tels quels.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-openalex-suffisamment-long';

describe('le relais OpenAlex — réservé à la ruche', () => {
  let serveur: HiveServer;
  let dossier: string;
  let base: string;
  const appelsOpenAlex: string[] = [];
  const vraiFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (entree, init) => {
      const url =
        typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
      if (url.startsWith('https://api.openalex.org/')) {
        appelsOpenAlex.push(url);
        return new Response(
          JSON.stringify({ results: [], meta: { count: 0, page: 1, per_page: 20 } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return vraiFetch(entree, init);
    });
    dossier = mkdtempSync(path.join(os.tmpdir(), 'openalex-relais-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${serveur.port}`;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await serveur.stop();
    rmSync(dossier, { recursive: true, force: true });
  });

  beforeEach(() => {
    appelsOpenAlex.length = 0;
  });

  it('UN INCONNU EST REFUSÉ — et rien ne part vers OpenAlex', async () => {
    const r = await fetch(`${base}/api/openalex/search?q=abeilles`);
    expect(r.status).toBe(401);
    expect(appelsOpenAlex, 'la Reine a relayé pour un inconnu').toEqual([]);
  });

  it('LE JETON DE RUCHE OUVRE LE RELAIS', async () => {
    const r = await fetch(`${base}/api/openalex/search?q=abeilles`, {
      headers: { 'x-hive-token': JETON },
    });
    expect(r.status).toBe(200);
    expect(appelsOpenAlex).toHaveLength(1);
    expect(appelsOpenAlex[0]).toContain('search=abeilles');
  });

  it('UN COMPTE CONNECTÉ L’OUVRE AUSSI — sans le jeton de ruche', async () => {
    const inscription = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'chercheuse@exemple.fr',
        password: 'Une-phrase-de-passe-solide-42',
        displayName: 'Chercheuse',
      }),
    });
    expect(inscription.status).toBe(200);
    const { token } = (await inscription.json()) as { token: string };
    const r = await fetch(`${base}/api/openalex/search?q=pollinisation`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(200);
    expect(appelsOpenAlex).toHaveLength(1);
  });

  it('UN FAUX JETON N’OUVRE RIEN', async () => {
    const r = await fetch(`${base}/api/openalex/search?q=abeilles`, {
      headers: { 'x-hive-token': 'pas-le-bon-jeton-du-tout', authorization: 'Bearer faux.jwt.x' },
    });
    expect(r.status).toBe(401);
    expect(appelsOpenAlex).toEqual([]);
  });
});
