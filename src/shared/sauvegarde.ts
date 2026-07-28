// La sauvegarde de la base — décider quoi écrire, et quoi élaguer.
//
// ─── POURQUOI PAS UN `cp` ────────────────────────────────────────────────────
//
// La base tourne en mode WAL : les écritures récentes vivent dans un fichier
// `-wal` À CÔTÉ du fichier principal, et n'y sont repliées que de temps en
// temps. Copier le `.db` à chaud donne donc une base qui s'ouvre sans erreur,
// passe `integrity_check`, et à laquelle il MANQUE des lignes.
//
// Mesuré sur cette machine avant d'écrire une ligne de ce module, sur 5 000
// insertions :
//
//     VACUUM INTO          5 000 / 5 000 lignes   integrity_check : ok
//     copie du fichier     4 741 / 5 000 lignes   integrity_check : ok
//
// 259 lignes disparues en silence, dans une copie qui a l'air valide. C'est la
// pire forme de sauvegarde : celle qu'on croit avoir.
//
// `VACUUM INTO` lit la base par le moteur, WAL compris, et écrit une copie
// COMPACTE et cohérente. C'est une seule instruction : elle aboutit ou elle
// échoue, jamais à moitié.
//
// ─── ET IL REFUSE D'ÉCRASER ──────────────────────────────────────────────────
//
// « output file already exists » — vérifié aussi. Ce n'est pas une gêne, c'est
// une garantie : on écrit donc dans un nom TEMPORAIRE, puis on renomme. Le
// renommage est atomique sur un même système de fichiers, ce qui veut dire
// qu'une sauvegarde publiée est toujours complète, même si le processus meurt
// au milieu.
//
// ─── PUR ─────────────────────────────────────────────────────────────────────
//
// Aucun accès disque, aucune horloge lue au passage : l'instant est un
// PARAMÈTRE. C'est ce qui rend les noms et l'élagage vérifiables sans attendre
// une seconde de plus.

import path from 'node:path';

/** Ce qu'il faut savoir pour décider d'une sauvegarde. */
export interface Contexte {
  /** La racine de l'installation. */
  readonly racine: string;
  /** Le fichier SQLite à sauvegarder. */
  readonly dbPath: string;
  /** Où déposer les sauvegardes. Défaut : `<données>/sauvegardes`. */
  readonly dossier?: string;
  /** L'instant, en ISO 8601. Paramètre, jamais `new Date()` lu ici. */
  readonly maintenant: string;
  /** Combien de sauvegardes garder. La borne d'élagage, obligatoire. */
  readonly garder: number;
  readonly plateforme: NodeJS.Platform;
}

export interface Plan {
  readonly genre: 'plan';
  readonly dossier: string;
  /** Le fichier lu. */
  readonly source: string;
  /** Là où `VACUUM INTO` écrit — un nom que personne d'autre n'utilise. */
  readonly temporaire: string;
  /** Le nom publié, une fois la copie complète. */
  readonly definitif: string;
}

export interface Refus {
  readonly genre: 'refus';
  readonly motif: string;
}

/** Le préfixe des sauvegardes. Sert aussi à les RECONNAÎTRE pour élaguer. */
export const PREFIXE = 'hive-';
export const SUFFIXE = '.db';

/**
 * Le nom d'une sauvegarde prise à cet instant.
 *
 * ─── POURQUOI CE FORMAT-LÀ ───────────────────────────────────────────────────
 *
 * `hive-2026-07-28T20-30-00-000Z.db`. Les `:` de l'ISO deviennent des `-` :
 * Windows les refuse dans un nom de fichier, et une sauvegarde qui ne peut pas
 * s'écrire sur une des trois plateformes n'est pas une sauvegarde.
 *
 * Le reste de l'ISO est conservé tel quel, et c'est délibéré : l'ordre
 * LEXICOGRAPHIQUE de ces noms est l'ordre CHRONOLOGIQUE. L'élagage n'a donc pas
 * besoin de lire des dates de modification — donc pas de départage à inventer
 * entre deux fichiers de même milliseconde. Ce dépôt a déjà payé trois fois
 * pour un `ORDER BY` sans départage (§ 7 de `docs/ERREURS.md`) ; ici le
 * problème n'existe pas, par construction.
 */
