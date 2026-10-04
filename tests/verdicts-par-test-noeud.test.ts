// Les tests en échec, comparés à la base rejouée (G11b) — à la frontière du
// nœud : de vrais dépôts git, de vrais `npm run test` qui lancent `node
// --test` (le reporter `spec`, celui par défaut de Node 24 — l'image du bac),
// dans le faux moteur de `fixtures/faux-bac.ts` (POSIX). Rien n'est simulé
// d'autre : le lecteur lit ce que node imprime, la base est extraite par git.
//
// Le critère de preuve de la carte (lot 7.9), cas par cas :
//
//   · un test déjà rouge à la base, un diff sans rapport → `passed`, et le
//     test est DIT ;
//   · une régression introduite → `failed`, le test NOMMÉ ;
//   · un script dont la sortie ne se reconnaît pas → l'ancien verdict, et rien
//     de rejoué ;
//   · un test instable (rouge, puis vert à la relance) → ni régression, ni
//     vert : `missing`, raison `instable`.
//
// Et ce qui ne doit jamais arriver — un vert de plus : qu'un objet forgé par
// l'agent dans le `.git` de la tâche fasse rougir la base ; que ce que la
// production imprime efface ou renomme un échec ; qu'un runner arrêté en route
// passe pour complet ; que la seconde exécution hérite de ce que la première a
// laissé ; qu'une base qui vacille, ou en panne, excuse une régression ; qu'un
// même nom, pour un autre échec, passe pour « déjà rouge ». Chacun de ces cas
// est rejoué ici avec un VRAI runner (`node --test`, le vitest du dépôt),
// comme le relecteur de G11b les avait reproduits — et chacun rend le verdict
// du script, ou le bon : jamais `passed`.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { resoudreLanceur } from '../src/lanceur-reel.js';
import { poserRegistre } from '../src/node-client/git-hote.js';
import { memoireDesBases, validerProduction } from '../src/node-client/validations-bac.js';
import type { MemoireDesBases } from '../src/node-client/validations-bac.js';
import { gitHote } from '../src/shared/git-protege.js';
import { fauxBac } from './fixtures/faux-bac.js';

const dossiers: string[] = [];

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

const POSIX = process.platform !== 'win32';

/** `node --test`, comme un projet le déclare — rien d'inventé par la ruche. */
const PROJET = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: 'projet-g11b',
    version: '1.0.0',
    private: true,
    scripts: { test: 'node --test' },
    ...extra,
  });

/** Un test que la base laisse rouge : son module n'a jamais été réparé. */
const ANCIEN = {
  'src/ancien.js': "module.exports = 'cassé';\n",
  'test/ancien.test.js':
    "const test = require('node:test');\nconst assert = require('node:assert');\n" +
    "test('un test déjà rouge à la base', () => {\n" +
    "  assert.strictEqual(require('../src/ancien.js'), 'réparé');\n});\n",
};

/** Un test vert à la base — celui qu'une production peut casser. */
const CALCUL = {
  'src/calcul.js': 'exports.somme = (a, b) => a + b;\n',
  'test/calcul.test.js':
    "const test = require('node:test');\nconst assert = require('node:assert');\n" +
    "test('additionne', () => {\n  assert.strictEqual(require('../src/calcul.js').somme(2, 2), 4);\n});\n",
};

/**
 * Un dépôt, sa base committée — `preparer` passe avant le commit (un lockfile
 * à produire) — et son registre, comme `prepareWorkspace` le pose.
 */
async function depot(fichiers: Record<string, string>, preparer?: (dir: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-g11b-'));
  dossiers.push(dir, `${dir}.base`, `${dir}.base.tmp`, `${dir}.tmp`);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(dir, nom)), { recursive: true });
    writeFileSync(path.join(dir, nom), contenu);
  }
  preparer?.(dir);
  const git = simpleGit({ baseDir: dir });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  const base = (await git.revparse(['HEAD'])).trim();
  const registre = mkdtempSync(`${dir}.registre-`);
  dossiers.push(registre);
  return { dir, base, registre: await poserRegistre(dir, registre, base) };
}

