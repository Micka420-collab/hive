// « Pourquoi ce Worker ? Pourquoi ce modèle ? » — la réponse, relue dans le
// journal.
//
// L'ordonnanceur consigne chaque affectation dans `task_assigned` : le nœud,
// le modèle commandé, et depuis #449 la catégorie et le classement qui a
// décidé (`raisonModele`, figé à l'instant du choix). Un départage par les
// phéromones est consigné juste avant, dans `pheromone_route` ; une course de
// drones, juste avant aussi, dans `drone_race_started` (le modèle et le
// classement de CHAQUE drone), et sa victoire dans `drone_won` (le drone et son
// modèle). Ce module replie ces faits en affectations lisibles, SANS rien
// recalculer : les antécédents ont bougé depuis, un second classement ne dirait
// pas pourquoi CE choix a été fait.
//
// Trois règles de lecture :
//   · une valeur absente reste absente — pas de modèle déclaré, pas de raison ;
//   · un modèle jamais JUGÉ n'a PAS une moyenne de 0 : il est « à explorer »
//     (son score UCB +∞ devient `null` en JSON, et sa moyenne n'est pas une
//     mesure) — même quand des élections en vol ont déjà éteint son infini ;
//   · un payload illisible est ignoré, jamais deviné.
//
// Deux faits disent ce qui a CONTRAINT le choix, au-delà de l'Aiguillage :
// `consigneOperateur` — la consigne de l'opérateur, une exclusion dure, et le
// choix se lit « forcé par l'opérateur » — et `preference` — ce qu'une tâche
// parente préférait, avec ce que cette préférence a réellement départagé.
// Aucun des deux ne réécrit le classement : il reste celui de l'Aiguillage.
//
// La raison se lit selon la version du calcul qui l'a prise
// (`versionAiguillage`, cf. `VERSION_AIGUILLAGE`). Depuis la v2, chaque ligne
// sépare les verdicts reçus (`essais`) des élections en vol (`enVol`). Avant,
// `essais` mêlait les deux : ces raisons-là sont relues telles quelles, sans
// prétendre savoir combien de leurs essais étaient en vol.

import { lireConsigneRoutage, type ConsigneRoutage } from './consigne-routage.js';
import type { HiveEvent } from './types.js';

/** Les types que la projection relit : la route `/api/tasks/:id/routage` les demande tous. */
export const TYPES_ROUTAGE = [
  'task_assigned',
  'pheromone_route',
  'drone_race_started',
  'drone_won',
] as const;

/** Une ligne du classement qui a décidé du modèle. */
export interface LigneRaison {
  modele: string;
  /** Verdicts reçus (v2+) ; avant la v2, élections en vol comprises. */
  essais: number;
  /** Élections en vol, sans verdict ; `null` quand la raison précède la v2 (inconnu). */
  enVol: number | null;
  /** `null` quand le modèle n'a jamais été jugé : ce n'est pas une mesure. */
  moyenne: number | null;
  /** `null` quand le score est infini (ni jugé, ni en vol) ou illisible. */
  score: number | null;
  /** Jamais jugé : l'Aiguillage l'explore avant de prétendre le connaître. */
  aExplorer: boolean;
  /** Le modèle que la tâche parente a dit préférer (délégation) ; absent sinon. */
  preferee?: true;
}

/** Ce qui a départagé le nœud, dans l'ordre où l'ordonnanceur l'applique. */
export type CritereNoeud =
  'course_de_drones' | 'porteur_du_modele' | 'pheromones' | 'preference_parent' | 'moins_charge';

/** Ce qu'une tâche parente préférait, et ce que la préférence a départagé. */
export interface PreferenceVue {
  agent: string | null;
  modele: string | null;
  /** Vide : lue, sans effet — aucune égalité à trancher, ou l'élu indisponible. */
  departage: Array<'agent' | 'modele'>;
}

/** Un drone d'une course : son nœud, le modèle qui lui a été commandé, et pourquoi. */
export interface DroneVue {
  nodeId: string;
  /** `null` quand son nœud ne déclare aucun modèle. */
  modele: string | null;
  raisonModele: LigneRaison[];
}

/**
 * Une course de drones. `task_assigned` n'en nomme que le PRIMAIRE : sans les
 * drones et le vainqueur, une victoire d'un autre drone se lisait comme celle
 * du primaire, avec son modèle.
 */
export interface CourseVue {
  drones: DroneVue[];
  /** `null` tant que la course court, ou si elle s'est éteinte sans gagnant. */
  vainqueur: { nodeId: string; modele: string | null } | null;
}

export interface AffectationVue {
  eventId: number;
  ts: number;
  nodeId: string;
  /** Modèle commandé par l'Aiguillage, `null` quand aucun nœud n'en déclare. */
  modele: string | null;
  categorie: string | null;
  /** Version du calcul qui a pris la décision ; `null` avant son tampon (v1). */
  versionAiguillage: number | null;
  raisonModele: LigneRaison[];
  /** Modèles qui avaient déjà échoué sur la tâche, écartés de ce choix. */
  modelesEcartes: string[];
  /**
   * Modèles commandés alors qu'ils avaient déjà échoué sur la tâche : aucun
   * autre nœud de la ruche ne la portait. Leur « à explorer » dans le
   * classement ne dit rien de ce plantage, qui n'est pas une note.
   */
  modelesReadmis: string[];
  pheromone: { domaine: string; score: number } | null;
  /** `null` hors course de drones. */
  course: CourseVue | null;
  /**
   * La consigne de l'opérateur qui a restreint ce choix — « forcé par
   * l'opérateur ». Absente quand il n'y en avait pas (ou qu'elle est illisible).
   */
  consigne?: ConsigneRoutage;
  /** Absente hors délégation, ou quand la tâche parente n'a rien préféré. */
  preference?: PreferenceVue;
  critereNoeud: CritereNoeud;
}

