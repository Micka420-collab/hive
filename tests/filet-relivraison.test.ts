// Le filet de re-livraison : un filet, pas un robinet.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// La ruche re-sert `assign_task` aux tâches assignées restées muettes plus de
// cinq secondes. C'est un filet pour un message PERDU EN VOL — cas rare qu'une
// reprise suffit à rattraper.
//
// Il ne gardait aucune trace de ses tentatives. Une tâche dont le nœud ne répond
// jamais restait « muette depuis plus de 5 s » pour toujours, donc elle repartait
// À CHAQUE TICK, indéfiniment.
//
// ─── LE RÉGLAGE DU BANC EST ÉCRIT ICI, ET C'EST DÉLIBÉRÉ ─────────────────────
//
// Ces tests tournent avec un `tickMs` court pour ne pas durer des minutes. Le
// défaut de production est 2 000 ms.
//
// Je le dis parce que je m'y suis fait prendre : le premier compte-rendu de ce
// défaut annonçait « 118 renvois en douze secondes », chiffre exact mais mesuré
// à `tickMs: 60` — trente-trois fois le rythme réel. Un nombre mesuré sur un
// banc porte les réglages de ce banc ; le citer sans eux, c'est le transposer
// sans le dire.
//
// Les assertions ci-dessous ne comptent donc PAS des renvois : elles vérifient
// la propriété qui ne dépend pas du tick — l'espacement minimum entre deux
// renvois d'une même tâche.

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-filet-suffisamment-long-pour-passer';

/** Le tick du BANC. La production est à 2 000 ms — voir l'en-tête. */
const TICK_BANC = 60;

/** L'espacement minimum promis par le serveur, en millisecondes. */
const ESPACEMENT = 15_000;

describe('le filet de re-livraison espace ses tentatives', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  const sockets: WebSocket[] = [];
  const battements: NodeJS.Timeout[] = [];

  afterEach(async () => {
    for (const c of battements.splice(0)) clearInterval(c);
    for (const ws of sockets.splice(0)) ws.close();
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function ruche(): Promise<HiveServer> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-filet-'));
    mkdirSync(path.join(dir, 'data', 'cerveau'), { recursive: true });
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'data', 'hive.db'),
      simulation: false,
      tickMs: TICK_BANC,
    });
    return server;
  }

  /**
   * Un nœud VIVANT mais muet sur sa tâche.
   *
   * ─── POURQUOI IL DOIT BATTRE ───────────────────────────────────────────────
   *
   * Première version : un nœud qui ne disait rien du tout. Il mourait de
   * timeout de battement de cœur, le reaper désassignait sa tâche, et la boucle
   * de renvoi s'arrêtait toute seule — le test observait le REAPER, pas
   * l'espacement.
   *
   * Or le cas qui compte en production est l'inverse : un nœud bien vivant, qui
   * bat normalement, mais bloqué sur une tâche dont il ne rend jamais compte.
   * Celui-là n'est jamais moissonné, sa tâche reste « assignée » indéfiniment,
   * et c'est LUI que le filet arrosait sans fin.
   */
  async function noeudMuet(srv: HiveServer): Promise<number[]> {
    const recues: number[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    sockets.push(ws);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'assign_task') recues.push(Date.now());
    });
    await new Promise<void>((r, j) => {
      ws.once('open', () => r());
      ws.once('error', j);
    });
    ws.send(
      JSON.stringify({
        type: 'register',
        token: TOKEN,
        name: 'muet',
        ownerName: 't',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: 'muet',
      }),
    );
    // Le battement : il prouve la vie du nœud sans rien dire de la tâche.
    const coeur = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'heartbeat', running: 1 }));
      }
    }, 500);
    battements.push(coeur);
    return recues;
  }

  it('DEUX RENVOIS D’UNE MÊME TÂCHE SONT ESPACÉS', { timeout: 40_000 }, async () => {
    // ─── L'ASSERTION QUI DÉCIDE ───────────────────────────────────────────
    //
    // Elle ne compte pas les renvois : ce compte dépend du tick, et c'est
    // précisément le piège dans lequel je suis tombé. Elle mesure l'écart
    // MINIMUM entre deux livraisons de la même tâche — une propriété que le
    // tick ne change pas.
    const srv = await ruche();
    const recues = await noeudMuet(srv);

    const projet = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });

    // ─── CE QU'ON LAISSE PASSER, ET POURQUOI C'EST LONG ────────────────────
    //
    // La PREMIÈRE livraison est l'assignation normale, pas un renvoi — la
    // compter comme tel ferait mesurer l'écart « assignation → premier
    // rattrapage », qui vaut les 5 s du filet et n'a rien à voir avec
    // l'espacement. C'est l'erreur qu'a faite la première version de ce test.
    //
    // Il faut donc voir DEUX renvois pour avoir un écart à mesurer :
    // 5 s d'armement, puis deux tours d'espacement. D'où l'observation longue.
    await new Promise((r) => setTimeout(r, 26_000));

    expect(recues.length, 'la tâche n’a jamais été assignée').toBeGreaterThan(0);
    const renvois = recues.slice(1);
    expect(
      renvois.length,
      'moins de deux renvois : pas d’écart à mesurer, le test ne prouverait rien',
    ).toBeGreaterThanOrEqual(2);

    const ecarts = renvois.slice(1).map((t2, i) => t2 - renvois[i]!);
    const plusPetit = Math.min(...ecarts);
    expect(
      plusPetit,
      `deux renvois à ${plusPetit} ms d’écart : le filet est redevenu un robinet ` +
        `(${recues.length} livraisons en 26 s au tick de banc ${TICK_BANC} ms)`,
    ).toBeGreaterThanOrEqual(ESPACEMENT - 1_000);
  });

  it('le filet SERT quand même — il est espacé, pas débranché', { timeout: 40_000 }, async () => {
    // La borne d'à côté serait satisfaite par un filet qui ne renvoie JAMAIS.
    // Celle-ci exige qu'il fasse son travail : la première livraison arrive.
    const srv = await ruche();
    const recues = await noeudMuet(srv);

    const projet = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
    srv.store.patchTask(t.id, { status: 'ready' });

    const fin = Date.now() + 8_000;
    while (recues.length === 0 && Date.now() < fin) await new Promise((r) => setTimeout(r, 40));
    expect(recues.length, 'aucune assignation : le filet ne sert plus à rien').toBeGreaterThan(0);
  });
});
