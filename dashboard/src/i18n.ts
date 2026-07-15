// i18n léger de Mission Control — projet mondial, sans dépendance.
//
// Parti pris : PAS de dictionnaire à clés (source d'erreurs de clés fantômes
// pour des centaines de chaînes) mais un helper à double littéral `t(fr, en)`,
// mécanique à appliquer et lisible en place. Deux langues d'interface en v1 :
// français (natif) et anglais (langue internationale) — la Reine, elle, répond
// déjà dans n'importe quelle langue via son propre canal.
//
// Usage dans un composant :
//   const t = useT();
//   <h2>{t('Projets', 'Projects')}</h2>
// Hors composant (constantes) : préférer des fonctions appelées au rendu.

import { useSyncExternalStore } from 'react';

export type UiLang = 'fr' | 'en';
const LANG_KEY = 'hive.lang';

function detectInitial(): UiLang {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'fr' || saved === 'en') return saved;
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let current: UiLang = detectInitial();
const listeners = new Set<() => void>();

export function getLang(): UiLang {
  return current;
}

export function setLang(lang: UiLang): void {
  if (lang === current) return;
  current = lang;
  localStorage.setItem(LANG_KEY, lang);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Langue courante, réactive (re-rend le composant à la bascule FR/EN). */
export function useLang(): UiLang {
  return useSyncExternalStore(subscribe, getLang);
}

export type Translate = (fr: string, en: string) => string;

/** Helper de traduction réactif : `t('Projets', 'Projects')`. */
export function useT(): Translate {
  const lang = useLang();
  return lang === 'fr' ? (fr) => fr : (_fr, en) => en;
}

/** Variante non réactive (rappels hors rendu, messages d'erreur ponctuels). */
export function t(fr: string, en: string): string {
  return current === 'fr' ? fr : en;
}
