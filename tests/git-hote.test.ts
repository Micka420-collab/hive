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
// Le pager est le seul vecteur qu'on ne sait pas armer ici : git ne l'appelle
// que sous un terminal. Il est posé quand même — `--no-pager` le couvre.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  '`core.sshCommand`': {
    poser: (cwd) => {
      git(cwd, 'config', 'core.sshCommand', `${trace('ssh-command')}; false`);
    },
    armer: [['ls-remote', 'ssh://depot.invalide/prive.git']],
  },
  'un alias': {
    poser: (cwd) => {
      git(cwd, 'config', 'alias.piege', `!${trace('alias')}`);
    },
    armer: [['piege']],
  },
  '`core.pager` et `pager.diff`': {
    poser: (cwd) => {
      git(cwd, 'config', 'core.pager', trace('pager'));
      git(cwd, 'config', 'pager.diff', trace('pager-diff'));
    },
    armer: null,
  },
};

describe('le diff de revue d’une tâche (`collectDiff`) n’exécute rien que l’agent a configuré', () => {
  it.each(Object.entries(VECTEURS))('%s', async (nom, { poser, armer }) => {
    const ws = await prepareWorkspace(travail, tache(`piege-${nom.length}`), amontUrl);
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
    } finally {
      ws.cleanup();
    }
  });

  it('le git dir que lit l’hôte vit HORS du répertoire monté dans le bac, et part avec la tâche', async () => {
    const ws = await prepareWorkspace(travail, tache('registre'), amontUrl);
    const registre = `${ws.cwd}.git`;
    expect(existsSync(path.join(registre, 'HEAD'))).toBe(true);
    // Aucun crochet : ni ceux d'un modèle, ni ceux d'un `init.templateDir`.
    expect(existsSync(path.join(registre, 'hooks'))).toBe(false);
    ws.cleanup();
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
      ws.cleanup();
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
