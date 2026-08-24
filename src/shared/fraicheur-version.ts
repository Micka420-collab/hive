// SUIS-JE À JOUR ? — la comparaison, et rien d'autre.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// Le bouton « mettre à jour Hive » demandait un fait que le dépôt n'avait pas :
// il n'y avait AUCUNE étiquette publiée, et `package.json` n'avait pas bougé
// depuis des mois. Comparer « ma version » à « la dernière » n'avait ni l'une
// ni l'autre. La décision de poser des étiquettes à chaque livraison est prise ;
// ce fichier est la moitié qui se calcule.
//
// ─── CE QU'IL NE FAIT PAS, ET C'EST VOULU ────────────────────────────────────
//
// Il ne va sur le réseau nulle part. Il reçoit deux chaînes — la mienne, la
// dernière connue — et rend un verdict. Qui va chercher la dernière est un
// autre problème, avec ses propres pannes (pas de réseau, dépôt injoignable,
// jeton expiré) qui n'ont rien à voir avec l'ordre de deux numéros.
//
// C'est la leçon § 9 duooctogicenties, prise à l'endroit : une décision soudée
// à sa lecture n'est pas éprouvable. Ici la décision est un argument.

/** Une version en trois nombres. Rien d'autre n'est une version. */
export interface Version {
  readonly majeur: number;
  readonly mineur: number;
  readonly correctif: number;
}

/**
 * `v0.3.0` ou `0.3.0` → `{0, 3, 0}`. Tout le reste → `null`.
 *
 * ─── POURQUOI C'EST STRICT ───────────────────────────────────────────────────
 *
 * Trois nombres, pas deux, pas quatre, pas de suffixe. `v1.2` serait tentant à
 * lire comme `1.2.0`, et `v1.0.0-beta` comme `1.0.0` — les deux SUPPOSENT
 * quelque chose. Une supposition sur un numéro de version se traduit en
 * « vous êtes à jour » adressé à quelqu'un qui ne l'est pas, ce qui est la
 * seule réponse vraiment nuisible que ce module puisse rendre.
 *
 * Quand on ne sait pas lire, on rend `null`, et l'appelant dira « je ne sais
 * pas » — un aveu, pas une erreur.
 */
export function lireVersion(brut: string | null): Version | null {
  if (brut === null) return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(brut.trim());
  if (m === null) return null;
  return { majeur: Number(m[1]), mineur: Number(m[2]), correctif: Number(m[3]) };
}

/** −1 si `a` est plus ancienne, 0 si égales, +1 si `a` est plus récente. */
export function ordonner(a: Version, b: Version): -1 | 0 | 1 {
  if (a.majeur !== b.majeur) return a.majeur < b.majeur ? -1 : 1;
  if (a.mineur !== b.mineur) return a.mineur < b.mineur ? -1 : 1;
  if (a.correctif !== b.correctif) return a.correctif < b.correctif ? -1 : 1;
  return 0;
}

/**
 * La plus récente d'une liste d'étiquettes, ou `null`.
 *
 * Les étiquettes illisibles sont ÉCARTÉES, pas fatales : un dépôt peut porter
 * `essai-du-mardi` à côté de `v0.3.0` sans que ça empêche de répondre.
 */
export function laPlusRecente(etiquettes: readonly string[]): string | null {
  let meilleure: { brut: string; v: Version } | null = null;
  for (const brut of etiquettes) {
    const v = lireVersion(brut);
    if (v === null) continue;
    if (meilleure === null || ordonner(v, meilleure.v) === 1) meilleure = { brut, v };
  }
  return meilleure === null ? null : meilleure.brut;
}

/** Où je me situe par rapport à ce qui est publié. */
export type Fraicheur = 'a-jour' | 'en-retard' | 'en-avance' | 'inconnue';

/**
 * Le verdict.
 *
 * ─── POURQUOI « EN AVANCE » EXISTE ───────────────────────────────────────────
 *
 * Quelqu'un qui développe tourne sur un commit postérieur à la dernière
 * étiquette. Lui dire « à jour » serait faux dans le sens rassurant, et lui
 * dire « en retard » l'enverrait se « mettre à jour » VERS UNE VERSION PLUS
 * ANCIENNE que la sienne — c'est-à-dire perdre son travail. Les deux réponses
 * simples étant nuisibles, il en faut une troisième.
 */
export function fraicheur(mienne: string | null, derniere: string | null): Fraicheur {
  const a = lireVersion(mienne);
  const b = lireVersion(derniere);
  if (a === null || b === null) return 'inconnue';
  const o = ordonner(a, b);
  if (o === 0) return 'a-jour';
  return o === -1 ? 'en-retard' : 'en-avance';
}

/**
 * Ce que la ruche EN DIT, dans les deux langues.
 *
 * `derniere` n'est affichée que lorsqu'elle veut dire quelque chose : annoncer
 * « la dernière est inconnue » dans la phrase « je ne sais pas » ajouterait du
 * bruit à un aveu déjà clair.
 */
export function direFraicheur(
  f: Fraicheur,
  mienne: string | null,
  derniere: string | null,
  lang: 'fr' | 'en' = 'fr',
): string {
  if (f === 'a-jour') {
    return lang === 'en'
      ? `This hive runs the latest published version (${mienne}).`
      : `Cette ruche fait tourner la dernière version publiée (${mienne}).`;
  }
  if (f === 'en-retard') {
    return lang === 'en'
      ? `A newer version is published: ${derniere} (this hive runs ${mienne}).`
      : `Une version plus récente est publiée : ${derniere} (cette ruche fait tourner ${mienne}).`;
  }
  if (f === 'en-avance') {
    return lang === 'en'
      ? `This hive runs ${mienne}, ahead of the last published version (${derniere}). Nothing to update.`
      : `Cette ruche fait tourner ${mienne}, en avance sur la dernière version publiée (${derniere}). Rien à mettre à jour.`;
  }
  return lang === 'en'
    ? `This hive cannot tell whether it is up to date: no readable version to compare.`
    : `Cette ruche ne peut pas dire si elle est à jour : aucune version lisible à comparer.`;
}
