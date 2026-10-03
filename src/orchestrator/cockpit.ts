// Le cockpit de la Ruche — ce que la ruche a décidé, ce qu'elle a dépensé, et
// ce qui l'arrête.
//
// L'accueil de Mission Control montrait l'état (nœuds, file, essaim) mais pas
// trois choses qu'un opérateur cherche en arrivant :
//
//   · les DÉCISIONS récentes — pourquoi ce modèle, ce qu'a dit la contre-revue,
//     ce que l'Evaluator a renvoyé, ce qu'un humain a tranché. Elles étaient
//     consignées, une par une, dans un journal dominé par les battements de
//     cœur ;
//   · la DÉPENSE — le coût et le temps que les agents DÉCLARENT, avec leur
//     couverture. Jamais une facture : ce que les CLI ont dit, et combien de
//     tentatives l'ont dit ;
//   · les ARRÊTS — ce qui ne repartira pas sans quelqu'un. Chacun vivait dans
//     sa vue (Balance, War Room, tiroir d'une tâche) ou nulle part : une
//     relecture impossible attendait un humain sans que l'accueil le dise.
//
// Module PUR : le serveur lit le journal et l'état, ceci replie. Rien n'y est
// estimé : une somme sans déclaration est `inconnu`, une fenêtre de journal
// qui a pu perdre des faits le dit (`tronquee`).
//
// ─── UNE ALERTE EST UN ÉTAT, PAS UN SOUVENIR ─────────────────────────────────
//
// Le journal raconte ce qui est ARRIVÉ ; une alerte dit ce qui BLOQUE
// encore. Chaque alerte est donc confrontée à l'état courant avant d'être
// rendue : un refus suivi d'une nouvelle affectation n'est plus un refus, une
// relecture impossible qu'un humain a tranchée n'attend plus personne, un
// plafond relevé ne bloque plus. Sans cette confrontation, le bloc se
// remplirait de faits réglés depuis longtemps — et un bloc d'alertes qu'on a
// appris à ignorer ne sert plus le jour où il compte.
//
// Les désaccords (Conseil sans consensus, contestation sans renvoi) ne sont
// PAS ici : la War Room les tient et l'accueil y donne accès, avec leur
// compte. Les recopier ferait deux sources pour un même « à trancher ».

import {
  TYPES_TENTATIVES,
  bilanEconomique,
  tentativesDepuisEvenements,
} from '../shared/economie.js';
import type { BilanEconomique } from '../shared/economie.js';
import type { HiveEvent, TaskStatus } from '../shared/types.js';

// ─── Les décisions ───────────────────────────────────────────────────────────

/**
 * Les faits qui sont des DÉCISIONS, et seulement eux. `task_assigned` n'en est
 * une que lorsqu'un modèle a été commandé (sa raison est figée dans le
 * payload) ; `task_retry`, seulement quand c'est l'Evaluator qui renvoie —
 * une reprise après panne est une machine qui tousse, pas un choix.
 */
export const TYPES_DECISIONS = [
  'task_assigned',
  'contre_expertise_verdict',
  'contre_expertise_impossible',
  'task_retry',
  'evaluator_retry_skipped',
  'evaluator_overridden',
  'task_reviewed',
  'council_decided',
  'balance_cap_reached',
  'balance_cap_set',
] as const;

/** Combien de décisions l'accueil montre : de quoi lire la dernière heure, pas l'histoire. */
export const DECISIONS_MAX = 12;

function estUneDecision(e: HiveEvent): boolean {
  const p = e.payload;
  switch (e.type) {
    case 'task_assigned':
      return typeof p.modele === 'string' && p.modele.length > 0;
    case 'task_retry':
      return p.source === 'evaluator';
    case 'contre_expertise_verdict':
      return p.source === 'hive_counter_review' && typeof p.conteste === 'boolean';
    case 'task_reviewed':
      return p.state === 'approved' || p.state === 'rejected';
    default:
      return (TYPES_DECISIONS as readonly string[]).includes(e.type);
  }
}

