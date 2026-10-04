// LE CLONE D'UNE TÂCHE NE PORTE AUCUN IDENTIFIANT DE PUSH — la suite de G12.
//
// ─── LE TROU, MESURÉ AVANT LE CORRECTIF (git 2.53) ───────────────────────────
//
// Un dépôt privé arrive du hub avec ses identifiants DANS l'URL
// (`https://user:ghp_…@github.com/…`). Le nœud la passait telle quelle à git :
//
//   · `.git/config` du clone de tâche portait l'URL entière : l'agent la lit
//     (`cat .git/config` est une lecture « toujours » permise par G12), et un
//     test qu'il a écrit — que le `npm test` autorisé lance — pouvait pousser
//     avec. Le registre de la ruche la recopiait à côté ;
//   · git CONFIAIT le jeton à l'assistant d'identifiants du membre : avec
//     `credential.helper=store`, il dormait en clair dans `~/.git-credentials`
//     (sous Windows, dans le gestionnaire où Git for Windows inscrit GCM), et
//     un `git push` lancé depuis l'espace de travail le retrouvait là.
//
// La politique d'actions de G12 juge la FORME des commandes ; elle ne contient
// pas un agent hostile. L'enceinte doit être structurelle — c'est ce que ces
// bancs tiennent, contre un vrai git et un vrai serveur HTTP Git qui exige le
// compte du projet, en lecture comme en poussée (`aide/serveur-git.ts`) :
//
//   1. après préparation — tâche neuve, reprise d'une PR, clone de merge ou de
//      chantier —, ni `.git/config`, ni aucun fichier du clone ou du registre,
//      ni l'environnement de l'agent, ni l'assistant du membre ne contiennent
//      le jeton ;
//   2. un `git push` lancé depuis l'espace de travail, comme le ferait
//      l'agent, échoue faute d'identifiants — même avec le HOME du membre ;
//   3. la livraison locale pousse quand même, avec le compte du projet ;
//   4. aucun message d'échec ne cite le jeton, et la porte git refuse une
//      adresse avec identifiants en argument ;
//   5. le miroir de la Reine passe par la même porte, et s'en trouve mieux :
//      un jeton renouvelé y sert au rafraîchissement suivant.

import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServeurGit } from './aide/serveur-git.js';
import { runMerge } from '../src/node-client/merge-runner.js';
import { cloneRepo, prepareWorkspace } from '../src/node-client/workspace.js';
import { FENETRE_RAFRAICHISSEMENT_MS, Miroir } from '../src/orchestrator/miroir.js';
import { EchecGitHote, depotDistant, gitHote } from '../src/shared/git-protege.js';
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

/** Un banc qui enchaîne de vrais git et un vrai serveur : le plafond de `workflow-git`. */
const PLAFOND = { timeout: 60_000 };

let racine: string;
/** Les dépôts bare que sert le serveur. */
let projets: string;
/** Le `workRoot` du nœud. */
let travail: string;
/** Le HOME du MEMBRE : un assistant `store`, qui écrit en clair ce que git lui confie. */
let membre: string;
let serveur: ServeurGit;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', [...REGLAGES_BANC, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

beforeAll(async () => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-clone-sans-identifiants-'));
  projets = path.join(racine, 'projets');
  travail = path.join(racine, 'travail');
  membre = path.join(racine, 'membre');
  mkdirSync(projets, { recursive: true });
  mkdirSync(membre, { recursive: true });
  writeFileSync(path.join(membre, '.gitconfig'), '[credential]\n\thelper = store\n');
  // Le dépôt PRIVÉ : `main`, et la branche de la pull request qu'une reprise
  // prolonge (G05a).
  const depot = path.join(projets, 'prive.git');
  git(racine, 'init', '-q', '--bare', depot);
  git(depot, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const copie = path.join(racine, 'copie');
  git(racine, 'init', '-q', copie);
  git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(path.join(copie, 'LISEZMOI.md'), '# Privé\n');
  git(copie, 'add', '--all');
  git(copie, 'commit', '-q', '-m', 'premier commit');
  git(copie, 'push', '-q', depot, 'main', 'main:refs/heads/hive/reprise');
  serveur = new ServeurGit(projets);
  serveur.mode = 'prive';
  await serveur.demarrer();
});

afterAll(async () => {
  await serveur.fermer();
  try {
    rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Objets git en lecture seule sous Windows : sans gravité pour un tmpdir.
  }
});

