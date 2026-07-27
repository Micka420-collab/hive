// Tests des Phéromones : routage par affinité apprise nœud × domaine — module
// pur (classement de domaine, agrégation avec décroissance, départage) puis
// câblage scheduler : les phéromones ne DÉPARTAGENT que les nœuds à charge
// minimale égale, jamais le critère principal « moins chargé ».

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  calculerPheromones,
  domaineDeTache,
  meilleurNoeud,
} from '../src/orchestrator/pheromones.js';
import type { TraceePheromone } from '../src/orchestrator/pheromones.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';

const JOUR_MS = 24 * 60 * 60 * 1_000;

function trace(
  nodeId: string,
  domaine: TraceePheromone['domaine'],
  score: number,
): TraceePheromone {
  return { nodeId, domaine, score, reussites: 0, echecs: 0 };
}

describe('domaineDeTache', () => {
  it('reconnaît les domaines en français comme en anglais', () => {
    expect(domaineDeTache('Créer une route API', 'exposer un endpoint REST')).toBe('api');
    expect(domaineDeTache('Fix the login button', 'tweak the css of the component')).toBe('ui');
    expect(domaineDeTache('Migration du schéma', 'écrire la migration SQL de la database')).toBe(
      'db',
    );
    expect(domaineDeTache('Écrire les tests', 'couverture vitest des specs')).toBe('tests');
    expect(domaineDeTache('Mettre à jour le README', 'compléter la documentation du guide')).toBe(
      'docs',
    );
    expect(domaineDeTache('Pipeline CI', 'construire l’image docker et deploy')).toBe('infra');
  });

  it('compte des mots entiers : « construire » ne vote pas pour ui', () => {
    expect(domaineDeTache('Construire le produit', 'construire quelque chose de solide')).toBe(
      'general',
    );
  });

  it('le titre pèse double : il l’emporte sur un prompt plus verbeux', () => {
    // Titre : 2 votes api (route, api) doublés = 4 ; prompt : 3 votes ui.
    // Sans le doublage du titre, ui gagnerait 3 à 2.
    expect(
      domaineDeTache('Créer une route pour l’API', 'avec un bouton react sur l’interface'),
    ).toBe('api');
  });

  it('égalité de comptage → ordre de déclaration des domaines', () => {
    // 'api' (×2 via le titre) contre 'ui' (×2 via le titre) : api déclaré avant.
    expect(domaineDeTache('api ui', '')).toBe('api');
  });

  it('aucun mot-clé → general', () => {
    expect(domaineDeTache('Réfléchir au produit', 'faire quelque chose d’utile')).toBe('general');
  });
});

describe('calculerPheromones', () => {
  const taches = [
    { id: 't-api-1', title: 'route api', prompt: 'endpoint rest' },
    { id: 't-api-2', title: 'autre endpoint api', prompt: 'serveur rest' },
    { id: 't-ui-1', title: 'bouton react', prompt: 'css de l’interface' },
  ];

  it('agrège les dépôts par (nœud, domaine) : réussites, échecs, score', () => {
    const now = 1_000_000;
    const traces = calculerPheromones(
      taches,
      [
        { taskId: 't-api-1', nodeId: 'n1', success: true, createdAt: now },
        { taskId: 't-api-2', nodeId: 'n1', success: true, createdAt: now },
        { taskId: 't-api-1', nodeId: 'n1', success: false, createdAt: now },
        { taskId: 't-ui-1', nodeId: 'n2', success: true, createdAt: now },
      ],
      now,
    );
    const n1api = traces.find((t) => t.nodeId === 'n1' && t.domaine === 'api');
    expect(n1api).toEqual({ nodeId: 'n1', domaine: 'api', score: 14, reussites: 2, echecs: 1 });
    const n2ui = traces.find((t) => t.nodeId === 'n2' && t.domaine === 'ui');
    expect(n2ui).toEqual({ nodeId: 'n2', domaine: 'ui', score: 10, reussites: 1, echecs: 0 });
    // Tri par score décroissant.
    expect(traces.map((t) => t.score)).toEqual(
      [...traces.map((t) => t.score)].sort((a, b) => b - a),
    );
  });

  it('décroissance : un résultat vieux de 7 jours pèse exactement moitié moins', () => {
    const now = 100 * JOUR_MS;
    const traces = calculerPheromones(
      taches,
      [{ taskId: 't-api-1', nodeId: 'n1', success: true, createdAt: now - 7 * JOUR_MS }],
      now,
    );
    expect(traces[0]?.score).toBe(5);
  });

  it('arrondit les scores à 2 décimales', () => {
    const now = 100 * JOUR_MS;
    // 3,5 jours → poids 2^(-0.5) ≈ 0,7071 → 10 × 0,7071 = 7,0710… → 7,07.
    const traces = calculerPheromones(
      taches,
      [{ taskId: 't-api-1', nodeId: 'n1', success: true, createdAt: now - 3.5 * JOUR_MS }],
      now,
    );
    expect(traces[0]?.score).toBe(7.07);
  });

  it('ignore un résultat dont la tâche est inconnue (purgée)', () => {
    const traces = calculerPheromones(
      taches,
      [{ taskId: 'disparue', nodeId: 'n1', success: true, createdAt: 0 }],
      1_000,
    );
    expect(traces).toEqual([]);
  });
});

