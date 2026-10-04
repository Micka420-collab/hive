// Le lecteur de la sortie des tests — ce que le runner d'un projet imprime de
// lui-même, lu test par test quand on le reconnaît (G11b).
//
// ─── LIRE, ET SEULEMENT LIRE ─────────────────────────────────────────────────
//
// Le verdict du bac se lisait sur le code de sortie du script `test` : un seul
// test déjà rouge à la base suffisait à bloquer `accepted`, quoi que fasse la
// production. Comparer test par test exige de savoir QUELS tests échouent. Le
// demander à un reporter (`npm run test -- --reporter=json`) inventerait des
// arguments à la commande que le projet déclare — la règle de
// `validations-bac.ts` : le projet déclare, la ruche n'invente pas — et
// casserait les scripts qui ne sont pas vitest (`node --test`, `tsc && vitest`).
// On lit donc la sortie PAR DÉFAUT, et on ne conclut que sur ce qu'on
// reconnaît. Rien de reconnu : le verdict reste celui du script, exactement.
//
// ─── CE QUI EST RECONNU (mesuré : tests/fixtures/sorties-de-tests) ───────────
//
//   · vitest 4 — `FAIL  fichier > suite > test`, le résumé que les reporters
//     `default` et `verbose` impriment tous deux, et les lignes ✓/×/↓/□ du
//     `verbose` (les seules à nommer un test VERT) ;
//   · jest 30 — les titres `● suite › test`, rattachés à leur en-tête
//     `FAIL fichier` ;
//   · node --test (Node 24) — le reporter `spec`, celui par défaut depuis
//     Node 23, donc celui de l'image du bac : ✔/✖/﹣, suites ▶ imbriquées par
//     l'indentation ;
//   · TAP 13/14 — `ok`/`not ok` : par sous-test (`# Subtest:`, node --test
//     `--test-reporter=tap`, node-tap), sinon par le commentaire `# nom` qui
//     groupe ses assertions (tape).
//
// Mocha, ava, bun et les autres langages ne sont pas lus : verdict du script.
//
// ─── UN ÉCHEC MANQUÉ SERAIT UNE RÉGRESSION EXCUSÉE ───────────────────────────
//
// C'est le risque qui gouverne chaque lecteur : un échec que la lecture ne
// voit pas n'est comparé à rien, et s'il voisine des échecs déjà rouges à la
// base, la production passe. Donc :
//
//   · TOUTE ligne d'échec compte — y compris la fermeture ✖ d'une suite node
//     ou le `not ok` d'un parent TAP : une suite peut échouer d'elle-même (un
//     crochet `after`), sans qu'aucun de ses tests ne le dise ;
//   · vitest et jest COMPTENT leurs échecs dans leur résumé : le nombre lu
//     doit être celui-là, sinon la sortie ne se lit pas (`incoherente`) ;
//   · rien de ce qu'un test imprime ne borne la lecture : le résumé de
//     node --test qui l'arrête est le DERNIER ;
//   · un seul format reconnu (deux runners, ou un test qui imprime le format
//     d'un autre, et on ne sait plus qui parle), aucun test à la fois vert et
//     rouge, pas de `Bail out!` TAP.
//
// Ce qu'un test imprime ne peut donc qu'AJOUTER un échec ou rendre la sortie
// illisible — durcir, jamais excuser. Un reporter remplacé, une configuration
// de test réécrite : ceux-là sont DANS le diff, sous les yeux de la
// contre-revue (la limite que `node-client/validations-bac.ts` dit déjà).
//
// La sortie TRONQUÉE (`runProc` n'en garde que le début et la fin) et le CODE
// de sortie sont des faits de l'appelant : c'est lui qui écarte une sortie
// coupée, ou une sortie en échec qui ne nomme aucun test — SWE-bench
// (`get_logs_eval`) : le journal ne décrit alors pas ce qui s'est passé.
//
// ─── UN SEUL LECTEUR ─────────────────────────────────────────────────────────
//
// `ECHECS_LUS` (G11a) vit ICI, à côté des lecteurs : « un échec de test a-t-il
// été lu ? » (`echecDeTestLu`) et « lesquels ? » (`lireSortieDeTest`) sont la
// même question, posée à deux finesses. La table des pannes du bac
// (`panneEnvironnement`) ne s'applique que si ce lecteur-ci ne lit aucun échec.
//
// MODULE PUR — aucune I/O.

import { MOTIF_ANSI } from './texte-d-echec.js';

