// « Pourquoi ce Worker ? Pourquoi ce modèle ? » — la réponse, relue dans le
// journal.
//
// L'ordonnanceur consigne chaque affectation dans `task_assigned` : le nœud,
// le modèle commandé, et depuis #449 la catégorie et le classement qui a
// décidé (`raisonModele`, figé à l'instant du choix). Un départage par les
// phéromones est consigné juste avant, dans `pheromone_route`. Ce module
// replie ces faits en affectations lisibles, SANS rien recalculer : les
// antécédents ont bougé depuis, un second classement ne dirait pas pourquoi
// CE choix a été fait.
//
// Trois règles de lecture :
//   · une valeur absente reste absente — pas de modèle déclaré, pas de raison ;
//   · un modèle jamais essayé n'a PAS une moyenne de 0 : il est « à explorer »
//     (son score UCB +∞ devient `null` en JSON, et sa moyenne n'est pas une
//     mesure) ;
//   · un payload illisible est ignoré, jamais deviné.

import type { HiveEvent } from './types.js';

/** Une ligne du classement qui a décidé du modèle. */
export interface LigneRaison {
  modele: string;
  essais: number;
  /** `null` quand le modèle n'a jamais été essayé : ce n'est pas une mesure. */
  moyenne: number | null;
  /** `null` quand le score est infini (jamais essayé) ou illisible. */
  score: number | null;
  /** Jamais essayé : l'Aiguillage l'explore avant de prétendre le connaître. */
  aExplorer: boolean;
}

/** Ce qui a départagé le nœud, dans l'ordre où l'ordonnanceur l'applique. */
export type CritereNoeud = 'porteur_du_modele' | 'pheromones' | 'moins_charge';

export interface AffectationVue {
  eventId: number;
  ts: number;
  nodeId: string;
  /** Modèle commandé par l'Aiguillage, `null` quand aucun nœud n'en déclare. */
  modele: string | null;
  categorie: string | null;
  raisonModele: LigneRaison[];
  pheromone: { domaine: string; score: number } | null;
  critereNoeud: CritereNoeud;
}

const nombre = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const texte = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function ligneDepuis(brut: unknown): LigneRaison | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const r = brut as Record<string, unknown>;
  const modele = texte(r.modele);
  const essais = nombre(r.essais);
  if (modele === null || essais === null || essais < 0) return null;
  const aExplorer = essais === 0;
  return {
    modele,
    essais,
    moyenne: aExplorer ? null : nombre(r.moyenne),
    score: nombre(r.score),
    aExplorer,
  };
}

/**
 * Les affectations d'une tâche, de la plus ancienne à la plus récente.
 *
 * `evenements` : les `task_assigned` et `pheromone_route` de la tâche, dans
 * l'ordre du journal. Un `pheromone_route` s'attache à l'affectation qui le
 * SUIT (l'ordonnanceur l'émet juste avant `task_assigned`) et au même nœud.
 */
export function affectationsDepuisEvenements(evenements: readonly HiveEvent[]): AffectationVue[] {
  const tries = [...evenements].sort((a, b) => a.id - b.id);
  const affectations: AffectationVue[] = [];
  let pheromoneEnAttente: { nodeId: string; domaine: string; score: number } | null = null;
  for (const e of tries) {
    const p = e.payload;
    if (e.type === 'pheromone_route') {
      const nodeId = texte(p.nodeId);
      const domaine = texte(p.domaine);
      const score = nombre(p.score);
      pheromoneEnAttente =
        nodeId !== null && domaine !== null && score !== null ? { nodeId, domaine, score } : null;
      continue;
    }
    if (e.type !== 'task_assigned') continue;
    const nodeId = texte(p.nodeId);
    if (nodeId === null) {
      pheromoneEnAttente = null;
      continue;
    }
    const raisonModele = Array.isArray(p.raisonModele)
      ? p.raisonModele.map(ligneDepuis).filter((l): l is LigneRaison => l !== null)
      : [];
    const pheromone =
      pheromoneEnAttente && pheromoneEnAttente.nodeId === nodeId
        ? { domaine: pheromoneEnAttente.domaine, score: pheromoneEnAttente.score }
        : null;
    pheromoneEnAttente = null;
    const modele = texte(p.modele);
    affectations.push({
      eventId: e.id,
      ts: e.ts,
      nodeId,
      modele,
      categorie: texte(p.categorie),
      raisonModele,
      pheromone,
      critereNoeud: pheromone ? 'pheromones' : modele ? 'porteur_du_modele' : 'moins_charge',
    });
  }
  return affectations;
}
