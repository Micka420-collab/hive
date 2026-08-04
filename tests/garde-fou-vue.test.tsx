// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PANNEAU DE L'AGENT GARDE-FOUS (dashboard, lot G5b).
//
// Deux niveaux d'épreuve, et la séparation est délibérée :
//   · les HELPERS PURS (formatScore, formatMoyenne) — testés directement, car
//     c'est là que vit la seule logique qui peut se tromper, notamment le `+∞`
//     d'un échelon jamais essayé (UCB), que `toFixed` rendrait « Infinity » ;
//   · le RENDU — monté avec un `fetchGardeFou` simulé, asserté sur `textContent`.
//     On ne dessine aucun canevas ici (rien à dessiner), donc pas de mur happy-dom.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGardeFou: vi.fn(),
  reglerGardeFou: vi.fn(() => Promise.resolve({})),
}));

import { fetchGardeFou } from '../dashboard/src/api';
import type { EtatGardeFouUi } from '../dashboard/src/api';
import { GardeFous, formatMoyenne, formatScore } from '../dashboard/src/GardeFous';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLElement;
let racine: Root | null = null;

beforeEach(() => setLang('fr'));
afterEach(() => {
  void act(() => racine?.unmount());
  racine = null;
  conteneur?.remove();
});

async function monter(ui: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  await act(async () => {});
  return conteneur;
}

describe('helpers purs — le formatage qui peut se tromper', () => {
  it('formatScore : un score fini est arrondi, le +∞ (jamais essayé) rend « ∞ »', () => {
    expect(formatScore(0.7123)).toBe('0.71');
    expect(formatScore(0)).toBe('0.00');
    // Le cas qui compte : sans garde, `toFixed` afficherait « Infinity ».
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe('∞');
  });

  it('formatMoyenne : une part de [0,1] devient un pourcentage entier', () => {
    expect(formatMoyenne(0.714)).toBe('71 %');
    expect(formatMoyenne(1)).toBe('100 %');
    expect(formatMoyenne(0)).toBe('0 %');
  });
});

describe('le rendu — ce que l’écran raconte', () => {
  const etat = (p: Partial<EtatGardeFouUi> = {}): EtatGardeFouUi => ({
    actif: true,
    bornes: { min: 'leger', max: 'strict' },
    definiPar: 'humain',
    echelonElu: 'leger',
    classement: [
      { echelon: 'leger', essais: 12, moyenne: 1, score: 1.2 },
      { echelon: 'standard', essais: 4, moyenne: 0.5, score: 0.9 },
      { echelon: 'strict', essais: 0, moyenne: 0, score: Number.POSITIVE_INFINITY },
    ],
    echelons: ['leger', 'standard', 'strict'],
    reglages: {
      leger: { gardiennes: 'consultatif', polyethisme: 'consignes' },
      standard: { gardiennes: 'strict', polyethisme: 'consignes' },
      strict: { gardiennes: 'strict', polyethisme: 'strict' },
    },
    ...p,
  });

  it('un projet actif : l’échelon ÉLU est nommé, et le classement montre le vécu', async () => {
    vi.mocked(fetchGardeFou).mockResolvedValue(etat());
    const dom = await monter(<GardeFous projectId="p1" />);
    expect(dom.textContent, 'l’échelon élu est annoncé').toContain('léger');
    expect(dom.textContent, 'la moyenne du leger, en %').toContain('100 %');
    expect(dom.textContent, 'le strict jamais essayé rend ∞, pas « Infinity »').toContain('∞');
    expect(dom.textContent).not.toContain('Infinity');
  });

  it('un projet INACTIF : aucun échelon élu, on le DIT plutôt que d’inventer', async () => {
    vi.mocked(fetchGardeFou).mockResolvedValue(
      etat({ actif: false, echelonElu: null, classement: [], bornes: null }),
    );
    const dom = await monter(<GardeFous projectId="p2" />);
    expect(dom.textContent).toContain('Aucun échelon élu');
    expect(dom.textContent).toContain('Inactif');
  });
});
