// REPRENDRE UNE PULL REQUEST ROUGE AVANCE LA MÊME BRANCHE — le trajet entier,
// contre un faux GitHub qui tient vraiment ses objets git.
//
// ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
//
// `POST /api/projects/:p/livraisons/:t/reprendre` fabriquait une tâche sans
// lien avec la PR : le Scheduler lui donnait `hive/<nouvelId>`, l'ouvrière
// clonait la branche par défaut (sans le travail de la PR), et `livrer()`
// créait une branche neuve depuis `main` puis ouvrait une SECONDE pull
// request — qui ne contenait que le correctif. La PR d'origine, celle qu'un
// humain relisait, restait rouge. Le brief de la reprise ordonnait pourtant
// l'inverse : « la MÊME branche, n'en ouvrez pas une seconde ».
//
// ─── CE QUE CE BANC PROUVE ───────────────────────────────────────────────────
//
// Le faux GitHub ci-dessous n'est pas un répondeur : il range des blobs, des
// arbres, des commits, des références et des PR, refuse une référence qui
// existe déjà (`POST git/refs`) et une mise à jour qui n'est pas une avance
// rapide (`PATCH … force: false`). On peut donc LIRE, à la fin, ce que la
// branche de la PR contient :
//
//   · une seule pull request, jamais deux ;
//   · la MÊME référence a avancé, d'un commit dont l'unique parent est
//     l'ancienne tête ;
//   · son contenu porte le travail d'origine ET la correction ;
//   · l'ouvrière a reçu la branche de la PR à cloner (`prolonger`) ;
//   · un commit humain arrivé entre-temps n'est jamais réécrit.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as creerHttp } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { MAX_REPRISES_PAR_LIVRAISON } from '../src/shared/retour.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-reprise-meme-branche-assez-long';
const DEPOT = 'micka/ruche';

// ─── LE FAUX GITHUB, AVEC SES OBJETS ─────────────────────────────────────────

interface Commit {
  fichiers: Record<string, string>;
  parents: string[];
}

/** L'état du faux dépôt. Remis à zéro par `reinitialiser()`. */
const gh = {
  commits: new Map<string, Commit>(),
  arbres: new Map<string, Record<string, string>>(),
  blobs: new Map<string, string>(),
  refs: new Map<string, string>(),
  prs: new Map<number, { head: string; base: string; state: string; conflit?: boolean }>(),
  controles: new Map<string, unknown[]>(),
  compteur: 0,
  nonServis: [] as string[],
  fusions: [] as number[],
};

function reinitialiser(): void {
  gh.commits.clear();
  gh.arbres.clear();
  gh.blobs.clear();
  gh.refs.clear();
  gh.prs.clear();
  gh.controles.clear();
  gh.nonServis.length = 0;
  gh.fusions.length = 0;
  gh.commits.set('c-socle', { fichiers: { 'LISEZMOI.md': 'bonjour\n' }, parents: [] });
  gh.refs.set('main', 'c-socle');
}

const neuf = (prefixe: string): string => `${prefixe}-${++gh.compteur}`;

/** Un nom de branche OU un SHA, comme `?ref=` de l'API contents. */
const resoudre = (ref: string): Commit | undefined => gh.commits.get(gh.refs.get(ref) ?? ref);

/** `ancetre` est-il atteignable depuis `sha` ? (la règle de l'avance rapide) */
function descendDe(sha: string, ancetre: string): boolean {
  const aVoir = [sha];
  while (aVoir.length > 0) {
    const s = aVoir.pop()!;
    if (s === ancetre) return true;
    aVoir.push(...(gh.commits.get(s)?.parents ?? []));
  }
  return false;
}

/** Le contenu d'une branche, pour les assertions. */
const contenu = (branche: string): Record<string, string> => resoudre(branche)?.fichiers ?? {};

/** Pose un commit « humain » sur une branche, comme un push depuis un poste. */
function commitHumain(branche: string, fichiers: Record<string, string>): string {
  const parent = gh.refs.get(branche)!;
  const sha = neuf('c-humain');
  gh.commits.set(sha, { fichiers: { ...contenu(branche), ...fichiers }, parents: [parent] });
  gh.refs.set(branche, sha);
  return sha;
}

