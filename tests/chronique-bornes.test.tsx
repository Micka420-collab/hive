// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES BORNES DE LA CHRONIQUE — six décisions traversées mille fois, toujours
// du même côté.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage complet de `Chronique.tsx` (base épinglée `e93b252`, 398 ajoutées /
// 0 retirée) : **34 candidates, 34 examinées, 27 défendues, 7 SANS TEST**. Six
// sont fermées ici ; la septième est ÉQUIVALENTE et se dit par écrit
// (§ 9 duosexagicenties).
//
// ─── CE QUI LES REND TOUTES PAREILLES ────────────────────────────────────────
//
// Ce ne sont pas des lignes qu'on n'exécute jamais : les bancs les traversent
// à chaque cas. Ce sont des lignes qu'on n'atteint QUE PAR UN CÔTÉ, parce que
// tous les décors existants arrivent du même bord :
//
//     décision                        décors existants        bord jamais vu
//     frame.projects > 1              projects: 1             …le pluriel
//     frame.nodesTotal > 1            nodesTotal: 1           …le pluriel
//     full.length > 120               payload {} → 2 signes   …120 pile
//     allRows.length > visible        0 lignes / visible 300  …300 pile, et 301
//     events.length > 0 (2e vide)     0 ou N, jamais les deux …le journal VIDE
//
// Une garde franchie toujours dans le même sens est une garde qu'on n'éprouve
// pas : on éprouve le chemin, pas la borne. C'est le versant « décor » de
// § 9 novemquadragicenties — seule la mutation tranche.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveEvent, StateSnapshot, TaskStatus } from '../src/shared/types';
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

/** Une image TYPÉE, dont on choisit les comptes — c'est là que vivent les bornes. */
function image(sur: Partial<ReplayFrame> = {}): ReplayFrame {
  return {
    eventId: 1,
    ts: 1_700_000_000_000,
    type: 'etape',
    projects: 1,
    nodesOnline: 1,
    nodesTotal: 1,
    tasks: { ...AUCUNE },
    ...sur,
  };
}

function frise(frames: ReplayFrame[]): ReplayResult {
  return {
    frames,
    finalCounts: frames[frames.length - 1] ?? null,
    lastEventId: frames[frames.length - 1]?.eventId ?? 0,
    eventCount: frames.length,
  };
}

const evenement = (
  id: number,
  type = 'task_done',
  payload: Record<string, unknown> = {},
): HiveEvent => ({ id, ts: 1_700_000_000_000 + id, type, payload }) as HiveEvent;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchReplay).mockResolvedValue(frise([image()]) as never);
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
  return conteneur;
}

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

/** Les puces de COMPTE de la frise, pas celles des filtres. */
const comptesFrise = (dom: HTMLElement): string =>
  [...dom.querySelectorAll('.ch-counts .chip')].map((c) => c.textContent ?? '').join(' | ');

const charges = (dom: HTMLElement): string[] =>
  [...dom.querySelectorAll('.ch-payload')].map((p) => p.textContent ?? '');

const boutonPlus = (dom: HTMLElement): HTMLButtonElement | null =>
  dom.querySelector<HTMLButtonElement>('.ch-more button');

const vides = (dom: HTMLElement): string[] =>
  [...dom.querySelectorAll('.ch-journal .empty')].map((e) => (e.textContent ?? '').trim());

describe('le pluriel de la frise suit le NOMBRE, pas l’habitude', () => {
  it('UN projet et UN nœud s’écrivent au SINGULIER', async () => {
    // `frame.projects > 1 ? 's' : ''` mutée en `>=` : « 1 projets ». Tous les
    // décors du dépôt posent 1, et 1 est exactement le cas où les deux
    // versions divergent — la borne n'était traversée que par en dessous.
    vi.mocked(fetchReplay).mockResolvedValue(
      frise([image({ projects: 1, nodesOnline: 1, nodesTotal: 1 })]) as never,
    );
    const dom = await monter();
    await entrerDansLaFrise(dom);

    const texte = comptesFrise(dom);
    expect(texte, 'le compte des projets ne s’affiche pas').toContain('1 projet');
    expect(texte, '« 1 projets » — le pluriel sur un seul projet').not.toContain('1 projets');
    expect(texte, 'le compte des nœuds ne s’affiche pas').toContain('1 nœud');
    expect(texte, '« 1 nœuds » — le pluriel sur un seul nœud').not.toContain('1 nœuds');
  });

  it('DEUX projets et TROIS nœuds s’écrivent au PLURIEL — le cas qui empêche le banc d’être creux', async () => {
    vi.mocked(fetchReplay).mockResolvedValue(
      frise([image({ projects: 2, nodesOnline: 2, nodesTotal: 3 })]) as never,
    );
    const dom = await monter();
    await entrerDansLaFrise(dom);

    const texte = comptesFrise(dom);
    expect(texte, 'le pluriel manque sur deux projets').toContain('2 projets');
    expect(texte, 'le pluriel manque sur trois nœuds').toContain('3 nœuds');
  });
});

