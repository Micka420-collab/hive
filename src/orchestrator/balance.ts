// La Balance — le pèse-ruche.
//
// Hive dépense des heures-machine prêtées par ses membres. Le grand livre
// existe déjà — `results.durationMs` survit à l'élagage (`pruneResults` vide
// `diff`/`logs`, jamais la ligne) — mais personne ne l'a jamais lu en somme, ni
// surtout IMPUTÉ À UNE CAUSE. Ce module répond aux trois questions de la
// Balance : **peser** (où est passée chaque seconde-ouvrière), **prévoir** (ce
// qu'un DAG devrait coûter) et **borner** (où l'on s'arrête). Les trois vivent
// ici sous forme PURE ; la décision de borner (`jugerPlafond`) est câblée par
// le Scheduler, qui en fait une porte — mais uniquement si un humain a posé un
// plafond ET que la ruche tourne en `strict`. Le blocage est doublement opt-in.
//
// Comme thermo.ts, pheromones.ts et ghost.ts : module PUR. Aucune I/O, aucun
// aléa, aucune horloge implicite — `now` en paramètre s'il en faut un (ici, il
// n'en faut pas). Les deux classes sont des CACHES explicitement instanciés par
// leur propriétaire (précédent : `CacheDomaines`, pheromones.ts:120) ; le module
// lui-même reste sans état global.
//
// ─── DOCTRINE — quatre règles, à lire avant de modifier ce fichier ───────────
//
// 1. AUCUNE VUE DÉRIVÉE MATÉRIALISÉE — SAUF UN CACHE, ET IL SE NOMME COMME TEL.
//    L'imputation (`peserLaRuche`) est une fonction pure recalculée à la
//    demande, sur un corpus borné ; elle n'est écrite nulle part et ne le sera
//    jamais. La table `budgets` n'est pas une exception : elle stocke une
//    INTENTION HUMAINE — un plafond posé par un opérateur — jamais un calcul.
//
//    L'EXCEPTION, unique et délimitée : `balance_ledger_cache` (store.ts), qui
//    persiste le couple (filigrane, soldes) du grand livre. Cette règle
//    l'interdisait ; elle a été AMENDÉE, et voici pourquoi :
//
//    a) Le grand livre est ADDITIF, ORDONNÉ PAR id, JAMAIS RÉVISÉ, et
//       indépendant de l'ordre du lot. Aucune ligne de `results` n'est jamais
//       supprimée — `pruneResults` ALLÈGE (`diff`/`logs` vidés), la ligne
//       survit. La somme par projet est donc monotone : un solde absorbé ne
//       peut plus changer. C'est exactement l'argument qui autorisait déjà
//       l'accumulateur EN MÉMOIRE ; le persister n'ajoute pas une classe de
//       divergence, il prolonge la durée de vie de la même.
//    b) Ce que la règle interdisait vraiment, c'est qu'un CALCUL devienne une
//       SOURCE DE VÉRITÉ. Ici il n'en devient pas une : le nom de la table le
//       dit, elle porte un `version`, et sa procédure de reconstruction totale
//       est « DELETE FROM balance_ledger_cache » — le rattrapage la refait à
//       l'identique depuis `results`. `lireCacheGrandLivre` la jette au moindre
//       doute (version étrangère, filigranes divergents entre lignes,
//       filigrane au-delà du dernier `results.id`).
//    c) Le prix de l'interdiction était réel et croissant : sans cache, le
//       filigrane repart de 0 à CHAQUE démarrage et le rattrapage relit tout
//       l'historique — et pendant ce temps `aJour` vaut `false`, donc la porte
//       des plafonds est FAIL-OPEN. Sur un an de ruche, cela fait des minutes
//       de plafonds inopérants à chaque redémarrage. Le coût grandit avec
//       l'histoire ; la garantie, non.
//
//    CONDITION DE VALIDITÉ, à relire avant de toucher à `results` : le jour où
//    une ligne de `results` pourra être SUPPRIMÉE (et pas seulement allégée),
//    cet amendement tombe — le cache compterait des tentatives qui n'existent
//    plus. Il faudrait alors soit le supprimer, soit incrémenter
//    VERSION_BALANCE pour l'invalider partout.
//
// 2. AUCUNE MIGRATION. `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
//    EXISTS` uniquement ; aucun `ALTER TABLE`, aucun `PRAGMA user_version`. Et
//    surtout : NE JAMAIS MODIFIER UN INDEX EXISTANT. `CREATE INDEX IF NOT
//    EXISTS` ne redéfinit PAS un index déjà présent — une base en service
//    garderait silencieusement l'ancienne définition et perdrait sa propriété
//    couvrante. Toujours un nom neuf (d'où `idx_results_balance`, et pas une
//    colonne de plus sur `idx_results_recent`).
//
// 3. UNE TABLE NOUVELLE ARRIVE AVEC SA BORNE D'ÉLAGAGE DANS LE MÊME COMMIT.
//    La Balance en a deux, et les deux ont une borne STRUCTURELLE, pas un
//    élagueur : une ligne par PROJET, donc une taille qui ne croît pas avec
//    l'histoire de la ruche.
//    - `budgets` : 1:1 avec `projects`, une ligne par plafond posé à la main,
//      aucune ligne qui naisse d'un calcul. Elle n'a donc PAS de
//      `pruneBudgets`, et ne doit jamais en avoir : élaguer `budgets` « par
//      symétrie » avec pruneEvents ou pruneResults effacerait des intentions
//      humaines encore en vigueur — ce serait un plafond qui se lève tout seul.
//      Cette phrase est ici pour que personne n'en ajoute un dans trois ans.
//    - `balance_ledger_cache` : une ligne par projet ayant dépensé (donc
//      ≤ `projects`), réécrite en entier à chaque sauvegarde. Pas d'élagueur
//      non plus — et là, en effacer le contenu ne coûte rien du tout : c'est
//      littéralement la procédure de reconstruction.
//
// 4. LA BALANCE N'ENTRE JAMAIS DANS LE CHOIX DU NŒUD. `durationMs` mesure le
//    temps machine PRÊTÉ, pas le travail accompli : router au moins-cher
//    punirait les machines modestes et créerait une course vers le bas. Ce
//    n'est pas un vœu pieux, c'est un test qui échoue
//    (tests/security-invariants.test.ts, « la Balance n'entre jamais dans le
//    choix du nœud »). Le tableau par nœud reste factuel, séparé du nectar, et
//    n'est JAMAIS trié en « pire contributeur ».

