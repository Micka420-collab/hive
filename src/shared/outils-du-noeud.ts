// Ce qu'un nœud a CONSTATÉ sur sa machine, croisé avec ce que la ruche SAIT
// faire de chaque outil.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// Le nœud sait deux choses de chaque outil : le binaire est-il sur le PATH, et
// la clé est-elle dans l'environnement. Il les envoie au hub à l'inscription
// (`RegisterMsg.outils`). Ce sont des CONSTATS : ce que la machine porte.
//
// Le catalogue (`catalogue-outils.ts`) sait tout autre chose : jusqu'où la
// ruche va avec cet outil — son NIVEAU, mesuré sur le code des adaptateurs, pas
// sur les promesses du produit.
//
// Les deux ensemble font la seule phrase honnête qu'un écran puisse écrire :
// « Windsurf est installé sur cette machine, et la ruche ne sait que le
// détecter. » Séparément, chacune est un demi-mensonge :
//   · le constat seul laisse croire qu'un outil présent est un outil pilotable ;
//   · le niveau seul laisse croire qu'un outil pilotable est un outil présent.
//
// C'est la raison d'être de l'échelle demandée par la mission : la ruche doit
// rester HONNÊTE sur ce qu'elle sait faire, outil par outil.

import { type Niveau, NIVEAUX, outil as outilDuCatalogue, rangNiveau } from './catalogue-outils.js';
import { type EtatCle, type VerdictConnexion, juger } from './connexion-agent.js';
import type { OutilConstate } from './protocol.js';

/**
 * Le rang à partir duquel la ruche PREND DES TÂCHES avec cet outil.
 *
 * En dessous, elle sait au mieux le voir et le configurer. Un écran qui affiche
 * « prêt » sur un outil de niveau `detecte` ment — l'outil est prêt, la RUCHE
 * ne l'est pas.
 */
const RANG_EXECUTE = rangNiveau('execute');

export interface OutilDuNoeud {
  /** L'identifiant de protocole tel que le nœud l'a envoyé. */
  readonly id: string;
  /** Le nom lisible du catalogue — ou l'identifiant brut s'il y est inconnu. */
  readonly nom: string;
  /**
   * Le niveau d'intégration, PRIS DANS LE CATALOGUE. `null` quand le catalogue
   * ne connaît pas cet identifiant : un nœud plus récent que le hub peut
   * annoncer un outil qu'on ne sait pas encore situer, et inventer un niveau
   * pour lui serait exactement le mensonge que l'échelle sert à éviter.
   */
  readonly niveau: Niveau | null;
  /** Le verdict de connexion, rendu par la MÊME règle que le côté nœud. */
  readonly verdict: VerdictConnexion;
  readonly binaire: boolean;
  readonly cle: EtatCle;
  /**
   * `true` seulement si la ruche prend des tâches avec cet outil ET que la
   * machine peut le lancer. Les deux conditions, jamais une seule.
   */
  readonly pilotable: boolean;
  /** Ce qui borne cet outil, dit à l'humain plutôt que caché. */
  readonly limite: string | null;
}

/**
 * Croise les constats d'un nœud avec le catalogue.
 *
 * L'ordre rendu est TOTAL et stable : niveau décroissant, puis nom, puis
 * identifiant. Un écran qui affiche cette liste ne doit pas se réordonner d'un
 * rafraîchissement à l'autre — le catalogue s'impose déjà cette règle, et une
 * liste dérivée qui ne la tiendrait pas la lui reprendrait.
 *
 * Les outils inconnus du catalogue passent EN DERNIER : ce sont ceux dont on ne
 * sait rien dire, et ils n'ont pas à couper la liste de ceux dont on sait tout.
 */
