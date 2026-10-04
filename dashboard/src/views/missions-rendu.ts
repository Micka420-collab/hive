// CE QUE L'ÉCRAN DES MISSIONS DIT — les chiffres d'une comparaison, en mots.
//
// La Reine calcule (`src/shared/mission-rejouable.ts`) ; ce module décide
// seulement comment le dire, et une règle le gouverne : l'INCONNU S'ÉCRIT
// « inconnu ». Une somme sans déclaration n'est pas « 0 $ », un écart contre
// un côté muet n'est pas « = », et une couverture partielle se lit « au moins ».
// Pur et éprouvé (tests/missions-rejeu-ecran.test.tsx) : aucune de ces
// décisions ne doit vivre dans du JSX, hors d'atteinte d'un banc.

import type { SommeDeclaree } from '../../../src/shared/declaration-fournisseur';
import type { EcartDeclare } from '../../../src/shared/mission-rejouable';
import type { Traduire } from './projets-rendu';

export type Unite = 'usd' | 'ms';

/** Une valeur dans son unité : dollars à deux décimales, durées lisibles. */
export function direValeur(v: number, unite: Unite): string {
  if (unite === 'usd') return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)} $`;
  const ms = Math.abs(v);
  const signe = v < 0 ? '−' : '';
  if (ms < 1_000) return `${signe}${Math.round(ms)} ms`;
  if (ms < 60_000) return `${signe}${(ms / 1_000).toFixed(1)} s`;
  return `${signe}${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1_000)} s`;
}

/**
 * Une somme déclarée, avec sa couverture. « au moins » quand une tentative
 * s'est tue : trois tentatives dont deux déclarent font AU MOINS ce total.
 */
export function direSomme(s: SommeDeclaree | 'inconnu', unite: Unite, t: Traduire): string {
  if (s === 'inconnu') return t('inconnu', 'unknown');
  const valeur = direValeur(s.total, unite);
  if (s.declarees === s.tentatives) return valeur;
  return t(
    `au moins ${valeur} (${s.declarees}/${s.tentatives} déclarées)`,
    `at least ${valeur} (${s.declarees}/${s.tentatives} declared)`,
  );
}

/** Un écart signé ; `inconnu` quand un côté n'a rien déclaré, jamais « = ». */
export function direEcart(e: EcartDeclare, unite: Unite, t: Traduire): string {
  if (e.ecart === 'inconnu') return t('inconnu', 'unknown');
  const signe = e.ecart > 0 ? '+' : '';
  const brut = `${signe}${direValeur(e.ecart, unite)}`;
  return e.couvertureComplete ? brut : t(`${brut} (couverture partielle)`, `${brut} (partial)`);
}

/** Un écart entier (comptes) : signé, `=` seulement quand il vaut vraiment zéro. */
export function direEcartCompte(n: number): string {
  return n === 0 ? '=' : n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** Une durée mesurée par la Reine, ou « en vol ». */
export function direDuree(v: number | 'inconnu', t: Traduire): string {
  return v === 'inconnu' ? t('en vol', 'in flight') : direValeur(v, 'ms');
}

/** Le libellé d'une action irréversible d'un rejeu. */
export function direGenre(genre: string, t: Traduire): string {
  switch (genre) {
    case 'livraison_pr':
      return t('pull request', 'pull request');
    case 'fusion_pr':
      return t('fusion', 'merge');
    case 'livraison_locale':
      return t('commit de mission', 'mission commit');
    case 'poussee':
      return t('poussée', 'push');
    case 'workflow':
      return t('workflow GitHub', 'GitHub workflow');
    case 'connecteur':
      return t('message de connecteur', 'connector message');
    default:
      return genre;
  }
}

/** Le nom d'une politique de routage, dans la langue de l'écran. */
export function direPolitique(politique: string | undefined, t: Traduire): string {
  switch (politique ?? 'apprise') {
    case 'apprise':
      return t('apprise', 'learned');
    case 'figee':
      return t('Genome figé', 'frozen Genome');
    case 'neutre':
      return t('neutre', 'neutral');
    default:
      return politique ?? '';
  }
}
