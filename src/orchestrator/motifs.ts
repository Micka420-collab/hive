// Motifs inter-projets — procédures ordonnées, PAS le diff d'un autre dépôt.
//
// Doctrine (ADR 0010 lot 10) : « jeu-3d : blender/fabrique AVANT les assets ».
// On crée des titres de tâches / une checklist — jamais on ne colle un diff
// privé d'un projet dans un autre.
//
// MODULE PUR — catalogue figé + application → titres.

export const VERSION_MOTIFS = 1;

export interface MotifEtape {
  /** Identifiant stable d'étape (ex. fabrique, assets). */
  id: string;
  /** Titre de tâche suggéré (FR). */
  titreFr: string;
  /** Titre de tâche suggéré (EN). */
  titreEn: string;
}

export interface MotifInterProjet {
  id: string;
  domaine: string;
  libelleFr: string;
  libelleEn: string;
  etapes: readonly MotifEtape[];
  /**
   * Paires [avant, après] : l'étape `avant` doit précéder `après` dans
   * `etapes`. L'invariant vit ICI, pas dans des `if (m.id === …)` inatteignables.
   */
  ordre: readonly (readonly [string, string])[];
}

export type MotifRefusMotif = 'inconnu' | 'diff_interdit' | 'projet_inconnu' | 'vide' | 'catalogue';

/**
 * Catalogue figé. Étendre = PR + tests — pas un dictionnaire libre agent.
 */
export const MOTIFS: readonly MotifInterProjet[] = Object.freeze([
  Object.freeze({
    id: 'jeu-3d',
    domaine: 'jeu-3d',
    libelleFr: 'Jeu 3D — fabrique outillage avant assets',
    libelleEn: '3D game — forge tooling before assets',
    etapes: Object.freeze([
      Object.freeze({
        id: 'fabrique',
        titreFr: 'Fabriquer / déclarer Blender (ou pont 3D) dans le dépôt avant les assets',
        titreEn: 'Forge / declare Blender (or 3D bridge) in the repo before assets',
      }),
      Object.freeze({
        id: 'pipeline',
        titreFr: 'Brancher le pipeline d’import (avant les gros assets)',
        titreEn: 'Wire the import pipeline (before large assets)',
      }),
      Object.freeze({
        id: 'assets',
        titreFr: 'Ajouter les assets 3D une fois l’outillage merge',
        titreEn: 'Add 3D assets once tooling is merged',
      }),
    ]),
    ordre: Object.freeze([Object.freeze(['fabrique', 'assets'] as const)]),
  }),
  Object.freeze({
    id: 'saas-api',
    domaine: 'saas',
    libelleFr: 'SaaS — contrat API avant UI',
    libelleEn: 'SaaS — API contract before UI',
    etapes: Object.freeze([
      Object.freeze({
        id: 'contrat',
        titreFr: 'Figer le contrat API (schémas, erreurs)',
        titreEn: 'Freeze the API contract (schemas, errors)',
      }),
      Object.freeze({
        id: 'backend',
        titreFr: 'Implémenter les routes derrière le contrat',
        titreEn: 'Implement routes behind the contract',
      }),
      Object.freeze({
        id: 'ui',
        titreFr: 'Brancher l’UI sur le contrat stable',
        titreEn: 'Wire the UI to the stable contract',
      }),
    ]),
    ordre: Object.freeze([
      Object.freeze(['contrat', 'backend'] as const),
      Object.freeze(['backend', 'ui'] as const),
    ]),
  }),
  Object.freeze({
    id: 'cli-outil',
    domaine: 'outillage',
    libelleFr: 'CLI — fabrique / script déclaré avant packaging',
    libelleEn: 'CLI — forge / declared script before packaging',
    etapes: Object.freeze([
      Object.freeze({
        id: 'fabrique',
        titreFr: 'Déclarer le script CLI dans le dépôt (fabrique) avant packaging',
        titreEn: 'Declare the CLI script in the repo (forge) before packaging',
      }),
      Object.freeze({
        id: 'tests',
        titreFr: 'Couvrir le CLI par des tests une fois le script déclaré',
        titreEn: 'Cover the CLI with tests once the script is declared',
      }),
      Object.freeze({
        id: 'packaging',
        titreFr: 'Packager / publier seulement après merge de la fabrique',
        titreEn: 'Package / publish only after the forge merge',
      }),
    ]),
    ordre: Object.freeze([Object.freeze(['fabrique', 'packaging'] as const)]),
  }),
]);

/**
 * Vérifie que chaque paire `ordre` est respectée dans `etapes`.
 * Rendu : liste de fautes (vide = catalogue cohérent). Un banc unique :
 * `expect(catalogueCoherent()).toEqual([])`.
 */
export function catalogueCoherent(motifs: readonly MotifInterProjet[] = MOTIFS): string[] {
  const fautes: string[] = [];
  for (const m of motifs) {
    for (const [avant, apres] of m.ordre) {
      const i = m.etapes.findIndex((e) => e.id === avant);
      const j = m.etapes.findIndex((e) => e.id === apres);
      if (i < 0 || j < 0 || i >= j) {
        fautes.push(`${m.id}: ${avant} doit précéder ${apres}`);
      }
    }
  }
  return fautes;
}

export function motifParId(id: string): MotifInterProjet | null {
  return MOTIFS.find((m) => m.id === id) ?? null;
}

