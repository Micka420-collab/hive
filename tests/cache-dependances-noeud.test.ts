// LE MAGASIN DE DÉPENDANCES, PAR LES VRAIES VALIDATIONS DU NŒUD (G18).
//
// De vrais dépôts git, un vrai registre de la ruche, les vraies validations
// (`validerProduction`) dans le faux moteur des bancs — et un `npm` dont SEUL
// `ci` est faux : il installe d'après le lockfile, sans réseau, et JOURNALISE
// chaque lancement avec son répertoire. Tout le reste (`npm --version`,
// `npm run`) est le vrai npm.
//
// Ce que ces bancs tiennent, chacun rouge sur le code d'avant le magasin :
//
//   · deux validations du même lockfile : UN `npm ci`, et jamais dans la tâche
//     (dans son voisin de peuplement, depuis la base) — simultanées comprises ;
//   · des tests qui réécrivent `node_modules/x` ne touchent pas l'entrée : la
//     validation suivante relit l'original ;
//   · après restauration, aucun lien ne sort de la tâche, aucun inode n'est
//     partagé avec le magasin, et le `.bin` s'exécute (modes copiés) ;
//   · un rejeu G11b de la base restaure sans réinstaller ;
//   · une tête qui change le lockfile, ou une base qui déclare un script
//     racine : `npm ci` dans l'arbre, rien n'entre au magasin ;
//   · une entrée piégée (FIFO, lien absolu, lien qui sort puis revient) ou une
//     installation qui écrit hors de `node_modules` : refusée, repli, rien
//     n'entre au magasin ;
//   · deux projets au même lockfile : deux entrées ;
//   · un peuplement qui échoue : le repli installe l'arbre, et le verdict est
//     celui de cette installation — jamais celui du magasin.
//
// POSIX : le faux moteur et le faux npm sont des scripts `sh`.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ramasserMagasin } from '../src/node-client/cache-dependances.js';
import type { MagasinDependances } from '../src/node-client/cache-dependances.js';
import { VERSION_MAGASIN } from '../src/shared/cache-dependances.js';
import { poserRegistre } from '../src/node-client/git-hote.js';
import { validerProduction } from '../src/node-client/validations-bac.js';
import type { DepotEpingle } from '../src/shared/git-protege.js';
import { fauxBac } from './fixtures/faux-bac.js';

const POSIX = process.platform !== 'win32';
const REGLAGES = ['-c', 'user.email=banc@hive.local', '-c', 'user.name=Banc Hive'];
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', [...REGLAGES, '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

let racine: string;
/** Le faux npm : son journal (un répertoire par `npm ci`), et son mode. */
let journal: string;
let mode: string;
const dossiers: string[] = [];

/**
 * Le `ci` du faux npm : il lit le lockfile et pose, pour chaque paquet, un
 * `index.js` qui dit son nom et sa version, son `.bin` (un lien RELATIF, comme
 * npm), et `node_modules/.package-lock.json`. Ses modes rejouent ce qu'un
 * script de dépendance pourrait laisser.
 */
const FAUX_CI = `
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const mode = process.argv[2] || '';
if (mode === 'echec') { console.error('faux npm : échec voulu'); process.exit(1); }
if (mode === 'lent') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
fs.rmSync('node_modules', { recursive: true, force: true });
let premier = null;
for (const [chemin, p] of Object.entries(lock.packages)) {
  if (chemin === '') continue;
  const nom = chemin.slice('node_modules/'.length);
  const dossier = path.join('node_modules', nom);
  premier = premier || dossier;
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'package.json'), JSON.stringify({ name: nom, version: p.version }));
  fs.writeFileSync(path.join(dossier, 'index.js'), 'module.exports = ' + JSON.stringify(nom + '@' + p.version) + ';\\n');
  for (const [bin, fichier] of Object.entries(p.bin || {})) {
    fs.writeFileSync(path.join(dossier, fichier), '#!/usr/bin/env node\\nconsole.log("' + bin + ' lancé");\\n', { mode: 0o755 });
    fs.mkdirSync(path.join('node_modules', '.bin'), { recursive: true });
    fs.symlinkSync(path.join('..', nom, fichier), path.join('node_modules', '.bin', bin));
  }
}
fs.writeFileSync(path.join('node_modules', '.package-lock.json'), JSON.stringify(lock));
if (mode === 'fifo') execFileSync('mkfifo', [path.join(premier, 'tube')]);
if (mode === 'lien-absolu') fs.symlinkSync('/etc/hostname', path.join(premier, 'absolu'));
if (mode === 'lien-detour') fs.symlinkSync('../../node_modules/dep-a/index.js', path.join(premier, 'detour'));
if (mode === 'ecrit-hors') fs.writeFileSync('hors.txt', 'écrit hors de node_modules\\n');
`;

