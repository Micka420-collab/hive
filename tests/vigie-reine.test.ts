// G13 — CE QUE LA REINE FAIT DES ISSUES DE LA VIGIE, sur le vrai planificateur
// et le vrai store (`:memory:`), sans processus : ce qu'une tentative épuisée a
// coûté, la relecture dont le relecteur est épuisé, la course de drones, et la
// tâche qui échoue sur des fournisseurs épuisés.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTENTE_RELECTEUR_ABSENT_MS, Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { chronologieDepuisEvenements } from '../src/shared/chronologie-tache.js';
import type { TaskResult } from '../src/shared/types.js';

/** Un instant fixe : tout le banc est daté. */
const T = 1_000_000;
const HEURE = 3_600_000;

let store: HiveStore;
let scheduler: Scheduler;
beforeEach(() => {
  store = new HiveStore(':memory:');
  scheduler = new Scheduler(store);
});
afterEach(() => store.close());

const evenements = (type: string): Array<Record<string, unknown>> =>
  store
    .listEvents(0, 1000)
    .filter((e) => e.type === type)
    .map((e) => e.payload);

const noeud = (name: string, agentType: string): string =>
  scheduler.registerNode({ name, ownerName: 'banc', agentType, maxConcurrency: 1 }, T).id;

describe('une tentative épuisée A TOURNÉ : ce qu’elle a coûté reste rangé', () => {
  it('LE COÛT DÉCLARÉ ET LA DURÉE voyagent avec le refus : ligne de dépense de l’enfant, chronologie — et un résultat suivant ne les écrase pas', () => {
    const n1 = noeud('ouvriere', 'claude-code');
    const p = store.createProject({ name: 'P' });
    store.createTask({ id: 'racine', projectId: p.id, title: 'Racine', prompt: 'délègue' });
    const creation = store.createDelegatedTask({
      childTaskId: 'enfant',
      parentTaskId: 'racine',
      title: 'Lot',
      prompt: 'fais',
      durationMs: 60_000,
      costMicros: 5_000_000,
      resourceUnits: 1,
    });
    expect(creation.ok).toBe(true);
    // Envoyée au nœud : la ligne de dépense de la tentative s'ouvre.
    store.patchTask('enfant', { status: 'running', assignedNodeId: n1 }, T);
    store.ouvrirTentativeDelegation('enfant', n1, T);

    scheduler.rejectTask(n1, 'enfant', 'API Error: 529 Overloaded', true, T + 10, undefined, {
      fait: { cause: 'surcharge' },
      durationMs: 217_000,
      fournisseur: { source: 'claude-code', coutUsd: 0.0123 },
    });

    expect(evenements('task_rejected')).toEqual([
      expect.objectContaining({
        taskId: 'enfant',
        infra: true,
        epuisement: { cause: 'surcharge' },
        durationMs: 217_000,
        fournisseur: { source: 'claude-code', coutUsd: 0.0123 },
      }),
    ]);
    // Déclarée : 12 300 µUSD, plus « inconnue ».
    expect(store.depenseDeclareeEnfant('enfant')).toMatchObject({
      micros: 12_300,
      tentatives: 1,
      sansCout: 0,
    });
    const tentatives = chronologieDepuisEvenements(
      T,
      store.listEvents(0, 1000).filter((e) => e.payload.taskId === 'enfant'),
    ).tentatives;
    expect(tentatives).toEqual([
      expect.objectContaining({
        issue: 'epuisement',
        dureeWorkerMs: 217_000,
        coutUsd: 0.0123,
        epuisement: { cause: 'surcharge' },
      }),
    ]);

    // La tentative suivante, sur le même nœud : sa propre ligne, son propre coût.
    store.patchTask('enfant', { status: 'running', assignedNodeId: n1 }, T + 20);
    store.ouvrirTentativeDelegation('enfant', n1, T + 20);
    const rendu: Omit<TaskResult, 'nodeId'> = {
      taskId: 'enfant',
      success: true,
      diff: 'diff --git a/x b/x',
      logs: 'ok',
      durationMs: 5,
      subAgents: [],
      fournisseur: { source: 'claude-code', coutUsd: 0.002 },
    };
    expect(scheduler.handleTaskResult(n1, rendu)).toBe(true);
    expect(store.depenseDeclareeEnfant('enfant')).toMatchObject({
      micros: 14_300,
      tentatives: 2,
      sansCout: 0,
    });
  });
});