/** La production : des fichiers réécrits dans l'arbre, comme le ferait un agent. */
function produire(dir: string, fichiers: Record<string, string>): void {
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(dir, nom)), { recursive: true });
    writeFileSync(path.join(dir, nom), contenu);
  }
}

async function valider(
  d: Awaited<ReturnType<typeof depot>>,
  extra: { memoire?: MemoireDesBases } = {},
) {
  const etapes: string[] = [];
  const rapport = await validerProduction({
    cwd: d.dir,
    depot: { depot: d.registre, baseSha: d.base },
    bac: fauxBac(dossiers),
    surEtape: (l) => etapes.push(l),
    ...extra,
  });
  return { tests: rapport.controles.tests, etapes };
}

const SURCOUT_ANNONCE =
  'rejouée à part (extraction, installation, build, tests : jusqu’à 25 min) ; si une régression ' +
  'reste possible, la production est rejouée de même depuis son arbre livré, puis la base une ' +
  'seconde fois — au pire 55 min de plus';

/** Le vitest du dépôt, lancé par son chemin : le projet du banc n'installe rien. */
const VITEST = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);

/** Un projet vitest — tests en globales, un seul fil : le banc tient dans peu de mémoire. */
const PROJET_VITEST = (config = '') => ({
  'package.json': JSON.stringify({
    name: 'projet-g11b-vitest',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { test: `node ${VITEST} run` },
  }),
  'vitest.config.mjs':
    "export default { test: { globals: true, include: ['test/**/*.test.js'], pool: 'threads', " +
    `maxWorkers: 1${config} } };\n`,
});

