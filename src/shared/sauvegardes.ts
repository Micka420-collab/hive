// Sauvegardes d'étape — timeline de code récupérable.
//
// Chaque production réussie (diff non vide) devient une étape. L'humain peut
// aussi poser une sauvegarde manuelle. La restauration NE réécrit PAS le dépôt
// en silence : elle ouvre une TÂCHE « Restaurer … » que la ruche applique comme
// le reste du butinage (revue Miellerie comprise).

export type GenreSauvegarde = 'etape' | 'manuel' | 'avant_retouche';

export interface Sauvegarde {
  id: string;
  projectId: string;
  resultId: number | null;
  taskId: string | null;
  label: string;
  kind: GenreSauvegarde;
  /** Diff unifié capturé à l'instant T — survit à l'élagage des results. */
  patch: string;
  createdAt: number;
}

export interface SauvegardeResume {
  id: string;
  projectId: string;
  resultId: number | null;
  taskId: string | null;
  label: string;
  kind: GenreSauvegarde;
  /** Octets du patch (sans renvoyer le corps en liste). */
  taille: number;
  createdAt: number;
}

/** Libellé d'une étape auto à partir du titre de tâche. */
export function libelleEtape(titreTache: string, t: (fr: string, en: string) => string): string {
  const titre = titreTache.trim() || t('tâche', 'task');
  return t(`Étape — ${titre}`, `Checkpoint — ${titre}`);
}

/** Prompt de restauration : l'ouvrière applique le patch (ou son inverse). */
export function promptRestauration(s: Pick<Sauvegarde, 'label' | 'patch' | 'id'>): string {
  return [
    `Restaurer la sauvegarde « ${s.label} » (id ${s.id}).`,
    '',
    'Applique le correctif ci-dessous sur le dépôt du projet. Si le patch ne',
    "s'applique plus tel quel (conflit), reconstitue l'intention du diff et",
    'produis un nouveau patch équivalent. Ne détruis pas le travail plus récent',
    "sans le mentionner dans les logs.",
    '',
    '```diff',
    s.patch.slice(0, 80_000),
    '```',
  ].join('\n');
}

/** Garde : une sauvegarde manuelle exige un libellé non vide. */
export function libelleManuelValide(label: string): boolean {
  return label.trim().length >= 2 && label.trim().length <= 120;
}
