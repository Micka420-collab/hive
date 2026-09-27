// Le graphe d'expérience, branché sur une vraie Reine.
//
// `graphe-experience.test.ts` éprouve la projection. Ce fichier répond aux
// questions qu'un module pur ne peut pas trancher :
//
//   · une VRAIE ouvrière reçoit-elle les contextes similaires, encadrés comme
//     données, et SEULEMENT ceux de son projet tant que l'hôte n'a pas fédéré ?
//   · l'explication du routage relit-elle ce que l'ouvrière a reçu ?
//   · la signature d'erreur d'une reprise compte-t-elle, alors que la
//     projection mémoïsée ne l'a pas encore vue ?
//   · les routes gardent-elles la frontière : un projet isolé à lui-même, la
//     ruche entière réservée à qui voit tous les projets ?

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { dossierDe, ecrire, idEpisode } from '../src/cerveau-reel.js';
import { signatureEchec } from '../src/orchestrator/essaim.js';
import { createServer, loadConfigFromEnv } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { HiveStore } from '../src/orchestrator/store.js';
import { EXPERIENCE_CONTEXT_HEADER } from '../src/shared/graphe-experience.js';
import type { NoeudExperience } from '../src/shared/graphe-experience.js';
import type { AffectationVue } from '../src/shared/routage-vue.js';
import type { PorteeExperience } from '../src/shared/reglages.js';

const TOKEN = 'jeton-graphe-experience-assez-long';

interface Assignation {
  type: string;
  hiveContext?: string;
  task?: { id: string };
}

/**
 * Le passé de la ruche, rangé comme la Reine le range : des tâches closes et
 * les faits du journal. Aucune tâche active — l'ordonnanceur n'a rien à en
 * faire, et l'ouvrière du banc ne reçoit que la tâche du test.
 */
function semer(store: HiveStore, projetA: string, projetB: string): void {
  const passee = (id: string, projectId: string, title: string, status: 'done' | 'failed') => {
    store.createTask({ id, projectId, title, prompt: `${title} — voir src/auth.ts` });
    store.patchTask(id, { status });
    store.appendEvent('task_created', { taskId: id, projectId, title });
  };
  passee('passe-a', projetA, 'Corriger le module TITRE-DU-PROJET-A', 'done');
  store.appendEvent('task_assigned', { taskId: 'passe-a', nodeId: 'ancienne', modele: 'opus' });
  store.appendEvent('task_done', { taskId: 'passe-a', nodeId: 'ancienne', resultId: 7_001 });
  passee('passe-b', projetB, 'Réparer TITRE-DU-PROJET-B', 'failed');
  store.appendEvent('task_assigned', { taskId: 'passe-b', nodeId: 'ancienne' });
  store.appendEvent('task_failed', { taskId: 'passe-b', nodeId: 'ancienne', resultId: 7_002 });
  store.appendEvent('cerveau_episode', { taskId: 'passe-b', note: 'ep-partage' });
}

