/**
 * CE QUE LA CLI ENVOIE quand on demande un billet — décidé ici, posté là-bas.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * `cmdInvite` lisait ses arguments et composait le corps de la requête sur
 * place, dans `src/cli.ts` — un fichier qui n'exporte rien. Un balayage élargi
 * y a montré `uses !== undefined` muté en `===` sans qu'une assertion bouge.
 *
 * Ce mutant n'est pas cosmétique. Avec `===`, `--uses 3` n'atteint plus jamais
 * la ruche : le champ est omis, la ruche applique SON défaut, et la personne
 * croit avoir posé un billet à trois usages. Un billet d'invitation est un
 * droit d'entrée compté — se tromper sur le compte est une faille, pas un
 * détail d'affichage.
 *
 * (Le cas sans `--uses` ne distingue rien : `JSON.stringify` supprime les
 * valeurs `undefined`, donc `{ uses: undefined }` et `{}` partent identiques
 * sur le fil. L'entrée qui tranche est `--uses N`, et c'est elle qu'on éprouve.)
 */

/** Le corps posté à `/api/billets`. Tout est optionnel : la ruche a ses défauts. */
export interface CorpsBillet {
  url?: string;
  uses?: number;
  ttlMs?: number;
  insecure?: true;
}

const HEURE_MS = 3_600_000;

/**
 * Lit la valeur NUMÉRIQUE qui suit un drapeau, ou `undefined`.
 *
 * `Number.isFinite` écarte `NaN` et les infinis : `--uses abc` doit laisser la
 * ruche appliquer son défaut, jamais poster `NaN` — que `JSON.stringify`
 * transformerait en `null`, c'est-à-dire en une valeur que personne n'a tapée.
 */
export function valeurNumerique(args: readonly string[], nom: string): number | undefined {
  const i = args.indexOf(nom);
  if (i < 0) return undefined;
  const brut = args[i + 1];
  // `Number('')` vaut ZÉRO, et `Number('  ')` aussi. Sans cette garde,
  // `--uses ""` posait un billet à zéro usage — inutilisable, sans un mot.
  // Une chaîne vide n'est pas un nombre que quelqu'un a tapé : c'est une
  // absence, et une absence laisse la ruche décider. Trouvé en écrivant le
  // banc de ce module, pas en le lisant.
  if (brut === undefined || brut.trim() === '') return undefined;
  const n = Number(brut);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Le corps du billet, dérivé des arguments.
 *
 * Ce qui n'a pas été demandé n'est PAS envoyé : un champ absent laisse la ruche
 * décider, un champ présent l'engage. C'est la différence entre « je n'ai pas
 * d'avis » et « je veux zéro ».
 */
export function corpsDuBillet(args: readonly string[]): CorpsBillet {
  const drapeaux = new Set(args.filter((a) => a.startsWith('--')));
  const positionnels = args.filter((a) => !a.startsWith('--'));
  const corps: CorpsBillet = {};

  const url = positionnels.find((a) => a.startsWith('ws'));
  if (url) corps.url = url;

  const uses = valeurNumerique(args, '--uses');
  if (uses !== undefined) corps.uses = uses;

  const heures = valeurNumerique(args, '--hours');
  if (heures !== undefined) corps.ttlMs = Math.round(heures * HEURE_MS);

  if (drapeaux.has('--insecure')) corps.insecure = true;
  return corps;
}
