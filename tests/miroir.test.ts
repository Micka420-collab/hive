// Le miroir — la partie qui touche le disque, donc celle qu'on ne peut pas
// prouver par le raisonnement seul.
//
// ─── CE QUE CE FICHIER TESTE, ET QUE `rayon.test.ts` NE PEUT PAS ─────────────
//
// La règle pure refuse `..`, l'absolu et l'octet nul. Elle ne peut RIEN contre
// un lien symbolique dans le dépôt : `docs/tout → /` est un chemin parfaitement
// relatif et parfaitement innocent à la lecture. Un lien ne se voit qu'en
// interrogeant le disque.
//
// Ce fichier crée donc de VRAIS liens symboliques, dans un VRAI dépôt git, et
// vérifie qu'ils ne sortent pas du rayon. C'est le seul endroit où cette
// garantie peut être établie, et sans lui la moitié du module pur ne sert à
// rien : on aurait fermé la porte d'entrée en laissant la fenêtre ouverte.

import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miroir, RayonIndisponible } from '../src/orchestrator/miroir.js';
import { TAILLE_MAX_FICHIER } from '../src/shared/rayon.js';

/** Le motif du refus, ou 'PASSÉ' si la lecture a abouti. */
async function motif(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'PASSÉ';
  } catch (e) {
    return e instanceof RayonIndisponible ? e.motif : `AUTRE:${String(e)}`;
  }
}

