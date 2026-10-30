// UNE ASSIGNATION QUE LE NŒUD NE SAIT PAS LIRE FINIT VISIBLE — JAMAIS EN SILENCE.
//
// ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
//
// Le nœud lit chaque message du hub avec `parseServerMessage`, qui rend `null`
// pour tout ce qu'il refuse, et `onMessage` laissait tomber ce `null` sans un
// mot : ni réponse à la Reine, ni ligne dans son propre journal. Pour une
// assignation, c'était un travail perdu en silence :
//
//   · une tâche restait `assigned` pour toujours — le filet de re-livraison la
//     re-servait toutes les 15 s, le nœud la jetait à chaque fois ;
//   · un merge ou un chantier attendait le délai de la Reine (« délai
//     dépassé », sans cause) — plus d'une demi-heure.
//
// #551 a durci `isValidRepoUrl` (caractères de contrôle refusés) : un projet
// dont l'URL en porte un — rangé avant, ou créé depuis par la route
// administrateur des chemins locaux, qui ne les refusait pas — tombait
// exactement dans ce trou. Et tout champ hors protocole (un titre trop long
// rangé par un producteur qui ne borne pas, un niveau qu'un nœud plus ancien
// ne connaît pas) y menait de même.
//
// ─── CE QUE CE BANC TIENT, AUX DEUX BOUTS ────────────────────────────────────
//
//   1. Le nœud (un vrai `HiveNodeClient` face à un faux hub) répond à toute
//      assignation illisible le refus que la Reine attend pour CE travail, la
//      cause dite et sans rien recopier du message — ou, sans identifiant sûr,
//      le dit dans son journal.
//   2. La Reine (une vraie, face à un faux nœud) n'envoie pas un dépôt que son
//      propre protocole refuse : la tâche échoue avant tout envoi, le merge,
//      le chantier et la course sont refusés sur le champ, cause dite.
//   3. De bout en bout (vraie Reine, vrai nœud) : le refus du nœud termine la
//      tâche par un échec BORNÉ, et la cause arrive jusqu'au cockpit.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { LIMITS } from '../src/shared/protocol.js';
import { brancherFauxNoeud } from './aide/faux-noeud.js';

const TOKEN = 'jeton-assignation-illisible-assez-long';
/** Le jeton du PROJET, écrit dans son URL : il ne doit sortir nulle part. */
const JETON = 'ghp_JETONDUPROJET0123456789';
/** Une URL telle qu'une base d'avant #551 peut la garder : un saut de ligne. */
const URL_ILLISIBLE = `https://marie:${JETON}@example.invalid/o/r.git\nX`;
const MOTIF_CONTROLE =
  'URL de dépôt du projet illisible (caractère de contrôle) — recréez le projet avec une URL valide';
const MOTIF_HORS_PROTOCOLE =
  'assignation illisible pour ce nœud — versions Reine/nœud différentes, ou champ hors bornes (titre, consigne, plafond)';

const TACHE = {
  id: 'tache-illisible',
  projectId: 'projet-1',
  title: 'Titre',
  prompt: 'faire',
  status: 'assigned',
  dependsOn: [],
  assignedNodeId: 'noeud-banc',
  result: null,
  branch: 'hive/tache-illisible',
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
};

/** Un agent qui ne doit jamais tourner : une assignation illisible ne lance rien. */
const agentQuiNeTournePas = (lancees: string[]): AgentAdapter => ({
  name: 'jamais',
  async run(task) {
    lancees.push(task.id);
    return { success: true, diff: '', logs: '', subAgents: [] };
  },
});

/** `quoi` est relu À L'ÉCHÉANCE : un diagnostic doit dire l'état qui a déçu, pas celui du départ. */
async function attendre<T>(
  lire: () => T | undefined,
  quoi: string | (() => string),
  msMax = 4_000,
): Promise<T> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    const v = lire();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`rien après ${msMax} ms : ${typeof quoi === 'string' ? quoi : quoi()}`);
}

let dir: string | null = null;
let hub: WebSocketServer | null = null;
let client: HiveNodeClient | null = null;
let server: HiveServer | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await client?.stop();
  client = null;
  for (const ws of sockets.splice(0)) ws.close();
  await new Promise<void>((r) => (hub ? hub.close(() => r()) : r()));
  hub = null;
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  dir = null;
});

