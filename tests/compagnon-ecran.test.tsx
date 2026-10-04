// @vitest-environment happy-dom
//
// LE COMPAGNON, RENDU — l'humeur à l'écran, le mouvement réduit, et le
// compagnon qu'on apporte.
//
// `compagnon-etat.test.ts` tient la table des humeurs, `compagnon-perso.test.ts`
// la validation et le stockage. Ce fichier-ci tient ce que ces deux-là ne
// voient pas : que le composant PEINT l'humeur décidée, qu'il ne pose aucune
// animation quand on lui demande le calme, que la fête redescend d'elle-même,
// et que le parcours « apporter le sien » refuse un SVG ou une page HTML
// SANS rien afficher ni ranger — tandis qu'un stockage en panne ne coûte que
// la persistance, jamais l'écran.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Compagnon } from '../dashboard/src/Compagnon';
import type { PropsCompagnon } from '../dashboard/src/Compagnon';
import { cleDuCompagnon } from '../dashboard/src/compagnon-perso';
import { DUREE_FETE_MS } from '../dashboard/src/compagnon-etat';
import { setLang } from '../dashboard/src/i18n';
import { couperLeReseau, type ReseauCoupe } from './aide/sans-reseau';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PNG_1PX = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let mouvementReduit = false;
/** Les abonnés à `change` de la requête de mouvement, pour la basculer en direct. */
let abonnesMouvement = new Set<() => void>();
let reseau: ReseauCoupe | null = null;

beforeEach(() => {
  // Le compagnon n'appelle aucune API — et c'est ce que ce filet PROUVE :
  // une requête partie d'ici serait comptée plutôt que d'aller frapper un
  // vrai port (tests/aide/sans-reseau.ts).
  reseau = couperLeReseau();
  setLang('fr');
  localStorage.clear();
  mouvementReduit = false;
  abonnesMouvement = new Set();
  vi.stubGlobal('matchMedia', (requete: string) => ({
    get matches() {
      return requete.includes('prefers-reduced-motion') && mouvementReduit;
    },
    media: requete,
    addEventListener: (_type: string, f: () => void) => abonnesMouvement.add(f),
    removeEventListener: (_type: string, f: () => void) => abonnesMouvement.delete(f),
  }));
});

afterEach(() => {
  // Rangé dans ce navigateur, jamais envoyé à la ruche : aucune requête.
  expect(reseau?.appels ?? []).toEqual([]);
  reseau?.rendre();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const BASE: PropsCompagnon = {
  connecte: true,
  tasks: [],
  aRevoir: 0,
  pastille: null,
  events: [],
  userId: 'u-1',
};

function monter(props: Partial<PropsCompagnon> = {}): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine?.render(<Compagnon {...BASE} {...props} />));
  return conteneur;
}

function rerendre(props: Partial<PropsCompagnon>): void {
  act(() => racine?.render(<Compagnon {...BASE} {...props} />));
}

const compagnon = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-testid="compagnon"]');
  expect(el, 'compagnon introuvable').toBeTruthy();
  return el as HTMLElement;
};

function ouvrirReglages(): HTMLElement {
  act(() => document.querySelector<HTMLButtonElement>('.cp-bouton')?.click());
  const dialogue = document.querySelector<HTMLElement>('[role="dialog"]');
  expect(dialogue, 'réglages introuvables').toBeTruthy();
  return dialogue as HTMLElement;
}

