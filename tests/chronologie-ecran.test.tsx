// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// « OÙ EST PASSÉ LE TEMPS » — rendu dans le tiroir d'une tâche.
//
// Une phase inconnue n'est pas affichée comme zéro ; une tâche en cours dit
// « en cours » ; la latence du modèle et le coût fournisseur sont dits
// INCONNUS, jamais déduits du temps Worker.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ChronologieTache as Chronologie } from '../src/shared/chronologie-tache';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchChronologie: vi.fn(),
}));

import { fetchChronologie } from '../dashboard/src/api';
import { ChronologieTache } from '../dashboard/src/ChronologieTache';

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

const base: Chronologie = {
  attenteDependancesMs: null,
  attenteWorkerMs: 400,
  demarrageMs: 100,
  tentatives: [],
  dureeWorkerTotaleMs: null,
  reprises: 0,
  corrections: 0,
  revueMs: null,
  totalMs: null,
  terminee: false,
  dureeModele: 'inconnu',
  coutFournisseur: 'inconnu',
};

async function monter(c: Chronologie): Promise<HTMLElement> {
  vi.mocked(fetchChronologie).mockResolvedValue({ taskId: 't', chronologie: c });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<ChronologieTache taskId="t" cle="k" />));
  await act(async () => {});
  return conteneur;
}

const phase = (dom: HTMLElement, id: string): string | null =>
  dom.querySelector(`[data-phase="${id}"] dd`)?.textContent ?? null;

describe('le panneau « Où est passé le temps »', () => {
  it('UNE TÂCHE TERMINÉE : PHASES, TENTATIVES, CORRECTIONS, REVUE, TOTAL', async () => {
    const dom = await monter({
      ...base,
      tentatives: [
        { issue: 'reussie', dureeWorkerMs: 2_000 },
        { issue: 'reussie', dureeWorkerMs: 3_000 },
      ],
      dureeWorkerTotaleMs: 5_000,
      corrections: 1,
      revueMs: 60_000,
      totalMs: 120_000,
      terminee: true,
    });
    expect(phase(dom, 'worker')).toBe('moins d’une seconde');
    expect(phase(dom, 'execution')).toContain('5 s');
    expect(phase(dom, 'execution')).toContain('réussie');
    expect(phase(dom, 'corrections')).toBe('1');
    expect(phase(dom, 'revue')).toBe('60 s');
    expect(phase(dom, 'total')).toBe('2 min');
    expect(
      phase(dom, 'dependances'),
      'une phase inconnue n’est pas affichée comme zéro',
    ).toBeNull();
  });

  it('UNE TÂCHE EN COURS DIT « EN COURS » — pas de total inventé', async () => {
    const dom = await monter(base);
    expect(phase(dom, 'total')).toBe('en cours');
    expect(phase(dom, 'execution'), 'pas d’exécution encore').toBeNull();
  });

  it('LA LATENCE DU MODÈLE ET LE COÛT FOURNISSEUR SONT DITS INCONNUS', async () => {
    const dom = await monter(base);
    expect(phase(dom, 'modele')).toContain('inconnue');
    expect(phase(dom, 'cout')).toContain('inconnu');
    expect(phase(dom, 'cout')).toContain('jamais estimé');
  });
});
