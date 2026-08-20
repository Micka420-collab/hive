// @vitest-environment happy-dom
//
// Focus de vue — intention courte-durée entre Reine et Rayon.

import { afterEach, describe, expect, it } from 'vitest';
import { consommerFocus, demanderFocus, FOCUS_SAUVEGARDES } from '../dashboard/src/focus-vue.js';

afterEach(() => {
  sessionStorage.clear();
});

describe('focus-vue', () => {
  it('pose et consomme une seule fois', () => {
    demanderFocus(FOCUS_SAUVEGARDES);
    expect(consommerFocus()).toBe('sauvegardes');
    expect(consommerFocus()).toBeNull();
  });
});
