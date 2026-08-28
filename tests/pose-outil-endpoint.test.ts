// POSER UN OUTIL — la route, éprouvée de bout en bout.
//
// Les bancs voisins jugent la décision (`pose-outil`), la forme du message
// (`pose-outil-protocole`) et l'exécution (`pose-runner`). Celui-ci éprouve ce
// qu'AUCUN des trois ne peut voir : ce qui traverse réellement le fil quand on
// appelle la route, jeton compris.
//
// C'est le lot où l'utilisateur a choisi que le bouton LANCE. La contrepartie
// est assumée ; ces bancs tiennent la borne qui l'empêche de s'élargir.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { PAQUETS } from '../src/shared/connexion-agent.js';
import { OUTILS } from '../src/shared/catalogue-outils.js';

const TOKEN = 'jeton-de-pose-assez-long-pour-passer';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
const INSTALLABLE = Object.keys(PAQUETS)[0]!;
const SANS_COMMANDE = OUTILS.find((o) => o.installation === null)!.id;

let server: HiveServer;
let dir: string;
let base: string;
const ouverts: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-pose-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'pose.db'),
    simulation: false,
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  for (const ws of ouverts.splice(0)) ws.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const poser = (nodeId: string, outilId: string, h: Record<string, string> = headers) =>
  fetch(`${base}/api/nodes/${nodeId}/outils/${outilId}/poser`, { method: 'POST', headers: h });

/** Inscrit un faux nœud et rend son socket, une fois l'accusé reçu. */
function inscrire(nodeId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    ouverts.push(ws);
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'register',
          token: TOKEN,
          nodeId,
          name: nodeId,
          ownerName: 'testeur',
          agentType: 'shell',
          maxConcurrency: 1,
        }),
      );
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'registered') resolve(ws);
    });
    ws.on('close', (c) => reject(new Error(`socket fermé : ${String(c)}`)));
    ws.on('error', reject);
  });
}

describe('la route refuse avant de faire quoi que ce soit', () => {
  it('SANS JETON, RIEN — c’est une exécution chez un membre', async () => {
    const r = await poser('un-noeud', INSTALLABLE, { 'content-type': 'application/json' });
    expect(r.ok).toBe(false);
    expect([401, 403]).toContain(r.status);
  });

  it('UN OUTIL HORS CATALOGUE EST REFUSÉ PAR LA ROUTE', async () => {
    // Le nœud refuserait aussi, mais le dire ici épargne un aller-retour ET
    // ferme la porte au plus tôt : la route ne relaie que ce qu'elle reconnaît.
    const r = await poser('un-noeud', 'outil-qui-nexiste-pas');
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('catalogue');
  });

  it('un outil connu mais sans installation automatique est refusé', async () => {
    const r = await poser('un-noeud', SANS_COMMANDE);
    expect(r.status).toBe(400);
  });

  it('un nœud hors ligne ne peut pas poser', async () => {
    const r = await poser('noeud-jamais-vu', INSTALLABLE);
    expect(r.status).toBe(409);
  });
});

describe('la chaîne complète, jusqu’au fil', () => {
  it('LE NŒUD REÇOIT UN IDENTIFIANT, ET AUCUNE COMMANDE', async () => {
    // Le banc décisif du lot. Si une commande traversait un jour, elle
    // apparaîtrait ici — et c'est le seul endroit où on puisse la voir.
    const nodeId = 'noeud-poseur';
    const ws = await inscrire(nodeId);

    const recu = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as Record<string, unknown>;
        if (m.type === 'poser_outil') resolve(m);
      });
    });

    const r = await poser(nodeId, INSTALLABLE);
    expect(r.status, 'la demande n’a pas été acceptée').toBe(202);
    const corps = (await r.json()) as { poseId: string; outilId: string };
    expect(corps.outilId).toBe(INSTALLABLE);

    const msg = await recu;
    expect(msg.outilId).toBe(INSTALLABLE);
    expect(msg.poseId).toBe(corps.poseId);
    // Rien d'autre que le type et les deux identifiants.
    expect(Object.keys(msg).sort()).toEqual(['outilId', 'poseId', 'type']);
    // Et surtout : pas la moindre trace de la commande, même en cherchant.
    const brut = JSON.stringify(msg);
    for (const morceau of PAQUETS[INSTALLABLE]!) {
      expect(brut, `la commande a fuité : ${morceau}`).not.toContain(morceau);
    }
  });

  it('LA DEMANDE LAISSE UNE TRACE — c’est le prix de l’automatisme', async () => {
    // Un bouton qui installe à distance sans journal est un bouton dont
    // personne ne peut dire, après coup, qui s'en est servi.
    const nodeId = 'noeud-trace';
    await inscrire(nodeId);
    await poser(nodeId, INSTALLABLE);

    const rep = await fetch(`${base}/api/events?limit=200`, { headers });
    const brut: unknown = await rep.json();
    // La route rend le tableau tel quel ; on ne suppose pas d'enveloppe.
    const liste = (Array.isArray(brut) ? brut : []) as { type: string; payload?: unknown }[];
    const trace = liste.find((e) => e.type === 'outil_pose_demandee');
    expect(trace, 'aucune trace de la demande de pose').toBeTruthy();
    expect(JSON.stringify(trace?.payload)).toContain(INSTALLABLE);
  });
});
