// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE CLAVIER DU TIME-LAPSE — trois touches, et la garde qui les neutralise.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
// `chronique-journal` éprouve le JOURNAL : les familles, les filtres, la liste.
// La relecture — le Time-Lapse — avait ses boutons rendus et son clavier écrit,
// et personne ne l'avait jamais frappé.
//
// Trois décisions y vivent, et chacune se voit à l'écran quand elle ment :
//
//   · `isTyping() || modalOpen()`      — la barre d'espace pilote la lecture…
//                                        SAUF quand on est en train d'écrire ;
//   · `Math.min(i + 1, last)`          — la frise s'arrête à la dernière image ;
//   · `Math.max(i - 1, 0)`             — et à la première.
//
// ─── LA GARDE QUI COMPTE LE PLUS ─────────────────────────────────────────────
//
// `isTyping()`. Mutée, une barre d'espace tapée dans un champ ne s'écrit pas :
// elle lance la relecture. L'utilisateur voit sa frise partir pendant qu'il
// cherche pourquoi son texte n'a pas d'espaces — deux pannes en une, et aucune
// des deux ne se nomme.
//
// C'est la même famille que la garde IME de la Reine : une ligne qui a l'air
// défensive, que rien ne défend, et dont la mutation ne casse RIEN de visible
// pour celui qui la relit.
//
// ─── LE CAS NOMINAL EST ÉCRIT EN PREMIER, ET C'EST UNE LEÇON PAYÉE ───────────
//
// § 9 unvicicenties : sur le banc de la Reine, trois cas NÉGATIFS sont passés du
// premier coup pendant que le nominal rougissait — rien ne partait jamais, donc
// « rien ne s'est passé » était vrai pour une raison sans rapport. Un banc de
// gardes négatives sans son cas positif est un banc qui ne peut pas rougir.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveEvent, StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchReplay: vi.fn(),
}));

import { fetchReplay } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import Chronique from '../dashboard/src/views/Chronique';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

const INSTANTANE: StateSnapshot = { projects: [], nodes: [], tasks: [], tasksTotal: 0 };

/**
 * Une frise de trois images — assez pour avoir un début, un milieu, une fin.
 *
 * La forme est celle de `ReplayFrame`, au champ près : la première version
 * portait un `tasksDone/tasksTotal` inventé, et le panneau est mort en rendant
 * `frame.tasks[s]` sur un `undefined`. Une frise bricolée n'éprouve rien — elle
 * fait rougir le banc sur son propre décor.
 */
const FRISE = {
  frames: [0, 1, 2].map((i) => ({
    eventId: i + 1,
    ts: 1_700_000_000_000 + i * 1_000,
    type: `etape_${i}`,
    projects: 1,
    nodesOnline: 1,
    nodesTotal: 1,
    tasks: { pending: 0, ready: 0, assigned: 0, running: 0, done: i, failed: 0 },
  })),
};

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchReplay).mockResolvedValue(FRISE as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

async function monter(events: HiveEvent[] = []): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = { snapshot: INSTANTANE, events } as unknown as ViewProps;
  await act(async () => racine?.render(<Chronique {...props} />));
  await act(async () => {});
  return document.body;
}

