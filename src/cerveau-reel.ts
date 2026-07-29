// La moitié qui touche le disque, en face de `src/shared/cerveau.ts`.
//
// Même partage que partout ailleurs dans ce dépôt : le module pur DIT quoi
// garder, quoi consolider et quoi élaguer ; celui-ci lit et écrit le dossier.
//
// ─── LE DOSSIER EST LA SOURCE DE VÉRITÉ ──────────────────────────────────────
//
// Pas de base, pas d'index, pas de cache : `readdirSync` puis `analyser`. Sur
// quelques centaines de notes c'est instantané, et ça achète trois choses
// qu'aucun index ne rend :
//
//   · le dossier s'ouvre dans Obsidian pendant que la ruche tourne ;
//   · `git diff` montre ce que la ruche a appris cette semaine ;
//   · rien à reconstruire, donc rien à désynchroniser.
//
// Le jour où le volume l'exigera, un index SQLite pourra s'ajouter — mais en
// CACHE RECONSTRUCTIBLE, comme `balance_ledger_cache`, jamais en source.
//
// ─── CE QUI N'EST PAS UNE NOTE EST IGNORÉ, PAS RÉPARÉ ────────────────────────
//
// Un dossier ouvert dans un éditeur finit par contenir des brouillons, un
// `README.md`, des `.obsidian/`. `analyser` rend `null` pour tout ce qui n'est
// pas une note, et on passe. Deviner l'intention d'un fichier mal formé, sur
// un dossier qui porte des règles de sûreté, serait la pire des options.

import { createHash } from 'node:crypto';
import {
  type Stats,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  type Bornes,
  BORNES,
  type Note,
  type Selection,
  aElaguer,
  analyser,
  contexte,
  nomFichier,
  rendre,
  selectionner,
} from './shared/cerveau.js';
import { champSurUneLigne } from './shared/donnees-non-fiables.js';

/** Où vit le cerveau. Doit correspondre à l'emplacement `cerveau` de `empreinte.ts`. */
export function dossierDe(dbPath: string): string {
  return path.join(path.dirname(path.resolve(dbPath)), 'cerveau');
}

/**
 * Le chemin d'une note, ou `null` si l'identifiant n'en mérite pas un.
 *
 * ─── DEUX GARDES, ET LA SECONDE N'EST PAS REDONDANTE ─────────────────────────
 *
 * `nomFichier` n'autorise que `[a-z0-9-]` : aucun `/`, aucun `..`. C'est la
 * garde qui compte, et elle suffit en théorie. On vérifie quand même que le
 * chemin résolu reste SOUS le dossier, parce que la première garde est une
 * expression régulière qu'un remaniement pressé pourrait élargir « juste pour
 * accepter les majuscules » — et parce que le coût est d'une comparaison.
 *
 * C'est la même position que `rayon.ts` : une liste blanche, puis un contrôle
 * de confinement. La défense en profondeur n'a d'intérêt que quand les deux
 * couches peuvent tomber séparément ; c'est le cas ici.
 */
export function estConfine(racine: string, cible: string): boolean {
  const r = path.resolve(racine);
  const c = path.resolve(cible);
  // Le séparateur est obligatoire : sans lui, `/data/cerveau-secret` passerait
  // pour un enfant de `/data/cerveau`. C'est le préfixe-piège classique.
  //
  // Et pas de `c === r` : la cible est toujours `<racine>/<id>.md`, jamais la
  // racine elle-même. La loupe a signalé cette égalité comme non défendue, et
  // elle avait raison — c'était une disjonction morte, copiée d'un idiome
  // générique. Une branche qu'aucune entrée n'atteint n'est pas une
  // précaution : c'est du code que personne ne peut vérifier.
  return c.startsWith(r + path.sep);
}

export function cheminDe(dossier: string, id: string): string | null {
  const nom = nomFichier(id);
  if (nom === null) return null;
  const racine = path.resolve(dossier);
  const cible = path.resolve(racine, nom);
  return estConfine(racine, cible) ? cible : null;
}

