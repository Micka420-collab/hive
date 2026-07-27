// Câblage de la Balance dans le Scheduler. Le test central est un HARNAIS DE
// NON-RÉGRESSION PAR REJEU DE SÉQUENCE : un scénario complet est joué à
// l'identique avec la Balance éteinte, en observation et en strict, et les
// trois exécutions doivent produire EXACTEMENT la même séquence d'événements,
// les mêmes assignations et le même état final. C'est le filet qui protège les
// tests existants — et, au-delà, toute fonctionnalité future branchée sur le
// chemin du tick : le harnais survit à cette fonctionnalité.
//
// Le reste du fichier verrouille les invariants du grand livre : il suit la
// TABLE (pas les sites d'appel), il ne boucle pas sur une tentative orpheline,
// il dit quand il n'est pas à jour, et il n'a AUCUNE influence sur le choix du
// nœud.

import { afterEach, describe, expect, it } from 'vitest';
import { LOT_GRAND_LIVRE } from '../src/orchestrator/balance.js';
import { computePulse } from '../src/orchestrator/pulse.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import type { SchedulerOptions } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { TYPES_THERMO, lireTemperature } from '../src/orchestrator/thermo.js';
import { buildWaggleBoard } from '../src/orchestrator/waggle.js';
import type { HiveEvent, TaskResult } from '../src/shared/types.js';

/**
 * Horloge FIXE, très loin dans le futur. Les cooldowns de refus sont posés à
 * `now + 3 s` sur cette horloge : jamais expirés du point de vue de l'horloge
 * réelle utilisée par les chemins qui ne prennent pas de `now`. Le scénario est
 * donc rigoureusement déterministe, sans mock d'horloge.
 */
const NOW = 4_000_000_000_000;

function resultat(taskId: string, patch: Partial<TaskResult> = {}): Omit<TaskResult, 'nodeId'> {
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
interface Trace {
  /** Séquence des TYPES d'événements, dans l'ordre — le cœur du harnais. */
  types: string[];
  /** Événements complets (projectId normalisé), pour attraper une clé en trop. */
  evenements: Array<{ type: string; payload: Record<string, unknown> }>;
  /** Qui a reçu quoi, dans l'ordre : le choix du nœud est une sortie observée. */
  assignations: string[];
  annulations: string[];
  /** État final des tâches. */
  taches: Array<{ id: string; status: string; attempts: number; assignedNodeId: string | null }>;
}

/**
 * Scénario complet et déterministe : promotion par dépendances, assignation,
 * démarrage, re-tentative, succès (+ souvenir), refus, échec définitif, cascade,
 * perte de nœud, annulation humaine. Aucun aléa hors des ids, tous fixés.
 */
function rejouerScenario(balance?: SchedulerOptions['balance']): Trace {
  const store = new HiveStore(':memory:');
  try {
    const journal: HiveEvent[] = [];
    const assignations: string[] = [];
    const annulations: string[] = [];
    const scheduler = new Scheduler(store, {
      ...(balance ? { balance } : {}),
      onEvent: (e) => journal.push(e),
      onAssign: (nodeId, task) => assignations.push(`${task.id}→${nodeId}`),
      onCancel: (nodeId, taskId) => annulations.push(`${taskId}→${nodeId}`),
    });

    const projet = store.createProject({ name: 'Ruche' });
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
          prompt: 'faire le travail',
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
    };
  } finally {
    store.close();
  }
}

