// Le miroir du Rayon — la partie qui touche le disque.
//
// ─── POURQUOI LE HUB TIENT SON PROPRE CLONE ──────────────────────────────────
//
// Jusqu'ici le hub ne voyait JAMAIS le code : les nœuds clonent, travaillent,
// et ne renvoient que des diffs. Pour montrer le code aux abeilles, il fallait
// choisir une source, et les trois candidates ne se valent pas :
//
//   • L'API GitHub. Elle exige le jeton de l'HÔTE — donc montrer le code à une
//     abeille reviendrait à dépenser, pour elle, un droit qui n'est pas le
//     sien. Elle ne marche que sur GitHub, alors qu'un projet peut pointer sur
//     un GitLab, un serveur privé ou un chemin local. Et elle est limitée en
//     débit : un arbre de fichiers parcouru par trois personnes épuiserait le
//     quota d'une heure.
//   • Demander à un nœud. Le code ne serait lisible que si quelqu'un prête sa
//     machine à cet instant. Consulter un projet dépendrait de qui est réveillé.
//   • UN MIROIR LOCAL. Un clone superficiel, en lecture seule, rafraîchi à la
//     demande. Aucun secret dépensé, aucun fournisseur imposé, aucune latence
//     réseau par fichier lu, et ça marche hors ligne.
//
// C'est le troisième. Le coût est un répertoire par projet sur la machine de
// l'hôte, et il est borné.
//
// ─── CE QUE CE FICHIER NE DÉCIDE PAS ─────────────────────────────────────────
//
// Ni la sûreté des chemins, ni qui a le droit de lire. La première est dans
// `shared/rayon.ts`, pure et testée sur des formes qu'on ne pourrait pas créer
// sur une machine de test. La seconde est dans `shared/acces-projet.ts`, qui
// tenait déjà la frontière public/privé. Ici, on ne fait que lire — après que
// les deux autres ont dit oui.

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { commandeSshDuMembre, gitHote } from '../shared/git-protege.js';
import {
  TAILLE_MAX_FICHIER,
  cheminDemande,
  dansLeRayon,
  estBinaire,
  estInterdit,
  langageDe,
  trierEntrees,
  type Entree,
} from '../shared/rayon.js';

/**
 * Un rafraîchissement au plus par projet et par fenêtre.
 *
 * Sans cela, ouvrir la vue déclencherait un `git fetch` par affichage, et dix
 * personnes qui regardent le même projet feraient dix clones concurrents dans
 * le même répertoire — c'est-à-dire un dépôt corrompu, pas dix dépôts à jour.
 */
export const FENETRE_RAFRAICHISSEMENT_MS = 60_000;

/** Au-delà, on ne liste pas : un dossier pareil n'est pas fait pour être lu. */
export const ENTREES_MAX_PAR_DOSSIER = 2_000;

export interface Fichier {
  chemin: string;
  contenu: string;
  langage: string;
  taille: number;
  /** Vrai si le contenu a été coupé faute de place. */
  tronque: boolean;
}

export type ErreurRayon =
  'pas_de_depot' | 'miroir_absent' | 'introuvable' | 'binaire' | 'trop_gros' | 'refuse';

export class RayonIndisponible extends Error {
  constructor(readonly motif: ErreurRayon) {
    super(motif);
    this.name = 'RayonIndisponible';
  }
}

/**
 * `info/attributes` du git dir du miroir — il PRIME sur tout `.gitattributes`
 * de l'arbre (gitattributes(5)). Le dépôt NOMME des filtres ; la machine de
 * la Reine peut en DÉFINIR (Git for Windows inscrit `filter.lfs`) : sans
 * cette ligne, l'extraction lançait ce programme parce que le dépôt le
 * désignait. Le miroir montre les octets du dépôt — un fichier LFS s'y lit
 * comme son pointeur, jamais téléchargé.
 */
const ATTRIBUTS_MIROIR = '* -filter\n';

/**
 * Le miroir des dépôts, un répertoire par projet.
 *
 * Les rafraîchissements en vol sont mémorisés : deux requêtes simultanées sur
 * le même projet attendent LA MÊME promesse, au lieu de lancer deux `git` dans
 * le même répertoire. C'est la course qu'on ne voit qu'en production, quand
 * deux personnes ouvrent la vue à la même seconde.
 */
export class Miroir {
  private readonly enVol = new Map<string, Promise<void>>();
  private readonly dernier = new Map<string, number>();

  constructor(private readonly racine: string) {}