describe('le graphe d’expérience arrive jusqu’à l’ouvrière', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.close();
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(porteeExperience?: PorteeExperience): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-exp-w-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60,
      ...(porteeExperience ? { porteeExperience } : {}),
    });
    return server;
  }

  async function brancherNoeud(srv: HiveServer, nodeId: string): Promise<Assignation[]> {
    const recues: Assignation[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Assignation;
      if (msg.type === 'assign_task') recues.push(msg);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: nodeId,
        ownerName: 'banc',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId,
      }),
    );
    return recues;
  }

  /** Attend ce qu'on attend, jamais un délai deviné. */
  async function attendre<T>(lire: () => T | undefined, quoi: string, ms = 8_000): Promise<T> {
    const fin = Date.now() + ms;
    for (;;) {
      const v = lire();
      if (v !== undefined) return v;
      if (Date.now() > fin) throw new Error(`jamais arrivé : ${quoi}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  /** Le bloc du graphe, seul : de son en-tête à la fermeture de SES données. */
  const blocExperienceDe = (contexte: string): string => {
    const debut = contexte.indexOf(EXPERIENCE_CONTEXT_HEADER);
    expect(debut, 'aucun bloc d’expérience').toBeGreaterThanOrEqual(0);
    const fin = contexte.indexOf('HIVE_DATA>>>', debut);
    return contexte.slice(debut, fin);
  };

  const evenements = (srv: HiveServer, type: string, taskId: string) =>
    srv.store.listEvents(0, 1_000).filter((e) => e.type === type && e.payload.taskId === taskId);

  /** Deux projets et leur passé ; la tâche du test, prête, dans le projet A. */
  function preparer(srv: HiveServer): string {
    const a = srv.store.createProject({ name: 'Projet A' }).id;
    const b = srv.store.createProject({ name: 'Projet B' }).id;
    semer(srv.store, a, b);
    // Le souvenir de la tâche passée, chez Hive Mind : le graphe ne doit pas
    // le recopier (il nomme la tâche, il ne raconte pas ce qu'elle a produit).
    srv.store.recordMemory({
      projectId: a,
      taskId: 'passe-a',
      title: 'Corriger le module TITRE-DU-PROJET-A',
      content: 'CONTENU-DU-SOUVENIR-UNIQUE : le jeton de src/auth.ts expirait trop tôt',
    });
    const t = srv.store.createTask({
      projectId: a,
      title: 'Durcir la connexion',
      prompt: 'Vérifier le jeton dans src/auth.ts',
    });
    srv.store.patchTask(t.id, { status: 'ready' });
    return t.id;
  }

  it(
    'ISOLÉ PAR DÉFAUT : l’ouvrière de A lit l’expérience de A, comme une donnée — rien de B',
    { timeout: 20_000 },
    async () => {
      const srv = await demarrer();
      const recues = await brancherNoeud(srv, 'ouvriere-a');
      const tache = preparer(srv);
      const a = await attendre(() => recues[0], 'assign_task');
      expect(a.task?.id).toBe(tache);

      const contexte = a.hiveContext ?? '';
      expect(contexte, 'aucun contexte similaire joint').toContain(EXPERIENCE_CONTEXT_HEADER);
      expect(contexte).toContain('TITRE-DU-PROJET-A');
      expect(contexte, 'la tâche de B a fui dans le prompt de A').not.toContain(
        'TITRE-DU-PROJET-B',
      );
      // Encadré comme toute donnée non fiable : la consigne, puis le bloc.
      const bloc = blocExperienceDe(contexte);
      expect(bloc).toMatch(/SÉCURITÉ/);
      expect(bloc.indexOf('<<<HIVE_DATA')).toBeGreaterThan(bloc.indexOf('SÉCURITÉ'));
      // Il ne duplique pas Hive Mind : le souvenir arrive UNE fois, par Hive
      // Mind, et le bloc du graphe n'en porte pas un mot.
      expect(contexte.split('CONTENU-DU-SOUVENIR-UNIQUE')).toHaveLength(2);
      expect(bloc).not.toContain('CONTENU-DU-SOUVENIR-UNIQUE');

      // Journalisé en faits typés, sans le texte.
      const [fait] = evenements(srv, 'experience_context', tache);
      expect(fait?.payload).toMatchObject({ portee: 'projet', nodeId: 'ouvriere-a' });
      const similaires = fait?.payload.similaires as Array<Record<string, unknown>>;
      expect(similaires.map((s) => s.taskId)).toEqual(['passe-a']);
      expect(similaires[0]).toMatchObject({
        fichiers: ['src/auth.ts'],
        rendue: true,
        memeProjet: true,
        titre: 'Corriger le module TITRE-DU-PROJET-A',
      });
      // Le titre, parce que c'est ce que l'ouvrière a lu — jamais le prompt.
      expect(JSON.stringify(fait?.payload)).not.toContain('— voir');

      // L'explication du routage relit ce que l'ouvrière a reçu.
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${tache}/routage`, {
        headers: { 'x-hive-token': TOKEN },
      });
      const { affectations } = (await r.json()) as { affectations: AffectationVue[] };
      expect(affectations[0]?.experience).toMatchObject({
        etat: 'jointe',
        portee: 'projet',
        similaires: [{ taskId: 'passe-a', rendue: true }],
      });
    },
  );

  it(
    'FÉDÉRÉ PAR L’HÔTE : la même tâche lit aussi l’expérience de B, dite « un autre projet »',
    { timeout: 20_000 },
    async () => {
      const srv = await demarrer('ruche');
      const recues = await brancherNoeud(srv, 'ouvriere-f');
      const tache = preparer(srv);
      const a = await attendre(() => recues[0], 'assign_task');
      expect(a.task?.id).toBe(tache);
      expect(a.hiveContext).toContain('TITRE-DU-PROJET-A');
      expect(a.hiveContext).toContain('TITRE-DU-PROJET-B');
      expect(a.hiveContext).toContain('un autre projet de la ruche');
      const [fait] = evenements(srv, 'experience_context', tache);
      expect(fait?.payload.portee).toBe('ruche');
      const similaires = fait?.payload.similaires as Array<Record<string, unknown>>;
      // Rangé sous la tâche de A, relu par tout lecteur de A : la voisine de B
      // y est dite « autre projet », jamais nommée — ni id, ni projet, ni titre.
      const autre = similaires.find((s) => s.memeProjet === false);
      expect(autre).toBeDefined();
      expect(autre).not.toHaveProperty('taskId');
      expect(autre).not.toHaveProperty('projectId');
      expect(autre).not.toHaveProperty('titre');
      const brut = JSON.stringify(fait?.payload);
      for (const deB of ['TITRE-DU-PROJET-B', 'passe-b']) expect(brut).not.toContain(deB);
      // Le tiroir la relit quand même : l'ouvrière l'a lue.
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${tache}/routage`, {
        headers: { 'x-hive-token': TOKEN },
      });
      const { affectations } = (await r.json()) as { affectations: AffectationVue[] };
      expect(affectations[0]?.experience?.similaires).toContainEqual(
        expect.objectContaining({ taskId: null, memeProjet: false, titre: null }),
      );
    },
  );

  it(
    'UNE REPRISE SE RAPPROCHE PAR SA SIGNATURE D’ERREUR, même trois secondes après l’échec',
    { timeout: 30_000 },
    async () => {
      // La tâche du test ne nomme AUCUN fichier : seule l'erreur qu'elle va
      // rencontrer peut la rapprocher de la tâche passée. Et sa reprise part
      // aussitôt — bien avant que la projection mémoïsée ne soit relue.
      const srv = await demarrer();
      const logs = 'Error: JETON_EXPIRE_SIGNATURE_UNIQUE pendant la connexion';
      const note = idEpisode(signatureEchec(logs));
      const projet = srv.store.createProject({ name: 'Projet' }).id;
      srv.store.createTask({ id: 'deja-vu', projectId: projet, title: 'DEJA-VU', prompt: 'p' });
      srv.store.patchTask('deja-vu', { status: 'done' });
      srv.store.appendEvent('task_done', { taskId: 'deja-vu', nodeId: 'x', resultId: 9_001 });
      srv.store.appendEvent('cerveau_episode', { taskId: 'deja-vu', note });

      const recues = await brancherNoeud(srv, 'ouvriere-r');
      const t = srv.store.createTask({ projectId: projet, title: 'Se connecter', prompt: 'p' });
      srv.store.patchTask(t.id, { status: 'ready' });
      const premiere = await attendre(() => recues[0], 'première assignation');
      expect(premiere.hiveContext ?? '', 'rien à rapprocher avant l’échec').not.toContain(
        'DEJA-VU',
      );

      (sockets[0] as WebSocket).send(
        JSON.stringify({
          type: 'task_result',
          taskId: t.id,
          success: false,
          diff: '',
          logs,
          durationMs: 5,
          subAgents: [],
        }),
      );
      const reprise = await attendre(() => recues[1], 'la reprise');
      expect(reprise.task?.id).toBe(t.id);
      const bloc = blocExperienceDe(reprise.hiveContext ?? '');
      expect(bloc).toContain('DEJA-VU');
      // Il ne duplique pas la Couveuse : les logs de l'échec y sont, pas ici.
      expect(reprise.hiveContext).toContain('Couveuse');
      expect(bloc).not.toContain('JETON_EXPIRE_SIGNATURE_UNIQUE');
      // Et l'échec lui-même a nommé son résultat dans le journal.
      const [echec] = [
        ...evenements(srv, 'task_retry', t.id),
        ...evenements(srv, 'task_failed', t.id),
      ];
      expect(echec?.payload.resultId).toBe(srv.store.resultsForTask(t.id).at(-1)?.resultId);
    },
  );

  it('UNE PRODUCTION RENDUE NOMME SON RÉSULTAT au journal', { timeout: 20_000 }, async () => {
    // Sans ce fait, un avis ou une validation portant un `resultId` ne se
    // rattachait à aucune issue : le graphe ne pouvait pas dire que la
    // production relue est CELLE qui a été rendue.
    const srv = await demarrer();
    const recues = await brancherNoeud(srv, 'ouvriere-d');
    const projet = srv.store.createProject({ name: 'P' }).id;
    const t = srv.store.createTask({ projectId: projet, title: 'Une tâche', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });
    await attendre(() => recues[0], 'assign_task');
    (sockets[0] as WebSocket).send(
      JSON.stringify({
        type: 'task_result',
        taskId: t.id,
        success: true,
        diff: 'diff --git a/x b/x\n+y',
        logs: 'ok',
        durationMs: 5,
        subAgents: [],
      }),
    );
    const fait = await attendre(() => evenements(srv, 'task_done', t.id)[0], 'task_done');
    expect(fait.payload.resultId).toBe(srv.store.resultsForTask(t.id).at(-1)?.resultId);
    expect(typeof fait.payload.resultId).toBe('number');
  });

  it('le réglage vient du `.env` de l’hôte, et l’isolement est le défaut', () => {
    expect(loadConfigFromEnv({ HIVE_EXPERIENCE_PORTEE: 'ruche' }).porteeExperience).toBe('ruche');
    expect(loadConfigFromEnv({}).porteeExperience).toBe('projet');
    expect(loadConfigFromEnv({ HIVE_EXPERIENCE_PORTEE: 'Ruche' }).porteeExperience).toBe('projet');
  });
});

describe('les routes du graphe d’expérience gardent la frontière', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let admin = '';
  let proprio = '';
  let tiers = '';
  let projetA = '';
  let projetB = '';

  const inscrire = async (email: string): Promise<{ token: string; id: string }> => {
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    const { token } = (await r.json()) as { token: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { id: string };
    return { token, id: moi.id };
  };

  const lire = (chemin: string, entetes: Record<string, string>) =>
    fetch(`${base}${chemin}`, { headers: entetes });
  const compte = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-exp-r-'));
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
    // ⚠ Le premier compte est administrateur par amorçage.
    admin = (await inscrire('admin@exp.test')).token;
    const p = await inscrire('proprio@exp.test');
    proprio = p.token;
    tiers = (await inscrire('tiers@exp.test')).token;
    projetA = server.store.createProject({ name: 'A', visibility: 'private', ownerId: p.id }).id;
    server.store.addMember(projetA, p.id, 'owner');
    projetB = server.store.createProject({ name: 'B' }).id;
    semer(server.store, projetA, projetB);
    // Une seconde tâche de A qui ressemble à la première : le voisinage d'une
    // tâche doit avoir quelque chose à rapprocher DANS le projet.
    server.store.createTask({
      id: 'voisine-a',
      projectId: projetA,
      title: 'Voisine',
      prompt: 'src/auth.ts',
    });
    server.store.patchTask('voisine-a', { status: 'done' });
    server.store.appendEvent('task_done', { taskId: 'voisine-a', nodeId: 'n', resultId: 7_003 });
    // A a aussi rencontré la panne de B. Le Cerveau en garde UNE note, que
    // `enregistrerEpisode` retitre avec la dernière tâche tombée — celle de B ;
    // et une leçon écrite à la main la cite. Ni l'un ni l'autre titre ne se lit
    // avec le seul droit de lire A.
    server.store.appendEvent('cerveau_episode', { taskId: 'passe-a', note: 'ep-partage' });
    const dossier = dossierDe(path.join(dir, 'hive.db'));
    const creee = new Date().toISOString();
    for (const n of [
      { id: 'ep-partage', genre: 'episode', titre: 'Réparer TITRE-DU-PROJET-B', corps: 'x' },
      { id: 'lecon-partage', genre: 'lecon', titre: 'LECON-DU-CERVEAU', corps: '[[ep-partage]]' },
    ] as const) {
      expect(ecrire(dossier, { ...n, etiquettes: [], creee, recurrences: 1 })).not.toBeNull();
    }
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('LE GRAPHE D’UN PROJET NE MONTRE QUE CE PROJET — même à qui peut lire la ruche', async () => {
    for (const entetes of [compte(proprio), compte(admin), { 'x-hive-token': TOKEN }]) {
      const r = await lire(`/api/projects/${projetA}/experience`, entetes);
      expect(r.status).toBe(200);
      const vue = (await r.json()) as {
        portee: string;
        reglage: string;
        noeuds: NoeudExperience[];
      };
      expect(vue).toMatchObject({ portee: 'projet', reglage: 'projet' });
      const ids = vue.noeuds.map((n) => n.id);
      expect(ids).toContain('task:passe-a');
      expect(ids).not.toContain('task:passe-b');
      expect(vue.noeuds.every((n) => n.projectId === null || n.projectId === projetA)).toBe(true);
      // Chaque nœud rendu porte sa provenance datée.
      for (const n of vue.noeuds) expect(Number.isFinite(n.provenance.date)).toBe(true);
    }
    // Le nœud de B n'existe pas dans le graphe de A : il n'est pas « caché », il est absent.
    // Et aucun texte de B n'y arrive par le Cerveau : l'erreur partagée et la
    // leçon qui la cite y sont, nommées par leur id seul.
    const brut = await (await lire(`/api/projects/${projetA}/experience`, compte(proprio))).text();
    expect(brut).toContain('error:ep-partage');
    expect(brut).toContain('lesson:note:lecon-partage');
    for (const cache of ['TITRE-DU-PROJET-B', 'LECON-DU-CERVEAU', 'passe-b', projetB]) {
      expect(brut, cache).not.toContain(cache);
    }
    const voisinageErreur = await lire(
      `/api/projects/${projetA}/experience?noeud=${encodeURIComponent('error:ep-partage')}`,
      compte(proprio),
    );
    expect(voisinageErreur.status).toBe(200);
    expect(await voisinageErreur.text()).not.toContain('TITRE-DU-PROJET-B');
    const r = await lire(
      `/api/projects/${projetA}/experience?noeud=${encodeURIComponent('task:passe-b')}`,
      compte(proprio),
    );
    expect(r.status).toBe(404);
  });

  it('le voisinage d’une tâche : ses faits, et ses contextes similaires DU PROJET, marqués corrélation', async () => {
    const r = await lire(
      `/api/projects/${projetA}/experience?noeud=${encodeURIComponent('task:passe-a')}`,
      compte(proprio),
    );
    expect(r.status).toBe(200);
    const vue = (await r.json()) as {
      voisinage: { centre: { id: string }; aretes: Array<{ relation: string; nature: string }> };
      similaires: Array<{ taskId: string; arete: { nature: string; relation: string } }>;
    };
    expect(vue.voisinage.centre.id).toBe('task:passe-a');
    expect(vue.voisinage.aretes.some((a) => a.relation === 'derived_from')).toBe(true);
    expect(vue.similaires.map((s) => s.taskId)).toEqual(['voisine-a']);
    expect(vue.similaires[0]?.arete).toMatchObject({
      relation: 'similar_to',
      nature: 'correlation',
    });
  });

  it('un tiers reçoit les octets de l’inexistence ; un genre inconnu est refusé au schéma', async () => {
    const refuse = await lire(`/api/projects/${projetA}/experience`, compte(tiers));
    const absent = await lire('/api/projects/projet-fantome/experience', compte(tiers));
    expect(refuse.status).toBe(404);
    expect(await refuse.text()).toBe(await absent.text());
    const inconnu = await lire('/api/projects/projet-fantome/experience', {
      'x-hive-token': TOKEN,
    });
    expect(inconnu.status).toBe(404);
    expect(await inconnu.text()).toBe(JSON.stringify({ error: 'projet inconnu' }));
    expect((await lire(`/api/projects/${projetA}/experience`, {})).status).toBe(401);
    const genre = await lire(`/api/projects/${projetA}/experience?genre=planete`, compte(proprio));
    expect(genre.status).toBe(400);
  });

  it('LA RUCHE ENTIÈRE est réservée à qui voit tous les projets — et y rapproche A et B', async () => {
    const r = await lire(
      `/api/admin/experience?noeud=${encodeURIComponent('task:passe-a')}`,
      compte(admin),
    );
    expect(r.status).toBe(200);
    const vue = (await r.json()) as { portee: string; similaires: Array<{ taskId: string }> };
    expect(vue.portee).toBe('ruche');
    expect(vue.similaires.map((s) => s.taskId).sort()).toEqual(['passe-b', 'voisine-a']);
    // La ruche, elle, nomme ce que le Cerveau sait : c'est sa permission.
    const tout = await (await lire('/api/admin/experience', compte(admin))).text();
    expect(tout).toContain('TITRE-DU-PROJET-B');
    expect(tout).toContain('LECON-DU-CERVEAU');
    expect((await lire('/api/admin/experience', compte(proprio))).status).toBe(403);
    // Le jeton de ruche se recopie sur chaque machine membre : il ne vaut pas
    // « voir tous les projets ».
    expect((await lire('/api/admin/experience', { 'x-hive-token': TOKEN })).status).toBe(401);
  });
});
