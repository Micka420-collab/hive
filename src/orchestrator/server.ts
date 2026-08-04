// Serveur de l'orchestrateur (Queen) : Fastify pour le REST + le dashboard
// statique, `ws` pour le temps réel nœuds ↔ hub ↔ dashboard.
// Sécurité : CORS restreint (jamais "*"), token obligatoire (non-trivial hors
// simulation), limite de taille des corps, validation de toutes les entrées.

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  isValidEmail,
  secretJwtDepuisEnv,
  LONGUEUR_MIN_SECRET_JWT,
} from './auth.js';
import { encodeInvite, isWsUrl } from '../shared/invite.js';
import {
  TTL_BILLET_MAX_MS,
  USAGES_MAX,
  EXPLICATION_REFUS,
  bornerTtl,
  bornerUsages,
  decoderBillet,
  empreinte,
  empreinteLeurre,
  empreinteValide,
  encoderBillet,
  jugerBillet,
  jugerTransport,
  motifDicible,
  REFUS_TOKEN_MAITRE,
  tirerSecret,
  tokenMaitrePeutEnregistrer,
} from '../shared/acces.js';
import { Registre } from './guetteuses.js';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { jugerPreparation } from '../shared/preparation.js';
import { vuePublique } from '../shared/projet-public.js';
import {
  ouvertAuJetonDeRuche,
  peutAdmettre,
  peutAdopter,
  peutEngager,
  peutLireCode,
  peutRejoindre,
  peutVoirMembres,
} from '../shared/acces-projet.js';
import { argvDe, chantiersDe, jugerChantier } from '../shared/chantier.js';
import { Miroir, RayonIndisponible } from './miroir.js';
import { LONGUEUR_MAX_CHEMIN, TAILLE_MAX_FICHIER } from '../shared/rayon.js';
import { construireRetouche } from '../shared/retouche.js';
import { MAX_APERCU, SANDBOX_APERCU, assemblerApercu } from '../shared/apercu.js';
import {
  TTL_PARTAGE_MAX_MS,
  actePartage,
  bornerTtlPartage,
  decoderPartage,
  encoderPartage,
  jugerPartage,
  partageVivant,
} from '../shared/partage.js';
import { isValidRepoUrl, LIMITS, octetsDe, parseClientMessage } from '../shared/protocol.js';
import type { ChantierResultMsg, MergeResultMsg, ServerMessage } from '../shared/protocol.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../shared/types.js';
import type { HiveEvent, Project, Task } from '../shared/types.js';
import { CORPUS_BALANCE, estimerCout, peserLaRuche, VERSION_BALANCE } from './balance.js';
import type { CompteTache, Devis, Pesee } from './balance.js';
import { leconsDesEchecs } from './brood.js';
import {
  CONSEILS_CONSERVES,
  avancerConseil,
  ouvrirConseil,
  versProposition,
} from './conseil-runner.js';
import type { DependancesConseil, ResultatOuvriere } from './conseil-runner.js';
import { evaluerConseil } from './conseil.js';
import {
  ErreurGithub,
  filtrer,
  fullNameDepuisUrl,
  lancerWorkflow,
  lireRuns,
  listerDepots,
  listerWorkflows,
  lireUnDepot,
} from './github.js';
import {
  corpsPr,
  depotDepuisUrl,
  fusionner,
  lireFaitsPr,
  livrer,
  nomBranche,
} from './livraison.js';
import { briefDeIssue, motifRefus, recevable } from '../shared/issue.js';
import { briefDeRetour, demandeDuTravail, direEtat, etatLivraison } from '../shared/retour.js';
import type { EtatLivraison, FaitsPr } from '../shared/retour.js';
import { ErreurRustine, analyserRustine, cheminsDe } from './rustine.js';
import {
  ECHECS_COMPTE,
  ECHECS_IP,
  FENETRE_MS,
  ROLES,
  cleCompte,
  compteurVide,
  echec,
  etatInscription,
  inscriptionPermise,
  jugerMotDePasse,
  modeInscriptionDepuisEnv,
  peut,
  peutChangerRole,
  roleALaCreation,
  tentativeAutorisee,
} from './comptes.js';
import type { Compteur, Role } from './comptes.js';
import {
  ETATS,
  PLANS,
  planParCle,
  appliquerEvenement,
  aucunAbonnement,
  droits,
  lireCharge,
  verifierSignature,
} from './abonnement.js';
import type { Abonnement, EtatAbonnement } from './abonnement.js';
import {
  ETATS as ETATS_SERVEUR,
  FOURNISSEUR_MANUEL,
  aArreter,
  aSupprimer,
  decider,
  replierServeurs,
  transiter,
} from './serveurs.js';
import type { FournisseurServeur } from './serveurs.js';
import {
  RETENTION_JOURS,
  SERVEURS_MAX,
  joursAvantSuppression,
  transitionsDepuis,
  caviarderBillet,
} from './serveurs.js';
import { composerTableau } from './tableau.js';
import type { ProjetVu } from './tableau.js';
import { Cadencier, enPause, modeRunnerDepuisEnv } from './essaim-runner.js';
import { corriger as corrigerLecon, planifier as planifierVerdict } from './nourrir.js';
import type { EtatServeur, Serveur } from './serveurs.js';
import {
  GOUVERNANTES_MIN,
  NIVEAUX,
  deciderPas,
  gouvernantes,
  leconsCroisees,
  signatureEchec,
} from './essaim.js';
import type { Decision, EtatEssaim, NiveauAutonomie, NoeudObserve } from './essaim.js';
import { FENETRE, compterLignes, mesurerDerive } from './derive.js';
import {
  CORPUS_GARDIENNES,
  cheminsPromis,
  fichiersTouches,
  replierInspections,
} from './gardiennes.js';
import type { LigneGardienne, ModeGardiennes, Verdict, VueGardiennes } from './gardiennes.js';
import {
  SEUIL_BATISSEUSE,
  SEUIL_BUTINEUSE,
  VIERGE,
  castesDepuisInspections,
  consignes,
  exigeContreVisite,
  fiabilite,
  modeEffectif,
  replierAntecedents,
  trancher,
} from './polyethisme.js';
import type { Caste, ModePolyethisme } from './polyethisme.js';
import { askConcierge } from './concierge.js';
import type { ConciergeContext } from './concierge.js';
import { detectGhosts } from './ghost.js';
import { dossierDe, elaguer, enregistrerEpisode, lire, pourLaTache } from '../cerveau-reel.js';
import { aConsolider } from '../shared/cerveau.js';
import { graphe } from '../shared/cerveau-graphe.js';
import {
  agreger,
  choisirCritiques,
  consigneDeCritique,
  lireAvis,
} from '../shared/contre-expertise.js';
import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import { buildHiveContext } from './hive-mind.js';
import { buildMergePlan } from './honeycomb.js';
import { tally, signatureOf } from './parliament.js';
import type { Ballot } from './parliament.js';
import { CacheDomaines, domaineDeTache, replierTraces } from './pheromones.js';
import type { Domaine, TraceePheromone } from './pheromones.js';
import { anthropicLlm, llmPlannerAvailable, planBrief } from './planner.js';
import { buildProjectReport } from './project-report.js';
import { computePulse } from './pulse.js';
import { buildTimeline } from './replay.js';
import { detectConflicts } from './sting-detector.js';
import { Scheduler } from './scheduler.js';
import { HiveStore } from './store.js';
import type { SessionRangee } from './store.js';
import { lireTemperature, FENETRE_MS as FENETRE_THERMO_MS, TYPES_THERMO } from './thermo.js';
import { buildWaggleBoard } from './waggle.js';

/** Plafond de messages WS traités par socket et par seconde (anti-DoS). */
const WS_MSG_PER_SEC = 100;

/** Nombre d'événements conservés dans le journal (les plus anciens sont purgés). */
const EVENT_RETENTION = 5_000;

/** Nombre de souvenirs Hive Mind conservés (les plus anciens sont purgés). */
const MEMORY_RETENTION = 2_000;

/**
 * Nombre de résultats conservés INTACTS. Au-delà, seules les colonnes lourdes
 * (`diff`, `logs`) sont vidées — la ligne, elle, survit pour la Miellerie, le
 * Parlement et les phéromones (voir `HiveStore.pruneResults`). Aligné sur
 * EVENT_RETENTION : les deux racontent la même histoire récente.
 */
export const RESULT_RETENTION = 5_000;

/**
 * Nombre de livraisons conservées. BORNE D'ÉLAGAGE de la table `livraisons`
 * (doctrine, règle 3), câblée dans le tick.
 *
 * STRICTEMENT PLUS GRANDE que `RESULT_RETENTION`, et l'écart est le cœur de
 * l'affaire : une production n'est livrable que tant que son résultat porte
 * encore son `diff`. Élaguer les livraisons AVANT les résultats ressusciterait
 * une tâche déjà livrée — la ruche rouvrirait sa pull request sur le dépôt de
 * quelqu'un, et personne ne comprendrait pourquoi. Un test verrouille cette
 * inégalité, parce qu'elle se perdrait au premier ajustement distrait.
 */
export const LIVRAISONS_RETENTION = 10_000;

/**
 * Âge au-delà duquel une tâche TERMINÉE est effacée. Trente jours.
 *
 * ─── LA SEULE BORNE DE CE DÉPÔT QUI SOIT TEMPORELLE, ET POURQUOI ────────────
 *
 * Toutes les autres comptent des lignes (« garder les 5 000 dernières »). Celle
 * -ci compte des JOURS, et l'écart n'est pas un caprice : une tâche est la
 * trace d'un travail qu'un humain a demandé et relu. « Les 5 000 dernières »
 * effacerait le mois de janvier d'un projet actif et garderait trois ans d'un
 * projet endormi — la même règle, deux résultats opposés, aucun des deux
 * défendable devant celui qui cherche ce qu'il a livré.
 *
 * Trente jours, en revanche, veut dire la même chose pour tout le monde.
 *
 * L'inégalité qui compte : cette rétention est STRICTEMENT PLUS LONGUE que
 * celle des résultats et des livraisons — sinon on effacerait la tâche avant
 * les lignes qui la citent, et les bornes référentielles perdraient ce qu'elles
 * sont censées nettoyer À PARTIR d'elle.
 */
export const TACHES_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Livraisons dont on va lire les faits en une fois.
 *
 * BORNE DE COURTOISIE, et elle protège l'hôte plus que GitHub : chaque
 * livraison coûte trois appels d'API, et un projet qui en aurait rangé mille
 * épuiserait le quota horaire du jeton en une seule ouverture d'écran. On lit
 * les plus RÉCENTES — celles dont l'état est encore susceptible de changer.
 */
export const MAX_LIVRAISONS_LUES = 20;

/**
 * Nombre de verdicts des Gardiennes conservés. Aligné sur EVENT_RETENTION et
 * RESULT_RETENTION : les trois racontent la même histoire récente, et un
 * verdict dont le `diff` et les `logs` ont déjà été vidés par `pruneResults` a
 * de toute façon perdu ses pièces à conviction. C'est la BORNE D'ÉLAGAGE que la
 * doctrine (règle 3, balance.ts) exige dans le même commit que la table.
 */
const GARDIENNES_RETENTION = 5_000;

/**
 * Grâce avant d'effacer un BILLET MORT (révoqué, expiré ou épuisé).
 *
 * ─── POURQUOI UNE GRÂCE, ET POURQUOI CELLE-CI ────────────────────────────────
 *
 * Un billet mort n'ouvre plus rien : `pruneAcces` ne touche jamais un billet
 * vivant, et un billet ABSENT est refusé exactement comme un billet révoqué —
 * l'effacer ne peut donc pas rouvrir un accès. Un test le vérifie plutôt que de
 * le supposer, parce que c'est le seul point où cet élagage pourrait nuire.
 *
 * La grâce ne sert donc pas à la sûreté, elle sert à RÉPONDRE : un mois durant,
 * l'hôte qui liste ses billets voit encore « révoqué le 3 » plutôt qu'un trou.
 * Passé ce délai, la question ne se pose plus et la ligne ne mérite plus de
 * place — surtout que c'est un identifiant mort qui dort sur le disque.
 */
const ACCES_GRACE_MS = 30 * 24 * 60 * 60 * 1_000;

/** Même raisonnement pour les liens de partage éteints (voir `ACCES_GRACE_MS`). */
const PARTAGES_GRACE_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * Machines SUPPRIMÉES qu'on garde en mémoire.
 *
 * `pruneServeurs` ne touche jamais une ligne dans un autre état : élaguer une
 * machine encore allumée perdrait la seule trace de ce qu'on paie, et plus
 * personne ne saurait l'éteindre. Ce qui reste ici, ce sont des machines déjà
 * effacées — assez pour relire l'historique récent d'une facture, pas plus.
 */
const SERVEURS_SUPPRIMES_CONSERVES = 200;

/**
 * Mémoïsation de /api/pheromones : le repli est identique d'une seconde à
 * l'autre (corpus de 500 résultats, demi-vie de 7 jours). Sans ce TTL, N
 * dashboards en polling déclenchaient N calculs concurrents sur le même tick.
 */
const PHEROMONES_TTL_MS = 3_000;

/**
 * Mémoïsation de la Balance — même raisonnement que PHEROMONES_TTL_MS : N
 * dashboards en polling sur /api/balance ne doivent pas déclencher N lectures
 * identiques du corpus de 2 000 résultats. Le TTL porte sur la LECTURE (la
 * seule I/O) ; les replis dérivés sont calculés une fois par socle.
 */
const BALANCE_TTL_MS = 3_000;

/**
 * Mémoïsation de /api/gardiennes — même raisonnement que PHEROMONES_TTL_MS. Le
 * repli est identique d'une seconde à l'autre (corpus borné à
 * CORPUS_GARDIENNES) : N dashboards en polling = 1 lecture.
 */
const GARDIENNES_TTL_MS = 3_000;

/**
 * Plafond maximal acceptable : dix ans de temps machine, en millisecondes.
 * Au-delà, ce n'est plus un budget mais une faute de frappe — et un entier
 * absurde n'a rien à faire en base. Borne de saisie, pas de sécurité.
 */
const PLAFOND_MAX_MS = 10 * 365 * 24 * 3_600_000;

/** Un merge sans résultat au-delà de ce délai est déclaré échoué (orphelin). */
const MERGE_TIMEOUT_MS = 10 * 60_000;

/**
 * Couveuse : part du hiveContext réservée aux leçons des échecs précédents
 * d'une tâche ré-assignée. Le reste du budget (LIMITS.hiveContext au total)
 * revient à la mémoire Hive Mind.
 */
const BUDGET_COUVEUSE = 3_000;
/**
 * Ce que le Cerveau peut prendre du contexte d'une ouvrière.
 *
 * Il se sert EN PREMIER — voir `construireHiveContext` — mais il ne se sert
 * pas sans limite : un cerveau bien rempli affamerait la Couveuse et Hive
 * Mind, et une ouvrière qui connaît toutes les règles du projet sans savoir
 * pourquoi SA tâche a échoué deux fois n'est pas mieux lotie.
 */
const BUDGET_CERVEAU = 3_000;

/** Limitation de débit REST : fenêtre et nombre maximal de requêtes /api par IP. */
const REST_RATE_WINDOW_MS = 10_000;
const REST_RATE_MAX = 400;

/**
 * Énumération d'adresses par `/api/auth/register` : combien de COLLISIONS une
 * même IP peut rencontrer avant qu'on cesse de lui répondre.
 *
 * Cinq est large pour quelqu'un qui cherche laquelle de ses adresses il avait
 * utilisée, et dérisoire pour qui déroule une liste. La fenêtre est longue
 * exprès : ce qu'on veut casser, c'est le débit d'énumération, pas la
 * deuxième tentative d'une personne qui s'est trompée.
 */
const INSCRIPTION_COLLISIONS_MAX = 5;
const INSCRIPTION_FENETRE_MS = 10 * 60_000;

/**
 * Limitation DÉDIÉE de `/api/rejoindre`, bien plus serrée que la globale.
 *
 * Cette route est publique par construction (celui qui la frappe n'a pas encore
 * d'accès) et elle vérifie un secret par PBKDF2 — 100 000 itérations, ~50 ms de
 * CPU. Sous la seule limite globale (400 requêtes / 10 s), une machine pouvait
 * réclamer 20 SECONDES de calcul par fenêtre de 10 s : le hub s'arrêtait de
 * répondre sans qu'aucune faille ne soit exploitée. Un déni de service par
 * simple usage de la fonctionnalité.
 *
 * 10 tentatives par minute et par IP : large pour un humain qui rejoint une
 * ruche (il le fait une fois), dérisoire pour un attaquant.
 */
const JOIN_RATE_WINDOW_MS = 60_000;
const JOIN_RATE_MAX = 10;

/** Reconstitue un abstract depuis l'index inversé d'OpenAlex. */
function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) words.push([word, pos]);
  }
  words.sort((a, b) => a[1] - b[1]);
  return words.map(([w]) => w).join(' ');
}

export interface ServerConfig {
  port: number;
  host: string;
  token: string;
  corsOrigins: string[];
  dbPath: string;
  /** Mode démo : tolère le token par défaut (jamais en production). */
  simulation: boolean;
  /** URL WebSocket publique annoncée dans les invitations (HIVE_PUBLIC_URL). */
  publicUrl?: string;
  /** Périodicité du tick du scheduler (ms). */
  tickMs?: number;
  /**
   * Espacement minimum entre deux re-livraisons d'une MÊME tâche muette.
   *
   * Paramétrable pour une seule raison : un test qui veut observer plusieurs
   * re-livraisons ne peut pas attendre quinze secondes par tour. Le rendre
   * réglable est préférable à laisser un test EXIGER le martèlement — c'est
   * exactement ce qui était arrivé : une assertion attendait quatre livraisons
   * en quinze secondes, donc elle encodait le défaut comme un comportement
   * attendu, et corriger le défaut l'a fait rougir.
   */
  relivraisonMinMs?: number;
  /**
   * HIVE_BALANCE : off | observation | strict. Défaut `observation` — la ruche
   * pèse ce qu'elle dépense sans jamais rien bloquer. Optionnel ici (et non
   * requis comme le reste) pour que tout appelant existant de `createServer`
   * continue de compiler : l'ajout de la Balance ne casse aucun contrat.
   */
  balance?: 'off' | 'observation' | 'strict';
  /**
   * HIVE_GARDIENNES : off | consultatif | strict. Défaut `consultatif` — la
   * ruche renifle chaque production et range son verdict, sans jamais rien
   * refuser. Optionnel (comme `balance`) pour que tout appelant existant de
   * `createServer` continue de compiler.
   */
  gardiennes?: ModeGardiennes;
  /**
   * Le polyéthisme : encadrer les prompts selon l'expérience observée du nœud,
   * et — en `strict` — exiger une contre-visite avant d'appliquer. Défaut
   * `consignes` : on encadre, on ne retient rien. Optionnel, comme les autres.
   */
  polyethisme?: ModePolyethisme;
  /**
   * Le fournisseur de machines. Défaut : le fournisseur MANUEL livré.
   *
   * Le commentaire du provisionnement disait « le fournisseur est injectable »
   * pendant que le code l'écrivait en dur — et avec le manuel (no-ops,
   * `ref: ''`), AUCUN test ne pouvait observer que « supprimer » suit bien la
   * suppression et jamais l'arrêt. C'est un banc d'essai qui l'exige, mais le
   * point d'injection est aussi, très exactement, l'endroit où un vrai cloud
   * se branchera.
   */
  fournisseurServeurs?: FournisseurServeur;
}

/**
 * Devine l'adresse WebSocket joignable de cette machine depuis le réseau local
 * (première IPv4 non interne). Sert d'URL par défaut dans les invitations quand
 * HIVE_PUBLIC_URL n'est pas défini. L'hôte peut toujours la corriger.
 */
export function detectLanWsUrl(port: number): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return `ws://${addr.address}:${port}/ws`;
      }
    }
  }
  return `ws://localhost:${port}/ws`;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number.parseInt(env.HIVE_PORT ?? '7777', 10);
  return {
    port: Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : 7777,
    host: env.HIVE_HOST ?? '127.0.0.1',
    token: env.HIVE_TOKEN ?? DEFAULT_TOKEN,
    corsOrigins: (env.HIVE_CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dbPath: env.HIVE_DB ?? './data/hive.db',
    simulation: env.HIVE_SIMULATION === '1',
    // Toute valeur inconnue retombe sur le défaut : une faute de frappe ne doit
    // jamais éteindre silencieusement la pesée.
    balance:
      env.HIVE_BALANCE === 'off' || env.HIVE_BALANCE === 'strict'
        ? env.HIVE_BALANCE
        : 'observation',
    // Même règle : une faute de frappe retombe sur le défaut NON contraignant,
    // jamais sur `strict`. Se tromper de valeur ne doit pas pouvoir fermer le
    // trou de vol.
    gardiennes:
      env.HIVE_GARDIENNES === 'off' || env.HIVE_GARDIENNES === 'strict'
        ? env.HIVE_GARDIENNES
        : 'consultatif',
    // Idem : le défaut `consignes` encadre sans jamais retenir de production.
    polyethisme:
      env.HIVE_POLYETHISME === 'off' || env.HIVE_POLYETHISME === 'strict'
        ? env.HIVE_POLYETHISME
        : 'consignes',
    ...(env.HIVE_PUBLIC_URL ? { publicUrl: env.HIVE_PUBLIC_URL } : {}),
  };
}

/**
 * Détecte un cycle de dépendances au sein d'un lot de tâches (uniquement les
 * tâches portant un id, seules référençables). Retourne le chemin du cycle, ou
 * null s'il n'y en a pas. DFS à trois couleurs (0 = neuf, 1 = en cours, 2 = fini).
 */
export function findCycle(tasks: { id?: string; dependsOn?: string[] }[]): string[] | null {
  const deps = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.id) deps.set(t.id, t.dependsOn ?? []);
  }
  const color = new Map<string, number>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    color.set(id, 1);
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue; // dépendance hors lot : déjà validée par ailleurs
      const c = color.get(dep) ?? 0;
      if (c === 1) return [...stack.slice(stack.indexOf(dep)), dep]; // cycle trouvé
      if (c === 0) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };

  for (const id of deps.keys()) {
    if ((color.get(id) ?? 0) === 0) {
      const found = visit(id);
      if (found) return found;
    }
  }
  return null;
}

/** Comparaison de token à temps constant (évite les attaques par chronométrage). */
export function tokenMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface HiveServer {
  store: HiveStore;
  scheduler: Scheduler;
  config: ServerConfig;
  /** Port réellement écouté (utile avec port 0 dans les tests). */
  port: number;
  url: string;
  stop: () => Promise<void>;
}

