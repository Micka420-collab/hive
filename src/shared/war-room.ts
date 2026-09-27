// La War Room — là où les IA se contredisent, relue dans le journal.
//
// ─── CE QUE CE MODULE EST, ET CE QU'IL N'EST PAS ─────────────────────────────
//
// Ce n'est PAS un second moteur de décision. Le Conseil des Éclaireuses
// délibère (conseil.ts), la contre-expertise relit (contre-expertise.ts),
// l'Evaluator renvoie en correction (scheduler.retryFromEvaluator), l'humain
// revoit (Miellerie) — et chacun CONSIGNE déjà ce qu'il a fait dans le
// journal. Ce qui manquait, c'est l'endroit où ces faits se lisent ENSEMBLE :
// un débat de code dispersé entre quatre écrans n'est lu par personne.
//
// Ce module replie donc des événements EXISTANTS en un fil typé, sans rien
// recalculer. Il n'y ajoute qu'UN fait, et c'est un geste humain :
// `council_decided`, la décision qu'une personne prend sur un Conseil clos
// (« il propose, vous tranchez » — jusque-là, rien ne rangeait le « vous
// tranchez »).
//
// Trois règles de lecture, celles de `routage-vue.ts` :
//   · un payload illisible est IGNORÉ, jamais deviné — le journal est une
//     trace, pas une zone de confiance ;
//   · une valeur absente reste absente (`null`), jamais un zéro inventé ;
//   · le texte venu d'un agent est re-borné ici même, parce qu'une ligne du
//     journal n'a pas à être crue sur sa longueur.
//
// Module PUR : aucune I/O, aucune horloge. Le serveur choisit les événements
// (types, projet, tâche) et joint les titres ; l'écran rend.

import type { SourceCritique } from '../orchestrator/brood.js';
import type { Issue as IssueConseil } from '../orchestrator/conseil.js';
import type { EvaluationRetryOutcome } from '../orchestrator/scheduler.js';
import type { HiveEvent } from './types.js';

export type { IssueConseil, SourceCritique };

/** Pourquoi `retryFromEvaluator` a refusé de renvoyer en correction. */
export type RaisonRefusRenvoi = Extract<EvaluationRetryOutcome, { ok: false }>['reason'];

/**
 * Les types d'événements que la War Room lit — et rien d'autre.
 *
 * `task_retry` y figure pour SES renvois d'Evaluator seulement
 * (`source: 'evaluator'`) : une reprise après panne de Worker n'est pas un
 * désaccord, c'est une machine qui a toussé. Le filtre est dans `lireEntree`.
 */
export const TYPES_WAR_ROOM = [
  'council_opened',
  'council_proposal',
  'council_review',
  'council_round',
  'council_closed',
  'council_decided',
  'contre_expertise',
  'contre_expertise_verdict',
  'contre_expertise_review_failed',
  'contre_expertise_impossible',
  'task_retry',
  'evaluator_retry_skipped',
  'evaluator_overridden',
  'task_reviewed',
] as const;

/** Longueur maximale d'une justification humaine, au serveur comme à l'écran. */
export const JUSTIFICATION_MAX = 1000;

/**
 * Longueur maximale de la raison d'une revue humaine (`task_reviewed`) — la
 * borne du corps de `POST /api/tasks/:taskId/review`, relue ici : une raison
 * rangée par une version antérieure n'a pas à être crue sur sa longueur.
 */
export const RAISON_REVUE_MAX = 1000;

/**
 * Qui a tranché. Fermé à deux cas, et le second est un AVEU, pas un défaut :
 * le jeton de ruche est partagé par toutes les machines membres, il ne
 * désigne personne. L'écrire « opérateur » ou le taire ferait passer une
 * décision anonyme pour une décision signée.
 */
export type AuteurDecision =
  { genre: 'compte'; userId: string; nom: string | null } | { genre: 'jeton_de_ruche' };

interface Base {
  /** Id de l'événement : ordre total du journal, et clé des renvois. */
  id: number;
  ts: number;
}

