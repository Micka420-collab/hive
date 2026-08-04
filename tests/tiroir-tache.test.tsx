// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE TIROIR DE TÂCHE, RENDU — la victoire de course, et les gestes qui coupent.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu SANS TEST la garde
// `{task.status === 'done' && victory && (…)}` : inversée, la bannière 🏆
// s'afficherait sur toutes les tâches SAUF les gagnées — un écran qui décore
// les échecs et tait les victoires, et rien ne rougissait.
//
// Le tiroir parle au serveur (`fetchResults`, `fetchRace`) : on simule LE
// MODULE api en gardant tout le reste réel (`importOriginal`), et on simule
// aussi l'éditeur CodeMirror — pesant, hors sujet, et pas fait pour happy-dom.
// Tout le reste est le vrai composant, rendu comme le navigateur le rend.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HiveNode, Task } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchRace: vi.fn(() => Promise.resolve({ race: null, victory: null })),
  cancelTask: vi.fn(() => Promise.resolve()),
  raceTask: vi.fn(() => Promise.resolve({ drones: [] })),
}));
vi.mock('../dashboard/src/CodeEditor', () => ({ default: () => null }));

import { cancelTask, fetchRace, fetchResults } from '../dashboard/src/api';
import { TaskDrawer } from '../dashboard/src/TaskDrawer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchRace).mockClear();
  vi.mocked(cancelTask).mockClear();
  // Défaut : aucun résultat (les onglets ne se rendent pas). Un test qui veut
  // les onglets pose son propre `mockResolvedValue` — remis à zéro ici pour
  // qu'il ne fuie pas dans le banc suivant.
  vi.mocked(fetchResults).mockResolvedValue([]);
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

/** Rend, puis laisse les effets et leurs promesses simulées se poser. */
async function monter(ui: React.ReactElement): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(ui));
  return conteneur;
}

function tache(statut: Task['status']): Task {
  return {
    id: 'tache-du-tiroir',
    projectId: 'p1',
    title: 'construire le rayon',
    prompt: 'faire les alvéoles',
    status: statut,
    dependsOn: [],
    assignedNodeId: 'noeud-1',
    result: null,
    branch: null,
    attempts: 2,
    createdAt: 0,
    updatedAt: 0,
  };
}

const NOEUDS: HiveNode[] = [
  {
    id: 'noeud-1',
    name: 'ruche-alpha',
    status: 'idle',
    agentType: 'shell',
    maxConcurrency: 1,
    tasksDone: 0,
    connectedAt: 0,
  } as unknown as HiveNode,
];

describe('le tiroir — la victoire de course (la survivante du balayage)', () => {
  it('GAGNÉE ET TERMINÉE : la bannière 🏆 nomme le vainqueur et compte les annulés', async () => {
    vi.mocked(fetchRace).mockResolvedValue({
      race: null,
      victory: { nodeId: 'noeud-1', cancelled: 2 },
    });
    const dom = await monter(<TaskDrawer task={tache('done')} nodes={NOEUDS} onClose={() => {}} />);
    expect(dom.textContent).toContain('🏆');
    // Le NOM du nœud, pas son identifiant tronqué : c'est lui que l'hôte lit.
    expect(dom.textContent).toContain('ruche-alpha');
    expect(dom.textContent).toContain('2 concurrent(s) annulé(s)');
  });

  it('LA MÊME VICTOIRE SUR UNE TÂCHE NON TERMINÉE : AUCUNE bannière', async () => {
    // La moitié qui tue `=== → !==` : inversée, la garde décorerait tout SAUF
    // les gagnées. `running` passe la garde d'effet (fetchRace est appelé),
    // la victoire arrive — et la bannière doit quand même se taire.
    vi.mocked(fetchRace).mockResolvedValue({
      race: null,
      victory: { nodeId: 'noeud-1', cancelled: 2 },
    });
    const dom = await monter(
      <TaskDrawer task={tache('running')} nodes={NOEUDS} onClose={() => {}} />,
    );
    expect(vi.mocked(fetchRace)).toHaveBeenCalled();
    expect(dom.textContent, 'une tâche en cours ne porte pas de trophée').not.toContain('🏆');
  });

  it('SUR UNE TÂCHE ÉCHOUÉE, LA COURSE N’EST MÊME PAS DEMANDÉE', async () => {
    // La garde d'effet : `assigned | running | done` seulement. Une tâche
    // échouée n'a ni course en vol ni trophée à reconstruire — la demander
    // serait une requête par tiroir ouvert, pour rien.
    const dom = await monter(
      <TaskDrawer task={tache('failed')} nodes={NOEUDS} onClose={() => {}} />,
    );
    expect(vi.mocked(fetchRace)).not.toHaveBeenCalled();
    expect(dom.textContent).not.toContain('🏆');
  });
});

