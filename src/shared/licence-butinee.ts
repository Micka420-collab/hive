// LA LICENCE D'UN BUTIN — le seul risque de ce module qui ne se rattrape pas.
//
// ═══ POURQUOI IL EST À PART DES TROIS AUTRES ═══════════════════════════════
//
// Un fichier trop gros se re-télécharge. Un condensat faux se signale. Un code
// hostile se retire du dépôt. Intégrer du code sous copyleft fort dans un
// produit qu'on distribue autrement **ne se retire pas** : l'obligation naît de
// la distribution, elle est rétroactive, et la seule réparation est juridique.
//
// C'est pour cela que ce module ne « conseille » pas. Il TRANCHE ce qu'il sait
// trancher — les licences permissives, dont l'usage est établi — et RENVOIE À
// L'HUMAIN tout le reste. Un module qui devinerait ici rendrait un service dont
// personne ne veut.
//
// ═══ LA LIMITE, DITE AVANT LES RÈGLES ══════════════════════════════════════
//
// **Un champ `license` est une DÉCLARATION du paquet, pas un fait.** Il peut
// être absent, faux, obsolète, ou contredit par un fichier `LICENSE` qui dit
// autre chose. Aucune analyse de ce champ n'établit sous quelle licence le code
// est réellement publié.
//
// Ce module lit donc ce que le paquet AFFIRME, et son verdict porte sur cette
// affirmation. « Permissive » veut dire « le paquet se déclare permissif », pas
// « vous avez le droit ». La différence est tout le sujet, et c'est aussi
// pourquoi le verdict le plus favorable reste consultable par un humain.

export type FamilleLicence =
  'permissive' | 'copyleft_faible' | 'copyleft_fort' | 'restreinte' | 'inconnue' | 'absente';

export interface VerdictLicence {
  readonly famille: FamilleLicence;
  /** L'expression normalisée sur laquelle porte le verdict. */
  readonly declaree: string;
  /** `true` seulement si TOUT ce qui est exigé est permissif. */
  readonly integrableSansDecision: boolean;
  /** Ce que ça coûte — pas ce que la règle a reconnu. */
  readonly pourquoi: string;
}

/**
 * Les identifiants SPDX que la ruche sait classer.
 *
 * Volontairement COURT. Une liste longue donne l'illusion de la couverture :
 * mieux vaut vingt identifiants sûrs et un « inconnue » franc que deux cents
 * dont la moitié est mal rangée. Un « inconnue » coûte une lecture humaine ;
 * un « permissive » erroné coûte un litige.
 */
const FAMILLES: ReadonlyArray<readonly [RegExp, FamilleLicence]> = [
  [/^(?:mit|isc|0bsd|unlicense|cc0-1\.0|wtfpl|zlib)$/i, 'permissive'],
  [/^bsd-[23]-clause$/i, 'permissive'],
  [/^apache-2\.0$/i, 'permissive'],
  [/^(?:python-2\.0|postgresql|ncsa)$/i, 'permissive'],
  [/^(?:lgpl|mpl|epl|cddl)-/i, 'copyleft_faible'],
  [/^(?:gpl|agpl)-/i, 'copyleft_fort'],
  // « Non commercial », « no derivatives », « source available » : ce ne sont
  // pas des licences libres, et les traiter comme « inconnue » les rangerait
  // avec de simples fautes de frappe.
  [/^cc-by-(?:nc|nd)/i, 'restreinte'],
  [/^(?:sspl|bsl|elastic|busl)-/i, 'restreinte'],
  [/^(?:unlicensed|see\s+license|proprietary|custom)$/i, 'restreinte'],
];

/** L'ordre de gravité : c'est LE PLUS GRAVE qui décide d'une conjonction. */
const GRAVITE: Record<FamilleLicence, number> = {
  permissive: 0,
  inconnue: 1,
  copyleft_faible: 2,
  copyleft_fort: 3,
  restreinte: 4,
  absente: 5,
};

