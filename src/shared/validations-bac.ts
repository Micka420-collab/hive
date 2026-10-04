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
// se jugerait elle-même. Dès que la production a modifié le bloc `scripts`,
// AUCUNE validation n'est donc lancée : elles restent `missing`, raison
// `declaration_reecrite`. Le bloc ENTIER, pas le seul script choisi : `test`
// peut appeler `npm run unit`, et `npm ci` lance `prepare`/`postinstall`
// avant tout le reste — une ligne ajoutée là réécrit le juge après le calcul
// du diff, sans que le diff ne montre autre chose que cette ligne.
//
// ─── ET SEULEMENT DANS UN BAC ────────────────────────────────────────────────
//
// Ces commandes exécutent du code que l'agent a écrit. Sur un nœud sans bac à
// sable (niveau `processus`), elles tourneraient sur l'hôte nu, réseau et
// disque ouverts — alors que la production elle-même n'y exécutait rien :
// Claude Code n'y a que `acceptEdits`, Codex son bac en lecture seule. La
// vérification aurait plus de pouvoir que ce qu'elle vérifie. Sans bac, rien
// ne tourne : les validations restent `missing`, raison `sans_bac`, et l'écran
// dit comment en obtenir un (podman, docker ou bubblewrap).
//
// ─── QUATRE ÉTATS, ET CE QUE CHACUN DIT À L'EVALUATOR ────────────────────────
//
//   · `passed`         — la commande déclarée a tourné et rendu 0 — ou, pour
//                        les tests, ses seuls échecs étaient déjà rouges à la
//                        base (raison `comparee`, G11b), et ils sont DITS ;
//   · `failed`         — elle a tourné et rendu autre chose : c'est un verdict
//                        sur la production, qui demande une correction ;
//   · `missing`        — la preuve DEVRAIT exister et n'existe pas : délai
//                        dépassé, environnement non préparé, outil introuvable,
//                        panne du bac en cours de route (mémoire, disque, DNS,
//                        démon), déclaration réécrite par la production. Jamais
//                        un verdict : l'échec n'est pas imputable au code ;
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
import {
  CARACTERES_DOUTEUX,
  FORMATS_DE_TEST,
  OBSERVATIONS,
  echecDeTestLu,
  sansSuitesRedites,
} from './lecture-tests.js';
import type { ComparaisonDeTests, FormatDeTest } from './lecture-tests.js';

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
  /**
   * Les tests ont échoué, et la sortie s'est lue test par test, complète et
   * cohérente : chaque échec a été comparé à la BASE, rejouée à côté
   * (`comparaison`, G11b). `failed` : une régression au moins ; `passed` : tous
   * étaient déjà rouges à la base, du même échec. Les TESTS seulement
   * (`validationsBacDepuis`).
   */
  comparee: ['passed', 'failed'],
  /**
   * Comparés à la base, des tests ont été vus rouges à une exécution et VERTS à
   * une autre — de la production, ou de la base : ni régression ni vert, le
   * verdict reste inconnu. Les TESTS seulement.
   */
  instable: ['missing'],
  /** Pas de dépôt, ou pas de `package.json` lisible au commit de base. */
  sans_manifeste: ['not_applicable'],
  /** Le projet ne déclare pas ce script. */
  non_declare: ['not_applicable'],
  /** `test` est le script d'échec par défaut de `npm init` : aucun test déclaré. */
  test_par_defaut: ['not_applicable'],
  /** La production a modifié le bloc `scripts` de `package.json`. */
  declaration_reecrite: ['missing'],
  /**
   * La base relue dans l'espace de travail ne correspond pas à son empreinte :
   * l'agent a forgé un objet git du dépôt de la tâche (`base-verifiee.ts`). Le
   * plan se lirait sur un `package.json` falsifié — aucune validation n'est
   * fiable, et aucune ne passe.
   */
  base_falsifiee: ['missing'],
  /** La production a modifié `.npmrc`, qui règle comment npm lance un script. */
  npmrc_reecrit: ['missing'],
  /** Le nœud n'a pas de bac à sable : du code d'agent ne tourne pas sur l'hôte nu. */
  sans_bac: ['missing'],
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
  /**
   * La commande a rendu un code ≠ 0 sur une panne du BAC — mémoire, disque,
   * DNS, démon de conteneurs — reconnue à sa sortie, sans aucun échec de test
   * lu (`panneEnvironnement`). `panne` dit laquelle.
   */
  environnement: ['missing'],
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

