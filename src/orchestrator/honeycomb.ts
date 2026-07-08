// Honeycomb Merge v0 (Palier 3) : analyse d'intégration des diffs de tâches.
//
// Au Palier 1, chaque tâche produit un diff sur sa branche `hive/<taskId>` (issue
// de la même base) et le diff remonte pour revue humaine — aucun merge auto.
// Honeycomb Merge prépare l'intégration : il analyse les diffs des tâches
// terminées pour (1) détecter les CONFLITS de merge au niveau des lignes (deux
// diffs qui modifient les mêmes lignes de base d'un même fichier), et (2)
// proposer un ORDRE de merge respectant les dépendances.
//
// 100 % hors-ligne et déterministe : on raisonne sur le texte des diffs unifiés,
// sans dépôt ni exécution. NB : le LANCEMENT réel des tests + le merge git effectif
// nécessitent le dépôt côté nœud → hors périmètre de ce v0 (interface posée, exécution différée).

import type { Task } from '../shared/types.js';

/** Plage de lignes de la base (fichier « ancien ») modifiée par un hunk. */
export interface Range {
  start: number;
  end: number;
}

/**
 * Analyse un diff unifié → pour chaque fichier, les plages de lignes de base
 * (côté « - ») que le diff modifie. Ces plages servent à détecter les conflits
 * entre deux diffs issus de la même base.
 */
export function parseDiff(diff: string): Map<string, Range[]> {
  const files = new Map<string, Range[]>();
  let current: string | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      // Chemin cible (nouveau) ; on retire le préfixe b/ et un éventuel horodatage.
      const raw = line.slice(4).split('\t')[0]?.trim() ?? '';
      const path = raw.replace(/^b\//, '');
      current = path === '/dev/null' || path === '' ? null : path;
      if (current && !files.has(current)) files.set(current, []);
      continue;
    }
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (m && current) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // count 0 = insertion pure à ce point → plage minimale [start, start].
      const end = count === 0 ? start : start + count - 1;
      files.get(current)?.push({ start, end });
    }
  }
  return files;
}

function overlap(a: Range, b: Range): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Fichiers où deux diffs (issus de la même base) modifient des lignes qui se chevauchent. */
export function conflictingFiles(diffA: string, diffB: string): string[] {
  const a = parseDiff(diffA);
  const b = parseDiff(diffB);
  const out: string[] = [];
  for (const [file, rangesA] of a) {
    const rangesB = b.get(file);
    if (!rangesB) continue; // même fichier requis
    if (rangesA.some((ra) => rangesB.some((rb) => overlap(ra, rb)))) out.push(file);
  }
  return out;
}

/** Ordre topologique (dépendances d'abord) des tâches fournies. */
function topoOrder(tasks: Task[]): string[] {
  const ids = new Set(tasks.map((t) => t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const result: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (ids.has(dep)) visit(dep);
    }
    result.push(id);
  };
  for (const t of tasks) visit(t.id);
  return result;
}

export interface MergeConflict {
  a: string;
  b: string;
  file: string;
}

export interface MergePlan {
  /** Nombre total de tâches du projet. */
  total: number;
  /** Tâches terminées (candidates au merge). */
  done: number;
  /** Ordre de merge proposé (topologique, dépendances d'abord). */
  order: string[];
  /** Conflits de merge détectés entre diffs (mêmes lignes d'un même fichier). */
  conflicts: MergeConflict[];
  /** Intégrable d'un coup : toutes les tâches terminées et aucun conflit. */
  mergeable: boolean;
  /**
   * Exécution réelle des tests + merge git : nécessite le dépôt côté nœud,
   * différée à une itération ultérieure. Toujours false en v0.
   */
  testsRun: false;
}

/**
 * Construit le plan de merge d'un projet à partir de ses tâches et des diffs des
 * tâches terminées (`diffs` : taskId → diff unifié). Les conflits sont détectés
 * entre TOUTES les paires de tâches terminées — même liées par une dépendance,
 * car chaque branche part de la même base et devra s'intégrer dessus.
 */
export function buildMergePlan(tasks: Task[], diffs: Map<string, string>): MergePlan {
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const order = topoOrder(doneTasks);
  const parsed = new Map(doneTasks.map((t) => [t.id, diffs.get(t.id) ?? '']));

  const conflicts: MergeConflict[] = [];
  for (let i = 0; i < doneTasks.length; i++) {
    for (let j = i + 1; j < doneTasks.length; j++) {
      const a = doneTasks[i] as Task;
      const b = doneTasks[j] as Task;
      for (const file of conflictingFiles(parsed.get(a.id) ?? '', parsed.get(b.id) ?? '')) {
        conflicts.push({ a: a.id, b: b.id, file });
      }
    }
  }

  const total = tasks.length;
  const done = doneTasks.length;
  const allDone = total > 0 && done === total;
  return {
    total,
    done,
    order,
    conflicts,
    mergeable: allDone && conflicts.length === 0,
    testsRun: false,
  };
}
