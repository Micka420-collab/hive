Warning: truncated output (original token count: 95630)
Total output lines: 8952

// Serveur de l'orchestrateur (Queen) : Fastify pour le REST + le dashboard
// statique, `ws` pour le temps réel nœuds ↔ hub ↔ dashboard.
// Sécurité : CORS restreint (jamais "*"), token obligatoire (non-trivial hors
// simulation), limite de taille des corps, validation de toutes les entrées.

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
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
} from './auth.js';
import { shellForce } from '../shared/agent-production.js';
import { calibrer, estimerDuree, resteEstime } from '../shared/horloge-chantier.js';
import type { Calibration } from '../shared/horloge-chantier.js';
import { encodeInvite, isWsUrl } from '../shared/invite.js';
import { inviteInjoignable } from '../shared/joignable.js';
import { portDepuisEnv } from '../shared/port.js';
import { gardiennesDepuisEnv } from '../shared/reglages.js';
import { editionDepuisEnv, secretWebhookExige } from '../shared/edition.js';
import type { Edition } from '../shared/edition.js';
import {
  atelierDepuisEnv,
  etatAtelier,
  executerPlan,
  moteurAtelier,
  planComposeArret,
  planComposeAtelier,
} from '../atelier/lancement.js';
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
import { commandeEntree } from '../shared/commande-entree.js';
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
import {
  libelleAvantRetouche,
  libelleManuelValide,
  patchVers,
  promptRestauration,
} from '../shared/sauvegardes.js';
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
import {
  isValidLocalRepoPath,
  isValidRemoteRepoUrl,
  LIMITS,
  octetsDe,
  parseClientMessage,
} from '../shared/protocol.js';
import type { ChantierResultMsg, MergeResultMsg, ServerMessage } from '../shared/protocol.js';
import { direManques, manquesDeDemarrage } from '../shared/amorce.js';
import { DEFAULT_TOKEN } from '../shared/types.js';
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
  hebergement,
  lireCharge,
  verifierSignature,
} from './abonnement.js';
import type { Abonnement, EtatAbonnement } from './abonnement.js';
import { evenementDepuisStripe } from './nuage.js';
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
import { marquerFabriquesMergeesApresFusion } from './fabrique.js';
import {
  doitNoterFaitDeriveASurveiller,
  doitNoterFaitDeriveDegradee,
  SOURCE_HORIZON_DERIVE,
  texteFaitDeriveASurveiller,
  texteFaitDeriveDegradee,
  texteHorizonPourContexte,
} from './horizon.js';
import { expliquerRefusBapteme } from './bapteme.js';
import { METIERS, expliquerRefusMetier } from './metier.js';
import { expliquerRefusRequisition } from './requisition.js';
import {
  FOURNISSEURS_CLE,
  estEnvQueenAutorisee,
  estNomEnvValide,
  expliquerRefusSecret,
  nomEnvDepuisLibelle,
  poserCleQueenEnv,
  presenceClesCatalogue,
  validerSecretRequisition,
} from './requisition-env.js';
import { conseilVeilleBrief } from './queen-veille.js';
import {
  CORPUS_GARDIENNES,
  cheminsPromis,
  fichiersTouches,
  inspectionDeProduction,
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
// L'Agent Garde-Fous : le POLYÉTHISME d'une production suit l'échelon POSÉ pour
// sa tâche (projet opt-in), pas le seul mode global — et l'EXIGENCE constatée est
// rangée, ce qui rend l'observation repliable (le bandit apprend).
import { ECHELONS, REGLAGES, versEchelon } from './garde-fou.js';
import type { Echelon } from './garde-fou.js';
import { CHAT_ENVOI_MAX } from '../shared/reine-pieces.js';
import { askConcierge, askConciergeStream, sousAgentsDepuisEvenements } from './concierge.js';
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
  productionAContreExpertiser,
} from '../shared/contre-expertise.js';
import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import { buildHiveContext } from './hive-mind.js';
import { buildMergePlan } from './honeycomb.js';
import { tally, signatureOf } from './parliament.js';
import type { Ballot } from './parliament.js';
import { CacheDomaines, domaineDeTache, replierTraces } from './pheromones.js';
import type { Domaine, TraceePheromone } from './pheromones.js';
import { anthropicLlm, anthropicLlmStream, llmPlannerAvailable, planBrief } from './planner.js';
import { buildProjectReport } from './project-report.js';
import { computePulse } from './pulse.js';
import { buildTimeline } from './replay.js';
import { detectConflicts } from './sting-detector.js';
import { Scheduler } from './scheduler.js';
import { HiveStore } from './store.js';
import type { SessionRangee } from './store.js';
import { lireTemperature, FENETRE_MS as FENETRE_THERMO_MS, TYPES_THERMO } from './thermo.js';
import { buildWaggleBoard } from './waggle.js';
import { lireVersionRuche } from './version-lue.js';
import { commandeDePose } from '../shared/pose-outil.js';
import { marcheASuivre, poseDepuis, versionDeclaree } from '../shared/version-ruche.js';

/**
 * La racine du dépôt, vue depuis le code COMPILÉ (`dist/orchestrator/`).
 *
 * `fileURLToPath`, jamais `.pathname` : sous Windows ce dernier rend
 * « /D:/… » et doublerait la lettre de lecteur (§ 6.1 du journal).
 */
const RACINE_RUCHE = fileURLToPath(new URL('../..', import.meta.url));

/**
 * La version déclarée, lue une fois au démarrage.
 *
 * Informative seulement : elle ne bouge pas d'un `git pull` à l'autre. C'est
 * le COMMIT qui dit ce qui tourne, et c'est pour ça qu'on lit les deux.
 */
const VERSION_DECLAREE: string = (() => {
  try {
    // DEPUIS `RACINE_RUCHE`, pas par un second `new URL('../..')`. J'avais
    // écrit les deux : deux calculs de la même racine, qui auraient dérivé au
    // premier déplacement de fichier — et la contre-épreuve l'a montré, en
    // déplaçant l'une sans que rien ne rougisse.
    const brut = readFileSync(path.join(RACINE_RUCHE, 'package.json'), 'utf8');
    // La DÉCISION est dans `version-ruche`, éprouvée par ses propres bancs.
    // Ici il ne reste que la lecture : ce qui touche au disque d'un côté, ce
    // qui se juge sur une valeur de l'autre. Trois mutants avaient survécu
    // tant que les deux étaient soudés — aucun banc ne pouvait présenter un
    // autre `package.json` que celui du dépôt.
    return versionDeclaree(JSON.parse(brut));
  } catch {
    // Un paquet illisible n'empêche pas la ruche de tourner : on le DIT.
  }
  return 'inconnue';
})();

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
/** Timeline de code : autant que les résultats — une étape par production typique. */
export const SAUVEGARDES_RETENTION = 5_000;

/**
 * Présences Rayon (ADR 0010) : fichiers ouverts constatés. Une présence qui
 * traîne plus d'une heure (outil jamais refermé, nœud disparu) est élaguée —
 * l'écran ne doit pas montrer un fichier « encore ouvert » inventé.
 */
export const PRESENCES_RETENTION_MS = 60 * 60_000;

/**
 * Réquisitions closes (ADR 0010) : on garde l'historique récent, on élague
 * le reste. Les ouvertes ne sont JAMAIS élaguées — un besoin sans réponse
 * doit rester visible.
 */
