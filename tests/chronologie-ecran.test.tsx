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
        { issue: 'reussie', dureeWorkerMs: 2_000, dureeModeleMs: null, coutUsd: null },
        { issue: 'reussie', dureeWorkerMs: 3_000, dureeModeleMs: null, coutUsd: null },
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

  it('SANS DÉCLARATION, LA LATENCE DU MODÈLE ET LE COÛT FOURNISSEUR SONT DITS INCONNUS', async () => {
    const dom = await monter(base);
    expect(phase(dom, 'modele')).toContain('inconnue');
    expect(phase(dom, 'cout')).toContain('inconnu');
    expect(phase(dom, 'cout')).toContain('jamais estimé');
  });

  it('CE QUE LE CLI DÉCLARE EST DIT TEL QUEL, ET SA SOURCE AVEC', async () => {
    const dom = await monter({
      ...base,
      dureeModele: { total: 45_000, declarees: 2, tentatives: 2 },
      coutFournisseur: { total: 0.0421, declarees: 2, tentatives: 2 },
    });
    expect(phase(dom, 'modele')).toBe('45 s — déclaré par le CLI de l’agent');
    expect(phase(dom, 'cout')).toMatch(/^0,0421\s\$US — déclaré par le CLI de l’agent$/);
  });

  it('UNE COUVERTURE PARTIELLE SE LIT « AU MOINS » — la tentative muette n’est pas estimée', async () => {
    const dom = await monter({
      ...base,
      dureeModele: { total: 30_000, declarees: 1, tentatives: 3 },
      coutFournisseur: { total: 0.5, declarees: 1, tentatives: 3 },
    });
    expect(phase(dom, 'modele')).toBe('≥ 30 s — 1/3 tentative(s) déclarée(s)');
    expect(phase(dom, 'cout')).toMatch(/^≥ 0,50\s\$US — 1\/3 tentative\(s\) déclarée\(s\)$/);
  });
});