describe('le nœud dit ce qu’il ne sait pas lire', () => {
  /**
   * Un faux hub qui envoie UNE assignation juste après l'inscription, et un
   * vrai nœud en face. Rend ce que le nœud renvoie au hub et les lignes de
   * son journal — `quiet: false`, c'est là qu'on lit le cas sans identifiant.
   */
  async function noeudFaceA(
    assignation: Record<string, unknown>,
    adapter?: AgentAdapter,
  ): Promise<{
    recus: Record<string, unknown>[];
    lignes: string[];
    lancees: string[];
    /** Un message de plus du hub, après l'assignation. */
    envoyer: (m: Record<string, unknown>) => void;
  }> {
    const recus: Record<string, unknown>[] = [];
    const lignes: string[] = [];
    const lancees: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
      lignes.push(parts.map(String).join(' '));
    });
    hub = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((r) => hub!.once('listening', () => r()));
    const port = (hub.address() as AddressInfo).port;
    let socket: WebSocket | null = null;
    hub.on('connection', (ws) => {
      socket = ws;
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as Record<string, unknown>;
        recus.push(m);
        if (m.type === 'register') {
          ws.send(JSON.stringify({ type: 'registered', nodeId: 'noeud-banc' }));
          ws.send(JSON.stringify(assignation));
        }
      });
    });
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-illisible-noeud-'));
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${port}`,
      token: TOKEN,
      name: 'banc',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter: adapter ?? agentQuiNeTournePas(lancees),
      quiet: false,
    });
    await client.start();
    return { recus, lignes, lancees, envoyer: (m) => socket?.send(JSON.stringify(m)) };
  }

  /** Ni le jeton ni l'adresse ne doivent sortir : ni vers la Reine, ni au journal. */
  function rienNeFuit(recus: Record<string, unknown>[], lignes: string[]): void {
    const sorti = JSON.stringify(recus) + lignes.join('\n');
    expect(sorti, 'le jeton du projet est sorti').not.toContain(JETON);
    expect(sorti, 'l’adresse du dépôt est sortie').not.toContain('example.invalid');
  }

  it('UN assign_task AU DÉPÔT ILLISIBLE EST REFUSÉ À LA REINE — cause dite, jeton tu', async () => {
    const { recus, lignes, lancees } = await noeudFaceA({
      type: 'assign_task',
      task: TACHE,
      repoUrl: URL_ILLISIBLE,
    });
    const refus = await attendre(
      () => recus.find((m) => m.type === 'task_reject'),
      'le nœud n’a rien répondu à la Reine',
    );
    // Un refus d'infrastructure AVANT l'agent : la Reine tente ailleurs sans
    // brûler de tentative ni écarter de modèle, et conclut au bout de sa borne.
    // `illisible` : ce n'est pas une panne de ce nœud.
    expect(refus).toEqual({
      type: 'task_reject',
      taskId: TACHE.id,
      reason: MOTIF_CONTROLE,
      infra: true,
      avantAgent: true,
      illisible: true,
    });
    expect(lignes.join('\n')).toContain(`assignation illisible (assign_task) : ${MOTIF_CONTROLE}`);
    expect(lancees, 'une assignation illisible ne lance aucun agent').toEqual([]);
    rienNeFuit(recus, lignes);
  });

  it('UN assign_merge AU DÉPÔT ILLISIBLE REVIENT REFUSÉ — le merge n’a pas eu lieu', async () => {
    const { recus, lignes } = await noeudFaceA({
      type: 'assign_merge',
      mergeId: 'merge-illisible',
      repoUrl: URL_ILLISIBLE,
      diffs: [{ taskId: 't1', diff: 'diff --git a/x b/x\n' }],
    });
    const rendu = await attendre(
      () => recus.find((m) => m.type === 'merge_result'),
      'le nœud n’a rendu aucun merge_result',
    );
    expect(rendu).toEqual({
      type: 'merge_result',
      mergeId: 'merge-illisible',
      applied: [],
      conflicts: [],
      mergedDiff: '',
      testsRun: false,
      testsPassed: null,
      logs: `[nœud] ${MOTIF_CONTROLE}`,
      refused: MOTIF_CONTROLE,
    });
    rienNeFuit(recus, lignes);
  });

  it('UN assign_chantier AU DÉPÔT ILLISIBLE REVIENT REFUSÉ — rien n’a tourné', async () => {
    const { recus, lignes } = await noeudFaceA({
      type: 'assign_chantier',
      chantierId: 'chantier-illisible',
      repoUrl: URL_ILLISIBLE,
      nom: 'test',
    });
    const rendu = await attendre(
      () => recus.find((m) => m.type === 'chantier_result'),
      'le nœud n’a rendu aucun chantier_result',
    );
    expect(rendu).toEqual({
      type: 'chantier_result',
      chantierId: 'chantier-illisible',
      nom: 'test',
      code: null,
      sortie: `[nœud] ${MOTIF_CONTROLE}`,
      ok: false,
      refused: MOTIF_CONTROLE,
    });
    rienNeFuit(recus, lignes);
  });

  it('ILLISIBLE POUR UNE AUTRE CAUSE (un niveau que ce nœud ne connaît pas) : refusée quand même', async () => {
    // Un hub plus récent qui envoie un effort neuf : rien à voir avec le dépôt,
    // et la cause générique dit les deux gestes — aligner les versions, ou
    // tenir les bornes.
    const { recus } = await noeudFaceA({
      type: 'assign_task',
      task: TACHE,
      repoUrl: null,
      effort: 'au-dela-de-tout',
    });
    const refus = await attendre(
      () => recus.find((m) => m.type === 'task_reject'),
      'le nœud n’a rien répondu à la Reine',
    );
    expect(refus).toMatchObject({ taskId: TACHE.id, reason: MOTIF_HORS_PROTOCOLE, infra: true });
  });

  it('RIEN DE SÛR À QUOI RÉPONDRE : une ligne au journal du nœud, aucun refus inventé', async () => {
    // Un identifiant de traversée ne se renvoie pas : la Reine ne saurait de
    // toute façon pas à quelle tâche le rattacher. Le nœud le dit chez lui.
    const { recus, lignes } = await noeudFaceA({
      type: 'assign_task',
      task: { ...TACHE, id: '../evasion' },
      repoUrl: URL_ILLISIBLE,
    });
    await attendre(
      () => lignes.find((l) => l.includes('assignation illisible (assign_task)')),
      'aucune ligne au journal du nœud',
    );
    expect(lignes.join('\n')).toContain('aucun identifiant sûr');
    expect(recus.filter((m) => m.type === 'task_reject')).toEqual([]);
    rienNeFuit(recus, lignes);
  });

  it('UN DOUBLON ILLISIBLE D’UN TRAVAIL QUI TOURNE ICI N’EST PAS REFUSÉ — pas de double exécution', async () => {
    // Le filet de re-livraison de la Reine re-sert une tâche restée `assigned`
    // en comptant sur une règle du nœud : un doublon s'ignore (`runTask`). Un
    // doublon ILLISIBLE y échappait : le refus partait pour la tâche EN COURS,
    // que la Reine prend (`rejectTask` accepte `running`) — remise en file, et
    // un second nœud la referait pendant que celui-ci la finit.
    let liberer!: () => void;
    const relache = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    const demarrees: string[] = [];
    const lent: AgentAdapter = {
      name: 'lent',
      async run(task, ctx) {
        demarrees.push(task.id);
        // Libéré par le banc, ou par l'arrêt du nœud si une assertion tombe avant.
        await Promise.race([
          relache,
          new Promise<void>((r) => ctx.signal.addEventListener('abort', () => r(), { once: true })),
        ]);
        return { success: true, diff: '', logs: '', subAgents: [] };
      },
    };
    const { recus, lignes, envoyer } = await noeudFaceA(
      { type: 'assign_task', task: TACHE, repoUrl: null },
      lent,
    );
    await attendre(
      () => (demarrees.includes(TACHE.id) ? true : undefined),
      'l’agent de la tâche valide n’a pas démarré',
    );
    envoyer({ type: 'assign_task', task: TACHE, repoUrl: URL_ILLISIBLE });
    await attendre(
      () => lignes.find((l) => l.includes('assignation illisible (assign_task)')),
      'aucune ligne au journal du nœud pour le doublon',
    );
    expect(lignes.join('\n')).toContain('ce travail tourne déjà ici, aucun refus envoyé');
    // La tentative en cours, elle, va au bout et rend son résultat.
    liberer();
    await attendre(
      () => recus.find((m) => m.type === 'task_result' && m.taskId === TACHE.id),
      'la tâche en cours n’a rendu aucun résultat',
      10_000,
    );
    // Lu APRÈS le résultat : une socket garde l'ordre, tout refus parti avant
    // lui est arrivé.
    expect(
      recus.filter((m) => m.type === 'task_reject'),
      'un refus est parti pour la tâche en cours',
    ).toEqual([]);
    rienNeFuit(recus, lignes);
  });
});

describe('la Reine n’envoie pas un dépôt que son protocole refuse', () => {
  /** Une Reine sur `dir/data/hive.db` — la base qu'un banc a déjà rangée, s'il l'a fait. */
  async function ruche(tickMs = 50): Promise<HiveServer> {
    dir ??= mkdtempSync(path.join(os.tmpdir(), 'hive-illisible-reine-'));
    mkdirSync(path.join(dir, 'data', 'cerveau'), { recursive: true });
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'data', 'hive.db'),
      simulation: true,
      tickMs,
    });
    return server;
  }

  /** Un nœud vivant qui retient ce qu'on lui confie. */
  async function noeud(srv: HiveServer): Promise<Record<string, unknown>[]> {
    const recus: Record<string, unknown>[] = [];
    const { ws } = await brancherFauxNoeud<{ type: string } & Record<string, unknown>>(
      srv.port,
      {
        token: TOKEN,
        name: 'ouvriere',
        ownerName: 't',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: 'ouvriere',
      },
      (m) => recus.push(m),
    );
    sockets.push(ws);
    return recus;
  }

  const poster = (srv: HiveServer, chemin: string, corps: unknown = {}): Promise<Response> =>
    fetch(`http://127.0.0.1:${srv.port}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify(corps),
    });

  const confies = (recus: Record<string, unknown>[]): string[] =>
    recus.map((m) => String(m.type)).filter((t) => t.startsWith('assign_'));

  it('UNE TÂCHE AU DÉPÔT ILLISIBLE ÉCHOUE AVANT TOUT ENVOI, sa cause au journal', async () => {
    const srv = await ruche();
    const recus = await noeud(srv);
    // Rangé comme une base d'avant #551 le garde : la route de création, elle,
    // refuse désormais cette URL.
    const projet = srv.store.createProject({ name: 'Ancien', repoUrl: URL_ILLISIBLE });
    const t = srv.store.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });

    await attendre(
      () => (srv.store.getTask(t.id)?.status === 'failed' ? true : undefined),
      () =>
        `la tâche n’a pas échoué (statut ${srv.store.getTask(t.id)?.status}, reçu par le ` +
        `nœud : ${confies(recus).join(', ') || 'rien'})`,
    );
    const echec = srv.store.evenementsDeTache(t.id, ['task_failed'])[0];
    expect(echec?.payload).toMatchObject({ reason: 'depot_illisible', motif: MOTIF_CONTROLE });
    expect(confies(recus), 'la Reine a envoyé une assignation illisible').toEqual([]);
    expect(JSON.stringify(srv.store.listEvents(0, 1000))).not.toContain(JETON);
  });

  it('UNE TÂCHE `assigned` D’AVANT, LA REINE REDÉMARRE : remise en file, échouée UNE fois', async () => {
    // La population réelle du défaut : une tâche qu'une Reine d'avant a
    // confiée, et que chaque nœud jetait — `assigned` pour toujours. La base
    // est rangée telle qu'elle l'a laissée, puis la Reine redémarre dessus :
    // `recoverAtBoot` remet la tâche `ready`, la garde de la passe l'échoue
    // avant tout envoi — une fois, pas à chaque passe.
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-illisible-boot-'));
    mkdirSync(path.join(dir, 'data'), { recursive: true });
    const avant = new HiveStore(path.join(dir, 'data', 'hive.db'));
    const projet = avant.createProject({ name: 'Ancien', repoUrl: URL_ILLISIBLE });
    const t = avant.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
    avant.patchTask(t.id, { status: 'assigned', assignedNodeId: 'ouvriere' });
    avant.close();

    // Un tick d'une heure : les passes sont celles qu'on joue, un nœud en ligne.
    const srv = await ruche(3_600_000);
    const recus = await noeud(srv);
    for (let i = 0; i < 3; i++) srv.scheduler.tick();

    expect(srv.store.getTask(t.id)?.status, 'la tâche n’a pas échoué au redémarrage').toBe(
      'failed',
    );
    const reprises = srv.store.evenementsDeTache(t.id, ['task_requeued']);
    expect(reprises.map((e) => e.payload.reason)).toEqual(['boot_recovery']);
    const echecs = srv.store.evenementsDeTache(t.id, ['task_failed']);
    expect(echecs, 'une tâche close doit l’être une seule fois').toHaveLength(1);
    expect(echecs[0]?.payload).toMatchObject({ reason: 'depot_illisible', motif: MOTIF_CONTROLE });
    expect(confies(recus), 'la Reine a envoyé une assignation illisible').toEqual([]);
  });

  it('NI MERGE NI COURSE SUR CE DÉPÔT : refus immédiat, motif dit', async () => {
    // Un tick d'une heure : la passe de l'ordonnanceur échouerait la tâche
    // avant la course, et c'est la porte de la COURSE qu'on éprouve ici.
    const srv = await ruche(3_600_000);
    const recus = await noeud(srv);
    const projet = srv.store.createProject({ name: 'Ancien', repoUrl: URL_ILLISIBLE });
    // Une production terminée, de quoi intégrer : sans elle le merge
    // s'arrêterait avant sa porte.
    srv.store.createTask({ id: 'fait', projectId: projet.id, title: 'fait', prompt: 'p' });
    srv.store.patchTask('fait', { status: 'done' });
    srv.store.insertResult({
      taskId: 'fait',
      nodeId: 'seed',
      success: true,
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    const merge = await poster(srv, `/api/projects/${projet.id}/merge/run`);
    expect(merge.status, 'le merge est parti').toBe(409);
    expect(await merge.json()).toMatchObject({ code: 'depot_illisible', error: MOTIF_CONTROLE });

    const prete = srv.store.createTask({ projectId: projet.id, title: 'P', prompt: 'p' });
    srv.store.patchTask(prete.id, { status: 'ready' });
    const course = await poster(srv, `/api/tasks/${prete.id}/race`, { factor: 2 });
    expect(course.status, 'la course est partie').toBe(409);
    expect(((await course.json()) as { error: string }).error).toBe(
      `${MOTIF_CONTROLE} — course refusée`,
    );
    expect(confies(recus), 'la Reine a envoyé une assignation illisible').toEqual([]);
  });

  it('UN CHANTIER SUR UN CHEMIN LOCAL AU CARACTÈRE DE CONTRÔLE EST REFUSÉ', async () => {
    // Le cas atteignable aujourd'hui : un chemin local d'administrateur qui
    // porte un caractère de contrôle. Le dépôt EXISTE et se copie — le miroir
    // n'y voyait rien —, puis le nœud jetait l'assignation sans un mot. DEL
    // plutôt qu'une tabulation : Windows refuse les codes 1 à 31 dans un nom.
    const srv = await ruche();
    const recus = await noeud(srv);
    const depot = path.join(dir!, 'dé\u007fpôt');
    mkdirSync(depot);
    writeFileSync(
      path.join(depot, 'package.json'),
      JSON.stringify({ name: 'c', scripts: { test: 'node -e 0' } }),
    );
    const { simpleGit } = await import('simple-git');
    const g = simpleGit({ baseDir: depot });
    await g.init();
    await g.addConfig('user.email', 't@example.com');
    await g.addConfig('user.name', 'T');
    await g.addConfig('commit.gpgsign', 'false');
    await g.add('.');
    await g.commit('initial');
    const projet = srv.store.createProject({ name: 'Local', repoUrl: depot });

    const rep = await poster(srv, `/api/projects/${projet.id}/chantiers/test/run`);
    expect(rep.status, 'le chantier est parti').toBe(409);
    expect(((await rep.json()) as { error: string }).error).toBe(
      'URL de dépôt du projet illisible (caractère de contrôle) — recréez le projet avec une URL valide',
    );
    expect(confies(recus), 'la Reine a envoyé une assignation illisible').toEqual([]);
  });
});

