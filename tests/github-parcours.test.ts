// Le parcours COMPLET du connecteur GitHub : importer, puis s'en servir.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// `github-endpoints.test.ts` éprouve chaque route séparément, et toutes
// passaient. Le connecteur était pourtant cassé — mais entre deux routes, là
// où aucun test ne regardait.
//
// `POST /api/github/import` s'authentifie par le JETON DE RUCHE, pas par un
// compte. Il n'a donc personne à qui attribuer le projet, et le crée
// `visibility: 'private'`, `ownerId: null`. Une fois le contrôle d'accès posé
// sur les projets, ce projet-là n'était lisible par PERSONNE : ni par
// l'administrateur, ni par qui que ce soit. Il existait, des tâches pouvaient
// tourner dessus, et aucun humain ne pouvait en ouvrir le code.
//
// Aucun test unitaire ne pouvait le voir, parce que le défaut n'est dans aucune
// route : il est dans le TRAJET. D'où ce fichier, qui fait le trajet.
//
// ─── LE FAUX GITHUB ──────────────────────────────────────────────────────────
//
// Un vrai jeton GitHub ne peut pas vivre dans une suite de tests, et dépendre
// du réseau rendrait la CI rouge un jour sur dix pour des raisons qui ne nous
// regardent pas. `HIVE_GITHUB_API` existe déjà pour GitHub Enterprise : on s'en
// sert pour pointer sur un serveur local qui répond comme GitHub.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as creerHttp } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-parcours-github-assez-long';
const JETON_GH = 'jeton-github-de-test';

const DEPOT = {
  id: 1,
  full_name: 'micka/ma-ruche',
  name: 'ma-ruche',
  private: false,
  clone_url: 'https://github.com/micka/ma-ruche.git',
  html_url: 'https://github.com/micka/ma-ruche',
  description: 'La ruche',
  default_branch: 'main',
  pushed_at: '2026-07-01T00:00:00Z',
  stargazers_count: 3,
  language: 'TypeScript',
  archived: false,
  fork: false,
};

describe('connecter un dépôt GitHub à la ruche, de bout en bout', () => {
  let faux: Server;
  let portFaux = 0;
  let server: HiveServer;
  let dir: string;
  let base: string;
  let jetonAdmin = '';
  let jetonMembre = '';
  let avant: string | undefined;
  let avantApi: string | undefined;

  const inscrire = async (email: string): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: 'Abeille' }),
    });
    return ((await res.json()) as { token?: string }).token ?? '';
  };

  beforeAll(async () => {
    faux = creerHttp((req, res) => {
      if (req.headers.authorization !== `Bearer ${JETON_GH}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end('{"message":"Bad credentials"}');
        return;
      }
      const u = new URL(req.url ?? '/', 'http://x');
      if (u.pathname === '/user/repos') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([DEPOT]));
        return;
      }
      if (u.pathname === `/repos/${DEPOT.full_name}`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(DEPOT));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"message":"Not Found"}');
    });
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
    portFaux = (faux.address() as { port: number }).port;

    avant = process.env.HIVE_GITHUB_TOKEN;
    avantApi = process.env.HIVE_GITHUB_API;
    process.env.HIVE_GITHUB_TOKEN = JETON_GH;
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${portFaux}`;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-ghp-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'data', 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    // Le PREMIER compte est administrateur (amorçage) ; le second ne l'est pas.
    jetonAdmin = await inscrire('la-reine@exemple.test');
    jetonMembre = await inscrire('une-abeille@exemple.test');
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((r) => faux.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
    if (avant === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = avant;
    if (avantApi === undefined) delete process.env.HIVE_GITHUB_API;
    else process.env.HIVE_GITHUB_API = avantApi;
  });

  const hive = { 'x-hive-token': TOKEN, 'content-type': 'application/json' };

  it('la liste des dépôts arrive', async () => {
    const res = await fetch(`${base}/api/github/repos`, { headers: hive });
    expect(res.status).toBe(200);
    const c = (await res.json()) as { depots: { fullName: string; importe: boolean }[] };
    expect(c.depots.map((d) => d.fullName)).toContain('micka/ma-ruche');
    expect(c.depots[0]?.importe, 'rien n’est encore importé').toBe(false);
  });

  it('l’import crée le projet', async () => {
    const res = await fetch(`${base}/api/github/import`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ fullName: 'micka/ma-ruche' }),
    });
    expect(res.status).toBe(201);
    const { projet } = (await res.json()) as { projet: { id: string; repoUrl: string } };
    expect(projet.repoUrl).toBe(DEPOT.clone_url);
  });

  it('LE PROJET IMPORTÉ EST LISIBLE PAR L’ADMINISTRATEUR', async () => {
    // LE test de ce fichier. Un projet importé est privé ET sans propriétaire :
    // sans que le rôle soit consulté, il n'était lisible par personne, et la
    // fonctionnalité entière était morte sans qu'aucun test ne le dise.
    const id = server.store.listProjects()[0]!.id;
    for (const route of [
      `/api/projects/${id}/rayon`,
      `/api/projects/${id}/members`,
      `/api/projects/${id}/partages`,
    ]) {
      const res = await fetch(`${base}${route}`, {
        headers: { authorization: `Bearer ${jetonAdmin}` },
      });
      // 200 pour les deux dernières ; le rayon peut répondre 409 si le clone
      // du dépôt distant échoue (il pointe sur un github.com inatteignable en
      // test) — ce qui est un autre sujet, et surtout PAS un 404 d'accès.
      expect(res.status, route).not.toBe(404);
      expect(res.status, route).not.toBe(401);
    }
  });

  it('…et un membre ordinaire ne le lit pas pour autant', async () => {
    // Le droit vient du RÔLE. Si l'absence de propriétaire suffisait, tout
    // projet importé serait public de fait.
    const id = server.store.listProjects()[0]!.id;
    const res = await fetch(`${base}/api/projects/${id}/members`, {
      headers: { authorization: `Bearer ${jetonMembre}` },
    });
    expect(res.status).toBe(404);
  });

  it('réimporter le même dépôt est refusé, avec le projet existant nommé', async () => {
    // Deux projets Hive sur le même dépôt, c'est deux plans de merge
    // concurrents sur les mêmes fichiers.
    const res = await fetch(`${base}/api/github/import`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ fullName: 'micka/ma-ruche' }),
    });
    expect(res.status).toBe(409);
    const c = (await res.json()) as { projectId: string; nom: string };
    expect(c.projectId).toBeTruthy();
    expect(c.nom).toBe('micka/ma-ruche');
  });

  it('la liste marque désormais le dépôt comme importé', async () => {
    const res = await fetch(`${base}/api/github/repos`, { headers: hive });
    const c = (await res.json()) as { depots: { importe: boolean }[] };
    expect(c.depots[0]?.importe).toBe(true);
  });

  it('un dépôt inexistant dit quoi faire, pas seulement « 404 »', async () => {
    const res = await fetch(`${base}/api/github/import`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ fullName: 'micka/jamais-existe' }),
    });
    expect(res.status).toBe(502);
    const c = (await res.json()) as { detail: string };
    expect(c.detail.length, 'un refus sans marche à suivre ne sert à rien').toBeGreaterThan(20);
  });

  it('LE JETON GITHUB NE SORT JAMAIS DANS UNE RÉPONSE', async () => {
    // Il est à l'hôte, et rien de ce qu'on renvoie n'a besoin de lui.
    for (const route of ['/api/github/repos']) {
      const texte = await (await fetch(`${base}${route}`, { headers: hive })).text();
      expect(texte).not.toContain(JETON_GH);
    }
  });
});