export async function createServer(config: ServerConfig): Promise<HiveServer> {
  // ─── Garde-fous de sécurité, avant toute écoute réseau ─────────────────────
  if (
    !config.simulation &&
    (config.token === DEFAULT_TOKEN || config.token.length < MIN_TOKEN_LENGTH)
  ) {
    throw new Error(
      `HIVE_TOKEN trivial refusé : définissez un token d'au moins ${MIN_TOKEN_LENGTH} caractères, ` +
        'ou activez HIVE_SIMULATION=1 pour une démo strictement locale.',
    );
  }
  if (config.corsOrigins.length === 0 || config.corsOrigins.includes('*')) {
    throw new Error(
      'HIVE_CORS_ORIGIN doit lister explicitement les origines autorisées (jamais "*").',
    );
  }
  // Le secret des sessions. Sans lui, les jetons seraient signés avec une clé
  // que tout le monde peut lire, et se forger la session de l'administrateur
  // deviendrait un exercice de cinq lignes. Voir auth.ts pour l'histoire.
  if (!config.simulation && secretJwtDepuisEnv() === '') {
    throw new Error(
      `HIVE_JWT_SECRET manquant, trop court (${LONGUEUR_MIN_SECRET_JWT} caractères minimum) ou laissé ` +
        'à l’ancienne valeur publiée : donnez à votre ruche un secret de session qui n’appartienne qu’à elle — ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" — " +
        'ou activez HIVE_SIMULATION=1 pour une démo strictement locale. ' +
        '« npm run install:hive » le pose pour vous.',
    );
  }

  const store = new HiveStore(config.dbPath);

  /**
   * Le Rayon — miroir en lecture seule du code des projets.
   *
   * Rangé À CÔTÉ de la base, jamais dedans : ce sont des dépôts git, pas des
   * lignes, et les mêler ferait d'une sauvegarde de la base une sauvegarde de
   * tout le code de tous les projets. Le miroir se reconstruit d'un `git
   * clone` ; la base, non.
   */
  const rayons = new Miroir(path.join(path.dirname(config.dbPath), 'rayons'));
  // Le dossier du savoir, à côté de la base — le même chemin que
  // `empreinte.ts` annonce sous la clé « cerveau », et que `hive desinstaller`
  // affiche. Résolu UNE fois : le contenu, lui, est relu à chaque tâche.
  const dossierCerveau = dossierDe(config.dbPath);

  // Les guetteuses observent en mémoire : une table qui grossirait à chaque
  // requête d'un scanner offrirait à l'attaquant de quoi remplir le disque de
  // sa victime.
  const guet = new Registre();

  const nodeSockets = new Map<string, WebSocket>();
  const dashboardSockets = new Set<WebSocket>();
  // État de service Night Shift déclaré par chaque nœud (heartbeat.onShift).
  // Absent = disponible. Sert à éviter d'office un nœud hors service pour un
  // merge (les tâches, elles, sont couvertes par task_reject + cooldown).
  const nodeOnShift = new Map<string, boolean>();
  // Honeycomb Merge : dernier résultat de merge par projet + suivi des merges en
  // cours (routage mergeId→projet, nœud, âge — pour détecter les orphelins).
  const mergeResults = new Map<string, MergeResultMsg>();
  const pendingMerges = new Map<string, { projectId: string; nodeId: string; startedAt: number }>();
  /** Chantiers partis vers un nœud et pas encore rendus. */
  const pendingChantiers = new Map<
    string,
    { projectId: string; nodeId: string; nom: string; startedAt: number }
  >();
  /** Le dernier chantier rendu, par projet — ce que l'écran relit. */
  const chantierResults = new Map<string, ChantierResultMsg>();
  // Diffusion d'état "sale" : regroupée toutes les 250 ms pour éviter le spam.
  let stateDirty = false;
  // Phéromones : cache de domaines (borné) et mémoïsation à TTL court du repli
  // servi par /api/pheromones — N dashboards en polling = 1 calcul.
  const cacheDomaines = new CacheDomaines();
  let pheromonesMemo: { calculeA: number; traces: TraceePheromone[] } | null = null;
  // Les Gardiennes : même mémoïsation à TTL court que les phéromones — le repli
  // d'un corpus borné est identique d'une seconde à l'autre.
  let gardiennesMemo: { calculeA: number; vue: VueGardiennes } | null = null;

  const send = (ws: WebSocket, msg: ServerMessage): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const broadcastState = (): void => {
    if (dashboardSockets.size === 0) return;
    const raw = JSON.stringify({
      type: 'state',
      snapshot: store.getSnapshot(),
    } satisfies ServerMessage);
    for (const ws of dashboardSockets) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  };

  const broadcastEvent = (event: ServerMessage): void => {
    for (const ws of dashboardSockets) send(ws, event);
  };

  /** Événement émis par le serveur lui-même (création de projet/tâches). */
  const emitEvent = (type: string, payload: Record<string, unknown>): void => {
    const event = store.appendEvent(type, payload);
    broadcastEvent({ type: 'event', event });
    stateDirty = true;
  };

  /**
   * Verse un échec au Cerveau, et signale quand un motif devient mûr.
   *
   * ─── CE QUE LA RUCHE S'AUTORISE À ÉCRIRE, ET CE QU'ELLE NE S'AUTORISE PAS ──
   *
   * Elle écrit des ÉPISODES : « cette panne-ci a eu lieu, voilà à quoi elle
   * ressemble, c'est la N-ième fois ». Elle n'écrit JAMAIS de règle.
   *
   * Ce n'est pas une limite technique, c'est le cœur du sujet. Rédiger une
   * règle demande de comprendre POURQUOI, et une règle fausse coûte plus cher
   * que pas de règle du tout — parce qu'elle est SUIVIE, et transmise à chaque
   * tâche suivante par le budget de contexte. Une ruche qui se raconterait ses
   * propres généralisations dériverait plus vite que celle qui n'apprend rien.
   *
   * Quand un motif atteint le seuil, on émet donc `cerveau_consolidation` :
   * une PROPOSITION, visible à la Chronique, que quelqu'un transforme en règle
   * s'il la comprend. La ruche accumule la matière ; l'humain écrit la loi.
   */
  /**
   * Dit si cette production PEUT être relue par un autre modèle, et par lequel.
   *
   * ─── CE QUE CETTE FONCTION FAIT, ET CE QU'ELLE NE FAIT PAS ─────────────────
   *
   * Elle DÉCIDE et elle ANNONCE. Elle ne lance pas la relecture.
   *
   * Lancer demanderait de confier un prompt à un nœud PRÉCIS, et ce chemin
   * n'existe aujourd'hui qu'à l'intérieur de `scheduler.startRace` — lié à une
   * tâche existante et à une course. Le poser proprement est une pièce
   * d'orchestration à part entière, pas un ajout de trois lignes ici.
   *
   * Ce qui est livré est tout de même utile seul : au moment où une production
   * entre en revue, le journal dit « codex peut la relire » ou « aucun second
   * modèle en ligne ». C'est exactement l'information qui manque au relecteur
   * humain devant la Miellerie — et sans elle, personne ne sait qu'il existe
   * un avis à demander.
   *
   * Le REFUS est journalisé lui aussi. « Aucun second modèle » est une
   * information : tue, elle se confondrait avec « personne n'a rien trouvé ».
   */
  const signalerContreExpertise = (
    taskId: string,
    nodeId: string,
    diff: string,
    logs: string,
  ): void => {
    const task = store.getTask(taskId);
    const producteur = store.getNode(nodeId);
    if (!task || !producteur) return;

    const production = {
      taskId,
      titre: task.title,
      nodeId,
      agentType: producteur.agentType,
      diff,
      logs,
    };

    const choix = choisirCritiques(
      production,
      store.listNodes().map((n) => ({
        nodeId: n.id,
        nom: n.name,
        agentType: n.agentType,
        enLigne: n.status === 'online',
      })),
    );

    if (choix.genre === 'refus') {
      // « Aucun second modèle en ligne » est une INFORMATION. Tue, elle se
      // confondrait avec « on a relu et rien trouvé » — deux situations
      // opposées derrière le même écran vide, et la mauvaise est celle qui
      // rassure.
      emitEvent('contre_expertise', {
        taskId,
        possible: false,
        producteur: producteur.agentType,
        motif: choix.motif,
      });
      return;
    }

    // ─── LE LANCEMENT ────────────────────────────────────────────────────────
    //
    // Une tâche de relecture est une VRAIE tâche : elle passe par le même
    // canal `assign_task` que le reste, donc par le même bac à sable, le même
    // protocole, le même chemin de résultat. Inventer un second canal aurait
    // dupliqué toutes ces gardes, et c'est en dupliquant les gardes qu'on
    // finit par en oublier une.
    //
    // Elle est posée directement en `assigned` sur un nœud PRÉCIS, sans passer
    // par la file : le planificateur choisit le nœud le moins chargé, or ici
    // l'identité du nœud est TOUT le propos — un autre modèle, pas n'importe
    // lequel. C'est exactement ce que fait `scheduler.startRace`, et on
    // réutilise son geste plutôt que d'en écrire un autre.
    const lancees: string[] = [];
    for (const relecteur of choix.relecteurs) {
      const relecture = store.createTask({
        projectId: task.projectId,
        title: `Contre-expertise — ${champSurUneLigne(task.title, 120)}`,
        prompt: consigneDeCritique(production),
      });
      // Le lien AVANT l'assignation : si le résultat revenait entre les deux,
      // il serait traité comme une production ordinaire et repartirait en
      // contre-expertise. La fenêtre est étroite ; elle n'a pas à exister.
      store.inscrireRelecture({
        relectureTaskId: relecture.id,
        productionTaskId: taskId,
        relecteurNodeId: relecteur.nodeId,
        relecteurAgent: relecteur.agentType,
        producteurAgent: producteur.agentType,
      });
      const assignee = store.patchTask(relecture.id, {
        status: 'assigned',
        assignedNodeId: relecteur.nodeId,
      });
      if (assignee) {
        envoyerTache(relecteur.nodeId, assignee);
        lancees.push(relecture.id);
      }
    }

    emitEvent('contre_expertise', {
      taskId,
      possible: true,
      producteur: producteur.agentType,
      modeles: choix.modeles,
      relecteurs: choix.relecteurs.map((r) => r.nom),
      relectures: lancees,
    });
  };

  /**
   * Un verdict revient — on le lit, on l'agrège, on le journalise.
   *
   * ─── CE QUE CE VERDICT NE FAIT PAS, ET NE FERA PAS ───────────────────────
   *
   * Il ne bloque aucune fusion. La règle du dépôt reste « jamais de fusion sans
   * revue humaine », et une contre-expertise qui DÉCIDERAIT remplacerait la
   * revue au lieu de l'armer. Ce qu'on veut, c'est qu'un humain lise des
   * objections qu'il n'aurait pas trouvées seul — pas qu'une seconde IA ait le
   * dernier mot sur la première.
   *
   * Il n'y a donc aucun chemin d'ici vers la livraison, et c'est délibéré.
   */
  const noterVerdict = (
    relectureTaskId: string,
    lien: NonNullable<ReturnType<typeof store.relectureDe>>,
    texte: string,
  ): void => {
    const verdict = agreger([lireAvis(lien.relecteurNodeId, lien.relecteurAgent, texte)]);

    // ─── CE QUE LA CONTRE-VISITE A DÉCIDÉ, RANGÉ ─────────────────────────────
    //
    // Le verdict ne vivait que dans un événement — c'est-à-dire dans le passé.
    // La décision de livrer, elle, se prend plus tard, sur un autre tick : sans
    // cette trace, `HIVE_POLYETHISME=strict` n'avait rien à consulter, et les
    // deux fonctions qui savent trancher n'avaient aucun appelant.
    //
    // La traduction est volontairement grossière, et c'est assumé : le module
    // de contre-expertise ne rend qu'un booléen — contesté ou non. Un troisième
    // état (`refaire`) demanderait au relecteur une gradation qu'on ne lui
    // demande pas, et l'inventer ici en lisant entre les lignes serait une
    // décision prise sur rien.
    store.enregistrerContreVisite({
      productionTaskId: lien.productionTaskId,
      suite: verdict.conteste ? 'ameliorer' : 'appliquer',
      raison: verdict.objections[0] ?? '',
      visiteurNodeId: lien.relecteurNodeId,
      visiteurAgent: lien.relecteurAgent,
    });

    emitEvent('contre_expertise_verdict', {
      taskId: lien.productionTaskId,
      relecture: relectureTaskId,
      relecteur: lien.relecteurAgent,
      producteur: lien.producteurAgent,
      conteste: verdict.conteste,
      objections: verdict.objections,
    });
  };

  const noterEchec = (taskId: string, logs: string): void => {
    const task = store.getTask(taskId);
    if (!task) return;
    const ecrit = enregistrerEpisode(dossierCerveau, {
      signature: signatureEchec(logs),
      titre: task.title,
      detail: champSurUneLigne(logs, 800),
    });
    if (ecrit === null) return; // Échec sans log exploitable : rien à apprendre.

    emitEvent('cerveau_episode', {
      taskId,
      note: ecrit.id,
      recurrences: ecrit.recurrences,
      nouveau: ecrit.nouveau,
    });

    // Le seuil vient du module pur, et la somme des récurrences aussi : on ne
    // le recalcule pas ici, sous peine d'avoir deux définitions du « mûr ».
    for (const c of aConsolider(lire(dossierCerveau))) {
      if (!c.episodes.some((e) => e.id === ecrit.id)) continue;
      emitEvent('cerveau_consolidation', {
        note: ecrit.id,
        recurrences: c.recurrences,
        titre: task.title,
      });
    }
  };

  /**
   * Contexte joint à `assign_task` : leçons de la Couveuse (tâche déjà échouée)
   * puis souvenirs du Hive Mind, dans le budget total LIMITS.hiveContext.
   * PARTAGÉ par les deux chemins de livraison — l'assignation initiale ET la
   * re-livraison de secours des tâches muettes : sans cela, une tâche re-servie
   * repartait sans les leçons pourtant annoncées par `brood_context`.
   * Ne journalise rien (la re-livraison a lieu à chaque tick) : l'appelant
   * décide s'il émet `brood_context`.
   */
  const construireHiveContext = (
    task: Task,
    /** Octets déjà pris par le cadre du polyéthisme, qui passe en premier. */
    dejaPris = 0,
    // `refusCerveau` est posé quand les invariants du Cerveau ne tenaient pas
    // dans le budget : l'ouvrière part alors SANS eux, et c'est un fait qui
    // doit se voir. L'appelant le journalise.
  ): { hiveContext: string; echecs: number; refusCerveau?: string } => {
    // ─── LE CERVEAU — ce que le PROJET a appris, pas cette tâche-ci ──────────
    //
    // Invariants, leçons consolidées et décisions, choisis sous budget par le
    // module pur. `pourLaTache` lit le dossier à chaque appel : quelques
    // centaines de fichiers, donc c'est instantané, et surtout ça veut dire
    // qu'une note corrigée à la main dans Obsidian vaut pour la tâche
    // SUIVANTE, sans redémarrer la ruche.
    const { bloc: savoir, selection } = pourLaTache(
      dossierCerveau,
      `${task.title} ${task.prompt}`,
      Math.max(0, Math.min(BUDGET_CERVEAU, LIMITS.hiveContext - (dejaPris ? dejaPris + 2 : 0))),
    );
    const refus = selection.refus;

    // Couveuse : les leçons des échecs précédents viennent EN TÊTE (le plus
    // spécifique d'abord). Le nom du nœud fautif est résolu ici — la table
    // results ne garde que son id.
    const echecs = task.attempts > 0 ? store.listFailedResultsForTask(task.id) : [];
    const lecons =
      echecs.length > 0
        ? leconsDesEchecs(
            echecs.map((e, i) => ({
              attempt: i + 1,
              nodeName: store.getNode(e.nodeId)?.name ?? e.nodeId,
              logs: e.logs,
              createdAt: e.createdAt,
            })),
            BUDGET_COUVEUSE,
          )
        : '';
    // Hive Mind : souvenirs pertinents des tâches déjà réussies, dans le budget
    // RESTANT après le Cerveau et la Couveuse (« \n\n » de jonction compris).
    const souvenirs = buildHiveContext(
      store.searchMemories(`${task.title} ${task.prompt}`, 3),
      LIMITS.hiveContext -
        (savoir ? savoir.length + 2 : 0) -
        (lecons ? lecons.length + 2 : 0) -
        (dejaPris ? dejaPris + 2 : 0),
    );
    return {
      // ─── L'ORDRE EST UNE DÉCISION, PAS UNE HABITUDE ────────────────────────
      //
      // Le Cerveau passe AVANT la Couveuse, alors que la règle jusqu'ici était
      // « le plus spécifique d'abord ». Ce n'est pas une entorse, c'est un
      // autre axe : la Couveuse est classée par PERTINENCE, le Cerveau porte
      // des INVARIANTS. Une contrainte de sûreté ne se fait pas déloger par
      // une leçon d'échec, si pertinente soit-elle.
      //
      // C'est aussi pour ça qu'il se sert en premier sur le budget : servi en
      // dernier, il n'aurait plus de place les jours où une tâche a beaucoup
      // échoué — c'est-à-dire exactement les jours où ses invariants comptent
      // le plus.
      hiveContext: [savoir, lecons, souvenirs].filter(Boolean).join('\n\n'),
      echecs: lecons ? echecs.length : 0,
      // Un refus ne se tait pas. Il veut dire que les invariants ne tenaient
      // pas dans le budget, donc que l'ouvrière va travailler SANS eux ;
      // l'appelant journalise. Rendre '' sans le dire serait la panne
      // silencieuse que `selectionner` existe pour éviter.
      ...(refus === undefined ? {} : { refusCerveau: refus }),
    };
  };

  // ─── La Balance : socle de lecture, pesée et devis ─────────────────────────
  //
  // Tout part d'UNE lecture bornée (≤ CORPUS_BALANCE résultats, index couvrant)
  // mémoïsée BALANCE_TTL_MS : la pesée et les échantillons de devis en sont des
  // replis PURS, recalculés une seule fois par socle. Rien n'est jamais écrit.
  interface SocleBalance {
    calculeA: number;
    corpus: ReturnType<HiveStore['listResultsForBalance']>;
    taches: Map<string, CompteTache>;
    /** Replis dérivés, calculés à la demande et gardés le temps du socle. */
    pesee?: Pesee;
    echantillons?: Map<Domaine, number[]>;
  }
  let socleBalance: SocleBalance | null = null;

  const lireSocleBalance = (now = Date.now()): SocleBalance => {
    if (socleBalance && now - socleBalance.calculeA < BALANCE_TTL_MS) return socleBalance;
    const corpus = store.listResultsForBalance();
    // Lecture par clé primaire des SEULES tâches citées par le corpus — jamais
    // un dépliage de `tasks`, et plus jamais de `reviews` non plus : le même
    // tableau d'ids sert les deux. `reviews` n'est pas élaguée, elle : la lire
    // en entier toutes les 3 s pour n'en garder que ≤ 2 000 clés bloquait la
    // boucle d'événements ~160 ms à 100 000 revues (mesuré), donc retardait le
    // tick du Scheduler et tout le trafic WebSocket.
    const ids = [...new Set(corpus.map((r) => r.taskId))];
    const comptes = store.listTaskComptes(ids);
    const revues = store.listReviewsFor(ids);
    socleBalance = {
      calculeA: now,
      corpus,
      taches: new Map(
        comptes.map((c) => [
          c.id,
          { projectId: c.projectId, status: c.status, revue: revues[c.id] ?? null },
        ]),
      ),
    };
    return socleBalance;
  };

  const peser = (now = Date.now()): Pesee => {
    const socle = lireSocleBalance(now);
    socle.pesee ??= peserLaRuche(socle.corpus, socle.taches);
    return socle.pesee;
  };

  /**
   * Échantillons de coût par domaine : le TOTAL par tâche (toutes tentatives
   * confondues — reprises comprises, c'est ce qu'une tâche coûte vraiment), sur
   * les seules tâches ABOUTIES du corpus. Une tâche encore en vol n'a pas fini
   * de dépenser : l'inclure sous-estimerait le devis.
   */
  const echantillonsBalance = (now = Date.now()): Map<Domaine, number[]> => {
    const socle = lireSocleBalance(now);
    if (socle.echantillons) return socle.echantillons;
    const totaux = new Map<string, number>();
    for (const r of socle.corpus) {
      if (socle.taches.get(r.taskId)?.status !== 'done') continue;
      totaux.set(r.taskId, (totaux.get(r.taskId) ?? 0) + Math.max(0, r.durationMs));
    }
    const domaines = cacheDomaines.domaines([...totaux.keys()], (manquants) =>
      store.listTaskTexts(manquants),
    );
    const parDomaine = new Map<Domaine, number[]>();
    for (const [taskId, total] of totaux) {
      const domaine = domaines.get(taskId);
      if (!domaine) continue;
      const liste = parDomaine.get(domaine);
      if (liste) liste.push(total);
      else parDomaine.set(domaine, [total]);
    }
    socle.echantillons = parDomaine;
    return parDomaine;
  };

  /** Devis d'un lot de tâches proposées : par tâche, puis en total. */
  interface DevisPlan {
    parTache: Array<{ title: string; domaine: Domaine } & Devis>;
    /**
     * Somme des médianes et somme des p90. Ce ne sont ni la médiane ni le p90
     * de la somme : le total p90 est une borne PESSIMISTE, qui suppose que
     * toutes les tâches ont un mauvais jour en même temps. Assumé et affiché
     * comme tel — un devis se lit comme un ordre de grandeur.
     */
    totalMedianeMs: number;
    totalP90Ms: number;
  }

  /**
   * Chiffre un lot de tâches PROPOSÉES (pas encore en base, donc classées
   * directement par `domaineDeTache`, sans cache par id). Silencieux — `null` —
   * quand aucun domaine n'atteint ECHANTILLON_MIN_DEVIS tâches comparables :
   * jamais de fausse précision.
   *
   * Le devis est un NOMBRE destiné à l'affichage. Aucun texte d'agent n'entre
   * ici, et rien de ceci ne repart dans un prompt : le jour où un titre devrait
   * y retourner, il passerait obligatoirement par `champSurUneLigne` /
   * `blocDonnees` (src/shared/donnees-non-fiables.ts).
   */
  const chiffrerDevis = (
    taches: ReadonlyArray<{ title: string; prompt: string }>,
  ): DevisPlan | null => {
    const echantillons = echantillonsBalance();
    const parTache: DevisPlan['parTache'] = [];
    for (const tache of taches) {
      const domaine = domaineDeTache(tache.title, tache.prompt);
      const devis = estimerCout(domaine, echantillons.get(domaine) ?? []);
      if (devis) parTache.push({ title: tache.title, ...devis });
    }
    if (parTache.length === 0) return null;
    return {
      parTache,
      totalMedianeMs: parTache.reduce((s, d) => s + d.medianeMs, 0),
      totalP90Ms: parTache.reduce((s, d) => s + d.p90Ms, 0),
    };
  };

  /**
   * Enrobage NON BLOQUANT : un devis qui échoue ne casse jamais un plan. La
   * Balance est une lecture ; elle n'a le droit de faire échouer aucune route.
   */
  const devisSansRisque = (
    taches: ReadonlyArray<{ title: string; prompt: string }>,
  ): DevisPlan | null => {
    try {
      return chiffrerDevis(taches);
    } catch (err) {
      console.error(`[hive] devis indisponible : ${err instanceof Error ? err.message : err}`);
      return null;
    }
  };

  // ─── Le polyéthisme : chaque ouvrière au travail que son expérience permet ─
  //
  // Les castes sont DÉRIVÉES des verdicts des Gardiennes — jamais déclarées par
  // un nœud (polyethisme.ts, doctrine règle 1). Le calcul est un repli PUR sur
  // le même corpus borné que /api/gardiennes ; on le mémoïse avec le même TTL,
  // parce qu'il est lu sur le chemin d'assignation (onAssign, appelé par tick)
  // et qu'une lecture de table par tâche assignée est exactement le motif que
  // l'audit de La Balance a fait retirer.
  const modePolyethismeDemande: ModePolyethisme = config.polyethisme ?? 'consignes';
  let castesMemo: { calculeA: number; castes: Map<string, Caste> } | null = null;

  /** Mode réellement en vigueur : `off` si les Gardiennes n'inspectent rien. */
  const polyethismeEnVigueur = (): ModePolyethisme =>
    modeEffectif(modePolyethismeDemande, scheduler.gardiennes.mode !== 'off');

  const casteDe = (nodeId: string, now = Date.now()): Caste => {
    if (!castesMemo || now - castesMemo.calculeA >= GARDIENNES_TTL_MS) {
      castesMemo = { calculeA: now, castes: castesDepuisInspections(store.listInspections()) };
    }
    // Un nœud sans antécédent est une nourrice : l'inconnu est le cas dangereux.
    return castesMemo.castes.get(nodeId) ?? 'nourrice';
  };

  /**
   * Le cadre de travail joint au prompt d'une ouvrière, ou '' si aucun.
   *
   * Le périmètre est déduit de la tâche par la MÊME fonction que les Gardiennes
   * utilisent pour juger le résultat (`cheminsPromis`). C'est volontaire : la
   * ruche annonce à l'ouvrière exactement les fichiers sur lesquels elle la
   * jugera. Un cadre qui parlerait d'autre chose que ce qui est mesuré serait
   * pire qu'aucun cadre.
   */
  const construireCadre = (task: Task, nodeId: string): string => {
    if (polyethismeEnVigueur() === 'off') return '';
    return consignes({
      caste: casteDe(nodeId),
      perimetre: cheminsPromis(task.title, task.prompt),
    });
  };

  /**
   * Envoie une tâche à un nœud PRÉCIS.
   *
   * ─── POURQUOI CE GESTE EST NOMMÉ PLUTÔT QU'ANONYME ─────────────────────────
   *
   * Il était le corps de `onAssign`, donc atteignable seulement par le
   * planificateur. La contre-expertise a besoin du MÊME geste : confier un
   * prompt à un nœud choisi pour son modèle, pas pour sa disponibilité.
   *
   * L'extraire plutôt que le recopier garde une seule porte de sortie vers les
   * ouvrières — donc un seul endroit où vivent le cadre du polyéthisme, le
   * contexte du Cerveau et le journal des refus. Deux portes, c'est une porte
   * qu'on oublie de garder.
   */
  const envoyerTache = (nodeId: string, task: Task): void => {
    const ws = nodeSockets.get(nodeId);
    // Socket absent ou fermé : le close/reap réaffectera la tâche, rien à faire ici.
    if (ws) {
      const project = store.getProject(task.projectId);
      // Le cadre du polyéthisme vient EN TÊTE et se taille son budget en
      // premier : une consigne tronquée à moitié est pire qu'absente, alors
      // qu'un souvenir en moins n'est qu'un souvenir en moins.
      const cadre = construireCadre(task, nodeId);
      const { hiveContext, echecs, refusCerveau } = construireHiveContext(task, cadre.length);
      // Le Cerveau a refusé : ses invariants ne tenaient pas dans le budget,
      // donc cette ouvrière travaille sans les contraintes de sûreté du
      // projet. C'est précisément le genre de fait qu'un `''` silencieux
      // ferait disparaître — on le journalise, il apparaît à la Chronique.
      if (refusCerveau !== undefined) {
        emitEvent('cerveau_refus', { taskId: task.id, nodeId, motif: refusCerveau });
      }
      // Couveuse : la ré-assignation d'une tâche déjà échouée est journalisée
      // ici seulement (payload de faits typés, texte reconstruit à l'affichage).
      if (echecs > 0) emitEvent('brood_context', { taskId: task.id, nodeId, echecs });
      const contexte = [cadre, hiveContext].filter(Boolean).join('\n\n');
      send(ws, {
        type: 'assign_task',
        task,
        repoUrl: project?.repoUrl ?? null,
        ...(contexte ? { hiveContext: contexte } : {}),
      });
    }
  };

  const scheduler = new Scheduler(store, {
    // Balance : le grand livre suit la table `results` et n'influence RIEN.
    balance: { mode: config.balance ?? 'observation' },
    // Les Gardiennes : le contrôle d'entrée du nectar. Défaut `consultatif` —
    // on renifle et on annote, on ne refuse rien.
    gardiennes: { mode: config.gardiennes ?? 'consultatif' },
    // Drone Wars : annuler le travail d'un drone perdant (ou d'une course annulée).
    onCancel: (nodeId, taskId, reason) => {
      const ws = nodeSockets.get(nodeId);
      if (ws) send(ws, { type: 'cancel_task', taskId, reason });
    },
    onAssign: (nodeId, task) => envoyerTache(nodeId, task),
    onEvent: (event) => {
      broadcastEvent({ type: 'event', event });
      stateDirty = true;
    },
  });

  /**
   * Marque un merge en cours comme échoué (nœud déconnecté, timeout) : range un
   * résultat d'échec pour que /merge/result ne reste pas `null` éternellement, et
   * libère l'entrée (anti-fuite mémoire). Honeycomb Merge est advisory/v0 : les
   * merges en cours ne survivent PAS à un redémarrage de l'orchestrateur.
   */
  const failMerge = (mergeId: string, reason: string): void => {
    const pending = pendingMerges.get(mergeId);
    if (!pending) return;
    pendingMerges.delete(mergeId);
    mergeResults.set(pending.projectId, {
      type: 'merge_result',
      mergeId,
      applied: [],
      conflicts: [],
      mergedDiff: '',
      testsRun: false,
      testsPassed: null,
      logs: `[hub] merge interrompu : ${reason}`,
    });
    emitEvent('merge_failed', { projectId: pending.projectId, mergeId, reason });
  };

  // Reprise après redémarrage : les tâches running orphelines repartent en ready.
  scheduler.recoverAtBoot();

  // ─── HTTP (REST + dashboard) ───────────────────────────────────────────────
  const app = Fastify({ bodyLimit: 1024 * 1024, logger: false });

  // Un corps VIDE annoncé en JSON vaut « pas de corps », pas une erreur.
  //
  // Par défaut Fastify rend `FST_ERR_CTP_EMPTY_JSON_BODY` — un 400 illisible —
  // dès qu'une requête porte `content-type: application/json` sans corps. C'est
  // exactement ce que fait un DELETE envoyé par un client qui pose ce header sur
  // toutes ses requêtes (le CLI de Hive le faisait), et le message n'aide
  // personne à comprendre pourquoi « exclure un membre » échoue.
  //
  // Les routes qui EXIGENT un corps ne sont pas affaiblies : leur schéma porte
  // `required`, donc elles refusent toujours — mais avec un message qui nomme le
  // champ manquant.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      // Le corps BRUT est conservé pour la seule route qui en a besoin : la
      // signature d'un webhook porte sur les octets reçus, pas sur le JSON
      // reparsé. Re-sérialiser changerait l'ordre des clés et les espaces,
      // donc la signature — et on refuserait des appels authentiques.
      (_req as { rawBody?: string }).rawBody = body;
      if (body.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        const err = new Error('corps JSON illisible') as Error & { statusCode?: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  await app.register(cors, {
    origin: config.corsOrigins,
    // `PUT` : poser un plafond de dépense est une MODIFICATION d'une ressource
    // existante et idempotente — le seul verbe honnête. Sans lui ici, le
    // pré-vol du navigateur refuserait la requête du dashboard.
    // `DELETE` : exclure un membre et révoquer un billet sont des SUPPRESSIONS.
    // Sans lui, le pré-vol du navigateur refuserait ces deux gestes — le CLI
    // fonctionnerait (pas de pré-vol hors navigateur), et le défaut n'aurait
    // été découvert qu'au moment d'écrire l'interface.
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'x-hive-token', 'authorization'],
  });

  // Limitation de débit des routes /api par IP (fenêtre glissante) : défense en
  // profondeur contre un flood REST, en complément du plafond côté WebSocket.
  const apiHits = new Map<string, { count: number; resetAt: number }>();
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const now = Date.now();
    let h = apiHits.get(req.ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + REST_RATE_WINDOW_MS };
      apiHits.set(req.ip, h);
    }
    h.count += 1;
    if (h.count > REST_RATE_MAX) {
      return reply.code(429).send({ error: 'trop de requêtes, réessayez dans un instant' });
    }
  });

  /**
   * Compteur dédié de `/api/rejoindre`. Séparé du compteur global : celui-ci
   * protège une ressource particulière (le CPU du PBKDF2), pas le débit général.
   */
  const joinHits = new Map<string, { count: number; resetAt: number }>();

  /**
   * Vrai si cette IP a encore droit à une tentative. NE COMPTE RIEN : seuls les
   * ÉCHECS sont comptés (`joinEchec`).
   *
   * Compter les réussites aurait cassé un usage parfaitement légitime : un
   * atelier de dix personnes derrière une seule IP publique (le NAT d'un bureau,
   * d'une école) avec un billet `--uses 10`. Toutes auraient été refusées alors
   * que l'hôte les avait justement invitées. Et c'était inutile : les
   * réussites sont DÉJÀ bornées, par le nombre d'usages du billet.
   *
   * Ce qu'on veut plafonner, c'est le PBKDF2 payé pour rien — donc l'échec.
   */
  function joinAutorise(ip: string): boolean {
    const h = joinHits.get(ip);
    return !h || h.resetAt <= Date.now() || h.count < JOIN_RATE_MAX;
  }

  /** Compte une tentative infructueuse pour cette IP. */
  function joinEchec(ip: string): void {
    const now = Date.now();
    let h = joinHits.get(ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + JOIN_RATE_WINDOW_MS };
      joinHits.set(ip, h);
      // Purge opportuniste : sans elle, la table grandirait d'une entrée par IP
      // vue, indéfiniment — une fuite mémoire lente sur un hub exposé.
      if (joinHits.size > 10_000) {
        for (const [k, v] of joinHits) if (v.resetAt <= now) joinHits.delete(k);
      }
    }
    h.count += 1;
  }

  // ─── L'annuaire que /api/auth/register donnait gratuitement ───────────────
  //
  // `/api/auth/login` se donne beaucoup de mal pour ne PAS dire si une adresse
  // est inscrite : même message, même code, que le compte existe ou non. Son
  // commentaire l'explique — « distinguer les deux offrirait un annuaire des
  // inscrits ».
  //
  // `/api/auth/register` rendait ce même annuaire sans effort, avec son 409
  // « Email déjà utilisé ». Sous la seule limite globale (400 requêtes / 10 s),
  // cela faisait 2 400 adresses testées par minute et par IP. Le soin pris sur
  // `login` ne servait donc à rien : il suffisait de frapper à l'autre porte.
  //
  // Ce qu'on compte, ce sont les COLLISIONS — jamais les inscriptions réussies.
  // Même raisonnement que pour `joinEchec` : un atelier de dix personnes
  // derrière une seule IP publique (le NAT d'un bureau, d'une école) doit
  // pouvoir créer dix comptes. Une collision, elle, est exactement le signal
  // qu'on cherche : quelqu'un de légitime en rencontre une, peut-être deux ;
  // celui qui déroule une liste d'adresses n'en rencontre que ça.
  //
  // CE QUE ÇA NE FERME PAS, ET IL FAUT LE DIRE : le 409 subsiste, donc une
  // énumération LENTE reste possible. La fermer tout à fait demanderait de
  // confirmer l'adresse par courriel avant de répondre quoi que ce soit — la
  // ruche n'envoie aucun courriel, et prétendre le contraire serait pire que
  // le trou lui-même.
  const collisionsInscription = new Map<string, { count: number; resetAt: number }>();

  /** Cette IP a-t-elle encore droit à une tentative d'inscription ? */
  function inscriptionAutorisee(ip: string): boolean {
    const h = collisionsInscription.get(ip);
    return !h || h.resetAt <= Date.now() || h.count < INSCRIPTION_COLLISIONS_MAX;
  }

  /** Compte une collision d'adresse pour cette IP. */
  function collisionInscription(ip: string): void {
    const now = Date.now();
    let h = collisionsInscription.get(ip);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + INSCRIPTION_FENETRE_MS };
      collisionsInscription.set(ip, h);
      // Purge opportuniste : sans elle, la table grandirait d'une entrée par IP
      // vue, indéfiniment — une fuite mémoire lente sur un hub exposé.
      if (collisionsInscription.size > 10_000) {
        for (const [k, v] of collisionsInscription)
          if (v.resetAt <= now) collisionsInscription.delete(k);
      }
    }
    h.count += 1;
  }

  // Mode d'inscription, lu une fois. `ouverte` par défaut : une ruche qui
  // démarre est vide, et le premier geste est de créer le compte de l'hôte.
  const modeInscription = modeInscriptionDepuisEnv();

  // ─── La porte d'entrée : anti-force-brute sur /api/auth/login ─────────────
  //
  // `/api/auth/login` vérifie un mot de passe par PBKDF2 — 100 000 itérations,
  // ~50 ms de CPU. Sous la seule limite globale (400 requêtes / 10 s), cela
  // faisait 2 400 essais de mot de passe par minute ET 20 SECONDES de CPU par
  // fenêtre de 10 s. C'est exactement le déni de service que `/api/rejoindre`
  // documente et borne déjà ; il manquait sur la porte principale.
  //
  // DEUX compteurs, parce qu'ils attrapent des attaques différentes et que
  // chacun seul laisse passer l'autre (cf. comptes.ts) : par COMPTE contre
  // l'attaque distribuée, par IP contre la pulvérisation d'un mot de passe sur
  // mille comptes.
  const echecsCompte = new Map<string, Compteur>();
  const echecsIp = new Map<string, Compteur>();

  /** Purge opportuniste — sans elle, une fuite mémoire lente sur un hub exposé. */
  const purger = (m: Map<string, Compteur>, now: number): void => {
    if (m.size <= 10_000) return;
    for (const [k, v] of m) {
      if (v.verrouJusqua <= now && (v.depuis === 0 || now - v.depuis >= FENETRE_MS)) m.delete(k);
    }
  };

  const noterEchecConnexion = (cle: string, ip: string, now: number): void => {
    echecsCompte.set(cle, echec(echecsCompte.get(cle) ?? compteurVide(), now, ECHECS_COMPTE));
    echecsIp.set(ip, echec(echecsIp.get(ip) ?? compteurVide(), now, ECHECS_IP));
    purger(echecsCompte, now);
    purger(echecsIp, now);
  };

  /** Ce dont le Conseil a besoin du monde. Un seul endroit qui écrit. */
  const depConseil: DependancesConseil = {
    store,
    creerTache: (i) => store.createTask(i),
    emettre: (type, payload) => emitEvent(type, payload),
  };

  /**
   * Fait avancer les conseils ouverts. Appelé à chaque tick.
   *
   * Une tâche est TERMINALE quand elle ne bougera plus : `done` (l'éclaireuse
   * est revenue) ou `failed` (elle n'est pas revenue, et le conseil continue
   * sans elle). Tout le reste est encore en vol — on ne dépouille pas.
   *
   * Aucune session ouverte = aucune requête, aucun coût. C'est le cas normal.
   */
  function scruterConseils(): void {
    const ouvertes = store.sessionsOuvertes();
    if (ouvertes.length === 0) return;
    for (const session of ouvertes) {
      const attendues = store.tachesADepouiller(session.id);
      if (attendues.length === 0) continue;
      const terminales = new Map<string, ResultatOuvriere | null>();
      for (const lien of attendues) {
        const tache = store.getTask(lien.taskId);
        // Tâche disparue (élaguée, projet supprimé) : terminale et sans
        // résultat. La traiter comme « en vol » figerait la session à jamais.
        if (!tache) {
          terminales.set(lien.taskId, null);
          continue;
        }
        if (tache.status !== 'done' && tache.status !== 'failed') continue;
        // Le DERNIER résultat de la tâche : une éclaireuse a pu être
        // re-tentée, et c'est sa dernière parole qui compte.
        const tous = store.resultsForTask(lien.taskId);
        const dernier = tous.length > 0 ? tous[tous.length - 1]! : null;
        terminales.set(
          lien.taskId,
          dernier
            ? {
                nodeId: dernier.nodeId,
                agentType: store.getNode(dernier.nodeId)?.agentType ?? 'inconnu',
                success: dernier.success,
                logs: dernier.logs,
                diff: dernier.diff,
              }
            : null,
        );
      }
      if (terminales.size > 0) avancerConseil(depConseil, session, terminales);
    }
  }

  const dashboardDist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../dashboard/dist',
  );
  if (existsSync(path.join(dashboardDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: dashboardDist });
  } else {
    // ─── CE QU'ON SERT QUAND L'ÉCRAN N'EST PAS CONSTRUIT ─────────────────────
    //
    // Cette route rendait un objet JSON. Dans un terminal c'est lisible ; dans
    // un navigateur — c'est-à-dire là où arrive quelqu'un qui vient de lancer
    // `npm run dev` — ça donne :
    //
    //     {"hive":"orchestrateur en ligne","hint":"Dashboard non construit : …"}
    //
    // Le premier contact avec le produit était un texte de débogage. La
    // consigne y était pourtant, mot pour mot : ce n'est pas l'information qui
    // manquait, c'est la FORME. On sert donc une page, avec la commande à
    // copier — et sans une seule requête vers l'extérieur, puisque la ruche
    // n'en émet jamais.
    //
    // `install.sh` construit désormais l'écran (1,9 s) : cette page ne devrait
    // se voir que sur un clone monté à la main. Elle reste le filet de celui-là.
    const PAGE_SANS_ECRAN = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hive — l'écran n'est pas construit</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#f7f3e9; color:#1b1712; padding:24px;
         font:16px/1.55 'Segoe UI', system-ui, sans-serif }
  main { max-width:34rem }
  h1 { margin:0 0 14px; font-size:clamp(24px,5vw,34px); letter-spacing:-.03em }
  p { margin:0 0 16px; color:#4a4238 }
  code { display:block; padding:14px 16px; border-radius:10px;
         background:#1b1712; color:#f4eee0; overflow-x:auto;
         font:14px ui-monospace, SFMono-Regular, Menlo, monospace }
  small { color:#7c7263 }
</style></head><body><main>
  <h1>La ruche tourne. L'écran, lui, n'est pas construit.</h1>
  <p>L'orchestrateur répond — l'API, les nœuds et les tâches fonctionnent.
     Il manque seulement l'interface, qui se construit en une commande&nbsp;:</p>
  <code>npm run build:dashboard</code>
  <p><small>Rechargez cette page ensuite. Rien à réinstaller.</small></p>
</main></body></html>`;
    app.get('/', async (_req, reply) =>
      reply.type('text/html; charset=utf-8').send(PAGE_SANS_ECRAN),
    );
  }

  const authorized = (req: FastifyRequest): boolean =>
    tokenMatches(req.headers['x-hive-token'], config.token);

  const reject = (reply: FastifyReply) => reply.code(401).send({ error: 'token invalide' });

  /** Requête authentifiée par JWT utilisateur. */
  interface AuthRequest extends FastifyRequest {
    userId?: string;
  }

  const authorizedUser = (req: FastifyRequest): boolean => {
    const bearer = req.headers.authorization;
    if (!bearer || !bearer.startsWith('Bearer ')) return false;
    const token = bearer.slice(7);
    const payload = verifyJwt(token);
    if (!payload) return false;
    (req as AuthRequest).userId = payload.sub;
    return true;
  };

  /**
   * Une LECTURE de projet est-elle permise à cet appelant ?
   *
   * ─── L'INCOHÉRENCE QUE CE HELPER SUPPRIME ──────────────────────────────────
   *
   * Onze routes de l'espace projet se gardent par le seul JETON DE RUCHE, sans
   * aucune règle par projet, là où Le Rayon, les membres et les partages se
   * gardent par COMPTE. Conséquence visible tout de suite : un compte qui
   * appelle l'API sans le jeton de ruche reçoit 401 sur le rapport de SON
   * PROPRE projet. Le tableau de bord ne s'en aperçoit pas — il envoie les deux
   * en-têtes — mais toute autre intégration s'y cogne.
   *
   * Ce helper AJOUTE la porte du compte, il n'en retire aucune : ce qui passait
   * hier passe encore. C'est délibérément une ouverture et non un
   * resserrement — resserrer casserait la CLI (qui n'a que le jeton de ruche)
   * et le mode « tableau de bord sans compte », tous deux documentés.
   *
   * ⚠ CE HELPER NE RÉSOUT PAS le fond du problème, et il ne faut pas le croire.
   * Le README dit que `HIVE_TOKEN` SE RECOPIE SUR CHAQUE MACHINE MEMBRE : tant
   * que la porte du jeton reste ouverte sur ces routes, toute abeille de
   * l'essaim lit le plan de merge, la balance et les tâches de n'importe quel
   * projet. Trancher cela change le contrat du produit — c'est une décision
   * d'hôte, pas un correctif qu'on glisse dans un lot.
   */
  const lectureProjetPermise = (req: FastifyRequest, projectId: string): boolean => {
    if (authorized(req)) return true;
    if (!authorizedUser(req)) return false;
    const projet = store.getProject(projectId);
    if (!projet) return false;
    return peutLireCode(
      projet,
      lecteurDe(req),
      store.estMembre(projectId, (req as AuthRequest).userId!),
    );
  };

  /** Trois issues, et le refus ne doit pas dire laquelle. */
  type VerdictEngagement = 'permis' | 'anonyme' | 'absent';

  /**
   * Un ENGAGEMENT de projet est-il permis à cet appelant ? (ADR 0007, tranché)
   *
   * ─── LA DÉCISION, EN UNE PHRASE ────────────────────────────────────────────
   *
   * La frontière n'est pas « lire ou écrire », c'est **« ce projet vous
   * regarde-t-il ? »**. Un acte qui engage un projet exige donc :
   *
   *   · un COMPTE qui a affaire au projet — propriétaire, membre, ou
   *     administrateur de la ruche ; OU
   *   · que le projet n'ait PAS de propriétaire : il n'appartient alors qu'à la
   *     ruche, et le jeton de ruche EST la ruche.
   *
   * ─── CE QUE ÇA FERME, ET CE QUE ÇA NE CASSE PAS ────────────────────────────
   *
   * Ça ferme le fond du constat : une abeille qui a reçu `HIVE_TOKEN` parce
   * qu'elle prête sa machine ne peut plus créer de tâches ni déclencher de
   * merge sur le projet de quelqu'un d'autre — donc plus faire tourner du code
   * sur les machines de l'essaim au nom d'un projet qui ne la regarde pas.
   *
   * Ça ne casse ni la CLI ni le tableau de bord sans compte sur leur voie
   * habituelle : tous deux travaillent sur des projets créés par le jeton,
   * donc ORPHELINS, donc encore ouverts. Ce qui change de main, ce sont les
   * projets QUI APPARTIENNENT à un compte — et c'est précisément la frontière
   * qu'on voulait tracer.
   *
   * ─── POURQUOI LES LECTURES GARDENT LEURS DEUX PORTES ───────────────────────
   *
   * Parce que « le tableau de bord s'utilise sans compte » est annoncé, et que
   * resserrer les lectures le retirerait sans prévenir. Les fermer viendra
   * quand les comptes seront la norme ; d'ici là, `lectureProjetPermise` reste
   * une ouverture. Le déséquilibre est assumé et écrit : c'est l'écriture qui a
   * des conséquences.
   */
  const engagementProjetPermis = (req: FastifyRequest, projectId: string): VerdictEngagement => {
    // Qui n'a RIEN de valide n'a pas à apprendre si le projet existe : c'est le
    // seul cas qui mérite « jeton invalide », et il est indépendant du projet.
    const compte = authorizedUser(req);
    if (!compte && !authorized(req)) return 'anonyme';

    const projet = store.getProject(projectId);
    if (!projet) return 'absent';
    if (compte) {
      const moi = (req as AuthRequest).userId!;
      if (peutEngager(projet, lecteurDe(req), store.estMembre(projectId, moi))) return 'permis';
    }
    // La porte du jeton ne s'ouvre que sur un projet que personne ne possède.
    if (ouvertAuJetonDeRuche(projet) && authorized(req)) return 'permis';
    return 'absent';
  };

  /**
   * Le refus d'un engagement, DE LA FORME EXACTE DE L'INEXISTENCE.
   *
   * C'est la convention du dépôt (`peutVoirMembres`, ADR 0005), et elle vaut
   * ici pour la même raison : un « 403 » poli sur un projet qu'on ne possède
   * pas confirmerait qu'il existe, et répété sur une liste d'identifiants il
   * dessinerait la carte des projets de la ruche. Refuser et ne-pas-exister
   * rendent donc les MÊMES octets.
   *
   * Le 401 est réservé à qui n'a présenté aucune identité valide : là, le refus
   * ne dit rien du projet, il dit que l'appelant n'est personne.
   */
  const refuserEngagement = (reply: FastifyReply, verdict: VerdictEngagement): FastifyReply =>
    verdict === 'anonyme' ? reject(reply) : reply.code(404).send({ error: 'projet inconnu' });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/state', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return store.getSnapshot();
  });

  // ─── Auth routes ──────────────────────────────────────────────────────────
  app.post<{ Body: { email: string; password: string; displayName: string } }>(
    '/api/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password', 'displayName'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            password: { type: 'string', minLength: 8, maxLength: 256 },
            displayName: { type: 'string', minLength: 2, maxLength: 80 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password, displayName } = req.body;
      if (!isValidEmail(email)) return reply.status(400).send({ error: 'Email invalide' });

      // L'inscription peut être fermée ou sur invitation. Le PREMIER compte
      // passe toujours : sinon une ruche installée en « fermée » serait
      // définitivement inutilisable, sans moyen de créer son administrateur.
      const comptes = store.countUsers();
      const porte = inscriptionPermise({ mode: modeInscription, comptesExistants: comptes });
      if (!porte.permise) return reply.status(403).send({ error: porte.motif });

      const force = jugerMotDePasse(password);
      if (!force.accepte) return reply.status(400).send({ error: force.motif });
      if (!displayName || displayName.length < 2)
        return reply.status(400).send({ error: 'Nom trop court' });
      // Le 409 qui suit est un annuaire des inscrits : on le rend, parce que
      // sans lui personne ne comprendrait pourquoi son inscription échoue, mais
      // on le rend LENTEMENT. Au-delà de quelques collisions dans la fenêtre,
      // cette IP n'apprend plus rien — pas même sur une adresse libre.
      if (!inscriptionAutorisee(req.ip)) {
        return reply
          .status(429)
          .header('retry-after', String(Math.ceil(INSCRIPTION_FENETRE_MS / 1000)))
          .send({ error: 'trop de tentatives d’inscription, réessayez plus tard' });
      }
      if (store.getUserByEmail(email)) {
        collisionInscription(req.ip);
        return reply.status(409).send({ error: 'Email déjà utilisé' });
      }

      const user = store.createUser({
        email,
        passwordHash: hashPassword(password),
        displayName,
      });
      // LE PREMIER COMPTE EST ADMIN. C'est la seule amorce qui ne demande ni
      // mot de passe par défaut, ni variable d'environnement, ni route
      // secrète : celui qui installe la ruche est celui qui l'administre.
      const role = roleALaCreation(comptes);
      store.setRole(user.id, role, 'amorçage');
      return { token: signJwt(user.id, user.email), role };
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 254 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const now = Date.now();
      const cle = cleCompte(email);

      // AVANT le PBKDF2, et c'est tout l'intérêt : un verrou qui ne
      // s'appliquerait qu'après le calcul ne protégerait ni le mot de passe
      // ni le CPU du hub.
      const porte = tentativeAutorisee(
        echecsCompte.get(cle) ?? compteurVide(),
        echecsIp.get(req.ip) ?? compteurVide(),
        now,
      );
      if (!porte.autorisee) {
        return reply
          .status(429)
          .header('retry-after', String(Math.ceil(porte.attendreMs / 1000)))
          .send({ error: porte.motif });
      }

      const user = store.getUserByEmail(email);
      // MÊME réponse, qu'on ne connaisse pas l'email ou que le mot de passe
      // soit faux : distinguer les deux offrirait un annuaire des inscrits.
      if (!user || !verifyPassword(password, user.passwordHash)) {
        noterEchecConnexion(cle, req.ip, now);
        return reply.status(401).send({ error: 'Email ou mot de passe incorrect' });
      }
      // Une réussite efface l'ardoise : quelqu'un qui finit par se souvenir de
      // son mot de passe ne doit pas rester à un essai du verrou.
      echecsCompte.delete(cle);
      return { token: signJwt(user.id, user.email), role: store.getRole(user.id) };
    },
  );

  app.get('/api/auth/me', async (req, reply) => {
    if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
    const userId = (req as AuthRequest).userId!;
    const user = store.getUserById(userId);
    if (!user) return reply.status(404).send({ error: 'Utilisateur introuvable' });
    const { passwordHash: _passwordHash, ...publicUser } = user;
    return { ...publicUser, role: store.getRole(user.id) };
  });

  // Génère une invitation à envoyer à un ami : elle encode l'URL WS publique + le
  // token. L'ami la colle dans `npm run join <invitation>`. ⚠ Elle contient le
  // token : c'est un secret, à transmettre par un canal privé.
  app.get<{ Querystring: { url?: string; label?: string } }>(
    '/api/invite',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', maxLength: 300 },
            label: { type: 'string', maxLength: LIMITS.name },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      // URL joignable : ?url= explicite > HIVE_PUBLIC_URL > IP LAN détectée.
      const wsUrl = req.query.url ?? config.publicUrl ?? detectLanWsUrl(port);
      if (!isWsUrl(wsUrl)) {
        return reply.code(400).send({ error: 'url doit être un ws:// ou wss:// valide' });
      }
      const label = req.query.label ?? `Ruche Hive (${config.host}:${port})`;
      const invite = encodeInvite({ url: wsUrl, token: config.token, label });
      return {
        invite,
        url: wsUrl,
        label,
        joinCommand: `npm run join -- ${invite}`,
        note: "Cette invitation contient le token de la ruche : ne la partagez qu'avec des personnes de confiance.",
        // L'ancien format donne un accès TOTAL et DÉFINITIF. On ne le retire
        // pas (des ruches tournent avec), mais on ne le laisse plus passer pour
        // ce qu'il n'est pas : le remplaçant est annoncé ici même.
        obsolete: {
          raison:
            'Ce format partage le token maître : ni expiration, ni usage unique, ni révocation individuelle.',
          remplacant: 'POST /api/billets',
        },
      };
    },
  );

  // ─── Le trou de vol ────────────────────────────────────────────────────────

  /**
   * Crée un BILLET : une invitation éphémère, à usage compté et révocable, qui
   * ne donne aucun pouvoir sur la ruche — elle ne sert qu'à demander une clé.
   *
   * Le secret n'existe qu'ici, le temps de la réponse : seule son empreinte est
   * rangée. Un billet perdu ne se retrouve pas, il se remplace — c'est le prix
   * (assumé) du fait qu'une base volée ne donne aucun accès.
   */
  app.post<{
    Body: { url?: string; label?: string; ttlMs?: number; uses?: number; insecure?: boolean };
  }>(
    '/api/billets',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', maxLength: 300 },
            label: { type: 'string', maxLength: LIMITS.name },
            ttlMs: { type: 'integer', minimum: 0, maximum: TTL_BILLET_MAX_MS },
            uses: { type: 'integer', minimum: 1, maximum: USAGES_MAX },
            insecure: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const body = req.body ?? {};
      const wsUrl = body.url ?? config.publicUrl ?? detectLanWsUrl(port);
      const transport = jugerTransport(wsUrl);
      if (!transport) {
        return reply.code(400).send({ error: 'url doit être un ws:// ou wss:// valide' });
      }
      // GARDE-FOU : en clair vers l'Internet public, ce n'est pas seulement le
      // billet qui fuite — c'est TOUT le trafic de la ruche, donc les prompts,
      // les logs et les DIFFS DE CODE SOURCE des tâches. On refuse par défaut,
      // et le contournement doit être demandé explicitement (`insecure`) pour
      // que personne ne le fasse sans le savoir.
      if (transport === 'clair_public' && body.insecure !== true) {
        return reply.code(400).send({
          error: 'transport en clair vers une adresse publique',
          detail:
            'ws:// hors réseau privé exposerait le billet ET tout le trafic (prompts, logs, diffs de code) en clair. ' +
            'Utilisez wss:// (voir `npm run cli -- tunnel`), ou passez insecure=true en connaissance de cause.',
          url: wsUrl,
        });
      }

      const now = Date.now();
      const id = `bil-${randomUUID()}`.slice(0, LIMITS.id);
      const secret = tirerSecret();
      const ttl = bornerTtl(body.ttlMs);
      const uses = bornerUsages(body.uses);
      const label = body.label ?? `Ruche Hive (${config.host}:${port})`;
      store.creerBillet({
        id,
        secretHash: empreinte(secret),
        label,
        expiresAt: now + ttl,
        uses,
        now,
      });
      // Fait typé : ni le secret, ni l'empreinte n'entrent au journal.
      emitEvent('invite_created', { ticketId: id, uses, expiresAt: now + ttl, transport });

      const billet = encoderBillet({ url: wsUrl, id, secret, label });
      return reply.code(201).send({
        billet,
        id,
        url: wsUrl,
        label,
        transport,
        expiresAt: now + ttl,
        uses,
        joinCommand: `npm run join -- ${billet}`,
        note:
          uses === 1
            ? 'Billet à usage UNIQUE : il devient inutile dès que votre ami a rejoint.'
            : `Billet valable pour ${uses} machines.`,
      });
    },
  );

  /**
   * Échange un billet contre la clé propre du nœud. Route PUBLIQUE — par
   * construction : celui qui la frappe n'a pas encore d'accès, c'est tout
   * l'objet de l'échange. Sa seule défense est le billet lui-même, d'où :
   * lecture par clé primaire, PBKDF2 payé en dernier, et consommation atomique.
   */
  app.post<{ Body: { billet: string; nodeId: string; label?: string } }>(
    '/api/rejoindre',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['billet', 'nodeId'],
          properties: {
            billet: { type: 'string', minLength: 1, maxLength: 2_000 },
            nodeId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
            label: { type: 'string', maxLength: LIMITS.name },
          },
        },
      },
    },
    async (req, reply) => {
      // Garde de débit AVANT tout travail : le décodage est bon marché, mais la
      // vérification PBKDF2 qui suit ne l'est pas, et cette route est publique.
      if (!joinAutorise(req.ip)) {
        return reply.code(429).send({ error: 'trop de tentatives, réessayez dans une minute' });
      }
      const decode = decoderBillet(req.body.billet, { id: LIMITS.id, nom: LIMITS.name });
      if (!decode) {
        joinEchec(req.ip);
        return reply.code(400).send({ error: 'billet illisible' });
      }

      const now = Date.now();
      const range = store.getBillet(decode.id);

      // ─── LE SECRET D'ABORD, ET TOUJOURS AU MÊME COÛT ────────────────────────
      //
      // L'ordre a changé, et ce n'est pas cosmétique.
      //
      // AVANT : on jugeait l'état du billet, puis on vérifiait le secret. Un
      // identifiant inconnu était refusé SANS que PBKDF2 tourne — donc en une
      // fraction du temps qu'il faut à un identifiant connu. Le message
      // uniforme prétendait cacher quels billets existent ; L'HORLOGE LE
      // DISAIT. L'oracle existait déjà, il était simplement mesuré au
      // chronomètre plutôt que lu dans la réponse.
      //
      // MAINTENANT : on vérifie toujours le secret, contre l'empreinte réelle
      // si le billet existe, contre un LEURRE de coût identique sinon. Les
      // deux chemins coûtent la même chose, et l'oracle temporel disparaît.
      //
      // Ce n'est qu'ENSUITE, une fois le porteur authentifié, qu'on peut dire
      // POURQUOI son billet est refusé : expiré, épuisé ou révoqué ne
      // s'apprennent qu'avec le bon secret en main, donc les dire n'apprend
      // rien à qui ne l'avait pas.
      // Voir `docs/adr/0005-motifs-de-refus-d-un-billet.md`.
      const secretOk = empreinteValide(decode.secret, range?.secretHash ?? empreinteLeurre());

      const refuserOpaque = (refus: string) => {
        joinEchec(req.ip);
        emitEvent('invite_rejected', { ticketId: decode.id, refus });
        return reply.code(401).send({ error: 'billet refusé' });
      };
      // Billet inconnu et secret faux prennent le MÊME chemin et rendent la
      // MÊME réponse, à l'octet près. C'est cette indistinction-là qui empêche
      // d'énumérer les identifiants existants.
      if (!range || !secretOk) return refuserOpaque(range ? 'secret_invalide' : 'inconnu');

      const juge = jugerBillet(
        {
          expireA: range.expiresAt,
          usagesRestants: range.usesLeft,
          revoqueA: range.revokedAt,
        },
        now,
      );
      if (!juge.ok) {
        joinEchec(req.ip);
        emitEvent('invite_rejected', { ticketId: decode.id, refus: juge.refus });
        // Le porteur a prouvé qu'il détenait ce billet : on lui doit la raison,
        // et surtout la marche à suivre.
        return reply
          .code(401)
          .send(
            motifDicible(juge.refus)
              ? { error: EXPLICATION_REFUS[juge.refus], motif: juge.refus }
              : { error: 'billet refusé' },
          );
      }
      const refuser = refuserOpaque;

      // L'IDENTIFIANT EST-IL LIBRE ? Vérifié APRÈS le secret (on ne renseigne
      // pas un inconnu sur les nœuds existants) mais AVANT de consommer le
      // billet (un refus ne doit pas brûler un usage).
      //
      // Sans cette garde, `INSERT OR REPLACE` faisait une ROTATION de la clé du
      // nœud visé : n'importe quel porteur d'un billet valide pouvait éjecter un
      // membre déjà en place en réclamant son identifiant — par malveillance, ou
      // simplement parce que deux personnes ont saisi le même nom. Une
      // fonctionnalité dont l'objet est de protéger les accès ne peut pas offrir
      // ce geste-là.
      //
      // Le déblocage est un GESTE HUMAIN DE L'HÔTE (`exclure`), comme le merge
      // et comme le plafond : re-clé d'un nœud existant est une décision, pas un
      // effet de bord d'une requête anonyme.
      const existante = store.getCleNoeud(req.body.nodeId);
      if (existante && existante.revokedAt === null) {
        joinEchec(req.ip);
        emitEvent('invite_rejected', { ticketId: decode.id, refus: 'identifiant_occupe' });
        return reply.code(409).send({
          error: 'identifiant de nœud déjà utilisé',
          detail:
            "Ce nœud possède déjà une clé. Si c'est bien votre machine et que vous avez perdu " +
            'sa clé, demandez à l’hôte de la ruche : npm run cli -- exclure ' +
            req.body.nodeId,
        });
      }

      // Consommation ATOMIQUE : deux nœuds qui présentent le même billet à
      // usage unique au même instant ne peuvent pas réussir tous les deux.
      if (!store.consommerBillet(decode.id, now)) return refuser('course_perdue');

      const cle = tirerSecret();
      store.poserCleNoeud({
        nodeId: req.body.nodeId,
        keyHash: empreinte(cle),
        label: req.body.label ?? range!.label,
        ticketId: decode.id,
        now,
      });
      emitEvent('node_joined', { nodeId: req.body.nodeId, ticketId: decode.id });
      return reply.code(201).send({ cle, nodeId: req.body.nodeId, label: range!.label });
    },
  );

  // ─── Connecter ses dépôts GitHub ───────────────────────────────────────────
  //
  // Le jeton vient de l'ENVIRONNEMENT et n'est jamais rangé : voir l'en-tête de
  // github.ts. Absent, la fonctionnalité dit comment l'activer plutôt que de
  // rendre un 500 opaque.

  // UNIQUEMENT `HIVE_GITHUB_TOKEN`, et pas de repli sur `GITHUB_TOKEN`.
  //
  // Constaté en exécutant la commande : `GITHUB_TOKEN` est partout — GitHub
  // Actions le définit d'office (portée limitée au dépôt courant), beaucoup
  // d'outils et de shells le posent pour leur propre usage. Un repli dessus
  // faisait envoyer À api.github.com un jeton que l'utilisateur n'avait pas
  // choisi de donner à Hive, et rendait un « jeton refusé » incompréhensible
  // pour quelqu'un qui n'avait jamais configuré la fonctionnalité.
  //
  // Un secret ne se ramasse pas dans l'environnement au hasard d'un nom
  // courant : il se donne explicitement.
  const jetonGithub = process.env.HIVE_GITHUB_TOKEN ?? '';
  const apiGithub = process.env.HIVE_GITHUB_API;

  function sansJeton(reply: FastifyReply): FastifyReply {
    return reply.code(501).send({
      error: 'GitHub non connecté',
      detail:
        'Définissez HIVE_GITHUB_TOKEN dans l’environnement de l’orchestrateur, puis relancez-le. ' +
        'Créez un jeton sur https://github.com/settings/tokens avec la portée « repo » pour voir vos dépôts privés. ' +
        'Le jeton n’est jamais écrit en base — il vit en mémoire, le temps du processus.',
    });
  }

  /** Traduit une erreur GitHub en réponse actionnable, sans jamais fuiter le jeton. */
  function repondreErreurGithub(reply: FastifyReply, err: unknown): FastifyReply {
    if (err instanceof ErreurGithub) {
      return reply.code(err.statut === 400 ? 400 : 502).send({
        error: err.message,
        detail: err.conseil,
        statutGithub: err.statut,
      });
    }
    return reply.code(502).send({
      error: 'GitHub injoignable',
      detail: 'Vérifiez la connexion réseau de l’orchestrateur.',
    });
  }

  /** La liste dans laquelle choisir. Marque ce qui est DÉJÀ importé. */
  app.get<{ Querystring: { q?: string } }>(
    '/api/github/repos',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { q: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!jetonGithub) return sansJeton(reply);
      try {
        const { depots, tronque } = await listerDepots({
          jeton: jetonGithub,
          ...(apiGithub ? { api: apiGithub } : {}),
        });
        // Signaler ce qui est déjà dans la ruche évite le doublon silencieux :
        // deux projets Hive sur le même dépôt, c'est deux plans de merge
        // concurrents sur les mêmes fichiers.
        const deja = new Set(
          store
            .listProjects()
            .map((p) => p.repoUrl)
            .filter((u): u is string => Boolean(u)),
        );
        const filtres = filtrer(depots, req.query.q ?? '');
        return {
          depots: filtres.map((d) => ({ ...d, importe: deja.has(d.cloneUrl) })),
          total: depots.length,
          tronque,
        };
      } catch (err) {
        return repondreErreurGithub(reply, err);
      }
    },
  );

  /** Importe un dépôt choisi : crée le projet Hive correspondant. */
  app.post<{ Body: { fullName: string } }>(
    '/api/github/import',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['fullName'],
          properties: { fullName: { type: 'string', minLength: 3, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!jetonGithub) return sansJeton(reply);
      let depot;
      try {
        depot = await lireUnDepot(
          { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
          req.body.fullName,
        );
      } catch (err) {
        return repondreErreurGithub(reply, err);
      }

      const existant = store.listProjects().find((p) => p.repoUrl === depot.cloneUrl);
      if (existant) {
        return reply
          .code(409)
          .send({ error: 'dépôt déjà importé', projectId: existant.id, nom: existant.name });
      }

      // SI L'APPEL VIENT D'UN COMPTE, LE PROJET LUI APPARTIENT.
      //
      // L'import s'authentifie par le jeton de ruche — il n'a donc personne à
      // qui attribuer le dépôt, et le rangeait orphelin. Conséquence : la
      // personne qui venait de connecter SON dépôt ne pouvait ni en lire le
      // code, ni y admettre quelqu'un, sauf à être administratrice et à
      // l'adopter d'abord. Le tableau de bord, lui, présente toujours un
      // compte : autant s'en servir.
      //
      // La voie CLI reste possible et reste orpheline (elle n'a que le jeton
      // de ruche) : c'est exactement le cas que l'adoption rattrape.
      const parCompte = authorizedUser(req) ? (req as AuthRequest).userId! : null;
      const projet = store.createProject({
        name: depot.fullName,
        repoUrl: depot.cloneUrl,
        // La description vient de GitHub, donc d'un tiers possible. Elle est
        // déjà aplatie et bornée par github.ts ; le Conseil l'emballera ensuite
        // dans son bloc de données non fiables.
        ...(depot.description ? { description: depot.description } : {}),
        ...(parCompte ? { ownerId: parCompte } : {}),
      });
      if (parCompte) store.addMember(projet.id, parCompte, 'owner');
      emitEvent('github_imported', {
        projectId: projet.id,
        fullName: depot.fullName,
        prive: depot.prive,
        ...(parCompte ? { userId: parCompte } : {}),
      });
      return reply.code(201).send({ projet, depot });
    },
  );

  // ─── La livraison : de la production à la pull request ─────────────────────
  //
  // La chaîne complète est décrite en tête de `livraison.ts`. Ici, deux routes
  // et une frontière :
  //
  //   POST /api/livraison            ouvre une branche + une PR — jamais un merge
  //   POST /api/livraison/fusion     fusionne, sur geste humain explicite
  //
  // Les deux sont SÉPARÉES, et c'est tout le sujet. Une seule route qui
  // livrerait puis fusionnerait « si tout est vert » retirerait la seule
  // garantie que Hive donne. Cette séparation est verrouillée par
  // tests/security-invariants.test.ts.
  app.post<{ Body: { taskId: string; base?: string } }>(
    '/api/livraison',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['taskId'],
          properties: {
            taskId: { type: 'string', minLength: 1, maxLength: 200 },
            base: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!jetonGithub) return sansJeton(reply);

      const task = store.getTask(req.body.taskId);
      if (!task) return reply.code(404).send({ error: 'tâche inconnue' });
      const projet = store.getProject(task.projectId);
      const depot = depotDepuisUrl(projet?.repoUrl ?? null);
      if (!depot) {
        return reply.code(409).send({
          error: 'projet sans dépôt GitHub',
          conseil:
            'Importez le dépôt (« hive github-import ») avant de livrer : la ruche doit savoir où ouvrir la pull request.',
        });
      }
      // La DERNIÈRE production de la tâche : c'est celle qui a été relue.
      const resultats = store.resultsForTask(task.id);
      const dernier = resultats[resultats.length - 1];
      if (!dernier || !dernier.success || !dernier.diff) {
        return reply.code(409).send({
          error: 'aucune production livrable',
          conseil: 'La tâche n’a pas de résultat réussi porteur d’un diff.',
        });
      }

      const noeud = store.getNode(dernier.nodeId);
      const inspection = store
        .listInspections()
        .find((i) => i.taskId === task.id && i.nodeId === dernier.nodeId);
      // Les fichiers sont lus du diff AVANT la livraison : le corps de la PR
      // part avec la requête qui l'ouvre, il ne peut donc pas attendre le
      // résultat. Une analyse en trop coûte quelques microsecondes ; une PR
      // qui n'énumère pas ce qu'elle touche coûte une relecture.
      let fichiers: string[];
      try {
        fichiers = cheminsDe(analyserRustine(dernier.diff));
      } catch (err) {
        if (err instanceof ErreurRustine) {
          return reply.code(409).send({ error: err.message, conseil: err.conseil });
        }
        throw err;
      }
      // L'issue d'origine, si cette tâche vient d'une demande GitHub.
      const issueOrigine = store.issueDeTache(task.id);
      try {
        const resultat = await livrer(
          { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
          {
            depot,
            base: req.body.base ?? 'main',
            branche: nomBranche(task.id),
            diff: dernier.diff,
            titre: task.title,
            corps: corpsPr({
              tache: task.title,
              nodeName: noeud?.name ?? dernier.nodeId,
              caste: casteDe(dernier.nodeId),
              ...(inspection ? { verdictGardiennes: inspection.verdict } : {}),
              fichiers,
              // L'issue d'origine, s'il y en a une : c'est elle qui referme la
              // boucle côté GitHub au moment du merge.
              ...(issueOrigine ? { issue: issueOrigine.numero } : {}),
            }),
          },
        );
        // LA LIVRAISON SE RANGE, comme sur la voie autonome. Elle ne le faisait
        // pas ici : le trajet manuel n'émettait qu'un événement, et le numéro
        // de PR n'existait donc nulle part où on puisse le retrouver. Deux
        // conséquences, et la seconde est la grave : on ne pouvait pas rouvrir
        // « où en est ma livraison ? », et surtout RIEN ne permettait de
        // vérifier qu'une PR venait bien de la ruche au moment de la fusionner.
        store.setLivraison({
          taskId: task.id,
          projectId: task.projectId,
          depot,
          pr: resultat.pr,
          branche: nomBranche(task.id),
          etat: 'ouverte',
        });
        // Faits typés uniquement : le texte bilingue est reconstruit à l'affichage.
        emitEvent('delivery_opened', {
          taskId: task.id,
          nodeId: dernier.nodeId,
          pr: resultat.pr,
          fichiers: resultat.fichiers.length,
        });
        return reply.code(201).send(resultat);
      } catch (err) {
        if (err instanceof ErreurRustine) {
          return reply
            .code(409)
            .send({ error: err.message, conseil: err.conseil, chemin: err.chemin });
        }
        return repondreErreurGithub(reply, err);
      }
    },
  );

  /**
   * Fusionne une pull request ouverte par la ruche.
   *
   * GESTE HUMAIN. Rien dans la ruche n'appelle cette route : ni le Scheduler,
   * ni un runner, ni une réaction à un résultat de tâche. Elle existe pour
   * qu'un humain qui a relu puisse conclure sans quitter la ruche.
   */
  app.post<{ Body: { projectId: string; pr: number; methode?: 'merge' | 'squash' | 'rebase' } }>(
    '/api/livraison/fusion',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['projectId', 'pr'],
          properties: {
            projectId: { type: 'string', minLength: 1, maxLength: 200 },
            pr: { type: 'integer', minimum: 1 },
            methode: { type: 'string', enum: ['merge', 'squash', 'rebase'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!jetonGithub) return sansJeton(reply);
      const depot = depotDepuisUrl(store.getProject(req.body.projectId)?.repoUrl ?? null);
      if (!depot) return reply.code(404).send({ error: 'projet sans dépôt GitHub' });

      // ON NE FUSIONNE QUE CE QUE LA RUCHE A OUVERT.
      //
      // Cette route disait déjà « fusionne une pull request ouverte par la
      // ruche » — et ne le vérifiait pas : n'importe quel numéro passait. Elle
      // fusionnait donc, avec le jeton GitHub de l'hôte, N'IMPORTE QUELLE PR du
      // dépôt : celle qu'un humain relit encore, celle d'un contributeur
      // extérieur. Le geste est réputé humain, mais le jeton qui l'autorise se
      // recopie sur chaque machine membre (cf. ADR 0007).
      //
      // La table des livraisons est la source de vérité : la ruche y range ce
      // qu'elle ouvre, sur les DEUX voies désormais. Ce qui n'y est pas ne
      // vient pas d'elle, et ne se fusionne pas d'ici — on ne prétend pas
      // empêcher de fusionner sur GitHub, on refuse seulement de le faire à sa
      // place sur une PR qu'on n'a pas écrite.
      const nôtre = store
        .listLivraisons(req.body.projectId)
        .some((l) => l.pr === req.body.pr && l.depot === depot);
      if (!nôtre) {
        return reply.code(409).send({
          error: 'cette pull request n’a pas été ouverte par la ruche',
          conseil:
            'La ruche ne fusionne que ce qu’elle a livré. Pour les autres pull requests, ' +
            'passez par GitHub — c’est votre dépôt, pas le sien.',
        });
      }

      try {
        const r = await fusionner(
          { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
          depot,
          req.body.pr,
          req.body.methode ?? 'squash',
        );
        // La table suit l'état réel : une livraison fusionnée qui resterait
        // « ouverte » ferait mentir l'écran et rouvrirait la porte à une
        // seconde fusion de la même PR.
        for (const l of store.listLivraisons(req.body.projectId)) {
          if (l.pr === req.body.pr && l.depot === depot) {
            store.setLivraison({
              taskId: l.taskId,
              projectId: l.projectId,
              depot: l.depot,
              pr: l.pr,
              branche: l.branche,
              etat: r.fusionnee ? 'fusionnee' : l.etat,
            });
          }
        }
        emitEvent('delivery_merged', {
          projectId: req.body.projectId,
          pr: req.body.pr,
          methode: req.body.methode ?? 'squash',
        });
        return r;
      } catch (err) {
        return repondreErreurGithub(reply, err);
      }
    },
  );

  // ─── Le Plein Essaim : la ruche se gouverne elle-même ──────────────────────
  //
  // Deux routes, et la seconde est un GESTE HUMAIN qui n'a pas d'équivalent
  // automatique : rien dans la ruche n'appelle POST /api/essaim. Une ruche
  // autonome capable d'élever son propre niveau d'autonomie ne serait pas
  // gouvernée, elle serait échappée — la table `essaim` porte `definiPar` pour
  // que cette phrase reste vérifiable dans trois ans.
  //
  // La lecture rend le PAS que la ruche prendrait maintenant, avec son motif :
  // un bouton qui allume l'autonomie sans montrer ce qu'elle ferait ensuite
  // demande une confiance qu'on n'a pas à demander.

  /**
   * Les productions prêtes à partir sur le dépôt, les plus anciennes d'abord.
   *
   * QUATRE conditions, et aucune n'est superflue :
   *   · la tâche est APPROUVÉE par un humain — la ruche autonome ouvre des
   *     pull requests, elle ne décide pas seule de ce qui mérite d'en être une ;
   *   · son dernier résultat est un succès PORTEUR D'UN DIFF — un « succès » à
   *     diff vide n'a rien à livrer (c'est déjà ce que les Gardiennes disent) ;
   *   · elle n'a pas DÉJÀ été livrée — sans quoi la ruche rouvrirait une PR
   *     par minute sur le dépôt de quelqu'un ;
   *   · le projet a un dépôt connu, sinon il n'y a pas d'endroit où livrer.
   *
   * L'ordre est celui de la création : la ruche livre dans l'ordre où elle a
   * travaillé, et deux relevés successifs rendent la même file.
   */
  /**
   * La contre-visite autorise-t-elle la livraison de cette production ?
   *
   * ─── LA PROMESSE QUI N'EN ÉTAIT PAS UNE ────────────────────────────────────
   *
   * Le cadre envoyé à chaque jeune ouvrière dit, mot pour mot : « TA PRODUCTION
   * SERA RELUE par une ouvrière plus expérimentée avant d'être appliquée ».
   * `exigeContreVisite` et `trancher` savaient depuis toujours quoi en faire —
   * et n'avaient AUCUN appelant. La phrase était donc fausse, et c'est la pire
   * espèce de fausseté : celle qui rassure celui qu'elle vise.
   *
   * ─── CE QUE CETTE PORTE NE FAIT PAS ────────────────────────────────────────
   *
   * Elle ne remplace la revue humaine par rien. `aLivrer` exige déjà
   * `approved`, et cette condition-ci s'AJOUTE : la ruche peut refuser de
   * livrer ce qu'un humain a approuvé, jamais l'inverse. La règle du dépôt —
   * « jamais de fusion sans revue humaine » — n'est pas touchée.
   *
   * `attendre` n'est pas un échec. C'est l'état d'une production que la ruche
   * ne peut pas juger seule, et qui reste donc où elle était : devant l'humain.
   *
   * ─── ET ELLE NE MORD QU'EN `strict` ────────────────────────────────────────
   *
   * En `consignes` — le défaut — le polyéthisme guide sans contraindre, et
   * `modeEffectif` le dit. Faire mordre la porte partout changerait le
   * comportement de toutes les ruches installées, sur une décision que
   * personne n'a prise.
   */
  const contreVisiteAutorise = (
    task: Task,
    inspections: readonly LigneGardienne[],
  ): { ok: boolean; motif: string } => {
    if (polyethismeEnVigueur() !== 'strict') return { ok: true, motif: 'polyéthisme non strict' };

    // `casteDe` plutôt qu'une seconde carte : elle est mémoïsée avec le TTL des
    // Gardiennes, et surtout elle tient LA règle qui compte — un nœud sans
    // antécédent est une NOURRICE. Recalculer ici rendrait `undefined` pour ce
    // même nœud, et l'inconnu deviendrait le cas permissif.
    const auteur = task.assignedNodeId === null ? null : casteDe(task.assignedNodeId);
    if (auteur === null) {
      // Une production sans nœud ne peut pas être jugée par une règle qui parle
      // de castes. Fermé par défaut : elle reste devant l'humain.
      return { ok: false, motif: 'production sans nœud : caste indéterminable' };
    }

    const resultats = store.resultsForTask(task.id);
    const dernier = resultats[resultats.length - 1];
    // `listInspections` rend de la plus récente à la plus ancienne : le premier
    // trouvé est donc le dernier verdict rendu sur cette tâche.
    const inspection = inspections.find((i) => i.taskId === task.id);
    const exigee = exigeContreVisite({
      caste: auteur,
      // On n'arrive ici QUE si les Gardiennes inspectent (`modeEffectif` rend
      // `off` sinon). Une tâche sans inspection est donc une tâche qu'elles
      // n'ont pas eu à juger, pas une ruche sans garde — `clean` est le bon
      // défaut, et la porte se referme alors sur la seule caste.
      verdict: inspection?.verdict ?? 'clean',
      chemins: fichiersTouches(dernier?.diff ?? ''),
    });

    const cv = store.contreVisiteDe(task.id);
    const verdict = trancher({
      exigee,
      casteAuteur: auteur,
      ...(cv === null ? {} : { casteVisiteur: casteDe(cv.visiteurNodeId) }),
      contreVisite:
        cv === null ? null : { suite: cv.suite, raison: cv.raison, mieux: '', force: 0 },
    });
    return { ok: verdict.issue === 'appliquer', motif: verdict.motif };
  };

  const aLivrer = (projectId: string): Task[] => {
    if (!depotDepuisUrl(store.getProject(projectId)?.repoUrl ?? null)) return [];
    const revues = store.listReviews();
    // UNE seule lecture pour toutes les tâches du projet : `listInspections`
    // rend jusqu'à 2 000 lignes, et l'appeler par tâche referait ce travail
    // autant de fois qu'il y a de productions à livrer.
    const inspections = store.listInspections();
    return store
      .listTasks(projectId)
      .filter((t) => revues[t.id] === 'approved' && !store.getLivraison(t.id))
      .filter((t) => {
        const resultats = store.resultsForTask(t.id);
        const dernier = resultats[resultats.length - 1];
        return Boolean(dernier?.success && dernier.diff);
      })
      .filter((t) => contreVisiteAutorise(t, inspections).ok)
      .sort((a, b) => a.createdAt - b.createdAt);
  };

  /** L'état de gouvernance d'un projet, et ce que la ruche ferait maintenant. */
  const etatEssaim = (projectId: string): EtatEssaim & { decision: Decision } => {
    const reglage = store.getEssaim(projectId);
    const niveau: NiveauAutonomie = NIVEAUX.includes((reglage?.niveau ?? 'off') as NiveauAutonomie)
      ? ((reglage?.niveau ?? 'off') as NiveauAutonomie)
      : 'off';

    const inspections = store.listInspections();
    const antecedents = replierAntecedents(inspections);
    const noeuds: NoeudObserve[] = store.listNodes().map((n) => ({
      nodeId: n.id,
      nom: n.name,
      enLigne: n.status === 'online',
      antecedents: antecedents.get(n.id) ?? VIERGE,
    }));

    const taches = store.listTasks(projectId);
    const lecons = leconsCroisees(store.listRecentFailures());
    const projet = store.getProject(projectId);

    // Le plafond vient de La Balance TELLE QU'ELLE EST DÉJÀ CALCULÉE par le
    // Scheduler — on ne refait pas la somme. Une ruche autonome sans borne de
    // dépense brûlerait un mois de temps-machine en une nuit ; une ruche qui
    // calculerait sa borne deux fois de deux façons finirait par se contredire.
    const solde = scheduler.balance.soldes.find((x) => x.projectId === projectId);
    const plafond = solde?.etat ?? 'passe';

    const etat: EtatEssaim = {
      niveau,
      noeuds,
      tachesEnCours: taches.filter((t) => t.status === 'assigned' || t.status === 'running').length,
      tachesPretes: taches.filter((t) => t.status === 'ready').length,
      conseilEnCours: store
        .listSessions()
        .some((c) => c.projectId === projectId && c.etat !== 'clos'),
      // Un conseil clos dont le verdict n'a pas encore été transformé en
      // travail. Ce champ valait `false` en dur : la porte `planifier` de
      // `deciderPas` était donc INATTEIGNABLE, et la ruche délibérait sans
      // jamais rien faire de ses délibérations.
      verdictANourrir: store.sessionsANourrir(projectId).length > 0,
      // Ces deux champs valaient `0` en dur, comme `verdictANourrir` : les
      // portes `livrer` et `fusionner` étaient donc inatteignables elles aussi.
      productionsALivrer: aLivrer(projectId).length,
      prAFusionner: store.listLivraisons(projectId, 'ouverte').length,
      depotInscrit:
        Boolean(reglage?.depotInscrit) && depotDepuisUrl(projet?.repoUrl ?? null) !== null,
      lecons,
      plafond,
      derive: mesurerDerive({
        // Les lignes brutes deviennent des FAITS mesurables ici : le compte de
        // lignes vient du diff, la signature des logs. Les deux fonctions sont
        // pures et partagées avec les modules qui les ont définies — un second
        // compteur de lignes, ou une seconde normalisation d'erreur, finirait
        // par diverger de l'original (même leçon que l'ANSI de brood.ts).
        productions: store.listProductionsPourDerive(FENETRE).map((r) => {
          const { ajouts, suppressions } = compterLignes(r.diff);
          return {
            verdict: (r.verdict === 'hollow' || r.verdict === 'suspect'
              ? r.verdict
              : 'clean') as Verdict,
            ajouts,
            suppressions,
            signature: r.success ? '' : signatureEchec(r.logs),
            createdAt: r.createdAt,
          };
        }),
        dernierApportHumain: store.dernierApportHumain(),
        now: Date.now(),
      }),
    };
    return { ...etat, decision: deciderPas(etat) };
  };

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/essaim',
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const e = etatEssaim(req.params.projectId);
      const suivi = cadencier.suivi(req.params.projectId);
      return {
        niveau: e.niveau,
        decision: e.decision,
        gouvernantes: gouvernantes(e.noeuds).map((g) => ({ nodeId: g.nodeId, nom: g.nom })),
        gouvernantesRequises: GOUVERNANTES_MIN,
        depotInscrit: e.depotInscrit,
        plafond: e.plafond,
        derive: e.derive,
        lecons: e.lecons,
        niveaux: NIVEAUX,
        /**
         * Ce que le RUNNER fait de cette décision. Distinct du verdict : une
         * ruche peut décider « délibérer » et ne rien faire parce que l'hôte
         * n'a pas allumé l'autonomie, ou parce qu'elle est en pause après cinq
         * échecs. Sans ces trois champs, l'écran montrerait une décision qui
         * n'arrive jamais et personne ne saurait pourquoi.
         */
        runner: {
          mode: modeRunner,
          enPause: enPause(suivi),
          echecs: suivi.echecs,
          dernierTourA: suivi.dernierTourA,
        },
      };
    },
  );

  /**
   * Règle l'autonomie d'un projet. GESTE HUMAIN, sans équivalent automatique.
   *
   * `depotInscrit` est l'autorisation de fusionner, donnée UNE FOIS pour ce
   * dépôt. Elle est distincte du niveau, et les deux sont exigées ensemble pour
   * qu'une fusion parte (essaim.ts, `deciderPas`).
   */
  app.post<{
    Params: { projectId: string };
    Body: { niveau: NiveauAutonomie; depotInscrit?: boolean };
  }>(
    '/api/projects/:projectId/essaim',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['niveau'],
          properties: {
            niveau: { type: 'string', enum: [...NIVEAUX] },
            depotInscrit: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const projet = store.getProject(req.params.projectId);
      if (!projet) return reply.code(404).send({ error: 'projet inconnu' });

      const veutFusionner = req.body.niveau === 'plein';
      const inscrit = req.body.depotInscrit ?? false;
      // Demander « plein » sur un projet sans dépôt GitHub connu n'a pas de
      // sens : il n'y a rien à fusionner. On le DIT plutôt que d'accepter un
      // réglage qui ne produira jamais rien.
      if (veutFusionner && inscrit && depotDepuisUrl(projet.repoUrl) === null) {
        return reply.code(409).send({
          error: 'projet sans dépôt GitHub',
          conseil:
            'Importez le dépôt (« hive github-import ») avant d’inscrire le projet pour la fusion autonome.',
        });
      }

      store.setEssaim(
        req.params.projectId,
        { niveau: req.body.niveau, depotInscrit: inscrit },
        'humain',
      );
      // Faits typés uniquement — le texte bilingue est reconstruit à l'affichage.
      emitEvent('swarm_level_set', {
        projectId: req.params.projectId,
        niveau: req.body.niveau,
        depotInscrit: inscrit,
      });
      // Régler l'autonomie est LE geste humain qui lève une pause du runner.
      // Sans ce rappel, un projet mis en pause après cinq échecs ne repartirait
      // jamais — et le seul bouton qui parle d'autonomie ne le débloquerait pas.
      cadencier.reprendre(req.params.projectId);

      const e = etatEssaim(req.params.projectId);
      return reply
        .code(200)
        .send({ niveau: e.niveau, depotInscrit: e.depotInscrit, decision: e.decision });
    },
  );

  // ─── Le runner : la ruche agit vraiment ────────────────────────────────────
  //
  // `deciderPas` savait déjà quoi faire ; personne ne l'appelait en boucle. Ce
  // cadencier est ce qui transforme le verdict en geste — et c'est le seul
  // endroit du dépôt où la ruche agit sans clic humain, d'où les garde-fous
  // détaillés en tête d'essaim-runner.ts.
  //
  // `HIVE_RUNNER` est le commutateur de l'HÔTE, distinct du niveau réglé par
  // l'utilisateur. Éteint par défaut : le niveau dit ce que l'utilisateur veut,
  // celui-ci dit si la machine qui paie est d'accord pour le faire.
  const modeRunner = modeRunnerDepuisEnv();

  const cadencier = new Cadencier({
    lireDecision: (projectId) => etatEssaim(projectId).decision,
    lireNiveau: (projectId) => {
      const brut = store.getEssaim(projectId)?.niveau ?? 'off';
      return NIVEAUX.includes(brut as NiveauAutonomie) ? (brut as NiveauAutonomie) : 'off';
    },
    lireMode: () => modeRunner,
    emettre: emitEvent,
    actions: {
      /**
       * Ouvrir un conseil. Coût borné par construction (`TOURS_MAX`), et ne
       * touche à aucun dépôt.
       *
       * `livrer` et `fusionner` restent `non_branche`, VISIBLE dans le
       * Journal : ils écrivent sur le dépôt de quelqu'un et méritent leur
       * propre garde. Une ruche qui ne livre pas parce que la livraison n'est
       * pas câblée doit rester discernable d'une ruche qui n'a rien à livrer.
       */
      deliberer: (projectId) => {
        const projet = store.getProject(projectId);
        if (!projet) throw new Error('projet inconnu');
        // Un seul conseil à la fois, même garde que la route humaine : deux
        // conseils concurrents doubleraient la dépense et rendraient leurs
        // verdicts incomparables.
        const deja = store.sessionsOuvertes().find((s) => s.projectId === projectId);
        if (deja) return Promise.resolve(`conseil déjà ouvert (${deja.id})`);
        const session = ouvrirConseil(depConseil, {
          projectId,
          contexteProjet: [projet.name, projet.description ?? '', projet.repoUrl ?? '']
            .filter(Boolean)
            .join(' — '),
        });
        return Promise.resolve(`conseil ${session.id} ouvert`);
      },

      /**
       * Transformer le verdict d'un conseil clos en travail d'ouvrière.
       *
       * Le plus ANCIEN verdict non nourri d'abord : la ruche exécute ses
       * décisions dans l'ordre où elle les a prises. Et la trace est posée
       * MÊME quand le verdict ne donne aucune tâche — un « départ » ou un
       * conseil vide sont des conclusions, pas des échecs, et les relire à
       * chaque cycle ferait tourner la ruche en rond sur un conseil qui a déjà
       * dit tout ce qu'il avait à dire.
       */
      planifier: (projectId) => {
        const session = store.sessionsANourrir(projectId)[0];
        if (!session) return Promise.resolve('aucun verdict en attente');

        const verdict = evaluerConseil(etatConseil(session));
        // Le CORPS de la proposition n'est pas dans le verdict : `Proposition`
        // ne porte que ce qui sert à départager. Il faut le relire en base.
        const retenue = verdict.retenue
          ? (store
              .listPropositions(session.id)
              .find((p) => p.id === verdict.retenue?.proposition.id) ?? null)
          : null;
        const taches = planifierVerdict({
          issue: verdict.issue,
          question: session.question,
          retenue: retenue ? { titre: retenue.titre, corps: retenue.corps } : null,
        });

        for (const t of taches) {
          const tache = store.createTask({ projectId, title: t.title, prompt: t.prompt });
          emitEvent('swarm_task_created', {
            projectId,
            taskId: tache.id,
            origine: 'conseil',
            sessionId: session.id,
          });
        }
        store.marquerPlanifie(session.id, projectId, taches.length);
        return Promise.resolve(
          taches.length > 0
            ? `${taches.length} tâche(s) depuis le conseil ${session.id}`
            : `conseil ${session.id} clos sans recommandation (${verdict.issue})`,
        );
      },

      /**
       * Ouvrir un chantier sur une leçon systémique.
       *
       * Le garde qui compte est le compte de correctifs DÉJÀ EN VOL : sans
       * lui, une leçon systémique — qui reste systémique tant qu'elle n'est
       * pas corrigée — ferait créer une tâche identique à chaque cycle, une
       * par minute, jusqu'à ce que quelqu'un regarde.
       */
      corriger: (projectId) => {
        const lecon = leconsCroisees(store.listRecentFailures()).find(
          (l) => l.portee === 'systemique',
        );
        if (!lecon) return Promise.resolve('plus de leçon systémique');

        const enVol = store
          .listTasks(projectId)
          .filter(
            (t) =>
              t.title.startsWith('Corriger : ') &&
              (t.status === 'ready' || t.status === 'assigned' || t.status === 'running'),
          ).length;

        const taches = corrigerLecon(
          {
            signature: lecon.signature,
            noeuds: lecon.noeuds,
            occurrences: lecon.occurrences,
            extrait: lecon.extrait,
          },
          enVol,
        );
        if (taches.length === 0) return Promise.resolve(`correctif déjà en vol (${enVol})`);

        for (const t of taches) {
          const tache = store.createTask({ projectId, title: t.title, prompt: t.prompt });
          // Faits typés seulement : la signature est une donnée d'agent, elle
          // n'a rien à faire dans un journal que tout membre peut lire.
          emitEvent('swarm_task_created', {
            projectId,
            taskId: tache.id,
            origine: 'lecon',
            noeuds: lecon.noeuds,
          });
        }
        return Promise.resolve(`chantier correctif ouvert (${lecon.noeuds} machines)`);
      },

      /**
       * Ouvrir la pull request d'une production relue.
       *
       * PREMIER des deux pas qui ÉCRIVENT sur le dépôt de quelqu'un. Trois
       * choses ne s'y négocient pas :
       *
       *   · le jeton vient de l'environnement, jamais de la base, et son
       *     absence est un refus net — pas une tentative qui échouera plus loin
       *     avec un message obscur ;
       *   · la production a été APPROUVÉE par un humain (`aLivrer`). La ruche
       *     autonome ouvre des PR, elle ne décide pas seule de ce qui mérite
       *     d'en être une ;
       *   · UNE seule par cycle. Livrer en rafale, c'est noyer le dépôt sous
       *     des PR qu'aucun humain n'aura le temps de lire — et une ruche dont
       *     on ne lit plus les PR n'est plus relue du tout.
       *
       * L'échec est RANGÉ avec son motif, pas seulement journalisé : une
       * livraison qui disparaît sans trace, c'est une ruche qui retentera
       * exactement la même chose au cycle suivant.
       */
      livrer: async (projectId) => {
        if (!jetonGithub) return 'aucun jeton GitHub configuré (HIVE_GITHUB_TOKEN)';
        const projet = store.getProject(projectId);
        const depot = depotDepuisUrl(projet?.repoUrl ?? null);
        if (!depot) return 'projet sans dépôt GitHub';

        const task = aLivrer(projectId)[0];
        if (!task) return 'aucune production relue à livrer';

        const resultats = store.resultsForTask(task.id);
        const dernier = resultats[resultats.length - 1]!;
        const noeud = store.getNode(dernier.nodeId);
        const inspection = store
          .listInspections()
          .find((i) => i.taskId === task.id && i.nodeId === dernier.nodeId);
        const branche = nomBranche(task.id);
        const issueOrigine = store.issueDeTache(task.id);

        try {
          const fichiers = cheminsDe(analyserRustine(dernier.diff));
          const resultat = await livrer(
            { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
            {
              depot,
              base: 'main',
              branche,
              diff: dernier.diff,
              titre: task.title,
              corps: corpsPr({
                tache: task.title,
                nodeName: noeud?.name ?? dernier.nodeId,
                caste: casteDe(dernier.nodeId),
                ...(inspection ? { verdictGardiennes: inspection.verdict } : {}),
                fichiers,
                ...(issueOrigine ? { issue: issueOrigine.numero } : {}),
              }),
            },
          );
          store.setLivraison({
            taskId: task.id,
            projectId,
            depot,
            pr: resultat.pr,
            branche,
            etat: 'ouverte',
          });
          emitEvent('delivery_opened', {
            taskId: task.id,
            nodeId: dernier.nodeId,
            pr: resultat.pr,
            fichiers: resultat.fichiers.length,
          });
          return `pull request #${resultat.pr} ouverte`;
        } catch (e) {
          // `pr: 0` — il n'y en a pas. La ligne existe pour que la ruche
          // n'essaie pas la même production en boucle ; c'est à l'humain de la
          // débloquer, comme un plafond de La Balance.
          const motif = e instanceof Error ? e.message : String(e);
          store.setLivraison({
            taskId: task.id,
            projectId,
            depot,
            pr: 0,
            branche,
            etat: 'echouee',
            motif: motif.slice(0, 400),
          });
          throw e;
        }
      },

      /**
       * Fusionner une pull request que la ruche a ouverte.
       *
       * LE GESTE LE PLUS ENGAGEANT DE TOUT LE DÉPÔT. Il n'arrive que si TROIS
       * conditions sont réunies, et elles le sont à trois endroits différents :
       *
       *   1. `deciderPas` exige le niveau « plein » ET le dépôt inscrit — une
       *      autorisation donnée une seule fois, à la main, pour ce dépôt-là ;
       *   2. le runner exige les deux interrupteurs, relus juste avant l'effet ;
       *   3. GitHub lui-même refuse (405) si la PR n'est pas fusionnable :
       *      conflit, vérification en échec, ou revue exigée par le dépôt.
       *
       * La troisième n'est pas la nôtre, et c'est justement pour cela qu'elle
       * compte : les protections de branche du propriétaire restent la dernière
       * barrière, et la ruche ne cherche pas à les contourner.
       */
      fusionner: async (projectId) => {
        if (!jetonGithub) return 'aucun jeton GitHub configuré (HIVE_GITHUB_TOKEN)';
        const ouverte = store.listLivraisons(projectId, 'ouverte')[0];
        if (!ouverte) return 'aucune pull request ouverte';

        try {
          const r = await fusionner(
            { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
            ouverte.depot,
            ouverte.pr,
          );
          store.setLivraison({ ...ouverte, etat: r.fusionnee ? 'fusionnee' : 'ouverte' });
          emitEvent('delivery_merged', {
            taskId: ouverte.taskId,
            pr: ouverte.pr,
            fusionnee: r.fusionnee,
          });
          return r.fusionnee ? `pull request #${ouverte.pr} fusionnée` : 'fusion refusée';
        } catch (e) {
          // Un refus de GitHub (405 : conflit, CI rouge, revue exigée) n'est
          // PAS une panne de la ruche : c'est le dépôt qui protège sa branche.
          // On range le motif et on rend la main — retenter en boucle ne
          // changerait rien et brûlerait le quota d'API.
          const motif = e instanceof Error ? e.message : String(e);
          store.setLivraison({ ...ouverte, etat: 'echouee', motif: motif.slice(0, 400) });
          throw e;
        }
      },
    },
  });

  // ─── Le provisionnement automatique ───────────────────────────────────────
  //
  // Quand un abonnement devient actif, les serveurs de son plan sont demandés
  // ICI. Le fournisseur est injectable ; celui livré (« manuel ») ne démarre
  // aucune machine mais produit les instructions exactes, billet compris, pour
  // que l'humain les colle sur n'importe quel VPS. La CHAÎNE est réelle de bout
  // en bout ; seul le « qui allume la machine » est remplaçable.
  const fournisseurServeurs = config.fournisseurServeurs ?? FOURNISSEUR_MANUEL;

  /**
   * Gabarit demandé par défaut. Aligné sur ce que l'isolement borne déjà
   * (2 vCPU / 2 Go de mémoire par tâche) : promettre moins ferait échouer les
   * tâches, promettre plus ferait payer du matériel inutilisé.
   */
  const GABARIT_DEFAUT = '2 vCPU / 4 Go';

  /** Serveurs d'un abonnement, relus depuis la base et rétrécis. */
  const serveursDe = (refAbonnement?: string): Serveur[] =>
    store.listServeurs(refAbonnement).map((r) => ({
      ...r,
      etat: (ETATS_SERVEUR.includes(r.etat as EtatServeur) ? r.etat : 'echoue') as EtatServeur,
    }));

  /**
   * Aligne les serveurs sur les droits d'un abonnement.
   *
   * Appelée à chaque webhook accepté — donc potentiellement REJOUÉE. Toute
   * l'idempotence tient dans `decider`, qui compte ce qui existe déjà : sans
   * elle, chaque re-livraison démarrerait une machine de plus.
   */
  /**
   * Les billets de rattachement des serveurs provisionnés — EN MÉMOIRE SEULE.
   *
   * Un billet à usage unique, expirant, est exactement le genre de secret
   * qu'on ne range pas : il vaut un accès à la ruche tant qu'il n'est pas
   * consommé. Vivre en mémoire signifie qu'un redémarrage du hub le perd, et
   * c'est la bonne propriété — le code le dit déjà ailleurs : « un billet perdu
   * ne se retrouve pas, il se remplace ».
   *
   * Il est remis UNE FOIS puis oublié : celui qui l'a lu l'a, et il ne traîne
   * pas dans une réponse d'API qu'on rejoue en rafraîchissant une page.
   */
  const billetsServeurs = new Map<string, { billet: string; expire: number }>();

  /**
   * Efface les machines dont la rétention est échue. AUCUN geste humain.
   *
   * ─── POURQUOI C'EST UNE OBLIGATION, PAS UN NETTOYAGE ──────────────────────
   *
   * Un abonnement s'arrête : la ruche éteint la machine, et le tableau de bord
   * annonce au client « ⏳ N j avant effacement ». Ne jamais effacer, c'est
   * conserver indéfiniment les données de quelqu'un qui est parti — après le
   * lui avoir promis par écrit, avec un décompte.
   *
   * ─── L'ORDRE DES DEUX GESTES, ET POURQUOI IL EST CELUI-LÀ ─────────────────
   *
   * On demande au fournisseur d'abord, on range ensuite. Si le fournisseur
   * échoue, la ligne RESTE en `arrete` : elle repassera au prochain tour, et
   * quelqu'un peut encore voir qu'il y a une machine à éteindre. Ranger
   * d'abord perdrait la seule trace de ce qu'on paie encore.
   */
  const balayerRetention = async (now: number): Promise<void> => {
    // Pas de retour anticipé sur une liste vide : la boucle ne fait déjà rien.
    // Le garde qui s'y trouvait était une micro-optimisation, et il ajoutait une
    // BRANCHE que rien ne pouvait éprouver — la loupe l'a fait survivre. Une
    // ligne qu'aucun test ne peut atteindre ne se justifie pas par sa vitesse.
    for (const s of aSupprimer(serveursDe(), now)) {
      try {
        if (s.refMachine) await fournisseurServeurs.supprimer(s.refMachine);
      } catch (e) {
        // On NE range PAS : la ligne doit rester visible tant que la machine
        // peut exister quelque part. Elle repassera au prochain tour.
        app.log.warn({ err: e, id: s.id }, 'suppression de machine en échec');
        continue;
      }
      const r = transiter(s, 'supprime', 'rétention échue', now);
      if (!r.applique) continue;
      store.setServeur(r.serveur);
      emitEvent('server_deleted', { serverId: s.id, projectId: s.projectId });
    }
  };

  const alignerServeurs = async (
    projectId: string,
    refAbonnement: string,
    plan: string,
    actif: boolean,
    now: number,
  ): Promise<void> => {
    const existants = serveursDe(refAbonnement);

    if (!actif) {
      // La facture cesse tout de suite ; les données restent le temps de la
      // rétention. Deux gestes séparés, jamais fusionnés.
      for (const s of aArreter(existants)) {
        const r = transiter(s, 'arrete', 'abonnement sans droits', now);
        if (r.applique) {
          try {
            if (s.refMachine) await fournisseurServeurs.arreter(s.refMachine);
          } catch (e) {
            // On range quand même l'arrêt : la ligne doit refléter l'INTENTION,
            // sinon plus personne ne sait qu'il faut réessayer.
            app.log.warn({ err: e, id: s.id }, 'arrêt de machine en échec');
          }
          store.setServeur(r.serveur);
          emitEvent('server_stopped', { serverId: s.id, projectId });
        }
      }
      return;
    }

    const p = planParCle(plan);
    const verdict = decider(
      {
        projectId,
        refAbonnement,
        serveursInclus: p?.serveurs ?? 0,
        gabarit: GABARIT_DEFAUT,
      },
      existants,
    );
    if (verdict.action === 'rien') return;

    for (let i = 0; i < verdict.combien; i++) {
      const id = randomUUID();
      // Le billet est à USAGE UNIQUE : une machine, un billet. Un billet
      // réutilisable traînerait dans les instructions d'un client et vaudrait
      // accès permanent à la ruche.
      const idBillet = `bil-${randomUUID()}`.slice(0, LIMITS.id);
      const secret = tirerSecret();
      const label = `serveur ${id.slice(0, 8)}`;
      store.creerBillet({
        id: idBillet,
        secretHash: empreinte(secret),
        label,
        expiresAt: now + bornerTtl(undefined),
        uses: 1,
        now,
      });
      const urlRuche = config.publicUrl ?? `ws://${config.host}:${port}/ws`;
      const billetServeur = encoderBillet({ id: idBillet, secret, label, url: urlRuche });
      const base: Serveur = {
        id,
        projectId,
        refAbonnement,
        etat: 'demande',
        fournisseur: fournisseurServeurs.nom,
        refMachine: '',
        gabarit: GABARIT_DEFAUT,
        motif: verdict.motif,
        creeA: now,
        majA: now,
        arreteA: 0,
      };
      store.setServeur(base);
      try {
        const machine = await fournisseurServeurs.demarrer({
          gabarit: GABARIT_DEFAUT,
          billet: billetServeur,
          urlRuche,
        });
        // LE BILLET NE SE RANGE PAS. Les instructions le contiennent par
        // construction, et un billet porte le secret EN CLAIR : les écrire
        // dans `motif` annulait toute la précaution prise à côté (ne ranger
        // que `secretHash`, une empreinte PBKDF2). L'empreinte dans `billets`,
        // et le secret juste à côté dans `serveurs`, durablement.
        // Il est remis à l'administrateur par `GET /api/admin/serveurs/:id/billet`,
        // une seule fois, depuis la mémoire.
        const r = transiter(
          base,
          'provisionnement',
          caviarderBillet(machine.instructions, billetServeur).join(' ⏎ '),
          now,
        );
        store.setServeur({ ...r.serveur, refMachine: machine.ref });
        billetsServeurs.set(id, { billet: billetServeur, expire: now + bornerTtl(undefined) });
        emitEvent('server_requested', {
          serverId: id,
          projectId,
          fournisseur: fournisseurServeurs.nom,
        });
      } catch (e) {
        // Un provisionnement raté reste VISIBLE avec son motif : un client qui
        // a payé et qui attend ne doit pas disparaître d'un tableau de bord.
        const r = transiter(base, 'echoue', e instanceof Error ? e.message : String(e), now);
        store.setServeur(r.serveur);
        emitEvent('server_failed', { serverId: id, projectId });
      }
    }
  };

  // ─── Les abonnements : vendre des heures-ouvrières ─────────────────────────
  //
  // Hive ne voit AUCUNE donnée de paiement : ni carte, ni IBAN, ni adresse de
  // facturation. Le processeur les détient ; on n'en garde qu'un identifiant
  // opaque et un état (abonnement.ts).
  //
  // Le secret de signature vient de l'environnement, jamais de la base — même
  // doctrine que le jeton GitHub. Sans lui, la route REFUSE TOUT : « pas de
  // secret configuré donc on laisse passer » est la porte dérobée la plus
  // fréquente de toutes les intégrations de paiement.
  const secretWebhook = process.env.HIVE_WEBHOOK_SECRET ?? '';

  /** L'abonnement d'un projet, ou l'absence d'abonnement. */
  const lireAbonnement = (projectId: string): Abonnement => {
    const range = store.getAbonnement(projectId);
    if (!range) return aucunAbonnement(projectId);
    // La base rend une chaîne : on la RÉTRÉCIT ici. Un état inconnu — écrit
    // par une version plus récente, puis relu après un retour arrière — ne
    // doit surtout pas donner de droits par accident. Il retombe sur `aucun`,
    // qui n'en donne aucun.
    const etat = ETATS.includes(range.etat as EtatAbonnement)
      ? (range.etat as EtatAbonnement)
      : 'aucun';
    return { ...range, etat };
  };

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/abonnement',
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const now = Date.now();
      const a = lireAbonnement(req.params.projectId);
      const d = droits(a, now);
      return {
        plan: a.plan,
        etat: a.etat,
        finPeriode: a.finPeriode,
        droits: d,
        plans: PLANS,
        // On dit si un secret est configuré, JAMAIS le secret : sans lui,
        // aucun abonnement ne peut être activé, et le silence sur ce point
        // ferait chercher la panne au mauvais endroit.
        webhookConfigure: secretWebhook !== '',
      };
    },
  );

  /**
   * Webhook du processeur de paiement.
   *
   * PAS de garde par jeton de ruche : le processeur ne le connaît pas. C'est
   * la SIGNATURE qui authentifie, et elle est vérifiée sur le corps BRUT avant
   * qu'on regarde son contenu. Les deux contrôles sont distincts : la
   * signature dit que l'expéditeur détient le secret, elle ne dit rien de la
   * forme de ce qu'il envoie.
   */
  app.post('/api/webhooks/abonnement', async (req, reply) => {
    const brut = (req as { rawBody?: string }).rawBody ?? '';
    const entete = String(req.headers['x-hive-signature'] ?? '');
    const now = Date.now();

    const v = verifierSignature({ charge: brut, entete, secret: secretWebhook, now });
    if (!v.valide) {
      // 401 et un motif COURT : un message bavard aiderait à forger la requête
      // suivante. Le détail utile est journalisé côté serveur, pas renvoyé.
      app.log.warn({ motif: v.motif }, 'webhook d’abonnement refusé');
      return reply.code(401).send({ error: 'signature refusée' });
    }

    const evenement = lireCharge(req.body);
    if (!evenement) return reply.code(400).send({ error: 'charge inexploitable' });
    if (!store.getProject(evenement.projectId)) {
      return reply.code(404).send({ error: 'projet inconnu' });
    }

    const courant = lireAbonnement(evenement.projectId);
    const suivant = appliquerEvenement(courant, evenement);
    if (!suivant) {
      // Événement plus ancien que l'état courant, ou plan inconnu : on accuse
      // réception sans rien changer. Renvoyer une erreur ferait re-livrer le
      // webhook en boucle par le processeur.
      return { applique: false, motif: 'sans effet' };
    }
    store.setAbonnement(suivant);

    // Le plafond de La Balance suit les droits : vendre n'ajoute AUCUN
    // mécanisme d'exécution, cela alimente une porte qui existait déjà.
    //
    // ─── `scheduler.setPlafond`, ET SURTOUT PAS `store.setBudget` ────────────
    //
    // Cette ligne appelait le store directement. Le plafond partait bien en
    // base — et la PORTE continuait d'appliquer l'ancien, parce que le
    // scheduler mémoïse `budgets` et que seul `setPlafond` invalide ce cache.
    //
    // Concrètement, sur une rétrogradation Colonie 200 h → Éclaireuse 10 h : le
    // webhook accepté, l'abonnement à jour, et 190 heures non payées qui
    // passent encore la porte. Symétrique à la montée — un client qui paie plus
    // reste bloqué à son ancien quota. L'écart ne se refermait qu'au
    // redémarrage du processus.
    //
    // La docstring de `setPlafond` dit depuis toujours « C'est le SEUL chemin
    // d'écriture de `budgets` », et la route humaine (plus bas) l'honore. Ce
    // webhook était le seul à ne pas la lire. `tests/bornes-cablees.test.ts`
    // interdit désormais tout autre appelant.
    const d = droits(suivant, now);
    scheduler.setPlafond(evenement.projectId, d.plafondMs, 'abonnement', now);

    // Faits typés seulement — jamais le refExterne, qui identifie un client
    // chez le processeur et n'a rien à faire dans un journal partagé.
    emitEvent('subscription_changed', {
      projectId: evenement.projectId,
      plan: suivant.plan,
      etat: suivant.etat,
      heures: d.heures,
    });

    // LE SERVEUR SE CRÉE TOUT SEUL À L'ACHAT. Après le plafond, pas avant :
    // une machine qui démarre sans quota consommerait sans jamais s'arrêter.
    await alignerServeurs(evenement.projectId, suivant.refExterne, suivant.plan, d.actif, now);
    return { applique: true, etat: suivant.etat, heures: d.heures };
  });

  // ─── L'administration des comptes ─────────────────────────────────────────
  //
  // Toutes ces routes exigent un COMPTE (JWT), pas seulement le jeton de ruche.
  // La distinction compte : le jeton de ruche est partagé avec chaque nœud
  // membre — s'en servir comme preuve d'administration donnerait les pleins
  // pouvoirs à toute machine qui butine.

  /** Le rôle de l'appelant, ou `null` s'il n'est pas authentifié en tant que compte. */
  const roleDe = (req: FastifyRequest): { userId: string; role: Role } | null => {
    if (!authorizedUser(req)) return null;
    const userId = (req as AuthRequest).userId;
    if (!userId) return null;
    const brut = store.getRole(userId);
    return { userId, role: ROLES.includes(brut as Role) ? (brut as Role) : 'membre' };
  };

  /** Garde d'action. Rend l'appelant, ou répond et rend `null`. */
  const exige = (
    req: FastifyRequest,
    reply: FastifyReply,
    action: Parameters<typeof peut>[1],
  ): { userId: string; role: Role } | null => {
    const moi = roleDe(req);
    if (!moi) {
      void reply.status(401).send({ error: 'Non authentifié' });
      return null;
    }
    if (!peut(moi.role, action)) {
      // 403 et pas 404 : l'utilisateur EST authentifié, la ressource existe,
      // et lui faire croire le contraire ne protégerait rien tout en le
      // laissant chercher une panne inexistante.
      void reply.status(403).send({ error: 'Action réservée aux administrateurs' });
      return null;
    }
    return moi;
  };

  /**
   * Le Cerveau, vu comme un graphe.
   *
   * ─── POURQUOI CETTE ROUTE EST EN LECTURE SEULE, ET ADMINISTRATIVE ──────────
   *
   * Le Cerveau est le savoir de TOUTE la ruche : il n'appartient à aucun
   * projet, donc aucune permission par projet ne le couvre. `voir_tous_les_
   * projets` est la seule qui dise « cette personne voit l'ensemble », et c'est
   * exactement le périmètre.
   *
   * Aucune écriture ici, volontairement. Promouvoir un épisode en leçon demande
   * de comprendre POURQUOI, et ce geste-là se fait dans Obsidian, à la main,
   * avec un commit qu'on peut relire et annuler. Un bouton « promouvoir » sur
   * un écran ferait écrire une règle en un clic — or une règle fausse coûte
   * plus cher que pas de règle, parce qu'elle est SUIVIE.
   *
   * Le corps des notes n'est jamais renvoyé : la vue montre la FORME du savoir
   * (qui cite qui, ce qui sert, ce qui dort), pas son contenu. Ça borne aussi
   * la réponse, qu'un cerveau de mille notes ferait exploser autrement.
   */
  app.get('/api/admin/cerveau', async (req, reply) => {
    if (!exige(req, reply, 'voir_tous_les_projets')) return reply;
    // Un dossier absent est l'état NORMAL d'une ruche neuve : `lire` rend une
    // liste vide, et le graphe vide se dessine très bien. Pas de 404 — « pas
    // encore de savoir » n'est pas une erreur.
    return { ...graphe(lire(dossierCerveau), Date.now()), dossier: dossierCerveau };
  });

  app.get('/api/admin/membres', async (req, reply) => {
    if (!exige(req, reply, 'gerer_membres')) return reply;
    return {
      membres: store.listUsersWithRoles(),
      admins: store.countAdmins(),
      inscription: etatInscription(modeInscription, store.countUsers()),
    };
  });

  app.put<{ Params: { userId: string }; Body: { role: Role } }>(
    '/api/admin/membres/:userId/role',
    {
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          additionalProperties: false,
          properties: { role: { type: 'string', enum: [...ROLES] } },
        },
      },
    },
    async (req, reply) => {
      const moi = exige(req, reply, 'changer_role');
      if (!moi) return reply;
      if (!store.getUserById(req.params.userId)) {
        return reply.status(404).send({ error: 'Compte introuvable' });
      }
      const verdict = peutChangerRole({
        auteur: moi.role,
        auteurId: moi.userId,
        cibleId: req.params.userId,
        nouveauRole: req.body.role,
        admins: store.countAdmins(),
      });
      if (!verdict.autorise) return reply.status(409).send({ error: verdict.motif });

      store.setRole(req.params.userId, req.body.role, moi.userId);
      // Faits typés seulement — jamais l'email, qui identifie une personne
      // dans un journal que tout membre de la ruche peut lire.
      emitEvent('role_changed', { userId: req.params.userId, role: req.body.role });
      return { userId: req.params.userId, role: req.body.role };
    },
  );

  // ─── L'administration des serveurs ────────────────────────────────────────
  //
  // Réservée aux administrateurs (`gerer_serveurs`). Le chiffre mis en avant
  // est `facturables` : ce qui coûte de l'argent EN CE MOMENT est la seule
  // chose qu'un hôte ne veut jamais découvrir en retard.

  app.get('/api/admin/serveurs', async (req, reply) => {
    if (!exige(req, reply, 'gerer_serveurs')) return reply;
    const now = Date.now();
    const serveurs = serveursDe();
    // Le nom du projet, pas seulement son identifiant : « hive-a3f2 » ne dit
    // à personne quelle machine il s'apprête à éteindre.
    const noms = new Map(store.listProjects().map((p) => [p.id, p.name]));
    return {
      vue: replierServeurs(serveurs, now),
      serveurs: serveurs.map((s) => ({
        ...s,
        projet: noms.get(s.projectId) ?? '',
        joursAvantSuppression: joursAvantSuppression(s, now),
        // Les gestes que CE serveur acceptera. L'écran n'en propose pas
        // d'autres : recopier la matrice côté navigateur la ferait dériver.
        transitions: transitionsDepuis(s.etat),
      })),
      fournisseur: fournisseurServeurs.nom,
      retentionJours: RETENTION_JOURS,
      serveursMax: SERVEURS_MAX,
    };
  });

  /**
   * Le billet de rattachement d'un serveur — REMIS UNE SEULE FOIS.
   *
   * Il était auparavant rangé en clair dans `serveurs.motif`, parce que les
   * instructions du fournisseur le contiennent par construction. Un billet
   * porte le secret en clair : l'écrire en base annulait toute la précaution
   * prise à côté, où seule une empreinte PBKDF2 est rangée.
   *
   * Une seule remise, puis oubli : celui qui l'a lu l'a. Le laisser
   * consultable indéfiniment recréerait exactement ce qu'on vient de retirer,
   * en mémoire au lieu du disque.
   */
  app.get<{ Params: { id: string } }>('/api/admin/serveurs/:id/billet', async (req, reply) => {
    if (!exige(req, reply, 'gerer_serveurs')) return reply;
    const garde = billetsServeurs.get(req.params.id);
    billetsServeurs.delete(req.params.id);
    if (!garde || garde.expire <= Date.now()) {
      // Même réponse que « jamais eu de billet » : un billet périmé et un
      // billet déjà lu se remplacent tous les deux de la même façon.
      return reply.code(404).send({
        error:
          'aucun billet à remettre pour ce serveur — un billet ne se retrouve pas, ' +
          'il se remplace : relancez le provisionnement.',
      });
    }
    return reply.send({ billet: garde.billet, commande: `npm run join ${garde.billet}` });
  });

  /**
   * Change l'état d'un serveur à la main.
   *
   * Les transitions permises sont celles du module pur : on ne ressuscite pas
   * un serveur supprimé, et on ne saute pas de « demandé » à « prêt ». Un
   * bouton d'administration qui pourrait poser n'importe quel état ferait
   * mentir le tableau de bord au premier clic maladroit.
   */
  app.put<{ Params: { id: string }; Body: { etat: EtatServeur; motif?: string } }>(
    '/api/admin/serveurs/:id',
    {
      schema: {
        body: {
          type: 'object',
          required: ['etat'],
          additionalProperties: false,
          properties: {
            etat: { type: 'string', enum: [...ETATS_SERVEUR] },
            motif: { type: 'string', maxLength: 400 },
          },
        },
      },
    },
    async (req, reply) => {
      const moi = exige(req, reply, 'gerer_serveurs');
      if (!moi) return reply;
      const brut = store.getServeur(req.params.id);
      if (!brut) return reply.code(404).send({ error: 'serveur inconnu' });

      const courant: Serveur = {
        ...brut,
        etat: (ETATS_SERVEUR.includes(brut.etat as EtatServeur)
          ? brut.etat
          : 'echoue') as EtatServeur,
      };
      const now = Date.now();
      const r = transiter(courant, req.body.etat, req.body.motif ?? 'geste humain', now);
      if (r.refus) return reply.code(409).send({ error: r.refus });
      if (!r.applique) return { id: courant.id, etat: courant.etat, change: false };

      // La machine SUIT la décision : sans cet appel, le tableau de bord dirait
      // « arrêté » pendant que la facture continue de courir.
      try {
        if (courant.refMachine && req.body.etat === 'arrete') {
          await fournisseurServeurs.arreter(courant.refMachine);
        }
        if (courant.refMachine && req.body.etat === 'supprime') {
          await fournisseurServeurs.supprimer(courant.refMachine);
        }
      } catch (e) {
        return reply.code(502).send({
          error: 'le fournisseur a refusé',
          conseil: e instanceof Error ? e.message : String(e),
        });
      }
      store.setServeur(r.serveur);
      emitEvent('server_state_changed', { serverId: courant.id, etat: req.body.etat });
      return { id: courant.id, etat: r.serveur.etat, change: true };
    },
  );

  // ─── Le Conseil des Éclaireuses ────────────────────────────────────────────

  /**
   * Ouvre un conseil sur un projet.
   *
   * Le geste est EXPLICITEMENT HUMAIN, et c'est le garde-fou : un conseil crée
   * de vraies tâches d'ouvrières, donc consomme du temps-machine prêté par les
   * membres. Il n'y a volontairement aucun déclenchement automatique — une
   * ruche qui s'interrogerait toute seule en boucle brûlerait le temps de ses
   * membres sans que personne l'ait demandé.
   */
  app.post<{ Params: { projectId: string }; Body: { question?: string } }>(
    '/api/projects/:projectId/conseil',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { question: { type: 'string', maxLength: 500 } },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      // Un seul conseil à la fois par projet : deux conseils concurrents
      // doubleraient la dépense et rendraient leurs verdicts incomparables.
      const dejaOuvert = store.sessionsOuvertes().find((s) => s.projectId === project.id);
      if (dejaOuvert) {
        return reply
          .code(409)
          .send({ error: 'un conseil est déjà en cours sur ce projet', sessionId: dejaOuvert.id });
      }
      const session = ouvrirConseil(depConseil, {
        projectId: project.id,
        ...(req.body?.question ? { question: req.body.question } : {}),
        contexteProjet: [project.name, project.description ?? '', project.repoUrl ?? '']
          .filter(Boolean)
          .join(' — '),
      });
      return reply.code(201).send(vueSession(session.id));
    },
  );

  /** L'état d'un conseil : ses danses, classées, et son verdict s'il est clos. */
  app.get<{ Params: { sessionId: string } }>(
    '/api/conseil/:sessionId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const vue = vueSession(req.params.sessionId);
      if (!vue) return reply.code(404).send({ error: 'conseil inconnu' });
      return vue;
    },
  );

  /** Les conseils récents, du plus récent au plus ancien. */
  app.get('/api/conseils', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return {
      conseils: store.listSessions().map((s) => ({
        id: s.id,
        question: s.question,
        projectId: s.projectId,
        etat: s.etat,
        tour: s.tour,
        issue: s.issue,
        createdAt: s.createdAt,
        closedAt: s.closedAt,
      })),
    };
  });

  /**
   * Vue d'un conseil. Le verdict est RECALCULÉ à la lecture par le module pur
   * plutôt que relu d'une colonne : ainsi la vue ne peut pas diverger de ce que
   * le protocole dirait aujourd'hui, et un conseil archivé reste rejouable.
   */
  /**
   * L'état d'un conseil, tel que `evaluerConseil` l'attend.
   *
   * EXTRAIT plutôt que recopié : la vue humaine et le runner d'essaim lisent
   * tous deux le verdict, et deux constructions parallèles du même état
   * finiraient par diverger — l'écran montrerait alors une recommandation, et
   * la ruche en exécuterait une autre.
   */
  function etatConseil(s: SessionRangee): Parameters<typeof evaluerConseil>[0] {
    return {
      tour: s.tour,
      propositions: store.listPropositions(s.id).map(versProposition),
      avis: store.listAvis(s.id).map((a) => ({
        propositionId: a.propositionId,
        eclaireuse: a.eclaireuse,
        famille: a.famille,
        type: a.type,
        force: a.force,
        tour: a.tour,
      })),
    };
  }

  function vueSession(sessionId: string): Record<string, unknown> | null {
    const s = store.getSession(sessionId);
    if (!s) return null;
    const propositions = store.listPropositions(sessionId);
    const avis = store.listAvis(sessionId);
    const verdict = evaluerConseil(etatConseil(s));
    const parId = new Map(propositions.map((p) => [p.id, p]));
    return {
      id: s.id,
      question: s.question,
      projectId: s.projectId,
      etat: s.etat,
      tour: s.tour,
      issue: s.issue ?? verdict.issue,
      motif: s.motif ?? verdict.motif,
      createdAt: s.createdAt,
      closedAt: s.closedAt,
      enVol: store.tachesADepouiller(sessionId).length,
      danses: verdict.danses.map((d) => {
        const p = parId.get(d.proposition.id);
        return {
          id: d.proposition.id,
          titre: d.proposition.titre,
          corps: p?.corps ?? '',
          // Les sources sont AFFICHÉES, jamais suivies par la ruche.
          sources: lireSources(p?.sources),
          eclaireuse: d.proposition.eclaireuse,
          famille: d.proposition.famille,
          qualite: d.proposition.qualite,
          intensite: d.intensite,
          soutiens: d.soutiens,
          arrets: d.arrets,
          familles: d.familles,
          quorum: d.quorum,
          autoSoutienIgnore: d.autoSoutienIgnore,
          raisons: avis
            .filter((a) => a.propositionId === d.proposition.id && a.raison)
            .map((a) => ({ type: a.type, raison: a.raison, eclaireuse: a.eclaireuse })),
        };
      }),
      retenue: verdict.retenue?.proposition.id ?? null,
    };
  }

  function lireSources(brut: string | undefined): string[] {
    if (!brut) return [];
    try {
      const v: unknown = JSON.parse(brut);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /** Qui a les clés de la ruche. Empreintes jamais exposées. */
  app.get('/api/membres', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const now = Date.now();
    return {
      noeuds: store.listClesNoeuds().map((c) => ({
        nodeId: c.nodeId,
        label: c.label,
        createdAt: c.createdAt,
        lastSeenAt: c.lastSeenAt,
        revoque: c.revokedAt !== null,
      })),
      billets: store.listBillets().map((b) => ({
        id: b.id,
        label: b.label,
        createdAt: b.createdAt,
        expiresAt: b.expiresAt,
        usesLeft: b.usesLeft,
        usesTotal: b.usesTotal,
        // État calculé plutôt que rangé : un billet devient « expiré » par le
        // simple passage du temps, sans que personne n'écrive rien.
        etat:
          b.revokedAt !== null
            ? 'revoque'
            : b.expiresAt <= now
              ? 'expire'
              : b.usesLeft <= 0
                ? 'epuise'
                : 'vivant',
      })),
    };
  });

  /** Exclure un membre — le geste que l'ancien modèle rendait impossible. */
  app.delete<{ Params: { nodeId: string } }>(
    '/api/membres/:nodeId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['nodeId'],
          properties: { nodeId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const fait = store.revoquerCleNoeud(req.params.nodeId);
      if (!fait) return reply.code(404).send({ error: 'nœud inconnu ou déjà révoqué' });
      emitEvent('node_revoked', { nodeId: req.params.nodeId });
      // La révocation doit MORDRE tout de suite : un membre exclu qui reste
      // connecté jusqu'à sa prochaine reconnexion, ce n'est pas une exclusion.
      const socket = nodeSockets.get(req.params.nodeId);
      if (socket) socket.close(4403, 'accès révoqué');
      return { nodeId: req.params.nodeId, revoque: true };
    },
  );

  /** Révoquer un billet encore en circulation. */
  app.delete<{ Params: { id: string } }>(
    '/api/billets/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const fait = store.revoquerBillet(req.params.id);
      if (!fait) return reply.code(404).send({ error: 'billet inconnu ou déjà révoqué' });
      emitEvent('invite_revoked', { ticketId: req.params.id });
      return { id: req.params.id, revoque: true };
    },
  );

  app.get<{ Querystring: { since?: number; limit?: number } }>(
    '/api/events',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            since: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      return store.listEvents(req.query.since ?? 0, req.query.limit ?? 200);
    },
  );

  // Time-Lapse Replay : rejoue le journal pour renvoyer une frise chronologique
  // (une image par événement) + le résumé de l'état final. Lecture seule. La
  // pagination interne (le store plafonne chaque page à 1000) est bornée par
  // EVENT_RETENTION pour éviter tout abus.
  app.get<{ Querystring: { since?: number; limit?: number } }>(
    '/api/replay',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            since: { type: 'integer', minimum: 0 },
            limit: { type: 'integer', minimum: 1, maximum: EVENT_RETENTION },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const cap = req.query.limit ?? EVENT_RETENTION;
      const events: HiveEvent[] = [];
      let cursor = req.query.since ?? 0;
      for (;;) {
        const remaining = cap - events.length;
        if (remaining <= 0) break;
        const page = store.listEvents(cursor, Math.min(1000, remaining));
        if (page.length === 0) break;
        events.push(...page);
        const last = page[page.length - 1];
        if (!last) break;
        cursor = last.id;
      }
      return buildTimeline(events);
    },
  );

  // Waggle Board : classement de contribution des nœuds (nectar), calculé en
  // repliant le journal. Lecture seule. Pagination interne bornée par
  // EVENT_RETENTION (le store plafonne chaque page à 1000).
  app.get('/api/waggle', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const events: HiveEvent[] = [];
    let cursor = 0;
    for (;;) {
      if (events.length >= EVENT_RETENTION) break;
      const page = store.listEvents(cursor, Math.min(1000, EVENT_RETENTION - events.length));
      if (page.length === 0) break;
      events.push(...page);
      const last = page[page.length - 1];
      if (!last) break;
      cursor = last.id;
    }
    return buildWaggleBoard(events);
  });

  // Ghost in the Hive : détection d'anomalies (nœuds flaky/silencieux, tâches en
  // boucle…) par repli du journal. Lecture seule ; pagination interne bornée par
  // EVENT_RETENTION (le store plafonne chaque page à 1000).
  app.get('/api/ghost', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const events: HiveEvent[] = [];
    let cursor = 0;
    for (;;) {
      if (events.length >= EVENT_RETENTION) break;
      const page = store.listEvents(cursor, Math.min(1000, EVENT_RETENTION - events.length));
      if (page.length === 0) break;
      events.push(...page);
      const last = page[page.length - 1];
      if (!last) break;
      cursor = last.id;
    }
    return detectGhosts(events);
  });

  // Hive Pulse : signes vitaux agrégés (débit, latence p50/p95, taux de succès,
  // nœuds actifs) par repli du journal. Lecture seule ; pagination interne bornée.
  // ─── Les Guetteuses ────────────────────────────────────────────────────────
  //
  // Elles ne ferment aucune porte : elles rendent le reniflage BRUYANT. Sans
  // elles, quelqu'un peut passer une nuit à chercher un `.env` ou un
  // `/phpmyadmin` sur une ruche exposée sans que son propriétaire l'apprenne
  // jamais. Le renseignement précède l'intrusion ; le voir, c'est gagner le
  // temps de réagir avant que quoi que ce soit de coûteux n'arrive.
  app.setNotFoundHandler((req, reply) => {
    const maintenant = Date.now();
    const leurre = guet.noter(req.url, req.ip, maintenant);
    if (leurre) {
      // ON N'ÉCRIT PAS AU JOURNAL À CHAQUE PASSAGE, et c'est une correction,
      // pas une économie : le journal est durable et borné à EVENT_RETENTION,
      // et cette route n'est couverte par AUCUNE limitation de débit (le
      // crochet ne voit que `/api/*`). Une boucle `curl` anonyme y écrivait
      // une ligne par requête et chassait tout l'historique d'audit — le
      // module de détection devenait l'arme.
      //
      // `doitAlerter` ne rend un niveau que lorsqu'il MONTE, et au plus une
      // fois par fenêtre. Le compte exact reste en mémoire, pour /api/guet.
      const niveau = guet.doitAlerter(maintenant);
      if (niveau) {
        emitEvent('guet_leurre', {
          niveau,
          chemin: leurre.chemin,
          appat: leurre.appat,
          intention: leurre.intention,
        });
      }
    }
    // La réponse est EXACTEMENT celle d'un 404 ordinaire. Un leurre qui se
    // signale — par un message, un délai, un en-tête — cesse d'être un leurre.
    return reply.code(404).send({ error: 'introuvable' });
  });

  /**
   * Ce que les guetteuses ont vu. Réservé à l'hôte : c'est un renseignement
   * sur qui s'intéresse à sa ruche.
   */
  app.get('/api/guet', async (req, reply) => {
    if (!authorized(req)) return reply.status(401).send({ error: 'Non autorisé' });
    return reply.send({ ...guet.verdict(Date.now()), derniers: guet.derniers() });
  });

  app.get('/api/pulse', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const events: HiveEvent[] = [];
    let cursor = 0;
    for (;;) {
      if (events.length >= EVENT_RETENTION) break;
      const page = store.listEvents(cursor, Math.min(1000, EVENT_RETENTION - events.length));
      if (page.length === 0) break;
      events.push(...page);
      const last = page[page.length - 1];
      if (!last) break;
      cursor = last.id;
    }
    return computePulse(events);
  });

  // Thermorégulation : la température INSTANTANÉE (dérivée de la fenêtre de
  // 10 minutes) ET l'état hystérésé réellement APPLIQUÉ par le scheduler — les
  // deux peuvent diverger brièvement, c'est précisément le rôle de
  // l'hystérésis. Deux noms distincts pour deux sémantiques distinctes.
  app.get('/api/thermo', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const now = Date.now();
    const instantane = lireTemperature(
      store.listEventsInWindow(now - FENETRE_THERMO_MS, TYPES_THERMO),
      now,
    );
    return { instantane, applique: scheduler.thermo };
  });

  // Phéromones : affinité apprise nœud × domaine (qui réussit quel TYPE de
  // tâche), repliée à la demande depuis les résultats récents — vue dérivée
  // pure, jamais matérialisée. Lecture seule ; bornée aux 30 premières traces.
  // Chemin BORNÉ, identique à celui du Scheduler : ≤ 500 résultats, domaine
  // résolu par clé primaire pour les seules tâches citées, mémoïsé.
  app.get('/api/pheromones', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const now = Date.now();
    if (!pheromonesMemo || now - pheromonesMemo.calculeA >= PHEROMONES_TTL_MS) {
      const resultats = store.listResultsForPheromones();
      const domaines = cacheDomaines.domaines(
        resultats.map((r) => r.taskId),
        (manquants) => store.listTaskTexts(manquants),
      );
      pheromonesMemo = { calculeA: now, traces: replierTraces(domaines, resultats, now) };
    }
    return { traces: pheromonesMemo.traces.slice(0, 30) };
  });

  // Les Gardiennes : ce que le contrôle d'entrée a refusé — ou seulement noté.
  // Vue dérivée PURE (`replierInspections`) d'un corpus BORNÉ des dernières
  // inspections, jamais matérialisée.
  //
  // Ce qui est LU ici, en revanche, a bel et bien été écrit : le verdict n'est
  // pas recalculable après coup (`pruneResults` vide `diff` et `logs` au-delà
  // de 5 000 résultats), il est donc rangé à la RÉCEPTION du résultat. Cette
  // route ne fait que replier des faits datés.
  //
  // `mode` est dans la réponse, et il est indispensable : en `consultatif`,
  // `refusees` vaut toujours 0 — non pas parce que rien n'est creux, mais parce
  // que rien n'est refusé. Sans le mode, un zéro se lirait comme une bonne
  // nouvelle.
  app.get('/api/gardiennes', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const now = Date.now();
    if (!gardiennesMemo || now - gardiennesMemo.calculeA >= GARDIENNES_TTL_MS) {
      gardiennesMemo = { calculeA: now, vue: replierInspections(store.listInspections()) };
    }
    return { ...gardiennesMemo.vue, mode: scheduler.gardiennes.mode, fenetre: CORPUS_GARDIENNES };
  });

  // Le polyéthisme : quelle caste la ruche reconnaît à chaque nœud, et pourquoi.
  //
  // Vue dérivée PURE du même corpus borné que /api/gardiennes — rien n'est
  // matérialisé, et surtout rien n'est déclaré : un nœud ne peut pas annoncer
  // sa caste, elle est constatée (polyethisme.ts, doctrine règle 1).
  //
  // `mode` est indispensable dans la réponse : en `consignes`, `exigeraient`
  // compte les productions qui SERAIENT relues en `strict`, alors qu'aucune ne
  // l'est réellement. Sans le mode, ce nombre se lirait comme un travail fait.
  app.get('/api/polyethisme', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const now = Date.now();
    const inspections = store.listInspections();
    const antecedents = replierAntecedents(inspections);
    const noeuds = store.listNodes().map((n) => {
      const a = antecedents.get(n.id) ?? VIERGE;
      return {
        nodeId: n.id,
        name: n.name,
        agentType: n.agentType,
        caste: casteDe(n.id, now),
        productions: a.productions,
        creuses: a.creuses,
        suspectes: a.suspectes,
        fiabilite: Math.round(fiabilite(a) * 100) / 100,
      };
    });
    return {
      mode: polyethismeEnVigueur(),
      modeDemande: modePolyethismeDemande,
      fenetre: CORPUS_GARDIENNES,
      seuils: { batisseuse: SEUIL_BATISSEUSE, butineuse: SEUIL_BUTINEUSE },
      noeuds: noeuds.sort((a, b) => b.productions - a.productions || a.name.localeCompare(b.name)),
    };
  });

  // La Balance : où est passé le temps-ouvrière que la ruche a emprunté à ses
  // membres. Vue dérivée PURE, recalculée depuis un corpus borné — jamais
  // matérialisée, jamais écrite. `fenetre` dit sur combien de tentatives
  // l'imputation a été faite, `aJour` si le grand livre a fini son rattrapage :
  // un chiffre qui ne dit pas ce qu'il n'a pas vu est un chiffre qui ment.
  //
  // `durationMs` mesure le temps machine PRÊTÉ, pas le travail accompli : c'est
  // la bonne unité pour dire ce que la ruche a consommé chez ses membres, et
  // une très mauvaise pour juger un nœud. Le tableau par nœud n'est donc jamais
  // trié en « pire contributeur » (balance.ts, doctrine règle 4).
  app.get('/api/balance', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const balance = scheduler.balance;
    return {
      version: VERSION_BALANCE,
      mode: balance.mode,
      aJour: balance.aJour,
      pesee: peser(),
      soldes: balance.soldes,
      fenetre: CORPUS_BALANCE,
    };
  });

  /**
   * Solde neutre d'un projet qui ne figure pas dans le grand livre : il n'a
   * encore rien dépensé — ou le livre ne tourne pas (mode `off`), et c'est
   * `mode` qui le dit dans la même réponse.
   *
   * `plafondMs` est repris de `budgets` et non forcé à `null` : l'intention
   * humaine existe en base indépendamment du livre, et un plafond qui
   * disparaîtrait de l'affichage parce que la Balance est éteinte serait un
   * mensonge — le pire endroit pour en faire un.
   */
  const soldeVide = (
    projectId: string,
    plafondMs: number | null = null,
  ): (typeof scheduler.balance)['soldes'][number] & { projectId: string } => ({
    projectId,
    depenseMs: 0,
    tentatives: 0,
    plafondMs,
    etat: 'passe',
    bloque: false,
  });

  // La Balance d'UN projet : sa tranche de pesée, son solde, et surtout
  // l'intention humaine qui le borne — plafond, verdict appliqué, qui l'a posé
  // et quand. C'est la réponse DURABLE à « pourquoi ce projet ne part-il
  // plus ? » : cette question ne doit pas dépendre d'un journal élagué à 5 000
  // événements. Un projet bloqué se lit dans l'état, pas seulement dans
  // l'histoire.
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/balance',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      const balance = scheduler.balance;
      const budget = store.getBudget(project.id);
      const solde =
        balance.soldes.find((s) => s.projectId === project.id) ??
        soldeVide(project.id, budget?.plafondMs ?? null);
      return {
        version: VERSION_BALANCE,
        mode: balance.mode,
        aJour: balance.aJour,
        ...solde,
        /** Trace de l'opérateur (jamais une autorisation) et date de la pose. */
        definiPar: budget?.definiPar ?? null,
        updatedAt: budget?.updatedAt ?? null,
        /** Imputation de ce projet sur la fenêtre bornée — `null` s'il n'y figure pas. */
        compte: peser().parProjet.find((p) => p.projectId === project.id) ?? null,
        fenetre: CORPUS_BALANCE,
      };
    },
  );

  // Poser (ou retirer) le plafond de dépense d'un projet. C'est le SEUL geste
  // qui peut arrêter la ruche pour cause d'économie, et le seul qui peut la
  // redémarrer : le déblocage est HUMAIN et EXPLICITE, exactement symétrique de
  // l'invariant du merge. La ruche ne se ré-autorise jamais elle-même à
  // dépenser.
  //
  // `plafondMs: null` retire le plafond (la ligne est supprimée) : le projet
  // redevient rigoureusement indiscernable d'un projet d'avant la Balance.
  app.put<{ Params: { projectId: string }; Body: { plafondMs: number | null } }>(
    '/api/projects/:projectId/balance',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          required: ['plafondMs'],
          additionalProperties: false,
          properties: {
            // `null` = pas de plafond ; 0 = « ce projet ne dépense plus rien ».
            // Un plafond négatif n'a aucun sens et est refusé par le schéma.
            // Les bornes ci-dessous ne valent QUE parce que `preValidation`
            // a déjà refusé la valeur BRUTE — voir juste en dessous.
            plafondMs: { type: ['integer', 'null'], minimum: 0, maximum: PLAFOND_MAX_MS },
          },
        },
      },
      // Fastify active la COERCITION d'AJV par défaut : sans ce garde-fou,
      // `false` devient l'entier 0 — un projet arrêté net — et `""` devient
      // `null` — un plafond retiré. Le schéma croit borner une valeur que la
      // coercition a déjà remplacée. On refuse donc la valeur BRUTE, ici, où
      // `req.body` est encore le JSON d'origine (preValidation s'exécute AVANT
      // la validation de schéma). Le seul geste qui peut arrêter la ruche pour
      // cause d'économie ne doit jamais être posé par une conversion implicite.
      preValidation: async (req: FastifyRequest, reply: FastifyReply) => {
        const brut = (req.body as { plafondMs?: unknown } | null | undefined)?.plafondMs;
        if (brut !== null && !Number.isInteger(brut)) {
          return reply
            .code(400)
            .send({ error: 'plafondMs doit être un entier de millisecondes, ou null' });
        }
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      // `definiPar` est une TRACE (qui a serré la vis), jamais une
      // autorisation : la garde reste le token du hub. Si un Bearer JWT valide
      // accompagne la requête, on sait QUI ; sinon `null`, et c'est très bien.
      const definiPar = authorizedUser(req) ? ((req as AuthRequest).userId ?? null) : null;
      // Le geste humain est journalisé AVANT d'être appliqué : `setPlafond`
      // relance l'assignation dans la foulée et peut donc émettre un
      // `balance_cap_reached` immédiat. Dans l'autre ordre, la Chronique
      // montrerait la conséquence avant la cause — « seuil franchi » puis
      // « plafond posé » —, illisible précisément dans le cas intéressant.
      // Faits typés uniquement : aucune phrase n'est persistée, le Journal
      // reconstruit le bilingue depuis ces champs.
      emitEvent('balance_cap_set', {
        projectId: project.id,
        plafondMs: req.body.plafondMs,
        ...(definiPar ? { definiPar } : {}),
      });
      scheduler.setPlafond(project.id, req.body.plafondMs, definiPar);
      const balance = scheduler.balance;
      const budget = store.getBudget(project.id);
      const solde =
        balance.soldes.find((s) => s.projectId === project.id) ??
        soldeVide(project.id, budget?.plafondMs ?? null);
      return {
        version: VERSION_BALANCE,
        mode: balance.mode,
        aJour: balance.aJour,
        ...solde,
        definiPar: budget?.definiPar ?? null,
        updatedAt: budget?.updatedAt ?? null,
      };
    },
  );

  app.post<{ Body: { name: string; repoUrl?: string; description?: string } }>(
    '/api/projects',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            repoUrl: { type: 'string', maxLength: 500 },
            description: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      // repoUrl atteint `git clone` sur chaque nœud : refuser tout schéma non sûr
      // (le transport ext:: de git = exécution de commande arbitraire = RCE).
      if (req.body.repoUrl !== undefined && !isValidRepoUrl(req.body.repoUrl)) {
        return reply.code(400).send({
          error: 'repoUrl invalide : schémas autorisés http(s)/git/ssh ou chemin local absolu',
        });
      }
      const project = store.createProject(req.body);
      emitEvent('project_created', { projectId: project.id, name: project.name });
      return reply.code(201).send(project);
    },
  );

  // Queen Bee (Palier 2) : propose un DAG de tâches à partir d'un brief en
  // langage naturel. Sans effet de bord — la sortie est destinée à être revue,
  // ajustée, puis envoyée via POST /api/projects/:id/tasks. Découpage heuristique
  // par défaut (hors-ligne) ; bascule sur l'IA si une clé API locale est présente.
  app.post<{ Body: { brief: string; mode?: 'auto' | 'heuristic' | 'llm' } }>(
    '/api/plan',
    {
      schema: {
        body: {
          type: 'object',
          required: ['brief'],
          additionalProperties: false,
          properties: {
            brief: { type: 'string', minLength: 1, maxLength: 4000 },
            mode: { type: 'string', enum: ['auto', 'heuristic', 'llm'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      try {
        const result = await planBrief(req.body.brief, { mode: req.body.mode ?? 'auto' });
        if (result.tasks.length === 0) {
          return reply.code(422).send({ error: 'brief trop court pour en déduire des tâches' });
        }
        // Balance (prévoir) : ce que ce DAG devrait coûter, d'après les tâches
        // comparables déjà terminées. Purement indicatif, jamais bloquant, et
        // `null` tant que l'échantillon est maigre.
        return { ...result, devis: devisSansRisque(result.tasks) };
      } catch (err) {
        // Mode 'llm' explicite ayant échoué : on remonte l'erreur telle quelle.
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // La Reine répond : dialogue en langage naturel avec la ruche. Réponses
  // composées depuis l'état RÉEL (rapports, pouls, nectar, anomalies, mémoire) ;
  // bascule sur l'IA (clé locale à la Queen) si disponible, repli live sinon.
  app.post<{ Body: { message: string; projectId?: string } }>(
    '/api/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 2000 },
            projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const events: HiveEvent[] = [];
      let cursor = 0;
      for (;;) {
        if (events.length >= EVENT_RETENTION) break;
        const page = store.listEvents(cursor, Math.min(1000, EVENT_RETENTION - events.length));
        if (page.length === 0) break;
        events.push(...page);
        const last = page[page.length - 1];
        if (!last) break;
        cursor = last.id;
      }
      const projects = store.listProjects();
      // Focus fourni → un seul rapport à construire (progressReply filtre déjà
      // dessus) ; sinon un rapport par projet.
      const focusId = req.body.projectId ?? null;
      const reportProjects = focusId ? projects.filter((p) => p.id === focusId) : projects;
      const ctx: ConciergeContext = {
        projects,
        nodes: store.listNodes(),
        reports: reportProjects.map((p) => buildProjectReport(p, store.listTasks(p.id))),
        pulse: computePulse(events),
        waggle: buildWaggleBoard(events),
        ghosts: detectGhosts(events).ghosts,
        memories: store.searchMemories(req.body.message, 3).map((s) => s.memory),
        recentEvents: events.slice(-100),
        reviews: store.listReviews(),
        // Scopé sur le projet ciblé quand il est fourni : la Reine ne mélange
        // pas les revues d'un autre projet dans sa réponse.
        finishedTasks: store
          .listTasks(focusId ?? undefined)
          .filter((t) => t.status === 'done' || t.status === 'failed')
          .map((t) => ({ id: t.id, title: t.title, status: t.status as 'done' | 'failed' })),
        races: scheduler.listRaces().map((r) => ({
          taskId: r.taskId,
          title: store.getTask(r.taskId)?.title ?? r.taskId,
          drones: r.drones.map((d) => ({ nodeId: d.nodeId, status: d.status })),
        })),
        focusProjectId: req.body.projectId ?? null,
      };
      const llm = llmPlannerAvailable() ? anthropicLlm() : undefined;
      return askConcierge(req.body.message, ctx, llm ? { llm } : {});
    },
  );

  // Hive Mind : interroger la mémoire partagée. Sans `q`, renvoie les souvenirs
  // les plus récents ; avec `q`, les plus pertinents (BM25) et leur score.
  app.get<{ Querystring: { q?: string; limit?: number } }>(
    '/api/hive-mind',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: 2000 },
            limit: { type: 'integer', minimum: 1, maximum: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const q = req.query.q?.trim();
      const limit = req.query.limit ?? 5;
      const total = store.countMemories();
      if (!q) {
        return { total, memories: store.listMemories(limit).map((m) => ({ ...m, score: null })) };
      }
      const memories = store
        .searchMemories(q, limit)
        .map((s) => ({ ...s.memory, score: Number(s.score.toFixed(3)) }));
      return { total, memories };
    },
  );

  interface NewTaskBody {
    tasks: { id?: string; title: string; prompt: string; dependsOn?: string[] }[];
  }

  // Rapport d'avancement d'un projet (lecture seule) : avancement %, répartition
  // par statut, nœuds contributeurs. Calculé à partir des tâches du projet.
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/report',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      // DEUX PORTES. Le jeton de ruche (membres de l'essaim, CLI) — ou un lien
      // de partage portant `voir_avancement`.
      //
      // CET ACTE ÉTAIT DÉCLARÉ ET INUTILISABLE. `ACTES_PARTAGES` l'annonce
      // depuis le premier jour, et AUCUNE route ne le consultait : les trois
      // seules qui acceptaient un lien demandaient toutes `lire_code`. Un lien
      // « voir l'avancement » ne montrait donc jamais d'avancement — on
      // promettait au porteur une chose qu'on ne lui donnait pas.
      //
      // L'ordre compte : le refus d'un appelant sans droit reste `reject`, le
      // même que le projet existe ou non. Chercher le projet d'abord sert
      // seulement à juger le lien, jamais à répondre.
      const project = store.getProject(req.params.projectId);
      const parPartage = project
        ? partagePermet(req, project.id, 'voir_avancement')
        : { ok: false as const };
      if (!parPartage.ok && !authorized(req)) return reject(reply);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      const rapport = buildProjectReport(project, store.listTasks(project.id));
      if (!parPartage.ok) return rapport;
      store.toucherPartage(parPartage.partageId);
      // UN PARTAGE MONTRE L'AVANCEMENT, PAS QUI TRAVAILLE. Les identifiants de
      // nœuds nomment les machines de gens qui n'ont pas consenti à figurer
      // dans un lien qu'on fait circuler.
      return { ...rapport, contributingNodes: [] };
    },
  );

  app.post<{ Params: { projectId: string }; Body: NewTaskBody }>(
    '/api/projects/:projectId/tasks',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          required: ['tasks'],
          additionalProperties: false,
          properties: {
            tasks: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {
                type: 'object',
                required: ['title', 'prompt'],
                additionalProperties: false,
                properties: {
                  id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
                  title: { type: 'string', minLength: 1, maxLength: LIMITS.title },
                  prompt: { type: 'string', minLength: 1, maxLength: LIMITS.prompt },
                  dependsOn: {
                    type: 'array',
                    maxItems: 32,
                    items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });

      // Une dépendance doit référencer une tâche existante du projet, ou une
      // tâche du même lot. Les ids fournis ne doivent pas entrer en collision.
      const existingIds = new Set(store.listTasks(project.id).map((t) => t.id));
      const batchIds = new Set<string>();
      for (const t of req.body.tasks) {
        if (t.id) {
          if (existingIds.has(t.id) || batchIds.has(t.id) || store.getTask(t.id)) {
            return reply.code(400).send({ error: `id de tâche déjà utilisé : ${t.id}` });
          }
          batchIds.add(t.id);
        }
      }
      for (const t of req.body.tasks) {
        for (const dep of t.dependsOn ?? []) {
          if (t.id && dep === t.id) {
            return reply.code(400).send({ error: `tâche dépendante d'elle-même : ${t.id}` });
          }
          if (!existingIds.has(dep) && !batchIds.has(dep)) {
            return reply.code(400).send({ error: `dépendance inconnue : ${dep}` });
          }
        }
      }

      // Détection de cycle intra-lot : sans elle, des tâches mutuellement
      // dépendantes resteraient « pending » à jamais, sans erreur visible.
      const cycle = findCycle(req.body.tasks);
      if (cycle) {
        return reply
          .code(400)
          .send({ error: `cycle de dépendances détecté : ${cycle.join(' → ')}` });
      }

      const created = req.body.tasks.map((t) =>
        store.createTask({
          id: t.id,
          projectId: project.id,
          title: t.title,
          prompt: t.prompt,
          dependsOn: t.dependsOn ?? [],
        }),
      );
      for (const t of created) {
        emitEvent('task_created', { taskId: t.id, projectId: project.id, title: t.title });
      }
      // Sting Detector : signaler (sans bloquer) les conflits potentiels que ce
      // nouveau lot introduit — visible dans le journal du dashboard.
      const newIds = new Set(created.map((t) => t.id));
      for (const c of detectConflicts(store.listTasks(project.id))) {
        if (newIds.has(c.a) || newIds.has(c.b)) {
          emitEvent('conflict_detected', {
            projectId: project.id,
            a: c.a,
            b: c.b,
            severity: c.severity,
            ...(c.sharedPaths.length ? { sharedPaths: c.sharedPaths } : {}),
          });
        }
      }
      scheduler.tick(); // promotion + assignation immédiates
      return reply.code(201).send(created);
    },
  );

  // Sting Detector : conflits potentiels au sein d'un projet (analyse advisory).
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/conflicts',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      return { conflicts: detectConflicts(store.listTasks(project.id)) };
    },
  );

  // Honeycomb Merge (Palier 3) : plan d'intégration d'un projet — ordre de merge
  // (dépendances d'abord) + conflits de lignes entre diffs des tâches terminées.
  // Advisory : n'effectue ni merge git ni exécution de tests (côté nœud, différé).
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/merge',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      const tasks = store.listTasks(project.id);
      const diffs = new Map<string, string>();
      for (const t of tasks) {
        if (t.status !== 'done') continue;
        const success = store
          .resultsForTask(t.id)
          .filter((r) => r.success)
          .at(-1);
        if (success) diffs.set(t.id, success.diff);
      }
      return buildMergePlan(tasks, diffs);
    },
  );

  // Honeycomb Merge — déclenche l'exécution réelle du merge sur un nœud : clone,
  // application des diffs dans l'ordre du plan (conflits git réels), tests
  // optionnels. Asynchrone : le résultat revient via merge_result, à lire sur
  // /merge/result. Ne commit ni ne push jamais.
  app.post<{
    Params: { projectId: string };
    Body: { testCommand?: string[]; prepareCommand?: string[]; taskIds?: string[] };
  }>(
    '/api/projects/:projectId/merge/run',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            testCommand: {
              type: 'array',
              minItems: 1,
              maxItems: LIMITS.testArgs,
              items: { type: 'string', minLength: 1, maxLength: LIMITS.arg },
            },
            // La préparation de l'environnement, lancée avant les tests.
            prepareCommand: {
              type: 'array',
              minItems: 1,
              maxItems: LIMITS.testArgs,
              items: { type: 'string', minLength: 1, maxLength: LIMITS.arg },
            },
            // Sélection de revue (Miellerie) : n'intégrer QUE ces tâches.
            taskIds: {
              type: 'array',
              minItems: 1,
              maxItems: LIMITS.mergeDiffs,
              items: { type: 'string', minLength: 1, maxLength: LIMITS.id },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      if (!project.repoUrl) {
        return reply
          .code(400)
          .send({ error: 'le projet doit avoir un dépôt (repoUrl) pour un merge' });
      }
      // Cette commande s'exécutera sur la MACHINE D'UN MEMBRE. Le schéma
      // Fastify ne borne que la forme (tableau de chaînes) ; c'est ici qu'on
      // borne le binaire. Refus tôt et explicite : la vraie garde est côté
      // nœud, celle-ci sert à donner un message lisible plutôt qu'un merge
      // qui échoue silencieusement à l'autre bout.
      if (req.body.testCommand) {
        const verdict = jugerCommandeTest(req.body.testCommand);
        if (!verdict.ok) return reply.code(400).send({ error: verdict.motif });
      }
      // Et la préparation avec, pour la même raison : elle s'exécute là-bas,
      // et une installation exécute les scripts de ce qu'elle installe.
      if (req.body.prepareCommand) {
        const verdict = jugerPreparation(req.body.prepareCommand);
        if (!verdict.ok) return reply.code(400).send({ error: verdict.motif });
      }
      const tasks = store.listTasks(project.id);
      // Le serveur est la SOURCE DE VÉRITÉ des revues : une tâche rejetée en
      // revue ne coule jamais dans le miel, quel que soit le cache du client.
      const reviews = store.listReviews();
      // Sélection optionnelle (revue humaine) : chaque id doit être une tâche
      // done DE CE projet, non rejetée — on refuse explicitement plutôt que
      // d'ignorer.
      const selection = req.body.taskIds ? new Set(req.body.taskIds) : null;
      if (selection) {
        const byId = new Map(tasks.map((t) => [t.id, t]));
        for (const id of selection) {
          const t = byId.get(id);
          if (!t) return reply.code(400).send({ error: `tâche hors projet : ${id}` });
          if (t.status !== 'done') {
            return reply.code(400).send({ error: `tâche non terminée : ${t.title}` });
          }
          if (reviews[id] === 'rejected') {
            return reply.code(400).send({ error: `tâche rejetée en revue : ${t.title}` });
          }
        }
      }
      const doneDiffs = new Map<string, string>();
      let rejectedSkipped = 0;
      for (const t of tasks) {
        if (t.status !== 'done') continue;
        if (selection && !selection.has(t.id)) continue;
        // Sans sélection explicite, les tâches rejetées sont exclues d'office.
        if (!selection && reviews[t.id] === 'rejected') {
          rejectedSkipped++;
          continue;
        }
        const success = store
          .resultsForTask(t.id)
          .filter((r) => r.success)
          .at(-1);
        if (success) doneDiffs.set(t.id, success.diff);
      }
      const plan = buildMergePlan(tasks, doneDiffs);
      if (plan.done === 0 || doneDiffs.size === 0) {
        return reply.code(400).send({
          error:
            rejectedSkipped > 0
              ? 'toutes les tâches terminées sont rejetées en revue — rien à intégrer'
              : 'aucune tâche terminée à intégrer',
        });
      }
      // Ordre topologique du plan, restreint aux tâches réellement à intégrer
      // (sélection de revue et/ou porteuses d'un diff).
      const diffs = plan.order
        .filter((taskId) => doneDiffs.has(taskId))
        .map((taskId) => ({ taskId, diff: doneDiffs.get(taskId) ?? '' }));
      if (diffs.length === 0) {
        return reply.code(400).send({ error: 'aucun diff à intégrer pour cette sélection' });
      }
      // Le nœud rejette silencieusement un assign_merge > LIMITS.mergeDiffs : on
      // borne ici pour renvoyer une erreur claire plutôt que de perdre le merge.
      if (diffs.length > LIMITS.mergeDiffs) {
        return reply
          .code(413)
          .send({ error: `trop de tâches à intégrer (> ${LIMITS.mergeDiffs}) pour un merge (v0)` });
      }
      const totalBytes = diffs.reduce((s, d) => s + d.diff.length, 0);
      if (totalBytes > 1_500_000) {
        return reply.code(413).send({ error: 'diffs trop volumineux pour un merge (v0)' });
      }
      // Choisir un nœud en ligne, connecté ET de service (Night Shift) : un
      // nœud hors service refuserait le merge — autant l'éviter d'office.
      const node = store
        .listNodes()
        .find(
          (n) => n.status === 'online' && nodeSockets.has(n.id) && (nodeOnShift.get(n.id) ?? true),
        );
      const ws = node ? nodeSockets.get(node.id) : undefined;
      if (!node || !ws) {
        return reply
          .code(503)
          .send({ error: 'aucun nœud en ligne et de service pour exécuter le merge' });
      }
      const mergeId = randomUUID();
      pendingMerges.set(mergeId, { projectId: project.id, nodeId: node.id, startedAt: Date.now() });
      send(ws, {
        type: 'assign_merge',
        mergeId,
        repoUrl: project.repoUrl,
        diffs,
        ...(req.body.prepareCommand ? { prepareCommand: req.body.prepareCommand } : {}),
        ...(req.body.testCommand ? { testCommand: req.body.testCommand } : {}),
      });
      emitEvent('merge_started', {
        projectId: project.id,
        mergeId,
        nodeId: node.id,
        diffs: diffs.length,
      });
      return reply.code(202).send({ mergeId, nodeId: node.id, order: plan.order });
    },
  );

  // ─── LES CHANTIERS ─────────────────────────────────────────────────────────
  //
  // Lancer, sur un nœud, un travail que le dépôt DÉCLARE : `npm test`,
  // `npm run lint`, `npm run typecheck`. Deux règles, et elles se lisent dans
  // le code ci-dessous plutôt que dans un commentaire :
  //
  //   1. La liste vient du `package.json` du MIROIR — le dépôt connecté, pas
  //      la ruche. On choisit dans une liste qu'on n'a pas écrite.
  //   2. La route n'expose PAS `intentionHumaine`. Une requête HTTP ne peut
  //      pas prouver qu'un humain est derrière, et `jugerChantier` réserve les
  //      travaux SORTANTS (publier, déployer, démarrer) à une intention
  //      humaine explicite. Les exposer ici reviendrait à laisser n'importe
  //      quel appelant cocher « c'est un humain qui le demande ».

  /** Les scripts déclarés par le miroir d'un projet, ou `{}` s'il n'y en a pas. */
  const scriptsDuMiroir = async (project: Project): Promise<Record<string, string>> => {
    try {
      const fichier = await rayons.lire(project.id, 'package.json');
      const brut: unknown = JSON.parse(fichier.contenu);
      const bloc =
        typeof brut === 'object' && brut !== null
          ? (brut as Record<string, unknown>).scripts
          : null;
      if (typeof bloc !== 'object' || bloc === null) return {};
      const scripts: Record<string, string> = {};
      for (const [k, v] of Object.entries(bloc)) {
        if (typeof v === 'string') scripts[k] = v;
      }
      return scripts;
    } catch {
      // Pas de `package.json`, illisible, ou miroir absent : aucun chantier.
      // Rendre `{}` plutôt que lever laisse `jugerChantier` produire le bon
      // message — « ce dépôt n'en déclare aucun » — au lieu d'un 500.
      return {};
    }
  };

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/chantiers',
    async (req, reply) => {
      // MÊME PORTE QUE `merge/result` : `lectureProjetPermise`, qui accepte le
      // jeton de ruche. `projetLisible` exige un COMPTE, ce qui fermerait cette
      // liste à la CLI et à un script — or lire les chantiers d'un projet est
      // exactement ce qu'un script fait avant d'en lancer un.
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      if (!(await assurerMiroir(project, reply))) return reply;
      return reply.send({ chantiers: chantiersDe(await scriptsDuMiroir(project)) });
    },
  );

  app.post<{ Params: { projectId: string; nom: string }; Body: { prepareCommand?: string[] } }>(
    '/api/projects/:projectId/chantiers/:nom/run',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'nom'],
          properties: {
            projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
            nom: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prepareCommand: {
              type: 'array',
              minItems: 1,
              maxItems: LIMITS.testArgs,
              items: { type: 'string', minLength: 1, maxLength: LIMITS.arg },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      if (!project.repoUrl) {
        return reply.code(400).send({ error: 'le projet doit avoir un dépôt (repoUrl)' });
      }
      // La préparation s'exécute sur la machine d'un membre, et une
      // installation exécute les scripts de ce qu'elle installe.
      if (req.body?.prepareCommand) {
        const v = jugerPreparation(req.body.prepareCommand);
        if (!v.ok) return reply.code(400).send({ error: v.motif });
      }
      if (!(await assurerMiroir(project, reply))) return reply;

      // LE DÉPÔT DÉCIDE. `intentionHumaine` n'est volontairement pas passée.
      const verdict = jugerChantier(await scriptsDuMiroir(project), req.params.nom);
      if (!verdict.ok) return reply.code(400).send({ error: verdict.motif });

      const node = store
        .listNodes()
        .find(
          (n) => n.status === 'online' && nodeSockets.has(n.id) && (nodeOnShift.get(n.id) ?? true),
        );
      const ws = node ? nodeSockets.get(node.id) : undefined;
      if (!node || !ws) {
        return reply
          .code(503)
          .send({ error: 'aucun nœud en ligne et de service pour lancer ce chantier' });
      }

      const chantierId = randomUUID();
      pendingChantiers.set(chantierId, {
        projectId: project.id,
        nodeId: node.id,
        nom: req.params.nom,
        startedAt: Date.now(),
      });
      // LE MESSAGE NE PORTE AUCUNE COMMANDE — seulement un nom. Le nœud relira
      // le `package.json` de SON clone et composera l'argv lui-même. C'est ce
      // qui fait qu'un hub compromis ne peut désigner que ce que le dépôt
      // déclare déjà.
      send(ws, {
        type: 'assign_chantier',
        chantierId,
        repoUrl: project.repoUrl,
        nom: req.params.nom,
        ...(req.body?.prepareCommand ? { prepareCommand: req.body.prepareCommand } : {}),
      });
      emitEvent('chantier_started', {
        projectId: project.id,
        chantierId,
        nodeId: node.id,
        nom: req.params.nom,
        // La commande est AFFICHÉE à l'humain : elle vient du dépôt, donc c'est
        // une donnée. `chantiersDe` l'a déjà mise sur une ligne.
        argv: argvDe(req.params.nom).join(' '),
      });
      return reply.code(202).send({ chantierId, nodeId: node.id, nom: req.params.nom });
    },
  );

  // ─── LES WORKFLOWS GITHUB ──────────────────────────────────────────────────
  //
  // Le pendant distant des Chantiers : là-bas, c'est GitHub qui exécute, et on
  // lui demande par son API.
  //
  // ─── LA DÉCISION QUI AUTORISE CETTE ROUTE À EXISTER ────────────────────────
  //
  // Un chantier SORTANT (publier, déployer, démarrer) n'est pas lançable par la
  // route locale : elle ne peut pas prouver qu'un humain est derrière. On
  // pourrait croire que lancer un workflow tombe sous la même règle — il tourne
  // à l'extérieur, il peut déployer, il consomme des minutes.
  //
  // Ce qui le distingue tient en une ligne de YAML : `on: workflow_dispatch:`.
  //
  // C'est le propriétaire du dépôt qui l'écrit, dans le dépôt, sur sa branche
  // par défaut. Ce n'est pas une CAPACITÉ que la ruche découvre — c'est une
  // PERMISSION que le dépôt déclare, lisible par une machine, et GitHub la fait
  // respecter lui-même : un workflow qui ne la porte pas répond 422, quoi qu'on
  // demande. C'est la forme la plus forte de « la ruche exécute ce que le dépôt
  // déclare » qu'on puisse trouver.
  //
  // Et la ruche ne choisit toujours pas librement : seulement dans la liste que
  // l'API vient de rendre, par identifiant numérique — jamais par un nom de
  // fichier, qui serait un morceau d'URL (voir `shared/workflow.ts`).

  /** Le `owner/repo` d'un projet, ou une réponse d'erreur déjà envoyée. */
  const depotGithubDe = (project: Project, reply: FastifyReply): string | null => {
    const fullName = project.repoUrl ? fullNameDepuisUrl(project.repoUrl) : null;
    if (!fullName) {
      reply.code(400).send({
        error: 'ce projet n’a pas de dépôt GitHub',
        detail:
          'Les workflows demandent un dépôt hébergé sur GitHub. Ce projet pointe ' +
          'vers autre chose (un chemin local, ou une URL que la ruche ne sait pas lire).',
      });
      return null;
    }
    return fullName;
  };

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/workflows',
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      if (!jetonGithub) return sansJeton(reply);
      const fullName = depotGithubDe(project, reply);
      if (!fullName) return reply;
      try {
        const { workflows, tronque } = await listerWorkflows(
          { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
          fullName,
        );
        return reply.send({ workflows, tronque });
      } catch (err) {
        return repondreErreurGithub(reply, err);
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { workflowId?: string } }>(
    '/api/projects/:projectId/workflows/runs',
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      if (!jetonGithub) return sansJeton(reply);
      const fullName = depotGithubDe(project, reply);
      if (!fullName) return reply;
      // `workflowId` arrive en chaîne (querystring). `Number` et non
      // `parseInt` : « 12abc » deviendrait 12 avec `parseInt`, et 12 n'est pas
      // ce qui a été demandé.
      //
      // LA VÉRIFICATION VIT DANS `lireRuns`, PAS ICI. Elle y était en double,
      // et la loupe l'a montré : couper la copie de cette route ne faisait
      // rougir personne, parce que `lireRuns` refuse déjà un identifiant qui
      // n'en est pas un. Une garde qu'on peut retirer sans rien changer n'est
      // pas une garde — c'est un endroit de plus où la règle peut diverger.
      const brut = req.query.workflowId;
      const id = brut === undefined ? undefined : Number(brut);
      try {
        return reply.send({
          runs: await lireRuns(
            { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
            fullName,
            id === undefined ? {} : { workflowId: id },
          ),
        });
      } catch (err) {
        return repondreErreurGithub(reply, err);
      }
    },
  );

  app.post<{ Params: { projectId: string; workflowId: string }; Body: { ref?: string } }>(
    '/api/projects/:projectId/workflows/:workflowId/run',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { ref: { type: 'string', minLength: 1, maxLength: 255 } },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      if (!jetonGithub) return sansJeton(reply);
      const fullName = depotGithubDe(project, reply);
      if (!fullName) return reply;

      const id = Number(req.params.workflowId);
      if (!Number.isSafeInteger(id)) {
        return reply.code(400).send({
          error: 'identifiant de workflow invalide',
          detail:
            'Un workflow se désigne par son identifiant NUMÉRIQUE, jamais par un ' +
            'nom de fichier : ce segment d’URL accepte les deux côté GitHub, et ' +
            'accepter le nom laisserait écrire un morceau d’URL de son API.',
        });
      }
      // La branche par défaut de la ruche est `main` ; le dépôt peut en avoir
      // une autre, d'où le réglage. Un défaut DOCUMENTÉ vaut mieux qu'une
      // devinette silencieuse.
      const ref = req.body?.ref ?? 'main';
      try {
        const lance = await lancerWorkflow(
          { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
          fullName,
          id,
          ref,
        );
        emitEvent('workflow_lance', {
          projectId: project.id,
          workflowId: lance.workflow.id,
          nom: lance.workflow.nom,
          chemin: lance.workflow.chemin,
          ref: lance.ref,
        });
        // 202 comme les chantiers : GitHub rend 204 SANS CORPS et le run
        // n'existe pas encore au retour de l'appel. On ne peut donc pas rendre
        // d'identifiant de run — c'est `/workflows/runs` qui le trouvera.
        return reply.code(202).send({ workflow: lance.workflow, ref: lance.ref });
      } catch (err) {
        return repondreErreurGithub(reply, err);
      }
    },
  );

  /** Dernier chantier rendu pour ce projet (null tant qu'aucun n'a abouti). */
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/chantiers/result',
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      return reply.send({ resultat: chantierResults.get(req.params.projectId) ?? null });
    },
  );

  // Dernier résultat de merge d'un projet (null tant qu'aucun n'a abouti).
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/merge/result',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!lectureProjetPermise(req, req.params.projectId)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      return { result: mergeResults.get(req.params.projectId) ?? null };
    },
  );

  // Le diff d'une tâche remonte pour revue humaine — jamais de merge automatique.
  app.get<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/results',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      return store.resultsForTask(req.params.taskId);
    },
  );

  // Revue humaine (Miellerie) : verdict approved/rejected partagé entre tous
  // les opérateurs. `state: null` efface la revue. La revue n'a AUCUN effet de
  // bord sur la tâche — c'est un avis humain, le merge reste un geste séparé.
  app.post<{
    Params: { taskId: string };
    Body: {
      state: 'approved' | 'rejected' | null;
      expectedUpdatedAt?: number | null;
      clientId?: string;
    };
  }>(
    '/api/tasks/:taskId/review',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          required: ['state'],
          additionalProperties: false,
          properties: {
            state: { type: ['string', 'null'], enum: ['approved', 'rejected', null] },
            // Compare-and-set OPT-IN : horodatage du verdict que le client
            // croyait courant (null = « aucun verdict »). 409 si décalage —
            // un geste posé sur une vision périmée ne l'emporte jamais.
            expectedUpdatedAt: { type: ['integer', 'null'] },
            // Identité d'onglet (écho dans task_reviewed) : permet au client
            // de distinguer ses propres échos de ceux des autres opérateurs.
            clientId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const task = store.getTask(req.params.taskId);
      if (!task) return reply.code(404).send({ error: 'tâche inconnue' });
      // Pas de pré-approbation : on ne juge un diff qu'une fois la tâche
      // terminée (409 comme /cancel pour les conflits d'état). L'effacement
      // (null) reste permis quel que soit le statut — toujours sûr.
      if (req.body.state !== null && task.status !== 'done' && task.status !== 'failed') {
        return reply.code(409).send({
          code: 'task_not_terminal',
          error: `tâche ${task.status} — revue possible seulement après terminaison`,
        });
      }
      if (req.body.expectedUpdatedAt !== undefined) {
        const current = store.getTaskReview(task.id);
        const currentTs = current?.updatedAt ?? null;
        if (currentTs !== req.body.expectedUpdatedAt) {
          return reply.code(409).send({
            code: 'review_conflict',
            error: 'verdict modifié par un autre opérateur — rechargez la revue',
            currentState: current?.state ?? null,
            currentUpdatedAt: currentTs,
          });
        }
      }
      store.setTaskReview(task.id, req.body.state);
      emitEvent('task_reviewed', {
        taskId: task.id,
        state: req.body.state,
        ...(req.body.clientId ? { clientId: req.body.clientId } : {}),
      });
      const saved = store.getTaskReview(task.id);
      return { taskId: task.id, state: req.body.state, updatedAt: saved?.updatedAt ?? null };
    },
  );

  // Toutes les revues (dictionnaire taskId → verdict) — hydrate le dashboard.
  // `updatedAt` : horodatages par tâche, pour le compare-and-set opt-in.
  app.get('/api/reviews', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return { reviews: store.listReviews(), updatedAt: store.listReviewTimestamps() };
  });

  // Parlement des Agents : consensus par vote sur les résultats d'une tâche.
  // Lecture seule : on charge les résultats stockés, on en fait des bulletins
  // (signature = empreinte du diff, agentType retrouvé via le nœud) et on
  // dépouille. Utile quand plusieurs nœuds ont produit un résultat pour la même
  // tâche (tentatives multiples, futurs drones).
  app.get<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/consensus',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const ballots: Ballot[] = store.resultsForTask(req.params.taskId).map((r) => ({
        nodeId: r.nodeId,
        agentType: store.getNode(r.nodeId)?.agentType ?? 'inconnu',
        success: r.success,
        signature: signatureOf(r.diff),
        // La SURFACE — le seul signal qui fonctionne sur du code, l'identité
        // textuelle ne pouvant rien mesurer sur un diff (voir parliament.ts).
        // `fichiersTouches` est celle des Gardiennes : une deuxième lecture de
        // diff finirait par ne plus dire la même chose que la première.
        fichiers: fichiersTouches(r.diff),
      }));
      return tally(ballots);
    },
  );

  // Drone Wars : lance une course compétitive — la même tâche (ready) confiée
  // à jusqu'à `factor` nœuds distincts, le premier succès gagne, les perdants
  // sont annulés. Geste explicite (jamais automatique), pour tâches critiques.
  app.post<{ Params: { taskId: string }; Body: { factor?: number } }>(
    '/api/tasks/:taskId/race',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { factor: { type: 'integer', minimum: 2, maximum: 5 } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const started = scheduler.startRace(req.params.taskId, req.body.factor ?? 3);
      if (!started.ok) {
        const code = started.error.includes('inconnue')
          ? 404
          : started.error.includes('aucun nœud')
            ? 503
            : 409;
        return reply.code(code).send({ error: started.error });
      }
      return reply.code(202).send({ taskId: req.params.taskId, drones: started.drones });
    },
  );

  // État d'une course en vol (null si aucune) — pour le dashboard/CLI.
  app.get<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/race',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const race = scheduler.getRace(req.params.taskId) ?? null;
      if (race) return { race, victory: null };
      // Course déjà tranchée : le journal garde la victoire (drone_won) —
      // permet au tiroir d'afficher le vainqueur après coup.
      const won = store.lastEventFor('drone_won', req.params.taskId);
      const victory =
        won && typeof won.payload.nodeId === 'string'
          ? {
              nodeId: won.payload.nodeId,
              cancelled: typeof won.payload.cancelled === 'number' ? won.payload.cancelled : 0,
            }
          : null;
      return { race: null, victory };
    },
  );

  // Toutes les courses en vol — permet au dashboard de marquer d'un ⚔ les
  // nœuds actuellement en course (les courses vivent en mémoire du scheduler).
  app.get('/api/races', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return { races: scheduler.listRaces() };
  });

  // Annulation humaine d'une tâche : le nœud reçoit cancel_task et abandonne.
  app.post<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/cancel',
    {
      schema: {
        params: {
          type: 'object',
          required: ['taskId'],
          properties: { taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const task = store.getTask(req.params.taskId);
      if (!task) return reply.code(404).send({ error: 'tâche inconnue' });
      if (task.status === 'done' || task.status === 'failed') {
        return reply.code(409).send({ error: `tâche déjà ${task.status}` });
      }
      // La notification cancel_task part du scheduler (onCancel) : primaire en
      // mono, TOUS les drones en course — plus d'envoi manuel dupliqué ici.
      const cancelled = scheduler.cancelTask(task.id, 'annulée par un humain');
      stateDirty = true;
      return cancelled;
    },
  );

  // ─── Le chemin de RETOUR : ce que la pull request renvoie à la ruche ───────
  //
  // La ruche savait aller — issue → DAG → travail → pull request — et pas
  // revenir. Une fois la PR ouverte elle devenait aveugle : la CI casse,
  // personne ne le sait ; un relecteur demande des changements, personne ne le
  // sait. Le travail s'arrêtait là où il commence vraiment.
  //
  // DEUX ROUTES, ET LA SÉPARATION EST LA DÉCISION :
  //
  //   · VOIR ne coûte que des appels de lecture chez GitHub. L'état est dérivé
  //     à chaque lecture, jamais rangé — un statut rangé se périme exactement
  //     quand il compte.
  //   · REPRENDRE fait travailler l'essaim, donc dépense du temps-ouvrière.
  //     C'est un GESTE, comme prendre une issue et comme fusionner. La ruche ne
  //     se remet pas au travail toute seule sur la foi d'un webhook : ce serait
  //     la seule dépense qu'aucun humain n'aurait demandée.

  /** Les faits d'une livraison, lus chez GitHub et repliés en un état. */
  const etatDeLivraison = async (l: {
    taskId: string;
    depot: string;
    pr: number;
  }): Promise<{
    taskId: string;
    depot: string;
    pr: number;
    etat: EtatLivraison;
    faits: FaitsPr;
  }> => {
    const faits = await lireFaitsPr(
      { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
      l.depot,
      l.pr,
    );
    return { taskId: l.taskId, depot: l.depot, pr: l.pr, etat: etatLivraison(faits), faits };
  };

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/livraisons',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      if (!jetonGithub) return reply.code(503).send({ error: SANS_JETON_GITHUB });

      const rangees = store.listLivraisons(req.params.projectId);
      const livraisons = [];
      // SÉQUENTIEL, comme la livraison elle-même : une rafale de requêtes
      // déclencherait la limite SECONDAIRE de GitHub, qui est un bannissement
      // temporaire et non un simple 429.
      for (const l of rangees.slice(-MAX_LIVRAISONS_LUES)) {
        try {
          const vue = await etatDeLivraison(l);
          const tache = store.getTask(l.taskId);
          livraisons.push({
            ...vue,
            branche: l.branche,
            titre: tache?.title ?? '',
            dit: direEtat(vue.etat),
            reprenable: demandeDuTravail(vue.etat),
          });
        } catch (e) {
          // Une PR illisible (supprimée, dépôt transféré) ne doit pas rendre
          // toute la liste inutilisable : on dit ce qu'on n'a pas pu lire.
          const err = e as { message?: string };
          livraisons.push({
            taskId: l.taskId,
            depot: l.depot,
            pr: l.pr,
            branche: l.branche,
            illisible: err.message ?? 'échec GitHub',
          });
        }
      }
      return { livraisons };
    },
  );

  app.post<{ Params: { projectId: string; taskId: string } }>(
    '/api/projects/:projectId/livraisons/:taskId/reprendre',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'taskId'],
          properties: {
            projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
            taskId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
          },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      if (!jetonGithub) return reply.code(503).send({ error: SANS_JETON_GITHUB });

      const rangee = store.getLivraison(req.params.taskId);
      // Le refus prend la forme de l'inexistence : une livraison d'un AUTRE
      // projet ne doit pas se laisser deviner par un message différent.
      if (!rangee || rangee.projectId !== req.params.projectId) {
        return reply.code(404).send({ error: 'livraison inconnue' });
      }

      let vue;
      try {
        vue = await etatDeLivraison(rangee);
      } catch (e) {
        const err = e as { statut?: number; message?: string; conseil?: string };
        return reply
          .code(typeof err.statut === 'number' ? err.statut : 502)
          .send({ error: err.message ?? 'échec GitHub', conseil: err.conseil });
      }

      if (!demandeDuTravail(vue.etat)) {
        return reply
          .code(409)
          .send({ error: `Rien à reprendre. ${direEtat(vue.etat)}`, etat: vue.etat });
      }

      const tacheOrigine = store.getTask(rangee.taskId);
      const brief = briefDeRetour({
        faits: vue.faits,
        etat: vue.etat,
        tache: tacheOrigine?.title ?? rangee.taskId,
      });
      if (brief === '') {
        return reply
          .code(422)
          .send({ error: 'Les faits de cette pull request ne tiennent pas dans une consigne.' });
      }

      // UNE SEULE TÂCHE, pas un découpage. Une reprise est ciblée par nature :
      // la faire passer par la Queen Bee dépenserait un appel de modèle pour
      // redécouper ce que la CI a déjà nommé précisément.
      const tache = store.createTask({
        id: `r${vue.pr}-${Date.now().toString(36)}`,
        projectId: req.params.projectId,
        title: `Reprise PR #${vue.pr} — ${vue.etat}`,
        prompt: brief,
        dependsOn: [],
      });
      // LE LIEN VERS L'ISSUE SUIT LA REPRISE. Sans cela, la pull request de la
      // correction ne refermerait plus l'issue d'origine, et le demandeur
      // verrait sa demande rester ouverte alors qu'elle a été traitée.
      const issue = store.issueDeTache(rangee.taskId);
      if (issue) {
        store.lierTacheIssue({
          taskId: tache.id,
          projectId: req.params.projectId,
          depot: issue.depot,
          numero: issue.numero,
        });
      }
      emitEvent('livraison_reprise', {
        projectId: req.params.projectId,
        taskId: tache.id,
        origine: rangee.taskId,
        pr: vue.pr,
        etat: vue.etat,
      });
      scheduler.tick();
      stateDirty = true;
      return reply.code(201).send({ tache, etat: vue.etat, dit: direEtat(vue.etat) });
    },
  );

  // ─── Les issues comme source de travail ────────────────────────────────────
  //
  // La ruche savait importer un dépôt, découper un brief, travailler, et ouvrir
  // une pull request. Il manquait la PREMIÈRE marche : d'où vient le brief. Une
  // issue EST un brief — écrit par quelqu'un qui a pris le temps de décrire ce
  // qu'il veut, et qui attend une réponse.
  //
  // Les deux routes sont sous la garde d'ENGAGEMENT (ADR 0007) : lister les
  // issues d'un projet, c'est déjà consommer le quota GitHub de l'hôte ; en
  // prendre une, c'est faire travailler l'essaim.

  /** Un seul texte pour ce refus : deux formulations divergeraient un jour. */
  const SANS_JETON_GITHUB =
    'HIVE_GITHUB_TOKEN non configuré. Sans jeton, la ruche ne peut pas lire les issues du dépôt.';

  /** Le dépôt `owner/repo` d'un projet, ou `null` s'il n'en a pas. */
  const depotDeProjet = (repoUrl: string | null): string | null => depotDepuisUrl(repoUrl);

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/issues',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });

      const fullName = depotDeProjet(project.repoUrl);
      if (!fullName) {
        return reply.code(400).send({
          error: 'Ce projet n’est pas rattaché à un dépôt GitHub : il n’a pas d’issues à lire.',
        });
      }
      if (!jetonGithub) return reply.code(503).send({ error: SANS_JETON_GITHUB });

      try {
        const { listerIssues } = await import('./github.js');
        const { issues, tronque } = await listerIssues(
          { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
          fullName,
        );
        return { depot: fullName, issues, tronque };
      } catch (e) {
        const err = e as { statut?: number; message?: string; conseil?: string };
        return reply
          .code(typeof err.statut === 'number' ? err.statut : 502)
          .send({ error: err.message ?? 'échec GitHub', conseil: err.conseil });
      }
    },
  );

  app.post<{ Params: { projectId: string; numero: string } }>(
    '/api/projects/:projectId/issues/:numero',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'numero'],
          properties: {
            projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id },
            numero: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' },
          },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });

      const fullName = depotDeProjet(project.repoUrl);
      if (!fullName) {
        return reply.code(400).send({ error: 'Ce projet n’est pas rattaché à un dépôt GitHub.' });
      }
      if (!jetonGithub) return reply.code(503).send({ error: SANS_JETON_GITHUB });

      // ON RELIT L'ISSUE À LA SOURCE, jamais depuis ce que le client envoie.
      // Le client ne fournit qu'un NUMÉRO : le titre, le corps et l'état
      // viennent de GitHub à cet instant. Sinon n'importe quel appelant
      // fabriquerait le « contenu d'une issue » et la ruche le planifierait.
      const { lireUneIssue } = await import('./github.js');
      let issue;
      try {
        issue = await lireUneIssue(
          { jeton: jetonGithub, ...(apiGithub ? { api: apiGithub } : {}) },
          fullName,
          Number(req.params.numero),
        );
      } catch (e) {
        const err = e as { statut?: number; message?: string; conseil?: string };
        return reply
          .code(typeof err.statut === 'number' ? err.statut : 502)
          .send({ error: err.message ?? 'échec GitHub', conseil: err.conseil });
      }

      const verdict = recevable(issue);
      if (!verdict.ok) {
        return reply.code(409).send({ error: motifRefus(verdict.refus), refus: verdict.refus });
      }

      const brief = briefDeIssue(issue);
      if (brief === '') {
        return reply.code(422).send({
          error:
            'Cette issue ne tient pas dans un brief. Décrivez la demande en quelques lignes dans une tâche.',
        });
      }

      const { briefToDAG, loadQueenBeeConfig } = await import('./queen-bee.js');
      const beeConfig = loadQueenBeeConfig(process.env);
      if (!beeConfig.apiKey) {
        return reply.code(500).send({
          error: 'QUEEN_BEE_API_KEY non configurée. Définissez cette variable (clé OpenRouter).',
        });
      }

      try {
        const dag = await briefToDAG(brief, beeConfig);

        // ─── LES IDENTIFIANTS SONT RÉÉCRITS, ET C'EST NÉCESSAIRE ────────────
        //
        // La Queen Bee rend des identifiants de son cru — « A », « B », « T1 ».
        // Ils sont uniques DANS UN DÉCOUPAGE, pas dans un projet. Reprendre la
        // même issue une seconde fois (parce que le premier plan ne convenait
        // pas, geste parfaitement naturel) redemandait donc les mêmes clés
        // primaires, et la route rendait un 502 qui ne disait rien.
        //
        // On préfixe, et on REMAPPE `dependsOn` dans la foulée : renuméroter
        // les tâches sans renuméroter leurs dépendances casserait le DAG en
        // silence, ce qui est bien pire qu'une collision bruyante.
        const prefixe = `i${issue.numero}-${Date.now().toString(36)}`;
        const idNeuf = new Map<string, string>();
        dag.tasks.forEach((t, i) => idNeuf.set(t.id ?? `T${i + 1}`, `${prefixe}-${i + 1}`));
        const creees = dag.tasks.map((t, i) =>
          store.createTask({
            id: idNeuf.get(t.id ?? `T${i + 1}`)!,
            projectId: project.id,
            title: t.title,
            prompt: t.prompt,
            // Une dépendance vers une tâche hors de ce découpage est laissée
            // telle quelle : c'est au magasin de la refuser, pas à nous de
            // deviner à quoi elle voulait pointer.
            dependsOn: (t.dependsOn ?? []).map((d) => idNeuf.get(d) ?? d),
          }),
        );
        for (const t of creees) {
          // LE LIEN VERS L'ISSUE, posé ici et nulle part ailleurs : c'est le
          // seul endroit où l'on sait de quelle demande vient cette tâche.
          // Sans lui, la pull request répondrait à l'issue sans le dire, et
          // le demandeur devrait refermer à la main.
          store.lierTacheIssue({
            taskId: t.id,
            projectId: project.id,
            depot: fullName,
            numero: issue.numero,
          });
          emitEvent('task_created', { taskId: t.id, projectId: project.id, title: t.title });
        }
        emitEvent('issue_prise', {
          projectId: project.id,
          numero: issue.numero,
          titre: issue.titre,
          taches: creees.length,
        });
        scheduler.tick();
        stateDirty = true;
        return reply.code(201).send({ issue, taches: creees, devis: devisSansRisque(creees) });
      } catch (e) {
        return reply
          .code(502)
          .send({ error: e instanceof Error ? e.message : 'découpage impossible' });
      }
    },
  );

  // ─── Queen Bee : découpage IA d'un brief en tâches ──────────────────────────
  interface BriefBody {
    brief: string;
    language?: string;
  }

  app.post<{ Params: { projectId: string }; Body: BriefBody }>(
    '/api/projects/:projectId/brief',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
        body: {
          type: 'object',
          required: ['brief'],
          additionalProperties: false,
          properties: {
            brief: { type: 'string', minLength: 10, maxLength: 5000 },
            language: { type: 'string', maxLength: 30 },
          },
        },
      },
    },
    async (req, reply) => {
      const permis = engagementProjetPermis(req, req.params.projectId);
      if (permis !== 'permis') return refuserEngagement(reply, permis);
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });

      // Import dynamique : le module Queen Bee ne se charge que si on l'utilise.
      const { briefToDAG, loadQueenBeeConfig } = await import('./queen-bee.js');
      const beeConfig = loadQueenBeeConfig(process.env);
      if (!beeConfig.apiKey) {
        return reply.code(500).send({
          error: 'QUEEN_BEE_API_KEY non configurée. Définissez cette variable (clé OpenRouter).',
        });
      }
      if (req.body.language) beeConfig.language = req.body.language;

      try {
        const result = await briefToDAG(req.body.brief, beeConfig);

        // ─── MÊME RÈGLE QUE POUR LES ISSUES, ET POUR LA MÊME RAISON ─────────
        //
        // La Queen Bee rend des identifiants de son cru — « A », « T1 ». Ils
        // sont uniques DANS UN DÉCOUPAGE, pas dans un projet : découper deux
        // briefs sur le même projet redemandait les mêmes clés primaires, et
        // la route rendait un 422 qui ne disait rien de la cause.
        //
        // On préfixe, et on REMAPPE `dependsOn` : renuméroter les tâches sans
        // renuméroter leurs dépendances casserait le DAG en silence — la
        // seconde tâche partirait sans attendre la première.
        const prefixe = `b-${Date.now().toString(36)}`;
        const idNeuf = new Map<string, string>();
        result.tasks.forEach((t, i) => idNeuf.set(t.id ?? `T${i + 1}`, `${prefixe}-${i + 1}`));
        const created = result.tasks.map((t, i) =>
          store.createTask({
            id: idNeuf.get(t.id ?? `T${i + 1}`)!,
            projectId: project.id,
            title: t.title,
            prompt: t.prompt,
            dependsOn: (t.dependsOn ?? []).map((d) => idNeuf.get(d) ?? d),
          }),
        );
        for (const t of created) {
          emitEvent('task_created', { taskId: t.id, projectId: project.id, title: t.title });
        }
        scheduler.tick();
        return reply.code(201).send({
          tasks: created,
          rationale: result.rationale,
          model: result.model,
          // Balance (prévoir) : même devis indicatif que /api/plan.
          devis: devisSansRisque(created),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(422).send({ error: message });
      }
    },
  );

  // ─── Marketplace ───────────────────────────────────────────────────────────
  // Projets publics — accessible sans authentification.
  // La SEULE route de la ruche qui ne demande aucune authentification — c'est
  // voulu, c'est un catalogue. Elle renvoyait la ligne entière de la base :
  // `repoUrl` compris, alors qu'un dépôt privé se clone en écrivant ses
  // identifiants DANS l'URL (`https://user:ghp_…@github.com/…`), et `ownerId`
  // compris, qui désigne une cible nommée sans rien apprendre au visiteur.
  // La projection est explicite et testée : cf. src/shared/projet-public.ts.
  app.get('/api/projects/public', async (_req, reply) => {
    return reply.send(store.listPublicProjects().map(vuePublique));
  });

  // Créer un projet (via JWT utilisateur). Accepte visibility + ownerId.
  app.post<{
    Body: {
      name: string;
      repoUrl?: string;
      description?: string;
      visibility?: 'public' | 'private';
    };
  }>(
    '/api/projects/user',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: LIMITS.name },
            repoUrl: { type: 'string', maxLength: 500 },
            description: { type: 'string', maxLength: 2000 },
            visibility: { type: 'string', enum: ['public', 'private'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      if (req.body.repoUrl !== undefined && !isValidRepoUrl(req.body.repoUrl)) {
        return reply.code(400).send({
          error: 'repoUrl invalide',
        });
      }
      const userId = (req as AuthRequest).userId!;
      const project = store.createProject({
        ...req.body,
        ownerId: userId,
      });
      // Ajoute automatiquement le créateur comme membre
      store.addMember(project.id, userId, 'owner');
      emitEvent('project_created', { projectId: project.id, name: project.name, userId });
      return reply.code(201).send(project);
    },
  );

  // Rejoindre un projet
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/join',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      const userId = (req as AuthRequest).userId!;
      // N'IMPORTE QUEL COMPTE POUVAIT S'AJOUTER À N'IMPORTE QUEL PROJET, privé
      // compris : seule l'authentification était vérifiée. `visibility` et
      // `ownerId` existaient depuis le début et n'étaient consultés nulle part.
      //
      // Le refus prend la forme EXACTE de l'inexistence : un « 403 interdit »
      // confirmerait que le projet existe, et répété sur une liste
      // d'identifiants il dessinerait la carte des projets de la ruche. Même
      // raisonnement que pour les billets (ADR 0005).
      if (!peutRejoindre(project, lecteurDe(req), store.estMembre(project.id, userId))) {
        emitEvent('project_join_refused', { projectId: project.id, userId });
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      store.addMember(project.id, userId);
      emitEvent('project_member_joined', { projectId: project.id, userId });
      return reply.send({ joined: true, projectId: project.id });
    },
  );

  // ─── Le Rayon : lire le code du projet ─────────────────────────────────────
  //
  // Ce que les abeilles voyaient jusqu'ici, c'étaient des TÂCHES : des titres,
  // des états, des diffs. Jamais le code lui-même. On travaillait sur un projet
  // sans pouvoir l'ouvrir — comme aider à réparer un moteur sans avoir le droit
  // de soulever le capot.
  //
  // DEUX GARDES, ET LES DEUX DOIVENT PASSER :
  //   1. `peutLireCode` — cette personne a-t-elle affaire à ce dépôt ?
  //   2. `shared/rayon.ts` — ce chemin-là se sert-il, quel que soit le lecteur ?
  //      (`.git` porte l'URL distante avec ses identifiants ; les `.env` et les
  //      clés privées ne sortent pas d'un partage en lecture.)
  //
  // Le refus de la première prend la forme de l'inexistence, comme partout
  // ailleurs : un 403 sur un projet privé confirmerait qu'il existe.

  /**
   * Le lecteur, avec son rôle.
   *
   * Le rôle est LU ICI et pas déduit ailleurs : c'est `voir_tous_les_projets`
   * de la matrice qui décide, et la matrice est la seule source. Un projet
   * importé depuis GitHub n'a pas de propriétaire — la route d'import
   * s'authentifie par le jeton de ruche, pas par un compte — et sans cette
   * lecture du rôle, il n'était lisible par PERSONNE.
   */
  const lecteurDe = (req: FastifyRequest): { userId: string; voitTout: boolean } => {
    const userId = (req as AuthRequest).userId ?? '';
    const moi = roleDe(req);
    return { userId, voitTout: moi !== null && peut(moi.role, 'voir_tous_les_projets') };
  };

  /**
   * Le porteur d'un lien de partage a-t-il le droit de faire CET acte sur CE
   * projet ?
   *
   * ─── CE QUI REND CE JETON DIFFÉRENT DES DEUX AUTRES ───────────────────────
   *
   * Un lien de partage se colle dans un fil de discussion. Il survit dans
   * l'historique du navigateur, le presse-papiers, la capture d'écran. Il ne
   * peut donc jamais être ni le JWT (celui qui le reçoit SERAIT vous), ni le
   * jeton de ruche (il vaut participation à l'essaim). C'est un troisième
   * jeton, et il n'ouvre que deux actes de LECTURE, sur UN projet.
   *
   * Le secret est vérifié au MÊME COÛT quel que soit le résultat — contre
   * `empreinteLeurre()` quand le lien n'existe pas. C'est la leçon de l'ADR
   * 0005, où un identifiant inconnu répondait 9,8 fois plus vite qu'un secret
   * erroné, et annonçait donc par l'horloge ce que le message taisait.
   */
  const partagePermet = (
    req: FastifyRequest,
    projectId: string,
    acte: string,
  ): { ok: true; partageId: string } | { ok: false } => {
    if (!actePartage(acte)) return { ok: false };
    const brut =
      (req.headers['x-hive-partage'] as string | undefined) ??
      (req.query as { partage?: string } | undefined)?.partage ??
      '';
    if (brut === '') return { ok: false };
    const decode = decoderPartage(brut);
    if (!decode) return { ok: false };
    const range = store.getPartage(decode.id);
    // Le secret D'ABORD et TOUJOURS, au même coût : sans le leurre, un
    // identifiant inconnu sortirait sans payer PBKDF2 et l'écart de temps
    // dirait lesquels existent.
    const secretOk = empreinteValide(decode.secret, range?.secretHash ?? empreinteLeurre());
    const verdict = jugerPartage(range, projectId, Date.now());
    if (!secretOk || !verdict.ok || !range) return { ok: false };
    return { ok: true, partageId: range.id };
  };

  /**
   * Le projet, si l'appelant a le droit d'en lire le code. Répond et rend
   * `null` sinon.
   *
   * DEUX PORTES, jamais confondues : un compte authentifié qui a affaire au
   * projet, OU un lien de partage valide pour CE projet précisément. Le lien
   * n'accorde rien de plus que ce que la liste blanche d'actes déclare.
   */
  const projetLisible = (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    reply: FastifyReply,
    acte: 'lire_code' | 'voir_avancement' = 'lire_code',
  ): Project | null => {
    const projectId = req.params.projectId;
    const parPartage = partagePermet(req, projectId, acte);
    if (parPartage.ok) {
      const project = store.getProject(projectId);
      if (!project) {
        reply.code(404).send({ error: 'projet inconnu' });
        return null;
      }
      store.toucherPartage(parPartage.partageId);
      return project;
    }
    if (!authorizedUser(req)) {
      reply.status(401).send({ error: 'Non authentifié' });
      return null;
    }
    const project = store.getProject(projectId);
    const userId = (req as AuthRequest).userId!;
    if (!project || !peutLireCode(project, lecteurDe(req), store.estMembre(projectId, userId))) {
      reply.code(404).send({ error: 'projet inconnu' });
      return null;
    }
    return project;
  };

  /**
   * S'assure que le miroir du projet existe et est à jour. Rend `false` après
   * avoir répondu si le code n'est pas consultable.
   *
   * Rafraîchi au plus une fois par fenêtre : sans cela, chaque affichage
   * lancerait un `git fetch`, et deux visiteurs simultanés donneraient deux
   * `git` concurrents dans le même répertoire.
   */
  const assurerMiroir = async (project: Project, reply: FastifyReply): Promise<boolean> => {
    if (!project.repoUrl) {
      reply.code(409).send({ error: 'ce projet n’a pas de dépôt (repoUrl)' });
      return false;
    }
    try {
      await rayons.rafraichir(project.id, project.repoUrl);
    } catch {
      // Un amont injoignable n'efface pas ce qu'on a déjà : mieux vaut un code
      // d'hier que pas de code du tout.
      if (!rayons.existe(project.id)) {
        reply.code(409).send({
          error: 'le dépôt n’a pas pu être copié — vérifiez son URL et son accessibilité',
        });
        return false;
      }
    }
    return true;
  };

  /** Traduit un refus du rayon en réponse HTTP, sans inventer de détail. */
  const repondreRayon = (reply: FastifyReply, e: unknown): FastifyReply => {
    if (!(e instanceof RayonIndisponible)) throw e;
    const codes: Record<string, number> = {
      refuse: 403,
      introuvable: 404,
      miroir_absent: 409,
      pas_de_depot: 409,
      binaire: 415,
      trop_gros: 413,
    };
    const messages: Record<string, string> = {
      refuse: 'ce chemin ne se sert pas',
      introuvable: 'fichier introuvable',
      miroir_absent: 'le code n’a pas encore été copié — réessayez dans un instant',
      pas_de_depot: 'ce projet n’a pas de dépôt (repoUrl)',
      binaire: 'fichier binaire — rien à afficher dans un éditeur',
      trop_gros: 'fichier trop volumineux pour être affiché',
    };
    return reply
      .code(codes[e.motif] ?? 400)
      .send({ error: messages[e.motif] ?? 'lecture impossible', motif: e.motif });
  };

  app.get<{ Params: { projectId: string }; Querystring: { chemin?: string } }>(
    '/api/projects/:projectId/rayon',
    async (req, reply) => {
      const project = projetLisible(req, reply);
      if (!project) return reply;
      if (!(await assurerMiroir(project, reply))) return reply;
      try {
        return reply.send({
          chemin: req.query.chemin ?? '',
          entrees: await rayons.lister(project.id, req.query.chemin ?? ''),
        });
      } catch (e) {
        return repondreRayon(reply, e);
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { chemin?: string } }>(
    '/api/projects/:projectId/rayon/fichier',
    async (req, reply) => {
      const project = projetLisible(req, reply);
      if (!project) return reply;
      const chemin = req.query.chemin ?? '';
      if (chemin === '') return reply.code(400).send({ error: 'chemin manquant' });
      // LE MIROIR EST ASSURÉ ICI AUSSI. Il ne l'était pas, et seul l'affichage
      // de l'arbre le créait : un lien direct vers un fichier — celui qu'on
      // colle dans une conversation, celui d'un partage en lecture — échouait
      // en 409 tant que personne n'avait ouvert l'arbre d'abord. Un test l'a
      // trouvé en lisant un fichier sans passer par la racine.
      if (!(await assurerMiroir(project, reply))) return reply;
      try {
        return reply.send(await rayons.lire(project.id, chemin));
      } catch (e) {
        return repondreRayon(reply, e);
      }
    },
  );

  /**
   * L'Aperçu — le site du projet, replié en un document auto-suffisant.
   *
   * ─── CE QUE CETTE ROUTE NE FAIT PAS, ET C'EST L'ESSENTIEL ─────────────────
   *
   * Elle ne SERT PAS une page. Elle rend du JSON contenant un document, que le
   * tableau de bord injectera dans une `<iframe sandbox>` SANS
   * `allow-same-origin`.
   *
   * La distinction est tout le sujet. Servir directement ce HTML sur une route
   * de la ruche lui donnerait l'origine de la ruche : trois lignes de
   * JavaScript dans le site prévisualisé, et le `localStorage` du tableau de
   * bord — donc le jeton de session — part ailleurs. Le contenu vient d'un
   * modèle qui a lu le dépôt, et le dépôt peut être public.
   *
   * En passant par `srcdoc` dans un cadre sans `allow-same-origin`, le document
   * obtient une origine unique et inaccessible. Il ne peut rien lire de la
   * ruche, et ne fait aucune requête vers elle.
   */
  app.get<{ Params: { projectId: string }; Querystring: { entree?: string } }>(
    '/api/projects/:projectId/apercu',
    async (req, reply) => {
      const project = projetLisible(req, reply);
      if (!project) return reply;
      if (!(await assurerMiroir(project, reply))) return reply;

      // On ne ramasse QUE ce qu'un aperçu peut utiliser, et pas tout le dépôt :
      // un `node_modules` replié en mémoire ferait tomber le hub.
      const fichiers = new Map<string, string>();
      let octets = 0;
      const ramasser = async (dossier: string, profondeur: number): Promise<void> => {
        if (profondeur > 4 || octets > MAX_APERCU) return;
        let entrees;
        try {
          entrees = await rayons.lister(project.id, dossier);
        } catch {
          return;
        }
        for (const e of entrees) {
          if (octets > MAX_APERCU) return;
          if (e.type === 'dossier') {
            await ramasser(e.chemin, profondeur + 1);
            continue;
          }
          if (!/\.(html?|css|m?js)$/i.test(e.nom)) continue;
          try {
            const f = await rayons.lire(project.id, e.chemin);
            fichiers.set(e.chemin, f.contenu);
            octets += f.contenu.length;
          } catch {
            // Un fichier illisible (binaire, trop gros, refusé) n'empêche pas
            // l'aperçu : la balise restera, et la politique la bloquera.
          }
        }
      };
      await ramasser('', 0);

      const r = assemblerApercu(fichiers, req.query.entree);
      if (!r.ok) return reply.code(404).send({ error: r.motif, refus: r.refus });
      return reply.send({
        html: r.html,
        entree: r.entree,
        inlines: r.inlines,
        // Le tableau de bord DOIT poser exactement ce sandbox. Le renvoyer
        // depuis le serveur évite qu'une valeur divergente s'installe côté
        // client sans que personne ne s'en aperçoive.
        sandbox: SANDBOX_APERCU,
      });
    },
  );

  /**
   * La Reine retouche un fichier — et sa retouche devient une TÂCHE.
   *
   * ─── POURQUOI PAS UNE ÉCRITURE DIRECTE ────────────────────────────────────
   *
   * Le Rayon est un MIROIR : un clone superficiel, jetable, reconstruit d'un
   * `git clone`. Y écrire serait le pire mensonge d'interface possible — on
   * croit avoir corrigé, le texte reste à l'écran, et le prochain
   * rafraîchissement l'efface sans rien dire.
   *
   * La retouche emprunte donc EXACTEMENT le circuit du reste du travail : une
   * ouvrière l'applique chez elle, la teste, rend un diff, et ce diff passe par
   * la revue, les Gardiennes, La Balance et un merge humain. Une seconde voie
   * d'écriture, plus courte, serait une seconde voie à sécuriser — et celle
   * qu'on oublierait de sécuriser.
   *
   * Le prompt fabriqué contient du CODE VENU DU DÉPÔT : il est emballé en
   * données non fiables (`shared/retouche.ts`), comme celui de la Couveuse.
   */
  app.post<{
    Params: { projectId: string };
    Body: { chemin: string; avant: string; apres: string; note?: string };
  }>(
    '/api/projects/:projectId/rayon/retouche',
    {
      schema: {
        body: {
          type: 'object',
          required: ['chemin', 'avant', 'apres'],
          additionalProperties: false,
          properties: {
            chemin: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_CHEMIN },
            avant: { type: 'string', maxLength: TAILLE_MAX_FICHIER },
            apres: { type: 'string', maxLength: TAILLE_MAX_FICHIER },
            note: { type: 'string', maxLength: 1_000 },
          },
        },
      },
    },
    async (req, reply) => {
      // RETOUCHER N'EST PAS LIRE. Un porteur de lien de partage lit ; il ne
      // fabrique pas de travail pour l'essaim. On exige donc un COMPTE, et
      // `projetLisible` n'est pas la bonne garde ici.
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const userId = (req as AuthRequest).userId!;
      const project = store.getProject(req.params.projectId);
      if (
        !project ||
        !peutLireCode(project, lecteurDe(req), store.estMembre(req.params.projectId, userId))
      ) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }

      const r = construireRetouche({
        chemin: req.body.chemin,
        avant: req.body.avant,
        apres: req.body.apres,
        ...(req.body.note ? { note: req.body.note } : {}),
      });
      if (!r.ok) return reply.code(400).send({ error: r.motif, refus: r.refus });

      const tache = store.createTask({ projectId: project.id, title: r.titre, prompt: r.prompt });
      emitEvent('retouche_proposee', {
        projectId: project.id,
        taskId: tache.id,
        chemin: req.body.chemin,
        parUserId: userId,
      });
      return reply.code(201).send({ task: tache });
    },
  );

  // ─── Créer, lister et révoquer un lien de partage ──────────────────────────
  //
  // Ces trois routes-là, elles, sont réservées à un COMPTE : un porteur de lien
  // ne fabrique pas d'autres liens. Sans cette asymétrie, le premier partage
  // deviendrait un droit de partage illimité, et révoquer ne servirait à rien
  // puisque le destinataire s'en serait refait un.

  app.post<{ Params: { projectId: string }; Body: { label?: string; ttlMs?: number } }>(
    '/api/projects/:projectId/partages',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', maxLength: LIMITS.name },
            ttlMs: { type: 'integer', minimum: 1, maximum: TTL_PARTAGE_MAX_MS },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const userId = (req as AuthRequest).userId!;
      const project = store.getProject(req.params.projectId);
      // Partager, c'est décider qui voit : seuls le propriétaire et les membres
      // le peuvent, et le refus prend la forme de l'inexistence comme ailleurs.
      if (!project || !peutLireCode(project, lecteurDe(req), store.estMembre(project.id, userId))) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const id = `par-${randomUUID()}`.slice(0, LIMITS.id);
      const secret = tirerSecret();
      const expireA = Date.now() + bornerTtlPartage(req.body.ttlMs);
      store.creerPartage({
        id,
        projectId: project.id,
        // JAMAIS LE SECRET, seulement son empreinte : une base volée ne rend
        // aucun lien utilisable.
        secretHash: empreinte(secret),
        label: req.body.label ?? '',
        creePar: userId,
        expireA,
      });
      emitEvent('partage_cree', { partageId: id, projectId: project.id, expireA });
      const jeton = encoderPartage({ id, secret });
      // Le secret n'est rendu QU'ICI, une seule fois. La liste ne le montrera
      // jamais — c'est ce qui fait qu'un lien perdu se remplace au lieu de se
      // retrouver.
      return reply.send({
        id,
        jeton,
        expireA,
        lien: `${config.publicUrl?.replace(/^ws/, 'http').replace(/\/ws$/, '') ?? ''}/#/rayon/${project.id}?partage=${encodeURIComponent(jeton)}`,
      });
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/partages',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const userId = (req as AuthRequest).userId!;
      const project = store.getProject(req.params.projectId);
      if (!project || !peutLireCode(project, lecteurDe(req), store.estMembre(project.id, userId))) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const now = Date.now();
      // `secretHash` NE SORT PAS. C'est une empreinte, pas un secret, mais la
      // publier donnerait à qui la lit de quoi tenter un cassage hors ligne à
      // son rythme — et rien, dans cette liste, n'en a le moindre besoin.
      return reply.send(
        store.listPartages(project.id).map((p) => ({
          id: p.id,
          label: p.label,
          creeA: p.creeA,
          expireA: p.expireA,
          revoqueA: p.revoqueA,
          vuA: p.vuA,
          vivant: partageVivant(p, now),
        })),
      );
    },
  );

  app.delete<{ Params: { projectId: string; partageId: string } }>(
    '/api/projects/:projectId/partages/:partageId',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const userId = (req as AuthRequest).userId!;
      const project = store.getProject(req.params.projectId);
      if (!project || !peutLireCode(project, lecteurDe(req), store.estMembre(project.id, userId))) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const p = store.getPartage(req.params.partageId);
      // Un lien d'un AUTRE projet ne se révoque pas depuis ici : sans cette
      // vérification, l'identifiant de route deviendrait une clé universelle.
      if (!p || p.projectId !== project.id) {
        return reply.code(404).send({ error: 'lien inconnu' });
      }
      const change = store.revoquerPartage(p.id);
      if (change) emitEvent('partage_revoque', { partageId: p.id, projectId: project.id });
      // Re-révoquer n'est pas une erreur : un double-clic ne doit pas alarmer.
      return reply.send({ id: p.id, revoque: true, change });
    },
  );

  // Lister les membres d'un projet
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/members',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const project = store.getProject(req.params.projectId);
      if (!project) return reply.code(404).send({ error: 'projet inconnu' });
      const userId = (req as AuthRequest).userId!;
      // La liste NOMME des gens. Sur un projet privé, elle était lisible par
      // tout titulaire d'un compte : créer un compte suffisait à énumérer qui
      // travaille sur quoi. Même refus indistinguable qu'au-dessus.
      if (!peutVoirMembres(project, lecteurDe(req), store.estMembre(project.id, userId))) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      return reply.send(store.listMembers(project.id));
    },
  );

  // ─── Adopter un projet orphelin, et y admettre des ouvrières ───────────────
  //
  // LE CUL-DE-SAC QUE CES DEUX ROUTES OUVRENT. Un projet privé n'avait aucun
  // moyen de gagner un membre : `/join` n'admet que le propriétaire, l'admin et
  // ceux qui sont déjà membres — correct (on ne s'invite pas chez les autres)
  // et incomplet, puisque personne ne pouvait inviter non plus. Un dépôt importé
  // de GitHub est privé ET sans propriétaire : il restait à jamais illisible par
  // toute la ruche sauf l'administrateur. C'est l'exact contraire de ce pour quoi
  // Le Rayon a été construit.

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/adopter',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const userId = (req as AuthRequest).userId!;
      const project = store.getProject(req.params.projectId);
      // Refus indistinguable de l'inexistence, comme partout ailleurs : sinon
      // cette route devient un oracle qui dit quels projets sont orphelins.
      if (!project || !peutAdopter(project, lecteurDe(req))) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      // La condition `ownerId IS NULL` vit DANS l'écriture : deux adoptions
      // simultanées ne peuvent pas réussir toutes les deux.
      if (!store.adopterProjet(project.id, userId)) {
        return reply
          .code(409)
          .send({ error: 'ce projet vient d’être adopté par quelqu’un d’autre' });
      }
      store.addMember(project.id, userId, 'owner');
      emitEvent('projet_adopte', { projectId: project.id, userId });
      return reply.send({ adopted: true, projectId: project.id });
    },
  );

  app.post<{ Params: { projectId: string }; Body: { userId: string } }>(
    '/api/projects/:projectId/membres',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId'],
          additionalProperties: false,
          properties: { userId: { type: 'string', minLength: 1, maxLength: LIMITS.id } },
        },
      },
    },
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const project = store.getProject(req.params.projectId);
      // Le droit d'admettre est celui du PROPRIÉTAIRE, jamais d'un membre :
      // sinon le premier invité inviterait à son tour, et « privé » ne voudrait
      // plus rien dire au bout de trois personnes.
      if (!project || !peutAdmettre(project, lecteurDe(req))) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      // Le compte doit exister. Admettre un identifiant inventé rangerait une
      // adhésion fantôme que `listMembers` ne montrerait même pas (sa jointure
      // sur `users` la ferait disparaître) : une ligne invisible et éternelle.
      if (!store.getUserById(req.body.userId)) {
        return reply.code(404).send({ error: 'compte inconnu' });
      }
      store.addMember(project.id, req.body.userId);
      emitEvent('project_member_admitted', {
        projectId: project.id,
        userId: req.body.userId,
        parUserId: (req as AuthRequest).userId!,
      });
      return reply.code(201).send({ admitted: true, userId: req.body.userId });
    },
  );

  app.delete<{ Params: { projectId: string; userId: string } }>(
    '/api/projects/:projectId/membres/:userId',
    async (req, reply) => {
      if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
      const project = store.getProject(req.params.projectId);
      if (!project || !peutAdmettre(project, lecteurDe(req))) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      // ON NE RETIRE PAS LE PROPRIÉTAIRE. Le sortir de la liste ne le
      // déposséderait pas — `ownerId` resterait le sien — ça rendrait seulement
      // l'état incohérent, et un administrateur distrait pourrait vider un
      // projet de la personne qui le tient.
      if (project.ownerId !== null && project.ownerId === req.params.userId) {
        return reply.code(409).send({ error: 'le propriétaire ne se retire pas de son projet' });
      }
      const retire = store.removeMember(project.id, req.params.userId);
      if (!retire) return reply.code(404).send({ error: 'ce compte n’est pas membre' });
      emitEvent('project_member_removed', {
        projectId: project.id,
        userId: req.params.userId,
        parUserId: (req as AuthRequest).userId!,
      });
      return reply.send({ removed: true, userId: req.params.userId });
    },
  );

  /**
   * Le tableau de bord de la personne connectée.
   *
   * UN SEUL appel plutôt qu'un par projet et par nature de donnée : l'écran
   * doit pouvoir dire « voici ce qui va vous coûter quelque chose si vous ne
   * faites rien aujourd'hui » d'un bloc. Enchaîner N requêtes ferait apparaître
   * les alertes les unes après les autres, dans un ordre dicté par la latence
   * plutôt que par l'urgence — exactement l'inverse de ce qu'on cherche.
   *
   * PORTÉE : les projets DONT LA PERSONNE EST MEMBRE, rien d'autre. Le rôle
   * d'administrateur de la ruche n'élargit pas cette vue — l'administration a
   * ses propres routes, et mélanger les deux ferait qu'un admin ne verrait
   * plus jamais ce que voient ses utilisateurs.
   */
  app.get('/api/moi/tableau', async (req, reply) => {
    if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
    const userId = (req as AuthRequest).userId!;
    const now = Date.now();
    const balance = scheduler.balance;

    const projets: ProjetVu[] = [];
    for (const m of store.listUserProjects(userId)) {
      const projet = store.getProject(m.projectId);
      if (!projet) continue; // Projet effacé, adhésion encore là : on saute.

      const a = lireAbonnement(projet.id);
      const d = droits(a, now);
      const budget = store.getBudget(projet.id);
      const solde = balance.soldes.find((s) => s.projectId === projet.id);

      projets.push({
        projectId: projet.id,
        nom: projet.name,
        role: m.role,
        plan: a.plan,
        etatAbonnement: a.etat,
        finPeriode: a.finPeriode,
        actif: d.actif,
        motifDroits: d.motif,
        heures: d.heures,
        // Le plafond POSÉ fait foi ; celui du plan n'est qu'une intention tant
        // qu'un webhook ne l'a pas inscrit. Afficher le second ferait croire
        // à un quota qui ne borne rien.
        plafondMs: budget?.plafondMs ?? null,
        depenseMs: solde?.depenseMs ?? 0,
        serveurs: serveursDe()
          .filter((s) => s.projectId === projet.id)
          .map((s) => ({
            id: s.id,
            etat: s.etat,
            joursAvantSuppression: joursAvantSuppression(s, now),
          })),
        autonomie: store.getEssaim(projet.id)?.niveau ?? 'off',
      });
    }

    return {
      ...composerTableau(projets, now),
      // `aJour: false` ⇒ le grand livre n'a pas fini son rattrapage et les
      // dépenses affichées sont encore incomplètes. C'est à montrer, pas à
      // masquer : une jauge qui sous-estime rassure à tort.
      balanceAJour: balance.aJour,
      balanceMode: balance.mode,
    };
  });

  // Projets de l'utilisateur connecté
  app.get('/api/user/projects', async (req, reply) => {
    if (!authorizedUser(req)) return reply.status(401).send({ error: 'Non authentifié' });
    const userId = (req as AuthRequest).userId!;
    return reply.send(store.listUserProjects(userId));
  });

  // ─── OpenAlex : moteur de recherche scientifique ────────────────────────────
  // Proxy vers l'API OpenAlex (gratuite, pas de clé). Accessible sans auth.
  // Docs : https://docs.openalex.org/api-reference
  app.get<{ Querystring: { q?: string; page?: string; filter?: string; sort?: string } }>(
    '/api/openalex/search',
    async (req, reply) => {
      const { q, page, filter, sort } = req.query;
      if (!q || q.length < 2)
        return reply.status(400).send({ error: 'Requête trop courte (min 2 caractères)' });

      const params = new URLSearchParams();
      params.set('search', q);
      if (page) params.set('page', page);
      if (filter) params.set('filter', filter);
      if (sort) params.set('sort', sort);
      else params.set('sort', 'cited_by_count:desc');
      params.set('per_page', '20');

      // Adresse « polite » d'OpenAlex : elle élargit les limites de débit.
      //
      // ELLE N'A PAS DE VALEUR PAR DÉFAUT, et c'est la même raison que pour le
      // secret de session : ce dépôt est public, donc un défaut n'est pas un
      // défaut — c'est une valeur imposée à toutes les installations du monde.
      // Ici, une boîte personnelle écrite en dur se serait retrouvée à porter
      // l'attribution du trafic de parfaits inconnus, et aurait été publiée
      // sans que sa propriétaire l'ait demandé.
      //
      // Sans adresse, OpenAlex répond très bien depuis le pool commun. On
      // n'envoie donc rien plutôt que d'envoyer le contact de quelqu'un
      // d'autre.
      const email = (process.env.OPENALEX_EMAIL ?? '').trim();
      const agentUtilisateur = email === '' ? 'Hive/0.1' : `Hive/0.1 (mailto:${email})`;

      try {
        const res = await fetch(`https://api.openalex.org/works?${params}`, {
          headers: { 'User-Agent': agentUtilisateur },
        });
        if (!res.ok) {
          return reply.status(res.status).send({
            error: `OpenAlex a répondu ${res.status}`,
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json()) as any;
        // Formater pour le dashboard : ne garder que les champs utiles
        const results = (data.results ?? []).map((w: Record<string, unknown>) => ({
          id: w.id,
          title: w.title,
          doi: w.doi,
          year: w.publication_year,
          citedBy: w.cited_by_count,
          authors: ((w.authorships as Array<Record<string, unknown>>) ?? [])
            .slice(0, 5)
            .map((a) => a.author && (a.author as Record<string, string>).display_name)
            .filter(Boolean),
          abstract: ((w.abstract_inverted_index as Record<string, number[]>) != null
            ? reconstructAbstract(w.abstract_inverted_index as Record<string, number[]>)
            : null
          )?.slice(0, 500),
          type: w.type,
          openAccess: (w.open_access as Record<string, unknown>)?.is_oa ?? false,
          url: (w.open_access as Record<string, unknown>)?.oa_url ?? w.doi,
        }));
        return reply.send({
          total: data.meta?.count ?? 0,
          page: data.meta?.page ?? 1,
          perPage: data.meta?.per_page ?? 20,
          results,
        });
      } catch (err) {
        return reply
          .status(502)
          .send({ error: `Erreur OpenAlex : ${err instanceof Error ? err.message : err}` });
      }
    },
  );

  await app.listen({ port: config.port, host: config.host });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : config.port;

  // ─── WebSocket temps réel ──────────────────────────────────────────────────
  /**
   * Vérifie la clé propre d'un nœud.
   *
   *   • `cle`     — clé valide, ce nœud est admis sous sa propre identité.
   *   • `revoque` — clé connue mais RÉVOQUÉE : refus définitif, et surtout on
   *                 ne consulte PAS le token maître ensuite. Sans cette
   *                 distinction, un membre exclu qui aurait retenu le token de
   *                 ruche rentrerait par la porte de service, et la révocation
   *                 ne serait qu'un affichage.
   *   • `refuse`  — aucune clé pour ce nœud, ou clé fausse : l'appelant peut
   *                 encore tenter le token maître (compatibilité).
   *
   * Le PBKDF2 n'est payé QUE si une ligne existe pour ce `nodeId`. Un inconnu
   * qui bombarde des identifiants au hasard ne déclenche donc aucun calcul —
   * il ne coûte qu'une lecture par clé primaire.
   */
  function verifierAccesNoeud(
    nodeId: string | undefined,
    presente: string,
  ): 'cle' | 'revoque' | 'refuse' {
    // Sans identifiant annoncé, il ne peut exister aucune clé : le nœud n'a
    // jamais échangé de billet. On ne cherche même pas — et l'appelant se
    // rabattra sur le token maître, ce qui est exactement le chemin d'un nœud
    // d'avant les billets.
    if (!nodeId) return 'refuse';
    const rangee = store.getCleNoeud(nodeId);
    if (!rangee) return 'refuse';
    if (rangee.revokedAt !== null) return 'revoque';
    return empreinteValide(presente, rangee.keyHash) ? 'cle' : 'refuse';
  }

  const wss = new WebSocketServer({
    server: app.server,
    path: '/ws',
    maxPayload: LIMITS.message,
  });

  wss.on('connection', (ws, req) => {
    // Connexions navigateur : l'origine doit être autorisée (dashboard servi
    // par l'orchestrateur lui-même, ou origine listée dans HIVE_CORS_ORIGIN).
    const origin = req.headers.origin;
    if (origin) {
      const sameHost = origin === `http://${req.headers.host}`;
      if (!sameHost && !config.corsOrigins.includes(origin)) {
        ws.close(4403, 'origine non autorisée');
        return;
      }
    }

    let role: 'unknown' | 'node' | 'dashboard' = 'unknown';
    let nodeId: string | null = null;

    // Limitation de débit par socket (anti-DoS/amplification) : un nœud
    // authentifié ne peut pas noyer le hub et tous les dashboards de messages.
    // Token bucket rechargé chaque seconde.
    let budget = WS_MSG_PER_SEC;
    const budgetTimer = setInterval(() => {
      budget = WS_MSG_PER_SEC;
    }, 1_000);
    budgetTimer.unref?.();

    // Sans authentification dans les 5 s, la connexion est fermée.
    const authTimer = setTimeout(() => {
      if (role === 'unknown') ws.close(4401, 'authentification requise');
    }, 5_000);
    authTimer.unref?.();

    ws.on('message', (data, isBinary) => {
      // Toute exception (ex. écriture SQLite qui échoue) est confinée à ce
      // message : elle ferme la connexion fautive sans abattre l'orchestrateur.
      try {
        if (isBinary) {
          ws.close(4400, 'binaire refusé');
          return;
        }
        if (--budget < 0) {
          ws.close(4429, 'débit de messages excessif');
          return;
        }
        // TANT QU'ON NE SAIT PAS À QUI ON PARLE, ON N'ANALYSE PAS 2 Mo.
        //
        // `maxPayload` vaut 2 Mo parce qu'un nœud AUTHENTIFIÉ remonte des
        // diffs. Appliquer la même largeur à un inconnu offrait une
        // amplification gratuite : `toString()` puis `JSON.parse` sur 2 Mo,
        // sans aucun identifiant, 100 fois par seconde pendant les 5 s de la
        // fenêtre d'authentification — et rien ne borne le nombre de sockets.
        // Un message d'authentification tient dans quelques centaines d'octets.
        //
        // Le code 4413 fait écho au 413 HTTP, et il est DISTINCT du 4400
        // « message invalide » : sans cette distinction, ni un test ni un
        // opérateur qui débogue ne peuvent dire si le hub a refusé la forme du
        // message ou sa taille.
        if (role === 'unknown' && octetsDe(data) > LIMITS.messageAvantAuth) {
          ws.close(4413, 'message trop volumineux avant authentification');
          return;
        }
        const msg = parseClientMessage(data.toString());
        if (!msg) {
          ws.close(4400, 'message invalide');
          return;
        }

        // Premier message : authentification (register = nœud, subscribe = dashboard).
        if (role === 'unknown') {
          if (msg.type === 'register') {
            // Deux clés ouvrent le trou de vol, et l'ordre compte.
            //
            // 1. La CLÉ DU NŒUD — le cas normal depuis les billets. Elle est
            //    propre à ce nœud, donc révocable individuellement : c'est ce
            //    qui permet enfin d'exclure UNE personne sans éjecter l'essaim.
            // 2. Le TOKEN DE RUCHE — la clé maîtresse historique. Toujours
            //    acceptée : la couper aurait déconnecté toutes les ruches
            //    existantes au premier `git pull`, et une mise à jour de
            //    sécurité qui casse la production ne se déploie jamais.
            //
            // La clé de nœud est essayée D'ABORD : un nœud révoqué qui
            // connaîtrait aussi le token maître ne doit pas se faufiler par la
            // seconde porte. `cleNoeudValide` rend `false` sur une clé révoquée,
            // et on refuse alors sans consulter le token maître.
            const verdict = verifierAccesNoeud(msg.nodeId, msg.token);
            if (verdict === 'revoque') {
              ws.close(4403, 'accès révoqué');
              return;
            }
            if (verdict === 'refuse' && !tokenMatches(msg.token, config.token)) {
              ws.close(4401, 'token invalide');
              return;
            }
            // ─── LA SECONDE PORTE NE SUFFISAIT PAS À FERMER UNE EXCLUSION ────
            //
            // Le refus ci-dessus est attaché au `nodeId` ANNONCÉ. Mesuré sur un
            // serveur réel : `node-exclu` fermé en 4403, `node-exclu-bis` ADMIS
            // — le même exclu, six caractères plus loin. La promesse tenue par
            // le commentaire, par la documentation publique et par l'en-tête du
            // banc était donc fausse, et fausse contre le SEUL adversaire que
            // l'exclusion vise : l'ancien membre, qui a eu le token de ruche.
            //
            // La règle est PURE et vit dans `acces.ts` : elle s'éprouve sans
            // base ni socket, et le câblage se juge ici (registre 2 : une règle
            // qu'on n'éprouve qu'à travers sa copie n'est pas éprouvée).
            if (
              verdict === 'refuse' &&
              !tokenMaitrePeutEnregistrer({
                nodeIdConnu: msg.nodeId
                  ? store.getNode(msg.nodeId) !== undefined ||
                    store.getCleNoeud(msg.nodeId) !== null
                  : false,
                rucheAExclu: store.rucheAExclu(),
              })
            ) {
              emitEvent('invite_rejected', {
                nodeId: msg.nodeId ?? null,
                refus: 'token_maitre_apres_exclusion',
              });
              ws.close(4403, REFUS_TOKEN_MAITRE);
              return;
            }
            if (verdict === 'cle' && msg.nodeId) store.toucherCleNoeud(msg.nodeId);
            role = 'node';
            clearTimeout(authTimer);
            const node = scheduler.registerNode({
              nodeId: msg.nodeId,
              name: msg.name,
              ownerName: msg.ownerName,
              agentType: msg.agentType,
              maxConcurrency: msg.maxConcurrency,
              // Déjà validée par le protocole (estPlateforme) — hors liste, le
              // message entier a été refusé bien avant d'arriver ici.
              ...(msg.plateforme !== undefined ? { plateforme: msg.plateforme } : {}),
              // Déjà validée par le protocole (isModeleList) — liste bornée, noms
              // non vides ; mal formée, tout le register a été refusé en amont.
              ...(msg.modeles !== undefined ? { modeles: msg.modeles } : {}),
            });
            nodeId = node.id;
            const previous = nodeSockets.get(node.id);
            if (previous && previous !== ws)
              previous.close(4000, 'remplacé par une nouvelle connexion');
            nodeSockets.set(node.id, ws);
            send(ws, { type: 'registered', nodeId: node.id });
            // Réconciliation : requalifier les tâches que le nœud ne fait plus
            // tourner (crash/redémarrage), et demander l'abandon de ses zombies
            // (tâches déjà réaffectées ailleurs après un blip réseau).
            const { zombies } = scheduler.reconcileNode(node.id, msg.activeTasks ?? []);
            for (const taskId of zombies) {
              send(ws, { type: 'cancel_task', taskId, reason: 'tâche réaffectée' });
            }
            // Le socket est branché : on peut maintenant assigner des tâches au nœud.
            scheduler.tick();
            stateDirty = true;
          } else if (msg.type === 'subscribe') {
            if (!tokenMatches(msg.token, config.token)) {
              ws.close(4401, 'token invalide');
              return;
            }
            role = 'dashboard';
            clearTimeout(authTimer);
            dashboardSockets.add(ws);
            send(ws, { type: 'state', snapshot: store.getSnapshot() });
          } else {
            ws.close(4401, 'authentification requise');
          }
          return;
        }

        if (role !== 'node' || nodeId === null) return; // le dashboard est en lecture seule

        switch (msg.type) {
          case 'heartbeat':
            scheduler.heartbeat(nodeId);
            if (msg.onShift !== undefined) nodeOnShift.set(nodeId, msg.onShift);
            break;
          case 'task_update':
            scheduler.handleTaskUpdate(nodeId, msg.taskId, msg.subAgents, msg.log);
            break;
          case 'task_result': {
            // ─── LE HUB SAVAIT DIRE NON, ET NE LE DISAIT JAMAIS ──────────────
            //
            // `handleTaskResult` rend `false` quand il écarte le résultat —
            // tâche inconnue, ou assignation périmée (réaffectée, annulée, déjà
            // close). Il journalise (`result_ignored`), donc un humain peut le
            // voir. LE NŒUD, LUI, N'APPRENAIT RIEN : il avait fait tourner son
            // agent, remonté un diff, et repartait convaincu d'avoir livré.
            //
            // `ErrorMsg` existe dans le protocole depuis toujours, le client le
            // parse et le journalise (`erreur du hub : …`). Il n'était émis
            // NULLE PART. Le hub avait une bouche et ne s'en servait pas.
            //
            // Ce que le message dit ne révèle rien : le nœud connaît déjà le
            // `taskId` qu'il vient d'envoyer.
            const pris = scheduler.handleTaskResult(nodeId, {
              taskId: msg.taskId,
              success: msg.success,
              diff: msg.diff,
              logs: msg.logs,
              durationMs: msg.durationMs,
              subAgents: msg.subAgents,
            });
            if (!pris) {
              send(ws, {
                type: 'error',
                message: `résultat de ${msg.taskId} écarté : tâche inconnue ou assignation périmée`,
              });
            }
            // ─── LA RUCHE ÉCRIT DANS SON CERVEAU ────────────────────────────
            //
            // C'est ici que la boucle se referme : jusqu'à présent la ruche
            // LISAIT son cerveau sans jamais l'alimenter, et le savoir ne
            // pouvait venir que d'un humain.
            //
            // Seulement sur un échec PRIS EN COMPTE. Un résultat écarté (tâche
            // inconnue, assignation périmée) ne dit rien du projet — l'ajouter
            // gonflerait le compteur de récurrences d'une panne qui n'a pas eu
            // lieu deux fois, et le seuil de consolidation deviendrait faux.
            if (pris && !msg.success) {
              noterEchec(msg.taskId, msg.logs ?? '');
            }
            // ─── UNE RELECTURE N'EST PAS UNE PRODUCTION ─────────────────────
            //
            // Sans cette question, le résultat d'une relecture repartirait
            // en contre-expertise et serait relu à son tour. À l'infini —
            // et chaque tour coûte un vrai appel de modèle.
            //
            // C'est la table latérale qui tranche : une tâche y figure si et
            // seulement si elle a été créée POUR relire quelque chose.
            const lienRelecture = pris ? store.relectureDe(msg.taskId) : null;
            if (lienRelecture) {
              // Le texte du relecteur est une DONNÉE : `lireAvis` le neutralise
              // et le borne avant qu'il n'atteigne un événement lu par un
              // humain. Un verdict illisible compte comme CONTESTÉ.
              noterVerdict(msg.taskId, lienRelecture, `${msg.logs ?? ''}\n${msg.diff ?? ''}`);
            } else if (pris && msg.success && (msg.diff ?? '').trim() !== '') {
              signalerContreExpertise(msg.taskId, nodeId, msg.diff ?? '', msg.logs ?? '');
            }
            break;
          }
          case 'task_reject':
            // Refus d'assignation (saturation, ou agent en panne → infra) :
            // requeue sans brûler de tentative ; le token-failover gère l'infra.
            // retryAfterMs (Night Shift) allonge le cooldown de re-sollicitation.
            scheduler.rejectTask(
              nodeId,
              msg.taskId,
              msg.reason,
              msg.infra ?? false,
              Date.now(),
              msg.retryAfterMs,
            );
            break;
          case 'merge_result': {
            // Honeycomb Merge : range le résultat pour le projet demandeur.
            // Un REFUS du nœud (Night Shift…) est un échec explicite — jamais
            // consigné comme un merge « réussi » vide.
            if (msg.refused) {
              failMerge(msg.mergeId, msg.refused);
              break;
            }
            const pending = pendingMerges.get(msg.mergeId);
            if (!pending) {
              // ─── LE TRAVAIL QUI DISPARAISSAIT SANS UN MOT ──────────────────
              //
              // Un merge que le hub ne connaît plus était ignoré ICI, en
              // silence : pas de réponse au nœud, PAS MÊME UN ÉVÉNEMENT. Or ce
              // nœud vient de faire tourner un vrai merge sur le dépôt de
              // quelqu'un — il a pu appliquer des diffs, lancer des tests,
              // pousser des commits.
              //
              // Le cas arrive tout seul : le hub déclare orphelin un merge dont
              // le nœud s'est tu trop longtemps (`failMerge`), le nœud finit
              // quand même, et son résultat tombe dans le vide. De son côté :
              // « merge terminé ». Du côté humain : rien, jamais.
              //
              // Deux destinataires, parce qu'ils ont chacun besoin de le
              // savoir : le nœud, pour cesser de croire son travail pris en
              // compte ; le journal, pour qu'un humain puisse relier « j'ai vu
              // le merge tourner » à « la ruche n'en a pas voulu ».
              send(ws, {
                type: 'error',
                message: `merge ${msg.mergeId} inconnu du hub (expiré ou déjà clos) — résultat ignoré`,
              });
              emitEvent('merge_result_ignored', { mergeId: msg.mergeId, nodeId });
              break;
            }
            mergeResults.set(pending.projectId, msg);
            pendingMerges.delete(msg.mergeId);
            emitEvent('merge_completed', {
              projectId: pending.projectId,
              mergeId: msg.mergeId,
              applied: msg.applied.length,
              conflicts: msg.conflicts.length,
              testsPassed: msg.testsPassed,
            });
            break;
          }
          case 'chantier_result': {
            const pending = pendingChantiers.get(msg.chantierId);
            if (!pending) {
              // MÊME LEÇON QUE LE MERGE, et elle a coûté un vrai travail perdu
              // en silence : un nœud vient de cloner un dépôt et d'y lancer une
              // commande. Si le hub ne connaît plus ce chantier, il le DIT — au
              // nœud, qui cesse de croire son travail pris en compte, et au
              // journal, pour qu'un humain puisse relier ce qu'il a vu tourner
              // à ce que la ruche en a fait.
              send(ws, {
                type: 'error',
                message: `chantier ${msg.chantierId} inconnu du hub (expiré ou déjà clos) — résultat ignoré`,
              });
              emitEvent('chantier_result_ignored', { chantierId: msg.chantierId, nodeId });
              break;
            }
            pendingChantiers.delete(msg.chantierId);
            chantierResults.set(pending.projectId, msg);
            emitEvent(msg.ok ? 'chantier_completed' : 'chantier_failed', {
              projectId: pending.projectId,
              chantierId: msg.chantierId,
              nom: msg.nom,
              code: msg.code,
              ...(msg.refused ? { refused: msg.refused } : {}),
            });
            break;
          }
          default:
            break; // register/subscribe répétés : ignorés
        }
      } catch (err) {
        console.error(
          `[hive] erreur de traitement WS : ${err instanceof Error ? err.message : err}`,
        );
        try {
          ws.close(1011, 'erreur interne');
        } catch {
          /* socket déjà fermé */
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(budgetTimer);
      if (role === 'node' && nodeId !== null && nodeSockets.get(nodeId) === ws) {
        nodeSockets.delete(nodeId);
        nodeOnShift.delete(nodeId);
        scheduler.nodeDisconnected(nodeId, 'ws_closed');
        // Un merge confié à ce nœud ne reviendra jamais : le déclarer échoué
        // (sinon /merge/result resterait null et l'entrée fuirait).
        for (const [mergeId, pending] of pendingMerges) {
          if (pending.nodeId === nodeId) failMerge(mergeId, 'nœud déconnecté');
        }
        stateDirty = true;
      }
      if (role === 'dashboard') dashboardSockets.delete(ws);
    });

    ws.on('error', () => {
      // rien : l'événement close suivra et fera le ménage
    });
  });

  // ─── Boucles périodiques ───────────────────────────────────────────────────

  /**
   * Contexte de RE-LIVRAISON mémoïsé par tâche muette. Bornée par le nombre de
   * tâches actuellement muettes (les autres sont oubliées à la fin de chaque
   * passe) : sur dix ans, la mémoire ne dérive pas.
   */
  const contextesRelivres = new Map<string, string>();

  /**
   * Quand chaque tâche muette a été re-servie pour la dernière fois.
   *
   * ─── LE DÉFAUT QUE CETTE CARTE FERME ───────────────────────────────────────
   *
   * Le filet ne gardait aucune trace de ses tentatives. Une tâche assignée dont
   * le nœud ne répond jamais restait « muette depuis plus de 5 s » pour
   * toujours, donc elle repartait À CHAQUE TICK — indéfiniment. Le filet cessait
   * d'être un filet pour devenir un robinet.
   *
   * ─── POURQUOI PAS `updatedAt` ──────────────────────────────────────────────
   *
   * Le geste qui vient à l'esprit est de rafraîchir `updatedAt` en re-servant :
   * la tâche redeviendrait muette 5 s plus tard, et l'espacement serait gratuit.
   * Il est faux. `updatedAt` veut dire « la tâche a CHANGÉ », et une
   * re-livraison ne la change pas — c'est le même travail, renvoyé. Le teindre
   * ferait passer une tâche gelée pour fraîche auprès de tout ce qui lit ce
   * champ, à commencer par le filet lui-même : il ne saurait plus depuis quand
   * elle se tait.
   *
   * Une carte en mémoire dit exactement ce qu'on veut dire — « voilà quand JE
   * l'ai renvoyée » — sans rien affirmer sur la tâche.
   */
  const derniereRelivraison = new Map<string, number>();

  /**
   * Un renvoi au plus toutes les 15 s pour une même tâche.
   *
   * Le filet existe pour un `assign_task` PERDU EN VOL, cas rare que la première
   * reprise suffit à rattraper. Au-delà, ce n'est plus un message perdu, c'est
   * un nœud qui ne répond pas — et le marteler ne le réveillera pas. Quinze
   * secondes laissent sept reprises dans les deux premières minutes, ce qui est
   * généreux pour un message perdu, puis la cadence devient supportable.
   */
  const RELIVRAISON_MIN_MS = config.relivraisonMinMs ?? 15_000;

  const tickTimer = setInterval(() => {
    // Une exception ici (ex. SQLite verrouillé) ne doit pas arrêter la boucle
    // ni abattre le process : on journalise et on retentera au prochain tick.
    try {
      scheduler.tick();
      // Filet de sécurité : re-livre `assign_task` pour les tâches assignées
      // restées muettes (message perdu en vol). Le client ignore les doublons.
      // Pour une course, TOUS les drones en vol sont re-servis (un assign_task
      // perdu vers un drone non-primaire n'est visible nulle part ailleurs).
      const muettes = scheduler.staleAssignedTasks(5_000);
      const maintenant = Date.now();
      for (const task of muettes) {
        // Espacement AVANT tout le reste : la sortie la moins chère est celle
        // qui ne calcule rien. Le contexte mémoïsé plus bas est déjà une
        // économie, mais ne rien envoyer coûte encore moins que l'envoyer vite.
        const dernier = derniereRelivraison.get(task.id);
        if (dernier !== undefined && maintenant - dernier < RELIVRAISON_MIN_MS) continue;
        const race = scheduler.getRace(task.id);
        const targets = race
          ? race.drones.filter((d) => d.status === 'running').map((d) => d.nodeId)
          : task.assignedNodeId
            ? [task.assignedNodeId]
            : [];
        // Aucune socket ouverte ⇒ personne à re-servir : ni contexte, ni
        // lecture du projet. Le contexte coûte un BM25 sur la mémoire Hive Mind
        // (~37 ms mesurées sur 500 souvenirs) et il était payé PAR TÂCHE MUETTE
        // ET PAR TICK, dans le corps SYNCHRONE d'un setInterval de 2 s, avant
        // même de savoir s'il y avait quelqu'un au bout du fil.
        const ouvertes = targets.filter((nodeId) => nodeSockets.has(nodeId));
        if (ouvertes.length === 0) continue;
        const project = store.getProject(task.projectId);
        // Le contexte (Couveuse + Hive Mind) est reconstruit ici AUSSI : une
        // re-livraison nue priverait la tâche des leçons annoncées par
        // brood_context — l'ouvrière refaisait la même erreur. MÉMOÏSÉ par
        // taskId : une tâche muette l'est par définition parce qu'elle ne rend
        // rien, donc ses leçons ne changent pas d'un tick à l'autre — le
        // recalculer à chaque tick, c'était refaire le même travail pour le
        // même octet.
        let hiveContext = contextesRelivres.get(task.id);
        if (hiveContext === undefined) {
          hiveContext = construireHiveContext(task).hiveContext;
          contextesRelivres.set(task.id, hiveContext);
        }
        derniereRelivraison.set(task.id, maintenant);
        for (const nodeId of ouvertes) {
          const ws = nodeSockets.get(nodeId);
          if (ws) {
            send(ws, {
              type: 'assign_task',
              task,
              repoUrl: project?.repoUrl ?? null,
              ...(hiveContext ? { hiveContext } : {}),
            });
          }
        }
      }
      // La mémoïsation est bornée par les tâches ENCORE muettes : dès qu'une
      // tâche rend un résultat (ou est réassignée), son contexte est oublié —
      // et sera donc recalculé, à jour, si elle redevenait muette.
      if (contextesRelivres.size > 0 || derniereRelivraison.size > 0) {
        const encoreMuettes = new Set(muettes.map((t) => t.id));
        for (const taskId of contextesRelivres.keys()) {
          if (!encoreMuettes.has(taskId)) contextesRelivres.delete(taskId);
        }
        // Même borne pour la carte des tentatives : une tâche qui a fini de se
        // taire oublie son historique de renvois, et repart donc à zéro si elle
        // redevenait muette. C'est aussi ce qui empêche ces deux cartes de
        // grandir sans fin dans un processus qui tourne des mois.
        for (const taskId of derniereRelivraison.keys()) {
          if (!encoreMuettes.has(taskId)) derniereRelivraison.delete(taskId);
        }
      }
      // Borne la croissance du journal, de la mémoire Hive Mind, des résultats
      // et des verdicts de garde (doctrine, règle 3 : une table nouvelle arrive
      // avec sa borne d'élagage, et la borne est CÂBLÉE, pas seulement écrite).
      store.pruneEvents(EVENT_RETENTION);
      store.pruneMemories(MEMORY_RETENTION);
      store.pruneResults(RESULT_RETENTION);
      store.pruneGardiennes(GARDIENNES_RETENTION);
      store.pruneLivraisons(LIVRAISONS_RETENTION);
      // ─── LA BORNE QUI MANQUAIT, ET QUI REND LES DEUX SUIVANTES VRAIES ──────
      //
      // `tasks` était la SEULE table du dépôt sans élagueur. Les deux bornes
      // référentielles juste dessous se justifiaient par « les tâches ont déjà
      // leur propre élagage » — c'était faux, et mesuré comme tel : sur 2 000
      // tâches, elles supprimaient 0 ligne, pour toujours.
      //
      // ELLE PASSE AVANT ELLES, et l'ordre est le sujet : une borne
      // référentielle ne peut nettoyer que ce qui est DÉJÀ orphelin. Appelée en
      // premier, elle ne verrait rien et il faudrait attendre le tick suivant.
      store.pruneTasks(TACHES_RETENTION_MS);
      // Le lien tâche→issue ne survit pas à sa tâche : borne référentielle.
      store.pruneTachesIssue();
      // Idem pour le lien relecture→production. Câblé ICI, dans le même
      // changement que la table — c'est la règle 3, et les trois bornes
      // oubliées quelques lignes plus bas disent ce qu'il en coûte de la
      // remettre à plus tard.
      store.pruneContreExpertises();
      // Et ce que la contre-visite a DÉCIDÉ : même borne référentielle, câblée
      // dans le même changement que la table (règle 3). Elle naît vraie —
      // `pruneTasks`, juste au-dessus, fait vraiment disparaître des tâches.
      store.pruneContreVisites();
      // Le lien tâche→modèle de l'Aiguillage : même borne référentielle, câblée
      // avec la table (règle 3), et placée APRÈS `pruneTasks` — une borne
      // référentielle ne nettoie que ce qui est déjà orphelin.
      store.pruneAiguillageModeles();
      store.pruneConseils(CONSEILS_CONSERVES);
      // ─── LES TROIS BORNES QUI ÉTAIENT ÉCRITES ET PAS CÂBLÉES ───────────────
      //
      // `pruneAcces`, `prunePartages` et `pruneServeurs` existaient, documentés
      // avec soin, et n'étaient appelés QUE par des tests — pour le troisième,
      // par personne. Trois tables grandissaient donc sans borne, dont deux qui
      // gardaient des IDENTIFIANTS MORTS sur disque pour toujours.
      //
      // C'est exactement ce que le commentaire ci-dessus promettait déjà : « la
      // borne est CÂBLÉE, pas seulement écrite ». Elle l'est maintenant, et un
      // test tient la règle pour toutes les bornes à venir.
      //
      // Les trois ne suppriment que des lignes DÉJÀ MORTES — billet révoqué,
      // lien éteint, machine effacée. Aucune ne peut rouvrir quoi que ce soit,
      // et c'est vérifié plutôt que supposé.
      store.pruneAcces(ACCES_GRACE_MS);
      store.prunePartages(PARTAGES_GRACE_MS);
      store.pruneServeurs(SERVEURS_SUPPRIMES_CONSERVES);
      // ─── ET LA QUATRIÈME, QUI MANQUAIT AU COMPTE ───────────────────────────
      //
      // Le commentaire ci-dessus dit « machine EFFACÉE » — l'état `supprime`.
      // Or rien n'y menait jamais : `aSupprimer`, la borne qui désigne les
      // machines dont la rétention est échue, n'avait AUCUN appelant. La seule
      // transition vers `supprime` du dépôt était le geste manuel d'un
      // administrateur.
      //
      // `pruneServeurs` élaguait donc un état qu'on n'atteignait pas, et le
      // tableau de bord affichait « ⏳ N j avant effacement » puis, à zéro,
      // « la machine X va être effacée aujourd'hui, avec tout ce qu'elle
      // contient » — indéfiniment. Les données des clients partis restaient,
      // ce qui est le contraire exact de ce que la ruche leur promet.
      //
      // Le balayage est LANCÉ sans être attendu : joindre un fournisseur peut
      // prendre plusieurs secondes, et le tick d'ordonnancement ne doit jamais
      // dépendre d'un réseau tiers.
      void balayerRetention(Date.now()).catch((err: unknown) => {
        app.log.warn({ err }, 'balayage de rétention en échec');
      });

      // Le Conseil avance par SCRUTIN, hors du chemin chaud du scheduler : voir
      // l'en-tête de conseil-runner.ts. Aucune session ouverte = aucun coût.
      scruterConseils();
      // Le runner d'essaim. Le test du mode est fait AVANT de lire la base :
      // sur une ruche dont l'hôte n'a pas allumé l'autonomie — le cas par
      // défaut — ce branchement ne coûte pas une seule requête SQL, toutes les
      // deux secondes, pour toujours. Le cadencier tient sa propre cadence
      // (une minute par projet) ; l'appeler à chaque tick est sans effet.
      if (modeRunner === 'on') {
        const autonomes = store.listProjetsAutonomes();
        if (autonomes.length > 0) {
          // Le cycle est asynchrone : on ne l'attend PAS dans le tick, sinon un
          // conseil lent retarderait l'ordonnancement de toute la ruche. Le
          // cadencier refuse déjà tout chevauchement.
          void cadencier.tour(autonomes).catch((err: unknown) => {
            console.error(
              `[hive] erreur de cycle d’essaim : ${err instanceof Error ? err.message : err}`,
            );
          });
        }
      }
      // Purge des compteurs de débit expirés (borne la map par IP).
      const now = Date.now();
      for (const [ip, h] of apiHits) {
        if (h.resetAt <= now) apiHits.delete(ip);
      }
      // Merges orphelins (nœud muet au-delà du délai) → échec, pas de blocage.
      for (const [mergeId, pending] of pendingMerges) {
        if (now - pending.startedAt > MERGE_TIMEOUT_MS) failMerge(mergeId, 'délai dépassé');
      }
    } catch (err) {
      console.error(`[hive] erreur de tick : ${err instanceof Error ? err.message : err}`);
    }
  }, config.tickMs ?? 2_000);
  tickTimer.unref();

  const flushTimer = setInterval(() => {
    try {
      if (stateDirty) {
        stateDirty = false;
        broadcastState();
      }
    } catch (err) {
      console.error(
        `[hive] erreur de diffusion d'état : ${err instanceof Error ? err.message : err}`,
      );
    }
  }, 250);
  flushTimer.unref();

  // ─── LA BORNE DU CERVEAU S'APPLIQUE VRAIMENT ────────────────────────────────
  //
  // Règle du dépôt : tout ce qui s'accumule ship sa borne dans le MÊME commit.
  // `aElaguer` existait depuis trois PR et n'avait aucun appelant — c'est-à-dire
  // qu'elle était une borne ÉCRITE, pas une borne TENUE. Ce dépôt a déjà payé
  // pour trois bornes exactement dans cet état.
  //
  // Une heure, pas chaque tick : élaguer relit tout le dossier, et une panne
  // qui se répète n'a pas besoin d'être oubliée à la seconde près. `unref` pour
  // que ce minuteur n'empêche jamais le processus de s'arrêter.
  const elagageTimer = setInterval(
    () => {
      try {
        const r = elaguer(dossierCerveau);
        if (r.retires.length > 0) {
          emitEvent('cerveau_elagage', { retires: r.retires.length, restants: r.restants });
        }
      } catch (err) {
        // Un cerveau illisible ne doit pas tuer la ruche : elle sait déjà
        // travailler sans savoir, elle le faisait il y a trois PR.
        console.error(
          `[hive] élagage du cerveau impossible : ${err instanceof Error ? err.message : err}`,
        );
      }
    },
    60 * 60 * 1_000,
  );
  elagageTimer.unref();

  const stop = async (): Promise<void> => {
    clearInterval(tickTimer);
    clearInterval(flushTimer);
    clearInterval(elagageTimer);
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await app.close();
    store.close();
  };

  return {
    store,
    scheduler,
    config,
    port,
    url: `http://${config.host}:${port}`,
    stop,
  };
}