/** Les pannes du bac qu'une sortie de commande suffit à reconnaître. */
export const PANNES_ENVIRONNEMENT = ['memoire', 'disque', 'dns', 'demon', 'affichage'] as const;
export type PanneEnvironnement = (typeof PANNES_ENVIRONNEMENT)[number];

/**
 * Chaque panne DITE, dans les deux langues : son nom, et ce qui la lève.
 *
 * Le remède dépend de la panne, et c'est tout l'intérêt de la nommer : la
 * mémoire, le disque, le DNS se rétablissent SUR LE NŒUD ; un démon de
 * conteneurs ou un affichage, le bac n'en expose JAMAIS (`isolement.ts` : ni
 * socket Docker, ni `/tmp/.X11-unix` sous son tmpfs) — « libérez la
 * ressource » y serait un conseil qui ne mène nulle part, la CI GitHub seule
 * en a. Et le remède n'innocente pas la production : une mémoire ou un disque
 * qu'elle épuiserait elle-même se lit dans l'extrait, le texte le dit.
 *
 * Partagé par l'Evaluator (ses motifs, en français) et l'écran (les deux
 * langues) : un seul endroit où la panne a ses mots.
 */
export const DIRE_PANNE: Record<
  PanneEnvironnement,
  { readonly nom: readonly [string, string]; readonly remede: readonly [string, string] }
> = {
  memoire: {
    nom: ['mémoire épuisée', 'out of memory'],
    remede: [
      'libérez de la mémoire sur ce nœud, ou apportez la CI GitHub — à moins que la production ne l’épuise elle-même, ce que l’extrait montre',
      'free memory on this node, or bring GitHub CI — unless the production exhausts it itself, which the excerpt shows',
    ],
  },
  disque: {
    nom: ['disque plein', 'disk full'],
    remede: [
      'libérez de la place sur le disque de ce nœud, ou apportez la CI GitHub — à moins que la production ne le remplisse elle-même, ce que l’extrait montre',
      'free disk space on this node, or bring GitHub CI — unless the production fills it itself, which the excerpt shows',
    ],
  },
  dns: {
    nom: ['DNS indisponible', 'DNS unavailable'],
    remede: [
      'rétablissez la résolution DNS de ce nœud, ou apportez la CI GitHub',
      'restore DNS resolution on this node, or bring GitHub CI',
    ],
  },
  demon: {
    nom: ['démon de conteneurs injoignable', 'container daemon unreachable'],
    remede: [
      'le bac n’expose aucun démon de conteneurs : apportez la CI GitHub',
      'the sandbox exposes no container daemon: bring GitHub CI',
    ],
  },
  affichage: {
    nom: ['aucun affichage', 'no display'],
    remede: [
      'le bac n’a aucun affichage : apportez la CI GitHub',
      'the sandbox has no display: bring GitHub CI',
    ],
  },
};

/** Au plus tant de noms par liste de tests : le reste se COMPTE (`total`). */
export const NOMS_DE_TESTS_MAX = 10;
/** Un nom de test au plus long — une donnée du dépôt, bornée comme l'extrait. */
export const NOM_DE_TEST_MAX = 300;

/** Des tests nommés : les premiers noms, bornés, et combien il y en a. */
export interface TestsNommes {
  total: number;
  noms: readonly string[];
}