describe('la charge d’un événement se coupe à 120 signes, pas à 119', () => {
  it('UNE CHARGE DE 120 SIGNES PILE PASSE ENTIÈRE — sans les points de suite', async () => {
    // `full.length > 120` mutée en `>=` : à 120 pile, une charge qui tient
    // reçoit quand même son « … ». Les décors du dépôt portent `{}` — deux
    // signes — donc cette borne n'avait jamais été approchée.
    // `JSON.stringify({ m: 'x'.repeat(112) })` fait exactement 120 signes.
    const charge = { m: 'x'.repeat(112) };
    expect(JSON.stringify(charge), 'le décor ne fait pas 120 signes').toHaveLength(120);

    const dom = await monter([evenement(1, 'task_done', charge)]);
    const rendu = charges(dom);
    expect(rendu, 'la ligne du journal ne rend pas sa charge').toHaveLength(1);
    expect(rendu[0], 'une charge de 120 signes a été coupée').not.toContain('…');
    expect(rendu[0]).toHaveLength(120);
  });

  it('UNE CHARGE DE 121 SIGNES EST COUPÉE — l’autre côté de la même borne', async () => {
    const charge = { m: 'x'.repeat(113) };
    expect(JSON.stringify(charge)).toHaveLength(121);

    const dom = await monter([evenement(1, 'task_done', charge)]);
    const rendu = charges(dom);
    expect(rendu[0], 'une charge de 121 signes n’a pas été coupée').toContain('…');
  });
});

describe('« voir plus » n’apparaît que s’il reste vraiment quelque chose', () => {
  const beaucoup = (combien: number): HiveEvent[] =>
    Array.from({ length: combien }, (_, i) => evenement(i + 1));

  it('300 ÉVÉNEMENTS PILE : tout est montré, donc AUCUN bouton', async () => {
    // `allRows.length > visible` mutée en `>=` : à 300 pile — tout est déjà à
    // l'écran — le bouton s'affiche et propose « 0 événement de plus ».
    const dom = await monter(beaucoup(300));
    expect(
      boutonPlus(dom),
      'le bouton « voir plus » s’affiche alors que tout est montré',
    ).toBeNull();
  });

  it('301 ÉVÉNEMENTS : le bouton apparaît — le cas positif', async () => {
    const dom = await monter(beaucoup(301));
    const b = boutonPlus(dom);
    expect(b, 'le bouton « voir plus » manque alors qu’il reste une ligne').not.toBeNull();
    expect(b?.textContent ?? '', 'le bouton n’annonce pas ce qui reste').toContain('1');
  });

  it('JOURNAL VIDE : aucun bouton — la moitié qui tue le `&&` mué en `||`', async () => {
    // Mutée en `||`, l'expression rend l'ÉLÉMENT quand la condition est
    // fausse : le bouton s'affiche en permanence sur un journal vide.
    const dom = await monter([]);
    expect(boutonPlus(dom), 'le bouton « voir plus » s’affiche sur un journal vide').toBeNull();
  });
});

describe('les deux vides ne s’affichent JAMAIS ensemble', () => {
  it('JOURNAL VIDE : un seul message, et c’est celui de l’accueil', async () => {
    // `events.length > 0 && allRows.length === 0` mutée en `>=` : sur un
    // journal vide, `0 >= 0` est vrai et les DEUX phrases s'affichent —
    // « Rien pour l'instant. » suivi de « Aucun événement ne passe les filtres
    // actifs. » La ruche n'a rien vécu ET on accuse les filtres.
    //
    // `chronique-journal` éprouve chaque phrase DANS SON CAS ; aucun cas ne
    // vérifiait qu'il n'y en a qu'UNE.
    const dom = await monter([]);
    const messages = vides(dom);
    expect(messages, 'le journal vide n’affiche pas exactement un message').toHaveLength(1);
    expect(messages[0]).toContain('Rien pour l’instant.');
    expect(messages[0], 'on accuse les filtres sur une ruche qui n’a rien vécu').not.toContain(
      'filtres actifs',
    );
  });
});
