// Le premier compte d'une ruche EXPOSÉE — celui qui devient administrateur —
// exige le jeton de ruche.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// Le premier compte créé devient admin (`roleALaCreation`), sans autre preuve.
// Sur une ruche qui écoute au-delà de la boucle locale (Cloud derrière Caddy,
// serveur posé avec HIVE_HOST=0.0.0.0, partage LAN), quiconque appelait
// `/api/auth/register` avant l'hôte prenait l'administration de la ruche.
//
// Les bancs d'intégration parlent à une vraie Reine qui écoute sur 0.0.0.0 —
// donc exposée — et qu'on joint par 127.0.0.1.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inscriptionPermise } from '../src/orchestrator/comptes.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-amorcage-suffisamment-long';

describe('inscriptionPermise — l’amorce d’une ruche exposée', () => {
  it('EXPOSÉE ET SANS JETON : le premier compte est refusé, et le motif dit quoi présenter', () => {
    const porte = inscriptionPermise({ mode: 'ouverte', comptesExistants: 0, exposee: true });
    expect(porte.permise).toBe(false);
    expect(porte.motif).toMatch(/HIVE_TOKEN/);
  });

  it('EXPOSÉE AVEC LE JETON : le premier compte passe, même inscriptions fermées', () => {
    for (const mode of ['ouverte', 'sur_invitation', 'fermee'] as const) {
      expect(
        inscriptionPermise({ mode, comptesExistants: 0, exposee: true, jetonDeRuche: true })
          .permise,
        mode,
      ).toBe(true);
    }
  });

  it('BOUCLE LOCALE : rien ne change — le premier venu a déjà la machine', () => {
    expect(inscriptionPermise({ mode: 'fermee', comptesExistants: 0 }).permise).toBe(true);
    expect(
      inscriptionPermise({ mode: 'ouverte', comptesExistants: 0, exposee: false }).permise,
    ).toBe(true);
  });

  it('LES COMPTES SUIVANTS NE DEMANDENT PAS LE JETON — seule l’amorce est gardée', () => {
    expect(
      inscriptionPermise({ mode: 'ouverte', comptesExistants: 1, exposee: true }).permise,
    ).toBe(true);
    expect(
      inscriptionPermise({ mode: 'sur_invitation', comptesExistants: 1, exposee: true }).permise,
    ).toBe(false);
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

  async function reine(host: string): Promise<{ base: string; serveur: HiveServer }> {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'amorcage-'));
    serveur = await createServer({
      port: 0,
      host,
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
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

  it('RUCHE EN BOUCLE LOCALE : l’amorce reste sans jeton, comme avant', async () => {
    const { base } = await reine('127.0.0.1');
    const hote = await inscrire(base, 'hote@exemple.fr');
    expect(hote.status).toBe(200);
    expect(((await hote.json()) as { role: string }).role).toBe('admin');
  });
});
