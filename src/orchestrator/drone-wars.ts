// Drone Wars (palier 4) — redondance compétitive pour les tâches critiques.
//
// Principe : au lieu de confier une tâche critique à un seul nœud, on lance
// PLUSIEURS « drones » (le même travail sur des nœuds différents) en parallèle.
// Le PREMIER résultat valide gagne ; les drones perdants encore en vol sont
// annulés (on ne gaspille pas la ruche). Bénéfices : latence (on prend le plus
// rapide) et résilience (un drone qui plante ou manque de tokens ne bloque rien
// tant qu'un autre avance) — complémentaire du token-failover.
//
// Ce module est le CŒUR DE DÉCISION, PUR (aucune I/O, aucun état global) : il
// dit quels drones enrôler et, à chaque résultat, qui a gagné et quoi annuler.
// L'intégration au scheduler (assignation multi-nœuds) est volontairement hors
// de ce fichier : le modèle d'assignation actuel est mono-nœud, et le passage au
// multi-nœud touche un invariant central — il mérite son propre incrément revu.
// Isoler la décision ici la rend testable et sûre indépendamment de ce câblage.

/** État d'un drone dans la course. */
export type DroneStatus = 'running' | 'succeeded' | 'failed';

export interface Drone {
  nodeId: string;
  status: DroneStatus;
}

/** Une course compétitive pour UNE tâche critique. */
export interface DroneRace {
  taskId: string;
  /** Nombre de drones visé (redondance demandée). */
  factor: number;
  drones: Drone[];
  /** nodeId du gagnant (1er succès), sinon null. */
  winner: string | null;
  /** Course tranchée : un gagnant existe (plus rien à attendre). */
  decided: boolean;
  /**
   * Le modèle que l'Aiguillage a élu pour CHAQUE drone (nodeId → modèle), rempli
   * par le scheduler à l'enrôlement — ce module reste pur et n'en calcule aucun.
   * Absent : aucun drone ne déclarait de modèle (course d'avant l'Aiguillage). On
   * s'en sert pour re-poser le modèle du VAINQUEUR : c'est SA production que la
   * contre-visite jugera. Préservé au fil des `{ ...race }` de ce module.
   */
  modeleParDrone?: Record<string, string>;
}

/** Nœud candidat à devenir drone (l'agentType sert à diversifier la course). */
export interface DroneCandidate {
  id: string;
  agentType: string;
}

/** Décision prise après l'arrivée d'un résultat de drone. */
export type DroneOutcome =
  | 'won' // ce drone gagne la course : accepter son résultat, annuler les autres
  | 'lost' // un gagnant existait déjà : résultat ignoré (course déjà tranchée)
  | 'pending' // échec d'un drone, mais d'autres courent encore : on attend
  | 'all_failed'; // tous les drones enrôlés ont échoué : la tâche a vraiment échoué

export interface DroneDecision {
  outcome: DroneOutcome;
  /** nodeIds des drones perdants à annuler (cancel_task) — non vide seulement sur `won`. */
  cancel: string[];
}

/** Facteur de redondance borné : au moins 1 (mono-nœud), au plus MAX_FACTOR. */
export const MAX_FACTOR = 5;

export function clampFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.max(1, Math.min(MAX_FACTOR, Math.floor(factor)));
}

/** Crée une course vide pour une tâche critique. */
export function createRace(taskId: string, factor: number): DroneRace {
  return { taskId, factor: clampFactor(factor), drones: [], winner: null, decided: false };
}

/** Drones encore en vol (ni gagnés ni échoués). */
export function runningDrones(race: DroneRace): string[] {
  return race.drones.filter((d) => d.status === 'running').map((d) => d.nodeId);
}

/**
 * Choisit jusqu'à `count` nœuds distincts en MAXIMISANT la diversité d'agents :
 * une course entre IA différentes (claude-code, codex, une commande libre…) est
 * plus robuste qu'entre clones — elles ne se trompent pas sur les mêmes cas.
 * Glouton : à chaque tour, prendre le candidat dont le type d'agent est le moins
 * déjà représenté ; à égalité, respecter l'ordre d'entrée (le caller le trie par
 * charge). Ignore les doublons d'id.
 */
