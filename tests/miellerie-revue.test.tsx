// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA MIELLERIE, RENDUE — la file qui trie, le résultat qui ne se trompe pas de
// tâche, le pied qui nomme le bon projet, et l'attente qui ne s'affiche qu'en
// attendant.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu QUATRE survivantes dans cette vue —
// la plus grosse famille du dépôt. Chacune a son test, et chacune dit ce que
// l'écran raconterait de faux si elle vivait :
//
//   · `getReview(t.id) === null ? 1 : 2` — muté, la file de revue enterrerait
//     le travail À FAIRE sous le travail déjà fait ;
//   · `r.taskId === activeId` — muté, l'inspecteur montrerait le diff d'UNE
//     AUTRE tâche sous le titre de celle qu'on relit ;
//   · `p.id === projectId` — muté, le pied de vue nommerait le MAUVAIS projet
//     au moment de couler le miel ;
//   · `merge.step === 'waiting'` — muté, « le nœud coule le miel… »
//     s'afficherait en permanence AU REPOS, et se tairait pendant la coulée.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateSnapshot, Task, TaskResult } from '../src/shared/types';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchMergePlan: vi.fn(() =>
    Promise.resolve({ total: 0, done: 0, mergeable: true, order: [], conflicts: [] }),
  ),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'coulée-1' })),
  postReview: vi.fn(() => Promise.resolve()),
}));

import { fetchMergeResult, fetchResults, runMerge } from '../dashboard/src/api';
import Miellerie from '../dashboard/src/views/Miellerie';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  vi.mocked(fetchResults).mockReset().mockResolvedValue([]);
  vi.mocked(runMerge).mockClear();
  vi.mocked(fetchMergeResult).mockClear();
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function tache(id: string, titre: string, projectId: string, updatedAt: number): Task {
  return {
    id,
    projectId,
    title: titre,
    prompt: 'p',
    status: 'done',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt,
  };
}

function resultat(taskId: string, diff: string): TaskResult {
  return {
    taskId,
    nodeId: 'n1',
    success: true,
    diff,
    logs: '',
    durationMs: 5,
    subAgents: [],
  } as unknown as TaskResult;
}

function instantane(projects: Array<{ id: string; name: string }>, tasks: Task[]): StateSnapshot {
  return {
    projects: projects.map((p) => ({ ...p, repoUrl: null })),
    nodes: [],
    tasks,
    tasksTotal: tasks.length,
  } as unknown as StateSnapshot;
}

async function monter(snapshot: StateSnapshot): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Miellerie {...props} />));
  // Les sondes simulées se posent en microtâches : un tour de plus les draine.
  await act(async () => {});
  return conteneur;
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function bouton(dom: HTMLElement, libelle: string): HTMLButtonElement {
  const b = [...dom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(libelle),
  );
  expect(b, `bouton « ${libelle} » introuvable`).toBeTruthy();
  return b as HTMLButtonElement;
}