export const FORMATS_DE_TEST = ['vitest', 'jest', 'node-test', 'tap'] as const;
export type FormatDeTest = (typeof FORMATS_DE_TEST)[number];

/** Ce qu'une exécution dit de ses tests : ceux qu'elle a vus rouges, et verts. */
export interface ObservationDeTests {
  echecs: ReadonlySet<string>;
  succes: ReadonlySet<string>;
}

export interface LectureDeTests extends ObservationDeTests {
  format: FormatDeTest;
}

export type RaisonIllisible =
  'non_reconnue' | 'formats_multiples' | 'contradiction' | 'incoherente' | 'interrompue';

export type IssueDeLecture =
  { lisible: true; lecture: LectureDeTests } | { lisible: false; raison: RaisonIllisible };

/**
 * Ce qu'un runner imprime quand un TEST (ou un contrôle) a échoué : TAP et
 * `node --test` (`not ok`, `# fail N`), les comptes de vitest, jest, mocha,
 * playwright, ava (« 1 failed », « 2 failing », « 1 test failed »), le compte
 * et les lignes `(fail)` de bun, les lignes FAIL/✗/×/✖/✘ de jest, vitest,
 * `node --test`, ESLint et ava, une assertion, une erreur de `tsc`. La liste
 * est volontairement large : un faux positif garde l'ancien `failed`, un faux
 * négatif prêterait une panne à ce qui est un échec.
 */
