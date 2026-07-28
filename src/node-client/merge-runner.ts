// Honeycomb Merge — exécution réelle côté nœud (Palier 3).
//
// Applique les diffs des tâches terminées, DANS L'ORDRE du plan de merge, sur un
// dépôt git local (un clone jetable à la base d'intégration). Chaque diff est
// d'abord vérifié (`git apply --check`) : s'il ne s'applique pas proprement sur
// l'état accumulé, c'est un CONFLIT réel (pas seulement l'heuristique de lignes) —
// on l'écarte et on continue. En l'absence de conflit, une commande de test
// optionnelle est lancée (`spawn`, shell:false — contrainte §5.1).
//
// Sûr par construction : ne fait NI commit NI push (jamais de merge auto sur main).
// Le résultat (diff cumulé + verdict tests) remonte pour revue humaine.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { buildSandboxEnv } from './workspace.js';

export interface MergeDiff {
  taskId: string;
  diff: string;
}

export interface MergeRunOptions {
  /** Dépôt git local (working copy positionné à la base d'intégration). */
  repoDir: string;
  /** Diffs des tâches, dans l'ordre de merge. */
  diffs: MergeDiff[];
  /** Commande de test à lancer si aucun conflit (argv, jamais interprétée par un shell). */
  testCommand?: string[];
  /** Délai max de la commande de test (défaut 5 min). */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface MergeRunResult {
  /** taskIds appliqués proprement, dans l'ordre. */
  applied: string[];
  /** taskIds dont le diff n'a pas pu s'appliquer (conflit réel). */
  conflicts: { taskId: string; reason: string }[];
  /** Diff cumulé après application des diffs propres (pour revue humaine). */
  mergedDiff: string;
  /** Commande de test lancée ? (non lancée s'il y a des conflits ou pas de commande). */
  testsRun: boolean;
  /** Résultat des tests (null si non lancés). */
  testsPassed: boolean | null;
  logs: string;
}

const OUTPUT_CAP = 512 * 1024;

/**
 * Lance une commande (argv) dans un cwd, sans shell, sortie plafonnée, timeout dur.
 * L'environnement est ÉPURÉ (aucun secret du nœud transmis à l'enfant — cf. revue
 * sécurité Palier 3) : seuls PATH/variables système + un TEMP dédié passent.
 */
function runProc(
  cmd: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd;
    const child = spawn(bin ?? '', args, {
      cwd,
      env,
      shell: false, // jamais d'interprétation shell (contrainte §5.1)
      windowsHide: true,
      signal,
    });
    let output = '';
    const cap = (c: Buffer): void => {
      if (output.length < OUTPUT_CAP) output += c.toString();
    };
    child.stdout?.on('data', cap);
    child.stderr?.on('data', cap);
    const to = setTimeout(() => {
      output += `\n[hive] timeout après ${timeoutMs} ms — processus tué`;
      child.kill();
    }, timeoutMs);
    to.unref?.();
    child.on('error', (e) => {
      clearTimeout(to);
      resolve({ code: 1, output: `${output}\n[hive] échec du lancement : ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(to);
      resolve({ code, output });
    });
  });
}

/**
 * Applique les diffs dans l'ordre sur le dépôt local, détecte les conflits réels
 * (git), puis lance éventuellement les tests. Ne commit ni ne push jamais.
 */
export async function runMerge(opts: MergeRunOptions): Promise<MergeRunResult> {
  // LA GARDE QUI COMPTE. Le hub refuse déjà les commandes hors liste, mais un
  // nœud ne doit pas tenir pour acquis que le hub est bien celui qu'il croit :
  // le jeton de ruche est partagé, les anciennes invitations le portent en
  // clair, et le transport peut être un ws:// de réseau local. On vérifie donc
  // AVANT toute écriture — `spawn(argv[0])` sans shell exécute quand même le
  // binaire qu'on lui nomme.
  if (opts.testCommand && opts.testCommand.length > 0) {
    const verdict = jugerCommandeTest(opts.testCommand);
    if (!verdict.ok) throw new Error(`commande de test refusée : ${verdict.motif}`);
  }
  const git = simpleGit({ baseDir: opts.repoDir });
  const applied: string[] = [];
  const conflicts: { taskId: string; reason: string }[] = [];
  const logs: string[] = [];
  const patchDir = mkdtempSync(path.join(os.tmpdir(), 'hive-merge-'));

  try {
    for (const { taskId, diff } of opts.diffs) {
      if (!diff.trim()) {
        applied.push(taskId); // rien à appliquer (diff vide) : non bloquant
        continue;
      }
      const patchFile = path.join(patchDir, `${taskId}.patch`);
      writeFileSync(patchFile, diff.endsWith('\n') ? diff : `${diff}\n`);
      try {
        // Vérifie AVANT d'appliquer : échoue si le patch ne colle pas à l'état accumulé.
        await git.raw(['apply', '--check', patchFile]);
      } catch {
        conflicts.push({ taskId, reason: "le diff ne s'applique pas proprement (conflit)" });
        logs.push(`✘ ${taskId} : conflit d'application`);
        continue;
      }
      await git.raw(['apply', patchFile]);
      applied.push(taskId);
      logs.push(`✔ ${taskId} appliqué`);
    }

    // Diff cumulé (nouveaux fichiers rendus visibles via --intent-to-add).
    await git.raw(['add', '--all', '--intent-to-add']);
    const mergedDiff = await git.diff();

    let testsRun = false;
    let testsPassed: boolean | null = null;
    if (opts.testCommand && opts.testCommand.length > 0 && conflicts.length === 0) {
      testsRun = true;
      // Environnement épuré : le hub n'accède à AUCUN secret local du nœud.
      const env = buildSandboxEnv(opts.repoDir);
      try {
        const { code, output } = await runProc(
          opts.testCommand,
          opts.repoDir,
          env,
          opts.timeoutMs ?? 5 * 60_000,
          opts.signal,
        );
        testsPassed = code === 0;
        logs.push(`tests : ${testsPassed ? '✔ OK' : `✘ échec (code ${code})`}`);
        logs.push(output.slice(0, 4000));
      } finally {
        rmSync(`${opts.repoDir}.tmp`, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    }

    return { applied, conflicts, mergedDiff, testsRun, testsPassed, logs: logs.join('\n') };
  } finally {
    rmSync(patchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
