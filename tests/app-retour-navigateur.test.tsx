// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE BOUTON PRÉCÉDENT — la seule commande du tableau qui n'appartient pas au tableau.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// `app-coquille` monte l'App sur un hash POSÉ AVANT le montage, et vérifie que
// chaque route affiche sa vue. C'est le premier chargement. Ce que personne
// n'avait jamais joué, c'est le hash qui CHANGE pendant que l'écran vit :
//
//     window.addEventListener('hashchange', onHash);
//
// C'est-à-dire le bouton Précédent du navigateur, et le suivant, et un signet
// collé dans la barre d'adresse d'un onglet déjà ouvert. Trois gestes que
// personne ne pense à essayer parce qu'ils n'appartiennent pas au produit — et
// que tout le monde fait.
//
// ─── LES TROIS DÉCISIONS DE `parseHash` ──────────────────────────────────────
//
//     const view = VIEW_IDS.has(parts[0] ?? '') ? (parts[0] as ViewId) : 'ruche';
//     return { view, selectedId: parts[1] ? decodeURIComponent(parts[1]) : null };
//
//   · le REPLI sur la Ruche — sans lui, un hash inconnu (une faute de frappe,
//     un lien d'une version antérieure) rend une route qui n'affiche AUCUNE
//     vue : un écran vide, sans message ;
//   · `VIEW_IDS` contient TOUTES les vues, y compris celles dont la case est
//     masquée. Le commentaire du code dit pourquoi, et c'est le seul endroit du
//     dépôt qui l'énonce :
//
//         « un administrateur qui ouvre son signet arrive AVANT que
//           /api/auth/me ait répondu, et le renvoyer sur la Ruche à cet
//           instant-là serait un bug qu'on ne saurait pas reproduire » ;
//
//   · le DÉCODAGE de l'identifiant — `navigate` encode, `parseHash` décode.
//     Celui-là est une ÉQUIVALENCE CONSIGNÉE, pas une garde défendue ici : le
//     mutant survit, faute d'entrée qui le départage (les trois consommateurs
//     de `selectedId` n'y mettent que des UUID). La raison, et la condition qui
//     la ferait cesser, sont écrites à la ligne dans `App.tsx`.
//
// Une raison écrite dans un commentaire n'est pas une garde (§ 9
// tervicicenties : le texte survit au code qui le contredit). Celle-ci en a une
// maintenant.

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

import { App } from '../dashboard/src/App';

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
  await act(async () => {});
  await act(async () => {});
  return conteneur;
}

/**
 * Le geste du navigateur : l'adresse change, PUIS l'événement part.
 *
 * C'est exactement ce que fait le bouton Précédent — et c'est pour ça qu'on ne
 * passe pas par `navigate()` : celui-ci est le chemin INTERNE, déjà exercé
 * ailleurs. Ici on entre par la porte que le produit ne contrôle pas.
 */
