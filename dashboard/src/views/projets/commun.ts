// Ce que plusieurs panneaux de la vue Projets partagent — et rien d'autre.

import type { TaskStatus } from '../../../../src/shared/types';

export const STATUSES: TaskStatus[] = ['pending', 'ready', 'assigned', 'running', 'done', 'failed'];

/** Message d'erreur lisible quel que soit le rejet. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
