// UNE TÂCHE TERMINÉE FERME SON SOUS-ARBRE DÉLÉGUÉ.
//
// ─── LE DÉFAUT QUE CE FICHIER EXISTE POUR EMPÊCHER ───────────────────────────
//
// Un enfant délégué n'a qu'un destinataire : la tâche qui l'a demandé. Quand
// celle-ci se termine — un humain l'annule, elle échoue pour de bon, ou elle
// aboutit sans attendre —, plus personne n'attend le résultat de l'enfant.
// Pourtant il continuait : son nœud travaillait pour rien, son horloge
// d'hébergeur tournait, et un petit-enfant encore en file partait sur une
// ouvrière libre. L'annulation ne suivait que `dependsOn`, qui vaut `[]` pour
// un enfant délégué : la cascade existante ne pouvait pas le voir.
//
// ─── LA RÈGLE, DÉCIDÉE ───────────────────────────────────────────────────────
//
// Quand une tâche atteint un état terminal (done, failed, annulée), chaque
// descendant ENCORE EN VOL est annulé : `cancel_task` à son nœud, et un fait
// `delegation_cancelled` qui dit pourquoi. Un descendant déjà terminé n'est
// pas touché ; une tâche indépendante non plus, jamais.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DemandeDelegation } from '../src/orchestrator/delegation.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import type { HiveEvent, TaskResult } from '../src/shared/types.js';

const profil = (name: string, maxConcurrency = 1): NodeProfile => ({
  name,
  ownerName: 'test',
  agentType: 'shell',
  maxConcurrency,
});

const resultat = (taskId: string, success: boolean): Omit<TaskResult, 'nodeId'> => ({
  taskId,
  success,
  diff: success ? `diff:${taskId}` : '',
  logs: 'x',
  durationMs: 10,
  subAgents: [],
});

const demande = (parentTaskId: string, childTaskId: string): DemandeDelegation => ({
  childTaskId,
  parentTaskId,
  title: `Sous-tâche ${childTaskId}`,
  prompt: 'Exécute ce lot borné et rapporte les preuves.',
  durationMs: 60_000,
  costMicros: 100_000,
  resourceUnits: 1,
});

