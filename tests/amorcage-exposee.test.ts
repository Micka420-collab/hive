// Le premier compte d'une ruche — celui qui devient administrateur — exige le
// jeton de ruche. TOUJOURS.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// Le premier compte créé devient admin (`roleALaCreation`), sans autre preuve.
// Sur une ruche joignable au-delà de la machine, quiconque appelait
// `/api/auth/register` avant l'hôte prenait l'administration de la ruche.
//
// La première garde (#440) n'exigeait le jeton que sur une ruche EXPOSÉE, jugée
// par son adresse d'ÉCOUTE. Or le montage documenté du Cloud hors Docker pose
// Caddy sur la même machine et la Reine sur 127.0.0.1 : elle écoute la boucle
// locale et reçoit Internet. Mesuré : `X-Forwarded-For: 203.0.113.7`, sans
// jeton → `200 {role:'admin'}`. L'amorce ne devine donc plus la topologie.
//
// Les bancs d'intégration parlent à une vraie Reine, sur 0.0.0.0 (exposée) et
// sur 127.0.0.1 derrière un proxy local déclaré (`trustProxy: 'loopback'`).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inscriptionPermise } from '../src/orchestrator/comptes.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-amorcage-suffisamment-long';

describe('inscriptionPermise — l’amorce exige le jeton de ruche', () => {
  it('SANS JETON : le premier compte est refusé, et le motif dit quoi présenter', () => {
    const porte = inscriptionPermise({ mode: 'ouverte', comptesExistants: 0 });
    expect(porte.permise).toBe(false);
    expect(porte.motif).toMatch(/HIVE_TOKEN/);
    expect(inscriptionPermise({ mode: 'fermee', comptesExistants: 0 }).permise).toBe(false);
  });

  it('AVEC LE JETON : le premier compte passe, même inscriptions fermées', () => {
    for (const mode of ['ouverte', 'sur_invitation', 'fermee'] as const) {
      expect(
        inscriptionPermise({ mode, comptesExistants: 0, jetonDeRuche: true }).permise,
        mode,
      ).toBe(true);
    }
  });

  it('LES COMPTES SUIVANTS NE DEMANDENT PAS LE JETON — seule l’amorce est gardée', () => {
    expect(inscriptionPermise({ mode: 'ouverte', comptesExistants: 1 }).permise).toBe(true);
    expect(inscriptionPermise({ mode: 'sur_invitation', comptesExistants: 1 }).permise).toBe(false);
  });
});

describe('l’amorce sur une vraie Reine', () => {
  let serveur: HiveServer | null = null;
  let dossier = '';

  afterEach(async () => {
    await serveur?.stop();
    serveur = null;
    if (dossier) rmSync(dossier, { recursive: true, force: true });
  });

  async function reine(
    host: string,
    trustProxy: false | string = false,
  ): Promise<{ base: string; serveur: HiveServer }> {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'amorcage-'));
    serveur = await createServer({
      port: 0,
      host,
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
      trustProxy,
    });
    return { base: `http://127.0.0.1:${serveur.port}`, serveur };
  }

  function inscrire(base: string, email: string, entetes: Record<string, string> = {}) {
    return fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify({
        email,
        password: 'Une-phrase-de-passe-solide-42',
        displayName: 'Hôte',
      }),
    });
  }

  it('RUCHE EXPOSÉE : SANS LE JETON, PERSONNE NE S’EMPARE DE L’ADMINISTRATION', async () => {
    const { base, serveur: s } = await reine('0.0.0.0');

    const sans = await inscrire(base, 'intrus@exemple.fr');
    expect(sans.status).toBe(403);
    expect(((await sans.json()) as { error: string }).error).toMatch(/HIVE_TOKEN/);

    const faux = await inscrire(base, 'intrus@exemple.fr', {
      'x-hive-token': 'pas-le-bon-jeton-du-tout',
    });
    expect(faux.status).toBe(403);
    expect(s.store.countUsers(), 'un compte a été créé malgré le refus').toBe(0);

    const hote = await inscrire(base, 'hote@exemple.fr', { 'x-hive-token': JETON });
    expect(hote.status).toBe(200);
    expect(((await hote.json()) as { role: string }).role).toBe('admin');

    // Une fois l'hôte en place, l'inscription suit ses règles habituelles.
    const membre = await inscrire(base, 'membre@exemple.fr');
    expect(membre.status).toBe(200);
    expect(((await membre.json()) as { role: string }).role).toBe('membre');
  });

  it('PROXY SUR LA MÊME MACHINE : une Reine en boucle locale ne donne pas l’administration à Internet', async () => {
    // Le montage Cloud hors Docker : Caddy sur la machine, Reine sur 127.0.0.1,
    // HIVE_TRUST_PROXY=loopback. La requête d'un inconnu arrive par la boucle
    // locale, avec son adresse dans X-Forwarded-For.
    const { base, serveur: s } = await reine('127.0.0.1', 'loopback');
    const relaye = await inscrire(base, 'intrus@exemple.fr', {
      'x-forwarded-for': '203.0.113.7',
    });
    expect(relaye.status, 'un inconnu relayé par le proxy local').toBe(403);
    expect(s.store.countUsers(), 'un compte a été créé malgré le refus').toBe(0);

    const hote = await inscrire(base, 'hote@exemple.fr', {
      'x-forwarded-for': '198.51.100.4',
      'x-hive-token': JETON,
    });
    expect(hote.status).toBe(200);
    expect(((await hote.json()) as { role: string }).role).toBe('admin');
  });

  it('BOUCLE LOCALE SANS PROXY : l’amorce exige le jeton aussi — la Reine ne devine plus', async () => {
    // Personne ne peut savoir, depuis la Reine, si un proxy relaie la boucle
    // locale sans qu'on le lui ait dit. Ses deux appelants réels (tableau de
    // bord, essai d'entrée) présentent déjà le jeton.
    const { base } = await reine('127.0.0.1');
    expect((await inscrire(base, 'hote@exemple.fr')).status).toBe(403);
    const hote = await inscrire(base, 'hote@exemple.fr', { 'x-hive-token': JETON });
    expect(hote.status).toBe(200);
    expect(((await hote.json()) as { role: string }).role).toBe('admin');
  });
});