beforeAll(() => {
  racine = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hive-cache-dependances-')));
  const bin = path.join(racine, 'bin');
  mkdirSync(bin);
  journal = path.join(racine, 'journal-ci');
  mode = path.join(racine, 'mode');
  const vraiNpm = execFileSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).trim();
  writeFileSync(path.join(racine, 'faux-ci.cjs'), FAUX_CI);
  writeFileSync(
    path.join(bin, 'npm'),
    '#!/bin/sh\n' +
      'if [ "$1" = "ci" ]; then\n' +
      `  pwd -P >> '${journal}'\n` +
      `  exec node '${path.join(racine, 'faux-ci.cjs')}' "$(cat '${mode}' 2>/dev/null)"\n` +
      'fi\n' +
      `exec '${vraiNpm}' "$@"\n`,
    { mode: 0o755 },
  );
});

afterAll(() => {
  rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
});

beforeEach(() => {
  // Le faux npm d'abord : les validations passent le PATH du nœud au bac.
  vi.stubEnv('PATH', `${path.join(racine, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`);
  rmSync(journal, { force: true });
  writeFileSync(mode, '');
  return () => {
    vi.unstubAllEnvs();
    for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  };
});

/** Les répertoires où le faux `npm ci` a tourné, dans l'ordre. */
const ciLances = (): string[] =>
  existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : [];

const LOCKFILE = JSON.stringify(
  {
    name: 'projet-g18',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'projet-g18', version: '1.0.0', dependencies: { 'dep-a': '1.0.0' } },
      'node_modules/dep-a': {
        version: '1.0.0',
        resolved: 'https://registry.example.invalid/dep-a/-/dep-a-1.0.0.tgz',
        integrity: 'sha512-ZmF1eCBwYXF1ZXQ=',
        bin: { 'dep-a': 'bin.js' },
      },
    },
  },
  null,
  2,
);

/**
 * Le test du projet : la dépendance est l'ORIGINALE, son `.bin` s'exécute —
 * puis il la RÉÉCRIT, comme un test qui écrit dans `node_modules`.
 */
const VERIFIER = `
const fs = require('node:fs');
const path = require('node:path');
const v = require('dep-a');
if (v !== 'dep-a@1.0.0') { console.error('dépendance trafiquée : ' + v); process.exit(1); }
require('node:child_process').execFileSync(path.join('node_modules', '.bin', 'dep-a'), { stdio: 'inherit' });
fs.writeFileSync(require.resolve('dep-a'), "module.exports = 'reecrit';\\n");
console.log('dépendance d’origine, puis réécrite');
`;

const PROJET = (manifeste: Record<string, unknown> = {}): Record<string, string> => ({
  'package.json': JSON.stringify({
    name: 'projet-g18',
    version: '1.0.0',
    private: true,
    scripts: { test: 'node verifier.js' },
    dependencies: { 'dep-a': '1.0.0' },
    ...manifeste,
  }),
  'package-lock.json': LOCKFILE,
  'verifier.js': VERIFIER,
  '.gitignore': 'node_modules\n',
});

