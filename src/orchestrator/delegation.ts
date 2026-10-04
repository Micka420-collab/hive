import type { DelegationBudget } from '../shared/protocol.js';
import type { TaskStatus } from '../shared/types.js';
import { LIMITES_DELEGATION_DEFAUT, type LimitesDelegation } from '../shared/limites-delegation.js';

export type OrigineDelegation = 'hive' | 'native';

export interface NoeudDelegation {
  taskId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  depth: number;
  status: TaskStatus;
  origine: OrigineDelegation;
  /**
   * Ce que cet enfant a RÉSERVÉ sur l'enveloppe de sa racine. Absent pour la
   * racine elle-même : elle ne réserve rien, l'enveloppe est la sienne.
   */
  budget?: DelegationBudget;
}

/**
 * La dépense DÉCLARÉE d'un arbre : le coût que les CLI des agents ont rapporté
 * pour chaque tentative terminée d'un descendant Hive de la racine.
 *
 * `micros` n'est qu'un PLANCHER dès que `sansCout > 0` : une tentative dont le
 * CLI n'a déclaré aucun coût — ou qui s'est interrompue sans rien rendre (nœud
 * perdu, annulation) — n'est pas une tentative gratuite. Elle n'entre pas dans
 * la somme — Hive n'estime rien —, mais elle est comptée à part pour que
 * chaque refus et chaque écran le disent.
 */
export interface DepenseDeclaree {
  /** Somme des coûts déclarés, en micro-USD. */
  micros: number;
  /** Tentatives TERMINÉES des descendants Hive de la racine : rendues ou interrompues. */
  tentatives: number;
  /** Parmi elles, celles dont aucun coût n'est connu (inconnu, jamais zéro). */
  sansCout: number;
}

