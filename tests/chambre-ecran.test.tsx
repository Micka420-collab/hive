// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA CHAMBRE, À L'ÉCRAN — onglets identité, filtres missions, lien Rayon.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ChambrePoste } from '../dashboard/src/api';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchChambre: vi.fn(),
  fetchMotifs: vi.fn(() => Promise.resolve({ motifs: [] })),
  fetchAtelier: vi.fn(() =>
    Promise.resolve({
      mode: 'off',
      actif: false,
      ecran: '',
      cdp: '',
      outil: '',
      raison: 'HIVE_ATELIER=off',
    }),
  ),
  repondreRequisition: vi.fn(),
  appliquerMotif: vi.fn(),
  noterHorizon: vi.fn(),
  demarrerAtelier: vi.fn(),
  arreterAtelier: vi.fn(),
}));

import { fetchChambre } from '../dashboard/src/api';
import Chambre from '../dashboard/src/views/Chambre';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

const NODE_ID = 'node-capucine';
const PROJECT_ID = 'proj-demo';

function poste(over: Partial<ChambrePoste> = {}): ChambrePoste {
  return {
    nodeId: NODE_ID,
    bapteme: { nom: 'Capucine', baptiseA: 1 },
    metier: { metier: 'edite', assigneA: 1 },
    caste: 'nourrice',
    projectId: PROJECT_ID,
    node: {
      id: NODE_ID,
      status: 'offline',
      plateforme: 'linux',
      agentType: 'shell',
      ownerName: 'moi',
      running: 0,
      maxConcurrency: 2,
      lastSeen: 1,
      nameTechnique: 'ma-machine',
    },
    presences: [
      {
        toolUseId: 'tu1',
        chemin: 'src/pont/mcp.ts',
        outil: 'Edit',
        taskId: 't1',
        constateA: 1,
      },
    ],
    tasks: [
      {
        id: 't1',
        projectId: PROJECT_ID,
        title: 'Écrire le pont MCP',
        prompt: 'pont',
        status: 'running',
        dependsOn: [],
        assignedNodeId: NODE_ID,
        result: null,
        branch: null,
        attempts: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    requisitions: [],
    horizon: { faits: [], hypotheses: [] },
    fabriques: [],
    atelier: {
      mode: 'off',
      actif: false,
      ecran: '',
      cdp: '',
      outil: '',
      raison: 'HIVE_ATELIER=off',
    },
    ...over,
  };
}

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchChambre).mockReset().mockResolvedValue(poste());
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(onNavigate: ViewProps['onNavigate'] = () => {}): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [],
      nodes: [],
      tasks: [],
      tasksTotal: 0,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate,
    refreshTick: 0,
    selectedId: NODE_ID,
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Chambre {...props} />));
  await act(async () => {});
  return document.body;
}

describe('Chambre à l’écran', () => {
  it('expose un seul tablist (identité) et des filtres en role=group', async () => {
    const dom = await monter();
    const sections = dom.querySelector('[data-testid="chambre-sections"]');
    expect(sections?.getAttribute('role')).toBe('tablist');
    expect(dom.querySelectorAll('[role="tablist"]')).toHaveLength(1);

    const filtres = dom.querySelector('[data-testid="chambre-filtres-taches"]');
    expect(filtres?.getAttribute('role')).toBe('group');
    const actif = filtres?.querySelector('button.actif');
    expect(actif?.getAttribute('aria-pressed')).toBe('true');
  });

  it('navigue les onglets au clavier (ArrowDown)', async () => {
    const dom = await monter();
    const tablist = dom.querySelector('[data-testid="chambre-sections"]') as HTMLElement;
    const fiche = dom.querySelector('#ch-tab-fiche') as HTMLButtonElement;
    expect(fiche.getAttribute('aria-selected')).toBe('true');
    expect(fiche.tabIndex).toBe(0);

    await act(async () => {
      tablist.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {});

    const travail = dom.querySelector('#ch-tab-travail') as HTMLButtonElement;
    expect(travail.getAttribute('aria-selected')).toBe('true');
    expect(travail.tabIndex).toBe(0);
    expect(fiche.tabIndex).toBe(-1);
  });

  it('ouvre le Rayon depuis le bouton d’en-tête', async () => {
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    const btn = dom.querySelector('[data-testid="chambre-ouvrir-rayon"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('rayon', PROJECT_ID);
  });

  it('nomme les zones Journal / Missions / Ordinateur', async () => {
    const dom = await monter();
    const titres = [...dom.querySelectorAll('.ch-zone-head h3, .ch-ordi-top h3')].map(
      (el) => el.textContent?.trim() ?? '',
    );
    expect(titres).toContain('Journal');
    expect(titres).toContain('Missions');
    expect(titres.some((t) => t.startsWith('Ordinateur'))).toBe(true);
  });
});
