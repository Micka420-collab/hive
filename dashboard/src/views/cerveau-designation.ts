/**
 * LA DÉSIGNATION DANS LE CERVEAU — ce que le doigt attrape, ce qui reste allumé.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * Même motif que `cerveau-physique.ts`, et même leçon (§ 2 quaterdecies du
 * carnet des erreurs) : « hors d'atteinte du banc » est presque toujours
 * « au mauvais endroit ».
 *
 * Le balayage par mutation a signalé deux gardes survivantes dans la vue du
 * Cerveau, toutes deux réputées prisonnières du `<canvas>` — dont `getContext`
 * rend `null` sous happy-dom, ce qui rend la boucle de dessin inatteignable :
 *
 *   · `d < rayon(p.n) + 8 && d < meilleur` — la sélection du corps sous le
 *     curseur. Mutée en `>`, on attrape la note la PLUS ÉLOIGNÉE du clic :
 *     cliquer sur une note en ouvrirait une autre, à l'autre bout de l'écran,
 *     sans que rien n'ait l'air cassé. C'est la pire des pannes : celle qui
 *     répond, mais à côté.
 *   · le halo du voisinage — mutée, choisir une note éteindrait ses voisines
 *     avec le reste, et l'écran fait pour SUIVRE les liens n'en montrerait
 *     plus aucun.
 *
 * Or ni l'une ni l'autre ne touche au contexte de dessin. La première prend
 * un point déjà converti en coordonnées du graphe et une liste de corps ; la
 * seconde prend trois identifiants. Sorties de la boucle, elles s'éprouvent
 * au point près.
 *
 * ─── LES RÈGLES QUE CE MODULE TIENT ──────────────────────────────────────────
 *
 *   1. ON ATTRAPE CE QU'ON VISE : le corps retenu est le PLUS PROCHE du point,
 *      et seulement s'il est réellement sous le curseur — à l'intérieur de son
 *      disque, élargi d'une marge de confort au doigt.
 *   2. LE VOISINAGE RESTE ALLUMÉ : quand une note est désignée, elle et ses
 *      voisines gardent leurs couleurs ; tout le reste s'éteint. Sans cette
 *      exception, désigner une note effacerait précisément ce qu'on cherchait
 *      à voir — ses liens.
 */

/** La part d'une note dont dépend la taille de son disque. */
export interface TailleNote {
  recurrences: number;
  degre: number;
}

/** La part d'une note dont dépend sa « chaleur » — son ancienneté d'usage. */
export interface NoteServie {
  /** Jours depuis le dernier usage, ou `null` si elle n'a JAMAIS servi. */
  serviIlYaJours: number | null;
}

/** Au-delà de ce nombre de jours sans usage, une note est froide (chaleur 0). */
export const FENETRE_CHALEUR_JOURS = 30;

/**
 * La « chaleur » d'une note, entre 0 et 1 : 1 si elle vient de servir, et elle
 * décroît linéairement jusqu'à 0 sur `FENETRE_CHALEUR_JOURS` jours.
 *
 * `null` (JAMAIS servie) et `0` (servie AUJOURD'HUI) sont aux deux extrêmes — et
 * les confondre est précisément le défaut que cet écran existe pour éviter :
 * `null` rend 0 (du savoir dormant), là où 0 jour rend 1 (du savoir vif). Sans
 * la garde, `null` glisserait dans l'arithmétique (`null / 30 === 0`) et une note
 * jamais touchée s'afficherait aussi chaude qu'une note servie à l'instant.
 *
 * Le plancher `Math.max(0, …)` empêche une horloge en avance (ancienneté > 30)
 * de produire une chaleur NÉGATIVE, qui inverserait le halo au lieu de l'éteindre.
 */
export function chaleur(n: NoteServie): number {
  if (n.serviIlYaJours === null) return 0;
  return Math.max(0, 1 - n.serviIlYaJours / FENETRE_CHALEUR_JOURS);
}

/** Un corps posé sur la scène — la part que la désignation touche. */
export interface CorpsPointable {
  id: string;
  x: number;
  y: number;
  n: TailleNote;
}

/**
 * Le rayon du disque d'une note, en points de la scène.
 *
 * Les récurrences sont écrasées par une racine : une panne vue cinquante fois
 * ne doit pas faire un disque cinquante fois plus large — elle mangerait
 * l'écran et cacherait précisément ce qu'elle explique. Le degré (le nombre
 * de liens) ajoute au plus 7 points : une note très reliée se voit, sans
 * pouvoir dominer l'écran à elle seule.
 */
export function rayon(n: TailleNote): number {
  return 5 + Math.sqrt(n.recurrences) * 2.8 + Math.min(7, n.degre * 0.9);
}

/**
 * La marge de confort autour du disque, en points.
 *
 * Un disque de note peut descendre à 5 points de rayon : viser 5 points à la
 * souris (a fortiori au doigt) est un exercice, pas une interface. La marge
 * élargit la cible sans élargir le dessin.
 */
export const MARGE_DOIGT = 8;

/**
 * Le corps sous le point, ou `null` si le point ne touche personne.
 *
 * `point` est attendu DANS LES COORDONNÉES DU GRAPHE — la conversion depuis
 * l'écran (translation et zoom de la vue) reste à l'appelant, qui seul connaît
 * le cadrage courant.
 *
 * En cas de recouvrement, c'est le PLUS PROCHE du point qui gagne, jamais le
 * premier venu de la liste : deux notes qui se chevauchent ne doivent pas
 * rendre l'une des deux inatteignable selon l'ordre de la collection.
 */
export function corpsSousLePoint<T extends CorpsPointable>(
  point: { x: number; y: number },
  corps: Iterable<T>,
): T | null {
  let trouve: T | null = null;
  let meilleur = Infinity;
  for (const p of corps) {
    const d = Math.hypot(p.x - point.x, p.y - point.y);
    if (d < rayon(p.n) + MARGE_DOIGT && d < meilleur) {
      meilleur = d;
      trouve = p;
    }
  }
  return trouve;
}

/**
 * Cette note doit-elle être éteinte (dessinée en retrait) ?
 *
 * Tant que personne n'est désigné, TOUT est allumé : un graphe au repos se lit
 * en entier. Dès qu'une note est désignée — au clic ou au survol — restent
 * allumées elle-même et ses voisines ; le reste s'efface pour laisser voir le
 * voisinage.
 *
 * `voisinage` vaut `null` au survol simple (on n'a pas encore choisi de note) :
 * survoler éteint alors le reste sans rien épargner d'autre que la note
 * survolée, ce qui est exactement l'aperçu recherché.
 */
export function estEteinte(
  id: string,
  actif: string | null,
  voisinage: ReadonlySet<string> | null,
): boolean {
  if (actif === null) return false;
  if (id === actif) return false;
  return !voisinage?.has(id);
}