describe.runIf(POSIX)('G11b — les tests en échec, comparés à la base rejouée à part', () => {
  it('UN TEST DÉJÀ ROUGE À LA BASE, UN DIFF SANS RAPPORT : passed, et le test est dit', async () => {
    // Une dépendance locale (`file:`) avec son lockfile : la base est
    // INSTALLÉE à part, depuis son lockfile — jamais avec le `node_modules`
    // que les tests de la production ont eu entre les mains.
    const npm = resoudreLanceur('npm', ['install', '--no-audit', '--no-fund', '--offline']);
    const d = await depot(
      {
        ...ANCIEN,
        'dep-locale/package.json': JSON.stringify({ name: 'dep-locale', version: '1.0.0' }),
        'dep-locale/index.js': 'module.exports = 1;\n',
        'package.json': PROJET({ dependencies: { 'dep-locale': 'file:./dep-locale' } }),
        '.gitignore': 'node_modules\n',
      },
      (dir) => execFileSync(npm.bin, npm.args, { cwd: dir, stdio: 'ignore' }),
    );
    produire(d.dir, { 'src/autre.js': 'module.exports = "sans rapport";\n' });

    const { tests, etapes } = await valider(d);

    expect(tests).toMatchObject({
      etat: 'passed',
      raison: 'comparee',
      script: 'test',
      code: 1,
      comparaison: {
        format: 'node-test',
        executions: { tete: 1, base: 1 },
        memoire: false,
        regressions: { total: 0, noms: [] },
        dejaRouges: { total: 1, noms: ['un test déjà rouge à la base'] },
        instables: { total: 0, noms: [] },
      },
    });
    // Le surcoût est dit AVANT de lancer, la base s'installe à part, et
    // rien d'elle ne reste à côté de la tâche.
    expect(etapes.some((l) => l.includes(SURCOUT_ANNONCE))).toBe(true);
    expect(etapes.some((l) => /base [0-9a-f]{8} — installation « npm ci »/.test(l))).toBe(true);
    expect(etapes.at(-1)).toBe(
      'validation tests : passed (comparee : 1 déjà rouge(s) à la base, code 1)',
    );
    expect(existsSync(`${d.dir}.base`)).toBe(false);
  }, 90_000);

  it('UNE RÉGRESSION INTRODUITE : failed, le test nommé — vue deux fois de chaque côté', async () => {
    const d = await depot({ ...ANCIEN, ...CALCUL, 'package.json': PROJET() });
    produire(d.dir, { 'src/calcul.js': 'exports.somme = (a, b) => a - b;\n' });

    const { tests, etapes } = await valider(d);

    expect(tests).toMatchObject({
      etat: 'failed',
      raison: 'comparee',
      code: 1,
      comparaison: {
        executions: { tete: 2, base: 2 },
        regressions: { total: 1, noms: ['additionne'] },
        dejaRouges: { total: 1, noms: ['un test déjà rouge à la base'] },
      },
    });
    // La seconde exécution de la production rejoue son arbre LIVRÉ, à part.
    expect(
      etapes.some((l) => l.includes('la production est rejouée à part, depuis son arbre livré')),
    ).toBe(true);
    expect(
      etapes.some((l) =>
        l.startsWith('validation tests : production (arbre livré, à part) — npm run test'),
      ),
    ).toBe(true);
    expect(etapes.some((l) => l.includes('seconde exécution de la base'))).toBe(true);
    expect(etapes.at(-1)).toBe(
      'validation tests : failed (comparee : 1 régression(s), 1 déjà rouge(s) à la base, code 1)',
    );
    expect(existsSync(`${d.dir}.tete`)).toBe(false);
  }, 90_000);

  it('UN SCRIPT DONT LA SORTIE NE SE RECONNAÎT PAS : l’ancien verdict, et rien de rejoué', async () => {
    const d = await depot({
      'package.json': JSON.stringify({
        name: 'projet-g11b',
        version: '1.0.0',
        private: true,
        scripts: { test: `node -e "console.log('rien de lisible ici');process.exit(1)"` },
      }),
    });
    produire(d.dir, { 'src/autre.js': 'module.exports = 1;\n' });

    const { tests, etapes } = await valider(d);

    expect(tests).toMatchObject({ etat: 'failed', raison: 'termine', code: 1 });
    expect(tests).not.toHaveProperty('comparaison');
    expect(etapes.some((l) => l.includes('comparaison à la base'))).toBe(false);
    expect(etapes).toContain(
      'validation tests : sortie non lue test par test (non_reconnue) — verdict du script',
    );
    expect(existsSync(`${d.dir}.base`)).toBe(false);
  }, 60_000);

  it('UN TEST INSTABLE (rouge, puis vert à la relance) : signalé instable — ni régression, ni vert', async () => {
    // Le test échoue à sa toute première exécution, puis passe : sa marque vit
    // à côté du dépôt, hors du diff, partagée par la tête et la base rejouée.
    const marque = path.join(os.tmpdir(), `vacille-${randomUUID()}.vu`);
    dossiers.push(marque);
    const d = await depot({
      'package.json': PROJET(),
      'test/vacille.test.js':
        "const test = require('node:test');\nconst fs = require('node:fs');\n" +
        `test('vacille une fois', () => {\n  if (fs.existsSync(${JSON.stringify(marque)})) return;\n` +
        `  fs.writeFileSync(${JSON.stringify(marque)}, '');\n  throw new Error('premier passage');\n});\n`,
    });
    produire(d.dir, { 'src/autre.js': 'module.exports = 1;\n' });

    const { tests } = await valider(d);

    expect(tests).toMatchObject({
      etat: 'missing',
      raison: 'instable',
      code: 1,
      comparaison: {
        executions: { tete: 2, base: 1 },
        regressions: { total: 0 },
        instables: { total: 1, noms: ['vacille une fois'] },
      },
    });
  }, 90_000);

  it('UN OBJET FORGÉ dans le `.git` de la tâche ne fait pas rougir la base : rien n’est excusé', async () => {
    const d = await depot({ ...ANCIEN, ...CALCUL, 'package.json': PROJET() });
    const casse = 'exports.somme = (a, b) => a - b;\n';
    produire(d.dir, { 'src/calcul.js': casse });
    // L'agent réécrit, sous le nom du blob de BASE de `src/calcul.js`, l'objet
    // qui porte sa version cassée : lue telle quelle, la base échouerait aussi,
    // et la régression passerait pour « déjà rouge à la base ».
    const git = simpleGit({ baseDir: d.dir });
    const blob = (await git.revparse([`${d.base}:src/calcul.js`])).trim();
    const fichierForge = path.join(d.dir, 'objet-forge.js');
    writeFileSync(fichierForge, casse);
    const sha = execFileSync('git', ['hash-object', '-w', fichierForge], { cwd: d.dir })
      .toString()
      .trim();
    rmSync(fichierForge);
    const objet = (s: string) => path.join(d.dir, '.git', 'objects', s.slice(0, 2), s.slice(2));
    chmodSync(objet(blob), 0o644);
    copyFileSync(objet(sha), objet(blob));
    // La lecture directe par le registre rend bien la version forgée…
    expect(await gitHote(['cat-file', 'blob', `${d.base}:src/calcul.js`], d.registre)).toBe(casse);

    const { tests, etapes } = await valider(d);

    // …mais la base n'est pas lue ainsi : le `fetch` renomme chaque objet par
    // son contenu, l'objet forgé n'arrive pas sous le nom qu'il usurpe, et la
    // comparaison s'arrête — le verdict du script, bloquant, reste.
    expect(tests).toMatchObject({ etat: 'failed', raison: 'termine', code: 1 });
    expect(tests).not.toHaveProperty('comparaison');
    expect(etapes.some((l) => l.includes('pas rejouée : extraction impossible'))).toBe(true);
    expect(etapes).toContain('validation tests : pas de comparaison à la base — verdict du script');
    expect(existsSync(`${d.dir}.base`)).toBe(false);
  }, 90_000);

  it('LA MÉMOIRE DU NŒUD : une base déjà rejouée ne se rejoue pas', async () => {
    const memoire = memoireDesBases();
    const d = await depot({ ...ANCIEN, 'package.json': PROJET() });
    produire(d.dir, { 'src/autre.js': 'module.exports = 1;\n' });

    const premiere = await valider(d, { memoire });
    const seconde = await valider(d, { memoire });

    expect(premiere.tests.comparaison).toMatchObject({ memoire: false });
    expect(seconde.tests).toMatchObject({
      etat: 'passed',
      raison: 'comparee',
      comparaison: { memoire: true, executions: { tete: 1, base: 1 } },
    });
    expect(seconde.etapes.some((l) => l.includes('déjà rejouée sur ce nœud (mémoire)'))).toBe(true);
    expect(seconde.etapes.some((l) => l.includes(SURCOUT_ANNONCE))).toBe(false);
  }, 90_000);

  it('UNE SORTIE COUPÉE AU MILIEU ne se lit pas test par test : un échec a pu tomber dans le trou', async () => {
    const d = await depot({
      ...ANCIEN,
      'package.json': PROJET({
        scripts: { test: `node -e "process.stdout.write('x'.repeat(700000))" && node --test` },
      }),
    });
    produire(d.dir, { 'src/autre.js': 'module.exports = 1;\n' });

    const { tests } = await valider(d);

    expect(tests).toMatchObject({ etat: 'failed', raison: 'termine', code: 1 });
    expect(tests).not.toHaveProperty('comparaison');
  }, 60_000);
  it('ANNULÉE pendant la comparaison : la ligne de progression le dit, et le verdict du script reste', async () => {
    const d = await depot(SCENE());
    produire(d.dir, { 'src/calcul.js': 'exports.somme = (a, b) => a - b;\n' });
    const ctrl = new AbortController();
    const etapes: string[] = [];

    const rapport = await validerProduction({
      cwd: d.dir,
      depot: { depot: d.registre, baseSha: d.base },
      bac: fauxBac(dossiers),
      signal: ctrl.signal,
      surEtape: (l) => {
        etapes.push(l);
        if (l.includes('rejouée à part')) ctrl.abort();
      },
    });

    expect(rapport.controles.tests).toMatchObject({ etat: 'failed', raison: 'termine' });
    expect(etapes).toContain(
      'validation tests : tâche annulée pendant la comparaison à la base — verdict du script',
    );
    expect(existsSync(`${d.dir}.base`)).toBe(false);
  }, 60_000);
});