function familleDe(jeton: string): FamilleLicence {
  const j = jeton.trim().replace(/\+$/, '');
  if (j === '') return 'absente';
  for (const [motif, famille] of FAMILLES) if (motif.test(j)) return famille;
  return 'inconnue';
}

const POURQUOI: Record<FamilleLicence, string> = {
  permissive:
    'Le paquet se DÉCLARE permissif. Ce n’est pas une garantie — un champ de manifeste ' +
    'n’établit pas sous quelle licence le code est réellement publié.',
  copyleft_faible:
    'Copyleft faible : modifier ce code oblige à en publier les modifications, et le lier ' +
    'impose des contraintes de forme. Supportable, mais c’est une décision, pas un détail.',
  copyleft_fort:
    'Copyleft fort : distribuer un produit qui l’intègre oblige à en publier TOUTE la ' +
    'source sous la même licence. L’obligation naît de la distribution et ne se retire pas ' +
    'après coup — c’est le seul risque du butinage qui ne se rattrape pas.',
  restreinte:
    'Licence restreinte (non commerciale, sans dérivés, ou « source disponible ») : elle ' +
    'interdit des usages que le reste de la ruche suppose permis.',
  inconnue:
    'Identifiant que la ruche ne sait pas classer. Un « inconnue » franc coûte une lecture ; ' +
    'un « permissive » erroné coûte un litige.',
  absente:
    'Aucune licence déclarée. En droit d’auteur, l’absence de licence n’est PAS une ' +
    'permission : c’est un refus par défaut.',
};

/**
 * Juge une déclaration de licence, expression SPDX comprise.
 *
 * ─── `OR` ET `AND` NE SE VALENT PAS, ET LES CONFONDRE COÛTE ──────────────────
 *
 * `(MIT OR GPL-3.0)` offre un CHOIX : on peut prendre MIT et ignorer le reste,
 * donc la moins contraignante décide. `MIT AND GPL-3.0` impose les DEUX : la
 * plus contraignante décide.
 *
 * Traiter les deux pareil se trompe dans un sens ou dans l'autre — refuser un
 * paquet parfaitement intégrable, ou pire, laisser passer une obligation de
 * publication en croyant avoir le choix.
 */
export function jugerLicence(brut: unknown): VerdictLicence {
  if (typeof brut !== 'string' || brut.trim() === '') {
    return {
      famille: 'absente',
      declaree: '',
      integrableSansDecision: false,
      pourquoi: POURQUOI.absente,
    };
  }
  const texte = brut.trim();

  // Les parenthèses ne changent pas le verdict tant qu'un seul opérateur est en
  // jeu ; une expression qui MÊLE `OR` et `AND` demande une lecture humaine
  // plutôt qu'une résolution approximative des priorités.
  const nu = texte.replace(/[()]/g, ' ').trim();
  const aOu = /\bor\b/i.test(nu);
  const aEt = /\band\b/i.test(nu);
  if (aOu && aEt) {
    return {
      famille: 'inconnue',
      declaree: texte,
      integrableSansDecision: false,
      pourquoi:
        'Expression qui mêle « OR » et « AND » : sa portée dépend de parenthèses que ce ' +
        'module ne résout pas. Une lecture humaine coûte moins qu’une priorité mal devinée.',
    };
  }

  const jetons = nu.split(/\s+(?:or|and)\s+/i).filter((j) => j.trim() !== '');
  if (jetons.length === 0) {
    return {
      famille: 'absente',
      declaree: texte,
      integrableSansDecision: false,
      pourquoi: POURQUOI.absente,
    };
  }
  const familles = jetons.map(familleDe);

  // `OR` : on a le CHOIX, donc la moins grave décide.
  // `AND` (et le jeton seul) : tout s'applique, donc la plus grave décide.
  const retenue = aOu
    ? familles.reduce((a, b) => (GRAVITE[b] < GRAVITE[a] ? b : a))
    : familles.reduce((a, b) => (GRAVITE[b] > GRAVITE[a] ? b : a));

  return {
    famille: retenue,
    declaree: texte,
    integrableSansDecision: retenue === 'permissive',
    pourquoi: POURQUOI[retenue],
  };
}
