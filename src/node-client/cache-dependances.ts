// LE MAGASIN DE DÉPENDANCES DU NŒUD (G18) — le `node_modules` qu'un `npm ci`
// produit À LA BASE d'un projet, gardé une fois, restauré par COPIE dans chaque
// arbre qui en a besoin : la tâche validée, et les rejeux de sa base et de sa
// tête (G11b). Ce qui se décide sans disque — l'éligibilité, la clé — vit dans
// `shared/cache-dependances.ts`.
//
// ─── CE QUI LE REND SÛR, DANS CET ORDRE ──────────────────────────────────────
//
//   1. ÉLIGIBLE OU RIEN : l'installation ne lit que ce que la clé couvre, et
//      l'arbre porte ces fichiers à l'identique de la base relue par la porte
//      VÉRIFIÉE (`base-verifiee.ts`). Sinon l'arbre s'installe, comme avant.
//   2. PEUPLÉ DEPUIS LA BASE, JAMAIS DEPUIS LA TÊTE : un dépôt neuf à côté de
//      la tâche (`<tâche>.deps`), extrait par `extraireBase` — un `fetch`, qui
//      renomme chaque objet d'après son contenu : rien de ce que l'agent a pu
//      forger n'y entre —, puis le même `npm ci`, dans le bac, avec le même
//      environnement et derrière le même réseau que la validation. Le bac monte
//      toujours son arbre au même point (`MONTAGE`) : ce que l'installation y
//      écrit se relit pareil depuis la tâche. Une entrée peuplée depuis la tête
//      aurait vu tourner du code de l'agent, puis ses tests en écriture : elle
//      empoisonnerait les tentatives suivantes — le refus que
//      `validations-bac.ts` avait déjà acté pour un `node_modules` partagé.
//   3. VÉRIFIÉ AVANT D'ÊTRE PUBLIÉ : l'installation n'a rien écrit hors de
//      `node_modules` (`releverArbre`, avant et après) ; ce qu'elle a produit,
//      sorti du dossier par renommage, ne porte que des dossiers, des fichiers
//      sans setuid et des liens DÉPLAÇABLES — relatifs, et résolus sans jamais
//      quitter l'entrée (`lienDeplacable`) —, ni FIFO, ni périphérique, et tient
//      dans ses plafonds. Publié par renommage atomique, avec son manifeste.
//   4. JAMAIS MONTÉ, JAMAIS LIÉ — COPIÉ, côté hôte, avant que rien ne tourne
//      dans l'arbre : monter le magasin exposerait les autres projets, monter
//      l'entrée laisserait `node_modules` en lecture seule (un `.cache` en
//      EROFS change un verdict). Chaque fichier est copié
//      (`COPYFILE_FICLONE | COPYFILE_EXCL` : un clone de blocs là où le disque
//      le sait, jamais un écrasement), chaque lien revérifié puis recréé à
//      l'identique. Pas `fs.cp` : sans `verbatimSymlinks`, il réécrit un lien
//      relatif en lien ABSOLU vers sa source — le magasin. Ce que les tests
//      écrivent dans leur copie ne touche pas l'entrée.
//   5. À LA MOINDRE ANOMALIE, L'INSTALLATION D'AVANT : peuplement en échec,
//      entrée refusée, copie interrompue — la copie partielle est effacée, et
//      l'appelant installe l'arbre (`npm ci`) dans ce qui reste du délai. Le
//      verdict ne dépend jamais du magasin.
//
// ─── UNE ÉCHÉANCE, UNE FILE PAR ENTRÉE ───────────────────────────────────────
//
// L'appelant donne UNE échéance, `DELAI_PREPARATION_MS` après son départ : la
// sonde, l'attente, le peuplement, la copie et son repli y tiennent tous —
// aucun délai du hub ne bouge. Deux validations de la même entrée ne peuplent
// qu'une fois : la seconde attend la première dans la FILE de l'entrée (même
// forme que `sousVerrouIndex`), puis restaure. Chaque geste est borné par sa
// propre échéance, antérieure à celle de qui l'attend ; un geste dont
// l'échéance est passée quand vient son tour ne fait rien.
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
//   · Un script de dépendance non déterministe : l'entrée fige le résultat du
//     premier peuplement.
//   · Ext4 et NTFS copient vraiment ; macOS clone fichier par fichier ; Windows
//     refuse souvent les liens (EPERM) : le repli prend le relais.

