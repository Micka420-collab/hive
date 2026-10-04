// L'économie DÉCLARÉE d'un Worker, d'un modèle ou de la ruche entière —
// tentative par tentative, relue dans le journal.
//
// Trois lectures la demandaient, chacune à son échelle : la carte d'un Worker
// (GET /api/workers), la même carte modèle par modèle, et la tuile « dépense »
// du cockpit. Trois replis écrits séparément auraient donné trois définitions
// de « ce qu'une tentative a coûté », et la somme des Workers aurait fini par
// ne plus faire le total de la ruche. Ce module en est la seule.
//
// ─── CE QU'EST UNE TENTATIVE RENDUE ──────────────────────────────────────────
//
// Une exécution d'agent sur un nœud NOMMÉ, qui a rendu une issue :
//
//   · `task_done`   — réussie ;
//   · `task_retry`  — le Worker a échoué, la tâche repart (HORS renvoi de
//                     l'Evaluator : `source: 'evaluator'` renvoie une
//                     production RÉUSSIE, sans nouvelle exécution) ;
//   · `task_failed` — le Worker a échoué sur son dernier essai ;
//   · `drone_failed` SANS motif — un drone a tourné et échoué pendant que la
//                     course continuait : il a coûté comme les autres.
//
// Ne sont PAS des tentatives, et c'est la règle du registre Genome : un refus
// (`task_rejected`) n'a rien lancé, un drone PERDU (`drone_failed` motivé) ou
// annulé n'a pas d'issue, et un `task_failed` sans nœud (« aucun agent qui
// fonctionne », dépendance échouée) n'est l'exécution de personne — le compter
// ferait baisser la couverture d'une déclaration que personne ne pouvait
// faire.
//
// ─── CE QUI N'EST JAMAIS INVENTÉ ─────────────────────────────────────────────
//
// Coût et temps modèle viennent de la déclaration du CLI de l'agent
// (`declaration-fournisseur.ts`), sommés avec leur couverture — « ≥ » dès
// qu'une tentative s'est tue, `inconnu` sans aucune. La durée Worker, elle, est
// MESURÉE par le nœud autour de l'agent : elle a sa propre couverture
// (tentatives mesurées), parce qu'un résultat perdu ne la rapporte pas. Aucune
// valeur n'est extrapolée à la tentative muette, et le coût n'est jamais tiré
// des jetons ni du temps.

import { declarationDe, sommeDeclaree } from './declaration-fournisseur.js';
import type { SommeDeclaree } from './declaration-fournisseur.js';
import type { HiveEvent } from './types.js';

/** Les types d'événements qui portent une issue d'exécution — et rien d'autre. */
export const TYPES_TENTATIVES = ['task_done', 'task_retry', 'task_failed', 'drone_failed'] as const;

export interface TentativeRendue {
  /** Id de l'événement d'issue : ordre total du journal. */
  id: number;
  ts: number;
  taskId: string;
  nodeId: string;
  reussie: boolean;
  /** Durée mesurée par le Worker autour de l'agent ; `null` si non rapportée. */
  dureeWorkerMs: number | null;
  /** Coût déclaré par le CLI (USD) ; `null` sinon. */
  coutUsd: number | null;
  /** Temps passé dans les appels au modèle, déclaré par le CLI ; `null` sinon. */
  dureeModeleMs: number | null;
}

/** Ce qu'une série de tentatives a coûté — des sommes avec leur couverture, jamais une note. */
export interface BilanEconomique {
  tentatives: number;
  reussies: number;
  /** Coût déclaré par le CLI (USD) — jamais estimé, ni du temps, ni des jetons. */
  coutFournisseur: SommeDeclaree | 'inconnu';
  /** Temps modèle déclaré par le CLI. */
  dureeModele: SommeDeclaree | 'inconnu';
  /** Temps mesuré par les Workers, sommé sur les tentatives qui le rapportent ; `null` sans aucune. */
  dureeWorker: { totalMs: number; mesurees: number } | null;
  /** Médiane des durées Worker des tentatives RÉUSSIES ; `null` sans réussite mesurée. */
  dureeMedianeMs: number | null;
}

const texte = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

const nombre = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** La tentative que porte un événement d'issue, ou `null` s'il n'en porte pas. */
export function tentativeRendue(e: HiveEvent): TentativeRendue | null {
  const p = e.payload;
  const taskId = texte(p.taskId);
  const nodeId = texte(p.nodeId);
  if (taskId === null || nodeId === null) return null;
  switch (e.type) {
    case 'task_done':
    case 'task_failed':
      break;
    case 'task_retry':
      if (p.source === 'evaluator') return null;
      break;
    case 'drone_failed':
      if (texte(p.reason) !== null) return null;
      break;
    default:
      return null;
  }
  const declaration = declarationDe(p);
  return {
    id: e.id,
    ts: e.ts,
    taskId,
    nodeId,
    reussie: e.type === 'task_done',
    dureeWorkerMs: nombre(p.durationMs),
    coutUsd: declaration.coutUsd,
    dureeModeleMs: declaration.dureeApiMs,
  };
}

/** Les tentatives rendues d'un journal, dans l'ordre du journal. */
export function tentativesDepuisEvenements(evenements: readonly HiveEvent[]): TentativeRendue[] {
  const tentatives: TentativeRendue[] = [];
  for (const e of [...evenements].sort((a, b) => a.id - b.id)) {
    const t = tentativeRendue(e);
    if (t) tentatives.push(t);
  }
  return tentatives;
}

/** Médiane entière (arrondie entre les deux du milieu) ; `null` sans valeur. */
export function mediane(valeurs: readonly number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 1
    ? triees[milieu]!
    : Math.round((triees[milieu - 1]! + triees[milieu]!) / 2);
}

export function bilanEconomique(tentatives: readonly TentativeRendue[]): BilanEconomique {
  const mesurees = tentatives.map((t) => t.dureeWorkerMs).filter((d): d is number => d !== null);
  return {
    tentatives: tentatives.length,
    reussies: tentatives.filter((t) => t.reussie).length,
    coutFournisseur: sommeDeclaree(tentatives.map((t) => t.coutUsd)),
    dureeModele: sommeDeclaree(tentatives.map((t) => t.dureeModeleMs)),
    dureeWorker:
      mesurees.length > 0
        ? { totalMs: mesurees.reduce((s, d) => s + d, 0), mesurees: mesurees.length }
        : null,
    dureeMedianeMs: mediane(
      tentatives.filter((t) => t.reussie && t.dureeWorkerMs !== null).map((t) => t.dureeWorkerMs!),
    ),
  };
}

/**
 * La fenêtre réellement lue d'un journal borné — la même lecture que le
 * registre Genome : `tronquee` dit que des faits plus anciens ONT PU manquer
 * (lecture arrivée à sa borne, ou journal déjà élagué), jamais qu'ils manquent.
 */
export interface FenetreLue {
  evenements: number;
  depuis: number | null;
  tronquee: boolean;
}

export function fenetreLue(
  evenements: readonly HiveEvent[],
  borne: number,
  journalElague: boolean,
): FenetreLue {
  return {
    evenements: evenements.length,
    depuis: evenements.reduce<number | null>(
      (min, e) => (min === null || e.ts < min ? e.ts : min),
      null,
    ),
    tronquee: journalElague || evenements.length >= borne,
  };
}
