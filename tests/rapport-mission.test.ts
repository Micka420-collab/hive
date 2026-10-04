// LE RAPPORT DE MISSION — ce que chaque tâche a donné, et ce que la mission a
// coûté, replié du journal et des évaluations que le serveur calcule.
//
// ─── CE QUE CE BANC DÉFEND ───────────────────────────────────────────────────
//
//   · les reprises sont comptées PAR SOURCE : un Worker qui tombe, une remise
//     en file, une correction demandée par la contre-revue ou par un humain ;
//   · l'Evaluator n'est dit que pour une PRODUCTION terminée — une relecture
//     croisée coûte, mais personne ne la juge ;
//   · la dépense de la mission somme les tentatives de toutes ses tâches avec
//     leur couverture : une tâche muette ne devient pas une tâche gratuite ;
//   · une tentative y est celle de `economie.ts` — les cartes Worker, le bilan
//     et le cockpit : un échec sans nœud n'en est pas une, un drone échoué qui
//     a déclaré son coût en est une, et le total fait la somme du Genome ;
//   · un journal élagué UNE fois n'avertit que les missions dont un fait a
//     réellement pu sortir de la lecture ;
//   · rien d'un autre projet n'entre dans le rapport, ni dans son Genome.

import { describe, expect, it } from 'vitest';
import { rapportDeMission } from '../src/orchestrator/project-report.js';
import type { EntreeMission } from '../src/orchestrator/project-report.js';
import { evaluate, missingCrossReviewEvidence } from '../src/orchestrator/evaluator.js';
import type { EvaluationResult } from '../src/orchestrator/evaluator.js';
import { bilanEconomique, tentativesDepuisEvenements } from '../src/shared/economie.js';
import type { HiveEvent, Task, TaskStatus } from '../src/shared/types.js';

let seq = 0;
const ev = (type: string, payload: Record<string, unknown>): HiveEvent => {
  seq += 1;
  return { id: seq, ts: 1_000 + seq * 10, type, payload };
};

const tache = (id: string, status: TaskStatus, createdAt: number, title = id): Task => ({
  id,
  projectId: 'p1',
  title,
  prompt: 'écrire le module',
  status,
  dependsOn: [],
  assignedNodeId: null,
  result: null,
  branch: null,
  attempts: 0,
  createdAt,
  updatedAt: createdAt,
});

/** Une évaluation réelle (`evaluate`), sur une production relue favorablement. */
function evaluationFavorable(taskId: string): EvaluationResult {
  return evaluate({
    taskId,
    taskStatus: 'done',
    results: [
      {
        resultId: 9,
        taskId,
        nodeId: 'n1',
        success: true,
        diff: 'diff --git a/a b/a',
        logs: '',
        durationMs: 10,
        subAgents: [],
      },
    ],
    inspection: { verdict: 'clean', score: 0, griefs: [] },
    validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
    crossReview: {
      ...missingCrossReviewEvidence(taskId, 9),
      status: 'applied',
      decision: 'appliquer',
      reviewerCount: 1,
      approvingReviewers: 1,
      reviewers: [
        {
          relectureTaskId: 'rel',
          reviewerNodeId: 'n2',
          reviewerAgent: 'codex',
          producerAgent: 'claude-code',
          decision: 'appliquer',
          reason: 'ok',
          recordedAt: 1,
        },
      ],
    },
  });
}

function entree(patch: Partial<EntreeMission> = {}): EntreeMission {
  return {
    taches: [],
    evenements: [],
    borne: 5_000,
    journalElague: false,
    relectures: new Set(),
    evaluations: new Map(),
    ...patch,
  };
}