/** Un dépôt source : ses tâches en sont des clones, au même commit de base. */
function source(fichiers: Record<string, string>): string {
  const dir = mkdtempSync(path.join(racine, 'source-'));
  dossiers.push(dir);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(dir, nom)), { recursive: true });
    writeFileSync(path.join(dir, nom), contenu);
  }
  git(dir, 'init', '-q');
  git(dir, 'add', '--all');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** Une tâche : un clone de la source, son registre — et ses voisins, effacés après. */
async function tache(src: string): Promise<{
  dir: string;
  depot: { depot: DepotEpingle; baseSha: string };
}> {
  const parent = mkdtempSync(path.join(racine, 'tache-'));
  dossiers.push(parent);
  const dir = path.join(parent, 't');
  git(parent, 'clone', '-q', src, dir);
  const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
  const registre = path.join(parent, 't.git');
  mkdirSync(registre);
  return { dir, depot: { depot: await poserRegistre(dir, registre, baseSha), baseSha } };
}

/** Le magasin d'un banc, neuf. */
function magasin(projet = 'p1'): MagasinDependances {
  const dir = mkdtempSync(path.join(racine, 'magasin-'));
  dossiers.push(dir);
  return { racine: dir, projet, reseau: 'dependances:libre', niveau: 'conteneur' };
}

async function valider(
  t: Awaited<ReturnType<typeof tache>>,
  m: ReturnType<typeof magasin>,
): Promise<{ tests: string; etapes: string[]; extrait: string }> {
  // La production : un fichier de plus, sans rapport avec les dépendances.
  writeFileSync(path.join(t.dir, 'produit.js'), 'module.exports = 1;\n');
  const etapes: string[] = [];
  const rapport = await validerProduction({
    cwd: t.dir,
    depot: t.depot,
    bac: fauxBac(dossiers),
    surEtape: (l) => etapes.push(l),
    magasin: m,
  });
  return {
    tests: rapport.controles.tests.etat,
    etapes,
    extrait: rapport.controles.tests.extrait ?? '',
  };
}

/** Tout ce que le magasin garde pour un projet — restes de peuplement compris. */
const contenu = (m: ReturnType<typeof magasin>): string[] => {
  const dir = path.join(m.racine, m.projet);
  return existsSync(dir) ? readdirSync(dir) : [];
};

/**
 * Les entrées publiées d'un projet du magasin : leur clé pour nom, rien
 * d'autre — ni un peuplement en vol, ni une entrée écartée qu'on efface.
 */
const entrees = (m: ReturnType<typeof magasin>): string[] =>
  contenu(m).filter((e) => /^[0-9a-f]{32}$/.test(e));

const PREPARATION = /^validations : préparation « npm ci » faite en \S+ s — (.*)$/;
const noteDe = (etapes: readonly string[]): string | undefined =>
  etapes.map((l) => PREPARATION.exec(l)?.[1]).find((n) => n !== undefined);

