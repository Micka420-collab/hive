// Fabrique — écrire un outil DANS le dépôt, puis Chantiers après merge.
//
// Doctrine (ADR 0010 lot 8) : pont / script npm / MCP via production normale
// (diff → Miellerie → merge). Interdit d'exécuter une commande non déclarée.
// Interdit de lancer un chantier AVANT merge LANDÉ + script dans package.json.
//
// MODULE PUR — aucune I/O, aucun spawn.

import { nomDeChantierValide } from '../shared/chantier.js';

export const VERSION_FABRIQUE = 1;

export const GENRES_FABRIQUE = ['script_npm', 'pont', 'mcp'] as const;
export type GenreFabrique = (typeof GENRES_FABRIQUE)[number];

export type StatutFabrique = 'proposee' | 'en_revue' | 'mergee' | 'refusee';

export type MotifRefusFabrique =
  | 'vide'
  | 'genre_inconnu'
  | 'nom_invalide'
  | 'pas_encore_merge'
  | 'non_declare'
  | 'projet_inconnu'
  | 'inconnue'
  | 'deja_close';

export const FABRIQUE_LIBELLE_MAX = 200;

export type VerdictGenreFabrique =
  { ok: true; genre: GenreFabrique } | { ok: false; motif: MotifRefusFabrique };

const GENRES = new Set<string>(GENRES_FABRIQUE);

export function estGenreFabrique(brut: string): brut is GenreFabrique {
  return GENRES.has(brut);
}

export function validerGenreFabrique(brut: string): VerdictGenreFabrique {
  if (typeof brut !== 'string' || brut.trim().length === 0) {
    return { ok: false, motif: 'vide' };
  }
  const cle = brut.trim().toLowerCase();
  if (!estGenreFabrique(cle)) return { ok: false, motif: 'genre_inconnu' };
  return { ok: true, genre: cle };
}

export function validerLibelleFabrique(
  brut: string,
): { ok: true; libelle: string } | { ok: false; motif: MotifRefusFabrique } {
  if (typeof brut !== 'string') return { ok: false, motif: 'vide' };
  const libelle = brut.replace(/\s+/g, ' ').trim();
  if (!libelle) return { ok: false, motif: 'vide' };
  if (libelle.length > FABRIQUE_LIBELLE_MAX) return { ok: false, motif: 'vide' };
  return { ok: true, libelle };
}

/** Noms de scripts déclarés — Record package.json ou liste. */
export function nomsScriptsDeclares(
  scripts: Record<string, string> | readonly string[],
): Set<string> {
  if (Array.isArray(scripts)) return new Set(scripts);
  return new Set(Object.keys(scripts));
}

/**
 * Peut-on proposer de LANCER ce script en chantier ?
 * mergeLanded = le diff fabrique a atterri ; scripts = package.json miroir.
 */
export function jugerFabriqueAvantChantier(opts: {
  nomScript: string;
  scriptsMiroir: Record<string, string> | readonly string[];
  mergeLanded: boolean;
}): { ok: true } | { ok: false; motif: MotifRefusFabrique } {
  if (!nomDeChantierValide(opts.nomScript)) {
    return { ok: false, motif: 'nom_invalide' };
  }
  if (!opts.mergeLanded) return { ok: false, motif: 'pas_encore_merge' };
  if (!nomsScriptsDeclares(opts.scriptsMiroir).has(opts.nomScript)) {
    return { ok: false, motif: 'non_declare' };
  }
  return { ok: true };
}

/**
 * Une fabrique encore ouverte (proposée / en revue) pour CE script bloque le
 * chantier — doctrine lot 8 : pas d'exécution avant merge landé.
 */
export function fabriqueBloqueChantier(
  fabriques: readonly { nomScript: string | null; statut: StatutFabrique }[],
  nomScript: string,
): { ok: true; mergeLanded: boolean } | { ok: false; motif: MotifRefusFabrique } {
  const liees = fabriques.filter((f) => f.nomScript === nomScript);
  if (liees.some((f) => f.statut === 'proposee' || f.statut === 'en_revue')) {
    return { ok: false, motif: 'pas_encore_merge' };
  }
  // Aucune fabrique suivie, ou au moins une mergee → le miroir peut décider.
  const mergeLanded = liees.length === 0 || liees.some((f) => f.statut === 'mergee');
  return { ok: true, mergeLanded };
}

/** Prompt de tâche pour qu'une ouvrière écrive l'artefact dans le dépôt. */
export function promptFabrique(opts: {
  genre: GenreFabrique;
  libelle: string;
  nomScript?: string;
}): string {
  const cible =
    opts.genre === 'script_npm'
      ? `Ajouter le script npm « ${opts.nomScript ?? 'outil'} » dans package.json et son implémentation.`
      : opts.genre === 'mcp'
        ? `Ajouter un pont MCP documenté dans le dépôt (fichiers + README), sans clé secrète.`
        : `Ajouter un pont/script outillage dans le dépôt, déclaré et documenté.`;
  return (
    `Fabrique Hive — ${opts.libelle}\n\n${cible}\n\n` +
    `Règles : pas de secret en clair ; le script doit être déclarable ; ` +
    `Chantiers ne pourra le lancer qu'APRÈS merge sur le dépôt.`
  );
}

export function expliquerRefusFabrique(
  motif: MotifRefusFabrique,
  lang: 'fr' | 'en' = 'fr',
): string {
  const fr: Record<MotifRefusFabrique, string> = {
    vide: 'Fabrique incomplète.',
    genre_inconnu: `Genre inconnu — ${GENRES_FABRIQUE.join(', ')}.`,
    nom_invalide: 'Nom de script invalide.',
    pas_encore_merge: 'Le merge n’a pas encore atterri — pas de chantier avant.',
    non_declare: 'Ce script n’est pas déclaré dans package.json du miroir.',
    projet_inconnu: 'Projet inconnu.',
    inconnue: 'Fabrique introuvable.',
    deja_close: 'Cette fabrique est déjà close.',
  };
  const en: Record<MotifRefusFabrique, string> = {
    vide: 'Incomplete forge request.',
    genre_inconnu: `Unknown kind — ${GENRES_FABRIQUE.join(', ')}.`,
    nom_invalide: 'Invalid script name.',
    pas_encore_merge: 'Merge has not landed yet — no chantier before merge.',
    non_declare: 'That script is not declared in the mirror package.json.',
    projet_inconnu: 'Unknown project.',
    inconnue: 'Forge entry not found.',
    deja_close: 'That forge entry is already closed.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