/**
 * `lstatSync`, et surtout PAS `statSync`.
 *
 * `statSync` SUIT les liens symboliques : un test qui demanderait ensuite
 * `isSymbolicLink()` obtiendrait toujours `false`, et la garde ne garderait
 * rien. Ce dépôt a déjà payé une fois pour cette confusion, dans le relevé de
 * `desinstallation.ts`. Le nom de cette fonction dit lequel des deux elle
 * appelle, pour que la prochaine relecture n'ait pas à aller voir.
 */
function lstatOuNull(c: string): Stats | null {
  try {
    return lstatSync(c);
  } catch {
    return null;
  }
}

/**
 * Toutes les notes du dossier.
 *
 * L'ordre est celui des identifiants, pas celui du système de fichiers :
 * `readdirSync` ne promet aucun ordre, et deux machines rendraient alors des
 * contextes différents pour la même tâche. Un savoir qui dépend de l'ordre de
 * lecture du disque n'est pas reproductible.
 */
export function lire(dossier: string): Note[] {
  let entrees: string[];
  try {
    entrees = readdirSync(dossier);
  } catch {
    return []; // Pas encore de cerveau : ce n'est pas une erreur, c'est le jour 1.
  }

  const notes: Note[] = [];
  for (const nom of entrees) {
    if (!nom.endsWith('.md')) continue;
    const id = nom.slice(0, -3);
    const c = cheminDe(dossier, id);
    if (c === null) continue;
    // Un lien symbolique posé dans ce dossier pointerait où il veut, et la
    // ruche lirait ce fichier-là. On n'accepte donc que des fichiers
    // ORDINAIRES. Le risque est modeste — `analyser` refuse tout ce qui n'est
    // pas une note — mais « modeste » n'est pas « nul », et la garde coûte un
    // appel.
    const st = lstatOuNull(c);
    if (st === null || !st.isFile()) continue;

    let texte: string;
    try {
      texte = readFileSync(c, 'utf8');
    } catch {
      continue;
    }
    const note = analyser(id, texte);
    if (note !== null) notes.push(note);
  }
  return notes.sort((a, b) => a.id.localeCompare(b.id));
}

/** Écrit une note. Rend le chemin écrit, ou `null` si l'identifiant est refusé. */
export function ecrire(dossier: string, note: Note): string | null {
  const c = cheminDe(dossier, note.id);
  if (c === null) return null;
  mkdirSync(dossier, { recursive: true });
  writeFileSync(c, rendre(note), 'utf8');
  return c;
}

/**
 * Ce que la ruche doit avoir en tête pour cette tâche.
 *
 * C'est LA fonction que le reste du dépôt appellera : elle lit, sélectionne
 * sous budget, et rend le bloc prêt à coller dans un prompt — plus la sélection
 * elle-même, pour que l'appelant puisse dire ce qui a été écarté.
 *
 * Le refus remonte tel quel. Un appelant qui l'ignore et colle une chaîne vide
 * enverra l'ouvrière travailler sans ses invariants ; c'est pour ça que
 * `Selection.refus` est rendu, et pas seulement journalisé ici.
 */
export function pourLaTache(
  dossier: string,
  tache: string,
  budget = 12_000,
): { readonly bloc: string; readonly selection: Selection } {
  const selection = selectionner(lire(dossier), tache, budget);
  return { bloc: contexte(selection, budget), selection };
}

