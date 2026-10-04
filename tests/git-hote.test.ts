// AUCUN GIT DE L'HÔTE N'EXÉCUTE CE QUE LE DÉPÔT DE LA TÂCHE A CONFIGURÉ.
//
// ─── POURQUOI CE BANC ────────────────────────────────────────────────────────
//
// L'agent tourne DANS le répertoire de sa tâche, `.git` compris — sous bac à
// sable s'il y en a un. Après lui, le nœud lance git sur l'HÔTE, hors du bac,
// dans ce même répertoire : c'est `collectDiff`. Tout ce que git y exécute au
// nom de la configuration du dépôt est donc du code choisi par l'agent,
// exécuté avec les droits du membre. Mesuré sur l'ancien `collectDiff` : le
// crochet, le moniteur, le filtre, le `textconv`, le `diff.external` —
// chacun tournait (src/node-client/git-hote.ts, en-tête).
//
// ─── COMMENT CHAQUE PIÈGE EST PROUVÉ ─────────────────────────────────────────
//
// Chaque vecteur pose un programme qui écrit une SENTINELLE. Avant d'accuser
// le nœud, le banc ARME le piège : il lance, à la main, dans le dépôt de la
// tâche, la commande git naïve qui le déclenche (`add`/`diff` sans épinglage,
// comme l'ancien code) et vérifie que la sentinelle apparaît. Un piège qui ne
// se déclenche jamais ne prouverait rien — son absence de sentinelle serait
// vraie de toute façon. Puis la sentinelle est effacée, et c'est le tour du
// nœud : `collectDiff` doit rendre le VRAI diff de l'agent sans qu'aucune
// sentinelle ne naisse.
//
// Trois entrées sont DOCUMENTAIRES, et vertes sur l'ancien code aussi :
// `core.sshCommand`, l'alias et le pager. Aucun git de l'hôte ne lance, après
// l'agent, de `fetch`, d'alias, ni rien sous un terminal dans le dépôt de la
// tâche — ces pièges ne peuvent donc pas se déclencher. Elles fixent
// l'inventaire des vecteurs (et le pager, qu'on ne sait pas armer ici, reste
// couvert par `--no-pager`) ; elles ne prouvent aucune régression.

import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EchecGitHote, gitHote } from '../src/shared/git-protege.js';
import { runMerge } from '../src/node-client/merge-runner.js';
import { cloneRepo, prepareWorkspace } from '../src/node-client/workspace.js';
import type { Task } from '../src/shared/types.js';

/** Identité et réglages des commits FABRIQUÉS par le banc — rien de la personne. */
const REGLAGES_BANC = [
  '-c',
  'user.email=banc@hive.local',
  '-c',
  'user.name=Banc Hive',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

let racine: string;
let travail: string;
let sentinelles: string;
let amontUrl: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...REGLAGES_BANC, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Comme `git`, mais un code de sortie non nul n'est pas une erreur du banc. */
function gitSansVerdict(cwd: string, ...args: string[]): void {
  try {
    git(cwd, ...args);
  } catch {
    // `ls-remote` vers un hôte qui n'existe pas échoue — après avoir lancé ssh.
  }
}

/** Un chemin lisible par le `sh` de git, Windows compris (`C:/…`). */
const pourSh = (p: string): string => p.split(path.sep).join('/');

/** La commande shell qui laisse la sentinelle `nom`. */
const trace = (nom: string): string => `echo piege >> '${pourSh(path.join(sentinelles, nom))}'`;

/** Un script exécutable qui laisse la sentinelle `nom`, puis fait `suite`. */
function script(dossier: string, nom: string, suite = ''): string {
  mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, nom);
  writeFileSync(chemin, `#!/bin/sh\n${trace(nom)}\n${suite}\nexit 0\n`, { mode: 0o755 });
  return chemin;
}

const declenchees = (): string[] => readdirSync(sentinelles).sort();

const tache = (id: string): Task => ({ id, title: id, prompt: 'x', branch: null }) as Task;

