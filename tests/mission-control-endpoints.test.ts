// MISSION CONTROL, CÔTÉ REINE — les routes du rapport de mission, du bilan d'un
// Worker et du cockpit de l'accueil, éprouvées sur une vraie Reine.
//
// Les replis sont éprouvés seuls (`rapport-mission`, `economie-worker`,
// `cockpit`) ; ce banc tient ce qu'ils ne peuvent pas voir : que le serveur
// leur donne les BONS faits. La décision de l'Evaluator d'une ligne de
// mission est celle du tiroir de la tâche ; le sort d'une production
// renvoyée en correction vient du journal ; une relecture impossible qu'un
// humain a tranchée quitte le cockpit.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  beforeAll(async () => {
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

  afterAll(async () => {
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
    expect(prod?.economie?.tentatives).toBeGreaterThanOrEqual(2);
    expect(prod?.economie?.dureeMedianeMs).toBe(1_000);
    expect(prod?.modeles?.find((m) => m.modele === 'opus')?.economie?.tentatives).toBe(
      prod?.economie?.tentatives,
    );
    expect(body.workers.find((w) => w.id === 'relecteur')?.economie?.tentatives).toBe(0);
    expect(body.fenetreEconomie.tronquee).toBe(false);
  });

  it('le bilan d’un Worker : la part ACCEPTÉE par l’Evaluator et son taux de correction', async () => {
    // Une production renvoyée en correction : son sort vient du journal.
    const corrigee = productionAcceptee('Écrire le module C');
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

  it('le bilan est gardé, et une ouvrière inconnue se dit', async () => {
    expect((await fetch(`${base}/api/workers/prod/bilan`)).status).toBe(401);
    expect((await fetch(`${base}/api/workers/personne/bilan`, { headers })).status).toBe(404);
  });

  it('le cockpit : une relecture impossible alerte jusqu’à ce qu’un humain tranche', async () => {
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
    expect(avant.depense.tentatives).toBeGreaterThanOrEqual(4);
    expect(avant.depense.coutFournisseur).toMatchObject({ total: 0.4, declarees: 1 });

    server.store.setTaskReview(taskId, 'approved');
    const apres = await lire();
    expect(apres.alertes.some((a) => a.taskId === taskId)).toBe(false);
  });

  it('le cockpit est derrière le jeton de ruche', async () => {
    expect((await fetch(`${base}/api/cockpit`)).status).toBe(401);
  });
});