describe('le tiroir — les métadonnées et le geste qui coupe', () => {
  it('le nœud est nommé, les tentatives comptées, l’identifiant montré', async () => {
    const dom = await monter(
      <TaskDrawer task={tache('running')} nodes={NOEUDS} onClose={() => {}} />,
    );
    expect(dom.textContent).toContain('ruche-alpha');
    expect(dom.textContent).toContain('tache-du-tiroir');
    expect(dom.textContent).toContain('construire le rayon');
  });

  it('ANNULER n’existe que si la tâche peut encore l’être — et le clic annule VRAIMENT', async () => {
    const enCours = await monter(
      <TaskDrawer task={tache('running')} nodes={NOEUDS} onClose={() => {}} />,
    );
    const bouton = [...enCours.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Annuler la tâche'),
    );
    expect(bouton, 'une tâche en cours doit pouvoir s’annuler').toBeTruthy();
    await act(async () => {
      bouton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(vi.mocked(cancelTask)).toHaveBeenCalledWith('tache-du-tiroir');

    act(() => racine?.unmount());
    const finie = await monter(
      <TaskDrawer task={tache('done')} nodes={NOEUDS} onClose={() => {}} />,
    );
    expect(
      [...finie.querySelectorAll('button')].some((b) =>
        (b.textContent ?? '').includes('Annuler la tâche'),
      ),
      'une tâche terminée ne s’annule plus — le bouton serait un mensonge',
    ).toBe(false);
  });
});

describe('le tiroir — l’onglet affiché (survivantes d’attribut du balayage)', () => {
  it('L’ONGLET REGARDÉ PORTE la classe active — Diff par défaut, Logs au clic', async () => {
    // Survivantes loupe (§ 9 vicies, la famille GardeFous / PleinEssaim /
    // AccountPanel / App) : `className={tab === 'diff' ? 'active' : ''}` et son
    // jumeau 'logs'. Mutées en `!==`, la suite restait verte — aucun banc ne
    // lisait quel onglet est surligné. Or c'est la SEULE marque (pas d'aria ici)
    // qui dit lequel de Diff / Logs on regarde : inverser surligne l'onglet
    // qu'on NE voit PAS.
    vi.mocked(fetchResults).mockResolvedValue([
      {
        taskId: 'tache-du-tiroir',
        nodeId: 'noeud-1',
        diff: 'le diff',
        logs: 'les journaux',
        success: true,
        durationMs: 100,
        subAgents: [],
      },
    ]);
    const dom = await monter(<TaskDrawer task={tache('done')} nodes={NOEUDS} onClose={() => {}} />);
    // `fetchResults` se résout en microtâche APRÈS le premier rendu.
    await act(async () => {});
    const onglets = (): HTMLButtonElement[] =>
      [...dom.querySelectorAll('.drawer-tabs button')] as HTMLButtonElement[];
    const [diff, logs] = onglets();
    // Au réveil, Diff est l'onglet regardé.
    expect(diff?.className, 'Diff est actif par défaut').toContain('active');
    expect(logs?.className, 'Logs ne l’est pas').not.toContain('active');
    // Au clic sur Logs, la marque suit — les deux onglets s'inversent.
    act(() => logs?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onglets()[1]?.className, 'Logs devient actif').toContain('active');
    expect(onglets()[0]?.className, 'Diff ne l’est plus').not.toContain('active');
  });
});
