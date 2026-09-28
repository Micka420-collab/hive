// Le cœur de la ruche : promotion des tâches selon leurs dépendances,
// assignation aux nœuds disponibles, reap des nœuds morts, retries et
// idempotence des résultats. Aucune I/O réseau ici — tout est testable
// unitairement avec un store en mémoire.

import { MAX_ATTEMPTS, NODE_TIMEOUT_MS } from '../shared/types.js';
import type { HiveEvent, HiveNode, SubAgent, Task, TaskResult } from '../shared/types.js';
import type { PresenceFichier } from '../shared/presence.js';
import { VALIDATION_KEYS } from '../shared/validations-bac.js';
import type {
  DetailControle,
  ValidationKey,
  ValidationState,
  ValidationsBac,
} from '../shared/validations-bac.js';
// L'Aiguillage appris : parmi les nœuds éligibles à charge, restreindre à ceux
// qui offrent le meilleur modèle pour le genre de la tâche. Module PUR — il ne
// lit ni n'écrit rien ; le scheduler lui donne les antécédents et enregistre le
// modèle choisi. Absence de modèles déclarés ⇒ `null` ⇒ aucun changement.
import {
  VERSION_AIGUILLAGE,
  aiguillerNoeuds,
  antecedentsDuVecu,
  categoriser,
  repriseHorsEchecs,
} from './aiguillage.js';
import type { Antecedent, Rang } from './aiguillage.js';
// L'Agent Garde-Fous : élire, PAR PROJET opt-in, l'échelon de garde-fous et
// gouverner la sévérité des Gardiennes de la production. Module PUR — le scheduler
// lui donne les antécédents et pose l'échelon élu. Projet non opt-in ⇒ repli sur
// le mode global (rien ne change).
import {
  REGLAGES,
  classerEchelons,
  echelonsPermis,
  elireEchelon,
  observationDepuisFaits,
  replierAntecedentsGardeFou,
  versEchelon,
} from './garde-fou.js';
import type { Echelon, ObservationGardeFou, RangGardeFou } from './garde-fou.js';
// La Balance n'entre JAMAIS dans le choix du nœud (doctrine, règle 4) : seuls
// le grand livre (comptage additif) et son cache de projets sont importés ici.
// Aucun symbole d'IMPUTATION (`peserLaRuche`, `Pesee`, `Compte`…) ne doit
// jamais apparaître dans ce fichier — verrouillé par
// tests/security-invariants.test.ts.
import { CacheProjets, GrandLivre, jugerPlafond, LOT_GRAND_LIVRE } from './balance.js';
import type { DecisionPlafond } from './balance.js';
import { bornerCritique } from './brood.js';
import type { CritiqueReprise } from './brood.js';
import {
  ancetreEchoue,
  budgetCoutEpuise,
  descendantsEnVol,
  direDepense,
  slotsOccupes,
} from './delegation.js';
import type { CauseAnnulationDelegation } from './delegation.js';
import { offreSousConsigne } from '../shared/consigne-routage.js';
import { LIMITES_DELEGATION_DEFAUT } from '../shared/limites-delegation.js';
import { createRace, enlistDrones, recordDroneResult, runningDrones } from './drone-wars.js';
import type { DroneRace } from './drone-wars.js';
import { inspecter } from './gardiennes.js';
import type { Inspection, ModeGardiennes } from './gardiennes.js';
import { summarizeTask } from './hive-mind.js';
import { CacheDomaines, meilleurNoeud, replierTraces } from './pheromones.js';
import type { Domaine, TraceePheromone } from './pheromones.js';
import { analyzePair } from './sting-detector.js';
import type { HiveStore, NodeProfile } from './store.js';
import { assignationProductionAutorisee } from '../shared/agent-production.js';
import { relecteurIndependant } from '../shared/contre-expertise.js';
import { concurrenceEffective, lireTemperature, FENETRE_MS, TYPES_THERMO } from './thermo.js';
import type { BandeThermo } from './thermo.js';

/** Délai pendant lequel un nœud qui vient de refuser une tâche ne la reçoit pas de nouveau. */
const REJECT_COOLDOWN_MS = 3_000;

/**
 * Intervalle minimal entre deux écritures du cache du grand livre. Un cache en
 * retard n'est JAMAIS faux : il fait seulement relire quelques lots de plus au
 * prochain démarrage. On paie donc une petite transaction toutes les 10 s, et
 * pas une par tick.
 */
const INTERVALLE_SAUVEGARDE_LIVRE_MS = 10_000;

/**
 * Hystérésis : nombre de ticks CONSÉCUTIFS passés hors de la bande courante
 * avant de changer de régime. On compte les ticks divergents, pas les lectures
 * identiques : deux bandes divergentes en alternance (chaude, surchauffe,
 * chaude…) ne confirmaient jamais rien et la ruche restait froide.
 */
const TICKS_CONFIRMATION_THERMO = 2;

/**
 * Combien de temps une contre-expertise attend une famille relectrice ABSENTE
 * — aucun nœud de cette famille en ligne — avant d'échouer, dite.
 *
 * Une relecture ne part qu'à SA famille (voir `assignReadyTasks`). Sans borne,
 * une famille disparue pour de bon — ouvrière ajoutée tombée, redémarrage en
 * `--une-ouvriere` ou avec `HIVE_AGENT`, CLI désinstallé — laissait la
 * relecture prête à jamais : aucun événement, une contre-revue « en vol »
 * pour toujours, et personne pour dire pourquoi.
 *
 * Cinq minutes, et pas `NODE_TIMEOUT_MS` (15 s) : le compteur part du PREMIER
 * constat de CE processus, donc d'un redémarrage de la ruche au plus tôt, et
 * une ouvrière met plus de 15 s à revenir sur une machine chargée — sondes
 * `--version` à 4 s par agent comprises. Échouer une relecture parce que son
 * relecteur redémarrait, c'est perdre un avis qui serait arrivé.
 */
export const ATTENTE_RELECTEUR_ABSENT_MS = 5 * 60_000;

/** Le lien d'une tâche de relecture vers ce qu'elle juge (`contre_expertises`). */
type LienRelecture = NonNullable<ReturnType<HiveStore['relectureDe']>>;

export interface SchedulerOptions {
  maxAttempts?: number;
  nodeTimeoutMs?: number;
  /** Mode démo : autorise l'assignation aux nœuds shell/simulation. */
  simulation?: boolean;
  /** Appelé quand une tâche est assignée — le serveur pousse alors `assign_task` au nœud. */
  onAssign?: (nodeId: string, task: Task, modele?: string) => void;
  /** Appelé pour annuler le travail d'un nœud (drone perdant) — le serveur envoie `cancel_task`. */
  onCancel?: (nodeId: string, taskId: string, reason: string) => void;
  /** Appelé pour chaque événement journalisé — le serveur le diffuse au dashboard. */
  onEvent?: (event: HiveEvent) => void;
  /**
   * Un morceau de sortie EN DIRECT d'un nœud légitime pour cette tâche : le
   * serveur le relaie aux tableaux de bord, SANS le journaliser (voir
   * `TaskUpdateMsg.sortie`). Même autorité que le progrès journalisé : le
   * nœud assigné, ou un drone encore en course.
   */
  onSortie?: (taskId: string, nodeId: string, sortie: string) => void;
  /**
   * Balance : 'off' (le grand livre ne tourne pas du tout), 'observation'
   * (il pèse, se tient à jour et SIGNALE les franchissements, sans jamais rien
   * bloquer — défaut), 'strict' (au plafond, il cesse d'assigner de nouvelles
   * tâches du projet concerné).
   *
   * Le blocage est DOUBLEMENT opt-in : il faut `strict` ET un plafond posé à la
   * main sur le projet. Sans ligne `budgets`, les trois modes sont
   * rigoureusement indiscernables — c'est ce que prouve le harnais de rejeu de
   * tests/balance-wiring.test.ts.
   */
  balance?: {
    mode: 'off' | 'observation' | 'strict';
    /**
     * Capacité du cache `taskId → projectId` du grand livre. Réglage : la
     * valeur par défaut (CAPACITE_PROJETS, quelques dizaines de milliers) vaut
     * pour une ruche réelle ; l'abaisser sert à éprouver le comportement
     * SOUS-DIMENSIONNÉ, où le cache purge pendant qu'on résout — et où
     * l'ancienne implémentation perdait des dépenses définitivement.
     */
    capaciteCacheProjets?: number;
  };
  /**
   * En Cloud, le plafond lit l'horloge de l'hébergeur, jamais `durationMs`.
   * Community : inchangé (l'agent ne se vole que lui-même).
   */
  factureHorlogeHote?: boolean;
  /**
   * Les Gardiennes (le contrôle d'entrée du nectar) : 'off' (aucune inspection,
   * aucune écriture — la ruche est indiscernable de celle d'avant), 'consultatif'
   * (chaque production déclarée réussie est reniflée et le verdict RANGÉ, mais
   * RIEN n'est refusé et AUCUN événement n'est émis — DÉFAUT), 'strict' (une
   * production jugée creuse ne franchit pas le trou de vol).
   *
   * Le défaut est délibérément non contraignant : un faux positif brûlerait une
   * tentative légitime, ce qui est strictement pire que le mal qu'on soigne. On
   * observe et on annote longtemps avant de contraindre — et l'annotation, elle,
   * est gratuite et ne change RIEN au comportement observable (aucun événement,
   * aucune décision), ce que prouve le harnais de rejeu.
   */
  gardiennes?: { mode: ModeGardiennes };
}

export type EvaluationRetryDecision = 'correction_required' | 'rejected';

export type EvaluationRetryOutcome =
  | {
      ok: true;
      task: Task;
      resultId: number;
      attempt: number;
      maxAttempts: number;
    }
  | {
      ok: false;
      reason:
        | 'unknown_task'
        | 'task_not_done'
        | 'invalid_result_id'
        | 'stale_result'
        | 'dependent_progressed'
        | 'ancestor_failed'
        | 'root_cost_budget_exhausted'
        | 'delivery_exists'
        | 'attempts_exhausted';
      task?: Task;
    };

export class Scheduler {
  private readonly maxAttempts: number;
  private readonly nodeTimeoutMs: number;
  /** clé `taskId:nodeId` → timestamp d'expiration du cooldown de refus. */
  private readonly recentRejections = new Map<string, number>();
  /**
   * taskId → modèles qui ont ÉCHOUÉ sur cette tâche (plantage, délai, erreur du
   * CLI, refus d'infrastructure, production refusée par les Gardiennes) :
   * l'Aiguillage les écarte de ses reprises tant qu'un autre nœud de la ruche
   * porte la tâche (`repriseHorsEchecs`).
   *
   * Le pendant de `recentRejections` pour le MODÈLE : un modèle cassé, jamais
   * jugé donc à `+∞`, revenait en tête à chaque reprise — une tâche en file
   * n'est plus une élection en vol — et brûlait les trois tentatives de chaque
   * tâche de son genre. Décision produit : l'écart vaut pour CETTE tâche
   * seulement et n'entre JAMAIS dans les antécédents — un plantage n'est pas
   * un essai loyal ; la qualité s'apprend des contre-visites, comme avant.
   *
   * Une correction demandée par l'Evaluator ou par un humain rouvre une tâche
   * `done` : c'est une reprise comme une autre, l'écart tient donc jusque-là
   * — sauf pour le modèle qui a écrit la production retenue, réintégré
   * (`reintegrerModele`). Il n'est oublié qu'avec la tâche — échouée pour de
   * bon, annulée ou élaguée (`elaguerModelesEchoues`). En MÉMOIRE, comme les
   * courses : un redémarrage l'oublie, et coûte au pire une tentative de plus
   * sur le modèle déjà tombé, bornée par `maxAttempts`.
   */
  private readonly modelesEchoues = new Map<string, Set<string>>();
  /** Tâches actuellement différées pour cause de conflit (Sting Detector) — dédup des events. */
  private readonly deferredByConflict = new Set<string>();
  /**
   * Tâches qui attendent parce que la consigne de l'opérateur écarte tous les
   * nœuds en ligne qui pourraient les porter — dédup de
   * `task_consigne_deferred`, motif `deferredByConflict`. Sans ce fait, une
   * consigne qui épingle une famille absente laissait la tâche en file sans
   * que rien ne dise pourquoi. La valeur est la consigne SÉRIALISÉE qui a
   * différé la tâche : une consigne remplacée par une autre tout aussi
   * insatisfiable se journalise à son tour — sinon le journal donnait encore
   * l'ancienne pour raison.
   */
  private readonly differeesParConsigne = new Map<string, string>();
  /**
   * Relecture → instant du PREMIER constat que sa famille relectrice est
   * absente. Dédup de l'événement d'attente, et départ de
   * `ATTENTE_RELECTEUR_ABSENT_MS`. Élaguée à chaque passe : une entrée
   * survivant à une relecture sortie de la file ferait échouer sans délai
   * celle qui y revient.
   */
  private readonly relecturesSansRelecteur = new Map<string, number>();
  /** taskId → nombre de refus « infra » (token-failover) — borne les allers-retours. */
  private readonly infraRejects = new Map<string, number>();
  /**
   * Drone Wars : courses compétitives en vol, EN MÉMOIRE (un redémarrage du hub
   * abandonne la course ; la tâche est alors récupérée par le circuit normal au
   * boot — dégradation sûre, jamais de double comptage). Le store garde le
   * modèle mono-assignation : `assignedNodeId` = drone « primaire » (celui que
   * suivent reap/réconciliation), promu vers un autre drone s'il tombe.
   */
  private readonly races = new Map<string, DroneRace>();

  /**
   * Thermorégulation : bande et facteur EFFECTIFS, c'est-à-dire hystérésés —
   * appliqués à l'assignation. Au boot la ruche est froide (facteur 1) : le
   * comportement par défaut est strictement celui d'avant la ventilation.
   */
  private bandeThermo: BandeThermo = 'froide';
  private facteurThermo = 1;
  /** Ticks consécutifs dont la lecture diverge de la bande appliquée (hystérésis). */
  private ticksDivergents = 0;

  /**
   * Phéromones : domaine mémoïsé par tâche (titre et prompt sont immuables).
   * Cache borné — sur dix ans, la mémoire ne dérive pas.
   */
  private readonly cacheDomaines = new CacheDomaines();

  /**
   * Balance : grand livre de la dépense par projet. CACHE — reconstructible
   * intégralement depuis `results` par rattrapage borné. Un instantané
   * (filigrane + soldes) est repris au premier tick depuis
   * `balance_ledger_cache` pour ne pas relire tout l'historique à chaque
   * démarrage (doctrine, règle 1 amendée — balance.ts).
   */
  private readonly livre = new GrandLivre();
  /** Cache du livre : repris une seule fois, au premier tick qui fait tourner le livre. */
  private livreRepris = false;
  /** Filigrane déjà écrit dans le cache (0 = rien écrit par ce process). */
  private filigraneSauve = 0;
  /** Horodatage de la dernière sauvegarde du cache — `-∞` : la première a toujours lieu. */
  private derniereSauvegardeLivre = Number.NEGATIVE_INFINITY;
  /** taskId → projectId, mémoïsé et borné (projectId est immuable). */
  private readonly cacheProjets: CacheProjets;
  /**
   * Plafonds en vigueur, chargés PARESSEUSEMENT depuis `budgets` et gardés
   * jusqu'au prochain geste humain (`setPlafond` remet à `null`). `budgets`
   * étant 1:1 avec `projects`, cette carte est bornée par construction — et,
   * mémoïsée, elle ne coûte pas une lecture par tick.
   */
  private budgets: Map<string, number> | null = null;
  /**
   * Dédup des franchissements — motif `deferredByConflict` (l. 63). SANS elle,
   * un projet plafonné émettrait un fait à CHAQUE tick et pour CHAQUE tâche
   * prête : à un tick toutes les 2 s, la fenêtre de 5 000 événements est
   * épuisée en moins de trois heures, et Ghost, Waggle, Pulse et la Chronique —
   * qui lisent tous le MÊME journal élagué — deviennent aveugles à tout le
   * reste. On journalise donc un FRONT MONTANT, jamais un niveau : redescendre
   * sous le seuil (ou changer le plafond) vide la mémoire, et le franchissement
   * suivant se réannonce. Bornées par le nombre de projets, comme `budgets`.
   */
  private readonly seuilsEmis = new Set<string>();
  private readonly alertesEmises = new Set<string>();
  /** Suites retenues jusqu'au COMMIT d'`enUnSeulGeste` — `null` hors transaction. */
  private suitesRetenues: (() => void)[] | null = null;

  constructor(
    private readonly store: HiveStore,
    private readonly opts: SchedulerOptions = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
    this.nodeTimeoutMs = opts.nodeTimeoutMs ?? NODE_TIMEOUT_MS;
    this.cacheProjets = new CacheProjets(opts.balance?.capaciteCacheProjets);
  }

  /** Journalise la transition et la propage (dashboard, logs) — après le COMMIT, s'il y en a un. */
  private emit(type: string, payload: Record<string, unknown>): void {
    const event = this.store.appendEvent(type, payload);
    this.apresCommit(() => this.opts.onEvent?.(event));
  }

