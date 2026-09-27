import { describe, expect, it } from 'vitest';
import type { HiveNode } from '../src/shared/types.js';
import { projeterHistoriqueWorker, projeterWorkers } from '../src/orchestrator/workers.js';
import { CATEGORIES, antecedentsDuVecu, classer } from '../src/orchestrator/aiguillage.js';

/** Une ruche sans aucun vécu d'Aiguillage : ni verdict, ni élection en vol. */
const SANS_VECU = { verdicts: [], enVol: [] };

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
    const worker = projeterWorkers([node({ running: 3, modeles })], {
      verdicts: [
        {
          title: 'Implémenter endpoint',
          prompt: 'ajouter la route',
          modele: 'alpha',
          suite: 'appliquer',
        },
      ],
      enVol: [],
    })[0]!;

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
      enVol: 0,
      moyenne: null,
      score: null,
      exploration: true,
    });
  });

  it('CLASSE LES MODÈLES D’UN WORKER ENSEMBLE — chaque case est la ligne de `classer`', () => {
    // Classé SEUL, chaque modèle recevait le bonus d'exploration d'un genre où
    // il n'aurait aucun rival : un score que l'Aiguillage ne calcule jamais.
    // Ici alpha et zeta ont chacun deux verdicts « code » : le total du genre
    // est 4, pas 2.
    const tache = { title: 'Implémenter endpoint', prompt: 'ajouter la route' };
    const vecu = {
      verdicts: [
        { ...tache, modele: 'alpha', modeleExact: 'alpha', suite: 'appliquer' as const },
        { ...tache, modele: 'alpha', modeleExact: 'alpha', suite: 'appliquer' as const },
        { ...tache, modele: 'zeta', modeleExact: 'zeta', suite: 'refaire' as const },
        { ...tache, modele: 'zeta', modeleExact: 'zeta', suite: 'refaire' as const },
      ],
      enVol: [],
    };
    const [worker] = projeterWorkers([node({ modeles: ['zeta', 'alpha'] })], vecu);
    const antecedents = antecedentsDuVecu(vecu.verdicts, vecu.enVol);

    for (const categorie of CATEGORIES) {
      for (const rang of classer(categorie, ['alpha', 'zeta'], antecedents)) {
        const vue = worker?.modeles?.find((m) => m.modele === rang.modele)?.categories[categorie];
        expect(vue?.essais, `${rang.modele}/${categorie}`).toBe(rang.essais);
        expect(vue?.score, `${rang.modele}/${categorie}`).toBe(
          Number.isFinite(rang.score) ? rang.score : null,
        );
      }
    }
    expect(worker?.modeles?.[0]?.categories.code.score).toBeCloseTo(
      1 + Math.SQRT2 * Math.sqrt(Math.log(4) / 2),
      10,
    );
  });

  it('UN MODÈLE EN VOL SANS VERDICT RESTE À EXPLORER — avec le score fini sur lequel le routing décide', () => {
    const [worker] = projeterWorkers([node({ modeles: ['alpha'] })], {
      verdicts: [],
      enVol: [{ title: 'Implémenter endpoint', prompt: 'ajouter la route', modele: 'alpha' }],
    });

    expect(worker?.modeles?.[0]?.categories.code).toEqual({
      essais: 0,
      enVol: 1,
      moyenne: null,
      score: 0,
      exploration: true,
    });
  });

  it('n’invente pas de modèles quand le nœud ne les déclare pas', () => {
    const worker = projeterWorkers([node()], SANS_VECU)[0]!;

    expect(worker).not.toHaveProperty('modeles');
    expect(worker.outils).toBeUndefined();
  });

  it('expose les limites de délégation canoniques sans permettre au Worker de les relever', () => {
    const worker = projeterWorkers([node()], SANS_VECU)[0]!;

    expect(worker.autonomie).toEqual({
      delegation: {
        maxDepth: 3,
        maxChildrenPerParent: 4,
        maxDescendantsPerRoot: 16,
        maxDurationMs: 30 * 60_000,
        maxCostMicros: 5_000_000,
        maxResourceUnits: 4,
        maxTitleChars: 160,
        maxPromptChars: 16_000,
      },
    });
  });

  it('transporte l’identité humaine persistée sans remplacer le nom technique', () => {
    const worker = projeterWorkers(
      [node({ name: 'poste-technique' })],
      SANS_VECU,
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

  it('borne l’historique Worker et retire les champs libres du journal', () => {
    const events = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1,
      ts: index + 1,
      type: 'task_done',
      payload: {
        taskId: `task-${index}`,
        title: `Tâche ${index}`,
        logs: 'Bearer secret-a-ne-pas-exposer',
        prompt: 'prompt privé',
      },
    }));

    const historique = projeterHistoriqueWorker(events);

    expect(historique).toHaveLength(5);
    expect(historique[0]).toMatchObject({ id: 1, taskId: 'task-0', title: 'Tâche 0' });
    expect(historique[0]).not.toHaveProperty('logs');
    expect(historique[0]).not.toHaveProperty('prompt');
    expect(historique.at(-1)?.id).toBe(5);
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
      { verdicts: lignes, enVol: [] },
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

  it('DÉCLINE LA RÉPUTATION DU WORKER PAR CATÉGORIE — une catégorie jamais jugée reste inconnue', () => {
    // Un Worker peut exceller sur le code et n'avoir jamais été jugé en
    // documentation : la seconde doit être ABSENTE, pas notée 0.
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
    const [un, deux, trois] = projeterWorkers(
      [node({ id: 'node-1' }), node({ id: 'node-2' }), node({ id: 'node-3' })],
      { verdicts: lignes, enVol: [] },
    );

    expect(Object.keys(un?.reputationParCategorie ?? {}).sort()).toEqual(['code', 'correction']);
    expect(un?.reputationParCategorie.code).toMatchObject({ essais: 1, moyenne: 1 });
    expect(un?.reputationParCategorie.correction).toMatchObject({ essais: 1, moyenne: 0.5 });
    expect(un?.reputationParCategorie.documentation, 'jamais jugé : inconnu').toBeUndefined();
    // Le verdict de node-2 ne se mélange pas à celui de node-1.
    expect(deux?.reputationParCategorie).toEqual({
      correction: expect.objectContaining({ essais: 1, refaire: 1, moyenne: 0 }),
    });
    expect(trois?.reputationParCategorie, 'un Worker jamais jugé n’a aucune catégorie').toEqual({});
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

    const workers = projeterWorkers([node()], SANS_VECU, activeTasks);

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