import { randomUUID } from 'node:crypto';
import { constants, promises as fsp } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';
import {
  FICHIERS_ENTREE,
  VERSION_MAGASIN,
  cleDuMagasin,
  direHorsMagasin,
  eligibilite,
} from '../shared/cache-dependances.js';
import type { EntreesNpm, FichierEntree, RaisonHorsMagasin } from '../shared/cache-dependances.js';
import { effacerDossier } from '../shared/effacement.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import { segmentSur } from '../shared/noms-windows.js';
import { lireFichierDeBaseVerifie } from './base-verifiee.js';
import { extraireBase } from './git-hote.js';
import type { BacExecution } from './isolement.js';
import { effacerRejeu } from './workspace.js';

/** Où vit le magasin d'un nœud : `<workRoot>/dependances/<projet>/<clé>`. */
export const dossierDuMagasin = (workRoot: string): string => path.resolve(workRoot, 'dependances');

/**
 * Les plafonds d'UNE entrée : au-delà, elle n'est pas gardée et l'arbre
 * s'installe. Proposés, à faire valider par le propriétaire — comme ceux de
 * la rétention (G18 D : âge, nombre d'entrées par projet, taille totale).
 */
export const ENTREE_FICHIERS_MAX = 250_000;
export const ENTREE_OCTETS_MAX = 2 * 1024 ** 3;

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
}

/** Ce que le magasin a fait pour un arbre. */
export type IssueMagasin =
  | { genre: 'restaure' }
  | { genre: 'peuple'; evincees: number }
  | { genre: 'hors_magasin'; raison: RaisonHorsMagasin; detail?: string };

/** Lance `argv` dans le bac, dans le répertoire `ou` — l'exécuteur des validations. */
type Lancer = (
  argv: string[],
  ou: string,
  delaiMs: number,
) => Promise<{ code: number | null; output: string; arret?: string }>;

/** Le magasin n'a pas servi, pour cette raison : l'appelant installe. */
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
 * Ce que l'arbre `ou` porte autrement que la base — un fichier d'entrée
 * changé, ajouté, retiré ou qui n'est pas un fichier — et s'il garde un
 * `node_modules`. Octet pour octet : la base est relue en UTF-8 par la porte
 * vérifiée, et un fichier qui n'en serait pas (pas même à la base) ne
 * correspond à rien.
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
    const octets = st.isFile() ? await fsp.readFile(path.join(ou, f)) : null;
    if (octets === null || attendu === null || !octets.equals(Buffer.from(attendu, 'utf8'))) {
      modifies.push(f);
    }
  }
  const nodeModules = (await fsp.lstat(path.join(ou, 'node_modules')).catch(() => null)) !== null;
  return { modifies, nodeModules };
}

/** La ligne que la sonde du bac écrit, et ce qu'elle lit (voir `EmpreinteBac`). */
const MARQUE_EMPREINTE = 'HIVE-EMPREINTE ';
const SONDE_NODE = [
  "const p = require('node:path'), fs = require('node:fs'), c = require('node:crypto');",
  "let g = ''; try { g = fs.readFileSync(p.join(p.dirname(p.dirname(process.execPath)), 'etc', 'npmrc'), 'utf8'); } catch {}",
  'const r = process.report && process.report.getReport ? process.report.getReport() : null;',
  `console.log(${JSON.stringify(MARQUE_EMPREINTE)} + JSON.stringify([process.version, process.versions.modules, process.versions.napi, process.platform, process.arch, (r && r.header && r.header.glibcVersionRuntime) || null, c.createHash('sha256').update(g).digest('hex')]));`,
].join('\n');

