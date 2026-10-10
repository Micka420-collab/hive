// LE RELECTEUR NE SAIT PAS QUI A PRODUIT — éprouvé à la frontière : une vraie
// Reine, de faux nœuds sur la vraie socket, le vrai planificateur.
//
// ─── LE DÉFAUT QUE CE BANC FERME (G15) ───────────────────────────────────────
//
// La consigne de relecture nommait la famille du producteur (« relis le
// travail d'un AUTRE modèle (claude-code) ») et recopiait le début de ses logs
// — la ligne `init` du stream-json de Claude Code y porte son `model`, la
// narration de Codex son nom à chaque ligne. Un relecteur qui sait « c'est
// Claude » juge la marque, pas le code.
//
// L'invariant : RIEN de ce que la Reine envoie au relecteur — le message
// `assign_task` ENTIER, consigne, contexte de la ruche, métadonnées de la
// tâche — ne nomme la famille ni le modèle du producteur, pour chaque famille
// connue, relecture de secours comprise, et pour une production reprise après
// un échec quand le Cerveau et le Hive Mind en parlent : Hive écrit l'échec
// d'un CLI dans le corps d'un épisode (« codex : échec — … »), et un souvenir
// retombe sur les logs d'une production. Ce que le nœud y ajoute (dossier
// `tasks/<id de la relecture>`, branche `hive/<id>`, environnement épuré) ne
// dérive que de ce message et de lui-même. Les HUMAINS, eux, gardent la
// famille : l'annonce, le verdict et la preuve de l'Evaluator la nomment.
//
// Chaque cas échoue sur le train d'avant (b91637ff) : la consigne y nomme le
// producteur, et ses logs y voyagent ; le dernier échoue sur 4633e2da : le
// Cerveau sert l'épisode, le Hive Mind le souvenir.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { AGENT_TYPES } from '../src/node-client/agent-detect.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { libelleAgent } from '../src/shared/agent-libelle.js';
import { brancherFauxNoeud } from './aide/faux-noeud.js';

const TOKEN = 'jeton-relecture-anonyme-assez-long';

/** Les familles qui produisent du vrai travail : toutes sauf le shell simulé, plus Hermes. */
const FAMILLES = [...AGENT_TYPES.filter((a) => a !== 'shell'), 'hermes-agent'];

/** Ce qui trahirait une famille : son identifiant, son libellé, sa marque nue. */
const nomsDe = (famille: string): string[] => [
  famille,
  libelleAgent(famille),
  famille.split('-')[0]!,
];

/** Le modèle que le producteur déclare dans ses logs, comme un vrai CLI. */
const MODELE = 'modele-producteur-x7';

interface Assignation {
  type: string;
  relecture?: true;
  task?: { id: string; prompt?: string };
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

/** Une ruche ; `notes` : le dossier `cerveau` à côté de sa base, écrit à la main. */
async function ruche(notes: Record<string, string> = {}): Promise<HiveServer> {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-relecture-anonyme-'));
  mkdirSync(path.join(dir, 'cerveau'));
  for (const [nom, texte] of Object.entries(notes)) {
    writeFileSync(path.join(dir, 'cerveau', nom), texte, 'utf8');
  }
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'hive.db'),
    simulation: true,
    tickMs: 40,
  });
  return server;
}

interface Noeud {
  ws: WebSocket;
  recues: Assignation[];
  rendre: (taskId: string, resultat: Record<string, unknown>) => void;
}

