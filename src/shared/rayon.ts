// Le Rayon — lire le code du projet, sans que la lecture devienne une porte.
//
// ─── CE QUE C'EST ────────────────────────────────────────────────────────────
//
// Un rayon de cire est ce qui tient les alvéoles : la structure où la ruche
// range ce qu'elle produit. Ici, c'est le miroir en lecture seule du dépôt d'un
// projet, tenu par le hub, que les abeilles consultent depuis le tableau de
// bord — le code, tel qu'il est, à côté des tâches qui le transforment.
//
// ─── LE SEUL VRAI DANGER, ET IL EST ÉNORME ───────────────────────────────────
//
// Servir des fichiers depuis un chemin fourni par le client est LA faille
// classique du web, et elle ne pardonne pas : une seule erreur, et
// `?chemin=../../../../etc/passwd` — ou pire, `../../.env` de la ruche — sort
// par la même route. Ce fichier est donc écrit comme si l'appelant était
// hostile, parce qu'il l'est par hypothèse : le tableau de bord se partage en
// lecture par un tunnel public.
//
// Sept contournements sont fermés nommément, et chacun a son test :
//
//   1. `..` sous toutes ses formes, y compris mêlé à des segments valides
//      (`a/../../b`) et en séparateurs Windows (`..\\`).
//   2. Les chemins ABSOLUS (`/etc/passwd`, `C:\Windows`, `\\serveur\part`).
//   3. L'OCTET NUL — `fichier.txt\0.png` : les couches C tronquent à `\0` là où
//      JavaScript ne le fait pas, et la vérification porte alors sur autre
//      chose que ce qui sera ouvert.
//   4. LE BUG DE PRÉFIXE : `/base` est un préfixe de `/base-mechant`. Comparer
//      des chaînes sans exiger le séparateur laisse sortir tout un répertoire
//      voisin, et c'est l'erreur la plus fréquente dans les correctifs de
//      traversée.
//   5. Les LIENS SYMBOLIQUES — un dépôt peut en contenir, et un lien vers
//      `/etc` transforme un miroir sain en passe-partout. La résolution se
//      fait donc sur le chemin RÉEL, après quoi seulement on compare.
//   6. `.git` — il contient `config`, donc l'URL distante, donc les
//      identifiants quand le dépôt est privé. Le servir annulerait tout le
//      soin pris ailleurs à ne jamais ranger un secret en clair.
//   7. Les fichiers de secrets qu'un dépôt contient parfois par accident
//      (`.env`, clés privées). On ne PEUT pas les rendre inoffensifs — ils sont
//      dans le dépôt — mais on peut refuser de les afficher à quelqu'un qui
//      n'aurait jamais eu accès au dépôt lui-même.
//
// ─── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
//
// Il ne touche AUCUN disque. C'est ce qui le rend testable en entier, y compris
// sur des formes de chemins qu'on ne pourrait pas créer sur la machine de test
// (un `C:\` sous Linux, un lien symbolique vers `/etc` dans une CI). La partie
// impure — lire, lister, résoudre les liens — vit dans `orchestrator/miroir.ts`
// et se contente d'appeler ce qui suit.

import path from 'node:path';

/** Un fichier ou un dossier du rayon, tel que le tableau de bord le reçoit. */
export interface Entree {
  /** Chemin relatif à la racine du dépôt, toujours en `/`. */
  chemin: string;
  nom: string;
  type: 'fichier' | 'dossier';
  /** Taille en octets. `0` pour un dossier. */
  taille: number;
}

export type Refus =
  'vide' | 'absolu' | 'traversee' | 'octet_nul' | 'interdit' | 'trop_long' | 'hors_rayon';

export type Verdict = { ok: true; relatif: string } | { ok: false; refus: Refus };