  /** Le répertoire du miroir de ce projet — sans garantir qu'il existe. */
  dossier(projectId: string): string {
    // `projectId` vient d'un UUID validé par le schéma de route, mais on ne
    // s'appuie pas là-dessus : un identifiant qui deviendrait libre un jour
    // ferait de cette ligne une traversée. On ne garde que l'inoffensif.
    const sur = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (sur === '') throw new RayonIndisponible('introuvable');
    return path.join(this.racine, sur);
  }

  /** Ce projet a-t-il déjà un miroir sur le disque ? */
  existe(projectId: string): boolean {
    return existsSync(path.join(this.dossier(projectId), '.git'));
  }

  /**
   * Met le miroir à jour, ou le crée. Au plus une fois par fenêtre.
   *
   * `--depth 1` : on montre le code TEL QU'IL EST, pas son histoire. L'histoire
   * pèse parfois cent fois le contenu, et le tableau de bord ne l'affiche pas.
   */
  async rafraichir(projectId: string, repoUrl: string, maintenant = Date.now()): Promise<void> {
    const enCours = this.enVol.get(projectId);
    if (enCours) return enCours;

    const vu = this.dernier.get(projectId) ?? 0;
    if (this.existe(projectId) && maintenant - vu < FENETRE_RAFRAICHISSEMENT_MS) return;

    const travail = this.faireRafraichir(projectId, repoUrl)
      .then(() => {
        this.dernier.set(projectId, maintenant);
      })
      .finally(() => {
        this.enVol.delete(projectId);
      });
    this.enVol.set(projectId, travail);
    return travail;
  }

  /**
   * Clone ou rafraîchit, par la porte commune (`shared/git-protege.ts`) :
   * aucun crochet — pas même ceux qu'un `core.hooksPath` global relatif ferait
   * lire dans l'arbre —, aucun moniteur, transport borné, jamais d'invite.
   *
   * Le clone se fait SANS extraction, et c'est ce qui laisse poser
   * `info/attributes` avant que le moindre fichier ne sorte ; `--template=`
   * vide : aucun crochet ni fichier d'un `init.templateDir` de l'hôte. Le
   * git dir n'est alors écrit que par git et par nous. `core.autocrlf=false`
   * est ÉCRIT dans sa configuration : sous Windows, git réécrirait sinon les
   * fins de ligne, et le miroir servirait un code que le dépôt ne contient
   * pas — un octet de plus par ligne, et deux ruches sur le même dépôt ne
   * verraient pas le même code (vu sur la CI Windows :
   * « export const a = 1;\r\n »).
   *
   * Un miroir sans `info/attributes` vient d'une version qui clonait sans ces
   * précautions : c'est un cache, on le refait plutôt que de le réparer.
   *
   * `fetch` puis `reset --hard` : le miroir n'a pas de travail local à
   * préserver, et un `pull` qui tomberait sur un rebase amont resterait
   * bloqué sur un conflit que personne n'est là pour résoudre.
   */
  private async faireRafraichir(projectId: string, repoUrl: string): Promise<void> {
    const dir = this.dossier(projectId);
    const depot = { gitDir: path.join(dir, '.git'), workTree: dir };
    const attributs = path.join(depot.gitDir, 'info', 'attributes');
    // La racine d'abord : `commandeSshDuMembre` y lance git, et un cwd absent
    // la ferait retomber sur `ssh` au premier clone.
    await fs.mkdir(this.racine, { recursive: true });
    const ssh = await commandeSshDuMembre(this.racine);
    if (this.existe(projectId) && existsSync(attributs)) {
      await gitHote(['fetch', '--depth', '1', 'origin'], depot, { ssh });
    } else {
      await fs.rm(dir, { recursive: true, force: true });
      await gitHote(
        [
          'clone',
          '--depth',
          '1',
          '--no-tags',
          '--no-checkout',
          '--template=',
          '--config',
          'core.autocrlf=false',
          '--',
          repoUrl,
          dir,
        ],
        this.racine,
        { ssh },
      );
      await fs.mkdir(path.dirname(attributs), { recursive: true });
      await fs.writeFile(attributs, ATTRIBUTS_MIROIR);
    }
    const tete = (await gitHote(['symbolic-ref', '--short', 'HEAD'], depot)).trim() || 'HEAD';
    await gitHote(['reset', '--hard', `origin/${tete}`], depot);
  }

