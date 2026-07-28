// La moitié qui touche le disque et la base, en face de
// `src/shared/sauvegarde.ts`.
//
// Même partage que partout ailleurs dans ce dépôt : le module pur DIT quoi
// écrire et quoi élaguer, celui-ci le fait.
//
// ─── L'ORDRE DES GESTES, ET POURQUOI IL NE SE NÉGOCIE PAS ────────────────────
//
//   1. `VACUUM INTO` vers un nom TEMPORAIRE. Il aboutit ou il échoue ; il ne
//      laisse jamais une copie à moitié écrite sous un nom définitif.
//   2. Renommage. Atomique sur un même système de fichiers : une sauvegarde
//      publiée est donc toujours complète, même si le processus meurt entre
//      les deux.
//   3. Élagage — APRÈS la publication, jamais avant. Élaguer d'abord, c'est
//      détruire l'ancienne sauvegarde avant d'être sûr d'en avoir une nouvelle.

import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { type Contexte, type Plan, type Refus, aElaguer, planifier } from './shared/sauvegarde.js';

/** Ce qu'une sauvegarde a donné. */
export interface Compte {
  readonly plan: Plan;
  /** Le fichier publié. */
  readonly fichier: string;
  readonly octets: number;
  /** Les sauvegardes retirées par la borne d'élagage. */
  readonly elaguees: readonly string[];
  /** Les `.part` d'un processus tué, ramassés au passage. */
  readonly restes: readonly string[];
}

/** Ce que la base sait faire. Injectable pour que les tests observent. */
export interface Base {
  /** Exécute `VACUUM INTO`. Le chemin est cité par l'appelant. */
  readonly copierVers: (cible: string) => void;
  readonly fermer: () => void;
}

/**
 * Ouvre la base et rend de quoi la copier.
 *
 * ─── LE CHEMIN EST CITÉ, PAS CONCATÉNÉ ───────────────────────────────────────
 *
 * `VACUUM INTO` prend un littéral de chaîne SQL. Un chemin contenant une
 * apostrophe — `/home/j'ai/hive` — refermerait la chaîne et le reste
 * deviendrait du SQL. On double donc les apostrophes, comme SQLite l'exige,
 * et un test donne des chemins hostiles à cette fonction.
 *
 * On n'utilise PAS de paramètre lié (`?`) : SQLite ne les accepte pas dans un
 * `VACUUM INTO`. C'est précisément le cas où la citation manuelle est la seule
 * option — donc celui où elle doit être écrite une fois, ici, et testée.
 */
export function citerSql(valeur: string): string {
  return `'${valeur.replace(/'/g, "''")}'`;
}

export async function ouvrir(dbPath: string): Promise<Base> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(dbPath, { readonly: false, fileMustExist: true });
  return {
    copierVers: (cible) => {
      db.exec(`VACUUM INTO ${citerSql(cible)}`);
    },
    fermer: () => db.close(),
  };
}

/** L'instant, en ISO — sorti d'ici pour que les tests le fixent. */
export function contexteReel(
  racine: string,
  dbPath: string,
  garder: number,
  dossier?: string,
  maintenant: string = new Date().toISOString(),
): Contexte {
  return {
    racine: path.resolve(racine),
    dbPath: path.resolve(dbPath),
    ...(dossier === undefined ? {} : { dossier: path.resolve(dossier) }),
    maintenant,
    garder,
    plateforme: process.platform,
  };
}

/**
 * Prend une sauvegarde, publie, puis élague.
 *
 * `ouvre` est injectable : les tests fournissent une base en mémoire plutôt
 * que d'exiger `better-sqlite3` — qui est une dépendance OPTIONNELLE, absente
 * d'une installation de nœud allégée.
 */
export async function sauvegarder(
  ctx: Contexte,
  ouvre: (dbPath: string) => Promise<Base> = ouvrir,
): Promise<Compte | Refus> {
  const plan = planifier(ctx);
  if (plan.genre === 'refus') return plan;

  mkdirSync(plan.dossier, { recursive: true });

  const base = await ouvre(plan.source);
  try {
    base.copierVers(plan.temporaire);
  } finally {
    base.fermer();
  }
  // Atomique : ce qui porte un nom définitif est complet, toujours.
  renameSync(plan.temporaire, plan.definitif);

  const { retirer, restes } = aElaguer(readdirSync(plan.dossier), ctx.garder);
  for (const nom of [...retirer, ...restes]) {
    // On ne retire JAMAIS celle qu'on vient d'écrire, quelle que soit la
    // borne. `aElaguer` garde déjà les plus récentes, mais une garde explicite
    // coûte une ligne et ferme la classe entière.
    const c = path.join(plan.dossier, nom);
    if (c === plan.definitif) continue;
    rmSync(c, { force: true, maxRetries: 5, retryDelay: 100 });
  }

  return {
    plan,
    fichier: plan.definitif,
    octets: statSync(plan.definitif).size,
    elaguees: retirer.filter((n) => path.join(plan.dossier, n) !== plan.definitif),
    restes,
  };
}
