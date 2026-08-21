// Fabrique — pas de chantier avant merge + script déclaré (ADR 0010 lot 8).

import { describe, expect, it } from 'vitest';
import {
  VERSION_FABRIQUE,
  jugerFabriqueAvantChantier,
  marquerFabriquesMergeesApresFusion,
  promptFabrique,
  validerGenreFabrique,
} from '../src/orchestrator/fabrique.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('fabrique — jugement chantier', () => {
  it('version + genres', () => {
    expect(VERSION_FABRIQUE).toBe(1);
    expect(validerGenreFabrique('mcp')).toEqual({ ok: true, genre: 'mcp' });
    expect(validerGenreFabrique('seedance')).toEqual({ ok: false, motif: 'genre_inconnu' });
  });

  it('refuse avant merge et si non déclaré', () => {
    expect(
      jugerFabriqueAvantChantier({
        nomScript: 'outil:3d',
        scriptsMiroir: { 'outil:3d': 'node scripts/x.js' },
        mergeLanded: false,
      }),
    ).toEqual({ ok: false, motif: 'pas_encore_merge' });
    expect(
      jugerFabriqueAvantChantier({
        nomScript: 'outil:3d',
        scriptsMiroir: { test: 'vitest' },
        mergeLanded: true,
      }),
    ).toEqual({ ok: false, motif: 'non_declare' });
  });

  it('accepte seulement merge landé + déclaré', () => {
    expect(
      jugerFabriqueAvantChantier({
        nomScript: 'outil:3d',
        scriptsMiroir: { 'outil:3d': 'node x.js' },
        mergeLanded: true,
      }),
    ).toEqual({ ok: true });
  });

  it('fabrique ouverte bloque le chantier ; mergee ou absente laisse passer', async () => {
    const { fabriqueBloqueChantier } = await import('../src/orchestrator/fabrique.js');
    expect(
      fabriqueBloqueChantier([{ nomScript: 'outil:3d', statut: 'proposee' }], 'outil:3d'),
    ).toEqual({ ok: false, motif: 'pas_encore_merge' });
    expect(
      fabriqueBloqueChantier([{ nomScript: 'outil:3d', statut: 'en_revue' }], 'outil:3d'),
    ).toEqual({ ok: false, motif: 'pas_encore_merge' });
    expect(
      fabriqueBloqueChantier([{ nomScript: 'outil:3d', statut: 'mergee' }], 'outil:3d'),
    ).toEqual({ ok: true, mergeLanded: true });
    expect(fabriqueBloqueChantier([], 'outil:3d')).toEqual({ ok: true, mergeLanded: true });
  });

  it('prompt sans secret', () => {
    expect(promptFabrique({ genre: 'script_npm', libelle: 'X', nomScript: 'x' })).toMatch(
      /APRÈS merge/,
    );
  });

  it('libellés genre et statut FR/EN', async () => {
    const { libelleGenreFabrique, libelleStatutFabrique } =
      await import('../src/orchestrator/fabrique.js');
    expect(libelleGenreFabrique('script_npm', 'fr')).toMatch(/npm/i);
    expect(libelleStatutFabrique('mergee', 'fr')).toBe('mergée');
    expect(libelleStatutFabrique('en_revue', 'en')).toBe('in review');
  });

  it('marquerFabriquesMergeesApresFusion lie taskId et orphelines', () => {
    const store = new HiveStore(':memory:');
    const p = store.createProject({ name: 'P' });
    const liee = store.ouvrirFabrique(p.id, 'script_npm', 'A', {
      nomScript: 'a',
      taskId: 't-1',
    });
    const orpheline = store.ouvrirFabrique(p.id, 'script_npm', 'B', { nomScript: 'b' });
    const autre = store.ouvrirFabrique(p.id, 'script_npm', 'C', {
      nomScript: 'c',
      taskId: 't-2',
    });
    expect(liee.ok && orpheline.ok && autre.ok).toBe(true);
    if (!liee.ok || !orpheline.ok || !autre.ok) return;
    expect(marquerFabriquesMergeesApresFusion(store, p.id, 't-1')).toBe(2);
    expect(store.listerFabriques(p.id).find((f) => f.id === liee.id)?.statut).toBe('mergee');
    expect(store.listerFabriques(p.id).find((f) => f.id === orpheline.id)?.statut).toBe('mergee');
    expect(store.listerFabriques(p.id).find((f) => f.id === autre.id)?.statut).toBe('proposee');
  });
});

describe('HiveStore — fabriques', () => {
  it('ouvre et passe à mergee', () => {
    const store = new HiveStore(':memory:');
    const p = store.createProject({ name: 'P' });
    const o = store.ouvrirFabrique(p.id, 'script_npm', 'Outillage', { nomScript: 'outil:x' });
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(store.listerFabriques(p.id)).toHaveLength(1);
    expect(store.poserStatutFabrique(o.id, 'mergee')).toEqual({ ok: true });
    expect(store.poserStatutFabrique(o.id, 'refusee')).toEqual({
      ok: false,
      motif: 'deja_close',
    });
  });
});