/**
 * Ce que la comparaison à la base a vu (G11b, `shared/lecture-tests.ts`) —
 * présente avec les raisons `comparee` et `instable`, et seulement elles.
 */
export interface ComparaisonBase {
  /** Le format de sortie reconnu. */
  format: FormatDeTest;
  /** Exécutions du script de test sur lesquelles le verdict repose. */
  executions: { tete: number; base: number };
  /** La base était déjà dans la mémoire du nœud : elle n'a pas été rejouée. */
  memoire: boolean;
  /** Le temps passé à comparer, au-delà de la première exécution des tests. */
  surcoutMs: number;
  /** Rouges à chaque exécution de la tête, jamais à la base : chacun bloque. */
  regressions: TestsNommes;
  /** Rouges à la tête ET à la base : dits, jamais bloquants. */
  dejaRouges: TestsNommes;
  /** Rouges à une exécution de la tête et pas à l'autre : ni régression, ni vert. */
  instables: TestsNommes;
  /** Rouges à la base, vus verts à la tête. */
  ciblesPassees: TestsNommes;
}

/** Ce que le bac a constaté pour une validation, au-delà de son état. */
export interface DetailControle {
  raison: RaisonControle;
  /** La panne reconnue — présente avec la raison `environnement`, et seulement elle. */
  panne?: PanneEnvironnement;
  /** La comparaison à la base — avec `comparee` et `instable`, et seulement elles. */
  comparaison?: ComparaisonBase;
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

/** Deux blocs `scripts` identiques, à l'ordre des clés près. */
function memesScripts(a: Scripts, b: Scripts | null): boolean {
  if (b === null) return false;
  const cles = Object.keys(a);
  return (
    cles.length === Object.keys(b).length &&
    cles.every((nom) => Object.prototype.hasOwnProperty.call(b, nom) && a[nom] === b[nom])
  );
}

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
  // UN SEUL SCRIPT CHANGÉ SUFFIT, quel qu'il soit : `npm run test` enchaîne
  // `pretest`/`posttest`, un script peut en appeler un autre (`npm run unit`),
  // et `npm ci` lance les scripts de cycle de vie (`prepare`, `postinstall`)
  // avant les validations. Suivre ces chaînes script par script serait
  // deviner ; comparer le bloc entier ne l'est pas.
  const reecrit = base !== null && !memesScripts(base, production);
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
    plan[cle] = reecrit
      ? constat('missing', 'declaration_reecrite', script)
      : { genre: 'lancer', script };
  }
  return plan;
}

/**
 * Les règles `permissions.allow` COMPILÉES depuis les déclarations du dépôt —
 * la moitié « autorisation » de la politique d'actions (G12).
 *
 * La liste DÉCOULE LITTÉRALEMENT du dépôt : les scripts de validation que le
 * `package.json` du commit de BASE déclare (jamais l'arbre de travail — l'agent
 * ne s'auto-autorise pas en réécrivant le juge, même frontière que
 * `declaration_reecrite`), plus l'installation que son lockfile fixe. Hive
 * n'invente aucune commande : un dépôt sans script `test` n'autorise pas
 * `npm run test`, et un dépôt sans lockfile n'autorise aucune installation.
 *
 * La syntaxe est celle des règles de permission de Claude Code
 * (code.claude.com/docs/en/permissions) : `Bash(npm run test)` exact, plus la
 * forme préfixe `Bash(npm run test:*)` pour la même commande suivie
 * d'arguments (`npm run test -- --filter`). Les autres familles d'adaptateurs
 * dérivent leurs globs de la même liste.
 */