/** Les `limite` décisions les plus récentes, la plus récente d'abord. */
export function decisionsRecentes(
  evenements: readonly HiveEvent[],
  limite = DECISIONS_MAX,
): HiveEvent[] {
  return [...evenements]
    .filter(estUneDecision)
    .sort((a, b) => b.id - a.id)
    .slice(0, Math.max(0, limite));
}

// ─── La dépense ──────────────────────────────────────────────────────────────

/** La fenêtre de la tuile : les dernières 24 heures, la journée qu'on vient de vivre. */
export const FENETRE_DEPENSE_MS = 24 * 60 * 60_000;

export interface DepenseRuche extends BilanEconomique {
  /** Début de la fenêtre (horloge de la Reine). */
  depuis: number;
  /**
   * Des tentatives de la fenêtre ONT PU manquer : le journal a été élagué (ou
   * la lecture a atteint sa borne) et son plus ancien fait d'issue est plus
   * récent que le début de la fenêtre. « Ont pu », jamais « ont » : le type
   * des événements élagués est perdu avec eux.
   */
  tronquee: boolean;
}

/**
 * Ce que la ruche a dépensé depuis `depuis`. `evenements` sont les issues lues
 * (`TYPES_TENTATIVES`), bornées à `borne` ; `journalElague` vient du store.
 */
export function depenseDepuisEvenements(
  evenements: readonly HiveEvent[],
  depuis: number,
  borne: number,
  journalElague: boolean,
): DepenseRuche {
  const issues = evenements.filter((e) => (TYPES_TENTATIVES as readonly string[]).includes(e.type));
  const plusAncienne = issues.reduce<number | null>(
    (min, e) => (min === null || e.ts < min ? e.ts : min),
    null,
  );
  const lecturePartielle = journalElague || evenements.length >= borne;
  return {
    ...bilanEconomique(tentativesDepuisEvenements(issues).filter((t) => t.ts >= depuis)),
    depuis,
    tronquee: lecturePartielle && (plusAncienne === null || plusAncienne > depuis),
  };
}

// ─── Les arrêts ──────────────────────────────────────────────────────────────

/** Les faits que les alertes confrontent à l'état. */
export const TYPES_ALERTES = [
  'task_assigned',
  'task_rejected',
  'task_failed',
  'contre_expertise_review_waiting',
  'contre_expertise_impossible',
  'balance_cap_reached',
] as const;

/**
 * Ce qui arrête la ruche, en quatre genres FERMÉS — ceux que l'accueil sait
 * dire et que l'opérateur sait lever :
 *
 *   · `blocage` : du travail prêt que personne ne peut prendre — aucune
 *     ouvrière en ligne, ou une relecture qui attend une famille absente ;
 *   · `refus`   : une tâche renvoyée par un nœud pour une panne
 *     d'infrastructure (authentification, quota, binaire, clone) et que
 *     personne n'a reprise depuis. Une saturation ou un créneau Night Shift
 *     ne sont pas des pannes : la tâche attend son tour. Après trop de refus,
 *     l'ordonnanceur ÉCHOUE la tâche (`no_working_agent`) : le refus devient
 *     `definitif` et reste dit tant qu'elle n'est ni relancée ni annulée —
 *     sinon l'alerte s'effaçait au moment précis où la panne devenait sans
 *     retour, et une ruche d'un seul nœud mal authentifié se taisait ;
 *   · `relecture_impossible` : une production que personne d'autre ne
 *     relira, et qu'aucun humain n'a encore tranchée ;
 *   · `budget`  : un projet que son plafond de dépense a réellement ARRÊTÉ
 *     (Balance en mode strict). En observation, rien n'est arrêté.
 */
