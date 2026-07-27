// Le cache borné — un seul objet, réutilisé partout où la ruche mémoïse une
// propriété IMMUABLE d'une tâche (son projet, son domaine).
//
// Deux classes en avaient chacune leur copie (`CacheProjets` dans balance.ts,
// `CacheDomaines` dans pheromones.ts) avec STRICTEMENT le même contrat, et donc
// les deux mêmes défauts. Les voici corrigés une fois pour toutes :
//
// 1. LE RETOUR DE `resoudre` N'EST JAMAIS RELU DEPUIS LE CACHE. L'ancienne
//    version insérait les manquants puis reconstruisait sa carte de retour en
//    relisant le cache — or l'insertion PURGE, et la victime peut être une clé
//    que l'appel courant doit rendre. La ligne disparaissait alors du retour, et
//    l'appelant (le grand livre de la Balance) perdait la dépense DÉFINITIVEMENT
//    puisque son filigrane, lui, avait avancé. La carte est désormais bâtie à
//    partir des HITS relevés AVANT toute insertion et des lignes rendues
//    DIRECTEMENT par le chargeur : ce que `resoudre` a résolu, il le rend,
//    quelle que soit la capacité.
//
// 2. VRAI LRU, PAS FIFO. Le FIFO expulsait les entrées les plus longtemps
//    vivantes — c'est-à-dire précisément les tâches qui accumulent le plus de
//    tentatives, celles qu'on relit le plus. Un hit RAFRAÎCHIT désormais la
//    position.
//
// 3. ÉVICTION EN O(1) AMORTI. `map.keys().next().value` est O(taille) dans V8
//    (l'itérateur repart de l'index 0 et saute les trous laissés par les
//    suppressions) : sur une base de 3 Go, 84 % du coût d'une passe de
//    rattrapage venait de cette seule purge. La position LRU vit donc dans une
//    FILE EXPLICITE (tableau + index de tête), avec des entrées périmées
//    ignorées à la sortie et un compactage amorti.
//
// Module PUR : aucune I/O, aucune horloge, aucun état global — comme thermo.ts,
// pheromones.ts et balance.ts. Le cache est un OBJET explicitement instancié par
// son propriétaire.

/** Ce que le cache dit de lui-même : taille courante et appels au chargeur. */
export interface StatistiquesCache {
  taille: number;
  /** Nombre d'appels réellement passés au chargeur (observabilité + tests). */
  lectures: number;
}

/**
 * Lest ajouté au seuil de compactage : sur une capacité minuscule (les tests
 * en instancient à 2), il évite de compacter à chaque insertion.
 */
const LEST_COMPACTAGE = 8;

/**
 * Cache borné clé → valeur, éviction LRU en O(1) amorti.
 *
 * `V` ne doit jamais inclure `undefined` : c'est la valeur qui signale
 * l'absence, ici comme dans `Map.get`.
 *
 * Le mécanisme de position : chaque entrée retient le RANG de sa dernière
 * touche, c'est-à-dire l'index où sa clé a été poussée dans `file`. Une clé
 * poussée plusieurs fois laisse derrière elle des rangs PÉRIMÉS, reconnus à ce
 * que le rang stocké dans l'entrée ne correspond pas — la sortie les saute sans
 * rien supprimer. Chaque case de la file n'est donc lue qu'une fois : le coût
 * total est linéaire en nombre de touches, donc O(1) amorti par opération.
 */
export class CacheBorne<V> {
  private readonly entrees = new Map<string, { valeur: V; rang: number }>();
  /** File des touches, dans l'ordre — contient des rangs périmés, jamais de trous. */
  private file: string[] = [];
  /** Index de la prochaine case candidate à la sortie. */
  private tete = 0;
  private appels = 0;
  private readonly capacite: number;

  constructor(capacite: number) {
    // Une capacité nulle ou négative rendrait le cache inutilisable (toute
    // insertion s'auto-évincerait) : au moins une entrée, toujours.
    this.capacite = Math.max(1, Math.trunc(capacite));
  }

