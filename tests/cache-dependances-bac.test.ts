// LE MAGASIN DE DÉPENDANCES DANS UN VRAI BAC (G18) — bubblewrap, le vrai npm,
// un registre de tarballs local (aucun octet ne sort de la machine).
//
// Le faux moteur des autres bancs lance tout sur l'hôte, et son faux `npm ci`
// ne fait que ce qu'on lui dit. Ce banc-ci montre, dans un vrai bac et avec le
// vrai npm :
//
//   · ce qui rend une entrée DÉPLAÇABLE : le bac monte toujours l'arbre au
//     même point (`MONTAGE`), si bien que le lien `.bin` que npm écrit pendant
//     le peuplement se relit pareil dans la tâche qui l'a fait peupler (qui
//     reçoit l'installation elle-même) et dans la suivante (qui en reçoit une
//     copie, restaurée ailleurs sur l'hôte) ;
//   · pourquoi une dépendance à script d'installation n'y entre JAMAIS : npm
//     donne à son `postinstall` la racine du projet (`INIT_CWD`), et ce script
//     y lit un fichier que la clé ne couvre pas — peuplée à la base, l'entrée
//     servirait à la tête ce que la base contenait.
//
// La CI Linux installe bubblewrap et pose `HIVE_BWRAP_REQUIS=1` : là, un
// bubblewrap absent ou bloqué fait ÉCHOUER le banc au lieu de le sauter.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MagasinDependances } from '../src/node-client/cache-dependances.js';
import { poserRegistre } from '../src/node-client/git-hote.js';
import { fournisseurParNom } from '../src/node-client/isolement.js';
import type { Fournisseur } from '../src/node-client/isolement.js';
import { validerProduction } from '../src/node-client/validations-bac.js';

const bwrapRequis = process.env.HIVE_BWRAP_REQUIS === '1';

function bwrapDisponible(): Fournisseur | null {
  if (process.platform !== 'linux') return null;
  try {
    // `--version` répond même quand les espaces de noms utilisateur sont
    // refusés (AppArmor d'Ubuntu 24.04) : on éprouve un vrai lancement.
    execFileSync('bwrap', ['--ro-bind', '/', '/', '--unshare-all', '--', 'true'], {
      stdio: 'ignore',
      timeout: 8_000,
    });
    return fournisseurParNom('bubblewrap');
  } catch {
    return null;
  }
}

const bwrap = bwrapDisponible();

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
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
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

let racine: string;
let registre: ReturnType<typeof createServer> | null = null;
/** L'adresse du registre local, et l'empreinte `integrity` de chaque archive. */
let url = '';
const integrites = new Map<string, string>();

/** Une archive npm (`package/…`), servie par le registre local à son URL. */
function empaqueter(nom: string, fichiers: Record<string, string>): Buffer {
  const source = path.join(racine, `paquet-${nom}`);
  const contenu = path.join(source, 'package');
  mkdirSync(contenu, { recursive: true });
  for (const [fichier, texte] of Object.entries(fichiers)) {
    writeFileSync(path.join(contenu, fichier), texte, { mode: 0o755 });
  }
  const archive = path.join(racine, `${nom}-1.0.0.tgz`);
  execFileSync('tar', ['-czf', archive, '-C', source, 'package']);
  return readFileSync(archive);
}

beforeAll(async () => {
  racine = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hive-cache-bac-')));
  const archives = new Map<string, Buffer>([
    // Un `bin`, et rien d'autre : `npm ci` télécharge, extrait et lie.
    [
      'outil-g18',
      empaqueter('outil-g18', {
        'package.json': JSON.stringify({
          name: 'outil-g18',
          version: '1.0.0',
          bin: { 'outil-g18': 'bin.js' },
        }),
        'bin.js': "#!/usr/bin/env node\nconsole.log('outil lancé depuis ' + __dirname);\n",
      }),
    ],
    // Le `postinstall` qui LIT LE PROJET — ce que `@prisma/client` fait de son schéma.
    [
      'lit-le-projet',
      empaqueter('lit-le-projet', {
        'package.json': JSON.stringify({
          name: 'lit-le-projet',
          version: '1.0.0',
          scripts: { postinstall: 'node postinstall.js' },
        }),
        'postinstall.js':
          "const path = require('node:path');\n" +
          "require('node:fs').copyFileSync(path.join(process.env.INIT_CWD, 'schema.txt'), path.join(__dirname, 'schema.txt'));\n",
      }),
    ],
  ]);
  for (const [nom, archive] of archives) {
    integrites.set(nom, `sha512-${createHash('sha512').update(archive).digest('base64')}`);
  }
  const serveur = createServer((req, res) => {
    const nom = /^\/([a-z0-9-]+)\/-\/\1-1\.0\.0\.tgz$/.exec(req.url ?? '')?.[1];
    const archive = nom === undefined ? undefined : archives.get(nom);
    res.writeHead(archive ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
    res.end(archive);
  });
  registre = serveur;
  await new Promise<void>((pret) => serveur.listen(0, '127.0.0.1', () => pret()));
  url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  if (registre) await new Promise<void>((fin) => registre?.close(() => fin()));
  rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
});

/** Un projet qui dépend de `paquet` — sa base, commitée. */
function projet(nom: string, paquet: string, extra: Record<string, string>): string {
  const src = path.join(racine, `source-${nom}`);
  mkdirSync(src);
  const paquetAuLockfile: Record<string, unknown> = {
    version: '1.0.0',
    resolved: `${url}${paquet}/-/${paquet}-1.0.0.tgz`,
    integrity: integrites.get(paquet),
    ...(paquet === 'outil-g18' ? { bin: { 'outil-g18': 'bin.js' } } : { hasInstallScript: true }),
  };
  const fichiers: Record<string, string> = {
    // Le registre local EST celui du projet : npm 12 refuse un tarball
    // d'un autre hôte (`allow-remote`). `allowScripts` : npm 12 ne lance
    // le `postinstall` d'une dépendance que si le projet l'autorise.
    '.npmrc': `registry=${url}\naudit=false\nfund=false\nupdate-notifier=false\n`,
    'package.json': JSON.stringify({
      name: nom,
      version: '1.0.0',
      private: true,
      scripts: { test: paquet === 'outil-g18' ? 'outil-g18' : 'node compare.js' },
      dependencies: { [paquet]: '1.0.0' },
      allowScripts: { [paquet]: true },
    }),
    'package-lock.json': JSON.stringify({
      name: nom,
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: nom, version: '1.0.0', dependencies: { [paquet]: '1.0.0' } },
        [`node_modules/${paquet}`]: paquetAuLockfile,
      },
    }),
    '.gitignore': 'node_modules\n',
    ...extra,
  };
  for (const [fichier, contenu] of Object.entries(fichiers)) {
    writeFileSync(path.join(src, fichier), contenu);
  }
  git(src, 'init', '-q');
  git(src, 'add', '--all');
  git(src, 'commit', '-q', '-m', 'base');
  return src;
}

