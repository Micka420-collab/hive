// Préparation du répertoire de travail d'une tâche.
//
// Ce que CE fichier fournit : un cwd dédié par tâche, un environnement épuré
// (pas de HOME/USERPROFILE ni variables du membre), TEMP redirigé dans la
// tâche, une branche git `hive/<taskId>` quand le projet a un dépôt — et le
// diff de revue, calculé par le git dir de la RUCHE, jamais par le `.git` que
// l'agent a eu entre les mains (`git-hote.ts`).
//
// ─── CE N'EST PAS TOUT L'ISOLEMENT, ET CE COMMENTAIRE L'A CRU LONGTEMPS ──────
//
// Il annonçait « pas encore de VM/conteneur » et promettait Firecracker « à
// l'itération suivante ». Les deux affirmations sont fausses aujourd'hui :
//
//   · `isolement.ts` EXISTE et enveloppe l'agent dans podman, docker ou
//     bubblewrap — au niveau `conteneur`, l'agent ne voit que le répertoire
//     préparé ici, ni le HOME du membre ni ses clés ;
//   · Firecracker est REFUSÉ, avec sa raison, par l'ADR 0009 (pas de KVM sur
//     macOS, Windows 11 + virtualisation imbriquée + droits admin contre
//     « aucun sudo, jamais »).
//
// Ce qui reste vrai : SANS moteur de conteneurs, il ne reste que ce
// répertoire-ci, et le disque entier demeure lisible sous l'utilisateur du
// membre. C'est le niveau `processus` de `constat()`, et c'est là — pas ici —
// que la vérité de l'isolement s'écrit.

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { CLONE_MS } from '../shared/butoirs-noeud.js';
import type { Task } from '../shared/types.js';
import { EchecGitHote, commandeSshDuMembre, gitHote } from '../shared/git-protege.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import { commitDeDepart, diffContreBase, poserRegistre } from './git-hote.js';

export interface Workspace {
  /** Répertoire de travail isolé de la tâche. */
  cwd: string;
  branch: string | null;
  /**
   * Le commit CLONÉ, épinglé avant que l'agent ne touche à rien ; `null` sans
   * dépôt, ou pour un dépôt sans commit.
   *
   * Pas « HEAD au moment où on le demande » : l'agent écrit dans ce dépôt, et
   * un `git commit` de sa part déplace HEAD. Relu après coup, HEAD nommerait
   * le commit de l'agent comme « base » — et ce qu'il y a committé
   * disparaîtrait du diff comme des déclarations que le bac compare.
   */
  baseSha: string | null;
  /**
   * Le dépôt ÉPINGLÉ sur le registre de la ruche (`git-hote.ts`) — la SEULE
   * porte par laquelle l'hôte relit ce dépôt après l'agent (diff, validations
   * du bac) ; `null` sans dépôt.
   */
  depot: DepotEpingle | null;
  /** Environnement épuré pour les processus enfants. */
  env: NodeJS.ProcessEnv;
  /** Diff des modifications, pour revue humaine (vide sans dépôt git). */
  collectDiff(): Promise<string>;
  /** Supprime le répertoire de la tâche. */
  cleanup(): void;
}

/** Secrets de la ruche qui ne doivent jamais devenir des variables d'agent. */
const SECRETS_INTERDITS_AGENT = new Set([
  'HIVE_TOKEN',
  'HIVE_JWT_SECRET',
  'HIVE_INVITE',
  'HIVE_GITHUB_TOKEN',
  'HIVE_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
]);

/** La file de chaque registre : le dernier geste en cours, que le suivant attend. */
const filesDesRegistres = new WeakMap<DepotEpingle, Promise<unknown>>();

/**
 * UN SEUL GIT À LA FOIS SUR L'INDEX D'UN REGISTRE. `diffContreBase` et le
 * garde `.npmrc` des validations écrivent cet index (`add --intent-to-add`),
 * `clean` retire des fichiers pendant qu'un `add --all` les parcourrait. Deux
 * gestes croisés — un diff demandé en direct (Sandbox Live) pendant le diff du
 * résultat ou pendant les validations — trouvaient `index.lock` : l'échec
 * emportait le diff remis à la revue, ou rendait toutes les validations
 * `interrompue`. Un clic en lecture ne défait pas un verdict.
 *
 * Par REGISTRE (l'objet épinglé, partagé par l'exécution, son diff et ses
 * validations), pas par appelant : une file par appelant ne sérialisait que
 * ses propres gestes. Un geste qui échoue ne bloque pas la file.
 */
export function sousVerrouIndex<T>(depot: DepotEpingle, geste: () => Promise<T>): Promise<T> {
  const suite = (filesDesRegistres.get(depot) ?? Promise.resolve()).then(geste, geste);
  filesDesRegistres.set(
    depot,
    suite.catch(() => undefined),
  );
  return suite;
}

