// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// Pouls Plein Essaim sur la Ruche : niveau / pause / dérive, clic → Projets.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutonomiePulse } from '../dashboard/src/AutonomiePulse';
import { setLang } from '../dashboard/src/i18n';
import type { EtatEssaimUi } from '../dashboard/src/api';

const fetchEssaim = vi.fn();

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchEssaim: (...args: unknown[]) => fetchEssaim(...args),
}));

function etat(over: Partial<EtatEssaimUi> = {}): EtatEssaimUi {
  return {
    niveau: 'propose',
    niveaux: ['off', 'propose', 'gouverne', 'plein'],
    runner: { mode: 'on', enPause: false, echecs: 0, dernierTourA: 0 },
    derive: { etat: 'saine', echantillon: 0, indicateurs: [], solitudeJours: 0, motif: '' },
    decision: { pas: 'inerte', motif: '', gouvernantes: [] },
    gouvernantes: [],
    gouvernantesRequises: 1,
    depotInscrit: true,
    plafond: 'passe',
    lecons: [],
    ...over,
  } as EtatEssaimUi;
}

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => {
  setLang('fr');
  fetchEssaim.mockReset();
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

async function monter(
  projets: { id: string; name: string }[],
  onNavigate = vi.fn(),
): Promise<{ el: HTMLElement; onNavigate: ReturnType<typeof vi.fn> }> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(<AutonomiePulse projets={projets} onNavigate={onNavigate} />);
  });
  // Laisser les promesses fetchEssaim se résoudre.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { el: conteneur, onNavigate };
}

describe('AutonomiePulse', () => {
  it('ne rend rien sans projet', async () => {
    const { el } = await monter([]);
    expect(el.querySelector('.autonomie-pulse')).toBeNull();
    expect(fetchEssaim).not.toHaveBeenCalled();
  });

  it('affiche niveau, pause et dérive, et navigue vers Projets', async () => {
    fetchEssaim.mockImplementation(async (id: string) => {
      if (id === 'p1') {
        return etat({
          niveau: 'plein',
          runner: { mode: 'on', enPause: true, echecs: 0, dernierTourA: 1 },
          derive: {
            etat: 'degradee',
            echantillon: 3,
            indicateurs: [],
            solitudeJours: 2,
            motif: 'dérive',
          },
        });
      }
      return etat({ niveau: 'off' });
    });
    const { el, onNavigate } = await monter([
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ]);
    const section = el.querySelector('.autonomie-pulse');
    expect(section).toBeTruthy();
    expect(section!.textContent).toContain('Alpha');
    expect(section!.textContent).toContain('plein');
    expect(section!.textContent).toContain('en pause');
    expect(section!.textContent).toContain('dérive');
    expect(section!.textContent).toContain('Beta');
    expect(section!.textContent).toContain('éteint');

    const bouton = el.querySelector('.autonomie-pulse-item--plein') as HTMLButtonElement;
    expect(bouton).toBeTruthy();
    await act(async () => {
      bouton.click();
    });
    expect(onNavigate).toHaveBeenCalledWith('projets', 'p1');
  });
});
