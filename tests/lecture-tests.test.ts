// Le lecteur de la sortie des tests, et la comparaison à la base (G11b).
//
// Les sorties de `fixtures/sorties-de-tests/` sont RÉELLES : capturées sur
// vitest 4.1.11, jest 30.5.2, Node 24.20 et tape 5, non-TTY et `CI=true` comme
// dans le bac, chemins remplacés par le montage du bac (`/hive/tache`). Ce
// banc vérifie que chacune se lit test par test — et surtout ce qui ne doit
// JAMAIS arriver : une sortie que le code de l'agent a pu altérer (une ligne
// collée, un commentaire imprimé, un runner arrêté en route), lue quand même.
// Lue, elle laisserait un échec sans comparaison — et des échecs déjà rouges à
// la base à côté de lui feraient passer la production.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CARACTERES_DOUTEUX,
  OBSERVATIONS,
  comparerALaBase,
  echecDeTestLu,
  lireSortieDeTest,
  sansSuitesRedites,
} from '../src/shared/lecture-tests.js';
import type { IssueDeLecture, ObservationDeTests } from '../src/shared/lecture-tests.js';

const sortie = (fichier: string): string =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'sorties-de-tests', fichier), 'utf8');

/** La lecture d'une sortie lisible, en tableaux triés. */
function lu(issue: IssueDeLecture): {
  format: string;
  echecs: string[];
  succes: string[];
  nommeLesVerts: boolean;
} {
  if (!issue.lisible) throw new Error(`illisible : ${issue.raison}`);
  return {
    format: issue.lecture.format,
    echecs: [...issue.lecture.echecs.keys()].sort(),
    succes: [...issue.lecture.succes].sort(),
    nommeLesVerts: issue.lecture.nommeLesVerts,
  };
}

/** L'empreinte lue pour un test. */
function empreinteDe(issue: IssueDeLecture, test: string): string | undefined {
  if (!issue.lisible) throw new Error(`illisible : ${issue.raison}`);
  return issue.lecture.echecs.get(test);
}

const illisible = (raison: string) => ({ lisible: false, raison });

