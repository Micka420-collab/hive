// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA LIAISON AVEC LA RUCHE, DITE À L'ÉCRAN — « pas encore arrivé » n'est pas
// « vide », et « hors ligne » se dit sur tout l'écran.
//
// ─── CE QUI MENTAIT ──────────────────────────────────────────────────────────
//
// La coquille démarre sur un instantané vide. Tant que le premier `state` du
// flux n'était pas arrivé — et s'il n'arrivait jamais, Reine arrêtée —, la
// Ruche affichait « Votre ruche est prête — Démarrer un projet » sur une ruche
// qui pouvait en avoir quarante. Et une coupure en cours de route ne se
// lisait qu'à la pastille « hors ligne », à côté d'un écran figé qui ne le
// disait pas.
//
// La décision vit dans `lireLiaison` (pure, table ci-dessous) ; la coquille
// montée prouve qu'elle est BRANCHÉE : les faits relevés au flux et au
// navigateur arrivent bien jusqu'à elle, et « Réessayer » rappelle le flux.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { FaitsLiaison, Liaison } from '../dashboard/src/Liaison';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectFeed: vi.fn(),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  authMe: vi.fn(() => Promise.reject(new Error('pas de compte simulé'))),
  fetchAtelier: vi.fn(() => Promise.resolve({ mode: 'off', actif: false })),
}));

import { connectFeed } from '../dashboard/src/api';
import type { FeedHandlers } from '../dashboard/src/api';
import { App } from '../dashboard/src/App';
import { lireLiaison } from '../dashboard/src/Liaison';
import { couperLeReseau } from './aide/sans-reseau';
import { laisserFinirLesVuesParesseuses } from './aide/vues-paresseuses';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RELIE: FaitsLiaison = {
  instantaneRecu: true,
  coupeDepuis: null,
  horsReseauDepuis: null,
  jetonRefuse: false,
  tropLent: false,
};

describe('lireLiaison — une décision fermée, à partir des faits', () => {
  const cas: [string, Partial<FaitsLiaison>, Liaison][] = [
    [
      'rien reçu, rien échoué : squelette, pas un état vide',
      { instantaneRecu: false },
      { affichage: 'squelette' },
    ],
    [
      'rien reçu, flux tombé : panne de la ruche',
      { instantaneRecu: false, coupeDepuis: 10 },
      { affichage: 'panne', cause: 'ruche' },
    ],
    [
      'rien reçu, appareil sans réseau : panne du réseau, pas de la ruche',
      { instantaneRecu: false, coupeDepuis: 10, horsReseauDepuis: 5 },
      { affichage: 'panne', cause: 'reseau' },
    ],
    [
      'rien reçu, jeton refusé : la cause est le jeton',
      { instantaneRecu: false, coupeDepuis: 10, jetonRefuse: true },
      { affichage: 'panne', cause: 'jeton' },
    ],
    ['relié : la vue, sans bandeau', {}, { affichage: 'vue', bandeau: null }],
    [
      'reçu puis coupé : la vue ET le bandeau, daté de la coupure',
      { coupeDepuis: 42 },
      { affichage: 'vue', bandeau: { cause: 'ruche', depuis: 42 } },
    ],
    [
      'coupé pour lenteur : la cause le dit',
      { coupeDepuis: 42, tropLent: true },
      { affichage: 'vue', bandeau: { cause: 'trop_lent', depuis: 42 } },
    ],
    [
      'appareil sans réseau : cause réseau, datée de la coupure du flux si elle existe',
      { coupeDepuis: 42, horsReseauDepuis: 40 },
      { affichage: 'vue', bandeau: { cause: 'reseau', depuis: 42 } },
    ],
    [
      'jeton refusé après coup : son propre bandeau suffit, pas de second « hors ligne »',
      { coupeDepuis: 42, jetonRefuse: true },
      { affichage: 'vue', bandeau: null },
    ],
  ];
  it.each(cas)('%s', (_nom, faits, attendu) => {
    expect(lireLiaison({ ...RELIE, ...faits })).toEqual(attendu);
  });
});

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let poignees: FeedHandlers | null = null;
const reconnecter = vi.fn();

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  localStorage.clear();
  location.hash = '';
  poignees = null;
  vi.mocked(connectFeed).mockImplementation((h: FeedHandlers) => {
    poignees = h;
    return { close: () => {}, reconnecter };
  });
});

afterEach(async () => {
  await laisserFinirLesVuesParesseuses();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<App />));
  await act(async () => {});
  return conteneur;
}