/** Tape dans un champ contrôlé par React (le setter natif, puis `input`). */
function saisir(champ: HTMLInputElement, valeur: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(champ, valeur);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function apporter(dialogue: HTMLElement, fichier: File, nom = 'Maya', images = '1') {
  const choix = dialogue.querySelector<HTMLInputElement>('input[type="file"]');
  expect(choix).toBeTruthy();
  Object.defineProperty(choix, 'files', { value: [fichier], configurable: true });
  act(() => choix?.dispatchEvent(new Event('change', { bubbles: true })));
  saisir(dialogue.querySelector<HTMLInputElement>('input[type="text"]') as HTMLInputElement, nom);
  saisir(
    dialogue.querySelector<HTMLInputElement>('input[type="number"]') as HTMLInputElement,
    images,
  );
  await act(async () => {
    dialogue.querySelector<HTMLFormElement>('form.cp-ajout')?.requestSubmit();
  });
  // La lecture du fichier est asynchrone.
  await act(async () => {});
}

describe('le compagnon peint l’humeur de la ruche', () => {
  it('AU REPOS, puis AU TRAVAIL avec le nombre de tâches, puis EN ALERTE, puis INCONNU', () => {
    monter();
    expect(compagnon().dataset.humeur).toBe('repos');
    expect(compagnon().querySelector('.cp-pastille')).toBeNull();

    rerendre({ tasks: [{ status: 'running' }, { status: 'assigned' }] });
    expect(compagnon().dataset.humeur).toBe('occupe');
    expect(compagnon().querySelector('.cp-pastille')?.textContent).toBe('2');
    expect(compagnon().querySelector('.cp-bouton')?.getAttribute('aria-label')).toContain(
      'Au travail sur 2 tâche(s)',
    );

    rerendre({ tasks: [{ status: 'running' }], aRevoir: 1 });
    expect(compagnon().dataset.humeur).toBe('alerte');
    expect(compagnon().querySelector('.cp-pastille-alerte')?.textContent).toBe('!');

    rerendre({ connecte: false, aRevoir: 1 });
    expect(compagnon().dataset.humeur).toBe('inconnu');
    expect(compagnon().querySelector('.cp-pastille-inconnu')?.textContent).toBe('?');
  });

  it('LA FÊTE D’UNE LIVRAISON ACCEPTÉE REDESCEND D’ELLE-MÊME — sans attendre un autre événement', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(1_800_000_000_000);
    monter({
      events: [{ id: 1, ts: Date.now(), type: 'task_reviewed', payload: { state: 'approved' } }],
    });
    expect(compagnon().dataset.humeur).toBe('fete');
    expect(compagnon().querySelector('.cp-etincelles')).toBeTruthy();
    act(() => vi.advanceTimersByTime(DUREE_FETE_MS + 100));
    expect(compagnon().dataset.humeur).toBe('repos');
    expect(compagnon().querySelector('.cp-etincelles')).toBeNull();
  });
});

describe('le mouvement réduit', () => {
  it('MOUVEMENT PERMIS → la classe animée est posée', () => {
    monter({ tasks: [{ status: 'running' }] });
    expect(compagnon().classList.contains('cp-anime')).toBe(true);
    expect(compagnon().dataset.mouvement).toBe('normal');
  });

  it('`prefers-reduced-motion: reduce` → AUCUNE classe animée, l’humeur reste lisible', () => {
    mouvementReduit = true;
    monter({ tasks: [{ status: 'running' }] });
    expect(compagnon().classList.contains('cp-anime')).toBe(false);
    expect(compagnon().dataset.mouvement).toBe('reduit');
    expect(compagnon().dataset.humeur).toBe('occupe');
    expect(compagnon().querySelector('.cp-pastille')?.textContent).toBe('1');
  });

  it('la préférence changée EN COURS DE ROUTE est suivie — sans recharger', () => {
    monter({ tasks: [{ status: 'running' }] });
    expect(compagnon().classList.contains('cp-anime')).toBe(true);
    mouvementReduit = true;
    act(() => abonnesMouvement.forEach((f) => f()));
    expect(compagnon().classList.contains('cp-anime')).toBe(false);
    expect(compagnon().dataset.mouvement).toBe('reduit');
  });
});

