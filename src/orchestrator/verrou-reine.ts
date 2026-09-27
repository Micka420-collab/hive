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
// interdit, plutôt que de rendre chaque écriture concurrente-sûre. La revue
// séquence par séquence est dans docs/adr/0012-une-seule-reine-par-base.md.
//
// ─── LE VERROU : TENU PAR LE SYSTÈME, JAMAIS DEVINÉ ─────────────────────────
//
// `<base>.reine.lock` est une toute petite base SQLite, À CÔTÉ de la base. La
// Reine y inscrit qui elle est (pid, hôte, depuis), puis y garde une
// transaction d'écriture OUVERTE (`BEGIN IMMEDIATE`) toute sa vie. Le verrou
// d'octets que SQLite pose pour cette transaction (fcntl sous POSIX,
// LockFileEx sous Windows) appartient au SYSTÈME, et le système le rend quand
// le processus meurt, de quelque façon qu'il meure : SIGKILL, OOM, coupure de
// courant, conteneur détruit. Une seconde Reine qui tente la même transaction
// reçoit `SQLITE_BUSY` et refuse de démarrer, en lisant dans le fichier le nom
// de celle qui tient la base.
//
// Une première version jugeait au contraire un fichier de pid « périmé si… »
// (pid vivant, même hôte, même démarrage du système). Chaque indice y mentait
// quelque part — deux relectures l'ont montré sur le code, pas en théorie : un
// recalage d'horloge faisait passer une Reine VIVANTE pour redémarrée (hors
// Linux, l'instant de démarrage se déduit de l'horloge), un conteneur recréé
// après un `kill` changeait de nom d'hôte et refusait à jamais, deux espaces
// de pid qui partagent un nom d'hôte prenaient le pid 1 de l'autre pour le
// leur, et Windows recycle vite un pid mort. Le système, lui, SAIT qui tient
// un verrou : on ne lui fait plus deviner.
//
// Pourquoi SQLite : Node n'expose ni `flock` ni `LockFileEx`, et better-sqlite3
// est déjà là, qui pose ces verrous du système pour son propre compte. Ce
// fichier n'a pas d'autre rôle que de les porter.
//
// ─── TROIS RÈGLES, ET CE QUI CASSE SI ON EN LÂCHE UNE ───────────────────────
//
//   • On ne SUPPRIME jamais le fichier. Une Reine qui l'aurait ouvert juste
//     avant la suppression tiendrait un verrou sur un fichier disparu, et la
//     suivante en créerait un neuf à la même place : deux Reines. Après un
//     arrêt propre il reste, vide de tout nom.
//   • On ne l'ouvre JAMAIS par `fs` dans le processus de la Reine. Sous POSIX,
//     fermer N'IMPORTE QUEL descripteur d'un fichier rend TOUS les verrous
//     fcntl du processus sur ce fichier. SQLite s'en garde pour ses propres
//     connexions, pas pour un `readFileSync` : mesuré, un seul suffit à
//     laisser entrer une seconde Reine. Les AUTRES processus (`hive
//     desinstaller`) ne comptent pas — ces verrous sont par processus.
//   • Une base partagée entre MACHINES (NFS, SMB) n'a pas de verrou fiable.
//     Elle n'a pas de base fiable non plus : SQLite exclut le mode WAL sur un
//     système de fichiers réseau. Ce verrou ne promet rien de plus.

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { RefusDemarrage } from '../shared/amorce.js';

/** Ce que le verrou dit de la Reine qui le tient — pour le message, jamais pour décider. */
export interface TenantVerrou {
  pid: number;
  hote: string;
  /** Instant de la prise, en ISO. */
  depuis: string;
}

export interface VerrouReine {
  readonly chemin: string;
  /**
   * La Reine précédente, si elle s'est arrêtée SANS rendre la base (tuée,
   * coupée net) : son nom était encore inscrit. `null` après un arrêt propre.
   */
  readonly precedente: TenantVerrou | null;
  /** Rend le verrou. Idempotent. */
  liberer(): void;
}

/** Une inscription, avec le jeton qui distingue CETTE prise de toute autre. */
interface Inscription extends TenantVerrou {
  jeton: string;
}

const TABLE_TENANT =
  'CREATE TABLE IF NOT EXISTS tenant (' +
  'pid INTEGER NOT NULL, hote TEXT NOT NULL, depuis TEXT NOT NULL, jeton TEXT NOT NULL)';