const flux = (): FeedHandlers => {
  if (!poignees) throw new Error('le flux n’a pas été branché');
  return poignees;
};

const PROJET = {
  id: 'p-1',
  name: 'Rucher',
  repoUrl: null,
  description: null,
  visibility: 'private',
  ownerId: null,
  createdAt: 1,
};

function boutonDe(el: Element, texte: string): HTMLButtonElement {
  const b = [...el.querySelectorAll('button')].find((x) => (x.textContent ?? '').includes(texte));
  if (!b) throw new Error(`bouton « ${texte} » introuvable`);
  return b;
}

describe('la coquille montée — la liaison se voit', () => {
  it('AVANT LE PREMIER ÉTAT, LA RUCHE NE SE DIT PAS VIDE — puis la vue arrive', async () => {
    const dom = await monter();
    const principal = dom.querySelector('main') as HTMLElement;
    expect(principal.textContent, 'la ruche se dit vide avant d’avoir parlé').not.toContain(
      'Votre ruche est prête',
    );
    expect(
      principal.querySelector('[aria-busy="true"]'),
      'pas de squelette d’attente',
    ).not.toBeNull();
    // L'en-tête non plus : ni « Prête », ni « aucune ouvrière » sur un
    // instantané qui n'est pas arrivé. Inconnu reste inconnu.
    expect(dom.querySelector('.brand-sub')?.textContent).not.toContain('Prête');
    expect(dom.querySelector('[data-testid="mc-ia"]'), 'un voyant d’ouvrières inventé').toBeNull();

    await act(async () =>
      flux().onState({ projects: [], nodes: [], tasks: [], tasksTotal: 0 } as never),
    );
    await laisserFinirLesVuesParesseuses();
    expect(principal.textContent, 'la ruche réellement vide ne le dit plus').toContain(
      'Votre ruche est prête',
    );
  });

  it('LA RUCHE MUETTE DÈS LE DÉPART : une panne, avec « Réessayer » qui rappelle le flux', async () => {
    const dom = await monter();
    await act(async () => flux().onStatus(false, { authError: false }));

    const principal = dom.querySelector('main') as HTMLElement;
    const alerte = principal.querySelector('[role="alert"]');
    expect(alerte?.textContent, 'la panne ne se dit pas').toContain('La ruche ne répond pas');
    expect(principal.textContent).not.toContain('Votre ruche est prête');

    await act(async () => boutonDe(alerte as Element, 'Réessayer').click());
    expect(reconnecter, '« Réessayer » ne rappelle pas la ruche').toHaveBeenCalledTimes(1);
  });

  it('COUPÉE EN COURS DE ROUTE : la vue reste, un bandeau dit « hors ligne » — et part au retour', async () => {
    const dom = await monter();
    await act(async () => {
      flux().onState({ projects: [PROJET], nodes: [], tasks: [], tasksTotal: 0 } as never);
      flux().onStatus(true);
    });
    await laisserFinirLesVuesParesseuses();
    expect(dom.querySelector('.mc-hors-ligne'), 'un bandeau sur une liaison saine').toBeNull();

    await act(async () => flux().onStatus(false, { authError: false }));
    const bandeau = dom.querySelector('.mc-hors-ligne');
    expect(bandeau?.textContent, 'la coupure ne se dit pas').toContain('La ruche ne répond plus');
    expect(dom.querySelector('main')?.textContent, 'la vue a disparu à la coupure').toContain(
      'Rucher',
    );

    await act(async () => boutonDe(bandeau as Element, 'Réessayer maintenant').click());
    expect(reconnecter).toHaveBeenCalledTimes(1);

    await act(async () => flux().onStatus(true));
    expect(dom.querySelector('.mc-hors-ligne'), 'le bandeau survit au retour').toBeNull();
  });

  it('L’APPAREIL SANS RÉSEAU : dit comme tel, sans « Réessayer » inutile ; le retour rappelle la ruche', async () => {
    const dom = await monter();
    await act(async () => {
      flux().onState({ projects: [PROJET], nodes: [], tasks: [], tasksTotal: 0 } as never);
      flux().onStatus(true);
    });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    const bandeau = dom.querySelector('.mc-hors-ligne');
    expect(bandeau?.textContent).toContain('n’a plus de réseau');
    expect(
      [...(bandeau?.querySelectorAll('button') ?? [])].length,
      'un bouton qui échouera à coup sûr',
    ).toBe(0);

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(dom.querySelector('.mc-hors-ligne')).toBeNull();
    expect(reconnecter, 'le retour du réseau n’a pas rappelé la ruche').toHaveBeenCalledTimes(1);
  });
});
