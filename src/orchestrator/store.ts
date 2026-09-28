// Persistance SQLite (better-sqlite3) — l'état de la ruche survit aux
// redémarrages de l'orchestrateur. Tout le SQL vit dans cette classe.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PlateformeNoeud } from '../shared/machine.js';
import { LIMITS } from '../shared/protocol.js';
import type { OutilConstate } from '../shared/protocol.js';
import { LIMITE_TACHES_INSTANTANE, NIVEAUX_ISOLEMENT } from '../shared/types.js';
import type { Partage } from '../shared/partage.js';
import type { AntecedentFige } from '../shared/mission-rejouable.js';
import type { GenreSauvegarde, Sauvegarde, SauvegardeResume } from '../shared/sauvegardes.js';
import { libelleEtape } from '../shared/sauvegardes.js';
import { CORPUS_AIGUILLAGE, type ElectionEnVol } from './aiguillage.js';
import { estEffort, type Effort } from '../shared/effort.js';
import { CORPUS_GARDE_FOU } from './garde-fou.js';
import type { ReglageBancOmbre, RevueCote, UsageBancOmbre } from './shadow-bench.js';
import type { Categorie } from './aiguillage.js';
import type { Echelon, FaitsProduction } from './garde-fou.js';
import type { Suite } from './polyethisme.js';
import type {
  CrossReviewEvidence,
  CrossReviewVote,
  ProvenanceBac,
  ProvenanceGithub,
  ValidationEvidence,
  ValidationProvenance,
} from './evaluator.js';
import {
  VALIDATION_KEYS,
  estEtatDeValidation,
  validationsBacDepuis,
} from '../shared/validations-bac.js';
import type { ValidationState } from '../shared/validations-bac.js';
import { agreger, type Avis } from '../shared/contre-expertise.js';
import {
  MOTIFS_FAIT_CONNU,
  bilanDeRetraits,
  clotureDe,
  estPreuve,
  planDeRetention,
  type BilanJournal,
  type LigneJournal,
  type MotifElagage,
  type PolitiqueJournal,
} from '../shared/retention-journal.js';
import { constatBloquant, lireConstats } from '../shared/critique-structuree.js';
import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import type { SourceEpisode } from '../shared/cerveau.js';
import { CORPUS_BALANCE, LOT_GRAND_LIVRE, VERSION_BALANCE } from './balance.js';
import { depenseHote, fermerSession, ouvrirSession } from './horloge-hote.js';
import type { SessionHote } from './horloge-hote.js';
import { CORPUS_GARDIENNES, VERSION_GARDIENNES } from './gardiennes.js';
import type { Grief, LigneGardienne, Verdict } from './gardiennes.js';
import { jugerBapteme, normaliserNomBapteme, type VerdictBapteme } from './bapteme.js';
import { validerMetier, type MetierCycle, type VerdictMetier } from './metier.js';
import {
  jugerCheminPresence,
  validerOutilPresence,
  type OutilPresence,
  type PresenceFichier,
} from '../shared/presence.js';
import {
  validerGenreRequisition,
  validerLibelleRequisition,
  type GenreRequisition,
  type MotifRefusRequisition,
  type StatutRequisition,
} from './requisition.js';
import {
  validerGenreFabrique,
  validerLibelleFabrique,
  type GenreFabrique,
  type MotifRefusFabrique,
  type StatutFabrique,
} from './fabrique.js';
import {
  HORIZON_LECTURE_MAX,
  validerKindHorizon,
  validerTexteHorizon,
  type EntreeHorizon,
  type MotifRefusHorizon,
} from './horizon.js';
import { validerMotifPerso, type MotifPersoRefus } from './motifs.js';
import { rankMemoriesHybrid, suiteSouvenir } from './hive-mind.js';
import type {
  IssueSouvenir,
  Memory,
  ScoredMemory,
  ValidationSouvenir,
  VerdictSouvenir,
} from './hive-mind.js';
import {
  AUCUNE_DEPENSE,
  jugerDelegation,
  type DemandeDelegation,
  type DepenseDeclaree,
  type NoeudDelegation,
  type OrigineDelegation,
  type PlanDelegation,
  type VerdictDelegation,
} from './delegation.js';
import { lireConsigneRoutage, type ConsigneRoutage } from '../shared/consigne-routage.js';
import type {
  HiveEvent,
  HiveNode,
  IsolementDeclare,
  NodeStatus,
  Project,
  StateSnapshot,
  SubAgent,
  Task,
  TaskResult,
  TaskResultSummary,
  TaskStatus,
  User,
} from '../shared/types.js';

/**
 * Une ligne brute de la reconstruction des observations d'aiguillage : de quoi
 * `categoriser(title, prompt)` à la lecture, plus le modèle et le verdict. La
 * catégorie n'est PAS figée ici — elle se recalcule au moment du choix.
 */
export interface LigneObservationAiguillage {
  title: string;
  prompt: string;
  modele: string;
  suite: Suite;
  /** Worker qui a produit le résultat relu, quand le résultat est encore disponible. */
  nodeId?: string;
  /** Modèle réellement choisi pour ce résultat, quand le lancement l'a tracé. */
  modeleExact?: string;
  /** Harness du bras commandé (`aiguillage_bras`) ; absent : bras inconnu. */
  harness?: string;
  /** Effort commandé ; absent : aucun effort, ou bras inconnu. */
  effort?: Effort;
  /** Coût déclaré par le CLI pour la production jugée ; absent : non déclaré. */
  coutUsd?: number;
}

/**
 * La tâche qu'un événement nomme (`payload.taskId`), telle que l'index
 * `idx_events_tache` la range — et telle que chaque lecture PAR TÂCHE doit
 * l'écrire, au caractère près : SQLite ne sert une requête par un index
 * d'expression que si elle en répète l'expression exacte.
 *
 * Gardée par `json_valid` : l'index est bâti à l'ouverture sur TOUTES les
 * lignes d'une base existante, et un seul payload illisible (base retouchée à
 * la main) ferait échouer `json_extract`, donc la création de l'index, donc le
 * démarrage de la Reine. Gardée, une ligne illisible ne nomme simplement
 * aucune tâche.
 *
 * Pourquoi un index : la rétention garde les preuves avec leur tâche, et le
 * journal ne tient plus en 5 000 lignes. Mesuré sur 42 000 événements, relire
 * les verdicts d'UN résultat coûtait 2,9 ms par l'index de type (tous les
 * verdicts de la ruche parcourus) et 0,004 ms par celui-ci — à chaque
 * évaluation, chaque élection, chaque critique relue.
 */
const TACHE_DE_L_EVENEMENT = `json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$.taskId')`;
/** Une entrée du journal append-only des connecteurs externes (src/connectors). */
export interface EntreeJournalConnecteur {
  id: string;
  connecteurId: string;
  projectId: string | null;
  portee: string;
  acte: string;
  cible: string | null;
  resultat: 'ok' | 'echec' | 'refuse';
  qui: string;
  apercu: string;
  chargeDigest: string;
  creeA: number;
}

/**
 * Ce qu'un côté d'une comparaison du banc a donné, RANGÉ (`taches_ombre`) :
 * le résultat jugé, son succès, l'état `tests` de ses validations, le commit
 * de base de ces tests et l'avis de la contre-revue sur CE résultat.
 */
export interface CoteOmbreRange {
  resultId: number;
  succes: boolean;
  tests: ValidationState | null;
  baseSha: string | null;
  revue: RevueCote;
}

/**
 * Le lien d'une OMBRE (`taches_ombre`) : la tâche qui rejoue, la production
 * originale qu'elle mesure, les deux modèles, ce que le banc y a dépensé —
 * et les deux côtés de la comparaison, rangés à l'instant où chacun est
 * connu. Voir shadow-bench.ts.
 */
export interface TacheOmbre {
  tacheOmbre: string;
  tacheOriginale: string;
  projectId: string;
  /** Le résultat EXACT de l'originale que l'ombre mesure (sa première production). */
  resultatOriginal: number;
  modeleOriginal: string;
  modeleOmbre: string;
  /** Le genre de la tâche, figé à l'ouverture : l'ombre et l'originale partagent le même. */
  categorie: Categorie;
  coutDeclareUsd: number;
  executionsMuettes: number;
  creeA: number;
  original: CoteOmbreRange;
  /** `null` tant que l'ombre n'a rien rendu. */
  ombre: CoteOmbreRange | null;
}

/** Une ligne brute de `taches_ombre`, avant d'être relue en `TacheOmbre`. */
interface TacheOmbreRow {
  tacheOmbre: string;
  tacheOriginale: string;
  projectId: string;
  resultatOriginal: number;
  modeleOriginal: string;
  modeleOmbre: string;
  categorie: string;
  coutDeclareUsd: number;
  executionsMuettes: number;
  creeA: number;
  originalSucces: number;
  originalTests: string | null;
  originalBase: string | null;
  originalRevue: string;
  ombreResultat: number | null;
  ombreSucces: number | null;
  ombreTests: string | null;
  ombreBase: string | null;
  ombreRevue: string;
}

/**
 * Les tâches du BANC, en SQL : chaque ombre (`id` = elle-même) et chaque
 * relecture d'une ombre (`id` = la relecture), avec l'ombre qu'elles servent.
 * Une relecture d'ombre juge un travail qui ne se livre jamais : payée par le
 * banc, elle reste hors de tout ce que l'ombre elle-même ne touche pas —
 * thermorégulation, phéromones, élections de l'Aiguillage, lignes de
 * production du Genome. La lire à part laissait le banc déplacer, par ses
 * relectrices, les entrées du routing qu'il promet de ne pas toucher.
 */
const TACHES_DU_BANC_SQL = `
  SELECT tacheOmbre AS id, tacheOmbre FROM taches_ombre
  UNION ALL
  SELECT ce.relectureTaskId AS id, o.tacheOmbre
    FROM contre_expertises ce JOIN taches_ombre o ON o.tacheOmbre = ce.productionTaskId`;

const REVUES_COTE: readonly RevueCote[] = ['validee', 'contestee', 'absente'];
const revueRangee = (v: string): RevueCote =>
  (REVUES_COTE as readonly string[]).includes(v) ? (v as RevueCote) : 'absente';
const testsRanges = (v: string | null): ValidationState | null =>
  estEtatDeValidation(v) ? v : null;

function rowToTacheOmbre(r: TacheOmbreRow): TacheOmbre {
  return {
    tacheOmbre: r.tacheOmbre,
    tacheOriginale: r.tacheOriginale,
    projectId: r.projectId,
    resultatOriginal: r.resultatOriginal,
    modeleOriginal: r.modeleOriginal,
    modeleOmbre: r.modeleOmbre,
    categorie: r.categorie as Categorie,
    coutDeclareUsd: r.coutDeclareUsd,
    executionsMuettes: r.executionsMuettes,
    creeA: r.creeA,
    original: {
      resultId: r.resultatOriginal,
      succes: r.originalSucces === 1,
      tests: testsRanges(r.originalTests),
      baseSha: r.originalBase,
      revue: revueRangee(r.originalRevue),
    },
    ombre:
      r.ombreResultat === null || r.ombreSucces === null
        ? null
        : {
            resultId: r.ombreResultat,
            succes: r.ombreSucces === 1,
            tests: testsRanges(r.ombreTests),
            baseSha: r.ombreBase,
            revue: revueRangee(r.ombreRevue),
          },
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  repoUrl     TEXT,
  description TEXT,
  visibility  TEXT NOT NULL DEFAULT 'private',
  ownerId     TEXT,
  createdAt   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  projectId TEXT NOT NULL,
  userId    TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member',
  joinedAt  INTEGER NOT NULL,
  PRIMARY KEY (projectId, userId)
);

CREATE TABLE IF NOT EXISTS nodes (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  ownerName      TEXT NOT NULL,
  agentType      TEXT NOT NULL,
  maxConcurrency INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'offline',
  lastSeen       INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  projectId      TEXT NOT NULL REFERENCES projects(id),
  title          TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  dependsOn      TEXT NOT NULL DEFAULT '[]',
  assignedNodeId TEXT,
  result         TEXT,
  branch         TEXT,
  attempts       INTEGER NOT NULL DEFAULT 0,
  createdAt      INTEGER NOT NULL,
  updatedAt      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_tasks_node ON tasks(assignedNodeId);

-- Graphe de délégation latéral : les tâches historiques restent des racines
-- implicites. Ajouter ces colonnes à la table tasks imposerait une migration et une
-- seconde représentation du scheduler ; l'arête porte uniquement ce qui
-- distingue un enfant orchestré de sa tâche parente.
CREATE TABLE IF NOT EXISTS task_delegations (
  childTaskId   TEXT PRIMARY KEY,
  parentTaskId  TEXT NOT NULL,
  rootTaskId    TEXT NOT NULL,
  depth         INTEGER NOT NULL,
  origin        TEXT NOT NULL CHECK(origin IN ('hive', 'native')),
  durationMs    INTEGER NOT NULL,
  costMicros    INTEGER NOT NULL,
  resourceUnits INTEGER NOT NULL,
  preferredAgent TEXT,
  preferredModel TEXT,
  createdAt     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_delegations_parent
  ON task_delegations(parentTaskId, createdAt, childTaskId);
CREATE INDEX IF NOT EXISTS idx_task_delegations_root
  ON task_delegations(rootTaskId, depth, createdAt, childTaskId);

CREATE TABLE IF NOT EXISTS results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId     TEXT NOT NULL,
  nodeId     TEXT NOT NULL,
  success    INTEGER NOT NULL,
  diff       TEXT NOT NULL DEFAULT '',
  logs       TEXT NOT NULL DEFAULT '',
  durationMs INTEGER NOT NULL DEFAULT 0,
  subAgents  TEXT NOT NULL DEFAULT '[]',
  createdAt  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_task ON results(taskId);
-- Index COUVRANT du corpus des phéromones : sans lui, « ORDER BY createdAt
-- DESC, id DESC LIMIT 500 » scanne toute la table et la trie dans un B-tree
-- temporaire — en ouvrant au passage les pages de débordement de diff
-- (≤ 1 Mo) et logs (≤ 512 ko), qui précèdent createdAt dans la ligne.
-- Toutes les colonnes lues y figurent : la requête ne touche plus une seule
-- ligne de la table.
CREATE INDEX IF NOT EXISTS idx_results_recent
  ON results(createdAt DESC, id DESC, taskId, nodeId, success);
-- Index COUVRANT de la Balance (le pèse-ruche). Sans lui, la lecture
-- incrémentale du grand livre retombe sur « SEARCH results USING INTEGER
-- PRIMARY KEY » : SQLite ouvre alors la LIGNE, et durationMs est stocké APRÈS
-- diff (≤ 1 Mo) et logs (≤ 512 ko) — il faut traverser toute la chaîne de pages
-- de débordement pour lire un entier. Même raisonnement que le commentaire
-- d'idx_results_recent ci-dessus. Plans mesurés, et verrouillés par
-- tests/store-scaling.test.ts.
-- NE PAS étendre idx_results_recent pour y arriver : CREATE INDEX IF NOT EXISTS
-- ne redéfinit PAS un index existant — les bases déjà en service garderaient
-- l'ancienne définition et perdraient silencieusement leur plan couvrant.
-- Toujours un nom neuf. Les deux index ont des colonnes de tête différentes :
-- aucun des deux n'est redondant, et le nouveau ne détourne pas le planner du
-- corpus des phéromones (prouvé, même fichier de test).
CREATE INDEX IF NOT EXISTS idx_results_balance
  ON results(id, taskId, nodeId, success, durationMs);

-- Plafond de dépense par projet (la Balance — BORNER). Cette table stocke une
-- INTENTION HUMAINE, jamais un calcul : rien de dérivé n'est écrit en base
-- (doctrine, règle 1). Ligne ABSENTE = pas de plafond = comportement d'avant la
-- Balance, à la virgule près. L'absence de ligne EST l'état « éteint » : pas de
-- drapeau actif, pas de plafond nul déguisé.
--
-- PAS de pruneBudgets, JAMAIS (doctrine, règle 3). Cette table est 1:1 avec
-- projects : elle est bornée PAR CONSTRUCTION, sa taille est celle du nombre de
-- projets de la ruche, et aucune ligne ne peut y naître sans qu'un humain l'ait
-- posée. Un élagage « par symétrie » avec pruneEvents ou pruneResults effacerait
-- des intentions humaines encore en vigueur : ce serait un plafond qui se lève
-- tout seul. Cette phrase est ici pour que personne n'en ajoute un dans trois
-- ans.
--
-- version   : version de la SÉMANTIQUE du plafond au moment de la pose. Une v2
--             (plafond glissant, plafond par fenêtre…) pourra cohabiter avec
--             les lignes posées en v1, sans migration ni corpus corrompu.
-- definiPar : userId de l'opérateur, NULLABLE dès le jour 1 — filtrer par
--             opérateur plus tard coûtera une clause WHERE, jamais une
--             modification de colonne. Ce n'est PAS une autorisation, c'est une
--             trace : la garde reste le token du hub.
CREATE TABLE IF NOT EXISTS budgets (
  projectId TEXT PRIMARY KEY REFERENCES projects(id),
  plafondMs INTEGER NOT NULL,
  version   INTEGER NOT NULL DEFAULT 1,
  definiPar TEXT,
  updatedAt INTEGER NOT NULL
);

-- Le Plein Essaim — l'autonomie d'un projet, et rien d'autre.
--
-- UNE INTENTION HUMAINE, pas un calcul (règle 1 : aucune vue dérivée
-- matérialisée). Le niveau d'autonomie et l'inscription du dépôt sont posés à
-- la main par le propriétaire du projet ; rien ici ne naît d'une décision de
-- la ruche. Une ruche autonome qui pourrait élever son PROPRE niveau
-- d'autonomie ne serait pas gouvernée, elle serait échappée.
--
-- BORNE STRUCTURELLE, comme « budgets » (règle 3) : une ligne par projet, donc
-- une taille qui ne croît pas avec l'histoire de la ruche. Pas d'élagueur, et
-- il ne faut jamais en ajouter « par symétrie » — élaguer cette table
-- rendrait silencieusement à « off » un projet que l'humain avait ouvert, ou
-- pire, désinscrirait un dépôt sans que personne le sache.
CREATE TABLE IF NOT EXISTS essaim (
  projectId     TEXT PRIMARY KEY REFERENCES projects(id),
  niveau        TEXT NOT NULL,
  depotInscrit  INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL DEFAULT 1,
  definiPar     TEXT,
  updatedAt     INTEGER NOT NULL
);

-- L'Agent Garde-Fous — les BORNES qu'un humain pose sur l'apprentissage du
-- réglage du trou de vol d'un projet.
--
-- (Aucune apostrophe inversée dans ce bloc, et ce n'est pas un oubli : tout ce
-- schéma vit dans un littéral gabarit. Une seule le refermerait, et l'erreur
-- qu'on récolte alors parle de modules TypeScript, pas de SQL — le motif
-- « contre_visites ».)
--
-- UNE INTENTION HUMAINE, pas un calcul (règle 1) : « actif » (l'opt-in) et les
-- deux bornes {min, max} sont posés à la main par le propriétaire du projet.
-- L'Agent Garde-Fous élit un échelon DANS ces bornes ; il ne les écrit JAMAIS
-- lui-même. Un agent qui élargirait sa PROPRE latitude ne serait pas gouverné,
-- il serait échappé — exactement le motif d'« essaim ». L'échelon ÉLU n'est PAS
-- rangé ici : il se recalcule des antécédents (règle 1, aucune vue dérivée
-- matérialisée). Cette table ne porte que le CONSENTEMENT.
--
-- BORNE STRUCTURELLE (règle 3), comme « budgets » et « essaim » : une ligne par
-- projet, donc une taille qui ne croît pas avec l'histoire de la ruche. Pas
-- d'élagueur, et il ne faut jamais en ajouter « par symétrie » — l'effacer
-- rendrait à « inactif » un projet que l'humain avait ouvert, ou relâcherait ses
-- bornes sans que personne le sache.
CREATE TABLE IF NOT EXISTS garde_fous (
  projectId TEXT PRIMARY KEY REFERENCES projects(id),
  actif     INTEGER NOT NULL DEFAULT 0,
  borneMin  TEXT NOT NULL,
  borneMax  TEXT NOT NULL,
  version   INTEGER NOT NULL DEFAULT 1,
  definiPar TEXT,
  updatedAt INTEGER NOT NULL
);

-- Les abonnements — l'etat d'un droit, jamais un moyen de paiement.
--
-- CE QUI N'ENTRE JAMAIS ICI : numero de carte, IBAN, adresse de facturation,
-- nom de porteur. Le processeur de paiement les detient ; cette table n'a
-- qu'un identifiant OPAQUE (refExterne) et un etat. Detenir une donnee de
-- carte ferait entrer toute ruche auto-hebergee dans le perimetre PCI-DSS,
-- qu'aucun particulier ne peut tenir.
--
-- UNE INTENTION EXTERIEURE, pas un calcul (regle 1) : l'etat vient du
-- processeur, via un webhook dont la signature est verifiee. Rien ici ne naît
-- d'une decision de la ruche.
--
-- BORNE STRUCTURELLE (regle 3), comme « budgets » et « essaim » : une ligne
-- par projet. Pas d'elagueur, et il ne faut jamais en ajouter — effacer la
-- ligne d'un client qui paie lui retirerait ses droits sans que personne le
-- sache.
-- Les serveurs provisionnes. UNE LIGNE PAR MACHINE, jamais un calcul.
--
-- La cle d'idempotence est refAbonnement : un webhook rejoue ne doit pas
-- demarrer une machine de plus. L'index la sert.
--
-- BORNE D'ELAGAGE (regle 3), dans le MEME changement : pruneServeurs, qui ne
-- retire QUE les lignes « supprime ». Elaguer une machine encore allumee
-- perdrait la seule trace de ce qu'on paie — et personne ne saurait plus
-- l'eteindre.
CREATE TABLE IF NOT EXISTS serveurs (
  id            TEXT PRIMARY KEY,
  projectId     TEXT NOT NULL,
  refAbonnement TEXT NOT NULL,
  etat          TEXT NOT NULL,
  fournisseur   TEXT NOT NULL,
  refMachine    TEXT NOT NULL DEFAULT '',
  gabarit       TEXT NOT NULL DEFAULT '',
  motif         TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  creeA         INTEGER NOT NULL,
  majA          INTEGER NOT NULL,
  arreteA       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_serveurs_abonnement ON serveurs(refAbonnement);

CREATE TABLE IF NOT EXISTS abonnements (
  projectId    TEXT PRIMARY KEY REFERENCES projects(id),
  plan         TEXT NOT NULL,
  etat         TEXT NOT NULL,
  refExterne   TEXT NOT NULL DEFAULT '',
  finPeriode   INTEGER,
  impayeDepuis INTEGER,
  version      INTEGER NOT NULL DEFAULT 1,
  majA         INTEGER NOT NULL
);

-- Horloge de l'hebergeur. Deux tables, volontairement :
--   horloge_soldes : le total CLOTURE par projet (1:1 projects, borne humaine).
--   horloge_hote   : les sessions ENCORE OUVERTES (borne referentielle : la tache).
-- On n'archive PAS les sessions closes : les elaguer ferait sous-compter, et
-- le client recupererait des heures. Le solde, lui, survit.
--
-- En edition cloud, c'est la seule mesure facturable (MODELE-ECONOMIQUE §3.1).
CREATE TABLE IF NOT EXISTS horloge_soldes (
  projectId TEXT PRIMARY KEY,
  depenseMs INTEGER NOT NULL DEFAULT 0,
  version   INTEGER NOT NULL DEFAULT 1,
  majA      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS horloge_hote (
  taskId    TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  startedAt INTEGER NOT NULL,
  source    TEXT NOT NULL DEFAULT 'hote'
);
CREATE INDEX IF NOT EXISTS idx_horloge_hote_projet ON horloge_hote(projectId);

-- La Balance — CACHE RECONSTRUCTIBLE du grand livre. Son nom le dit, et c'est
-- délibéré : balance_ledger_cache n'est PAS une source de vérité. La vérité
-- reste results, et cette table peut être effacée à tout moment sans perdre
-- une seule information — le rattrapage la reconstruit à l'identique. Voir la
-- règle 1 de la doctrine (balance.ts) pour la justification complète de la
-- seule exception à « rien de calculé n'est écrit en base ».
--
-- Elle existe pour une seule raison : sans elle, le filigrane repart de 0 à
-- chaque démarrage et le rattrapage relit TOUT l'historique — O(un an de ruche)
-- au boot, pendant lequel la porte des plafonds reste ouverte (FAIL-OPEN).
--
-- BORNE D'ÉLAGAGE (règle 3), STRUCTURELLE comme celle de budgets : une ligne
-- par projet ayant dépensé, donc ≤ projects. Elle ne croît pas avec l'histoire
-- de la ruche, et n'a donc PAS de pruneLedgerCache.
--
-- filigrane : id du dernier résultat absorbé. IDENTIQUE sur toutes les lignes —
--             elles sont réécrites ensemble, dans une seule transaction. Des
--             filigranes divergents = cache corrompu = reconstruction totale.
-- version   : VERSION_BALANCE au moment de l'écriture. Une v2 de l'imputation
--             invalide le cache sans migration : on le jette, on recompte.
--
-- AUCUNE clé étrangère vers projects, contrairement à budgets — et c'est
-- délibéré : cette table est écrite DANS LE TICK. Une contrainte violée y
-- lèverait une exception sur le chemin chaud pour protéger... un cache, qu'on
-- peut jeter. Un projectId orphelin dans un cache ne coûte rien ; un tick qui
-- explose, si.
CREATE TABLE IF NOT EXISTS balance_ledger_cache (
  projectId  TEXT PRIMARY KEY,
  depenseMs  INTEGER NOT NULL,
  tentatives INTEGER NOT NULL,
  filigrane  INTEGER NOT NULL,
  version    INTEGER NOT NULL
);

-- Les Gardiennes — le contrôle d'entrée du nectar. UNE LIGNE PAR INSPECTION,
-- écrite À LA RÉCEPTION du résultat (scheduler.handleTaskResult).
--
-- POURQUOI UNE TABLE, alors que la doctrine interdit d'écrire un calcul
-- (règle 1) : parce que ce verdict N'EST PAS RECALCULABLE. pruneResults vide
-- diff et logs au-delà de 5 000 résultats ; un verdict recalculé plus tard sur
-- un diff élagué dirait « diff vide » de toutes les productions anciennes.
-- Ce n'est donc pas un cache (rien ne peut le reconstruire), c'est un FAIT
-- DATÉ — la seule catégorie d'écriture que la règle 1 n'a jamais visée.
--
-- POURQUOI PAS UNE COLONNE SUR results : l'y ajouter exigerait la première
-- MIGRATION du dépôt, qui n'a aucun mécanisme pour ça (règle 2) — et le verrou
-- de source de tests/security-invariants.test.ts l'interdit à la lettre. Le piège
-- est pire qu'il n'en a l'air — ajouter une colonne au SELECT des phéromones
-- ferait retomber SILENCIEUSEMENT toutes les bases en service hors de l'index
-- couvrant idx_results_recent, car CREATE INDEX IF NOT EXISTS ne redéfinit PAS
-- un index existant. Table NEUVE, index existants INTACTS — et aucun index
-- ajouté ici : la seule lecture est un parcours ARRIÈRE de la clé primaire,
-- borné par un LIMIT (plan prouvé dans tests/store-scaling.test.ts).
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME commit : pruneGardiennes, aligné sur
-- EVENT_RETENTION et RESULT_RETENTION. Cette table-ci n'est PAS bornée par
-- construction (elle grandit avec l'histoire), contrairement à budgets et à
-- balance_ledger_cache : elle a donc un vrai élagueur, et il SUPPRIME (une
-- ligne allégée de ses griefs ne dirait plus rien).
--
-- resultId : results.id de la production inspectée — le fait pointe sur sa
--            pièce à conviction, tant qu'elle existe. Aucune clé étrangère :
--            la table est écrite sur le chemin d'un résultat, et une contrainte
--            violée y lèverait une exception pour protéger une trace.
-- applique : 1 = le verdict a RÉELLEMENT refusé l'entrée (mode strict
--            seulement). En consultatif, toujours 0 : on annote, on ne
--            contraint pas. C'est ce qui rend les deux modes distinguables
--            APRÈS COUP, sans quoi une campagne d'observation serait illisible.
-- griefs   : JSON des griefs typés (codes anglais snake_case, chemins, comptes,
--            extrait déjà neutralisé). AUCUN texte d'affichage : le bilingue
--            est reconstruit à la lecture.
-- version  : VERSION_GARDIENNES à l'inspection. Une v2 du barème cohabitera
--            avec les lignes v1 sans migration ni corpus corrompu.
CREATE TABLE IF NOT EXISTS gardiennes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  resultId  INTEGER NOT NULL,
  taskId    TEXT NOT NULL,
  nodeId    TEXT NOT NULL,
  verdict   TEXT NOT NULL,
  score     INTEGER NOT NULL,
  applique  INTEGER NOT NULL DEFAULT 0,
  griefs    TEXT NOT NULL DEFAULT '[]',
  version   INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);

-- ─── Les livraisons ─────────────────────────────────────────────────────────
-- Ce que la ruche a DEJA réservé ou ouvert sur le depot de l'utilisateur.
-- l'état en_cours est une réservation durable pendant l'appel GitHub ;
-- elle empêche un retry concurrent avant qu'un numéro de PR existe.
--
-- Table LATERALE (regle 2 : aucune migration). Sans cette trace, le runner
-- d'essaim relirait la meme production relue a chaque cycle et rouvrirait une
-- pull request toutes les minutes sur le depot de quelqu'un -- la faute la plus
-- visible qu'une ruche autonome puisse commettre.
--
-- BORNE D'ELAGAGE (regle 3), dans le MEME changement : « pruneLivraisons »,
-- qui garde les N plus recentes et balaye celles dont la tache a disparu.
-- N est choisi >= RESULT_RETENTION, et l'ecart n'est pas cosmetique : une
-- production n'est livrable que tant que son resultat existe (il porte le
-- diff). Elaguer les livraisons AVANT les resultats ressusciterait donc une
-- tache deja livree, et la ruche rouvrirait sa PR.
CREATE TABLE IF NOT EXISTS livraisons (
  taskId    TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  depot     TEXT NOT NULL,
  pr        INTEGER NOT NULL,
  branche   TEXT NOT NULL,
  etat      TEXT NOT NULL,
  motif     TEXT NOT NULL DEFAULT '',
  version   INTEGER NOT NULL,
  creeA     INTEGER NOT NULL,
  majA      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_livraisons_projet ON livraisons(projectId, etat);

-- ─── La lignée d'une reprise : quelle tâche PROLONGE quelle pull request ────
-- Une reprise (POST .../livraisons/:taskId/reprendre) corrige une PR déjà
-- livrée SUR SA BRANCHE. Sans cette ligne, rien ne relie la tâche de reprise à
-- la branche qu'elle doit prolonger : le scheduler lui donnait hive/<nouvelId>,
-- l'ouvrière clonait la branche par défaut (sans le travail de la PR), et la
-- livraison ouvrait une SECONDE pull request qui ne contenait que le
-- correctif, pendant que la première restait rouge. La lignée ne vivait que
-- dans l'événement livraison_reprise, qu'aucune décision ne relit.
--
-- origine : la tâche de la PREMIÈRE livraison de la PR — le plafond de
--           reprises se compte sur elle, pas sur le numéro de PR ;
-- parent  : la livraison reprise directement (l'origine, ou une reprise
--           précédente déjà livrée) ;
-- tete    : le SHA de tête que GitHub montrait à la reprise. Provenance
--           seulement : la livraison relit la tête au moment d'écrire.
--
-- Table LATÉRALE (règle 2 : aucune migration), écrite une fois par reprise et
-- jamais réécrite (INSERT sans remplacement : la lignée est un fait daté).
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME changement : « pruneReprisesLivraison »,
-- référentielle — la lignée ne survit pas à la tâche de reprise.
CREATE TABLE IF NOT EXISTS reprises_livraison (
  taskId    TEXT PRIMARY KEY,
  origine   TEXT NOT NULL,
  parent    TEXT NOT NULL,
  projectId TEXT NOT NULL,
  depot     TEXT NOT NULL,
  pr        INTEGER NOT NULL,
  branche   TEXT NOT NULL,
  tete      TEXT NOT NULL,
  creeA     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reprises_livraison_origine ON reprises_livraison(origine);

-- ─── D'où vient une tâche : l'issue qui l'a demandée ────────────────────────
-- Table LATÉRALE, et pas une colonne de plus sur « tasks » : la très grande
-- majorité des tâches ne vient d'aucune issue, et une colonne vide sur toutes
-- les lignes est une colonne qu'on finit par remplir d'autre chose.
--
-- Le lien sert à UNE chose : écrire « Closes #N » dans la pull request pour que
-- GitHub referme l'issue au merge. Sans lui, la ruche répond à une demande sans
-- jamais dire qu'elle y répond, et le demandeur doit refermer à la main.
--
-- BORNE D'ÉLAGAGE : le lien ne survit pas à sa tâche (pruneTachesIssue). Il
-- n'a aucun intérêt propre — sans la tâche, il ne désigne plus rien.
CREATE TABLE IF NOT EXISTS taches_issue (
  taskId    TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  depot     TEXT NOT NULL,
  numero    INTEGER NOT NULL,
  creeA     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_taches_issue_projet ON taches_issue(projectId, numero);

-- ─── La contre-expertise : quelle tâche RELIT quelle production ─────────────
-- Table LATÉRALE, et elle fait DEUX choses à dessein — c'est le même fait, vu
-- des deux bouts :
--
--   · elle MARQUE une tâche comme relecture. Sans cette marque, le résultat
--     d'une relecture repartirait dans « signalerContreExpertise » comme une
--     production ordinaire, et serait relu à son tour. À l'infini.
--   · elle CORRÈLE l'avis à la production jugée quand il revient. Sans elle,
--     un verdict arriverait sans qu'on sache de quoi il parle.
--
-- Une colonne de plus sur « tasks » aurait fait les deux aussi, et aurait été
-- vide sur l'écrasante majorité des lignes — sans compter qu'ajouter une
-- colonne demande une migration, ce que ce dépôt s'interdit.
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME changement : « pruneContreExpertises »,
-- référentielle comme celle des issues — un lien dont la relecture ou la
-- production a disparu ne désigne plus rien.
CREATE TABLE IF NOT EXISTS contre_expertises (
  relectureTaskId  TEXT PRIMARY KEY,
  productionTaskId TEXT NOT NULL,
  relecteurNodeId  TEXT NOT NULL,
  relecteurAgent   TEXT NOT NULL,
  producteurAgent  TEXT NOT NULL,
  creeA            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contre_expertises_prod ON contre_expertises(productionTaskId);

-- ─── Ce qu'une contre-visite a DÉCIDÉ ───────────────────────────────────────
-- « contre_expertises » dit QUI relit QUOI. Elle ne dit pas ce qui en est
-- revenu, et c'est ce qui manquait pour que HIVE_POLYETHISME=strict fasse
-- quelque chose : le verdict vivait dans un événement, donc dans le passé,
-- alors que la décision de livrer se prend plus tard, sur un autre tick.
--
-- (Aucune apostrophe inversée dans ce bloc, et ce n'est pas un oubli : tout ce
-- schéma vit dans un littéral gabarit. Une seule le refermerait, et l'erreur
-- qu'on récolte alors parle de modules TypeScript, pas de SQL.)
--
-- Table LATÉRALE, et pas une colonne de plus sur « contre_expertises »
-- (règle 2 : aucune migration). Elle est aussi clé par PRODUCTION, pas par
-- relecture : ce qui compte au moment de livrer, c'est « cette production
-- a-t-elle été contre-visitée », pas « laquelle des trois relectures a
-- répondu ».
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME changement : « pruneContreVisites »,
-- référentielle comme ses voisines. Elle est VRAIE dès le premier jour — la
-- table « tasks » a son élagueur depuis le lot 17.
CREATE TABLE IF NOT EXISTS contre_visites (
  productionTaskId TEXT PRIMARY KEY,
  suite            TEXT NOT NULL CHECK (suite IN ('appliquer', 'ameliorer', 'refaire')),
  raison           TEXT NOT NULL DEFAULT '',
  visiteurNodeId   TEXT NOT NULL,
  visiteurAgent    TEXT NOT NULL,
  renduA           INTEGER NOT NULL
);

-- ─── L'Aiguillage appris : le SEUL fait qui manque, et rien d'autre ──────────
-- Quel modèle a été choisi pour produire quelle tâche. Ce fait ne vit nulle
-- part ailleurs : la table tasks n'a pas de colonne modèle, et la règle 2
-- (aucune colonne sur une table existante, aucun ALTER) interdit de lui en
-- ajouter une. D'où une table LATÉRALE clé-par-tâche, exactement comme
-- contre_visites, taches_issue, contre_expertises et conseil_plans.
--
-- On ne recopie NI le verdict (il reste dans contre_visites) NI la catégorie
-- (recalculée par categoriser à la lecture, pour suivre la taxonomie du jour).
-- Les observations de l'Aiguillage sont RECONSTRUITES par jointure — une seule
-- source par fait, pas de duplication qui dérive.
--
-- INSERT OR REPLACE : la DERNIÈRE assignation gagne, ce qui aligne « dernier
-- modèle choisi » sur « dernier verdict » (contre_visites fait pareil).
--
-- BORNE (règle 3) : pruneAiguillageModeles, référentielle, câblée dans
-- server.ts après pruneTasks. Elle naît vraie — des tâches disparaissent
-- pour de bon depuis le lot 17.
CREATE TABLE IF NOT EXISTS aiguillage_modeles (
  taskId  TEXT PRIMARY KEY,
  modele  TEXT NOT NULL,
  choisiA INTEGER NOT NULL
);

-- La consigne de l'OPÉRATEUR sur le routage d'une tâche (shared/consigne-routage.ts) :
-- familles ou modèles imposés, familles ou modèles exclus. UNE INTENTION
-- HUMAINE, pas un calcul — la ligne absente EST « aucune consigne », comme
-- pour « budgets » : pas de drapeau, pas de consigne vide déguisée.
--
-- Une table LATÉRALE clé-par-tâche et non une colonne « tasks » : la règle 2
-- (aucune colonne sur une table existante, aucun ALTER) tient, et le résultat
-- est le même — une valeur nullable par tâche, additive et idempotente
-- (CREATE TABLE IF NOT EXISTS) sur une base déjà en service.
--
-- definiPar : userId du compte qui l'a posée, NULL pour le jeton de ruche. Une
-- trace, pas une autorisation : la garde est celle des décisions sur une tâche.
--
-- BORNE (règle 3) : cascade de pruneTasks — la consigne part avec sa tâche.
CREATE TABLE IF NOT EXISTS consignes_routage (
  taskId    TEXT PRIMARY KEY,
  consigne  TEXT NOT NULL,
  definiPar TEXT,
  majA      INTEGER NOT NULL
);

-- La dépense DÉCLARÉE de chaque tentative d'un enfant délégué — le seul fait
-- qui manque pour tenir le budget coût d'un arbre. Le coût vivait déjà au
-- journal (task_done / task_retry / task_failed), mais le journal s'élague PAR
-- NOMBRE (EVENT_RETENTION) : sur une ruche occupée, la dépense d'un arbre
-- encore en vol pouvait s'y effacer, et son budget se remplir tout seul.
--
-- Une ligne par TENTATIVE, ouverte à l'envoi au nœud (ouvrirTentativeDelegation,
-- un drone de course compte pour une) et close par insertResult dans la même
-- transaction que son résultat (resultId). Ouverte à l'envoi et non au
-- résultat : une tentative interrompue SANS résultat — nœud perdu, annulation,
-- enveloppe épuisée — a pu dépenser, et resterait sinon invisible. Elle garde
-- resultId NULL et coutMicros NULL : inconnue, jamais zéro (voir
-- DepenseDeclaree, delegation.ts).
--
-- BORNE (règle 3) : cascade de pruneTasks, par RACINE — elle ne part qu'avec
-- l'arbre entier. Élaguée avec l'enfant, la dépense d'une racine encore
-- vivante aurait baissé, et son budget avec.
CREATE TABLE IF NOT EXISTS depenses_delegation (
  id         INTEGER PRIMARY KEY,
  rootTaskId TEXT NOT NULL,
  taskId     TEXT NOT NULL,
  nodeId     TEXT NOT NULL,
  resultId   INTEGER UNIQUE,
  coutMicros INTEGER,
  creeA      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_depenses_delegation_racine
  ON depenses_delegation(rootTaskId, coutMicros);
CREATE INDEX IF NOT EXISTS idx_depenses_delegation_tache
  ON depenses_delegation(taskId, nodeId, resultId);

-- Le RESTE du bras commandé (VERSION_AIGUILLAGE 3) : le harness (l'agentType
-- du nœud) et l'effort, à côté du modèle d'aiguillage_modeles. Table LATÉRALE
-- et jumelle (règle 2 : aiguillage_modeles ne prend pas de colonne), même clé,
-- même cycle de vie : posée et effacée avec elle, par les mêmes appels.
-- effort NULL : aucun effort commandé, le CLI garde son défaut.
--
-- coutUsd : le coût que le CLI a DÉCLARÉ pour la production rendue sous ce
-- bras (task_done, fournisseur.coutUsd), NULL tant qu'il n'a rien déclaré —
-- jamais estimé, jamais tiré des jetons. Une réassignation REPOSE la ligne :
-- le coût d'une tentative ne survit pas à la suivante, comme le verdict lu est
-- celui de la dernière production.
--
-- Une tâche sans ligne ici (élection d'avant la v3) : aucun effort n'était
-- commandé, et son harness se CONSTATE sur le nœud du résultat relu
-- (observationsAiguillage) ; sans lui, le verdict nourrit le seul niveau modèle,
-- jamais un bras par supposition.
--
-- BORNE (règle 3) : pruneAiguillageModeles l'élague avec sa jumelle.
CREATE TABLE IF NOT EXISTS aiguillage_bras (
  taskId  TEXT PRIMARY KEY,
  harness TEXT NOT NULL,
  effort  TEXT,
  coutUsd REAL,
  choisiA INTEGER NOT NULL
);

-- L'Agent Garde-Fous : quel ÉCHELON de garde-fous a gouverné quelle tâche. Fait
-- posé à l'assignation, clé par tâche, motif aiguillage_modeles au mot près
-- (INSERT OR REPLACE : une réassignation ré-élit, la dernière gouverne). On ne
-- recopie NI le verdict (il vit dans gardiennes) NI l'exigence : les observations
-- de la récompense se RECONSTRUISENT par jointure — une seule source par fait.
-- BORNE (règle 3) : pruneGardeFouEchelons, référentielle, câblée après pruneTasks
-- (motif pruneAiguillageModeles). Vraie dès le premier jour — les tâches
-- disparaissent pour de bon depuis le lot 17.
CREATE TABLE IF NOT EXISTS garde_fou_echelons (
  taskId  TEXT PRIMARY KEY,
  echelon TEXT NOT NULL,
  choisiA INTEGER NOT NULL
);

-- L'Agent Garde-Fous : une contre-visite était-elle EXIGÉE pour cette production,
-- ou en était-elle DISPENSÉE ? C'est le SEUL atome non recalculable du problème —
-- il se décide à l'instant où la caste VIVE est interrogée (exigeContreVisite),
-- et rejuger une vieille production avec la caste d'aujourd'hui serait un mensonge
-- à retardement (le mal que la doctrine des Gardiennes existe pour empêcher). On
-- le fige donc ici, et rien d'autre : la traversee (directe / retenue / en_attente)
-- reste une VUE dérivée de deux faits datés — cette exigence x la contre_visite.
--
-- Le verdict « attendre » du polyéthisme (production retenue faute de relecteur)
-- ne vit PAS dans contre_visites (sa contrainte CHECK ne l'admet pas) : c'est
-- exactement le trou que cette table comble, pour que « retenue à la revue » ne
-- se confonde pas avec « passée librement ».
--
-- CHECK à deux valeurs, comme contre_visites : une v2 cohabitera sans migration.
-- BORNE (règle 3) : pruneGardeFouExigences, référentielle, câblée après pruneTasks.
CREATE TABLE IF NOT EXISTS garde_fou_exigences (
  productionTaskId TEXT PRIMARY KEY,
  exigence         TEXT NOT NULL CHECK (exigence IN ('exigee', 'dispensee')),
  decideA          INTEGER NOT NULL
);

-- Le banc d'ombre (shadow-bench.ts) — le CONSENTEMENT d'un projet, et rien
-- d'autre. Motif « garde_fous » : UNE INTENTION HUMAINE (règle 1), posée par
-- qui répond du projet ; le banc ne s'allume ni n'élargit jamais son budget
-- lui-même. Ligne ABSENTE = banc éteint : il coûte de vrais appels de modèle.
--
-- BORNE STRUCTURELLE (règle 3) : une ligne par projet. Pas d'élagueur, et il
-- ne faut jamais en ajouter « par symétrie » — l'effacer éteindrait un banc
-- que l'humain avait allumé, ou relâcherait son budget, sans un mot.
CREATE TABLE IF NOT EXISTS banc_ombre (
  projectId         TEXT PRIMARY KEY REFERENCES projects(id),
  actif             INTEGER NOT NULL DEFAULT 0,
  tauxPourMille     INTEGER NOT NULL,
  executionsParJour INTEGER NOT NULL,
  plafondCoutUsd    REAL NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  definiPar         TEXT,
  updatedAt         INTEGER NOT NULL
);

-- Les ombres : quelle tâche REJOUE quelle production, avec quel modèle — et
-- ce que la comparaison a donné.
-- Table LATÉRALE, motif « contre_expertises » : elle MARQUE une tâche comme
-- ombre — sans cette marque, l'ombre se livrerait, se fusionnerait et
-- nourrirait le routing comme une production ordinaire — et elle CORRÈLE
-- l'ombre à la production originale qu'elle mesure (resultatOriginal).
--
-- Le modèle de l'ombre vit ICI et nulle part ailleurs, jamais dans
-- aiguillage_modeles : c'est ce qui la tient hors de la récompense et des
-- élections en vol de l'Aiguillage (décision écrite en tête de shadow-bench.ts).
--
-- UNIQUE sur la tâche originale : une ombre par tâche, jamais deux.
-- coutDeclareUsd / executionsMuettes : ce que l'ombre et ses relectures ont
-- DÉCLARÉ coûter, et combien n'ont rien déclaré. Le budget se lit ici : un
-- journal élagué à 5 000 événements l'aurait oublié avant la fin de la journée.
--
-- LES DEUX CÔTÉS DE LA COMPARAISON, RANGÉS ICI pour la même raison : le banc
-- PAIE chaque comparaison, et un registre Genome qui la relirait du journal
-- l'oublierait après 5 000 événements — une ruche occupée perdrait sa semaine
-- de mesures en une nuit. original* est figé à l'ouverture (la production
-- originale est déjà jugée par ses tests) ; ombre* à son rendu (une seule
-- tentative) ; *Revue ('validee' | 'contestee' | 'absente') à chaque avis de
-- contre-revue sur CE résultat exact. Des faits, jamais un verdict : le
-- verdict et la confiance se recalculent à la lecture (comparerOmbre), une
-- seule règle pour tous.
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME changement : pruneTachesOmbre,
-- référentielle — une ligne dont l'ombre a disparu ne désigne plus rien. Les
-- comparaisons vivent donc aussi longtemps que les tâches (TACHES_RETENTION_MS).
CREATE TABLE IF NOT EXISTS taches_ombre (
  tacheOmbre        TEXT PRIMARY KEY,
  tacheOriginale    TEXT NOT NULL UNIQUE,
  projectId         TEXT NOT NULL,
  resultatOriginal  INTEGER NOT NULL,
  modeleOriginal    TEXT NOT NULL,
  modeleOmbre       TEXT NOT NULL,
  categorie         TEXT NOT NULL,
  coutDeclareUsd    REAL NOT NULL DEFAULT 0,
  executionsMuettes INTEGER NOT NULL DEFAULT 0,
  creeA             INTEGER NOT NULL,
  originalSucces    INTEGER NOT NULL,
  originalTests     TEXT,
  originalBase      TEXT,
  originalRevue     TEXT NOT NULL DEFAULT 'absente',
  ombreResultat     INTEGER,
  ombreSucces       INTEGER,
  ombreTests        TEXT,
  ombreBase         TEXT,
  ombreRevue        TEXT NOT NULL DEFAULT 'absente'
);
CREATE INDEX IF NOT EXISTS idx_taches_ombre_projet ON taches_ombre(projectId, creeA);

-- ─── Le trou de vol ─────────────────────────────────────────────────────────
-- Deux tables, une par nature, et surtout PAS une seule : un billet est une
-- invitation éphémère qu'on distribue, une clé de nœud est une identité durable
-- qu'on garde. Les confondre, c'est ce que faisait l'ancien format (un seul
-- token pour tout et pour tous) — et c'est exactement pourquoi on ne pouvait
-- exclure personne sans éjecter l'essaim entier.
--
-- AUCUN SECRET N'EST RANGÉ ICI. Les deux tables ne portent que des empreintes
-- PBKDF2 salées (src/shared/acces.ts) : une base volée ne donne aucun accès.
--
-- BORNE D'ÉLAGAGE (règle 3 de la doctrine), dans le MÊME changement :
-- « pruneAcces », qui supprime les billets morts (révoqués, expirés ou épuisés)
-- au-delà d'une période de grâce. Les billets VIVANTS ne sont jamais élagués —
-- un billet encore valide qui disparaîtrait rendrait une invitation en circulation
-- silencieusement inutilisable. Les clés de nœud, elles, ne sont PAS élaguées
-- automatiquement : ce sont des identités, leur retrait est un geste humain
-- (révocation), exactement comme le merge.
CREATE TABLE IF NOT EXISTS invite_tickets (
  id           TEXT PRIMARY KEY,
  secretHash   TEXT NOT NULL,
  label        TEXT,
  createdBy    TEXT,
  createdAt    INTEGER NOT NULL,
  expiresAt    INTEGER NOT NULL,
  usesLeft     INTEGER NOT NULL,
  usesTotal    INTEGER NOT NULL,
  revokedAt    INTEGER,
  lastUsedAt   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tickets_expiry ON invite_tickets(expiresAt);

-- Les LIENS DE PARTAGE : montrer un projet à quelqu'un qui n'a pas de compte.
--
-- Table NEUVE et LATÉRALE, comme le veut la doctrine : aucune migration,
-- aucune colonne ajoutée ailleurs, aucun index existant modifié. Elle ne réutilise pas invite_tickets bien que
-- la forme se ressemble, et c'est délibéré — un billet fait entrer une MACHINE
-- dans l'essaim, un partage fait LIRE un projet à un humain. Les mêler
-- rendrait possible, un jour, d'échanger l'un contre l'autre par mégarde.
--
-- AUCUN SECRET N'EST RANGÉ ICI : seulement une empreinte PBKDF2 salée
-- (src/shared/acces.ts), comme pour les billets. Une base volée ne donne aucun
-- lien utilisable.
--
-- « projectId » n'est PAS une clé étrangère déclarée, par cohérence avec le reste
-- du schéma : la suppression d'un projet est déjà un geste humain qui passe par
-- le code, et une contrainte ici ferait échouer cette suppression au lieu de la
-- nettoyer.
--
-- BORNE D'ELAGAGE (regle 3), dans le MEME changement : « prunePartages »,
-- qui supprime les partages MORTS (révoqués ou expirés) passée une période de
-- grâce. Les partages vivants ne sont jamais élagués — un lien encore valide
-- qui disparaîtrait deviendrait silencieusement inutilisable chez celui à qui
-- on l'a envoyé, et personne ne saurait pourquoi.
CREATE TABLE IF NOT EXISTS partages (
  id           TEXT PRIMARY KEY,
  projectId    TEXT NOT NULL,
  secretHash   TEXT NOT NULL,
  label        TEXT,
  creePar      TEXT,
  creeA        INTEGER NOT NULL,
  expireA      INTEGER NOT NULL,
  revoqueA     INTEGER NOT NULL DEFAULT 0,
  vuA          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_partages_projet ON partages(projectId);
CREATE INDEX IF NOT EXISTS idx_partages_expiry ON partages(expireA);

-- Une clé par nœud. « nodeId » est la clé primaire : un nœud a UNE identité, et
-- rejoindre à nouveau avec un nouveau billet remplace sa clé (rotation) plutôt
-- que d'en accumuler.
CREATE TABLE IF NOT EXISTS node_keys (
  nodeId     TEXT PRIMARY KEY,
  keyHash    TEXT NOT NULL,
  label      TEXT,
  ticketId   TEXT,
  createdAt  INTEGER NOT NULL,
  lastSeenAt INTEGER,
  revokedAt  INTEGER
);

-- ─── Le Conseil des Éclaireuses ─────────────────────────────────────────────
-- Quatre tables parce qu'il y a quatre natures distinctes : une SESSION (la
-- question posée), les TÂCHES qu'elle a engendrées (le lien vers le travail
-- réel des ouvrières), les PROPOSITIONS rapportées, et les AVIS émis dessus.
--
-- Les propositions et les avis portent du texte écrit par des agents qui ont LU
-- LE WEB. Ils sont donc rangés tels quels — déjà aplatis et bornés par
-- eclaireuse.ts — et ne ressortent JAMAIS dans un prompt autrement que via
-- src/shared/donnees-non-fiables.ts.
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME changement : « pruneConseils », qui
-- ne supprime que des sessions CLOSES au-delà d'un quota. Une session en cours
-- n'est jamais touchée — la faire disparaître laisserait des tâches
-- d'éclaireuses orphelines qui tourneraient pour un conseil inexistant.
CREATE TABLE IF NOT EXISTS conseil_sessions (
  id        TEXT PRIMARY KEY,
  question  TEXT NOT NULL,
  projectId TEXT,
  etat      TEXT NOT NULL,
  tour      INTEGER NOT NULL DEFAULT 1,
  toursSecs INTEGER NOT NULL DEFAULT 0,
  issue     TEXT,
  motif     TEXT,
  version   INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  closedAt  INTEGER
);

-- Le verdict d'un conseil a-t-il DEJA ete transforme en travail ?
--
-- Table LATERALE (regle 2 de la doctrine : aucune migration, aucune colonne
-- ajoutee a une table existante). Sans cette trace, le runner relirait le meme
-- verdict clos a chaque cycle et creerait la meme tache toutes les minutes,
-- pour toujours -- exactement la boucle que la cadence est censee empecher.
--
-- BORNE D'ELAGAGE (regle 3), dans le MEME changement : « pruneConseils »
-- supprime la ligne en meme temps que la session dont elle depend, et un
-- balayage y jette les orphelines. La table ne peut donc pas depasser le quota
-- de sessions conservees.
CREATE TABLE IF NOT EXISTS conseil_plans (
  sessionId TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  taches    INTEGER NOT NULL,
  version   INTEGER NOT NULL,
  creeA     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conseil_plans_projet ON conseil_plans(projectId);

-- Le lien tache <-> role. Sans lui, on ne saurait pas si un resultat qui
-- revient est une exploration ou la verification d'une proposition precise.
CREATE TABLE IF NOT EXISTS conseil_taches (
  taskId        TEXT PRIMARY KEY,
  sessionId     TEXT NOT NULL,
  role          TEXT NOT NULL,
  lentille      TEXT,
  propositionId TEXT,
  tour          INTEGER NOT NULL,
  depouille     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_conseil_taches_session ON conseil_taches(sessionId, depouille);

CREATE TABLE IF NOT EXISTS conseil_propositions (
  id         TEXT PRIMARY KEY,
  sessionId  TEXT NOT NULL,
  eclaireuse TEXT NOT NULL,
  famille    TEXT NOT NULL,
  titre      TEXT NOT NULL,
  corps      TEXT NOT NULL,
  qualite    INTEGER NOT NULL,
  sources    TEXT NOT NULL DEFAULT '[]',
  tour       INTEGER NOT NULL,
  createdAt  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conseil_props_session ON conseil_propositions(sessionId);

CREATE TABLE IF NOT EXISTS conseil_avis (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId     TEXT NOT NULL,
  propositionId TEXT NOT NULL,
  eclaireuse    TEXT NOT NULL,
  famille       TEXT NOT NULL,
  type          TEXT NOT NULL,
  force         INTEGER NOT NULL,
  raison        TEXT NOT NULL DEFAULT '',
  tour          INTEGER NOT NULL,
  createdAt     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conseil_avis_session ON conseil_avis(sessionId);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}'
);
-- Lecture par FENÊTRE TEMPORELLE (thermorégulation) : ts en tête pour la
-- borne « ts >= ? », type ensuite pour filtrer sans ouvrir la ligne.
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts, type);
-- Lecture PAR TYPE (et par id, que l'index porte avec la clé) : les preuves
-- d'une tâche se relisent par type — la CI d'un résultat, l'annonce d'une
-- relecture, le verdict humain. Depuis que la rétention garde les preuves avec
-- leur tâche, le journal ne tient plus en 5 000 lignes : sans cet index,
-- chacune de ces lectures parcourrait tout le journal retenu, jusqu'au plafond.
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
-- Lecture PAR TÂCHE : les preuves d'une production (sa CI, ses verdicts, sa
-- critique, sa mesure) sans parcourir celles de toutes les autres. Voir
-- TACHE_DE_L_EVENEMENT pour l'expression, et pourquoi elle est gardée.
CREATE INDEX IF NOT EXISTS idx_events_tache ON events(${TACHE_DE_L_EVENEMENT}, type);

-- ─── Ce que la rétention du journal a retiré, par type et par motif ─────────
-- Le compte DURABLE de l'élagage : l'événement journal_elagage raconte chaque
-- passe mais sort lui-même du journal avec la fenêtre. Sans cette table, le
-- type d'un événement élagué se perdait avec lui, et le Genome devait se dire
-- tronqué dès la première trace retirée (cf. HiveStore.faitsElagues).
-- Une ligne par couple (type, motif), cumulée : bornée par le vocabulaire
-- FERMÉ des types que le code émet, jamais une ligne par événement.
-- avant_registre : les suppressions faites AVANT que ce registre existe, dont
-- le type est perdu — posée une fois, à la première ouverture d'une base qui
-- en avait (cf. HiveStore.amorcerRegistreElagages).
CREATE TABLE IF NOT EXISTS journal_elagages (
  type      TEXT NOT NULL,
  motif     TEXT NOT NULL CHECK (motif IN ('trace', 'orpheline', 'echue', 'plafond_close', 'plafond_vivante', 'plafond_coupe', 'avant_registre')),
  supprimes INTEGER NOT NULL,
  dernierA  INTEGER NOT NULL,
  PRIMARY KEY (type, motif)
);

CREATE TABLE IF NOT EXISTS memories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL,
  taskId    TEXT NOT NULL,
  title     TEXT NOT NULL,
  content   TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_task ON memories(taskId);

-- Le souvenir qu'une production PROPOSE au Hive Mind, en attendant qu'on la
-- juge. Écrit À LA RÉCEPTION d'une réussite (scheduler.handleTaskResult) :
-- c'est le seul instant où la réponse finale de l'agent est en main — le
-- journal ne la garde pas pour un succès (insertResult), et le souvenir en est
-- fait. Il n'entre dans « memories » qu'à l'acceptation de l'Evaluator ou à
-- l'approbation humaine (hive-mind.ts, suiteSouvenir).
--
-- POURQUOI UNE TABLE LATÉRALE : « memories » n'a pas de colonne pour dire
-- « pas encore validé », et en ajouter une serait une migration (règle 2).
--
-- POURQUOI UNE ISSUE RANGÉE, alors que la règle 1 interdit d'écrire un calcul :
-- ce n'est pas le verdict qu'on range — l'Evaluator le recalcule à chaque
-- lecture —, c'est ce que la ruche en a DÉJÀ FAIT. Sans elle, chaque fait relu
-- (un avis, une CI, une revue) reverserait au Cerveau le même rejet, et le
-- compteur de récurrences mentirait.
--
-- resultId : la production exacte jugée ; une nouvelle production de la même
--            tâche REMPLACE la ligne (clé primaire taskId), et un verdict
--            rendu sur l'ancienne ne touche plus rien.
-- validePar : QUI a validé le souvenir retenu (hive-mind.ts,
--            ValidationSouvenir) — une approbation humaine retirée le
--            retire, une preuve de l'Evaluator qui vieillit, non. NULL hors de
--            « retenu », et pour un souvenir HÉRITÉ d'avant ce registre
--            (adopterSouvenirHerite), dont on ne sait pas qui l'a validé.
-- episode  : la porte qui a DÉJÀ versé au Cerveau l'échec de CETTE production.
--            Un échec, un épisode : sans elle, une objection arrivée après un
--            rejet de l'Evaluator, ou un rejet défait puis redit, compterait
--            la même panne deux fois — et le seuil de consolidation mentirait.
--
-- BORNE (règle 3) : une ligne par tâche, et pruneSouvenirsProposes,
-- référentielle, câblée dans server.ts après pruneTasks. Le souvenir RETENU,
-- lui, vit dans « memories » et survit à sa tâche (voir pruneTasks).
CREATE TABLE IF NOT EXISTS souvenirs_proposes (
  taskId    TEXT PRIMARY KEY,
  resultId  INTEGER NOT NULL,
  projectId TEXT NOT NULL,
  title     TEXT NOT NULL,
  content   TEXT NOT NULL DEFAULT '',
  issue     TEXT NOT NULL DEFAULT 'en_attente'
            CHECK (issue IN ('en_attente', 'retenu', 'rejete')),
  validePar TEXT CHECK (validePar IN ('evaluator', 'revue_humaine')),
  episode   TEXT CHECK (episode IN ('echec_worker', 'contre_revue', 'rejet_evaluator')),
  proposeA  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  taskId    TEXT PRIMARY KEY,
  state     TEXT NOT NULL CHECK (state IN ('approved', 'rejected')),
  updatedAt INTEGER NOT NULL
);

-- Timeline de code : chaque étape réussie (ou sauvegarde manuelle) garde son
-- patch. TABLE LATÉRALE (règle 2) — pas de migration sur results. Le patch est
-- COPIÉ ici pour survivre à pruneResults qui vide results.diff au-delà de 5 000.
CREATE TABLE IF NOT EXISTS sauvegardes (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  resultId  INTEGER,
  taskId    TEXT,
  label     TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('etape', 'manuel', 'avant_retouche')),
  patch     TEXT NOT NULL DEFAULT '',
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sauvegardes_projet ON sauvegardes(projectId, createdAt DESC);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName  TEXT NOT NULL,
  bio          TEXT DEFAULT '',
  avatarUrl    TEXT DEFAULT '',
  createdAt    INTEGER NOT NULL
);

-- Le role d'un compte. TABLE LATERALE, pas une colonne de plus sur « users »
-- (regle 2 : aucune migration). Une base deja en service ne verrait jamais
-- une colonne ajoutee apres coup a une table existante.
--
-- UNE INTENTION HUMAINE : le premier compte est admin, les suivants sont
-- membres, et seul un admin change un role. Rien ici ne naît d'un calcul.
--
-- BORNE STRUCTURELLE (regle 3), comme « budgets » : une ligne par compte. Pas
-- d'elagueur, et il ne faut jamais en ajouter — effacer la ligne du dernier
-- admin rendrait la ruche inadministrable, sans moyen de revenir en arriere.
CREATE TABLE IF NOT EXISTS user_roles (
  userId  TEXT PRIMARY KEY REFERENCES users(id),
  role    TEXT NOT NULL,
  poseA   INTEGER NOT NULL,
  posePar TEXT
);

CREATE TABLE IF NOT EXISTS project_members (
  projectId TEXT NOT NULL REFERENCES projects(id),
  userId    TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL DEFAULT 'member',
  joinedAt  INTEGER NOT NULL,
  PRIMARY KEY (projectId, userId)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(userId);

-- La machine derriere chaque noeud (windows/macos/linux/autre), DECLAREE par
-- lui a l'inscription. TABLE LATERALE, pas une colonne de plus sur « nodes »
-- (regle 2 : aucune migration) : une base deja en service la cree vide et la
-- remplit au fil des reconnexions.
--
-- BORNE STRUCTURELLE (regle 3), comme « user_roles » : une ligne par noeud,
-- jamais plus — la clef primaire EST la borne. Un noeud ancien qui ne declare
-- rien n'a pas de ligne, et l'ecran n'invente rien a sa place.
CREATE TABLE IF NOT EXISTS machines_noeuds (
  nodeId     TEXT PRIMARY KEY REFERENCES nodes(id),
  plateforme TEXT NOT NULL,
  majA       INTEGER NOT NULL
);

-- BORNE STRUCTURELLE (regle 3), jumelle de « machines_noeuds » : une ligne par
-- noeud, jamais plus — la clef primaire EST la borne, et la ré-inscription
-- ECRASE (ON CONFLICT). Les modeles declares par le noeud, ranges en JSON : ce
-- que l'Aiguillage lit pour choisir. Un noeud qui ne declare rien n'a pas de
-- ligne, et l'inscription qui ne les REDIT pas EFFACE la sienne : une
-- declaration retiree ne doit plus commander de modele.
CREATE TABLE IF NOT EXISTS modeles_noeuds (
  nodeId  TEXT PRIMARY KEY REFERENCES nodes(id),
  modeles TEXT NOT NULL,
  majA    INTEGER NOT NULL
);

-- BORNE STRUCTURELLE (regle 3), jumelle de « modeles_noeuds » et même règle :
-- une ligne par noeud, la re-inscription ECRASE, l'inscription qui ne les
-- REDIT pas EFFACE. Les EFFORTS que le noeud sait commander à son CLI (ceux que
-- son adaptateur documente, src/shared/effort.ts), rangés en JSON. Sans ligne,
-- l'Aiguillage ne lui commande AUCUN effort : un noeud d'avant cette version
-- ignorerait le champ, et son verdict serait rangé sous un effort jamais tourné.
CREATE TABLE IF NOT EXISTS efforts_noeuds (
  nodeId  TEXT PRIMARY KEY REFERENCES nodes(id),
  efforts TEXT NOT NULL,
  majA    INTEGER NOT NULL
);

-- BORNE STRUCTURELLE (regle 3), troisieme jumelle : une ligne par noeud, la
-- clef primaire EST la borne, la re-inscription ECRASE. Les OUTILS IA que le
-- noeud a CONSTATES sur sa machine (binaire sur le PATH, cle dans
-- l'environnement), ranges en JSON.
--
-- C'est un CONSTAT, pas une capacite : ce que la ruche sait FAIRE de chaque
-- outil vit dans le catalogue (src/shared/catalogue-outils.ts), et les deux ne
-- se croisent qu'a l'affichage. Un noeud qui ne declare rien n'a pas de ligne,
-- et l'ecran n'invente rien a sa place.
CREATE TABLE IF NOT EXISTS outils_noeuds (
  nodeId TEXT PRIMARY KEY REFERENCES nodes(id),
  outils TEXT NOT NULL,
  majA   INTEGER NOT NULL
);

-- BORNE STRUCTURELLE (regle 3), quatrieme jumelle : une ligne par noeud, la
-- clef primaire EST la borne. Le BAC A SABLE declare par le noeud a son
-- inscription (niveau aucun/processus/conteneur, et le moteur).
--
-- UNE DIFFERENCE VOULUE avec les trois tables au-dessus : une inscription qui
-- ne declare PAS d'isolement EFFACE la ligne. Garder l'ancien « conteneur »
-- d'un noeud redemarre autrement serait une affirmation de securite perimee ;
-- « non declare » est la seule reponse honnete. Affichage seulement — jamais
-- un critere d'assignation.
CREATE TABLE IF NOT EXISTS isolements_noeuds (
  nodeId      TEXT PRIMARY KEY REFERENCES nodes(id),
  niveau      TEXT NOT NULL,
  fournisseur TEXT,
  majA        INTEGER NOT NULL
);

-- Baptême Reine (ADR 0010) : le nom affiché d'une ouvrière. TABLE LATÉRALE —
-- on n'ALTÈRE pas « nodes.name » (règle 2). Le nœud ne pose PAS ce nom via le
-- protocole ; seule la Reine (API / CLI) écrit ici. UNIQUE insensible à la
-- casse : une collision est refusée avant l'INSERT (bapteme.ts), et l'index
-- double la garde.
CREATE TABLE IF NOT EXISTS baptemes (
  nodeId   TEXT PRIMARY KEY REFERENCES nodes(id),
  nom      TEXT NOT NULL,
  baptiseA INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_baptemes_nom ON baptemes(nom COLLATE NOCASE);

-- Métier de cycle (ADR 0010) : orthogonal à la caste. TABLE LATÉRALE, une
-- ligne par nœud. Assigné par la Reine / l'essaim — jamais déclaré par le
-- protocole. Absent ⇒ l'écran ne montre pas de métier inventé.
CREATE TABLE IF NOT EXISTS metiers_cycle (
  nodeId   TEXT PRIMARY KEY REFERENCES nodes(id),
  metier   TEXT NOT NULL,
  assigneA INTEGER NOT NULL
);

-- Présence Rayon (ADR 0010) : fichiers OUVERTS constatés (Read/Edit/Write).
-- TABLE LATÉRALE — une ligne par (nœud, toolUseId). Absent ⇒ l'écran ne
-- montre PAS de fichier ouvert inventé. Élagage : prunePresences (rétention)
-- + effacement à la fin de tâche.
CREATE TABLE IF NOT EXISTS presences_rayon (
  nodeId    TEXT NOT NULL REFERENCES nodes(id),
  toolUseId TEXT NOT NULL,
  chemin    TEXT NOT NULL,
  outil     TEXT NOT NULL,
  taskId    TEXT,
  constateA INTEGER NOT NULL,
  PRIMARY KEY (nodeId, toolUseId)
);
CREATE INDEX IF NOT EXISTS idx_presences_rayon_task ON presences_rayon(taskId);

-- Réquisitions (ADR 0010) : besoins émis pour l'humain. TABLE LATÉRALE.
-- Closées (accordée/refusée) → pruneRequisitions. Jamais de secret ici —
-- seulement le genre + libellé. Clés chez la Queen / Intendance.
CREATE TABLE IF NOT EXISTS requisitions (
  id      TEXT PRIMARY KEY,
  nodeId  TEXT NOT NULL REFERENCES nodes(id),
  genre   TEXT NOT NULL,
  libelle TEXT NOT NULL,
  detail  TEXT,
  taskId  TEXT,
  statut  TEXT NOT NULL,
  creeA   INTEGER NOT NULL,
  closA   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_requisitions_statut ON requisitions(statut);

-- Fabrique (ADR 0010 lot 8) : propositions d'outil dans le dépôt.
-- Chantier seulement après statut mergee + script déclaré.
CREATE TABLE IF NOT EXISTS fabriques (
  id         TEXT PRIMARY KEY,
  projectId  TEXT NOT NULL REFERENCES projects(id),
  nodeId     TEXT REFERENCES nodes(id),
  genre      TEXT NOT NULL,
  libelle    TEXT NOT NULL,
  nomScript  TEXT,
  taskId     TEXT,
  statut     TEXT NOT NULL,
  creeA      INTEGER NOT NULL,
  closA      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_fabriques_projet ON fabriques(projectId);

-- Horizon (ADR 0010 lot 9) : faits ≠ hypothèses. Borné + pruneHorizon.
CREATE TABLE IF NOT EXISTS horizon_ledger (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  kind      TEXT NOT NULL,
  texte     TEXT NOT NULL,
  source    TEXT NOT NULL,
  creeA     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_horizon_projet ON horizon_ledger(projectId, creeA DESC);

-- L'HORLOGE DU CHANTIER : le registre des annonces de durée.
--
-- POURQUOI LA CASTE EST ÉCRITE ICI, ET PAS RELUE PLUS TARD.
-- La caste est VIVE : elle se calcule à l'instant où on la demande, à partir de
-- l'expérience du nœud. Relire aujourd'hui la caste d'un nœud pour expliquer
-- une durée d'il y a trois semaines rendrait un historique faux — le même
-- mensonge que celui déjà consigné plus haut pour « exigeContreVisite ».
-- L'annonce fige donc la caste telle qu'elle était AU MOMENT DE L'ANNONCE.
--
-- POURQUOI CETTE TABLE EXISTE DU TOUT.
-- Sans elle, « calibrer » n'a rien à comparer : on saurait combien de temps les
-- tâches ont pris, jamais ce qu'on avait ANNONCÉ. Une horloge qui ne peut pas
-- se noter est une horloge qu'il faut croire sur parole.
CREATE TABLE IF NOT EXISTS annonces_duree (
  taskId  TEXT PRIMARY KEY REFERENCES tasks(id),
  nodeId  TEXT NOT NULL,
  caste   TEXT NOT NULL,
  socle   TEXT NOT NULL,
  n       INTEGER NOT NULL,
  p50Ms   INTEGER NOT NULL,
  p80Ms   INTEGER NOT NULL,
  faiteA  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annonces_faite ON annonces_duree(faiteA DESC);
-- Motifs perso (ADR 0010 lot 10) : procédures créées depuis la Chambre, par projet.
CREATE TABLE IF NOT EXISTS motifs_projet (
  id        TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  libelle   TEXT NOT NULL,
  etapes    TEXT NOT NULL,
  creeA     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_motifs_projet ON motifs_projet(projectId, creeA DESC);

-- Connecteurs externes (src/connectors) — AUTORISATION par projet. L'hôte
-- accorde un connecteur + un jeu de portées, et (Slack) des canaux et usagers
-- explicitement inscrits, à UN projet. Le SECRET du connecteur vit dans le
-- .env Queen, JAMAIS ici : cette table ne porte que la décision d'accès, pas
-- de quoi appeler l'extérieur. TABLE LATÉRALE — une ligne par (connecteur, projet).
-- ON DELETE CASCADE : un accord n'a aucun sens sans son projet, et sans la
-- cascade (foreign_keys = ON) supprimer un projet autorisé échouerait sur la
-- contrainte. Le JOURNAL, lui, n'a pas de clé étrangère (un appel refusé peut
-- ne nommer aucun projet) ; les deux tables sont dans EFFACEMENT_PROJET :
-- supprimer un projet n'est pas l'archiver, et l'aperçu caviardé d'un appel
-- cite encore le titre d'une de ses tâches. Seul « project_deleted » reste.
CREATE TABLE IF NOT EXISTS connecteurs_projet (
  connecteurId TEXT NOT NULL,
  projectId    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  portees      TEXT NOT NULL DEFAULT '[]',
  canaux       TEXT NOT NULL DEFAULT '[]',
  usagers      TEXT NOT NULL DEFAULT '[]',
  actif        INTEGER NOT NULL DEFAULT 1,
  creeA        INTEGER NOT NULL,
  majA         INTEGER NOT NULL,
  PRIMARY KEY (connecteurId, projectId)
);
CREATE INDEX IF NOT EXISTS idx_connecteurs_projet ON connecteurs_projet(projectId);

-- Journal APPEND-ONLY de chaque appel externe d'un connecteur : qui l'a
-- déclenché, quel acte, sous quelle portée, avec quel résultat, et une empreinte
-- SHA-256 de la charge CAVIARDÉE plus un aperçu caviardé. JAMAIS de secret,
-- JAMAIS la charge en clair. Répond à « qu'a fait ce connecteur, et quand ? »
-- sans jamais rejouer ce qu'il a envoyé. Élagué par le TEMPS, comme les events.
CREATE TABLE IF NOT EXISTS connecteurs_journal (
  id           TEXT PRIMARY KEY,
  connecteurId TEXT NOT NULL,
  projectId    TEXT,
  portee       TEXT NOT NULL,
  acte         TEXT NOT NULL,
  cible        TEXT,
  resultat     TEXT NOT NULL,
  qui          TEXT NOT NULL,
  apercu       TEXT NOT NULL DEFAULT '',
  chargeDigest TEXT NOT NULL DEFAULT '',
  creeA        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connecteurs_journal_projet ON connecteurs_journal(projectId, creeA DESC);
CREATE INDEX IF NOT EXISTS idx_connecteurs_journal_creeA ON connecteurs_journal(creeA);

-- ─── Les MISSIONS REJOUABLES (src/shared/mission-rejouable.ts) ─────────────
--
-- Trois tables NEUVES et LATÉRALES (règle 2 : aucune migration, aucune
-- colonne sur une table existante). Une base d'avant les gagne vides à
-- l'ouverture, et n'y perd rien.
--
-- missions : un épisode d'activité d'un projet, et ses DEUX instantanés
-- (JSON, format versionné). Le début est écrit à l'ouverture, en même temps
-- que la ligne ; la fin, une seule fois, à la clôture. Pas de REFERENCES vers
-- projects, à dessein : une clé étrangère ferait échouer la suppression d'un
-- projet qui a eu des missions — c'est l'élagueur qui retire les orphelines.
--
-- missions_taches : QUI est dans la mission, rangé à l'ouverture puis à
-- chaque relevé. L'appartenance ne se déduit PAS des dates : une tâche finie
-- qu'on ranime (relance de l'Evaluator, remise en file) a la naissance d'une
-- AUTRE mission — la borner par « née depuis l'ouverture » faisait avaler à
-- la mission suivante tout le plan de la précédente, et son rejeu le recréait.
--
-- rejeux : marque un projet comme le REJEU d'une mission. C'est cette marque
-- que relisent l'ordonnanceur (modèle et routage imposés) et toutes les
-- portes des actions irréversibles (simulées, jamais exécutées sans humain).
-- Le Genome FIGÉ y est recopié à la création (politique « figee ») : le
-- routage d'un rejeu en vol ne doit pas dépendre de la survie de l'instantané
-- source à l'élagage. missionRejeu : la PREMIÈRE mission du projet de
-- rejeu, rangée à son ouverture — c'est ELLE que la comparaison oppose à la
-- source, et l'élagueur l'épargne comme il épargne la source.
--
-- rejeux_actions : ce qu'un rejeu a demandé d'irréversible, et ce qui en a
-- été fait (simulée, ou validée par un humain). UNIQUE : une ruche autonome
-- qui redemande à chaque cycle la même livraison n'en range qu'une.
--
-- BORNE D'ÉLAGAGE (règle 3), dans le MÊME changement : pruneMissions — les
-- lignes dont le projet a disparu, puis les plus vieilles missions de chaque
-- projet au-delà d'un plafond (sauf celles qu'un rejeu compare encore), puis
-- les actions au-delà d'un plafond par projet.
CREATE TABLE IF NOT EXISTS missions (
  id              TEXT PRIMARY KEY,
  projectId       TEXT NOT NULL,
  ouverteA        INTEGER NOT NULL,
  closeA          INTEGER,
  depuisEvenement INTEGER NOT NULL,
  debut           TEXT NOT NULL,
  fin             TEXT
);
CREATE INDEX IF NOT EXISTS idx_missions_projet ON missions(projectId, ouverteA DESC);

CREATE TABLE IF NOT EXISTS rejeux (
  projectId     TEXT PRIMARY KEY,
  missionSource TEXT NOT NULL,
  projetSource  TEXT NOT NULL,
  surcharges    TEXT NOT NULL,
  genomeFige    TEXT,
  creePar       TEXT,
  creeA         INTEGER NOT NULL,
  missionRejeu  TEXT
);
CREATE INDEX IF NOT EXISTS idx_rejeux_source ON rejeux(missionSource);

CREATE TABLE IF NOT EXISTS rejeux_actions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId TEXT NOT NULL,
  genre     TEXT NOT NULL,
  cible     TEXT NOT NULL,
  issue     TEXT NOT NULL CHECK (issue IN ('simulee', 'validee')),
  parUserId TEXT,
  creeA     INTEGER NOT NULL,
  UNIQUE (projectId, genre, cible, issue)
);

CREATE TABLE IF NOT EXISTS missions_taches (
  missionId TEXT NOT NULL,
  taskId    TEXT NOT NULL,
  PRIMARY KEY (missionId, taskId)
);
CREATE INDEX IF NOT EXISTS idx_missions_taches_tache ON missions_taches(taskId);
`;

interface ProjectRow {
  id: string;
  name: string;
  repoUrl: string | null;
  description: string | null;
  visibility: 'public' | 'private';
  ownerId: string | null;
  createdAt: number;
}

interface NodeRow {
  id: string;
  name: string;
  ownerName: string;
  agentType: string;
  maxConcurrency: number;
  status: NodeStatus;
  lastSeen: number | null;
  running: number;
}

interface TaskRow {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  dependsOn: string;
  assignedNodeId: string | null;
  result: string | null;
  branch: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

interface DelegationRow {
  childTaskId: string;
  parentTaskId: string;
  rootTaskId: string;
  depth: number;
  origin: OrigineDelegation;
  durationMs: number;
  costMicros: number;
  resourceUnits: number;
  preferredAgent: string | null;
  preferredModel: string | null;
  createdAt: number;
}

interface ResultRow {
  id: number;
  taskId: string;
  nodeId: string;
  success: number;
  diff: string;
  logs: string;
  durationMs: number;
  subAgents: string;
}

/** Résultat réduit au strict nécessaire de la Balance (aucune colonne lourde). */
export interface ResultatBalance {
  id: number;
  taskId: string;
  nodeId: string;
  success: boolean;
  durationMs: number;
}

interface ResultatRow {
  id: number;
  taskId: string;
  nodeId: string;
  success: number;
  durationMs: number;
}

/**
 * Rattache à chaque ligne de `results` son texte final relu du journal, et
 * retire l'`id` qui n'a servi qu'à la jointure : la forme rendue aux lecteurs
 * ne change que d'un champ optionnel.
 */
function avecTexteFinal<T extends { id: number }>(
  lignes: readonly T[],
  textes: ReadonlyMap<number, string>,
): Array<Omit<T, 'id'> & { finalText?: string }> {
  return lignes.map(({ id, ...reste }) => {
    const finalText = textes.get(id);
    return finalText === undefined ? reste : { ...reste, finalText };
  });
}

function rowToResultatBalance(r: ResultatRow): ResultatBalance {
  return {
    id: r.id,
    taskId: r.taskId,
    nodeId: r.nodeId,
    success: r.success === 1,
    durationMs: r.durationMs,
  };
}

/**
 * Une mission telle qu'elle est RANGÉE : ses deux instantanés sont du JSON
 * brut, relu par `lireInstantane` (format versionné, lecture défensive).
 */
export interface MissionRangee {
  id: string;
  projectId: string;
  ouverteA: number;
  closeA: number | null;
  /** Dernier événement AVANT l'ouverture : le journal de la mission commence après. */
  depuisEvenement: number;
  debut: string;
  fin: string | null;
}

/** La marque de rejeu d'un projet. Les surcharges sont relues champ par champ. */
export interface RejeuRange {
  projectId: string;
  missionSource: string;
  projetSource: string;
  surcharges: { modele?: string; politiqueRoutage?: string; autonomie?: string };
  /** Le Genome de l'instantané source, recopié pour la politique `figee`. */
  genomeFige: AntecedentFige[] | null;
  creePar: string | null;
  creeA: number;
  /** La première mission du projet de rejeu — `null` tant qu'elle n'est pas ouverte. */
  missionRejeu: string | null;
}

export interface ActionRejeuRangee {
  genre: string;
  cible: string;
  issue: 'simulee' | 'validee';
  parUserId: string | null;
  creeA: number;
}

/**
 * Plafond de dépense posé par un humain sur un projet. Ligne de la table
 * `budgets`, rendue telle quelle : aucun calcul, aucune dérivation.
 */
export interface Budget {
  projectId: string;
  plafondMs: number;
  /** Version de la sémantique du plafond au moment de la pose (VERSION_BALANCE). */
  version: number;
  /** userId de l'opérateur — une TRACE, jamais une autorisation. */
  definiPar: string | null;
  updatedAt: number;
}

/**
 * Un billet tel qu'il est RANGÉ : `secretHash` est une empreinte, jamais le
 * secret. Le type le dit dans son nom pour qu'aucun appelant ne croie tenir de
 * quoi reconstruire une invitation — un billet perdu se remplace, il ne se
 * retrouve pas.
 */
export interface BilletRange {
  id: string;
  secretHash: string;
  label: string | null;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usesLeft: number;
  usesTotal: number;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

/** Idem pour la clé d'un nœud : `keyHash` est une empreinte. */
export interface CleNoeudRangee {
  nodeId: string;
  keyHash: string;
  label: string | null;
  ticketId: string | null;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

/**
 * Une livraison de la ruche sur le dépôt de l'utilisateur.
 *
 * `etat` : `en_cours` (réservation avant l'appel GitHub) · `ouverte` (PR en
 * attente) · `fusionnee` · `echouee` · `relayee` (une reprise livrée a fait
 * avancer la même PR : c'est SA ligne qui la porte désormais, cf.
 * `ETAT_LIVRAISON_RELAYEE`). Un état terminal reste VISIBLE avec son motif
 * plutôt que d'être effacé — une livraison qui disparaît sans laisser de
 * trace, c'est une ruche qui retentera la même chose demain.
 */
export interface LivraisonRangee {
  taskId: string;
  projectId: string;
  depot: string;
  pr: number;
  branche: string;
  etat: string;
  motif: string;
  version: number;
  creeA: number;
  majA: number;
}

/** État transitoire qui réserve une tâche pendant l'appel GitHub asynchrone. */
export const ETAT_LIVRAISON_EN_COURS = 'en_cours';

/**
 * État d'une livraison dont la pull request est désormais portée par une
 * reprise livrée sur la MÊME branche.
 *
 * Une PR = UNE ligne vivante. Sans ce passage, la ligne d'origine resterait
 * `ouverte` à côté de celle de la reprise : la fusion autonome la prendrait
 * pour une seconde PR à fusionner, et l'écran montrerait deux fois la même.
 * La ligne reste (règle des états terminaux) : elle dit qui a relayé.
 */
export const ETAT_LIVRAISON_RELAYEE = 'relayee';

/** La lignée d'une tâche de reprise (table `reprises_livraison`). */
export interface RepriseLivraison {
  taskId: string;
  origine: string;
  parent: string;
  projectId: string;
  depot: string;
  pr: number;
  branche: string;
  tete: string;
  creeA: number;
}

/** Une session de Conseil telle qu'elle est rangée. */
export interface SessionRangee {
  id: string;
  question: string;
  projectId: string | null;
  etat: 'exploration' | 'verification' | 'clos';
  tour: number;
  toursSecs: number;
  issue: string | null;
  motif: string | null;
  version: number;
  createdAt: number;
  closedAt: number | null;
}

/** Le lien entre une tâche d'ouvrière et son rôle dans le conseil. */
export interface TacheConseil {
  taskId: string;
  sessionId: string;
  role: 'exploration' | 'verification';
  lentille: string | null;
  propositionId: string | null;
  tour: number;
  depouille: number;
}

export interface PropositionRangee {
  id: string;
  sessionId: string;
  eclaireuse: string;
  famille: string;
  titre: string;
  corps: string;
  qualite: number;
  /** JSON : liste d'URLs. Jamais suivies par la ruche. */
  sources: string;
  tour: number;
  createdAt: number;
}

export interface AvisRange {
  id: number;
  sessionId: string;
  propositionId: string;
  eclaireuse: string;
  famille: string;
  type: 'soutien' | 'arret';
  force: number;
  raison: string;
  tour: number;
  createdAt: number;
}

interface EventRow {
  id: number;
  ts: number;
  type: string;
  payload: string;
}

interface MemoryRow {
  id: number;
  projectId: string;
  taskId: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface NewProject {
  name: string;
  repoUrl?: string | null;
  description?: string | null;
  visibility?: 'public' | 'private';
  ownerId?: string | null;
}

export interface NewTask {
  id?: string;
  projectId: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
}

export interface DelegationRangee extends PlanDelegation {
  origine: OrigineDelegation;
  createdAt: number;
}

export type CreationDeleguee =
  { ok: true; task: Task; delegation: DelegationRangee } | Exclude<VerdictDelegation, { ok: true }>;

export interface NodeProfile {
  nodeId?: string;
  name: string;
  ownerName: string;
  agentType: string;
  maxConcurrency: number;
  /** La machine déclarée par le nœud. Absente : on n'écrase pas ce qu'on sait. */
  plateforme?: PlateformeNoeud;
  /**
   * Les modèles déclarés à CETTE inscription. Absents : la ligne connue est
   * EFFACÉE — c'est le retrait d'une déclaration, jamais un oubli (le nœud les
   * redit à chaque inscription).
   */
  modeles?: string[];
  /** Les efforts déclarés à CETTE inscription. Absents : la ligne connue est EFFACÉE. */
  efforts?: Effort[];
  /**
   * Les outils IA CONSTATÉS sur la machine du nœud. Absents : on n'écrase pas
   * ce qu'on sait — un client d'avant cette version ne doit pas effacer les
   * constats qu'une version récente avait appris.
   */
  outils?: OutilConstate[];
  /**
   * Le bac à sable déclaré à CETTE inscription. Absent : la ligne connue est
   * EFFACÉE — une déclaration de sécurité ne survit pas à l'inscription qui ne
   * la répète pas.
   */
  isolement?: IsolementDeclare;
}

export interface TaskPatch {
  status?: TaskStatus;
  assignedNodeId?: string | null;
  result?: TaskResultSummary | null;
  branch?: string | null;
  attempts?: number;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: string;
  joinedAt: number;
  /** Jointure : displayName de l'utilisateur pour l'affichage. */
  displayName?: string;
}

/** Résultats allégés au maximum par passe : borne le coût d'un tick. */
const LOT_ALLEGEMENT = 2_000;

/**
 * Le corpus de l'Aiguillage, en SQL : les productions dont on connaît le
 * verdict de contre-visite (`cv`) et soit le modèle commandé (`am`), soit le
 * modèle exact prouvé par le DERNIER verdict de contre-revue (`ce`), les plus
 * récentes d'abord — avec le BRAS de chacune (VERSION_AIGUILLAGE 3 : harness,
 * effort, coût déclaré ; voir `observationsAiguillage` pour sa provenance).
 * UNE définition, deux lecteurs : `observationsAiguillage`
 * qui apprend, et la rétention du journal qui garde ce verdict tant que la
 * production compte (`faitsRanges`) — une copie de l'une dans l'autre finirait
 * par garder un autre ensemble que celui qu'on apprend.
 *
 * Le dernier verdict de chaque production est relu en UNE passe groupée
 * (`derniers`), pas par une sous-requête corrélée par production : mesuré sur
 * 1 500 productions et 3 000 verdicts, la forme corrélée coûtait ~130 ms à
 * chaque élection de modèle, et la rétention garde désormais les verdicts avec
 * leur production au lieu de les élaguer au bout de 5 000 événements.
 * `json_valid` d'abord : la rétention relit ce corpus à chaque passe, et un
 * seul payload illisible ne doit pas l'arrêter pour de bon — le journal
 * grandirait alors sans borne. `LIMIT ?` : la borne, `CORPUS_AIGUILLAGE`.
 */
const CORPUS_AIGUILLAGE_SQL = `
  WITH derniers AS (
    SELECT json_extract(payload, '$.taskId') AS taskId, MAX(id) AS id
      FROM events
     WHERE type = 'contre_expertise_verdict'
       AND json_valid(payload)
       AND json_extract(payload, '$.source') = 'hive_counter_review'
       AND json_extract(payload, '$.resultId') IS NOT NULL
     GROUP BY json_extract(payload, '$.taskId')
  )
  SELECT ce.id AS verdictId, t.title AS title, t.prompt AS prompt,
         COALESCE(am.modele, json_extract(ce.payload, '$.producteurModele')) AS modele,
         cv.suite AS suite,
         r.nodeId AS nodeId,
         json_extract(ce.payload, '$.producteurModele') AS modeleExact,
         CASE WHEN ce.id IS NULL THEN ab.harness
              ELSE COALESCE(json_extract(ce.payload, '$.producteurHarness'), n.agentType)
          END AS harness,
         CASE WHEN ce.id IS NULL THEN ab.effort
              ELSE json_extract(ce.payload, '$.producteurEffort')
          END AS effort,
         CASE WHEN ce.id IS NULL THEN ab.coutUsd
              ELSE json_extract(ce.payload, '$.producteurCoutUsd')
          END AS coutUsd
    FROM contre_visites cv
    LEFT JOIN aiguillage_modeles am ON am.taskId = cv.productionTaskId
    LEFT JOIN aiguillage_bras ab    ON ab.taskId = cv.productionTaskId
    JOIN tasks t                    ON t.id      = cv.productionTaskId
    LEFT JOIN derniers d            ON d.taskId  = cv.productionTaskId
    LEFT JOIN events ce             ON ce.id     = d.id
    LEFT JOIN results r ON r.id = CAST(json_extract(ce.payload, '$.resultId') AS INTEGER)
    LEFT JOIN nodes n   ON n.id = r.nodeId
   WHERE am.taskId IS NOT NULL
      OR json_extract(ce.payload, '$.producteurModele') IS NOT NULL
   ORDER BY cv.renduA DESC, cv.productionTaskId DESC
   LIMIT ?`;

/**
 * Relit les griefs d'une ligne de garde. Tolérant par conception : une ligne
 * illisible (version future, base éditée à la main) vaut « aucun grief connu »,
 * jamais une exception qui ferait tomber toute une page de lecture.
 */
function lireGriefs(brut: string): Grief[] {
  try {
    const lus: unknown = JSON.parse(brut);
    return Array.isArray(lus) ? (lus as Grief[]) : [];
  } catch {
    return [];
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    dependsOn: JSON.parse(row.dependsOn) as string[],
    result: row.result ? (JSON.parse(row.result) as TaskResultSummary) : null,
  };
}

function rowToDelegation(row: DelegationRow): DelegationRangee {
  return {
    childTaskId: row.childTaskId,
    parentTaskId: row.parentTaskId,
    rootTaskId: row.rootTaskId,
    depth: row.depth,
    title: '',
    prompt: '',
    durationMs: row.durationMs,
    costMicros: row.costMicros,
    resourceUnits: row.resourceUnits,
    ...(row.preferredAgent ? { preferredAgent: row.preferredAgent } : {}),
    ...(row.preferredModel ? { preferredModel: row.preferredModel } : {}),
    origine: row.origin,
    createdAt: row.createdAt,
  };
}

/** `running` est calculé à la volée depuis les tâches actives — jamais stocké. */
const NODE_SELECT = `
  SELECT n.*, m.plateforme AS plateforme, md.modeles AS modeles, ef.efforts AS efforts,
    o.outils AS outils,
    i.niveau AS isolementNiveau, i.fournisseur AS isolementFournisseur, (
    SELECT COUNT(*) FROM tasks t
    WHERE t.assignedNodeId = n.id AND t.status IN ('assigned', 'running')
  ) AS running
  FROM nodes n
  LEFT JOIN machines_noeuds m ON m.nodeId = n.id
  LEFT JOIN modeles_noeuds md ON md.nodeId = n.id
  LEFT JOIN efforts_noeuds ef ON ef.nodeId = n.id
  LEFT JOIN outils_noeuds o ON o.nodeId = n.id
  LEFT JOIN isolements_noeuds i ON i.nodeId = n.id
`;

/** La ligne brute d'un nœud telle que `NODE_SELECT` la rend, avant relecture. */
interface NodeRowBrut extends NodeRow {
  plateforme: PlateformeNoeud | null;
  modeles: string | null;
  efforts: string | null;
  outils: string | null;
  isolementNiveau: string | null;
  isolementFournisseur: string | null;
}

/**
 * Relit la liste de modèles JSON d'un nœud. Tolérant comme `lireGriefs` : une
 * ligne illisible (base éditée à la main, version future) vaut « aucun modèle
 * connu », jamais une exception qui ferait tomber une lecture de nœuds.
 */
function lireModeles(brut: string): string[] {
  try {
    const lus: unknown = JSON.parse(brut);
    return Array.isArray(lus) ? lus.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Une liste JSON de chaînes, robuste à la corruption : une base éditée à la
 * main, une valeur non-tableau ou un élément non-chaîne rendent une liste vide
 * (ou l'ignorent), jamais une exception ni un accès inventé. Sert aux
 * autorisations de connecteurs (portées, canaux, usagers).
 */
function listeDeChaines(brut: string): string[] {
  try {
    const lu: unknown = JSON.parse(brut);
    if (!Array.isArray(lu)) return [];
    return lu.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch {
    return [];
  }
}

/**
 * Relit les constats d'outils. Tolérante comme `lireModeles`, et EXIGEANTE sur
 * la forme : une entrée dont un champ manque ou ment est écartée, pas
 * réparée. Un constat à moitié lu vaudrait un constat inventé.
 *
 * Le tri-état de la clé est reconstruit ici plutôt que recopié : `presente`,
 * `absente`, `inconnue` — tout le reste vaut `inconnue`, parce que « on ne
 * sait pas lire » est la seule réponse honnête à une valeur qu'on ne connaît
 * pas, et jamais « pas de clé ».
 */
function lireOutils(brut: string): OutilConstate[] {
  try {
    const lus: unknown = JSON.parse(brut);
    if (!Array.isArray(lus)) return [];
    const gardes: OutilConstate[] = [];
    for (const x of lus) {
      if (typeof x !== 'object' || x === null) continue;
      const o = x as Record<string, unknown>;
      if (typeof o.agent !== 'string' || o.agent.length === 0) continue;
      if (typeof o.binaire !== 'boolean') continue;
      const cle =
        o.cle === 'presente' || o.cle === 'absente' ? (o.cle as OutilConstate['cle']) : 'inconnue';
      gardes.push({ agent: o.agent, binaire: o.binaire, cle });
    }
    return gardes;
  } catch {
    return [];
  }
}

/** Un coût déclaré relu : fini et positif, sinon « non déclaré » — jamais 0. */
function coutLisible(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * De la ligne brute au `HiveNode` : replier les colonnes JSON (`modeles`,
 * `outils`) en tableaux. `plateforme` et `running` passent tels quels. Une
 * liste vide (ou absente) laisse le champ ABSENT — un nœud sans modèle déclaré
 * n'a pas de `modeles: []` inventé, et un nœud sans constat pas d'`outils: []`.
 */
function rowToNode(row: NodeRowBrut): HiveNode {
  const { modeles, efforts, outils, isolementNiveau, isolementFournisseur, ...reste } = row;
  const node = reste as unknown as HiveNode;
  // Un niveau illisible (base éditée à la main) vaut « non déclaré ».
  const niveau = NIVEAUX_ISOLEMENT.find((n) => n === isolementNiveau);
  if (niveau !== undefined) {
    node.isolement = {
      niveau,
      ...(typeof isolementFournisseur === 'string' && isolementFournisseur.length > 0
        ? { fournisseur: isolementFournisseur }
        : {}),
    };
  }
  const liste = typeof modeles === 'string' ? lireModeles(modeles) : [];
  if (liste.length > 0) node.modeles = liste;
  // Tolérante comme `lireModeles`, et plus stricte sur le fond : un niveau que
  // Hive ne connaît pas est écarté, jamais commandé.
  const niveaux = typeof efforts === 'string' ? lireModeles(efforts).filter(estEffort) : [];
  if (niveaux.length > 0) node.efforts = niveaux;
  const constats = typeof outils === 'string' ? lireOutils(outils) : [];
  if (constats.length > 0) node.outils = constats;
  return node;
}

// ─── CE QU'UN PROJET POSSÈDE, TABLE PAR TABLE ────────────────────────────────
//
// La liste de ce que `effacerProjet` retire, DANS L'ORDRE où il le retire.
// L'ordre n'est pas cosmétique, il a deux raisons :
//
//   · `foreign_keys = ON` (voir le constructeur) : `annonces_duree` référence
//     `tasks`, et `tasks`, `essaim`, `garde_fous`, `abonnements`, `fabriques`,
//     `horizon_ledger`, `motifs_projet` référencent `projects`. Effacer le
//     parent d'abord ferait échouer TOUTE la transaction.
//   · les sous-requêtes relisent `tasks` et `conseil_sessions` : ce qui s'y
//     rattache part AVANT elles, sinon plus rien ne dirait à qui c'était.
//
// Le JOURNAL passe en premier, pour la même raison : un événement ne connaît sa
// tâche que par un identifiant, et cet identifiant ne désigne plus rien une fois
// `tasks` vidée. Il part s'il nomme le projet, une de ses tâches (sous toutes
// les clés qui portent un identifiant de tâche — un fait de délégation n'a pas
// de `taskId`, il a `childTaskId`), une de ses séances de Conseil, ou une
// réquisition ouverte pendant une de ses tâches. On n'efface PAS sur un texte
// qui « ressemble » : un identifiant de tâche peut être court (`socle`, `tests`)
// et un motif ou une catégorie porter le même mot — seules les clés qui
// DÉSIGNENT une tâche comptent.
//
// `budgets` n'est pas ici : son unique `DELETE` est celui de `setBudget`, que
// `effacerProjet` appelle (verrou de tests/security-invariants.test.ts — aucune
// autre suppression sur cette table, nulle part).
//
// ⚠ UNE TABLE NOUVELLE QUI PORTE `projectId`, un identifiant de tâche, de
// séance ou de résultat DOIT entrer ici : tests/suppression-projet.test.ts
// relit le schéma et rougit tant qu'elle n'y est pas — sinon, supprimer un
// projet laisserait ses lignes derrière lui, pour toujours.
const TACHES_DU_PROJET = 'SELECT id FROM tasks WHERE projectId = @p';

/**
 * Combien de faits d'audit `project_deleted` la rétention du journal épargne —
 * les plus récents (`faitsRanges`). Compté dans l'inégalité du plafond
 * (tests/retention-journal.test.ts) comme les autres faits rangés.
 */
export const AUDITS_SUPPRESSION_CONSERVES = 1_000;
const SEANCES_DU_PROJET = 'SELECT id FROM conseil_sessions WHERE projectId = @p';
const CLES_DE_TACHE = [
  'taskId',
  'parentTaskId',
  'childTaskId',
  'rootTaskId',
  'productionTaskId',
  'relectureTaskId',
  'ancestorTaskId',
]
  .map((cle) => `'${cle}'`)
  .join(', ');
// Le journal peut porter une charge utile illisible (base ancienne, ligne
// écrite à la main) : `json_extract` / `json_each` LÈVENT sur elle, et une seule
// ligne abîmée ferait échouer toute suppression de projet. Relue gardée, comme
// l'index `idx_events_tache` et la rétention (`TACHE_DE_L_EVENEMENT`) : elle ne
// nomme rien, donc elle reste.
const CHARGE_LISIBLE = `(CASE WHEN json_valid(events.payload) THEN events.payload ELSE '{}' END)`;
const JOURNAL_DU_PROJET = `json_extract(${CHARGE_LISIBLE}, '$.projectId') = @p
      OR json_extract(${CHARGE_LISIBLE}, '$.sessionId') IN (${SEANCES_DU_PROJET})
      OR EXISTS (
        SELECT 1 FROM json_each(${CHARGE_LISIBLE}) j
         WHERE j.key IN (${CLES_DE_TACHE}) AND j.value IN (${TACHES_DU_PROJET})
      )
      OR (
        type IN ('requisition_ouverte', 'requisition_reponse')
        AND json_extract(${CHARGE_LISIBLE}, '$.id') IN (
          SELECT id FROM requisitions WHERE taskId IN (${TACHES_DU_PROJET})
        )
      )`;
const EFFACEMENT_PROJET = [
  ['events', JOURNAL_DU_PROJET],
  ['requisitions', `taskId IN (${TACHES_DU_PROJET})`],
  ['presences_rayon', `taskId IN (${TACHES_DU_PROJET})`],
  ['conseil_avis', `sessionId IN (${SEANCES_DU_PROJET})`],
  ['conseil_propositions', `sessionId IN (${SEANCES_DU_PROJET})`],
  ['conseil_taches', `sessionId IN (${SEANCES_DU_PROJET}) OR taskId IN (${TACHES_DU_PROJET})`],
  ['conseil_plans', `projectId = @p OR sessionId IN (${SEANCES_DU_PROJET})`],
  ['conseil_sessions', 'projectId = @p'],
  ['gardiennes', `taskId IN (${TACHES_DU_PROJET})`],
  ['sauvegardes', `projectId = @p OR taskId IN (${TACHES_DU_PROJET})`],
  ['memories', `projectId = @p OR taskId IN (${TACHES_DU_PROJET})`],
  ['souvenirs_proposes', `projectId = @p OR taskId IN (${TACHES_DU_PROJET})`],
  ['consignes_routage', `taskId IN (${TACHES_DU_PROJET})`],
  ['depenses_delegation', `taskId IN (${TACHES_DU_PROJET}) OR rootTaskId IN (${TACHES_DU_PROJET})`],
  ['results', `taskId IN (${TACHES_DU_PROJET})`],
  ['reviews', `taskId IN (${TACHES_DU_PROJET})`],
  [
    'task_delegations',
    `childTaskId IN (${TACHES_DU_PROJET}) OR parentTaskId IN (${TACHES_DU_PROJET})
      OR rootTaskId IN (${TACHES_DU_PROJET})`,
  ],
  [
    'contre_expertises',
    `relectureTaskId IN (${TACHES_DU_PROJET}) OR productionTaskId IN (${TACHES_DU_PROJET})`,
  ],
  ['contre_visites', `productionTaskId IN (${TACHES_DU_PROJET})`],
  ['aiguillage_modeles', `taskId IN (${TACHES_DU_PROJET})`],
  ['aiguillage_bras', `taskId IN (${TACHES_DU_PROJET})`],
  ['garde_fou_echelons', `taskId IN (${TACHES_DU_PROJET})`],
  ['garde_fou_exigences', `productionTaskId IN (${TACHES_DU_PROJET})`],
  ['annonces_duree', `taskId IN (${TACHES_DU_PROJET})`],
  ['taches_issue', `projectId = @p OR taskId IN (${TACHES_DU_PROJET})`],
  ['livraisons', `projectId = @p OR taskId IN (${TACHES_DU_PROJET})`],
  ['reprises_livraison', `projectId = @p OR taskId IN (${TACHES_DU_PROJET})`],
  // Les missions rejouables (#512) : l'appartenance d'abord (elle relit
  // `missions`), puis les instantanés — plan, prompts, titres —, même quand un
  // rejeu d'un AUTRE projet les compare encore : supprimer n'est pas archiver,
  // et sa comparaison dira sa source absente. La marque `rejeux` d'un projet
  // de rejeu ne part qu'avec LUI : l'ôter parce que sa source a disparu
  // rendrait ses actions irréversibles exécutables sans humain.
  [
    'missions_taches',
    `missionId IN (SELECT id FROM missions WHERE projectId = @p) OR taskId IN (${TACHES_DU_PROJET})`,
  ],
  ['missions', 'projectId = @p'],
  ['rejeux', 'projectId = @p'],
  ['rejeux_actions', 'projectId = @p'],
  ['taches_ombre', `projectId = @p OR tacheOmbre IN (${TACHES_DU_PROJET})`],
  ['banc_ombre', 'projectId = @p'],
  ['horloge_hote', `projectId = @p OR taskId IN (${TACHES_DU_PROJET})`],
  ['fabriques', 'projectId = @p'],
  ['tasks', 'projectId = @p'],
  ['horizon_ledger', 'projectId = @p'],
  ['motifs_projet', 'projectId = @p'],
  ['partages', 'projectId = @p'],
  ['project_members', 'projectId = @p'],
  ['essaim', 'projectId = @p'],
  ['garde_fous', 'projectId = @p'],
  ['abonnements', 'projectId = @p'],
  ['connecteurs_projet', 'projectId = @p'],
  ['connecteurs_journal', 'projectId = @p'],
  ['serveurs', 'projectId = @p'],
  ['horloge_soldes', 'projectId = @p'],
  ['balance_ledger_cache', 'projectId = @p'],
] as const;

/** Une table dont `effacerProjet` retire les lignes d'un projet. */
export type TableDUnProjet = (typeof EFFACEMENT_PROJET)[number][0] | 'budgets' | 'projects';

/**
 * Ce qu'effacer un projet a retiré, TABLE PAR TABLE — une entrée par table
 * visitée, zéro compris : un bilan qui omettrait les tables vides ne dirait pas
 * si elles ont été vues.
 */
export type BilanEffacement = Readonly<Record<TableDUnProjet, number>>;

export class HiveStore {
  private readonly db: Database.Database;
  /**
   * Filigrane d'élagage des résultats : id du dernier résultat déjà allégé.
   * En mémoire seulement — un redémarrage refait une passe complète (idempotente).
   */
  private dernierResultatAllege = 0;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new Database(dbPath);
    // ─── LES QUATRE RÉGLAGES DE LA BASE, DITS ICI ET NON HÉRITÉS ─────────────
    //
    // Seul `journal_mode` était posé. Les trois autres valaient ce que le BUILD
    // de better-sqlite3 décidait (`deps/defines.gypi`, `lib/database.js`) :
    // une montée de version qui changerait un défaut aurait désarmé une garde
    // sans qu'une ligne de Hive bouge.
    //
    //   • `synchronous = FULL` — la durabilité d'abord, décision du
    //     propriétaire : un COMMIT rendu est sur le disque, même si la machine
    //     s'éteint l'instant d'après (un résultat, une livraison, une
    //     approbation). Ce n'était PAS le réglage en marche : le build pose
    //     `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`, et la base tombait en NORMAL dès
    //     sa première écriture en WAL, puis à chaque réouverture (mesuré ; cf.
    //     docs/ERREURS.md § 9 novemoctogicenties). En NORMAL, une coupure de
    //     courant pouvait emporter les dernières transactions validées.
    //     Le prix est un fsync du WAL par COMMIT — mesuré sur disque réel :
    //     0,02 ms en NORMAL, 6 ms en FULL. D'où le schéma ci-dessous, posé en
    //     UNE transaction.
    //   • `foreign_keys = ON` — les `REFERENCES` du schéma sont appliquées.
    //     SQLite nu les ignore ; seul le défaut de compilation les armait.
    //   • `busy_timeout = 5000` — un écrivain concurrent fait ATTENDRE jusqu'à
    //     5 s au lieu d'échouer aussitôt en `SQLITE_BUSY` (sauvegarde en cours,
    //     `sqlite3` ouvert à la main).
    //
    // Posés avant le schéma, et relus par tests/sqlite-concurrent.test.ts APRÈS
    // une écriture et une réouverture — là où le défaut WAL avait trompé la
    // lecture d'un audit.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    // UNE transaction pour tout le schéma. En autocommit, chacun de ses
    // quatre-vingts `CREATE … IF NOT EXISTS` validait seul : sous FULL, autant
    // de fsync, et une base neuve coûtait 525 ms au lieu de 70 (mesuré sur
    // disque réel) — à chaque démarrage d'une Reine neuve, à chaque banc qui
    // en ouvre une. Tout-ou-rien, en prime : un démarrage interrompu ne laisse
    // plus un schéma à moitié posé.
    this.db.transaction(() => {
      this.db.exec(SCHEMA);
      this.amorcerRegistreElagages(Date.now());
    })();
  }

  /**
   * Pose, une seule fois, ce que le registre des élagages ne peut pas savoir :
   * combien d'événements une base avait DÉJÀ perdus quand il est apparu.
   *
   * `events.id` est AUTOINCREMENT — `sqlite_sequence` garde le plus grand id
   * jamais attribué et les ids ne sont jamais réutilisés : attribués moins
   * restants, c'est exactement ce que l'ancienne rétention a supprimé, types
   * inconnus. Posé sous le motif `avant_registre`, daté de cette ouverture :
   * une tâche créée APRÈS n'a rien pu perdre à l'ancienne rétention, une tâche
   * créée avant, si (`faitsElagues`). Idempotent — un registre déjà tenu,
   * même vide de ce motif, n'est jamais réamorcé ; une base neuve n'a rien
   * perdu et n'en reçoit pas.
   */
  private amorcerRegistreElagages(now: number): void {
    this.db
      .prepare(
        `INSERT INTO journal_elagages (type, motif, supprimes, dernierA)
         SELECT '*', 'avant_registre', perdus, ?
           FROM (SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'events'), 0)
                        - (SELECT COUNT(*) FROM events) AS perdus)
          WHERE perdus > 0 AND NOT EXISTS (SELECT 1 FROM journal_elagages)`,
      )
      .run(now);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Exécute `ecrire` en UNE transaction : tout est écrit, ou rien.
   *
   * IMMEDIATE, pas DEFERRED : le verrou d'écriture est pris au BEGIN, avant la
   * première écriture. Si un autre processus tient la base, l'attente (5 s) et
   * l'éventuel SQLITE_BUSY tombent là, quand rien n'est encore écrit — jamais
   * ENTRE deux écritures, où ils laisseraient un état à moitié rangé. `ecrire`
   * reste synchrone (better-sqlite3 refuse une promesse) ; imbriquée, la
   * transaction devient un SAVEPOINT.
   */
  enTransaction<T>(ecrire: () => T): T {
    return this.db.transaction(ecrire).immediate();
  }

  // ─── Utilisateurs ───────────────────────────────────────────────────────────
  createUser(input: NewUser): User {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO users (id, email, passwordHash, displayName, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.email, input.passwordHash, input.displayName, now);
    return {
      id,
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      bio: '',
      avatarUrl: '',
      createdAt: now,
    };
  }

  getUserById(id: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  }

  getUserByEmail(email: string): User | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;
  }

  updateUserProfile(
    id: string,
    patch: { displayName?: string; bio?: string; avatarUrl?: string },
  ): User | undefined {
    const user = this.getUserById(id);
    if (!user) return undefined;
    const next = { ...user, ...patch };
    this.db
      .prepare('UPDATE users SET displayName = ?, bio = ?, avatarUrl = ? WHERE id = ?')
      .run(next.displayName, next.bio, next.avatarUrl, id);
    return next;
  }

  // ─── Projets ───────────────────────────────────────────────────────────────
  createProject(input: NewProject): Project {
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      repoUrl: input.repoUrl ?? null,
      description: input.description ?? null,
      visibility: input.visibility ?? 'private',
      ownerId: input.ownerId ?? null,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO projects (id, name, repoUrl, description, visibility, ownerId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        project.id,
        project.name,
        project.repoUrl,
        project.description,
        project.visibility,
        project.ownerId,
        project.createdAt,
      );
    return project;
  }

  getProject(id: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  }

  listProjects(): Project[] {
    return this.db.prepare('SELECT * FROM projects ORDER BY createdAt').all() as ProjectRow[];
  }

  findProjectByName(name: string): Project | undefined {
    return this.db
      .prepare('SELECT * FROM projects WHERE name = ? ORDER BY createdAt DESC')
      .get(name) as ProjectRow | undefined;
  }

  /** Projets publics, triés du plus récent au plus ancien. */
  listPublicProjects(): Project[] {
    return this.db
      .prepare("SELECT * FROM projects WHERE visibility = 'public' ORDER BY createdAt DESC")
      .all() as ProjectRow[];
  }

  /**
   * Donne un propriétaire à un projet qui n'en a pas.
   *
   * `WHERE ownerId IS NULL` fait partie de la garde, et pas seulement du
   * confort : la condition est dans la MÊME instruction que l'écriture, donc
   * deux adoptions simultanées ne peuvent pas toutes les deux réussir. Vérifier
   * avant puis écrire laisserait entre les deux une fenêtre où le second écrase
   * le premier — et le second serait alors propriétaire d'un projet qui venait
   * d'être adopté.
   *
   * Rend `true` si l'adoption a eu lieu.
   */
  adopterProjet(projectId: string, userId: string): boolean {
    const info = this.db
      .prepare('UPDATE projects SET ownerId = ? WHERE id = ? AND ownerId IS NULL')
      .run(userId, projectId);
    return info.changes > 0;
  }

  // ─── Membres des projets ────────────────────────────────────────────────────
  addMember(projectId: string, userId: string, role = 'member'): ProjectMember {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT OR IGNORE INTO project_members (projectId, userId, role, joinedAt) VALUES (?, ?, ?, ?)',
      )
      .run(projectId, userId, role, now);
    return { projectId, userId, role, joinedAt: now };
  }

  /**
   * Cette personne est-elle membre de ce projet ?
   *
   * Une question fermée plutôt qu'un `listMembers().some(…)` : la liste
   * complète nomme d'autres gens, et on ne la charge pas pour répondre à une
   * question qui ne concerne qu'un seul compte. La clé primaire du couple
   * (projectId, userId) rend la réponse immédiate.
   */
  estMembre(projectId: string, userId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM project_members WHERE projectId = ? AND userId = ? LIMIT 1')
      .get(projectId, userId);
    return row !== undefined;
  }

  /**
   * Retire un membre d'un projet. Rend `true` si quelqu'un a bien été retiré.
   *
   * Ne touche PAS à `ownerId` : retirer le propriétaire de la liste des membres
   * ne le déposséderait pas, ça rendrait seulement l'état incohérent. Le refus
   * se pose plus haut, là où l'on sait qui est propriétaire.
   */
  removeMember(projectId: string, userId: string): boolean {
    const info = this.db
      .prepare('DELETE FROM project_members WHERE projectId = ? AND userId = ?')
      .run(projectId, userId);
    return info.changes > 0;
  }

  listMembers(projectId: string): ProjectMember[] {
    const rows = this.db
      .prepare(
        `SELECT pm.*, u.displayName
         FROM project_members pm
         JOIN users u ON pm.userId = u.id
         WHERE pm.projectId = ?
         ORDER BY pm.joinedAt`,
      )
      .all(projectId) as (ProjectMember & { displayName: string })[];
    return rows;
  }

  listUserProjects(userId: string): (ProjectMember & { projectName: string })[] {
    return this.db
      .prepare(
        `SELECT pm.*, p.name as projectName
         FROM project_members pm
         JOIN projects p ON pm.projectId = p.id
         WHERE pm.userId = ?
         ORDER BY pm.joinedAt DESC`,
      )
      .all(userId) as (ProjectMember & { projectName: string })[];
  }

  // ─── Supprimer un projet ───────────────────────────────────────────────────
  /**
   * Efface un projet ET tout ce qu'il possède, en UNE transaction : tout part,
   * ou rien. Rend le bilan table par table, ou `null` si le projet n'existe pas
   * (rien n'est alors touché).
   *
   * ─── SUPPRIMER, PAS ARCHIVER — DÉCISION DU PROPRIÉTAIRE ─────────────────────
   *
   * Un projet supprimé n'existe plus nulle part dans la base : ni ses tâches,
   * ni leurs résultats, ni son journal, ni ce que la ruche en avait appris
   * (mémoires du Hive Mind, observations de l'Aiguillage, verdicts). Seul
   * survit l'événement d'audit `project_deleted`, posé par l'appelant APRÈS
   * cette cascade, dans la même transaction (`Scheduler.supprimerProjet`).
   *
   * ─── CE QU'ELLE NE FAIT PAS, ET QUI LE FAIT ──────────────────────────────────
   *
   * Elle ne juge pas si la suppression est PERMISE (la garde de la route), ni
   * si du travail tourne encore (le planificateur annule d'abord ce qui est en
   * vol ; la route refuse ce qui ne s'annule pas). Elle ne touche pas au disque
   * (le miroir du Rayon, `Miroir.effacer`) ni aux machines des ouvrières.
   *
   * ─── CE QU'ELLE NE PEUT PAS ATTEINDRE ────────────────────────────────────────
   *
   * Une ligne qui ne dit plus à quel projet elle appartient. `pruneTasks`
   * efface des tâches sans effacer leurs `results` (allégés, gardés) : ceux-là
   * ne portent qu'un `taskId` qui ne désigne plus rien, et aucune jointure ne
   * les rattache à un projet. Ils étaient déjà orphelins avant la suppression.
   */
  effacerProjet(projectId: string, now = Date.now()): BilanEffacement | null {
    return this.enTransaction(() => {
      if (!this.getProject(projectId)) return null;
      // Le registre de la rétention (`journal_elagages`) doit EXPLIQUER ces
      // retraits : sinon `faitsElagues` les compte « inexpliqués » et le
      // registre Genome se dit tronqué pour toute la vie de la base, après une
      // seule suppression. Une preuve d'une tâche du projet est orpheline (sa
      // tâche part dans la même transaction), le reste une trace — deux motifs
      // qui ne touchent aucune tâche encore connue. Compté AVANT le DELETE.
      const partis = this.db
        .prepare(
          `SELECT type, ${TACHE_DE_L_EVENEMENT} IS NOT NULL AS deTache, COUNT(*) AS n
             FROM events WHERE ${JOURNAL_DU_PROJET} GROUP BY type, deTache`,
        )
        .all({ p: projectId }) as Array<{ type: string; deTache: number; n: number }>;
      this.consignerElagages(
        partis.map(({ type, deTache, n }) => ({
          type,
          motif: deTache === 1 && estPreuve(type) ? 'orpheline' : 'trace',
          n,
        })),
        now,
      );
      const bilan = {} as Record<TableDUnProjet, number>;
      for (const [table, ou] of EFFACEMENT_PROJET) {
        bilan[table] = this.db
          .prepare(`DELETE FROM ${table} WHERE ${ou}`)
          .run({ p: projectId }).changes;
      }
      // Le plafond part par SON chemin (`setBudget(…, null)`), le seul DELETE
      // de `budgets` du dépôt ; le cache de la porte est invalidé par le
      // planificateur, dans le même geste.
      bilan.budgets = this.getBudget(projectId) ? 1 : 0;
      this.setBudget(projectId, null);
      bilan.projects = this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId).changes;
      return bilan;
    });
  }

  // ─── Nœuds ─────────────────────────────────────────────────────────────────
  /** Enregistre (ou ré-enregistre) un nœud et le passe online. */
  registerNode(profile: NodeProfile, now = Date.now()): HiveNode {
    const existing = profile.nodeId ? this.getNode(profile.nodeId) : undefined;
    const id = existing?.id ?? profile.nodeId ?? randomUUID();
    if (existing) {
      this.db
        .prepare(
          'UPDATE nodes SET name = ?, ownerName = ?, agentType = ?, maxConcurrency = ?, status = ?, lastSeen = ? WHERE id = ?',
        )
        .run(
          profile.name,
          profile.ownerName,
          profile.agentType,
          profile.maxConcurrency,
          'online',
          now,
          id,
        );
    } else {
      this.db
        .prepare(
          'INSERT INTO nodes (id, name, ownerName, agentType, maxConcurrency, status, lastSeen) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          profile.name,
          profile.ownerName,
          profile.agentType,
          profile.maxConcurrency,
          'online',
          now,
        );
    }
    // La machine déclarée se range à part (table latérale). ABSENTE, on ne
    // touche à rien : un client d'une version antérieure qui se reconnecte ne
    // doit pas effacer ce qu'une version récente avait appris.
    if (profile.plateforme !== undefined) {
      this.db
        .prepare(
          'INSERT INTO machines_noeuds (nodeId, plateforme, majA) VALUES (?, ?, ?) ' +
            'ON CONFLICT(nodeId) DO UPDATE SET plateforme = excluded.plateforme, majA = excluded.majA',
        )
        .run(id, profile.plateforme, now);
    }
    // Les modèles déclarés, rangés à part (table latérale) : présents, on ÉCRASE
    // la liste d'avant (la dernière déclaration gagne) ; ABSENTS, on EFFACE —
    // la règle du bac à sable, pas celle de la plateforme. Le nœud les redit à
    // CHAQUE inscription (`client.ts`), donc leur absence est un retrait :
    // l'opérateur a ôté `HIVE_MODELES`. Garder l'ancienne liste ferait commander
    // `--model` à un nœud qui ne l'offre plus — un modèle que son compte ne
    // peut peut-être plus appeler, élu en boucle sans verdict pour l'écarter.
    if (profile.modeles !== undefined) {
      this.db
        .prepare(
          'INSERT INTO modeles_noeuds (nodeId, modeles, majA) VALUES (?, ?, ?) ' +
            'ON CONFLICT(nodeId) DO UPDATE SET modeles = excluded.modeles, majA = excluded.majA',
        )
        .run(id, JSON.stringify(profile.modeles), now);
    } else {
      this.db.prepare('DELETE FROM modeles_noeuds WHERE nodeId = ?').run(id);
    }
    // Les efforts : même règle que les modèles, pour la même raison — un effort
    // qui n'est plus redit ne doit plus être commandé.
    if (profile.efforts !== undefined) {
      this.db
        .prepare(
          'INSERT INTO efforts_noeuds (nodeId, efforts, majA) VALUES (?, ?, ?) ' +
            'ON CONFLICT(nodeId) DO UPDATE SET efforts = excluded.efforts, majA = excluded.majA',
        )
        .run(id, JSON.stringify(profile.efforts), now);
    } else {
      this.db.prepare('DELETE FROM efforts_noeuds WHERE nodeId = ?').run(id);
    }
    // Les constats d'outils suivent la règle de la PLATEFORME, pas celle des
    // modèles ni du bac : ABSENTS, on ne touche à rien ; présents, la dernière
    // inscription gagne.
    // Un nœud qui a désinstallé Cursor le dit en le rangeant `binaire: false`
    // — il n'omet pas la ligne, sans quoi le hub garderait l'ancien constat.
    if (profile.outils !== undefined) {
      this.db
        .prepare(
          'INSERT INTO outils_noeuds (nodeId, outils, majA) VALUES (?, ?, ?) ' +
            'ON CONFLICT(nodeId) DO UPDATE SET outils = excluded.outils, majA = excluded.majA',
        )
        .run(id, JSON.stringify(profile.outils), now);
    }
    // Le bac à sable : présent, la dernière inscription gagne ; ABSENT, la
    // ligne est effacée (cf. le schéma : une affirmation de sécurité ne
    // survit pas à l'inscription qui ne la répète pas).
    if (profile.isolement !== undefined) {
      this.db
        .prepare(
          'INSERT INTO isolements_noeuds (nodeId, niveau, fournisseur, majA) VALUES (?, ?, ?, ?) ' +
            'ON CONFLICT(nodeId) DO UPDATE SET niveau = excluded.niveau, ' +
            'fournisseur = excluded.fournisseur, majA = excluded.majA',
        )
        .run(id, profile.isolement.niveau, profile.isolement.fournisseur ?? null, now);
    } else {
      this.db.prepare('DELETE FROM isolements_noeuds WHERE nodeId = ?').run(id);
    }
    return this.getNode(id) as HiveNode;
  }

  getNode(id: string): HiveNode | undefined {
    const row = this.db.prepare(`${NODE_SELECT} WHERE n.id = ?`).get(id) as NodeRowBrut | undefined;
    return row ? rowToNode(row) : undefined;
  }

  listNodes(): HiveNode[] {
    return (this.db.prepare(`${NODE_SELECT} ORDER BY n.name`).all() as NodeRowBrut[]).map(
      rowToNode,
    );
  }

  // ─── Baptêmes (ADR 0010) ───────────────────────────────────────────────────
  //
  // Identité affichée POSÉE PAR LA REINE. Absent ⇒ l'écran ne montre pas de
  // prénom inventé (règle d'or Chambre). `nodes.name` reste le libellé
  // technique d'inscription ; il n'est plus la source d'identité humaine.

  /** Le baptême d'un nœud, ou `null` s'il n'en a pas (jamais inventé). */
  lireBapteme(nodeId: string): { nom: string; baptiseA: number } | null {
    const row = this.db
      .prepare('SELECT nom, baptiseA FROM baptemes WHERE nodeId = ?')
      .get(nodeId) as { nom: string; baptiseA: number } | undefined;
    return row ?? null;
  }

  /** Tous les baptêmes — pour lister les collisions et l'API Chambre. */
  listerBaptemes(): { nodeId: string; nom: string; baptiseA: number }[] {
    return this.db
      .prepare('SELECT nodeId, nom, baptiseA FROM baptemes ORDER BY nom COLLATE NOCASE')
      .all() as { nodeId: string; nom: string; baptiseA: number }[];
  }

  /**
   * Baptise (ou rebaptise) une ouvrière.
   *
   * Le jugement pur vit dans `bapteme.ts` ; ici on vérifie l'existence du nœud
   * et on persiste. Collision = autre `nodeId` portant déjà ce nom.
   */
  baptiser(
    nodeId: string,
    brut: string,
    now = Date.now(),
  ): VerdictBapteme | { ok: false; motif: 'noeud_inconnu' } {
    if (!this.getNode(nodeId)) return { ok: false, motif: 'noeud_inconnu' };
    const pris = this.listerBaptemes()
      .filter((b) => b.nodeId !== nodeId)
      .map((b) => b.nom);
    const verdict = jugerBapteme(brut, pris);
    if (!verdict.ok) return verdict;
    this.db
      .prepare(
        'INSERT INTO baptemes (nodeId, nom, baptiseA) VALUES (?, ?, ?) ' +
          'ON CONFLICT(nodeId) DO UPDATE SET nom = excluded.nom, baptiseA = excluded.baptiseA',
      )
      .run(nodeId, verdict.nom, now);
    return verdict;
  }

  /**
   * Retire le baptême. N'invente pas de nom de remplacement — l'ouvrière
   * redevient sans nom baptisé.
   */
  debaptiser(nodeId: string): boolean {
    const r = this.db.prepare('DELETE FROM baptemes WHERE nodeId = ?').run(nodeId);
    return r.changes > 0;
  }

  /** Résout un nom baptisé → nodeId, ou `null`. */
  nodeIdParBapteme(nom: string): string | null {
    const cible = normaliserNomBapteme(nom);
    if (!cible) return null;
    const row = this.db
      .prepare('SELECT nodeId FROM baptemes WHERE nom = ? COLLATE NOCASE')
      .get(cible) as { nodeId: string } | undefined;
    return row?.nodeId ?? null;
  }

  // ─── Métiers de cycle (ADR 0010) ───────────────────────────────────────────

  /** Métier assigné, ou `null` — jamais inventé. */
  lireMetier(nodeId: string): { metier: MetierCycle; assigneA: number } | null {
    const row = this.db
      .prepare('SELECT metier, assigneA FROM metiers_cycle WHERE nodeId = ?')
      .get(nodeId) as { metier: string; assigneA: number } | undefined;
    if (!row) return null;
    const v = validerMetier(row.metier);
    if (!v.ok) return null; // ligne corrompue ⇒ silence, pas de théâtre
    return { metier: v.metier, assigneA: row.assigneA };
  }

  listerMetiers(): { nodeId: string; metier: MetierCycle; assigneA: number }[] {
    const rows = this.db
      .prepare('SELECT nodeId, metier, assigneA FROM metiers_cycle ORDER BY assigneA DESC')
      .all() as { nodeId: string; metier: string; assigneA: number }[];
    const out: { nodeId: string; metier: MetierCycle; assigneA: number }[] = [];
    for (const r of rows) {
      const v = validerMetier(r.metier);
      if (v.ok) out.push({ nodeId: r.nodeId, metier: v.metier, assigneA: r.assigneA });
    }
    return out;
  }

  /**
   * Assigne (ou réassigne) un métier de cycle. Le nœud ne peut pas s'appeler
   * lui-même — cette méthode n'est branchée que côté Reine (API ultérieure).
   */
  assignerMetier(
    nodeId: string,
    brut: string,
    now = Date.now(),
  ): VerdictMetier | { ok: false; motif: 'noeud_inconnu' } {
    if (!this.getNode(nodeId)) return { ok: false, motif: 'noeud_inconnu' };
    const verdict = validerMetier(brut);
    if (!verdict.ok) return verdict;
    this.db
      .prepare(
        'INSERT INTO metiers_cycle (nodeId, metier, assigneA) VALUES (?, ?, ?) ' +
          'ON CONFLICT(nodeId) DO UPDATE SET metier = excluded.metier, assigneA = excluded.assigneA',
      )
      .run(nodeId, verdict.metier, now);
    return verdict;
  }

  /** Retire le métier — l'ouvrière n'a plus de cycle affiché. */
  retirerMetier(nodeId: string): boolean {
    const r = this.db.prepare('DELETE FROM metiers_cycle WHERE nodeId = ?').run(nodeId);
    return r.changes > 0;
  }

  // ─── Présences Rayon (ADR 0010) ────────────────────────────────────────────
  //
  // Fichiers ouverts CONSTATÉS. `null` / liste vide = rien à montrer (pas de
  // théâtre). Remplacées par le snapshot courant du nœud à chaque progrès.

  /** Présences ouvertes d'une ouvrière — vide si aucune observation. */
  lirePresences(
    nodeId: string,
  ): Array<PresenceFichier & { taskId: string | null; constateA: number }> {
    const rows = this.db
      .prepare(
        'SELECT toolUseId, chemin, outil, taskId, constateA FROM presences_rayon ' +
          'WHERE nodeId = ? ORDER BY constateA DESC',
      )
      .all(nodeId) as Array<{
      toolUseId: string;
      chemin: string;
      outil: string;
      taskId: string | null;
      constateA: number;
    }>;
    const out: Array<PresenceFichier & { taskId: string | null; constateA: number }> = [];
    for (const r of rows) {
      const o = validerOutilPresence(r.outil);
      const c = jugerCheminPresence(r.chemin);
      if (!o.ok || !c.ok) continue;
      out.push({
        toolUseId: r.toolUseId,
        chemin: c.chemin,
        outil: o.outil,
        taskId: r.taskId,
        constateA: r.constateA,
      });
    }
    return out;
  }

  listerPresences(): Array<{
    nodeId: string;
    toolUseId: string;
    chemin: string;
    outil: OutilPresence;
    taskId: string | null;
    constateA: number;
  }> {
    const rows = this.db
      .prepare(
        'SELECT nodeId, toolUseId, chemin, outil, taskId, constateA FROM presences_rayon ' +
          'ORDER BY constateA DESC',
      )
      .all() as Array<{
      nodeId: string;
      toolUseId: string;
      chemin: string;
      outil: string;
      taskId: string | null;
      constateA: number;
    }>;
    const out: Array<{
      nodeId: string;
      toolUseId: string;
      chemin: string;
      outil: OutilPresence;
      taskId: string | null;
      constateA: number;
    }> = [];
    for (const r of rows) {
      const o = validerOutilPresence(r.outil);
      const c = jugerCheminPresence(r.chemin);
      if (!o.ok || !c.ok) continue;
      out.push({
        nodeId: r.nodeId,
        toolUseId: r.toolUseId,
        chemin: c.chemin,
        outil: o.outil,
        taskId: r.taskId,
        constateA: r.constateA,
      });
    }
    return out;
  }

  /**
   * Remplace les présences OUVERTES d'un nœud pour une tâche par le snapshot
   * constaté. Snapshot vide ⇒ efface (plus rien d'ouvert). Nœud inconnu ⇒ refus.
   */
  remplacerPresences(
    nodeId: string,
    snapshot: PresenceFichier[],
    taskId: string | null = null,
    now = Date.now(),
  ): { ok: true } | { ok: false; motif: 'noeud_inconnu' } {
    if (!this.getNode(nodeId)) return { ok: false, motif: 'noeud_inconnu' };
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM presences_rayon WHERE nodeId = ?').run(nodeId);
      const ins = this.db.prepare(
        'INSERT INTO presences_rayon (nodeId, toolUseId, chemin, outil, taskId, constateA) ' +
          'VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const p of snapshot) {
        const o = validerOutilPresence(p.outil);
        const c = jugerCheminPresence(p.chemin);
        if (!o.ok || !c.ok) continue;
        if (typeof p.toolUseId !== 'string' || p.toolUseId.length === 0) continue;
        ins.run(nodeId, p.toolUseId, c.chemin, o.outil, taskId, now);
      }
    });
    tx();
    return { ok: true };
  }

  /** Efface toute présence d'un nœud (hors ligne, fin de tâche…). */
  effacerPresencesNoeud(nodeId: string): number {
    return this.db.prepare('DELETE FROM presences_rayon WHERE nodeId = ?').run(nodeId).changes;
  }

  /** Efface les présences liées à une tâche terminée. */
  effacerPresencesTache(taskId: string): number {
    return this.db.prepare('DELETE FROM presences_rayon WHERE taskId = ?').run(taskId).changes;
  }

  /**
   * Borne d'élagage (règle 3) : les présences trop vieilles (outil jamais
   * refermé, nœud disparu…) ne traînent pas.
   */
  prunePresences(retentionMs: number, now = Date.now()): number {
    const cutoff = now - retentionMs;
    return this.db.prepare('DELETE FROM presences_rayon WHERE constateA < ?').run(cutoff).changes;
  }

  // ─── Réquisitions (ADR 0010) ───────────────────────────────────────────────

  ouvrirRequisition(
    nodeId: string,
    genreBrut: string,
    libelleBrut: string,
    detail: string | null = null,
    taskId: string | null = null,
    now = Date.now(),
  ):
    | { ok: true; id: string; genre: GenreRequisition; libelle: string }
    | { ok: false; motif: MotifRefusRequisition } {
    if (!this.getNode(nodeId)) return { ok: false, motif: 'noeud_inconnu' };
    const g = validerGenreRequisition(genreBrut);
    if (!g.ok) return g;
    const l = validerLibelleRequisition(libelleBrut);
    if (!l.ok) return l;
    const detailClean =
      typeof detail === 'string' && detail.trim() ? detail.trim().slice(0, 2_000) : null;
    const taskClean = typeof taskId === 'string' && taskId.trim() ? taskId.trim() : null;
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO requisitions (id, nodeId, genre, libelle, detail, taskId, statut, creeA, closA) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)',
      )
      .run(id, nodeId, g.genre, l.libelle, detailClean, taskClean, 'ouverte', now);
    return { ok: true, id, genre: g.genre, libelle: l.libelle };
  }

  lireRequisition(id: string): {
    id: string;
    nodeId: string;
    genre: GenreRequisition;
    libelle: string;
    detail: string | null;
    taskId: string | null;
    statut: StatutRequisition;
    creeA: number;
    closA: number | null;
  } | null {
    const row = this.db
      .prepare(
        'SELECT id, nodeId, genre, libelle, detail, taskId, statut, creeA, closA FROM requisitions WHERE id = ?',
      )
      .get(id) as
      | {
          id: string;
          nodeId: string;
          genre: string;
          libelle: string;
          detail: string | null;
          taskId: string | null;
          statut: string;
          creeA: number;
          closA: number | null;
        }
      | undefined;
    if (!row) return null;
    const g = validerGenreRequisition(row.genre);
    if (!g.ok) return null;
    if (row.statut !== 'ouverte' && row.statut !== 'accordee' && row.statut !== 'refusee') {
      return null;
    }
    return {
      id: row.id,
      nodeId: row.nodeId,
      genre: g.genre,
      libelle: row.libelle,
      detail: row.detail,
      taskId: row.taskId,
      statut: row.statut,
      creeA: row.creeA,
      closA: row.closA,
    };
  }

  listerRequisitions(opts?: { nodeId?: string; statut?: StatutRequisition }): Array<{
    id: string;
    nodeId: string;
    genre: GenreRequisition;
    libelle: string;
    detail: string | null;
    taskId: string | null;
    statut: StatutRequisition;
    creeA: number;
    closA: number | null;
  }> {
    let sql =
      'SELECT id, nodeId, genre, libelle, detail, taskId, statut, creeA, closA FROM requisitions WHERE 1=1';
    const args: unknown[] = [];
    if (opts?.nodeId) {
      sql += ' AND nodeId = ?';
      args.push(opts.nodeId);
    }
    if (opts?.statut) {
      sql += ' AND statut = ?';
      args.push(opts.statut);
    }
    sql += ' ORDER BY creeA DESC LIMIT 200';
    const rows = this.db.prepare(sql).all(...args) as Array<{
      id: string;
      nodeId: string;
      genre: string;
      libelle: string;
      detail: string | null;
      taskId: string | null;
      statut: string;
      creeA: number;
      closA: number | null;
    }>;
    const out: Array<{
      id: string;
      nodeId: string;
      genre: GenreRequisition;
      libelle: string;
      detail: string | null;
      taskId: string | null;
      statut: StatutRequisition;
      creeA: number;
      closA: number | null;
    }> = [];
    for (const r of rows) {
      const g = validerGenreRequisition(r.genre);
      if (!g.ok) continue;
      if (r.statut !== 'ouverte' && r.statut !== 'accordee' && r.statut !== 'refusee') continue;
      out.push({
        id: r.id,
        nodeId: r.nodeId,
        genre: g.genre,
        libelle: r.libelle,
        detail: r.detail,
        taskId: r.taskId,
        statut: r.statut,
        creeA: r.creeA,
        closA: r.closA,
      });
    }
    return out;
  }

  repondreRequisition(
    id: string,
    decision: 'accordee' | 'refusee',
    now = Date.now(),
  ): { ok: true; statut: 'accordee' | 'refusee' } | { ok: false; motif: MotifRefusRequisition } {
    const cur = this.lireRequisition(id);
    if (!cur) return { ok: false, motif: 'inconnue' };
    if (cur.statut !== 'ouverte') return { ok: false, motif: 'deja_close' };
    this.db
      .prepare('UPDATE requisitions SET statut = ?, closA = ? WHERE id = ?')
      .run(decision, now, id);
    return { ok: true, statut: decision };
  }

  /** Élage les réquisitions closes trop anciennes (les ouvertes restent). */
  pruneRequisitions(retentionMs: number, now = Date.now()): number {
    const cutoff = now - retentionMs;
    return this.db
      .prepare(
        "DELETE FROM requisitions WHERE statut != 'ouverte' AND closA IS NOT NULL AND closA < ?",
      )
      .run(cutoff).changes;
  }

  // ─── Fabrique (ADR 0010 lot 8) ─────────────────────────────────────────────

  ouvrirFabrique(
    projectId: string,
    genreBrut: string,
    libelleBrut: string,
    opts?: { nodeId?: string; nomScript?: string; taskId?: string },
    now = Date.now(),
  ):
    | { ok: true; id: string; genre: GenreFabrique; libelle: string }
    | { ok: false; motif: MotifRefusFabrique } {
    if (!this.getProject(projectId)) return { ok: false, motif: 'projet_inconnu' };
    const g = validerGenreFabrique(genreBrut);
    if (!g.ok) return g;
    const l = validerLibelleFabrique(libelleBrut);
    if (!l.ok) return l;
    if (opts?.nodeId && !this.getNode(opts.nodeId)) return { ok: false, motif: 'projet_inconnu' };
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO fabriques (id, projectId, nodeId, genre, libelle, nomScript, taskId, statut, creeA, closA) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
      )
      .run(
        id,
        projectId,
        opts?.nodeId ?? null,
        g.genre,
        l.libelle,
        opts?.nomScript ?? null,
        opts?.taskId ?? null,
        'proposee',
        now,
      );
    return { ok: true, id, genre: g.genre, libelle: l.libelle };
  }

  listerFabriques(projectId: string): Array<{
    id: string;
    projectId: string;
    nodeId: string | null;
    genre: GenreFabrique;
    libelle: string;
    nomScript: string | null;
    taskId: string | null;
    statut: StatutFabrique;
    creeA: number;
    closA: number | null;
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, projectId, nodeId, genre, libelle, nomScript, taskId, statut, creeA, closA ' +
          'FROM fabriques WHERE projectId = ? ORDER BY creeA DESC LIMIT 100',
      )
      .all(projectId) as Array<{
      id: string;
      projectId: string;
      nodeId: string | null;
      genre: string;
      libelle: string;
      nomScript: string | null;
      taskId: string | null;
      statut: string;
      creeA: number;
      closA: number | null;
    }>;
    const out: Array<{
      id: string;
      projectId: string;
      nodeId: string | null;
      genre: GenreFabrique;
      libelle: string;
      nomScript: string | null;
      taskId: string | null;
      statut: StatutFabrique;
      creeA: number;
      closA: number | null;
    }> = [];
    for (const r of rows) {
      const g = validerGenreFabrique(r.genre);
      if (!g.ok) continue;
      if (
        r.statut !== 'proposee' &&
        r.statut !== 'en_revue' &&
        r.statut !== 'mergee' &&
        r.statut !== 'refusee'
      ) {
        continue;
      }
      out.push({
        id: r.id,
        projectId: r.projectId,
        nodeId: r.nodeId,
        genre: g.genre,
        libelle: r.libelle,
        nomScript: r.nomScript,
        taskId: r.taskId,
        statut: r.statut,
        creeA: r.creeA,
        closA: r.closA,
      });
    }
    return out;
  }

  /**
   * Pose le statut d'une fabrique DE CE PROJET.
   *
   * Le projet fait partie de la clé : une fabrique d'un autre projet est
   * « inconnue » ici, exactement comme une qui n'existe pas. Sans lui, la garde
   * de la route (qui juge le projet de l'URL) ne disait rien de la fabrique
   * qu'on modifiait.
   */
  poserStatutFabrique(
    projectId: string,
    id: string,
    statut: StatutFabrique,
    now = Date.now(),
  ): { ok: true } | { ok: false; motif: MotifRefusFabrique } {
    const row = this.db
      .prepare('SELECT id, statut FROM fabriques WHERE id = ? AND projectId = ?')
      .get(id, projectId) as { id: string; statut: string } | undefined;
    if (!row) return { ok: false, motif: 'inconnue' };
    if (row.statut === 'mergee' || row.statut === 'refusee') {
      return { ok: false, motif: 'deja_close' };
    }
    const clos = statut === 'mergee' || statut === 'refusee' ? now : null;
    this.db
      .prepare('UPDATE fabriques SET statut = ?, closA = ? WHERE id = ?')
      .run(statut, clos, id);
    return { ok: true };
  }

  pruneFabriques(retentionMs: number, now = Date.now()): number {
    const cutoff = now - retentionMs;
    return this.db
      .prepare(
        "DELETE FROM fabriques WHERE statut IN ('mergee','refusee') AND closA IS NOT NULL AND closA < ?",
      )
      .run(cutoff).changes;
  }

  // ─── Horizon (ADR 0010 lot 9) ──────────────────────────────────────────────

  /**
   * Consigne ce qu'on a ANNONCÉ à l'ouvrière, avant qu'elle ne commence.
   *
   * `INSERT OR REPLACE` : une tâche ré-assignée après échec reçoit une annonce
   * neuve, et c'est la dernière qui compte — c'est elle que l'humain a lue.
   * Garder les deux ferait compter deux fois la même tâche dans la calibration.
   */
  enregistrerAnnonce(
    taskId: string,
    nodeId: string,
    caste: string,
    annonce: { socle: string; n: number; p50Ms: number; p80Ms: number },
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO annonces_duree (taskId, nodeId, caste, socle, n, p50Ms, p80Ms, faiteA) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(taskId, nodeId, caste, annonce.socle, annonce.n, annonce.p50Ms, annonce.p80Ms, now);
  }

  /**
   * L'historique dont l'horloge se sert pour prédire.
   *
   * `LEFT JOIN` délibéré : une tâche terminée AVANT que l'horloge n'existe n'a
   * pas d'annonce, donc pas de caste figée. On la garde quand même, sans caste
   * — elle nourrit le socle `global`. Un `INNER JOIN` jetterait tout le passé
   * de la ruche le jour de la mise en service, et l'horloge repartirait muette
   * alors que la donnée est là.
   *
   * `LIMIT` toujours : cette table grossit à chaque tâche.
   */
  historiqueDurees(limite = 500): Array<{ dureeMs: number; caste?: string; reussie: boolean }> {
    const cap = Math.max(1, Math.min(limite, 5000));
    const rows = this.db
      .prepare(
        'SELECT r.durationMs AS dureeMs, r.success AS success, a.caste AS caste ' +
          'FROM results r LEFT JOIN annonces_duree a ON a.taskId = r.taskId ' +
          'ORDER BY r.createdAt DESC, r.id DESC LIMIT ?',
      )
      .all(cap) as Array<{ dureeMs: number; success: number; caste: string | null }>;
    return rows.map((r) => ({
      dureeMs: r.dureeMs,
      ...(r.caste === null ? {} : { caste: r.caste }),
      reussie: r.success === 1,
    }));
  }

  /**
   * Les tâches ENCORE en vol, avec l'instant où on les a annoncées.
   *
   * `faiteA` est l'instant exact de l'assignation — c'est `envoyerTache` qui
   * l'écrit, dans le même geste que l'envoi. Plus juste qu'un `updatedAt`, qui
   * bouge à chaque changement et confondrait « assignée il y a deux heures »
   * avec « statut retouché il y a deux minutes ».
   *
   * Sert à repérer les tâches sorties du domaine connu : celles qui courent
   * depuis plus longtemps que TOUT ce que la ruche a observé.
   */
  tachesEnVolAnnoncees(
    limite = 200,
  ): Array<{ taskId: string; nodeId: string; caste: string; faiteA: number }> {
    const cap = Math.max(1, Math.min(limite, 2000));
    return this.db
      .prepare(
        'SELECT a.taskId AS taskId, a.nodeId AS nodeId, a.caste AS caste, a.faiteA AS faiteA ' +
          'FROM annonces_duree a JOIN tasks t ON t.id = a.taskId ' +
          "WHERE t.status IN ('assigned', 'running') ORDER BY a.faiteA ASC LIMIT ?",
      )
      .all(cap) as Array<{ taskId: string; nodeId: string; caste: string; faiteA: number }>;
  }

  /**
   * Les annonces qui ont trouvé leur réel — de quoi noter l'horloge.
   *
   * On ne retient que les tâches RÉUSSIES : une tâche abandonnée n'a pas
   * infirmé l'annonce, elle l'a rendue sans objet. La compter comme un
   * dépassement salirait la calibration avec des cas qui ne la concernent pas.
   */
  /**
   * Les annonces que le réel a jugées.
   *
   * ─── LE SOCLE « AUCUN » EN EST EXCLU, ET C'EST TOUTE LA JUSTESSE DE LA NOTE ─
   *
   * Sur ce socle, l'annonce enregistrée porte « p80Ms = 0 » : la ruche n'a rien
   * promis, elle a dit « je ne sais pas encore ». Or « calibrer » compte une
   * annonce tenue quand « reelMs <= p80Ms » — donc aucune de ces lignes ne
   * tient jamais, et chacune fait chuter la part.
   *
   * MESURÉ avant d'être corrigé : cinq tâches toutes annoncées « aucun », toutes
   * réussies, rendaient « partTenue 0, ecart -0,8, verdict optimiste » — la pire
   * note du barème. Et c'est le cas du DÉMARRAGE : une ruche neuve n'a pas
   * d'historique, donc ses premières annonces sont TOUTES « aucun ». L'horloge
   * se serait déclarée menteuse dès le premier jour, en punition d'avoir été
   * honnête.
   *
   * Le filtre est ici, dans la requête, et pas dans « calibrer » : ce dernier ne
   * reçoit que des couples (promesse, réel) et ne connaît pas les socles. Lui
   * passer de quoi trier reviendrait à lui faire porter une règle de stockage.
   *
   * C'est le même piège que celui fermé côté écran dans « verdictAnnonce » —
   * comparer un réel à un plafond que personne n'a promis —, rencontré une
   * seconde fois, à l'autre bout de la chaîne.
   */
  annoncesJugees(limite = 500): Array<{ p80Ms: number; reelMs: number }> {
    const cap = Math.max(1, Math.min(limite, 5000));
    return this.db
      .prepare(
        'SELECT a.p80Ms AS p80Ms, r.durationMs AS reelMs ' +
          'FROM annonces_duree a JOIN results r ON r.taskId = a.taskId ' +
          "WHERE r.success = 1 AND a.socle <> 'aucun' ORDER BY a.faiteA DESC LIMIT ?",
      )
      .all(cap) as Array<{ p80Ms: number; reelMs: number }>;
  }

  ajouterHorizon(
    projectId: string,
    kindBrut: string,
    texteBrut: string,
    source = 'reine',
    now = Date.now(),
  ): { ok: true; entree: EntreeHorizon } | { ok: false; motif: MotifRefusHorizon } {
    if (!this.getProject(projectId)) return { ok: false, motif: 'projet_inconnu' };
    const k = validerKindHorizon(kindBrut);
    if (!k.ok) return k;
    const t = validerTexteHorizon(texteBrut);
    if (!t.ok) return t;
    const count = (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM horizon_ledger WHERE projectId = ?')
        .get(projectId) as {
        n: number;
      }
    ).n;
    if (count >= HORIZON_LECTURE_MAX * 5) return { ok: false, motif: 'trop_dentrees' };
    const id = randomUUID();
    const src = (source || 'reine').trim().slice(0, 80) || 'reine';
    this.db
      .prepare(
        'INSERT INTO horizon_ledger (id, projectId, kind, texte, source, creeA) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, k.kind, t.texte, src, now);
    return {
      ok: true,
      entree: {
        id,
        projectId,
        kind: k.kind,
        texte: t.texte,
        source: src,
        creeA: now,
      },
    };
  }

  listerHorizon(projectId: string, limite = HORIZON_LECTURE_MAX): EntreeHorizon[] {
    const cap = Math.max(1, Math.min(limite, HORIZON_LECTURE_MAX));
    const rows = this.db
      .prepare(
        'SELECT id, projectId, kind, texte, source, creeA FROM horizon_ledger ' +
          'WHERE projectId = ? ORDER BY creeA DESC LIMIT ?',
      )
      .all(projectId, cap) as Array<{
      id: string;
      projectId: string;
      kind: string;
      texte: string;
      source: string;
      creeA: number;
    }>;
    const out: EntreeHorizon[] = [];
    for (const r of rows) {
      const k = validerKindHorizon(r.kind);
      if (!k.ok) continue;
      out.push({
        id: r.id,
        projectId: r.projectId,
        kind: k.kind,
        texte: r.texte,
        source: r.source,
        creeA: r.creeA,
      });
    }
    return out;
  }

  /** Compte brut du ledger (pour garde-fou essaim, pas pour l’écran). */
  compterHorizon(projectId: string): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM horizon_ledger WHERE projectId = ?')
        .get(projectId) as { n: number }
    ).n;
  }

  /**
   * Élague le registre des annonces.
   *
   * Cette table grossit SOUS LA MACHINE — une ligne par tâche assignée —, donc
   * elle a sa borne, comme la doctrine l'exige. Elle s'élague par le TEMPS, là
   * où `pruneResults` s'élague par le NOMBRE — et les deux ne se comparent pas.
   *
   * Ce qui compte : `pruneResults` ne SUPPRIME pas les lignes, il vide leurs
   * colonnes lourdes. `durationMs` survit donc indéfiniment, et l'annonce est
   * la moitié PÉRISSABLE du couple. Une annonce élaguée fait sortir sa tâche de
   * la calibration sans erreur ni trou visible — juste une note calculée sur
   * moins de cas qu'on ne croit.
   */
  pruneAnnonces(retentionMs: number, now = Date.now()): number {
    const cutoff = now - retentionMs;
    return this.db.prepare('DELETE FROM annonces_duree WHERE faiteA < ?').run(cutoff).changes;
  }

  pruneHorizon(retentionMs: number, now = Date.now()): number {
    const cutoff = now - retentionMs;
    return this.db.prepare('DELETE FROM horizon_ledger WHERE creeA < ?').run(cutoff).changes;
  }

  // ─── Motifs perso (ADR 0010 lot 10) ────────────────────────────────────────

  creerMotifProjet(
    projectId: string,
    libelleBrut: string,
    etapesBrutes: unknown,
    now = Date.now(),
  ):
    | { ok: true; id: string; libelle: string; etapes: string[] }
    | { ok: false; motif: MotifPersoRefus } {
    if (!this.getProject(projectId)) return { ok: false, motif: 'vide' };
    const v = validerMotifPerso(libelleBrut, etapesBrutes);
    if (!v.ok) return v;
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO motifs_projet (id, projectId, libelle, etapes, creeA) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, projectId, v.libelle, JSON.stringify(v.etapes), now);
    return { ok: true, id, libelle: v.libelle, etapes: v.etapes };
  }

  listerMotifsProjet(projectId: string): Array<{
    id: string;
    libelle: string;
    etapes: string[];
    creeA: number;
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, libelle, etapes, creeA FROM motifs_projet WHERE projectId = ? ORDER BY creeA DESC LIMIT 32',
      )
      .all(projectId) as Array<{ id: string; libelle: string; etapes: string; creeA: number }>;
    const out: Array<{ id: string; libelle: string; etapes: string[]; creeA: number }> = [];
    for (const r of rows) {
      try {
        const parsed: unknown = JSON.parse(r.etapes);
        if (!Array.isArray(parsed)) continue;
        const v = validerMotifPerso(r.libelle, parsed);
        if (!v.ok) continue;
        out.push({ id: r.id, libelle: v.libelle, etapes: v.etapes, creeA: r.creeA });
      } catch {
        continue;
      }
    }
    return out;
  }

  lireMotifProjet(id: string): {
    id: string;
    projectId: string;
    libelle: string;
    etapes: string[];
    creeA: number;
  } | null {
    const row = this.db
      .prepare('SELECT id, projectId, libelle, etapes, creeA FROM motifs_projet WHERE id = ?')
      .get(id) as
      { id: string; projectId: string; libelle: string; etapes: string; creeA: number } | undefined;
    if (!row) return null;
    try {
      const parsed: unknown = JSON.parse(row.etapes);
      const v = validerMotifPerso(row.libelle, parsed);
      if (!v.ok) return null;
      return {
        id: row.id,
        projectId: row.projectId,
        libelle: v.libelle,
        etapes: v.etapes,
        creeA: row.creeA,
      };
    } catch {
      return null;
    }
  }

  // ─── Connecteurs externes (src/connectors) ──────────────────────────────────
  //
  // Deux surfaces : l'AUTORISATION par projet (qui peut, quoi, sur quels canaux)
  // et le JOURNAL append-only des appels. Le secret du connecteur n'apparaît
  // dans NI l'une NI l'autre — il vit dans le `.env` Queen. Les portées, canaux
  // et usagers sont des listes JSON de chaînes ; une valeur illisible (base
  // éditée à la main) vaut « rien accordé », jamais un accès inventé.

  /**
   * Accorde (ou met à jour) l'autorisation d'un connecteur sur un projet. Les
   * listes sont réécrites en entier — accorder REMPLACE, il n'ajoute pas à
   * l'aveugle : l'humain voit à l'écran exactement ce qu'il pose. Idempotent.
   */
  autoriserConnecteur(
    input: {
      connecteurId: string;
      projectId: string;
      portees: readonly string[];
      canaux?: readonly string[];
      usagers?: readonly string[];
      actif?: boolean;
    },
    now = Date.now(),
  ): void {
    const portees = JSON.stringify([...input.portees]);
    const canaux = JSON.stringify([...(input.canaux ?? [])]);
    const usagers = JSON.stringify([...(input.usagers ?? [])]);
    const actif = input.actif === false ? 0 : 1;
    this.db
      .prepare(
        `INSERT INTO connecteurs_projet (connecteurId, projectId, portees, canaux, usagers, actif, creeA, majA)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connecteurId, projectId) DO UPDATE SET
           portees = excluded.portees, canaux = excluded.canaux, usagers = excluded.usagers,
           actif = excluded.actif, majA = excluded.majA`,
      )
      .run(input.connecteurId, input.projectId, portees, canaux, usagers, actif, now, now);
  }

  /** Révoque l'autorisation d'un connecteur sur un projet. Rend vrai si une ligne partait. */
  revoquerConnecteur(connecteurId: string, projectId: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM connecteurs_projet WHERE connecteurId = ? AND projectId = ?')
        .run(connecteurId, projectId).changes > 0
    );
  }

  /** L'autorisation d'un connecteur sur un projet, ou `null`. Listes robustes à la corruption. */
  lireAutorisationConnecteur(
    connecteurId: string,
    projectId: string,
  ): {
    connecteurId: string;
    projectId: string;
    portees: string[];
    canaux: string[];
    usagers: string[];
    actif: boolean;
    majA: number;
  } | null {
    const row = this.db
      .prepare(
        'SELECT connecteurId, projectId, portees, canaux, usagers, actif, majA FROM connecteurs_projet WHERE connecteurId = ? AND projectId = ?',
      )
      .get(connecteurId, projectId) as
      | {
          connecteurId: string;
          projectId: string;
          portees: string;
          canaux: string;
          usagers: string;
          actif: number;
          majA: number;
        }
      | undefined;
    if (!row) return null;
    return {
      connecteurId: row.connecteurId,
      projectId: row.projectId,
      portees: listeDeChaines(row.portees),
      canaux: listeDeChaines(row.canaux),
      usagers: listeDeChaines(row.usagers),
      actif: row.actif !== 0,
      majA: row.majA,
    };
  }

  /** Les autorisations d'un projet (pour l'écran de réglages). */
  listerAutorisationsProjet(projectId: string): Array<{
    connecteurId: string;
    portees: string[];
    canaux: string[];
    usagers: string[];
    actif: boolean;
    majA: number;
  }> {
    const rows = this.db
      .prepare(
        'SELECT connecteurId, portees, canaux, usagers, actif, majA FROM connecteurs_projet WHERE projectId = ? ORDER BY connecteurId',
      )
      .all(projectId) as Array<{
      connecteurId: string;
      portees: string;
      canaux: string;
      usagers: string;
      actif: number;
      majA: number;
    }>;
    return rows.map((r) => ({
      connecteurId: r.connecteurId,
      portees: listeDeChaines(r.portees),
      canaux: listeDeChaines(r.canaux),
      usagers: listeDeChaines(r.usagers),
      actif: r.actif !== 0,
      majA: r.majA,
    }));
  }

  /** Ajoute une entrée au journal append-only des connecteurs. Rend l'entrée écrite. */
  journaliserConnecteur(
    entree: {
      connecteurId: string;
      projectId: string | null;
      portee: string;
      acte: string;
      cible: string | null;
      resultat: 'ok' | 'echec' | 'refuse';
      qui: string;
      apercu?: string;
      chargeDigest?: string;
    },
    now = Date.now(),
  ): EntreeJournalConnecteur {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO connecteurs_journal
           (id, connecteurId, projectId, portee, acte, cible, resultat, qui, apercu, chargeDigest, creeA)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entree.connecteurId,
        entree.projectId,
        entree.portee,
        entree.acte,
        entree.cible,
        entree.resultat,
        entree.qui,
        entree.apercu ?? '',
        entree.chargeDigest ?? '',
        now,
      );
    return {
      id,
      ...entree,
      apercu: entree.apercu ?? '',
      chargeDigest: entree.chargeDigest ?? '',
      creeA: now,
    };
  }

  /** Les entrées du journal, filtrables par projet ou connecteur. Récentes d'abord. */
  listerJournalConnecteurs(opts?: {
    projectId?: string;
    connecteurId?: string;
    limit?: number;
  }): EntreeJournalConnecteur[] {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts?.projectId) {
      clauses.push('projectId = ?');
      params.push(opts.projectId);
    }
    if (opts?.connecteurId) {
      clauses.push('connecteurId = ?');
      params.push(opts.connecteurId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT id, connecteurId, projectId, portee, acte, cible, resultat, qui, apercu, chargeDigest, creeA
         FROM connecteurs_journal ${where} ORDER BY creeA DESC LIMIT ?`,
      )
      .all(...params, limit) as EntreeJournalConnecteur[];
    return rows;
  }

  /** Élague le journal des connecteurs par le temps (comme `events`). */
  pruneConnecteursJournal(retentionMs: number, now = Date.now()): number {
    return this.db.prepare('DELETE FROM connecteurs_journal WHERE creeA < ?').run(now - retentionMs)
      .changes;
  }

  setNodeStatus(id: string, status: NodeStatus): void {
    this.db.prepare('UPDATE nodes SET status = ? WHERE id = ?').run(status, id);
  }

  /** Met à jour le dernier heartbeat vu (le statut est géré par le scheduler). */
  touchNode(id: string, now = Date.now()): void {
    this.db.prepare('UPDATE nodes SET lastSeen = ? WHERE id = ?').run(now, id);
  }

  /** Nœuds online dont le dernier heartbeat est antérieur à `cutoff`. */
  staleNodes(cutoff: number): HiveNode[] {
    return (
      this.db
        .prepare(
          `${NODE_SELECT} WHERE n.status = 'online' AND (n.lastSeen IS NULL OR n.lastSeen < ?)`,
        )
        .all(cutoff) as NodeRowBrut[]
    ).map(rowToNode);
  }

  // ─── Tâches ────────────────────────────────────────────────────────────────
  createTask(input: NewTask, now = Date.now()): Task {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO tasks (id, projectId, title, prompt, status, dependsOn, attempts, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.prompt,
        JSON.stringify(input.dependsOn ?? []),
        now,
        now,
      );
    return this.getTask(id) as Task;
  }

  /**
   * Relit le graphe auquel appartient `taskId`.
   *
   * Une tâche sans arête est une racine implicite de profondeur zéro. Les
   * statuts viennent toujours de `tasks`, seule source de vérité du scheduler.
   */
  listDelegationGraph(taskId: string): NoeudDelegation[] {
    const task = this.getTask(taskId);
    if (!task) return [];
    const edge = this.db
      .prepare('SELECT * FROM task_delegations WHERE childTaskId = ?')
      .get(taskId) as DelegationRow | undefined;
    const rootTaskId = edge?.rootTaskId ?? taskId;
    const root = this.getTask(rootTaskId);
    if (!root) return [];
    const rows = this.db
      .prepare(
        `SELECT d.*, t.status AS taskStatus
         FROM task_delegations d
         JOIN tasks t ON t.id = d.childTaskId
         WHERE d.rootTaskId = ?
         ORDER BY d.depth, d.createdAt, d.childTaskId`,
      )
      .all(rootTaskId) as Array<DelegationRow & { taskStatus: TaskStatus }>;
    return [
      {
        taskId: root.id,
        rootTaskId,
        parentTaskId: null,
        depth: 0,
        status: root.status,
        origine: 'hive',
      },
      ...rows.map((row) => ({
        taskId: row.childTaskId,
        rootTaskId: row.rootTaskId,
        parentTaskId: row.parentTaskId,
        depth: row.depth,
        status: row.taskStatus,
        origine: row.origin,
        budget: {
          durationMs: row.durationMs,
          costMicros: row.costMicros,
          resourceUnits: row.resourceUnits,
        },
      })),
    ];
  }

  /**
   * La dépense déclarée de l'arbre de `rootTaskId` (voir `DepenseDeclaree`) :
   * une lecture d'index, jamais le journal — qui s'élague par nombre.
   *
   * Une tentative ENCORE EN VOL (sans résultat, sa tâche toujours portée par
   * ce nœud) n'est pas comptée : sa dépense n'est pas finie, elle n'est pas
   * encore « inconnue ». Une tentative sans résultat dont la tâche a quitté ce
   * nœud a été interrompue : comptée, au coût inconnu. Un drone non primaire
   * d'une course vit sous l'assignation du primaire : il est lu interrompu
   * tant qu'il vole — la dépense se dit alors « au moins », jamais moins.
   */
  depenseDeclareeRacine(rootTaskId: string): DepenseDeclaree {
    const ligne = this.db
      .prepare(
        `SELECT COUNT(*) AS tentatives, COUNT(d.coutMicros) AS declarees,
                COALESCE(SUM(d.coutMicros), 0) AS micros
           FROM depenses_delegation d LEFT JOIN tasks t ON t.id = d.taskId
          WHERE d.rootTaskId = ?
            AND NOT (d.resultId IS NULL AND t.assignedNodeId = d.nodeId
                     AND t.status IN ('assigned', 'running'))`,
      )
      .get(rootTaskId) as { tentatives: number; declarees: number; micros: number };
    if (ligne.tentatives === 0) return { ...AUCUNE_DEPENSE };
    return {
      micros: ligne.micros,
      tentatives: ligne.tentatives,
      sansCout: ligne.tentatives - ligne.declarees,
    };
  }

  /**
   * Par nœud, les tâches ACTIVES de l'arbre de `rootTaskId` — la racine
   * comprise — qui attendent un enfant délégué Hive encore en vol. Ce sont les
   * places que cet arbre, et lui seul, peut reprendre (`slotsOccupes`,
   * delegation.ts) : une autre tâche voit ces parents occuper leur place.
   *
   * Lu à la volée, comme `running` : le fait vit dans le statut des tâches et
   * les arêtes du graphe, jamais dans un compteur qui pourrait dériver.
   */
  parentsEnAttenteSousRacine(rootTaskId: string): Map<string, number> {
    const lignes = this.db
      .prepare(
        `SELECT t.assignedNodeId AS nodeId, COUNT(*) AS n FROM tasks t
          WHERE t.assignedNodeId IS NOT NULL AND t.status IN ('assigned', 'running')
            AND (t.id = ? OR t.id IN (SELECT childTaskId FROM task_delegations WHERE rootTaskId = ?))
            AND EXISTS (
              SELECT 1 FROM task_delegations d JOIN tasks enfant ON enfant.id = d.childTaskId
               WHERE d.parentTaskId = t.id AND d.origin = 'hive'
                 AND enfant.status NOT IN ('done', 'failed')
            )
          GROUP BY t.assignedNodeId`,
      )
      .all(rootTaskId, rootTaskId) as { nodeId: string; n: number }[];
    return new Map(lignes.map((l) => [l.nodeId, l.n]));
  }

  getDelegation(taskId: string): DelegationRangee | null {
    const row = this.db
      .prepare('SELECT * FROM task_delegations WHERE childTaskId = ?')
      .get(taskId) as DelegationRow | undefined;
    if (!row) return null;
    const task = this.getTask(taskId);
    if (!task) return null;
    return { ...rowToDelegation(row), title: task.title, prompt: task.prompt };
  }

  /**
   * Valide, crée la tâche enfant et range son arête dans UNE transaction.
   * Aucun enfant orphelin ne peut donc devenir visible au scheduler.
   *
   * Les budgets se jugent contre l'enveloppe de la RACINE : réservations de
   * tout l'arbre et dépense déclarée sont relues ici, dans la même
   * transaction que l'écriture de l'enfant (`jugerDelegation`).
   */
  createDelegatedTask(demande: DemandeDelegation, now = Date.now()): CreationDeleguee {
    const tx = this.db.transaction((): CreationDeleguee => {
      const parent = this.getTask(demande.parentTaskId);
      const graphe = parent ? this.listDelegationGraph(parent.id) : [];
      if (this.getTask(demande.childTaskId)) {
        return { ok: false, code: 'task_id_duplique', motif: 'identifiant enfant déjà utilisé' };
      }
      // La dépense est relue DANS la transaction, comme le graphe : deux
      // demandes concurrentes ne peuvent pas passer toutes deux sous un
      // plafond que la première a déjà fait franchir.
      const depense = this.depenseDeclareeRacine(graphe[0]?.rootTaskId ?? demande.parentTaskId);
      // Les bornes sont celles que tout le reste de la Reine tient
      // (`LIMITES_DELEGATION_DEFAUT`) : l'enveloppe coût, son annulation et
      // l'écran les relisent là — une borne injectée ici seulement ferait
      // admettre ce que la clôture refuserait.
      const verdict = jugerDelegation(demande, graphe, { depense });
      if (!verdict.ok) return verdict;
      if (!parent) {
        // `jugerDelegation` couvre déjà ce cas. Cette garde maintient le
        // narrowing local et évite toute création si sa politique évolue.
        return { ok: false, code: 'parent_absent', motif: 'tâche parente introuvable' };
      }
      const plan = verdict.plan;
      this.db
        .prepare(
          `INSERT INTO tasks
             (id, projectId, title, prompt, status, dependsOn, attempts, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'pending', '[]', 0, ?, ?)`,
        )
        .run(plan.childTaskId, parent.projectId, plan.title, plan.prompt, now, now);
      this.db
        .prepare(
          `INSERT INTO task_delegations
             (childTaskId, parentTaskId, rootTaskId, depth, origin, durationMs,
              costMicros, resourceUnits, preferredAgent, preferredModel, createdAt)
           VALUES (?, ?, ?, ?, 'hive', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          plan.childTaskId,
          plan.parentTaskId,
          plan.rootTaskId,
          plan.depth,
          plan.durationMs,
          plan.costMicros,
          plan.resourceUnits,
          plan.preferredAgent ?? null,
          plan.preferredModel ?? null,
          now,
        );
      return {
        ok: true,
        task: this.getTask(plan.childTaskId) as Task,
        delegation: {
          ...plan,
          origine: 'hive',
          createdAt: now,
        },
      };
    });
    return tx();
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  /**
   * Le TRAVAIL des projets — jamais une ombre du banc (shadow-bench.ts).
   *
   * C'est par ici que passent tout ce qui livre, fusionne ou compte le travail
   * d'un projet : plan et exécution du merge, livraison de mission, candidates
   * de la livraison autonome, décision du Plein Essaim, rapport d'avancement,
   * détection de conflits, dépendances admises à la création. Une ombre rejoue
   * une tâche DÉJÀ comptée : la voir ici, c'était la livrer ou la fusionner une
   * seconde fois, et compter deux fois le même travail. L'exclure à la source
   * ferme toutes ces portes d'un coup ; le planificateur, lui, lit les tâches
   * par statut (`tasksByStatus`) et voit bien les ombres qu'il doit lancer.
   *
   * `avecOmbres` : pour ce qui décrit l'ACTIVITÉ d'une ouvrière (sa Chambre,
   * « ce qui tourne en ce moment ») et non le travail d'un projet. Une ombre y
   * a bel et bien tourné : la cacher là, c'était montrer une ouvrière occupée
   * (`running` la compte) sans rien dans sa liste.
   */
  listTasks(projectId?: string, { avecOmbres = false }: { avecOmbres?: boolean } = {}): Task[] {
    const horsOmbres = avecOmbres ? '1' : 'id NOT IN (SELECT tacheOmbre FROM taches_ombre)';
    const rows = (
      projectId
        ? this.db
            .prepare(
              `SELECT * FROM tasks WHERE projectId = ? AND ${horsOmbres} ORDER BY createdAt, id`,
            )
            .all(projectId)
        : this.db.prepare(`SELECT * FROM tasks WHERE ${horsOmbres} ORDER BY createdAt, id`).all()
    ) as TaskRow[];
    return rows.map(rowToTask);
  }

  /** Le nombre de tâches, sans en charger une seule. */
  compterTaches(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
  }

  /**
   * Les `limite` tâches qui comptent le plus pour un écran, et rien de plus.
   *
   * ─── POURQUOI CETTE MÉTHODE EXISTE ─────────────────────────────────────────
   *
   * `getSnapshot()` chargeait la table ENTIÈRE, et `broadcastState()` la
   * rediffuse à chaque changement d'état. Mesuré sur ce dépôt, tâches de
   * longueur réaliste :
   *
   *     tâches | getSnapshot | JSON.stringify | octets envoyés
   *     -------|-------------|----------------|----------------
   *        500 |     3,9 ms  |      2,3 ms    |  0,23 Mo
   *      2 000 |    14,2 ms  |      8,9 ms    |  0,91 Mo
   *      5 000 |    39,4 ms  |     21,5 ms    |  2,28 Mo
   *     20 000 |   182,1 ms  |     94,6 ms    |  9,13 Mo
   *
   * À 20 000 tâches, un seul changement d'état BLOQUE la boucle 277 ms et
   * pousse 9,1 Mo à chaque tableau de bord connecté. L'orchestrateur est
   * mono-thread : pendant ce temps, il ne répond à personne.
   *
   * ─── L'ORDRE N'EST PAS « LES PLUS RÉCENTES » ───────────────────────────────
   *
   * Prendre les N dernières par date perdrait une tâche VIVANTE mais ancienne —
   * exactement celle qu'on regarde quand quelque chose ne va pas. Les tâches
   * non terminales passent donc TOUTES en premier, quel que soit leur âge ;
   * la limite ne rogne que sur les terminées, des plus récentes aux plus
   * vieilles.
   *
   * Le retour est ensuite retrié par `createdAt` : `listTasks` promet cet
   * ordre-là, et une fenêtre ne doit pas changer le contrat, seulement sa
   * taille.
   */
  tachesPourEcran(limite: number): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks
          ORDER BY (status IN ('done', 'failed')) ASC, updatedAt DESC, id
          LIMIT ?`,
      )
      .all(limite) as TaskRow[];
    // Les OMBRES du banc sont marquées (`Task.ombre`) : l'écran les montre là
    // où elles ont tourné, mais jamais dans la file de revue ni les compteurs
    // du travail des projets. UNE lecture de la table latérale pour toute la
    // fenêtre (bornée comme les tâches, `pruneTachesOmbre`), pas une par tâche.
    const ombres = new Set(
      (
        this.db.prepare('SELECT tacheOmbre FROM taches_ombre').all() as { tacheOmbre: string }[]
      ).map((r) => r.tacheOmbre),
    );
    // Les DEUX bornes du départage — `a.id < b.id` et `a.id > b.id` — sont des
    // mutants ÉQUIVALENTS, et c'est CONSIGNÉ, pas un test qui manque : elles ne
    // diffèrent de `<=` / `>=` que pour `a.id === b.id`, et `id` est la clé
    // primaire de `tasks`. Deux lignes d'un même `SELECT` ne peuvent donc pas
    // porter le même `id` — le cas qui distinguerait n'existe pas.
    //
    // Un balayage élargi de la loupe les re-signalera « sans test » à chaque
    // fois. Ce qu'il faut lire alors, ce n'est pas ce départage — c'est l'ORDRE
    // et la FENÊTRE au-dessus, éprouvés en six cas par `taches-bornees.test.ts`
    // à travers `getSnapshot`, la porte publique (ERREURS § 9 duotrigies : un
    // banc bien écrit ne nomme pas la fonction interne qu'il traverse).
    return (
      rows
        .map((row) =>
          ombres.has(row.id) ? { ...rowToTask(row), ombre: true as const } : rowToTask(row),
        )
        // loupe : équivalent — < → <= ; loupe : équivalent — > → >=
        // (voir la consignation au-dessus de ce `return`.)
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    );
  }

  /**
   * Élague les tâches TERMINÉES au-delà de la rétention.
   *
   * ─── LA SEULE TABLE DU DÉPÔT QUI N'AVAIT PAS DE BORNE ──────────────────────
   *
   * `pruneTachesIssue` et `pruneContreExpertises` sont des bornes RÉFÉRENTIELLES
   * — elles suppriment les liens dont la tâche n'existe plus. Leurs docstrings
   * ont longtemps justifié cette conception par « les tâches ont déjà leur
   * propre élagage ». C'était faux, et mesuré comme tel : sur 2 000 tâches, les
   * deux supprimaient 0 ligne, pour toujours. Aucune tâche ne disparaissant
   * jamais, aucun lien n'était jamais orphelin.
   *
   * Cette méthode-ci les rend enfin vraies.
   *
   * ─── DEUX CHOSES QU'ELLE NE SUPPRIME PAS, ET POURQUOI ──────────────────────
   *
   * 1. UNE TÂCHE DONT UNE SURVIVANTE DÉPEND ENCORE. C'est la correction qui
   *    compte : `dependsOn` cite des identifiants, et une tâche qui attend un id
   *    disparu n'est jamais prête — elle reste bloquée sans que rien ne le dise.
   *    Le `EXCEPT` ci-dessous exclut donc les ids cités par les tâches qui
   *    RESTENT. Une chaîne entière de tâches terminées part bien d'un bloc :
   *    protéger les ids cités par n'importe quelle tâche, y compris celles qu'on
   *    supprime, aurait fait de cette borne un no-op de plus.
   *
   * 2. LA MÉMOIRE. `memories` porte un `taskId`, et pourtant elle survit : le
   *    Cerveau existe précisément pour que le SAVOIR dure plus longtemps que
   *    l'épisode qui l'a produit. Il a sa propre borne, `pruneMemories`, qui
   *    élague par genre et par usage. Cascader ici effacerait les leçons en même
   *    temps que les faits — c'est-à-dire tout ce que le projet cherche à ne pas
   *    perdre.
   *
   * `reviews`, elle, cascade : un verdict sur une tâche qui n'existe plus ne
   * désigne rien, et aucune autre borne ne la nettoierait. `annonces_duree`
   * aussi : elle référence `tasks(id)`, et la laisser ferait échouer la passe.
   */
  pruneTasks(retentionMs: number, now = Date.now()): number {
    const seuil = now - retentionMs;
    const supprimer = this.db.transaction((limite: number) => {
      const condamnees = (
        this.db
          .prepare(
            `SELECT id FROM tasks
              WHERE status IN ('done', 'failed') AND updatedAt < ?
             EXCEPT
             SELECT j.value FROM tasks t, json_each(t.dependsOn) j
              WHERE NOT (t.status IN ('done', 'failed') AND t.updatedAt < ?)
             EXCEPT
             SELECT d.parentTaskId
               FROM task_delegations d
               JOIN tasks enfant ON enfant.id = d.childTaskId
              WHERE NOT (enfant.status IN ('done', 'failed') AND enfant.updatedAt < ?)
             EXCEPT
             SELECT d.rootTaskId
               FROM task_delegations d
               JOIN tasks enfant ON enfant.id = d.childTaskId
              WHERE NOT (enfant.status IN ('done', 'failed') AND enfant.updatedAt < ?)`,
          )
          .all(limite, limite, limite, limite) as { id: string }[]
      ).map((r) => r.id);
      if (condamnees.length === 0) return 0;
      let partis = 0;
      const LOT = 900; // sous la limite de variables liées de SQLite
      // loupe : équivalent — < → <=
      // La borne de cette boucle est un mutant ÉQUIVALENT — MESURÉ, pas déduit,
      // et c'est l'inverse de ce que la lecture annonçait.
      //
      // Le raisonnement naturel : avec `<=`, un compte de condamnées multiple
      // EXACT de `LOT` ajoute un tour où `slice` rend `[]`, donc `trous` est vide,
      // donc `IN ()` — que l'on croit être une erreur de syntaxe qui ferait jeter
      // toute la transaction et cesser l'élagage pour de bon.
      //
      // Sondé à 899 et à 900 condamnées, sur source saine puis mutée : les quatre
      // passes suppriment tout, sans rien jeter. SQLite ACCEPTE `expr IN ()` —
      // c'est une extension documentée, qui vaut toujours faux. Le tour de trop ne
      // coûte qu'une requête sans effet.
      //
      // Le laisser en `<` reste juste : on n'écrit pas une requête pour rien. Mais
      // un balayage le re-signalera « sans test » à chaque passe, et le prochain
      // lecteur refera exactement ma prédiction — elle est fausse, elle est ici.
      for (let i = 0; i < condamnees.length; i += LOT) {
        const lot = condamnees.slice(i, i + LOT);
        const trous = lot.map(() => '?').join(', ');
        this.db.prepare(`DELETE FROM reviews WHERE taskId IN (${trous})`).run(...lot);
        this.db.prepare(`DELETE FROM task_delegations WHERE childTaskId IN (${trous})`).run(...lot);
        this.db.prepare(`DELETE FROM consignes_routage WHERE taskId IN (${trous})`).run(...lot);
        // L'annonce de durée RÉFÉRENCE sa tâche (`foreign_keys = ON`) : oubliée
        // ici, une seule annonce plus jeune que `pruneAnnonces` (180 j) sur une
        // tâche close depuis 30 j fait jeter TOUTE la transaction — et, par le
        // tick, figeait toutes les bornes suivantes. Elle suit donc sa tâche :
        // la calibration de l'horloge ne compte plus que les ~30 derniers jours
        // de tâches, ce qui est la fenêtre qu'elle a vraiment (décision #527).
        this.db.prepare(`DELETE FROM annonces_duree WHERE taskId IN (${trous})`).run(...lot);
        // Par RACINE : la dépense d'un arbre ne part qu'avec l'arbre entier
        // (voir le schéma de depenses_delegation).
        this.db
          .prepare(`DELETE FROM depenses_delegation WHERE rootTaskId IN (${trous})`)
          .run(...lot);
        partis += this.db.prepare(`DELETE FROM tasks WHERE id IN (${trous})`).run(...lot).changes;
      }
      return partis;
    });
    return supprimer(seuil);
  }

  /**
   * Lecture ciblée par CLÉ PRIMAIRE : seules les colonnes et les lignes
   * demandées. Découpée en lots de 900 pour rester sous la limite de variables
   * liées de SQLite (999 par défaut) ; les ids sont dédoublonnés, les inconnus
   * simplement absents du retour.
   *
   * `table` / `cle` par défaut sur `tasks(id)` — le cas de très loin le plus
   * fréquent. `reviews(taskId)` emprunte le même chemin : sa clé primaire est
   * un index, le plan est un SEARCH, jamais un SCAN (verrouillé par
   * tests/store-scaling.test.ts). Ni l'un ni l'autre ne vient jamais de
   * l'extérieur : ce sont des littéraux de ce fichier.
   */
  private lireParIds<T>(
    colonnes: string,
    ids: readonly string[],
    table: 'tasks' | 'reviews' = 'tasks',
    cle: 'id' | 'taskId' = 'id',
  ): T[] {
    const uniques = [...new Set(ids)];
    const LOT = 900;
    const out: T[] = [];
    for (let i = 0; i < uniques.length; i += LOT) {
      const lot = uniques.slice(i, i + LOT);
      const placeholders = lot.map(() => '?').join(', ');
      out.push(
        ...(this.db
          .prepare(`SELECT ${colonnes} FROM ${table} WHERE ${cle} IN (${placeholders})`)
          .all(...lot) as T[]),
      );
    }
    return out;
  }

  /**
   * Titre et prompt des SEULES tâches demandées. Les phéromones n'ont besoin
   * que des tâches citées par les résultats récents (≤ 500) : un `SELECT *` de
   * toute la table `tasks`, avec un `JSON.parse` par ligne, jetait 99,5 % du
   * travail à 100 000 tâches.
   */
  listTaskTexts(ids: readonly string[]): Array<{ id: string; title: string; prompt: string }> {
    return this.lireParIds<{ id: string; title: string; prompt: string }>('id, title, prompt', ids);
  }

  /**
   * Projet et statut des SEULES tâches demandées — ce que la Balance a besoin
   * de savoir pour imputer les tentatives d'un corpus borné. Lecture par clé
   * primaire (`lireParIds`), jamais un `SELECT *` de `tasks` : c'est exactement
   * le péché de performance que le dépôt a déjà combattu pour `listTaskTexts`.
   */
  listTaskComptes(
    ids: readonly string[],
  ): Array<{ id: string; projectId: string; status: TaskStatus }> {
    return this.lireParIds<{ id: string; projectId: string; status: TaskStatus }>(
      'id, projectId, status',
      ids,
    );
  }

  /** Projet des SEULES tâches citées — le grand livre n'a pas besoin du statut. */
  listTaskProjects(ids: readonly string[]): Array<{ id: string; projectId: string }> {
    return this.lireParIds<{ id: string; projectId: string }>('id, projectId', ids);
  }

  /**
   * Statut des SEULES tâches demandées, indexé par id. Sert la promotion des
   * dépendances : seules les tâches DONT DÉPEND une tâche en attente comptent —
   * pas toute la table.
   */
  taskStatuses(ids: readonly string[]): Map<string, TaskStatus> {
    const rows = this.lireParIds<{ id: string; status: TaskStatus }>('id, status', ids);
    return new Map(rows.map((r) => [r.id, r.status]));
  }

  tasksByStatus(...statuses: TaskStatus[]): Task[] {
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE status IN (${placeholders}) ORDER BY createdAt, id`)
      .all(...statuses) as TaskRow[];
    return rows.map(rowToTask);
  }

  /** Tâches qui citent exactement `taskId` comme dépendance. */
  tasksDependingOn(taskId: string): Task[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t
         WHERE EXISTS (
           SELECT 1 FROM json_each(t.dependsOn) d WHERE d.value = ?
         )
         ORDER BY t.createdAt, t.id`,
      )
      .all(taskId) as TaskRow[];
    return rows.map(rowToTask);
  }

  /** Tâches actives (assigned/running) d'un nœud donné. */
  activeTasksOfNode(nodeId: string): Task[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM tasks WHERE assignedNodeId = ? AND status IN ('assigned', 'running') ORDER BY createdAt, id",
      )
      .all(nodeId) as TaskRow[];
    return rows.map(rowToTask);
  }

  patchTask(id: string, patch: TaskPatch, now = Date.now()): Task | undefined {
    const current = this.getTask(id);
    if (!current) return undefined;
    const next: Task = {
      ...current,
      status: patch.status ?? current.status,
      assignedNodeId:
        patch.assignedNodeId !== undefined ? patch.assignedNodeId : current.assignedNodeId,
      result: patch.result !== undefined ? patch.result : current.result,
      branch: patch.branch !== undefined ? patch.branch : current.branch,
      attempts: patch.attempts ?? current.attempts,
      updatedAt: now,
    };
    this.db
      .prepare(
        'UPDATE tasks SET status = ?, assignedNodeId = ?, result = ?, branch = ?, attempts = ?, updatedAt = ? WHERE id = ?',
      )
      .run(
        next.status,
        next.assignedNodeId,
        next.result ? JSON.stringify(next.result) : null,
        next.branch,
        next.attempts,
        next.updatedAt,
        id,
      );
    return next;
  }

  /**
   * RÉCLAME une tâche pour un nœud : `attendu → assigned`, en UNE instruction
   * conditionnelle. Rend la tâche réclamée, ou `undefined` si elle n'est plus
   * dans le statut où l'appelant l'a lue — introuvable, ou déjà prise.
   *
   * `patchTask` lit PUIS écrit, sans condition : sûr sous une seule Reine,
   * puisque tout y est synchrone, et c'est `verrou-reine.ts` qui garantit
   * qu'il n'y en a qu'une. Ceci est la ceinture sous les bretelles : si deux
   * écrivains partageaient malgré tout la base, le second `UPDATE … WHERE
   * status = ?` ne toucherait aucune ligne au lieu d'écraser l'assignation du
   * premier — et la même tâche partait sur deux nœuds.
   *
   * N'écrit QUE les colonnes de la réclamation : réécrire la ligne entière,
   * comme `patchTask`, reposerait des `attempts` lus avant qu'un autre
   * écrivain ne les change.
   */
  reclamerTache(
    reclamation: {
      taskId: string;
      attendu: Extract<TaskStatus, 'pending' | 'ready'>;
      nodeId: string;
      branch: string | null;
    },
    now = Date.now(),
  ): Task | undefined {
    const { taskId, attendu, nodeId, branch } = reclamation;
    const row = this.db
      .prepare(
        `UPDATE tasks SET status = 'assigned', assignedNodeId = ?, branch = ?, updatedAt = ?
         WHERE id = ? AND status = ? RETURNING *`,
      )
      .get(nodeId, branch, now, taskId, attendu) as TaskRow | undefined;
    return row ? rowToTask(row) : undefined;
  }

  /**
   * Récupération au démarrage : les tâches assigned/running d'un précédent
   * process sont orphelines → elles repartent en ready ; tous les nœuds
   * repartent offline (ils se ré-enregistreront via WebSocket).
   *
   * « D'un précédent process » est une HYPOTHÈSE, et c'est le verrou de la
   * Reine (`verrou-reine.ts`) qui la rend vraie : sans lui, une seconde Reine
   * lancée sur la même base volerait ici les travaux en vol de la première.
   *
   * L'HORLOGE DE L'HÉBERGEUR SE FERME D'ABORD. Au démarrage plus aucune tâche
   * n'est en vol, donc aucune session ne doit rester ouverte : une session
   * ouverte est facturée jusqu'à `now` à chaque lecture, et l'orpheline
   * compterait toute la panne de la Reine comme du temps consommé — de quoi
   * pousser un projet Cloud en « bloqué ». Chaque session se clôt au DERNIER
   * SIGNE DE VIE que la Reine a enregistré pour elle :
   *   - orpheline : le dernier battement de son nœud (ou sa dernière
   *     transition, si elle est plus récente) — jamais l'heure du redémarrage,
   *     qui facturerait la panne ;
   *   - tâche déjà sortie du vol mais dont la session courait encore (Reine
   *     d'avant la fermeture à l'interruption) : sa dernière transition,
   *     l'instant où la session aurait dû se clore.
   * Lu AVANT la requalification, qui réécrit `updatedAt`. Une session dont la
   * tâche a disparu reste à `pruneHorlogeHote`, qui l'efface sans la facturer.
   */
  recoverOrphanTasks(now = Date.now()): Task[] {
    const recuperer = this.db.transaction((): Task[] => {
      const sessions = this.db
        .prepare(
          `SELECT h.taskId, t.status, t.updatedAt, n.lastSeen
             FROM horloge_hote h
             JOIN tasks t ON t.id = h.taskId
             LEFT JOIN nodes n ON n.id = t.assignedNodeId`,
        )
        .all() as Array<{
        taskId: string;
        status: TaskStatus;
        updatedAt: number;
        lastSeen: number | null;
      }>;
      for (const s of sessions) {
        const enVol = s.status === 'assigned' || s.status === 'running';
        const signeDeVie = enVol ? Math.max(s.updatedAt, s.lastSeen ?? 0) : s.updatedAt;
        this.fermerHorlogeHote(s.taskId, Math.min(now, signeDeVie));
      }
      const orphans = this.tasksByStatus('assigned', 'running');
      for (const t of orphans) {
        this.patchTask(t.id, { status: 'ready', assignedNodeId: null }, now);
      }
      this.db.prepare("UPDATE nodes SET status = 'offline'").run();
      return orphans;
    });
    return recuperer();
  }

  // ─── Résultats ─────────────────────────────────────────────────────────────
  /**
   * Ouvre la ligne de dépense d'une tentative d'enfant délégué Hive, à l'envoi
   * au nœud (voir le schéma de `depenses_delegation`). Une tâche sans arête
   * Hive n'a pas d'enveloppe à tenir : rien n'est écrit.
   */
  ouvrirTentativeDelegation(taskId: string, nodeId: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO depenses_delegation (rootTaskId, taskId, nodeId, creeA)
         SELECT rootTaskId, childTaskId, ?, ? FROM task_delegations
          WHERE childTaskId = ? AND origin = 'hive'`,
      )
      .run(nodeId, now, taskId);
  }

  /**
   * Clôt la tentative que ce résultat termine — la dernière ouverte pour ce
   * couple (tâche, nœud) — avec sa dépense déclarée, dans la transaction du
   * résultat. Sans tentative ouverte (résultat rangé hors de l'ordonnanceur),
   * la ligne naît ici, close.
   *
   * Le montant est converti UNE fois, ici, en micro-USD entiers : c'est l'unité
   * du budget (`costMicros`), et une somme d'entiers ne dérive pas comme une
   * somme de flottants. Un coût absent reste NULL — inconnu, jamais zéro.
   */
  private rangerDepenseDelegation(resultId: number, res: TaskResult, now: number): void {
    const coutUsd = res.fournisseur?.coutUsd;
    const coutMicros =
      typeof coutUsd === 'number' && Number.isFinite(coutUsd) && coutUsd >= 0
        ? Math.round(coutUsd * 1_000_000)
        : null;
    const ouverte = this.db
      .prepare(
        `SELECT id FROM depenses_delegation
          WHERE taskId = ? AND nodeId = ? AND resultId IS NULL ORDER BY id DESC LIMIT 1`,
      )
      .get(res.taskId, res.nodeId) as { id: number } | undefined;
    if (ouverte) {
      this.db
        .prepare('UPDATE depenses_delegation SET resultId = ?, coutMicros = ? WHERE id = ?')
        .run(resultId, coutMicros, ouverte.id);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO depenses_delegation (rootTaskId, taskId, nodeId, resultId, coutMicros, creeA)
         SELECT rootTaskId, childTaskId, ?, ?, ?, ? FROM task_delegations
          WHERE childTaskId = ? AND origin = 'hive'`,
      )
      .run(res.nodeId, resultId, coutMicros, now, res.taskId);
  }

  /**
   * Range un résultat et rend son `results.id`. Le retour est ADDITIF (les
   * appelants qui l'ignoraient continuent de compiler) : il sert aux Gardiennes
   * à faire pointer leur verdict sur la production exacte qu'elles ont
   * reniflée, plutôt que sur un couple (taskId, nodeId) qui se répète à chaque
   * tentative.
   */
  insertResult(res: TaskResult, now = Date.now()): number {
    const info = this.db
      .prepare(
        'INSERT INTO results (taskId, nodeId, success, diff, logs, durationMs, subAgents, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        res.taskId,
        res.nodeId,
        res.success ? 1 : 0,
        res.diff.slice(0, LIMITS.diff),
        res.logs.slice(0, LIMITS.log),
        res.durationMs,
        JSON.stringify(res.subAgents.slice(0, LIMITS.subAgents)),
        now,
      );
    const resultId = Number(info.lastInsertRowid);
    this.rangerDepenseDelegation(resultId, res, now);
    // Les colonnes historiques de `results` restent inchangées : la mesure
    // locale est un fait d'exécution borné, rangé dans le journal et relié au
    // résultat exact. Cela évite une migration SQLite tout en permettant sa
    // relecture tant que le résultat reste dans la fenêtre de preuve.
    if (res.usage) {
      this.appendEvent(
        'worker_usage',
        {
          resultId,
          taskId: res.taskId,
          nodeId: res.nodeId,
          ...res.usage,
        },
        now,
      );
    }
    // ─── LE TEXTE FINAL : RANGÉ LÀ OÙ UN LECTEUR DIFFÉRÉ L'ATTEND, PAS AILLEURS ─
    //
    // Même voie que la mesure locale juste au-dessus — le journal, relié au
    // `resultId` exact, sans migration de `results`. Mais PAS pour tous les
    // résultats : chaque texte rangé est une preuve que la rétention garde
    // avec sa tâche (`shared/retention-journal.ts`) et qui pèse sur le plafond
    // du journal, et un succès ordinaire n'a aucun lecteur DIFFÉRÉ de son
    // texte final — la contre-expertise le lit en direct, sur le message.
    //
    // Deux lecteurs le relisent plus tard, et eux seuls justifient la ligne :
    //   · les ÉCHECS — Couveuse, leçons croisées, dérive (`texteDEchec`) ;
    //   · les éclaireuses que le Conseil n'a pas encore dépouillées : il lit
    //     leur réponse au tick suivant, depuis la base.
    // Sa tâche disparue ou close depuis longtemps, le texte n'existe plus : ses
    // lecteurs retombent sur ce qu'ils savent faire sans lui, jamais sur une
    // invention.
    if (res.finalText && (!res.success || this.eclaireuseAttendue(res.taskId))) {
      this.appendEvent(
        'worker_final_text',
        {
          resultId,
          taskId: res.taskId,
          nodeId: res.nodeId,
          finalText: res.finalText.slice(-LIMITS.finalText),
        },
        now,
      );
    }
    // Étape auto : chaque production réussie avec un diff devient une
    // sauvegarde récupérable — même après pruneResults.
    if (res.success && res.diff.trim().length > 0) {
      const tache = this.getTask(res.taskId);
      if (tache) {
        this.creerSauvegarde({
          projectId: tache.projectId,
          resultId,
          taskId: res.taskId,
          label: libelleEtape(tache.title, (fr) => fr),
          kind: 'etape',
          patch: res.diff.slice(0, LIMITS.diff),
          createdAt: now,
        });
      }
    }
    return resultId;
  }

  /** Pose une sauvegarde (étape auto ou geste manuel). */
  creerSauvegarde(input: {
    projectId: string;
    resultId?: number | null;
    taskId?: string | null;
    label: string;
    kind: GenreSauvegarde;
    patch: string;
    createdAt?: number;
  }): Sauvegarde {
    const id = randomUUID();
    const createdAt = input.createdAt ?? Date.now();
    const patch = input.patch.slice(0, LIMITS.diff);
    this.db
      .prepare(
        `INSERT INTO sauvegardes (id, projectId, resultId, taskId, label, kind, patch, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.resultId ?? null,
        input.taskId ?? null,
        input.label.trim().slice(0, 120),
        input.kind,
        patch,
        createdAt,
      );
    return {
      id,
      projectId: input.projectId,
      resultId: input.resultId ?? null,
      taskId: input.taskId ?? null,
      label: input.label.trim().slice(0, 120),
      kind: input.kind,
      patch,
      createdAt,
    };
  }

  listSauvegardes(projectId: string, limit = 50): SauvegardeResume[] {
    const rows = this.db
      .prepare(
        `SELECT id, projectId, resultId, taskId, label, kind, length(patch) AS taille, createdAt
         FROM sauvegardes WHERE projectId = ? ORDER BY createdAt DESC, id DESC LIMIT ?`,
      )
      .all(projectId, Math.min(200, Math.max(1, limit))) as {
      id: string;
      projectId: string;
      resultId: number | null;
      taskId: string | null;
      label: string;
      kind: GenreSauvegarde;
      taille: number;
      createdAt: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      resultId: r.resultId,
      taskId: r.taskId,
      label: r.label,
      kind: r.kind,
      taille: r.taille,
      createdAt: r.createdAt,
    }));
  }

  getSauvegarde(id: string): Sauvegarde | null {
    const r = this.db.prepare('SELECT * FROM sauvegardes WHERE id = ?').get(id) as
      | {
          id: string;
          projectId: string;
          resultId: number | null;
          taskId: string | null;
          label: string;
          kind: GenreSauvegarde;
          patch: string;
          createdAt: number;
        }
      | undefined;
    if (!r) return null;
    return {
      id: r.id,
      projectId: r.projectId,
      resultId: r.resultId,
      taskId: r.taskId,
      label: r.label,
      kind: r.kind,
      patch: r.patch,
      createdAt: r.createdAt,
    };
  }

  /**
   * Ne conserve que les `maxKeep` sauvegardes les plus récentes (toutes
   * projets confondus). Les étapes auto naissent à chaque diff réussi : sans
   * cette borne, la table grandirait avec l'histoire de la ruche.
   */
  pruneSauvegardes(maxKeep: number): number {
    const keep = Math.max(0, maxKeep);
    const info = this.db
      .prepare(
        'DELETE FROM sauvegardes WHERE id NOT IN (SELECT id FROM sauvegardes ORDER BY createdAt DESC, id DESC LIMIT ?)',
      )
      .run(keep);
    return info.changes;
  }

  /**
   * La tâche a-t-elle déjà produit un résultat RETENU (`success = 1`) ? Un
   * résultat retenu l'a menée à `done` — pour un enfant délégué, c'est le
   * résultat terminal que son parent a reçu. Lecture bornée par l'index
   * `idx_results_task`, sans charger ni diff ni logs.
   */
  aUnResultatRetenu(taskId: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM results WHERE taskId = ? AND success = 1 LIMIT 1')
        .get(taskId) !== undefined
    );
  }

  resultsForTask(taskId: string): TaskResult[] {
    const rows = this.db
      .prepare('SELECT * FROM results WHERE taskId = ? ORDER BY id')
      .all(taskId) as ResultRow[];
    const usages = this.usagesForResults(
      taskId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({
      resultId: r.id,
      taskId: r.taskId,
      nodeId: r.nodeId,
      success: r.success === 1,
      diff: r.diff,
      logs: r.logs,
      durationMs: r.durationMs,
      subAgents: JSON.parse(r.subAgents) as SubAgent[],
      ...(usages.get(r.id) ? { usage: usages.get(r.id) } : {}),
    }));
  }

  /**
   * Textes finaux rangés par `insertResult`, relus par `resultId` exact.
   * Seuls les résultats encore dans la fenêtre du journal en ont un.
   */
  textesFinauxPour(resultIds: readonly number[]): Map<number, string> {
    const ids = [...new Set(resultIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT json_extract(payload, '$.resultId') AS resultId,
                json_extract(payload, '$.finalText') AS finalText
           FROM events
          WHERE type = 'worker_final_text'
            AND json_extract(payload, '$.resultId') IN (${placeholders})
          ORDER BY id`,
      )
      .all(...ids) as Array<{ resultId: unknown; finalText: unknown }>;
    const out = new Map<number, string>();
    for (const r of rows) {
      if (typeof r.resultId === 'number' && typeof r.finalText === 'string' && r.finalText !== '') {
        out.set(r.resultId, r.finalText);
      }
    }
    return out;
  }

  /** Vrai si le Conseil attend encore la réponse de cette tâche (éclaireuse). */
  private eclaireuseAttendue(taskId: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM conseil_taches WHERE taskId = ? AND depouille = 0')
        .get(taskId) !== undefined
    );
  }

  /**
   * Mesures reliées aux résultats exacts d'UNE tâche, relues dans le journal —
   * où la rétention les garde avec elle. La tâche nommée sert l'index
   * `idx_events_tache` : sans elle, chaque lecture parcourait les mesures de
   * toute la ruche retenue.
   */
  private usagesForResults(
    taskId: string,
    resultIds: readonly number[],
  ): Map<number, TaskResult['usage']> {
    const ids = [...new Set(resultIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT json_extract(payload, '$.resultId') AS resultId,
                json_extract(payload, '$.userCpuMicros') AS userCpuMicros,
                json_extract(payload, '$.systemCpuMicros') AS systemCpuMicros,
                json_extract(payload, '$.maxRssBytes') AS maxRssBytes,
                json_extract(payload, '$.rssBytes') AS rssBytes,
                json_extract(payload, '$.heapUsedBytes') AS heapUsedBytes
           FROM events
          WHERE type = 'worker_usage'
            AND ${TACHE_DE_L_EVENEMENT} = ?
            AND json_extract(payload, '$.resultId') IN (${placeholders})
          ORDER BY id`,
      )
      .all(taskId, ...ids) as Array<{
      resultId: number | null;
      userCpuMicros: number | null;
      systemCpuMicros: number | null;
      maxRssBytes: number | null;
      rssBytes: number | null;
      heapUsedBytes: number | null;
    }>;
    const out = new Map<number, TaskResult['usage']>();
    for (const row of rows) {
      const resultId = row.resultId;
      const userCpuMicros = row.userCpuMicros;
      const systemCpuMicros = row.systemCpuMicros;
      const maxRssBytes = row.maxRssBytes;
      const rssBytes = row.rssBytes;
      const heapUsedBytes = row.heapUsedBytes;
      if (
        typeof resultId !== 'number' ||
        !Number.isSafeInteger(resultId) ||
        typeof userCpuMicros !== 'number' ||
        typeof systemCpuMicros !== 'number' ||
        typeof maxRssBytes !== 'number' ||
        typeof rssBytes !== 'number' ||
        typeof heapUsedBytes !== 'number' ||
        !Number.isSafeInteger(userCpuMicros) ||
        !Number.isSafeInteger(systemCpuMicros) ||
        !Number.isSafeInteger(maxRssBytes) ||
        !Number.isSafeInteger(rssBytes) ||
        !Number.isSafeInteger(heapUsedBytes) ||
        userCpuMicros < 0 ||
        systemCpuMicros < 0 ||
        maxRssBytes < 0 ||
        rssBytes < 0 ||
        heapUsedBytes < 0
      )
        continue;
      out.set(resultId, {
        userCpuMicros,
        systemCpuMicros,
        maxRssBytes,
        rssBytes,
        heapUsedBytes,
      });
    }
    return out;
  }

  /**
   * Échecs enregistrés pour une tâche, du plus ancien au plus récent, réduits
   * au strict nécessaire de la Couveuse (qui a échoué, quand, avec quels
   * logs). `resultsForTask` existe mais n'expose pas createdAt, dont la
   * Couveuse a besoin pour ordonner les leçons.
   */
  listFailedResultsForTask(
    taskId: string,
  ): Array<{ nodeId: string; logs: string; createdAt: number; finalText?: string }> {
    const rows = this.db
      .prepare(
        'SELECT id, nodeId, logs, createdAt FROM results WHERE taskId = ? AND success = 0 ORDER BY createdAt, id',
      )
      .all(taskId) as Array<{ id: number; nodeId: string; logs: string; createdAt: number }>;
    return avecTexteFinal(rows, this.textesFinauxPour(rows.map((r) => r.id)));
  }

  /**
   * Résultats les plus récents, réduits au strict nécessaire du calcul des
   * phéromones (qui a réussi/échoué quoi, quand). Corpus borné pour garder le
   * repli rapide — au-delà, le signal est de toute façon évaporé (demi-vie).
   */
  listResultsForPheromones(
    limit = 500,
  ): Array<{ taskId: string; nodeId: string; success: boolean; createdAt: number }> {
    // Une ombre n'y dépose rien, ni ses relectures (`TACHES_DU_BANC_SQL`) :
    // les phéromones départagent les nœuds, et le banc ne touche à aucun
    // poids du routing (décision de shadow-bench.ts).
    const rows = this.db
      .prepare(
        `SELECT taskId, nodeId, success, createdAt FROM results
          WHERE taskId NOT IN (SELECT id FROM (${TACHES_DU_BANC_SQL}))
          ORDER BY createdAt DESC, id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 2000))) as {
      taskId: string;
      nodeId: string;
      success: number;
      createdAt: number;
    }[];
    return rows.map((r) => ({
      taskId: r.taskId,
      nodeId: r.nodeId,
      success: r.success === 1,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Lecture INCRÉMENTALE du grand livre de la Balance : les résultats
   * postérieurs au filigrane, par id croissant, plafonnés. En régime établi,
   * renvoie [] au prix d'une seule sonde sur `idx_results_balance`.
   *
   * `INDEXED BY` n'est PAS une coquetterie : plan mesuré sur 5 000 lignes de
   * 10 ko (SQLite 3.53.2), avec `ANALYZE` joué comme sur une base en service.
   *  - sans lui : « SEARCH results USING INTEGER PRIMARY KEY (rowid>?) » — la
   *    LIGNE est ouverte, et `durationMs` étant stocké après `diff` (≤ 1 Mo) et
   *    `logs` (≤ 512 ko), il faut traverser leurs pages de débordement pour
   *    lire un entier ;
   *  - avec lui : « SEARCH results USING COVERING INDEX idx_results_balance
   *    (id>?) » — pas une seule ligne de la table n'est touchée.
   * La conception d'origine pariait sur un « , taskId » redondant dans
   * l'ORDER BY pour faire basculer le planner : la mesure dit que ça ne suffit
   * plus dès que les statistiques existent. Verrouillé par
   * tests/store-scaling.test.ts — si un futur SQLite change encore d'avis, ce
   * test le dira avant la production.
   */
  listResultsForLedger(afterId: number, limit = LOT_GRAND_LIVRE): ResultatBalance[] {
    const rows = this.db
      .prepare(
        `SELECT id, taskId, nodeId, success, durationMs FROM results INDEXED BY idx_results_balance
         WHERE id > ? ORDER BY id LIMIT ?`,
      )
      .all(Math.max(0, afterId), Math.max(1, Math.min(limit, 10_000))) as ResultatRow[];
    return rows.map(rowToResultatBalance);
  }

  /**
   * Corpus BORNÉ de l'imputation : les N résultats les plus récents (id DESC).
   * Plan : « SCAN results USING COVERING INDEX idx_results_balance » — parcours
   * de l'index dans l'ordre voulu, le LIMIT s'arrête au N-ième.
   */
  listResultsForBalance(limit = CORPUS_BALANCE): ResultatBalance[] {
    const rows = this.db
      .prepare(
        `SELECT id, taskId, nodeId, success, durationMs FROM results INDEXED BY idx_results_balance
         ORDER BY id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 10_000))) as ResultatRow[];
    return rows.map(rowToResultatBalance);
  }

  /**
   * Id du dernier résultat d'UNE tâche, `null` sans résultat — sans relire ni
   * diffs ni journaux (`resultsForTask` les déplie tous). Sert la War Room :
   * une contestation porte sur un résultat exact, et un résultat plus récent
   * la rend caduque même quand l'événement du nouvel essai est élagué.
   */
  dernierResultatDe(taskId: string): number | null {
    const row = this.db
      .prepare('SELECT MAX(id) AS id FROM results WHERE taskId = ?')
      .get(taskId) as { id: number | null };
    return row.id;
  }

  /**
   * Les productions RÉUSSIES d'un nœud rendues depuis `depuis`, les plus
   * récentes d'abord, bornées — la matière de la qualité d'un Worker. Plan
   * couvrant sur `idx_results_recent` : ni diff ni journaux ne sont ouverts
   * (même raison que `listResultsForPheromones`).
   */
  productionsDuNoeud(
    nodeId: string,
    depuis: number,
    limite = 100,
  ): Array<{ resultId: number; taskId: string }> {
    const rows = this.db
      .prepare(
        `SELECT id, taskId FROM results INDEXED BY idx_results_recent
          WHERE createdAt >= ? AND nodeId = ? AND success = 1
          ORDER BY createdAt DESC, id DESC LIMIT ?`,
      )
      .all(
        Number.isFinite(depuis) ? depuis : Number.MAX_SAFE_INTEGER,
        nodeId,
        Math.max(1, Math.min(limite, 500)),
      ) as Array<{ id: number; taskId: string }>;
    return rows.map((r) => ({ resultId: r.id, taskId: r.taskId }));
  }

  /** Id du dernier résultat inséré (0 si la table est vide). */
  lastResultId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM results').get() as { id: number | null };
    return row.id ?? 0;
  }

  /**
   * Lit le CACHE du grand livre. `null` — et la table est vidée — dès que le
   * moindre doute existe :
   *  - table vide (premier démarrage, ou cache déjà jeté) ;
   *  - `version` ≠ VERSION_BALANCE : la sémantique de l'imputation a changé ;
   *  - filigranes divergents entre lignes : l'écriture est atomique, donc c'est
   *    une corruption ;
   *  - filigrane au-delà du dernier `results.id` : la base a reculé (restaurée
   *    depuis une sauvegarde partielle) et le cache compte des lignes qui
   *    n'existent plus.
   *
   * Dans tous ces cas, la PROCÉDURE DE RECONSTRUCTION TOTALE est la même et
   * elle est gratuite : repartir du filigrane 0 et relire `results`. C'est ce
   * qui autorise ce cache à exister — il n'a aucun moyen de mentir durablement.
   */
  lireCacheGrandLivre(): {
    filigrane: number;
    soldes: Array<{ projectId: string; depenseMs: number; tentatives: number }>;
  } | null {
    const rows = this.db
      .prepare(
        `SELECT projectId, depenseMs, tentatives, filigrane, version
         FROM balance_ledger_cache ORDER BY projectId`,
      )
      .all() as Array<{
      projectId: string;
      depenseMs: number;
      tentatives: number;
      filigrane: number;
      version: number;
    }>;
    if (rows.length === 0) return null;
    const filigrane = rows[0]?.filigrane ?? 0;
    const douteux =
      rows.some((r) => r.version !== VERSION_BALANCE || r.filigrane !== filigrane) ||
      filigrane > this.lastResultId();
    if (douteux) {
      this.viderCacheGrandLivre();
      return null;
    }
    return {
      filigrane,
      soldes: rows.map((r) => ({
        projectId: r.projectId,
        depenseMs: r.depenseMs,
        tentatives: r.tentatives,
      })),
    };
  }

  /**
   * Réécrit le cache EN ENTIER, dans une seule transaction : soit toutes les
   * lignes portent le même filigrane, soit aucune ne change. Un remplacement
   * total (et non un `UPSERT` ligne à ligne) parce que le cache doit être un
   * instantané cohérent, jamais un mélange de deux passes.
   */
  ecrireCacheGrandLivre(
    filigrane: number,
    soldes: ReadonlyArray<{ projectId: string; depenseMs: number; tentatives: number }>,
  ): void {
    const inserer = this.db.prepare(
      `INSERT INTO balance_ledger_cache (projectId, depenseMs, tentatives, filigrane, version)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM balance_ledger_cache').run();
      for (const s of soldes) {
        inserer.run(
          s.projectId,
          Math.max(0, Math.trunc(s.depenseMs)),
          Math.max(0, Math.trunc(s.tentatives)),
          Math.max(0, Math.trunc(filigrane)),
          VERSION_BALANCE,
        );
      }
    })();
  }

  /** Reconstruction totale : on jette, le rattrapage recomptera depuis `results`. */
  viderCacheGrandLivre(): void {
    this.db.prepare('DELETE FROM balance_ledger_cache').run();
  }

  /**
   * Recalcul À FROID de la dépense par projet (JOIN complet sur results).
   * DIAGNOSTIC ET TESTS UNIQUEMENT : jamais sur le chemin d'un tick, jamais
   * exposé par une route. Sert à prouver l'invariant « incrémental == à froid »
   * du grand livre — le seul usage légitime d'un SELECT non borné ici.
   * `max(durationMs, 0)` : même bornage que le repli en mémoire, sinon les deux
   * chemins divergeraient sur une horloge de nœud en retard.
   */
  depensesParProjet(): Map<string, { depenseMs: number; tentatives: number }> {
    const rows = this.db
      .prepare(
        `SELECT t.projectId AS projectId,
                SUM(max(r.durationMs, 0)) AS depenseMs,
                COUNT(*) AS tentatives
         FROM results r JOIN tasks t ON t.id = r.taskId
         GROUP BY t.projectId`,
      )
      .all() as Array<{ projectId: string; depenseMs: number; tentatives: number }>;
    return new Map(
      rows.map((r) => [r.projectId, { depenseMs: r.depenseMs, tentatives: r.tentatives }]),
    );
  }

  // ─── Budgets : les plafonds posés par des humains (la Balance — borner) ────
  //
  // Aucune de ces trois méthodes n'écrit ni ne lit un CALCUL : elles ne
  // manipulent qu'une intention humaine, un entier et une trace d'opérateur.
  // Le solde, lui, est un cache en mémoire reconstruit depuis `results` — il
  // n'est jamais persisté (doctrine, règle 1).

  /**
   * Pose ou retire le plafond d'un projet. `plafondMs === null` SUPPRIME la
   * ligne : l'absence de ligne est l'état « éteint », pas un drapeau — un
   * projet sans plafond doit être indiscernable, en base comme à l'exécution,
   * d'un projet d'avant la Balance.
   *
   * `definiPar` est une TRACE (qui a serré la vis), jamais une autorisation.
   * Le plafond est borné à 0 : un plafond négatif n'a aucun sens, et la porte
   * doit rester lisible (`0` = « ce projet ne dépense plus rien »).
   */
  // ─── Le Plein Essaim : l'autonomie, posée à la main ────────────────────────
  //
  // Aucune écriture ici ne vient de la ruche : `definiPar` porte QUI a décidé,
  // et ce doit toujours être un humain. Voir la table (store.ts) pour pourquoi
  // elle n'a pas d'élagueur.

  /** Pose (ou retire) le réglage d'autonomie d'un projet. */
  // ─── La Dérive : de quoi mesurer une dégradation lente ─────────────────────

  /**
   * Productions récentes, jointes à leur verdict de Gardienne.
   *
   * BORNÉ par `limit`, et servi par un parcours arrière de clé primaire. La
   * jointure est sur `gardiennes.resultId`, indexé : une production sans
   * inspection (mode « off », ou echec declare) sort avec le verdict « clean »
   * et un diff vide, donc n'influence ni la qualite ni l'entropie.
   *
   * Les lignes retenues portent le DIFF, dont on ne garde que le compte de
   * lignes — jamais le contenu. `pruneResults` vide `diff` au-dela de 5 000
   * resultats : les productions anciennes comptent alors 0/0, ce qui les sort
   * de la mesure d'entropie au lieu de la fausser.
   */
  listProductionsPourDerive(limit = 400): Array<{
    verdict: string;
    diff: string;
    logs: string;
    success: boolean;
    createdAt: number;
    finalText?: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT r.id AS id, COALESCE(g.verdict, 'clean') AS verdict, r.diff AS diff,
                r.logs AS logs, r.success AS success, r.createdAt AS createdAt
           FROM results r
           LEFT JOIN gardiennes g ON g.resultId = r.id
          ORDER BY r.id DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => {
        const r = row as {
          id: number;
          verdict: string;
          diff: string | null;
          logs: string | null;
          success: number;
          createdAt: number;
        };
        return {
          id: r.id,
          verdict: r.verdict,
          diff: r.diff ?? '',
          logs: r.logs ?? '',
          success: r.success === 1,
          createdAt: r.createdAt,
        };
      });
    // Seuls les échecs ont une signature, donc un texte final à relire.
    const echecs = rows.filter((r) => !r.success).map((r) => r.id);
    return avecTexteFinal(rows, this.textesFinauxPour(echecs));
  }

  /**
   * Horodatage du dernier APPORT HUMAIN — la seule chose qui remette à zéro la
   * solitude de la ruche.
   *
   * Un apport humain est un geste qu'aucun agent ne peut poser : creer un
   * projet, poser un plafond, regler l'autonomie. Deliberement PAS « une tache
   * creee », qui peut venir de la ruche elle-meme — sinon une ruche autonome
   * remettrait sa propre solitude a zero a chaque cycle, et l'indicateur ne
   * mesurerait plus rien.
   */
  dernierApportHumain(): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(t) AS t FROM (
           SELECT MAX(createdAt) AS t FROM projects
           UNION ALL SELECT MAX(updatedAt) FROM budgets
           UNION ALL SELECT MAX(updatedAt) FROM essaim
         )`,
      )
      .get() as { t: number | null } | undefined;
    return row?.t ?? null;
  }

  // ─── Les abonnements : un droit, jamais un moyen de paiement ───────────────

  /** Range l'etat d'un abonnement. Aucun champ ne porte de donnee de carte. */
  // ─── Les roles : qui administre la ruche ───────────────────────────────────

  /** Nombre de comptes. Sert a decider si le prochain cree sera admin. */
  countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n;
  }

  /** Nombre d'administrateurs. Sert a refuser le retrait du dernier. */
  countAdmins(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role = 'admin'")
      .get() as { n: number };
    return row.n;
  }

  /**
   * Role d'un compte. « membre » par defaut : un compte sans ligne de role est
   * un compte SANS privilege, jamais l'inverse.
   */
  getRole(userId: string): string {
    const row = this.db.prepare('SELECT role FROM user_roles WHERE userId = ?').get(userId) as
      { role: string } | undefined;
    return row?.role ?? 'membre';
  }

  /** Pose le role d'un compte. `posePar` garde qui a decide. */
  setRole(userId: string, role: string, posePar: string | null = null, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO user_roles (userId, role, poseA, posePar) VALUES (?, ?, ?, ?)
         ON CONFLICT(userId) DO UPDATE SET role = excluded.role, poseA = excluded.poseA, posePar = excluded.posePar`,
      )
      .run(userId, role, now, posePar);
  }

  /** Tous les comptes avec leur role, pour l'administration. Sans le hash. */
  listUsersWithRoles(): Array<{
    id: string;
    email: string;
    displayName: string;
    role: string;
    createdAt: number;
  }> {
    return this.db
      .prepare(
        `SELECT u.id AS id, u.email AS email, u.displayName AS displayName,
                COALESCE(r.role, 'membre') AS role, u.createdAt AS createdAt
           FROM users u LEFT JOIN user_roles r ON r.userId = u.id
          ORDER BY u.createdAt ASC`,
      )
      .all() as Array<{
      id: string;
      email: string;
      displayName: string;
      role: string;
      createdAt: number;
    }>;
  }

  // ─── Les serveurs provisionnes ─────────────────────────────────────────────

  /** Range (ou met a jour) un serveur. */
  setServeur(v: {
    id: string;
    projectId: string;
    refAbonnement: string;
    etat: string;
    fournisseur: string;
    refMachine: string;
    gabarit: string;
    motif: string;
    creeA: number;
    majA: number;
    arreteA: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO serveurs (id, projectId, refAbonnement, etat, fournisseur, refMachine, gabarit, motif, version, creeA, majA, arreteA)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           etat = excluded.etat, fournisseur = excluded.fournisseur,
           refMachine = excluded.refMachine, gabarit = excluded.gabarit,
           motif = excluded.motif, majA = excluded.majA, arreteA = excluded.arreteA`,
      )
      .run(
        v.id,
        v.projectId,
        v.refAbonnement,
        v.etat,
        v.fournisseur,
        v.refMachine,
        v.gabarit,
        v.motif,
        v.creeA,
        v.majA,
        v.arreteA,
      );
  }

  /** Tous les serveurs, ou ceux d'un abonnement. Ordre stable. */
  listServeurs(refAbonnement?: string): Array<{
    id: string;
    projectId: string;
    refAbonnement: string;
    etat: string;
    fournisseur: string;
    refMachine: string;
    gabarit: string;
    motif: string;
    creeA: number;
    majA: number;
    arreteA: number;
  }> {
    const sql =
      `SELECT id, projectId, refAbonnement, etat, fournisseur, refMachine, gabarit, motif, creeA, majA, arreteA
         FROM serveurs` +
      (refAbonnement ? ' WHERE refAbonnement = ?' : '') +
      ' ORDER BY creeA ASC, id ASC';
    const q = this.db.prepare(sql);
    return (refAbonnement ? q.all(refAbonnement) : q.all()) as ReturnType<
      HiveStore['listServeurs']
    >;
  }

  getServeur(id: string): ReturnType<HiveStore['listServeurs']>[number] | null {
    const row = this.db
      .prepare(
        `SELECT id, projectId, refAbonnement, etat, fournisseur, refMachine, gabarit, motif, creeA, majA, arreteA
           FROM serveurs WHERE id = ?`,
      )
      .get(id);
    return (row as ReturnType<HiveStore['listServeurs']>[number]) ?? null;
  }

  /**
   * Elague les serveurs SUPPRIMES au-dela de `maxKeep`.
   *
   * Ne touche JAMAIS une ligne dans un autre etat : elaguer une machine encore
   * allumee perdrait la seule trace de ce qu'on paie, et plus personne ne
   * saurait l'eteindre.
   */
  pruneServeurs(maxKeep: number): number {
    return this.db
      .prepare(
        `DELETE FROM serveurs WHERE etat = 'supprime' AND id NOT IN (
           SELECT id FROM serveurs WHERE etat = 'supprime' ORDER BY majA DESC, id DESC LIMIT ?
         )`,
      )
      .run(maxKeep).changes;
  }

  // ─── Horloge de l'hébergeur : le temps que L'AGENT ne déclare pas ──────────

  /** Ouvre une session. Idempotente : une session déjà ouverte pour la tâche est ignorée. */
  ouvrirHorlogeHote(projectId: string, taskId: string, startedAt: number): void {
    const s = ouvrirSession(projectId, taskId, startedAt);
    this.db
      .prepare(
        `INSERT INTO horloge_hote (taskId, projectId, startedAt, source) VALUES (?, ?, ?, ?)
         ON CONFLICT(taskId) DO NOTHING`,
      )
      .run(s.taskId, s.projectId, s.startedAt, 'hote');
  }

  /**
   * Clôt la session : ajoute sa durée au solde du projet, puis l'efface.
   *
   * Un arrêt daté AVANT le départ (horloge murale qui recule, dernier battement
   * d'un nœud antérieur à l'assignation) clôt au départ : zéro facturé. Le
   * refuser laissait la session OUVERTE, et `depenseHorlogeHote` la comptait
   * jusqu'à `now` à chaque lecture — une durée négative évitée contre une
   * facture sans fin. `fermerSession` garde son refus pour qui l'appelle nu.
   */
  fermerHorlogeHote(taskId: string, stoppedAt: number): boolean {
    const row = this.db
      .prepare('SELECT taskId, projectId, startedAt FROM horloge_hote WHERE taskId = ?')
      .get(taskId) as { taskId: string; projectId: string; startedAt: number } | undefined;
    if (!row) return false;
    const close = fermerSession(
      {
        id: 0,
        projectId: row.projectId,
        taskId: row.taskId,
        startedAt: row.startedAt,
        stoppedAt: null,
      },
      Math.max(stoppedAt, row.startedAt),
    );
    if (!close || close.stoppedAt === null) return false;
    const ajoute = close.stoppedAt - close.startedAt;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO horloge_soldes (projectId, depenseMs, version, majA) VALUES (?, ?, 1, ?)
           ON CONFLICT(projectId) DO UPDATE SET
             depenseMs = depenseMs + excluded.depenseMs,
             majA = excluded.majA`,
        )
        .run(row.projectId, ajoute, close.stoppedAt);
      this.db.prepare('DELETE FROM horloge_hote WHERE taskId = ?').run(taskId);
    });
    tx();
    return true;
  }

  /** Dépense facturable : solde clos + sessions encore ouvertes, à `now`. */
  depenseHorlogeHote(projectId: string, now: number): number {
    const solde = this.db
      .prepare('SELECT depenseMs FROM horloge_soldes WHERE projectId = ?')
      .get(projectId) as { depenseMs: number } | undefined;
    const ouvertes = this.db
      .prepare('SELECT taskId, projectId, startedAt FROM horloge_hote WHERE projectId = ?')
      .all(projectId) as Array<{ taskId: string; projectId: string; startedAt: number }>;
    const sessions: SessionHote[] = ouvertes.map((r) => ({
      id: 0,
      projectId: r.projectId,
      taskId: r.taskId,
      startedAt: r.startedAt,
      stoppedAt: null,
    }));
    return (solde?.depenseMs ?? 0) + depenseHote(sessions, now);
  }

  /**
   * Sessions ouvertes dont la tâche a disparu. Borne référentielle, câblée
   * APRÈS pruneTasks : une session orpheline n'est plus facturable.
   */
  pruneHorlogeHote(): number {
    return this.db
      .prepare('DELETE FROM horloge_hote WHERE taskId NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  setAbonnement(a: {
    projectId: string;
    plan: string;
    etat: string;
    refExterne: string;
    finPeriode: number | null;
    impayeDepuis: number | null;
    majA: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO abonnements (projectId, plan, etat, refExterne, finPeriode, impayeDepuis, version, majA)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(projectId) DO UPDATE SET
           plan = excluded.plan,
           etat = excluded.etat,
           refExterne = excluded.refExterne,
           finPeriode = excluded.finPeriode,
           impayeDepuis = excluded.impayeDepuis,
           majA = excluded.majA`,
      )
      .run(a.projectId, a.plan, a.etat, a.refExterne, a.finPeriode, a.impayeDepuis, a.majA);
  }

  /** Abonnement d'un projet. `null` s'il n'en a aucun. */
  getAbonnement(projectId: string): {
    projectId: string;
    plan: string;
    etat: string;
    refExterne: string;
    finPeriode: number | null;
    impayeDepuis: number | null;
    majA: number;
  } | null {
    const row = this.db
      .prepare(
        `SELECT projectId, plan, etat, refExterne, finPeriode, impayeDepuis, majA
           FROM abonnements WHERE projectId = ?`,
      )
      .get(projectId);
    return (row as ReturnType<HiveStore['getAbonnement']>) ?? null;
  }

  setEssaim(
    projectId: string,
    reglage: { niveau: string; depotInscrit: boolean } | null,
    definiPar: string | null = null,
    now = Date.now(),
  ): void {
    if (reglage === null) {
      this.db.prepare('DELETE FROM essaim WHERE projectId = ?').run(projectId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO essaim (projectId, niveau, depotInscrit, version, definiPar, updatedAt)
         VALUES (?, ?, ?, 1, ?, ?)
         ON CONFLICT(projectId) DO UPDATE SET
           niveau = excluded.niveau,
           depotInscrit = excluded.depotInscrit,
           definiPar = excluded.definiPar,
           updatedAt = excluded.updatedAt`,
      )
      .run(projectId, reglage.niveau, reglage.depotInscrit ? 1 : 0, definiPar, now);
  }

  /**
   * Projets dont l'autonomie n'est PAS éteinte, triés — le runner d'essaim les
   * parcourt dans cet ordre, et un ordre instable rendrait son choix de projet
   * imprévisible d'un tick à l'autre.
   *
   * BORNÉ PAR CONSTRUCTION : `essaim` est 1:1 avec `projects`, donc cette
   * lecture ne croît pas avec l'histoire de la ruche. Même justification que
   * `listBudgets` pour un `SELECT` sans `LIMIT`.
   */
  listProjetsAutonomes(): string[] {
    return (
      this.db
        .prepare(`SELECT projectId FROM essaim WHERE niveau <> 'off' ORDER BY projectId`)
        .all() as Array<{ projectId: string }>
    ).map((r) => r.projectId);
  }

  /** Réglage d'autonomie d'un projet. `null` si aucun — donc `off`. */
  getEssaim(projectId: string): {
    projectId: string;
    niveau: string;
    depotInscrit: boolean;
    definiPar: string | null;
    updatedAt: number;
  } | null {
    const row = this.db
      .prepare(
        'SELECT projectId, niveau, depotInscrit, definiPar, updatedAt FROM essaim WHERE projectId = ?',
      )
      .get(projectId) as
      | {
          projectId: string;
          niveau: string;
          depotInscrit: number;
          definiPar: string | null;
          updatedAt: number;
        }
      | undefined;
    if (!row) return null;
    return { ...row, depotInscrit: row.depotInscrit === 1 };
  }

  /**
   * Pose (ou retire) le CONSENTEMENT Garde-Fous d'un projet — l'opt-in et les
   * bornes {min, max} de l'échelle dans lesquelles l'agent aura le droit d'élire.
   * `null` supprime la ligne : le projet redevient inactif, l'agent n'existe
   * plus pour lui. Motif `setEssaim` — INSERT … ON CONFLICT DO UPDATE, une
   * intention humaine écrasée en place, jamais un calcul de la ruche.
   *
   * Les bornes sont typées `Echelon` À L'ÉCRITURE : seul un échelon valide entre.
   * Ce qui les RANGE et ce qui les ÉLIT sont deux mains différentes — la ruche
   * lit, l'humain écrit.
   */
  setGardeFou(
    projectId: string,
    reglage: { actif: boolean; borneMin: Echelon; borneMax: Echelon } | null,
    definiPar: string | null = null,
    now = Date.now(),
  ): void {
    if (reglage === null) {
      this.db.prepare('DELETE FROM garde_fous WHERE projectId = ?').run(projectId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO garde_fous (projectId, actif, borneMin, borneMax, version, definiPar, updatedAt)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(projectId) DO UPDATE SET
           actif = excluded.actif,
           borneMin = excluded.borneMin,
           borneMax = excluded.borneMax,
           definiPar = excluded.definiPar,
           updatedAt = excluded.updatedAt`,
      )
      .run(projectId, reglage.actif ? 1 : 0, reglage.borneMin, reglage.borneMax, definiPar, now);
  }

  /**
   * Le consentement Garde-Fous d'un projet. `null` si aucune ligne — donc
   * INACTIF par absence (l'opt-in demandé : pas de ligne ⇒ l'agent n'existe pas).
   * Les bornes reviennent en TEXTE BRUT : les valider et les normaliser
   * (`normaliserBornes`, `echelonsPermis`) est le geste du module, pas du store.
   */
  getGardeFou(projectId: string): {
    projectId: string;
    actif: boolean;
    borneMin: string;
    borneMax: string;
    definiPar: string | null;
    updatedAt: number;
  } | null {
    const row = this.db
      .prepare(
        'SELECT projectId, actif, borneMin, borneMax, definiPar, updatedAt FROM garde_fous WHERE projectId = ?',
      )
      .get(projectId) as
      | {
          projectId: string;
          actif: number;
          borneMin: string;
          borneMax: string;
          definiPar: string | null;
          updatedAt: number;
        }
      | undefined;
    if (!row) return null;
    return { ...row, actif: row.actif === 1 };
  }

  /**
   * Projets où l'Agent Garde-Fous est ACTIF, triés — l'ordre stable évite qu'un
   * parcours change de projet d'un tick à l'autre (motif `listProjetsAutonomes`).
   *
   * BORNÉ PAR CONSTRUCTION : `garde_fous` est 1:1 avec `projects`, donc cette
   * lecture ne croît pas avec l'histoire de la ruche — un `SELECT` sans `LIMIT`
   * s'y justifie comme pour `listBudgets` et `listProjetsAutonomes`.
   */
  listProjetsGardeFou(): string[] {
    return (
      this.db
        .prepare(`SELECT projectId FROM garde_fous WHERE actif = 1 ORDER BY projectId`)
        .all() as Array<{ projectId: string }>
    ).map((r) => r.projectId);
  }

  /**
   * Échecs récents, tous projets et tous nœuds confondus — la matière des
   * leçons croisées.
   *
   * BORNÉ par `limit` et servi par l'index couvrant existant : c'est un
   * parcours arrière de clé primaire, pas un dépliage de `results`.
   */
  listRecentFailures(limit = 300): Array<{
    nodeId: string;
    taskId: string;
    logs: string;
    createdAt: number;
    finalText?: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id, nodeId, taskId, logs, createdAt FROM results
         WHERE success = 0 AND taskId NOT IN (SELECT tacheOmbre FROM taches_ombre)
         ORDER BY id DESC LIMIT ?`,
      )
      .all(limit) as Array<{
      id: number;
      nodeId: string;
      taskId: string;
      logs: string;
      createdAt: number;
    }>;
    return avecTexteFinal(rows, this.textesFinauxPour(rows.map((r) => r.id)));
  }

  setBudget(
    projectId: string,
    plafondMs: number | null,
    definiPar: string | null = null,
    now = Date.now(),
  ): void {
    if (plafondMs === null) {
      this.db.prepare('DELETE FROM budgets WHERE projectId = ?').run(projectId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO budgets (projectId, plafondMs, version, definiPar, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(projectId) DO UPDATE SET
           plafondMs = excluded.plafondMs,
           version   = excluded.version,
           definiPar = excluded.definiPar,
           updatedAt = excluded.updatedAt`,
      )
      .run(projectId, Math.max(0, Math.trunc(plafondMs)), VERSION_BALANCE, definiPar, now);
  }

  /** Plafond d'un projet, ou `null` s'il n'en a pas. Lecture par clé primaire. */
  getBudget(projectId: string): Budget | null {
    const row = this.db
      .prepare(
        'SELECT projectId, plafondMs, version, definiPar, updatedAt FROM budgets WHERE projectId = ?',
      )
      .get(projectId) as Budget | undefined;
    return row ?? null;
  }

  /**
   * Tous les plafonds en vigueur, triés par projet (ordre stable, comme partout
   * dans le dépôt). BORNÉ PAR CONSTRUCTION : `budgets` est 1:1 avec `projects`,
   * donc cette lecture ne peut pas croître avec l'histoire de la ruche — c'est
   * ce qui autorise un `SELECT` sans `LIMIT` ici, et nulle part ailleurs sur le
   * chemin du tick. Le Scheduler la mémoïse en plus, et ne la relit qu'après un
   * geste humain.
   */
  listBudgets(): Budget[] {
    return this.db
      .prepare(
        'SELECT projectId, plafondMs, version, definiPar, updatedAt FROM budgets ORDER BY projectId',
      )
      .all() as Budget[];
  }

  /** Nombre de résultats stockés. */
  countResults(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM results').get() as { n: number };
    return row.n;
  }

  /**
   * Élagage des résultats, symétrique de `pruneEvents` / `pruneMemories` — mais
   * qui ALLÈGE au lieu de supprimer : au-delà des `maxKeep` résultats les plus
   * récents, seules les colonnes lourdes (`diff` ≤ 1 Mo, `logs` ≤ 512 ko) sont
   * vidées ; la ligne survit.
   *
   * Pourquoi ne pas supprimer la ligne : `results` est la seule trace durable de
   * QUI a fait QUOI. La Miellerie (revue humaine) et le Parlement lisent
   * `resultsForTask`, les phéromones agrègent (taskId, nodeId, success,
   * createdAt) — supprimer les lignes effacerait l'affinité apprise et
   * l'historique de revue d'une tâche ancienne mais encore ouverte. Or 99,9 %
   * du volume vit dans `diff` et `logs` : une ligne allégée pèse ~100 octets.
   *
   * Rétention retenue : RESULT_RETENTION = 5 000, alignée sur EVENT_RETENTION —
   * les deux décrivent la même histoire récente, et 5 000 résultats couvrent
   * dix fois le corpus des phéromones (500) comme l'arriéré de revue plausible.
   *
   * Coût borné : un filigrane en mémoire (`dernierResultatAllege`) fait que
   * chaque passe ne traite que les résultats FRAÎCHEMENT sortis de la fenêtre —
   * en régime établi, zéro ligne réécrite, une seule sonde sur l'index de clé
   * primaire (~0,6 ms). Et la passe est plafonnée à LOT_ALLEGEMENT lignes : un
   * arriéré hérité (une base de plusieurs Go ouverte pour la première fois par
   * cette version) est rattrapé en quelques ticks au lieu de figer le premier.
   * Retourne le nombre de résultats allégés.
   */
  pruneResults(maxKeep: number): number {
    const keep = Math.max(0, maxKeep);
    // Id du PLUS RÉCENT résultat à ALLÉGER : le parcours arrière du rowid saute
    // les `keep` résultats conservés intacts et rend le suivant — qui est donc
    // le premier hors fenêtre, et il est bien vidé (`id <= borne` ci-dessous).
    const seuil = this.db
      .prepare('SELECT id FROM results ORDER BY id DESC LIMIT 1 OFFSET ?')
      .get(keep) as { id: number } | undefined;
    if (!seuil || seuil.id <= this.dernierResultatAllege) return 0;
    const borne = Math.min(seuil.id, this.dernierResultatAllege + LOT_ALLEGEMENT);
    const info = this.db
      .prepare("UPDATE results SET diff = '', logs = '' WHERE id > ? AND id <= ?")
      .run(this.dernierResultatAllege, borne);
    this.dernierResultatAllege = borne;
    return info.changes;
  }

  // ─── Les Gardiennes : le contrôle d'entrée du nectar ───────────────────────
  //
  // Aucune de ces méthodes ne CALCULE quoi que ce soit : le verdict est produit
  // par le module pur `gardiennes.ts` au moment de la réception du résultat, et
  // seulement rangé ici. Ce qui est écrit n'est pas une vue dérivée mais un
  // FAIT DATÉ, irrécupérable après l'élagage de `results` — voir le commentaire
  // de la table, dans le SCHEMA.

  /**
   * Range le verdict d'une production, tel qu'il a été rendu à la RÉCEPTION.
   * Jamais appelée en mode `off` : dans ce mode, rien n'est ni lu ni écrit, et
   * la ruche est indiscernable de celle d'avant les Gardiennes.
   */
  enregistrerInspection(
    entree: Omit<LigneGardienne, 'id' | 'createdAt'>,
    now = Date.now(),
  ): number {
    const info = this.db
      .prepare(
        `INSERT INTO gardiennes (resultId, taskId, nodeId, verdict, score, applique, griefs, version, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        Math.max(0, Math.trunc(entree.resultId)),
        entree.taskId,
        entree.nodeId,
        entree.verdict,
        Math.max(0, Math.trunc(entree.score)),
        entree.applique ? 1 : 0,
        JSON.stringify(entree.griefs),
        VERSION_GARDIENNES,
        now,
      );
    return Number(info.lastInsertRowid);
  }

  /**
   * Les N inspections les plus récentes (id décroissant), corpus BORNÉ — c'est
   * la seule lecture de cette table, et elle sert une vue d'affichage, jamais
   * une décision. Plan : parcours ARRIÈRE de la clé primaire, arrêté par le
   * LIMIT ; aucun tri temporaire (verrouillé par tests/store-scaling.test.ts).
   *
   * Un `griefs` illisible (ligne écrite par une version future, base bricolée à
   * la main) rend une liste VIDE plutôt qu'une exception : une page de lecture
   * ne doit pas tomber parce qu'une ligne sur mille est étrange.
   */
  listInspections(limit = CORPUS_GARDIENNES): LigneGardienne[] {
    const rows = this.db
      .prepare(
        `SELECT id, resultId, taskId, nodeId, verdict, score, applique, griefs, createdAt
         FROM gardiennes ORDER BY id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 2_000))) as Array<{
      id: number;
      resultId: number;
      taskId: string;
      nodeId: string;
      verdict: Verdict;
      score: number;
      applique: number;
      griefs: string;
      createdAt: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      resultId: r.resultId,
      taskId: r.taskId,
      nodeId: r.nodeId,
      verdict: r.verdict,
      score: r.score,
      applique: r.applique === 1,
      griefs: lireGriefs(r.griefs),
      createdAt: r.createdAt,
    }));
  }

  /** Nombre d'inspections rangées. */
  countInspections(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM gardiennes').get() as { n: number };
    return row.n;
  }

  /**
   * Ne conserve que les `maxKeep` inspections les plus récentes (par id) —
   * BORNE D'ÉLAGAGE de la table, livrée dans le même commit qu'elle (doctrine,
   * règle 3). Les N plus récentes par id, comme le journal l'était avant sa
   * rétention par tâche, et pour la même raison : cette table croît avec
   * l'histoire de la ruche.
   *
   * Elle SUPPRIME au lieu d'alléger, contrairement à `pruneResults` : une ligne
   * de garde privée de ses griefs ne dit plus rien du tout (un verdict sans son
   * motif n'est pas une trace, c'est une accusation), et elle ne sert aucune
   * autre lecture — ni la Miellerie, ni le Parlement, ni les phéromones.
   */
  pruneGardiennes(maxKeep: number): number {
    const dernier = this.db.prepare('SELECT MAX(id) AS id FROM gardiennes').get() as {
      id: number | null;
    };
    const cutoff = (dernier.id ?? 0) - Math.max(0, maxKeep);
    if (cutoff <= 0) return 0;
    return this.db.prepare('DELETE FROM gardiennes WHERE id <= ?').run(cutoff).changes;
  }

  // ─── D'où vient une tâche : l'issue qui l'a demandée ───────────────────────

  /** Rattache une tâche à l'issue qui l'a demandée. Idempotent. */
  lierTacheIssue(lien: {
    taskId: string;
    projectId: string;
    depot: string;
    numero: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO taches_issue (taskId, projectId, depot, numero, creeA) VALUES (?, ?, ?, ?, ?)',
      )
      .run(lien.taskId, lien.projectId, lien.depot, lien.numero, lien.now ?? Date.now());
  }

  /** L'issue d'une tâche, ou `null` si elle ne vient pas d'une issue. */
  issueDeTache(taskId: string): { depot: string; numero: number } | null {
    const l = this.db
      .prepare('SELECT depot, numero FROM taches_issue WHERE taskId = ?')
      .get(taskId) as { depot: string; numero: number } | undefined;
    return l ?? null;
  }

  /**
   * Élague les liens dont la tâche n'existe plus.
   *
   * ─── ELLE A ÉTÉ UN NO-OP PENDANT DES MOIS, ET ON SAIT POURQUOI ─────────────
   *
   * Cette borne est RÉFÉRENTIELLE plutôt que temporelle : un lien sans sa tâche
   * ne désigne plus rien. Le raisonnement d'origine tenait à une prémisse —
   * « les tâches ont déjà leur propre élagage » — qui était **fausse**. `tasks`
   * a longtemps été la seule table du dépôt sans élagueur.
   *
   * Mesuré à l'époque, plutôt que déduit : sur 2 000 tâches et autant de liens,
   *
   *     pruneTachesIssue()      supprime : 0
   *     pruneContreExpertises() supprime : 0
   *     tâches après élagage    : 2 000
   *
   * Aucune tâche ne disparaissant jamais, aucun lien n'était jamais orphelin.
   *
   * ─── LE LOT 17 L'A RENDUE VRAIE ────────────────────────────────────────────
   *
   * `pruneTasks` existe désormais, et le tick l'appelle **avant** celle-ci —
   * l'ordre compte, puisqu'une borne référentielle ne voit que ce qui est déjà
   * orphelin. La prémisse d'origine est enfin exacte ; elle ne l'était pas
   * quand on s'en est servi pour décider.
   *
   * Voir `docs/ETAPES.md`, lot 17.
   */
  pruneTachesIssue(): number {
    return this.db
      .prepare('DELETE FROM taches_issue WHERE taskId NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  // ─── La contre-expertise ───────────────────────────────────────────────────

  /** Inscrit une tâche de relecture et ce qu'elle juge. */
  inscrireRelecture(lien: {
    relectureTaskId: string;
    productionTaskId: string;
    relecteurNodeId: string;
    relecteurAgent: string;
    producteurAgent: string;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO contre_expertises
           (relectureTaskId, productionTaskId, relecteurNodeId, relecteurAgent, producteurAgent, creeA)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lien.relectureTaskId,
        lien.productionTaskId,
        lien.relecteurNodeId,
        lien.relecteurAgent,
        lien.producteurAgent,
        lien.now ?? Date.now(),
      );
  }

  /**
   * Cette tâche est-elle une RELECTURE ? `null` si c'est une production.
   *
   * C'est la question qui coupe la régression infinie : le résultat d'une
   * relecture ne doit jamais repartir en contre-expertise.
   */
  relectureDe(relectureTaskId: string): {
    productionTaskId: string;
    relecteurNodeId: string;
    relecteurAgent: string;
    producteurAgent: string;
  } | null {
    const l = this.db
      .prepare(
        `SELECT productionTaskId, relecteurNodeId, relecteurAgent, producteurAgent
           FROM contre_expertises WHERE relectureTaskId = ?`,
      )
      .get(relectureTaskId) as
      | {
          productionTaskId: string;
          relecteurNodeId: string;
          relecteurAgent: string;
          producteurAgent: string;
        }
      | undefined;
    return l ?? null;
  }

  /** Les relectures lancées sur une production (pour agréger les avis). */
  relecturesDeProduction(productionTaskId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT relectureTaskId FROM contre_expertises WHERE productionTaskId = ? ORDER BY relectureTaskId',
        )
        .all(productionTaskId) as { relectureTaskId: string }[]
    ).map((r) => r.relectureTaskId);
  }

  /**
   * Élague les liens dont l'une des deux tâches n'existe plus.
   *
   * Même borne RÉFÉRENTIELLE que `pruneTachesIssue`, et même histoire : un
   * NO-OP tant que `tasks` n'a pas eu d'élagueur. La justification d'origine
   * (« les tâches ont déjà leur propre élagage ») était fausse aux deux
   * endroits, recopiée d'un bloc à l'autre — et le fait qu'elle ait été
   * RECOPIÉE est ce qui l'a rendue crédible.
   *
   * `pruneTasks` (lot 17) l'a rendue vraie. Voir la docstring de
   * `pruneTachesIssue` pour la mesure, et `docs/ETAPES.md` lot 17.
   */
  /**
   * Range ce qu'une contre-visite a décidé d'une production.
   *
   * `INSERT OR REPLACE` : plusieurs relectures peuvent revenir sur la même
   * production, et c'est la DERNIÈRE qui vaut. Ce n'est pas un vote — la règle
   * du module est déjà « une objection trouvée par un seul modèle reste une
   * objection », et le tri se fait en amont, dans `agreger`.
   */
  enregistrerContreVisite(v: {
    productionTaskId: string;
    suite: 'appliquer' | 'ameliorer' | 'refaire';
    raison: string;
    visiteurNodeId: string;
    visiteurAgent: string;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO contre_visites
           (productionTaskId, suite, raison, visiteurNodeId, visiteurAgent, renduA)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        v.productionTaskId,
        v.suite,
        v.raison.slice(0, 400),
        v.visiteurNodeId,
        v.visiteurAgent,
        v.now ?? Date.now(),
      );
  }

  /** Ce qu'une contre-visite a décidé, ou `null` si aucune n'est revenue. */
  contreVisiteDe(productionTaskId: string): {
    suite: 'appliquer' | 'ameliorer' | 'refaire';
    raison: string;
    visiteurNodeId: string;
    visiteurAgent: string;
  } | null {
    const r = this.db
      .prepare(
        `SELECT suite, raison, visiteurNodeId, visiteurAgent
           FROM contre_visites WHERE productionTaskId = ?`,
      )
      .get(productionTaskId) as
      | {
          suite: 'appliquer' | 'ameliorer' | 'refaire';
          raison: string;
          visiteurNodeId: string;
          visiteurAgent: string;
        }
      | undefined;
    return r ?? null;
  }

  /**
   * Élague les décisions dont la production n'existe plus.
   *
   * Même borne RÉFÉRENTIELLE que ses deux voisines — mais celle-ci naît VRAIE :
   * `pruneTasks` existe depuis le lot 17, donc des productions disparaissent
   * pour de bon et cette borne a quelque chose à faire dès le premier jour.
   */
  pruneContreVisites(): number {
    return this.db
      .prepare('DELETE FROM contre_visites WHERE productionTaskId NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  /**
   * Range le modèle choisi pour produire une tâche (l'Aiguillage appris).
   *
   * `INSERT OR REPLACE` : une ré-assignation écrase — la dernière assignation
   * est celle dont on lira le verdict, et `contre_visites` fait exactement le
   * même choix (dernière relecture gagne).
   */
  poserModeleAiguillage(
    taskId: string,
    modele: string,
    now = Date.now(),
    bras?: { harness: string; effort: Effort | null },
  ): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO aiguillage_modeles (taskId, modele, choisiA) VALUES (?, ?, ?)',
      )
      .run(taskId, modele, now);
    // Le reste du bras suit le modèle, ligne pour ligne : un modèle reposé SANS
    // bras (appelant d'avant la v3) efface l'ancien, qui décrirait une autre
    // tentative — et son coût avec.
    if (bras) {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO aiguillage_bras (taskId, harness, effort, coutUsd, choisiA) ' +
            'VALUES (?, ?, ?, NULL, ?)',
        )
        .run(taskId, bras.harness, bras.effort, now);
    } else this.db.prepare('DELETE FROM aiguillage_bras WHERE taskId = ?').run(taskId);
  }

  /**
   * Range le coût que le CLI a DÉCLARÉ pour la production rendue sous le bras
   * courant de la tâche. Sans bras rangé, rien : un coût n'est attribué qu'à
   * un bras connu. Appelé seulement quand le CLI a déclaré un coût — l'absence
   * reste `NULL`, jamais 0.
   */
  poserCoutAiguillage(taskId: string, coutUsd: number): void {
    this.db.prepare('UPDATE aiguillage_bras SET coutUsd = ? WHERE taskId = ?').run(coutUsd, taskId);
  }

  /**
   * Retire le modèle de la tentative actuellement portée par une tâche.
   *
   * L'absence de ligne signifie « aucun modèle choisi : le nœud emploie son
   * défaut ». Une réassignation vers un nœud sans modèle doit donc effacer la
   * ligne précédente, sinon une relivraison attribuerait à tort l'ancien
   * modèle au nouveau producteur.
   */
  effacerModeleAiguillage(taskId: string): void {
    this.db.prepare('DELETE FROM aiguillage_modeles WHERE taskId = ?').run(taskId);
    this.db.prepare('DELETE FROM aiguillage_bras WHERE taskId = ?').run(taskId);
  }

  /** Effort commandé à la tentative courante ; `null` : aucun (ou bras inconnu). */
  effortAiguillageDe(taskId: string): Effort | null {
    return this.brasAiguillageDe(taskId)?.effort ?? null;
  }

  /**
   * Le bras rangé pour la tentative courante (sans le modèle, cf.
   * `modeleAiguillageDe`) ; `null` sans élection v3. Un effort illisible vaut
   * « aucun », un coût hors bornes « non déclaré » — rien n'est deviné.
   */
  brasAiguillageDe(
    taskId: string,
  ): { harness: string; effort: Effort | null; coutUsd: number | null } | null {
    const row = this.db
      .prepare('SELECT harness, effort, coutUsd FROM aiguillage_bras WHERE taskId = ?')
      .get(taskId) as
      { harness: string; effort: string | null; coutUsd: number | null } | undefined;
    if (!row) return null;
    return {
      harness: row.harness,
      effort: estEffort(row.effort) ? row.effort : null,
      coutUsd: coutLisible(row.coutUsd),
    };
  }

  /**
   * La consigne de l'opérateur sur le routage d'une tâche, ou `null`.
   *
   * Relue au travers de `lireConsigneRoutage`, comme au réseau : une ligne
   * illisible (base éditée à la main, version future) vaut « aucune consigne
   * lisible » — la tâche route selon l'Aiguillage, jamais selon une consigne
   * devinée.
   */
  consigneRoutage(
    taskId: string,
  ): { consigne: ConsigneRoutage; definiPar: string | null; majA: number } | null {
    const row = this.db
      .prepare('SELECT consigne, definiPar, majA FROM consignes_routage WHERE taskId = ?')
      .get(taskId) as { consigne: string; definiPar: string | null; majA: number } | undefined;
    if (!row) return null;
    let brut: unknown;
    try {
      brut = JSON.parse(row.consigne);
    } catch {
      return null;
    }
    const lue = lireConsigneRoutage(brut);
    return lue.ok ? { consigne: lue.consigne, definiPar: row.definiPar, majA: row.majA } : null;
  }

  /** Pose (ou lève, avec `null`) la consigne de routage d'une tâche. */
  poserConsigneRoutage(
    taskId: string,
    consigne: ConsigneRoutage | null,
    definiPar: string | null,
    now = Date.now(),
  ): void {
    if (consigne === null) {
      this.db.prepare('DELETE FROM consignes_routage WHERE taskId = ?').run(taskId);
      return;
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO consignes_routage (taskId, consigne, definiPar, majA)
         VALUES (?, ?, ?, ?)`,
      )
      .run(taskId, JSON.stringify(consigne), definiPar, now);
  }

  /** Modèle choisi pour la tentative actuellement représentée par la tâche. */
  modeleAiguillageDe(taskId: string): string | null {
    const row = this.db
      .prepare('SELECT modele FROM aiguillage_modeles WHERE taskId = ?')
      .get(taskId) as { modele: string } | undefined;
    return row?.modele ?? null;
  }

  /**
   * Range l'ÉCHELON de garde-fous sous lequel une tâche a été assignée. `INSERT
   * OR REPLACE` : une réassignation ré-élit, la dernière gouverne (motif
   * `poserModeleAiguillage`).
   */
  poserEchelonGardeFou(taskId: string, echelon: Echelon, now = Date.now()): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO garde_fou_echelons (taskId, echelon, choisiA) VALUES (?, ?, ?)',
      )
      .run(taskId, echelon, now);
  }

  /**
   * L'échelon posé pour une tâche, ou `null` si aucun (projet non opt-in). Rendu
   * en TEXTE BRUT — le module le valide (`versEchelon`). C'est ce que lit l'aval
   * pour que le mode qui JUGE une production soit le mode qui l'a GOUVERNÉE.
   */
  getEchelonGardeFou(taskId: string): string | null {
    const row = this.db
      .prepare('SELECT echelon FROM garde_fou_echelons WHERE taskId = ?')
      .get(taskId) as { echelon: string } | undefined;
    return row?.echelon ?? null;
  }

  /**
   * Range l'EXIGENCE de contre-visite d'une production — le fait daté que rien ne
   * peut reconstruire (voir le schéma). `exigee` si une contre-visite était
   * requise, `dispensee` sinon. `INSERT OR REPLACE` : la dernière décision gagne.
   */
  poserExigenceGardeFou(productionTaskId: string, exigee: boolean, now = Date.now()): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO garde_fou_exigences (productionTaskId, exigence, decideA) VALUES (?, ?, ?)',
      )
      .run(productionTaskId, exigee ? 'exigee' : 'dispensee', now);
  }

  /**
   * Reconstruit les FAITS BRUTS que `observationDepuisFaits` assemble — SANS rien
   * recopier. Pour chaque tâche dont l'Agent Garde-Fous a posé l'échelon, que les
   * Gardiennes ont verdictée, ET dont le sort est TRANCHÉ (une contre-visite OU
   * une exigence rangée), on rend : l'échelon, le verdict le PLUS RÉCENT (une tâche
   * réassignée a plusieurs inspections), la suite de contre-visite (ou `null`), et
   * l'exigence (ou `null`). La `traversee` n'est PAS ici — c'est une vue que le
   * module dérive de ces deux derniers faits.
   *
   * Le filtre « sort tranché » écarte les productions EN VOL : sans lui, le `LIMIT`
   * gaspillerait sa fenêtre sur des tâches encore en cours. Bornée par `limite`,
   * rendue en ordre CHRONOLOGIQUE (motif `observationsAiguillage`).
   */
  observationsGardeFou(limite = CORPUS_GARDE_FOU): FaitsProduction[] {
    const rows = this.db
      .prepare(
        `SELECT e.echelon AS echelon,
                g.verdict AS verdict,
                cv.suite  AS suite,
                ex.exigence AS exigence
           FROM garde_fou_echelons e
           JOIN gardiennes g ON g.id = (SELECT MAX(id) FROM gardiennes WHERE taskId = e.taskId)
           LEFT JOIN contre_visites cv     ON cv.productionTaskId = e.taskId
           LEFT JOIN garde_fou_exigences ex ON ex.productionTaskId = e.taskId
          WHERE (cv.productionTaskId IS NOT NULL OR ex.productionTaskId IS NOT NULL)
            AND e.taskId NOT IN (SELECT tacheOmbre FROM taches_ombre)
          ORDER BY e.choisiA DESC
          LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limite, CORPUS_GARDE_FOU))) as FaitsProduction[];
    return rows.reverse();
  }

  /**
   * Reconstruit les observations que `replierAntecedents` replie — SANS rien
   * recopier. Pour chaque tâche dont on connaît le verdict
   * (`contre_visites`) et soit le modèle commandé (`aiguillage_modeles`), soit
   * le modèle exact prouvé par la contre-revue, on rend son titre + prompt (pour
   * `categoriser` à la lecture), le modèle, et le verdict. La preuve exacte doit
   * survivre à l'effacement d'une élection courante lors d'une réassignation.
   *
   * Bornée par `limite` (les plus récentes), puis rendue en ordre
   * CHRONOLOGIQUE : c'est l'ordre que `replierAntecedents` documente, et son
   * `slice(-CORPUS)` redevient un no-op puisque la borne est déjà le `LIMIT`.
   */
  observationsAiguillage(limite = CORPUS_AIGUILLAGE): LigneObservationAiguillage[] {
    // LE BRAS VOYAGE AVEC LA PREUVE, comme le modèle. Quand le verdict porte
    // son `resultId` (ce), harness, effort et coût viennent de l'annonce figée
    // au lancement de la contre-revue (`producteurHarness`…), JAMAIS
    // d'`aiguillage_bras` : une correction a pu réaffecter la tâche depuis, et
    // cette ligne décrit alors la tentative suivante — un verdict tardif
    // aurait été rangé sous un bras qui n'a jamais tourné, chargé du coût d'un
    // autre.
    //
    // LE BRAS D'UN VERDICT D'AVANT LA V3 n'est pas deviné, il est CONSTATÉ :
    // aucun effort n'était alors commandé (`effort` NULL est un fait), et le
    // harness est l'agentType du nœud qui a produit le résultat relu. Sans ce
    // repli, la mise à jour aurait réduit tout le vécu appris au seul niveau
    // modèle. Sans résultat relu ni bras rangé, le harness reste inconnu.
    // Une contre-visite peut survivre à une nouvelle tentative de la même
    // tâche. Le seul lien qui garde l'identité de la production est le
    // `resultId` du verdict de contre-revue ; sans lui, l'observation reste
    // globale et ne doit pas être attribuée au dernier Worker par supposition.
    const rows = this.db
      .prepare(CORPUS_AIGUILLAGE_SQL)
      .all(Math.max(1, Math.min(limite, CORPUS_AIGUILLAGE))) as Array<
      Omit<
        LigneObservationAiguillage,
        'nodeId' | 'modeleExact' | 'harness' | 'effort' | 'coutUsd'
      > & {
        verdictId: number | null;
        nodeId: string | null;
        modeleExact: string | null;
        harness: string | null;
        effort: string | null;
        coutUsd: number | null;
      }
    >;
    return rows
      .reverse()
      .map(({ verdictId: _verdict, nodeId, modeleExact, harness, effort, coutUsd, ...ligne }) => {
        const cout = coutLisible(coutUsd);
        return {
          ...ligne,
          ...(nodeId ? { nodeId } : {}),
          ...(modeleExact ? { modeleExact } : {}),
          ...(harness ? { harness } : {}),
          // Un effort illisible (base éditée à la main) vaut « aucun » : il n'est
          // jamais deviné vers un niveau voisin.
          ...(estEffort(effort) ? { effort } : {}),
          ...(cout !== null ? { coutUsd: cout } : {}),
        };
      });
  }

  /**
   * Les élections EN VOL : une tâche s'est vu poser un modèle, elle est ENCORE
   * en cours (`assigned`/`running`), et aucune contre-visite ne l'a jugée. On
   * rend titre + prompt (pour re-`categoriser`) et le modèle — jamais de suite,
   * il n'y en a pas encore.
   *
   * ─── POURQUOI CES DEUX FILTRES, ET PAS UN SEUL ──────────────────────────────
   *
   * L'Aiguillage les compte comme des essais SANS note, pour éteindre le `+∞`
   * d'exploration d'un modèle neuf dès son PREMIER lancement — sinon, son score
   * restant infini jusqu'au premier VERDICT (qui met des minutes à revenir), il
   * aspirerait toutes les tâches prêtes d'un genre.
   *
   * · « pas de contre-visite » seul ne suffit PAS : une tâche `done`/`failed`
   *   qui n'a jamais été relue traînerait comme un essai en vol ÉTERNEL, et
   *   déprimerait son modèle à jamais. On exige donc qu'elle soit encore ACTIVE
   *   (`assigned`/`running`) : un essai en vol est un essai qui va, vraiment,
   *   rendre un verdict bientôt.
   */
  electionsEnVolAiguillage(): ElectionEnVol[] {
    const rows = this.db
      .prepare(
        `SELECT t.title AS title, t.prompt AS prompt, am.modele AS modele,
                COALESCE(ab.harness, n.agentType) AS harness, ab.effort AS effort
           FROM aiguillage_modeles am
           JOIN tasks t ON t.id = am.taskId
           LEFT JOIN aiguillage_bras ab ON ab.taskId = am.taskId
           LEFT JOIN nodes n ON n.id = t.assignedNodeId
          WHERE t.status IN ('assigned', 'running')
            AND am.taskId NOT IN (SELECT productionTaskId FROM contre_visites)`,
      )
      .all() as {
      title: string;
      prompt: string;
      modele: string;
      harness: string | null;
      effort: string | null;
    }[];
    return rows.map(({ harness, effort, ...e }) => ({
      ...e,
      ...(harness ? { harness } : {}),
      ...(estEffort(effort) ? { effort } : {}),
    }));
  }

  /**
   * Élague les liens dont la tâche n'existe plus. Référentielle, comme
   * `pruneContreVisites` juste au-dessus, et vraie dès le premier jour :
   * `pruneTasks` fait disparaître des tâches pour de bon depuis le lot 17.
   */
  pruneAiguillageModeles(): number {
    this.db.prepare('DELETE FROM aiguillage_bras WHERE taskId NOT IN (SELECT id FROM tasks)').run();
    return this.db
      .prepare('DELETE FROM aiguillage_modeles WHERE taskId NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  /** Élague les échelons dont la tâche n'existe plus. Référentielle, motif `pruneAiguillageModeles`. */
  pruneGardeFouEchelons(): number {
    return this.db
      .prepare('DELETE FROM garde_fou_echelons WHERE taskId NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  /** Élague les exigences dont la production n'existe plus. Référentielle, même motif. */
  pruneGardeFouExigences(): number {
    return this.db
      .prepare(
        'DELETE FROM garde_fou_exigences WHERE productionTaskId NOT IN (SELECT id FROM tasks)',
      )
      .run().changes;
  }

  pruneContreExpertises(): number {
    return this.db
      .prepare(
        `DELETE FROM contre_expertises
          WHERE relectureTaskId NOT IN (SELECT id FROM tasks)
             OR productionTaskId NOT IN (SELECT id FROM tasks)`,
      )
      .run().changes;
  }

  // ─── Le banc d'ombre (shadow-bench.ts) ─────────────────────────────────────

  /**
   * Pose le CONSENTEMENT du banc d'ombre d'un projet — motif `setGardeFou` :
   * une intention humaine écrasée en place, jamais un calcul de la ruche. Les
   * bornes sont validées par la route (`BORNES_REGLAGE`) : le store range.
   */
  setBancOmbre(
    projectId: string,
    reglage: ReglageBancOmbre,
    definiPar: string | null = null,
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT INTO banc_ombre
           (projectId, actif, tauxPourMille, executionsParJour, plafondCoutUsd, version, definiPar, updatedAt)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(projectId) DO UPDATE SET
           actif = excluded.actif,
           tauxPourMille = excluded.tauxPourMille,
           executionsParJour = excluded.executionsParJour,
           plafondCoutUsd = excluded.plafondCoutUsd,
           definiPar = excluded.definiPar,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        projectId,
        reglage.actif ? 1 : 0,
        reglage.tauxPourMille,
        reglage.executionsParJour,
        reglage.plafondCoutUsd,
        definiPar,
        now,
      );
  }

  /** Le consentement d'un projet, ou `null` : pas de ligne ⇒ banc ÉTEINT. */
  getBancOmbre(
    projectId: string,
  ): (ReglageBancOmbre & { definiPar: string | null; updatedAt: number }) | null {
    const row = this.db
      .prepare(
        `SELECT actif, tauxPourMille, executionsParJour, plafondCoutUsd, definiPar, updatedAt
           FROM banc_ombre WHERE projectId = ?`,
      )
      .get(projectId) as
      | (Omit<ReglageBancOmbre, 'actif'> & {
          actif: number;
          definiPar: string | null;
          updatedAt: number;
        })
      | undefined;
    return row ? { ...row, actif: row.actif === 1 } : null;
  }

  /**
   * Crée l'ombre ET son lien en UNE transaction. Une ombre sans son lien serait
   * une production ordinaire — livrable, fusionnable, apprise par le routing —
   * pendant l'instant qui sépare les deux écritures, et pour toujours si la
   * seconde échouait. La tâche naît `pending` sans dépendance : rien ne la
   * prend avant une passe du planificateur, et le lien est déjà là.
   *
   * Le côté ORIGINAL de la comparaison est rangé ici, au moment où il est
   * connu : sa production est déjà rendue et jugée par ses tests.
   */
  creerTacheOmbre(
    o: {
      original: Pick<Task, 'id' | 'projectId' | 'prompt'>;
      titre: string;
      categorie: Categorie;
      modeleOriginal: string;
      modeleOmbre: string;
      coteOriginal: CoteOmbreRange;
    },
    now = Date.now(),
  ): TacheOmbre {
    const tacheOmbre = randomUUID();
    const c = o.coteOriginal;
    this.enTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO tasks (id, projectId, title, prompt, status, dependsOn, attempts, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 'pending', '[]', 0, ?, ?)`,
        )
        .run(tacheOmbre, o.original.projectId, o.titre, o.original.prompt, now, now);
      this.db
        .prepare(
          `INSERT INTO taches_ombre
             (tacheOmbre, tacheOriginale, projectId, resultatOriginal, modeleOriginal, modeleOmbre,
              categorie, creeA, originalSucces, originalTests, originalBase, originalRevue)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          tacheOmbre,
          o.original.id,
          o.original.projectId,
          c.resultId,
          o.modeleOriginal,
          o.modeleOmbre,
          o.categorie,
          now,
          c.succes ? 1 : 0,
          c.tests,
          c.baseSha,
          c.revue,
        );
    });
    return this.ombreDe(tacheOmbre) as TacheOmbre;
  }

  /** Le lien d'une OMBRE, ou `null` : cette tâche n'en est pas une. */
  ombreDe(taskId: string): TacheOmbre | null {
    const row = this.db.prepare('SELECT * FROM taches_ombre WHERE tacheOmbre = ?').get(taskId) as
      TacheOmbreRow | undefined;
    return row ? rowToTacheOmbre(row) : null;
  }

  /** L'ombre lancée pour cette tâche ORIGINALE, ou `null`. */
  ombreDeOriginale(taskId: string): TacheOmbre | null {
    const row = this.db
      .prepare('SELECT * FROM taches_ombre WHERE tacheOriginale = ?')
      .get(taskId) as TacheOmbreRow | undefined;
    return row ? rowToTacheOmbre(row) : null;
  }

  /**
   * L'ombre que sert cette tâche — elle-même si c'en est une, celle qu'elle
   * relit si c'est une relecture d'ombre —, ou `null` : une tâche hors banc.
   */
  ombreLieeA(taskId: string): string | null {
    const row = this.db
      .prepare(`SELECT tacheOmbre FROM (${TACHES_DU_BANC_SQL}) WHERE id = ? LIMIT 1`)
      .get(taskId) as { tacheOmbre: string } | undefined;
    return row?.tacheOmbre ?? null;
  }

  /**
   * Range le côté OMBRE de la comparaison : son unique production. La
   * PREMIÈRE seulement (`ombreResultat IS NULL`) — une ombre n'a qu'un essai
   * (scheduler.ts), et un résultat rejoué ne réécrit pas ce qui a été jugé.
   */
  consignerRenduOmbre(
    tacheOmbre: string,
    rendu: Pick<CoteOmbreRange, 'resultId' | 'succes' | 'tests' | 'baseSha'>,
  ): void {
    this.db
      .prepare(
        `UPDATE taches_ombre
            SET ombreResultat = ?, ombreSucces = ?, ombreTests = ?, ombreBase = ?
          WHERE tacheOmbre = ? AND ombreResultat IS NULL`,
      )
      .run(rendu.resultId, rendu.succes ? 1 : 0, rendu.tests, rendu.baseSha, tacheOmbre);
  }

  /**
   * Range l'avis de la contre-revue sur un côté — le RÉSUMÉ de tous les avis
   * de ce résultat exact (`revue`), jamais un vote isolé : une objection
   * suffit à dire le côté contesté. Une production qui n'est ni une ombre ni
   * la production originale mesurée d'une ombre ne touche aucune ligne.
   */
  consignerRevueOmbre(productionTaskId: string, resultId: number, revue: RevueCote): void {
    this.db
      .prepare(
        `UPDATE taches_ombre SET ombreRevue = ?
          WHERE tacheOmbre = ? AND ombreResultat = ?`,
      )
      .run(revue, productionTaskId, resultId);
    this.db
      .prepare(
        `UPDATE taches_ombre SET originalRevue = ?
          WHERE tacheOriginale = ? AND resultatOriginal = ?`,
      )
      .run(revue, productionTaskId, resultId);
  }

  /**
   * Ce que le banc a dépensé pour un projet depuis `depuis`. Les ombres EN VOL
   * se comptent sans fenêtre : une ombre lancée hier et toujours en file tient
   * encore sa place (`OMBRES_EN_VOL_MAX`). En vol = l'ombre elle-même n'est
   * pas close, OU une de ses relectures ne l'est pas : leur coût n'arrive
   * qu'à leur retour, et admettre la suivante avant lui laisserait le plafond
   * franchir une ombre de plus.
   */
  usageBancOmbre(projectId: string, depuis: number): UsageBancOmbre {
    const fenetre = this.db
      .prepare(
        `SELECT COUNT(*) AS executions,
                COALESCE(SUM(coutDeclareUsd), 0) AS coutDeclareUsd,
                COALESCE(SUM(executionsMuettes), 0) AS executionsMuettes
           FROM taches_ombre WHERE projectId = ? AND creeA >= ?`,
      )
      .get(projectId, depuis) as Omit<UsageBancOmbre, 'enVol'>;
    const { enVol } = this.db
      .prepare(
        `SELECT COUNT(*) AS enVol
           FROM taches_ombre o JOIN tasks t ON t.id = o.tacheOmbre
          WHERE o.projectId = ?
            AND (
              t.status NOT IN ('done', 'failed')
              OR EXISTS (
                SELECT 1 FROM contre_expertises ce JOIN tasks r ON r.id = ce.relectureTaskId
                 WHERE ce.productionTaskId = o.tacheOmbre AND r.status NOT IN ('done', 'failed')
              )
            )`,
      )
      .get(projectId) as { enVol: number };
    return { ...fenetre, enVol };
  }

  /**
   * Ajoute ce qu'une exécution liée à une ombre — l'ombre elle-même, ou une de
   * ses relectures — a DÉCLARÉ coûter. `null` : le CLI n'a rien déclaré, et
   * c'est compté comme tel, jamais estimé.
   */
  consignerCoutOmbre(tacheOmbre: string, coutUsd: number | null): void {
    this.db
      .prepare(
        `UPDATE taches_ombre
            SET coutDeclareUsd = coutDeclareUsd + ?, executionsMuettes = executionsMuettes + ?
          WHERE tacheOmbre = ?`,
      )
      .run(coutUsd ?? 0, coutUsd === null ? 1 : 0, tacheOmbre);
  }

  /**
   * Les dernières ombres — d'un projet, ou de toute la ruche (`null`) —, avec
   * l'état de leur tâche (`null` si elle a disparu), les plus récentes
   * d'abord. Bornée par `limite`. C'est la source DURABLE des comparaisons que
   * le registre Genome replie : elles vivent ici, pas dans le journal.
   */
  ombresRecentes(
    projectId: string | null,
    limite = 20,
  ): Array<TacheOmbre & { statut: TaskStatus | null; titre: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT o.*, t.status AS statut, t.title AS titre
           FROM taches_ombre o LEFT JOIN tasks t ON t.id = o.tacheOmbre
          WHERE (? IS NULL OR o.projectId = ?)
          ORDER BY o.creeA DESC, o.tacheOmbre DESC
          LIMIT ?`,
      )
      .all(projectId, projectId, Math.max(1, Math.min(limite, 5_000))) as Array<
      TacheOmbreRow & { statut: TaskStatus | null; titre: string | null }
    >;
    return rows.map((r) => ({ ...rowToTacheOmbre(r), statut: r.statut, titre: r.titre }));
  }

  /** Élague les liens dont l'ombre n'existe plus. Référentielle, motif `pruneContreExpertises`. */
  pruneTachesOmbre(): number {
    return this.db
      .prepare('DELETE FROM taches_ombre WHERE tacheOmbre NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  // ─── Le trou de vol : billets et clés de nœud ──────────────────────────────
  //
  // Toutes les lectures se font PAR CLÉ PRIMAIRE. C'est structurel, pas une
  // optimisation : vérifier un secret en parcourant la table obligerait à
  // calculer un PBKDF2 par ligne, offrant à un inconnu un déni de service à
  // coût nul. Le billet porte donc son `id` en clair — l'id sert à TROUVER, le
  // secret à PROUVER.

  creerBillet(billet: {
    id: string;
    secretHash: string;
    label?: string | null;
    createdBy?: string | null;
    expiresAt: number;
    uses: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO invite_tickets (id, secretHash, label, createdBy, createdAt, expiresAt, usesLeft, usesTotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        billet.id,
        billet.secretHash,
        billet.label ?? null,
        billet.createdBy ?? null,
        billet.now ?? Date.now(),
        billet.expiresAt,
        billet.uses,
        billet.uses,
      );
  }

  getBillet(id: string): BilletRange | null {
    const row = this.db.prepare('SELECT * FROM invite_tickets WHERE id = ?').get(id) as
      BilletRange | undefined;
    return row ?? null;
  }

  /**
   * Consomme UN usage, de façon atomique et conditionnelle. Le `WHERE
   * usesLeft > 0` fait tout le travail : deux nœuds qui échangent le même
   * billet à usage unique au même instant ne peuvent pas réussir tous les deux,
   * quel que soit l'entrelacement. Un `SELECT` suivi d'un `UPDATE` aurait
   * laissé cette course ouverte.
   */
  consommerBillet(id: string, now = Date.now()): boolean {
    return (
      this.db
        .prepare(
          `UPDATE invite_tickets SET usesLeft = usesLeft - 1, lastUsedAt = ?
           WHERE id = ? AND usesLeft > 0 AND revokedAt IS NULL AND expiresAt > ?`,
        )
        .run(now, id, now).changes === 1
    );
  }

  /**
   * Cette ruche a-t-elle déjà exclu quelqu'un ?
   *
   * C'est le déclencheur du durcissement de la seconde porte (voir
   * `tokenMaitrePeutEnregistrer`). Tant qu'il rend `false`, rien ne change pour
   * personne — une ruche qui n'a jamais exclu de membre garde exactement le
   * comportement d'avant.
   *
   * `LIMIT 1` : on ne compte pas, on demande s'il en existe UNE. La question
   * est posée à chaque `register`, donc elle doit coûter une lecture d'index et
   * pas un parcours de table.
   */
  rucheAExclu(): boolean {
    return (
      this.db.prepare('SELECT 1 FROM node_keys WHERE revokedAt IS NOT NULL LIMIT 1').get() !==
      undefined
    );
  }

  revoquerBillet(id: string, now = Date.now()): boolean {
    return (
      this.db
        .prepare('UPDATE invite_tickets SET revokedAt = ? WHERE id = ? AND revokedAt IS NULL')
        .run(now, id).changes === 1
    );
  }

  listBillets(limit = 100): BilletRange[] {
    return this.db
      .prepare('SELECT * FROM invite_tickets ORDER BY createdAt DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 500))) as BilletRange[];
  }

  /**
   * Range la clé d'un nœud. `INSERT OR REPLACE` : rejoindre à nouveau fait une
   * ROTATION de clé plutôt qu'une accumulation — et remet `revokedAt` à NULL,
   * ce qui est voulu : présenter un billet valide est précisément le geste par
   * lequel un membre exclu peut être réadmis, si l'hôte lui redonne un billet.
   */
  poserCleNoeud(cle: {
    nodeId: string;
    keyHash: string;
    label?: string | null;
    ticketId?: string | null;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO node_keys (nodeId, keyHash, label, ticketId, createdAt, lastSeenAt, revokedAt)
         VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(cle.nodeId, cle.keyHash, cle.label ?? null, cle.ticketId ?? null, cle.now ?? Date.now());
  }

  getCleNoeud(nodeId: string): CleNoeudRangee | null {
    const row = this.db.prepare('SELECT * FROM node_keys WHERE nodeId = ?').get(nodeId) as
      CleNoeudRangee | undefined;
    return row ?? null;
  }

  toucherCleNoeud(nodeId: string, now = Date.now()): void {
    this.db.prepare('UPDATE node_keys SET lastSeenAt = ? WHERE nodeId = ?').run(now, nodeId);
  }

  revoquerCleNoeud(nodeId: string, now = Date.now()): boolean {
    return (
      this.db
        .prepare('UPDATE node_keys SET revokedAt = ? WHERE nodeId = ? AND revokedAt IS NULL')
        .run(now, nodeId).changes === 1
    );
  }

  listClesNoeuds(limit = 200): CleNoeudRangee[] {
    return this.db
      .prepare('SELECT * FROM node_keys ORDER BY createdAt DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 500))) as CleNoeudRangee[];
  }

  /**
   * Élague les billets MORTS (révoqués, expirés ou épuisés) plus vieux que la
   * période de grâce. Les billets vivants ne sont jamais touchés : un billet
   * encore valide qui disparaîtrait rendrait une invitation en circulation
   * silencieusement inutilisable — le pire mode d'échec pour une fonctionnalité
   * dont tout l'intérêt est qu'on puisse compter dessus.
   *
   * La grâce existe pour que « ce billet a été révoqué » reste une réponse
   * possible quelque temps, plutôt que « billet inconnu » — qui laisserait
   * croire à une faute de frappe.
   */
  pruneAcces(graceMs: number, now = Date.now()): number {
    const seuil = now - Math.max(0, graceMs);
    return this.db
      .prepare(
        `DELETE FROM invite_tickets
         WHERE createdAt < ?
           AND (revokedAt IS NOT NULL OR expiresAt <= ? OR usesLeft <= 0)`,
      )
      .run(seuil, now).changes;
  }

  // ─── Les liens de partage ──────────────────────────────────────────────────

  creerPartage(p: {
    id: string;
    projectId: string;
    secretHash: string;
    label: string;
    creePar: string;
    expireA: number;
    now?: number;
  }): void {
    const now = p.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO partages (id, projectId, secretHash, label, creePar, creeA, expireA, revoqueA, vuA)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      )
      .run(p.id, p.projectId, p.secretHash, p.label, p.creePar, now, p.expireA);
  }

  getPartage(id: string): Partage | undefined {
    return this.db.prepare('SELECT * FROM partages WHERE id = ?').get(id) as Partage | undefined;
  }

  listPartages(projectId: string): Partage[] {
    return this.db
      .prepare('SELECT * FROM partages WHERE projectId = ? ORDER BY creeA DESC')
      .all(projectId) as Partage[];
  }

  /** Révoque un lien. Idempotent : re-révoquer n'écrase pas la première date. */
  revoquerPartage(id: string, now = Date.now()): boolean {
    return (
      this.db.prepare('UPDATE partages SET revoqueA = ? WHERE id = ? AND revoqueA = 0').run(now, id)
        .changes > 0
    );
  }

  /** Note qu'un lien vient de servir — pour voir, plus tard, lequel dort. */
  toucherPartage(id: string, now = Date.now()): void {
    this.db.prepare('UPDATE partages SET vuA = ? WHERE id = ?').run(now, id);
  }

  /**
   * BORNE D'ÉLAGAGE de `partages`, dans le même commit que la table.
   *
   * Seuls les partages MORTS — révoqués ou expirés — sont supprimés, et
   * seulement passée une période de grâce. Un partage vivant qui disparaîtrait
   * deviendrait silencieusement inutilisable chez celui à qui on l'a envoyé,
   * sans que personne puisse dire pourquoi.
   *
   * La grâce sert à la même chose que pour les billets : que « ce lien a été
   * révoqué » reste une réponse possible quelque temps, plutôt que « lien
   * inconnu » — qui laisserait croire à une faute de frappe dans l'URL.
   */
  prunePartages(graceMs: number, now = Date.now()): number {
    const seuil = now - Math.max(0, graceMs);
    return this.db
      .prepare(
        `DELETE FROM partages
         WHERE creeA < ?
           AND (revoqueA > 0 OR expireA <= ?)`,
      )
      .run(seuil, now).changes;
  }

  // ─── Le Conseil des Éclaireuses ────────────────────────────────────────────

  creerSession(s: {
    id: string;
    question: string;
    projectId?: string | null;
    version: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO conseil_sessions (id, question, projectId, etat, tour, toursSecs, version, createdAt)
         VALUES (?, ?, ?, 'exploration', 1, 0, ?, ?)`,
      )
      .run(s.id, s.question, s.projectId ?? null, s.version, s.now ?? Date.now());
  }

  getSession(id: string): SessionRangee | null {
    return (
      (this.db.prepare('SELECT * FROM conseil_sessions WHERE id = ?').get(id) as
        SessionRangee | undefined) ?? null
    );
  }

  /** Sessions encore vivantes. Bornée : le chemin du tick la relit à chaque passe. */
  sessionsOuvertes(limit = 20): SessionRangee[] {
    return this.db
      .prepare(
        "SELECT * FROM conseil_sessions WHERE etat != 'clos' ORDER BY createdAt, rowid LIMIT ?",
      )
      .all(Math.max(1, Math.min(limit, 100))) as SessionRangee[];
  }

  listSessions(limit = 50): SessionRangee[] {
    return this.db
      .prepare('SELECT * FROM conseil_sessions ORDER BY createdAt DESC, rowid DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 200))) as SessionRangee[];
  }

  majSession(
    id: string,
    champs: {
      etat?: string;
      tour?: number;
      toursSecs?: number;
      issue?: string | null;
      motif?: string | null;
      closedAt?: number | null;
    },
  ): void {
    const set: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(champs)) {
      if (v === undefined) continue;
      set.push(`${k} = ?`);
      vals.push(v);
    }
    if (set.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE conseil_sessions SET ${set.join(', ')} WHERE id = ?`).run(...vals);
  }

  lierTache(t: {
    taskId: string;
    sessionId: string;
    role: 'exploration' | 'verification';
    lentille?: string | null;
    propositionId?: string | null;
    tour: number;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO conseil_taches (taskId, sessionId, role, lentille, propositionId, tour, depouille)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(t.taskId, t.sessionId, t.role, t.lentille ?? null, t.propositionId ?? null, t.tour);
  }

  /** Tâches d'une session encore à dépouiller. Index dédié : jamais un SCAN. */
  tachesADepouiller(sessionId: string): TacheConseil[] {
    return this.db
      .prepare('SELECT * FROM conseil_taches WHERE sessionId = ? AND depouille = 0')
      .all(sessionId) as TacheConseil[];
  }

  marquerDepouillee(taskId: string): void {
    this.db.prepare('UPDATE conseil_taches SET depouille = 1 WHERE taskId = ?').run(taskId);
  }

  ajouterProposition(p: {
    id: string;
    sessionId: string;
    eclaireuse: string;
    famille: string;
    titre: string;
    corps: string;
    qualite: number;
    sources: string[];
    tour: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO conseil_propositions (id, sessionId, eclaireuse, famille, titre, corps, qualite, sources, tour, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.sessionId,
        p.eclaireuse,
        p.famille,
        p.titre,
        p.corps,
        p.qualite,
        JSON.stringify(p.sources),
        p.tour,
        p.now ?? Date.now(),
      );
  }

  listPropositions(sessionId: string): PropositionRangee[] {
    return this.db
      .prepare('SELECT * FROM conseil_propositions WHERE sessionId = ? ORDER BY tour, id')
      .all(sessionId) as PropositionRangee[];
  }

  ajouterAvis(a: {
    sessionId: string;
    propositionId: string;
    eclaireuse: string;
    famille: string;
    type: string;
    force: number;
    raison: string;
    tour: number;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO conseil_avis (sessionId, propositionId, eclaireuse, famille, type, force, raison, tour, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.sessionId,
        a.propositionId,
        a.eclaireuse,
        a.famille,
        a.type,
        a.force,
        a.raison,
        a.tour,
        a.now ?? Date.now(),
      );
  }

  listAvis(sessionId: string): AvisRange[] {
    return this.db
      .prepare('SELECT * FROM conseil_avis WHERE sessionId = ? ORDER BY tour, id')
      .all(sessionId) as AvisRange[];
  }

  /**
   * Élague les vieilles sessions CLOSES au-delà d'un quota, avec leurs enfants.
   *
   * Une session EN COURS n'est jamais touchée : la faire disparaître laisserait
   * des tâches d'éclaireuses orphelines qui tourneraient — et coûteraient du
   * temps-ouvrière — pour un conseil qui n'existe plus.
   */
  pruneConseils(maxSessions: number): number {
    // ─── LE DÉPARTAGE, SANS LEQUEL LA BORNE JETTE AU HASARD ───────────────────
    //
    // Trier sur un HORODATAGE SEUL ne définit aucun ordre entre lignes de même
    // milliseconde : SQLite est libre de les rendre dans n'importe quel ordre.
    // La borne supprime alors une ligne imprévisible.
    //
    // Ce n'est pas théorique : sur un runner rapide, trois conseils ouverts
    // d'affilée ont partagé le même `createdAt`, et la CI a supprimé la
    // mauvaise session.
    //
    // ─── ET POURQUOI CE N'EST PAS `id DESC` ───────────────────────────────────
    //
    // Ça l'a été, en recopiant `results` et `memories` qui trient par
    // `… DESC, id DESC`. LA FORME A ÉTÉ COPIÉE, PAS SA PROPRIÉTÉ : là-bas `id`
    // est un `INTEGER PRIMARY KEY AUTOINCREMENT`, donc croissant avec le temps.
    // Ici c'est `conseil-<randomUUID>`. L'ordre devenait TOTAL — plus de
    // départage indéfini — mais toujours SANS RAPPORT avec l'ancienneté : la
    // borne jetait proprement n'importe laquelle. Le rouge de macOS a survécu à
    // sa propre correction, ce qui est la façon la plus coûteuse d'apprendre.
    //
    // `rowid` est le compteur d'insertion implicite de SQLite : monotone, déjà
    // là sur toute table qui n'est pas `WITHOUT ROWID`, et il ne demande ni
    // migration ni colonne — la règle 2 de la doctrine tient.
    const garder = Math.max(0, maxSessions);
    const aJeter = this.db
      .prepare(
        `SELECT id FROM conseil_sessions WHERE etat = 'clos'
         ORDER BY createdAt DESC, rowid DESC LIMIT -1 OFFSET ?`,
      )
      .all(garder) as { id: string }[];

    // Balayage des plans ORPHELINS — AVANT le retour anticipé, et c'est tout
    // l'intérêt : une trace peut se retrouver sans session par un autre chemin
    // (base éditée à la main, retour à une version antérieure à cette table).
    // Placé plus bas, ce nettoyage n'aurait tourné que les jours où il y avait
    // par ailleurs quelque chose à élaguer, et la trace « déjà nourri »
    // survivrait à son conseil en empêchant à jamais de replanifier — un
    // verrou sans serrure.
    this.db
      .prepare('DELETE FROM conseil_plans WHERE sessionId NOT IN (SELECT id FROM conseil_sessions)')
      .run();

    if (aJeter.length === 0) return 0;
    const jeter = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.db.prepare('DELETE FROM conseil_avis WHERE sessionId = ?').run(id);
        this.db.prepare('DELETE FROM conseil_propositions WHERE sessionId = ?').run(id);
        this.db.prepare('DELETE FROM conseil_taches WHERE sessionId = ?').run(id);
        this.db.prepare('DELETE FROM conseil_plans WHERE sessionId = ?').run(id);
        this.db.prepare('DELETE FROM conseil_sessions WHERE id = ?').run(id);
      }
    });
    jeter(aJeter.map((r) => r.id));
    return aJeter.length;
  }

  // ─── Livraisons : ce que la ruche a déjà ouvert sur le dépôt ──────────────

  /**
   * Réserve une tâche avant le premier `await` vers GitHub.
   *
   * L'insertion conditionnelle est la frontière atomique entre la voie
   * manuelle et le runner : deux processus ne peuvent pas réserver la même
   * tâche, même si leurs lectures précédentes ont toutes deux vu l'absence de
   * livraison.
   */
  reserverLivraison(l: {
    taskId: string;
    projectId: string;
    depot: string;
    branche: string;
    now?: number;
  }): boolean {
    const now = l.now ?? Date.now();
    // Une OMBRE ne se réserve jamais (shadow-bench.ts) : la garde vit dans
    // l'insertion même, la frontière atomique que toutes les voies de livraison
    // traversent — la route humaine, le runner, et celles qui viendront.
    const info = this.db
      .prepare(
        `INSERT INTO livraisons (taskId, projectId, depot, pr, branche, etat, motif, version, creeA, majA)
         SELECT ?, ?, ?, 0, ?, ?, '', 1, ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM taches_ombre WHERE tacheOmbre = ?)
         ON CONFLICT(taskId) DO NOTHING`,
      )
      .run(l.taskId, l.projectId, l.depot, l.branche, ETAT_LIVRAISON_EN_COURS, now, now, l.taskId);
    return info.changes === 1;
  }

  /**
   * Passe une réservation à son état terminal, uniquement si elle est encore
   * la réservation attendue. Une livraison remplacée ne peut donc pas être
   * réécrite par le retour tardif d'un appel GitHub.
   */
  finaliserLivraisonEnCours(l: {
    taskId: string;
    projectId: string;
    depot: string;
    branche: string;
    pr: number;
    etat: 'ouverte' | 'echouee';
    motif?: string;
    /**
     * Une REPRISE vient de faire avancer la PR `pr` : les autres lignes de la
     * même PR passent `relayee`, dans la même transaction que celle-ci passe
     * `ouverte` — il n'existe aucun instant où la PR a deux lignes vivantes,
     * ni aucun où elle n'en a plus.
     */
    relaie?: boolean;
    now?: number;
  }): boolean {
    const now = l.now ?? Date.now();
    return this.enTransaction(() => {
      const info = this.db
        .prepare(
          `UPDATE livraisons
              SET pr = ?, etat = ?, motif = ?, majA = ?
            WHERE taskId = ?
              AND projectId = ?
              AND depot = ?
              AND branche = ?
              AND pr = 0
              AND etat = ?`,
        )
        .run(
          l.pr,
          l.etat,
          l.motif ?? '',
          now,
          l.taskId,
          l.projectId,
          l.depot,
          l.branche,
          ETAT_LIVRAISON_EN_COURS,
        );
      if (info.changes !== 1) return false;
      if (l.relaie && l.etat === 'ouverte' && l.pr > 0) {
        this.db
          .prepare(
            `UPDATE livraisons
                SET etat = ?, motif = ?, majA = ?
              WHERE projectId = ? AND depot = ? AND pr = ? AND taskId <> ?
                AND etat IN ('ouverte', 'echouee')`,
          )
          .run(
            ETAT_LIVRAISON_RELAYEE,
            `relayée par la reprise ${l.taskId}`,
            now,
            // Le projet d'abord, comme la réservation : deux projets branchés
            // sur le même dépôt ont chacun leurs lignes pour le même numéro.
            l.projectId,
            l.depot,
            l.pr,
            l.taskId,
          );
      }
      return true;
    });
  }

  // ─── Reprises : une correction prolonge la PR qu'elle corrige ─────────────

  /**
   * Inscrit la lignée d'une tâche de reprise. Idempotent : une seconde
   * inscription de la même tâche ne réécrit rien et rend `false`.
   */
  inscrireReprise(r: Omit<RepriseLivraison, 'creeA'> & { now?: number }): boolean {
    return (
      this.db
        .prepare(
          `INSERT INTO reprises_livraison
             (taskId, origine, parent, projectId, depot, pr, branche, tete, creeA)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(taskId) DO NOTHING`,
        )
        .run(
          r.taskId,
          r.origine,
          r.parent,
          r.projectId,
          r.depot,
          r.pr,
          r.branche,
          r.tete,
          r.now ?? Date.now(),
        ).changes === 1
    );
  }

  /** La lignée d'une tâche, ou `null` si ce n'est pas une reprise. */
  repriseDe(taskId: string): RepriseLivraison | null {
    return (
      (this.db.prepare('SELECT * FROM reprises_livraison WHERE taskId = ?').get(taskId) as
        RepriseLivraison | undefined) ?? null
    );
  }

  /** Les reprises d'une livraison d'origine, les plus anciennes d'abord. */
  reprisesDeLivraison(origine: string): RepriseLivraison[] {
    return this.db
      .prepare('SELECT * FROM reprises_livraison WHERE origine = ? ORDER BY creeA ASC, taskId ASC')
      .all(origine) as RepriseLivraison[];
  }

  /** Borne référentielle : la lignée ne survit pas à la tâche de reprise. */
  pruneReprisesLivraison(): number {
    return this.db
      .prepare('DELETE FROM reprises_livraison WHERE taskId NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  /**
   * Réconcilie les réservations laissées par une Queen arrêtée.
   *
   * Une réservation `en_cours` est volontairement durable pendant l'appel
   * GitHub : elle ferme la course avec un retry concurrent. Après un arrêt du
   * processus, aucun `finally` ne peut toutefois la finaliser. La classer ici,
   * avant toute nouvelle livraison, évite d'afficher un travail fantôme tout
   * en conservant `pr: 0` et l'incertitude qu'une PR distante puisse exister.
   */
  requalifierLivraisonsEnCours(now = Date.now()): LivraisonRangee[] {
    const motif =
      'livraison interrompue par le redémarrage de la Queen ; une PR GitHub distante peut exister, vérifiez GitHub avant toute reprise';
    const enCours = this.db
      .prepare('SELECT * FROM livraisons WHERE etat = ? ORDER BY creeA ASC')
      .all(ETAT_LIVRAISON_EN_COURS) as LivraisonRangee[];
    if (enCours.length === 0) return [];

    const requalifier = this.db.transaction((lignes: LivraisonRangee[]) => {
      const update = this.db.prepare(
        `UPDATE livraisons
            SET etat = ?, motif = ?, majA = ?
          WHERE taskId = ? AND etat = ? AND pr = 0`,
      );
      const sorties: LivraisonRangee[] = [];
      for (const ligne of lignes) {
        if (
          update.run('echouee', motif, now, ligne.taskId, ETAT_LIVRAISON_EN_COURS).changes !== 1
        ) {
          continue;
        }
        sorties.push({ ...ligne, etat: 'echouee', motif, majA: now });
      }
      return sorties;
    });
    return requalifier(enCours);
  }

  /** Note (ou met à jour) la pull request ouverte pour une tâche. */
  setLivraison(l: {
    taskId: string;
    projectId: string;
    depot: string;
    pr: number;
    branche: string;
    etat: string;
    motif?: string;
    now?: number;
  }): void {
    const now = l.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO livraisons (taskId, projectId, depot, pr, branche, etat, motif, version, creeA, majA)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(taskId) DO UPDATE SET
           pr    = excluded.pr,
           etat  = excluded.etat,
           motif = excluded.motif,
           majA  = excluded.majA`,
      )
      .run(l.taskId, l.projectId, l.depot, l.pr, l.branche, l.etat, l.motif ?? '', now, now);
  }

  getLivraison(taskId: string): LivraisonRangee | null {
    return (
      (this.db.prepare('SELECT * FROM livraisons WHERE taskId = ?').get(taskId) as
        LivraisonRangee | undefined) ?? null
    );
  }

  /**
   * Livraisons d'un projet dans un état donné, les plus anciennes d'abord —
   * la ruche fusionne dans l'ordre où elle a livré.
   *
   * BORNÉE par `pruneLivraisons`.
   */
  listLivraisons(projectId: string, etat?: string): LivraisonRangee[] {
    const sql = etat
      ? 'SELECT * FROM livraisons WHERE projectId = ? AND etat = ? ORDER BY creeA ASC'
      : 'SELECT * FROM livraisons WHERE projectId = ? ORDER BY creeA ASC';
    const args = etat ? [projectId, etat] : [projectId];
    return this.db.prepare(sql).all(...args) as LivraisonRangee[];
  }

  /**
   * Ne conserve que les `maxKeep` livraisons les plus récentes, et balaye
   * celles dont la tâche a disparu.
   *
   * `maxKeep` DOIT valoir au moins la rétention des résultats : une production
   * n'est livrable que tant que son résultat porte encore son diff, donc
   * élaguer les livraisons plus tôt ressusciterait une tâche déjà livrée et la
   * ruche rouvrirait sa pull request. L'appelant tient cet écart.
   */
  pruneLivraisons(maxKeep: number): number {
    const garder = Math.max(0, maxKeep);
    // Orphelines d'abord, et hors du quota : une tâche supprimée ne reviendra
    // pas, sa livraison n'a plus rien à protéger.
    this.db.prepare('DELETE FROM livraisons WHERE taskId NOT IN (SELECT id FROM tasks)').run();
    // ─── POURQUOI PAS UN SEUIL ───────────────────────────────────────────────
    //
    // La version précédente prenait le `creeA` de la (garder+1)-ième ligne puis
    // supprimait `WHERE creeA <= seuil`. Deux livraisons créées dans la même
    // milliseconde partagent ce `creeA` : le `<=` les emportait TOUTES, et le
    // quota n'était plus respecté — garder 100 pouvait n'en garder que 97.
    //
    // Ce n'était pas de l'imprévisibilité, c'était de la perte de données. On
    // désigne donc les lignes à GARDER, avec un départage, et on supprime le
    // reste : le compte est exact quel que soit l'horodatage.
    return this.db
      .prepare(
        `DELETE FROM livraisons WHERE taskId NOT IN (
           SELECT taskId FROM livraisons ORDER BY creeA DESC, taskId DESC LIMIT ?
         )`,
      )
      .run(garder).changes;
  }

  // ─── Plans de verdict : un conseil clos n'est nourri qu'UNE fois ───────────

  /** Marque le verdict d'une session comme transformé en travail. */
  marquerPlanifie(sessionId: string, projectId: string, taches: number, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO conseil_plans (sessionId, projectId, taches, version, creeA)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(sessionId) DO NOTHING`,
      )
      .run(sessionId, projectId, taches, now);
  }

  /** Ce verdict a-t-il déjà été transformé en travail ? */
  dejaPlanifie(sessionId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM conseil_plans WHERE sessionId = ?').get(sessionId) !==
      undefined
    );
  }

  /**
   * Sessions CLOSES d'un projet dont le verdict attend encore son plan, de la
   * plus ancienne à la plus récente — on nourrit dans l'ordre où la ruche a
   * délibéré, pas dans l'ordre inverse.
   *
   * BORNÉE par le quota de sessions conservées (`pruneConseils`) : cette
   * lecture ne peut pas croître avec l'histoire de la ruche.
   */
  sessionsANourrir(projectId: string): SessionRangee[] {
    return this.db
      .prepare(
        `SELECT s.* FROM conseil_sessions s
          WHERE s.projectId = ? AND s.etat = 'clos'
            AND s.id NOT IN (SELECT sessionId FROM conseil_plans)
          ORDER BY s.createdAt ASC`,
      )
      .all(projectId) as SessionRangee[];
  }

  // ─── Journal d'événements ──────────────────────────────────────────────────
  appendEvent(type: string, payload: Record<string, unknown>, ts = Date.now()): HiveEvent {
    const info = this.db
      .prepare('INSERT INTO events (ts, type, payload) VALUES (?, ?, ?)')
      .run(ts, type, JSON.stringify(payload));
    return { id: Number(info.lastInsertRowid), ts, type, payload };
  }

  /** Dernier id d'événement journalisé (0 si journal vide). */
  lastEventId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM events').get() as {
      id: number | null;
    };
    return row.id ?? 0;
  }

  /**
   * Le journal a-t-il déjà perdu des événements à l'élagage ?
   *
   * `events.id` est AUTOINCREMENT : `sqlite_sequence` garde le plus grand id
   * JAMAIS attribué, suppressions comprises, et les ids ne sont jamais
   * réutilisés. Seuls `pruneEvents` et la suppression d'un projet
   * (`effacerProjet`) suppriment des événements ; il en manque donc
   * exactement quand plus d'ids ont été attribués qu'il ne reste de lignes.
   * Un fait que tout repli du journal (registre Genome) doit dire : ce qu'il
   * compte n'est plus toute l'histoire de la ruche.
   */
  journalElague(): boolean {
    const row = this.db
      .prepare(
        "SELECT (SELECT seq FROM sqlite_sequence WHERE name = 'events') AS attribues, " +
          '(SELECT COUNT(*) FROM events) AS restants',
      )
      .get() as { attribues: number | null; restants: number };
    return (row.attribues ?? 0) > row.restants;
  }

  /** Nombre d'événements dans le journal. */
  countEvents(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    return row.n;
  }

  /**
   * LE PROPRIÉTAIRE UNIQUE DE LA RÉTENTION DU JOURNAL. La politique, et pourquoi
   * elle remplace l'élagage aveugle des 5 000 derniers événements, vivent dans
   * `shared/retention-journal.ts` ; ici, on rassemble les faits, on laisse
   * `planDeRetention` décider, on supprime.
   *
   *   1. Sous la fenêtre (`id <= dernier − fenetre`), chaque ligne est relue
   *      avec le `taskId` de son payload : c'est par là, et par rien d'autre,
   *      qu'une preuve est liée à sa tâche.
   *   2. Les faits que leur propre borne tient déjà restent hors du jeu
   *      (`faitsRanges`).
   *   3. Chaque tâche citée par une preuve est relue une fois (`cloturesDe`).
   *   4. Ce que le plan retire part par lots de 900 (limite de variables liées
   *      de SQLite), et s'ajoute au registre `journal_elagages`, par type et par
   *      motif.
   *
   * UNE transaction IMMEDIATE : la clôture d'une tâche est relue au même instant
   * que les lignes qu'elle garde, et le registre compte exactement ce qui est
   * parti — jamais un compte sans suppression, ni l'inverse. La fenêtre n'est
   * jamais touchée : `/api/events?since=` et les écrans qui rattrapent le direct
   * la lisent telle qu'elle était. Rend le bilan de la passe, que la Reine
   * journalise quand il retire quelque chose.
   */
  pruneEvents(politique: PolitiqueJournal, now = Date.now()): BilanJournal {
    const retenir = this.db.transaction((): BilanJournal => {
      const cutoff = this.lastEventId() - Math.max(0, politique.fenetre);
      if (cutoff <= 0) return bilanDeRetraits([], this.countEvents());
      const lignes = (
        this.db
          .prepare(
            `SELECT id, type, ${TACHE_DE_L_EVENEMENT} AS taskId
               FROM events WHERE id <= ? ORDER BY id`,
          )
          .all(cutoff) as Array<{ id: number; type: string; taskId: unknown }>
      ).map((l): LigneJournal => ({
        id: l.id,
        type: l.type,
        taskId: typeof l.taskId === 'string' && l.taskId !== '' ? l.taskId : null,
      }));
      const citees = lignes.flatMap((l) =>
        l.taskId !== null && estPreuve(l.type) ? [l.taskId] : [],
      );
      const clotures = this.cloturesDe(citees);
      const retraits = planDeRetention(
        lignes,
        (taskId) => clotures.get(taskId),
        this.faitsRanges(),
        this.tachesProuveesDansLaFenetre(cutoff),
        politique,
        this.countEvents(),
        now,
      );
      const LOT = 900;
      for (let i = 0; i < retraits.length; i += LOT) {
        const lot = retraits.slice(i, i + LOT).map((r) => r.id);
        this.db
          .prepare(`DELETE FROM events WHERE id IN (${lot.map(() => '?').join(', ')})`)
          .run(...lot);
      }
      const comptes = new Map<string, { type: string; motif: MotifElagage; n: number }>();
      for (const r of retraits) {
        const cle = `${r.type}\u0000${r.motif}`;
        const compte = comptes.get(cle) ?? { type: r.type, motif: r.motif, n: 0 };
        compte.n += 1;
        comptes.set(cle, compte);
      }
      this.consignerElagages(comptes.values(), now);
      return bilanDeRetraits(retraits, this.countEvents());
    });
    return retenir.immediate();
  }

  /**
   * Ajoute au registre `journal_elagages` ce qu'un chemin vient de retirer du
   * journal, par type et par motif. Les DEUX chemins qui suppriment des
   * événements y passent — la rétention et la suppression d'un projet — pour
   * que « le journal a perdu des lignes que le registre n'explique pas »
   * (`faitsElagues`) ne soit vrai que d'une perte réelle.
   */
  private consignerElagages(
    comptes: Iterable<{ type: string; motif: MotifElagage; n: number }>,
    now: number,
  ): void {
    const noter = this.db.prepare(
      `INSERT INTO journal_elagages (type, motif, supprimes, dernierA) VALUES (?, ?, ?, ?)
       ON CONFLICT(type, motif) DO UPDATE
         SET supprimes = supprimes + excluded.supprimes, dernierA = excluded.dernierA`,
    );
    for (const { type, motif, n } of comptes) noter.run(type, motif, n, now);
  }

  /**
   * Les tâches qui ont au moins une preuve AU-DESSUS de `cutoff` — dans la
   * fenêtre, que la passe ne touche jamais — avec les types de ces preuves. Le
   * plafond ne les prend pas entières : il ne retirerait que la moitié de leur
   * dossier ; en dernier recours il les COUPE, en commençant par les preuves
   * qu'une plus récente du même type remplace, fût-ce dans la fenêtre
   * (`planDeRetention`). La fenêtre est bornée (`fenetre` lignes) ; DISTINCT
   * replie les milliers de progrès d'une même tâche en une ligne par type.
   */
  private tachesProuveesDansLaFenetre(cutoff: number): Map<string, Set<string>> {
    const rows = this.db
      .prepare(`SELECT DISTINCT type, ${TACHE_DE_L_EVENEMENT} AS taskId FROM events WHERE id > ?`)
      .all(cutoff) as Array<{ type: string; taskId: unknown }>;
    const out = new Map<string, Set<string>>();
    for (const r of rows) {
      if (typeof r.taskId !== 'string' || r.taskId === '' || !estPreuve(r.type)) continue;
      const types = out.get(r.taskId) ?? new Set<string>();
      types.add(r.type);
      out.set(r.taskId, types);
    }
    return out;
  }

  /**
   * La clôture de chaque tâche citée (`clotureDe`), relue dans les tables
   * RANGÉES — l'état, la livraison, le verdict humain, et si elle est rendue à
   * une autre (relecture d'une production, enfant délégué) — jamais déduite du
   * journal qu'on est en train d'élaguer. Une tâche absente de `tasks` n'est pas
   * dans la carte : elle n'existe plus, ses preuves sont orphelines. Par lots de
   * 900, chaque jointure servie par une clé primaire.
   */
  private cloturesDe(taskIds: readonly string[]): Map<string, number | null> {
    const uniques = [...new Set(taskIds)];
    const out = new Map<string, number | null>();
    const LOT = 900;
    for (let i = 0; i < uniques.length; i += LOT) {
      const lot = uniques.slice(i, i + LOT);
      const rows = this.db
        .prepare(
          `SELECT t.id AS id, t.status AS status, t.updatedAt AS updatedAt,
                  l.etat AS livraisonEtat, l.majA AS livraisonMajA,
                  r.state AS revueEtat, r.updatedAt AS revueA,
                  (EXISTS (SELECT 1 FROM contre_expertises c WHERE c.relectureTaskId = t.id)
                   OR EXISTS (SELECT 1 FROM task_delegations d WHERE d.childTaskId = t.id))
                    AS rendueAUneAutre
             FROM tasks t
             LEFT JOIN livraisons l ON l.taskId = t.id
             LEFT JOIN reviews r    ON r.taskId = t.id
            WHERE t.id IN (${lot.map(() => '?').join(', ')})`,
        )
        .all(...lot) as Array<{
        id: string;
        status: string;
        updatedAt: number;
        livraisonEtat: string | null;
        livraisonMajA: number | null;
        revueEtat: string | null;
        revueA: number | null;
        rendueAUneAutre: number;
      }>;
      for (const r of rows) {
        out.set(
          r.id,
          clotureDe({
            status: r.status,
            updatedAt: r.updatedAt,
            livraison:
              r.livraisonEtat === null
                ? null
                : { etat: r.livraisonEtat, majA: r.livraisonMajA ?? 0 },
            revue: r.revueEtat === null ? null : { state: r.revueEtat, updatedAt: r.revueA ?? 0 },
            rendueAUneAutre: r.rendueAUneAutre === 1,
          }),
        );
      }
    }
    return out;
  }

  /**
   * Les faits que leur PROPRE borne tient déjà : la rétention du journal ne les
   * touche jamais — ni la fenêtre, ni l'échéance, ni le plafond. Chacun est
   * borné par un nombre fixe, et le plafond de la Reine est choisi au-dessus de
   * leur somme avec la fenêtre (un test tient l'inégalité).
   *
   *   · La DÉCISION HUMAINE COURANTE de chaque Conseil encore rangé
   *     (`council_decided`, cf. `shared/war-room.ts`). C'est un geste humain, pas
   *     une trace machine : l'élaguer ferait redire « à trancher » à un conseil
   *     que quelqu'un a tranché, et laisserait trancher à nouveau comme si de
   *     rien n'était. Un Conseil n'est la preuve d'aucune tâche — sans cette
   *     clause, sa décision serait une trace. Bornée par `pruneConseils` : une
   *     par session conservée, et la protection tombe avec la session.
   *   · Le DERNIER VERDICT de contre-revue de chaque production du corpus de
   *     l'Aiguillage — l'appartenance exacte que relit `observationsAiguillage`,
   *     par la même requête (`CORPUS_AIGUILLAGE_SQL`).
   *     Son `producteurModele` est la seule preuve du modèle exact d'un résultat
   *     après réassignation : supprimé alors que `contre_visites` reste,
   *     l'Aiguillage apprendrait le modèle COURANT à la place du producteur
   *     historique. Le verdict est aussi une preuve de sa production ; cette
   *     clause le tient au-delà de sa clôture et hors du plafond, tant que la
   *     production compte pour l'apprentissage. Bornée par `CORPUS_AIGUILLAGE`.
   *   · Les `AUDITS_SUPPRESSION_CONSERVES` derniers faits d'AUDIT d'une
   *     suppression de projet (`project_deleted`). C'est tout ce qui reste d'un
   *     projet supprimé (décision du propriétaire : supprimer, pas archiver —
   *     sauf cette ligne) : l'élaguer au bout de quelques heures de journal
   *     ferait qu'il n'aurait jamais existé, ni personne pour l'avoir effacé.
   *     « Un geste humain » ne bornait rien : un script qui crée puis supprime
   *     des projets en boucle en pose autant qu'il veut, et chacun échappait à
   *     la fenêtre ET au plafond. Au-delà du nombre, les plus anciens
   *     redeviennent des traces que la rétention retire — et compte au
   *     registre, comme tout ce qu'elle retire (#527).
   */
  private faitsRanges(): Set<number> {
    const decisions = this.db
      .prepare(
        `SELECT id FROM (
           SELECT MAX(id) AS id,
                  json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$.sessionId') AS sessionId
             FROM events
            WHERE type = 'council_decided'
            GROUP BY sessionId
         )
         WHERE sessionId IN (SELECT id FROM conseil_sessions)`,
      )
      .all() as Array<{ id: number }>;
    const verdicts = this.db.prepare(CORPUS_AIGUILLAGE_SQL).all(CORPUS_AIGUILLAGE) as Array<{
      verdictId: number | null;
    }>;
    const suppressions = this.db
      .prepare(`SELECT id FROM events WHERE type = 'project_deleted' ORDER BY id DESC LIMIT ?`)
      .all(AUDITS_SUPPRESSION_CONSERVES) as Array<{ id: number }>;
    return new Set([
      ...decisions.map((r) => r.id),
      ...suppressions.map((r) => r.id),
      ...verdicts.flatMap((r) => (r.verdictId === null ? [] : [r.verdictId])),
    ]);
  }

  /**
   * Des faits de ces types, d'une tâche ENCORE CONNUE, ont-ils pu sortir du
   * journal ? La question qu'un repli par tâche (registre Genome) doit se poser
   * avant de se dire tronqué — et que `journalElague` ne sait pas trancher : il
   * voit qu'il manque des lignes, pas lesquelles, si bien qu'une passe qui n'a
   * ôté que des battements de cœur l'allume aussi.
   *
   * Vrai quand l'une de ces trois choses est vraie :
   *   · le registre compte un fait de ces types retiré pour un motif qui touche
   *     une tâche connue (`MOTIFS_FAIT_CONNU` : échu, ou pris par le plafond), et
   *     une tâche créée avant le DERNIER de ces retraits est toujours là. Une
   *     tâche créée après n'a rien pu y perdre ; quand la dernière d'avant
   *     disparaît (`pruneTasks`), l'aveu tombe avec elle — le Genome ignore déjà
   *     les faits d'une tâche disparue. Sans ce lien, un seul fait échu
   *     allumait « tronqué » pour toute la vie de la base. Le lien reste
   *     CONSERVATEUR : le registre compte par type et par motif, pas par tâche,
   *     si bien qu'une vieille tâche restée en `ready` tient l'aveu allumé pour
   *     un fait échu d'une AUTRE. Il peut dire « tronqué » à tort, jamais
   *     « complet » à tort ;
   *   · l'ancienne rétention a supprimé des lignes de types inconnus
   *     (`avant_registre`) et une tâche créée avant qu'on le constate est
   *     toujours là — ses faits ont pu partir avec ;
   *   · le journal a perdu des lignes que le registre n'explique pas, par un
   *     autre chemin que `pruneEvents` : inconnu, donc compté comme une perte.
   * Les traces et les orphelines n'y entrent pas : un repli par tâche ignore
   * déjà les événements d'une tâche disparue, et une trace n'en nomme aucune.
   */
  faitsElagues(types: readonly string[]): boolean {
    if (types.length === 0) return false;
    const marques = types.map(() => '?').join(', ');
    const motifs = MOTIFS_FAIT_CONNU.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT
           EXISTS (SELECT 1 FROM tasks
                    WHERE createdAt <= (SELECT MAX(dernierA) FROM journal_elagages
                                         WHERE type IN (${marques})
                                           AND motif IN (${motifs}))) AS connus,
           EXISTS (SELECT 1 FROM tasks
                    WHERE createdAt <= (SELECT dernierA FROM journal_elagages
                                         WHERE motif = 'avant_registre')) AS anciens,
           COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'events'), 0)
             - (SELECT COUNT(*) FROM events)
             - COALESCE((SELECT SUM(supprimes) FROM journal_elagages), 0) AS inexpliques`,
      )
      .get(...types, ...MOTIFS_FAIT_CONNU) as {
      connus: number;
      anciens: number;
      inexpliques: number;
    };
    return row.connus === 1 || row.anciens === 1 || row.inexpliques > 0;
  }

  /**
   * Dernier événement d'un type donné dont le payload mentionne `taskId`.
   * Sert à retrouver l'issue d'une course tranchée (drone_won) : la course
   * elle-même ne vit qu'en mémoire du scheduler et disparaît à la victoire —
   * le journal est la seule trace durable (dans la limite de l'élagage).
   */
  lastEventFor(type: string, taskId: string): HiveEvent | null {
    // json_extract (JSON1, embarqué dans better-sqlite3) : correspondance
    // EXACTE du taskId — un LIKE laisserait les jokers %/_ d'un id fourni par
    // le client (ou par le LLM Queen Bee) matcher la victoire d'une AUTRE
    // tâche (`build_api` matcherait `build-api`).
    const row = this.db
      .prepare(
        `SELECT * FROM events WHERE type = ? AND ${TACHE_DE_L_EVENEMENT} = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(type, taskId) as EventRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      ts: row.ts,
      type: row.type,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    };
  }

  /**
   * Les événements d'UNE tâche, de types donnés, dans l'ordre du journal.
   *
   * Même correspondance exacte que `lastEventFor` (json_extract, jamais LIKE :
   * un id client contenant `%` ou `_` ne doit pas ramasser les événements d'une
   * autre tâche). Bornée : le journal complet reste lisible par `/api/events`.
   */
  evenementsDeTache(taskId: string, types: readonly string[], limite = 100): HiveEvent[] {
    if (types.length === 0) return [];
    const marques = types.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM events
          WHERE type IN (${marques})
            AND ${TACHE_DE_L_EVENEMENT} = ?
          ORDER BY id DESC LIMIT ?`,
      )
      .all(...types, taskId, Math.max(1, Math.min(limite, 500))) as EventRow[];
    const evenements: HiveEvent[] = [];
    for (const row of rows.reverse()) {
      try {
        evenements.push({
          id: row.id,
          ts: row.ts,
          type: row.type,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        });
      } catch {
        // Payload illisible : ignoré, jamais deviné.
      }
    }
    return evenements;
  }

  /**
   * Les `limite` derniers événements de quelques types, rendus en ordre
   * chronologique. Sert les replis qui lisent tout le journal retenu (registre
   * Genome) : bornés par l'appelant, jamais au-delà de 10 000 lignes.
   */
  evenementsParTypes(types: readonly string[], limite: number): HiveEvent[] {
    if (types.length === 0) return [];
    const marques = types.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE type IN (${marques}) ORDER BY id DESC LIMIT ?`)
      .all(...types, Math.max(1, Math.min(limite, 10_000))) as EventRow[];
    const evenements: HiveEvent[] = [];
    for (const row of rows.reverse()) {
      try {
        evenements.push({
          id: row.id,
          ts: row.ts,
          type: row.type,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        });
      } catch {
        // Payload illisible : ignoré, jamais deviné.
      }
    }
    return evenements;
  }

  /**
   * Retrouve l'événement de lancement qui contient une relecture précise.
   *
   * Le lien tâche→production reste dans `contre_expertises`, mais le résultat
   * exact est une observation de l'instant du lancement. Le journal porte donc
   * ce filigrane sans ajouter de colonne SQLite à une table existante.
   */
  eventForRelecture(relectureTaskId: string): HiveEvent | null {
    const row = this.db
      .prepare(
        `SELECT e.* FROM events e, json_each(e.payload, '$.relectures') r
         WHERE e.type = 'contre_expertise' AND r.value = ?
         ORDER BY e.id DESC LIMIT 1`,
      )
      .get(relectureTaskId) as EventRow | undefined;
    if (!row) return null;
    try {
      return {
        id: row.id,
        ts: row.ts,
        type: row.type,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
      };
    } catch {
      return null;
    }
  }

  /**
   * Dernière preuve de validation d'un résultat précis, quelle qu'en soit la
   * source : CI GitHub (`github_pull_request`) ou bac Hive (`hive_sandbox`).
   *
   * La plus RÉCENTE gouverne, avec SA provenance entière — jamais un mélange
   * état par état de deux sources, qui afficherait une provenance que la
   * moitié des états n'a pas. En pratique le bac range la sienne à la
   * réception du résultat, et une CI ingérée ensuite pour ce même résultat la
   * remplace : le geste humain le plus récent a le dernier mot. La route
   * d'ingestion ne range jamais une CI qui tourne encore ni une PR sans
   * contrôle lisible — un inconnu n'écrase pas un connu.
   *
   * Les preuves vivent dans le journal d'événements : aucune seconde table ne
   * pourrait rester alignée avec les résultats élagués. Toute charge persistée
   * est revalidée avant de rejoindre l'Evaluator — celle du bac par les règles
   * mêmes qui l'ont admise du réseau (`validationsBacDepuis`) —, car le journal
   * est une trace, pas une zone de confiance.
   *
   * `ci_validation_recorded` est le nom sous lequel les preuves GitHub étaient
   * rangées avant que le bac n'en produise : relu pour ne pas effacer une
   * preuve déjà ingérée, il sort du journal avec l'élagage.
   */
  latestValidation(
    taskId: string,
    resultId: number,
  ): { validation: ValidationEvidence; provenance: ValidationProvenance } | null {
    const row = this.db
      .prepare(
        `SELECT * FROM events
         WHERE type IN ('validation_recorded', 'ci_validation_recorded')
           AND ${TACHE_DE_L_EVENEMENT} = ?
           AND json_extract(payload, '$.resultId') = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId, resultId) as EventRow | undefined;
    if (!row) return null;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      return null;
    }
    const text = (key: string): string =>
      typeof payload[key] === 'string' ? (payload[key] as string) : '';
    const integer = (key: string): number =>
      typeof payload[key] === 'number' && Number.isSafeInteger(payload[key])
        ? (payload[key] as number)
        : 0;
    const etats = payload.validation;
    if (typeof etats !== 'object' || etats === null) return null;
    const commun = {
      taskId: text('taskId'),
      projectId: text('projectId'),
      resultId: integer('resultId'),
      recordedAt: integer('recordedAt'),
    };
    if (
      commun.taskId !== taskId ||
      commun.resultId !== resultId ||
      !commun.projectId ||
      commun.recordedAt <= 0
    ) {
      return null;
    }

    if (payload.source === 'hive_sandbox' && row.type === 'validation_recorded') {
      const details = payload.details;
      const nodeId = text('nodeId');
      if (!nodeId || typeof details !== 'object' || details === null) return null;
      const bac = validationsBacDepuis({
        ...(payload.baseSha !== undefined ? { baseSha: payload.baseSha } : {}),
        controles: Object.fromEntries(
          VALIDATION_KEYS.map((key) => [
            key,
            {
              ...((details as Record<string, unknown>)[key] as object),
              etat: (etats as Record<string, unknown>)[key],
            },
          ]),
        ),
      });
      if (!bac) return null;
      const validation = {} as ValidationEvidence;
      const provenance: ProvenanceBac = {
        source: 'hive_sandbox',
        ...commun,
        nodeId,
        ...(bac.baseSha ? { baseSha: bac.baseSha } : {}),
        details: {} as ProvenanceBac['details'],
      };
      for (const key of VALIDATION_KEYS) {
        const { etat, ...detail } = bac.controles[key];
        validation[key] = etat;
        provenance.details[key] = detail;
      }
      return { validation, provenance };
    }

    if (payload.source !== 'github_pull_request') return null;
    const validation = {} as ValidationEvidence;
    for (const key of VALIDATION_KEYS) {
      const value = (etats as Record<string, unknown>)[key];
      validation[key] = estEtatDeValidation(value) ? value : 'missing';
    }
    const provenance: ProvenanceGithub = {
      source: 'github_pull_request',
      ...commun,
      depot: text('depot'),
      pr: integer('pr'),
      branch: text('branch'),
      commitSha: text('commitSha'),
    };
    if (!provenance.depot || provenance.pr <= 0 || !provenance.branch || !provenance.commitSha) {
      return null;
    }
    return { validation, provenance };
  }

  /**
   * La cause consignée quand la contre-revue de CE résultat s'est révélée
   * impossible (`contre_expertise_impossible`), ou `null`.
   *
   * Un fait du journal, comme les avis et les preuves CI : c'est au moment où
   * la dernière relecture tombe que la cause est connue, et c'est là qu'elle
   * est écrite. Relue à chaque verdict de l'Evaluator plutôt que redéduite de
   * trois signaux (relectures échouées, secours tenté, nœuds en ligne) dont
   * l'état a changé depuis.
   */
  contreRevueImpossible(taskId: string, resultId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT payload FROM events
         WHERE type = 'contre_expertise_impossible'
           AND ${TACHE_DE_L_EVENEMENT} = ?
           AND json_extract(payload, '$.resultId') = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId, resultId) as { payload: string } | undefined;
    if (!row) return null;
    try {
      const cause = (JSON.parse(row.payload) as Record<string, unknown>).cause;
      return typeof cause === 'string' && cause.length > 0 ? champSurUneLigne(cause, 500) : null;
    } catch {
      return null;
    }
  }

  /** Résumé de toutes les contre-revues indépendantes d'un résultat exact. */
  crossReviewForResult(taskId: string, resultId: number): CrossReviewEvidence | null {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE type = 'contre_expertise_verdict'
           AND ${TACHE_DE_L_EVENEMENT} = ?
           AND json_extract(payload, '$.resultId') = ?
         ORDER BY id ASC`,
      )
      .all(taskId, resultId) as EventRow[];
    const votes: CrossReviewVote[] = [];
    const avis: Avis[] = [];

    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      const task = payload.taskId;
      const result = payload.resultId;
      const relecture = payload.relecture;
      const reviewerNodeId = payload.reviewerNodeId;
      const reviewerAgent = payload.relecteur;
      // `producteur` voyage avec chaque avis depuis que la contre-expertise
      // existe (bien avant `reviewerNodeId`) : un avis sans lui n'est pas un
      // avis de cette ruche, et l'Evaluator ne pourrait pas en vérifier
      // l'indépendance.
      const producerAgent = payload.producteur;
      const objections = payload.objections;
      // Les constats d'un marqueur `HIVE_CRITIQUE` lu (`noterVerdict`).
      // Absents : une critique libre. Présents mais hors grille : ce payload
      // n'a pas été écrit par la ruche, et l'avis est écarté comme le sont des
      // objections illisibles — jamais relu à moitié.
      const constats = payload.findings === undefined ? [] : lireConstats(payload.findings);
      if (
        constats === null ||
        payload.source !== 'hive_counter_review' ||
        task !== taskId ||
        result !== resultId ||
        typeof payload.conteste !== 'boolean' ||
        typeof relecture !== 'string' ||
        relecture.length === 0 ||
        typeof reviewerNodeId !== 'string' ||
        reviewerNodeId.length === 0 ||
        typeof reviewerAgent !== 'string' ||
        reviewerAgent.length === 0 ||
        typeof producerAgent !== 'string' ||
        producerAgent.length === 0 ||
        !Array.isArray(objections) ||
        objections.some((objection) => typeof objection !== 'string')
      ) {
        continue;
      }

      const boundedObjections = objections
        .slice(0, 20)
        .map((objection) => champSurUneLigne(objection, 300).trim())
        .filter((objection) => objection !== '');
      const decision =
        payload.conteste === true || boundedObjections.length > 0 || constats.some(constatBloquant)
          ? 'ameliorer'
          : 'appliquer';
      votes.push({
        relectureTaskId: relecture,
        reviewerNodeId,
        reviewerAgent,
        producerAgent,
        decision,
        reason: boundedObjections[0] ?? '',
        recordedAt: row.ts,
      });
      avis.push({
        nodeId: reviewerNodeId,
        agentType: reviewerAgent,
        valide: decision === 'appliquer',
        objections: boundedObjections,
        ...(payload.findings === undefined ? {} : { marqueur: { etat: 'lu' as const, constats } }),
      });
    }

    if (votes.length === 0) return null;
    const verdict = agreger(avis);
    return {
      source: 'hive_counter_review',
      taskId,
      resultId,
      status: verdict.conteste ? 'improvement_required' : 'applied',
      decision: verdict.conteste ? 'ameliorer' : 'appliquer',
      reviewers: votes,
      objections: verdict.objections,
      findings: verdict.constats,
      reviewerCount: votes.length,
      contestingReviewers: votes.filter((vote) => vote.decision === 'ameliorer').length,
      approvingReviewers: votes.filter((vote) => vote.decision === 'appliquer').length,
      recordedAt: Math.max(...votes.map((vote) => vote.recordedAt)),
    };
  }

  /**
   * Événements d'une FENÊTRE TEMPORELLE, restreints à quelques types. Sert la
   * thermorégulation : borner la lecture à un lot des N derniers événements
   * rendait la fenêtre de 10 minutes fictive dès que la ruche était active (un
   * flot de `task_progress` évinçait les issues). Servi par l'index
   * `idx_events_ts` — pas de tri temporaire, pas de scan complet.
   *
   * `INDEXED BY` : le plan est ÉPINGLÉ, parce qu'il a déjà bougé seul. Depuis
   * `idx_events_type`, le planificateur préférait l'égalité sur le type à la
   * borne sur `ts` — or ces quatre types sont des preuves que la rétention garde
   * des semaines : il aurait relu, et trié, toutes les issues retenues pour en
   * garder dix minutes, à chaque tick. Épinglé, un index disparu fait échouer
   * la requête au lieu de la ralentir en silence (le rôle que la documentation
   * de SQLite donne à cette clause).
   *
   * Sans les tâches du BANC (`TACHES_DU_BANC_SQL`) : la température dit la
   * santé de la PRODUCTION. Une ombre qui échoue — second modèle plus faible,
   * modèle disparu — ferait monter la fièvre et brider la concurrence de
   * toute la ruche pour une tâche que personne n'attend.
   */
  listEventsInWindow(
    since: number,
    types: readonly string[],
  ): Array<{ type: string; ts: number; payload: Record<string, unknown> }> {
    if (types.length === 0) return [];
    const placeholders = types.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT ts, type, payload FROM events INDEXED BY idx_events_ts
          WHERE ts >= ? AND type IN (${placeholders})
            AND COALESCE(${TACHE_DE_L_EVENEMENT}, '')
                NOT IN (SELECT id FROM (${TACHES_DU_BANC_SQL}))
          ORDER BY ts`,
      )
      .all(since, ...types) as Array<{ ts: number; type: string; payload: string }>;
    return rows.map((r) => ({
      type: r.type,
      ts: r.ts,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }));
  }

  listEvents(sinceId = 0, limit = 200): HiveEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE id > ? ORDER BY id LIMIT ?')
      .all(sinceId, Math.max(1, Math.min(limit, 1000))) as EventRow[];
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      type: r.type,
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }));
  }

  /**
   * Derniers événements liés à une ouvrière, pour la Chambre.
   *
   * Les tâches gardent leur résultat et les résultats gardent le nodeId : la
   * sous-requête couvre donc aussi une tâche terminée ou réassignée, sans
   * ajouter une colonne d'événement ni charger tout le journal en mémoire.
   * La limite est volontairement petite : l'interface affiche une fenêtre,
   * tandis que le journal complet reste disponible par `/api/events`.
   */
  listEventsForNode(nodeId: string, limit = 80): HiveEvent[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM events e
         WHERE json_extract(CASE WHEN json_valid(e.payload) THEN e.payload ELSE '{}' END, '$.nodeId') = ?
            OR json_extract(CASE WHEN json_valid(e.payload) THEN e.payload ELSE '{}' END, '$.taskId') IN (
                 SELECT t.id FROM tasks t WHERE t.assignedNodeId = ?
                 UNION
                 SELECT r.taskId FROM results r WHERE r.nodeId = ?
               )
         ORDER BY e.id DESC LIMIT ?`,
      )
      .all(nodeId, nodeId, nodeId, Math.max(1, Math.min(limit, 200))) as EventRow[];
    const events: HiveEvent[] = [];
    for (const row of rows) {
      try {
        events.push({
          id: row.id,
          ts: row.ts,
          type: row.type,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        });
      } catch {
        // A malformed historical payload must not make the Worker page fail.
      }
    }
    return events;
  }

  /**
   * Les branches de mission que le journal a vues passer sous ce préfixe —
   * commitées (`livraison_locale`) ou rendues trop tard (`merge_result_ignored`).
   *
   * Sert de PLANCHER au numéro de la livraison suivante : une branche gardée
   * sur une ouvrière, non poussée, n'est visible d'aucune autre ouvrière ; le
   * hub, lui, l'a journalisée. Plancher au mieux, et assumé comme tel :
   * l'élagage du journal peut en avoir oublié, et le nœud croise de toute
   * façon ses propres branches et celles du dépôt. Le préfixe filtre ; c'est
   * `numeroDeMission` qui tranche (`hive/mission-p-` couvre aussi le projet
   * `p-1`).
   */
  /**
   * Les commits journalisés d'UNE branche de mission, dans l'ordre : qui l'a
   * commitée (le nœud qui la tient) et à quel commit. Le dernier est sa tête.
   *
   * C'est ce que prolonger une mission relit (`livraison-locale`, `prolonger`) :
   * la tête que la RUCHE a livrée, jamais ce qu'un dépôt en dirait. Correspondance
   * exacte (json_extract), comme `lastEventFor`.
   */
  commitsDeMission(projectId: string, branche: string): Array<{ nodeId: string; commit: string }> {
    const rows = this.db
      .prepare(
        `SELECT json_extract(payload, '$.nodeId') AS nodeId, json_extract(payload, '$.commit') AS sha
           FROM events
          WHERE type = 'livraison_locale'
            AND json_extract(payload, '$.etat') = 'commitee'
            AND json_extract(payload, '$.projectId') = ?
            AND json_extract(payload, '$.branche') = ?
          ORDER BY id ASC`,
      )
      .all(projectId, branche) as Array<{ nodeId: unknown; sha: unknown }>;
    // `sha` et pas `commit` : COMMIT est un mot réservé de SQLite.
    return rows.flatMap((r) =>
      typeof r.nodeId === 'string' && typeof r.sha === 'string'
        ? [{ nodeId: r.nodeId, commit: r.sha }]
        : [],
    );
  }

  branchesDeMissionJournalisees(prefixe: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$.branche') AS branche
         FROM events
         WHERE type IN ('livraison_locale', 'merge_result_ignored')
           AND substr(json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$.branche'), 1, ?) = ?`,
      )
      .all(prefixe.length, prefixe) as Array<{ branche: unknown }>;
    return rows.flatMap((r) => (typeof r.branche === 'string' ? [r.branche] : []));
  }

  /** Événements de délégation d'un graphe, bornés par le journal courant. */
  listDelegationEvents(rootTaskId: string): HiveEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE type IN ('delegation_created', 'delegation_replayed', 'delegation_rejected', 'delegation_result', 'delegation_cancelled')
           AND (json_extract(payload, '$.rootTaskId') = ? OR json_extract(payload, '$.parentTaskId') = ?)
         ORDER BY id`,
      )
      .all(rootTaskId, rootTaskId) as EventRow[];
    const events: HiveEvent[] = [];
    for (const row of rows) {
      try {
        events.push({
          id: row.id,
          ts: row.ts,
          type: row.type,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        });
      } catch {
        // Un événement illisible ne doit pas rendre le graphe entier indisponible.
      }
    }
    return events;
  }

  // ─── Hive Mind (mémoire partagée) ──────────────────────────────────────────
  /** Enregistre (ou remplace) le souvenir d'une tâche. Un souvenir par tâche. */
  recordMemory(
    m: { projectId: string; taskId: string; title: string; content: string },
    now = Date.now(),
  ): Memory {
    const content = m.content.slice(0, LIMITS.prompt);
    // La dernière réussite fait foi : on remplace tout souvenir antérieur.
    this.db.prepare('DELETE FROM memories WHERE taskId = ?').run(m.taskId);
    const info = this.db
      .prepare(
        'INSERT INTO memories (projectId, taskId, title, content, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(m.projectId, m.taskId, m.title.slice(0, LIMITS.title), content, now);
    return {
      id: Number(info.lastInsertRowid),
      projectId: m.projectId,
      taskId: m.taskId,
      title: m.title.slice(0, LIMITS.title),
      content,
      createdAt: now,
    };
  }

  /** Souvenirs les plus récents (corpus borné pour garder le scoring rapide). */
  listMemories(limit = 500): Memory[] {
    return this.db
      .prepare('SELECT * FROM memories ORDER BY createdAt DESC, id DESC LIMIT ?')
      .all(Math.max(1, Math.min(limit, 2000))) as MemoryRow[];
  }

  countMemories(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM memories').get() as { n: number };
    return row.n;
  }

  /**
   * Récupère les souvenirs pertinents (BM25 + trigrammes sur le corpus récent).
   *
   * `exclureTache` : le souvenir de CETTE tâche ne compte pas. Une ombre rejoue
   * une tâche dont la production a déjà laissé un souvenir — même titre, même
   * prompt, donc le plus pertinent de tous : le lui servir, c'était lui
   * souffler la réponse de l'autre modèle, et la comparaison ne mesurait plus
   * rien.
   */
  searchMemories(query: string, limit = 3, exclureTache?: string): ScoredMemory[] {
    const souvenirs = this.listMemories(500);
    return rankMemoriesHybrid(
      query,
      exclureTache === undefined ? souvenirs : souvenirs.filter((m) => m.taskId !== exclureTache),
      limit,
    );
  }

  /**
   * Range le souvenir qu'une production réussie PROPOSE — sans l'écrire dans
   * la mémoire (voir `souvenirs_proposes`). Une nouvelle production de la même
   * tâche remplace la proposition précédente, issue comprise.
   */
  proposerSouvenir(
    m: { projectId: string; taskId: string; resultId: number; title: string; content: string },
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO souvenirs_proposes
           (taskId, resultId, projectId, title, content, issue, proposeA)
         VALUES (?, ?, ?, ?, ?, 'en_attente', ?)`,
      )
      .run(
        m.taskId,
        m.resultId,
        m.projectId,
        m.title.slice(0, LIMITS.title),
        m.content.slice(0, LIMITS.prompt),
        now,
      );
  }

  /** La proposition en cours pour une tâche : la production visée et son issue. */
  souvenirPropose(taskId: string): { resultId: number; issue: IssueSouvenir } | null {
    const row = this.db
      .prepare('SELECT resultId, issue FROM souvenirs_proposes WHERE taskId = ?')
      .get(taskId) as { resultId: number; issue: IssueSouvenir } | undefined;
    return row ?? null;
  }

  /**
   * Adopte le souvenir qu'une tâche a laissé AVANT ce registre : jusque-là, la
   * mémoire s'écrivait à la simple réussite, sans proposition. Sans adoption,
   * un rejet rendu aujourd'hui sur une telle production ne trouverait rien à
   * statuer — le souvenir jamais validé resterait, et l'échec ne laisserait
   * aucun épisode. C'est exactement l'arriéré de la Miellerie au jour de la
   * mise à jour.
   *
   * Paresseuse plutôt qu'au démarrage (règle 2 : aucune migration) : la
   * proposition naît au premier fait qui juge la tâche, sur son DERNIER
   * résultat, `retenu` puisque le souvenir est en mémoire — `validePar`
   * inconnu, donc qu'aucune preuve qui vieillit ne retire. Rend `true` quand
   * une proposition vient d'être adoptée.
   */
  adopterSouvenirHerite(taskId: string): boolean {
    return (
      this.db
        .prepare(
          `INSERT INTO souvenirs_proposes (taskId, resultId, projectId, title, content, issue, proposeA)
           SELECT m.taskId, r.resultId, m.projectId, m.title, m.content, 'retenu', m.createdAt
             FROM memories m, (SELECT MAX(id) AS resultId FROM results WHERE taskId = ?) r
            WHERE m.taskId = ? AND r.resultId IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM souvenirs_proposes WHERE taskId = ?)
            ORDER BY m.createdAt DESC, m.id DESC
            LIMIT 1`,
        )
        .run(taskId, taskId, taskId).changes > 0
    );
  }

  /**
   * Applique à la proposition de `resultId` le verdict qui vient d'être rendu,
   * et rend ce qui a CHANGÉ — `null` quand l'issue n'a pas bougé (verdict
   * identique, preuve vieillie qui ne révoque pas, ou proposition qui ne vise
   * plus cette production).
   *
   * UN seul geste : l'issue et la mémoire bougent ensemble, sinon un souvenir
   * pourrait rester dans la mémoire d'une production marquée rejetée.
   * `oublie` dit qu'un souvenir vient d'en SORTIR — l'appelant le journalise.
   */
  statuerSouvenir(
    taskId: string,
    resultId: number,
    verdict: VerdictSouvenir,
    now = Date.now(),
  ): {
    avant: IssueSouvenir;
    apres: IssueSouvenir;
    memoire: Memory | null;
    oublie: boolean;
  } | null {
    return this.db.transaction(() => {
      const propose = this.db
        .prepare(
          `SELECT projectId, title, content, issue, validePar FROM souvenirs_proposes
            WHERE taskId = ? AND resultId = ?`,
        )
        .get(taskId, resultId) as
        | {
            projectId: string;
            title: string;
            content: string;
            issue: IssueSouvenir;
            validePar: ValidationSouvenir | null;
          }
        | undefined;
      if (!propose) return null;
      const apres = suiteSouvenir(propose.issue, verdict.issue, propose.validePar);
      if (apres === null) {
        // Toujours retenu, mais l'Evaluator accepte désormais ce que seul un
        // humain validait : c'est la validation la plus forte qu'on range —
        // effacer l'approbation ne retirera plus un savoir que l'Evaluator a
        // prouvé.
        if (
          propose.issue === 'retenu' &&
          verdict.validePar === 'evaluator' &&
          propose.validePar !== 'evaluator'
        ) {
          this.db
            .prepare(`UPDATE souvenirs_proposes SET validePar = 'evaluator' WHERE taskId = ?`)
            .run(taskId);
        }
        return null;
      }
      this.db
        .prepare('UPDATE souvenirs_proposes SET issue = ?, validePar = ? WHERE taskId = ?')
        .run(apres, apres === 'retenu' ? verdict.validePar : null, taskId);
      if (apres === 'retenu') {
        // Né à la validation, pas à la proposition : c'est l'instant où ce
        // savoir devient transmissible, et `pruneMemories` garde les plus
        // récents.
        const memoire = this.recordMemory(
          { projectId: propose.projectId, taskId, title: propose.title, content: propose.content },
          now,
        );
        return { avant: propose.issue, apres, memoire, oublie: false };
      }
      // Hors de « retenu », la tâche n'a plus AUCUN souvenir — pas même celui
      // d'une production antérieure qu'une nouvelle proposition a remplacée :
      // la dernière production de la tâche fait foi (`recordMemory`).
      const oublie =
        this.db.prepare('DELETE FROM memories WHERE taskId = ?').run(taskId).changes > 0;
      return { avant: propose.issue, apres, memoire: null, oublie };
    })();
  }

  /**
   * La porte qui a déjà versé au Cerveau l'échec de la production `resultId`,
   * ou `null` : aucune, ou la proposition vise une autre production.
   */
  episodeDeProduction(taskId: string, resultId: number): SourceEpisode | null {
    const row = this.db
      .prepare('SELECT episode FROM souvenirs_proposes WHERE taskId = ? AND resultId = ?')
      .get(taskId, resultId) as { episode: SourceEpisode | null } | undefined;
    return row?.episode ?? null;
  }

  /**
   * Consigne que l'échec de la production `resultId` a été versé au Cerveau
   * par `source`. La première porte reste : c'est elle qui a écrit l'épisode.
   */
  marquerEpisodeProduction(taskId: string, resultId: number, source: SourceEpisode): void {
    this.db
      .prepare(
        `UPDATE souvenirs_proposes SET episode = ?
          WHERE taskId = ? AND resultId = ? AND episode IS NULL`,
      )
      .run(source, taskId, resultId);
  }

  /**
   * Propositions dont la tâche n'existe plus : borne RÉFÉRENTIELLE, câblée
   * après `pruneTasks` (motif `pruneAiguillageModeles`). Le souvenir retenu,
   * lui, reste dans `memories` : le savoir dure plus longtemps que la tâche.
   */
  pruneSouvenirsProposes(): number {
    return this.db
      .prepare('DELETE FROM souvenirs_proposes WHERE taskId NOT IN (SELECT id FROM tasks)')
      .run().changes;
  }

  /** Ne conserve que les `maxKeep` souvenirs les plus récents. Retourne le nombre supprimé. */
  pruneMemories(maxKeep: number): number {
    const keep = Math.max(0, maxKeep);
    // Une relecture n'est pas un savoir sur le projet (`proposerSouvenir`,
    // scheduler.ts) — mais avant ce registre, chacune laissait son « valide »
    // ou son « conteste » en mémoire, servi aux tâches voisines. Purgées ici,
    // à chaque passe : idempotent, et borné par la table des relectures.
    const relectures = this.db
      .prepare(
        'DELETE FROM memories WHERE taskId IN (SELECT relectureTaskId FROM contre_expertises)',
      )
      .run().changes;
    const info = this.db
      .prepare(
        'DELETE FROM memories WHERE id NOT IN (SELECT id FROM memories ORDER BY createdAt DESC, id DESC LIMIT ?)',
      )
      .run(keep);
    return relectures + info.changes;
  }

  // ─── Revues humaines (Miellerie) ───────────────────────────────────────────
  /**
   * Enregistre le verdict de revue humaine d'une tâche ; `null` efface la
   * revue. Le verdict est partagé entre tous les opérateurs du dashboard.
   */
  setTaskReview(taskId: string, state: 'approved' | 'rejected' | null): void {
    if (state === null) {
      this.db.prepare('DELETE FROM reviews WHERE taskId = ?').run(taskId);
      return;
    }
    // updatedAt STRICTEMENT croissant par ligne : deux écritures dans la même
    // milliseconde doivent produire des horodatages distincts, sinon le
    // compare-and-set (expectedUpdatedAt) laisserait passer un écrasement ABA.
    const prev = this.getTaskReview(taskId)?.updatedAt ?? 0;
    this.db
      .prepare(
        `INSERT INTO reviews (taskId, state, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(taskId) DO UPDATE SET state = excluded.state, updatedAt = excluded.updatedAt`,
      )
      .run(taskId, state, Math.max(Date.now(), prev + 1));
  }

  /**
   * Verdicts des SEULES tâches citées. C'était la dernière lecture NON BORNÉE
   * du socle de la Balance : `listReviews()` dépliait toute la table `reviews`
   * (jamais élaguée, elle) pour n'en garder que les ≤ 2 000 clés du corpus —
   * 159,8 ms mesurées à 100 000 revues, contre 6,0 ms en lecture ciblée. Sur un
   * socle re-lu toutes les 3 s parce que le dashboard interroge `/api/balance`,
   * cela faisait ~160 ms de boucle d'événements BLOQUÉE toutes les 3 secondes,
   * en permanence : chaque blocage retardait le tick du Scheduler et tout le
   * trafic WebSocket.
   *
   * Même découpage en lots de 900 que `lireParIds` sur `tasks`, sur la clé
   * primaire `reviews.taskId`.
   */
  listReviewsFor(ids: readonly string[]): Record<string, 'approved' | 'rejected'> {
    const rows = this.lireParIds<{ taskId: string; state: 'approved' | 'rejected' }>(
      'taskId, state',
      ids,
      'reviews',
      'taskId',
    );
    return Object.fromEntries(rows.map((r) => [r.taskId, r.state]));
  }

  /**
   * Toutes les revues, sous forme de dictionnaire taskId → verdict.
   *
   * NON BORNÉE, et assumée comme telle : elle sert les vues de REVUE (la
   * Miellerie), dont l'objet est justement de montrer tous les verdicts. Elle
   * n'a rien à faire sur un chemin de polling ni dans un tick — pour n'en
   * connaître qu'un sous-ensemble, `listReviewsFor`.
   */
  listReviews(): Record<string, 'approved' | 'rejected'> {
    const rows = this.db.prepare('SELECT taskId, state FROM reviews').all() as {
      taskId: string;
      state: 'approved' | 'rejected';
    }[];
    return Object.fromEntries(rows.map((r) => [r.taskId, r.state]));
  }

  /** Horodatage de chaque verdict (compare-and-set multi-opérateurs). */
  listReviewTimestamps(): Record<string, number> {
    const rows = this.db.prepare('SELECT taskId, updatedAt FROM reviews').all() as {
      taskId: string;
      updatedAt: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.taskId, r.updatedAt]));
  }

  /** Verdict + horodatage d'une tâche (null si aucune revue). */
  getTaskReview(taskId: string): { state: 'approved' | 'rejected'; updatedAt: number } | null {
    const row = this.db
      .prepare('SELECT state, updatedAt FROM reviews WHERE taskId = ?')
      .get(taskId) as { state: 'approved' | 'rejected'; updatedAt: number } | undefined;
    return row ?? null;
  }

  // ─── Les missions rejouables (src/shared/mission-rejouable.ts) ─────────────

  /** La mission OUVERTE d'un projet (il n'y en a jamais qu'une), ou `null`. */
  missionOuverte(projectId: string): MissionRangee | null {
    const row = this.db
      .prepare(
        'SELECT * FROM missions WHERE projectId = ? AND closeA IS NULL ORDER BY ouverteA DESC LIMIT 1',
      )
      .get(projectId) as MissionRangee | undefined;
    return row ?? null;
  }

  getMission(id: string): MissionRangee | null {
    const row = this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as
      MissionRangee | undefined;
    return row ?? null;
  }

  /** Les missions d'un projet, de la plus récente à la plus ancienne. */
  listMissions(projectId: string, limite = 50): MissionRangee[] {
    return this.db
      .prepare('SELECT * FROM missions WHERE projectId = ? ORDER BY ouverteA DESC, id LIMIT ?')
      .all(projectId, Math.max(1, Math.min(limite, 200))) as MissionRangee[];
  }

  /**
   * Ouvre une mission AVEC son instantané de début, en une écriture.
   *
   * Conditionnelle : si une mission est déjà ouverte sur ce projet (deux
   * créations de tâches rapprochées ont chacune programmé une ouverture), la
   * seconde ne fait rien et rend `false` — « une seule mission ouverte par
   * projet » tient par la base, pas par la chance de l'ordonnancement.
   */
  ouvrirMission(m: {
    id: string;
    projectId: string;
    ouverteA: number;
    depuisEvenement: number;
    membres: readonly string[];
    debut: string;
  }): boolean {
    return this.enTransaction(() => {
      if (this.missionOuverte(m.projectId)) return false;
      this.db
        .prepare(
          `INSERT INTO missions (id, projectId, ouverteA, closeA, depuisEvenement, debut, fin)
           VALUES (?, ?, ?, NULL, ?, ?, NULL)`,
        )
        .run(m.id, m.projectId, m.ouverteA, m.depuisEvenement, m.debut);
      this.ajouterMembresMission(m.id, m.membres);
      // La PREMIÈRE mission d'un projet de rejeu est celle que la comparaison
      // oppose à la source : rangée ici, une fois, dans la même écriture.
      this.db
        .prepare('UPDATE rejeux SET missionRejeu = ? WHERE projectId = ? AND missionRejeu IS NULL')
        .run(m.id, m.projectId);
      return true;
    });
  }

  /** Range des tâches dans une mission (idempotent). */
  ajouterMembresMission(missionId: string, taskIds: readonly string[]): void {
    const inserer = this.db.prepare(
      'INSERT OR IGNORE INTO missions_taches (missionId, taskId) VALUES (?, ?)',
    );
    for (const id of taskIds) inserer.run(missionId, id);
  }

  /** Les tâches rangées dans une mission. */
  membresDeMission(missionId: string): string[] {
    return (
      this.db
        .prepare('SELECT taskId FROM missions_taches WHERE missionId = ? ORDER BY taskId')
        .all(missionId) as Array<{ taskId: string }>
    ).map((r) => r.taskId);
  }

  /** La dernière mission CLOSE d'un projet, ou `null`. */
  derniereMissionClose(projectId: string): MissionRangee | null {
    const row = this.db
      .prepare(
        `SELECT * FROM missions WHERE projectId = ? AND closeA IS NOT NULL
          ORDER BY closeA DESC, ouverteA DESC LIMIT 1`,
      )
      .get(projectId) as MissionRangee | undefined;
    return row ?? null;
  }

  /**
   * Re-prend l'instantané de FIN d'une mission close : une décision tombée
   * APRÈS la clôture sur l'une de ses tâches (relecture humaine, livraison,
   * action de rejeu) lui appartient. `closeA` ne bouge pas.
   */
  rafraichirFinMission(id: string, fin: string): boolean {
    return (
      this.db
        .prepare('UPDATE missions SET fin = ? WHERE id = ? AND closeA IS NOT NULL')
        .run(fin, id).changes > 0
    );
  }

  /** Clôt une mission avec son instantané de fin — une seule fois. */
  cloreMission(id: string, closeA: number, fin: string): boolean {
    const info = this.db
      .prepare('UPDATE missions SET closeA = ?, fin = ? WHERE id = ? AND closeA IS NULL')
      .run(closeA, fin, id);
    return info.changes > 0;
  }

  /** Tâches encore EN VOL d'un projet (productions comme relectures). */
  compterTachesVivantes(projectId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks
          WHERE projectId = ? AND status IN ('pending', 'ready', 'assigned', 'running')`,
      )
      .get(projectId) as { n: number };
    return row.n;
  }

  /**
   * La plus ancienne naissance parmi les tâches EN VOL nées APRÈS `apres` (la
   * clôture précédente) : elle date l'ouverture d'une mission. Une tâche
   * ranimée (relance de l'Evaluator, remise en file) garde sa vieille date de
   * naissance — la compter tirerait la mission dans le passé de la précédente.
   */
  naissanceDesNouvelles(projectId: string, apres: number): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(createdAt) AS a FROM tasks
          WHERE projectId = ? AND createdAt > ?
            AND status IN ('pending', 'ready', 'assigned', 'running')`,
      )
      .get(projectId, apres) as { a: number | null };
    return row.a;
  }

  /**
   * Les tâches d'un projet qu'une mission ouverte doit compter : celles EN VOL
   * (une ranimée y revient), et celles NÉES depuis `nees` (une tâche née et
   * finie entre deux relevés).
   */
  tachesAMissionner(projectId: string, nees: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT id FROM tasks WHERE projectId = ?
             AND (status IN ('pending', 'ready', 'assigned', 'running') OR createdAt >= ?)`,
        )
        .all(projectId, nees) as Array<{ id: string }>
    ).map((r) => r.id);
  }

  /** Les tâches de ces identifiants, dans l'ordre de création. Bornée. */
  tachesParIds(ids: readonly string[], limite = 1_000): Task[] {
    if (ids.length === 0) return [];
    return (
      this.db
        .prepare(
          `SELECT * FROM tasks WHERE id IN (SELECT value FROM json_each(?))
            ORDER BY createdAt, id LIMIT ?`,
        )
        .all(JSON.stringify(ids), limite) as TaskRow[]
    ).map(rowToTask);
  }

  /** Parmi ces tâches, celles qui sont des relectures ou des délégations. */
  rolesDesTaches(taskIds: readonly string[]): { relectures: Set<string>; deleguees: Set<string> } {
    const relectures = new Set<string>();
    const deleguees = new Set<string>();
    for (let i = 0; i < taskIds.length; i += 500) {
      const lot = taskIds.slice(i, i + 500);
      const marques = lot.map(() => '?').join(', ');
      for (const r of this.db
        .prepare(
          `SELECT relectureTaskId AS id FROM contre_expertises WHERE relectureTaskId IN (${marques})`,
        )
        .all(...lot) as Array<{ id: string }>) {
        relectures.add(r.id);
      }
      for (const r of this.db
        .prepare(`SELECT childTaskId AS id FROM task_delegations WHERE childTaskId IN (${marques})`)
        .all(...lot) as Array<{ id: string }>) {
        deleguees.add(r.id);
      }
    }
    return { relectures, deleguees };
  }

  /**
   * Le journal d'une mission : les événements de ces types, postérieurs à
   * `depuisId`, qui visent l'une de SES tâches (`membres`) — ou, sans tâche,
   * ce projet. Un événement d'une tâche du projet qui n'est pas de la mission
   * (la relecture tardive d'une mission précédente) n'y entre pas. En ordre
   * chronologique, borné.
   */
  evenementsDeMission(
    projectId: string,
    membres: readonly string[],
    depuisId: number,
    types: readonly string[],
    limite = 10_000,
  ): HiveEvent[] {
    if (types.length === 0) return [];
    const marques = types.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT *,
             json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$.taskId') AS tache,
             json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$.projectId') AS projet
             FROM events WHERE id > ? AND type IN (${marques})
         )
          WHERE (tache IS NULL AND projet = ?)
             OR tache IN (SELECT value FROM json_each(?))
          ORDER BY id LIMIT ?`,
      )
      .all(
        depuisId,
        ...types,
        projectId,
        JSON.stringify(membres),
        Math.max(1, Math.min(limite, 10_000)),
      ) as EventRow[];
    const evenements: HiveEvent[] = [];
    for (const row of rows) {
      try {
        evenements.push({
          id: row.id,
          ts: row.ts,
          type: row.type,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        });
      } catch {
        // Payload illisible : ignoré, jamais deviné.
      }
    }
    return evenements;
  }

  /** Le dernier événement journalisé STRICTEMENT avant `ts` (0 : aucun). */
  dernierEvenementAvant(ts: number): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM events WHERE ts < ?').get(ts) as {
      id: number | null;
    };
    return row.id ?? 0;
  }

  /**
   * Le journal couvre-t-il encore tout ce qui suit `depuisId` ? Faux dès que
   * l'élagage a emporté un événement postérieur — l'instantané le dira.
   */
  journalCouvre(depuisId: number): boolean {
    if (!this.journalElague()) return true;
    const row = this.db.prepare('SELECT MIN(id) AS id FROM events').get() as { id: number | null };
    // Journal vide après élagage : rien de ce qui suit `depuisId` n'est garanti.
    return row.id !== null && row.id <= depuisId + 1;
  }

  /** Marque un projet comme le rejeu d'une mission. */
  inscrireRejeu(r: Omit<RejeuRange, 'missionRejeu'>): void {
    this.db
      .prepare(
        `INSERT INTO rejeux (projectId, missionSource, projetSource, surcharges, genomeFige, creePar, creeA)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.projectId,
        r.missionSource,
        r.projetSource,
        JSON.stringify(r.surcharges),
        r.genomeFige ? JSON.stringify(r.genomeFige) : null,
        r.creePar,
        r.creeA,
      );
  }

  /** La marque de rejeu d'un projet, ou `null` : un projet ordinaire. */
  rejeuDuProjet(projectId: string): RejeuRange | null {
    const row = this.db.prepare('SELECT * FROM rejeux WHERE projectId = ?').get(projectId) as
      | (Omit<RejeuRange, 'surcharges' | 'genomeFige'> & {
          surcharges: string;
          genomeFige: string | null;
        })
      | undefined;
    if (!row) return null;
    let surcharges: Record<string, unknown> = {};
    try {
      const brut = JSON.parse(row.surcharges) as unknown;
      if (typeof brut === 'object' && brut !== null && !Array.isArray(brut)) {
        surcharges = brut as Record<string, unknown>;
      }
    } catch {
      // Illisible : aucune surcharge — le rejeu reste un rejeu (simulé), sans plus.
    }
    let genomeFige: AntecedentFige[] | null = null;
    try {
      const brut = row.genomeFige === null ? null : (JSON.parse(row.genomeFige) as unknown);
      // UNE entrée illisible rend TOUT le Genome illisible : en retirer une
      // rejouerait sous un vécu qui n'a jamais existé, sans le dire.
      const lisible = (a: unknown): a is AntecedentFige =>
        typeof a === 'object' &&
        a !== null &&
        ((a as AntecedentFige).niveau === 'modele' || (a as AntecedentFige).niveau === 'bras') &&
        typeof (a as AntecedentFige).cle === 'string' &&
        typeof (a as AntecedentFige).essais === 'number' &&
        typeof (a as AntecedentFige).recompenseTotale === 'number';
      if (Array.isArray(brut) && brut.every(lisible)) genomeFige = brut;
    } catch {
      // Illisible : `null` — l'ordonnanceur le dit (le rejeu figé attend).
    }
    return {
      ...row,
      genomeFige,
      surcharges: {
        ...(typeof surcharges.modele === 'string' ? { modele: surcharges.modele } : {}),
        ...(typeof surcharges.politiqueRoutage === 'string'
          ? { politiqueRoutage: surcharges.politiqueRoutage }
          : {}),
        ...(typeof surcharges.autonomie === 'string' ? { autonomie: surcharges.autonomie } : {}),
      },
    };
  }

  /** Les projets qui rejouent une mission. */
  rejeuxDeMission(missionId: string): string[] {
    return (
      this.db
        .prepare('SELECT projectId FROM rejeux WHERE missionSource = ? ORDER BY creeA, projectId')
        .all(missionId) as Array<{ projectId: string }>
    ).map((r) => r.projectId);
  }

  /**
   * Range une action irréversible d'un rejeu. Rend `true` si elle est NEUVE :
   * une demande répétée (la ruche autonome redemande à chaque cycle) n'est
   * rangée — et journalisée — qu'une fois.
   */
  enregistrerActionRejeu(
    a: { projectId: string; genre: string; cible: string; issue: 'simulee' | 'validee' },
    parUserId: string | null,
    now = Date.now(),
  ): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO rejeux_actions (projectId, genre, cible, issue, parUserId, creeA)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a.projectId, a.genre, a.cible, a.issue, parUserId, now);
    return info.changes > 0;
  }

  /** Cette action de rejeu est-elle déjà rangée (simulée ou validée) ? */
  actionRejeuRangee(projectId: string, genre: string, cible: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM rejeux_actions WHERE projectId = ? AND genre = ? AND cible = ? LIMIT 1',
        )
        .get(projectId, genre, cible) !== undefined
    );
  }

  /** Les actions irréversibles d'un rejeu, dans l'ordre où elles ont été demandées. */
  actionsDuRejeu(projectId: string, limite = 200): ActionRejeuRangee[] {
    return this.db
      .prepare(
        `SELECT genre, cible, issue, parUserId, creeA FROM rejeux_actions
          WHERE projectId = ? ORDER BY id LIMIT ?`,
      )
      .all(projectId, Math.max(1, Math.min(limite, 1_000))) as ActionRejeuRangee[];
  }

  /**
   * La borne des trois tables des missions (règle 3).
   *
   *   · une ligne dont le projet a disparu ne désigne plus rien ;
   *   · au-delà de `parProjet` missions, les plus vieilles partent — SAUF
   *     celles qu'un rejeu encore rangé compare (sa source, et la première
   *     mission du rejeu lui-même) : la comparaison dirait « élaguée » — ou
   *     pire, comparerait une autre mission — alors que l'humain la regarde ;
   *   · l'appartenance d'une mission partie part avec elle ;
   *   · les actions d'un rejeu au-delà de `parProjet * 10` partent, les plus
   *     anciennes d'abord.
   */
  pruneMissions(parProjet: number): number {
    return this.enTransaction(() => {
      let n = 0;
      n += this.db
        .prepare('DELETE FROM rejeux WHERE projectId NOT IN (SELECT id FROM projects)')
        .run().changes;
      n += this.db
        .prepare('DELETE FROM rejeux_actions WHERE projectId NOT IN (SELECT id FROM projects)')
        .run().changes;
      n += this.db
        .prepare(
          `DELETE FROM missions
            WHERE projectId NOT IN (SELECT id FROM projects)
              AND id NOT IN (SELECT missionSource FROM rejeux)
              AND id NOT IN (SELECT missionRejeu FROM rejeux WHERE missionRejeu IS NOT NULL)`,
        )
        .run().changes;
      n += this.db
        .prepare(
          `DELETE FROM missions WHERE id IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY projectId ORDER BY ouverteA DESC, id) AS rang
                 FROM missions
             ) WHERE rang > ?
           ) AND id NOT IN (SELECT missionSource FROM rejeux)
             AND id NOT IN (SELECT missionRejeu FROM rejeux WHERE missionRejeu IS NOT NULL)`,
        )
        .run(Math.max(1, parProjet)).changes;
      n += this.db
        .prepare('DELETE FROM missions_taches WHERE missionId NOT IN (SELECT id FROM missions)')
        .run().changes;
      n += this.db
        .prepare(
          `DELETE FROM rejeux_actions WHERE id IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY projectId ORDER BY id DESC) AS rang
                 FROM rejeux_actions
             ) WHERE rang > ?
           )`,
        )
        .run(Math.max(1, parProjet) * 10).changes;
      return n;
    });
  }

  // ─── Snapshot ──────────────────────────────────────────────────────────────
  /**
   * L'état que le tableau de bord reçoit — BORNÉ, et qui le dit.
   *
   * La limite est un paramètre pour que les tests puissent l'atteindre sans
   * fabriquer deux mille tâches : une borne qu'on ne peut éprouver qu'au prix
   * d'un banc ne sera jamais éprouvée.
   */
  getSnapshot(limite: number = LIMITE_TACHES_INSTANTANE): StateSnapshot {
    return {
      projects: this.listProjects(),
      nodes: this.listNodes(),
      tasks: this.tachesPourEcran(limite),
      tasksTotal: this.compterTaches(),
    };
  }
}