/**
 * Les connexions qui TIENNENT un verrou, retenues ici jusqu'à `liberer()`.
 * better-sqlite3 ferme une connexion que le ramasse-miettes collecte : sans
 * cette référence, un appelant qui laisserait tomber le `VerrouReine` rendrait
 * le verrou au ramasse-miettes suivant, sans un mot. Mesuré : une connexion
 * sans référence était déjà fermée au premier sondage, avant tout `gc()` forcé.
 */
const TENUES = new Set<Database.Database>();

/** `<base>.reine.lock`, en absolu : la même base, le même verrou, d'où qu'on la nomme. */
export function cheminVerrouReine(dbPath: string): string {
  return `${path.resolve(dbPath)}.reine.lock`;
}

/**
 * Prend le verrou de la base, ou REFUSE avec un message qui dit quoi faire.
 * `:memory:` n'a rien à partager : pas de verrou, `null`.
 */
export function prendreVerrouReine(dbPath: string): VerrouReine | null {
  if (dbPath === ':memory:') return null;
  const chemin = cheminVerrouReine(dbPath);
  // Le dossier de la base peut ne pas exister encore (premier démarrage) : le
  // verrou est pris AVANT que le store ne le crée.
  mkdirSync(path.dirname(chemin), { recursive: true });
  // `timeout: 0` : une Reine ne fait pas la queue derrière une autre, elle refuse.
  const db = new Database(chemin, { timeout: 0 });
  try {
    const precedente = tenir(db, dbPath, chemin);
    TENUES.add(db);
    return { chemin, precedente, liberer: () => rendre(db) };
  } catch (err) {
    db.close();
    throw err;
  }
}

/**
 * S'inscrit puis TIENT : rend la Reine précédente restée inscrite, ou `null`.
 *
 * Inscrire demande un COMMIT, et un COMMIT rend le verrou ; on le reprend
 * aussitôt, et on vérifie que l'inscription lue est bien la NÔTRE. Une Reine
 * glissée entre ce COMMIT et ce BEGIN l'aurait remplacée par la sienne : on
 * se réinscrit, et c'est elle qui trouve le verrou tenu. Trois passes : la
 * première inscrit, la deuxième tient, la troisième absorbe une telle course.
 */
function tenir(db: Database.Database, dbPath: string, chemin: string): TenantVerrou | null {
  const moi: Inscription = {
    pid: process.pid,
    hote: os.hostname(),
    depuis: new Date().toISOString(),
    jeton: randomUUID(),
  };
  let precedente: TenantVerrou | null = null;
  try {
    for (let passe = 0; passe < 3; passe++) {
      if (!commencer(db)) throw new RefusDemarrage(direTenue(lireInscription(db), moi, dbPath));
      db.exec(TABLE_TENANT);
      const lue = lireInscription(db);
      if (lue?.jeton === moi.jeton) return precedente;
      if (passe === 0 && lue) precedente = { pid: lue.pid, hote: lue.hote, depuis: lue.depuis };
      db.prepare('DELETE FROM tenant').run();
      db.prepare('INSERT INTO tenant (pid, hote, depuis, jeton) VALUES (?, ?, ?, ?)').run(
        moi.pid,
        moi.hote,
        moi.depuis,
        moi.jeton,
      );
      db.exec('COMMIT');
    }
  } catch (err) {
    const code = codeSqlite(err);
    if (code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT') {
      throw new RefusDemarrage(direIllisible(dbPath, chemin));
    }
    throw err;
  }
  throw new RefusDemarrage(direTenue(null, moi, dbPath));
}

/** `BEGIN IMMEDIATE`, ou `false` si une autre connexion tient déjà la base. */
function commencer(db: Database.Database): boolean {
  try {
    db.exec('BEGIN IMMEDIATE');
    return true;
  } catch (err) {
    if (codeSqlite(err) === 'SQLITE_BUSY') return false;
    throw err;
  }
}

/**
 * L'inscription, ou `null` si personne n'est (encore) inscrit.
 *
 * Hors transaction, cette lecture prend un verrou PARTAGÉ : compatible avec
 * la transaction d'écriture que la Reine en place garde ouverte. Ce qui la
 * ferait échouer — la table pas encore créée, la Reine en place qui valide
 * son inscription à cet instant — laisse le nom inconnu, jamais inventé.
 */