export type EntreeWarRoom =
  | (Base & { genre: 'conseil_ouvert'; sessionId: string })
  | (Base & {
      genre: 'conseil_proposition';
      sessionId: string;
      propositionId: string;
      nodeId: string;
      tour: number;
    })
  | (Base & {
      genre: 'conseil_avis';
      sessionId: string;
      propositionId: string;
      nodeId: string;
      avis: 'soutien' | 'arret';
      tour: number;
    })
  | (Base & { genre: 'conseil_tour'; sessionId: string; tour: number; taches: number })
  | (Base & {
      genre: 'conseil_clos';
      sessionId: string;
      issue: IssueConseil;
      /** Proposition retenue par le quorum, `null` sans convergence. */
      retenue: string | null;
    })
  | (Base & {
      genre: 'conseil_decide';
      sessionId: string;
      projectId: string | null;
      /** `null` = l'humain ne retient AUCUNE piste — c'est une décision aussi. */
      propositionId: string | null;
      /** Titre de la piste, FIGÉ à la décision : les propositions s'élaguent avec leur session. */
      titre: string | null;
      justification: string;
      par: AuteurDecision;
      /** Id de la décision que celle-ci remplace, `null` pour une première décision. */
      remplace: number | null;
    })
  | (Base & {
      genre: 'contre_expertise';
      taskId: string;
      resultId: number | null;
      /** `false` = aucun second modèle n'a pu relire : une information, pas un silence. */
      possible: boolean;
      relecteurs: string[];
      motif: string | null;
    })
  | (Base & {
      genre: 'contre_verdict';
      taskId: string;
      resultId: number | null;
      relecteur: string;
      conteste: boolean;
      objections: string[];
    })
  | (Base & {
      genre: 'contre_echec';
      taskId: string;
      resultId: number | null;
      relecteur: string;
      /** La relecture a épuisé ses essais : cet avis ne viendra jamais. */
      terminal: boolean;
    })
  | (Base & {
      genre: 'contre_impossible';
      taskId: string;
      resultId: number | null;
      /** La famille dont la relecture est tombée la dernière, `null` si illisible. */
      relecteur: string | null;
      /** Pourquoi personne d'autre ne relira : ce que l'Evaluator cite à l'humain. */
      cause: string;
    })
  | (Base & {
      genre: 'renvoi_evaluator';
      taskId: string;
      resultId: number | null;
      decision: string;
      tentative: number | null;
      maxTentatives: number | null;
      /**
       * Qui a demandé la correction — la `source` de la critique figée (#488).
       * `null` : pas de critique jointe (rien à transmettre), ou un journal
       * antérieur qui ne le disait pas.
       */
      demandePar: SourceCritique | null;
    })
  | (Base & {
      genre: 'renvoi_refuse';
      taskId: string;
      resultId: number | null;
      /** Un code de `RaisonRefusRenvoi` — ou celui, inconnu, d'une Reine plus récente. */
      raison: string;
      /**
       * Le geste dont le renvoi a été refusé : la contre-revue qui contestait,
       * ou le rejet humain. `null` : journal antérieur à ce champ — inconnu,
       * et lu comme avant (une contestation).
       */
      source: SourceCritique | null;
    })
  | (Base & {
      genre: 'evaluator_force';
      taskId: string;
      resultId: number | null;
      /** Le geste qui est passé outre : `livraison`, `fusion`, `livraison_locale`. */
      geste: string;
      /** Le verdict bloquant ignoré, `null` quand l'Evaluator n'en avait aucun. */
      decision: string | null;
      raison: string;
      par: AuteurDecision;
    })
  | (Base & {
      genre: 'revue_humaine';
      taskId: string;
      etat: 'approved' | 'rejected' | null;
      /** Ce que l'humain a écrit avec son verdict, `null` sans raison. */
      raison: string | null;
    });

export type GenreEntree = EntreeWarRoom['genre'];

/** La décision humaine sur un Conseil : l'entrée `conseil_decide`, telle quelle. */
export type DecisionConseil = Extract<EntreeWarRoom, { genre: 'conseil_decide' }>;

// ─── Lecture défensive ────────────────────────────────────────────────────────

const texte = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
const entier = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
/** Un identifiant du journal ou des résultats : entier strictement positif. */
const idPositif = (v: unknown): number | null => {
  const n = entier(v);
  return n !== null && n > 0 ? n : null;
};
const textes = (v: unknown, max: number, nombreMax: number): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => texte(x, max))
        .filter((x): x is string => x !== null)
        .slice(0, nombreMax)
    : [];

