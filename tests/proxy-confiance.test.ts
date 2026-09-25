// HIVE_TRUST_PROXY : derrière un proxy, deux clients ont chacun leur compteur ;
// sans confiance déclarée, un X-Forwarded-For forgé ne change rien.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// Fastify était créé sans `trustProxy`. Derrière Caddy (docker-compose.cloud),
// `req.ip` valait l'adresse de Caddy pour TOUS les clients : chaque compteur
// anti-abus rangé par IP était un seul compteur partagé. Critère de la carte
// Notion : « deux clients derrière Caddy disposent de compteurs anti-abus
// indépendants ».
//
// Les bancs d'intégration parlent à une vraie Reine sur un vrai port. Le
// « proxy » est la boucle locale : c'est d'elle que partent les requêtes, et
// c'est elle qu'on déclare (ou non) digne de confiance.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { confiancePourFastify, lireConfianceProxy } from '../src/shared/proxy-confiance.js';

describe('lireConfianceProxy — ce que HIVE_TRUST_PROXY accorde', () => {
  it('RIEN PAR DÉFAUT — absent, vide ou « non » ne font confiance à personne', () => {
    for (const brut of [undefined, '', '  ', '0', 'false', 'off', 'non']) {
      expect(lireConfianceProxy(brut)).toEqual({ valeur: false, refus: null });
    }
  });

  it('« true » EST REFUSÉ — il ferait croire le X-Forwarded-For de n’importe qui', () => {
    for (const brut of ['true', 'TRUE', '*', 'oui']) {
      const lu = lireConfianceProxy(brut);
      expect(lu.valeur).toBe(false);
      expect(lu.refus).toMatch(/nommez le proxy/);
    }
  });

  it('un nombre de sauts de 1 à 10, et rien au-delà', () => {
    expect(lireConfianceProxy('1')).toEqual({ valeur: 1, refus: null });
    expect(lireConfianceProxy('10')).toEqual({ valeur: 10, refus: null });
    expect(lireConfianceProxy('11').valeur).toBe(false);
    expect(lireConfianceProxy('11').refus).toMatch(/de 1 à 10/);
  });

  it('des IP, des CIDR et les plages nommées de proxy-addr', () => {
    expect(lireConfianceProxy('loopback')).toEqual({ valeur: 'loopback', refus: null });
    expect(lireConfianceProxy(' Uniquelocal , 172.18.0.0/16, ::1 ')).toEqual({
      valeur: 'uniquelocal,172.18.0.0/16,::1',
      refus: null,
    });
    expect(lireConfianceProxy('fd00::/8').valeur).toBe('fd00::/8');
    // Une virgule de trop n'est pas une faute : l'entrée vide est ignorée.
    expect(lireConfianceProxy('loopback,').valeur).toBe('loopback');
  });

  it('UNE FAUTE NE RELÂCHE RIEN — elle est nommée, et la confiance reste à zéro', () => {
    for (const brut of ['caddy', '10.0.0.0/33', '300.1.1.1', ',', '1.2.3.4/', 'loopback,caddy']) {
      const lu = lireConfianceProxy(brut);
      expect(lu.valeur, brut).toBe(false);
      expect(lu.refus, brut).not.toBeNull();
    }
  });

  it('un nombre de sauts devient la fonction de proxy-addr : on croit les n premiers', () => {
    const f = confiancePourFastify(2);
    expect(typeof f).toBe('function');
    const croire = f as (adresse: string, saut: number) => boolean;
    expect([0, 1, 2].map((saut) => croire('10.0.0.1', saut))).toEqual([true, true, false]);
    expect(confiancePourFastify('loopback')).toBe('loopback');
    expect(confiancePourFastify(false)).toBe(false);
  });
});

describe('les compteurs anti-abus derrière un proxy — une vraie Reine', () => {
  // Le plafond REST de la Reine : 400 requêtes /api par fenêtre de 10 s et par IP.
  const PLAFOND = 400;
  let serveur: HiveServer | null = null;
  let dossier = '';

  afterEach(async () => {
    await serveur?.stop();
    serveur = null;
    if (dossier) rmSync(dossier, { recursive: true, force: true });
  });

  async function reine(trustProxy: false | string): Promise<HiveServer> {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'proxy-confiance-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: 'jeton-de-banc-suffisamment-long',
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: true,
      trustProxy,
    });
    return serveur;
  }

  /** `n` requêtes /api au nom du client `ip` ; rend le dernier statut. */
  async function marteler(port: number, ip: string, n: number): Promise<number> {
    let dernier = 0;
    for (let lot = 0; lot < n; lot += 50) {
      const statuts = await Promise.all(
        Array.from({ length: Math.min(50, n - lot) }, () =>
          fetch(`http://127.0.0.1:${port}/api/health`, {
            headers: { 'x-forwarded-for': ip },
          }).then((r) => r.status),
        ),
      );
      dernier = statuts[statuts.length - 1]!;
    }
    return dernier;
  }

  it('DERRIÈRE UN PROXY DÉCLARÉ, DEUX CLIENTS ONT DEUX COMPTEURS — le critère de la carte', async () => {
    const { port } = await reine('loopback');
    expect(await marteler(port, '203.0.113.10', PLAFOND + 1), 'A doit être freiné').toBe(429);
    // B passe par le MÊME proxy : avant le correctif, il héritait du compteur de A.
    expect(await marteler(port, '203.0.113.20', 1), 'B paie pour A').toBe(200);
  });

  it('SANS CONFIANCE DÉCLARÉE, UN X-FORWARDED-FOR FORGÉ NE CHANGE PAS DE COMPTEUR', async () => {
    const { port } = await reine(false);
    expect(await marteler(port, '203.0.113.10', PLAFOND + 1)).toBe(429);
    // Changer d'en-tête ne suffit pas à repartir de zéro : c'est la socket qui compte.
    expect(await marteler(port, '198.51.100.99', 1), 'l’en-tête forgé a été cru').toBe(429);
  });

  it('UNE CONFIANCE ACCORDÉE À UN AUTRE RÉSEAU NE PROFITE PAS À UN PAIR QUI N’EN EST PAS', async () => {
    // Le pair (la boucle locale) n'est pas dans 10.0.0.0/8 : son en-tête n'est pas cru.
    const { port } = await reine('10.0.0.0/8');
    expect(await marteler(port, '203.0.113.10', PLAFOND + 1)).toBe(429);
    expect(
      await marteler(port, '198.51.100.99', 1),
      'l’en-tête d’un pair non déclaré a été cru',
    ).toBe(429);
  });
});
