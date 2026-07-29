// Honeycomb Merge — exécution réelle côté nœud (Palier 3).
//
// Applique les diffs des tâches terminées, DANS L'ORDRE du plan de merge, sur un
// dépôt git local (un clone jetable à la base d'intégration). Chaque diff est
// d'abord vérifié (`git apply --check`) : s'il ne s'applique pas proprement sur
// l'état accumulé, c'est un CONFLIT réel (pas seulement l'heuristique de lignes) —
// on l'écarte et on continue. En l'absence de conflit, l'environnement est
// préparé si on l'a demandé (`npm ci`…), puis une commande de test optionnelle
// est lancée (`spawn`, shell:false — contrainte §5.1).
//
// L'ORDRE COMPTE, et pas seulement pour que les tests trouvent leurs
// dépendances : le diff cumulé est calculé AVANT la préparation, sinon les
// `node_modules` que celle-ci installe se retrouveraient dans ce qu'on soumet à
// la revue humaine.
//
// Sûr par construction : ne fait NI commit NI push (jamais de merge auto sur main).
// Le résultat (diff cumulé + verdict tests) remonte pour revue humaine.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { jugerPreparation } from '../shared/preparation.js';
import { LanceurIndisponible, resoudreLanceur } from '../lanceur-reel.js';
import { envelopper } from './isolement.js';
import type { Fournisseur } from './isolement.js';
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
  /**
   * Préparation de l'environnement, lancée AVANT les tests.
   *
   * `npm test` sur un clone frais échoue faute de `node_modules`, et le verdict
   * qui remonte dit alors « tests en échec » là où il fallait lire
   * « environnement absent ». C'est cette confusion-là que la préparation
   * supprime — et si elle échoue, les tests ne sont PAS lancés : un verdict de
   * test sans dépendances ne vaut rien et se lirait comme une régression.
   */
  prepareCommand?: string[];
  /** Commande de test à lancer si aucun conflit (argv, jamais interprétée par un shell). */
  testCommand?: string[];
  /**
   * Le bac à sable du nœud, s'il en a un.
   *
   * IL MANQUAIT ICI, ET C'ÉTAIT LE TROU LE PLUS EMBARRASSANT DU LOT : les
   * adaptateurs de tâches passent tous par `runCommand`, qui enveloppe. Ce
   * chemin-ci ne passait par rien. Autrement dit `HIVE_ISOLEMENT=exige` — le
   * réglage qu'on pose précisément quand on prête sa machine à des inconnus —
   * empêchait bien un agent de sortir de son bac, pendant que la commande de
   * test d'un merge s'exécutait à côté, sur l'hôte nu.
   */
  bac?: { fournisseur: Fournisseur; variables: readonly string[] };
  /** Délai max de la commande de test (défaut 5 min). */
  timeoutMs?: number;
  /**
   * Délai max de la préparation (défaut 10 min).
   *
   * Plus large que celui des tests, et pour une raison bête : une installation
   * complète télécharge, et une machine de membre n'est pas une machine
   * d'intégration continue. Trop court, la garde qui protège devient la panne
   * qu'on ne comprend pas.
   */
  prepareTimeoutMs?: number;
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
  /**
   * Verdict de la préparation : `null` si aucune n'a été demandée ou lancée.
   *
   * Distinct de `testsPassed` exprès. « L'environnement ne s'installe pas » et
   * « les tests échouent » demandent deux gestes différents de l'hôte, et les
   * confondre en un seul booléen l'enverrait corriger du code qui va bien.
   */
  preparedOk: boolean | null;
  logs: string;
}

const OUTPUT_CAP = 512 * 1024;

/**
 * Lance une commande (argv) dans un cwd, sans shell, sortie plafonnée, timeout dur.
 * L'environnement est ÉPURÉ (aucun secret du nœud transmis à l'enfant — cf. revue
 * sécurité Palier 3) : seuls PATH/variables système + un TEMP dédié passent.
 *
 * EXPORTÉ pour les Chantiers (lot 14), qui lancent une commande déclarée par le
 * dépôt dans un clone frais — même besoin exactement, y compris la résolution
 * de `npm` en `npm.cmd` sous Windows et l'enveloppe de bac à sable. En écrire
 * une seconde version aurait fait deux endroits où oublier l'isolement, et le
 * premier oubli de ce genre est déjà raconté trois lignes plus bas.
 */
