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
// Et à l'inverse, RIEN n'est validé — aucune `validation_recorded` — pour :
//
//   · un diff que l'adaptateur fournit lui-même (l'agent simulé n'écrit rien
//     sur le disque) : le bac jugerait la base, pas la production ;
//   · une production en échec : l'échec est déjà le verdict ;
//   · une production sans diff : il n'y a rien à juger.
//
// Et un nœud SANS bac range bien ses validations — `missing`, raison
// `sans_bac` — sans avoir rien lancé : l'Evaluator dit comment en obtenir un.
//
// Le bac du premier cas est le faux moteur de `fixtures/faux-bac.ts` (POSIX).

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { appelsDuFauxBac, fauxBac } from './fixtures/faux-bac.js';

const JETON = 'jeton-validations-bac-suffisamment-long';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let relectrice: HiveNodeClient | null = null;
let dossier = '';
const dossiers: string[] = [];

afterEach(async () => {
  client?.stop();
  client = null;
  relectrice?.stop();
  relectrice = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 30_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/**
 * Le projet : ses tests passent si et seulement si `secure` vaut `true`. Son
 * lint laisse une trace — ce qui dit, sans bac, que rien n'a tourné.
 */
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
        lint: `node -e "require('node:fs').writeFileSync('../lint.ran', '')"`,
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

/**
 * L'agent du banc, selon le titre de la tâche : il écrit (ou non) dans le
 * répertoire, et rend un succès ou un échec.
 */
const agentDuBanc: AgentAdapter = {
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
    // Une relecture : rien d'écrit, donc rien à juger.
    if (task.title.startsWith('Relire')) {
      return { success: true, diff: '', logs: 'rien à changer', subAgents: [] };
    }
    // « Casser » écrit une valeur que les tests refusent — mais un VRAI diff :
    // sans diff, il n'y a rien à valider. « Échouer » écrit aussi, puis
    // échoue : l'échec est déjà le verdict.
    const secure = task.title.startsWith('Sécuriser') ? 'true' : "'presque'";
    writeFileSync(
      path.join(ctx.cwd, 'src', 'feature.js'),
      `module.exports = { secure: ${secure} };\n`,
    );
    const succes = !task.title.startsWith('Échouer');
    return { success: succes, diff: '', logs: 'feature.js réécrit', subAgents: [] };
  },
};

/**
 * La relectrice d'une AUTRE famille (`codex`) : elle rend son avis par le texte
 * final, comme un vrai adaptateur (#462 — la Reine ne lit un verdict que là).
 * Elle ne reçoit que des contre-expertises : à charge égale, la file sert
 * d'abord `ouvriere-bac` (départage par nom), et la relectrice est occupée
 * pendant que la production suivante part.
 */
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

async function demarrer(
  bac: ReturnType<typeof fauxBac> | undefined,
  avecRelectrice = false,
): Promise<{
  s: HiveServer;
  evaluer: (tacheId: string) => Promise<{ decision: string; reasons: string[] }>;
  baseSha: string;
  produire: (
    title: string,
    attendu?: 'done' | 'resultat',
  ) => Promise<{
    tacheId: string;
    resultat: ReturnType<HiveServer['store']['resultsForTask']>[number] | undefined;
    preuves: ReturnType<HiveServer['store']['evenementsDeTache']>;
    evaluation: {
      decision: string;
      reasons: string[];
      evidence: Record<string, unknown> & { validationProvenance?: Record<string, unknown> };
    };
  }>;
}> {
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
    adapter: agentDuBanc,
    quiet: true,
    ...(bac ? { bac } : {}),
  });
  client.start();
  const s = serveur;
  await attendre(
    () => s.store.listNodes().some((n) => n.id === 'noeud-bac' && n.status === 'online'),
    'le nœud ne rejoint pas la ruche',
  );
  if (avecRelectrice) {
    relectrice = new HiveNodeClient({
      url: `ws://127.0.0.1:${serveur.port}/ws`,
      token: JETON,
      name: 'relectrice-codex',
      ownerName: 'banc',
      agentType: 'codex',
      nodeId: 'relectrice-codex',
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'relecture'),
      adapter: relectriceDuBanc,
      quiet: true,
    });
    relectrice.start();
    await attendre(
      () => s.store.listNodes().some((n) => n.id === 'relectrice-codex' && n.status === 'online'),
      'la relectrice ne rejoint pas la ruche',
    );
  }
  const projet = s.store.createProject({ name: 'Projet local', repoUrl: depot });
  const base = `http://127.0.0.1:${s.port}`;
  const headers = { 'x-hive-token': JETON };
  const produire = async (title: string, attendu: 'done' | 'resultat' = 'done') => {
    const tache = s.store.createTask({
      projectId: projet.id,
      title,
      prompt: 'Rendre src/feature.js sûr : exporter secure à true, comme le vérifient les tests.',
    });
    s.store.patchTask(tache.id, { status: 'ready' });
    await attendre(
      () =>
        attendu === 'done'
          ? s.store.getTask(tache.id)?.status === 'done'
          : s.store.resultsForTask(tache.id).length > 0,
      `${title} : pas de ${attendu === 'done' ? 'fin' : 'résultat'}`,
    );
    const resultat = s.store.resultsForTask(tache.id).at(-1);
    const preuves = s.store.evenementsDeTache(tache.id, ['validation_recorded']);
    const reponse = await fetch(`${base}/api/tasks/${tache.id}/evaluation`, { headers });
    expect(reponse.status).toBe(200);
    const evaluation = (await reponse.json()) as {
      decision: string;
      reasons: string[];
      evidence: Record<string, unknown> & { validationProvenance?: Record<string, unknown> };
    };
    return { tacheId: tache.id, resultat, preuves, evaluation };
  };
  const evaluer = async (tacheId: string) => {
    const reponse = await fetch(`${base}/api/tasks/${tacheId}/evaluation`, { headers });
    expect(reponse.status).toBe(200);
    return (await reponse.json()) as { decision: string; reasons: string[] };
  };
  return { s, baseSha, produire, evaluer };
}