/** Entre dans le Time-Lapse par le BOUTON, comme un humain. */
async function entrerDansLaFrise(dom: HTMLElement): Promise<void> {
  const bouton = [...dom.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('Time-Lapse'),
  );
  if (!bouton) throw new Error('le bouton Time-Lapse est introuvable');
  await act(async () => {
    bouton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/**
 * Une frappe sur la FENÊTRE — c'est là que le raccourci écoute.
 *
 * Viser l'élément focalisé ne servirait à rien : l'écouteur est posé sur
 * `window`, et c'est précisément ce qui rend la garde `isTyping()` nécessaire.
 */
async function frapper(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** « 2/3 » — la position lue là où l'utilisateur la lit. */
const position = (dom: HTMLElement): string =>
  dom.querySelector('.ch-frame-pos')?.textContent?.trim() ?? '';

/** « Lecture » ou « Pause » — l'état du bouton, par son étiquette d'accessibilité. */
const etatLecture = (dom: HTMLElement): string =>
  [...dom.querySelectorAll('button')]
    .map((b) => b.getAttribute('aria-label') ?? '')
    .find((l) => l === 'Lecture' || l === 'Pause') ?? '';

describe('le clavier du Time-Lapse', () => {
  it('ESPACE LANCE LA LECTURE — sinon rien d’autre dans ce fichier ne mesure rien', async () => {
    // Le cas positif d'abord : sans lui, tous les cas « la touche ne fait rien »
    // seraient verts sur un clavier entièrement débranché (§ 9 unvicicenties).
    const dom = await monter();
    await entrerDansLaFrise(dom);

    expect(position(dom), 'la frise n’est pas ouverte').toBe('1/3');
    expect(etatLecture(dom), 'la frise démarre en lecture').toBe('Lecture');

    await frapper(' ');
    expect(etatLecture(dom), 'la barre d’espace ne lance pas la lecture').toBe('Pause');
  });

  it('LA BARRE D’ESPACE N’EST PAS VOLÉE À CELUI QUI ÉCRIT', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // L'écouteur vit sur `window` : il reçoit TOUT, y compris les frappes
    // destinées à un champ. Mutée, `isTyping()` laisse passer — et la barre
    // d'espace tapée dans un champ lance la relecture au lieu de s'écrire.
    //
    // L'utilisateur voit alors deux pannes à la fois : son texte perd ses
    // espaces, et sa frise part toute seule. Aucune des deux ne se nomme.
    //
    // Le curseur est posé dans le champ de position de la frise — un vrai
    // `<input>` de la vue, pas un élément fabriqué pour le banc.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    const champ = dom.querySelector<HTMLInputElement>('input[type="range"]');
    expect(champ, 'le champ de position est introuvable').toBeTruthy();
    champ?.focus();
    expect(document.activeElement, 'le focus n’a pas pris').toBe(champ);

    await frapper(' ');
    expect(etatLecture(dom), 'la barre d’espace a été volée au champ').toBe('Lecture');
  });

  it('LA FRISE S’ARRÊTE À LA DERNIÈRE IMAGE, PAS APRÈS', async () => {
    // `Math.min(i + 1, last)` : mutée, l'index dépasse la frise, `frames[idx]`
    // devient `undefined`, et le panneau perd son cadre — l'écran se vide sans
    // rien dire, sur une flèche de trop.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    await frapper('ArrowRight');
    expect(position(dom)).toBe('2/3');
    await frapper('ArrowRight');
    expect(position(dom)).toBe('3/3');
    await frapper('ArrowRight');
    expect(position(dom), 'la frise dépasse sa dernière image').toBe('3/3');
  });

  it('ET À LA PREMIÈRE — une flèche gauche de trop ne recule pas dans le vide', async () => {
    // `Math.max(i - 1, 0)` : mutée, l'index passe sous zéro, et le même écran
    // vide apparaît par l'autre bout.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    await frapper('ArrowLeft');
    expect(position(dom), 'la frise recule avant sa première image').toBe('1/3');

    await frapper('ArrowRight');
    expect(position(dom)).toBe('2/3');
    await frapper('ArrowLeft');
    expect(position(dom)).toBe('1/3');
  });

  it('HORS DE LA FRISE, LES TOUCHES NE PILOTENT RIEN', async () => {
    // L'écouteur n'est posé que `if (inReplay …)`. Le journal seul doit garder
    // ses touches : une flèche y sert à défiler, pas à rejouer une histoire
    // qu'on n'a pas ouverte.
    const dom = await monter();
    expect(
      dom.querySelector('.ch-frame-pos'),
      'la frise est ouverte sans qu’on l’ait demandée',
    ).toBeNull();

    await frapper(' ');
    await frapper('ArrowRight');
    expect(dom.querySelector('.ch-frame-pos'), 'une touche a ouvert la frise').toBeNull();
  });
});
