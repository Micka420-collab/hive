// L'application de bureau — la ruche qu'elle prépare (ADR 0013 § 4 à 6).
//
// Ce que l'app décide seule, éprouvé sans Electron : le port gardé (7777
// d'abord, un port libre sinon), le `.env` écrit par la recette de
// l'INSTALLEUR (pas une quatrième), l'environnement imposé aux enfants, et la
// relance d'une Reine qui tombe.

import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  choisirPort,
  deciderPort,
  PORT_PREFERE,
  portGarde,
  portLibre,
  tirerPortLibre,
} from '../desktop/src/port.js';
import {
  cheminsRuche,
  envDeLaRuche,
  envDesEnfants,
  origineLocale,
  poserCle,
} from '../desktop/src/reglages.js';
import { FENETRE_RELANCES_MS, prochaineRelance, RECULS_MS } from '../desktop/src/relance.js';
import {
  completerEnv,
  composerReglages,
  LONGUEUR_JETON,
  LONGUEUR_SECRET_SESSION,
  lireEnv,
} from '../src/installer.js';

const RECETTE = { lireEnv, composerReglages, completerEnv };

const serveurs: Server[] = [];
afterEach(async () => {
  await Promise.all(serveurs.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

/** Occupe un port de la boucle locale, comme le ferait une ruche lancée à côté. */
async function occuper(): Promise<number> {
  const s = createServer();
  serveurs.push(s);
  await new Promise<void>((r) => s.listen({ port: 0, host: '127.0.0.1' }, () => r()));
  const a = s.address();
  if (a === null || typeof a !== 'object') throw new Error('aucune adresse');
  return a.port;
}

describe('le port de la Reine de l’app — gardé, 7777 d’abord', () => {
  it('un port lisible du `.env` se garde ; absent ou illisible, il n’y en a pas', () => {
    expect(portGarde('7911')).toBe(7911);
    expect(portGarde(' 7911 ')).toBe(7911);
    for (const v of [undefined, '', 'abc', '0', '70000', '-1', '7911x']) {
      expect(portGarde(v), String(v)).toBeNull();
    }
  });

  it('la décision : le candidat libre se garde ; pris, on tire — et on sait pourquoi', () => {
    expect(deciderPort(null, true)).toEqual({ genre: 'garder', port: PORT_PREFERE });
    expect(deciderPort(7911, true)).toEqual({ genre: 'garder', port: 7911 });
    expect(deciderPort(null, false)).toEqual({ genre: 'tirer', motif: 'premier' });
    // Le port GARDÉ pris : l'origine de l'écran change — c'est ce qui se dit.
    expect(deciderPort(7911, false)).toEqual({ genre: 'tirer', motif: 'occupe' });
  });

  it('pour de vrai : un port gardé mais PRIS est remplacé par un port libre', async () => {
    const pris = await occuper();
    expect(await portLibre(pris)).toBe(false);
    const { port, decision } = await choisirPort(pris);
    expect(decision).toEqual({ genre: 'tirer', motif: 'occupe' });
    expect(port).not.toBe(pris);
    expect(await portLibre(port)).toBe(true);
  });

  it('pour de vrai : un port gardé LIBRE est repris tel quel', async () => {
    const libre = await tirerPortLibre();
    const { port, decision } = await choisirPort(libre);
    expect(decision).toEqual({ genre: 'garder', port: libre });
    expect(port).toBe(libre);
  });

  it('au premier lancement, 7777 est sondé d’abord — pas un port au hasard', async () => {
    const sondes: number[] = [];
    const { port } = await choisirPort(
      null,
      (p) => {
        sondes.push(p);
        return Promise.resolve(true);
      },
      () => Promise.reject(new Error('rien à tirer')),
    );
    expect(sondes).toEqual([PORT_PREFERE]);
    expect(port).toBe(PORT_PREFERE);
  });
});

describe('le `.env` de la ruche — la recette de l’installeur', () => {
  it('une ruche neuve reçoit le jeton et le secret de l’installeur, au port retenu', () => {
    const env = lireEnv(envDeLaRuche(null, 7777, false, RECETTE));
    expect(env.get('HIVE_TOKEN')?.length).toBe(LONGUEUR_JETON);
    expect(env.get('HIVE_JWT_SECRET')?.length).toBe(LONGUEUR_SECRET_SESSION);
    expect(env.get('HIVE_PORT')).toBe('7777');
    expect(env.get('HIVE_HTTP')).toBe('http://127.0.0.1:7777');
    // Les défauts prudents de l'installeur, sans exception.
    expect(env.get('HIVE_RUNNER')).toBe('off');
    expect(env.get('HIVE_ISOLEMENT')).toBe('auto');
    // Un agent réel détecté : pas de démo simulée.
    expect(env.has('HIVE_SIMULATION')).toBe(false);
  });

  it('deux ruches neuves n’ont jamais le même jeton', () => {
    const a = lireEnv(envDeLaRuche(null, 7777, false, RECETTE)).get('HIVE_TOKEN');
    const b = lireEnv(envDeLaRuche(null, 7777, false, RECETTE)).get('HIVE_TOKEN');
    expect(a).not.toBe(b);
  });

  it('sans agent réel, la démo simulée est posée — sinon la première tâche attendrait toujours', () => {
    const env = lireEnv(envDeLaRuche(null, 7777, true, RECETTE));
    expect(env.get('HIVE_SIMULATION')).toBe('1');
  });

  it('une ruche existante GARDE jeton, secret et réglages ; seuls le port et l’adresse bougent', () => {
    const existant = [
      '# ma note',
      'HIVE_TOKEN=un-jeton-deja-la-et-assez-long-0123',
      'HIVE_JWT_SECRET=un-secret-de-session-deja-la',
      'HIVE_PORT=7777',
      'HIVE_HTTP=http://127.0.0.1:7777',
      'HIVE_RUNNER=on',
      '',
    ].join('\n');
    const apres = envDeLaRuche(existant, 40123, false, RECETTE);
    const env = lireEnv(apres);
    expect(env.get('HIVE_TOKEN')).toBe('un-jeton-deja-la-et-assez-long-0123');
    expect(env.get('HIVE_JWT_SECRET')).toBe('un-secret-de-session-deja-la');
    expect(env.get('HIVE_RUNNER')).toBe('on');
    expect(env.get('HIVE_PORT')).toBe('40123');
    expect(env.get('HIVE_HTTP')).toBe(origineLocale(40123));
    expect(apres.startsWith('# ma note\n')).toBe(true);
  });

  it('`poserCle` remplace la première ligne active, sinon ajoute — sans toucher au reste', () => {
    expect(poserCle('# HIVE_PORT=1\nA=1\nHIVE_PORT=2\nHIVE_PORT=3\n', 'HIVE_PORT', '9')).toBe(
      '# HIVE_PORT=1\nA=1\nHIVE_PORT=9\nHIVE_PORT=3\n',
    );
    expect(poserCle('A=1', 'B', '2')).toBe('A=1\nB=2\n');
    expect(poserCle('', 'B', '2')).toBe('B=2\n');
  });
});

describe('l’environnement des enfants — imposé par l’app', () => {
  const chemins = cheminsRuche(path.join('/donnees', 'Hive'));

  it('la ruche vit dans `<données>/ruche`, la base en chemin ABSOLU', () => {
    expect(chemins.ruche).toBe(path.join('/donnees', 'Hive', 'ruche'));
    expect(chemins.env).toBe(path.join(chemins.ruche, '.env'));
    expect(path.isAbsolute(chemins.db)).toBe(true);
  });

  it('toute variable `HIVE_*` héritée tombe : la ruche de l’app se règle par SON `.env`', () => {
    const env = envDesEnfants(
      { PATH: '/usr/bin', HIVE_TOKEN: 'celui-du-zshrc', HIVE_DB: '/ailleurs.db', HOME: '/h' },
      chemins,
      7777,
    );
    expect(env.HIVE_TOKEN).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/h');
    expect(env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      HIVE_HOST: '127.0.0.1',
      HIVE_PORT: '7777',
      HIVE_DB: chemins.db,
      HIVE_POSE: 'bureau',
    });
  });
});

describe('la Reine qui tombe — 1 s, 5 s, 30 s, puis on s’arrête', () => {
  it('trois relances avec recul, puis plus rien', () => {
    const t0 = 1_000_000;
    expect(prochaineRelance([], t0)).toBe(RECULS_MS[0]);
    expect(prochaineRelance([t0], t0 + 10)).toBe(RECULS_MS[1]);
    expect(prochaineRelance([t0, t0 + 1], t0 + 20)).toBe(RECULS_MS[2]);
    expect(prochaineRelance([t0, t0 + 1, t0 + 2], t0 + 30)).toBeNull();
  });

  it('seules les relances de la fenêtre comptent : une chute par jour n’épuise rien', () => {
    const t0 = 1_000_000;
    const anciennes = [t0, t0 + 1, t0 + 2];
    expect(prochaineRelance(anciennes, t0 + FENETRE_RELANCES_MS + 10)).toBe(RECULS_MS[0]);
  });
});
