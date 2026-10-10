// LA LECTURE VÉRIFIÉE DE LA BASE — le cœur de la porte, éprouvé seul sur de
// vrais dépôts git (`git init`, registre de la ruche par `poserRegistre`, objets
// empruntés par `alternates` comme en production).
//
// Ce que ce banc tient :
//   · une base SAINE se lit à l'identique — aucune régression de comportement ;
//   · un objet FORGÉ (le contenu d'un objet git remplacé sous le nom d'un
//     autre : la faille des objets libres non vérifiés, mesurée sur git 2.53)
//     lève `BaseFalsifiee` en nommant le fichier — jamais le contenu forgé ;
//     que l'objet forgé soit le blob lu, ou un arbre du chemin ;
//   · un fichier absent de la base rend `null` — ce n'est pas une falsification ;
//   · `fichierDeBase`, la porte que partagent le plan de validation et la porte
//     de sécurité, remonte la même alarme.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { execFileSync } from 'node:child_process';
import {
  diffContreBase,
  figerArbreLivre,
  poserRegistre,
  verifierLivreContreBase,
} from '../src/node-client/git-hote.js';
import { BaseFalsifiee, lireFichierDeBaseVerifie } from '../src/node-client/base-verifiee.js';
import { fichierDeBase } from '../src/node-client/validations-bac.js';
import type { DepotEpingle } from '../src/shared/git-protege.js';

const dossiers: string[] = [];

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

/** Un dépôt `git init` (objets LIBRES, comme un clone avant empaquetage), + son registre. */
async function depotEtRegistre(
  fichiers: Record<string, string>,
): Promise<{ dir: string; depot: DepotEpingle; baseSha: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'base-verifiee-'));
  dossiers.push(dir);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(dir, nom)), { recursive: true });
    writeFileSync(path.join(dir, nom), contenu);
  }
  const git = simpleGit({ baseDir: dir });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  const baseSha = (await git.revparse(['HEAD'])).trim();
  const registre = mkdtempSync(`${dir}.registre-`);
  dossiers.push(registre);
  const depot = await poserRegistre(dir, registre, baseSha);
  return { dir, depot, baseSha };
}

/** L'empreinte d'un objet git — ce que git a rangé le fichier sous. */
const empreinte = (type: string, contenu: Buffer): string =>
  createHash('sha1').update(`${type} ${contenu.length}\0`).update(contenu).digest('hex');

/** Le chemin du fichier d'objet LIBRE de `oid` dans un git dir. */
const cheminObjet = (gitDir: string, oid: string): string =>
  path.join(gitDir, 'objects', oid.slice(0, 2), oid.slice(2));

/**
 * FORGE l'objet `oid` : remplace son fichier par un objet valide d'un AUTRE
 * contenu, rangé sous le MÊME nom. Exactement ce qu'un agent fait dans le
 * `.git` de sa tâche — git ne vérifie pas l'empreinte de ce qu'il lit.
 */
function forger(gitDir: string, oid: string, type: 'blob' | 'tree', contenu: Buffer): void {
  const brut = Buffer.concat([Buffer.from(`${type} ${contenu.length}\0`), contenu]);
  const fichier = cheminObjet(gitDir, oid);
  mkdirSync(path.dirname(fichier), { recursive: true });
  // git range ses objets libres en lecture seule (0444) : on efface d'abord,
  // comme un agent qui remplace l'objet dans le `.git` de sa tâche.
  rmSync(fichier, { force: true });
  writeFileSync(fichier, deflateSync(brut));
}

