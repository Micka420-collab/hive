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
  it('JOURNAL VIDE : « la ruche n’a encore rien vécu », et rien d’autre', async () => {
    const dom = await monterChronique([]);
    expect(dom.textContent).toContain('La ruche n’a encore rien vécu');
  });

  it('JOURNAL PLEIN : le message de vide DISPARAÎT — la moitié qui tue && → ||', async () => {
    // Mutée en `||`, la garde afficherait « rien vécu » SOUS un journal plein,
    // en permanence : une ruche active qui affirme n'avoir rien vécu.
    const dom = await monterChronique([evenement(1, 'task_done'), evenement(2, 'node_connected')]);
    expect(dom.textContent, 'une ruche active ne dit pas « rien vécu »').not.toContain(
      'n’a encore rien vécu',
    );
  });

  it('PLEIN MAIS TOUT FILTRÉ : l’autre message — on n’accuse pas la ruche', async () => {
    // Les événements existent ; c'est l'humain qui a éteint toutes les
    // familles. Le texte doit désigner LES FILTRES, pas prétendre au vide.
    const dom = await monterChronique([evenement(1, 'task_done')]);
    // On éteint TOUTES les familles — les puces portent leur libellé
    // (« 🐝 Tâches 1 »), pas de parenthèses : la première version cliquait
    // sur un motif inventé et n'éteignait rien.
    const familles = /Tâches|Nœuds|Courses|Merge|Conflits|Mémoire|Instinct|Balance|Autres/;
    for (const puce of [...dom.querySelectorAll('button')].filter((b) =>
      familles.test(b.textContent ?? ''),
    )) {
      cliquer(puce);
    }
    expect(dom.textContent).not.toContain('n’a encore rien vécu');
    expect(
      dom.textContent,
      'le message doit désigner les filtres, pas inventer une ruche vide',
    ).toContain('Aucun événement ne passe les filtres actifs');
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
