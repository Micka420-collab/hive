// Le rendez-vous des ponts de délégation d'un nœud — court, privé, et hors de
// sa racine de travail.
//
// ─── LA PANNE QUE CE MODULE FERME ────────────────────────────────────────────
//
// Le pont MCP de délégation (`src/adapters/delegation-bridge.ts`) écoutait sur
// un socket Unix posé DANS le dossier de la tâche : `<workRoot>/tasks/<id>-
// <nœud>/.hive/s`. Or un chemin de socket Unix est borné par `sun_path` — 108
// octets sous Linux, 104 sous macOS —, bien avant un chemin de fichier. Et la
// racine de travail par défaut est `./.hive-work/<nom>`, RELATIVE au dossier
// d'où l'on lance le nœud : depuis un projet un peu profond, ou sous le tmpdir
// de macOS (`/var/folders/…`), le chemin dépassait. CHAQUE tâche Claude Code ou
// Codex échouait alors avant de lancer le CLI, en « échec d'infrastructure »,
// réaffectée sous le motif « agent indisponible (auth/quota) » — une panne
// silencieuse sur le chemin par défaut. La CI l'a trouvée ; seul le banc avait
// été raccourci.
//
// ─── OÙ, ET POURQUOI LÀ ──────────────────────────────────────────────────────
//
// Sous `os.tmpdir()`, court par construction (`/tmp`, ou `/var/folders/xx/…/T`
// et ses 48 caractères sous macOS), dans UN dossier par nœud :
//
//     <tmpdir>/hive-pont-<pid>-XXXXXX/            ← le nœud (0700)
//                                    XXXXXX/      ← un pont, une tentative (0700)
//                                           s     ← son socket (0600)
//                                           mcp.json
//
// `mkdtemp` et pas un nom calculé : dans un dossier temporaire ouvert à tous
// les comptes, un nom prévisible peut être créé AVANT nous par un autre
// utilisateur local, qui posséderait alors le dossier où vit notre socket — et
// pourrait y substituer le sien, donc parler au CLI à la place du nœud.
// `mkdtemp` crée atomiquement, en 0700, sous un nom qu'on ne devine pas. Le pid
// y figure en clair : c'est ce qui permet au démarrage suivant de distinguer les
// restes d'un nœud MORT de ceux d'un nœud vivant.
//
// Un sous-dossier PAR PONT, parce que c'est lui seul que le bac à sable monte
// (en lecture seule, à `MONTAGE_PONT`) : une tâche ne voit jamais le socket
// d'une autre tâche du même nœud.
//
// Sous Windows, le pont écoute sur un pipe nommé — `\\.\pipe\<nœud>-<pont>` —,
// sans limite de chemin ; le sous-dossier ne porte que la configuration MCP.
//
// ─── CE QUI LE NETTOIE ───────────────────────────────────────────────────────
//
//   · la fermeture d'un pont efface son sous-dossier (delegation-bridge.ts) ;
//   · l'arrêt du nœud (`HiveNodeClient.stop`) efface le dossier entier — sur
//     SIGINT comme sur SIGTERM (`arreterSurSignaux`, client.ts) ;
//   · un `kill -9`, ou un SIGTERM sous Windows (un TerminateProcess, qu'aucun
//     gestionnaire n'intercepte), n'efface rien — le démarrage suivant d'un
//     nœud de ce compte balaie les dossiers dont le pid est mort.
//
// Ce balayage SUPPOSE un seul espace de pids pour tous les nœuds d'un compte
// qui partagent ce dossier temporaire : `kill(pid, 0)` ne voit que le sien. Deux
// nœuds du même compte dans deux espaces de pids distincts (conteneurs, bac)
// mais sur le MÊME `/tmp` monté se croiraient morts l'un l'autre, et le
// démarrage de l'un effacerait le rendez-vous de l'autre en pleine tâche.
// Configuration qu'aucun lanceur de Hive ne produit — le bac monte son propre
// `/tmp` — ; qui la monte donne à chaque nœud son propre TMPDIR.
//
// ─── LA LIMITE QUI RESTE, ET QU'ON DIT ───────────────────────────────────────
//
// Si le dossier temporaire LUI-MÊME est si profond que le socket dépasserait
// encore `sun_path`, aucun pont ne peut s'ouvrir sur ce poste. On le sait avant
// de rien créer, et on le dit en nommant la cause (TMPDIR) et le remède — une
// `CheminSocketTropLong`, que l'adaptateur rend comme un échec de la TÂCHE et
// jamais comme une panne d'agent à réaffecter.