const nombre = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const texte = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const textes = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(texte).filter((t): t is string => t !== null) : [];
const objet = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function ligneDepuis(brut: unknown, version: number | null): LigneRaison | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const r = brut as Record<string, unknown>;
  const modele = texte(r.modele);
  const essais = nombre(r.essais);
  if (modele === null || essais === null || essais < 0) return null;
  // v2+ : la ligne DOIT dire ses élections en vol — absente ou négative, elle
  // est illisible. Avant la v2 : inconnu, et dit tel quel (`null`).
  const separe = version !== null && version >= 2;
  const enVol = separe ? nombre(r.enVol) : null;
  if (separe && (enVol === null || enVol < 0)) return null;
  const aExplorer = essais === 0;
  return {
    modele,
    essais,
    enVol,
    moyenne: aExplorer ? null : nombre(r.moyenne),
    score: nombre(r.score),
    aExplorer,
    ...(r.preferee === true ? { preferee: true as const } : {}),
  };
}

/** La consigne d'une affectation ; illisible, elle n'est pas devinée. */
function consigneDepuis(brut: unknown): ConsigneRoutage | null {
  if (brut === undefined) return null;
  const lue = lireConsigneRoutage(brut);
  return lue.ok ? lue.consigne : null;
}

function preferenceDepuis(brut: unknown): PreferenceVue | null {
  const p = objet(brut);
  const agent = texte(p.agent);
  const modele = texte(p.modele);
  if (agent === null && modele === null) return null;
  const departage = textes(p.departage).filter(
    (d): d is 'agent' | 'modele' => d === 'agent' || d === 'modele',
  );
  return { agent, modele, departage };
}

function raisonDepuis(brut: unknown, version: number | null): LigneRaison[] {
  return Array.isArray(brut)
    ? brut.map((l) => ligneDepuis(l, version)).filter((l): l is LigneRaison => l !== null)
    : [];
}

/** Les drones d'un `drone_race_started` ; `[]` s'il est illisible. */
function dronesDepuis(p: Record<string, unknown>): DroneVue[] {
  const version = nombre(p.versionAiguillage);
  const modeles = objet(p.modeles);
  const raisons = objet(p.raisons);
  return textes(p.drones).map((nodeId) => ({
    nodeId,
    modele: texte(modeles[nodeId]),
    raisonModele: raisonDepuis(raisons[nodeId], version),
  }));
}

/**
 * Les affectations d'une tâche, de la plus ancienne à la plus récente.
 *
 * `evenements` : les `TYPES_ROUTAGE` de la tâche, dans l'ordre du journal. Un
 * `pheromone_route` s'attache à l'affectation qui le SUIT (l'ordonnanceur
 * l'émet juste avant `task_assigned`) et au même nœud ; un `drone_race_started`
 * aussi, quand ce nœud est l'un de ses drones. Un `drone_won` désigne le
 * vainqueur de la course portée par la dernière affectation.
 */
export function affectationsDepuisEvenements(evenements: readonly HiveEvent[]): AffectationVue[] {
  const tries = [...evenements].sort((a, b) => a.id - b.id);
  const affectations: AffectationVue[] = [];
  let pheromoneEnAttente: { nodeId: string; domaine: string; score: number } | null = null;
  let dronesEnAttente: DroneVue[] = [];
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
    if (e.type === 'drone_race_started') {
      dronesEnAttente = dronesDepuis(p);
      continue;
    }
    if (e.type === 'drone_won') {
      const course = affectations.at(-1)?.course;
      const drone = course?.drones.find((d) => d.nodeId === texte(p.nodeId));
      // Un `drone_won` sans modèle (antérieur à ce fait) retombe sur le modèle
      // COMMANDÉ au drone par la course : le même fait, consigné au départ.
      if (course && drone) {
        course.vainqueur = { nodeId: drone.nodeId, modele: texte(p.modele) ?? drone.modele };
      }
      continue;
    }
    if (e.type !== 'task_assigned') continue;
    const nodeId = texte(p.nodeId);
    const drones = dronesEnAttente;
    dronesEnAttente = [];
    if (nodeId === null) {
      pheromoneEnAttente = null;
      continue;
    }
    const pheromone =
      pheromoneEnAttente && pheromoneEnAttente.nodeId === nodeId
        ? { domaine: pheromoneEnAttente.domaine, score: pheromoneEnAttente.score }
        : null;
    pheromoneEnAttente = null;
    const course = drones.some((d) => d.nodeId === nodeId) ? { drones, vainqueur: null } : null;
    const modele = texte(p.modele);
    const versionAiguillage = nombre(p.versionAiguillage);
    const preference = preferenceDepuis(p.preference);
    const consigne = consigneDepuis(p.consigneOperateur);
    affectations.push({
      eventId: e.id,
      ts: e.ts,
      nodeId,
      modele,
      categorie: texte(p.categorie),
      versionAiguillage,
      raisonModele: raisonDepuis(p.raisonModele, versionAiguillage),
      modelesEcartes: textes(p.modelesEcartes),
      modelesReadmis: textes(p.modelesReadmis),
      pheromone,
      course,
      ...(consigne ? { consigne } : {}),
      ...(preference ? { preference } : {}),
      critereNoeud: course
        ? 'course_de_drones'
        : pheromone
          ? 'pheromones'
          : preference?.departage.includes('agent')
            ? 'preference_parent'
            : modele
              ? 'porteur_du_modele'
              : 'moins_charge',
    });
  }
  return affectations;
}
