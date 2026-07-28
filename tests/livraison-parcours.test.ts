// LIVRER PUIS FUSIONNER — le trajet, pas les deux routes.
//
// ─── CE QUE LES TESTS DE ROUTE NE POUVAIENT PAS VOIR ─────────────────────────
//
// `POST /api/livraison` ouvre une pull request sur le dépôt de l'hôte.
// `POST /api/livraison/fusion` en fusionne une. Chacune avait ses tests, et
// entre les deux il manquait deux choses — toutes deux invisibles route par
// route, parce qu'elles ne sont le défaut d'aucune :
//
//   1. LA VOIE MANUELLE NE RANGEAIT RIEN. La voie autonome (le runner
//      d'essaim) écrit sa livraison dans la table `livraisons` ; la route
//      manuelle se contentait d'émettre un événement. Le numéro de PR
//      n'existait donc nulle part où le retrouver : impossible de rouvrir
//      « où en est ma livraison ? », et impossible de vérifier quoi que ce soit
//      à son sujet plus tard.
//
//   2. LA FUSION NE VÉRIFIAIT RIEN. Son commentaire disait « fusionne une pull
//      request ouverte par la ruche » ; le code acceptait n'importe quel
//      numéro. Elle fusionnait donc, AVEC LE JETON GITHUB DE L'HÔTE, n'importe
//      quelle PR du dépôt — celle qu'un humain est en train de relire, celle
//      d'un contributeur extérieur. Le geste est réputé humain, mais le jeton
//      qui l'autorise se recopie sur chaque machine membre (ADR 0007).
//
// Le second défaut n'existe que PARCE QUE le premier existait : sans table, il
// n'y avait rien à quoi comparer. Deux trous qui se tiennent, et qu'on ne voit
// qu'en faisant le trajet.
//
// ─── LE FAUX GITHUB ──────────────────────────────────────────────────────────
//
// Même procédé que `github-parcours.test.ts` : `HIVE_GITHUB_API` pointe sur un
// serveur local qui répond comme GitHub. Un vrai jeton ne peut pas vivre dans
// une suite de tests, et dépendre du réseau rendrait la CI rouge un jour sur
// dix pour des raisons qui ne nous regardent pas.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as creerHttp } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-livraison-suffisamment-long';
const JETON_GH = 'jeton-github-de-test-livraison';
const DEPOT = 'micka/ma-ruche';

/** Un diff minuscule mais VALIDE : la livraison l'analyse avant d'ouvrir la PR. */
const DIFF = [
  'diff --git a/note.txt b/note.txt',
  'index 0000000..1111111 100644',
  '--- a/note.txt',
  '+++ b/note.txt',
  '@@ -1 +1 @@',
  '-avant',
  '+après',
  '',
].join('\n');

