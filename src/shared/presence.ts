// Présence Rayon — un fichier ouvert constaté (Read / Edit / Write), jamais inventé.
//
// Doctrine (ADR 0010) : la Chambre montre QUI lit/édite QUEL chemin seulement
// si un outil l'a réellement appelé. Pas de « fichier ouvert » décoratif.
//
// MODULE PUR — aucune I/O. Le parser (adapters) et le store (orchestrateur)
// consomment ces jugements.

/** Version de la règle de présence. */
export const VERSION_PRESENCE = 1;

/** Plafond d'un chemin observé (caractères). Aligné sur l'esprit du Rayon. */
export const CHEMIN_PRESENCE_MAX = 500;

/** Nombre max de fichiers ouverts suivis par nœud (snapshot protocole). */
export const PRESENCES_MAX = 16;

/**
 * Outils qui constituent une présence fichier. Liste FERMÉE.
 * StrReplace / MultiEdit / NotebookEdit → Edit (même intention).
 */
export const OUTILS_PRESENCE = ['Read', 'Edit', 'Write'] as const;

export type OutilPresence = (typeof OUTILS_PRESENCE)[number];

export type MotifRefusPresence =
  'vide' | 'trop_long' | 'octet_nul' | 'traversee' | 'outil_inconnu' | 'noeud_inconnu';

export type VerdictCheminPresence =
  { ok: true; chemin: string } | { ok: false; motif: MotifRefusPresence };

export type VerdictOutilPresence =
  { ok: true; outil: OutilPresence } | { ok: false; motif: MotifRefusPresence };

/** Une présence ouverte — snapshot (comme SubAgent). */
export interface PresenceFichier {
  toolUseId: string;
  chemin: string;
  outil: OutilPresence;
}

const OUTIL_PAR_NOM: Record<string, OutilPresence> = {
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  strreplace: 'Edit',
  multiedit: 'Edit',
  notebookedit: 'Edit',
};

/**
 * Mappe un nom d'outil Claude (ou équivalent) vers un outil de présence.
 * Inconnu → null (ignoré — pas de théâtre).
 */
export function outilPresenceDe(nom: string): OutilPresence | null {
  if (typeof nom !== 'string') return null;
  return OUTIL_PAR_NOM[nom.trim().toLowerCase()] ?? null;
}

export function validerOutilPresence(brut: string): VerdictOutilPresence {
  const o = outilPresenceDe(brut);
  if (!o) return { ok: false, motif: 'outil_inconnu' };
  return { ok: true, outil: o };
}

/**
 * Normalise un chemin observé pour affichage / persistance.
 * Accepte relatif OU absolu (Claude envoie souvent l'absolu) — refuse
 * traversal et octet nul. Ne sert PAS le fichier (contrairement au Rayon).
 */
export function jugerCheminPresence(brut: unknown): VerdictCheminPresence {
  if (typeof brut !== 'string') return { ok: false, motif: 'vide' };
  const raw = brut.trim();
  if (raw.length === 0) return { ok: false, motif: 'vide' };
  if (raw.length > CHEMIN_PRESENCE_MAX) return { ok: false, motif: 'trop_long' };
  if (raw.includes('\0')) return { ok: false, motif: 'octet_nul' };

  const normalise = raw.replace(/\\/g, '/');
  const segments = normalise.split('/');
  if (segments.some((s) => s === '..')) return { ok: false, motif: 'traversee' };

  // Replie les `.` ; conserve le premier segment vide d'un absolu POSIX (`/a/b`).
  const parts: string[] = [];
  for (const s of segments) {
    if (s === '.') continue;
    parts.push(s);
  }
  const chemin = parts.join('/');
  if (!chemin || chemin === '/') return { ok: false, motif: 'vide' };
  if (chemin.length > CHEMIN_PRESENCE_MAX) return { ok: false, motif: 'trop_long' };
  return { ok: true, chemin };
}

/**
 * Extrait un chemin depuis l'input d'outil (file_path | path | target_file).
 */
export function cheminDepuisInput(input: unknown): VerdictCheminPresence {
  if (typeof input !== 'object' || input === null) return { ok: false, motif: 'vide' };
  const o = input as Record<string, unknown>;
  const candidat = o.file_path ?? o.path ?? o.target_file ?? o.targetFile;
  return jugerCheminPresence(candidat);
}

export function expliquerRefusPresence(
  motif: MotifRefusPresence,
  lang: 'fr' | 'en' = 'fr',
): string {
  const fr: Record<MotifRefusPresence, string> = {
    vide: 'Aucun chemin de fichier n’a été observé.',
    trop_long: `Le chemin dépasse ${CHEMIN_PRESENCE_MAX} caractères.`,
    octet_nul: 'Le chemin contient un octet nul — refusé.',
    traversee: 'Le chemin tente une traversée (`..`) — refusé.',
    outil_inconnu: 'Cet outil ne constitue pas une présence fichier.',
    noeud_inconnu: 'Aucune ouvrière ne porte cet identifiant.',
  };
  const en: Record<MotifRefusPresence, string> = {
    vide: 'No file path was observed.',
    trop_long: `The path exceeds ${CHEMIN_PRESENCE_MAX} characters.`,
    octet_nul: 'The path contains a null byte — refused.',
    traversee: 'The path attempts traversal (`..`) — refused.',
    outil_inconnu: 'That tool does not count as file presence.',
    noeud_inconnu: 'No worker has that id.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
