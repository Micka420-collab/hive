// Horloge de l'hébergeur — la seule mesure facturable.
//
// `durationMs` est une donnée d'AGENT : un nœud hostile peut déclarer 24 h
// par résultat (voir `jugerPlafond`). Tant que les nœuds appartiennent au
// client, il ne se vole que lui-même. Dès qu'on facture du temps sur des
// machines HÉBERGÉES, ça ne l'est plus.
//
// Ici, le temps naît au moment où la Reine ASSIGNE, et s'arrête quand elle
// REÇOIT un résultat (ou annule). L'agent n'écrit jamais `startedAt`.
//
// MODULE PUR. Aucune I/O. `now` est un paramètre.

import { jugerPlafond } from './balance.js';
import type { DecisionPlafond } from './balance.js';

export const VERSION_HORLOGE_HOTE = 1;

export interface SessionHote {
  id: number;
  projectId: string;
  taskId: string;
  startedAt: number;
  /** `null` : la tâche est encore en vol. */
  stoppedAt: number | null;
}

/** Ouvre une session. L'id est fourni par le magasin ; ici on pose les faits. */
export function ouvrirSession(
  projectId: string,
  taskId: string,
  startedAt: number,
): Omit<SessionHote, 'id'> {
  return {
    projectId,
    taskId,
    startedAt: Math.max(0, Math.trunc(startedAt)),
    stoppedAt: null,
  };
}

/**
 * Ferme une session. `null` si elle est déjà close, ou si l'arrêt est AVANT
 * le départ — on refuse plutôt que d'inventer une durée négative.
 */
export function fermerSession(s: SessionHote, stoppedAt: number): SessionHote | null {
  if (s.stoppedAt !== null) return null;
  const fin = Math.max(0, Math.trunc(stoppedAt));
  if (fin < s.startedAt) return null;
  return { ...s, stoppedAt: fin };
}

/** Durée d'une session, ouverte ou close, à l'instant `now`. Jamais négative. */
export function dureeMs(s: SessionHote, now: number): number {
  const fin = s.stoppedAt ?? Math.max(now, s.startedAt);
  return Math.max(0, fin - s.startedAt);
}

/** Somme facturable d'un corpus de sessions. */
export function depenseHote(sessions: readonly SessionHote[], now: number): number {
  let total = 0;
  for (const s of sessions) total += dureeMs(s, now);
  return total;
}

/** Même porte que La Balance, sur une dépense qui ne vient PAS de l'agent. */
export function jugerFacture(depenseMs: number, plafondMs: number | null): DecisionPlafond {
  return jugerPlafond(depenseMs, plafondMs);
}
