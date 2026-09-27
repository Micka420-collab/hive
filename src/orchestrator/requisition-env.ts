// Pose une clé d'API dans le `.env` Queen — jamais en base ni sur le nœud.
//
// Doctrine ADR 0010 : l'humain accorde depuis la Chambre ; le secret reste
// chez l'hôte. Ce module ne fait que lire/écrire le fichier local.

import { existsSync, readFileSync } from 'node:fs';
import { ecrireAtomique } from '../ecriture-atomique.js';
import { lireEnv } from '../installer.js';

/** Un fournisseur proposable depuis la Chambre (catalogue « Ajouter une clé »). */
export interface FournisseurCle {
  readonly id: string;
  readonly libelleFr: string;
  readonly libelleEn: string;
  /** Nom d'env prérempli ; vide = l'humain le choisit (entrée « Autre »). */
  readonly envVar: string;
  readonly hintFr: string;
  readonly hintEn: string;
}

/**
 * Catalogue des clés courantes. OpenRouter alimente Queen Bee ; Anthropic le
 * planner et le chat Reine ; les autres servent aux agents / outils.
 */
export const FOURNISSEURS_CLE: readonly FournisseurCle[] = Object.freeze([
  {
    id: 'openrouter',
    libelleFr: 'OpenRouter',
    libelleEn: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    hintFr: 'Queen Bee / briefs (compatible OpenAI)',
    hintEn: 'Queen Bee / briefs (OpenAI-compatible)',
  },
  {
    id: 'anthropic',
    libelleFr: 'Anthropic',
    libelleEn: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    hintFr: 'Planner IA et chat de la Reine',
    hintEn: 'IA planner and Queen chat',
  },
  {
    // CODEX_API_KEY, et non OPENAI_API_KEY : c'est la seule variable que
    // `codex exec` lit (codex-rs/login). Une clé OpenAI posée sous l'autre nom
    // s'afficherait « présente » et n'authentifierait aucune tâche.
    id: 'openai',
    libelleFr: 'OpenAI (Codex)',
    libelleEn: 'OpenAI (Codex)',
    envVar: 'CODEX_API_KEY',
    hintFr: 'Agent Codex sur les nœuds',
    hintEn: 'Codex agent on nodes',
  },
  {
    id: 'xai',
    libelleFr: 'xAI (Grok)',
    libelleEn: 'xAI (Grok)',
    envVar: 'XAI_API_KEY',
    hintFr: 'Agent Grok Build',
    hintEn: 'Grok Build agent',
  },
  {
    id: 'cursor',
    libelleFr: 'Cursor',
    libelleEn: 'Cursor',
    envVar: 'CURSOR_API_KEY',
    hintFr: 'CLI Cursor (agent -p)',
    hintEn: 'Cursor CLI (agent -p)',
  },
  {
    id: 'seedance',
    libelleFr: 'Seedance',
    libelleEn: 'Seedance',
    envVar: 'SEEDANCE_API_KEY',
    hintFr: 'Génération vidéo',
    hintEn: 'Video generation',
  },
  {
    id: 'custom',
    libelleFr: 'Autre (personnalisé)',
    libelleEn: 'Other (custom)',
    envVar: '',
    hintFr: 'Vous choisissez le nom de variable (ex. GROQ_API_KEY)',
    hintEn: 'You choose the variable name (e.g. GROQ_API_KEY)',
  },
]);

export const SECRET_REQUISITION_MAX = 512;

export type MotifRefusSecret = 'vide' | 'trop_long' | 'forme';

export function estNomEnvValide(nom: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(nom);
}

/**
 * Variables que la Chambre n'a PAS le droit d'écraser via grant / catalogue.
 * `estNomEnvValide` les accepte (forme OK) ; c'est ici qu'on refuse la portée.
 */
export function estEnvQueenAutorisee(nom: string): boolean {
  if (!estNomEnvValide(nom)) return false;
  // Tout le préfixe HIVE_ : jetons, JWT, webhooks, invites…
  if (nom.startsWith('HIVE_')) return false;
  if (nom === 'GITHUB_TOKEN' || nom === 'STRIPE_SECRET_KEY') return false;
  return true;
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
 * Quelles variables du catalogue (hors « custom ») sont déjà posées — jamais
 * la valeur, seulement la présence (fichier `.env` ∪ process.env).
 */
export function presenceClesCatalogue(
  cheminEnv: string,
  env: NodeJS.ProcessEnv = process.env,
): Array<{ id: string; envVar: string; presente: boolean }> {
  const fichier = existsSync(cheminEnv) ? lireEnv(readFileSync(cheminEnv, 'utf8')) : new Map();
  return FOURNISSEURS_CLE.filter((f) => f.envVar !== '').map((f) => {
    const dansFichier = (fichier.get(f.envVar) ?? '').trim() !== '';
    const dansProcess = (env[f.envVar] ?? '').trim() !== '';
    return { id: f.id, envVar: f.envVar, presente: dansFichier || dansProcess };
  });
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
