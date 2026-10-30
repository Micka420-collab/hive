// Le lecteur de la sortie des tests — ce que le runner d'un projet imprime de
// lui-même, lu test par test quand on le reconnaît (G11b).
//
// ─── LE PRINCIPE : CETTE SORTIE EST UNE ENTRÉE HOSTILE ───────────────────────
//
// La sortie de la TÊTE est écrite en partie par le code de l'agent. Un test
// imprime ce qu'il veut, quand il veut, sans fin de ligne s'il le veut — et le
// runner relaie ce texte ENTRE ses propres lignes : un `process.stdout.write
// ('.')` colle un point devant la ligne `✖` qui suit, un `console.log('# nom')`
// renomme les assertions TAP qui le suivent, un runner arrêté en route
// (`bail`, un plantage) n'imprime jamais l'échec qu'il n'a pas atteint. Lire
// « les échecs qu'on voit », puis excuser ceux qui étaient déjà rouges à la
// base, ce serait laisser l'agent choisir ce qu'on voit.
//
// D'où la règle : UN VERDICT PAR TEST N'EST RENDU QUE SUR UNE SORTIE COMPLÈTE ET
// COHÉRENTE. Chaque ligne qui porte une marque de résultat se lit en entier, au
// format exact du runner ; chaque compte du résumé est retrouvé ; chaque échec
// est recoupé là où le runner le redit ; un nom vu deux fois, ou qui porte un
// caractère de contrôle, ne se lit pas. Au moindre doute la lecture REFUSE, et
// le verdict reste celui du script, exactement (fail-closed : jamais un vert de
// plus). Refuser ne coûte que la finesse ; lire de travers coûterait un vert.
//
// Et ce qui reste hors d'atteinte, il faut le dire : un test qui écrirait une
// sortie COMPLÈTE et cohérente à la place du runner (sur le descripteur de
// son parent, par exemple) tromperait n'importe quel lecteur — comme un
// `process.exit(0)` trompe le code de sortie. Celui-là est DANS le diff, sous
// les yeux de la contre-revue (la limite que `node-client/validations-bac.ts`
// dit déjà).
//
// ─── CE QUI EST RECONNU (mesuré : tests/fixtures/sorties-de-tests) ───────────
//
//   · vitest 4 — reporters `default` et `verbose` ;
//   · jest 30 — reporter par défaut (`verbose` compris) ;
//   · node --test (Node 24) — le reporter `spec`, celui par défaut depuis Node
//     23, donc celui de l'image du bac ;
//   · TAP 13/14 — par sous-test (`# Subtest:` : node --test
//     `--test-reporter=tap`), ou une assertion par ligne quand rien ne les
//     groupe (tape), avec son résumé `# tests/pass/fail`.
//
// Mocha, ava, bun et les autres langages ne sont pas lus : verdict du script.
//
// ─── CE QUI EST EXIGÉ, FORMAT PAR FORMAT ─────────────────────────────────────
//
//   · vitest — un seul résumé ; `Test Files` et `Tests` : chaque test compté
//     dans une case (échoué, passé, échec attendu, sauté, à faire), sinon un
//     test n'a pas tourné (`bail`) ; aucune erreur hors des tests (`Errors`,
//     « Unhandled Errors ») ; autant de `FAIL` distincts que les bannières
//     `Failed Suites`/`Failed Tests` en annoncent ; en `verbose`, chaque test
//     a sa ligne, et les `×` sont les `FAIL` ;
//   · jest — un seul résumé, toutes ses cases additionnées (pas de « 1 of 2
//     total ») ; autant de titres `●` que de tests en échec, autant de fichiers
//     que de suites en échec ; le récapitulatif qui redit les échecs d'une
//     grande suite (« Summary of all failing tests ») les redit TOUS, à
//     l'identique ;
//   · node --test — un seul résumé, dans l'ordre du runner, qui compte chaque
//     test ; un arbre dont chaque ligne est à sa place (l'indentation est la
//     structure) ; une directive `# SKIP`/`# TODO` seulement APRÈS la durée ;
//     une ligne sans durée seulement pour un test annulé ; et chaque échec
//     recoupé, à l'octet près, dans la section « ✖ failing tests: » ;
//   · TAP — une version, un plan à chaque niveau, des numéros qui se suivent,
//     chaque sous-test annoncé fermé sous son nom, un bloc YAML seulement
//     sous un résultat, et le résumé `# tests`/`# pass`/`# fail` retrouvé.
//
// Partout : une ligne qui porte une marque de résultat (✖ ✔ ✓ × ● `not ok`…)
// sans être au format exact rend la sortie ILLISIBLE — c'est la trace d'un
// texte collé devant une ligne du runner.
//
// ─── L'EMPREINTE D'UN ÉCHEC ──────────────────────────────────────────────────
//
// Un même nom ne dit pas une même cause : un test rouge à la base peut l'être
// à la tête pour une autre raison, que la production aurait introduite. Chaque
// échec porte donc son EMPREINTE — le message que le runner imprime (valeurs
// attendue et reçue comprises), et son fichier quand le nom ne le dit pas,
// sans numéro de ligne (une ligne ajoutée au-dessus déplacerait tout). Un test
// n'est « déjà rouge à la base » que s'il l'est de la même empreinte.
//
// La sortie TRONQUÉE et le CODE de sortie sont des faits de l'appelant
// (`node-client/validations-bac.ts`), comme les chemins absolus du bac, qu'il
// ramène à un seul avant de lire.
//
// ─── UN SEUL LECTEUR ─────────────────────────────────────────────────────────
//
// `ECHECS_LUS` (G11a) vit ICI, à côté des lecteurs : « un échec de test a-t-il
// été lu ? » (`echecDeTestLu`) et « lesquels ? » (`lireSortieDeTest`) sont la
// même question, posée à deux finesses. La table des pannes du bac
// (`panneEnvironnement`) ne s'applique que si ce lecteur-ci ne lit aucun échec.
//
// MODULE PUR — aucune I/O. L'écran l'importe : sa bibliothèque est ES2022.

import { MOTIF_ANSI } from './texte-d-echec.js';

export const FORMATS_DE_TEST = ['vitest', 'jest', 'node-test', 'tap'] as const;
export type FormatDeTest = (typeof FORMATS_DE_TEST)[number];

/** Ce qu'une exécution dit de ses tests. */
export interface ObservationDeTests {
  /** Chaque test vu rouge, et l'empreinte de son échec (voir l'en-tête). */
  echecs: ReadonlyMap<string, string>;
  /** Chaque test vu vert — vide quand l'exécution ne nomme pas ses verts. */
  succes: ReadonlySet<string>;
  /**
   * L'exécution nomme-t-elle CHAQUE test qui a tourné, vert compris ? Sans ça
   * (jest, vitest par défaut), un test absent n'est ni vu vert ni vu rouge :
   * seul le résumé dit que la sortie est complète.
   */
  nommeLesVerts: boolean;
}

export interface LectureDeTests extends ObservationDeTests {
  format: FormatDeTest;
}