import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PREFIXE_PONT } from '../shared/empreinte.js';

/** Le socket d'un pont, dans son dossier. Une lettre : sous `sun_path`, chaque octet compte. */
const NOM_SOCKET = 's';
/** Ce que `mkdtemp` ajoute au préfixe : six caractères `[A-Za-z0-9]`. */
const GABARIT_MKDTEMP = 'XXXXXX';

/**
 * Le dossier temporaire du système, TOUJOURS absolu. `os.tmpdir()` rend TMPDIR
 * tel quel : un `TMPDIR=tmp` relatif donnerait un socket relatif, que le
 * serveur MCP enfant — lancé par le CLI dans le dossier de la TÂCHE — résoudrait
 * ailleurs (ENOENT : Claude Code tournerait sans les outils de délégation, sans
 * rien dire), comme les sources des montages du bac ; et la mesure `sun_path`
 * porterait sur un chemin qui n'est pas celui qu'on ouvre.
 */
function dossierTemporaire(): string {
  return path.resolve(tmpdir());
}

/**
 * La longueur maximale, en OCTETS, d'un chemin de socket Unix qu'on ose ouvrir.
 * Au-delà, libuv refuse l'écoute (`listen EINVAL`) — et l'échec partirait en
 * panne générique au lieu du motif nommé. Linux : `sizeof(sun_path)` = 108,
 * MESURÉ sous Node 24 (108 octets passent, 109 échouent). macOS et les BSD :
 * `sun_path` fait 104 octets, NUL final compris selon le noyau — non mesuré ici,
 * donc 103, la borne qui tient dans les deux lectures.
 */
const LIMITE_SUN_PATH = process.platform === 'linux' ? 108 : 103;

/**
 * Le chemin d'un socket de pont ne tient pas dans `sun_path` : une cause
 * NOMMÉE, que l'adaptateur rend comme un échec de la tâche, pas d'infrastructure.
 */
export class CheminSocketTropLong extends Error {
  override readonly name = 'CheminSocketTropLong';
}

/** Où UN pont s'ouvre. */
export interface EmplacementPont {
  /** Son dossier privé (0700) : socket et configuration MCP. Seul monté dans le bac. */
  readonly dossier: string;
  /** Où il écoute : le socket Unix de `dossier`, ou un pipe nommé sous Windows. */
  readonly extremite: string;
}

/** Ce qu'un adaptateur reçoit du nœud : réserver un emplacement, rien de plus. */
export interface ReservationPont {
  reserver(): EmplacementPont;
}

/**
 * Le motif si un socket de pont ne tiendrait pas dans `sun_path` sous
 * `racine` (le dossier du nœud, ou son gabarit), sinon `null`. Ne crée rien.
 */
function motifTropLong(racine: string): string | null {
  if (process.platform === 'win32') return null;
  const socket = path.join(racine, GABARIT_MKDTEMP, NOM_SOCKET);
  const octets = Buffer.byteLength(socket, 'utf8');
  if (octets <= LIMITE_SUN_PATH) return null;
  return (
    `chemin du socket du pont de délégation trop long : ${octets} octets, au-delà des ` +
    `${LIMITE_SUN_PATH} qu'un socket Unix accepte sur ${process.platform} — le dossier temporaire du ` +
    `système (${dossierTemporaire()}) est trop profond. Raccourcissez TMPDIR (par exemple ` +
    'TMPDIR=/tmp) puis relancez le nœud : sans pont, aucune tâche Claude Code ni Codex ' +
    'ne peut démarrer ici.'
  );
}

/**
 * Le dossier est-il bien À NOUS, et privé ? Un dossier de `tmpdir` peut avoir
 * été effacé (nettoyage périodique de `/tmp`) puis recréé sous le même nom par
 * un autre compte : on ne s'y installe pas, et on ne l'efface pas. Sous
 * Windows, le dossier temporaire est déjà propre à l'utilisateur.
 */
function dossierPrive(chemin: string): boolean {
  try {
    const s = lstatSync(chemin);
    if (!s.isDirectory()) return false;
    if (typeof process.getuid !== 'function') return true;
    return s.uid === process.getuid() && (s.mode & 0o077) === 0;
  } catch {
    return false;
  }
}

