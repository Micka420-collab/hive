// Le lecteur de la sortie des tests, et la comparaison à la base (G11b).
//
// Les sorties de `fixtures/sorties-de-tests/` sont RÉELLES : capturées sur
// vitest 4.1.11, jest 30.5.2 et Node 24.20, non-TTY et `CI=true` comme dans le
// bac, chemins remplacés par le montage du bac (`/hive/tache`). Ce banc
// vérifie que chacune se lit test par test — et surtout ce qui ne doit JAMAIS
// arriver : un échec que le runner imprime, et que la lecture manquerait.
// Manqué, il ne serait comparé à rien, et des échecs déjà rouges à la base à
// côté de lui feraient passer la production.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OBSERVATIONS,
  comparerALaBase,
  echecDeTestLu,
  lireSortieDeTest,
  sansSuitesRedites,
} from '../src/shared/lecture-tests.js';
import type { IssueDeLecture } from '../src/shared/lecture-tests.js';

const sortie = (fichier: string): string =>
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'sorties-de-tests', fichier), 'utf8');

/** La lecture d'une sortie lisible, en tableaux triés. */
function lu(issue: IssueDeLecture): { format: string; echecs: string[]; succes: string[] } {
  if (!issue.lisible) throw new Error(`illisible : ${issue.raison}`);
  return {
    format: issue.lecture.format,
    echecs: [...issue.lecture.echecs].sort(),
    succes: [...issue.lecture.succes].sort(),
  };
}

describe('lireSortieDeTest — les sorties par défaut des runners, telles qu’elles sont', () => {
  it.each(['vitest-defaut.txt', 'vitest-verbose.txt'])(
    'vitest (%s) : chaque échec nommé avec son fichier et ses suites',
    (fichier) => {
      const lecture = lu(lireSortieDeTest(sortie(fichier)));
      expect(lecture.format).toBe('vitest');
      expect(lecture.echecs).toEqual([
        'tests/a.test.js > suite A > echoue',
        'tests/b.test.js > b echoue',
      ]);
    },
  );

  it('vitest verbose : les tests VERTS sont nommés aussi — les seuls à pouvoir dire « cible passée »', () => {
    expect(lu(lireSortieDeTest(sortie('vitest-verbose.txt'))).succes).toEqual([
      'tests/a.test.js > hors suite',
      'tests/a.test.js > suite A > imbriquee > profond passe',
      'tests/a.test.js > suite A > passe',
      'tests/b.test.js > b passe',
      'tests/c.test.js > c passe',
    ]);
  });

  it('vitest : un fichier qui ne se charge pas est un échec à son nom, compté', () => {
    expect(lu(lireSortieDeTest(sortie('vitest-suite-en-echec.txt'))).echecs).toEqual([
      'tests/a.test.js > suite A > echoue',
      'tests/b.test.js > b echoue',
      'tests/d.test.js [ tests/d.test.js ]',
    ]);
  });

  it('vitest : ce qu’un test imprime (« × faux > injecte », sans l’espace du reporter) n’est pas lu', () => {
    // La ligne est dans la sortie, sous `stdout | …` : c'est la console du test.
    expect(sortie('vitest-defaut.txt')).toContain('× faux > injecte');
    expect(lu(lireSortieDeTest(sortie('vitest-defaut.txt'))).echecs).not.toContain(
      'faux > injecte',
    );
  });

  it.each(['jest-defaut.txt', 'jest-verbose.txt'])(
    'jest (%s) : les titres ●, rattachés à leur fichier — couleurs ANSI des cadres comprises',
    (fichier) => {
      const lecture = lu(lireSortieDeTest(sortie(fichier)));
      expect(lecture.format).toBe('jest');
      expect(lecture.echecs).toEqual([
        'tests/a.test.js › suite A › echoue',
        'tests/b.test.js › b echoue',
      ]);
      // Jest ne nomme jamais un test vert : ses lignes ✓ ne sont pas lues.
      expect(lecture.succes).toEqual([]);
    },
  );

  it('jest : un fichier qui ne se charge pas (« Test suite failed to run ») est un échec du fichier', () => {
    expect(lu(lireSortieDeTest(sortie('jest-suite-en-echec.txt'))).echecs).toContain(
      'tests/d.test.js › Test suite failed to run',
    );
  });

  it('node --test (spec, défaut de Node 24) : suites imbriquées, crochet en échec, fichier illisible', () => {
    const lecture = lu(lireSortieDeTest(sortie('node-spec.txt')));
    expect(lecture.format).toBe('node-test');
    expect(lecture.echecs).toEqual(
      expect.arrayContaining([
        'echoue',
        'groupe > sous echoue',
        'externe > interne > profond echoue',
        // Le `before` de « crochet » a échoué : ses tests et la suite le disent.
        'crochet > jamais',
        'crochet',
        'test/d.test.js',
      ]),
    );
    expect(lecture.succes).toEqual(expect.arrayContaining(['passe', 'suite B > b passe']));
    // Sauté et « à faire » ne disent rien du comportement.
    expect([...lecture.echecs, ...lecture.succes]).not.toContain('saute');
    expect([...lecture.echecs, ...lecture.succes]).not.toContain('suite B > b todo');
  });

  it('node --test (TAP) : sous-tests rangés sous leur parent, blocs YAML sautés', () => {
    const lecture = lu(lireSortieDeTest(sortie('node-tap.txt')));
    expect(lecture.format).toBe('tap');
    expect(lecture.echecs).toEqual(['echoue', 'groupe', 'groupe > sous echoue']);
    expect(lecture.succes).toEqual([
      'groupe > sous passe',
      'passe',
      'suite B',
      'suite B > b passe',
    ]);
  });
});

