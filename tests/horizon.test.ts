// Horizon — faits ≠ hypothèses, carnet borné (ADR 0010 lot 9).

import { describe, expect, it } from 'vitest';
import {
  HORIZON_LECTURE_MAX,
  VERSION_HORIZON,
  doitNoterFaitDeriveDegradee,
  horizonDepasseBudgetTaches,
  resumeHorizon,
  texteFaitDeriveDegradee,
  validerKindHorizon,
} from '../src/orchestrator/horizon.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { LIMITE_TACHES_INSTANTANE } from '../src/shared/types.js';

describe('horizon — forme', () => {
  it('version + kinds', () => {
    expect(VERSION_HORIZON).toBe(1);
    expect(validerKindHorizon('fait')).toEqual({ ok: true, kind: 'fait' });
    expect(validerKindHorizon('hypothese')).toEqual({ ok: true, kind: 'hypothese' });
    expect(validerKindHorizon('guess')).toEqual({ ok: false, motif: 'kind_inconnu' });
  });

  it('sépare faits et hypothèses — jamais mélangés', () => {
    const r = resumeHorizon([
      {
        id: '1',
        projectId: 'p',
        kind: 'hypothese',
        texte: 'peut-être X',
        source: 'reine',
        creeA: 2,
      },
      {
        id: '2',
        projectId: 'p',
        kind: 'fait',
        texte: 'tests verts',
        source: 'derive',
        creeA: 1,
      },
    ]);
    expect(r.faits.map((e) => e.texte)).toEqual(['tests verts']);
    expect(r.hypotheses.map((e) => e.texte)).toEqual(['peut-être X']);
    expect(r.faits.every((e) => e.kind === 'fait')).toBe(true);
  });

  it('reste loin sous le plafond d’instantané', () => {
    expect(horizonDepasseBudgetTaches(HORIZON_LECTURE_MAX, LIMITE_TACHES_INSTANTANE)).toBe(false);
    expect(horizonDepasseBudgetTaches(LIMITE_TACHES_INSTANTANE, LIMITE_TACHES_INSTANTANE)).toBe(
      true,
    );
  });

  it('anti-spam fait dérive dégradée', () => {
    expect(texteFaitDeriveDegradee('trop de hollow')).toMatch(/^Dérive dégradée — trop de hollow$/);
    const now = 1_000_000;
    expect(doitNoterFaitDeriveDegradee([], now)).toBe(true);
    expect(
      doitNoterFaitDeriveDegradee(
        [
          {
            id: '1',
            projectId: 'p',
            kind: 'fait',
            texte: 'Dérive dégradée — x',
            source: 'derive',
            creeA: now - 1000,
          },
        ],
        now,
      ),
    ).toBe(false);
    expect(
      doitNoterFaitDeriveDegradee(
        [
          {
            id: '1',
            projectId: 'p',
            kind: 'fait',
            texte: 'Dérive dégradée — x',
            source: 'derive',
            creeA: now - 7 * 60 * 60 * 1000,
          },
        ],
        now,
      ),
    ).toBe(true);
  });
});

describe('HiveStore — horizon', () => {
  it('ajoute et liste borné', () => {
    const store = new HiveStore(':memory:');
    const p = store.createProject({ name: 'H' });
    expect(store.ajouterHorizon(p.id, 'fait', 'Build vert')).toMatchObject({ ok: true });
    expect(store.ajouterHorizon(p.id, 'hypothese', 'Peut freiner')).toMatchObject({ ok: true });
    const rows = store.listerHorizon(p.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((e) => e.kind === 'fait' || e.kind === 'hypothese')).toBe(true);
  });
});
