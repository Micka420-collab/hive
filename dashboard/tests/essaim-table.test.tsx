// @vitest-environment happy-dom
//
// LES OUVRIÈRES EN TABLE — le choix cartes / table de l'Essaim.
//
// Ce que ce banc garde : la table montre, une ligne par ouvrière, les faits de
// tête des cartes (nom, statut, agent, bac, modèles, charge, dernier signe,
// l'action) ; le choix est mémorisé PAR COMPTE ; un stockage coupé ne casse
// pas la vue ; un modèle non déclaré se dit, il ne s'invente pas.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLang } from '../src/i18n';
import type { AuthUser } from '../src/api';
import type { ViewProps } from '../src/views/shared';
import type { HiveNode, StateSnapshot } from '../../src/shared/types';

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
  fetchWorkers: vi.fn(() => Promise.resolve({ workers: [] })),
  fetchGenome: vi.fn(() => Promise.resolve(null)),
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

import Essaim from '../src/views/Essaim';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noeud = (patch: Partial<HiveNode> = {}): HiveNode => ({
  id: 'n-1',
  name: 'ruche-nord',
  ownerName: 'apicultrice',
  agentType: 'codex',
  maxConcurrency: 4,
  running: 1,
  status: 'online',
  lastSeen: null,
  ...patch,
});

const NOEUDS = [
  noeud({ modeles: ['gpt-5.6-luna'], isolement: { niveau: 'conteneur', fournisseur: 'podman' } }),
  noeud({ id: 'n-2', name: 'ruche-sud', agentType: 'claude-code', status: 'offline' }),
];

const compte = (id: string) =>
  ({ id, email: `${id}@exemple.test`, displayName: id, role: 'membre' }) as AuthUser;

let conteneur: HTMLElement | null = null;
let racine: Root | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  conteneur = null;
  racine = null;
  localStorage.clear();
  vi.restoreAllMocks();
});

async function monter(
  user: AuthUser | null,
  onNavigate: ViewProps['onNavigate'] = () => {},
): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const snapshot: StateSnapshot = { projects: [], nodes: NOEUDS, tasks: [], tasksTotal: 0 };
  const props = {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate,
    refreshTick: 0,
    user,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Essaim {...props} />));
  await act(async () => {});
  return conteneur;
}

function bascule(dom: HTMLElement, libelle: 'Cartes' | 'Table'): HTMLButtonElement {
  const groupe = dom.querySelector('[aria-label="Affichage des ouvrières"]');
  const b = [...(groupe?.querySelectorAll('button') ?? [])].find((x) => x.textContent === libelle);
  expect(b, `bascule « ${libelle} » introuvable`).toBeTruthy();
  return b!;
}

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('les ouvrières en table', () => {
  it('par défaut, les cartes ; la table montre une ligne par ouvrière, faits de tête compris', async () => {
    const navigations: unknown[][] = [];
    const dom = await monter(null, (...a: unknown[]) => navigations.push(a));
    expect(dom.querySelector('[data-testid="essaim-table"]')).toBeNull();
    expect(bascule(dom, 'Cartes').getAttribute('aria-pressed')).toBe('true');

    await cliquer(bascule(dom, 'Table'));
    const table = dom.querySelector('[data-testid="essaim-table"]');
    expect(table).toBeTruthy();
    expect(bascule(dom, 'Table').getAttribute('aria-pressed')).toBe('true');
    expect([...table!.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Nom',
      'Statut',
      'Agent',
      'Bac à sable',
      'Modèles',
      'Charge',
      'Dernier signe',
      'Actions',
    ]);
    const lignes = [...table!.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('th, td')].map((c) => c.textContent),
    );
    expect(lignes[0]?.slice(0, 7)).toEqual([
      'ruche-nord',
      'en ligne',
      'Codex',
      'bac · conteneur (podman)',
      'gpt-5.6-luna',
      '1/4',
      'jamais vu',
    ]);
    // Un modèle NON DÉCLARÉ se dit ; une ligne vide se lirait « aucun ».
    expect(lignes[1]?.slice(0, 5)).toEqual([
      'ruche-sud',
      'hors ligne',
      'Claude Code',
      'bac · non déclaré',
      'aucun modèle déclaré',
    ]);

    const ouvrir = table!.querySelectorAll<HTMLButtonElement>('tbody button')[1]!;
    expect(ouvrir.textContent).toBe('Ouvrir la Chambre · ruche-sud');
    await cliquer(ouvrir);
    expect(navigations).toEqual([['chambre', 'n-2']]);
  });

  it('LE CHOIX EST GARDÉ PAR COMPTE — l’une ne l’impose pas à l’autre', async () => {
    let dom = await monter(compte('maya'));
    await cliquer(bascule(dom, 'Table'));
    expect(localStorage.getItem('hive.essaim.vue.maya')).toBe('table');
    act(() => racine?.unmount());
    conteneur?.remove();

    // Maya revient : sa table l'attend.
    dom = await monter(compte('maya'));
    expect(dom.querySelector('[data-testid="essaim-table"]')).toBeTruthy();
    act(() => racine?.unmount());
    conteneur?.remove();

    // Léa, sur le même navigateur : ses cartes, pas le choix de Maya.
    dom = await monter(compte('lea'));
    expect(dom.querySelector('[data-testid="essaim-table"]')).toBeNull();
  });

  it('un stockage coupé ne casse pas la vue : le choix vaut pour l’onglet', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const dom = await monter(compte('maya'));
    await cliquer(bascule(dom, 'Table'));
    expect(dom.querySelector('[data-testid="essaim-table"]')).toBeTruthy();
  });
});
