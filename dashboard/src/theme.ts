// Le thème de Mission Control — clair, sombre, ou celui du système.
//
// ─── CE QUI DÉCIDE ───────────────────────────────────────────────────────────
//
// Trois choix, pas deux : « système » est le défaut, et il n'est PAS « clair ».
// Tant que la personne n'a rien choisi, la feuille suit `prefers-color-scheme`
// toute seule (styles.css) — sombre la nuit si l'OS l'est, sans une ligne de
// script. Un choix explicite pose `data-theme` sur `<html>` et l'emporte sur
// l'OS, dans les deux sens.
//
// ─── POURQUOI LE CHOIX EST PAR NAVIGATEUR, ET JAMAIS BLOQUANT ────────────────
//
// Le thème est une préférence d'ÉCRAN, pas un réglage de la ruche : il vit dans
// `localStorage`, comme la langue. Mais `localStorage` peut manquer ou lever —
// navigation privée, stockage coupé par la politique du poste, quota plein.
// Une préférence d'affichage qui ferait tomber l'écran serait pire que pas de
// préférence : chaque accès est donc gardé, et un échec retombe sur
// « système ». Le choix reste appliqué pour la session même s'il n'a pas pu
// être écrit.
//
// ─── POURQUOI AVANT LE PREMIER RENDU ─────────────────────────────────────────
//
// `appliquerTheme` est appelé par `main.tsx` avant `createRoot` : poser
// l'attribut après le premier rendu ferait clignoter le mauvais thème le temps
// d'une image. (Le cas « système », lui, ne clignote jamais : il n'a besoin
// d'aucun script.)

import { useSyncExternalStore } from 'react';

export type ChoixTheme = 'systeme' | 'sombre' | 'clair';

export const CHOIX_THEMES: readonly ChoixTheme[] = ['systeme', 'sombre', 'clair'];

/** La clé de `localStorage` — même famille que `hive.lang`, `hive.token`. */
export const CLE_THEME = 'hive.theme';

/** La valeur de `data-theme` : l'attribut que lit styles.css. Absent = système. */
const ATTRIBUT: Record<ChoixTheme, 'dark' | 'light' | null> = {
  systeme: null,
  sombre: 'dark',
  clair: 'light',
};

function estChoix(v: unknown): v is ChoixTheme {
  return typeof v === 'string' && (CHOIX_THEMES as readonly string[]).includes(v);
}

/** Le choix mémorisé ; « système » si rien, si illisible, ou si le stockage lève. */
export function lireChoixTheme(): ChoixTheme {
  try {
    const brut = localStorage.getItem(CLE_THEME);
    return estChoix(brut) ? brut : 'systeme';
  } catch {
    return 'systeme';
  }
}

let courant: ChoixTheme = 'systeme';
let ecouteAutresOnglets = false;
const abonnes = new Set<() => void>();

/** Pose (ou retire) `data-theme` sur `<html>` d'après le choix. */
function poserAttribut(choix: ChoixTheme): void {
  const valeur = ATTRIBUT[choix];
  const racine = document.documentElement;
  if (valeur === null) racine.removeAttribute('data-theme');
  else racine.setAttribute('data-theme', valeur);
}

/**
 * Au démarrage : relit le choix mémorisé et l'applique. Suit aussi les AUTRES
 * onglets : un choix fait dans l'un repeint les autres (`storage` n'est émis
 * que vers les onglets qui n'ont pas fait l'écriture).
 */
export function appliquerTheme(): void {
  courant = lireChoixTheme();
  poserAttribut(courant);
  // Un seul écouteur, même si l'amorce est rejouée (tests, rechargement à chaud).
  if (ecouteAutresOnglets) return;
  ecouteAutresOnglets = true;
  window.addEventListener('storage', (e) => {
    if (e.key !== CLE_THEME) return;
    const suivant = estChoix(e.newValue) ? e.newValue : 'systeme';
    if (suivant === courant) return;
    courant = suivant;
    poserAttribut(courant);
    for (const a of abonnes) a();
  });
}

/** Le choix courant (non réactif). */
export function choixTheme(): ChoixTheme {
  return courant;
}

/** Change le thème, tout de suite, et le mémorise si le stockage le permet. */
export function changerTheme(choix: ChoixTheme): void {
  if (choix === courant) return;
  courant = choix;
  poserAttribut(choix);
  try {
    if (choix === 'systeme') localStorage.removeItem(CLE_THEME);
    else localStorage.setItem(CLE_THEME, choix);
  } catch {
    // Non mémorisé : le choix vaut pour cet onglet, jusqu'au rechargement.
  }
  for (const a of abonnes) a();
}

function abonner(rappel: () => void): () => void {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

/** Le choix courant, réactif : re-rend le composant quand il change. */
export function useChoixTheme(): ChoixTheme {
  return useSyncExternalStore(abonner, choixTheme);
}
