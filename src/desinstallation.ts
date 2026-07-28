// La moitié qui touche le disque, en face de `src/shared/empreinte.ts`.
//
// Même partage que `doctor.ts` / `doctor-releve.ts` et que `lanceur.ts` /
// `lanceur-reel.ts` : le module pur dit CE QUE la ruche écrit et ce que ça
// coûte de l'effacer, celui-ci va voir si c'est là et, si on le lui demande
// explicitement, l'enlève.
//
// ─── LE GESTE LE PLUS DANGEREUX DU DÉPÔT ─────────────────────────────────────
//
// C'est le seul endroit du projet qui supprime des choses que l'utilisateur n'a
// pas nommées lui-même. Trois garde-fous, tous vérifiés par des tests :
//
//   1. RIEN n'est supprimé sans `--oui`. Le défaut n'est pas `--dry-run`, le
//      défaut EST le relevé — un drapeau qu'on oublie de taper ne doit jamais
//      transformer un inventaire en effacement.
//   2. Seuls les emplacements marqués `retirable` sont touchés. `.env` et la
//      base ne le sont pas, jamais, quel que soit le drapeau (ADR 0004).
//   3. Un chemin balayé par préfixe doit être un ENFANT DIRECT du dossier
//      annoncé et porter le préfixe. Un `..` ou un lien remontant ne peut pas
//      faire sortir la suppression du dossier temporaire.

import { type Stats, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Contexte, type Emplacement, empreinte } from './shared/empreinte.js';

/** Ce qu'on a trouvé, pour un emplacement annoncé. */
export interface Trouvaille {
  readonly emplacement: Emplacement;
  /**
   * Les chemins réellement présents.
   *
   * Un seul pour un emplacement nommé, zéro s'il est absent, N pour un
   * emplacement à préfixe (les restes de fusion).
   */
  readonly presents: readonly string[];
  /** Somme des octets, dossiers parcourus. `0` quand rien n'est là. */
  readonly octets: number;
  /** Les `contenu` du module pur qui existent VRAIMENT ici. */
  readonly contenu: readonly { chemin: string; quoi: string }[];
}

/** Les fonctions de disque, injectables pour que les tests observent. */
export interface Disque {
  readonly existe: (chemin: string) => boolean;
  readonly estDossier: (chemin: string) => boolean;
  readonly taille: (chemin: string) => number;
  readonly lister: (dossier: string) => string[];
  readonly supprimer: (chemin: string) => void;
}

// `Stats` explicitement : `statSync` est surchargée et rend
// `Stats | BigIntStats`, ce qui fait de `.size` un `number | bigint` — et donc
// d'une simple addition une erreur de type.
const statOuNull = (chemin: string): Stats | null => {
  try {
    return statSync(chemin);
  } catch {
    return null;
  }
};

/**
 * `lstat`, pas `stat` — et la distinction n'est pas un détail de style.
 *
 * `statSync` SUIT les liens : `isSymbolicLink()` y vaut toujours faux. J'avais
 * écrit la garde anti-lien du parcours avec `statSync`, donc une garde qui ne
 * gardait rien — un lien vers `/` dans un espace de travail aurait fait
 * parcourir le système entier pour afficher une taille.
 */
const lstatOuNull = (chemin: string): Stats | null => {
  try {
    return lstatSync(chemin);
  } catch {
    return null;
  }
};

/** Le disque réel. */
export const DISQUE: Disque = {
  existe: (chemin) => statOuNull(chemin) !== null,
  estDossier: (chemin) => statOuNull(chemin)?.isDirectory() === true,
  taille: (chemin) => {
    const s = statOuNull(chemin);
    if (!s) return 0;
    if (!s.isDirectory()) return s.size;
    let total = 0;
    // Itératif, pas récursif : un miroir git profond ferait déborder la pile
    // d'un parcours naïf, et « désinstaller » n'est pas le moment de planter.
    const pile = [chemin];
    while (pile.length > 0) {
      const d = pile.pop()!;
      let entrees: string[];
      try {
        entrees = readdirSync(d);
      } catch {
        continue;
      }
      for (const e of entrees) {
        const c = path.join(d, e);
        const st = lstatOuNull(c);
        if (!st) continue;
        // On NE SUIT PAS les liens. Un lien vers `/` dans un espace de travail
        // ferait parcourir le système entier pour afficher une taille — et un
        // agent a le droit d'en créer un. On s'arrête au lien.
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) pile.push(c);
        else total += st.size;
      }
    }
    return total;
  },
  lister: (dossier) => {
    try {
      return readdirSync(dossier);
    } catch {
      return [];
    }
  },
  supprimer: (chemin) => {
    rmSync(chemin, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  },
};

