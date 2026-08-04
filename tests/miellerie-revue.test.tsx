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

import { fetchMergePlan, fetchMergeResult, fetchResults, runMerge } from '../dashboard/src/api';
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

function propsDe(snapshot: StateSnapshot, selectedId?: string): ViewProps {
  return {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    selectedId,
    onOpenTask: () => {},
    onNavigate: () => {},
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
}

async function monter(snapshot: StateSnapshot, selectedId?: string): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Miellerie {...propsDe(snapshot, selectedId)} />));
  // Les sondes simulées se posent en microtâches : un tour de plus les draine.
  await act(async () => {});
  return conteneur;
}

/**
 * Re-rend SUR LA MÊME RACINE — l'état du composant survit.
 *
 * C'est indispensable pour éprouver une course : remonter repartirait d'un
 * `planState` vide, et la garde qu'on juge n'aurait plus rien à garder.
 */
async function rerendre(snapshot: StateSnapshot, selectedId?: string): Promise<void> {
  await act(async () => racine?.render(<Miellerie {...propsDe(snapshot, selectedId)} />));
  await act(async () => {});
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
    // TROIS tâches, UNE revue — le compteur ne peut être juste que dans un
    // sens : le balayage du soir a montré que « 1/2 » avec 1+1 était un
    // contexte SYMÉTRIQUE (muté, l'autre moitié comptait pareil).
    const dom = await monter(
      instantane(
        [{ id: 'p1', name: 'Rucher' }],
        [
          tache('t-neuve', 'Tâche neuve à revoir', 'p1', 1_000),
          tache('t-aussi', 'Tâche aussi à revoir', 'p1', 500),
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
    expect(dom.textContent, 'une revue sur trois — le compteur suit les REVUES').toContain(
      '1/3 revues',
    );
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
    // Et le diff BIEN FORMÉ passe par la découpe par fichier — pas par le
    // repli brut. La survivante du soir : `chunks.length === 0 || !startsWith`
    // mutée, un vrai diff serait rendu en bloc brut sans ses compteurs.
    // ATTENTION : `.mi-files` existe sur LES DEUX chemins (le repli brut y
    // loge sa note « Diff affiché brut ») — un premier essai s'y était fié
    // et la mutation avait SURVÉCU. Seule la puce par fichier distingue.
    expect(dom.querySelector('.mi-file-chip'), 'la découpe par fichier fait foi').toBeTruthy();
    expect(dom.textContent, 'un diff bien formé ne passe pas par le repli brut').not.toContain(
      'Diff affiché brut',
    );
  });

  it('LA RANGÉE ACTIVE PORTE SON HABIT — et elle seule', async () => {
    // `task.id === activeId` mutée : l'habit « active » irait à toutes les
    // AUTRES rangées, et l'œil suivrait la mauvaise tâche.
    const dom = await monter(
      instantane(
        [{ id: 'p1', name: 'Rucher' }],
        [
          tache('t-active', 'La tâche suivie', 'p1', 2_000),
          tache('t-autre', 'L’autre tâche', 'p1', 1_000),
        ],
      ),
    );
    const rangees = [...dom.querySelectorAll('.mi-row')];
    const active = rangees.find((r) => (r.textContent ?? '').includes('La tâche suivie'));
    const autre = rangees.find((r) => (r.textContent ?? '').includes('L’autre tâche'));
    expect(active?.classList.contains('active'), 'la suivie porte l’habit').toBe(true);
    expect(autre?.classList.contains('active'), 'l’autre ne le porte pas').toBe(false);
  });

  it('LES TOUCHES j/k CIRCULENT DANS LA FILE — le retour anticipé ne vaut que file vide', async () => {
    // `if (flat.length === 0) return;` mutée en `!==` : le clavier serait mort
    // précisément quand il y a des tâches à parcourir.
    const naviguer = vi.fn();
    conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    const props = {
      snapshot: instantane(
        [{ id: 'p1', name: 'Rucher' }],
        [
          tache('t-un', 'Première de la file', 'p1', 2_000),
          tache('t-deux', 'Seconde de la file', 'p1', 1_000),
        ],
      ),
      events: [],
      agentsByTask: {},
      deferred: new Set(),
      onOpenTask: () => {},
      onNavigate: naviguer,
      navigate: () => {},
      refreshTick: 0,
    } as unknown as ViewProps;
    await act(async () => racine?.render(<Miellerie {...props} />));
    await act(async () => {});

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    });
    expect(naviguer, '« j » avance à la seconde tâche').toHaveBeenCalledWith(
      'miellerie',
      't-deux',
      {
        replace: true,
      },
    );
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

describe('la Miellerie — le compte que l’humain lit avant de couler', () => {
  it('« PRÊT À FUSIONNER » COMPTE LES APPROUVÉES, PAS LES TERMINÉES', async () => {
    // Survivante du balayage de nuit : `t.status === 'done' && getReview(t.id)
    // === 'approved'` mutée en `||`. Le compteur cesserait alors de compter
    // des APPROBATIONS pour compter des ACHÈVEMENTS — c'est-à-dire qu'il
    // annoncerait « 3 approuvée(s) / 3 terminée(s) » sur un projet dont
    // personne n'a relu une seule production. C'est la ligne exacte que
    // l'humain regarde avant d'appuyer sur « Couler le miel ».
    //
    // Vérifiée NUE par exclusion : la suite entière moins ce fichier reste
    // verte avec la mutation en place (3 240 tests).
    //
    // La fixture est ASYMÉTRIQUE À DESSEIN — trois terminées, UNE approuvée,
    // UNE rejetée, UNE non relue. Un contexte symétrique (une approuvée pour
    // une terminée) rendrait « 1 / 1 » des deux côtés de la mutation : vert
    // pour la mauvaise raison, le piège que ce fichier documente déjà.
    localStorage.setItem(
      'hive.review',
      JSON.stringify({ 't-oui': 'approved', 't-non': 'rejected' }),
    );
    const dom = await monter(
      instantane(
        [{ id: 'p1', name: 'Rucher' }],
        [
          tache('t-oui', 'Celle qu’on a approuvée', 'p1', 3_000),
          tache('t-non', 'Celle qu’on a rejetée', 'p1', 2_000),
          tache('t-muette', 'Celle que personne n’a relue', 'p1', 1_000),
        ],
      ),
    );

    const pied = dom.querySelector('.mi-merge-count');
    expect(pied, 'le pied de coulée doit être là').toBeTruthy();
    const dit = (pied?.textContent ?? '').replace(/\s+/g, ' ');
    expect(dit, 'une seule approuvée sur trois terminées').toContain('1 approuvée(s) / 3');
    expect(dit, 'et la rejetée est dite exclue, pas approuvée').toContain('1 rejetée(s) exclue(s)');
    // La formulation qui trahirait la mutation, énoncée à part : si le
    // compteur suivait les achèvements, il annoncerait tout comme prêt.
    expect(dit, 'jamais « tout est approuvé » quand rien ne l’est').not.toContain('3 approuvée(s)');
  });

  it('UNE PRODUCTION D’UN AUTRE PROJET NE GONFLE AUCUN DES DEUX COMPTES', async () => {
    // Le compteur filtre d'abord par projet (`projTasks`). Sans ce filtre, le
    // pied de vue annoncerait comme prêtes à couler des productions qui
    // n'appartiennent pas au dépôt qu'on regarde — et la coulée, elle, ne les
    // prendrait pas : le chiffre et le geste divergeraient en silence.
    localStorage.setItem(
      'hive.review',
      JSON.stringify({ 't-ici': 'approved', 't-ailleurs': 'approved' }),
    );
    const dom = await monter(
      instantane(
        [
          { id: 'p1', name: 'Rucher' },
          { id: 'p2', name: 'Autre rucher' },
        ],
        [
          tache('t-ici', 'La nôtre', 'p1', 3_000),
          tache('t-ailleurs', 'Celle du voisin', 'p2', 2_000),
        ],
      ),
    );
    const dit = (dom.querySelector('.mi-merge-count')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(dit, 'une seule des deux approbations est la nôtre').toContain('1 approuvée(s) / 1');
  });
});

describe('la Miellerie — le plan de fusion appartient à SON projet', () => {
  it('UNE RÉPONSE TARDIVE NE COLLE PAS LE PLAN D’UN AUTRE PROJET SOUS CELUI-CI', async () => {
    // Survivante du balayage de nuit : `planState.id === projectId`, mutée en
    // `!==`. Elle a l'air redondante — un `useEffect` vide déjà `planState`
    // quand le projet change — et c'est exactement pourquoi quelqu'un la
    // supprimerait un jour.
    //
    // Elle ne sert que sur une COURSE, et cette course est réelle : la demande
    // de plan est asynchrone. Si l'on change de projet PENDANT le vol, l'effet
    // nettoie ; puis la réponse du PREMIER projet arrive et se réinstalle dans
    // l'état — l'effet, lui, ne se rejouera pas, `projectId` n'ayant pas
    // rebougé. Sans cette garde, le plan du Rucher s'afficherait alors sous le
    // titre de l'Autre rucher : des numéros de tâches, des conflits et un
    // verdict « intégrable » qui parlent d'un dépôt qu'on ne regarde pas.
    //
    // Le fichier tient déjà la même règle pour les sondes de résultats
    // (« un objet TAGUÉ par l'id demandé ») : c'est la même règle, appliquée
    // au plan.
    //
    // Vérifiée NUE par exclusion : la suite entière moins ce fichier reste
    // verte avec la mutation en place (3 240 tests).
    const snapshot = instantane(
      [
        { id: 'p1', name: 'Rucher' },
        { id: 'p2', name: 'Autre rucher' },
      ],
      [tache('t-p1', 'La nôtre', 'p1', 3_000), tache('t-p2', 'Celle du voisin', 'p2', 2_000)],
    );

    // La demande du PREMIER projet est retenue en vol : c'est la course.
    let livrerPlanDeP1: (() => void) | null = null;
    vi.mocked(fetchMergePlan).mockImplementationOnce(
      () =>
        new Promise((resoudre) => {
          livrerPlanDeP1 = () =>
            resoudre({
              total: 9,
              done: 7,
              mergeable: true,
              testsRun: false,
              order: [],
              conflicts: [],
            });
        }),
    );

    const dom = await monter(snapshot, 't-p1');
    cliquer(bouton(dom, 'Plan de merge'));
    await act(async () => {});

    // On change de projet PENDANT le vol — sur la même racine, donc l'état du
    // composant survit, comme dans un vrai navigateur.
    await rerendre(snapshot, 't-p2');

    // La réponse du premier projet arrive maintenant. Trop tard.
    expect(livrerPlanDeP1, 'la demande devait être en vol').not.toBeNull();
    await act(async () => {
      (livrerPlanDeP1 as unknown as () => void)();
    });

    // L'utilisateur rouvre le plan, cette fois pour le SECOND projet : sa
    // demande à lui est encore en vol, et l'état porte le plan du premier.
    vi.mocked(fetchMergePlan).mockImplementationOnce(() => new Promise(() => {}));
    cliquer(bouton(dom, 'Plan de merge'));
    await act(async () => {});

    expect(dom.textContent, 'on regarde bien l’autre rucher').toContain('Autre rucher');
    expect(
      dom.textContent,
      'le plan du PREMIER projet ne doit pas s’afficher sous le second',
    ).not.toContain('7/9');
  });
});