/** Ce qu'un arbre qui n'a encore rendu aucune tentative a dépensé : rien, et c'est su. */
export const AUCUNE_DEPENSE: Readonly<DepenseDeclaree> = Object.freeze({
  micros: 0,
  tentatives: 0,
  sansCout: 0,
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
  /**
   * Préférences de la tâche parente : un DÉPARTAGE entre ex æquo, consigné
   * dans la raison du choix (`task_assigned`), jamais une exclusion levée —
   * l'Aiguillage, les écarts de reprise et la consigne de l'opérateur gardent
   * le dernier mot.
   */
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

/** Ce que les enfants Hive d'une racine ont déjà réservé sur son enveloppe. */
export function reserveRacine(
  graphe: readonly NoeudDelegation[],
  rootTaskId: string,
): DelegationBudget {
  const reserve: DelegationBudget = { durationMs: 0, costMicros: 0, resourceUnits: 0 };
  for (const n of graphe) {
    if (n.rootTaskId !== rootTaskId || n.taskId === rootTaskId || n.origine !== 'hive') continue;
    reserve.durationMs += n.budget?.durationMs ?? 0;
    reserve.costMicros += n.budget?.costMicros ?? 0;
    reserve.resourceUnits += n.budget?.resourceUnits ?? 0;
  }
  return reserve;
}

/**
 * La dépense déclarée d'un arbre a-t-elle atteint son budget coût ? Seul le
 * coût DÉCLARÉ tranche : une tentative au coût inconnu ne fait pas franchir le
 * plafond (Hive n'invente pas de montant), mais elle n'est jamais lue comme
 * gratuite — `direDepense` la nomme à côté.
 */
export function budgetCoutEpuise(
  depense: Readonly<DepenseDeclaree>,
  limites: Readonly<LimitesDelegation> = LIMITES_DELEGATION_DEFAUT,
): boolean {
  return depense.micros >= limites.maxCostMicros;
}

/** La dépense, dite telle qu'elle est connue : un plancher quand des coûts manquent. */
export function direDepense(depense: Readonly<DepenseDeclaree>): string {
  const base = `${depense.micros} µUSD déclarés sur ${depense.tentatives} tentative(s)`;
  return depense.sansCout > 0
    ? `${base}, dont ${depense.sansCout} au coût inconnu — non comptée(s), donc un plancher`
    : base;
}

/** Un budget demandé qui ne tient plus dans ce qui reste de l'enveloppe de la racine. */
function horsEnveloppe(
  nom: string,
  unite: string,
  demande: number,
  reserve: number,
  max: number,
): string {
  return (
    `budget ${nom} de la racine dépassé : ${reserve} ${unite} déjà réservés + ${demande} ` +
    `demandés > ${max} ${unite} cumulés par racine — il en reste ${Math.max(0, max - reserve)}`
  );
}

/**
 * Politique pure de délégation Hive → Worker.
 *
 * Elle ne crée aucune tâche et ne choisit aucun modèle. Elle borne seulement
 * une demande avant que la Queen ne la persiste puis la confie à l'Aiguillage.
 *
 * Chaque refus NOMME la borne franchie et ce qui reste : son motif part tel
 * quel au modèle qui a appelé l'outil (`delegation_rejected`). « Quota
 * atteint » sans le chiffre ne disait ni la limite ni quoi faire ensuite.
 *
 * Les trois budgets se jugent contre l'enveloppe de la RACINE (voir
 * `shared/limites-delegation.ts`) : la réservation demandée s'ajoute à celles
 * de tous les enfants Hive de l'arbre, terminés compris. Juger chaque enfant
 * seul laissait seize enfants réserver chacun la demi-heure et les cinq dollars
 * du plafond — seize fois l'enveloppe.
 */
export function jugerDelegation(
  demande: DemandeDelegation,
  graphe: readonly NoeudDelegation[],
  contexte: {
    limites?: Readonly<LimitesDelegation>;
    /** La dépense déclarée de l'arbre ; absente, aucune tentative n'a encore été rendue. */
    depense?: Readonly<DepenseDeclaree>;
  } = {},
): VerdictDelegation {
  const limites = contexte.limites ?? LIMITES_DELEGATION_DEFAUT;
  const depense = contexte.depense ?? AUCUNE_DEPENSE;
  const parent = graphe.find((n) => n.taskId === demande.parentTaskId);
  if (!parent) return { ok: false, code: 'parent_absent', motif: 'tâche parente introuvable' };
  if (parent.status === 'done' || parent.status === 'failed') {
    return { ok: false, code: 'parent_termine', motif: 'une tâche terminée ne délègue plus' };
  }
  if (graphe.some((n) => n.taskId === demande.childTaskId)) {
    return {
      ok: false,
      code: 'task_id_duplique',
      motif: 'identifiant enfant déjà utilisé dans ce graphe — choisis un autre childTaskId',
    };
  }

  const depth = parent.depth + 1;
  if (depth > limites.maxDepth) {
    return {
      ok: false,
      code: 'profondeur',
      motif:
        `profondeur maximale atteinte : l’enfant serait au niveau ${depth} sous la racine, ` +
        `la borne est ${limites.maxDepth} — fais ce travail toi-même`,
    };
  }
  const enfants = graphe.filter((n) => n.parentTaskId === parent.taskId && n.origine === 'hive');
  if (enfants.length >= limites.maxChildrenPerParent) {
    return {
      ok: false,
      code: 'enfants',
      motif:
        `quota d’enfants de ce parent atteint : ${enfants.length}/${limites.maxChildrenPerParent} ` +
        '(enfants terminés compris)',
    };
  }
  const descendants = graphe.filter(
    (n) =>
      n.rootTaskId === parent.rootTaskId && n.taskId !== parent.rootTaskId && n.origine === 'hive',
  );
  if (descendants.length >= limites.maxDescendantsPerRoot) {
    return {
      ok: false,
      code: 'descendants',
      motif:
        `quota de descendants de la racine atteint : ${descendants.length}/` +
        `${limites.maxDescendantsPerRoot} (toutes profondeurs, terminés compris)`,
    };
  }
  if (budgetCoutEpuise(depense, limites)) {
    return {
      ok: false,
      code: 'cout',
      motif:
        `budget coût de la racine épuisé : ${direDepense(depense)}, pour ${limites.maxCostMicros} ` +
        'µUSD — plus aucune délégation sous cette racine',
    };
  }
  const reserve = reserveRacine(graphe, parent.rootTaskId);
  const budgets = [
    [
      'duree',
      'temps',
      'ms',
      'durationMs',
      demande.durationMs,
      reserve.durationMs,
      limites.maxDurationMs,
    ],
    [
      'cout',
      'coût',
      'µUSD',
      'costMicros',
      demande.costMicros,
      reserve.costMicros,
      limites.maxCostMicros,
    ],
    [
      'ressources',
      'ressources',
      'unités',
      'resourceUnits',
      demande.resourceUnits,
      reserve.resourceUnits,
      limites.maxResourceUnits,
    ],
  ] as const;
  for (const [code, nom, unite, champ, demandee, reservee, max] of budgets) {
    if (!entierBorne(demandee, max)) {
      return {
        ok: false,
        code,
        motif: `${champ} invalide : entier de 0 à ${max} ${unite} attendu`,
      };
    }
    if (reservee + demandee > max) {
      return { ok: false, code, motif: horsEnveloppe(nom, unite, demandee, reservee, max) };
    }
  }
  const title = demande.title.trim();
  if (title.length === 0 || title.length > limites.maxTitleChars) {
    return {
      ok: false,
      code: 'titre',
      motif: `titre vide ou trop long (1 à ${limites.maxTitleChars} caractères)`,
    };
  }
  const prompt = demande.prompt.trim();
  if (prompt.length === 0 || prompt.length > limites.maxPromptChars) {
    return {
      ok: false,
      code: 'prompt',
      motif: `mission vide ou trop longue (1 à ${limites.maxPromptChars} caractères)`,
    };
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
 * d'atteindre l'un de ses ANCÊTRES — ou l'enveloppe coût de sa racine, que la
 * dépense déclarée de l'arbre vient d'atteindre (`root_cost_budget_exhausted` :
 * la clôture part alors de la racine, et n'épargne personne). Codes anglais
 * snake_case, comme tous les faits persistés du journal — le texte est
 * reconstruit à l'affichage.
 */
export type CauseAnnulationDelegation =
  'ancestor_done' | 'ancestor_failed' | 'ancestor_cancelled' | 'root_cost_budget_exhausted';

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

/**
 * Les places qu'un nœud OCCUPE vraiment POUR UNE TÂCHE DONNÉE : ses tâches
 * actives, moins celles qui attendent un enfant délégué encore en vol DANS LE
 * MÊME ARBRE que cette tâche (`attentesMemeArbre`, compté par le store :
 * `parentsEnAttenteSousRacine`). Pour toute autre tâche, la soustraction vaut
 * zéro : le nœud est plein de ce qu'il porte.
 *
 * ─── L'INTERBLOCAGE QUE CETTE SOUSTRACTION REND IMPOSSIBLE ───────────────────
 *
 * Un parent qui délègue reste `running` : il attend le résultat de son enfant.
 * Compté plein, il gardait sa place pendant toute l'attente — jusqu'à son
 * budget plus cinq minutes de grâce côté nœud. Sur une ouvrière à deux places,
 * la racine en prenait une, son enfant la seconde, et le petit-enfant ne
 * trouvait plus rien : l'arbre attendait sa propre expiration. Un parent qui
 * attend RELÂCHE donc sa place — le nœud applique la même règle à son guichet
 * (`HiveNodeClient.parentsEnAttente`), sinon il refuserait ce que la Reine lui
 * confie.
 *
 * ─── POURQUOI LA PLACE RELÂCHÉE NE SERT QU'À SON PROPRE ARBRE ───────────────
 *
 * Relâchée pour TOUT le monde, elle faisait de `maxConcurrency` un chiffre
 * sans effet : une autre racine prête prenait la place, déléguait à son tour,
 * relâchait, et la suivante entrait — six agents vivants sur une ouvrière à
 * une place, leurs enfants servis un par un pendant que le budget de chaque
 * parent s'écoulait. Réservée à l'arbre qui attend, elle suffit à le
 * débloquer (ses descendants passent), et le surplus d'un nœud reste borné
 * PAR ARBRE déjà présent sur lui : au plus `maxDescendantsPerRoot` parents en
 * attente pour chacune des racines qu'il a admises à place pleine.
 *
 * Un parent qui délègue puis continue de travailler est compté comme en
 * attente dès que son enfant vole — c'est le prix, assumé, d'une règle qui ne
 * peut pas s'interbloquer.
 */
export function slotsOccupes(noeud: { readonly running: number }, attentesMemeArbre = 0): number {
  return Math.max(0, noeud.running - attentesMemeArbre);
}
