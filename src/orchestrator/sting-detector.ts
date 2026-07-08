// Sting Detector v0 (Palier 2) : prévention de conflits entre tâches.
//
// Deux tâches qui pourraient s'exécuter EN MÊME TEMPS (aucun ordre de dépendance
// entre elles) et qui touchent la même surface risquent de se marcher dessus.
// On distingue deux niveaux :
//   - « high » : elles citent le même FICHIER → signal fort. L'ordonnanceur en
//     diffère une (sérialisation) pour éviter le conflit d'édition.
//   - « low » : fort recouvrement de vocabulaire → signal faible, purement
//     consultatif (exposé, jamais bloquant).
//
// 100 % hors-ligne et déterministe : aucune exécution d'agent nécessaire, on
// raisonne sur les titres/prompts.

import { tokenize } from './hive-mind.js';
import type { Task } from '../shared/types.js';

export type ConflictSeverity = 'high' | 'low';

export interface Conflict {
  a: string;
  b: string;
  severity: ConflictSeverity;
  sharedPaths: string[];
  sharedTerms: string[];
}

/** Seuils du signal faible (recouvrement lexical). */
const MIN_SHARED_TERMS = 3;
const MIN_JACCARD = 0.4;

// Chemin de fichier plausible : segments de répertoire optionnels, puis un nom
// de fichier (≥ 2 caractères) suivi d'une extension qui commence par une lettre.
// Écarte « e.g. », « 3.14 », « and/or »…
const PATH_RE = /(?:[\w-]+[/\\])*[\w-]{2,}\.[a-z][a-z0-9]{0,5}\b/gi;

// Technos fréquemment écrites « X.js/ts » qui ne sont PAS des fichiers : on les
// écarte pour éviter de sérialiser à tort deux tâches qui les mentionnent
// (heuristique, forcément incomplète). Un vrai chemin avec répertoire
// (src/node.ts) n'est jamais concerné : seul le nom nu correspond.
const NOT_FILES = new Set([
  'node.js',
  'react.js',
  'vue.js',
  'next.js',
  'nuxt.js',
  'express.js',
  'nest.js',
  'angular.js',
  'svelte.js',
  'ember.js',
  'backbone.js',
  'three.js',
  'd3.js',
  'chart.js',
  'socket.io',
]);

/** Extrait les chemins de fichiers cités dans un texte (minuscules, dédoublonnés). */
export function extractPaths(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[0].toLowerCase();
    if (!NOT_FILES.has(p)) out.add(p);
  }
  return out;
}

interface Surface {
  paths: Set<string>;
  terms: Set<string>;
}

function surfaceOf(task: { title: string; prompt: string }): Surface {
  const text = `${task.title} ${task.prompt}`;
  return { paths: extractPaths(text), terms: new Set(tokenize(text)) };
}

function intersect<T>(a: Set<T>, b: Set<T>): T[] {
  const out: T[] = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const inter = intersect(a, b).length;
  return inter / (a.size + b.size - inter);
}

export interface PairAnalysis {
  severity: ConflictSeverity | null;
  sharedPaths: string[];
  sharedTerms: string[];
}

/** Analyse le chevauchement de surface entre deux tâches (sans tenir compte de l'ordre). */
export function analyzePair(
  a: { title: string; prompt: string },
  b: { title: string; prompt: string },
): PairAnalysis {
  const sa = surfaceOf(a);
  const sb = surfaceOf(b);
  const sharedPaths = intersect(sa.paths, sb.paths);
  const sharedTerms = intersect(sa.terms, sb.terms);
  let severity: ConflictSeverity | null = null;
  if (sharedPaths.length > 0) {
    severity = 'high';
  } else if (sharedTerms.length >= MIN_SHARED_TERMS && jaccard(sa.terms, sb.terms) >= MIN_JACCARD) {
    severity = 'low';
  }
  return { severity, sharedPaths, sharedTerms };
}

/** Ensemble des tâches atteignables via dependsOn (transitivement) depuis `id`. */
function reachableDeps(id: string, byId: Map<string, Task>): Set<string> {
  const acc = new Set<string>();
  const stack = [...(byId.get(id)?.dependsOn ?? [])];
  while (stack.length) {
    const d = stack.pop() as string;
    if (!byId.has(d) || acc.has(d)) continue;
    acc.add(d);
    for (const x of byId.get(d)?.dependsOn ?? []) stack.push(x);
  }
  return acc;
}

/**
 * Détecte les paires de tâches en conflit potentiel au sein d'un projet : tâches
 * non terminées, du même projet, sans relation d'ordre (donc concurrençables),
 * dont les surfaces se chevauchent. Résultats triés (high d'abord).
 */
export function detectConflicts(tasks: Task[]): Conflict[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'failed');
  const reach = new Map(active.map((t) => [t.id, reachableDeps(t.id, byId)]));
  const conflicts: Conflict[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i] as Task;
      const b = active[j] as Task;
      if (a.projectId !== b.projectId) continue;
      // Un ordre de dépendance garantit qu'elles ne tournent jamais ensemble.
      if (reach.get(a.id)?.has(b.id) || reach.get(b.id)?.has(a.id)) continue;
      const { severity, sharedPaths, sharedTerms } = analyzePair(a, b);
      if (severity) conflicts.push({ a: a.id, b: b.id, severity, sharedPaths, sharedTerms });
    }
  }

  return conflicts.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'high' ? -1 : 1));
}
