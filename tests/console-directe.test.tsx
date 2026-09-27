// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA CONSOLE EN DIRECT, CÔTÉ ÉCRAN — le tampon, le tiroir, le journal.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// · le tampon d'une tâche tient sous 256 Kio et DIT qu'il a perdu son début ;
// · l'état en direct est vidé à la fin de vie de la tâche, et à chaque
//   instantané pour une tâche qui n'y vit plus (un `task_done` manqué pendant
//   une coupure le laissait sinon pour toujours) ;
// · le tiroir d'une tâche en cours montre la sortie, avec recherche et repli ;
// · la ligne `task_progress` du journal dit son jalon, pas « progrès ».

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveEvent, HiveNode, Task } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import {
  ajouterSortie,
  garderVivantes,
  oublierTache,
  SORTIE_ECRAN_MAX_OCTETS,
  type SortiesDirectes,
} from '../dashboard/src/sorties-directes';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchDelegationGraph: vi.fn(() =>
    Promise.resolve({ taskId: 't', rootTaskId: 't', graph: [], delegations: [], events: [] }),
  ),
  fetchRace: vi.fn(() => Promise.resolve({ race: null, victory: null })),
  fetchChronologie: vi.fn(() => new Promise(() => undefined)),
  fetchRoutage: vi.fn(() => new Promise(() => undefined)),
}));
vi.mock('../dashboard/src/CodeEditor', () => ({ default: () => null }));

import { ConsoleDirecte, texteDeConsole } from '../dashboard/src/ConsoleDirecte';
import { Journal } from '../dashboard/src/Journal';
import { TaskDrawer } from '../dashboard/src/TaskDrawer';

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

async function monter(el: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(el));
  return conteneur;
}

describe('sorties-directes — le tampon d’une tâche', () => {
  it('reste sous 256 Kio, garde la FIN, et dit que le début a été évincé', () => {
    let etat: SortiesDirectes = {};
    const morceau = `${'x'.repeat(4_095)}\n`;
    for (let i = 0; i < 100; i += 1) etat = ajouterSortie(etat, 't1', 'n1', morceau);
    etat = ajouterSortie(etat, 't1', 'n1', 'dernière ligne\n');

    const sortie = etat.t1!;
    expect(sortie.octets).toBeLessThanOrEqual(SORTIE_ECRAN_MAX_OCTETS);
    expect(sortie.tronquee).toBe(true);
    expect(sortie.morceaux.at(-1)?.texte).toBe('dernière ligne\n');
    // Compté en octets UTF-8, pas en caractères : « é » pèse deux octets.
    const accents = ajouterSortie({}, 't2', 'n1', 'é');
    expect(accents.t2!.octets).toBe(2);
  });

  it('rend `prev` lui-même quand rien ne change (pas de rendu React inutile)', () => {
    const etat = ajouterSortie({}, 't1', 'n1', 'a\n');
    expect(ajouterSortie(etat, 't1', 'n1', '')).toBe(etat);
    expect(oublierTache(etat, 'inconnue')).toBe(etat);
    expect(garderVivantes(etat, [{ id: 't1', status: 'running' }])).toBe(etat);
  });

  it('oublie à la fin de vie, et oublie ce que l’instantané ne montre plus vivant', () => {
    let etat = ajouterSortie({}, 'en-cours', 'n1', 'a\n');
    etat = ajouterSortie(etat, 'finie', 'n1', 'b\n');
    etat = ajouterSortie(etat, 'disparue', 'n1', 'c\n');
    expect(Object.keys(oublierTache(etat, 'finie')).sort()).toEqual(['disparue', 'en-cours']);
    // `finie` est `done` dans l'instantané, `disparue` n'y est plus du tout.
    const vivantes = garderVivantes(etat, [
      { id: 'en-cours', status: 'running' },
      { id: 'finie', status: 'done' },
    ]);
    expect(Object.keys(vivantes)).toEqual(['en-cours']);
  });
});

