// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// « POURQUOI CE WORKER, CE MODÈLE » — rendu dans le tiroir d'une tâche.
//
// Le panneau montre la raison relue dans le journal : l'élu, le classement qui
// a décidé, le critère du nœud. Un modèle jamais essayé est dit « à explorer »,
// jamais noté 0 ; sans modèle déclaré, le panneau le DIT au lieu d'inventer une
// justification.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { HiveNode } from '../src/shared/types';
import type { AffectationVue } from '../src/shared/routage-vue';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRoutage: vi.fn(),
}));

import { fetchRoutage } from '../dashboard/src/api';
import { RoutageTache } from '../dashboard/src/RoutageTache';

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

const noeuds = [{ id: 'n-zzz', name: 'zzz' }] as unknown as HiveNode[];

async function monter(affectations: AffectationVue[]): Promise<HTMLElement> {
  vi.mocked(fetchRoutage).mockResolvedValue({ taskId: 't', affectations });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<RoutageTache taskId="t" cle="k" nodes={noeuds} />));
  await act(async () => {});
  return conteneur;
}

describe('le panneau « Pourquoi ce Worker, ce modèle »', () => {
  it('MONTRE L’ÉLU, LE CLASSEMENT ET LE CRITÈRE DU NŒUD', async () => {
    const dom = await monter([
      {
        eventId: 1,
        ts: 1,
        nodeId: 'n-zzz',
        modele: 'opus',
        categorie: 'code',
        raisonModele: [
          { modele: 'opus', essais: 3, moyenne: 1, score: 1.9, aExplorer: false },
          { modele: 'grok', essais: 0, moyenne: null, score: null, aExplorer: true },
        ],
        pheromone: null,
        critereNoeud: 'porteur_du_modele',
      },
    ]);
    expect(dom.querySelector('[data-testid="routage-worker"]')?.textContent).toContain('zzz');
    expect(dom.querySelector('[data-testid="routage-worker"]')?.textContent).toContain(
      'porte le modèle élu',
    );
    expect(dom.querySelector('[data-testid="routage-modele"]')?.textContent).toContain('opus');
    const lignes = [...dom.querySelectorAll('.routage-rang tbody tr')];
    expect(lignes).toHaveLength(2);
    expect(lignes[0]?.classList.contains('elu'), 'l’élu est marqué').toBe(true);
    // Le modèle jamais essayé : « à explorer », et aucune moyenne affichée.
    expect(lignes[1]?.textContent).toContain('à explorer');
    expect(lignes[1]?.textContent).not.toMatch(/0\.00/);
  });

  it('SANS MODÈLE DÉCLARÉ, LE PANNEAU LE DIT — pas de justification inventée', async () => {
    const dom = await monter([
      {
        eventId: 1,
        ts: 1,
        nodeId: 'n-zzz',
        modele: null,
        categorie: null,
        raisonModele: [],
        pheromone: null,
        critereNoeud: 'moins_charge',
      },
    ]);
    expect(dom.querySelector('[data-testid="routage-sans-modele"]')).toBeTruthy();
    expect(dom.querySelector('.routage-rang')).toBeNull();
    expect(dom.querySelector('[data-testid="routage-worker"]')?.textContent).toContain(
      'le moins chargé',
    );
  });

  it('PAS ENCORE AFFECTÉE : LE PANNEAU LE DIT', async () => {
    const dom = await monter([]);
    expect(dom.querySelector('[data-testid="routage-tache"]')?.textContent).toContain(
      'Pas encore affectée',
    );
  });
});