export function reglesAutorisationDepot(
  manifesteBase: unknown,
  lockfilePresent: (fichier: string) => boolean = () => false,
): string[] {
  const base = scriptsDe(manifesteBase);
  const plan = planDeValidation(base, base);
  const regles: string[] = [];
  for (const cle of VALIDATION_KEYS) {
    const etape = plan[cle];
    // `planDeValidation(base, base)` applique déjà les gardes du bac :
    // `non_declare`, `sans_manifeste` et le `test` par défaut de `npm init`
    // (qui échoue exprès) ne produisent aucune règle.
    if (etape.genre !== 'lancer') continue;
    regles.push(`Bash(npm run ${etape.script})`, `Bash(npm run ${etape.script}:*)`);
  }
  if (declareDesDependances(manifesteBase)) {
    const preparation = preparationDepuisLockfile(lockfilePresent);
    if (preparation) regles.push(`Bash(${preparation.join(' ')})`);
  }
  return regles;
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

// ─── LES PANNES DU BAC, LUES DANS LA SORTIE ──────────────────────────────────
//
// Un code rendu par la commande vaut verdict — SAUF quand c'est le bac qui a
// lâché pendant qu'elle tournait : le noyau tue le runner faute de mémoire
// (137, « Killed »), un appel système n'obtient plus de mémoire (ENOMEM), le
// disque est plein, le DNS ne répond plus, le démon de conteneurs est tombé.
// Lu `failed`, chacun de ces cas envoyait l'agent corriger du code juste, et
// comptait une correction au modèle dans le Genome (`task_retry` source
// `evaluator`, `registre-genome.ts`). Lu `missing`, raison `environnement`,
// l'Evaluator répond « preuve manquante » : ni correction automatique, ni
// faute au modèle, ni au Worker.
//
// LA TABLE NE SE LIT QUE SUR UN CODE ≠ 0 ET SANS ÉCHEC DE TEST LU — la règle
// de SWE-bench, qui ne classe que ce que ses parseurs n'ont pas su lire. Un
// test qui imprime « Cannot allocate memory » puis rate son assertion reste
// `failed` : c'est son assertion qui parle. Et quand les deux se mêlent (un
// runner qui compte « 1 failed » pour un worker tué), c'est l'échec qui
// l'emporte — l'ancien comportement, pas un vert prêté à tort. LIMITE
// ASSUMÉE : c'est justement le cas d'un worker de vitest/jest abattu par le
// noyau — le runner survit et compte l'échec ; seul un runner d'un seul
// processus tué (« Killed », 137) est reconnu.
//
// Pourquoi une sortie maquillée ne gagne rien : `missing` BLOQUE toujours
// `accepted`. Une production qui imprimerait une signature pour masquer son
// échec échange une correction automatique contre une preuve manquante —
// jamais contre un vert. De même, un vrai OOM causé par le code (une fuite)
// n'est pas blanchi : il reste sans preuve, et le motif le dit (`DIRE_PANNE`).
//
// ─── D'OÙ VIENT LA TABLE ─────────────────────────────────────────────────────
//
// Adaptée de `INFRA_FAILURE_SIGNATURES` (swebench/harness/infra_failure.py,
// v5.0.0) — MIT, Copyright (c) 2023 Carlos E Jimenez, John Yang, Alexander
// Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik R Narasimhan ; la notice
// complète, permission comprise, est au bas de `lecture-tests.ts`. Seul le
// niveau « environment » est repris : le niveau « ambiguous » (module
// introuvable, aucun test collecté) peut venir de la production, il reste un
// verdict. Écarts voulus :
//   · `^Killed$` exige le code 137 (le SIGKILL qui l'accompagne) ;
//   · « Could not resolve host » et « Failed to launch » sont retirés — une
//     adresse mal écrite par l'agent les produit aussi —, seuls `EAI_AGAIN`
//     et « Temporary failure in name resolution » disent un DNS muet ;
//   · « Failed to connect to the bus » est retiré : Chromium l'imprime à
//     presque chaque lancement sans écran, RÉUSSI compris — ce n'est pas une
//     panne, et un test de navigateur qui échoue sans runner l'aurait pris ;
//   · le plafond de TAS d'un processus (« JavaScript heap out of memory » de
//     V8, `OutOfMemoryError` de la JVM) n'y est PAS : c'est une limite du
//     processus, atteinte le plus souvent par la production elle-même (une
//     allocation sans borne, une fuite) — le niveau « ambiguous ». Le lire
//     `environnement` enverrait l'opérateur libérer une mémoire que la
//     prochaine validation épuiserait encore ; il reste un verdict ;
//   · ENOSPC, EDQUOT et ENOMEM (l'appel système, pas le tas) sont ajoutés.

/** Une signature : la panne, le motif, et le code qu'elle exige s'il y en a un. */
const SIGNATURES_ENVIRONNEMENT: readonly {
  panne: PanneEnvironnement;
  motif: RegExp;
  code?: number;
}[] = [
  { panne: 'memoire', motif: /Cannot allocate memory|\bENOMEM\b/ },
  // Le shell de npm écrit « Killed » quand le noyau abat son enfant (SIGKILL,
  // 128 + 9) : le tueur d'OOM, dans un bac borné en mémoire.
  { panne: 'memoire', motif: /^Killed$/m, code: 137 },
  { panne: 'disque', motif: /No space left on device|\bENOSPC\b|Disk quota exceeded|\bEDQUOT\b/ },
  { panne: 'dns', motif: /\bEAI_AGAIN\b|Temporary failure in name resolution/ },
  {
    panne: 'demon',
    motif:
      /Cannot connect to the Docker daemon|Error response from daemon|Cannot connect to Podman/,
  },
  { panne: 'affichage', motif: /cannot open display|Missing X server|unable to open X display/ },
];

/**
 * La panne du bac qu'une commande terminée sur `code` révèle, ou `null`.
 *
 * `null` dès qu'un échec de test se lit dans la sortie, même à côté d'une
 * signature : un échec lu est un verdict. Lu par LE lecteur des sorties de
 * test (`echecDeTestLu`, `shared/lecture-tests.ts`) — celui qui nomme aussi les
 * tests que la comparaison à la base juge : deux lecteurs finiraient par ne
 * pas voir le même échec. La première signature trouvée l'emporte, dans
 * l'ordre de la table.
 */
export function panneEnvironnement(code: number, sortie: string): PanneEnvironnement | null {
  if (code === 0 || echecDeTestLu(sortie)) return null;
  return signatureEnvironnement(code, sortie);
}

/**
 * La première signature de panne du bac que `sortie` porte — sans regarder si
 * un échec de test s'y lit. C'est la règle de la BASE rejouée (G11b) : ses
 * tests rouges EXCUSENT ceux de la production, et un rouge qu'une mémoire ou
 * un disque épuisés auraient causé excuserait une régression. Une exécution
 * qui porte une signature ne compte donc pas — ni à la base, ni à la tête,
 * dont elle ne peut que fausser la comparaison.
 */
export function signatureEnvironnement(code: number, sortie: string): PanneEnvironnement | null {
  const trouvee = SIGNATURES_ENVIRONNEMENT.find(
    (s) => (s.code === undefined || s.code === code) && s.motif.test(sortie),
  );
  return trouvee?.panne ?? null;
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
 *
 * Le 127 est fiable parce que les validations ne tournent QUE dans un bac, et
 * qu'un bac est toujours Linux — conteneur, ou bubblewrap. Sous Windows,
 * `cmd.exe` rendrait 1 pour une commande inconnue, un outil manquant s'y
 * lirait `failed` ; ce cas ne peut pas se présenter, puisqu'un nœud sans bac
 * ne lance rien (`sans_bac`).
 *
 * Un code rendu sur une panne du bac, reconnue à la sortie sans échec de test
 * lu, n'en est pas un non plus : `environnement` (`panneEnvironnement`).
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
  const panne = panneEnvironnement(p.code, p.sortie);
  if (panne) {
    return {
      etat: 'missing',
      raison: 'environnement',
      panne,
      ...commun,
      code: p.code,
      ...extraitDe(p.sortie),
    };
  }
  return { etat: 'failed', raison: 'termine', ...commun, code: p.code, ...extraitDe(p.sortie) };
}

/** Un nom de test sur une ligne, dans la borne du protocole. */
const nomBorne = (nom: string): string =>
  nom.length > NOM_DE_TEST_MAX ? `${nom.slice(0, NOM_DE_TEST_MAX - 1)}…` : nom;

/** Une liste de la comparaison, telle qu'elle se dit : sans suites redites, bornée. */
function nommes(noms: readonly string[]): TestsNommes {
  const dits = sansSuitesRedites(noms);
  return { total: dits.length, noms: dits.slice(0, NOMS_DE_TESTS_MAX).map(nomBorne) };
}

/**
 * Le constat des tests comparés test par test à la base (G11b) — la première
 * exécution à la tête a échoué, sa sortie s'est lue complète et cohérente, et
 * la base a été rejouée (`node-client/validations-bac.ts`).
 *
 * Une régression, et c'est un verdict sur la production : `failed`, chaque
 * régression NOMMÉE. Sinon, des tests instables, et le verdict reste inconnu :
 * `missing` — ni correction, ni vert. Sinon, tous les échecs étaient déjà
 * rouges à la base, du même échec : `passed`, et la liste part avec le
 * constat, pour que l'Evaluator et l'écran la DISENT — un vert qui tairait des
 * tests rouges en serait un faux.
 */
export function controleCompare(p: {
  script: string;
  /** Le code de la PREMIÈRE exécution à la tête — celle qui a ouvert la comparaison. */
  code: number;
  dureeMs: number;
  sortie: string;
  format: FormatDeTest;
  comparaison: ComparaisonDeTests;
  executions: { tete: number; base: number };
  memoire: boolean;
  surcoutMs: number;
}): ControleBac {
  const { regressions, dejaRouges, instables, ciblesPassees } = p.comparaison;
  const comparaison: ComparaisonBase = {
    format: p.format,
    executions: p.executions,
    memoire: p.memoire,
    surcoutMs: p.surcoutMs,
    regressions: nommes(regressions),
    dejaRouges: nommes(dejaRouges),
    instables: nommes(instables),
    ciblesPassees: nommes(ciblesPassees),
  };
  const [etat, raison]: [ValidationState, RaisonControle] =
    regressions.length > 0
      ? ['failed', 'comparee']
      : instables.length > 0
        ? ['missing', 'instable']
        : ['passed', 'comparee'];
  return {
    etat,
    raison,
    script: p.script,
    code: p.code,
    dureeMs: p.dureeMs,
    ...extraitDe(p.sortie),
    comparaison,
  };
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
 * Une liste nommée reconstruite — des noms bornés, pas plus que le total, et
 * qui s'affichent comme ils se lisent : ni saut de ligne, ni caractère de
 * contrôle, ni contrôle bidirectionnel (`CARACTERES_DOUTEUX`). Le lecteur du
 * nœud n'en rend pas ; un nœud qui en enverrait ment ou bogue.
 */
function testsNommesDepuis(v: unknown): TestsNommes | null {
  if (typeof v !== 'object' || v === null) return null;
  const { total, noms } = v as Record<string, unknown>;
  if (!entier(total, 0) || !Array.isArray(noms)) return null;
  if (noms.length > Math.min(total, NOMS_DE_TESTS_MAX)) return null;
  const lus: string[] = [];
  for (const nom of noms) {
    if (typeof nom !== 'string' || nom.length === 0 || nom.length > NOM_DE_TEST_MAX) return null;
    if (CARACTERES_DOUTEUX.test(nom)) return null;
    lus.push(nom);
  }
  return { total, noms: lus };
}

/** Une exécution comptée : au moins une, au plus `OBSERVATIONS`. */
const executionsComptees = (v: unknown): v is number => entier(v, 1) && v <= OBSERVATIONS;

/** La comparaison à la base reconstruite champ par champ, ou `null`. */
function comparaisonDepuis(v: unknown): ComparaisonBase | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  const format = FORMATS_DE_TEST.find((f) => f === c.format);
  const executions = c.executions as Record<string, unknown> | null | undefined;
  if (!format || typeof executions !== 'object' || executions === null) return null;
  if (!executionsComptees(executions.tete) || !executionsComptees(executions.base)) return null;
  if (typeof c.memoire !== 'boolean' || !entier(c.surcoutMs, 0)) return null;
  const regressions = testsNommesDepuis(c.regressions);
  const dejaRouges = testsNommesDepuis(c.dejaRouges);
  const instables = testsNommesDepuis(c.instables);
  const ciblesPassees = testsNommesDepuis(c.ciblesPassees);
  if (!regressions || !dejaRouges || !instables || !ciblesPassees) return null;
  return {
    format,
    executions: { tete: executions.tete, base: executions.base },
    memoire: c.memoire,
    surcoutMs: c.surcoutMs,
    regressions,
    dejaRouges,
    instables,
    ciblesPassees,
  };
}

/**
 * L'état que la comparaison FONDE, ou `null` si elle ne fonde rien — la règle
 * même de `controleCompare`, relue à l'arrivée : un nœud ne fait pas dire
 * `passed` à une comparaison qui porte une régression.
 */
function etatFondePar(c: ComparaisonBase): ValidationState | null {
  if (c.regressions.total > 0) return 'failed';
  if (c.instables.total > 0) return 'missing';
  return c.dejaRouges.total > 0 ? 'passed' : null;
}

/**
 * Reconstruit un constat champ par champ, ou `null` s'il est mal formé.
 *
 * Même discipline que le reste du protocole : rien n'est recopié tel quel, et
 * un champ qu'on n'attend pas n'atteint ni le journal ni l'écran. Le couple
 * état/raison doit figurer dans `ETATS_PAR_RAISON`, et un verdict doit porter
 * le code qui le fonde — 0 pour `passed`, autre chose pour `failed`. Une
 * panne n'accompagne que la raison `environnement`, qui en exige une. Une
 * comparaison à la base n'accompagne que `comparee` et `instable`, qui en
 * exigent une — avec le code ≠ 0 qui l'a ouverte, et l'état qu'elle fonde.
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
  const panne = PANNES_ENVIRONNEMENT.find((p) => p === c.panne);
  if (c.panne !== undefined && panne === undefined) return null;
  if ((raison === 'environnement') !== (panne !== undefined)) return null;
  if (
    raison === 'termine' &&
    (typeof c.code !== 'number' || (etat === 'passed') !== (c.code === 0))
  ) {
    return null;
  }
  const comparee = raison === 'comparee' || raison === 'instable';
  const comparaison = c.comparaison === undefined ? null : comparaisonDepuis(c.comparaison);
  if (c.comparaison !== undefined && comparaison === null) return null;
  if (comparee !== (comparaison !== null)) return null;
  if (comparaison && (c.code === 0 || etatFondePar(comparaison) !== etat)) return null;
  if (comparee && typeof c.code !== 'number') return null;
  return {
    etat,
    raison,
    ...(panne ? { panne } : {}),
    ...(comparaison ? { comparaison } : {}),
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
    // Seuls les TESTS se comparent à la base : un lint, un typecheck ou un
    // build « comparés » seraient un vert que rien n'a fondé.
    if (cle !== 'tests' && (controle.raison === 'comparee' || controle.raison === 'instable')) {
      return null;
    }
    controles[cle] = controle;
  }
  return { ...(typeof m.baseSha === 'string' ? { baseSha: m.baseSha } : {}), controles };
}