beforeAll(() => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-git-hote-'));
  travail = path.join(racine, 'travail');
  sentinelles = path.join(racine, 'sentinelles');
  const depot = path.join(racine, 'amont.git');
  execFileSync('git', ['init', '-q', '--bare', depot]);
  git(depot, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const copie = path.join(racine, 'amont');
  mkdirSync(copie);
  git(copie, 'init', '-q');
  git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(path.join(copie, 'app.txt'), 'bonjour\n');
  writeFileSync(path.join(copie, 'a-supprimer.txt'), 'éphémère\n');
  git(copie, 'add', '--all');
  git(copie, 'commit', '-q', '-m', 'premier commit');
  git(copie, 'push', '-q', depot, 'main');
  amontUrl = pathToFileURL(depot).href;
});

beforeEach(() => {
  rmSync(sentinelles, { recursive: true, force: true });
  mkdirSync(sentinelles, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Objets git en lecture seule sous Windows : sans gravité pour un tmpdir.
  }
});

/** Ce que l'ancien `collectDiff` lançait, tel quel, dans le dépôt de la tâche. */
const COLLECTE_NAIVE = [['add', '--all', '--intent-to-add'], ['diff']];

interface Vecteur {
  /** Ce que l'agent écrit dans SON dépôt (`cwd`, `.git` compris). */
  poser: (cwd: string) => void;
  /** Les commandes git naïves qui le déclenchent ; `null` : inarmable ici. */
  armer: string[][] | null;
  /** Ce que le diff rendu doit montrer EN PLUS du travail de l'agent. */
  verifierDiff?: (diff: string) => void;
}

const VECTEURS: Record<string, Vecteur> = {
  'un crochet (`.git/hooks/post-index-change`)': {
    poser: (cwd) => {
      script(path.join(cwd, '.git', 'hooks'), 'post-index-change');
    },
    armer: COLLECTE_NAIVE,
  },
  '`core.hooksPath` vers des crochets de l’agent': {
    poser: (cwd) => {
      const crochets = path.join(cwd, '.git', 'crochets-agent');
      script(crochets, 'post-index-change');
      git(cwd, 'config', 'core.hooksPath', pourSh(crochets));
    },
    armer: COLLECTE_NAIVE,
  },
  '`core.fsmonitor`': {
    poser: (cwd) => {
      git(cwd, 'config', 'core.fsmonitor', pourSh(script(path.join(cwd, '.git'), 'fsmonitor')));
    },
    armer: COLLECTE_NAIVE,
  },
  'un filtre `clean`/`smudge` désigné par `.gitattributes`': {
    poser: (cwd) => {
      writeFileSync(path.join(cwd, '.gitattributes'), '*.txt filter=piege\n');
      git(cwd, 'config', 'filter.piege.clean', `${trace('filtre-clean')}; cat`);
      git(cwd, 'config', 'filter.piege.smudge', `${trace('filtre-smudge')}; cat`);
    },
    armer: COLLECTE_NAIVE,
  },
  'un `textconv` désigné par `.gitattributes`': {
    poser: (cwd) => {
      writeFileSync(path.join(cwd, '.gitattributes'), '*.txt diff=piege\n');
      git(cwd, 'config', 'diff.piege.textconv', `${trace('textconv')}; cat`);
    },
    armer: COLLECTE_NAIVE,
  },
  'un pilote de diff externe (`diff.<pilote>.command`)': {
    poser: (cwd) => {
      writeFileSync(path.join(cwd, '.gitattributes'), '*.txt diff=piege\n');
      git(cwd, 'config', 'diff.piege.command', trace('pilote-diff'));
    },
    armer: COLLECTE_NAIVE,
  },
  '`diff.external`': {
    poser: (cwd) => {
      git(cwd, 'config', 'diff.external', trace('diff-external'));
    },
    armer: COLLECTE_NAIVE,
  },
  '`include.path` vers une configuration de l’agent': {
    poser: (cwd) => {
      const inclus = path.join(cwd, '.git', 'inclus.cfg');
      writeFileSync(inclus, `[diff]\n\texternal = ${trace('include-path')}\n`);
      git(cwd, 'config', 'include.path', pourSh(inclus));
    },
    armer: COLLECTE_NAIVE,
  },
  '`includeIf.gitdir:**` vers une configuration de l’agent': {
    poser: (cwd) => {
      const inclus = path.join(cwd, '.git', 'inclus-si.cfg');
      writeFileSync(inclus, `[diff]\n\texternal = ${trace('include-if')}\n`);
      git(cwd, 'config', 'includeIf.gitdir:**.path', pourSh(inclus));
    },
    armer: COLLECTE_NAIVE,
  },
  // Un dépôt IMBRIQUÉ que l'agent crée (`git init` dans un sous-dossier, un
  // échafaudeur) est un sous-module aux yeux de git : juger s'il est « sale »
  // lance un `git status` DANS ce dépôt, sous SA configuration. Le filtre y
  // est le seul piège que les `-c` de l'hôte (hérités par ce git enfant) ne
  // couvrent pas : c'est lui qui prouve `--ignore-submodules=dirty`. Le
  // fichier change à TAILLE ÉGALE, pour que git doive le relire (et le filtrer).
  'un dépôt imbriqué (`sous/.git`) et SA configuration': {
    poser: (cwd) => {
      const sous = path.join(cwd, 'sous');
      mkdirSync(sous);
      git(sous, 'init', '-q');
      writeFileSync(path.join(sous, 'f.txt'), 'x\n');
      git(sous, 'add', 'f.txt');
      git(sous, 'commit', '-q', '-m', 'imbriqué');
      writeFileSync(path.join(sous, '.gitattributes'), '*.txt filter=piege\n');
      git(sous, 'config', 'filter.piege.clean', `${trace('imbrique-filtre')}; cat`);
      git(
        sous,
        'config',
        'core.fsmonitor',
        pourSh(script(path.join(sous, '.git'), 'imbrique-fsm')),
      );
      script(path.join(sous, '.git', 'hooks'), 'post-index-change');
      writeFileSync(path.join(sous, 'f.txt'), 'z\n');
    },
    // Contre la base, comme le diff de l'hôte : un `git diff` index↔arbre ne
    // sonde pas un dépôt imbriqué que `add -N` vient de noter en intention.
    armer: [
      ['add', '--all', '--intent-to-add'],
      ['diff', 'HEAD'],
    ],
    verifierDiff: (diff) => {
      // Visible à la revue — son contenu n'y est pas —, mais jamais sondé.
      expect(diff).toMatch(/\+Subproject commit [0-9a-f]+\n/);
      expect(diff).not.toContain('-dirty');
    },
  },
  '`core.sshCommand` (documentaire)': {
    poser: (cwd) => {
      git(cwd, 'config', 'core.sshCommand', `${trace('ssh-command')}; false`);
    },
    armer: [['ls-remote', 'ssh://depot.invalide/prive.git']],
  },
  'un alias (documentaire)': {
    poser: (cwd) => {
      git(cwd, 'config', 'alias.piege', `!${trace('alias')}`);
    },
    armer: [['piege']],
  },
  '`core.pager` et `pager.diff` (documentaire)': {
    poser: (cwd) => {
      git(cwd, 'config', 'core.pager', trace('pager'));
      git(cwd, 'config', 'pager.diff', trace('pager-diff'));
    },
    armer: null,
  },
};

