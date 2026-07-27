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
function rejouerScenario(
  balance?: SchedulerOptions['balance'],
  /**
   * Plafond posé sur le projet AVANT que quoi que ce soit ne tourne (lot 3).
   * `undefined` = aucune ligne `budgets`, c'est-à-dire l'état de la ruche
   * d'avant la Balance — le cas que le harnais doit protéger en priorité.
   */
  plafondMs?: number,
): Trace {
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

  it('aucun événement `balance_*` n’est émis : sans plafond, la Balance se tait', () => {
    const trace = rejouerScenario({ mode: 'strict' });
    expect(trace.types.filter((t) => t.startsWith('balance_'))).toEqual([]);
  });

  it('T1 (lot 3) — un plafond JAMAIS ATTEINT ne change rien, dans les quatre modes', () => {
    // Le scénario dépense 4 200 ms sur le projet : dix millions de ms de
    // plafond ne peuvent pas être franchis. Une ligne `budgets` qui existe mais
    // ne mord pas doit être aussi invisible que pas de ligne du tout.
    const reference = rejouerScenario();
    for (const mode of ['off', 'observation', 'strict'] as const) {
      const trace = rejouerScenario({ mode }, 10_000_000);
      expect(trace.types, mode).toEqual(reference.types);
      expect(trace.evenements, mode).toEqual(reference.evenements);
      expect(trace.assignations, mode).toEqual(reference.assignations);
      expect(trace.taches, mode).toEqual(reference.taches);
    }
    expect(rejouerScenario(undefined, 10_000_000).evenements).toEqual(reference.evenements);
  });

  it('T1 (lot 3) — un plafond ATTEINT en `observation` n’arrête rien : seuls des faits s’ajoutent', () => {
    const reference = rejouerScenario();
    const observe = rejouerScenario({ mode: 'observation' }, 1_000);

    // Tout ce que la ruche a FAIT est identique, à la virgule près…
    expect(observe.assignations).toEqual(reference.assignations);
    expect(observe.annulations).toEqual(reference.annulations);
    expect(observe.taches).toEqual(reference.taches);
    // …et ce qu'elle a DIT ne diffère que des faits `balance_*` ajoutés.
    expect(observe.types.filter((t) => !t.startsWith('balance_'))).toEqual(reference.types);
    expect(observe.evenements.filter((e) => !e.type.startsWith('balance_'))).toEqual(
      reference.evenements,
    );

    // DÉDUPLICATION — le cœur du sujet. Le scénario enchaîne une dizaine de
    // passes d'assignation sur un projet plafonné ; un événement PAR TICK
    // épuiserait la fenêtre de 5 000 en trois heures et noierait Ghost, Waggle,
    // Pulse et la Chronique. On journalise un franchissement, pas un niveau.
    const balance = observe.evenements.filter((e) => e.type.startsWith('balance_'));
    expect(balance.map((e) => e.type)).toEqual(['balance_alerte', 'balance_seuil']);
    expect(balance[0]?.payload).toEqual({
      projectId: 'PROJET',
      depenseMs: 900,
      plafondMs: 1_000,
      part: 90,
    });
    // `applique: false` : le fait est observé, il n'a RIEN bloqué.
    expect(balance[1]?.payload).toMatchObject({ plafondMs: 1_000, applique: false });
  });

  it('T1 (lot 3) — le harnais MORD : en `strict`, le même plafond change la séquence', () => {
    // Sans cette assertion, les trois tests ci-dessus pourraient être verts
    // parce que la porte ne fait rien du tout.
    const reference = rejouerScenario();
    const strict = rejouerScenario({ mode: 'strict' }, 1_000);
    expect(strict.assignations).not.toEqual(reference.assignations);
    expect(strict.evenements.some((e) => e.payload.applique === true)).toBe(true);
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
    expect(scheduler.balance.soldes).toEqual([
      { projectId, depenseMs: 4_242, tentatives: 1, plafondMs: null, etat: 'passe', bloque: false },
    ]);
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

    // Sans plafond posé, chaque solde porte le même verdict neutre : la porte
    // existe, elle ne se referme sur rien.
    const aFroid = [...store.depensesParProjet().entries()]
      .map(([id, d]) => ({ projectId: id, ...d, plafondMs: null, etat: 'passe', bloque: false }))
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
    expect(scheduler.balance.soldes).toEqual([
      { projectId, depenseMs: 10, tentatives: 1, plafondMs: null, etat: 'passe', bloque: false },
    ]);
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

// ─── La porte (lot 3) ────────────────────────────────────────────────────────
//
// Ce que la porte fait : cesser d'assigner de NOUVELLES tâches d'un projet au
// plafond, en mode `strict` seulement. Ce qu'elle ne fait JAMAIS : tuer une
// tâche en vol, toucher un autre projet, bloquer un merge, influencer le choix
// du nœud, ni se ré-autoriser elle-même à dépenser.

/** Décor commun : un projet plafonné, un projet témoin, un nœud, une dépense déjà faite. */
interface Plateau {
  scheduler: Scheduler;
  journal: HiveEvent[];
  assignations: string[];
  /** Projet sur lequel le plafond est posé. */
  projet: string;
  /** Projet témoin, sans plafond : il doit continuer comme si de rien n'était. */
  autre: string;
}

describe('Balance : la porte (borner)', () => {
  let store: HiveStore;
  afterEach(() => store.close());

  /**
   * `depenseMs` est imputée à une tâche DÉJÀ TERMINÉE du projet plafonné : le
   * grand livre la comptera au premier tick, comme n'importe quelle dépense
   * héritée d'avant le démarrage.
   */
  function plateau(
    balance: SchedulerOptions['balance'],
    plafondMs: number | null,
    depenseMs: number,
    concurrence = 4,
  ): Plateau {
    store = new HiveStore(':memory:');
    const journal: HiveEvent[] = [];
    const assignations: string[] = [];
    const scheduler = new Scheduler(store, {
      balance,
      onEvent: (e) => journal.push(e),
      onAssign: (nodeId, task) => assignations.push(`${task.id}→${nodeId}`),
    });
    const projet = store.createProject({ name: 'Plafonné' });
    const autre = store.createProject({ name: 'Témoin' });
    store.createTask({ id: 'A0', projectId: projet.id, title: 'passé', prompt: 'x' }, NOW);
    store.patchTask('A0', { status: 'done' }, NOW);
    if (depenseMs > 0) {
      store.insertResult(
        {
          taskId: 'A0',
          nodeId: 'n1',
          success: true,
          diff: '',
          logs: '',
          durationMs: depenseMs,
          subAgents: [],
        },
        NOW,
      );
    }
    store.createTask({ id: 'A1', projectId: projet.id, title: 'à faire', prompt: 'x' }, NOW);
    store.createTask({ id: 'B1', projectId: autre.id, title: 'témoin', prompt: 'y' }, NOW);
    if (plafondMs !== null) store.setBudget(projet.id, plafondMs, null, NOW);
    scheduler.registerNode(
      {
        nodeId: 'n1',
        name: 'alfa',
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: concurrence,
      },
      NOW,
    );
    return { scheduler, journal, assignations, projet: projet.id, autre: autre.id };
  }

  /** Les événements de la Balance émis jusqu'ici, type et payload. */
  const faits = (p: Plateau): Array<{ type: string; payload: Record<string, unknown> }> =>
    p.journal.filter((e) => e.type.startsWith('balance_')).map((e) => ({ ...e }));

  it('T2 — `observation` n’arrête rien : la tâche part, un seul fait, applique:false', () => {
    const p = plateau({ mode: 'observation' }, 1_000, 1_200);
    p.scheduler.tick(NOW);
    p.scheduler.tick(NOW + 1_000);
    p.scheduler.tick(NOW + 2_000);

    expect(p.assignations).toContain('A1→n1');
    expect(store.getTask('A1')?.status).toBe('assigned');
    const seuils = faits(p).filter((e) => e.type === 'balance_seuil');
    expect(seuils).toHaveLength(1);
    expect(seuils[0]?.payload).toEqual({
      projectId: p.projet,
      depenseMs: 1_200,
      plafondMs: 1_000,
      applique: false,
    });
  });

  it('T3 — `strict` arrête : aucune assignation, la tâche reste ready, UN seul fait sur trois ticks', () => {
    const p = plateau({ mode: 'strict' }, 1_000, 1_200);
    p.scheduler.tick(NOW);
    p.scheduler.tick(NOW + 1_000);
    p.scheduler.tick(NOW + 2_000);

    expect(p.assignations).not.toContain('A1→n1');
    expect(store.getTask('A1')?.status).toBe('ready');
    expect(
      p.journal.filter((e) => e.type === 'task_assigned' && e.payload.taskId === 'A1'),
    ).toEqual([]);
    // Trois ticks, un seul fait : la dédup tient (motif task_conflict_deferred).
    const seuils = faits(p).filter((e) => e.type === 'balance_seuil');
    expect(seuils).toHaveLength(1);
    expect(seuils[0]?.payload).toMatchObject({ applique: true, plafondMs: 1_000 });
  });

  it('PAS DE FAMINE SILENCIEUSE : la tâche bloquée s’explique dans l’ÉTAT, pas seulement dans le journal', () => {
    // Réserve d'un juge, prise au sérieux : si le seul témoin du plafonnement
    // est un événement dans un journal élagué à 5 000, alors dans trois ans
    // « pourquoi ce projet est-il bloqué ? » est sans réponse. L'état courant
    // doit porter la raison, indéfiniment.
    const p = plateau({ mode: 'strict' }, 1_000, 1_200);
    p.scheduler.tick(NOW);
    const solde = p.scheduler.balance.soldes.find((s) => s.projectId === p.projet);
    expect(solde).toEqual({
      projectId: p.projet,
      depenseMs: 1_200,
      tentatives: 1,
      plafondMs: 1_000,
      etat: 'bloque',
      bloque: true,
    });
    // Le projet témoin, lui, n'a rien à expliquer.
    expect(p.scheduler.balance.soldes.find((s) => s.projectId === p.autre)).toBeUndefined();

    // Et même APRÈS la disparition de l'événement (journal purgé), l'état parle.
    store.pruneEvents(0);
    expect(store.listEvents(0, 100)).toEqual([]);
    expect(p.scheduler.balance.soldes[0]?.bloque).toBe(true);
    expect(store.getBudget(p.projet)).toMatchObject({ plafondMs: 1_000, definiPar: null });
  });

  it('un projet plafonné à 0 SANS dépense apparaît quand même dans les soldes', () => {
    // Le pire cas de la famine silencieuse : rien à afficher côté dépense, tout
    // à expliquer côté blocage. Un solde absent serait un projet bloqué sans
    // trace nulle part.
    const p = plateau({ mode: 'strict' }, 0, 0);
    p.scheduler.tick(NOW);
    expect(p.scheduler.balance.soldes).toEqual([
      {
        projectId: p.projet,
        depenseMs: 0,
        tentatives: 0,
        plafondMs: 0,
        etat: 'bloque',
        bloque: true,
      },
    ]);
    expect(store.getTask('A1')?.status).toBe('ready');
  });

  it('T4 — Isolation : le projet témoin est assigné dans le MÊME tick', () => {
    const p = plateau({ mode: 'strict' }, 1_000, 1_200);
    p.scheduler.tick(NOW);
    expect(p.assignations).toEqual(['B1→n1']);
    expect(store.getTask('B1')?.status).toBe('assigned');
    expect(store.getTask('A1')?.status).toBe('ready');
  });

  it('T5 — jamais de tâche tuée : une tâche en vol va à son terme et son résultat compte', () => {
    const p = plateau({ mode: 'strict' }, null, 0);
    p.scheduler.tick(NOW);
    p.scheduler.handleTaskUpdate('n1', 'A1', [], 'démarrage');
    expect(store.getTask('A1')?.status).toBe('running');

    // Le plafond tombe PENDANT le vol : la tâche ne doit pas être touchée. Le
    // temps déjà dépensé serait perdu — ce serait du gaspillage supplémentaire
    // au nom de l'économie.
    p.scheduler.setPlafond(p.projet, 1, null, NOW + 1_000);
    expect(store.getTask('A1')?.status).toBe('running');
    expect(p.journal.filter((e) => e.type === 'task_cancelled')).toEqual([]);

    // Et son résultat est accepté normalement, puis compté dans le solde.
    expect(
      p.scheduler.handleTaskResult('n1', resultat('A1', { success: true, durationMs: 5_000 })),
    ).toBe(true);
    expect(store.getTask('A1')?.status).toBe('done');
    p.scheduler.tick(NOW + 2_000);
    expect(p.scheduler.balance.soldes.find((s) => s.projectId === p.projet)?.depenseMs).toBe(5_000);
  });

  it('T6 — déblocage HUMAIN : la ruche repart dans le geste, et un nouveau franchissement se dit', () => {
    const p = plateau({ mode: 'strict' }, 1_000, 1_200);
    p.scheduler.tick(NOW);
    expect(store.getTask('A1')?.status).toBe('ready');
    expect(faits(p).filter((e) => e.type === 'balance_seuil')).toHaveLength(1);

    // Geste humain explicite — symétrique de l'invariant du merge. La ruche ne
    // se ré-autorise jamais elle-même : il faut qu'un humain desserre la vis.
    p.scheduler.setPlafond(p.projet, 10_000, 'operatrice', NOW + 1_000);
    expect(store.getTask('A1')?.status).toBe('assigned'); // repart dans le MÊME geste
    expect(p.assignations).toContain('A1→n1');
    expect(store.getBudget(p.projet)).toMatchObject({
      plafondMs: 10_000,
      definiPar: 'operatrice',
    });

    // Nouvelle dépense au-delà du nouveau plafond : la dédup a bien été vidée,
    // le franchissement se réannonce (sinon il serait muet pour toujours).
    p.scheduler.handleTaskResult('n1', resultat('A1', { success: true, durationMs: 20_000 }));
    p.scheduler.tick(NOW + 2_000);
    store.createTask({ id: 'A2', projectId: p.projet, title: 'suite', prompt: 'x' }, NOW);
    p.scheduler.tick(NOW + 3_000);
    expect(faits(p).filter((e) => e.type === 'balance_seuil')).toHaveLength(2);
    expect(store.getTask('A2')?.status).toBe('ready');
  });

  it('T7 — plafond RETIRÉ : la séquence redevient strictement celle d’une ruche sans Balance', () => {
    const sansPlafond = plateau({ mode: 'strict' }, null, 1_200);
    sansPlafond.scheduler.tick(NOW);
    const reference = sansPlafond.journal.map((e) => e.type);
    const assignationsRef = [...sansPlafond.assignations];
    store.close();

    const leve = plateau({ mode: 'strict' }, 1_000, 1_200);
    // Retrait AVANT le premier tick : la ligne disparaît, l'état « éteint » est
    // l'absence de ligne — pas un drapeau, pas un plafond nul déguisé.
    leve.scheduler.setPlafond(leve.projet, null, null, NOW);
    leve.scheduler.tick(NOW);
    expect(store.getBudget(leve.projet)).toBeNull();
    expect(store.listBudgets()).toEqual([]);
    expect(leve.journal.map((e) => e.type)).toEqual(reference);
    expect(leve.assignations).toEqual(assignationsRef);
    expect(faits(leve)).toEqual([]);
  });

  it('T8 — course : refusée au plafond en `strict`, elle part en `observation`', () => {
    for (const mode of ['strict', 'observation'] as const) {
      const p = plateau({ mode }, 1_000, 1_200);
      p.scheduler.tick(NOW); // le livre rattrape ; A1 et B1 sont traitées
      // Tâche prête posée APRÈS le tick : la course se lance sur une tâche
      // `ready`, sans passer par l'assignation automatique.
      store.createTask({ id: 'A9', projectId: p.projet, title: 'course', prompt: 'x' }, NOW);
      store.patchTask('A9', { status: 'ready' }, NOW);
      const avant = [...p.assignations];

      const course = p.scheduler.startRace('A9', 2, NOW);
      if (mode === 'strict') {
        expect(course.ok, mode).toBe(false);
        expect(course.ok ? '' : course.error).toContain('plafond');
        expect(p.assignations, mode).toEqual(avant); // aucune assignation
        expect(store.getTask('A9')?.status).toBe('ready');
      } else {
        expect(course.ok, mode).toBe(true);
        expect(store.getTask('A9')?.status).toBe('assigned');
      }
      store.close();
    }
    // Le `afterEach` refermera le dernier store : rouvrir un store vide évite
    // un double close.
    store = new HiveStore(':memory:');
  });

  it('T13 — alerte à 80 % : un fait, une part entière, et AUCUN blocage', () => {
    const p = plateau({ mode: 'strict' }, 1_000, 800);
    p.scheduler.tick(NOW);
    p.scheduler.tick(NOW + 1_000);

    const alertes = faits(p).filter((e) => e.type === 'balance_alerte');
    expect(alertes).toHaveLength(1);
    expect(alertes[0]?.payload).toEqual({
      projectId: p.projet,
      depenseMs: 800,
      plafondMs: 1_000,
      part: 80,
    });
    expect(faits(p).filter((e) => e.type === 'balance_seuil')).toEqual([]);
    // Prévenir n'est pas bloquer : la tâche est bel et bien partie.
    expect(p.assignations).toContain('A1→n1');
    expect(p.scheduler.balance.soldes[0]).toMatchObject({ etat: 'alerte', bloque: false });
  });

  it('T15 — payloads de FAITS : que des ids et des entiers, jamais une phrase', () => {
    const p = plateau({ mode: 'strict' }, 1_000, 900); // alerte puis, plus tard, seuil
    p.scheduler.tick(NOW);
    p.scheduler.handleTaskResult('n1', resultat('A1', { durationMs: 5_000 }));
    store.createTask({ id: 'A2', projectId: p.projet, title: 'suite', prompt: 'x' }, NOW);
    p.scheduler.tick(NOW + 1_000);

    const emis = faits(p);
    expect(emis.map((e) => e.type).sort()).toEqual(['balance_alerte', 'balance_seuil']);
    const cles: Record<string, string[]> = {
      balance_alerte: ['projectId', 'depenseMs', 'plafondMs', 'part'],
      balance_seuil: ['projectId', 'depenseMs', 'plafondMs', 'applique'],
    };
    for (const { type, payload } of emis) {
      expect(Object.keys(payload).sort()).toEqual([...(cles[type] ?? [])].sort());
      for (const valeur of Object.values(payload)) {
        // Aucun texte d'affichage figé : le Journal reconstruit le bilingue
        // depuis ces champs typés. Une valeur textuelle est un id, jamais une
        // phrase — et une phrase contient une espace.
        if (typeof valeur === 'string') expect(valeur).not.toMatch(/\s/);
      }
    }
  });

  it('T10 — FAIL-OPEN pendant le rattrapage : on n’arrête jamais la ruche sur un comptage partiel', () => {
    store = new HiveStore(':memory:');
    const assignations: string[] = [];
    const scheduler = new Scheduler(store, {
      balance: { mode: 'strict' },
      onAssign: (nodeId, task) => assignations.push(`${task.id}→${nodeId}`),
    });
    const projet = store.createProject({ name: 'Arriéré' });
    store.createTask({ id: 'A0', projectId: projet.id, title: 'passé', prompt: 'x' }, NOW);
    store.patchTask('A0', { status: 'done' }, NOW);
    // Trois lots pleins d'arriéré : le livre ne peut pas être à jour au 1er tick.
    for (let i = 0; i < 3 * LOT_GRAND_LIVRE; i++) {
      store.insertResult(
        {
          taskId: 'A0',
          nodeId: 'n1',
          success: true,
          diff: '',
          logs: '',
          durationMs: 1,
          subAgents: [],
        },
        NOW,
      );
    }
    store.setBudget(projet.id, 10, null, NOW); // plafond déjà TRÈS largement dépassé
    store.createTask({ id: 'A1', projectId: projet.id, title: 'à faire', prompt: 'x' }, NOW);
    scheduler.registerNode(
      { nodeId: 'n1', name: 'alfa', ownerName: 'test', agentType: 'shell', maxConcurrency: 4 },
      NOW,
    );

    scheduler.tick(NOW);
    // Le comptage est INCOMPLET : la ruche laisse passer. Un faux blocage au
    // démarrage coûterait bien plus cher qu'un plafond dépassé de trois ticks.
    expect(scheduler.balance.aJour).toBe(false);
    expect(assignations).toEqual(['A1→n1']);

    let garde = 0;
    while (!scheduler.balance.aJour && garde++ < 10) scheduler.tick(NOW + garde);
    expect(scheduler.balance.aJour).toBe(true);

    // Comptage complet : la porte se ferme sur la tâche SUIVANTE.
    store.createTask({ id: 'A2', projectId: projet.id, title: 'suite', prompt: 'x' }, NOW);
    scheduler.tick(NOW + 100);
    expect(store.getTask('A2')?.status).toBe('ready');
    expect(assignations).toEqual(['A1→n1']);
    expect(scheduler.balance.soldes[0]).toMatchObject({ etat: 'bloque', bloque: true });
  });

  it('les plafonds sont lus UNE fois, pas à chaque tick (mémoïsation invalidée par le geste humain)', () => {
    const p = plateau({ mode: 'strict' }, 1_000, 500);
    let lectures = 0;
    const vraie = store.listBudgets.bind(store);
    store.listBudgets = () => {
      lectures += 1;
      return vraie();
    };
    for (let i = 0; i < 10; i++) p.scheduler.tick(NOW + i * 1_000);
    expect(lectures).toBe(1);
    // Seul un geste humain rouvre la table.
    p.scheduler.setPlafond(p.projet, 2_000, null, NOW);
    p.scheduler.tick(NOW + 20_000);
    expect(lectures).toBe(2);
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
  function noeudChoisi(
    balance?: SchedulerOptions['balance'],
    /** Plafond posé sur le projet — assez large pour ne jamais se refermer. */
    plafondMs?: number,
  ): string | undefined {
    store = new HiveStore(':memory:');
    const assignations: string[] = [];
    const scheduler = new Scheduler(store, {
      ...(balance ? { balance } : {}),
      onAssign: (nodeId) => assignations.push(nodeId),
    });
    const projet = store.createProject({ name: 'P' });
    if (plafondMs !== undefined) store.setBudget(projet.id, plafondMs, null, NOW);
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

  it('la PORTE ouverte ne réordonne rien non plus : elle décide SI, jamais À QUI', () => {
    // Un plafond posé et non atteint fait passer la décision par la porte (donc
    // par le grand livre) sans rien bloquer. Si le câblage de la porte laissait
    // fuir une valeur de dépense vers le tri des nœuds, c'est ICI que ça se
    // verrait — la distinction « si » / « à qui » est de fond, pas de style.
    const reference = noeudChoisi({ mode: 'off' });
    expect(noeudChoisi({ mode: 'strict' }, 10_000_000)).toBe(reference);
    expect(noeudChoisi({ mode: 'observation' }, 10_000_000)).toBe(reference);
    // Et en alerte (80 % franchis : 11 000 ms dépensés pour 12 000 de plafond),
    // le verdict change mais le nœud choisi, non.
    expect(noeudChoisi({ mode: 'strict' }, 12_000)).toBe(reference);
  });
});
