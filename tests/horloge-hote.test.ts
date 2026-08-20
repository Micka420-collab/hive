import { describe, expect, it } from 'vitest';
import {
  depenseHote,
  dureeMs,
  fermerSession,
  jugerFacture,
  ouvrirSession,
} from '../src/orchestrator/horloge-hote.js';
import type { SessionHote } from '../src/orchestrator/horloge-hote.js';

const T0 = 1_000_000;

function sess(p: Partial<SessionHote> = {}): SessionHote {
  return { id: 1, projectId: 'p', taskId: 't', startedAt: T0, stoppedAt: null, ...p };
}

describe('horloge de l’hébergeur — jamais durationMs', () => {
  it('une session ouverte compte jusqu’à now, pas un chiffre d’agent', () => {
    expect(dureeMs({ id: 0, ...ouvrirSession('p', 't', T0) }, T0 + 5_000)).toBe(5_000);
  });

  it('fermer avant le départ refuse plutôt que d’inventer une durée négative', () => {
    expect(fermerSession(sess(), T0 - 1)).toBeNull();
  });

  it('fermer deux fois est sans effet', () => {
    const close = fermerSession(sess(), T0 + 10);
    expect(close?.stoppedAt).toBe(T0 + 10);
    expect(fermerSession(close!, T0 + 20)).toBeNull();
  });

  it('la somme ignore une durée d’agent inventée : seules nos bornes comptent', () => {
    const a = { ...sess({ id: 1, taskId: 'a' }), stoppedAt: T0 + 1_000 };
    const b = sess({ id: 2, taskId: 'b', startedAt: T0 });
    expect(depenseHote([a, b], T0 + 4_000)).toBe(5_000);
  });

  it('le plafond se juge sur CETTE dépense', () => {
    expect(jugerFacture(80, 100)).toBe('alerte');
    expect(jugerFacture(100, 100)).toBe('bloque');
    expect(jugerFacture(10, null)).toBe('passe');
  });
});

describe('horloge — le magasin additionne, l’agent n’écrit rien', () => {
  it('ouvrir puis fermer crédite le solde, pas durationMs', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { HiveStore } = await import('../src/orchestrator/store.js');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-horloge-'));
    const store = new HiveStore(path.join(dir, 'h.db'));
    store.ouvrirHorlogeHote('p1', 't1', T0);
    expect(store.depenseHorlogeHote('p1', T0 + 2_000)).toBe(2_000);
    expect(store.fermerHorlogeHote('t1', T0 + 3_000)).toBe(true);
    expect(store.depenseHorlogeHote('p1', T0 + 9_000)).toBe(3_000);
    expect(store.fermerHorlogeHote('t1', T0 + 4_000)).toBe(false);
    store.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });
});
