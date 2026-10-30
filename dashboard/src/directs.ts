// L'état EN DIRECT des exécutions (Sandbox Live), côté écran.
//
// ─── D'OÙ IL VIENT, ET QUAND IL S'EN VA ─────────────────────────────────────
//
// La Reine le garde en mémoire et le pousse (`task_direct`) à chaque
// changement, et en entier à chaque (re)connexion : c'est ce qui le rend
// après une coupure — le rattrapage du journal ne le porte pas. `null` dit
// qu'une exécution est finie.
//
// L'écran l'oublie aussi de lui-même, par les mêmes règles que la sortie en
// direct (`sorties-directes.ts`) : à un événement de fin d'exécution, et à
// chaque instantané pour une tâche qui n'y vit plus. Un `task_direct: null`
// perdu pendant une coupure ne laisse donc jamais une ligne fantôme.
//
// ─── POURQUOI UN MAGASIN, PAS UN ÉTAT D'`App` ───────────────────────────────
//
// Une mesure toutes les cinq secondes et par exécution re-rendrait tout le
// tableau de bord. Seule la vue Sandbox Live lit ces états : elle s'abonne
// (`useSyncExternalStore`), le reste de l'écran ne bouge pas.

import type { DirectTache } from '../../src/shared/bac-direct';
import type { Task } from '../../src/shared/types';
import { garderVivantes, oublierTache } from './sorties-directes';

export type Directs = Readonly<Record<string, DirectTache>>;

export interface MagasinDirects {
  /** Tous les états : la MÊME référence tant que rien n'a changé. */
  lire(): Directs;
  abonner(prevenir: () => void): () => void;
  appliquer(taskId: string, direct: DirectTache | null): void;
  oublier(taskId: string): void;
  garderVivantes(tasks: readonly Pick<Task, 'id' | 'status'>[]): void;
}

export function creerMagasinDirects(): MagasinDirects {
  let etat: Directs = {};
  const abonnes = new Set<() => void>();
  const passer = (suite: Directs): void => {
    if (suite === etat) return;
    etat = suite;
    for (const prevenir of abonnes) prevenir();
  };
  return {
    lire: () => etat,
    abonner(prevenir) {
      abonnes.add(prevenir);
      return () => abonnes.delete(prevenir);
    },
    appliquer: (taskId, direct) =>
      passer(direct === null ? oublierTache(etat, taskId) : { ...etat, [taskId]: direct }),
    oublier: (taskId) => passer(oublierTache(etat, taskId)),
    garderVivantes: (tasks) => passer(garderVivantes(etat, tasks)),
  };
}