  /**
   * Range un résultat EN UN SEUL GESTE : toutes ses écritures dans une
   * transaction IMMEDIATE (`store.enTransaction`), tout le reste après.
   *
   * La ligne `results` (success = 1) et le statut `done` étaient deux
   * autocommits. Une panne entre les deux — la base prise par un autre
   * processus, `patchTask` qui lève SQLITE_BUSY après 5 s — laissait un succès
   * rangé sur une tâche encore `running`. Le hub fermait alors la socket (1011),
   * `nodeDisconnected` requalifiait la tâche, et elle se comptait DEUX fois
   * (tests/resultat-tout-ou-rien.test.ts).
   *
   * Ce qui n'est pas la base attend le COMMIT (`apresCommit`) : la diffusion
   * des événements (un tableau de bord ne voit jamais un `task_done` effacé par
   * le ROLLBACK), l'état des courses en mémoire, les annulations envoyées aux
   * nœuds, l'assignation suivante. Sur ROLLBACK, rien de tout cela n'a lieu.
   */
  private enUnSeulGeste(ecrire: () => void): void {
    const suites: (() => void)[] = [];
    this.suitesRetenues = suites;
    try {
      this.store.enTransaction(ecrire);
    } finally {
      this.suitesRetenues = null;
    }
    for (const suite of suites) suite();
  }

  /** Dans `enUnSeulGeste` : après le COMMIT, dans l'ordre. Ailleurs : tout de suite. */
  private apresCommit(suite: () => void): void {
    if (this.suitesRetenues) this.suitesRetenues.push(suite);
    else suite();
  }

  /**
   * À appeler une fois au démarrage : requalifie les tâches orphelines d'un
   * crash. Le store clôt au passage chaque session d'horloge de l'hébergeur à
   * son dernier signe de vie — la panne de la Reine n'est facturée à personne.
   */
  recoverAtBoot(): void {
    const orphans = this.store.recoverOrphanTasks();
    for (const t of orphans) {
      this.emit('task_requeued', { taskId: t.id, reason: 'boot_recovery' });
    }
    if (orphans.length > 0) this.emit('boot_recovery', { requeued: orphans.length });
  }

  /** Tick périodique : reap des nœuds morts → thermorégulation → promotion → assignation. */
  tick(now = Date.now()): void {
    this.reapDeadNodes(now);
    // La température n'est prise QU'ICI : les autres chemins (résultats, refus,
    // reconnexions) assignent avec le facteur déjà en vigueur, sans re-lecture.
    this.ventiler(now);
    this.promoteAndAssign(now);
  }

  /** État thermique effectif (hystérésé) — lecture seule, pour l'API. */
  get thermo(): { bande: BandeThermo; facteur: number } {
    return { bande: this.bandeThermo, facteur: this.facteurThermo };
  }

  /**
   * Balance : mode, avancement du rattrapage et soldes par projet — lecture
   * seule, pour l'API (motif `get thermo`). `aJour: false` doit être visible :
   * un solde en cours de rattrapage affiché comme définitif est un mensonge
   * court mais coûteux.
   *
   * Chaque solde porte son plafond et son verdict, et `bloque` dit si
   * l'assignation est RÉELLEMENT arrêtée en ce moment (verdict `bloque` ET mode
   * `strict`). C'est délibéré : si le seul témoin d'un projet plafonné était un
   * événement dans un journal élagué à 5 000, alors dans trois ans « pourquoi ce
   * projet est-il bloqué ? » serait sans réponse. Un blocage doit se lire dans
   * l'ÉTAT COURANT, pas seulement dans l'histoire.
   *
   * Les soldes couvrent l'UNION des projets qui ont dépensé et des projets qui
   * ont un plafond : un projet plafonné à 0 qui n'a encore rien dépensé est
   * bloqué sans avoir de solde — il doit apparaître, sinon il serait
   * exactement le « projet en famine silencieuse » que la porte doit rendre
   * impossible.
   *
   * SAUF en mode `off`, où la liste est VIDE. Le grand livre ne tourne pas :
   * l'union avec les projets plafonnés y fabriquait un `depenseMs: 0` qui n'est
   * pas un solde nul mais un solde INCONNU — et rien, dans la réponse, ne
   * permettait de distinguer les deux. Un zéro inventé sur la seule page qui
   * réponde à « combien ce projet a-t-il coûté ? » est pire que l'absence :
   * `off` veut dire « la Balance ne pèse rien », et c'est ce que la liste vide
   * dit. Le mode reste dans la réponse, donc l'affichage sait pourquoi.
   */
  get balance(): {
    mode: 'off' | 'observation' | 'strict';
    aJour: boolean;
    soldes: Array<{
      projectId: string;
      depenseMs: number;
      tentatives: number;
      plafondMs: number | null;
      etat: DecisionPlafond;
      bloque: boolean;
    }>;
  } {
    const mode = this.opts.balance?.mode ?? 'observation';
    // En `off`, le livre n'a jamais tourné : aucun solde n'existe, et aucun
    // n'est inventé (voir le commentaire de la propriété). L'intention humaine,
    // elle, reste lisible par `/api/projects/:id/balance`, qui lit `budgets`.
    if (mode === 'off') return { mode, aJour: this.livre.aJour, soldes: [] };
    // Les plafonds sont lus au-delà : l'intention humaine existe en base
    // indépendamment du mode. Ce qui change avec le mode, c'est `etat` et
    // `bloque` — l'intention est affichée, son application dit la vérité.
    const budgets = this.lireBudgets();
    const comptes = new Map(this.livre.soldes().map((s) => [s.projectId, s]));
    const projets = [...new Set([...comptes.keys(), ...budgets.keys()])].sort((a, b) =>
      a.localeCompare(b),
    );
    return {
      mode,
      aJour: this.livre.aJour,
      soldes: projets.map((projectId) => {
        const compte = comptes.get(projectId);
        const plafondMs = budgets.get(projectId) ?? null;
        const etat = this.decisionPlafond(projectId);
        return {
          projectId,
          depenseMs: compte?.depenseMs ?? 0,
          tentatives: compte?.tentatives ?? 0,
          plafondMs,
          etat,
          bloque: etat === 'bloque' && mode === 'strict',
        };
      }),
    };
  }

  /**
   * Plafonds en vigueur, lus au plus une fois par geste humain. `budgets` est
   * 1:1 avec `projects` : la lecture est bornée par construction, et mémoïsée
   * par-dessus — jamais un SELECT par tick sur le chemin chaud.
   */
  private lireBudgets(): Map<string, number> {
    this.budgets ??= new Map(this.store.listBudgets().map((b) => [b.projectId, b.plafondMs]));
    return this.budgets;
  }

  /**
   * Verdict de plafond pour un projet. Trois raisons de laisser passer, dans
   * cet ordre :
   *  - mode `off` : la Balance ne tourne pas ;
   *  - FAIL-OPEN : le grand livre n'a pas fini son rattrapage, donc le solde est
   *    INCOMPLET — la ruche ne bloque JAMAIS sur un comptage partiel ; un faux
   *    blocage au démarrage coûterait bien plus cher qu'un plafond dépassé de
   *    quelques ticks ;
   *  - aucun plafond posé sur ce projet (`jugerPlafond(_, null) === 'passe'`).
   *
   * Cette méthode décide SI une tâche de ce projet peut être assignée. Elle ne
   * dit JAMAIS À QUEL NŒUD : c'est la règle 4 de la doctrine, et la distinction
   * est de fond — router au moins-cher punirait les machines modestes.
   */
  private decisionPlafond(projectId: string): DecisionPlafond {
    if (this.opts.balance?.mode === 'off') return 'passe';
    if (!this.livre.aJour) return 'passe';
    const depense = this.opts.factureHorlogeHote
      ? this.store.depenseHorlogeHote(projectId, Date.now())
      : this.livre.depense(projectId);
    return jugerPlafond(depense, this.lireBudgets().get(projectId) ?? null);
  }

  /**
   * Journalise un FRANCHISSEMENT de seuil, jamais un état (voir `seuilsEmis`
   * pour la raison, qui est la santé du journal partagé).
   *
   * Payload de FAITS TYPÉS uniquement — des ids et des entiers. Aucune phrase
   * n'est jamais persistée : le texte bilingue du Journal est reconstruit à
   * l'affichage depuis ces champs, comme pour `thermo_shift` et
   * `pheromone_route`.
   *
   * `applique` distingue les deux modes : en `observation` le fait est observé
   * et n'a RIEN bloqué (`false`), en `strict` il a réellement fermé la porte
   * (`true`).
   *
   * NOMS D'ÉVÉNEMENTS EN ANGLAIS — `balance_alert`, `balance_cap_reached`,
   * `balance_cap_set`. Le code et les commentaires de ce dépôt sont en
   * français, mais les 46 types d'événements PERSISTÉS sont en anglais
   * (`task_failed`, `thermo_shift`, `pheromone_route`…) : ce sont des clés de
   * corpus, pas de la prose. Trois exceptions françaises s'étaient glissées ici
   * (`balance_alerte`, `balance_seuil`, `balance_plafond`) ; elles ont été
   * renommées avant qu'une seule base de production n'existe, parce qu'après,
   * ce n'est plus un renommage mais une migration de journal.
   */
  private signalerPlafond(projectId: string, decision: DecisionPlafond): void {
    if (decision === 'passe') {
      // Front descendant : la mémoire s'efface, le prochain franchissement se
      // réannonce (sinon un plafond relevé puis re-atteint resterait muet).
      this.seuilsEmis.delete(projectId);
      this.alertesEmises.delete(projectId);
      return;
    }
    const plafondMs = this.lireBudgets().get(projectId) ?? 0;
    const depenseMs = this.opts.factureHorlogeHote
      ? this.store.depenseHorlogeHote(projectId, Date.now())
      : this.livre.depense(projectId);
    if (decision === 'alerte') {
      if (this.alertesEmises.has(projectId)) return;
      this.alertesEmises.add(projectId);
      this.emit('balance_alert', {
        projectId,
        depenseMs,
        plafondMs,
        // Entier 0-100, arrondi PAR DÉFAUT : la part annoncée n'exagère jamais
        // la dépense. `plafondMs > 0` est garanti ici (avec un plafond nul,
        // jugerPlafond rend 'bloque', jamais 'alerte') — la garde est une
        // ceinture, pas une supposition.
        part: plafondMs > 0 ? Math.floor((depenseMs * 100) / plafondMs) : 100,
      });
      return;
    }
    // Au plafond, l'alerte n'a plus de raison d'être ré-émise : on la marque
    // comme dite, pour qu'un simple passage sous le plafond ne la fasse pas
    // rejaillir avant un vrai retour à la normale.
    this.alertesEmises.add(projectId);
    if (this.seuilsEmis.has(projectId)) return;
    this.seuilsEmis.add(projectId);
    this.emit('balance_cap_reached', {
      projectId,
      depenseMs,
      plafondMs,
      applique: this.opts.balance?.mode === 'strict',
    });
  }

  /**
   * Un humain pose (ou retire, avec `null`) le plafond d'un projet. C'est le
   * SEUL chemin d'écriture de `budgets` : le store est écrit ici, le cache
   * invalidé dans la foulée, et les deux ne peuvent donc pas diverger. (Écart
   * assumé avec la conception d'origine, qui écrivait côté route puis
   * prévenait le scheduler : deux écritures pour une intention, c'est une
   * divergence qui n'attend que d'arriver.)
   *
   * Le déblocage est un GESTE HUMAIN EXPLICITE, exactement symétrique de
   * l'invariant du merge : la ruche ne se ré-autorise jamais elle-même à
   * dépenser. Elle repart en revanche dans le MÊME geste — l'assignation est
   * relancée ici, pas au tick suivant : un humain qui débloque voit sa ruche
   * repartir, il n'attend pas.
   */
  setPlafond(
    projectId: string,
    plafondMs: number | null,
    definiPar: string | null = null,
    now = Date.now(),
  ): void {
    this.store.setBudget(projectId, plafondMs, definiPar, now);
    this.budgets = null;
    // Le plafond a changé : ce qui a déjà été annoncé ne vaut plus, un nouveau
    // franchissement doit pouvoir se dire.
    this.seuilsEmis.delete(projectId);
    this.alertesEmises.delete(projectId);
    this.promoteAndAssign(now);
  }

  /**
   * Thermorégulation : lit la température de la FENÊTRE de 10 minutes (lecture
   * ciblée par temps et par type — jamais un lot des N derniers événements, qui
   * serait noyé par les `task_progress`) et ajuste le facteur de ventilation
   * avec HYSTÉRÉSIS : la bande ne change qu'après deux ticks consécutifs passés
   * hors de la bande appliquée, pour éviter le clignotement à la frontière.
   */
  private ventiler(now: number): void {
    const events = this.store.listEventsInWindow(now - FENETRE_MS, TYPES_THERMO);
    const lecture = lireTemperature(events, now);
    if (lecture.bande === this.bandeThermo) {
      this.ticksDivergents = 0; // la lecture confirme la bande courante
      return;
    }
    this.ticksDivergents += 1;
    if (this.ticksDivergents < TICKS_CONFIRMATION_THERMO) return;
    this.ticksDivergents = 0;
    this.bandeThermo = lecture.bande;
    this.facteurThermo = lecture.facteur;
    // Payload de FAITS uniquement : le texte (bilingue) est reconstruit à
    // l'affichage — jamais de message figé dans une base qui vivra dix ans.
    this.emit('thermo_shift', {
      bande: lecture.bande,
      temperature: lecture.temperature,
      facteur: lecture.facteur,
    });
  }

  /**
   * Enregistre le nœud SANS assigner de tâche : l'appelant doit d'abord
   * brancher le canal de livraison (socket WS), puis appeler tick().
   */
  registerNode(profile: NodeProfile, now = Date.now()): HiveNode {
    const known = profile.nodeId ? this.store.getNode(profile.nodeId) : undefined;
    const node = this.store.registerNode(profile, now);
    this.emit(known ? 'node_online' : 'node_registered', {
      nodeId: node.id,
      name: node.name,
      agentType: node.agentType,
    });
    return node;
  }

  /**
   * Réconciliation à la (re)connexion d'un nœud. Le nœud déclare les tâches
   * qu'il exécute RÉELLEMENT (`activeTaskIds`) et le hub aligne son état sur
   * cette vérité de terrain :
   *  - tâche déclarée par le nœud, non assignée ailleurs (ready/null après un
   *    blip, ou toujours à ce nœud) → RÉ-ADOPTÉE (running @ nœud) : on ne tue
   *    jamais un travail en cours ;
   *  - tâche déclarée mais désormais assignée à un AUTRE nœud (déjà réaffectée),
   *    ou déjà terminée/inconnue → « zombie » : on demande au nœud de l'abandonner
   *    (le serveur enverra cancel_task) pour éviter la double exécution ;
   *  - tâche que le hub attribue au nœud mais que le nœud ne déclare PAS
   *    (crash/redémarrage à vide) → requalifiée en ready.
   *
   * NB : n'assigne rien ici. L'appelant envoie d'abord les cancel_task puis
   * déclenche un tick — sinon on risquerait de ré-assigner une tâche qu'on
   * s'apprête à faire annuler.
   */
  reconcileNode(nodeId: string, activeTaskIds: string[], now = Date.now()): { zombies: string[] } {
    const reported = new Set(activeTaskIds);
    const zombies: string[] = [];

    // Un nœud qui se (ré)inscrit repart de zéro : ses cooldowns de refus
    // sautent (ex. Night Shift corrigé puis nœud relancé — ne pas attendre
    // l'expiration d'un cooldown long devenu obsolète).
    for (const key of this.recentRejections.keys()) {
      if (key.endsWith(`:${nodeId}`)) this.recentRejections.delete(key);
    }

    // 1) Aligner sur ce que le nœud déclare exécuter.
    for (const taskId of reported) {
      const task = this.store.getTask(taskId);
      if (!task || task.status === 'done' || task.status === 'failed') {
        zombies.push(taskId); // inconnue ou déjà finie : le nœud doit l'abandonner
        continue;
      }
      if (task.assignedNodeId && task.assignedNodeId !== nodeId) {
        zombies.push(taskId); // réaffectée à un autre nœud : abandon (anti double exécution)
        continue;
      }
      // Non assignée (requalifiée par le blip) ou déjà à nous : on ré-adopte le
      // travail vivant sans le tuer.
      if (task.assignedNodeId !== nodeId || task.status !== 'running') {
        this.store.patchTask(taskId, { status: 'running', assignedNodeId: nodeId }, now);
        // L'hébergeur travaille de nouveau pour elle : la perte l'avait close,
        // la ré-adoption la rouvre (idempotent si elle n'avait jamais fermé).
        // Sans elle, tout le reste de la tentative échapperait à la facture.
        this.store.ouvrirHorlogeHote(task.projectId, taskId, now);
        this.emit('task_readopted', { taskId, nodeId });
      }
    }

    // 2) Requalifier les tâches que le hub croit à ce nœud mais qu'il ne déclare pas.
    for (const task of this.store.activeTasksOfNode(nodeId)) {
      if (!reported.has(task.id)) {
        // Drone Wars : primaire revenu à vide — sa course continue sans lui
        // (promotion d'un autre drone), la tâche n'est requalifiée que si la
        // course s'éteint. Jamais de requeue pendant que des drones volent.
        if (this.dropDrone(task.id, nodeId, 'reconcile_orphan', now)) continue;
        // Le nœud est revenu SANS elle : la tentative s'est arrêtée avec lui.
        this.store.fermerHorlogeHote(task.id, now);
        this.store.patchTask(task.id, { status: 'ready', assignedNodeId: null }, now);
        this.emit('task_requeued', { taskId: task.id, nodeId, reason: 'reconcile_orphan' });
      }
    }

    // Drone Wars : un nœud qui se ré-inscrit repart de zéro — TOUTE course où
    // il volait et dont il ne déclare pas la tâche perd ce drone (couvre les
    // fantômes : crash sans FIN TCP, socket remplacée, assign_task avalé).
    for (const taskId of [...this.races.keys()]) {
      if (!reported.has(taskId)) this.dropDrone(taskId, nodeId, 'reconcile_ghost', now);
    }
    // Et un drone NON-primaire qui redéclare sa tâche a été zombifié ci-dessus
    // (le primaire la porte) — il quitte la course proprement.
    for (const taskId of zombies) this.dropDrone(taskId, nodeId, 'reconcile_zombie', now);

    if (zombies.length > 0) this.emit('node_reconciled', { nodeId, zombies });
    return { zombies };
  }