import type { TaskStatus } from '../shared/types.js';
import { CacheBorne } from './cache-borne.js';
import type { StatistiquesCache } from './cache-borne.js';
import type { Domaine } from './pheromones.js';

/**
 * Version de l'algorithme d'imputation. Toute sortie calculée la porte : une v2
 * pourra être distinguée sans migration ni corruption de corpus.
 */
export const VERSION_BALANCE = 1;

/** Part du plafond à partir de laquelle la ruche prévient (jamais de blocage). */
export const SEUIL_ALERTE = 0.8;

/** Sous ce nombre de tâches comparables, aucun devis : jamais de fausse précision. */
export const ECHANTILLON_MIN_DEVIS = 3;

/** Résultats absorbés par passe de grand livre — motif LOT_ALLEGEMENT (store.ts). */
export const LOT_GRAND_LIVRE = 2_000;

/** Corpus borné de l'imputation — même ordre de grandeur que listResultsForPheromones. */
export const CORPUS_BALANCE = 2_000;

/** Où est passée une seconde-ouvrière. */
export type Poste = 'utile' | 'reprise' | 'echec' | 'rebute';

/** Une tentative, réduite au strict nécessaire du calcul. */
export interface Tentative {
  /** results.id — ordonne les tentatives d'une même tâche, de façon stable. */
  id: number;
  taskId: string;
  nodeId: string;
  success: boolean;
  durationMs: number;
}

