// LE MAGASIN DE DÉPENDANCES DANS UN VRAI BAC (G18) — bubblewrap, le vrai npm,
// un registre de tarballs local (aucun octet ne sort de la machine).
//
// Le faux moteur des autres bancs lance tout sur l'hôte : il ne peut pas
// montrer ce qui rend une entrée DÉPLAÇABLE. Le bac monte toujours l'arbre au
// même point (`MONTAGE`) — le voisin de peuplement d'une tâche comme la tâche
// suivante —, si bien que ce que l'installation écrit (un lien `.bin`, le
// chemin absolu qu'un script `postinstall` consigne) se relit pareil depuis la
// copie restaurée ailleurs sur l'hôte. Ce banc le prouve dans un vrai bac :
//
//   · la première validation peuple le magasin depuis la base, la seconde
//     restaure — et son `npm run test` lance le `.bin` restauré, qui relit le
//     chemin que le `postinstall` avait écrit PENDANT LE PEUPLEMENT : il vaut
//     `/hive/tache/…`, et la copie, qui vit ailleurs sur l'hôte, le relit
//     tel quel dans le bac.
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
import { poserRegistre } from '../src/node-client/git-hote.js';
import { MONTAGE, fournisseurParNom } from '../src/node-client/isolement.js';
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

beforeAll(() => {
  racine = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hive-cache-bac-')));
});

afterAll(async () => {
  if (registre) await new Promise<void>((fin) => registre?.close(() => fin()));
  rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
});

/**
 * Le paquet du banc : un `bin`, et un `postinstall` qui écrit le chemin
 * ABSOLU où il s'installe. Son `bin` relit ce chemin et le compare au sien.
 */
function empaqueter(): Buffer {
  const source = path.join(racine, 'paquet');
  const contenu = path.join(source, 'package');
  mkdirSync(contenu, { recursive: true });
  writeFileSync(
    path.join(contenu, 'package.json'),
    JSON.stringify({
      name: 'outil-g18',
      version: '1.0.0',
      bin: { 'outil-g18': 'bin.js' },
      scripts: { postinstall: 'node postinstall.js' },
    }),
  );
  writeFileSync(
    path.join(contenu, 'postinstall.js'),
    "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'chemin.txt'), __dirname);\n",
  );
  writeFileSync(
    path.join(contenu, 'bin.js'),
    '#!/usr/bin/env node\n' +
      "const ecrit = require('node:fs').readFileSync(require('node:path').join(__dirname, 'chemin.txt'), 'utf8');\n" +
      "console.log(ecrit === __dirname ? 'relocalisé : ' + ecrit : 'AILLEURS : ' + ecrit + ' ≠ ' + __dirname);\n" +
      'process.exit(ecrit === __dirname ? 0 : 1);\n',
    { mode: 0o755 },
  );
  const archive = path.join(racine, 'outil-g18-1.0.0.tgz');
  execFileSync('tar', ['-czf', archive, '-C', source, 'package']);
  return readFileSync(archive);
}

describe('le magasin de dépendances dans un vrai bac (bubblewrap)', () => {
  it.skipIf(!bwrap && !bwrapRequis)(
    'peuplé à la base, restauré dans la tâche : le .bin et le chemin écrit par postinstall se relisent pareil',
    async () => {
      expect(bwrap, 'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui démarre').not.toBeNull();
      const tarball = empaqueter();
      const serveur = createServer((req, res) => {
        const servi = req.url === '/outil-g18/-/outil-g18-1.0.0.tgz';
        res.writeHead(servi ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
        res.end(servi ? tarball : undefined);
      });
      registre = serveur;
      await new Promise<void>((pret) => serveur.listen(0, '127.0.0.1', () => pret()));
      const url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/`;
      const src = path.join(racine, 'source');
      mkdirSync(src);
      const fichiers: Record<string, string> = {
        // Le registre local EST celui du projet : npm 12 refuse un tarball
        // d'un autre hôte (`allow-remote`). `allowScripts` : npm 12 ne lance
        // le `postinstall` d'une dépendance que si le projet l'autorise.
        '.npmrc': `registry=${url}\naudit=false\nfund=false\nupdate-notifier=false\n`,
        'package.json': JSON.stringify({
          name: 'projet-bac',
          version: '1.0.0',
          private: true,
          scripts: { test: 'outil-g18' },
          dependencies: { 'outil-g18': '1.0.0' },
          allowScripts: { 'outil-g18': true },
        }),
        'package-lock.json': JSON.stringify({
          name: 'projet-bac',
          version: '1.0.0',
          lockfileVersion: 3,
          requires: true,
          packages: {
            '': { name: 'projet-bac', version: '1.0.0', dependencies: { 'outil-g18': '1.0.0' } },
            'node_modules/outil-g18': {
              version: '1.0.0',
              resolved: `${url}outil-g18/-/outil-g18-1.0.0.tgz`,
              integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
              hasInstallScript: true,
              bin: { 'outil-g18': 'bin.js' },
            },
          },
        }),
        '.gitignore': 'node_modules\n',
      };
      for (const [nom, contenu] of Object.entries(fichiers)) {
        writeFileSync(path.join(src, nom), contenu);
      }
      git(src, 'init', '-q');
      git(src, 'add', '--all');
      git(src, 'commit', '-q', '-m', 'base');
      const magasin = {
        racine: path.join(racine, 'magasin'),
        projet: 'projet-bac',
        reseau: 'dependances:libre',
        niveau: 'conteneur',
      };

      const valider = async (nom: string) => {
        const parent = path.join(racine, nom);
        mkdirSync(parent);
        const dir = path.join(parent, 't');
        git(parent, 'clone', '-q', src, dir);
        const baseSha = git(dir, 'rev-parse', 'HEAD').trim();
        mkdirSync(path.join(parent, 't.git'));
        writeFileSync(path.join(dir, 'produit.txt'), 'une production\n');
        const etapes: string[] = [];
        const rapport = await validerProduction({
          cwd: dir,
          depot: { depot: await poserRegistre(dir, path.join(parent, 't.git'), baseSha), baseSha },
          bac: { fournisseur: bwrap!, image: 'sans-objet', variables: [] },
          surEtape: (l) => etapes.push(l),
          magasin,
        });
        return { dir, etapes, tests: rapport.controles.tests };
      };

      const premiere = await valider('t1');
      const seconde = await valider('t2');

      expect(premiere.tests, premiere.etapes.join('\n')).toMatchObject({ etat: 'passed', code: 0 });
      expect(premiere.etapes.join('\n')).toContain(
        '— dépendances installées à la base, rangées au magasin du nœud',
      );
      expect(seconde.tests, seconde.etapes.join('\n')).toMatchObject({ etat: 'passed', code: 0 });
      expect(seconde.etapes.join('\n')).toContain('— dépendances restaurées du magasin du nœud');
      // Le chemin que le postinstall a écrit pendant le PEUPLEMENT est celui du
      // montage, pas un chemin de l'hôte : la copie le relit tel quel.
      const installe = path.join(seconde.dir, 'node_modules', 'outil-g18');
      expect(readFileSync(path.join(installe, 'chemin.txt'), 'utf8')).toBe(
        `${MONTAGE}/node_modules/outil-g18`,
      );
      expect(readlinkSync(path.join(seconde.dir, 'node_modules', '.bin', 'outil-g18'))).toBe(
        '../outil-g18/bin.js',
      );
    },
    180_000,
  );
});
