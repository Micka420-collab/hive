// La ruche n'apprend que du travail VALIDÉ, et elle apprend de TOUS ses échecs.
//
// ─── POURQUOI UNE VRAIE RUCHE ────────────────────────────────────────────────
//
// Les deux défauts que ce fichier ferme vivaient ENTRE les modules, là où aucun
// banc pur ne regarde :
//
//   · le Hive Mind écrivait son souvenir dès que l'ouvrière DÉCLARAIT sa
//     réussite — avant la contre-revue, l'Evaluator et l'humain. Une production
//     contestée, rejetée ou refaite restait dans la mémoire, réinjectée dans
//     les prompts voisins ; et les relectures y entraient comme des tâches ;
//   · le Cerveau n'apprenait que des échecs d'ouvrière, sans dire qui avait
//     échoué ni sur quelle production : ni les objections d'une relectrice, ni
//     les rejets de l'Evaluator n'y laissaient rien.
//
// On monte donc une vraie Reine, de vrais nœuds en WebSocket de deux familles
// différentes, et on suit une production jusqu'à son verdict.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { dossierDe, lire } from '../src/cerveau-reel.js';
import type { Fetcheur } from '../src/orchestrator/github.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-memoire-validee-assez-long';
const DIFF = 'diff --git a/auth.ts b/auth.ts\n+if (!jeton) return;';
const MODELE = 'sonnet-4.6';

interface Assignation {
  type: string;
  task?: { id: string };
}

interface Noeud {
  ws: WebSocket;
  recues: Assignation[];
  rendre: (taskId: string, r: { success: boolean; diff?: string; texte: string }) => void;
}

