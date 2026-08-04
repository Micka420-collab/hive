// L'AIGUILLAGE APPRIS DANS LA COURSE DE DRONES (Plein Essaim).
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// La boucle principale de l'ordonnanceur écoute déjà l'Aiguillage (lot 3b). La
// COURSE de drones est l'autre chemin d'assignation, et son parti pris est
// différent : on ne RESTREINT pas la course au meilleur modèle — une course
// tire sa robustesse de la DIVERSITÉ des agents. On note seulement le modèle élu
// par chaque drone, pour deux gestes :
//
//   1. tant que la course court, la tâche compte comme une élection EN VOL au
//      modèle du PRIMAIRE (la borne du troupeau, lot 3b-bis) ;
//   2. quand un drone GAGNE, on re-pose SON modèle : c'est sa production que la
//      contre-visite jugera. Un primaire remplacé (promotion, victoire d'un
//      autre) ne doit pas laisser SON modèle attribué à la production d'un autre.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import type { TaskResult } from '../src/shared/types.js';

function profile(name: string, agentType: string, modeles?: string[]): NodeProfile {
  return { name, ownerName: 'test', agentType, maxConcurrency: 2, ...(modeles ? { modeles } : {}) };
}

function result(taskId: string, success = true): Omit<TaskResult, 'nodeId'> {
  return {
    taskId,
    success,
    diff: success ? `diff --git a/x b/x\n+ajout` : '',
    logs: 'x',
    durationMs: 5,
    subAgents: [],
  };
}

describe('Aiguillage câblé — la course de drones', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assignations: { nodeId: string; taskId: string; modele?: string }[];
  beforeEach(() => {
    store = new HiveStore(':memory:');
    assignations = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task, modele) => assignations.push({ nodeId, taskId: task.id, modele }),
    });
  });
  afterEach(() => store.close());

  /** Une tâche prête + deux nœuds à modèle UNIQUE distinct (agents diversifiés). */
  function deuxDrones(modeles?: [string, string]): { taskId: string; a: string; b: string } {
    const p = store.createProject({ name: 'P' });
    const taskId = store.createTask({ projectId: p.id, title: 'critique', prompt: 'x' }).id;
    store.patchTask(taskId, { status: 'ready' });
    const a = scheduler.registerNode(
      profile('n-a', 'claude-code', modeles ? [modeles[0]] : undefined),
    ).id;
    const b = scheduler.registerNode(
      profile('n-b', 'codex', modeles ? [modeles[1]] : undefined),
    ).id;
    return { taskId, a, b };
  }
  function verdict(taskId: string, now: number): void {
    store.enregistrerContreVisite({
      productionTaskId: taskId,
      suite: 'appliquer',
      raison: '',
      visiteurNodeId: 'v',
      visiteurAgent: 'claude-code',
      now,
    });
  }
  /** Le modèle unique déclaré par un nœud. */
  const modeleDe = (nodeId: string): string | undefined => store.getNode(nodeId)?.modeles?.[0];

  it('LE VAINQUEUR VOIT SON MODÈLE ENREGISTRÉ — pas celui du primaire remplacé', () => {
    const { taskId } = deuxDrones(['modele-a', 'modele-b']);
    const started = scheduler.startRace(taskId, 2, 1_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Le NON-primaire gagne : c'est le cas qui distingue « re-pose du vainqueur »
    // de « garde le primaire ». Son modèle doit écraser celui du primaire.
    const primaire = started.drones[0]!;
    const vainqueur = started.drones[1]!;
    scheduler.handleTaskResult(vainqueur, result(taskId));

    verdict(taskId, 3_000);
    const obs = store.observationsAiguillage();
    expect(obs, 'une observation, une seule').toHaveLength(1);
    expect(obs[0]?.modele, 'le modèle du vainqueur').toBe(modeleDe(vainqueur));
    expect(obs[0]?.modele, 'pas celui du primaire remplacé').not.toBe(modeleDe(primaire));
  });

  it('CHAQUE DRONE REÇOIT SON MODÈLE via onAssign — pour le passer à `--model`', () => {
    // La course diversifie les agents : chaque drone lance SON modèle, pas un
    // modèle commun. onAssign doit donc porter, par drone, le modèle de ce drone.
    const { taskId, a, b } = deuxDrones(['modele-a', 'modele-b']);
    const started = scheduler.startRace(taskId, 2, 1_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const modeleAssigne = (nodeId: string): string | undefined =>
      assignations.find((x) => x.nodeId === nodeId && x.taskId === taskId)?.modele;
    expect(modeleAssigne(a), 'le drone a lance son modèle').toBe('modele-a');
    expect(modeleAssigne(b), 'le drone b lance le sien').toBe('modele-b');
  });

  it('PENDANT LA COURSE, LE MODÈLE DU PRIMAIRE EST EN VOL — la borne du troupeau tient aussi ici', () => {
    const { taskId } = deuxDrones(['modele-a', 'modele-b']);
    const started = scheduler.startRace(taskId, 2, 1_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const primaire = started.drones[0]!;
    const enVol = store.electionsEnVolAiguillage();
    expect(enVol, 'la course en cours est une élection en vol').toHaveLength(1);
    expect(enVol[0]?.modele, 'au modèle du primaire').toBe(modeleDe(primaire));
  });

  it('LA PROMOTION SUIT LE PRODUCTEUR — le drone promu devient l’élection en vol', () => {
    const { taskId } = deuxDrones(['modele-a', 'modele-b']);
    const started = scheduler.startRace(taskId, 2, 1_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const primaire = started.drones[0]!;
    const suivant = started.drones[1]!;
    // Le primaire échoue, un autre drone vole encore : il est promu producteur.
    scheduler.handleTaskResult(primaire, result(taskId, false));

    const enVol = store.electionsEnVolAiguillage();
    expect(enVol, 'la tâche court toujours, en vol').toHaveLength(1);
    expect(enVol[0]?.modele, 'au modèle du drone PROMU, plus celui du primaire tombé').toBe(
      modeleDe(suivant),
    );
  });

  it('NO-OP : une course de nœuds SANS modèles n’enregistre aucune élection', () => {
    const { taskId } = deuxDrones(); // aucun modeles déclaré
    const started = scheduler.startRace(taskId, 2, 1_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(store.electionsEnVolAiguillage(), 'rien en vol sans modèle').toEqual([]);
    // Même après une victoire + un verdict, la mémoire reste vide.
    scheduler.handleTaskResult(started.drones[0]!, result(taskId));
    verdict(taskId, 3_000);
    expect(store.observationsAiguillage(), 'aucune observation').toEqual([]);
  });
});
