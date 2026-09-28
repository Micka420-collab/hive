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
import { CLONE_MS, DELAI_RESEAU_MS } from '../shared/butoirs-noeud.js';
import {
  EchecGitHote,
  commandeSshDuMembre,
  gitHote,
  type DepotEpingle,
} from '../shared/git-protege.js';
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
 * de l'arbre, attribut par attribut (gitattributes(5)). Le miroir sert les
 * octets que le dépôt STOCKE, et rien d'autre :
 *
 *   · `-filter` : le dépôt NOMME des filtres, la machine de la Reine peut en
 *     DÉFINIR (Git for Windows inscrit `filter.lfs`) — sans cet attribut,
 *     l'extraction lançait le programme que le dépôt désignait. Un fichier
 *     LFS s'y lit donc comme son POINTEUR, jamais téléchargé ;
 *   · `-text` : ni `text eol=crlf` du dépôt, ni `core.autocrlf` de l'hôte —
 *     sinon le miroir servait `a\r\nb\r\n` pour un blob `a\nb\n`, et deux
 *     ruches sur le même dépôt ne voyaient pas le même code ;
 *   · `-ident` : un `$Id$` reste `$Id$`, pas l'empreinte que git y développe ;
 *   · `-working-tree-encoding` : un fichier stocké en UTF-8 que le dépôt fait
 *     extraire en UTF-16 serait servi comme binaire (ses octets nuls).
 *
 * Un miroir dont le fichier diffère de celui-ci a été extrait sous d'autres
 * règles : ses fichiers peuvent porter les conversions — on le refait.
 */
const ATTRIBUTS_MIROIR = '* -filter -text -ident -working-tree-encoding\n';

/**
 * Ce que dit l'amont de sa branche par défaut et de ses branches
 * (`ls-remote --symref … HEAD 'refs/heads/*'`) :
 *   · `vide` — AUCUNE branche : rien à montrer (un dépôt qu'on vient de créer) ;
 *   · `branche` — HEAD désigne cette branche, et elle a un commit ;
 *   · `inconnue` — un commit, sans le nom de la branche (un serveur « bête »
 *     qui n'annonce pas les références symboliques) : on garde la nôtre ;
 *   · `sans_tete` — des branches, mais un HEAD qui ne se résout pas (la
 *     branche par défaut d'un dépôt nu effacée après la poussée d'une autre).
 *
 * `sans_tete` n'est PAS `vide`, et c'est pour les séparer qu'on demande les
 * branches : `ls-remote … HEAD` seul rend la même sortie vide pour les deux.
 * Confondus, un HEAD pendant faisait refaire le miroir en dépôt vide — le code
 * d'hier effacé, un Rayon vide rendu comme un succès, sans un mot.
 */
type TeteAmont =
  | { readonly etat: 'vide' }
  | { readonly etat: 'branche'; readonly nom: string }
  | { readonly etat: 'inconnue' }
  | { readonly etat: 'sans_tete' };