/** Une tâche clonée de `src`, sa production posée, validée dans le vrai bac. */
async function valider(
  src: string,
  nom: string,
  magasin: MagasinDependances,
  production: Record<string, string>,
) {
  const parent = path.join(racine, nom);
  mkdirSync(parent);
  const dir = path.join(parent, 't');
  git(parent, 'clone', '-q', src, dir);
  const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
  mkdirSync(path.join(parent, 't.git'));
  for (const [fichier, contenu] of Object.entries(production)) {
    writeFileSync(path.join(dir, fichier), contenu);
  }
  const etapes: string[] = [];
  const rapport = await validerProduction({
    cwd: dir,
    depot: { depot: await poserRegistre(dir, path.join(parent, 't.git'), baseSha), baseSha },
    bac: { fournisseur: bwrap!, image: 'sans-objet', variables: [] },
    surEtape: (l) => etapes.push(l),
    magasin,
  });
  return { dir, etapes, tests: rapport.controles.tests };
}

describe('le magasin de dépendances dans un vrai bac (bubblewrap)', () => {
  it.skipIf(!bwrap && !bwrapRequis)(
    'installé à la base, reçu par la tâche, restauré dans la suivante : le .bin se relit pareil',
    async () => {
      expect(bwrap, 'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui démarre').not.toBeNull();
      const src = projet('projet-bin', 'outil-g18', {});
      const magasin = {
        racine: path.join(racine, 'magasin-bin'),
        projet: 'projet-bin',
        reseau: 'dependances:libre',
        niveau: 'conteneur',
      };
      const production = { 'produit.txt': 'une production\n' };

      const premiere = await valider(src, 't1', magasin, production);
      const seconde = await valider(src, 't2', magasin, production);

      expect(premiere.tests, premiere.etapes.join('\n')).toMatchObject({ etat: 'passed', code: 0 });
      expect(premiere.etapes.join('\n')).toContain(
        '— dépendances installées à la base, rangées au magasin du nœud',
      );
      expect(seconde.tests, seconde.etapes.join('\n')).toMatchObject({ etat: 'passed', code: 0 });
      expect(seconde.etapes.join('\n')).toContain('— dépendances restaurées du magasin du nœud');
      for (const { dir } of [premiere, seconde]) {
        expect(readlinkSync(path.join(dir, 'node_modules', '.bin', 'outil-g18'))).toBe(
          '../outil-g18/bin.js',
        );
      }
    },
    180_000,
  );

  it.skipIf(!bwrap && !bwrapRequis)(
    'un postinstall qui lit le projet (INIT_CWD) : jamais servi depuis le magasin',
    async () => {
      expect(bwrap, 'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui démarre').not.toBeNull();
      const src = projet('projet-schema', 'lit-le-projet', {
        'schema.txt': 'model User { id }\n',
        'compare.js':
          "const fs = require('node:fs');\n" +
          "const fige = fs.readFileSync('node_modules/lit-le-projet/schema.txt', 'utf8');\n" +
          "if (fige !== fs.readFileSync('schema.txt', 'utf8')) { console.error('figé : ' + fige); process.exit(1); }\n" +
          "console.log('schéma à jour');\n",
      });
      const magasin = {
        racine: path.join(racine, 'magasin-schema'),
        projet: 'projet-schema',
        reseau: 'dependances:libre',
        niveau: 'conteneur',
      };

      // La tête change le schéma ; le postinstall, lancé dans SON arbre, le lit.
      const v = await valider(src, 't3', magasin, { 'schema.txt': 'model User { id email }\n' });

      expect(v.tests, v.etapes.join('\n')).toMatchObject({ etat: 'passed', code: 0 });
      expect(v.etapes.join('\n')).toContain(
        'hors magasin : une dépendance à script d’installation (elle peut lire l’arbre) (node_modules/lit-le-projet)',
      );
      expect(
        readFileSync(path.join(v.dir, 'node_modules', 'lit-le-projet', 'schema.txt'), 'utf8'),
      ).toBe('model User { id email }\n');
    },
    180_000,
  );
});
