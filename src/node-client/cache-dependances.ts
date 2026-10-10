// LE MAGASIN DE DÉPENDANCES DU NŒUD (G18) — le `node_modules` qu'un `npm ci`
// produit À LA BASE d'un projet, gardé une fois, restauré par COPIE dans chaque
// arbre qui en a besoin : la tâche validée, et les rejeux de sa base et de sa
// tête (G11b). Ce qui se décide sans disque — l'éligibilité, la clé — vit dans
// `shared/cache-dependances.ts`.
//
// ─── CE QUI LE REND SÛR, DANS CET ORDRE ──────────────────────────────────────
//
//   1. ÉLIGIBLE OU RIEN : l'installation ne lit que ce que la clé couvre — ni
//      script à la racine, ni script de dépendance : `npm ci` n'y fait que
//      télécharger, vérifier, extraire et lier des `.bin` —, et l'arbre porte
//      ces fichiers comme la base relue par la porte VÉRIFIÉE
//      (`base-verifiee.ts`). Sinon l'arbre s'installe, comme avant.
//   2. PEUPLÉ DEPUIS LA BASE, JAMAIS DEPUIS LA TÊTE : un dépôt neuf à côté de
//      la tâche (`<tâche>.deps`), extrait par `extraireBase` — un `fetch`, qui
//      renomme chaque objet d'après son contenu : rien de ce que l'agent a pu
//      forger n'y entre —, puis le même `npm ci`, dans le bac, avec le même
//      environnement et derrière le même réseau que la validation. Une entrée
//      peuplée depuis la tête aurait vu tourner du code de l'agent, puis ses
//      tests en écriture : elle empoisonnerait les tentatives suivantes — le
//      refus que `validations-bac.ts` avait déjà acté pour un `node_modules`
//      partagé.
//   3. CE `npm ci` EST L'INSTALLATION DE L'ARBRE : mêmes fichiers d'entrée,
//      aucun script — ce qu'il produit est ce que l'arbre aurait produit.
//      L'arbre le reçoit par renommage ; s'il échoue, c'est l'issue de la
//      préparation. Une seule installation par arbre, dans le délai d'avant —
//      sauf une installation qui écrit hors de `node_modules`, ce qu'aucun
//      `npm ci` sans script ne fait : l'arbre s'installe alors lui-même.
//   4. LE MAGASIN N'EN GARDE QU'UNE COPIE, VÉRIFIÉE : l'installation n'a rien
//      écrit hors de `node_modules` (`releverArbre`, avant et après — un lien
//      dur compris), ne porte que des dossiers et des fichiers sans setuid,
//      setgid ni écriture pour tous, et des liens DÉPLAÇABLES
//      (`lienDeplacable`) — ni FIFO, ni périphérique — et tient dans ses
//      plafonds ; sa copie, recomptée, est publiée par renommage atomique,
//      avec son manifeste, qui en compte chaque élément. Sinon, rien n'est
//      gardé.
//   5. JAMAIS MONTÉ, JAMAIS LIÉ — COPIÉ, côté hôte, avant que rien ne tourne
//      dans l'arbre : monter le magasin exposerait les autres projets, monter
//      l'entrée laisserait `node_modules` en lecture seule (un `.cache` en
//      EROFS change un verdict). Chaque fichier est copié
//      (`COPYFILE_FICLONE | COPYFILE_EXCL` : un clone de blocs là où le disque
//      le sait, jamais un écrasement), chaque dossier recréé à son mode, chaque
//      lien revérifié puis recréé à l'identique — puis la copie est recomptée
//      contre le manifeste. Pas `fs.cp` : sans `verbatimSymlinks`, il réécrit
//      un lien relatif en lien ABSOLU vers sa source — le magasin. Ce que les
//      tests écrivent dans leur copie ne touche pas l'entrée.
//   6. À LA MOINDRE ANOMALIE, L'INSTALLATION D'AVANT : une copie interrompue
//      ou incomplète est effacée APRÈS que ses gestes en vol ont fini, et
//      l'appelant installe l'arbre (`npm ci`) dans ce qui reste du délai. Une
//      entrée refusée l'est pour la vie du nœud (`refusees`) : elle ne se
//      repeuple pas à chaque arbre. Le verdict ne dépend jamais du magasin.
//
// ─── UNE ÉCHÉANCE, UNE FILE PAR ENTRÉE — SANS Y ATTENDRE ─────────────────────
//
// L'appelant donne UNE échéance, `DELAI_PREPARATION_MS` après son départ : la
// sonde, le peuplement, la copie et son repli y tiennent tous — aucun délai du
// hub ne bouge —, et l'annulation de la tâche les arrête. Un seul peuplement
// par entrée à la fois (sa FILE, même forme que `sousVerrouIndex`) ; un arbre
// qui en trouve un en cours ne l'attend pas — attendre lui coûterait son
// échéance — et s'installe, comme avant. Une restauration passe par la file
// le temps de PRENDRE l'entrée, rendue après sa copie (voir la rétention). La
// sonde du bac ne se paie qu'une fois par validation (`SondeDuBac`).
//
// ─── LA RÉTENTION (G18 D) ─────────────────────────────────────────────────────
//
// `ramasserMagasin`, au démarrage du nœud et après chaque publication, sous une
// seule file :
//
//   · le magasin ENTIER part quand le niveau d'isolement du nœud a changé
//     depuis son peuplement (`MARQUE_NIVEAU`, posée au premier peuplement) :
//     un magasin peuplé sous un niveau ne sert jamais sous un autre. Sans
//     bac, l'agent atteint le disque entier — magasin compris ;
//   · une entrée qui n'a servi aucune restauration depuis `INUTILISEE_MAX_MS`
//     part ; au-delà de `ENTREES_PAR_PROJET` dans un projet, puis de
//     `MAGASIN_OCTETS_MAX` en tout, les moins récemment servies partent
//     d'abord (le marqueur `USAGE`, touché à chaque restauration) ;
//   · une entrée EN USAGE — prise dans sa file, rendue après sa copie — ne
//     part jamais : l'éviction passe par la même file, et la saute ;
//   · rien ne s'efface en place : une entrée est d'abord ÉCARTÉE par
//     renommage (`.supprimee-…`), puis effacée (`effacerDossier`). Ce qu'un
//     nœud tué laisse — peuplement (`.neuf-…`) ou effacement interrompus —
//     ne porte jamais le nom d'une entrée, et le démarrage suivant le ramasse.
//
// ─── CE QUI RESTE, DIT ───────────────────────────────────────────────────────
//
//   · Au niveau `processus`, l'agent atteint le magasin comme le disque entier,
//     sa marque comprise : le vidage au changement de niveau ferme le cas
//     honnête, pas un agent qui forgerait magasin et marque avant le retour
//     d'un bac — ce niveau-là ne se présente pas comme une isolation.
//   · Ext4 et NTFS copient vraiment ; macOS clone fichier par fichier ; Windows
//     refuse souvent les liens (EPERM) : le repli prend le relais.

