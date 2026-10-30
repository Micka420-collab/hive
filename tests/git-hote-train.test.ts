// LES GIT DE L'HÔTE ARRIVÉS AVEC LE TRAIN 2 PASSENT, EUX AUSSI, PAR `gitHote`.
//
// ─── POURQUOI CE BANC ────────────────────────────────────────────────────────
//
// #483 a fermé le trou des git lancés sur l'hôte APRÈS l'agent (`collectDiff`,
// le merge) : tout passe par le registre de la ruche et `gitHote`
// (src/node-client/git-hote.ts). Mais #483 n'avait pas vu le train 2, qui en
// ajoutait deux familles, toutes deux par simple-git :
//
//   · les validations du bac (#475) relisaient la base, indexaient, diffaient
//     et nettoyaient par le `.git` DE LA TÂCHE — celui que l'agent a eu entre
//     les mains : son crochet, son moniteur, son filtre tournaient sur l'hôte ;
//   · la livraison locale (#476) composait sa mission DANS le clone du merge,
//     depuis son arbre — un `core.hooksPath` global relatif y trouvait le
//     `reference-transaction` qu'un diff venait d'y livrer —, et parlait au
//     dépôt distant sans `ssh` en mode lot : une poussée SSH qui attend une
//     phrase de passe figeait le merge jusqu'à son délai.
//
// Même méthode que tests/git-hote.test.ts : chaque piège est d'abord ARMÉ par
// le git naïf (la sentinelle apparaît), puis c'est au nœud de ne rien lancer.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMerge } from '../src/node-client/merge-runner.js';
import { validerProduction } from '../src/node-client/validations-bac.js';
import {
  cloneRepo,
  prepareWorkspace,
  retirerFichiersIgnores,
} from '../src/node-client/workspace.js';
import type { Task } from '../src/shared/types.js';

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
let sentinelles: string;
let amontUrl: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...REGLAGES_BANC, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitSansVerdict(cwd: string, ...args: string[]): void {
  try {
    git(cwd, ...args);
  } catch {
    // Le piège compte, pas le code de sortie.
  }
}

const pourSh = (p: string): string => p.split(path.sep).join('/');
const trace = (nom: string): string => `echo piege >> '${pourSh(path.join(sentinelles, nom))}'`;
const declenchees = (): string[] => readdirSync(sentinelles).sort();

function script(dossier: string, nom: string): string {
  mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, nom);
  writeFileSync(chemin, `#!/bin/sh\n${trace(nom)}\nexit 0\n`, { mode: 0o755 });
  return chemin;
}

function sentinellesAZero(): void {
  rmSync(sentinelles, { recursive: true, force: true });
  mkdirSync(sentinelles);
}