describe.runIf(POSIX)('le magasin de dépendances, par les validations du nœud', () => {
  it('deux validations du même lockfile : UN npm ci, à la base, jamais dans la tâche', async () => {
    const src = source(PROJET());
    const m = magasin();
    const t1 = await tache(src);
    const t2 = await tache(src);

    const v1 = await valider(t1, m);
    const v2 = await valider(t2, m);

    expect(v1.tests, v1.extrait).toBe('passed');
    expect(v2.tests, v2.extrait).toBe('passed');
    // Un seul `npm ci` — dans le voisin de peuplement de la PREMIÈRE tâche.
    expect(ciLances()).toEqual([`${t1.dir}.deps`]);
    expect(noteDe(v1.etapes)).toBe('dépendances installées à la base, rangées au magasin du nœud');
    expect(noteDe(v2.etapes)).toBe('dépendances restaurées du magasin du nœud');
    // Le voisin de peuplement ne reste pas.
    expect(existsSync(`${t1.dir}.deps`)).toBe(false);
    expect(entrees(m)).toHaveLength(1);
  }, 90_000);

  it('les tests réécrivent node_modules : l’entrée reste intacte, aucun lien ne sort, aucun inode partagé', async () => {
    const src = source(PROJET());
    const m = magasin();
    const t1 = await tache(src);
    const t2 = await tache(src);
    await valider(t1, m);

    const v2 = await valider(t2, m);

    // Les deux tests ont réécrit LEUR copie ; la seconde a lu l'original.
    expect(v2.tests, v2.extrait).toBe('passed');
    const [entree] = entrees(m);
    const modules = path.join(m.racine, m.projet, entree ?? '', 'node_modules');
    expect(readFileSync(path.join(modules, 'dep-a', 'index.js'), 'utf8')).toBe(
      'module.exports = "dep-a@1.0.0";\n',
    );
    // Après restauration : chaque lien reste dans la tâche, aucun inode du magasin.
    const duMagasin = new Set<number>();
    const tache2 = path.join(t2.dir, 'node_modules');
    const parcourir = (dir: string, visiter: (chemin: string) => void): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const chemin = path.join(dir, e.name);
        visiter(chemin);
        if (e.isDirectory()) parcourir(chemin, visiter);
      }
    };
    parcourir(modules, (c) => duMagasin.add(lstatSync(c).ino));
    let liens = 0;
    parcourir(tache2, (c) => {
      const st = lstatSync(c);
      expect(duMagasin.has(st.ino), c).toBe(false);
      if (st.isSymbolicLink()) {
        liens += 1;
        expect(path.isAbsolute(readlinkSync(c)), c).toBe(false);
        expect(realpathSync(c).startsWith(`${tache2}${path.sep}`), c).toBe(true);
      }
    });
    expect(liens).toBe(1);
  }, 90_000);

  it('deux validations simultanées du même lockfile : un seul npm ci', async () => {
    writeFileSync(mode, 'lent');
    const src = source(PROJET());
    const m = magasin();
    const [t1, t2] = await Promise.all([tache(src), tache(src)]);

    const [v1, v2] = await Promise.all([valider(t1, m), valider(t2, m)]);

    expect([v1.tests, v2.tests]).toEqual(['passed', 'passed']);
    expect(ciLances()).toHaveLength(1);
    expect(ciLances()[0]).toMatch(/\.deps$/);
    expect([noteDe(v1.etapes), noteDe(v2.etapes)].sort()).toEqual([
      'dépendances installées à la base, rangées au magasin du nœud',
      'dépendances restaurées du magasin du nœud',
    ]);
  }, 90_000);

  it('un rejeu G11b de la base restaure ses dépendances sans réinstaller', async () => {
    const src = source({
      'package.json': JSON.stringify({
        name: 'projet-g18',
        version: '1.0.0',
        private: true,
        scripts: { test: 'node --test' },
        dependencies: { 'dep-a': '1.0.0' },
      }),
      'package-lock.json': LOCKFILE,
      '.gitignore': 'node_modules\n',
      'test/ancien.test.js':
        "const test = require('node:test');\nconst assert = require('node:assert');\n" +
        "test('un test déjà rouge à la base', () => assert.strictEqual(require('dep-a'), 'autre chose'));\n",
    });
    const m = magasin();
    const t = await tache(src);

    const v = await valider(t, m);

    // Rouge à la tête ET à la base, du même échec : excusé — la base a été rejouée.
    expect(v.tests, v.extrait).toBe('passed');
    expect(
      v.etapes.some((l) =>
        /base [0-9a-f]{8} — prête en .* — dépendances restaurées du magasin du nœud$/.test(l),
      ),
      v.etapes.join('\n'),
    ).toBe(true);
    // Le seul `npm ci` est celui du peuplement : ni la tâche ni le rejeu n'ont réinstallé.
    expect(ciLances()).toEqual([`${t.dir}.deps`]);
  }, 90_000);

  it('la tête change le lockfile : npm ci dans la tête, rien n’entre au magasin', async () => {
    const src = source(PROJET());
    const m = magasin();
    const t = await tache(src);
    writeFileSync(path.join(t.dir, 'package-lock.json'), `${LOCKFILE}\n`);

    const v = await valider(t, m);

    expect(v.tests, v.extrait).toBe('passed');
    expect(ciLances()).toEqual([t.dir]);
    expect(entrees(m)).toEqual([]);
    expect(noteDe(v.etapes)).toBe(
      'hors magasin : la production change un fichier que l’installation lit (package-lock.json)',
    );
  }, 90_000);

  it('un script d’installation à la racine de la base : npm ci dans l’arbre, rien n’entre au magasin', async () => {
    const src = source(PROJET({ scripts: { test: 'node verifier.js', prepare: 'node -e 0' } }));
    const m = magasin();
    const t = await tache(src);

    const v = await valider(t, m);

    expect(v.tests, v.extrait).toBe('passed');
    expect(ciLances()).toEqual([t.dir]);
    expect(entrees(m)).toEqual([]);
    expect(noteDe(v.etapes)).toBe('hors magasin : un script d’installation à la racine (prepare)');
  }, 90_000);

  it.each([
    ['fifo', 'entrée refusée (dep-a/tube (FIFO))'],
    ['lien-absolu', 'entrée refusée (dep-a/absolu : lien absolu)'],
    // Il sort de `node_modules` puis y revient par son nom : dedans là où il a
    // été écrit, ailleurs une fois recopié — refusé quand même.
    ['lien-detour', 'entrée refusée (dep-a/detour : lien hors de l’entrée)'],
    ['ecrit-hors', 'peuplement depuis la base impossible (écrit hors de node_modules : hors.txt)'],
  ])(
    'une installation piégée (%s) : refusée, repli dans l’arbre, rien au magasin',
    async (piege, raison) => {
      writeFileSync(mode, piege);
      const src = source(PROJET());
      const m = magasin();
      const t = await tache(src);

      const v = await valider(t, m);

      expect(v.tests, v.extrait).toBe('passed');
      expect(ciLances()).toEqual([`${t.dir}.deps`, t.dir]);
      // Rien au magasin — pas même un reste du peuplement refusé.
      expect(contenu(m)).toEqual([]);
      expect(noteDe(v.etapes)).toBe(`hors magasin : ${raison}`);
    },
    90_000,
  );

  it('deux projets au même lockfile : deux entrées, chacune peuplée', async () => {
    const src = source(PROJET());
    const commun = magasin('pa');
    const autre = { ...commun, projet: 'pb' };
    const t1 = await tache(src);
    const t2 = await tache(src);

    await valider(t1, commun);
    const v2 = await valider(t2, autre);

    expect(ciLances()).toEqual([`${t1.dir}.deps`, `${t2.dir}.deps`]);
    expect(entrees(commun)).toHaveLength(1);
    expect(entrees(autre)).toHaveLength(1);
    expect(noteDe(v2.etapes)).toBe('dépendances installées à la base, rangées au magasin du nœud');
  }, 90_000);

  it('un peuplement qui échoue : l’arbre s’installe, et son échec est le verdict', async () => {
    writeFileSync(mode, 'echec');
    const src = source(PROJET());
    const m = magasin();
    const t = await tache(src);

    const v = await valider(t, m);

    expect(v.tests).toBe('missing');
    expect(ciLances()).toEqual([`${t.dir}.deps`, t.dir]);
    expect(entrees(m)).toEqual([]);
    expect(v.extrait).toContain(
      '[hive] hors magasin : peuplement depuis la base impossible (npm ci → code 1)',
    );
    expect(v.extrait).toMatch(/\[hive\] npm ci → code 1$/);
  }, 90_000);

  // ─── LA RÉTENTION, PAR LES VRAIES VALIDATIONS (G18 D) ──────────────────────

  it('la 4e entrée d’un projet, publiée, évince la moins récemment servie', async () => {
    const m = magasin();
    // Trois entrées déjà là, au format du magasin, servies il y a 3 h, 2 h et 1 h.
    writeFileSync(path.join(m.racine, '.niveau-isolement'), 'conteneur');
    const anciennes = [3, 2, 1].map((h, i) => {
      const cle = String(i + 1).padStart(32, 'f');
      const dir = path.join(m.racine, m.projet, cle);
      mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      writeFileSync(
        path.join(dir, 'manifeste.json'),
        JSON.stringify({ version: VERSION_MAGASIN, cle, fichiers: 0, octets: 0, liens: 0 }),
      );
      writeFileSync(path.join(dir, 'servie'), '');
      const quand = (Date.now() - h * 3_600_000) / 1000;
      utimesSync(path.join(dir, 'servie'), quand, quand);
      return cle;
    });
    const t = await tache(source(PROJET()));

    const v = await valider(t, m);

    expect(v.tests, v.extrait).toBe('passed');
    expect(noteDe(v.etapes)).toBe(
      'dépendances installées à la base, rangées au magasin du nœud (1 entrée(s) évincée(s))',
    );
    // La plus ancienne est partie ; la nouvelle et les deux plus récentes restent.
    const restantes = entrees(m);
    expect(restantes).toHaveLength(3);
    expect(restantes).not.toContain(anciennes[0]);
    expect(restantes).toEqual(expect.arrayContaining([anciennes[1], anciennes[2]]));
  }, 90_000);

  it('une entrée en cours de restauration n’est jamais écartée sous ses pieds, ramassage en boucle', async () => {
    // Beaucoup de paquets : la copie dure (des centaines de ms pour quelques
    // ms par tour de ramassage) — sans le verrou, un tour la croise à coup sûr.
    const n = 1500;
    const deps = Object.fromEntries(Array.from({ length: n }, (_, i) => [`dep-${i}`, '1.0.0']));
    const lock = JSON.stringify({
      name: 'projet-g18',
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: 'projet-g18', version: '1.0.0', dependencies: deps },
        ...Object.fromEntries(
          Object.keys(deps).map((d) => [
            `node_modules/${d}`,
            {
              version: '1.0.0',
              resolved: `https://registry.example.invalid/${d}/-/${d}-1.0.0.tgz`,
              integrity: 'sha512-ZmF1eCBwYXF1ZXQ=',
            },
          ]),
        ),
      },
    });
    const src = source({
      'package.json': JSON.stringify({
        name: 'projet-g18',
        version: '1.0.0',
        private: true,
        scripts: { test: `node -e "process.exit(require('dep-0') === 'dep-0@1.0.0' ? 0 : 1)"` },
        dependencies: deps,
      }),
      'package-lock.json': lock,
      '.gitignore': 'node_modules\n',
    });
    const m = magasin();
    const t1 = await tache(src);
    const t2 = await tache(src);
    await valider(t1, m);
    // Un ramassage qui se croit dans un mois tourne en boucle : toute entrée
    // libre lui paraît périmée. Celle que la seconde tâche copie ne l'est pas.
    let fini = false;
    const boucle = (async () => {
      while (!fini) {
        await ramasserMagasin(m.racine, undefined, Date.now() + 30 * 24 * 3_600_000);
        await new Promise((suite) => setImmediate(suite));
      }
    })();

    const v2 = await valider(t2, m).finally(() => {
      fini = true;
    });
    await boucle;

    expect(v2.tests, v2.extrait).toBe('passed');
    // Jamais de repli dans l'arbre : aucune copie n'a perdu son entrée en route.
    expect(ciLances()).not.toContain(t2.dir);
    expect(noteDe(v2.etapes)).toMatch(/^dépendances (restaurées|installées à la base)/);
  }, 120_000);
});
