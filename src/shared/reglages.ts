// LES RÉGLAGES RISQUÉS, LUS UNE SEULE FOIS.
//
// Frère de `port.ts`, et né de la même faute : une valeur d'environnement lue à
// deux endroits est deux règles, et elles divergent au premier caractère de
// travers (voir `ERREURS.md § 9 quintrigies`).
//
// Ce qui vit ici a deux lecteurs au moins — la ruche qui APPLIQUE, et le docteur
// qui RAPPORTE. Un docteur qui annonce autre chose que ce qui tourne est pire
// qu'un docteur muet : on le croit.

/** Les régimes du contrôle d'entrée du nectar. */
export const GARDIENNES = ['off', 'consultatif', 'strict'] as const;
export type Gardiennes = (typeof GARDIENNES)[number];

/** Le régime par défaut : il encadre sans jamais retenir de production. */
export const GARDIENNES_PAR_DEFAUT: Gardiennes = 'consultatif';

/**
 * Le régime des Gardiennes demandé par l'environnement.
 *
 * Une faute de frappe retombe sur le défaut NON contraignant, jamais sur
 * `strict` : se tromper de valeur ne doit pas pouvoir fermer le trou de vol.
 *
 * Et surtout : le docteur lit CETTE fonction. Tant qu'il rapportait la valeur
 * brute, un `HIVE_GARDIENNES=stricte` s'affichait comme appliqué alors que la
 * ruche tournait en `consultatif` — le relevé décrivait une ruche qui n'existait
 * pas.
 */
export function gardiennesDepuisEnv(env: NodeJS.ProcessEnv = process.env): Gardiennes {
  const brut = env.HIVE_GARDIENNES;
  return brut === 'off' || brut === 'strict' ? brut : GARDIENNES_PAR_DEFAUT;
}
