import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore, type CreationDeleguee } from '../src/orchestrator/store.js';
import type { DemandeDelegation } from '../src/orchestrator/delegation.js';
import { LIMITES_DELEGATION_DEFAUT } from '../src/shared/limites-delegation.js';

const demande = (parentTaskId: string, childTaskId: string): DemandeDelegation => ({
  childTaskId,
  parentTaskId,
  title: `Enfant ${childTaskId}`,
  prompt: 'Exécute ce lot borné et rapporte les preuves.',
  durationMs: 60_000,
  costMicros: 100_000,
  resourceUnits: 1,
  preferredAgent: 'codex',
  preferredModel: 'modele-observe',
});

describe('HiveStore — graphe de délégation', () => {
  let store: HiveStore;
  let rootId: string;

  beforeEach(() => {
    store = new HiveStore(':memory:');
    const project = store.createProject({ name: 'Délégation' });
    rootId = store.createTask({
      id: 'root',
      projectId: project.id,
      title: 'Mission racine',
      prompt: 'Coordonne le travail.',
    }).id;
    store.patchTask(rootId, { status: 'running' });
  });

  afterEach(() => store.close());

  it('crée la tâche et son arête atomiquement dans le projet du parent', () => {
    const result = store.createDelegatedTask(demande(rootId, 'child'), undefined, 1234);
    expect(result).toMatchObject({
      ok: true,
      task: { id: 'child', projectId: store.getTask(rootId)?.projectId, status: 'pending' },
      delegation: {
        parentTaskId: 'root',
        rootTaskId: 'root',
        depth: 1,
        origine: 'hive',
        preferredAgent: 'codex',
        preferredModel: 'modele-observe',
        createdAt: 1234,
      },
    });
    expect(store.getDelegation('child')).toMatchObject({
      childTaskId: 'child',
      title: 'Enfant child',
      prompt: 'Exécute ce lot borné et rapporte les preuves.',
    });
  });

  it('reconstruit le même graphe depuis la racine ou un descendant', () => {
    expect(store.createDelegatedTask(demande(rootId, 'child')).ok).toBe(true);
    store.patchTask('child', { status: 'running' });
    expect(store.createDelegatedTask(demande('child', 'grandchild')).ok).toBe(true);

    const attendu = [
      expect.objectContaining({ taskId: 'root', parentTaskId: null, depth: 0 }),
      expect.objectContaining({ taskId: 'child', parentTaskId: 'root', depth: 1 }),
      expect.objectContaining({ taskId: 'grandchild', parentTaskId: 'child', depth: 2 }),
    ];
    expect(store.listDelegationGraph('root')).toEqual(attendu);
    expect(store.listDelegationGraph('grandchild')).toEqual(attendu);
  });

  it('ne laisse aucune tâche orpheline quand la politique refuse', () => {
    const limites = { ...LIMITES_DELEGATION_DEFAUT, maxDepth: 0 };
    const result = store.createDelegatedTask(demande(rootId, 'refused'), limites);
    expect(result).toMatchObject({ ok: false, code: 'profondeur' });
    expect(store.getTask('refused')).toBeUndefined();
    expect(store.getDelegation('refused')).toBeNull();
  });

  it('refuse un identifiant déjà utilisé hors du graphe', () => {
    const other = store.createProject({ name: 'Autre' });
    store.createTask({ id: 'taken', projectId: other.id, title: 'Déjà là', prompt: 'x' });
    expect(store.createDelegatedTask(demande(rootId, 'taken'))).toMatchObject({
      ok: false,
      code: 'task_id_duplique',
    });
  });

  it('refuse un parent terminal sans modifier le store', () => {
    store.patchTask(rootId, { status: 'done' });
    const result: CreationDeleguee = store.createDelegatedTask(demande(rootId, 'too-late'));
    expect(result).toMatchObject({ ok: false, code: 'parent_termine' });
    expect(store.listTasks()).toHaveLength(1);
  });

  it('préserve les ancêtres tant qu’un descendant vit puis élague tout le graphe clos', () => {
    expect(store.createDelegatedTask(demande(rootId, 'child'), undefined, 0).ok).toBe(true);
    store.patchTask(rootId, { status: 'done' }, 0);
    store.patchTask('child', { status: 'running' }, 1_000);

    expect(store.pruneTasks(100, 1_000)).toBe(0);
    expect(store.getTask(rootId)).toBeDefined();
    expect(store.listDelegationGraph('child')).toHaveLength(2);

    store.patchTask('child', { status: 'done' }, 0);
    expect(store.pruneTasks(100, 1_000)).toBe(2);
    expect(store.getTask(rootId)).toBeUndefined();
    expect(store.getTask('child')).toBeUndefined();
    expect(store.getDelegation('child')).toBeNull();
  });

  // ─── L'ENVELOPPE DE LA RACINE, TENUE DANS LA TRANSACTION ────────────────────

  it('un petit-enfant réserve sur l’enveloppe de la RACINE, pas sur celle de son parent', () => {
    // Jugé enfant par enfant, chacun pouvait réserver la demi-heure entière :
    // 20 min + 11 min passaient, pour 31 min réservées sur une enveloppe de 30.
    const vingtMinutes = { ...demande(rootId, 'child'), durationMs: 20 * 60_000 };
    expect(store.createDelegatedTask(vingtMinutes).ok).toBe(true);
    store.patchTask('child', { status: 'running' });
    const onze = { ...demande('child', 'grandchild'), durationMs: 11 * 60_000 };
    const refus = store.createDelegatedTask(onze);
    expect(refus).toMatchObject({ ok: false, code: 'duree' });
    expect(refus.ok ? '' : refus.motif).toContain(`${20 * 60_000} ms déjà réservés`);
    expect(store.getTask('grandchild')).toBeUndefined();
    // Ce qui reste de l'enveloppe, lui, passe.
    expect(
      store.createDelegatedTask({ ...onze, durationMs: 10 * 60_000 }).ok,
      'les dix minutes restantes',
    ).toBe(true);
  });

  /** Une tentative rendue par `taskId`, avec le coût que son CLI a déclaré. */
  const tentative = (taskId: string, coutUsd?: number): number =>
    store.insertResult({
      taskId,
      nodeId: 'n',
      success: true,
      diff: '',
      logs: '',
      durationMs: 1,
      subAgents: [],
      ...(coutUsd === undefined ? {} : { fournisseur: { source: 'claude-code', coutUsd } }),
    });

  it('range la dépense DÉCLARÉE des enfants — jamais celle de la racine, jamais un zéro inventé', () => {
    expect(store.createDelegatedTask(demande(rootId, 'child')).ok).toBe(true);
    tentative(rootId, 1);
    tentative('child', 0.25);
    tentative('child');
    expect(store.depenseDeclareeRacine(rootId)).toEqual({
      micros: 250_000,
      tentatives: 2,
      sansCout: 1,
    });
  });

  it('une dépense déclarée qui atteint l’enveloppe ferme la racine à tout nouvel enfant', () => {
    expect(store.createDelegatedTask(demande(rootId, 'child')).ok).toBe(true);
    tentative('child', LIMITES_DELEGATION_DEFAUT.maxCostMicros / 1_000_000);
    const refus = store.createDelegatedTask({ ...demande(rootId, 'late'), costMicros: 0 });
    expect(refus).toMatchObject({ ok: false, code: 'cout' });
    expect(refus.ok ? '' : refus.motif).toContain('budget coût de la racine épuisé');
    expect(store.getTask('late')).toBeUndefined();
  });

  it('la dépense part avec l’arbre entier, la consigne avec sa tâche', () => {
    expect(store.createDelegatedTask(demande(rootId, 'child'), undefined, 0).ok).toBe(true);
    tentative('child', 0.5);
    store.poserConsigneRoutage('child', { sansAgents: ['codex'] }, null, 0);
    store.patchTask(rootId, { status: 'done' }, 0);
    store.patchTask('child', { status: 'done' }, 0);
    expect(store.pruneTasks(100, 1_000)).toBe(2);
    expect(store.depenseDeclareeRacine(rootId).tentatives).toBe(0);
    expect(store.consigneRoutage('child')).toBeNull();
  });

  it('compte, sur chaque nœud, les parents qui attendent un enfant délégué en vol', () => {
    const noeud = store.registerNode({
      name: 'n',
      ownerName: 't',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    store.setNodeStatus(noeud.id, 'online');
    store.patchTask(rootId, { status: 'running', assignedNodeId: noeud.id });
    expect(store.listNodes()[0]).toMatchObject({ running: 1 });
    expect(store.listNodes()[0]).not.toHaveProperty('enAttente');
    expect(store.createDelegatedTask(demande(rootId, 'child')).ok).toBe(true);
    expect(store.listNodes()[0]).toMatchObject({ running: 1, enAttente: 1 });
    // L'enfant rendu, le parent reprend son travail : sa place avec.
    store.patchTask('child', { status: 'done' });
    expect(store.listNodes()[0]).not.toHaveProperty('enAttente');
  });

  it('relit la consigne de routage telle qu’elle a été posée, et l’oublie levée', () => {
    store.poserConsigneRoutage(rootId, { agent: 'codex', sansModeles: ['m1'] }, 'u1', 42);
    expect(store.consigneRoutage(rootId)).toEqual({
      consigne: { agent: 'codex', sansModeles: ['m1'] },
      definiPar: 'u1',
      majA: 42,
    });
    store.poserConsigneRoutage(rootId, null, 'u1', 43);
    expect(store.consigneRoutage(rootId)).toBeNull();
  });
});
