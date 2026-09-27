// UNE RELECTURE QUI TOMBE N'EST JAMAIS UN BLOCAGE SILENCIEUX.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// Quand la contre-revue d'une production tombait pour de bon — relecteur en
// échec au-delà de ses essais, relecture terminée sans réponse finale, famille
// relectrice absente au-delà de son délai, relecture annulée —, chaque cause
// journalisait son échec, puis plus rien : aucune relecture ne repartait,
// l'Evaluator voyait « sans avis » comme si aucun second modèle n'avait
// jamais été en ligne, et demandait des « tests supplémentaires » qui ne
// débloqueraient rien. Personne n'était appelé.
//
// L'issue voulue, éprouvée ici à la frontière — un vrai hub, de faux nœuds
// sur la vraie socket, le vrai planificateur :
//
//   · UNE relecture de secours, par une famille indépendante du producteur et
//     pas encore engagée sur ce résultat ;
//   · sinon (ou si le secours tombe aussi, ou si un humain a annulé), le fait
//     `contre_expertise_impossible`, et l'Evaluator demande une revue humaine
//     en disant « relecture impossible : <cause> » ;
//   · jamais le PRODUCTEUR relancé : il n'est pour rien dans la panne.
//
// Chaque cas échoue sur le train d'avant ce contrat (3e408cc) : aucun secours
// n'y partait, aucun fait d'impossibilité n'y était écrit, et l'Evaluator y
// rendait `additional_test_required`.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ATTENTE_RELECTEUR_ABSENT_MS } from '../src/orchestrator/scheduler.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-issue-terminale-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

interface Assignation {
  type: string;
  task?: { id: string; prompt?: string };
}

interface FauxNoeud {
  ws: WebSocket;
  recues: Assignation[];
  /** Rend un résultat pour une tâche reçue. */
  rendre: (taskId: string, resultat: { success: boolean; finalText?: string }) => void;
}

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
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-issue-relecture-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'hive.db'),
    simulation: true,
    tickMs: 50,
  });
  return server;
}

async function noeud(srv: HiveServer, nodeId: string, agentType: string): Promise<FauxNoeud> {
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
      ownerName: 'banc',
      agentType,
      maxConcurrency: 1,
      nodeId,
    }),
  );
  // L'inscription est traitée quand le nœud apparaît au store.
  await attendre(() => (srv.store.getNode(nodeId) ? true : undefined));
  const rendre = (taskId: string, resultat: { success: boolean; finalText?: string }): void =>
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId,
        diff: '',
        logs: resultat.success ? 'relu' : 'le CLI relecteur a planté',
        durationMs: 5,
        subAgents: [],
        ...resultat,
      }),
    );
  return { ws, recues, rendre };
}

async function attendre<T>(lire: () => T | undefined, ms = 8_000): Promise<T | undefined> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const v = lire();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

/** La `n`-ième relecture (0 d'abord) reçue par ce nœud, attendue. */
async function relectureRecue(n: FauxNoeud, rang = 0): Promise<string> {
  const a = await attendre(() => {
    const relectures = n.recues.filter((r) => /CONTRE-EXPERTISE/.test(r.task?.prompt ?? ''));
    return relectures[rang];
  });
  expect(a, `aucune relecture n°${rang + 1} reçue`).toBeDefined();
  return a!.task!.id;
}

/** Une production de `producteur`, rendue avec un vrai diff : elle part en relecture. */
async function produire(srv: HiveServer, producteur: FauxNoeud): Promise<string> {
  const projet = srv.store.createProject({ name: 'P' });
  const t = srv.store.createTask({ projectId: projet.id, title: 'Garde du jeton', prompt: 'p' });
  srv.store.patchTask(t.id, { status: 'ready' });
  const assignation = await attendre(() => producteur.recues[0]);
  expect(assignation?.task?.id, 'le producteur n’a rien reçu').toBe(t.id);
  producteur.ws.send(
    JSON.stringify({
      type: 'task_result',
      taskId: t.id,
      success: true,
      diff: 'diff --git a/src/auth.ts b/src/auth.ts\n+  if (jeton === undefined) return false;',
      logs: 'ok',
      durationMs: 5,
      subAgents: [],
    }),
  );
  await attendre(() => (srv.store.getTask(t.id)?.status === 'done' ? true : undefined));
  return t.id;
}