export type RaisonIllisible =
  /** Aucun format reconnu à son résumé. */
  | 'non_reconnue'
  /** Deux runners, ou un test qui imprime le résumé d'un autre : on ne sait plus qui parle. */
  | 'formats_multiples'
  /** Le résumé ne compte pas tout : arrêt en route, erreur hors des tests, plan absent. */
  | 'incomplete'
  /** Un compte, une structure ou un recoupement ne tombe pas juste. */
  | 'incoherente'
  /** Une ligne porte une marque de résultat sans être au format exact du runner. */
  | 'ligne_douteuse'
  /** Un nom vu deux fois, ou qui porte un caractère de contrôle, bidi, ou une marque. */
  | 'nom_douteux'
  /** Un test à la fois vert et rouge dans la même exécution. */
  | 'contradiction'
  /** `Bail out!` : le producteur TAP a abandonné. */
  | 'interrompue';

export type IssueDeLecture =
  { lisible: true; lecture: LectureDeTests } | { lisible: false; raison: RaisonIllisible };

/**
 * Ce qu'un runner imprime quand un TEST (ou un contrôle) a échoué : TAP et
 * `node --test` (`not ok`, `# fail N`, `ℹ fail N`), les comptes de vitest,
 * jest, mocha, playwright, ava (« 1 failed », « 2 failing », « 1 test
 * failed »), le compte et les lignes `(fail)` de bun, les lignes
 * FAIL/✗/×/✖/✘ de jest, vitest, `node --test`, ESLint et ava, une assertion,
 * une erreur de `tsc`. La liste est volontairement large : un faux positif
 * garde l'ancien `failed`, un faux négatif prêterait une panne à ce qui est un
 * échec.
 */
const ECHECS_LUS: readonly RegExp[] = [
  /^\s*not ok \d/m,
  /^# fail [1-9]/m,
  /^ℹ fail [1-9]/m,
  /\b[1-9]\d* (?:tests? )?(?:failed|failing)\b/,
  /^\s*(?:FAIL|✗|×|✖|✘)\s/m,
  /^\(fail\)\s/m,
  /^\s*[1-9]\d* fail$/m,
  /AssertionError/,
  /\berror TS\d+:/,
];

/** La sortie sans ses séquences de terminal (jest colore ses cadres de code). */
const sansEchappements = (sortie: string): string => sortie.replace(MOTIF_ANSI, '');

/**
 * Un échec de test se lit-il dans `sortie` ? Les marques larges de G11a, ou un
 * test nommé rouge par l'un des lecteurs.
 */
export function echecDeTestLu(sortie: string): boolean {
  if (ECHECS_LUS.some((motif) => motif.test(sansEchappements(sortie)))) return true;
  const issue = lireSortieDeTest(sortie);
  return issue.lisible && issue.lecture.echecs.size > 0;
}

/**
 * Les caractères qui font qu'un nom ne s'affiche pas comme il se lit : les
 * contrôles (C0, DEL, C1) et les contrôles bidirectionnels. Partagé avec la
 * Reine, qui refuse un nom qui en porte (`shared/validations-bac.ts`).
 */
export const CARACTERES_DOUTEUX =
  // eslint-disable-next-line no-control-regex -- les contrôles sont précisément ce qu'on cherche
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

// ─── LES SIGNATURES : QUI A PARLÉ ────────────────────────────────────────────
//
// Chaque format se reconnaît à son RÉSUMÉ, imprimé une fois en fin de course
// — jamais à une ligne de test, qu'un test peut imprimer lui-même.

const SIGNATURES: Readonly<Record<FormatDeTest, (texte: string) => boolean>> = {
  vitest: (t) => /^ Test Files {2}\S/m.test(t) && /^ {6}Tests {2}\S/m.test(t),
  jest: (t) => /^Test Suites: .*\d+ total$/m.test(t) && /^Tests: +.*\d+ total$/m.test(t),
  'node-test': (t) => /^ℹ tests \d+$/m.test(t) && /^ℹ fail \d+$/m.test(t),
  tap: (t) => /^TAP version 1[34]$/m.test(t),
};

/** Les marques de résultat de chaque format : un nom n'en porte pas. */
const MARQUES: Readonly<Record<FormatDeTest, RegExp | null>> = {
  vitest: /[✓×↓□]/u,
  jest: /[●✓✕○✎]/u,
  'node-test': /[▶✔✖﹣⚠ℹ]/u,
  tap: null,
};

/** Ce qu'un lecteur rend : ses tests, ou pourquoi il refuse. */
type Lue = ObservationDeTests | RaisonIllisible;

const LECTEURS: Readonly<Record<FormatDeTest, (lignes: readonly string[]) => Lue>> = {
  vitest: lireVitest,
  jest: lireJest,
  'node-test': lireNodeTest,
  tap: lireTap,
};

/**
 * Les tests qu'une sortie nomme, rouges et verts — ou pourquoi elle ne se lit
 * pas test par test.
 */
export function lireSortieDeTest(sortie: string): IssueDeLecture {
  const texte = sansEchappements(sortie);
  const [format, ...autres] = FORMATS_DE_TEST.filter((f) => SIGNATURES[f](texte));
  if (format === undefined) return { lisible: false, raison: 'non_reconnue' };
  if (autres.length > 0) return { lisible: false, raison: 'formats_multiples' };
  const lignes = texte.split(/\r\n|\r|\n/).map((l) => l.trimEnd());
  const lue = LECTEURS[format](lignes);
  if (typeof lue === 'string') return { lisible: false, raison: lue };
  const marques = MARQUES[format];
  for (const nom of [...lue.echecs.keys(), ...lue.succes]) {
    if (nom.trim() !== nom || nom === '' || CARACTERES_DOUTEUX.test(nom) || marques?.test(nom)) {
      return { lisible: false, raison: 'nom_douteux' };
    }
  }
  for (const nom of lue.succes) {
    if (lue.echecs.has(nom)) return { lisible: false, raison: 'contradiction' };
  }
  return { lisible: true, lecture: { format, ...lue } };
}

/** L'empreinte d'un échec : ses lignes de message, sans blancs, bornées. */
function empreinte(lignes: readonly string[], fichier = ''): string {
  const message = lignes
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' ⏎ ');
  return `${fichier ? `${fichier} — ` : ''}${message}`.slice(0, EMPREINTE_MAX);
}

/** Au-delà, une empreinte n’en dit pas plus — et la mémoire des bases la garde : bornée. */
const EMPREINTE_MAX = 500;

/** L'empreinte d'une suite rouge par ses seuls enfants : eux sont comparés un à un. */
const SOUS_TESTS_EN_ECHEC = 'sous-tests en échec';

/** Chaque nom une fois — un nom vu deux fois ne désigne plus un test (B3). */
function sansDoublon(noms: readonly string[]): boolean {
  return new Set(noms).size === noms.length;
}

