// L'ARRÊT BUDGÉTAIRE (G09a) — un fait, un prédicat, une ligne pour le parent.
//
// Une tâche ARRÊTÉE PAR SON BUDGET : son agent s'est arrêté DANS SA BOUCLE sur
// le plafond de coût que la Reine avait passé à sa tentative (Claude Code :
// `error_max_budget_usd`), ou la Reine l'a close avant de la relancer parce
// que ses tentatives avaient déjà dépensé sa réservation. Ni un échec de
// l'agent, ni une panne : une borne tenue. La tâche finit `failed` sans
// reprise, et le FAIT le dit — `task_failed.arretBudgetaire`, et, quand c'est
// sa tentative qui s'est arrêtée, le résumé de la tâche (`TaskResultSummary`).
//
// UN prédicat pour tous les lecteurs (`arreteeParSonBudget`) : Genome, Thermo,
// Waggle, Ghost, Pulse, graphe d'expérience, chronologie, leçons de l'essaim,
// écrans. Chaque lecteur qui recopiait sa propre lecture du champ en laissait
// un autre compter l'arrêt comme un échec.

/**
 * Les arrêts budgétaires connus : le COÛT seul. Hive ne passe aucun plafond de
 * tours (`--max-turns`) : un `error_max_turns` reste un échec ordinaire, que la
 * Reine ne croirait de toute façon pas — elle ne croit que ce qu'elle a borné.
 */
export const ARRETS_BUDGETAIRES = ['cout'] as const;
export type ArretBudgetaire = (typeof ARRETS_BUDGETAIRES)[number];

/** La VALEUR est-elle un arrêt connu ? Le protocole la valide au fil. */
export function estArretBudgetaire(v: unknown): v is ArretBudgetaire {
  return (ARRETS_BUDGETAIRES as readonly unknown[]).includes(v);
}

/**
 * Ce FAIT — un `task_failed`, le résumé d'une tâche — dit-il un arrêt
 * budgétaire ? Le prédicat de tous les lecteurs : la tâche s'est arrêtée sur
 * sa borne, rien ne l'impute au modèle ni au nœud.
 */
export function arreteeParSonBudget(
  fait: { readonly arretBudgetaire?: unknown } | null | undefined,
): boolean {
  return estArretBudgetaire(fait?.arretBudgetaire);
}

/**
 * Des micro-USD en dollars, pour `--max-budget-usd` et les lignes qui le
 * disent : un entier divisé par 10⁶ s'écrit exactement (« 0.05 »).
 */
export function usdDeMicros(micros: number): string {
  return String(micros / 1_000_000);
}

/**
 * La ligne qui OUVRE les logs d'une tentative arrêtée sur son plafond : le
 * nœud, le hub et le pont MCP n'en gardent que la tête, et c'est là que le
 * parent qui attend cet enfant la lit. Elle dit la borne, la dépense déclarée,
 * ce qui est joint, et quoi faire : le MÊME `childTaskId` ne fait que rejouer
 * l'issue rangée de l'enfant arrêté (`delegate_task`, server.ts) ; seul un
 * nouveau relance le travail, sur une réservation neuve.
 */
export function ligneArretBudgetaire(arret: {
  plafondMicros: number;
  /** Le coût déclaré par le CLI ; absent : non déclaré, jamais zéro. */
  coutUsd: number | undefined;
  diffJoint: boolean;
}): string {
  const depense =
    arret.coutUsd === undefined
      ? 'dépense non déclarée'
      : `${arret.coutUsd} USD dépensés (estimation du CLI)`;
  const joint = arret.diffJoint ? 'diff partiel joint' : 'aucun diff produit';
  return (
    `[hive] arrêt budgétaire : l’agent s’est arrêté dans sa boucle sur son plafond de coût ` +
    `(${usdDeMicros(arret.plafondMicros)} USD), ${depense} — ni un échec, ni une panne ; ` +
    `${joint}. Pour continuer, redélègue sous un NOUVEL childTaskId avec une réservation ` +
    'plus large : le même childTaskId rejoue cet enfant arrêté.'
  );
}
