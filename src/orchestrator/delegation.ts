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

/**
 * Pourquoi un descendant délégué est annulé : l'état terminal que vient
 * d'atteindre l'un de ses ANCÊTRES. Codes anglais snake_case, comme tous les
 * faits persistés du journal — le texte est reconstruit à l'affichage.
 */
export type CauseAnnulationDelegation = 'ancestor_done' | 'ancestor_failed' | 'ancestor_cancelled';

/**
 * Les descendants ORPHELINS de `taskId` — encore en vol, et dont plus personne
 * n'attend le résultat —, parents avant enfants.
 *
 * Un enfant délégué n'a qu'un destinataire : la tâche qui l'a demandé. Quand
 * elle devient terminale, plus personne n'attend son résultat — ni celui de
 * sa propre descendance. Le parcours traverse donc AUSSI les descendants déjà
 * terminés : un petit-enfant en vol sous un enfant fini reste orphelin, et
 * c'est lui que l'arrêt à la première génération oublierait.
 *
 * UNE EXCEPTION, SEULEMENT QUAND L'ANCÊTRE A ABOUTI (`ancestor_done`). Un
 * enfant qui a déjà LIVRÉ son résultat à son parent, puis que l'Evaluator a
 * rouvert après une contre-revue contestée, n'est plus le travail en attente
 * de ce parent : c'est la correction que la ruche a exigée de SA production.
 * L'annuler avec un ancêtre abouti effaçait la décision de l'Evaluator, et la
 * tentative suivante du parent — rouverte à son tour — rejouait l'identifiant
 * stable pour relire l'avis contesté au lieu d'attendre la correction. Le
 * scénario V2 Alpha l'a montré, au gré d'une course entre les deux.
 * `rouvertApresLivraison` désigne ces enfants : ni eux, ni la descendance qui
 * travaille pour eux ne sont touchés.
 *
 * Un ancêtre ÉCHOUÉ ou ANNULÉ, lui, ne sera jamais rouvert : l'Evaluator ne
 * rouvre qu'une tâche `done`. La correction n'aurait plus aucun destinataire —
 * l'épargner la laissait tourner, facturée, pour personne. Elle est donc
 * annulée comme le reste du sous-arbre.
 *
 * Seules les arêtes du graphe comptent : une tâche liée par `dependsOn` n'est
 * pas une descendante (la cascade des dépendances vit dans le scheduler), et
 * une tâche indépendante n'y figure jamais.
 */
export function descendantsEnVol(
  graphe: readonly NoeudDelegation[],
  taskId: string,
  cause: CauseAnnulationDelegation,
  rouvertApresLivraison: (taskId: string) => boolean,
): NoeudDelegation[] {
  const epargner = cause === 'ancestor_done' ? rouvertApresLivraison : () => false;
  // Les tâches dont les enfants n'ont plus de destinataire vivant.
  const sansDestinataire = new Set([taskId]);
  const orphelins: NoeudDelegation[] = [];
  // Tri stable par profondeur : un parent est toujours vu avant ses enfants,
  // donc un seul passage suffit (graphe borné par `maxDescendantsPerRoot`).
  for (const noeud of [...graphe].sort((a, b) => a.depth - b.depth)) {
    if (noeud.parentTaskId === null || !sansDestinataire.has(noeud.parentTaskId)) continue;
    const termine = noeud.status === 'done' || noeud.status === 'failed';
    if (!termine && epargner(noeud.taskId)) continue;
    sansDestinataire.add(noeud.taskId);
    if (!termine) orphelins.push(noeud);
  }
  return orphelins;
}

/**
 * Un ancêtre délégué de `taskId` a-t-il ÉCHOUÉ ? Une annulation est un
 * `failed` dans le store : les deux cas n'en font qu'un ici.
 *
 * C'est la seconde porte de l'invariant de `descendantsEnVol`. La clôture du
 * sous-arbre n'a lieu qu'une fois, à la transition terminale, et laisse un
 * descendant qui avait déjà livré. Le rouvrir ENSUITE — une contre-revue
 * contestée qui revient tard — le remettrait en vol, et à la facture, sous un
 * ancêtre qui ne lira jamais sa correction. La montée va jusqu'à la racine :
 * un parent direct abouti sous un grand-parent annulé n'a plus de lecteur non
 * plus. Un ancêtre ABOUTI ne compte pas : il peut encore être rouvert et
 * rejouer l'identifiant stable (voir l'exception de `descendantsEnVol`).
 */
export function ancetreEchoue(graphe: readonly NoeudDelegation[], taskId: string): boolean {
  const parTache = new Map(graphe.map((noeud) => [noeud.taskId, noeud]));
  // Borné par `maxDepth` : chaque pas remonte d'une génération vers la racine.
  for (let id = parTache.get(taskId)?.parentTaskId; id; id = parTache.get(id)?.parentTaskId) {
    if (parTache.get(id)?.status === 'failed') return true;
  }
  return false;
}
