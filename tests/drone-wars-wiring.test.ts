// Câblage Drone Wars dans le scheduler : lancement d'une course, victoire du
// premier succès (perdants annulés), promotion du primaire, extinction de la
// course (échecs/refus/pertes de nœuds), annulation humaine. L'invariant
// central est vérifié partout : jamais de tâche requalifiée pendant que des
// drones volent, jamais de double comptage de résultat.

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import type { Task, TaskResult } from '../src/shared/types.js';

function profile(name: string, agentType = 'shell'): NodeProfile {
  return { name, ownerName: 'test', agentType, maxConcurrency: 2 };
}

function result(taskId: string, success = true): Omit<TaskResult, 'nodeId'> {
  return {
    taskId,
    success,
    diff: success ? `diff:${taskId}` : '',
    logs: 'x',
    durationMs: 5,
    subAgents: [],
  };
}

describe('Drone Wars : câblage scheduler', () => {
  let store: HiveStore;
  let scheduler: Scheduler;
  let assigned: { nodeId: string; taskId: string }[];
  let cancelled: { nodeId: string; taskId: string; reason: string }[];

  beforeEach(() => {
    store = new HiveStore(':memory:');
    assigned = [];
    cancelled = [];
    scheduler = new Scheduler(store, {
      onAssign: (nodeId, task) => assigned.push({ nodeId, taskId: task.id }),
      onCancel: (nodeId, taskId, reason) => cancelled.push({ nodeId, taskId, reason }),
    });
  });

  afterEach(() => store.close());

  /** Prépare une tâche ready + N nœuds online, sans assignation automatique. */
  function setup(nodeCount: number, agentTypes: string[] = []): { task: Task; nodes: string[] } {
    const p = store.createProject({ name: 'P' });
    const task = store.createTask({ projectId: p.id, title: 'critique', prompt: 'x' });
    store.patchTask(task.id, { status: 'ready' });
    const nodes: string[] = [];
    for (let i = 0; i < nodeCount; i++) {
      const n = scheduler.registerNode(profile(`n${i}`, agentTypes[i] ?? 'shell'));
      nodes.push(n.id);
    }
    assigned = []; // ignorer d'éventuelles assignations du registerNode
    return { task: store.getTask(task.id)!, nodes };
  }

  it('lance jusqu à `factor` drones, primaire = 1er, diversité d agents', () => {
    const { task } = setup(4, ['claude-code', 'claude-code', 'codex', 'codex']);
    const started = scheduler.startRace(task.id, 3);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.drones).toHaveLength(3);
    // Diversité : les 2 types présents avant de doubler l'un d'eux.
    const types = started.drones.map((id) => store.getNode(id)!.agentType);
    expect(new Set(types.slice(0, 2)).size).toBe(2);
    // Le store suit le primaire ; les 3 drones ont reçu assign_task.
    const after = store.getTask(task.id)!;
    expect(after.status).toBe('assigned');
    expect(after.assignedNodeId).toBe(started.drones[0]);
    expect(assigned.map((a) => a.taskId)).toEqual([task.id, task.id, task.id]);
  });

  it('listRaces expose les courses en vol, vidées une fois tranchées', () => {
    const { task } = setup(2);
    expect(scheduler.listRaces()).toEqual([]);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const races = scheduler.listRaces();
    expect(races).toHaveLength(1);
    expect(races[0]?.taskId).toBe(task.id);
    expect(races[0]?.drones.map((d) => d.nodeId).sort()).toEqual([...started.drones].sort());
    // Victoire → la course sort de la liste (plus rien en vol).
    scheduler.handleTaskResult(started.drones[0]!, result(task.id));
    expect(scheduler.listRaces()).toEqual([]);
  });

  it('AUCUN MODÈLE DÉCLARÉ ⇒ le champ reste ABSENT, pas un objet vide', () => {
    // ─── LA GARDE QUE LES BORNES RELÂCHÉES ONT TROUVÉE NUE ──────────────────
    //
    // `if (Object.keys(modeleParDrone).length > 0) race.modeleParDrone = …`
    //
    // Mutée en `>= 0`, la course porte `modeleParDrone: {}` au lieu de ne rien
    // porter. Tous les LECTEURS internes passent par `?.[…]` et lisent
    // `undefined` dans les deux cas : côté comportement, rien ne bouge.
    //
    // Mais `listRaces()` est rendu TEL QUEL par l'API (`/races`). La différence
    // sort donc sur le fil : un client verrait tantôt la clé absente, tantôt un
    // objet vide, pour la même situation — « aucun modèle attribué ». Une forme
    // qui varie sans que le sens varie est une forme qu'il faut gérer deux fois.
    //
    // On fige donc l'ABSENCE, qui est le sens : pas de modèle ⇒ pas de champ.
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [course] = scheduler.listRaces();
    expect(course?.modeleParDrone, 'aucun nœud ne déclare de modèle ici').toBeUndefined();
  });

  it('DES MODÈLES DÉCLARÉS ⇒ le champ est là, et nomme chaque drone', () => {
    // La contre-épreuve du banc ci-dessus : sans elle, une implémentation qui
    // n'écrirait JAMAIS le champ le satisferait aussi.
    const { task, nodes } = setup(2);
    for (const id of nodes) {
      const n = store.getNode(id)!;
      store.registerNode({
        nodeId: id,
        name: n.name,
        ownerName: n.ownerName,
        agentType: n.agentType,
        maxConcurrency: n.maxConcurrency,
        modeles: ['claude-opus-5'],
      });
    }
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [course] = scheduler.listRaces();
    expect(course?.modeleParDrone, 'des modèles déclarés doivent apparaître').toBeDefined();
    expect(Object.keys(course?.modeleParDrone ?? {}).sort()).toEqual([...started.drones].sort());
  });

  it('la victoire reste retrouvable dans le journal après la course (lastEventFor)', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [, second] = started.drones;
    expect(store.lastEventFor('drone_won', task.id)).toBeNull();
    scheduler.handleTaskResult(second!, result(task.id));
    const won = store.lastEventFor('drone_won', task.id);
    expect(won?.payload.nodeId).toBe(second);
    expect(won?.payload.cancelled).toBe(1);
    // Une autre tâche ne matche pas (filtre par taskId, pas juste par type).
    expect(store.lastEventFor('drone_won', 'autre-tache')).toBeNull();
    // Les jokers SQL d'un id client ne matchent pas d'autres tâches : le
    // `_` de LIKE aurait fait matcher n'importe quel caractère, et `%` un
    // préfixe entier — la correspondance doit être exacte.
    const wonId = task.id;
    expect(store.lastEventFor('drone_won', wonId.replace(/./, '_'))).toBeNull();
    expect(store.lastEventFor('drone_won', `${wonId[0]}%`)).toBeNull();
    expect(store.lastEventFor('drone_won', '%')).toBeNull();
  });

  it('refuse une course sur une tâche non prête ou déjà en course', () => {
    const { task } = setup(2);
    expect(scheduler.startRace('inconnue', 3)).toMatchObject({ ok: false });
    scheduler.startRace(task.id, 2);
    const again = scheduler.startRace(task.id, 2);
    expect(again).toMatchObject({ ok: false });
    if (!again.ok) expect(again.error).toContain('déjà en vol');
  });

  it('premier succès gagne : résultat accepté, perdants annulés, souvenir enregistré', () => {
    const { task } = setup(3);
    const started = scheduler.startRace(task.id, 3);
    if (!started.ok) throw new Error('course non lancée');
    const [, second, third] = started.drones;

    // Le succès vient d'un drone NON-primaire : il gagne quand même.
    expect(scheduler.handleTaskResult(second!, result(task.id))).toBe(true);
    const after = store.getTask(task.id)!;
    expect(after.status).toBe('done');
    expect(after.result?.nodeId).toBe(second);
    // Les 2 autres drones encore en vol sont annulés.
    expect(cancelled.map((c) => c.nodeId).sort()).toEqual([started.drones[0]!, third!].sort());
    // Un résultat retardataire du 3e drone est ignoré (course tranchée).
    expect(scheduler.handleTaskResult(third!, result(task.id))).toBe(false);
    expect(store.resultsForTask(task.id)).toHaveLength(1);
  });

  it('échec du primaire → promotion d un autre drone, la tâche reste en vol', () => {
    const { task } = setup(3);
    const started = scheduler.startRace(task.id, 3);
    if (!started.ok) throw new Error('course non lancée');
    const [primary, second] = started.drones;

    expect(scheduler.handleTaskResult(primary!, result(task.id, false))).toBe(true);
    const after = store.getTask(task.id)!;
    expect(['assigned', 'running']).toContain(after.status);
    expect(after.assignedNodeId).not.toBe(primary);
    expect(after.attempts).toBe(0); // la course absorbe l'échec individuel
    // Le second peut encore gagner.
    expect(scheduler.handleTaskResult(second!, result(task.id))).toBe(true);
    expect(store.getTask(task.id)!.status).toBe('done');
  });

  it('tous les drones échouent avec de vrais résultats → UNE tentative brûlée (retry)', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [a, b] = started.drones;
    scheduler.handleTaskResult(a!, result(task.id, false));
    scheduler.handleTaskResult(b!, result(task.id, false));
    const after = store.getTask(task.id)!;
    expect(after.attempts).toBe(1); // une seule tentative pour toute la course
    expect(['ready', 'assigned']).toContain(after.status); // repartie dans le circuit normal
  });

  it('refus d un drone (Night Shift/saturation) : pas de tentative, cooldown, promotion', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [primary, second] = started.drones;

    scheduler.rejectTask(primary!, task.id, 'hors_service_night_shift', false, Date.now(), 60_000);
    let after = store.getTask(task.id)!;
    expect(after.assignedNodeId).toBe(second); // promotion
    expect(after.attempts).toBe(0);

    // Le dernier drone refuse aussi : course éteinte, tâche ready sans tentative.
    scheduler.rejectTask(second!, task.id, 'noeud_sature');
    after = store.getTask(task.id)!;
    expect(after.attempts).toBe(0);
    expect(['ready', 'assigned']).toContain(after.status);
  });

  it('mort du primaire (déconnexion) : promotion ; mort du dernier : requeue sans tentative', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [primary, second] = started.drones;

    scheduler.nodeDisconnected(primary!, 'ws_closed');
    let after = store.getTask(task.id)!;
    expect(after.assignedNodeId).toBe(second);
    expect(['assigned', 'running']).toContain(after.status);

    scheduler.nodeDisconnected(second!, 'ws_closed');
    after = store.getTask(task.id)!;
    expect(after.status).toBe('ready');
    expect(after.attempts).toBe(0);
  });

  it('refuse une course sur une tâche en conflit FORT avec une tâche active (Sting)', () => {
    const p = store.createProject({ name: 'P' });
    const active = store.createTask({
      projectId: p.id,
      title: 'modifier `src/app.ts`',
      prompt: 'éditer le fichier `src/app.ts`',
    });
    const ready = store.createTask({
      projectId: p.id,
      title: 'retoucher `src/app.ts`',
      prompt: 'changer aussi `src/app.ts`',
    });
    const node = scheduler.registerNode(profile('n1'));
    store.patchTask(active.id, { status: 'running', assignedNodeId: node.id });
    store.patchTask(ready.id, { status: 'ready' });
    scheduler.registerNode(profile('n2'));

    const started = scheduler.startRace(ready.id, 2);
    expect(started).toMatchObject({ ok: false });
    if (!started.ok) expect(started.error).toContain('conflit fort');
  });

  it('réconciliation : un drone fantôme (reconnexion à vide) est purgé de la course', () => {
    const { task } = setup(2);
    const started = scheduler.startRace(task.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    const [primary, ghost] = started.drones;

    // Le nœud B redémarre (crash sans FIN TCP) et se ré-inscrit SANS déclarer la tâche.
    scheduler.reconcileNode(ghost!, []);
    // Le primaire échoue ensuite : plus aucun drone en vol → la course s'éteint
    // (sans la purge, le fantôme la maintiendrait en vie pour toujours).
    scheduler.handleTaskResult(primary!, result(task.id, false));
    const after = store.getTask(task.id)!;
    expect(['ready', 'assigned']).toContain(after.status);
    expect(after.assignedNodeId).not.toBe(ghost);
  });

  it('capacité : un nœud occupé comme drone non-primaire n est pas sur-réservé', () => {
    const p = store.createProject({ name: 'P' });
    const raced = store.createTask({ projectId: p.id, title: 'critique', prompt: 'x' });
    store.patchTask(raced.id, { status: 'ready' });
    // Deux nœuds à capacité 1 : la course occupe les deux (primaire + drone).
    const n1 = scheduler.registerNode({ ...profile('n1'), maxConcurrency: 1 });
    const n2 = scheduler.registerNode({ ...profile('n2'), maxConcurrency: 1 });
    void n1;
    void n2;
    const started = scheduler.startRace(raced.id, 2);
    if (!started.ok) throw new Error('course non lancée');
    assigned = [];

    // Une nouvelle tâche mono ne doit être assignée à AUCUN des deux (pleins).
    const mono = store.createTask({ projectId: p.id, title: 'mono', prompt: 'y' });
    void mono;
    scheduler.tick();
    expect(assigned).toHaveLength(0);

    // La course se termine : la capacité se libère, la tâche mono part.
    scheduler.handleTaskResult(started.drones[0]!, result(raced.id));
    expect(assigned.some((a) => a.taskId !== raced.id)).toBe(true);
  });

  it('annulation humaine : tous les drones en vol reçoivent cancel_task', () => {
    const { task } = setup(3);
    const started = scheduler.startRace(task.id, 3);
    if (!started.ok) throw new Error('course non lancée');
    scheduler.cancelTask(task.id, 'annulée par un humain');
    expect(store.getTask(task.id)!.status).toBe('failed');
    expect(cancelled).toHaveLength(3);
    // Un résultat tardif d'un drone annulé est ignoré proprement.
    expect(scheduler.handleTaskResult(started.drones[0]!, result(task.id))).toBe(false);
  });
});