describe('lireSortieDeTest — les sorties des runners, telles qu’elles sont', () => {
  it.each(['vitest-defaut-propre.txt', 'vitest-verbose-propre.txt'])(
    'vitest (%s) : chaque échec nommé avec son fichier — suite au crochet cassé et fichier qui ne se charge pas compris',
    (fichier) => {
      const lecture = lu(lireSortieDeTest(sortie(fichier)));
      expect(lecture.format).toBe('vitest');
      expect(lecture.echecs).toEqual([
        'tests/a.test.js > suite A > echoue',
        'tests/b.test.js > b echoue',
        'tests/b.test.js > crochet',
        'tests/d.test.js [ tests/d.test.js ]',
      ]);
    },
  );

  it('vitest verbose : chaque test VERT est nommé — et ce reporter-là seul les nomme tous', () => {
    const verbose = lu(lireSortieDeTest(sortie('vitest-verbose-propre.txt')));
    expect(verbose.nommeLesVerts).toBe(true);
    expect(verbose.succes).toEqual([
      'tests/a.test.js > hors suite',
      'tests/a.test.js > suite A > echec attendu',
      'tests/a.test.js > suite A > imbriquee > profond passe',
      'tests/a.test.js > suite A > passe',
      'tests/b.test.js > b passe',
      'tests/c.test.js > c passe',
    ]);
    const defaut = lu(lireSortieDeTest(sortie('vitest-defaut-propre.txt')));
    expect(defaut).toMatchObject({ nommeLesVerts: false, succes: [] });
  });

  it('vitest : l’empreinte d’un échec est son message — valeurs comprises, sans emplacement', () => {
    const issue = lireSortieDeTest(sortie('vitest-defaut-propre.txt'));
    expect(empreinteDe(issue, 'tests/a.test.js > suite A > echoue')).toBe(
      'AssertionError: expected 1 to be 2 // Object.is equality ⏎ - Expected ⏎ + Received ⏎ - 2 ⏎ + 1',
    );
    expect(empreinteDe(issue, 'tests/b.test.js > crochet')).toBe('Error: beforeAll casse');
  });

  it.each(['jest-defaut.txt', 'jest-verbose.txt'])(
    'jest (%s) : les titres ●, rattachés à leur fichier — couleurs ANSI des cadres comprises',
    (fichier) => {
      const issue = lireSortieDeTest(sortie(fichier));
      const lecture = lu(issue);
      expect(lecture.format).toBe('jest');
      expect(lecture.echecs).toEqual([
        'tests/a.test.js › suite A › echoue',
        'tests/b.test.js › b echoue',
      ]);
      // Jest ne nomme jamais un test vert : ses lignes ✓ ne sont pas lues.
      expect(lecture).toMatchObject({ succes: [], nommeLesVerts: false });
      expect(empreinteDe(issue, 'tests/a.test.js › suite A › echoue')).toBe(
        'expect(received).toBe(expected) // Object.is equality ⏎ Expected: 2 ⏎ Received: 1',
      );
    },
  );

  it('jest : un fichier qui ne se charge pas (« Test suite failed to run ») est un échec du fichier', () => {
    expect(lu(lireSortieDeTest(sortie('jest-suite-en-echec.txt'))).echecs).toContain(
      'tests/d.test.js › Test suite failed to run',
    );
  });

  it('node --test (spec) : suites imbriquées, crochet, annulé, délai, fichier illisible, sauté, à faire', () => {
    const issue = lireSortieDeTest(sortie('node-spec-propre.txt'));
    const lecture = lu(issue);
    expect(lecture.format).toBe('node-test');
    expect(lecture.echecs).toEqual([
      'b delai',
      'crochet',
      'crochet > jamais',
      'echoue',
      'externe',
      'externe > interne',
      'externe > interne > profond echoue',
      'groupe',
      'groupe > sous echoue',
      'test/d.test.js',
    ]);
    expect(lecture.succes).toEqual([
      'b avec console',
      'diagnostic',
      'externe > interne > profond passe',
      'groupe > sous passe',
      'passe',
      'suite B',
      'suite B > b passe',
    ]);
    // Sautés et « à faire » (même rouges : ⚠) ne disent rien du comportement.
    const tous = [...lecture.echecs, ...lecture.succes];
    for (const nom of ['saute', 'saute avec raison', 'a faire', 'a faire vert']) {
      expect(tous).not.toContain(nom);
    }
    // Le fichier vient de la section « failing tests » ; une suite rouge par
    // ses seuls enfants l'est par eux.
    expect(empreinteDe(issue, 'echoue')).toBe(
      'test/a.test.js — AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: ⏎ 1 !== 2',
    );
    expect(empreinteDe(issue, 'groupe')).toBe('sous-tests en échec');
  });

  it('node --test (spec) avec `--experimental-test-coverage` : le rapport du runner, entre résumé et échecs, se lit', () => {
    expect(sortie('node-spec-couverture.txt')).toContain('ℹ start of coverage report');
    expect(lu(lireSortieDeTest(sortie('node-spec-couverture.txt')))).toMatchObject({
      echecs: ['ko'],
      succes: ['ok'],
    });
  });

  it('node --test (TAP) : sous-tests rangés sous leur parent, blocs YAML lus pour l’empreinte', () => {
    const issue = lireSortieDeTest(sortie('node-tap.txt'));
    const lecture = lu(issue);
    expect(lecture.format).toBe('tap');
    expect(lecture.echecs).toEqual(['echoue', 'groupe', 'groupe > sous echoue']);
    expect(lecture.succes).toEqual([
      'groupe > sous passe',
      'passe',
      'suite B',
      'suite B > b passe',
    ]);
    expect(empreinteDe(issue, 'groupe > sous echoue')).toBe(
      "location: '/hive/tache/test/a.test.js' ⏎ failureType: 'testCodeFailure' ⏎ error: 'boum' ⏎ code: 'ERR_TEST_FAILURE'",
    );
  });

  it('tape : une assertion par ligne, nommée par son message — sautée et « à faire » écartées', () => {
    const issue = lireSortieDeTest(sortie('tape.txt'));
    expect(lu(issue)).toEqual({
      format: 'tap',
      echecs: ['bug connu'],
      succes: ['contient b', 'un plus un'],
      nommeLesVerts: true,
    });
    expect(empreinteDe(issue, 'bug connu')).toBe(
      'operator: equal ⏎ expected: 5 ⏎ actual:   4 ⏎ at: Test.<anonymous> (/hive/tache/test/a.js)',
    );
  });
});

