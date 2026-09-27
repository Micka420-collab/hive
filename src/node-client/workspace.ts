// Préparation du répertoire de travail d'une tâche.
//
// Ce que CE fichier fournit : un cwd dédié par tâche, un environnement épuré
// (pas de HOME/USERPROFILE ni variables du membre), TEMP redirigé dans la
// tâche, une branche git `hive/<taskId>` quand le projet a un dépôt.
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
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { CLONE_MS } from '../shared/butoirs-noeud.js';
import type { Task } from '../shared/types.js';

export interface Workspace {
  /** Répertoire de travail isolé de la tâche. */
  cwd: string;
  git: SimpleGit | null;
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

/**
 * Retire du répertoire d'une tâche tout ce que git IGNORE — `node_modules`,
 * sorties de build, `.env`, et ce qu'un `.git/info/exclude` cacherait.
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
export async function retirerFichiersIgnores(git: SimpleGit): Promise<void> {
  // `-ff` : aussi les dépôts imbriqués ignorés ; `-d` : les dossiers entiers.
  await git.raw(['clean', '-ffdX']);
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
 * Clone superficiel d'un dépôt dans `dir`, avec la même protection de transport
 * que les clones de tâches : GIT_ALLOW_PROTOCOL neutralise `ext::` (RCE), pas de
 * prompt de terminal, environnement épuré. `dir` doit être vide/inexistant.
 *
 * ─── BORNÉ, PARCE QUE LE HUB COMPTE DESSUS ─────────────────────────────────
 *
 * Ce clone ouvre chaque merge et chaque chantier, et il n'avait aucun butoir :
 * un dépôt qui accepte la connexion puis se tait laissait le travail pendre
 * chez le nœud, sans résultat, pendant que le hub — qui dérive ses délais des
 * butoirs du nœud (`butoirs-noeud.ts`) — ne pouvait que DEVINER sa durée. Au-delà
 * de `delaiMs`, git est TUÉ (le plugin d'annulation de simple-git), et le
 * travail échoue en le disant. Un `Promise.race` rendrait la main en laissant
 * le processus pendre derrière.
 *
 * Limite, dite : c'est le processus LANCÉ qui est tué. Sous Windows, où le `git`
 * du PATH est d'ordinaire un lanceur, le vrai git peut lui survivre jusqu'à ce
 * que le dépôt ferme (mesuré, `tests/clone-borne.test.ts`) — la limite de tout
 * `child.kill()` du nœud. Le travail, lui, échoue à l'heure partout.
 */
export async function cloneRepo(dir: string, repoUrl: string, delaiMs = CLONE_MS): Promise<void> {
  const cloneEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    GIT_ALLOW_PROTOCOL: 'http:https:git:ssh:file',
    GIT_TERMINAL_PROMPT: '0',
  };
  const butoir = AbortSignal.timeout(delaiMs);
  try {
    await simpleGit({ abort: butoir }).env(cloneEnv).clone(repoUrl, dir, ['--depth', '1']);
  } catch (err) {
    if (!butoir.aborted) throw err;
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
  // Repartir d'un répertoire vierge à chaque tentative. maxRetries absorbe les
  // verrous transitoires de fichiers sous Windows (antivirus, handle git résiduel)
  // qui, sinon, feraient échouer la tâche à durée nulle et brûleraient un essai.
  const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
  rmSync(cwd, rmOpts);
  rmSync(`${cwd}.tmp`, rmOpts);
  mkdirSync(cwd, { recursive: true });

  let git: SimpleGit | null = null;
  let branch: string | null = null;
  let baseSha: string | null = null;
  if (repoUrl) {
    // GIT_ALLOW_PROTOCOL restreint les transports autorisés : neutralise le
    // transport `ext::` de git (exécution de commande arbitraire = RCE), en plus
    // de la validation du repoUrl côté hub. On repart d'un environnement épuré
    // (sans variables d'éditeur, que simple-git refuse) : seuls PATH/HOME et les
    // variables système passent. Le clone exige un répertoire vide, il précède
    // donc toute écriture dans cwd.
    const cloneEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SYSTEMDRIVE: process.env.SYSTEMDRIVE,
      GIT_ALLOW_PROTOCOL: 'http:https:git:ssh:file',
      GIT_TERMINAL_PROMPT: '0',
    };
    await simpleGit().env(cloneEnv).clone(repoUrl, cwd, ['--depth', '1']);
    git = simpleGit({ baseDir: cwd });
    // Une tâche = une branche isolée. Jamais de travail direct sur main (§5.2).
    branch = task.branch ?? `hive/${task.id}`;
    await git.checkoutLocalBranch(branch);
    try {
      baseSha = (await git.revparse(['HEAD'])).trim();
    } catch {
      // Dépôt cloné sans aucun commit : il n'y a pas de base à épingler.
    }
  }

  const env = buildSandboxEnv(cwd, keepEnv);

  return {
    cwd,
    git,
    branch,
    baseSha,
    env,
    async collectDiff(): Promise<string> {
      if (!git) return '';
      // --intent-to-add rend les nouveaux fichiers visibles dans le diff.
      await git.raw(['add', '--all', '--intent-to-add']);
      // CONTRE LA BASE ÉPINGLÉE, pas contre l'index : `git diff` nu compare
      // l'arbre à l'index, et perdait en silence ce que l'agent avait
      // `git add` ou committé — absent de la revue, de la livraison, du merge.
      return baseSha ? git.diff([baseSha]) : git.diff();
    },
    cleanup(): void {
      try {
        rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        rmSync(`${cwd}.tmp`, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        // Fichier verrouillé (Windows) : le prochain run de la tâche nettoiera.
      }
    },
  };
}