  /**
   * Retire un drone d'une course (perte d'infrastructure : blip, zombie…).
   * Retourne true si la tâche était bien dans une course où ce nœud volait —
   * l'appelant ne doit alors PAS appliquer sa requalification générique.
   * `vuVivantA` : dernier instant où ce drone a été vu vivant — c'est là que
   * s'arrête l'horloge si la course s'éteint avec lui.
   */
  private dropDrone(
    taskId: string,
    nodeId: string,
    reason: string,
    now: number,
    vuVivantA = now,
  ): boolean {
    const race = this.races.get(taskId);
    if (!race || !race.drones.some((d) => d.nodeId === nodeId && d.status === 'running')) {
      return false;
    }
    const { race: updated, decision } = recordDroneResult(race, nodeId, false);
    this.races.set(taskId, updated);
    this.emit('drone_failed', { taskId, nodeId, reason });
    const task = this.store.getTask(taskId);
    if (!task || task.status === 'done' || task.status === 'failed') {
      this.races.delete(taskId);
      return true;
    }
    if (decision.outcome === 'all_failed') {
      this.races.delete(taskId);
      this.store.fermerHorlogeHote(taskId, vuVivantA);
      this.store.patchTask(taskId, { status: 'ready', assignedNodeId: null }, now);
      this.emit('task_requeued', { taskId, nodeId, reason: 'drone_all_lost' });
    } else if (task.assignedNodeId === nodeId) {
      this.promoteNextDrone(updated, taskId, now);
    }
    return true;
  }

  /**
   * Refus d'assignation par un nœud : la tâche repart en `ready` SANS consommer de
   * tentative — contrairement à un échec d'exécution. On mémorise le refus pour ne
   * pas ré-assigner aussitôt la même tâche au même nœud (cooldown), ce qui l'oriente
   * vers un AUTRE nœud.
   *
   * Token-failover (`infra`) : un refus dû à un agent en panne (auth/quota) est
   * compté ; si tous les nœuds refusent ainsi, la tâche finit par échouer proprement
   * (« aucun nœud avec un agent fonctionnel ») plutôt que de rebondir sans fin. Un
   * refus de simple saturation n'est PAS compté (le nœud se libérera).
   *
   * `infra: 'avant_agent'` — le dépôt de la tâche ne s'est pas cloné : compté
   * comme tout refus d'infrastructure, mais aucun modèle n'a tourné, aucun
   * n'est écarté des reprises.
   */
  rejectTask(
    nodeId: string,
    taskId: string,
    reason: string,
    infra: boolean | 'avant_agent' = false,
    now = Date.now(),
    retryAfterMs?: number,
  ): void {
    // Indisponibilité prévisible annoncée par le nœud (Night Shift) : cooldown
    // proportionnel (borné 24 h) — sinon boucle assignation/refus toutes les
    // ~4 s qui noierait le journal pendant toute la fenêtre fermée.
    const cooldown = Math.max(REJECT_COOLDOWN_MS, Math.min(retryAfterMs ?? 0, 24 * 60 * 60 * 1000));

    // Drone Wars : le refus d'un drone enrôlé (saturation, hors service) n'est
    // qu'un abandon de course — la tâche ne repart en ready que si la course
    // s'éteint (aucune tentative brûlée : rien n'a tourné).
    const race = this.races.get(taskId);
    if (race && race.drones.some((d) => d.nodeId === nodeId && d.status === 'running')) {
      const { race: updated, decision } = recordDroneResult(race, nodeId, false);
      this.races.set(taskId, updated);
      this.recentRejections.set(`${taskId}:${nodeId}`, now + cooldown);
      if (infra === true) this.ecarterModele(taskId, race.modeleParDrone?.[nodeId]);
      this.emit('drone_rejected', { taskId, nodeId, reason });
      const task = this.store.getTask(taskId);
      if (!task || task.status === 'done' || task.status === 'failed') {
        this.races.delete(taskId);
        return;
      }
      if (decision.outcome === 'all_failed') {
        this.races.delete(taskId);
        this.store.fermerHorlogeHote(taskId, now);
        this.store.patchTask(taskId, { status: 'ready', assignedNodeId: null }, now);
        this.emit('task_requeued', { taskId, nodeId, reason: 'drone_all_rejected' });
        this.promoteAndAssign(now);
      } else if (task.assignedNodeId === nodeId) {
        this.promoteNextDrone(updated, taskId, now);
      }
      return;
    }

    const task = this.store.getTask(taskId);
    if (!task || task.assignedNodeId !== nodeId) return;
    if (task.status !== 'assigned' && task.status !== 'running') return;
    // La session s'ouvrait à l'assignation et survivait au refus : un refus
    // Night Shift (cooldown jusqu'à 24 h) facturait toute l'attente en file.
    this.store.fermerHorlogeHote(taskId, now);
    // Le CLI lancé avec le modèle commandé a buté sur l'infrastructure (auth,
    // quota, binaire) : ce modèle est écarté des reprises de cette tâche — un
    // quota épuisé est souvent celui d'UN modèle. Si c'est l'agent entier qui
    // est en panne, ses autres modèles tombent de même, l'écart retombe sur le
    // concours complet et le compte `infraRejects` conclut comme avant. Un refus
    // de saturation, de service ou de clone n'a rien lancé : le modèle reste en lice.
    if (infra === true) this.ecarterModele(taskId, this.store.modeleAiguillageDe(taskId));
    this.store.patchTask(taskId, { status: 'ready', assignedNodeId: null }, now);
    this.recentRejections.set(`${taskId}:${nodeId}`, now + cooldown);
    this.emit('task_rejected', {
      taskId,
      nodeId,
      reason,
      ...(infra ? { infra: true } : {}),
      ...(infra === 'avant_agent' ? { avantAgent: true } : {}),
    });

    if (infra) {
      const count = (this.infraRejects.get(taskId) ?? 0) + 1;
      this.infraRejects.set(taskId, count);
      // Seuil proportionnel au nombre de nœuds : laisser une chance à chacun.
      const online = this.store.listNodes().filter((n) => n.status === 'online').length;
      const limit = Math.max(3, online * 3);
      if (count >= limit) {
        this.store.patchTask(taskId, { status: 'failed', assignedNodeId: null }, now);
        this.emit('task_failed', { taskId, reason: 'no_working_agent', infraRejects: count });
        this.infraRejects.delete(taskId);
        this.fermerSousArbre(taskId, 'ancestor_failed', now);
        this.relectureCloseSansAvis(task, 'aucun_agent_fonctionnel');
        this.promoteAndAssign(now); // propager l'échec en cascade aux dépendantes
        return;
      }
    }
    this.promoteAndAssign(now);
  }

  /**
   * Tâches assignées restées muettes (pas de task_update) au-delà de `ageMs` :
   * candidates à une re-livraison de `assign_task` (message perdu en vol).
   */
  staleAssignedTasks(ageMs: number, now = Date.now()): Task[] {
    return this.store.tasksByStatus('assigned').filter((t) => now - t.updatedAt > ageMs);
  }

  /** Heartbeat découplé de la demande de tâche : il ne fait que prouver la vie du nœud. */
  heartbeat(nodeId: string, now = Date.now()): void {
    const node = this.store.getNode(nodeId);
    if (!node) return;
    this.store.touchNode(nodeId, now);
    if (node.status === 'offline') {
      this.store.setNodeStatus(nodeId, 'online');
      this.emit('node_online', { nodeId, name: node.name });
      this.promoteAndAssign(now);
    }
  }

  /**
   * Déconnexion (WS fermé) ou heartbeat expiré : offline + réaffectation des
   * tâches actives.
   *
   * `vuVivantA` : le dernier instant où la Reine a vu ce nœud vivant — c'est là
   * que s'arrête l'horloge de l'hébergeur de ses tentatives, qui sont facturées
   * pour le temps qu'elles ont réellement occupé. Un socket fermé s'interrompt
   * MAINTENANT (défaut) ; un nœud fauché s'est tu à son dernier battement, et
   * les NODE_TIMEOUT_MS qu'il faut au tick pour s'en apercevoir ne sont du
   * temps consommé par personne. La tâche requalifiée rouvrira une session
   * neuve à sa prochaine assignation (ou à sa ré-adoption) : l'attente en file
   * n'occupe aucun hébergeur.
   */
  nodeDisconnected(nodeId: string, reason: string, now = Date.now(), vuVivantA = now): void {
    const node = this.store.getNode(nodeId);
    if (!node || node.status === 'offline') return;
    this.store.setNodeStatus(nodeId, 'offline');
    this.emit('node_offline', { nodeId, name: node.name, reason });
    // Drone Wars d'abord : une course qui continue promeut un nouveau primaire
    // (la tâche change d'assigné et n'est PAS requalifiée par la boucle suivante).
    this.failDronesOfNode(nodeId, now, vuVivantA);
    for (const task of this.store.activeTasksOfNode(nodeId)) {
      this.store.fermerHorlogeHote(task.id, vuVivantA);
      this.store.patchTask(task.id, { status: 'ready', assignedNodeId: null }, now);
      this.emit('task_requeued', { taskId: task.id, nodeId, reason });
    }
    this.promoteAndAssign(now);
  }

  /** Le nœud confirme le démarrage effectif (assigned → running) et le progrès des sous-agents. */
  handleTaskUpdate(
    nodeId: string,
    taskId: string,
    subAgents?: SubAgent[],
    log?: string,
    presences?: PresenceFichier[],
    sortie?: string,
  ): void {
    const task = this.store.getTask(taskId);
    // Mise à jour pour une tâche inconnue ou réaffectée ailleurs : ignorée —
    // SAUF si le nœud est un drone enrôlé : son progrès est visible (télémétrie
    // de course), sans jamais toucher au statut ni à l'assignation.
    if (!task) return;
    if (task.assignedNodeId !== nodeId) {
      const race = this.races.get(taskId);
      if (race?.drones.some((d) => d.nodeId === nodeId && d.status === 'running')) {
        const hasProgress =
          (subAgents !== undefined && subAgents.length > 0) ||
          log !== undefined ||
          presences !== undefined;
        if (hasProgress) {
          this.emit('task_progress', {
            taskId,
            nodeId,
            ...(subAgents && subAgents.length > 0 ? { subAgents } : {}),
            ...(log !== undefined ? { log: log.slice(0, 2000) } : {}),
            ...(presences !== undefined ? { presences } : {}),
          });
        }
        if (sortie) this.opts.onSortie?.(taskId, nodeId, sortie);
      }
      return;
    }
    if (task.status !== 'assigned' && task.status !== 'running') return;
    if (task.status === 'assigned') {
      this.store.patchTask(taskId, { status: 'running' });
      this.emit('task_started', { taskId, nodeId });
      // Les refus infra NE s'oublient PAS ici : un nœud annonce `running` AVANT
      // de cloner et de lancer l'agent, puis refuse (clone impossible, agent en
      // panne). Remis à zéro à chaque annonce, le compte ne concluait jamais —
      // la tâche rebondissait sans fin. Il tombe au premier RÉSULTAT : là,
      // l'agent a vraiment tourné.
    }
    // Snapshot présence Rayon — constaté, jamais inventé (ADR 0010).
    if (presences !== undefined) {
      this.store.remplacerPresences(nodeId, presences, taskId);
    }
    // Émettre le progrès dès qu'il y a des sous-agents OU un log : les agents
    // réels (claude-code, codex) n'envoient qu'un log, sans sous-agents — sans
    // ce OR, le journal du dashboard resterait vide pendant leur exécution.
    const hasSubAgents = subAgents !== undefined && subAgents.length > 0;
    if (hasSubAgents || log || presences !== undefined) {
      this.emit('task_progress', {
        taskId,
        nodeId,
        ...(hasSubAgents ? { subAgents } : {}),
        ...(log ? { log: log.slice(0, 2000) } : {}),
        ...(presences !== undefined ? { presences } : {}),
      });
    }
    // APRÈS la garde de statut : un morceau arrivé derrière le résultat d'une
    // tâche close, ou réaffectée à un AUTRE nœud, ne rouvre pas une console que
    // l'écran vient de vider. Relancée sur le MÊME nœud, la tâche est de
    // nouveau « assignée » ici : c'est le nœud qui tait le morceau posthume de
    // la tentative précédente (garde d'exécution de `progresVersHub`).
    if (sortie) this.opts.onSortie?.(taskId, nodeId, sortie);
  }

  /** Mode des Gardiennes en vigueur. Défaut `consultatif` — jamais contraignant. */
  private get modeGardiennes(): ModeGardiennes {
    return this.opts.gardiennes?.mode ?? 'consultatif';
  }

  /** Les Gardiennes : mode en vigueur — lecture seule, pour l'API (motif `get thermo`). */
  get gardiennes(): { mode: ModeGardiennes } {
    return { mode: this.modeGardiennes };
  }

  /**
   * Le mode des Gardiennes qui gouverne UNE production. Si l'Agent Garde-Fous a
   * posé un échelon pour cette tâche (projet opt-in), c'est la sévérité de cet
   * échelon (`REGLAGES[echelon].gardiennes`, jamais `off`) qui prime — le mode qui
   * JUGE est le mode qui a GOUVERNÉ. Sinon, le mode global de la ruche.
   *
   * On lit l'échelon POSÉ à l'assignation, jamais on ne re-élit : re-élire à la
   * réception pourrait rendre un autre échelon si les antécédents ont bougé, et
   * juger une production sous un cadre qu'elle n'a pas connu.
   */
  private modeGardiennesDe(task: Task): ModeGardiennes {
    const brut = this.store.getEchelonGardeFou(task.id);
    const echelon = brut === null ? null : versEchelon(brut);
    return echelon ? REGLAGES[echelon].gardiennes : this.modeGardiennes;
  }

  /**
   * Le contrôle d'entrée d'une production. `null` en mode `off` ou sur un échec
   * DÉCLARÉ : les gardiennes ne reniflent que ce qui prétend ENTRER dans le
   * rayon — un résultat qui s'annonce en échec n'alimente déjà ni la mémoire,
   * ni les phéromones positives, ni le nectar.
   *
   * Le verdict est calculé ICI, à la réception, jamais plus tard :
   * `pruneResults` vide `diff` et `logs` au-delà de 5 000 résultats, donc un
   * recalcul ultérieur accuserait de « diff vide » toutes les productions
   * anciennes (voir la doctrine, en tête de gardiennes.ts).
   *
   * La seule lecture ajoutée est celle du projet, par CLÉ PRIMAIRE, et
   * uniquement sur le chemin d'un résultat réussi — jamais sur le chemin du
   * tick. Elle est indispensable : sans dépôt git, `collectDiff()` rend
   * TOUJOURS '' (node-client/workspace.ts), et juger un diff vide y serait un
   * faux positif sur 100 % des tâches du projet.
   */
  private renifler(task: Task, result: Omit<TaskResult, 'nodeId'>): Inspection | null {
    if (this.modeGardiennesDe(task) === 'off' || !result.success) return null;
    // Une RELECTURE ne prétend rien faire entrer dans le rayon : elle rend un
    // avis, et un avis ne modifie aucun fichier. Reniflée comme une production,
    // elle était déclarée creuse (`empty_diff` : son titre et sa consigne
    // portent la promesse de la production relue) — en `strict`, chaque
    // contre-revue était refusée, re-tentée puis `failed` sans jamais rendre
    // d'avis, et `accepted` devenait hors d'atteinte sur un dépôt git.
    if (this.store.relectureDe(task.id)) return null;
    return inspecter({
      titre: task.title,
      prompt: task.prompt,
      success: true,
      diff: result.diff,
      logs: result.logs,
      depotGit: Boolean(this.store.getProject(task.projectId)?.repoUrl),
    });
  }