export function runProc(
  cmd: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
  bac?: { fournisseur: Fournisseur; variables: readonly string[] },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd;
    let output = '';
    // ISOLEMENT — même enveloppe que les adaptateurs de tâches. Ce chemin n'y
    // passait pas, et c'était le trou le plus embarrassant : la commande de
    // test d'un merge exécute du code fourni par le dépôt, exactement comme un
    // agent, mais tournait sur l'hôte nu même sous `HIVE_ISOLEMENT=exige`.
    //
    // `cwdHote` est le clone : c'est lui qu'on monte, et c'est aussi lui que
    // git relira après. L'enveloppe ne déplace rien, elle restreint ce que le
    // processus voit.
    // SOUS BAC À SABLE, ON NE TOUCHE À RIEN : l'enveloppe lance `docker` (un
    // vrai binaire partout) et la commande s'exécute DANS le conteneur, donc
    // sous Linux. Y appliquer une résolution Windows viserait la mauvaise
    // plateforme — c'est l'hôte qui est Windows, pas l'invité.
    let lance: { bin: string; args: string[] };
    if (bac) {
      lance = envelopper(bin ?? '', args, {
        fournisseur: bac.fournisseur,
        cwdHote: cwd,
        variables: bac.variables,
      });
    } else {
      try {
        lance = resoudreLanceur(bin ?? '', args);
      } catch (e) {
        // Un refus MOTIVÉ vaut mieux qu'un `spawn ENOENT` : c'est la même
        // panne, mais celle-ci se lit.
        if (e instanceof LanceurIndisponible) {
          resolve({ code: 1, output: `${output}\n[hive] ${e.motif}` });
          return;
        }
        throw e;
      }
    }
    const child = spawn(lance.bin, lance.args, {
      cwd,
      env,
      shell: false, // jamais d'interprétation shell (contrainte §5.1)
      windowsHide: true,
      signal,
    });
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
  // Même raisonnement pour la préparation, et il porte plus loin : une
  // installation exécute les scripts du dépôt, et `pip install <ce que le hub
  // nomme>` exécuterait ceux d'un paquet que PERSONNE n'a choisi de connecter.
  if (opts.prepareCommand && opts.prepareCommand.length > 0) {
    const verdict = jugerPreparation(opts.prepareCommand);
    if (!verdict.ok) throw new Error(`préparation refusée : ${verdict.motif}`);
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
    let preparedOk: boolean | null = null;
    if (conflicts.length === 0 && (opts.prepareCommand?.length || opts.testCommand?.length)) {
      // Environnement épuré : le hub n'accède à AUCUN secret local du nœud.
      const env = buildSandboxEnv(opts.repoDir);
      try {
        // LA PRÉPARATION D'ABORD — c'est tout l'intérêt : sans elle, `npm test`
        // sur un clone frais échoue faute de `node_modules`.
        if (opts.prepareCommand && opts.prepareCommand.length > 0) {
          const { code, output } = await runProc(
            opts.prepareCommand,
            opts.repoDir,
            env,
            opts.prepareTimeoutMs ?? 10 * 60_000,
            opts.signal,
            opts.bac,
          );
          preparedOk = code === 0;
          logs.push(
            `environnement : ${preparedOk ? '✔ préparé' : `✘ préparation en échec (code ${code})`}`,
          );
          logs.push(output.slice(0, 4000));
        }

        // ET SI ELLE ÉCHOUE, ON NE TESTE PAS. Une installation qui n'aboutit
        // pas — hors ligne, registre injoignable, lockfile désaccordé — donne
        // ensuite un `npm test` qui échoue pour une raison qui n'a rien à voir
        // avec le code. Remonter ça comme « tests en échec » enverrait l'hôte
        // chercher une régression qui n'existe pas. On le dit à la place.
        if (preparedOk === false) {
          logs.push(
            'tests : non lancés — l’environnement n’a pas pu être préparé. Le code n’est PAS ' +
              'en cause : vérifiez le réseau de ce nœud, puis le lockfile du dépôt.',
          );
        } else if (opts.testCommand && opts.testCommand.length > 0) {
          testsRun = true;
          const { code, output } = await runProc(
            opts.testCommand,
            opts.repoDir,
            env,
            opts.timeoutMs ?? 5 * 60_000,
            opts.signal,
            opts.bac,
          );
          testsPassed = code === 0;
          logs.push(`tests : ${testsPassed ? '✔ OK' : `✘ échec (code ${code})`}`);
          logs.push(output.slice(0, 4000));
        }
      } finally {
        rmSync(`${opts.repoDir}.tmp`, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    }

    return {
      applied,
      conflicts,
      mergedDiff,
      testsRun,
      testsPassed,
      preparedOk,
      logs: logs.join('\n'),
    };
  } finally {
    rmSync(patchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
