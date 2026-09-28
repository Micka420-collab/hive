// L'application de bureau — la VIE de sa ruche : `RucheBureau` piloté de bout en
// bout, avec un faux superviseur de Hive (aucun processus lancé), le vrai état
// de l'app et la vraie règle de la page de la fenêtre (ADR 0013 § 2).
//
// Ce que les politiques pures (relance, port, réglages) ne disaient pas : la
// SUITE des états quand une Reine meurt, se relance et remeurt ; un second
// démarrage pendant le premier ; la démo simulée décidée pour UN lancement.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hive, ModuleSuperviseur, PlanOpaque } from '../desktop/src/contrat-hive.js';
import { type Etat, etat, majEtat, surEtat } from '../desktop/src/etat.js';
import { pageVoulue } from '../desktop/src/navigation.js';
import {
  NOTIFICATION_REINE_ARRETEE,
  type NotificationRuche,
} from '../desktop/src/notifications.js';
import { cheminsRuche } from '../desktop/src/reglages.js';
import { RECULS_MS } from '../desktop/src/relance.js';
import { RucheBureau } from '../desktop/src/superviseur-bureau.js';
import { completerEnv, composerReglages, lireEnv } from '../src/installer.js';

/** Les journaux de la coquille (electron-log) ne servent pas ici : muets. */
const MUET = { info: () => undefined, warn: () => undefined, error: () => undefined };

type OptionsLancement = Parameters<ModuleSuperviseur['lancerRuche']>[0];

/** Un lancement du faux superviseur : ce qu'il a reçu, et de quoi le faire vivre ou mourir. */
interface Lancement {
  readonly env: NodeJS.ProcessEnv | undefined;
  readonly annoncer: () => void;
  readonly mourir: (code: number) => void;
  arrete: boolean;
}

function fausseHive(agents: readonly string[]): { hive: Hive; lancements: Lancement[] } {
  const lancements: Lancement[] = [];
  const lancerRuche = (o: OptionsLancement): ReturnType<ModuleSuperviseur['lancerRuche']> => {
    let finir: (code: number) => void = () => undefined;
    const fini = new Promise<number>((r) => {
      finir = r;
    });
    const l: Lancement = {
      env: o.env,
      annoncer: () => o.adresse?.({ http: 'http://127.0.0.1:7777', ws: 'ws://127.0.0.1:7777/ws' }),
      mourir: (code) => finir(code),
      arrete: false,
    };
    lancements.push(l);
    return {
      arreter: () => {
        l.arrete = true;
        finir(0);
      },
      fini,
    };
  };
  const hive: Hive = {
    racine: '/hive',
    demarrage: {
      pieces: () => [{ nom: 'reine', bin: 'node', argv: ['dist/index.js'], role: 'Reine' }],
      // Un plan opaque : l'app le transmet sans le lire.
      planOuvrieres: () => Promise.resolve({} as PlanOpaque),
    },
    superviseur: { lancerRuche },
    agents: { inventaireAgents: () => Promise.resolve({ tous: agents, nonConnectes: [] }) },
    libelles: { libelleAgent: (a) => a },
    installeur: { lireEnv, composerReglages, completerEnv },
    ecriture: { ecrireAtomique: (f, c) => writeFileSync(f, c), MODE_SECRET: 0o600 },
    fichiers: { cli: '/hive/dist/cli.js' },
  };
  return { hive, lancements };
}

const REPOS: Etat = { ...etat() };
let dossier = '';

beforeEach(() => {
  dossier = mkdtempSync(path.join(tmpdir(), 'hive-bureau-'));
  majEtat(REPOS);
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dossier, { recursive: true, force: true });
});

/** Laisse passer les E/S réelles (la sonde du port) et les promesses. */
async function jusquA(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 400 && !condition(); i++) {
    await new Promise((r) => setImmediate(r));
  }
  expect(condition()).toBe(true);
}

function ruche(agents: readonly string[] = ['claude-code', 'shell']): {
  r: RucheBureau;
  lancements: Lancement[];
  notifications: NotificationRuche[];
} {
  const { hive, lancements } = fausseHive(agents);
  const notifications: NotificationRuche[] = [];
  const r = new RucheBureau({
    hive,
    chemins: cheminsRuche(dossier),
    piece: '/hive/piece.cjs',
    envHerite: () => ({ PATH: process.env.PATH }),
    notifier: (n) => notifications.push(n),
    journal: MUET,
    journalDePiece: () => MUET,
  });
  return { r, lancements, notifications };
}