describe('le rapport de mission', () => {
  it('compte les reprises par SOURCE, pour chaque tâche et pour la mission', () => {
    const evenements = [
      ev('task_retry', { taskId: 'a', nodeId: 'n1', durationMs: 5 }),
      ev('task_requeued', { taskId: 'a', nodeId: 'n1', reason: 'node_lost' }),
      ev('task_done', { taskId: 'a', nodeId: 'n1', durationMs: 7 }),
      ev('task_retry', {
        taskId: 'a',
        source: 'evaluator',
        decision: 'correction_required',
        critique: { source: 'contre_revue', objections: ['x'], raisons: [] },
      }),
      ev('task_retry', {
        taskId: 'a',
        source: 'evaluator',
        decision: 'correction_required',
        critique: { source: 'revue_humaine', objections: [], raisons: [] },
      }),
      // Un renvoi journalisé sans sa critique : une correction, de source inconnue.
      ev('task_retry', { taskId: 'a', source: 'evaluator', decision: 'rejected' }),
    ];
    const r = rapportDeMission(entree({ taches: [tache('a', 'running', 1)], evenements }));
    expect(r.taches[0]?.reprises).toEqual({
      worker: 1,
      remise_en_file: 1,
      contre_revue: 1,
      revue_humaine: 1,
      evaluator: 0,
      inconnue: 1,
    });
    expect(r.totaux.reprises).toEqual(r.taches[0]?.reprises);
  });

  it('l’Evaluator est dit pour une production terminée, jamais pour une relecture', () => {
    const r = rapportDeMission(
      entree({
        taches: [tache('prod', 'done', 1), tache('rel', 'done', 2), tache('encours', 'running', 3)],
        relectures: new Set(['rel']),
        evaluations: new Map([
          ['prod', evaluationFavorable('prod')],
          // Une évaluation fournie pour une relecture ne doit pas être lue.
          ['rel', evaluationFavorable('rel')],
        ]),
      }),
    );
    const [prod, rel, encours] = r.taches;
    expect(prod?.role).toBe('production');
    expect(prod?.evaluator?.decision).toBe('accepted');
    expect(prod?.relecture).toMatchObject({ issue: 'favorable', favorables: 1, contestataires: 0 });
    expect(rel?.role).toBe('relecture');
    expect(rel?.evaluator).toBeNull();
    expect(rel?.relecture).toBeNull();
    expect(encours?.evaluator).toBeNull();
    expect(r.totaux.decisions).toEqual({
      accepted: 1,
      correction_required: 0,
      rejected: 0,
      additional_test_required: 0,
      human_review_required: 0,
    });
  });

  it('une contre-revue qui conteste l’emporte sur une relecture encore en vol', () => {
    const base = evaluationFavorable('t');
    const contestee: EvaluationResult = {
      ...base,
      evidence: {
        ...base.evidence,
        crossReviewPending: 1,
        crossReview: {
          ...base.evidence.crossReview,
          status: 'improvement_required',
          contestingReviewers: 1,
          approvingReviewers: 0,
        },
      },
    };
    const r = rapportDeMission(
      entree({ taches: [tache('t', 'done', 1)], evaluations: new Map([['t', contestee]]) }),
    );
    expect(r.taches[0]?.relecture?.issue).toBe('contestee');
    expect(r.taches[0]?.relecture?.enVol).toBe(1);
  });

  it('somme la dépense de la mission avec sa couverture, sans rien d’un autre projet', () => {
    const evenements = [
      ev('task_assigned', { taskId: 'a', nodeId: 'n1', modele: 'opus' }),
      ev('task_done', {
        taskId: 'a',
        nodeId: 'n1',
        durationMs: 100,
        fournisseur: { coutUsd: 0.5, dureeApiMs: 60 },
      }),
      ev('task_assigned', { taskId: 'b', nodeId: 'n2', modele: 'gpt' }),
      ev('task_done', { taskId: 'b', nodeId: 'n2', durationMs: 300 }),
      // Un autre projet, dans le même journal : il ne compte nulle part.
      ev('task_assigned', { taskId: 'ailleurs', nodeId: 'n1', modele: 'opus' }),
      ev('task_done', { taskId: 'ailleurs', nodeId: 'n1', fournisseur: { coutUsd: 99 } }),
    ];
    const r = rapportDeMission(
      entree({ taches: [tache('b', 'done', 2), tache('a', 'done', 1)], evenements }),
    );
    // L'ordre de création : la mission se lit dans l'ordre où elle a été posée.
    expect(r.taches.map((l) => l.taskId)).toEqual(['a', 'b']);
    expect(r.taches.map((l) => l.modeles)).toEqual([['opus'], ['gpt']]);
    expect(r.totaux.tentatives).toBe(2);
    expect(r.totaux.coutFournisseur).toEqual({ total: 0.5, declarees: 1, tentatives: 2 });
    expect(r.totaux.dureeModele).toEqual({ total: 60, declarees: 1, tentatives: 2 });
    expect(r.totaux.dureeWorkerTotaleMs).toBe(400);
    expect(r.genome.lignes.map((l) => l.modele).sort()).toEqual(['gpt', 'opus']);
    expect(r.genome.lignes.find((l) => l.modele === 'opus')?.coutFournisseur).toEqual({
      total: 0.5,
      declarees: 1,
      tentatives: 1,
    });
    expect(r.fenetre).toMatchObject({ evenements: 4, tronquee: false });
  });

  it('dit que la fenêtre a pu perdre des faits', () => {
    const r = rapportDeMission(entree({ taches: [tache('a', 'done', 1)], journalElague: true }));
    expect(r.fenetre.tronquee).toBe(true);
    expect(r.genome.fenetre.tronquee).toBe(true);
    expect(r.totaux.coutFournisseur).toBe('inconnu');
  });

  it('une tentative est celle de l’économie : ni l’échec sans nœud, ni l’oubli du drone échoué', () => {
    const evenements = [
      ev('drone_race_started', {
        taskId: 'a',
        drones: ['n1', 'n2'],
        modeles: { n1: 'opus', n2: 'gpt' },
      }),
      ev('task_assigned', { taskId: 'a', nodeId: 'n1', modele: 'opus' }),
      // Le drone perdant a tourné, échoué, et déclaré ce qu'il a coûté.
      ev('drone_failed', { taskId: 'a', nodeId: 'n2', fournisseur: { coutUsd: 2 } }),
      ev('task_done', { taskId: 'a', nodeId: 'n1', fournisseur: { coutUsd: 1 } }),
      // Des échecs que personne n'a exécutés : ils ne sont la tentative de personne.
      ev('task_failed', { taskId: 'b', reason: 'dependency_failed' }),
      ev('task_failed', { taskId: 'c', reason: 'no_working_agent', infraRejects: 3 }),
    ];
    const r = rapportDeMission(
      entree({
        taches: [tache('a', 'done', 1), tache('b', 'failed', 2), tache('c', 'failed', 3)],
        evenements,
      }),
    );
    const economie = bilanEconomique(tentativesDepuisEvenements(evenements));
    expect(r.totaux.tentatives).toBe(2);
    expect(r.totaux.coutFournisseur).toEqual({ total: 3, declarees: 2, tentatives: 2 });
    expect(r.totaux.coutFournisseur).toEqual(economie.coutFournisseur);
    const sommeGenome = r.genome.lignes.reduce(
      (s, l) => s + (l.coutFournisseur === 'inconnu' ? 0 : l.coutFournisseur.total),
      0,
    );
    expect(sommeGenome).toBe(3);
  });

  it('un journal élagué avant la mission ne l’avertit pas', () => {
    // Le plus ancien fait lu (ts 1 010 et plus) précède la première tâche : rien
    // de cette mission n'a pu sortir de la lecture, même si la ruche a déjà élagué.
    const evenements = [
      ev('task_assigned', { taskId: 'ancienne', nodeId: 'n1' }),
      ev('task_done', { taskId: 'a', nodeId: 'n1', fournisseur: { coutUsd: 1 } }),
    ];
    const recente = rapportDeMission(
      entree({ taches: [tache('a', 'done', 1_000_000)], evenements, journalElague: true }),
    );
    expect(recente.fenetre.tronquee).toBe(false);
    expect(recente.genome.fenetre.tronquee).toBe(false);
    // La même lecture, pour une mission née AVANT le plus ancien fait lu : averti.
    const ancienne = rapportDeMission(
      entree({ taches: [tache('a', 'done', 1)], evenements, journalElague: true }),
    );
    expect(ancienne.fenetre.tronquee).toBe(true);
  });
});
