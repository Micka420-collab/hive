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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

// ─── COMBIEN D'INCONNUS À LA FOIS ────────────────────────────────────────────
//
// La taille d'un message d'inconnu est bornée ; leur NOMBRE ne l'était pas. Une
// boucle qui ouvre des sockets sans jamais parler tenait un descripteur et trois
// minuteurs chacune, cinq secondes durant, sans aucune identité. Le hub borne
// désormais les sockets ANONYMES par client et en tout (`WS_ATTENTE_PAR_CLIENT`
// = 16, `WS_ATTENTE_MAX` = 256) ; une socket authentifiée ne compte plus.
//
// Les clients se distinguent par `X-Forwarded-For`, la Reine faisant confiance
// à la boucle locale : c'est le montage derrière Caddy, et c'est lui qui prouve
// que le plafond « par client » vise le CLIENT — pas le proxy, qui verrait sans
// cela tout le monde partager un seul compteur.
describe('le nombre de sockets anonymes est borné — par client et en tout', () => {
  let server: HiveServer;
  let dir: string;
  const TOKEN = 'jeton-ws-attente-suffisamment-long';
  const ouvertes: WebSocket[] = [];

  // UNE REINE PAR TEST. Le décompte des inconnus vit dans le hub, et une
  // socket fermée côté client n'en sort qu'au passage de sa fermeture côté
  // serveur : partager la Reine ferait dépendre chaque test des restes du
  // précédent — et `tamis-ordres` rejoue ces tests dans tous les ordres.
  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-wsattente-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
      trustProxy: 'loopback',
    });
  });

  afterEach(async () => {
    for (const ws of ouvertes.splice(0)) ws.terminate();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Ouvre une socket muette au nom de `client` ; rend-la une fois ouverte, avec
   * la promesse de son code de fermeture.
   */
  const muette = (client: string): Promise<{ ws: WebSocket; fermee: Promise<number> }> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
        headers: { 'x-forwarded-for': client },
      });
      ouvertes.push(ws);
      const fermee = new Promise<number>((r) => ws.once('close', (code) => r(code)));
      ws.once('open', () => resolve({ ws, fermee }));
      ws.once('error', reject);
    });

  /** Le code de fermeture, ou `'ouverte'` si la socket tient encore après `ms`. */
  const issue = (fermee: Promise<number>, ms = 1_000): Promise<number | 'ouverte'> =>
    Promise.race([fermee, new Promise<'ouverte'>((r) => setTimeout(() => r('ouverte'), ms))]);

  it('LA 17e SOCKET MUETTE D’UN MÊME CLIENT EST REFUSÉE — pas celle d’un autre client', async () => {
    const a = '203.0.113.10';
    await Promise.all(Array.from({ length: 16 }, () => muette(a)));
    const dixSeptieme = await muette(a);
    // 4429 fait écho au 429 HTTP : ce n'est pas l'identité qui manque, c'est la place.
    expect(await issue(dixSeptieme.fermee), 'le 17e inconnu du même client').toBe(4429);

    // B passe par le MÊME proxy : un plafond par socket de pair l'aurait
    // refusé avec A. Il passe la garde — et c'est son jeton faux qui le ferme.
    const b = await muette('203.0.113.20');
    b.ws.send(JSON.stringify({ type: 'subscribe', token: 'pas-le-bon-jeton-du-tout' }));
    expect(await issue(b.fermee), 'un autre client derrière le même proxy').toBe(4401);
  });

  it('UNE SOCKET QUI S’AUTHENTIFIE LIBÈRE SA PLACE', async () => {
    const c = '203.0.113.30';
    const seize = await Promise.all(Array.from({ length: 16 }, () => muette(c)));
    const premiere = seize[0]!;
    const abonnee = new Promise<void>((r) =>
      premiere.ws.on('message', (d) => {
        if ((JSON.parse(d.toString()) as { type: string }).type === 'state') r();
      }),
    );
    premiere.ws.send(JSON.stringify({ type: 'subscribe', token: TOKEN }));
    await abonnee;
    // Le tableau de bord abonné reste ouvert, mais il ne compte plus parmi les
    // inconnus : la place qu'il occupait est rendue.
    const suivante = await muette(c);
    expect(await issue(suivante.fermee), 'la place rendue par l’authentification').toBe('ouverte');
    expect(await issue(premiere.fermee, 50), 'le tableau de bord authentifié reste').toBe(
      'ouverte',
    );
  });

  it('AU-DELÀ DE 256 INCONNUS EN TOUT, MÊME UN CLIENT NEUF ATTEND', async () => {
    // Seize clients distincts, chacun à son propre plafond : c'est le plafond
    // GLOBAL qui mord, pas celui du client. Par lots de 64 : 256 poignées de
    // main lancées d'un coup débordent la file d'attente TCP de Windows
    // (ECONNREFUSED), et le banc mesurerait le noyau, pas le hub. Pas plus
    // lent non plus : les premières doivent encore attendre leur identité
    // (5 s) quand la 257e arrive.
    for (let lot = 0; lot < 4; lot += 1) {
      await Promise.all(
        Array.from({ length: 64 }, (_, i) =>
          muette(`198.51.100.${lot * 4 + Math.floor(i / 16) + 1}`),
        ),
      );
    }
    const neuf = await muette('192.0.2.77');
    expect(await issue(neuf.fermee), 'le 257e inconnu, d’un client jamais vu').toBe(4429);
  }, 20_000);
});
