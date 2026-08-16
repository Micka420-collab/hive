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

/**
 * Un relâcher de souris est-il un CLIC, et non la fin d'un GLISSER ?
 *
 * Déplacer une note dans le graphe se termine par un `mouseup`, exactement comme
 * un clic pour la désigner. Sans ce départage, chaque déplacement sélectionnerait
 * la note au relâcher — on ne pourrait jamais la bouger sans la choisir.
 *
 * La règle : en deçà de `SEUIL_GLISSE` pixels parcourus entre l'appui et le
 * relâcher, c'est un clic ; au-delà, un glisser. Le seuil absorbe le micro-
 * tremblement de la main, qui ne doit pas changer un clic en glisser. La distance
 * est EUCLIDIENNE : un déplacement en diagonale compte autant qu'à l'horizontale.
 *
 * Même motif que les règles ci-dessus : extraite de la boucle du canevas (où
 * `getContext` est nul sous banc) pour s'éprouver au pixel près, plutôt que
 * d'être simulée à travers un canevas muet.
 */
export const SEUIL_GLISSE = 4;

export function estUnClic(
  depart: { readonly x: number; readonly y: number },
  fin: { readonly x: number; readonly y: number },
): boolean {
  return Math.hypot(fin.x - depart.x, fin.y - depart.y) <= SEUIL_GLISSE;
}

/**
 * Ce qu'un relâcher de souris DÉCIDE sur le canevas : choisir une note, ou rien.
 *
 * C'est le compagnon d'`estUnClic`, extrait pour la même raison — le canevas ne
 * se joue pas sous banc (`getContext` nul, aucune mise en page pour placer les
 * corps). Ce qui RESTE dans `Cerveau.tsx` est alors de la pure tuyauterie :
 * `onMouseDown` retient l'`id` sous le curseur, `onMouseMove` traîne le corps.
 * La DÉCISION, elle — « un glisser ne choisit rien, un clic choisit ce qu'il y a
 * dessous » —, vit ici et s'éprouve au pixel près.
 *
 * `choisir: false` NE touche PAS la sélection courante : déplacer une note ne
 * doit jamais l'isoler au relâcher, même si le curseur retombe pile dessus.
 * `choisir: true` avec `id: null` est un choix délibéré : un clic dans le vide
 * DÉSÉLECTIONNE. Confondre les deux (« glisser » traité comme « clic dans le
 * vide ») effacerait la sélection à chaque déplacement.
 */
export function selectionAuRelacher(
  appui: { readonly x: number; readonly y: number },
  relache: { readonly x: number; readonly y: number },
  idSousRelache: string | null,
): { choisir: boolean; id: string | null } {
  if (!estUnClic(appui, relache)) return { choisir: false, id: null };
  return { choisir: true, id: idSousRelache };
}

/** L'état de saisie du canevas : ce qu'un appui a attrapé, et d'où il est parti. */
export interface Prise {
  /** L'identifiant du corps saisi, ou `null` si l'appui a manqué tout corps. */
  id: string | null;
  /** Vrai si c'est le FOND qui est saisi — le glisser déplacera alors la VUE. */
  fond: boolean;
  /** Le point d'appui, en pixels de l'écran, d'où se mesure le glisser. */
  x: number;
  y: number;
}

/**
 * Ce qu'un APPUI sur le canevas attrape : un corps, ou le fond.
 *
 * Même motif que `selectionAuRelacher` (et § 2 quaterdecies du carnet) : la
 * boucle du canevas ne se joue pas sous banc (`getContext` rend `null`), mais la
 * DÉCISION, elle, s'éprouve au point près une fois sortie de la boucle. Trouver
 * le corps sous le curseur en coordonnées du canevas RESTE dans `Cerveau.tsx` ;
 * ce qui est décidable — « corps ou fond ? » — vient ici.
 *
 * La règle, et pourquoi les deux membres comptent : un corps sous le doigt est
 * SAISI (`fond: false`) pour être déplacé ; à défaut, on saisit le FOND
 * (`fond: true`), et le glisser déplace la VUE (panoramique). Confondre les deux
 * casse un geste sur deux — saisir le fond alors qu'on visait une note
 * déplacerait la vue au lieu de la note ; « saisir » un corps là où il n'y en a
 * pas traînerait un identifiant qui ne désigne personne.
 */
