// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE WAGGLE BOARD — la danse frétillante, et le podium qu'elle dresse.
//
// ─── CE QUI ÉTAIT DÉJÀ GARDÉ ─────────────────────────────────────────────────
//
// Recensement sur les DEUX racines (§ 9 quattuortrigicenties) :
//
//     es-podium · es-medal · es-dance · es-nectar · es-rank · es-bar-fill
//     es-score · « Lecture de la danse » · « attend le premier nectar »   (rien)
//
// `tests/waggle.test.ts` tient le module qui CALCULE le tableau — le score, le
// tri, les totaux. Il ne monte rien : le RENDU du classement n'avait aucun cas.
// Les trois lots précédents d'Essaim ont fermé le polyéthisme, les phéromones
// et la carte d'ouvrière ; le podium restait entier.
//
// Le recensement ne conclut rien seul : les six mutants ci-dessous ont été
// posés ensemble, chacun vérifié posé, et la suite ENTIÈRE est restée verte —
// 289 fichiers, 4 185 tests. C'est la mesure qui prononce la nudité.
//
// ─── L'ORDRE VISUEL N'EST PAS L'ORDRE DU CLASSEMENT ──────────────────────────
//
//     // Ordre visuel : 2e à gauche, 1er au centre, 3e à droite.
//     const order = [1, 0, 2].filter((i) => i < top.length);
//
// Un commentaire qui explique n'est pas une garde (§ 9 sexvicicenties). Celui-ci
// décrivait exactement la règle — et `[0, 1, 2]` passait sans que rien ne
// rougisse. C'est un podium : sa forme EST son information. Rangé par ordre de
// classement, il devient une liste de trois noms, et la médaille d'or n'est
// plus au milieu où l'œil la cherche.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
//     !board && !waggle.error / nodes.length === 0  →  les deux MESSAGES échangés
//     order = [1, 0, 2]                             →  [0, 1, 2]
//     i === 0 ? 'es-medal es-dance'                 →  i === 1
//     Math.max(1, board.nodes[0]?.score ?? 1)       →  Math.max(0, …)
//     n.raceWins > 0 &&                             →  >= 0   (la borne à zéro)
//     <span className="es-rank">{i + 1}</span>      →  {i}

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { NodeNectar, WaggleBoard } from '../dashboard/src/api';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

// Les QUATRE sondes de la vue sont bouchées, pas seulement celle qu'on met en
// scène : un bouchon partiel laisse partir au réseau tout ce qu'on n'a pas
// nommé (§ 9 duotrigicenties).
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

import { fetchPheromones, fetchPolyethisme, fetchRaces, fetchWaggle } from '../dashboard/src/api';
import Essaim from '../dashboard/src/views/Essaim';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchRaces)
    .mockReset()
    .mockResolvedValue({ races: [] } as never);
  vi.mocked(fetchPheromones)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchPolyethisme)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(fetchWaggle).mockReset();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const butineuse = (name: string, score: number, over: Partial<NodeNectar> = {}): NodeNectar => ({
  nodeId: `n-${name}`,
  name,
  agentType: 'shell',
  tasksDone: 4,
  tasksFailed: 0,
  totalDurationMs: 40_000,
  avgDurationMs: 10_000,
  successRate: 1,
  raceWins: 0,
  score,
  ...over,
});

/** Le tableau, tel que `/api/waggle` le rend. Les nœuds sont DÉJÀ triés. */
const tableau = (nodes: NodeNectar[]): WaggleBoard => ({
  nodes,
  totalTasksDone: nodes.reduce((s, n) => s + n.tasksDone, 0),
  totalTasksFailed: nodes.reduce((s, n) => s + n.tasksFailed, 0),
  topNodeId: nodes[0]?.nodeId ?? null,
});

/** Monte l'Essaim sur la réponse de `/api/waggle` donnée (`null` : rien reçu). */
async function monter(reponse: WaggleBoard | null): Promise<HTMLElement> {
  vi.mocked(fetchWaggle).mockResolvedValue(reponse as never);
  return rendre();
}

