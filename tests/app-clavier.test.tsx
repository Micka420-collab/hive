// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CLAVIER DE TOUT LE TABLEAU — cinq décisions sur deux lignes, aucune défendue.
//
// ─── POURQUOI CELUI-CI EST LE PLUS DANGEREUX DES NEUF ────────────────────────
//
// Le dépôt pose neuf écouteurs sur `window` ou `document`. Celui-ci est le seul
// monté par la coquille : il reçoit donc les touches de TOUS les écrans, tout le
// temps, y compris pendant qu'on écrit dans un champ.
//
//     if (e.ctrlKey || e.metaKey || e.altKey || inInput() || modalOpen()) return;
//     const item = NAV.find(
//       (n) => n.key === e.key || e.code === `Digit${n.key}` || e.code === `Numpad${n.key}`,
//     );
//     if (item && (!item.admin || estAdmin(userRef.current))) navigate(item.id);
//
// Cinq décisions, et chacune se voit à l'écran quand elle ment :
//
//   · `inInput()`         — taper « 3 » dans le champ du jeton QUITTE l'écran
//                           au lieu d'écrire un 3 ;
//   · `modalOpen()`       — un chiffre tapé dans une modale navigue DERRIÈRE
//                           elle, et l'utilisateur revient sur un écran qu'il
//                           n'a pas demandé ;
//   · `ctrl/meta/alt`     — Ctrl+1 et Cmd+2 changent d'onglet DANS LE
//                           NAVIGATEUR : les capter, c'est se battre contre lui ;
//   · `e.code === Digit…` — sur un clavier AZERTY, la rangée du haut rend
//                           « & é " ' », pas des chiffres. Sans ce repli, la
//                           navigation au clavier ne marche pas EN FRANÇAIS ;
//   · `!item.admin || estAdmin(…)` — sinon un membre atterrit sur un écran qui
//                           ne sait que lui dire non.
//
// ─── LA GARDE AZERTY EST LA PLUS INSTRUCTIVE ─────────────────────────────────
//
// C'est la sœur exacte de la garde IME de la Reine (§ 9 duovicicenties), à un
// détail près qui la rend plus mordante : celle-ci protège le public PREMIER de
// ce produit. Un dépôt écrit en français, dont la navigation au clavier serait
// muette sur les claviers français — et le mutant ne casserait rien pour qui
// relit sur un QWERTY.

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
 * Une frappe sur la FENÊTRE, avec `key` ET `code` posés séparément.
 *
 * Les deux comptent, et c'est tout l'objet de ce fichier : un clavier QWERTY
 * rend `key: '3'` ET `code: 'Digit3'` ; un AZERTY rend `key: '"'` avec le même
 * `code: 'Digit3'`. Les confondre reviendrait à ne mesurer qu'un seul monde.
 */
async function frapper(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  });
  await act(async () => {});
}

