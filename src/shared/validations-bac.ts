// Les validations du bac — ce que le PROJET déclare pour se vérifier, lancé là
// où la production vient d'être faite.
//
// ─── LE TROU QUE CE MODULE FERME ─────────────────────────────────────────────
//
// L'Evaluator n'accepte une production qu'avec des validations vertes (tests,
// typecheck, build, lint), et la SEULE source de ces preuves était la CI GitHub
// d'une pull request déjà ouverte. Un projet local-first — sans GitHub, ou
// avant toute livraison — restait donc `additional_test_required` pour
// toujours : aucune production ne pouvait y être jugée sur ses tests.
//
// Le nœud qui vient de produire a pourtant tout sous la main : le clone, le
// diff appliqué, le bac à sable. Il lance donc lui-même les commandes que le
// projet déclare, dans ce même bac, et les rapporte AVEC le résultat. La Reine
// les range sous la source `hive_sandbox` — à côté de `github_pull_request`,
// jamais confondue avec elle.
//
// ─── LA FRONTIÈRE : LE PROJET DÉCLARE, À SA BASE ─────────────────────────────
//
// **Le bac ne lance que ce que le dépôt déclarait AVANT la production.** Les
// scripts `test`, `typecheck`, `build` et `lint` du `package.json` du commit de
// base — la règle des Chantiers (`chantier.ts` : la ruche choisit dans ce que
// le dépôt déclare, elle n'invente jamais une commande), sans nouvelle surface
// de configuration.
//
// « À sa base » n'est pas un détail : l'agent écrit dans le même répertoire, y
// compris dans `package.json`. S'il remplace `"test": "vitest run"` par
// `"test": "true"`, le bac rendrait un vert qui ne prouve rien — la production
// se jugerait elle-même. Une déclaration que la production a modifiée (le
// script, ou les crochets `pre`/`post` que `npm run` enchaîne avec lui) n'est
// donc PAS lancée : elle reste `missing`, raison `declaration_reecrite`.
//
// ─── QUATRE ÉTATS, ET CE QUE CHACUN DIT À L'EVALUATOR ────────────────────────
//
//   · `passed`         — la commande déclarée a tourné et rendu 0 ;
//   · `failed`         — elle a tourné et rendu autre chose : c'est un verdict
//                        sur la production, qui demande une correction ;
//   · `missing`        — la preuve DEVRAIT exister et n'existe pas : délai
//                        dépassé, environnement non préparé, outil introuvable,
//                        déclaration réécrite par la production. Jamais un
//                        verdict : l'échec n'est pas imputable au code ;
//   · `not_applicable` — le projet ne déclare pas cette commande. Ce n'est pas
//                        un vert : l'Evaluator l'affiche tel quel, et ne le
//                        laisse jamais tenir lieu de TESTS (voir evaluator.ts).
//
// Chaque constat porte une RAISON typée, jamais une phrase : le journal range
// des faits, et l'écran les dit dans sa langue (même discipline que les
// verdicts des Gardiennes). Module PUR : aucune I/O. Le nœud
// (`node-client/validations-bac.ts`) lit le dépôt et lance ; ce module décide,
// et valide ce qui traverse le réseau et le journal.

import { nomDeChantierValide } from './chantier.js';

export const VALIDATION_KEYS = ['tests', 'typecheck', 'build', 'lint'] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];
export type ValidationState = 'passed' | 'failed' | 'missing' | 'not_applicable';

/**
 * Pourquoi un constat dit ce qu'il dit — et l'état que chaque raison autorise.
 *
 * La table est la seule définition des couples admis : `termine` est la seule
 * raison qui porte un verdict (`passed`/`failed`) ; les raisons d'absence de
 * déclaration ne rendent que `not_applicable` ; toutes les autres disent qu'on
 * n'a pas pu conclure, donc `missing`. Un couple hors table venu du réseau est
 * refusé : un nœud qui l'enverrait ment ou bogue.
 */
