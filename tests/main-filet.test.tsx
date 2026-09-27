// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE DERNIER FILET — sous l'application entière (`main.tsx`).
//
// Le filet des vues (`tests/app-filet.test.tsx`) ne couvre que la zone des
// vues. Une panne AU-DESSUS — la coquille elle-même, le tiroir d'une tâche,
// une modale, l'écran du porteur de lien — remontait jusqu'à la racine, et
// React la démontait : `#root` vide, sans un mot. Ce banc monte le VRAI point
// d'entrée, avec une coquille qui jette.

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/App', () => ({
  App: () => {
    throw new Error('la coquille a jeté au premier rendu');
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
});

describe('le point d’entrée du tableau de bord', () => {
  it('UNE PANNE DE LA COQUILLE LAISSE UNE EXPLICATION, PAS UN `#root` VIDE', async () => {
    setLang('fr');
    const racine = document.createElement('div');
    racine.id = 'root';
    document.body.appendChild(racine);
    // React journalise l'erreur rattrapée : c'est le scénario même.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await import('../dashboard/src/main');
    });

    const filet = racine.querySelector('.mc-panne');
    expect(filet, 'la coquille a jeté et la page est restée blanche').not.toBeNull();
    expect(filet?.getAttribute('role')).toBe('alert');
    expect(filet?.textContent).toContain('Mission Control est tombé en panne');
    expect(filet?.textContent, 'la panne n’est pas nommée').toContain(
      'la coquille a jeté au premier rendu',
    );
    // Sous l'application, il n'y a pas de barre vers laquelle renvoyer : le
    // geste qui reste est de recharger.
    expect(
      [...racine.querySelectorAll('button')].some((b) => b.textContent === 'Recharger la page'),
    ).toBe(true);
  });
});
