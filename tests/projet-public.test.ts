// La seule route anonyme de la ruche — et ce qu'elle laissait passer.
//
// `GET /api/projects/public` renvoyait `SELECT * FROM projects`. Deux colonnes
// n'avaient rien à y faire : `repoUrl` (un dépôt privé se clone en écrivant ses
// identifiants dans l'URL, et rien ne l'interdisait) et `ownerId` (une cible
// nommée, sans contrepartie pour le visiteur).
//
// Le test qui compte ici est le DERNIER : il relit `types.ts` et échoue si un
// champ de `Project` n'est ni publié ni explicitement retenu. Sans lui, la
// prochaine colonne ajoutée à la table — un jeton d'intégration, une clé de
// webhook — serait publiée le jour de son ajout, sans que personne l'ait
// décidé. C'est exactement ainsi que la fuite d'aujourd'hui est née.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHAMPS_RETENUS, sansIdentifiants, vuePublique } from '../src/shared/projet-public.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Project } from '../src/shared/types.js';

const projet = (extra: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Ruche',
  repoUrl: null,
  description: 'un projet',
  visibility: 'public',
  ownerId: 'user-42',
  createdAt: 1000,
  ...extra,
});

describe('sansIdentifiants — un jeton ne sort pas d’ici', () => {
  it('RETIRE LES IDENTIFIANTS D’UNE URL, ET GARDE L’URL', () => {
    expect(sansIdentifiants('https://user:ghp_secret@github.com/org/depot.git')).toBe(
      'https://github.com/org/depot.git',
    );
    expect(sansIdentifiants('https://jeton@gitlab.com/org/depot.git')).toBe(
      'https://gitlab.com/org/depot.git',
    );
  });

  it('AUCUNE FORME NE LAISSE FUIR LE SECRET', () => {
    // Le test qui compte : peu importe la forme, le secret ne doit jamais
    // apparaître dans la sortie.
    for (const url of [
      'https://user:ghp_secret@github.com/org/d.git',
      'https://ghp_secret@github.com/org/d.git',
      'https://user:ghp_secret@github.com:8443/org/d.git',
      'http://user:ghp_secret@interne.local/d.git',
      'https://user:ghp_secret@github.com/org/d.git?x=1#f',
    ]) {
      expect(sansIdentifiants(url) ?? '', url).not.toContain('ghp_secret');
    }
  });

  it('une URL ordinaire n’est pas abîmée', () => {
    for (const url of [
      'https://github.com/org/depot.git',
      'https://github.com/org/depot',
      'git@github.com:org/depot.git',
    ]) {
      expect(sansIdentifiants(url), url).toBe(url);
    }
  });

  it('un CHEMIN LOCAL n’est pas publié — il décrit la machine de l’hôte', () => {
    for (const chemin of ['/home/mika/projets/secret', 'C:\\Users\\mika\\depot', '\\\\srv\\part']) {
      expect(sansIdentifiants(chemin), chemin).toBeNull();
    }
  });

  it('ce qu’on ne sait pas analyser n’est pas publié', () => {
    // Sur une route anonyme, devant un doute, ne rien dire est le bon défaut.
    for (const tordu of ['', '   ', 'pas une url', 'ht!tp://x']) {
      expect(sansIdentifiants(tordu), tordu).toBeNull();
    }
    expect(sansIdentifiants(null)).toBeNull();
  });
});

describe('vuePublique — une liste blanche, pas un filtre', () => {
  it('NE PUBLIE NI ownerId NI visibility', () => {
    const v = vuePublique(projet()) as unknown as Record<string, unknown>;
    expect(Object.keys(v).sort()).toEqual(
      ['createdAt', 'description', 'id', 'name', 'repoUrl'].sort(),
    );
    expect('ownerId' in v).toBe(false);
  });

  it('le dépôt sort lavé', () => {
    const v = vuePublique(projet({ repoUrl: 'https://u:ghp_x@github.com/o/d.git' }));
    expect(v.repoUrl).toBe('https://github.com/o/d.git');
  });

  it('AUCUN CHAMP INCONNU NE PASSE — même s’il est en base', () => {
    // Une ligne SQLite porte ce que la table contient, pas ce que le type
    // annonce : la projection doit construire, jamais copier.
    const avecEnPlus = { ...projet(), jetonInterne: 'secret-de-la-table' } as unknown as Project;
    expect(JSON.stringify(vuePublique(avecEnPlus))).not.toContain('secret-de-la-table');
  });
});

describe('LA GARDE DE DEMAIN — une colonne nouvelle est une décision', () => {
  it('tout champ de Project est soit publié, soit retenu explicitement', () => {
    const types = readFileSync(
      fileURLToPath(new URL('../src/shared/types.ts', import.meta.url)),
      'utf8',
    );
    const bloc = types.slice(types.indexOf('export interface Project {'));
    const corps = bloc.slice(0, bloc.indexOf('\n}'));
    const champs = [...corps.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
    expect(champs.length, 'méta-test : l’interface Project doit être lue').toBeGreaterThan(4);

    const publies = new Set(Object.keys(vuePublique(projet())));
    for (const champ of champs) {
      const decide = publies.has(champ) || champ in CHAMPS_RETENUS;
      expect(
        decide,
        `« ${champ} » n'est ni publié ni retenu. Ajoutez-le à ProjetPublic si un ` +
          'visiteur anonyme doit le voir, sinon à CHAMPS_RETENUS avec la raison.',
      ).toBe(true);
    }
  });

  it('rien n’est « retenu » sans raison écrite', () => {
    for (const [champ, raison] of Object.entries(CHAMPS_RETENUS)) {
      expect(raison.length, champ).toBeGreaterThan(20);
    }
  });
});

describe('GET /api/projects/public — anonyme, donc avare', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  const TOKEN = 'jeton-projets-publics-assez-long';

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-pub-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    server.store.createProject({
      name: 'Catalogue',
      // Exactement ce qu'écrit quelqu'un qui veut cloner un dépôt privé sans
      // configurer git : ses identifiants dans l'URL.
      repoUrl: 'https://mika:ghp_TRESSECRET@github.com/mika/depot.git',
      visibility: 'public',
      ownerId: 'user-a-ne-pas-nommer',
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('LE JETON DU DÉPÔT NE SORT PAS, SANS AUCUNE AUTHENTIFICATION', async () => {
    // Aucun en-tête : c'est le point de vue de n'importe qui sur Internet.
    const res = await fetch(`${base}/api/projects/public`);
    expect(res.status).toBe(200);
    const corps = await res.text();
    expect(corps, 'le jeton du dépôt est publié').not.toContain('ghp_TRESSECRET');
    expect(corps, 'l’identifiant du propriétaire est publié').not.toContain('ownerId');
  });
});