/** Un pid qui répond au signal 0 vit — `EPERM` compris : il vit sous un autre compte. */
function processusVivant(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Les dossiers de pont qu'un nœud MORT de ce compte a laissés — `kill -9`,
 * TerminateProcess sous Windows — effacés. Rend ce qui a été effacé.
 *
 * Ne touche QUE ce qui porte exactement le nom que `RendezVousPont` crée, qui
 * appartient à ce compte, et dont le pid ne répond plus. Un pid réattribué à un
 * processus vivant garde son dossier : une fuite de quelques octets vaut mieux
 * qu'effacer le rendez-vous d'un nœud en plein travail.
 */
export function balayerPontsOrphelins(): string[] {
  const dossierTemp = dossierTemporaire();
  const nom = new RegExp(`^${PREFIXE_PONT}(\\d+)-[A-Za-z0-9]{${GABARIT_MKDTEMP.length}}$`);
  let entrees: string[];
  try {
    entrees = readdirSync(dossierTemp);
  } catch {
    return [];
  }
  const balayes: string[] = [];
  for (const entree of entrees) {
    const pid = Number(nom.exec(entree)?.[1] ?? 0);
    if (pid <= 0 || processusVivant(pid)) continue;
    const chemin = path.join(dossierTemp, entree);
    if (!dossierPrive(chemin)) continue;
    try {
      rmSync(chemin, { recursive: true, force: true });
      balayes.push(chemin);
    } catch {
      // Verrouillé (Windows) ou déjà parti : le prochain démarrage réessaiera.
    }
  }
  return balayes;
}

/**
 * Le rendez-vous d'UN nœud : son dossier privé sous `os.tmpdir()`, créé à la
 * première réservation (un nœud qui ne lance jamais de pont n'écrit rien), et
 * effacé à son arrêt.
 */
export class RendezVousPont implements ReservationPont {
  private racine: string | null = null;
  /**
   * Fermé par l'arrêt du nœud (`fermer`), rouvert par son démarrage
   * (`ouvrir`). Une tâche que l'arrêt a annulée peut encore passer ici en
   * finissant de se dérouler — une étape asynchrone de sa préparation, et elle
   * arrive au pont après coup : un dossier créé MAINTENANT ne serait effacé par
   * personne, et sous le TMPDIR du moment, qui n'est peut-être plus le même.
   */
  private ferme = false;

  /** Le démarrage du nœud : ses ponts peuvent de nouveau s'ouvrir. */
  ouvrir(): void {
    this.ferme = false;
  }

  /**
   * Le motif si AUCUN pont ne pourra s'ouvrir sur ce poste, sinon `null`. Ne
   * crée rien : le nœud le dit dès son démarrage, pas à la première tâche.
   */
  alerte(): string | null {
    return motifTropLong(this.racine ?? this.gabarit());
  }

  /**
   * Un emplacement neuf pour un pont — son dossier créé, 0700.
   * @throws CheminSocketTropLong avant toute création si le socket ne tiendrait pas.
   */
  reserver(): EmplacementPont {
    if (this.ferme) throw new Error('nœud arrêté : aucun pont de délégation ne s’ouvre plus');
    const motif = this.alerte();
    if (motif) throw new CheminSocketTropLong(motif);
    // Recréé s'il a disparu (nettoyage de `/tmp` sur un nœud resté inactif des
    // jours) ou s'il n'est plus le nôtre : jamais s'installer chez un autre.
    if (!this.racine || !existsSync(this.racine) || !dossierPrive(this.racine)) {
      this.racine = mkdtempSync(this.gabarit().slice(0, -GABARIT_MKDTEMP.length));
    }
    const dossier = mkdtempSync(this.racine + path.sep);
    const extremite =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\${path.basename(this.racine)}-${path.basename(dossier)}`
        : path.join(dossier, NOM_SOCKET);
    return { dossier, extremite };
  }

  /**
   * L'arrêt du nœud : le dossier entier, sockets et configurations compris.
   * Ne lève jamais — un arrêt qui échouerait sur un fichier verrouillé
   * (Windows) laisserait le nœud à moitié arrêté ; le balayage du démarrage
   * suivant reprendra ce qui reste.
   */
  fermer(): void {
    this.ferme = true;
    const racine = this.racine;
    this.racine = null;
    if (!racine || !dossierPrive(racine)) return;
    try {
      rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Voir ci-dessus : le balayage des orphelins s'en chargera.
    }
  }

  /** Le chemin qu'aurait le dossier du nœud, suffixe `mkdtemp` compris. */
  private gabarit(): string {
    return path.join(dossierTemporaire(), `${PREFIXE_PONT}${process.pid}-${GABARIT_MKDTEMP}`);
  }
}
