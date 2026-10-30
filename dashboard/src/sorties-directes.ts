// La sortie en direct des agents, côté écran : un tampon circulaire par tâche.
//
// ─── POURQUOI UN TAMPON, ET POURQUOI BORNÉ ──────────────────────────────────
//
// Le hub relaie la sortie (stdout, stderr) de chaque agent (`task_output`) sans la
// journaliser : ce qui n'est pas gardé ICI est perdu pour cet écran. Mais un
// agent peut écrire quatre morceaux de 4 Kio par seconde pendant quinze
// minutes — 14 Mo par tâche, plusieurs tâches à la fois, dans un onglet ouvert
// toute la journée. Le tampon garde donc les `SORTIE_ECRAN_MAX_OCTETS`
// derniers octets par tâche et le DIT (`tronquee`) : une console dont le début
// a disparu sans prévenir laisserait croire que l'agent a commencé là.
//
// ─── CE QUI VIDE LE TAMPON ──────────────────────────────────────────────────
//
// La fin de vie de la tâche (terminée, échouée, annulée, requalifiée,
// relancée, refusée par son nœud) : la sortie d'une exécution finie n'est plus
// « en direct », et le log complet arrive avec le résultat. Et, à chaque instantané, toute tâche
// qui n'y est plus vivante : un écran déconnecté au moment de `task_done` n'a
// jamais reçu l'événement, et garderait sinon cette console pour toujours.
//
// Les transitions sont PURES : elles rendent `prev` lui-même quand rien ne
// change (même contrat que `differees.ts`).
//
// ─── POURQUOI UN MAGASIN, PAS UN ÉTAT D'`App` ───────────────────────────────
//
// Gardés dans l'état d'`App`, chaque morceau re-rendait TOUT le tableau de
// bord — quatre fois par seconde et par tâche en cours, tiroir ouvert ou non
// (dix tâches : quarante rendus de la racine par seconde). Seule la console de
// la tâche OUVERTE lit ces tampons : `creerMagasinSorties` les garde hors de
// React, et prévient les seuls abonnés de la tâche touchée
// (`useSyncExternalStore`, dans `ConsoleDirecte.tsx`).

import type { SegmentNiveau } from '../../src/shared/niveaux-sortie';
import type { Task } from '../../src/shared/types';

/** Ce que l'écran garde au plus de la sortie d'UNE tâche, en octets UTF-8. */
export const SORTIE_ECRAN_MAX_OCTETS = 256 * 1024;

// La liste des fins d'exécution vit dans `shared/bac-direct.ts` : la Reine y
// lit aussi quand oublier l'état en direct d'une tâche, et deux listes
// finiraient par diverger.
export { FINS_D_EXECUTION } from '../../src/shared/bac-direct';

export interface MorceauSortie {
  nodeId: string;
  texte: string;
  octets: number;
  /**
   * Le niveau de chaque ligne, tel que le nœud l'a lu (`shared/niveaux-sortie.ts`).
   * Absent : un nœud d'avant ce contrat, ou des niveaux qui ne tombaient pas
   * juste — la console dit alors « niveau inconnu ».
   */
  niveaux?: readonly SegmentNiveau[];
  /** Quand CET écran l'a reçu (`Date.now()`) : pas l'instant où l'agent l'a écrit. */
  recu: number;
}

export interface SortieTache {
  morceaux: readonly MorceauSortie[];
  octets: number;
  /** Des morceaux anciens ont été évincés pour tenir sous le plafond. */
  tronquee: boolean;
}

export type SortiesDirectes = Readonly<Record<string, SortieTache>>;

const encodeur = new TextEncoder();

