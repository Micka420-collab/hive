import type { TaskStatus } from '../shared/types.js';

export type OrigineDelegation = 'hive' | 'native';

export interface NoeudDelegation {
  taskId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  depth: number;
  status: TaskStatus;
  origine: OrigineDelegation;
}

export interface LimitesDelegation {
  maxDepth: number;
  maxChildrenPerParent: number;
  maxDescendantsPerRoot: number;
  maxDurationMs: number;
  maxCostMicros: number;
  maxResourceUnits: number;
  maxTitleChars: number;
  maxPromptChars: number;
}

export const LIMITES_DELEGATION_DEFAUT: Readonly<LimitesDelegation> = Object.freeze({
  maxDepth: 3,
  maxChildrenPerParent: 4,
  maxDescendantsPerRoot: 16,
  maxDurationMs: 30 * 60_000,
  maxCostMicros: 5_000_000,
  maxResourceUnits: 4,
  maxTitleChars: 160,
  maxPromptChars: 16_000,
});

export interface DemandeDelegation {
  childTaskId: string;
  parentTaskId: string;
  title: string;
  prompt: string;
  durationMs: number;
  costMicros: number;
  resourceUnits: number;
  preferredAgent?: string;
  preferredModel?: string;
}

export interface PlanDelegation {
  childTaskId: string;
  parentTaskId: string;
  rootTaskId: string;
  depth: number;
  title: string;
  prompt: string;
  durationMs: number;
  costMicros: number;
  resourceUnits: number;
  /** Préférences seulement : l'Aiguillage conserve le dernier mot. */
  preferredAgent?: string;
  preferredModel?: string;
}

export type VerdictDelegation =
  | { ok: true; plan: PlanDelegation }
  | {
      ok: false;
      code:
        | 'parent_absent'
        | 'parent_termine'
        | 'task_id_duplique'
        | 'profondeur'
        | 'enfants'
        | 'descendants'
        | 'duree'
        | 'cout'
        | 'ressources'
        | 'titre'
        | 'prompt';
      motif: string;
    };

const entierBorne = (value: number, max: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= max;

/**
 * Politique pure de délégation Hive → Worker.
 *
 * Elle ne crée aucune tâche et ne choisit aucun modèle. Elle borne seulement
 * une demande avant que la Queen ne la persiste puis la confie à l'Aiguillage.
 */
export function jugerDelegation(
  demande: DemandeDelegation,
  graphe: readonly NoeudDelegation[],
  limites: Readonly<LimitesDelegation> = LIMITES_DELEGATION_DEFAUT,
): VerdictDelegation {
  const parent = graphe.find((n) => n.taskId === demande.parentTaskId);
  if (!parent) return { ok: false, code: 'parent_absent', motif: 'tâche parente introuvable' };
  if (parent.status === 'done' || parent.status === 'failed') {
    return { ok: false, code: 'parent_termine', motif: 'une tâche terminée ne délègue plus' };
  }
  if (graphe.some((n) => n.taskId === demande.childTaskId)) {
    return { ok: false, code: 'task_id_duplique', motif: 'identifiant enfant déjà utilisé' };
  }

  const depth = parent.depth + 1;
  if (depth > limites.maxDepth) {
    return { ok: false, code: 'profondeur', motif: 'profondeur maximale atteinte' };
  }
  const enfants = graphe.filter((n) => n.parentTaskId === parent.taskId && n.origine === 'hive');
  if (enfants.length >= limites.maxChildrenPerParent) {
    return { ok: false, code: 'enfants', motif: "quota d'enfants du parent atteint" };
  }
  const descendants = graphe.filter(
    (n) =>
      n.rootTaskId === parent.rootTaskId && n.taskId !== parent.rootTaskId && n.origine === 'hive',
  );
  if (descendants.length >= limites.maxDescendantsPerRoot) {
    return { ok: false, code: 'descendants', motif: 'quota total de descendants atteint' };
  }
  if (!entierBorne(demande.durationMs, limites.maxDurationMs)) {
    return { ok: false, code: 'duree', motif: 'budget temps invalide ou dépassé' };
  }
  if (!entierBorne(demande.costMicros, limites.maxCostMicros)) {
    return { ok: false, code: 'cout', motif: 'budget coût invalide ou dépassé' };
  }
  if (!entierBorne(demande.resourceUnits, limites.maxResourceUnits)) {
    return { ok: false, code: 'ressources', motif: 'budget ressources invalide ou dépassé' };
  }
  const title = demande.title.trim();
  if (title.length === 0 || title.length > limites.maxTitleChars) {
    return { ok: false, code: 'titre', motif: 'titre vide ou trop long' };
  }
  const prompt = demande.prompt.trim();
  if (prompt.length === 0 || prompt.length > limites.maxPromptChars) {
    return { ok: false, code: 'prompt', motif: 'mission vide ou trop longue' };
  }

  return {
    ok: true,
    plan: {
      childTaskId: demande.childTaskId,
      parentTaskId: parent.taskId,
      rootTaskId: parent.rootTaskId,
      depth,
      title,
      prompt,
      durationMs: demande.durationMs,
      costMicros: demande.costMicros,
      resourceUnits: demande.resourceUnits,
      ...(demande.preferredAgent ? { preferredAgent: demande.preferredAgent } : {}),
      ...(demande.preferredModel ? { preferredModel: demande.preferredModel } : {}),
    },
  };
}
