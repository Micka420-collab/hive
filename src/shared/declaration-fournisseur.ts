// Relire la déclaration fournisseur dans un événement d'issue, et en faire des
// sommes HONNÊTES.
//
// La Reine range ce que le CLI de l'agent déclare (coût, temps passé dans les
// appels au modèle, modèles exacts) sur `task_done` / `task_retry` /
// `task_failed`, sous `fournisseur`. Une somme de ces valeurs n'a de sens
// qu'avec sa COUVERTURE : trois tentatives dont deux déclarent un coût font
// « au moins » ce total, pas ce total. Rien n'est estimé pour la tentative
// muette, et aucune tentative déclarée → `inconnu`.

export interface SommeDeclaree {
  total: number;
  /** Tentatives dont le CLI a déclaré cette valeur. */
  declarees: number;
  /** Tentatives rendues (réussies, reprises, échouées). */
  tentatives: number;
}

export interface DeclarationLue {
  coutUsd: number | null;
  dureeApiMs: number | null;
  modeles: string[];
}

const nombre = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** La déclaration d'un payload d'issue ; tout champ illisible vaut `null`. */
export function declarationDe(payload: Record<string, unknown>): DeclarationLue {
  const f = payload.fournisseur;
  if (typeof f !== 'object' || f === null || Array.isArray(f)) {
    return { coutUsd: null, dureeApiMs: null, modeles: [] };
  }
  const brut = f as Record<string, unknown>;
  return {
    coutUsd: nombre(brut.coutUsd),
    dureeApiMs: nombre(brut.dureeApiMs),
    modeles: Array.isArray(brut.modeles)
      ? brut.modeles.filter((m): m is string => typeof m === 'string' && m.length > 0)
      : [],
  };
}

/** Somme des valeurs déclarées, avec leur couverture ; `inconnu` si aucune. */
export function sommeDeclaree(valeurs: readonly (number | null)[]): SommeDeclaree | 'inconnu' {
  const declarees = valeurs.filter((v): v is number => v !== null);
  if (declarees.length === 0) return 'inconnu';
  return {
    total: declarees.reduce((s, v) => s + v, 0),
    declarees: declarees.length,
    tentatives: valeurs.length,
  };
}
