// Le Cerveau vu comme un GRAPHE — ce qu'on montre à l'écran.
//
// ─── POURQUOI CE MODULE EST SÉPARÉ DE L'ÉCRAN ────────────────────────────────
//
// Une vue en graphe est surtout de l'animation, et l'animation ne se teste pas.
// Ce qui se teste, ce sont les DÉCISIONS : quelles arêtes existent, laquelle
// est morte, quelle note est orpheline, laquelle a servi récemment. Elles vivent
// donc ici, en pur, et le canevas ne fait plus que dessiner ce qu'on lui donne.
//
// Sans cette séparation, la seule façon de vérifier qu'un lien mort n'est pas
// dessiné serait de lire des pixels.
//
// ─── LES TROIS CHOIX QUI PORTENT LA VUE ──────────────────────────────────────
//
//   1. UN LIEN MORT N'EST PAS UNE ARÊTE. `[[note-absente]]` ne peut pas être
//      tracé : il n'a pas d'autre bout. Le dessiner vers le vide inventerait à
//      l'écran une note qui n'existe pas — exactement le contraire de ce qu'une
//      vue de santé doit faire. Ils sont donc COMPTÉS À PART et listés, pour
//      qu'on les répare plutôt que de les croire.
//
//   2. UN LIEN RÉCIPROQUE EST UNE SEULE ARÊTE. Si A cite B et B cite A, c'est
//      une relation, pas deux. Les garder toutes les deux doublerait aussi la
//      raideur du ressort côté physique : deux notes qui s'aiment se
//      colleraient l'une à l'autre sans que rien ne l'explique.
//
//   3. L'ORDRE EST TOTAL. Deux chargements du même dossier doivent rendre le
//      même graphe dans le même ordre, sinon la simulation repart d'un autre
//      état à chaque rafraîchissement et le graphe « saute » sans raison. Une
//      vue qui bouge doit bouger parce que le savoir a bougé.

import { type Genre, GENRES, type Note, liensDe } from './cerveau.js';
import { champSurUneLigne } from './donnees-non-fiables.js';

/** Un jour, en millisecondes. */
const JOUR = 86_400_000;

/** Les titres viennent de fichiers éditables à la main : on les borne. */
const TITRE_MAX = 120;

export interface NoeudGraphe {
  readonly id: string;
  readonly genre: Genre;
  readonly titre: string;
  /** Combien de fois cette note a été rencontrée — la taille du point. */
  readonly recurrences: number;
  /** Combien de liens VIVANTS la touchent, dans un sens ou dans l'autre. */
  readonly degre: number;
  /**
   * Âge en jours, ou `null` si la date est illisible.
   *
   * Les notes s'éditent À LA MAIN dans Obsidian : une date ratée arrive. Rendre
   * `0` la ferait passer pour toute neuve, ce qui est une affirmation fausse
   * plutôt qu'une absence de réponse.
   */
  readonly ageJours: number | null;
  /**
   * Jours depuis le dernier service à une ouvrière — `null` si jamais servie.
   *
   * C'est LA mesure d'usage : une note qui n'a jamais servi est du savoir
   * qu'on stocke sans s'en servir, et c'est précisément ce qu'on veut voir.
   *
   * Une date de service ILLISIBLE compte aussi pour `null`, et le sens va dans
   * le bon côté : on ne peut pas affirmer que la note a servi, donc on ne
   * l'affirme pas. L'erreur inverse — la compter comme utilisée — ferait passer
   * du savoir dormant pour actif dans l'écran fait pour le repérer.
   */
  readonly serviIlYaJours: number | null;
}

/** Une relation entre deux notes qui existent toutes les deux. */
export interface AreteGraphe {
  readonly de: string;
  readonly vers: string;
  /** Vrai quand chacune cite l'autre. */
  readonly reciproque: boolean;
}

export interface LienMort {
  readonly de: string;
  readonly vers: string;
}

