// @vitest-environment happy-dom
//
// LE CHOIX DU THÈME — mémorisé par navigateur, jamais bloquant.
//
// Ce que ces tests tiennent :
//
//   · « système » est le défaut ET un choix : il RETIRE l'attribut, et la
//     feuille suit alors l'OS toute seule (styles.css, `prefers-color-scheme`) ;
//   · un stockage qui lève (navigation privée, politique du poste, quota) ne
//     fait jamais tomber l'écran : la lecture retombe sur « système », et un
//     choix qu'on n'a pas pu écrire vaut quand même pour l'onglet ;
//   · un choix fait dans un autre onglet repeint celui-ci ;
//   · le menu de la barre du haut coche le choix courant et le change.

import { readFileSync } from 'node:fs';
import { URL as UrlNode, fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ChoixDuTheme } from '../src/ChoixDuTheme';
import { setLang } from '../src/i18n';
import {
  CHOIX_THEMES,
  CLE_THEME,
  appliquerTheme,
  changerTheme,
  choixTheme,
  lireChoixTheme,
} from '../src/theme';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const attribut = (): string | null => document.documentElement.getAttribute('data-theme');

let racine: Root | undefined;
let conteneur: HTMLElement | undefined;

beforeAll(() => setLang('fr'));

afterEach(async () => {
  vi.restoreAllMocks();
  changerTheme('systeme');
  localStorage.clear();
  const r = racine;
  racine = undefined;
  if (r) {
    await act(async () => {
      r.unmount();
    });
  }
  conteneur?.remove();
  conteneur = undefined;
});

describe('le choix du thème', () => {
  it('rien de mémorisé : « système », et AUCUN attribut — la feuille suit l’OS', () => {
    appliquerTheme();
    expect(choixTheme()).toBe('systeme');
    expect(attribut()).toBeNull();
  });

  it('un choix mémorisé est appliqué au démarrage', () => {
    localStorage.setItem(CLE_THEME, 'sombre');
    appliquerTheme();
    expect(choixTheme()).toBe('sombre');
    expect(attribut()).toBe('dark');
  });

  it('une valeur mémorisée inconnue vaut « système » — pas un thème inventé', () => {
    localStorage.setItem(CLE_THEME, 'violet');
    expect(lireChoixTheme()).toBe('systeme');
  });

  it('changer pose l’attribut et mémorise ; revenir à « système » efface les deux', () => {
    changerTheme('clair');
    expect(attribut()).toBe('light');
    expect(localStorage.getItem(CLE_THEME)).toBe('clair');
    changerTheme('systeme');
    expect(attribut()).toBeNull();
    expect(localStorage.getItem(CLE_THEME)).toBeNull();
  });

  it('un stockage qui LÈVE ne fait rien tomber : lu « système », écrit… pour l’onglet', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('stockage coupé', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(lireChoixTheme()).toBe('systeme');
    expect(() => changerTheme('sombre')).not.toThrow();
    expect(attribut()).toBe('dark');
    expect(choixTheme()).toBe('sombre');
  });

  it('un choix fait dans un AUTRE onglet repeint celui-ci', () => {
    appliquerTheme();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CLE_THEME, newValue: 'sombre' }));
    });
    expect(attribut()).toBe('dark');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: CLE_THEME, newValue: null }));
    });
    expect(attribut()).toBeNull();
  });

  it('un `localStorage.clear()` dans un autre onglet efface le choix ici aussi', () => {
    // `clear()` émet un `storage` dont la clé est `null` : ignoré, l'onglet
    // gardait un thème que plus rien ne mémorisait.
    changerTheme('sombre');
    appliquerTheme();
    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
    });
    expect(choixTheme()).toBe('systeme');
    expect(attribut()).toBeNull();
  });

  it('le script d’index.html pose le CHOIX avant la première peinture — mêmes valeurs que theme.ts', () => {
    // Le module de l'application tourne après l'analyse du document : sans ce
    // script, un choix contraire à l'OS flasherait le temps d'une image.
    const html = readFileSync(fileURLToPath(new UrlNode('../index.html', import.meta.url)), 'utf8');
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script, 'index.html sans script de thème en ligne').toBeDefined();
    const jouer = new Function(script ?? '') as () => void;
    for (const choix of CHOIX_THEMES) {
      document.documentElement.removeAttribute('data-theme');
      if (choix === 'systeme') localStorage.removeItem(CLE_THEME);
      else localStorage.setItem(CLE_THEME, choix);
      jouer();
      const attendu = attribut();
      // La même chose que ce que pose theme.ts pour ce choix.
      document.documentElement.removeAttribute('data-theme');
      appliquerTheme();
      expect(attendu, choix).toBe(attribut());
    }
    // Un stockage qui lève ne casse pas la page.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('stockage coupé', 'SecurityError');
    });
    expect(jouer).not.toThrow();
  });
});

describe('le menu du thème dans la barre du haut', () => {
  it('coche le choix courant, dit le thème dans son nom, et le change', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    conteneur = c;
    const r = createRoot(c);
    racine = r;
    await act(async () => {
      r.render(<ChoixDuTheme />);
    });
    const bouton = c.querySelector<HTMLButtonElement>('[data-testid="mc-theme"]')!;
    expect(bouton.getAttribute('aria-label')).toBe('Thème : Système');
    await act(async () => {
      bouton.click();
    });
    const radios = [...c.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    // Le texte LU : la pastille « ● » est `aria-hidden`, c'est `aria-checked` qui parle.
    const lu = (x: HTMLElement) =>
      [...x.childNodes]
        .filter((n) => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true'))
        .map((n) => n.textContent)
        .join('')
        .trim();
    expect(radios.map((x) => [lu(x), x.getAttribute('aria-checked')])).toEqual([
      ['Système', 'true'],
      ['Sombre', 'false'],
      ['Clair', 'false'],
    ]);
    await act(async () => {
      radios[1]!.click();
    });
    expect(attribut()).toBe('dark');
    expect(bouton.getAttribute('aria-label')).toBe('Thème : Sombre');
    expect(document.activeElement).toBe(bouton);
  });
});
