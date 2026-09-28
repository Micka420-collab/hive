// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE FILTRE DES TRAVAUX, À L'ÉCRAN — Projets, file de revue, Chantiers.
//
// La règle est jugée seule par `tests/filtre-travaux.test.ts`. Ce banc juge ce
// qu'aucune règle pure ne voit : que chaque écran BRANCHE la barre, qu'un
// filtre qui ne laisse rien le DIT (et offre de l'effacer), que la tâche
// inspectée ne bouge pas quand on filtre la file, et que les Chantiers ne
// disent plus « aucun script » pendant qu'ils lisent.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveNode, StateSnapshot, Task } from '../src/shared/types';
import type { Chantier } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

// Bouchon COMPLET des sondes des trois vues et de leurs enfants : un export
// oublié partirait en vrai vers le port 3000 (voir tests/aide/sans-reseau.ts).
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchBalance: vi.fn(() => Promise.resolve(null)),
  fetchReport: vi.fn(() => Promise.resolve(null)),
  fetchConseils: vi.fn(() => Promise.resolve({ conseils: [] })),
  fetchConseil: vi.fn(() => Promise.reject(new Error('aucune session simulée'))),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'm' })),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchProjetsOuverts: vi.fn(() => Promise.resolve({ projets: [] })),
  fetchDepotsGithub: vi.fn(() => Promise.resolve({ depots: [] })),
  fetchStatutGithub: vi.fn(() => Promise.resolve({ configure: true })),
  fetchMembresProjet: vi.fn(() => Promise.resolve({ membres: [] })),
  fetchPartages: vi.fn(() => Promise.resolve({ partages: [] })),
  fetchIssues: vi.fn(() => Promise.resolve({ issues: [] })),
  fetchLivraisons: vi.fn(() => Promise.resolve({ livraisons: [] })),
  planBrief: vi.fn(() => Promise.resolve({ tasks: [], source: 'heuristic' })),
  addTasks: vi.fn(() => Promise.resolve([])),
  fetchEssaim: vi.fn(() => Promise.resolve(null)),
  fetchProjectBalance: vi.fn(() => Promise.resolve(null)),
  fetchReviews: vi.fn(() => Promise.resolve({ reviews: {} })),
  fetchGardeFou: vi.fn(() => Promise.resolve(null)),
  postReview: vi.fn(() => Promise.resolve()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchEvaluation: vi.fn(() => Promise.resolve(null)),
  fetchCritique: vi.fn(() => Promise.resolve({ taskId: '', raisonRevue: null, reprise: null })),
  fetchChantiers: vi.fn(),
  fetchVerdictChantier: vi.fn(() => Promise.resolve({ resultat: null })),
  fetchWorkflows: vi.fn(() => Promise.resolve({ workflows: [], tronque: false })),
  fetchRuns: vi.fn(() => Promise.resolve({ runs: [] })),
  lancerChantier: vi.fn(),
  lancerWorkflowGithub: vi.fn(),
}));

import { fetchChantiers, fetchWorkflows } from '../dashboard/src/api';
import Chantiers from '../dashboard/src/views/Chantiers';
import Miellerie from '../dashboard/src/views/Miellerie';
import Projets from '../dashboard/src/views/Projets';
import { couperLeReseau } from './aide/sans-reseau';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  couperLeReseau();
  setLang('fr');
  vi.mocked(fetchChantiers)
    .mockReset()
    .mockResolvedValue({ chantiers: [SCRIPT] });
  vi.mocked(fetchWorkflows)
    .mockReset()
    .mockResolvedValue({ workflows: [WORKFLOW], tronque: false });
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const SCRIPT: Chantier = {
  nom: 'test',
  nature: 'verification',
  commande: 'vitest run',
  automatisable: true,
};
const WORKFLOW = {
  id: 7,
  nom: 'CI',
  chemin: '.github/workflows/ci.yml',
  etat: 'actif' as const,
  htmlUrl: 'https://example.invalid/wf',
};

function tache(id: string, projectId: string, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId,
    title: `Tâche ${id}`,
    prompt: 'p',
    status: 'done',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 1,
    ...over,
  };
}

function noeud(id: string, name: string, agentType: string): HiveNode {
  return {
    id,
    name,
    ownerName: 'Maya',
    agentType,
    maxConcurrency: 1,
    running: 0,
    status: 'online',
    lastSeen: 0,
  };
}