/** Lit la sortie de `git ls-remote --symref <dépôt> HEAD 'refs/heads/*'`. */
function lireTeteAmont(sortie: string): TeteAmont {
  let nom: string | null = null;
  let commit = false;
  let branches = false;
  for (const brute of sortie.split('\n')) {
    const ligne = brute.trimEnd();
    const symref = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(ligne)?.[1];
    if (symref !== undefined) nom = symref;
    else if (/^[0-9a-f]{40,64}\tHEAD$/.test(ligne)) commit = true;
    else if (/^[0-9a-f]{40,64}\trefs\/heads\//.test(ligne)) branches = true;
  }
  if (!commit) return branches ? { etat: 'sans_tete' } : { etat: 'vide' };
  return nom === null ? { etat: 'inconnue' } : { etat: 'branche', nom };
}

/** Où un reclone se prépare, à côté du miroir qu'il remplacera s'il réussit. */
const voisinDeReclone = (dir: string): string =>
  path.join(path.dirname(dir), `.neuf-${path.basename(dir)}`);

/** Le dernier rafraîchissement d'un projet : quand, et son échec s'il a échoué. */
interface Tentative {
  readonly quand: number;
  readonly echec?: unknown;
}

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
  private readonly dernier = new Map<string, Tentative>();

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
   * Efface le miroir d'un projet SUPPRIMÉ. Rend `absent` s'il n'y avait rien
   * sur le disque ; lève si le disque refuse (l'appelant le dit).
   *
   * Un rafraîchissement en vol est ATTENDU d'abord : effacer sous un `git
   * clone` qui écrit encore laisserait le clone recréer le répertoire juste
   * après — un miroir orphelin, que plus aucune route ne désigne et que rien
   * n'effacerait. Aucun rafraîchissement ne peut partir ensuite : les routes
   * du Rayon vérifient le projet puis appellent `rafraichir` sans rien
   * attendre entre les deux, et le projet n'existe déjà plus en base.
   *
   * `maxRetries` : sous Windows, un antivirus ou un `git` qui se termine tient
   * parfois un fichier du pack une fraction de seconde (motif `workspace.ts`).
   */
  async effacer(projectId: string): Promise<'efface' | 'absent'> {
    await this.enVol.get(projectId)?.catch(() => undefined);
    this.dernier.delete(projectId);
    const dir = this.dossier(projectId);
    // Le reclone voisin (`recloner`) d'une Reine arrêtée en plein clone : seul
    // le rafraîchissement suivant le retirait, et un projet supprimé n'en a
    // plus — il restait pour toujours.
    await fs.rm(voisinDeReclone(dir), { recursive: true, force: true, maxRetries: 10 });
    if (!existsSync(dir)) return 'absent';
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return 'efface';
  }

  /**
   * Met le miroir à jour, ou le crée. Au plus une TENTATIVE par fenêtre.
   *
   * `--depth 1` : on montre le code TEL QU'IL EST, pas son histoire. L'histoire
   * pèse parfois cent fois le contenu, et le tableau de bord ne l'affiche pas.
   *
   * Un échec compte comme une tentative. Un amont muet tient chaque essai
   * jusqu'à son butoir (`CLONE_MS`, `DELAI_RESEAU_MS`) : sans cela, chaque
   * visiteur suivant relançait un git qui pendait autant, et le Rayon du
   * projet ne répondait plus qu'au rythme des délais. Dans la fenêtre, un
   * miroir existant sert donc sa dernière copie, et un premier clone raté
   * redit son échec — tout de suite, sans relancer git.
   *
   * La fenêtre part de la FIN de la tentative, pas de son début : un essai
   * tenu jusqu'à son butoir (deux minutes, dix pour un clone) dure plus que
   * la fenêtre. Datée de son début, sa fenêtre était déjà close quand il
   * tombait, et le visiteur suivant relançait un git qui pendait autant.
   * `maintenant` + la durée mesurée : l'horloge du test reste celle du test.
   */
  async rafraichir(projectId: string, repoUrl: string, maintenant = Date.now()): Promise<void> {
    const enCours = this.enVol.get(projectId);
    if (enCours) return enCours;

    const vu = this.dernier.get(projectId);
    if (vu && maintenant - vu.quand < FENETRE_RAFRAICHISSEMENT_MS) {
      if (this.existe(projectId)) return;
      if (vu.echec !== undefined) throw vu.echec;
    }

    const debut = Date.now();
    const fin = (): number => maintenant + (Date.now() - debut);
    const travail = this.faireRafraichir(projectId, repoUrl)
      .then(
        () => {
          this.dernier.set(projectId, { quand: fin() });
        },
        (echec: unknown) => {
          this.dernier.set(projectId, { quand: fin(), echec });
          throw echec;
        },
      )
      .finally(() => {
        this.enVol.delete(projectId);
      });
    this.enVol.set(projectId, travail);
    return travail;
  }

  /**
   * Clone ou rafraîchit, par la porte commune (`shared/git-protege.ts`) :
   * aucun crochet — pas même ceux qu'un `core.hooksPath` global relatif ferait
   * lire dans l'arbre —, aucun moniteur, jamais d'invite. Et chaque appel au
   * dépôt distant sous SON butoir, les mêmes que ceux du nœud : `gitHote` ne
   * borne pas un clone qu'on ne borne pas, et un serveur qui accepte la
   * connexion puis se tait gardait la promesse en vol — donc le Rayon du
   * projet — jusqu'au redémarrage de la Reine.
   *
   * Un miroir qu'on peut reprendre demande d'abord à l'amont où est sa tête
   * (`ls-remote --symref`, une seule requête) : `--depth 1` implique une
   * seule branche, et un `fetch` ne verrait jamais que la branche par défaut
   * a changé (`main` → `trunk`) — le miroir servirait l'ancienne pour
   * toujours. Tête déplacée, ou premiers commits d'un dépôt qui était vide
   * (son clone n'a aucune branche à récupérer) : on refait le clone. Un amont
   * toujours vide : rien à lancer de plus. Un HEAD qui ne se résout plus
   * (`sans_tete`) est une PANNE de l'amont, pas un dépôt vide : on échoue, et
   * la copie d'hier reste servie, avec l'avertissement du serveur.
   *
   * `fetch` puis `reset --hard` : le miroir n'a pas de travail local à
   * préserver, et un `pull` qui tomberait sur un rebase amont resterait
   * bloqué sur un conflit que personne n'est là pour résoudre.
   */
  private async faireRafraichir(projectId: string, repoUrl: string): Promise<void> {
    const dir = this.dossier(projectId);
    const depot = { gitDir: path.join(dir, '.git'), workTree: dir };
    // La racine d'abord : `commandeSshDuMembre` y lance git, et un cwd absent
    // la ferait retomber sur `ssh` au premier clone.
    await fs.mkdir(this.racine, { recursive: true });
    const ssh = await commandeSshDuMembre(this.racine);
    if (this.existe(projectId) && (await this.reprenable(depot))) {
      const amont = lireTeteAmont(
        await gitHote(['ls-remote', '--symref', 'origin', 'HEAD', 'refs/heads/*'], depot, {
          ssh,
          delaiMs: DELAI_RESEAU_MS,
        }),
      );
      if (amont.etat === 'sans_tete') {
        throw new Error(
          'miroir : la branche par défaut de l’amont (HEAD) ne désigne aucune branche existante',
        );
      }
      const tete = await teteDuMiroir(depot);
      const garni = await aUnCommit(depot, tete);
      if (amont.etat === 'vide' && !garni) return;
      const memeTete =
        amont.etat === 'inconnue' || (amont.etat === 'branche' && amont.nom === tete);
      if (garni && memeTete) {
        await gitHote(['fetch', '--depth', '1', 'origin'], depot, {
          ssh,
          delaiMs: DELAI_RESEAU_MS,
        });
        await gitHote(['reset', '--hard', `origin/${tete}`], depot);
        return;
      }
    }
    await this.recloner(dir, repoUrl, ssh);
  }

  /**
   * Un miroir se reprend s'il a été cloné sous les règles d'aujourd'hui : son
   * `info/attributes` est exactement `ATTRIBUTS_MIROIR`. Absent ou différent,
   * il vient d'une version qui clonait sans ces précautions — c'est un cache,
   * on le refait plutôt que de le réparer.
   */
  private async reprenable(depot: DepotEpingle): Promise<boolean> {
    const attributs = path.join(depot.gitDir, 'info', 'attributes');
    return fs.readFile(attributs, 'utf8').then(
      (contenu) => contenu === ATTRIBUTS_MIROIR,
      () => false,
    );
  }

  /**
   * Le clone se fait SANS extraction, et c'est ce qui laisse poser
   * `info/attributes` avant que le moindre fichier ne sorte ; `--template=`
   * vide : aucun crochet ni fichier d'un `init.templateDir` de l'hôte. Le
   * git dir n'est alors écrit que par git et par nous. `core.autocrlf=false`
   * est ÉCRIT dans sa configuration, en plus de `-text` : sous Windows, git
   * réécrirait sinon les fins de ligne (vu sur la CI Windows :
   * « export const a = 1;\r\n »).
   *
   * Tout se fait dans un répertoire VOISIN, qui ne prend la place du miroir
   * qu'une fois clone, attributs et extraction réussis. Un reclone déclenché
   * par l'amont (tête déplacée, premiers commits) sur un serveur qui tombe
   * ensuite effaçait d'abord la copie d'hier : le Rayon passait de « copie
   * d'hier + avertissement » à un 409. Et un clone TUÉ à son butoir laissait
   * un `.git` à moitié écrit, pris pour un miroir (`existe`) et servi comme un
   * arbre vide. Le voisin commence par un point : aucun identifiant de projet
   * n'en porte (`dossier`), il ne peut donc pas en être un.
   *
   * Un amont vide se clone — git prévient, sans échouer — mais n'a aucune
   * branche à extraire : le miroir reste vide, et c'est la vérité.
   */
  private async recloner(dir: string, repoUrl: string, ssh: string): Promise<void> {
    const neuf = voisinDeReclone(dir);
    const depotNeuf = { gitDir: path.join(neuf, '.git'), workTree: neuf };
    // Un voisin d'une Reine arrêtée en plein clone : les rafraîchissements
    // d'un projet ne se chevauchent pas (`enVol`), celui-ci est donc à nous.
    await fs.rm(neuf, { recursive: true, force: true });
    try {
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
          neuf,
        ],
        this.racine,
        { ssh, delaiMs: CLONE_MS },
      );
      const attributs = path.join(depotNeuf.gitDir, 'info', 'attributes');
      await fs.mkdir(path.dirname(attributs), { recursive: true });
      await fs.writeFile(attributs, ATTRIBUTS_MIROIR);
      const tete = await teteDuMiroir(depotNeuf);
      if (await aUnCommit(depotNeuf, tete)) {
        await gitHote(['reset', '--hard', `origin/${tete}`], depotNeuf);
      }
    } catch (e) {
      await fs.rm(neuf, { recursive: true, force: true }).catch(() => undefined);
      throw e;
    }
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(neuf, dir);
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

/** La branche que suit le miroir — celle que l'amont désignait à son clone. */
async function teteDuMiroir(depot: DepotEpingle): Promise<string> {
  return (await gitHote(['symbolic-ref', '--short', 'HEAD'], depot)).trim() || 'HEAD';
}

/**
 * Le miroir a-t-il récupéré un commit de sa branche ? Non pour le clone d'un
 * dépôt vide : `rev-parse -q --verify` rend 1, sans un mot — tout autre échec
 * est une vraie panne, et remonte.
 */
async function aUnCommit(depot: DepotEpingle, tete: string): Promise<boolean> {
  return gitHote(
    ['rev-parse', '-q', '--verify', `refs/remotes/origin/${tete}^{commit}`],
    depot,
  ).then(
    () => true,
    (e: unknown) => {
      if (e instanceof EchecGitHote && e.code === 1) return false;
      throw e;
    },
  );
}
