/// <reference lib="dom" />
//
// LA SESSION QUI EXPIRE PENDANT QUE L'ONGLET VIT — rendue, contre une vraie Reine.
//
// ─── LE DÉFAUT QUE CE BANC TIENT ─────────────────────────────────────────────
//
// Un JWT dure sept jours ; un onglet de tableau de bord, bien plus. Passé
// l'échéance, la Reine traite le JWT comme absent — et l'écran, lui, ne
// l'apprenait jamais. `App` ne vérifiait la session qu'au montage : ensuite la
// barre gardait le nom de la personne, « + Projet » répondait « Non
// authentifié », et chaque engagement sur SON projet rendait « 404 projet
// inconnu ». Rien ne disait « reconnectez-vous ».
//
// Ce banc joue la scène entière, sans rien simuler de ce qui décide :
//
//   · une VRAIE Reine (`createServer`, port 0) émet le JWT à la connexion ;
//   · les VRAIES fonctions de `api.ts` lui parlent — seul le flux WebSocket est
//     coupé, il ne porte pas le compte ;
//   · l'`App` est montée pour de vrai, et on clique comme une personne.
//
// L'expiration est obtenue en avançant l'HORLOGE (`Date` seule), pas en
// fabriquant un faux jeton : c'est le jeton que la Reine a réellement émis qui
// meurt, au moment où la Reine le juge — exactement ce qui arrive à un onglet
// resté ouvert une semaine.
//
// ─── POURQUOI L'ENVIRONNEMENT `node`, ET UNE FENÊTRE happy-dom POSÉE À LA MAIN ─
//
// Dans l’environnement de test « happy-dom », la Reine ne se charge même pas.
// Vite y transforme les modules pour le NAVIGATEUR, et réécrit donc
// `new URL('../..', import.meta.url)` — la façon dont `server.ts` situe sa
// racine — en `http://localhost:3000/@fs/…`, que `fileURLToPath` refuse
// (« The URL must be of scheme file »). Mesuré, pas supposé : rendre à
// `globalThis` l'`URL` de Node n'y change rien, la réécriture est dans le code
// transformé ; sous Node, la même ligne rend bien `file:///…`, fenêtre prêtée
// ou non.
//
// On reste donc sous Node, où la Reine est ce qu'elle est en production, et on
// prête à l'écran une fenêtre happy-dom : `document`, `window`, le stockage,
// les évènements — AVANT les imports, parce que `react-dom` et `i18n.ts`
// regardent le DOM dès leur chargement.
//
// Et `fetch` reste celui de Node : en production l'écran est servi PAR la
// Reine, donc `/api/…` est de même origine ; ici on lui recolle seulement le
// préfixe d'origine, comme `dashboard-contrat-compte.test.tsx`.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

// ─── LA FENÊTRE, AVANT LE PREMIER IMPORT DE L'ÉCRAN ──────────────────────────
//
// `vi.hoisted` passe avant les imports : c'est sa seule raison d'être ici.
// Seuls les noms que l'écran touche sont prêtés — jamais `URL` ni `fetch`, qui
// restent ceux de Node pour la Reine (le `fetch` de l'écran est posé plus bas).
const fenetre = await vi.hoisted(async () => {
  const { Window } = await import('happy-dom');
  const w = new Window({ url: 'http://127.0.0.1/' });
  const pretes = [
    'window',
    'document',
    'navigator',
    'location',
    'history',
    'localStorage',
    'sessionStorage',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'matchMedia',
    'MutationObserver',
    'ResizeObserver',
    'IntersectionObserver',
    'Node',
    'Text',
    'Element',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLButtonElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'HTMLIFrameElement',
    'SVGElement',
    'DocumentFragment',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'FocusEvent',
    'InputEvent',
    'StorageEvent',
  ] as const;
  for (const nom of pretes) {
    vi.stubGlobal(nom, (w as unknown as Record<string, unknown>)[nom]);
  }
  return w;
});

/** Les rappels que l'`App` a confiés au flux — pour jouer une reconnexion. */
const flux = vi.hoisted(() => ({ rappels: null as FeedHandlers | null }));

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Le flux temps réel ne porte que le jeton de ruche : il n'a rien à dire de
  // la session, et un vrai WebSocket survivrait au banc. On garde ses rappels :
  // une reconnexion est un moment où l'écran redemande la session.
  connectFeed: vi.fn((rappels: FeedHandlers) => {
    flux.rappels = rappels;
    return { close: () => {} };
  }),
}));