describe('lireFichierDeBaseVerifie — la base saine lue, la base forgée rejetée', () => {
  it('une base SAINE se lit à l’identique, fichier à la racine comme en sous-dossier', async () => {
    const pkg = '{\n  "name": "p",\n  "scripts": { "test": "vitest run" }\n}\n';
    const src = 'export const x = 1;\n';
    const { depot, baseSha } = await depotEtRegistre({
      'package.json': pkg,
      'src/a.ts': src,
    });

    expect(await lireFichierDeBaseVerifie(depot, baseSha, 'package.json')).toBe(pkg);
    expect(await lireFichierDeBaseVerifie(depot, baseSha, 'src/a.ts')).toBe(src);
    // Absent : `null`, pas une alarme.
    expect(await lireFichierDeBaseVerifie(depot, baseSha, 'manquant.json')).toBeNull();
    expect(await lireFichierDeBaseVerifie(depot, baseSha, 'src/manquant.ts')).toBeNull();
    // Un dossier n'est pas un fichier.
    expect(await lireFichierDeBaseVerifie(depot, baseSha, 'src')).toBeNull();
  }, 30_000);

  it('un BLOB forgé (package.json maquillé en « exit 0 ») est rejeté, le fichier nommé', async () => {
    const vrai = '{"name":"p","scripts":{"test":"vitest run"}}\n';
    const { dir, depot, baseSha } = await depotEtRegistre({ 'package.json': vrai });
    const blob = empreinte('blob', Buffer.from(vrai));
    // L'agent forge le blob du package.json de base.
    forger(
      path.join(dir, '.git'),
      blob,
      'blob',
      Buffer.from('{"name":"p","scripts":{"test":"exit 0"}}\n'),
    );

    // Le contenu forgé ne sort jamais : la lecture lève, en nommant le fichier.
    await expect(lireFichierDeBaseVerifie(depot, baseSha, 'package.json')).rejects.toThrow(
      BaseFalsifiee,
    );
    await expect(lireFichierDeBaseVerifie(depot, baseSha, 'package.json')).rejects.toThrow(
      /package\.json/,
    );
    // La porte partagée remonte la même alarme.
    await expect(fichierDeBase(depot, baseSha, 'package.json')).rejects.toBeInstanceOf(
      BaseFalsifiee,
    );
  }, 30_000);

  it('un ARBRE forgé (pour détourner un fichier) est rejeté avant d’atteindre le blob', async () => {
    const { dir, depot, baseSha } = await depotEtRegistre({
      'package.json': '{"name":"p"}\n',
      'src/a.ts': 'export const x = 1;\n',
    });
    // L'arbre `src`, remplacé sous son nom par un AUTRE arbre valide (une entrée
    // qui pointe ailleurs) : l'agent détourne ainsi un sous-dossier entier. Son
    // empreinte ne peut plus être celle que la racine nomme.
    const treeSrc = (await simpleGit({ baseDir: dir }).revparse([`${baseSha}:src`])).trim();
    const autreArbre = Buffer.concat([Buffer.from('100644 a.ts\0'), Buffer.alloc(20)]);
    forger(path.join(dir, '.git'), treeSrc, 'tree', autreArbre);

    await expect(lireFichierDeBaseVerifie(depot, baseSha, 'src/a.ts')).rejects.toThrow(
      BaseFalsifiee,
    );
  }, 30_000);

  // Un lien symbolique ou un sous-module (gitlink) n'est pas un fichier qu'on
  // lit comme un blob : `absent` (null), jamais une alarme (`cat-file blob` sur
  // un gitlink échouerait et lèverait à tort) — correctif du mineur relevé.
  it.runIf(process.platform !== 'win32')(
    'un lien symbolique de la base est « absent », pas une falsification',
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'base-verifiee-lien-'));
      dossiers.push(dir);
      writeFileSync(path.join(dir, 'cible.txt'), 'contenu\n');
      const git = simpleGit({ baseDir: dir });
      await git.init();
      await git.addConfig('user.email', 'banc@hive.test');
      await git.addConfig('user.name', 'Banc Hive');
      await git.addConfig('commit.gpgsign', 'false');
      // git enregistre un lien symbolique en mode 120000 (détecté à l'ajout).
      symlinkSync('cible.txt', path.join(dir, 'lien'));
      await git.add('.');
      await git.commit('base');
      const baseSha = (await git.revparse(['HEAD'])).trim();
      const registre = mkdtempSync(`${dir}.registre-`);
      dossiers.push(registre);
      const depot = await poserRegistre(dir, registre, baseSha);

      expect(await lireFichierDeBaseVerifie(depot, baseSha, 'lien')).toBeNull();
    },
    30_000,
  );
});

/**
 * Un dépôt source, son clone et son registre. `superficiel` reproduit le clone
 * de production (`--depth 1`, objets EMPAQUETÉS) ; sans lui, les objets sont
 * LIBRES (liens durs) — forger en remplace alors la SEULE copie.
 */
async function cloneEtRegistre(
  fichiers: Record<string, string>,
  superficiel = true,
): Promise<{ dir: string; depot: DepotEpingle; baseSha: string }> {
  const source = mkdtempSync(path.join(os.tmpdir(), 'base-verifiee-src-'));
  dossiers.push(source);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(source, nom)), { recursive: true });
    writeFileSync(path.join(source, nom), contenu);
  }
  const git = simpleGit({ baseDir: source });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'base-verifiee-clone-'));
  dossiers.push(dir, `${dir}.verif`, `${dir}.verif.tmp`);
  rmSync(dir, { recursive: true, force: true });
  const args = superficiel
    ? ['clone', '-q', '--depth', '1', `file://${source}`, dir]
    : ['clone', '-q', source, dir];
  execFileSync('git', args);
  const baseSha = (await simpleGit({ baseDir: dir }).revparse(['HEAD'])).trim();
  const registre = mkdtempSync(`${dir}.registre-`);
  dossiers.push(registre);
  const depot = await poserRegistre(dir, registre, baseSha);
  return { dir, depot, baseSha };
}