/**
 * Refuse un corps qui ressemble à un diff collé (champ libre de
 * `appliquerMotif`). Les étapes perso, elles, sont des titres : une ligne
 * (`validerMotifPerso`) — pas besoin de renifleur là.
 */
export function refuserDiffColle(
  brut: unknown,
): { ok: true } | { ok: false; motif: 'diff_interdit' } {
  if (typeof brut !== 'string') return { ok: true };
  const t = brut.trim();
  if (!t) return { ok: true };
  if (/^diff --git /m.test(t)) return { ok: false, motif: 'diff_interdit' };
  if (/^\+\+\+ b\//m.test(t) && /^--- a\//m.test(t)) return { ok: false, motif: 'diff_interdit' };
  if (/^@@ -\d+/m.test(t) && t.split('\n').length > 8) {
    return { ok: false, motif: 'diff_interdit' };
  }
  return { ok: true };
}

/**
 * Applique un motif → titres de tâches ORDONNÉS (pas de fichiers, pas de diff).
 */
export function appliquerMotif(
  motifId: string,
  lang: 'fr' | 'en' = 'fr',
  corpsInterdit?: string,
): { ok: true; motif: MotifInterProjet; titres: string[] } | { ok: false; motif: MotifRefusMotif } {
  if (corpsInterdit !== undefined) {
    const r = refuserDiffColle(corpsInterdit);
    if (!r.ok) return r;
  }
  const m = motifParId(motifId);
  if (!m) return { ok: false, motif: 'inconnu' };
  // Catalogue corrompu ≠ motif inconnu : on le dit franchement.
  const fautes = catalogueCoherent([m]);
  if (fautes.length > 0) return { ok: false, motif: 'catalogue' };
  const titres = m.etapes.map((e) => (lang === 'en' ? e.titreEn : e.titreFr));
  return { ok: true, motif: m, titres };
}

export function expliquerRefusMotif(motif: MotifRefusMotif, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifRefusMotif, string> = {
    inconnu: 'Motif inconnu.',
    catalogue: 'Catalogue de motifs incohérent — l’ordre déclaré n’est pas respecté.',
    diff_interdit:
      'Coller le diff d’un autre dépôt est interdit — un motif est une procédure, pas du code.',
    projet_inconnu: 'Projet inconnu.',
    vide: 'Demande vide.',
  };
  const en: Record<MotifRefusMotif, string> = {
    inconnu: 'Unknown motif.',
    catalogue: 'Motif catalogue is inconsistent — declared order is not respected.',
    diff_interdit: 'Pasting another repo’s diff is forbidden — a motif is a procedure, not code.',
    projet_inconnu: 'Unknown project.',
    vide: 'Empty request.',
  };
  return (lang === 'en' ? en : fr)[motif];
}

/** Procédures perso créées depuis la Chambre — bornées, pas de diff. */
export const MOTIF_PERSO_ETAPES_MAX = 8;
export const MOTIF_PERSO_LIBELLE_MAX = 120;
export const MOTIF_PERSO_TITRE_MAX = 200;

export type MotifPersoRefus = 'vide' | 'trop_long' | 'trop_etapes' | 'etape_vide' | 'multi_ligne';

export function validerMotifPerso(
  libelleBrut: string,
  etapesBrutes: unknown,
): { ok: true; libelle: string; etapes: string[] } | { ok: false; motif: MotifPersoRefus } {
  if (typeof libelleBrut !== 'string') return { ok: false, motif: 'vide' };
  const libelle = libelleBrut.replace(/\s+/g, ' ').trim();
  if (!libelle) return { ok: false, motif: 'vide' };
  if (libelle.length > MOTIF_PERSO_LIBELLE_MAX) return { ok: false, motif: 'trop_long' };
  if (!Array.isArray(etapesBrutes) || etapesBrutes.length === 0) {
    return { ok: false, motif: 'vide' };
  }
  if (etapesBrutes.length > MOTIF_PERSO_ETAPES_MAX) return { ok: false, motif: 'trop_etapes' };
  const etapes: string[] = [];
  for (const e of etapesBrutes) {
    if (typeof e !== 'string') return { ok: false, motif: 'etape_vide' };
    // Une étape est un TITRE : une seule ligne. Un diff (ou tout multi-ligne)
    // ne peut structurellement plus entrer — plus besoin de renifleur de patch.
    if (/[\r\n]/.test(e)) return { ok: false, motif: 'multi_ligne' };
    const t = e.trim();
    if (!t) return { ok: false, motif: 'etape_vide' };
    if (t.length > MOTIF_PERSO_TITRE_MAX) return { ok: false, motif: 'trop_long' };
    etapes.push(t);
  }
  return { ok: true, libelle, etapes };
}

export function expliquerRefusMotifPerso(motif: MotifPersoRefus, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifPersoRefus, string> = {
    vide: 'Libellé et au moins une étape sont requis.',
    trop_long: 'Libellé ou étape trop long.',
    trop_etapes: `Au plus ${MOTIF_PERSO_ETAPES_MAX} étapes.`,
    etape_vide: 'Chaque étape doit être non vide.',
    multi_ligne: 'Chaque étape est un titre sur une seule ligne — pas un diff.',
  };
  const en: Record<MotifPersoRefus, string> = {
    vide: 'Label and at least one step are required.',
    trop_long: 'Label or step too long.',
    trop_etapes: `At most ${MOTIF_PERSO_ETAPES_MAX} steps.`,
    etape_vide: 'Each step must be non-empty.',
    multi_ligne: 'Each step is a single-line title — not a diff.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
