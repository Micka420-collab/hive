// CE QU'UN ÉCRAN A LE DROIT DE DIRE QUAND UN SONDAGE ÉCHOUE.
//
// ─── POURQUOI CE MODULE EST EN `.ts`, ET PAS DANS `shared.tsx` ───────────────
//
// La fonction est PURE : une erreur entre, une phrase sort. Elle vivait au
// milieu de `shared.tsx`, donc hors d'atteinte de la suite racine — celle-ci
// compile du Node, sans `dom` ni pragma JSX, et n'entre pas dans un `.tsx`.
//
// C'est le § 2 quaterdecies du carnet, déjà appliqué à `rayon-affichage.ts`
// (l'icône d'une entrée) et à `cerveau-designation.ts` (le seuil du glisser) :
// « hors d'atteinte du banc » est presque toujours « au mauvais endroit ». On
// sort la règle, on l'éprouve, et l'écran se contente de l'appeler.

import { t } from '../i18n.js';

/**
 * Le message qu'un écran a le DROIT de montrer quand un sondage échoue.
 *
 * ─── DEUX ÉCHECS TRÈS DIFFÉRENTS ARRIVAIENT ICI SOUS LE MÊME HABIT ───────────
 *
 *   · Le serveur A RÉPONDU et a refusé (`ApiError`). Son message vient du corps
 *     JSON, il est écrit POUR un humain (`api()` le tire de `message`/`error`),
 *     et il nomme souvent le remède. On le montre tel quel.
 *
 *   · Le `fetch` n'a JAMAIS abouti : orchestrateur arrêté, en redémarrage, ou
 *     réseau coupé. Personne n'a répondu, donc personne n'a rédigé de message —
 *     c'est le NAVIGATEUR qui jette le sien, dans SA langue, et il ne dit rien
 *     à faire : « Failed to fetch », « NetworkError when attempting to fetch
 *     resource ».
 *
 * Le second s'affichait CRU sur les écrans (vingt-cinq endroits du tableau de
 * bord rendent un `poll.error` sans le relire). Or pour une ruche AUTO-HÉBERGÉE
 * c'est l'échec le plus banal — on redémarre son propre orchestrateur — et
 * c'était le seul à rester en anglais technique au milieu d'une interface
 * française. Quelqu'un qui lit « Failed to fetch » ne sait pas si sa ruche est
 * morte, si son jeton a expiré, ou s'il a raté une étape d'installation.
 *
 * ─── POURQUOI LE TRI SE FAIT SUR `TypeError`, ET PAS SUR « TOUT LE RESTE » ───
 *
 * La spécification de `fetch` est explicite : un échec de TRANSPORT rejette
 * avec un `TypeError`, et lui seul. Traiter « tout ce qui n'est pas une
 * ApiError » comme une panne de réseau MENTIRAIT sur les pannes voisines — un
 * corps JSON illisible jette un `SyntaxError`, et la ruche a bel et bien
 * répondu. Les inconnues gardent donc leur message d'origine : annoncer « la
 * ruche n'a pas répondu » quand elle a répondu de travers enverrait chercher la
 * panne du mauvais côté du fil.
 */
export function messageDeSondage(e: unknown): string {
  if (e instanceof TypeError) {
    return t(
      'La ruche n’a pas répondu — l’orchestrateur est peut-être arrêté ou en redémarrage.',
      'The hive did not answer — the orchestrator may be stopped or restarting.',
    );
  }
  if (e instanceof Error) return e.message;
  // ─── CE QU'ON JETTE QUI N'EST PAS UNE ERREUR ───────────────────────────────
  //
  // Une valeur PRIMITIVE porte encore quelque chose de lisible : `String(e)`
  // rend « boum », « 404 », « false ». On la montre.
  //
  // Un OBJET NU, non : `String({})` rend « [object Object] ». C'est du charabia,
  // et le laisser passer trahirait la raison d'être de cette fonction — ne
  // jamais livrer à l'utilisateur un texte qui ne lui apprend rien. On dit alors
  // ce qu'on sait vraiment : il y a eu une panne, et on ne sait pas laquelle.
  //
  // Cette branche a été débusquée par la loupe : muté en `instanceof Object`, le
  // `instanceof Error` ci-dessus SURVIVAIT, parce qu'aucun banc ne passait un
  // objet qui ne soit pas une Error.
  if (typeof e === 'object' && e !== null) {
    return t('Panne inattendue de la ruche.', 'Unexpected hive failure.');
  }
  return String(e);
}