describe('le diff de revue d’une tâche (`collectDiff`) n’exécute rien que l’agent a configuré', () => {
  it.each(Object.entries(VECTEURS).map(([nom, v], i) => [nom, v, i] as const))(
    '%s',
    async (_nom, { poser, armer, verifierDiff }, i) => {
      const ws = await prepareWorkspace(travail, tache(`piege-${i}`), amontUrl);
      try {
        // L'agent travaille… puis arme son piège dans son propre dépôt.
        writeFileSync(path.join(ws.cwd, 'app.txt'), 'bonjour, ruche\n');
        poser(ws.cwd);

        if (armer) {
          for (const args of armer) gitSansVerdict(ws.cwd, ...args);
          expect(declenchees(), 'le piège est armé : git naïf le déclenche').not.toEqual([]);
          rmSync(sentinelles, { recursive: true, force: true });
          mkdirSync(sentinelles);
        }

        const diff = await ws.collectDiff();
        expect(declenchees(), 'aucun programme de l’agent n’a tourné sur l’hôte').toEqual([]);
        // Et le diff reste le VRAI : ce que l'agent a changé, rien de filtré.
        expect(diff).toContain('+bonjour, ruche');
        verifierDiff?.(diff);
      } finally {
        await ws.cleanup();
      }
    },
  );

  it('le git dir que lit l’hôte vit HORS du répertoire monté dans le bac, et part avec la tâche', async () => {
    const ws = await prepareWorkspace(travail, tache('registre'), amontUrl);
    const registre = `${ws.cwd}.git`;
    expect(existsSync(path.join(registre, 'HEAD'))).toBe(true);
    // Aucun crochet : ni ceux d'un modèle, ni ceux d'un `init.templateDir`.
    expect(existsSync(path.join(registre, 'hooks'))).toBe(false);
    await ws.cleanup();
    expect(existsSync(registre)).toBe(false);
  });
});

