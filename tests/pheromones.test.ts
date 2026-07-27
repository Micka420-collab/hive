// Tests des Phéromones : routage par affinité apprise nœud × domaine — module
// pur (classement de domaine, agrégation avec décroissance, départage) puis
// câblage scheduler : les phéromones ne DÉPARTAGENT que les nœuds à charge
// minimale égale, jamais le critère principal « moins chargé ».

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  CacheDomaines,
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

  it('tolère le pluriel sur un mot-clé COMPOSÉ : « bases de données »', () => {
    // Le `s?` posé en fin de chaîne ne couvrait que le dernier mot : le
    // pluriel français, lui, se pose d'abord sur le premier.
    expect(domaineDeTache('Nettoyer les bases de données', 'purge hebdomadaire')).toBe('db');
    expect(domaineDeTache('Nettoyer la base de données', 'purge hebdomadaire')).toBe('db');
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

describe('CacheDomaines (mémoïsation bornée)', () => {
  const tache = (id: string) => ({ id, title: 'route api', prompt: 'endpoint rest' });

  it('ne classe qu’UNE fois par taskId (titre et prompt sont immuables)', () => {
    const cache = new CacheDomaines();
    for (let i = 0; i < 50; i++) expect(cache.domaine(tache('t-1'))).toBe('api');
    expect(cache.statistiques).toEqual({ taille: 1, calculs: 1 });
  });

  it('ne lit que les ids MANQUANTS, et ignore les tâches introuvables', () => {
    const cache = new CacheDomaines();
    const lus: string[][] = [];
    const lire = (manquants: string[]) => {
      lus.push([...manquants]);
      return manquants.filter((id) => id !== 'purgee').map(tache);
    };

    const premier = cache.domaines(['t-1', 't-2', 't-1', 'purgee'], lire);
    expect(premier).toEqual(
      new Map([
        ['t-1', 'api'],
        ['t-2', 'api'],
      ]),
    );
    expect(lus).toEqual([['t-1', 't-2', 'purgee']]); // dédoublonné

    // Deuxième passe : plus rien à lire pour les ids déjà connus.
    const second = cache.domaines(['t-1', 't-2'], lire);
    expect(second.size).toBe(2);
    expect(lus).toHaveLength(1);
    expect(cache.statistiques.calculs).toBe(2);
  });

  it('capacité plafonnée : la plus ancienne entrée est purgée (pas de fuite sur dix ans)', () => {
    const cache = new CacheDomaines(3);
    for (const id of ['a', 'b', 'c', 'd']) cache.domaine(tache(id));
    expect(cache.statistiques).toEqual({ taille: 3, calculs: 4 });
    cache.domaine(tache('a')); // 'a' a été évincée : recalculée
    expect(cache.statistiques).toEqual({ taille: 3, calculs: 5 });
    cache.domaine(tache('d')); // 'd' est encore là
    expect(cache.statistiques.calculs).toBe(5);
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
    expect(route?.payload).toEqual({
      taskId: task.id,
      nodeId: nb.id,
      nodeName: 'b-butineur',
      domaine: 'api',
      score: 20,
    });
    // Faits typés uniquement : le nom du nœud remplace le message français figé.
    expect(route?.payload.message).toBeUndefined();
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

  it('ne classe QUE les tâches citées par les résultats : la table tasks n’est jamais dépliée', () => {
    const now = Date.now();
    const p = store.createProject({ name: 'P' });
    scheduler.registerNode(profile('a-eclaireur'), now);
    const nb = scheduler.registerNode(profile('b-butineur'), now);
    // 400 tâches terminées SANS résultat : du bruit qu'aucun calcul de domaine
    // ne doit toucher (à 100 000 tâches, c'est ce dépliage qui gelait le tick).
    for (let i = 0; i < 400; i++) {
      const bruit = store.createTask({ projectId: p.id, title: `bruit ${i}`, prompt: 'blabla' });
      store.patchTask(bruit.id, { status: 'done' });
    }
    historiqueApi(p.id, nb.id, 2, now); // 2 tâches réellement citées
    const task = store.createTask({
      projectId: p.id,
      title: 'nouvelle route api',
      prompt: 'exposer un endpoint rest',
    });
    store.patchTask(task.id, { status: 'ready' });

    // Instrumentation : le chemin des phéromones ne doit JAMAIS passer par un
    // SELECT * de la table tasks, et ne lire que les ids cités.
    let dépliages = 0;
    const idsLus: string[] = [];
    const vraiListTasks = store.listTasks.bind(store);
    store.listTasks = (projectId?: string) => {
      dépliages += 1;
      return vraiListTasks(projectId);
    };
    const vraisTextes = store.listTaskTexts.bind(store);
    store.listTaskTexts = (ids: readonly string[]) => {
      idsLus.push(...ids);
      return vraisTextes(ids);
    };

    scheduler.tick(now);

    expect(dépliages).toBe(0);
    expect(idsLus).toHaveLength(2);
    expect(store.getTask(task.id)?.assignedNodeId).toBe(nb.id); // le routage marche toujours
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