async function retourNavigateur(hash: string): Promise<void> {
  await act(async () => {
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await act(async () => {});
  await act(async () => {});
}

/** La vue courante, lue là où l'utilisateur la voit : la case allumée. */
const vueAllumee = (dom: HTMLElement): string =>
  dom.querySelector('.mc-nav-cell.active')?.querySelector('.mc-nav-label')?.textContent ?? '';

describe('le bouton Précédent du navigateur', () => {
  it('CHANGER L’ADRESSE CHANGE L’ÉCRAN — sinon rien ici ne mesure rien', async () => {
    // Le cas positif d'abord (§ 9 unvicicenties). Sans lui, « un hash inconnu
    // retombe sur la Ruche » serait vert sur un écouteur entièrement débranché,
    // puisqu'on n'aurait jamais quitté la Ruche.
    const dom = await monter();
    expect(vueAllumee(dom), 'on ne part pas de la Ruche').toBe('Ruche');

    await retourNavigateur('#/chronique');
    expect(vueAllumee(dom), 'le bouton Précédent ne change pas d’écran').toBe('Chronique');

    // Et l'on revient : c'est le geste complet, aller ET retour.
    await retourNavigateur('#/reine');
    expect(vueAllumee(dom)).toBe('Reine');
  });

  it('UN HASH INCONNU RETOMBE SUR LA RUCHE — jamais sur un écran vide', async () => {
    // ─── CE QUE LE REPLI ÉVITE ─────────────────────────────────────────────
    //
    // Une faute de frappe dans la barre d'adresse, ou un lien partagé par
    // quelqu'un qui avait une version antérieure du tableau. Sans le repli, la
    // route ne correspond à aucune vue : l'écran reste blanc, sans message et
    // sans moyen d'en sortir autrement qu'en retapant l'adresse.
    const dom = await monter();
    await retourNavigateur('#/chronique');
    expect(vueAllumee(dom)).toBe('Chronique');

    await retourNavigateur('#/cette-vue-nexiste-pas');
    expect(vueAllumee(dom), 'un hash inconnu laisse l’écran nulle part').toBe('Ruche');
  });

  it('UNE VUE À CASE MASQUÉE RESTE ATTEIGNABLE PAR SON SIGNET', async () => {
    // ─── LA RAISON ÉTAIT ÉCRITE, ET RIEN NE LA TENAIT ──────────────────────
    //
    // `VIEW_IDS` contient TOUTES les vues, y compris l'Intendance, dont la case
    // n'apparaît qu'aux administrateurs. Le commentaire du code dit pourquoi :
    // un administrateur qui ouvre son signet arrive AVANT que `/api/auth/me`
    // ait répondu, et le renvoyer sur la Ruche à cet instant-là serait « un bug
    // qu'on ne saurait pas reproduire ».
    //
    // Ce banc EST cette situation : `authMe` est refusée, donc la session
    // n'existe pas — la case de l'Intendance n'est même pas rendue. La route,
    // elle, doit tenir.
    //
    // On ne peut donc pas lire la case allumée : elle n'existe pas. On lit ce
    // qui reste vrai — aucune AUTRE case n'est allumée, et surtout on n'a pas
    // été renvoyé sur la Ruche.
    const dom = await monter();
    await retourNavigateur('#/intendance');

    expect(
      dom.querySelector('.mc-nav-cell.active'),
      'une case est allumée : la route a été détournée vers une vue visible',
    ).toBeNull();
    expect(
      vueAllumee(dom),
      'le signet d’un administrateur a été renvoyé sur la Ruche avant que la session réponde',
    ).not.toBe('Ruche');
  });

  it('L’ADRESSE SE LIT EN DEUX PARTS — la vue, puis l’identifiant', async () => {
    // ─── CE QUE CE CAS MESURE, ET CE QU'IL NE MESURE PAS ───────────────────
    //
    // Il mesure que l'adresse se lit en DEUX parts : la vue s'allume même
    // quand un identifiant la suit.
    //
    // Il NE mesure PAS le `decodeURIComponent` : ce mutant-là SURVIT, et c'est
    // consigné à la ligne dans `App.tsx` (§ 2.16 ter). Aucune entrée ne le
    // départage aujourd'hui — les trois consommateurs de `selectedId` n'y
    // mettent que des UUID, dont l'encodage est l'identité. Écrire ici un cas
    // avec un chemin accentué aurait BÉNI une situation qui ne peut pas se
    // produire, et le banc aurait eu l'air de garder ce qu'il ne garde pas.
    const dom = await monter();
    const brut = 'dossier/mon fichier é.ts';
    await retourNavigateur(`#/rayon/${encodeURIComponent(brut)}`);

    expect(vueAllumee(dom), 'la route du Rayon ne s’allume pas').toBe('Rayon');
    // La vue reçoit `selectedId` ; ce qu'on peut observer sans la monter en
    // entier, c'est que l'adresse a bien été comprise comme UNE vue et UN
    // identifiant — deux parties, pas trois.
    expect(location.hash.startsWith('#/rayon/'), 'l’adresse a été réécrite').toBe(true);
  });
});
