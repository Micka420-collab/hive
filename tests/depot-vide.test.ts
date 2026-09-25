// Un projet qui démarre sur un dépôt VIDE — le cas le plus banal du monde réel.
//
// ─── POURQUOI CE BANC ────────────────────────────────────────────────────────
//
// On crée un dépôt GitHub, on le connecte à la ruche, on lance la première
// mission : le dépôt n'a encore AUCUN commit. Rien ne l'éprouvait. L'audit du
// workflow Git (carte Notion « Auditer workflow Git, branches, merge et
// conflits ») l'a mesuré avec les vraies fonctions du nœud et un vrai `git` :
// l'espace de travail se prépare (branche `hive/<tâche>` sur une branche à
// naître), un nouveau fichier apparaît dans le diff, et la fusion applique des
// diffs de création et reconnaît deux créations du même fichier comme un
// conflit. Ce banc fige ce constat.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMerge } from '../src/node-client/merge-runner.js';
import { prepareWorkspace } from '../src/node-client/workspace.js';
import type { Task } from '../src/shared/types.js';

let dossier: string;
let depotVide: string;

beforeAll(() => {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-depot-vide-'));
  depotVide = path.join(dossier, 'vide.git');
  execFileSync('git', ['init', '-q', '--bare', depotVide]);
});

afterAll(() => {
  rmSync(dossier, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Un diff de CRÉATION de fichier, tel qu'un agent en rend sur un dépôt vide. */
function creation(fichier: string, ligne: string): string {
  return [
    `diff --git a/${fichier} b/${fichier}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${fichier}`,
    '@@ -0,0 +1 @@',
    `+${ligne}`,
    '',
  ].join('\n');
}

describe('un dépôt sans aucun commit', () => {
  it('L’ESPACE DE TRAVAIL SE PRÉPARE — branche de tâche, et le nouveau fichier est dans le diff', async () => {
    const tache = { id: 'premiere-tache', title: 'Premier pas', prompt: 'x' } as Task;
    const ws = await prepareWorkspace(path.join(dossier, 'travail'), tache, depotVide);
    try {
      expect(ws.branch).toBe('hive/premiere-tache');
      writeFileSync(path.join(ws.cwd, 'LISEZMOI.md'), '# Premier fichier\n');
      const diff = await ws.collectDiff();
      expect(diff).toContain('LISEZMOI.md');
      expect(diff).toContain('+# Premier fichier');
    } finally {
      ws.cleanup();
    }
  });

  it('LA FUSION APPLIQUE LES CRÉATIONS — et deux créations du même fichier sont un conflit', async () => {
    const clone = path.join(dossier, 'clone-fusion');
    execFileSync('git', ['clone', '-q', depotVide, clone], { stdio: 'ignore' });
    const r = await runMerge({
      repoDir: clone,
      diffs: [
        { taskId: 'a', diff: creation('a.txt', 'A') },
        { taskId: 'b', diff: creation('b.txt', 'B') },
        { taskId: 'c', diff: creation('a.txt', 'C') },
      ],
    });
    expect(r.applied).toEqual(['a', 'b']);
    expect(r.conflicts.map((c) => c.taskId)).toEqual(['c']);
    expect(r.mergedDiff).toContain('a.txt');
    expect(r.mergedDiff).toContain('b.txt');
  });
});
