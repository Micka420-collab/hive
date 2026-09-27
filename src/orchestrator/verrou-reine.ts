// Le verrou de la Reine — UNE seule Reine par base.
//
// ─── POURQUOI UNE SEULE ─────────────────────────────────────────────────────
//
// L'ordonnanceur est écrit pour un écrivain unique : il LIT une tâche, décide,
// puis ÉCRIT, en plusieurs appels au store. Sous une seule Reine c'est sûr —
// better-sqlite3 est synchrone, rien ne s'intercale entre la lecture et
// l'écriture. Deux Reines sur la même base, et ces séquences s'entrelacent :
//
//   • au DÉMARRAGE, `recoverOrphanTasks` requalifie en `ready` toute tâche
//     `assigned`/`running` et passe tous les nœuds `offline`. La seconde Reine
//     volerait donc les travaux EN VOL de la première, qui repartiraient une
//     deuxième fois, sur un autre nœud ;
//   • la promotion `pending → ready`, la ré-adoption à la reconnexion d'un
//     nœud, le traitement d'un résultat : chacune relit la ligne puis la
//     réécrit entière (`patchTask`), et le dernier écrivain gagne.
//
// Les réclamations `→ assigned` sont EN PLUS conditionnelles
// (`store.reclamerTache`) : la ceinture sous les bretelles. Mais aucune
// condition d'UPDATE ne rattrape le vol du démarrage — c'est pour lui qu'on
// interdit, plutôt que de rendre chaque écriture concurrente-sûre.
//
// ─── LE VERROU ──────────────────────────────────────────────────────────────
//
// `<base>.reine.lock`, À CÔTÉ de la base, créé en exclusif (`wx` : l'OS refuse
// de le créer s'il existe) et portant `{ pid, hote, demarrage, depuis }`.
// Rendu par `stop()`. Un processus tué (SIGKILL, OOM, coupure de courant) le
// laisse derrière lui : il est alors PÉRIMÉ, et la Reine suivante le reprend
// si — et seulement si — elle peut le PROUVER (`jugerVerrou`).
//
// Tout le reste REFUSE, avec le chemin à supprimer : un pid vivant, un autre
// hôte (on ne peut rien y vérifier — deux conteneurs qui partagent un volume
// en sont le cas réel), un verrou illisible. On ne devine pas qu'une Reine
// est morte : on le dit à l'humain.
//
// ─── LE COMPROMIS ASSUMÉ ────────────────────────────────────────────────────
//
// Deux Reines qui démarrent à la même microseconde devant un verrou PÉRIMÉ
// peuvent toutes deux le reprendre : relire puis supprimer n'est pas atomique.
// Un verrou du noyau (`flock`) fermerait cette fenêtre, mais Node n'en offre
// aucun sans module natif. La fenêtre est de l'ordre de la microseconde, et ce
// qu'elle laisserait passer, les réclamations conditionnelles le rattrapent.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Ce que le verrou dit de la Reine qui le tient. */
export interface TenantVerrou {
  pid: number;
  hote: string;
  /** Identité du démarrage du système (`demarrageDuSysteme`). */
  demarrage: string;
  /** Instant de la prise, en ISO — pour le message, jamais pour décider. */
  depuis: string;
}

/** Pourquoi un verrou est jugé périmé — dit à l'humain, jamais deviné. */
export type RaisonPeremption =
  /** Même hôte, même démarrage, et le pid ne répond plus. */
  | 'processus-mort'
  /** Le pid est le NÔTRE, sans que ce processus tienne le verrou. */
  | 'meme-pid'
  /** Le pid est celui de notre PARENT. */
  | 'pid-parent'
  /** Le système a redémarré depuis la prise : aucun processus d'alors ne vit. */
  | 'systeme-redemarre';