describe('Balance : non-régression par rejeu de séquence', () => {
  it('T1 — éteinte, en observation ou en strict : la ruche se comporte à l’IDENTIQUE', () => {
    const reference = rejouerScenario(); // aucune option : le défaut du dépôt
    const eteinte = rejouerScenario({ mode: 'off' });
    const observation = rejouerScenario({ mode: 'observation' });
    const strict = rejouerScenario({ mode: 'strict' });

    // Le scénario mord vraiment : sans ça, le harnais ne prouverait rien.
    expect(reference.types.length).toBeGreaterThan(15);
    expect(new Set(reference.types).size).toBeGreaterThan(8);

    for (const [nom, trace] of [
      ['off', eteinte],
      ['observation', observation],
      ['strict', strict],
    ] as const) {
      expect(trace.types, nom).toEqual(reference.types);
      expect(trace.evenements, nom).toEqual(reference.evenements);
      expect(trace.assignations, nom).toEqual(reference.assignations);
      expect(trace.annulations, nom).toEqual(reference.annulations);
      expect(trace.taches, nom).toEqual(reference.taches);
    }
  });

  it('aucun événement `balance_*` n’est émis : la Balance observe, elle ne parle pas', () => {
    const trace = rejouerScenario({ mode: 'strict' });
    expect(trace.types.filter((t) => t.startsWith('balance_'))).toEqual([]);
  });

  it('T16 — la thermorégulation ignore la Balance (aucun type balance_* dans TYPES_THERMO)', () => {
    // Un plafond atteint n'est pas un échec d'agent : la ruche ne doit jamais
    // chauffer parce qu'un humain a serré la vis.
    expect(TYPES_THERMO.filter((t) => t.startsWith('balance_'))).toEqual([]);
    expect([...TYPES_THERMO]).toEqual(['task_done', 'task_failed', 'task_retry', 'task_rejected']);
  });
});

