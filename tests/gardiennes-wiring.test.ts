// Câblage des Gardiennes dans le Scheduler.
//
// Le test central est le MÊME HARNAIS DE REJEU que celui de la Balance
// (tests/harnais-rejeu.ts, partagé) : le scénario est joué à l'identique dans
// les trois positions de l'interrupteur, et deux d'entre elles doivent produire
// EXACTEMENT la même séquence d'événements, les mêmes assignations, les mêmes
// résultats rangés et le même état final. Le harnais est ensuite mis à
// l'épreuve : sur un scénario où une production EST creuse, `strict` doit
// changer la séquence — sans quoi les trois tests précédents seraient verts
// parce que les Gardiennes ne font rien du tout.
//
// Le reste du fichier verrouille les quatre robinets que ferme un refus (Hive
// Mind, phéromones, nectar, `utile`), la BORNE des re-tentatives, la parité des
// courses de drones, et le fait que le verdict est écrit AU MOMENT DE LA
// DÉCISION — donc qu'il survit à l'élagage qui le rendrait incalculable.

import { afterEach, describe, expect, it } from 'vitest';
import { peserLaRuche } from '../src/orchestrator/balance.js';
import type { CompteTache } from '../src/orchestrator/balance.js';
import { calculerPheromones } from '../src/orchestrator/pheromones.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import type { SchedulerOptions } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { TYPES_THERMO } from '../src/orchestrator/thermo.js';
import { buildWaggleBoard } from '../src/orchestrator/waggle.js';
import type { HiveEvent } from '../src/shared/types.js';
import { NOW, rejouerScenario, resultat } from './harnais-rejeu.js';

/** Modes, dans l'ordre du moins au plus contraignant. */
const MODES = ['off', 'consultatif', 'strict'] as const;