describe('le diff contre le commit de DÉPART', () => {
  it('un fichier que l’agent SUPPRIME est dans le diff de sa tâche', async () => {
    // Avant : `add --all` sortait le fichier de l'index, et le diff
    // index↔arbre ne le montrait plus. La suppression disparaissait de la
    // revue — et de la fusion — sans un mot.
    const ws = await prepareWorkspace(travail, tache('suppression'), amontUrl);
    try {
      rmSync(path.join(ws.cwd, 'a-supprimer.txt'));
      const diff = await ws.collectDiff();
      expect(diff).toContain('deleted file mode');
      expect(diff).toContain('-éphémère');
    } finally {
      await ws.cleanup();
    }
  });

  it('la fusion rend la suppression dans son diff cumulé', async () => {
    const dossier = path.join(racine, 'fusion-suppression');
    await cloneRepo(dossier, amontUrl);
    const suppression = [
      'diff --git a/a-supprimer.txt b/a-supprimer.txt',
      'deleted file mode 100644',
      '--- a/a-supprimer.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-éphémère',
      '',
    ].join('\n');
    const r = await runMerge({ repoDir: dossier, diffs: [{ taskId: 'suppr', diff: suppression }] });
    expect(r.applied).toEqual(['suppr']);
    expect(existsSync(path.join(dossier, 'a-supprimer.txt'))).toBe(false);
    expect(r.mergedDiff).toContain('deleted file mode');
  });
});

describe('la fusion n’exécute aucun filtre qu’un `.gitattributes` apporté par un diff désigne', () => {
  // Le clone d'un merge est fait par le nœud : sa configuration est sûre. Mais
  // un diff d'agent peut y apporter un `.gitattributes` qui NOMME un pilote —
  // et si la machine en définit un de ce nom (Git for Windows inscrit
  // `filter.lfs` dans sa configuration système), `git apply` et le diff
  // cumulé le lançaient. Le banc pose la définition dans le clone lui-même,
  // là où elle se trouverait sinon dans une configuration système ou globale.
  const DIFF_AGENT = [
    'diff --git a/.gitattributes b/.gitattributes',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/.gitattributes',
    '@@ -0,0 +1 @@',
    '+*.txt filter=piege diff=piege',
    'diff --git a/app.txt b/app.txt',
    '--- a/app.txt',
    '+++ b/app.txt',
    '@@ -1 +1 @@',
    '-bonjour',
    '+bonjour, ruche',
    '',
  ].join('\n');

  function cloneAvecPilotes(nom: string): string {
    const dossier = path.join(racine, nom);
    execFileSync('git', ['clone', '-q', amontUrl, dossier], { stdio: 'ignore' });
    git(dossier, 'config', 'filter.piege.clean', `${trace('fusion-clean')}; cat`);
    git(dossier, 'config', 'filter.piege.smudge', `${trace('fusion-smudge')}; cat`);
    git(dossier, 'config', 'diff.piege.textconv', `${trace('fusion-textconv')}; cat`);
    return dossier;
  }

  it('ni `git apply`, ni le diff cumulé ne lancent le pilote', async () => {
    // Le piège armé : la fusion naïve (l'ancien `runMerge`) le déclenche.
    const temoin = cloneAvecPilotes('fusion-temoin');
    const patch = path.join(racine, 'agent.patch');
    writeFileSync(patch, DIFF_AGENT);
    // Sans les réglages du banc : `core.autocrlf=false` ne verrait pas, sous
    // Windows, l'app.txt que le clone a écrit en CRLF — c'est le git de la
    // machine, tel que l'ancien `runMerge` le lançait, qu'on arme ici.
    execFileSync('git', ['apply', patch], { cwd: temoin, stdio: 'ignore' });
    gitSansVerdict(temoin, 'add', '--all', '--intent-to-add');
    gitSansVerdict(temoin, 'diff');
    expect(declenchees(), 'le piège est armé').not.toEqual([]);
    rmSync(sentinelles, { recursive: true, force: true });
    mkdirSync(sentinelles);

    const dossier = cloneAvecPilotes('fusion-gardee');
    const r = await runMerge({ repoDir: dossier, diffs: [{ taskId: 'agent', diff: DIFF_AGENT }] });
    expect(declenchees(), 'aucun pilote n’a tourné sur l’hôte').toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.applied).toEqual(['agent']);
    expect(r.mergedDiff).toContain('+bonjour, ruche');
  });
});

