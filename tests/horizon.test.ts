// Horizon — faits ≠ hypothèses, carnet borné (ADR 0010 lot 9).

import { describe, expect, it } from 'vitest';
import {
  HORIZON_LECTURE_MAX,
  VERSION_HORIZON,
  doitNoterFaitDeriveASurveiller,
  doitNoterFaitDeriveDegradee,
  horizonDepasseBudgetTaches,
  resumeHorizon,
  texteFaitDeriveASurveiller,
  texteFaitDeriveDegradee,
  validerKindHorizon,
} from '../src/orchestrator/horizon.js';
import type { EntreeHorizon } from '../src/orchestrator/horizon.js';
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

  it('anti-spam fait dérive à surveiller', () => {
    expect(texteFaitDeriveASurveiller('hausse lente')).toMatch(
      /^Dérive à surveiller — hausse lente$/,
    );
    const now = 2_000_000;
    expect(doitNoterFaitDeriveASurveiller([], now)).toBe(true);
    expect(
      doitNoterFaitDeriveASurveiller(
        [
          {
            id: '1',
            projectId: 'p',
            kind: 'fait',
            texte: 'Dérive à surveiller — x',
            source: 'derive',
            creeA: now - 1000,
          },
        ],
        now,
      ),
    ).toBe(false);
  });

  // ─── LES DEUX CAS QUE NI L'UN NI L'AUTRE DE CES BANCS N'ÉPROUVAIT ──────────
  //
  // La loupe a rendu NUE la ligne
  //
  //     e.texte.startsWith(PREFIXE_FAIT_DERIVE_SURVEILLER) &&
  //
  // Mué en `||`, `A && B && C && D` devient `(A && B && C) || D` : le refus
  // ne dépend plus alors QUE de la fraîcheur. N'importe quelle entrée récente
  // — un autre niveau de dérive, une hypothèse, une entrée d'une autre source —
  // fait croire au garde-fou qu'un fait a déjà été noté.
  //
  // Ce que ça coûte : la ruche CESSE SILENCIEUSEMENT d'inscrire les faits
  // « dérive à surveiller » dès qu'une entrée récente quelconque traîne dans
  // l'horizon. Rien ne casse, rien ne lève — un signal disparaît, et c'est
  // précisément le signal qui sert à décider avant que la dérive ne dégrade.
  //
  // Le banc « à surveiller » avait été copié de son jumeau EN PERDANT une
  // assertion : le cas de l'entrée vieille. Et aucun des deux n'éprouvait le
  // cas de l'entrée récente SANS RAPPORT. Les deux manques sont fermés ici,
  // pour les deux fonctions — le jumeau porte la même forme, donc le même
  // risque.
  const entree = (o: Partial<EntreeHorizon> = {}): EntreeHorizon =>
    ({
      id: '1',
      projectId: 'p',
      kind: 'fait',
      texte: 'Dérive à surveiller — x',
      source: 'derive',
      creeA: 0,
      ...o,
    }) as EntreeHorizon;

  it('la fenêtre est une FENÊTRE — une entrée vieille ne bâillonne plus', () => {
    const now = 2_000_000;
    const vieille = entree({ creeA: now - 7 * 60 * 60 * 1000 });
    expect(doitNoterFaitDeriveASurveiller([vieille], now)).toBe(true);
  });

  it('le filtre FILTRE — une entrée récente SANS RAPPORT ne bâillonne pas', () => {
    const now = 2_000_000;
    const recent = { creeA: now - 1000 };
    // Même fraîcheur, mais aucune des trois autres conditions n'est remplie.
    // Sous le mutant, chacune de ces entrées suffirait à faire taire le fait.
    expect(
      doitNoterFaitDeriveASurveiller([entree({ ...recent, kind: 'hypothese' })], now),
      'une hypothèse récente n’est pas un fait de dérive',
    ).toBe(true);
    expect(
      doitNoterFaitDeriveASurveiller([entree({ ...recent, source: 'humain' })], now),
      'un fait récent d’une AUTRE source ne compte pas',
    ).toBe(true);
    expect(
      doitNoterFaitDeriveASurveiller([entree({ ...recent, texte: 'Dérive dégradée — x' })], now),
      'l’autre NIVEAU de dérive a son propre anti-spam',
    ).toBe(true);
  });

  it('la jumelle « dégradée » tient les mêmes bords', () => {
    const now = 2_000_000;
    const recent = { creeA: now - 1000, texte: 'Dérive dégradée — x' };
    expect(doitNoterFaitDeriveDegradee([entree({ ...recent, kind: 'hypothese' })], now)).toBe(true);
    expect(doitNoterFaitDeriveDegradee([entree({ ...recent, source: 'humain' })], now)).toBe(true);
    expect(
      doitNoterFaitDeriveDegradee([entree({ ...recent, texte: 'Dérive à surveiller — x' })], now),
      'les deux niveaux ne se bâillonnent pas l’un l’autre',
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
