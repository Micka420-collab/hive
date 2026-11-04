// La recherche de la palette (Ctrl/Cmd+K) — sur ce que CET écran a déjà le droit de voir.
//
// ─── CE QU'ELLE CHERCHE, ET CE QU'ELLE NE PEUT PAS CHERCHER ──────────────────
//
// La Reine n'a pas de route de recherche ni d'index. La palette ne fabrique
// donc rien : elle cherche dans l'instantané que le flux temps réel a DÉJÀ
// remis à cet écran — projets, tâches, machines —, plus les vues et les
// commandes. Aucun résultat ne peut venir d'un projet que l'écran ne voyait
// pas : il n'est pas dans l'instantané. Les fichiers ne sont pas cherchés —
// il faudrait parcourir le Rayon de chaque projet, et la palette le dit.
//
// Module PUR : la normalisation et le classement sont testés sans DOM.

export type GroupePalette = 'commandes' | 'projets' | 'missions' | 'agents' | 'vues';

export const ORDRE_GROUPES: readonly GroupePalette[] = [
  'commandes',
  'projets',
  'missions',
  'agents',
  'vues',
];

export interface EntreePalette<A = unknown> {
  readonly id: string;
  readonly groupe: GroupePalette;
  readonly titre: string;
  readonly sousTitre?: string;
  /** Autres noms qui doivent la trouver (« Miellerie » pour la validation). */
  readonly alias?: readonly string[];
  /** Plus grand = plus récent ; départage les égalités. */
  readonly recence?: number;
  readonly action: A;
}

/** Minuscules, sans accents, espaces resserrés : « Équipe » ≡ « equipe ». */
export function normaliser(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le score d'un texte pour une requête normalisée — 0 : pas de correspondance. */
export function scoreTexte(texte: string, requete: string): number {
  if (requete === '') return 1;
  const n = normaliser(texte);
  if (n === requete) return 100;
  if (n.startsWith(requete)) return 80;
  if (n.split(/[\s/._:-]+/).some((mot) => mot.startsWith(requete))) return 60;
  if (n.includes(requete)) return 40;
  // Tous les mots de la requête présents, dans n'importe quel ordre.
  const mots = requete.split(' ').filter(Boolean);
  if (mots.length > 1 && mots.every((m) => n.includes(m))) return 30;
  return 0;
}

export function scoreEntree(e: EntreePalette, requete: string): number {
  const q = normaliser(requete);
  let meilleur = scoreTexte(e.titre, q);
  for (const a of e.alias ?? []) meilleur = Math.max(meilleur, scoreTexte(a, q) - 5);
  if (e.sousTitre) meilleur = Math.max(meilleur, scoreTexte(e.sousTitre, q) - 20);
  return meilleur;
}

export interface GroupeResultats<A> {
  readonly groupe: GroupePalette;
  readonly entrees: readonly EntreePalette<A>[];
}

/**
 * Les résultats, groupés dans l'ordre fixe des groupes, chacun borné.
 * Requête vide : les commandes et le plus récent de chaque groupe.
 */
export function rechercher<A>(
  entrees: readonly EntreePalette<A>[],
  requete: string,
  parGroupe = 6,
): GroupeResultats<A>[] {
  const notes = entrees
    .map((e) => ({ e, s: scoreEntree(e, requete) }))
    .filter((x) => x.s > 0)
    .sort(
      (a, b) =>
        b.s - a.s ||
        (b.e.recence ?? 0) - (a.e.recence ?? 0) ||
        a.e.titre.localeCompare(b.e.titre, 'fr'),
    );
  const out: GroupeResultats<A>[] = [];
  for (const g of ORDRE_GROUPES) {
    const du = notes
      .filter((x) => x.e.groupe === g)
      .slice(0, parGroupe)
      .map((x) => x.e);
    if (du.length > 0) out.push({ groupe: g, entrees: du });
  }
  return out;
}

/** La liste à plat, dans l'ordre d'affichage — c'est elle que parcourent les flèches. */
export function aPlat<A>(groupes: readonly GroupeResultats<A>[]): EntreePalette<A>[] {
  return groupes.flatMap((g) => g.entrees);
}