async function noeud(srv: HiveServer, nodeId: string, agentType: string): Promise<Noeud> {
  const recues: Assignation[] = [];
  const { ws } = await brancherFauxNoeud<Assignation>(
    srv.port,
    { token: TOKEN, name: nodeId, ownerName: 'banc', agentType, maxConcurrency: 1, nodeId },
    (m) => {
      if (m.type === 'assign_task') recues.push(m);
    },
  );
  sockets.push(ws);
  const rendre = (taskId: string, resultat: Record<string, unknown>): void =>
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId,
        success: true,
        diff: '',
        logs: 'relu',
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

/** La `rang`-ième relecture reçue par ce nœud : le message ENTIER. */
async function relectureRecue(n: Noeud, rang = 0): Promise<Assignation> {
  const a = await attendre(() => n.recues.filter((r) => r.relecture === true)[rang]);
  expect(a, `aucune relecture n°${rang + 1} reçue`).toBeDefined();
  return a!;
}

/**
 * Une production de `famille`, rendue avec ses logs tels qu'un vrai CLI les
 * écrit — famille, libellé et modèle compris : c'est là qu'ils fuyaient.
 */
async function produire(srv: HiveServer, producteur: Noeud, famille: string): Promise<string> {
  const projet = srv.store.createProject({ name: 'P' });
  const t = srv.store.createTask({ projectId: projet.id, title: 'Garde du jeton', prompt: 'p' });
  srv.store.patchTask(t.id, { status: 'ready' });
  const recue = await attendre(() => producteur.recues[0]);
  expect(recue?.task?.id, 'le producteur n’a rien reçu').toBe(t.id);
  producteur.rendre(t.id, {
    diff: 'diff --git a/src/auth.ts b/src/auth.ts\n+  if (jeton === undefined) return false;',
    logs:
      `{"type":"system","subtype":"init","model":"${MODELE}","agent":"${famille}"}\n` +
      `${libelleAgent(famille)} (${famille}) démarré — modèle ${MODELE}\n`,
  });
  await attendre(() => (srv.store.getTask(t.id)?.status === 'done' ? true : undefined));
  return t.id;
}

const evenements = (srv: HiveServer, type: string): Array<Record<string, unknown>> =>
  srv.store
    .listEvents(0, 1000)
    .filter((e) => e.type === type)
    .map((e) => e.payload);

/** Le message reçu ne trahit ni la famille du producteur, ni son modèle. */
function aveugle(message: Assignation, famille: string): void {
  const texte = JSON.stringify(message).toLowerCase();
  for (const nom of nomsDe(famille)) {
    expect(texte, `« ${nom} » parvient au relecteur`).not.toContain(nom.toLowerCase());
  }
  expect(texte, 'le modèle du producteur parvient au relecteur').not.toContain(MODELE);
}

describe('le relecteur ne sait pas qui a produit — les humains, si', () => {
  it.each(FAMILLES)(
    'producteur %s : rien dans `assign_task` ne le nomme ; l’annonce, le verdict et la preuve, si',
    async (famille) => {
      const srv = await ruche();
      const relectrice = famille === 'codex' ? 'claude-code' : 'codex';
      const producteur = await noeud(srv, 'producteur', famille);
      const relecteur = await noeud(srv, 'relecteur', relectrice);
      const production = await produire(srv, producteur, famille);

      const relecture = await relectureRecue(relecteur);
      expect(relecture.task?.prompt).toMatch(/CONTRE-EXPERTISE/);
      aveugle(relecture, famille);

      // L'opérateur sait qui relit qui : l'annonce le dit.
      expect(evenements(srv, 'contre_expertise')[0]).toMatchObject({
        taskId: production,
        possible: true,
        producteur: famille,
        modeles: [relectrice],
      });
      // Le verdict aussi, et la preuve que l'Evaluator montre en revue.
      relecteur.rendre(relecture.task!.id, {
        finalText: 'valide\nHIVE_CRITIQUE {"verdict":"valide","findings":[]}',
      });
      const verdict = await attendre(() => evenements(srv, 'contre_expertise_verdict')[0]);
      expect(verdict).toMatchObject({
        producteur: famille,
        relecteur: relectrice,
        conteste: false,
      });
      const resultId = srv.store.resultsForTask(production).at(-1)?.resultId;
      expect(srv.store.crossReviewForResult(production, resultId!)?.reviewers).toMatchObject([
        { producerAgent: famille, reviewerAgent: relectrice },
      ]);
    },
    30_000,
  );

  it('UNE PRODUCTION REPRISE APRÈS UN ÉCHEC, Cerveau réel non vide : l’épisode que Hive a écrit de son échec ne parvient pas au relecteur — la règle humaine, si', async () => {
    // Une règle écrite à la main : le relecteur la garde.
    const srv = await ruche({
      'temps-constant.md': [
        '---',
        'genre: invariant',
        'titre: Jeton comparé en temps constant',
        'regle: TOUJOURS-TEMPS-CONSTANT',
        '---',
        'Un jeton se compare avec timingSafeEqual.',
        '',
      ].join('\n'),
    });
    const producteur = await noeud(srv, 'producteur', 'codex');
    const projet = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({ projectId: projet.id, title: 'Garde du jeton', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });

    // 1re tentative : l'échec tel que Hive l'écrit pour Codex (`flux-codex.ts`).
    expect((await attendre(() => producteur.recues[0]))?.task?.id).toBe(t.id);
    producteur.rendre(t.id, {
      success: false,
      logs:
        "codex : échec — tour conclu sans que rien ne s'écrive (1 correctif(s) en échec, " +
        "aucun appliqué, aucune commande réussie) : le bac de Codex n'a rien laissé faire",
    });
    const episode = await attendre(() => evenements(srv, 'cerveau_episode')[0]);
    expect(episode, 'l’échec n’a pas été versé au Cerveau').toMatchObject({ agentType: 'codex' });
    const corps = readdirSync(path.join(dir!, 'cerveau'))
      .map((f) => readFileSync(path.join(dir!, 'cerveau', f), 'utf8'))
      .join('\n');
    expect(corps, 'le corps de l’épisode nomme bien la famille').toContain('codex : échec');

    // 2e tentative, chez le même nœud — l'autre famille n'arrive qu'ensuite :
    // elle réussit, et part en relecture chez l'autre famille.
    expect((await attendre(() => producteur.recues[1]))?.task?.id).toBe(t.id);
    const relecteur = await noeud(srv, 'relecteur', 'claude-code');
    producteur.rendre(t.id, {
      diff: 'diff --git a/src/auth.ts b/src/auth.ts\n+  if (jeton === undefined) return false;',
      logs: 'ok',
    });
    const relecture = await relectureRecue(relecteur);
    aveugle(relecture, 'codex');
    expect(
      JSON.stringify(relecture),
      'la règle du projet, écrite par un humain, parvient toujours au relecteur',
    ).toContain('TOUJOURS-TEMPS-CONSTANT');
  }, 30_000);

  it('UN SOUVENIR retombé sur les logs d’une production (narration, modèle) ne parvient pas au relecteur', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'codex');
    const relecteur = await noeud(srv, 'relecteur', 'claude-code');
    const projet = srv.store.createProject({ name: 'P' });
    // Retenu, au même titre : sans texte final déclaré, `proposerSouvenir`
    // retombe sur les logs — la narration « ┊ codex : », la ligne `init`.
    srv.store.recordMemory({
      projectId: projet.id,
      taskId: 'tache-passee',
      title: 'Garde du jeton',
      content: `p — ┊ codex : tour terminé — modèle ${MODELE}`,
    });
    const t = srv.store.createTask({ projectId: projet.id, title: 'Garde du jeton', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });
    expect((await attendre(() => producteur.recues[0]))?.task?.id).toBe(t.id);
    // Le même souvenir parvient à une production : le canal est réel.
    expect(JSON.stringify(producteur.recues[0])).toContain(MODELE);
    producteur.rendre(t.id, {
      diff: 'diff --git a/src/auth.ts b/src/auth.ts\n+  if (jeton === undefined) return false;',
      logs: 'ok',
    });
    aveugle(await relectureRecue(relecteur), 'codex');
  }, 30_000);

  it('LA RELECTURE DE SECOURS, recomposée depuis le résultat rangé, est aveugle elle aussi', async () => {
    const srv = await ruche();
    const producteur = await noeud(srv, 'producteur', 'claude-code');
    const relecteur = await noeud(srv, 'relecteur', 'codex');
    const production = await produire(srv, producteur, 'claude-code');
    const premiere = await relectureRecue(relecteur);
    aveugle(premiere, 'claude-code');

    // Une famille neuve arrive, puis la relecture se clôt SANS avis : le
    // secours repart du résultat RANGÉ — là où les logs du producteur vivent.
    const hermes = await noeud(srv, 'hermes', 'hermes-agent');
    relecteur.rendre(premiere.task!.id, {});
    const secours = await relectureRecue(hermes);
    aveugle(secours, 'claude-code');
    expect(evenements(srv, 'contre_expertise').find((e) => e.secours === true)).toMatchObject({
      taskId: production,
      producteur: 'claude-code',
      modeles: ['hermes-agent'],
    });
  }, 30_000);
});
