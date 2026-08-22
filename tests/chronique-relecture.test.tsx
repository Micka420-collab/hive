// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA RELECTURE DU TIME-LAPSE — la règle de rembobinage, écrite deux fois et
// tenue zéro fois.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage complet de `Chronique.tsx` à base épinglée (`LOUPE_BASE=e93b252`,
// 398 ajoutées / 0 retirée). La vue avait DEUX bancs — `chronique-journal` pour
// la liste, `chronique-clavier` pour les touches — et la relecture restait nue
// là où elle DÉCIDE.
//
// ─── CE QUE LES DEUX BANCS EXISTANTS TENAIENT VRAIMENT ───────────────────────
//
// `chronique-clavier` éprouve QUE la touche arrive : `e.key === ' '`, la garde
// `isTyping() || modalOpen()`, le verrou `inReplay` — toutes défendues, le
// balayage le confirme. Il n'éprouve JAMAIS ce que la touche décide ensuite.
//
// La règle « rejouer depuis le début » est écrite deux fois, à l'identique :
//
//     togglePlay()   if (!playing && idx >= lastIdx) setIdx(0);   ← le BOUTON ▶
//     onKey(' ')     if (!playing && idx >= last)    setIdx(0);   ← la TOUCHE
//
// Le balayage a rendu les QUATRE mutations nues — les deux copies, sur leur
// `&&` comme sur leur borne `>=`. Ce n'est donc pas une jumelle tenue par
// l'autre (§ 9 unquinquagicenties) : c'est la même décision écrite deux fois et
// défendue nulle part. Le banc du clavier prouvait qu'on appuie, pas ce qui
// arrive quand on appuie.
//
// S'y ajoutent trois nues du même écran : la garde d'entrée de `togglePlay`,
// le seuil de la boucle de lecture, et la pause automatique en fin de frise.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateSnapshot, TaskStatus } from '../src/shared/types';
import type { ReplayFrame, ReplayResult } from '../src/orchestrator/replay';

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
const AUCUNE: Record<TaskStatus, number> = {
  pending: 0,
  ready: 0,
  assigned: 0,
  running: 0,
  done: 0,
  failed: 0,
};

/**
 * Une image TYPÉE sur `ReplayFrame`, et une frise TYPÉE sur `ReplayResult`.
 *
 * § 9 terquinquagicenties : un décor sans type n'invente que des mondes
 * impossibles. `ReplayResult` porte QUATRE champs — une frise réduite à
 * `frames` a déjà tué un banc de cette vue.
 */
function image(i: number): ReplayFrame {
  return {
    eventId: i + 1,
    ts: 1_700_000_000_000 + i * 1_000,
    type: `etape_${i}`,
    projects: 1,
    nodesOnline: 1,
    nodesTotal: 1,
    tasks: { ...AUCUNE, done: i },
  };
}

function frise(combien: number): ReplayResult {
  const frames = Array.from({ length: combien }, (_, i) => image(i));
  return {
    frames,
    finalCounts: frames[frames.length - 1] ?? null,
    lastEventId: frames[frames.length - 1]?.eventId ?? 0,
    eventCount: frames.length,
  };
}

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchReplay).mockResolvedValue(frise(3) as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = { snapshot: INSTANTANE, events: [] } as unknown as ViewProps;
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

/** Le bouton VISÉ par son étiquette d'accessibilité — jamais « le premier ». */
function bouton(dom: HTMLElement, etiquette: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll<HTMLButtonElement>('button')].find(
    (x) => x.getAttribute('aria-label') === etiquette,
  );
  if (!b) throw new Error(`le bouton « ${etiquette} » est introuvable`);
  return b;
}

