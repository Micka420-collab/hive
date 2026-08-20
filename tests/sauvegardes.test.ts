// Sauvegardes d'étape — libellés, garde manuelle, prompt de restauration.

import { describe, expect, it } from 'vitest';
import {
  libelleEtape,
  libelleManuelValide,
  promptRestauration,
} from '../src/shared/sauvegardes.js';

const t = (fr: string, _en: string) => fr;

describe('libelleEtape', () => {
  it('préfixe le titre de tâche', () => {
    expect(libelleEtape('Ajouter login', t)).toBe('Étape — Ajouter login');
  });

  it('retombe sur « tâche » si le titre est vide', () => {
    expect(libelleEtape('   ', t)).toBe('Étape — tâche');
  });
});

describe('libelleManuelValide', () => {
  it('exige 2–120 caractères utiles', () => {
    expect(libelleManuelValide('')).toBe(false);
    expect(libelleManuelValide('a')).toBe(false);
    expect(libelleManuelValide('ok')).toBe(true);
    expect(libelleManuelValide('x'.repeat(120))).toBe(true);
    expect(libelleManuelValide('x'.repeat(121))).toBe(false);
  });
});

describe('promptRestauration', () => {
  it('inclut le libellé, l’id et le patch borné', () => {
    const p = promptRestauration({
      id: 'sg-1',
      label: 'Avant refonte',
      patch: 'diff --git a/x b/x\n+hello',
    });
    expect(p).toContain('Avant refonte');
    expect(p).toContain('sg-1');
    expect(p).toContain('```diff');
    expect(p).toContain('+hello');
  });
});