const ECHECS_LUS: readonly RegExp[] = [
  /^\s*not ok \d/m,
  /^# fail [1-9]/m,
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

// ─── LES SIGNATURES : QUI A PARLÉ ────────────────────────────────────────────
//
// Chaque format se reconnaît à son RÉSUMÉ, imprimé une fois en fin de course
// — jamais à une ligne de test, qu'un test peut imprimer lui-même.

const SIGNATURES: Readonly<Record<FormatDeTest, (texte: string) => boolean>> = {
  vitest: (t) => /^ *Test Files {2}\S.*\(\d+\)$/m.test(t) && /^ *Tests {2}\S.*\(\d+\)$/m.test(t),
  jest: (t) => /^Test Suites: .*\d+ total$/m.test(t) && /^Tests: +.*\d+ total$/m.test(t),
  'node-test': (t) => /^ℹ tests \d+$/m.test(t) && /^ℹ fail \d+$/m.test(t),
  tap: (t) => /^TAP version 1[34]$/m.test(t),
};

/** Ce que les lecteurs notent, et ce qui rend une exécution illisible. */
interface Releve {
  noter(nom: string, issue: 'echec' | 'succes'): void;
  refuser(raison: 'incoherente' | 'interrompue'): void;
}

type Lecteur = (lignes: readonly string[], texte: string, r: Releve) => void;

const LECTEURS: Readonly<Record<FormatDeTest, Lecteur>> = {
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
  const echecs = new Set<string>();
  const succes = new Set<string>();
  let refus: RaisonIllisible | null = null;
  const lignes = texte.split(/\r\n|\r|\n/).map((l) => l.trimEnd());
  LECTEURS[format](lignes, texte, {
    noter(nom, issue) {
      const id = nom.trim();
      if (!id) return;
      const [ici, ailleurs] = issue === 'echec' ? [echecs, succes] : [succes, echecs];
      if (ailleurs.has(id)) refus ??= 'contradiction';
      ici.add(id);
    },
    refuser(raison) {
      refus ??= raison;
    },
  });
  if (refus !== null) return { lisible: false, raison: refus };
  return { lisible: true, lecture: { format, echecs, succes } };
}

/** Le nombre que capture `motif` dans `texte`, 0 sans correspondance. */
function compte(texte: string, motif: RegExp): number {
  return Number(motif.exec(texte)?.[1] ?? 0);
}

// ─── vitest ──────────────────────────────────────────────────────────────────
//
// Le résumé ` FAIL  tests/a.test.ts > suite > test` (` FAIL  fichier [ fichier
// ]` pour un fichier qui ne se charge pas) nomme chaque échec avec son
// fichier, quel que soit le reporter, sous les en-têtes `Failed Tests N` et
// `Failed Suites N` qui les COMPTENT. Les lignes de l'arbre du reporter par
// défaut (`   × test 3ms`, indentées) ne portent ni fichier ni suite : on ne
// les lit pas. Le `verbose` imprime chaque test, chemin complet, après UNE
// espace : ` ✓ fichier > suite > test 1ms`.

function lireVitest(lignes: readonly string[], texte: string, r: Releve): void {
  const echecs = new Set<string>();
  for (const ligne of lignes) {
    const resume = /^ FAIL {2}(\S.*)$/.exec(ligne);
    const test = resume ? null : /^ ([✓×↓□]) (\S.*? > .+?)(?: \d+(?:\.\d+)?m?s)?$/u.exec(ligne);
    const nom = resume?.[1] ?? test?.[2];
    if (nom === undefined) continue;
    // ↓ (sauté) et □ (à faire) ne disent rien du comportement.
    if (resume || test?.[1] === '×') {
      echecs.add(nom.trim());
      r.noter(nom, 'echec');
    } else if (test?.[1] === '✓') r.noter(nom, 'succes');
  }
  const annonces =
    compte(texte, /^⎯+ Failed Tests (\d+) ⎯+$/m) + compte(texte, /^⎯+ Failed Suites (\d+) ⎯+$/m);
  if (echecs.size !== annonces) r.refuser('incoherente');
}

// ─── jest ────────────────────────────────────────────────────────────────────
//
// Chaque fichier ouvre son bloc par `PASS fichier` ou `FAIL fichier` (suivi de
// sa durée quand il est lent), et chaque échec y est titré `  ● suite › test`
// — `● Test suite failed to run` quand le fichier ne se charge pas : son nom,
// rattaché au fichier, dit alors l'échec du fichier entier. Le résumé compte
// les deux (`Tests: N failed`, `Test Suites: M failed`). Les lignes ✓/✕
// n'apparaissent qu'en `--verbose` : elles ne sont pas lues, le titre suffit —
// jest ne nomme donc jamais un test vert.

const SUITE_JEST_EN_ECHEC = 'Test suite failed to run';

function lireJest(lignes: readonly string[], texte: string, r: Releve): void {
  let fichier: string | null = null;
  const tests = new Set<string>();
  const fichiersRouges = new Set<string>();
  for (const ligne of lignes) {
    const entete = /^ *(?:PASS|FAIL) +(\S.*?)(?: \(\d+(?:\.\d+)? ?m?s\))?$/.exec(ligne);
    if (entete?.[1]) {
      fichier = entete[1];
      continue;
    }
    const titre = /^ {2}● (\S.*)$/.exec(ligne)?.[1];
    // `● Console` : l'en-tête des journaux d'un fichier (jest ≤ 24), pas un test.
    if (titre === undefined || fichier === null || titre === 'Console') continue;
    const id = `${fichier} › ${titre}`;
    fichiersRouges.add(fichier);
    if (titre !== SUITE_JEST_EN_ECHEC) tests.add(id);
    r.noter(id, 'echec');
  }
  const testsAnnonces = compte(texte, /^Tests: +(\d+) failed/m);
  const fichiersAnnonces = compte(texte, /^Test Suites: (\d+) failed/m);
  if (tests.size !== testsAnnonces || fichiersRouges.size !== fichiersAnnonces) {
    r.refuser('incoherente');
  }
}

// ─── node --test (reporter spec) ─────────────────────────────────────────────
//
// `▶ suite` ouvre une suite (ou un test qui a des sous-tests), ses tests
// suivent indentés de deux espaces, et une ligne ✔/✖ à SON indentation, sous
// SON nom, la referme : elle dit la suite elle-même, qui peut échouer seule
// (un crochet). Un fichier qui ne se charge pas devient un test à son nom
// (`✖ test/d.test.js`). La lecture s'arrête au DERNIER résumé (`ℹ tests N`) —
// un test pourrait en imprimer un faux plus tôt — : la liste « ✖ failing
// tests: » qui le suit redit les échecs sans leurs suites.

function lireNodeTest(lignes: readonly string[], _texte: string, r: Releve): void {
  // L'écran importe ce module : sa bibliothèque (ES2022) n'a pas `findLastIndex`.
  const fin = lignes.reduce((dernier, l, i) => (/^ℹ tests \d+$/.test(l) ? i : dernier), -1);
  const pile: { indent: number; nom: string }[] = [];
  const depiler = (indent: number) => {
    while ((pile.at(-1)?.indent ?? -1) >= indent) pile.pop();
  };
  for (const ligne of fin < 0 ? lignes : lignes.slice(0, fin)) {
    const m = /^( *)([▶✔✖﹣]) (\S.*?)(?: \(\d+(?:\.\d+)?m?s\))?(?: # (SKIP|TODO)\b.*)?$/u.exec(
      ligne,
    );
    if (!m?.[3]) continue;
    const indent = m[1]?.length ?? 0;
    const nom = m[3];
    if (m[2] === '▶') {
      depiler(indent);
      pile.push({ indent, nom });
      continue;
    }
    const sommet = pile.at(-1);
    if (!(sommet?.indent === indent && sommet.nom === nom)) {
      depiler(indent);
      pile.push({ indent, nom });
    }
    const chemin = pile.map((p) => p.nom).join(' > ');
    pile.pop();
    // Sauté (﹣, # SKIP) ou à faire (# TODO, même rouge) : rien à juger.
    if (m[2] === '﹣' || m[4]) continue;
    r.noter(chemin, m[2] === '✖' ? 'echec' : 'succes');
  }
}

// ─── TAP ─────────────────────────────────────────────────────────────────────
//
// `ok N - nom` / `not ok N - nom`, une directive `# SKIP` ou `# TODO` en fin de
// ligne (un `not ok … # TODO` n'est pas un échec : TAP 13). Les blocs YAML
// (`---` … `...`) portent des messages d'erreur, donc n'importe quel texte :
// on les saute. Deux façons de nommer :
//
//   · avec des `# Subtest: nom` (node --test, node-tap), chaque ligne de
//     résultat est un test, rangé sous les sous-tests qui l'englobent — un
//     parent compris : il peut échouer seul ;
//   · sans (tape), chaque `ok` est une ASSERTION et le dernier commentaire
//     `# nom` le test qui la porte : le test est rouge si l'une de ses
//     assertions l'est. Les numéros, qui glissent dès qu'on ajoute une
//     assertion, ne servent qu'en dernier recours.

/** Les commentaires de résumé de tape et de node --test : pas des noms de test. */
const RESUME_TAP = /^# (?:tests|pass|fail|skip|todo|cancelled|suites|duration_ms|ok)\b/;

function lireTap(lignes: readonly string[], _texte: string, r: Releve): void {
  const parSousTests = lignes.some((l) => /^\s*# Subtest: /.test(l));
  const pile: { indent: number; nom: string }[] = [];
  const groupes = new Map<string, 'echec' | 'succes'>();
  let commentaire: string | null = null;
  let yaml: number | null = null;
  for (const ligne of lignes) {
    const texte = ligne.trimStart();
    const indent = ligne.length - texte.length;
    if (yaml !== null) {
      if (texte === '...' && indent <= yaml) yaml = null;
      continue;
    }
    if (texte === '---') {
      yaml = indent;
      continue;
    }
    if (/^Bail out!/.test(texte)) {
      r.refuser('interrompue');
      return;
    }
    const sousTest = /^# Subtest: (.+)$/.exec(texte)?.[1];
    if (sousTest !== undefined) {
      while ((pile.at(-1)?.indent ?? -1) >= indent) pile.pop();
      pile.push({ indent, nom: sousTest.trim() });
      continue;
    }
    if (/^# /.test(texte) && !RESUME_TAP.test(texte)) {
      commentaire = texte.slice(2).trim();
      continue;
    }
    const res = /^(not ok|ok)\b(?: (\d+))?(?: -)?(?: (.*?))?(?:\s+#\s*(SKIP|TODO)\b.*)?$/i.exec(
      texte,
    );
    if (!res?.[1]) continue;
    const rouge = res[1].toLowerCase() === 'not ok';
    const directive = res[4] !== undefined;
    const nomLu = res[3]?.trim() || `#${res[2] ?? '?'}`;
    if (parSousTests) {
      while ((pile.at(-1)?.indent ?? -1) > indent) pile.pop();
      const annonce = pile.at(-1)?.indent === indent ? pile.pop() : undefined;
      if (directive) continue;
      const chemin = [...pile.map((p) => p.nom), annonce?.nom ?? nomLu].join(' > ');
      r.noter(chemin, rouge ? 'echec' : 'succes');
      continue;
    }
    if (directive) continue;
    const nom = commentaire ?? nomLu;
    groupes.set(nom, rouge || groupes.get(nom) === 'echec' ? 'echec' : 'succes');
  }
  for (const [nom, issue] of groupes) r.noter(nom, issue);
}

// ─── LA COMPARAISON À LA BASE : F2P / P2P ────────────────────────────────────
//
// Portée de SWE-bench, `swebench/harness/grading.py` (`get_eval_tests_report`,
// `test_passed` / `test_failed` / `test_maintained`, `get_resolution_status`) —
// MIT, Copyright (c) 2023 Carlos E Jimenez, John Yang, Alexander Wettig, Shunyu
// Yao, Kexin Pei, Ofir Press, Karthik R Narasimhan. Là-bas, FAIL_TO_PASS et
// PASS_TO_PASS sont calculées une fois, avec le correctif de référence. Ici il
// n'y a pas de référence : la BASE l'est, exécutée à côté — une adaptation,
// pas une copie :
//
//   · PASS_TO_PASS — un test qui n'est pas rouge à la base ne doit pas l'être
//     devenu : sinon, RÉGRESSION, et elle bloque. Un test ABSENT de la base et
//     rouge à la tête compte avec eux : la production l'a ajouté, elle ne l'a
//     pas fait passer ;
//   · FAIL_TO_FAIL — rouge à la base ET à la tête : « déjà rouge à la base ».
//     SWE-bench ne le compte pas (« failure maintenance ») ; ici il est DIT,
//     jamais bloquant ;
//   · FAIL_TO_PASS — rouge à la base et VU vert à la tête : « cible passée ».
//     Vu, pas déduit : un test qui disparaît de la tête n'est pas réparé — chez
//     SWE-bench aussi, une clé absente échoue (`test_failed`) ;
//   · résolution — FULL quand f2p = 1 et p2p = 1 ; ici, `passed` quand aucune
//     régression ni instabilité ne reste.
//
// ─── L'INSTABILITÉ, DANS L'ESPRIT DE pass@k ──────────────────────────────────
//
// Une exécution ne voit pas un test instable : rouge par hasard à la tête, il
// passerait pour une régression ; rouge par hasard à la base, il en
// excuserait une vraie. Chaque côté qui peut changer le verdict est donc vu
// jusqu'à `OBSERVATIONS` fois — k borné à 2, une seconde exécution au plus de
// chaque côté, parce que chacune coûte jusqu'au délai d'une commande :
//
//   · régression : rouge à CHAQUE exécution de la tête, à AUCUNE de la base ;
//   · rouge à une exécution de la tête et pas à l'autre, jamais à la base :
//     INSTABLE — ni régression, ni vert ;
//   · rouge à UNE exécution de la base : la base ne s'en porte pas garante —
//     déjà rouge, instable ou non.
//
// Les exécutions sont paresseuses (`node-client/validations-bac.ts`) : la
// seconde n'a lieu que si, après la première, une régression reste possible.

/** Combien de fois, au plus, chaque côté est exécuté pour un verdict. */
export const OBSERVATIONS = 2;

export interface ComparaisonDeTests {
  /** Rouges à chaque exécution de la tête, jamais à la base : chacun bloque. */
  regressions: string[];
  /** Rouges à la tête, et à la base : pas l'œuvre de la production. */
  dejaRouges: string[];
  /** Rouges à une exécution de la tête, pas à l'autre, jamais à la base. */
  instables: string[];
  /** Rouges à la base, vus verts à la tête : ce que la production a réparé. */
  ciblesPassees: string[];
}

/**
 * Le verdict test par test de la tête contre la base. `tete` : chaque
 * exécution de la production ; `base` : les tests rouges de chaque exécution
 * de la base. Les listes rendues sont triées : un même constat se dit
 * toujours de la même façon.
 */
export function comparerALaBase(
  tete: readonly ObservationDeTests[],
  base: readonly ReadonlySet<string>[],
): ComparaisonDeTests {
  const rougesALaBase = new Set(base.flatMap((echecs) => [...echecs]));
  const rougesALaTete = new Set(tete.flatMap((execution) => [...execution.echecs]));
  const vusVerts = new Set(tete.flatMap((execution) => [...execution.succes]));
  const comparaison: ComparaisonDeTests = {
    regressions: [],
    dejaRouges: [],
    instables: [],
    ciblesPassees: [],
  };
  for (const test of rougesALaTete) {
    if (rougesALaBase.has(test)) comparaison.dejaRouges.push(test);
    else if (tete.every((execution) => execution.echecs.has(test))) {
      comparaison.regressions.push(test);
    } else comparaison.instables.push(test);
  }
  for (const test of rougesALaBase) {
    if (vusVerts.has(test) && !rougesALaTete.has(test)) comparaison.ciblesPassees.push(test);
  }
  for (const liste of Object.values(comparaison)) liste.sort();
  return comparaison;
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