describe('lireSortieDeTest — un échec que le runner imprime n’est jamais manqué', () => {
  it('node --test : une suite qui échoue SEULE (crochet `after`), enfants verts, est lue rouge', () => {
    const texte = [
      '▶ suite',
      '  ✔ un (0.1ms)',
      '  ✔ deux (0.1ms)',
      '✖ suite (1.2ms)',
      'ℹ tests 2',
      'ℹ fail 0',
    ].join('\n');
    expect(lu(lireSortieDeTest(texte)).echecs).toEqual(['suite']);
  });

  it('node --test : un faux résumé imprimé par un test ne coupe pas la lecture — le DERNIER compte', () => {
    const texte = [
      '✔ avant (0.1ms)',
      'ℹ tests 1', // imprimé par le code testé
      '✖ apres (0.2ms)',
      'ℹ tests 2',
      'ℹ fail 1',
      '✖ failing tests:',
    ].join('\n');
    expect(lu(lireSortieDeTest(texte)).echecs).toEqual(['apres']);
  });

  it('vitest : un « FAIL » de plus que le résumé n’en compte rend la sortie illisible', () => {
    // Un test qui imprime une ligne de résumé : on ne sait plus ce que le
    // runner a vraiment compté — le verdict du script reprend la main.
    const texte = sortie('vitest-defaut.txt').replace(
      'stdout | tests/a.test.js > suite A > echoue',
      'stdout | tests/a.test.js > suite A > echoue\n FAIL  tests/z.test.js > imprime par un test',
    );
    expect(lireSortieDeTest(texte)).toEqual({ lisible: false, raison: 'incoherente' });
  });

  it('vitest : un échec compté au résumé mais nommé nulle part rend la sortie illisible', () => {
    const texte = sortie('vitest-defaut.txt').replace('Failed Tests 2', 'Failed Tests 3');
    expect(lireSortieDeTest(texte)).toEqual({ lisible: false, raison: 'incoherente' });
  });

  it('jest : un titre ● de trop, ou un test compté sans titre, rendent la sortie illisible', () => {
    const deTrop = sortie('jest-defaut.txt').replace(
      '  ● b echoue',
      '  ● b echoue\n\n  ● titre imprime par un test',
    );
    expect(lireSortieDeTest(deTrop)).toEqual({ lisible: false, raison: 'incoherente' });
    const manquant = sortie('jest-defaut.txt').replace(
      'Tests:       2 failed',
      'Tests:       3 failed',
    );
    expect(lireSortieDeTest(manquant)).toEqual({ lisible: false, raison: 'incoherente' });
  });

  it('TAP : un nom qui contient « # » est lu ; un `not ok … # TODO` n’est pas un échec', () => {
    const texte = [
      'TAP version 13',
      'not ok 1 - gère le # dans un nom',
      'not ok 2 - pas encore # TODO plus tard',
      'ok 3 - sauté # SKIP pas ici',
      '1..3',
    ].join('\n');
    expect(lu(lireSortieDeTest(texte))).toEqual({
      format: 'tap',
      echecs: ['gère le # dans un nom'],
      succes: [],
    });
  });

  it('TAP : un bloc YAML qui cite « not ok » ne compte pas ; « Bail out! » rend illisible', () => {
    const yaml = [
      'TAP version 13',
      'ok 1 - vrai',
      '  ---',
      '  message: |',
      '    not ok 9 - cité dans un message',
      '  ...',
      '1..1',
    ].join('\n');
    expect(lu(lireSortieDeTest(yaml)).echecs).toEqual([]);
    expect(lireSortieDeTest('TAP version 13\nok 1 - a\nBail out! base absente')).toEqual({
      lisible: false,
      raison: 'interrompue',
    });
  });

  it('TAP sans sous-tests (tape) : le test est son commentaire, rouge si une assertion l’est', () => {
    const texte = [
      'TAP version 13',
      '# additionne',
      'ok 1 should be equal',
      'not ok 2 should be equal',
      '# soustrait',
      'ok 3 should be equal',
      '1..3',
      '# tests 3',
      '# pass  2',
      '# fail  1',
    ].join('\n');
    expect(lu(lireSortieDeTest(texte))).toEqual({
      format: 'tap',
      echecs: ['additionne'],
      succes: ['soustrait'],
    });
  });
});

