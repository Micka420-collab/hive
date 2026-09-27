// LA LIVRAISON SANS GITHUB, DE BOUT EN BOUT — hub ↔ nœud, sur un vrai dépôt.
//
// POST /api/projects/:id/livraison-locale → le hub juge (propriétaire,
// Evaluator), choisit un nœud (consentant, s'il faut pousser), lui confie le
// merge AVEC la demande de livraison → le nœud intègre, commite la mission sur
// `hive/mission-<projectId>-<n>`, la pousse si demandé → le rapport revient sur
// /merge/result et au journal.
//
// Deux ruches : l'une avec une VRAIE ouvrière (`HiveNodeClient`) pour le trajet
// complet ; l'autre avec des nœuds simulés au niveau du protocole, pour ce
// qu'une vraie ouvrière ne sait pas mal faire — être d'une version qui ignore
// la demande, ou ne pas avoir consenti.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { simpleGit } from 'simple-git';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { MergeResultMsg } from '../src/shared/protocol.js';
import type { HiveEvent, StateSnapshot } from '../src/shared/types.js';

const TOKEN = 'jeton-livraison-locale-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
const FILE = 'sample.txt';
const BASE = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);

function withLine(line: number, value: string): string {
  const lines = [...BASE];
  lines[line - 1] = value;
  return lines.join('\n') + '\n';
}

/** Un dépôt d'origine NU (ce qu'un GitLab ou un Gitea héberge) et deux patchs. */
async function origine(dir: string): Promise<{ nu: string; patchA: string; patchB: string }> {
  const travail = path.join(dir, 'travail');
  await simpleGit().raw(['init', travail]);
  const g = simpleGit({ baseDir: travail });
  await g.addConfig('user.email', 'test@hive.local');
  await g.addConfig('user.name', 'Hive Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.addConfig('core.autocrlf', 'false');
  writeFileSync(path.join(travail, FILE), BASE.join('\n') + '\n');
  await g.add(FILE);
  await g.commit('base');
  const patchFor = async (value: string, line: number): Promise<string> => {
    writeFileSync(path.join(travail, FILE), withLine(line, value));
    const d = await g.diff();
    await g.raw(['checkout', '--', '.']);
    return d;
  };
  const patchA = await patchFor('l2-A', 2);
  const patchB = await patchFor('l10-B', 10);
  const nu = path.join(dir, 'origine.git');
  await simpleGit().raw(['clone', '--bare', '--quiet', travail, nu]);
  return { nu, patchA, patchB };
}

async function ruche(dir: string): Promise<HiveServer> {
  return createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'hive.db'),
    simulation: false,
    tickMs: 80,
  });
}

/** Un projet (orphelin par défaut : voie jeton / CLI) et ses tâches terminées, diffs compris. */
function mission(srv: HiveServer, repoUrl: string, diffs: [string, string][], ownerId?: string) {
  const project = srv.store.createProject({
    name: 'Mission',
    repoUrl,
    ...(ownerId ? { ownerId } : {}),
  });
  const resultIds = new Map<string, number>();
  for (const [id, diff] of diffs) {
    srv.store.createTask({ id, projectId: project.id, title: id, prompt: 'p' });
    srv.store.patchTask(id, { status: 'done' });
    resultIds.set(
      id,
      srv.store.insertResult({
        taskId: id,
        nodeId: 'seed',
        success: true,
        diff,
        logs: '',
        durationMs: 1,
        subAgents: [],
      }),
    );
  }
  return { project, resultIds };
}

async function attendre<T>(lire: () => Promise<T | null | undefined>, msMax = 15_000): Promise<T> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    const v = await lire();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('condition jamais atteinte');
}

const poster = (
  base: string,
  chemin: string,
  corps: unknown,
  entetes: Record<string, string> = headers,
) => fetch(`${base}${chemin}`, { method: 'POST', headers: entetes, body: JSON.stringify(corps) });

