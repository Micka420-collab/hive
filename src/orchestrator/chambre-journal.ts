// Résumés de journal pour la Chambre — activité séparée du chat Reine
// (pattern agentic UX 2026 : activity panel ≠ conversation).
//
// MODULE PUR. N'invente rien : si le payload n'a pas de détail utile, on
// renvoie seulement le type d'événement.

export interface LigneJournalChambre {
  resume: string;
  detail: string | null;
}

/**
 * Une ligne lisible pour l'écran. Pas de prénom inventé, pas de chemin inventé.
 */
export function resumerEvenementChambre(
  type: string,
  payload: Record<string, unknown>,
  lang: 'fr' | 'en' = 'fr',
): LigneJournalChambre {
  const outil = typeof payload.outil === 'string' ? payload.outil : null;
  const chemin = typeof payload.chemin === 'string' ? payload.chemin : null;
  const title = typeof payload.title === 'string' ? payload.title : null;
  const motif = typeof payload.motif === 'string' ? payload.motif : null;
  const error = typeof payload.error === 'string' ? payload.error : null;
  const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;

  if (outil && chemin) {
    return {
      resume: `${outil} · ${chemin}`,
      detail: taskId,
    };
  }
  if (type.includes('fail') || type.includes('error') || type === 'task_failed') {
    const quoi = title ?? (lang === 'en' ? 'Task failed' : 'Tâche en échec');
    const pourquoi = error ?? motif;
    return {
      resume: quoi,
      detail: pourquoi ? (lang === 'en' ? `why: ${pourquoi}` : `pourquoi : ${pourquoi}`) : null,
    };
  }
  if (title) {
    return { resume: title, detail: type };
  }
  return { resume: type, detail: taskId };
}
