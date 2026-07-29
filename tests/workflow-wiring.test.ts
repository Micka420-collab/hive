// Les workflows GitHub, BRANCHÉS : la ruche peut vraiment en lancer un.
//
// ─── LA DÉCISION QUE CE FICHIER GARDE ────────────────────────────────────────
//
// Un chantier SORTANT — publier, déployer, démarrer — n'est pas lançable par la
// route locale : elle ne peut pas prouver qu'un humain est derrière. On pourrait
// croire que lancer un workflow tombe sous la même règle. Il tourne dehors, il
// peut déployer, il consomme des minutes.
//
// Ce qui le distingue tient en une ligne de YAML : `on: workflow_dispatch:`.
//
// C'est le propriétaire du dépôt qui l'écrit, dans le dépôt. Ce n'est pas une
// CAPACITÉ que la ruche découvre, c'est une PERMISSION que le dépôt déclare —
// et GitHub la fait respecter lui-même : un workflow qui ne la porte pas répond
// 422 quoi qu'on demande. C'est la forme la plus forte de « la ruche exécute ce
// que le DÉPÔT déclare » qu'on puisse trouver.
//
// ─── ET LA RUCHE NE CHOISIT TOUJOURS PAS LIBREMENT ───────────────────────────
//
// Seulement dans la liste que l'API vient de rendre, par identifiant NUMÉRIQUE.
// Jamais par un nom de fichier — ce segment d'URL accepte les deux côté GitHub,
// et accepter le nom laisserait écrire un morceau d'URL de son API, avec le
// jeton de l'hôte.

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fullNameDepuisUrl } from '../src/orchestrator/github.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-workflow-wiring-assez-long-pour-passer';

describe('DE L’URL D’UN PROJET AU DÉPÔT GITHUB', () => {
  // ─── POURQUOI CE BLOC EXISTE ───────────────────────────────────────────────
  //
  // Un projet Hive ne garde qu'un `repoUrl` ; l'API GitHub ne connaît que
  // `owner/repo`. Le pont entre les deux est exactement l'endroit où l'on écrit
  // un `split('/')` en passant, et où les cas particuliers s'accumulent en
  // silence pendant des mois.

  it('les formes qu’on colle vraiment', () => {
    for (const url of [
      'https://github.com/Micka420-collab/hive.git',
      'https://github.com/Micka420-collab/hive',
      'https://github.com/Micka420-collab/hive/',
      'git@github.com:Micka420-collab/hive.git',
      'ssh://git@github.com/Micka420-collab/hive.git',
      // Une URL de navigateur : on colle ce qu'on a sous les yeux.
      'https://github.com/Micka420-collab/hive/tree/main',
      '  https://github.com/Micka420-collab/hive.git  ',
    ]) {
      expect(fullNameDepuisUrl(url), url).toBe('Micka420-collab/hive');
    }
  });

  it('UN CHEMIN LOCAL N’EST PAS UN DÉPÔT GITHUB', () => {
    // Le cas des tests et des démos. Rendre autre chose que `null` enverrait
    // une requête à api.github.com pour un dossier sur un disque.
    for (const url of ['/tmp/mon-depot', 'C:\\Users\\moi\\depot', './relatif', '']) {
      expect(fullNameDepuisUrl(url), JSON.stringify(url)).toBeNull();
    }
  });

  it('une URL incomplète ou hostile rend null', () => {
    for (const url of [
      'https://github.com/seul-proprietaire',
      'https://github.com/',
      'pas une url',
      'ext::sh -c whoami',
      // ─── `new URL` NORMALISE, ET LE TEST L'A TROUVÉ ──────────────────────
      //
      // `new URL('https://github.com/../../etc/passwd').pathname` rend
      // `/etc/passwd` : les `..` sont RÉSOLUS. La fonction rendait donc
      // `etc/passwd`, un `owner/repo` parfaitement bien formé désignant un
      // dépôt que personne n'a nommé. Pas une traversée — pire à sa façon :
      // une fonction qui INVENTE un nom plausible.
      'https://github.com/../../etc/passwd',
    ]) {
      expect(fullNameDepuisUrl(url), url).toBeNull();
    }
  });

  it('CE QUI SORT DU DÉCOUPAGE EST REVALIDÉ, pas rendu tel quel', () => {
    // Deux segments suffisent à faire `a/b` ; ils ne suffisent pas à faire un
    // `owner/repo`. Un espace devient `%20` à l'analyse de l'URL, et un nom
    // démesuré reste démesuré — les deux passeraient sans `estFullName`.
    expect(fullNameDepuisUrl('https://github.com/mon proprio/mon depot')).toBeNull();
    expect(fullNameDepuisUrl(`https://github.com/${'a'.repeat(120)}/r`)).toBeNull();
  });

  it('L’HÔTE N’EST PAS IMPOSÉ — GitHub Enterprise existe', () => {
    // `HIVE_GITHUB_API` est là pour ça. Exiger `github.com` fermerait la porte
    // aux installations d'entreprise, précisément celles qui ont des workflows.
    expect(fullNameDepuisUrl('https://ghe.interne.corp/equipe/outil.git')).toBe('equipe/outil');
  });
});