/** Ce que la Balance a besoin de savoir d'une tâche pour imputer ses tentatives. */
export interface CompteTache {
  projectId: string;
  status: TaskStatus;
  /** Verdict Miellerie (store.listReviews) — null si aucune revue. */
  revue: 'approved' | 'rejected' | null;
}

export interface Compte {
  utileMs: number;
  repriseMs: number;
  echecMs: number;
  rebuteMs: number;
  totalMs: number;
  tentatives: number;
  /** utileMs / totalMs, arrondi à 1e-4. Vaut 1 sur un corpus vide (jamais NaN). */
  rendement: number;
}

export interface Pesee {
  version: typeof VERSION_BALANCE;
  global: Compte;
  /** Trié par projectId croissant — ordre stable, comme partout dans le dépôt. */
  parProjet: Array<{ projectId: string } & Compte>;
  /** Trié par nodeId croissant. JAMAIS trié en « pire contributeur ». */
  parNoeud: Array<{ nodeId: string } & Compte>;
  /**
   * Reprises : combien de tâches ABOUTIES (`done`) ont coûté plus d'une
   * tentative, et combien de tentatives SUPPLÉMENTAIRES (au-delà de la
   * première) elles ont consommées. C'est le substitut exact du verdict chiffré
   * sur Drone Wars : `results` ne distingue pas un drone perdant d'une
   * re-tentative — leur coût est déjà imputé en `reprise`, simplement pas
   * étiqueté.
   */
  reprises: { taches: number; tentatives: number };
  /**
   * Transparence : ce qui a été lu, et ce qui a été volontairement ignoré.
   * Invariant : `tentatives - ignorees === global.tentatives`.
   */
  corpus: { tentatives: number; taches: number; ignorees: number };
}

/** Arrondi à 1e-4 — la précision affichable d'un rendement. */
function arrondi4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

function compteVide(): Compte {
  return {
    utileMs: 0,
    repriseMs: 0,
    echecMs: 0,
    rebuteMs: 0,
    totalMs: 0,
    tentatives: 0,
    rendement: 1,
  };
}

/** Clé de poste → champ du compte. Une seule table, pas quatre `if`. */
const CHAMP: Record<Poste, 'utileMs' | 'repriseMs' | 'echecMs' | 'rebuteMs'> = {
  utile: 'utileMs',
  reprise: 'repriseMs',
  echec: 'echecMs',
  rebute: 'rebuteMs',
};

function imputer(compte: Compte, poste: Poste, ms: number): void {
  compte[CHAMP[poste]] += ms;
  compte.totalMs += ms;
  compte.tentatives += 1;
}

/** Rendement final : `utileMs / totalMs`, 1 sur un total nul (jamais NaN). */
function cloturer(compte: Compte): Compte {
  compte.rendement = compte.totalMs === 0 ? 1 : arrondi4(compte.utileMs / compte.totalMs);
  return compte;
}

/**
 * Poste d'une tentative, déduit du statut FINAL de sa tâche.
 *  - tâche `done`   : la tentative RETENUE (dernier succès par id) est `utile`,
 *                     ou `rebute` si la Miellerie l'a rejetée ; les autres sont
 *                     des `reprise` ;
 *  - tâche `failed` : tout est `echec` ;
 *  - tâche en vol   : tout est `reprise` (dépense engagée, issue inconnue).
 *
 * Un verdict Miellerie `approved` est STRICTEMENT équivalent à l'absence de
 * verdict : approuver ne change pas l'imputation, cela confirme l'existant.
 */
function posteDe(tache: CompteTache, retenue: boolean): Poste {
  if (tache.status === 'done') {
    if (!retenue) return 'reprise';
    return tache.revue === 'rejected' ? 'rebute' : 'utile';
  }
  if (tache.status === 'failed') return 'echec';
  return 'reprise';
}

