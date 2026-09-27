// LA BRANCHE DE MISSION, SUR UN VRAI GIT — commit, rangement, poussée.
//
// Le merge d'une mission appliquait ses diffs sur un clone, lançait les tests,
// puis JETAIT le clone : sans GitHub, le résultat intégré ne survivait nulle
// part. Ces bancs tiennent ce qui le remplace, sur des dépôts git réels et
// jetables, clonés en `file://` — donc SUPERFICIELS, comme en production :
//
//   · ce qui est commité est l'arbre INTÉGRÉ, capturé avant la préparation et
//     les tests — pas ce qu'un test a réécrit ou laissé traîner ;
//   · la branche survit au clone, dans le dépôt durable du nœud ;
//   · son numéro ne reprend ni une branche d'ici, ni une branche de là-bas ;
//   · pousser exige la demande ET le consentement du nœud, et un refus du
//     dépôt distant remonte lavé de ses identifiants ;
//   · un conflit ou des tests rouges ne livrent RIEN, et le disent.

import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { runMerge } from '../src/node-client/merge-runner.js';
import type { MergeDiff } from '../src/node-client/merge-runner.js';
import { cloneRepo, envTransportGit } from '../src/node-client/workspace.js';
import { CONSENTEMENT_POUSSEE } from '../src/shared/livraison-locale.js';
import type { DemandeLivraisonLocale } from '../src/shared/livraison-locale.js';

const FILE = 'sample.txt';
const BASE = Array.from({ length: 12 }, (_, i) => `l${i + 1}`);

function withLine(line: number, value: string): string {
  const lines = [...BASE];
  lines[line - 1] = value;
  return lines.join('\n') + '\n';
}

let racine: string;
let origine: string;
let patchA: string; // ligne 2
let patchB: string; // ligne 10, et un fichier nouveau
let patchC: string; // ligne 2 aussi : conflit avec A
let compteur = 0;

/** Un dépôt de travail neuf, désarmé des réglages globaux qui n'ont rien à y faire. */
async function initDepot(dir: string, nu = false): Promise<void> {
  await simpleGit().raw(['init', ...(nu ? ['--bare'] : []), dir]);
  const g = simpleGit({ baseDir: dir });
  await g.addConfig('user.email', 'test@hive.local');
  await g.addConfig('user.name', 'Hive Test');
  // Même précaution que merge-runner.test.ts : un `commit.gpgsign = true`
  // global ne doit pas empêcher un contributeur qui signe de lancer ce banc.
  await g.addConfig('commit.gpgsign', 'false');
  await g.addConfig('core.autocrlf', 'false');
}

beforeAll(async () => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-mission-'));
  const travail = path.join(racine, 'travail');
  await initDepot(travail);
  const g = simpleGit({ baseDir: travail });
  writeFileSync(path.join(travail, FILE), BASE.join('\n') + '\n');
  await g.add(FILE);
  await g.commit('base');
  const patchFor = async (value: string, line: number, nouveau?: string): Promise<string> => {
    writeFileSync(path.join(travail, FILE), withLine(line, value));
    if (nouveau) writeFileSync(path.join(travail, nouveau), 'neuf\n');
    await g.raw(['add', '--all', '--intent-to-add']);
    const d = await g.diff();
    await g.raw(['reset', '--hard', 'HEAD']);
    await g.raw(['clean', '-fd']);
    return d;
  };
  patchA = await patchFor('l2-A', 2);
  patchB = await patchFor('l10-B', 10, 'nouveau.txt');
  patchC = await patchFor('l2-C', 2);
  origine = path.join(racine, 'origine.git');
  await simpleGit().raw(['clone', '--bare', '--quiet', travail, origine]);
});