/**
 * Les issues du Conseil, EXHAUSTIVES par construction : un `Record` sur
 * l'union refuse à la compilation une issue ajoutée au protocole et oubliée
 * ici — elle serait sinon lue comme un payload illisible, et un conseil clos
 * disparaîtrait du fil.
 */
const ISSUES: Record<IssueConseil, true> = {
  quorum: true,
  depart: true,
  sans_quorum: true,
  epuise: true,
  vide: true,
};
const issueDe = (v: unknown): IssueConseil | null =>
  typeof v === 'string' && Object.hasOwn(ISSUES, v) ? (v as IssueConseil) : null;

/** Toutes les issues d'un Conseil — ce que `docs/PROTOCOLE-DEBAT.md` doit toutes nommer. */
export const ISSUES_CONSEIL = Object.keys(ISSUES) as readonly IssueConseil[];

/**
 * Tous les refus de `retryFromEvaluator`, exhaustifs par construction comme
 * `ISSUES` : un refus ajouté au scheduler sans être rangé ici ne compile pas,
 * et `tests/protocole-debat.test.ts` exige que le protocole publié le nomme.
 */
const REFUS_RENVOI: Record<RaisonRefusRenvoi, true> = {
  unknown_task: true,
  task_not_done: true,
  invalid_result_id: true,
  stale_result: true,
  dependent_progressed: true,
  ancestor_failed: true,
  delivery_exists: true,
  attempts_exhausted: true,
};
export const RAISONS_REFUS_RENVOI = Object.keys(REFUS_RENVOI) as readonly RaisonRefusRenvoi[];

/** Les sources de critique, exhaustives par construction (même raison que `ISSUES`). */
const SOURCES: Record<SourceCritique, true> = {
  contre_revue: true,
  revue_humaine: true,
  evaluator: true,
};
const sourceDe = (v: unknown): SourceCritique | null =>
  typeof v === 'string' && Object.hasOwn(SOURCES, v) ? (v as SourceCritique) : null;

function auteurDe(v: unknown): AuteurDecision | null {
  if (typeof v !== 'object' || v === null) return null;
  const a = v as Record<string, unknown>;
  if (a.genre === 'jeton_de_ruche') return { genre: 'jeton_de_ruche' };
  if (a.genre !== 'compte') return null;
  const userId = texte(a.userId, 128);
  return userId === null ? null : { genre: 'compte', userId, nom: texte(a.nom, 120) };
}

