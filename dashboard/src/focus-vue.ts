// Focus d’une section après navigation (Reine → Rayon / Sauvegardes).
//
// Le hash ne porte que vue + id projet. On pose une intention courte-durée
// dans sessionStorage ; la vue cible la consomme une fois et scrolle.

export const FOCUS_SAUVEGARDES = 'sauvegardes';

/** Préfixe pour ouvrir un chemin constaté dans le Rayon (`fichier:<chemin>`). */
export const FOCUS_FICHIER_PREFIX = 'fichier:';

const CLE = 'hive.focus';

export function demanderFocus(cible: string): void {
  try {
    sessionStorage.setItem(CLE, cible);
  } catch {
    /* mode privé / quota — navigation seule suffit */
  }
}

/** Intention « ouvrir ce chemin dans le Rayon ». */
export function demanderFocusFichier(chemin: string): void {
  demanderFocus(`${FOCUS_FICHIER_PREFIX}${chemin}`);
}

/** Lit et efface. `null` si rien ou stockage inaccessible. */
export function consommerFocus(): string | null {
  try {
    const v = sessionStorage.getItem(CLE);
    if (v) sessionStorage.removeItem(CLE);
    return v;
  } catch {
    return null;
  }
}

/** Extraire un chemin depuis une intention `fichier:…`, sinon null. */
export function cheminDepuisFocus(focus: string | null): string | null {
  if (!focus || !focus.startsWith(FOCUS_FICHIER_PREFIX)) return null;
  const c = focus.slice(FOCUS_FICHIER_PREFIX.length).trim();
  return c.length > 0 ? c : null;
}

/**
 * Parents d’un chemin fichier, racine exclue — pour déplier l’arbre Rayon
 * avant d’ouvrir `src/a/b.ts` → `['src', 'src/a']`.
 */
export function parentsDuChemin(chemin: string): string[] {
  const parts = chemin.split('/').filter((p) => p.length > 0);
  if (parts.length <= 1) return [];
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
}
