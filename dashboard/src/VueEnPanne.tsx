// LA VUE QUI TOMBE NE REND PLUS TOUT L'ÉCRAN BLANC.
//
// ─── POURQUOI CETTE FRONTIÈRE EXISTE ─────────────────────────────────────────
//
// Chaque vue du tableau est un morceau paresseux (`React.lazy`, App.tsx). Qu'un
// morceau refuse de se charger — un 404 parce que `dashboard/dist` a été
// reconstruit sous un onglet ouvert, un réseau qui hoquette, un module de Node
// glissé dans le paquet du navigateur — ou qu'une vue lève en se rendant, et
// React, faute de frontière d'erreur, DÉMONTE L'ARBRE ENTIER : barre, en-tête,
// tout. Une page crème, vide, sans un mot. C'est ainsi que la Chambre a rendu le
// tableau blanc pendant un mois sans qu'aucun banc ne le voie (docs/CAPTURES.md,
// « Ce que la première exécution a trouvé ») : corriger CETTE vue ne fermait
// pas la famille.
//
// ─── CE QU'ELLE GARDE, ET CE QU'ELLE DIT ─────────────────────────────────────
//
// La frontière n'entoure QUE la vue : la barre et l'en-tête restent, donc les
// autres vues restent à un clic. À la place de la vue tombée, `repli` dit
// laquelle et pourquoi (le message de l'erreur, tel quel), et offre le geste qui
// relève le cas le plus courant — recharger, quand le morceau demandé n'existe
// plus.
//
// App lui donne une CLÉ PAR VUE : changer de vue repart d'une frontière neuve.
// Sans elle, l'erreur de la vue précédente resterait affichée sous toutes les
// suivantes, jusqu'au rechargement.

import { Component, type ReactNode } from 'react';

interface Props {
  /** Ce qui remplace la vue tombée — construit par App, qui a la langue et le nom de la vue. */
  repli: (erreur: Error) => ReactNode;
  children: ReactNode;
}

interface Etat {
  erreur: Error | null;
}

export class VueEnPanne extends Component<Props, Etat> {
  state: Etat = { erreur: null };

  static getDerivedStateFromError(erreur: unknown): Etat {
    return { erreur: erreur instanceof Error ? erreur : new Error(String(erreur)) };
  }

  render(): ReactNode {
    return this.state.erreur ? this.props.repli(this.state.erreur) : this.props.children;
  }
}
