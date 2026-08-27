// Hive Cloud — locataires, chemins, et pont Stripe.
//
// Une Queen cloud n'est pas une ruche d'amis avec un drapeau. C'est :
//   · un locataire = une base, isolée des autres (pas de `tenant_id` partout) ;
//   · un slug borné, qui ne peut pas sortir du dossier des locataires ;
//   · les événements Stripe, traduits vers le modèle d'abonnement DÉJÀ testé.
//
// MODULE PUR. Aucune I/O, aucun réseau. `path` n'est utilisé que pour JOINDRE
// des segments déjà jugés — jamais pour lire le disque.

import path from 'node:path';
import type { EvenementAbonnement, TypeEvenement } from './abonnement.js';
import { EVENEMENTS, planParCle } from './abonnement.js';

/** Longueur max d'un slug de locataire — assez pour `acme-atelier`, pas un essai. */
export const SLUG_MAX = 32;

const SLUG = /^[a-z][a-z0-9-]{0,31}$/;

export interface VerdictSlug {
  ok: boolean;
  motif: string;
}

/**
 * Un slug de locataire. Minuscules, chiffres, tirets. Pas de `..`, pas de
 * tiret en tête ni en queue, pas de `--` : ce n'est pas de la cosmétique,
 * c'est ce qui empêche un slug d'être un chemin.
 */
export function jugerSlug(brut: string): VerdictSlug {
  const s = brut.trim();
  if (s.length === 0) return { ok: false, motif: 'slug vide' };
  if (s.length > SLUG_MAX)
    return { ok: false, motif: `slug trop long (${s.length} > ${SLUG_MAX})` };
  if (s.includes('..') || s.includes('/') || s.includes('\\')) {
    return { ok: false, motif: 'slug qui ressemble à un chemin' };
  }
  if (s.startsWith('-') || s.endsWith('-')) return { ok: false, motif: 'tiret en bordure' };
  if (s.includes('--')) return { ok: false, motif: 'tirets doubles' };
  if (!SLUG.test(s)) return { ok: false, motif: 'caractères hors [a-z0-9-], ou chiffre en tête' };
  return { ok: true, motif: 'slug recevable' };
}

/**
 * Chemin de la base d'un locataire. `null` si le slug est refusé — l'appelant
 * ne doit alors RIEN créer. Le chemin est TOUJOURS sous `racine/tenants/<slug>/`.
 */
export function cheminBaseLocataire(racine: string, slug: string): string | null {
  if (!jugerSlug(slug).ok) return null;
  const base = path.resolve(racine);
  const cible = path.resolve(base, 'tenants', slug, 'hive.db');
  const prefixe = base.endsWith(path.sep) ? base : base + path.sep;
  if (cible !== base && !cible.startsWith(prefixe)) return null;
  return cible;
}

// ─── Stripe → événements Hive ────────────────────────────────────────────────

/**
 * Types Stripe retenus, et RIEN d'autre. Un processeur émet des dizaines de
 * types ; en accepter un qu'on n'a pas lu, c'est laisser un inconnu décider
 * d'un état.
 */
export const STRIPE_VERS_HIVE = {
  'customer.subscription.created': 'abonnement.actif',
  'customer.subscription.updated': 'abonnement.actif',
  'invoice.paid': 'abonnement.paiement_reussi',
  'invoice.payment_failed': 'abonnement.paiement_echoue',
  'customer.subscription.deleted': 'abonnement.annule',
} as const satisfies Record<string, TypeEvenement>;

export type TypeStripe = keyof typeof STRIPE_VERS_HIVE;

function estTypeStripe(s: string): s is TypeStripe {
  return Object.prototype.hasOwnProperty.call(STRIPE_VERS_HIVE, s);
}

function objetStripe(brut: unknown): Record<string, unknown> | null {
  // loupe : équivalent — || → &&. INATTEIGNABLE : `objetStripe` n'a qu'un
  // appelant (`evenementDepuisStripe`), et il l'appelle APRÈS sa propre garde
  // qui a déjà écarté `null` et les non-objets. `brut` est ici toujours un
  // objet non nul : les deux formes rendent `false`.
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;
  const data = o.data;
  if (typeof data !== 'object' || data === null) return null;
  const obj = (data as Record<string, unknown>).object;
  // loupe : équivalent — || → &&, mais par une preuve qui descend en aval.
  // Mué, un `obj` non-objet est RENDU au lieu d'être refusé. Or `meta()` lit
  // `.metadata` dessus sans lever (une primitive rend `undefined`), et le
  // `if (!projectId …)` qui suit rend `null` de toute façon. Un `obj` valant
  // `null` est rendu tel quel, et le `if (!obj)` de l'appelant l'arrête.
  // Tous les chemins mènent au même `null`.
  if (typeof obj !== 'object' || obj === null) return null;
  return obj as Record<string, unknown>;
}

function meta(obj: Record<string, unknown>): Record<string, unknown> {
  const m = obj.metadata;
  return typeof m === 'object' && m !== null ? (m as Record<string, unknown>) : {};
}

/**
 * Traduit une charge Stripe déjà AUTHENTIFIÉE en événement Hive.
 *
 * `null` si ce n'est pas un événement qu'on a lu, ou s'il manque le
 * `metadata.projectId` / `metadata.plan` — sans eux on ne sait pas QUEL
 * projet créditer, et inventer serait offrir un abonnement au premier
 * projet venu.
 *
 * `created` Stripe est en SECONDES. On le convertit ici, une fois, pour que
 * le reste de Hive continue de parler en millisecondes.
 */
export function evenementDepuisStripe(brut: unknown): EvenementAbonnement | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== 'string' || !estTypeStripe(type)) return null;

  const obj = objetStripe(brut);
  if (!obj) return null;
  const m = meta(obj);

  const projectId = typeof m.projectId === 'string' ? m.projectId.slice(0, 200) : '';
  const plan = typeof m.plan === 'string' ? m.plan.slice(0, 60) : '';
  if (!projectId || !plan || !planParCle(plan)) return null;

  const refExterne = typeof obj.id === 'string' ? obj.id.slice(0, 200) : '';

  const finSec = obj.current_period_end;
  const finPeriode =
    typeof finSec === 'number' && Number.isFinite(finSec) && finSec > 0
      ? Math.trunc(finSec) * 1000
      : null;

  const created = o.created;
  const ts =
    typeof created === 'number' && Number.isFinite(created) && created > 0
      ? Math.trunc(created) * 1000
      : 0;
  if (ts <= 0) return null;

  const hiveType: TypeEvenement = STRIPE_VERS_HIVE[type];
  if (!EVENEMENTS.includes(hiveType)) return null;

  return { type: hiveType, projectId, plan, refExterne, finPeriode, ts };
}
