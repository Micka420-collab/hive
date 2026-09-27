// Une OMBRE du banc face au planificateur et au store.
//
// Ce que la vraie Reine (tests/banc-ombre-ruche.test.ts) ne montre pas d'un
// seul parcours, et qui se prouve ici au plus près de l'ordonnanceur :
//
//   · l'ombre est ÉPINGLÉE à son modèle : elle part chez l'ouvrière qui le
//     déclare, et nulle part ailleurs — sans poser d'élection ;
//   · une ouvrière absente se dit une fois, puis l'ombre échoue au-delà du
//     délai : jamais une attente muette pour toujours ;
//   · UN essai : un échec la clôt, sans reprise ;
//   · elle ne se court pas, et le Sting Detector ne la retient pas derrière
//     son originale (qu'une tâche ORDINAIRE identique, elle, attendrait) ;
//   · le store la tient hors des phéromones, des leçons d'échec, de
//     l'apprentissage des Garde-Fous — et hors du contexte qu'on lui sert :
//     le souvenir de son originale ne lui souffle pas la réponse.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTENTE_RELECTEUR_ABSENT_MS, Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { affectationsDepuisEvenements } from '../src/shared/routage-vue.js';
import type { HiveEvent } from '../src/shared/types.js';

const profil = (name: string, modeles: string[]) => ({
  nodeId: name,
  name,
  ownerName: 'banc',
  agentType: 'claude-code',
  maxConcurrency: 2,
  modeles,
});

const PROMPT = 'modifie src/somme.ts pour ajouter somme(a, b)';

describe('une ombre du banc face au planificateur', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assignations: { nodeId: string; taskId: string; modele?: string }[];
  let evenements: HiveEvent[];

  beforeEach(() => {
    store = new HiveStore(':memory:');
    assignations = [];
    evenements = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task, modele) => assignations.push({ nodeId, taskId: task.id, modele }),
      onEvent: (e) => evenements.push(e),
    });
  });
  afterEach(() => store.close());

  /** Une originale déjà produite, et son ombre épinglée à `modeleOmbre`. */
  function ombre(modeleOmbre: string): { projectId: string; originale: string; ombre: string } {
    const p = store.createProject({ name: 'P' });
    const o = store.createTask({ projectId: p.id, title: 'Ajouter somme', prompt: PROMPT });
    store.patchTask(o.id, { status: 'done' });
    const lien = store.creerTacheOmbre({
      original: o,
      titre: 'Ombre — Ajouter somme',
      resultatOriginal: 1,
      modeleOriginal: 'opus',
      modeleOmbre,
    });
    return { projectId: p.id, originale: o.id, ombre: lien.tacheOmbre };
  }

  const types = (type: string) => evenements.filter((e) => e.type === type);

  it('part chez l’ouvrière qui DÉCLARE son modèle, avec ce modèle — sans élection posée', () => {
    scheduler.registerNode(profil('n-opus', ['opus']));
    scheduler.registerNode(profil('n-fable', ['fable']));
    const { ombre: s } = ombre('fable');
    scheduler.tick();
    expect(assignations).toEqual([{ nodeId: 'n-fable', taskId: s, modele: 'fable' }]);
    expect(store.modeleAiguillageDe(s)).toBeNull();
    expect(types('task_assigned')[0]?.payload).toMatchObject({
      taskId: s,
      modele: 'fable',
      ombre: true,
    });
    // Aucune raison d'Aiguillage : elle n'a pas été élue — et Mission Control
    // ne la dit pas « élue ».
    expect(types('task_assigned')[0]?.payload).not.toHaveProperty('raisonModele');
    expect(affectationsDepuisEvenements(evenements)[0]).toMatchObject({
      modele: 'fable',
      critereNoeud: 'porteur_du_modele_ombre',
    });
  });

  it('une ouvrière absente se dit UNE fois, puis l’ombre échoue au-delà du délai', () => {
    const t0 = Date.now();
    scheduler.registerNode(profil('n-opus', ['opus']), t0);
    const { ombre: s } = ombre('fable');
    scheduler.tick(t0);
    scheduler.tick(t0 + 1_000);
    expect(assignations).toEqual([]);
    expect(types('shadow_bench_waiting').map((e) => e.payload)).toEqual([
      {
        taskId: s,
        tacheOriginale: store.ombreDe(s)?.tacheOriginale,
        modele: 'fable',
        delaiMs: ATTENTE_RELECTEUR_ABSENT_MS,
      },
    ]);
    expect(store.getTask(s)?.status).toBe('ready');

    scheduler.tick(t0 + ATTENTE_RELECTEUR_ABSENT_MS + 1);
    expect(store.getTask(s)?.status).toBe('failed');
    expect(types('task_failed').at(-1)?.payload).toEqual({
      taskId: s,
      reason: 'modele_ombre_absent',
    });
    expect(assignations, 'jamais relancée sur un autre modèle').toEqual([]);
  });

  it('UN essai : un échec la clôt, sans reprise', () => {
    scheduler.registerNode(profil('n-fable', ['fable']));
    const { ombre: s } = ombre('fable');
    scheduler.tick();
    scheduler.handleTaskResult('n-fable', {
      taskId: s,
      success: false,
      diff: '',
      logs: 'plantage',
      durationMs: 5,
      subAgents: [],
    });
    expect(store.getTask(s)).toMatchObject({ status: 'failed', attempts: 1 });
    expect(types('task_retry')).toEqual([]);
    expect(assignations).toHaveLength(1);
  });

  it('ne se court pas', () => {
    scheduler.registerNode(profil('n-fable', ['fable']));
    scheduler.registerNode(profil('n-fable-2', ['fable']));
    const { ombre: s } = ombre('fable');
    store.patchTask(s, { status: 'ready' });
    const course = scheduler.startRace(s, 2);
    expect(course.ok).toBe(false);
  });

  it('le Sting Detector ne la retient pas derrière son originale — une tâche ordinaire identique, si', () => {
    scheduler.registerNode(profil('n-opus', ['opus']));
    scheduler.registerNode(profil('n-fable', ['fable']));
    const { projectId, originale, ombre: s } = ombre('fable');
    // L'originale est REPARTIE (une correction) et tourne sur les mêmes fichiers.
    store.patchTask(originale, { status: 'running', assignedNodeId: 'n-opus' });
    const jumelle = store.createTask({ projectId, title: 'Ajouter somme', prompt: PROMPT });
    store.patchTask(jumelle.id, { status: 'ready' });
    scheduler.tick();
    expect(assignations.map((a) => a.taskId)).toContain(s);
    expect(
      types('task_conflict_deferred').map((e) => e.payload.taskId),
      'le banc voit bien le conflit sur une tâche ordinaire',
    ).toEqual([jumelle.id]);
  });
});

