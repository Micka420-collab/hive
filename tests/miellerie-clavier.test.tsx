// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA FILE DE REVUE AU CLAVIER — `j` descend, `k` remonte.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Survivante du balayage de nuit : `e.key === 'j' ? 1 : -1`, mutée en `!==`,
// ne faisait rougir personne. Nudité vérifiée par exclusion avant écriture —
// 3 274 tests verts avec la mutation en place.
//
// ─── CE QUE CETTE LIGNE PORTE ────────────────────────────────────────────────
//
// La Miellerie est l'écran où l'on relit les productions une par une. `j` et
// `k` sont le geste de base : on descend la file en approuvant ou rejetant,
// sans quitter le clavier. C'est la raison d'être des raccourcis — relire
// quarante productions à la souris est un travail qu'on abandonne au bout de
// dix.
//
// Mutée, `j` et `k` ne cessent pas de fonctionner : ils ÉCHANGENT leurs
// directions. C'est ce qui rend le défaut coûteux plutôt que visible — rien
// n'est cassé, tout répond, mais la main apprend l'inverse de ce qu'elle sait.
// Et une file parcourue à l'envers se relit deux fois, ou se saute.
//
// ─── POURQUOI LE PARCOURS BOUCLE, ET POURQUOI ON L'ÉPROUVE ───────────────────
//
// `(idx + pas + n) % n` : depuis la première production, `k` mène à la
// DERNIÈRE. Sans la boucle, le geste s'arrêterait au bord sans rien dire, et
// on croirait la touche morte. C'est aussi ce qui rend le test décisif :
// depuis le premier élément, les deux touches mènent à des endroits
// DIFFÉRENTS — un banc qui partirait du milieu d'une liste symétrique ne
// distinguerait pas les deux sens.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot, Task } from '../src/shared/types';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchResults: vi.fn(() => Promise.resolve([])),
  fetchConsensus: vi.fn(() => Promise.resolve(null)),
  fetchConflicts: vi.fn(() => Promise.resolve({ conflicts: [] })),
  fetchMergePlan: vi.fn(() => new Promise(() => {})),
  fetchMergeResult: vi.fn(() => Promise.resolve({ result: null })),
  runMerge: vi.fn(() => Promise.resolve({ mergeId: 'coulée-1' })),
  postReview: vi.fn(() => Promise.resolve()),
}));

import Miellerie from '../dashboard/src/views/Miellerie';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;
/** Ce que la vue demande de sélectionner — c'est là que le geste se lit. */
let demandes: string[] = [];

beforeEach(() => {
  setLang('fr');
  localStorage.clear();
  demandes = [];
});
afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

function tache(id: string, updatedAt: number): Task {
  return {
    id,
    projectId: 'p1',
    title: `Production ${id}`,
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

async function monter(taches: Task[]): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const snapshot = {
    projects: [{ id: 'p1', name: 'Rucher', repoUrl: null }],
    nodes: [],
    tasks: taches,
    tasksTotal: taches.length,
  } as unknown as StateSnapshot;
  const props = {
    snapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    onOpenTask: () => {},
    onNavigate: (_vue: string, id?: string) => {
      if (id) demandes.push(id);
    },
    navigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Miellerie {...props} />));
  await act(async () => {});
}

/** Frappe une touche sur la fenêtre — c'est là que la vue écoute. */
function frapper(touche: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: touche, bubbles: true }));
  });
}

// Trois productions, la plus fraîche en tête : la file trie par fraîcheur à
// rang de revue égal, donc l'ordre affiché est c, b, a.
const TROIS = [tache('a', 1_000), tache('b', 2_000), tache('c', 3_000)];

describe('la file de revue au clavier', () => {
  it('`j` DESCEND D’UN CRAN', async () => {
    await monter(TROIS);
    frapper('j');
    expect(demandes.at(-1), 'depuis la première, on va sur la deuxième').toBe('b');
  });

  it('`k` REMONTE — et depuis la première, il BOUCLE sur la dernière', async () => {
    // LA garde, prise par son contraste : depuis le même point de départ, les
    // deux touches mènent à des endroits DIFFÉRENTS. Mutées, elles échangent
    // exactement ces deux destinations.
    await monter(TROIS);
    frapper('k');
    expect(demandes.at(-1), 'depuis la première, on remonte à la dernière').toBe('a');
  });

  it('LES DEUX TOUCHES NE MÈNENT JAMAIS AU MÊME ENDROIT', async () => {
    // Sans cette assertion, un test qui vérifierait seulement « ça bouge »
    // resterait vert sur une mutation qui inverse les deux sens.
    await monter(TROIS);
    frapper('j');
    const apresJ = demandes.at(-1);
    frapper('k');
    const apresK = demandes.at(-1);
    expect(apresJ).not.toBe(apresK);
  });

  it('UNE FILE VIDE NE DEMANDE RIEN — pas d’index négatif, pas de modulo par zéro', async () => {
    // `% flat.length` avec une file vide rendrait `NaN`, et `flat[NaN]` vaut
    // `undefined` : le refus arriverait par accident. La garde explicite le dit.
    await monter([]);
    frapper('j');
    frapper('k');
    expect(demandes, 'rien à parcourir, rien à demander').toEqual([]);
  });

  it('UNE SEULE PRODUCTION : LES DEUX TOUCHES Y RESTENT', async () => {
    // Le cas où la boucle ramène sur soi-même. Il doit rester silencieux plutôt
    // que de sortir de la liste.
    await monter([tache('seule', 1_000)]);
    frapper('j');
    frapper('k');
    expect(new Set(demandes), 'on ne sort jamais de la file').toEqual(new Set(['seule']));
  });

  it('LES RACCOURCIS SE TAISENT QUAND ON ÉCRIT — jamais de décision sous les doigts', async () => {
    // Taper « jk » dans un champ de recherche ne doit pas faire défiler la file
    // sous l'utilisateur. La garde d'entrée existe pour ça.
    await monter(TROIS);
    const champ = document.createElement('input');
    document.body.appendChild(champ);
    champ.focus();
    frapper('j');
    expect(demandes, 'la frappe appartient au champ').toEqual([]);
    champ.remove();
  });

  it('LES RACCOURCIS SE TAISENT SOUS UN MODIFICATEUR — `Ctrl+J` appartient au navigateur', async () => {
    await monter(TROIS);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true }));
    });
    expect(demandes).toEqual([]);
  });
});
