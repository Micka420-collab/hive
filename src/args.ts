// L'analyse des arguments — MODULE PUR.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Le dépôt avait TROIS mini-analyseurs ad hoc, chacun dans sa commande, et
// aucun ne gérait `--drapeau=valeur`. Écrire `--uses=3` ne provoquait pas
// d'erreur : le drapeau était simplement IGNORÉ, et la commande s'exécutait
// avec le défaut. C'est la pire façon d'échouer — silencieusement, en faisant
// quelque chose d'autre que ce qu'on a demandé.
//
// Un seul analyseur, pur, testable, et qui REFUSE ce qu'il ne comprend pas.
//
// ─── LA RÈGLE QUI GOUVERNE TOUT ──────────────────────────────────────────────
//
// UN DRAPEAU INCONNU EST UNE ERREUR. Jamais un avertissement, jamais un
// silence. `--dry-runn` doit s'arrêter net : quelqu'un qui croit simuler et
// qui écrit pour de bon a été trahi par son outil.

import { CODE, type CodeSortie } from './codes-sortie.js';

/** Ce qu'un drapeau attend comme valeur. */
export type Forme = 'booleen' | 'valeur';

export interface Analyse {
  /** Les drapeaux booléens présents. */
  drapeaux: Set<string>;
  /** Les drapeaux à valeur, et leur valeur. */
  valeurs: Map<string, string>;
  /** Ce qui n'était pas un drapeau, dans l'ordre. */
  positionnels: string[];
  /** Non nul si l'analyse a échoué. Porte son code de sortie. */
  erreur: { message: string; code: CodeSortie } | null;
}

/**
 * Analyse `argv`, en n'acceptant QUE les drapeaux déclarés.
 *
 * Les deux écritures sont acceptées — `--port 7777` et `--port=7777` — parce
 * que les deux se tapent naturellement et que refuser l'une au profit de
 * l'autre n'apprend rien à personne.
 *
 * `--` termine les options : ce qui suit est positionnel, quoi qu'il
 * ressemble. Sans ça, un nom de projet commençant par un tiret serait
 * impossible à passer.
 */
export function analyser(argv: readonly string[], connus: Record<string, Forme>): Analyse {
  const a: Analyse = {
    drapeaux: new Set(),
    valeurs: new Map(),
    positionnels: [],
    erreur: null,
  };
  const echouer = (message: string, code: CodeSortie = CODE.ERREUR): Analyse => ({
    ...a,
    erreur: { message, code },
  });

  let fini = false;
  for (let i = 0; i < argv.length; i++) {
    const brut = argv[i]!;

    if (fini || !brut.startsWith('--')) {
      a.positionnels.push(brut);
      continue;
    }
    if (brut === '--') {
      fini = true;
      continue;
    }

    const egal = brut.indexOf('=');
    const nom = egal >= 0 ? brut.slice(2, egal) : brut.slice(2);
    const forme = connus[nom];

    if (forme === undefined) {
      // Nommer le coupable ET lister ce qui existe : « option inconnue » tout
      // court oblige à aller lire le code source.
      return echouer(
        `option inconnue : --${nom}\n` +
          `  options acceptées : ${Object.keys(connus)
            .sort()
            .map((c) => `--${c}`)
            .join(' ')}`,
      );
    }

    if (forme === 'booleen') {
      if (egal >= 0) return echouer(`--${nom} ne prend pas de valeur`);
      a.drapeaux.add(nom);
      continue;
    }

    if (egal >= 0) {
      const valeur = brut.slice(egal + 1);
      if (valeur === '') return echouer(`--${nom} attend une valeur`);
      a.valeurs.set(nom, valeur);
      continue;
    }

    const suivant = argv[i + 1];
    // Un drapeau suivi d'un autre drapeau est presque toujours une valeur
    // oubliée. La deviner ferait passer « --port --json » pour un port nommé
    // « --json ».
    if (suivant === undefined || suivant.startsWith('--')) {
      return echouer(`--${nom} attend une valeur`, CODE.REPONSE_MANQUANTE);
    }
    a.valeurs.set(nom, suivant);
    i++;
  }

  return a;
}

/**
 * Lit un entier borné, ou rend l'erreur qui explique pourquoi.
 *
 * Rendre `NaN` silencieusement, c'est reporter la panne plus loin — au moment
 * où le port vaudra « NaN » et où le message ne dira plus d'où ça vient.
 */
export function entier(
  a: Analyse,
  nom: string,
  bornes: { min: number; max: number; defaut: number },
): { valeur: number; erreur: string | null } {
  const brut = a.valeurs.get(nom);
  if (brut === undefined) return { valeur: bornes.defaut, erreur: null };
  const n = Number(brut);
  if (!Number.isInteger(n) || n < bornes.min || n > bornes.max) {
    return {
      valeur: bornes.defaut,
      erreur: `--${nom} attend un entier entre ${bornes.min} et ${bornes.max} (reçu « ${brut} »)`,
    };
  }
  return { valeur: n, erreur: null };
}

/**
 * Le mode non interactif est-il de mise ?
 *
 * `CI=true` l'implique (§6.4) : une CI n'a personne pour répondre, et
 * l'attendre y bloquerait un job jusqu'au délai d'attente.
 */
export function nonInteractif(a: Analyse, env: Record<string, string | undefined> = {}): boolean {
  return a.drapeaux.has('non-interactive') || (env.CI ?? '') !== '';
}