/** Le résultat du merge `mergeId`, dès qu'il est rangé. */
const resultatDe = (base: string, projectId: string, mergeId: string) =>
  attendre(async () => {
    const { result } = (await (
      await fetch(`${base}/api/projects/${projectId}/merge/result`, { headers })
    ).json()) as { result: MergeResultMsg | null };
    return result?.mergeId === mergeId ? result : null;
  });

const evenements = async (base: string): Promise<HiveEvent[]> =>
  (await (await fetch(`${base}/api/events?since=0&limit=500`, { headers })).json()) as HiveEvent[];

describe('livraison locale — une vraie ouvrière, un vrai dépôt', () => {
  let dir: string;
  let server: HiveServer;
  let client: HiveNodeClient;
  let base: string;
  let depot: { nu: string; patchA: string; patchB: string };
  let workRoot: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-livloc-'));
    depot = await origine(dir);
    server = await ruche(dir);
    base = `http://127.0.0.1:${server.port}`;
    const adapter: AgentAdapter = {
      name: 'noop',
      async run() {
        return { success: true, diff: '', logs: 'ok', subAgents: [] };
      },
    };
    workRoot = path.join(dir, 'work');
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'ouvriere-livraison',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot,
      adapter,
      quiet: true,
      pousseLivraisons: true,
    });
    client.start();
    await attendre(async () => {
      const s = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      return s.nodes.some((n) => n.status === 'online');
    });
  });

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('commite la mission sur sa branche, la pousse, et le dit partout', async () => {
    const { project, resultIds } = mission(server, depot.nu, [
      ['wa', depot.patchA],
      ['wb', depot.patchB],
    ]);
    const res = await poster(base, `/api/projects/${project.id}/livraison-locale`, {
      pousser: true,
    });
    expect(res.status).toBe(202);
    const depart = (await res.json()) as { mergeId: string; noeud: string; order: string[] };
    expect(depart.noeud).toBe('ouvriere-livraison');
    expect(depart.order).toEqual(['wa', 'wb']);

    const result = await resultatDe(base, project.id, depart.mergeId);
    expect(result.livraison, result.logs).toMatchObject({
      etat: 'commitee',
      branche: `hive/mission-${project.id}-1`,
      poussee: 'poussee',
    });
    if (result.livraison?.etat !== 'commitee') throw new Error(result.logs);

    // Dans le DÉPÔT DU PROJET : la branche, et la provenance exacte.
    const nu = simpleGit({ baseDir: depot.nu });
    expect((await nu.raw(['rev-parse', result.livraison.branche])).trim()).toBe(
      result.livraison.commit,
    );
    const trailers = await nu.raw([
      'log',
      '-1',
      '--format=%(trailers:only,unfold)',
      result.livraison.commit,
    ]);
    expect(trailers).toContain(`Hive-Result: wa ${resultIds.get('wa')}`);
    expect(trailers).toContain(`Hive-Result: wb ${resultIds.get('wb')}`);
    // Aucune inspection des Gardiennes : l'Evaluator attend un humain — ce
    // n'est pas un refus, et le verdict est écrit tel quel.
    expect(trailers).toContain('Hive-Evaluator: wa human_review_required');
    // Et sur le NŒUD : la branche survit au clone jetable.
    const durable = simpleGit({ baseDir: path.join(workRoot, 'livraisons', `${project.id}.git`) });
    expect((await durable.raw(['rev-parse', result.livraison.branche])).trim()).toBe(
      result.livraison.commit,
    );
    // Au journal : des faits typés.
    const fait = (await evenements(base)).find(
      (e) => e.type === 'livraison_locale' && e.payload.mergeId === depart.mergeId,
    );
    expect(fait?.payload).toMatchObject({
      etat: 'commitee',
      branche: result.livraison.branche,
      poussee: 'poussee',
    });
  });

  it('l’Evaluator arrête la mission — et un forçage signé la laisse partir, journalisé', async () => {
    const { project, resultIds } = mission(server, depot.nu, [['wc', depot.patchA]]);
    // Les Gardiennes ont relevé un signal suspect sur CETTE production.
    server.store.enregistrerInspection({
      resultId: resultIds.get('wc') ?? 0,
      taskId: 'wc',
      nodeId: 'seed',
      verdict: 'suspect',
      score: 1,
      applique: true,
      griefs: [],
    });
    const chemin = `/api/projects/${project.id}/livraison-locale`;
    const bloque = await poster(base, chemin, {});
    expect(bloque.status).toBe(409);
    const refus = (await bloque.json()) as {
      code: string;
      bloquees: { taskId: string; decision: string }[];
      conseil: string;
    };
    expect(refus.code).toBe('evaluator_blocks');
    expect(refus.bloquees).toEqual([
      expect.objectContaining({ taskId: 'wc', decision: 'correction_required' }),
    ]);
    expect(refus.conseil).toContain('--forcer');
    // Rien n'est parti vers le nœud : aucun merge n'a été confié.
    const avant = await evenements(base);
    expect(
      avant.some((e) => e.type === 'merge_started' && e.payload.projectId === project.id),
    ).toBe(false);

    const force = await poster(base, chemin, {
      forcer: { raison: 'relu à la main, faux positif' },
    });
    expect(force.status).toBe(202);
    const depart = (await force.json()) as { mergeId: string; forcees: string[] };
    expect(depart.forcees).toEqual(['wc']);
    const result = await resultatDe(base, project.id, depart.mergeId);
    expect(result.livraison, result.logs).toMatchObject({
      etat: 'commitee',
      poussee: 'non_demandee',
    });
    if (result.livraison?.etat !== 'commitee') throw new Error(result.logs);
    const durable = simpleGit({ baseDir: path.join(workRoot, 'livraisons', `${project.id}.git`) });
    const trailers = await durable.raw([
      'log',
      '-1',
      '--format=%(trailers:only,unfold)',
      result.livraison.commit,
    ]);
    expect(trailers).toContain('Hive-Evaluator: wc correction_required');
    expect(trailers).toContain('Hive-Evaluator-Forced: relu à la main, faux positif');
    const force_ = (await evenements(base)).find(
      (e) => e.type === 'evaluator_overridden' && e.payload.mergeId === depart.mergeId,
    );
    expect(force_?.payload).toMatchObject({
      taskId: 'wc',
      geste: 'livraison_locale',
      decision: 'correction_required',
      raison: 'relu à la main, faux positif',
    });
  });

  it('livrer, c’est répondre du projet ; pousser, parler au nom de l’hôte', async () => {
    const inscrire = async (email: string): Promise<{ token: string; id: string }> => {
      const res = await poster(base, '/api/auth/register', {
        email,
        password: 'motdepasse-assez-long-42',
        displayName: email,
      });
      const { token } = (await res.json()) as { token: string };
      const moi = (await (
        await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
      ).json()) as { id: string };
      return { token, id: moi.id };
    };
    // Le premier compte est administrateur par amorçage : on brûle sa place,
    // sinon le « propriétaire » passerait partout et ce banc ne prouverait rien.
    await inscrire('la-reine@ruche.test');
    const proprio = await inscrire('proprio@ruche.test');
    const membre = await inscrire('membre@ruche.test');
    const { project } = mission(server, depot.nu, [['wd', depot.patchB]], proprio.id);
    server.store.addMember(project.id, proprio.id, 'owner');
    server.store.addMember(project.id, membre.id);
    const compte = (jeton: string) => ({
      'content-type': 'application/json',
      authorization: `Bearer ${jeton}`,
    });
    const chemin = `/api/projects/${project.id}/livraison-locale`;

    // Un membre ajoute du travail ; il ne dit pas « oui » à la place du propriétaire.
    expect((await poster(base, chemin, {}, compte(membre.token))).status).toBe(403);
    // Le propriétaire livre — mais pousser écrit avec les identifiants d'une
    // ouvrière, qui a consenti pour la RUCHE, pas pour un compte quelconque.
    const pousse = await poster(base, chemin, { pousser: true }, compte(proprio.token));
    expect(pousse.status).toBe(403);
    expect(((await pousse.json()) as { code: string }).code).toBe('jeton_hote_requis');
    const garde = await poster(base, chemin, {}, compte(proprio.token));
    expect(garde.status).toBe(202);
    const { mergeId } = (await garde.json()) as { mergeId: string };
    const result = await resultatDe(base, project.id, mergeId);
    expect(result.livraison, result.logs).toMatchObject({
      etat: 'commitee',
      poussee: 'non_demandee',
    });
  });

  it('un échec de clone remonte au hub LAVÉ — merge d’essai comme livraison', async () => {
    // Un vrai git, un vrai message de serveur : un dépôt HTTP qui refuse le
    // clone par une ligne `ERR` — ce que font Gitea ou GitLab — et y cite une
    // URL à identifiants. Git la recopie TELLE QUELLE (« fatal: remote error:
    // … ») : il ne masque que les URL qu'il compose lui-même. Ce texte part au
    // hub, donc à tout le tableau de bord.
    const pkt = (t: string): string =>
      `${(Buffer.byteLength(t) + 4).toString(16).padStart(4, '0')}${t}`;
    const refusant = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/x-git-upload-pack-advertisement',
        'cache-control': 'no-cache',
      });
      res.end(
        `${pkt('# service=git-upload-pack\n')}0000` +
          pkt('ERR depot ferme, voir https://moi:jeton-secret@git.exemple.test/d.git\n'),
      );
    });
    await new Promise<void>((r) => refusant.listen(0, '127.0.0.1', () => r()));
    try {
      const port = (refusant.address() as AddressInfo).port;
      const { project } = mission(server, `http://127.0.0.1:${port}/d.git`, [['wh', depot.patchA]]);
      const essai = await poster(base, `/api/projects/${project.id}/merge/run`, {});
      expect(essai.status).toBe(202);
      const { mergeId: idEssai } = (await essai.json()) as { mergeId: string };
      const echec = await resultatDe(base, project.id, idEssai);
      // L'erreur est bien revenue — lavée, pas tue.
      expect(echec.logs).toContain('remote error');
      expect(echec.logs).toContain('https://***@git.exemple.test/d.git');
      expect(echec.logs).not.toContain('jeton-secret');

      const livraison = await poster(base, `/api/projects/${project.id}/livraison-locale`, {});
      expect(livraison.status).toBe(202);
      const { mergeId } = (await livraison.json()) as { mergeId: string };
      const rapport = await resultatDe(base, project.id, mergeId);
      expect(rapport.livraison).toMatchObject({
        etat: 'non_commitee',
        motif: expect.stringContaining('https://***@git.exemple.test/d.git'),
      });
      expect(JSON.stringify(rapport)).not.toContain('jeton-secret');
    } finally {
      refusant.close();
    }
  });

  it('un projet qui appartient à quelqu’un ne se livre pas au seul jeton de ruche', async () => {
    const possede = server.store.createProject({
      name: 'À quelqu’un',
      repoUrl: depot.nu,
      visibility: 'private',
      ownerId: 'u-proprietaire',
    });
    const res = await poster(base, `/api/projects/${possede.id}/livraison-locale`, {});
    // La forme EXACTE de l'inexistence (ADR 0007) : pas un 403 qui confirmerait.
    expect(res.status).toBe(404);
  });
});