  /**
   * Liste un dossier du rayon.
   *
   * `''` désigne la racine. Le tri et le filtrage viennent du module pur : on
   * ne réécrit pas ici la règle qui dit ce qui ne se sert jamais.
   */
  async lister(projectId: string, cheminBrut: string): Promise<Entree[]> {
    const racine = await this.racineReelle(projectId);
    const relatif = cheminBrut.trim() === '' ? '' : this.verifier(cheminBrut);
    const absolu = relatif === '' ? racine : path.join(racine, relatif);
    await this.assurerDansLeRayon(racine, absolu);

    let brut: import('node:fs').Dirent[];
    try {
      brut = await fs.readdir(absolu, { withFileTypes: true });
    } catch {
      throw new RayonIndisponible('introuvable');
    }

    const entrees: Entree[] = [];
    for (const d of brut.slice(0, ENTREES_MAX_PAR_DOSSIER)) {
      if (estInterdit(d.name)) continue;
      // Ni fichier ni dossier : un socket, un tube nommé, un périphérique. On
      // ne les liste pas — les lire bloquerait le hub indéfiniment.
      if (!d.isFile() && !d.isDirectory()) continue;
      const chemin = relatif === '' ? d.name : `${relatif}/${d.name}`;
      let taille = 0;
      if (d.isFile()) {
        try {
          taille = (await fs.stat(path.join(absolu, d.name))).size;
        } catch {
          continue; // disparu entre le listage et la mesure : on l'oublie
        }
      }
      entrees.push({
        chemin,
        nom: d.name,
        type: d.isDirectory() ? 'dossier' : 'fichier',
        taille,
      });
    }
    return trierEntrees(entrees);
  }

  /** Lit un fichier du rayon. */
  async lire(projectId: string, cheminBrut: string): Promise<Fichier> {
    const racine = await this.racineReelle(projectId);
    const relatif = this.verifier(cheminBrut);
    const absolu = path.join(racine, relatif);
    await this.assurerDansLeRayon(racine, absolu);

    let info: import('node:fs').Stats;
    try {
      info = await fs.stat(absolu);
    } catch {
      throw new RayonIndisponible('introuvable');
    }
    if (!info.isFile()) throw new RayonIndisponible('introuvable');
    if (info.size > TAILLE_MAX_FICHIER) throw new RayonIndisponible('trop_gros');

    const octets = await fs.readFile(absolu);
    if (estBinaire(octets)) throw new RayonIndisponible('binaire');

    return {
      chemin: relatif,
      contenu: octets.toString('utf8'),
      langage: langageDe(relatif),
      taille: info.size,
      tronque: false,
    };
  }

  /** Applique la règle pure, et traduit son refus en erreur du rayon. */
  private verifier(brut: string): string {
    const v = cheminDemande(brut);
    if (!v.ok) throw new RayonIndisponible('refuse');
    return v.relatif;
  }

  /**
   * La racine RÉELLE du miroir — liens symboliques résolus.
   *
   * Résoudre la racine elle-même n'est pas une précaution en trop : si le
   * répertoire du miroir est lui-même atteint par un lien (un `.hive` déplacé
   * sur un autre disque, ce qui se fait), alors la racine résolue et les
   * fichiers résolus n'auraient pas le même préfixe, et TOUT serait refusé.
   */
  private async racineReelle(projectId: string): Promise<string> {
    const dir = this.dossier(projectId);
    try {
      return await fs.realpath(dir);
    } catch {
      throw new RayonIndisponible('miroir_absent');
    }
  }

  /**
   * LA SECONDE VÉRIFICATION — celle qui attrape les liens symboliques.
   *
   * La règle pure a déjà refusé `..`, l'absolu et l'octet nul. Elle ne peut
   * rien contre un lien symbolique DANS le dépôt, parce qu'un lien n'est visible
   * qu'en interrogeant le disque : `docs/tout` → `/` est un chemin parfaitement
   * relatif et parfaitement innocent à la lecture.
   *
   * On résout donc, puis on compare. Un chemin qui n'existe pas encore n'a pas
   * de `realpath` : on remonte alors au premier parent existant, parce que
   * refuser ce cas rendrait `introuvable` indistinguable de `refusé`.
   */
  private async assurerDansLeRayon(racine: string, absolu: string): Promise<void> {
    let sonde = absolu;
    for (;;) {
      try {
        const reel = await fs.realpath(sonde);
        const suffixe = path.relative(sonde, absolu);
        const cible = suffixe === '' ? reel : path.join(reel, suffixe);
        if (!dansLeRayon(racine, cible)) throw new RayonIndisponible('refuse');
        return;
      } catch (e) {
        if (e instanceof RayonIndisponible) throw e;
        const parent = path.dirname(sonde);
        if (parent === sonde) throw new RayonIndisponible('introuvable');
        sonde = parent;
      }
    }
  }
}