export function priseAuDoigt(
  sousLeCurseur: { readonly id: string } | null,
  x: number,
  y: number,
): Prise {
  if (sousLeCurseur === null) return { id: null, fond: true, x, y };
  return { id: sousLeCurseur.id, fond: false, x, y };
}

/**
 * Ce qu'un GLISSER du curseur accomplit : TRAÎNER un corps (`traine: true`, avec
 * son `id` déjà resserré à `string`), ou, à défaut de corps, déplacer le FOND
 * (`fond: true`) si le fond était saisi, sinon SURVOLER (`fond: false`).
 */
export type Deplacement =
  | { readonly traine: true; readonly id: string }
  | { readonly traine: false; readonly fond: boolean };

/**
 * L'aiguillage du déplacement, sorti de la boucle du canevas pour s'éprouver au
 * point près.
 *
 * Même motif que `priseAuDoigt` et `selectionAuRelacher` (et § 2 quaterdecies du
 * carnet) : le déplacement lui-même — bouger un corps en coordonnées du graphe,
 * translater la vue — reste de la tuyauterie du canevas, injouable sous banc
 * (`getContext` rend `null`). L'aiguillage, lui, ne lit que la prise.
 *
 * Le résultat se lit par des booléens NUS (`traine`, puis `fond`), et c'est
 * délibéré : l'appelant les teste sans opérateur (`if (d.traine)`), si bien que
 * la SEULE comparaison — `prise.id !== null` — vit ICI, où un banc la garde, et
 * ne retombe pas dans `onMouseMove`, où le canevas muet la rendrait intestable.
 * L'ordre compte : un corps saisi PRIME sur le fond, sinon traîner une note
 * déplacerait la VUE au lieu de la note — un geste sur deux cassé.
 */
export function deplacementDuGlisse(prise: {
  readonly id: string | null;
  readonly fond: boolean;
}): Deplacement {
  if (prise.id !== null) return { traine: true, id: prise.id };
  return { traine: false, fond: prise.fond };
}

// ─── LES ÉTIQUETTES DU GRAPHE ────────────────────────────────────────────────
//
// Qui a droit à son nom écrit sur la toile, dans quel ordre on les pose, et
// laquelle saute quand deux se recouvrent.
//
// Troisième application du même motif (§ 2 quaterdecies) : le balayage par
// mutation a montré la règle NUE. `if (heurte && p.id !== actif) continue;`
// muté en `||` laissait la suite ENTIÈRE verte — et faisait disparaître TOUS
// les noms du graphe sauf celui de la note regardée. Un graphe de savoir dont
// les nœuds n'ont plus de nom : l'écran répond, il ne dit plus rien.
//
// Le canevas ne garde ici qu'un rôle, et c'est le bon : celui de RÈGLE. Lui
// seul sait combien de pixels prend un titre dans une fonte donnée
// (`measureText`), et cette mesure lui est rendue par le paramètre `boiteDe`.
// La POLITIQUE — qui, dans quel ordre, et qui cède — n'a jamais eu besoin de
// savoir dessiner.

/** Un rectangle de la toile, en coordonnées du graphe. */
export interface Boite {
  x: number;
  y: number;
  /** Largeur. */
  l: number;
  /** Hauteur. */
  h: number;
}

/** La part d'une note dont dépend son droit à porter son nom. */
export interface NoteNommable {
  genre: string;
  /** Nombre de liens qui l'attachent au reste du savoir. */
  degre: number;
}

/**
 * Une note est-elle de la CHARPENTE — la structure du savoir, par opposition à
 * ce qui n'en est qu'une trace ?
 *
 * Deux conditions, et aucune ne suffit. Un `episode` est le récit d'UNE panne :
 * il y en a des centaines, et les nommer tous couvrirait la toile d'un texte
 * que personne ne lit. Une note de degré 0 n'est reliée à rien : nommée, elle
 * occuperait la place d'une note qui, elle, tient le graphe ensemble.
 *
 * VU À L'ÉCRAN, PAS DÉDUIT. La première version nommait tout ce qui dépassait
 * un certain rayon. Sur un cerveau réel, trente « épisode 12 — fetch failed »
 * se chevauchaient et cachaient exactement les notes qu'il fallait lire. Les
 * épisodes se lisent au survol, un par un.
 */