import { randomUUID } from 'node:crypto';
import { constants, promises as fsp } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';
import {
  FICHIERS_ENTREE,
  VERSION_MAGASIN,
  cleDuMagasin,
  direHorsMagasin,
  eligibilite,
  estNpmCi,
} from '../shared/cache-dependances.js';
import type {
  EmpreinteBac,
  EntreesNpm,
  FichierEntree,
  RaisonHorsMagasin,
} from '../shared/cache-dependances.js';
import { effacerDossier } from '../shared/effacement.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import { segmentSur } from '../shared/noms-windows.js';
import { lireFichierDeBaseVerifie } from './base-verifiee.js';
import { extraireBase } from './git-hote.js';
import { INSPECTION_MAX_MS, identifiantImage } from './isolement.js';
import type { BacExecution } from './isolement.js';
import { effacerRejeu } from './workspace.js';

/** Où vit le magasin d'un nœud : `<workRoot>/dependances/<projet>/<clé>`. */
export const dossierDuMagasin = (workRoot: string): string => path.resolve(workRoot, 'dependances');

/** Ce qu'UNE entrée peut porter : ses éléments (fichiers, dossiers, liens) et ses octets. */
export interface PlafondsEntree {
  elements: number;
  octets: number;
}

/**
 * Les plafonds d'une entrée : au-delà, elle n'est pas gardée. Proposés, à
 * faire valider par le propriétaire — comme ceux de la rétention (G18 D).
 */
export const PLAFONDS_ENTREE: PlafondsEntree = { elements: 250_000, octets: 2 * 1024 ** 3 };

/**
 * Au plus tant de gestes de fichier à la fois, à la vérification comme à la
 * copie : lancés tous d'un coup, 40 000 fichiers coûtaient au nœud 160 à
 * 190 Mio de plus — plus d'un Gio au plafond d'une entrée.
 */
const GESTES_EN_VOL = 32;

/** Combien d'entrées refusées le nœud retient (voir `refusees`). */
const REFUS_RETENUS_MAX = 256;

/**
 * La rétention (voir l'en-tête) — proposée, à faire valider par le
 * propriétaire : 7 jours sans servir, 3 entrées par projet, 4 Gio en tout.
 */
export const INUTILISEE_MAX_MS = 7 * 24 * 60 * 60_000;
export const ENTREES_PAR_PROJET = 3;
export const MAGASIN_OCTETS_MAX = 4 * 1024 ** 3;

/** Le manifeste d'une entrée publiée, à côté de son `node_modules`. */
const MANIFESTE = 'manifeste.json';
/** Le marqueur d'usage d'une entrée : son heure de modification dit sa dernière restauration. */
const USAGE = 'servie';
/** Le niveau d'isolement sous lequel le magasin a été peuplé, à sa racine. */
const MARQUE_NIVEAU = '.niveau-isolement';
/** Le nom d'une entrée : sa clé, rien d'autre — un reste n'en porte jamais un. */
const NOM_D_ENTREE = /^[0-9a-f]{32}$/;

/** Le magasin du nœud, tel que les validations le reçoivent. */
export interface MagasinDependances {
  /** `dossierDuMagasin(workRoot)`. */
  racine: string;
  /** Le projet de la tâche : chaque projet a son espace. */
  projet: string;
  /** Le réseau des validations — son niveau, et s'il est filtré. */
  reseau: string;
  /** Le niveau d'isolement du nœud, marqué au premier peuplement (voir la rétention). */
  niveau: string;
  /** `PLAFONDS_ENTREE` ; d'autres, dans les bancs seulement. */
  plafonds?: PlafondsEntree;
}

/**
 * Ce que le bac apporte à la clé, sondé UNE fois par validation : l'appelant
 * garde cet objet le temps d'une validation, et la tâche comme ses rejeux le
 * partagent (une sonde lance un bac).
 */
export interface SondeDuBac {
  empreinte?: Promise<EmpreinteBac>;
}

/** Ce que l'exécuteur des validations rend d'une commande. */
interface Execution {
  code: number | null;
  output: string;
  arret?: string;
}

/** Lance `argv` dans le bac, dans le répertoire `ou` — l'exécuteur des validations. */
type Lancer<E extends Execution> = (argv: string[], ou: string, delaiMs: number) => Promise<E>;

/** Ce que le magasin a fait pour un arbre. */
export type IssueMagasin<E extends Execution> =
  | { genre: 'restaure' }
  /** Installées à la base pour cet arbre, et gardées — la rétention a pu en évincer d'autres. */
  | { genre: 'peuple'; evincees: number }
  /** Installées à la base pour cet arbre, mais pas gardées — pourquoi. */
  | { genre: 'installe'; raison: RaisonHorsMagasin; detail?: string }
  /** L'installation à la base a échoué : c'est l'issue de la préparation de l'arbre. */
  | { genre: 'echec'; installation: E }
  /** Le magasin n'a pas servi : l'appelant installe l'arbre. */
  | { genre: 'hors_magasin'; raison: RaisonHorsMagasin; detail?: string };

/** Le magasin n'a pas servi, pour cette raison. */
class HorsMagasin extends Error {
  constructor(
    readonly raison: RaisonHorsMagasin,
    readonly detail?: string,
  ) {
    super(direHorsMagasin(raison, detail));
  }
}

/** Ce qu'une panne du disque ou de git dit d'elle-même, en court : son code d'abord. */
function enBref(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (typeof code === 'string') return code;
  const message = err instanceof Error ? err.message : String(err);
  return (message.split('\n')[0] ?? '').slice(0, 100);
}

