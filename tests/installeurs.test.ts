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
 * Peut-on lancer `install.sh` DANS SON ENVIRONNEMENT CIBLE ?
 *
 * ─── DEUX CONDITIONS, ET J'AI MIS DEUX RUNS À LES TROUVER ────────────────────
 *
 * 1. Un shell POSIX doit exister. Ma première version lançait `sh` sans poser
 *    la question ; la CI Windows a rendu un `spawn` en échec, code -1.
 *
 * 2. ET la plateforme doit être POSIX. Correction suivante : j'ai sondé la
 *    présence de `sh`… qui EXISTE sous Windows, parce que Git Bash est sur le
 *    PATH des runners GitHub. La sonde disait donc vrai, les tests tournaient,
 *    et ils testaient une configuration QUE PERSONNE N'UTILISE : `install.sh`
 *    vise Linux et macOS ; sous Windows on lance `install.ps1`.
 *
 * Sonder une CAPACITÉ ne suffit pas quand ce qui compte est la CIBLE. Le fait
 * qu'une chose soit possible ne veut pas dire qu'elle est pertinente.
 *
 * La sonde reste au chargement du module : `it.runIf(...)` s'évalue à la
 * COLLECTE, et posée dans un `beforeAll` elle désactiverait tout, partout.
 */