/**
 * Ce que Node dit de lui DANS le bac — lancé dans un dossier vide, pour que
 * rien de l'arbre ne s'en mêle : version, ABI, N-API, plateforme,
 * architecture, glibc (absente sous musl), et l'empreinte de la configuration
 * globale de npm à côté de lui.
 */
async function empreinteDuBac(lancer: Lancer, vide: string, reste: () => number): Promise<string> {
  const r = await lancer(['node', '-e', SONDE_NODE], vide, reste());
  const ligne =
    r.code === 0 && !r.arret
      ? r.output.split(/\r?\n/).find((l) => l.startsWith(MARQUE_EMPREINTE))
      : undefined;
  if (ligne === undefined) throw new HorsMagasin('empreinte_bac');
  return ligne.slice(MARQUE_EMPREINTE.length);
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

/**
 * Une entrée PUBLIÉE pour cette clé et ce format — ce qu'elle pèse, et quand
 * elle a servi pour la dernière fois (`USAGE`, sinon sa publication) — ou
 * `null` : absente, illisible ou d'un autre format.
 */
async function lireEntree(
  entree: string,
  cle: string,
): Promise<{ octets: number; servie: number } | null> {
  try {
    const brut = JSON.parse(await fsp.readFile(path.join(entree, MANIFESTE), 'utf8')) as unknown;
    const m = brut as { version?: unknown; cle?: unknown; octets?: unknown };
    if (m.version !== VERSION_MAGASIN || m.cle !== cle || typeof m.octets !== 'number') return null;
    const usage =
      (await fsp.stat(path.join(entree, USAGE)).catch(() => null)) ??
      (await fsp.stat(path.join(entree, MANIFESTE)));
    return { octets: m.octets, servie: usage.mtimeMs };
  } catch {
    return null;
  }
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

/** Le genre d'une entrée que le magasin refuse, pour le dire. */
function genreDe(st: Stats): string {
  if (st.isFIFO()) return 'FIFO';
  if (st.isSocket()) return 'socket';
  if (st.isBlockDevice() || st.isCharacterDevice()) return 'périphérique';
  if (st.isFile()) return 'setuid/setgid';
  return 'inconnu';
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
 */
async function lienDeplacable(racine: string, lien: string): Promise<string> {
  const refus = (pourquoi: string): HorsMagasin =>
    new HorsMagasin('entree_refusee', `${path.relative(racine, lien)} : ${pourquoi}`);
  let sauts = 0;
  const resoudre = async (depuis: readonly string[], cible: string): Promise<string[]> => {
    sauts += 1;
    if (sauts > SAUTS_MAX) throw refus('boucle de liens');
    if (path.isAbsolute(cible) || path.win32.isAbsolute(cible)) throw refus('lien absolu');
    let ici = [...depuis];
    for (const composant of cible.split(/[\\/]+/)) {
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
 * L'arbre que l'installation a produit, vérifié AVANT d'être publié : des
 * dossiers, des fichiers sans setuid ni setgid, des liens déplaçables
 * (`lienDeplacable`) — rien d'autre —, dans les plafonds d'une entrée.
 */
async function verifierEntree(
  racine: string,
  reste: () => number,
): Promise<{ fichiers: number; octets: number; liens: number }> {
  const bilan = { fichiers: 0, octets: 0, liens: 0 };
  const visiter = async (dossier: string): Promise<void> => {
    reste();
    const entrees = await fsp.readdir(dossier);
    await Promise.all(
      entrees.map(async (nom) => {
        const chemin = path.join(dossier, nom);
        const st = await fsp.lstat(chemin);
        if (st.isDirectory()) return visiter(chemin);
        if (st.isSymbolicLink()) {
          await lienDeplacable(racine, chemin);
          bilan.liens += 1;
          return;
        }
        if (!st.isFile() || (st.mode & 0o6000) !== 0) {
          throw new HorsMagasin(
            'entree_refusee',
            `${path.relative(racine, chemin)} (${genreDe(st)})`,
          );
        }
        bilan.fichiers += 1;
        bilan.octets += st.size;
        if (bilan.fichiers > ENTREE_FICHIERS_MAX || bilan.octets > ENTREE_OCTETS_MAX) {
          throw new HorsMagasin('entree_refusee', 'au-delà des plafonds d’une entrée');
        }
      }),
    );
  };
  await visiter(racine);
  return bilan;
}

/**
 * Ce qu'est l'arbre de peuplement HORS de `node_modules` : chaque chemin, son
 * genre, sa taille, son mode, son inode et l'heure de son dernier changement
 * (`ctime`, que seul le noyau pose). Comparé avant et après l'installation, il
 * dit si elle a écrit ailleurs — `.git` compris.
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
        `${genre}:${st.size}:${st.mode}:${st.ino}:${st.ctimeNs}`,
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
interface Peuplement {
  depot: { depot: DepotEpingle; baseSha: string };
  dossier: string;
  argv: readonly string[];
  lancer: Lancer;
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

/**
 * Peuple `entree` depuis la BASE (voir l'en-tête) : extraite à part, installée
 * dans le bac, vérifiée, publiée par renommage. Une entrée publiée entre-temps
 * par un autre processus est gardée.
 */
async function peupler(p: Peuplement, entree: string, cle: string): Promise<void> {
  await sous('peuplement', () =>
    extraireBase(p.depot.depot, p.depot.baseSha, p.dossier, p.reste()),
  );
  const avant = await sous('peuplement', () => releverArbre(p.dossier));
  const r = await p.lancer([...p.argv], p.dossier, p.reste());
  if (r.code !== 0 || r.arret) {
    throw new HorsMagasin(
      'peuplement',
      `${p.argv.join(' ')} → ${r.arret ?? `code ${String(r.code)}`}`,
    );
  }
  const ecart = premierEcart(avant, await sous('peuplement', () => releverArbre(p.dossier)));
  if (ecart !== null) throw new HorsMagasin('peuplement', `écrit hors de node_modules : ${ecart}`);
  const neuf = `${entree}.neuf-${randomUUID()}`;
  try {
    await sous('peuplement', async () => {
      await marquerNiveau(p.racine, p.niveau);
      await fsp.mkdir(neuf, { recursive: true });
      // Hors du dossier où l'installation a tourné : rien n'y revient par lui.
      await fsp.rename(path.join(p.dossier, 'node_modules'), path.join(neuf, 'node_modules'));
    });
    const bilan = await sous('entree_refusee', () =>
      verifierEntree(path.join(neuf, 'node_modules'), p.reste),
    );
    await sous('peuplement', async () => {
      const manifeste = {
        version: VERSION_MAGASIN,
        cle,
        ...bilan,
        peupleeLe: new Date().toISOString(),
      };
      await fsp.writeFile(path.join(neuf, MANIFESTE), `${JSON.stringify(manifeste)}\n`);
      await fsp.writeFile(path.join(neuf, USAGE), '');
      try {
        await fsp.rename(neuf, entree);
      } catch (err) {
        // Publiée entre-temps par un autre nœud du même atelier (des bancs).
        if ((await lireEntree(entree, cle)) === null) throw err;
      }
    });
  } finally {
    await effacerDossier(neuf).catch(() => undefined);
  }
}

/**
 * Copie `source` (le `node_modules` d'une entrée) vers `cible`, qui ne doit
 * pas exister : dossiers recréés, fichiers copiés sans jamais écraser, liens
 * revérifiés puis recréés à l'identique (voir l'en-tête).
 */
async function restaurer(source: string, cible: string, reste: () => number): Promise<void> {
  const copier = async (de: string, vers: string): Promise<void> => {
    reste();
    await fsp.mkdir(vers);
    const entrees = await fsp.readdir(de, { withFileTypes: true });
    await Promise.all(
      entrees.map(async (e) => {
        const s = path.join(de, e.name);
        const d = path.join(vers, e.name);
        if (e.isDirectory()) return copier(s, d);
        if (e.isFile())
          return fsp.copyFile(s, d, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        if (e.isSymbolicLink()) {
          const lien = await lienDeplacable(source, s);
          // Le genre ne compte que sous Windows, où un lien vers un dossier en diffère.
          const genre = (await fsp.stat(s)).isDirectory() ? 'dir' : 'file';
          return fsp.symlink(lien, d, genre);
        }
        throw new HorsMagasin('entree_refusee', path.relative(source, s));
      }),
    );
  };
  await copier(source, cible);
}

/**
 * Les dépendances de `ou` depuis le magasin du nœud : restaurées si l'entrée
 * existe, sinon peuplées depuis la base puis restaurées. Ne lève jamais : sans
 * le magasin, l'issue dit pourquoi, et l'appelant installe — comme avant.
 */
export async function depuisLeMagasin(p: {
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
  lancer: Lancer;
  /** L'échéance de TOUTE la préparation, repli compris. */
  echeance: number;
}): Promise<IssueMagasin> {
  const reste = (): number => {
    const ms = p.echeance - Date.now();
    if (ms <= 0) throw new HorsMagasin('delai');
    return ms;
  };
  const cible = path.join(p.ou, 'node_modules');
  let copie = false;
  try {
    const base = await sous('base_illisible', p.base);
    const arbre = await sous('base_illisible', () => etatDeLArbre(p.ou, base));
    const verdict = eligibilite({ argv: p.argv, base, ...arbre });
    if (!verdict.eligible) {
      const { raison, detail } = verdict;
      return { genre: 'hors_magasin', raison, ...(detail ? { detail } : {}) };
    }
    await sous('empreinte_bac', async () => {
      await effacerRejeu(p.peuplement);
      await fsp.mkdir(p.peuplement, { recursive: true });
    });
    const node = await empreinteDuBac(p.lancer, p.peuplement, reste);
    const bac = { fournisseur: p.bac.fournisseur.nom, image: p.bac.image, node, npm: p.npm };
    const cle = cleDuMagasin({ ...p.magasin, argv: p.argv, bac, entrees: base });
    const racine = path.resolve(p.magasin.racine);
    const entree = path.join(racine, segmentSur(p.magasin.projet), cle);
    const peuplement: Peuplement = {
      ...p,
      dossier: p.peuplement,
      reste,
      racine,
      niveau: p.magasin.niveau,
    };
    const peuplee = await sousFile(entree, async () => {
      // Notre tour est venu après l'échéance : rien à faire, l'appelant installe.
      reste();
      const deja = (await lireEntree(entree, cle)) !== null;
      if (!deja) {
        // Illisible ou d'un autre format : écartée, jamais effacée en place.
        const ecartee = await ecarter(entree);
        if (ecartee) void effacerDossier(ecartee).catch(() => undefined);
        await peupler(peuplement, entree, cle);
      }
      // À nous jusqu'à la fin de la copie : un ramassage passe par cette file.
      prendre(entree);
      return !deja;
    });
    try {
      await fsp.writeFile(path.join(entree, USAGE), '').catch(() => undefined);
      copie = true;
      await sous('copie', () => restaurer(path.join(entree, 'node_modules'), cible, reste));
    } finally {
      rendre(entree);
    }
    if (!peuplee) return { genre: 'restaure' };
    // Après chaque publication, le magasin retrouve ses bornes.
    const bilan = await ramasserMagasin(racine).catch(() => null);
    return { genre: 'peuple', evincees: bilan?.evincees ?? 0 };
  } catch (err) {
    if (copie) await effacerDossier(cible).catch(() => undefined);
    const hors = err instanceof HorsMagasin ? err : new HorsMagasin('copie', enBref(err));
    return {
      genre: 'hors_magasin',
      raison: hors.raison,
      ...(hors.detail ? { detail: hors.detail } : {}),
    };
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