function fauxGithub(): Server {
  return creerHttp((req, res) => {
    let brut = '';
    req.on('data', (d: Buffer) => (brut += d.toString('utf8')));
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x');
      const corps = (brut ? JSON.parse(brut) : {}) as Record<string, unknown>;
      const rendre = (code: number, v: unknown): void => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      const p = u.pathname.replace(`/repos/${DEPOT}`, '');
      const m = req.method ?? 'GET';
      let r: RegExpExecArray | null;

      if (m === 'GET' && (r = /^\/git\/ref\/heads\/(.+)$/.exec(p))) {
        const sha = gh.refs.get(decodeURIComponent(r[1]!));
        return sha ? rendre(200, { object: { sha } }) : rendre(404, { message: 'Not Found' });
      }
      if (m === 'GET' && (r = /^\/contents\/(.+)$/.exec(p))) {
        const chemin = decodeURIComponent(r[1]!);
        const texte = resoudre(u.searchParams.get('ref') ?? 'main')?.fichiers[chemin];
        if (texte === undefined) return rendre(404, { message: 'Not Found' });
        return rendre(200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from(texte, 'utf8').toString('base64'),
        });
      }
      if (m === 'POST' && p === '/git/blobs') {
        const sha = neuf('b');
        gh.blobs.set(sha, Buffer.from(String(corps.content), 'base64').toString('utf8'));
        return rendre(201, { sha });
      }
      if (m === 'POST' && p === '/git/trees') {
        // `base_tree` reçoit ici un SHA de commit (c'est ce que `livrer` envoie).
        const depart = { ...(gh.commits.get(String(corps.base_tree))?.fichiers ?? {}) };
        for (const e of corps.tree as Array<{ path: string; sha: string | null }>) {
          if (e.sha === null) delete depart[e.path];
          else depart[e.path] = gh.blobs.get(e.sha) ?? '';
        }
        const sha = neuf('t');
        gh.arbres.set(sha, depart);
        return rendre(201, { sha });
      }
      if (m === 'POST' && p === '/git/commits') {
        const sha = neuf('c');
        gh.commits.set(sha, {
          fichiers: gh.arbres.get(String(corps.tree)) ?? {},
          parents: corps.parents as string[],
        });
        return rendre(201, { sha });
      }
      if (m === 'POST' && p === '/git/refs') {
        const nom = String(corps.ref).replace(/^refs\/heads\//, '');
        if (gh.refs.has(nom)) return rendre(422, { message: 'Reference already exists' });
        gh.refs.set(nom, String(corps.sha));
        return rendre(201, { ref: corps.ref });
      }
      if (m === 'PATCH' && (r = /^\/git\/refs\/heads\/(.+)$/.exec(p))) {
        const nom = decodeURIComponent(r[1]!);
        const avant = gh.refs.get(nom);
        if (!avant) return rendre(422, { message: 'Reference does not exist' });
        if (corps.force !== true && !descendDe(String(corps.sha), avant)) {
          return rendre(422, { message: 'Update is not a fast forward' });
        }
        gh.refs.set(nom, String(corps.sha));
        return rendre(200, { object: { sha: corps.sha } });
      }
      if (m === 'POST' && p === '/pulls') {
        const numero = gh.prs.size + 1;
        gh.prs.set(numero, { head: String(corps.head), base: String(corps.base), state: 'open' });
        return rendre(201, {
          number: numero,
          html_url: `https://github.com/${DEPOT}/pull/${numero}`,
        });
      }
      if (m === 'GET' && (r = /^\/pulls\/(\d+)$/.exec(p))) {
        const pr = gh.prs.get(Number(r[1]));
        if (!pr) return rendre(404, { message: 'Not Found' });
        return rendre(200, {
          number: Number(r[1]),
          state: pr.state,
          merged: false,
          mergeable: pr.conflit !== true,
          html_url: `https://github.com/${DEPOT}/pull/${r[1]}`,
          head: { ref: pr.head, sha: gh.refs.get(pr.head), repo: { full_name: DEPOT } },
        });
      }
      if (m === 'GET' && /^\/pulls\/\d+\/reviews$/.test(p)) return rendre(200, []);
      if (m === 'PUT' && (r = /^\/pulls\/(\d+)\/merge$/.exec(p))) {
        const pr = gh.prs.get(Number(r[1]));
        if (!pr) return rendre(404, { message: 'Not Found' });
        pr.state = 'closed';
        gh.fusions.push(Number(r[1]));
        return rendre(200, { merged: true, sha: gh.refs.get(pr.head) });
      }
      if (m === 'GET' && (r = /^\/commits\/([^/]+)\/check-runs$/.exec(p))) {
        return rendre(200, { check_runs: gh.controles.get(r[1]!) ?? [] });
      }
      gh.nonServis.push(`${m} ${u.pathname}`);
      rendre(404, { message: 'Not Found' });
    });
  });
}