describe('B1 — ce que la tête imprime ne renomme ni n’efface un échec : la sortie devient illisible', () => {
  it('node --test : une écriture sans fin de ligne collée devant ✖ (sortie réelle)', () => {
    // `exports.somme = (a, b) => { process.stdout.write('.'); return a - b; }`
    expect(sortie('node-spec-colle.txt')).toContain('.✖ additionne (');
    expect(lireSortieDeTest(sortie('node-spec-colle.txt'))).toEqual(illisible('ligne_douteuse'));
  });

  it('node --test : une ligne de résultat imprimée par un test (sortie réelle) ne se compte pas en plus', () => {
    // `✖ faux injecte` : imprimée par le test — sans durée, en trop dans le compte.
    expect(sortie('node-spec.txt')).toContain('✖ faux injecte\n');
    expect(lireSortieDeTest(sortie('node-spec.txt'))).toEqual(illisible('incoherente'));
  });

  it('node --test : un espace collé devant décale l’arbre — l’indentation est la structure', () => {
    const texte = sortie('node-spec-propre.txt').replace('✖ echoue (', '  ✖ echoue (');
    expect(lireSortieDeTest(texte)).toEqual(illisible('incoherente'));
  });

  it('node --test : un échec que l’arbre ne montre plus est encore dans « failing tests » — recoupé', () => {
    const texte = sortie('node-spec-propre.txt').replace('✖ b delai (', '✔ b delai (');
    expect(lireSortieDeTest(texte).lisible).toBe(false);
  });

  it('node --test : un faux résumé imprimé par un test rend la sortie illisible', () => {
    const texte = sortie('node-spec-propre.txt').replace(
      'journal du test b',
      'journal du test b\nℹ tests 1\nℹ fail 0',
    );
    expect(lireSortieDeTest(texte)).toEqual(illisible('incoherente'));
  });

  it.each(['vitest-defaut.txt', 'vitest-verbose.txt', 'vitest-suite-en-echec.txt'])(
    'vitest (%s) : « × faux > injecte », imprimé par un test, rend la sortie illisible (sortie réelle)',
    (fichier) => {
      expect(sortie(fichier)).toContain('\n× faux > injecte\n');
      expect(lireSortieDeTest(sortie(fichier))).toEqual(illisible('ligne_douteuse'));
    },
  );

  it('vitest : une ligne ` FAIL` de plus que les bannières n’en annoncent', () => {
    const texte = sortie('vitest-defaut-propre.txt').replace(
      ' FAIL  tests/b.test.js > b echoue',
      ' FAIL  tests/b.test.js > b echoue\n FAIL  tests/z.test.js > imprime par un test',
    );
    expect(lireSortieDeTest(texte)).toEqual(illisible('incoherente'));
  });

  it('vitest verbose : un test de moins dans l’arbre que dans le résumé', () => {
    const texte = sortie('vitest-verbose-propre.txt').replace(
      ' ✓ tests/c.test.js > c passe',
      '. ✓ tests/c.test.js > c passe',
    );
    expect(lireSortieDeTest(texte)).toEqual(illisible('ligne_douteuse'));
  });

  it('jest : un titre ● de trop, ou un test compté sans titre', () => {
    const deTrop = sortie('jest-defaut.txt').replace(
      '  ● b echoue',
      '  ● b echoue\n\n  ● titre imprime par un test',
    );
    expect(lireSortieDeTest(deTrop)).toEqual(illisible('incoherente'));
    const manquant = sortie('jest-defaut.txt').replace(
      'Tests:       2 failed, 1 skipped, 1 todo, 4 passed, 8 total',
      'Tests:       3 failed, 1 skipped, 1 todo, 3 passed, 8 total',
    );
    expect(lireSortieDeTest(manquant)).toEqual(illisible('incoherente'));
    const colle = sortie('jest-defaut.txt').replace('  ● b echoue', '.  ● b echoue');
    expect(lireSortieDeTest(colle)).toEqual(illisible('ligne_douteuse'));
  });

  it('tape : un `console.log("# ancien")` ne range plus l’assertion cassée sous un vieux rouge (sortie réelle)', () => {
    // Le commentaire `# nom` n'est plus lu : les deux assertions portent le
    // même message par défaut, et ne désignent plus rien.
    expect(sortie('tape-commentaire.txt')).toContain('# calcul\n# ancien\nnot ok 2');
    expect(lireSortieDeTest(sortie('tape-commentaire.txt'))).toEqual(illisible('nom_douteux'));
  });

  it('TAP : un résultat collé derrière du texte, ou un bloc YAML qui n’est pas sous un résultat', () => {
    const colle = sortie('tape.txt').replace('ok 2 un plus un', '.ok 2 un plus un');
    expect(lireSortieDeTest(colle)).toEqual(illisible('ligne_douteuse'));
    const yaml = sortie('tape.txt').replace('# chaines', '# chaines\n  ---');
    expect(lireSortieDeTest(yaml)).toEqual(illisible('ligne_douteuse'));
  });

  it('TAP (node) : « Subtest: x » imprimé par un test ne renomme aucun sous-test', () => {
    const texte = sortie('node-tap.txt').replace(
      '# Subtest: echoue\n',
      '# Subtest: echoue\n# Subtest: un test déjà rouge à la base\n',
    );
    expect(lireSortieDeTest(texte)).toEqual(illisible('incoherente'));
  });
});

