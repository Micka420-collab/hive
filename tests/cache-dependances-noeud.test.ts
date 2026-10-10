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
//     (dans son voisin de peuplement, depuis la base) ;
//   · des tests qui réécrivent `node_modules/x` ne touchent pas l'entrée : la
//     validation suivante relit l'original ;
//   · après restauration, aucun lien ne sort de la tâche, aucun inode n'est
//     partagé avec le magasin, et le `.bin` s'exécute (modes copiés) ;
//   · un rejeu G11b de la base restaure sans réinstaller, ni resonder le bac ;
//   · une tête qui change le lockfile, une base qui déclare un script racine,
//     ou une dépendance à script d'installation qui lit le projet : `npm ci`
//     dans l'arbre, rien n'entre au magasin ;
//   · une entrée piégée (FIFO, lien absolu, lien qui sort puis revient, lien
//     à barre oblique inverse, setuid, écriture pour tous, plafonds) : pas
//     gardée — l'arbre reçoit l'installation de la base, sans en refaire une ;
//     et le nœud s'en souvient : l'arbre suivant s'installe sans repeupler ;
//   · une installation qui écrit hors de `node_modules` (un lien dur compris) :
//     rien au magasin, `npm ci` dans l'arbre ;
//   · deux projets au même lockfile : deux entrées ;
//   · un peuplement qui échoue : son échec est celui de l'arbre, sans second
//     `npm ci` ; un peuplement en cours ne fait attendre personne ;
//   · une entrée amputée : la copie partielle est effacée, puis l'arbre
//     s'installe ;
//   · un lockfile en CRLF (`core.autocrlf`) reste celui de la base.
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
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { poserRegistre } from '../src/node-client/git-hote.js';
import { validerProduction } from '../src/node-client/validations-bac.js';
import type { DepotEpingle } from '../src/shared/git-protege.js';
import { appelsDuFauxBac, fauxBac } from './fixtures/faux-bac.js';

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
const dort = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (mode === 'echec') { console.error('faux npm : échec voulu'); process.exit(1); }
if (mode === 'peuplement-lent' && process.cwd().endsWith('.deps')) dort(4000);
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
  // Le postinstall d'une dépendance : npm lui donne la racine du projet
  // (\`INIT_CWD\`), et il y lit un fichier que la clé ne couvre pas.
  if (p.hasInstallScript && fs.existsSync('schema.txt')) fs.copyFileSync('schema.txt', path.join(dossier, 'schema.txt'));
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
if (mode === 'lien-dur') fs.linkSync('package.json', path.join(premier, 'lie.json'));
if (mode === 'setuid') fs.chmodSync(path.join(premier, 'index.js'), 0o4755);
if (mode === 'ecriture-tous') fs.chmodSync(path.join(premier, 'index.js'), 0o666);
if (mode === 'lien-antislash') {
  // Découpée sur les deux barres, la cible reste dans node_modules (a/b/../..) ;
  // pour le noyau, \`a\\b\` est UN nom, et elle désigne le dossier AU-DESSUS.
  fs.mkdirSync(path.join('node_modules', 'a\\\\b'));
  fs.mkdirSync(path.join('node_modules', 'a', 'b'), { recursive: true });
  fs.symlinkSync('a\\\\b/../..', path.join('node_modules', 'L'));
}
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
      // Un `node_modules` déjà là — une copie partielle oubliée — se dit au journal.
      `  if [ -e node_modules ]; then echo "$(pwd -P) +node_modules" >> '${journal}'; ` +
      `else pwd -P >> '${journal}'; fi\n` +
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

/** Le magasin d'un banc, neuf — aux plafonds d'une entrée donnés, s'il le faut. */
function magasin(
  projet = 'p1',
  plafonds?: { elements: number; octets: number },
): {
  racine: string;
  projet: string;
  reseau: string;
  plafonds?: { elements: number; octets: number };
} {
  const dir = mkdtempSync(path.join(racine, 'magasin-'));
  dossiers.push(dir);
  return { racine: dir, projet, reseau: 'dependances:libre', ...(plafonds ? { plafonds } : {}) };
}