const evenements = (srv: HiveServer, type: string): Array<Record<string, unknown>> =>
  srv.store
    .listEvents(0, 1000)
    .filter((e) => e.type === type)
    .map((e) => e.payload);

async function evaluation(
  srv: HiveServer,
  taskId: string,
): Promise<{ decision: string; reasons: string[]; retryRecommended: boolean }> {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${taskId}/evaluation`, {
    headers,
  });
  expect(r.status).toBe(200);
  return (await r.json()) as { decision: string; reasons: string[]; retryRecommended: boolean };
}

/**
 * Le producteur n'a pas été relancé : aucune reprise, aucune correction de
 * l'Evaluator, et il n'a reçu que sa production.
 */
function producteurIntact(srv: HiveServer, production: string, producteur: FauxNoeud): void {
  const relances = srv.store
    .listEvents(0, 1000)
    .filter(
      (e) =>
        (e.type === 'task_retry' || e.type === 'evaluator_retry_skipped') &&
        e.payload.taskId === production,
    );
  expect(relances, 'le producteur a été relancé pour une panne de son relecteur').toEqual([]);
  expect(producteur.recues.map((a) => a.task?.id)).toEqual([production]);
  expect(srv.store.getTask(production)?.status).toBe('done');
}

describe('une contre-revue qui tombe aboutit toujours à une issue visible', () => {
  it('LE RELECTEUR ÉCHOUE À CHAQUE ESSAI, AUCUNE AUTRE FAMILLE : revue humaine nommée', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);

    // Trois essais (MAX_ATTEMPTS), trois pannes du CLI relecteur.
    for (let essai = 0; essai < 3; essai += 1) {
      relecteur.rendre(await relectureRecue(relecteur, essai), { success: false });
    }

    const impossible = await attendre(() => evenements(srv, 'contre_expertise_impossible')[0]);
    expect(impossible, 'la contre-revue est tombée sans un mot').toMatchObject({
      taskId: production,
      relecteur: 'codex',
      producteur: 'claude-code',
    });
    expect(String(impossible?.cause)).toMatch(/codex a échoué \(3 tentative\(s\)\)/);
    expect(String(impossible?.cause)).toMatch(/aucune autre famille que claude-code/);
    expect(evenements(srv, 'contre_expertise').filter((e) => e.secours === true)).toEqual([]);

    const verdict = await evaluation(srv, production);
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.retryRecommended).toBe(false);
    expect(verdict.reasons).toEqual([`relecture impossible : ${String(impossible?.cause)}`]);

    await new Promise((r) => setTimeout(r, 300));
    producteurIntact(srv, production, producteur);
    expect(
      evenements(srv, 'contre_expertise_impossible'),
      'un seul fait, pas un par tick',
    ).toHaveLength(1);
  }, 30_000);

  it('SANS RÉPONSE FINALE, UNE FAMILLE NEUVE EN LIGNE : UN secours, et son avis compte', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);
    const relecture = await relectureRecue(relecteur);

    // Hermes arrive APRÈS le lancement : `choisirCritiques` ne l'a pas engagé.
    const hermes = await noeud(srv, 'hermes', 'hermes-agent');
    relecteur.rendre(relecture, { success: true });

    const secours = await relectureRecue(hermes);
    const annonce = evenements(srv, 'contre_expertise').find((e) => e.secours === true);
    expect(annonce).toMatchObject({
      taskId: production,
      secours: true,
      relaie: relecture,
      producteur: 'claude-code',
      modeles: ['hermes-agent'],
      relectures: [secours],
    });
    expect(srv.store.relectureDe(secours)).toMatchObject({
      productionTaskId: production,
      relecteurAgent: 'hermes-agent',
      producteurAgent: 'claude-code',
    });

    hermes.rendre(secours, { success: true, finalText: 'valide' });
    const avis = await attendre(() => evenements(srv, 'contre_expertise_verdict')[0]);
    expect(avis).toMatchObject({ taskId: production, relecteur: 'hermes-agent', conteste: false });

    // L'avis du secours gouverne : plus rien d'« impossible » à dire.
    const verdict = await evaluation(srv, production);
    expect(verdict.reasons.join(' ')).not.toMatch(/relecture impossible/);
    expect(evenements(srv, 'contre_expertise_impossible')).toEqual([]);
    producteurIntact(srv, production, producteur);
  }, 30_000);

  it('LE SECOURS TOMBE AUSSI : pas de second secours, revue humaine nommée', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);
    const relecture = await relectureRecue(relecteur);
    const hermes = await noeud(srv, 'hermes', 'hermes-agent');
    relecteur.rendre(relecture, { success: true });
    const secours = await relectureRecue(hermes);

    // Une quatrième famille est là : un SEUL secours quand même.
    await noeud(srv, 'cursor', 'cursor-agent');
    hermes.rendre(secours, { success: true });

    const impossible = await attendre(() => evenements(srv, 'contre_expertise_impossible')[0]);
    expect(impossible).toMatchObject({
      taskId: production,
      relecture: secours,
      relecteur: 'hermes-agent',
    });
    expect(String(impossible?.cause)).toMatch(/hermes-agent a terminé sans réponse finale/);
    expect(String(impossible?.cause)).toMatch(/la relecture de secours a déjà été tentée/);
    expect(evenements(srv, 'contre_expertise').filter((e) => e.secours === true)).toHaveLength(1);

    const verdict = await evaluation(srv, production);
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.reasons[0]).toMatch(/^relecture impossible : hermes-agent/);
    producteurIntact(srv, production, producteur);
  }, 30_000);

  it('LA FAMILLE RELECTRICE DISPARAÎT AU-DELÀ DE SON DÉLAI : revue humaine nommée', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);
    const relecture = await relectureRecue(relecteur);

    // L'ouvrière codex tombe pour de bon : la relecture revient en file et
    // attend sa famille — le premier constat part de CE processus.
    relecteur.ws.close();
    await attendre(() =>
      evenements(srv, 'contre_expertise_review_waiting')[0] ? true : undefined,
    );
    // Le délai d'absence, franchi sans attendre cinq minutes : c'est le
    // planificateur du hub qui constate, et le hub qui en tire la suite.
    srv.scheduler.tick(Date.now() + ATTENTE_RELECTEUR_ABSENT_MS + 1_000);

    const impossible = await attendre(() => evenements(srv, 'contre_expertise_impossible')[0]);
    expect(impossible).toMatchObject({ taskId: production, relecture, relecteur: 'codex' });
    expect(String(impossible?.cause)).toMatch(/aucun nœud codex en ligne/);

    const verdict = await evaluation(srv, production);
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.reasons[0]).toMatch(/^relecture impossible : aucun nœud codex en ligne/);
    producteurIntact(srv, production, producteur);
  }, 30_000);

  it('UN HUMAIN ANNULE LA RELECTURE : pas de secours racheté, revue humaine nommée', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);
    const relecture = await relectureRecue(relecteur);
    // Une famille de secours est là : l'annulation ne la rachète pas.
    const hermes = await noeud(srv, 'hermes', 'hermes-agent');

    srv.scheduler.cancelTask(relecture, 'annulée par un humain');

    const impossible = await attendre(() => evenements(srv, 'contre_expertise_impossible')[0]);
    expect(impossible).toMatchObject({ taskId: production, relecture });
    expect(String(impossible?.cause)).toMatch(/confiée à codex a été annulée/);
    await new Promise((r) => setTimeout(r, 300));
    expect(hermes.recues, 'une relecture annulée a été rachetée').toEqual([]);

    const verdict = await evaluation(srv, production);
    expect(verdict.decision).toBe('human_review_required');
    producteurIntact(srv, production, producteur);
  }, 30_000);
});