describe('LES ROUTES WORKFLOWS', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  let jetonAvant: string | undefined;

  beforeEach(() => {
    jetonAvant = process.env.HIVE_GITHUB_TOKEN;
  });

  afterEach(async () => {
    if (jetonAvant === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = jetonAvant;
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function ruche(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-wf-'));
    mkdirSync(path.join(dir, 'data', 'cerveau'), { recursive: true });
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'data', 'hive.db'),
      simulation: false,
      tickMs: 60,
    });
    return server;
  }

  const appel = async (
    srv: HiveServer,
    chemin: string,
    init: RequestInit = {},
  ): Promise<Response> =>
    fetch(`http://127.0.0.1:${srv.port}${chemin}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
    });

  it('SANS JETON, LA RUCHE LE DIT ET DIT QUOI FAIRE', async () => {
    // 501 et non 500 : ce n'est pas une panne, c'est une fonctionnalité non
    // connectée. Et le message donne la commande, sinon il n'aide personne.
    delete process.env.HIVE_GITHUB_TOKEN;
    const srv = await ruche();
    const p = srv.store.createProject({ name: 'P', repoUrl: 'https://github.com/o/r.git' });
    const rep = await appel(srv, `/api/projects/${p.id}/workflows`);
    expect(rep.status).toBe(501);
    expect(((await rep.json()) as { detail: string }).detail).toContain('HIVE_GITHUB_TOKEN');
  });

  it('UN PROJET SANS DÉPÔT GITHUB EST REFUSÉ AVANT TOUT APPEL', async () => {
    // Un chemin local est un `repoUrl` parfaitement valide pour un chantier
    // local. Il n'a simplement pas de workflows, et le dire vaut mieux qu'un
    // 404 de GitHub sur un nom inventé.
    process.env.HIVE_GITHUB_TOKEN = 'ghp_' + 'x'.repeat(36);
    const srv = await ruche();
    const p = srv.store.createProject({ name: 'P', repoUrl: '/tmp/depot-local' });
    const rep = await appel(srv, `/api/projects/${p.id}/workflows`);
    expect(rep.status).toBe(400);
    expect(((await rep.json()) as { error: string }).error).toMatch(/dépôt GitHub/);
  });

  it('UN NOM DE FICHIER N’EST PAS UN IDENTIFIANT — refusé sans toucher à GitHub', async () => {
    // ─── L'ASSERTION QUI TIENT LA FRONTIÈRE ────────────────────────────────
    //
    // `POST …/actions/workflows/{id_OU_nom}/dispatches` accepte les deux côté
    // GitHub. Si cette route laissait passer « ci.yml », elle laisserait passer
    // « ../../user/repos » — n'importe quel endpoint de l'API, avec le jeton de
    // l'hôte, qui ouvre TOUS ses dépôts.
    process.env.HIVE_GITHUB_TOKEN = 'ghp_' + 'x'.repeat(36);
    const srv = await ruche();
    const p = srv.store.createProject({ name: 'P', repoUrl: 'https://github.com/o/r.git' });
    for (const faux of ['ci.yml', '..%2F..%2Fuser%2Frepos', 'abc']) {
      const rep = await appel(srv, `/api/projects/${p.id}/workflows/${faux}/run`, {
        method: 'POST',
        body: '{}',
      });
      expect(rep.status, faux).toBe(400);
      expect(((await rep.json()) as { detail?: string }).detail ?? '').toMatch(
        /NUMÉRIQUE|numérique/,
      );
    }
  });

  it('un workflowId non entier est refusé sur la lecture des runs aussi', async () => {
    process.env.HIVE_GITHUB_TOKEN = 'ghp_' + 'x'.repeat(36);
    const srv = await ruche();
    const p = srv.store.createProject({ name: 'P', repoUrl: 'https://github.com/o/r.git' });
    // « 12abc » deviendrait 12 avec `parseInt` — et 12 n'est pas ce qui a été
    // demandé. `Number` rend NaN, qu'on refuse.
    const rep = await appel(srv, `/api/projects/${p.id}/workflows/runs?workflowId=12abc`);
    expect(rep.status).toBe(400);
  });

  it('un projet inconnu rend 404, pas une erreur GitHub', async () => {
    process.env.HIVE_GITHUB_TOKEN = 'ghp_' + 'x'.repeat(36);
    const srv = await ruche();
    const rep = await appel(srv, '/api/projects/inexistant/workflows');
    expect(rep.status).toBe(404);
  });
});
