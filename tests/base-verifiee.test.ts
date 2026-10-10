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
import { poserRegistre } from '../src/node-client/git-hote.js';
import {
  BaseFalsifiee,
  lireFichierDeBaseVerifie,
  oidDeBaseVerifie,
} from '../src/node-client/base-verifiee.js';
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
      expect(await oidDeBaseVerifie(depot, baseSha, 'lien')).toBeNull();
    },
    30_000,
  );
});

describe('oidDeBaseVerifie — l’empreinte vérifiée, sans lire le blob', () => {
  it('rend l’empreinte de l’entrée d’arbre d’un fichier sain, null si absent', async () => {
    const pkg = '{\n  "name": "p"\n}\n';
    const { dir, depot, baseSha } = await depotEtRegistre({
      'package.json': pkg,
      'a/b.txt': 'x\n',
    });
    const attendu = (
      await simpleGit({ baseDir: dir }).revparse([`${baseSha}:package.json`])
    ).trim();

    expect(await oidDeBaseVerifie(depot, baseSha, 'package.json')).toBe(attendu);
    expect(await oidDeBaseVerifie(depot, baseSha, 'a/b.txt')).toBe(
      (await simpleGit({ baseDir: dir }).revparse([`${baseSha}:a/b.txt`])).trim(),
    );
    expect(await oidDeBaseVerifie(depot, baseSha, 'manquant')).toBeNull();
    expect(await oidDeBaseVerifie(depot, baseSha, 'a')).toBeNull(); // un dossier n'est pas un fichier
  }, 30_000);

  it('lève sur un ARBRE forgé — l’empreinte vient d’un pointeur vérifié', async () => {
    const { dir, depot, baseSha } = await depotEtRegistre({ 'sous/lock.json': '{}\n' });
    const treeSous = (await simpleGit({ baseDir: dir }).revparse([`${baseSha}:sous`])).trim();
    // L'arbre `sous` remplacé par un autre arbre valide sous son nom.
    forger(
      path.join(dir, '.git'),
      treeSous,
      'tree',
      Buffer.concat([Buffer.from('100644 lock.json\0'), Buffer.alloc(20)]),
    );
    await expect(oidDeBaseVerifie(depot, baseSha, 'sous/lock.json')).rejects.toThrow(BaseFalsifiee);
  }, 30_000);
});
