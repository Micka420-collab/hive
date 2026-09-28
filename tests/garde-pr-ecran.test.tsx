// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE GARDE DE PR À L'ÉCRAN — ce qu'il a fait sans qu'on clique, lisible.
//
// Le garde agit seul (garde-pr.ts) : une reprise ouverte, une alerte, un job
// relancé. Un geste automatique qu'aucun écran ne montre se lit comme une
// ruche qui n'a rien fait. La ligne de chaque livraison porte donc la phrase
// du garde et le compteur de reprises face au plafond — et un garde ÉTEINT le
// dit, plutôt que de passer pour un garde qui veille.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchLivraisons: vi.fn(),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
}));

import { fetchLivraisons } from '../dashboard/src/api';
import type { LivraisonVue } from '../dashboard/src/api';
import { LivraisonsProjet } from '../dashboard/src/views/Projets';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROJET: Project = {
  id: 'p1',
  name: 'Rucher',
  repoUrl: 'https://github.com/micka/ruche.git',
  description: null,
  visibility: 'private',
  ownerId: null,
  createdAt: 1,
};

const garde = (actif: boolean): LivraisonVue['garde'] => ({
  actif,
  statut: 'veille',
  geste: 'reprise',
  dit: 'CI rouge — reprise ouverte sur la même branche.',
  tentatives: 1,
  plafond: 3,
  verifieA: 1,
});

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function lire(livraisons: LivraisonVue[]): Promise<string> {
  vi.mocked(fetchLivraisons).mockReset().mockResolvedValue({ livraisons });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine?.render(<LivraisonsProjet project={PROJET} />);
  });
  const bouton = [...conteneur.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('voir les livraisons'),
  );
  expect(bouton, 'le bouton de lecture').toBeDefined();
  await act(async () => {
    bouton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return conteneur.querySelector('.pj-liv-liste')?.textContent ?? '';
}

const ligne = (g: LivraisonVue['garde']): LivraisonVue => ({
  taskId: 't1',
  depot: 'micka/ruche',
  pr: 7,
  branche: 'hive/t1',
  etat: 'ci_rouge',
  dit: 'Intégration continue en échec.',
  ...(g ? { garde: g } : {}),
});

describe('le garde de PR sur la ligne d’une livraison', () => {
  it('montre ce que le garde a fait, et le compteur face au plafond', async () => {
    const texte = await lire([ligne(garde(true))]);
    expect(texte).toContain('garde · CI rouge — reprise ouverte sur la même branche.');
    expect(texte).toContain('reprises 1/3');
  });

  it('un garde éteint le DIT', async () => {
    const texte = await lire([ligne(garde(false))]);
    expect(texte).toContain('garde éteint');
    expect(texte).not.toContain('reprises 1/3');
  });
});