export function nomDe(iso: string): string {
  return `${PREFIXE}${iso.replace(/:/g, '-')}${SUFFIXE}`;
}

/** Est-ce une sauvegarde de Hive, ou un fichier qui traînait là ? */
export function estUneSauvegarde(nom: string): boolean {
  return nom.startsWith(PREFIXE) && nom.endsWith(SUFFIXE) && !nom.endsWith('.part.db');
}

/**
 * Ce qu'il faut écrire, et où.
 *
 * Le temporaire porte le même horodatage plus `.part` : deux sauvegardes
 * lancées la même milliseconde s'écraseraient, mais elles produiraient de
 * toute façon le même contenu. Ce qui compte est qu'un `.part` ne puisse
 * JAMAIS être pris pour une sauvegarde publiée — d'où `estUneSauvegarde`.
 */
export function planifier(ctx: Contexte): Plan | Refus {
  const p = ctx.plateforme === 'win32' ? path.win32 : path.posix;

  if (!p.isAbsolute(ctx.dbPath)) {
    return {
      genre: 'refus',
      motif:
        `Le chemin de la base « ${ctx.dbPath} » est relatif. Une sauvegarde se ` +
        'lance aussi depuis un service ou une tâche planifiée, dont le répertoire ' +
        'courant n’est pas le vôtre : tous les chemins doivent être absolus.',
    };
  }
  if (!Number.isInteger(ctx.garder) || ctx.garder < 1) {
    return {
      genre: 'refus',
      motif:
        `« garder ${ctx.garder} » n’a pas de sens. Il en faut au moins une : une ` +
        'sauvegarde qui s’élague elle-même n’en est pas une.',
    };
  }

  const dossier = ctx.dossier ?? p.join(p.dirname(ctx.dbPath), 'sauvegardes');
  const nom = nomDe(ctx.maintenant);
  return {
    genre: 'plan',
    dossier,
    source: ctx.dbPath,
    temporaire: p.join(dossier, `${nom.slice(0, -SUFFIXE.length)}.part${SUFFIXE}`),
    definitif: p.join(dossier, nom),
  };
}

/**
 * Lesquelles retirer pour n'en garder que `garder`.
 *
 * ─── LA BORNE D'ÉLAGAGE ARRIVE AVEC LA FONCTIONNALITÉ ────────────────────────
 *
 * Règle du dépôt : tout ce qui s'accumule ship sa borne dans le MÊME commit.
 * Sans elle, une sauvegarde quotidienne remplit un disque en quelques mois, et
 * la panne arrive un jour où personne ne pense aux sauvegardes.
 *
 * On trie sur le NOM, pas sur une date de modification : les noms portent
 * l'horodatage ISO, donc leur ordre lexicographique est leur ordre
 * chronologique — et il est TOTAL. Aucun départage à inventer, aucune paire
 * ambiguë.
 *
 * Les `.part` ne sont jamais comptés comme des sauvegardes, mais ils sont
 * rendus séparément : un `.part` qui traîne est le reste d'un processus tué,
 * et personne ne le nettoierait autrement.
 */
export function aElaguer(
  noms: readonly string[],
  garder: number,
): { retirer: string[]; restes: string[] } {
  const restes = noms.filter((n) => n.startsWith(PREFIXE) && n.endsWith(`.part${SUFFIXE}`)).sort();
  const publiees = noms.filter(estUneSauvegarde).sort();
  // Les plus récentes en tête, puis on coupe.
  const parAge = [...publiees].reverse();
  return { retirer: parAge.slice(Math.max(0, garder)).sort(), restes };
}