  /**
   * Range le verdict et, s'il ferme la porte, le journalise. Le fait
   * `guard_refused` est émis AVANT la conséquence (`task_retry` / `task_failed`,
   * `drone_all_failed`) : dans l'autre ordre, la Chronique montrerait l'effet
   * avant la cause, précisément dans le cas intéressant.
   *
   * Payload de FAITS TYPÉS uniquement — un id, des entiers, des codes de grief
   * en anglais snake_case. Aucune phrase n'est jamais persistée : le texte
   * bilingue du Journal est reconstruit à l'affichage, comme pour `thermo_shift`
   * et `balance_cap_reached`.
   *
   * Aucun événement en `consultatif` : le journal est une ressource PARTAGÉE et
   * élaguée à 5 000 (Ghost, Waggle, Pulse et la Chronique y lisent tous). Un
   * fait par production réussie le remplirait de bruit pendant toute la
   * campagne d'observation — qui est censée durer longtemps. Les verdicts
   * consultatifs vivent dans leur table et se lisent par `/api/gardiennes`.
   */
  private rangerInspection(
    inspection: Inspection,
    resultId: number,
    taskId: string,
    nodeId: string,
    refusee: boolean,
  ): void {
    this.store.enregistrerInspection({
      resultId,
      taskId,
      nodeId,
      verdict: inspection.verdict,
      score: inspection.score,
      applique: refusee,
      griefs: inspection.griefs,
    });
    if (!refusee) return;
    this.emit('guard_refused', {
      taskId,
      nodeId,
      verdict: inspection.verdict,
      score: inspection.score,
      griefs: inspection.griefs.map((g) => g.code),
    });
  }

  /**
   * Range les validations que le nœud a lancées dans le bac de CETTE production.
   *
   * Ici, et pas dans le serveur : c'est l'admission du résultat qui attribue
   * son `resultId`, et c'est le seul endroit où le lien est un FAIT plutôt
   * qu'une déduction (« le dernier résultat de la tâche » change dès qu'une
   * course ou une reprise en range un autre). Rangées même pour une production
   * que les Gardiennes refusent : ce qui a tourné a tourné, et l'Evaluator
   * rejette de toute façon un résultat en échec avant de lire ses validations.
   *
   * Des FAITS TYPÉS seulement — états, raisons, codes, durées : l'écran dit
   * les phrases dans sa langue. `validation` porte les quatre états, et
   * `details` le reste de chaque constat : jamais deux copies d'un même état.
   */
  private rangerValidations(
    validations: ValidationsBac | undefined,
    resultId: number,
    task: Task,
    nodeId: string,
  ): void {
    if (!validations) return;
    const validation = {} as Record<ValidationKey, ValidationState>;
    const details = {} as Record<ValidationKey, DetailControle>;
    for (const cle of VALIDATION_KEYS) {
      const { etat, ...detail } = validations.controles[cle];
      validation[cle] = etat;
      details[cle] = detail;
    }
    this.emit('validation_recorded', {
      source: 'hive_sandbox',
      taskId: task.id,
      projectId: task.projectId,
      resultId,
      nodeId,
      ...(validations.baseSha ? { baseSha: validations.baseSha } : {}),
      validation,
      details,
      recordedAt: Date.now(),
    });
  }

  /**
   * Hive Mind : la production retenue PROPOSE un souvenir — elle ne l'écrit
   * pas. Il n'entre dans la mémoire qu'une fois la production validée
   * (acceptée par l'Evaluator, ou approuvée par un humain : `statuerProduction`,
   * server.ts), parce qu'une réussite DÉCLARÉE n'est pas une réussite : la
   * contre-revue, les tests ou l'humain peuvent encore la faire tomber, et un
   * souvenir écrit trop tôt resterait dans les prompts voisins pendant des mois.
   *
   * Ce que l'agent a RÉPONDU, quand son CLI le déclare : les logs d'un flux
   * stream-json commencent par la ligne `init` (dossier de travail, session,
   * outils), et le souvenir n'aurait gardé qu'elle — pas un mot de réponse. Pris
   * ICI, parce que c'est le seul instant où la réponse finale est en main : le
   * journal ne la garde pas pour un succès (`insertResult`).
   *
   * Une RELECTURE n'en propose aucun : son texte est un verdict sur la
   * production d'un autre (« valide », « conteste » et des objections), pas un
   * savoir sur le projet. Rangé en souvenir, il revenait comme exemple dans le
   * prompt des tâches dont le titre ressemblait à celui qu'il relisait.
   */
  private proposerSouvenir(
    task: Task,
    resultId: number,
    result: Omit<TaskResult, 'nodeId'>,
    now = Date.now(),
  ): void {
    if (this.store.relectureDe(task.id) !== null) return;
    this.store.proposerSouvenir(
      {
        projectId: task.projectId,
        taskId: task.id,
        resultId,
        title: task.title,
        content: summarizeTask(task.title, task.prompt, result.finalText ?? result.logs),
      },
      now,
    );
  }

  /**
   * Le modèle que la Reine a COMMANDÉ pour la tentative que `nodeId` porte sur
   * `taskId` : celui de ce drone dans une course, celui de l'Aiguillage sinon.
   * `null` : aucun modèle commandé — le nœud a pris son défaut, et l'absence
   * reste une absence.
   *
   * À lire AVANT `handleTaskResult` : un échec remet la tâche en file et la
   * réassigne dans la foulée, et la ligne de l'Aiguillage dit alors le modèle
   * de la tentative SUIVANTE.
   */
  modeleCommande(taskId: string, nodeId: string): string | null {
    const race = this.races.get(taskId);
    if (race) return race.modeleParDrone?.[nodeId] ?? null;
    return this.store.modeleAiguillageDe(taskId);
  }

  /**
   * Résultat remonté par un nœud. Idempotence : un résultat pour une tâche
   * réaffectée, requalifiée ou déjà terminée est ignoré (et journalisé).
   */
  handleTaskResult(nodeId: string, result: Omit<TaskResult, 'nodeId'>): boolean {
    const task = this.store.getTask(result.taskId);
    if (!task) {
      this.emit('result_ignored', { taskId: result.taskId, nodeId, reason: 'unknown_task' });
      return false;
    }
    // Drone Wars : une course en vol court-circuite le modèle mono-assignation —
    // le résultat de N'IMPORTE quel drone enrôlé est arbitré par la course.
    const race = this.races.get(task.id);
    if (race) return this.handleDroneResult(race, task, nodeId, result);
    const active = task.status === 'assigned' || task.status === 'running';
    if (!active || task.assignedNodeId !== nodeId) {
      this.emit('result_ignored', {
        taskId: task.id,
        nodeId,
        reason: 'stale_assignment',
        status: task.status,
      });
      return false;
    }

    // Tout ce que ce résultat écrit part en UN seul geste : un succès rangé sans
    // son `done` se compterait deux fois (voir enUnSeulGeste).
    this.enUnSeulGeste(() => {
      this.store.fermerHorlogeHote(task.id, Date.now());

      // Présence Rayon : la tâche est finie → plus aucun fichier « ouvert ».
      this.store.effacerPresencesTache(task.id);
      this.store.effacerPresencesNoeud(nodeId);

      // Un résultat (succès ou échec de tâche) est arrivé : l'agent a tourné, on
      // oublie l'historique de refus infra pour cette tâche.
      this.apresCommit(() => this.infraRejects.delete(task.id));

      // ─── Les Gardiennes : le contrôle d'entrée ────────────────────────────────
      // Une production jugée CREUSE en mode `strict` est traitée EXACTEMENT comme
      // un échec d'agent, et c'est tout l'intérêt du câblage : elle emprunte le
      // circuit d'échec existant, donc elle ne nourrit
      //   - ni le Hive Mind (proposerSouvenir ne vit que dans la branche de
      //     succès — et le souvenir n'entre en mémoire qu'une fois validé),
      //   - ni les phéromones (la ligne `results` est rangée avec success = 0,
      //     donc le repli dépose −6 au lieu de +10),
      //   - ni le nectar (aucun `task_done` n'est émis, et le Waggle Board ne
      //     compte que ça),
      //   - ni `utile` dans La Balance (sans succès retenu, `posteDe` impute la
      //     tentative en `reprise` ou en `echec`, jamais en `utile`).
      // Les quatre « ne nourrit pas » sont donc STRUCTURELS : aucun des quatre
      // modules n'a été modifié, et aucun ne peut être oublié dans trois ans.
      //
      // RE-TENTER OU ÉCHOUER ? Re-tenter — mais sur le budget de tentatives
      // EXISTANT (`attempts`, plafonné par MAX_ATTEMPTS), jamais sur un compteur
      // à part. C'est la réponse à « une re-tentative infinie sur un agent cassé
      // serait pire que le mal » : un agent qui rend trois productions creuses de
      // suite épuise le même budget qu'un agent qui échoue trois fois, et la
      // tâche finit `failed` proprement. Un compteur séparé aurait rouvert la
      // porte à l'emballement ; échouer du premier coup aurait puni un incident
      // (un `git add` oublié) aussi durement qu'une fraude répétée — alors qu'une
      // deuxième tentative, elle, part sur un AUTRE nœud, avec les logs de la
      // production refusée en leçon de Couveuse.
      const inspection = this.renifler(task, result);
      // Le REFUS suit l'échelon de garde-fous du projet (modeGardiennesDe), pas le
      // seul mode global : un projet opt-in en « standard »/« strict » ferme la
      // porte au creux, un projet en « leger » ne la ferme pas.
      const refusee = inspection?.verdict === 'hollow' && this.modeGardiennesDe(task) === 'strict';
      const retenu = result.success && !refusee;
      const resultId = this.store.insertResult({ ...result, nodeId, success: retenu });
      if (inspection) this.rangerInspection(inspection, resultId, task.id, nodeId, refusee);
      this.rangerValidations(result.validations, resultId, task, nodeId);

      if (retenu) {
        // L'état des modèles écartés vit EN MÉMOIRE : il suit le COMMIT.
        const modeleRetenu = this.store.modeleAiguillageDe(task.id);
        this.apresCommit(() => this.reintegrerModele(task.id, modeleRetenu));
        this.store.patchTask(task.id, {
          status: 'done',
          result: {
            success: true,
            nodeId,
            durationMs: result.durationMs,
            ...(result.usage ? { usage: result.usage } : {}),
          },
        });
        this.emit('task_done', {
          taskId: task.id,
          nodeId,
          durationMs: result.durationMs,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
        });
        this.proposerSouvenir(task, resultId, result);
        this.fermerSousArbre(task.id, 'ancestor_done', Date.now());
      } else {
        // Le modèle commandé à CETTE tentative a échoué (la production creuse
        // refusée compte comme un échec d'agent, cf. plus haut) : écarté des
        // reprises. Lu avant la réassignation, qui effacera ou remplacera la ligne.
        const modeleEchoue = this.store.modeleAiguillageDe(task.id);
        this.apresCommit(() => this.ecarterModele(task.id, modeleEchoue));
        const attempts = task.attempts + 1;
        // Bornée ici aussi, en plus de l'entrée (`isInt(m.durationMs, 0, …)`,
        // protocol.ts) : aucune durée négative n'entre dans le journal, quel que
        // soit l'appelant. La Balance la reborne une troisième fois au repli.
        const durationMs = Math.max(0, result.durationMs);
        if (attempts >= this.maxAttempts) {
          this.store.patchTask(task.id, {
            status: 'failed',
            attempts,
            assignedNodeId: null,
            result: {
              success: false,
              nodeId,
              durationMs: result.durationMs,
              ...(result.usage ? { usage: result.usage } : {}),
            },
          });
          // `durationMs` : le temps machine que cet échec a coûté. Purement
          // ADDITIF — tous les lecteurs actuels lisent en défensif (`num(p, …)
          // → 0` dans waggle.ts, idem pulse.ts) et n'en tiennent aucun compte.
          // Sans lui, deux tentatives sur trois (MAX_ATTEMPTS = 3) pouvaient ne
          // laisser AUCUNE trace de leur coût : une histoire économique
          // définitivement perdue, jour après jour.
          this.emit('task_failed', {
            taskId: task.id,
            nodeId,
            attempts,
            durationMs,
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
          });
          this.fermerSousArbre(task.id, 'ancestor_failed', Date.now());
        } else {
          // Échec → réessai : la tâche repart en ready, une autre ouvrière la prendra.
          // Ses enfants délégués, eux, continuent : la tentative suivante peut
          // les retrouver par rejeu de leur identifiant stable.
          this.store.patchTask(task.id, { status: 'ready', attempts, assignedNodeId: null });
          this.emit('task_retry', {
            taskId: task.id,
            nodeId,
            attempt: attempts,
            maxAttempts: this.maxAttempts,
            durationMs,
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
          });
        }
      }
      // APRÈS la transition : une reprise qui vient de repartir en file est
      // encore en vol, et l'enveloppe épuisée l'arrête avec le reste.
      this.tenirBudgetCoutRacine(task.id, result.fournisseur?.coutUsd, Date.now());
    });
    this.promoteAndAssign();
    return true;
  }

  /**
   * Remet en file une production terminée que l'Evaluator a jugée à corriger.
   *
   * La demande est liée au `resultId` exact : une ancienne décision ne peut
   * pas rouvrir une production plus récente. La tâche doit encore être `done`,
   * ses dépendantes doivent être restées `pending` et aucun de ses ancêtres
   * délégués ne doit avoir échoué (ou été annulé), sinon rouvrir ce nœud
   * rendrait le graphe incohérent. Le passage à `ready` est unique et le même
   * budget `maxAttempts` que les échecs Worker borne la boucle.
   */
  retryFromEvaluator(input: {
    taskId: string;
    resultId: number;
    decision: EvaluationRetryDecision;
    /**
     * Ce qui a motivé la correction, transmis à la tentative suivante
     * (`blocCritique`, brood.ts). Borné ICI, à l'entrée du journal : c'est le
     * scheduler qui l'écrit, quel que soit l'appelant. REQUISE (`null`
     * explicite quand il n'y a rien à transmettre) : une porte de retry qui
     * l'oublierait renverrait l'ouvrière refaire la production contestée, et
     * le compilateur doit le voir.
     */
    critique: CritiqueReprise | null;
    now?: number;
  }): EvaluationRetryOutcome {
    const now = input.now ?? Date.now();
    const task = this.store.getTask(input.taskId);
    if (!task) return { ok: false, reason: 'unknown_task' };
    if (task.status !== 'done') return { ok: false, reason: 'task_not_done', task };
    // Toute ligne de livraison est une décision historique : une livraison
    // échouée peut encore correspondre à une PR distante, et `pr: 0` marque
    // explicitement un échec de création. Réouvrir la tâche ferait perdre ce
    // lien et pourrait créer une seconde livraison pour le même résultat.
    if (this.store.getLivraison(task.id)) {
      return { ok: false, reason: 'delivery_exists', task };
    }
    if (!Number.isSafeInteger(input.resultId) || input.resultId <= 0) {
      return { ok: false, reason: 'invalid_result_id', task };
    }
    const results = this.store.resultsForTask(task.id);
    const latest = results[results.length - 1];
    if (!latest || latest.resultId !== input.resultId) {
      return { ok: false, reason: 'stale_result', task };
    }
    const dependents = this.store.tasksDependingOn(task.id);
    if (dependents.some((dependent) => dependent.status !== 'pending')) {
      return { ok: false, reason: 'dependent_progressed', task };
    }
    // Un enfant délégué n'a qu'un destinataire : sous un ancêtre échoué, la
    // correction ne serait lue par personne, et la rouvrir remettrait en vol —
    // et à la facture — ce que la clôture du sous-arbre a justement arrêté.
    if (ancetreEchoue(this.store.listDelegationGraph(task.id), task.id)) {
      return { ok: false, reason: 'ancestor_failed', task };
    }
    // Une correction est une dépense neuve : sous une racine dont la dépense
    // déclarée a atteint l'enveloppe, plus rien ne repart — la même porte que
    // la création d'un enfant (`jugerDelegation`).
    if (this.budgetCoutEpuiseSous(task.id)) {
      return { ok: false, reason: 'root_cost_budget_exhausted', task };
    }
    if (task.attempts >= this.maxAttempts) {
      return { ok: false, reason: 'attempts_exhausted', task };
    }

    const attempt = task.attempts + 1;
    const requeued = this.store.patchTask(
      task.id,
      { status: 'ready', assignedNodeId: null, result: null, attempts: attempt },
      now,
    );
    if (!requeued) return { ok: false, reason: 'unknown_task' };
    // Une revue humaine approuve un résultat précis. La nouvelle tentative
    // doit repasser par cette porte : conserver l'approbation ferait fuiter un
    // verdict de la production précédente jusque dans la suivante.
    this.store.setTaskReview(task.id, null);
    // La critique est journalisée AVANT `promoteAndAssign` : l'assignation
    // qui suit est synchrone et relit ce payload pour composer le contexte de
    // la tentative — émise après, elle arriverait une tentative trop tard.
    const critique = bornerCritique(input.critique);
    this.emit('task_retry', {
      taskId: task.id,
      source: 'evaluator',
      resultId: input.resultId,
      decision: input.decision,
      attempt,
      maxAttempts: this.maxAttempts,
      ...(critique ? { critique } : {}),
    });
    this.promoteAndAssign(now);
    return {
      ok: true,
      task: this.store.getTask(task.id) ?? requeued,
      resultId: input.resultId,
      attempt,
      maxAttempts: this.maxAttempts,
    };
  }

