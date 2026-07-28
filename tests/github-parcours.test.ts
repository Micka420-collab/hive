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

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as creerHttp } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    // Ce test a bloqué à 30 000 ms EXACTEMENT sur la première CI Windows — pas
    // 29, pas 31 : le plafond au millième près. Ce n'était donc pas de la
    // lenteur, mais une attente sans fin : git y attendait des identifiants via
    // Git Credential Manager, que `GIT_TERMINAL_PROMPT=0` ne gouverne pas.
    // La cause est corrigée dans le miroir ; le délai par défaut revient, parce
    // qu'un délai rallongé n'aurait fait que retarder le même blocage.
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

// ─── CONNECTER DEPUIS LE TABLEAU DE BORD ────────────────────────────────────
//
// Jusqu'ici, connecter un dépôt se faisait EN LIGNE DE COMMANDE : les deux
// routes vivaient sans aucun écran, alors que c'est le tout premier geste de
// quelqu'un qui arrive avec du code existant.
//
// Et l'import s'authentifiant par le jeton de RUCHE, il n'avait personne à qui
// attribuer le dépôt : le projet naissait orphelin, donc inutilisable par son
// importateur (il fallait qu'un administrateur l'adopte d'abord). Le tableau de
// bord, lui, présente toujours un compte — autant s'en servir.

describe('connecter un dépôt depuis un COMPTE', () => {
  let faux2: Server;
  let server2: HiveServer;
  let dir2: string;
  let base2: string;
  let jetonMembre2 = '';
  let idMembre2 = '';
  let avant2: string | undefined;
  let avantApi2: string | undefined;

  beforeAll(async () => {
    faux2 = creerHttp((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      const corps =
        u.pathname === '/user/repos'
          ? JSON.stringify([DEPOT])
          : u.pathname === `/repos/${DEPOT.full_name}`
            ? JSON.stringify(DEPOT)
            : null;
      res.writeHead(corps ? 200 : 404, { 'content-type': 'application/json' });
      res.end(corps ?? '{"message":"Not Found"}');
    });
    await new Promise<void>((r) => faux2.listen(0, '127.0.0.1', r));
    const port2 = (faux2.address() as { port: number }).port;

    avant2 = process.env.HIVE_GITHUB_TOKEN;
    avantApi2 = process.env.HIVE_GITHUB_API;
    process.env.HIVE_GITHUB_TOKEN = JETON_GH;
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${port2}`;

    dir2 = mkdtempSync(path.join(os.tmpdir(), 'hive-ghc-'));
    server2 = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir2, 'data', 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base2 = `http://127.0.0.1:${server2.port}`;
    // Le premier compte absorbe l'amorçage administrateur : celui qu'on suit
    // doit être un membre ORDINAIRE, sinon `voir_tous_les_projets` masquerait
    // le défaut et le test passerait pour de mauvaises raisons.
    await fetch(`${base2}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@ghc.test',
        password: 'motdepasse-assez-long-42',
        displayName: 'Admin',
      }),
    });
    const r = await fetch(`${base2}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'lea@ghc.test',
        password: 'motdepasse-assez-long-42',
        displayName: 'Léa',
      }),
    });
    jetonMembre2 = ((await r.json()) as { token: string }).token;
    const moi = (await (
      await fetch(`${base2}/api/auth/me`, {
        headers: { authorization: `Bearer ${jetonMembre2}` },
      })
    ).json()) as { id: string; role?: string };
    idMembre2 = moi.id;
    expect(moi.role, 'celui qu’on suit ne doit PAS être administrateur').not.toBe('admin');
  });

  afterAll(async () => {
    await server2.stop();
    await new Promise<void>((r) => faux2.close(() => r()));
    rmSync(dir2, { recursive: true, force: true });
    if (avant2 === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = avant2;
    if (avantApi2 === undefined) delete process.env.HIVE_GITHUB_API;
    else process.env.HIVE_GITHUB_API = avantApi2;
  });

  const commeMembre = () => ({
    'content-type': 'application/json',
    'x-hive-token': TOKEN,
    authorization: `Bearer ${jetonMembre2}`,
  });

  it('LE DÉPÔT CONNECTÉ APPARTIENT À CELLE QUI L’A CONNECTÉ', async () => {
    const res = await fetch(`${base2}/api/github/import`, {
      method: 'POST',
      headers: commeMembre(),
      body: JSON.stringify({ fullName: 'micka/ma-ruche' }),
    });
    expect(res.status).toBe(201);
    const { projet } = (await res.json()) as { projet: { id: string; ownerId: string | null } };
    expect(projet.ownerId).toBe(idMembre2);
  });

  it('…ET ELLE PEUT S’EN SERVIR TOUT DE SUITE, sans passer par une adoption', async () => {
    // Ce test a bloqué à 30 000 ms EXACTEMENT sur la première CI Windows — pas
    // 29, pas 31 : le plafond au millième près. Ce n'était donc pas de la
    // lenteur, mais une attente sans fin : git y attendait des identifiants via
    // Git Credential Manager, que `GIT_TERMINAL_PROMPT=0` ne gouverne pas.
    // La cause est corrigée dans le miroir ; le délai par défaut revient, parce
    // qu'un délai rallongé n'aurait fait que retarder le même blocage.
    const id = server2.store.listProjects()[0]!.id;
    for (const route of [`/api/projects/${id}/rayon`, `/api/projects/${id}/members`]) {
      const res = await fetch(`${base2}${route}`, { headers: commeMembre() });
      expect(res.status, route).not.toBe(404);
    }
    // Et elle est inscrite comme propriétaire, pas seulement porteuse du champ.
    const membres = (await (
      await fetch(`${base2}/api/projects/${id}/members`, { headers: commeMembre() })
    ).json()) as { userId: string; role: string }[];
    expect(membres.find((m) => m.userId === idMembre2)?.role).toBe('owner');
  });

  it('L’ÉCRAN EXISTE — les deux routes ne sont plus réservées à la ligne de commande', () => {
    const brut = readFileSync(
      fileURLToPath(new URL('../dashboard/src/views/Projets.tsx', import.meta.url)),
      'utf8',
    );
    const code = brut.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');
    expect(code).toContain('fetchDepotsGithub');
    expect(code).toContain('importerDepotGithub');
  });

  it('L’ÉCRAN NE DEMANDE JAMAIS LE JETON GITHUB', () => {
    // Il vit dans l'environnement de l'orchestrateur, en mémoire. Un champ
    // « collez votre jeton » en ferait une valeur qui traverse le navigateur,
    // l'historique et le presse-papiers — pour un gain nul, puisque c'est
    // l'orchestrateur qui appelle GitHub, pas le navigateur.
    const brut = readFileSync(
      fileURLToPath(new URL('../dashboard/src/views/Projets.tsx', import.meta.url)),
      'utf8',
    );
    const code = brut.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');
    expect(code).not.toMatch(/HIVE_GITHUB_TOKEN|githubToken|jetonGithub/);
  });
});