/** `geste`, dont toute panne qui n'en dit pas plus devient `raison`. */
async function sous<T>(raison: RaisonHorsMagasin, geste: () => Promise<T>): Promise<T> {
  try {
    return await geste();
  } catch (err) {
    throw err instanceof HorsMagasin ? err : new HorsMagasin(raison, enBref(err));
  }
}

/**
 * Les entrées que ce nœud a vues refusées — une installation qui ne passe pas
 * la vérification ou qui écrit hors de `node_modules`, une copie qui échoue —
 * et pourquoi : aux arbres suivants, elles s'installent directement au lieu
 * de repeupler pour rien. Pour la vie du nœud, la plus ancienne oubliée
 * d'abord.
 */
const refusees = new Map<string, string>();

function retenirRefus(entree: string, refus: HorsMagasin): void {
  if (!['entree_refusee', 'ecrit_hors', 'copie'].includes(refus.raison)) return;
  refusees.delete(entree);
  refusees.set(entree, direHorsMagasin(refus.raison, refus.detail));
  for (const ancienne of refusees.keys()) {
    if (refusees.size <= REFUS_RETENUS_MAX) break;
    refusees.delete(ancienne);
  }
}

/**
 * Les fichiers d'entrée du commit de BASE, chacun par la porte vérifiée.
 * L'appelant la garde le temps d'une validation : les rejeux la relisent.
 */
export async function lireEntreesDeBase(depot: DepotEpingle, baseSha: string): Promise<EntreesNpm> {
  const lus = await Promise.all(
    FICHIERS_ENTREE.map((f) => lireFichierDeBaseVerifie(depot, baseSha, f)),
  );
  return Object.fromEntries(FICHIERS_ENTREE.map((f, i) => [f, lus[i] ?? null])) as EntreesNpm;
}

/**
 * Un texte aux fins de ligne CRLF ramenées à LF : sous Windows,
 * `core.autocrlf` extrait en CRLF ce que la base porte en LF, et npm lit les
 * deux pareil (JSON ; `ini`, qui découpe sur `/[\r\n]+/`). Un retour chariot
 * SEUL reste : il sépare deux réglages, et l'arbre qui en porte diffère.
 */
const sansCRLF = (texte: string): string => texte.replace(/\r\n/g, '\n');

/** Ces octets en texte, s'ils sont de l'UTF-8 — la base est relue ainsi ; sinon `null`. */
function enUtf8(octets: Buffer): string | null {
  const texte = octets.toString('utf8');
  return Buffer.from(texte, 'utf8').equals(octets) ? texte : null;
}

/**
 * Ce que l'arbre `ou` porte autrement que la base — un fichier d'entrée
 * changé, ajouté, retiré ou qui n'est pas un fichier — et s'il garde un
 * `node_modules`. Comparé tel que npm le lit : en UTF-8 (un fichier qui n'en
 * est pas ne correspond à rien : la base est relue en UTF-8), aux fins de
 * ligne près (`sansCRLF`).
 */
async function etatDeLArbre(
  ou: string,
  base: EntreesNpm,
): Promise<{ modifies: FichierEntree[]; nodeModules: boolean }> {
  const modifies: FichierEntree[] = [];
  for (const f of FICHIERS_ENTREE) {
    const st = await fsp.lstat(path.join(ou, f)).catch(() => null);
    const attendu = base[f];
    if (st === null) {
      if (attendu !== null) modifies.push(f);
      continue;
    }
    const lu = st.isFile() ? enUtf8(await fsp.readFile(path.join(ou, f))) : null;
    if (lu === null || attendu === null || sansCRLF(lu) !== sansCRLF(attendu)) modifies.push(f);
  }
  const nodeModules = (await fsp.lstat(path.join(ou, 'node_modules')).catch(() => null)) !== null;
  return { modifies, nodeModules };
}

/** La ligne que la sonde du bac écrit, et ce qu'elle lit (voir `sonderLeBac`). */
const MARQUE_EMPREINTE = 'HIVE-EMPREINTE ';
const SONDE_NODE = [
  "const p = require('node:path'), fs = require('node:fs'), c = require('node:crypto');",
  "const h = (t) => c.createHash('sha256').update(t).digest('hex');",
  "let g = ''; try { g = fs.readFileSync(p.join(p.dirname(p.dirname(process.execPath)), 'etc', 'npmrc'), 'utf8'); } catch {}",
  // La configuration EFFECTIVE de npm — intégrée, globale, de l'environnement
  // de l'image — sans ce qui ne dépend que du HOME.
  "let n = ''; try { const o = JSON.parse(require('node:child_process').execFileSync('npm', ['config', 'ls', '-l', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); for (const k of ['cache', 'init-module', 'init.module', 'userconfig']) delete o[k]; n = JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])); } catch {}",
  'const r = process.report && process.report.getReport ? process.report.getReport() : null;',
  `console.log(${JSON.stringify(MARQUE_EMPREINTE)} + JSON.stringify([process.version, process.versions.modules, process.versions.napi, process.platform, process.arch, (r && r.header && r.header.glibcVersionRuntime) || null, h(g), h(n)]));`,
].join('\n');

/**
 * L'empreinte du bac : ce que Node dit de lui DANS le bac — lancé dans un
 * dossier vide, pour que rien de l'arbre ne s'en mêle : version, ABI, N-API,
 * plateforme, architecture, glibc (absente sous musl), configuration globale
 * et effective de npm —, le moteur, npm, et ce que le moteur dit de l'image :
 * son identifiant, que chaque reconstruction change, là où son nom ne bouge
 * pas. Sans image (bubblewrap fait tourner le Node et le npm de l'hôte, que
 * la sonde lit), il est vide.
 */
async function sonderLeBac(
  p: { lancer: Lancer<Execution>; vide: string; bac: BacExecution; npm: string },
  reste: () => number,
): Promise<EmpreinteBac> {
  await sous('empreinte_bac', async () => {
    await effacerRejeu(p.vide);
    await fsp.mkdir(p.vide, { recursive: true });
  });
  const r = await p.lancer(['node', '-e', SONDE_NODE], p.vide, reste());
  const ligne =
    r.code === 0 && !r.arret
      ? r.output.split(/\r?\n/).find((l) => l.startsWith(MARQUE_EMPREINTE))
      : undefined;
  if (ligne === undefined) throw new HorsMagasin('empreinte_bac');
  const { fournisseur, image } = p.bac;
  const id =
    fournisseur.bin === 'bwrap'
      ? ''
      : await identifiantImage(fournisseur, image, Math.min(reste(), INSPECTION_MAX_MS));
  if (id === null) throw new HorsMagasin('empreinte_bac', 'image inspect');
  return {
    fournisseur: fournisseur.nom,
    image,
    identifiantImage: id,
    node: ligne.slice(MARQUE_EMPREINTE.length),
    npm: p.npm,
  };
}

