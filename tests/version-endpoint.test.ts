// LA ROUTE QUI DIT CE QUE LA RUCHE FAIT TOURNER.
//
// Le module pur sait formuler la réponse, le lecteur sait trouver le commit —
// et tant que personne n'appelle ni l'un ni l'autre, la ruche reste muette sur
// elle-même. C'est le § 2 tritrigies bis : un point d'entrée sans appelant est
// un point d'entrée MORT.
//
// Ce banc monte un vrai serveur et interroge la vraie route.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-version-endpoint-assez-long';

describe('GET /api/version', () => {
  let dir: string;
  let server: HiveServer;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-vers-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
  }, 30_000);

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('EXIGE LE JETON — le commit qu’on fait tourner dit ce qu’on n’a PAS corrigé', () => {
    // Ce n'est pas de la paranoïa de principe : connaître le commit exact d'une
    // ruche, c'est connaître la liste des correctifs de sécurité qu'elle n'a
    // pas encore. La route est donc derrière le jeton, comme le reste.
    return fetch(`${base}/api/version`).then((r) => {
      expect(r.status).toBe(401);
    });
  });

  it('RÉPOND CE QUE LA RUCHE FAIT TOURNER, POUR DE VRAI', async () => {
    const r = await fetch(`${base}/api/version`, { headers: { 'x-hive-token': TOKEN } });
    expect(r.status).toBe(200);
    const corps = (await r.json()) as {
      version: { commit: string | null; branche: string | null; declaree: string };
      pose: string;
      marche: string[][];
    };

    // Ce banc tourne DANS le dépôt : le commit doit donc être lu pour de bon.
    // Si un jour il tourne ailleurs (archive), `pose` vaudra « inconnue » et
    // les deux branches ci-dessous restent vraies — c'est voulu, la route ne
    // ment dans aucun des deux cas.
    if (corps.pose === 'git') {
      expect(corps.version.commit, 'un commit lu doit être un vrai sha').toMatch(/^[0-9a-f]{40}$/i);
      expect(corps.marche.length, 'une pose git reçoit une marche à suivre').toBeGreaterThan(0);
    } else {
      expect(corps.version.commit).toBeNull();
      expect(corps.marche, 'sans git, aucune commande proposée').toEqual([]);
    }
    // LA RACINE EST LA BONNE, et c'est mesuré.
    //
    // `declaree` est lue dans le `package.json` trouvé SOUS cette racine. Si
    // la racine pointait à côté, la lecture échouerait et la route répondrait
    // « inconnue » — sans jamais tomber. C'est justement ce qui rendait la
    // mutation « racine déplacée » invisible tant que ce banc acceptait
    // n'importe quelle chaîne non vide.
    expect(corps.version.declaree, 'la racine doit mener au vrai package.json').not.toBe(
      'inconnue',
    );
    expect(corps.version.declaree).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('LA MARCHE À SUIVRE PORTE LA SONDE QUI SAUVE LA BASE', async () => {
    const r = await fetch(`${base}/api/version`, { headers: { 'x-hive-token': TOKEN } });
    const corps = (await r.json()) as { pose: string; marche: string[][] };
    if (corps.pose !== 'git') return; // rien à vérifier hors clone
    const texte = corps.marche.map((c) => c.join(' '));
    expect(texte.some((c) => c.includes('better-sqlite3'))).toBe(true);
    expect(texte[0]).toContain('--ff-only');
  });

  it('LA ROUTE NE MODIFIE RIEN — deux appels rendent la même chose', async () => {
    // Une route de lecture qui bougerait quelque chose au passage serait la
    // pire des surprises. Deux appels, une seule réponse.
    const lire = async () =>
      (await (
        await fetch(`${base}/api/version`, { headers: { 'x-hive-token': TOKEN } })
      ).json()) as unknown;
    expect(JSON.stringify(await lire())).toBe(JSON.stringify(await lire()));
  });
});
