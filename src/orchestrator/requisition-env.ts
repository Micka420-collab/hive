// Pose une clé d'API dans le `.env` Queen — jamais en base ni sur le nœud.
//
// Doctrine ADR 0010 : l'humain accorde depuis la Chambre ; le secret reste
// chez l'hôte. Ce module ne fait que lire/écrire le fichier local.

import { existsSync, readFileSync } from 'node:fs';
import { ecrireAtomique } from '../ecriture-atomique.js';
import { lireEnv } from '../installer.js';

/** Catalogue optionnel pour libellés ambigus (clé normalisée minuscule). */
const CATALOGUE_ENV: Record<string, string> = {
  'clé seedance': 'SEEDANCE_API_KEY',
  'cle seedance': 'SEEDANCE_API_KEY',
  seedance: 'SEEDANCE_API_KEY',
  'clé openai': 'OPENAI_API_KEY',
  'cle openai': 'OPENAI_API_KEY',
  'clé openai (codex)': 'OPENAI_API_KEY',
  'cle openai (codex)': 'OPENAI_API_KEY',
  'clé ou session anthropic (claude code)': 'ANTHROPIC_API_KEY',
  'cle ou session anthropic (claude code)': 'ANTHROPIC_API_KEY',
  'clé anthropic': 'ANTHROPIC_API_KEY',
  'cle anthropic': 'ANTHROPIC_API_KEY',
  'clé xai': 'XAI_API_KEY',
  'cle xai': 'XAI_API_KEY',
  'clé xai ou session grok': 'XAI_API_KEY',
  'cle xai ou session grok': 'XAI_API_KEY',
};

/** Indices dans le libellé (après normalisation) → variable d’environnement. */
const INDICES_ENV: Array<{ re: RegExp; nom: string }> = [
  { re: /seedance/, nom: 'SEEDANCE_API_KEY' },
  { re: /openai|codex/, nom: 'OPENAI_API_KEY' },
  { re: /anthropic|claude/, nom: 'ANTHROPIC_API_KEY' },
  { re: /\bxai\b|grok/, nom: 'XAI_API_KEY' },
];

export const SECRET_REQUISITION_MAX = 512;

export type MotifRefusSecret = 'vide' | 'trop_long' | 'forme';

export function nomEnvDepuisLibelle(libelle: string): string {
  const norm = libelle.trim().toLowerCase();
  if (CATALOGUE_ENV[norm]) return CATALOGUE_ENV[norm];
  for (const { re, nom } of INDICES_ENV) {
    if (re.test(norm)) return nom;
  }
  const slug = libelle
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^(clé|cle|key)\s+/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
  if (!slug) return 'API_KEY';
  if (slug.endsWith('_KEY') || slug.endsWith('_API_KEY')) return slug;
  return `${slug}_API_KEY`;
}

export function estNomEnvValide(nom: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(nom);
}

export function validerSecretRequisition(
  brut: unknown,
): { ok: true; secret: string } | { ok: false; motif: MotifRefusSecret } {
  if (typeof brut !== 'string') return { ok: false, motif: 'vide' };
  const secret = brut.trim();
  if (secret.length === 0) return { ok: false, motif: 'vide' };
  if (secret.length > SECRET_REQUISITION_MAX) return { ok: false, motif: 'trop_long' };
  if (/\s/.test(secret)) return { ok: false, motif: 'forme' };
  return { ok: true, secret };
}

/**
 * Met à jour ou ajoute une clé dans le `.env` Queen (écriture atomique 0600).
 * Ne logue jamais la valeur.
 */
export function poserCleQueenEnv(
  cheminEnv: string,
  nom: string,
  valeur: string,
  commentaire: string,
): void {
  if (!estNomEnvValide(nom)) {
    throw new Error('nom de variable invalide');
  }
  const contenu = existsSync(cheminEnv) ? readFileSync(cheminEnv, 'utf8') : '';
  const present = lireEnv(contenu);
  if (present.has(nom)) {
    const lignes: string[] = [];
    let remplace = false;
    for (const brut of contenu.split('\n')) {
      const ligne = brut.trim().replace(/^export\s+/, '');
      if (ligne.startsWith('#') || ligne === '') {
        lignes.push(brut);
        continue;
      }
      const sep = ligne.indexOf('=');
      if (sep <= 0) {
        lignes.push(brut);
        continue;
      }
      const cle = ligne.slice(0, sep).trim();
      if (cle === nom) {
        lignes.push(`${nom}=${valeur}`);
        remplace = true;
      } else {
        lignes.push(brut);
      }
    }
    if (!remplace) {
      if (lignes.length && lignes[lignes.length - 1] !== '') lignes.push('');
      lignes.push(`# ${commentaire}`);
      lignes.push(`${nom}=${valeur}`);
    }
    ecrireAtomique(cheminEnv, `${lignes.join('\n').replace(/\n*$/, '')}\n`, 0o600);
    return;
  }
  const ajout =
    contenu.trim() === ''
      ? `# ${commentaire}\n${nom}=${valeur}\n`
      : `${contenu.replace(/\n*$/, '')}\n\n# ${commentaire}\n${nom}=${valeur}\n`;
  ecrireAtomique(cheminEnv, ajout, 0o600);
}

export function expliquerRefusSecret(motif: MotifRefusSecret, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifRefusSecret, string> = {
    vide: 'La clé est obligatoire pour accorder une réquisition API.',
    trop_long: `La clé dépasse ${SECRET_REQUISITION_MAX} caractères.`,
    forme: 'La clé ne doit pas contenir d’espaces.',
  };
  const en: Record<MotifRefusSecret, string> = {
    vide: 'An API key is required to grant this requisition.',
    trop_long: `The key exceeds ${SECRET_REQUISITION_MAX} characters.`,
    forme: 'The key must not contain spaces.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