describe('le miroir, sur un vrai dépôt', () => {
  let racineTests: string;
  let depotAmont: string;
  let racineMiroirs: string;
  let miroir: Miroir;
  const PROJET = 'projet-de-test';

  beforeAll(async () => {
    racineTests = mkdtempSync(path.join(os.tmpdir(), 'hive-miroir-'));
    depotAmont = path.join(racineTests, 'amont');
    racineMiroirs = path.join(racineTests, 'rayons');

    // Un dépôt amont réel, avec exactement ce qu'on veut éprouver.
    await simpleGit().raw(['init', depotAmont]);
    const git = simpleGit({ baseDir: depotAmont });
    await git.addConfig('user.email', 'test@hive.local');
    await git.addConfig('user.name', 'Hive Test');
    mkdirSync(path.join(depotAmont, 'src'), { recursive: true });
    writeFileSync(path.join(depotAmont, 'README.md'), '# Projet\n\nDes abeilles.\n');
    writeFileSync(path.join(depotAmont, 'src', 'index.ts'), 'export const a = 1;\n');
    // Un secret déposé par accident, comme il s'en trouve dans tout dépôt.
    writeFileSync(path.join(depotAmont, '.env'), 'HIVE_JWT_SECRET=le-secret-de-la-ruche\n');
    // Une image : du binaire, avec un octet nul dès le début.
    writeFileSync(path.join(depotAmont, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x47]));
    // LES LIENS SYMBOLIQUES — le cœur de ce fichier.
    symlinkSync('/etc', path.join(depotAmont, 'evasion'));
    symlinkSync('/etc/hostname', path.join(depotAmont, 'src', 'vole.txt'));
    await git.add('.');
    await git.commit('base');

    miroir = new Miroir(racineMiroirs);
    await miroir.rafraichir(PROJET, depotAmont);
  });

  afterAll(() => rmSync(racineTests, { recursive: true, force: true }));

  it('le miroir existe et rend le code du projet', async () => {
    expect(miroir.existe(PROJET)).toBe(true);
    const f = await miroir.lire(PROJET, 'src/index.ts');
    expect(f.contenu).toBe('export const a = 1;\n');
    expect(f.langage).toBe('typescript');
  });

  it('la racine se liste, dossiers en premier', async () => {
    const entrees = await miroir.lister(PROJET, '');
    const noms = entrees.map((e) => e.nom);
    expect(noms).toContain('src');
    expect(noms).toContain('README.md');
    expect(noms.indexOf('src')).toBeLessThan(noms.indexOf('README.md'));
  });

  it('`.git` N’APPARAÎT PAS DANS LA LISTE — il porte l’URL distante', async () => {
    const noms = (await miroir.lister(PROJET, '')).map((e) => e.nom);
    expect(noms).not.toContain('.git');
    expect(await motif(miroir.lire(PROJET, '.git/config'))).toBe('refuse');
  });

  it('LE `.env` DU DÉPÔT N’EST NI LISTÉ NI LU', async () => {
    // Il est dans le dépôt : qui a le dépôt l'a déjà. Ce qu'on refuse, c'est de
    // le donner à quelqu'un qui n'a reçu qu'un lien de lecture du tableau de
    // bord — un partage n'est pas un clone.
    expect((await miroir.lister(PROJET, '')).map((e) => e.nom)).not.toContain('.env');
    expect(await motif(miroir.lire(PROJET, '.env'))).toBe('refuse');
  });

  describe('LES LIENS SYMBOLIQUES — ce que la règle pure ne peut pas voir', () => {
    it('un lien vers un DOSSIER hors du rayon ne se liste pas', async () => {
      // `evasion → /etc` est un chemin relatif irréprochable. Seul le disque
      // sait où il mène.
      expect(await motif(miroir.lister(PROJET, 'evasion'))).toBe('refuse');
    });

    it('UN LIEN VERS UN FICHIER HORS DU RAYON NE SE LIT PAS', async () => {
      expect(await motif(miroir.lire(PROJET, 'src/vole.txt'))).toBe('refuse');
    });

    it('et on ne peut pas non plus le traverser', async () => {
      expect(await motif(miroir.lire(PROJET, 'evasion/hostname'))).toBe('refuse');
      expect(await motif(miroir.lire(PROJET, 'evasion/passwd'))).toBe('refuse');
    });
  });

  it('la traversée classique reste refusée sur le vrai disque', async () => {
    for (const tentative of ['../../../etc/passwd', '..', '/etc/passwd', 'src/../../x']) {
      expect(await motif(miroir.lire(PROJET, tentative)), tentative).toBe('refuse');
    }
  });

  it('un fichier absent dit « introuvable », pas « refusé »', async () => {
    // La distinction compte pour l'utilisateur : « ce fichier n'existe pas » et
    // « vous n'avez pas le droit » appellent des gestes différents. Ici, rien
    // n'est caché — le rayon entier est déjà lisible par cet appelant.
    expect(await motif(miroir.lire(PROJET, 'src/jamais-ecrit.ts'))).toBe('introuvable');
    expect(await motif(miroir.lister(PROJET, 'dossier-absent'))).toBe('introuvable');
  });

  it('LE BINAIRE EST REFUSÉ, PAS DÉVERSÉ', async () => {
    expect(await motif(miroir.lire(PROJET, 'logo.png'))).toBe('binaire');
  });

  it('un fichier trop gros est refusé plutôt que chargé en mémoire', async () => {
    const gros = path.join(racineMiroirs, PROJET, 'gros.txt');
    writeFileSync(gros, 'x'.repeat(TAILLE_MAX_FICHIER + 1));
    expect(await motif(miroir.lire(PROJET, 'gros.txt'))).toBe('trop_gros');
    rmSync(gros, { force: true });
  });

  it('un projet sans miroir le dit, au lieu de planter', async () => {
    expect(await motif(miroir.lire('jamais-clone', 'README.md'))).toBe('miroir_absent');
  });

  it('un identifiant de projet tordu ne devient pas une traversée', async () => {
    // `projectId` est validé par le schéma de route aujourd'hui. On ne s'appuie
    // pas dessus : le jour où il deviendrait libre, cette ligne serait la faille.
    expect(miroir.dossier('../../evasion')).toBe(path.join(racineMiroirs, 'evasion'));
    expect(() => miroir.dossier('../..')).toThrow(RayonIndisponible);
  });

  describe('le rafraîchissement', () => {
    it('DEUX DEMANDES SIMULTANÉES NE LANCENT PAS DEUX `git`', async () => {
      // Deux `git` concurrents dans le même répertoire ne donnent pas deux
      // dépôts à jour : ils donnent un dépôt corrompu. C'est la course qu'on
      // ne voit qu'en production, quand deux personnes ouvrent la vue à la
      // même seconde.
      const m = new Miroir(path.join(racineTests, 'concurrent'));
      const t = 10_000_000;
      const [a, b, c] = [
        m.rafraichir('p', depotAmont, t),
        m.rafraichir('p', depotAmont, t),
        m.rafraichir('p', depotAmont, t),
      ];
      await Promise.all([a, b, c]);
      expect(m.existe('p')).toBe(true);
      expect(await (await m.lire('p', 'README.md')).contenu).toContain('abeilles');
    });

    it('il ne se relance pas à chaque affichage', async () => {
      // Sans fenêtre, ouvrir la vue déclencherait un `git fetch` par affichage.
      const m = new Miroir(path.join(racineTests, 'fenetre'));
      await m.rafraichir('p', depotAmont, 1_000);
      // Un amont devenu injoignable : si la fenêtre est respectée, personne ne
      // s'en aperçoit, ce qui est exactement le comportement voulu.
      await expect(m.rafraichir('p', '/depot/qui/nexiste/pas', 1_500)).resolves.toBeUndefined();
    });

    it('un amont injoignable au PREMIER clone remonte l’erreur', async () => {
      // Là, il faut que ça se voie : il n'y a rien à montrer.
      const m = new Miroir(path.join(racineTests, 'casse'));
      await expect(m.rafraichir('p', '/depot/qui/nexiste/pas')).rejects.toThrow();
    });
  });
});