export interface Graphe {
  readonly noeuds: readonly NoeudGraphe[];
  readonly aretes: readonly AreteGraphe[];
  /** Cités mais introuvables — à réparer, jamais à dessiner. */
  readonly liensMorts: readonly LienMort[];
  /** Ni citées ni citantes : du savoir qui ne se raccroche à rien. */
  readonly orphelines: readonly string[];
  readonly parGenre: Readonly<Record<Genre, number>>;
  /** Combien de notes ont déjà servi au moins une fois. */
  readonly servies: number;
  readonly total: number;
}

/**
 * Combien de jours entre `iso` et `maintenant` — `null` si la date est illisible.
 *
 * `Date.parse` d'une chaîne ratée rend `NaN`, et `NaN` traverse tout : il
 * deviendrait un rayon `NaN` côté canevas, donc un point qui ne se dessine
 * pas. Une note invisible dans la vue censée montrer TOUT le savoir est le
 * pire résultat possible — on le coupe ici, à la source.
 */
function joursDepuis(iso: string | undefined, maintenant: number): number | null {
  if (iso === undefined) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // Une horloge décalée (ou une date future saisie à la main) donnerait un
  // nombre négatif : on plancher à 0 plutôt que d'afficher « il y a -3 jours ».
  return Math.max(0, Math.floor((maintenant - t) / JOUR));
}

/** Clé d'une paire NON ORIENTÉE : `a|b` et `b|a` donnent la même. */
function paire(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Replie les notes en graphe affichable.
 *
 * `maintenant` est un PARAMÈTRE et non `Date.now()` : sans cela, les âges
 * changeraient à chaque appel et aucun test ne pourrait les vérifier.
 */
export function graphe(notes: readonly Note[], maintenant: number): Graphe {
  const parId = new Map(notes.map((n) => [n.id, n]));

  // ── Arêtes ────────────────────────────────────────────────────────────────
  const vues = new Map<string, AreteGraphe>();
  const liensMorts: LienMort[] = [];
  const degre = new Map<string, number>();

  for (const n of notes) {
    for (const cible of liensDe(n.corps)) {
      // Une note qui se cite elle-même n'est pas une relation : côté physique
      // ce serait un ressort de longueur nulle sur lui-même.
      if (cible === n.id) continue;
      if (!parId.has(cible)) {
        liensMorts.push({ de: n.id, vers: cible });
        continue;
      }
      const cle = paire(n.id, cible);
      const deja = vues.get(cle);
      if (deja) {
        // L'autre sens existait déjà : c'est la MÊME relation, réciproque.
        vues.set(cle, { ...deja, reciproque: true });
        continue;
      }
      vues.set(cle, { de: n.id, vers: cible, reciproque: false });
      degre.set(n.id, (degre.get(n.id) ?? 0) + 1);
      degre.set(cible, (degre.get(cible) ?? 0) + 1);
    }
  }

  const aretes = [...vues.values()].sort(
    (a, b) => a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers),
  );

  // ── Nœuds ─────────────────────────────────────────────────────────────────
  const noeuds = [...notes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n): NoeudGraphe => ({
      id: n.id,
      genre: n.genre,
      titre: champSurUneLigne(n.titre, TITRE_MAX),
      recurrences: Math.max(1, n.recurrences),
      degre: degre.get(n.id) ?? 0,
      ageJours: joursDepuis(n.creee, maintenant),
      serviIlYaJours: joursDepuis(n.serviLe, maintenant),
    }));

  const parGenre = Object.fromEntries(GENRES.map((g) => [g, 0])) as Record<Genre, number>;
  for (const n of noeuds) parGenre[n.genre] += 1;

  return {
    noeuds,
    aretes,
    liensMorts: liensMorts.sort((a, b) => a.de.localeCompare(b.de) || a.vers.localeCompare(b.vers)),
    // Une CARTE n'est jamais orpheline : son rôle est d'être un point d'entrée,
    // pas d'être citée. Même exception que `sante()`, et pour la même raison.
    orphelines: noeuds.filter((n) => n.genre !== 'carte' && n.degre === 0).map((n) => n.id),
    parGenre,
    servies: noeuds.filter((n) => n.serviIlYaJours !== null).length,
    total: noeuds.length,
  };
}
