// Quand la Reine de l'app meurt : relancer, combien de fois, et quand s'arrêter.
//
// Une Reine tombée sur une exception passagère revient d'elle-même en une
// seconde. Une Reine qui meurt en BOUCLE (base illisible, secret refusé) ne
// reviendra pas : la relancer sans fin, c'est un processus qui tourne à vide
// et un écran qui clignote. Trois relances en cinq minutes, avec recul (1 s,
// 5 s, 30 s), puis l'écran d'erreur avec ses dernières lignes — ADR 0013 § 2.

export const RECULS_MS = [1_000, 5_000, 30_000] as const;
export const FENETRE_RELANCES_MS = 5 * 60_000;

/**
 * Le délai avant la prochaine relance, ou `null` : on arrête de relancer.
 *
 * `relances` : les instants des relances DÉJÀ faites. Seules celles de la
 * fenêtre comptent — une Reine tombée une fois par jour n'épuise rien.
 */
export function prochaineRelance(relances: readonly number[], maintenant: number): number | null {
  const recentes = relances.filter((t) => maintenant - t < FENETRE_RELANCES_MS).length;
  return RECULS_MS[recentes] ?? null;
}