export function pickDiverseDrones(candidates: DroneCandidate[], count: number): string[] {
  const want = Math.max(0, Math.floor(count));
  if (want === 0) return [];
  const pool = dedupeById(candidates);
  const chosen: string[] = [];
  const typeUsage = new Map<string, number>();

  while (chosen.length < want && pool.length > 0) {
    let bestIndex = 0;
    let bestUsage = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const candidate = pool[i];
      if (!candidate) continue;
      const usage = typeUsage.get(candidate.agentType) ?? 0;
      if (usage < bestUsage) {
        bestUsage = usage;
        bestIndex = i;
      }
    }
    const [picked] = pool.splice(bestIndex, 1);
    if (!picked) break;
    chosen.push(picked.id);
    typeUsage.set(picked.agentType, (typeUsage.get(picked.agentType) ?? 0) + 1);
  }
  return chosen;
}

/** Retire les candidats en double (par id), en gardant le premier vu. */
function dedupeById(candidates: DroneCandidate[]): DroneCandidate[] {
  const seen = new Set<string>();
  const out: DroneCandidate[] = [];
  for (const c of candidates) {
    if (c.id && !seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/**
 * Enrôle de nouveaux drones jusqu'à atteindre le facteur de redondance, en
 * puisant dans `candidates` (nœuds éligibles). Ne ré-enrôle jamais un nœud déjà
 * dans la course. Retourne la course mise à jour et les nodeIds à LANCER
 * réellement (le caller enverra les assign_task). No-op si la course est tranchée.
 */
export function enlistDrones(
  race: DroneRace,
  candidates: DroneCandidate[],
): { race: DroneRace; launch: string[] } {
  if (race.decided) return { race, launch: [] };
  const already = new Set(race.drones.map((d) => d.nodeId));
  const free = candidates.filter((c) => !already.has(c.id));
  const need = race.factor - race.drones.length;
  if (need <= 0 || free.length === 0) return { race, launch: [] };

  const launch = pickDiverseDrones(free, need);
  const drones = [
    ...race.drones,
    ...launch.map((nodeId) => ({ nodeId, status: 'running' as const })),
  ];
  return { race: { ...race, drones }, launch };
}

/**
 * Enregistre le résultat d'un drone et décide de la suite.
 *  - succès + pas encore de gagnant → `won` : on accepte, on annule les autres
 *    drones encore en vol ;
 *  - résultat (succès OU échec) alors que la course est déjà tranchée → `lost` ;
 *  - échec, d'autres drones courent encore → `pending` (on attend) ;
 *  - échec du dernier drone en vol, aucun succès → `all_failed`.
 * Un nodeId inconnu de la course est ignoré (`lost`, sans effet) : robustesse
 * face aux résultats en retard ou dupliqués (idempotence).
 */
export function recordDroneResult(
  race: DroneRace,
  nodeId: string,
  success: boolean,
): { race: DroneRace; decision: DroneDecision } {
  const drone = race.drones.find((d) => d.nodeId === nodeId);
  // Résultat pour un drone inconnu, ou course déjà tranchée : sans effet.
  if (!drone || race.decided || drone.status !== 'running') {
    return { race, decision: { outcome: 'lost', cancel: [] } };
  }

  if (success) {
    const cancel = runningDrones(race).filter((id) => id !== nodeId);
    const drones = race.drones.map((d) =>
      d.nodeId === nodeId ? { ...d, status: 'succeeded' as const } : d,
    );
    return {
      race: { ...race, drones, winner: nodeId, decided: true },
      decision: { outcome: 'won', cancel },
    };
  }

  // Échec de ce drone.
  const drones = race.drones.map((d) =>
    d.nodeId === nodeId ? { ...d, status: 'failed' as const } : d,
  );
  const next = { ...race, drones };
  const stillRunning = runningDrones(next).length > 0;
  return {
    race: next,
    decision: { outcome: stillRunning ? 'pending' : 'all_failed', cancel: [] },
  };
}