// Le git du NŒUD lit le HOME du processus (`envGitHote`) : c'est celui du
// membre, assistant `store` compris. Effacé après chaque banc — un banc rouge
// ne doit pas en faire rougir un autre.
beforeEach(() => {
  vi.stubEnv('HOME', membre);
  vi.stubEnv('USERPROFILE', membre);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(path.join(membre, '.git-credentials'), { force: true });
});

// ─── LES OUTILS DU BANC ──────────────────────────────────────────────────────

const tache = (id: string, branch: string | null = null): Task =>
  ({ id, title: id, prompt: 'x', branch }) as Task;

/** Ce que l'assistant `store` du membre a reçu — vide s'il n'a rien reçu. */
function confieAuMembre(): string {
  const fichier = path.join(membre, '.git-credentials');
  return existsSync(fichier) ? readFileSync(fichier, 'utf8') : '';
}

/** Les fichiers sous `dossier` — `.git` compris — dont les octets contiennent `secret`. */
function fichiersAvec(dossier: string, secret: string): string[] {
  return readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .filter((f) => readFileSync(f).includes(secret))
    .map((f) => path.relative(dossier, f));
}

/** `remote.origin.url`, lu dans la configuration d'un git dir. */
const origineDe = (gitDir: string): string =>
  execFileSync('git', ['config', '--file', path.join(gitDir, 'config'), 'remote.origin.url'], {
    encoding: 'utf8',
  }).trim();

/** Les références du dépôt privé, lues sur le disque du serveur — pas par HTTP. */
const referencesDuServeur = (): string =>
  git(path.join(projets, 'prive.git'), 'for-each-ref', '--format=%(refname)');

/** L'échec d'une promesse — ou `null` si elle a abouti. */
const echecDe = (promesse: Promise<unknown>): Promise<unknown> =>
  promesse.then(
    () => null,
    (e: unknown) => e,
  );

// ─── 0. CE QUI EST UN IDENTIFIANT, ET CE QUI N'EN EST PAS ────────────────────

describe('depotDistant — l’adresse nue, et ce qui l’ouvre', () => {
  /** La configuration éphémère, en clés lisibles — l'ordre n'y compte pas. */
  const reglages = (acces: Readonly<Record<string, string>>): Record<string, string> =>
    Object.fromEntries(
      Array.from({ length: Number(acces.GIT_CONFIG_COUNT ?? 0) }, (_, i) => [
        acces[`GIT_CONFIG_KEY_${i}`],
        acces[`GIT_CONFIG_VALUE_${i}`],
      ]),
    );

  // `motDePasse` : `oui` — le projet ouvre le dépôt, les assistants du membre
  // sont écartés ; `nom` — un nom seul choisit le compte que l'assistant du
  // membre fournira, il reste lu ; `rien` — rien à cacher, rien ne change.
  it.each([
    ['https://marie:jeton@github.com/o/r.git', 'https://github.com/o/r.git', 'oui'],
    ['https://u:p@ss@hote/d.git', 'https://hote/d.git', 'oui'],
    ['https://ghp_nom@github.com/o/r.git', 'https://github.com/o/r.git', 'nom'],
    ['ssh://git@github.com/o/r.git', 'ssh://git@github.com/o/r.git', 'rien'],
    ['git@github.com:o/r.git', 'git@github.com:o/r.git', 'rien'],
    ['https://hote/chemin@v2/d.git', 'https://hote/chemin@v2/d.git', 'rien'],
  ] as const)('%s → %s (mot de passe : %s)', (url, nue, motDePasse) => {
    const distant = depotDistant(url);
    expect(distant.nue).toBe(nue);
    if (motDePasse === 'rien') {
      expect(distant.acces).toEqual({});
      return;
    }
    expect(reglages(distant.acces)).toEqual({
      [`url.${url}.insteadOf`]: nue,
      [`url.${url}.pushInsteadOf`]: nue,
      ...(motDePasse === 'oui' ? { 'credential.helper': '' } : {}),
    });
  });
});

// ─── 1. AUCUNE PORTE DE CLONE N'ÉCRIT LE JETON ───────────────────────────────