async function valider(
  t: Awaited<ReturnType<typeof tache>>,
  m: ReturnType<typeof magasin>,
): Promise<{ tests: string; etapes: string[]; extrait: string; appels: string[] }> {
  // La production : un fichier de plus, sans rapport avec les dépendances.
  writeFileSync(path.join(t.dir, 'produit.js'), 'module.exports = 1;\n');
  const etapes: string[] = [];
  const bac = fauxBac(dossiers);
  const rapport = await validerProduction({
    cwd: t.dir,
    depot: t.depot,
    bac,
    surEtape: (l) => etapes.push(l),
    magasin: m,
  });
  return {
    tests: rapport.controles.tests.etat,
    etapes,
    extrait: rapport.controles.tests.extrait ?? '',
    appels: appelsDuFauxBac(bac),
  };
}

/** Tout ce que le magasin garde pour un projet — restes de peuplement compris. */
const contenu = (m: ReturnType<typeof magasin>): string[] => {
  const dir = path.join(m.racine, m.projet);
  return existsSync(dir) ? readdirSync(dir) : [];
};

/** Les entrées publiées d'un projet du magasin (sans les restes de peuplement). */
const entrees = (m: ReturnType<typeof magasin>): string[] =>
  contenu(m).filter((e) => /^[0-9a-f]{32}$/.test(e));

const PREPARATION = /^validations : préparation « npm ci » faite en \S+ s — (.*)$/;
const noteDe = (etapes: readonly string[]): string | undefined =>
  etapes.map((l) => PREPARATION.exec(l)?.[1]).find((n) => n !== undefined);

