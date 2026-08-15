// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PANNEAU D'INVITATION — le seul endroit d'où la commande atteint l'invité.
//
// ─── POURQUOI CE BANC EXISTE ─────────────────────────────────────────────────
//
// La loupe a rendu NUE la garde d'entrée de `copy()` :
//
//     if (commande === null) return;      mutée en `!==`
//
// Mutée, le bouton « copier » ne fait RIEN quand il y a une commande, et tente
// de copier `null` quand il n'y en a pas. C'est-à-dire : le lot entier — une
// commande d'entrée composée par la ruche, remise à un ami — s'arrête sur le
// bouton qui la lui donne. Rien ne le disait, parce que ce panneau n'avait
// aucun banc de comportement.
//
// ─── CE QU'ON MESURE, ET CE QU'ON NE MESURE PAS ──────────────────────────────
//
// On mesure ce qui PART vers le presse-papiers, et ce que l'écran répond. On ne
// mesure pas le presse-papiers du système : `navigator.clipboard` est un
// bouchon, parce que le vrai n'existe pas hors contexte sécurisé — et que Hive
// est LAN-first, donc l'écran vit précisément là où il n'existe pas.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInvite: vi.fn(),
}));

import { fetchInvite } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import { InvitePanel } from '../dashboard/src/InvitePanel';

const COMMANDE_POSIX = 'curl -fsSL https://exemple.test/rejoindre.sh | sh -s -- hive2_abc';
const COMMANDE_WINDOWS = 'irm https://exemple.test/rejoindre.ps1 -OutFile "…" -Billet hive2_abc';

/** Ce que la ruche rend quand tout va bien. */
const REPONSE = {
  invite: 'hive2_abc',
  url: 'ws://192.168.1.20:7777/ws',
  label: 'Le poste de Camille',
  joinCommand: 'npm run join -- hive2_abc',
  entree: { posix: COMMANDE_POSIX, windows: COMMANDE_WINDOWS },
  note: 'Billet à usage UNIQUE.',
};

let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;
let copies: string[] = [];

beforeEach(() => {
  // La langue est POSÉE : le panneau rend en anglais par défaut sous vitest, et
  // un banc qui cherche « copier » y trouverait « copy ». Mesuré — les quatre
  // cas rougissaient sur la langue, pas sur le produit.
  setLang('fr');
  copies = [];
  // ─── LE PRESSE-PAPIERS EST UN BOUCHON, ET C'EST DÉLIBÉRÉ ──────────────────
  //
  // `navigator.clipboard` n'existe QUE dans un contexte sécurisé. On le pose
  // ici pour que le chemin nominal soit celui qu'on mesure ; le repli
  // `execCommand` a son propre cas plus bas.
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: (t: string) => {
        copies.push(t);
        return Promise.resolve();
      },
    },
    configurable: true,
  });
  vi.mocked(fetchInvite).mockResolvedValue(REPONSE as never);
});