// ─── vitest ──────────────────────────────────────────────────────────────────
//
// Sur stdout : l'arbre du reporter (`verbose` : ` ✓ fichier > suite > test
// 1ms`, une ligne par test ; par défaut : les fichiers en échec et leurs
// tests rouges, sans chemin — pas lus), les consoles des tests, puis le
// résumé. Sur stderr, juste avant le résumé : les bannières `Failed Suites N`
// et `Failed Tests N`, et sous elles ` FAIL  fichier > suite > test` — UNE
// ligne par erreur (un test à deux erreurs y paraît deux fois), suivie du
// message, de l'emplacement ` ❯ fichier:l:c` et du cadre de code.
//
// Les lignes d'avant la première bannière portent ce que les tests ont
// imprimé : une marque n'y est admise qu'au format exact du reporter. Les
// sections d'erreurs, elles, sont imprimées par vitest une fois les tests
// finis — les messages et le code qu'elles citent y passent, et ce sont les
// comptes qui les tiennent.

const MARQUES_VITEST = /[✓×↓□]/u;

interface EtatsVitest {
  total: number;
  failed: number;
  passed: number;
  'expected fail': number;
  skipped: number;
  todo: number;
}

/** « 2 failed | 5 passed | 1 skipped (9) », ou `null` si ce n'en est pas un. */
function etatsVitest(texte: string): EtatsVitest | null {
  const m = /^(.+) \((\d+)\)$/.exec(texte);
  if (!m?.[1] || m[2] === undefined) return null;
  const etats: EtatsVitest = {
    total: Number(m[2]),
    failed: 0,
    passed: 0,
    'expected fail': 0,
    skipped: 0,
    todo: 0,
  };
  const vus = new Set<string>();
  for (const part of m[1].split(' | ')) {
    const p = /^(\d+) (failed|passed|expected fail|skipped|todo)$/.exec(part);
    if (!p?.[2] || p[1] === undefined || vus.has(p[2])) return null;
    vus.add(p[2]);
    etats[p[2] as Exclude<keyof EtatsVitest, 'total'>] = Number(p[1]);
  }
  return etats;
}

const sommeVitest = (e: EtatsVitest): number =>
  e.failed + e.passed + e['expected fail'] + e.skipped + e.todo;

