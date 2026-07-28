// Les installeurs une-commande — `install.sh` et `install.ps1`.
//
// ─── POURQUOI CES TESTS EXISTENT ─────────────────────────────────────────────
//
// Ces deux scripts sont la PORTE D'ENTRÉE du projet : c'est ce qu'on tuyaute
// dans `sh` ou dans `iex` sans l'avoir lu. Un installeur cassé ne se découvre
// pas en relisant du TypeScript — il se découvre par quelqu'un qui abandonne.
//
// Et ils ont un défaut de naissance : ils vivent hors de la compilation, hors
// du typage, hors de tout. Rien ne les regarde. C'est exactement la forme des
// défauts que ce dépôt a passé sa journée à sortir — une promesse écrite que
// rien n'exerce.
//
// Ce qui est vérifié ICI, et ce qui l'est AILLEURS :
//   · ici : les invariants lisibles sans lancer les scripts, et l'exécution
//     RÉELLE de `install.sh` là où un shell POSIX existe ;
//   · en CI : `install.sh --dry-run` sur Linux et macOS, `install.ps1 -DryRun`
//     sous Windows. C'est le workflow qui les exerce pour de vrai, sur les
//     trois plateformes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_MINIMUM } from '../src/shared/doctor.js';

const RACINE = new URL('..', import.meta.url);
const lire = (f: string): string => readFileSync(new URL(f, RACINE), 'utf8');

