// L'empreinte de Hive sur une machine — où la ruche écrit, et ce qu'on perd.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// `docs/INSTALLATION.md` promet, noir sur blanc : « Hive n'écrit rien hors de
// son dossier. Le supprimer suffit. » C'est une promesse qu'on croit sur
// parole, et c'est exactement la forme de règle que ce dépôt a passé sa
// journée à démentir — une phrase écrite, aucun câblage derrière.
//
// Ce module est le câblage. Il énumère CHAQUE endroit où la ruche écrit, ce
// que chacun contient, et ce que le supprimer coûte. Trois usages :
//
//   1. `hive desinstaller` l'affiche — on voit son empreinte avant d'effacer ;
//   2. `tests/empreinte.test.ts` le compare à un relevé des appels d'écriture
//      RÉELS de `src/` : une écriture ajoutée ailleurs fait rougir ;
//   3. la documentation cesse de dire « rien hors du dossier » à l'aveugle.
//
// ─── CE QUE LE RELEVÉ A TROUVÉ ───────────────────────────────────────────────
//
// `os.homedir()` n'apparaît NULLE PART dans `src/`. Les `HOME`/`USERPROFILE`
// qu'on y lit ne servent qu'à transmettre l'environnement à un processus fils
// (git, un agent), jamais à composer un chemin d'écriture. Les `/etc` du bac à
// sable sont des montages `--ro-bind`, en lecture seule ; le seul chemin
// inscriptible y est le répertoire de la tâche. Aucun registre, aucun service,
// aucun `/usr/local`.
//
// Une seule écriture sort vraiment du dossier : le répertoire de patchs d'une
// fusion, sous `os.tmpdir()`. Il est effacé dans un `finally` — mais un `kill
// -9` au mauvais moment en laisse un derrière, et personne ne le saurait.
//
// ─── ET UNE NUANCE QUE LA DOC TAISAIT ────────────────────────────────────────
//
// `.hive-work` est RELATIF au répertoire courant, pas à la racine de Hive.
// Quelqu'un qui fait `npx github:Micka420-collab/hive join …` depuis
// `~/Documents` y crée `~/Documents/.hive-work/join/node-key.txt` — une CLÉ,
// hors de toute installation, dans un dossier qui n'a rien à voir. « Supprimer
// ~/hive suffit » est faux pour cette personne : elle n'a pas de `~/hive`.
//
// ─── PUR ─────────────────────────────────────────────────────────────────────
//
// Aucun accès disque ici. La plateforme est un PARAMÈTRE, pas un
// `process.platform` lu au passage : c'est ce qui rend la forme des chemins
// Windows vérifiable depuis Linux (§ 6.3 de `docs/ERREURS.md`).

import path from 'node:path';

/** Ce qu'un emplacement représente, et ce que ça engage de le supprimer. */
export type Genre =
  /** Des données que la ruche est seule à porter. Les perdre est définitif. */
  | 'etat'
  /** Un secret. Sa perte coupe des accès, mais rien n'est irrécupérable. */
  | 'secret'
  /** Du travail reconstructible : un clone, un espace de tâche, un binaire. */
  | 'travail'
  /** Un reste. Rien ne devrait vivre là après la fin d'une commande. */
  | 'transitoire';

/** Une chose notable À L'INTÉRIEUR d'un emplacement — nommée, pas retirable. */
export interface ContenuNotable {
  readonly chemin: string;
  readonly quoi: string;
}

/** Un endroit où la ruche écrit. */
export interface Emplacement {
  /** Identifiant stable, pour `--json` et pour les tests. */
  readonly cle: string;
  /** Le chemin. Avec `prefixe`, c'est le dossier PARENT à balayer. */
  readonly chemin: string;
  /**
   * Quand il est là, l'emplacement ne désigne pas `chemin` mais TOUTES ses
   * entrées commençant par ce préfixe. C'est ce qui permet à un module pur de
   * décrire « les restes de fusion dans le dossier temporaire » sans lister
   * quoi que ce soit : le balayage vit dans la moitié impure.
   */
  readonly prefixe?: string;
  /** Ce que c'est, en une phrase, pour quelqu'un qui ne connaît pas le code. */
  readonly quoi: string;
  readonly genre: Genre;
  /**
   * `hive desinstaller --oui` a-t-il le droit d'y toucher ?
   *
   * Faux pour tout ce qui porte de l'état ou un secret — décision de l'ADR
   * 0004 : « un outil d'installation n'est pas un outil de destruction ; le
   * jour où quelqu'un lance uninstall en croyant désinstaller le service, il
   * ne doit pas perdre six mois de ruche. » On les AFFICHE avec la commande
   * exacte, on ne les efface pas à sa place.
   */
  readonly retirable: boolean;
  /** Ce qu'on perd. Vide quand il n'y a rien à perdre. */
  readonly consequence: string;
  readonly contenu?: readonly ContenuNotable[];
}