/** Une ligne du journal, lue — ou `null` si elle ne dit rien de lisible. */
function lireEntree(e: HiveEvent): EntreeWarRoom | null {
  const p = e.payload;
  const base = { id: e.id, ts: e.ts };
  const sessionId = texte(p.sessionId, 128);
  const taskId = texte(p.taskId, 128);
  switch (e.type) {
    case 'council_opened':
      return sessionId ? { ...base, genre: 'conseil_ouvert', sessionId } : null;
    case 'council_proposal': {
      const propositionId = texte(p.propositionId, 128);
      const nodeId = texte(p.nodeId, 128);
      const tour = entier(p.tour);
      if (!sessionId || !propositionId || !nodeId || tour === null) return null;
      return { ...base, genre: 'conseil_proposition', sessionId, propositionId, nodeId, tour };
    }
    case 'council_review': {
      const propositionId = texte(p.propositionId, 128);
      const nodeId = texte(p.nodeId, 128);
      const tour = entier(p.tour);
      const avis = p.type === 'soutien' || p.type === 'arret' ? p.type : null;
      if (!sessionId || !propositionId || !nodeId || tour === null || !avis) return null;
      return { ...base, genre: 'conseil_avis', sessionId, propositionId, nodeId, avis, tour };
    }
    case 'council_round': {
      const tour = entier(p.tour);
      const taches = entier(p.taches);
      if (!sessionId || tour === null || taches === null) return null;
      return { ...base, genre: 'conseil_tour', sessionId, tour, taches };
    }
    case 'council_closed': {
      const issue = issueDe(p.issue);
      if (!sessionId || !issue) return null;
      return {
        ...base,
        genre: 'conseil_clos',
        sessionId,
        issue,
        retenue: texte(p.retenue, 128),
      };
    }
    case 'council_decided': {
      const justification = texte(p.justification, JUSTIFICATION_MAX);
      const par = auteurDe(p.par);
      // `propositionId: null` est une décision (« aucune piste ») ; une clé
      // ABSENTE ou d'un autre type est une ligne illisible — les confondre
      // ferait lire « rien retenu » là où l'on ne sait pas ce qui l'a été.
      const propositionId = p.propositionId === null ? null : texte(p.propositionId, 128);
      if (!sessionId || !justification || !par) return null;
      if (propositionId === null && p.propositionId !== null) return null;
      return {
        ...base,
        genre: 'conseil_decide',
        sessionId,
        projectId: texte(p.projectId, 128),
        propositionId,
        titre: propositionId === null ? null : texte(p.titre, 300),
        justification,
        par,
        remplace: idPositif(p.remplace),
      };
    }
    case 'contre_expertise': {
      if (!taskId || typeof p.possible !== 'boolean') return null;
      return {
        ...base,
        genre: 'contre_expertise',
        taskId,
        resultId: idPositif(p.resultId),
        possible: p.possible,
        relecteurs: textes(p.relecteurs, 120, 10),
        motif: texte(p.motif, 300),
      };
    }
    case 'contre_expertise_verdict': {
      const relecteur = texte(p.relecteur, 120);
      if (!taskId || !relecteur || typeof p.conteste !== 'boolean') return null;
      return {
        ...base,
        genre: 'contre_verdict',
        taskId,
        resultId: idPositif(p.resultId),
        relecteur,
        conteste: p.conteste,
        objections: textes(p.objections, 300, 5),
      };
    }
    case 'contre_expertise_review_failed': {
      const relecteur = texte(p.relecteur, 120);
      if (!taskId || !relecteur) return null;
      return {
        ...base,
        genre: 'contre_echec',
        taskId,
        resultId: idPositif(p.resultId),
        relecteur,
        terminal: p.terminal === true,
      };
    }
    case 'contre_expertise_impossible': {
      // Sans cause, l'impossibilité ne dit rien à l'humain qu'elle appelle :
      // l'Evaluator lui-même ne la cite pas (`contreRevueImpossible`).
      const cause = texte(p.cause, 500);
      if (!taskId || !cause) return null;
      return {
        ...base,
        genre: 'contre_impossible',
        taskId,
        resultId: idPositif(p.resultId),
        relecteur: texte(p.relecteur, 120),
        cause,
      };
    }
    case 'task_retry': {
      // Les reprises après panne de Worker partagent ce type : elles ne sont
      // pas un désaccord, et la War Room ne les montre pas.
      if (p.source !== 'evaluator') return null;
      const decision = texte(p.decision, 60);
      if (!taskId || !decision) return null;
      const critique = p.critique;
      return {
        ...base,
        genre: 'renvoi_evaluator',
        taskId,
        resultId: idPositif(p.resultId),
        decision,
        tentative: entier(p.attempt),
        maxTentatives: entier(p.maxAttempts),
        demandePar:
          typeof critique === 'object' && critique !== null
            ? sourceDe((critique as Record<string, unknown>).source)
            : null,
      };
    }
    case 'evaluator_retry_skipped': {
      const raison = texte(p.reason, 60);
      if (!taskId || !raison) return null;
      return {
        ...base,
        genre: 'renvoi_refuse',
        taskId,
        resultId: idPositif(p.resultId),
        raison,
        source: sourceDe(p.source),
      };
    }
    case 'evaluator_overridden': {
      // Le forçage est TOUJOURS motivé (schéma `SCHEMA_FORCER`) : sans raison
      // lisible, la ligne ne dit plus ce qui a été décidé.
      const geste = texte(p.geste, 40);
      const raison = texte(p.raison, 500);
      if (!taskId || !geste || !raison) return null;
      const userId = texte(p.parUserId, 128);
      return {
        ...base,
        genre: 'evaluator_force',
        taskId,
        resultId: idPositif(p.resultId),
        geste,
        decision: texte(p.decision, 60),
        raison,
        // `parUserId: null` est l'AVEU du jeton de ruche (`passageEvaluator`) ;
        // le nom n'est pas figé au geste, le serveur le joint à la lecture.
        par: userId === null ? { genre: 'jeton_de_ruche' } : { genre: 'compte', userId, nom: null },
      };
    }
    case 'task_reviewed': {
      // `state: null` est un geste (la revue est effacée) : lisible, et gardé.
      const etat = p.state;
      if (!taskId || (etat !== null && etat !== 'approved' && etat !== 'rejected')) return null;
      return {
        ...base,
        genre: 'revue_humaine',
        taskId,
        etat,
        raison: etat === null ? null : texte(p.raison, RAISON_REVUE_MAX),
      };
    }
    default:
      return null;
  }
}

