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

import { isIPv6 } from 'node:net';

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

// ─── ET COMMENT LA JOINDRE DEPUIS CETTE MACHINE ─────────────────────────────
//
// Une adresse d'ÉCOUTE n'est pas toujours une adresse où se connecter. Deux
// lecteurs en avaient besoin — le docteur qui sonde la ruche, le lanceur qui
// dit à ses ouvrières et à son écran où elle est — et la règle vit ici, une
// fois, pour la même raison que le port : écrite deux fois, elle divergerait.

/**
 * L'hôte auquel S'ADRESSER, depuis cette machine, pour joindre une ruche qui
 * écoute sur `hote`.
 *
 * `0.0.0.0` et `::` veulent dire « toutes les interfaces » : ce sont des
 * adresses d'écoute. S'y connecter échoue selon les plateformes (Windows
 * refuse), et le docteur conclurait « rien ne répond » sur une ruche qui
 * tourne très bien ; une ouvrière, elle, reconnecterait dans le vide. On vise
 * donc la boucle locale de la même famille, qui fait partie de « toutes les
 * interfaces ».
 *
 * La chaîne VIDE aussi : c'est une ligne `HIVE_HOST=` laissée vide, et
 * Fastify (via Node) écoute alors sur toutes les interfaces — `::` en double
 * pile, ou `0.0.0.0` sans IPv6. Reprise telle quelle, elle donnait
 * `ws://:7777/ws` : une URL invalide, une ouvrière qui meurt au démarrage, et
 * la ruche entière emportée avec elle. `127.0.0.1` répond dans les deux cas.
 *
 * `::` s'écrit de plusieurs façons (`::0`, `0:0:0:0:0:0:0:0`, `[::]`) : on la
 * reconnaît par sa forme CANONIQUE — celle que rend l'analyseur d'URL — plutôt
 * que par une liste d'orthographes qui en oublierait une. Les crochets d'un
 * hôte recopié d'une URL tombent au passage : `adresseLocale` les remet, et
 * `listen` n'en veut pas. Les graphies exotiques de `0.0.0.0` (`0`, `0.0`)
 * restent tenues pour des hôtes précis : personne ne les écrit dans un `.env`,
 * et les reconnaître coûterait un analyseur IPv4 pour un cas imaginé.
 *
 * Tout autre hôte est repris tel quel : une ruche liée à une adresse précise
 * ne se joint pas ailleurs.
 *
 * Extraite pour être TESTABLE : la loupe a montré que ce ternaire, enfoui dans
 * `relever` (le docteur), pouvait être retourné sans qu'aucun test ne bouge.
 */
export function hoteDeConnexion(hote: string): string {
  const nu = hote.startsWith('[') && hote.endsWith(']') ? hote.slice(1, -1) : hote;
  if (nu === '' || nu === '0.0.0.0') return '127.0.0.1';
  if (isIPv6(nu) && new URL(`http://[${nu}]`).hostname === '[::]') return '::1';
  return nu;
}

/** Où joindre une ruche : son origine HTTP (l'écran, la CLI) et son WebSocket (les ouvrières). */
export interface AdresseRuche {
  readonly http: string;
  readonly ws: string;
}

/**
 * L'adresse d'une ruche qui écoute sur `hote:port`, vue de CETTE machine.
 *
 * Un littéral IPv6 va entre crochets : `ws://::1:7777/ws` n'est pas une URL,
 * et le client WebSocket d'une ouvrière la refuserait au démarrage.
 */
export function adresseLocale(hote: string, port: number): AdresseRuche {
  const h = hoteDeConnexion(hote);
  const autorite = `${h.includes(':') ? `[${h}]` : h}:${port}`;
  return { http: `http://${autorite}`, ws: `ws://${autorite}/ws` };
}