export function estCharpente(n: NoteNommable): boolean {
  return n.genre !== 'episode' && n.degre > 0;
}

/**
 * Cette note a-t-elle droit à son nom ?
 *
 * La note ACTIVE passe toujours — c'est celle qu'on regarde, et un graphe qui
 * refuse de nommer ce qu'on désigne est un graphe qui ne répond pas. Une note
 * ÉTEINTE ne passe jamais, fût-elle de la charpente : elle est déjà retirée du
 * regard, et son nom la ferait revenir au premier plan alors que tout le reste
 * de l'écran vient de l'en écarter.
 */
export function porteSonNom(
  id: string,
  n: NoteNommable,
  actif: string | null,
  eteinte: boolean,
): boolean {
  if (eteinte) return false;
  return id === actif || estCharpente(n);
}

/**
 * L'ordre de POSE — et c'est un ordre de PRIORITÉ, pas un ordre d'affichage :
 * qui est posé en premier garde son nom, qui vient après le perd s'il recouvre.
 *
 * La note active d'abord (on ne perd jamais le nom de ce qu'on regarde), puis
 * les mieux reliées — perdre le nom d'un carrefour du savoir coûte plus cher
 * que perdre celui d'une feuille. À degré égal, l'identifiant départage : sans
 * lui l'ordre dépendrait de celui du tableau, et deux images successives ne
 * poseraient pas les mêmes noms — le graphe clignoterait.
 */
export function ordreDePose(
  a: { id: string; degre: number },
  b: { id: string; degre: number },
  actif: string | null,
): number {
  if (a.id === actif) return -1;
  if (b.id === actif) return 1;
  return b.degre - a.degre || a.id.localeCompare(b.id);
}

/**
 * Deux rectangles se recouvrent-ils ? Test d'axes séparateurs, strict sur les
 * quatre bords : deux libellés qui se touchent EXACTEMENT ne se recouvrent pas,
 * et refuser le second ferait perdre un nom pour rien.
 */
