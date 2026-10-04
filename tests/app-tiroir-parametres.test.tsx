// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE TIROIR DE NAVIGATION ET L'ÉCRAN PARAMÈTRES, RENDUS DANS LA VRAIE COQUILLE.
//
// ─── CE QUE CE FICHIER TIENT ─────────────────────────────────────────────────
//
// Sur téléphone, la barre devient un tiroir (styles.css, « LE TIROIR DE
// NAVIGATION ») : c'est un DIALOGUE MODAL tant qu'il est ouvert — focus qui
// entre sur la vue courante, Tab qui boucle, Échap qui ferme et rend le focus
// au ☰, raccourcis de vue suspendus, contenu inerte. Chacun de ces points se
// perd en silence : aucun ne se voit sur une capture.
//
// L'écran Paramètres rassemble ce qui était éparpillé dans la barre : le compte
// (identité, session, déconnexion), l'apparence, le jeton de ruche (masqué,
// même clé `hive.token`), le guide du premier cycle et le connecteur GitHub.
// Chaque entrée mène à une vue qui EXISTE, ou n'est pas rendue.
//
// La coquille se monte pour de vrai ; seuls le flux WebSocket et les sondes
// REST sont simulés (même banc que `app-coquille.test.tsx`).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLang, setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectFeed: vi.fn(() => ({ close: () => {} })),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  authMe: vi.fn(() => Promise.reject(new Error('pas de compte simulé'))),
  fetchMonTableau: vi.fn(() => Promise.resolve(null)),
  fetchWarRoom: vi.fn(() => Promise.resolve({ desaccords: [], fil: [] })),
  fetchEssaim: vi.fn(() => Promise.reject(new Error('hors banc'))),
  fetchAtelier: vi.fn(() => Promise.resolve({ mode: 'off', actif: false })),
  fetchStatutGithub: vi.fn(() => Promise.resolve({ configure: false })),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
}));

