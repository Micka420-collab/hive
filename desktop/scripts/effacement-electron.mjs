// LE DOSSIER D'UNE TÂCHE, EFFACÉ PAR L'ELECTRON DE L'APP —
// `node desktop/scripts/effacement-electron.mjs`, après `npm run build` et
// `npm ci --prefix desktop`.
//
// ─── POURQUOI CE BANC TOURNE ICI, ET PAS DANS VITEST ─────────────────────────
//
// Dans l'app, la Reine et les ouvrières tournent dans le binaire d'Electron en
// mode Node (`ELECTRON_RUN_AS_NODE`, `desktop/app/piece.cjs`) — pas dans le
// Node de la CI. Et les deux n'effacent pas pareil : `fs.rmSync` est du C++
// posé sur `std::filesystem`, et sous Windows la libc++ d'Electron refuse un
// fichier en lecture seule là où la STL du Node officiel l'efface
// (nodejs/node#64374). Git pose ses objets en lecture seule : dans Hive 0.5.0,
// le dossier d'une tentative tuée ne s'effaçait plus (« EPERM, Permission
// denied »), et chaque tentative suivante était refusée. La suite vitest, sous
// le Node officiel, était verte ; seul ce binaire-ci montre la panne.
//
// Le banc prépare donc DEUX fois la même tâche avec le vrai `prepareWorkspace`
// compilé (`dist/`), sans effacer entre les deux — une ruche redémarrée en
// pleine tâche —, sous l'Electron que l'app embarque. Il dit aussi ce que fait
// `rmSync` de ce runtime sur un fichier en lecture seule : un vert là où
// `rmSync` efface ne prouverait rien.

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = fileURLToPath(import.meta.url);
const RACINE = path.resolve(path.dirname(ICI), '..', '..');

// ─── Sous Node : relancer ce fichier dans l'Electron de l'app ───────────────
if (process.versions.electron === undefined) {
  const electron = createRequire(ICI)('electron');
  const r = spawnSync(electron, [ICI], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(r.status ?? 1);
}

function git(cwd, ...args) {
  execFileSync('git', ['-c', 'user.email=banc@hive.local', '-c', 'user.name=Banc Hive', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

/** Les fichiers en lecture seule sous `dossier` — ce que git y a posé. */
function lectureSeule(dossier) {
  let n = 0;
  for (const e of readdirSync(dossier, { withFileTypes: true, recursive: true })) {
    if (e.isFile() && (statSync(path.join(e.parentPath, e.name)).mode & 0o200) === 0) n += 1;
  }
  return n;
}

const { prepareWorkspace } = await import(
  pathToFileURL(path.join(RACINE, 'dist', 'node-client', 'workspace.js')).href
);
const banc = mkdtempSync(path.join(tmpdir(), 'hive-effacement-'));
let code = 0;
try {
  const temoin = path.join(banc, 'lecture-seule');
  writeFileSync(temoin, 'x');
  chmodSync(temoin, 0o444);
  let refus = null;
  try {
    rmSync(temoin, { force: true });
  } catch (e) {
    refus = e.code ?? String(e);
  }
  console.log(
    `runtime : Electron ${process.versions.electron}, Node ${process.versions.node} · ` +
      `rmSync d'un fichier en lecture seule : ${refus === null ? 'effacé' : `REFUSÉ (${refus})`}`,
  );

  const amont = path.join(banc, 'amont');
  mkdirSync(amont);
  git(amont, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(amont, 'a.txt'), 'base\n');
  git(amont, 'add', '-A');
  git(amont, 'commit', '-q', '-m', 'base');

  const travail = path.join(banc, 'travail');
  const tache = { id: 'banc-effacement', branch: null };
  const premiere = await prepareWorkspace(travail, tache, amont);
  console.log(`1re tentative : ${lectureSeule(premiere.cwd)} fichier(s) en lecture seule laissés`);
  // Pas de `cleanup` : la ruche a redémarré pendant la tâche.
  const seconde = await prepareWorkspace(travail, tache, amont);
  console.log(`✔ 2e tentative préparée dans ${seconde.cwd}`);
  await seconde.cleanup();
} catch (e) {
  console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
  code = 1;
} finally {
  await rm(banc, { recursive: true, force: true, maxRetries: 5 });
}
process.exit(code);
