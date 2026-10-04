// Les validations du bac — les décisions pures, et ce qui traverse le réseau.
//
// Ce banc protège trois frontières, chacune avec l'accident qu'elle empêche :
//
//   · le PLAN : le bac ne lance que ce que la BASE du dépôt déclare. Une
//     production qui réécrit son propre script de test (ou ses crochets) ne se
//     juge pas elle-même — son état reste `missing`, jamais `passed` ;
//   · le CONSTAT : seul un code rendu par la commande vaut verdict. Un délai,
//     un outil introuvable (127), un signal ne sont pas des échecs de la
//     production — les lire `failed` enverrait l'agent corriger du code sain ;
//   · la PANNE DU BAC : un code ≠ 0 rendu sur une signature d'infrastructure
//     (OOM, disque plein, DNS, démon), sans aucun échec de test lu, n'est pas
//     un verdict — `missing`, raison `environnement` (G11a) ;
//   · le PARSEUR : un rapport mal formé est abandonné, pas le résultat qui le
//     porte, et un couple état/raison hors table n'entre jamais.
//
// Le banc de bout en bout (`validations-bac-bout-en-bout.test.ts`) prouve le
// câblage ; celui du nœud (`validations-bac-noeud.test.ts`) les vrais lancements.

import { describe, expect, it } from 'vitest';
import { jugerPreparation } from '../src/shared/preparation.js';
import { parseClientMessage } from '../src/shared/protocol.js';
import {
  EXTRAIT_MAX,
  PREPARATIONS_PAR_LOCKFILE,
  controleApresLancement,
  controleDepuis,
  declareDesDependances,
  panneEnvironnement,
  planDeValidation,
  preparationDepuisLockfile,
  validationsBacDepuis,
  type ControleBac,
  type ValidationKey,
} from '../src/shared/validations-bac.js';

const SCRIPTS = {
  test: 'vitest run',
  typecheck: 'tsc --noEmit',
  build: 'vite build',
  lint: 'eslint .',
};

describe('planDeValidation — le projet déclare, à sa base', () => {
  it('lance les quatre scripts déclarés et inchangés — l’ordre des clés ne compte pas', () => {
    const { lint, ...reste } = SCRIPTS;
    const plan = planDeValidation(SCRIPTS, { lint, ...reste });
    expect(plan).toEqual({
      tests: { genre: 'lancer', script: 'test' },
      typecheck: { genre: 'lancer', script: 'typecheck' },
      build: { genre: 'lancer', script: 'build' },
      lint: { genre: 'lancer', script: 'lint' },
    });
  });

  it('dit « non applicable » pour ce que le projet ne déclare pas — et accepte type-check', () => {
    const base = { test: 'node --test', 'type-check': 'vue-tsc', 'lint:css': 'stylelint' };
    const plan = planDeValidation(base, base);
    expect(plan.tests).toEqual({ genre: 'lancer', script: 'test' });
    expect(plan.typecheck).toEqual({ genre: 'lancer', script: 'type-check' });
    // `lint:css` n'est pas LE lint du projet : deviner serait inventer.
    expect(plan.lint).toEqual({
      genre: 'constat',
      controle: { etat: 'not_applicable', raison: 'non_declare' },
    });
    expect(plan.build).toMatchObject({ controle: { etat: 'not_applicable' } });
  });

  it('sans manifeste à la base, rien n’est déclaré — même si la production en écrit un', () => {
    const plan = planDeValidation(null, SCRIPTS);
    for (const etape of Object.values(plan)) {
      expect(etape).toEqual({
        genre: 'constat',
        controle: { etat: 'not_applicable', raison: 'sans_manifeste' },
      });
    }
  });

  it('le script d’échec par défaut de npm init n’est pas une suite de tests', () => {
    const base = { test: 'echo "Error: no test specified" && exit 1' };
    expect(planDeValidation(base, base).tests).toEqual({
      genre: 'constat',
      controle: { etat: 'not_applicable', raison: 'test_par_defaut', script: 'test' },
    });
  });

  // LE BLOC ENTIER, pas le seul script choisi : `test` peut appeler un autre
  // script, et `npm ci` lance `prepare`/`postinstall` avant les validations.
  // Un script « sans rapport » ajouté compte aussi — décider qu'il l'est
  // serait deviner ce qu'il déclenche.
  it.each([
    ['le script lui-même', { ...SCRIPTS, test: 'true' }],
    ['un crochet pre ajouté', { ...SCRIPTS, pretest: 'node triche.js' }],
    ['un crochet post ajouté', { ...SCRIPTS, posttest: 'node triche.js' }],
    ['le script supprimé', { typecheck: 'tsc', build: 'vite build', lint: 'eslint .' }],
    [
      'un script qu’il appelle',
      { ...SCRIPTS, test: 'npm run unit', unit: 'true' },
      { ...SCRIPTS, test: 'npm run unit', unit: 'vitest run' },
    ],
    ['un script de cycle de vie ajouté', { ...SCRIPTS, prepare: 'node triche.js' }],
    ['un script quelconque ajouté', { ...SCRIPTS, format: 'prettier --write .' }],
  ])(
    'une production qui réécrit ses scripts (%s) n’est pas lancée : missing',
    (_cas, production, base: Record<string, string> = SCRIPTS) => {
      const plan = planDeValidation(base, production);
      for (const cle of ['tests', 'typecheck', 'build', 'lint'] as const) {
        expect(plan[cle]).toMatchObject({
          genre: 'constat',
          controle: { etat: 'missing', raison: 'declaration_reecrite' },
        });
      }
    },
  );

  it('un package.json supprimé ou illisible par la production réécrit tout ce qui était déclaré', () => {
    const plan = planDeValidation(SCRIPTS, null);
    for (const etape of Object.values(plan)) {
      expect(etape).toMatchObject({
        controle: { etat: 'missing', raison: 'declaration_reecrite' },
      });
    }
  });
});

