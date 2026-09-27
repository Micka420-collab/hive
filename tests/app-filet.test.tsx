// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA COQUILLE QUI TIENT QUAND UNE VUE TOMBE — et qui se laisse traverser au
// clavier.
//
// ─── LA PAGE BLANCHE ─────────────────────────────────────────────────────────
//
// Aucune frontière d'erreur n'existait dans le tableau de bord. Une vue qui
// jetait pendant son rendu — ou dont le morceau paresseux ne se chargeait plus
// après une mise à jour de la ruche — faisait démonter TOUTE la racine par
// React : plus de barre, plus de voyant, un `#root` vide. Le filet
// (`FiletDeSecurite`, ui.tsx) borne la panne à la vue.
//
// Les vues en panne sont SIMULÉES par module : le Rayon jette tant qu'on le
// lui demande, et le morceau des Chantiers ne se charge pas du tout. Le reste
// — coquille, routage par hash, filet — est ce que le navigateur exécute.
//
// ─── LE CLAVIER ET LE LECTEUR D'ÉCRAN ────────────────────────────────────────
//
// Même coquille, deux absences qu'on ne voit qu'au clavier : aucun lien
// « aller au contenu » (treize cases de barre à traverser avant la vue), et
// aucun repère `main` sauf dans la Ruche.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

const panne = vi.hoisted(() => ({ rayon: false }));

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectFeed: vi.fn(() => ({ close: () => {} })),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  authMe: vi.fn(() => Promise.reject(new Error('pas de compte simulé'))),
}));

// Le Rayon, remplacé par une vue qui jette À LA DEMANDE : `panne.rayon` décide.
// Un compteur de rendus ne conviendrait pas — React rejoue un rendu qui a jeté
// avant d'abandonner à la frontière, et une panne « au premier rendu seulement »
// guérirait toute seule, sans que le filet n'ait rien eu à faire.
vi.mock('../dashboard/src/views/Rayon', () => ({
  default: () => {
    if (panne.rayon) throw new Error('champ « entrees » absent de la réponse');
    return <div className="mc-view">le Rayon répond</div>;
  },
}));

// Le morceau des Chantiers ne se charge pas : c'est ce que vit un onglet resté
// ouvert pendant une mise à jour, quand les noms de fichiers ont changé.
vi.mock('../dashboard/src/views/Chantiers', () => {
  throw new Error('Failed to fetch dynamically imported module: Chantiers-4f2b.js');
});

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
  panne.rayon = false;
  // React journalise chaque erreur rattrapée : ici, c'est le scénario même.
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

async function monter(hash: string): Promise<HTMLElement> {
  location.hash = hash;
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<App />));
  return conteneur;
}

