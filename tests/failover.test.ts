// Tests du token-failover (Palier 3, résilience cœur) : un échec d'infrastructure
// (agent injoignable/non authentifié, quota) ne perd pas la tâche — elle est
// réaffectée à un autre nœud ; si aucun nœud n'a d'agent fonctionnel, elle finit
// par échouer proprement. Un refus de simple saturation ne compte pas.

import { describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import { Scheduler } from '../src/orchestrator/scheduler.js';
import { runCommand } from '../src/adapters/exec.js';
import type { HiveEvent } from '../src/shared/types.js';
import type { NodeProfile } from '../src/orchestrator/store.js';
import type { AdapterContext } from '../src/adapters/index.js';

const profile = (name: string, cap = 1): NodeProfile => ({
  name,
  ownerName: 'o',
  agentType: 'shell',
  maxConcurrency: cap,
});

describe('token-failover (scheduler)', () => {
  it('réaffecte à un autre nœud sur refus infra, sans brûler de tentative', () => {
    const store = new HiveStore(':memory:');
    try {
      const scheduler = new Scheduler(store);
      scheduler.registerNode(profile('n1'));
      scheduler.registerNode(profile('n2'));
      const p = store.createProject({ name: 'P' });
      store.createTask({ id: 't1', projectId: p.id, title: 'T', prompt: 'p' });

      scheduler.tick();
      const firstNode = store.getTask('t1')?.assignedNodeId;
      expect(firstNode).toBeTruthy();

      // L'agent du 1er nœud est en panne (auth/quota) → refus infra.
      scheduler.rejectTask(firstNode as string, 't1', 'agent indisponible', true);

      const t = store.getTask('t1');
      expect(t?.status).toBe('assigned'); // pas perdue, pas failed
      expect(t?.assignedNodeId).not.toBe(firstNode); // reprise par l'AUTRE nœud
      expect(t?.attempts).toBe(0); // aucune tentative consommée
    } finally {
      store.close();
    }
  });

  it('échoue proprement si aucun nœud n’a d’agent fonctionnel', () => {
    const store = new HiveStore(':memory:');
    const events: HiveEvent[] = [];
    try {
      const scheduler = new Scheduler(store, { onEvent: (e) => events.push(e) });
      let now = 1000;
      const n1 = scheduler.registerNode(profile('n1'), now);
      const p = store.createProject({ name: 'P' });
      store.createTask({ id: 't1', projectId: p.id, title: 'T', prompt: 'p' });

      // 1 nœud, limite = max(3, 1×3) = 3 refus infra avant échec.
      for (let i = 0; i < 3; i++) {
        scheduler.tick(now); // (ré)assigne t1 à n1 (cooldown passé)
        scheduler.rejectTask(n1.id, 't1', 'agent indisponible', true, now);
        now += 4000; // dépasse le cooldown de refus (3 s)
      }

      const t = store.getTask('t1');
      expect(t?.status).toBe('failed');
      expect(t?.attempts).toBe(0); // échec « infra », pas des tentatives d'exécution
      expect(
        events.some((e) => e.type === 'task_failed' && e.payload.reason === 'no_working_agent'),
      ).toBe(true);
    } finally {
      store.close();
    }
  });

  it('un refus de saturation (non-infra) ne compte pas vers l’échec', () => {
    const store = new HiveStore(':memory:');
    try {
      const scheduler = new Scheduler(store);
      const n1 = scheduler.registerNode(profile('n1'));
      const p = store.createProject({ name: 'P' });
      store.createTask({ id: 't1', projectId: p.id, title: 'T', prompt: 'p' });
      scheduler.tick();
      // Refus « saturation » répété → jamais failed (le nœud finira par se libérer).
      for (let i = 0; i < 5; i++) scheduler.rejectTask(n1.id, 't1', 'noeud_sature', false);
      expect(store.getTask('t1')?.status).not.toBe('failed');
    } finally {
      store.close();
    }
  });
});

describe('détection d’échec infra (exec)', () => {
  const ctx = (): AdapterContext => ({
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    attempt: 1,
    signal: new AbortController().signal,
    onProgress: () => {},
  });

  it('infra=true si le binaire est introuvable', async () => {
    const r = await runCommand('hive-binaire-inexistant-xyz', [], ctx());
    expect(r.success).toBe(false);
    expect(r.infra).toBe(true);
  });

  it('infra=true si la sortie évoque un problème d’auth/quota', async () => {
    const r = await runCommand(
      'node',
      ['-e', "console.error('Error: 401 Unauthorized'); process.exit(1)"],
      ctx(),
    );
    expect(r.success).toBe(false);
    expect(r.infra).toBe(true);
  });

  it('infra absent pour un échec de tâche ordinaire', async () => {
    const r = await runCommand('node', ['-e', 'process.exit(2)'], ctx());
    expect(r.success).toBe(false);
    expect(r.infra).toBeUndefined();
  });
});