describe('le clone ne porte aucun identifiant — à aucune porte', () => {
  /** Ce qu'une porte a écrit sur le disque, et l'environnement qu'elle donne à l'agent. */
  type Preparation = { clone: string; dossiers: string[]; env?: NodeJS.ProcessEnv };
  const PORTES: [string, (url: string) => Promise<Preparation>][] = [
    [
      'une tâche neuve (`prepareWorkspace`)',
      async (url) => {
        const ws = await prepareWorkspace(travail, tache('neuve'), url);
        return { clone: ws.cwd, dossiers: [ws.cwd, `${ws.cwd}.git`], env: ws.env };
      },
    ],
    [
      'la reprise d’une pull request (G05a, `prolonger`)',
      async (url) => {
        const ws = await prepareWorkspace(
          travail,
          tache('reprise', 'hive/reprise'),
          url,
          [],
          '',
          true,
        );
        return { clone: ws.cwd, dossiers: [ws.cwd, `${ws.cwd}.git`], env: ws.env };
      },
    ],
    [
      'le clone d’un merge ou d’un chantier (`cloneRepo`)',
      async (url) => {
        const clone = path.join(racine, 'clones', 'merge');
        await cloneRepo(clone, url);
        return { clone, dossiers: [clone] };
      },
    ],
  ];

  it.each(PORTES)(
    '%s : ni `.git/config`, ni aucun fichier, ni l’environnement de l’agent, ni l’assistant du membre',
    PLAFOND,
    async (_porte, preparer) => {
      const { clone, dossiers, env } = await preparer(serveur.urlAvecCompte('prive'));
      const secret = serveur.compte.motDePasse;
      // Le compte du projet a servi : le code privé est là.
      // L'extraction suit le `core.autocrlf` du poste (CRLF sur les runners
      // Windows) : le banc prouve le contenu cloné, pas ses fins de ligne.
      const lisezmoi = readFileSync(path.join(clone, 'LISEZMOI.md'), 'utf8');
      expect(lisezmoi.replace(/\r\n/g, '\n')).toBe('# Privé\n');
      // L'adresse NUE — pas même le nom du compte.
      expect(origineDe(path.join(clone, '.git'))).toBe(serveur.url('prive'));
      for (const dossier of dossiers) expect(fichiersAvec(dossier, secret), dossier).toEqual([]);
      if (env) expect(JSON.stringify(env)).not.toContain(secret);
      expect(confieAuMembre()).toBe('');
    },
  );
});

// ─── 2. LE PUSH DE L'AGENT N'A RIEN POUR S'AUTHENTIFIER ──────────────────────

describe('un `git push` de l’agent échoue faute d’identifiants', () => {
  it(
    'lancé depuis l’espace de travail, avec l’environnement de l’agent ET le HOME du membre : refusé, rien n’arrive',
    PLAFOND,
    async () => {
      const ws = await prepareWorkspace(travail, tache('agent'), serveur.urlAvecCompte('prive'));
      const envAgent = {
        ...ws.env,
        // Au niveau `processus`, l'agent atteint le HOME du membre : on le lui
        // donne, assistant `store` compris.
        HOME: membre,
        USERPROFILE: membre,
        // Sans terminal git échouerait déjà ; ces deux lignes l'empêchent
        // seulement d'ATTENDRE une saisie sous le terminal d'un développeur.
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      };
      // Ce que ferait l'agent — ou un test qu'il a écrit et que `npm test` lance.
      writeFileSync(path.join(ws.cwd, 'vol.txt'), 'x\n');
      const enAgent = { cwd: ws.cwd, env: envAgent, stdio: 'ignore' } as const;
      execFileSync('git', [...REGLAGES_BANC, 'add', 'vol.txt'], enAgent);
      execFileSync('git', [...REGLAGES_BANC, 'commit', '-q', '-m', 'vol'], enAgent);
      // ASYNCHRONE : le serveur vit dans CE processus — un `spawnSync` gèlerait
      // la boucle qui doit lui répondre, et la poussée attendrait son délai.
      const poussee = await new Promise<{ reussie: boolean; stderr: string }>((fin) => {
        execFile(
          'git',
          ['push', 'origin', 'HEAD:refs/heads/vol'],
          { cwd: ws.cwd, env: envAgent, encoding: 'utf8', timeout: 30_000 },
          (err, _stdout, stderr) => fin({ reussie: err === null, stderr }),
        );
      });
      expect(poussee.reussie, poussee.stderr).toBe(false);
      expect(poussee.stderr).toMatch(
        /terminal prompts disabled|could not read Username|Authentication failed/,
      );
      expect(referencesDuServeur()).not.toContain('refs/heads/vol');
    },
  );
});

