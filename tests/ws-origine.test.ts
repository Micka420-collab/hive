// LA PORTE D'ORIGINE DU WEBSOCKET — promise au README, et que rien n'éprouvait.
//
// ─── CE QUI A ÉTÉ MESURÉ AVANT D'ÉCRIRE CE FICHIER ───────────────────────────
//
// La section « Sécurité » du README promet, en toutes lettres :
//
//     CORS restreint, jamais `*` ; **origine des WebSockets vérifiée**
//
// La première moitié est tenue par `security-invariants`. La seconde ne l'était
// par rien, et pas par hasard : la porte ne se referme que sur une connexion
// PORTANT un en-tête `Origin`, et pas un seul banc du dépôt n'en envoyait.
//
// Ce n'est pas un échantillonnage, c'est une propriété de construction : AUCUN
// `new WebSocket(...)` de la suite n'a de second argument, donc aucun ne peut
// porter d'en-tête. La ligne était hors d'atteinte de tous les bancs à la fois.
//
// Contre-épreuve avant d'écrire : la porte neutralisée (`if (false && …)`),
// les 78 bancs de `acces-ws`, `ws-avant-auth`, `acces-projet` et `gardiennes`
// restaient VERTS. Une garde de sécurité qu'on peut retirer sans faire rougir
// la suite n'est pas gardée — elle est seulement écrite.
//
// ─── CE QUE CETTE PORTE PROTÈGE, ET CE QU'ELLE NE PROTÈGE PAS ────────────────
//
// Elle protège le NAVIGATEUR d'un tiers : une page hostile ouverte par le même
// utilisateur ne peut pas parler à sa ruche, parce que le navigateur pose
// `Origin` lui-même et qu'on ne peut pas le lui faire mentir.
//
// Elle ne protège de rien d'autre, et le dernier cas ci-dessous le dit tout
// haut : un client SANS `Origin` passe. C'est nécessaire — un nœud Hive n'est
// pas un navigateur et n'en envoie pas — et c'est donc une porte qui filtre les
// pages, jamais les programmes. Un banc qui tairait ce cas laisserait croire à
// une garde d'authentification ; l'authentification, elle, est ailleurs.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

describe('l’origine d’une connexion WebSocket', () => {
  let server: HiveServer;
  let dir: string;
  const TOKEN = 'jeton-ws-origine-suffisamment-long';
  const AUTORISEE = 'http://localhost:5173';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-wsorigine-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: [AUTORISEE],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Ouvre une socket avec (ou sans) `Origin` et rend ce qui arrive en premier.
   *
   * `'ouverte'` n'est PAS l'absence de refus : le refus arrive lui aussi après
   * la poignée de main, sous forme de fermeture. Il faut donc laisser au
   * serveur le temps de refuser, sinon ce banc rendrait « ouverte » pour tout.
   */
  const ouvrir = (origin: string | null): Promise<'ouverte' | number> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${server.port}/ws`,
        origin === null ? {} : { headers: { Origin: origin } },
      );
      const minuteur = setTimeout(() => {
        ws.terminate();
        reject(new Error('ni ouverture ni fermeture en 10 s'));
      }, 10_000);
      const fini = (v: 'ouverte' | number): void => {
        clearTimeout(minuteur);
        resolve(v);
        ws.close();
      };
      // Laisser 300 ms au refus : il vient APRÈS l'ouverture.
      ws.on('open', () => setTimeout(() => fini('ouverte'), 300));
      ws.on('close', (code) => fini(code));
      ws.on('error', () => {
        /* une fermeture suit */
      });
    });

  it('UNE ORIGINE ÉTRANGÈRE EST FERMÉE EN 4403', async () => {
    // Le cas qui donne son sens à la ligne : une page servie ailleurs, ouverte
    // dans le navigateur de quelqu'un qui a une ruche chez lui.
    expect(await ouvrir('http://ailleurs.example')).toBe(4403);
  });

  it('une origine LISTÉE passe — sinon la porte serait un mur', async () => {
    // Sans ce cas, un mutant qui fermerait TOUT resterait vert : la garde ne
    // dirait plus « filtre », elle dirait « refuse », et le dashboard servi
    // depuis Vite ne pourrait plus se connecter.
    expect(await ouvrir(AUTORISEE)).toBe('ouverte');
  });

  it('l’origine du MÊME hôte passe, même absente de la liste', async () => {
    // Le dashboard servi par l'orchestrateur lui-même : personne ne l'inscrit
    // dans HIVE_CORS_ORIGIN, et il doit fonctionner sur une ruche nue.
    expect(await ouvrir(`http://127.0.0.1:${server.port}`)).toBe('ouverte');
  });

  it('SANS origine, ça passe — et c’est la limite de cette garde, pas un trou', async () => {
    // Un nœud Hive n'est pas un navigateur : il n'envoie pas d'`Origin`, et
    // exiger l'en-tête couperait tous les nœuds. Ce cas est écrit pour que
    // personne ne lise cette porte comme une authentification.
    expect(await ouvrir(null)).toBe('ouverte');
  });
});