afterEach(() => {
  if (racine) act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

/** Monte le panneau et OUVRE la modale — tout le contenu vit derrière le voile. */
async function ouvrir(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<InvitePanel />));
  await act(async () => {});

  const ouvreur = [...document.body.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').toLowerCase().includes('invit'),
  );
  if (!ouvreur) throw new Error('le bouton qui ouvre le panneau est introuvable');
  await act(async () => {
    ouvreur.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
  // Le corps entier : la modale se monte par PORTAIL, hors du conteneur.
  return document.body;
}

const bouton = (dom: HTMLElement, texte: string): HTMLElement | undefined =>
  [...dom.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').toLowerCase().includes(texte.toLowerCase()),
  );

const cliquer = async (el: Element | undefined) => {
  if (!el) throw new Error('élément absent');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
};

describe('le panneau d’invitation remet vraiment la commande', () => {
  it('LA COMMANDE D’ENTRÉE EST CELLE QU’ON COPIE — pas `npm run join`', async () => {
    // ─── L'ASSERTION QUI PORTE LE LOT ──────────────────────────────────────
    //
    // Tout ce lot existe pour qu'un invité n'ait PAS à installer d'abord.
    // Copier `joinCommand` le renverrait au parcours en deux temps, avec le
    // `cd` implicite — et l'écran aurait l'air juste.
    const dom = await ouvrir();
    expect(dom.querySelector('.invite-cmd code')?.textContent).toBe(COMMANDE_POSIX);

    await cliquer(bouton(dom, 'copier'));
    expect(copies, 'ce n’est pas la commande d’entrée qui est partie').toEqual([COMMANDE_POSIX]);
  });

  it('LE BOUTON COPIER MARCHE — la garde nue de `copy()`', async () => {
    // ─── LE MUTANT QUE CE CAS TUE ──────────────────────────────────────────
    //
    //     if (commande === null) return;     mutée en `!==`
    //
    // Mutée, le bouton ne fait RIEN quand il y a une commande : le presse-
    // papiers reste vide, et l'écran n'affiche jamais « ✔ copié ». L'invité
    // n'a alors aucun moyen d'obtenir sa commande autrement qu'en la
    // sélectionnant à la main — sur une modale, dans un `<code>`.
    const dom = await ouvrir();
    await cliquer(bouton(dom, 'copier'));

    expect(copies.length, 'rien n’est parti au presse-papiers').toBe(1);
    expect(bouton(dom, 'copié'), 'l’écran ne confirme pas la copie').toBeTruthy();
  });

  it('CHANGER DE SYSTÈME CHANGE LA COMMANDE, ET CE QU’ON COPIE', async () => {
    // Une commande POSIX collée dans PowerShell ne dit rien d'utile, et
    // l'invité n'a aucun moyen de le savoir avant de l'avoir collée. La bascule
    // doit donc atteindre le presse-papiers, pas seulement l'affichage.
    const dom = await ouvrir();
    await cliquer(bouton(dom, 'Windows'));

    expect(dom.querySelector('.invite-cmd code')?.textContent).toBe(COMMANDE_WINDOWS);
    await cliquer(bouton(dom, 'copier'));
    expect(copies, 'la bascule ne change que l’affichage').toEqual([COMMANDE_WINDOWS]);
  });

  it('LA PUCE ACTIVE SE VOIT — habit ET état d’accessibilité', async () => {
    // ─── DEUX NUES DE LA MÊME FAMILLE ──────────────────────────────────────
    //
    //     className={`invite-os-btn${systeme === s ? ' actif' : ''}`}
    //     aria-pressed={systeme === s}
    //
    // Mutées, l'habit et l'état s'INVERSENT : la puce active est la seule à
    // paraître éteinte. Un utilisateur ne sait alors plus quelle commande il
    // regarde — et c'est précisément la question à laquelle ces puces existent
    // pour répondre.
    //
    // `aria-pressed` compte autant que la classe : pour qui navigue au lecteur
    // d'écran, c'est le SEUL signal. Une garde qui ne regarderait que la classe
    // laisserait l'inversion vivre là où elle prive le plus.
    const dom = await ouvrir();
    const puce = (nom: string) =>
      [...dom.querySelectorAll('.invite-os-btn')].find((b) => (b.textContent ?? '').includes(nom));

    expect(puce('Linux')?.className, 'la puce active ne porte pas son habit').toContain('actif');
    expect(puce('Windows')?.className, 'une puce inactive porte l’habit actif').not.toContain(
      'actif',
    );
    expect(puce('Linux')?.getAttribute('aria-pressed')).toBe('true');
    expect(puce('Windows')?.getAttribute('aria-pressed')).toBe('false');

    await cliquer(puce('Windows'));
    expect(puce('Windows')?.className, 'l’habit ne suit pas le clic').toContain('actif');
    expect(puce('Linux')?.className).not.toContain('actif');
    expect(puce('Windows')?.getAttribute('aria-pressed')).toBe('true');
    expect(puce('Linux')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('TANT QU’IL N’Y A PAS DE COMMANDE, LE BOUTON COPIER EST DÉSARMÉ', async () => {
    // ─── LA NUE : `disabled={commande === null}` ───────────────────────────
    //
    // Mutée, le bouton est armé quand il n'y a RIEN à copier, et désarmé quand
    // il y a la commande. On clique sur un bouton vivant, rien ne part, et
    // l'écran ne dit pas pourquoi.
    //
    // Le monde « pas encore de commande » se fabrique sans réseau : une promesse
    // qui ne se résout jamais laisse `invite` à `null`.
    vi.mocked(fetchInvite).mockImplementation(() => new Promise(() => {}) as never);
    const dom = await ouvrir();

    const copier = bouton(dom, 'copier');
    expect(copier, 'le bouton copier est absent — le cas ne mesure rien').toBeTruthy();
    expect(
      (copier as HTMLButtonElement).disabled,
      'le bouton est armé alors qu’il n’y a rien à copier',
    ).toBe(true);
  });

  it('une ruche SANS commande d’entrée retombe sur `joinCommand`, et le DIT', async () => {
    // ─── LE REPLI N'EST PAS DÉCORATIF ──────────────────────────────────────
    //
    // Une ruche d'une version antérieure ne renvoie pas `entree`. L'écran doit
    // rester utilisable — et surtout AVERTIR, parce que la commande de repli
    // suppose Hive déjà installé, ce que la page ne dit plus nulle part.
    vi.mocked(fetchInvite).mockResolvedValue({ ...REPONSE, entree: undefined } as never);
    const dom = await ouvrir();

    expect(dom.querySelector('.invite-cmd code')?.textContent).toBe(REPONSE.joinCommand);
    expect(dom.textContent, 'rien n’avertit que l’ami devra installer Hive d’abord').toContain(
      'installer Hive',
    );
  });
});