describe('une ombre face au store — hors des poids et des leçons', () => {
  let store: HiveStore;
  beforeEach(() => {
    store = new HiveStore(':memory:');
  });
  afterEach(() => store.close());

  it('ni phéromones, ni leçons d’échec, ni apprentissage des Garde-Fous', () => {
    const p = store.createProject({ name: 'P' });
    const o = store.createTask({ projectId: p.id, title: 'Ajouter somme', prompt: PROMPT });
    const s = store.creerTacheOmbre({
      original: o,
      titre: 'Ombre — Ajouter somme',
      resultatOriginal: 1,
      modeleOriginal: 'opus',
      modeleOmbre: 'fable',
    }).tacheOmbre;
    const echec = (taskId: string) =>
      store.insertResult({
        taskId,
        nodeId: 'n1',
        diff: '',
        logs: 'erreur',
        success: false,
        durationMs: 5,
        subAgents: [],
      });
    const rO = echec(o.id);
    const rS = echec(s);
    expect(store.listResultsForPheromones().map((r) => r.taskId)).toEqual([o.id]);
    expect(store.listRecentFailures().map((r) => r.taskId)).toEqual([o.id]);

    // Garde-Fous : les deux productions sont tranchées de la même façon.
    for (const [taskId, resultId] of [
      [o.id, rO],
      [s, rS],
    ] as const) {
      store.poserEchelonGardeFou(taskId, 'standard');
      store.enregistrerInspection({
        resultId,
        taskId,
        nodeId: 'n1',
        verdict: 'clean',
        score: 0,
        applique: false,
        griefs: [],
      });
      store.poserExigenceGardeFou(taskId, false);
    }
    expect(store.observationsGardeFou()).toHaveLength(1);
  });

  it('le souvenir de l’originale ne se sert pas à son ombre', () => {
    const p = store.createProject({ name: 'P' });
    const o = store.createTask({ projectId: p.id, title: 'Ajouter somme', prompt: PROMPT });
    store.recordMemory({
      projectId: p.id,
      taskId: o.id,
      title: o.title,
      content: 'somme(a, b) ajoutée dans src/somme.ts',
    });
    const requete = `${o.title} ${o.prompt}`;
    expect(store.searchMemories(requete, 3).map((m) => m.memory.taskId)).toEqual([o.id]);
    expect(store.searchMemories(requete, 3, o.id)).toEqual([]);
  });

  it('une ombre dont la tâche a disparu perd son lien — borne référentielle', () => {
    const p = store.createProject({ name: 'P' });
    const o = store.createTask({ projectId: p.id, title: 'T', prompt: 'p' });
    const lien = store.creerTacheOmbre({
      original: o,
      titre: 'Ombre — T',
      resultatOriginal: 1,
      modeleOriginal: 'opus',
      modeleOmbre: 'fable',
    });
    expect(store.pruneTachesOmbre()).toBe(0);
    store.patchTask(lien.tacheOmbre, { status: 'done' });
    store.pruneTasks(0, Date.now() + 1);
    expect(store.getTask(lien.tacheOmbre)).toBeUndefined();
    expect(store.pruneTachesOmbre()).toBe(1);
    expect(store.ombreDe(lien.tacheOmbre)).toBeNull();
  });
});