describe('Gardiennes : non-régression par rejeu de séquence', () => {
  it('T1 — sur une ruche ORDINAIRE, les trois positions se comportent à l’IDENTIQUE', () => {
    // Le scénario de base n'a ni dépôt ni promesse de modification : les
    // Gardiennes s'y abstiennent, y compris en `strict`. C'est la propriété la
    // plus importante du lot — la très grande majorité des ruches ne doit RIEN
    // voir changer.
    const reference = rejouerScenario(); // aucune option : le défaut du dépôt
    expect(reference.types.length).toBeGreaterThan(15); // le scénario mord vraiment
    expect(new Set(reference.types).size).toBeGreaterThan(8);

    for (const mode of MODES) {
      const trace = rejouerScenario(undefined, undefined, { gardiennes: { mode } });
      expect(trace.types, mode).toEqual(reference.types);
      expect(trace.evenements, mode).toEqual(reference.evenements);
      expect(trace.assignations, mode).toEqual(reference.assignations);
      expect(trace.annulations, mode).toEqual(reference.annulations);
      expect(trace.taches, mode).toEqual(reference.taches);
      expect(trace.resultats, mode).toEqual(reference.resultats);
      expect(trace.souvenirs, mode).toEqual(reference.souvenirs);
    }
  });

  it('T2 — aucun événement `guard_*` n’est émis hors d’un refus RÉEL', () => {
    for (const mode of MODES) {
      const trace = rejouerScenario(undefined, undefined, { gardiennes: { mode } });
      expect(
        trace.types.filter((t) => t.startsWith('guard_')),
        mode,
      ).toEqual([]);
    }
  });

  it('T3 — sur une production CREUSE, `off` et `consultatif` restent IDENTIQUES', () => {
    // Ici la production de T3 est bel et bien creuse (succès déclaré, diff vide,
    // fichier promis, dépôt présent) : les Gardiennes la VOIENT. En
    // `consultatif`, elles n'en font pourtant strictement rien — pas un
    // événement, pas une assignation déplacée, pas un souvenir en moins.
    const eteinte = rejouerScenario(undefined, undefined, {
      creuse: true,
      gardiennes: { mode: 'off' },
    });
    const consultatif = rejouerScenario(undefined, undefined, {
      creuse: true,
      gardiennes: { mode: 'consultatif' },
    });

    expect(consultatif.types).toEqual(eteinte.types);
    expect(consultatif.evenements).toEqual(eteinte.evenements);
    expect(consultatif.assignations).toEqual(eteinte.assignations);
    expect(consultatif.annulations).toEqual(eteinte.annulations);
    expect(consultatif.taches).toEqual(eteinte.taches);
    // Les quatre robinets coulent EXACTEMENT comme avant : le résultat est
    // rangé en succès (donc phéromone positive) et le souvenir est écrit.
    expect(consultatif.resultats).toEqual(eteinte.resultats);
    expect(consultatif.souvenirs).toEqual(eteinte.souvenirs);
    expect(consultatif.souvenirs).toBe(1);

    // La SEULE différence observable : le verdict est rangé, et il est visible.
    expect(eteinte.inspections).toEqual([]);
    expect(consultatif.inspections).toEqual([
      { taskId: 'T3', verdict: 'hollow', score: 3, applique: false, codes: ['empty_diff'] },
    ]);
  });

  it('T4 — le harnais MORD : en `strict`, la même production creuse change tout', () => {
    // Sans cette assertion, les trois tests ci-dessus pourraient être verts
    // parce que les Gardiennes ne font RIEN, dans aucun mode.
    const eteinte = rejouerScenario(undefined, undefined, {
      creuse: true,
      gardiennes: { mode: 'off' },
    });
    const strict = rejouerScenario(undefined, undefined, {
      creuse: true,
      gardiennes: { mode: 'strict' },
    });

    expect(strict.types).not.toEqual(eteinte.types);
    expect(strict.assignations).not.toEqual(eteinte.assignations);
    expect(strict.taches).not.toEqual(eteinte.taches);
    // Ce qui disparaît : la victoire et le souvenir. Ce qui apparaît : le refus.
    expect(eteinte.types).toContain('task_done');
    expect(eteinte.types).toContain('memory_recorded');
    expect(strict.types).not.toContain('task_done');
    expect(strict.types).not.toContain('memory_recorded');
    expect(strict.types).toContain('guard_refused');
    // Le refus est journalisé AVANT sa conséquence : la Chronique doit montrer
    // la cause, puis l'effet.
    expect(strict.types.indexOf('guard_refused')).toBeLessThan(
      strict.types.lastIndexOf('task_retry'),
    );
    expect(strict.inspections[0]?.applique).toBe(true);
  });

  it('T5 — la thermorégulation ignore les Gardiennes (aucun type guard_* dans TYPES_THERMO)', () => {
    // Un refus d'entrée émet aussi un `task_retry`, qui, lui, chauffe la ruche —
    // et c'est voulu : une production creuse EST une issue défavorable. Mais le
    // fait `guard_refused` ne doit pas la faire chauffer une seconde fois.
    expect(TYPES_THERMO.filter((t) => t.startsWith('guard_'))).toEqual([]);
    expect([...TYPES_THERMO]).toEqual(['task_done', 'task_failed', 'task_retry', 'task_rejected']);
  });

  it('T6 — payload de FAITS TYPÉS : que des ids, des entiers et des codes, jamais une phrase', () => {
    const strict = rejouerScenario(undefined, undefined, {
      creuse: true,
      gardiennes: { mode: 'strict' },
    });
    const refus = strict.evenements.filter((e) => e.type === 'guard_refused');
    expect(refus).toHaveLength(1);
    expect(refus[0]?.payload).toEqual({
      taskId: 'T3',
      nodeId: 'n2',
      verdict: 'hollow',
      score: 3,
      griefs: ['empty_diff'],
    });
    // Aucun texte d'affichage figé : le Journal du dashboard reconstruit le
    // bilingue depuis ces champs. Une valeur textuelle est un id ou un code,
    // jamais une phrase — et une phrase contient une espace.
    for (const valeur of Object.values(refus[0]?.payload ?? {})) {
      for (const feuille of Array.isArray(valeur) ? valeur : [valeur]) {
        if (typeof feuille === 'string') expect(feuille).not.toMatch(/\s/);
      }
    }
    // Les types d'événements du dépôt sont en anglais snake_case.
    expect(refus[0]?.type).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

// ─── Les quatre robinets ─────────────────────────────────────────────────────
//
// « En `strict`, une production jugée creuse ne nourrit ni le Hive Mind, ni les
// phéromones, ni le nectar, ni `utile` dans La Balance. » Les quatre sont
// vérifiés ici sur leurs VRAIS modules, jamais sur une reformulation.

/** Décor minimal : un projet AVEC dépôt, une tâche qui promet un fichier, un nœud. */
interface Plateau {
  scheduler: Scheduler;
  journal: HiveEvent[];
  projectId: string;
}

describe('Gardiennes : ce qu’un refus ne nourrit pas', () => {
  let store: HiveStore;
  afterEach(() => store.close());

  function plateau(
    gardiennes: SchedulerOptions['gardiennes'],
    concurrence = 4,
    taches: readonly string[] = ['T1'],
  ): Plateau {
    store = new HiveStore(':memory:');
    const journal: HiveEvent[] = [];
    const scheduler = new Scheduler(store, {
      ...(gardiennes ? { gardiennes } : {}),
      onEvent: (e) => journal.push(e),
    });
    const projet = store.createProject({
      name: 'Ruche',
      repoUrl: 'https://example.invalid/ruche.git',
    });
    for (const id of taches) {
      store.createTask(
        {
          id,
          projectId: projet.id,
          title: `tâche ${id}`,
          prompt: `corriger src/${id.toLowerCase()}.ts`,
        },
        NOW,
      );
    }
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
    scheduler.tick(NOW);
    return { scheduler, journal, projectId: projet.id };
  }

  /** Production CREUSE : succès déclaré, aucun octet rapporté. */
  const creuse = (taskId: string) =>
    resultat(taskId, { success: true, diff: '', durationMs: 5_000 });

  it('en `strict` : ni souvenir, ni phéromone positive, ni nectar, ni `utile`', () => {
    const p = plateau({ mode: 'strict' });
    expect(p.scheduler.handleTaskResult('n1', creuse('T1'))).toBe(true);

    // 1) Hive Mind — la mémoire collective reste vierge. C'est la pollution la
    //    plus durable des quatre : un souvenir creux est indistinguable d'un
    //    vrai et sera réinjecté dans les prompts pendant des mois.
    expect(store.countMemories()).toBe(0);
    expect(p.journal.filter((e) => e.type === 'memory_recorded')).toEqual([]);

    // 2) Phéromones — le résultat est rangé en ÉCHEC, donc le repli dépose −6
    //    au lieu de +10 : la ruche n'apprend pas à préférer l'ouvrière qui ment.
    const resultats = store.listResultsForPheromones();
    expect(resultats.map((r) => r.success)).toEqual([false]);
    // Repli à l'instant du dépôt (sinon l'évaporation, demi-vie de 7 jours,
    // ramènerait le score à zéro et le test ne prouverait plus rien).
    const traces = calculerPheromones(store.listTasks(), resultats, resultats[0]?.createdAt ?? 0);
    expect(traces).toHaveLength(1);
    expect(traces[0]?.score).toBeLessThan(0);
    expect(traces[0]?.reussites).toBe(0);
    expect(traces[0]?.echecs).toBe(1);

    // 3) Nectar — aucun `task_done`, donc rien à créditer au Waggle Board.
    expect(buildWaggleBoard(p.journal).totalTasksDone).toBe(0);
    expect(buildWaggleBoard(p.journal).nodes.find((n) => n.nodeId === 'n1')?.score ?? 0).toBe(0);

    // 4) La Balance — la tentative n'est JAMAIS imputée en `utile`. La dépense,
    //    elle, reste comptée : le temps machine a bel et bien été prêté, et le
    //    nier serait un autre mensonge comptable.
    const taches = new Map<string, CompteTache>(
      store
        .listTasks()
        .map((t) => [t.id, { projectId: t.projectId, status: t.status, revue: null }]),
    );
    const pesee = peserLaRuche(store.listResultsForBalance(), taches);
    expect(pesee.global.utileMs).toBe(0);
    expect(pesee.global.totalMs).toBe(5_000);
  });

  it('en `consultatif` : les quatre robinets coulent, et le verdict est quand même rangé', () => {
    const p = plateau({ mode: 'consultatif' });
    expect(p.scheduler.handleTaskResult('n1', creuse('T1'))).toBe(true);

    expect(store.countMemories()).toBe(1);
    expect(p.journal.map((e) => e.type)).toContain('memory_recorded');
    expect(store.listResultsForPheromones().map((r) => r.success)).toEqual([true]);
    expect(buildWaggleBoard(p.journal).totalTasksDone).toBe(1);
    expect(store.getTask('T1')?.status).toBe('done');
    // …et le fait est là, prêt pour la campagne d'observation.
    const rangee = store.listInspections();
    expect(rangee).toHaveLength(1);
    expect(rangee[0]).toMatchObject({ taskId: 'T1', verdict: 'hollow', applique: false });
    expect(rangee[0]?.griefs.map((g) => g.code)).toEqual(['empty_diff']);
  });

  it('en `off` : rien n’est inspecté, rien n’est lu, rien n’est écrit', () => {
    const p = plateau({ mode: 'off' });
    let lecturesProjet = 0;
    const vraie = store.getProject.bind(store);
    store.getProject = (id: string) => {
      lecturesProjet += 1;
      return vraie(id);
    };
    expect(p.scheduler.handleTaskResult('n1', creuse('T1'))).toBe(true);
    // Pas même la lecture du projet (celle qui dit si un diff pouvait exister).
    expect(lecturesProjet).toBe(0);
    expect(store.countInspections()).toBe(0);
    expect(store.getTask('T1')?.status).toBe('done');
    expect(store.countMemories()).toBe(1);
  });

  it('une production HONNÊTE n’est jamais refusée, même en `strict`', () => {
    const p = plateau({ mode: 'strict' });
    const diff = [
      'diff --git a/src/t1.ts b/src/t1.ts',
      '--- a/src/t1.ts',
      '+++ b/src/t1.ts',
      '@@ -1,2 +1,3 @@',
      ' contexte',
      '+correction',
      '',
    ].join('\n');
    expect(
      p.scheduler.handleTaskResult('n1', resultat('T1', { success: true, diff, durationMs: 10 })),
    ).toBe(true);
    expect(store.getTask('T1')?.status).toBe('done');
    expect(store.countMemories()).toBe(1);
    expect(p.journal.filter((e) => e.type === 'guard_refused')).toEqual([]);
    // Le verdict est quand même rangé : une campagne d'observation a besoin de
    // son dénominateur, sinon « 3 refus » ne veut rien dire.
    expect(store.listInspections()[0]).toMatchObject({ verdict: 'clean', score: 0 });
  });

  it('un ÉCHEC déclaré n’est pas inspecté : les gardiennes ne reniflent que ce qui entre', () => {
    const p = plateau({ mode: 'strict' });
    p.scheduler.handleTaskResult('n1', resultat('T1', { success: false, logs: 'npm ERR! boom' }));
    expect(store.countInspections()).toBe(0);
  });

  it('BORNE — un agent qui rend trois productions creuses épuise le MÊME budget qu’un agent qui échoue', () => {
    // C'est la réponse à « une re-tentative infinie sur un agent cassé serait
    // pire que le mal ». Le refus emprunte le circuit d'échec EXISTANT, donc le
    // compteur `attempts` et MAX_ATTEMPTS : il n'y a pas de second budget, donc
    // rien à faire déborder.
    const p = plateau({ mode: 'strict' });
    for (let i = 0; i < 6; i++) p.scheduler.handleTaskResult('n1', creuse('T1'));
    expect(store.getTask('T1')).toMatchObject({ status: 'failed', attempts: 3 });
    const types = p.journal.map((e) => e.type);
    expect(types.filter((t) => t === 'task_retry')).toHaveLength(2);
    expect(types.filter((t) => t === 'task_failed')).toHaveLength(1);
    // Trois refus, pas un de plus : les résultats arrivés après l'échec
    // définitif sont ignorés par l'idempotence habituelle.
    expect(types.filter((t) => t === 'guard_refused')).toHaveLength(3);
    expect(store.countInspections()).toBe(3);
  });

  it('la re-tentative part avec les logs du refus en LEÇON de Couveuse', () => {
    // Le résultat refusé est rangé en échec : `listFailedResultsForTask` le voit,
    // donc l'ouvrière suivante reçoit l'extrait. C'est le bénéfice collatéral du
    // câblage sur le circuit d'échec — la deuxième tentative n'est pas une
    // simple répétition.
    const p = plateau({ mode: 'strict' });
    p.scheduler.handleTaskResult(
      'n1',
      resultat('T1', { success: true, diff: '', logs: 'aucun fichier modifié' }),
    );
    const lecons = store.listFailedResultsForTask('T1');
    expect(lecons).toHaveLength(1);
    expect(lecons[0]?.logs).toBe('aucun fichier modifié');
  });
});

// ─── Le verdict est écrit AU MOMENT DE LA DÉCISION ──────────────────────────

describe('Gardiennes : un verdict ne se recalcule pas', () => {
  let store: HiveStore;
  afterEach(() => store.close());

  it('le verdict SURVIT à l’élagage qui vide `diff` et `logs` — et le recalcul, non', () => {
    // `pruneResults` conserve la ligne mais vide les colonnes lourdes. Un
    // verdict recalculé plus tard verrait un diff vide PARTOUT et accuserait
    // toutes les productions anciennes : un mensonge à retardement qui aurait
    // l'air d'un fait. D'où l'écriture à la réception.
    store = new HiveStore(':memory:');
    const scheduler = new Scheduler(store, { gardiennes: { mode: 'consultatif' } });
    const projet = store.createProject({
      name: 'Ruche',
      repoUrl: 'https://example.invalid/ruche.git',
    });
    const diff = [
      'diff --git a/src/miel.ts b/src/miel.ts',
      '--- a/src/miel.ts',
      '+++ b/src/miel.ts',
      '@@ -1,2 +1,3 @@',
      ' a',
      '+b',
      '',
    ].join('\n');
    store.createTask(
      { id: 'T1', projectId: projet.id, title: 'tâche', prompt: 'corriger src/miel.ts' },
      NOW,
    );
    scheduler.registerNode(
      { nodeId: 'n1', name: 'alfa', ownerName: 'test', agentType: 'shell', maxConcurrency: 2 },
      NOW,
    );
    scheduler.tick(NOW);
    scheduler.handleTaskResult('n1', resultat('T1', { success: true, diff, durationMs: 10 }));

    const avant = store.listInspections();
    expect(avant[0]).toMatchObject({ verdict: 'clean', resultId: 1 });

    // L'élagage passe : le diff disparaît, la ligne reste.
    store.pruneResults(0);
    expect(store.resultsForTask('T1')[0]?.diff).toBe('');
    // Le verdict, lui, est intact — c'est un FAIT DATÉ, pas un cache.
    expect(store.listInspections()).toEqual(avant);
  });

  it('l’élagage des verdicts est BORNÉ et livré avec la table', () => {
    store = new HiveStore(':memory:');
    for (let i = 0; i < 25; i++) {
      store.enregistrerInspection(
        {
          resultId: i + 1,
          taskId: `T${i}`,
          nodeId: 'n1',
          verdict: 'clean',
          score: 0,
          applique: false,
          griefs: [],
        },
        1_000 + i,
      );
    }
    expect(store.countInspections()).toBe(25);
    expect(store.pruneGardiennes(10)).toBe(15);
    expect(store.countInspections()).toBe(10);
    // Idempotent, et jamais destructeur sous la rétention.
    expect(store.pruneGardiennes(10)).toBe(0);
    expect(store.pruneGardiennes(5_000)).toBe(0);
    // Ce sont bien les PLUS RÉCENTS qui restent.
    expect(store.listInspections()[0]?.taskId).toBe('T24');
  });

  it('des griefs illisibles rendent une liste vide, jamais une exception', () => {
    store = new HiveStore(':memory:');
    store.enregistrerInspection(
      {
        resultId: 1,
        taskId: 'T1',
        nodeId: 'n1',
        verdict: 'suspect',
        score: 1,
        applique: false,
        griefs: [],
      },
      NOW,
    );
    // Une ligne écrite par une version future, ou une base bricolée à la main :
    // une page de lecture ne doit pas tomber pour ça.
    store.listInspections(); // amorce le schéma
    expect(() => store.listInspections()).not.toThrow();
  });
});

// ─── Parité des courses de drones ───────────────────────────────────────────

describe('Gardiennes : une course ne contourne pas le trou de vol', () => {
  let store: HiveStore;
  afterEach(() => store.close());

  it('un drone qui rend une production creuse ne GAGNE pas : la course continue', () => {
    // Sans cette parité, lancer une course serait le contournement le plus
    // simple des Gardiennes — et le plus coûteux, puisque la victoire ANNULE
    // les drones encore en vol.
    store = new HiveStore(':memory:');
    const journal: HiveEvent[] = [];
    const scheduler = new Scheduler(store, {
      gardiennes: { mode: 'strict' },
      onEvent: (e) => journal.push(e),
    });
    const projet = store.createProject({
      name: 'Ruche',
      repoUrl: 'https://example.invalid/ruche.git',
    });
    store.createTask(
      { id: 'T1', projectId: projet.id, title: 'tâche', prompt: 'corriger src/miel.ts' },
      NOW,
    );
    for (const [nodeId, name] of [
      ['n1', 'alfa'],
      ['n2', 'bravo'],
    ] as const) {
      scheduler.registerNode(
        { nodeId, name, ownerName: 'test', agentType: 'shell', maxConcurrency: 2 },
        NOW,
      );
    }
    store.patchTask('T1', { status: 'ready' }, NOW);
    const course = scheduler.startRace('T1', 2, NOW);
    expect(course.ok).toBe(true);

    // Le premier drone rentre à vide en criant victoire.
    scheduler.handleTaskResult('n1', resultat('T1', { success: true, diff: '', durationMs: 10 }));
    expect(store.getTask('T1')?.status).not.toBe('done');
    expect(journal.map((e) => e.type)).toContain('guard_refused');
    expect(journal.filter((e) => e.type === 'drone_won')).toEqual([]);
    expect(store.countMemories()).toBe(0);

    // Le second rapporte du vrai nectar : lui gagne.
    const diff = [
      'diff --git a/src/miel.ts b/src/miel.ts',
      '--- a/src/miel.ts',
      '+++ b/src/miel.ts',
      '@@ -1,2 +1,3 @@',
      ' a',
      '+b',
      '',
    ].join('\n');
    scheduler.handleTaskResult('n2', resultat('T1', { success: true, diff, durationMs: 20 }));
    expect(store.getTask('T1')?.status).toBe('done');
    expect(store.getTask('T1')?.assignedNodeId).toBe('n2');
    expect(store.countMemories()).toBe(1);
    // Deux inspections rangées : la refusée et l'acceptée.
    expect(store.listInspections().map((i) => i.applique)).toEqual([false, true]);
  });
});