// ─── LES REPRODUCTIONS DU RELECTEUR (revue de G11b) ─────────────────────────
//
// Chacune faisait dire `passed` (ou `instable`) à une production qui casse
// quelque chose. Rejouées avec le vrai `validerProduction` et un vrai runner,
// elles rendent toutes le verdict du script — ou la régression, nommée.

/** Une base rouge sur un test, verte sur `additionne` : la scène des cas suivants. */
const SCENE = () => ({ ...ANCIEN, ...CALCUL, 'package.json': PROJET() });

describe.runIf(POSIX)(
  'G11b — ce que la production imprime ou laisse ne fait jamais un vert',
  () => {
    it('B1 — une écriture sans fin de ligne collée devant `✖` : la sortie ne se lit pas, verdict du script', async () => {
      const d = await depot(SCENE());
      produire(d.dir, {
        'src/calcul.js':
          "exports.somme = (a, b) => { process.stdout.write('.'); return a - b; };\n",
      });

      const { tests, etapes } = await valider(d);

      expect(tests).toMatchObject({ etat: 'failed', raison: 'termine', code: 1 });
      expect(tests).not.toHaveProperty('comparaison');
      expect(etapes).toContain(
        'validation tests : sortie non lue test par test (ligne_douteuse) — verdict du script',
      );
    }, 60_000);

    it('B3 — un nouveau test rouge, du même titre qu’un vieux rouge, dans un autre fichier : verdict du script', async () => {
      const d = await depot({
        ...ANCIEN,
        'src/calcul.js': CALCUL['src/calcul.js'],
        'package.json': PROJET(),
      });
      produire(d.dir, {
        'src/calcul.js': 'exports.somme = (a, b) => a - b;\n',
        'test/nouveau.test.js':
          "const test = require('node:test');\nconst assert = require('node:assert');\n" +
          "test('un test déjà rouge à la base', () => {\n" +
          "  assert.strictEqual(require('../src/calcul.js').somme(2, 2), 4);\n});\n",
      });

      const { tests, etapes } = await valider(d);

      expect(tests).toMatchObject({ etat: 'failed', raison: 'termine' });
      expect(etapes).toContain(
        'validation tests : sortie non lue test par test (nom_douteux) — verdict du script',
      );
    }, 60_000);

    it('I4 — « # SKIP » DANS un titre n’en fait pas une directive : la régression est nommée', async () => {
      const d = await depot({
        ...ANCIEN,
        'src/calcul.js': CALCUL['src/calcul.js'],
        'package.json': PROJET(),
      });
      produire(d.dir, {
        'src/calcul.js': 'exports.somme = (a, b) => a - b;\n',
        'test/nouveau.test.js':
          "const test = require('node:test');\nconst assert = require('node:assert');\n" +
          "test('calcul # SKIP', () => {\n" +
          "  assert.strictEqual(require('../src/calcul.js').somme(2, 2), 4);\n});\n",
      });

      const { tests } = await valider(d);

      expect(tests).toMatchObject({
        etat: 'failed',
        raison: 'comparee',
        comparaison: { regressions: { total: 1, noms: ['calcul # SKIP'] } },
      });
    }, 90_000);

    it('I1 — un marqueur laissé DANS l’arbre par la première exécution ne fait pas passer la seconde : régression', async () => {
      const d = await depot(SCENE());
      produire(d.dir, {
        'src/calcul.js':
          "const fs = require('fs');\nconst path = require('path');\n" +
          "const marque = path.join(__dirname, '..', '.marque');\n" +
          'exports.somme = (a, b) => {\n' +
          "  if (!fs.existsSync(marque)) { fs.writeFileSync(marque, ''); return a - b; }\n" +
          '  return a + b;\n};\n',
      });

      const { tests } = await valider(d);

      // Rejouée depuis son arbre LIVRÉ, la production ne trouve pas le marqueur.
      expect(tests).toMatchObject({
        etat: 'failed',
        raison: 'comparee',
        comparaison: {
          executions: { tete: 2, base: 2 },
          regressions: { total: 1, noms: ['additionne'] },
          instables: { total: 0 },
        },
      });
    }, 90_000);

    it('I1 — un titre qui porte une graine : rouge à une exécution, absent de l’autre — pas « instable », verdict du script', async () => {
      const d = await depot({ ...ANCIEN, 'package.json': PROJET() });
      produire(d.dir, {
        'test/aleatoire.test.js':
          "const test = require('node:test');\nconst assert = require('node:assert');\n" +
          "test('aléatoire ' + Math.random(), () => { assert.fail('toujours rouge'); });\n",
      });

      const { tests, etapes } = await valider(d);

      expect(tests).toMatchObject({ etat: 'failed', raison: 'termine' });
      expect(
        etapes.some((l) =>
          /« aléatoire 0\.\d+ », rouge à une exécution de la production, n’est pas vu à l’autre — pas de comparaison, verdict du script$/.test(
            l,
          ),
        ),
      ).toBe(true);
    }, 90_000);

    it('I2 — un test vert à la première exécution de la base, rouge à la seconde, cassé par la production : instable, et la base n’est pas gardée', async () => {
      const marque = path.join(os.tmpdir(), `vacille-base-${randomUUID()}.vu`);
      dossiers.push(marque);
      const memoire = memoireDesBases();
      const d = await depot({
        'package.json': PROJET(),
        'src/x.js':
          "const fs = require('fs');\n" +
          `module.exports = () => { if (fs.existsSync(${JSON.stringify(marque)})) return false; ` +
          `fs.writeFileSync(${JSON.stringify(marque)}, ''); return true; };\n`,
        'test/x.test.js':
          "const test = require('node:test');\nconst assert = require('node:assert');\n" +
          "test('vacille à la base', () => { assert.ok(require('../src/x.js')()); });\n",
      });
      produire(d.dir, { 'src/x.js': 'module.exports = () => false;\n' });

      const { tests } = await valider(d, { memoire });

      expect(tests).toMatchObject({
        etat: 'missing',
        raison: 'instable',
        comparaison: {
          executions: { tete: 2, base: 2 },
          dejaRouges: { total: 0 },
          instables: { total: 1, noms: ['vacille à la base'] },
        },
      });
      // Une base qui a vacillé ne s'en porte garante pour personne.
      expect(memoire.lire(d.base, 'node-test')).toEqual([]);
    }, 90_000);

    it('I2 — une exécution de la base en panne d’environnement n’excuse rien, et n’est pas gardée', async () => {
      const memoire = memoireDesBases();
      const d = await depot({
        'package.json': PROJET(),
        'src/x.js': "module.exports = () => !process.cwd().endsWith('.base');\n",
        'test/x.test.js':
          "const test = require('node:test');\nconst assert = require('node:assert');\n" +
          "test('mémoire', () => {\n" +
          "  if (process.cwd().endsWith('.base')) console.log('Error: Cannot allocate memory');\n" +
          "  assert.ok(require('../src/x.js')());\n});\n",
      });
      produire(d.dir, { 'src/x.js': 'module.exports = () => false;\n' });

      const { tests, etapes } = await valider(d, { memoire });

      expect(tests).toMatchObject({ etat: 'failed', raison: 'termine' });
      expect(
        etapes.some((l) => l.endsWith('sortie non retenue (panne d’environnement (memoire))')),
      ).toBe(true);
      expect(memoire.lire(d.base, 'node-test')).toEqual([]);
    }, 90_000);

    it('I3 — même nom, autre échec : rien n’est excusé, verdict du script', async () => {
      const d = await depot({
        'package.json': PROJET(),
        'src/calcul.js': CALCUL['src/calcul.js'],
        'test/calcul.test.js':
          "const test = require('node:test');\nconst assert = require('node:assert');\n" +
          "test('calcul', () => {\n  assert.strictEqual(require('../src/calcul.js').somme(2, 2), 5);\n});\n",
      });
      produire(d.dir, { 'src/calcul.js': 'exports.somme = (a, b) => a - b;\n' });

      const { tests, etapes } = await valider(d);

      expect(tests).toMatchObject({ etat: 'failed', raison: 'termine' });
      expect(etapes).toContain(
        'validation tests : « calcul » est rouge à la base, mais pas du même échec — pas de comparaison, verdict du script',
      );
    }, 90_000);

    it('B2 — vitest : des erreurs hors des tests (« Errors 1 error ») ne passent pas pour complètes', async () => {
      const d = await depot({
        ...PROJET_VITEST(),
        'src/calcul.js': 'export const somme = (a, b) => a + b;\n',
        'test/ancien.test.js': "test('ancien', () => { expect('cassé').toBe('réparé'); });\n",
        'test/calcul.test.js':
          "import { somme } from '../src/calcul.js';\ntest('additionne', () => { expect(somme(2, 2)).toBe(4); });\n",
      });
      produire(d.dir, {
        'src/calcul.js':
          "export const somme = (a, b) => { Promise.reject(new Error('rejet non géré')); return a + b; };\n",
      });

      const { tests, etapes } = await valider(d);

      expect(tests).toMatchObject({ etat: 'failed', raison: 'termine' });
      expect(etapes).toContain(
        'validation tests : sortie non lue test par test (incomplete) — verdict du script',
      );
    }, 90_000);

    it('B2 — vitest `bail: 1` : la régression qui n’a jamais tourné ne se cache pas derrière un vieux rouge', async () => {
      const d = await depot({
        ...PROJET_VITEST(', bail: 1, fileParallelism: false'),
        'src/calcul.js': 'export const somme = (a, b) => a + b;\n',
        // Le plus gros fichier passe le premier : c'est lui qui déclenche `bail`.
        'test/a-ancien.test.js': `${'// remplissage\n'.repeat(300)}test('ancien', () => { expect('cassé').toBe('réparé'); });\n`,
        'test/b-calcul.test.js':
          "import { somme } from '../src/calcul.js';\ntest('additionne', () => { expect(somme(2, 2)).toBe(4); });\n",
      });
      produire(d.dir, { 'src/calcul.js': 'export const somme = (a, b) => a - b;\n' });

      const { tests, etapes } = await valider(d);

      expect(tests).toMatchObject({ etat: 'failed', raison: 'termine' });
      expect(etapes).toContain(
        'validation tests : sortie non lue test par test (incomplete) — verdict du script',
      );
    }, 90_000);
  },
);

