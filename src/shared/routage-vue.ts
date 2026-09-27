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
// Un dernier fait dit ce que l'ouvrière a LU de l'expérience voisine :
// `experience_context` (ou `experience_refus`, quand le budget l'a évincée),
// émis juste après l'affectation — les contextes similaires du graphe
// d'expérience (`shared/graphe-experience.ts`). Ce sont des CORRÉLATIONS :
// elles expliquent ce que l'ouvrière savait, jamais pourquoi le modèle a été
// choisi — l'Aiguillage ne les lit pas.
//
// La raison se lit selon la version du calcul qui l'a prise
// (`versionAiguillage`, cf. `VERSION_AIGUILLAGE`). Depuis la v2, chaque ligne
// sépare les verdicts reçus (`essais`) des élections en vol (`enVol`). Avant,
// `essais` mêlait les deux : ces raisons-là sont relues telles quelles, sans
// prétendre savoir combien de leurs essais étaient en vol.

import type { HiveEvent } from './types.js';

/** Les types que la projection relit : la route `/api/tasks/:id/routage` les demande tous. */
export const TYPES_ROUTAGE = [
  'task_assigned',
  'pheromone_route',
  'drone_race_started',
  'drone_won',
  'experience_context',
  'experience_refus',
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
}

/** Ce qui a départagé le nœud, dans l'ordre où l'ordonnanceur l'applique. */
export type CritereNoeud = 'course_de_drones' | 'porteur_du_modele' | 'pheromones' | 'moins_charge';

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

/** Une tâche voisine que le graphe d'expérience a rapprochée, en faits typés. */
export interface SimilaireVue {
  taskId: string;
  /** Le titre que l'ouvrière a lu ; `null` si le fait ne le porte pas. */
  titre: string | null;
  /** `null` quand le fait ne le dit pas : jamais « ce projet » par défaut. */
  projectId: string | null;
  /** Du projet de la tâche ; `null` (inconnu) quand le fait ne le dit pas. */
  memeProjet: boolean | null;
  categorie: boolean;
  fichiers: string[];
  erreurs: number;
  rendue: boolean;
  validee: boolean;
  contestee: boolean;
  tentativesEchouees: number;
  modeles: string[];
  lecons: number;
}

/** Ce que l'ouvrière a reçu du graphe d'expérience à cette affectation. */
export interface ExperienceVue {
  /** `perdue` : il y avait des contextes, le budget du prompt les a évincés. */
  etat: 'jointe' | 'perdue';
  portee: 'projet' | 'ruche' | null;
  similaires: SimilaireVue[];
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
  /** Absente quand rien ne ressemblait à la tâche (ou avant ce fait). */
  experience?: ExperienceVue;
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
  };
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

const vrai = (v: unknown): boolean => v === true;
const entierNaturel = (v: unknown): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;

/** Un contexte similaire relu ; sans `taskId` lisible, il est ignoré. */
function similaireDepuis(brut: unknown): SimilaireVue | null {
  const s = objet(brut);
  const taskId = texte(s.taskId);
  if (taskId === null) return null;
  return {
    taskId,
    titre: texte(s.titre),
    projectId: texte(s.projectId),
    memeProjet: typeof s.memeProjet === 'boolean' ? s.memeProjet : null,
    categorie: vrai(s.categorie),
    fichiers: textes(s.fichiers),
    erreurs: entierNaturel(s.erreurs),
    rendue: vrai(s.rendue),
    validee: vrai(s.validee),
    contestee: vrai(s.contestee),
    tentativesEchouees: entierNaturel(s.tentativesEchouees),
    modeles: textes(s.modeles),
    lecons: entierNaturel(s.lecons),
  };
}

function experienceDepuis(e: HiveEvent): ExperienceVue {
  const p = e.payload;
  return {
    etat: e.type === 'experience_refus' ? 'perdue' : 'jointe',
    portee: p.portee === 'projet' || p.portee === 'ruche' ? p.portee : null,
    similaires: Array.isArray(p.similaires)
      ? p.similaires.map(similaireDepuis).filter((x): x is SimilaireVue => x !== null)
      : [],
  };
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
    if (e.type === 'experience_context' || e.type === 'experience_refus') {
      // Émis à l'envoi, juste APRÈS l'affectation qu'il éclaire. Une course
      // l'émet une fois par drone, pour la même tâche et le même graphe : le
      // premier suffit.
      const derniere = affectations.at(-1);
      if (derniere && !derniere.experience) derniere.experience = experienceDepuis(e);
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
      critereNoeud: course
        ? 'course_de_drones'
        : pheromone
          ? 'pheromones'
          : modele
            ? 'porteur_du_modele'
            : 'moins_charge',
    });
  }
  return affectations;
}
