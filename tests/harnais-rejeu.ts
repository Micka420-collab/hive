// HARNAIS DE NON-RÉGRESSION PAR REJEU DE SÉQUENCE.
//
// Un scénario complet et déterministe est joué à l'identique dans plusieurs
// configurations, et les exécutions doivent produire EXACTEMENT la même
// séquence d'événements, les mêmes assignations et le même état final. C'est le
// filet qui protège les tests existants — et, au-delà, toute fonctionnalité
// future branchée sur le chemin du tick.
//
// Il vivait dans tests/balance-wiring.test.ts ; il en est extrait pour être
// PARTAGÉ, parce que les Gardiennes doivent passer par LE MÊME scénario que la
// Balance, pas par une copie qui divergerait à la première correction. Le
// commentaire d'origine annonçait exactement cela : « le harnais survit à cette
// fonctionnalité ». Il ne survit vraiment que s'il est réutilisé.
//
// Ce fichier n'est PAS collecté par vitest (il ne se termine pas par .test.ts) :
// c'est une bibliothèque de tests, pas une suite.

import { Scheduler } from '../src/orchestrator/scheduler.js';
import type { SchedulerOptions } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { CodeGrief, Verdict } from '../src/orchestrator/gardiennes.js';
import type { HiveEvent, TaskResult } from '../src/shared/types.js';

/**
 * Horloge FIXE, très loin dans le futur. Les cooldowns de refus sont posés à
 * `now + 3 s` sur cette horloge : jamais expirés du point de vue de l'horloge
 * réelle utilisée par les chemins qui ne prennent pas de `now`. Le scénario est
 * donc rigoureusement déterministe, sans mock d'horloge.
 */
export const NOW = 4_000_000_000_000;

export function resultat(
  taskId: string,
  patch: Partial<TaskResult> = {},
): Omit<TaskResult, 'nodeId'> {
  return {
    taskId,
    success: false,
    diff: '',
    logs: 'trace',
    durationMs: 1_000,
    subAgents: [],
    ...patch,
  };
}

/** Ce qu'une exécution du scénario laisse derrière elle, à comparer mot à mot. */
export interface Trace {
  /** Séquence des TYPES d'événements, dans l'ordre — le cœur du harnais. */
  types: string[];
  /** Événements complets (projectId normalisé), pour attraper une clé en trop. */
  evenements: Array<{ type: string; payload: Record<string, unknown> }>;
  /** Qui a reçu quoi, dans l'ordre : le choix du nœud est une sortie observée. */
  assignations: string[];
  annulations: string[];
  /** État final des tâches. */
  taches: Array<{ id: string; status: string; attempts: number; assignedNodeId: string | null }>;
  /**
   * Résultats RANGÉS, du plus ancien au plus récent : ce que la ruche a
   * RETENU, qui n'est pas forcément ce que l'ouvrière a DÉCLARÉ. C'est par là
   * que passent les phéromones et l'imputation de La Balance — donc l'endroit
   * exact où se voit un succès creux refusé.
   */
  resultats: Array<{ taskId: string; nodeId: string; success: boolean }>;
  /** Souvenirs Hive Mind laissés derrière : la mémoire collective, pour toujours. */
  souvenirs: number;
  /** Verdicts de garde rangés, du plus ancien au plus récent. */
  inspections: Array<{
    taskId: string;
    verdict: Verdict;
    score: number;
    applique: boolean;
    codes: CodeGrief[];
  }>;
}

/** Réglages ajoutés au harnais après coup — toujours OPTIONNELS et neutres par défaut. */
export interface OptionsRejeu {
  /** Les Gardiennes : le contrôle d'entrée du nectar. */
  gardiennes?: SchedulerOptions['gardiennes'];
  /**
   * Rend le scénario JUGEABLE par les Gardiennes, et rend la production réussie
   * de T3 CREUSE. Deux changements de DÉCOR, tous deux nécessaires :
   *  - le projet reçoit un dépôt : sans lui, `collectDiff()` rend toujours ''
   *    (node-client/workspace.ts) et la garde s'abstient de tout grief de diff ;
   *  - chaque tâche promet SON fichier : sans promesse de modification, un diff
   *    vide est un résultat parfaitement normal.
   * Le résultat de T3 (`success: true`, `diff: ''`, déjà dans le scénario de
   * base) devient alors exactement le mensonge que les Gardiennes existent pour
   * attraper. Un fichier PAR tâche, et pas un fichier commun : un chemin partagé
   * déclencherait le Sting Detector (conflit « high ») et sérialiserait tout le
   * scénario, qui ne mordrait plus.
   */
  creuse?: boolean;
}

/**
 * Scénario complet et déterministe : promotion par dépendances, assignation,
 * démarrage, re-tentative, succès (+ souvenir), refus, échec définitif, cascade,
 * perte de nœud, annulation humaine. Aucun aléa hors des ids, tous fixés.
 */