export const ETATS_PAR_RAISON = {
  /** La commande a tourné jusqu'au bout ; `code` porte le verdict. */
  termine: ['passed', 'failed'],
  /** Pas de dépôt, ou pas de `package.json` lisible au commit de base. */
  sans_manifeste: ['not_applicable'],
  /** Le projet ne déclare pas ce script. */
  non_declare: ['not_applicable'],
  /** `test` est le script d'échec par défaut de `npm init` : aucun test déclaré. */
  test_par_defaut: ['not_applicable'],
  /** La production a modifié le script ou ses crochets `pre`/`post`. */
  declaration_reecrite: ['missing'],
  /** La production a modifié `.npmrc`, qui règle comment npm lance un script. */
  npmrc_reecrit: ['missing'],
  /** `npm` ne se lance pas dans le bac de ce nœud. */
  npm_indisponible: ['missing'],
  /** Des dépendances déclarées, et aucun lockfile pour les installer à l'identique. */
  sans_lockfile: ['missing'],
  /** L'installation depuis le lockfile a échoué. */
  preparation_echouee: ['missing'],
  /** Délai dépassé : la commande a été arrêtée. */
  delai: ['missing'],
  /** La tâche a été annulée. */
  annule: ['missing'],
  /** Le processus n'a pas pu être lancé. */
  lancement: ['missing'],
  /** Arrêté par un signal qui ne vient pas de Hive. */
  signal: ['missing'],
  /** Code 126/127 : un outil du script est introuvable ou non exécutable dans le bac. */
  outil_introuvable: ['missing'],
  /** Une erreur inattendue du nœud a interrompu les validations. */
  interrompue: ['missing'],
} as const satisfies Record<string, readonly ValidationState[]>;

export type RaisonControle = keyof typeof ETATS_PAR_RAISON;

/**
 * Les scripts qui déclarent chaque validation, par ordre de préférence.
 *
 * Des noms EXACTS, comparés par égalité : `test:unit` ou `lint:css` ne sont pas
 * « les tests » ou « le lint » du projet, et deviner lequel l'est serait
 * inventer une commande. `type-check` est la seule variante admise : c'est le
 * même mot, écrit comme le fait tout l'écosystème Vue.
 */
export const SCRIPTS_DE_VALIDATION: Readonly<Record<ValidationKey, readonly string[]>> = {
  tests: ['test'],
  typecheck: ['typecheck', 'type-check'],
  build: ['build'],
  lint: ['lint'],
};

/**
 * L'ordre de lancement : du moins coûteux au plus coûteux, comme une CI — et
 * `build` avant `tests`, parce que des tests lisent parfois ce que le build
 * produit.
 */
export const ORDRE_DE_LANCEMENT: readonly ValidationKey[] = ['lint', 'typecheck', 'build', 'tests'];

/** La fin de sortie qu'un constat transporte au plus. C'est une DONNÉE du dépôt. */
export const EXTRAIT_MAX = 2_000;

/** Ce que le bac a constaté pour une validation, au-delà de son état. */
export interface DetailControle {
  raison: RaisonControle;
  /** Le script lancé — ou qui l'aurait été. Absent quand le projet n'en déclare pas. */
  script?: string;
  /** Code de sortie, quand un processus s'est terminé de lui-même. */
  code?: number;
  dureeMs?: number;
  /** Fin de la sortie, bornée — jamais une consigne. */
  extrait?: string;
}

export interface ControleBac extends DetailControle {
  etat: ValidationState;
}

/** Le rapport qu'un nœud joint à son `task_result`. */
export interface ValidationsBac {
  /** Commit de base du clone : ce que la production a modifié. Absent sans dépôt. */
  baseSha?: string;
  controles: Record<ValidationKey, ControleBac>;
}

type Scripts = Readonly<Record<string, string>>;

/** Ce que le bac fera d'une validation, décidé avant de lancer quoi que ce soit. */
export type Etape =
  { genre: 'lancer'; script: string } | { genre: 'constat'; controle: ControleBac };

/**
 * Le script par défaut de `npm init`. Il ÉCHOUE exprès (« no test specified »),
 * et il est dans une foule de dépôts qui n'ont simplement pas de tests : le
 * lancer ferait passer chacune de leurs productions pour une régression.
 */
const TEST_PAR_DEFAUT = /no test specified/i;

const constat = (etat: ValidationState, raison: RaisonControle, script?: string): Etape => ({
  genre: 'constat',
  controle: { etat, raison, ...(script ? { script } : {}) },
});

/**
 * Le plan de validation d'une production, validation par validation.
 *
 * `base` : les scripts du `package.json` du commit de base (`null` : pas de
 * manifeste lisible à la base). `production` : ceux de l'arbre que l'agent a
 * laissé (`null` : supprimé ou illisible).
 */
