// LA WAR ROOM ET LA DÉCISION HUMAINE, SUR UNE VRAIE RUCHE.
//
// Le module pur (`war-room.test.ts`) sait replier des faits. Ce qu'il ne peut
// pas dire, et que ce fichier vérifie sur le fil :
//
//   · « il propose, vous tranchez » est enfin RANGÉ : `council_decided`, avec
//     la piste, la raison et QUI — le compte s'il y en a un, l'aveu du jeton
//     de ruche sinon ;
//   · on ne tranche ni un conseil qui délibère, ni par-dessus la décision d'un
//     autre sans l'avoir vue ;
//   · la décision survit à l'élagage du journal aussi longtemps que son
//     conseil ;
//   · la War Room relit les faits émis par les VRAIS producteurs (contre-
//     expertise, Evaluator, revue humaine), et un désaccord n'en sort que
//     quand un humain l'a tranché.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { DecisionConseil, Desaccord, EntreeWarRoom } from '../src/shared/war-room.js';
import { MAX_ATTEMPTS } from '../src/shared/types.js';

const TOKEN = 'jeton-war-room-assez-long-pour-passer';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer;
let dir: string;
let base: string;
let projectId: string;

async function demarrer(simulation = false): Promise<void> {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-war-room-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'w.db'),
    simulation,
    tickMs: simulation ? 60 : 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
  projectId = server.store.createProject({ name: 'Ruche', description: 'un projet' }).id;
}

afterEach(async () => {
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

interface VueConseil {
  id: string;
  decision: DecisionConseil | null;
}

interface Vue {
  projectId: string | null;
  taskId: string | null;
  entrees: EntreeWarRoom[];
  tronque: boolean;
  desaccords: Desaccord[];
  taches: Record<string, { titre: string }>;
  conseils: Record<string, { question: string }>;
  journalElague: boolean;
}

/** Ouvre un conseil par la VRAIE route, puis le clôt comme le runner le ferait. */
async function conseilClos(
  opts: { projet?: string; entetes?: Record<string, string>; issue?: string } = {},
): Promise<{ id: string; pistes: string[] }> {
  const r = await fetch(`${base}/api/projects/${opts.projet ?? projectId}/conseil`, {
    method: 'POST',
    headers: opts.entetes ?? headers,
    body: JSON.stringify({ question: 'Quel socle pour la ruche ?' }),
  });
  expect(r.status, 'le banc : le conseil doit s’ouvrir').toBe(201);
  const { id } = (await r.json()) as { id: string };
  const pistes = ['A', 'B'].map((titre, i) => {
    const pid = `prop-${id}-${titre}`;
    server.store.ajouterProposition({
      id: pid,
      sessionId: id,
      eclaireuse: `n${i}`,
      famille: i === 0 ? 'claude-code' : 'codex',
      titre: `Piste ${titre}`,
      corps: 'corps',
      qualite: 7,
      sources: [],
      tour: 1,
    });
    return pid;
  });
  server.store.majSession(id, {
    etat: 'clos',
    issue: opts.issue ?? 'depart',
    motif: 'égalité',
    closedAt: Date.now(),
  });
  return { id, pistes };
}

function trancher(
  sessionId: string,
  corps: Record<string, unknown>,
  entetes: Record<string, string> = headers,
): Promise<Response> {
  return fetch(`${base}/api/conseil/${sessionId}/decision`, {
    method: 'POST',
    headers: entetes,
    body: JSON.stringify(corps),
  });
}

const decisionsRangees = () =>
  server.store.listEvents(0, 1000).filter((e) => e.type === 'council_decided');

async function lireWarRoom(query: string, entetes: Record<string, string> = headers) {
  return fetch(`${base}/api/war-room${query}`, { headers: entetes });
}

async function inscrire(email: string, displayName: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName }),
  });
  const { token } = (await r.json()) as { token: string };
  expect(token, 'le banc : l’inscription doit rendre un jeton').toBeTruthy();
  return token;
}