  /** Valeur mémoïsée, en RAFRAÎCHISSANT sa position (c'est ce qui fait le LRU). */
  lire(cle: string): V | undefined {
    const entree = this.entrees.get(cle);
    if (entree === undefined) return undefined;
    this.toucher(cle, entree);
    return entree.valeur;
  }

  /** Mémorise (ou remplace) une valeur, en purgeant la moins récemment utilisée. */
  memoriser(cle: string, valeur: V): void {
    const connue = this.entrees.get(cle);
    if (connue !== undefined) {
      connue.valeur = valeur;
      this.toucher(cle, connue);
      return;
    }
    if (this.entrees.size >= this.capacite) this.evincer();
    const entree = { valeur, rang: 0 };
    this.entrees.set(cle, entree);
    this.toucher(cle, entree);
  }

  /**
   * Valeurs des SEULES clés citées. Les clés déjà connues ne coûtent rien, et
   * `charger` n'est appelé QUE pour les autres (lecture ciblée par clé primaire
   * côté store — jamais un dépliage de table).
   *
   * INVARIANT : toute clé résolue pendant cet appel — hit comme lecture — est
   * dans le retour, même si le cache est plein et l'a déjà purgée. Le cache
   * borne la MÉMOIRE, jamais la réponse. Une clé introuvable côté chargeur
   * (ligne purgée) n'entre simplement pas dans le retour, et l'appelant décide
   * quoi en faire.
   */
  resoudre(
    cles: readonly string[],
    charger: (absentes: string[]) => Iterable<readonly [string, V]>,
  ): Map<string, V> {
    const resolues = new Map<string, V>();
    const absentes: string[] = [];
    const vues = new Set<string>();
    for (const cle of cles) {
      if (vues.has(cle)) continue;
      vues.add(cle);
      const valeur = this.lire(cle);
      if (valeur !== undefined) resolues.set(cle, valeur);
      else absentes.push(cle);
    }
    if (absentes.length === 0) return resolues;
    this.appels += 1;
    for (const [cle, valeur] of charger(absentes)) {
      // La valeur entre dans le retour AVANT d'entrer dans le cache, et n'en
      // ressort jamais relue : une purge déclenchée par l'insertion suivante ne
      // peut donc pas escamoter une ligne que cet appel vient de résoudre.
      resolues.set(cle, valeur);
      this.memoriser(cle, valeur);
    }
    return resolues;
  }

  get statistiques(): StatistiquesCache {
    return { taille: this.entrees.size, lectures: this.appels };
  }

  /** Pousse la clé en queue de file et y ancre le rang de l'entrée. */
  private toucher(cle: string, entree: { rang: number }): void {
    entree.rang = this.file.length;
    this.file.push(cle);
    // Compactage AMORTI : la file ne dépasse jamais deux fois la capacité, et
    // chaque compactage est précédé d'au moins `capacite + LEST` touches.
    if (this.file.length >= 2 * this.capacite + LEST_COMPACTAGE) this.compacter();
  }

  /** Sort la clé la moins récemment utilisée, en sautant les rangs périmés. */
  private evincer(): void {
    while (this.tete < this.file.length) {
      const rang = this.tete;
      const cle = this.file[rang];
      this.tete += 1;
      if (cle === undefined) continue;
      const entree = this.entrees.get(cle);
      if (entree !== undefined && entree.rang === rang) {
        this.entrees.delete(cle);
        return;
      }
    }
  }

  /** Réécrit la file sans ses rangs périmés ; les entrées gardent leur ordre LRU. */
  private compacter(): void {
    const vivantes: string[] = [];
    for (let i = this.tete; i < this.file.length; i += 1) {
      const cle = this.file[i];
      if (cle === undefined) continue;
      const entree = this.entrees.get(cle);
      if (entree !== undefined && entree.rang === i) {
        entree.rang = vivantes.length;
        vivantes.push(cle);
      }
    }
    this.file = vivantes;
    this.tete = 0;
  }
}
