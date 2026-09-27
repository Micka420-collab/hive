// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA CHAMBRE, À L'ÉCRAN — onglets identité, filtres missions, lien Rayon.

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import { useDialog } from '../dashboard/src/ui';
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
  fetchQueenCles: vi.fn(() =>
    Promise.resolve({
      fournisseurs: [
        {
          id: 'openrouter',
          libelleFr: 'OpenRouter',
          libelleEn: 'OpenRouter',
          envVar: 'OPENROUTER_API_KEY',
          hintFr: 'Queen Bee',
          hintEn: 'Queen Bee',
        },
      ],
      presence: [{ id: 'openrouter', envVar: 'OPENROUTER_API_KEY', presente: false }],
    }),
  ),
  poserQueenCle: vi.fn(),
  appliquerMotif: vi.fn(),
  ajouterHorizon: vi.fn(),
  ouvrirFabrique: vi.fn(),
  poserStatutFabrique: vi.fn(),
  fetchMotifsPerso: vi.fn(() => Promise.resolve({ motifs: [] })),
  creerMotifPerso: vi.fn(),
  appliquerMotifPerso: vi.fn(),
  demarrerAtelier: vi.fn(),
  arreterAtelier: vi.fn(),
}));

import {
  ajouterHorizon,
  appliquerMotif,
  demarrerAtelier,
  fetchChambre,
  fetchMotifs,
  fetchQueenCles,
  ouvrirFabrique,
  poserQueenCle,
  poserStatutFabrique,
  fetchMotifsPerso,
  creerMotifPerso,
  appliquerMotifPerso,
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
  vi.mocked(demarrerAtelier).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(ouvrirFabrique).mockReset().mockResolvedValue({ ok: true, id: 'fab-1' });
  vi.mocked(poserQueenCle).mockReset();
  vi.mocked(poserStatutFabrique).mockReset();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  // Des cas forcent `document.activeElement` (happy-dom ne pose pas toujours
  // le focus où on le veut). On RETIRE la surcharge : la « restaurer » par un
  // getter figé sur `body` laissait les cas suivants sans aucun focus réel.
  Reflect.deleteProperty(document, 'activeElement');
});