describe('ConsoleDirecte', () => {
  const sortie = ajouterSortie(
    {},
    't1',
    'noeud-aaaaaaaa',
    'lecture de src/ruche.ts\nerreur : test rouge\nécriture de src/rayon.ts\n',
  ).t1!;

  it('montre la sortie, et la recherche ne garde que les lignes qui contiennent le texte', async () => {
    const dom = await monter(<ConsoleDirecte sortie={sortie} />);
    const zone = dom.querySelector('[data-testid="console-directe"]')!;
    expect(zone.textContent).toContain('erreur : test rouge');

    const champ = dom.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(champ, 'ÉCRITURE');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(zone.textContent).toBe('écriture de src/rayon.ts');
    expect(dom.textContent).toContain('1 ligne(s) trouvée(s)');
  });

  it('replier se retire et se remet', async () => {
    const dom = await monter(<ConsoleDirecte sortie={sortie} />);
    const zone = dom.querySelector('[data-testid="console-directe"]')!;
    expect(zone.classList.contains('replie')).toBe(true);
    const replier = [...dom.querySelectorAll('label')].find((l) => l.textContent === 'replier')!;
    await act(async () => replier.querySelector('input')!.click());
    expect(zone.classList.contains('replie')).toBe(false);
  });

  it('une course de drones sépare ses nœuds ; un seul nœud, aucun bandeau', () => {
    let etat = ajouterSortie({}, 't', 'noeud-aaaaaaaa', 'a\n');
    expect(texteDeConsole(etat.t!)).toBe('a\n');
    etat = ajouterSortie(etat, 't', 'noeud-bbbbbbbb', 'b\n');
    expect(texteDeConsole(etat.t!)).toBe('── nœud noeud-aa ──\na\n── nœud noeud-bb ──\nb\n');
  });

  it('le début évincé est DIT', async () => {
    const dom = await monter(<ConsoleDirecte sortie={{ ...sortie, tronquee: true }} />);
    expect(dom.querySelector('[data-testid="console-directe-tronquee"]')).not.toBeNull();
  });
});

const tache = (status: Task['status']): Task => ({
  id: 't1',
  projectId: 'p',
  title: 'Écrire',
  prompt: 'fais-le',
  status,
  dependsOn: [],
  assignedNodeId: null,
  result: null,
  branch: null,
  attempts: 1,
  createdAt: 0,
  updatedAt: 0,
});

describe('le tiroir de tâche — la console tant que la tâche vit', () => {
  const noeuds: HiveNode[] = [];

  it('une tâche EN COURS montre sa sortie en direct', async () => {
    const sortie = ajouterSortie({}, 't1', 'n1', 'lecture de src/ruche.ts\n').t1;
    const dom = await monter(
      <TaskDrawer task={tache('running')} nodes={noeuds} sortie={sortie} onClose={() => {}} />,
    );
    expect(dom.querySelector('[data-testid="console-directe"]')?.textContent).toContain(
      'lecture de src/ruche.ts',
    );
  });

  it('en cours mais encore muette : la console attend, elle ne disparaît pas', async () => {
    const dom = await monter(
      <TaskDrawer task={tache('running')} nodes={noeuds} onClose={() => {}} />,
    );
    expect(dom.querySelector('[data-testid="console-directe"]')?.textContent).toContain(
      'En attente de la sortie',
    );
  });

  it('une tâche finie, sortie vidée : pas de console, l’onglet Logs prend le relais', async () => {
    const dom = await monter(<TaskDrawer task={tache('done')} nodes={noeuds} onClose={() => {}} />);
    expect(dom.querySelector('[data-testid="console-directe"]')).toBeNull();
  });
});

describe('le journal dit ce que le progrès APPORTE', () => {
  const evenement = (payload: Record<string, unknown>): HiveEvent => ({
    id: 1,
    ts: 1_700_000_000_000,
    type: 'task_progress',
    payload: { taskId: 'tache-123456789', ...payload },
  });
  const ligne = async (payload: Record<string, unknown>): Promise<string> => {
    const dom = await monter(<Journal events={[evenement(payload)]} />);
    return dom.querySelector('.journal .jrow .jtext')?.textContent ?? '';
  };

  it('le jalon écrit par le nœud, pas le mot « progrès »', async () => {
    const texte = await ligne({ log: '⏸ Réquisition ouverte — en attente de décision humaine' });
    expect(texte).toContain('Réquisition ouverte');
    expect(texte).not.toContain('progrès');
  });

  it('à défaut, les sous-agents ; puis les fichiers ouverts', async () => {
    expect(await ligne({ subAgents: [{ id: 'a', name: 'x', status: 'running' }] })).toContain(
      '1 sous-agent(s)',
    );
    act(() => racine?.unmount());
    expect(await ligne({ presences: [] })).toContain('0 fichier(s) ouvert(s)');
  });
});