describe('trancher un conseil', () => {
  beforeEach(() => demarrer());

  it('exige une identité, et un conseil inconnu a la forme de l’inexistence', async () => {
    const { id, pistes } = await conseilClos();
    const corps = { propositionId: pistes[0], justification: 'parce que' };
    expect((await trancher(id, corps, { 'content-type': 'application/json' })).status).toBe(401);
    const inconnu = await trancher('conseil-fantome', corps);
    expect(inconnu.status).toBe(404);
    expect(await inconnu.json()).toEqual({ error: 'conseil inconnu' });
    expect(decisionsRangees()).toHaveLength(0);
  });

  it('REFUSE DE TRANCHER UN CONSEIL QUI DÉLIBÈRE ENCORE', async () => {
    // Son verdict peut encore changer : trancher une lecture instantanée,
    // c'est trancher sur un chiffre qui n'a pas fini de bouger.
    const r = await fetch(`${base}/api/projects/${projectId}/conseil`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    const { id } = (await r.json()) as { id: string };
    const refus = await trancher(id, { propositionId: null, justification: 'trop tôt' });
    expect(refus.status).toBe(409);
    expect(((await refus.json()) as { code: string }).code).toBe('conseil_en_cours');
    expect(decisionsRangees()).toHaveLength(0);
  });

  it('UNE PISTE QUI N’EST PAS DE CE CONSEIL EST REFUSÉE', async () => {
    const { id } = await conseilClos();
    const r = await trancher(id, { propositionId: 'prop-dailleurs', justification: 'x' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { code: string }).code).toBe('proposition_inconnue');
    expect(decisionsRangees()).toHaveLength(0);
  });

  it('UNE JUSTIFICATION FAITE D’ESPACES N’EST PAS UNE JUSTIFICATION', async () => {
    const { id, pistes } = await conseilClos();
    const r = await trancher(id, { propositionId: pistes[0], justification: '   \n  ' });
    expect(r.status).toBe(400);
    expect(decisionsRangees()).toHaveLength(0);
  });

  it('LA DÉCISION EST RANGÉE — piste, raison, et l’aveu du jeton de ruche', async () => {
    const { id, pistes } = await conseilClos();
    const r = await trancher(id, {
      propositionId: pistes[1],
      justification: 'B tient sans dépendance nouvelle\net se teste seule',
    });
    expect(r.status).toBe(201);
    const vue = (await r.json()) as VueConseil;
    expect(vue.decision).toMatchObject({
      genre: 'conseil_decide',
      sessionId: id,
      projectId,
      propositionId: pistes[1],
      titre: 'Piste B',
      // Une ligne : la raison est relue par des humains, et ne traverse pas
      // brute un futur prompt.
      justification: 'B tient sans dépendance nouvelle et se teste seule',
      // Le jeton de ruche est recopié sur chaque machine : il ne désigne
      // personne, et la trace le dit.
      par: { genre: 'jeton_de_ruche' },
      remplace: null,
    });

    const [range] = decisionsRangees();
    expect(range?.payload).toMatchObject({ sessionId: id, issue: 'depart', titre: 'Piste B' });

    // Relue par les DEUX routes du Conseil : la liste et le détail.
    const detail = (await (
      await fetch(`${base}/api/conseil/${id}`, { headers })
    ).json()) as VueConseil;
    expect(detail.decision?.id).toBe(range?.id);
    const liste = (await (await fetch(`${base}/api/conseils`, { headers })).json()) as {
      conseils: VueConseil[];
    };
    expect(liste.conseils.find((c) => c.id === id)?.decision?.propositionId).toBe(pistes[1]);
  });

  it('« AUCUNE PISTE » EST UNE DÉCISION', async () => {
    const { id } = await conseilClos({ issue: 'epuise' });
    const r = await trancher(id, { propositionId: null, justification: 'rien ne tient' });
    expect(r.status).toBe(201);
    expect(((await r.json()) as VueConseil).decision).toMatchObject({
      propositionId: null,
      titre: null,
    });
  });

  it('REVENIR SUR UNE DÉCISION SE NOMME — sinon 409, et rien n’est écrasé', async () => {
    const { id, pistes } = await conseilClos();
    const premiere = (await (
      await trancher(id, { propositionId: pistes[0], justification: 'A d’abord' })
    ).json()) as VueConseil;

    // Un second opérateur qui n'a pas vu la première décision.
    const aveugle = await trancher(id, { propositionId: pistes[1], justification: 'B' });
    expect(aveugle.status).toBe(409);
    const corps = (await aveugle.json()) as { code: string; decision: DecisionConseil };
    expect(corps.code).toBe('decision_perimee');
    expect(corps.decision.id, 'le refus montre la décision en place').toBe(premiere.decision?.id);
    expect(decisionsRangees()).toHaveLength(1);

    const revue = await trancher(id, {
      propositionId: pistes[1],
      justification: 'B, après relecture',
      precedente: premiere.decision?.id,
    });
    expect(revue.status).toBe(201);
    const apres = (await revue.json()) as VueConseil;
    expect(apres.decision).toMatchObject({
      propositionId: pistes[1],
      remplace: premiere.decision?.id,
    });
    // Les deux restent au journal : revenir sur une décision se voit.
    expect(decisionsRangees()).toHaveLength(2);
  });

  it('LE COMPTE EST L’AUTEUR, et le jeton seul ne tranche pas le projet d’un autre', async () => {
    await inscrire('reine@exemple.test', 'La Reine'); // le premier compte est admin
    const jwt = await inscrire('ada@exemple.test', 'Ada');
    const avecCompte = { ...headers, authorization: `Bearer ${jwt}` };
    const cree = await fetch(`${base}/api/projects/user`, {
      method: 'POST',
      headers: avecCompte,
      body: JSON.stringify({ name: 'Projet d’Ada' }),
    });
    const projetAda = ((await cree.json()) as { id: string }).id;
    const { id, pistes } = await conseilClos({ projet: projetAda, entetes: avecCompte });

    // Le jeton de ruche, recopié sur chaque machine membre, n'engage pas un
    // projet qui a un propriétaire (ADR 0007) — et le refus a la forme exacte
    // d'un conseil inexistant.
    const jetonSeul = await trancher(id, { propositionId: pistes[0], justification: 'x' });
    expect(jetonSeul.status).toBe(404);
    expect(await jetonSeul.json()).toEqual({ error: 'conseil inconnu' });

    const r = await trancher(id, { propositionId: pistes[0], justification: 'A' }, avecCompte);
    expect(r.status).toBe(201);
    const { decision } = (await r.json()) as VueConseil;
    expect(decision?.par).toMatchObject({ genre: 'compte', nom: 'Ada' });
    // Jamais l'email : il identifie une personne hors de la ruche.
    expect(JSON.stringify(decisionsRangees())).not.toContain('ada@exemple.test');
  });

  it('LA DÉCISION SURVIT À L’ÉLAGAGE DU JOURNAL — aussi longtemps que son conseil', async () => {
    // Élaguée avec le reste du journal, la décision ferait redire « à
    // trancher » à un conseil que quelqu'un a tranché, et laisserait trancher
    // à nouveau comme si de rien n'était.
    const { id, pistes } = await conseilClos();
    const premiere = (await (
      await trancher(id, { propositionId: pistes[0], justification: 'A' })
    ).json()) as VueConseil;
    await trancher(id, {
      propositionId: pistes[1],
      justification: 'B',
      precedente: premiere.decision?.id,
    });
    for (let i = 0; i < 20; i++) server.store.appendEvent('bruit', { i });

    server.store.pruneEvents(0);
    const restantes = decisionsRangees();
    expect(restantes, 'seule la décision COURANTE est protégée').toHaveLength(1);
    expect(restantes[0]?.payload.propositionId).toBe(pistes[1]);
    const detail = (await (
      await fetch(`${base}/api/conseil/${id}`, { headers })
    ).json()) as VueConseil;
    expect(detail.decision?.propositionId).toBe(pistes[1]);
    // Le fil, lui, avoue qu'il n'est plus toute l'histoire.
    const vue = (await (await lireWarRoom(`?projectId=${projectId}`)).json()) as Vue;
    expect(vue.journalElague).toBe(true);
    expect(vue.desaccords, 'un conseil tranché ne redevient pas « à trancher »').toEqual([]);

    // La borne : la protection tombe avec le conseil.
    server.store.pruneConseils(0);
    server.store.pruneEvents(0);
    expect(decisionsRangees()).toHaveLength(0);
  });
});

describe('la War Room', () => {
  beforeEach(() => demarrer());

  it('gardée : le jeton pour la ruche, la forme de l’inexistence pour un projet', async () => {
    expect((await fetch(`${base}/api/war-room`)).status).toBe(401);
    expect((await lireWarRoom('')).status).toBe(200);
    expect((await lireWarRoom('?projectId=fantome')).status).toBe(404);
    expect((await lireWarRoom('?taskId=fantome')).status).toBe(404);
    // Un compte SANS le jeton, sur un projet privé qui ne le regarde pas.
    await inscrire('reine@exemple.test', 'La Reine');
    const intrus = await inscrire('intrus@exemple.test', 'Intrus');
    const r = await lireWarRoom(`?projectId=${projectId}`, {
      authorization: `Bearer ${intrus}`,
    });
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: 'projet inconnu' });
  });

  it('UN CONSEIL À ÉGALITÉ ATTEND QUELQU’UN — et cesse d’attendre une fois tranché', async () => {
    const autre = server.store.createProject({ name: 'Autre' }).id;
    const { id, pistes } = await conseilClos();

    const avant = (await (await lireWarRoom(`?projectId=${projectId}`)).json()) as Vue;
    expect(avant.desaccords).toEqual([
      expect.objectContaining({ genre: 'conseil', sessionId: id, issue: 'depart' }),
    ]);
    expect(avant.conseils[id]?.question, 'le fil nomme le conseil').toBe(
      'Quel socle pour la ruche ?',
    );
    expect(avant.entrees.map((e) => e.genre)).toContain('conseil_ouvert');

    // Le fil d'un AUTRE projet ne porte pas ce conseil.
    const ailleurs = (await (await lireWarRoom(`?projectId=${autre}`)).json()) as Vue;
    expect(ailleurs.desaccords).toEqual([]);
    expect(ailleurs.entrees).toEqual([]);

    await trancher(id, { propositionId: pistes[0], justification: 'A, la plus simple' });
    const apres = (await (await lireWarRoom(`?projectId=${projectId}`)).json()) as Vue;
    expect(apres.desaccords).toEqual([]);
    expect(apres.entrees.at(-1)).toMatchObject({
      genre: 'conseil_decide',
      justification: 'A, la plus simple',
    });
  });

  it('`limite: 0` rend ce qui attend, sans le fil — le compte du cockpit', async () => {
    await conseilClos();
    const vue = (await (await lireWarRoom('?limite=0')).json()) as Vue;
    expect(vue.entrees).toEqual([]);
    expect(vue.tronque).toBe(true);
    expect(vue.desaccords).toHaveLength(1);
  });
});

