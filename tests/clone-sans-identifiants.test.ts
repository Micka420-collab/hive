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
//     un `git push` lancé depuis l'espace de travail le retrouvait là ;
//   · l'argv de l'assistant de transport (`git-remote-http origin
//     http://marie:…@…`) se lisait de toute la machine, `/proc/<pid>/cmdline`
//     — même quand une règle `insteadOf` cachait l'URL au git lancé.
//
// La politique d'actions de G12 juge la FORME des commandes ; elle ne contient
// pas un agent hostile. L'enceinte doit être structurelle — c'est ce que ces
// bancs tiennent, contre un vrai git et un vrai serveur HTTP Git qui exige le
// compte du projet, en lecture comme en poussée (`aide/serveur-git.ts`) :
//
//   1. après préparation — tâche neuve, reprise d'une PR, clone de merge ou de
//      chantier —, ni `.git/config`, ni aucun fichier du clone ou du registre,
//      ni l'environnement de l'agent, ni l'assistant du membre ne contiennent
//      le jeton ; et pendant le clone comme la poussée, aucun argv ;
//   2. un `git push` lancé depuis l'espace de travail ne trouve rien de ce que
//      la ruche a reçu — même avec le HOME du membre, tant qu'aucune version
//      précédente n'y a rien déposé (`hive doctor` le cherche) ;
//   3. la livraison locale pousse quand même, avec le compte du projet ;
//   4. aucun message d'échec ne cite le jeton — pas même renvoyé nu par le
//      serveur —, un jeton refusé dit quoi changer, et la porte git refuse
//      des identifiants en argument, ou un git trop ancien pour les porter ;
//   5. le miroir de la Reine passe par la même porte, et s'en trouve mieux :
//      un jeton renouvelé y sert au rafraîchissement suivant, et celui qu'une
//      version précédente avait écrit quitte le disque sans attendre l'amont.
//
// Les assistants du MEMBRE journalisent chacun de leurs appels : tout banc qui
// passe par l'accès d'un projet exige qu'il n'y en ait eu AUCUN (`confieAuMembre`).

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
import {
  EchecGitHote,
  depotDistant,
  gitHote,
  porteDesIdentifiants,
} from '../src/shared/git-protege.js';
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
/** Le HOME du MEMBRE : un assistant `store`, et un assistant qui journalise ses appels. */
let membre: string;
let serveur: ServeurGit;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', [...REGLAGES_BANC, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Où l'assistant journaliste du membre écrit chacun de ses appels. */
const appelsDuMembre = (): string => path.join(membre, 'appels.log');