describe('de bout en bout : le refus du nœud termine la tâche, cause dite', () => {
  it(
    'UN TITRE HORS PROTOCOLE : refus du nœud, échec borné, la cause jusqu’au cockpit',
    { timeout: 40_000 },
    async () => {
      // Un champ que la Reine laisse passer et que le nœud refuse : un titre
      // au-delà de `LIMITS.title`, comme en range tout producteur qui ne borne
      // pas. Ici, rien côté Reine ne l'arrête — c'est le refus du NŒUD qui
      // doit conduire à une issue.
      dir = mkdtempSync(path.join(os.tmpdir(), 'hive-illisible-e2e-'));
      mkdirSync(path.join(dir, 'data', 'cerveau'), { recursive: true });
      const srv = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(dir, 'data', 'hive.db'),
        simulation: true,
        tickMs: 50,
      });
      server = srv;
      const lancees: string[] = [];
      client = new HiveNodeClient({
        url: `ws://127.0.0.1:${srv.port}/ws`,
        token: TOKEN,
        name: 'vrai-noeud',
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
        workRoot: path.join(dir, 'work'),
        adapter: agentQuiNeTournePas(lancees),
        quiet: true,
      });
      await client.start();
      const projet = srv.store.createProject({ name: 'Sans dépôt' });
      const t = srv.store.createTask({
        projectId: projet.id,
        title: 'x'.repeat(LIMITS.title + 1),
        prompt: 'p',
      });
      srv.store.patchTask(t.id, { status: 'ready' });

      await attendre(
        () => (srv.store.getTask(t.id)?.status === 'failed' ? true : undefined),
        () =>
          `la tâche n’a pas fini (statut ${srv.store.getTask(t.id)?.status}, refus reçus : ` +
          `${srv.store.evenementsDeTache(t.id, ['task_rejected']).length})`,
        30_000,
      );
      const refus = srv.store.evenementsDeTache(t.id, ['task_rejected']);
      expect(refus.length, 'aucun refus du nœud n’est arrivé').toBeGreaterThan(0);
      for (const r of refus) {
        expect(r.payload).toMatchObject({
          reason: MOTIF_HORS_PROTOCOLE,
          infra: true,
          avantAgent: true,
          illisible: true,
        });
      }
      const echec = srv.store.evenementsDeTache(t.id, ['task_failed'])[0];
      expect(echec?.payload.reason).toBe('no_working_agent');
      expect(lancees, 'une assignation illisible ne lance aucun agent').toEqual([]);

      const lire = async (chemin: string): Promise<unknown> =>
        (
          await fetch(`http://127.0.0.1:${srv.port}${chemin}`, {
            headers: { 'x-hive-token': TOKEN },
          })
        ).json();
      // Ces refus disent une borne, pas un agent ni un poste en panne : la
      // ruche ne chauffe pas, et le nœud n'est pas un fantôme d'infrastructure.
      const thermo = (await lire('/api/thermo')) as {
        instantane: { signaux: { refusInfra: number } };
      };
      expect(thermo.instantane.signaux.refusInfra).toBe(0);
      const fantomes = (await lire('/api/ghost')) as { ghosts: Array<{ kind: string }> };
      expect(fantomes.ghosts.map((g) => g.kind)).not.toContain('infra_node');

      const cockpit = (await lire('/api/cockpit')) as { alertes: Record<string, unknown>[] };
      expect(cockpit.alertes).toContainEqual(
        expect.objectContaining({
          genre: 'refus',
          taskId: t.id,
          definitif: true,
          avantAgent: true,
          raison: MOTIF_HORS_PROTOCOLE,
        }),
      );
    },
  );
});
