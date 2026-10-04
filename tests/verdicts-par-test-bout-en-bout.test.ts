// Les verdicts test par test (G11b), de bout en bout : une vraie Reine, un vrai
// nœud (HiveNodeClient), de vrais dépôts git, de vrais `npm run test` qui
// lancent `node --test` — dans le faux moteur de `fixtures/faux-bac.ts` (POSIX).
//
// Le critère de preuve de la carte (lot 7.9), là où il compte — dans le verdict
// que la Reine rend :
//
//   · un test déjà rouge à la base et un diff sans rapport → `accepted`, AVEC
//     la mention du test resté rouge ;
//   · une régression introduite → `correction_required`, le test NOMMÉ dans
//     les motifs que la correction transmet ;
//   · un script dont la sortie ne se reconnaît pas → l'ancien comportement :
//     `correction_required`, « tests en échec », rien de plus ;
//   · un test instable (rouge, puis vert à la relance) → ni régression ni
//     vert : preuve manquante, `additional_test_required`, aucune correction.
//
// Avant ce lot, les quatre finissaient pareil : `correction_required`, « tests
// en échec » — le projet au test déjà rouge ne pouvait plus rien accepter.

import { randomUUID } from 'node:crypto';
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

const TEST_NODE = (nom: string, corps: string) =>
  "const test = require('node:test');\nconst assert = require('node:assert');\n" +
  `test(${JSON.stringify(nom)}, () => {\n${corps}\n});\n`;

/** `node --test`, déclaré comme un projet le déclare. */
const MANIFESTE = (test = 'node --test') =>
  JSON.stringify({ name: 'projet-g11b', version: '1.0.0', private: true, scripts: { test } });

/**
 * Le projet de référence : un test que la base laisse rouge (son module n'a
 * jamais été réparé) et un test vert qu'une production peut casser.
 */
const PROJET: Record<string, string> = {
  'package.json': MANIFESTE(),
  'src/ancien.js': "module.exports = 'cassé';\n",
  'test/ancien.test.js': TEST_NODE(
    'un test déjà rouge à la base',
    "  assert.strictEqual(require('../src/ancien.js'), 'réparé');",
  ),
  'src/calcul.js': 'exports.somme = (a, b) => a + b;\n',
  'test/calcul.test.js': TEST_NODE(
    'additionne',
    "  assert.strictEqual(require('../src/calcul.js').somme(2, 2), 4);",
  ),
};

/** Un dépôt git local, sa base committée. */
async function depot(racine: string, nom: string, fichiers: Record<string, string>) {
  const dir = path.join(racine, nom);
  for (const [fichier, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(dir, fichier)), { recursive: true });
    writeFileSync(path.join(dir, fichier), contenu);
  }
  const git = simpleGit({ baseDir: dir });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  return dir;
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

interface Evaluation {
  decision: string;
  retryRecommended: boolean;
  reasons: string[];
}

/**
 * Une ruche : la Reine, l'ouvrière (`claude-code`, dans le faux bac) et une
 * relectrice `codex`. `produire` attend la fin de la tâche et rend la preuve
 * rangée ; `evaluer` lit le verdict par la route de l'écran.
 */
async function ruche(racine: string) {
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
  const noeud = (nom: string, agentType: string, adapter: AgentAdapter, bac?: boolean) => {
    const c = new HiveNodeClient({
      url: `ws://127.0.0.1:${s.port}/ws`,
      token: JETON,
      name: nom,
      ownerName: 'banc',
      agentType,
      nodeId: nom,
      maxConcurrency: 1,
      workRoot: path.join(racine, nom),
      adapter,
      quiet: true,
      ...(bac ? { bac: fauxBac(dossiers) } : {}),
    });
    clients.push(c);
    c.start();
  };
  noeud('ouvriere-g11b', 'claude-code', agentDuBanc, true);
  noeud('relectrice-codex', 'codex', relectriceDuBanc);
  await attendre(
    () => s.store.listNodes().filter((n) => n.status === 'online').length === 2,
    'les deux nœuds ne rejoignent pas la ruche',
  );
  return {
    s,
    projet: (nom: string, repoUrl: string) => s.store.createProject({ name: nom, repoUrl }).id,
    async produire(projectId: string, title: string) {
      const tache = s.store.createTask({ projectId, title, prompt: title });
      s.store.patchTask(tache.id, { status: 'ready' });
      await attendre(() => s.store.getTask(tache.id)?.status === 'done', `${title} : pas de fin`);
      const preuve = s.store.evenementsDeTache(tache.id, ['validation_recorded'])[0];
      return { tacheId: tache.id, preuve };
    },
    async evaluer(tacheId: string): Promise<Evaluation> {
      const reponse = await fetch(`http://127.0.0.1:${s.port}/api/tasks/${tacheId}/evaluation`, {
        headers: { 'x-hive-token': JETON },
      });
      expect(reponse.status).toBe(200);
      return (await reponse.json()) as Evaluation;
    },
  };
}

