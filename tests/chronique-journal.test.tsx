// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA CHRONIQUE, RENDUE — le journal vide, le journal filtré, et la nuance.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu SANS TEST la garde
// `{events.length === 0 && (…)}` — le message « la ruche n'a encore rien
// vécu ». Muté en `||`, ce message s'afficherait SOUS le journal plein, en
// permanence : une ruche active qui affirme n'avoir rien vécu.
//
// La vue distingue DEUX vides, et c'est cette nuance qu'on garde :
//
//   · journal VIDE — la ruche n'a rien vécu : c'est un fait d'accueil ;
//   · journal PLEIN mais FILTRES trop stricts — les événements existent, on a
//     choisi de ne pas les voir : accuser la ruche serait un mensonge.
//
// `Chronique` reçoit ses événements PAR PROPRIÉTÉ — pas de sonde à simuler ;
// seul `fetchReplay` (le Time-Lapse, hors sujet ici) vit dans api.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveEvent, StateSnapshot } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchReplay: vi.fn(() => Promise.resolve({ frames: [] })),
}));

import { fetchReplay } from '../dashboard/src/api';
import Chronique from '../dashboard/src/views/Chronique';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const INSTANTANE: StateSnapshot = { projects: [], nodes: [], tasks: [], tasksTotal: 0 };

function evenement(id: number, type: string): HiveEvent {
  return { id, ts: 1_700_000_000_000 + id * 1_000, type, payload: {} };
}

async function monterChronique(events: HiveEvent[]): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: INSTANTANE,
    events,
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Chronique {...props} />));
  return conteneur;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('la Chronique — les deux vides, et la survivante du balayage', () => {
  it('JOURNAL VIDE : « Rien pour l’instant », et rien d’autre', async () => {
    const dom = await monterChronique([]);
    expect(dom.textContent).toContain('Rien pour l’instant');
  });

  it('JOURNAL PLEIN : le message de vide DISPARAÎT — la moitié qui tue && → ||', async () => {
    // Mutée en `||`, la garde afficherait le vide SOUS un journal plein,
    // en permanence : une ruche active qui affirme n'avoir rien.
    const dom = await monterChronique([evenement(1, 'task_done'), evenement(2, 'node_connected')]);
    expect(dom.textContent, 'une ruche active ne dit pas « rien pour l’instant »').not.toContain(
      'Rien pour l’instant',
    );
  });

  it('PLEIN MAIS TOUT FILTRÉ : l’autre message — on n’accuse pas la ruche', async () => {
    // Les événements existent ; c'est l'humain qui a éteint toutes les
    // familles. Le texte doit désigner LES FILTRES, pas prétendre au vide.
    const dom = await monterChronique([evenement(1, 'task_done')]);
    // On éteint TOUTES les familles — les puces portent leur libellé
    // (« Tâches 1 »), pas de parenthèses : la première version cliquait
    // sur un motif inventé et n'éteignait rien.
    const familles = /Tâches|Nœuds|Courses|Merge|Conflits|Mémoire|Instinct|Balance|Autres/;
    for (const puce of [...dom.querySelectorAll('button')].filter((b) =>
      familles.test(b.textContent ?? ''),
    )) {
      cliquer(puce);
    }
    expect(dom.textContent).not.toContain('Rien pour l’instant');
    expect(
      dom.textContent,
      'le message doit désigner les filtres, pas inventer une ruche vide',
    ).toContain('Aucun événement ne passe les filtres actifs');
  });

  it('« VOUS REGARDEZ LE PASSÉ » NE S’AFFICHE QU’EN REPLAY', async () => {
    // La survivante du balayage du soir : `{inReplay && (` mutée en `||` —
    // le bandeau du Time-Lapse s'afficherait au PRÉSENT, en permanence : un
    // journal vivant qui prétend être une archive.
    const dom = await monterChronique([evenement(1, 'task_done')]);
    expect(dom.textContent, 'au présent, pas de bandeau du passé').not.toContain(
      'vous regardez le passé',
    );

    const bouton = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Time-Lapse'),
    );
    expect(bouton, 'le bouton du Time-Lapse doit exister au présent').toBeTruthy();
    await act(async () => {
      bouton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(dom.textContent, 'en replay, le bandeau se dit').toContain('vous regardez le passé');
  });

  it('EN REPLAY, LA BARRE D’ESPACE MET EN PAUSE — et elle seule', async () => {
    // Survivante du balayage de nuit : `e.key === ' '` mutée en `!==` — TOUTE
    // touche basculerait le Time-Lapse SAUF l'espace, la seule que l'écran
    // annonce. Le raccourci existe précisément pour qu'on n'ait pas à viser un
    // bouton pendant qu'une archive défile.
    // Les commandes de transport n'existent QUE s'il y a des images à rejouer :
    // le faux replay du fichier en rend zéro, et la barre ne se dessine pas.
    // Un banc vide aurait jugé une branche qu'on ne vise pas.
    const image = (eventId: number) => ({
      eventId,
      ts: 1_700_000_000_000 + eventId * 1_000,
      type: 'task_done',
      projects: 1,
      nodesOnline: 1,
      nodesTotal: 1,
      tasks: { pending: 0, ready: 0, assigned: 0, running: 0, done: eventId, failed: 0 },
    });
    vi.mocked(fetchReplay).mockResolvedValue({
      frames: [image(1), image(2), image(3)],
      finalCounts: image(3),
      lastEventId: 3,
      eventCount: 3,
    } as never);

    const dom = await monterChronique([evenement(1, 'task_done')]);
    const bouton = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Time-Lapse'),
    );
    await act(async () => {
      bouton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(dom.textContent, 'le banc lui-même : on est bien en replay').toContain(
      'vous regardez le passé',
    );

    const bascule = () =>
      [...dom.querySelectorAll('button')].find((b) =>
        /▶|⏸|Lecture|Pause/i.test(b.textContent ?? ''),
      );
    const avant = bascule()?.textContent ?? '';
    expect(avant, 'la bascule lecture/pause existe').not.toBe('');

    // Une touche ORDINAIRE ne doit RIEN faire.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    });
    expect(bascule()?.textContent, 'une touche quelconque ne bascule rien').toBe(avant);

    // L'espace, lui, bascule.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(bascule()?.textContent, 'l’espace bascule la lecture').not.toBe(avant);
  });

  it('les compteurs de famille disent le VRAI compte', async () => {
    const dom = await monterChronique([
      evenement(1, 'task_done'),
      evenement(2, 'task_failed'),
      evenement(3, 'node_connected'),
    ]);
    // Deux événements de tâches, un de nœuds — le compteur suit le libellé.
    expect(dom.textContent).toContain('Tâches 2');
    expect(dom.textContent).toContain('Nœuds 1');
  });
});