async function cliquer(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Une frappe sur la FENÊTRE — c'est là que le raccourci écoute. */
async function frapper(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/**
 * Avance le temps SANS attendre l'horloge murale.
 *
 * ─── POURQUOI PAS UN `setTimeout` DE 500 ms ──────────────────────────────────
 *
 * La première version attendait vraiment 500 ms pour laisser passer un
 * intervalle de 300. Verte ici, verte huit fois de suite — et le tamis des
 * ordres l'a fait rougir en CI sur la graine 23757, là où la suite tourne
 * trois fois dans des forks parallèles. 200 ms de marge sur une machine
 * chargée, ce n'est pas une marge, c'est un pari.
 *
 * Le carnet interdit d'élargir un plafond pour faire taire un symptôme
 * (§ 3.1) : la faute n'est pas que 500 soit trop court, c'est que le banc
 * REGARDE L'HORLOGE. Les minuteurs simulés retirent la course entièrement —
 * le même test devient vrai ou faux pour une raison, pas pour une charge.
 */
async function avancerDe(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {});
}

/** « 2/3 » — la position lue là où l'utilisateur la lit. */
const position = (dom: HTMLElement): string =>
  dom.querySelector('.ch-frame-pos')?.textContent?.trim() ?? '';

/** « Lecture » ou « Pause » — l'état du bouton, par son étiquette. */
const etatLecture = (dom: HTMLElement): string =>
  [...dom.querySelectorAll('button')]
    .map((b) => b.getAttribute('aria-label') ?? '')
    .find((l) => l === 'Lecture' || l === 'Pause') ?? '';

describe('le BOUTON ▶ décide, et pas seulement il existe', () => {
  it('▶ LANCE LA LECTURE — le cas positif, sans quoi les suivants sont du décor', async () => {
    // `if (frames.length === 0) return;` mutée en `!==` : le bouton ne fait
    // plus rien DÈS QU'IL Y A quelque chose à jouer, et ne « marche » que sur
    // une frise vide. Le clavier n'a jamais eu cette garde-là.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    expect(position(dom), 'la frise ne s’est pas ouverte').toBe('1/3');
    expect(etatLecture(dom), 'la frise démarre en lecture').toBe('Lecture');

    await cliquer(bouton(dom, 'Lecture'));
    expect(etatLecture(dom), 'le bouton ▶ ne lance pas la lecture').toBe('Pause');
  });

  it('▶ AU MILIEU REPREND OÙ L’ON EST — il ne ramène pas au début', async () => {
    // `!playing && idx >= lastIdx` mutée en `||` : la condition devient vraie
    // dès qu'on n'est PAS en lecture, donc toute reprise au milieu saute à la
    // première image. On perd sa place à chaque pause.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    await cliquer(bouton(dom, 'Frame suivante'));
    expect(position(dom), 'le pas en avant n’a pas eu lieu').toBe('2/3');

    await cliquer(bouton(dom, 'Lecture'));
    expect(position(dom), 'la reprise a ramené la frise au début').toBe('2/3');
  });

  it('▶ SUR LA DERNIÈRE IMAGE RELIT DEPUIS LE DÉBUT — la borne est INCLUSIVE', async () => {
    // `idx >= lastIdx` mutée en `>` : sur la DERNIÈRE image — le seul index qui
    // distingue les deux — le rembobinage ne se fait plus. On appuie sur ▶ au
    // bout de la frise, et il ne se passe rien de visible.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    await cliquer(bouton(dom, 'Frame suivante'));
    await cliquer(bouton(dom, 'Frame suivante'));
    expect(position(dom), 'la frise n’est pas à sa dernière image').toBe('3/3');

    await cliquer(bouton(dom, 'Lecture'));
    expect(position(dom), 'la relecture ne repart pas du début').toBe('1/3');
  });
});

describe('la TOUCHE espace décide la même chose — et elle non plus n’était pas tenue', () => {
  it('ESPACE AU MILIEU REPREND OÙ L’ON EST', async () => {
    // La copie clavier de `!playing && idx >= last`, mutée en `||`. Le banc du
    // clavier prouvait que la touche ARRIVE ; celui-ci prouve ce qu'elle FAIT.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    await frapper('ArrowRight');
    expect(position(dom), 'la flèche n’a pas avancé').toBe('2/3');

    await frapper(' ');
    expect(position(dom), 'espace a ramené la frise au début').toBe('2/3');
  });

  it('ESPACE SUR LA DERNIÈRE IMAGE RELIT DEPUIS LE DÉBUT', async () => {
    // La copie clavier de la borne `idx >= last`, mutée en `>`.
    const dom = await monter();
    await entrerDansLaFrise(dom);

    await frapper('ArrowRight');
    await frapper('ArrowRight');
    expect(position(dom), 'la frise n’est pas au bout').toBe('3/3');

    await frapper(' ');
    expect(position(dom), 'espace ne rembobine pas en fin de frise').toBe('1/3');
  });
});

describe('la frise avance seule, et s’arrête seule', () => {
  it('UNE FRISE DE DEUX IMAGES AVANCE, PUIS SE MET EN PAUSE TOUTE SEULE', async () => {
    // Deux nues d'un coup, et deux images suffisent à les distinguer :
    //
    //   · `replay.frames.length < 2` mutée en `<= 2` : la boucle de lecture ne
    //     démarre JAMAIS sur une frise de deux images — on appuie sur ▶, le
    //     bouton bascule, et rien ne bouge.
    //   · `idx >= replay.frames.length - 1` mutée en `>` : l'index est borné à
    //     la dernière image, donc `>` n'est jamais vrai et la pause automatique
    //     ne vient pas — le bouton reste ⏸ pour toujours au bout de la frise.
    vi.mocked(fetchReplay).mockResolvedValue(frise(2) as never);
    const dom = await monter();
    await entrerDansLaFrise(dom);

    expect(position(dom)).toBe('1/2');

    // Les minuteurs simulés sont posés APRÈS le montage (qui dépend de
    // promesses) et AVANT le clic, qui est ce qui crée l'intervalle.
    vi.useFakeTimers();
    await cliquer(bouton(dom, 'Lecture'));

    // Une image toutes les 300 ms : une seule avance, sans rien attendre.
    await avancerDe(350);

    expect(position(dom), 'la boucle de lecture n’a pas avancé la frise').toBe('2/2');
    expect(etatLecture(dom), 'la frise ne s’arrête pas d’elle-même à la fin').toBe('Lecture');
  });
});

describe('la bande d’erreur du Time-Lapse ne recopie pas n’importe quoi', () => {
  it('UN REJET QUI N’EST PAS UNE Error N’IMPOSE PAS SON « message » À L’ÉCRAN', async () => {
    // `e instanceof Error ? e.message : String(e)` mutée en `instanceof Object` :
    // tout objet rejeté porteur d'un `message` voit ce texte s'afficher tel
    // quel. C'est la même nue que la Reine (§ 9, famille D) — deux vues, une
    // seule habitude.
    vi.mocked(fetchReplay).mockRejectedValue({ message: 'trace interne de la ruche' });
    const dom = await monter();
    await entrerDansLaFrise(dom);

    const bande = dom.querySelector('.panel-error')?.textContent ?? '';
    expect(bande, 'la bande d’erreur ne s’affiche pas').toContain('Time-Lapse');
    expect(bande, 'le message d’un objet quelconque a atteint l’écran').not.toContain(
      'trace interne de la ruche',
    );
    expect(bande, 'le rejet non-Error n’est pas rendu par String()').toContain('[object Object]');
  });
});
