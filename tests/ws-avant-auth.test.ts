// Ce que le hub faisait pour un inconnu, avant de savoir qui il était.
//
// ─── L'AMPLIFICATION ─────────────────────────────────────────────────────────
//
// `maxPayload` du serveur WebSocket vaut 2 Mo, et c'est la bonne valeur pour un
// nœud AUTHENTIFIÉ : il remonte des diffs. C'était la mauvaise pour un inconnu.
// Le hub appelait `parseClientMessage(data.toString())` — donc une conversion en
// chaîne PUIS un `JSON.parse` sur 2 Mo — avant la moindre vérification
// d'identité.
//
// Le calcul : 100 messages par seconde et par socket (le budget existant),
// pendant les 5 s de la fenêtre d'authentification, soit 1 Go à analyser par
// connexion. Rien ne borne le nombre de connexions. Aucun identifiant requis.
//
// Un message d'authentification, lui, tient dans quelques centaines d'octets.
//
// ─── CE QUI EST TESTÉ ────────────────────────────────────────────────────────
//
// La mesure d'abord, parce que c'est là que se cache le contournement : `ws`
// livre la trame sous trois formes, et les trames FRAGMENTÉES arrivent en
// `Buffer[]`. Ne mesurer que la première laisserait passer, par la fragmentation,
// exactement ce qu'on borne — et l'attaquant choisit sa fragmentation.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIMITS, octetsDe } from '../src/shared/protocol.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

describe('octetsDe — mesurer sans convertir', () => {
  it('compte un Buffer, un ArrayBuffer et une chaîne', () => {
    expect(octetsDe(Buffer.alloc(10))).toBe(10);
    expect(octetsDe(new ArrayBuffer(7))).toBe(7);
    expect(octetsDe('abc')).toBe(3);
    expect(octetsDe('é'), 'des octets, pas des caractères').toBe(2);
  });

  it('COMPTE LES TRAMES FRAGMENTÉES — sinon la garde se contourne', () => {
    // `ws` livre un `Buffer[]` quand la trame arrive en morceaux. Ne regarder
    // que le premier rendrait la limite décorative.
    expect(octetsDe([Buffer.alloc(1000), Buffer.alloc(2000), Buffer.alloc(3000)])).toBe(6000);
  });

  it('ce qu’on ne sait pas mesurer vaut zéro, pas une exception', () => {
    // Cette fonction tourne sur le chemin d'une trame reçue d'un inconnu :
    // lever y transformerait la garde en déni de service.
    expect(octetsDe(null)).toBe(0);
    expect(octetsDe(undefined)).toBe(0);
    expect(octetsDe({})).toBe(0);
  });

  it('la limite avant authentification est très en dessous de celle d’après', () => {
    expect(LIMITS.messageAvantAuth).toBeLessThan(LIMITS.message / 100);
    // …et assez large pour un vrai message d'authentification.
    const registre = JSON.stringify({
      type: 'register',
      name: 'un-nom-de-noeud',
      ownerName: 'un-nom-de-proprietaire',
      agentType: 'claude-code',
      token: 'x'.repeat(LIMITS.token),
      maxConcurrency: 2,
    });
    expect(registre.length).toBeLessThan(LIMITS.messageAvantAuth);
  });
});

describe('sur le vrai serveur', () => {
  let server: HiveServer;
  let dir: string;
  const TOKEN = 'jeton-ws-avant-auth-suffisamment-long';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-wsauth-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Ouvre une socket, envoie une charge, rend le code de fermeture. */
  const envoyer = (charge: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const minuteur = setTimeout(() => {
        ws.terminate();
        reject(new Error('aucune fermeture reçue'));
      }, 10_000);
      ws.on('open', () => ws.send(charge));
      ws.on('close', (code) => {
        clearTimeout(minuteur);
        resolve(code);
      });
      ws.on('error', () => {
        /* la fermeture suit */
      });
    });

  it('UN INCONNU NE FAIT PLUS ANALYSER 2 Mo AU HUB', async () => {
    // La charge est un JSON syntaxiquement valide : sans la garde, le hub le
    // convertirait et l'analyserait entièrement avant de le rejeter.
    const gros = JSON.stringify({ type: 'register', name: 'x'.repeat(1_500_000) });
    expect(gros.length).toBeGreaterThan(LIMITS.messageAvantAuth);
    // 4413 (écho du 413 HTTP) et non 4400 : le refus doit dire que c'est la
    // TAILLE, sinon on ne peut pas distinguer cette garde d'un message mal
    // formé — ni en test, ni en débogage.
    expect(await envoyer(gros)).toBe(4413);
  });

  it('un message d’authentification normal passe la garde', async () => {
    // La garde ne doit pas fermer la porte d'entrée qu'elle protège : un
    // mauvais jeton doit être refusé POUR CE MOTIF (4401), pas pour la taille.
    const normal = JSON.stringify({
      type: 'register',
      name: 'noeud-de-test',
      ownerName: 'quelquun',
      agentType: 'claude-code',
      maxConcurrency: 1,
      token: 'un-jeton-qui-ne-vaut-rien-mais-court',
    });
    expect(await envoyer(normal)).toBe(4401);
  });
});