export function planDeValidation(
  base: Scripts | null,
  production: Scripts | null,
): Record<ValidationKey, Etape> {
  const plan = {} as Record<ValidationKey, Etape>;
  for (const cle of VALIDATION_KEYS) {
    if (base === null) {
      plan[cle] = constat('not_applicable', 'sans_manifeste');
      continue;
    }
    const script = SCRIPTS_DE_VALIDATION[cle].find((nom) =>
      Object.prototype.hasOwnProperty.call(base, nom),
    );
    if (script === undefined) {
      plan[cle] = constat('not_applicable', 'non_declare');
      continue;
    }
    if (cle === 'tests' && TEST_PAR_DEFAUT.test(base[script] ?? '')) {
      plan[cle] = constat('not_applicable', 'test_par_defaut', script);
      continue;
    }
    // `npm run test` enchaîne `pretest`, `test` puis `posttest` : les trois
    // font partie de ce qui juge. Un seul modifié suffit à ce que la
    // production ait réécrit son propre juge.
    const reecrit = [`pre${script}`, script, `post${script}`].some(
      (nom) => base[nom] !== production?.[nom],
    );
    plan[cle] = reecrit
      ? constat('missing', 'declaration_reecrite', script)
      : { genre: 'lancer', script };
  }
  return plan;
}

/**
 * L'installation que le LOCKFILE déclare, quand les dépendances manquent.
 *
 * Une installation reproduit ce qu'un fichier du dépôt fixe — jamais ce qu'une
 * commande nomme (`preparation.ts`). Sans lockfile, `npm install` résoudrait
 * des versions que personne n'a choisies : le bac ne prépare pas, et le dit.
 * Chaque entrée passe `jugerPreparation` (garde redite au lancement).
 */
export const PREPARATIONS_PAR_LOCKFILE: readonly {
  fichier: string;
  argv: readonly string[];
}[] = [
  { fichier: 'package-lock.json', argv: ['npm', 'ci'] },
  { fichier: 'npm-shrinkwrap.json', argv: ['npm', 'ci'] },
  { fichier: 'pnpm-lock.yaml', argv: ['pnpm', 'install', '--frozen-lockfile'] },
  { fichier: 'yarn.lock', argv: ['yarn', 'install', '--frozen-lockfile'] },
  { fichier: 'bun.lock', argv: ['bun', 'install', '--frozen-lockfile'] },
  { fichier: 'bun.lockb', argv: ['bun', 'install', '--frozen-lockfile'] },
];

/** La préparation déclarée par le premier lockfile présent, ou `null`. */
export function preparationDepuisLockfile(present: (fichier: string) => boolean): string[] | null {
  const trouve = PREPARATIONS_PAR_LOCKFILE.find((p) => present(p.fichier));
  return trouve ? [...trouve.argv] : null;
}

/** Le manifeste déclare-t-il des dépendances à installer ? */
export function declareDesDependances(manifeste: unknown): boolean {
  if (typeof manifeste !== 'object' || manifeste === null) return false;
  const champs = manifeste as Record<string, unknown>;
  return ['dependencies', 'devDependencies', 'optionalDependencies'].some((champ) => {
    const bloc = champs[champ];
    return typeof bloc === 'object' && bloc !== null && Object.keys(bloc).length > 0;
  });
}

/** Les scripts d'un manifeste déjà parsé ; `null` s'il n'en est pas un. */
export function scriptsDe(manifeste: unknown): Record<string, string> | null {
  if (typeof manifeste !== 'object' || manifeste === null || Array.isArray(manifeste)) return null;
  const bloc = (manifeste as Record<string, unknown>).scripts;
  const scripts: Record<string, string> = {};
  if (typeof bloc === 'object' && bloc !== null) {
    for (const [nom, commande] of Object.entries(bloc)) {
      if (typeof commande === 'string') scripts[nom] = commande;
    }
  }
  return scripts;
}

/** Comment une commande lancée s'est arrêtée, quand ce n'est pas d'elle-même. */
export type Arret = 'delai' | 'lancement' | 'annule';

/** La fin d'une sortie, dans la borne du protocole ; absente si vide. */
export function extraitDe(sortie: string): { extrait?: string } {
  const extrait = sortie.trim().slice(-EXTRAIT_MAX);
  return extrait ? { extrait } : {};
}

