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

  async function ruche(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-memoire-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60,
    });
    return server;
  }

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
        { taskId: production, projectId: srv.store.getTask(production)?.projectId, resultId },
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
      const nonDeclare = { etat: 'not_applicable', raison: 'non_declare' } as const;
      producteur.ws.send(
        JSON.stringify({
          type: 'task_result',
          taskId: production,
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