describe('Lot 0 : durationMs dans task_retry et task_failed', () => {
  let store: HiveStore;
  afterEach(() => store.close());

  /** Journal d'un scénario où une tâche rate trois fois de suite. */
  function journalDesEchecs(): HiveEvent[] {
    store = new HiveStore(':memory:');
    const journal: HiveEvent[] = [];
    const scheduler = new Scheduler(store, { onEvent: (e) => journal.push(e) });
    const projet = store.createProject({ name: 'P' });
    store.createTask({ id: 'T1', projectId: projet.id, title: 'T', prompt: 'x' }, NOW);
    scheduler.registerNode(
      { nodeId: 'n1', name: 'alfa', ownerName: 'test', agentType: 'shell', maxConcurrency: 3 },
      NOW,
    );
    scheduler.tick(NOW);
    for (const durationMs of [900, 1_100, 700]) {
      scheduler.handleTaskResult('n1', resultat('T1', { durationMs }));
      scheduler.tick(NOW);
    }
    return journal;
  }

  it('T14 — les deux payloads portent la durée, bornée à 0 si l’horloge est en retard', () => {
    const journal = journalDesEchecs();
    const retries = journal.filter((e) => e.type === 'task_retry');
    const echecs = journal.filter((e) => e.type === 'task_failed');
    expect(retries.map((e) => e.payload.durationMs)).toEqual([900, 1_100]);
    expect(echecs.map((e) => e.payload.durationMs)).toEqual([700]);
    // Les clés préexistantes sont intactes : l'enrichissement est ADDITIF.
    expect(retries[0]?.payload).toMatchObject({
      taskId: 'T1',
      nodeId: 'n1',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(echecs[0]?.payload).toMatchObject({ taskId: 'T1', nodeId: 'n1', attempts: 3 });
  });

  it('T14 — une durée négative n’entre jamais dans le journal', () => {
    store = new HiveStore(':memory:');
    const journal: HiveEvent[] = [];
    const scheduler = new Scheduler(store, { onEvent: (e) => journal.push(e) });
    const projet = store.createProject({ name: 'P' });
    store.createTask({ id: 'T1', projectId: projet.id, title: 'T', prompt: 'x' }, NOW);
    scheduler.registerNode(
      { nodeId: 'n1', name: 'alfa', ownerName: 'test', agentType: 'shell', maxConcurrency: 1 },
      NOW,
    );
    scheduler.tick(NOW);
    scheduler.handleTaskResult('n1', resultat('T1', { durationMs: -42 }));
    expect(journal.find((e) => e.type === 'task_retry')?.payload.durationMs).toBe(0);
  });

  it('T14 — Pulse, Waggle et la thermo lisent le MÊME journal à l’identique qu’avant', () => {
    const journal = journalDesEchecs();
    // Le même journal, privé du champ neuf : c'est exactement ce que la version
    // précédente aurait produit. Les trois lecteurs doivent être indifférents.
    const avant = journal.map((e) => {
      const { durationMs: _ignore, ...reste } = e.payload as { durationMs?: number };
      return e.type === 'task_retry' || e.type === 'task_failed' ? { ...e, payload: reste } : e;
    });
    // Le journal est horodaté par le store (horloge réelle) : la fenêtre
    // thermique se lit depuis le dernier événement, pas depuis NOW.
    const dernier = journal[journal.length - 1]?.ts ?? 0;
    expect(computePulse(journal)).toEqual(computePulse(avant));
    expect(buildWaggleBoard(journal)).toEqual(buildWaggleBoard(avant));
    expect(lireTemperature(journal, dernier)).toEqual(lireTemperature(avant, dernier));
    // Et le journal enrichi n'est pas vide de sens : la thermo voit bien les échecs.
    expect(lireTemperature(journal, dernier).signaux.total).toBeGreaterThan(0);
  });
});

describe('Balance : le grand livre suit la TABLE', () => {
  let store: HiveStore;
  afterEach(() => store.close());

  /** Ruche minimale : un projet, une tâche, un nœud, un scheduler. */
  function ruche(balance?: SchedulerOptions['balance']): {
    scheduler: Scheduler;
    projectId: string;
  } {
    store = new HiveStore(':memory:');
    const scheduler = new Scheduler(store, balance ? { balance } : {});
    const projet = store.createProject({ name: 'P' });
    store.createTask({ id: 'T1', projectId: projet.id, title: 'T', prompt: 'x' }, NOW);
    return { scheduler, projectId: projet.id };
  }

  it('T11 — un résultat inséré SANS passer par le scheduler entre quand même au solde', () => {
    const { scheduler, projectId } = ruche();
    // Écriture directe dans le store : c'est la preuve STRUCTURELLE qu'un
    // troisième site d'écriture, ajouté dans cinq ans, ne peut pas dérégler le
    // compteur — il suit la table, pas les sites d'appel de insertResult.
    store.insertResult({
      taskId: 'T1',
      nodeId: 'n1',
      success: true,
      diff: '',
      logs: '',
      durationMs: 4_242,
      subAgents: [],
    });
    scheduler.tick(NOW);
    expect(scheduler.balance.soldes).toEqual([{ projectId, depenseMs: 4_242, tentatives: 1 }]);
    expect(scheduler.balance.aJour).toBe(true);
  });

  it('T9 — l’incrémental est égal au recalcul À FROID, et se reconstruit au redémarrage', () => {
    const { scheduler, projectId } = ruche();
    store.createTask({ id: 'T2', projectId, title: 'T2', prompt: 'x' }, NOW);
    const autre = store.createProject({ name: 'Autre' });
    store.createTask({ id: 'T3', projectId: autre.id, title: 'T3', prompt: 'x' }, NOW);
    for (const [taskId, durationMs] of [
      ['T1', 100],
      ['T1', 250],
      ['T2', 50],
      ['T3', 700],
    ] as const) {
      store.insertResult({
        taskId,
        nodeId: 'n1',
        success: true,
        diff: '',
        logs: '',
        durationMs,
        subAgents: [],
      });
    }
    scheduler.tick(NOW);

    const aFroid = [...store.depensesParProjet().entries()]
      .map(([id, d]) => ({ projectId: id, ...d }))
      .sort((a, b) => a.projectId.localeCompare(b.projectId));
    expect(scheduler.balance.soldes).toEqual(aFroid);

    // Redémarrage : un Scheduler NEUF sur le MÊME store reconstruit le livre
    // par rattrapage — rien n'était persisté, et rien ne manque.
    const apresRedemarrage = new Scheduler(store);
    expect(apresRedemarrage.balance.aJour).toBe(false);
    expect(apresRedemarrage.balance.soldes).toEqual([]);
    apresRedemarrage.tick(NOW);
    expect(apresRedemarrage.balance.aJour).toBe(true);
    expect(apresRedemarrage.balance.soldes).toEqual(aFroid);
  });

  it('T12 — une tentative orpheline n’enraye pas le rattrapage', () => {
    const { scheduler, projectId } = ruche();
    // Tâche disparue : aucun projet à qui imputer la dépense.
    store.insertResult({
      taskId: 'tache-fantome',
      nodeId: 'n1',
      success: false,
      diff: '',
      logs: '',
      durationMs: 999,
      subAgents: [],
    });
    scheduler.tick(NOW);
    expect(scheduler.balance.aJour).toBe(true);
    expect(scheduler.balance.soldes).toEqual([]); // jamais imputée à personne

    // Et le filigrane l'a bel et bien dépassée : le résultat suivant est vu.
    store.insertResult({
      taskId: 'T1',
      nodeId: 'n1',
      success: true,
      diff: '',
      logs: '',
      durationMs: 10,
      subAgents: [],
    });
    scheduler.tick(NOW);
    expect(scheduler.balance.soldes).toEqual([{ projectId, depenseMs: 10, tentatives: 1 }]);
  });

  it('mode `off` : le grand livre ne tourne pas du tout (aucune lecture, aucun solde)', () => {
    const { scheduler } = ruche({ mode: 'off' });
    let lectures = 0;
    const vraie = store.listResultsForLedger.bind(store);
    store.listResultsForLedger = (afterId: number, limit?: number) => {
      lectures += 1;
      return limit === undefined ? vraie(afterId) : vraie(afterId, limit);
    };
    store.insertResult({
      taskId: 'T1',
      nodeId: 'n1',
      success: true,
      diff: '',
      logs: '',
      durationMs: 500,
      subAgents: [],
    });
    scheduler.tick(NOW);
    expect(lectures).toBe(0);
    expect(scheduler.balance).toEqual({ mode: 'off', aJour: false, soldes: [] });
  });

  it('la lecture du chemin du tick est BORNÉE : jamais plus de LOT_GRAND_LIVRE par passe', () => {
    const { scheduler } = ruche();
    const limites: Array<number | undefined> = [];
    const vraie = store.listResultsForLedger.bind(store);
    store.listResultsForLedger = (afterId: number, limit?: number) => {
      limites.push(limit);
      return limit === undefined ? vraie(afterId) : vraie(afterId, limit);
    };
    scheduler.tick(NOW);
    expect(limites.length).toBeGreaterThan(0);
    expect(limites.every((l) => l === LOT_GRAND_LIVRE)).toBe(true);
  });
});

describe('Balance : elle n’entre JAMAIS dans le choix du nœud', () => {
  let store: HiveStore;
  afterEach(() => store.close());

  /**
   * Deux nœuds à charge égale et à historique de réussite identique (donc sans
   * départage par phéromones), mais dont l'un a consommé DIX FOIS plus de temps
   * machine. Le nœud choisi doit être le même, Balance éteinte ou allumée :
   * router au moins-cher punirait les machines modestes.
   */
  function noeudChoisi(balance?: SchedulerOptions['balance']): string | undefined {
    store = new HiveStore(':memory:');
    const assignations: string[] = [];
    const scheduler = new Scheduler(store, {
      ...(balance ? { balance } : {}),
      onAssign: (nodeId) => assignations.push(nodeId),
    });
    const projet = store.createProject({ name: 'P' });
    // Historique : une tâche déjà terminée, réussie une fois par CHAQUE nœud —
    // même signal de phéromone, seule la durée diffère (n2 est dix fois plus lent).
    store.createTask(
      { id: 'T0', projectId: projet.id, title: 'route api', prompt: 'endpoint' },
      NOW,
    );
    store.patchTask('T0', { status: 'done' }, NOW);
    for (const [nodeId, durationMs] of [
      ['n1', 1_000],
      ['n2', 10_000],
    ] as const) {
      store.insertResult(
        {
          taskId: 'T0',
          nodeId,
          success: true,
          diff: '',
          logs: '',
          durationMs,
          subAgents: [],
        },
        NOW,
      );
    }
    store.createTask(
      { id: 'T1', projectId: projet.id, title: 'route api', prompt: 'endpoint' },
      NOW,
    );
    scheduler.registerNode(
      { nodeId: 'n1', name: 'alfa', ownerName: 'test', agentType: 'shell', maxConcurrency: 1 },
      NOW,
    );
    scheduler.registerNode(
      { nodeId: 'n2', name: 'bravo', ownerName: 'test', agentType: 'shell', maxConcurrency: 1 },
      NOW,
    );
    scheduler.tick(NOW);
    // Le livre a bien vu la dépense asymétrique — et ne s'en est pas servi.
    expect(scheduler.balance.mode === 'off' || scheduler.balance.soldes.length > 0).toBe(true);
    return assignations[0];
  }

  it('le nœud le plus gourmand n’est ni favorisé ni puni', () => {
    const reference = noeudChoisi({ mode: 'off' });
    expect(reference).toBeDefined();
    expect(noeudChoisi({ mode: 'observation' })).toBe(reference);
    expect(noeudChoisi({ mode: 'strict' })).toBe(reference);
    expect(noeudChoisi()).toBe(reference);
  });
});
