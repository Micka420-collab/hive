// L'édition de la ruche — Community (chez soi, 0 €) ou Cloud (sur tes serveurs).
//
// Une seule lecture, et le docteur la partage : une valeur lue à deux endroits
// est deux règles, et elles divergent au premier caractère de travers.
//
// Défaut COMMUNITY. Une faute de frappe ne doit jamais basculer une ruche
// personnelle en mode facturable — ce serait ouvrir des portes de paiement
// (et exiger un secret de webhook) sans que l'hôte l'ait demandé.

export const EDITIONS = ['community', 'cloud'] as const;
export type Edition = (typeof EDITIONS)[number];

export const EDITION_PAR_DEFAUT: Edition = 'community';

/** L'édition demandée par l'environnement. Toute valeur inconnue → community. */
export function editionDepuisEnv(env: NodeJS.ProcessEnv = process.env): Edition {
  return env.HIVE_EDITION === 'cloud' ? 'cloud' : EDITION_PAR_DEFAUT;
}

/**
 * En Cloud, un secret de webhook ABSENT refuse le démarrage — pas seulement
 * les POST. Sinon la ruche tournerait, encaisserait des heures, et la route
 * de paiement répondrait 401 à tout le monde, y compris Stripe.
 *
 * Community n'exige rien : la route refuse déjà tout sans secret, et c'est
 * le bon défaut pour une ruche d'amis.
 */
export function secretWebhookExige(edition: Edition, simulation: boolean): boolean {
  return edition === 'cloud' && simulation !== true;
}
