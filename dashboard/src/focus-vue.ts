// Focus d’une section après navigation (Reine → Rayon / Sauvegardes).
//
// Le hash ne porte que vue + id projet. On pose une intention courte-durée
// dans sessionStorage ; la vue cible la consomme une fois et scrolle.

export const FOCUS_SAUVEGARDES = 'sauvegardes';

const CLE = 'hive.focus';

export function demanderFocus(cible: string): void {
  try {
    sessionStorage.setItem(CLE, cible);
  } catch {
    /* mode privé / quota — navigation seule suffit */
  }
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
