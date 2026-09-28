// LE BANC DE FUMÉE DES PAQUETS — `node desktop/scripts/fumee.mjs <artefact>`.
//
// Il INSTALLE (ou extrait) l'artefact comme le ferait quelqu'un, lance l'app
// installée avec `--diagnostic=<rapport>`, et relit le rapport avec le verdict
// de l'app (`defautsDuRapport`). Vert seulement si la Reine s'est annoncée,
// si `/api/health` répond `{ ok: true }`, si la fenêtre est sur l'origine de
// la Reine avec l'écran rendu, sans violation de CSP, et avec une capture.
//
//   Linux    .AppImage : lancé tel quel (`--appimage-extract-and-run`, sans FUSE)
//            .deb      : `dpkg-deb -I` puis `-x`, binaire extrait lancé
//                        (`--no-sandbox` : extrait sans `postinst`, le
//                        `chrome-sandbox` n'est pas setuid — le paquet
//                        installé, lui, garde le bac à sable de Chromium)
//   Windows  Hive-Setup-*.exe : `/S`, lancement, puis désinstallation `/S` —
//            et la base DOIT rester en place (ADR 0013 § 11)
//   macOS    .dmg : `hdiutil attach`, copie du `.app`, lancement
//
// Le rapport et la capture sont copiés dans `desktop/release/fumee/`, que la
// CI publie avec les paquets.

import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUREAU } from './theme.mjs';

const { defautsDuRapport } = await import(
  pathToFileURL(path.join(BUREAU, 'dist', 'diagnostic-verdict.js')).href
);

const artefact = path.resolve(process.argv[2] ?? '');
if (!existsSync(artefact)) {
  console.error(`✘ artefact introuvable : ${artefact}`);
  process.exit(2);
}
const nom = path.basename(artefact);
// `HIVE_FUMEE_DOSSIER` : où poser le banc (défaut : le dossier temporaire).
// Il reste COURT de préférence — Chromium refuse un socket d'instance unique
// dont le chemin dépasse 108 octets, et il le crée sous `TMPDIR`.
const banc = mkdtempSync(path.join(process.env.HIVE_FUMEE_DOSSIER || tmpdir(), 'hive-fumee-'));
const rapport = path.join(banc, `rapport-${nom.replace(/[^\w.-]/g, '_')}.json`);
const LIMITE_MS = 4 * 60_000;

function executer(bin, args, options = {}) {
  console.log(`$ ${bin} ${args.join(' ')}`);
  const r = spawnSync(bin, args, { stdio: 'inherit', ...options });
  if (r.status !== 0) throw new Error(`${path.basename(bin)} : code ${String(r.status)}`);
}

