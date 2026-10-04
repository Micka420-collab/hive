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

// ─── LA PORTÉE DE L'EXPÉRIENCE ───────────────────────────────────────────────

/**
 * D'où l'ouvrière d'un projet reçoit l'expérience des tâches voisines
 * (`shared/graphe-experience.ts`) : de son projet seul, ou aussi des projets
 * publics de la ruche — jamais d'un projet privé autre que le sien.
 */
export const PORTEES_EXPERIENCE = ['projet', 'ruche'] as const;
export type PorteeExperience = (typeof PORTEES_EXPERIENCE)[number];

/**
 * La portée demandée par l'environnement (`HIVE_EXPERIENCE_PORTEE`).
 *
 * ─── L'ISOLEMENT EST LE DÉFAUT, ET UNE FAUTE DE FRAPPE Y RETOMBE ────────────
 *
 * Fédérer, c'est joindre au prompt d'une ouvrière du projet A des titres de
 * tâches, des chemins de fichiers et des noms de modèles du projet B — donc
 * les montrer à qui fait tourner A, sur sa machine. Ce n'est pas une
 * optimisation, c'est une décision de l'HÔTE sur ce que ses projets se disent
 * entre eux. Elle se prend donc là où l'hôte seul écrit, dans le `.env` de la
 * Reine — aucune route ne la bascule, aucun compte, même administrateur, ne la
 * change depuis l'écran —, et seule la valeur exacte `ruche` l'ouvre : un
 * `rucher`, un `oui` ou un blanc de fin de ligne ne doivent jamais faire
 * sortir l'expérience d'un projet.
 */
export function porteeExperienceDepuisEnv(env: NodeJS.ProcessEnv = process.env): PorteeExperience {
  return env.HIVE_EXPERIENCE_PORTEE === 'ruche' ? 'ruche' : 'projet';
}