describe('la mémoire de la ruche suit le verdict, et le Cerveau apprend de tous ses échecs', () => {
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

  async function ruche(githubFetcher?: Fetcheur): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-memoire-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60,
      ...(githubFetcher ? { githubFetcher } : {}),
    });
    return server;
  }

  /** Une requête authentifiée à la Reine. */
  const appel = (srv: HiveServer, chemin: string, corps: unknown): Promise<Response> =>
    fetch(`http://127.0.0.1:${srv.port}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify(corps),
    });

  /** Une production réussie dont le bac dit les tests ROUGES. */
  const rendreTestsRouges = (n: Noeud, taskId: string): void => {
    const nonDeclare = { etat: 'not_applicable', raison: 'non_declare' } as const;
    n.ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId,
        success: true,
        diff: DIFF,
        logs: 'garde ajoutée',
        finalText: 'garde ajoutée',
        durationMs: 5,
        subAgents: [],
        validations: {
          controles: {
            tests: { etat: 'failed', raison: 'termine', script: 'test', code: 1 },
            typecheck: nonDeclare,
            build: nonDeclare,
            lint: nonDeclare,
          },
        },
      }),
    );
  };

  async function attendre(condition: () => boolean, message: string, ms = 6_000): Promise<void> {
    const fin = Date.now() + ms;
    while (!condition() && Date.now() < fin) await new Promise((r) => setTimeout(r, 30));
    expect(condition(), message).toBe(true);
  }

  async function noeud(
    srv: HiveServer,
    nodeId: string,
    agentType: string,
    modeles?: string[],
  ): Promise<Noeud> {
    const recues: Assignation[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
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
        ...(modeles ? { modeles } : {}),
      }),
    );
    await attendre(() => srv.store.getNode(nodeId)?.status === 'online', 'nœud non inscrit');
    // Le texte voyage aussi comme RÉPONSE FINALE : c'est elle que le hub lit
    // pour un verdict de relecture, et elle que le souvenir retient.
    const rendre: Noeud['rendre'] = (taskId, r) =>
      ws.send(
        JSON.stringify({
          type: 'task_result',
          taskId,
          success: r.success,
          diff: r.diff ?? '',
          logs: r.texte,
          finalText: r.texte,
          durationMs: 5,
          subAgents: [],
        }),
      );
    return { ws, recues, rendre };
  }

  /** Le producteur (claude-code, modèle déclaré) et sa relectrice (codex). */
  async function deuxFamilles(
    srv: HiveServer,
  ): Promise<{ producteur: Noeud; relectrice: Noeud; production: string }> {
    const producteur = await noeud(srv, 'aaa-producteur', 'claude-code', [MODELE]);
    const relectrice = await noeud(srv, 'bbb-relectrice', 'codex');
    const projet = srv.store.createProject({ name: 'Ruche' });
    const t = srv.store.createTask({
      projectId: projet.id,
      title: 'Ajouter une garde',
      prompt: 'garde du jeton vide',
    });
    srv.store.patchTask(t.id, { status: 'ready' });
    await attendre(
      () => producteur.recues.some((a) => a.task?.id === t.id),
      'le producteur n’a rien reçu',
    );
    return { producteur, relectrice, production: t.id };
  }

  /** La relecture que la relectrice a reçue pour cette production. */
  async function relecture(srv: HiveServer, n: Noeud, production: string): Promise<string> {
    let id: string | undefined;
    await attendre(() => {
      id = n.recues
        .map((a) => a.task?.id)
        .find((t) => t !== undefined && srv.store.relectureDe(t)?.productionTaskId === production);
      return id !== undefined;
    }, 'aucune relecture reçue');
    return id as string;
  }

  /** Tout ce qu'il faut pour `accepted`, sauf l'avis : Gardiennes propres et CI verte. */
  function preuvesVertes(srv: HiveServer, production: string, resultId: number): void {
    srv.store.appendEvent('ci_validation_recorded', {
      source: 'github_pull_request',
      taskId: production,
      projectId: srv.store.getTask(production)?.projectId,
      resultId,
      depot: 'demo/hive',
      pr: 7,
      branch: `hive/${production}`,
      commitSha: 'commit-relu',
      validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
      recordedAt: 1,
    });
  }

  const evenements = (srv: HiveServer, type: string, taskId: string) =>
    srv.store
      .listEvents(0, 1_000)
      .filter((e) => e.type === type && e.payload.taskId === taskId)
      .map((e) => e.payload);

  const episodes = (srv: HiveServer) => lire(dossierDe(srv.config.dbPath));

  it(
    'UNE RÉUSSITE N’ENTRE EN MÉMOIRE QU’À L’ACCEPTATION — et la relecture n’y entre jamais',
    { timeout: 30_000 },
    async () => {
      const srv = await ruche();
      const { producteur, relectrice, production } = await deuxFamilles(srv);
      producteur.rendre(production, { success: true, diff: DIFF, texte: 'garde ajoutée' });
      const lue = await relecture(srv, relectrice, production);
      const resultId = srv.store.resultsForTask(production).at(-1)?.resultId as number;

      // Réussie, relue en ce moment même : rien n'est encore validé.
      expect(srv.store.countMemories(), 'un souvenir écrit sur la seule parole de l’ouvrière').toBe(
        0,
      );
      expect(srv.store.souvenirPropose(production)).toEqual({ resultId, issue: 'en_attente' });

      preuvesVertes(srv, production, resultId);
      relectrice.rendre(lue, { success: true, texte: 'valide' });
      await attendre(
        () => evenements(srv, 'memory_recorded', production).length === 1,
        'la production acceptée n’est jamais entrée en mémoire',
      );

      expect(evenements(srv, 'memory_recorded', production)[0]).toMatchObject({
        resultId,
        source: 'evaluator',
      });
      // Une seule entrée : celle de la PRODUCTION. Le « valide » de la
      // relectrice n'est pas un savoir sur le projet.
      expect(srv.store.listMemories().map((m) => m.taskId)).toEqual([production]);
      expect(srv.store.listMemories()[0]?.content).toContain('garde ajoutée');
      expect(srv.store.souvenirPropose(lue)).toBeNull();
    },
  );

  it(
    'UNE OBJECTION DEVIENT UN ÉPISODE ATTRIBUÉ À LA PRODUCTION — et rien n’entre en mémoire',
    { timeout: 30_000 },
    async () => {
      const srv = await ruche();
      const { producteur, relectrice, production } = await deuxFamilles(srv);
      producteur.rendre(production, { success: true, diff: DIFF, texte: 'garde ajoutée' });
      const lue = await relecture(srv, relectrice, production);
      const resultId = srv.store.resultsForTask(production).at(-1)?.resultId as number;
      const assignee = evenements(srv, 'task_assigned', production)[0];

      relectrice.rendre(lue, {
        success: true,
        texte: 'conteste\n- le jeton vide passe encore la garde',
      });
      await attendre(
        () => evenements(srv, 'cerveau_episode', production).length > 0,
        'l’objection n’a rien appris au Cerveau',
      );

      const [episode, ...autres] = evenements(srv, 'cerveau_episode', production);
      // Une objection, un épisode : le rejet de l'Evaluator qu'elle provoque
      // n'en verse pas un second sous une autre signature.
      expect(autres).toEqual([]);
      expect(episode).toMatchObject({
        source: 'contre_revue',
        taskId: production,
        resultId,
        nodeId: 'aaa-producteur',
        agentType: 'claude-code',
        // Le modèle COMMANDÉ pour cette tentative, tel que l'assignation l'a dit.
        ...(typeof assignee?.modele === 'string' ? { modele: assignee.modele } : {}),
      });
      expect(assignee?.modele, 'l’Aiguillage devait commander le modèle déclaré').toBe(MODELE);

      const note = episodes(srv).find((n) => n.id === episode?.note);
      expect(note?.corps).toContain('le jeton vide passe encore la garde');
      expect(note?.origine).toEqual({
        source: 'contre_revue',
        taskId: production,
        resultId,
        nodeId: 'aaa-producteur',
        agentType: 'claude-code',
        modele: MODELE,
      });
      expect(srv.store.countMemories()).toBe(0);
      expect(srv.store.souvenirPropose(production)?.issue).toBe('rejete');
    },
  );

  it(
    'UN REJET HUMAIN RETIRE LE SOUVENIR ET ÉCRIT L’ÉPISODE, avec la raison de l’humain',
    { timeout: 30_000 },
    async () => {
      const srv = await ruche();
      const { producteur, relectrice, production } = await deuxFamilles(srv);
      producteur.rendre(production, { success: true, diff: DIFF, texte: 'garde ajoutée' });
      const lue = await relecture(srv, relectrice, production);
      const resultId = srv.store.resultsForTask(production).at(-1)?.resultId as number;
      preuvesVertes(srv, production, resultId);
      relectrice.rendre(lue, { success: true, texte: 'valide' });
      await attendre(() => srv.store.countMemories() === 1, 'la production n’a pas été retenue');

      const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${production}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
        body: JSON.stringify({ state: 'rejected', raison: 'la garde oublie le jeton expiré' }),
      });
      expect(r.status).toBe(200);

      expect(srv.store.countMemories(), 'un souvenir rejeté reste en mémoire').toBe(0);
      expect(evenements(srv, 'memory_forgotten', production)).toEqual([
        {
          taskId: production,
          projectId: srv.store.getTask(production)?.projectId,
          resultId,
          motif: 'rejet',
        },
      ]);
      const [episode] = evenements(srv, 'cerveau_episode', production);
      expect(episode).toMatchObject({
        source: 'rejet_evaluator',
        taskId: production,
        resultId,
        nodeId: 'aaa-producteur',
        agentType: 'claude-code',
        modele: MODELE,
      });
      expect(episodes(srv).find((n) => n.id === episode?.note)?.corps).toContain(
        'la garde oublie le jeton expiré',
      );
    },
  );

  it(
    'DES TESTS ROUGES REJETTENT LA PRODUCTION DÈS SA RÉCEPTION — épisode écrit, rien retenu ensuite',
    { timeout: 30_000 },
    async () => {
      // L'Evaluator lit le bac en même temps que le résultat : le rejet existe
      // dès la réception, sans attendre la relecture. Un avis favorable arrivé
      // après ne le rachète pas — les tests restent rouges.
      const srv = await ruche();
      const { producteur, relectrice, production } = await deuxFamilles(srv);
      rendreTestsRouges(producteur, production);
      await attendre(
        () => evenements(srv, 'cerveau_episode', production).length > 0,
        'le rejet de l’Evaluator n’a rien appris au Cerveau',
      );
      const resultId = srv.store.resultsForTask(production).at(-1)?.resultId;
      const [episode] = evenements(srv, 'cerveau_episode', production);
      expect(episode).toMatchObject({
        source: 'rejet_evaluator',
        taskId: production,
        resultId,
        nodeId: 'aaa-producteur',
        agentType: 'claude-code',
        modele: MODELE,
      });
      expect(episodes(srv).find((n) => n.id === episode?.note)?.corps).toContain(
        'validation tests en échec',
      );

      relectrice.rendre(await relecture(srv, relectrice, production), {
        success: true,
        texte: 'valide',
      });
      await attendre(
        () => evenements(srv, 'contre_expertise_verdict', production).length === 1,
        'l’avis n’est pas revenu',
      );
      expect(srv.store.countMemories(), 'une production aux tests rouges est entrée').toBe(0);
      expect(srv.store.souvenirPropose(production)?.issue).toBe('rejete');
      expect(evenements(srv, 'cerveau_episode', production), 'un rejet, un épisode').toHaveLength(
        1,
      );

      // Un humain l'approuve quand même : 200, mais rien n'entre — et le
      // journal dit pourquoi, au lieu de le laisser croire qu'il a enseigné.
      expect(
        (await appel(srv, `/api/tasks/${production}/review`, { state: 'approved' })).status,
      ).toBe(200);
      expect(srv.store.countMemories()).toBe(0);
      expect(evenements(srv, 'memory_withheld', production)).toEqual([
        {
          taskId: production,
          projectId: srv.store.getTask(production)?.projectId,
          resultId,
          decision: 'correction_required',
          raison: expect.stringContaining('validation tests en échec'),
        },
      ]);
    },
  );

  it(
    'UNE OBJECTION ARRIVÉE APRÈS LE REJET DE L’EVALUATOR NE COMPTE PAS L’ÉCHEC DEUX FOIS',
    { timeout: 30_000 },
    async () => {
      const srv = await ruche();
      const { producteur, relectrice, production } = await deuxFamilles(srv);
      rendreTestsRouges(producteur, production);
      await attendre(
        () => evenements(srv, 'cerveau_episode', production).length === 1,
        'le rejet de l’Evaluator n’a rien appris au Cerveau',
      );
      relectrice.rendre(await relecture(srv, relectrice, production), {
        success: true,
        texte: 'conteste\n- le jeton vide passe encore la garde',
      });
      await attendre(
        () => evenements(srv, 'contre_expertise_verdict', production).length === 1,
        'l’avis n’est pas revenu',
      );
      expect(
        evenements(srv, 'cerveau_episode', production).map((e) => e.source),
        'une production rejetée, un épisode — quelle que soit la porte arrivée seconde',
      ).toEqual(['rejet_evaluator']);
    },
  );

  it(
    'DEUX TÂCHES SANS RAPPORT AUX TESTS ROUGES NE FONT PAS UN MOTIF',
    { timeout: 30_000 },
    async () => {
      // « validation tests en échec (bac Hive du nœud …) » est une phrase FIXE
      // de l'Evaluator : signée telle quelle, elle fusionnait toutes les tâches
      // aux tests rouges en une note, et la troisième ouvrait une fausse
      // consolidation.
      const srv = await ruche();
      const { producteur, production } = await deuxFamilles(srv);
      rendreTestsRouges(producteur, production);
      await attendre(
        () => evenements(srv, 'cerveau_episode', production).length === 1,
        'premier rejet sans épisode',
      );
      const autre = srv.store.createTask({
        projectId: srv.store.getTask(production)?.projectId as string,
        title: 'Refondre le parseur CSV',
        prompt: 'parseur',
      });
      srv.store.patchTask(autre.id, { status: 'ready' });
      await attendre(
        () => producteur.recues.some((a) => a.task?.id === autre.id),
        'la seconde tâche n’a pas été confiée',
      );
      rendreTestsRouges(producteur, autre.id);
      await attendre(
        () => evenements(srv, 'cerveau_episode', autre.id).length === 1,
        'second rejet sans épisode',
      );
      const [a] = evenements(srv, 'cerveau_episode', production);
      const [b] = evenements(srv, 'cerveau_episode', autre.id);
      expect(a?.note, 'deux échecs sans rapport partagent une note').not.toBe(b?.note);
      expect([a?.recurrences, b?.recurrences]).toEqual([1, 1]);
    },
  );

  it(
    'UNE APPROBATION HUMAINE ANNULÉE RETIRE LE SOUVENIR QU’ELLE SEULE VALIDAIT',
    { timeout: 30_000 },
    async () => {
      // Une ruche d'une seule famille : rien ne relit, l'humain tranche.
      const srv = await ruche();
      const producteur = await noeud(srv, 'aaa-seule', 'claude-code');
      const projet = srv.store.createProject({ name: 'Seule' });
      const t = srv.store.createTask({ projectId: projet.id, title: 'Garde', prompt: 'garde' });
      srv.store.patchTask(t.id, { status: 'ready' });
      await attendre(() => producteur.recues.some((a) => a.task?.id === t.id), 'rien reçu');
      producteur.rendre(t.id, { success: true, diff: DIFF, texte: 'garde ajoutée' });
      await attendre(() => srv.store.getTask(t.id)?.status === 'done', 'tâche non terminée');
      expect(srv.store.countMemories()).toBe(0);

      expect((await appel(srv, `/api/tasks/${t.id}/review`, { state: 'approved' })).status).toBe(
        200,
      );
      expect(srv.store.countMemories()).toBe(1);
      expect(evenements(srv, 'memory_recorded', t.id)[0]).toMatchObject({
        source: 'revue_humaine',
      });

      // L'« annuler » de la Miellerie : plus rien ne valide ce souvenir.
      expect((await appel(srv, `/api/tasks/${t.id}/review`, { state: null })).status).toBe(200);
      expect(srv.store.countMemories(), 'un souvenir que plus rien ne valide').toBe(0);
      expect(evenements(srv, 'memory_forgotten', t.id)).toEqual([
        {
          taskId: t.id,
          projectId: projet.id,
          resultId: srv.store.resultsForTask(t.id).at(-1)?.resultId,
          motif: 'approbation_retiree',
        },
      ]);
    },
  );

  it(
    'UN SOUVENIR ÉCRIT AVANT LA MISE À JOUR SORT AU REJET, ET SON ÉPISODE S’ÉCRIT',
    { timeout: 30_000 },
    async () => {
      // L'arriéré de la Miellerie : des tâches terminées dont la mémoire a été
      // écrite à la simple réussite, sans proposition.
      const srv = await ruche();
      const projet = srv.store.createProject({ name: 'Arriéré' });
      const t = srv.store.createTask({ projectId: projet.id, title: 'Garde', prompt: 'garde' });
      srv.store.registerNode({
        nodeId: 'n-ancien',
        name: 'ancien',
        ownerName: 'test',
        agentType: 'claude-code',
        maxConcurrency: 1,
      });
      const resultId = srv.store.insertResult({
        taskId: t.id,
        nodeId: 'n-ancien',
        diff: DIFF,
        logs: 'garde ajoutée',
        success: true,
        durationMs: 1,
        subAgents: [],
      });
      srv.store.patchTask(t.id, { status: 'done' });
      srv.store.recordMemory({
        projectId: projet.id,
        taskId: t.id,
        title: 'Garde',
        content: 'garde ajoutée',
      });
      expect(srv.store.souvenirPropose(t.id)).toBeNull();

      const r = await appel(srv, `/api/tasks/${t.id}/review`, {
        state: 'rejected',
        raison: 'la garde oublie le jeton expiré',
      });
      expect(r.status).toBe(200);
      expect(srv.store.countMemories(), 'le souvenir jamais validé est resté').toBe(0);
      expect(evenements(srv, 'memory_forgotten', t.id)).toEqual([
        { taskId: t.id, projectId: projet.id, resultId, motif: 'rejet' },
      ]);
      expect(evenements(srv, 'cerveau_episode', t.id)).toEqual([
        expect.objectContaining({ source: 'rejet_evaluator', taskId: t.id, resultId }),
      ]);
    },
  );

  it(
    'LA CI GITHUB EST LA PORTE QUI RETIENT — et une CI rouge retire le souvenir',
    { timeout: 30_000 },
    async () => {
      // Avis favorable d'abord, CI ensuite : c'est l'ordre courant d'un projet
      // sur GitHub, et aucun autre fait n'arrivera après la CI.
      let checkRuns = [
        {
          name: 'CI · Tests · Typecheck · Build · Lint',
          status: 'completed',
          conclusion: 'success',
        },
      ];
      const json = (v: unknown): Response =>
        new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
      let branche = '';
      const fetcheur: Fetcheur = async (url) => {
        if (url.endsWith('/pulls/7')) {
          return json({ state: 'open', merged: false, head: { sha: 'abc123', ref: branche } });
        }
        if (url.includes('/commits/abc123/check-runs')) return json({ check_runs: checkRuns });
        if (url.endsWith('/pulls/7/reviews?per_page=100')) return json([]);
        return new Response('{}', { status: 404 });
      };
      const avant = process.env.HIVE_GITHUB_TOKEN;
      process.env.HIVE_GITHUB_TOKEN = 'jeton-github-de-test';
      try {
        const srv = await ruche(fetcheur);
        const { producteur, relectrice, production } = await deuxFamilles(srv);
        producteur.rendre(production, { success: true, diff: DIFF, texte: 'garde ajoutée' });
        const lue = await relecture(srv, relectrice, production);
        const resultId = srv.store.resultsForTask(production).at(-1)?.resultId as number;
        relectrice.rendre(lue, { success: true, texte: 'valide' });
        await attendre(
          () => evenements(srv, 'contre_expertise_verdict', production).length === 1,
          'l’avis n’est pas revenu',
        );
        expect(srv.store.countMemories(), 'retenue sans aucune preuve de tests').toBe(0);

        branche = `hive/${production}`;
        const projectId = srv.store.getTask(production)?.projectId as string;
        srv.store.patchTask(production, { branch: branche });
        srv.store.setLivraison({
          taskId: production,
          projectId,
          depot: 'o/r',
          pr: 7,
          branche,
          etat: 'ouverte',
        });
        srv.store.appendEvent('delivery_opened', {
          taskId: production,
          projectId,
          pr: 7,
          branch: branche,
          commitSha: 'abc123',
        });

        const ci = `/api/tasks/${production}/evaluation/ci`;
        expect((await appel(srv, ci, { resultId })).status).toBe(200);
        expect(evenements(srv, 'memory_recorded', production)).toEqual([
          { taskId: production, projectId, resultId, source: 'evaluator' },
        ]);

        checkRuns = [
          {
            name: 'CI · Tests · Typecheck · Build · Lint',
            status: 'completed',
            conclusion: 'failure',
          },
        ];
        expect((await appel(srv, ci, { resultId })).status).toBe(200);
        expect(srv.store.countMemories(), 'une CI rouge laisse le souvenir').toBe(0);
        expect(evenements(srv, 'memory_forgotten', production)).toEqual([
          { taskId: production, projectId, resultId, motif: 'rejet' },
        ]);
      } finally {
        if (avant === undefined) delete process.env.HIVE_GITHUB_TOKEN;
        else process.env.HIVE_GITHUB_TOKEN = avant;
      }
    },
  );

  it(
    'LA CLÔTURE DE LA DERNIÈRE RELECTURE EN VOL RETIENT LA PRODUCTION',
    { timeout: 30_000 },
    async () => {
      // Deux relectrices : l'avis favorable arrive pendant que la seconde relit
      // encore (une objection resterait possible), puis la seconde tombe sans
      // avis. Aucun autre fait n'arrivera : c'est sa clôture qui retient.
      const srv = await ruche();
      const producteur = await noeud(srv, 'aaa-producteur', 'claude-code', [MODELE]);
      const codex = await noeud(srv, 'bbb-codex', 'codex');
      const hermes = await noeud(srv, 'ccc-hermes', 'hermes-agent');
      const projet = srv.store.createProject({ name: 'Ruche' });
      const t = srv.store.createTask({ projectId: projet.id, title: 'Garde', prompt: 'garde' });
      srv.store.patchTask(t.id, { status: 'ready' });
      await attendre(() => producteur.recues.some((a) => a.task?.id === t.id), 'rien reçu');
      producteur.rendre(t.id, { success: true, diff: DIFF, texte: 'garde ajoutée' });
      const lueCodex = await relecture(srv, codex, t.id);
      const lueHermes = await relecture(srv, hermes, t.id);
      const resultId = srv.store.resultsForTask(t.id).at(-1)?.resultId as number;
      preuvesVertes(srv, t.id, resultId);

      codex.rendre(lueCodex, { success: true, texte: 'valide' });
      await attendre(
        () => evenements(srv, 'contre_expertise_verdict', t.id).length === 1,
        'l’avis n’est pas revenu',
      );
      expect(srv.store.countMemories(), 'retenue pendant qu’une relecture est en vol').toBe(0);

      // hermes échoue à chacun de ses essais.
      for (let essai = 0; essai < 3; essai += 1) {
        await attendre(
          () => hermes.recues.filter((a) => a.task?.id === lueHermes).length > essai,
          `essai ${essai + 1} de la relecture non reçu`,
        );
        hermes.rendre(lueHermes, { success: false, texte: 'panne du relecteur' });
      }
      await attendre(
        () => evenements(srv, 'memory_recorded', t.id).length === 1,
        'la production n’a jamais été retenue à la clôture de la dernière relecture',
      );
      expect(evenements(srv, 'memory_recorded', t.id)[0]).toMatchObject({
        resultId,
        source: 'evaluator',
      });
    },
  );

  it(
    'L’ÉCHEC D’UNE OUVRIÈRE DIT QUI A ÉCHOUÉ, SOUS QUEL MODÈLE, ET SUR QUEL RÉSULTAT',
    { timeout: 30_000 },
    async () => {
      const srv = await ruche();
      const { producteur, production } = await deuxFamilles(srv);
      const assignee = evenements(srv, 'task_assigned', production)[0];
      expect(assignee?.modele).toBe(MODELE);

      producteur.rendre(production, {
        success: false,
        texte: 'Error: PORT_OCCUPE_SIGNATURE_UNIQUE au démarrage',
      });
      await attendre(
        () => evenements(srv, 'cerveau_episode', production).length > 0,
        'aucun épisode écrit pour l’échec',
      );
      const resultId = srv.store.resultsForTask(production).at(-1)?.resultId;
      const [episode] = evenements(srv, 'cerveau_episode', production);
      expect(episode).toMatchObject({
        source: 'echec_worker',
        taskId: production,
        resultId,
        nodeId: 'aaa-producteur',
        agentType: 'claude-code',
        modele: MODELE,
      });
      expect(episodes(srv).find((n) => n.id === episode?.note)?.origine).toMatchObject({
        source: 'echec_worker',
        resultId,
        modele: MODELE,
      });
    },
  );
});
