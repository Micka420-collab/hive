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

import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Cette machine sait-elle créer un lien symbolique ?
 *
 * Faux sous Windows sans mode développeur : `symlinkSync` y lève EPERM.
 *
 * ─── POURQUOI LA QUESTION SE POSE ICI, AU CHARGEMENT DU MODULE ───────────────
 *
 * `it.runIf(...)` est évalué à la COLLECTE, avant que `beforeAll` n'ait tourné.
 * Ma première version posait ce drapeau dans `beforeAll` : il valait donc
 * toujours `false` à la collecte, et les trois tests d'évasion par lien étaient
 * silencieusement désactivés SUR TOUTES LES PLATEFORMES, Linux compris.
 *
 * Une garde de sécurité qu'on croit tenue et qui ne tourne nulle part est pire
 * que pas de garde du tout. La sonde se fait donc ici, une fois, au chargement.
 */
const liensPossibles = ((): boolean => {
  const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-lien-'));
  try {
    symlinkSync(bac, path.join(bac, 'essai'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
})();
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
  let dehors: string;
  let miroir: Miroir;
  const PROJET = 'projet-de-test';

  beforeAll(async () => {
    racineTests = mkdtempSync(path.join(os.tmpdir(), 'hive-miroir-'));
    depotAmont = path.join(racineTests, 'amont');
    racineMiroirs = path.join(racineTests, 'rayons');
    // Hors du rayon, et réel : c'est ce que les liens d'évasion viseront.
    dehors = path.join(racineTests, 'dehors');

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
    //
    // Sous Windows, en créer un demande le mode développeur ou des droits
    // d'administration. Sans eux, `symlinkSync` lève EPERM, le lien n'existe
    // pas, et les tests qui suivent verraient « introuvable » là où ils
    // attendent « refuse » — un ROUGE QUI NE VEUT RIEN DIRE, parce qu'il
    // n'aurait rien exercé du tout.
    //
    // On constate donc la capacité, et on la RAPPORTE. Le test qui ne peut pas
    // tourner le dit ; il ne se déclare pas vert.
    //
    // LA CIBLE EST UN DOSSIER QU'ON FABRIQUE, PAS `/etc`.
    //
    // La première version pointait sur `/etc` et `/etc/hostname`. Sous
    // Windows, `/etc` n'existe pas : les liens y étaient PENDANTS, la lecture
    // rendait « introuvable » là où le test attendait « refuse », et les trois
    // tests d'évasion rougissaient sans avoir rien éprouvé du tout. Un rouge
    // qui ne parle pas du code sous test est aussi trompeur qu'un vert.
    //
    // `dehors/` est hors du rayon sur toute plateforme, et il EXISTE, parce
    // que c'est nous qui l'écrivons. La cible ne dépend plus de la machine.
    if (liensPossibles) {
      mkdirSync(dehors, { recursive: true });
      writeFileSync(path.join(dehors, 'hostname'), 'la-machine-de-la-victime\n');
      writeFileSync(path.join(dehors, 'passwd'), 'racine:x:0:0::/racine:/bin/sh\n');
      symlinkSync(dehors, path.join(depotAmont, 'evasion'));
      symlinkSync(path.join(dehors, 'hostname'), path.join(depotAmont, 'src', 'vole.txt'));
    }
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
    it('CETTE MACHINE SAIT-ELLE EN CRÉER ? — la question doit être posée', () => {
      // On ne peut pas vérifier une garde contre les liens symboliques sur une
      // machine qui n'en crée pas. Le dire est la seule chose honnête : un
      // `skip` muet laisserait croire que la garantie est établie partout.
      //
      // Sous Windows sans mode développeur, `symlinkSync` lève EPERM. La garde
      // du miroir, elle, reste en place — c'est sa VÉRIFICATION qui manque.
      if (!liensPossibles) {
        console.warn(
          '⚠ liens symboliques indisponibles sur cette plateforme : ' +
            'la garde du miroir contre l’évasion par lien N’EST PAS vérifiée ici. ' +
            'Elle l’est sur Linux, à chaque CI.',
        );
      }
      // SUR LINUX, LA SONDE DOIT DIRE OUI. Sans cette assertion, une sonde
      // cassée désactiverait les trois tests d'évasion partout — et la suite
      // resterait verte. C'est exactement ce qui est arrivé à ma première
      // version, et rien ne l'aurait dit.
      if (process.platform !== 'win32') {
        expect(liensPossibles, 'la sonde doit réussir sur un système POSIX').toBe(true);
      }

      // ET LE LIEN A-T-IL SURVÉCU AU CLONE ? — la question qui manquait.
      //
      // Savoir créer un lien ne suffit pas : c'est GIT qui le porte jusqu'au
      // miroir. Git for Windows sait le désactiver (`core.symlinks=false`),
      // et il écrit alors un fichier texte contenant le chemin cible à la
      // place du lien. Les trois tests d'évasion tourneraient sur un fixture
      // qui n'a plus rien d'un lien, et leur vert ne vaudrait rien.
      //
      // On CONSTATE donc l'état réel du miroir, ici, une fois. Si le lien a
      // été aplati, ce test le dit en nommant la cause — plutôt que de laisser
      // trois autres échouer sans expliquer pourquoi.
      if (liensPossibles) {
        const dansLeMiroir = lstatSync(path.join(racineMiroirs, PROJET, 'evasion'));
        expect(
          dansLeMiroir.isSymbolicLink(),
          'le clone a APLATI le lien symbolique (git `core.symlinks=false` ?) : ' +
            'les tests d’évasion qui suivent n’éprouveraient plus rien',
        ).toBe(true);
      }
    });

    it.runIf(liensPossibles)('un lien vers un DOSSIER hors du rayon ne se liste pas', async () => {
      // `evasion → /etc` est un chemin relatif irréprochable. Seul le disque
      // sait où il mène.
      expect(await motif(miroir.lister(PROJET, 'evasion'))).toBe('refuse');
    });

    it.runIf(liensPossibles)('UN LIEN VERS UN FICHIER HORS DU RAYON NE SE LIT PAS', async () => {
      expect(await motif(miroir.lire(PROJET, 'src/vole.txt'))).toBe('refuse');
    });

    it.runIf(liensPossibles)('et on ne peut pas non plus le traverser', async () => {
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

describe('LE MIROIR NE PEUT PAS ATTENDRE INDÉFINIMENT DES IDENTIFIANTS', () => {
  // ─── CE QUE CETTE GARDE TIENT ──────────────────────────────────────────────
  //
  // `GIT_TERMINAL_PROMPT=0` était posé, et son commentaire disait juste :
  // sans lui, un dépôt privé sans identifiants fait attendre git et la requête
  // HTTP reste ouverte. Mais il ne gouverne que l'invite du TERMINAL.
  //
  // Sous Windows, la configuration SYSTÈME inscrit `credential.helper=manager`,
  // qui n'obéit pas à cette variable. Trois tests ont bloqué à 30 008, 30 019 et
  // 30 009 ms sur la CI Windows — le plafond au millième près, pas une lenteur.
  //
  // La règle était écrite ; son câblage ne couvrait que POSIX. Cette garde
  // vérifie les DEUX verrous, pour que le prochain qui « nettoie »
  // l'environnement de git voie rouge plutôt que de rendre le hub bloquant.

  /** La source SANS ses commentaires — sinon la prose ci-dessus la ferait passer. */
  const sourceNue = ((): string =>
    readFileSync(new URL('../src/orchestrator/miroir.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''))();

  it('l’invite de terminal est coupée', () => {
    expect(sourceNue).toMatch(/GIT_TERMINAL_PROMPT:\s*'0'/);
  });

  it('LA CONFIGURATION MACHINE EST IGNORÉE — c’est là que vit l’assistant Windows', () => {
    // Et ça vaut plus qu'un correctif Windows : un `url.<base>.insteadOf` posé
    // dans la configuration système redirigerait nos clones vers un autre hôte.
    expect(sourceNue).toMatch(/GIT_CONFIG_NOSYSTEM:\s*'1'/);
  });

  it('et l’assistant lui-même est mis en non-interactif', () => {
    expect(sourceNue).toMatch(/GCM_INTERACTIVE:\s*'Never'/);
  });

  it('AUCUN assistant d’identifiants n’est CONFIGURÉ — on coupe la source, on ne la remplace pas', () => {
    // simple-git bloque `credential.helper` par configuration, et il a raison :
    // un assistant peut désigner n'importe quel binaire. Le jour où quelqu'un
    // débloquerait ça avec `allowUnsafeCredentialHelper`, ce test le dirait.
    expect(sourceNue).not.toMatch(/allowUnsafeCredentialHelper/);
    expect(sourceNue).not.toMatch(/credential\.helper/);
  });
});