export function rejouerScenario(
  balance?: SchedulerOptions['balance'],
  /**
   * Plafond posé sur le projet AVANT que quoi que ce soit ne tourne (lot 3).
   * `undefined` = aucune ligne `budgets`, c'est-à-dire l'état de la ruche
   * d'avant la Balance — le cas que le harnais doit protéger en priorité.
   */
  plafondMs?: number,
  extra: OptionsRejeu = {},
): Trace {
  const store = new HiveStore(':memory:');
  try {
    const journal: HiveEvent[] = [];
    const assignations: string[] = [];
    const annulations: string[] = [];
    const scheduler = new Scheduler(store, {
      ...(balance ? { balance } : {}),
      ...(extra.gardiennes ? { gardiennes: extra.gardiennes } : {}),
      onEvent: (e) => journal.push(e),
      onAssign: (nodeId, task) => assignations.push(`${task.id}→${nodeId}`),
      onCancel: (nodeId, taskId) => annulations.push(`${taskId}→${nodeId}`),
    });

    const projet = store.createProject({
      name: 'Ruche',
      // Un dépôt : la condition SANS LAQUELLE aucun grief de diff n'est levé.
      ...(extra.creuse ? { repoUrl: 'https://example.invalid/ruche.git' } : {}),
    });
    // Écriture directe : poser le plafond fait partie du DÉCOR du scénario, pas
    // de son déroulé — `setPlafond` relancerait une assignation et brouillerait
    // la comparaison de séquences.
    if (plafondMs !== undefined) store.setBudget(projet.id, plafondMs, null, NOW);
    for (const [id, deps] of [
      ['T1', []],
      ['T2', ['T1']],
      ['T3', []],
      ['T4', []],
    ] as const) {
      store.createTask(
        {
          id,
          projectId: projet.id,
          title: `tâche ${id}`,
          prompt: extra.creuse ? `corriger src/${id.toLowerCase()}.ts` : 'faire le travail',
          dependsOn: [...deps],
        },
        NOW,
      );
    }
    scheduler.registerNode(
      { nodeId: 'n1', name: 'alfa', ownerName: 'test', agentType: 'shell', maxConcurrency: 1 },
      NOW,
    );
    scheduler.registerNode(
      { nodeId: 'n2', name: 'bravo', ownerName: 'test', agentType: 'shell', maxConcurrency: 1 },
      NOW,
    );

    scheduler.tick(NOW);
    // T1 démarre puis rate : re-tentative (task_retry porte désormais durationMs).
    scheduler.handleTaskUpdate('n1', 'T1', [], 'démarrage');
    scheduler.handleTaskResult('n1', resultat('T1', { durationMs: 900 }));
    // T3 réussit chez l'autre ouvrière : task_done + souvenir Hive Mind.
    scheduler.handleTaskResult('n2', resultat('T3', { success: true, durationMs: 1_500 }));
    // Un refus : la tâche repart en ready sans brûler de tentative.
    scheduler.rejectTask('n1', 'T4', 'saturé', false, NOW);
    // T1 épuise ses tentatives : échec définitif, puis cascade sur T2.
    scheduler.handleTaskResult('n2', resultat('T1', { durationMs: 1_100 }));
    scheduler.handleTaskResult('n1', resultat('T1', { durationMs: 700 }));
    scheduler.tick(NOW + 1_000);
    // Perte d'un nœud, puis annulation humaine de ce qui reste.
    scheduler.nodeDisconnected('n2', 'test', NOW + 2_000);
    scheduler.cancelTask('T4', 'décision humaine', NOW + 3_000);
    scheduler.tick(NOW + 4_000);

    const normaliser = (payload: Record<string, unknown>): Record<string, unknown> =>
      JSON.parse(JSON.stringify(payload).split(projet.id).join('PROJET')) as Record<
        string,
        unknown
      >;

    return {
      types: journal.map((e) => e.type),
      evenements: journal.map((e) => ({ type: e.type, payload: normaliser(e.payload) })),
      assignations,
      annulations,
      taches: store.listTasks().map((t) => ({
        id: t.id,
        status: t.status,
        attempts: t.attempts,
        assignedNodeId: t.assignedNodeId,
      })),
      // `listResultsForBalance` rend le corpus par id DÉCROISSANT : on le remet
      // dans l'ordre du récit.
      resultats: store
        .listResultsForBalance()
        .reverse()
        .map((r) => ({ taskId: r.taskId, nodeId: r.nodeId, success: r.success })),
      souvenirs: store.countMemories(),
      inspections: store
        .listInspections()
        .reverse()
        .map((i) => ({
          taskId: i.taskId,
          verdict: i.verdict,
          score: i.score,
          applique: i.applique,
          codes: i.griefs.map((g) => g.code),
        })),
    };
  } finally {
    store.close();
  }
}