import {
  authLogin,
  authRegister,
  createProject,
  getJwt,
  saveJwt,
  saveToken,
} from '../dashboard/src/api';
import type { FeedHandlers } from '../dashboard/src/api';
import { App } from '../dashboard/src/App';
import { setLang } from '../dashboard/src/i18n';
import { laisserFinirLesVuesParesseuses } from './aide/vues-paresseuses';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = 'jeton-session-expiree-assez-long';
const EMAIL = 'proprietaire@ruche.test';
const MOT_DE_PASSE = 'motdepasse-assez-long-42';
/** Au-delà des sept jours d'un JWT (`JWT_EXPIRY_MS`, `src/orchestrator/auth.ts`). */
const HUIT_JOURS = 8 * 24 * 60 * 60 * 1000;

/** Ce que l'écran a envoyé à la Reine, dans l'ordre. */
interface Envoi {
  methode: string;
  chemin: string;
}

describe('une session qui expire pendant que l’onglet vit — l’écran le dit', () => {
  let server: HiveServer;
  let dir: string;
  let proprietaireId = '';
  const envois: Envoi[] = [];
  /** Les routes que la « Reine » ne sert pas, le temps d'un test : une panne. */
  const muettes = new Set<string>();
  /** Les refus de ces pannes, une fois réglés : de quoi attendre leur fin, pas une horloge. */
  const pannes: Promise<unknown>[] = [];
  let racine: Root | null = null;
  let conteneur: HTMLElement | null = null;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-session-expiree-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      // Aucun tour d'ordonnanceur ne doit venir brouiller le scénario.
      tickMs: 60_000,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const fetchNatif = globalThis.fetch;
    vi.stubGlobal('fetch', (entree: string | URL | Request, init?: RequestInit) => {
      if (typeof entree === 'string' && entree.startsWith('/api/')) {
        envois.push({ methode: init?.method ?? 'GET', chemin: entree });
        if (muettes.has(entree)) {
          const panne = Promise.reject(new TypeError('Failed to fetch'));
          pannes.push(panne.catch(() => undefined));
          return panne;
        }
        return fetchNatif(`${base}${entree}`, init);
      }
      return Promise.reject(new Error(`fetch hors de la Reine : ${String(entree)}`));
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await laisserFinirLesVuesParesseuses();
    act(() => racine?.unmount());
    conteneur?.remove();
    racine = null;
    conteneur = null;
    location.hash = '';
    localStorage.clear();
    muettes.clear();
    pannes.length = 0;
    flux.rappels = null;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await server.stop();
    await fenetre.happyDOM.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  /** Scrute l'écran jusqu'à ce que `condition` tienne — borné, jamais une attente aveugle. */
  const attendre = async (condition: () => boolean, quoi: string): Promise<void> => {
    for (let i = 0; i < 250 && !condition(); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    expect(condition(), `jamais vu : ${quoi}\n${document.body.textContent ?? ''}`).toBe(true);
  };

  const cliquer = (el: Element): void => {
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  /** Tape dans un champ contrôlé comme un humain : la valeur PUIS l'évènement. */
  const saisir = (champ: HTMLInputElement, valeur: string): void => {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(champ, valeur);
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const bouton = (dans: ParentNode, texte: string): HTMLButtonElement => {
    const b = [...dans.querySelectorAll('button')].find((x) =>
      (x.textContent ?? '').includes(texte),
    );
    if (!b) throw new Error(`aucun bouton « ${texte} » dans :\n${document.body.innerHTML}`);
    return b;
  };

  const dialogue = (titre: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((d) =>
      (d.querySelector('h2')?.textContent ?? '').includes(titre),
    );

  const nomAffiche = (): string | null =>
    document.querySelector('.mc-account-name')?.textContent ?? null;

  const bandeau = (): HTMLElement | null => document.querySelector('.mc-session-banner');

  /** Un compte neuf, connecté par l'écran : son JWT est rangé. */
  const ouvrirSession = async (email: string, nom: string): Promise<void> => {
    setLang('fr');
    saveToken(TOKEN);
    await authRegister(email, MOT_DE_PASSE, nom);
    saveJwt((await authLogin(email, MOT_DE_PASSE)).token);
  };

  /** L'`App`, montée pour de vrai sur la vue `hash`. */
  const monter = async (hash: string): Promise<void> => {
    location.hash = hash;
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => racine?.render(<App />));
  };

  /** « + Projet », un nom, « Lancer » — et rend la fenêtre, restée ouverte. */
  const lancerUnProjet = (nom: string): HTMLElement => {
    cliquer(bouton(document, '+ Projet'));
    const f = dialogue('Nouveau projet');
    if (!f) throw new Error('la fenêtre « Nouveau projet » ne s’est pas ouverte');
    saisir(f.querySelector('input[type="text"]') as HTMLInputElement, nom);
    cliquer(bouton(f, 'Lancer le butinage'));
    return f;
  };

  it('LA SESSION MORTE EST DITE, AUCUN PROJET ORPHELIN NE NAÎT, ET LA RECONNEXION RAMÈNE À LA VUE', async () => {
    setLang('fr');
    saveToken(TOKEN);
    // Le compte, et son projet, créés par l'écran comme une personne le ferait.
    await authRegister(EMAIL, MOT_DE_PASSE, 'Propriétaire');
    const { token } = await authLogin(EMAIL, MOT_DE_PASSE);
    saveJwt(token);
    const projet = await createProject({ name: 'Projet du propriétaire' });
    proprietaireId = projet.ownerId ?? '';
    expect(proprietaireId, 'prémisse : le projet appartient au compte').not.toBe('');

    // L'onglet ouvert sur SON projet, session vivante : le nom est affiché.
    location.hash = `#/projets/${projet.id}`;
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => racine?.render(<App />));
    await attendre(() => nomAffiche() === 'Propriétaire', 'le nom du compte dans la barre');

    // ─── UNE SEMAINE PASSE. L'onglet, lui, est toujours là. ─────────────────
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + HUIT_JOURS);
    const projetsAvant = server.store.listProjects().length;

    // Le geste le plus courant du produit : « + Projet », un nom, « Lancer ».
    cliquer(bouton(document, '+ Projet'));
    const fenetre = dialogue('Nouveau projet');
    if (!fenetre) throw new Error('la fenêtre « Nouveau projet » ne s’est pas ouverte');
    saisir(fenetre.querySelector('input[type="text"]') as HTMLInputElement, 'Projet de trop');
    cliquer(bouton(fenetre, 'Lancer le butinage'));

    // ─── CE QUE LA PERSONNE VOIT ────────────────────────────────────────────
    await attendre(() => bandeau() !== null, 'le bandeau « Session expirée »');
    expect(bandeau()?.getAttribute('role'), 'le bandeau est annoncé').toBe('alert');
    expect(bandeau()?.textContent).toContain('Session expirée — reconnectez-vous.');
    // Le geste qui a échoué dit POURQUOI, au lieu de « Non authentifié ».
    expect(fenetre.querySelector('.modal-error')?.textContent).toBe(
      'Session expirée — reconnectez-vous',
    );
    // La barre ne ment plus : plus de nom, la porte de connexion est ouverte.
    expect(nomAffiche(), 'la barre affiche encore un compte mort').toBeNull();
    const connexion = dialogue('Connexion');
    expect(connexion, 'la fenêtre de connexion s’ouvre d’elle-même').toBeDefined();
    expect(connexion?.querySelector('.modal-note')?.textContent).toContain('Session expirée');
    expect(localStorage.getItem('hive.jwt'), 'le JWT mort est purgé').toBeNull();

    // ─── ET RIEN N'EST REJOUÉ SANS LE COMPTE ────────────────────────────────
    //
    // Le JWT est purgé : sans garde, le MÊME bouton, dans la MÊME fenêtre
    // encore ouverte, prendrait la porte du jeton de ruche et ferait naître
    // un projet orphelin que la personne croirait à elle.
    const envoisAvantRejeu = envois.length;
    cliquer(bouton(fenetre, 'Lancer le butinage'));
    await attendre(
      () => !(fenetre.querySelector('button.btn.primary') as HTMLButtonElement).disabled,
      'la fin du second essai',
    );
    expect(fenetre.querySelector('.modal-error')?.textContent).toBe(
      'Session expirée — reconnectez-vous',
    );
    expect(
      envois.slice(envoisAvantRejeu).filter((e) => e.methode === 'POST'),
      'un geste est parti vers la Reine sans le compte',
    ).toEqual([]);
    expect(server.store.listProjects(), 'un projet est né pendant l’expiration').toHaveLength(
      projetsAvant,
    );
    expect(
      envois.some((e) => e.methode === 'POST' && e.chemin === '/api/projects'),
      'la porte du jeton de ruche a été prise',
    ).toBe(false);

    // ─── LA PERSONNE S'ÉLOIGNE, PUIS SE RECONNECTE ──────────────────────────
    cliquer(bouton(connexion as HTMLElement, 'Annuler'));
    cliquer(bouton(fenetre, 'Annuler'));
    location.hash = '#/sante';
    await attendre(() => location.hash === '#/sante', 'le départ vers la Santé');

    cliquer(bouton(bandeau() as HTMLElement, 'Se reconnecter'));
    const retour = dialogue('Connexion');
    if (!retour) throw new Error('« Se reconnecter » n’ouvre pas la fenêtre de connexion');
    saisir(retour.querySelector('input[type="email"]') as HTMLInputElement, EMAIL);
    saisir(retour.querySelector('input[type="password"]') as HTMLInputElement, MOT_DE_PASSE);
    cliquer(retour.querySelector('button.btn.primary') as HTMLButtonElement);

    await attendre(() => nomAffiche() === 'Propriétaire', 'le nom, après reconnexion');
    expect(location.hash, 'la reconnexion ramène à la vue où la session est morte').toBe(
      `#/projets/${projet.id}`,
    );
    expect(bandeau(), 'le bandeau survit à la reconnexion').toBeNull();

    // Le geste refait par la personne aboutit — et le projet est bien À ELLE.
    const nouveau = await createProject({ name: 'Projet refait après reconnexion' });
    expect(nouveau.ownerId).toBe(proprietaireId);
  });

  // ─── DEUX ONGLETS, UN SEUL STOCKAGE ────────────────────────────────────────
  //
  // Le JWT vit dans `localStorage`, commun aux onglets. Première version :
  // l'onglet A constatait l'expiration et purgeait ce JWT commun, mais la garde
  // anti-orphelin était une variable de SON module. L'onglet B — nom toujours
  // affiché, aucun bandeau — prenait alors la porte du jeton de ruche au
  // premier « + Projet » : un projet orphelin, créé en silence. Un banc ne
  // monte qu'une copie du module ; l'autre onglet est donc joué par ce qu'il
  // laisse DANS LE STOCKAGE (le JWT purgé, la marque posée), puis par les
  // évènements `storage` que le navigateur délivre aux onglets voisins.
  it('UN AUTRE ONGLET A VU LA SESSION MOURIR — celui-ci ne crée rien sans compte, et le dit', async () => {
    await ouvrirSession('deux-onglets@ruche.test', 'Deux Onglets');
    await monter('#/projets');
    await attendre(() => nomAffiche() === 'Deux Onglets', 'le nom du compte dans la barre');
    const projetsAvant = server.store.listProjects().length;

    // L'onglet A conclut à l'expiration. Ses évènements ne sont pas encore
    // arrivés ici : la garde doit tenir PAR LE STOCKAGE, au moment du clic.
    localStorage.removeItem('hive.jwt');
    localStorage.setItem('hive.jwt.expiree', '1');
    const envoisAvant = envois.length;
    const fenetre = lancerUnProjet('Projet de l’onglet B');
    await attendre(
      () => (fenetre.querySelector('.modal-error')?.textContent ?? '') !== '',
      'le refus du geste',
    );
    expect(fenetre.querySelector('.modal-error')?.textContent).toBe(
      'Session expirée — reconnectez-vous',
    );
    expect(
      envois.slice(envoisAvant).filter((e) => e.methode === 'POST'),
      'un geste est parti sans le compte',
    ).toEqual([]);
    expect(server.store.listProjects(), 'un projet orphelin est né').toHaveLength(projetsAvant);

    // Les évènements de l'onglet A arrivent : la barre et le bandeau suivent.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'hive.jwt', newValue: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'hive.jwt.expiree', newValue: '1' }));
    });
    await attendre(() => bandeau() !== null, 'le bandeau « Session expirée »');
    expect(nomAffiche(), 'la barre affiche encore un compte mort').toBeNull();
  });

  // L'onglet A lève la marque — « Continuer sans compte », puis une
  // reconnexion. La garde tombe ICI aussi (elle lit le stockage commun) : le
  // bandeau qui l'annonce doit tomber avec elle, sans quoi il affirmerait
  // « aucun n'est rejoué sans compte » au-dessus d'un « + Projet » qui part
  // au jeton de ruche. Et la fenêtre ouverte par l'expiration ne doit pas
  // resurgir d'elle-même au clic suivant sur « Déconnexion ».
  it('L’AUTRE ONGLET LÈVE LA MARQUE — le bandeau tombe avec la garde, la fenêtre ne resurgit pas', async () => {
    const email = 'marque-levee@ruche.test';
    await ouvrirSession(email, 'Marque Levée');
    await monter('#/projets');
    await attendre(() => nomAffiche() === 'Marque Levée', 'le nom du compte dans la barre');

    // L'onglet A constate l'expiration.
    localStorage.removeItem('hive.jwt');
    localStorage.setItem('hive.jwt.expiree', '1');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'hive.jwt', newValue: null }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'hive.jwt.expiree', newValue: '1' }));
    });
    await attendre(() => bandeau() !== null, 'le bandeau « Session expirée »');
    const connexion = dialogue('Connexion');
    if (!connexion) throw new Error('l’expiration n’a pas ouvert la fenêtre de connexion');

    // L'onglet A choisit « Continuer sans compte » : la marque est levée.
    localStorage.removeItem('hive.jwt.expiree');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'hive.jwt.expiree', newValue: null }),
      );
    });
    await attendre(() => bandeau() === null, 'la chute du bandeau, la garde levée ailleurs');

    // Puis l'onglet A se reconnecte : le nom revient ici.
    const { token } = await authLogin(email, MOT_DE_PASSE);
    saveJwt(token);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'hive.jwt', newValue: token }));
    });
    await attendre(() => nomAffiche() === 'Marque Levée', 'le nom, reconnecté ailleurs');
    expect(dialogue('Connexion'), 'la fenêtre survit sous un compte connecté').toBeUndefined();

    // « Déconnexion » ici : la barre rend « Se connecter », sans fenêtre surgie.
    cliquer(bouton(document, 'Déconnexion'));
    await attendre(() => nomAffiche() === null, 'la déconnexion');
    expect(dialogue('Connexion'), 'la fenêtre de connexion a surgi d’elle-même').toBeUndefined();
  });

  it('UN JWT MORT DEPUIS LA DERNIÈRE VISITE — le bandeau dès l’ouverture', async () => {
    await ouvrirSession('retour-de-vacances@ruche.test', 'Retour');
    // L'onglet est rouvert neuf jours plus tard : c'est la restauration du
    // montage qui découvre la mort, et elle doit trouver l'écran abonné.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + HUIT_JOURS);
    await monter('#/sante');
    await attendre(() => bandeau() !== null, 'le bandeau « Session expirée »');
    expect(nomAffiche()).toBeNull();
    expect(getJwt(), 'le JWT mort est purgé').toBeNull();
    expect(dialogue('Connexion'), 'la fenêtre de connexion s’ouvre').toBeDefined();
  });

  it('UNE REINE INJOIGNABLE AU MONTAGE NE DÉCONNECTE PERSONNE — et le nom revient avec elle', async () => {
    await ouvrirSession('reine-muette@ruche.test', 'Patiente');
    const jwt = getJwt();
    muettes.add('/api/auth/me');
    await monter('#/ruche');
    await attendre(() => pannes.length > 0, 'la question posée au montage');
    // La panne réglée, tout ce qui en découle (`api()`, `authMe`, le `catch`
    // de `demanderSession`) n'est que microtâches, sans réseau ni minuterie :
    // elles sont TOUTES vidées avant la tâche suivante. Une purge qui en
    // sortirait est donc déjà faite quand on regarde — aucune course à l'horloge.
    await act(async () => {
      await Promise.all(pannes);
      await new Promise((r) => setTimeout(r, 0));
    });
    // Une panne ne dit rien de la session : rien n'est purgé, rien n'est annoncé.
    expect(getJwt(), 'une panne a purgé une session vivante').toBe(jwt);
    expect(bandeau(), 'une panne annoncée comme une expiration').toBeNull();

    // La Reine revient — le flux se reconnecte — et l'écran redemande.
    muettes.clear();
    act(() => flux.rappels?.onStatus(true));
    await attendre(() => nomAffiche() === 'Patiente', 'le nom, la Reine revenue');
  });
});
