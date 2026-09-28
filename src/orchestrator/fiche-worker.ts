// La fiche d'un Worker — ce qu'on sait de LUI, et d'où on le sait.
//
// ─── POURQUOI UNE FICHE, ET PAS UNE CARTE DE PLUS ────────────────────────────
//
// La carte de l'Essaim dit qui est en ligne et ce qu'il fait maintenant ; la
// Chambre dit ce qu'il touche. Il manquait l'endroit où se lit sa TRAJECTOIRE :
// les erreurs que la ruche a retenues de lui, les débats de la War Room où il a
// pris la parole, les missions qu'il a rendues. Ces faits existent tous — ils
// sont dispersés entre `results`, le journal et `contre_expertises` — et un
// Worker qu'on ne peut pas relire est un Worker qu'on croit sur parole.
//
// ─── TROIS RÈGLES, CELLES DE LA WAR ROOM ─────────────────────────────────────
//
//   · une participation se PROUVE par un fait exact : un résultat rendu par ce
//     nœud (`results.nodeId`), une proposition ou un avis de Conseil portant
//     son `nodeId`. Jamais par l'assignation courante d'une tâche, qui change
//     à chaque reprise, ni par la famille d'agent, que partagent d'autres
//     ouvrières ;
//   · rien n'est agrégé ici : une moyenne de coût ou de qualité par Worker est
//     un choix de métrique (le rapport de mission le tranche), et une moyenne
//     posée faute de mieux serait un chiffre inventé. La fiche rend les faits
//     PAR TÂCHE ;
//   · ce qui est absent reste absent : pas de leçon → liste vide, jamais « aucune
//     erreur ».
//
// MODULE PUR — aucune I/O, aucune horloge. Le serveur relit, joint et caviarde ;
// ce module choisit et borne.

import { extraitDesLogs } from './brood.js';
import type { EntreeWarRoom } from '../shared/war-room.js';
import type { ExecutionUsage } from '../shared/types.js';

/** Au plus autant de leçons : les plus récentes, celles que la Couveuse relirait. */
export const LECONS_MAX = 6;
/** Au plus autant de débats sur la fiche — le fil complet vit dans la War Room. */
export const DEBATS_MAX = 12;
/** Au plus autant de missions rendues. */
export const MISSIONS_MAX = 12;

/** Une erreur que la ruche a retenue de ce Worker : un échec qu'il a rendu, et sa leçon. */
export interface LeconApprise {
  resultId: number;
  taskId: string;
  /** `null` : la tâche a été élaguée — la leçon reste, son titre non. */
  titre: string | null;
  createdAt: number;
  /** L'extrait que la Couveuse réinjecte à la reprise (`extraitDesLogs`), caviardé. */
  extrait: string;
}

/** Une mission RENDUE par ce Worker : un résultat, avec ce qu'il a coûté en temps. */
export interface MissionRendue {
  resultId: number;
  taskId: string;
  titre: string | null;
  succes: boolean;
  /** Durée déclarée par le nœud pour CETTE tentative (`results.durationMs`). */
  dureeMs: number;
  createdAt: number;
  /** Ressources locales observées pendant la tentative (#427) ; absent : non mesurées. */
  usage?: ExecutionUsage;
}

/** Comment ce Worker a pris part au débat. */
export type RoleDebat =
  /** Il a proposé une piste, ou donné un avis, au Conseil. */
  | 'eclaireuse'
  /** Il a relu la production d'un autre en contre-expertise. */
  | 'relecteur'
  /** C'est SA production qu'on a relue, contestée, renvoyée ou jugée. */
  | 'auteur';

export interface DebatDuWorker {
  role: RoleDebat;
  entree: EntreeWarRoom;
}

/** Les résultats du nœud, tels que le store les rend (`resultatsDuNoeud`). */
interface ResultatDuNoeud {
  resultId: number;
  taskId: string;
  success: boolean;
  durationMs: number;
  createdAt: number;
  logs: string;
  usage?: ExecutionUsage;
}

