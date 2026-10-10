// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// SANDBOX LIVE, À L'ÉCRAN — du flux de la Reine à la vue, montée dans la vraie
// coquille (`App`), seul le réseau simulé.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// · une exécution vivante paraît avec sa phase, sa commande, son ouvrière, son
//   agent, son modèle commandé, son bac DÉCLARÉ, ses sous-agents EN ARBRE, ses
//   fichiers constatés et ses validations à mesure qu'elles concluent ;
// · une mesure absente s'écrit « inconnu », jamais 0 ;
// · « Pause » n'est offert que si l'ouvrière a dit savoir le faire ; l'écran
//   n'affiche « en pause » que sur CONFIRMATION (l'état), pas au clic ;
// · le diff se DEMANDE ; « Expliquer » relit l'état consigné ;
// · l'état disparaît à la fin de l'exécution — reçue, ou manquée pendant une
//   coupure (l'instantané suivant ne la dit plus vivante) — et revient tel que
//   la Reine le rend à la reconnexion.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  connectFeed: vi.fn(() => ({ close: () => {}, reconnecter: () => {} })),
  fetchPulse: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  authMe: vi.fn(() => Promise.reject(new Error('pas de compte simulé'))),
  fetchRoutage: vi.fn(() => Promise.resolve({ taskId: 't-live', affectations: [] })),
  pauseTask: vi.fn(() => Promise.resolve({ transmis: true })),
  cancelTask: vi.fn(() => Promise.resolve({})),
  fetchDiffDirect: vi.fn(() =>
    Promise.resolve({
      taskId: 't-live',
      nodeId: 'noeud-1',
      diff: 'diff --git a/x b/x\n+ajout [secret]\n',
      tronque: false,
    }),
  ),
}));

import { connectFeed, fetchDiffDirect, pauseTask } from '../dashboard/src/api';
import type { FeedHandlers } from '../dashboard/src/api';
import { App } from '../dashboard/src/App';
import { ToastProvider } from '../dashboard/src/composants';
import type { DirectTache } from '../src/shared/bac-direct';
import { laisserFinirLesVuesParesseuses } from './aide/vues-paresseuses';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  localStorage.clear();
  location.hash = '#/sandbox';
});
afterEach(async () => {
  await laisserFinirLesVuesParesseuses();
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  location.hash = '';
  vi.mocked(pauseTask).mockClear();
});

const tache = (status: 'running' | 'done') => ({
  id: 't-live',
  projectId: 'p-1',
  title: 'Écrire le module',
  prompt: 'écris',
  status,
  dependsOn: [],
  assignedNodeId: 'noeud-1',
  result: null,
  branch: null,
  attempts: 1,
  createdAt: 1,
  updatedAt: 1,
});
const instantane = (status: 'running' | 'done') =>
  ({
    projects: [
      {
        id: 'p-1',
        name: 'Rucher',
        repoUrl: null,
        description: null,
        visibility: 'private',
        ownerId: null,
        createdAt: 1,
      },
    ],
    nodes: [
      {
        id: 'noeud-1',
        name: 'poste-de-marie',
        ownerName: 'Marie',
        agentType: 'claude-code',
        status: 'online',
        maxConcurrency: 1,
        lastSeen: 1,
        isolement: { niveau: 'conteneur', fournisseur: 'bubblewrap' },
      },
    ],
    tasks: [tache(status)],
    tasksTotal: 1,
  }) as never;

const direct = (d: Partial<DirectTache>): DirectTache => ({
  taskId: 't-live',
  nodeId: 'noeud-1',
  majA: 1,
  ...d,
});

async function monter(): Promise<{ dom: HTMLElement; h: FeedHandlers }> {
  let poignees: FeedHandlers | null = null;
  vi.mocked(connectFeed).mockImplementation((h: FeedHandlers) => {
    poignees = h;
    return { close: () => {}, reconnecter: () => {} };
  });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  // Comme `main.tsx` : la coquille vit sous le fournisseur des annonces.
  await act(async () =>
    racine?.render(
      <ToastProvider>
        <App />
      </ToastProvider>,
    ),
  );
  await act(async () => {});
  return { dom: conteneur, h: poignees as unknown as FeedHandlers };
}