function projet(id: string, name: string, createdAt: number) {
  return {
    id,
    name,
    repoUrl: null,
    description: null,
    visibility: 'private' as const,
    ownerId: null,
    createdAt,
  };
}

const NOEUDS = [
  noeud('n-codex', 'atelier-codex', 'codex'),
  noeud('n-claude', 'poste-claude', 'claude-code'),
];

function instantane(tasks: Task[]): StateSnapshot {
  return {
    projects: [projet('p1', 'Rucher', 2), projet('p2', 'Miel', 1)],
    nodes: NOEUDS,
    tasks,
    tasksTotal: tasks.length,
  };
}

const TACHES = [
  tache('t-auth', 'p1', { title: 'Réparer l’authentification', assignedNodeId: 'n-codex' }),
  tache('t-cache', 'p1', { title: 'Cache Redis', assignedNodeId: 'n-claude' }),
  tache('t-doc', 'p2', {
    title: 'Documenter le miel',
    status: 'failed',
    assignedNodeId: 'n-claude',
  }),
];

async function monter(
  Vue: (p: ViewProps) => React.ReactNode,
  over: Partial<ViewProps> = {},
): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: instantane(TACHES),
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
    user: null,
    ...over,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Vue {...props} />));
  await act(async () => {});
  return conteneur;
}

function champRecherche(dom: HTMLElement): HTMLInputElement {
  const champ = dom.querySelector<HTMLInputElement>('input[type="search"]');
  expect(champ, 'la barre de filtre est absente').toBeTruthy();
  return champ!;
}