function lireVitest(lignes: readonly string[]): Lue {
  // ── Le résumé : un seul, et chaque test dans une case.
  const iFichiers = indices(lignes, /^ Test Files {2}/);
  const iTests = indices(lignes, /^ {6}Tests {2}/);
  if (iFichiers.length !== 1 || iTests.length !== 1) return 'incoherente';
  const fichiers = etatsVitest(lignes[iFichiers[0] ?? 0]?.slice(13) ?? '');
  const tests = etatsVitest(lignes[iTests[0] ?? 0]?.slice(13) ?? '');
  if (!fichiers || !tests) return 'incomplete';
  // Un fichier ou un test que le résumé compte sans le ranger n'a pas tourné.
  if (sommeVitest(fichiers) !== fichiers.total || sommeVitest(tests) !== tests.total) {
    return 'incomplete';
  }
  // Une erreur hors des tests n'est rattachée à aucun nom : rien à comparer.
  const horsDesTests =
    /^ {5}Errors {2}|^Type Errors {2}|^ {6}Leaks {2}|^⎯+ (?:Unhandled Errors?|Async Leaks \d+) ⎯+$/;
  if (lignes.some((l) => horsDesTests.test(l))) return 'incomplete';

  // ── Les sections d'erreurs.
  const annonces = { suites: -1, tests: -1 };
  const noms = { suites: new Map<string, Set<string>>(), tests: new Map<string, Set<string>>() };
  let section: 'suites' | 'tests' | null = null;
  let debutZone = iFichiers[0] ?? 0;
  let groupe: string[] = [];
  let bloc: string[] | null = null;
  let enMessage = false;
  const clore = () => {
    if (section !== null) {
      for (const nom of groupe) {
        const empreintes = noms[section].get(nom) ?? new Set<string>();
        empreintes.add(empreinte(bloc ?? []));
        noms[section].set(nom, empreintes);
      }
    }
    groupe = [];
    bloc = null;
    enMessage = false;
  };
  for (const [i, ligne] of lignes.entries()) {
    const banniere = /^⎯+ Failed (Suites|Tests) (\d+) ⎯+$/.exec(ligne);
    if (banniere?.[1] && banniere[2] !== undefined) {
      clore();
      section = banniere[1] === 'Suites' ? 'suites' : 'tests';
      if (annonces[section] >= 0) return 'incoherente';
      annonces[section] = Number(banniere[2]);
      debutZone = Math.min(debutZone, i);
      continue;
    }
    // Une autre bannière, un séparateur `⎯⎯[1/3]⎯`, le résumé : le bloc est fini.
    if (/^⎯+/.test(ligne) || i === iFichiers[0]) {
      clore();
      if (i === iFichiers[0]) section = null;
      continue;
    }
    const fail = /^ FAIL {2}(\S.*)$/.exec(ligne)?.[1];
    if (fail !== undefined) {
      if (section === null) return 'incoherente';
      if (bloc !== null) clore();
      groupe.push(fail);
      continue;
    }
    if (groupe.length === 0) continue;
    if (bloc === null) {
      bloc = [];
      enMessage = true;
    }
    // Le message s'arrête à l'emplacement (` ❯ a.test.js:4:67`) ou au cadre de code.
    if (/^ ❯ |^\s*\d+\| |^\s+\| /.test(ligne)) enMessage = false;
    else if (enMessage) bloc.push(ligne);
  }
  clore();
  const nSuites = Math.max(annonces.suites, 0);
  const nTests = Math.max(annonces.tests, 0);
  if (noms.suites.size !== nSuites || noms.tests.size !== nTests || tests.failed !== nTests) {
    return 'incoherente';
  }

  // ── L'arbre, avant les sections : une marque n'y paraît qu'au format exact.
  const arbre: Record<'✓' | '×' | '↓' | '□', string[]> = { '✓': [], '×': [], '↓': [], '□': [] };
  for (const ligne of lignes.slice(0, debutZone)) {
    if (!MARQUES_VITEST.test(ligne)) continue;
    // Un test qui a tourné porte sa durée, en DERNIER ; un sauté, un « à
    // faire », jamais : le nom est tout ce qui la précède.
    const v =
      /^ ([✓×]) (\S.* > .+) \d+(?:\.\d+)?m?s$/u.exec(ligne) ?? /^ ([↓□]) (\S.* > .+)$/u.exec(ligne);
    if (v?.[1] && v[2] !== undefined) {
      arbre[v[1] as keyof typeof arbre].push(v[2]);
      continue;
    }
    // L'arbre par défaut (tests sans chemin, fichiers avec leurs comptes) et
    // le message d'un test rouge en `verbose` : pas lus.
    if (/^ {3,}[✓×↓□] \S|^ [✓❯×↓] \S+ \(|^ {3}→ /u.test(ligne)) continue;
    return 'ligne_douteuse';
  }
  const verbose = Object.values(arbre).some((l) => l.length > 0);
  if (verbose) {
    // Chaque test a sa ligne : les comptes du résumé, case par case.
    if (
      arbre['✓'].length !== tests.passed + tests['expected fail'] ||
      arbre['×'].length !== tests.failed ||
      arbre['↓'].length !== tests.skipped ||
      arbre['□'].length !== tests.todo
    ) {
      return 'incoherente';
    }
    if (!sansDoublon(Object.values(arbre).flat())) return 'nom_douteux';
    if (arbre['×'].some((nom) => !noms.tests.has(nom))) return 'incoherente';
  }

  const echecs = new Map<string, string>();
  for (const [nom, empreintes] of [...noms.suites, ...noms.tests]) {
    if (echecs.has(nom)) return 'nom_douteux';
    echecs.set(nom, [...empreintes].sort().join(' ‖ '));
  }
  return { echecs, succes: new Set(arbre['✓']), nommeLesVerts: verbose };
}

// ─── jest ────────────────────────────────────────────────────────────────────
//
// Chaque fichier ouvre son bloc par `PASS fichier` ou `FAIL fichier` (suivi de
// sa durée quand il est lent), et chaque échec y est titré `  ● suite › test`
// — `● Test suite failed to run` quand le fichier ne se charge pas : son nom,
// rattaché au fichier, dit alors l'échec du fichier entier. Le message suit,
// indenté, jusqu'au cadre de code. Le résumé compte tout. Les lignes ✓/✕ du
// `verbose` ne sont pas lues : jest ne nomme donc jamais un test vert.
//
// Au-delà de vingt fichiers, jest REDIT tous les échecs sous « Summary of all
// failing tests » : la redite doit être la même, à l'identique.

const SUITE_JEST_EN_ECHEC = 'Test suite failed to run';

interface EtatsJest {
  total: number;
  /** « X of Y total » : X. */
  lances: number | null;
  failed: number;
  passed: number;
  skipped: number;
  todo: number;
}

/** « 2 failed, 1 skipped, 4 passed, 7 total » (ou « … 3 of 4 total »), sinon `null`. */
function etatsJest(texte: string): EtatsJest | null {
  const parts = texte.split(', ');
  const fin = /^(\d+)(?: of (\d+))? total$/.exec(parts.pop() ?? '');
  if (!fin?.[1]) return null;
  const etats: EtatsJest = {
    total: Number(fin[2] ?? fin[1]),
    lances: fin[2] === undefined ? null : Number(fin[1]),
    failed: 0,
    passed: 0,
    skipped: 0,
    todo: 0,
  };
  const vus = new Set<string>();
  for (const part of parts) {
    const p = /^(\d+) (failed|passed|skipped|todo)$/.exec(part);
    if (!p?.[2] || p[1] === undefined || vus.has(p[2])) return null;
    vus.add(p[2]);
    etats[p[2] as 'failed' | 'passed' | 'skipped' | 'todo'] = Number(p[1]);
  }
  return etats;
}

/** Les titres `●` d'une partie de la sortie, rattachés à leur fichier, et leurs messages. */
function titresJest(
  lignes: readonly string[],
): { titres: [string, string][]; fichiers: Set<string> } | RaisonIllisible {
  const titres: [string, string][] = [];
  const fichiers = new Set<string>();
  let fichier: string | null = null;
  let courant: { id: string; message: string[]; ouvert: boolean } | null = null;
  const clore = () => {
    if (courant) titres.push([courant.id, empreinte(courant.message)]);
    courant = null;
  };
  for (const ligne of lignes) {
    const indent = ligne.length - ligne.trimStart().length;
    // Au plus une espace devant : jest l'imprime en colonne 0 (une espace
    // sous un terminal) — une ligne d'erreur indentée qui commence par
    // « FAIL » ne change pas le fichier auquel les titres suivants se rattachent.
    const entete = /^ ?(?:PASS|FAIL) +(\S.*?)(?: \(\d+(?:\.\d+)? ?m?s\))?$/.exec(ligne);
    if (entete?.[1]) {
      clore();
      fichier = entete[1];
      continue;
    }
    const titre = /^ {2}● (\S.*)$/.exec(ligne)?.[1];
    if (titre !== undefined) {
      clore();
      // `● Console` : l'en-tête des journaux d'un fichier (jest ≤ 24), pas un test.
      if (titre === 'Console') continue;
      if (fichier === null) return 'incoherente';
      fichiers.add(fichier);
      courant = { id: `${fichier} › ${titre}`, message: [], ouvert: true };
      continue;
    }
    // Hors des messages (indentés de quatre), une marque n'est admise qu'au
    // format du `verbose` — sinon, du texte s'est collé devant une ligne.
    if (indent < 4 && /[●✓✕○✎]/u.test(ligne) && !/^ {2,}[✓✕○✎] \S/u.test(ligne)) {
      return 'ligne_douteuse';
    }
    if (courant === null) continue;
    // Le message s'arrête au cadre de code (`> 3 | …`, `  | ^`) ou à la pile.
    if (/^\s*>?\s*\d+ \||^\s+\|( |$)|^\s+at /.test(ligne)) courant.ouvert = false;
    else if (courant.ouvert && indent >= 4) courant.message.push(ligne);
  }
  clore();
  return { titres, fichiers };
}

function lireJest(lignes: readonly string[]): Lue {
  const iSuites = indices(lignes, /^Test Suites: /);
  const iTests = indices(lignes, /^Tests: +/);
  if (iSuites.length !== 1 || iTests.length !== 1) return 'incoherente';
  const suites = etatsJest(lignes[iSuites[0] ?? 0]?.replace(/^Test Suites: /, '') ?? '');
  const tests = etatsJest(lignes[iTests[0] ?? 0]?.replace(/^Tests: +/, '') ?? '');
  if (!suites || !tests) return 'incomplete';
  // Un fichier ou un test que le résumé compte sans le ranger n'a pas tourné
  // (`--bail`) : « 1 failed, 1 of 2 total ».
  const testsRanges = tests.failed + tests.passed + tests.skipped + tests.todo;
  if (tests.lances !== null || testsRanges !== tests.total) return 'incomplete';
  // Pour les fichiers, jest dit « X of Y » dès qu'un fichier n'a pas tourné :
  // X compte les échoués et les passés, Y tous — sautés compris.
  const suitesLancees = suites.failed + suites.passed;
  if (
    suites.todo !== 0 ||
    suitesLancees + suites.skipped !== suites.total ||
    (suites.lances ?? suites.total) !== suitesLancees
  ) {
    return 'incomplete';
  }
  const iRedite = indices(lignes, /^Summary of all failing tests$/);
  if (iRedite.length > 1) return 'incoherente';
  const fin = iRedite[0] ?? iSuites[0] ?? 0;
  const lus = titresJest(lignes.slice(0, fin));
  if (typeof lus === 'string') return lus;
  if (iRedite[0] !== undefined) {
    const redits = titresJest(lignes.slice(iRedite[0] + 1, iSuites[0]));
    if (typeof redits === 'string') return redits;
    const cle = (t: [string, string][]) =>
      t
        .map(([id]) => id)
        .sort()
        .join('\n');
    if (cle(redits.titres) !== cle(lus.titres)) return 'incoherente';
  }
  if (!sansDoublon(lus.titres.map(([id]) => id))) return 'nom_douteux';
  const testsRouges = lus.titres.filter(([id]) => !id.endsWith(` › ${SUITE_JEST_EN_ECHEC}`));
  if (testsRouges.length !== tests.failed || lus.fichiers.size !== suites.failed) {
    return 'incoherente';
  }
  return { echecs: new Map(lus.titres), succes: new Set(), nommeLesVerts: false };
}

// ─── node --test (reporter spec) ─────────────────────────────────────────────
//
// `▶ suite` ouvre une suite (ou un test qui a des sous-tests), ses tests
// suivent indentés de deux espaces, et une ligne ✔/✖ à SON indentation, sous
// SON nom, la referme : elle dit la suite elle-même, qui peut échouer seule
// (un crochet). Un fichier qui ne se charge pas devient un test à son nom
// (`✖ test/d.test.js`). `﹣` : sauté ; `⚠` : à faire, en échec ; la directive
// (`# SKIP`, `# TODO`, ou la raison donnée) suit la DURÉE, en fin de ligne.
// Seul un test annulé n'a pas de durée.
//
// Le runner relaie la sortie des tests telle quelle, au milieu de l'arbre :
// d'où l'exigence de lignes exactes, d'une indentation qui suit la pile, et du
// recoupement. Après le résumé, « ✖ failing tests: » redit chaque échec qui a
// SA propre erreur — `test at fichier:l:c`, puis la même ligne qu'à l'arbre,
// durée comprise, puis le message : c'est là que se lisent le fichier et
// l'empreinte, et c'est imprimé une fois les tests finis.

const MARQUES_NODE = /[▶✔✖﹣⚠ℹ]/u;
const COMPTES_NODE = [
  'tests',
  'suites',
  'pass',
  'fail',
  'cancelled',
  'skipped',
  'todo',
  'duration_ms',
] as const;

interface EntreeNode {
  chemin: string;
  nom: string;
  marque: string;
  /** La ligne sans son indentation : la section des échecs la redit à l'identique. */
  ligne: string;
  feuille: boolean;
  avecDuree: boolean;
  directive?: string;
}

function lireNodeTest(lignes: readonly string[]): Lue {
  // ── Le résumé : chaque compte une fois, à la suite, dans l'ordre du runner.
  const comptes = new Map<string, number>();
  let debut = -1;
  for (const [i, ligne] of lignes.entries()) {
    const m = /^ℹ (\w+) (\d+(?:\.\d+)?)$/.exec(ligne);
    if (!m?.[1] || m[2] === undefined || !(COMPTES_NODE as readonly string[]).includes(m[1])) {
      continue;
    }
    if (comptes.has(m[1])) return 'incoherente';
    comptes.set(m[1], Number(m[2]));
    if (m[1] === 'tests') debut = i;
  }
  if (comptes.size !== COMPTES_NODE.length) return 'incomplete';
  if (COMPTES_NODE.some((cle, k) => lignes[debut + k]?.startsWith(`ℹ ${cle} `) !== true)) {
    return 'incoherente';
  }
  const n = (cle: (typeof COMPTES_NODE)[number]): number => comptes.get(cle) ?? 0;
  if (n('pass') + n('fail') + n('cancelled') + n('skipped') + n('todo') !== n('tests')) {
    return 'incomplete';
  }

  // ── L'arbre, avant le résumé.
  const entrees: EntreeNode[] = [];
  const pile: { indent: number; nom: string }[] = [];
  for (const ligne of lignes.slice(0, debut)) {
    if (!MARQUES_NODE.test(ligne)) continue;
    // Un diagnostic (`t.diagnostic`) : ce qu'il dit n'est pas lu.
    if (/^ *ℹ /.test(ligne)) continue;
    const m = /^( *)([▶✔✖﹣⚠]) (.+)$/u.exec(ligne);
    if (!m?.[2] || m[3] === undefined) return 'ligne_douteuse';
    const indent = m[1]?.length ?? 0;
    if (m[2] === '▶') {
      if (indent !== 2 * pile.length) return 'incoherente';
      pile.push({ indent, nom: m[3] });
      continue;
    }
    // La durée est la DERNIÈRE parenthèse en `ms` : un nom peut en contenir
    // une, et une directive ne vient qu'après elle (I4).
    const titre = /^(.+) \((\d+(?:\.\d+)?)ms\)(?: # (.+))?$/.exec(m[3]);
    const nom = titre?.[1] ?? m[3];
    const sommet = pile.at(-1);
    const fermeture = sommet?.indent === indent && sommet.nom === nom;
    if (!fermeture && indent !== 2 * pile.length) return 'incoherente';
    const chemin = [...pile.map((p) => p.nom), ...(fermeture ? [] : [nom])].join(' > ');
    if (fermeture) pile.pop();
    entrees.push({
      chemin,
      nom,
      marque: m[2],
      ligne: ligne.trimStart(),
      feuille: !fermeture,
      avecDuree: titre !== null,
      ...(titre?.[3] !== undefined ? { directive: titre[3] } : {}),
    });
  }
  if (pile.length > 0) return 'incoherente';
  if (!sansDoublon(entrees.map((e) => e.chemin))) return 'nom_douteux';
  if (entrees.length !== n('tests') + n('suites')) return 'incoherente';
  let sansDuree = 0;
  for (const e of entrees) {
    // Sans durée : seul un test ANNULÉ s'imprime ainsi (`✖ jamais`) — un `✖`
    // imprimé par un test, ou un nom coupé par un saut de ligne, en ont l'air.
    if (!e.avecDuree) {
      if (e.marque !== '✖' || e.nom.includes(' # ')) return 'ligne_douteuse';
      sansDuree += 1;
    }
    // ✖ ne porte jamais de directive ; ﹣ (sauté) et ⚠ (à faire) toujours ;
    // ✔ en porte une quand il est « à faire » (`# TODO`, ou la raison donnée).
    const directiveAttendue = e.marque === '✖' ? false : e.marque === '✔' ? null : true;
    if (directiveAttendue !== null && directiveAttendue !== (e.directive !== undefined)) {
      return 'ligne_douteuse';
    }
  }
  if (sansDuree > n('cancelled')) return 'incoherente';
  const rouges = entrees.filter((e) => e.marque === '✖' || e.marque === '⚠');
  if (n('fail') + n('cancelled') > rouges.filter((e) => e.marque === '✖').length) {
    return 'incoherente';
  }

  // ── La section « ✖ failing tests: », recoupée ligne à ligne.
  const section = sectionNode(lignes.slice(debut + COMPTES_NODE.length), rouges.length > 0);
  if (typeof section === 'string') return section;
  const aRecouper = new Map<string, EntreeNode[]>();
  for (const e of rouges) aRecouper.set(e.ligne, [...(aRecouper.get(e.ligne) ?? []), e]);
  const empreintes = new Map<string, string>();
  for (const s of section) {
    const e = aRecouper.get(s.ligne)?.shift();
    if (!e) return 'incoherente';
    empreintes.set(e.chemin, empreinte(s.message, s.fichier));
  }
  for (const e of rouges) {
    if (empreintes.has(e.chemin)) continue;
    // Une feuille rouge que la section ne redit pas : on ne sait pas ce qui a
    // échoué. Une suite rouge sans erreur propre l'est par ses enfants.
    if (e.feuille || !rouges.some((r) => r.chemin.startsWith(`${e.chemin} > `))) {
      return 'incoherente';
    }
    empreintes.set(e.chemin, SOUS_TESTS_EN_ECHEC);
  }

  const echecs = new Map<string, string>();
  const succes = new Set<string>();
  for (const e of entrees) {
    if (e.marque === '✖') echecs.set(e.chemin, empreintes.get(e.chemin) ?? '');
    // ✔ sans directive : vert ; avec (`# TODO`, une raison) : à faire, rien à juger.
    if (e.marque === '✔' && e.directive === undefined) succes.add(e.chemin);
  }
  return { echecs, succes, nommeLesVerts: true };
}

/**
 * Les entrées de « ✖ failing tests: » : la ligne redite, son fichier, son
 * message (jusqu'à la pile). Entre le résumé et elle, seuls des diagnostics du
 * runner (`ℹ` en colonne 0 : le rapport de couverture) ; après elle (la
 * sortie de npm), aucune marque.
 */
function sectionNode(
  apres: readonly string[],
  attendue: boolean,
): { ligne: string; fichier: string; message: string[] }[] | RaisonIllisible {
  const debut = apres.indexOf('✖ failing tests:');
  const etrangere = (l: string) => MARQUES_NODE.test(l) && !/^ℹ /.test(l);
  if (debut < 0) {
    if (attendue) return 'incomplete';
    return apres.some(etrangere) ? 'ligne_douteuse' : [];
  }
  if (!attendue || apres.slice(0, debut).some(etrangere)) return 'incoherente';
  const entrees: { ligne: string; fichier: string; message: string[] }[] = [];
  let lieu: string | null = null;
  let courante: { message: string[]; ouvert: boolean } | null = null;
  for (const ligne of apres.slice(debut + 1)) {
    const at = /^test at (.+):\d+:\d+$/.exec(ligne)?.[1];
    if (at !== undefined) {
      if (lieu !== null) return 'incoherente';
      lieu = at;
      courante = null;
      continue;
    }
    if (/^[✖⚠] \S/u.test(ligne)) {
      const entree = { ligne, fichier: lieu ?? '', message: [] as string[] };
      entrees.push(entree);
      courante = { message: entree.message, ouvert: true };
      lieu = null;
      continue;
    }
    if (ligne === '') continue;
    if (/^ {2}/.test(ligne)) {
      // Le message s'arrête à la pile (`at …`) ou aux propriétés de l'erreur.
      if (!courante) continue;
      if (/^\s+at |^ {2}\}$|^ {4}\w+: /.test(ligne)) courante.ouvert = false;
      else if (courante.ouvert) courante.message.push(ligne);
      continue;
    }
    // Non indentée : ce qui suit la section (npm). Sans marque.
    if (MARQUES_NODE.test(ligne)) return 'ligne_douteuse';
    courante = null;
  }
  return lieu === null ? entrees : 'incoherente';
}

// ─── TAP ─────────────────────────────────────────────────────────────────────
//
// `ok N - nom` / `not ok N - nom`, une directive `# SKIP` ou `# TODO` en fin
// de ligne (un `not ok … # TODO` n'est pas un échec : TAP 13), un bloc YAML
// (`---` … `...`) JUSTE sous un résultat — il porte le message, d'où
// l'empreinte —, un plan `1..N` à chaque niveau. Deux façons de nommer :
//
//   · avec des `# Subtest: nom` (node --test) : chaque résultat est un test,
//     rangé sous les sous-tests qui l'englobent — un parent compris, il peut
//     échouer seul. Le sous-test annoncé doit se fermer sous SON nom : un
//     test qui imprimerait « Subtest: x » (node le relaie en commentaire)
//     n'en renomme aucun ;
//   · sans (tape) : chaque ligne est UNE ASSERTION, nommée par son message.
//     Le « commentaire » `# nom` qui groupait les assertions de tape n'est
//     plus lu — n'importe quel `console.log('# …')` en imprime un. Des
//     assertions qui portent le même message (« should be equal ») ne
//     désignent plus rien : la sortie ne se lit pas.
//
// Le résumé `# tests N`, `# pass N`, `# fail N` est exigé, une fois chacun, et
// juste : c'est lui qui dit qu'aucune ligne de résultat n'a été avalée.

/** Les commentaires de résumé de tape et de node --test. */
const RESUME_TAP =
  /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) +(\d+(?:\.\d+)?)$/;