/** Pose `cles` dans la configuration GLOBALE d'un HOME neuf, le temps de `corps`. */
async function avecConfigMachine<T>(
  cles: Record<string, string>,
  corps: () => Promise<T>,
): Promise<T> {
  const home = mkdtempSync(path.join(racine, 'home-'));
  for (const [cle, valeur] of Object.entries(cles)) {
    execFileSync('git', ['config', '--file', path.join(home, '.gitconfig'), cle, valeur]);
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

const tache = (id: string): Task => ({ id, title: id, prompt: 'x', branch: null }) as Task;

const livraison = (projectId: string, depotProjet: string) => ({
  demande: {
    projectId,
    pousser: false,
    provenance: [{ taskId: 'agent', resultId: 1, decision: 'accepted' as const }],
  },
  depotProjet,
  depotLocal: path.join(racine, 'livraisons', `${projectId}.git`),
  pousseeConsentie: false,
});

beforeAll(() => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-git-hote-train-'));
  sentinelles = path.join(racine, 'sentinelles');
  const depot = path.join(racine, 'amont.git');
  execFileSync('git', ['init', '-q', '--bare', depot]);
  git(depot, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const copie = path.join(racine, 'amont');
  mkdirSync(copie);
  git(copie, 'init', '-q');
  git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(path.join(copie, 'app.txt'), 'bonjour\n');
  writeFileSync(path.join(copie, '.gitignore'), 'ignore/\n');
  git(copie, 'add', '--all');
  git(copie, 'commit', '-q', '-m', 'premier commit');
  git(copie, 'push', '-q', depot, 'main');
  amontUrl = pathToFileURL(depot).href;
});

beforeEach(sentinellesAZero);

afterAll(() => {
  try {
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Objets git en lecture seule sous Windows : sans gravité pour un tmpdir.
  }
});

/** Ce que l'agent écrit dans le `.git` de SA tâche. */
const PIEGES_DE_TACHE: Record<string, (cwd: string) => void> = {
  'un crochet (`.git/hooks/post-index-change`)': (cwd) => {
    script(path.join(cwd, '.git', 'hooks'), 'post-index-change');
  },
  '`core.fsmonitor`': (cwd) => {
    git(cwd, 'config', 'core.fsmonitor', pourSh(script(path.join(cwd, '.git'), 'fsmonitor')));
  },
  'un filtre `clean` désigné par `.gitattributes`': (cwd) => {
    writeFileSync(path.join(cwd, '.gitattributes'), '*.txt filter=piege\n');
    git(cwd, 'config', 'filter.piege.clean', `${trace('filtre-clean')}; cat`);
  },
};

describe('les validations du bac (#475) relisent le dépôt par le registre, jamais par le `.git` de la tâche', () => {
  it.each(Object.entries(PIEGES_DE_TACHE).map(([nom, poser], i) => [nom, poser, i] as const))(
    '%s',
    async (_nom, poser, i) => {
      const ws = await prepareWorkspace(
        path.join(racine, 'travail'),
        tache(`validations-${i}`),
        amontUrl,
      );
      try {
        writeFileSync(path.join(ws.cwd, 'app.txt'), 'bonjour, ruche\n');
        mkdirSync(path.join(ws.cwd, 'ignore'));
        writeFileSync(path.join(ws.cwd, 'ignore', 'laisse.txt'), 'par l’agent\n');
        poser(ws.cwd);
        for (const args of [['add', '--all', '--intent-to-add'], ['diff']]) {
          gitSansVerdict(ws.cwd, ...args);
        }
        expect(declenchees(), 'le piège est armé : git naïf le déclenche').not.toEqual([]);
        sentinellesAZero();

        if (!ws.depot || !ws.baseSha) throw new Error('le clone n’a pas de registre');
        // Sans bac : `.npmrc` est jugé (index + diff), puis rien ne tourne.
        const rapport = await validerProduction({
          cwd: ws.cwd,
          depot: { depot: ws.depot, baseSha: ws.baseSha },
        });
        await retirerFichiersIgnores(ws.depot);

        expect(declenchees(), 'aucun programme de l’agent n’a tourné sur l’hôte').toEqual([]);
        expect(rapport.baseSha).toBe(ws.baseSha);
        // Le nettoyage a bien eu lieu, par le registre.
        expect(readdirSync(ws.cwd)).not.toContain('ignore');
      } finally {
        await ws.cleanup();
      }
    },
  );
});

describe('la livraison locale (#476) compose et parle au distant par `gitHote`', () => {
  it('un `core.hooksPath` global relatif ne lance pas le `reference-transaction` qu’un diff livre', async () => {
    const crochet = `#!/bin/sh\n${trace('reference-transaction')}\nexit 0\n`;
    const diff = [
      'diff --git a/.githooks/reference-transaction b/.githooks/reference-transaction',
      'new file mode 100755',
      '--- /dev/null',
      '+++ b/.githooks/reference-transaction',
      `@@ -0,0 +1,${crochet.split('\n').length - 1} @@`,
      ...crochet
        .split('\n')
        .slice(0, -1)
        .map((l) => `+${l}`),
      'diff --git a/app.txt b/app.txt',
      '--- a/app.txt',
      '+++ b/app.txt',
      '@@ -1 +1 @@',
      '-bonjour',
      '+bonjour, ruche',
      '',
    ].join('\n');
    await avecConfigMachine({ 'core.hooksPath': '.githooks' }, async () => {
      // Armé : dans un clone témoin où le diff est appliqué, l'`update-ref`
      // naïf de l'ancienne livraison lance le crochet livré.
      const temoin = path.join(racine, 'livraison-temoin');
      execFileSync('git', ['clone', '-q', amontUrl, temoin], { stdio: 'ignore' });
      const patch = path.join(racine, 'livraison.patch');
      writeFileSync(patch, diff);
      execFileSync('git', ['apply', patch], { cwd: temoin, stdio: 'ignore' });
      gitSansVerdict(temoin, 'update-ref', 'refs/hive/livraison', 'HEAD');
      expect(declenchees(), 'le piège est armé').not.toEqual([]);
      sentinellesAZero();

      const dossier = path.join(racine, 'livraison-fusion');
      await cloneRepo(dossier, amontUrl);
      const r = await runMerge({
        repoDir: dossier,
        diffs: [{ taskId: 'agent', diff }],
        livraison: livraison('crochet', amontUrl),
      });
      expect(declenchees(), 'aucun programme n’a tourné sur l’hôte').toEqual([]);
      expect(r.livraison, r.logs).toMatchObject({
        etat: 'commitee',
        branche: 'hive/mission-crochet-1',
      });
    });
  });

  it('le `ls-remote` de la livraison passe par le `ssh` du membre, EN mode lot', async () => {
    // Sans mode lot, `ssh` lit le TERMINAL (clé d'hôte, phrase de passe) :
    // la livraison attendait jusqu'à `DELAI_RESEAU_MS`, le merge pris avec.
    const journal = pourSh(path.join(sentinelles, 'ssh-membre'));
    const commande = `f() { echo "$*" >> '${journal}'; exit 1; }; f`;
    const dossier = path.join(racine, 'livraison-ssh');
    await cloneRepo(dossier, amontUrl);
    const r = await avecConfigMachine({ 'core.sshCommand': commande }, () =>
      runMerge({
        repoDir: dossier,
        diffs: [
          {
            taskId: 'agent',
            diff: 'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-bonjour\n+bonjour, ruche\n',
          },
        ],
        livraison: livraison('ssh', 'ssh://depot.invalide/prive.git'),
      }),
    );
    expect(r.livraison?.etat).toBe('non_commitee');
    const appel = readFileSync(path.join(sentinelles, 'ssh-membre'), 'utf8');
    expect(appel).toContain('-o BatchMode=yes');
    expect(appel).toContain('depot.invalide');
  });
});