function lireInscription(db: Database.Database): Inscription | null {
  let ligne: unknown;
  try {
    ligne = db.prepare('SELECT pid, hote, depuis, jeton FROM tenant LIMIT 1').get();
  } catch {
    return null;
  }
  if (typeof ligne !== 'object' || ligne === null) return null;
  const { pid, hote, depuis, jeton } = ligne as Record<string, unknown>;
  if (typeof pid !== 'number' || typeof hote !== 'string') return null;
  if (typeof depuis !== 'string' || typeof jeton !== 'string') return null;
  return { pid, hote, depuis, jeton };
}

/**
 * Rend le verrou : efface l'inscription, valide, ferme. Effacée AVANT de
 * rendre, pour qu'un arrêt propre ne laisse aucun nom — la Reine suivante ne
 * dira pas « arrêtée sans rendre la base » à tort.
 */
function rendre(db: Database.Database): void {
  if (!db.open) return;
  try {
    db.prepare('DELETE FROM tenant').run();
    db.exec('COMMIT');
  } catch (err) {
    // Le verrou tombe quand même à la fermeture : seul le nom resterait, et la
    // Reine suivante annoncerait à tort un arrêt brutal. On le dit ici.
    console.warn(
      `[hive] verrou de Reine rendu, mais son inscription n’a pu être effacée : ${String(err)}`,
    );
  } finally {
    db.close();
    TENUES.delete(db);
  }
}

function codeSqlite(err: unknown): string | undefined {
  return err instanceof Database.SqliteError ? err.code : undefined;
}

const POURQUOI_UNE_SEULE =
  '  Deux Reines sur une même base s’assigneraient les mêmes tâches, et la\n' +
  '  seconde requalifierait au démarrage les travaux en vol de la première.\n\n';

/** Le refus quand la base est tenue : qui la tient, pourquoi c'est interdit, quoi faire. */
function direTenue(tenant: Inscription | null, moi: Inscription, dbPath: string): string {
  // Personne d'inscrit, ou NOUS encore : une autre Reine est au milieu de sa
  // prise. Son nom n'est pas encore lisible, et on ne l'invente pas.
  if (tenant === null || tenant.jeton === moi.jeton) {
    return (
      '\n✘ Une autre Reine démarre en ce moment sur cette base :\n' +
      `     ${dbPath}\n\n${POURQUOI_UNE_SEULE}` +
      '  → Laissez-la finir de démarrer, ou donnez à celle-ci une autre base (HIVE_DB).\n'
    );
  }
  return (
    `\n✘ Une autre Reine tient déjà cette base (pid ${tenant.pid} sur « ${tenant.hote} », ` +
    `depuis ${tenant.depuis}) :\n     ${dbPath}\n\n${POURQUOI_UNE_SEULE}` +
    '  Ce verrou est tenu par le système pour un processus VIVANT : il tombe de\n' +
    '  lui-même dès que ce processus s’arrête, de quelque façon qu’il s’arrête.\n\n' +
    '  → Arrêtez l’autre Reine, ou donnez à celle-ci une autre base (HIVE_DB).\n'
  );
}

/** Le refus quand le fichier n'est pas un verrou de Reine. */
function direIllisible(dbPath: string, chemin: string): string {
  // Le chemin seul, sans commande : `rm` n'existe pas sous cmd.exe, et une
  // citation POSIX serait fausse sous PowerShell.
  return (
    `\n✘ Le verrou de Reine est illisible :\n     ${chemin}\n\n` +
    '  Ce n’est pas le petit fichier SQLite que la Reine y tient : elle ne peut\n' +
    '  ni y lire qui tient la base, ni la tenir.\n\n' +
    `  → Si aucune Reine ne tourne sur ${dbPath}, supprimez-le : il sera recréé.\n`
  );
}

/** La ligne de journal d'un démarrage qui suit un arrêt brutal. */
export function direArretBrutal(precedente: TenantVerrou): string {
  return (
    `[hive] la Reine précédente (pid ${precedente.pid} sur « ${precedente.hote} », ` +
    `depuis ${precedente.depuis}) s’est arrêtée sans rendre la base — tuée ou coupée net. ` +
    'Le système a rendu son verrou avec elle ; ses travaux en vol vont être requalifiés.'
  );
}