describe('UN RELECTEUR ÉPUISÉ ne retient pas le verdict jusqu’à sa remise à zéro', () => {
  /** Une production de Claude, sa relecture confiée à Codex et envoyée à son nœud. */
  function scene(): { relecteur: string; relecture: string; production: string } {
    const producteur = noeud('aaa-claude', 'claude-code');
    const relecteur = noeud('zzz-codex', 'codex');
    const p = store.createProject({ name: 'P' });
    const production = store.createTask({ projectId: p.id, title: 'Endpoint', prompt: 'route' });
    store.patchTask(production.id, { status: 'done', assignedNodeId: producteur }, T);
    const relecture = store.createTask({
      projectId: p.id,
      title: 'Contre-expertise — Endpoint',
      prompt: 'CONTRE-EXPERTISE',
    });
    store.inscrireRelecture({
      relectureTaskId: relecture.id,
      productionTaskId: production.id,
      relecteurNodeId: relecteur,
      relecteurAgent: 'codex',
      producteurAgent: 'claude-code',
      now: T,
    });
    store.patchTask(relecture.id, { status: 'running', assignedNodeId: relecteur }, T);
    return { relecteur, relecture: relecture.id, production: production.id };
  }

  it('REMISE DANS UNE HEURE, aucun autre nœud de la famille : la relecture se clôt comme un relecteur absent, motif propre', () => {
    const { relecteur, relecture, production } = scene();
    scheduler.rejectTask(
      relecteur,
      relecture,
      'You’ve hit your usage limit.',
      true,
      T + 10,
      HEURE,
      {
        fait: { cause: 'limite', remiseA: T + 10 + HEURE },
      },
    );
    expect(store.getTask(relecture)?.status).toBe('failed');
    expect(evenements('task_failed')).toEqual([
      expect.objectContaining({
        taskId: relecture,
        reason: 'relecteur_epuise',
        epuisement: { cause: 'limite', remiseA: T + 10 + HEURE },
      }),
    ]);
    expect(evenements('contre_expertise_review_failed')).toEqual([
      expect.objectContaining({
        taskId: production,
        relecture,
        relecteur: 'codex',
        terminal: true,
        motif: 'relecteur_epuise',
      }),
    ]);
  });

  it('une remise sous le délai d’attente, ou un autre nœud de la famille : la relecture attend, comme avant', () => {
    const { relecteur, relecture } = scene();
    scheduler.rejectTask(relecteur, relecture, 'surchargé', true, T + 10, undefined, {
      fait: { cause: 'limite', remiseA: T + 10 + ATTENTE_RELECTEUR_ABSENT_MS - 1 },
    });
    expect(store.getTask(relecture)?.status).toBe('ready');
    expect(evenements('contre_expertise_review_failed')).toEqual([]);

    // Un second nœud Codex en ligne : il reprend la relecture.
    const relais = noeud('zzz-codex-2', 'codex');
    store.patchTask(relecture, { status: 'running', assignedNodeId: relecteur }, T + 20);
    scheduler.rejectTask(relecteur, relecture, 'limite', true, T + 30, HEURE, {
      fait: { cause: 'limite', remiseA: T + 30 + HEURE },
    });
    expect(store.getTask(relecture)).toMatchObject({ status: 'assigned', assignedNodeId: relais });
    expect(evenements('contre_expertise_review_failed')).toEqual([]);
  });
});

describe('les faits de la vigie ne se perdent pas dans une course de drones, ni dans l’échec final', () => {
  function course(): { taskId: string; drones: string[] } {
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'critique', prompt: 'x' });
    store.patchTask(t.id, { status: 'ready' });
    for (let i = 0; i < 3; i += 1) noeud(`n${i}`, 'shell');
    const lancee = scheduler.startRace(t.id, 3);
    if (!lancee.ok) throw new Error('course non lancée');
    return { taskId: t.id, drones: lancee.drones };
  }

  it('UN DRONE ENLISÉ, UN DRONE ÉPUISÉ : `drone_failed` et `drone_rejected` portent leur fait', () => {
    const { taskId, drones } = course();
    const [a, b] = drones;
    expect(
      scheduler.handleTaskResult(a!, {
        taskId,
        success: false,
        diff: '',
        logs: '[hive] enlisé',
        durationMs: 5,
        subAgents: [],
        enlisement: { motif: 'repetition', fois: 4, outil: 'Read' },
      }),
    ).toBe(true);
    scheduler.rejectTask(b!, taskId, '529', true, T + 10, undefined, {
      fait: { cause: 'surcharge' },
      durationMs: 9,
    });
    expect(evenements('drone_failed')).toEqual([
      expect.objectContaining({
        nodeId: a,
        enlisement: { motif: 'repetition', fois: 4, outil: 'Read' },
      }),
    ]);
    expect(evenements('drone_rejected')).toEqual([
      expect.objectContaining({ nodeId: b, epuisement: { cause: 'surcharge' }, durationMs: 9 }),
    ]);
  });

  it('PLUS AUCUN NŒUD DONT L’AGENT FONCTIONNE, sur des fournisseurs épuisés : l’échec final dit pourquoi', () => {
    const n1 = noeud('seul', 'claude-code');
    const p = store.createProject({ name: 'P' });
    const t = store.createTask({ projectId: p.id, title: 'x', prompt: 'x' });
    // Un seul nœud en ligne : la borne des refus d'infrastructure est 3.
    for (let i = 0; i < 3; i += 1) {
      store.patchTask(t.id, { status: 'running', assignedNodeId: n1 }, T + i * 10_000);
      scheduler.rejectTask(n1, t.id, '529', true, T + i * 10_000 + 1, undefined, {
        fait: { cause: 'surcharge' },
      });
    }
    expect(store.getTask(t.id)?.status).toBe('failed');
    expect(evenements('task_failed')).toEqual([
      expect.objectContaining({
        reason: 'no_working_agent',
        infraRejects: 3,
        epuisement: { cause: 'surcharge' },
      }),
    ]);
  });
});