/**
 * Les répertoires qu'on ne sert JAMAIS, quoi qu'il arrive.
 *
 * `.git` est le premier et le plus important : il contient `config`, donc
 * l'URL du dépôt distant, donc les identifiants quand celui-ci est privé
 * (`https://user:ghp_…@github.com/…`). Le reste est du bruit de construction
 * qui n'apprend rien et pèse lourd.
 */
export const DOSSIERS_INTERDITS = [
  '.git',
  'node_modules',
  '.hive',
  '.venv',
  '__pycache__',
  '.next',
  '.turbo',
] as const;

/**
 * Les fichiers qu'on ne sert jamais non plus.
 *
 * Ils sont dans le dépôt, donc quiconque a le dépôt les a déjà — on ne prétend
 * pas les protéger de LUI. Ce qu'on refuse, c'est de les afficher à quelqu'un
 * qui n'a reçu qu'un lien de lecture : un partage de tableau de bord n'est pas
 * un clone, et ne doit pas le devenir par ce chemin-là.
 */
export const FICHIERS_INTERDITS = [
  '.env',
  '.env.local',
  '.env.production',
  '.npmrc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
] as const;

/** Extensions de clés et de secrets, refusées quel que soit le nom. */
const EXTENSIONS_INTERDITES = ['.pem', '.key', '.pfx', '.p12', '.keystore', '.jks'];

/** Un chemin plus long que ça n'est pas un chemin, c'est une tentative. */
export const LONGUEUR_MAX_CHEMIN = 1024;

/** Au-delà, on ne rend pas le contenu : un éditeur n'en ferait rien de bon. */
export const TAILLE_MAX_FICHIER = 512 * 1024;

/**
 * Le chemin demandé, ramené à une forme sûre — ou le motif du refus.
 *
 * **Rend un chemin RELATIF**, jamais absolu : c'est délibéré. L'appelant doit
 * le joindre lui-même à la racine du rayon, puis vérifier le résultat avec
 * `dansLeRayon` une fois les liens symboliques résolus. Rendre un absolu ici
 * inviterait à s'en servir directement, sans cette seconde vérification — et
 * c'est précisément la vérification qui attrape les liens.
 */
export function cheminDemande(brut: string): Verdict {
  if (typeof brut !== 'string' || brut.trim() === '') return { ok: false, refus: 'vide' };
  if (brut.length > LONGUEUR_MAX_CHEMIN) return { ok: false, refus: 'trop_long' };

  // L'OCTET NUL D'ABORD. `fichier.txt\0.png` passe toutes les vérifications
  // d'extension côté JavaScript, puis les couches C tronquent à `\0` : ce qui
  // est ouvert n'est pas ce qui a été vérifié. Il n'existe aucun usage
  // légitime, donc aucune raison de le tolérer quelque part.
  if (brut.includes('\0')) return { ok: false, refus: 'octet_nul' };

  // On travaille en `/` : un dépôt cloné sous Windows n'a pas des chemins
  // différents, seulement une autre façon de les écrire.
  const normalise = brut.replace(/\\/g, '/');

  // Absolu sous toutes ses formes. `//serveur/part` (UNC) compte : sous
  // Windows il désigne une autre machine, et sous POSIX il reste absolu.
  if (normalise.startsWith('/')) return { ok: false, refus: 'absolu' };
  if (/^[A-Za-z]:/.test(normalise)) return { ok: false, refus: 'absolu' };

  const segments = normalise.split('/').filter((s) => s !== '' && s !== '.');

  // `..` est refusé, jamais « résolu ». Résoudre `a/../b` en `b` serait
  // correct ici et deviendrait faux le jour où un `a` est un lien symbolique :
  // le système d'exploitation, lui, suivrait le lien AVANT de remonter. Deux
  // façons de calculer le même chemin qui divergent, c'est exactement le genre
  // d'écart dont naissent les traversées.
  if (segments.some((s) => s === '..')) return { ok: false, refus: 'traversee' };
  if (segments.length === 0) return { ok: false, refus: 'vide' };

  for (const segment of segments) {
    if (estInterdit(segment)) return { ok: false, refus: 'interdit' };
  }

  return { ok: true, relatif: segments.join('/') };
}