interface NiveauTap {
  indent: number;
  /** Le chemin des sous-tests qui englobent ce niveau. */
  parents: string[];
  resultats: number;
  plan: number | null;
  /** Le sous-test annoncé à ce niveau, que son résultat doit fermer. */
  annonce: string | null;
}

function lireTap(lignes: readonly string[]): Lue {
  const versions = indices(lignes, /^TAP version 1[34]$/);
  if (versions.length !== 1) return 'incoherente';
  const avant = lignes.slice(0, versions[0]);
  if (avant.some((l) => /\bnot ok\b|(?:^|\W)ok \d/.test(l))) return 'ligne_douteuse';
  const annonces = lignes.some((l) => /^\s*# Subtest: /.test(l));
  const niveaux: NiveauTap[] = [
    { indent: 0, parents: [], resultats: 0, plan: null, annonce: null },
  ];
  const comptes = new Map<string, number>();
  const resultats: { chemin: string; rouge: boolean; directive: boolean; yaml: string[] }[] = [];
  let yaml: { indent: number; lignes: string[] } | null = null;
  let precedente: 'resultat' | 'autre' = 'autre';
  let sousTests = 0;
  const fermerJusqua = (indent: number): RaisonIllisible | null => {
    while ((niveaux.at(-1)?.indent ?? 0) > indent) {
      const niveau = niveaux.pop();
      if (!niveau || niveau.plan !== niveau.resultats || niveau.annonce !== null) {
        return 'incomplete';
      }
    }
    return (niveaux.at(-1)?.indent ?? 0) === indent ? null : 'incoherente';
  };
  for (const ligne of lignes.slice((versions[0] ?? 0) + 1)) {
    const texte = ligne.trimStart();
    const indent = ligne.length - texte.length;
    if (yaml) {
      if (texte === '...' && indent === yaml.indent) yaml = null;
      else yaml.lignes.push(ligne);
      continue;
    }
    if (texte === '') continue;
    if (/^Bail out!/.test(texte)) return 'interrompue';
    const dernier = resultats.at(-1);
    if (texte === '---') {
      // Un bloc YAML n'appartient qu'au résultat qui le précède immédiatement.
      if (precedente !== 'resultat' || !dernier) return 'ligne_douteuse';
      yaml = { indent, lignes: dernier.yaml };
      precedente = 'autre';
      continue;
    }
    precedente = 'autre';
    const sujet = /^# Subtest: (.+)$/.exec(texte)?.[1];
    if (sujet !== undefined) {
      let niveau = niveaux.at(-1);
      if (niveau && indent === niveau.indent + 4 && niveau.annonce !== null) {
        niveaux.push({
          indent,
          parents: [...niveau.parents, niveau.annonce],
          resultats: 0,
          plan: null,
          annonce: null,
        });
        niveau = niveaux.at(-1);
      }
      if (!niveau || niveau.indent !== indent || niveau.annonce !== null) return 'incoherente';
      niveau.annonce = sujet;
      sousTests += 1;
      continue;
    }
    if (/^#/.test(texte)) {
      const resume = indent === 0 ? RESUME_TAP.exec(texte) : null;
      if (resume?.[1] && resume[2] !== undefined) {
        if (comptes.has(resume[1])) return 'incoherente';
        comptes.set(resume[1], Number(resume[2]));
      }
      continue;
    }
    const plan = /^1\.\.(\d+)(?: # .*)?$/.exec(texte)?.[1];
    if (plan !== undefined) {
      const ferme = fermerJusqua(indent);
      if (ferme) return ferme;
      const niveau = niveaux.at(-1);
      if (!niveau || niveau.plan !== null) return 'incoherente';
      niveau.plan = Number(plan);
      continue;
    }
    const r = /^(not ok|ok)\b(?: (\d+))?(?: -)?(?: (.*?))?(?: # (SKIP|TODO)\b.*)?$/.exec(texte);
    if (!r?.[1]) {
      // Du texte qui contient un résultat sans en être un : collé devant.
      if (/\bnot ok\b|(?:^|\W)ok \d/.test(texte)) return 'ligne_douteuse';
      continue;
    }
    const ferme = fermerJusqua(indent);
    if (ferme) return ferme;
    const niveau = niveaux.at(-1);
    if (!niveau || Number(r[2]) !== niveau.resultats + 1) return 'incoherente';
    niveau.resultats += 1;
    const nom = (r[3] ?? '').trim();
    if (annonces) {
      if (niveau.annonce === null || niveau.annonce !== nom) return 'incoherente';
      niveau.annonce = null;
    }
    resultats.push({
      chemin: [...niveau.parents, nom].join(' > '),
      rouge: r[1] === 'not ok',
      directive: r[4] !== undefined,
      yaml: [],
    });
    precedente = 'resultat';
  }
  if (yaml) return 'incomplete';
  const ferme = fermerJusqua(0);
  if (ferme) return ferme;
  const racine = niveaux[0];
  if (!racine || racine.plan === null || racine.plan !== racine.resultats || racine.annonce) {
    return 'incomplete';
  }

  // ── Le résumé, recoupé : rien n'a été avalé.
  const c = (cle: string): number | undefined => comptes.get(cle);
  const rouges = resultats.filter((r) => r.rouge && !r.directive).length;
  if (c('tests') === undefined || c('pass') === undefined || c('fail') === undefined) {
    return 'incomplete';
  }
  if (annonces) {
    // node --test : chaque test et chaque suite a son résultat ; les comptes
    // ne disent que les tests.
    const [tests, suites] = [c('tests') ?? 0, c('suites') ?? 0];
    const ranges =
      (c('pass') ?? 0) +
      (c('fail') ?? 0) +
      (c('cancelled') ?? 0) +
      (c('skipped') ?? 0) +
      (c('todo') ?? 0);
    if (ranges !== tests || resultats.length !== tests + suites || sousTests !== resultats.length) {
      return 'incoherente';
    }
    if ((c('fail') ?? 0) + (c('cancelled') ?? 0) > rouges) return 'incoherente';
  } else if (
    c('tests') !== resultats.length ||
    c('fail') !== rouges ||
    c('pass') !== resultats.length - rouges
  ) {
    return 'incoherente';
  }

  if (!sansDoublon(resultats.map((r) => r.chemin))) return 'nom_douteux';
  const echecs = new Map<string, string>();
  const succes = new Set<string>();
  for (const r of resultats) {
    if (r.directive) continue;
    if (r.rouge) echecs.set(r.chemin, empreinteTap(r.yaml));
    else succes.add(r.chemin);
  }
  return { echecs, succes, nommeLesVerts: true };
}

/**
 * L'empreinte d'un échec TAP : son bloc YAML sans ce qui varie d'une
 * exécution à l'autre — la durée, la pile, et les numéros de ligne et de
 * colonne des emplacements. Un parent rouge par ses sous-tests (node) l'est
 * par eux.
 */
function empreinteTap(yaml: readonly string[]): string {
  if (yaml.some((l) => l.trim() === "failureType: 'subtestsFailed'")) return SOUS_TESTS_EN_ECHEC;
  // Les clés sont à l'indentation de la première ligne du bloc ; plus loin,
  // c'est la suite de la valeur de la clé précédente (une pile, un message).
  const marge = Math.min(
    ...yaml.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
  );
  const gardees: string[] = [];
  let ignoree = false;
  for (const ligne of yaml) {
    const cle =
      ligne.length - ligne.trimStart().length === marge ? /^\s*(\w+):/.exec(ligne)?.[1] : undefined;
    if (cle !== undefined) ignoree = cle === 'stack' || cle === 'duration_ms' || cle === 'type';
    if (ignoree) continue;
    gardees.push(ligne.replace(/(\S):\d+:\d+(?=\)|'|$)/g, '$1'));
  }
  return empreinte(gardees);
}

/** Les indices des lignes qui répondent à `motif`. */
function indices(lignes: readonly string[], motif: RegExp): number[] {
  const trouves: number[] = [];
  for (const [i, ligne] of lignes.entries()) if (motif.test(ligne)) trouves.push(i);
  return trouves;
}

// ─── LA COMPARAISON À LA BASE : F2P / P2P ────────────────────────────────────
//
// Portée de SWE-bench, `swebench/harness/grading.py` (`get_eval_tests_report`,
// `test_passed` / `test_failed` / `test_maintained`, `get_resolution_status`)
// — notice MIT complète en bas de ce fichier. Là-bas, FAIL_TO_PASS et
// PASS_TO_PASS sont calculées une fois, avec le correctif de référence. Ici il
// n'y a pas de référence : la BASE l'est, exécutée à côté — une adaptation,
// pas une copie :
//
//   · PASS_TO_PASS — un test qui n'est rouge à aucune exécution de la base ne
//     doit pas l'être devenu : sinon, RÉGRESSION, et elle bloque. Un test
//     ABSENT de la base et rouge à la tête compte avec eux : la production l'a
//     ajouté, elle ne l'a pas fait passer ;
//   · FAIL_TO_FAIL — rouge à CHAQUE exécution de la base et de la tête, de la
//     MÊME empreinte : « déjà rouge à la base ». SWE-bench ne le compte pas
//     (« failure maintenance ») ; ici il est DIT, jamais bloquant ;
//   · FAIL_TO_PASS — rouge à la base et VU vert à la tête : « cible passée ».
//     Vu, pas déduit : un test qui disparaît de la tête n'est pas réparé —
//     chez SWE-bench aussi, une clé absente échoue (`test_failed`).
//
// ─── L'INSTABILITÉ, DANS L'ESPRIT DE pass@k ──────────────────────────────────
//
// Une exécution ne voit pas un test instable : rouge par hasard à la tête, il
// passerait pour une régression ; rouge par hasard à la base, il en
// excuserait une vraie. Chaque côté qui peut changer le verdict est donc vu
// jusqu'à `OBSERVATIONS` fois — k borné à 2, parce que chaque exécution coûte
// jusqu'au délai d'une commande. Et « vu, pas déduit » vaut ici aussi :
//
//   · INSTABLE — rouge à une exécution, VU VERT à une autre, de la tête ou de
//     la base : ni régression, ni vert ;
//   · un test rouge à une exécution et ABSENT d'une autre (un titre qui porte
//     une graine, une heure ; une exécution qui ne nomme pas ses verts) : la
//     comparaison s'arrête — on ne sait ni s'il a passé, ni s'il a seulement
//     changé de nom ;
//   · un test vu VERT à la base et absent de la tête (pour un format qui nomme
//     ses verts) : la tête n'a pas tout exécuté — la comparaison s'arrête.
//
// Les exécutions sont paresseuses (`node-client/validations-bac.ts`) : la
// seconde n'a lieu que si, après la première, une régression reste possible.

/** Combien de fois, au plus, chaque côté est exécuté pour un verdict. */
export const OBSERVATIONS = 2;

export interface ComparaisonDeTests {
  /** Rouges à chaque exécution de la tête, à aucune de la base : chacun bloque. */
  regressions: string[];
  /** Rouges à chaque exécution, de la tête et de la base, de la même empreinte. */
  dejaRouges: string[];
  /** Rouges à une exécution, vus verts à une autre : ni régression, ni vert. */
  instables: string[];
  /** Rouges à chaque exécution de la base, vus verts à chaque exécution de la tête. */
  ciblesPassees: string[];
}

/** Pourquoi les exécutions ne se comparent pas — le verdict reste celui du script. */
export type Incomparable =
  /** Vu vert à la base, absent d'une exécution de la tête : elle n'a pas tout exécuté. */
  | { motif: 'vert_disparu'; test: string }
  /** Rouge à une exécution de la tête, absent d'une autre : pas vu vert. */
  | { motif: 'rouge_disparu'; test: string }
  /** Rouge à une exécution de la base, absent d'une autre : pas vu vert. */
  | { motif: 'base_incertaine'; test: string }
  /** Rouge à la base et à la tête, mais pas du même échec. */
  | { motif: 'autre_echec'; test: string };

export type IssueDeComparaison =
  { comparable: true; comparaison: ComparaisonDeTests } | ({ comparable: false } & Incomparable);

/** Un test est-il VU — rouge, ou vert quand l'exécution nomme ses verts ? */
const vu = (o: ObservationDeTests, test: string): boolean =>
  o.echecs.has(test) || o.succes.has(test);

/**
 * Le verdict test par test de la tête contre la base — chaque exécution de
 * l'une et de l'autre, dans l'ordre. Les listes rendues sont triées : un même
 * constat se dit toujours de la même façon.
 */
export function comparerALaBase(
  tete: readonly ObservationDeTests[],
  base: readonly ObservationDeTests[],
): IssueDeComparaison {
  // La tête a-t-elle tout exécuté ? Ce que la base a vu vert doit y être vu.
  for (const b of base) {
    for (const test of b.succes) {
      const h = tete.find((t) => t.nommeLesVerts && !vu(t, test));
      if (h) return { comparable: false, motif: 'vert_disparu', test };
    }
  }
  const comparaison: ComparaisonDeTests = {
    regressions: [],
    dejaRouges: [],
    instables: [],
    ciblesPassees: [],
  };
  const rougesALaTete = new Set(tete.flatMap((o) => [...o.echecs.keys()]));
  for (const test of rougesALaTete) {
    if (tete.some((o) => !vu(o, test))) return { comparable: false, motif: 'rouge_disparu', test };
    if (tete.some((o) => o.succes.has(test))) {
      comparaison.instables.push(test);
      continue;
    }
    const rougesALaBase = base.filter((o) => o.echecs.has(test));
    if (rougesALaBase.length === 0) {
      comparaison.regressions.push(test);
      continue;
    }
    if (base.some((o) => !vu(o, test))) {
      return { comparable: false, motif: 'base_incertaine', test };
    }
    if (rougesALaBase.length < base.length) {
      comparaison.instables.push(test);
      continue;
    }
    const empreintes = new Set([...tete, ...base].map((o) => o.echecs.get(test)));
    if (empreintes.size !== 1 || empreintes.has('')) {
      return { comparable: false, motif: 'autre_echec', test };
    }
    comparaison.dejaRouges.push(test);
  }
  const rougesALaBase = new Set(base.flatMap((o) => [...o.echecs.keys()]));
  for (const test of rougesALaBase) {
    const repare = base.every((o) => o.echecs.has(test)) && tete.every((o) => o.succes.has(test));
    if (repare) comparaison.ciblesPassees.push(test);
  }
  for (const liste of Object.values(comparaison)) liste.sort();
  return { comparable: true, comparaison };
}

/**
 * Une liste de tests sans les suites dont un test est aussi dans la liste :
 * « groupe » rouge parce que « groupe > sous-test » l'est ne dit rien de plus.
 * Pour le DIRE seulement — le verdict compte tout (`comparerALaBase`).
 */
export function sansSuitesRedites(noms: readonly string[]): string[] {
  return noms.filter(
    (nom) => !noms.some((autre) => autre.startsWith(`${nom} > `) || autre.startsWith(`${nom} › `)),
  );
}

// ─── NOTICE ──────────────────────────────────────────────────────────────────
//
// La comparaison ci-dessus est portée de SWE-bench (`grading.py`), et la table
// des pannes du bac (`shared/validations-bac.ts`, `INFRA_FAILURE_SIGNATURES`)
// de son `infra_failure.py`. Leur licence :
//
//   MIT License
//
//   Copyright (c) 2023 Carlos E Jimenez, John Yang, Alexander Wettig, Shunyu
//   Yao, Kexin Pei, Ofir Press, Karthik R Narasimhan
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the
//   following conditions:
//
//   The above copyright notice and this permission notice shall be included
//   in all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
//   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
//   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
//   USE OR OTHER DEALINGS IN THE SOFTWARE.