/** Valeur native + événement : ce que React écoute sur un champ contrôlé. */
async function saisir(el: HTMLInputElement | HTMLSelectElement, valeur: string): Promise<void> {
  await act(async () => {
    const proto = Object.getPrototypeOf(el) as object;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, valeur);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

function choix(dom: HTMLElement, libelle: string): HTMLSelectElement {
  const label = [...dom.querySelectorAll('label')].find((l) => l.textContent?.trim() === libelle);
  expect(label, `choix « ${libelle} » introuvable`).toBeTruthy();
  return dom.querySelector<HTMLSelectElement>(`#${CSS.escape(label!.htmlFor)}`)!;
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((x) => x.textContent?.includes(libelle));
  expect(b, `bouton « ${libelle} » introuvable`).toBeTruthy();
  return b!;
}

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const cartes = (dom: HTMLElement) =>
  [...dom.querySelectorAll('.pj-card .pj-name')].map((h) => h.textContent);

describe('Projets — la barre filtre les projets ET leurs tâches', () => {
  it('une recherche ne garde que les projets où elle trouve, et liste les tâches trouvées', async () => {
    const ouvertes: string[] = [];
    const dom = await monter(Projets, { onOpenTask: (id: string) => ouvertes.push(id) });
    expect(cartes(dom)).toEqual(['Rucher', 'Miel']);

    // Accent et casse ignorés : « authentification » est écrit « l’authentification ».
    await saisir(champRecherche(dom), 'AUTHENTIFICATION');
    expect(cartes(dom)).toEqual(['Rucher']);
    const trouvees = dom.querySelector('.pj-trouvees');
    expect(trouvees?.textContent).toContain('Réparer l’authentification');
    expect(trouvees?.textContent).not.toContain('Cache Redis');
    // La carte dit ce que le filtre lui retire, au lieu de « aucune tâche ».
    expect(dom.querySelector('[data-testid="pj-masquees"]')?.textContent).toContain('1 tâche');

    await cliquer(trouvees!.querySelector<HTMLElement>('li.clickable')!);
    expect(ouvertes).toEqual(['t-auth']);
  });

  it('famille et ouvrière viennent des ouvrières inscrites, et trient', async () => {
    const dom = await monter(Projets);
    await saisir(choix(dom, 'Famille d’agent'), 'claude-code');
    expect(cartes(dom)).toEqual(['Rucher', 'Miel']);
    await saisir(choix(dom, 'Statut'), 'failed');
    expect(cartes(dom)).toEqual(['Miel']);
    await saisir(choix(dom, 'Ouvrière'), 'n-codex');
    expect(cartes(dom)).toEqual([]);
  });

  it('UN FILTRE QUI NE LAISSE RIEN LE DIT, et « Effacer » rend tout — focus compris', async () => {
    const dom = await monter(Projets);
    await saisir(champRecherche(dom), 'introuvable');
    expect(cartes(dom)).toEqual([]);
    expect(dom.textContent).toContain('Aucun projet ne correspond');
    expect(dom.querySelector('[data-testid="filtre-compte"]')?.textContent).toBe(
      '0 sur 2 affiché(s)',
    );

    // Celui de la barre : il disparaît avec le filtre, le focus revient au champ.
    const barre = dom.querySelector<HTMLElement>('[role="search"]')!;
    await cliquer(bouton(barre, 'Effacer les filtres'));
    expect(cartes(dom)).toEqual(['Rucher', 'Miel']);
    expect(champRecherche(dom).value).toBe('');
    expect(document.activeElement).toBe(champRecherche(dom));
  });
});

describe('Miellerie — le filtre resserre la file, jamais l’inspection', () => {
  it('la file ne garde que l’ouvrière choisie ; la tâche inspectée reste', async () => {
    const dom = await monter(Miellerie, { selectedId: 't-auth' } as Partial<ViewProps>);
    const lignes = () =>
      [...dom.querySelectorAll('.mi-row .mi-row-title')].map((x) => x.textContent);
    expect(lignes()).toHaveLength(3);

    await saisir(choix(dom, 'Ouvrière'), 'n-claude');
    expect(lignes()).toEqual(['Cache Redis', 'Documenter le miel']);
    // La production inspectée n'est PAS dans le filtre, et elle reste à l'écran.
    expect(dom.querySelector('.mi-inspect h2')?.textContent).toBe('Réparer l’authentification');
  });

  it('une file vidée par le filtre ne se fait pas passer pour une file vide', async () => {
    const dom = await monter(Miellerie);
    await saisir(champRecherche(dom), 'zzz');
    expect(dom.querySelectorAll('.mi-row')).toHaveLength(0);
    expect(dom.textContent).toContain('Rien ne passe ce filtre');
    expect(dom.textContent).toContain('3 production(s) attendent');
    expect(dom.textContent).not.toContain('aucune production à revoir');
  });

  it('le statut n’offre que ce que la file porte : terminée, échouée', async () => {
    const dom = await monter(Miellerie);
    const options = [...choix(dom, 'Statut').options].map((o) => o.value);
    expect(options).toEqual(['', 'done', 'failed']);
  });
});

describe('Chantiers — lire, échouer, filtrer', () => {
  it('PENDANT LA LECTURE, l’écran ne dit pas « aucun script »', async () => {
    // Régression : la liste partait VIDE (`[]`), et l'écran affirmait « Ce
    // dépôt ne déclare aucun script » tant que la réponse n'était pas là.
    vi.mocked(fetchChantiers).mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchWorkflows).mockReturnValue(new Promise(() => {}));
    const dom = await monter(Chantiers);
    expect(dom.textContent).not.toContain('aucun script');
    expect(dom.textContent).not.toContain('Aucun workflow déclaré');
    const lectures = [...dom.querySelectorAll('[role="status"][aria-busy="true"]')].map(
      (s) => s.textContent,
    );
    expect(lectures).toEqual(['Lecture des chantiers…', 'Lecture des workflows…']);
  });

  it('UNE LECTURE RATÉE SE RETENTE — « Réessayer » relance la lecture', async () => {
    vi.mocked(fetchChantiers).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const dom = await monter(Chantiers);
    const alerte = dom.querySelector('[role="alert"]');
    expect(alerte?.textContent).toContain('Chantiers illisibles');
    expect(alerte?.textContent).toContain('La ruche n’a pas répondu');

    await cliquer(bouton(dom, 'Réessayer'));
    await act(async () => {});
    expect(fetchChantiers).toHaveBeenCalledTimes(2);
    expect(dom.querySelector('[role="alert"]')).toBeNull();
    expect(dom.textContent).toContain('vitest run');
  });

  it('la nature trie scripts et workflows ; la recherche lit la commande', async () => {
    const dom = await monter(Chantiers);
    const noms = () => [...dom.querySelectorAll('.ch-item strong')].map((s) => s.textContent);
    expect(noms()).toEqual(['test', 'CI']);

    await saisir(choix(dom, 'Nature'), 'github');
    expect(noms()).toEqual(['CI']);
    await saisir(choix(dom, 'Nature'), '');
    await saisir(champRecherche(dom), 'vitest');
    expect(noms()).toEqual(['test']);
    expect(dom.textContent).toContain('Aucun workflow ne passe ce filtre.');
  });
});