export type JugementVerrou =
  | { genre: 'perime'; tenant: TenantVerrou; raison: RaisonPeremption }
  | { genre: 'tenu'; tenant: TenantVerrou }
  | { genre: 'ailleurs'; tenant: TenantVerrou }
  | { genre: 'illisible' };

/** Les faits de CE processus, dont le jugement a besoin. */
export interface FaitsIci {
  pid: number;
  ppid: number;
  hote: string;
  demarrage: string;
  vivant: (pid: number) => boolean;
}

export interface VerrouReine {
  readonly chemin: string;
  /** Le verrou périmé qui a été repris pour démarrer, s'il y en avait un. */
  readonly reprise: { tenant: TenantVerrou; raison: RaisonPeremption } | null;
  /** Rend le verrou. Idempotent ; ne supprime jamais le verrou d'un autre. */
  liberer(): void;
}

/**
 * Tolérance entre deux lectures d'un même démarrage, hors Linux. L'instant de
 * démarrage y est DÉDUIT (`maintenant − os.uptime()`), donc il bouge avec les
 * corrections d'horloge : deux minutes absorbent un recalage NTP ordinaire.
 * Trop serré, un recalage ferait croire à un redémarrage — et reprendre le
 * verrou d'une Reine vivante.
 */
const TOLERANCE_DEMARRAGE_MS = 120_000;

/**
 * Les verrous que CE processus tient. Sans ce registre, le pid du verrou égal
 * au nôtre ne se distinguerait pas de deux Reines dans un même processus.
 */
const DETENUS = new Set<string>();

/** `<base>.reine.lock`, en absolu : la libération vise le même fichier que la prise. */
export function cheminVerrouReine(dbPath: string): string {
  return `${path.resolve(dbPath)}.reine.lock`;
}

/**
 * L'identité du démarrage du système.
 *
 * Linux la donne exactement (`boot_id`, le même dans tous les conteneurs d'un
 * hôte, neuf à chaque démarrage du noyau). Ailleurs, on la déduit de
 * l'horloge et de `os.uptime()`, préfixée `~` pour que la comparaison sache
 * qu'elle est approchée.
 */
export function demarrageDuSysteme(): string {
  try {
    const id = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (id.length > 0) return id;
  } catch {
    // Pas Linux, ou /proc fermé : on retombe sur l'instant déduit.
  }
  return `~${Math.round(Date.now() - os.uptime() * 1000)}`;
}

/** La forme d'un `boot_id` Linux ; tout le reste n'est pas une identité exacte. */
const BOOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Un instant de démarrage déduit, `~` puis des millisecondes. */
const DEMARRAGE_APPROCHE = /^~\d+$/;

/**
 * Deux identités de démarrage désignent-elles le MÊME démarrage ?
 *
 * Dans le doute, OUI. « Pas le même » fait reprendre le verrou ; « le même »
 * laisse seulement la main au test du pid. Se tromper dans le premier sens
 * lancerait deux Reines ; dans le second, on refuse et on dit quoi supprimer.
 */
function memeDemarrage(a: string, b: string): boolean {
  if (a === b) return true;
  // Deux `boot_id` différents : le noyau a redémarré, c'est une preuve.
  if (BOOT_ID.test(a) && BOOT_ID.test(b)) return false;
  if (DEMARRAGE_APPROCHE.test(a) && DEMARRAGE_APPROCHE.test(b)) {
    return Math.abs(Number(a.slice(1)) - Number(b.slice(1))) <= TOLERANCE_DEMARRAGE_MS;
  }
  // Un exact contre un approché, ou une valeur abîmée : on ne sait pas
  // comparer — donc le même.
  return true;
}