describe('clôture du sous-arbre délégué à la transition terminale', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let events: HiveEvent[];
  let annulations: Array<{ nodeId: string; taskId: string; reason: string }>;
  let projectId: string;
  const T = Date.now();

  beforeEach(() => {
    store = new HiveStore(':memory:');
    events = [];
    annulations = [];
    scheduler = new Scheduler(store, {
      // Une tentative suffit à épuiser le budget : l'échec DÉFINITIF d'un
      // parent se provoque en un seul résultat.
      maxAttempts: 1,
      onCancel: (nodeId, taskId, reason) => annulations.push({ nodeId, taskId, reason }),
      onEvent: (event) => events.push(event),
    });
    projectId = store.createProject({ name: 'Délégation' }).id;
  });

  afterEach(() => store.close());

  const creerPrete = (id: string, at: number): void => {
    store.createTask({ id, projectId, title: id, prompt: 'p' }, at);
    store.patchTask(id, { status: 'ready' }, at);
  };

  const deleguer = (parentTaskId: string, childTaskId: string): void => {
    const creation = store.createDelegatedTask(demande(parentTaskId, childTaskId), undefined, T);
    expect(creation.ok).toBe(true);
  };

  const noeudDe = (taskId: string): string => {
    const nodeId = store.getTask(taskId)?.assignedNodeId;
    if (!nodeId) throw new Error(`${taskId} n'est assignée à aucun nœud`);
    return nodeId;
  };

  /**
   * parent (running @a) ─┬─ enfant (running @c) ── petit-enfant (assigned @d)
   *                      ├─ enfant-2 (ready : plus aucune capacité)
   *                      └─ enfant-fini (done)
   * independante (assigned @b) : même projet, aucun lien.
   */
  function monterSousArbre(): void {
    for (const nom of ['a', 'b', 'c', 'd']) scheduler.registerNode(profil(nom), T);
    creerPrete('parent', T);
    creerPrete('independante', T + 1);
    scheduler.tick(T);
    scheduler.handleTaskUpdate(noeudDe('parent'), 'parent');
    deleguer('parent', 'enfant');
    scheduler.tick(T);
    scheduler.handleTaskUpdate(noeudDe('enfant'), 'enfant');
    deleguer('enfant', 'petit-enfant');
    scheduler.tick(T);
    deleguer('parent', 'enfant-2');
    deleguer('parent', 'enfant-fini');
    scheduler.tick(T);
    store.patchTask('enfant-fini', { status: 'done' }, T);
    expect(store.getTask('enfant')?.status).toBe('running');
    expect(store.getTask('petit-enfant')?.status).toBe('assigned');
    expect(store.getTask('enfant-2')?.status).toBe('ready');
    expect(store.getTask('independante')?.status).toBe('assigned');
    events = [];
    annulations = [];
  }

  const cas = [
    {
      nom: 'un humain annule le parent',
      cause: 'ancestor_cancelled',
      terminer: () => scheduler.cancelTask('parent', 'annulée par un humain', T + 10),
    },
    {
      nom: 'le parent aboutit sans attendre ses enfants',
      cause: 'ancestor_done',
      terminer: () => scheduler.handleTaskResult(noeudDe('parent'), resultat('parent', true)),
    },
    {
      nom: 'le parent échoue pour de bon',
      cause: 'ancestor_failed',
      terminer: () => scheduler.handleTaskResult(noeudDe('parent'), resultat('parent', false)),
    },
  ] as const;

  for (const { nom, cause, terminer } of cas) {
    it(`${nom} : chaque descendant en vol est annulé, rien d'autre (${cause})`, () => {
      monterSousArbre();
      const noeudEnfant = noeudDe('enfant');
      const noeudPetitEnfant = noeudDe('petit-enfant');
      const noeudIndependante = noeudDe('independante');

      terminer();

      for (const id of ['enfant', 'petit-enfant', 'enfant-2']) {
        expect(store.getTask(id), id).toMatchObject({ status: 'failed', assignedNodeId: null });
      }
      // Un descendant déjà terminé garde son issue ; l'indépendante, tout.
      expect(store.getTask('enfant-fini')?.status).toBe('done');
      expect(store.getTask('independante')).toMatchObject({
        status: 'assigned',
        assignedNodeId: noeudIndependante,
      });

      // Les nœuds qui portent un descendant sont prévenus — et eux seuls.
      expect(annulations.filter((a) => a.taskId !== 'parent')).toEqual([
        { nodeId: noeudEnfant, taskId: 'enfant', reason: cause },
        { nodeId: noeudPetitEnfant, taskId: 'petit-enfant', reason: cause },
      ]);

      // Le POURQUOI est un fait typé, parents avant enfants, chacun suivi de
      // son `task_cancelled` — la transition que tous les lecteurs du
      // journal (Chronique, registre, rejeu) connaissent déjà.
      const cascade = events.filter(
        (e) =>
          e.type === 'delegation_cancelled' ||
          (e.type === 'task_cancelled' && e.payload.taskId !== 'parent'),
      );
      expect(cascade.map((e) => [e.type, e.payload.childTaskId ?? e.payload.taskId])).toEqual([
        ['delegation_cancelled', 'enfant'],
        ['task_cancelled', 'enfant'],
        ['delegation_cancelled', 'enfant-2'],
        ['task_cancelled', 'enfant-2'],
        ['delegation_cancelled', 'petit-enfant'],
        ['task_cancelled', 'petit-enfant'],
      ]);
      expect(cascade.find((e) => e.payload.childTaskId === 'petit-enfant')?.payload).toEqual({
        childTaskId: 'petit-enfant',
        parentTaskId: 'enfant',
        rootTaskId: 'parent',
        depth: 2,
        ancestorTaskId: 'parent',
        reason: cause,
        nodeId: noeudPetitEnfant,
      });
      expect(cascade.find((e) => e.payload.childTaskId === 'enfant-2')?.payload).not.toHaveProperty(
        'nodeId',
      );

      // Et l'horloge de l'hébergeur : seule l'indépendante occupe encore un
      // hébergeur, donc la dépense du projet n'avance plus qu'à UN rythme.
      const plusTard = Date.now() + 60_000;
      expect(
        store.depenseHorlogeHote(projectId, plusTard + 1_000) -
          store.depenseHorlogeHote(projectId, plusTard),
      ).toBe(1_000);
    });
  }

  it('un enfant qui aboutit ferme SON sous-arbre, jamais celui de son parent', () => {
    monterSousArbre();
    const noeudPetitEnfant = noeudDe('petit-enfant');

    scheduler.handleTaskResult(noeudDe('enfant'), resultat('enfant', true));

    expect(store.getTask('enfant')?.status).toBe('done');
    expect(store.getTask('petit-enfant')?.status).toBe('failed');
    expect(annulations).toEqual([
      { nodeId: noeudPetitEnfant, taskId: 'petit-enfant', reason: 'ancestor_done' },
    ]);
    expect(events.find((e) => e.type === 'delegation_cancelled')?.payload).toMatchObject({
      childTaskId: 'petit-enfant',
      ancestorTaskId: 'enfant',
      reason: 'ancestor_done',
    });
    // Le parent et le reste de SA descendance continuent.
    expect(store.getTask('parent')?.status).toBe('running');
    expect(store.getTask('enfant-2')?.status).not.toBe('failed');
  });

  /**
   * La course que le scénario V2 Alpha a révélée : l'enfant livre, le parent
   * reprend son travail, une contre-revue conteste l'enfant et l'Evaluator le
   * rouvre — puis le parent se termine.
   *
   * parent (running) ─┬─ enfant (rouvert, assigned) ── petit-enfant (assigned)
   *                   └─ enfant-2 (ready : jamais entendu par le parent)
   */
  function monterCorrection(): void {
    for (const nom of ['a', 'b', 'c']) scheduler.registerNode(profil(nom), T);
    creerPrete('parent', T);
    scheduler.tick(T);
    scheduler.handleTaskUpdate(noeudDe('parent'), 'parent');
    deleguer('parent', 'enfant');
    scheduler.tick(T);
    scheduler.handleTaskResult(noeudDe('enfant'), resultat('enfant', true));
    const livre = store.resultsForTask('enfant').at(-1);
    const rouvert = scheduler.retryFromEvaluator({
      taskId: 'enfant',
      resultId: livre?.resultId ?? -1,
      decision: 'correction_required',
    });
    expect(rouvert.ok).toBe(true);
    scheduler.tick(T);
    // La correction délègue à son tour : ce petit-enfant attend l'ENFANT.
    deleguer('enfant', 'petit-enfant');
    scheduler.tick(T);
    // Et un second enfant que le parent n'a jamais entendu, lui, est orphelin.
    deleguer('parent', 'enfant-2');
    scheduler.tick(T);
    expect(store.getTask('enfant')?.status).toBe('assigned');
    expect(store.getTask('petit-enfant')?.status).toBe('assigned');
    expect(store.getTask('enfant-2')?.status).toBe('ready');
    annulations = [];
    events = [];
  }

  // Un parent ABOUTI peut encore être rouvert par l'Evaluator et rejouer
  // l'identifiant stable : la correction exigée de l'enfant n'est pas le
  // travail qu'il attend, l'annuler effaçait la décision de l'Evaluator et sa
  // tentative suivante relisait l'avis contesté. Un parent échoué ou annulé,
  // lui, ne sera JAMAIS rouvert (l'Evaluator ne rouvre qu'une tâche `done`) :
  // la correction n'a plus de destinataire, elle est annulée comme le reste —
  // sinon elle tournait, facturée, pour personne.
  const casCorrection = [
    {
      cause: 'ancestor_done',
      epargnee: true,
      terminer: () => scheduler.handleTaskResult(noeudDe('parent'), resultat('parent', true)),
    },
    {
      cause: 'ancestor_failed',
      epargnee: false,
      terminer: () => scheduler.handleTaskResult(noeudDe('parent'), resultat('parent', false)),
    },
    {
      cause: 'ancestor_cancelled',
      epargnee: false,
      terminer: () => scheduler.cancelTask('parent', 'annulée par un humain', T + 10),
    },
  ] as const;

  for (const { cause, epargnee, terminer } of casCorrection) {
    it(`un enfant rouvert par l’Evaluator après avoir livré ${
      epargnee ? 'garde sa correction' : 'est annulé avec le reste'
    } (${cause})`, () => {
      monterCorrection();
      const noeudEnfant = noeudDe('enfant');
      const noeudPetitEnfant = noeudDe('petit-enfant');

      terminer();

      const correction = epargnee ? 'assigned' : 'failed';
      expect(store.getTask('enfant')?.status).toBe(correction);
      expect(store.getTask('petit-enfant')?.status).toBe(correction);
      expect(store.getTask('enfant-2')?.status).toBe('failed');
      expect(annulations.filter((a) => a.taskId !== 'parent')).toEqual(
        epargnee
          ? []
          : [
              { nodeId: noeudEnfant, taskId: 'enfant', reason: cause },
              { nodeId: noeudPetitEnfant, taskId: 'petit-enfant', reason: cause },
            ],
      );
      expect(
        events.filter((e) => e.type === 'delegation_cancelled').map((e) => e.payload.childTaskId),
      ).toEqual(epargnee ? ['enfant-2'] : ['enfant', 'enfant-2', 'petit-enfant']);
      // Épargnée, la correction occupe encore deux hébergeurs ; annulée, plus
      // rien de ce projet ne tourne, et la dépense s'arrête net.
      const plusTard = Date.now() + 60_000;
      expect(
        store.depenseHorlogeHote(projectId, plusTard + 1_000) -
          store.depenseHorlogeHote(projectId, plusTard),
      ).toBe(epargnee ? 2_000 : 0);
    });
  }

  it('sous un ancêtre échoué ou annulé, l’Evaluator ne rouvre plus aucun descendant', () => {
    // La clôture n'a lieu qu'une fois, à la transition terminale : un
    // descendant qui avait déjà livré n'est pas en vol, elle le laisse. Le
    // rouvrir APRÈS — une contre-revue contestée qui revient tard — le
    // remettait en vol, et à la facture, pour un ancêtre qui ne le lira jamais.
    for (const nom of ['a', 'b', 'c']) scheduler.registerNode(profil(nom), T);
    creerPrete('parent', T);
    scheduler.tick(T);
    scheduler.handleTaskUpdate(noeudDe('parent'), 'parent');
    deleguer('parent', 'enfant');
    scheduler.tick(T);
    scheduler.handleTaskUpdate(noeudDe('enfant'), 'enfant');
    deleguer('enfant', 'petit-enfant');
    scheduler.tick(T);
    scheduler.handleTaskResult(noeudDe('petit-enfant'), resultat('petit-enfant', true));
    scheduler.handleTaskResult(noeudDe('enfant'), resultat('enfant', true));
    scheduler.cancelTask('parent', 'annulée par un humain', T + 10);
    events = [];

    // Le parent direct du petit-enfant a ABOUTI ; c'est l'ancêtre au-dessus
    // qui est annulé — la montée ne s'arrête pas à la première génération.
    for (const taskId of ['enfant', 'petit-enfant']) {
      const livre = store.resultsForTask(taskId).at(-1);
      const retry = scheduler.retryFromEvaluator({
        taskId,
        resultId: livre?.resultId ?? -1,
        decision: 'correction_required',
      });
      expect(retry, taskId).toMatchObject({ ok: false, reason: 'ancestor_failed' });
      expect(store.getTask(taskId)?.status, taskId).toBe('done');
    }
    scheduler.tick(T + 20);
    expect(events.filter((e) => e.type === 'task_retry' || e.type === 'task_assigned')).toEqual([]);
  });

  it('aucun agent fonctionnel : l’échec d’infrastructure du parent ferme aussi son sous-arbre', () => {
    const a = scheduler.registerNode(profil('a', 2), T);
    creerPrete('parent', T);
    scheduler.tick(T);
    scheduler.handleTaskUpdate(a.id, 'parent');
    deleguer('parent', 'enfant');
    scheduler.tick(T);
    expect(store.getTask('enfant')?.assignedNodeId).toBe(a.id);

    // Un seul nœud en ligne : trois refus d'infrastructure suffisent.
    for (let essai = 0; essai < 3; essai++) {
      const t = T + essai * 4_000;
      if (essai > 0) scheduler.tick(t);
      expect(store.getTask('parent')?.assignedNodeId).toBe(a.id);
      scheduler.rejectTask(a.id, 'parent', 'agent en panne', true, t + 1);
    }

    expect(store.getTask('parent')?.status).toBe('failed');
    expect(store.getTask('enfant')?.status).toBe('failed');
    expect(events.find((e) => e.type === 'delegation_cancelled')?.payload).toMatchObject({
      childTaskId: 'enfant',
      ancestorTaskId: 'parent',
      reason: 'ancestor_failed',
    });
  });

  // Une course a DEUX issues terminales pour le parent : un drone gagne, ou
  // tous échouent sur la dernière tentative. Chacune ferme le sous-arbre.
  const casCourse = [
    { issue: 'gagnée', succes: true, statut: 'done', cause: 'ancestor_done' },
    {
      issue: 'perdue, tentatives épuisées,',
      succes: false,
      statut: 'failed',
      cause: 'ancestor_failed',
    },
  ] as const;

  for (const { issue, succes, statut, cause } of casCourse) {
    it(`une course ${issue} par le parent ferme aussi son sous-arbre (${cause})`, () => {
      for (const nom of ['a', 'b', 'c']) scheduler.registerNode(profil(nom), T);
      creerPrete('parent', T);
      const course = scheduler.startRace('parent', 2, T);
      if (!course.ok) throw new Error(course.error);
      deleguer('parent', 'enfant');
      scheduler.tick(T);
      const noeudEnfant = noeudDe('enfant');
      expect(course.drones).not.toContain(noeudEnfant);

      // Gagnée : le premier drone suffit. Perdue : chacun rend son échec.
      for (const drone of succes ? course.drones.slice(0, 1) : course.drones) {
        scheduler.handleTaskResult(drone, resultat('parent', succes));
      }

      expect(store.getTask('parent')?.status).toBe(statut);
      expect(store.getTask('enfant')?.status).toBe('failed');
      expect(annulations).toContainEqual({ nodeId: noeudEnfant, taskId: 'enfant', reason: cause });
    });
  }
});
