// HIVE_ENV_FILE : où la Reine range les clés posées depuis la Chambre, et
// comment elle les relit au démarrage.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// `POST /api/queen/cles` écrivait dans le `.env` du dossier courant. Les deux
// compose montent la racine du conteneur en LECTURE SEULE : `/app/.env` n'est
// pas inscriptible, la route rendait 500 `ecriture_env`, et accorder une clé
// depuis la Chambre ne marchait dans aucune installation Docker. L'image pose
// maintenant `HIVE_ENV_FILE` dans le volume de données.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, loadConfigFromEnv, type HiveServer } from '../src/orchestrator/server.js';
import { chargerEnvQueen, cheminEnvQueen } from '../src/shared/env-queen.js';

const RACINE = path.resolve(import.meta.dirname, '..');

describe('cheminEnvQueen — le fichier de clés de la Reine', () => {
  it('SANS RÉGLAGE, RIEN NE CHANGE — le `.env` du dossier', () => {
    expect(cheminEnvQueen({}, '/srv/ruche')).toBe(path.join('/srv/ruche', '.env'));
    expect(cheminEnvQueen({ HIVE_ENV_FILE: '  ' }, '/srv/ruche')).toBe(
      path.join('/srv/ruche', '.env'),
    );
  });

  it('un chemin relatif se lit depuis le dossier de la ruche, un absolu tel quel', () => {
    expect(cheminEnvQueen({ HIVE_ENV_FILE: 'data/queen.env' }, '/srv/ruche')).toBe(
      path.resolve('/srv/ruche', 'data/queen.env'),
    );
    const absolu = path.resolve('/app/data/queen.env');
    expect(cheminEnvQueen({ HIVE_ENV_FILE: absolu }, '/srv/ruche')).toBe(absolu);
  });

  it('LA CONFIGURATION DE LA REINE S’Y RANGE — et ne bouge pas sans réglage', () => {
    expect(loadConfigFromEnv({}).envPath).toBeUndefined();
    const absolu = path.resolve('/app/data/queen.env');
    expect(loadConfigFromEnv({ HIVE_ENV_FILE: absolu }).envPath).toBe(absolu);
  });
});

describe('chargerEnvQueen — ce que la Reine relit en démarrant', () => {
  const dossier = path.resolve('/srv/ruche');
  const local = path.join(dossier, '.env');
  const cles = path.resolve('/app/data/queen.env');

  it('le `.env` d’abord, puis le fichier de clés — celui-ci peut être nommé par celui-là', () => {
    const charges: string[] = [];
    const rendus = chargerEnvQueen(
      { HIVE_ENV_FILE: cles },
      dossier,
      (f) => charges.push(f),
      () => true,
    );
    expect(charges).toEqual([local, cles]);
    expect(rendus).toEqual([local, cles]);
  });

  it('UN FICHIER ABSENT N’EST PAS UNE ERREUR — une ruche neuve n’a encore aucune clé', () => {
    const charges: string[] = [];
    chargerEnvQueen(
      { HIVE_ENV_FILE: cles },
      dossier,
      (f) => charges.push(f),
      (f) => f === local,
    );
    expect(charges).toEqual([local]);
  });

  it('le même fichier n’est pas chargé deux fois', () => {
    const charges: string[] = [];
    chargerEnvQueen(
      {},
      dossier,
      (f) => charges.push(f),
      () => true,
    );
    expect(charges).toEqual([local]);
  });
});

describe('l’image Docker range les clés dans son volume', () => {
  it('HIVE_ENV_FILE vit sous le VOLUME de données — le seul endroit inscriptible du conteneur', () => {
    const dockerfile = readFileSync(path.join(RACINE, 'Dockerfile'), 'utf8');
    const volume = /^VOLUME \["([^"]+)"\]/m.exec(dockerfile)?.[1];
    const fichier = /^ENV HIVE_ENV_FILE=(\S+)/m.exec(dockerfile)?.[1];
    expect(volume, 'VOLUME introuvable').toBeTruthy();
    expect(fichier, 'ENV HIVE_ENV_FILE introuvable').toBeTruthy();
    expect(fichier!.startsWith(`${volume}/`), `${fichier} n’est pas sous ${volume}`).toBe(true);
  });
});

describe('le parcours complet sur une vraie Reine', () => {
  let serveur: HiveServer | null = null;
  let dossier = '';

  afterEach(async () => {
    await serveur?.stop();
    serveur = null;
    delete process.env.SEEDANCE_API_KEY;
    if (dossier) rmSync(dossier, { recursive: true, force: true });
  });

  it('LA CLÉ POSÉE DEPUIS LA CHAMBRE VA DANS HIVE_ENV_FILE — et se relit au redémarrage', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'env-queen-'));
    const fichier = path.join(dossier, 'donnees', 'queen.env');
    const config = loadConfigFromEnv({ HIVE_ENV_FILE: fichier });
    serveur = await createServer({
      ...config,
      port: 0,
      host: '127.0.0.1',
      token: 'jeton-env-queen-suffisamment-long',
      dbPath: path.join(dossier, 'donnees', 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    const base = `http://127.0.0.1:${serveur.port}`;
    const inscription = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'hote@exemple.fr',
        password: 'Une-phrase-de-passe-solide-42',
        displayName: 'Hôte',
      }),
    });
    const { token } = (await inscription.json()) as { token: string };

    const pose = await fetch(`${base}/api/queen/cles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ envVar: 'SEEDANCE_API_KEY', secret: 'sk-seedance-env-queen' }),
    });
    expect(pose.status).toBe(200);
    expect(existsSync(fichier), 'la clé n’est pas allée dans HIVE_ENV_FILE').toBe(true);
    expect(readFileSync(fichier, 'utf8')).toContain('SEEDANCE_API_KEY=sk-seedance-env-queen');
    expect(existsSync(path.join(dossier, '.env')), 'un `.env` a été écrit à côté').toBe(false);

    // « Redémarrage » : un environnement neuf relit le fichier de clés.
    delete process.env.SEEDANCE_API_KEY;
    chargerEnvQueen({ HIVE_ENV_FILE: fichier }, dossier);
    expect(process.env.SEEDANCE_API_KEY).toBe('sk-seedance-env-queen');
  });
});