/**
 * Retire du répertoire d'une tâche tout ce que git IGNORE — `node_modules`,
 * sorties de build, `.env`. Par le registre (`git-hote.ts`) : un
 * `.git/info/exclude` que l'agent aurait écrit n'y est pas lu, et ce qu'il
 * cacherait reste donc dans le diff, sous les yeux de la revue.
 *
 * Les validations du bac jugent la BASE plus le DIFF, exactement ce qu'une
 * livraison ou un merge appliquera. Un fichier ignoré n'est dans aucun des
 * deux : c'est l'environnement que l'agent s'est fabriqué, hors de la vue de
 * tout relecteur. Un `node_modules/.bin/node` qui rend 0, laissé par l'agent
 * dans un projet sans dépendances, faisait passer des tests qui échouent
 * partout ailleurs — `npm run` met ce dossier en tête du PATH.
 *
 * Les fichiers SUIVIS ne bougent pas (`-X` ne vise que les ignorés), et le
 * diff a déjà été calculé : rien de ce qui est livré ne change. L'écriture vit
 * ICI parce que ce fichier possède le répertoire de tâche : l'inventaire de ce
 * que Hive écrit sur la machine d'un membre (`empreinte.ts`) reste vrai.
 */
export async function retirerFichiersIgnores(depot: DepotEpingle): Promise<void> {
  // `-ff` : aussi les dépôts imbriqués ignorés ; `-d` : les dossiers entiers.
  await sousVerrouIndex(depot, () => gitHote(['clean', '-ffdX'], depot));
}

export function variablesAgentSansSecrets(variables: readonly string[]): string[] {
  return variables.filter((name) => !SECRETS_INTERDITS_AGENT.has(name));
}

/**
 * Environnement minimal pour la sandbox v0. Seuls PATH et les variables
 * système indispensables passent ; `keepEnv` permet d'ajouter explicitement
 * des variables nécessaires à un agent réel (ex. ANTHROPIC_API_KEY). Les
 * secrets de la ruche restent exclus même si `keepEnv` les nomme ; ils restent
 * locaux au nœud, jamais transmis au CLI ni au hub.
 */
