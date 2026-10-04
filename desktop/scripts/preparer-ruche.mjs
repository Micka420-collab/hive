// PRÉPARE CE QUE L'APP EMBARQUE DE HIVE — `desktop/build/hive/`, qu'
// electron-builder range tel quel dans `resources/hive/` (hors asar, ADR 0013
// § 3) :
//
//   dist/            le JavaScript compilé, sans `__tests__` ni `*.map`
//   dashboard/dist/  l'écran construit, que la Reine sert
//   node_modules/    la production seule : `ws`, Fastify, `better-sqlite3`
//   package.json     la version déclarée (`/api/version`), les dépendances
//   LICENSE, piece.cjs
//
// Prérequis : `npm run build` à la racine (dist/ et dashboard/dist/).
//
// ─── `--ignore-scripts`, ET POURQUOI C'EST SÛR ───────────────────────────────
//
// Le `prepare` du dépôt lance `tsc`, absent d'une installation `--omit=dev` :
// sans ce drapeau, `npm ci` échoue. Et depuis `better-sqlite3` 13, aucune
// dépendance de production n'a besoin de script : le binaire N-API voyage
// dans le paquet npm (`prebuilds/<os>-<arch>.node`).
//
// ─── UN SEUL BINAIRE SQLITE, CELUI DE LA CIBLE ───────────────────────────────
//
// `prebuilds/` porte huit binaires (Linux, musl, macOS, Windows × x64/arm64).
// On ne garde que ceux de la cible — les deux macOS pour un build qui produit
// arm64 et x64 d'un coup —, et on retire les sources C de SQLite (`deps/`,
// `src/`), inutiles à l'exécution. `HIVE_CIBLES=linux-x64,…` force la liste.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { BUREAU } from './theme.mjs';

const RACINE = path.resolve(BUREAU, '..');
const CIBLE = path.join(BUREAU, 'build', 'hive');

function exiger(rel) {
  if (!existsSync(path.join(RACINE, rel))) {
    console.error(`✘ ${rel} manque : lancez d'abord « npm run build » à la racine du dépôt.`);
    process.exit(2);
  }
}
exiger(path.join('dist', 'orchestrator', 'main.js'));
exiger(path.join('dist', 'ruche-superviseur.js'));
exiger(path.join('dashboard', 'dist', 'index.html'));

rmSync(CIBLE, { recursive: true, force: true });
mkdirSync(CIBLE, { recursive: true });

cpSync(path.join(RACINE, 'dist'), path.join(CIBLE, 'dist'), {
  recursive: true,
  filter: (source) => !source.split(path.sep).includes('__tests__') && !source.endsWith('.map'),
});
cpSync(path.join(RACINE, 'dashboard', 'dist'), path.join(CIBLE, 'dashboard', 'dist'), {
  recursive: true,
});
for (const f of ['package.json', 'package-lock.json', 'LICENSE']) {
  cpSync(path.join(RACINE, f), path.join(CIBLE, f));
}
cpSync(path.join(BUREAU, 'app', 'piece.cjs'), path.join(CIBLE, 'piece.cjs'));

// `npm` par le Node qui tourne, quand `npm run` nous a lancés : `npm.cmd` ne se
// lance pas sans interpréteur sous Windows (§ 6.2 du journal).
const npmCli = process.env.npm_execpath;
const args = [
  'ci',
  '--omit=dev',
  '--include=optional',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
];
const r = npmCli
  ? spawnSync(process.execPath, [npmCli, ...args], { cwd: CIBLE, stdio: 'inherit' })
  : spawnSync('npm', args, { cwd: CIBLE, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.status !== 0) {
  console.error(`✘ npm ci a échoué (code ${String(r.status)})`);
  process.exit(1);
}
rmSync(path.join(CIBLE, 'package-lock.json'), { force: true });

const cibles = (process.env.HIVE_CIBLES ?? '').trim()
  ? process.env.HIVE_CIBLES.split(',').map((c) => c.trim())
  : process.platform === 'darwin'
    ? ['darwin-arm64', 'darwin-x64']
    : [`${process.platform}-${process.arch}`];
const sqlite = path.join(CIBLE, 'node_modules', 'better-sqlite3');
const prebuilds = path.join(sqlite, 'prebuilds');
if (!existsSync(prebuilds)) {
  console.error('✘ better-sqlite3 sans prebuilds/ : la version installée n’est pas la 13 (N-API).');
  process.exit(1);
}
for (const f of readdirSync(prebuilds)) {
  if (!cibles.includes(f.replace(/\.node$/, ''))) rmSync(path.join(prebuilds, f));
}
const restants = readdirSync(prebuilds);
if (restants.length === 0) {
  console.error(`✘ aucun binaire better-sqlite3 pour ${cibles.join(', ')}`);
  process.exit(1);
}
for (const d of ['deps', 'src']) rmSync(path.join(sqlite, d), { recursive: true, force: true });
console.log(`ruche préparée dans desktop/build/hive — SQLite : ${restants.join(', ')}`);