// ─── 3. LA LIVRAISON POUSSE QUAND MÊME ───────────────────────────────────────

describe('la livraison locale pousse avec le compte du projet — et ne le dépose nulle part', () => {
  const DIFF =
    'diff --git a/livre.md b/livre.md\nnew file mode 100644\n--- /dev/null\n+++ b/livre.md\n' +
    '@@ -0,0 +1 @@\n+livré\n';

  /** Le chemin d'un merge avec livraison sur un nœud : `cloneRepo`, puis `runMerge`. */
  async function livrer(projectId: string, depotProjet: string, clone?: string) {
    const repoDir = clone ?? path.join(racine, 'merges', projectId);
    if (clone === undefined) await cloneRepo(repoDir, depotProjet);
    const depotLocal = path.join(racine, 'livraisons', `${projectId}.git`);
    const res = await runMerge({
      repoDir,
      diffs: [{ taskId: 'ta', diff: DIFF }],
      livraison: {
        demande: {
          projectId,
          pousser: true,
          provenance: [{ taskId: 'ta', resultId: 1, decision: 'accepted' }],
        },
        depotProjet,
        depotLocal,
        pousseeConsentie: true,
      },
    });
    return { res, depotLocal };
  }

  it(
    'la branche de mission arrive sur le dépôt ; ni le dépôt durable ni l’assistant du membre ne gardent le jeton',
    PLAFOND,
    async () => {
      const { res, depotLocal } = await livrer('pousse', serveur.urlAvecCompte('prive'));
      expect(res.livraison, res.logs).toMatchObject({
        etat: 'commitee',
        branche: 'hive/mission-pousse-1',
        poussee: 'poussee',
      });
      expect(referencesDuServeur()).toContain('refs/heads/hive/mission-pousse-1');
      expect(origineDe(depotLocal)).toBe(serveur.url('prive'));
      expect(fichiersAvec(depotLocal, serveur.compte.motDePasse)).toEqual([]);
      expect(confieAuMembre()).toBe('');
    },
  );

  it(
    'un jeton de LECTURE : la poussée échoue et le motif le dit — sans le jeton',
    PLAFOND,
    async () => {
      serveur.lectureSeule = true;
      try {
        const { res } = await livrer('lecture', serveur.urlAvecCompte('prive'));
        expect(res.livraison, res.logs).toMatchObject({ etat: 'commitee', poussee: 'echec' });
        if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
        expect(res.livraison.motif).toMatch(/403/);
        expect(JSON.stringify(res)).not.toContain(serveur.compte.motDePasse);
      } finally {
        serveur.lectureSeule = false;
      }
    },
  );

  it(
    'un jeton RÉVOQUÉ après le clone : rien n’est commité, et le motif ne cite pas le jeton',
    PLAFOND,
    async () => {
      const ancien = serveur.urlAvecCompte('prive');
      const clone = path.join(racine, 'merges', 'revoque');
      await cloneRepo(clone, ancien);
      const motDePasse = serveur.compte.motDePasse;
      serveur.compte = { ...serveur.compte, motDePasse: `${motDePasse}-renouvele` };
      try {
        const { res } = await livrer('revoque', ancien, clone);
        expect(res.livraison).toMatchObject({
          etat: 'non_commitee',
          motif: expect.stringMatching(/Authentication failed/),
        });
        expect(JSON.stringify(res)).not.toContain(motDePasse);
      } finally {
        serveur.compte = { ...serveur.compte, motDePasse };
      }
    },
  );
});

// ─── 4. LA PORTE GIT ─────────────────────────────────────────────────────────