/**
 * Impute chaque tentative à un poste, à partir du statut FINAL de sa tâche, et
 * replie le tout en une pesée globale / par projet / par nœud.
 *
 * Une tentative dont la tâche est ABSENTE de `taches` (purgée, ou hors du
 * corpus lu) est IGNORÉE, jamais imputée — même règle que `replierTraces`
 * (pheromones.ts) : sans tâche, pas de cause imputable. Elle est comptée dans
 * `corpus.ignorees`, pour que le chiffre affiché dise aussi ce qu'il n'a pas vu.
 *
 * Toute durée est bornée par `Math.max(0, …)` : une horloge en retard sur un
 * nœud ne peut pas produire d'agrégat négatif.
 *
 * STATUT TERMINAL = IMMUABLE. C'est ce qui rend cette imputation stable :
 * `recoverOrphanTasks` ne touche que `assigned`/`running` (store.ts), et
 * `cancelTask` refuse une tâche déjà terminale (scheduler.ts). Une tâche
 * `done`/`failed` ne redevient jamais autre chose. Seul le verdict Miellerie
 * peut changer — et c'est assumé : révoquer un rejet fait repasser du `rebute`
 * en `utile`. Le rendement est une lecture de l'instant, pas un chiffre gravé.
 *
 * PURE et DÉTERMINISTE : deux appels sur les mêmes entrées rendent des objets
 * profondément égaux, et le résultat ne dépend pas de l'ordre du lot.
 */
export function peserLaRuche(
  tentatives: readonly Tentative[],
  taches: ReadonlyMap<string, CompteTache>,
): Pesee {
  // 1) Trier le bon grain : ce qui est imputable, et à quelle tâche.
  const imputables: Array<{ tentative: Tentative; tache: CompteTache }> = [];
  /** taskId → id de la DERNIÈRE tentative réussie (celle dont le travail a servi). */
  const retenues = new Map<string, number>();
  /** taskId → nombre de tentatives imputées (sert aux reprises). */
  const parTache = new Map<string, number>();
  let ignorees = 0;

  for (const tentative of tentatives) {
    const tache = taches.get(tentative.taskId);
    if (!tache) {
      ignorees += 1;
      continue;
    }
    imputables.push({ tentative, tache });
    parTache.set(tentative.taskId, (parTache.get(tentative.taskId) ?? 0) + 1);
    if (tentative.success) {
      const courante = retenues.get(tentative.taskId);
      // Le DERNIER succès par id, pas le premier : sur une course de drones,
      // deux succès peuvent coexister pour une même tâche.
      if (courante === undefined || tentative.id > courante) {
        retenues.set(tentative.taskId, tentative.id);
      }
    }
  }

  // 2) Imputer, trois fois : global, par projet, par nœud.
  const global = compteVide();
  const projets = new Map<string, Compte>();
  const noeuds = new Map<string, Compte>();

  for (const { tentative, tache } of imputables) {
    const ms = Math.max(0, tentative.durationMs);
    const poste = posteDe(tache, retenues.get(tentative.taskId) === tentative.id);
    imputer(global, poste, ms);
    let projet = projets.get(tache.projectId);
    if (!projet) {
      projet = compteVide();
      projets.set(tache.projectId, projet);
    }
    imputer(projet, poste, ms);
    let noeud = noeuds.get(tentative.nodeId);
    if (!noeud) {
      noeud = compteVide();
      noeuds.set(tentative.nodeId, noeud);
    }
    imputer(noeud, poste, ms);
  }

  // 3) Reprises : les tâches abouties qui ont coûté plus d'une tentative.
  const reprises = { taches: 0, tentatives: 0 };
  for (const [taskId, n] of parTache) {
    if (n <= 1) continue;
    if (taches.get(taskId)?.status !== 'done') continue;
    reprises.taches += 1;
    reprises.tentatives += n - 1;
  }

  return {
    version: VERSION_BALANCE,
    global: cloturer(global),
    parProjet: [...projets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([projectId, compte]) => ({ projectId, ...cloturer(compte) })),
    parNoeud: [...noeuds.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nodeId, compte]) => ({ nodeId, ...cloturer(compte) })),
    reprises,
    corpus: { tentatives: tentatives.length, taches: parTache.size, ignorees },
  };
}