/**
 * Le constat d'une commande lancée.
 *
 * ─── CE QUI EST UN VERDICT, ET CE QUI N'EN EST PAS UN ───────────────────────
 *
 * Seul un code de sortie rendu par la commande elle-même vaut verdict. Tout le
 * reste — délai dépassé, lancement impossible, annulation, signal, code
 * 126/127 (« non exécutable » / « introuvable » : un outil du script n'est pas
 * installé dans le bac) — dit que l'ENVIRONNEMENT n'a pas permis de conclure,
 * pas que la production est fausse. Le classer `failed` enverrait l'agent
 * corriger du code qui va très bien ; c'est donc `missing`.
 */
export function controleApresLancement(p: {
  script: string;
  code: number | null;
  arret?: Arret;
  dureeMs: number;
  sortie: string;
}): ControleBac {
  const commun = { script: p.script, dureeMs: p.dureeMs };
  if (p.arret) return { etat: 'missing', raison: p.arret, ...commun, ...extraitDe(p.sortie) };
  if (p.code === null) {
    return { etat: 'missing', raison: 'signal', ...commun, ...extraitDe(p.sortie) };
  }
  if (p.code === 0) return { etat: 'passed', raison: 'termine', ...commun, code: 0 };
  if (p.code === 126 || p.code === 127) {
    return {
      etat: 'missing',
      raison: 'outil_introuvable',
      ...commun,
      code: p.code,
      ...extraitDe(p.sortie),
    };
  }
  return { etat: 'failed', raison: 'termine', ...commun, code: p.code, ...extraitDe(p.sortie) };
}

// ─── Ce qui traverse le réseau et le journal ─────────────────────────────────

const SHA = /^[0-9a-f]{7,64}$/;

const entier = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

export function estEtatDeValidation(v: unknown): v is ValidationState {
  return v === 'passed' || v === 'failed' || v === 'missing' || v === 'not_applicable';
}

function estRaison(v: unknown): v is RaisonControle {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ETATS_PAR_RAISON, v);
}

/**
 * Reconstruit un constat champ par champ, ou `null` s'il est mal formé.
 *
 * Même discipline que le reste du protocole : rien n'est recopié tel quel, et
 * un champ qu'on n'attend pas n'atteint ni le journal ni l'écran. Le couple
 * état/raison doit figurer dans `ETATS_PAR_RAISON`, et un verdict doit porter
 * le code qui le fonde — 0 pour `passed`, autre chose pour `failed`.
 */
export function controleDepuis(v: unknown): ControleBac | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  const { etat, raison } = c;
  if (!estEtatDeValidation(etat) || !estRaison(raison)) return null;
  if (!(ETATS_PAR_RAISON[raison] as readonly ValidationState[]).includes(etat)) return null;
  if (c.script !== undefined && !nomDeChantierValide(c.script)) return null;
  if (c.code !== undefined && !entier(c.code, Number.MIN_SAFE_INTEGER)) return null;
  if (c.dureeMs !== undefined && !entier(c.dureeMs, 0)) return null;
  if (c.extrait !== undefined && typeof c.extrait !== 'string') return null;
  if (raison === 'termine' && (etat === 'passed') !== (c.code === 0)) return null;
  return {
    etat,
    raison,
    ...(typeof c.script === 'string' ? { script: c.script } : {}),
    ...(typeof c.code === 'number' ? { code: c.code } : {}),
    ...(typeof c.dureeMs === 'number' ? { dureeMs: c.dureeMs } : {}),
    ...(typeof c.extrait === 'string' ? extraitDe(c.extrait) : {}),
  };
}

/**
 * Le rapport d'un nœud, reconstruit — ou `null` s'il est mal formé.
 *
 * Mal formé, il est ABANDONNÉ, pas le résultat qui le porte : perdre une
 * production pour un champ de preuve facultatif serait pire que le mal. Les
 * validations redeviennent alors ce qu'elles étaient sans rapport — `missing`.
 */
export function validationsBacDepuis(v: unknown): ValidationsBac | null {
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Record<string, unknown>;
  if (m.baseSha !== undefined && !(typeof m.baseSha === 'string' && SHA.test(m.baseSha))) {
    return null;
  }
  if (typeof m.controles !== 'object' || m.controles === null) return null;
  const brut = m.controles as Record<string, unknown>;
  const controles = {} as Record<ValidationKey, ControleBac>;
  for (const cle of VALIDATION_KEYS) {
    const controle = controleDepuis(brut[cle]);
    if (!controle) return null;
    controles[cle] = controle;
  }
  return { ...(typeof m.baseSha === 'string' ? { baseSha: m.baseSha } : {}), controles };
}
