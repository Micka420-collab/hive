// Fabrique — pas de chantier avant merge + script déclaré (ADR 0010 lot 8).

import { describe, expect, it } from 'vitest';
import {
  VERSION_FABRIQUE,
  jugerFabriqueAvantChantier,
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

  it('prompt sans secret', () => {
    expect(promptFabrique({ genre: 'script_npm', libelle: 'X', nomScript: 'x' })).toMatch(
      /APRÈS merge/,
    );
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