export const REQUISITIONS_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** Horizon ledger — faits/hypothèses datés ; élagage comme le journal. */
export const HORIZON_RETENTION_MS = 90 * 24 * 60 * 60_000;

/**
 * Registre des annonces de durée (l'horloge du chantier). BORNE D'ÉLAGAGE de la
 * table `annonces_duree` (doctrine, règle 3), câblée dans le tick.
 *
 * ─── POURQUOI UNE UNITÉ DIFFÉRENTE DE `RESULT_RETENTION`, ET PAS UN ORDRE ────
 *
 * `RESULT_RETENTION` est un NOMBRE DE LIGNES, pas une durée : au-delà, seules
 * les colonnes lourdes (`diff`, `logs`) sont vidées — la LIGNE survit, donc
 * `durationMs` aussi, indéfiniment. Comparer les deux bornes n'a donc pas de
 * sens : elles ne mesurent pas la même chose.
 *
 * Ce qui compte pour l'horloge est ailleurs : l'annonce est la moitié
 * PÉRISSABLE du couple. Le réel ne disparaît jamais ; la promesse, si. Une
 * annonce élaguée fait donc silencieusement sortir une tâche de la calibration
 * — sans erreur, sans trou visible, juste une note calculée sur moins de cas
 * qu'on ne croit.
 *
 * Six mois : assez pour que la fenêtre de calibration couvre plusieurs saisons
 * de la ruche, assez court pour que la table ne devienne pas un journal.
 */
const ANNONCES_RETENTION_MS = 180 * 24 * 60 * 60_000;

/**
 * À quel rythme l'horloge SE NOTE.
 *
 * Pas à chaque battement : la note ne bouge qu'aux atterrissages, et une
 * requête de cinq cents lignes toutes les quelques secondes serait payée pour
 * rien. Cinq minutes suffisent — une dérive de calibration se mesure en jours,
 * pas en secondes.
 */
const CALIBRATION_PERIODE_MS = 5 * 60_000;

/**
 * Le rappel : même verdict inchangé, on le redit au bout de six heures.
 *
 * ─── POURQUOI « à chaque changement » NE SUFFIT PAS ──────────────────────────
 *
 * N'émettre que sur changement est la bonne règle pour un journal — un signal
 * répété cesse d'être un signal. Mais le journal est ÉLAGUÉ : un verdict stable
 * pendant une semaine sortirait de la fenêtre et n'y reviendrait jamais. L'écran
 * afficherait alors « rien » sur une horloge parfaitement notée, et « rien » se
 * lit « personne ne surveille ».
 *
 * Six heures : assez rare pour ne rien noyer, assez fréquent pour qu'une
 * fenêtre de journal en contienne toujours un.
 */