beforeAll(async () => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-clone-sans-identifiants-'));
  projets = path.join(racine, 'projets');
  travail = path.join(racine, 'travail');
  membre = path.join(racine, 'membre');
  mkdirSync(projets, { recursive: true });
  mkdirSync(membre, { recursive: true });
  // Deux assistants, comme un poste réel en a parfois : `store`, qui écrit en
  // clair ce que git lui confie, et un journaliste — chaque `get`, `store` ou
  // `erase` qu'il reçoit laisse une ligne. Le chemin en barres obliques et
  // entre apostrophes : c'est `sh` qui l'ouvre, Git for Windows compris. La
  // valeur entre guillemets : `;` ouvrirait un commentaire de gitconfig.
  const journal = appelsDuMembre().replaceAll('\\', '/');
  writeFileSync(
    path.join(membre, '.gitconfig'),
    `[credential]\n\thelper = store\n\thelper = "!f() { echo appel-$1 >> '${journal}'; }; f"\n`,
  );
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
// membre, assistants compris. Effacé après chaque banc — un banc rouge ne
// doit pas en faire rougir un autre.
beforeEach(() => {
  vi.stubEnv('HOME', membre);
  vi.stubEnv('USERPROFILE', membre);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(path.join(membre, '.git-credentials'), { force: true });
  rmSync(appelsDuMembre(), { force: true });
  serveur.pendantRequete = null;
});

// ─── LES OUTILS DU BANC ──────────────────────────────────────────────────────

const tache = (id: string, branch: string | null = null): Task =>
  ({ id, title: id, prompt: 'x', branch }) as Task;

/**
 * Ce que les assistants du membre ont reçu : ce que `store` a écrit, et
 * chaque appel du journaliste — vide s'ils n'ont rien reçu.
 */
function confieAuMembre(): string {
  const lire = (f: string): string => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  return lire(path.join(membre, '.git-credentials')) + lire(appelsDuMembre());
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

/** Le compte du serveur le temps d'un banc — un jeton révoqué ou renouvelé. */
async function avecLeCompte<T>(compte: ServeurGit['compte'], corps: () => Promise<T>): Promise<T> {
  const avant = serveur.compte;
  serveur.compte = compte;
  try {
    return await corps();
  } finally {
    serveur.compte = avant;
  }
}

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

  // TOUT `userinfo` d'une adresse HTTP(S) est le compte du PROJET — son URL
  // est la même pour chaque membre. Un nom seul est un jeton au mot de passe
  // vide (la forme de GitHub) : les assistants du membre sont écartés aussi.
  it.each([
    ['https://marie:jeton@github.com/o/r.git', 'https://github.com/o/r.git', 'marie', 'jeton'],
    ['https://u:p@ss@hote/d.git', 'https://hote/d.git', 'u', 'p@ss'],
    ['https://u:p%40ss%3A@hote/d.git', 'https://hote/d.git', 'u', 'p@ss:'],
    ['https://ghp_nom@github.com/o/r.git', 'https://github.com/o/r.git', 'ghp_nom', ''],
    ['HTTP://x:y@Hote:8080/d.git', 'HTTP://Hote:8080/d.git', 'x', 'y'],
  ] as const)('%s → %s, compte du projet %s / %s', (url, nue, nom, secret) => {
    const { nue: vue, acces } = depotDistant(url);
    expect(vue).toBe(nue);
    const hote = /^https?:\/\/[^/]*/i.exec(nue)?.[0] ?? '';
    expect(reglages(acces)).toEqual({
      [`url.${nue}.insteadOf`]: nue,
      [`url.${nue}.pushInsteadOf`]: nue,
      'credential.helper': '',
      [`credential.${hote}.helper`]: expect.stringMatching(
        /^!f\(\) \{ test "\$1" != get \|\| printf/,
      ),
    });
    expect(acces.HIVE_DEPOT_NOM).toBe(nom);
    expect(acces.HIVE_DEPOT_SECRET).toBe(secret);
    // Ni l'adresse authentifiée, ni le secret, dans une CLÉ ou une valeur de
    // configuration : une clé fautive, git la cite entière dans son erreur.
    const configuration = JSON.stringify(reglages(acces));
    expect(configuration).not.toContain(url.slice(0, url.lastIndexOf('@') + 1));
    if (secret !== '') expect(configuration).not.toContain(secret);
  });

  it.each([
    'ssh://git@github.com/o/r.git',
    'git@github.com:o/r.git',
    'https://hote/chemin@v2/d.git',
    'https://github.com/o/r.git',
  ])('%s : rien à cacher, rien ne change', (url) => {
    expect(depotDistant(url)).toEqual({ nue: url, acces: {} });
  });

  it.each([
    ['un saut de ligne encodé dans le mot de passe', 'https://u:a%0Ab@hote/d.git', 'a%0Ab'],
    [
      'un mot de passe sans nom (git n’envoie pas de compte au nom vide)',
      'https://:secret-sans-nom@hote/d.git',
      'secret-sans-nom',
    ],
  ])('refuse %s — sans citer l’adresse', (_cas, url, secret) => {
    let echec: unknown = null;
    try {
      depotDistant(url);
    } catch (e) {
      echec = e;
    }
    expect(echec).toBeInstanceOf(Error);
    expect((echec as Error).message).toMatch(/recréez le projet/);
    expect((echec as Error).message).not.toContain(secret);
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

  it(
    'le jeton À LA PLACE DU NOM (`http://<jeton>@…`) est le compte du projet : il ouvre, et aucun assistant du membre n’est appelé',
    PLAFOND,
    () =>
      // Le serveur n'accepte que « <jeton>: » — un jeton au mot de passe vide.
      avecLeCompte(
        { utilisateur: 'ghp_jetonAlaPlaceDuNom0123456789', motDePasse: '' },
        async () => {
          const clone = path.join(racine, 'clones', 'nom-seul');
          await cloneRepo(clone, serveur.urlAvecCompte('prive', ''));
          expect(origineDe(path.join(clone, '.git'))).toBe(serveur.url('prive'));
          expect(fichiersAvec(clone, serveur.compte.utilisateur)).toEqual([]);
          expect(confieAuMembre()).toBe('');
        },
      ),
  );

  it(
    'le même jeton-nom REFUSÉ : l’échec le dit, et toujours aucun appel aux assistants du membre',
    PLAFOND,
    async () => {
      // Mesuré avant le correctif : traité comme un nom, le jeton partait en
      // `username=` à chaque assistant du membre dès que le dépôt le refusait.
      const jetonNom = 'ghp_jetonRevoqueAlaPlaceDuNom0123456';
      const url = serveur.url('prive').replace('http://', `http://${jetonNom}@`);
      const echec = await echecDe(cloneRepo(path.join(racine, 'clones', 'nom-refuse'), url));
      expect(echec).toBeInstanceOf(EchecGitHote);
      expect((echec as Error).message).toMatch(/le dépôt refuse le jeton de l’URL du projet/);
      expect((echec as Error).message).not.toContain(jetonNom);
      expect(confieAuMembre(), 'les assistants du membre n’ont rien reçu').toBe('');
    },
  );
});

// ─── 1 bis. NI DANS L'ARGV, PENDANT LE TRANSPORT ─────────────────────────────

describe('pendant le clone et la poussée, aucun argv de la machine ne porte le jeton', () => {
  /**
   * Toute la table des processus, telle que n'importe quel compte de la
   * machine la lit : `/proc/<pid>/cmdline` est en mode 444.
   */
  function argvDeLaMachine(): string[] {
    return readdirSync('/proc')
      .filter((p) => /^\d+$/.test(p))
      .flatMap((p) => {
        try {
          return [readFileSync(`/proc/${p}/cmdline`, 'utf8').replaceAll('\0', ' ')];
        } catch {
          return []; // sorti entre la liste et la lecture
        }
      });
  }

  it.skipIf(process.platform !== 'linux')(
    'lue À L’ARRIVÉE de chaque requête — clone, `ls-remote` et poussée de la livraison',
    PLAFOND,
    async () => {
      const secret = serveur.compte.motDePasse;
      // Chaque requête : le service demandé, l'argv du transport qui l'envoie,
      // et ceux qui portent le secret. Le serveur ne répond qu'APRÈS : le git
      // qui attend sa réponse, et son assistant de transport, sont vivants.
      const vues: { service: string; transport: boolean; fuites: string[] }[] = [];
      serveur.pendantRequete = (req) => {
        const argv = argvDeLaMachine();
        vues.push({
          service: /git-(upload|receive)-pack/.exec(req.url ?? '')?.[0] ?? '?',
          transport: argv.some(
            (a) => a.includes('remote-http') && a.includes(serveur.url('prive')),
          ),
          fuites: argv.filter((a) => a.includes(secret)),
        });
      };
      const repoDir = path.join(racine, 'merges', 'argv');
      await cloneRepo(repoDir, serveur.urlAvecCompte('prive'));
      const res = await runMerge({
        repoDir,
        diffs: [
          {
            taskId: 'ta',
            diff:
              'diff --git a/argv.md b/argv.md\nnew file mode 100644\n--- /dev/null\n+++ b/argv.md\n' +
              '@@ -0,0 +1 @@\n+livré\n',
          },
        ],
        livraison: {
          demande: {
            projectId: 'argv',
            pousser: true,
            provenance: [{ taskId: 'ta', resultId: 1, decision: 'accepted' }],
          },
          depotProjet: serveur.urlAvecCompte('prive'),
          depotLocal: path.join(racine, 'livraisons', 'argv.git'),
          pousseeConsentie: true,
        },
      });
      expect(res.livraison, res.logs).toMatchObject({ etat: 'commitee', poussee: 'poussee' });
      // La sonde a VU le transport, en lecture comme en poussée : elle ne
      // passe pas pour vide parce qu'elle aurait regardé trop tôt.
      expect(vues.some((v) => v.service === 'git-upload-pack' && v.transport)).toBe(true);
      expect(vues.some((v) => v.service === 'git-receive-pack' && v.transport)).toBe(true);
      expect(vues.flatMap((v) => v.fuites)).toEqual([]);
    },
  );
});

// ─── 2. LE PUSH DE L'AGENT NE TROUVE RIEN DE CE QUE LA RUCHE A REÇU ──────────

describe('un `git push` de l’agent échoue faute d’identifiants', () => {
  it(
    'lancé depuis l’espace de travail, avec l’environnement de l’agent ET le HOME du membre (rien n’y a été déposé) : refusé, rien n’arrive',
    PLAFOND,
    async () => {
      const ws = await prepareWorkspace(travail, tache('agent'), serveur.urlAvecCompte('prive'));
      const envAgent = {
        ...ws.env,
        // Au niveau `processus`, l'agent atteint le HOME du membre : on le lui
        // donne, assistants compris. Ce banc tient pour un HOME où aucune
        // version précédente de Hive n'a déposé le jeton — sinon `store` le
        // rendrait, et c'est `hive doctor` qui le signale.
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
      // Le témoin des « aucun appel » de ce fichier : SON git, à elle, a bien
      // interrogé les assistants du membre — qui n'avaient rien à lui donner.
      // Sans cette ligne, un journaliste muet sur une plateforme ferait passer
      // tous les autres bancs pour de bonnes raisons qui n'en sont pas.
      expect(confieAuMembre()).toMatch(/appel-get/);
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
    'la branche de mission arrive sur le dépôt ; ni le dépôt durable ni les assistants du membre ne gardent le jeton',
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
    'les réécritures du MEMBRE vers son SSH (`insteadOf`, `pushInsteadOf` sur l’hôte) ne détournent ni le clone ni la poussée',
    PLAFOND,
    async () => {
      // Un réglage courant (`url.git@github.com:.insteadOf https://github.com/`).
      // Sans les règles IDENTITÉ de `depotDistant`, plus longues, le clone
      // partait vers ce SSH-là, sous l'identité du membre — ici, un port fermé.
      const config = path.join(membre, '.gitconfig');
      const avant = readFileSync(config, 'utf8');
      const hote = serveur.url('prive').replace(/prive\.git$/, '');
      writeFileSync(
        config,
        `${avant}[url "ssh://git@127.0.0.1:1/"]\n\tinsteadOf = ${hote}\n\tpushInsteadOf = ${hote}\n`,
      );
      try {
        const { res } = await livrer('reecrit', serveur.urlAvecCompte('prive'));
        expect(res.livraison, res.logs).toMatchObject({ etat: 'commitee', poussee: 'poussee' });
        expect(referencesDuServeur()).toContain('refs/heads/hive/mission-reecrit-1');
        expect(confieAuMembre()).toBe('');
      } finally {
        writeFileSync(config, avant);
      }
    },
  );

  it(
    'un jeton de LECTURE : la poussée échoue, le motif dit quoi changer — sans le jeton',
    PLAFOND,
    async () => {
      serveur.lectureSeule = true;
      try {
        const { res } = await livrer('lecture', serveur.urlAvecCompte('prive'));
        expect(res.livraison, res.logs).toMatchObject({ etat: 'commitee', poussee: 'echec' });
        if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
        expect(res.livraison.motif).toMatch(/403/);
        expect(res.livraison.motif).toMatch(/le dépôt refuse le jeton de l’URL du projet/);
        expect(JSON.stringify(res)).not.toContain(serveur.compte.motDePasse);
        expect(confieAuMembre()).toBe('');
      } finally {
        serveur.lectureSeule = false;
      }
    },
  );

  it(
    'un jeton RÉVOQUÉ après le clone : rien n’est commité, le motif dit quoi changer — sans le jeton',
    PLAFOND,
    async () => {
      const ancien = serveur.urlAvecCompte('prive');
      const clone = path.join(racine, 'merges', 'revoque');
      await cloneRepo(clone, ancien);
      const motDePasse = serveur.compte.motDePasse;
      const { res } = await avecLeCompte(
        { ...serveur.compte, motDePasse: `${motDePasse}-renouvele` },
        () => livrer('revoque', ancien, clone),
      );
      expect(res.livraison).toMatchObject({
        etat: 'non_commitee',
        motif: expect.stringMatching(
          /le dépôt refuse le jeton de l’URL du projet.*recréez le projet/,
        ),
      });
      expect(JSON.stringify(res)).not.toContain(motDePasse);
      expect(
        confieAuMembre(),
        'un refus n’efface rien chez le membre, ni ne lui demande rien',
      ).toBe('');
    },
  );
});

// ─── 4. LA PORTE GIT ─────────────────────────────────────────────────────────

describe('la porte git — aucun identifiant n’entre, aucun ne ressort', () => {
  it.each([
    ['une URL HTTP(S) avec compte', (s: ServeurGit) => ['ls-remote', s.urlAvecCompte('prive')]],
    [
      'une URL HTTP(S) au jeton-nom',
      (s: ServeurGit) => ['ls-remote', s.urlAvecCompte('prive', '')],
    ],
    [
      'une URL SSH avec mot de passe',
      () => ['ls-remote', 'ssh://moi:jeton-ssh@hote.invalid/d.git'],
    ],
    [
      'un en-tête `http.extraHeader` en `-c`',
      () => ['-c', 'http.extraHeader=Authorization: Basic am9objpqZXRvbg==', 'ls-remote', 'x'],
    ],
    [
      'un en-tête `http.<url>.extraheader` en `git config`',
      () => ['config', 'http.https://hote.invalid/.extraheader', 'Authorization: Bearer jeton-xh'],
    ],
  ])('refuse %s en argument, avant de lancer git, sans le citer', async (_cas, args) => {
    const avant = serveur.requetes;
    const argv = args(serveur);
    const echec = await echecDe(gitHote(argv, racine));
    expect(echec).toBeInstanceOf(EchecGitHote);
    expect((echec as Error).message).toMatch(/refusé — des identifiants en argument/);
    for (const secret of [serveur.compte.motDePasse, 'jeton-ssh', 'am9objpqZXRvbg', 'jeton-xh']) {
      expect((echec as Error).message).not.toContain(secret);
    }
    expect(serveur.requetes).toBe(avant);
  });

  it('ne refuse que ce qui OUVRE un dépôt : un compte SSH, une adresse nue, une référence passent', () => {
    // `ssh://git@…` et `git@hôte:` nomment un compte : c'est la clé du membre
    // qui ouvre. Un `@` dans le CHEMIN n'est pas un `userinfo`.
    for (const arg of [
      'ssh://git@hote:22/d.git',
      'git@github.com:o/r.git',
      'https://hote/chemin@v2/d.git',
      'https://hote:8443/d.git',
      'file:///tmp/depot',
      'HEAD:refs/heads/vol',
      '+refs/hive/livraison:refs/hive/livraison',
      '--branch=hive/mission-x-1',
      'http.lowSpeedTime=120',
    ]) {
      expect(porteDesIdentifiants(arg), arg).toBe(false);
    }
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

  it(
    'masque le jeton NU qu’un serveur renvoie — mot pour mot, hors de toute adresse',
    PLAFOND,
    async () => {
      // Un crochet du dépôt servi qui recopie le compte qu'il a reçu : le
      // lavage des adresses ne le voit pas, il n'est dans aucune URL.
      const bavard = path.join(projets, 'bavard.git');
      git(racine, 'clone', '--bare', '-q', path.join(projets, 'prive.git'), bavard);
      const crochet = path.join(bavard, 'hooks', 'pre-receive');
      writeFileSync(
        crochet,
        `#!/bin/sh\necho "refusé pour le compte ${serveur.compte.motDePasse}" >&2\nexit 1\n`,
      );
      chmodSync(crochet, 0o755);
      const clone = path.join(racine, 'clones', 'bavard');
      const { nue, acces } = depotDistant(serveur.urlAvecCompte('bavard'));
      await cloneRepo(clone, serveur.urlAvecCompte('bavard'));
      const depot = { gitDir: path.join(clone, '.git'), workTree: clone };
      const echec = await echecDe(gitHote(['push', nue, 'HEAD:refs/heads/x'], depot, { acces }));
      expect(echec).toBeInstanceOf(EchecGitHote);
      expect((echec as Error).message).toContain('refusé pour le compte ***');
      expect((echec as Error).message).not.toContain(serveur.compte.motDePasse);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'un git antérieur à 2.31 IGNORERAIT l’accès : refusé, en le disant, avant toute requête',
    PLAFOND,
    async () => {
      // Sous 2.31, `GIT_CONFIG_COUNT` n'est pas lu : git clonerait l'adresse
      // nue avec les assistants du membre, sous SON identité, sans un mot. Un
      // faux git en tête du PATH le joue — s'il était lancé, son « clone »
      // réussirait sans rien faire, et ce banc rougirait.
      const vieux = path.join(racine, 'vieux-git');
      mkdirSync(vieux, { recursive: true });
      writeFileSync(path.join(vieux, 'git'), '#!/bin/sh\necho "git version 2.30.9"\n');
      chmodSync(path.join(vieux, 'git'), 0o755);
      vi.stubEnv('PATH', `${vieux}${path.delimiter}${process.env.PATH ?? ''}`);
      const avant = serveur.requetes;
      const echec = await echecDe(
        cloneRepo(path.join(racine, 'clones', 'vieux-git'), serveur.urlAvecCompte('prive')),
      );
      expect(echec).toBeInstanceOf(EchecGitHote);
      expect((echec as Error).message).toMatch(/git 2\.30\.9 ignore l’accès/);
      expect((echec as Error).message).toMatch(/mettez git à jour/);
      expect((echec as Error).message).not.toContain(serveur.compte.motDePasse);
      expect(serveur.requetes).toBe(avant);
    },
  );
});

// ─── 5. LE MIROIR DE LA REINE ────────────────────────────────────────────────

describe('le miroir de la Reine — la même porte, le même invariant', () => {
  const miroirNeuf = (journal?: (projet: string, message: string) => void): Miroir =>
    new Miroir(mkdtempSync(path.join(racine, 'rayons-')), journal);

  it(
    'clone l’adresse nue : ni sa configuration ni les assistants de l’hôte ne gardent le jeton',
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
      await avecLeCompte(
        { ...serveur.compte, motDePasse: `${serveur.compte.motDePasse}-neuf` },
        async () => {
          await miroir.rafraichir(
            'p',
            serveur.urlAvecCompte('prive'),
            t0 + 10 * FENETRE_RAFRAICHISSEMENT_MS,
          );
          expect((await miroir.lire('p', 'NOUVEAU.md')).contenu).toBe('après le renouvellement\n');
        },
      );
    },
  );

  it(
    'un miroir d’avant, dont la configuration porte le jeton, est réparé SUR PLACE — même quand l’amont le refuse — et c’est journalisé',
    PLAFOND,
    async () => {
      const journal: string[] = [];
      const miroir = miroirNeuf((projet, message) => journal.push(`${projet} : ${message}`));
      const t0 = Date.now();
      const url = serveur.urlAvecCompte('prive');
      const motDePasse = serveur.compte.motDePasse;
      await miroir.rafraichir('p', url, t0);
      // Ce qu'écrivait la version d'avant : l'URL authentifiée en `origin`.
      const config = path.join(miroir.dossier('p'), '.git', 'config');
      execFileSync('git', ['config', '--file', config, 'remote.origin.url', url]);
      expect(fichiersAvec(miroir.dossier('p'), motDePasse)).toEqual([path.join('.git', 'config')]);
      // L'amont ne l'accepte plus (jeton révoqué) : un reclone échouerait, et
      // laissait le jeton sur le disque à chaque essai. La réparation, elle,
      // ne lui demande rien.
      await avecLeCompte({ ...serveur.compte, motDePasse: `${motDePasse}-revoque` }, async () => {
        await expect(
          miroir.rafraichir('p', url, t0 + 10 * FENETRE_RAFRAICHISSEMENT_MS),
        ).rejects.toThrow(/le dépôt refuse le jeton/);
      });
      expect(fichiersAvec(miroir.dossier('p'), motDePasse)).toEqual([]);
      expect(origineDe(path.join(miroir.dossier('p'), '.git'))).toBe(serveur.url('prive'));
      // La copie d'hier est toujours là pour le Rayon : réparée, pas refaite.
      expect((await miroir.lire('p', 'LISEZMOI.md')).contenu).toBe('# Privé\n');
      expect(journal).toEqual([expect.stringMatching(/^p : identifiants retirés/)]);
    },
  );

  it(
    'le voisin de reclone qu’une Reine d’avant a laissé — jeton dans sa configuration — part au rafraîchissement suivant, même sans reclone',
    PLAFOND,
    async () => {
      const miroir = miroirNeuf();
      const t0 = Date.now();
      const url = serveur.urlAvecCompte('prive');
      await miroir.rafraichir('p', url, t0);
      // Une Reine d'avant, arrêtée en plein reclone : son voisin `.neuf-p`
      // avait été cloné avec l'URL authentifiée.
      const voisin = path.join(path.dirname(miroir.dossier('p')), '.neuf-p');
      mkdirSync(path.join(voisin, '.git'), { recursive: true });
      writeFileSync(path.join(voisin, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`);
      // Le miroir est reprenable : le rafraîchissement ne reclone pas.
      await miroir.rafraichir('p', url, t0 + 10 * FENETRE_RAFRAICHISSEMENT_MS);
      expect(existsSync(voisin)).toBe(false);
      expect(fichiersAvec(path.dirname(miroir.dossier('p')), serveur.compte.motDePasse)).toEqual(
        [],
      );
    },
  );
});