  /**
   * Annulation demandée par un humain : la tâche passe `failed` immédiatement
   * (le nœud est prévenu par le serveur via `cancel_task`), ses descendants
   * délégués encore en vol sont annulés avec elle et ses dépendantes échouent
   * en cascade. Sans effet si la tâche est déjà terminée.
   */
  cancelTask(taskId: string, reason = 'cancelled', now = Date.now()): Task | undefined {
    const task = this.store.getTask(taskId);
    if (!task) return undefined;
    if (task.status === 'done' || task.status === 'failed') return task;
    const patched = this.annulerEnVol(task, reason, now);
    this.fermerSousArbre(taskId, 'ancestor_cancelled', now);
    this.promoteAndAssign(now);
    return patched;
  }

  /**
   * Annule UNE tâche encore en vol, sans relancer l'assignation : le ou les
   * nœuds qui la portent sont prévenus, son horloge d'hébergeur s'arrête, elle
   * passe `failed` et `task_cancelled` est journalisé. L'annulation humaine et
   * la clôture d'un sous-arbre délégué passent TOUTES DEUX par ici : deux
   * portes, c'est une porte qu'on oublie de garder — et l'horloge l'a prouvé,
   * elle ne se fermait que sur le chemin du résultat.
   */
  private annulerEnVol(task: Task, reason: string, now: number): Task | undefined {
    // Ce qui n'est pas la base — les nœuds prévenus, les mémoires par tâche —
    // suit le COMMIT quand une clôture de sous-arbre part d'un résultat rangé
    // en un seul geste (`enUnSeulGeste`) ; hors transaction, tout de suite.
    // Drone Wars : annuler TOUS les drones encore en vol, pas seulement le primaire.
    const race = this.races.get(task.id);
    const assigne = task.assignedNodeId;
    this.apresCommit(() => {
      if (race) {
        for (const droneId of runningDrones(race)) this.opts.onCancel?.(droneId, task.id, reason);
        this.races.delete(task.id);
      } else if (assigne) {
        // Mono : le nœud assigné est prévenu ici aussi — la notification vit dans
        // le scheduler, pas dans chaque appelant (symétrie course/mono).
        this.opts.onCancel?.(assigne, task.id, reason);
      }
    });
    // Une tentative interrompue est facturée pour le temps qu'elle a occupé
    // l'hébergeur, pas un instant de plus : sans cette ligne, `depenseHorlogeHote`
    // comptait la session jusqu'à `now` à chaque lecture, jusqu'à l'élagage.
    this.store.fermerHorlogeHote(task.id, now);
    // Une tâche terminale n'est plus jamais réévaluée : ses entrées dans les
    // mémoires par tâche ne seraient plus purgées par personne.
    this.apresCommit(() => {
      this.infraRejects.delete(task.id);
      this.deferredByConflict.delete(task.id);
      this.differeesParConsigne.delete(task.id);
    });
    const nodeId = task.assignedNodeId;
    const patched = this.store.patchTask(task.id, { status: 'failed', assignedNodeId: null }, now);
    this.emit('task_cancelled', { taskId: task.id, reason, ...(nodeId ? { nodeId } : {}) });
    this.relectureCloseSansAvis(task, 'annulee');
    return patched;
  }

  /**
   * Les préférences qu'une tâche PARENTE a déclarées pour cet enfant délégué
   * (`hive_delegate`), ou `null` — tâche racine, relecture, ou aucune
   * préférence dite. Lues à chaque passe par clé primaire, comme `relectureDe`.
   */
  private preferenceDelegation(taskId: string): { agent?: string; modele?: string } | null {
    const lien = this.store.getDelegation(taskId);
    if (!lien || lien.origine !== 'hive') return null;
    if (!lien.preferredAgent && !lien.preferredModel) return null;
    return {
      ...(lien.preferredAgent ? { agent: lien.preferredAgent } : {}),
      ...(lien.preferredModel ? { modele: lien.preferredModel } : {}),
    };
  }

  /**
   * La charge d'un nœud telle que `taskId` la voit : ses tâches actives, moins
   * les parents de SON arbre qui y attendent un enfant (`slotsOccupes`), plus
   * les drones non primaires que le store ignore (`extra`). Hors délégation,
   * aucun parent n'est soustrait : une place relâchée ne sert qu'à l'arbre qui
   * l'a relâchée.
   */
  private chargeVuePar(
    taskId: string,
    extra: ReadonlyMap<string, number>,
  ): (n: HiveNode) => number {
    const lien = this.store.getDelegation(taskId);
    const attentes =
      lien?.origine === 'hive' ? this.store.parentsEnAttenteSousRacine(lien.rootTaskId) : null;
    return (n) => slotsOccupes(n, attentes?.get(n.id) ?? 0) + (extra.get(n.id) ?? 0);
  }

  /** La racine de `taskId` a-t-elle épuisé son enveloppe coût ? Faux hors délégation. */
  private budgetCoutEpuiseSous(taskId: string): boolean {
    const lien = this.store.getDelegation(taskId);
    if (!lien || lien.origine !== 'hive') return false;
    return budgetCoutEpuise(this.store.depenseDeclareeRacine(lien.rootTaskId));
  }

  /**
   * Tient l'enveloppe COÛT de l'arbre de `taskId`, à chaque tentative qu'un de
   * ses enfants délégués vient de rendre — dans la transaction du résultat.
   *
   * La dépense est celle que les CLI DÉCLARENT (`depenses_delegation`, rangée
   * par `insertResult` juste avant). Quand elle atteint le plafond de la
   * racine, chaque descendant encore en vol est annulé avec un motif typé
   * (`delegation_cancelled`, `root_cost_budget_exhausted`) : rien de ce que
   * l'arbre lancerait encore n'a de budget pour être payé. La racine, elle,
   * continue : c'est la tâche de l'opérateur, son propre coût n'est pas dans
   * l'enveloppe de ses enfants. `jugerDelegation` refuse ensuite tout nouvel
   * enfant, et `retryFromEvaluator` toute correction.
   *
   * `delegation_budget_exhausted` est émis UNE fois : par la tentative dont le
   * coût fait franchir le plafond. Une tentative au coût inconnu ne le fait
   * jamais franchir — Hive n'invente pas de montant —, mais le fait compte
   * celles-là à part (`sansCout`) : la dépense réelle est au moins celle dite.
   */
  private tenirBudgetCoutRacine(taskId: string, coutUsd: number | undefined, now: number): void {
    const lien = this.store.getDelegation(taskId);
    if (!lien || lien.origine !== 'hive') return;
    const depense = this.store.depenseDeclareeRacine(lien.rootTaskId);
    if (!budgetCoutEpuise(depense)) return;
    const graphe = this.store.listDelegationGraph(lien.rootTaskId);
    const enVol = descendantsEnVol(
      graphe,
      lien.rootTaskId,
      'root_cost_budget_exhausted',
      () => false,
    );
    const cetteTentative =
      typeof coutUsd === 'number' && Number.isFinite(coutUsd) && coutUsd >= 0
        ? Math.round(coutUsd * 1_000_000)
        : 0;
    const budgetMicros = LIMITES_DELEGATION_DEFAUT.maxCostMicros;
    if (depense.micros - cetteTentative < budgetMicros) {
      this.emit('delegation_budget_exhausted', {
        rootTaskId: lien.rootTaskId,
        taskId,
        depenseMicros: depense.micros,
        budgetMicros,
        tentatives: depense.tentatives,
        sansCout: depense.sansCout,
        annulees: enVol.length,
      });
    }
    for (const noeud of enVol) {
      const descendant = this.store.getTask(noeud.taskId);
      if (!descendant) continue;
      this.emit('delegation_cancelled', {
        childTaskId: noeud.taskId,
        parentTaskId: noeud.parentTaskId,
        rootTaskId: noeud.rootTaskId,
        depth: noeud.depth,
        ancestorTaskId: lien.rootTaskId,
        reason: 'root_cost_budget_exhausted',
        depense: direDepense(depense),
        ...(descendant.assignedNodeId ? { nodeId: descendant.assignedNodeId } : {}),
      });
      this.annulerEnVol(descendant, 'root_cost_budget_exhausted', now);
    }
  }

  /**
   * Une tâche vient d'atteindre un état TERMINAL : chacun de ses descendants
   * délégués ENCORE EN VOL est annulé. Un enfant délégué n'a qu'un
   * destinataire, la tâche qui l'a demandé ; terminée (aboutie, échouée ou
   * annulée), elle n'attend plus rien. Sans cette clôture l'enfant continuait —
   * son nœud travaillait pour rien, son horloge tournait, et un petit-enfant
   * encore en file partait sur une ouvrière libre. La cascade de `dependsOn`
   * ne pouvait pas le voir : un enfant délégué en a `[]`.
   *
   * Une seule exception, et seulement quand la tâche a ABOUTI : un enfant que
   * l'Evaluator a rouvert après qu'il a livré garde sa correction (voir
   * `descendantsEnVol`). Échouée ou annulée, la tâche ne sera jamais rouverte :
   * cette correction n'aurait plus de lecteur, elle est annulée avec le reste.
   *
   * Le POURQUOI est un fait typé, `delegation_cancelled`, émis AVANT la
   * transition qu'il cause (motif `guard_refused`) ; la transition elle-même
   * reste le `task_cancelled` que la Chronique, le registre et le rejeu lisent
   * déjà. Borné par construction : `maxDescendantsPerRoot` par racine.
   *
   * Pas d'appel depuis la cascade des dépendances : une tâche `pending` n'a
   * jamais tourné, elle n'a donc jamais délégué.
   *
   * Rend les identifiants annulés : une passe d'assignation qui ferme un
   * sous-arbre en cours de route (`relecteurAbsent`) les tient encore pour
   * prêts dans son instantané, et les réassignerait `failed`.
   */
  private fermerSousArbre(
    taskId: string,
    cause: CauseAnnulationDelegation,
    now: number,
  ): readonly string[] {
    const graphe = this.store.listDelegationGraph(taskId);
    const orphelins = descendantsEnVol(graphe, taskId, cause, (id) =>
      // En vol ET déjà porteur d'un résultat retenu : l'Evaluator l'a rouvert
      // après sa livraison (seul chemin de `done` vers la file).
      this.store.aUnResultatRetenu(id),
    );
    for (const noeud of orphelins) {
      const descendant = this.store.getTask(noeud.taskId);
      if (!descendant) continue;
      this.emit('delegation_cancelled', {
        childTaskId: noeud.taskId,
        parentTaskId: noeud.parentTaskId,
        rootTaskId: noeud.rootTaskId,
        depth: noeud.depth,
        ancestorTaskId: taskId,
        reason: cause,
        ...(descendant.assignedNodeId ? { nodeId: descendant.assignedNodeId } : {}),
      });
      this.annulerEnVol(descendant, cause, now);
    }
    return orphelins.map((noeud) => noeud.taskId);
  }

  // ─── Drone Wars : redondance compétitive (opt-in, par tâche) ────────────────

  /**
   * Lance une course : la même tâche est confiée à jusqu'à `factor` nœuds
   * distincts (diversité d'agents maximisée). Le premier succès gagne, les
   * autres drones sont annulés. Uniquement sur une tâche `ready` — le circuit
   * automatique reste mono-nœud, la course est un geste explicite (API/CLI).
   */
  startRace(
    taskId: string,
    factor: number,
    now = Date.now(),
  ): { ok: true; drones: string[] } | { ok: false; error: string } {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, error: 'tâche inconnue' };
    if (this.races.has(taskId)) {
      return { ok: false, error: 'une course est déjà en vol pour cette tâche' };
    }
    if (task.status !== 'ready') {
      return {
        ok: false,
        error: `tâche ${task.status} — une course ne se lance que sur une tâche prête (ready)`,
      };
    }
    // Une contre-expertise ne se court pas. Sa valeur est d'être lue par une
    // famille PRÉCISE, et la course enrôle n'importe qui — le producteur
    // d'abord, libre puisqu'il vient de rendre : Claude relirait Claude, et
    // le verdict serait consigné sous le nom de Codex. Une relecture qui
    // attend se débloque en rendant sa famille à la ruche, pas en la courant.
    if (this.store.relectureDe(taskId)) {
      return {
        ok: false,
        error: 'contre-expertise — elle ne part qu’à sa famille relectrice, pas en course',
      };
    }
    // Balance : une course est la dépense la plus LOURDE de la ruche (la même
    // tâche confiée à N nœuds à la fois). Refus symétrique de la porte
    // d'assignation — sinon le geste explicite serait un contournement du
    // plafond, et « borner » ne voudrait plus rien dire.
    //
    // Aucun événement n'est émis ici : le refus part en réponse HTTP à l'humain
    // qui l'a demandé, immédiatement et nommément. Le journaliser en plus
    // rouvrirait la porte au bruit que la dédup de la porte referme.
    if (this.opts.balance?.mode === 'strict' && this.decisionPlafond(task.projectId) === 'bloque') {
      return { ok: false, error: 'plafond de dépense atteint pour ce projet — course refusée' };
    }
    // Sting Detector : une course ne contourne JAMAIS la prévention des
    // éditions concurrentes — même garde que l'assignation automatique,
    // littéralement : la même fonction, sur les mêmes tâches actives (celles
    // qui ÉDITENT : une relecture en vol n'en est pas, voir `activesEditrices`).
    const clash = this.conflitFortActif(task, this.activesEditrices());
    if (clash) {
      return {
        ok: false,
        error: `tâche en conflit fort avec la tâche active « ${clash.title} » — course refusée`,
      };
    }
    // La charge des drones non-primaires n'existe pas dans le store : on
    // l'ajoute ici pour ne pas enrôler des nœuds déjà saturés par une course.
    const charge = this.chargeVuePar(taskId, this.droneLoad());
    // L'OFFRE, charge ignorée, puis sa part libre : l'écart des modèles tombés
    // se décide contre la première, comme dans la boucle principale. La
    // consigne de l'opérateur la restreint d'abord : une course diversifie les
    // agents, elle ne franchit pas une exclusion (`offreSousConsigne`).
    const consigne = this.store.consigneRoutage(taskId)?.consigne ?? null;
    const offreBrute = this.store.listNodes().filter(
      (n) =>
        n.status === 'online' &&
        // LA MÊME GARDE QUE `tick` — elle manquait ici, et « présence sans
        // production » l'a rendue nécessaire.
        //
        // Tant qu'un poste sans agent réel mourait avant de s'inscrire, aucun
        // nœud simulé n'existait en production : la faille dormait. Depuis
        // que ces machines REJOIGNENT la ruche, une course lancée à la main
        // les aurait enrôlées, leur adaptateur `shell` aurait rendu un diff
        // SIMULÉ, et la course l'aurait départagé contre du code réel. Un
        // faux gagnant, dans la fonctionnalité dont tout l'objet est de
        // départager.
        //
        // La garde suit la CONFIG DU SERVEUR, pas une opinion sur `shell` :
        // en simulation assumée, les nœuds simulés courent — c'est la
        // démonstration qu'on a demandée.
        assignationProductionAutorisee(n.agentType, {
          simulation: this.opts.simulation,
        }) &&
        (this.recentRejections.get(`${taskId}:${n.id}`) ?? 0) <= now,
    );
    const offre = offreSousConsigne(offreBrute, consigne);
    const libres = offre
      .filter(
        (n) =>
          // Thermorégulation : une course MULTIPLIE la charge sur une ruche qui
          // souffre déjà — elle respecte donc la concurrence effective, comme
          // l'assignation automatique. Décision assumée : le geste explicite
          // choisit QUI travaille, jamais COMBIEN la ruche encaisse. Le
          // plancher de 1 par nœud garantit qu'une course reste possible même
          // en surchauffe.
          charge(n) < concurrenceEffective(n.maxConcurrency, this.facteurThermo),
      )
      .sort((a, b) => charge(a) - charge(b) || a.name.localeCompare(b.name));
    // Une course lancée sur une reprise suit la même règle que la boucle
    // principale : un nœud qui n'offre que des modèles tombés sur cette tâche
    // n'est pas enrôlé tant qu'un autre la porte. Chaque drone est ensuite
    // aiguillé sur SA vue du nœud, privée de ces modèles.
    const echoues = this.modelesEchoues.get(taskId);
    const reprise = repriseHorsEchecs(libres, offre, echoues);
    const { race, launch } = enlistDrones(
      createRace(taskId, factor),
      reprise.eligibles.map((n) => ({ id: n.id, agentType: n.agentType })),
    );
    if (launch.length === 0) {
      // Des nœuds libres, mais qui n'offrent que des modèles déjà tombés ici :
      // le dire, plutôt qu'un « aucun nœud » que l'écran démentirait.
      const error =
        libres.length > 0
          ? 'les nœuds libres n’offrent que des modèles qui ont déjà planté sur cette tâche — ' +
            'course refusée, la reprise attend un porteur sain'
          : consigne && offre.length === 0 && offreBrute.length > 0
            ? 'aucun nœud en ligne ne respecte la consigne de routage de l’opérateur — course refusée'
            : 'aucun nœud disponible pour la course';
      return { ok: false, error };
    }