/** Relit un verrou. Un champ manquant ou faux rend tout le verrou illisible. */
function lireTenant(brut: string): TenantVerrou | null {
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return null;
  }
  if (typeof lu !== 'object' || lu === null) return null;
  const o = lu as Record<string, unknown>;
  // `pid > 0` n'est pas une coquetterie : `process.kill(0, 0)` vise le GROUPE
  // du processus et `kill(-1, 0)` tous ceux qu'on peut atteindre — les deux
  // « répondent », et un verrou abîmé passerait pour tenu à jamais.
  if (typeof o.pid !== 'number' || !Number.isSafeInteger(o.pid) || o.pid <= 0) return null;
  if (typeof o.hote !== 'string' || typeof o.demarrage !== 'string') return null;
  if (typeof o.depuis !== 'string') return null;
  return { pid: o.pid, hote: o.hote, demarrage: o.demarrage, depuis: o.depuis };
}

/**
 * Le jugement, PUR : le contenu du verrou, les faits d'ici, et si CE processus
 * le tient déjà. L'ordre des questions est celui de la preuve la plus forte.
 *
 * Le pid égal au nôtre ou à celui de notre parent vaut « périmé » : un
 * redémarrage redonne volontiers le même numéro (la Reine d'un conteneur est
 * de nouveau pid 1 ; un service relancé au démarrage retombe près de son
 * ancien numéro, et le shell ou `npm` qui nous lance peut l'avoir pris).
 * PostgreSQL fait la même exception dans `CreateLockFile` (miscinit.c).
 */
export function jugerVerrou(brut: string, ici: FaitsIci, tenuIci: boolean): JugementVerrou {
  const tenant = lireTenant(brut);
  if (tenant === null) return { genre: 'illisible' };
  if (tenant.hote !== ici.hote) return { genre: 'ailleurs', tenant };
  if (tenant.pid === ici.pid) {
    return tenuIci ? { genre: 'tenu', tenant } : { genre: 'perime', tenant, raison: 'meme-pid' };
  }
  if (!memeDemarrage(tenant.demarrage, ici.demarrage)) {
    return { genre: 'perime', tenant, raison: 'systeme-redemarre' };
  }
  if (tenant.pid === ici.ppid) return { genre: 'perime', tenant, raison: 'pid-parent' };
  if (ici.vivant(tenant.pid)) return { genre: 'tenu', tenant };
  return { genre: 'perime', tenant, raison: 'processus-mort' };
}

/** Le refus, en clair : qui tient la base, pourquoi c'est interdit, quoi faire. */
function direRefusVerrou(
  jugement: Exclude<JugementVerrou, { genre: 'perime' }>,
  dbPath: string,
  chemin: string,
): string {
  // Le chemin seul, sans commande : `rm` n'existe pas sous cmd.exe, et une
  // citation POSIX serait fausse sous PowerShell.
  const supprimer = `     ${chemin}`;
  if (jugement.genre === 'illisible') {
    return (
      `\n✘ Verrou de Reine illisible : ${chemin}\n\n` +
      '  Il ne dit ni quel processus tient la base, ni depuis quand : on ne le\n' +
      '  reprend pas à l’aveugle.\n\n' +
      `  → Si aucune Reine ne tourne sur ${dbPath}, supprimez-le :\n${supprimer}\n`
    );
  }
  const { tenant } = jugement;
  const qui = `pid ${tenant.pid} sur « ${tenant.hote} », depuis ${tenant.depuis}`;
  const pourquoi =
    '  Deux Reines sur une même base s’assigneraient les mêmes tâches, et la\n' +
    '  seconde requalifierait au démarrage les travaux en vol de la première.\n\n';
  if (jugement.genre === 'ailleurs') {
    return (
      `\n✘ Cette base est tenue par une Reine d’une AUTRE machine (${qui}) :\n` +
      `     ${dbPath}\n\n${pourquoi}` +
      '  D’ici, impossible de vérifier que cette Reine est arrêtée.\n\n' +
      `  → Si elle l’est, supprimez le verrou :\n${supprimer}\n`
    );
  }
  return (
    `\n✘ Une autre Reine tient déjà cette base (${qui}) :\n` +
    `     ${dbPath}\n\n${pourquoi}` +
    '  → Arrêtez l’autre Reine, ou donnez à celle-ci une autre base (HIVE_DB).\n' +
    `  → Si aucune Reine ne tourne (le pid ${tenant.pid} est un autre programme),\n` +
    `    supprimez le verrou :\n${supprimer}\n`
  );
}

