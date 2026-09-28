// MISSION CONTROL, CÔTÉ REINE — les routes du rapport de mission, du bilan d'un
// Worker et du cockpit de l'accueil, éprouvées sur une vraie Reine.
//
// Les replis sont éprouvés seuls (`rapport-mission`, `economie-worker`,
// `cockpit`) ; ce banc tient ce qu'ils ne peuvent pas voir : que le serveur
// leur donne les BONS faits. La décision de l'Evaluator d'une ligne de
// mission est celle du tiroir de la tâche ; le sort d'une production
// renvoyée en correction vient du journal ; une relecture impossible qu'un
// humain a tranchée quitte le cockpit.
//
// Chaque test monte SA Reine et pose SES faits : le tamis des ordres
// (`scripts/tamis-ordres.mjs`) rejoue ce banc dans un ordre tiré au sort, et
// un test qui comptait les productions de son voisin n'éprouvait que l'ordre
// où il avait été écrit.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-mission-control-assez-long-42';
const headers = { 'x-hive-token': TOKEN };
const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-a
+b`;

describe('Mission Control — rapport de mission, bilan Worker, cockpit', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projet = '';

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-mission-'));
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
    for (const [nodeId, agentType] of [
      ['prod', 'claude-code'],
      ['relecteur', 'codex'],
    ] as const) {
      server.store.registerNode({
        nodeId,
        name: nodeId,
        ownerName: 'test',
        agentType,
        maxConcurrency: 1,
        modeles: ['opus'],
      });
    }
    projet = server.store.createProject({ name: 'Mission', repoUrl: 'file:///repo' }).id;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Une production de `prod` (claude-code) que l'Evaluator ACCEPTE : résultat
   * réussi, Gardiennes propres, CI verte sur ce résultat exact, contre-revue
   * favorable d'une autre famille — le chemin de `evaluator-endpoint.test.ts`.
   */
  function productionAcceptee(
    titre: string,
    coutUsd?: number,
  ): { taskId: string; resultId: number } {
    const task = server.store.createTask({ projectId: projet, title: titre, prompt: titre });
    server.store.appendEvent('task_assigned', { taskId: task.id, nodeId: 'prod', modele: 'opus' });
    server.store.patchTask(task.id, { status: 'done' });
    const resultId = server.store.insertResult({
      taskId: task.id,
      nodeId: 'prod',
      diff: DIFF,
      logs: '',
      success: true,
      durationMs: 1_000,
      subAgents: [],
    });
    server.store.appendEvent('task_done', {
      taskId: task.id,
      nodeId: 'prod',
      durationMs: 1_000,
      ...(coutUsd === undefined ? {} : { fournisseur: { coutUsd } }),
    });
    server.store.enregistrerInspection({
      resultId,
      taskId: task.id,
      nodeId: 'prod',
      verdict: 'clean',
      score: 0,
      applique: false,
      griefs: [],
    });
    server.store.appendEvent('ci_validation_recorded', {
      source: 'github_pull_request',
      taskId: task.id,
      projectId: projet,
      resultId,
      depot: 'demo/hive',
      pr: 7,
      branch: `hive/${task.id}`,
      commitSha: 'commit-accepte',
      validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
      recordedAt: 1,
    });
    server.store.appendEvent('contre_expertise_verdict', {
      source: 'hive_counter_review',
      taskId: task.id,
      resultId,
      relecture: `${task.id}-relecture`,
      relecteur: 'codex',
      reviewerNodeId: 'relecteur',
      producteur: 'claude-code',
      conteste: false,
      objections: [],
      recordedAt: 1,
    });
    return { taskId: task.id, resultId };
  }

  /**
   * Une production de `prod` que l'Evaluator RENVOIE en correction : son sort
   * vient du journal (`task_retry` de source `evaluator`, lié à son
   * `resultId`), et la tâche retourne en file.
   */
  function productionCorrigee(titre: string): void {
    const corrigee = productionAcceptee(titre);
    server.store.appendEvent('task_retry', {
      taskId: corrigee.taskId,
      source: 'evaluator',
      resultId: corrigee.resultId,
      decision: 'correction_required',
      attempt: 1,
      maxAttempts: 3,
      critique: { source: 'contre_revue', objections: ['incomplet'], raisons: [] },
    });
    server.store.patchTask(corrigee.taskId, { status: 'ready' });
  }

  it('le rapport de mission dit la décision de l’Evaluator — celle du tiroir — et la dépense avec sa couverture', async () => {
    const acceptee = productionAcceptee('Écrire le module A', 0.4);
    const muette = productionAcceptee('Écrire le module B');

    const sansDetail = (await (
      await fetch(`${base}/api/projects/${projet}/report`, { headers })
    ).json()) as Record<string, unknown>;
    expect(sansDetail).not.toHaveProperty('mission');

    const res = await fetch(`${base}/api/projects/${projet}/report?detail=mission`, { headers });
    expect(res.status).toBe(200);
    const { mission } = (await res.json()) as {
      mission: {
        taches: Array<{
          taskId: string;
          evaluator: { decision: string } | null;
          relecture: { issue: string } | null;
          modeles: string[];
        }>;
        totaux: { coutFournisseur: unknown; decisions: Record<string, number> };
      };
    };
    const tiroir = (await (
      await fetch(`${base}/api/tasks/${acceptee.taskId}/evaluation`, { headers })
    ).json()) as { decision: string };
    const ligne = mission.taches.find((l) => l.taskId === acceptee.taskId);
    expect(tiroir.decision).toBe('accepted');
    expect(ligne?.evaluator?.decision).toBe(tiroir.decision);
    expect(ligne?.relecture?.issue).toBe('favorable');
    expect(ligne?.modeles).toEqual(['opus']);
    expect(mission.taches.find((l) => l.taskId === muette.taskId)?.evaluator?.decision).toBe(
      'accepted',
    );
    // Une production sur deux déclare son coût : « au moins », jamais extrapolé.
    expect(mission.totaux.coutFournisseur).toEqual({ total: 0.4, declarees: 1, tentatives: 2 });
    expect(mission.totaux.decisions.accepted).toBe(2);
  });

  it('refuse un détail inconnu plutôt que de l’ignorer', async () => {
    const res = await fetch(`${base}/api/projects/${projet}/report?detail=tout`, { headers });
    expect(res.status).toBe(400);
  });

  it('GET /api/workers porte l’économie de chaque Worker et la fenêtre lue', async () => {
    productionAcceptee('Écrire le module A', 0.4);
    productionAcceptee('Écrire le module B');
    const res = await fetch(`${base}/api/workers`, { headers });
    const body = (await res.json()) as {
      workers: Array<{
        id: string;
        economie?: { tentatives: number; coutFournisseur: unknown; dureeMedianeMs: number | null };
        modeles?: Array<{ modele: string; economie?: { tentatives: number } }>;
      }>;
      fenetreEconomie: { tronquee: boolean };
    };
    const prod = body.workers.find((w) => w.id === 'prod');
    expect(prod?.economie?.tentatives).toBe(2);
    expect(prod?.economie?.dureeMedianeMs).toBe(1_000);
    expect(prod?.modeles?.find((m) => m.modele === 'opus')?.economie?.tentatives).toBe(
      prod?.economie?.tentatives,
    );
    expect(body.workers.find((w) => w.id === 'relecteur')?.economie?.tentatives).toBe(0);
    expect(body.fenetreEconomie.tronquee).toBe(false);
  });

  it('le bilan d’un Worker : la part ACCEPTÉE par l’Evaluator et son taux de correction', async () => {
    productionAcceptee('Écrire le module A', 0.4);
    productionAcceptee('Écrire le module B');
    productionCorrigee('Écrire le module C');

    const res = await fetch(`${base}/api/workers/prod/bilan`, { headers });
    expect(res.status).toBe(200);
    const bilan = (await res.json()) as {
      qualite: {
        productions: number;
        jugees: number;
        acceptees: number;
        partAcceptee: number | 'inconnu';
        corrigees: number;
        tauxCorrection: number | 'inconnu';
      };
      economie: { total: { tentatives: number }; parModele: Array<{ modele: string }> };
    };
    expect(bilan.qualite).toMatchObject({ productions: 3, jugees: 3, acceptees: 2, corrigees: 1 });
    expect(bilan.qualite.partAcceptee).toBeCloseTo(2 / 3);
    expect(bilan.qualite.tauxCorrection).toBeCloseTo(1 / 3);
    expect(bilan.economie.parModele.map((m) => m.modele)).toEqual(['opus']);

    // Le relecteur n'a rien produit : sa qualité est inconnue, pas nulle.
    const relecteur = (await (
      await fetch(`${base}/api/workers/relecteur/bilan`, { headers })
    ).json()) as { qualite: { partAcceptee: unknown; tauxCorrection: unknown } };
    expect(relecteur.qualite.partAcceptee).toBe('inconnu');
    expect(relecteur.qualite.tauxCorrection).toBe('inconnu');
  });

  type Qualite = {
    productions: number;
    sortConnu: number;
    corrigees: number;
    bornee: number | null;
  };
  const qualiteDe = async (nodeId: string): Promise<Qualite> =>
    (
      (await (await fetch(`${base}/api/workers/${nodeId}/bilan`, { headers })).json()) as {
        qualite: Qualite;
      }
    ).qualite;

  it('une relecture croisée rendue par le Worker n’est pas une de ses productions', async () => {
    const { taskId } = productionAcceptee('Écrire le module A');
    const relecture = server.store.createTask({
      projectId: projet,
      title: 'Relire le module A',
      prompt: 'relire',
    });
    server.store.inscrireRelecture({
      relectureTaskId: relecture.id,
      productionTaskId: taskId,
      relecteurNodeId: 'prod',
      relecteurAgent: 'claude-code',
      producteurAgent: 'codex',
    });
    server.store.patchTask(relecture.id, { status: 'done' });
    server.store.insertResult({
      taskId: relecture.id,
      nodeId: 'prod',
      diff: '',
      logs: 'avis : appliquer',
      success: true,
      durationMs: 500,
      subAgents: [],
    });
    expect(await qualiteDe('prod')).toMatchObject({ productions: 1, sortConnu: 1, bornee: null });
  });

  it('un journal élagué ne juge que les productions dont le sort est encore lisible', async () => {
    // Une production renvoyée en correction il y a longtemps : son renvoi n'est
    // rangé qu'au journal, que l'élagage emporte.
    const ancienne = server.store.createTask({ projectId: projet, title: 'Vieille', prompt: 'v' });
    const resultId = server.store.insertResult(
      {
        taskId: ancienne.id,
        nodeId: 'prod',
        diff: DIFF,
        logs: '',
        success: true,
        durationMs: 1_000,
        subAgents: [],
      },
      1_000,
    );
    server.store.appendEvent('task_done', { taskId: ancienne.id, nodeId: 'prod' }, 1_000);
    server.store.appendEvent(
      'task_retry',
      { taskId: ancienne.id, source: 'evaluator', resultId, decision: 'correction_required' },
      1_000,
    );
    server.store.pruneEvents(0);
    expect(server.store.journalElague()).toBe(true);
    // La fenêtre s'ouvre au plus ancien fait d'issue retenu. Un résultat est
    // rangé quelques millisecondes AVANT son `task_done` : sans une issue
    // retenue un peu plus ancienne, la première production tomberait au bord
    // de la fenêtre selon l'horloge de la machine (vu sur macOS et Windows).
    server.store.appendEvent(
      'task_failed',
      { taskId: 'autre', nodeId: 'relecteur', error: 'x' },
      Date.now() - 60_000,
    );
    for (const titre of ['A', 'B', 'C']) productionAcceptee(`Écrire le module ${titre}`);
    // Jugée, la vieille production passerait pour « sort inconnu » : trois, pas quatre.
    expect(await qualiteDe('prod')).toMatchObject({ productions: 3, sortConnu: 3, corrigees: 0 });
  });

  it('le bilan est gardé, et une ouvrière inconnue se dit', async () => {
    expect((await fetch(`${base}/api/workers/prod/bilan`)).status).toBe(401);
    expect((await fetch(`${base}/api/workers/personne/bilan`, { headers })).status).toBe(404);
  });

  it('le cockpit : une relecture impossible alerte jusqu’à ce qu’un humain tranche', async () => {
    productionAcceptee('Écrire le module A', 0.4);
    productionCorrigee('Écrire le module C');
    const { taskId, resultId } = productionAcceptee('Écrire le module D');
    server.store.appendEvent('contre_expertise_impossible', {
      taskId,
      resultId,
      relecture: `${taskId}-relecture`,
      relecteur: 'codex',
      producteur: 'claude-code',
      cause: 'aucune autre famille en ligne',
    });
    type Cockpit = {
      decisions: Array<{ evenement: { type: string }; titre: string | null }>;
      depense: { tentatives: number; coutFournisseur: unknown };
      alertes: Array<{ genre: string; taskId?: string }>;
      total: number;
    };
    const lire = async (): Promise<Cockpit> =>
      (await (await fetch(`${base}/api/cockpit`, { headers })).json()) as Cockpit;

    const avant = await lire();
    expect(avant.alertes).toContainEqual(
      expect.objectContaining({ genre: 'relecture_impossible', taskId }),
    );
    expect(avant.decisions.map((d) => d.evenement.type)).toContain('contre_expertise_impossible');
    expect(avant.decisions.find((d) => d.evenement.type === 'task_retry')?.titre).toBe(
      'Écrire le module C',
    );
    expect(avant.depense.tentatives).toBe(3);
    expect(avant.depense.coutFournisseur).toMatchObject({ total: 0.4, declarees: 1 });

    server.store.setTaskReview(taskId, 'approved');
    const apres = await lire();
    expect(apres.alertes.some((a) => a.taskId === taskId)).toBe(false);
  });

  it('le cockpit est derrière le jeton de ruche', async () => {
    expect((await fetch(`${base}/api/cockpit`)).status).toBe(401);
  });
});