describe('meilleurNoeud', () => {
  it('signal net : le meilleur score strictement positif gagne', () => {
    const traces = [trace('n1', 'api', 14), trace('n2', 'api', 3)];
    expect(meilleurNoeud(['n1', 'n2'], 'api', traces)).toBe('n1');
  });

  it('aucun score strictement positif → null', () => {
    expect(meilleurNoeud(['n1', 'n2'], 'api', [trace('n1', 'api', -6)])).toBe(null);
    expect(meilleurNoeud(['n1', 'n2'], 'api', [])).toBe(null);
  });

  it('égalité de score en tête → null (pas de vrai signal)', () => {
    const traces = [trace('n1', 'api', 10), trace('n2', 'api', 10)];
    expect(meilleurNoeud(['n1', 'n2'], 'api', traces)).toBe(null);
  });

  it('candidat absent des traces → score 0 ; les autres domaines ne comptent pas', () => {
    // n3 sans trace vaut 0 : n1 gagne avec 5.
    expect(meilleurNoeud(['n1', 'n3'], 'api', [trace('n1', 'api', 5)])).toBe('n1');
    // Le score ui énorme de n2 est invisible pour le domaine api.
    const traces = [trace('n1', 'api', 5), trace('n2', 'ui', 100)];
    expect(meilleurNoeud(['n1', 'n2'], 'api', traces)).toBe('n1');
  });
});

describe('Phéromones : câblage scheduler', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assigned: { nodeId: string; taskId: string }[];

  beforeEach(() => {
    store = new HiveStore(':memory:');
    assigned = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task) => assigned.push({ nodeId, taskId: task.id }),
    });
  });

  afterEach(() => store.close());

  function profile(name: string): NodeProfile {
    return { name, ownerName: 'test', agentType: 'shell', maxConcurrency: 2 };
  }

  /** Historique : `nodeId` a réussi `count` tâches 'api' (résultats datés de `now`). */
  function historiqueApi(projectId: string, nodeId: string, count: number, now: number): void {
    for (let i = 0; i < count; i++) {
      const t = store.createTask({
        projectId,
        title: `endpoint rest ${i}`,
        prompt: 'créer une route api',
      });
      store.patchTask(t.id, { status: 'done' });
      store.insertResult(
        { taskId: t.id, nodeId, success: true, diff: 'd', logs: '', durationMs: 5, subAgents: [] },
        now,
      );
    }
  }

  it('à charge égale, l’historique api route vers le nœud marqué + pheromone_route', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    // « a-eclaireur » passerait premier par ordre alphabétique : seul le signal
    // des phéromones peut router la tâche vers « b-butineur ».
    scheduler.registerNode(profile('a-eclaireur'), now);
    const nb = scheduler.registerNode(profile('b-butineur'), now);
    historiqueApi(p.id, nb.id, 2, now);

    const task = store.createTask({
      projectId: p.id,
      title: 'nouvelle route api',
      prompt: 'exposer un endpoint rest',
    });
    store.patchTask(task.id, { status: 'ready' });
    assigned = [];
    scheduler.tick(now);

    expect(store.getTask(task.id)?.assignedNodeId).toBe(nb.id);
    expect(assigned).toEqual([{ nodeId: nb.id, taskId: task.id }]);
    const route = store.listEvents().find((e) => e.type === 'pheromone_route');
    expect(route?.payload).toMatchObject({
      taskId: task.id,
      nodeId: nb.id,
      domaine: 'api',
      score: 20,
    });
    expect(String(route?.payload.message)).toContain('b-butineur');
  });

  it('sans historique : pas de pheromone_route, l’ordre actuel (nom) décide', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    const na = scheduler.registerNode(profile('a-eclaireur'), now);
    scheduler.registerNode(profile('b-butineur'), now);

    const task = store.createTask({
      projectId: p.id,
      title: 'nouvelle route api',
      prompt: 'exposer un endpoint rest',
    });
    store.patchTask(task.id, { status: 'ready' });
    assigned = [];
    scheduler.tick(now);

    expect(store.getTask(task.id)?.assignedNodeId).toBe(na.id);
    expect(assigned).toEqual([{ nodeId: na.id, taskId: task.id }]);
    expect(store.listEvents().some((e) => e.type === 'pheromone_route')).toBe(false);
  });

  it('ne renverse jamais le critère principal : le moins chargé gagne malgré les phéromones', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    const na = scheduler.registerNode(profile('a-eclaireur'), now);
    const nb = scheduler.registerNode(profile('b-butineur'), now);
    historiqueApi(p.id, nb.id, 3, now);
    // b-butineur est déjà occupé : plus d'égalité de charge → pas de départage.
    const occupation = store.createTask({ projectId: p.id, title: 'occupation', prompt: 'x' });
    store.patchTask(occupation.id, { status: 'running', assignedNodeId: nb.id });

    const task = store.createTask({
      projectId: p.id,
      title: 'nouvelle route api',
      prompt: 'exposer un endpoint rest',
    });
    store.patchTask(task.id, { status: 'ready' });
    assigned = [];
    scheduler.tick(now);

    expect(store.getTask(task.id)?.assignedNodeId).toBe(na.id);
    expect(store.listEvents().some((e) => e.type === 'pheromone_route')).toBe(false);
  });
});
