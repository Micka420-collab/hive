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
// ─── CE QUI RESTE, DIT ───────────────────────────────────────────────────────
//
//   · Au niveau `processus`, l'agent atteint le magasin comme le disque entier.
//     Sans bac, aucune validation ne tourne, donc aucune ne le lit ; mais un
//     magasin écrit sous ce niveau doit être effacé avant qu'un bac ne revienne
//     — c'est la rétention (G18 D), avec l'âge, le nombre et la taille totale.
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
}

/** Ce que le magasin a fait pour un arbre. */
export type IssueMagasin =
  | { genre: 'restaure' }
  | { genre: 'peuple' }
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

/** L'entrée est-elle publiée, pour cette clé et ce format ? */
async function publiee(entree: string, cle: string): Promise<boolean> {
  try {
    const m = JSON.parse(await fsp.readFile(path.join(entree, MANIFESTE), 'utf8')) as unknown;
    const manifeste = m as { version?: unknown; cle?: unknown };
    return manifeste.version === VERSION_MAGASIN && manifeste.cle === cle;
  } catch {
    return false;
  }
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
      try {
        await fsp.rename(neuf, entree);
      } catch (err) {
        // Publiée entre-temps par un autre nœud du même atelier (des bancs).
        if (!(await publiee(entree, cle))) throw err;
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
    const entree = path.join(p.magasin.racine, segmentSur(p.magasin.projet), cle);
    const peuplement: Peuplement = { ...p, dossier: p.peuplement, reste };
    const peuplee = await sousFile(entree, async () => {
      // Notre tour est venu après l'échéance : rien à faire, l'appelant installe.
      reste();
      if (await publiee(entree, cle)) return false;
      await sous('peuplement', () => effacerDossier(entree));
      await peupler(peuplement, entree, cle);
      return true;
    });
    copie = true;
    await sous('copie', () => restaurer(path.join(entree, 'node_modules'), cible, reste));
    return { genre: peuplee ? 'peuple' : 'restaure' };
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
