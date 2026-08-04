// L'AGENT GARDE-FOUS DANS LA COURSE DE DRONES (Plein Essaim, lot G4c).
//
// La course est l'autre chemin d'assignation. Son parti pris (comme l'Aiguillage) :
// on ne RESTREINT PAS la course à un échelon — sa robustesse vient de la DIVERSITÉ
// des agents. On POSE seulement l'échelon du projet opt-in, UNE FOIS pour la tâche
// (le mode est PAR TÂCHE, pas par drone), et le REFUS de la course suit cet échelon
// — la même parité qui empêche une course de contourner les Gardiennes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import type { Echelon } from '../src/orchestrator/garde-fou.js';

const profile = (name: string, agentType: string): NodeProfile => ({
  name,
  ownerName: 'test',
  agentType,
  maxConcurrency: 2,
});

describe('Garde-Fous câblé — la course de drones', () => {
  let store: HiveStore;
  let scheduler: Scheduler;

  beforeEach(() => {
    store = new HiveStore(':memory:');
    scheduler = new Scheduler(store, {});
  });
  afterEach(() => store.close());

  /** Une tâche prête (qui PROMET un fichier), deux drones, projet opt-in si bornes. */
  function course(bornes?: { min: Echelon; max: Echelon }): { taskId: string; drones: string[] } {
    const p = store.createProject({ name: 'P', repoUrl: 'https://github.com/x/y.git' }).id;
    if (bornes)
      store.setGardeFou(p, { actif: true, borneMin: bornes.min, borneMax: bornes.max }, 'h');
    const taskId = store.createTask({
      projectId: p,
      title: 'critique',
      prompt: 'modifie le fichier src/app.ts', // PROMET un chemin → diff vide = creux
    }).id;
    store.patchTask(taskId, { status: 'ready' });
    scheduler.registerNode(profile('n-a', 'claude-code'));
    scheduler.registerNode(profile('n-b', 'codex'));
    const started = scheduler.startRace(taskId, 2, 1_000);
    if (!started.ok) throw new Error('course non lancée');
    return { taskId, drones: started.drones };
  }

  /** Un succès à DIFF VIDE → verdict creux (le fichier promis n'a pas bougé). */
  const creux = (taskId: string) => ({
    taskId,
    success: true,
    diff: '',
    logs: 'x',
    durationMs: 5,
    subAgents: [],
  });

  const appliqueDe = (taskId: string): boolean | undefined =>
    store.listInspections().find((i) => i.taskId === taskId)?.applique;

  it('POSE l’échelon au lancement de la course pour un projet opt-in ; rien sinon', () => {
    const opt = course({ min: 'leger', max: 'strict' });
    expect(store.getEchelonGardeFou(opt.taskId), 'à froid, le plus strict permis').toBe('strict');

    const libre = course();
    expect(store.getEchelonGardeFou(libre.taskId), 'pas d’opt-in, pas d’échelon').toBeNull();
  });

  it('le REFUS de la course suit l’échelon du projet, pas le seul mode global', () => {
    // Scheduler global-consultatif (défaut). Projet opt-in gouverné « strict » →
    // un creux du drone est REFUSÉ (applique=1) ; sans opt-in, le global
    // consultatif ne refuse pas (applique=0).
    const opt = course({ min: 'strict', max: 'strict' });
    scheduler.handleTaskResult(opt.drones[0]!, creux(opt.taskId));
    expect(appliqueDe(opt.taskId), 'creux REFUSÉ sous strict').toBe(true);

    const libre = course();
    scheduler.handleTaskResult(libre.drones[0]!, creux(libre.taskId));
    expect(appliqueDe(libre.taskId), 'sans opt-in, le global consultatif ne refuse pas').toBe(
      false,
    );
  });
});