/** Le fil, du plus ancien au plus récent (ordre du journal, pas des horloges). */
export function entreesWarRoom(evenements: readonly HiveEvent[]): EntreeWarRoom[] {
  const entrees: EntreeWarRoom[] = [];
  for (const e of [...evenements].sort((a, b) => a.id - b.id)) {
    const entree = lireEntree(e);
    if (entree) entrees.push(entree);
  }
  return entrees;
}

// ─── Les familles du fil : ce que le filtre de l'écran sépare ─────────────────

/**
 * Qui PARLE dans une entrée. Quatre voix, et la dernière est la seule qui
 * décide : le Conseil délibère, la contre-expertise relit, l'Evaluator renvoie
 * (ou ne peut pas), l'humain tranche. Le filtre de la War Room les sépare pour
 * qu'on puisse relire, par exemple, toutes les décisions humaines d'un projet
 * sans les chercher entre deux cents lignes de relectures.
 */
export const FAMILLES_WAR_ROOM = ['conseil', 'relecture', 'evaluator', 'humain'] as const;
export type FamilleWarRoom = (typeof FAMILLES_WAR_ROOM)[number];

/**
 * EXHAUSTIF par construction : un genre ajouté au fil sans famille ne compile
 * pas — il disparaîtrait sinon de chaque filtre, et ne se verrait qu'en « tout ».
 */
const FAMILLE_DU_GENRE: Record<GenreEntree, FamilleWarRoom> = {
  conseil_ouvert: 'conseil',
  conseil_proposition: 'conseil',
  conseil_avis: 'conseil',
  conseil_tour: 'conseil',
  conseil_clos: 'conseil',
  contre_expertise: 'relecture',
  contre_verdict: 'relecture',
  contre_echec: 'relecture',
  contre_impossible: 'relecture',
  renvoi_evaluator: 'evaluator',
  renvoi_refuse: 'evaluator',
  conseil_decide: 'humain',
  revue_humaine: 'humain',
  evaluator_force: 'humain',
};

export const familleDe = (e: EntreeWarRoom): FamilleWarRoom => FAMILLE_DU_GENRE[e.genre];

/** Ce dont parle une entrée : une tâche, ou une session de Conseil. */
export function sujetDe(
  e: EntreeWarRoom,
): { genre: 'tache'; taskId: string } | { genre: 'conseil'; sessionId: string } {
  return 'taskId' in e
    ? { genre: 'tache', taskId: e.taskId }
    : { genre: 'conseil', sessionId: e.sessionId };
}

/**
 * La décision COURANTE de chaque Conseil : la plus récente fait foi, et les
 * précédentes restent au fil — revenir sur une décision se voit.
 */
export function dernieresDecisions(
  entrees: readonly EntreeWarRoom[],
): Map<string, DecisionConseil> {
  const decisions = new Map<string, DecisionConseil>();
  for (const e of entrees) if (e.genre === 'conseil_decide') decisions.set(e.sessionId, e);
  return decisions;
}

// ─── Les désaccords que personne n'a tranchés ─────────────────────────────────

/**
 * Issues de Conseil qui ont DÉBATTU sans converger. `depart` (égalité au
 * quorum) et `epuise` (plafond de tours) sont les deux cas nommés ; un conseil
 * clos `sans_quorum` (plus rien à vérifier, rien de convergé) l'est au même
 * titre. `vide` n'en est pas un — personne n'a rien rapporté, il n'y a rien à
 * départager — et `quorum` a une recommandation.
 */
export const ISSUES_A_TRANCHER: ReadonlySet<IssueConseil> = new Set<IssueConseil>([
  'depart',
  'epuise',
  'sans_quorum',
]);