describe('B2 — un échec que la sortie ne nomme pas ne disparaît pas : la sortie doit être complète', () => {
  it('vitest : des erreurs hors des tests (« Errors 1 error ») — sortie réelle', () => {
    expect(sortie('vitest-erreurs-non-gerees.txt')).toMatch(/^ {5}Errors {2}1 error$/m);
    expect(lireSortieDeTest(sortie('vitest-erreurs-non-gerees.txt'))).toEqual(
      illisible('incomplete'),
    );
  });

  it('vitest : `bail: 1` — un fichier compté (2) que rien ne range : il n’a pas tourné (sortie réelle)', () => {
    expect(sortie('vitest-bail.txt')).toContain(' Test Files  1 failed (2)');
    expect(lireSortieDeTest(sortie('vitest-bail.txt'))).toEqual(illisible('incomplete'));
  });

  it('jest : « 1 of 2 total » — un fichier n’a pas tourné', () => {
    const texte = sortie('jest-defaut.txt').replace(
      'Test Suites: 2 failed, 2 total',
      'Test Suites: 2 failed, 2 of 3 total',
    );
    expect(lireSortieDeTest(texte)).toEqual(illisible('incomplete'));
  });

  it('tape qui plante : ni plan, ni résumé (sortie réelle)', () => {
    expect(sortie('tape-plante.txt')).not.toMatch(/^1\.\.\d+$/m);
    expect(lireSortieDeTest(sortie('tape-plante.txt'))).toEqual(illisible('incomplete'));
  });

  it('TAP : un plan qui ne compte pas les résultats, un résumé qui ne les compte pas', () => {
    expect(lireSortieDeTest(sortie('tape.txt').replace('1..5', '1..6'))).toEqual(
      illisible('incomplete'),
    );
    expect(lireSortieDeTest(sortie('tape.txt').replace('# fail  1', '# fail  2'))).toEqual(
      illisible('incoherente'),
    );
  });

  it('node --test : un résumé dont les cases ne font pas le total', () => {
    const texte = sortie('node-spec-propre.txt').replace('ℹ tests 17', 'ℹ tests 18');
    expect(lireSortieDeTest(texte)).toEqual(illisible('incomplete'));
  });
});

describe('B3, I4 — un nom ne désigne qu’un test, et une directive n’est qu’une directive', () => {
  it('node --test : le même titre dans deux fichiers — un nom en double ne désigne plus rien (sortie réelle)', () => {
    expect(lireSortieDeTest(sortie('node-spec-meme-titre.txt'))).toEqual(illisible('nom_douteux'));
  });

  it('node --test : « # SKIP » ou « # TODO » DANS un titre n’en font pas une directive (sortie réelle)', () => {
    const lecture = lu(lireSortieDeTest(sortie('node-spec-titre-directive.txt')));
    expect(lecture.echecs).toEqual(['calcul # SKIP', 'verifie # TODO']);
  });

  it('un nom qui porte un contrôle ou un contrôle bidirectionnel ne se lit pas', () => {
    const rlo = String.fromCharCode(0x202e);
    const texte = sortie('jest-defaut.txt').replaceAll('b echoue', `b ${rlo}euohce`);
    expect(lireSortieDeTest(texte)).toEqual(illisible('nom_douteux'));
    expect(CARACTERES_DOUTEUX.test(`a${String.fromCharCode(0x2066)}b`)).toBe(true);
    expect(CARACTERES_DOUTEUX.test('a\tb')).toBe(true);
    expect(CARACTERES_DOUTEUX.test('2 × 3 = 6')).toBe(false);
  });
});

