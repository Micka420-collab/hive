// Motifs perso — procédures créées depuis la Chambre (ADR 0010 lot 10).

import { describe, expect, it } from 'vitest';
import { validerMotifPerso } from '../src/orchestrator/motifs.js';
import { HiveStore } from '../src/orchestrator/store.js';

describe('motifs perso — forme', () => {
  it('valide libellé et étapes', () => {
    expect(validerMotifPerso('Mon flux', ['A', 'B'])).toMatchObject({
      ok: true,
      etapes: ['A', 'B'],
    });
    expect(validerMotifPerso('', ['x'])).toEqual({ ok: false, motif: 'vide' });
    expect(validerMotifPerso('x', [])).toEqual({ ok: false, motif: 'vide' });
  });
});

describe('HiveStore — motifs perso', () => {
  it('crée, liste et lit', () => {
    const store = new HiveStore(':memory:');
    const p = store.createProject({ name: 'P' });
    const c = store.creerMotifProjet(p.id, 'Procédure test', ['Étape 1', 'Étape 2']);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const rows = store.listerMotifsProjet(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.etapes).toEqual(['Étape 1', 'Étape 2']);
    expect(store.lireMotifProjet(c.id)?.libelle).toBe('Procédure test');
  });
});