/**
 * Les leçons : les échecs rendus par ce Worker, du plus récent au plus ancien.
 *
 * Un échec aux logs vides ne dit rien — il n'est pas une leçon, et l'écrire
 * « (vide) » ferait une ligne qui a l'air d'en être une.
 */
export function leconsDuWorker(
  resultats: readonly ResultatDuNoeud[],
  titreDe: (taskId: string) => string | null,
  caviarder: (texte: string) => string,
): LeconApprise[] {
  const lecons: LeconApprise[] = [];
  for (const r of resultats) {
    if (r.success) continue;
    const extrait = extraitDesLogs(r.logs);
    if (extrait === '') continue;
    lecons.push({
      resultId: r.resultId,
      taskId: r.taskId,
      titre: titreDe(r.taskId),
      createdAt: r.createdAt,
      extrait: caviarder(extrait),
    });
    if (lecons.length >= LECONS_MAX) break;
  }
  return lecons;
}

/** Les missions rendues, du plus récent au plus ancien, bornées. */
export function missionsDuWorker(
  resultats: readonly ResultatDuNoeud[],
  titreDe: (taskId: string) => string | null,
): MissionRendue[] {
  return resultats.slice(0, MISSIONS_MAX).map((r) => ({
    resultId: r.resultId,
    taskId: r.taskId,
    titre: titreDe(r.taskId),
    succes: r.success,
    dureeMs: Math.max(0, r.durationMs),
    createdAt: r.createdAt,
    ...(r.usage ? { usage: r.usage } : {}),
  }));
}

/**
 * Les entrées de la War Room où CE Worker a pris part, les plus récentes
 * d'abord.
 *
 * `productions` : les tâches dont il a rendu un résultat. `relectures` : les
 * productions qu'il a relues, avec la famille d'agent sous laquelle il l'a
 * fait — un avis `contre_verdict` porte la FAMILLE du relecteur, pas le nœud :
 * seule la conjonction « il a rendu la relecture de cette production » ET
 * « l'avis vient de sa famille » l'attribue sans deviner.
 *
 * Une même entrée ne compte qu'une fois : relecteur l'emporte sur auteur (un
 * Worker ne relit jamais sa propre production — la contre-expertise l'exclut —,
 * mais un fil n'a pas à dépendre de cette garde pour rester juste).
 */
export function debatsDuWorker(
  entrees: readonly EntreeWarRoom[],
  p: {
    nodeId: string;
    productions: ReadonlySet<string>;
    relectures: ReadonlyMap<string, ReadonlySet<string>>;
  },
): DebatDuWorker[] {
  const retenus: DebatDuWorker[] = [];
  for (let i = entrees.length - 1; i >= 0 && retenus.length < DEBATS_MAX; i--) {
    const e = entrees[i]!;
    const role = roleDans(e, p);
    if (role) retenus.push({ role, entree: e });
  }
  return retenus;
}

function roleDans(
  e: EntreeWarRoom,
  p: {
    nodeId: string;
    productions: ReadonlySet<string>;
    relectures: ReadonlyMap<string, ReadonlySet<string>>;
  },
): RoleDebat | null {
  switch (e.genre) {
    case 'conseil_proposition':
    case 'conseil_avis':
      return e.nodeId === p.nodeId ? 'eclaireuse' : null;
    case 'contre_verdict':
    case 'contre_echec':
      if (p.relectures.get(e.taskId)?.has(e.relecteur)) return 'relecteur';
      return p.productions.has(e.taskId) ? 'auteur' : null;
    case 'contre_expertise':
    case 'renvoi_evaluator':
    case 'renvoi_refuse':
    case 'revue_humaine':
      return p.productions.has(e.taskId) ? 'auteur' : null;
    default:
      // Ouverture, tour, clôture et décision d'un Conseil ne portent aucun
      // nœud : les attribuer à chaque éclaireuse inventerait une participation.
      return null;
  }
}