function racineDuBanc(): string {
  const racine = mkdtempSync(path.join(os.tmpdir(), 'verdicts-par-test-e2e-'));
  dossiers.push(racine);
  return racine;
}

describe.runIf(process.platform !== 'win32')(
  'G11b — les verdicts test par test, de bout en bout',
  () => {
    it('UN TEST DÉJÀ ROUGE À LA BASE N’EMPÊCHE PLUS `accepted` — dit ; UNE RÉGRESSION EST NOMMÉE', async () => {
      const racine = racineDuBanc();
      const h = await ruche(racine);
      const projet = h.projet('Projet G11b', await depot(racine, 'depot', PROJET));

      // ─── UN DIFF SANS RAPPORT, UN TEST DÉJÀ ROUGE À LA BASE ────────────────
      const sansRapport = await h.produire(projet, 'Ajouter src/autre.js');
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
          h.s.store
            .listEvents(0, 1000)
            .some(
              (e) =>
                e.type === 'contre_expertise_verdict' && e.payload.taskId === sansRapport.tacheId,
            ),
        'la relectrice codex n’a pas rendu son avis',
      );
      const acceptee = await h.evaluer(sansRapport.tacheId);
      expect(acceptee.decision, acceptee.reasons.join(' · ')).toBe('accepted');
      expect(acceptee.reasons.join(' · ')).toContain(
        'aucune régression — déjà rouge(s) à la base, du même échec à la base et à la production, ' +
          'non bloquant(s), 1 test(s) : un test déjà rouge à la base',
      );

      // ─── UNE RÉGRESSION ─────────────────────────────────────────────────────
      const regression = await h.produire(projet, 'Casser src/calcul.js');
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
      const corrigee = await h.evaluer(regression.tacheId);
      expect(corrigee.decision).toBe('correction_required');
      expect(corrigee.reasons[0]).toBe(
        'validation tests en échec (bac Hive du nœud ouvriere-g11b)',
      );
      expect(corrigee.reasons[1]).toMatch(
        /^régression comparée à la base [0-9a-f]{8}, 1 test\(s\) : additionne — /,
      );
      expect(corrigee.reasons[2]).toBe(
        'déjà rouge(s) à la base, du même échec, non bloquant(s), 1 test(s) : un test déjà rouge à la base',
      );
    }, 150_000);

    it('UN SCRIPT NON RECONNU GARDE L’ANCIEN VERDICT ; UN TEST INSTABLE N’EST NI RÉGRESSION NI VERT', async () => {
      const racine = racineDuBanc();
      const h = await ruche(racine);

      // ─── UNE SORTIE QUE PERSONNE NE LIT : le verdict du script, seul ───────
      const muet = h.projet(
        'Projet muet',
        await depot(racine, 'muet', {
          'package.json': MANIFESTE(`node -e "console.log('rien de lisible ici');process.exit(1)"`),
          'src/index.js': 'module.exports = 1;\n',
        }),
      );
      const ancien = await h.produire(muet, 'Ajouter src/autre.js');
      expect(ancien.preuve?.payload).toMatchObject({
        validation: { tests: 'failed' },
        details: { tests: { raison: 'termine', code: 1 } },
      });
      const corrigee = await h.evaluer(ancien.tacheId);
      expect(corrigee.decision).toBe('correction_required');
      expect(corrigee.reasons).toEqual([
        'validation tests en échec (bac Hive du nœud ouvriere-g11b)',
      ]);

      // ─── UN TEST INSTABLE ────────────────────────────────────────────────
      // Il échoue à sa toute première exécution, puis passe : sa marque vit à
      // côté des répertoires de tâche, hors de tout diff, partagée par la tête
      // et la base rejouée.
      const marque = `vacille-${randomUUID()}.vu`;
      const instable = h.projet(
        'Projet instable',
        await depot(racine, 'instable', {
          'package.json': MANIFESTE(),
          'src/index.js': 'module.exports = 1;\n',
          'test/vacille.test.js':
            "const test = require('node:test');\nconst fs = require('node:fs');\n" +
            "const path = require('node:path');\n" +
            `const marque = path.join(path.dirname(process.cwd()), ${JSON.stringify(marque)});\n` +
            "test('vacille une fois', () => {\n  if (fs.existsSync(marque)) return;\n" +
            "  fs.writeFileSync(marque, '');\n  throw new Error('premier passage');\n});\n",
        }),
      );
      const vacille = await h.produire(instable, 'Ajouter src/autre.js');
      expect(vacille.preuve?.payload).toMatchObject({
        validation: { tests: 'missing' },
        details: {
          tests: {
            raison: 'instable',
            comparaison: { instables: { total: 1, noms: ['vacille une fois'] } },
          },
        },
      });
      const manquante = await h.evaluer(vacille.tacheId);
      expect(manquante.decision).toBe('additional_test_required');
      expect(manquante.retryRecommended).toBe(false);
      expect(manquante.reasons.join(' · ')).toContain(
        'tests instables sur le bac du nœud ouvriere-g11b, 1 test(s) : vacille une fois',
      );
    }, 150_000);
  },
);