describe('préparation — ce que le lockfile déclare, jamais ce qu’une commande nomme', () => {
  it('chaque préparation dérivée d’un lockfile passe la garde des préparations', () => {
    for (const { argv } of PREPARATIONS_PAR_LOCKFILE) {
      expect(jugerPreparation(argv), argv.join(' ')).toEqual({ ok: true });
    }
  });

  it('suit le premier lockfile présent, et rien sans lockfile', () => {
    expect(preparationDepuisLockfile((f) => f === 'pnpm-lock.yaml')).toEqual([
      'pnpm',
      'install',
      '--frozen-lockfile',
    ]);
    expect(preparationDepuisLockfile((f) => f !== 'npm-shrinkwrap.json')).toEqual(['npm', 'ci']);
    expect(preparationDepuisLockfile(() => false)).toBeNull();
  });

  it('ne compte que des blocs de dépendances non vides', () => {
    expect(declareDesDependances({ devDependencies: { vitest: '^3' } })).toBe(true);
    expect(declareDesDependances({ dependencies: {}, scripts: { test: 'x' } })).toBe(false);
    expect(declareDesDependances(null)).toBe(false);
  });
});

describe('controleApresLancement — ce qui est un verdict, et ce qui n’en est pas un', () => {
  const lance = { script: 'test', dureeMs: 1_200, sortie: 'sortie du test\nFAIL x' };

  it('0 : passed, sans extrait ; autre code : failed, avec la fin de sortie', () => {
    expect(controleApresLancement({ ...lance, code: 0 })).toEqual({
      etat: 'passed',
      raison: 'termine',
      script: 'test',
      dureeMs: 1_200,
      code: 0,
    });
    expect(controleApresLancement({ ...lance, code: 1 })).toMatchObject({
      etat: 'failed',
      raison: 'termine',
      code: 1,
      extrait: 'sortie du test\nFAIL x',
    });
  });

  it.each([
    [{ code: 127 }, 'outil_introuvable'],
    [{ code: 126 }, 'outil_introuvable'],
    [{ code: null }, 'signal'],
    [{ code: null, arret: 'delai' as const }, 'delai'],
    [{ code: 1, arret: 'lancement' as const }, 'lancement'],
    [{ code: null, arret: 'annule' as const }, 'annule'],
  ])('%j : missing (%s) — l’environnement n’a pas permis de conclure', (issue, raison) => {
    expect(controleApresLancement({ ...lance, ...issue })).toMatchObject({
      etat: 'missing',
      raison,
    });
  });

  it('ne garde que la FIN d’une sortie trop longue', () => {
    const sortie = `${'a'.repeat(EXTRAIT_MAX)}FIN`;
    const { extrait } = controleApresLancement({ ...lance, code: 2, sortie });
    expect(extrait).toHaveLength(EXTRAIT_MAX);
    expect(extrait?.endsWith('FIN')).toBe(true);
  });
});

