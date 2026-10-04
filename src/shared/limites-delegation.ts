// Les bornes de la délégation Hive — UNE source, lue des deux côtés du réseau.
//
// ─── POURQUOI CE FICHIER EST DANS `shared` ───────────────────────────────────
//
// La Reine les APPLIQUE (`orchestrator/delegation.ts`) ; le pont MCP du nœud
// les ANNONCE au modèle, dans la description de l'outil `hive_delegate`
// (`adapters/delegation-bridge.ts`). Tant qu'elles vivaient dans l'orchestrateur
// seul, l'outil ne disait ni la profondeur, ni les quotas, ni le format de
// l'identifiant : un agent découvrait chaque borne en se la prenant, un refus
// après l'autre. Une copie à la main dans le pont aurait fini par mentir — la
// description d'outil EST le produit pour le modèle.
//
// ─── CE QUE DISENT LES TROIS BUDGETS ─────────────────────────────────────────
//
// Durée, coût et ressources sont des totaux CUMULÉS PAR RACINE : chaque enfant
// Hive RÉSERVE sa part à l'admission, et la somme des réservations d'un même
// arbre — enfants terminés compris, une réservation ne se rend pas — ne
// dépasse jamais ces plafonds. Une tâche racine ne déclare aucun budget à elle :
// son enveloppe est celle-ci. Chaque borne est donc aussi, par construction,
// le plafond d'un enfant seul.
//
//   · `maxCostMicros` est en MICRO-USD (1 000 000 = 1 USD) du coût que le CLI
//     de l'agent DÉCLARE (Claude Code : `total_cost_usd`). La Reine tient en
//     plus la dépense déclarée de l'arbre : quand elle atteint ce plafond,
//     plus aucun enfant n'est admis et ceux en vol sont annulés. Une tentative
//     sans coût déclaré n'est JAMAIS comptée pour zéro : elle est dite
//     inconnue, à part. La réservation d'un enfant est aussi SON plafond,
//     tenu dans la boucle de son agent : chaque tentative reçoit ce qu'il en
//     reste (`plafondCoutTentative`, orchestrator/delegation.ts), que Claude
//     Code applique (`--max-budget-usd`) — un arrêt budgétaire, pas un échec.
//   · `maxResourceUnits` est un compte ABSTRAIT : Hive ne mesure aucune
//     ressource réelle derrière (ni CPU, ni mémoire, ni machines). C'est une
//     unité que l'agent s'alloue à lui-même pour se borner, rien de plus.

import { ID_PATTERN } from './protocol.js';

export interface LimitesDelegation {
  /** Profondeur maximale sous la racine (la racine est à 0). */
  maxDepth: number;
  /** Enfants Hive directs par parent. */
  maxChildrenPerParent: number;
  /** Descendants Hive par racine, toutes profondeurs confondues. */
  maxDescendantsPerRoot: number;
  /** Durée réservée cumulée par racine, en millisecondes. */
  maxDurationMs: number;
  /** Coût réservé cumulé par racine — et plafond de dépense déclarée —, en micro-USD. */
  maxCostMicros: number;
  /** Unités de ressources réservées cumulées par racine (compte abstrait). */
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

/**
 * Le format d'un `childTaskId`, tel que la Reine le valide (`ID_PATTERN`) —
 * écrit pour être LU par un modèle dans la description de l'outil.
 */
export const FORMAT_ID_ENFANT = ID_PATTERN.source;