import { authMe, connectFeed, getToken } from '../dashboard/src/api';
import type { AuthUser, FeedHandlers } from '../dashboard/src/api';
import { App } from '../dashboard/src/App';
import { laisserFinirLesVuesParesseuses } from './aide/vues-paresseuses';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
let poignees: FeedHandlers | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  localStorage.clear();
  location.hash = '';
  poignees = null;
  vi.mocked(connectFeed).mockImplementation((h: FeedHandlers) => {
    poignees = h;
    return { close: () => {} };
  });
  vi.mocked(authMe).mockImplementation(() => Promise.reject(new Error('pas de compte simulé')));
});
afterEach(async () => {
  await laisserFinirLesVuesParesseuses();
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
  await act(async () => {});
  await act(async () => {});
  return conteneur;
}

async function aller(hash: string): Promise<void> {
  await act(async () => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await laisserFinirLesVuesParesseuses();
  await act(async () => {});
}

async function frapper(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
  await act(async () => {});
}

async function cliquer(el: Element | null | undefined): Promise<void> {
  expect(el, 'élément à cliquer introuvable').toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await act(async () => {});
}

/** Saisie dans un champ contrôlé par React (le setter natif, puis `input`). */
function saisir(champ: HTMLInputElement | HTMLSelectElement, valeur: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(champ) as object,
      'value',
    )?.set;
    setter?.call(champ, valeur);
    champ.dispatchEvent(
      new Event(champ instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

const barre = (dom: HTMLElement) => dom.querySelector('#mc-navigation') as HTMLElement;
const burger = (dom: HTMLElement) =>
  dom.querySelector('[data-testid="mc-burger"]') as HTMLButtonElement;
const ecran = (): string => location.hash.replace(/^#\/?/, '');
const boutonTexte = (dom: ParentNode, texte: string) =>
  [...dom.querySelectorAll('button')].find((b) => b.textContent?.trim() === texte);

/** Un JWT au format de `signJwt` (src/orchestrator/auth.ts) — la signature n'est pas lue. */
function jwtAvec(charge: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(charge)}.signature`;
}

const REINE: AuthUser = { id: 'u1', email: 'reine@ruche.test', displayName: 'Reine Banc' };

describe('le tiroir de navigation — un dialogue modal tant qu’il est ouvert', () => {
  it('FERMÉ, LA BARRE EST UNE NAVIGATION ORDINAIRE — et le ☰ le dit', async () => {
    const dom = await monter();
    expect(barre(dom).tagName).toBe('NAV');
    expect(barre(dom).getAttribute('role')).toBeNull();
    expect(barre(dom).getAttribute('aria-modal')).toBeNull();
    expect(burger(dom).getAttribute('aria-expanded')).toBe('false');
    expect(burger(dom).getAttribute('aria-controls')).toBe('mc-navigation');
    expect(dom.querySelector('.mc-body')?.hasAttribute('inert')).toBe(false);
  });

  it('OUVERT : DIALOGUE MODAL, FOCUS SUR LA VUE COURANTE, CONTENU INERTE', async () => {
    const dom = await monter();
    await aller('#/projets');
    burger(dom).focus();
    await cliquer(burger(dom));

    expect(barre(dom).getAttribute('role')).toBe('dialog');
    expect(barre(dom).getAttribute('aria-modal')).toBe('true');
    expect(burger(dom).getAttribute('aria-expanded')).toBe('true');
    expect(
      (document.activeElement as HTMLElement | null)?.getAttribute('data-vue'),
      'le focus entre sur la case de la vue où l’on est',
    ).toBe('projets');
    expect(dom.querySelector('.mc-body')?.hasAttribute('inert')).toBe(true);
    expect(dom.querySelector('.mc-tiroir-voile')).toBeTruthy();
  });

  it('ÉCHAP FERME ET REND LE FOCUS AU ☰', async () => {
    const dom = await monter();
    burger(dom).focus();
    await cliquer(burger(dom));
    await frapper({ key: 'Escape' });

    expect(barre(dom).getAttribute('role')).toBeNull();
    expect(burger(dom).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement, 'le focus revient au bouton qui a ouvert').toBe(burger(dom));
  });

  it('TAB BOUCLE DANS LE TIROIR — il ne s’échappe pas vers la page inerte', async () => {
    const dom = await monter();
    await cliquer(burger(dom));
    const cases = [...barre(dom).querySelectorAll<HTMLElement>('.mc-nav-cell')];
    expect(cases.at(-1)?.getAttribute('data-vue'), 'Paramètres ferme les cases').toBe('parametres');
    // Le dernier arrêt n'est pas une case : le compagnon habite la barre, sous
    // les Paramètres, et son bouton (ses réglages) se tabule aussi.
    const dernier = [...barre(dom).querySelectorAll<HTMLElement>('button')].at(-1)!;
    expect(
      dernier.closest('[data-testid="compagnon"]'),
      'le compagnon ferme la barre',
    ).toBeTruthy();
    dernier.focus();
    await frapper({ key: 'Tab' });
    expect(document.activeElement, 'Tab depuis le dernier arrêt repart de la première case').toBe(
      cases[0],
    );
    await frapper({ key: 'Tab', shiftKey: true });
    expect(document.activeElement, 'Maj+Tab depuis la première case repart du dernier').toBe(
      dernier,
    );
  });

  it('UNE CASE CHOISIE NAVIGUE ET REFERME LE TIROIR', async () => {
    const dom = await monter();
    await cliquer(burger(dom));
    await cliquer(barre(dom).querySelector('[data-vue="chronique"]'));
    await aller(location.hash);
    expect(ecran()).toBe('chronique');
    expect(barre(dom).getAttribute('role'), 'arrivé, le tiroir se referme').toBeNull();
  });

  it('LA CASE DE LA VUE OÙ L’ON EST REFERME AUSSI — le hash ne change pas', async () => {
    const dom = await monter();
    await aller('#/chronique');
    await cliquer(burger(dom));
    await cliquer(barre(dom).querySelector('[data-vue="chronique"]'));
    expect(barre(dom).getAttribute('role'), 'le tiroir est resté ouvert').toBeNull();
    expect(dom.querySelector('.mc-body')?.hasAttribute('inert')).toBe(false);
  });

  it('REVENU AU-DESSUS DE 560 PX, LE TIROIR SE REFERME — la page n’est plus inerte', async () => {
    // Une rotation ou une fenêtre élargie : le rail redevient ordinaire à
    // l'écran, et un tiroir resté « ouvert » garderait le focus piégé dans une
    // barre qui n'a plus l'air d'un dialogue, sur une page inerte.
    const ecouteurs = new Set<() => void>();
    const requete = {
      matches: true,
      addEventListener: (_: string, f: () => void) => ecouteurs.add(f),
      removeEventListener: (_: string, f: () => void) => ecouteurs.delete(f),
    };
    const matchMedia = vi
      .spyOn(window, 'matchMedia')
      .mockImplementation(() => requete as unknown as MediaQueryList);
    try {
      const dom = await monter();
      await cliquer(burger(dom));
      expect(barre(dom).getAttribute('role')).toBe('dialog');
      expect(ecouteurs.size, 'la coquille écoute la borne du tiroir').toBeGreaterThan(0);

      requete.matches = false;
      await act(async () => ecouteurs.forEach((f) => f()));

      expect(barre(dom).getAttribute('role')).toBeNull();
      expect(barre(dom).getAttribute('aria-modal')).toBeNull();
      expect(burger(dom).getAttribute('aria-expanded')).toBe('false');
      expect(dom.querySelector('.mc-body')?.hasAttribute('inert')).toBe(false);
    } finally {
      matchMedia.mockRestore();
    }
  });

  it('TIROIR OUVERT, LES RACCOURCIS DE VUE SE TAISENT', async () => {
    const dom = await monter();
    await cliquer(burger(dom));
    await frapper({ key: '4', code: 'Digit4' });
    expect(ecran(), 'une touche a changé d’écran sous le tiroir').toBe('');
  });
});

describe('l’écran Paramètres — les réglages de la personne, distincts de l’Intendance', () => {
  it('SA CASE EST AU PIED DE LA BARRE, POUR TOUS — et « p » y mène', async () => {
    const dom = await monter();
    expect(dom.querySelector('.mc-nav-pied [data-vue="parametres"]'), 'case au pied').toBeTruthy();
    // Sans compte : ce n'est pas une vue d'administration.
    expect(dom.querySelector('[data-vue="intendance"]')).toBeNull();
    await frapper({ key: 'p', code: 'KeyP' });
    expect(ecran()).toBe('parametres');
    await aller('#/parametres');
    expect(dom.querySelector('.pa-view'), 'la vue Paramètres est rendue sur sa route').toBeTruthy();
    expect(dom.querySelector('h1')?.textContent).toBe('Paramètres');
  });

  it('LE JETON EST MASQUÉ, SE POSE À LA VALIDATION ET RECONNECTE LE FLUX', async () => {
    const dom = await monter();
    await aller('#/parametres');
    const champ = dom.querySelector('.pa-view input[type="password"]') as HTMLInputElement;
    expect(champ, 'le jeton se saisit masqué').toBeTruthy();
    expect(champ.value).toBe(getToken());
    // Un libellé réel, relié : `HIVE_TOKEN`, le nom que l'installeur affiche.
    expect(dom.querySelector(`label[for="${champ.id}"]`)?.textContent).toContain('HIVE_TOKEN');

    const branchements = vi.mocked(connectFeed).mock.calls.length;
    saisir(champ, 'jeton-de-parametres-assez-long');
    expect(getToken(), 'une frappe ne pose rien').not.toBe('jeton-de-parametres-assez-long');
    await act(async () => {
      champ.form?.requestSubmit();
    });
    expect(localStorage.getItem('hive.token')).toBe('jeton-de-parametres-assez-long');
    expect(vi.mocked(connectFeed).mock.calls.length, 'le flux repart avec le jeton').toBe(
      branchements + 1,
    );
  });

  it('UNE VALEUR EN COURS DE FRAPPE N’EST JAMAIS DITE « acceptée » — et quitter le champ l’enregistre', async () => {
    const dom = await monter();
    await act(async () => poignees?.onStatus(true));
    await aller('#/parametres');
    const champ = dom.querySelector('.pa-view input[type="password"]') as HTMLInputElement;
    const etat = () => dom.querySelector('[data-testid="pa-etat-jeton"]')?.textContent ?? '';

    saisir(champ, 'une-valeur-jamais-essayee');
    expect(etat(), 'le flux ouvert parle de l’ANCIEN jeton').not.toContain('accepte');
    expect(etat()).toContain('Pas encore enregistré');

    await act(async () => {
      champ.focus();
      champ.blur();
    });
    expect(localStorage.getItem('hive.token'), 'quitter le champ enregistre').toBe(
      'une-valeur-jamais-essayee',
    );
    expect(etat()).not.toContain('Pas encore enregistré');
  });

  it('UN JETON REFUSÉ SE DIT SUR LE CHAMP — et le bandeau mène aux Paramètres', async () => {
    const dom = await monter();
    await act(async () => poignees?.onStatus(false, { authError: true }));
    await cliquer(boutonTexte(dom, 'Saisir le jeton dans Paramètres'));
    await aller(location.hash);
    expect(ecran()).toBe('parametres');
    const champ = dom.querySelector('.pa-view input[type="password"]') as HTMLInputElement;
    expect(champ.getAttribute('aria-invalid')).toBe('true');
    const erreur = document.getElementById(`${champ.id}-erreur`);
    expect(erreur?.textContent).toContain('refusé');
  });

  it('SANS COMPTE : « Se connecter » ouvre la fenêtre de compte', async () => {
    const dom = await monter();
    await aller('#/parametres');
    expect(dom.querySelector('[data-testid="pa-nom"]')).toBeNull();
    await cliquer(boutonTexte(dom, 'Se connecter ou créer un compte'));
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
  });

  it('AVEC COMPTE : identité, session lue du jeton, déconnexion qui vide le JWT', async () => {
    const iat = Date.UTC(2026, 8, 1, 10, 0) / 1000;
    localStorage.setItem('hive.jwt', jwtAvec({ sub: 'u1', iat, exp: iat + 7 * 86_400 }));
    vi.mocked(authMe).mockImplementation(() => Promise.resolve(REINE));
    const dom = await monter();
    await aller('#/parametres');

    expect(dom.querySelector('[data-testid="pa-nom"]')?.textContent).toBe('Reine Banc');
    const session = dom.querySelector('[data-testid="pa-session"]')?.textContent ?? '';
    expect(session).toContain('ouverte le');
    expect(session).toContain('expire le');
    expect(session).toContain('2026');
    // Pas administratrice : ni rôle inventé, ni lien vers l'Intendance.
    expect(dom.querySelector('.pa-view')?.textContent).toContain('Membre');
    expect(boutonTexte(dom, 'Ouvrir l’Intendance')).toBeUndefined();

    await cliquer(boutonTexte(dom, 'Se déconnecter'));
    expect(localStorage.getItem('hive.jwt')).toBeNull();
    expect(dom.querySelector('.mc-account-name'), 'la barre ne montre plus le nom').toBeNull();
    expect(boutonTexte(dom, 'Se connecter ou créer un compte')).toBeTruthy();
  });

  it('UN JETON DE SESSION ILLISIBLE DONNE « échéance inconnue » — jamais une date inventée', async () => {
    localStorage.setItem('hive.jwt', 'pas.un-jwt');
    vi.mocked(authMe).mockImplementation(() => Promise.resolve({ ...REINE, role: 'admin' }));
    const dom = await monter();
    await aller('#/parametres');
    expect(dom.querySelector('[data-testid="pa-session"]')?.textContent).toBe('échéance inconnue');
    // Administratrice : l'entrée vers l'Intendance existe, et y mène.
    await cliquer(boutonTexte(dom, 'Ouvrir l’Intendance'));
    expect(ecran()).toBe('intendance');
  });

  it('APPARENCE : le thème et la langue se choisissent ici', async () => {
    const dom = await monter();
    await aller('#/parametres');
    const sombre = dom.querySelector('input[name="pa-theme"][value="sombre"]') as HTMLInputElement;
    await cliquer(sombre);
    expect(localStorage.getItem('hive.theme')).toBe('sombre');
    expect(document.documentElement.dataset.theme).toBe('dark');

    const langue = dom.querySelector('.pa-view select') as HTMLSelectElement;
    saisir(langue, 'en');
    await act(async () => {});
    expect(getLang()).toBe('en');
    expect(dom.querySelector('h1')?.textContent).toBe('Settings');
    // Remis pour les cas suivants du fichier.
    await cliquer(dom.querySelector('input[name="pa-theme"][value="systeme"]'));
  });

  it('SANS PROJET, « Premiers pas » propose d’en démarrer un — le seul départ qui existe', async () => {
    const dom = await monter();
    await aller('#/parametres');
    expect(boutonTexte(dom, 'Réafficher le guide du premier cycle')).toBeUndefined();
    await cliquer(boutonTexte(dom, 'Démarrer un projet'));
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
  });

  it('AVEC UN PROJET, LE GUIDE MASQUÉ REVIENT ET L’ON ARRIVE SUR PROJETS', async () => {
    const dom = await monter();
    await act(async () =>
      poignees?.onState({
        projects: [{ id: 'p1', name: 'Banc', createdAt: 1 } as never],
        nodes: [],
        tasks: [],
        tasksTotal: 0,
      }),
    );
    localStorage.setItem('hive.guide.masques', JSON.stringify(['p1']));
    await aller('#/parametres');
    await cliquer(boutonTexte(dom, 'Réafficher le guide du premier cycle'));
    expect(localStorage.getItem('hive.guide.masques')).toBeNull();
    expect(ecran()).toBe('projets');
  });

  it('LE CONNECTEUR GITHUB MÈNE AUX PROJETS — où le connecteur est rendu', async () => {
    const dom = await monter();
    await aller('#/parametres');
    await cliquer(boutonTexte(dom, 'Ouvrir le connecteur GitHub'));
    await aller(location.hash);
    expect(ecran()).toBe('projets');
    expect(dom.textContent, 'la cible du lien n’est pas une vue vide').toContain('GitHub');
  });
});
