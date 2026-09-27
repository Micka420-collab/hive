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
import { HiveStore } from '../src/orchestrator/store.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { TRENTE_JOURS_MS, fenetreSeule } from './aide/journal-retenu.js';

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
async function produire(
  srv: HiveServer,
  producteur: FauxNoeud,
  avantResultat: () => Promise<void> = async () => {},
): Promise<string> {
  const projet = srv.store.createProject({ name: 'P' });
  const t = srv.store.createTask({ projectId: projet.id, title: 'Garde du jeton', prompt: 'p' });
  srv.store.patchTask(t.id, { status: 'ready' });
  const assignation = await attendre(() => producteur.recues[0]);
  expect(assignation?.task?.id, 'le producteur n’a rien reçu').toBe(t.id);
  await avantResultat();
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
    // Aucune preuve non plus : la personne qui tranche le lit dans le même verdict.
    expect(verdict.reasons).toEqual([
      `relecture impossible : ${String(impossible?.cause)}`,
      expect.stringMatching(/^preuves manquantes : tests/),
    ]);

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

  // Le chemin du PLANIFICATEUR avec une famille de secours en ligne : le fait
  // terminal naît en pleine passe d'assignation (`relecteurAbsent`), le
  // secours y naît `pending`, et c'est le tick suivant qui le confie — sans
  // réentrer dans la passe en cours.
  it('LA FAMILLE RELECTRICE DISPARAÎT, UNE FAMILLE NEUVE EST LÀ : UN secours né en pleine passe, et son avis compte', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);
    const relecture = await relectureRecue(relecteur);
    const hermes = await noeud(srv, 'hermes', 'hermes-agent');

    relecteur.ws.close();
    await attendre(() =>
      evenements(srv, 'contre_expertise_review_waiting')[0] ? true : undefined,
    );
    // Le tick avancé franchit le délai d'absence ; les nœuds encore là
    // battent à la même heure, sinon ce tick les déclarerait morts aussi.
    const plusTard = Date.now() + ATTENTE_RELECTEUR_ABSENT_MS + 1_000;
    srv.scheduler.heartbeat('hermes', plusTard);
    srv.scheduler.heartbeat('producteur', plusTard);
    srv.scheduler.tick(plusTard);

    const echec = await attendre(() =>
      evenements(srv, 'contre_expertise_review_failed').find(
        (e) => e.relecture === relecture && e.terminal === true,
      ),
    );
    expect(echec).toMatchObject({ motif: 'relecteur_absent' });
    const secours = await relectureRecue(hermes);
    expect(evenements(srv, 'contre_expertise').find((e) => e.secours === true)).toMatchObject({
      taskId: production,
      relaie: relecture,
      modeles: ['hermes-agent'],
      relectures: [secours],
    });

    hermes.rendre(secours, { success: true, finalText: 'valide' });
    const avis = await attendre(() => evenements(srv, 'contre_expertise_verdict')[0]);
    expect(avis).toMatchObject({ taskId: production, relecteur: 'hermes-agent', conteste: false });
    expect(evenements(srv, 'contre_expertise_impossible')).toEqual([]);
    const verdict = await evaluation(srv, production);
    expect(verdict.reasons.join(' ')).not.toMatch(/relecture impossible/);
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

  it('AUCUN NŒUD N’A PU LANCER L’AGENT RELECTEUR : revue humaine nommée', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);

    // L'ouvrière codex refuse chaque assignation pour une panne d'agent
    // (auth, quota) : le token-failover compte ces refus jusqu'à sa borne
    // (trois par nœud en ligne), puis clôt la relecture sans avis. Le tick
    // avancé franchit le refroidissement de 3 s sans l'attendre. Chaque
    // attente porte sur l'ÉTAT (la relecture confiée à ce nœud, puis rendue à
    // la file) et est vérifiée : attendre un compte d'assignations dépendait
    // d'une minuterie de remise en file sans rapport, et une attente expirée
    // passait en silence.
    const relecture = await relectureRecue(relecteur);
    for (let refus = 0; refus < 10; refus += 1) {
      if (srv.store.getTask(relecture)?.status === 'failed') break;
      const confiee = await attendre(() => {
        const t = srv.store.getTask(relecture);
        return t?.status === 'assigned' && t.assignedNodeId === 'relecteur' ? true : undefined;
      });
      expect(confiee, `la relecture n’est pas revenue au relecteur (refus ${refus})`).toBe(true);
      relecteur.ws.send(
        JSON.stringify({ type: 'task_reject', taskId: relecture, reason: 'quota', infra: true }),
      );
      const rendue = await attendre(() =>
        srv.store.getTask(relecture)?.status !== 'assigned' ? true : undefined,
      );
      expect(rendue, `le refus ${refus} n’a pas été traité`).toBe(true);
      srv.scheduler.tick(Date.now() + 3_100);
    }
    expect(srv.store.getTask(relecture)?.status).toBe('failed');

    const impossible = await attendre(() => evenements(srv, 'contre_expertise_impossible')[0]);
    expect(impossible).toMatchObject({ taskId: production, relecture, relecteur: 'codex' });
    expect(String(impossible?.cause)).toMatch(/aucun nœud codex n’a pu lancer son agent/);

    const verdict = await evaluation(srv, production);
    expect(verdict.decision).toBe('human_review_required');
    expect(verdict.reasons[0]).toMatch(/^relecture impossible : aucun nœud codex n’a pu/);
    producteurIntact(srv, production, producteur);
  }, 30_000);

  it('L’AVIS RENDU PAR UNE AUTRE FAMILLE NE COMPTE PAS : UN secours, et son avis compte', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);
    const relecture = await relectureRecue(relecteur);
    const hermes = await noeud(srv, 'hermes', 'hermes-agent');

    // La relecture est ré-adoptée par un nœud de la famille du producteur
    // (`reconcileNode` reprend ce qu'un nœud déclare exécuter) : son avis
    // serait Claude relisant Claude. Le hub le refuse, et la relecture est
    // close — c'est une clôture sans avis comme une autre.
    srv.store.patchTask(relecture, { status: 'running', assignedNodeId: 'producteur' });
    producteur.rendre(relecture, { success: true, finalText: 'valide' });

    const echec = await attendre(() =>
      evenements(srv, 'contre_expertise_review_failed').find((e) => e.relecture === relecture),
    );
    expect(echec).toMatchObject({ terminal: true, motif: 'famille_non_designee' });
    const secours = await relectureRecue(hermes);
    expect(evenements(srv, 'contre_expertise').find((e) => e.secours === true)).toMatchObject({
      taskId: production,
      relaie: relecture,
      modeles: ['hermes-agent'],
      relectures: [secours],
    });
    expect(evenements(srv, 'contre_expertise_verdict'), 'l’avis de Claude a compté').toEqual([]);

    hermes.rendre(secours, { success: true, finalText: 'valide' });
    const avis = await attendre(() => evenements(srv, 'contre_expertise_verdict')[0]);
    expect(avis).toMatchObject({ taskId: production, relecteur: 'hermes-agent', conteste: false });
    expect(evenements(srv, 'contre_expertise_impossible')).toEqual([]);
    producteurIntact(srv, production, producteur);
  }, 30_000);

  // La cause dite à l'humain doit être la vraie panne : une dernière
  // tentative PLANTÉE chez un nœud d'une autre famille n'est pas « un avis
  // rendu par une autre famille » — il n'y a pas eu d'avis du tout.
  it('LA DERNIÈRE TENTATIVE PLANTE CHEZ UNE AUTRE FAMILLE : la cause dit l’échec, pas la famille', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);

    for (let essai = 0; essai < 2; essai += 1) {
      relecteur.rendre(await relectureRecue(relecteur, essai), { success: false });
    }
    const relecture = await relectureRecue(relecteur, 2);
    srv.store.patchTask(relecture, { status: 'running', assignedNodeId: 'producteur' });
    producteur.rendre(relecture, { success: false });

    const echec = await attendre(() =>
      evenements(srv, 'contre_expertise_review_failed').find(
        (e) => e.relecture === relecture && e.terminal === true,
      ),
    );
    expect(echec?.motif, 'un échec compté comme un avis d’une autre famille').toBeUndefined();
    const impossible = await attendre(() => evenements(srv, 'contre_expertise_impossible')[0]);
    expect(impossible).toMatchObject({ taskId: production, relecture, relecteur: 'codex' });
    expect(String(impossible?.cause)).toMatch(/codex a échoué \(3 tentative\(s\)\)/);
    expect(String(impossible?.cause)).not.toMatch(/autre famille que codex/);
    const verdict = await evaluation(srv, production);
    expect(verdict.reasons[0]).toMatch(/^relecture impossible : codex a échoué/);
  }, 30_000);

  it('UN AVIS CONTESTE, PUIS L’AUTRE RELECTURE TOMBE : la correction part quand même, une fois', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    // Deux familles relectrices en ligne au lancement (inscrites une fois la
    // production confiée au producteur) : deux relectures du même résultat.
    const relecteurs: { codex?: FauxNoeud; hermes?: FauxNoeud } = {};
    const production = await produire(srv, producteur, async () => {
      relecteurs.codex = await noeud(srv, 'codex', 'codex');
      relecteurs.hermes = await noeud(srv, 'hermes', 'hermes-agent');
    });
    const { codex, hermes } = relecteurs;
    if (!codex || !hermes) throw new Error('relecteurs non inscrits');

    const relectureCodex = await relectureRecue(codex);
    const relectureHermes = await relectureRecue(hermes);
    codex.rendre(relectureCodex, { success: true, finalText: 'conteste\n- le jeton vide passe' });
    await attendre(() => evenements(srv, 'contre_expertise_verdict')[0]);
    // L'avis est tombé pendant que hermes relisait encore : rien n'est parti.
    expect(evenements(srv, 'task_retry')).toEqual([]);

    // Puis hermes échoue à chacun de ses essais : c'est SA clôture qui
    // termine la contre-revue — et l'objection de codex doit alors agir.
    hermes.rendre(relectureHermes, { success: false });
    for (let essai = 1; essai < 3; essai += 1) {
      hermes.rendre(await relectureRecue(hermes, essai), { success: false });
    }
    await attendre(() =>
      evenements(srv, 'contre_expertise_review_failed').find(
        (e) => e.relecture === relectureHermes && e.terminal === true,
      ),
    );

    const relance = await attendre(() =>
      evenements(srv, 'task_retry').find((e) => e.taskId === production),
    );
    expect(relance, 'la correction demandée par l’Evaluator n’est jamais partie').toMatchObject({
      taskId: production,
      source: 'evaluator',
      decision: 'correction_required',
      // Et elle porte l'objection de codex au producteur relancé.
      critique: {
        source: 'contre_revue',
        objections: [expect.stringContaining('le jeton vide passe')],
      },
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(evenements(srv, 'task_retry').filter((e) => e.taskId === production)).toHaveLength(1);
    expect(evenements(srv, 'evaluator_retry_skipped')).toEqual([]);
    // La relance vient de l'objection, pas d'une impossibilité ni d'un secours.
    expect(evenements(srv, 'contre_expertise_impossible')).toEqual([]);
    expect(evenements(srv, 'contre_expertise').filter((e) => e.secours === true)).toEqual([]);
  }, 30_000);

  it('LA PRODUCTION DÉJÀ REJETÉE PAR UN HUMAIN : sa relecture qui tombe ne rachète rien', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur);
    const relecture = await relectureRecue(relecteur);
    const hermes = await noeud(srv, 'hermes', 'hermes-agent');

    // Un humain rejette pendant que codex relit : la production repart en
    // file pour une nouvelle tentative, qui aura sa propre contre-revue.
    const r = await fetch(`http://127.0.0.1:${srv.port}/api/tasks/${production}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'rejected' }),
    });
    expect(r.status).toBe(200);
    expect(srv.store.getTask(production)?.status).not.toBe('done');

    // Puis la relecture de l'ANCIEN résultat tombe pour de bon.
    relecteur.rendre(relecture, { success: false });
    for (let essai = 1; essai < 3; essai += 1) {
      relecteur.rendre(await relectureRecue(relecteur, essai), { success: false });
    }
    await attendre(() =>
      evenements(srv, 'contre_expertise_review_failed').find(
        (e) => e.relecture === relecture && e.terminal === true,
      ),
    );
    await new Promise((r2) => setTimeout(r2, 300));
    expect(
      evenements(srv, 'contre_expertise').filter((e) => e.secours === true),
      'un secours relit un résultat déjà écarté',
    ).toEqual([]);
    expect(hermes.recues.filter((a) => /CONTRE-EXPERTISE/.test(a.task?.prompt ?? ''))).toEqual([]);
    expect(evenements(srv, 'contre_expertise_impossible')).toEqual([]);
  }, 30_000);
});

// Le fait d'impossibilité est ce sur quoi l'Evaluator nomme sa revue humaine,
// et l'annonce de lancement le filigrane qui rattache une clôture à son
// résultat. Élagués comme un événement ordinaire, une production en attente
// d'humain retombait en « preuves manquantes » dès que la ruche avait
// journalisé 5 000 autres choses. Ce sont des PREUVES : la rétention du journal
// les garde avec leur production (`shared/retention-journal.ts`), tout le
// dossier, tant qu'elle attend quelqu'un — puis trente jours après sa clôture.
/** Le lien de relecture tel que `lancerRelectures` l'inscrit. */
function lier(store: HiveStore, relectureTaskId: string, productionTaskId: string): void {
  store.inscrireRelecture({
    relectureTaskId,
    productionTaskId,
    relecteurNodeId: 'nr',
    relecteurAgent: 'codex',
    producteurAgent: 'claude-code',
  });
}

describe('l’élagage du journal garde le dossier de contre-revue avec sa production', () => {
  it('TANT QU’ELLE ATTEND UN HUMAIN, TOUT SON DOSSIER SURVIT ; CLOSE DEPUIS TRENTE JOURS, IL PART AVEC ELLE', () => {
    const store = new HiveStore(':memory:');
    try {
      const projet = store.createProject({ name: 'P' });
      const t = store.createTask({ projectId: projet.id, title: 'Garde', prompt: 'p' });
      const resultat = (): number =>
        store.insertResult({
          taskId: t.id,
          nodeId: 'n',
          success: true,
          diff: 'd',
          logs: '',
          durationMs: 1,
          subAgents: [],
        });
      const ancien = resultat();
      store.appendEvent('contre_expertise', { taskId: t.id, resultId: ancien, relectures: ['r0'] });
      store.appendEvent('contre_expertise_impossible', {
        taskId: t.id,
        resultId: ancien,
        cause: 'ancienne cause',
      });
      const dernier = resultat();
      store.appendEvent('contre_expertise', {
        taskId: t.id,
        resultId: dernier,
        relectures: ['r1'],
      });
      store.appendEvent('contre_expertise_impossible', {
        taskId: t.id,
        resultId: dernier,
        cause: 'codex a échoué (3 tentative(s))',
      });
      for (const r of ['r0', 'r1']) lier(store, r, t.id);
      store.patchTask(t.id, { status: 'done' });
      for (let i = 0; i < 20; i += 1) store.appendEvent('bruit', { i });

      store.pruneEvents(fenetreSeule(5));

      expect(store.contreRevueImpossible(t.id, dernier)).toBe('codex a échoué (3 tentative(s))');
      expect(store.eventForRelecture('r1')?.payload.resultId).toBe(dernier);
      // Le résultat d'avant aussi : la borne n'est plus un compte de productions
      // récentes, c'est la vie de la production elle-même.
      expect(store.contreRevueImpossible(t.id, ancien)).toBe('ancienne cause');
      expect(store.eventForRelecture('r0')?.payload.resultId).toBe(ancien);

      // Un humain rejette sans nouvel essai : la production est close. Trente
      // jours plus tard, son dossier part — la borne tient.
      store.setTaskReview(t.id, 'rejected');
      store.pruneEvents(fenetreSeule(5), Date.now() + TRENTE_JOURS_MS + 60_000);
      expect(store.contreRevueImpossible(t.id, dernier), 'la borne ne tient plus').toBeNull();
      expect(store.eventForRelecture('r1')).toBeNull();
    } finally {
      store.close();
    }
  });

  // Une relecture rendue est CLOSE — rendue à la production qu'elle relisait, et
  // jamais livrée elle-même. La production, elle, attend encore un humain. Les
  // compter pareil laisserait les relectures (une à deux par production)
  // occuper la place que le plafond doit garder aux productions, et garder
  // leurs propres faits aussi longtemps qu'une production qui attend.
  it('LES RELECTURES RENDUES SONT CLOSES ; LA PRODUCTION QU’ELLES RELISENT NE L’EST PAS', () => {
    const store = new HiveStore(':memory:');
    try {
      const projet = store.createProject({ name: 'P' });
      const tache = (titre: string): string =>
        store.createTask({ projectId: projet.id, title: titre, prompt: 'p' }).id;
      const production = tache('Production');
      const resultId = store.insertResult({
        taskId: production,
        nodeId: 'n',
        success: true,
        diff: 'd',
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
      store.appendEvent('contre_expertise_impossible', {
        taskId: production,
        resultId,
        cause: 'codex a échoué (3 tentative(s))',
      });
      store.patchTask(production, { status: 'done' }, 1_000);
      const relectures: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const relecture = tache(`Relecture ${i}`);
        lier(store, relecture, production);
        store.appendEvent('task_done', { taskId: relecture, nodeId: 'nr' });
        store.patchTask(relecture, { status: 'done' }, 3_000 + i);
        relectures.push(relecture);
      }
      for (let i = 0; i < 20; i += 1) store.appendEvent('bruit', { i });

      const bilan = store.pruneEvents(fenetreSeule(5), 10_000 + TRENTE_JOURS_MS);

      expect(bilan.parMotif.echue, 'les trois relectures rendues, closes depuis trente jours').toBe(
        3,
      );
      expect(store.contreRevueImpossible(production, resultId)).toBe(
        'codex a échoué (3 tentative(s))',
      );
    } finally {
      store.close();
    }
  });
});