describe('livrer, puis fusionner', () => {
  let faux: Server;
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projet = '';
  let tache: Task;
  let prOuverte = 0;
  /** Les PR que le faux GitHub a réellement fusionnées. */
  const fusionnees: number[] = [];
  /** Ce que le faux n'a pas su servir — pour ne pas déboguer à l'aveugle. */
  const nonServis: string[] = [];
  let avantJeton: string | undefined;
  let avantApi: string | undefined;

  const hive = () => ({ 'content-type': 'application/json', 'x-hive-token': TOKEN });

  beforeAll(async () => {
    faux = creerHttp((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      const repondre = (code: number, corps: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corps));
      };
      // CE QUE `livrer` ENCHAÎNE RÉELLEMENT — et il ne passe PAS par l'API
      // `contents` pour écrire : il fabrique un blob, un arbre, un commit, puis
      // pousse la référence. Un faux calqué sur ce qu'on imagine plutôt que sur
      // ce que le code appelle échoue avec un « 404 » qui n'apprend rien ; d'où
      // le journal `nonServis`, qui a nommé le chemin manquant en une seconde.
      if (u.pathname === `/repos/${DEPOT}`) {
        return repondre(200, { full_name: DEPOT, default_branch: 'main' });
      }
      if (u.pathname === `/repos/${DEPOT}/git/ref/heads/main`) {
        return repondre(200, { object: { sha: 'base-sha' } });
      }
      if (u.pathname.startsWith(`/repos/${DEPOT}/contents/`)) {
        // `type: 'file'` compte : la livraison refuse d'écrire sur un dossier
        // ou un lien symbolique.
        return repondre(200, {
          type: 'file',
          sha: 'ancien-sha',
          encoding: 'base64',
          content: Buffer.from('avant\n').toString('base64'),
        });
      }
      if (u.pathname === `/repos/${DEPOT}/git/blobs`) {
        return repondre(201, { sha: 'blob-sha' });
      }
      if (u.pathname === `/repos/${DEPOT}/git/trees`) {
        return repondre(201, { sha: 'arbre-sha' });
      }
      if (u.pathname === `/repos/${DEPOT}/git/commits`) {
        return repondre(201, { sha: 'commit-sha' });
      }
      if (u.pathname === `/repos/${DEPOT}/git/refs`) return repondre(201, { ref: 'ok' });
      if (u.pathname === `/repos/${DEPOT}/pulls` && req.method === 'POST') {
        return repondre(201, { number: 42, html_url: `https://github.com/${DEPOT}/pull/42` });
      }
      const m = /^\/repos\/(.+)\/pulls\/(\d+)\/merge$/.exec(u.pathname);
      if (m && req.method === 'PUT') {
        fusionnees.push(Number(m[2]));
        return repondre(200, { merged: true, sha: `sha-de-${m[2]}` });
      }
      // Un faux qui rend 404 en silence fait échouer le test pour une raison
      // qu'on ne voit pas. On note ce qu'on n'a pas su servir.
      nonServis.push(`${req.method} ${u.pathname}`);
      repondre(404, { message: 'Not Found' });
    });
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
    const port = (faux.address() as { port: number }).port;

    avantJeton = process.env.HIVE_GITHUB_TOKEN;
    avantApi = process.env.HIVE_GITHUB_API;
    process.env.HIVE_GITHUB_TOKEN = JETON_GH;
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${port}`;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-livr-'));
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

    projet = server.store.createProject({
      name: DEPOT,
      repoUrl: `https://github.com/${DEPOT}.git`,
      visibility: 'private',
      ownerId: null,
    }).id;
    tache = server.store.createTask({ projectId: projet, title: 'corriger la note', prompt: 'x' });
    server.store.patchTask(tache.id, { status: 'done', assignedNodeId: 'noeud-1' });
    server.store.insertResult({
      taskId: tache.id,
      nodeId: 'noeud-1',
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((r) => faux.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
    if (avantJeton === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = avantJeton;
    if (avantApi === undefined) delete process.env.HIVE_GITHUB_API;
    else process.env.HIVE_GITHUB_API = avantApi;
  });

  it('la livraison ouvre une pull request', async () => {
    const res = await fetch(`${base}/api/livraison`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ taskId: tache.id }),
    });
    expect(res.status, `${await res.clone().text()} · non servis : ${nonServis.join(', ')}`).toBe(
      201,
    );
    const corps = (await res.json()) as { pr: number };
    prOuverte = corps.pr;
    expect(prOuverte).toBe(42);
  });

  it('LA VOIE MANUELLE RANGE SA LIVRAISON, comme la voie autonome', async () => {
    // Sans ça, le numéro de PR n'existe nulle part où le retrouver : ni pour
    // rouvrir « où en est ma livraison ? », ni pour vérifier quoi que ce soit
    // à son sujet plus tard.
    const rangee = server.store.getLivraison(tache.id);
    expect(rangee, 'la livraison manuelle n’a rien rangé').not.toBeNull();
    expect(rangee?.pr).toBe(prOuverte);
    expect(rangee?.etat).toBe('ouverte');
  });

  it('ON NE FUSIONNE PAS UNE PR QUE LA RUCHE N’A PAS OUVERTE', async () => {
    // LE test de ce fichier. La route disait « fusionne une pull request
    // ouverte par la ruche » et acceptait n'importe quel numéro : elle
    // fusionnait, avec le jeton GitHub de l'hôte, la PR qu'un humain relisait
    // encore ou celle d'un contributeur extérieur.
    const res = await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ projectId: projet, pr: 7 }),
    });
    expect(res.status).toBe(409);
    const corps = (await res.json()) as { error: string; conseil: string };
    expect(corps.error).toMatch(/pas été ouverte par la ruche/);
    // Et le refus dit quoi faire : un refus opaque pousse à contourner.
    expect(corps.conseil.length).toBeGreaterThan(30);
    // Surtout : RIEN n'a été fusionné chez GitHub.
    expect(fusionnees, 'une PR étrangère a été fusionnée').not.toContain(7);
  });

  it('…mais on fusionne bien la sienne', async () => {
    const res = await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ projectId: projet, pr: prOuverte }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { fusionnee: boolean }).toMatchObject({ fusionnee: true });
    expect(fusionnees).toContain(prOuverte);
  });

  it('LA TABLE SUIT L’ÉTAT RÉEL après la fusion', async () => {
    // Une livraison fusionnée qui resterait « ouverte » ferait mentir l'écran,
    // et rouvrirait la porte à une seconde fusion de la même PR.
    expect(server.store.getLivraison(tache.id)?.etat).toBe('fusionnee');
  });

  it('LE JETON GITHUB NE SORT DANS AUCUNE DES DEUX RÉPONSES', async () => {
    // Il est à l'hôte, et rien de ce qu'on renvoie n'a besoin de lui — pas
    // même un message d'erreur.
    const livraison = await (
      await fetch(`${base}/api/livraison`, {
        method: 'POST',
        headers: hive(),
        body: JSON.stringify({ taskId: tache.id }),
      })
    ).text();
    const fusion = await (
      await fetch(`${base}/api/livraison/fusion`, {
        method: 'POST',
        headers: hive(),
        body: JSON.stringify({ projectId: projet, pr: 999 }),
      })
    ).text();
    expect(livraison).not.toContain(JETON_GH);
    expect(fusion).not.toContain(JETON_GH);
  });

  it('un projet sans dépôt GitHub le dit, il ne plante pas', async () => {
    const sansDepot = server.store.createProject({ name: 'sans dépôt', visibility: 'private' }).id;
    const res = await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ projectId: sansDepot, pr: 1 }),
    });
    expect(res.status).toBe(404);
  });
});
