// @vitest-environment happy-dom
//
// Focus de vue — intention courte-durée entre Reine / Chambre et Rayon.

import { afterEach, describe, expect, it } from 'vitest';
import {
  cheminDepuisFocus,
  consommerFocus,
  demanderFocus,
  demanderFocusFichier,
  FOCUS_FICHIER_PREFIX,
  FOCUS_SAUVEGARDES,
  parentsDuChemin,
} from '../dashboard/src/focus-vue.js';

afterEach(() => {
  sessionStorage.clear();
});

describe('focus-vue', () => {
  it('pose et consomme une seule fois', () => {
    demanderFocus(FOCUS_SAUVEGARDES);
    expect(consommerFocus()).toBe('sauvegardes');
    expect(consommerFocus()).toBeNull();
  });

  it('encode un chemin fichier pour le Rayon', () => {
    demanderFocusFichier('src/pont/mcp.ts');
    const f = consommerFocus();
    expect(f).toBe(`${FOCUS_FICHIER_PREFIX}src/pont/mcp.ts`);
    expect(cheminDepuisFocus(f)).toBe('src/pont/mcp.ts');
    expect(cheminDepuisFocus(FOCUS_SAUVEGARDES)).toBeNull();
  });

  it('parentsDuChemin déplie la hiérarchie sans la racine', () => {
    expect(parentsDuChemin('README.md')).toEqual([]);
    expect(parentsDuChemin('src/pont/mcp.ts')).toEqual(['src', 'src/pont']);
    expect(parentsDuChemin('/src/a.ts')).toEqual(['src']);
  });
});