/** La file de chaque entrée : le dernier geste en cours, que le suivant attend. */
const files = new Map<string, Promise<unknown>>();

/**
 * Les entrées qu'un arbre s'est mis à peupler — marquées dès sa décision,
 * avant même son tour dans la file : un second arbre qui les trouve absentes
 * ne fait pas la queue derrière (voir l'en-tête). Les autres gestes de la
 * file (une restauration qui prend l'entrée, une éviction) sont brefs.
 */
const enPeuplement = new Set<string>();

function sousFile<T>(entree: string, geste: () => Promise<T>): Promise<T> {
  const suite = (files.get(entree) ?? Promise.resolve()).then(geste, geste);
  const fin = suite.then(
    () => undefined,
    () => undefined,
  );
  files.set(entree, fin);
  void fin.then(() => {
    if (files.get(entree) === fin) files.delete(entree);
  });
  return suite;
}

/** Ce qu'une entrée publiée porte — son manifeste en compte chaque élément. */
interface Comptes {
  fichiers: number;
  dossiers: number;
  liens: number;
  octets: number;
}

/**
 * Le manifeste d'une entrée pour cette clé et ce format — ou `absente` (rien,
 * ou un autre format : à remplacer), ou `illisible` : une panne de lecture,
 * qui ne dit pas que l'entrée manque — elle n'est alors ni servie, ni
 * remplacée (une copie peut être en train de la lire).
 */
