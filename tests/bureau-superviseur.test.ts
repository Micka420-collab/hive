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
  readonly liste: OptionsLancement['liste'];
  readonly annoncer: () => void;
  readonly mourir: (code: number) => void;
  /** Une ligne que la pièce écrit (stdout), telle que le superviseur la relaie. */
  readonly dire: (texte: string) => void;
  /** La pièce tombe sans qu'on l'ait arrêtée. */
  readonly tomber: (message: string) => void;
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
      liste: o.liste,
      annoncer: () => o.adresse?.({ http: 'http://127.0.0.1:7777', ws: 'ws://127.0.0.1:7777/ws' }),
      mourir: (code) => finir(code),
      dire: (texte) => o.ligne({ piece: o.liste[0] ?? null, flux: 'stdout', etiquette: '', texte }),
      tomber: (message) => {
        const p = o.liste[0];
        if (p) o.mort?.(p, { message, arreter: false });
        finir(1);
      },
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
    porte: { billetDuLienProfond: () => null, HOTE_LIEN_PROFOND: 'rejoindre' },
    fichiers: { cli: '/hive/dist/cli.js', join: '/hive/dist/node-client/join.js' },
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

// ─── L'OUVRIÈRE CHEZ UNE RUCHE AMIE (la porte) ───────────────────────────────
describe('rejoindre la ruche d’un ami, depuis un lien', () => {
  it('lance `hive join` avec le billet, à côté de la ruche, et suit son état jusqu’à « en ligne »', async () => {
    const { r, lancements, notifications } = ruche();
    await r.demarrer();
    expect(lancements).toHaveLength(1);

    await r.rejoindreAmie('hive2_abc', 'Ruche de Micka', 'wss://ruche.exemple.org/ws');
    expect(lancements).toHaveLength(2);
    const amie = lancements[1]!;
    // Le même programme qu'un terminal : l'amorce, puis `join`, puis le billet.
    expect(amie.liste).toHaveLength(1);
    expect(amie.liste[0]).toMatchObject({
      nom: 'ouvrière amie',
      bin: process.execPath,
      argv: ['/hive/piece.cjs', '/hive/dist/node-client/join.js', 'hive2_abc'],
      ouvriere: true,
    });
    // Pas de lien à la Reine locale : elle vise la ruche de l'ami.
    expect(amie.liste[0]).not.toHaveProperty('reine');
    expect(amie.env?.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(etat().amie).toEqual({
      label: 'Ruche de Micka',
      url: 'wss://ruche.exemple.org/ws',
      etat: 'en-cours',
      detail: null,
    });

    amie.dire('🐝 Connexion à : wss://ruche.exemple.org/ws');
    expect(etat().amie?.etat).toBe('en-cours');
    amie.dire('✔ Nœud démarré — vous butinez pour la ruche. Ctrl+C pour quitter.');
    expect(etat().amie?.etat).toBe('en-ligne');
    expect(notifications.at(-1)?.titre).toBe('Vous butinez pour « Ruche de Micka »');
    // La ruche de l'app n'a pas bougé.
    expect(lancements[0]?.arrete).toBe(false);

    await r.quitterAmie();
    expect(amie.arrete).toBe(true);
    expect(etat().amie).toBeNull();
    expect(lancements[0]?.arrete).toBe(false);
  });

  it('une ouvrière amie qui tombe le dit, avec sa dernière phrase, et se notifie', async () => {
    const { r, lancements, notifications } = ruche();
    await r.demarrer();
    lancements[0]!.annoncer();
    await r.rejoindreAmie('hive2_abc', 'Ruche de Micka', 'wss://ruche.exemple.org/ws');
    lancements[1]!.tomber('✘ La ruche a refusé ce billet (401 — billet refusé).');
    await jusquA(() => etat().amie?.etat === 'arretee');
    expect(etat().amie?.detail).toContain('billet refusé');
    expect(notifications.at(-1)?.titre).toBe('ouvrière amie s’est arrêtée');
    // La ruche de l'app n'est pas concernée.
    expect(etat().erreur).toBeNull();
    expect(pageVoulue(etat(), null, true)).toBe('ecran');
  });

  it('rejoindre une seconde ruche remplace la première ; `arreter()` la ruche locale ne touche pas l’amie', async () => {
    const { r, lancements } = ruche();
    await r.demarrer();
    await r.rejoindreAmie('hive2_un', 'Une', 'wss://un/ws');
    await r.rejoindreAmie('hive2_deux', 'Deux', 'wss://deux/ws');
    expect(lancements[1]?.arrete).toBe(true);
    expect(lancements[2]?.arrete).toBe(false);
    expect(etat().amie?.label).toBe('Deux');
    await r.arreter();
    expect(lancements[0]?.arrete).toBe(true);
    expect(lancements[2]?.arrete).toBe(false);
    await r.quitterAmie();
    expect(lancements[2]?.arrete).toBe(true);
  });
});