describe('verifierLivreContreBase — ce qui serait livré est-il ce qui est jugé', () => {
  it('CONFORME : base saine, le diff livré redonne l’arbre jugé', async () => {
    const { dir, depot, baseSha } = await cloneEtRegistre({
      'package.json': '{"a":1}\n',
      'code.js': 'x\n',
    });
    writeFileSync(path.join(dir, 'code.js'), 'y\n'); // « production »
    const arbre = await figerArbreLivre(depot);
    const diff = await diffContreBase(depot, baseSha);
    const r = await verifierLivreContreBase(depot, baseSha, arbre, diff, `${dir}.verif`);
    expect(r.etat).toBe('conforme');
  }, 60_000);

  it('FALSIFIE : base forgée dont la copie saine a disparu — non récupérable intègre', async () => {
    // Objets LIBRES (clone non superficiel) : forger remplace la SEULE copie du
    // blob de base — c'est le cas où `git diff` lit le forgé et livrerait autre
    // chose que le jugé. Le `fetch` vérifié ne peut plus récupérer la base saine.
    const { dir, depot, baseSha } = await cloneEtRegistre(
      { 'fixtures/vieux.json': '{"v":"1.2.0"}\n', 'code.js': 'x\n' },
      false,
    );
    forger(
      path.join(dir, '.git'),
      empreinte('blob', Buffer.from('{"v":"1.2.0"}\n')),
      'blob',
      Buffer.from('{"v":"1.2.6"}\n'),
    );
    rmSync(path.join(dir, 'fixtures', 'vieux.json'));
    writeFileSync(path.join(dir, 'package-lock.json'), '{"v":"1.2.6"}\n');
    const arbre = await figerArbreLivre(depot);
    const diff = await diffContreBase(depot, baseSha);
    const r = await verifierLivreContreBase(depot, baseSha, arbre, diff, `${dir}.verif`);
    expect(r.etat).toBe('falsifie');
  }, 60_000);

  it('FALSIFIE : l’arbre obtenu diffère de l’arbre jugé (diff qui ne redonne pas la tête)', async () => {
    // Base saine récupérable, mais le diff livré n'aboutit pas à l'arbre jugé :
    // c'est exactement ce qu'une base forgée produit quand le `fetch` rend le
    // sain mais que `git diff` a lu autre chose. Éprouvé en passant un arbre
    // jugé qui n'est pas celui que le diff reconstruit.
    const { dir, depot, baseSha } = await cloneEtRegistre({ 'code.js': 'x\n' });
    writeFileSync(path.join(dir, 'code.js'), 'y\n');
    const diff = await diffContreBase(depot, baseSha);
    const arbreFaux = empreinte('blob', Buffer.from('rien de tel\n')); // un OID qui n'est pas l'arbre livré
    const r = await verifierLivreContreBase(depot, baseSha, arbreFaux, diff, `${dir}.verif`);
    expect(r.etat).toBe('falsifie');
  }, 60_000);

  it('CONFORME : binaires créé/modifié/supprimé/renommé, lien à la place d’un binaire, sous-module', async () => {
    // Rien de cela ne s'applique par le contenu (« Binary files … differ ») ou
    // ne se lit comme du texte (`Subproject commit`) — et tout est conforme :
    // ni faux `falsifie`, ni `invérifiable` qui éteindrait le contrôle.
    const gros = `\0${'x'.repeat(3000)}`;
    const { dir, depot, baseSha } = await cloneEtRegistre({
      'code.js': 'x\n',
      'img.bin': '\0a',
      'vieux.bin': `\0${'v'.repeat(50)}`,
      'lien.bin': '\0l',
      'gros.bin': gros,
    });
    writeFileSync(path.join(dir, 'code.js'), 'y\n');
    writeFileSync(path.join(dir, 'img.bin'), '\0b');
    rmSync(path.join(dir, 'vieux.bin'));
    writeFileSync(path.join(dir, 'neuf.bin'), `\0${'n'.repeat(50)}`);
    rmSync(path.join(dir, 'gros.bin'));
    writeFileSync(path.join(dir, 'gros2.bin'), `${gros}zz`); // renommé ET modifié
    if (process.platform !== 'win32') {
      // Binaire → lien : deux strophes du même chemin, suppression puis création.
      rmSync(path.join(dir, 'lien.bin'));
      symlinkSync('code.js', path.join(dir, 'lien.bin'));
    }
    const sous = path.join(dir, 'sous');
    mkdirSync(sous);
    writeFileSync(path.join(sous, 'f'), '1\n');
    const ident = ['-c', 'user.name=b', '-c', 'user.email=b@h', '-c', 'commit.gpgsign=false'];
    execFileSync('git', ['-C', sous, 'init', '-q']);
    execFileSync('git', ['-C', sous, ...ident, 'add', 'f']);
    execFileSync('git', ['-C', sous, ...ident, 'commit', '-qm', 's']);
    const diff = await diffContreBase(depot, baseSha);
    const arbre = await figerArbreLivre(depot);
    expect(diff).toContain('\nBinary files ');
    expect(diff).toContain('\nrename from gros.bin\n');
    expect(diff).toContain('\n+Subproject commit ');
    const r = await verifierLivreContreBase(depot, baseSha, arbre, diff, `${dir}.verif`);
    expect(r).toEqual({ etat: 'conforme' });
  }, 60_000);

  it('CONFORME sous la configuration globale du membre (`diff.noprefix`, couleur, sous-modules)', async () => {
    // gitHote lit la configuration globale à dessein : sous `diff.noprefix`, le
    // diff n'avait plus de préfixes et `apply` le refusait — chaque production
    // du membre aurait été dite « base falsifiée ».
    const { dir, depot, baseSha } = await cloneEtRegistre({ 'src/code.js': 'x\n' });
    writeFileSync(path.join(dir, 'src', 'code.js'), 'y\n');
    const maison = mkdtempSync(path.join(os.tmpdir(), 'base-verifiee-maison-'));
    dossiers.push(maison);
    writeFileSync(
      path.join(maison, '.gitconfig'),
      '[diff]\n\tnoprefix = true\n\tsubmodule = log\n[color]\n\tui = always\n',
    );
    const avant = process.env.HOME;
    process.env.HOME = maison;
    try {
      const diff = await diffContreBase(depot, baseSha);
      const arbre = await figerArbreLivre(depot);
      const r = await verifierLivreContreBase(depot, baseSha, arbre, diff, `${dir}.verif`);
      expect(r).toEqual({ etat: 'conforme' });
      expect(diff).toContain('diff --git a/src/code.js b/src/code.js\n');
    } finally {
      if (avant === undefined) delete process.env.HOME;
      else process.env.HOME = avant;
    }
  }, 60_000);

  it('FALSIFIE : un binaire n’éteint pas le contrôle — le texte livré reste vérifié', async () => {
    // Le hunk qu'aurait calculé une base forgée : il s'applique sur la vraie
    // base, en un contenu que personne n'a jugé. La strophe binaire faisait
    // échouer `apply` en entier, et le contrôle rendait `invérifiable`.
    const { dir, depot, baseSha } = await cloneEtRegistre({ 'code.js': 'x\n', 'img.bin': '\0a' });
    writeFileSync(path.join(dir, 'code.js'), 'y\n');
    writeFileSync(path.join(dir, 'img.bin'), '\0b');
    const diff = await diffContreBase(depot, baseSha);
    const arbre = await figerArbreLivre(depot);
    const livre = diff.replace('\n+y\n', '\n+z\n');
    expect(livre).not.toBe(diff);
    const r = await verifierLivreContreBase(depot, baseSha, arbre, livre, `${dir}.verif`);
    expect(r.etat).toBe('falsifie');
  }, 60_000);

  it('FALSIFIE : « Subproject commit » ou « Binary files » dans une ligne de CONTENU ne rend pas invérifiable', async () => {
    // Un hunk contre un blob que la vraie base n'a pas (ce que donne une base
    // forgée) ne s'applique pas ; le marqueur, écrit par l'agent dans une
    // ligne ajoutée, faisait passer cet échec pour un sous-module.
    const { dir, depot, baseSha } = await cloneEtRegistre({ 'code.js': 'x\n' });
    const marqueurs = `Subproject commit ${'0'.repeat(40)}\nBinary files a and b differ\n`;
    writeFileSync(path.join(dir, 'code.js'), `y\n${marqueurs}`);
    const diff = await diffContreBase(depot, baseSha);
    const arbre = await figerArbreLivre(depot);
    const livre = diff.replace('\n-x\n', '\n-forge\n');
    expect(livre).not.toBe(diff);
    const r = await verifierLivreContreBase(depot, baseSha, arbre, livre, `${dir}.verif`);
    expect(r.etat).toBe('falsifie');
  }, 60_000);
});