describe('la Miellerie — les quatre survivantes du balayage', () => {
  it('LA FILE MET LE TRAVAIL À FAIRE AVANT LE TRAVAIL FAIT', async () => {
    // `getReview === null ? 1 : 2` muté en `!==` : les revues passeraient
    // devant. La revue est PLUS FRAÎCHE (updatedAt) exprès : si le rang ne
    // tranchait pas, la fraîcheur mettrait la revue en tête — le test ne peut
    // être vert que si c'est bien le RANG qui commande.
    localStorage.setItem('hive.review', JSON.stringify({ 't-revue': 'approved' }));
    const dom = await monter(
      instantane(
        [{ id: 'p1', name: 'Rucher' }],
        [
          tache('t-neuve', 'Tâche neuve à revoir', 'p1', 1_000),
          tache('t-revue', 'Tâche déjà revue', 'p1', 2_000),
        ],
      ),
    );
    const lignes = [...dom.querySelectorAll('.mi-queue li')].map((l) => l.textContent ?? '');
    const iNeuve = lignes.findIndex((l) => l.includes('Tâche neuve à revoir'));
    const iRevue = lignes.findIndex((l) => l.includes('Tâche déjà revue'));
    expect(iNeuve, 'la neuve doit être dans la file').toBeGreaterThan(-1);
    expect(iRevue, 'la revue doit être dans la file').toBeGreaterThan(-1);
    expect(iNeuve, 'le travail à faire passe devant le travail fait').toBeLessThan(iRevue);
    expect(dom.textContent).toContain('1/2 revues');
  });

  it('L’INSPECTEUR MONTRE LE DIFF DE LA TÂCHE ACTIVE — jamais celui d’une autre', async () => {
    // `r.taskId === activeId` muté en `!==` : le dernier résultat retenu
    // serait celui d'une AUTRE tâche. La liste simulée contient les deux ;
    // l'étranger vient EN PREMIER pour que la boucle (qui remonte depuis la
    // fin) ait à choisir, pas seulement à prendre l'unique.
    vi.mocked(fetchResults).mockResolvedValue([
      resultat('t-autre', 'diff --git a/autre.ts b/autre.ts\n+MIEL-D-UNE-AUTRE-TACHE\n'),
      resultat('t-1', 'diff --git a/rayon.ts b/rayon.ts\n+MIEL-DE-LA-TACHE-ACTIVE\n'),
    ]);
    const dom = await monter(
      instantane([{ id: 'p1', name: 'Rucher' }], [tache('t-1', 'La tâche inspectée', 'p1', 1_000)]),
    );
    expect(dom.textContent).toContain('MIEL-DE-LA-TACHE-ACTIVE');
    expect(
      dom.textContent,
      'le diff d’une autre tâche ne se glisse pas sous ce titre',
    ).not.toContain('MIEL-D-UNE-AUTRE-TACHE');
  });

  it('LE PIED DE VUE NOMME LE PROJET DE LA TÂCHE ACTIVE', async () => {
    // `p.id === projectId` muté en `!==` : le pied nommerait le PREMIER autre
    // projet. Le voisin n'a AUCUNE tâche finie : son nom ne peut apparaître
    // nulle part ailleurs — s'il surgit au pied, c'est la mutation.
    const dom = await monter(
      instantane(
        [
          { id: 'p-actif', name: 'Rucher Actif' },
          { id: 'p-voisin', name: 'Verger Voisin' },
        ],
        [tache('t-1', 'La tâche du rucher', 'p-actif', 1_000)],
      ),
    );
    const pied = dom.querySelector('.mi-merge-proj');
    expect(pied?.textContent).toContain('Rucher Actif');
    expect(pied?.textContent, 'le pied ne nomme pas un projet voisin').not.toContain(
      'Verger Voisin',
    );
    expect(dom.textContent).not.toContain('Verger Voisin');
  });

  it('« LE NŒUD COULE LE MIEL… » NE S’AFFICHE QU’EN COULANT', async () => {
    // `merge.step === 'waiting'` muté en `!==` : la bannière d'attente serait
    // là AU REPOS et se tairait pendant la coulée. Les deux moitiés se
    // vérifient : absente avant, présente après le double-clic de coulée.
    const dom = await monter(
      instantane([{ id: 'p1', name: 'Rucher' }], [tache('t-1', 'La tâche à couler', 'p1', 1_000)]),
    );
    expect(dom.textContent, 'au repos, la ruche ne prétend pas couler du miel').not.toContain(
      'Le nœud coule le miel',
    );

    // Le geste réel : armer, puis confirmer sous 3 s.
    cliquer(bouton(dom, '🍯 Couler le miel'));
    cliquer(bouton(dom, 'Confirmer la coulée ?'));
    await act(async () => {});

    expect(vi.mocked(runMerge)).toHaveBeenCalledWith('p1', { taskIds: undefined });
    expect(dom.textContent).toContain('Fusion en cours…');
    expect(dom.textContent, 'en coulant, l’attente se dit').toContain('Le nœud coule le miel');
  });
});
