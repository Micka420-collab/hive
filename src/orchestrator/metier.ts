// Métier de cycle — ce que l'ouvrière FAIT dans ce cycle, pas ce qu'elle EST.
//
// Orthogonal à la caste (`polyethisme.ts`) : la caste se GAGNE sur la qualité
// observée ; le métier est ASSIGNÉ par la Reine / l'essaim pour un cycle de
// travail (planifie, édite, relit…). Un nœud ne déclare NI l'un NI l'autre
// (ADR 0010).
//
// MODULE PUR — aucune I/O. Le store persiste ; ce fichier juge.

/** Version de la règle de métier. */
export const VERSION_METIER = 1;

/**
 * Les métiers de cycle. Liste FERMÉE : un métier inventé par un agent n'entre
 * pas. « filme / sculpte / outille » couvrent cinématique, 3D, et fabrique
 * d'outil — sans ouvrir un dictionnaire libre.
 */
export const METIERS = [
  'planifie',
  'edite',
  'relit',
  'teste',
  'filme',
  'sculpte',
  'outille',
] as const;

export type MetierCycle = (typeof METIERS)[number];

export type MotifRefusMetier = 'vide' | 'inconnu' | 'noeud_inconnu';

export type VerdictMetier =
  { ok: true; metier: MetierCycle } | { ok: false; motif: MotifRefusMetier };

const ENSEMBLE = new Set<string>(METIERS);

/** Type guard — forme seule, sans effet de bord. */
export function estMetier(brut: string): brut is MetierCycle {
  return ENSEMBLE.has(brut);
}

/**
 * Valide un métier de cycle. Pas de normalisation créative : la Reine envoie
 * exactement un des littéraux, sinon refus.
 */
export function validerMetier(brut: string): VerdictMetier {
  if (typeof brut !== 'string' || brut.trim().length === 0) {
    return { ok: false, motif: 'vide' };
  }
  const cle = brut.trim().toLowerCase();
  if (!estMetier(cle)) return { ok: false, motif: 'inconnu' };
  return { ok: true, metier: cle };
}

/** Libellé FR/EN pour l'écran — jamais inventé hors liste. */
export function libelleMetier(metier: MetierCycle, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MetierCycle, string> = {
    planifie: 'Planifie',
    edite: 'Édite',
    relit: 'Relit',
    teste: 'Teste',
    filme: 'Filme',
    sculpte: 'Sculpte',
    outille: 'Outille',
  };
  const en: Record<MetierCycle, string> = {
    planifie: 'Plans',
    edite: 'Edits',
    relit: 'Reviews',
    teste: 'Tests',
    filme: 'Films',
    sculpte: 'Sculpts',
    outille: 'Toolsmiths',
  };
  return (lang === 'en' ? en : fr)[metier];
}

export function expliquerRefusMetier(motif: MotifRefusMetier, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifRefusMetier, string> = {
    vide: 'Aucun métier de cycle n’a été donné.',
    inconnu: `Métier inconnu — choisissez parmi : ${METIERS.join(', ')}.`,
    noeud_inconnu: 'Aucune ouvrière ne porte cet identifiant.',
  };
  const en: Record<MotifRefusMetier, string> = {
    vide: 'No cycle role was given.',
    inconnu: `Unknown role — pick one of: ${METIERS.join(', ')}.`,
    noeud_inconnu: 'No worker has that id.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
