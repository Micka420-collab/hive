// Les verdicts test par test (G11b), de bout en bout : une vraie Reine, un vrai
// nœud (HiveNodeClient), un vrai dépôt git, de vrais `npm run test` qui lancent
// `node --test` — dans le faux moteur de `fixtures/faux-bac.ts` (POSIX).
//
// Le critère de preuve de la carte (lot 7.9), là où il compte — dans le verdict
// que la Reine rend :
//
//   · un test déjà rouge à la base et un diff sans rapport → `accepted`, AVEC
//     la mention du test resté rouge ;
//   · une régression introduite → `correction_required`, le test NOMMÉ dans
//     les motifs que la correction transmet.
//
// Avant ce lot, les deux finissaient pareil : `correction_required`, « tests
// en échec » — le projet au test déjà rouge ne pouvait plus rien accepter.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { fauxBac } from './fixtures/faux-bac.js';

const JETON = 'jeton-verdicts-par-test-assez-long';

let serveur: HiveServer | null = null;
const clients: HiveNodeClient[] = [];
const dossiers: string[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  await serveur?.stop();
  serveur = null;
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 60_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/**
 * Le projet : `node --test`, un test que la base laisse rouge (son module n'a
 * jamais été réparé) et un test vert qu'une production peut casser.
 */
async function depotDuProjet(racine: string): Promise<string> {
  const depot = path.join(racine, 'depot');
  const ecrire = (nom: string, contenu: string) => {
    mkdirSync(path.dirname(path.join(depot, nom)), { recursive: true });
    writeFileSync(path.join(depot, nom), contenu);
  };
  ecrire(
    'package.json',
    JSON.stringify({
      name: 'projet-g11b',
      version: '1.0.0',
      private: true,
      scripts: { test: 'node --test' },
    }),
  );
  ecrire('src/ancien.js', "module.exports = 'cassé';\n");
  ecrire(
    'test/ancien.test.js',
    "const test = require('node:test');\nconst assert = require('node:assert');\n" +
      "test('un test déjà rouge à la base', () => {\n" +
      "  assert.strictEqual(require('../src/ancien.js'), 'réparé');\n});\n",
  );
  ecrire('src/calcul.js', 'exports.somme = (a, b) => a + b;\n');
  ecrire(
    'test/calcul.test.js',
    "const test = require('node:test');\nconst assert = require('node:assert');\n" +
      "test('additionne', () => {\n  assert.strictEqual(require('../src/calcul.js').somme(2, 2), 4);\n});\n",
  );
  const git = simpleGit({ baseDir: depot });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  return depot;
}

/** L'agent du banc : un diff sans rapport, ou la régression, selon le titre. */
const agentDuBanc: AgentAdapter = {
  name: 'banc',
  run(task, ctx) {
    if (task.title.startsWith('Casser')) {
      writeFileSync(path.join(ctx.cwd, 'src', 'calcul.js'), 'exports.somme = (a, b) => a - b;\n');
    } else {
      writeFileSync(path.join(ctx.cwd, 'src', 'autre.js'), 'module.exports = "sans rapport";\n');
    }
    return Promise.resolve({ success: true, diff: '', logs: 'écrit', subAgents: [] });
  },
};

/** Une relectrice d'une AUTRE famille, favorable : `accepted` tient à elle (#460). */
const relectriceDuBanc: AgentAdapter = {
  name: 'relectrice',
  run(task) {
    if (!task.title.startsWith('Contre-expertise')) {
      throw new Error(`la relectrice a reçu une production : ${task.title}`);
    }
    return Promise.resolve({
      success: true,
      diff: '',
      logs: 'relu',
      finalText: 'valide',
      subAgents: [],
    });
  },
};

describe.runIf(process.platform !== 'win32')(
  'G11b — les verdicts test par test, de bout en bout',
  () => {
    it('UN TEST DÉJÀ ROUGE À LA BASE N’EMPÊCHE PLUS `accepted` — dit ; UNE RÉGRESSION EST NOMMÉE', async () => {
      const racine = mkdtempSync(path.join(os.tmpdir(), 'verdicts-par-test-e2e-'));
      dossiers.push(racine);
      const depot = await depotDuProjet(racine);
      serveur = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: JETON,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(racine, 'hive.db'),
        simulation: false,
        tickMs: 40,
      });
      const s = serveur;
      const ws = `ws://127.0.0.1:${s.port}/ws`;
      const noeud = (
        nom: string,
        agentType: string,
        adapter: AgentAdapter,
        bac?: ReturnType<typeof fauxBac>,
      ) => {
        const c = new HiveNodeClient({
          url: ws,
          token: JETON,
          name: nom,
          ownerName: 'banc',
          agentType,
          nodeId: nom,
          maxConcurrency: 1,
          workRoot: path.join(racine, nom),
          adapter,
          quiet: true,
          ...(bac ? { bac } : {}),
        });
        clients.push(c);
        c.start();
      };
      noeud('ouvriere-g11b', 'claude-code', agentDuBanc, fauxBac(dossiers));
      noeud('relectrice-codex', 'codex', relectriceDuBanc);
      await attendre(
        () => s.store.listNodes().filter((n) => n.status === 'online').length === 2,
        'les deux nœuds ne rejoignent pas la ruche',
      );
      const projet = s.store.createProject({ name: 'Projet G11b', repoUrl: depot });
      const evaluer = async (tacheId: string) => {
        const reponse = await fetch(`http://127.0.0.1:${s.port}/api/tasks/${tacheId}/evaluation`, {
          headers: { 'x-hive-token': JETON },
        });
        expect(reponse.status).toBe(200);
        return (await reponse.json()) as {
          decision: string;
          reasons: string[];
          evidence: { tests: string; validationProvenance?: { details?: unknown } };
        };
      };
      const produire = async (title: string) => {
        const tache = s.store.createTask({ projectId: projet.id, title, prompt: title });
        s.store.patchTask(tache.id, { status: 'ready' });
        await attendre(() => s.store.getTask(tache.id)?.status === 'done', `${title} : pas de fin`);
        const preuve = s.store.evenementsDeTache(tache.id, ['validation_recorded'])[0];
        return { tacheId: tache.id, preuve };
      };

      // ─── UN DIFF SANS RAPPORT, UN TEST DÉJÀ ROUGE À LA BASE ────────────────
      const sansRapport = await produire('Ajouter src/autre.js');
      expect(sansRapport.preuve?.payload).toMatchObject({
        source: 'hive_sandbox',
        validation: { tests: 'passed' },
        details: {
          tests: {
            raison: 'comparee',
            code: 1,
            comparaison: {
              format: 'node-test',
              regressions: { total: 0 },
              dejaRouges: { total: 1, noms: ['un test déjà rouge à la base'] },
            },
          },
        },
      });
      await attendre(
        () =>
          s.store
            .listEvents(0, 1000)
            .some(
              (e) =>
                e.type === 'contre_expertise_verdict' && e.payload.taskId === sansRapport.tacheId,
            ),
        'la relectrice codex n’a pas rendu son avis',
      );
      const acceptee = await evaluer(sansRapport.tacheId);
      expect(acceptee.decision, acceptee.reasons.join(' · ')).toBe('accepted');
      expect(acceptee.reasons.join(' · ')).toContain(
        'aucune régression — 1 test(s) déjà rouge(s) à la base, que la production n’a pas cassé(s), ' +
          'non bloquant(s) : un test déjà rouge à la base',
      );

      // ─── UNE RÉGRESSION ─────────────────────────────────────────────────────
      const regression = await produire('Casser src/calcul.js');
      expect(regression.preuve?.payload).toMatchObject({
        validation: { tests: 'failed' },
        details: {
          tests: {
            raison: 'comparee',
            comparaison: {
              executions: { tete: 2, base: 2 },
              regressions: { total: 1, noms: ['additionne'] },
            },
          },
        },
      });
      const corrigee = await evaluer(regression.tacheId);
      expect(corrigee.decision).toBe('correction_required');
      expect(corrigee.reasons[0]).toBe(
        'validation tests en échec (bac Hive du nœud ouvriere-g11b)',
      );
      expect(corrigee.reasons[1]).toMatch(
        /^régression comparée à la base [0-9a-f]{8} : additionne — /,
      );
      expect(corrigee.reasons[2]).toBe(
        'déjà rouge(s) à la base, non bloquant(s) : un test déjà rouge à la base',
      );
    }, 150_000);
  },
);