/**
 * Renvois refusés qui laissent une production CONTESTÉE en place.
 *
 * `evaluator_retry_skipped` suit deux gestes, que sa `source` distingue : une
 * contre-revue qui demande une amélioration (`relancerSiContreRevueInsuffisante`)
 * et un rejet humain en Miellerie. Seul le premier ouvre un désaccord : trois
 * refus laissent alors l'objection sans suite — les essais sont épuisés, la
 * production est déjà livrée, ou des dépendantes ont déjà bâti dessus. Les
 * autres (`stale_result`, `task_not_done`…) disent que la production
 * contestée n'est plus celle qui compte — la contestation est caduque, pas
 * pendante.
 *
 * Un rejet HUMAIN dont le renvoi est refusé n'attend personne : l'humain a
 * déjà tranché (rejeté), et le fil dit que la correction n'a pas suivi. Le
 * compter « à trancher » le laisserait en tête pour toujours — ni approuver
 * contre son propre avis, ni rejeter à nouveau (même refus) ne le lèverait.
 * Un refus SANS source (journal antérieur à ce champ) reste lu comme avant :
 * inconnu, donc montré plutôt que tu.
 */
export const RAISONS_EN_SUSPENS: ReadonlySet<RaisonRefusRenvoi> = new Set<RaisonRefusRenvoi>([
  'attempts_exhausted',
  'delivery_exists',
  'dependent_progressed',
]);

const ouvreUnDesaccord = (e: Extract<EntreeWarRoom, { genre: 'renvoi_refuse' }>): boolean =>
  e.source !== 'revue_humaine' && (RAISONS_EN_SUSPENS as ReadonlySet<string>).has(e.raison);

export type Desaccord =
  | {
      genre: 'conseil';
      sessionId: string;
      issue: IssueConseil;
      /** Clôture du conseil : le désaccord attend depuis cet instant. */
      depuis: number;
    }
  | {
      genre: 'tache';
      taskId: string;
      resultId: number | null;
      raison: string;
      /** Les objections des relecteurs sur CE résultat, bornées. */
      objections: string[];
      depuis: number;
    }
  | {
      /**
       * Aucune famille n'a pu relire CE résultat, secours compris (#484) :
       * l'Evaluator répond `human_review_required` en citant `cause`. Ce
       * n'est pas un désaccord entre IA — c'est l'arbitre qui manque, et
       * seul un humain peut le remplacer.
       */
      genre: 'relecture_impossible';
      taskId: string;
      resultId: number | null;
      cause: string;
      depuis: number;
    };

/**
 * Ce que la Reine a RANGÉ d'une tâche, hors du journal — donc à l'abri de son
 * élagage. Le refus de renvoi qui ouvre une contestation est gardé par
 * `pruneEvents` tant que sa tâche existe ; la revue humaine ou le nouvel essai
 * qui l'ont levée, eux, peuvent être sortis du journal. Sans ces faits rangés,
 * une contestation tranchée il y a une semaine redeviendrait « à trancher ».
 */
export interface TacheRangee {
  /** Dernier résultat rangé de la tâche, `null` sans résultat. */
  dernierResultId: number | null;
  /** Instant du verdict humain courant (Miellerie), `null` sans verdict. */
  revueA: number | null;
}

/** Une session telle que le serveur la range — le strict nécessaire. */
export interface SessionPourDesaccord {
  id: string;
  etat: string;
  issue: string | null;
  closedAt: number | null;
}

/**
 * Les désaccords en suspens, du plus ancien au plus récent : celui qui attend
 * depuis le plus longtemps d'abord.
 *
 * Un Conseil est tranché dès qu'une décision humaine existe — quelle qu'elle
 * soit, « aucune piste » comprise. Une contestation de tâche est levée par une
 * revue humaine qui pose un verdict (approuver OU rejeter, c'est trancher), ou
 * rendue caduque par un nouvel essai : un renvoi de l'Evaluator, ou une
 * nouvelle contre-expertise, qui porte sur une production plus récente. Une
 * relecture impossible se lève de même : c'est la revue humaine qu'elle
 * demande.
 *
 * `decisions` vient par défaut du fil lui-même ; le serveur les passe lues À
 * PART (`council_decided` seul). La fenêtre de lecture du fil est bornée : la
 * décision d'un vieux conseil encore rangé peut en être sortie, et ce conseil
 * redeviendrait « à trancher » alors que quelqu'un l'a tranché.
 *
 * `tacheRangee` applique la même règle aux faits RANGÉS, pour la même raison
 * (voir `TacheRangee`) : un verdict humain posé APRÈS le refus tranche, un
 * résultat plus récent que la production contestée la rend caduque. Et une
 * tâche que la Reine ne connaît plus (`null`) n'attend plus personne : la
 * Miellerie refuserait de la revoir, le désaccord ne se trancherait jamais.
 * Sans elle (module pur éprouvé seul), le fil seul fait foi.
 */
