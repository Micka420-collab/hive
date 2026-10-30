// Le NIVEAU de chaque ligne de la sortie en direct — lu à la source, jamais deviné.
//
// ─── POURQUOI LE NŒUD LE DIT, ET PAS L'ÉCRAN ────────────────────────────────
//
// Le morceau de sortie (`TaskUpdateMsg.sortie`) mêlait stdout et stderr dans un
// seul texte : arrivé à l'écran, plus rien ne disait d'où venait une ligne. Un
// filtre « erreurs » n'aurait eu que le TEXTE pour juger — le mot « error »
// dans un nom de fichier, une ligne de stderr qui n'est qu'une bannière, un
// `grep error` de l'agent : autant de faux niveaux. Le seul endroit qui SAIT
// est le nœud, au moment où il lit le processus :
//
//   · `stdout` / `stderr` : le flux sur lequel le processus a écrit la ligne ;
//   · `avertissement` / `erreur` : un événement que le flux STRUCTURÉ de
//     l'agent déclare lui-même — Codex `--json` (`error`, élément `error`,
//     adapters/flux-codex.ts), stream-json de Claude Code (`result` à
//     `is_error`, message à `error`, `api_retry` : adapters/texte-final.ts) ;
//   · `hive` : une ligne que Hive écrit lui-même dans le flux (« […] octets
//     omis », fin coupée après caviardage, bandeau de nœud d'une course).
//
// Un nœud d'avant ce contrat n'envoie pas de niveaux : l'écran dit alors
// « niveau inconnu » pour ses lignes, il ne les range pas en stdout.
//
// ─── LA FORME SUR LE FIL ────────────────────────────────────────────────────
//
// Des SEGMENTS `[niveau, nombre de lignes]`, dans l'ordre du texte : stdout et
// stderr arrivent par longues séries, et un morceau de 4 Kio en porte deux ou
// trois — pas un niveau par ligne. Le total doit ÉGALER le nombre de lignes du
// texte (`compterLignes`) : un décompte faux décalerait tous les niveaux qui
// suivent, et une ligne de stdout se lirait « erreur ». Le hub refuse donc un
// morceau dont le décompte ne tombe pas juste, et l'écran le lit « inconnu ».

/** D'où vient une ligne de la sortie en direct. */
export type NiveauSortie = 'stdout' | 'stderr' | 'avertissement' | 'erreur' | 'hive';

/** Ce que le flux STRUCTURÉ d'un agent déclare d'une ligne (Codex `--json`, stream-json). */
export type GraviteAgent = 'avertissement' | 'erreur';

export const NIVEAUX_SORTIE: readonly NiveauSortie[] = [
  'stdout',
  'stderr',
  'avertissement',
  'erreur',
  'hive',
];

/** `[niveau, nombre de lignes consécutives de ce niveau]`. */
export type SegmentNiveau = readonly [NiveauSortie, number];

/** Un bloc de lignes ENTIÈRES d'un même niveau, avant caviardage (nœud). */
export interface BlocSortie {
  niveau: NiveauSortie;
  /** Des lignes entières : le texte finit par `\n`. */
  texte: string;
}

/**
 * Le nombre de lignes d'un texte, tel que l'écran les découpe : un `\n` final
 * ferme la dernière ligne, il n'en ouvre pas une vide.
 */
export function compterLignes(texte: string): number {
  if (texte === '') return 0;
  let n = 0;
  for (let i = texte.indexOf('\n'); i >= 0; i = texte.indexOf('\n', i + 1)) n += 1;
  return texte.endsWith('\n') ? n : n + 1;
}

/** Ajoute `lignes` lignes de `niveau` à la fin des segments, en fusionnant. */
export function pousserSegment(
  segments: [NiveauSortie, number][],
  niveau: NiveauSortie,
  lignes: number,
): void {
  if (lignes <= 0) return;
  const dernier = segments[segments.length - 1];
  if (dernier && dernier[0] === niveau) dernier[1] += lignes;
  else segments.push([niveau, lignes]);
}

/**
 * Des segments valides POUR CE texte : niveaux connus, comptes entiers
 * positifs, total égal au nombre de lignes. Borné par ce nombre : un segment
 * compte au moins une ligne, donc jamais plus de segments que de lignes.
 */
export function niveauxValides(v: unknown, texte: string): v is SegmentNiveau[] {
  if (!Array.isArray(v)) return false;
  const lignes = compterLignes(texte);
  if (v.length === 0 || v.length > lignes) return false;
  let total = 0;
  for (const s of v as unknown[]) {
    if (!Array.isArray(s) || s.length !== 2) return false;
    const [niveau, n] = s as unknown[];
    if (!NIVEAUX_SORTIE.includes(niveau as NiveauSortie)) return false;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) return false;
    total += n;
  }
  return total === lignes;
}