describe('validations du bac — du nœud producteur jusqu’à l’Evaluator', () => {
  it.runIf(process.platform !== 'win32')(
    'RANGÉES AVEC LE RÉSULTAT EXACT, LUES PAR L’EVALUATOR, JAMAIS PRÊTÉES À CE QUI N’A RIEN À JUGER',
    async () => {
      const bac = fauxBac(dossiers);
      const { s, baseSha, produire, evaluer } = await demarrer(bac, true);

      // ─── UNE PRODUCTION QUI TIENT SES TESTS ───────────────────────────────
      const saine = await produire('Sécuriser feature.js');
      expect(saine.resultat?.diff).toContain('secure: true');
      // Ses validations tournent dans des conteneurs ÉTIQUETÉS comme la tâche
      // (#486) : sans étiquette, un nœud tué pendant elles les laissait
      // tourner, et son redémarrage ne les ramassait pas.
      const lancements = appelsDuFauxBac(bac);
      expect(lancements.length, 'les validations n’ont rien lancé dans le bac').toBeGreaterThan(0);
      for (const ligne of lancements) {
        expect(ligne).toContain('--label=hive.noeud=noeud-bac');
        expect(ligne).toContain(`--label=hive.tache=${saine.tacheId}`);
      }
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
      expect(saine.evaluation.reasons.join(' · ')).not.toContain('preuves manquantes');
      // Le bout du chemin : sans GitHub, les validations du bac et UNE
      // contre-revue favorable d'une autre famille (#460) suffisent à
      // `accepted` — ce qu'aucune production locale ne pouvait atteindre.
      await attendre(
        () =>
          s.store
            .listEvents(0, 1000)
            .some(
              (e) => e.type === 'contre_expertise_verdict' && e.payload.taskId === saine.tacheId,
            ),
        'la relectrice codex n’a pas rendu son avis',
      );
      const acceptee = await evaluer(saine.tacheId);
      expect(acceptee.decision, acceptee.reasons.join(' · ')).toBe('accepted');
      expect(acceptee.reasons).toContain('validations : bac Hive du nœud noeud-bac');
      expect(acceptee.reasons.join(' · ')).toContain('contre-revue favorable de codex');

      // ─── UNE PRODUCTION QUI CASSE SES TESTS ───────────────────────────────
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

      // ─── CE QUI N'A RIEN À JUGER ──────────────────────────────────────────
      const simulee = await produire('Simuler feature.js');
      expect(simulee.resultat?.diff).toContain('secure: true');
      expect(simulee.preuves, 'aucun vert prêté à un diff simulé').toHaveLength(0);
      expect(simulee.evaluation.evidence).toMatchObject({ tests: 'missing' });
      expect(simulee.evaluation.evidence).not.toHaveProperty('validationProvenance');

      const relue = await produire('Relire feature.js');
      expect(relue.resultat?.diff).toBe('');
      expect(relue.preuves, 'rien à juger sans diff').toHaveLength(0);

      // En dernier : ses tentatives suivantes peuvent encore occuper le nœud.
      const echouee = await produire('Échouer sur feature.js', 'resultat');
      expect(echouee.resultat?.success).toBe(false);
      expect(echouee.preuves, 'l’échec est déjà le verdict').toHaveLength(0);
    },
    120_000,
  );

  it('UN NŒUD SANS BAC NE LANCE RIEN — il le range, et l’Evaluator dit comment en obtenir un', async () => {
    const { produire } = await demarrer(undefined);

    const saine = await produire('Sécuriser feature.js');

    expect(saine.preuves).toHaveLength(1);
    expect(saine.preuves[0]?.payload).toMatchObject({
      source: 'hive_sandbox',
      resultId: saine.resultat?.resultId,
      validation: {
        tests: 'missing',
        typecheck: 'not_applicable',
        build: 'not_applicable',
        lint: 'missing',
      },
      details: { tests: { raison: 'sans_bac', script: 'test' } },
    });
    // Le lint du projet laisse une trace à côté du dépôt : il n'a pas tourné.
    expect(existsSync(path.join(dossier, 'travail', 'tasks', 'lint.ran'))).toBe(false);
    expect(saine.evaluation.decision).toBe('additional_test_required');
    expect(saine.evaluation.reasons.join(' · ')).toContain(
      'n’a pas de bac à sable : le code d’un agent ne tourne pas sur l’hôte nu',
    );
  }, 60_000);
});