/** L'écran courant, lu là où le navigateur le lit. */
const ecran = (): string => location.hash.replace(/^#\/?/, '');

describe('le clavier de la coquille', () => {
  it('UN CHIFFRE NAVIGUE — sinon rien d’autre dans ce fichier ne mesure rien', async () => {
    // Le cas positif d'abord (§ 9 unvicicenties) : sans lui, tous les cas
    // « la touche ne fait rien » seraient verts sur un clavier débranché.
    await monter();
    expect(ecran(), 'on ne part pas de la Ruche').toBe('');

    await frapper({ key: '7', code: 'Digit7' });
    expect(ecran(), 'le chiffre ne navigue pas').toBe('chronique');
  });

  it('AZERTY : c’est le CODE de la touche qui décide, pas le caractère', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Sur un clavier français, la rangée du haut ne rend PAS de chiffres sans
    // Maj : la touche de « 7 » rend « è ». Un aiguillage qui ne regarderait que
    // `e.key` laisserait donc la navigation au clavier muette pour le public
    // premier de ce produit — et le mutant ne casserait rien pour qui relit sur
    // un QWERTY.
    //
    // `e.code` désigne la POSITION physique de la touche : il vaut `Digit7` sur
    // les deux dispositions.
    await monter();

    await frapper({ key: 'è', code: 'Digit7' });
    expect(ecran(), 'la navigation au clavier ne marche pas en AZERTY').toBe('chronique');
  });

  it('LE PAVÉ NUMÉRIQUE NAVIGUE, ET « ORIGINE » NON — la branche morte retirée', async () => {
    // ─── UN MUTANT SURVIVANT QUI N'ÉTAIT PAS UN TEST MANQUANT ──────────────
    //
    // L'aiguillage portait une troisième forme : `e.code === \`Numpad${n.key}\``.
    // Le mutant qui la retire a SURVÉCU. En cherchant l'entrée qui le
    // départage, on ne trouve pas un cas oublié — on trouve que la branche
    // n'avait aucun cas où elle servait. Ce que la spécification impose :
    //
    //     NumLock ALLUMÉ   Numpad7 → key: '7'     code: 'Numpad7'
    //     NumLock ÉTEINT   Numpad7 → key: 'Home'  code: 'Numpad7'
    //
    // Allumé, `n.key === e.key` matchait déjà : redondante. Éteint, la touche
    // veut dire « Origine », et la branche faisait NAVIGUER : nuisible.
    //
    // Les deux cas ci-dessous tiennent ce qui reste — et le second est celui
    // que la branche cassait.
    await monter();

    await frapper({ key: '7', code: 'Numpad7' });
    expect(ecran(), 'le pavé numérique ne navigue plus').toBe('chronique');

    location.hash = '';
    await act(async () => {});
    await frapper({ key: 'Home', code: 'Numpad7' });
    expect(ecran(), '« Origine » a été pris pour un 7 et a changé d’écran').toBe('');
  });

  it('CELUI QUI ÉCRIT N’EST PAS DÉPLACÉ D’ÉCRAN', async () => {
    // ─── LA GARDE `inInput()` ──────────────────────────────────────────────
    //
    // Le champ du jeton est un vrai `<input>` de la coquille. Mutée, taper un
    // « 7 » dedans QUITTE l'écran : le champ perd le focus, la saisie s'arrête
    // au milieu, et l'utilisateur se retrouve ailleurs sans avoir rien demandé.
    //
    // C'est le défaut le plus banal de cette famille, et le plus difficile à
    // relier à sa cause : on croit avoir mal cliqué.
    const dom = await monter();
    const champ = dom.querySelector<HTMLInputElement>('input');
    expect(champ, 'aucun champ de saisie dans la coquille').toBeTruthy();
    champ?.focus();
    expect(document.activeElement, 'le focus n’a pas pris').toBe(champ);

    await frapper({ key: '7', code: 'Digit7' });
    expect(ecran(), 'un chiffre tapé dans un champ a changé d’écran').toBe('');
  });

  it('LES RACCOURCIS DU NAVIGATEUR NE SONT PAS CAPTÉS', async () => {
    // Ctrl+1 et Cmd+2 changent d'onglet DANS LE NAVIGATEUR. Les capter, c'est
    // se battre contre lui — et perdre, bruyamment, chez l'utilisateur.
    await monter();

    await frapper({ key: '7', code: 'Digit7', ctrlKey: true });
    expect(ecran(), 'Ctrl+chiffre a été capté').toBe('');

    await frapper({ key: '7', code: 'Digit7', metaKey: true });
    expect(ecran(), 'Cmd+chiffre a été capté').toBe('');

    await frapper({ key: '7', code: 'Digit7', altKey: true });
    expect(ecran(), 'Alt+chiffre a été capté').toBe('');

    // Et la même touche SANS modificateur navigue toujours : la garde protège,
    // elle ne débranche pas. Sans ce dernier geste, un aiguillage mort passerait
    // les trois cas ci-dessus.
    await frapper({ key: '7', code: 'Digit7' });
    expect(ecran(), 'la garde des modificateurs a tout débranché').toBe('chronique');
  });

  it('UNE TOUCHE SANS ÉCRAN NE MÈNE NULLE PART', async () => {
    // `NAV.find` rend `undefined`, et le `if (item …)` s'arrête là. Mutée, on
    // naviguerait vers `undefined` — une route qui n'affiche aucune vue.
    await monter();

    await frapper({ key: 'z', code: 'KeyZ' });
    expect(ecran(), 'une touche inconnue a changé d’écran').toBe('');
  });
});