async function vue(dom: HTMLElement): Promise<void> {
  for (let i = 0; i < 50 && !dom.querySelector('.bd-view'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(dom.querySelector('.bd-view'), 'la vue Sandbox Live ne s’affiche pas').not.toBeNull();
}

const texte = (dom: HTMLElement, testid: string): string =>
  dom.querySelector(`[data-testid="${testid}"]`)?.textContent ?? '';

describe('Sandbox Live — la vue, dans la coquille', () => {
  it('A SA CASE ET SA TOUCHE, et dit quand rien ne tourne', async () => {
    const { dom, h } = await monter();
    await act(async () => h.onState(instantane('done')));
    await vue(dom);
    const case_ = [...dom.querySelectorAll('.mc-nav-cell')].find(
      (x) => x.querySelector('.mc-nav-label')?.textContent === 'Sandbox Live',
    ) as HTMLElement;
    expect(case_.title).toBe('Sandbox Live (touche l)');
    expect(dom.textContent).toContain('Aucune exécution en cours');
  });

  it('UNE EXÉCUTION VIVANTE : ses faits, son arbre, ses validations — « inconnu » là où rien n’est mesuré', async () => {
    const { dom, h } = await monter();
    await act(async () => h.onState(instantane('running')));
    await act(async () => {
      h.onEvent({
        id: 1,
        ts: 1,
        type: 'task_assigned',
        payload: { taskId: 't-live', nodeId: 'noeud-1', modele: 'claude-opus-5' },
      });
      h.onEvent({
        id: 2,
        ts: 1,
        type: 'task_progress',
        payload: {
          taskId: 't-live',
          nodeId: 'noeud-1',
          subAgents: [
            { id: 'sa-1', name: 'Explorer', status: 'done' },
            { id: 'sa-2', name: 'Lire le module', status: 'running', parentId: 'sa-1' },
          ],
          presences: [{ toolUseId: 'tu-1', chemin: 'src/module.ts', outil: 'Edit' }],
        },
      });
      h.onDirect?.(
        't-live',
        direct({ phase: 'agent', commande: 'claude -p [secret] …', pausable: false }),
      );
    });
    await vue(dom);

    expect(texte(dom, 'bd-compte')).toContain('1 exécution(s) en cours');
    const detail = texte(dom, 'bd-detail');
    expect(detail).toContain('poste-de-marie');
    expect(detail).toContain('Claude Code');
    expect(detail).toContain('claude-opus-5');
    expect(detail).toContain('bubblewrap (déclaré)');
    expect(texte(dom, 'bd-commande')).toBe('claude -p [secret] …');
    expect(dom.querySelector('.bd-etape-en_cours')?.textContent).toBe('Agent');
    expect(detail).toContain('src/module.ts');
    // L'arbre : « Lire le module » SOUS « Explorer », pas à côté.
    const imbrique = dom.querySelector('[data-testid="bd-arbre"] .bd-arbre .bd-arbre');
    expect(imbrique?.textContent).toContain('Lire le module');
    // Rien de mesuré : « inconnu » partout, jamais 0.
    expect(texte(dom, 'bd-mesures').match(/inconnu/g)?.length).toBe(4);
    expect(texte(dom, 'bd-mesures')).not.toMatch(/\b0\b/);
    // L'ouvrière a dit ne pas savoir suspendre : le bouton n'existe pas.
    expect(dom.querySelector('[data-testid="bd-pause"]')).toBeNull();

    await act(async () =>
      h.onDirect?.(
        't-live',
        direct({
          phase: 'validations',
          metriques: {
            source: 'arbre',
            cpuPct: 42.5,
            memoireOctets: 300 * 1024 ** 2,
            memoire: 'somme_rss',
            processus: 3,
          },
          controles: { lint: 'passed', tests: 'en_cours' },
        }),
      ),
    );
    expect(texte(dom, 'bd-mesures')).toContain('42.5 %');
    // La mémoire dit laquelle elle est : ici la somme des RSS, qui compte une
    // page partagée par processus — jamais présentée comme autre chose.
    expect(texte(dom, 'bd-mesures')).toContain(
      '300 Mio (somme des RSS — pages partagées comptées par processus)',
    );
    expect(texte(dom, 'bd-controles')).toContain('lintréussie');
    expect(texte(dom, 'bd-controles')).toContain('testsen cours');
  });

  it('LA PAUSE : offerte si possible, affichée sur CONFIRMATION, puis la reprise', async () => {
    const { dom, h } = await monter();
    await act(async () => h.onState(instantane('running')));
    await act(async () => h.onDirect?.('t-live', direct({ phase: 'agent', pausable: true })));
    await vue(dom);
    const bouton = () => dom.querySelector<HTMLButtonElement>('[data-testid="bd-pause"]');
    expect(bouton()?.textContent).toBe('Pause');

    await act(async () => bouton()?.click());
    expect(pauseTask).toHaveBeenCalledWith('t-live', false);
    // Transmis, pas encore confirmé : l'écran ne prétend rien.
    expect(dom.querySelector('[data-testid="bd-en-pause"]')).toBeNull();

    await act(async () =>
      h.onDirect?.('t-live', direct({ phase: 'agent', pausable: true, enPause: true })),
    );
    expect(dom.querySelector('[data-testid="bd-en-pause"]')).not.toBeNull();
    expect(bouton()?.textContent).toBe('Reprendre');
    await act(async () => bouton()?.click());
    expect(pauseTask).toHaveBeenLastCalledWith('t-live', true);
  });

  it('LE DIFF SE DEMANDE ; « EXPLIQUER » RELIT L’ÉTAT ET LA DERNIÈRE SORTIE', async () => {
    const { dom, h } = await monter();
    await act(async () => h.onState(instantane('running')));
    await act(async () => {
      h.onDirect?.('t-live', direct({ phase: 'agent' }));
      h.onSortie?.('t-live', 'noeud-1', 'lecture de module.ts\nécriture du test\n');
    });
    await vue(dom);
    expect(fetchDiffDirect).not.toHaveBeenCalled();
    await act(async () => dom.querySelector<HTMLButtonElement>('[data-testid="bd-diff"]')?.click());
    await act(async () => {});
    expect(fetchDiffDirect).toHaveBeenCalledWith('t-live');
    expect(texte(dom, 'bd-diff-texte')).toContain('+ajout [secret]');

    await act(async () =>
      dom.querySelector<HTMLButtonElement>('[data-testid="bd-expliquer"]')?.click(),
    );
    const explication = texte(dom, 'bd-explication');
    expect(explication).toContain('aucun nouvel appel de modèle');
    expect(explication).toContain('Agent');
    expect(explication).toContain('écriture du test');
  });

  it('LA FIN EFFACE L’ÉTAT — reçue, ou manquée ; la reconnexion le rend', async () => {
    const { dom, h } = await monter();
    await act(async () => h.onState(instantane('running')));
    await act(async () => h.onDirect?.('t-live', direct({ phase: 'agent', commande: 'claude' })));
    await vue(dom);
    expect(texte(dom, 'bd-commande')).toBe('claude');

    // Fin reçue : l'état est oublié (la tâche vit encore dans l'instantané).
    await act(async () =>
      h.onEvent({ id: 5, ts: 1, type: 'task_requeued', payload: { taskId: 't-live' } }),
    );
    expect(dom.querySelector('[data-testid="bd-commande"]')).toBeNull();

    // Reconnexion : la Reine rend l'état qu'elle garde.
    await act(async () => h.onDirect?.('t-live', direct({ phase: 'agent', commande: 'claude' })));
    expect(texte(dom, 'bd-commande')).toBe('claude');
    // `null` de la Reine : fini.
    await act(async () => h.onDirect?.('t-live', null));
    expect(dom.querySelector('[data-testid="bd-commande"]')).toBeNull();

    // Fin MANQUÉE pendant une coupure : l'instantané suivant ne la dit plus vivante.
    await act(async () => h.onDirect?.('t-live', direct({ phase: 'agent', commande: 'claude' })));
    await act(async () => h.onState(instantane('done')));
    expect(dom.textContent).toContain('Aucune exécution en cours');
    await act(async () => h.onState(instantane('running')));
    expect(dom.querySelector('[data-testid="bd-commande"]')).toBeNull();
  });
});