export function seChevauchent(a: Boite, b: Boite): boolean {
  return a.x < b.x + b.l && a.x + a.l > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * Les étiquettes RÉELLEMENT posées, dans l'ordre où le canevas doit les écrire.
 *
 * Deux libellés voisins superposés deviennent illisibles TOUS LES DEUX — on perd
 * deux informations au lieu d'une. On les pose donc par priorité, et celui qui
 * recouvrirait un déjà posé est SAUTÉ. Mieux vaut un nom manquant qu'une
 * bouillie : le nom manquant se retrouve au survol.
 *
 * LA NOTE ACTIVE NE PEUT PAS PERDRE SON NOM, et c'est le TRI qui l'assure, pas
 * une exception dans la collision. `ordreDePose` la pose en premier : rien n'est
 * encore posé, donc rien ne peut la recouvrir. Le code d'origine portait bien
 * une exception (`if (heurte && p.id !== actif)`), et le balayage par mutation
 * a montré qu'elle était MORTE — l'ôter ne faisait rougir personne, parce que
 * sa condition n'est jamais atteinte. Une garde qui ne peut pas se déclencher
 * est pire que pas de garde : elle fait croire que l'ordre de pose est
 * indifférent, alors qu'il est la SEULE chose qui protège ce nom-là.
 *
 * Ce que les bancs tiennent, du coup, c'est la GARANTIE et non le mécanisme :
 * casser le tri fait rougir « la note active garde son nom », qui n'a jamais
 * eu besoin de savoir par quel chemin elle l'obtenait.
 *
 * `boiteDe` est la seule chose que le canevas apporte — la largeur d'un titre
 * dans sa fonte. Elle reçoit aussi `actif`, parce que le libellé actif est écrit
 * en gras et prend donc plus de place que les autres.
 */
export function etiquettesPosees<T extends { id: string; n: NoteNommable }>(
  corps: readonly T[],
  actif: string | null,
  eteinte: (id: string) => boolean,
  boiteDe: (p: T, estActif: boolean) => Boite,
): { corps: T; boite: Boite; estActif: boolean }[] {
  const candidats = corps
    .filter((p) => porteSonNom(p.id, p.n, actif, eteinte(p.id)))
    .sort((a, b) =>
      ordreDePose({ id: a.id, degre: a.n.degre }, { id: b.id, degre: b.n.degre }, actif),
    );

  const posees: { corps: T; boite: Boite; estActif: boolean }[] = [];
  for (const p of candidats) {
    const estActif = p.id === actif;
    const boite = boiteDe(p, estActif);
    if (posees.some((d) => seChevauchent(boite, d.boite))) continue;
    posees.push({ corps: p, boite, estActif });
  }
  return posees;
}

/**
 * La fonte d'une étiquette — celle qu'on MESURE et celle qu'on ÉCRIT.
 *
 * ─── POURQUOI CETTE CHAÎNE N'A PLUS LE DROIT D'EXISTER EN DEUX EXEMPLAIRES ───
 *
 * `Cerveau.tsx` la composait DEUX FOIS, à deux endroits, avec deux littéraux
 * séparés : une fois pour `measureText` (la largeur de la boîte) et une fois
 * pour `fillText` (le texte réellement posé). Elles s'accordaient par chance,
 * pas par construction.
 *
 * Le jour où l'une des deux change — une taille, une graisse, une famille — la
 * ruche MESURE une fonte et en DESSINE une autre. Les boîtes deviennent
 * fausses, donc les collisions aussi : des noms se superposent, d'autres
 * disparaissent pour un chevauchement qui n'a pas lieu. Et rien ne casse : le
 * graphe s'affiche, il ment juste sur ce qu'il montre.
 *
 * Une seule source pour les deux usages retire la possibilité même de l'écart.
 * Le `600 ` est la graisse semi-grasse de l'active — le seul état qui change la
 * largeur d'un titre, et donc la seule raison pour laquelle `boiteDe` a besoin
 * de savoir qui est actif.
 */
export function policeEtiquette(taille: number, estActif: boolean): string {
  return `${estActif ? '600 ' : ''}${taille}px ui-monospace, monospace`;
}

/**
 * Une note qui n'a JAMAIS servi — du savoir stocké sans usage.
 *
 * ─── POURQUOI CE PRÉDICAT EXISTE, ALORS QU'IL TIENT EN QUATRE MOTS ───────────
 *
 * `serviIlYaJours === null` vivait dans la boucle de dessin du canevas, où il
 * décide de creuser l'anneau d'une note. Un balayage élargi l'a rendu nu, et il
 * ne pouvait pas en être autrement : `getContext` rend `null` sous happy-dom,
 * donc AUCUN banc ne peut atteindre cette ligne.
 *
 * Une décision hors d'atteinte de la mesure est presque toujours au mauvais
 * endroit (§ 2 quaterdecies). Sortie ici, elle s'éprouve ; ce qui reste dans la
 * boucle n'est plus que « si creuse, dessine l'anneau ».
 *
 * `null` (jamais servie) et `0` (servie aujourd'hui) sont aux deux extrêmes, et
 * les confondre est le défaut que cet écran existe pour éviter — c'est le même
 * raisonnement que `chaleur` ci-dessus, et c'est pour ça qu'ils vivent côte à
 * côte : une seule idée, deux usages.
 */
export function noteCreuse(n: NoteServie): boolean {
  return n.serviIlYaJours === null;
}

/** Les noms lisibles des genres de notes — UNE seule source pour tout l'écran. */
export const LIBELLE_GENRE: Readonly<Record<string, { fr: string; en: string }>> = {
  invariant: { fr: 'invariants', en: 'invariants' },
  lecon: { fr: 'leçons', en: 'lessons' },
  decision: { fr: 'décisions', en: 'decisions' },
  carte: { fr: 'cartes', en: 'maps' },
  episode: { fr: 'épisodes', en: 'episodes' },
};

/** Ce que la bulle de survol dit d'une note. */
export interface NoteResumee extends NoteServie {
  genre: string;
  degre: number;
}

/**
 * La ligne de la bulle : genre, nombre de liens, dernier usage.
 *
 * ─── CE QUI SE JOUE DANS UN TEXTE D'INFOBULLE ────────────────────────────────
 *
 * La bulle est du DOM ordinaire — happy-dom sait la rendre. Mais on ne l'ATTEINT
 * qu'en survolant le canevas, et le survol passe par `getBoundingClientRect` et
 * par des positions calculées à `requestAnimationFrame`. Le texte était donc nu
 * pour une raison purement géométrique, alors qu'il ne dépend d'aucune géométrie.
 *
 * Séparé, il redevient ce qu'il est : une phrase déduite de trois champs.
 *
 * Un genre INCONNU rend une chaîne vide plutôt que sa clé brute — c'est le choix
 * déjà fait dans la vue, et il se défend : la bulle nomme déjà la note juste
 * au-dessus, donc afficher `episode_bis` n'apprendrait rien et trahirait un
 * identifiant interne. (La liste des filtres, elle, retombe sur la clé : là,
 * elle est la seule chose qui distingue deux boutons.)
 */
export function resumeDeNote(n: NoteResumee, t: (fr: string, en: string) => string): string {
  const genre = t(LIBELLE_GENRE[n.genre]?.fr ?? '', LIBELLE_GENRE[n.genre]?.en ?? '');
  const usage = noteCreuse(n)
    ? t('jamais servie', 'never used')
    : t(`servie il y a ${n.serviIlYaJours} j`, `used ${n.serviIlYaJours} d ago`);
  return `${genre} · ${n.degre} ${t('liens', 'links')} · ${usage}`;
}

/**
 * La densité de l'écran, jamais zéro.
 *
 * ─── UN REPLI QUI PROTÈGE DEUX PANNES DIFFÉRENTES ────────────────────────────
 *
 * `window.devicePixelRatio` vaut `undefined` là où personne ne l'implémente
 * (happy-dom, un vieux navigateur), et le canevas s'y dessine alors à une
 * échelle `undefined` — c'est-à-dire nulle part.
 *
 * Le mutant `||` → `&&` casse les DEUX sens à la fois, et c'est ce qui le rend
 * intéressant :
 *
 *   · densité absente  ⇒ `undefined && 1` vaut `undefined` : le repli disparaît
 *     exactement quand il servait.
 *   · densité de 2     ⇒ `2 && 1` vaut `1` : sur un écran haute densité, le
 *     graphe se dessine à moitié résolution et paraît flou. Rien ne casse, rien
 *     n'avertit — l'écran est juste moins bon, sans raison visible.
 *
 * Le second est le plus vicieux : il ne se voit que côte à côte avec un écran
 * qui marche.
 */
export function densiteEcran(dpr: number | undefined): number {
  return dpr || 1;
}

/**
 * Le système demande-t-il MOINS DE MOUVEMENT ?
 *
 * ─── POURQUOI ELLE EST ICI, ET PAS DANS LA VUE ───────────────────────────────
 *
 * Elle y était, et le balayage du 16 août l'a rendue SANS TEST. Je l'ai d'abord
 * rangée parmi les « éprouvables sans géométrie » — c'était FAUX, trois fois
 * répété : son unique appel vit ligne 152 de `Cerveau.tsx`, c'est-à-dire APRÈS
 * `const ctx = c.getContext('2d'); if (!ctx) return;`. Sous happy-dom
 * `getContext` rend `null`, l'effet sort ligne 150, et la fonction n'est jamais
 * atteinte. Elle était derrière la MÊME porte que les lignes que j'avais
 * classées hors de portée.
 *
 * D'où la sortie de la boucle, comme `chaleur` et `densiteEcran` avant elle : la
 * décision se juge au point près, et l'ambiant se passe en ARGUMENT plutôt que
 * de se lire dans un global — c'est ce qui la rend mesurable sans navigateur.
 *
 * ─── LE MUTANT, ET CE QU'IL COÛTE ────────────────────────────────────────────
 *
 * `&&` → `||` : dès que `matchMedia` EXISTE, l'expression court-circuite à vrai
 * et le Cerveau se croit toujours en mouvement réduit. L'animation ne démarre
 * jamais, sur tous les postes du monde — un graphe figé, sans message, et une
 * préférence d'accessibilité appliquée à des gens qui ne l'ont pas demandée.
 */
export function mouvementReduit(
  matchMedia: ((requete: string) => { matches: boolean }) | undefined,
): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
