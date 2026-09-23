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
  /** Numéros rendus par le faux GitHub, dans l'ordre. */
  const prsServies: number[] = [];
  let prochainePr = 42;
  /** Les PR que le faux GitHub a réellement fusionnées. */
  const fusionnees: number[] = [];
  /** Ce que le faux n'a pas su servir — pour ne pas déboguer à l'aveugle. */
  const nonServis: string[] = [];
  let bloquerLecture = false;
  let libererLecture: (() => void) | null = null;
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
        if (bloquerLecture) {
          bloquerLecture = false;
          return new Promise<void>((resolve) => {
            libererLecture = resolve;
          }).then(() => repondre(200, { object: { sha: 'base-sha' } }));
        }
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
        // UNE PR PAR LIVRAISON, numérotée. Le faux rendait 42 à chaque appel :
        // deux livraisons donnaient la même pull request, et les tests ne
        // pouvaient donc pas livrer chacun la leur. Ça commence à 42, et les
        // numéros que les tests utilisent comme « jamais ouverte par la ruche »
        // (7, 999) restent hors d'atteinte pour toujours.
        const numero = prochainePr++;
        prsServies.push(numero);
        return repondre(201, {
          number: numero,
          html_url: `https://github.com/${DEPOT}/pull/${numero}`,
        });
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
  });

  /** Une tâche terminée avec son diff, prête à être livrée. */
  const tacheLivrable = (titre: string): Task => {
    const t = server.store.createTask({ projectId: projet, title: titre, prompt: 'x' });
    server.store.patchTask(t.id, { status: 'done', assignedNodeId: 'noeud-1' });
    server.store.insertResult({
      taskId: t.id,
      nodeId: 'noeud-1',
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
    return t;
  };

  /**
   * Livre une tâche neuve et rend la pull request ouverte pour elle.
   *
   * Les cinq tests de ce bloc se passaient `tache` et `prOuverte` : « on
   * fusionne bien la sienne » fusionnait la PR ouverte par « la livraison ouvre
   * une pull request », et « la table suit l'état réel » lisait la fusion faite
   * par le précédent. Trois maillons, aucun autonome. Chacun livre désormais la
   * sienne.
   */
  const livrer = async (titre: string): Promise<{ tache: Task; pr: number }> => {
    const t = tacheLivrable(titre);
    const res = await fetch(`${base}/api/livraison`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ taskId: t.id }),
    });
    expect(res.status, `${await res.clone().text()} · non servis : ${nonServis.join(', ')}`).toBe(
      201,
    );
    return { tache: t, pr: ((await res.json()) as { pr: number }).pr };
  };

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
    const { pr } = await livrer('corriger la note');
    // LE NUMÉRO REMONTE DE GITHUB, il n'est pas inventé par la ruche : c'est
    // exactement celui que le faux vient de servir.
    expect(pr).toBe(prsServies[prsServies.length - 1]);
    expect(pr).toBeGreaterThanOrEqual(42);
  });

  it('réserve la livraison manuelle avant le premier appel GitHub', async () => {
    const t = tacheLivrable('réserver avant GitHub');
    bloquerLecture = true;
    const requete = fetch(`${base}/api/livraison`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ taskId: t.id }),
    });
    const fin = Date.now() + 2_000;
    while (!libererLecture && Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(libererLecture).toBeTypeOf('function');
    expect(server.store.getLivraison(t.id)?.etat).toBe('en_cours');
    const resultat = server.store.resultsForTask(t.id).at(-1);
    const retry = server.scheduler.retryFromEvaluator({
      taskId: t.id,
      resultId: resultat?.resultId ?? -1,
      decision: 'correction_required',
    });
    expect(retry).toMatchObject({ ok: false, reason: 'delivery_exists' });
    const enCours = server.store.getLivraison(t.id);
    expect(enCours?.etat).toBe('en_cours');
    // Simule la décision concurrente qui remplace la réservation avant le
    // retour GitHub. Le retour tardif ne doit pas la transformer en PR ouverte.
    if (enCours) {
      server.store.setLivraison({ ...enCours, pr: 0, etat: 'echouee', motif: 'remplacée' });
    }
    libererLecture?.();
    libererLecture = null;
    const res = await requete;
    expect(res.status, await res.clone().text()).toBe(409);
    expect(server.store.getLivraison(t.id)?.etat).toBe('echouee');
  });

  it('LA VOIE MANUELLE RANGE SA LIVRAISON, comme la voie autonome', async () => {
    // Sans ça, le numéro de PR n'existe nulle part où le retrouver : ni pour
    // rouvrir « où en est ma livraison ? », ni pour vérifier quoi que ce soit
    // à son sujet plus tard.
    const { tache, pr } = await livrer('ranger sa livraison');
    const rangee = server.store.getLivraison(tache.id);
    expect(rangee, 'la livraison manuelle n’a rien rangé').not.toBeNull();
    expect(rangee?.pr).toBe(pr);
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
    const { pr } = await livrer('fusionner la sienne');
    const res = await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ projectId: projet, pr }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { fusionnee: boolean }).toMatchObject({ fusionnee: true });
    expect(fusionnees).toContain(pr);
  });

  it('LA TABLE SUIT L’ÉTAT RÉEL après la fusion', async () => {
    // Une livraison fusionnée qui resterait « ouverte » ferait mentir l'écran,
    // et rouvrirait la porte à une seconde fusion de la même PR.
    const { tache, pr } = await livrer('suivre l’état réel');
    await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ projectId: projet, pr }),
    });
    expect(server.store.getLivraison(tache.id)?.etat).toBe('fusionnee');
    const reprise = await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ projectId: projet, pr }),
    });
    expect(reprise.status).toBe(409);
  });

  it('LA FUSION HUMAINE PASSE LES FABRIQUES LIÉES EN mergee', async () => {
    // ADR 0010 lot 8 : la voie manuelle doit faire comme l'essaim — sinon
    // Chantiers resterait bloqué après un merge que l'humain a conclu.
    const { tache, pr } = await livrer('fabrique après fusion');
    const o = server.store.ouvrirFabrique(projet, 'script_npm', 'Outil', {
      nomScript: 'outil:x',
      taskId: tache.id,
    });
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive(),
      body: JSON.stringify({ projectId: projet, pr }),
    });
    expect(server.store.listerFabriques(projet).find((f) => f.id === o.id)?.statut).toBe('mergee');
  });

  it('LE JETON GITHUB NE SORT DANS AUCUNE DES DEUX RÉPONSES', async () => {
    // Il est à l'hôte, et rien de ce qu'on renvoie n'a besoin de lui — pas
    // même un message d'erreur.
    const livraison = await (
      await fetch(`${base}/api/livraison`, {
        method: 'POST',
        headers: hive(),
        body: JSON.stringify({ taskId: tacheLivrable('jeton absent des réponses').id }),
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

  it('réconcilie une réservation orpheline au redémarrage', async () => {
    const t = tacheLivrable('réservation interrompue');
    expect(
      server.store.reserverLivraison({
        taskId: t.id,
        projectId: projet,
        depot: DEPOT,
        branche: `hive/${t.id}`,
        now: 1,
      }),
    ).toBe(true);
    expect(server.store.getLivraison(t.id)?.etat).toBe('en_cours');

    await server.stop();
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

    const livraison = server.store.getLivraison(t.id);
    expect(livraison?.etat).toBe('echouee');
    expect(livraison?.pr).toBe(0);
    expect(livraison?.motif).toMatch(/redémarrage.*PR.*distante peut exister/);

    const vue = await fetch(`${base}/api/projects/${projet}/livraisons`, {
      headers: hive(),
    });
    expect(vue.status).toBe(200);
    const corps = (await vue.json()) as {
      livraisons: Array<{ taskId: string; etat: string; pr: number; faits: unknown; dit: string }>;
    };
    const interrompue = corps.livraisons.find((l) => l.taskId === t.id);
    expect(interrompue).toMatchObject({ taskId: t.id, etat: 'echouee', pr: 0, faits: null });
    expect(interrompue?.dit).toMatch(/redémarrage.*PR.*distante peut exister/);
  });
});