describe('apporter son compagnon', () => {
  it('UNE VRAIE IMAGE PNG devient le compagnon — par un `<img>` en data: URL — et se range pour CE compte', async () => {
    monter();
    await apporter(
      ouvrirReglages(),
      new File([PNG_1PX], 'maya.png', { type: 'image/png' }),
      'Maya',
      '4',
    );
    const img = compagnon().querySelector<HTMLImageElement>('.cp-figure img');
    expect(img?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(compagnon().querySelector('.cp-figure svg')).toBeNull();
    expect(
      compagnon()
        .querySelector<HTMLElement>('.cp-planche')
        ?.style.getPropertyValue('--compagnon-images'),
    ).toBe('4');
    const range = JSON.parse(localStorage.getItem(cleDuCompagnon('u-1')) ?? '{}');
    expect(range.perso).toHaveLength(1);
    expect(range.perso[0].nom).toBe('Maya');
    expect(localStorage.getItem(cleDuCompagnon('u-2'))).toBeNull();
  });

  it.each([
    [
      'un SVG renommé en .png',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'image/png',
    ],
    ['un SVG annoncé comme tel', '<svg onload="alert(1)"/>', 'image/svg+xml'],
    [
      'une page HTML renommée en .webp',
      '<html><body><img src=x onerror=alert(1)></body></html>',
      'image/webp',
    ],
  ])('REFUSE %s : un message, rien d’affiché, rien de rangé', async (_nom, contenu, type) => {
    monter();
    const dialogue = ouvrirReglages();
    await apporter(dialogue, new File([contenu], 'piege.png', { type }));
    expect(dialogue.querySelector('[role="alert"]')?.textContent).toContain('PNG ou WebP');
    expect(compagnon().querySelector('.cp-figure img')).toBeNull();
    expect(compagnon().querySelector('.cp-figure svg')).toBeTruthy();
    expect(localStorage.getItem(cleDuCompagnon('u-1'))).toBeNull();
    // Rien de ce contenu n'a atteint le document.
    expect(document.body.innerHTML).not.toContain('alert(1)');
  });

  it('REFUSE un fichier trop lourd AVANT de le lire', async () => {
    monter();
    const dialogue = ouvrirReglages();
    const lourd = new File([new Uint8Array(150 * 1024 + 1)], 'gros.png', { type: 'image/png' });
    const lecture = vi.spyOn(lourd, 'arrayBuffer');
    await apporter(dialogue, lourd);
    expect(dialogue.querySelector('[role="alert"]')?.textContent).toContain('150 Kio');
    expect(lecture).not.toHaveBeenCalled();
    expect(localStorage.getItem(cleDuCompagnon('u-1'))).toBeNull();
  });

  it('UN NOM VIDE est refusé', async () => {
    monter();
    const dialogue = ouvrirReglages();
    await apporter(dialogue, new File([PNG_1PX], 'm.png', { type: 'image/png' }), '   ');
    expect(dialogue.querySelector('[role="alert"]')?.textContent).toContain('nom');
    expect(compagnon().querySelector('.cp-figure img')).toBeNull();
  });
});

/**
 * Un `localStorage` hostile, posé à la place du vrai le temps d'un cas.
 *
 * Remplacé en ENTIER plutôt qu'espionné : sous happy-dom, `localStorage` ne
 * passe pas par `Storage.prototype` (un espion posé là n'est jamais appelé, et
 * le cas passe sans rien éprouver), et un espion posé sur l'objet lui-même y
 * survit au `restoreAllMocks` — il cassait le rangement des cas suivants.
 */
function stockageHostile(panne: 'lire' | 'ecrire') {
  const donnees = new Map<string, string>();
  const appels = { lire: 0, ecrire: 0 };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      appels.lire++;
      if (panne === 'lire') throw new DOMException('refusé', 'SecurityError');
      return donnees.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      appels.ecrire++;
      if (panne === 'ecrire') throw new DOMException('plein', 'QuotaExceededError');
      donnees.set(k, v);
    },
    removeItem: (k: string) => donnees.delete(k),
    clear: () => donnees.clear(),
    key: () => null,
    length: 0,
  });
  return appels;
}

