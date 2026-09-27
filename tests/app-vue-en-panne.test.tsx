// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// UNE VUE QUI TOMBE NE REND PLUS TOUT L'ÉCRAN BLANC.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// La première exécution de `npm run captures` a ouvert la Chambre d'une
// ouvrière et photographié une page crème VIDE — barre comprise. Le morceau
// paresseux de la vue levait en se chargeant (un module de Node dans le paquet
// du navigateur), et React, sans frontière d'erreur, démontait tout l'arbre.
// La Chambre a été corrigée, et `paquet-navigateur.test.ts` garde CETTE cause.
// Mais la famille restait ouverte : un morceau en 404 après une reconstruction
// sous un onglet ouvert, un réseau qui hoquette, une vue qui lève en se
// rendant — chacun rendait le même écran blanc, sans un mot.
//
// ─── CE QUE CE BANC TIENT ────────────────────────────────────────────────────
//
// Les deux façons de tomber, jouées sur l'App montée pour de vrai : un morceau
// qui ne se charge pas (import rejeté), une vue qui lève au rendu. Dans les
// deux cas, la barre RESTE, l'écran DIT que la vue est tombée et pourquoi, et
// la vue suivante s'affiche normalement — la frontière repart à neuf.
//
// Sur le code d'avant la frontière de vue, l'arbre entier est démonté : plus
// une case de navigation, et ce banc échoue. Cette frontière est
// `FiletDeSecurite` (ui.tsx, #471), arrivée par un autre lot avec la même
// intention ; ce banc garde en plus le cas qu'elle ne rejouait pas — un morceau
// paresseux dont l'IMPORT est rejeté.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectFeed: vi.fn(() => ({ close: () => {} })),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  authMe: vi.fn(() => Promise.reject(new Error('pas de compte simulé'))),
}));

// Le morceau qui ne se charge pas : c'est l'IMPORT qui échoue, comme un 404 ou
// un module qui lève à l'évaluation.
vi.mock('../dashboard/src/views/Chronique', () => {
  throw new Error('morceau introuvable (simulé)');
});

// La vue qui se charge, puis lève en se rendant.
vi.mock('../dashboard/src/views/Memoire', () => ({
  default: () => {
    throw new Error('rendu impossible (simulé)');
  },
}));

import { App } from '../dashboard/src/App';
import { laisserFinirLesVuesParesseuses } from './aide/vues-paresseuses';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  localStorage.clear();
  location.hash = '';
  // React journalise l'erreur qu'une frontière rattrape : c'est voulu (la
  // console du navigateur la montre), mais ici c'est du bruit.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await laisserFinirLesVuesParesseuses();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  location.hash = '';
  vi.restoreAllMocks();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<App />));
  await act(async () => {});
  return conteneur;
}

/** Laisse le morceau paresseux se poser (ou échouer), borné à une seconde. */
async function attendre(fini: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !fini(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

describe('une vue qui tombe — la barre reste, l’écran le dit', () => {
  // Le message du morceau rejeté est celui que vitest compose autour de l'erreur
  // de sa fabrique ; on exige alors seulement qu'il y en ait un. Celui de la vue
  // qui lève est le nôtre, mot pour mot.
  it.each([
    ['un morceau qui ne se charge pas', '#/chronique', /\S/],
    ['une vue qui lève en se rendant', '#/memoire', /^rendu impossible \(simulé\)$/],
  ])('%s', async (_cas, route, message) => {
    location.hash = route;
    const dom = await monter();
    await attendre(() => dom.querySelector('.mc-panne') !== null);

    const panne = dom.querySelector('.mc-panne');
    expect(panne, 'la vue tombée est remplacée par un message').not.toBeNull();
    expect(panne?.getAttribute('role')).toBe('alert');
    expect(panne?.textContent).toContain('Cette vue est tombée en panne');
    expect(
      panne?.querySelector('.mc-panne-detail')?.textContent,
      'le message dit POURQUOI',
    ).toMatch(message);
    expect(
      dom.querySelectorAll('.mc-nav-cell').length,
      'la barre survit à la vue tombée — sans frontière, l’arbre entier est démonté',
    ).toBeGreaterThan(0);

    // Une autre vue : la frontière repart à neuf, l'erreur ne la suit pas.
    const ruche = dom.querySelector<HTMLButtonElement>('.mc-nav-cell[data-vue="ruche"]');
    expect(ruche, 'la case de la Ruche').not.toBeNull();
    await act(async () => ruche?.click());
    await attendre(() => dom.querySelector('.mc-panne') === null);
    expect(dom.querySelector('.mc-panne'), 'la Ruche s’affiche, sans la panne').toBeNull();
    expect(dom.querySelector('.mc-nav-cell.active')?.getAttribute('data-vue')).toBe('ruche');
  });
});
