// SUR QUEL PORT LA RUCHE ÉCOUTE — la règle, écrite UNE fois.
//
// ─── POURQUOI CE MODULE MINUSCULE EXISTE ─────────────────────────────────────
//
// `HIVE_PORT` était lu à deux endroits, et de deux façons :
//
//     server.ts        `Number.parseInt(env.HIVE_PORT ?? '7777', 10)` + une
//                      garde d'intervalle. Juste.
//     doctor-releve.ts `Number(env.HIVE_PORT ?? 7777)`. Sans garde.
//
// Sur une ligne `HIVE_PORT=` laissée vide — l'accident le plus banal d'un
// `.env` — le premier rendait 7777 et le second rendait ZÉRO. Or écouter le
// port 0 réussit toujours : le système en attribue un au hasard. Le docteur le
// trouvait donc LIBRE et annonçait que la ruche ne tournait pas, pendant qu'elle
// écoutait sur 7777.
//
// C'est le pire endroit possible pour une divergence : `hive doctor` existe pour
// être cru quand plus rien ne marche. Un docteur qui se trompe de patient envoie
// chercher une panne inexistante, et fait rater la vraie.
//
// Poser la même garde des deux côtés aurait marché aujourd'hui et divergé au
// premier changement — c'est exactement la faute qu'on répare. La règle vit ici,
// et les deux la LISENT au lieu de la réécrire.

/** Le port de la ruche quand personne n'en demande d'autre. */
export const PORT_PAR_DEFAUT = 7777;

/**
 * Le port demandé par l'environnement, ou le défaut.
 *
 * Toute valeur qui n'est pas un entier de port valide retombe sur le défaut :
 * une faute de frappe ne doit pas déplacer la ruche en silence.
 *
 * `0` demandé EXPLICITEMENT est accepté — il veut dire « un port au hasard »,
 * c'est une intention et non une faute, et les bancs de la ruche s'en servent.
 * La chaîne vide, elle, n'est pas un `0` : c'est l'absence de réponse, et elle
 * retombe sur le défaut. `Number.parseInt` sait faire cette différence là où
 * `Number` la perd (`Number('')` vaut `0`).
 */
export function portDepuisEnv(env: NodeJS.ProcessEnv = process.env): number {
  const brut = env.HIVE_PORT;
  if (brut === undefined || brut.trim() === '') return PORT_PAR_DEFAUT;
  // `parseInt` s'arrête au premier caractère non chiffré : « 7777abc » vaudrait
  // 7777, ce qu'on ne veut pas non plus. On exige donc que la chaîne ENTIÈRE
  // soit un nombre, puis qu'il soit un port.
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 0 || n > 65_535) return PORT_PAR_DEFAUT;
  return n;
}