describe('lireSortieDeTest — ce qui ne se lit pas rend le verdict au script', () => {
  it('un runner inconnu (mocha) : non reconnu', () => {
    expect(lireSortieDeTest('  1 passing (4ms)\n  1 failing\n\n  1) suite\n       x:\n')).toEqual(
      illisible('non_reconnue'),
    );
  });

  it('deux runners dans la même sortie : on ne sait plus qui parle', () => {
    const texte = `${sortie('vitest-defaut-propre.txt')}\nTAP version 13\nnot ok 1 - autre\n`;
    expect(lireSortieDeTest(texte)).toEqual(illisible('formats_multiples'));
  });

  it('TAP : « Bail out! » — le producteur a abandonné', () => {
    expect(
      lireSortieDeTest(sortie('tape.txt').replace('ok 3 contient b', 'Bail out! base absente')),
    ).toEqual(illisible('interrompue'));
  });
});

describe('echecDeTestLu — le seul lecteur de G11a et de G11b', () => {
  it('lit les marques larges de G11a, et les échecs nommés par les lecteurs', () => {
    expect(echecDeTestLu('AssertionError: expected 1 to be 2')).toBe(true);
    expect(echecDeTestLu('src/a.ts(1,1): error TS2322: nope')).toBe(true);
    expect(echecDeTestLu(sortie('node-spec-propre.txt'))).toBe(true);
    // Même collé, un échec se compte : `ℹ fail` le redit.
    expect(echecDeTestLu('.✖ additionne (1ms)\nℹ fail 1')).toBe(true);
    expect(echecDeTestLu('Killed')).toBe(false);
  });

  it('une marque d’échec colorée (ANSI) reste une marque d’échec', () => {
    expect(echecDeTestLu('\u001b[31m✖\u001b[39m un test rouge')).toBe(true);
  });
});

/** Une exécution : ses rouges (avec leur empreinte) et ses verts. */
function execution(
  echecs: Record<string, string>,
  succes: string[] = [],
  nommeLesVerts = true,
): ObservationDeTests {
  return { echecs: new Map(Object.entries(echecs)), succes: new Set(succes), nommeLesVerts };
}

/** La comparaison quand elle se fait ; l'échec du banc sinon. */
function compare(tete: ObservationDeTests[], base: ObservationDeTests[]) {
  const issue = comparerALaBase(tete, base);
  if (!issue.comparable) throw new Error(`incomparable : ${issue.motif} (${issue.test})`);
  return issue.comparaison;
}

