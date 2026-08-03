// Les tâches DIFFÉRÉES pour conflit — la transition, sortie de l'App.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu `ev.type === 'task_conflict_deferred'`
// SANS TEST. La logique vivait dans un `useEffect` de `App.tsx` — 467 lignes
// d'intégration (WebSocket, sondes, vues paresseuses) qu'aucun test ne monte,
// et un rendu complet n'aurait produit qu'un échafaudage de simulacres.
//
// Le geste du dépôt pour ce cas est établi depuis `tui/rendu.ts` et
// `shared/service.ts` : EXTRAIRE LE PUR, TESTER LE PUR. La transition
// (événement → nouvel état du jeu) tient en une fonction sans effet ; l'App ne
// garde que le câblage d'une ligne.
//
// ─── CE QUE LA TRANSITION PROMET ─────────────────────────────────────────────
//
//   · un conflit AJOUTE la tâche au jeu des différées ;
//   · une assignation, une fin (succès, échec, annulation) ou une remise en
//     file la RETIRE — la tâche a bougé, le report est terminé ;
//   · tout autre événement laisse le jeu STRICTEMENT IDENTIQUE — l'identité
//     référentielle est le contrat avec React : un jeu neuf à chaque
//     événement re-rendrait l'écran au rythme du flux.

/** Les événements qui terminent un report : la tâche a bougé. */
export const EVENEMENTS_QUI_LIBERENT = [
  'task_assigned',
  'task_done',
  'task_failed',
  'task_cancelled',
  'task_requeued',
] as const;

/**
 * Le prochain jeu de tâches différées, d'après un événement.
 *
 * Rend `prev` LUI-MÊME (même référence) quand rien ne change : c'est ce qui
 * évite à React de re-rendre sur les événements qui ne le concernent pas —
 * `setDeferred` avec la même référence est un non-geste.
 */
export function transitionDifferees(
  prev: ReadonlySet<string>,
  evType: string,
  taskId: string,
): ReadonlySet<string> {
  if (evType === 'task_conflict_deferred') {
    return new Set(prev).add(taskId);
  }
  if ((EVENEMENTS_QUI_LIBERENT as readonly string[]).includes(evType)) {
    if (!prev.has(taskId)) return prev;
    const next = new Set(prev);
    next.delete(taskId);
    return next;
  }
  return prev;
}
