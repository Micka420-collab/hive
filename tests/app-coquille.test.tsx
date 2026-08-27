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
  fetchSauvegardes: vi.fn(() => Promise.resolve({ sauvegardes: [] })),
  fetchCerveau: vi.fn(() => Promise.resolve(null)),
  fetchResults: vi.fn(() => Promise.resolve({ results: [] })),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchMergePlan: vi.fn(() => Promise.resolve(null)),
  fetchMergeResult: vi.fn(() => Promise.resolve(null)),
  fetchEssaim: vi.fn(() =>
    Promise.resolve({
      niveau: 'off',
      niveaux: ['off', 'propose', 'gouverne', 'plein'],
      runner: { mode: 'off', enPause: false, echecs: 0, dernierTourA: 0 },
      derive: { etat: 'saine', echantillon: 0, indicateurs: [], solitudeJours: 0, motif: '' },
      decision: { pas: 'inerte', motif: '', gouvernantes: [] },
      gouvernantes: [],
      gouvernantesRequises: 1,
      depotInscrit: false,
      plafond: 'passe',
      lecons: [],
    }),
  ),
  fetchAtelier: vi.fn(() => Promise.resolve({ mode: 'off', actif: false })),
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
  it('LA CELLULE DE LA VUE COURANTE PORTE `aria-current` ET la classe active', async () => {
    // Survivantes loupe (§ 9 vicies, la famille GardeFous / PleinEssaim /
    // AccountPanel) : sur la navigation, `aria-current={route.view === item.id ?
    // 'page' : undefined}` ET `className={… === item.id ? ' active'}`. Mutées en
    // `!==`, la suite restait verte — les bancs lisaient le libellé et l'info-bulle,
    // jamais l'état COURANT de la cellule. Or `aria-current="page"` est ce qu'un
    // lecteur d'écran annonce comme « la page où vous êtes », et `.active` la
    // surligne : inverser désigne TOUTES les vues SAUF la bonne comme courantes.
    const dom = await monter();
    // Au réveil, la Ruche est la vue courante (hash vide → 'ruche').
    const ruche = celluleNav(dom, 'Ruche');
    const projets = celluleNav(dom, 'Projets');
    expect(ruche.getAttribute('aria-current'), 'la Ruche est la page courante').toBe('page');
    expect(ruche.className, 'la Ruche porte la classe active').toContain('active');
    expect(projets.getAttribute('aria-current'), 'les Projets ne sont pas la page').toBeNull();
    expect(projets.className, 'les Projets ne portent pas la classe active').not.toContain(
      'active',
    );
  });

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

  it('LA NAVIGATION EST GROUPÉE ET CHAQUE DESTINATION EXPLIQUE SON USAGE', async () => {
    const dom = await monter();
    const sections = [...dom.querySelectorAll('.mc-nav-section-title')].map((e) => e.textContent);
    expect(sections).toEqual(
      expect.arrayContaining(['Piloter', 'Produire', 'Observer', 'Votre espace']),
    );

    expect(celluleNav(dom, 'Miellerie').getAttribute('aria-label')).toContain('Revoir & fusionner');
    expect(celluleNav(dom, 'Rayon').getAttribute('aria-label')).toContain('Code & sauvegardes');
  });

  it('LE MENU MOBILE OUVRE ET FERME LE MÊME NAVIGATEUR', async () => {
    const dom = await monter();
    const ouvrir = dom.querySelector('.mc-mobile-menu-btn') as HTMLButtonElement;
    const nav = dom.querySelector('#mc-primary-navigation') as HTMLElement;
    expect(ouvrir).toBeTruthy();
    expect(ouvrir.getAttribute('aria-expanded')).toBe('false');

    await act(async () => ouvrir.click());
    expect(nav.className).toContain('mobile-open');
    expect(
      (dom.querySelector('.mc-mobile-menu-btn') as HTMLButtonElement).getAttribute('aria-expanded'),
    ).toBe('true');

    await act(async () => (dom.querySelector('.mc-sidebar-close') as HTMLButtonElement).click());
    expect(nav.className).not.toContain('mobile-open');
  });

  it('LE RAYON NE S’AFFICHE QUE SUR SA ROUTE — et sa route l’affiche', async () => {
    // La survivante du routage : mutée, le Rayon vivrait sous TOUTES les
    // autres vues (chaque écran porterait un vide Rayon étranger) et
    // sa propre route serait vide.
    const accueil = await monter();
    expect(
      accueil.textContent,
      'la vue d’accueil ne porte pas le Rayon d’un autre écran',
    ).not.toContain('Le rayon s’ouvre avec un projet');

    act(() => racine?.unmount());
    location.hash = '#/rayon';
    const rayon = await monter();
    // Le chunk paresseux traverse un vrai import dynamique : on scrute sa
    // pose, borné à une seconde — « Chargement de la vue… » n'est pas un état
    // final acceptable.
    for (let i = 0; i < 50 && !rayon.textContent?.includes('Le rayon s’ouvre'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(rayon.textContent, 'la route du Rayon affiche le Rayon').toContain(
      'Le rayon s’ouvre avec un projet',
    );
  });

  it('LE CERVEAU NE S’AFFICHE QUE SUR SA ROUTE — et sa route l’affiche', async () => {
    // ─── LA MÊME SURVIVANTE, TREIZE FOIS ───────────────────────────────────
    //
    // Deux mutations de la ligne de routage du Cerveau laissaient la suite
    // VERTE, et elles cassent dans deux sens opposés :
    //
    //   `&&` → `||`   `false || <Cerveau/>` rend le Cerveau : il vivrait sous
    //                 TOUTES les autres vues.
    //   `===` → `!==` il s'affiche partout SAUF chez lui, et sa propre route
    //                 est vide.
    //
    // On assure donc les DEUX sens : absent ailleurs, présent chez lui. Une
    // seule des deux moitiés laisserait l'autre mutation en vie.
    //
    // Le marqueur est la classe de la racine, pas une phrase de l'interface :
    // une copie se réécrit sans prévenir, une racine structurelle non.
    //
    // ─── ET CE BANC NE RÈGLE QU'UN TREIZIÈME DU PROBLÈME ───────────────────
    //
    // `App.tsx` porte TREIZE lignes de cette forme exacte. Trois sont
    // désormais défendues — Rayon, Miellerie, Cerveau — chacune fermée par un
    // balayage différent, une à la fois. C'est un tapis roulant : le vrai
    // remède est une racine commune à toutes les vues, qui permettrait un banc
    // parcourant `NAV` au lieu d'un banc par vue. Il demande de toucher aux
    // treize fichiers de vue et n'est pas de ce lot — il est nommé dans
    // `ERREURS § 9 duoquadragies` pour ne pas se perdre.
    const accueil = await monter();
    expect(
      accueil.querySelector('section.cerveau'),
      'le Cerveau s’affiche sous une vue qui n’est pas la sienne',
    ).toBeNull();

    act(() => racine?.unmount());
    location.hash = '#/cerveau';
    const cerveau = await monter();
    for (let i = 0; i < 50 && !cerveau.querySelector('section.cerveau'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(
      cerveau.querySelector('section.cerveau'),
      'la route du Cerveau n’affiche pas le Cerveau',
    ).not.toBeNull();
  });
});

describe('la coquille de l’App — les survivantes du balayage du soir', () => {
  it('HORS LIGNE, LE JETON EST GUIDÉ ; CONNECTÉ, LE BANDEAU DISPARAÎT', async () => {
    let poignees: FeedHandlers | null = null;
    vi.mocked(connectFeed).mockImplementation((h: FeedHandlers) => {
      poignees = h;
      return { close: () => {} };
    });
    const dom = await monter();
    expect(dom.querySelector('.mc-connection-guide')?.textContent).toContain(
      'Connectez Mission Control',
    );
    expect(dom.querySelector('#hive-token-guide')).toBeTruthy();

    await act(async () => {
      (poignees as unknown as FeedHandlers).onStatus(true);
    });
    expect(dom.querySelector('.mc-connection-guide')).toBeNull();
    expect(dom.querySelector('#hive-token-menu')).toBeTruthy();
  });

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
