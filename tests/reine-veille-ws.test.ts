// La veille des sockets côté Reine : une connexion qui ne répond plus aux pings
// est coupée — nœud comme tableau de bord ; une connexion qui répond reste.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// La Reine ne pinguait jamais ses sockets. Une connexion morte en silence
// (onglet d'un portable en veille, réseau disparu sans rien fermer) restait
// dans `dashboardSockets` jusqu'aux délais TCP du noyau, et chaque diffusion
// d'instantané s'accumulait dans son tampon, sur le serveur. Carte Notion
// « Auditer WebSocket, reconnexion et perte de messages », scénario
// « ping/pong expiré ».
//
// Le client « muet » est un vrai client `ws` à qui l'on retire le pong
// automatique (`autoPong: false`) : il continue de lire et d'écrire, il ne
// répond simplement plus aux pings — ce qu'un pair disparu fait, vu du serveur.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-veille-ws-suffisamment-long';
const VIE_MS = 150;

let serveur: HiveServer | null = null;
let dossier = '';
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true });
});

async function reine(vieMs = VIE_MS): Promise<HiveServer> {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'reine-veille-'));
  serveur = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: JETON,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dossier, 'hive.db'),
    simulation: false,
    tickMs: 60_000,
    wsVieMs: vieMs,
  });
  return serveur;
}

/**
 * Ouvre une socket et y envoie `premier` ; rend la socket une fois la réponse
 * attendue reçue.
 *
 * Pas `aide/faux-noeud`, à dessein : ce banc éprouve le silence au niveau du
 * TRANSPORT (pings `ws`), avec un même ouvreur pour nœud et tableau de bord,
 * en quelques centaines de ms. Un battement applicatif n'y changerait rien —
 * la veille lit les pongs — et brouillerait ce que le banc isole.
 */
function ouvrir(
  port: number,
  premier: object,
  attendu: string,
  autoPong: boolean,
): Promise<{ ws: WebSocket; fermee: Promise<number> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { autoPong });
  clients.push(ws);
  const fermee = new Promise<number>((r) => ws.once('close', (code) => r(code)));
  return new Promise((resolve, reject) => {
    ws.once('open', () => ws.send(JSON.stringify(premier)));
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString()) as { type: string };
      if (msg.type === attendu) resolve({ ws, fermee });
    });
    ws.once('error', reject);
  });
}

function noeud(nodeId: string): object {
  return {
    type: 'register',
    token: JETON,
    nodeId,
    name: nodeId,
    ownerName: 'banc',
    agentType: 'shell',
    maxConcurrency: 1,
  };
}

/** `true` si la promesse se résout avant `ms`. */
async function avant<T>(p: Promise<T>, ms: number): Promise<boolean> {
  return Promise.race([
    p.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
  ]);
}

describe('la veille des sockets côté Reine', () => {
  it('UN NŒUD QUI NE RÉPOND PLUS AUX PINGS EST COUPÉ — et déclaré déconnecté', async () => {
    const s = await reine();
    const { fermee } = await ouvrir(s.port, noeud('noeud-muet'), 'registered', false);
    expect(s.store.listNodes().find((n) => n.id === 'noeud-muet')?.status).toBe('online');

    // Deux tours de veille suffisent : ping sans pong, puis coupure.
    expect(await avant(fermee, VIE_MS * 6), 'la Reine a gardé une socket muette').toBe(true);
    const fin = Date.now() + 2_000;
    while (
      Date.now() < fin &&
      s.store.listNodes().find((n) => n.id === 'noeud-muet')?.status === 'online'
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(s.store.listNodes().find((n) => n.id === 'noeud-muet')?.status).not.toBe('online');
  });

  it('UN TABLEAU DE BORD MUET EST RETIRÉ DE LA DIFFUSION', async () => {
    const s = await reine();
    const { fermee } = await ouvrir(s.port, { type: 'subscribe', token: JETON }, 'state', false);
    expect(await avant(fermee, VIE_MS * 6), 'la Reine a gardé un tableau de bord muet').toBe(true);
  });

  it('UNE CONNEXION QUI RÉPOND RESTE — la veille ne coupe pas les vivants', async () => {
    const s = await reine();
    const { fermee: noeudFerme } = await ouvrir(s.port, noeud('noeud-vivant'), 'registered', true);
    const { fermee: ecranFerme } = await ouvrir(
      s.port,
      { type: 'subscribe', token: JETON },
      'state',
      true,
    );
    // Dix tours de veille : une veille qui ignorerait les pongs aurait coupé.
    expect(await avant(noeudFerme, VIE_MS * 10), 'la veille a coupé un nœud vivant').toBe(false);
    expect(await avant(ecranFerme, 50), 'la veille a coupé un tableau de bord vivant').toBe(false);
    expect(s.store.listNodes().find((n) => n.id === 'noeud-vivant')?.status).toBe('online');
  });
});

/** Crée un projet par l'API : un événement au journal, et l'état sali. */
async function creerProjet(s: HiveServer, nom: string): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${s.port}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hive-token': JETON },
    body: JSON.stringify({ name: nom }),
  });
  expect(r.status).toBe(201);
}