export type AlerteCockpit =
  | { genre: 'blocage'; cause: 'aucune_ouvriere'; taches: number; depuis: number | null }
  | {
      genre: 'blocage';
      cause: 'relecteur_absent';
      taskId: string;
      titre: string | null;
      /** Famille d'agent attendue. */
      relecteur: string;
      depuis: number;
      /** Délai après lequel la relecture échouera, dite ; `null` s'il n'est pas consigné. */
      delaiMs: number | null;
    }
  | {
      genre: 'refus';
      taskId: string;
      titre: string | null;
      /** Le nœud du dernier refus ; `null` si ce refus est sorti du journal. */
      nodeId: string | null;
      raison: string;
      depuis: number;
      /** La tâche a été échouée faute d'agent qui fonctionne : elle ne repartira pas seule. */
      definitif: boolean;
      /**
       * Ce refus a eu lieu AVANT l'agent (`task_rejected.avantAgent`) : le nœud
       * n'a pas pu préparer la tâche — clone, configuration, dossier tenu. Aucun
       * agent n'est en cause, et « réparez l'agent » enverrait l'opérateur au
       * mauvais endroit.
       */
      avantAgent: boolean;
    }
  | {
      genre: 'relecture_impossible';
      taskId: string;
      titre: string | null;
      cause: string;
      depuis: number;
    }
  | {
      genre: 'budget';
      projectId: string;
      projet: string | null;
      depenseMs: number;
      plafondMs: number | null;
      /** Dernier franchissement consigné ; `null` s'il est sorti du journal. */
      depuis: number | null;
    };

export type GenreAlerte = AlerteCockpit['genre'];

/** L'ordre de lecture : ce qui arrête TOUT d'abord, ce qui n'arrête qu'une tâche ensuite. */
const ORDRE_GENRES: readonly GenreAlerte[] = ['blocage', 'budget', 'relecture_impossible', 'refus'];

/** Au-delà, le bloc dit le total et renvoie aux vues : une liste de cent alertes n'est plus lue. */
export const ALERTES_MAX = 20;

export interface EntreeAlertes {
  /** Journal lu (au moins `TYPES_ALERTES`), dans n'importe quel ordre. */
  evenements: readonly HiveEvent[];
  /** La tâche telle que la Reine la range maintenant ; `null` si elle n'existe plus. */
  tacheDe: (taskId: string) => { title: string; status: TaskStatus } | null;
  /** Les tâches prêtes : combien, et depuis quand la plus ancienne attend (`updatedAt`). */
  pretes: { nombre: number; depuis: number | null };
  noeudsEnLigne: number;
  /** Soldes de la Balance (`scheduler.balance.soldes`). */
  soldes: readonly {
    projectId: string;
    depenseMs: number;
    plafondMs: number | null;
    bloque: boolean;
  }[];
  nomsDeProjets: ReadonlyMap<string, string>;
  /**
   * La relecture impossible de ce résultat attend-elle ENCORE un humain ? Le
   * serveur répond sur l'état rangé : tâche terminée, résultat toujours le
   * dernier, aucune revue humaine posée depuis.
   */
  relectureEnSuspens: (taskId: string, resultId: number) => boolean;
}

const texte = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

const entierPositif = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;

export interface AlertesCockpit {
  alertes: AlerteCockpit[];
  /** Nombre total d'alertes, au-delà de `ALERTES_MAX` compris. */
  total: number;
}

