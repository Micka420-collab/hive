// Les préférences de Hive Studio — rangées dans CE navigateur, jamais ailleurs.
//
// ─── CE QUI VIT ICI, ET POURQUOI PAS AU SERVEUR ──────────────────────────────
//
// Thème, bannière, colonne repliée, projet actif, favoris, guide ignoré : des
// choix d'AFFICHAGE, propres à un écran. Les ranger au serveur les ferait
// suivre une personne sur une machine qu'elle prête — et le tableau de bord
// s'utilise sans compte. Le guide « ignoré » est la seule préférence que la
// spec voulait aussi « dans le compte, si applicable » : aucune route ne porte
// de préférence d'affichage aujourd'hui, et en inventer une pour un booléen
// serait un changement d'API pour rien. C'est dit, pas caché.
//
// ─── UNE VALEUR ILLISIBLE N'EST JAMAIS CRUE ──────────────────────────────────
//
// `localStorage` se modifie à la main, par une autre version, par une
// extension. Chaque lecture passe par un `lire*` qui rend le DÉFAUT sur toute
// valeur qu'il ne reconnaît pas — un thème inconnu ne doit pas laisser l'écran
// sans thème, un favori qui n'est pas une chaîne ne doit pas casser la barre.

import { useSyncExternalStore } from 'react';

export type ThemeChoisi = 'sombre' | 'clair' | 'auto';
export type ThemeApplique = 'sombre' | 'clair';
export type EtatGuide = 'nouveau' | 'ignore' | 'termine';

export const CLES = {
  theme: 'hive.theme',
  banniere: 'hive.studio.banniere',
  colonne: 'hive.studio.colonne',
  rail: 'hive.studio.rail',
  guide: 'hive.studio.guide',
  projet: 'hive.studio.projet',
  favoris: 'hive.studio.favoris',
  partage: 'hive.studio.partage',
  onglet: 'hive.studio.onglet',
  briefs: 'hive.studio.briefs',
} as const;

type Cle = (typeof CLES)[keyof typeof CLES];

/** Lecture brute, sans jamais lever : un stockage refusé (mode privé) vaut « absent ». */
function brut(cle: Cle): string | null {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}

const abonnes = new Set<() => void>();

/** Écriture + annonce aux composants abonnés. `null` efface. */
export function ecrire(cle: Cle, valeur: string | null): void {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, valeur);
  } catch {
    // Stockage plein ou refusé : la préférence vit le temps de l'onglet.
  }
  for (const f of abonnes) f();
}

function abonner(f: () => void): () => void {
  abonnes.add(f);
  // Un AUTRE onglet a changé une préférence : on relit, comme pour le JWT.
  const surStockage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith('hive.')) f();
  };
  window.addEventListener('storage', surStockage);
  return () => {
    abonnes.delete(f);
    window.removeEventListener('storage', surStockage);
  };
}

// ─── Les lecteurs, purs sur leur entrée ──────────────────────────────────────

export function lireTheme(v: string | null): ThemeChoisi {
  return v === 'clair' || v === 'auto' || v === 'sombre' ? v : 'sombre';
}

export function lireBooleen(v: string | null, defaut: boolean): boolean {
  return v === '1' ? true : v === '0' ? false : defaut;
}

export function lireGuide(v: string | null): EtatGuide {
  return v === 'ignore' || v === 'termine' ? v : 'nouveau';
}

/** Une liste d'identifiants : uniques, non vides, bornée — sinon vide. */
export function lireListe(v: string | null, borne = 50): string[] {
  if (!v) return [];
  try {
    const x: unknown = JSON.parse(v);
    if (!Array.isArray(x)) return [];
    const vus = new Set<string>();
    for (const e of x) {
      if (typeof e === 'string' && e !== '' && e.length <= 200) vus.add(e);
      if (vus.size >= borne) break;
    }
    return [...vus];
  } catch {
    return [];
  }
}

/** La part de l'espace de travail donnée au panneau de gauche, bornée à [0,3 ; 0,7]. */
export function lirePartage(v: string | null): number {
  const n = v === null ? NaN : Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(0.7, Math.max(0.3, n));
}

/**
 * Les briefs des missions lancées depuis CE navigateur, par identifiant de
 * tâche. Le serveur ne range pas le texte d'origine d'un plan : sans ce
 * carnet, la conversation ne pourrait pas rappeler ce qui a été demandé.
 */
export function lireBriefs(v: string | null): Record<string, string> {
  if (!v) return {};
  try {
    const x: unknown = JSON.parse(v);
    if (typeof x !== 'object' || x === null || Array.isArray(x)) return {};
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(x)) {
      if (typeof val === 'string' && k.length <= 200) out[k] = val.slice(0, 5000);
    }
    return out;
  } catch {
    return {};
  }
}

/** Ajoute un brief, en gardant les `borne` plus récents (ordre d'insertion). */
export function ajouterBrief(
  briefs: Record<string, string>,
  ids: readonly string[],
  brief: string,
  borne = 200,
): Record<string, string> {
  const suite: Record<string, string> = {};
  for (const [k, v] of Object.entries(briefs)) if (!ids.includes(k)) suite[k] = v;
  for (const id of ids) suite[id] = brief;
  const cles = Object.keys(suite);
  for (const k of cles.slice(0, Math.max(0, cles.length - borne))) delete suite[k];
  return suite;
}

// ─── Le thème, appliqué à la racine du document ─────────────────────────────

export function themeApplique(choix: ThemeChoisi, systemeSombre: boolean): ThemeApplique {
  if (choix === 'auto') return systemeSombre ? 'sombre' : 'clair';
  return choix;
}

function systemeSombre(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** Pose `data-theme` sur `<html>` — `public/theme-init.js` fait de même avant React. */
export function appliquerTheme(choix: ThemeChoisi = lireTheme(brut(CLES.theme))): ThemeApplique {
  const applique = themeApplique(choix, systemeSombre());
  document.documentElement.dataset.theme = applique;
  document.documentElement.style.colorScheme = applique === 'sombre' ? 'dark' : 'light';
  return applique;
}

export function choisirTheme(choix: ThemeChoisi): void {
  ecrire(CLES.theme, choix);
  appliquerTheme(choix);
}

// ─── Les accroches React ─────────────────────────────────────────────────────

/** Une préférence, réactive : relue à chaque écriture, ici ou dans un autre onglet. */
export function usePreference<T>(cle: Cle, lire: (v: string | null) => T): T {
  const valeur = useSyncExternalStore(abonner, () => brut(cle));
  return lire(valeur);
}

export const pref = {
  theme: () => lireTheme(brut(CLES.theme)),
  banniere: () => lireBooleen(brut(CLES.banniere), true),
  guide: () => lireGuide(brut(CLES.guide)),
  projet: () => brut(CLES.projet),
  favoris: () => lireListe(brut(CLES.favoris)),
  briefs: () => lireBriefs(brut(CLES.briefs)),
};