async function monter(
  onNavigate: ViewProps['onNavigate'] = () => {},
  events: ViewProps['events'] = [],
): Promise<HTMLElement> {
  // Un seul root à la fois — un second monter() sans afterEach polluait le DOM.
  if (racine) {
    act(() => racine!.unmount());
    conteneur?.remove();
    racine = null;
    conteneur = null;
  }
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
    expect(chemin.getAttribute('aria-label')).toMatch(/src\/pont\/mcp\.ts.*Rayon/i);
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

  it('accorde une réquisition cle_api via modal grant', async () => {
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
    await cliquer(accorder);
    const dialog = dom.querySelector('.ch-grant-dialog');
    expect(dialog).toBeTruthy();
    expect(dom.textContent).toContain('Accorder la clé');
    const envInput = dialog!.querySelector('input[type="text"]') as HTMLInputElement;
    const secretInput = dialog!.querySelector('input[type="password"]') as HTMLInputElement;
    expect(envInput.value).toBe('SEEDANCE_API_KEY');
    expect(envInput.readOnly).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(secretInput, 'sk-seedance-test');
      secretInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const confirmer = [...dialog!.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Accorder'),
    ) as HTMLButtonElement;
    await cliquer(confirmer);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(repondreRequisition).toHaveBeenCalledWith('req-1', 'accordee', {
      secret: 'sk-seedance-test',
      envVar: 'SEEDANCE_API_KEY',
    });
  });

  it('ajoute OpenRouter depuis Intégrations → Clés API', async () => {
    vi.mocked(poserQueenCle).mockResolvedValue({ ok: true, envVar: 'OPENROUTER_API_KEY' });
    const dom = await monter();
    await cliquer(dom.querySelector('#ch-tab-integrations')!);
    await act(async () => {});
    const ajouter = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Ajouter'),
    ) as HTMLButtonElement;
    expect(ajouter).toBeTruthy();
    await cliquer(ajouter);
    const dialog = dom.querySelector('.ch-grant-dialog');
    expect(dialog).toBeTruthy();
    expect(dom.textContent).toContain('Ajouter une clé API');
    const envInput = dialog!.querySelector('input[type="text"]') as HTMLInputElement;
    const secretInput = dialog!.querySelector('input[type="password"]') as HTMLInputElement;
    expect(envInput.value).toBe('OPENROUTER_API_KEY');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(secretInput, 'sk-or-ui');
      secretInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sauver = [...dialog!.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Enregistrer'),
    ) as HTMLButtonElement;
    await cliquer(sauver);
    await act(async () => {});
    expect(poserQueenCle).toHaveBeenCalledWith({
      secret: 'sk-or-ui',
      envVar: 'OPENROUTER_API_KEY',
      libelle: 'OpenRouter',
    });
  });

  it('Accorder atelier allume le studio', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        requisitions: [
          {
            id: 'req-atelier',
            nodeId: NODE_ID,
            genre: 'atelier',
            libelle: 'Bureau de recette',
            detail: null,
            statut: 'ouverte',
            creeA: 1,
            closA: null,
          },
        ],
      }),
    );
    const dom = await monter();
    const accorder = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Accorder'),
    ) as HTMLButtonElement;
    await cliquer(accorder);
    await act(async () => {});
    expect(repondreRequisition).toHaveBeenCalledWith('req-atelier', 'accordee');
    expect(demarrerAtelier).toHaveBeenCalled();
    expect(ouvrirFabrique).not.toHaveBeenCalled();
    expect(dom.textContent).toMatch(/atelier allumé|studio started/i);
  });

  it('Accorder mcp ouvre une fabrique (Intégrations)', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        requisitions: [
          {
            id: 'req-mcp',
            nodeId: NODE_ID,
            genre: 'mcp',
            libelle: 'Pont MCP docs',
            detail: null,
            statut: 'ouverte',
            creeA: 1,
            closA: null,
          },
        ],
      }),
    );
    const dom = await monter();
    const accorder = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Accorder'),
    ) as HTMLButtonElement;
    await cliquer(accorder);
    await act(async () => {});
    expect(repondreRequisition).toHaveBeenCalledWith('req-mcp', 'accordee');
    expect(ouvrirFabrique).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        genre: 'mcp',
        libelle: 'Pont MCP docs',
        nodeId: NODE_ID,
      }),
    );
    expect(demarrerAtelier).not.toHaveBeenCalled();
    expect(dom.textContent).toMatch(/fabrique proposée|forge proposal/i);
  });

  it('Accorder binaire affiche un hint nommé', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        requisitions: [
          {
            id: 'req-bin',
            nodeId: NODE_ID,
            genre: 'binaire',
            libelle: 'Binaire claude',
            detail: null,
            statut: 'ouverte',
            creeA: 1,
            closA: null,
          },
        ],
      }),
    );
    const dom = await monter();
    const accorder = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Accorder'),
    ) as HTMLButtonElement;
    await cliquer(accorder);
    await act(async () => {});
    expect(repondreRequisition).toHaveBeenCalledWith('req-bin', 'accordee');
    expect(ouvrirFabrique).not.toHaveBeenCalled();
    expect(demarrerAtelier).not.toHaveBeenCalled();
    expect(dom.textContent).toMatch(/installez « claude »|install « claude »/i);
    expect(dom.textContent).toMatch(/Accordez à nouveau|Grant again/i);
  });

  it('Accorder logiciel ouvre une fabrique script_npm', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        requisitions: [
          {
            id: 'req-log',
            nodeId: NODE_ID,
            genre: 'logiciel',
            libelle: 'Outil lint maison',
            detail: null,
            statut: 'ouverte',
            creeA: 1,
            closA: null,
          },
        ],
      }),
    );
    const dom = await monter();
    const accorder = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Accorder'),
    ) as HTMLButtonElement;
    await cliquer(accorder);
    await act(async () => {});
    expect(repondreRequisition).toHaveBeenCalledWith('req-log', 'accordee');
    expect(ouvrirFabrique).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        genre: 'script_npm',
        libelle: 'Outil lint maison',
        nodeId: NODE_ID,
      }),
    );
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

  it('passe une fabrique proposée en revue', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        fabriques: [
          {
            id: 'fab-1',
            genre: 'script_npm',
            libelle: 'Lint CI',
            nomScript: 'lint',
            statut: 'proposee',
            creeA: 1,
          },
        ],
      }),
    );
    vi.mocked(poserStatutFabrique).mockResolvedValue({ ok: true, statut: 'en_revue' });
    const dom = await monter();
    await cliquer(dom.querySelector('#ch-tab-integrations')!);
    await act(async () => {});
    const revue = [...dom.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').trim() === 'Revue',
    ) as HTMLButtonElement;
    expect(revue).toBeTruthy();
    await cliquer(revue);
    expect(poserStatutFabrique).toHaveBeenCalledWith(PROJECT_ID, 'fab-1', 'en_revue');
  });

  it('crée et applique une procédure perso', async () => {
    vi.mocked(fetchMotifsPerso).mockResolvedValue({
      motifs: [
        {
          id: 'mp-1',
          libelle: 'Mon flux',
          etapes: ['Étape A', 'Étape B'],
          creeA: 1,
        },
      ],
    });
    vi.mocked(creerMotifPerso).mockResolvedValue({
      ok: true,
      id: 'mp-1',
      libelle: 'Mon flux',
      etapes: ['Étape A', 'Étape B'],
    });
    vi.mocked(appliquerMotifPerso).mockResolvedValue({
      ok: true,
      motifId: 'mp-1',
      taskIds: ['t-a', 't-b'],
      titres: ['Étape A', 'Étape B'],
    });
    const dom = await monter();
    await cliquer(dom.querySelector('#ch-tab-integrations')!);
    await act(async () => {});
    expect(dom.textContent).toContain('Procédures perso');
    const libelle = dom.querySelector('.ch-motif-perso-form input') as HTMLInputElement;
    const etapes = dom.querySelector('.ch-motif-perso-form textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setterInput = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      const setterTextarea = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setterInput.call(libelle, 'Mon flux');
      libelle.dispatchEvent(new Event('input', { bubbles: true }));
      setterTextarea.call(etapes, 'Étape A\nÉtape B');
      etapes.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const creer = [...dom.querySelectorAll('.ch-motif-perso-form button')].find((b) =>
      (b.textContent ?? '').includes('Créer'),
    ) as HTMLButtonElement;
    await cliquer(creer);
    expect(creerMotifPerso).toHaveBeenCalledWith(PROJECT_ID, {
      libelle: 'Mon flux',
      etapes: ['Étape A', 'Étape B'],
    });
    await act(async () => {});
    const appliquer = [...dom.querySelectorAll('button')].find(
      (b) =>
        (b.textContent ?? '').includes('Appliquer') &&
        b.closest('.ch-motifs')?.textContent?.includes('Mon flux'),
    ) as HTMLButtonElement;
    await cliquer(appliquer);
    expect(appliquerMotifPerso).toHaveBeenCalledWith(PROJECT_ID, 'mp-1');
  });

  it('dit que l’atelier est éteint (HIVE_ATELIER=off)', async () => {
    const dom = await monter();
    expect(dom.textContent).toMatch(/Bureau de recette éteint/);
    expect(dom.textContent).toMatch(/Atelier désactivé \(HIVE_ATELIER=off\)/);
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

  it('affiche l’activité durable relue par la Chambre après reconnexion', async () => {
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        journal: [
          {
            id: 91,
            ts: 2,
            type: 'task_retry',
            payload: { taskId: 't-historique', reason: 'Worker hors ligne' },
          },
        ],
      }),
    );
    const dom = await monter();
    expect(dom.textContent).toContain('task_retry');
    expect(dom.textContent).toContain('t-historique');
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
    await act(async () => {});
    const champ = dom.querySelector('#ch-horizon-texte') as HTMLInputElement;
    expect(champ).toBeTruthy();
    // happy-dom + ordre mélangé : focus() ne tient pas toujours — on force
    // activeElement comme pour le banc iframe (sinon Échap ramène à la Ruche).
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => champ,
    });
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
      expect(dom.querySelector('[data-testid="chambre-poll-soft"]')?.textContent).toMatch(
        /Actualisation interrompue/,
      );
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
    vi.mocked(appliquerMotif).mockResolvedValue({
      ok: true,
      motifId: 'm1',
      taskIds: ['t-a', 't-b'],
      titres: ['a', 'b'],
    });
    vi.mocked(fetchChambre).mockResolvedValue(
      poste({
        fabriques: [
          {
            id: 'f1',
            genre: 'script_npm',
            libelle: 'lint',
            nomScript: 'lint.sh',
            statut: 'proposee',
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
    expect(dom.textContent).toContain('Clés API');
    expect(dom.textContent).toContain('OpenRouter');
    expect(fetchQueenCles).toHaveBeenCalled();
    expect(dom.textContent).toContain('Fabrique');
    expect(dom.textContent).toContain('lint');
    expect(dom.textContent).toMatch(/proposée/);
    expect(dom.textContent).toContain('Revue courte');
    const appliquer = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Appliquer'),
    ) as HTMLButtonElement;
    expect(appliquer).toBeTruthy();
    expect(appliquer.getAttribute('aria-label')).toMatch(/Appliquer.*Revue courte/i);
    await cliquer(appliquer);
    await act(async () => {});
    expect(dom.textContent).toMatch(/Appliquer le motif/);
    const confirmer = [...dom.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Confirmer'),
    ) as HTMLButtonElement;
    expect(confirmer).toBeTruthy();
    await cliquer(confirmer);
    await act(async () => {});
    expect(appliquerMotif).toHaveBeenCalled();
    expect(dom.textContent).toMatch(/Motif appliqué/);

    await cliquer(dom.querySelector('#ch-tab-suivi')!);
    expect(dom.textContent).toContain('Compile');
    expect(dom.textContent).toContain('Seedance ok');
    expect(dom.textContent).toMatch(/demo/);
    const input = dom.querySelector('#ch-horizon-texte') as HTMLInputElement;
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
    expect(dom.textContent).toMatch(/Fait noté/);
  });

  it('affiche Catalogue injoignable si fetchMotifs échoue', async () => {
    vi.mocked(fetchMotifs).mockRejectedValue(new Error('réseau'));
    const dom = await monter();
    await cliquer(dom.querySelector('#ch-tab-integrations')!);
    await act(async () => {});
    expect(dom.textContent).toMatch(/Catalogue injoignable/);
    expect(dom.textContent).not.toMatch(/Catalogue vide/);
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

// ─── LES DEUX DIALOGUES DE LA CHAMBRE TIENNENT LE CLAVIER ────────────────────
//
// La Chambre appelait `useDialog` au niveau de la VUE, montée en permanence :
// ses deux crochets entraient dans la pile des dialogues dès l'arrivée sur la
// page, dialogue ouvert ou non, et celui du motif s'y tenait au sommet. Le
// dialogue de clé API — celui où l'on colle un secret — ne fermait plus sur
// Échap et laissait Tab filer sous le voile ; un tiroir ouvert AVANT d'entrer
// dans la Chambre perdait de même le clavier. Et comme le crochet agissait au
// montage de la vue, aucun des deux dialogues ne recevait le focus ni ne le
// rendait en se fermant.
//
// Un clic DANS ces deux dialogues remontait en outre jusqu'au voile, qui
// ferme : cliquer dans le champ du secret refermait le dialogue du secret.

describe('les dialogues de la Chambre', () => {
  /** Une touche, tapée là où est le focus ; rend `true` si un écouteur l'a prise. */
  function taper(touche: 'Tab' | 'Escape', maj = false): boolean {
    const ev = new KeyboardEvent('keydown', {
      key: touche,
      shiftKey: maj,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      (document.activeElement ?? document.body).dispatchEvent(ev);
    });
    return ev.defaultPrevented;
  }

  const bouton = (dom: ParentNode, libelle: string): HTMLButtonElement => {
    const b = [...dom.querySelectorAll('button')].find((x) =>
      (x.textContent ?? '').includes(libelle),
    );
    expect(b, `« ${libelle} » introuvable`).toBeTruthy();
    return b as HTMLButtonElement;
  };

  /** Intégrations → Clés API → « Ajouter », le focus posé sur le déclencheur. */
  async function ouvrirCle(dom: HTMLElement): Promise<HTMLButtonElement> {
    await cliquer(dom.querySelector('#ch-tab-integrations')!);
    await act(async () => {});
    const ajouter = bouton(dom, 'Ajouter');
    act(() => ajouter.focus());
    await cliquer(ajouter);
    expect(
      document.querySelector('.ch-grant-dialog'),
      'le dialogue de clé ne s’ouvre pas',
    ).toBeTruthy();
    return ajouter;
  }

  it('LE DIALOGUE DE CLÉ PREND LE FOCUS, FERME SUR ÉCHAP, ET LE REND', async () => {
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    const ajouter = await ouvrirCle(dom);
    const dialogue = document.querySelector('.ch-grant-dialog');
    expect(dialogue?.contains(document.activeElement), 'le focus est resté sous le voile').toBe(
      true,
    );

    taper('Escape');
    expect(
      document.querySelector('.ch-grant-dialog'),
      'Échap ne ferme plus le dialogue',
    ).toBeNull();
    expect(
      onNavigate,
      'Échap a quitté la Chambre au lieu de fermer le dialogue',
    ).not.toHaveBeenCalled();
    expect(document.activeElement, 'le focus n’est pas revenu à « Ajouter »').toBe(ajouter);
  });

  it('TAB RESTE DANS LE DIALOGUE DE CLÉ', async () => {
    const dom = await monter();
    await ouvrirCle(dom);
    const dialogue = document.querySelector<HTMLElement>('.ch-grant-dialog')!;
    const variable = dialogue.querySelector<HTMLInputElement>('input[type="text"]')!;
    // « Enregistrer » est éteint tant que le secret est vide : le dernier
    // arrêt réel de Tab est « Annuler ».
    const annuler = bouton(dialogue, 'Annuler');

    act(() => annuler.focus());
    expect(taper('Tab'), 'Tab sort du dialogue du secret').toBe(true);
    expect(document.activeElement).toBe(variable);

    expect(taper('Tab', true), 'Maj+Tab sort du dialogue du secret').toBe(true);
    expect(document.activeElement).toBe(annuler);
  });

  it('UN CLIC DANS LE DIALOGUE DE CLÉ NE LE FERME PAS — seul le voile ferme', async () => {
    const dom = await monter();
    await ouvrirCle(dom);
    const secret = document.querySelector<HTMLInputElement>(
      '.ch-grant-dialog input[type="password"]',
    );
    await cliquer(secret!);
    expect(
      document.querySelector('.ch-grant-dialog'),
      'cliquer dans le champ du secret a refermé le dialogue',
    ).toBeTruthy();

    await cliquer(document.querySelector('.modal-backdrop')!);
    expect(document.querySelector('.ch-grant-dialog'), 'le voile ne ferme plus').toBeNull();
  });

  it('LE DIALOGUE DU MOTIF PREND LE FOCUS, FERME SUR ÉCHAP, ET LE REND', async () => {
    vi.mocked(fetchMotifs).mockResolvedValue({
      motifs: [
        {
          id: 'm1',
          domaine: 'revue',
          libelleFr: 'Revue courte',
          libelleEn: 'Short review',
          etapes: [{ id: 'e1', titreFr: 'a', titreEn: 'a' }],
        },
      ],
    });
    const onNavigate = vi.fn();
    const dom = await monter(onNavigate);
    await cliquer(dom.querySelector('#ch-tab-integrations')!);
    await act(async () => {});
    const appliquer = bouton(dom, 'Appliquer');
    act(() => appliquer.focus());
    await cliquer(appliquer);

    const dialogue = document.querySelector('.ch-dialog');
    expect(dialogue, 'la confirmation du motif ne s’ouvre pas').toBeTruthy();
    expect(dialogue?.contains(document.activeElement), 'le focus est resté sous le voile').toBe(
      true,
    );
    await cliquer(dialogue!.querySelector('ol')!);
    expect(
      document.querySelector('.ch-dialog'),
      'un clic dans la confirmation l’a fermée',
    ).toBeTruthy();

    taper('Escape');
    expect(document.querySelector('.ch-dialog')).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(document.activeElement, 'le focus n’est pas revenu à « Appliquer »').toBe(appliquer);
  });

  it('UN TIROIR OUVERT AVANT D’ENTRER DANS LA CHAMBRE GARDE LE CLAVIER', async () => {
    // Le tiroir d'une tâche survit à un changement de vue : on l'ouvre, puis
    // « Précédent » ramène sur `#/chambre/<id>`. La Chambre monte SOUS lui.
    function Tiroir({ onClose, children }: { onClose: () => void; children: ReactNode }) {
      const ref = useDialog<HTMLDivElement>(onClose);
      return (
        <div ref={ref} role="dialog" aria-modal="true" aria-label="tiroir">
          {children}
        </div>
      );
    }
    const fermer = vi.fn();
    const hote = document.createElement('div');
    document.body.appendChild(hote);
    const racineTiroir = createRoot(hote);
    try {
      act(() =>
        racineTiroir.render(
          <Tiroir onClose={fermer}>
            <button>tiroir-début</button>
            <button>tiroir-fin</button>
          </Tiroir>,
        ),
      );
      const onNavigate = vi.fn();
      await monter(onNavigate);

      act(() => bouton(hote, 'tiroir-fin').focus());
      expect(taper('Tab'), 'Tab sort du tiroir').toBe(true);
      expect(document.activeElement?.textContent).toBe('tiroir-début');

      taper('Escape');
      expect(fermer, 'le tiroir ne ferme plus sur Échap').toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    } finally {
      act(() => racineTiroir.unmount());
      hote.remove();
    }
  });
});
