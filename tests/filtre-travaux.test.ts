// LA RÈGLE DU FILTRE DES TRAVAUX — ce que « chercher » veut dire, une fois pour
// les trois écrans (Projets, file de revue de la Miellerie, Chantiers).
//
// La règle est pure (`dashboard/src/views/filtre-travaux.ts`) : ce banc la
// juge seule, sans DOM. Ce que les écrans en font est rendu par
// `tests/filtre-travaux-ecrans.test.tsx`.

import { describe, expect, it } from 'vitest';
import {
  FILTRE_VIDE,
  familleDeTache,
  filtreActif,
  filtrerProjets,
  tacheCorrespond,
  texteCorrespond,
} from '../dashboard/src/views/filtre-travaux.js';
import type { HiveNode, Project, Task } from '../src/shared/types.js';

function tache(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p1',
    title: `Tâche ${id}`,
    prompt: 'faire quelque chose',
    status: 'done',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

function noeud(id: string, agentType: string): HiveNode {
  return {
    id,
    name: id,
    ownerName: 'Maya',
    agentType,
    maxConcurrency: 1,
    running: 0,
    status: 'online',
    lastSeen: 0,
  };
}

function projet(id: string, name: string, description: string | null = null): Project {
  return {
    id,
    name,
    description,
    repoUrl: null,
    visibility: 'private',
    ownerId: null,
    createdAt: 0,
  };
}

const NOEUDS = new Map([
  ['n-codex', noeud('n-codex', 'codex')],
  ['n-claude', noeud('n-claude', 'claude-code')],
]);

describe('la recherche libre', () => {
  it('ignore la casse ET les accents — « integration » trouve « Intégration »', () => {
    expect(texteCorrespond(['Intégration continue'], 'integration')).toBe(true);
    expect(texteCorrespond(['integration'], 'INTÉGRATION')).toBe(true);
  });

  it('chaque mot doit se trouver, dans n’importe quel ordre et n’importe quel texte', () => {
    expect(texteCorrespond(['Échec de l’auth', 'consigne'], 'auth échec')).toBe(true);
    expect(texteCorrespond(['Échec de l’auth'], 'auth succès')).toBe(false);
    expect(texteCorrespond(['titre', 'corrige le cache'], 'titre cache')).toBe(true);
  });

  it('une recherche vide ou blanche ne filtre rien', () => {
    expect(texteCorrespond([], '')).toBe(true);
    expect(texteCorrespond(['x'], '   ')).toBe(true);
    expect(filtreActif({ ...FILTRE_VIDE, texte: '   ' })).toBe(false);
  });
});

describe('une tâche et le filtre', () => {
  it('la famille est celle de l’ouvrière qui la porte, ou qui l’a rendue', () => {
    expect(familleDeTache(tache('a', { assignedNodeId: 'n-codex' }), NOEUDS)).toBe('codex');
    const rendue = tache('b', {
      result: { success: true, nodeId: 'n-claude', durationMs: 1 },
    });
    expect(familleDeTache(rendue, NOEUDS)).toBe('claude-code');
  });

  it('L’INCONNU RESTE INCONNU : une tâche jamais assignée ne passe AUCUN filtre de famille', () => {
    const orpheline = tache('c');
    expect(familleDeTache(orpheline, NOEUDS)).toBeNull();
    for (const famille of ['codex', 'claude-code']) {
      expect(tacheCorrespond(orpheline, { ...FILTRE_VIDE, famille }, NOEUDS)).toBe(false);
    }
    // …et une ouvrière qui n'est plus inscrite ne prête pas sa famille non plus.
    const perdue = tache('d', { assignedNodeId: 'n-partie' });
    expect(tacheCorrespond(perdue, { ...FILTRE_VIDE, famille: 'codex' }, NOEUDS)).toBe(false);
  });

  it('statut, ouvrière et texte se cumulent', () => {
    const t = tache('e', { status: 'failed', assignedNodeId: 'n-codex', title: 'Cache Redis' });
    const f = { statut: 'failed', famille: 'codex', ouvriere: 'n-codex', texte: 'redis' };
    expect(tacheCorrespond(t, f, NOEUDS)).toBe(true);
    expect(tacheCorrespond(t, { ...f, statut: 'done' }, NOEUDS)).toBe(false);
    expect(tacheCorrespond(t, { ...f, ouvriere: 'n-claude' }, NOEUDS)).toBe(false);
    expect(tacheCorrespond(t, { ...f, texte: 'postgres' }, NOEUDS)).toBe(false);
  });

  it('la recherche lit aussi la consigne et la branche', () => {
    const t = tache('f', { prompt: 'Réécrire le parseur', branch: 'hive/f-parseur' });
    expect(tacheCorrespond(t, { ...FILTRE_VIDE, texte: 'parseur' }, NOEUDS)).toBe(true);
    expect(tacheCorrespond(t, { ...FILTRE_VIDE, texte: 'hive/f' }, NOEUDS)).toBe(true);
  });
});

describe('les projets et leurs tâches', () => {
  const P = [projet('p1', 'Rucher', 'Le site de la ruche'), projet('p2', 'Miel')];
  const T = new Map([
    [
      'p1',
      [
        tache('a', { title: 'Auth', status: 'failed', assignedNodeId: 'n-codex' }),
        tache('b', { title: 'Cache', status: 'done' }),
      ],
    ],
    ['p2', [tache('c', { projectId: 'p2', title: 'Auth aussi', assignedNodeId: 'n-claude' })]],
  ]);

  it('sans filtre, RIEN ne bouge — même un projet sans tâche garde sa carte', () => {
    const vide = projet('p3', 'Vide');
    const sortie = filtrerProjets([...P, vide], T, FILTRE_VIDE, NOEUDS);
    expect(sortie.map((s) => s.projet.id)).toEqual(['p1', 'p2', 'p3']);
    expect(sortie[0]?.taches).toHaveLength(2);
    expect(sortie[2]?.taches).toEqual([]);
  });

  it('un projet ne reste que s’il lui reste une tâche', () => {
    const sortie = filtrerProjets(P, T, { ...FILTRE_VIDE, famille: 'codex' }, NOEUDS);
    expect(sortie.map((s) => s.projet.id)).toEqual(['p1']);
    expect(sortie[0]?.taches.map((t) => t.id)).toEqual(['a']);
  });

  it('la recherche qui trouve LE PROJET garde toutes ses tâches…', () => {
    const sortie = filtrerProjets(P, T, { ...FILTRE_VIDE, texte: 'site ruche' }, NOEUDS);
    expect(sortie.map((s) => s.projet.id)).toEqual(['p1']);
    expect(sortie[0]?.taches.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('…mais les AUTRES dimensions trient encore ses tâches', () => {
    const f = { ...FILTRE_VIDE, texte: 'rucher', statut: 'done' };
    const sortie = filtrerProjets(P, T, f, NOEUDS);
    expect(sortie[0]?.taches.map((t) => t.id)).toEqual(['b']);
    // Projet trouvé par son nom, mais aucune tâche au statut demandé : il sort.
    const rien = filtrerProjets(P, T, { ...f, statut: 'running' }, NOEUDS);
    expect(rien).toEqual([]);
  });

  it('la recherche qui ne trouve que des TÂCHES ne garde qu’elles, projet par projet', () => {
    const sortie = filtrerProjets(P, T, { ...FILTRE_VIDE, texte: 'auth' }, NOEUDS);
    expect(sortie.map((s) => [s.projet.id, s.taches.map((t) => t.id)])).toEqual([
      ['p1', ['a']],
      ['p2', ['c']],
    ]);
  });
});