/** La route existe mais échoue : la carte doit dire l'erreur, pas se taire. */
async function monterEnPanne(): Promise<HTMLElement> {
  vi.mocked(fetchWaggle).mockRejectedValue(new Error('la danse est illisible'));
  return rendre();
}

async function rendre(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: { projects: [], nodes: [], tasks: [], tasksTotal: 0 } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Essaim {...props} />));
  await act(async () => {});
  return conteneur;
}

/** Les places du podium, DANS L'ORDRE DU DOM — c'est là que la forme se lit. */
const places = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.es-podium-slot'),
];

const nomDe = (place: HTMLElement): string =>
  place.querySelector('.es-podium-name')?.textContent ?? '';

/** Les lignes de la liste de nectar, dans l'ordre du classement. */
const rangees = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.es-nectar-row'),
];

describe('le Waggle Board : la danse et son podium', () => {
  it('LE CLASSEMENT S’AFFICHE AVEC SES SCORES — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const dom = await monter(tableau([butineuse('ruche-or', 90), butineuse('ruche-argent', 60)]));

    expect(rangees(dom), 'le classement n’est pas rendu').toHaveLength(2);
    expect(dom.textContent, 'le nom de la première ouvrière manque').toContain('ruche-or');
    expect(dom.textContent, 'le score de la première ouvrière manque').toContain('90');
    expect(places(dom), 'le podium n’est pas dressé').toHaveLength(2);
  });

  it('LE PODIUM MET LE N°1 AU CENTRE — pas en tête de liste', async () => {
    // ─── LA FORME EST L'INFORMATION ────────────────────────────────────────
    //
    //     // Ordre visuel : 2e à gauche, 1er au centre, 3e à droite.
    //     const order = [1, 0, 2].filter((i) => i < top.length);
    //
    // Le commentaire décrivait la règle ; rien ne la jouait. Rangé par ordre
    // de classement, le podium devient une liste de trois noms et la médaille
    // d'or quitte le milieu, où l'œil la cherche.
    //
    // C'est l'ORDRE DU DOM qu'on lit ici, pas le contenu : les trois mêmes
    // noms sont présents dans les deux versions, seule leur place change.
    const dom = await monter(
      tableau([
        butineuse('la-premiere', 90),
        butineuse('la-deuxieme', 60),
        butineuse('la-troisieme', 30),
      ]),
    );

    const [gauche, centre, droite] = places(dom);
    expect(nomDe(gauche!), 'la 2ᵉ n’est pas à gauche').toContain('la-deuxieme');
    expect(nomDe(centre!), 'le podium range par classement — la 1ʳᵉ quitte le centre').toContain(
      'la-premiere',
    );
    expect(nomDe(droite!), 'la 3ᵉ n’est pas à droite').toContain('la-troisieme');
  });

  it('C’EST LE N°1 QUI DANSE — la waggle dance ne se délègue pas', async () => {
    // La danse frétillante est le geste par lequel une butineuse annonce la
    // meilleure source. Posée sur la 2ᵉ médaille, elle désigne la mauvaise
    // ouvrière — et le podium, dont c'est toute la fonction, ment.
    //
    // Les deux mondes dans le même montage : muté, ils s'échangent exactement.
    const dom = await monter(tableau([butineuse('la-premiere', 90), butineuse('la-deuxieme', 60)]));

    const danse = (p: HTMLElement) => p.querySelector('.es-dance') !== null;
    const [gauche, centre] = places(dom);

    expect(danse(centre!), 'la n°1 ne danse pas').toBe(true);
    expect(danse(gauche!), 'la n°2 danse à la place de la n°1').toBe(false);
  });

  it('UNE OUVRIÈRE SANS VICTOIRE NE PORTE PAS LE ◇ — zéro PILE est la borne', async () => {
    // ─── LA BORNE À ZÉRO (§ 9 tertrigicenties) ─────────────────────────────
    //
    // `raceWins > 0` et `raceWins >= 0` ne diffèrent QU'À ZÉRO : à 1 comme à
    // 12, les deux versions affichent le ◇. Seule la valeur ÉGALE les sépare
    // — et zéro est le cas de LOIN le plus fréquent, puisque les courses de
    // drones sont optionnelles.
    //
    // Muté, chaque ligne du classement porte « ◇ 0 » : un badge de victoire
    // sur une ouvrière qui n'a jamais couru.
    const dom = await monter(
      tableau([
        butineuse('la-guerriere', 90, { raceWins: 2 }),
        butineuse('la-paisible', 60, { raceWins: 0 }),
      ]),
    );

    const [guerriere, paisible] = rangees(dom);
    expect(guerriere!.textContent, 'les victoires de course ne sont pas comptées').toContain('◇ 2');
    expect(
      paisible!.textContent,
      'une ouvrière qui n’a jamais couru porte le ◇ — « ◇ 0 » se lit comme une victoire',
    ).not.toContain('◇');
  });

  it('LE CLASSEMENT COMMENCE À UN — et les barres ne divisent jamais par zéro', async () => {
    // Deux gardes que la même ruche met à l'épreuve : un classement dont TOUS
    // les scores valent zéro.
    //
    // · `{i + 1}` : la meilleure ouvrière est la 1ʳᵉ, pas la 0ᵉ. C'est un
    //   classement — son rang est ce que la personne lit en premier.
    // · `Math.max(1, board.nodes[0]?.score ?? 1)` : l'échelle est le
    //   DÉNOMINATEUR de la largeur de chaque barre. `?? 1` ne protège rien ici
    //   — `0 ?? 1` vaut `0`, pas `1` — c'est bien le plancher `Math.max(1, …)`
    //   qui tient, et lui seul. Sans lui, la largeur devient `NaN%`, que le DOM
    //   refuse tout court.
    const dom = await monter(tableau([butineuse('la-neuve', 0), butineuse('l-autre', 0)]));

    const rangs = rangees(dom).map((r) => r.querySelector('.es-rank')?.textContent ?? '');
    expect(rangs, 'le classement ne commence pas à un').toEqual(['1', '2']);

    const barres = [...dom.querySelectorAll<HTMLElement>('.es-bar-fill')];
    expect(barres, 'les barres de nectar ne sont pas rendues').toHaveLength(2);
    for (const b of barres) {
      expect(b.style.width, 'la largeur d’une barre n’est plus un pourcentage lisible').toBe('0%');
    }
  });

  it('« JE LIS LA DANSE » ET « AUCUN NECTAR ENCORE » NE SONT PAS LE MÊME VIDE', async () => {
    // ─── TROIS ÉTATS, ET DEUX D'ENTRE EUX SE RESSEMBLENT ───────────────────
    //
    // « Lecture de la danse… »          : la réponse n'est pas encore là.
    // « La danse attend le premier nectar » : la réponse EST là, et le
    //                                     classement est vide.
    // Et un troisième, distinct des deux : la sonde a ÉCHOUÉ — l'écran dit
    // l'erreur au lieu d'un vide rassurant.
    //
    // Échangés, une ruche qui a répondu reste en chargement perpétuel, et une
    // ruche qui charge annonce une absence de nectar qu'elle n'a pas mesurée.
    const enLecture = await monter(null);
    expect(enLecture.textContent, 'la lecture en cours ne se dit pas').toContain(
      'Lecture de la danse',
    );

    act(() => racine?.unmount());
    conteneur?.remove();

    const vide = await monter(tableau([]));
    expect(
      vide.textContent,
      'un classement vide se déclare « en lecture » — l’écran n’arrivera jamais',
    ).toContain('attend le premier nectar');
    expect(vide.textContent, 'le classement vide se dit encore en lecture').not.toContain(
      'Lecture de la danse',
    );

    act(() => racine?.unmount());
    conteneur?.remove();

    const enPanne = await monterEnPanne();
    expect(enPanne.textContent, 'la panne de la sonde ne se dit pas').toContain(
      'la danse est illisible',
    );
    expect(
      enPanne.textContent,
      'une sonde en panne se déguise en chargement — on attend un écran qui ne viendra pas',
    ).not.toContain('Lecture de la danse');
  });
});