describe('la porte git — aucun identifiant n’entre, aucun ne ressort', () => {
  it('refuse une adresse avec identifiants en argument, avant de lancer git, sans la citer', async () => {
    const avant = serveur.requetes;
    const echec = await echecDe(gitHote(['ls-remote', serveur.urlAvecCompte('prive')], racine));
    expect(echec).toBeInstanceOf(EchecGitHote);
    expect((echec as Error).message).toMatch(/refusé — une adresse avec identifiants/);
    expect((echec as Error).message).not.toContain(serveur.compte.motDePasse);
    expect(serveur.requetes).toBe(avant);
  });

  it(
    'lave ce que renvoie un serveur : une adresse avec identifiants dans ses lignes `remote:` ne ressort pas',
    PLAFOND,
    async () => {
      // Le serveur CITE une adresse authentifiée en refusant — un crochet
      // maison, un proxy bavard. Git relaie ses lignes `remote:` telles quelles.
      const refusant = path.join(racine, 'refusant.git');
      git(racine, 'clone', '--bare', '-q', path.join(projets, 'prive.git'), refusant);
      const crochet = path.join(refusant, 'hooks', 'pre-receive');
      writeFileSync(
        crochet,
        '#!/bin/sh\necho "refusé : voir https://moi:jeton-du-serveur@git.exemple.test/d.git" >&2\nexit 1\n',
      );
      chmodSync(crochet, 0o755);
      const clone = path.join(racine, 'clones', 'crochet');
      await cloneRepo(clone, pathToFileURL(refusant).href);
      const depot = { gitDir: path.join(clone, '.git'), workTree: clone };
      const echec = await echecDe(
        gitHote(['push', pathToFileURL(refusant).href, 'HEAD:refs/heads/x'], depot),
      );
      expect(echec).toBeInstanceOf(EchecGitHote);
      expect((echec as Error).message).toContain('https://***@git.exemple.test');
      expect((echec as Error).message).not.toContain('jeton-du-serveur');
    },
  );
});

// ─── 5. LE MIROIR DE LA REINE ────────────────────────────────────────────────

describe('le miroir de la Reine — la même porte, le même invariant', () => {
  const miroirNeuf = (): Miroir => new Miroir(mkdtempSync(path.join(racine, 'rayons-')));

  it(
    'clone l’adresse nue : ni sa configuration ni l’assistant de l’hôte ne gardent le jeton',
    PLAFOND,
    async () => {
      const miroir = miroirNeuf();
      await miroir.rafraichir('p', serveur.urlAvecCompte('prive'));
      expect((await miroir.lire('p', 'LISEZMOI.md')).contenu).toBe('# Privé\n');
      expect(fichiersAvec(miroir.dossier('p'), serveur.compte.motDePasse)).toEqual([]);
      expect(confieAuMembre()).toBe('');
    },
  );

  it(
    'un jeton RENOUVELÉ sert dès le rafraîchissement suivant — l’ancien n’était écrit nulle part',
    PLAFOND,
    async () => {
      const miroir = miroirNeuf();
      const t0 = Date.now();
      await miroir.rafraichir('p', serveur.urlAvecCompte('prive'), t0);
      // L'amont avance, et le projet change de jeton : l'ancien est révoqué.
      const copie = path.join(racine, 'copie');
      writeFileSync(path.join(copie, 'NOUVEAU.md'), 'après le renouvellement\n');
      git(copie, 'add', '--all');
      git(copie, 'commit', '-q', '-m', 'nouveau');
      git(copie, 'push', '-q', path.join(projets, 'prive.git'), 'main');
      const motDePasse = serveur.compte.motDePasse;
      serveur.compte = { ...serveur.compte, motDePasse: `${motDePasse}-neuf` };
      try {
        await miroir.rafraichir(
          'p',
          serveur.urlAvecCompte('prive'),
          t0 + 10 * FENETRE_RAFRAICHISSEMENT_MS,
        );
        expect((await miroir.lire('p', 'NOUVEAU.md')).contenu).toBe('après le renouvellement\n');
      } finally {
        serveur.compte = { ...serveur.compte, motDePasse };
      }
    },
  );

  it(
    'un miroir d’avant, dont la configuration porte le jeton, est refait — et le jeton quitte le disque',
    PLAFOND,
    async () => {
      const miroir = miroirNeuf();
      const t0 = Date.now();
      const url = serveur.urlAvecCompte('prive');
      await miroir.rafraichir('p', url, t0);
      // Ce qu'écrivait la version d'avant : l'URL authentifiée en `origin`.
      const config = path.join(miroir.dossier('p'), '.git', 'config');
      execFileSync('git', ['config', '--file', config, 'remote.origin.url', url]);
      await miroir.rafraichir('p', url, t0 + 10 * FENETRE_RAFRAICHISSEMENT_MS);
      expect(fichiersAvec(miroir.dossier('p'), serveur.compte.motDePasse)).toEqual([]);
      expect((await miroir.lire('p', 'LISEZMOI.md')).contenu).toBe('# Privé\n');
    },
  );
});