describe('panneEnvironnement — la panne du bac, jamais l’échec d’un test', () => {
  it.each([
    ['memoire', 1, 'Error: spawn ENOMEM'],
    ['memoire', 1, 'fork: Cannot allocate memory'],
    ['memoire', 137, '> vitest run\n\nKilled'],
    ['disque', 1, 'Error: ENOSPC: no space left on device, write'],
    ['disque', 1, 'cp: error writing: No space left on device'],
    ['dns', 1, 'Error: getaddrinfo EAI_AGAIN registry.npmjs.org'],
    ['dns', 1, 'curl: (6) Temporary failure in name resolution'],
    ['demon', 125, 'docker: Cannot connect to the Docker daemon at unix:///var/run/docker.sock.'],
    ['demon', 1, 'Error response from daemon: container is not running'],
    ['affichage', 1, 'Error: cannot open display: :0'],
  ])('%s — code %i : %j', (panne, code, sortie) => {
    expect(panneEnvironnement(code, sortie)).toBe(panne);
    expect(controleApresLancement({ script: 'test', code, dureeMs: 5, sortie })).toMatchObject({
      etat: 'missing',
      raison: 'environnement',
      panne,
      code,
    });
  });

  // La signature ne se lit QUE sans échec de test lu : chaque runner courant
  // qui imprime la sienne à côté d'un message d'infrastructure garde `failed`.
  it.each([
    ['assertion', 'Cannot allocate memory\nAssertionError [ERR_ASSERTION]: 1 == 2'],
    ['vitest', 'ENOSPC\n Test Files  1 failed (1)\n      Tests  1 failed | 3 passed (4)'],
    ['jest', 'FAIL src/a.test.js\nNo space left on device'],
    ['mocha', 'EAI_AGAIN\n  2 passing\n  1 failing'],
    ['node --test', '# tests 3\n# pass 2\n# fail 1\nCannot allocate memory'],
    ['TAP', 'not ok 2 - lit le disque\nENOSPC'],
    ['tsc', "src/a.ts(3,1): error TS2322: Type 'x'\nENOSPC"],
    ['ESLint', '✖ 3 problems (3 errors, 0 warnings)\nENOMEM'],
    ['ava (ligne)', '  ✘ [fail]: lit le fichier\n  Error: spawn ENOMEM (mocked)'],
    ['ava (compte)', '  Error: spawn ENOMEM (mocked)\n\n  1 test failed'],
    ['bun (ligne)', '(fail) lit le disque [0.12ms]\nENOSPC'],
    ['bun (compte)', 'EAI_AGAIN\n 3 pass\n 1 fail\nRan 4 tests across 1 files.'],
  ])('%s : un échec lu reste un verdict', (_runner, sortie) => {
    expect(panneEnvironnement(1, sortie)).toBeNull();
    expect(controleApresLancement({ script: 'test', code: 1, dureeMs: 5, sortie })).toMatchObject({
      etat: 'failed',
      raison: 'termine',
    });
  });

  // Le plafond de TAS d'un processus est le plus souvent atteint par la
  // production elle-même (une allocation sans borne) : il reste un verdict,
  // l'agent est renvoyé corriger — jamais l'opérateur libérer de la mémoire.
  it.each([
    [
      'V8',
      134,
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
    ],
    ['JVM', 1, 'Exception in thread "main" java.lang.OutOfMemoryError: Java heap space'],
  ])('le tas plein (%s) n’est pas une panne du bac', (_tas, code, sortie) => {
    expect(panneEnvironnement(code, sortie)).toBeNull();
    expect(controleApresLancement({ script: 'test', code, dureeMs: 5, sortie })).toMatchObject({
      etat: 'failed',
      raison: 'termine',
    });
  });

  it('« Failed to connect to the bus » est le bruit de Chromium sans écran, pas une panne', () => {
    const sortie =
      '[ERROR:bus.cc(407)] Failed to connect to the bus: Could not parse server address\n' +
      'Error: expected title "Hive" got ""';
    expect(panneEnvironnement(1, sortie)).toBeNull();
  });

  it('ni sur un code 0, ni « Killed » sans le SIGKILL qui l’accompagne, ni sur une adresse mal écrite', () => {
    expect(panneEnvironnement(0, 'Cannot allocate memory')).toBeNull();
    expect(panneEnvironnement(1, 'Killed')).toBeNull();
    expect(panneEnvironnement(1, 'Error: getaddrinfo ENOTFOUND api.exemple.invalid')).toBeNull();
    expect(panneEnvironnement(1, 'Cannot find module ./absent')).toBeNull();
  });
});