/**
 * L'identifiant d'un épisode, dérivé de la signature de l'échec.
 *
 * ─── POURQUOI UN CONDENSAT, ET PAS LA SIGNATURE ELLE-MÊME ────────────────────
 *
 * `nomFichier` n'accepte que `[a-z0-9-]`. Une signature d'échec contient des
 * espaces, des deux-points, des chevrons — impossible d'en faire un nom de
 * fichier sans la mutiler, et deux signatures différentes mutilées peuvent
 * devenir identiques. Un condensat est stable, court, et déjà en `[0-9a-f]`.
 *
 * ─── ET SURTOUT : LA MÊME PANNE ÉCRIT LA MÊME NOTE ───────────────────────────
 *
 * C'est le cœur du regroupement. Une tâche qui échoue cinquante fois de la
 * même façon ne pose pas cinquante notes : elle en incrémente une. Le dossier
 * reste lisible par un humain — c'est toute la raison d'être du format — et le
 * compteur de récurrences devient directement le signal de consolidation.
 */
export function idEpisode(signatureEchec: string): string {
  const condensat = createHash('sha256').update(signatureEchec, 'utf8').digest('hex').slice(0, 16);
  return `ep-${condensat}`;
}

export interface EpisodeEnregistre {
  readonly id: string;
  readonly recurrences: number;
  /** Vrai la toute première fois que cette panne est vue. */
  readonly nouveau: boolean;
}

/**
 * Enregistre qu'une panne vient d'avoir lieu.
 *
 * Rend `null` si la signature est vide — un échec sans log exploitable ne dit
 * rien, et une note vide occuperait du budget de contexte pour raconter qu'il
 * ne s'est rien passé.
 *
 * ─── LA RUCHE ÉCRIT DES ÉPISODES, JAMAIS DES RÈGLES ──────────────────────────
 *
 * Le genre est `episode`, toujours, et il n'y a pas de `regle`. C'est délibéré
 * et ce n'est pas une limite technique : rédiger une règle demande de
 * comprendre POURQUOI, et une règle fausse coûte plus cher que pas de règle —
 * parce qu'elle est SUIVIE. La ruche accumule donc la matière et signale
 * quand elle est mûre ; l'écriture de la règle reste un geste délibéré.
 */
export function enregistrerEpisode(
  dossier: string,
  echec: { readonly signature: string; readonly titre: string; readonly detail: string },
  maintenant: string = new Date().toISOString(),
): EpisodeEnregistre | null {
  const sig = echec.signature.trim();
  if (sig === '') return null;

  const id = idEpisode(sig);
  const existante = lire(dossier).find((n) => n.id === id);
  const note: Note = {
    id,
    genre: 'episode',
    titre: champSurUneLigne(echec.titre, 200),
    corps: existante?.corps ?? echec.detail,
    etiquettes: [],
    // La date de PREMIÈRE observation est conservée : elle dit depuis combien
    // de temps le projet traîne cette panne, ce qu'une date de dernière vue
    // effacerait.
    creee: existante?.creee ?? maintenant,
    recurrences: (existante?.recurrences ?? 0) + 1,
    // Une panne qui revient AUJOURD'HUI est du savoir vivant : elle ne doit
    // pas être élaguée pour cause d'ancienneté.
    serviLe: maintenant,
  };
  return ecrire(dossier, note) === null
    ? null
    : { id, recurrences: note.recurrences, nouveau: existante === undefined };
}

export interface Elagage {
  readonly retires: readonly string[];
  readonly restants: number;
}

/**
 * Applique la borne d'élagage.
 *
 * L'instant est un PARAMÈTRE jusqu'ici — c'est ce qui rend la borne
 * vérifiable sans attendre trois mois. Il n'est lu de l'horloge qu'au bord,
 * c'est-à-dire ici.
 */
export function elaguer(
  dossier: string,
  maintenant: string = new Date().toISOString(),
  bornes: Bornes = BORNES,
): Elagage {
  const { retirer, garder } = aElaguer(lire(dossier), maintenant, bornes);
  const retires: string[] = [];
  for (const note of retirer) {
    const c = cheminDe(dossier, note.id);
    if (c === null) continue;
    if (lstatOuNull(c) === null) continue;
    rmSync(c, { force: true, maxRetries: 5, retryDelay: 100 });
    retires.push(note.id);
  }
  return { retires, restants: garder.length };
}
