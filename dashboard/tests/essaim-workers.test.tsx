// @vitest-environment happy-dom
//
// Contrat Mission Control pour la projection Worker.
//
// La carte Essaim a déjà une preuve de rendu dans `tests/essaim-carte-ouvriere`.
// Ce banc tient la frontière ajoutée par la projection : le client doit envoyer
// le jeton de ruche à `/api/workers`, conserver les données reçues, et laisser
// l'écran distinguer un modèle connu d'un modèle encore jamais observé.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setLang } from '../src/i18n';
import type { WorkerSnapshot } from '../src/api';
import type { ViewProps } from '../src/views/shared';
import type { HiveNode, StateSnapshot } from '../../src/shared/types';

const vraiFetch = globalThis.fetch;

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchWaggle: vi.fn(() => Promise.resolve(null)),
  fetchRaces: vi.fn(() => Promise.resolve({ races: [] })),
  fetchPheromones: vi.fn(() => Promise.resolve(null)),
  fetchPolyethisme: vi.fn(() => Promise.resolve(null)),
  fetchWorkers: vi.fn(() => Promise.resolve({ workers: [] })),
  fetchBaptemes: vi.fn(() => Promise.resolve({ baptemes: [] })),
}));

import { fetchBaptemes, fetchWorkers } from '../src/api';
import Essaim from '../src/views/Essaim';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noeud = (patch: Partial<HiveNode> = {}): HiveNode => ({
  id: 'n-1',
  name: 'ruche-nord',
  ownerName: 'apicultrice',
  agentType: 'shell',
  maxConcurrency: 4,
  running: 1,
  status: 'online',
  lastSeen: null,
  ...patch,
});

const preuve = (
  patch: Partial<{
    essais: number;
    moyenne: number | null;
    score: number | null;
    exploration: boolean;
  }> = {},
) => ({
  essais: 0,
  moyenne: null,
  score: null,
  exploration: true,
  ...patch,
});

const workerAvecModeles = (): WorkerSnapshot =>
  ({
    ...noeud(),
    slotsLibres: 3,
    currentTasks: [],
    modeles: [
      {
        modele: 'alpha',
        categories: {
          ideation: preuve(),
          code: preuve({ essais: 1, moyenne: 1, score: 1, exploration: false }),
          correction: preuve(),
          refactorisation: preuve(),
          test: preuve(),
          documentation: preuve(),
          autre: preuve(),
        },
      },
      {
        modele: 'zeta',
        categories: {
          ideation: preuve(),
          code: preuve(),
          correction: preuve(),
          refactorisation: preuve(),
          test: preuve(),
          documentation: preuve(),
          autre: preuve(),
        },
      },
    ],
  }) as unknown as WorkerSnapshot;

let conteneur: HTMLElement | null = null;
let racine: Root | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  localStorage.setItem('hive.token', 'jeton-worker-dashboard');
  vi.mocked(fetchWorkers).mockReset().mockResolvedValue({ workers: [] });
  vi.mocked(fetchBaptemes).mockReset().mockResolvedValue({ baptemes: [] });
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  conteneur = null;
  racine = null;
  globalThis.fetch = vraiFetch;
  localStorage.clear();
});

async function monter(nodes: HiveNode[] = [noeud()]): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: { projects: [], nodes, tasks: [], tasksTotal: 0 } as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set<string>(),
    onOpenTask: () => undefined,
    onNewProject: () => undefined,
    onNavigate: () => undefined,
    selectedId: null,
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  await act(async () => {
    racine?.render(<Essaim {...props} />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return conteneur;
}

function carte(dom: HTMLElement, id = 'n-1'): HTMLElement {
  const cartes = [...dom.querySelectorAll<HTMLElement>('article.es-node')];
  const trouvee = cartes.find((carte) =>
    carte.textContent?.includes(id === 'n-1' ? 'ruche-nord' : id),
  );
  if (!trouvee) throw new Error(`carte Worker « ${id} » introuvable`);
  return trouvee;
}

describe('projection Worker dans Mission Control', () => {
  it('appelle /api/workers avec le jeton de ruche et conserve la projection reçue', async () => {
    const projection = { workers: [{ ...workerAvecModeles(), modeles: undefined }] };
    const appels: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      appels.push({ url: String(input), init });
      return {
        ok: true,
        status: 200,
        json: async () => projection,
      } as Response;
    }) as typeof fetch;

    const apiReelle = await vi.importActual<typeof import('../src/api')>('../src/api');
    await expect(apiReelle.fetchWorkers()).resolves.toEqual(projection);

    expect(appels).toHaveLength(1);
    expect(appels[0]?.url).toBe('/api/workers');
    expect(new Headers(appels[0]?.init?.headers).get('x-hive-token')).toBe(
      'jeton-worker-dashboard',
    );
  });

  it('rend les modèles déclarés et marque explicitement ceux sans historique « à explorer »', async () => {
    vi.mocked(fetchWorkers).mockResolvedValue({ workers: [workerAvecModeles()] });
    const dom = await monter();
    const modeles = carte(dom).querySelector('[data-testid="worker-models"]');

    expect(modeles).toBeTruthy();
    expect(modeles?.textContent).toContain('alpha');
    expect(modeles?.textContent).toContain('1 essais');
    expect(modeles?.textContent).toContain('zeta');
    expect(modeles?.textContent).toContain('à explorer');
    expect(modeles?.querySelector('.es-model.exploration')?.textContent).toContain('zeta');
  });

  it('rend le travail courant renvoyé par la projection Worker', async () => {
    vi.mocked(fetchWorkers).mockResolvedValue({
      workers: [
        {
          ...workerAvecModeles(),
          currentTasks: [
            {
              id: 'task-live',
              title: 'Corriger le flux',
              status: 'running',
              attempts: 2,
              branch: 'hive/task-live',
              updatedAt: 42,
            },
          ],
        },
      ],
    });

    const dom = await monter();
    const travail = carte(dom).querySelector('[data-testid="worker-current-tasks"]');

    expect(travail?.textContent).toContain('Travail courant');
    expect(travail?.textContent).toContain('Corriger le flux');
    expect(travail?.textContent).toContain('en cours');
    expect(travail?.textContent).toContain('essai 2');
  });

  it('rend le baptême et le métier du Worker depuis la projection unifiée', async () => {
    vi.mocked(fetchWorkers).mockResolvedValue({
      workers: [
        {
          ...workerAvecModeles(),
          identite: {
            bapteme: { nom: 'Capucine', baptiseA: 1 },
            metier: { metier: 'edite', assigneA: 2 },
          },
        },
      ],
    });
    const dom = await monter();
    const card = carte(dom);

    expect(card.textContent).toContain('Capucine');
    expect(card.querySelector('[data-testid="worker-role"]')?.textContent).toContain('Édite');
  });

  it('ne fabrique aucun profil quand la projection ne contient aucun Worker correspondant', async () => {
    vi.mocked(fetchWorkers).mockResolvedValue({ workers: [] });
    const dom = await monter();
    const c = carte(dom);

    expect(c.querySelector('[data-testid="worker-models"]')).toBeNull();
    expect(c.textContent).not.toContain('à explorer');
    expect(c.textContent).toContain('ruche-nord');
  });
});