afterAll(() => {
  rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

interface Essai {
  /**
   * UN projet par banc. Les bancs partagent le dépôt d'origine : sous
   * `--sequence.shuffle`, un numéro de branche qui dépendrait des livraisons
   * d'un voisin (ou de ses poussées) ne vaudrait qu'à une place de l'ordre.
   */
  projectId: string;
  diffs: MergeDiff[];
  pousser?: boolean;
  consentie?: boolean;
  testCommand?: string[];
  forcage?: string;
  depotLocal?: string;
  url?: string;
}

/** Un merge avec livraison, depuis un clone SUPERFICIEL frais — comme un nœud. */
async function livrer(e: Essai) {
  const clone = path.join(racine, 'merges', `m${++compteur}`);
  await cloneRepo(clone, e.url ?? pathToFileURL(origine).href);
  const demande: DemandeLivraisonLocale = {
    projectId: e.projectId,
    pousser: e.pousser ?? false,
    provenance: e.diffs.map((d, i) => ({
      taskId: d.taskId,
      resultId: i + 1,
      decision: 'accepted',
    })),
    ...(e.forcage ? { forcage: e.forcage } : {}),
  };
  const depotLocal = e.depotLocal ?? path.join(racine, 'livraisons', `${e.projectId}.git`);
  const res = await runMerge({
    repoDir: clone,
    diffs: e.diffs,
    ...(e.testCommand ? { testCommand: e.testCommand } : {}),
    livraison: {
      demande,
      depotLocal,
      pousseeConsentie: e.consentie ?? false,
      envTransport: envTransportGit(),
    },
  });
  return { res, depotLocal, clone };
}

const git = (dir: string) => simpleGit({ baseDir: dir });

describe('la livraison d’une mission (git réel, clone superficiel)', () => {
  it('commite l’arbre INTÉGRÉ — pas ce que les tests ont écrit après', async () => {
    const { res, depotLocal } = await livrer({
      projectId: 'arbre',
      diffs: [
        { taskId: 'ta', diff: patchA },
        { taskId: 'tb', diff: patchB },
      ],
      // Le test réécrit un fichier suivi ET en crée un : aucun des deux ne
      // doit entrer dans la livraison. Capturé après les tests, l'arbre les
      // porterait tous deux sous le nom de la mission.
      testCommand: [
        'node',
        '-e',
        "const f=require('fs');f.writeFileSync('sample.txt','ecrase\\n');f.writeFileSync('trace.log','x')",
      ],
    });
    expect(res.logs, res.logs).toContain('livraison : ✔');
    expect(res.livraison).toMatchObject({
      etat: 'commitee',
      branche: 'hive/mission-arbre-1',
      poussee: 'non_demandee',
    });
    if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
    const d = git(depotLocal);
    // La branche a SURVÉCU au clone : elle est dans le dépôt durable du nœud.
    expect((await d.raw(['rev-parse', 'refs/heads/hive/mission-arbre-1'])).trim()).toBe(
      res.livraison.commit,
    );
    const contenu = await d.raw(['show', `${res.livraison.commit}:${FILE}`]);
    expect(contenu).toContain('l2-A');
    expect(contenu).toContain('l10-B');
    expect(contenu).not.toContain('ecrase');
    const fichiers = (await d.raw(['ls-tree', '--name-only', res.livraison.commit])).split('\n');
    expect(fichiers).toContain('nouveau.txt');
    expect(fichiers).not.toContain('trace.log');
    // Rien n'est poussé vers le dépôt du projet sans qu'on l'ait demandé.
    const distantes = await git(origine).raw(['for-each-ref', '--format=%(refname)']);
    expect(distantes).not.toContain('hive/mission-arbre');
  });

  it('porte des trailers que git relit, et l’identité de la ruche', async () => {
    const { res, depotLocal } = await livrer({
      projectId: 'trailers',
      diffs: [{ taskId: 'ta', diff: patchA }],
      forcage: 'relu à la main',
    });
    if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
    const d = git(depotLocal);
    const message = await d.raw(['log', '-1', '--format=%B', res.livraison.commit]);
    // C'est GIT qui relit les trailers (`%(trailers:only)`), pas une regex du
    // banc : un bloc mal formé — une ligne vide de trop, un séparateur absent —
    // rendrait ici une liste vide.
    const parses = (
      await d.raw(['log', '-1', '--format=%(trailers:only,unfold)', res.livraison.commit])
    )
      .trim()
      .split('\n');
    expect(parses).toEqual(
      expect.arrayContaining([
        'Hive-Mission: trailers',
        'Hive-Task: ta',
        'Hive-Result: ta 1',
        'Hive-Evaluator: ta accepted',
        'Hive-Evaluator-Forced: relu à la main',
        'Hive-Tests: non-lances',
      ]),
    );
    expect(message).toContain('Hive — mission trailers');
    const auteur = (
      await d.raw(['log', '-1', '--format=%an <%ae>|%cn', res.livraison.commit])
    ).trim();
    expect(auteur).toBe('Hive <hive@hive.invalid>|Hive');
    // Le parent est la base clonée : la livraison ne réécrit pas l'histoire.
    const parent = (await d.raw(['rev-parse', `${res.livraison.commit}^`])).trim();
    expect(parent).toBe((await git(origine).raw(['rev-parse', 'HEAD'])).trim());
  });

  it('numérote après la plus grande branche, d’ici OU de là-bas', async () => {
    // Une livraison n°7 poussée par un autre nœud, que celui-ci n'a jamais vue.
    const autre = path.join(racine, 'autre-noeud');
    await cloneRepo(autre, origine);
    await git(autre).raw(['push', '--quiet', 'origin', 'HEAD:refs/heads/hive/mission-num-7']);
    const { res } = await livrer({ projectId: 'num', diffs: [{ taskId: 'tb', diff: patchB }] });
    expect(res.livraison).toMatchObject({ etat: 'commitee', branche: 'hive/mission-num-8' });
  });

  it('ne pousse pas sans le consentement du nœud — et dit comment l’accorder', async () => {
    const { res, depotLocal } = await livrer({
      projectId: 'sans-consentement',
      diffs: [{ taskId: 'ta', diff: patchA }],
      pousser: true,
      consentie: false,
    });
    expect(res.livraison).toMatchObject({
      etat: 'commitee',
      poussee: 'refusee',
      motif: CONSENTEMENT_POUSSEE,
    });
    if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
    const distantes = await git(origine).raw(['for-each-ref', '--format=%(refname)']);
    expect(distantes).not.toContain(res.livraison.branche);
    // La livraison n'est pas perdue pour autant : elle est rangée sur le nœud.
    expect((await git(depotLocal).raw(['rev-parse', res.livraison.branche])).trim()).toBe(
      res.livraison.commit,
    );
  });

  it('pousse la branche — et elle seule — quand c’est demandé ET consenti', async () => {
    const avant = (await git(origine).raw(['rev-parse', 'HEAD'])).trim();
    const { res } = await livrer({
      projectId: 'pousse',
      diffs: [{ taskId: 'ta', diff: patchA }],
      pousser: true,
      consentie: true,
    });
    expect(res.livraison).toMatchObject({ etat: 'commitee', poussee: 'poussee' });
    if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
    expect((await git(origine).raw(['rev-parse', res.livraison.branche])).trim()).toBe(
      res.livraison.commit,
    );
    expect((await git(origine).raw(['rev-parse', 'HEAD'])).trim()).toBe(avant);
  });

  it('un refus du dépôt distant remonte LAVÉ, et la branche reste sur le nœud', async () => {
    const refusant = path.join(racine, 'refusant.git');
    await simpleGit().raw(['clone', '--bare', '--quiet', origine, refusant]);
    const crochet = path.join(refusant, 'hooks', 'pre-receive');
    writeFileSync(
      crochet,
      '#!/bin/sh\necho "refusé par https://moi:jeton-secret@git.exemple.test/d.git" >&2\nexit 1\n',
    );
    chmodSync(crochet, 0o755);
    const { res, depotLocal } = await livrer({
      projectId: 'crochet',
      diffs: [{ taskId: 'ta', diff: patchA }],
      pousser: true,
      consentie: true,
      url: pathToFileURL(refusant).href,
    });
    expect(res.livraison).toMatchObject({ etat: 'commitee', poussee: 'echec' });
    if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
    expect(res.livraison.motif).toContain('https://***@git.exemple.test');
    expect(res.livraison.motif).not.toContain('jeton-secret');
    expect(res.logs).not.toContain('jeton-secret');
    expect((await git(depotLocal).raw(['rev-parse', res.livraison.branche])).trim()).toBe(
      res.livraison.commit,
    );
  });

  it('un conflit ne livre RIEN : une intégration partielle n’est pas la mission', async () => {
    const depotLocal = path.join(racine, 'livraisons', 'conflit.git');
    const { res } = await livrer({
      projectId: 'conflit',
      diffs: [
        { taskId: 'ta', diff: patchA },
        { taskId: 'tc', diff: patchC },
      ],
      depotLocal,
    });
    expect(res.conflicts.map((c) => c.taskId)).toEqual(['tc']);
    expect(res.livraison).toEqual({
      etat: 'non_commitee',
      motif: '1 tâche(s) en conflit : une intégration partielle n’est pas livrée',
    });
    expect(existsSync(depotLocal)).toBe(false);
  });

  it('des tests rouges ne livrent rien, et le disent', async () => {
    const depotLocal = path.join(racine, 'livraisons', 'rouge.git');
    const { res } = await livrer({
      projectId: 'rouge',
      diffs: [{ taskId: 'ta', diff: patchA }],
      testCommand: ['node', '-e', 'process.exit(1)'],
      depotLocal,
    });
    expect(res.testsPassed).toBe(false);
    expect(res.livraison).toEqual({
      etat: 'non_commitee',
      motif: 'tests en échec : rien n’est commité',
    });
    expect(existsSync(depotLocal)).toBe(false);
  });

  it('un dépôt VIDE reçoit la livraison comme premier commit', async () => {
    const vide = path.join(racine, 'vide.git');
    await initDepot(vide, true);
    const creation = [
      'diff --git a/LISEZMOI.md b/LISEZMOI.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/LISEZMOI.md',
      '@@ -0,0 +1 @@',
      '+premier',
      '',
    ].join('\n');
    const clone = path.join(racine, 'merges', 'vide');
    await cloneRepo(clone, pathToFileURL(vide).href);
    const depotLocal = path.join(racine, 'livraisons', 'vide.git');
    const res = await runMerge({
      repoDir: clone,
      diffs: [{ taskId: 'tv', diff: creation }],
      livraison: {
        demande: {
          projectId: 'v',
          pousser: false,
          provenance: [{ taskId: 'tv', resultId: 1, decision: 'accepted' }],
        },
        depotLocal,
        pousseeConsentie: false,
        envTransport: envTransportGit(),
      },
    });
    expect(res.livraison).toMatchObject({ etat: 'commitee', branche: 'hive/mission-v-1' });
    if (res.livraison?.etat !== 'commitee') throw new Error(res.logs);
    const parents = await git(depotLocal).raw(['log', '-1', '--format=%P', res.livraison.commit]);
    expect(parents.trim()).toBe('');
  });

  it('une provenance qui ne nomme pas exactement les tâches intégrées est refusée', async () => {
    const clone = path.join(racine, 'merges', 'provenance');
    await cloneRepo(clone, pathToFileURL(origine).href);
    const res = await runMerge({
      repoDir: clone,
      diffs: [{ taskId: 'ta', diff: patchA }],
      livraison: {
        demande: {
          projectId: 'provenance',
          pousser: false,
          provenance: [{ taskId: 'autre', resultId: 1, decision: 'accepted' }],
        },
        depotLocal: path.join(racine, 'livraisons', 'provenance.git'),
        pousseeConsentie: false,
        envTransport: envTransportGit(),
      },
    });
    expect(res.livraison?.etat).toBe('non_commitee');
  });
});
