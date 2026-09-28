import { describe, expect, it } from 'vitest';
import { executionUsageDepuis } from '../src/node-client/execution-usage.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { fenetreSeule } from './aide/journal-retenu.js';

const usage = {
  userCpuMicros: 1_200,
  systemCpuMicros: 300,
  maxRssBytes: 8 * 1024 * 1024,
  rssBytes: 6 * 1024 * 1024,
  heapUsedBytes: 3 * 1024 * 1024,
};

describe('mesure de ressources Worker', () => {
  it('calcule les deltas CPU et conserve les pics mémoire observés', () => {
    expect(
      executionUsageDepuis(
        {
          userCpuMicros: 100,
          systemCpuMicros: 50,
          maxRssBytes: 4 * 1024 * 1024,
          rssBytes: 3 * 1024 * 1024,
          heapUsedBytes: 2 * 1024 * 1024,
        },
        {
          ...usage,
          userCpuMicros: 1_100,
          systemCpuMicros: 250,
        },
      ),
    ).toEqual({ ...usage, userCpuMicros: 1_000, systemCpuMicros: 200 });
  });

  it('ne laisse pas un compteur en retard produire un delta négatif', () => {
    expect(
      executionUsageDepuis(
        { ...usage, userCpuMicros: 2_000, systemCpuMicros: 2_000 },
        { ...usage, userCpuMicros: 1_000, systemCpuMicros: 1_000 },
      ),
    ).toMatchObject({ userCpuMicros: 0, systemCpuMicros: 0 });
  });
});

describe('persistance de la mesure reliée au résultat', () => {
  it('relit la mesure depuis le journal sans modifier le schéma results', () => {
    const store = new HiveStore(':memory:');
    try {
      // Une vraie tâche : la mesure est une preuve que la rétention du journal
      // garde AVEC sa tâche — un résultat d'une tâche inconnue n'en a pas.
      const projet = store.createProject({ name: 'P' });
      store.createTask({ id: 'task-usage', projectId: projet.id, title: 'Mesurer', prompt: 'p' });
      const resultId = store.insertResult({
        taskId: 'task-usage',
        nodeId: 'worker-usage',
        success: true,
        diff: '',
        logs: '',
        durationMs: 42,
        subAgents: [],
        usage,
      });

      expect(store.resultsForTask('task-usage')[0]).toMatchObject({ resultId, usage });
      expect(store.listEvents().some((event) => event.type === 'worker_usage')).toBe(true);

      store.appendEvent('after_usage', { taskId: 'other' });
      store.pruneEvents(fenetreSeule(1));
      expect(store.resultsForTask('task-usage')[0]?.usage).toEqual(usage);
    } finally {
      store.close();
    }
  });
});