// ─── Prévoir ────────────────────────────────────────────────────────────────

export interface Devis {
  domaine: Domaine;
  echantillon: number;
  medianeMs: number;
  /** Rang le plus proche : index ceil(0.9 × n) − 1 sur l'échantillon trié. */
  p90Ms: number;
}

/**
 * Devis d'une tâche d'un domaine donné, à partir des TOTAUX PAR TÂCHE de tâches
 * comparables (toutes tentatives confondues : ce qu'a réellement coûté une
 * tâche de ce type, reprises comprises).
 *
 * `null` sous ECHANTILLON_MIN_DEVIS tâches comparables : mieux vaut se taire
 * que d'annoncer une précision qu'on n'a pas. La médiane (et non la moyenne)
 * parce qu'une seule tâche pathologique ne doit pas déplacer le devis ; le p90
 * parce que c'est le mauvais jour qu'il faut pouvoir provisionner.
 *
 * PURE : l'échantillon reçu n'est pas modifié (tri sur une copie).
 */
export function estimerCout(domaine: Domaine, totauxParTache: readonly number[]): Devis | null {
  const echantillon = totauxParTache.length;
  if (echantillon < ECHANTILLON_MIN_DEVIS) return null;
  const tries = [...totauxParTache].map((ms) => Math.max(0, ms)).sort((a, b) => a - b);
  const milieu = Math.floor(echantillon / 2);
  const medianeMs =
    echantillon % 2 === 1
      ? (tries[milieu] ?? 0)
      : Math.round(((tries[milieu - 1] ?? 0) + (tries[milieu] ?? 0)) / 2);
  // Rang le plus proche : ceil(0,9 × n) — sur 5 échantillons, le 5e (l'index 4).
  const rang = Math.min(echantillon - 1, Math.max(0, Math.ceil(0.9 * echantillon) - 1));
  return { domaine, echantillon, medianeMs, p90Ms: tries[rang] ?? 0 };
}

/**
 * Projection d'AFFICHAGE, en euros, à partir d'un tarif horaire fourni par
 * l'appelant. `null` sans tarif (ou avec un tarif absurde) : AUCUN euro n'est
 * jamais stocké nulle part. Les prix, les devises et les fournisseurs changent —
 * dans dix ans, une colonne `costUsd` serait un mensonge daté.
 */
export function enEuros(ms: number, tarifHoraire: number | null): number | null {
  if (tarifHoraire === null || !Number.isFinite(tarifHoraire) || tarifHoraire < 0) return null;
  return Math.round((Math.max(0, ms) / 3_600_000) * tarifHoraire * 100) / 100;
}

// ─── Borner ─────────────────────────────────────────────────────────────────

export type DecisionPlafond = 'passe' | 'alerte' | 'bloque';

/**
 * Verdict d'un plafond de dépense. `plafondMs === null` ⇒ toujours 'passe' :
 * l'absence de plafond est l'état normal, et le comportement de la ruche y est
 * rigoureusement celui d'avant la Balance.
 *
 * Pure, sans horloge, sans état : elle ne fait que comparer deux entiers. C'est
 * le Scheduler qui en fait une porte (`decisionPlafond`), et lui seul décide
 * quoi faire d'un verdict — en `observation` il le journalise, en `strict` il
 * cesse d'assigner de nouvelles tâches du projet. Les tâches DÉJÀ EN VOL vont
 * à leur terme : le temps déjà dépensé serait perdu, ce serait du gaspillage
 * supplémentaire au nom de l'économie.
 *
 * ⚠ CE N'EST PAS UNE FRONTIÈRE DE SÉCURITÉ. `durationMs` est une donnée
 * d'AGENT : un nœud hostile peut déclarer 24 h par résultat (la borne d'entrée
 * de protocol.ts) et étrangler un projet à lui seul. Le plafond protège d'un
 * emballement, jamais d'un adversaire — le mot « plafond » promet l'inverse,
 * d'où cette phrase, ici et dans le README.
 */
