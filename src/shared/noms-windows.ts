// LES NOMS QUE WINDOWS NE LAISSE PAS À UN FICHIER.
//
// ─── CE QU'ILS FONT, ET POURQUOI UNE SEULE RÈGLE ─────────────────────────────
//
// `CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`, `LPT1`…`LPT9` (et `COM¹²³`,
// `LPT¹²³`, que Windows lit comme des chiffres) désignent des PÉRIPHÉRIQUES
// dans TOUT dossier — suivis d'une extension aussi : `nul.txt` et `nul.tar.gz`
// valent `NUL`. Un point ou une espace final est retiré en silence. Source :
// « Naming Files, Paths, and Namespaces » (Microsoft Learn, Win32).
//
// Un tel nom ne désigne donc pas, à l'écriture, le fichier qu'on croyait :
// `mkdir aux` échoue, `aux.patch` part vers le port auxiliaire, et un dossier
// `nul` n'existe jamais. Trois lieux de Hive tirent un chemin d'un texte qu'ils
// ne choisissent pas, et la même règle vaut pour les trois :
//
//   · les entrées d'une archive (`deballage.ts`) — REFUSÉES ;
//   · le dossier d'un nœud, tiré de son nom (`HIVE_NODE_NAME`, sinon le nom
//     de la machine) — REMAPPÉ sous Windows, `segmentSur` ; donné par
//     l'opérateur (`HIVE_WORKDIR`), REFUSÉ sous Windows (`identite-noeud.ts`) ;
//   · les identifiants du protocole (tâche, merge, chantier, projet) devenus
//     noms de dossier ou de fichier sur le nœud — REMAPPÉS, `segmentSur`.
//
// ─── POURQUOI REMAPPER LES IDENTIFIANTS AU LIEU DE LES REFUSER ───────────────
//
// `ID_PATTERN` laisse passer `aux` : le planificateur en tire d'un titre « Aux »
// (`slugify`), et une API en accepte d'un client. Resserrer le motif ferait
// d'une tâche déjà rangée sous ce nom un message que le nœud rejette À LA
// LECTURE — une tâche assignée que personne n'exécute, en silence. Le nom est
// légitime ; c'est son usage comme chemin, sous Windows, qui ne l'est pas. On
// corrige donc le CHEMIN, au puits, et l'identifiant reste ce qu'il est.

/** Un nom de périphérique en TÊTE de segment, seul ou suivi d'une extension. */
const RE_NOM_RESERVE = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

/**
 * Vrai si Windows n'écrirait pas ce SEGMENT (un seul nom, sans séparateur)
 * sous le nom qu'il porte : nom de périphérique, point ou espace final.
 */
export function nomReserveWindows(segment: string): boolean {
  return RE_NOM_RESERVE.test(segment) || /[. ]$/.test(segment);
}

/**
 * Le segment tel quel, ou marqué d'un `~` là où Windows le réécrirait.
 *
 * `~` et pas `_` : il est HORS de l'alphabet des identifiants (`ID_PATTERN`) et
 * des noms de nœud nettoyés (`[A-Za-z0-9_-]`). `aux` devient `aux~`, et aucun
 * autre identifiant ne peut tomber sur le même dossier — `aux_` en est un
 * VALIDE, qu'un remappage en `_` aurait confondu avec lui.
 *
 * Le `~` se pose JUSTE APRÈS le nom de périphérique, pas en fin de segment :
 * `aux.patch~` garderait `aux` devant une extension, donc le port auxiliaire.
 * `aux.patch` devient `aux~.patch` ; un point ou une espace final reçoit le
 * sien en queue.
 *
 * Sur tous les systèmes pour les identifiants du protocole : le chemin d'un
 * même identifiant ne dépend pas de la machine qui le calcule. Le dossier d'un
 * nœud, lui, ne sert qu'à sa machine et porte son identité : il n'est remappé
 * que sous Windows (`racineDeTravailParDefaut`).
 */
export function segmentSur(segment: string): string {
  const peripherique = RE_NOM_RESERVE.exec(segment)?.[1];
  const tete = peripherique ? `${peripherique}~${segment.slice(peripherique.length)}` : segment;
  return /[. ]$/.test(tete) ? `${tete}~` : tete;
}