// ─── LES VRAIS PRODUCTEURS ────────────────────────────────────────────────────
//
// La War Room ne relit que ce que d'autres ont écrit. Un banc qui écrirait
// lui-même les événements prouverait que le module sait lire SA propre idée
// du journal. Ici, un producteur et un relecteur branchés en WebSocket font
// émettre à la ruche `contre_expertise`, `contre_expertise_verdict`,
// `evaluator_retry_skipped` puis `task_reviewed` par leur vrai chemin.

interface Assignation {
  type: string;
  task?: { id: string };
}

describe('la War Room relit les vrais producteurs', () => {
  const sockets: WebSocket[] = [];
  beforeEach(() => demarrer(true));
  afterEach(() => {
    for (const ws of sockets.splice(0)) ws.close();
  });

  async function noeud(nodeId: string, agentType: string): Promise<Assignation[]> {
    const recues: Assignation[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    sockets.push(ws);
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as Assignation;
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
        name: nodeId,
        ownerName: 'test',
        agentType,
        maxConcurrency: 1,
        nodeId,
      }),
    );
    return recues;
  }

  async function attendre(cond: () => boolean, quoi: string, ms = 8_000): Promise<void> {
    const fin = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > fin) throw new Error(`jamais arrivé : ${quoi}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  const rendre = (ws: WebSocket, taskId: string, diff: string, logs: string): void =>
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId,
        success: true,
        diff,
        logs,
        durationMs: 5,
        subAgents: [],
      }),
    );

  it(
    'UNE CONTESTATION SANS RENVOI POSSIBLE ATTEND UN HUMAIN — et une revue la tranche',
    { timeout: 40_000 },
    async () => {
      const produits = await noeud('producteur', 'claude-code');
      const relus = await noeud('relecteur', 'codex');
      const tache = server.store.createTask({ projectId, title: 'Ajouter une garde', prompt: 'p' });
      server.store.patchTask(tache.id, { status: 'ready' });
      await attendre(() => produits.length > 0, 'l’assignation du producteur');
      rendre(sockets[0]!, tache.id, 'diff --git a/auth.ts b/auth.ts\n+if (!jeton) return;', 'ok');
      await attendre(() => relus.length > 0, 'la relecture du second modèle');

      // La tâche a déjà consommé ses essais : le renvoi en correction que la
      // contestation demande ne pourra pas avoir lieu. C'est exactement le
      // désaccord qui, jusqu'ici, n'était rendu nulle part.
      server.store.patchTask(tache.id, { attempts: MAX_ATTEMPTS });
      rendre(
        sockets[1]!,
        relus[0]!.task!.id,
        '',
        'conteste\n- le cas du jeton vide n’est pas traité',
      );
      await attendre(
        () =>
          server.store
            .listEvents(0, 1000)
            .some((e) => e.type === 'evaluator_retry_skipped' && e.payload.taskId === tache.id),
        'le refus de renvoi',
      );

      const vue = (await (await lireWarRoom(`?projectId=${projectId}`)).json()) as Vue;
      expect(vue.desaccords).toEqual([
        expect.objectContaining({
          genre: 'tache',
          taskId: tache.id,
          raison: 'attempts_exhausted',
          objections: ['le cas du jeton vide n’est pas traité'],
        }),
      ]);
      expect(vue.taches[tache.id]?.titre).toBe('Ajouter une garde');
      const genres = vue.entrees.map((e) => e.genre);
      expect(genres).toEqual(
        expect.arrayContaining(['contre_expertise', 'contre_verdict', 'renvoi_refuse']),
      );

      // Le fil d'UNE tâche : son débat, rien d'autre.
      const seule = (await (await lireWarRoom(`?taskId=${tache.id}`)).json()) as Vue;
      expect(seule.taskId).toBe(tache.id);
      expect(seule.entrees.every((e) => 'taskId' in e && e.taskId === tache.id)).toBe(true);

      // Un humain tranche par la revue — approuver, c'est trancher aussi.
      const revue = await fetch(`${base}/api/tasks/${tache.id}/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ state: 'approved' }),
      });
      expect(revue.status).toBe(200);
      const apres = (await (await lireWarRoom(`?projectId=${projectId}`)).json()) as Vue;
      expect(apres.desaccords).toEqual([]);
      expect(apres.entrees.at(-1)).toMatchObject({ genre: 'revue_humaine', etat: 'approved' });
    },
  );
});