async function lireManifeste(
  entree: string,
  cle: string,
): Promise<Comptes | 'absente' | 'illisible'> {
  let texte: string;
  try {
    texte = await fsp.readFile(path.join(entree, MANIFESTE), 'utf8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absente' : 'illisible';
  }
  try {
    const m = JSON.parse(texte) as Partial<Comptes> & { version?: unknown; cle?: unknown };
    const comptes = [m.fichiers, m.dossiers, m.liens, m.octets];
    if (m.version !== VERSION_MAGASIN || m.cle !== cle) return 'absente';
    return comptes.every((n) => typeof n === 'number') ? (m as Comptes) : 'absente';
  } catch {
    return 'absente';
  }
}

/**
 * Une entrée publiée, vue par le ramassage — ce qu'elle pèse, et quand elle a
 * servi pour la dernière fois (`USAGE`, sinon sa publication) — ou `null` :
 * absente, illisible ou d'un autre format, elle ne sert plus.
 */
async function lireEntree(
  entree: string,
  cle: string,
): Promise<{ octets: number; servie: number } | null> {
  const manifeste = await lireManifeste(entree, cle);
  if (typeof manifeste !== 'object') return null;
  const usage =
    (await fsp.stat(path.join(entree, USAGE)).catch(() => null)) ??
    (await fsp.stat(path.join(entree, MANIFESTE)).catch(() => null));
  return usage ? { octets: manifeste.octets, servie: usage.mtimeMs } : null;
}

/**
 * Les entrées EN USAGE, et par combien de restaurations : prises dans la file
 * de l'entrée, rendues après la copie. Un ramassage, qui passe par la même
 * file, n'en écarte jamais une (voir l'en-tête).
 */
const enUsage = new Map<string, number>();
const prendre = (entree: string): void => {
  enUsage.set(entree, (enUsage.get(entree) ?? 0) + 1);
};
const rendre = (entree: string): void => {
  const reste = (enUsage.get(entree) ?? 1) - 1;
  if (reste > 0) enUsage.set(entree, reste);
  else enUsage.delete(entree);
};

/**
 * Écarte `dossier` par renommage — atomique : ce qui suit ne le prend plus
 * jamais pour une entrée, même si l'effacement s'interrompt — et rend son
 * nouveau nom, à effacer ; `null` s'il n'a pas pu l'être (absent, tenu).
 */
async function ecarter(dossier: string): Promise<string | null> {
  const ecarte = `${dossier}.supprimee-${randomUUID()}`;
  return fsp.rename(dossier, ecarte).then(
    () => ecarte,
    () => null,
  );
}

/** Le genre d'un élément que le magasin refuse, pour le dire. */
function genreDe(st: Stats | Dirent): string {
  if (st.isFIFO()) return 'FIFO';
  if (st.isSocket()) return 'socket';
  if (st.isBlockDevice() || st.isCharacterDevice()) return 'périphérique';
  return 'inconnu';
}

/**
 * Les droits qu'une entrée n'a pas : setuid ou setgid, écriture pour tous —
 * npm extrait en 644/755 (sous un umask 022), le reste partirait avec chaque
 * copie. Sous Windows, les modes ne disent pas cela : ils ne sont pas lus.
 */
function droitsRefuses(st: Stats): string | null {
  if (process.platform === 'win32') return null;
  if ((st.mode & 0o6000) !== 0) return 'setuid/setgid';
  if ((st.mode & 0o002) !== 0) return 'écriture pour tous';
  return null;
}

/** Au-delà, une chaîne de liens est une boucle (la borne du noyau Linux). */
const SAUTS_MAX = 40;

/**
 * La cible d'un lien de `racine`, s'il est DÉPLAÇABLE : résolu composant par
 * composant comme le noyau le ferait, mais sans jamais quitter `racine` — une
 * cible absolue, un `..` au-dessus de la racine, un lien pendant ou une boucle
 * le font refuser, et l'entrée avec lui. Un `realpath` ne suffit pas : un lien
 * qui sort puis revient par le nom de la racine (`../node_modules/x`) se
 * résout DEDANS là où il a été écrit, et AILLEURS une fois recopié. Résolu
 * ainsi, il ne dépend que de l'arbre : la copie le résout pareil, dans la tâche.
 *
 * Découpé comme le noyau découpe : sur `/` seul, hors Windows. Une barre
 * oblique inverse y est un caractère de nom — `a\b/../..` vise AU-DESSUS de
 * ce qu'un découpage sur les deux barres croyait voir. npm n'en écrit jamais :
 * une cible qui en porte est refusée.
 */
async function lienDeplacable(racine: string, lien: string): Promise<string> {
  const refus = (pourquoi: string): HorsMagasin =>
    new HorsMagasin('entree_refusee', `${path.relative(racine, lien)} : ${pourquoi}`);
  const windows = process.platform === 'win32';
  let sauts = 0;
  const resoudre = async (depuis: readonly string[], cible: string): Promise<string[]> => {
    sauts += 1;
    if (sauts > SAUTS_MAX) throw refus('boucle de liens');
    if (path.isAbsolute(cible) || path.win32.isAbsolute(cible)) throw refus('lien absolu');
    if (!windows && cible.includes('\\')) throw refus('lien à barre oblique inverse');
    let ici = [...depuis];
    for (const composant of cible.split(windows ? /[\\/]+/ : /\/+/)) {
      if (composant === '' || composant === '.') continue;
      if (composant === '..') {
        if (ici.length === 0) throw refus('lien hors de l’entrée');
        ici.pop();
        continue;
      }
      const suivant = [...ici, composant];
      const chemin = path.join(racine, ...suivant);
      const st = await fsp.lstat(chemin).catch(() => null);
      if (st === null) throw refus('lien pendant');
      ici = st.isSymbolicLink() ? await resoudre(ici, await fsp.readlink(chemin)) : suivant;
    }
    return ici;
  };
  const cible = await fsp.readlink(lien);
  const dossier = path.relative(racine, path.dirname(lien)).split(path.sep).filter(Boolean);
  await resoudre(dossier, cible);
  return cible;
}

/**
 * Parcourt l'arbre `racine` avec au plus `GESTES_EN_VOL` gestes à la fois :
 * `geste` pour chaque élément, un dossier AVANT que ses enfants ne soient
 * listés. Une panne arrête tout — les gestes en vol finissent, aucun autre ne
 * part —, puis remonte : l'appelant n'efface jamais sous une copie en vol.
 */
async function parcourir(
  racine: string,
  geste: (chemin: string, e: Dirent) => Promise<void>,
  reste: () => number,
): Promise<void> {
  const aFaire: { chemin: string; e: Dirent | null }[] = [{ chemin: racine, e: null }];
  const reveils: (() => void)[] = [];
  const pannes: unknown[] = [];
  let enVol = 0;
  const ouvrier = async (): Promise<void> => {
    while (pannes.length === 0) {
      const suivant = aFaire.pop();
      if (!suivant) {
        if (enVol === 0) return;
        await new Promise<void>((r) => reveils.push(r));
        continue;
      }
      enVol += 1;
      try {
        reste();
        if (suivant.e) await geste(suivant.chemin, suivant.e);
        if (!suivant.e || suivant.e.isDirectory()) {
          for (const e of await fsp.readdir(suivant.chemin, { withFileTypes: true })) {
            aFaire.push({ chemin: path.join(suivant.chemin, e.name), e });
          }
        }
      } catch (err) {
        pannes.push(err);
      } finally {
        enVol -= 1;
        for (const r of reveils.splice(0)) r();
      }
    }
  };
  await Promise.all(Array.from({ length: GESTES_EN_VOL }, ouvrier));
  if (pannes.length > 0) throw pannes[0];
}

/**
 * Copie l'arbre `source` vers `cible`, qui ne doit pas exister : dossiers
 * recréés à leur mode, fichiers copiés sans jamais écraser, liens revérifiés
 * (`lienDeplacable`) puis recréés à l'identique, rien d'autre (voir l'en-tête)
 * — puis RECOMPTÉE : une copie qui ne porte pas ce qu'`attendu` compte (un
 * manifeste, une vérification) est refusée, jamais rendue partielle en silence.
 */
async function copierArbre(
  source: string,
  cible: string,
  attendu: Comptes,
  reste: () => number,
): Promise<void> {
  const copie = { fichiers: 0, dossiers: 0, liens: 0 };
  await fsp.mkdir(cible);
  await parcourir(
    source,
    async (chemin, e) => {
      const d = path.join(cible, path.relative(source, chemin));
      if (e.isDirectory()) {
        const { mode } = await fsp.lstat(chemin);
        await fsp.mkdir(d);
        if (process.platform !== 'win32') await fsp.chmod(d, mode & 0o777);
        copie.dossiers += 1;
      } else if (e.isFile()) {
        await fsp.copyFile(chemin, d, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        copie.fichiers += 1;
      } else if (e.isSymbolicLink()) {
        const lien = await lienDeplacable(source, chemin);
        // Le genre ne compte que sous Windows, où un lien vers un dossier en diffère.
        const genre = (await fsp.stat(chemin)).isDirectory() ? 'dir' : 'file';
        await fsp.symlink(lien, d, genre);
        copie.liens += 1;
      } else {
        const nom = path.relative(source, chemin);
        throw new HorsMagasin('entree_refusee', `${nom} (${genreDe(e)})`);
      }
    },
    reste,
  );
  const ecart = (['fichiers', 'dossiers', 'liens'] as const).find((k) => copie[k] !== attendu[k]);
  if (ecart !== undefined) {
    throw new HorsMagasin('copie', `${copie[ecart]} ${ecart} copiés, ${attendu[ecart]} attendus`);
  }
}

/**
 * L'installation qu'une entrée gardera, vérifiée AVANT d'être copiée au
 * magasin : des dossiers et des fichiers aux droits ordinaires
 * (`droitsRefuses`), des liens déplaçables — rien d'autre —, dans les
 * plafonds. Rend ce que la copie doit porter : le manifeste de l'entrée.
 */
async function verifierEntree(
  racine: string,
  plafonds: PlafondsEntree,
  reste: () => number,
): Promise<Comptes> {
  const bilan: Comptes = { fichiers: 0, dossiers: 0, liens: 0, octets: 0 };
  await parcourir(
    racine,
    async (chemin) => {
      const st = await fsp.lstat(chemin);
      const nom = path.relative(racine, chemin);
      if (st.isSymbolicLink()) {
        await lienDeplacable(racine, chemin);
        bilan.liens += 1;
      } else if (st.isDirectory() || st.isFile()) {
        const droits = droitsRefuses(st);
        if (droits !== null) throw new HorsMagasin('entree_refusee', `${nom} (${droits})`);
        if (st.isFile()) {
          bilan.fichiers += 1;
          bilan.octets += st.size;
        } else {
          bilan.dossiers += 1;
        }
      } else {
        throw new HorsMagasin('entree_refusee', `${nom} (${genreDe(st)})`);
      }
      const elements = bilan.fichiers + bilan.dossiers + bilan.liens;
      if (elements > plafonds.elements || bilan.octets > plafonds.octets) {
        throw new HorsMagasin('entree_refusee', 'au-delà des plafonds d’une entrée');
      }
    },
    reste,
  );
  return bilan;
}

/**
 * Ce qu'est l'arbre de peuplement HORS de `node_modules` : chaque chemin, son
 * genre, sa taille, son mode, son inode, ses liens et l'heure de son dernier
 * changement (`ctime`, que seul le noyau pose). Comparé avant et après
 * l'installation, il dit si elle a écrit ailleurs — `.git` compris, un lien
 * dur vers un fichier de l'arbre aussi.
 */
async function releverArbre(racine: string): Promise<Map<string, string>> {
  const releve = new Map<string, string>();
  const visiter = async (dossier: string): Promise<void> => {
    for (const nom of await fsp.readdir(dossier)) {
      const chemin = path.join(dossier, nom);
      if (dossier === racine && nom === 'node_modules') continue;
      const st = await fsp.lstat(chemin, { bigint: true });
      const genre = st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : st.isFile() ? 'f' : 'x';
      releve.set(
        path.relative(racine, chemin),
        `${genre}:${st.size}:${st.mode}:${st.ino}:${st.nlink}:${st.ctimeNs}`,
      );
      if (genre === 'd') await visiter(chemin);
    }
  };
  await visiter(racine);
  return releve;
}

/** Le premier chemin qui diffère entre deux relevés, ou `null`. */
function premierEcart(avant: Map<string, string>, apres: Map<string, string>): string | null {
  for (const [chemin, signature] of apres) if (avant.get(chemin) !== signature) return chemin;
  for (const chemin of avant.keys()) if (!apres.has(chemin)) return chemin;
  return null;
}

/** Ce qu'un peuplement reçoit de l'appelant. */
interface Peuplement<E extends Execution> {
  depot: { depot: DepotEpingle; baseSha: string };
  /** Où la base s'extrait et s'installe (`dossierDePeuplement`). */
  dossier: string;
  /** Le `node_modules` de l'arbre à préparer : il reçoit l'installation. */
  cible: string;
  argv: readonly string[];
  lancer: Lancer<E>;
  plafonds: PlafondsEntree;
  reste: () => number;
  /** La racine du magasin, et le niveau d'isolement à y marquer. */
  racine: string;
  niveau: string;
}

/**
 * Marque le niveau d'isolement du magasin à son PREMIER peuplement — jamais
 * par-dessus une marque : celle-ci dit sous quel niveau ses entrées sont nées,
 * et le démarrage vide le magasin quand le nœud n'y tourne plus.
 */
async function marquerNiveau(racine: string, niveau: string): Promise<void> {
  await fsp.mkdir(racine, { recursive: true });
  await fsp.writeFile(path.join(racine, MARQUE_NIVEAU), niveau, { flag: 'wx' }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  });
}

/** Ce qu'un peuplement a fait. */
type Peuplee<E> =
  | { genre: 'publiee' }
  | { genre: 'echec'; installation: E }
  | { genre: 'pas_gardee'; refus: HorsMagasin };

/**
 * Peuple `entree` depuis la BASE (voir l'en-tête) : extraite à part,
 * installée dans le bac — l'installation de l'arbre, qui la reçoit —, copiée,
 * vérifiée et publiée par renommage. Une entrée publiée entre-temps par un
 * autre processus est gardée.
 */
async function peupler<E extends Execution>(
  p: Peuplement<E>,
  entree: string,
  cle: string,
): Promise<Peuplee<E>> {
  await sous('peuplement', () =>
    extraireBase(p.depot.depot, p.depot.baseSha, p.dossier, p.reste()),
  );
  const avant = await sous('peuplement', () => releverArbre(p.dossier));
  const installation = await p.lancer([...p.argv], p.dossier, p.reste());
  if (installation.code !== 0 || installation.arret) return { genre: 'echec', installation };
  const ecart = premierEcart(avant, await sous('peuplement', () => releverArbre(p.dossier)));
  // Ce que l'installation a écrit ailleurs, l'arbre ne le recevrait pas : il s'installe.
  if (ecart !== null) throw new HorsMagasin('ecrit_hors', ecart);
  const produit = path.join(p.dossier, 'node_modules');
  const st = await fsp.lstat(produit).catch(() => null);
  // Aucune dépendance à poser (des optionnelles écartées) : l'arbre n'a rien à recevoir.
  if (st === null) {
    return { genre: 'pas_gardee', refus: new HorsMagasin('entree_refusee', 'aucun node_modules') };
  }
  if (!st.isDirectory()) throw new HorsMagasin('entree_refusee', 'node_modules (pas un dossier)');
  const neuf = `${entree}.neuf-${randomUUID()}`;
  let refus: HorsMagasin | null = null;
  try {
    const comptes = await verifierEntree(produit, p.plafonds, p.reste);
    await marquerNiveau(p.racine, p.niveau);
    await fsp.mkdir(neuf, { recursive: true });
    await copierArbre(produit, path.join(neuf, 'node_modules'), comptes, p.reste);
    const manifeste = {
      version: VERSION_MAGASIN,
      cle,
      ...comptes,
      peupleeLe: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(neuf, MANIFESTE), `${JSON.stringify(manifeste)}\n`);
    await fsp.writeFile(path.join(neuf, USAGE), '');
    await fsp.rename(neuf, entree).catch(async (err: unknown) => {
      // Publiée entre-temps par un autre nœud du même atelier (des bancs).
      if (typeof (await lireManifeste(entree, cle)) !== 'object') throw err;
    });
  } catch (err) {
    refus = err instanceof HorsMagasin ? err : new HorsMagasin('entree_refusee', enBref(err));
    if (refus.raison === 'annule') throw refus;
  } finally {
    // Après les gestes en vol de la copie (`parcourir`) : rien n'y écrit plus.
    await effacerDossier(neuf).catch(() => undefined);
  }
  await sous('peuplement', () => fsp.rename(produit, p.cible));
  return refus ? { genre: 'pas_gardee', refus } : { genre: 'publiee' };
}

/**
 * Les dépendances de `ou` depuis le magasin du nœud : restaurées si l'entrée
 * existe, sinon installées à la base pour lui, et gardées. Ne lève jamais :
 * l'issue dit ce qui s'est passé — et, sans le magasin, pourquoi : l'appelant
 * installe alors, comme avant.
 */
export async function depuisLeMagasin<E extends Execution>(p: {
  magasin: MagasinDependances;
  /** L'arbre à préparer : la tâche, ou un rejeu à part. */
  ou: string;
  /** Le voisin de la tâche où l'entrée se peuple (`dossierDePeuplement`). */
  peuplement: string;
  depot: { depot: DepotEpingle; baseSha: string };
  /** Les fichiers d'entrée de la base (`lireEntreesDeBase`), gardés par l'appelant. */
  base: () => Promise<EntreesNpm>;
  /** L'installation déclarée (`preparationDepuisLockfile`). */
  argv: readonly string[];
  bac: BacExecution;
  /** Ce que `npm --version` a répondu dans le bac. */
  npm: string;
  /** La sonde du bac, gardée par l'appelant le temps d'une validation. */
  sonde: SondeDuBac;
  lancer: Lancer<E>;
  /** L'échéance de TOUTE la préparation, repli compris. */
  echeance: number;
  /** L'annulation de la tâche : tout s'arrête avec elle. */
  signal?: AbortSignal;
}): Promise<IssueMagasin<E>> {
  const hors = (raison: RaisonHorsMagasin, detail?: string): IssueMagasin<E> => ({
    genre: 'hors_magasin',
    raison,
    ...(detail ? { detail } : {}),
  });
  // Avant toute lecture de la base : une autre installation ne la paie pas.
  if (!estNpmCi(p.argv)) return hors('pas_npm_ci');
  const reste = (): number => {
    if (p.signal?.aborted) throw new HorsMagasin('annule');
    const ms = p.echeance - Date.now();
    if (ms <= 0) throw new HorsMagasin('delai');
    return ms;
  };
  const cible = path.join(p.ou, 'node_modules');
  let entree: string | null = null;
  let copie = false;
  try {
    const base = await sous('base_illisible', p.base);
    const arbre = await sous('base_illisible', () => etatDeLArbre(p.ou, base));
    const verdict = eligibilite({ argv: p.argv, base, ...arbre });
    if (!verdict.eligible) return hors(verdict.raison, verdict.detail);
    // Une sonde ratée n'est pas gardée : l'arbre suivant la retente.
    p.sonde.empreinte ??= sonderLeBac({ ...p, vide: p.peuplement }, reste).catch((err) => {
      p.sonde.empreinte = undefined;
      throw err;
    });
    const bac = await p.sonde.empreinte;
    const cle = cleDuMagasin({ ...p.magasin, argv: p.argv, bac, entrees: base });
    const racine = path.resolve(p.magasin.racine);
    const ici = path.join(racine, segmentSur(p.magasin.projet), cle);
    entree = ici;
    const refus = refusees.get(ici);
    if (refus !== undefined) return hors('refusee_plus_tot', refus);
    const lue = await lireManifeste(ici, cle);
    if (lue === 'illisible') return hors('copie', 'manifeste illisible');
    if (lue === 'absente') {
      // Un peuplement de cette entrée est en vol : ne pas l'attendre (voir l'en-tête).
      if (enPeuplement.has(ici)) return hors('peuplement_en_cours');
      enPeuplement.add(ici);
    }
    const peuplement = {
      ...p,
      dossier: p.peuplement,
      cible,
      plafonds: p.magasin.plafonds ?? PLAFONDS_ENTREE,
      reste,
      racine,
      niveau: p.magasin.niveau,
    };
    const fait = await sousFile(ici, async () => {
      const deja = await lireManifeste(ici, cle);
      if (typeof deja === 'object') {
        // À nous jusqu'à la fin de la copie : un ramassage passe par cette file.
        prendre(ici);
        return deja;
      }
      if (deja === 'illisible') return deja;
      // D'un autre format, ou évincée depuis : écartée, jamais effacée en place.
      const ecartee = await ecarter(ici);
      if (ecartee) await effacerDossier(ecartee).catch(() => undefined);
      return peupler(peuplement, ici, cle);
    }).finally(() => {
      if (lue === 'absente') enPeuplement.delete(ici);
    });
    if (typeof fait !== 'object') return hors('copie', 'manifeste illisible');
    if ('genre' in fait) {
      if (fait.genre === 'echec') return { genre: 'echec', installation: fait.installation };
      if (fait.genre === 'pas_gardee') {
        retenirRefus(ici, fait.refus);
        const { raison, detail } = fait.refus;
        return { genre: 'installe', raison, ...(detail ? { detail } : {}) };
      }
      // Après chaque publication, le magasin retrouve ses bornes.
      const bilan = await ramasserMagasin(racine).catch(() => null);
      return { genre: 'peuple', evincees: bilan?.evincees ?? 0 };
    }
    try {
      await fsp.writeFile(path.join(ici, USAGE), '').catch(() => undefined);
      copie = true;
      await sous('copie', () => copierArbre(path.join(ici, 'node_modules'), cible, fait, reste));
    } finally {
      rendre(ici);
    }
    return { genre: 'restaure' };
  } catch (err) {
    // Après les gestes en vol (`parcourir`) : rien ne copie plus quand on efface.
    if (copie) await effacerDossier(cible).catch(() => undefined);
    const refus = err instanceof HorsMagasin ? err : new HorsMagasin('copie', enBref(err));
    if (entree !== null) retenirRefus(entree, refus);
    return hors(refus.raison, refus.detail);
  } finally {
    await effacerRejeu(p.peuplement);
  }
}

/** Ce qu'un ramassage a fait du magasin. */
export interface BilanRamassage {
  /** Le magasin ENTIER écarté : il avait été peuplé sous un autre niveau d'isolement. */
  vide: boolean;
  /** Les entrées évincées — périmées, en trop dans leur projet, au-delà du total. */
  evincees: number;
  /** Ce qu'elles pesaient, selon leur manifeste. */
  octets: number;
  /** Ce qui n'était pas une entrée : peuplements ou effacements interrompus, entrées illisibles. */
  restes: number;
}

/** Une entrée vue par le ramassage. */
interface EntreeVue {
  chemin: string;
  projet: string;
  octets: number;
  servie: number;
}

/**
 * Écarte une entrée par SA file — rend son nouveau nom, ou `null` : en usage,
 * ou attendue dans sa file (une restauration qui la prend, un peuplement qui
 * la refait) ; le ramassage ne fait jamais la queue derrière eux.
 */
function evincerEntree(chemin: string): Promise<string | null> {
  if (files.has(chemin) || enUsage.has(chemin)) return Promise.resolve(null);
  return sousFile(chemin, async () => (enUsage.has(chemin) ? null : ecarter(chemin)));
}

/** Les noms d'un dossier, ou aucun : absent, il n'a rien à ramasser. */
const lister = (dossier: string): Promise<string[]> => fsp.readdir(dossier).catch(() => []);

/**
 * Les entrées à évincer, dans l'ordre des bornes (voir l'en-tête) : les
 * périmées, puis, des moins récemment servies aux plus récentes, celles qui
 * passent la borne de leur projet, puis celles qui passent le total. Une
 * entrée en usage ne part jamais, et compte quand même.
 */
function aEvincer(vues: readonly EntreeVue[], maintenant: number): EntreeVue[] {
  const gardees = [...vues].sort((a, b) => a.servie - b.servie);
  const evincees: EntreeVue[] = [];
  const evincer = (e: EntreeVue): void => {
    evincees.push(e);
    gardees.splice(gardees.indexOf(e), 1);
  };
  const libre = (e: EntreeVue): boolean => !enUsage.has(e.chemin);
  for (const e of gardees.filter((v) => maintenant - v.servie > INUTILISEE_MAX_MS && libre(v))) {
    evincer(e);
  }
  for (const projet of new Set(gardees.map((e) => e.projet))) {
    const du = gardees.filter((e) => e.projet === projet);
    let enTrop = du.length - ENTREES_PAR_PROJET;
    for (const e of du.filter(libre)) {
      if (enTrop <= 0) break;
      evincer(e);
      enTrop -= 1;
    }
  }
  let total = gardees.reduce((n, e) => n + e.octets, 0);
  for (const e of gardees.filter(libre)) {
    if (total <= MAGASIN_OCTETS_MAX) break;
    evincer(e);
    total -= e.octets;
  }
  return evincees;
}

/**
 * Ramène le magasin dans ses bornes (voir l'en-tête) — au démarrage du nœud
 * (`demarrage` : son niveau d'isolement), et après chaque publication. Un
 * seul ramassage à la fois ; chaque éviction passe par la file de l'entrée.
 *
 * Ce qui part est écarté avant d'être effacé. Au démarrage, l'effacement est
 * attendu ; après une publication, il se fait en arrière-plan : la validation
 * qui vient de publier n'attend pas le disque.
 */
export function ramasserMagasin(
  racineDuMagasin: string,
  demarrage?: { niveau: string },
  maintenant = Date.now(),
): Promise<BilanRamassage> {
  const racine = path.resolve(racineDuMagasin);
  return sousFile(`${racine}\0ramassage`, async () => {
    const bilan: BilanRamassage = { vide: false, evincees: 0, octets: 0, restes: 0 };
    const aEffacer: string[] = [];
    if (demarrage) {
      // Un magasin entier écarté par un démarrage précédent, que l'effacement n'a pas fini.
      const voisin = `${path.basename(racine)}.supprimee-`;
      for (const nom of await lister(path.dirname(racine))) {
        if (!nom.startsWith(voisin)) continue;
        aEffacer.push(path.join(path.dirname(racine), nom));
        bilan.restes += 1;
      }
      const present = (await fsp.lstat(racine).catch(() => null)) !== null;
      const marque = await fsp.readFile(path.join(racine, MARQUE_NIVEAU), 'utf8').catch(() => null);
      if (present && marque !== demarrage.niveau) {
        const ecarte = await ecarter(racine);
        if (ecarte) aEffacer.push(ecarte);
        bilan.vide = ecarte !== null;
      }
    }
    const vues: EntreeVue[] = [];
    for (const projet of bilan.vide ? [] : await lister(racine)) {
      if (projet.startsWith('.')) continue;
      for (const nom of await lister(path.join(racine, projet))) {
        const chemin = path.join(racine, projet, nom);
        if (!NOM_D_ENTREE.test(nom)) {
          // Un peuplement en vol en a un pendant qu'il tourne : au démarrage seulement.
          if (demarrage) {
            aEffacer.push(chemin);
            bilan.restes += 1;
          }
          continue;
        }
        const lue = await lireEntree(chemin, nom);
        if (lue) {
          vues.push({ chemin, projet, ...lue });
          continue;
        }
        const ecarte = await evincerEntree(chemin);
        if (ecarte) {
          aEffacer.push(ecarte);
          bilan.restes += 1;
        }
      }
    }
    for (const e of aEvincer(vues, maintenant)) {
      const ecarte = await evincerEntree(e.chemin);
      if (!ecarte) continue;
      aEffacer.push(ecarte);
      bilan.evincees += 1;
      bilan.octets += e.octets;
    }
    const effacements = Promise.all(aEffacer.map((d) => effacerDossier(d).catch(() => undefined)));
    if (demarrage) await effacements;
    return bilan;
  });
}

/** Ce qu'un ramassage a fait, en une ligne — `null` quand il n'a rien fait. */
export function direRamassage(b: BilanRamassage): string | null {
  const faits = [
    ...(b.vide ? ['vidé : le niveau d’isolement du nœud a changé depuis son peuplement'] : []),
    ...(b.evincees > 0
      ? [`${b.evincees} entrée(s) évincée(s) (${Math.ceil(b.octets / 1024 ** 2)} Mio)`]
      : []),
    ...(b.restes > 0 ? [`${b.restes} reste(s) ramassé(s)`] : []),
  ];
  return faits.length > 0 ? `magasin de dépendances : ${faits.join(' · ')}` : null;
}