/**
 * Une variable d'environnement, ou `undefined` si elle ne dit rien.
 *
 * ─── POURQUOI PAS UN SIMPLE `??` ─────────────────────────────────────────────
 *
 * `env.HIVE_DB ?? défaut` garde une CHAÎNE VIDE : `''` n'est pas nullish. Un
 * `HIVE_DB=` vide — dans un `.env`, dans un `docker run -e HIVE_DB`, dans un
 * shell où la variable a été effacée — donnait donc `dbPath = ''`, puis
 * `dirname('') === '.'`, et le relevé visait `./rayons` RELATIF AU RÉPERTOIRE
 * COURANT au lieu de l'installation.
 *
 * Sur une commande qui SUPPRIME, ça n'est pas une imprécision d'affichage.
 * Trouvé par le test de bout en bout, qui passait `HIVE_DB: ''` pour neutraliser
 * l'environnement — exactement le geste qu'un utilisateur peut faire.
 *
 * (Le même `??` existe dans `server.ts` et `doctor-releve.ts`. Là, un chemin
 *  vide fait échouer l'ouverture de SQLite immédiatement et bruyamment : la
 *  conséquence est une panne visible, pas une suppression au mauvais endroit.
 *  On ne les touche pas ici — un correctif large qui change le comportement du
 *  serveur dans une PR sur la désinstallation est § 4 de `docs/ERREURS.md`.)
 */
const dit = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t === undefined || t === '' ? undefined : t;
};

/**
 * Le contexte de CETTE machine.
 *
 * `racine` est passée par l'appelant (la CLI la connaît) ; le reste suit les
 * mêmes variables d'environnement que le serveur et le nœud, sans quoi le
 * relevé décrirait une installation imaginaire.
 */
export function contexteReel(racine: string, env: NodeJS.ProcessEnv = process.env): Contexte {
  return {
    racine,
    dbPath: dit(env.HIVE_DB) ?? path.join(racine, 'data', 'hive.db'),
    workdir: dit(env.HIVE_WORKDIR) ?? path.join(racine, '.hive-work'),
    tmpdir: os.tmpdir(),
    plateforme: process.platform,
  };
}

/** Les enfants directs d'un dossier qui portent le préfixe annoncé. */
function balayer(e: Emplacement, d: Disque): string[] {
  if (e.prefixe === undefined) return d.existe(e.chemin) ? [e.chemin] : [];
  if (!d.estDossier(e.chemin)) return [];
  return d
    .lister(e.chemin)
    .filter((nom) => nom.startsWith(e.prefixe!))
    .map((nom) => path.join(e.chemin, nom))
    .filter((c) => {
      // LA GARDE QUI COMPTE. `readdir` ne rend que des noms, mais un nom
      // hostile — ou simplement `..` — donnerait un chemin hors du dossier.
      // On exige que le parent résolu soit exactement celui qu'on balayait.
      return path.resolve(path.dirname(c)) === path.resolve(e.chemin);
    });
}

/** Ce que la ruche a laissé sur cette machine. Ne supprime RIEN. */
export function relever(ctx: Contexte, d: Disque = DISQUE): Trouvaille[] {
  return empreinte(ctx).map((emplacement) => {
    const presents = balayer(emplacement, d);
    return {
      emplacement,
      presents,
      octets: presents.reduce((n, c) => n + d.taille(c), 0),
      contenu: (emplacement.contenu ?? []).filter((c) => d.existe(c.chemin)),
    };
  });
}

/** Ce qui a été fait, ou refusé, pour un emplacement. */
export interface Geste {
  readonly cle: string;
  readonly chemins: readonly string[];
  readonly issue: 'supprime' | 'absent' | 'protege';
  readonly octets: number;
}

/**
 * Supprime ce qui est `retirable`, et **rien d'autre**.
 *
 * Appelée seulement quand l'humain a tapé `--oui`. Les emplacements protégés
 * ressortent avec `issue: 'protege'` plutôt que d'être passés sous silence :
 * quelqu'un qui désinstalle doit savoir ce qui RESTE, pas seulement ce qui
 * part.
 */
export function retirer(trouvailles: readonly Trouvaille[], d: Disque = DISQUE): Geste[] {
  return trouvailles.map((t): Geste => {
    const base = { cle: t.emplacement.cle, chemins: t.presents, octets: t.octets };
    if (!t.emplacement.retirable) return { ...base, issue: 'protege' };
    if (t.presents.length === 0) return { ...base, issue: 'absent' };
    for (const c of t.presents) d.supprimer(c);
    return { ...base, issue: 'supprime' };
  });
}

/** `1 234 567` → `1,2 Mo`. Pour un humain, pas pour une machine. */
export function taillelisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  const unites = ['ko', 'Mo', 'Go', 'To'];
  let n = octets / 1024;
  let i = 0;
  while (n >= 1024 && i < unites.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${unites[i]}`;
}
