// Tests du merge-runner (Honeycomb Merge, Palier 3) : application réelle des
// diffs via git sur un dépôt temporaire, détection de conflits réels, et
// lancement d'une commande de test. 100 % hors-ligne (dépôt git local jetable).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { runMerge } from '../src/node-client/merge-runner.js';

const FILE = 'sample.txt';
const BASE = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);

/** Contenu du fichier de base avec une ligne (1-indexée) remplacée. */
function withLine(line: number, value: string): string {
  const lines = [...BASE];
  lines[line - 1] = value;
  return lines.join('\n') + '\n';
}

describe('merge-runner (git réel)', () => {
  let dir: string;
  let repoDir: string;
  let git: SimpleGit;
  let patchA: string; // modifie la ligne 2
  let patchB: string; // modifie la ligne 10
  let patchC: string; // modifie aussi la ligne 2 (conflit avec A)

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-mr-'));
    repoDir = path.join(dir, 'repo');
    const base = simpleGit();
    await base.raw(['init', repoDir]);
    git = simpleGit({ baseDir: repoDir });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    await git.addConfig('core.autocrlf', 'false');
    writeFileSync(path.join(repoDir, FILE), BASE.join('\n') + '\n');
    await git.add(FILE);
    await git.commit('base');

    const patchFor = async (value: string, line: number): Promise<string> => {
      writeFileSync(path.join(repoDir, FILE), withLine(line, value));
      const d = await git.diff();
      await git.raw(['checkout', '--', '.']); // retour à la base
      return d;
    };
    patchA = await patchFor('l2-A', 2);
    patchB = await patchFor('l10-B', 10);
    patchC = await patchFor('l2-C', 2);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  beforeEach(async () => {
    await git.raw(['reset', '--hard', 'HEAD']);
    await git.raw(['clean', '-fd']);
  });

  it('applique des diffs non conflictuels', async () => {
    const res = await runMerge({
      repoDir,
      diffs: [
        { taskId: 'ta', diff: patchA },
        { taskId: 'tb', diff: patchB },
      ],
    });
    expect(res.applied).toEqual(['ta', 'tb']);
    expect(res.conflicts).toEqual([]);
    // Les deux modifications sont présentes dans le diff cumulé.
    expect(res.mergedDiff).toContain('l2-A');
    expect(res.mergedDiff).toContain('l10-B');
  });

  it('détecte un conflit réel (deux diffs sur la même ligne)', async () => {
    const res = await runMerge({
      repoDir,
      diffs: [
        { taskId: 'ta', diff: patchA },
        { taskId: 'tc', diff: patchC },
      ],
    });
    expect(res.applied).toEqual(['ta']);
    expect(res.conflicts.map((c) => c.taskId)).toEqual(['tc']);
    expect(res.mergedDiff).toContain('l2-A');
    expect(res.mergedDiff).not.toContain('l2-C');
  });

  it('lance la commande de test et rapporte le succès', async () => {
    const res = await runMerge({
      repoDir,
      diffs: [{ taskId: 'ta', diff: patchA }],
      testCommand: ['node', '-e', 'process.exit(0)'],
    });
    expect(res.testsRun).toBe(true);
    expect(res.testsPassed).toBe(true);
  });

  it('rapporte l’échec des tests', async () => {
    const res = await runMerge({
      repoDir,
      diffs: [{ taskId: 'ta', diff: patchA }],
      testCommand: ['node', '-e', 'process.exit(1)'],
    });
    expect(res.testsRun).toBe(true);
    expect(res.testsPassed).toBe(false);
  });

  it('ne lance pas les tests en présence de conflits', async () => {
    const res = await runMerge({
      repoDir,
      diffs: [
        { taskId: 'ta', diff: patchA },
        { taskId: 'tc', diff: patchC },
      ],
      testCommand: ['node', '-e', 'process.exit(0)'],
    });
    expect(res.conflicts.length).toBe(1);
    expect(res.testsRun).toBe(false);
    expect(res.testsPassed).toBeNull();
  });

  it('tolère un diff vide (rien à appliquer)', async () => {
    const res = await runMerge({ repoDir, diffs: [{ taskId: 'empty', diff: '' }] });
    expect(res.applied).toEqual(['empty']);
    expect(res.conflicts).toEqual([]);
  });
});
