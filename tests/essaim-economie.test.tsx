// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// L'ÉCONOMIE D'UNE OUVRIÈRE SUR SA CARTE DE L'ESSAIM — ce qu'elle a coûté, et
// ce que chacun de ses modèles a coûté.
//
// ─── CE QUE CE BANC DÉFEND ───────────────────────────────────────────────────
//
//   · le coût déclaré s'affiche avec sa couverture, sur le Worker comme sur
//     chacun de ses modèles — jamais un total nu ;
//   · la médiane est celle d'une RÉUSSITE, et « inconnue » sans réussite ;
//   · un Worker sans tentative le dit, et une Reine plus ancienne (sans le
//     champ) ne fait apparaître aucun bloc inventé.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { BilanEconomique, WorkerSnapshot } from '../dashboard/src/api';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { HiveNode, StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
  fetchGenome: vi.fn(() => Promise.resolve(null)),
  fetchWorkers: vi.fn(() => Promise.resolve({ workers: [] })),
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

const { fetchWorkers } = await import('../dashboard/src/api');
const { default: Essaim } = await import('../dashboard/src/views/Essaim');

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

const noeud: HiveNode = {
  id: 'n-1',
  name: 'ruche-nord',
  ownerName: 'apicultrice',
  agentType: 'claude-code',
  maxConcurrency: 2,
  running: 0,
  status: 'online',
  lastSeen: null,
  modeles: ['opus'],
} as HiveNode;

const bilan = (patch: Partial<BilanEconomique> = {}): BilanEconomique => ({
  tentatives: 3,
  reussies: 2,
  coutFournisseur: { total: 0.3, declarees: 2, tentatives: 3 },
  dureeModele: { total: 45_000, declarees: 3, tentatives: 3 },
  dureeWorker: { totalMs: 120_000, mesurees: 3 },
  dureeMedianeMs: 40_000,
  ...patch,
});

const worker = (economie: BilanEconomique | undefined, economieModele?: BilanEconomique) =>
  ({
    id: 'n-1',
    name: 'ruche-nord',
    ownerName: 'apicultrice',
    agentType: 'claude-code',
    status: 'online',
    running: 0,
    maxConcurrency: 2,
    slotsLibres: 2,
    reputation: {
      essais: 0,
      appliquer: 0,
      ameliorer: 0,
      refaire: 0,
      moyenne: null,
      score: null,
      attribution: 'absente',
    },
    reputationParCategorie: {},
    modeles: [
      {
        modele: 'opus',
        categories: {},
        reputation: {
          essais: 0,
          appliquer: 0,
          ameliorer: 0,
          refaire: 0,
          moyenne: null,
          score: null,
          attribution: 'absente',
        },
        ...(economieModele ? { economie: economieModele } : {}),
      },
    ],
    ...(economie ? { economie } : {}),
  }) as unknown as WorkerSnapshot;

async function monter(w: WorkerSnapshot): Promise<HTMLElement> {
  vi.mocked(fetchWorkers).mockResolvedValue({ workers: [w] });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [],
      nodes: [noeud],
      tasks: [],
      tasksTotal: 0,
    } as unknown as StateSnapshot,
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

describe('l’économie sur la carte d’une ouvrière', () => {
  it('dit le coût AVEC sa couverture, le temps modèle et la médiane d’une réussite', async () => {
    const dom = await monter(worker(bilan(), bilan({ tentatives: 2 })));
    expect(dom.querySelector('[data-testid="worker-economie-cout"]')?.textContent).toMatch(
      /^coût déclaré ≥ 0,30.* \(2\/3 tentative\(s\) déclarée\(s\)\)$/,
    );
    expect(dom.querySelector('[data-testid="worker-economie"]')?.textContent).toContain(
      '3/3 tentative(s) déclarée(s)',
    );
    expect(dom.querySelector('[data-testid="worker-economie-mediane"]')?.textContent).toBe(
      'durée médiane d’une réussite 40 s',
    );
    expect(dom.querySelector('[data-testid="worker-model-economie"]')?.textContent).toContain(
      '2 tentative(s) · coût ≥ 0,30',
    );
  });

  it('sans réussite, la médiane est inconnue ; sans tentative, la carte le dit', async () => {
    const sansReussite = await monter(worker(bilan({ reussies: 0, dureeMedianeMs: null })));
    expect(
      sansReussite.querySelector('[data-testid="worker-economie-mediane"]')?.textContent,
    ).toContain('inconnue');
    act(() => racine?.unmount());
    conteneur?.remove();

    const vide = await monter(worker(bilan({ tentatives: 0, coutFournisseur: 'inconnu' })));
    expect(vide.querySelector('[data-testid="worker-economie"]')?.textContent).toContain(
      'aucune tentative retenue au journal',
    );
    expect(vide.querySelector('[data-testid="worker-model-economie"]')).toBeNull();
  });

  it('une Reine plus ancienne (sans le champ) n’invente aucun bloc', async () => {
    const dom = await monter(worker(undefined));
    expect(dom.querySelector('[data-testid="worker-economie"]')).toBeNull();
  });
});