describe('comparerALaBase — FAIL_TO_PASS / PASS_TO_PASS (SWE-bench), la base pour référence', () => {
  it('rouge à la base ET à la tête, du même échec : déjà rouge, pas une régression (FAIL_TO_FAIL)', () => {
    expect(compare([execution({ ancien: 'e' })], [execution({ ancien: 'e' })])).toEqual({
      regressions: [],
      dejaRouges: ['ancien'],
      instables: [],
      ciblesPassees: [],
    });
  });

  it('I3 — même nom, autre échec : rien n’est excusé, la comparaison s’arrête', () => {
    expect(
      comparerALaBase([execution({ calcul: '0 !== 5' })], [execution({ calcul: '4 !== 5' })]),
    ).toEqual({ comparable: false, motif: 'autre_echec', test: 'calcul' });
    // Une empreinte inconnue ne se compare pas davantage.
    expect(comparerALaBase([execution({ x: '' })], [execution({ x: '' })])).toMatchObject({
      comparable: false,
      motif: 'autre_echec',
    });
  });

  it('rouge à chaque exécution de la tête, à aucune de la base : régression (PASS_TO_PASS cassé)', () => {
    const c = compare(
      [execution({ casse: 'a', ancien: 'e' }), execution({ casse: 'a', ancien: 'e' })],
      [execution({ ancien: 'e' }, ['casse']), execution({ ancien: 'e' }, ['casse'])],
    );
    expect(c.regressions).toEqual(['casse']);
    expect(c.dejaRouges).toEqual(['ancien']);
  });

  it('un test ABSENT de la base et rouge à la tête bloque comme une régression', () => {
    expect(compare([execution({ nouveau: 'x' })], [execution({})]).regressions).toEqual([
      'nouveau',
    ]);
  });

  it('rouge puis VU vert d’une exécution de la tête à l’autre : instable, ni régression ni vert', () => {
    const c = compare([execution({ vacille: 'x' }), execution({}, ['vacille'])], [execution({})]);
    expect(c).toMatchObject({ regressions: [], instables: ['vacille'] });
  });

  it('I1 — rouge à une exécution de la tête, ABSENT de l’autre (un titre qui porte une graine) : pas instable, la comparaison s’arrête', () => {
    expect(
      comparerALaBase(
        [execution({ 'aléatoire 0.1': 'x' }), execution({ 'aléatoire 0.7': 'x' })],
        [execution({})],
      ),
    ).toEqual({ comparable: false, motif: 'rouge_disparu', test: 'aléatoire 0.1' });
  });

  it('I1 — une exécution qui ne nomme pas ses verts (jest) ne fait jamais d’un test un instable', () => {
    const jest = (echecs: Record<string, string>) => execution(echecs, [], false);
    expect(comparerALaBase([jest({ t: 'x' }), jest({})], [jest({})])).toEqual({
      comparable: false,
      motif: 'rouge_disparu',
      test: 't',
    });
  });

  it('I2 — rouge à UNE exécution de la base et VU vert à l’autre : la base ne s’en porte pas garante — instable', () => {
    const c = compare(
      [execution({ 'vacille-a-la-base': 'x' }), execution({ 'vacille-a-la-base': 'x' })],
      [execution({}, ['vacille-a-la-base']), execution({ 'vacille-a-la-base': 'x' })],
    );
    expect(c).toMatchObject({ regressions: [], dejaRouges: [], instables: ['vacille-a-la-base'] });
  });

  it('I2 — rouge à une exécution de la base, absent de l’autre : la comparaison s’arrête', () => {
    expect(
      comparerALaBase([execution({ t: 'x' })], [execution({ t: 'x' }), execution({}, [], false)]),
    ).toEqual({ comparable: false, motif: 'base_incertaine', test: 't' });
  });

  it('B2 — vu vert à la base, absent de la tête : elle n’a pas tout exécuté — la comparaison s’arrête', () => {
    expect(
      comparerALaBase([execution({ ancien: 'e' })], [execution({ ancien: 'e' }, ['jamais lancé'])]),
    ).toEqual({ comparable: false, motif: 'vert_disparu', test: 'jamais lancé' });
  });

  it('cible passée : rouge à la base et VU vert à la tête — un test disparu n’est pas réparé', () => {
    const c = compare(
      [execution({ autre: 'e' }, ['repare'])],
      [execution({ repare: 'r', disparu: 'd', autre: 'e' })],
    );
    expect(c.ciblesPassees).toEqual(['repare']);
    expect(c.dejaRouges).toEqual(['autre']);
  });

  it('les listes sont triées : un même constat se dit toujours de la même façon', () => {
    expect(compare([execution({ z: '1', a: '2', m: '3' })], [execution({})]).regressions).toEqual([
      'a',
      'm',
      'z',
    ]);
    expect(OBSERVATIONS).toBe(2);
  });
});

describe('sansSuitesRedites — dire sans redire', () => {
  it('une suite rouge à cause d’un de ses tests ne se dit pas en plus du test', () => {
    expect(sansSuitesRedites(['groupe', 'groupe > sous echoue', 'seul'])).toEqual([
      'groupe > sous echoue',
      'seul',
    ]);
    expect(sansSuitesRedites(['f › suite', 'f › suite › test'])).toEqual(['f › suite › test']);
    // « groupement » n'est pas sous « groupe ».
    expect(sansSuitesRedites(['groupe', 'groupement'])).toEqual(['groupe', 'groupement']);
  });
});
