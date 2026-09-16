import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HiveStore, type CreationDeleguee } from '../src/orchestrator/store.js';
import {
  LIMITES_DELEGATION_DEFAUT,
  type DemandeDelegation,
} from '../src/orchestrator/delegation.js';

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
});