describe('ce qui traverse le réseau et le journal', () => {
  const controle = (etat: ControleBac['etat'], extra: Partial<ControleBac> = {}): ControleBac =>
    etat === 'passed'
      ? { etat, raison: 'termine', script: 'test', code: 0, dureeMs: 10, ...extra }
      : etat === 'failed'
        ? { etat, raison: 'termine', script: 'lint', code: 1, extrait: 'x', ...extra }
        : etat === 'missing'
          ? { etat, raison: 'delai', script: 'build', ...extra }
          : { etat, raison: 'non_declare', ...extra };
  const rapport = (controles: Partial<Record<ValidationKey, unknown>> = {}) => ({
    baseSha: 'a'.repeat(40),
    controles: {
      tests: controle('passed'),
      typecheck: controle('not_applicable'),
      build: controle('missing'),
      lint: controle('failed'),
      ...controles,
    },
  });

  it('reconstruit un rapport valide, champ par champ', () => {
    const brut = rapport();
    const intrus = { ...brut, verdict: 'accepted', controles: { ...brut.controles } };
    (intrus.controles.tests as unknown as Record<string, unknown>).pirate = 'oui';
    const lu = validationsBacDepuis(intrus);
    expect(lu).toEqual(rapport());
    expect(lu).not.toHaveProperty('verdict');
  });

  it.each([
    ['un état que la raison n’autorise pas', { tests: { etat: 'passed', raison: 'non_declare' } }],
    [
      'un non applicable qui prétend avoir tourné',
      { tests: { etat: 'not_applicable', raison: 'termine' } },
    ],
    ['un vert sans code 0', { tests: { etat: 'passed', raison: 'termine', code: 1 } }],
    ['un rouge avec code 0', { lint: { etat: 'failed', raison: 'termine', code: 0 } }],
    ['un rouge sans le code qui le fonde', { lint: { etat: 'failed', raison: 'termine' } }],
    ['une raison inconnue', { tests: { etat: 'missing', raison: 'parce_que' } }],
    [
      'un nom de script qui est un drapeau',
      { build: { etat: 'missing', raison: 'delai', script: '--x' } },
    ],
    ['une validation absente', { typecheck: undefined }],
    [
      'une panne d’environnement qui ne dit pas laquelle',
      { tests: { etat: 'missing', raison: 'environnement', script: 'test', code: 137 } },
    ],
    [
      'une panne inconnue',
      { tests: { etat: 'missing', raison: 'environnement', panne: 'lune', script: 'test' } },
    ],
    [
      'une panne portée par une autre raison',
      { build: { etat: 'missing', raison: 'delai', panne: 'memoire', script: 'build' } },
    ],
  ])('refuse %s', (_cas, controles) => {
    expect(validationsBacDepuis(rapport(controles))).toBeNull();
  });

  it('une panne d’environnement traverse avec sa panne, et rien d’autre', () => {
    const panne = {
      etat: 'missing',
      raison: 'environnement',
      panne: 'disque',
      script: 'build',
      code: 1,
      extrait: 'ENOSPC',
    } as const;
    expect(validationsBacDepuis(rapport({ build: panne }))?.controles.build).toEqual(panne);
  });

  it('refuse un commit de base qui n’en est pas un, et borne l’extrait par la fin', () => {
    expect(validationsBacDepuis({ ...rapport(), baseSha: 'HEAD; rm -rf /' })).toBeNull();
    const long = controleDepuis({ ...controle('failed'), extrait: `${'b'.repeat(5_000)}FIN` });
    expect(long?.extrait).toHaveLength(EXTRAIT_MAX);
    expect(long?.extrait?.endsWith('FIN')).toBe(true);
  });

  it('task_result : un rapport mal formé est abandonné, pas la production qui le porte', () => {
    const message = (validations: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: 'task_result',
          taskId: 't1',
          success: true,
          diff: 'diff --git a/x b/x',
          logs: '',
          durationMs: 5,
          subAgents: [],
          validations,
        }),
      );
    expect(message(rapport())).toMatchObject({ type: 'task_result', validations: rapport() });
    const casse = message({ controles: { tests: { etat: 'passed', raison: 'termine' } } });
    expect(casse).toMatchObject({ type: 'task_result', taskId: 't1', success: true });
    expect(casse).not.toHaveProperty('validations');
  });
});