const PAS_GARDEES = 'dépendances installées à la base, pas gardées au magasin du nœud';

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
    const parcourir = (dir: string, visiter: (chemin: string) => void): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const chemin = path.join(dir, e.name);
        visiter(chemin);
        if (e.isDirectory()) parcourir(chemin, visiter);
      }
    };
    parcourir(modules, (c) => duMagasin.add(lstatSync(c).ino));
    // La tâche qui a peuplé a reçu l'installation elle-même, le magasin une copie.
    for (const tacheN of [t1, t2]) {
      const arbre = path.join(tacheN.dir, 'node_modules');
      let liens = 0;
      parcourir(arbre, (c) => {
        const st = lstatSync(c);
        expect(duMagasin.has(st.ino), c).toBe(false);
        if (st.isSymbolicLink()) {
          liens += 1;
          expect(path.isAbsolute(readlinkSync(c)), c).toBe(false);
          expect(realpathSync(c).startsWith(`${arbre}${path.sep}`), c).toBe(true);
        }
      });
      expect(liens).toBe(1);
    }
  }, 90_000);

  it('deux validations simultanées : la seconde n’attend pas le peuplement de la première', async () => {
    // Attendre lui mangerait son échéance : elle s'installe, comme avant.
    writeFileSync(mode, 'peuplement-lent');
    const src = source(PROJET());
    const m = magasin();
    const [t1, t2] = await Promise.all([tache(src), tache(src)]);
    const finies: (string | undefined)[] = [];
    const suivre = (v: Awaited<ReturnType<typeof valider>>) => {
      finies.push(noteDe(v.etapes));
      return v;
    };

    const [v1, v2] = await Promise.all([valider(t1, m).then(suivre), valider(t2, m).then(suivre)]);

    expect([v1.tests, v2.tests]).toEqual(['passed', 'passed']);
    expect(ciLances().filter((d) => d.endsWith('.deps'))).toHaveLength(1);
    expect(ciLances()).toHaveLength(2);
    // Celle qui n'a pas attendu a fini AVANT le peuplement de quatre secondes.
    expect(finies).toEqual([
      'hors magasin : un peuplement de la même entrée est en cours : pas d’attente derrière lui',
      'dépendances installées à la base, rangées au magasin du nœud',
    ]);
  }, 90_000);

  it('un rejeu G11b de la base restaure ses dépendances sans réinstaller, ni resonder le bac', async () => {
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
    // La sonde du bac et l'identifiant de son image : une fois pour la tâche ET son rejeu.
    expect(v.appels.filter((a) => a.includes('HIVE-EMPREINTE'))).toHaveLength(1);
    expect(v.appels.filter((a) => a.startsWith('image inspect --format {{.Id}}'))).toHaveLength(1);
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

  it('la tête porte le lockfile de la base en CRLF (core.autocrlf) : le magasin sert', async () => {
    const src = source(PROJET());
    const m = magasin();
    const t = await tache(src);
    writeFileSync(path.join(t.dir, 'package-lock.json'), LOCKFILE.replace(/\n/g, '\r\n'));

    const v = await valider(t, m);

    expect(v.tests, v.extrait).toBe('passed');
    expect(ciLances()).toEqual([`${t.dir}.deps`]);
    expect(noteDe(v.etapes)).toBe('dépendances installées à la base, rangées au magasin du nœud');
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

  it('une dépendance dont le postinstall lit le projet : jamais servie depuis le magasin', async () => {
    // La base compile `schema.txt` dans `node_modules` ; la tête le change. Une
    // entrée peuplée à la base lui servirait l'ANCIEN — un faux rouge, ou un
    // faux vert, selon le test.
    const lock = JSON.parse(LOCKFILE) as { packages: Record<string, Record<string, unknown>> };
    lock.packages['node_modules/dep-a'] = {
      ...lock.packages['node_modules/dep-a'],
      hasInstallScript: true,
    };
    const src = source({
      ...PROJET({ scripts: { test: 'node compare.js' } }),
      'package-lock.json': JSON.stringify(lock, null, 2),
      'schema.txt': 'model User { id }\n',
      'compare.js':
        "const fs = require('node:fs');\n" +
        "const fige = fs.readFileSync('node_modules/dep-a/schema.txt', 'utf8');\n" +
        "if (fige !== fs.readFileSync('schema.txt', 'utf8')) { console.error('figé : ' + fige); process.exit(1); }\n",
    });
    const m = magasin();
    const t = await tache(src);
    writeFileSync(path.join(t.dir, 'schema.txt'), 'model User { id email }\n');

    const v = await valider(t, m);

    expect(v.tests, v.extrait).toBe('passed');
    expect(ciLances()).toEqual([t.dir]);
    expect(entrees(m)).toEqual([]);
    expect(noteDe(v.etapes)).toBe(
      'hors magasin : une dépendance à script d’installation (elle peut lire l’arbre) (node_modules/dep-a)',
    );
  }, 90_000);

  it.each([
    ['fifo', 'entrée refusée (dep-a/tube (FIFO))'],
    ['lien-absolu', 'entrée refusée (dep-a/absolu : lien absolu)'],
    // Il sort de `node_modules` puis y revient par son nom : dedans là où il a
    // été écrit, ailleurs une fois recopié — refusé quand même.
    ['lien-detour', 'entrée refusée (dep-a/detour : lien hors de l’entrée)'],
    // `a\b/../..` : le noyau découpe sur `/` seul, et sort de node_modules.
    ['lien-antislash', 'entrée refusée (L : lien à barre oblique inverse)'],
    ['setuid', 'entrée refusée (dep-a/index.js (setuid/setgid))'],
    ['ecriture-tous', 'entrée refusée (dep-a/index.js (écriture pour tous))'],
  ])(
    'une installation piégée (%s) : pas gardée — l’arbre la reçoit, sans second npm ci',
    async (piege, raison) => {
      writeFileSync(mode, piege);
      const src = source(PROJET());
      const m = magasin();
      const t = await tache(src);

      const v = await valider(t, m);

      expect(v.tests, v.extrait).toBe('passed');
      expect(ciLances()).toEqual([`${t.dir}.deps`]);
      // Rien au magasin — pas même un reste du peuplement refusé.
      expect(contenu(m)).toEqual([]);
      expect(noteDe(v.etapes)).toBe(`${PAS_GARDEES} : ${raison}`);
    },
    90_000,
  );

  it.each([
    ['ecrit-hors', 'hors.txt'],
    // Un lien dur vers un fichier de l'arbre : son inode a un nom de plus.
    ['lien-dur', 'package.json'],
  ])(
    'une installation qui écrit hors de node_modules (%s) : rien au magasin, npm ci dans l’arbre',
    async (piege, chemin) => {
      writeFileSync(mode, piege);
      const src = source(PROJET());
      const m = magasin();
      const t = await tache(src);

      const v = await valider(t, m);

      expect(v.tests, v.extrait).toBe('passed');
      expect(ciLances()).toEqual([`${t.dir}.deps`, t.dir]);
      expect(contenu(m)).toEqual([]);
      expect(noteDe(v.etapes)).toBe(
        `hors magasin : l’installation a écrit hors de \`node_modules\` (${chemin})`,
      );
    },
    90_000,
  );

  it('les plafonds d’une entrée comptent ses dossiers et ses liens, pas seulement ses fichiers', async () => {
    // Quatre fichiers, deux dossiers, un lien : sept éléments, au-delà de cinq.
    const src = source(PROJET());
    const m = magasin('p1', { elements: 5, octets: 1024 ** 3 });
    const t = await tache(src);

    const v = await valider(t, m);

    expect(v.tests, v.extrait).toBe('passed');
    expect(ciLances()).toEqual([`${t.dir}.deps`]);
    expect(contenu(m)).toEqual([]);
    expect(noteDe(v.etapes)).toBe(
      `${PAS_GARDEES} : entrée refusée (au-delà des plafonds d’une entrée)`,
    );
  }, 90_000);

  it('une entrée refusée l’est pour la vie du nœud : l’arbre suivant s’installe sans repeupler', async () => {
    writeFileSync(mode, 'fifo');
    const src = source(PROJET());
    const m = magasin();
    const t1 = await tache(src);
    const t2 = await tache(src);

    await valider(t1, m);
    const v2 = await valider(t2, m);

    expect(v2.tests, v2.extrait).toBe('passed');
    // Un seul peuplement : la seconde tâche installe son arbre, directement.
    expect(ciLances()).toEqual([`${t1.dir}.deps`, t2.dir]);
    expect(noteDe(v2.etapes)).toBe(
      'hors magasin : refusée plus tôt sur ce nœud (entrée refusée (dep-a/tube (FIFO)))',
    );
  }, 90_000);

  it('une entrée amputée depuis sa publication : la copie partielle est effacée, puis l’arbre s’installe', async () => {
    const src = source(PROJET());
    const m = magasin();
    const t1 = await tache(src);
    const t2 = await tache(src);
    await valider(t1, m);
    const [entree] = entrees(m);
    rmSync(path.join(m.racine, m.projet, entree ?? '', 'node_modules', 'dep-a', 'package.json'));

    const v2 = await valider(t2, m);

    expect(v2.tests, v2.extrait).toBe('passed');
    // Le `npm ci` de la seconde tâche n'a trouvé AUCUN reste de la copie.
    expect(ciLances()).toEqual([`${t1.dir}.deps`, t2.dir]);
    expect(noteDe(v2.etapes)).toBe(
      'hors magasin : copie interrompue (3 fichiers copiés, 4 attendus)',
    );
  }, 90_000);

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

  it('un peuplement qui échoue : son échec est celui de l’arbre, sans second npm ci', async () => {
    // Mêmes fichiers d'entrée, aucun script : l'arbre aurait échoué pareil.
    writeFileSync(mode, 'echec');
    const src = source(PROJET());
    const m = magasin();
    const t = await tache(src);

    const v = await valider(t, m);

    expect(v.tests).toBe('missing');
    expect(ciLances()).toEqual([`${t.dir}.deps`]);
    expect(entrees(m)).toEqual([]);
    expect(v.extrait).toContain('faux npm : échec voulu');
    expect(v.extrait).toContain('[hive] installation lancée à la base, pour le magasin du nœud');
    expect(v.extrait).toMatch(/\[hive\] npm ci → code 1$/);
  }, 90_000);
});
