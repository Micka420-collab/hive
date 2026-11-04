// Le projet actif — celui sur lequel l'accueil travaille, et que la barre du haut nomme.
//
// Choisi par la personne (sélecteur, favoris, palette) et rangé dans ce
// navigateur. Sans choix, ou si le projet choisi a disparu (supprimé, devenu
// illisible pour ce compte), on retombe sur le projet où il s'est passé quelque
// chose le plus récemment — jamais sur un projet qu'on inventerait.

import { useCallback } from 'react';
import type { Project, Task } from '../../../src/shared/types';
import { CLES, ecrire, usePreference } from './preferences';

/** Le projet par défaut : la dernière activité, puis la création la plus récente. */
export function projetParDefaut(
  projets: readonly Project[],
  taches: readonly Pick<Task, 'projectId' | 'updatedAt'>[],
): Project | null {
  if (projets.length === 0) return null;
  const derniere = new Map<string, number>();
  for (const t of taches) {
    derniere.set(t.projectId, Math.max(derniere.get(t.projectId) ?? 0, t.updatedAt));
  }
  return [...projets].sort(
    (a, b) =>
      (derniere.get(b.id) ?? 0) - (derniere.get(a.id) ?? 0) ||
      b.createdAt - a.createdAt ||
      a.name.localeCompare(b.name, 'fr'),
  )[0]!;
}

export function resoudreProjetActif(
  choisi: string | null,
  projets: readonly Project[],
  taches: readonly Pick<Task, 'projectId' | 'updatedAt'>[],
): Project | null {
  return projets.find((p) => p.id === choisi) ?? projetParDefaut(projets, taches);
}

export function useProjetActif(
  projets: readonly Project[],
  taches: readonly Pick<Task, 'projectId' | 'updatedAt'>[],
): [Project | null, (id: string) => void] {
  const choisi = usePreference(CLES.projet, (v) => v);
  const choisir = useCallback((id: string) => ecrire(CLES.projet, id), []);
  return [resoudreProjetActif(choisi, projets, taches), choisir];
}
