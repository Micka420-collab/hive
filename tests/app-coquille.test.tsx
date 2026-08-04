// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA COQUILLE DE L'APP, RENDUE — l'étiquette dans la bonne langue, et la
// route qui n'affiche QUE sa vue.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Les deux dernières survivantes du balayage loupe du 3 août vivaient dans
// `App.tsx` — 458 lignes d'intégration qu'aucun test ne montait :
//
//   · `title={`${lang === 'fr' ? item.label : item.labelEn} …`}` — mutée,
//     l'info-bulle parlerait TOUJOURS la mauvaise langue : « Hive » à
//     l'écran français, « Ruche » à l'anglais ;
//   · `{route.view === 'rayon' && <Rayon …/>}` — mutée, le Rayon
//     s'afficherait sous TOUTES les vues sauf la sienne, et sa route à lui
//     serait vide.
//
// Le shell se monte pour de vrai : seul le flux WebSocket (`connectFeed`) et
// les sondes REST sont simulés — le reste (nav, routage par hash, i18n) est
// exactement ce que le navigateur exécute.

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
  fetchRayon: vi.fn(() => Promise.resolve({ chemin: '', entrees: [] })),
}));

import { connectFeed, getToken } from '../dashboard/src/api';
import type { FeedHandlers } from '../dashboard/src/api';
import { App } from '../dashboard/src/App';
import { getReview } from '../dashboard/src/views/shared';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  location.hash = '';
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  location.hash = '';
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<App />));
  // Les chunks paresseux et les sondes simulées se posent en microtâches.
  await act(async () => {});
  await act(async () => {});
  return conteneur;
}

function celluleNav(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('.mc-nav-cell')].find(
    (x) => x.querySelector('.mc-nav-label')?.textContent === libelle,
  );
  expect(b, `cellule de navigation « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

describe('la coquille de l’App — les deux dernières survivantes du balayage', () => {
  it('L’INFO-BULLE PARLE LA LANGUE DE L’ÉCRAN — jamais l’autre', async () => {
    // La survivante du `title` : mutée, chaque info-bulle parlerait la langue
    // que l'utilisateur n'a PAS choisie. Le libellé visible (ligne voisine,
    // non mutée) sert de poignée : c'est le TITRE qu'on juge.
    const dom = await monter();
    expect(celluleNav(dom, 'Ruche').title).toBe('Ruche (touche 1)');
    expect(celluleNav(dom, 'Ruche').title).not.toContain('Hive');

    act(() => setLang('en'));
    expect(celluleNav(dom, 'Hive').title).toBe('Hive (key 1)');
    expect(celluleNav(dom, 'Hive').title).not.toContain('Ruche');
  });

  it('LE RAYON NE S’AFFICHE QUE SUR SA ROUTE — et sa route l’affiche', async () => {
    // La survivante du routage : mutée, le Rayon vivrait sous TOUTES les
    // autres vues (chaque écran porterait un « Aucun projet » étranger) et
    // sa propre route serait vide.
    const accueil = await monter();
    expect(
      accueil.textContent,
      'la vue d’accueil ne porte pas le Rayon d’un autre écran',
    ).not.toContain('Aucun projet dans la ruche.');

    act(() => racine?.unmount());
    location.hash = '#/rayon';
    const rayon = await monter();
    // Le chunk paresseux traverse un vrai import dynamique : on scrute sa
    // pose, borné à une seconde — « Chargement de la vue… » n'est pas un état
    // final acceptable.
    for (let i = 0; i < 50 && !rayon.textContent?.includes('Aucun projet'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(rayon.textContent, 'la route du Rayon affiche le Rayon').toContain(
      'Aucun projet dans la ruche.',
    );
  });
});

describe('la coquille de l’App — les survivantes du balayage du soir', () => {
  it('SEUL L’ÉVÉNEMENT task_reviewed SYNCHRONISE LES REVUES — les autres n’y touchent pas', async () => {
    // `if (ev.type === 'task_reviewed')` mutée en `!==` : le verdict posé par
    // un autre opérateur ne se synchroniserait JAMAIS, et chaque autre
    // événement de tâche (progression comprise) appellerait la synchro avec
    // un état indéfini — c'est-à-dire EFFACERAIT la revue existante.
    let poignees: FeedHandlers | null = null;
    vi.mocked(connectFeed).mockImplementation((h: FeedHandlers) => {
      poignees = h;
      return { close: () => {} };
    });
    await monter();
    expect(poignees, 'le flux doit être branché au montage').toBeTruthy();

    const on = poignees as unknown as FeedHandlers;
    await act(async () => {
      on.onEvent({
        id: 1,
        ts: 1,
        type: 'task_reviewed',
        payload: { taskId: 't-sync', state: 'approved' },
      } as never);
    });
    // Le cache des revues vit EN MÉMOIRE (serverReviews) — localStorage ne
    // porte que le geste local. `getReview` lit ce que l'écran lira.
    expect(getReview('t-sync'), 'le verdict d’un autre opérateur se synchronise').toBe('approved');

    await act(async () => {
      on.onEvent({
        id: 2,
        ts: 2,
        type: 'task_progress',
        payload: { taskId: 't-sync', subAgents: [] },
      } as never);
    });
    expect(getReview('t-sync'), 'la progression ne touche pas aux revues').toBe('approved');
  });

  it('LE JETON SE POSE À ENTRÉE — et à aucune autre touche', async () => {
    // `e.key === 'Enter' && applyToken()` mutée en `!==` : chaque frappe
    // ordinaire poserait un jeton encore incomplet (et reconnecterait le
    // flux en perdant les événements de la fenêtre), et la touche Entrée —
    // le geste attendu — ne ferait plus rien.
    const dom = await monter();
    const champ = dom.querySelector('.token-input') as HTMLInputElement;
    expect(champ, 'le champ du jeton existe').toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(champ) as object,
        'value',
      )?.set;
      setter?.call(champ, 'jeton-complet-pour-le-banc');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(getToken(), 'une frappe ordinaire ne pose rien').not.toBe('jeton-complet-pour-le-banc');

    act(() => {
      champ.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(getToken(), 'Entrée pose le jeton').toBe('jeton-complet-pour-le-banc');
  });

  it('LA MIELLERIE NE S’AFFICHE QUE SUR SA ROUTE — et sa route l’affiche', async () => {
    // Survivante du balayage de nuit : `{route.view === 'miellerie' && …}`
    // mutée en `!==`. La Miellerie est l'écran où l'humain APPROUVE ou REJETTE
    // ce que l'IA a produit : mutée, elle s'ouvrirait sous toutes les autres
    // vues (le geste de revue posé sur une tâche qu'on ne regardait pas) et
    // sa propre route serait vide — l'écran de contrôle introuvable là où on
    // le cherche. Vérifiée NUE : la suite entière moins ce fichier reste
    // verte avec la mutation en place (208 fichiers, 3 183 tests).
    const accueil = await monter();
    expect(
      accueil.textContent,
      'la vue d’accueil ne porte pas la file de revue d’un autre écran',
    ).not.toContain('Le nectar arrive');

    act(() => racine?.unmount());
    location.hash = '#/miellerie';
    const miellerie = await monter();
    // Chunk paresseux : vrai import dynamique, scruté borné à une seconde.
    // « Chargement de la vue… » n'est pas un état final acceptable.
    for (let i = 0; i < 50 && !miellerie.textContent?.includes('Le nectar arrive'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(miellerie.textContent, 'la route de la Miellerie affiche la Miellerie').toContain(
      'Le nectar arrive — aucune production à revoir.',
    );
  });
});
