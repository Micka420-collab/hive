#!/usr/bin/env node
// LE BANC DES ESPACES DE TRAVAIL (G18) — ce qu'une tentative paie avant et
// après son agent, mesuré sur ce poste.
//
//     node --import tsx scripts/banc-espaces.mjs [--racine <dossier>]
//          [--tailles petit,moyen,grand] [--tentatives 2] [--latence-ms 0]
//          [--json <fichier>]
//
// ─── POURQUOI CE BANC EXISTE ─────────────────────────────────────────────────
//
// G18 promet des espaces de travail RAPIDES : un miroir du projet (le clone
// d'une tentative ne repasse plus par l'amont), un magasin de dépendances (le
// `npm ci` d'une validation ne se refait pas quand le lockfile n'a pas bougé).
// Une promesse de vitesse qu'on ne mesure pas ne se tient pas, ni ne se
// défait : ce banc rend les chiffres AVANT, sur la révision qui ne les tient
// pas encore, puis APRÈS, sur celle qui les tient. Les deux tableaux se lisent
// ligne à ligne.
//
// ─── CE QU'IL FAIT ───────────────────────────────────────────────────────────
//
// Pour chaque taille, sous `--racine` (un dossier SUR DISQUE : le banc y écrit
// des dépôts, des clones et des `node_modules`, jamais dans le tmpfs du
// système) :
//
//   · un projet servi en HTTP par un vrai `git http-backend` (le serveur des
//     bancs, `tests/aide/serveur-git.ts`), qui compte les packs servis et sait
//     retenir chacun (`--latence-ms`) ;
//   · ses dépendances servies par un registre de tarballs LOCAL — aucun octet
//     ne sort de la machine : un banc qui dépend d'un tiers mesure le tiers ;
//   · puis N tentatives (`--tentatives`) d'une tâche du projet, chacune comme
//     le nœud la vit : l'espace préparé (`prepareWorkspace`), un fichier
//     « produit », les validations (`validerProduction`) dans le bac du poste,
//     l'espace effacé.
//
// Le bac est bubblewrap quand il répond : `npm` y a un HOME éphémère, donc un
// cache vide à chaque tentative, comme dans un conteneur. Sinon le faux moteur
// des bancs lance tout sur l'hôte — dit en tête du tableau, parce que l'`npm`
// de l'hôte y garde son cache et que l'installation y paraît plus rapide
// qu'elle n'est.
//
// ─── CE QU'IL REND ───────────────────────────────────────────────────────────
//
// Par tentative : l'effacement, le clone et le registre de l'espace (les
// phases de `prepareWorkspace`), les packs servis par l'amont, l'installation
// des dépendances (entre les deux lignes de progrès qui l'encadrent) et les
// validations en tout. En tête : le système de fichiers mesuré, le bac, les
// versions de git, de Node et de npm — un chiffre sans son décor ne se compare
// à rien.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MAL_APPELE = 64;

/** Les tailles de projet : un dépôt, et des dépendances à installer. */
export const TAILLES = Object.freeze({
  petit: { fichiers: 30, octets: 1024, paquets: 5, fichiersParPaquet: 10, octetsParFichier: 1024 },
  moyen: {
    fichiers: 300,
    octets: 4096,
    paquets: 40,
    fichiersParPaquet: 25,
    octetsParFichier: 2048,
  },
  grand: {
    fichiers: 1500,
    octets: 4096,
    paquets: 120,
    fichiersParPaquet: 40,
    octetsParFichier: 2048,
  },
});

const USAGE =
  'usage : node --import tsx scripts/banc-espaces.mjs [--racine <dossier>] ' +
  '[--tailles petit,moyen,grand] [--tentatives 2] [--latence-ms 0] [--json <fichier>]';

/** Les options du banc, ou la raison de son refus. */
export function lireArguments(argv) {
  const options = {
    racine: null,
    tailles: Object.keys(TAILLES),
    tentatives: 2,
    latenceMs: 0,
    json: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const nom = argv[i];
    const valeur = argv[i + 1];
    if (valeur === undefined) return { refus: `${nom} attend une valeur` };
    i += 1;
    if (nom === '--racine') options.racine = path.resolve(valeur);
    else if (nom === '--json') options.json = path.resolve(valeur);
    else if (nom === '--tailles') options.tailles = valeur.split(',').filter(Boolean);
    else if (nom === '--tentatives') options.tentatives = Number(valeur);
    else if (nom === '--latence-ms') options.latenceMs = Number(valeur);
    else return { refus: `option inconnue : ${nom}` };
  }
  const inconnue = options.tailles.find((t) => !Object.hasOwn(TAILLES, t));
  if (inconnue !== undefined) return { refus: `taille inconnue : ${inconnue}` };
  if (!Number.isInteger(options.tentatives) || options.tentatives < 1) {
    return { refus: '--tentatives attend un entier ≥ 1' };
  }
  if (!Number.isInteger(options.latenceMs) || options.latenceMs < 0) {
    return { refus: '--latence-ms attend un entier ≥ 0' };
  }
  return { options };
}

