// Réquisitions — l'ouvrière demande un besoin ; l'humain tranche une fois.
//
// Doctrine (ADR 0010) : `cle_api` | `mcp` | `binaire` | `atelier` | `logiciel`.
// La clé reste chez la Queen / Intendance — JAMAIS dans le nœud ni l'Atelier.
// MODULE PUR : aucune I/O. Le store persiste ; l'API pose / répond.

/** Version de la règle de réquisition. */
export const VERSION_REQUISITION = 1;

export const GENRES_REQUISITION = ['cle_api', 'mcp', 'binaire', 'atelier', 'logiciel'] as const;

export type GenreRequisition = (typeof GENRES_REQUISITION)[number];

export type StatutRequisition = 'ouverte' | 'accordee' | 'refusee';

export type MotifRefusRequisition =
  'vide' | 'genre_inconnu' | 'trop_long' | 'noeud_inconnu' | 'inconnue' | 'deja_close';

export const REQUISITION_LIBELLE_MAX = 200;
export const REQUISITION_DETAIL_MAX = 2_000;

export type VerdictGenre =
  { ok: true; genre: GenreRequisition } | { ok: false; motif: MotifRefusRequisition };

export type VerdictLibelle =
  { ok: true; libelle: string } | { ok: false; motif: MotifRefusRequisition };

const GENRES = new Set<string>(GENRES_REQUISITION);

export function estGenreRequisition(brut: string): brut is GenreRequisition {
  return GENRES.has(brut);
}

export function validerGenreRequisition(brut: string): VerdictGenre {
  if (typeof brut !== 'string' || brut.trim().length === 0) {
    return { ok: false, motif: 'vide' };
  }
  const cle = brut.trim().toLowerCase();
  if (!estGenreRequisition(cle)) return { ok: false, motif: 'genre_inconnu' };
  return { ok: true, genre: cle };
}

export function validerLibelleRequisition(brut: string): VerdictLibelle {
  if (typeof brut !== 'string') return { ok: false, motif: 'vide' };
  const libelle = brut.replace(/\s+/g, ' ').trim();
  if (libelle.length === 0) return { ok: false, motif: 'vide' };
  if (libelle.length > REQUISITION_LIBELLE_MAX) return { ok: false, motif: 'trop_long' };
  return { ok: true, libelle };
}

export function libelleGenreRequisition(genre: GenreRequisition, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<GenreRequisition, string> = {
    cle_api: 'Clé d’API',
    mcp: 'Serveur MCP',
    binaire: 'Binaire / outil CLI',
    atelier: 'Atelier (bureau de recette)',
    logiciel: 'Logiciel à installer ou fabriquer',
  };
  const en: Record<GenreRequisition, string> = {
    cle_api: 'API key',
    mcp: 'MCP server',
    binaire: 'Binary / CLI tool',
    atelier: 'Studio (acceptance desktop)',
    logiciel: 'Software to install or build',
  };
  return (lang === 'en' ? en : fr)[genre];
}

/**
 * Quoi faire APRÈS un Accorder réussi — hors `cle_api` (qui a son modal).
 * Sans ça, Accorder ne faisait que basculer le statut : un no-op déguisé.
 */
export type SuiteAccordRequisition =
  | { action: 'modal_cle' }
  | { action: 'atelier' }
  | { action: 'fabrique'; genreFabrique: 'mcp' | 'script_npm' | 'pont' }
  | { action: 'hint_binaire' };

export function suiteAccordRequisition(genre: GenreRequisition): SuiteAccordRequisition {
  if (genre === 'cle_api') return { action: 'modal_cle' };
  if (genre === 'atelier') return { action: 'atelier' };
  if (genre === 'mcp') return { action: 'fabrique', genreFabrique: 'mcp' };
  if (genre === 'logiciel') return { action: 'fabrique', genreFabrique: 'script_npm' };
  return { action: 'hint_binaire' };
}

export function expliquerRefusRequisition(
  motif: MotifRefusRequisition,
  lang: 'fr' | 'en' = 'fr',
): string {
  const fr: Record<MotifRefusRequisition, string> = {
    vide: 'Réquisition incomplète.',
    genre_inconnu: `Genre inconnu — choisissez parmi : ${GENRES_REQUISITION.join(', ')}.`,
    trop_long: `Le libellé dépasse ${REQUISITION_LIBELLE_MAX} caractères.`,
    noeud_inconnu: 'Aucune ouvrière ne porte cet identifiant.',
    inconnue: 'Réquisition introuvable.',
    deja_close: 'Cette réquisition est déjà close.',
  };
  const en: Record<MotifRefusRequisition, string> = {
    vide: 'Incomplete requisition.',
    genre_inconnu: `Unknown kind — pick one of: ${GENRES_REQUISITION.join(', ')}.`,
    trop_long: `The label exceeds ${REQUISITION_LIBELLE_MAX} characters.`,
    noeud_inconnu: 'No worker has that id.',
    inconnue: 'Requisition not found.',
    deja_close: 'That requisition is already closed.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