// ─── CE QUE LA MACHINE DÉFINIT, ET QUE L'AGENT NE FAIT QUE NOMMER ────────────
//
// Le registre ne lit plus la configuration de la tâche. Restent la
// configuration GLOBALE et SYSTÈME du membre — lues, à dessein (git-hote.ts,
// en-tête) — et ce qu'elles définissent peut être DÉCLENCHÉ par ce que l'agent
// écrit dans l'arbre : un `core.hooksPath` relatif (`.githooks`, `.husky` —
// un réglage global courant) se résout contre l'arbre de la tâche, un
// `.gitattributes` nomme un filtre ou un `textconv` que la machine définit
// (Git for Windows inscrit `filter.lfs`), un `diff.external` global
// (difftastic) s'applique à tout diff. Le banc pose ces définitions dans une
// configuration globale — un HOME à lui — et l'agent n'écrit QUE l'arbre.

type Arbre = Record<string, { contenu: string; executable?: boolean }>;

/** Des fonctions : les sentinelles n'ont de chemin qu'une fois le banc posé. */
interface VecteurMachine {
  /** Les clés de la configuration GLOBALE du membre. */
  machine: () => Record<string, string>;
  /** Ce que l'agent écrit dans l'arbre de SA tâche (jamais dans `.git`). */
  arbre: () => Arbre;
}

const crochetArbre = (nom: string): string => `#!/bin/sh\n${trace(nom)}\nexit 0\n`;

const VECTEURS_MACHINE: Record<string, VecteurMachine> = {
  'un `core.hooksPath` global RELATIF, et le crochet posé dans l’arbre': {
    machine: () => ({ 'core.hooksPath': '.githooks' }),
    arbre: () => ({
      '.githooks/post-index-change': { contenu: crochetArbre('crochet-arbre'), executable: true },
    }),
  },
  'un filtre défini par la machine, nommé par `.gitattributes`': {
    machine: () => ({
      'filter.piege.clean': `${trace('filtre-machine-clean')}; cat`,
      'filter.piege.smudge': `${trace('filtre-machine-smudge')}; cat`,
    }),
    arbre: () => ({ '.gitattributes': { contenu: '*.txt filter=piege\n' } }),
  },
  'un `textconv` défini par la machine, nommé par `.gitattributes`': {
    machine: () => ({ 'diff.piege.textconv': `${trace('textconv-machine')}; cat` }),
    arbre: () => ({ '.gitattributes': { contenu: '*.txt diff=piege\n' } }),
  },
  'un `diff.external` global': {
    machine: () => ({ 'diff.external': trace('diff-external-machine') }),
    arbre: () => ({}),
  },
  'un `core.fsmonitor` global': {
    // Le registre n'en a pas ; la configuration du membre, si. Le moniteur
    // tournerait à chaque `add` sur l'arbre de la tâche.
    machine: () => ({
      'core.fsmonitor': pourSh(script(path.join(racine, 'moniteur-machine'), 'fsmonitor-machine')),
    }),
    arbre: () => ({}),
  },
};

/**
 * Pose `cles` dans la configuration GLOBALE d'un HOME neuf, le temps de
 * `corps` — pour le banc ET pour le git du nœud (`envGitHote` transmet HOME).
 */