export function outilsDuNoeud(constats: readonly OutilConstate[]): OutilDuNoeud[] {
  const vus = constats.map((c): OutilDuNoeud => {
    const fiche = outilDuCatalogue(c.agent);
    const { verdict } = juger({ agent: c.agent, binaire: c.binaire, cle: c.cle });
    return {
      id: c.agent,
      nom: fiche?.nom ?? c.agent,
      niveau: fiche?.niveau ?? null,
      verdict,
      binaire: c.binaire,
      cle: c.cle,
      // `pret` exige le binaire ET la clé ; `RANG_EXECUTE` exige que la ruche
      // sache s'en servir. Un outil hors catalogue n'a pas de fiche du tout :
      // il n'est jamais pilotable, parce qu'on ne sait pas ce qu'on ferait de
      // lui — et c'est DIT, pas encodé dans un rang sentinelle. Une première
      // version passait par `-1` ; la contre-épreuve a montré que `-1` et `0`
      // donnaient le même résultat, ce nombre ne portant donc aucune décision.
      pilotable:
        fiche !== undefined && rangNiveau(fiche.niveau) >= RANG_EXECUTE && verdict === 'pret',
      limite: fiche?.limite ?? null,
    };
  });

  // Départage par le NOM, jamais par l'identifiant.
  //
  // J'avais écrit les deux, `nom` puis `id` en dernier recours. La contre-
  // épreuve a montré que le second RENDAIT LE PREMIER INVISIBLE : sur le
  // catalogue réel, l'ordre des identifiants et celui des noms coïncident, si
  // bien qu'ôter le tri par nom ne changeait RIEN et que le banc restait vert.
  // Une garde qu'aucune mutation ne fait rougir ne garde rien.
  //
  // La règle du dépôt sur un survivant est de TRANCHER, pas de le défendre :
  // le repli par identifiant est parti. Restent deux clés, toutes deux
  // observables. À nom strictement égal — deux constats du même outil, que le
  // protocole n'interdit pas — la stabilité du tri conserve l'ordre d'arrivée,
  // et les deux entrées portent alors la même clé : rien à départager.
  // Ici, en revanche, `-1` DÉCIDE : il place l'inconnu sous le niveau le plus
  // bas du catalogue (`detecte`, rang 0) au lieu de le mêler à lui. Le banc
  // d'ordre le mesure avec un identifiant qui trierait AVANT `Windsurf` si les
  // deux se retrouvaient à égalité — sans quoi ce nombre passerait, lui aussi,
  // pour une décision qu'il ne prend pas.
  const rangDe = (o: OutilDuNoeud): number => (o.niveau === null ? -1 : rangNiveau(o.niveau));
  return vus.sort((a, b) => {
    const ra = rangDe(a);
    const rb = rangDe(b);
    if (ra !== rb) return rb - ra;
    return a.nom.localeCompare(b.nom, 'fr');
  });
}

/** Combien d'outils ce nœud peut réellement faire travailler pour la ruche. */
export function combienPilotables(outils: readonly OutilDuNoeud[]): number {
  return outils.filter((o) => o.pilotable).length;
}

const PHRASES: Readonly<Record<VerdictConnexion, readonly [string, string]>> = Object.freeze({
  pret: ['prêt', 'ready'],
  binaire_manquant: ['clé posée, commande absente', 'key set, command missing'],
  cle_manquante: ['installé, clé absente', 'installed, key missing'],
  rien: ['absent de cette machine', 'not on this machine'],
  cle_inconnue: ['présent, clé non lisible', 'present, key unreadable'],
});

/**
 * Ce qu'on écrit à côté du nom, en une demi-ligne.
 *
 * `cle_inconnue` ne dit PAS « pas de clé » : la ruche ne sait pas lire les
 * identifiants de cet outil-là, ce qui n'est pas la même chose que constater
 * leur absence. Confondre les deux ferait installer une clé déjà posée.
 */
export function direOutil(o: OutilDuNoeud, lang: 'fr' | 'en' = 'fr'): string {
  const [fr, en] = PHRASES[o.verdict];
  return lang === 'en' ? en : fr;
}

/** Le nombre de niveaux — pour un écran qui dessine une jauge. */
export const NOMBRE_DE_NIVEAUX = NIVEAUX.length;
