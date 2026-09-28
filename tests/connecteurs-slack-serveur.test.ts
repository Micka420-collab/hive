// Slack à travers la VRAIE Reine — le seul chemin par lequel Slack change la
// ruche, éprouvé sans rappel bouchonné.
//
// Les bancs du hub injectent un `appliquerRevue` qui rend « applique » : ils
// prouvent le tri (portée, canal, usager), pas ce que la Reine fait du clic.
// Retirer la garde « tâche terminée » ou l'appel à la revue canonique laissait
// toute la CI verte (mutation relevée en revue). Ici, un FAUX Slack (API
// `chat.postMessage` + Socket Mode) est branché par `config.connecteurs`, et
// l'on observe l'état de la ruche : la revue écrite, `task_reviewed`, la reprise
// sur rejet, le refus d'une tâche en vol ou d'un clic périmé — et le relais des
// quatre faits (`task_done`, `task_failed`, `delivery_merged` fusionnée ou non).

import { createServer as createHttp, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { ENV_SLACK_APP, ENV_SLACK_BOT } from '../src/connectors/slack/definition.js';
import { ACTION_APPROUVER, ACTION_REJETER } from '../src/connectors/slack/messages.js';
import type { SlackFetch, WsLike } from '../src/connectors/slack/client.js';

const TOKEN = 'jeton-de-ruche-slack-suffisamment-long-42';
const CANAL = 'C0HIVE1';
const APPROBATEUR = 'U0HIVE1';
const DEPOT = 'ruche/depot-slack';
const REPONSE = 'https://hooks.slack.com/actions/T0/1/faux';
const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-a
+b`;

/** Un socket Socket Mode de test : la Reine s'y abonne, le banc y pousse les clics. */
class FauxSocket implements WsLike {
  envoyes: string[] = [];
  private handlers = new Map<string, (arg?: unknown) => void>();
  send(data: string): void {
    this.envoyes.push(data);
  }
  close(): void {
    /* la Reine ferme en fin de banc ; rien à relancer */
  }
  on(event: 'open' | 'message' | 'close' | 'error', cb: (arg?: unknown) => void): void {
    this.handlers.set(event, cb);
  }
  pousser(payload: unknown, envelopeId: string): void {
    this.handlers.get('message')?.(
      JSON.stringify({ type: 'interactive', envelope_id: envelopeId, payload }),
    );
  }
}

interface MessagePoste {
  channel: string;
  text: string;
  blocks: Array<{ type: string; elements?: Array<{ action_id?: string; value?: string }> }>;
}

describe('Slack à travers la Reine — approbations et relais', () => {
  let server: HiveServer;
  let github: Server;
  let dir: string;
  let base: string;
  let projet = '';
  let socket: FauxSocket | null = null;
  let postes: MessagePoste[] = [];
  let reponses: Array<Record<string, unknown>> = [];
  let enveloppe = 0;
  const avant: Record<string, string | undefined> = {};
  const ENV_TOUCHEES = [ENV_SLACK_BOT, ENV_SLACK_APP, 'HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API'];
  const jeton = { 'x-hive-token': TOKEN, 'content-type': 'application/json' };

  const fetchSlack: SlackFetch = async (url, init) => {
    if (url.endsWith('/apps.connections.open')) {
      return { status: 200, json: async () => ({ ok: true, url: 'wss://faux.slack/socket' }) };
    }
    if (url.endsWith('/chat.postMessage')) {
      postes.push(JSON.parse(init.body ?? '{}') as MessagePoste);
      return { status: 200, json: async () => ({ ok: true, ts: '1.0' }) };
    }
    if (url === REPONSE) {
      reponses.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>);
      return { status: 200, json: async () => ({}) };
    }
    return { status: 404, json: async () => ({ ok: false, error: 'inconnu' }) };
  };

  /** Une tâche TERMINÉE avec une production rangée (ce qu'un `task_done` laisse). */
  const production = (titre: string): { taskId: string; resultId: number } => {
    const t = server.store.createTask({ projectId: projet, title: titre, prompt: 'x' });
    server.store.patchTask(t.id, { status: 'done', assignedNodeId: 'n1' });
    const resultId = server.store.insertResult({
      taskId: t.id,
      nodeId: 'n1',
      success: true,
      diff: DIFF,
      logs: 'tests: 0 failed',
      durationMs: 10,
      subAgents: [],
    });
    return { taskId: t.id, resultId };
  };

  /** Le clic tel que Slack l'envoie, sur un bouton relevé dans un message posté. */
  const clic = (valeur: string, actionId = ACTION_APPROUVER, userId = APPROBATEUR): unknown => ({
    type: 'block_actions',
    user: { id: userId },
    channel: { id: CANAL },
    response_url: REPONSE,
    actions: [{ action_id: actionId, value: valeur, block_id: `hive_approbation:${projet}` }],
  });

  /** Pousse un clic sur le socket et attend que la Reine l'ait journalisé. */
  const cliquer = async (payload: unknown, taskId: string): Promise<string> => {
    // L'entrée NOUVELLE, repérée par son id : deux clics dans la même
    // milliseconde ne se départagent pas par l'horodatage.
    const vus = new Set(journalRecu(taskId).map((e) => e.id));
    enveloppe += 1;
    socket!.pousser(payload, `env-${enveloppe}`);
    await expect.poll(() => journalRecu(taskId).length).toBe(vus.size + 1);
    return journalRecu(taskId).find((e) => !vus.has(e.id))!.apercu;
  };

  const journalRecu = (taskId: string) =>
    server.store
      .listerJournalConnecteurs({ projectId: projet, limit: 500 })
      .filter((e) => e.acte === 'approbation_recue' && e.cible === taskId);

  /** La valeur du bouton « Approuver » posté pour cette tâche (dernier message). */
  const boutonPour = async (taskId: string): Promise<string> => {
    let valeur: string | undefined;
    await expect
      .poll(() => {
        for (const m of [...postes].reverse()) {
          const el = m.blocks
            .find((b) => b.type === 'actions')
            ?.elements?.find((e) => e.action_id === ACTION_APPROUVER);
          if (el?.value && el.value.includes(taskId)) {
            valeur = el.value;
            return true;
          }
        }
        return false;
      })
      .toBe(true);
    return valeur!;
  };

  beforeAll(async () => {
    for (const n of ENV_TOUCHEES) avant[n] = process.env[n];
    // Faux GitHub pour la fusion manuelle : la PR 11 fusionne, la 12 non
    // (GitHub répond merged:false — une PR ouverte n'est pas une mission livrée).
    github = createHttp((req, res) => {
      const m = /\/pulls\/(\d+)\/merge$/.exec(req.url ?? '');
      res.writeHead(m ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(m ? { merged: m[1] === '11', sha: 'sha' } : { message: 'Not Found' }));
    });
    await new Promise<void>((r) => github.listen(0, '127.0.0.1', r));
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-de-test-slack';
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${(github.address() as { port: number }).port}`;
    // Les secrets Slack sont dans l'env Queen AVANT le démarrage : le Socket
    // Mode s'ouvre au démarrage, comme chez un hôte qui les a déjà posés.
    process.env[ENV_SLACK_BOT] = 'xoxb-faux-jeton-de-bot-pour-le-banc';
    process.env[ENV_SLACK_APP] = 'xapp-faux-jeton-d-app-pour-le-banc';

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-slack-reine-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      envPath: path.join(dir, 'queen.env'),
      simulation: false,
      tickMs: 60_000,
      connecteurs: {
        fetchSlack,
        wsFactory: () => {
          socket = new FauxSocket();
          return socket;
        },
      },
    });
    base = `http://127.0.0.1:${server.port}`;
    // Projet orphelin : le jeton de ruche en répond (ADR 0007).
    projet = server.store.createProject({
      name: 'Projet Slack',
      repoUrl: `https://github.com/${DEPOT}.git`,
      ownerId: null,
    }).id;
    const r = await fetch(`${base}/api/projects/${projet}/connecteurs/slack/autoriser`, {
      method: 'POST',
      headers: jeton,
      body: JSON.stringify({
        portees: ['notification', 'approbation'],
        canaux: [CANAL],
        usagers: [APPROBATEUR],
      }),
    });
    expect(r.status).toBe(200);
    // Le Socket Mode s'ouvre au démarrage (appel `apps.connections.open` asynchrone).
    for (let i = 0; i < 200 && socket === null; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(socket).not.toBeNull();
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((r) => github.close(() => r()));
    for (const n of ENV_TOUCHEES) {
      if (avant[n] === undefined) delete process.env[n];
      else process.env[n] = avant[n];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('un vrai `task_done` poste la demande AVEC boutons dans le canal inscrit', async () => {
    postes = [];
    server.scheduler.registerNode({
      nodeId: 'n-slack',
      name: 'claude',
      ownerName: 'banc',
      agentType: 'claude-code',
      maxConcurrency: 1,
    });
    const t = server.store.createTask({
      projectId: projet,
      title: 'Refondre l’accueil',
      prompt: 'x',
    });
    server.store.patchTask(t.id, { status: 'running', assignedNodeId: 'n-slack' });
    server.scheduler.handleTaskResult('n-slack', {
      taskId: t.id,
      success: true,
      diff: DIFF,
      logs: 'tests: 0 failed',
      durationMs: 10,
      subAgents: [],
    });
    expect(server.store.getTask(t.id)?.status).toBe('done');
    const valeur = await boutonPour(t.id);
    const demande = postes.find((m) => m.text.includes('Refondre'))!;
    expect(demande.channel).toBe(CANAL);
    expect(demande.text).toContain('Approbation demandée');
    // Le bouton porte la production EXACTE qu'il montre.
    expect(JSON.parse(valeur)).toEqual({
      t: t.id,
      r: server.store.dernierResultatDe(t.id),
      v: null,
    });
  });

  it('un clic sur une tâche EN VOL est refusé `non_terminal` : aucune revue écrite', async () => {
    const { taskId, resultId } = production('En vol');
    server.store.patchTask(taskId, { status: 'running' });
    const apercu = await cliquer(clic(JSON.stringify({ t: taskId, r: resultId, v: null })), taskId);
    expect(apercu).toBe('approved — non_terminal');
    expect(journalRecu(taskId).every((e) => e.resultat === 'refuse')).toBe(true);
    expect(server.store.getTaskReview(taskId)).toBeNull();
    expect(reponses.at(-1)).toMatchObject({ response_type: 'ephemeral' });
  });

  it('« Approuver » sur une tâche terminée pose la revue par le chemin canonique', async () => {
    const { taskId, resultId } = production('Approuvable');
    reponses = [];
    const apercu = await cliquer(clic(JSON.stringify({ t: taskId, r: resultId, v: null })), taskId);
    expect(apercu).toBe('approved — applique');
    expect(journalRecu(taskId).every((e) => e.resultat === 'ok')).toBe(true);
    expect(server.store.getTaskReview(taskId)?.state).toBe('approved');
    const revue = server.store
      .listEvents()
      .find((e) => e.type === 'task_reviewed' && e.payload.taskId === taskId);
    expect(revue?.payload).toMatchObject({ state: 'approved', raison: 'approbation Slack' });
    // Le cliqueur voit l'issue : le message est réécrit, ses boutons partent.
    await expect.poll(() => reponses.length).toBe(1);
    expect(reponses[0]).toMatchObject({ replace_original: true });
    expect(String(reponses[0]!.text)).toContain(`<@${APPROBATEUR}>`);
  });

  it('un second clic sur le même message est PÉRIMÉ : il ne renverse pas le verdict', async () => {
    const { taskId, resultId } = production('Déjà jugée');
    const valeur = JSON.stringify({ t: taskId, r: resultId, v: null });
    expect(await cliquer(clic(valeur), taskId)).toBe('approved — applique');
    const verdict = server.store.getTaskReview(taskId);
    expect(await cliquer(clic(valeur, ACTION_REJETER), taskId)).toBe('rejected — perime');
    expect(server.store.getTaskReview(taskId)).toEqual(verdict);
  });

  it('un verdict posé dans la Miellerie rend le bouton Slack périmé', async () => {
    const { taskId, resultId } = production('Jugée ailleurs');
    const r = await fetch(`${base}/api/tasks/${taskId}/review`, {
      method: 'POST',
      headers: jeton,
      body: JSON.stringify({ state: 'approved' }),
    });
    expect(r.status).toBe(200);
    const apercu = await cliquer(
      clic(JSON.stringify({ t: taskId, r: resultId, v: null }), ACTION_REJETER),
      taskId,
    );
    expect(apercu).toBe('rejected — perime');
    expect(server.store.getTaskReview(taskId)?.state).toBe('approved');
  });

  it('le bouton d’une tentative REMPLACÉE ne juge pas la suivante', async () => {
    const { taskId, resultId } = production('Deux tentatives');
    // Une nouvelle production est rangée depuis le message (reprise).
    server.store.insertResult({
      taskId,
      nodeId: 'n1',
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 5,
      subAgents: [],
    });
    const apercu = await cliquer(clic(JSON.stringify({ t: taskId, r: resultId, v: null })), taskId);
    expect(apercu).toBe('approved — perime');
    expect(server.store.getTaskReview(taskId)).toBeNull();
  });

  it('« Rejeter » relance la tâche comme la route `/review`', async () => {
    const { taskId, resultId } = production('À corriger');
    const apercu = await cliquer(
      clic(JSON.stringify({ t: taskId, r: resultId, v: null }), ACTION_REJETER),
      taskId,
    );
    expect(apercu).toBe('rejected — applique');
    // Le verdict passe par `task_reviewed` (la reprise efface ensuite la revue
    // de la tentative jugée, comme après la route `/review`).
    const revue = server.store
      .listEvents()
      .find((e) => e.type === 'task_reviewed' && e.payload.taskId === taskId);
    expect(revue?.payload).toMatchObject({ state: 'rejected', raison: 'approbation Slack' });
    expect(server.store.getTask(taskId)?.attempts).toBe(1);
    expect(
      server.store
        .listEvents()
        .some(
          (e) =>
            e.type === 'task_retry' &&
            e.payload.source === 'evaluator' &&
            e.payload.taskId === taskId,
        ),
    ).toBe(true);
  });

  it('un vrai `task_failed` part en blocage', async () => {
    postes = [];
    server.scheduler.registerNode({
      nodeId: 'n-echec',
      name: 'codex',
      ownerName: 'banc',
      agentType: 'codex',
      maxConcurrency: 1,
    });
    const t = server.store.createTask({ projectId: projet, title: 'Tâche vouée', prompt: 'x' });
    server.store.patchTask(t.id, { status: 'running', assignedNodeId: 'n-echec', attempts: 99 });
    server.scheduler.handleTaskResult('n-echec', {
      taskId: t.id,
      success: false,
      diff: '',
      logs: 'boom',
      durationMs: 10,
      subAgents: [],
    });
    expect(server.store.getTask(t.id)?.status).toBe('failed');
    await expect
      .poll(() => postes.find((m) => m.text.includes('Tâche vouée'))?.text)
      .toContain('Blocage');
  });

  it('une fusion manuelle FUSIONNÉE part en résumé ; merged:false ne part pas', async () => {
    postes = [];
    for (const pr of [11, 12]) {
      const { taskId } = production(`Livraison ${pr}`);
      server.store.setLivraison({
        taskId,
        projectId: projet,
        depot: DEPOT,
        pr,
        branche: `hive/${taskId}`,
        etat: 'ouverte',
      });
      const r = await fetch(`${base}/api/livraison/fusion`, {
        method: 'POST',
        headers: jeton,
        body: JSON.stringify({ projectId: projet, pr, forcer: { raison: 'banc des connecteurs' } }),
      });
      expect(r.status).toBe(200);
    }
    await expect
      .poll(() => postes.find((m) => m.text.includes('Résumé de mission'))?.blocks)
      .toBeDefined();
    const resumes = postes.filter((m) => m.text.includes('Résumé de mission'));
    // Seule la PR réellement fusionnée (#11) est annoncée.
    expect(resumes).toHaveLength(1);
    expect(JSON.stringify(resumes[0]!.blocks)).toContain('#11');
    const fusions = server.store.listEvents().filter((e) => e.type === 'delivery_merged');
    expect(fusions.map((e) => e.payload.fusionnee).sort()).toEqual([false, true]);
  });
});
