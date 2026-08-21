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
  ajouterHorizon: vi.fn(),
  demarrerAtelier: vi.fn(),
  arreterAtelier: vi.fn(),
}));

import {
  ajouterHorizon,
  appliquerMotif,
  fetchChambre,
  fetchMotifs,
  repondreRequisition,
} from '../dashboard/src/api';
import type { MotifCatalogue } from '../dashboard/src/api';
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
  vi.mocked(repondreRequisition).mockReset().mockResolvedValue({ ok: true, statut: 'accordee' });
  vi.mocked(ajouterHorizon)
    .mockReset()
    .mockResolvedValue({ ok: true, entree: { id: 'n1', kind: 'fait', texte: 'x' } });
  vi.mocked(appliquerMotif)
    .mockReset()
    .mockResolvedValue({ ok: true, motifId: 'm1', taskIds: [], titres: [] });
  vi.mocked(fetchMotifs).mockReset().mockResolvedValue({ motifs: [] });
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

async function monter(
  onNavigate: ViewProps['onNavigate'] = () => {},
  events: ViewProps['events'] = [],
): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: {
      projects: [],
      nodes: [],
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
      tasksTotal: 1,
    } as unknown as StateSnapshot,
    events,
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

async function cliquer(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
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

  it('navigue les onglets au clavier (ArrowDown / Home)', async () => {
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

    await act(async () => {
      tablist.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {});
    expect(
      (dom.querySelector('#ch-tab-fiche') as HTMLButtonElement).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('ouvre le Rayon depuis le bouton d’en-tête et depuis un chemin constaté', async () => {
    const onNavigate = vi.fn();
    sessionStorage.clear();
    const dom = await monter(onNavigate);
    const btn = dom.querySelector('[data-testid="chambre-ouvrir-rayon"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await cliquer(btn);
    expect(onNavigate).toHaveBeenCalledWith('rayon', PROJECT_ID);
    expect(sessionStorage.getItem('hive.focus')).toBe('fichier:src/pont/mcp.ts');

    sessionStorage.clear();
    const chemin = dom.querySelector('button.ch-lien-chemin') as HTMLButtonElement;
    expect(chemin?.textContent).toContain('src/pont/mcp.ts');
    await cliquer(chemin);
    expect(onNavigate).toHaveBeenCalledWith('rayon', PROJECT_ID);
    expect(sessionStorage.getItem('hive.focus')).toBe('fichier:src/pont/mcp.ts');
  });

  it('Voir le Rayon sans présence : navigation seule, pas de focus inventé', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(poste({ presences: [] }));
    const onNavigate = vi.fn();
    sessionStorage.clear();
    const dom = await monter(onNavigate);
    await cliquer(dom.querySelector('[data-testid="chambre-ouvrir-rayon"]')!);
    expect(onNavigate).toHaveBeenCalledWith('rayon', PROJECT_ID);
    expect(sessionStorage.getItem('hive.focus')).toBeNull();
  });

  it('chemin constaté SANS projet lié : silence du lien, pas de faux Rayon', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(poste({ projectId: null, tasks: [] }));
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    expect(dom.querySelector('[data-testid="chambre-ouvrir-rayon"]')).toBeNull();
    expect(dom.querySelector('button.ch-lien-chemin')).toBeNull();
    expect(dom.textContent).toContain('src/pont/mcp.ts');
    expect(dom.textContent).toContain('pas de projet lié');
    expect(onNavigate).not.toHaveBeenCalled();
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

  it('accorde une réquisition depuis le bandeau À trancher', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        requisitions: [
          {
            id: 'req-1',
            nodeId: NODE_ID,
            genre: 'cle_api',
            libelle: 'Clé Seedance',
            detail: 'Pour le pont vidéo',
            statut: 'ouverte',
            creeA: 1,
            closA: null,
          },
        ],
      }),
    );
    vi.mocked(repondreRequisition).mockImplementation(
      () =>
        new Promise((resolve) => {
          window.setTimeout(() => resolve({ ok: true, statut: 'accordee' }), 30);
        }),
    );
    const dom = await monter();
    expect(dom.textContent).toContain('À trancher');
    const accorder = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Accorder'),
    ) as HTMLButtonElement;
    const refuser = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Refuser'),
    ) as HTMLButtonElement;
    await cliquer(accorder);
    expect(accorder.disabled).toBe(true);
    expect(refuser.disabled).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(repondreRequisition).toHaveBeenCalledWith('req-1', 'accordee');
  });

  it('refuse une réquisition depuis le bandeau À trancher', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        requisitions: [
          {
            id: 'req-2',
            nodeId: NODE_ID,
            genre: 'mcp',
            libelle: 'Serveur Figma',
            detail: null,
            statut: 'ouverte',
            creeA: 1,
            closA: null,
          },
        ],
      }),
    );
    vi.mocked(repondreRequisition).mockResolvedValue({ ok: true, statut: 'refusee' });
    const dom = await monter();
    const refuser = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Refuser'),
    ) as HTMLButtonElement;
    await cliquer(refuser);
    expect(repondreRequisition).toHaveBeenCalledWith('req-2', 'refusee');
  });

  it('dit que l’atelier est éteint (HIVE_ATELIER=off)', async () => {
    const dom = await monter();
    expect(dom.textContent).toMatch(/Bureau de recette éteint/);
    expect(dom.textContent).toContain('HIVE_ATELIER=off');
  });

  it('pastille EDIT distincte pour une présence Edit', async () => {
    const dom = await monter();
    const edit = dom.querySelector('.ch-badge-edit');
    expect(edit?.textContent).toBe('EDIT');
  });

  it('un événement journal outil+chemin devient un lien Rayon', async () => {
    const onNavigate = vi.fn();
    sessionStorage.clear();
    const events = [
      {
        id: 'ev1',
        ts: 2,
        type: 'tool',
        payload: { nodeId: NODE_ID, outil: 'Read', chemin: 'docs/ADR.md', taskId: 't1' },
      },
    ];
    const dom = await monter(onNavigate, events as never);
    const liens = [...dom.querySelectorAll('button.ch-lien-chemin')].filter((b) =>
      (b.textContent ?? '').includes('docs/ADR.md'),
    );
    expect(liens.length).toBeGreaterThanOrEqual(1);
    await cliquer(liens[0]!);
    expect(sessionStorage.getItem('hive.focus')).toBe('fichier:docs/ADR.md');
    expect(onNavigate).toHaveBeenCalledWith('rayon', PROJECT_ID);
  });

  it('point de statut hors ligne sur la Fiche', async () => {
    const dom = await monter();
    expect(dom.querySelector('.ch-statut-dot.ch-statut-off')).toBeTruthy();
    expect(dom.querySelector('.ch-statut-dot.ch-statut-on')).toBeNull();
  });

  it('point de statut en ligne quand le nœud est online', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        node: {
          id: NODE_ID,
          status: 'online',
          plateforme: 'linux',
          agentType: 'shell',
          ownerName: 'moi',
          running: 1,
          maxConcurrency: 2,
          lastSeen: 1,
          nameTechnique: 'ma-machine',
        },
      }),
    );
    const dom = await monter();
    expect(dom.querySelector('.ch-statut-dot.ch-statut-on')).toBeTruthy();
    expect(dom.querySelector('.ch-live-off')).toBeNull();
    expect(dom.textContent).toMatch(/en ligne/i);
  });

  it('Échap ramène à la Ruche', async () => {
    const onNavigate = vi.fn();
    await monter(onNavigate);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith('ruche');
  });

  it('Échap ne vole pas un dialogue modal ouvert', async () => {
    const onNavigate = vi.fn();
    await monter(onNavigate);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    document.body.appendChild(dlg);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
    dlg.remove();
  });

  it('Échap ne quitte pas pendant la saisie Horizon', async () => {
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    await cliquer(dom.querySelector('#ch-tab-suivi')!);
    const champ = dom.querySelector('.ch-horizon-form input') as HTMLInputElement;
    expect(champ).toBeTruthy();
    champ.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('Échap ne quitte pas si le focus est dans l’iframe Atelier', async () => {
    const onNavigate = vi.fn();
    await monter(onNavigate);
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => iframe,
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
    iframe.remove();
    // Restaurer activeElement (happy-dom).
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => document.body,
    });
  });

  it('un blip fetchChambre ne vide pas un poste déjà chargé', async () => {
    vi.useFakeTimers();
    try {
      let rejet = false;
      vi.mocked(fetchChambre).mockImplementation(async () => {
        if (rejet) throw new Error('blip');
        return poste();
      });
      const dom = await monter();
      expect(dom.textContent).toContain('Capucine');
      rejet = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(dom.textContent).toContain('Capucine');
      expect(dom.textContent).toContain('Actualisation interrompue');
      expect(dom.textContent).not.toMatch(/Chargement…|Loading…/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parcourt Travail, Intégrations (motifs) et Suivi (horizon)', async () => {
    const motif: MotifCatalogue = {
      id: 'm1',
      domaine: 'revue',
      libelleFr: 'Revue courte',
      libelleEn: 'Short review',
      etapes: [
        { id: 'e1', titreFr: 'a', titreEn: 'a' },
        { id: 'e2', titreFr: 'b', titreEn: 'b' },
      ],
    };
    vi.mocked(fetchMotifs).mockResolvedValue({ motifs: [motif] });
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        fabriques: [
          {
            id: 'f1',
            genre: 'script',
            libelle: 'lint',
            nomScript: 'lint.sh',
            statut: 'ouverte',
            creeA: 1,
          },
        ],
        horizon: {
          faits: [{ id: 'h1', texte: 'Compile', source: 'demo', creeA: 1 }],
          hypotheses: [{ id: 'h2', texte: 'Seedance ok', source: 'demo', creeA: 1 }],
        },
      }),
    );
    const dom = await monter();

    await cliquer(dom.querySelector('#ch-tab-travail')!);
    expect(dom.textContent).toContain('Outils en cours');
    expect(dom.textContent).toContain('src/pont/mcp.ts');

    await cliquer(dom.querySelector('#ch-tab-integrations')!);
    await act(async () => {});
    expect(dom.textContent).toContain('Fabrique');
    expect(dom.textContent).toContain('lint');
    expect(dom.textContent).toContain('Revue courte');
    const appliquer = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Appliquer'),
    );
    expect(appliquer).toBeTruthy();
    await cliquer(appliquer!);
    expect(appliquerMotif).toHaveBeenCalled();

    await cliquer(dom.querySelector('#ch-tab-suivi')!);
    expect(dom.textContent).toContain('Compile');
    expect(dom.textContent).toContain('Seedance ok');
    const input = dom.querySelector('input[placeholder="Constater…"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Un fait constaté');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = input.closest('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {});
    expect(ajouterHorizon).toHaveBeenCalledWith(PROJECT_ID, 'fait', 'Un fait constaté');
  });

  it('filtre les missions (Terminées)', async () => {
    const dom = await monter();
    const filtres = dom.querySelector('[data-testid="chambre-filtres-taches"]')!;
    const terminees = [...filtres.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Terminées'),
    )!;
    await cliquer(terminees);
    expect(terminees.getAttribute('aria-pressed')).toBe('true');
  });
});
