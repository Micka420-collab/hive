// Les validations du bac, de bout en bout : un vrai nœud (HiveNodeClient), une
// vraie Reine, un vrai dépôt git local, de vrais `npm run`.
//
// ─── LE CONTRAT ──────────────────────────────────────────────────────────────
//
// Une production réussie sur un projet qui déclare ses scripts doit arriver à
// l'Evaluator AVEC ses validations — rangées par la Reine en
// `validation_recorded`, source `hive_sandbox`, liées au `resultId` EXACT, au
// nœud qui les a lancées et au commit de base. Sans ce lot, un projet sans
// GitHub restait `additional_test_required` pour toujours : aucune preuve ne
// pouvait exister pour lui.
//
// Et à l'inverse : un diff que l'adaptateur fournit lui-même (l'agent simulé
// n'écrit rien sur le disque) n'est JAMAIS validé — le bac jugerait la base,
// pas la production, et prêterait ses verts à un diff qu'il n'a pas vu.
//
// Ce banc n'importe que des modules qui existaient avant le lot : sur l'ancien
// code, il rougit parce que la preuve n'arrive pas — pas faute d'un import.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-validations-bac-suffisamment-long';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let dossier = '';

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 30_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/** Le projet : ses tests passent si et seulement si `secure` vaut `true`. */
async function depotDuProjet(racine: string): Promise<{ depot: string; baseSha: string }> {
  const depot = path.join(racine, 'depot');
  mkdirSync(path.join(depot, 'src'), { recursive: true });
  writeFileSync(path.join(depot, 'src', 'feature.js'), 'module.exports = { secure: false };\n');
  writeFileSync(
    path.join(depot, 'package.json'),
    JSON.stringify({
      name: 'projet-local',
      version: '1.0.0',
      private: true,
      scripts: {
        test: `node -e "process.exit(require('./src/feature.js').secure === true ? 0 : 1)"`,
        lint: 'node -e "process.exit(0)"',
      },
    }),
  );
  const git = simpleGit({ baseDir: depot });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  return { depot, baseSha: (await git.revparse(['HEAD'])).trim() };
}

describe('validations du bac — du nœud producteur jusqu’à l’Evaluator', () => {
  it('RANGÉES AVEC LE RÉSULTAT EXACT, LUES PAR L’EVALUATOR, JAMAIS PRÊTÉES À UN DIFF SIMULÉ', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'validations-bac-e2e-'));
    const { depot, baseSha } = await depotDuProjet(dossier);
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${serveur.port}/ws`,
      token: JETON,
      name: 'ouvriere-bac',
      ownerName: 'banc',
      agentType: 'claude-code',
      nodeId: 'noeud-bac',
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      adapter: {
        name: 'banc',
        async run(task, ctx) {
          // L'agent « simulé » rend un diff à lui, sans rien écrire.
          if (task.title.startsWith('Simuler')) {
            return {
              success: true,
              diff: 'diff --git a/src/feature.js b/src/feature.js\n+module.exports = { secure: true };',
              logs: 'simulé',
              subAgents: [],
            };
          }
          // « Casser » écrit une valeur que les tests refusent — mais un VRAI
          // diff : sans diff, il n'y a rien à valider.
          const secure = task.title.startsWith('Sécuriser') ? 'true' : "'presque'";
          writeFileSync(
            path.join(ctx.cwd, 'src', 'feature.js'),
            `module.exports = { secure: ${secure} };\n`,
          );
          return { success: true, diff: '', logs: 'feature.js réécrit', subAgents: [] };
        },
      },
      quiet: true,
    });
    client.start();
    const s = serveur;
    await attendre(
      () => s.store.listNodes().some((n) => n.id === 'noeud-bac' && n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    const projet = s.store.createProject({ name: 'Projet local', repoUrl: depot });
    const base = `http://127.0.0.1:${s.port}`;
    const headers = { 'x-hive-token': JETON };
    const produire = async (title: string) => {
      const tache = s.store.createTask({
        projectId: projet.id,
        title,
        prompt: 'Rendre src/feature.js sûr : exporter secure à true, comme le vérifient les tests.',
      });
      s.store.patchTask(tache.id, { status: 'ready' });
      await attendre(() => s.store.getTask(tache.id)?.status === 'done', `${title} : pas terminée`);
      const resultat = s.store.resultsForTask(tache.id).at(-1);
      const preuves = s.store.evenementsDeTache(tache.id, ['validation_recorded']);
      const reponse = await fetch(`${base}/api/tasks/${tache.id}/evaluation`, { headers });
      expect(reponse.status).toBe(200);
      const evaluation = (await reponse.json()) as {
        decision: string;
        reasons: string[];
        evidence: Record<string, unknown> & {
          validationProvenance?: Record<string, unknown>;
        };
      };
      return { resultat, preuves, evaluation };
    };

    // ─── UNE PRODUCTION QUI TIENT SES TESTS ─────────────────────────────────
    const saine = await produire('Sécuriser feature.js');
    expect(saine.resultat?.diff).toContain('secure: true');
    expect(saine.preuves).toHaveLength(1);
    expect(saine.preuves[0]?.payload).toMatchObject({
      source: 'hive_sandbox',
      resultId: saine.resultat?.resultId,
      nodeId: 'noeud-bac',
      baseSha,
      validation: {
        tests: 'passed',
        typecheck: 'not_applicable',
        build: 'not_applicable',
        lint: 'passed',
      },
      details: { tests: { raison: 'termine', script: 'test', code: 0 } },
    });
    expect(saine.evaluation.evidence).toMatchObject({
      tests: 'passed',
      typecheck: 'not_applicable',
      build: 'not_applicable',
      lint: 'passed',
      validationProvenance: {
        source: 'hive_sandbox',
        nodeId: 'noeud-bac',
        resultId: saine.resultat?.resultId,
      },
    });
    expect(saine.evaluation.decision).not.toBe('additional_test_required');
    expect(saine.evaluation.reasons.join(' · ')).not.toContain('preuves manquantes');

    // ─── UNE PRODUCTION QUI CASSE SES TESTS ─────────────────────────────────
    const cassee = await produire('Casser feature.js');
    expect(cassee.preuves[0]?.payload).toMatchObject({
      resultId: cassee.resultat?.resultId,
      validation: { tests: 'failed', lint: 'passed' },
      details: { tests: { raison: 'termine', code: 1 } },
    });
    expect(cassee.evaluation.decision).toBe('correction_required');
    expect(cassee.evaluation.reasons).toContain(
      'validation tests en échec (bac Hive du nœud noeud-bac)',
    );

    // ─── UN DIFF QUE LE BAC N'A PAS VU ──────────────────────────────────────
    const simulee = await produire('Simuler feature.js');
    expect(simulee.resultat?.diff).toContain('secure: true');
    expect(simulee.preuves, 'aucun vert prêté à un diff simulé').toHaveLength(0);
    expect(simulee.evaluation.evidence).toMatchObject({ tests: 'missing' });
    expect(simulee.evaluation.evidence).not.toHaveProperty('validationProvenance');
  }, 90_000);
});