/** Scrute un état final, borné à une seconde : les vues sont paresseuses. */
async function attendre(dom: HTMLElement, pret: (d: HTMLElement) => boolean): Promise<void> {
  for (let i = 0; i < 50 && !pret(dom); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

async function naviguer(hash: string): Promise<void> {
  await act(async () => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function cliquer(el: Element | null | undefined): void {
  expect(el, 'élément à cliquer introuvable').toBeTruthy();
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const bouton = (dom: HTMLElement, libelle: string): HTMLButtonElement | undefined =>
  [...dom.querySelectorAll('button')].find((b) => b.textContent === libelle);

describe('une vue qui tombe ne blanchit plus l’écran', () => {
  it('LA PANNE D’UNE VUE LAISSE LA COQUILLE DEBOUT — et le dit', async () => {
    panne.rayon = true;
    const dom = await monter('#/rayon');
    await attendre(dom, (d) => d.querySelector('.mc-panne') !== null);

    const filet = dom.querySelector('.mc-panne');
    expect(filet, 'la vue a jeté et rien ne l’a rattrapé : page blanche').not.toBeNull();
    expect(filet?.getAttribute('role'), 'la panne doit être annoncée').toBe('alert');
    expect(filet?.textContent).toContain('Cette vue est tombée en panne');
    expect(filet?.textContent, 'le message de la panne est tu').toContain(
      'champ « entrees » absent de la réponse',
    );
    // La coquille survit : la barre est là, et c'est elle qui mène ailleurs.
    expect(dom.querySelectorAll('.mc-nav-cell').length, 'la barre a disparu').toBeGreaterThan(5);
    expect(dom.querySelector('#mc-contenu .mc-panne'), 'la panne sort de sa vue').not.toBeNull();
  });

  it('LE FILET SE RÉARME À CHAQUE VUE — la panne ne suit pas l’opérateur', async () => {
    panne.rayon = true;
    const dom = await monter('#/rayon');
    await attendre(dom, (d) => d.querySelector('.mc-panne') !== null);
    expect(dom.querySelector('.mc-panne')).not.toBeNull();

    await naviguer('#/ruche');
    expect(dom.querySelector('.mc-panne'), 'la panne du Rayon s’affiche sur la Ruche').toBeNull();
    expect(dom.textContent).toContain('Votre ruche est prête');

    // Retour au Rayon guéri : un filet NEUF, qui laisse passer la vue.
    panne.rayon = false;
    await naviguer('#/rayon');
    await attendre(dom, (d) => (d.textContent ?? '').includes('le Rayon répond'));
    expect(dom.textContent).toContain('le Rayon répond');
    expect(dom.querySelector('.mc-panne')).toBeNull();
  });

  it('RÉESSAYER REND LA VUE — et un échec répété se compte au lieu de se taire', async () => {
    panne.rayon = true;
    const dom = await monter('#/rayon');
    await attendre(dom, (d) => d.querySelector('.mc-panne') !== null);

    // Toujours en panne : le clic doit laisser une trace, sinon on ne saurait
    // pas qu'il a eu lieu.
    cliquer(bouton(dom, 'Réessayer'));
    expect(dom.querySelector('.mc-panne')?.textContent).toContain(
      'Toujours en panne après 1 nouvel essai',
    );

    panne.rayon = false;
    cliquer(bouton(dom, 'Réessayer'));
    expect(dom.querySelector('.mc-panne'), 'la vue guérie reste masquée').toBeNull();
    expect(dom.textContent).toContain('le Rayon répond');
  });

  it('UN MORCEAU QUI NE SE CHARGE PLUS TOMBE DANS LE FILET, pas dans le vide', async () => {
    const dom = await monter('#/chantiers');
    await attendre(dom, (d) => d.querySelector('.mc-panne') !== null);
    const filet = dom.querySelector('.mc-panne');
    expect(filet, 'import paresseux raté : page blanche').not.toBeNull();
    // Le remède d'un morceau introuvable est de recharger : le geste est offert.
    expect(
      bouton(dom, 'Recharger la page'),
      'aucun moyen d’aller chercher la version courante',
    ).toBeTruthy();
    expect(dom.querySelectorAll('.mc-nav-cell').length).toBeGreaterThan(5);
  });
});

describe('la coquille au clavier et au lecteur d’écran', () => {
  it('LE PREMIER ARRÊT DE TAB EST « ALLER AU CONTENU »', async () => {
    const dom = await monter('#/rayon');
    const premier = dom.querySelector('a[href], button, input, select, textarea, [tabindex]');
    expect(premier?.textContent, 'le premier arrêt de Tab n’est pas le lien d’évitement').toBe(
      'Aller au contenu',
    );
  });

  it('LE LIEN POSE LE FOCUS SUR LA VUE — SANS QUITTER LA VUE', async () => {
    // Suivre `href="#mc-contenu"` réécrirait le fragment, que `parseHash` ne
    // reconnaît pas : l'App repartirait sur la Ruche. « Aller au contenu »
    // ferait quitter le contenu.
    const dom = await monter('#/rayon');
    await attendre(dom, (d) => (d.textContent ?? '').includes('le Rayon répond'));
    cliquer(dom.querySelector('.mc-evitement'));

    expect(location.hash, 'le lien d’évitement a changé de vue').toBe('#/rayon');
    expect(document.activeElement?.id, 'le focus n’est pas sur le contenu').toBe('mc-contenu');
    expect(document.activeElement?.tagName).toBe('MAIN');
    expect(dom.textContent, 'la vue a changé sous le lien').toContain('le Rayon répond');
  });

  it('CHAQUE VUE VIT DANS LE REPÈRE `main` — et il n’y en a qu’un', async () => {
    const dom = await monter('#/rayon');
    await attendre(dom, (d) => (d.textContent ?? '').includes('le Rayon répond'));
    const mains = dom.querySelectorAll('main');
    expect(mains.length, 'repères `main` sur la page').toBe(1);
    expect(mains[0]?.id).toBe('mc-contenu');
    expect(mains[0]?.textContent).toContain('le Rayon répond');
    // Et pas la barre : le repère ne contient que la vue.
    expect(mains[0]?.querySelector('.mc-nav-cell'), 'la barre est dans le contenu').toBeNull();
  });

  it('LA RUCHE PEUPLÉE N’EMBOÎTE PAS UN SECOND `main`', async () => {
    const { connectFeed } = await import('../dashboard/src/api');
    let poser: ((s: never) => void) | null = null;
    vi.mocked(connectFeed).mockImplementation((h) => {
      poser = h.onState as (s: never) => void;
      return { close: () => {} };
    });
    const dom = await monter('#/ruche');
    await act(async () => {
      poser?.({
        projects: [
          {
            id: 'p-1',
            name: 'Rucher',
            repoUrl: null,
            description: null,
            visibility: 'private',
            ownerId: null,
            createdAt: 1,
          },
        ],
        nodes: [],
        tasks: [],
        tasksTotal: 0,
      } as never);
    });
    expect(dom.querySelector('.layout'), 'la Ruche peuplée ne s’est pas rendue').not.toBeNull();
    const mains = dom.querySelectorAll('main');
    expect(mains.length, 'deux `main` emboîtés').toBe(1);
    // Le seul repère est celui de la coquille, et la grille de la Ruche y vit.
    expect(mains[0]?.id).toBe('mc-contenu');
    expect(mains[0]?.querySelector('.layout')).not.toBeNull();
  });

  it('LA MARQUE N’EST PAS EMBOÎTÉE DANS ELLE-MÊME', async () => {
    // La marque et le nom portaient la même classe : la règle en colonne du
    // nom s'appliquait à la marque, et le logo passait au-dessus du nom.
    const dom = await monter('#/rayon');
    expect(dom.querySelector('.mc-sidebar-brand .mc-sidebar-brand')).toBeNull();
    expect(
      dom.querySelector('.mc-sidebar-brand > .mc-sidebar-nom .mc-sidebar-word')?.textContent,
    ).toBe('Hive');
  });
});
