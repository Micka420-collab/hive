import { describe, expect, it } from 'vitest';
import type { HiveNode } from '../src/shared/types.js';
import { projeterWorkers } from '../src/orchestrator/workers.js';

const node = (patch: Partial<HiveNode> = {}): HiveNode => ({
  id: 'node-1',
  name: 'poste-1',
  ownerName: 'micka',
  agentType: 'claude-code',
  maxConcurrency: 2,
  running: 0,
  status: 'online',
  lastSeen: 1,
  ...patch,
});

describe('projection Worker', () => {
  it('reflète la charge et garde les modèles inconnus en exploration', () => {
    const modeles = ['zeta', 'alpha'];
    const worker = projeterWorkers(
      [node({ running: 3, modeles })],
      [
        {
          title: 'Implémenter endpoint',
          prompt: 'ajouter la route',
          modele: 'alpha',
          suite: 'appliquer',
        },
      ],
    )[0]!;

    expect(modeles).toEqual(['zeta', 'alpha']);
    expect(worker).toMatchObject({
      id: 'node-1',
      slotsLibres: 0,
      modeles: [{ modele: 'alpha' }, { modele: 'zeta' }],
    });
    expect(worker.modeles?.[0]?.categories.code).toMatchObject({
      essais: 1,
      moyenne: 1,
      exploration: false,
    });
    expect(worker.modeles?.[1]?.categories.code).toEqual({
      essais: 0,
      moyenne: null,
      score: null,
      exploration: true,
    });
  });

  it('n’invente pas de modèles quand le nœud ne les déclare pas', () => {
    const worker = projeterWorkers([node()], [])[0]!;

    expect(worker).not.toHaveProperty('modeles');
    expect(worker.outils).toBeUndefined();
  });

  it('transporte l’identité humaine persistée sans remplacer le nom technique', () => {
    const worker = projeterWorkers(
      [node({ name: 'poste-technique' })],
      [],
      [],
      new Map([
        [
          'node-1',
          {
            bapteme: { nom: 'Capucine', baptiseA: 100 },
            metier: { metier: 'edite', assigneA: 101 },
          },
        ],
      ]),
    )[0]!;

    expect(worker).toMatchObject({
      name: 'poste-technique',
      identite: {
        bapteme: { nom: 'Capucine', baptiseA: 100 },
        metier: { metier: 'edite', assigneA: 101 },
      },
    });
  });

  it('sépare la réputation exacte du Worker du vécu global', () => {
    const lignes = [
      {
        title: 'Implémenter endpoint',
        prompt: 'ajouter la route',
        modele: 'alpha',
        modeleExact: 'alpha',
        suite: 'appliquer' as const,
        nodeId: 'node-1',
      },
      {
        title: 'Corriger endpoint',
        prompt: 'réparer la route',
        modele: 'alpha',
        modeleExact: 'alpha',
        suite: 'ameliorer' as const,
        nodeId: 'node-1',
      },
      {
        title: 'Corriger endpoint',
        prompt: 'réparer la route',
        modele: 'alpha',
        modeleExact: 'alpha',
        suite: 'refaire' as const,
        nodeId: 'node-2',
      },
    ];
    const workers = projeterWorkers(
      [node({ id: 'node-1', modeles: ['alpha'] }), node({ id: 'node-2', modeles: ['alpha'] })],
      lignes,
    );

    expect(workers[0]?.reputation).toMatchObject({
      essais: 2,
      appliquer: 1,
      ameliorer: 1,
      refaire: 0,
      attribution: 'exacte',
    });
    expect(workers[0]?.modeles?.[0]?.reputation).toMatchObject({
      essais: 2,
      moyenne: 0.75,
      attribution: 'exacte',
    });
    expect(workers[1]?.reputation).toMatchObject({
      essais: 1,
      refaire: 1,
      moyenne: 0,
      attribution: 'exacte',
    });
  });

  it('expose uniquement le travail actif attribué à chaque Worker', () => {
    const activeTasks = [
      {
        id: 'task-running',
        title: 'Corriger la session',
        status: 'running' as const,
        assignedNodeId: 'node-1',
        attempts: 2,
        branch: 'hive/task-running',
        updatedAt: 42,
      },
      {
        id: 'task-done',
        title: 'Ancienne tâche',
        status: 'done' as const,
        assignedNodeId: 'node-1',
        attempts: 1,
        branch: 'hive/task-done',
        updatedAt: 41,
      },
      {
        id: 'task-other-worker',
        title: 'Travail voisin',
        status: 'assigned' as const,
        assignedNodeId: 'node-2',
        attempts: 1,
        branch: null,
        updatedAt: 40,
      },
    ];

    const workers = projeterWorkers([node()], [], activeTasks);

    expect(workers[0]?.currentTasks).toEqual([
      {
        id: 'task-running',
        title: 'Corriger la session',
        status: 'running',
        attempts: 2,
        branch: 'hive/task-running',
        updatedAt: 42,
      },
    ]);
  });
});
