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
  const tmp = path.join(cwd, '.tmp');
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

export async function prepareWorkspace(
  workRoot: string,
  task: Task,
  repoUrl: string | null,
  keepEnv: string[] = [],
): Promise<Workspace> {
  const cwd = path.resolve(workRoot, 'tasks', task.id);
  // Repartir d'un répertoire vierge à chaque tentative.
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });

  const env = buildSandboxEnv(cwd, keepEnv);

  let git: SimpleGit | null = null;
  let branch: string | null = null;
  if (repoUrl) {
    await simpleGit().clone(repoUrl, cwd, ['--depth', '1']);
    git = simpleGit({ baseDir: cwd });
    // Une tâche = une branche isolée. Jamais de travail direct sur main (§5.2).
    branch = task.branch ?? `hive/${task.id}`;
    await git.checkoutLocalBranch(branch);
  }

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
        rmSync(cwd, { recursive: true, force: true });
      } catch {
        // Fichier verrouillé (Windows) : le prochain run de la tâche nettoiera.
      }
    },
  };
}