describe('une Reine qui meurt, se relance et remeurt (#532)', () => {
  it('les relances épuisées finissent sur l’écran d’erreur — et une notification', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { r, lancements, notifications } = ruche();
    const vus: string[] = [];
    const cesser = surEtat((s) => {
      const vu = `${s.reine}${s.erreur ? '!' : ''}`;
      if (vus.at(-1) !== vu) vus.push(vu);
    });

    await r.demarrer();
    lancements[0]?.annoncer();
    expect(pageVoulue(etat(), null, true)).toBe('ecran');

    // Morte APRÈS s'être annoncée, puis trois fois en démarrant.
    lancements[0]?.mourir(1);
    for (const [i, recul] of RECULS_MS.entries()) {
      await jusquA(() => etat().reine === 'relance');
      await vi.advanceTimersByTimeAsync(recul);
      await jusquA(() => lancements.length === i + 2);
      lancements[i + 1]?.mourir(1);
    }
    await jusquA(() => etat().erreur !== null);
    cesser();

    expect(etat()).toMatchObject({ reine: 'arretee', origine: null });
    expect(vus).toEqual([
      'demarrage',
      'en-ligne',
      'relance',
      'demarrage',
      'relance',
      'demarrage',
      'relance',
      'demarrage',
      'arretee!',
    ]);
    // L'écran affiché avant (ou déjà oublié par la relance) : l'accueil, toujours.
    expect(pageVoulue(etat(), null, true)).toBe('accueil');
    expect(pageVoulue(etat(), 'http://127.0.0.1:7777', true)).toBe('accueil');
    expect(notifications).toEqual([NOTIFICATION_REINE_ARRETEE]);
  });

  it('arrêtée pendant l’attente d’une relance, elle ne repart pas', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { r, lancements } = ruche();
    await r.demarrer();
    lancements[0]?.mourir(1);
    await jusquA(() => etat().reine === 'relance');
    await r.arreter();
    await vi.advanceTimersByTimeAsync(RECULS_MS[0] * 2);
    expect(lancements).toHaveLength(1);
  });
});

describe('un démarrage à la fois', () => {
  it('deux `demarrer()` croisés ne lancent qu’UNE ruche, et `arreter()` l’arrête', async () => {
    const { r, lancements } = ruche();
    await Promise.all([r.demarrer(), r.demarrer()]);
    expect(lancements).toHaveLength(1);
    await r.arreter();
    expect(lancements[0]?.arrete).toBe(true);
  });

  it('un `arreter()` pendant le démarrage attend ses pièces et les arrête', async () => {
    const { r, lancements } = ruche();
    const demarrage = r.demarrer();
    await r.arreter();
    await demarrage;
    expect(lancements).toHaveLength(1);
    expect(lancements[0]?.arrete).toBe(true);
  });
});

describe('la démo simulée vaut pour UN lancement (#532)', () => {
  it('sans agent réel, les pièces la reçoivent — le `.env` ne la garde pas', async () => {
    const { r, lancements } = ruche(['shell']);
    await r.demarrer();
    expect(lancements[0]?.env?.HIVE_SIMULATION).toBe('1');
    const env = lireEnv(readFileSync(cheminsRuche(dossier).env, 'utf8'));
    expect(env.has('HIVE_SIMULATION')).toBe(false);
    await r.arreter();

    // L'agent installé depuis : le lancement suivant travaille pour de vrai.
    const suite = ruche(['codex', 'shell']);
    await suite.r.demarrer();
    expect(suite.lancements[0]?.env?.HIVE_SIMULATION).toBeUndefined();
    await suite.r.arreter();
  });

  it('un `HIVE_SIMULATION` écrit à la main dans le `.env` l’emporte', async () => {
    const { r, lancements } = ruche(['shell']);
    await r.demarrer();
    await r.arreter();
    const fichier = cheminsRuche(dossier).env;
    writeFileSync(fichier, `${readFileSync(fichier, 'utf8')}HIVE_SIMULATION=0\n`);
    await r.demarrer();
    expect(lancements[1]?.env?.HIVE_SIMULATION).toBeUndefined();
    await r.arreter();
  });
});
