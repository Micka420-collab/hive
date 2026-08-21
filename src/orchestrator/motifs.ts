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
}

export type MotifRefusMotif = 'inconnu' | 'diff_interdit' | 'projet_inconnu' | 'vide';

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
        titreFr: 'Fabriquer / déclarer l’outillage 3D (script, pont) dans le dépôt',
        titreEn: 'Forge / declare 3D tooling (script, bridge) in the repo',
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
  }),
]);

export function motifParId(id: string): MotifInterProjet | null {
  return MOTIFS.find((m) => m.id === id) ?? null;
}

/**
 * Refuse explicitement un corps qui ressemble à un diff collé d'ailleurs.
 */
export function refuserDiffColle(
  brut: unknown,
): { ok: true } | { ok: false; motif: 'diff_interdit' } {
  if (typeof brut !== 'string') return { ok: true };
  const t = brut.trim();
  if (!t) return { ok: true };
  // Indices forts d'un patch git collé — on refuse, motifs = procédures only.
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
  const titres = m.etapes.map((e) => (lang === 'en' ? e.titreEn : e.titreFr));
  // Invariant : fabrique/outillage avant assets pour jeu-3d
  if (m.id === 'jeu-3d') {
    const iFab = m.etapes.findIndex((e) => e.id === 'fabrique');
    const iAssets = m.etapes.findIndex((e) => e.id === 'assets');
    if (iFab < 0 || iAssets < 0 || iFab >= iAssets) {
      // Catalogue corrompu — silence plutôt que mauvais ordre
      return { ok: false, motif: 'inconnu' };
    }
  }
  return { ok: true, motif: m, titres };
}

export function expliquerRefusMotif(motif: MotifRefusMotif, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifRefusMotif, string> = {
    inconnu: 'Motif inconnu.',
    diff_interdit:
      'Coller le diff d’un autre dépôt est interdit — un motif est une procédure, pas du code.',
    projet_inconnu: 'Projet inconnu.',
    vide: 'Demande vide.',
  };
  const en: Record<MotifRefusMotif, string> = {
    inconnu: 'Unknown motif.',
    diff_interdit: 'Pasting another repo’s diff is forbidden — a motif is a procedure, not code.',
    projet_inconnu: 'Unknown project.',
    vide: 'Empty request.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