export function desaccordsNonResolus(
  entrees: readonly EntreeWarRoom[],
  sessions: readonly SessionPourDesaccord[],
  decisions: ReadonlyMap<string, DecisionConseil> = dernieresDecisions(entrees),
  tacheRangee?: (taskId: string) => TacheRangee | null,
): Desaccord[] {
  const desaccords: Desaccord[] = [];

  for (const s of sessions) {
    const issue = issueDe(s.issue);
    if (s.etat !== 'clos' || s.closedAt === null || !issue || !ISSUES_A_TRANCHER.has(issue)) {
      continue;
    }
    if (decisions.has(s.id)) continue;
    desaccords.push({ genre: 'conseil', sessionId: s.id, issue, depuis: s.closedAt });
  }

  // Par tâche, LE fait en attente le plus récent : un refus de renvoi ou une
  // relecture impossible. Ce qui lève l'un lève l'autre — un verdict humain,
  // un nouvel essai — parce que tous deux attendent la même personne devant
  // la même production.
  type Attente = Extract<EntreeWarRoom, { genre: 'renvoi_refuse' | 'contre_impossible' }>;
  const enSuspens = new Map<string, Attente>();
  for (const e of entrees) {
    if (e.genre === 'renvoi_refuse' && ouvreUnDesaccord(e)) enSuspens.set(e.taskId, e);
    else if (e.genre === 'contre_impossible') enSuspens.set(e.taskId, e);
    else if (e.genre === 'revue_humaine' && e.etat !== null) enSuspens.delete(e.taskId);
    else if (e.genre === 'renvoi_evaluator' || e.genre === 'contre_expertise') {
      enSuspens.delete(e.taskId);
    }
  }
  for (const attente of enSuspens.values()) {
    if (attente.genre === 'contre_impossible') {
      if (tacheRangee) {
        const rangee = tacheRangee(attente.taskId);
        if (!rangee) continue;
        // Ici N'IMPORTE QUEL verdict courant tranche, même posé pendant que la
        // relecture était encore en vol : c'est exactement la revue humaine que
        // l'Evaluator demande, et un renvoi l'aurait effacée (`retryFromEvaluator`).
        if (rangee.revueA !== null) continue;
        if (
          attente.resultId !== null &&
          rangee.dernierResultId !== null &&
          rangee.dernierResultId !== attente.resultId
        ) {
          continue;
        }
      }
      desaccords.push({
        genre: 'relecture_impossible',
        taskId: attente.taskId,
        resultId: attente.resultId,
        cause: attente.cause,
        depuis: attente.ts,
      });
      continue;
    }
    const refus = attente;
    if (tacheRangee) {
      const rangee = tacheRangee(refus.taskId);
      if (!rangee) continue;
      // Strictement APRÈS : à la milliseconde près, le fil (ordonné par id)
      // tranche déjà les cas frais ; ici on ne lève que ce qui est sûr.
      if (rangee.revueA !== null && rangee.revueA > refus.ts) continue;
      if (
        refus.resultId !== null &&
        rangee.dernierResultId !== null &&
        rangee.dernierResultId !== refus.resultId
      ) {
        continue;
      }
    }
    const objections = new Set<string>();
    for (const e of entrees) {
      if (
        e.genre === 'contre_verdict' &&
        e.taskId === refus.taskId &&
        e.resultId === refus.resultId &&
        e.conteste
      ) {
        for (const o of e.objections) objections.add(o);
      }
    }
    desaccords.push({
      genre: 'tache',
      taskId: refus.taskId,
      resultId: refus.resultId,
      raison: refus.raison,
      objections: [...objections].slice(0, 3),
      depuis: refus.ts,
    });
  }

  return desaccords.sort((a, b) => a.depuis - b.depuis);
}