describe('livraison locale — ce qu’une vraie ouvrière ne sait pas mal faire', () => {
  let dir: string;
  let server: HiveServer;
  let base: string;
  const sockets: WebSocket[] = [];
  const battements: NodeJS.Timeout[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-livloc-faux-'));
    server = await ruche(dir);
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    for (const c of battements.splice(0)) clearInterval(c);
    for (const ws of sockets.splice(0)) ws.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  /** Un nœud au niveau du protocole, qui retient ce qu'il reçoit. */
  async function noeud(nodeId: string, pousseLivraisons?: boolean) {
    const recus: Record<string, unknown>[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    sockets.push(ws);
    ws.on('message', (d) => recus.push(JSON.parse(d.toString()) as Record<string, unknown>));
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: nodeId,
        ownerName: 't',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId,
        ...(pousseLivraisons !== undefined ? { pousseLivraisons } : {}),
      }),
    );
    const coeur = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'heartbeat', running: 0 }));
    }, 300);
    battements.push(coeur);
    await attendre(async () => recus.some((m) => m.type === 'registered'));
    return { ws, recus };
  }

  /**
   * Ce nœud, et LUI SEUL en ligne. Sous `--sequence.shuffle`, un voisin
   * resté connecté serait choisi à sa place — ou manquerait au banc qui
   * comptait sur lui : chaque banc pose donc sa propre prémisse.
   */
  async function seul(nodeId: string, pousseLivraisons?: boolean) {
    for (const ws of sockets.splice(0)) ws.close();
    const n = await noeud(nodeId, pousseLivraisons);
    await attendre(async () => {
      const etat = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      const enLigne = etat.nodes.filter((x) => x.status === 'online').map((x) => x.id);
      return enLigne.length === 1 && enLigne[0] === nodeId;
    });
    return n;
  }

  it('un nœud qui IGNORE la demande (version antérieure) ne passe pas pour une livraison', async () => {
    const n = await seul('n-ancien');
    const { project } = mission(server, '/depot/fictif-2', [['fb', 'diff']]);
    const res = await poster(base, `/api/projects/${project.id}/livraison-locale`, {});
    expect(res.status).toBe(202);
    const { mergeId, nodeId } = (await res.json()) as { mergeId: string; nodeId: string };
    expect(nodeId).toBe('n-ancien');
    const recu = await attendre(async () =>
      n.recus.find((m) => m.type === 'assign_merge' && m.mergeId === mergeId),
    );
    // La demande part, complète : projet, pas de poussée, provenance par tâche.
    expect(recu.livraison).toMatchObject({
      projectId: project.id,
      pousser: false,
      provenance: [expect.objectContaining({ taskId: 'fb', decision: 'human_review_required' })],
    });
    // Une seule livraison à la fois par projet.
    const doublon = await poster(base, `/api/projects/${project.id}/livraison-locale`, {});
    expect(doublon.status).toBe(409);
    expect(((await doublon.json()) as { code: string }).code).toBe('livraison_en_cours');
    // Le nœud d'avant rend un merge NU, sans rien dire de la livraison.
    n.ws.send(
      JSON.stringify({
        type: 'merge_result',
        mergeId,
        applied: ['fb'],
        conflicts: [],
        mergedDiff: 'diff',
        testsRun: false,
        testsPassed: null,
        logs: 'appliqué',
      }),
    );
    const result = await resultatDe(base, project.id, mergeId);
    expect(result.livraison).toEqual({
      etat: 'non_commitee',
      motif: expect.stringContaining('version de Hive ne sait pas encore livrer'),
    });
  });

  it('une livraison ne partage pas son projet : ni avec un merge d’essai, ni l’inverse', async () => {
    // `/merge/result` garde UN résultat par projet, et l'écran comme la CLI
    // attendent LEUR `mergeId` : un essai qui finirait après la livraison
    // écraserait son rapport, et la branche ne se lirait plus qu'au journal.
    const n = await seul('n-partage');
    const { project } = mission(server, '/depot/fictif-4', [['fd', 'diff']]);
    const essai = await poster(base, `/api/projects/${project.id}/merge/run`, {});
    expect(essai.status).toBe(202);
    const { mergeId: idEssai } = (await essai.json()) as { mergeId: string };
    const pendantEssai = await poster(base, `/api/projects/${project.id}/livraison-locale`, {});
    expect(pendantEssai.status).toBe(409);
    expect(((await pendantEssai.json()) as { code: string }).code).toBe('merge_en_cours');
    await attendre(async () =>
      n.recus.find((m) => m.type === 'assign_merge' && m.mergeId === idEssai),
    );
    n.ws.send(
      JSON.stringify({
        type: 'merge_result',
        mergeId: idEssai,
        applied: ['fd'],
        conflicts: [],
        mergedDiff: 'diff',
        testsRun: false,
        testsPassed: null,
        logs: 'appliqué',
      }),
    );
    await resultatDe(base, project.id, idEssai);
    // Le projet est libre : la livraison part — et c'est l'essai qui attend.
    const livraison = await poster(base, `/api/projects/${project.id}/livraison-locale`, {});
    expect(livraison.status).toBe(202);
    const pendantLivraison = await poster(base, `/api/projects/${project.id}/merge/run`, {});
    expect(pendantLivraison.status).toBe(409);
    expect(((await pendantLivraison.json()) as { code: string }).code).toBe('livraison_en_cours');
  });

  it('l’Evaluator juge la production INTÉGRÉE, pas un essai raté venu après elle', async () => {
    const n = await seul('n-juge');
    const { project, resultIds } = mission(server, '/depot/fictif-5', [['fe', 'diff']]);
    // Un concurrent rend APRÈS la production retenue, et en échec : la tâche
    // reste terminée, sa DERNIÈRE production est ratée — et c'est la
    // précédente, réussie, que le merge intègre. Juger la dernière ferait
    // décider la porte (« rejected ») sur ce qu'on ne livre pas.
    server.store.insertResult({
      taskId: 'fe',
      nodeId: 'seed-concurrent',
      success: false,
      diff: '',
      logs: 'raté',
      durationMs: 1,
      subAgents: [],
    });
    const res = await poster(base, `/api/projects/${project.id}/livraison-locale`, {});
    expect(res.status, await res.clone().text()).toBe(202);
    const { mergeId } = (await res.json()) as { mergeId: string };
    const recu = await attendre(async () =>
      n.recus.find((m) => m.type === 'assign_merge' && m.mergeId === mergeId),
    );
    // Le verdict et le `Hive-Result` nomment la MÊME production.
    expect(recu.livraison).toMatchObject({
      provenance: [
        { taskId: 'fe', resultId: resultIds.get('fe'), decision: 'human_review_required' },
      ],
    });
  });

  it('un forçage que personne n’exécute n’a rien forcé : 503, et rien au journal', async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await attendre(async () => {
      const etat = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
      return etat.nodes.every((x) => x.status !== 'online');
    });
    const { project, resultIds } = mission(server, '/depot/fictif-6', [['ff', 'diff']]);
    server.store.enregistrerInspection({
      resultId: resultIds.get('ff') ?? 0,
      taskId: 'ff',
      nodeId: 'seed',
      verdict: 'suspect',
      score: 1,
      applique: true,
      griefs: [],
    });
    const res = await poster(base, `/api/projects/${project.id}/livraison-locale`, {
      forcer: { raison: 'relu à la main, faux positif' },
    });
    expect(res.status).toBe(503);
    const journal = await evenements(base);
    expect(
      journal.some((e) => e.type === 'evaluator_overridden' && e.payload.projectId === project.id),
    ).toBe(false);
    expect(
      journal.some((e) => e.type === 'merge_started' && e.payload.projectId === project.id),
    ).toBe(false);
  });

  it('une branche rendue trop tard reste au journal — et la suivante ne reprend pas son numéro', async () => {
    const n = await seul('n-tardif');
    const { project } = mission(server, '/depot/fictif-7', [['fg', 'diff']]);
    const chemin = `/api/projects/${project.id}/livraison-locale`;
    const depart = await poster(base, chemin, {});
    expect(depart.status).toBe(202);
    const { mergeId } = (await depart.json()) as { mergeId: string };
    const recu = await attendre(async () =>
      n.recus.find((m) => m.type === 'assign_merge' && m.mergeId === mergeId),
    );
    // Le journal ne connaît encore aucune branche de ce projet.
    expect(recu.livraison).toMatchObject({ numeroMin: 1 });
    // Le nœud se tait : la ruche conclut « inconnue »…
    n.ws.close();
    expect((await resultatDe(base, project.id, mergeId)).livraison?.etat).toBe('inconnue');
    // …puis il revient et rend ce qu'il avait fait : la branche n°3.
    const retour = await noeud('n-tardif');
    const branche = `hive/mission-${project.id}-3`;
    const commit = 'c'.repeat(40);
    retour.ws.send(
      JSON.stringify({
        type: 'merge_result',
        mergeId,
        applied: ['fg'],
        conflicts: [],
        mergedDiff: 'diff',
        testsRun: false,
        testsPassed: null,
        logs: 'appliqué',
        livraison: { etat: 'commitee', branche, commit, poussee: 'non_demandee' },
      }),
    );
    // Le seul endroit où la ruche peut encore dire qu'une branche existe.
    const ignore = await attendre(async () =>
      (await evenements(base)).find(
        (e) => e.type === 'merge_result_ignored' && e.payload.mergeId === mergeId,
      ),
    );
    expect(ignore.payload).toMatchObject({ branche, commit, poussee: 'non_demandee' });
    // Et la livraison suivante part avec ce plancher : n°3 est pris.
    const suite = await poster(base, chemin, {});
    expect(suite.status).toBe(202);
    const { mergeId: idSuite } = (await suite.json()) as { mergeId: string };
    const recuSuite = await attendre(async () =>
      retour.recus.find((m) => m.type === 'assign_merge' && m.mergeId === idSuite),
    );
    expect(recuSuite.livraison).toMatchObject({ numeroMin: 4 });
  });

  it('pousser sans ouvrière consentante est refusé AVANT tout travail, avec la marche à suivre', async () => {
    // Une ouvrière en ligne, qui n'a pas consenti.
    await seul('n-sans-consentement');
    const { project } = mission(server, '/depot/fictif', [['fa', 'diff']]);
    const res = await poster(base, `/api/projects/${project.id}/livraison-locale`, {
      pousser: true,
    });
    expect(res.status).toBe(409);
    const refus = (await res.json()) as { code: string; conseil: string };
    expect(refus.code).toBe('aucun_noeud_consentant');
    expect(refus.conseil).toContain('HIVE_LIVRAISON_POUSSER=1');
  });

  it('un nœud qui REFUSE n’a rien commité ; un nœud qui se TAIT, la ruche n’en sait rien', async () => {
    const n = await seul('n-muet');
    const { project } = mission(server, '/depot/fictif-3', [['fc', 'diff']]);
    const chemin = `/api/projects/${project.id}/livraison-locale`;
    const depart = async (): Promise<string> => {
      const res = await attendre(async () => {
        const r = await poster(base, chemin, {});
        return r.status === 202 ? r : null;
      });
      return ((await res.json()) as { mergeId: string }).mergeId;
    };

    // Un REFUS du nœud (Night Shift, commande refusée) : il n'a rien fait.
    const refuse = await depart();
    await attendre(async () =>
      n.recus.find((m) => m.type === 'assign_merge' && m.mergeId === refuse),
    );
    n.ws.send(
      JSON.stringify({
        type: 'merge_result',
        mergeId: refuse,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: 'hors service',
        refused: 'hors_service',
      }),
    );
    expect((await resultatDe(base, project.id, refuse)).livraison).toEqual({
      etat: 'non_commitee',
      motif: 'merge refusé par le nœud : hors_service',
    });

    // Un nœud qui se TAIT a pu commiter, et même pousser, avant de partir :
    // « non commitée » serait inventé. La ruche dit qu'elle ne sait pas.
    const tu = await depart();
    await attendre(async () => n.recus.find((m) => m.type === 'assign_merge' && m.mergeId === tu));
    n.ws.close();
    const perdu = await resultatDe(base, project.id, tu);
    expect(perdu.livraison).toEqual({
      etat: 'inconnue',
      motif: expect.stringContaining('ne sait pas si la branche a été commitée'),
    });
  });
});