const CALIBRATION_RAPPEL_MS = 6 * 60 * 60_000;

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
   * Chemin du `.env` Queen (grant `cle_api`). Défaut : `.env` dans le cwd.
   * Les tests passent un fichier à côté de `dbPath` pour ne pas polluer le dépôt.
   */
  envPath?: string;
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
  /**
   * Community (défaut) : ruche auto-hébergée, 0 €.
   * Cloud : Queen sur tes serveurs, horloge d'hébergeur, webhook Stripe exigé.
   */
  edition?: Edition;
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
  return {
    // La règle du port vit dans `shared/port.ts` — le docteur la LIT aussi,
    // plutôt que d'en écrire une seconde qui divergerait.
    port: portDepuisEnv(env),
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
    // La règle vit dans `shared/reglages.ts` — le docteur la LIT aussi, plutôt
    // que d'en écrire une seconde qui divergerait.
    gardiennes: gardiennesDepuisEnv(env),
    // Idem : le défaut `consignes` encadre sans jamais retenir de production.
    polyethisme:
      env.HIVE_POLYETHISME === 'off' || env.HIVE_POLYETHISME === 'strict'
        ? env.HIVE_POLYETHISME
        : 'consignes',
    edition: editionDepuisEnv(env),
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
  //
  // TOUS EN UNE PASSE. Ces trois gardes levaient l'une après l'autre : l'hôte
  // corrigeait, relançait, découvrait la suivante, corrigeait, relançait. Trois
  // démarrages là où un seul suffit — et quelqu'un qui installe pendant que son
  // collègue attend abandonne au deuxième aller-retour. Mesuré en jouant le
  // parcours, pas supposé.
  //
  // Le tri et la rédaction vivent dans `amorce.ts`, pur : on peut donc éprouver
  // « qu'est-ce qui manque » sans démarrer un serveur.
  const manques = manquesDeDemarrage({
    simulation: config.simulation,
    token: config.token,
    corsOrigins: config.corsOrigins,
    secretJwt: secretJwtDepuisEnv(),
  });
  if (manques.length > 0) throw new Error(`\n${direManques(manques)}\n`);

  const edition = config.edition ?? 'community';
  const secretWebhookDemarrage = process.env.HIVE_WEBHOOK_SECRET ?? '';
  if (secretWebhookExige(edition, config.simulation) && !secretWebhookDemarrage) {
    throw new Error(
      'HIVE_EDITION=cloud refuse de démarrer sans HIVE_WEBHOOK_SECRET : ' +
        'sinon la ruche tournerait, facturerait des heures, et Stripe recevrait 401. ' +
        'Posez le secret du webhook (Stripe → Developers → Webhooks), ' +
        'ou repassez en HIVE_EDITION=community.',
    );
  }

  const store = new HiveStore(config.dbPath);
  const cheminEnvQueen = config.envPath ?? path.join(process.cwd(), '.env');

  const contexteProjetAvecHorizon = (projectId: string, projet: Project): string => {
    const base = [projet.name, projet.description ?? '', projet.repoUrl ?? '']
      .filter(Boolean)
      .join(' — ');
    const horizon = texteHorizonPourContexte(store.listerHorizon(projectId));
    return horizon ? `${base}\n\n${horizon}` : base;
  };

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
  /**
   * Les poses d'outils demandées et pas encore rendues.
   *
   * Sert à DEUX choses, et la seconde est une garde : relier la réponse à la
   * demande, et vérifier qu'un nœud ne rend pas le résultat d'une pose qu'on
   * ne lui a jamais demandée — même contrôle d'appartenance que les chantiers.
   */
  const pendingPoses = new Map<string, { nodeId: string; outilId: string; demandeeA: number }>();
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
    // Les deux recherches sont nécessaires PARCE QUE la production se compose
    // des deux — son titre vient de la tâche, son modèle vient du nœud. Ce lien
    // vit désormais dans `productionAContreExpertiser`, avec ses bancs : ici, la
    // garde était injoignable, et le balayage l'a montrée nue.
    const ouverture = productionAContreExpertiser(
      store.getTask(taskId),
      store.getNode(nodeId),
      diff,
      logs,
    );
    if (!ouverture) return;
    const { production, projectId } = ouverture;

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
        producteur: production.agentType,
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
        projectId,
        title: `Contre-expertise — ${champSurUneLigne(production.titre, 120)}`,
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
        producteurAgent: production.agentType,
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
      producteur: production.agentType,
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
    const budgetHorizon =
      LIMITS.hiveContext -
      (savoir ? savoir.length + 2 : 0) -
      (lecons ? lecons.length + 2 : 0) -
      (souvenirs ? souvenirs.length + 2 : 0) -
      (dejaPris ? dejaPris + 2 : 0);
    const horizon =
      budgetHorizon > 80
        ? texteHorizonPourContexte(store.listerHorizon(task.projectId), budgetHorizon - 2)
        : '';
    const veille = conseilVeilleBrief(`${task.title} ${task.prompt}`) ?? '';
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
      hiveContext: [savoir, lecons, souvenirs, horizon, veille].filter(Boolean).join('\n\n'),
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

  /**
   * Le POLYÉTHISME qui gouverne UNE production. Si l'Agent Garde-Fous a posé un
   * échelon pour cette tâche (projet opt-in), c'est la sévérité de cet échelon
   * (`REGLAGES[echelon].polyethisme`, jamais `off`) qui prime — le jumeau server
   * de `modeGardiennesDe`, pour que les deux modes d'une production viennent du
   * MÊME échelon posé. Sinon, le mode global. On lit l'échelon POSÉ, jamais on ne
   * re-élit : le mode qui JUGE est celui qui a GOUVERNÉ.
   */
  const polyethismeDe = (task: Task): ModePolyethisme => {
    const brut = store.getEchelonGardeFou(task.id);
    const echelon = brut === null ? null : versEchelon(brut);
    return echelon ? REGLAGES[echelon].polyethisme : polyethismeEnVigueur();
  };

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
  const envoyerTache = (nodeId: string, task: Task, modele?: string): void => {
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
        // Le modèle choisi par l'Aiguillage, s'il y en a un : le nœud le passe à
        // son adaptateur. Absent ⇒ le nœud emploie son modèle par défaut.
        ...(modele ? { modele } : {}),
      });

      // ─── L'HORLOGE DU CHANTIER : ce qu'on ANNONCE, écrit au moment où on
      //     l'annonce ────────────────────────────────────────────────────────
      //
      // Ici et nulle part ailleurs, pour la raison qui gouverne déjà cette
      // fonction : une seule porte vers les ouvrières. Une annonce posée à un
      // second endroit serait une annonce qu'on oublie de mettre à jour.
      //
      // La caste est FIGÉE maintenant. Elle est vive — recalculée à chaque
      // interrogation —, et la relire dans trois semaines pour expliquer cette
      // durée-ci rendrait un historique faux.
      //
      // Le socle `aucun` est enregistré comme les autres : savoir que la ruche
      // n'avait RIEN à dire ce jour-là fait partie de son histoire, et c'est ce
      // qui permettra plus tard de dater le moment où elle a commencé à savoir.
      const annonce = estimerDuree(store.historiqueDurees(), { caste: casteDe(nodeId) });
      store.enregistrerAnnonce(task.id, nodeId, casteDe(nodeId), annonce);
      emitEvent('duree_annoncee', {
        taskId: task.id,
        nodeId,
        socle: annonce.socle,
        n: annonce.n,
        p50Ms: annonce.p50Ms,
        p80Ms: annonce.p80Ms,
      });
    }
  };

  const scheduler = new Scheduler(store, {
    // ─── DEUX QUESTIONS QU'IL NE FAUT PAS CONFONDRE ──────────────────────────
    //
    // `config.simulation` (HIVE_SIMULATION=1) relâche TROIS GARDES DE SÉCURITÉ
    // plus haut dans cette fonction : jeton trivial toléré, secret de session
    // absent toléré, secret de webhook absent toléré. Ce drapeau ne doit
    // JAMAIS s'élargir — `HIVE_AGENT=shell` ouvrirait ces trois portes-là à
    // qui pose une variable d'environnement.
    //
    // « ce nœud peut-il recevoir du travail de démonstration » est une
    // question DIFFÉRENTE, et elle ne relâche aucune sécurité. Le message de
    // `messageRefusShellProduction` promet DEUX trappes — « HIVE_SIMULATION=1
    // ou HIVE_AGENT=shell » — et `demarrageNoeudAutorise` les honore toutes
    // les deux. L'ordonnanceur n'en honorait qu'une : un nœud démarré sur la
    // foi du message restait éligible à rien, et sa tâche courait sans fin.
    //
    // Un message qui annonce un contrat que le code n'honore pas est un
    // mensonge lent. Ici les deux portes disent enfin la même chose.
    simulation: config.simulation || shellForce(process.env),
    // Balance : le grand livre suit la table `results` et n'influence RIEN.
    balance: { mode: config.balance ?? 'observation' },
    factureHorlogeHote: edition === 'cloud',
    // Les Gardiennes : le contrôle d'entrée du nectar. Défaut `consultatif` —
    // on renifle et on annote, on ne refuse rien.
    gardiennes: { mode: config.gardiennes ?? 'consultatif' },
    // Drone Wars : annuler le travail d'un drone perdant (ou d'une course annulée).
    onCancel: (nodeId, taskId, reason) => {
      const ws = nodeSockets.get(nodeId);
      if (ws) send(ws, { type: 'cancel_task', taskId, reason });
    },
    onAssign: (nodeId, task, modele) => envoyerTache(nodeId, task, modele),
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

  const reject = (reply: FastifyReply) =>
    reply.code(401).send({
      error: 'token invalide',
      detail:
        'Le jeton du tableau de bord (champ « Jeton » en haut à droite) doit être ' +
        'exactement la valeur de HIVE_TOKEN dans le fichier .env de l’orchestrateur. ' +
        'Ce n’est pas le jeton GitHub (HIVE_GITHUB_TOKEN).',
    });

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

  // ─── QUELLE VERSION CETTE RUCHE FAIT-ELLE TOURNER ? ────────────────────────
  //
  // Le fait qui manquait sous « mettre à jour Hive » : personne ne savait ce
  // qui tournait. `package.json` annonce `0.2.0` et ne bouge jamais ; le dépôt
  // n'a ni étiquette ni version publiée.
  //
  // La route est en LECTURE SEULE et ne lance pas `git` : elle lit deux
  // fichiers texte sous `.git`. Elle rend aussi la marche à suivre — à LIRE
  // puis à coller soi-même. La ruche ne se met pas à jour toute seule, et ce
  // n'est pas une timidité : ce dépôt sait exactement comment une mise à jour
  // automatique casse une installation qui marchait (`better-sqlite3`,
  // dépendance optionnelle que npm écarte en silence). La sonde est dans la
  // marche à suivre pour cette raison.
  //
  // Derrière le jeton, comme le reste : le commit qu'on fait tourner dit quels
  // correctifs de sécurité on n'a PAS.
  app.get('/api/version', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const version = lireVersionRuche(RACINE_RUCHE, VERSION_DECLAREE);
    const pose = poseDepuis(version);
    return { version, pose, marche: marcheASuivre(pose) };
  });
  app.get('/api/edition', async () => ({
    edition,
    factureHorlogeHote: edition === 'cloud',
  }));

  app.get('/api/atelier', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return etatAtelier({ env: process.env });
  });

  app.post('/api/atelier/demarrer', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const mode = atelierDepuisEnv(process.env);
    if (mode === 'off') {
      return reply.code(403).send({ error: 'HIVE_ATELIER=off — posez auto ou on' });
    }
    const plan = planComposeAtelier(moteurAtelier(process.env));
    if (!plan.ok) return reply.code(409).send({ error: plan.raison });
    const out = await executerPlan(plan, { cwd: process.cwd(), env: process.env });
    if (!out.ok) return reply.code(502).send({ error: out.stderr || 'compose a échoué' });
    return { ok: true, plan: plan.argv };
  });

  app.post('/api/atelier/arreter', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const plan = planComposeArret(moteurAtelier(process.env));
    if (!plan.ok) return reply.code(409).send({ error: plan.raison });
    const out = await executerPlan(plan, { cwd: process.cwd(), env: process.env });
    if (!out.ok) return reply.code(502).send({ error: out.stderr || 'arrêt échoué' });
    return { ok: true };
  });

  /**
   * Chambre (ADR 0010) — lecture du poste d'UNE ouvrière.
   *
   * Jeton de ruche UNIQUEMENT. Un lien de partage ne doit JAMAIS voir les
   * identités qui travaillent (baptême, métier, présence, tâches du nœud).
   * Champs absents ⇒ null / [] : l'écran n'invente rien.
   */
  app.get<{ Params: { nodeId: string } }>(
    '/api/chambre/:nodeId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['nodeId'],
          properties: { nodeId: { type: 'string', minLength: 1, maxLength: 64 } },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const node = store.getNode(req.params.nodeId);
      if (!node) return reply.code(404).send({ error: 'ouvrière inconnue' });
      const bapteme = store.lireBapteme(node.id);
      const metier = store.lireMetier(node.id);
      const presences = store.lirePresences(node.id);
      const tasks = store
        .listTasks()
        .filter((t) => t.assignedNodeId === node.id || t.result?.nodeId === node.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 80);
      // Projet dominant = dernière tâche touchée — pour horizon / fabrique à l'écran.
      const projectId = tasks[0]?.projectId ?? null;
      let horizon: { faits: unknown[]; hypotheses: unknown[] } | null = null;
      let fabriques: unknown[] = [];
      if (projectId) {
        const { resumeHorizon } = await import('./horizon.js');
        horizon = resumeHorizon(store.listerHorizon(projectId));
        fabriques = store.listerFabriques(projectId).slice(0, 24);
      }
      return {
        nodeId: node.id,
        bapteme,
        metier,
        caste: casteDe(node.id),
        projectId,
        node: {
          id: node.id,
          status: node.status,
          plateforme: node.plateforme ?? null,
          agentType: node.agentType,
          ownerName: node.ownerName,
          running: node.running,
          maxConcurrency: node.maxConcurrency,
          lastSeen: node.lastSeen,
          /** Libellé technique d'inscription — PAS l'identité baptisée. */
          nameTechnique: node.name,
        },
        presences,
        tasks,
        requisitions: store.listerRequisitions({ nodeId: node.id, statut: 'ouverte' }),
        horizon,
        fabriques,
        atelier: await etatAtelier({ env: process.env }),
      };
    },
  );

  /**
   * Curseurs Rayon (ADR 0010 lot 6) — toutes les présences ouvertes + baptême.
   * Jeton de ruche UNIQUEMENT. Partage → 401 (pas d'identités actives).
   */
  app.get('/api/presences', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const rows = store.listerPresences();
    return {
      presences: rows.map((p) => {
        const b = store.lireBapteme(p.nodeId);
        return {
          nodeId: p.nodeId,
          /** Null si pas baptisée — le Rayon n'invente pas de prénom. */
          bapteme: b?.nom ?? null,
          chemin: p.chemin,
          outil: p.outil,
          toolUseId: p.toolUseId,
          taskId: p.taskId,
          constateA: p.constateA,
        };
      }),
    };
  });

  /**
   * Baptêmes (ADR 0010) — liste constatée pour les cartes nœud.
   * Jeton de ruche UNIQUEMENT. Partage → 401 (pas d'identités).
   */
  app.get('/api/baptemes', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return {
      baptemes: store.listerBaptemes().map((b) => ({
        nodeId: b.nodeId,
        nom: b.nom,
        baptiseA: b.baptiseA,
      })),
    };
  });

  /** La Reine baptise — geste humain, jeton de ruche uniquement. */
  app.post<{ Body: { nodeId: string; nom: string } }>(
    '/api/baptemes',
    {
      schema: {
        body: {
          type: 'object',
          required: ['nodeId', 'nom'],
          additionalProperties: false,
          properties: {
            nodeId: { type: 'string', minLength: 1, maxLength: 64 },
            nom: { type: 'string', minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const verdict = store.baptiser(req.body.nodeId, req.body.nom);
      if (!verdict.ok) {
        return reply.code(400).send({ error: expliquerRefusBapteme(verdict.motif) });
      }
      emitEvent('bapteme_pose', { nodeId: req.body.nodeId, nom: verdict.nom });
      return { ok: true, nodeId: req.body.nodeId, nom: verdict.nom };
    },
  );

  app.delete<{ Params: { nodeId: string } }>('/api/baptemes/:nodeId', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    if (!store.getNode(req.params.nodeId)) {
      return reply.code(404).send({ error: 'ouvrière inconnue' });
    }
    const ok = store.debaptiser(req.params.nodeId);
    if (!ok) return reply.code(404).send({ error: 'aucun baptême à retirer' });
    emitEvent('bapteme_retire', { nodeId: req.params.nodeId });
    return { ok: true };
  });

  /** Métiers de cycle assignés — lecture constatée. */
  app.get('/api/metiers', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return {
      metiers: store.listerMetiers(),
      catalogue: METIERS,
    };
  });

  /** La Reine assigne un métier de cycle — liste fermée. */
  app.post<{ Body: { nodeId: string; metier: string } }>(
    '/api/metiers',
    {
      schema: {
        body: {
          type: 'object',
          required: ['nodeId', 'metier'],
          additionalProperties: false,
          properties: {
            nodeId: { type: 'string', minLength: 1, maxLength: 64 },
            metier: { type: 'string', minLength: 1, maxLength: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const verdict = store.assignerMetier(req.body.nodeId, req.body.metier);
      if (!verdict.ok) {
        return reply.code(400).send({ error: expliquerRefusMetier(verdict.motif) });
      }
      emitEvent('metier_assigne', {
        nodeId: req.body.nodeId,
        metier: verdict.metier,
      });
      return { ok: true, nodeId: req.body.nodeId, metier: verdict.metier };
    },
  );

  /**
   * Réquisitions (ADR 0010 lot 7) — besoins ouverts / historiques récents.
   * Jeton de ruche uniquement. Aucun secret dans le corps.
   */
  app.get('/api/requisitions', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const q = req.query as { statut?: string; nodeId?: string };
    const statut =
      q.statut === 'ouverte' || q.statut === 'accordee' || q.statut === 'refusee'
        ? q.statut
        : undefined;
    const rows = store.listerRequisitions({
      ...(typeof q.nodeId === 'string' ? { nodeId: q.nodeId } : {}),
      ...(statut ? { statut } : {}),
    });
    return {
      requisitions: rows.map((r) => ({
        ...r,
        bapteme: store.lireBapteme(r.nodeId)?.nom ?? null,
      })),
    };
  });

  // Catalogue + pose proactive de clés API Queen (OpenRouter, Anthropic…).
  // Même doctrine que le grant HITL : secret uniquement dans `.env`, jamais
  // en base. Présence = booléen, jamais la valeur.
  app.get('/api/queen/cles', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    return {
      fournisseurs: FOURNISSEURS_CLE.map((f) => ({
        id: f.id,
        libelleFr: f.libelleFr,
        libelleEn: f.libelleEn,
        envVar: f.envVar,
        hintFr: f.hintFr,
        hintEn: f.hintEn,
      })),
      presence: presenceClesCatalogue(cheminEnvQueen),
    };
  });

  app.post<{
    Body: { secret: string; envVar: string; libelle?: string };
  }>(
    '/api/queen/cles',
    {
      schema: {
        body: {
          type: 'object',
          required: ['secret', 'envVar'],
          additionalProperties: false,
          properties: {
            secret: { type: 'string', minLength: 1, maxLength: 512 },
            envVar: { type: 'string', minLength: 1, maxLength: 64 },
            libelle: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const vs = validerSecretRequisition(req.body.secret);
      if (!vs.ok) {
        return reply.code(400).send({ error: vs.motif, message: expliquerRefusSecret(vs.motif) });
      }
      const nom = req.body.envVar.trim();
      if (!estNomEnvValide(nom) || !estEnvQueenAutorisee(nom)) {
        return reply.code(400).send({ error: 'env_invalide' });
      }
      const libelle = (req.body.libelle ?? nom).trim() || nom;
      try {
        poserCleQueenEnv(
          cheminEnvQueen,
          nom,
          vs.secret,
          `Clé ${libelle} (posée depuis la Chambre)`,
        );
        process.env[nom] = vs.secret;
      } catch {
        return reply.code(500).send({ error: 'ecriture_env' });
      }
      emitEvent('queen_cle_posee', { envVar: nom, libelle });
      return { ok: true, envVar: nom };
    },
  );

  app.post<{
    Body: { nodeId: string; genre: string; libelle: string; detail?: string };
  }>(
    '/api/requisitions',
    {
      schema: {
        body: {
          type: 'object',
          required: ['nodeId', 'genre', 'libelle'],
          additionalProperties: false,
          properties: {
            nodeId: { type: 'string', minLength: 1, maxLength: 64 },
            genre: { type: 'string', minLength: 1, maxLength: 40 },
            libelle: { type: 'string', minLength: 1, maxLength: 200 },
            detail: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const v = store.ouvrirRequisition(
        req.body.nodeId,
        req.body.genre,
        req.body.libelle,
        req.body.detail ?? null,
      );
      if (!v.ok) {
        return reply.code(400).send({ error: v.motif });
      }
      emitEvent('requisition_ouverte', {
        id: v.id,
        nodeId: req.body.nodeId,
        genre: v.genre,
        libelle: v.libelle,
      });
      return { ok: true, id: v.id, genre: v.genre, libelle: v.libelle };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { decision: 'accordee' | 'refusee'; secret?: string; envVar?: string };
  }>(
    '/api/requisitions/:id/repondre',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
        },
        body: {
          type: 'object',
          required: ['decision'],
          additionalProperties: false,
          properties: {
            decision: { type: 'string', enum: ['accordee', 'refusee'] },
            secret: { type: 'string', minLength: 1, maxLength: 512 },
            envVar: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const cur = store.lireRequisition(req.params.id);
      if (!cur) return reply.code(404).send({ error: 'inconnue' });

      // Valider AVANT la transition ; écrire APRÈS. Sinon : (a) une réquisition
      // déjà close réécrit le .env puis 409 ; (b) une transition « accordée »
      // sans secret valide laisse une réquisition close sans clé.
      let secretValide: string | undefined;
      let nomEnv: string | undefined;
      if (req.body.decision === 'accordee' && cur.genre === 'cle_api') {
        const vs = validerSecretRequisition(req.body.secret);
        if (!vs.ok) {
          return reply.code(400).send({ error: vs.motif, message: expliquerRefusSecret(vs.motif) });
        }
        const derive = nomEnvDepuisLibelle(cur.libelle);
        if (req.body.envVar !== undefined && req.body.envVar !== derive) {
          return reply.code(400).send({ error: 'env_refuse', attendu: derive });
        }
        if (!estNomEnvValide(derive) || !estEnvQueenAutorisee(derive)) {
          return reply.code(400).send({ error: 'env_invalide' });
        }
        secretValide = vs.secret;
        nomEnv = derive;
      }

      const v = store.repondreRequisition(req.params.id, req.body.decision);
      if (!v.ok) {
        const code = v.motif === 'inconnue' ? 404 : 409;
        return reply.code(code).send({ error: v.motif });
      }

      let envPose: string | undefined;
      if (secretValide && nomEnv) {
        try {
          poserCleQueenEnv(
            cheminEnvQueen,
            nomEnv,
            secretValide,
            `Réquisition ${cur.libelle} (accordée depuis la Chambre)`,
          );
          process.env[nomEnv] = secretValide;
          envPose = nomEnv;
        } catch {
          return reply.code(500).send({ error: 'ecriture_env' });
        }
      }
      // La clé reste chez la Queen / Intendance — on constate la décision, pas le secret.
      emitEvent('requisition_reponse', {
        id: req.params.id,
        statut: v.statut,
        ...(envPose ? { envVar: envPose } : {}),
      });
      const ws = nodeSockets.get(cur.nodeId);
      if (ws) {
        send(ws, {
          type: 'requisition_result',
          id: req.params.id,
          statut: v.statut,
        });
      }
      return { ok: true, statut: v.statut, ...(envPose ? { envVar: envPose } : {}) };
    },
  );

  // ─── Fabrique / Horizon / Motifs (ADR 0010 lots 8–10) ───────────────────────

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/fabriques',
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      return { fabriques: store.listerFabriques(req.params.projectId) };
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: {
      genre: string;
      libelle: string;
      nomScript?: string;
      nodeId?: string;
      creerTache?: boolean;
    };
  }>(
    '/api/projects/:projectId/fabriques',
    {
      schema: {
        body: {
          type: 'object',
          required: ['genre', 'libelle'],
          additionalProperties: false,
          properties: {
            genre: { type: 'string', minLength: 1, maxLength: 40 },
            libelle: { type: 'string', minLength: 1, maxLength: 200 },
            nomScript: { type: 'string', maxLength: 80 },
            nodeId: { type: 'string', maxLength: 64 },
            creerTache: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const projectId = req.params.projectId;
      if (!store.getProject(projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const { promptFabrique, validerGenreFabrique } = await import('./fabrique.js');
      const g = validerGenreFabrique(req.body.genre);
      if (!g.ok) return reply.code(400).send({ error: g.motif });
      let taskId: string | undefined;
      if (req.body.creerTache !== false) {
        const prompt = promptFabrique({
          genre: g.genre,
          libelle: req.body.libelle,
          nomScript: req.body.nomScript,
        });
        const task = store.createTask({
          projectId,
          title: `Fabrique : ${req.body.libelle}`.slice(0, 120),
          prompt,
        });
        store.patchTask(task.id, { status: 'ready' });
        taskId = task.id;
      }
      const v = store.ouvrirFabrique(projectId, req.body.genre, req.body.libelle, {
        nodeId: req.body.nodeId,
        nomScript: req.body.nomScript,
        taskId,
      });
      if (!v.ok) return reply.code(400).send({ error: v.motif });
      return { ok: true, id: v.id, taskId: taskId ?? null };
    },
  );

  app.post<{
    Params: { projectId: string; id: string };
    Body: { statut: 'en_revue' | 'mergee' | 'refusee' };
  }>(
    '/api/projects/:projectId/fabriques/:id/statut',
    {
      schema: {
        body: {
          type: 'object',
          required: ['statut'],
          additionalProperties: false,
          properties: {
            statut: { type: 'string', enum: ['en_revue', 'mergee', 'refusee'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const v = store.poserStatutFabrique(req.params.id, req.body.statut);
      if (!v.ok) {
        const code = v.motif === 'inconnue' ? 404 : 409;
        return reply.code(code).send({ error: v.motif });
      }
      return { ok: true, statut: req.body.statut };
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { nomScript: string; scriptsMiroir: Record<string, string>; mergeLanded: boolean };
  }>(
    '/api/projects/:projectId/fabriques/juger-chantier',
    {
      schema: {
        body: {
          type: 'object',
          required: ['nomScript', 'scriptsMiroir', 'mergeLanded'],
          additionalProperties: false,
          properties: {
            nomScript: { type: 'string', minLength: 1, maxLength: 80 },
            scriptsMiroir: { type: 'object' },
            mergeLanded: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const { jugerFabriqueAvantChantier } = await import('./fabrique.js');
      const scripts = req.body.scriptsMiroir ?? {};
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(scripts)) {
        if (typeof k === 'string' && typeof v === 'string') clean[k] = v;
      }
      return jugerFabriqueAvantChantier({
        nomScript: req.body.nomScript,
        scriptsMiroir: clean,
        mergeLanded: req.body.mergeLanded === true,
      });
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/horizon',
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const { resumeHorizon } = await import('./horizon.js');
      const entrees = store.listerHorizon(req.params.projectId);
      return { ...resumeHorizon(entrees), entrees };
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { kind: string; texte: string; source?: string };
  }>(
    '/api/projects/:projectId/horizon',
    {
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'texte'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', minLength: 1, maxLength: 20 },
            texte: { type: 'string', minLength: 1, maxLength: 500 },
            source: { type: 'string', maxLength: 80 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const v = store.ajouterHorizon(
        req.params.projectId,
        req.body.kind,
        req.body.texte,
        req.body.source ?? 'reine',
      );
      if (!v.ok) {
        const code = v.motif === 'projet_inconnu' ? 404 : 400;
        return reply.code(code).send({ error: v.motif });
      }
      return { ok: true, entree: v.entree };
    },
  );

  app.get('/api/motifs', async (req, reply) => {
    if (!authorized(req)) return reject(reply);
    const { MOTIFS } = await import('./motifs.js');
    return {
      motifs: MOTIFS.map((m) => ({
        id: m.id,
        domaine: m.domaine,
        libelleFr: m.libelleFr,
        libelleEn: m.libelleEn,
        etapes: m.etapes.map((e) => ({ id: e.id, titreFr: e.titreFr, titreEn: e.titreEn })),
      })),
    };
  });

  app.post<{
    Params: { projectId: string; motifId: string };
    Body: { lang?: string; corps?: string };
  }>(
    '/api/projects/:projectId/motifs/:motifId/appliquer',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lang: { type: 'string', enum: ['fr', 'en'] },
            corps: { type: 'string', maxLength: 50_000 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const { appliquerMotif } = await import('./motifs.js');
      const lang = req.body?.lang === 'en' ? 'en' : 'fr';
      const v = appliquerMotif(req.params.motifId, lang, req.body?.corps);
      if (!v.ok) {
        const code = v.motif === 'diff_interdit' ? 400 : 404;
        return reply.code(code).send({ error: v.motif });
      }
      const taskIds: string[] = [];
      let prevId: string | undefined;
      for (const titre of v.titres) {
        const task = store.createTask({
          projectId: req.params.projectId,
          title: titre.slice(0, 120),
          prompt:
            `Motif « ${v.motif.id} » — étape ordonnée.\n\n${titre}\n\n` +
            `Ne collez pas le diff d'un autre dépôt. Procédure uniquement.`,
          dependsOn: prevId ? [prevId] : [],
        });
        store.patchTask(task.id, { status: prevId ? 'pending' : 'ready' });
        taskIds.push(task.id);
        prevId = task.id;
      }
      return { ok: true, motifId: v.motif.id, taskIds, titres: v.titres };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/motifs/perso',
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      if (!store.getProject(req.params.projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      return { motifs: store.listerMotifsProjet(req.params.projectId) };
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { libelle: string; etapes: string[] };
  }>(
    '/api/projects/:projectId/motifs/perso',
    {
      schema: {
        body: {
          type: 'object',
          required: ['libelle', 'etapes'],
          additionalProperties: false,
          properties: {
            libelle: { type: 'string', minLength: 1, maxLength: 120 },
            etapes: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'string', minLength: 1, maxLength: 200 },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const projectId = req.params.projectId;
      if (!store.getProject(projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const { expliquerRefusMotifPerso } = await import('./motifs.js');
      const v = store.creerMotifProjet(projectId, req.body.libelle, req.body.etapes);
      if (!v.ok) {
        return reply.code(400).send({ error: v.motif, message: expliquerRefusMotifPerso(v.motif) });
      }
      return { ok: true, id: v.id, libelle: v.libelle, etapes: v.etapes };
    },
  );

  app.post<{ Params: { projectId: string; motifId: string } }>(
    '/api/projects/:projectId/motifs/perso/:motifId/appliquer',
    async (req, reply) => {
      if (!authorized(req)) return reject(reply);
      const projectId = req.params.projectId;
      if (!store.getProject(projectId)) {
        return reply.code(404).send({ error: 'projet inconnu' });
      }
      const m = store.lireMotifProjet(req.params.motifId);
      if (!m || m.projectId !== projectId) {
        return reply.code(404).send({ error: 'inconnu' });
      }
      const taskIds: string[] = [];
      let prevId: string | undefined;
      for (const titre of m.etapes) {
        const task = store.createTask({
          projectId,
          title: titre.slice(0, 120),
          prompt:
            `Procédure « ${m.libelle} » — étape ordonnée.\n\n${titre}\n\n` +
            `Ne collez pas le diff d'un autre dépôt. Procédure uniquement.`,
          dependsOn: prevId ? [prevId] : [],
        });
        store.patchTask(task.id, { status: prevId ? 'pending' : 'ready' });
        taskIds.push(task.id);
        prevId = task.id;
      }
      return { ok: true, motifId: m.id, taskIds, titres: m.etapes };
    },
  );

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
      // Une invitation vers une adresse sur laquelle on n'écoute pas ne mène
      // nulle part : on la fabrique quand même (l'hôte peut avoir un routage
      // qu'on ignore), mais on ne la laisse plus passer pour joignable.
      const injoignable = inviteInjoignable(config.host, wsUrl);
      return {
        invite,
        url: wsUrl,
        label,
        joinCommand: `npm run join -- ${invite}`,
        ...(injoignable ? { injoignable } : {}),
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
      const wsUrl = body.url ?? config.publicUrl ?? dete…35630 tokens truncated…(ws, {
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
      const repoUrl = req.body.repoUrl;
      const cheminLocalAdmin =
        repoUrl !== undefined && isValidLocalRepoPath(repoUrl) && roleDe(req)?.role === 'admin';
      if (repoUrl !== undefined && !isValidRemoteRepoUrl(repoUrl) && !cheminLocalAdmin) {
        return reply.code(400).send({
          error:
            'repoUrl invalide : une URL Git distante est requise ; un chemin local est réservé à un administrateur',
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
      // Filet avant la retouche : patch inverse (apres → avant) pour pouvoir
      // restaurer l'état d'origine une fois l'ouvrière appliquée — via une
      // tâche, jamais un rewrite silencieux.
      const cheminRel = req.body.chemin.replace(/^\.?\//, '').trim() || req.body.chemin;
      store.creerSauvegarde({
        projectId: project.id,
        taskId: tache.id,
        label: libelleAvantRetouche(cheminRel, (fr) => fr),
        kind: 'avant_retouche',
        patch: patchVers(cheminRel, req.body.apres, req.body.avant),
      });
      emitEvent('retouche_proposee', {
        projectId: project.id,
        taskId: tache.id,
        chemin: req.body.chemin,
        parUserId: userId,
      });
      return reply.code(201).send({ task: tache });
    },
  );

  // ─── Timeline de sauvegardes (code récupérable) ────────────────────────────
  //
  // Les étapes auto naissent dans insertResult. Ici : lister, lire un patch,
  // poser une sauvegarde manuelle, restaurer via une tâche (jamais un rewrite
  // silencieux du dépôt).

  app.get<{ Params: { projectId: string }; Querystring: { limit?: number } }>(
    '/api/projects/:projectId/sauvegardes',
    async (req, reply) => {
      const project = projetLisible(req, reply);
      if (!project) return reply;
      const limit =
        typeof req.query.limit === 'number' && Number.isFinite(req.query.limit)
          ? req.query.limit
          : 50;
      return reply.send({ sauvegardes: store.listSauvegardes(project.id, limit) });
    },
  );

  app.get<{ Params: { projectId: string; sauvegardeId: string } }>(
    '/api/projects/:projectId/sauvegardes/:sauvegardeId',
    async (req, reply) => {
      const project = projetLisible(req, reply);
      if (!project) return reply;
      const s = store.getSauvegarde(req.params.sauvegardeId);
      if (!s || s.projectId !== project.id) {
        return reply.code(404).send({ error: 'sauvegarde introuvable' });
      }
      return reply.send({ sauvegarde: s });
    },
  );

  app.post<{ Params: { projectId: string }; Body: { label: string; patch?: string } }>(
    '/api/projects/:projectId/sauvegardes',
    {
      schema: {
        body: {
          type: 'object',
          required: ['label'],
          additionalProperties: false,
          properties: {
            label: { type: 'string', minLength: 2, maxLength: 120 },
            patch: { type: 'string', maxLength: LIMITS.diff },
          },
        },
      },
    },
    async (req, reply) => {
      if (!authorizedUser(req) && !authorized(req)) {
        return reply.status(401).send({ error: 'Non authentifié' });
      }
      const project = projetLisible(req, reply);
      if (!project) return reply;
      if (!libelleManuelValide(req.body.label)) {
        return reply.code(400).send({ error: 'libellé invalide' });
      }
      const s = store.creerSauvegarde({
        projectId: project.id,
        label: req.body.label,
        kind: 'manuel',
        patch: req.body.patch ?? '',
      });
      emitEvent('sauvegarde_creee', {
        projectId: project.id,
        sauvegardeId: s.id,
        kind: s.kind,
      });
      return reply.code(201).send({
        sauvegarde: {
          id: s.id,
          projectId: s.projectId,
          label: s.label,
          kind: s.kind,
          taille: s.patch.length,
          createdAt: s.createdAt,
        },
      });
    },
  );

  app.post<{ Params: { projectId: string; sauvegardeId: string } }>(
    '/api/projects/:projectId/sauvegardes/:sauvegardeId/restaurer',
    async (req, reply) => {
      if (!authorizedUser(req) && !authorized(req)) {
        return reply.status(401).send({ error: 'Non authentifié' });
      }
      const project = projetLisible(req, reply);
      if (!project) return reply;
      const s = store.getSauvegarde(req.params.sauvegardeId);
      if (!s || s.projectId !== project.id) {
        return reply.code(404).send({ error: 'sauvegarde introuvable' });
      }
      if (!s.patch.trim()) {
        return reply.code(409).send({
          error: 'cette sauvegarde n’a pas de patch à restaurer',
        });
      }
      const tache = store.createTask({
        projectId: project.id,
        title: `Restaurer — ${s.label}`.slice(0, LIMITS.name),
        prompt: promptRestauration(s),
      });
      emitEvent('sauvegarde_restauration', {
        projectId: project.id,
        sauvegardeId: s.id,
        taskId: tache.id,
      });
      return reply.code(201).send({ task: tache, sauvegardeId: s.id });
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
  // loupe : équivalent — && → ||. Le repli `config.port` est INATTEIGNABLE
  // ici : `listen({ port, host })` rend toujours un `AddressInfo`, jamais une
  // chaîne (ce serait une socket Unix, que ce code ne demande jamais) ni
  // `null` (le `await` vient de réussir). La garde reste, parce que le type
  // l'exige ; la branche qu'elle protège n'est pas jouable.
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
              // Les constats d'outils, même régime : `estOutilsConstates` les a
              // déjà bornés et RECONSTRUITS champ par champ, donc rien d'autre
              // que `agent`/`binaire`/`cle` n'arrive ici. Le hub les RANGE ; il
              // n'en tire aucune conclusion — croiser un constat avec ce que la
              // ruche sait faire est le travail de `outils-du-noeud.ts`, à
              // l'affichage.
              ...(msg.outils !== undefined ? { outils: msg.outils } : {}),
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
            scheduler.handleTaskUpdate(nodeId, msg.taskId, msg.subAgents, msg.log, msg.presences);
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
          case 'requisition_open': {
            const v = store.ouvrirRequisition(
              nodeId,
              msg.genre,
              msg.libelle,
              msg.detail ?? null,
              msg.taskId ?? null,
            );
            if (!v.ok) {
              send(ws, {
                type: 'error',
                message: expliquerRefusRequisition(v.motif),
              });
              break;
            }
            emitEvent('requisition_ouverte', {
              id: v.id,
              nodeId,
              genre: v.genre,
              libelle: v.libelle,
            });
            send(ws, {
              type: 'requisition_ack',
              id: v.id,
              genre: v.genre,
              libelle: v.libelle,
            });
            stateDirty = true;
            break;
          }
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
            // ─── L'APPARTENANCE, COMME POUR UNE TÂCHE ──────────────────────
            //
            // `task_result` ignore un résultat dont `assignedNodeId !== nodeId`
            // (scheduler.ts) ; ce chemin-ci ne le faisait pas. La seule défense
            // était alors le SECRET du `mergeId` — un `randomUUID` envoyé au
            // seul socket assigné, jamais diffusé aux nœuds. C'est vrai
            // aujourd'hui, mais faire reposer une appartenance sur un identifiant
            // secret, là où le reste de la ruche la VÉRIFIE, c'est un invariant
            // qui tient par accident. On l'aligne : un nœud qui n'est pas
            // l'assigné ne pose pas ce résultat, et surtout NE CONSOMME PAS le
            // pending — le vrai assigné peut encore livrer.
            if (pending.nodeId !== nodeId) {
              send(ws, {
                type: 'error',
                message: `merge ${msg.mergeId} non assigné à ce nœud — résultat ignoré`,
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
          case 'pose_result': {
            const attendue = pendingPoses.get(msg.poseId);
            if (!attendue) {
              // Même leçon que le chantier : une installation a peut-être eu
              // lieu sur la machine d'un membre. Si le hub ne la reconnaît
              // plus, il le DIT plutôt que de laisser le geste sans trace.
              send(ws, {
                type: 'error',
                message: `pose ${msg.poseId} inconnue du hub — résultat ignoré`,
              });
              emitEvent('outil_pose_ignoree', { poseId: msg.poseId, nodeId });
              break;
            }
            // Un nœud ne rend pas le résultat d'une pose demandée à un autre.
            if (attendue.nodeId !== nodeId) {
              send(ws, {
                type: 'error',
                message: `pose ${msg.poseId} non demandée à ce nœud — résultat ignoré`,
              });
              emitEvent('outil_pose_usurpee', { poseId: msg.poseId, nodeId });
              break;
            }
            pendingPoses.delete(msg.poseId);
            emitEvent('outil_pose_rendue', {
              poseId: msg.poseId,
              nodeId,
              outilId: msg.outilId,
              ok: msg.ok,
              code: msg.code,
              ...(msg.refuse === undefined ? {} : { refuse: msg.refuse }),
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
            // Même appartenance que pour le merge (voir merge_result) : un nœud
            // non assigné n'écrit pas ce résultat et ne consomme pas le pending.
            if (pending.nodeId !== nodeId) {
              send(ws, {
                type: 'error',
                message: `chantier ${msg.chantierId} non assigné à ce nœud — résultat ignoré`,
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
   * Les tâches dont on a DÉJÀ dit qu'elles sortaient du domaine connu.
   *
   * Le tick repasse toutes les quelques secondes. Sans cette mémoire, la même
   * tâche déclencherait le même avertissement des centaines de fois, et la
   * Chronique se remplirait d'une seule nouvelle jusqu'à noyer tout le reste.
   * Un signal répété cesse d'être un signal.
   *
   * Bornée par les tâches encore en vol (purge dans le tick) : sinon elle
   * grandirait sans fin dans un processus qui tourne des mois.
   */
  const horsDomaineDits = new Set<string>();

  /**
   * La note de l'horloge : quand elle a été recalculée, et ce qu'elle a dit.
   *
   * `null` tant que rien n'a été émis — distinct de `'trop_peu'`, qui est un
   * verdict à part entière et mérite d'être inscrit une fois : savoir que la
   * ruche n'avait PAS ENCORE de quoi se noter fait partie de son histoire.
   *
   * Deux scalaires, jamais une collection : rien à élaguer ici.
   */
  let calibrationVueA = 0;
  let calibrationDite: Calibration['verdict'] | null = null;
  let calibrationDiteA = 0;

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
      // ─── L'HORLOGE ALERTE : cette tâche est SORTIE du domaine connu ──────
      //
      // Elle court depuis plus longtemps que TOUT ce que la ruche a observé.
      // Ce n'est pas « presque fini » — c'est qu'il n'existe plus une seule
      // observation comparable, donc plus rien à estimer. L'instant précis où
      // un humain a besoin d'être prévenu, et celui où un compte à rebours
      // afficherait « bientôt » avec aplomb.
      //
      // UNE SEULE FOIS PAR TÂCHE. Le tick repasse toutes les quelques
      // secondes ; sans mémoire, la Chronique se remplirait du même
      // avertissement jusqu'à noyer tout le reste — un signal répété cesse
      // d'être un signal.
      {
        const histoire = store.historiqueDurees();
        for (const enVol of store.tachesEnVolAnnoncees()) {
          if (horsDomaineDits.has(enVol.taskId)) continue;
          const reste = resteEstime(histoire, maintenant - enVol.faiteA, { caste: enVol.caste });
          if (reste.connu || reste.motif !== 'hors_domaine') continue;
          horsDomaineDits.add(enVol.taskId);
          emitEvent('duree_hors_domaine', {
            taskId: enVol.taskId,
            nodeId: enVol.nodeId,
            ecouleMs: maintenant - enVol.faiteA,
            recordMs: reste.recordMs,
          });
        }
        // Bornée par les tâches ENCORE en vol : une tâche qui atterrit oublie
        // son avertissement, et le redonnerait donc si elle repartait. Sans
        // cette purge, la carte grandirait sans fin dans un processus qui
        // tourne des mois — la même borne que `contextesRelivres` au-dessus.
        if (horsDomaineDits.size > 0) {
          const encore = new Set(store.tachesEnVolAnnoncees().map((t) => t.taskId));
          for (const id of horsDomaineDits) if (!encore.has(id)) horsDomaineDits.delete(id);
        }
      }

      // ─── L'HORLOGE SE NOTE ELLE-MÊME ──────────────────────────────────────
      //
      // C'est la pièce qui rend tout le reste utilisable. Sans elle, un
      // intervalle n'est qu'un chiffre plus large — donc plus difficile à
      // prendre en défaut, ce qui n'est PAS la même chose qu'être juste.
      //
      // On n'émet QUE sur changement de verdict, ou au rappel : un verdict
      // répété toutes les cinq minutes noierait la Chronique, et un verdict
      // jamais redit sortirait de la fenêtre du journal pour n'y plus revenir.
      //
      // La note ne compte que les annonces CHIFFRÉES — `annoncesJugees` écarte
      // le socle « aucun », dont le `p80Ms` vaut 0. Sans cet écart, une ruche
      // neuve, qui n'annonce rien parce qu'elle n'a pas d'historique, se
      // déclarerait menteuse dès son premier jour.
      if (maintenant - calibrationVueA >= CALIBRATION_PERIODE_MS) {
        calibrationVueA = maintenant;
        const note = calibrer(store.annoncesJugees());
        const change = note.verdict !== calibrationDite;
        const rappel = maintenant - calibrationDiteA >= CALIBRATION_RAPPEL_MS;
        if (change || rappel) {
          calibrationDite = note.verdict;
          calibrationDiteA = maintenant;
          emitEvent('horloge_calibration', {
            verdict: note.verdict,
            n: note.n,
            // Trois décimales : au-delà, on afficherait une précision que
            // quarante observations ne portent pas.
            partTenue: Math.round(note.partTenue * 1000) / 1000,
            ecart: Math.round(note.ecart * 1000) / 1000,
            change,
          });
        }
      }

      store.pruneEvents(EVENT_RETENTION);
      store.pruneMemories(MEMORY_RETENTION);
      store.pruneResults(RESULT_RETENTION);
      store.pruneSauvegardes(SAUVEGARDES_RETENTION);
      store.pruneGardiennes(GARDIENNES_RETENTION);
      store.pruneLivraisons(LIVRAISONS_RETENTION);
      // Présences Rayon orphelines (outil jamais refermé / nœud parti).
      store.prunePresences(PRESENCES_RETENTION_MS);
      // Réquisitions closes trop vieilles (les ouvertes restent).
      store.pruneRequisitions(REQUISITIONS_RETENTION_MS);
      store.pruneFabriques(REQUISITIONS_RETENTION_MS);
      store.pruneHorizon(HORIZON_RETENTION_MS);
      // L'annonce est la moitié PÉRISSABLE du couple : `pruneResults` vide des
      // colonnes mais ne supprime pas de ligne, donc `durationMs` survit.
      store.pruneAnnonces(ANNONCES_RETENTION_MS);
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
      // Horloge : sessions ouvertes dont la tâche a disparu. APRÈS pruneTasks.
      store.pruneHorlogeHote();
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
      // L'Agent Garde-Fous : l'échelon posé par tâche et l'exigence par production
      // — deux bornes référentielles jumelles, câblées avec leurs tables (règle 3)
      // et placées APRÈS `pruneTasks`, comme celle de l'Aiguillage juste au-dessus.
      store.pruneGardeFouEchelons();
      store.pruneGardeFouExigences();
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