// La mémoire des bases est BORNÉE — c'est ce qui permet de la garder en
// mémoire, le temps de vie du nœud (voir `node-client/validations-bac.ts`).
describe('memoireDesBases — bornée, et oublieuse dans l’ordre', () => {
  const rouges = (...noms: string[]) => ({
    echecs: new Map(noms.map((n) => [n, `échec de ${n}`])),
    succes: new Set<string>(),
    nommeLesVerts: true,
  });

  it('au-delà de sa capacité, oublie la base la moins récemment servie', () => {
    const memoire = memoireDesBases(2);
    memoire.ranger('a', 'node-test', [rouges('x')]);
    memoire.ranger('b', 'node-test', [rouges('y')]);
    memoire.lire('a', 'node-test'); // « a » resservie : c'est « b » la plus ancienne
    memoire.ranger('c', 'node-test', [rouges('z')]);
    expect(memoire.lire('b', 'node-test')).toEqual([]);
    expect(memoire.lire('a', 'node-test')).toEqual([rouges('x')]);
    expect(memoire.lire('c', 'node-test')).toEqual([rouges('z')]);
  });

  it('garde au plus deux exécutions par base, et jamais une exécution trop rouge', () => {
    const memoire = memoireDesBases();
    memoire.ranger('a', 'node-test', [rouges('1'), rouges('2'), rouges('3')]);
    expect(memoire.lire('a', 'node-test')).toHaveLength(2);
    const tropRouge = rouges(...Array.from({ length: 1_001 }, (_, i) => `t${i}`));
    memoire.ranger('b', 'node-test', [tropRouge]);
    expect(memoire.lire('b', 'node-test')).toEqual([]);
  });

  it('ne rend une base qu’au format où elle a été lue', () => {
    const memoire = memoireDesBases();
    memoire.ranger('a', 'node-test', [rouges('x')]);
    expect(memoire.lire('a', 'vitest')).toEqual([]);
    expect(memoire.lire('a', 'node-test')).toHaveLength(1);
  });
});
