// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE FOCUS D'UNE MODALE — les deux promesses qu'on ne voit pas.
//
// ─── CE QUE `useDialog` PROMET, ET CE QUI ÉTAIT TENU ─────────────────────────
//
// Le crochet partagé par les six dialogues du tableau annonce trois gestes :
//
//     ferme sur Échap ;
//     déplace le focus dans l'overlay à l'ouverture ;
//     restaure le focus sur l'élément déclencheur à la fermeture.
//
// Le premier vient d'être défendu (§ 9 quinvicicenties). Les deux autres ne
// l'étaient pas — et ce sont ceux qu'on ne remarque JAMAIS en regardant l'écran,
// parce qu'ils ne se voient qu'au clavier.
//
// ─── CE QU'ILS COÛTENT QUAND ILS MANQUENT ────────────────────────────────────
//
// Sans le focus qui ENTRE : la modale s'ouvre, et la touche Tab continue de
// parcourir la page DERRIÈRE elle. Au lecteur d'écran, rien n'a été annoncé ; au
// clavier, on tabule à l'aveugle dans un contenu qu'on ne voit plus.
//
// Sans le focus qui REVIENT : on ferme, et le curseur repart du haut du
// document. Quelqu'un qui consultait la douzième ouvrière de la liste doit
// refaire douze tabulations pour retrouver sa place — à chaque fiche ouverte.
//
// Les deux pannes sont invisibles à la souris. C'est la même famille que la
// garde IME et que `isTyping()` : ce qui ne se casse pas pour celui qui relit.
//
// ─── ET `activateProps`, QUI OUVRE LA PORTE ──────────────────────────────────
//
// Le geste complet est éprouvé au clavier de bout en bout : on TABULE sur la
// carte, on l'ouvre par Entrée — c'est `activateProps`, nu lui aussi — puis on
// referme par Échap. Sans le premier maillon, les deux autres ne seraient
// mesurés que depuis un clic de souris, qui ne pose le focus nulle part.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLang } from '../dashboard/src/i18n';
import type { HiveNode } from '../src/shared/types';
import { NodesPanel } from '../dashboard/src/NodesPanel';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('classement injoignable — la fiche vit sans lui'))),
  );
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.unstubAllGlobals();
});

const ouvriere = (nom: string): HiveNode =>
  ({
    id: `n-${nom}`,
    name: nom,
    ownerName: 'Camille',
    agentType: 'claude-code',
    status: 'online',
    maxConcurrency: 2,
    running: 0,
    lastSeen: 1_700_000_000_000,
    plateforme: 'linux',
  }) as unknown as HiveNode;

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () =>
    racine?.render(<NodesPanel nodes={[ouvriere('Maya')]} tasks={[]} onOpenTask={() => {}} />),
  );
  await act(async () => {});
  return document.body;
}

const carteDeLouvriere = (dom: HTMLElement): HTMLElement => {
  const c = [...dom.querySelectorAll('*')].find(
    (e) => e.className && String(e.className).includes('node-card'),
  );
  if (!c) throw new Error('la carte de l’ouvrière est introuvable');
  return c as HTMLElement;
};

const dialogue = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');

/** Une frappe SUR L'ÉLÉMENT — c'est ainsi qu'on active une ligne au clavier. */
async function frapperSur(el: HTMLElement, key: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

async function frapperEchap(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  await act(async () => {});
}

describe('le focus d’une modale, du clavier seul', () => {
  it('ENTRÉE SUR LA CARTE OUVRE LA FICHE — le premier maillon du geste', async () => {
    // Le cas positif d'abord (§ 9 unvicicenties). Il éprouve `activateProps`,
    // nu jusqu'ici : sans lui, tout le reste de ce fichier serait mesuré depuis
    // un clic de souris — qui ne pose le focus nulle part, et rendrait les deux
    // promesses de focus invérifiables.
    const dom = await monter();
    const carte = carteDeLouvriere(dom);
    carte.focus();
    expect(document.activeElement, 'la carte n’est pas atteignable au clavier').toBe(carte);

    await frapperSur(carte, 'Enter');
    expect(dialogue(), 'Entrée sur la carte n’ouvre pas la fiche').not.toBeNull();
  });

  it('LE FOCUS ENTRE DANS LA FICHE — sinon on tabule derrière elle', async () => {
    // ─── LA PREMIÈRE PROMESSE ──────────────────────────────────────────────
    //
    // Sans elle, la modale s'ouvre et la touche Tab continue de parcourir la
    // page DERRIÈRE. Au lecteur d'écran rien n'est annoncé ; au clavier on
    // tabule à l'aveugle dans un contenu qu'on ne voit plus.
    const dom = await monter();
    const carte = carteDeLouvriere(dom);
    carte.focus();
    await frapperSur(carte, 'Enter');

    const fiche = dialogue();
    expect(fiche, 'la fiche ne s’ouvre pas').not.toBeNull();
    expect(
      fiche?.contains(document.activeElement),
      'le focus est resté DERRIÈRE la fiche — on tabulerait dans la page cachée',
    ).toBe(true);
  });

  it('LE FOCUS REVIENT À LA CARTE — on ne repart pas du haut du document', async () => {
    // ─── LA SECONDE PROMESSE ───────────────────────────────────────────────
    //
    // Sans elle, refermer renvoie le curseur au début de la page. Quelqu'un qui
    // consultait la douzième ouvrière doit refaire douze tabulations pour
    // retrouver sa place — à chaque fiche ouverte, et sans jamais comprendre
    // pourquoi.
    const dom = await monter();
    const carte = carteDeLouvriere(dom);
    carte.focus();
    await frapperSur(carte, 'Enter');
    expect(dialogue()).not.toBeNull();

    await frapperEchap();
    expect(dialogue(), 'la fiche ne s’est pas fermée').toBeNull();
    expect(
      document.activeElement,
      'le focus n’est pas revenu sur la carte : on repart du haut du document',
    ).toBe(carte);
  });

  it('ESPACE OUVRE AUSSI — et une autre touche n’ouvre rien', async () => {
    // `activateProps` accepte Entrée ET Espace : c'est ce que fait un vrai
    // bouton, et la carte se donne pour un bouton (`role="button"`). Une ligne
    // qui n'obéirait qu'à Entrée serait un bouton à moitié.
    const dom = await monter();
    const carte = carteDeLouvriere(dom);
    carte.focus();

    await frapperSur(carte, 'a');
    expect(dialogue(), 'une touche ordinaire a ouvert la fiche').toBeNull();

    await frapperSur(carte, ' ');
    expect(dialogue(), 'la barre d’espace n’ouvre pas la fiche').not.toBeNull();
  });
});
