// Ce que la Reine annonce quand elle démarre en mode simulation.
//
// Elle disait « token par défaut toléré » même quand l'installeur venait de
// poser un jeton aléatoire — que la Reine exige bel et bien : le jeton par
// défaut y est refusé en 401. Une annonce qui décrit une autre configuration
// que celle qui tourne apprend à ne plus lire les annonces.

import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from './types.js';

/** La ligne d'avertissement du mode simulation, selon le jeton réellement en place. */
export function annonceSimulation(jeton: string): string {
  const trivial = jeton === DEFAULT_TOKEN || jeton.length < MIN_TOKEN_LENGTH;
  return trivial
    ? '⚠ Mode simulation actif — jeton trivial toléré : démo locale uniquement.'
    : '⚠ Mode simulation actif — démo locale : agents simulés, secrets manquants tolérés.';
}