export function jugerPlafond(depenseMs: number, plafondMs: number | null): DecisionPlafond {
  if (plafondMs === null) return 'passe';
  if (depenseMs >= plafondMs) return 'bloque';
  return depenseMs >= SEUIL_ALERTE * plafondMs ? 'alerte' : 'passe';
}

// ─── Le grand livre (CACHE explicite, jamais matérialisé) ───────────────────

export interface LigneLivre {
  id: number;
  projectId: string;
  durationMs: number;
}

/**
 * Dépense TOTALE par projet, toutes tentatives confondues, sur TOUTE l'histoire.
 * Additive, jamais révisée, indépendante de l'ordre — c'est ce qui la rend
 * incrémentable sans risque, là où l'imputation (qui dépend du statut FINAL de
 * la tâche) ne l'est pas.
 *
 * ÉTAT COURANT, PAS DE L'HISTOIRE : rien n'est JOURNALISÉ ici. Sans cette
 * phrase, quelqu'un « corrigera l'oubli » dans trois ans et noiera le journal de
 * 5 000 événements sous un fait comptable par résultat. Ce qui est écrit en
 * base — et uniquement cela — est un INSTANTANÉ du couple (filigrane, soldes)
 * dans `balance_ledger_cache`, repris par `charger` au démarrage suivant pour
 * ne pas relire tout l'historique ; le reste du chemin est identique, et un
 * cache absent ou jeté ne change qu'une chose : la durée du rattrapage
 * (≤ LOT_GRAND_LIVRE lignes d'un index couvrant par passe). Voir la règle 1 de
 * la doctrine, en tête de fichier.
 *
 * Le filigrane suit la TABLE, pas les sites d'appel de `insertResult` : un
 * troisième site d'écriture ajouté en 2029 ne peut pas dérégler le compteur.
 * C'est un invariant STRUCTUREL, pas de la discipline.
 */
export class GrandLivre {
  private readonly comptes = new Map<string, { depenseMs: number; tentatives: number }>();
  private dernierId = 0;
  private rattrape = false;

  /** id du dernier résultat absorbé (0 = rien vu). */
  get filigrane(): number {
    return this.dernierId;
  }

  /**
   * `false` tant que le rattrapage n'a pas rejoint la fin de la table. Un solde
   * en cours de rattrapage affiché comme définitif est un mensonge court mais
   * coûteux : l'affichage DOIT montrer cet état.
   */
  get aJour(): boolean {
    return this.rattrape;
  }

  /**
   * Absorbe un lot trié par id. IDEMPOTENT : les id ≤ filigrane sont ignorés —
   * ré-absorber un lot déjà vu ne change aucun solde.
   *
   * `jusqua` (écart assumé avec la signature d'origine, à un seul paramètre) est
   * la borne du PARCOURS réellement lu par l'appelant, qui peut dépasser le
   * dernier id du lot : une tentative dont la tâche a disparu est retirée du
   * COMPTE, pas du PARCOURS. Sans elle, un lot entièrement orphelin laisserait
   * le filigrane sur place et le rattrapage relirait les mêmes lignes à chaque
   * tick, sans fin.
   */
  absorber(lot: readonly LigneLivre[], jusqua = 0): void {
    for (const ligne of lot) {
      if (ligne.id <= this.dernierId) continue;
      let compte = this.comptes.get(ligne.projectId);
      if (!compte) {
        compte = { depenseMs: 0, tentatives: 0 };
        this.comptes.set(ligne.projectId, compte);
      }
      // Une horloge en retard sur un nœud ne creuse jamais un solde.
      compte.depenseMs += Math.max(0, ligne.durationMs);
      compte.tentatives += 1;
      this.dernierId = ligne.id;
    }
    // Filigrane STRICTEMENT monotone : jamais reculé par un lot partiel.
    if (jusqua > this.dernierId) this.dernierId = jusqua;
  }