export function alertesCockpit(entree: EntreeAlertes): AlertesCockpit {
  const tries = [...entree.evenements].sort((a, b) => a.id - b.id);
  const titreDe = (taskId: string): string | null => entree.tacheDe(taskId)?.title ?? null;
  const statutDe = (taskId: string): TaskStatus | null => entree.tacheDe(taskId)?.status ?? null;
  const alertes: AlerteCockpit[] = [];

  // Aucune ouvrière en ligne ET du travail prêt : rien ne partira.
  if (entree.pretes.nombre > 0 && entree.noeudsEnLigne === 0) {
    alertes.push({
      genre: 'blocage',
      cause: 'aucune_ouvriere',
      taches: entree.pretes.nombre,
      depuis: entree.pretes.depuis,
    });
  }

  // Le DERNIER fait d'attribution de chaque tâche décide : un refus suivi d'une
  // affectation est levé ; une relecture reprise par sa famille n'attend plus.
  // Le dernier refus d'infrastructure est gardé à part : c'est lui qui dit
  // POURQUOI une tâche a fini échouée faute d'agent qui fonctionne.
  const dernierDeTache = new Map<string, HiveEvent>();
  const dernierRefusInfra = new Map<string, HiveEvent>();
  const attentes = new Map<string, HiveEvent>();
  const impossibles = new Map<string, HiveEvent>();
  const plafonds = new Map<string, number>();
  for (const e of tries) {
    const taskId = texte(e.payload.taskId);
    switch (e.type) {
      case 'task_assigned':
        if (taskId) dernierDeTache.set(taskId, e);
        break;
      case 'task_rejected':
        if (!taskId) break;
        dernierDeTache.set(taskId, e);
        if (e.payload.infra === true) dernierRefusInfra.set(taskId, e);
        break;
      case 'task_failed':
        // Tout échec compte comme dernier fait : relancée puis échouée pour une
        // autre cause, la tâche ne dit plus le refus d'avant.
        if (taskId) dernierDeTache.set(taskId, e);
        break;
      case 'contre_expertise_review_waiting': {
        const relecture = texte(e.payload.relecture);
        if (relecture) attentes.set(relecture, e);
        break;
      }
      case 'contre_expertise_impossible':
        if (taskId) impossibles.set(taskId, e);
        break;
      case 'balance_cap_reached': {
        const projectId = texte(e.payload.projectId);
        if (projectId) plafonds.set(projectId, e.ts);
        break;
      }
    }
  }

  for (const [relecture, e] of attentes) {
    // Toujours prête : sa famille n'est pas revenue. Assignée, échouée ou
    // terminée : l'attente est finie, dans un sens ou dans l'autre.
    if (statutDe(relecture) !== 'ready') continue;
    const production = texte(e.payload.taskId);
    const relecteur = texte(e.payload.relecteur);
    if (!production || !relecteur) continue;
    alertes.push({
      genre: 'blocage',
      cause: 'relecteur_absent',
      taskId: production,
      titre: titreDe(production),
      relecteur,
      depuis: e.ts,
      delaiMs: entierPositif(e.payload.delaiMs),
    });
  }

  for (const solde of entree.soldes) {
    if (!solde.bloque) continue;
    alertes.push({
      genre: 'budget',
      projectId: solde.projectId,
      projet: entree.nomsDeProjets.get(solde.projectId) ?? null,
      depenseMs: solde.depenseMs,
      plafondMs: solde.plafondMs,
      depuis: plafonds.get(solde.projectId) ?? null,
    });
  }

  for (const [taskId, e] of impossibles) {
    const resultId = entierPositif(e.payload.resultId);
    const cause = texte(e.payload.cause);
    if (resultId === null || cause === null) continue;
    if (!entree.relectureEnSuspens(taskId, resultId)) continue;
    alertes.push({
      genre: 'relecture_impossible',
      taskId,
      titre: titreDe(taskId),
      cause: cause.slice(0, 300),
      depuis: e.ts,
    });
  }

  for (const [taskId, e] of dernierDeTache) {
    if (e.type === 'task_rejected') {
      if (e.payload.infra !== true || statutDe(taskId) !== 'ready') continue;
      const nodeId = texte(e.payload.nodeId);
      if (!nodeId) continue;
      alertes.push({
        genre: 'refus',
        taskId,
        titre: titreDe(taskId),
        nodeId,
        raison: (texte(e.payload.reason) ?? '?').slice(0, 200),
        depuis: e.ts,
        definitif: false,
        avantAgent: e.payload.avantAgent === true,
      });
    } else if (e.type === 'task_failed' && e.payload.reason === 'no_working_agent') {
      // Relancée (de nouveau prête, puis affectée) : ce n'est plus son état.
      if (statutDe(taskId) !== 'failed') continue;
      const refus = dernierRefusInfra.get(taskId);
      alertes.push({
        genre: 'refus',
        taskId,
        titre: titreDe(taskId),
        nodeId: refus ? texte(refus.payload.nodeId) : null,
        raison: ((refus && texte(refus.payload.reason)) ?? '?').slice(0, 200),
        depuis: e.ts,
        definitif: true,
        avantAgent: refus?.payload.avantAgent === true,
      });
    }
  }

  const rang = (a: AlerteCockpit): number => ORDRE_GENRES.indexOf(a.genre);
  const triees = alertes.sort((a, b) => rang(a) - rang(b) || (a.depuis ?? 0) - (b.depuis ?? 0));
  return { alertes: triees.slice(0, ALERTES_MAX), total: triees.length };
}