    // Le 1er drone devient le « primaire » suivi par le store (reap/reconcile) ;
    // les autres volent en plus — leurs résultats arrivent par le même canal.
    const primary = launch[0] as string;
    // Réclamation CONDITIONNELLE, comme au tick : la tâche a été lue `ready`
    // plus haut, et on ne l'arrache pas à qui l'aurait prise entre-temps.
    const assigned = this.store.reclamerTache(
      { taskId, attendu: 'ready', nodeId: primary, branch: `hive/${taskId}` },
      now,
    );
    if (!assigned) return { ok: false, error: 'tâche introuvable ou déjà réclamée' };
    // L'Aiguillage : le modèle élu par CHAQUE drone, sur ses propres modeles —
    // hors ceux qui ont déjà échoué sur cette tâche, comme dans la boucle
    // principale. La course n'est PAS restreinte (elle maximise la diversité
    // d'agents) — on note seulement, pour re-poser le modèle du VAINQUEUR quand
    // il gagnera. Le modèle du primaire est posé DÈS MAINTENANT : tant que la
    // course court, la tâche compte comme une élection en vol (borne du
    // troupeau). Le classement de chaque drone est la RAISON de son modèle,
    // figée comme dans `task_assigned` : sans elle, le tiroir ne pouvait pas
    // dire pourquoi un drone non primaire avait lancé le modèle qui a gagné.
    const categorie = categoriser(task.title, task.prompt);
    const antecedents = this.antecedentsAiguillage();
    const vues = new Map(reprise.eligibles.map((n) => [n.id, n]));
    const modeleParDrone: Record<string, string> = {};
    const raisons: Record<string, Rang[]> = {};
    for (const droneId of launch) {
      const vue = vues.get(droneId);
      const route = vue ? aiguillerNoeuds(categorie, [vue], antecedents) : null;
      if (!route) continue;
      modeleParDrone[droneId] = route.modele;
      raisons[droneId] = route.rang.slice(0, 4);
    }
    // Les modèles tombés ici qu'un drone re-lance faute d'alternative dans la
    // ruche : la course le dit, comme la boucle principale.
    const readmis = [...new Set(Object.values(modeleParDrone))]
      .filter((m) => echoues?.has(m))
      .sort();
    const aiguillee = Object.keys(modeleParDrone).length > 0;
    if (aiguillee) race.modeleParDrone = modeleParDrone;
    if (modeleParDrone[primary]) {
      this.store.poserModeleAiguillage(taskId, modeleParDrone[primary], now);
    } else this.store.effacerModeleAiguillage(taskId);
    // L'Agent Garde-Fous : l'échelon de garde-fous gouverne TOUTE la course (le
    // mode est PAR TÂCHE, pas par drone comme le modèle), donc on le pose UNE
    // FOIS pour la tâche — il vaudra pour le drone qui gagnera, sans re-pose.
    // `null` (projet non opt-in) ⇒ rien posé, la course reste indiscernable d'avant.
    const echelonGF = this.echelonGardeFouElu(task.projectId);
    if (echelonGF) this.store.poserEchelonGardeFou(taskId, echelonGF, now);
    // La tâche part en course : elle n'est plus « différée pour conflit ».
    this.deferredByConflict.delete(taskId);
    this.races.set(taskId, race);
    this.emit('drone_race_started', {
      taskId,
      factor: race.factor,
      drones: launch,
      ...(aiguillee
        ? {
            modeles: modeleParDrone,
            categorie,
            raisons,
            versionAiguillage: VERSION_AIGUILLAGE,
          }
        : {}),
    });
    this.emit('task_assigned', {
      taskId,
      nodeId: primary,
      branch: assigned.branch,
      // Le journal garde le modèle effectivement commandé au primaire. Il ne
      // prétend pas prouver le modèle choisi par le CLI : cette preuve reste
      // attachée au résultat du nœud. Sans ce fait, Mission Control devrait
      // recroiser une table latérale et l'événement perdrait sa valeur de
      // replay. La raison suit la forme de la boucle principale, pour se lire
      // de même (`routage-vue.ts`).
      ...(modeleParDrone[primary]
        ? {
            modele: modeleParDrone[primary],
            categorie,
            raisonModele: raisons[primary],
            versionAiguillage: VERSION_AIGUILLAGE,
          }
        : {}),
      // Faits de la TÂCHE, pas du primaire : les modèles écartés de la course,
      // quel que soit le nœud qui les offrait, et ceux qu'un drone re-lance.
      ...(reprise.ecartes.length > 0 ? { modelesEcartes: reprise.ecartes } : {}),
      ...(readmis.length > 0 ? { modelesReadmis: readmis } : {}),
      // Forcée par l'opérateur : la consigne a restreint les drones enrôlés.
      ...(consigne ? { consigneOperateur: consigne } : {}),
    });
    // L'instant de l'assignation, celui que porte `updatedAt` : ouverture et
    // clôture de la session se lisent sur la même horloge que la transition.
    this.store.ouvrirHorlogeHote(assigned.projectId, assigned.id, now);
    // Une tentative par drone : chacun peut dépenser (`depenses_delegation`).
    for (const droneId of launch) this.store.ouvrirTentativeDelegation(assigned.id, droneId, now);
    // Chaque drone reçoit SON modèle élu (la course diversifie les agents).
    for (const droneId of launch) this.opts.onAssign?.(droneId, assigned, modeleParDrone[droneId]);
    return { ok: true, drones: launch };
  }

  /** Course en vol pour une tâche (lecture seule, pour l'API). */
  getRace(taskId: string): DroneRace | undefined {
    return this.races.get(taskId);
  }

  /** Toutes les courses en vol (lecture seule, pour l'API/dashboard). */
  listRaces(): DroneRace[] {
    return [...this.races.values()];
  }

  /** Arbitre le résultat d'un drone (succès → victoire ; échec → attente/échec). */
  private handleDroneResult(
    race: DroneRace,
    task: Task,
    nodeId: string,
    result: Omit<TaskResult, 'nodeId'>,
    now = Date.now(),
  ): boolean {
    if (task.status === 'done' || task.status === 'failed') {
      this.races.delete(task.id);
      this.emit('result_ignored', { taskId: task.id, nodeId, reason: 'race_task_finished' });
      return false;
    }
    // Les Gardiennes, PARITÉ EXACTE avec le circuit mono : une production creuse
    // est un drone qui a ÉCHOUÉ, pas un vainqueur. Le verdict est donc rendu
    // AVANT `recordDroneResult`, qui reçoit le succès RETENU — sans quoi la
    // course serait déjà tranchée (`won`, `decided: true`) et les drones encore
    // en vol annulés au profit d'un retour à vide. Sans cette parité, lancer une
    // course serait un contournement des Gardiennes.
    const inspection = this.renifler(task, result);
    // Comme la voie mono (G4a) : le REFUS de la course suit l'échelon de garde-fous
    // du projet (posé au lancement), pas le seul mode global. La parité qui empêche
    // la course de contourner les Gardiennes vaut donc aussi pour l'échelon élu.
    const refusee = inspection?.verdict === 'hollow' && this.modeGardiennesDe(task) === 'strict';
    const retenu = result.success && !refusee;
    const { race: updated, decision } = recordDroneResult(race, nodeId, retenu);
    if (decision.outcome === 'lost') {
      // Résultat d'un nœud non enrôlé (ou d'un drone déjà sorti de la course).
      // Rien n'entre : ni résultat, ni verdict — inspecter n'était qu'un calcul
      // pur, il ne laisse aucune trace.
      this.emit('result_ignored', { taskId: task.id, nodeId, reason: 'drone_not_in_race' });
      return false;
    }
    // Tout ce que ce résultat écrit part en UN seul geste (voir enUnSeulGeste).
    // L'état de la course EN MÉMOIRE, les annulations des perdants et
    // l'assignation suivante attendent le COMMIT : un ROLLBACK ne laisse ni
    // course tranchée que la base n'a jamais vue, ni perdant annulé pour rien.
    const trancher = (): void => {
      this.apresCommit(() => this.races.set(task.id, updated));
      const resultId = this.store.insertResult({ ...result, nodeId, success: retenu });
      if (inspection) this.rangerInspection(inspection, resultId, task.id, nodeId, refusee);
      this.rangerValidations(result.validations, resultId, task, nodeId);
      // Parité avec la voie mono : le modèle de ce drone a échoué sur la tâche —
      // si la course s'éteint, la reprise ne le ré-élira pas.
      if (!retenu) {
        this.apresCommit(() => this.ecarterModele(task.id, race.modeleParDrone?.[nodeId]));
      }

      if (decision.outcome === 'won') {
        this.apresCommit(() => {
          this.races.delete(task.id);
          this.infraRejects.delete(task.id);
        });
        this.store.fermerHorlogeHote(task.id, now);
        this.store.patchTask(
          task.id,
          {
            status: 'done',
            assignedNodeId: nodeId,
            result: {
              success: true,
              nodeId,
              durationMs: result.durationMs,
              ...(result.usage ? { usage: result.usage } : {}),
            },
          },
          now,
        );
        // L'Aiguillage : c'est la production du VAINQUEUR que la contre-visite
        // jugera — on re-pose SON modèle (écrase celui du primaire posé au départ).
        // `won` précède toujours le verdict, donc la jointure lira le bon couple.
        const modeleVainqueur = race.modeleParDrone?.[nodeId];
        this.apresCommit(() => this.reintegrerModele(task.id, modeleVainqueur));
        if (modeleVainqueur) {
          this.store.poserModeleAiguillage(task.id, modeleVainqueur, now);
        } else {
          this.store.effacerModeleAiguillage(task.id);
        }
        this.emit('task_done', {
          taskId: task.id,
          nodeId,
          durationMs: result.durationMs,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
        });
        // Le modèle du VAINQUEUR, fait consigné là où il se décide : le tiroir
        // et la Chronique nomment le modèle qui a gagné sans recroiser la course.
        this.emit('drone_won', {
          taskId: task.id,
          nodeId,
          cancelled: decision.cancel.length,
          ...(modeleVainqueur ? { modele: modeleVainqueur } : {}),
        });
        for (const loser of decision.cancel) {
          this.emit('drone_cancelled', { taskId: task.id, nodeId: loser });
          this.apresCommit(() => this.opts.onCancel?.(loser, task.id, 'course de drones perdue'));
        }
        // Hive Mind : même parité que le circuit normal — la victoire PROPOSE
        // un souvenir, fait de la réponse finale quand il y en a une.
        this.proposerSouvenir(task, resultId, result, now);
        this.fermerSousArbre(task.id, 'ancestor_done', now);
        this.apresCommit(() => this.promoteAndAssign(now));
        return;
      }

      if (decision.outcome === 'pending') {
        // Ce drone a échoué mais d'autres volent encore : la course continue. Sa
        // déclaration voyage avec le fait, comme sur `task_retry` : le registre
        // Genome compte cette tentative rendue sous le modèle de CE drone.
        this.emit('drone_failed', {
          taskId: task.id,
          nodeId,
          ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
        });
        if (task.assignedNodeId === nodeId) this.promoteNextDrone(updated, task.id, now);
        return;
      }

      // all_failed via un VRAI résultat : l'agent a tourné — tentative brûlée,
      // circuit d'échec normal (retry ou failed définitif).
      this.apresCommit(() => this.races.delete(task.id));
      this.store.fermerHorlogeHote(task.id, now);
      this.emit('drone_all_failed', { taskId: task.id, drones: updated.drones.length });
      const attempts = task.attempts + 1;
      // Même enrichissement que le circuit mono : une course perdue coûte au
      // moins aussi cher qu'une tentative solitaire, elle doit se peser pareil.
      const durationMs = Math.max(0, result.durationMs);
      if (attempts >= this.maxAttempts) {
        this.store.patchTask(task.id, {
          status: 'failed',
          attempts,
          assignedNodeId: null,
          result: {
            success: false,
            nodeId,
            durationMs: result.durationMs,
            ...(result.usage ? { usage: result.usage } : {}),
          },
        });
        this.emit('task_failed', {
          taskId: task.id,
          nodeId,
          attempts,
          durationMs,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
        });
        this.fermerSousArbre(task.id, 'ancestor_failed', now);
      } else {
        this.store.patchTask(task.id, { status: 'ready', attempts, assignedNodeId: null });
        this.emit('task_retry', {
          taskId: task.id,
          nodeId,
          attempt: attempts,
          maxAttempts: this.maxAttempts,
          durationMs,
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
        });
      }
      this.apresCommit(() => this.promoteAndAssign(now));
    };
    this.enUnSeulGeste(() => {
      trancher();
      // Après l'arbitrage, comme sur la voie mono : chaque drone rendu a coûté,
      // et une course encore en vol s'arrête avec l'enveloppe épuisée.
      this.tenirBudgetCoutRacine(task.id, result.fournisseur?.coutUsd, now);
    });
    return true;
  }

  /**
   * Le drone primaire est tombé (échec, refus, déconnexion) mais la course
   * continue : un autre drone en vol devient le primaire suivi par le store.
   * Promu en `assigned` (pas `running`) : le statut running n'est jamais
   * fabriqué sans preuve — le filet staleAssignedTasks reste armé, et le vrai
   * task_update du promu refera assigned→running comme d'habitude.
   */
  private promoteNextDrone(race: DroneRace, taskId: string, now: number): void {
    const next = runningDrones(race)[0];
    if (next) {
      this.store.patchTask(taskId, { status: 'assigned', assignedNodeId: next }, now);
      // Le producteur suivi change : l'élection en vol suit, pour que la borne du
      // troupeau attribue la tâche au modèle qui la porte VRAIMENT désormais.
      const modelePromu = race.modeleParDrone?.[next];
      if (modelePromu) {
        this.store.poserModeleAiguillage(taskId, modelePromu, now);
      } else {
        this.store.effacerModeleAiguillage(taskId);
      }
      this.emit('drone_promoted', { taskId, nodeId: next });
    }
  }

  /**
   * Charge « fantôme » par nœud : les drones NON-primaires en vol n'existent
   * pas dans le store (mono-assignation) — sans ce complément, l'assignation
   * et les courses suivantes sur-réserveraient des nœuds déjà occupés.
   */
  private droneLoad(): Map<string, number> {
    const load = new Map<string, number>();
    for (const race of this.races.values()) {
      const task = this.store.getTask(race.taskId);
      for (const d of race.drones) {
        if (d.status !== 'running') continue;
        if (task?.assignedNodeId === d.nodeId) continue; // primaire déjà compté par le store
        load.set(d.nodeId, (load.get(d.nodeId) ?? 0) + 1);
      }
    }
    return load;
  }

  /**
   * Un nœud vient de mourir (reap/déconnexion) : ses drones échouent. Appelé
   * AVANT la requalification générique — une course qui continue promeut un
   * nouveau primaire (la tâche reste en vol), une course éteinte requalifie la
   * tâche en ready SANS brûler de tentative (perte d'infrastructure, pas d'échec
   * de l'agent).
   */
  private failDronesOfNode(nodeId: string, now: number, vuVivantA: number): void {
    for (const taskId of [...this.races.keys()]) {
      this.dropDrone(taskId, nodeId, 'node_lost', now, vuVivantA);
    }
  }

  // ─── Interne ───────────────────────────────────────────────────────────────
  private promoteAndAssign(now = Date.now()): void {
    this.promotePendingTasks(now);
    this.assignReadyTasks(now);
  }

  /**
   * pending → ready quand toutes les dépendances sont done.
   * Si une dépendance a échoué (ou n'existe pas), la tâche échoue en cascade.
   * Boucle jusqu'au point fixe pour propager les échecs en chaîne.
   */
  private promotePendingTasks(now = Date.now()): void {
    let changed = true;
    while (changed) {
      changed = false;
      const pending = this.store.tasksByStatus('pending');
      if (pending.length === 0) return;
      // Statuts des SEULES dépendances citées (lecture par clé primaire) : le
      // dépliage de toute la table `tasks` à chaque passe — et il y en a une
      // par nœud fauché — gelait l'orchestrateur à 100 000 tâches.
      const attendues = new Set<string>();
      for (const task of pending) for (const dep of task.dependsOn) attendues.add(dep);
      const statuts = this.store.taskStatuses([...attendues]);
      for (const task of pending) {
        const deps = task.dependsOn.map((id) => statuts.get(id));
        if (deps.some((d) => d === undefined || d === 'failed')) {
          this.store.patchTask(task.id, { status: 'failed' }, now);
          this.emit('task_failed', { taskId: task.id, reason: 'dependency_failed' });
          changed = true;
          continue;
        }
        if (deps.every((d) => d === 'done')) {
          this.store.patchTask(task.id, { status: 'ready' }, now);
          this.emit('task_ready', { taskId: task.id });
          changed = true;
        }
      }
    }
  }

  /**
   * Fait avancer le grand livre de la Balance en lisant les résultats NOUVEAUX
   * depuis le filigrane. Le compteur suit la TABLE, pas les sites d'appel de
   * `insertResult` : un troisième site d'écriture ajouté dans cinq ans ne peut
   * pas le dérégler. C'est un invariant STRUCTUREL, pas une discipline —
   * c'était la principale réserve contre un accumulateur incrémental.
   *
   * Coût borné : ≤ LOT_GRAND_LIVRE lignes d'un index COUVRANT par passe ; zéro
   * ligne et une seule sonde en régime établi. Jamais de SELECT non borné sur
   * le chemin du tick.
   *
   * Ce comptage n'a AUCUN effet sur l'ordonnancement : il ne décide rien, il
   * observe. La porte qui s'en servira un jour est un travail séparé.
   */
  private avancerGrandLivre(now: number): void {
    if (this.opts.balance?.mode === 'off') return;
    this.reprendreCacheGrandLivre();
    const lot = this.store.listResultsForLedger(this.livre.filigrane, LOT_GRAND_LIVRE);
    if (lot.length === 0) {
      this.livre.marquerRattrape();
      // Rien de neuf, mais une sauvegarde peut rester due : la précédente a pu
      // être refusée par l'intervalle. Sans cette ligne, le dernier lot absorbé
      // avant un arrêt serait relu au démarrage suivant, pour rien.
      this.sauvegarderCacheGrandLivre(now);
      return;
    }
    const projets = this.cacheProjets.resoudre(
      lot.map((r) => r.taskId),
      (manquants) => this.store.listTaskProjects(manquants),
    );
    // Une tentative dont la tâche a disparu est retirée du COMPTE (aucun projet
    // à qui l'imputer) mais PAS du PARCOURS : le filigrane la dépasse quand
    // même, sinon le rattrapage bouclerait sur elle à chaque tick, sans fin.
    const dernier = lot[lot.length - 1]?.id ?? 0;
    this.livre.absorber(
      lot.flatMap((r) => {
        const projectId = projets.get(r.taskId);
        return projectId ? [{ id: r.id, projectId, durationMs: r.durationMs }] : [];
      }),
      dernier,
    );
    // Lot incomplet ⇒ le livre a rejoint la fin de la table.
    if (lot.length < LOT_GRAND_LIVRE) this.livre.marquerRattrape();
    this.sauvegarderCacheGrandLivre(now);
  }

  /**
   * Reprend l'instantané du grand livre, UNE SEULE FOIS, au premier tick qui
   * fait tourner le livre — jamais dans le constructeur : construire un
   * Scheduler ne doit pas toucher la base, et un livre non encore démarré doit
   * se lire comme vide (`soldes: []`, `aJour: false`), ce qu'attend l'affichage.
   *
   * En mode `off` on n'arrive jamais ici : le livre ne tourne pas, donc rien
   * n'est ni lu ni écrit.
   */
  private reprendreCacheGrandLivre(): void {
    if (this.livreRepris) return;
    this.livreRepris = true;
    const cache = this.store.lireCacheGrandLivre();
    if (!cache) return;
    this.livre.charger(cache.filigrane, cache.soldes);
    this.filigraneSauve = cache.filigrane;
  }

  /**
   * Écrit l'instantané, au plus une fois par INTERVALLE_SAUVEGARDE_LIVRE_MS et
   * seulement si le filigrane a bougé. Un cache en retard n'est pas faux : le
   * rattrapage reprend simplement quelques lots plus tôt.
   */
  private sauvegarderCacheGrandLivre(now: number): void {
    const filigrane = this.livre.filigrane;
    if (filigrane === this.filigraneSauve) return;
    if (now - this.derniereSauvegardeLivre < INTERVALLE_SAUVEGARDE_LIVRE_MS) return;
    this.store.ecrireCacheGrandLivre(filigrane, this.livre.soldes());
    this.filigraneSauve = filigrane;
    this.derniereSauvegardeLivre = now;
  }

  /**
   * Les antécédents de l'Aiguillage : le vécu jugé (verdicts) PLUS les élections
   * en vol comptées comme essais sans note (la borne du troupeau). Bâti à neuf à
   * chaque appel — les appelants qui le veulent stable le mémoïsent (la boucle
   * d'assignation) ; la course de drones, elle, n'en a besoin qu'une fois.
   */
  private antecedentsAiguillage(): Map<string, Antecedent> {
    // Le repli canonique, partagé avec `/api/workers` : le modèle PROUVÉ gouverne
    // l'apprentissage dès qu'il existe (cf. `antecedentsDuVecu`).
    return antecedentsDuVecu(
      this.store.observationsAiguillage(),
      this.store.electionsEnVolAiguillage(),
    );
  }

  /**
   * Les antécédents de l'Agent Garde-Fous, repliés par échelon depuis les
   * productions TRANCHÉES (`observationsGardeFou`). Une production encore en vol
   * (ni contre-visite ni exigence) rend `null` et ne pèse pas (`observationDepuisFaits`).
   */
  private antecedentsGardeFou(): Map<Echelon, Antecedent> {
    const observees = this.store
      .observationsGardeFou()
      .map(observationDepuisFaits)
      .filter((o): o is ObservationGardeFou => o !== null);
    return replierAntecedentsGardeFou(observees);
  }

  /**
   * L'échelon de garde-fous élu pour un projet, ou `null` s'il n'a pas opt-in
   * (`getGardeFou` absent ou `actif` faux). Élit DANS les bornes que l'humain a
   * posées — le module ne les invente jamais. Bornes illisibles ⇒ repli sur le
   * plus strict (fermé par défaut).
   */
  private echelonGardeFouElu(projectId: string): Echelon | null {
    const consentement = this.store.getGardeFou(projectId);
    if (!consentement?.actif) return null;
    const min = versEchelon(consentement.borneMin) ?? 'strict';
    const max = versEchelon(consentement.borneMax) ?? 'strict';
    return elireEchelon({ min, max }, this.antecedentsGardeFou());
  }

  /**
   * POUR LE TABLEAU DE BORD : le classement des échelons PERMIS d'un projet — le
   * premier est l'ÉLU. `[]` si le projet n'a pas opt-in. Lecture seule, motif
   * `get gardiennes` / `get balance` : le tableau montre ce que la ruche a appris
   * (moyenne, essais, score par échelon), et l'humain voit POURQUOI tel échelon
   * gouverne. Bornes illisibles ⇒ le plus strict, comme à l'élection.
   */
  classementGardeFou(projectId: string): RangGardeFou[] {
    const consentement = this.store.getGardeFou(projectId);
    if (!consentement?.actif) return [];
    const min = versEchelon(consentement.borneMin) ?? 'strict';
    const max = versEchelon(consentement.borneMax) ?? 'strict';
    return classerEchelons(echelonsPermis({ min, max }), this.antecedentsGardeFou());
  }

  /**
   * La famille relectrice de cette relecture est-elle ABSENTE — aucun nœud en
   * ligne pour la lire ? Vrai : la relecture ne part pas à cette passe.
   *
   * ─── ATTENDRE SE DIT, ET S'ARRÊTE ────────────────────────────────────────
   *
   * Saturée, la famille reviendra d'elle-même : la relecture attend son tour,
   * sans bruit, comme toute tâche. ABSENTE, rien ne garantit qu'elle revienne
   * — une ouvrière ajoutée est facultative (`scripts/ruche.mjs`), et un
   * redémarrage en `--une-ouvriere` ne la relance pas. Deux faits donc :
   *
   *   · au premier constat, `contre_expertise_review_waiting` — UNE fois,
   *     motif `deferredByConflict` : le journal dit qui l'on attend ;
   *   · au-delà de `ATTENTE_RELECTEUR_ABSENT_MS`, la relecture ÉCHOUE, dite
   *     par `task_failed` et par `contre_expertise_review_failed`
   *     (`terminal`, motif `relecteur_absent`) : les deux faits que le hub
   *     émet déjà pour une relecture qui échoue en rendant son résultat.
   *
   * Échouer, pas réaffecter : cette relecture reste épinglée à SA famille.
   * La confier ici à une autre, ce serait parfois donner une seconde lecture
   * à une famille qui relit déjà ce résultat (`choisirCritiques` en a engagé
   * une par famille en ligne, jusqu'à `RELECTEURS_PAR_PRODUCTION`) — une
   * contre-revue qui compte deux relectrices là où un seul modèle a lu
   * (`crossReviewForResult`). Une famille revenue à temps reprend la
   * relecture, quel que soit son nœud. Le relais par une famille NEUVE est
   * une relecture de secours distincte, décidée par le hub une fois la
   * contre-revue sans avis ni relecture en vol (`suiteRelectureEchouee`).
   *
   * Cet échec est une transition terminale comme les autres : il ferme le
   * sous-arbre délégué de la relecture (`fermerSousArbre`) — un relecteur
   * tombé a pu déléguer avant de tomber, et ses enfants n'auraient plus de
   * destinataire. Les descendants annulés entrent dans `fermees`, que la
   * passe en cours consulte avant d'assigner.
   */
  private relecteurAbsent(
    task: Task,
    lien: LienRelecture,
    noeuds: readonly HiveNode[],
    now: number,
    fermees: Set<string>,
  ): boolean {
    if (noeuds.some((n) => n.status === 'online' && n.agentType === lien.relecteurAgent)) {
      this.relecturesSansRelecteur.delete(task.id);
      return false;
    }
    const depuis = this.relecturesSansRelecteur.get(task.id);
    if (depuis === undefined) {
      this.relecturesSansRelecteur.set(task.id, now);
      this.emit('contre_expertise_review_waiting', {
        taskId: lien.productionTaskId,
        relecture: task.id,
        relecteur: lien.relecteurAgent,
        reviewerNodeId: lien.relecteurNodeId,
        delaiMs: ATTENTE_RELECTEUR_ABSENT_MS,
      });
      return true;
    }
    if (now - depuis < ATTENTE_RELECTEUR_ABSENT_MS) return true;

    this.relecturesSansRelecteur.delete(task.id);
    // Terminale, elle n'est plus jamais réévaluée : ses refus d'infrastructure
    // ne seraient plus purgés par personne (même règle qu'`annulerEnVol`).
    this.infraRejects.delete(task.id);
    this.store.patchTask(task.id, { status: 'failed', assignedNodeId: null }, now);
    this.emit('task_failed', { taskId: task.id, reason: 'relecteur_absent' });
    for (const id of this.fermerSousArbre(task.id, 'ancestor_failed', now)) fermees.add(id);
    this.relectureCloseSansAvis(task, 'relecteur_absent', lien);
    return true;
  }

  /**
   * Une relecture vient de passer TERMINALE sans rendre d'avis : le fait
   * `contre_expertise_review_failed` (`terminal`) le dit, avec son motif.
   *
   * C'est le déclencheur UNIQUE de la suite (relecture de secours, ou revue
   * humaine nommée — `reprendreContreRevue`, server.ts). Chaque chemin qui
   * clôt une relecture sans avis passe donc par ici : l'absence de famille,
   * l'agent qui ne démarre sur aucun nœud (`aucun_agent_fonctionnel`),
   * l'annulation. Un chemin qui l'oublierait laisserait la production en
   * suspens sans un mot — le silence même que ce fait existe pour fermer.
   *
   * Émis APRÈS la transition : la suite relit les relectures en vol, et
   * celle-ci ne doit plus en être. Sans effet sur une tâche qui n'est pas une
   * relecture.
   */
  private relectureCloseSansAvis(
    task: Task,
    motif: 'relecteur_absent' | 'aucun_agent_fonctionnel' | 'annulee',
    lien = this.store.relectureDe(task.id),
  ): void {
    if (!lien) return;
    // Le `resultId` du lancement, comme le hub le joint à ses propres échecs
    // de relecture : il dit QUELLE tentative de la production perd son avis.
    const resultId = this.store.eventForRelecture(task.id)?.payload.resultId;
    this.emit('contre_expertise_review_failed', {
      taskId: lien.productionTaskId,
      ...(typeof resultId === 'number' && Number.isSafeInteger(resultId) ? { resultId } : {}),
      relecture: task.id,
      relecteur: lien.relecteurAgent,
      terminal: true,
      attempt: task.attempts,
      motif,
    });
  }

  /**
   * Les tâches actives qui ÉDITENT — celles que le Sting Detector sérialise.
   *
   * Une relecture n'en est pas : elle rend un verdict sur un diff qu'elle CITE
   * (`consigneDeCritique`), et un fichier cité n'est pas un fichier touché. La
   * compter, c'était sérialiser les relectrices d'une même production — leurs
   * consignes citent les mêmes fichiers — et retenir toute production du
   * projet qui les cite aussi, le temps d'une relecture qui ne modifie rien.
   */
  private activesEditrices(): Task[] {
    return this.store
      .tasksByStatus('assigned', 'running')
      .filter((t) => this.store.relectureDe(t.id) === null);
  }

  /**
   * `ancetre` est-elle un ancêtre de `taskId` dans le graphe de délégation ?
   *
   * Un parent qui délègue reste `running` : il ATTEND le résultat de son
   * enfant. Or il décrit forcément ce qu'il délègue — donc les mêmes chemins —
   * et le Sting Detector y voyait un conflit FORT. Différer l'enfant jusqu'à la
   * fin du parent était un interblocage : le parent n'obtenait sa réponse
   * qu'en épuisant son budget. Le différer n'évite d'ailleurs aucun conflit :
   * chacun travaille dans son atelier, et c'est le parent qui reçoit le diff
   * de l'enfant. Consulté seulement sur un conflit fort déjà constaté : le
   * chemin ordinaire ne paie aucune lecture.
   */
  private estAncetre(ancetre: string, taskId: string): boolean {
    // `vus` borne la remontée même sur un graphe corrompu : la profondeur
    // légitime est déjà plafonnée par `LIMITES_DELEGATION_DEFAUT.maxDepth`.
    const vus = new Set<string>();
    let lien = this.store.getDelegation(taskId);
    while (lien && !vus.has(lien.parentTaskId)) {
      if (lien.parentTaskId === ancetre) return true;
      vus.add(lien.parentTaskId);
      lien = this.store.getDelegation(lien.parentTaskId);
    }
    return false;
  }

  /**
   * La tâche active avec laquelle `task` est en conflit FORT (Sting
   * Detector), hors de ses propres ancêtres de délégation (`estAncetre`) — ou
   * `undefined`.
   *
   * UNE garde pour l'assignation automatique ET pour la course : deux copies
   * avaient déjà divergé — la course refusait l'enfant délégué que
   * l'assignation lançait, alors que son commentaire promettait « la même
   * garde ». Une seule fonction ne peut plus diverger d'elle-même.
   */
  private conflitFortActif(task: Task, actives: readonly Task[]): Task | undefined {
    return actives.find(
      (t) =>
        t.projectId === task.projectId &&
        t.id !== task.id &&
        analyzePair(task, t).severity === 'high' &&
        !this.estAncetre(t.id, task.id),
    );
  }

  /** ready → assigned sur le nœud online le moins chargé qui a encore de la capacité. */
  private assignReadyTasks(now = Date.now()): void {
    // Balance : le livre avance AVANT toute décision, pour que la lecture
    // exposée par `get balance` ne soit jamais en retard d'un tick. Il
    // n'influence rien ici — voir la règle 4 de la doctrine (balance.ts).
    this.avancerGrandLivre(now);
    // Tâches déjà actives, enrichie au fil de la passe : une tâche qu'on vient
    // d'assigner doit être prise en compte pour la détection de conflit des
    // suivantes (sinon deux tâches ready mutuellement conflictuelles passeraient).
    const activeNow = this.activesEditrices();
    // Drones non-primaires en vol : charge invisible du store, à additionner.
    const extra = this.droneLoad();
    // Phéromones : calculées au plus UNE fois par passe, et seulement si un
    // départage est réellement nécessaire (≥ 2 candidats à charge minimale).
    // Le corpus est BORNÉ de bout en bout : ≤ 500 résultats récents, dont on ne
    // résout le domaine que pour les taskId réellement cités (lecture par clé
    // primaire, mémoïsée). Déplier toute la table `tasks` pour n'en garder que
    // 0,5 % gelait l'orchestrateur à 100 000 tâches.
    let traces: TraceePheromone[] | null = null;
    const lireTraces = (): TraceePheromone[] => {
      if (traces) return traces;
      const resultats = this.store.listResultsForPheromones();
      const domaines = this.cacheDomaines.domaines(
        resultats.map((r) => r.taskId),
        (manquants) => this.store.listTaskTexts(manquants),
      );
      traces = replierTraces(domaines, resultats, now);
      return traces;
    };
    // Antécédents de l'Aiguillage : repliés au plus UNE fois par passe, et
    // seulement si un nœud éligible déclare des modèles (sinon `aiguillerNoeuds`
    // rend `null` sans même les demander — zéro lecture SQL neuve). La catégorie
    // n'est jamais stockée : on la RECALCULE à la lecture (`categoriser`), pour
    // que la taxonomie du jour s'applique au vécu ancien.
    let antecedents: Map<string, Antecedent> | null = null;
    const lireAntecedents = (): Map<string, Antecedent> => {
      antecedents ??= this.antecedentsAiguillage();
      return antecedents;
    };
    // ─── LES RELECTURES D'ABORD ────────────────────────────────────────────
    // Une relecture achève un travail DÉJÀ payé ; une production prête est une
    // dépense neuve. En file par date de création, une relecture passait
    // derrière toutes les productions plus anciennes — sur une mission de dix
    // tâches, les contre-revues (et les corrections de l'Evaluator qu'elles
    // déclenchent) s'entassaient en fin de mission. Le tri est STABLE : l'ordre
    // de création tient dans chaque groupe. Pas de famine possible : une
    // production n'ouvre qu'au plus `RELECTEURS_PAR_PRODUCTION` relectures.
    const pretes = this.store
      .tasksByStatus('ready')
      .map((task) => ({ task, lien: this.store.relectureDe(task.id) }))
      .sort((a, b) => Number(b.lien !== null) - Number(a.lien !== null));
    if (this.relecturesSansRelecteur.size > 0) {
      const enFile = new Set(pretes.map((p) => p.task.id));
      for (const id of this.relecturesSansRelecteur.keys()) {
        if (!enFile.has(id)) this.relecturesSansRelecteur.delete(id);
      }
    }
    // `pretes` est un instantané : une relecture qui échoue à cette passe
    // (`relecteurAbsent`) annule ses descendants délégués, que l'instantané
    // tient encore pour prêts. Sans ce registre, la suite de la boucle
    // réassignerait une tâche `failed` — les relectures passent en tête, leurs
    // descendants après.
    const fermees = new Set<string>();
    for (const { task, lien } of pretes) {
      if (fermees.has(task.id)) continue;
      // Sting Detector : ne pas lancer une tâche en conflit FORT (même fichier)
      // avec une tâche déjà active du même projet. On la diffère jusqu'à ce que
      // l'autre se termine — prévention des conflits d'édition concurrents.
      // Une relecture n'édite rien : voir `activesEditrices`. Un enfant délégué
      // n'attend pas derrière ses propres ancêtres : voir `conflitFortActif`.
      const clash = lien === null ? this.conflitFortActif(task, activeNow) : undefined;
      if (clash) {
        if (!this.deferredByConflict.has(task.id)) {
          this.deferredByConflict.add(task.id);
          this.emit('task_conflict_deferred', { taskId: task.id, conflictsWith: clash.id });
        }
        continue;
      }
      this.deferredByConflict.delete(task.id);
      // ─── La Balance : la PORTE ───────────────────────────────────────────
      // Elle décide SI une tâche de ce projet part, jamais À QUEL NŒUD : la
      // décision est prise ici, AVANT que la moindre liste de nœuds existe, et
      // aucune valeur issue du grand livre ne descend plus bas dans cette
      // boucle (doctrine, règle 4 — verrouillé par tests/security-invariants).
      //
      // Ce que la porte ne fait JAMAIS : tuer une tâche en vol (les tâches
      // déjà parties vont à leur terme), toucher un autre projet (la boucle
      // continue), ni bloquer un merge (geste humain, hors périmètre).
      const decision = this.decisionPlafond(task.projectId);
      this.signalerPlafond(task.projectId, decision);
      if (decision === 'bloque' && this.opts.balance?.mode === 'strict') continue;
      const charge = this.chargeVuePar(task.id, extra);
      const noeuds = this.store.listNodes();
      // ─── UNE RELECTURE NE CHANGE PAS DE FAMILLE ──────────────────────────
      // Une contre-expertise vaut par la famille qui la lit : un modèle
      // DIFFÉRENT du producteur (`choisirCritiques`). La file ne le savait
      // pas : revenue en file — relecteur saturé qui refuse, ou déconnecté —,
      // elle partait au premier nœud libre, souvent le PRODUCTEUR, qui relisait
      // alors son propre travail sous le nom d'une autre famille. Seule SA
      // famille la prend donc — n'importe quel nœud de celle-ci : le verdict
      // est attribué au nœud qui le rend (serveur, `task_result`).
      //
      // Et ce nœud doit rester INDÉPENDANT du producteur (`relecteurIndependant`,
      // la même règle que le choix des relecteurs et le décompte de
      // l'Evaluator) : la famille désignée l'est par construction, la garde
      // tient même pour un lien qui ne le serait pas. Aucun relecteur
      // indépendant libre : la relecture attend en file, et l'Evaluator la
      // compte en vol plutôt que d'accepter sans elle.
      //
      // Une famille ABSENTE ne se laisse pas attendre en silence : voir
      // `relecteurAbsent`.
      if (lien !== null && this.relecteurAbsent(task, lien, noeuds, now, fermees)) continue;
      // L'OFFRE pour cette tâche : les nœuds qui pourraient la porter, charge
      // ignorée. C'est contre elle que se décide l'écart des modèles tombés
      // (`repriseHorsEchecs`) : un porteur sain seulement occupé se libérera.
      const offreBrute = noeuds.filter(
        (n) =>
          (lien === null || n.agentType === lien.relecteurAgent) &&
          n.status === 'online' &&
          assignationProductionAutorisee(n.agentType, {
            simulation: this.opts.simulation,
          }) &&
          (lien === null || relecteurIndependant(n.agentType, lien.producteurAgent)) &&
          // Ne pas ré-assigner aussitôt une tâche que ce nœud vient de refuser.
          (this.recentRejections.get(`${task.id}:${n.id}`) ?? 0) <= now,
      );
      // ─── LA CONSIGNE DE L'OPÉRATEUR, AVANT TOUT CHOIX ────────────────────
      // Une exclusion DURE (`offreSousConsigne`) : ni l'Aiguillage, ni l'écart
      // des modèles tombés, ni la préférence d'une tâche parente ne la
      // franchissent. Une relecture n'en a pas : sa famille est déjà imposée
      // par la contre-expertise, et la route refuse d'y en poser une.
      const consigne =
        lien === null ? (this.store.consigneRoutage(task.id)?.consigne ?? null) : null;
      const offre = offreSousConsigne(offreBrute, consigne);
      if (consigne && offre.length === 0 && offreBrute.length > 0) {
        // Des nœuds pourraient la porter, la consigne les écarte tous : la
        // tâche attend — et le dit une fois, au lieu de rester muette en file.
        const empreinte = JSON.stringify(consigne);
        if (this.differeesParConsigne.get(task.id) !== empreinte) {
          this.differeesParConsigne.set(task.id, empreinte);
          this.emit('task_consigne_deferred', { taskId: task.id, consigne });
        }
        continue;
      }
      this.differeesParConsigne.delete(task.id);
      // Les préférences de la tâche PARENTE, pour un enfant délégué : un
      // départage entre ex æquo, plus bas — jamais une exclusion.
      const preference = lien === null ? this.preferenceDelegation(task.id) : null;
      const eligibles = offre
        .filter(
          (n) =>
            // Thermorégulation : sous ventilation, la capacité de chaque nœud
            // est réduite par le facteur en vigueur (plancher 1 — la ruche ne
            // s'arrête pas, elle ralentit).
            charge(n) < concurrenceEffective(n.maxConcurrency, this.facteurThermo),
        )
        .sort((a, b) => charge(a) - charge(b) || a.name.localeCompare(b.name));
      // Une reprise ne ré-élit pas un modèle qui a planté sur cette tâche tant
      // qu'un autre nœud de l'offre la porte : les éligibles sont réduits à ses
      // porteurs — vides si aucun n'est libre, et la tâche attend une place.
      const echoues = this.modelesEchoues.get(task.id);
      const reprise = repriseHorsEchecs(eligibles, offre, echoues);
      // ─── L'Aiguillage appris : le MODÈLE, avant le nœud ──────────────────
      // Parmi les éligibles (déjà filtrés par charge et triés), on restreint à
      // ceux qui offrent le meilleur modèle pour le genre de la tâche. `null`
      // (aucun éligible ne déclare de modèle) ⇒ NO-OP : on garde la liste et
      // l'ordonnancement d'avant, phéromones comprises. La sous-liste préserve
      // l'ordre de charge, donc le départage plus bas reste inchangé.
      const route = aiguillerNoeuds(
        categoriser(task.title, task.prompt),
        reprise.eligibles,
        lireAntecedents(),
        preference?.modele,
      );
      const candidats = route ? route.noeuds : reprise.eligibles;
      let node = candidats[0];
      if (!node) continue; // aucun nœud éligible pour CETTE tâche (essayer les suivantes)
      // Phéromones : le critère principal « moins chargé » reste intact — elles
      // ne DÉPARTAGENT que les ex æquo à charge minimale, et seulement sur un
      // signal net (score strictement positif et sans égalité).
      let routePheromone: { domaine: Domaine; score: number } | null = null;
      const chargeMin = charge(node);
      // Départage phéromones SUR LES CANDIDATS restreints par l'Aiguillage : un
      // nœud écarté parce qu'il n'offre pas le modèle élu ne doit pas revenir par
      // la porte des phéromones.
      let exAequo = candidats.filter((n) => charge(n) === chargeMin);
      // La famille préférée par la tâche parente départage les ex æquo à
      // charge minimale, AVANT les phéromones : c'est une intention dite, les
      // phéromones un signal appris. Elle ne départage que ce qui est à égalité
      // — le moins chargé reste le moins chargé.
      const preferes = preference?.agent
        ? exAequo.filter((n) => n.agentType === preference.agent)
        : [];
      const departageAgent = preferes.length > 0 && preferes.length < exAequo.length;
      if (departageAgent) {
        exAequo = preferes;
        node = preferes[0] ?? node;
      }
      if (exAequo.length >= 2) {
        const domaine = this.cacheDomaines.domaine(task);
        const elu = meilleurNoeud(
          exAequo.map((n) => n.id),
          domaine,
          lireTraces(),
        );
        const gagnant = elu === null ? undefined : exAequo.find((n) => n.id === elu);
        if (gagnant) {
          node = gagnant;
          const score =
            lireTraces().find((t) => t.nodeId === gagnant.id && t.domaine === domaine)?.score ?? 0;
          routePheromone = { domaine, score };
        }
      }
      // Réclamation CONDITIONNELLE : la liste `ready` a été lue en début de
      // passe, et `onAssign` (plus bas) rend la main au serveur entre deux
      // tâches. Une tâche prise entre-temps n'est plus `ready` : la
      // réclamation échoue et on passe, au lieu de l'envoyer à un second nœud.
      const assigned = this.store.reclamerTache(
        { taskId: task.id, attendu: 'ready', nodeId: node.id, branch: `hive/${task.id}` },
        now,
      );
      if (!assigned) continue;
      // On enregistre le modèle COMMANDÉ (pas prouvé exécuté — l'écho du modèle
      // effectif par le nœud est un lot ultérieur), et SEULEMENT quand
      // l'Aiguillage a réellement choisi : jamais avant le patch (un patch raté
      // poserait un modèle fantôme), jamais au résultat (une ré-assignation doit
      // écraser, c'est le contrat « la dernière assignation gagne » qui aligne
      // dernier modèle et dernier verdict).
      if (route) {
        this.store.poserModeleAiguillage(task.id, route.modele, now);
      } else {
        // Une réassignation sans élection revient au modèle par défaut du
        // nouveau nœud : l'ancienne élection ne doit pas survivre à la tâche.
        this.store.effacerModeleAiguillage(task.id);
      }
      // L'Agent Garde-Fous : si le projet a opt-in, on élit et on POSE l'échelon
      // de garde-fous — c'est lui qui gouvernera la sévérité des Gardiennes de
      // cette production (lu par `modeGardiennesDe` à la réception). Après le patch
      // réussi, comme le modèle : un patch raté ne poserait aucun échelon fantôme,
      // et une ré-assignation écrase (la dernière gouverne). `null` (projet non
      // opt-in) ⇒ rien n'est posé ⇒ la ruche reste indiscernable de celle d'avant.
      const echelonGF = this.echelonGardeFouElu(task.projectId);
      if (echelonGF) this.store.poserEchelonGardeFou(task.id, echelonGF, now);
      if (routePheromone) {
        // Faits typés seulement (dont le NOM du nœud, que le Journal affiche) :
        // le texte bilingue est reconstruit à l'affichage.
        this.emit('pheromone_route', {
          taskId: task.id,
          nodeId: node.id,
          nodeName: node.name,
          domaine: routePheromone.domaine,
          score: routePheromone.score,
        });
      }
      // Le contexte Hive Mind est joint côté serveur (onAssign → assign_task),
      // sans réécrire le prompt persisté de la tâche.
      this.emit('task_assigned', {
        taskId: task.id,
        nodeId: node.id,
        branch: assigned.branch,
        // Même convention que pour une course : ce champ est le modèle
        // commandé par l'Aiguillage, jamais une valeur inventée quand aucun
        // nœud ne déclare de modèle.
        ...(route?.modele ? { modele: route.modele } : {}),
        // La RAISON du choix, figée à l'instant de la décision : Mission
        // Control répond « pourquoi ce modèle » sans recroiser des antécédents
        // qui, eux, ont bougé depuis. Absente quand aucun modèle n'est en jeu
        // (route === null) — on n'invente pas une justification. Bornée aux
        // quatre premiers : le classement entier peut être long, l'élu et ses
        // poursuivants immédiats suffisent à la lecture.
        // Le tampon de version dit sous quel calcul cette raison a été prise :
        // relue après un changement de taxonomie ou de format, elle ne se lit
        // pas avec les règles d'après (cf. `VERSION_AIGUILLAGE`).
        ...(route
          ? {
              categorie: categoriser(task.title, task.prompt),
              raisonModele: route.rang.slice(0, 4),
              versionAiguillage: VERSION_AIGUILLAGE,
            }
          : {}),
        // Ce que la reprise a fait des modèles qui ont planté sur cette tâche.
        // `modelesEcartes` : offerts par la ruche mais hors concours — sans
        // lui, la raison tairait pourquoi un modèle offert manque au
        // classement, y compris quand aucun modèle n'est commandé (un nœud
        // sans modèle déclaré a pris la reprise). `modelesReadmis` : le modèle
        // commandé était déjà tombé ici, re-tenté faute d'alternative dans
        // toute la ruche — sans lui, son « à explorer » se lirait comme une
        // exploration neuve.
        ...(reprise.ecartes.length > 0 ? { modelesEcartes: reprise.ecartes } : {}),
        ...(route && echoues?.has(route.modele) ? { modelesReadmis: [route.modele] } : {}),
        // Forcée par l'opérateur : la consigne telle qu'elle a restreint CE
        // choix. Le classement ci-dessus reste celui de l'Aiguillage, sur les
        // modèles qu'elle laissait en jeu — aucun score n'en est touché.
        ...(consigne ? { consigneOperateur: consigne } : {}),
        // Ce que la tâche parente préférait, et ce que cette préférence a
        // réellement départagé (`departage` vide : lue, sans effet — il n'y
        // avait pas d'égalité à trancher, ou l'élu n'était pas disponible).
        ...(preference
          ? {
              preference: {
                ...preference,
                departage: [
                  ...(route?.departageParPreference ? ['modele'] : []),
                  ...(departageAgent ? ['agent'] : []),
                ],
              },
            }
          : {}),
      });
      this.store.ouvrirHorlogeHote(assigned.projectId, assigned.id, now);
      this.store.ouvrirTentativeDelegation(assigned.id, node.id, now);
      // Le modèle élu part avec la tâche : le nœud le passera à `--model`.
      this.opts.onAssign?.(node.id, assigned, route?.modele);
      // Les tâches suivantes tiennent compte de celle-ci — si elle édite.
      if (lien === null) activeNow.push(assigned);
    }
  }

  /** Nœud sans heartbeat depuis plus de `nodeTimeoutMs` → offline + réaffectation. */
  private reapDeadNodes(now: number): void {
    for (const node of this.store.staleNodes(now - this.nodeTimeoutMs)) {
      // Le nœud s'est tu à son dernier battement : ses tentatives s'arrêtent
      // là, pas à l'instant où ce tick s'en aperçoit.
      this.nodeDisconnected(node.id, 'heartbeat_timeout', now, node.lastSeen ?? now);
    }
    // Purge des cooldowns de refus expirés (borne la taille de la map).
    for (const [key, until] of this.recentRejections) {
      if (until <= now) this.recentRejections.delete(key);
    }
  }

  /**
   * Écarte `modele` des reprises de cette tâche (cf. `modelesEchoues`). Sans
   * modèle commandé : rien.
   */
  private ecarterModele(taskId: string, modele: string | null | undefined): void {
    if (!modele) return;
    this.elaguerModelesEchoues();
    const echoues = this.modelesEchoues.get(taskId) ?? new Set<string>();
    echoues.add(modele);
    this.modelesEchoues.set(taskId, echoues);
  }

  /**
   * `modele` vient de rendre une production RETENUE sur cette tâche : il a
   * prouvé qu'il y tourne, son écart tombe. Sans cela, le modèle qui a écrit
   * la production — un drone rescapé d'une course où le même modèle a planté
   * sur un autre nœud, ou l'unique modèle ré-admis — serait privé de la
   * correction que l'Evaluator demanderait de SA production.
   */
  private reintegrerModele(taskId: string, modele: string | null | undefined): void {
    const echoues = this.modelesEchoues.get(taskId);
    if (!echoues || !modele) return;
    echoues.delete(modele);
    if (echoues.size === 0) this.modelesEchoues.delete(taskId);
  }

  /**
   * Oublie les écarts des tâches qui ne seront plus jamais reprises : échouées
   * pour de bon (annulation comprise) ou élaguées (`pruneTasks`). Une tâche
   * `done` garde les siens, puisqu'une correction peut la rouvrir. Appelé au
   * moment d'écarter, jamais au tick : la lecture — par clé primaire, des seules
   * tâches citées — est payée par un échec, pas par la ruche au repos, et la
   * carte reste bornée par la rétention des tâches.
   */
  private elaguerModelesEchoues(): void {
    if (this.modelesEchoues.size === 0) return;
    const statuts = this.store.taskStatuses([...this.modelesEchoues.keys()]);
    for (const taskId of this.modelesEchoues.keys()) {
      const statut = statuts.get(taskId);
      if (statut === undefined || statut === 'failed') this.modelesEchoues.delete(taskId);
    }
  }
}