describe('lireSortieDeTest — ce qui ne se lit pas rend le verdict au script', () => {
  it('un runner inconnu (mocha) : non reconnu', () => {
    expect(lireSortieDeTest('  1 passing (4ms)\n  1 failing\n\n  1) suite\n       x:\n')).toEqual({
      lisible: false,
      raison: 'non_reconnue',
    });
  });

  it('deux runners dans la même sortie : on ne sait plus qui parle', () => {
    const texte = `${sortie('vitest-defaut.txt')}\nTAP version 13\nnot ok 1 - autre\n`;
    expect(lireSortieDeTest(texte)).toEqual({ lisible: false, raison: 'formats_multiples' });
  });

  it('un test à la fois vert et rouge dans une exécution : contradiction', () => {
    const texte = sortie('vitest-verbose.txt').replace(
      ' ✓ tests/c.test.js > c passe 1ms',
      ' ✓ tests/c.test.js > c passe 1ms\n ✓ tests/b.test.js > b echoue 1ms',
    );
    expect(lireSortieDeTest(texte)).toEqual({ lisible: false, raison: 'contradiction' });
  });
});

describe('echecDeTestLu — le seul lecteur de G11a et de G11b', () => {
  it('lit les marques larges de G11a, et les échecs nommés par les lecteurs', () => {
    expect(echecDeTestLu('AssertionError: expected 1 to be 2')).toBe(true);
    expect(echecDeTestLu('src/a.ts(1,1): error TS2322: nope')).toBe(true);
    expect(echecDeTestLu(sortie('node-spec.txt'))).toBe(true);
    expect(echecDeTestLu('Killed')).toBe(false);
  });

  it('une marque d’échec colorée (ANSI) reste une marque d’échec', () => {
    expect(echecDeTestLu('\u001b[31m✖\u001b[39m un test rouge')).toBe(true);
  });
});

describe('comparerALaBase — FAIL_TO_PASS / PASS_TO_PASS (SWE-bench), la base pour référence', () => {
  const tete = (echecs: string[], succes: string[] = []) => ({
    echecs: new Set(echecs),
    succes: new Set(succes),
  });

  it('rouge à la base ET à la tête : déjà rouge, pas une régression (FAIL_TO_FAIL)', () => {
    expect(comparerALaBase([tete(['ancien'])], [new Set(['ancien'])])).toEqual({
      regressions: [],
      dejaRouges: ['ancien'],
      instables: [],
      ciblesPassees: [],
    });
  });

  it('rouge à chaque exécution de la tête, jamais à la base : régression (PASS_TO_PASS cassé)', () => {
    const c = comparerALaBase(
      [tete(['casse', 'ancien']), tete(['casse', 'ancien'])],
      [new Set(['ancien']), new Set(['ancien'])],
    );
    expect(c.regressions).toEqual(['casse']);
    expect(c.dejaRouges).toEqual(['ancien']);
  });

  it('un test ABSENT de la base et rouge à la tête bloque comme une régression', () => {
    expect(comparerALaBase([tete(['nouveau'])], [new Set()]).regressions).toEqual(['nouveau']);
  });

  it('rouge puis vert d’une exécution à l’autre, jamais rouge à la base : instable, ni régression ni vert', () => {
    const c = comparerALaBase([tete(['vacille']), tete([], ['vacille'])], [new Set()]);
    expect(c).toMatchObject({ regressions: [], instables: ['vacille'] });
  });

  it('rouge à UNE exécution de la base suffit : la base ne s’en porte pas garante', () => {
    const c = comparerALaBase(
      [tete(['vacille-aussi-a-la-base']), tete(['vacille-aussi-a-la-base'])],
      [new Set(), new Set(['vacille-aussi-a-la-base'])],
    );
    expect(c).toMatchObject({ regressions: [], dejaRouges: ['vacille-aussi-a-la-base'] });
  });

  it('cible passée : rouge à la base et VU vert à la tête — un test disparu n’est pas réparé', () => {
    const c = comparerALaBase(
      [tete(['autre'], ['repare'])],
      [new Set(['repare', 'disparu', 'autre'])],
    );
    expect(c.ciblesPassees).toEqual(['repare']);
    expect(c.dejaRouges).toEqual(['autre']);
  });

  it('les listes sont triées : un même constat se dit toujours de la même façon', () => {
    expect(comparerALaBase([tete(['z', 'a', 'm'])], [new Set()]).regressions).toEqual([
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