/** Lance l'app et attend sa sortie, bornée ; sa sortie passe dans le journal du banc. */
function lancerApp(bin, args, env = {}) {
  console.log(`$ ${bin} ${args.join(' ')}`);
  return new Promise((resoudre) => {
    const enfant = spawn(bin, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    const minuteur = setTimeout(() => {
      console.error(`✘ l'app n'est pas sortie en ${String(LIMITE_MS / 1000)} s`);
      enfant.kill('SIGKILL');
    }, LIMITE_MS);
    enfant.on('exit', (code) => {
      clearTimeout(minuteur);
      resoudre(code);
    });
    enfant.on('error', (e) => {
      clearTimeout(minuteur);
      console.error(e);
      resoudre(1);
    });
  });
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const diagnostic = `--diagnostic=${rapport}`;
const donnees = path.join(banc, 'donnees');
let verifierApres = () => [];

if (nom.endsWith('.AppImage')) {
  // Sans FUSE (runners, conteneurs), l'AppImage s'extrait avant de tourner.
  // `HIVE_FUMEE_EXTRAIRE=1` extrait DANS le banc (`--appimage-extract`) au lieu
  // de `TMPDIR`, puis lance son `AppRun` — le même point d'entrée.
  const xvfb = spawnSync('which', ['xvfb-run']).status === 0 && !process.env.DISPLAY;
  let bin = artefact;
  let args = ['--appimage-extract-and-run', diagnostic];
  if (process.env.HIVE_FUMEE_EXTRAIRE === '1') {
    executer(artefact, ['--appimage-extract'], { cwd: banc, stdio: 'ignore' });
    bin = path.join(banc, 'squashfs-root', 'AppRun');
    args = [diagnostic];
  }
  await lancerApp(xvfb ? 'xvfb-run' : bin, xvfb ? ['-a', bin, ...args] : args, {
    HIVE_BUREAU_DONNEES: donnees,
  });
} else if (nom.endsWith('.deb')) {
  executer('dpkg-deb', ['-I', artefact]);
  const racine = path.join(banc, 'deb');
  executer('dpkg-deb', ['-x', artefact, racine]);
  const bin = path.join(racine, 'opt', 'Hive', 'hive');
  const xvfb = spawnSync('which', ['xvfb-run']).status === 0 && !process.env.DISPLAY;
  const args = [bin, '--no-sandbox', diagnostic];
  await lancerApp(xvfb ? 'xvfb-run' : bin, xvfb ? ['-a', ...args] : args.slice(1), {
    HIVE_BUREAU_DONNEES: donnees,
  });
} else if (nom.endsWith('.exe')) {
  // Les VRAIS chemins d'un utilisateur : la désinstallation doit laisser
  // `%APPDATA%\Hive\ruche` en place, et c'est là qu'on regarde.
  const installe = path.join(process.env.LOCALAPPDATA, 'Programs', 'Hive');
  executer(artefact, ['/S']);
  for (let i = 0; i < 60 && !existsSync(path.join(installe, 'Hive.exe')); i++)
    await attendre(1_000);
  await lancerApp(path.join(installe, 'Hive.exe'), [diagnostic]);
  const base = path.join(process.env.APPDATA, 'Hive', 'ruche', 'data', 'hive.db');
  executer(path.join(installe, 'Uninstall Hive.exe'), ['/S']);
  // Le désinstalleur se recopie et rend la main : on attend que l'app parte.
  for (let i = 0; i < 60 && existsSync(path.join(installe, 'Hive.exe')); i++) await attendre(1_000);
  verifierApres = () => {
    const d = [];
    if (existsSync(path.join(installe, 'Hive.exe')))
      d.push('la désinstallation silencieuse n’a pas retiré Hive.exe');
    if (!existsSync(base))
      d.push(`la désinstallation a EFFACÉ la ruche (${base}) — elle doit rester`);
    return d;
  };
} else if (nom.endsWith('.dmg')) {
  const montage = path.join(banc, 'dmg');
  executer('hdiutil', ['attach', artefact, '-nobrowse', '-readonly', '-mountpoint', montage]);
  const app = path.join(banc, 'Hive.app');
  try {
    executer('ditto', [path.join(montage, 'Hive.app'), app]);
  } finally {
    executer('hdiutil', ['detach', montage, '-force']);
  }
  await lancerApp(path.join(app, 'Contents', 'MacOS', 'Hive'), [diagnostic], {
    HIVE_BUREAU_DONNEES: donnees,
  });
} else {
  console.error(`✘ artefact inconnu : ${nom}`);
  process.exit(2);
}

// ─── Le verdict ──────────────────────────────────────────────────────────────
const sortie = path.join(BUREAU, 'release', 'fumee');
mkdirSync(sortie, { recursive: true });
if (!existsSync(rapport)) {
  console.error(`✘ aucun rapport écrit (${rapport}) — l'app n'a pas atteint son diagnostic.`);
  const journaux = path.join(donnees, 'logs');
  if (existsSync(journaux)) {
    for (const f of readdirSync(journaux))
      console.error(`--- ${f}\n${readFileSync(path.join(journaux, f), 'utf8').slice(-4000)}`);
  }
  process.exit(1);
}
const r = JSON.parse(readFileSync(rapport, 'utf8'));
copyFileSync(rapport, path.join(sortie, path.basename(rapport)));
if (r.capture && existsSync(r.capture))
  copyFileSync(r.capture, path.join(sortie, path.basename(r.capture)));
const defauts = [
  ...(r.reine ? defautsDuRapport(r) : (r.defauts ?? ['rapport illisible'])),
  ...verifierApres(),
];
console.log(JSON.stringify(r, null, 2));
if (defauts.length > 0) {
  console.error(`✘ ${nom} :\n  - ${defauts.join('\n  - ')}`);
  process.exit(1);
}
console.log(
  `✔ ${nom} : la Reine répond, l'écran est rendu (${r.ouvrieres} ouvrière(s)), capture ${path.basename(r.capture)}`,
);
