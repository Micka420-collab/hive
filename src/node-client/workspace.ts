// Préparation du répertoire de travail d'une tâche — sandbox v0.
// Isolation fournie : un cwd dédié par tâche, environnement épuré (pas de
// HOME/USERPROFILE ni variables du membre), TEMP redirigé dans la tâche,
// branche git `hive/<taskId>` quand le projet a un dépôt.
// Limites (documentées dans le README) : pas encore de VM/conteneur — un
// processus malveillant peut toujours lire le disque. La vraie isolation
// (Firecracker/Docker + réseau filtré) est prévue à l'itération suivante ;
// d'ici là, Hive ne doit tourner qu'entre membres de confiance.

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import type { Task } from '../shared/types.js';

export interface Workspace {
  /** Répertoire de travail isolé de la tâche. */
  cwd: string;
  git: SimpleGit | null;
  branch: string | null;
  /** Environnement épuré pour les processus enfants. */
  env: NodeJS.ProcessEnv;
  /** Diff des modifications, pour revue humaine (vide sans dépôt git). */
  collectDiff(): Promise<string>;
  /** Supprime le répertoire de la tâche. */
  cleanup(): void;
}

/**
 * Environnement minimal pour la sandbox v0. Seuls PATH et les variables
 * système indispensables passent ; `keepEnv` permet d'ajouter explicitement
 * des variables nécessaires à un agent réel (ex. ANTHROPIC_API_KEY) — ces
 * secrets restent locaux au nœud, jamais transmis au hub.
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
  for (const name of keepEnv) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * Clone superficiel d'un dépôt dans `dir`, avec la même protection de transport
 * que les clones de tâches : GIT_ALLOW_PROTOCOL neutralise `ext::` (RCE), pas de
 * prompt de terminal, environnement épuré. `dir` doit être vide/inexistant.
 */
export async function cloneRepo(dir: string, repoUrl: string): Promise<void> {
  const cloneEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    GIT_ALLOW_PROTOCOL: 'http:https:git:ssh:file',
    GIT_TERMINAL_PROMPT: '0',
  };
  await simpleGit().env(cloneEnv).clone(repoUrl, dir, ['--depth', '1']);
}

export async function prepareWorkspace(
  workRoot: string,
  task: Task,
  repoUrl: string | null,
  keepEnv: string[] = [],
): Promise<Workspace> {
  const tasksRoot = path.resolve(workRoot, 'tasks');
  const cwd = path.resolve(tasksRoot, task.id);
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
  }

  const env = buildSandboxEnv(cwd, keepEnv);

  return {
    cwd,
    git,
    branch,
    env,
    async collectDiff(): Promise<string> {
      if (!git) return '';
      // --intent-to-add rend les nouveaux fichiers visibles dans le diff.
      await git.raw(['add', '--all', '--intent-to-add']);
      return git.diff();
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
