// La sortie en direct des agents, côté écran : un tampon circulaire par tâche.
//
// ─── POURQUOI UN TAMPON, ET POURQUOI BORNÉ ──────────────────────────────────
//
// Le hub relaie la sortie standard de chaque agent (`task_output`) sans la
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
// relancée) : la sortie d'une exécution finie n'est plus « en direct », et le
// log complet arrive avec le résultat. Et, à chaque instantané, toute tâche
// qui n'y est plus vivante : un écran déconnecté au moment de `task_done` n'a
// jamais reçu l'événement, et garderait sinon cette console pour toujours.
//
// Module PUR : la transition rend `prev` lui-même quand rien ne change, pour
// que React n'y voie pas de nouvel état (même contrat que `differees.ts`).

import type { Task } from '../../src/shared/types';

/** Ce que l'écran garde au plus de la sortie d'UNE tâche, en octets UTF-8. */
export const SORTIE_ECRAN_MAX_OCTETS = 256 * 1024;

/** Les événements qui clôturent une exécution — et donc sa sortie en direct. */
export const FINS_D_EXECUTION: readonly string[] = [
  'task_done',
  'task_failed',
  'task_cancelled',
  'task_requeued',
  'task_retry',
];

export interface MorceauSortie {
  nodeId: string;
  texte: string;
  octets: number;
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
): SortiesDirectes {
  if (texte === '') return prev;
  const avant = prev[taskId] ?? { morceaux: [], octets: 0, tronquee: false };
  const morceaux = [...avant.morceaux, { nodeId, texte, octets: encodeur.encode(texte).length }];
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
