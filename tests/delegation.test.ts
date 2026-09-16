import { describe, expect, it } from 'vitest';
import {
  jugerDelegation,
  LIMITES_DELEGATION_DEFAUT,
  type DemandeDelegation,
  type NoeudDelegation,
} from '../src/orchestrator/delegation.js';

const root = (patch: Partial<NoeudDelegation> = {}): NoeudDelegation => ({
  taskId: 'root',
  rootTaskId: 'root',
  parentTaskId: null,
  depth: 0,
  status: 'running',
  origine: 'hive',
  ...patch,
});

const demande = (patch: Partial<DemandeDelegation> = {}): DemandeDelegation => ({
  childTaskId: 'child',
  parentTaskId: 'root',
  title: 'Tester le runtime',
  prompt: 'Exécute les tests ciblés et rapporte les preuves.',
  durationMs: 60_000,
  costMicros: 100_000,
  resourceUnits: 1,
  ...patch,
});

describe('délégation Hive bornée', () => {
  it('produit un lien racine/parent/enfant sans choisir le modèle', () => {
    const verdict = jugerDelegation(
      demande({ preferredAgent: 'codex', preferredModel: 'modele-neuf' }),
      [root()],
    );
    expect(verdict).toEqual({
      ok: true,
      plan: expect.objectContaining({
        childTaskId: 'child',
        parentTaskId: 'root',
        rootTaskId: 'root',
        depth: 1,
        preferredAgent: 'codex',
        preferredModel: 'modele-neuf',
      }),
    });
  });

  it.each([
    ['done', 'parent_termine'],
    ['failed', 'parent_termine'],
  ] as const)('refuse un parent %s', (status, code) => {
    expect(jugerDelegation(demande(), [root({ status })])).toMatchObject({ ok: false, code });
  });

  it('refuse un parent absent et un identifiant dupliqué', () => {
    expect(jugerDelegation(demande(), [])).toMatchObject({ ok: false, code: 'parent_absent' });
    expect(jugerDelegation(demande(), [root(), root({ taskId: 'child' })])).toMatchObject({
      ok: false,
      code: 'task_id_duplique',
    });
  });

  it('borne profondeur, enfants Hive et descendants Hive', () => {
    const profond = root({ taskId: 'p', depth: LIMITES_DELEGATION_DEFAUT.maxDepth });
    expect(jugerDelegation(demande({ parentTaskId: 'p' }), [profond])).toMatchObject({
      ok: false,
      code: 'profondeur',
    });

    const enfants = Array.from({ length: LIMITES_DELEGATION_DEFAUT.maxChildrenPerParent }, (_, i) =>
      root({ taskId: `c${i}`, parentTaskId: 'root', depth: 1 }),
    );
    expect(jugerDelegation(demande(), [root(), ...enfants])).toMatchObject({
      ok: false,
      code: 'enfants',
    });

    const descendants = Array.from(
      { length: LIMITES_DELEGATION_DEFAUT.maxDescendantsPerRoot },
      (_, i) => root({ taskId: `d${i}`, parentTaskId: `p${i}`, depth: 2 }),
    );
    expect(jugerDelegation(demande(), [root(), ...descendants])).toMatchObject({
      ok: false,
      code: 'descendants',
    });
  });

  it('garde les sous-agents natifs distincts des enfants orchestrés', () => {
    const natifs = Array.from({ length: 20 }, (_, i) =>
      root({ taskId: `native${i}`, parentTaskId: 'root', depth: 1, origine: 'native' }),
    );
    expect(jugerDelegation(demande(), [root(), ...natifs])).toMatchObject({ ok: true });
  });

  it.each([
    [{ durationMs: LIMITES_DELEGATION_DEFAUT.maxDurationMs + 1 }, 'duree'],
    [{ costMicros: LIMITES_DELEGATION_DEFAUT.maxCostMicros + 1 }, 'cout'],
    [{ resourceUnits: LIMITES_DELEGATION_DEFAUT.maxResourceUnits + 1 }, 'ressources'],
    [{ durationMs: Number.NaN }, 'duree'],
    [{ costMicros: -1 }, 'cout'],
  ] as const)('refuse un budget hors borne %#', (patch, code) => {
    expect(jugerDelegation(demande(patch), [root()])).toMatchObject({ ok: false, code });
  });

  it('borne et normalise le titre et la mission', () => {
    expect(jugerDelegation(demande({ title: ' ', prompt: 'ok' }), [root()])).toMatchObject({
      ok: false,
      code: 'titre',
    });
    expect(jugerDelegation(demande({ title: 'ok', prompt: ' ' }), [root()])).toMatchObject({
      ok: false,
      code: 'prompt',
    });
    const verdict = jugerDelegation(demande({ title: '  Titre  ', prompt: '  Mission  ' }), [
      root(),
    ]);
    expect(verdict).toMatchObject({ ok: true, plan: { title: 'Titre', prompt: 'Mission' } });
  });
});