const shellPosix = ((): boolean => {
  if (process.platform === 'win32') return false;
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

describe('`install.ps1` COMMENCE PAR UN BOM UTF-8', () => {
  // ─── UNE GARDE POUR TROIS OCTETS QUI NE SE VOIENT PAS ──────────────────────
  //
  // Windows PowerShell 5.1 — `powershell.exe`, celui qui est livré avec l'OS et
  // que `#Requires -Version 5.1` prétend servir — décode un fichier SANS BOM
  // avec la page ANSI. « détecté » devient « dÃ©tectÃ© », « — » devient
  // « â€” », l'abeille disparaît. PowerShell 7 suppose UTF-8, donc la CI
  // passait au vert sans que rien ne se voie : le pas ne lançait que `pwsh`.
  //
  // Mesuré, pas supposé : `install.ps1` relu en cp1252 rend bien du charabia.
  // La CI le vérifie maintenant en lançant 5.1 POUR DE VRAI, et refuse une
  // sortie contenant « Ã » — signature d'un UTF-8 relu en ANSI.
  //
  // Cette garde-ci existe parce qu'un BOM est INVISIBLE. Aucune relecture ne
  // remarque sa disparition, et le premier éditeur qui réenregistre le fichier
  // « sans rien changer » peut l'ôter.

  it('ses trois premiers octets sont EF BB BF', () => {
    const octets = readFileSync(new URL('install.ps1', RACINE));
    expect(
      [...octets.subarray(0, 3)],
      'BOM UTF-8 absent : PowerShell 5.1 lira ce fichier en ANSI et affichera du mojibake',
    ).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('…et install.sh, lui, n’en a PAS', () => {
    // Symétrie inverse, et elle compte : un BOM en tête d'un script `sh` est
    // envoyé à l'interpréteur AVANT le `#!`. Le noyau ne reconnaît plus le
    // shebang, et l'on obtient un « command not found » sur la première ligne.
    const octets = readFileSync(new URL('install.sh', RACINE));
    expect([...octets.subarray(0, 3)], 'un BOM casserait le shebang').not.toEqual([
      0xef, 0xbb, 0xbf,
    ]);
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

  it('install.ps1 ne passe AUCUN guillemet double à une commande native', () => {
    // ─── CE QUE WINDOWS POWERSHELL 5.1 FAIT DES ARGUMENTS ────────────────────
    //
    // 5.1 réécrit les arguments d'une commande native avec ses propres règles,
    // et MANGE les guillemets doubles qu'ils contiennent. PowerShell 7.3 a
    // corrigé ce passage d'arguments ; 5.1 ne le sera jamais — c'est le
    // composant du système, pas une application qu'on met à jour.
    //
    // Le défaut vécu : `node -p 'process.versions.node.split(".")[0]'`.
    // Impeccable sous `pwsh`. Sous 5.1, Node recevait
    // `process.versions.node.split(.)[0]` et rendait « [eval]:1 SyntaxError ».
    // Comme `$ErrorActionPreference` vaut `Stop`, la sortie d'erreur native
    // devient une exception : l'installeur mourait à sa TOUTE PREMIÈRE
    // vérification, sous l'interpréteur que la plupart des gens ont.
    //
    // On juge L'EXÉCUTION, pas l'affichage — même partage que la garde `sudo`
    // plus haut. Une ligne qui MONTRE une commande à taper n'invoque rien.
    //
    // (Première version de ce test : une regex qui traversait les retours à la
    //  ligne. Elle a attrapé un `Dire "… npm run install:hive …"` et rougi pour
    //  la mauvaise raison. Une garde qui se trompe de sujet est une garde qui
    //  sera désactivée le jour où elle gênera.)
    const affichage = /^\s*(Dire|Ok|Echec|Alerte|Etape|Write-Host)\b/;
    let vus = 0;
    for (const ligne of PS_NU.split('\n')) {
      if (affichage.test(ligne)) continue;
      const natif = /\b(node|npm|git)\b/.exec(ligne);
      if (!natif) continue;
      for (const arg of ligne.matchAll(/'([^'\n]*)'/g)) {
        vus++;
        expect(
          arg[1],
          `argument simple-quoté de \`${natif[1]}\` contenant un guillemet ` +
            `double : Windows PowerShell 5.1 le mangera — ${ligne.trim()}`,
        ).not.toMatch(/"/);
      }
    }
    // SANS CECI, LA GARDE EST DÉCOR. Si un remaniement retirait le seul
    // argument simple-quoté du script, la boucle ne tournerait plus et le test
    // resterait vert en n'ayant rien regardé — c'est le § 1.2 de `ERREURS.md`.
    expect(vus, 'aucun argument natif inspecté : la garde ne regarde plus rien').toBeGreaterThan(0);
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
        '⚠ `install.sh` n’est PAS exécuté ici : ce n’est pas sa plateforme cible. ' +
          'Il l’est sur Linux et macOS à chaque CI, et `install.ps1` est exercé ' +
          'sous Windows par un pas du workflow.',
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

      const chemin = [faux, process.env.PATH ?? ''].join(path.delimiter);
      const r = lancer(['--dry-run', `--dir=${cible}`], chemin);
      expect(r.code, `--dry-run devrait aboutir :\n${r.sortie}`).toBe(0);
      // La garantie qui fait qu'on ose lancer un script inconnu.
      expect(existsSync(cible), '--dry-run a créé le dossier').toBe(false);
      // Et il DIT ce qu'il aurait fait, sinon « rien écrit » n'apprend rien.
      expect(r.sortie).toMatch(/serait cloné/);
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it.runIf(shellPosix)('LA COMMANDE QU’IL AFFICHE EST CELLE QU’IL LANCERAIT', () => {
    // ─── LE DÉFAUT QUE CE TEST FERME, TROUVÉ EN LISANT UN JOURNAL DE CI ──────
    //
    // `--dry-run` finit par « sans --dry-run, la suite serait : … ». Cette
    // ligne affichait :
    //
    //     cd … && npm run install:hive --dry-run
    //
    // alors que l'appel réel, vingt lignes plus bas, est :
    //
    //     npm run install:hive -- --dry-run
    //
    // Le `--` manquait. Sans lui, npm GARDE le drapeau pour lui — et npm a son
    // propre `--dry-run` : la commande copiée depuis cet écran ne lançait donc
    // pas l'installeur du tout. Une ligne qui dit « voilà ce qui va se passer »
    // et qui se trompe est pire que pas de ligne.
    //
    // Aucune relecture ne l'a vu, parce qu'à l'œil les deux formes se
    // ressemblent. Ce qui l'a rendu visible, c'est la SORTIE RÉELLE d'un
    // `--dry-run` en CI. D'où ce test : il compare l'affichage à l'appel.
    const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-inst-'));
    const faux = path.join(bac, 'bin');
    try {
      mkdirSync(faux, { recursive: true });
      writeFileSync(path.join(faux, 'node'), `#!/bin/sh\necho ${NODE_MINIMUM}\n`, { mode: 0o755 });
      const chemin = [faux, process.env.PATH ?? ''].join(path.delimiter);

      // AVEC un argument à transmettre : le `--` doit être là, et séparer.
      const avec = lancer(
        ['--dry-run', `--dir=${path.join(bac, 'r1')}`, '--non-interactive'],
        chemin,
      );
      expect(avec.code, avec.sortie).toBe(0);
      expect(avec.sortie, 'le `--` qui sépare npm de l’installeur manque').toMatch(
        /npm run install:hive -- .*--non-interactive/,
      );

      // SANS argument : pas de `--` pendu dans le vide.
      const sans = lancer(['--dry-run', `--dir=${path.join(bac, 'r2')}`], chemin);
      expect(sans.code, sans.sortie).toBe(0);
      expect(sans.sortie).toMatch(/npm run install:hive\s*$/m);
      expect(sans.sortie, '`--` affiché sans rien à séparer').not.toMatch(
        /npm run install:hive --\s*$/m,
      );
    } finally {
      rmSync(bac, { recursive: true, force: true });
    }
  });

  it('install.ps1 AUSSI n’affiche le `--` que s’il sépare quelque chose', () => {
    // Le pendant du test précédent, en garde de source : `install.ps1` ne
    // s'exécute pas ici (voir la sonde), mais son défaut était SYMÉTRIQUE — un
    // `--` toujours présent, pendu dans le vide quand `$Reste` est vide. Les
    // deux sortaient de la même faute : une ligne d'affichage écrite pour
    // RESSEMBLER à la commande réelle au lieu d'en être dérivée.
    expect(PS_NU, 'la branche « sans arguments » manque').toMatch(
      /if\s*\(\s*\$Reste\s*\)[\s\S]*?npm run install:hive --[\s\S]*?else[\s\S]*?npm run install:hive['"]/,
    );
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