/** Ce segment de chemin est-il de ceux qu'on ne sert jamais ? */
export function estInterdit(segment: string): boolean {
  const bas = segment.toLowerCase();
  if ((DOSSIERS_INTERDITS as readonly string[]).includes(bas)) return true;
  if ((FICHIERS_INTERDITS as readonly string[]).includes(bas)) return true;
  if (EXTENSIONS_INTERDITES.some((e) => bas.endsWith(e))) return true;
  // `.env.quelquechose` : les variantes se multiplient avec les outils, et les
  // énumérer une à une serait toujours en retard d'une mode.
  if (bas === '.env' || bas.startsWith('.env.')) return true;
  return false;
}

/**
 * Ce chemin RÉEL est-il bien à l'intérieur de la racine RÉELLE ?
 *
 * Les deux doivent avoir été résolus au préalable (`realpath`) : c'est cette
 * étape qui attrape les liens symboliques, et elle ne peut pas se faire ici,
 * qui est pur.
 *
 * ─── LE BUG DE PRÉFIXE ──────────────────────────────────────────────────────
 *
 * `'/srv/rayon-mechant'.startsWith('/srv/rayon')` est VRAI. La comparaison
 * naïve laisse donc sortir un répertoire voisin entier, et c'est l'erreur la
 * plus fréquente dans les correctifs de traversée — celle qu'on introduit en
 * croyant refermer la faille. On exige le séparateur, et on traite à part le
 * cas où le chemin EST la racine.
 */
export function dansLeRayon(racineReelle: string, cheminReel: string): boolean {
  const racine = path.resolve(racineReelle);
  const cible = path.resolve(cheminReel);
  if (cible === racine) return true;
  return cible.startsWith(racine.endsWith(path.sep) ? racine : racine + path.sep);
}

/**
 * Le langage à donner à l'éditeur, d'après le nom du fichier.
 *
 * Rendu ici, et pas dans le navigateur, pour une raison de fond : le serveur
 * sait déjà s'il a affaire à du binaire, et un client qui devinerait tout seul
 * finirait par afficher un `.png` comme du texte.
 */
export function langageDe(chemin: string): string {
  const nom = chemin.toLowerCase();
  const ext = nom.slice(nom.lastIndexOf('.'));
  const table: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.json': 'json',
    '.css': 'css',
    '.scss': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.md': 'markdown',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.rb': 'ruby',
    '.php': 'php',
    '.sh': 'shell',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.sql': 'sql',
  };
  return table[ext] ?? 'texte';
}

/**
 * Ce contenu est-il du binaire ?
 *
 * Un octet nul dans les premiers kilo-octets est le signal que tout le monde
 * utilise, et il suffit : on ne cherche pas à reconnaître des formats, on
 * cherche à ne pas déverser une image dans un éditeur de texte. On ne regarde
 * que le début — parcourir un fichier entier pour cette question coûterait
 * plus cher que la réponse ne vaut.
 */
export function estBinaire(debut: Uint8Array): boolean {
  const n = Math.min(debut.length, 8000);
  for (let i = 0; i < n; i++) if (debut[i] === 0) return true;
  return false;
}

/**
 * Trie les entrées d'un dossier comme un humain les cherche : les dossiers
 * d'abord, puis l'ordre alphabétique insensible à la casse et aux accents.
 *
 * Trier « à l'octet » mettrait `Z.ts` avant `a.ts` et `Élan` en toute fin —
 * dans un projet francophone, c'est une liste qu'on ne peut pas parcourir.
 */
export function trierEntrees(entrees: readonly Entree[]): Entree[] {
  return [...entrees].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dossier' ? -1 : 1;
    return a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base', numeric: true });
  });
}