/** La source sans ses commentaires — sinon la prose ferait passer les gardes. */
const sansCommentaires = (s: string, marque: '#' | '#ps'): string =>
  marque === '#'
    ? s.replace(/^\s*#.*$/gm, '')
    : s.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');

const SH = lire('install.sh');
const PS = lire('install.ps1');
const SH_NU = sansCommentaires(SH, '#');

/**
 * Cette machine a-t-elle un shell POSIX ?
 *
 * Faux sous Windows. J'ai écrit ces tests en lançant `sh install.sh` sans me
 * poser la question — et la CI Windows a rendu un code de sortie -1 : le
 * `spawn` lui-même échouait, faute de `sh`.
 *
 * C'est la même famille que § 6.3 de `docs/ERREURS.md` — du code dépendant de
 * la plateforme, écrit depuis une seule d'entre elles. Sauf qu'ici je l'ai
 * commis dans le fichier qui teste les DEUX installeurs.
 *
 * La sonde est au chargement, pas dans un `beforeAll` : `it.runIf(...)`
 * s'évalue à la COLLECTE. Posée trop tard, elle vaudrait toujours `false` et
 * désactiverait ces tests PARTOUT, y compris là où ils doivent tourner.
 */
const shellPosix = ((): boolean => {
  try {
    execFileSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const PS_NU = sansCommentaires(PS, '#ps');

describe('LES DEUX INSTALLEURS EXISTENT', () => {
  it('à la racine, là où les one-liners du README les cherchent', () => {
    expect(existsSync(new URL('install.sh', RACINE))).toBe(true);
    expect(existsSync(new URL('install.ps1', RACINE))).toBe(true);
  });
});

describe('LE PLANCHER DE NODE N’EXISTE QU’UNE FOIS — en quatre endroits', () => {
  // ─── LE PIÈGE QUE CETTE GARDE FERME ────────────────────────────────────────
  //
  // La version minimale de Node est écrite QUATRE fois : `NODE_MINIMUM` dans
  // le module pur, `engines.node` dans le paquet, et une constante dans chacun
  // des deux installeurs. Ces derniers ne sont ni typés ni compilés : rien ne
  // les relierait aux trois autres.
  //
  // Ce dépôt a DÉJÀ payé cette divergence une fois, sur la liste des paquets
  // de la ruche complète (`RUCHE_COMPLETE`). Le jour où elles divergent, un
  // installeur laisse passer une version que la ruche refusera ensuite — et
  // la personne se retrouve avec une installation « réussie » qui ne démarre
  // pas.

  it('install.sh exige la MÊME version que `NODE_MINIMUM`', () => {
    const m = /NODE_MIN=(\d+)/.exec(SH_NU);
    expect(m, 'NODE_MIN introuvable dans install.sh').toBeTruthy();
    expect(Number(m?.[1])).toBe(NODE_MINIMUM);
  });

  it('install.ps1 exige la MÊME version', () => {
    const m = /\$NODE_MIN\s*=\s*(\d+)/.exec(PS_NU);
    expect(m, '$NODE_MIN introuvable dans install.ps1').toBeTruthy();
    expect(Number(m?.[1])).toBe(NODE_MINIMUM);
  });

  it('…et `engines.node` du paquet aussi', () => {
    const paquet = JSON.parse(lire('package.json')) as { engines?: { node?: string } };
    const m = /(\d+)/.exec(paquet.engines?.node ?? '');
    expect(Number(m?.[1])).toBe(NODE_MINIMUM);
  });
});

describe('CE QU’UN INSTALLEUR NE DOIT JAMAIS FAIRE', () => {
  it('AUCUN des deux ne s’élève en privilèges pour installer', () => {
    // Un script qu'on tuyaute dans `sh` et qui appelle `sudo` demande une
    // confiance qu'il n'a pas méritée. Les seules mentions de `sudo` tolérées
    // sont dans un message qui SUGGÈRE une commande à taper soi-même — jamais
    // dans une commande exécutée.
    //
    // On regarde donc la source NUE : les commentaires et les chaînes
    // d'affichage sont exclus du reproche, l'exécution ne l'est pas.
    for (const ligne of SH_NU.split('\n')) {
      const nu = ligne.trim();
      if (nu.startsWith('dire ') || nu.startsWith('echec ') || nu.startsWith('alerte ')) continue;
      expect(nu, 'sudo exécuté dans install.sh').not.toMatch(/(^|[;&|(]\s*)sudo\s/);
    }
    expect(PS_NU, 'élévation dans install.ps1').not.toMatch(/Start-Process.*-Verb\s+RunAs/i);
  });

  it('aucun des deux n’installe Node à la place de la personne', () => {
    // On DIT la commande, on ne la lance pas. Toucher au gestionnaire de
    // paquets d'une machine qu'on ne connaît pas, en aveugle, est le genre de
    // geste qui fait qu'on ne devrait pas exécuter le script.
    for (const [nom, nu] of [
      ['install.sh', SH_NU],
      ['install.ps1', PS_NU],
    ] as const) {
      expect(nu, `${nom} lance winget`).not.toMatch(/^\s*winget\s+install/m);
      expect(nu, `${nom} lance apt`).not.toMatch(/^\s*(sudo\s+)?apt(-get)?\s+install/m);
      expect(nu, `${nom} lance brew`).not.toMatch(/^\s*brew\s+install/m);
    }
  });

  it('les deux passent la main à l’installeur du projet, sans le réécrire', () => {
    // Dupliquer ici la génération du jeton, l'écriture du `.env` en 600 et la
    // détection d'agent ferait DEUX installeurs à maintenir — dont un que rien
    // ne teste. Celui du projet est testé par `tests/installer.test.ts`.
    expect(SH_NU).toMatch(/npm run install:hive/);
    expect(PS_NU).toMatch(/npm run install:hive/);
  });
});

describe('`install.sh` LANCÉ POUR DE VRAI', () => {
  // Pas une lecture : une exécution. C'est la règle n° 1 de `docs/ERREURS.md`,
  // et elle est née d'un `require()` en ESM qui rendait `null` pour toujours
  // sans que trois relectures le voient.
  //
  // ─── CE QUI SE VÉRIFIE OÙ ──────────────────────────────────────────────────
  //
  // `install.sh` est un script POSIX : il ne s'exécute pas sous Windows, et
  // c'est normal — Windows a `install.ps1`. La couverture est donc RÉPARTIE,
  // pas trouée :
  //   · ici, sur Linux et macOS : `install.sh` lancé pour de vrai ;
  //   · en CI sous Windows : `install.ps1 -DryRun`, par un pas du workflow ;
  //   · partout : les gardes sur la source des DEUX scripts, plus haut.

  it('cette machine a-t-elle un shell POSIX ? — la question doit être posée', () => {
    if (!shellPosix) {
      console.warn(
        '⚠ pas de shell POSIX ici : `install.sh` n’est PAS exécuté sur cette ' +
          'plateforme. Il l’est sur Linux et macOS à chaque CI, et `install.ps1` ' +
          'est exercé sous Windows par le workflow.',
      );
    }
    // SUR POSIX, LA SONDE DOIT DIRE OUI. Sans cette assertion, une sonde
    // cassée désactiverait ces tests partout et la suite resterait verte —
    // c'est déjà arrivé dans ce dépôt, sur les gardes du miroir.
    if (process.platform !== 'win32') {
      expect(shellPosix, 'un système POSIX doit avoir `sh`').toBe(true);
    }
  });

  const lancer = (args: string[], chemin?: string): { code: number; sortie: string } => {
    try {
      const sortie = execFileSync('sh', ['install.sh', ...args], {
        cwd: new URL('.', RACINE).pathname,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1', ...(chemin ? { PATH: chemin } : {}) },
      });
      return { code: 0, sortie };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it.runIf(shellPosix)('`--help` sort en 0 et explique les drapeaux', () => {
    const { code, sortie } = lancer(['--help']);
    expect(code).toBe(0);
    expect(sortie).toMatch(/--dir/);
    expect(sortie).toMatch(/--dry-run/);
  });

  it.runIf(shellPosix)('`--dry-run` N’ÉCRIT RIEN — pas même le dossier de destination', () => {
    // ─── POURQUOI CE TEST FABRIQUE UN FAUX `node` ────────────────────────────
    //
    // Première version : on lançait `install.sh --dry-run` tel quel. Elle
    // passait — et pour la MAUVAISE raison. Cette machine tourne sous le
    // plancher de Node, donc le script sortait au contrôle de version AVANT
    // d'atteindre le clone. Le chemin `--dry-run` n'était jamais observé.
    //
    // Prouvé par mutation : en faisant cloner `--dry-run` de force, le test
    // restait VERT. C'est le défaut § 2 de `docs/ERREURS.md`, commis dans le
    // test censé le prévenir.
    //
    // On pose donc la couture : un `node` factice, en tête de PATH, qui
    // annonce une version suffisante. Le script franchit alors le contrôle et
    // le vrai comportement de `--dry-run` devient observable — sur n'importe
    // quelle machine, quelle que soit sa version de Node.
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-inst-'));
    const cible = path.join(bac, 'ruche');
    const faux = path.join(bac, 'bin');
    try {
      mkdirSync(faux, { recursive: true });
      writeFileSync(path.join(faux, 'node'), `#!/bin/sh\necho ${NODE_MINIMUM}\n`, { mode: 0o755 });

      const r = lancer(['--dry-run', `--dir=${cible}`], `${faux}:${process.env.PATH ?? ''}`);
      expect(r.code, `--dry-run devrait aboutir :\n${r.sortie}`).toBe(0);
      // La garantie qui fait qu'on ose lancer un script inconnu.
      expect(existsSync(cible), '--dry-run a créé le dossier').toBe(false);
      // Et il DIT ce qu'il aurait fait, sinon « rien écrit » n'apprend rien.
      expect(r.sortie).toMatch(/serait cloné/);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it.runIf(shellPosix)('UNE VERSION DE NODE TROP ANCIENNE SORT EN 2, pas en 1', () => {
    // Le code 2 est `PREREQUIS` dans `src/codes-sortie.ts`. La distinction
    // compte pour un script appelant : « il te manque quelque chose » et « ça
    // a planté » appellent des gestes différents.
    //
    // Ce test ne s'exécute que si la machine est SOUS le plancher — sinon il
    // n'aurait rien à observer, et le dire vaut mieux que de le simuler.
    const majeur = Number(process.versions.node.split('.')[0]);
    if (majeur >= NODE_MINIMUM) {
      expect(true, 'machine au-dessus du plancher : cas non observable ici').toBe(true);
      return;
    }
    const { code, sortie } = lancer(['--dry-run', '--dir=/tmp/jamais-cree']);
    expect(code, 'prérequis manquant ⇒ code 2').toBe(2);
    expect(sortie).toMatch(new RegExp(String(NODE_MINIMUM)));
  });
});
