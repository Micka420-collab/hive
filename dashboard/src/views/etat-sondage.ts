// « CETTE ROUTE N'A JAMAIS RÉPONDU » — la dégradation propre du tableau de bord.
//
// ─── UN CONCEPT ÉCRIT CINQ FOIS ET NOMMÉ ZÉRO ────────────────────────────────
//
// Le même test revenait cinq fois, dans deux vues, chacune avec son propre
// commentaire expliquant la même chose :
//
//     Essaim.tsx:510   !(pheromones.data === null && pheromones.error !== null)
//     Sante.tsx:197     thermo.data === null && thermo.error !== null
//     Sante.tsx:200     balance.data === null && balance.error !== null
//     Sante.tsx:382     if (g.data === null && g.error !== null) return null;
//     Sante.tsx:513     if (guet.data === null && guet.error !== null) return null;
//
// Un balayage échantillonné de `dashboard/src/views` en a rendu trois NUS d'un
// coup. Ce n'est pas une coïncidence : une idée qu'on réécrit à chaque usage
// n'est éprouvée à aucun.
//
// ─── CE QUE CETTE DISTINCTION PROTÈGE ────────────────────────────────────────
//
// Une ruche auto-hébergée peut tourner une version D'AVANT une route. Le
// tableau de bord la demande, reçoit une erreur, et doit alors faire disparaître
// la carte SANS crier : une fonctionnalité absente n'est pas une panne.
//
// Mais une panne SURVENUE plus tard ne se traite pas pareil — on garde le
// dernier relevé à l'écran et on l'annote « relevé figé ». D'où les deux
// conditions ensemble, et pas une seule :
//
//     data === null   on n'a JAMAIS rien reçu
//     error !== null  et on a bien demandé, ça a échoué
//
// ─── LES DEUX MUTANTS, ET POURQUOI ILS FONT DISPARAÎTRE L'ÉCRAN ──────────────
//
// · `error !== null` muté en `===` : la carte se masque quand il N'Y A PAS
//   d'erreur — c'est-à-dire pendant le tout premier chargement, avant la
//   première réponse. La carte clignote, ou ne revient jamais si le sondage est
//   lent.
// · `&&` muté en `||` : elle se masque dès qu'une erreur survient, même après
//   des heures de relevés corrects. La panne passagère efface l'historique à
//   l'écran au lieu de le figer.
//
// Les deux échouent dans le même sens : ils enlèvent à l'humain une carte qu'il
// devrait voir, et sans rien dire.

/** Ce qu'un sondage rend, réduit à ce dont la décision dépend. */
export interface EtatSondage {
  /** Le dernier relevé obtenu, ou `null` si aucun n'est JAMAIS arrivé. */
  data: unknown;
  /** Le message de la dernière erreur, ou `null` si tout va bien. */
  error: unknown;
}

/**
 * A-t-on demandé sans jamais rien obtenir ?
 *
 * `true` ⇒ la route est absente (ou injoignable depuis le début) : on masque la
 * carte, en silence. `false` ⇒ soit on a des données, soit on attend encore —
 * dans les deux cas, la carte a sa place à l'écran.
 */
export function jamaisRienRecu(sondage: EtatSondage): boolean {
  return sondage.data === null && sondage.error !== null;
}