  /**
   * Reprend un instantané du cache reconstructible (`balance_ledger_cache`) :
   * on repart de ces soldes et de ce filigrane au lieu de relire tout
   * l'historique. À n'appeler qu'AVANT la première absorption — un livre déjà
   * entamé serait écrasé, pas fusionné, et l'appel est donc REFUSÉ dans ce cas
   * (silencieusement : le rattrapage depuis 0 reste correct, simplement plus
   * long ; jamais un solde faux).
   *
   * `aJour` n'est PAS remis à `true` : reprendre un instantané ne dit rien de
   * ce qui a été inséré depuis. Seul un lot incomplet le prouve, comme avant.
   */
  charger(
    filigrane: number,
    soldes: ReadonlyArray<{ projectId: string; depenseMs: number; tentatives: number }>,
  ): void {
    if (this.dernierId !== 0 || this.comptes.size > 0) return;
    for (const s of soldes) {
      this.comptes.set(s.projectId, {
        depenseMs: Math.max(0, s.depenseMs),
        tentatives: Math.max(0, s.tentatives),
      });
    }
    this.dernierId = Math.max(0, filigrane);
  }

  /**
   * Le dernier lot lu était incomplet ⇒ le livre a rejoint la table. Jamais
   * remis à `false` : une fois le rattrapage terminé, l'avancement se fait lot
   * par lot et le livre ne redevient pas incomplet.
   */
  marquerRattrape(): void {
    this.rattrape = true;
  }

  depense(projectId: string): number {
    return this.comptes.get(projectId)?.depenseMs ?? 0;
  }

  /** Vue lecture seule, triée par projectId. */
  soldes(): Array<{ projectId: string; depenseMs: number; tentatives: number }> {
    return [...this.comptes.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([projectId, c]) => ({ projectId, depenseMs: c.depenseMs, tentatives: c.tentatives }));
  }
}

/** Capacité par défaut du cache de projets (quelques dizaines de milliers de tâches). */
const CAPACITE_PROJETS = 20_000;

/**
 * Mémoïsation bornée de `taskId → projectId`. Le projet d'une tâche est
 * IMMUABLE (`patchTask` ne touche jamais `projectId`) : il se mémoïse sans
 * aucun risque de péremption.
 *
 * Sans ce cache, un rattrapage de 100 000 résultats rouvrirait 100 000 lignes
 * `tasks` (prompt ≤ 100 ko chacune) ; avec lui, chaque tâche n'est lue qu'une
 * fois.
 *
 * Toute la mécanique — bornage, LRU, éviction O(1) amorti, et surtout
 * l'invariant « ce que `resoudre` a résolu, il le rend » — vit dans
 * `CacheBorne` (cache-borne.ts), partagé avec `CacheDomaines`. Cette classe
 * n'est plus qu'un TYPAGE de ce cache : elle nomme la clé (taskId), la valeur
 * (projectId) et la forme des lignes rendues par le store.
 */
export class CacheProjets {
  private readonly cache: CacheBorne<string>;

  constructor(capacite: number | undefined = CAPACITE_PROJETS) {
    this.cache = new CacheBorne<string>(capacite ?? CAPACITE_PROJETS);
  }

  /**
   * Projets des SEULES tâches citées : les ids déjà connus ne coûtent rien, et
   * `manquants` n'est appelé que pour les autres (lecture ciblée par clé
   * primaire côté store — jamais un dépliage de la table `tasks`).
   *
   * Une tâche introuvable (purgée) n'entre pas dans le cache : elle est
   * simplement absente du retour, et l'appelant décide quoi en faire.
   */
  resoudre(
    ids: readonly string[],
    manquants: (ids: string[]) => Array<{ id: string; projectId: string }>,
  ): Map<string, string> {
    return this.cache.resoudre(ids, (absents) =>
      manquants(absents).map((ligne) => [ligne.id, ligne.projectId] as const),
    );
  }

  /** Transparence : taille du cache et nombre d'appels au résolveur. */
  get statistiques(): StatistiquesCache {
    return this.cache.statistiques;
  }
}