async function avecConfigMachine<T>(
  cles: Record<string, string>,
  corps: () => Promise<T>,
): Promise<T> {
  const home = mkdtempSync(path.join(racine, 'home-'));
  const fichier = path.join(home, '.gitconfig');
  for (const [cle, valeur] of Object.entries(cles)) {
    execFileSync('git', ['config', '--file', fichier, cle, valeur]);
  }
  const avant = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  if (process.platform === 'win32') process.env.USERPROFILE = home;
  try {
    return await corps();
  } finally {
    for (const [cle, valeur] of Object.entries(avant)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  }
}

function ecrireArbre(cwd: string, arbre: Arbre): void {
  for (const [relatif, { contenu, executable }] of Object.entries(arbre)) {
    const chemin = path.join(cwd, relatif);
    mkdirSync(path.dirname(chemin), { recursive: true });
    writeFileSync(chemin, contenu, { mode: executable ? 0o755 : 0o644 });
  }
}

/** Le même arbre, en diff d'agent : ce qu'une fusion reçoit du hub. */
function enDiff(arbre: Arbre): string {
  const lignes: string[] = [];
  for (const [relatif, { contenu, executable }] of Object.entries(arbre)) {
    const corps = contenu.split('\n').slice(0, -1);
    lignes.push(
      `diff --git a/${relatif} b/${relatif}`,
      `new file mode ${executable ? '100755' : '100644'}`,
      '--- /dev/null',
      `+++ b/${relatif}`,
      `@@ -0,0 +1,${corps.length} @@`,
      ...corps.map((l) => `+${l}`),
    );
  }
  lignes.push(
    'diff --git a/app.txt b/app.txt',
    '--- a/app.txt',
    '+++ b/app.txt',
    '@@ -1 +1 @@',
    '-bonjour',
    '+bonjour, ruche',
    '',
  );
  return lignes.join('\n');
}

function sentinellesAZero(): void {
  rmSync(sentinelles, { recursive: true, force: true });
  mkdirSync(sentinelles);
}

describe('un pilote que la MACHINE définit ne tourne pas parce que l’arbre de l’agent le nomme', () => {
  it.each(Object.entries(VECTEURS_MACHINE).map(([nom, v], i) => [nom, v, i] as const))(
    '`collectDiff` — %s',
    async (_nom, { machine, arbre }, i) => {
      await avecConfigMachine(machine(), async () => {
        const ws = await prepareWorkspace(travail, tache(`machine-${i}`), amontUrl);
        try {
          writeFileSync(path.join(ws.cwd, 'app.txt'), 'bonjour, ruche\n');
          ecrireArbre(ws.cwd, arbre());

          for (const args of COLLECTE_NAIVE) gitSansVerdict(ws.cwd, ...args);
          expect(declenchees(), 'le piège est armé : git naïf le déclenche').not.toEqual([]);
          sentinellesAZero();

          const diff = await ws.collectDiff();
          expect(declenchees(), 'aucun programme n’a tourné sur l’hôte').toEqual([]);
          expect(diff).toContain('+bonjour, ruche');
        } finally {
          await ws.cleanup();
        }
      });
    },
  );

  it.each(Object.entries(VECTEURS_MACHINE).map(([nom, v], i) => [nom, v, i] as const))(
    '`runMerge` — %s',
    async (_nom, { machine, arbre }, i) => {
      await avecConfigMachine(machine(), async () => {
        const diff = enDiff(arbre());
        const patch = path.join(racine, `machine-${i}.patch`);
        writeFileSync(patch, diff);
        // Le piège armé : la fusion naïve, dans un clone témoin, le déclenche.
        const temoin = path.join(racine, `machine-temoin-${i}`);
        execFileSync('git', ['clone', '-q', amontUrl, temoin], { stdio: 'ignore' });
        // `apply` sans les réglages du banc, comme la fusion témoin plus haut :
        // sous Windows, `core.autocrlf=false` ne reconnaîtrait pas l'app.txt que
        // le clone a écrit en CRLF, et le piège ne serait jamais posé.
        execFileSync('git', ['apply', patch], { cwd: temoin, stdio: 'ignore' });
        for (const args of COLLECTE_NAIVE) gitSansVerdict(temoin, ...args);
        expect(declenchees(), 'le piège est armé').not.toEqual([]);
        sentinellesAZero();

        const dossier = path.join(racine, `machine-fusion-${i}`);
        await cloneRepo(dossier, amontUrl);
        const r = await runMerge({ repoDir: dossier, diffs: [{ taskId: 'agent', diff }] });
        expect(declenchees(), 'aucun programme n’a tourné sur l’hôte').toEqual([]);
        expect(r.conflicts).toEqual([]);
        expect(r.mergedDiff).toContain('+bonjour, ruche');
      });
    },
  );
});

describe('le git que lance l’hôte est celui de la machine, jamais un binaire de l’arbre', () => {
  // Sous Windows, `execFile('git', …, { cwd })` cherche `git.exe`/`git.com`
  // dans le cwd AVANT le PATH (libuv, `search_path`). Un git lancé DEPUIS
  // l'arbre de la tâche lançait donc le binaire que l'agent y avait posé. Le
  // banc y pose un `git.exe` qui n'est pas git (node lui-même) : s'il tourne,
  // le diff échoue au lieu de rendre le travail de l'agent.
  it.runIf(process.platform === 'win32')(
    'un `git.exe` posé à la racine de la tâche ne tourne pas',
    async () => {
      const ws = await prepareWorkspace(travail, tache('faux-git'), amontUrl);
      try {
        writeFileSync(path.join(ws.cwd, 'app.txt'), 'bonjour, ruche\n');
        copyFileSync(process.execPath, path.join(ws.cwd, 'git.exe'));
        const diff = await ws.collectDiff();
        expect(diff).toContain('+bonjour, ruche');
      } finally {
        await ws.cleanup();
      }
    },
  );
});

describe('un git local de l’hôte est BORNÉ, et son échec ne recopie pas la ligne de commande', () => {
  // Le registre emprunte les objets de la tâche (`alternates`) — et git suit
  // les `alternates` de CEUX-LÀ. Un FIFO que l'agent pose à leur place
  // bloque l'`open()` de git dès la première lecture d'objet (un index de
  // pack piégé fait de même, mais seulement si git en vient à l'ouvrir) :
  // sans délai, `collectDiff` ne rendait jamais la main, la place de la
  // tâche restait prise. Pas de FIFO sous Windows.
  it.skipIf(process.platform === 'win32')(
    'des `alternates` piégés (FIFO) : échec visible au bout du délai, sans l’argv',
    async () => {
      const ws = await prepareWorkspace(travail, tache('fifo'), amontUrl);
      try {
        const info = path.join(ws.cwd, '.git', 'objects', 'info');
        mkdirSync(info, { recursive: true });
        rmSync(path.join(info, 'alternates'), { force: true });
        execFileSync('mkfifo', [path.join(info, 'alternates')]);
        const depot = { gitDir: `${ws.cwd}.git`, workTree: ws.cwd };
        const echec = await gitHote(['diff', 'HEAD'], depot, { delaiMs: 1_500 }).catch(
          (e: unknown) => e,
        );
        expect(echec).toBeInstanceOf(EchecGitHote);
        const message = (echec as EchecGitHote).message;
        expect(message).toMatch(/interrompu/);
        // Le message d'`execFile` pour un processus tué recopie l'argv — et
        // celui d'un clone porte l'URL, jeton compris.
        expect(message).not.toContain('--git-dir');
      } finally {
        await ws.cleanup();
      }
    },
    15_000,
  );
});

describe('un filtre que le PROJET déclare (Git LFS) reste appliqué', () => {
  // Neutraliser TOUS les filtres coupait aussi celui que le commit de départ
  // déclare : l'arbre cloné porte le contenu (`smudge`), la base le pointeur,
  // et git relisait le fichier sans `clean` — chaque fichier LFS intact
  // sortait modifié de chaque diff, et la fusion finissait en faux conflit.
  // `faux` joue git-lfs : défini par la MACHINE (comme Git for Windows le
  // fait pour `filter.lfs`), requis, déclaré par le `.gitattributes` du projet
  // — à la racine ET dans un sous-dossier (réécriture des motifs).
  const FILTRE_MACHINE = {
    'filter.faux.clean': 'tr A-Z a-z',
    'filter.faux.smudge': 'tr a-z A-Z',
    'filter.faux.required': 'true',
  };
  let lfsUrl: string;

  beforeAll(() => {
    const depot = path.join(racine, 'amont-lfs.git');
    execFileSync('git', ['init', '-q', '--bare', depot]);
    git(depot, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    const copie = path.join(racine, 'amont-lfs');
    mkdirSync(path.join(copie, 'sous'), { recursive: true });
    git(copie, 'init', '-q');
    git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    writeFileSync(path.join(copie, '.gitattributes'), '*.bin filter=faux\n');
    writeFileSync(path.join(copie, 'sous', '.gitattributes'), '*.dat filter=faux\n');
    // Le filtre n'est pas défini ici : les pointeurs sont committés tels quels.
    writeFileSync(path.join(copie, 'gros.bin'), 'pointeur oid abc\n');
    writeFileSync(path.join(copie, 'sous', 'autre.dat'), 'pointeur oid def\n');
    writeFileSync(path.join(copie, 'app.txt'), 'bonjour\n');
    git(copie, 'add', '--all');
    git(copie, 'commit', '-q', '-m', 'projet lfs');
    git(copie, 'push', '-q', depot, 'main');
    lfsUrl = pathToFileURL(depot).href;
  });

  /**
   * Des dates neuves, contenu intact (un outil de build le fait) : git ne
   * peut plus se fier à l'index et DOIT relire — donc filtrer — ces fichiers.
   * Sans cela, le banc dépendrait de la seconde où le clone a écrit l'index.
   */
  function toucher(cwd: string): void {
    const plusTard = new Date(Date.now() + 60_000);
    for (const f of ['gros.bin', path.join('sous', 'autre.dat')]) {
      utimesSync(path.join(cwd, f), plusTard, plusTard);
    }
  }

  it('`collectDiff` ne montre que le travail de l’agent', async () => {
    await avecConfigMachine(FILTRE_MACHINE, async () => {
      const ws = await prepareWorkspace(travail, tache('lfs'), lfsUrl);
      try {
        expect(readFileSync(path.join(ws.cwd, 'gros.bin'), 'utf8')).toMatch(/^POINTEUR/);
        // L'agent, lui, ÉTEND la déclaration du projet à `*.txt` : ignoré —
        // passé par `clean`, son texte sortirait en minuscules.
        writeFileSync(path.join(ws.cwd, 'app.txt'), 'Bonjour, Ruche\n');
        appendFileSync(path.join(ws.cwd, '.gitattributes'), '*.txt filter=faux\n');
        toucher(ws.cwd);
        const diff = await ws.collectDiff();
        expect(diff).toContain('+Bonjour, Ruche');
        expect(diff).not.toContain('gros.bin');
        expect(diff).not.toContain('autre.dat');
      } finally {
        await ws.cleanup();
      }
    });
  });

  it('la fusion applique le diff, et son diff cumulé ne montre que lui', async () => {
    await avecConfigMachine(FILTRE_MACHINE, async () => {
      const dossier = path.join(racine, 'fusion-lfs');
      await cloneRepo(dossier, lfsUrl);
      toucher(dossier);
      const r = await runMerge({
        repoDir: dossier,
        diffs: [{ taskId: 'agent', diff: enDiff({}) }],
      });
      expect(r.conflicts).toEqual([]);
      expect(r.applied).toEqual(['agent']);
      expect(r.mergedDiff).toContain('+bonjour, ruche');
      expect(r.mergedDiff).not.toContain('gros.bin');
      expect(r.mergedDiff).not.toContain('autre.dat');
    });
  });
});

describe('la configuration GLOBALE du membre reste servie', () => {
  it('un `core.splitIndex=true` global : le diff se calcule', async () => {
    // Sous un index scindé, l'index du clone n'est qu'un renvoi vers un
    // `sharedindex.*` de son git dir : le registre doit l'avoir aussi.
    await avecConfigMachine({ 'core.splitIndex': 'true' }, async () => {
      const ws = await prepareWorkspace(travail, tache('index-scinde'), amontUrl);
      try {
        writeFileSync(path.join(ws.cwd, 'app.txt'), 'bonjour, ruche\n');
        expect(await ws.collectDiff()).toContain('+bonjour, ruche');
      } finally {
        await ws.cleanup();
      }
    });
  });

  it('le `core.sshCommand` du membre sert au clone, EN mode lot', async () => {
    // Sous Windows, c'est ce réglage qui fait parler git à l'agent ssh du
    // système : le remplacer par `ssh` cassait les clés à phrase de passe.
    const journal = pourSh(path.join(sentinelles, 'ssh-membre'));
    const commande = `f() { echo "$*" >> '${journal}'; exit 1; }; f`;
    await avecConfigMachine({ 'core.sshCommand': commande }, async () => {
      const dossier = path.join(racine, 'clone-ssh');
      await expect(cloneRepo(dossier, 'ssh://depot.invalide/prive.git')).rejects.toThrow(
        EchecGitHote,
      );
    });
    const appel = readFileSync(path.join(sentinelles, 'ssh-membre'), 'utf8');
    expect(appel).toContain('-o BatchMode=yes');
    expect(appel).toContain('depot.invalide');
  });
});