describe('la diffusion aux tableaux de bord', () => {
  it('L’INSTANTANÉ DIT JUSQU’OÙ IL REFLÈTE LE JOURNAL — le point de reprise d’un écran', async () => {
    // Sans ce point, un écran qui n'a encore vu passer AUCUN événement ne sait
    // pas d'où rattraper après une coupure : tout ce qui s'y est passé
    // manquerait à son journal, pour toujours.
    const s = await reine(60_000);
    await creerProjet(s, 'avant');
    const recus: Record<string, unknown>[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    clients.push(ws);
    ws.on('message', (d) => recus.push(JSON.parse(d.toString()) as Record<string, unknown>));
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'subscribe', token: JETON }));
    const fin = Date.now() + 2_000;
    while (Date.now() < fin && !recus.some((m) => m.type === 'state')) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const etat = recus.find((m) => m.type === 'state');
    const reprise = s.store.lastEventId();
    expect(reprise).toBeGreaterThan(0);
    expect(etat?.dernierEvenementId, 'l’instantané ne dit pas où il en est du journal').toBe(
      reprise,
    );

    // Ce que l'écran relira à son retour : exactement ce qui a suivi ce point.
    await creerProjet(s, 'apres');
    const r = await fetch(`http://127.0.0.1:${s.port}/api/events?since=${String(reprise)}`, {
      headers: { 'x-hive-token': JETON },
    });
    const suite = (await r.json()) as { id: number; type: string }[];
    expect(suite.map((e) => e.type)).toEqual(['project_created']);
    expect(suite[0]?.id).toBe(reprise + 1);
  });

  it(
    'UN TABLEAU DE BORD VIVANT MAIS TROP LENT EST COUPÉ EN 4408 — celui qui lit reste',
    { timeout: 60_000 },
    async () => {
      // ─── LE CAS QUE LA VEILLE NE VOIT PAS ────────────────────────────────
      //
      // Un écran qui répond encore mais ne LIT plus assez vite : chaque
      // instantané s'empilait dans son tampon d'envoi, dans la mémoire de la
      // Reine, sans borne. La veille est réglée longue ici — ce banc éprouve la
      // lenteur, pas la mort : un client en pause ne lit plus ses pings, et
      // une veille courte le couperait avant la borne, pour une autre raison.
      const s = await reine(60_000);
      // Un instantané lourd, environ 2 Mo : de longs prompts dans la fenêtre.
      const projet = s.store.createProject({ name: 'lourd' });
      const prompt = 'x'.repeat(80_000);
      for (let i = 0; i < 25; i++) {
        s.store.createTask({ id: `lourde-${String(i)}`, projectId: projet.id, title: 't', prompt });
      }
      const lent = await ouvrir(s.port, { type: 'subscribe', token: JETON }, 'state', true);
      const vif = await ouvrir(s.port, { type: 'subscribe', token: JETON }, 'state', true);

      // Le lent cesse de LIRE : côté Reine, son tampon ne se vide plus. Le
      // noyau en absorbe d'abord quelques mégaoctets ; seize instantanés en
      // poussent assez pour dépasser n'importe quel tampon de système.
      lent.ws.pause();
      for (let i = 0; i < 16; i++) {
        await creerProjet(s, `p${String(i)}`);
        await new Promise((r) => setTimeout(r, 300));
      }
      // Il relit ce qui s'est empilé : si la Reine l'a coupé, la fermeture
      // est au bout de son tampon.
      lent.ws.resume();
      const code = await Promise.race([
        lent.fermee,
        new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
      ]);
      expect(code, 'la Reine a laissé grossir sans borne le tampon d’un écran lent').toBe(4408);
      expect(await avant(vif.fermee, 50), 'la borne a coupé un écran qui lisait').toBe(false);
    },
  );
});