// ─── LE BANC ─────────────────────────────────────────────────────────────────

/** Le travail d'origine : un fichier neuf, que `main` n'a pas. */
const DIFF_ORIGINE = [
  'diff --git a/travail.txt b/travail.txt',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/travail.txt',
  '@@ -0,0 +1,2 @@',
  '+ligne 1',
  '+ligne 2 (bug)',
  '',
].join('\n');

/**
 * La correction, telle qu'une ouvrière qui a cloné la branche de la PR la
 * rend : son CONTEXTE est le travail d'origine. Posée sur `main`, elle ne
 * s'appliquerait pas — le fichier n'y existe pas.
 */
const DIFF_CORRECTION = [
  'diff --git a/travail.txt b/travail.txt',
  '--- a/travail.txt',
  '+++ b/travail.txt',
  '@@ -1,2 +1,2 @@',
  ' ligne 1',
  '-ligne 2 (bug)',
  '+ligne 2 (corrigée)',
  '',
].join('\n');

const CI_ROUGE = [
  { name: 'tests', status: 'completed', conclusion: 'failure', html_url: 'https://x/run/1' },
];
const CI_VERTE = [
  { name: 'tests', status: 'completed', conclusion: 'success', html_url: 'https://x/run/2' },
];

describe('reprendre une pull request rouge avance la MÊME branche', () => {
  let faux: Server;
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projet = '';
  const sockets: WebSocket[] = [];
  let avantJeton: string | undefined;
  let avantApi: string | undefined;
  const hive = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    faux = fauxGithub();
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
    avantJeton = process.env.HIVE_GITHUB_TOKEN;
    avantApi = process.env.HIVE_GITHUB_API;
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-de-test';
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${(faux.address() as { port: number }).port}`;
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-reprise-branche-'));
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
      name: 'Ruche',
      repoUrl: `https://github.com/${DEPOT}.git`,
      ownerId: null,
    }).id;
  });

  afterEach(() => {
    for (const ws of sockets.splice(0)) ws.close();
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((r) => faux.close(() => r()));
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    if (avantJeton === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = avantJeton;
    if (avantApi === undefined) delete process.env.HIVE_GITHUB_API;
    else process.env.HIVE_GITHUB_API = avantApi;
  });

  /**
   * Une tâche terminée, porteuse de `diff`, comme la rendrait une ouvrière —
   * reniflée « clean » par les Gardiennes : sans inspection, l'Evaluator
   * s'arrête à « revue humaine requise » avant même de lire la CI.
   */
  const produire = (tache: Task, diff: string): void => {
    server.store.patchTask(tache.id, { status: 'done', assignedNodeId: 'noeud-banc' });
    const resultId = server.store.insertResult({
      taskId: tache.id,
      nodeId: 'noeud-banc',
      success: true,
      diff,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
    server.store.enregistrerInspection({
      resultId: typeof resultId === 'number' ? resultId : 0,
      taskId: tache.id,
      nodeId: 'noeud-banc',
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });
  };

  const livrer = async (taskId: string): Promise<Response> =>
    fetch(`${base}/api/livraison`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ taskId }),
    });

  const reprendre = async (taskId: string): Promise<Response> =>
    fetch(`${base}/api/projects/${projet}/livraisons/${taskId}/reprendre`, {
      method: 'POST',
      headers: { 'x-hive-token': TOKEN },
    });

  /** Ingère la CI GitHub de la dernière production d'une tâche (`evaluation/ci`). */
  const ingererCI = async (taskId: string): Promise<Response> =>
    fetch(`${base}/api/tasks/${taskId}/evaluation/ci`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ resultId: server.store.resultsForTask(taskId).at(-1)?.resultId }),
    });

  /** Livre une production d'origine et rend sa PR rouge. */
  const livrerOrigine = async (id: string): Promise<{ pr: number; branche: string }> => {
    const t = server.store.createTask({
      id,
      projectId: projet,
      title: `travail ${id}`,
      prompt: 'x',
    });
    produire(t, DIFF_ORIGINE);
    const r = await livrer(t.id);
    expect(r.status, `${await r.clone().text()} · non servis : ${gh.nonServis.join(', ')}`).toBe(
      201,
    );
    const { pr, branche } = (await r.json()) as { pr: number; branche: string };
    gh.controles.set(gh.refs.get(branche)!, CI_ROUGE);
    return { pr, branche };
  };

  /**
   * Un nœud qui s'inscrit et note ce qu'on lui confie. `prolonge: false` : un
   * nœud d'avant le contrat, qui ne déclare pas savoir prolonger.
   */
  async function noeud({ prolonge = true, id = 'ouvriere-banc' } = {}): Promise<
    Array<Record<string, unknown>>
  > {
    const recues: Array<Record<string, unknown>> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    sockets.push(ws);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Record<string, unknown>;
      if (m.type === 'assign_task') recues.push(m);
    });
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: id,
        ownerName: 'banc',
        agentType: 'claude-code',
        maxConcurrency: 1,
        nodeId: id,
        ...(prolonge ? { prolonge: true } : {}),
      }),
    );
    await attendre(() =>
      server.store.getNode(id)?.status === 'online' ? server.store.getNode(id) : undefined,
    );
    return recues;
  }

  /** La ligne d'une livraison, telle que la liste la montre. */
  async function ligneDe(taskId: string): Promise<Record<string, unknown> | undefined> {
    const r = await fetch(`${base}/api/projects/${projet}/livraisons`, {
      headers: { 'x-hive-token': TOKEN },
    });
    const { livraisons } = (await r.json()) as { livraisons: Array<Record<string, unknown>> };
    return livraisons.find((l) => l.taskId === taskId);
  }

  async function attendre<T>(lire: () => T | undefined, ms = 8_000): Promise<T | undefined> {
    const fin = Date.now() + ms;
    while (Date.now() < fin) {
      const v = lire();
      if (v !== undefined) return v;
      await new Promise((r) => setTimeout(r, 40));
    }
    return undefined;
  }

  it(
    'LA REPRISE AVANCE LA MÊME RÉFÉRENCE, N’OUVRE AUCUNE SECONDE PR, ET LA BRANCHE PORTE LES DEUX TRAVAUX',
    { timeout: 30_000 },
    async () => {
      reinitialiser();
      const { pr, branche } = await livrerOrigine('t-origine');
      expect(branche).toBe('hive/t-origine');
      const teteAvant = gh.refs.get(branche)!;
      // La CI rouge de l'origine est INGÉRÉE : c'est elle qui arrête sa PR.
      const ciRouge = await ingererCI('t-origine');
      expect(ciRouge.status, await ciRouge.clone().text()).toBe(200);
      expect(
        ((await ciRouge.json()) as { evaluation: { decision: string } }).evaluation.decision,
      ).toBe('correction_required');
      const recues = await noeud();

      // 1. La reprise : une tâche, rattachée à la PR et à SA branche.
      const r = await reprendre('t-origine');
      expect(r.status, `non servis : ${gh.nonServis.join(', ')}`).toBe(201);
      const corps = (await r.json()) as {
        tache: Task;
        branche: string;
        reprise: number;
        plafond: number;
      };
      expect(corps).toMatchObject({ branche, reprise: 1, plafond: MAX_REPRISES_PAR_LIVRAISON });
      expect(server.store.repriseDe(corps.tache.id)).toMatchObject({
        origine: 't-origine',
        parent: 't-origine',
        pr,
        branche,
        tete: teteAvant,
      });

      // 2. L'ouvrière reçoit la branche de la PR, et l'ordre de la prolonger.
      const assignation = await attendre(() =>
        recues.find((m) => (m.task as Task).id === corps.tache.id),
      );
      expect(assignation, 'la reprise n’a été confiée à aucune ouvrière').toBeDefined();
      expect((assignation?.task as Task).branch).toBe(branche);
      expect(assignation?.prolonger).toBe(true);

      // 3. Sa correction, relue contre la tête de la PR, est livrée.
      produire(server.store.getTask(corps.tache.id)!, DIFF_CORRECTION);
      const l = await livrer(corps.tache.id);
      expect(l.status, `${await l.clone().text()} · non servis : ${gh.nonServis.join(', ')}`).toBe(
        201,
      );
      expect(await l.json()).toMatchObject({ pr, branche, avancee: true });

      // ─── CE QUE GITHUB CONTIENT, LU SUR SES OBJETS ─────────────────────────
      expect([...gh.prs.keys()], 'une seule pull request, jamais deux').toEqual([pr]);
      expect([...gh.refs.keys()].sort(), 'aucune branche neuve').toEqual([
        'hive/t-origine',
        'main',
      ]);
      const teteApres = gh.refs.get(branche)!;
      expect(teteApres).not.toBe(teteAvant);
      expect(gh.commits.get(teteApres)?.parents, 'une avance rapide, pas une réécriture').toEqual([
        teteAvant,
      ]);
      expect(contenu(branche), 'le travail d’origine ET la correction').toEqual({
        'LISEZMOI.md': 'bonjour\n',
        'travail.txt': 'ligne 1\nligne 2 (corrigée)\n',
      });

      // ─── CE QUE LA RUCHE EN RETIENT ────────────────────────────────────────
      // UNE ligne vivante pour la PR : celle de la reprise. L'origine est
      // relayée, et la liste ne montre la PR qu'une fois.
      expect(server.store.getLivraison('t-origine')?.etat).toBe('relayee');
      expect(server.store.getLivraison(corps.tache.id)).toMatchObject({
        pr,
        branche,
        etat: 'ouverte',
      });
      const liste = await fetch(`${base}/api/projects/${projet}/livraisons`, {
        headers: { 'x-hive-token': TOKEN },
      });
      const { livraisons } = (await liste.json()) as { livraisons: Array<{ pr: number }> };
      expect(livraisons.filter((x) => x.pr === pr)).toHaveLength(1);
      // La provenance du commit avancé, lue par la preuve CI (`evaluation/ci`).
      expect(server.store.lastEventFor('delivery_advanced', corps.tache.id)?.payload).toMatchObject(
        { pr, branch: branche, commitSha: teteApres, origine: 't-origine' },
      );
      expect(server.store.lastEventFor('delivery_opened', corps.tache.id)).toBeNull();

      // Reprendre depuis la ligne relayée nomme la ligne vivante.
      const relayee = await reprendre('t-origine');
      expect(relayee.status).toBe(409);
      expect(await relayee.json()).toMatchObject({
        code: 'livraison_relayee',
        porteePar: corps.tache.id,
      });

      // ─── LA PREUVE CI DE LA NOUVELLE TÊTE APPARTIENT À LA REPRISE ─────────
      // Sa provenance est `delivery_advanced` : sans elle, une PR reprise
      // répondrait `delivery_provenance_missing` pour toujours.
      gh.controles.set(teteApres, CI_VERTE);
      const ciReprise = await ingererCI(corps.tache.id);
      expect(ciReprise.status, await ciReprise.clone().text()).toBe(200);
      expect(await ciReprise.json()).toMatchObject({
        provenance: { pr, branch: branche, commitSha: teteApres },
      });
      // L'origine ne s'approprie pas une tête qu'elle n'a pas écrite.
      const ciOrigine = await ingererCI('t-origine');
      expect(ciOrigine.status).toBe(409);
      expect(await ciOrigine.json()).toMatchObject({ code: 'provenance_mismatch' });

      // ─── ET LA PR SE FUSIONNE ──────────────────────────────────────────────
      // La CI rouge de l'origine visait la tête que la reprise a dépassée : elle
      // n'arrête plus la PR (`arretDePR`, sans CI pour une ligne relayée).
      const fusion = await fetch(`${base}/api/livraison/fusion`, {
        method: 'POST',
        headers: hive,
        body: JSON.stringify({ projectId: projet, pr }),
      });
      expect(fusion.status, await fusion.clone().text()).toBe(200);
      expect(gh.fusions).toEqual([pr]);
      expect(server.store.getLivraison('t-origine')?.etat).toBe('fusionnee');
      expect(gh.nonServis).toEqual([]);
    },
  );

  it('UN COMMIT HUMAIN ARRIVÉ ENTRE-TEMPS N’EST JAMAIS RÉÉCRIT', { timeout: 30_000 }, async () => {
    reinitialiser();
    const { branche } = await livrerOrigine('t-humain');
    const r = await reprendre('t-humain');
    expect(r.status).toBe(201);
    const { tache } = (await r.json()) as { tache: Task };

    // Quelqu'un pousse sur la branche de la PR pendant que la reprise tourne,
    // sur un AUTRE fichier : la correction s'applique encore à sa tête.
    const humain = commitHumain(branche, { 'NOTE.md': 'poussé à la main\n' });
    produire(server.store.getTask(tache.id)!, DIFF_CORRECTION);
    const l = await livrer(tache.id);
    expect(l.status, await l.clone().text()).toBe(201);
    const tete = gh.refs.get(branche)!;
    expect(gh.commits.get(tete)?.parents, 'le commit humain reste, le nôtre vient après').toEqual([
      humain,
    ]);
    expect(contenu(branche)['NOTE.md']).toBe('poussé à la main\n');
    expect(contenu(branche)['travail.txt']).toBe('ligne 1\nligne 2 (corrigée)\n');
    expect(gh.prs.size).toBe(1);
  });

  it(
    'une correction que la branche humaine contredit s’ARRÊTE, avec sa raison, sans rien écrire',
    { timeout: 30_000 },
    async () => {
      reinitialiser();
      const { branche } = await livrerOrigine('t-contredit');
      const r = await reprendre('t-contredit');
      const { tache } = (await r.json()) as { tache: Task };
      // L'humain a réécrit la ligne que la correction visait.
      const humain = commitHumain(branche, { 'travail.txt': 'ligne 1\nligne 2 (humaine)\n' });
      produire(server.store.getTask(tache.id)!, DIFF_CORRECTION);
      const l = await livrer(tache.id);
      expect(l.status).toBe(409);
      expect(((await l.json()) as { error: string }).error).toBeTruthy();
      expect(gh.refs.get(branche), 'la branche humaine est intacte').toBe(humain);
      expect(gh.prs.size).toBe(1);
      // Visible : la reprise porte son échec, l'origine reste la ligne vivante.
      expect(server.store.getLivraison(tache.id)?.etat).toBe('echouee');
      expect(server.store.getLivraison('t-contredit')?.etat).toBe('ouverte');
    },
  );

  it('UNE reprise en vol à la fois, et un PLAFOND par livraison', { timeout: 30_000 }, async () => {
    reinitialiser();
    await livrerOrigine('t-plafond');
    const premiere = await reprendre('t-plafond');
    expect(premiere.status).toBe(201);
    const { tache } = (await premiere.json()) as { tache: Task };

    const seconde = await reprendre('t-plafond');
    expect(seconde.status).toBe(409);
    expect(await seconde.json()).toMatchObject({ code: 'reprise_en_vol', reprise: tache.id });
    // La liste n'offre pas le bouton que la route refuse — elle dit pourquoi.
    expect(await ligneDe('t-plafond')).toMatchObject({
      reprenable: false,
      nonReprenable: expect.stringMatching(/déjà en cours/),
    });

    // Les reprises ÉCHOUÉES comptent aussi : le plafond borne les tentatives.
    server.store.patchTask(tache.id, { status: 'failed' });
    for (let i = 1; i < MAX_REPRISES_PAR_LIVRAISON; i++) {
      const r = await reprendre('t-plafond');
      expect(r.status, `reprise ${i + 1}`).toBe(201);
      server.store.patchTask(((await r.json()) as { tache: Task }).tache.id, { status: 'failed' });
    }
    const deTrop = await reprendre('t-plafond');
    expect(deTrop.status).toBe(409);
    expect(await deTrop.json()).toMatchObject({ code: 'plafond_reprises' });
    expect(server.store.reprisesDeLivraison('t-plafond')).toHaveLength(MAX_REPRISES_PAR_LIVRAISON);
    expect(await ligneDe('t-plafond')).toMatchObject({
      reprenable: false,
      nonReprenable: expect.stringMatching(/plafond/),
    });
  });

  it(
    'une reprise qui n’a RIEN produit ne ferme pas la PR aux suivantes — et elle compte',
    { timeout: 30_000 },
    async () => {
      // L'agent n'a rien changé (CI instable, correctif déjà là) : rien ne se
      // livrera jamais. La compter « en vol » fermait la PR à toute reprise,
      // avec le conseil d'attendre ce qui n'arriverait pas.
      reinitialiser();
      await livrerOrigine('t-vide');
      const premiere = await reprendre('t-vide');
      expect(premiere.status).toBe(201);
      const { tache } = (await premiere.json()) as { tache: Task };
      produire(server.store.getTask(tache.id)!, '');
      const l = await livrer(tache.id);
      expect(l.status).toBe(409);
      expect(server.store.getLivraison(tache.id)).toBeNull();

      const seconde = await reprendre('t-vide');
      expect(seconde.status, await seconde.clone().text()).toBe(201);
      const { tache: suivante } = (await seconde.json()) as { tache: Task };
      expect(server.store.reprisesDeLivraison('t-vide')).toHaveLength(2);
      // Close pour les bancs qui suivent : elle n'a rien à faire ici.
      server.store.patchTask(suivante.id, { status: 'failed' });
    },
  );

  it(
    'une reprise dont la livraison PART (`en_cours`) est encore en vol',
    { timeout: 30_000 },
    async () => {
      // La réservation existe, l'appel GitHub n'est pas revenu : une seconde
      // reprise clonerait une tête sur le point d'être dépassée.
      reinitialiser();
      const { branche } = await livrerOrigine('t-part');
      const premiere = await reprendre('t-part');
      const { tache } = (await premiere.json()) as { tache: Task };
      produire(server.store.getTask(tache.id)!, DIFF_CORRECTION);
      // Relue et REJETÉE, elle n'aboutira pas seule : le refus nomme les sorties.
      server.store.setTaskReview(tache.id, 'rejected');
      const arretee = await reprendre('t-part');
      expect(arretee.status).toBe(409);
      expect(await arretee.json()).toMatchObject({
        code: 'reprise_en_vol',
        conseil: expect.stringMatching(/evaluation\/retry.*forcer/s),
      });
      server.store.setTaskReview(tache.id, 'approved');
      expect(
        server.store.reserverLivraison({
          taskId: tache.id,
          projectId: projet,
          depot: DEPOT,
          branche,
        }),
      ).toBe(true);
      const seconde = await reprendre('t-part');
      expect(seconde.status).toBe(409);
      expect(await seconde.json()).toMatchObject({ code: 'reprise_en_vol', reprise: tache.id });
    },
  );

  it('un conflit ne se reprend pas : il se DIT, avec quoi faire', { timeout: 30_000 }, async () => {
    reinitialiser();
    const { pr } = await livrerOrigine('t-conflit');
    // CI verte, aucune revue, mais GitHub dit la PR non fusionnable : le
    // conflit, et rien d'autre. Une reprise avancerait la branche sans le lever.
    gh.controles.clear();
    gh.prs.get(pr)!.conflit = true;
    const avant = server.store.listTasks(projet).length;
    const r = await reprendre('t-conflit');
    expect(r.status).toBe(409);
    const corps = (await r.json()) as { code: string; etat: string; conseil: string };
    expect(corps).toMatchObject({ code: 'conflit_hors_reprise', etat: 'en_conflit' });
    expect(corps.conseil).toMatch(/Update branch/);
    expect(server.store.listTasks(projet), 'aucune tâche fabriquée').toHaveLength(avant);
  });

  it('le relais d’une PR reste dans SON projet, même sur un dépôt partagé', () => {
    // Deux projets branchés sur le même dépôt ont chacun leurs lignes pour le
    // même numéro : la reprise de l'un ne cache pas la PR de l'autre.
    const autre = server.store.createProject({
      name: 'Ruche jumelle',
      repoUrl: `https://github.com/${DEPOT}.git`,
      ownerId: null,
    }).id;
    const ligne = (taskId: string, projectId: string): void => {
      server.store.createTask({ id: taskId, projectId, title: taskId, prompt: 'x' });
      server.store.setLivraison({
        taskId,
        projectId,
        depot: DEPOT,
        pr: 99,
        branche: 'hive/t-jumelle',
        etat: 'ouverte',
      });
    };
    ligne('t-jumelle-a', projet);
    ligne('t-jumelle-b', autre);
    server.store.createTask({ id: 'r-jumelle', projectId: projet, title: 'r', prompt: 'x' });
    const commun = {
      taskId: 'r-jumelle',
      projectId: projet,
      depot: DEPOT,
      branche: 'hive/t-jumelle',
    };
    expect(server.store.reserverLivraison(commun)).toBe(true);
    expect(
      server.store.finaliserLivraisonEnCours({ ...commun, pr: 99, etat: 'ouverte', relaie: true }),
    ).toBe(true);
    expect(server.store.getLivraison('t-jumelle-a')?.etat).toBe('relayee');
    expect(server.store.getLivraison('t-jumelle-b')?.etat).toBe('ouverte');
  });

  it(
    'une reprise ne part pas vers une ouvrière qui ne sait pas prolonger — et le DIT',
    { timeout: 30_000 },
    async () => {
      // Une ouvrière d'avant le contrat reconstruit `assign_task` champ par
      // champ et perd `prolonger` : elle clonerait `main` sous un brief qui
      // affirme le contraire. Le hub ne lui confie donc aucune reprise.
      reinitialiser();
      for (const t of server.store.listTasks(projet)) {
        if (t.status !== 'done' && t.status !== 'failed') {
          server.store.patchTask(t.id, { status: 'failed' });
        }
      }
      await attendre(() =>
        server.store.listNodes().every((n) => n.status !== 'online') ? true : undefined,
      );
      await livrerOrigine('t-ancienne');
      const ancienne = await noeud({ prolonge: false, id: 'ouvriere-ancienne' });
      const r = await reprendre('t-ancienne');
      expect(r.status).toBe(201);
      const { tache } = (await r.json()) as { tache: Task };
      const signal = await attendre(
        () => server.store.lastEventFor('reprise_sans_ouvriere', tache.id) ?? undefined,
      );
      expect(signal, 'une reprise qui attend le dit').toBeDefined();
      expect(server.store.getTask(tache.id)?.status).toBe('ready');

      const recente = await noeud({ id: 'ouvriere-recente' });
      const assignation = await attendre(() =>
        recente.find((m) => (m.task as Task).id === tache.id),
      );
      expect(assignation?.prolonger).toBe(true);
      expect(ancienne.filter((m) => (m.task as Task).id === tache.id)).toEqual([]);
    },
  );
});
