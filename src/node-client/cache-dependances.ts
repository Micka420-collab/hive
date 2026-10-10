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
//      préparation. Jamais deux installations pour un arbre : le délai d'avant
//      suffit toujours.
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
// échéance — et s'installe, comme avant. La sonde du bac ne se paie qu'une
// fois par validation (`SondeDuBac`).
//
// ─── CE QUI RESTE, DIT ───────────────────────────────────────────────────────
//
//   · Au niveau `processus`, l'agent atteint le magasin comme le disque entier.
//     Sans bac, aucune validation ne tourne, donc aucune ne le lit ; mais un
//     magasin écrit sous ce niveau doit être effacé avant qu'un bac ne revienne
//     — c'est la rétention (G18 D), avec l'âge, le nombre et la taille totale,
//     et les restes (`.neuf-…`) d'un nœud tué en plein peuplement.
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

/** Le manifeste d'une entrée publiée, à côté de son `node_modules`. */
const MANIFESTE = 'manifeste.json';

/** Le magasin du nœud, tel que les validations le reçoivent. */
export interface MagasinDependances {
  /** `dossierDuMagasin(workRoot)`. */
  racine: string;
  /** Le projet de la tâche : chaque projet a son espace. */
  projet: string;
  /** Le réseau des validations — son niveau, et s'il est filtré. */
  reseau: string;
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
  /** Installées à la base pour cet arbre, et gardées. */
  | { genre: 'peuple' }
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
    await fsp.mkdir(neuf, { recursive: true });
    await copierArbre(produit, path.join(neuf, 'node_modules'), comptes, p.reste);
    const manifeste = {
      version: VERSION_MAGASIN,
      cle,
      ...comptes,
      peupleeLe: new Date().toISOString(),
    };
    await fsp.writeFile(path.join(neuf, MANIFESTE), `${JSON.stringify(manifeste)}\n`);
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
    const ici = path.join(path.resolve(p.magasin.racine), segmentSur(p.magasin.projet), cle);
    entree = ici;
    const refus = refusees.get(ici);
    if (refus !== undefined) return hors('refusee_plus_tot', refus);
    let manifeste = await lireManifeste(ici, cle);
    if (manifeste === 'absente') {
      // Un peuplement de cette entrée est en vol : ne pas l'attendre (voir l'en-tête).
      if (files.has(ici)) return hors('peuplement_en_cours');
      const peuplement = {
        ...p,
        dossier: p.peuplement,
        cible,
        plafonds: p.magasin.plafonds ?? PLAFONDS_ENTREE,
        reste,
      };
      const fait = await sousFile(ici, async () => {
        const deja = await lireManifeste(ici, cle);
        if (deja !== 'absente') return deja;
        // D'un autre format : écartée, jamais effacée en place.
        const ecartee = await ecarter(ici);
        if (ecartee) await effacerDossier(ecartee).catch(() => undefined);
        return peupler(peuplement, ici, cle);
      });
      if (typeof fait !== 'object' || !('genre' in fait)) {
        manifeste = fait;
      } else if (fait.genre === 'echec') {
        return { genre: 'echec', installation: fait.installation };
      } else if (fait.genre === 'pas_gardee') {
        retenirRefus(ici, fait.refus);
        const { raison, detail } = fait.refus;
        return { genre: 'installe', raison, ...(detail ? { detail } : {}) };
      } else {
        return { genre: 'peuple' };
      }
    }
    if (typeof manifeste !== 'object') return hors('copie', 'manifeste illisible');
    const attendu = manifeste;
    copie = true;
    await sous('copie', () => copierArbre(path.join(ici, 'node_modules'), cible, attendu, reste));
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