/** Une ligne de journal pour le verrou périmé repris — un démarrage qui l'a fait le dit. */
export function direRepriseVerrou(reprise: NonNullable<VerrouReine['reprise']>): string {
  const pourquoi: Record<RaisonPeremption, string> = {
    'processus-mort': 'ce processus n’existe plus',
    'meme-pid': 'ce pid est désormais le nôtre',
    'pid-parent': 'ce pid est désormais celui de notre parent',
    'systeme-redemarre': 'le système a redémarré depuis',
  };
  const { tenant, raison } = reprise;
  return (
    `[hive] verrou de Reine périmé repris : pid ${tenant.pid}, pris le ${tenant.depuis} — ` +
    `${pourquoi[raison]}. La Reine précédente s’est arrêtée sans le rendre.`
  );
}

function pidVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM : le processus existe, il appartient à un autre compte. Vivant.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lireSiPresent(chemin: string): string | null {
  try {
    return readFileSync(chemin, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Prend le verrou de la base, ou REFUSE avec un message qui dit quoi faire.
 * `:memory:` n'a rien à partager : pas de verrou, `null`.
 *
 * Trois essais : un verrou périmé se supprime puis se recrée, et une autre
 * Reine peut s'intercaler entre les deux — on rejuge alors le SIEN.
 */
export function prendreVerrouReine(dbPath: string): VerrouReine | null {
  if (dbPath === ':memory:') return null;
  const chemin = cheminVerrouReine(dbPath);
  const ici: FaitsIci = {
    pid: process.pid,
    ppid: process.ppid,
    hote: os.hostname(),
    demarrage: demarrageDuSysteme(),
    vivant: pidVivant,
  };
  const contenu = JSON.stringify({
    pid: ici.pid,
    hote: ici.hote,
    demarrage: ici.demarrage,
    depuis: new Date().toISOString(),
  } satisfies TenantVerrou);
  // Le dossier de la base peut ne pas exister encore (premier démarrage) : le
  // verrou est pris AVANT que le store ne le crée.
  mkdirSync(path.dirname(chemin), { recursive: true });

  let reprise: VerrouReine['reprise'] = null;
  for (let essai = 0; essai < 3; essai++) {
    try {
      writeFileSync(chemin, contenu, { flag: 'wx' });
      DETENUS.add(chemin);
      return {
        chemin,
        reprise,
        liberer: () => {
          if (!DETENUS.delete(chemin)) return;
          // On ne supprime que NOTRE verrou : s'il a été remplacé (un humain
          // l'a effacé, une autre Reine l'a pris), il n'est plus à nous.
          if (lireSiPresent(chemin) === contenu) rmSync(chemin, { force: true });
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    const brut = lireSiPresent(chemin);
    if (brut === null) continue; // rendu entre-temps : on retente la prise
    const jugement = jugerVerrou(brut, ici, DETENUS.has(chemin));
    if (jugement.genre !== 'perime') throw new Error(direRefusVerrou(jugement, dbPath, chemin));
    reprise = { tenant: jugement.tenant, raison: jugement.raison };
    // Relu juste avant de supprimer : si une autre Reine l'a déjà remplacé
    // par le sien, ce n'est plus le verrou qu'on a jugé.
    if (lireSiPresent(chemin) === brut) rmSync(chemin, { force: true });
  }
  throw new Error(
    `\n✘ Le verrou de Reine ${chemin} a changé de main pendant le démarrage — ` +
      'une autre Reine démarre en même temps sur cette base. Réessayez quand elle aura fini.\n',
  );
}