export function buildSandboxEnv(cwd: string, keepEnv: string[] = []): NodeJS.ProcessEnv {
  // TEMP vit À CÔTÉ du workspace, pas dedans : le clone git exige un répertoire
  // vide et le diff de revue ne doit pas être pollué par des fichiers temporaires.
  const tmp = `${cwd}.tmp`;
  mkdirSync(tmp, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    // Indispensables à beaucoup d'outils Windows ; inoffensifs ailleurs.
    SYSTEMROOT: process.env.SYSTEMROOT,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    TEMP: tmp,
    TMP: tmp,
    TMPDIR: tmp,
    HIVE_TASK_CWD: cwd,
  };
  for (const name of variablesAgentSansSecrets(keepEnv)) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * Clone superficiel d'un dépôt dans `dir` (vide ou inexistant) — la même porte
 * que le clone d'une tâche : environnement épuré, `ext::` neutralisé, aucune
 * invite (ni de git, ni de GCM, ni de `ssh`). Voir `git-hote.ts` : c'est aussi
 * l'environnement de la livraison locale, qui POUSSE avec exactement les
 * identifiants qui ont servi au clone (`livraison-locale.ts`).
 *
 * ─── BORNÉ, PARCE QUE LE HUB COMPTE DESSUS ─────────────────────────────────
 *
 * Ce clone ouvre chaque merge, chaque chantier et chaque tâche, et il n'avait
 * aucun butoir : un dépôt qui accepte la connexion puis se tait laissait le
 * travail pendre chez le nœud, sans résultat, pendant que le hub — qui dérive
 * ses délais des butoirs du nœud (`butoirs-noeud.ts`) — ne pouvait que DEVINER
 * sa durée. Au-delà de `delaiMs`, git est TUÉ (le `timeout` d'`execFile`,
 * `gitHote`), et le travail échoue en le disant. Un `Promise.race` rendrait la
 * main en laissant le processus pendre derrière.
 *
 * Limite, dite : c'est le processus LANCÉ qui est tué. Sous Windows, où le `git`
 * du PATH est d'ordinaire un lanceur, le vrai git peut lui survivre jusqu'à ce
 * que le dépôt ferme (mesuré, `tests/clone-borne.test.ts`) — la limite de tout
 * `child.kill()` du nœud. Le travail, lui, échoue à l'heure partout.
 */
export async function cloneRepo(dir: string, repoUrl: string, delaiMs = CLONE_MS): Promise<void> {
  const parent = path.dirname(path.resolve(dir));
  // git crée lui-même les dossiers de `dir`, mais il se LANCE depuis `parent`
  // (`gitHote`) : absent, le clone mourait en « spawn git ENOENT ».
  mkdirSync(parent, { recursive: true });
  const ssh = await commandeSshDuMembre(parent);
  try {
    // `--` : une URL qui commencerait par un tiret ne devient pas une option.
    await gitHote(['clone', '--depth', '1', '--', repoUrl, dir], parent, { ssh, delaiMs });
  } catch (err) {
    if (!(err instanceof EchecGitHote && err.delaiDepasse)) throw err;
    const duree =
      delaiMs >= 60_000 ? `${Math.round(delaiMs / 60_000)} min` : `${Math.ceil(delaiMs / 1000)} s`;
    throw new Error(`clone abandonné après ${duree} — dépôt injoignable ou muet`, { cause: err });
  }
}

export async function prepareWorkspace(
  workRoot: string,
  task: Task,
  repoUrl: string | null,
  keepEnv: string[] = [],
  // Suffixe d'instance (nodeId court) : deux nœuds partageant le même workRoot
  // (démo/tests locaux) peuvent exécuter la MÊME tâche en parallèle (Drone
  // Wars) sans se détruire mutuellement le répertoire.
  instanceId = '',
): Promise<Workspace> {
  const tasksRoot = path.resolve(workRoot, 'tasks');
  const dirName = instanceId ? `${task.id}-${instanceId}` : task.id;
  const cwd = path.resolve(tasksRoot, dirName);
  // Confinement strict : le cwd DOIT rester sous <workRoot>/tasks. Défense en
  // profondeur contre un task.id malveillant (« ../… » ou chemin absolu) qui
  // ferait pointer rmSync/clone hors du répertoire de travail. La validation
  // de task.id (ID_PATTERN) côté client et protocole est la première barrière ;
  // ceci en est la seconde, au plus près du sink destructeur.
  if (cwd !== tasksRoot && !cwd.startsWith(tasksRoot + path.sep)) {
    throw new Error(`chemin de tâche hors du répertoire de travail : ${task.id}`);
  }
  // Le REGISTRE de la ruche (`git-hote.ts`) : le git dir que l'hôte lit, À
  // CÔTÉ de la tâche comme son TEMP — hors de ce que le bac monte.
  const registre = `${cwd}.git`;
  // Repartir d'un répertoire vierge à chaque tentative. maxRetries absorbe les
  // verrous transitoires de fichiers sous Windows (antivirus, handle git résiduel)
  // qui, sinon, feraient échouer la tâche à durée nulle et brûleraient un essai.
  const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
  rmSync(cwd, rmOpts);
  rmSync(`${cwd}.tmp`, rmOpts);
  rmSync(registre, rmOpts);
  mkdirSync(cwd, { recursive: true });

  let branch: string | null = null;
  let baseSha: string | null = null;
  let depot: DepotEpingle | null = null;
  if (repoUrl) {
    // Le clone exige un répertoire vide : il précède toute écriture dans cwd.
    // Tout ce qui suit, jusqu'à `poserRegistre`, se passe AVANT l'agent, dans
    // un dépôt que seul git a écrit.
    await cloneRepo(cwd, repoUrl);
    const depotDuClone = { gitDir: path.join(cwd, '.git'), workTree: cwd };
    // Une tâche = une branche isolée. Jamais de travail direct sur main (§5.2).
    branch = task.branch ?? `hive/${task.id}`;
    await gitHote(['checkout', '-q', '-b', branch], depotDuClone);
    baseSha = await commitDeDepart(depotDuClone);
    depot = await poserRegistre(cwd, registre, baseSha);
  }

  const env = buildSandboxEnv(cwd, keepEnv);

  return {
    cwd,
    branch,
    baseSha,
    depot,
    env,
    collectDiff(): Promise<string> {
      // Par le registre, jamais par le `.git` de la tâche : c'est l'agent qui
      // l'a eu entre les mains (git-hote.ts). CONTRE LA BASE ÉPINGLÉE, pas
      // contre l'index : ce que l'agent a `git add` ou committé reste dans la
      // revue, la livraison et le merge. Sous le verrou du registre : un diff
      // demandé en direct croise celui du résultat ou les validations.
      if (!depot) return Promise.resolve('');
      const epingle = depot;
      return sousVerrouIndex(epingle, () => diffContreBase(epingle, baseSha));
    },
    cleanup(): void {
      try {
        rmSync(cwd, rmOpts);
        rmSync(`${cwd}.tmp`, rmOpts);
        rmSync(registre, rmOpts);
      } catch {
        // Fichier verrouillé (Windows) : le prochain run de la tâche nettoiera.
      }
    },
  };
}