/** Ajoute un morceau, puis évince les plus anciens jusqu'à tenir sous le plafond. */
export function ajouterSortie(
  prev: SortiesDirectes,
  taskId: string,
  nodeId: string,
  texte: string,
  niveaux?: readonly SegmentNiveau[],
  recu: number = Date.now(),
): SortiesDirectes {
  if (texte === '') return prev;
  const avant = prev[taskId] ?? { morceaux: [], octets: 0, tronquee: false };
  const morceau: MorceauSortie = {
    nodeId,
    texte,
    octets: encodeur.encode(texte).length,
    recu,
    ...(niveaux ? { niveaux } : {}),
  };
  const morceaux = [...avant.morceaux, morceau];
  let octets = avant.octets + morceaux[morceaux.length - 1]!.octets;
  let debut = 0;
  while (octets > SORTIE_ECRAN_MAX_OCTETS && debut < morceaux.length - 1) {
    octets -= morceaux[debut]!.octets;
    debut += 1;
  }
  return {
    ...prev,
    [taskId]: { morceaux: morceaux.slice(debut), octets, tronquee: avant.tronquee || debut > 0 },
  };
}

/** Oublie l'état en direct d'une tâche (fin d'exécution) : sortie, sous-agents. */
export function oublierTache<T>(
  prev: Readonly<Record<string, T>>,
  taskId: string,
): Readonly<Record<string, T>> {
  if (!(taskId in prev)) return prev;
  const suite = { ...prev };
  delete suite[taskId];
  return suite;
}

/**
 * Ne garde que les tâches encore VIVANTES dans l'instantané (assignées ou en
 * cours). L'instantané porte toutes les tâches vivantes, quel que soit leur âge
 * (`StateSnapshot.tasks`) : une tâche absente est donc finie depuis longtemps.
 */
export function garderVivantes<T>(
  prev: Readonly<Record<string, T>>,
  tasks: readonly Pick<Task, 'id' | 'status'>[],
): Readonly<Record<string, T>> {
  const vivantes = new Set(
    tasks.filter((t) => t.status === 'assigned' || t.status === 'running').map((t) => t.id),
  );
  const mortes = Object.keys(prev).filter((id) => !vivantes.has(id));
  if (mortes.length === 0) return prev;
  const suite = { ...prev };
  for (const id of mortes) delete suite[id];
  return suite;
}

/**
 * Les tampons de toutes les tâches, hors de l'état React. Chaque transition
 * passe par les fonctions pures ci-dessus ; un abonné n'est prévenu que si SA
 * tâche a changé — et `lire` rend alors une nouvelle référence, jamais sinon.
 */
export interface MagasinSorties {
  lire(taskId: string): SortieTache | undefined;
  abonner(taskId: string, prevenir: () => void): () => void;
  ajouter(taskId: string, nodeId: string, texte: string, niveaux?: readonly SegmentNiveau[]): void;
  oublier(taskId: string): void;
  garderVivantes(tasks: readonly Pick<Task, 'id' | 'status'>[]): void;
}

export function creerMagasinSorties(): MagasinSorties {
  let etat: SortiesDirectes = {};
  const abonnes = new Map<string, Set<() => void>>();
  const passer = (suite: SortiesDirectes): void => {
    if (suite === etat) return;
    const avant = etat;
    etat = suite;
    const touchees = new Set([...Object.keys(avant), ...Object.keys(suite)]);
    for (const id of touchees) {
      if (avant[id] === suite[id]) continue;
      for (const prevenir of abonnes.get(id) ?? []) prevenir();
    }
  };
  return {
    lire: (taskId) => etat[taskId],
    abonner(taskId, prevenir) {
      const ensemble = abonnes.get(taskId) ?? new Set();
      ensemble.add(prevenir);
      abonnes.set(taskId, ensemble);
      return () => {
        ensemble.delete(prevenir);
        if (ensemble.size === 0) abonnes.delete(taskId);
      };
    },
    ajouter: (taskId, nodeId, texte, niveaux) =>
      passer(ajouterSortie(etat, taskId, nodeId, texte, niveaux)),
    oublier: (taskId) => passer(oublierTache(etat, taskId)),
    garderVivantes: (tasks) => passer(garderVivantes(etat, tasks)),
  };
}