/** Une durée en secondes, une décimale, virgule française ; `—` sans mesure. */
export function secondes(ms) {
  return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Ce qu'une commande répond sur sa première ligne, ou `null`. */
function premiereLigne(bin, args, cwd) {
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', shell: false });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.split('\n')[0]?.trim() || null;
}

/** Le système de fichiers qui porte `dossier` — c'est lui qu'on mesure. */
function systemeDeFichiers(dossier) {
  return (
    premiereLigne('findmnt', ['-no', 'FSTYPE', '-T', dossier]) ??
    premiereLigne('stat', ['-f', '-c', '%T', dossier]) ??
    'inconnu'
  );
}

const git = (cwd, ...args) => {
  const r = spawnSync(
    'git',
    [
      '-c',
      'user.email=banc@hive.local',
      '-c',
      'user.name=Banc Hive',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', shell: false },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} : ${r.stderr}`);
  return r.stdout;
};

/** Le registre de tarballs local : chaque `<nom>.tgz` de `dossier`, servi tel quel. */
async function registreLocal(dossier) {
  const serveur = createServer((req, res) => {
    const nom = path.basename(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    const fichier = path.join(dossier, nom);
    if (!nom.endsWith('.tgz') || !existsSync(fichier)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(readFileSync(fichier));
  });
  await new Promise((pret) => serveur.listen(0, '127.0.0.1', () => pret()));
  const { port } = serveur.address();
  return {
    url: (nom) => `http://127.0.0.1:${port}/${nom}`,
    fermer: () => new Promise((fin) => serveur.close(() => fin())),
  };
}

/** Un paquet npm de `n` fichiers, empaqueté et rangé au registre. */
function paquet(dossierRegistre, registre, nom, n, octets, avecBin) {
  const source = path.join(dossierRegistre, 'sources', nom);
  const contenu = path.join(source, 'package');
  mkdirSync(path.join(contenu, 'lib'), { recursive: true });
  const manifeste = { name: nom, version: '1.0.0', main: 'index.js' };
  if (avecBin) manifeste.bin = { [nom]: 'bin.js' };
  writeFileSync(path.join(contenu, 'package.json'), JSON.stringify(manifeste));
  writeFileSync(path.join(contenu, 'index.js'), `module.exports = ${JSON.stringify(nom)};\n`);
  if (avecBin) writeFileSync(path.join(contenu, 'bin.js'), '#!/usr/bin/env node\n');
  for (let i = 0; i < n; i += 1) {
    const corps = randomBytes(Math.ceil((octets * 3) / 4)).toString('base64');
    writeFileSync(path.join(contenu, 'lib', `m${i}.js`), `// ${corps}\n`);
  }
  const archive = `${nom}-1.0.0.tgz`;
  const r = spawnSync(
    'tar',
    ['-czf', path.join(dossierRegistre, archive), '-C', source, 'package'],
    {
      shell: false,
    },
  );
  if (r.status !== 0) throw new Error(`tar : ${String(r.stderr)}`);
  const empreinte = createHash('sha512')
    .update(readFileSync(path.join(dossierRegistre, archive)))
    .digest('base64');
  return { resolved: registre.url(archive), integrity: `sha512-${empreinte}` };
}

/** Le projet d'une taille : dépôt nu servi, dépendances au registre, lockfile v3. */
function projet(racine, nom, taille, registre, dossierRegistre) {
  const copie = path.join(racine, 'copies', nom);
  mkdirSync(path.join(copie, 'src'), { recursive: true });
  const dependances = {};
  const paquets = {};
  for (let i = 0; i < taille.paquets; i += 1) {
    const dep = `banc-${nom}-dep-${i}`;
    dependances[dep] = '1.0.0';
    paquets[`node_modules/${dep}`] = {
      version: '1.0.0',
      ...paquet(
        dossierRegistre,
        registre,
        dep,
        taille.fichiersParPaquet,
        taille.octetsParFichier,
        i === 0,
      ),
      ...(i === 0 ? { bin: { [dep]: 'bin.js' } } : {}),
    };
  }
  const manifeste = {
    name: `banc-${nom}`,
    version: '1.0.0',
    private: true,
    scripts: {
      test: `node -e "for (const d of Object.keys(require('./package.json').dependencies)) require(d)"`,
    },
    dependencies: dependances,
  };
  writeFileSync(path.join(copie, 'package.json'), `${JSON.stringify(manifeste, null, 2)}\n`);
  const lockfile = {
    name: manifeste.name,
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: manifeste.name, version: '1.0.0', dependencies: dependances },
      ...paquets,
    },
  };
  writeFileSync(path.join(copie, 'package-lock.json'), `${JSON.stringify(lockfile, null, 2)}\n`);
  writeFileSync(path.join(copie, '.gitignore'), 'node_modules\n');
  // Le registre local EST le registre du projet : npm 12 refuse un tarball
  // venu d'un autre hôte que lui (`allow-remote`, défaut `none`).
  writeFileSync(
    path.join(copie, '.npmrc'),
    `registry=${registre.url('')}\naudit=false\nfund=false\n`,
  );
  for (let i = 0; i < taille.fichiers; i += 1) {
    const corps = randomBytes(Math.ceil((taille.octets * 3) / 4)).toString('base64');
    writeFileSync(path.join(copie, 'src', `f${i}.txt`), `${corps}\n`);
  }
  git(racine, 'init', '-q', copie);
  git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(copie, 'add', '--all');
  git(copie, 'commit', '-q', '-m', `projet ${nom}`);
  git(racine, 'clone', '-q', '--bare', copie, path.join(racine, 'projets', `${nom}.git`));
}

/** Le bac du poste : bubblewrap s'il lance vraiment, sinon le faux moteur des bancs. */
function bacDuPoste(racine, fournisseurParNom) {
  const bwrap = fournisseurParNom('bubblewrap');
  const essai = spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-all', '--', 'true'], {
    shell: false,
  });
  if (bwrap && essai.status === 0) {
    return { nom: 'bubblewrap', bac: { fournisseur: bwrap, image: 'sans-objet', variables: [] } };
  }
  const moteur = path.join(racine, 'faux-moteur');
  writeFileSync(
    moteur,
    '#!/bin/sh\nwhile [ "$#" -gt 0 ] && [ "$1" != "hive-banc" ]; do shift; done\nshift\nexec "$@"\n',
    { mode: 0o755 },
  );
  return {
    nom: 'faux moteur (sur l’hôte : l’npm du poste garde son cache)',
    bac: {
      fournisseur: {
        nom: 'banc',
        bin: moteur,
        niveau: 'conteneur',
        installation: '',
        garanties: [],
      },
      image: 'hive-banc',
      variables: [],
    },
  };
}

/** Une tentative, comme le nœud la vit — et ce que chaque phase a coûté. */
async function tentative(m, contexte) {
  const { serveur, bac, travail, nom, n } = contexte;
  const avant = serveur.packsServis;
  const tache = { id: `banc-${nom}-${n}`, title: nom, prompt: 'mesurer', branch: null };
  const espace = await m.prepareWorkspace(travail, tache, serveur.url(nom));
  const packs = serveur.packsServis - avant;
  try {
    writeFileSync(path.join(espace.cwd, 'produit.txt'), 'une production\n');
    const lignes = [];
    const debut = performance.now();
    const rapport = await m.validerProduction({
      cwd: espace.cwd,
      depot: { depot: espace.depot, baseSha: espace.baseSha },
      bac,
      surEtape: (ligne) => lignes.push({ t: performance.now(), ligne }),
      // Le magasin de dépendances du nœud (G18 C), comme le client le passe :
      // une révision qui ne le connaît pas ignore ce champ — le même banc
      // mesure donc l'avant et l'après.
      magasin: {
        racine: path.join(travail, 'dependances'),
        projet: nom,
        reseau: 'ouvert:libre',
        niveau: 'conteneur',
      },
    });
    const validationsMs = performance.now() - debut;
    // L'installation : de la ligne qui l'ouvre à celle qui la conclut.
    const ouverte = lignes.findIndex((l) => /^validations : préparation « .* »…$/.test(l.ligne));
    const conclue = lignes.findIndex(
      (l, i) => i > ouverte && l.ligne.startsWith('validations : préparation «'),
    );
    return {
      ...espace.durees.phases,
      packs,
      installationMs:
        ouverte >= 0 && conclue > ouverte ? lignes[conclue].t - lignes[ouverte].t : null,
      validationsMs,
      tests: rapport.controles.tests.etat,
      // Un banc dont les tests ne passent pas ne mesure pas ce qu'il croit :
      // il le dit, avec la fin de ce que la validation a vu.
      bilan:
        rapport.controles.tests.etat === 'passed'
          ? (lignes.at(-1)?.ligne ?? '')
          : `${rapport.controles.tests.raison} — ${(rapport.controles.tests.extrait ?? '').slice(-600)}`,
    };
  } finally {
    await espace.cleanup();
  }
}

/** Les modules du nœud, chargés par tsx — ou la consigne pour le lancer. */
async function chargerLeNoeud() {
  try {
    const [espace, validations, serveurGit, isolement] = await Promise.all([
      import('../src/node-client/workspace.ts'),
      import('../src/node-client/validations-bac.ts'),
      import('../tests/aide/serveur-git.ts'),
      import('../src/node-client/isolement.ts'),
    ]);
    return {
      prepareWorkspace: espace.prepareWorkspace,
      validerProduction: validations.validerProduction,
      ServeurGit: serveurGit.ServeurGit,
      fournisseurParNom: isolement.fournisseurParNom,
    };
  } catch (err) {
    if (err?.code === 'ERR_UNKNOWN_FILE_EXTENSION') return null;
    throw err;
  }
}

export async function principal(argv, ecrire = console.log) {
  const lu = lireArguments(argv);
  if (lu.refus) {
    ecrire(`${lu.refus}\n${USAGE}`);
    return MAL_APPELE;
  }
  const { options } = lu;
  const m = await chargerLeNoeud();
  if (!m) {
    ecrire(`le banc charge le code du nœud en TypeScript.\n${USAGE}`);
    return MAL_APPELE;
  }
  const parent = options.racine ?? path.join(process.cwd(), '.banc-espaces');
  mkdirSync(parent, { recursive: true });
  const racine = mkdtempSync(path.join(parent, 'banc-'));
  // Le git du nœud lit le HOME : un HOME vide, sans la configuration du poste.
  const maison = path.join(racine, 'maison');
  mkdirSync(maison);
  process.env.HOME = maison;
  process.env.USERPROFILE = maison;
  for (const d of ['projets', 'copies', 'registre', 'travail']) mkdirSync(path.join(racine, d));
  const dossierRegistre = path.join(racine, 'registre');
  const registre = await registreLocal(dossierRegistre);
  const serveur = new m.ServeurGit(path.join(racine, 'projets'));
  serveur.latencePackMs = options.latenceMs;
  await serveur.demarrer();
  const { nom: nomDuBac, bac } = bacDuPoste(racine, m.fournisseurParNom);
  const decor = {
    systeme: systemeDeFichiers(racine),
    racine,
    bac: nomDuBac,
    git: premiereLigne('git', ['--version']),
    node: process.version,
    npm: premiereLigne('npm', ['--version']),
    latenceMs: options.latenceMs,
  };
  const resultats = [];
  try {
    for (const nom of options.tailles) {
      const taille = TAILLES[nom];
      projet(racine, nom, taille, registre, dossierRegistre);
      for (let n = 1; n <= options.tentatives; n += 1) {
        const mesure = await tentative(m, {
          serveur,
          bac,
          travail: path.join(racine, 'travail'),
          nom,
          n,
        });
        resultats.push({ taille: nom, tentative: n, ...mesure });
      }
    }
  } finally {
    await serveur.fermer();
    await registre.fermer();
  }
  ecrire(
    `Banc des espaces de travail — système de fichiers ${decor.systeme} (${decor.racine}) · ` +
      `bac ${decor.bac} · ${decor.git} · Node ${decor.node} · npm ${decor.npm} · ` +
      `latence par pack ${decor.latenceMs} ms`,
  );
  ecrire('');
  ecrire(
    '| taille | tentative | effacement | clone | registre | packs servis | installation | validations | tests |',
  );
  ecrire('|---|---|---|---|---|---|---|---|---|');
  for (const r of resultats) {
    ecrire(
      `| ${r.taille} | ${r.tentative} | ${secondes(r.effacement)} | ${secondes(r.clone)} | ` +
        `${secondes(r.registre)} | ${r.packs} | ${secondes(r.installationMs)} | ` +
        `${secondes(r.validationsMs)} | ${r.tests} |`,
    );
  }
  for (const r of resultats) ecrire(`\n${r.taille} #${r.tentative} : ${r.bilan}`);
  if (options.json)
    writeFileSync(options.json, `${JSON.stringify({ decor, resultats }, null, 2)}\n`);
  rmSync(racine, { recursive: true, force: true });
  return resultats.every((r) => r.tests === 'passed') ? 0 : 1;
}

// Point d'entrée : seulement quand le fichier est LANCÉ, jamais à l'import.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await principal(process.argv.slice(2));
}