/** De quoi situer une installation sans rien lire sur le disque. */
export interface Contexte {
  /** La racine de l'installation — là où vivent `.env` et `package.json`. */
  readonly racine: string;
  /** Le fichier SQLite. Souvent `<racine>/data/hive.db`, sinon `HIVE_DB`. */
  readonly dbPath: string;
  /** La racine des espaces de travail. `HIVE_WORKDIR`, ou `.hive-work`. */
  readonly workdir: string;
  /** `os.tmpdir()`. */
  readonly tmpdir: string;
  readonly plateforme: NodeJS.Platform;
}

/** Le préfixe des répertoires de patchs d'une fusion (`merge-runner.ts`). */
export const PREFIXE_FUSION = 'hive-merge-';

/**
 * Tout ce que la ruche a pu écrire sur cette machine, du plus grave au plus
 * anodin.
 *
 * L'ordre n'est pas cosmétique : c'est celui dans lequel on veut le LIRE. Ce
 * qu'on ne peut pas récupérer d'abord, les restes en dernier.
 */
export function empreinte(ctx: Contexte): Emplacement[] {
  // On choisit la grammaire de chemins de la plateforme VISÉE, pas de celle
  // qui exécute. Sans ça, un test Windows lancé depuis Linux vérifierait des
  // chemins POSIX en croyant vérifier autre chose.
  const p = ctx.plateforme === 'win32' ? path.win32 : path.posix;
  const donnees = p.dirname(ctx.dbPath);

  return [
    {
      cle: 'env',
      chemin: p.join(ctx.racine, '.env'),
      quoi: 'la configuration et les secrets de la ruche',
      genre: 'secret',
      retirable: false,
      consequence:
        'HIVE_TOKEN perdu déconnecte TOUS les nœuds ; HIVE_JWT_SECRET perdu ' +
        'invalide toutes les sessions ouvertes. Aucun des deux ne se retrouve.',
    },
    {
      cle: 'base',
      chemin: ctx.dbPath,
      quoi: 'la mémoire de la ruche',
      genre: 'etat',
      retirable: false,
      consequence:
        'les projets, les tâches, le Hive Mind, le grand livre et les comptes. ' +
        'Rien de tout cela ne vit ailleurs.',
      contenu: [
        // SQLite écrit deux fichiers frères en mode WAL. Les oublier dans un
        // inventaire donnerait une taille fausse — et une sauvegarde
        // incomplète à qui copierait « le » fichier de base.
        { chemin: `${ctx.dbPath}-wal`, quoi: 'journal WAL de SQLite' },
        { chemin: `${ctx.dbPath}-shm`, quoi: 'mémoire partagée de SQLite' },
      ],
    },
    {
      cle: 'rayons',
      chemin: p.join(donnees, 'rayons'),
      quoi: 'les miroirs des dépôts, clonés en lecture seule',
      genre: 'travail',
      retirable: true,
      consequence: 'reclonés au prochain besoin — seulement du temps et du réseau.',
    },
    {
      cle: 'travail',
      chemin: ctx.workdir,
      quoi: 'les espaces de travail des tâches',
      genre: 'travail',
      retirable: true,
      consequence:
        'une tâche EN COURS y vit. La supprimer pendant qu’un nœud travaille ' +
        'perd ce qui n’a pas encore été livré.',
      contenu: [
        {
          chemin: p.join(ctx.workdir, 'join', 'node-key.txt'),
          quoi: 'la clé de ce nœud (600) — sans elle, il faut un nouveau billet',
        },
        {
          chemin: p.join(ctx.workdir, 'join', 'node-id.txt'),
          quoi: 'son identifiant stable',
        },
        {
          chemin: p.join(ctx.workdir, 'bin'),
          quoi: 'cloudflared, s’il a été téléchargé par `hive cloudflare --install`',
        },
      ],
    },
    {
      cle: 'fusions',
      chemin: ctx.tmpdir,
      prefixe: PREFIXE_FUSION,
      quoi: 'des restes de fusion, dans le dossier temporaire du système',
      genre: 'transitoire',
      retirable: true,
      consequence:
        'rien. Ces répertoires sont effacés à la fin de chaque fusion ; il n’en ' +
        'reste que si un processus a été tué au mauvais moment.',
    },
  ];
}

/**
 * La seule écriture de la ruche HORS de son dossier d'installation.
 *
 * Une fonction plutôt qu'un commentaire : la documentation et
 * `hive desinstaller` doivent dire la même chose, et une phrase recopiée à
 * deux endroits diverge le jour où l'un des deux bouge.
 */
export function horsDuDossier(ctx: Contexte): Emplacement[] {
  const p = ctx.plateforme === 'win32' ? path.win32 : path.posix;
  const racine = p.resolve(ctx.racine);
  const dedans = (c: string): boolean => {
    const r = p.resolve(c);
    return r === racine || r.startsWith(racine + p.sep);
  };
  return empreinte(ctx).filter((e) => !dedans(e.chemin));
}