describe('un stockage en panne ne coûte que la persistance', () => {
  it('ÉCRITURE REFUSÉE (quota) → le compagnon est là quand même, et l’écran le dit', async () => {
    const appels = stockageHostile('ecrire');
    monter();
    const dialogue = ouvrirReglages();
    await apporter(dialogue, new File([PNG_1PX], 'maya.png', { type: 'image/png' }));
    expect(appels.ecrire).toBeGreaterThan(0);
    expect(compagnon().querySelector('.cp-figure img')).toBeTruthy();
    expect(dialogue.querySelector('.modal-note')?.textContent).toContain('cet onglet seulement');
  });

  it('LECTURE REFUSÉE au montage → l’abeille par défaut, sans lever', () => {
    const appels = stockageHostile('lire');
    monter();
    expect(appels.lire).toBeGreaterThan(0);
    expect(compagnon().querySelector('.cp-figure svg')).toBeTruthy();
    expect(compagnon().dataset.humeur).toBe('repos');
  });
});

describe('rangeable, et rappelable', () => {
  it('RANGÉ il ne laisse qu’une alvéole ; un clic le rappelle — et le choix survit au rechargement', () => {
    monter();
    ouvrirReglages();
    const ranger = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (b) => b.textContent === 'Ranger le compagnon',
    );
    act(() => ranger?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(compagnon().querySelector('.cp-bouton')).toBeNull();
    expect(compagnon().querySelector('.cp-rappel')).toBeTruthy();

    // Rechargé : toujours rangé.
    act(() => racine?.unmount());
    monter();
    const rappel = compagnon().querySelector<HTMLButtonElement>('.cp-rappel');
    expect(rappel).toBeTruthy();
    act(() => rappel?.click());
    expect(compagnon().querySelector('.cp-bouton')).toBeTruthy();
  });

  it('LE FOCUS SUIT le compagnon : ranger le pose sur l’alvéole, la rappeler sur le compagnon', () => {
    monter();
    ouvrirReglages();
    const ranger = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (b) => b.textContent === 'Ranger le compagnon',
    );
    act(() => ranger?.click());
    // Le déclencheur que le dialogue voulait refocaliser n'existe plus :
    // sans relais, le clavier tombait sur <body>.
    expect(document.activeElement?.className).toBe('cp-rappel');
    act(() => document.querySelector<HTMLButtonElement>('.cp-rappel')?.click());
    expect(document.activeElement?.className).toBe('cp-bouton');
  });

  it('UN AUTRE ONGLET a changé les réglages → relus, et plus rien de périmé ne les écrase', async () => {
    monter();
    // L'autre onglet apporte « Alvéole » : il écrit la clé, puis ce navigateur
    // prévient CET onglet par l'événement `storage`.
    const image = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_1PX))}`;
    const cle = cleDuCompagnon('u-1');
    localStorage.setItem(
      cle,
      JSON.stringify({
        choix: 'perso-alveole',
        range: false,
        perso: [{ id: 'perso-alveole', nom: 'Alvéole', image, images: 1 }],
      }),
    );
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: cle })));
    expect(compagnon().querySelector('.cp-figure img')).toBeTruthy();
    // Choisir ici le bourdon garde le compagnon apporté là-bas.
    const dialogue = ouvrirReglages();
    act(() => dialogue.querySelector<HTMLInputElement>('input[value="bourdon"]')?.click());
    const range = JSON.parse(localStorage.getItem(cle) ?? '{}');
    expect(range.choix).toBe('bourdon');
    expect(range.perso.map((p: { nom: string }) => p.nom)).toEqual(['Alvéole']);
  });

  it('CHOISIR le bourdon change le dessin, et chaque compte garde le sien', () => {
    monter();
    const dialogue = ouvrirReglages();
    const bourdon = dialogue.querySelector<HTMLInputElement>('input[value="bourdon"]');
    act(() => bourdon?.click());
    expect(compagnon().querySelector('.cp-figure .cp-duvet')).toBeTruthy();
    rerendre({ userId: 'u-2' });
    expect(compagnon().querySelector('.cp-figure .cp-duvet')).toBeNull();
    rerendre({ userId: 'u-1' });
    expect(compagnon().querySelector('.cp-figure .cp-duvet')).toBeTruthy();
  });
});
