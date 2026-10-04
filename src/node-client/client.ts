// Client de nœud membre : rejoint la ruche en WebSocket, reçoit des tâches
// poussées par l'orchestrateur, les exécute via un AgentAdapter dans un
// workspace isolé, remonte progrès et résultats. Reconnexion automatique
// avec backoff exponentiel ; heartbeat découplé de l'exécution.
// Consentement (§5.3) : rien ne s'exécute tant que le membre n'a pas lancé
// ce client lui-même.

import { mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { getAdapter } from '../adapters/index.js';
import type { Effort } from '../shared/effort.js';
import type {
  AdapterContext,
  AdapterProgress,
  AdapterResult,
  AgentAdapter,
} from '../adapters/index.js';
import { ligneDInfra } from '../adapters/exec.js';
import { borneTexteFinal } from '../adapters/texte-final.js';
import {
  agentBinairePresent,
  estAgentType,
  requisitionSiCredentialsManquantes,
} from './agent-detect.js';
import type { AgentType } from './agent-detect.js';
import { binaireMcpDansBac } from './bac.js';
import { creerCaviardeur, SECRET_CAVIARDE, valeursSecretes } from '../shared/caviardage.js';
import type { Caviardeur } from '../shared/caviardage.js';
import { arbresEteints, GRACE_ARRET_MS } from '../shared/arbre-processus.js';
import { argvDe, jugerChantier } from '../shared/chantier.js';
import { CHANTIER_EXECUTION_MS, CHANTIER_PREPARATION_MS } from '../shared/butoirs-noeud.js';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { jugerPreparation } from '../shared/preparation.js';
import { isOnShift, minutesUntilOpen, nightShiftFromEnv } from '../shared/night-shift.js';
import type { NightShiftPolicy } from '../shared/night-shift.js';
import { estOrdreArret } from '../shared/demarrage.js';
import { plateformeDepuis } from '../shared/machine.js';
import { laverIdentifiantsDuTexte } from '../shared/projet-public.js';
import { ligneArretBudgetaire, usdDeMicros } from '../shared/arret-budgetaire.js';
import { ID_PATTERN, LIMITS, parseServerMessage } from '../shared/protocol.js';
import type {
  AssignChantierMsg,
  AssignMergeMsg,
  AssignTaskMsg,
  ClientMessage,
  DelegationBudget,
  DelegationAcceptedMsg,
  DelegationRejectedMsg,
  DelegationResultMsg,
  OutilConstate,
  PoserOutilMsg,
  TaskResultMsg,
} from '../shared/protocol.js';
import {
  DEFAULT_TOKEN,
  HEARTBEAT_INTERVAL_MS,
  MIN_TOKEN_LENGTH,
  NODE_TIMEOUT_MS,
} from '../shared/types.js';
import type { ExecutionUsage, IsolementDeclare, SubAgent, Task } from '../shared/types.js';
import { runMerge, runProc } from './merge-runner.js';
import { lancerVraiment, poserOutil } from './pose-runner.js';
import {
  DossierDeTacheIneffacable,
  buildSandboxEnv,
  cloneRepo,
  effacerDossier,
  prepareWorkspace,
} from './workspace.js';
import { racineDeTravailParDefaut } from './identite-noeud.js';
import { segmentSur } from '../shared/noms-windows.js';
import { ConfigurationNonNeutralisable, noteConfigurationEcartee } from './configuration-inerte.js';
import { motifLave } from './livraison-locale.js';
import { pousseeConsentie } from '../shared/livraison-locale.js';
import {
  requisitionDepuisEchecInfra,
  type RequisitionDepuisInfra,
} from '../shared/requisition-infra.js';
import {
  classerActionProposee,
  decisionActionParNiveau,
  type ActionProposee,
  type DecisionAction,
  type NiveauAutonomie,
} from '../shared/politique-actions.js';
import { texteDEchec } from '../shared/texte-d-echec.js';
import { motifRefusPresence, refuseParPresence } from '../shared/presence-noeud.js';
import type { BacExecution, ReseauBac } from './isolement.js';
import { bilanRefus, ouvrirReseauTache, refusExige } from './reseau-tache.js';
import type { CapaciteReseau, ReseauTache } from './reseau-tache.js';
import { NIVEAU_RESEAU_DEFAUT } from '../shared/reseau.js';
import type { NiveauReseau } from '../shared/reseau.js';
import { balayerPontsOrphelins, RendezVousPont } from './rendez-vous-pont.js';
import type { Workspace } from './workspace.js';
import type {
  WorkerDelegationInput,
  WorkerDelegationOutcome,
  WorkerDelegationResult,
} from '../adapters/index.js';
import { capturerExecutionUsage, executionUsageDepuis } from './execution-usage.js';
import { VALIDATION_KEYS } from '../shared/validations-bac.js';
import type { ValidationsBac } from '../shared/validations-bac.js';
import { reglesAutorisationDeBase, validerProduction } from './validations-bac.js';

const MAX_PENDING_DELEGATIONS = 32;
/**
 * L'attente MAXIMALE d'une décision d'action (G12) quand l'ack du hub n'a PAS
 * porté d'échéance (hub plus ancien) : le plafond de la Chambre (dix minutes)
 * plus une marge de transport. Un hub muet — tombé, déconnecté — ne doit pas
 * suspendre l'outil de décision du CLI pour toujours : passé ce filet, le
 * nœud répond deny et le dit. Avec un `expiresAt` dans l'ack, le filet se
 * cale dessus (`GRACE_RELAIS_ECHEANCE_MS`) au lieu de ce délai figé.
 */
const ACTION_DECISION_MAX_MS = 12 * 60_000;
/** L'accusé d'ouverture d'une réquisition d'action : le même filet que la délégation. */
const ACTION_ACK_TIMEOUT_MS = 15_000;
/**
 * Marge (G12, revue) entre la décision et la MORT du CLI : le délai dur des
 * adaptateurs tue le processus entier, et une décision qui arriverait après
 * ne servirait personne. Le budget transmis au hub ET le filet local la
 * retranchent de l'échéance du run — sous cette marge, on ne demande rien.
 */
export const MARGE_DECISION_ACTION_MS = 30_000;
/** Le délai laissé au hub pour RELAYER sa propre expiration avant le filet local. */
const GRACE_RELAIS_ECHEANCE_MS = 15_000;
const MAX_ACCEPTED_DELEGATIONS = 128;
const DELEGATION_RESPONSE_TIMEOUT_MS = 15_000;
/**
 * La durée demandée est un budget de travail, pas une garantie de latence :
 * l'enfant peut attendre dans la file ou consommer des retries. On garde donc
 * une marge, tout en restant borné par le plafond de transport accepté.
 */
const DELEGATION_RESULT_GRACE_MS = 5 * 60_000;

/**
 * Un morceau de sortie en direct, après caviardage, sous `LIMITS.sortie`. Le
 * caviardage peut ALLONGER (`sk-x` devient `[secret]`) : couper à l'aveugle
 * ferait disparaître la fin sans le dire. On coupe à la dernière ligne entière
 * qui tient, et on l'annonce — comme `sortie-directe.ts` annonce ses omissions.
 */
function morceauCaviarde(sortie: string): string {
  if (sortie.length <= LIMITS.sortie) return sortie;
  const annonce = '[… fin du morceau omise après caviardage]\n';
  const tete = sortie.slice(0, LIMITS.sortie - annonce.length);
  const coupe = tete.lastIndexOf('\n');
  return (coupe >= 0 ? tete.slice(0, coupe + 1) : '') + annonce;
}

/**
 * Un champ caviardé, ramené sous la borne que le protocole lui impose.
 *
 * `Caviardeur.texte` peut ALLONGER : un motif plus court que `[secret]`
 * (`sk-v1`, `token=1`, `Basic x`) devient huit caractères. Or les adaptateurs
 * coupent déjà un nom de sous-agent PILE à `LIMITS.name` : caviardé, il la
 * dépassait, `isSubAgents` refusait le `task_result` ENTIER, et le hub fermait
 * la socket du nœud — résultat perdu, alors que le nœud le croyait livré. La
 * coupe recule au début d'un `[secret]` qu'elle traverserait : une moitié de
 * marque ne dit plus qu'un secret était là.
 */
function borneApresCaviardage(s: string, max: number): string {
  if (s.length <= max) return s;
  const marque = s.lastIndexOf(SECRET_CAVIARDE, max - 1);
  const coupe = marque >= 0 && marque + SECRET_CAVIARDE.length > max ? marque : max;
  return s.slice(0, coupe);
}

/**
 * Ce que l'adaptateur a DÉCLARÉ, tel que `task_result` le transporte : la
 * déclaration fournisseur et le texte final, reborné ici comme le diff et les
 * logs : le hub ABANDONNE un texte trop long (protocol.ts), mieux vaut lui en
 * envoyer la fin — là où l'agent conclut — que rien.
 *
 * Un seul endroit pour les deux chemins d'envoi — l'exécution ET la reprise
 * après réquisition. La reprise recopiait les champs à la main, et avait
 * oublié `fournisseur` : une tâche reprise perdait son coût déclaré.
 */
function declarationsDuResultat(
  result: AdapterResult,
  caviardeur: Caviardeur,
): Pick<TaskResultMsg, 'fournisseur' | 'finalText' | 'arretBudgetaire'> {
  // Caviardé AVANT d'être borné : la borne garde la fin, et une clé coupée
  // par elle ne serait plus reconnue. `reponse`, pas `texte` : le hub RELIT ce
  // texte (proposition d'éclaireuse, avis de conseil — voir `Caviardeur`).
  const finalText =
    result.finalText === undefined
      ? undefined
      : borneTexteFinal(caviardeur.reponse(result.finalText));
  return {
    ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
    ...(finalText ? { finalText } : {}),
    ...(result.arretBudgetaire ? { arretBudgetaire: result.arretBudgetaire } : {}),
  };
}

/**
 * Les logs que `task_result` transporte, caviardés puis bornés à leur TÊTE
 * (`LIMITS.log`) — mêmes deux chemins d'envoi que `declarationsDuResultat`.
 *
 * Une tentative ARRÊTÉE SUR SON PLAFOND les ouvre sur la ligne qui le dit
 * (`ligneArretBudgetaire`) : le hub et le pont MCP n'en gardent aussi que la
 * tête, et c'est là que le parent qui attend cet enfant la lit — la dépense,
 * le diff partiel s'il y en a un, et quoi faire. Écrite ICI, une fois le diff
 * connu : l'adaptateur, lui, ne voit pas le dépôt.
 */
function logsDuResultat(
  result: AdapterResult,
  diff: string,
  plafondMicros: number | undefined,
  caviardeur: Caviardeur,
): string {
  const tete =
    result.arretBudgetaire && plafondMicros !== undefined
      ? `${ligneArretBudgetaire({
          plafondMicros,
          coutUsd: result.fournisseur?.coutUsd,
          diffJoint: diff.trim() !== '',
        })}\n`
      : '';
  return caviardeur.texte(`${tete}${result.logs}`).slice(0, LIMITS.log);
}

export interface NodeClientOptions {
  /** URL WebSocket de l'orchestrateur, ex. ws://localhost:7777/ws */
  url: string;
  token: string;
  name: string;
  ownerName: string;
  /** shell | claude-code | codex (ou tout adaptateur injecté). */
  agentType: string;
  maxConcurrency: number;
  /**
   * Les modèles que ce nœud DÉCLARE pouvoir faire tourner (ex.
   * `['claude-opus-5', 'claude-fable-5']`), lus de `HIVE_MODELES`. Ce que
   * l'Aiguillage appris consomme pour choisir. Absent/vide : le nœud ne déclare
   * rien, et la ruche ordonnance comme avant.
   */
  modeles?: string[];
  /** Racine des workspaces de tâches (défaut : ./.hive-work/<name>). */
  workRoot?: string;
  /** Adaptateur injectable (tests, agents custom). */
  adapter?: AgentAdapter;
  /** Variables d'environnement à laisser passer dans la sandbox (secrets locaux). */
  keepEnv?: string[];
  /** Identité stable dans la ruche (sinon attribuée par l'orchestrateur). */
  nodeId?: string;
  /** Coupe les logs console (tests). */
  quiet?: boolean;
  /**
   * « Présence sans production » : ce poste rejoint la ruche pour SE MONTRER,
   * pas pour travailler. Aucun agent de codage réel n'a été trouvé dessus.
   *
   * C'est la SECONDE garde, et elle est délibérément redondante avec celle du
   * hub (`assignationProductionAutorisee`). Un hub d'une version plus ancienne,
   * ou une voie d'assignation qu'on aura oublié de filtrer, ne connaîtra pas la
   * règle. Le nœud, lui, la connaît toujours : c'est lui qui a constaté sa
   * propre machine.
   */
  presenceSeule?: boolean;
  /**
   * Bac à sable résolu par l'appelant (main.ts), ou absent.
   *
   * INJECTÉ plutôt que sondé ici : la sonde lance un binaire, et un test de
   * nœud n'a pas à découvrir podman sur la machine de qui fait tourner la
   * suite. C'est le même motif que `adapter`.
   */
  bac?: BacExecution;
  /**
   * Ce que le bac sait faire du réseau, MESURÉ au démarrage (`optionReseau`,
   * `sonderReseauFiltre`). Absent avec un bac : le réseau n'a pas été éprouvé,
   * et chaque tâche le dit au lieu de le filtrer. Injecté pour la même raison
   * que `bac`.
   */
  reseau?: CapaciteReseau;
  /**
   * Le bac à sable DÉCLARÉ au hub à l'inscription (`isolementDeclareDe`).
   * Affichage seulement ; absent, le hub dit « non déclaré ».
   */
  isolement?: IsolementDeclare;
  /**
   * Présence du binaire agent (tests / override). Défaut : sonde PATH réelle.
   * Sert à la reprise après Accorder `binaire` sans relancer un ENOENT immédiat.
   */
  verifierBinaireAgent?: () => Promise<boolean>;
  /**
   * Silence du hub au-delà duquel la connexion est tenue pour morte (ms).
   * Défaut : `NODE_TIMEOUT_MS`, le délai au bout duquel le hub, lui, tient le
   * nœud pour mort — les deux côtés renoncent au même rythme.
   */
  silenceMaxMs?: number;
  /** Cadence des pings de vie vers le hub (ms). Défaut : `HEARTBEAT_INTERVAL_MS`. */
  pingMs?: number;
  /**
   * L'opérateur consent-il à POUSSER les branches de mission avec les
   * identifiants git de cette machine ? Défaut : `HIVE_LIVRAISON_POUSSER=1`.
   *
   * Lu ICI, et non par chacun des deux points d'entrée (`main.ts`, `join.ts`) :
   * c'est la même raison que Night Shift. Deux lectures finissent par diverger,
   * et celle qui oublierait le réglage pousserait sans consentement.
   */
  pousseLivraisons?: boolean;
  /**
   * Appelée à CHAQUE inscription dans la ruche (reconnexions comprises), avec
   * l'empreinte publique que la Reine a remise — `null` si elle n'en envoie
   * pas. C'est ce qui permet à une machine qui se signale sur le réseau local
   * (`decouverte-noeud.ts`, `Signalement`) de se dire membre de SA ruche.
   * Une exception levée ici n'atteint jamais la boucle du nœud.
   */
  surInscription?: (faits: { ruche: string | null }) => void;
}

/**
 * Préfixe le contexte Hive Mind au prompt d'une tâche, pour l'agent. Le prompt
 * d'origine n'est JAMAIS tronqué : ce prompt augmenté reste local (exécuté par
 * l'adaptateur), il ne repart pas au hub — aucune contrainte de taille protocole.
 */
export function composeAgentPrompt(hiveContext: string | undefined, prompt: string): string {
  return hiveContext ? `${hiveContext}\n\n${prompt}` : prompt;
}

/**
 * SIGINT, SIGTERM, SIGHUP ET L'ORDRE DE LA RUCHE : LE MÊME ARRÊT, pour les deux
 * portes du nœud (`main.ts`, `join.ts`). Une seule copie : ces deux portes ont
 * déjà divergé plus d'une fois.
 *
 * SIGINT n'arrive que d'un terminal (Ctrl+C) ; ce qui SUPERVISE un nœud envoie
 * SIGTERM — `npm run ruche` à l'arrêt (`scripts/ruche.mjs`), systemd, launchd,
 * un `kill` nu. Sans gestionnaire, SIGTERM tuait le nœud net, sans `stop()`,
 * et l'agent en cours lui SURVIVAIT, orphelin, pour une tâche que la Reine
 * remettait déjà en file ailleurs (#468). SIGHUP, c'est le terminal qu'on
 * ferme : Node le laisse tuer le processus — même sous `nohup`, dont il rétablit
 * le défaut au démarrage (mesuré) —, et les agents, chefs de leur propre groupe
 * (`arbre-processus.ts`), ne le reçoivent plus avec lui. Il arrête donc le nœud
 * comme les deux autres.
 *
 * L'ORDRE DE LA RUCHE (`ORDRE_ARRET`, par le canal IPC) : sous Windows,
 * `kill('SIGTERM')` est un `TerminateProcess` — aucun gestionnaire ne tourne,
 * et c'est ainsi que la ruche arrêtait ses ouvrières. Elle leur envoie
 * désormais cet ordre, qui prend ce chemin-ci.
 *
 * `stop()` annule chaque tâche, merge et chantier : leurs ARBRES reçoivent
 * l'arrêt aussitôt (`lancerArbre`). On leur laisse la grâce d'en finir —
 * `docker run` relaie à son conteneur — puis le nœud sort, et ce qui tourne
 * encore est abattu avec lui (`arbresEteints`, reprise à la sortie).
 * `tests/noeud-arret-signal.test.ts` l'éprouve en vrais processus, petits-
 * enfants compris : SIGTERM sur les deux portes (POSIX), l'ordre de la ruche
 * sur les trois systèmes.
 *
 * CE QUE ÇA NE COUVRE PAS : un `kill -9` du nœud — voir l'en-tête
 * d'`arbre-processus.ts`.
 *
 * `finally` : si `stop()` levait, le nœud sort QUAND MÊME — un arrêt demandé
 * qui laisserait tourner le nœud serait pire que l'orphelin. Un second signal
 * pendant la grâce ne l'abrège pas : Ctrl+C sous `npm run ruche` en envoie
 * deux (le terminal, puis le lanceur).
 */
export function arreterSurSignaux(client: Pick<HiveNodeClient, 'stop'>): void {
  let enCours = false;
  const arreter = (): void => {
    if (enCours) return;
    enCours = true;
    console.log('\nDéconnexion de la ruche…');
    try {
      client.stop();
    } finally {
      const sortir = (): void => process.exit(0);
      void arbresEteints(GRACE_ARRET_MS).then(sortir, sortir);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, arreter);
  process.on('message', (message: unknown) => {
    if (estOrdreArret(message)) arreter();
  });
}

export class HiveNodeClient {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  /**
   * Les constats d'outils à joindre à l'inscription — posés par l'appelant,
   * jamais calculés ici.
   *
   * `null` tant que rien n'a été constaté, et c'est volontaire : un tableau
   * vide se lirait comme « aucun outil sur cette machine », alors que la vérité
   * serait « personne n'a regardé ». Deux silences différents, deux valeurs.
   */
  private outilsConstates: OutilConstate[] | null = null;

  /** Pose ce que le diagnostic a vu. Rejouable : une reconnexion le renvoie. */
  /**
   * Poser un outil parce que le hub l'a demandé.
   *
   * `dejaPose` vient du CONSTAT de ce nœud — ce qu'il a vu sur sa machine au
   * dernier recensement — et non d'une supposition du hub. Un constat absent
   * vaut « pas posé » : au pire on relance une installation idempotente, alors
   * que supposer l'inverse refuserait une pose légitime sans rien dire.
   *
   * Après une pose réussie, le constat local est rafraîchi pour que la fiche
   * cesse d'annoncer l'outil comme absent sans attendre le prochain
   * recensement.
   */
  private async runPoseOutil(msg: PoserOutilMsg): Promise<void> {
    const constat = this.outilsConstates?.find((o) => o.agent === msg.outilId);
    const resultat = await poserOutil(msg, {
      dejaPose: constat?.binaire === true,
      lancer: lancerVraiment,
    });
    if (resultat.ok && constat) constat.binaire = true;
    this.log(
      resultat.ok
        ? `outil posé : ${msg.outilId}`
        : `pose refusée (${msg.outilId}) : ${resultat.refuse ?? `code ${String(resultat.code)}`}`,
    );
    this.send(resultat);
  }

  setOutilsConstates(outils: readonly OutilConstate[]): void {
    this.outilsConstates = [...outils];
  }

  private readonly active = new Map<string, AbortController>();
  /**
   * Les dossiers de tâche en cours d'effacement, par tâche. L'effacement est
   * asynchrone (`effacerDossier`) et part APRÈS le résultat : la tâche quitte
   * `active` tout de suite — une réassignation au même nœud n'est pas prise
   * pour un doublon —, et sa tentative suivante attend ici que l'ancien
   * `cleanup` ait fini, au lieu d'effacer ou de cloner sous ses pieds.
   */
  private readonly effacements = new Map<string, Promise<void>>();
  /**
   * La racine de délégation de chaque enfant actif (`delegationRootTaskId`) ;
   * une tâche absente d'ici est sa propre racine. Oubliée avec ses délégations
   * quand la tâche quitte son tour (`clearDelegationsForParent`).
   */
  private readonly racines = new Map<string, string>();
  /** Délégations en vol : bornées pour qu'un Worker ne crée pas une file locale infinie. */
  private readonly pendingDelegations = new Map<
    string,
    {
      resolve: (outcome: WorkerDelegationOutcome) => void;
      timer: NodeJS.Timeout;
      parentTaskId: string;
      childTaskId: string;
      durationMs: number;
    }
  >();
  /** Enfants admis par ce nœud : la réponse d'un autre graphe est ignorée. */
  private readonly acceptedDelegations = new Map<
    string,
    { parentTaskId: string; timer: NodeJS.Timeout; expiresAt: number }
  >();
  /** Attentes bornées des résultats terminaux d'enfants. */
  private readonly pendingDelegationResults = new Map<
    string,
    {
      resolve: (result: WorkerDelegationResult) => void;
      timer: NodeJS.Timeout;
      signal: AbortSignal;
      onAbort: () => void;
    }
  >();
  /** Un enfant peut finir avant que l'adaptateur n'appelle l'attente. */
  private readonly completedDelegationResults = new Map<string, WorkerDelegationResult>();
  /**
   * Merges et chantiers en cours (par id) — anti-doublon si le hub réémet le
   * même id, et de quoi les ANNULER : `stop()` n'arrêtait que les tâches, et
   * la commande de test d'un merge ou le script d'un chantier survivait au
   * nœud, descendance comprise.
   */
  private readonly activeMerges = new Map<string, AbortController>();
  private readonly activeChantiers = new Map<string, AbortController>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  /** Évite de spammer la Chambre à chaque reconnexion WebSocket. */
  private requisitionCredentialEnvoyee = false;
  /** Tâche en pause le temps qu'un humain tranche une réquisition (boucle B/C/D). */
  private attenteRequisition: {
    task: Task;
    repoUrl: string | null;
    hiveContext?: string;
    modele?: string;
    effort?: Effort;
    delegationBudget?: DelegationBudget;
    plafondCoutMicros?: number;
    relecture: boolean;
    reseau: NiveauReseau;
    workspace: Workspace;
    started: number;
    ctrl: AbortController;
    /** Genre de la réquisition qui a mis en pause (cle_api | binaire | …). */
    genre: string;
    libelle: string;
    detail?: string;
    /** Le niveau d'autonomie reçu à l'assignation (G12) — repris tel quel. */
    autonomie: NiveauAutonomie;
    /** Les règles compilées depuis la base (G12) — recalculables, mais figées. */
    permissionsAllow: readonly string[];
  } | null = null;
  /**
   * Réquisitions d'ACTION en vol (G12) : la tâche TOURNE pendant que la Chambre
   * décide — rien à voir avec `attenteRequisition`, où la tâche est terminée en
   * échec infra. Deux cartes : l'accusé (requestId → id du store + échéance),
   * puis la décision (id → accordee/refusee/expiree).
   *
   * PERTE ASSUMÉE À LA RECONNEXION : le hub n'émet `requisition_result` qu'à
   * l'instant de la décision, sur le socket du moment — un nœud déconnecté à
   * cet instant ne la reçoit jamais (aucun rejeu). Le filet local tranche
   * alors `indisponible` → deny dit au CLI. Re-corréler la décision après
   * reconnexion est un chantier nommé, pas un comportement implicite.
   */
  private readonly pendingActionAcks = new Map<string, (id: string, expiresAt?: number) => void>();
  private readonly pendingActionDecisions = new Map<
    string,
    (statut: 'accordee' | 'refusee' | 'expiree') => void
  >();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1_000;
  private closed = false;
  /** Veille de la connexion : pings de vie et constat du silence du hub. */
  private vigieTimer: NodeJS.Timeout | null = null;
  /** Dernière fois que le hub a donné signe de vie (message ou pong). */
  private derniereNouvelle = 0;
  private readonly adapter: AgentAdapter;
  /** Les efforts sondés au démarrage (`start`) ; vide : aucun déclaré. */
  private efforts: readonly Effort[] = [];
  private readonly workRoot: string;
  /**
   * Où les ponts de délégation de ce nœud ouvrent leurs sockets : un dossier
   * privé sous le dossier temporaire du système, créé au premier pont et
   * effacé par `stop()` — jamais sous `workRoot`, dont la profondeur dépend du
   * dossier d'où l'on a lancé le nœud (voir `rendez-vous-pont.ts`).
   */
  private readonly rendezVous = new RendezVousPont();

  /**
   * Arme la limite que le NŒUD tient pendant la tentative : la durée. Le coût,
   * le nœud ne le voit qu'à la fin — le CLI le DÉCLARE avec son résultat : c'est
   * l'AGENT qui le tient dans sa boucle, sur le plafond que la Reine passe à la
   * tentative (`plafondCoutMicros`, Claude Code : `--max-budget-usd`), et la
   * Reine qui tient l'enveloppe de l'arbre (`tenirBudgetCoutRacine`).
   * `resourceUnits` est un compte abstrait, sans mesure derrière : transporté,
   * jamais appliqué — il ne borne ni des tours, ni rien d'autre.
   */
  private startDelegationBudget(
    budget: DelegationBudget | undefined,
    ctrl: AbortController,
    onExceeded: () => void,
  ): NodeJS.Timeout | null {
    if (!budget) return null;
    const expire = (): void => {
      onExceeded();
      ctrl.abort();
    };
    if (budget.durationMs === 0) {
      expire();
      return null;
    }
    const timer = setTimeout(expire, budget.durationMs);
    timer.unref?.();
    return timer;
  }

  private resultAfterDelegationBudget(
    result: AdapterResult,
    budget: DelegationBudget,
  ): AdapterResult {
    return {
      success: false,
      diff: '',
      logs: `${result.logs}\n[hive] budget de durée dépassé (${budget.durationMs} ms)`,
      subAgents: result.subAgents,
    };
  }

  constructor(private readonly opts: NodeClientOptions) {
    this.adapter = opts.adapter ?? getAdapter(opts.agentType);
    this.nodeId = opts.nodeId ?? null;
    this.workRoot = opts.workRoot ?? racineDeTravailParDefaut(opts.name);
  }

  /** Rejoint la ruche (et retente sans fin tant que stop() n'est pas appelé). */
  start(): void {
    this.closed = false;
    this.warnIfInsecureTransport();
    this.preparerRendezVous();
    // Les efforts se SONDENT avant la première inscription (`claude --help`,
    // quelques centaines de ms, borné par `STATUT_MAX_MS`) : s'inscrire avant
    // les annoncerait à la reconnexion suivante seulement. Une sonde qui échoue
    // n'en déclare aucun — le CLI garde son défaut — et ne retient pas le nœud.
    const sonde = this.adapter.effortsDocumentes;
    if (!sonde) {
      this.connect();
      return;
    }
    void sonde()
      .then(
        (efforts) => {
          this.efforts = efforts;
        },
        () => undefined,
      )
      .then(() => this.connect());
  }

  /**
   * Les ponts de délégation, au démarrage : balayer ce qu'un nœud tué a laissé
   * (un `kill -9` n'appelle pas `stop()`), et DIRE tout de suite si aucun pont
   * ne pourra s'ouvrir ici — plutôt qu'à la première tâche Claude Code ou Codex.
   * L'alerte ne vise que les agents qui ouvrent un pont (`binaireMcpDansBac`,
   * la même source que le preflight du bac) : à un nœud shell ou Gemini, un
   * TMPDIR profond ne coûte rien, et l'en avertir serait un faux signal.
   */
  private preparerRendezVous(): void {
    for (const reste of balayerPontsOrphelins()) this.log(`pont orphelin effacé : ${reste}`);
    const agent = this.opts.agentType;
    if (!estAgentType(agent) || binaireMcpDansBac(agent) === null) return;
    const alerte = this.rendezVous.alerte();
    if (alerte) this.log(`⚠ ${alerte}`);
  }

  /**
   * Le token et les diffs transitent dans le premier message : sur un ws://
   * non-local, ils sont en clair (capture passive → rejeu ; MITM → injection).
   * On avertit fortement ; utilisez wss:// (proxy TLS) hors de la machine locale.
   */
  private warnIfInsecureTransport(): void {
    try {
      const url = new URL(this.opts.url);
      const host = url.hostname;
      const local =
        host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
      if (url.protocol === 'ws:' && !local) {
        this.log(
          `⚠ SÉCURITÉ : connexion ws:// NON chiffrée vers ${host} — le token et les ` +
            'diffs circulent en clair. Utilisez wss:// (proxy TLS) hors de la machine locale.',
        );
      }
    } catch {
      // URL invalide : la connexion échouera et sera journalisée ailleurs.
    }
  }

  /** Quitte la ruche : annule les tâches en cours et ferme la connexion. */
  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const ctrl of this.active.values()) ctrl.abort();
    for (const ctrl of this.activeMerges.values()) ctrl.abort();
    for (const ctrl of this.activeChantiers.values()) ctrl.abort();
    this.rejectPendingDelegations('client arrêté');
    this.stopHeartbeat();
    this.arreterVeille();
    this.ws?.close(1000, 'arrêt du nœud');
    this.ws = null;
    // Après l'annulation des tâches : leurs ponts se ferment d'eux-mêmes, et
    // le dossier du nœud part avec ce qui y resterait.
    this.rendezVous.fermer();
  }

  get id(): string | null {
    return this.nodeId;
  }

  get runningCount(): number {
    return this.active.size;
  }

  /**
   * Ouvre une réquisition (clé API, MCP, binaire…) — ADR 0010 lot 7.
   * Le secret ne transite jamais : l'humain accorde depuis la Chambre.
   */
  ouvrirRequisition(genre: string, libelle: string, detail?: string, taskId?: string): void {
    if (!this.nodeId) {
      this.log('réquisition ignorée : nœud non enregistré');
      return;
    }
    this.send({
      type: 'requisition_open',
      genre,
      libelle,
      ...(detail ? { detail } : {}),
      ...(taskId ? { taskId } : {}),
    });
  }

  /**
   * Décide une action proposée par le CLI (G12, `--permission-prompt-tool`
   * relayé par le pont MCP). PUR dans sa décision — `politique-actions.ts`
   * classe, le niveau d'autonomie du projet tranche le défaut — et VISIBLE
   * dans ses effets : chaque issue (autorisée, refusée, réquisition, échéance)
   * laisse une ligne au journal de la tâche — sauf l'allow de la classe
   * `toujours` (lectures), dont le volume noierait le journal. Jamais d'allow
   * implicite. `echeanceRun` (ms epoch) : l'instant où le délai dur de
   * l'adaptateur tuera le CLI — l'attente d'une décision s'y borne.
   */
  private async deciderActionProposee(
    taskId: string,
    action: ActionProposee,
    cwd: string,
    niveau: NiveauAutonomie,
    signal: AbortSignal,
    echeanceRun?: number,
  ): Promise<DecisionAction> {
    const caviardeur = this.caviardeurDuNoeud();
    const classement = classerActionProposee(action, cwd);
    const suite = decisionActionParNiveau(classement.classe, niveau);
    const libelle = caviardeur.texte(classement.libelle).slice(0, LIMITS.requisitionLibelle);
    const progres = (log: string): void => {
      this.send({ type: 'task_update', taskId, status: 'running', log });
    };
    if (suite === 'autoriser') {
      // Fait enregistré là où il se produit : l'auto-allow d'une commande
      // hors liste est une décision, elle se lit dans le journal de la tâche.
      if (classement.classe !== 'toujours') {
        progres(
          `▶ action autorisée (classe ${classement.classe}, autonomie ${niveau}) : ${libelle}`,
        );
      }
      return { behavior: 'allow', updatedInput: action.input };
    }
    if (suite === 'refuser') {
      const message =
        `action refusée par la politique Hive (classe ${classement.classe}, ` +
        `autonomie ${niveau}) : ${libelle} — hors de la liste d'autorisation du dépôt ; ` +
        `une décision humaine se demande via la Chambre (niveau gouverne ou plein)`;
      progres(`⛔ ${message}`);
      return { behavior: 'deny', message };
    }
    // Réquisition dans la Chambre : le CLI reste suspendu sur SA décision —
    // l'échéance effective (min du TTL de la Reine et du budget restant du
    // run) garantit une réponse avant la mort du CLI, et le filet local
    // couvre un hub devenu muet.
    progres(`⏸ Décision demandée à la Chambre : ${libelle}`);
    const detail = caviardeur
      .texte(`${action.toolName} ${JSON.stringify(action.input)}`)
      .slice(0, LIMITS.requisitionDetail);
    const statut = await this.attendreDecisionAction(taskId, libelle, detail, signal, echeanceRun);
    if (statut === 'accordee') {
      progres(`▶ Action accordée depuis la Chambre : ${libelle}`);
      return { behavior: 'allow', updatedInput: action.input };
    }
    // Chaque issue porte SON motif : une expiration décidée par la Reine
    // n'est pas un hub injoignable, et un run à bout de budget n'est ni l'un
    // ni l'autre — le journal doit dire lequel des trois est arrivé.
    const motif =
      statut === 'refusee'
        ? 'réquisition refusée depuis la Chambre'
        : statut === 'expiree'
          ? 'réquisition expirée par la Reine — aucune décision humaine à l’échéance'
          : statut === 'hors_delai'
            ? 'décision impossible — budget du run CLI épuisé avant toute échéance de la Chambre'
            : 'décision indisponible — hub injoignable (ou tâche annulée), aucune expiration décidée';
    progres(`⛔ ${motif} : ${libelle}`);
    return { behavior: 'deny', message: `${motif} : ${libelle}` };
  }

  /**
   * Ouvre la réquisition d'ACTION et attend sa décision, tâche EN VOL. La
   * corrélation passe par `requestId` (rendu tel quel dans l'ack) puis par
   * l'identifiant du store (`requisition_result`). Ne lève jamais : toute
   * panne de transport devient `indisponible`, que l'appelant lit en deny.
   * `echeanceRun` borne tout : le budget transmis au hub (qui raccourcit son
   * TTL) comme le filet local — une décision rendue après la mort du CLI ne
   * sert personne.
   */
  private attendreDecisionAction(
    taskId: string,
    libelle: string,
    detail: string,
    signal: AbortSignal,
    echeanceRun?: number,
  ): Promise<'accordee' | 'refusee' | 'expiree' | 'indisponible' | 'hors_delai'> {
    // Déjà annulée : l'écouteur `abort` ne tirerait plus — on n'ouvre rien.
    if (signal.aborted || !this.nodeId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve('indisponible');
    }
    const budgetMs =
      echeanceRun === undefined
        ? null
        : Math.floor(echeanceRun - Date.now() - MARGE_DECISION_ACTION_MS);
    if (budgetMs !== null && budgetMs <= 0) {
      // Action proposée trop tard dans le run : le CLI mourra avant toute
      // décision — ouvrir une réquisition qu'aucune réponse ne peut plus
      // atteindre fabriquerait une case morte dans la Chambre.
      return Promise.resolve('hors_delai');
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      let reqId: string | null = null;
      let ackTimer: NodeJS.Timeout | null = null;
      let decideTimer: NodeJS.Timeout | null = null;
      let fini = false;
      const finir = (
        statut: 'accordee' | 'refusee' | 'expiree' | 'indisponible' | 'hors_delai',
      ): void => {
        if (fini) return;
        fini = true;
        this.pendingActionAcks.delete(requestId);
        if (reqId) this.pendingActionDecisions.delete(reqId);
        if (ackTimer) clearTimeout(ackTimer);
        if (decideTimer) clearTimeout(decideTimer);
        signal.removeEventListener('abort', onAbort);
        resolve(statut);
      };
      // Tâche annulée pendant l'attente : la décision n'a plus de destinataire.
      const onAbort = (): void => finir('indisponible');
      signal.addEventListener('abort', onAbort, { once: true });
      // L'accusé d'abord : sans lui, pas d'identifiant à attendre.
      ackTimer = setTimeout(() => {
        if (!reqId) finir('indisponible');
      }, ACTION_ACK_TIMEOUT_MS);
      ackTimer.unref?.();
      this.pendingActionAcks.set(requestId, (id, expiresAt) => {
        reqId = id;
        if (ackTimer) clearTimeout(ackTimer);
        this.pendingActionDecisions.set(id, finir);
        // Filet local : l'échéance appartient à la Reine — l'ack la transmet
        // et le filet s'y cale (plus la grâce de relais) ; sans elle (hub
        // plus ancien), le plafond figé. Dans tous les cas, jamais au-delà du
        // budget du run. Un filet qui tire, c'est un hub qui n'a PAS relayé
        // son expiration : `indisponible`, pas `expiree`.
        const filet =
          expiresAt !== undefined
            ? Math.max(0, expiresAt - Date.now()) + GRACE_RELAIS_ECHEANCE_MS
            : ACTION_DECISION_MAX_MS;
        // La borne budget garde la grâce de relais : la marge de trente
        // secondes retranchée du budget la couvre — le filet reste donc
        // toujours AVANT la mort du CLI, et toujours APRÈS l'échéance du hub.
        decideTimer = setTimeout(
          () => finir('indisponible'),
          budgetMs === null ? filet : Math.min(filet, budgetMs + GRACE_RELAIS_ECHEANCE_MS),
        );
        decideTimer.unref?.();
      });
      this.send({
        type: 'requisition_open',
        genre: 'action',
        libelle,
        ...(detail ? { detail } : {}),
        taskId,
        requestId,
        ...(budgetMs !== null ? { budgetMs } : {}),
      });
    });
  }

  /** Demande un enfant au hub sans exposer le socket à l'adaptateur. */
  private requestDelegation(
    parentTaskId: string,
    input: WorkerDelegationInput,
  ): Promise<WorkerDelegationOutcome> {
    if (
      !ID_PATTERN.test(parentTaskId) ||
      !ID_PATTERN.test(input.childTaskId) ||
      !input.reason ||
      input.reason.trim().length === 0 ||
      input.reason.length > LIMITS.delegationReason ||
      !input.title ||
      input.title.length > LIMITS.title ||
      !input.prompt ||
      input.prompt.length > LIMITS.prompt ||
      !Number.isSafeInteger(input.durationMs) ||
      input.durationMs < 0 ||
      input.durationMs > LIMITS.delegationDurationMs ||
      !Number.isSafeInteger(input.costMicros) ||
      input.costMicros < 0 ||
      input.costMicros > LIMITS.delegationCostMicros ||
      !Number.isSafeInteger(input.resourceUnits) ||
      input.resourceUnits < 0 ||
      input.resourceUnits > LIMITS.delegationResourceUnits ||
      (input.preferredAgent !== undefined &&
        (input.preferredAgent.length === 0 || input.preferredAgent.length > LIMITS.name)) ||
      (input.preferredModel !== undefined &&
        (input.preferredModel.length === 0 || input.preferredModel.length > LIMITS.name))
    ) {
      return Promise.resolve({
        ok: false,
        code: 'invalid_request',
        message: 'demande de délégation mal formée',
      });
    }
    if (!this.nodeId || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, code: 'transport', message: 'nœud non connecté' });
    }
    if (this.pendingDelegations.size >= MAX_PENDING_DELEGATIONS) {
      return Promise.resolve({
        ok: false,
        code: 'local_quota',
        message: 'trop de délégations en attente sur ce nœud',
      });
    }
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingDelegations.delete(requestId);
        resolve({ ok: false, code: 'timeout', message: 'réponse de délégation absente' });
      }, DELEGATION_RESPONSE_TIMEOUT_MS);
      timer.unref?.();
      this.pendingDelegations.set(requestId, {
        resolve,
        timer,
        parentTaskId,
        childTaskId: input.childTaskId,
        durationMs: input.durationMs,
      });
      this.send({
        type: 'delegate_task',
        requestId,
        childTaskId: input.childTaskId,
        parentTaskId,
        reason: input.reason,
        title: input.title,
        prompt: input.prompt,
        durationMs: input.durationMs,
        costMicros: input.costMicros,
        resourceUnits: input.resourceUnits,
        ...(input.preferredAgent ? { preferredAgent: input.preferredAgent } : {}),
        ...(input.preferredModel ? { preferredModel: input.preferredModel } : {}),
      });
    });
  }

  private resolveDelegation(outcome: WorkerDelegationOutcome, requestId: string): void {
    const pending = this.pendingDelegations.get(requestId);
    if (!pending) return;
    this.pendingDelegations.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(outcome);
  }

  /** Attend le résultat terminal d'un enfant admis par la tâche parente. */
  private waitForDelegationResult(
    parentTaskId: string,
    childTaskId: string,
    signal: AbortSignal,
  ): Promise<WorkerDelegationResult> {
    if (this.acceptedDelegations.get(childTaskId)?.parentTaskId !== parentTaskId) {
      return Promise.resolve({
        ok: false,
        code: 'unknown_child',
        message: 'enfant non admis par cette tâche parente',
      });
    }
    if (signal.aborted) {
      return Promise.resolve({ ok: false, code: 'cancelled', message: 'tâche parente annulée' });
    }
    const completed = this.completedDelegationResults.get(childTaskId);
    if (completed) {
      this.completedDelegationResults.delete(childTaskId);
      this.clearAcceptedDelegation(childTaskId);
      return Promise.resolve(completed);
    }
    if (this.pendingDelegationResults.has(childTaskId)) {
      return Promise.resolve({
        ok: false,
        code: 'duplicate_wait',
        message: 'une attente de résultat existe déjà pour cet enfant',
      });
    }
    const accepted = this.acceptedDelegations.get(childTaskId);
    if (!accepted) {
      return Promise.resolve({
        ok: false,
        code: 'unknown_child',
        message: 'enfant non admis par cette tâche parente',
      });
    }
    return new Promise((resolve) => {
      const timeoutMs = Math.max(0, accepted.expiresAt - Date.now());
      const timer = setTimeout(() => {
        this.pendingDelegationResults.delete(childTaskId);
        this.clearAcceptedDelegation(childTaskId);
        signal.removeEventListener('abort', onAbort);
        resolve({ ok: false, code: 'timeout', message: 'résultat de délégation absent' });
      }, timeoutMs);
      timer.unref?.();
      const onAbort = (): void => {
        clearTimeout(timer);
        this.pendingDelegationResults.delete(childTaskId);
        this.clearAcceptedDelegation(childTaskId);
        resolve({ ok: false, code: 'cancelled', message: 'tâche parente annulée' });
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pendingDelegationResults.set(childTaskId, { resolve, timer, signal, onAbort });
    });
  }

  private resolveDelegationResult(result: WorkerDelegationResult): void {
    if (!result.ok) return;
    const accepted = this.acceptedDelegations.get(result.childTaskId);
    if (accepted?.parentTaskId !== result.parentTaskId) return;
    const pending = this.pendingDelegationResults.get(result.childTaskId);
    if (pending) {
      this.pendingDelegationResults.delete(result.childTaskId);
      clearTimeout(pending.timer);
      pending.signal.removeEventListener('abort', pending.onAbort);
      this.clearAcceptedDelegation(result.childTaskId);
      pending.resolve(result);
      return;
    }
    // Le résultat est durable côté hub : garder seulement une copie bornée
    // permet à l'adaptateur de commencer à l'attendre après la fin de l'enfant.
    clearTimeout(accepted.timer);
    this.completedDelegationResults.set(result.childTaskId, result);
    while (this.completedDelegationResults.size > MAX_PENDING_DELEGATIONS) {
      const oldest = this.completedDelegationResults.keys().next().value;
      if (oldest === undefined) break;
      this.completedDelegationResults.delete(oldest);
      this.clearAcceptedDelegation(oldest);
    }
  }

  /**
   * Les tâches actives de ce nœud, dans l'arbre de `racine`, qui attendent un
   * enfant délégué encore en vol : admis par la Reine (`acceptedDelegations`),
   * résultat pas encore reçu.
   *
   * La même règle que la Reine (`parentsEnAttenteSousRacine`, store) : un
   * parent dont un enfant vole ne tient pas de place POUR SON ARBRE. Sans elle,
   * une ouvrière à deux places portait la racine et son enfant, refusait le
   * petit-enfant (`noeud_sature`), et l'arbre attendait sa propre expiration.
   * Pour les autres, il l'occupe : sinon chaque racine délégante laissait
   * entrer la suivante, et `maxConcurrency` ne bornait plus rien.
   *
   * ─── UN ÉCART ASSUMÉ AVEC LA REINE ───────────────────────────────────────────
   *
   * La Reine lit le statut de l'enfant ; ce guichet, ses admissions locales. Une
   * admission oubliée ici avant que l'enfant ne finisse — attente expirée,
   * reconnexion, quota local — fait voir à la Reine une place que ce nœud
   * refuse. L'écart est borné : il ne touche que les descendants de CET arbre,
   * le refus (`noeud_sature`) ne brûle aucune tentative, et la Reine ne
   * re-sollicite pas ce nœud pour cette tâche avant la fin du délai de refus
   * (`recentRejections`). Le parent qui n'a plus d'admission ne peut plus
   * attendre son enfant : il travaille, et tient sa place — le guichet a raison.
   */
  private parentsEnAttente(racine: string): number {
    const parents = new Set<string>();
    for (const [childTaskId, accepted] of this.acceptedDelegations) {
      if (!this.active.has(accepted.parentTaskId)) continue;
      if (this.completedDelegationResults.has(childTaskId)) continue;
      if ((this.racines.get(accepted.parentTaskId) ?? accepted.parentTaskId) !== racine) continue;
      parents.add(accepted.parentTaskId);
    }
    return parents.size;
  }

  private clearAcceptedDelegation(childTaskId: string): void {
    const accepted = this.acceptedDelegations.get(childTaskId);
    if (!accepted) return;
    clearTimeout(accepted.timer);
    this.acceptedDelegations.delete(childTaskId);
  }

  /**
   * Nettoie les enfants d'un parent qui vient de quitter son tour — et sa
   * racine (`racines`). Un Worker qui choisit de ne pas attendre un enfant ne
   * doit pas laisser une entrée vivre jusqu'à la prochaine reconnexion du nœud.
   */
  private clearDelegationsForParent(parentTaskId: string): void {
    this.racines.delete(parentTaskId);
    for (const [childTaskId, accepted] of this.acceptedDelegations) {
      if (accepted.parentTaskId !== parentTaskId) continue;
      const pending = this.pendingDelegationResults.get(childTaskId);
      if (pending) {
        clearTimeout(pending.timer);
        pending.signal.removeEventListener('abort', pending.onAbort);
        this.pendingDelegationResults.delete(childTaskId);
        pending.resolve({ ok: false, code: 'parent_finished', message: 'tâche parente terminée' });
      }
      this.completedDelegationResults.delete(childTaskId);
      this.clearAcceptedDelegation(childTaskId);
    }
  }

  private rememberAcceptedDelegation(
    parentTaskId: string,
    childTaskId: string,
    durationMs: number,
  ): void {
    this.clearAcceptedDelegation(childTaskId);
    while (this.acceptedDelegations.size >= MAX_ACCEPTED_DELEGATIONS) {
      const oldest = this.acceptedDelegations.keys().next().value;
      if (oldest === undefined) break;
      const waiting = this.pendingDelegationResults.get(oldest);
      if (waiting) {
        clearTimeout(waiting.timer);
        waiting.signal.removeEventListener('abort', waiting.onAbort);
        this.pendingDelegationResults.delete(oldest);
        waiting.resolve({
          ok: false,
          code: 'local_quota',
          message: 'trop de résultats de délégation',
        });
      }
      this.completedDelegationResults.delete(oldest);
      this.clearAcceptedDelegation(oldest);
    }
    const timeoutMs = Math.min(
      LIMITS.delegationDurationMs + DELEGATION_RESULT_GRACE_MS,
      Math.max(DELEGATION_RESULT_GRACE_MS, durationMs + DELEGATION_RESULT_GRACE_MS),
    );
    const expiresAt = Date.now() + timeoutMs;
    const timer = setTimeout(() => {
      this.acceptedDelegations.delete(childTaskId);
      this.completedDelegationResults.delete(childTaskId);
    }, timeoutMs);
    timer.unref?.();
    this.acceptedDelegations.set(childTaskId, { parentTaskId, timer, expiresAt });
  }

  private rejectPendingDelegations(message: string): void {
    for (const [requestId, pending] of this.pendingDelegations) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, code: 'transport', message });
      this.pendingDelegations.delete(requestId);
    }
    for (const [childTaskId, pending] of this.pendingDelegationResults) {
      clearTimeout(pending.timer);
      pending.signal.removeEventListener('abort', pending.onAbort);
      pending.resolve({ ok: false, code: 'transport', message });
      this.pendingDelegationResults.delete(childTaskId);
    }
    for (const childTaskId of this.acceptedDelegations.keys()) {
      this.clearAcceptedDelegation(childTaskId);
    }
    this.completedDelegationResults.clear();
  }

  // ─── Connexion ───────────────────────────────────────────────────────────
  private connect(): void {
    if (this.closed) return;
    // `handshakeTimeout` : un hub dont les paquets se PERDENT (au lieu d'être
    // refusés) laisserait la poignée de main pendre jusqu'aux délais du noyau,
    // sans jamais retenter. Au-delà du silence toléré, on abandonne et on
    // repasse par la reconnexion.
    const ws = new WebSocket(this.opts.url, {
      handshakeTimeout: this.opts.silenceMaxMs ?? NODE_TIMEOUT_MS,
    });
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelay = 1_000;
      this.veiller(ws);
      this.send({
        type: 'register',
        token: this.opts.token,
        name: this.opts.name,
        ownerName: this.opts.ownerName,
        agentType: this.opts.agentType,
        maxConcurrency: this.opts.maxConcurrency,
        // En reconnexion, on garde la même identité dans la ruche.
        ...(this.nodeId ? { nodeId: this.nodeId } : {}),
        // Tâches réellement en cours : permet au hub de réconcilier son état
        // (requalifier les tâches qu'on ne fait plus, annuler nos zombies).
        activeTasks: [...this.active.keys()],
        // La machine se DIT : « quelles ouvrières tournent sous Windows ? »
        // doit avoir une réponse à l'écran, pas une devinette (§ 6.2 — la
        // moitié des morsures de ce dépôt sont des morsures Windows).
        plateforme: plateformeDepuis(process.platform),
        // Les modèles déclarés, s'il y en a — redits à CHAQUE inscription, comme
        // le bac à sable. Absents : le hub EFFACE toute déclaration d'avant et
        // ordonnance comme avant l'Aiguillage. Jamais `[]` : le protocole refuse
        // une liste vide, et un hub refuserait alors l'inscription entière.
        ...(this.opts.modeles && this.opts.modeles.length > 0
          ? { modeles: this.opts.modeles }
          : {}),
        // Les efforts que le CLI installé DOCUMENTE (sondés au démarrage, jamais
        // configurés à la main) : redits à chaque inscription, absents quand
        // l'agent n'en a aucun.
        ...(this.efforts.length > 0 ? { efforts: [...this.efforts] } : {}),
        // Un plafond de coût tenu dans la boucle de l'agent : la capacité de
        // l'ADAPTATEUR. La version du CLI, elle, se vérifie à chaque tentative
        // plafonnée (`plafondTenu`) — un CLI se met à jour sous un nœud en marche.
        ...(this.adapter.plafondCout ? { plafondCout: true } : {}),
        // Ce que ce poste porte réellement — des CONSTATS, pas un verdict. Le
        // hub en tire sa conclusion avec son catalogue ; ici on ne fait que
        // rapporter ce qu'on a vu. Absent tant que le diagnostic n'a pas
        // tourné : un tableau vide se lirait comme « rien d'installé ».
        ...(this.outilsConstates ? { outils: this.outilsConstates } : {}),
        // Le bac à sable où les tâches tourneront — redit à CHAQUE inscription :
        // le hub efface une déclaration qui n'est pas répétée.
        ...(this.opts.isolement ? { isolement: this.opts.isolement } : {}),
        // Le consentement à pousser, dit au hub pour qu'il CHOISISSE un nœud
        // consentant. La garde, elle, reste ici (`runMergeJob`).
        ...(this.pousseLivraisons() ? { pousseLivraisons: true } : {}),
        // Ce nœud sait cloner la branche d'une PR et prolonger une mission : sans
        // cette déclaration, le hub ne lui confie aucune reprise (`prolonge`).
        prolonge: true,
      });
    });

    ws.on('message', (data) => {
      this.derniereNouvelle = Date.now();
      this.onMessage(typeof data === 'string' ? data : data.toString());
    });

    // Le hub répond aux pings sans rien coder : `ws` renvoie le pong tout seul.
    ws.on('pong', () => {
      this.derniereNouvelle = Date.now();
    });

    ws.on('close', () => {
      this.arreterVeille();
      this.stopHeartbeat();
      this.rejectPendingDelegations('connexion au hub perdue');
      if (!this.closed) this.scheduleReconnect();
    });

    ws.on('error', () => {
      // L'événement close suit toujours : la reconnexion y est gérée.
    });
  }

  // ─── La veille : ne pas attendre que TCP constate la mort ────────────────
  //
  // Le nœud n'apprenait la perte du hub que par l'événement `close`, donc par
  // TCP. Or un chemin réseau qui MEURT sans rien fermer — Wi-Fi qui décroche,
  // portable qui se réveille sur un autre réseau, NAT qui oublie la session —
  // laisse la socket « ouverte » pendant les délais de retransmission du noyau,
  // de l'ordre du quart d'heure. Mesuré sur une vraie Reine derrière un relais
  // dont le chemin meurt : le hub tient le nœud pour mort au bout de 15 s et
  // remet ses tâches en file, mais le nœud, lui, ne retente JAMAIS — la mission
  // reste bloquée, tâches prêtes et nœud hors ligne, alors qu'une nouvelle
  // connexion aurait abouti.
  //
  // Le nœud pingue donc le hub à chaque battement et tient la connexion pour
  // morte quand le hub n'a plus rien dit (ni message, ni pong) depuis
  // `silenceMaxMs`. `terminate()` émet `close` : la reconnexion habituelle,
  // avec son recul exponentiel, prend le relais.
  private veiller(ws: WebSocket): void {
    this.arreterVeille();
    this.derniereNouvelle = Date.now();
    const silenceMax = this.opts.silenceMaxMs ?? NODE_TIMEOUT_MS;
    this.vigieTimer = setInterval(() => {
      if (ws !== this.ws || ws.readyState !== WebSocket.OPEN) return;
      const silence = Date.now() - this.derniereNouvelle;
      if (silence > silenceMax) {
        this.log(`hub muet depuis ${Math.round(silence / 1000)} s — connexion tenue pour morte`);
        ws.terminate();
        return;
      }
      try {
        ws.ping();
      } catch {
        // Socket en train de tomber : `close` suivra et relancera.
      }
    }, this.opts.pingMs ?? HEARTBEAT_INTERVAL_MS);
    this.vigieTimer.unref?.();
  }

  private arreterVeille(): void {
    if (this.vigieTimer) clearInterval(this.vigieTimer);
    this.vigieTimer = null;
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    this.log(`connexion perdue — nouvel essai dans ${Math.round(delay / 1000)} s`);
    // Volontairement NON unref : dans un process de nœud autonome, ce timer est
    // le seul handle qui maintient l'event loop en vie entre deux tentatives.
    // L'unref le ferait s'éteindre en silence au lieu de « retenter sans fin ».
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private onMessage(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case 'registered':
        this.nodeId = msg.nodeId;
        this.startHeartbeat();
        this.log(`enregistré dans la ruche (nodeId=${msg.nodeId.slice(0, 8)}…)`);
        this.proposerRequisitionCredentialsSiBesoin();
        try {
          this.opts.surInscription?.({ ruche: msg.ruche ?? null });
        } catch (err) {
          this.log(`signalement réseau : ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      case 'assign_task':
        void this.runTask(msg);
        break;
      case 'assign_merge':
        void this.runMergeJob(msg);
        break;
      case 'assign_chantier':
        void this.runChantierJob(msg);
        break;
      case 'poser_outil':
        void this.runPoseOutil(msg);
        break;
      case 'cancel_task':
        this.active.get(msg.taskId)?.abort();
        break;
      case 'error':
        this.log(`erreur du hub : ${msg.message}`);
        break;
      case 'delegation_accepted': {
        const accepted: DelegationAcceptedMsg = msg;
        // Un accusé arrivé après l'expiration de la demande locale ne doit pas
        // créer une nouvelle entrée d'attente : il pourrait être rejoué par un
        // ancien transport et retenir un résultat qui ne nous appartient plus.
        const pending = this.pendingDelegations.get(accepted.requestId);
        if (
          !pending ||
          pending.parentTaskId !== accepted.parentTaskId ||
          pending.childTaskId !== accepted.childTaskId
        ) {
          break;
        }
        this.rememberAcceptedDelegation(
          accepted.parentTaskId,
          accepted.childTaskId,
          pending.durationMs,
        );
        this.resolveDelegation(
          {
            ok: true,
            parentTaskId: accepted.parentTaskId,
            childTaskId: accepted.childTaskId,
            depth: accepted.depth,
          },
          accepted.requestId,
        );
        this.log(
          `délégation acceptée : ${accepted.childTaskId.slice(0, 8)}… (profondeur ${accepted.depth})`,
        );
        break;
      }
      case 'delegation_rejected': {
        const rejected: DelegationRejectedMsg = msg;
        this.resolveDelegation(
          { ok: false, code: rejected.code, message: rejected.message },
          rejected.requestId,
        );
        this.log(`délégation refusée : ${rejected.message}`);
        break;
      }
      case 'delegation_result': {
        const result: DelegationResultMsg = msg;
        this.resolveDelegationResult({ ok: true, ...result });
        break;
      }
      case 'requisition_ack': {
        this.log(`réquisition ouverte (${msg.id.slice(0, 8)}…) — ${msg.genre} : ${msg.libelle}`);
        if (msg.requestId) {
          const attendue = this.pendingActionAcks.get(msg.requestId);
          if (attendue) {
            this.pendingActionAcks.delete(msg.requestId);
            attendue(msg.id, msg.expiresAt);
          }
        }
        break;
      }
      case 'requisition_result': {
        this.log(`réquisition ${msg.id.slice(0, 8)}… : ${msg.statut}`);
        // Une décision d'ACTION en vol (G12) se résout ici, tâche toujours en
        // cours — jamais confondue avec la pause infra d'`attenteRequisition`.
        const decision = this.pendingActionDecisions.get(msg.id);
        if (decision) {
          this.pendingActionDecisions.delete(msg.id);
          decision(msg.statut);
          break;
        }
        if (this.attenteRequisition) {
          if (msg.statut === 'accordee') void this.reprendreApresRequisition();
          else void this.abandonnerApresRequisition(msg.statut);
        }
        break;
      }
      default:
        break; // state/event : réservés au dashboard
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({
        type: 'heartbeat',
        running: this.active.size,
        onShift: this.offShiftReject() === null,
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
    // onShift : permet au hub d'éviter d'office ce nœud pour un merge quand il
    // est hors heures de service (les tâches, elles, passent par task_reject).
    this.send({
      type: 'heartbeat',
      running: this.active.size,
      onShift: this.offShiftReject() === null,
    });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Réquisition proactive si l'agent réel n'a pas d'identifiants locaux (ADR 0010). */
  private proposerRequisitionCredentialsSiBesoin(): void {
    if (this.requisitionCredentialEnvoyee) return;
    // `opts.agentType` est une CHAÎNE LIBRE : `getAdapter` en accepte d'autres
    // que les cinq connus (`hermes-agent`), et `HIVE_AGENT` laisse l'humain en
    // écrire n'importe laquelle. Un `as AgentType` compilerait en mentant sur
    // la valeur ; la garde dit la vérité et ne change rien au comportement —
    // `requisitionSiCredentialsManquantes` retombait déjà sur `null` pour un
    // agent qu'elle ne connaît pas.
    const agent = this.opts.agentType;
    if (!estAgentType(agent)) return;
    // Dans un bac, la session de l'hôte (`~/.claude`…) n'atteint pas l'agent :
    // elle ne compte plus, et la réquisition nomme le jeton à poser.
    const req = requisitionSiCredentialsManquantes(agent, process.env, {
      sessionsHote: !this.opts.bac,
    });
    if (!req) return;
    this.requisitionCredentialEnvoyee = true;
    this.ouvrirRequisition(req.genre, req.libelle, req.detail);
  }

  /**
   * La réquisition qu'appelle un échec d'INFRA de l'agent — ou `null`.
   *
   * Un seul appel pour la tâche et pour sa reprise. Dans un bac, la session de
   * l'hôte (`~/.claude`…) n'atteint pas l'agent : elle ne compte plus, et la
   * réquisition nomme le jeton à poser au lieu d'une demande générique qui ne
   * nomme rien.
   *
   * `texte` est ce que l'échec DIT (`texteDEchec`), jamais les logs bruts : la
   * ligne `init` du stream-json porte `apiKeySource` à chaque exécution.
   */
  private requisitionApresEchecInfra(texte: string, titre: string): RequisitionDepuisInfra | null {
    return requisitionDepuisEchecInfra(this.opts.agentType, texte, titre, process.env, {
      sessionsHote: !this.opts.bac,
    });
  }

  /**
   * L'option `bac` d'une exécution, ÉTIQUETÉE à ce nœud (et à la tâche quand il
   * y en a une) — ou rien, hors bac.
   *
   * L'étiquette du nœud est son identité STABLE (`opts.nodeId`, celle que
   * `main.ts` et `join.ts` relisent au redémarrage pour `ramasserRestes`), pas
   * celle qu'un hub aurait attribuée : un nœud tué doit retrouver ses
   * conteneurs sous le nom qu'il connaîtra au prochain lancement.
   */
  private optionBacTache(tache?: string, reseau?: ReseauBac): { bac?: BacExecution } {
    const bac = this.opts.bac;
    if (!bac) return {};
    const noeud = this.opts.nodeId ?? this.nodeId;
    return {
      bac: {
        ...bac,
        ...(noeud ? { noeud } : {}),
        ...(tache ? { tache } : {}),
        ...(reseau ? { reseau } : {}),
      },
    };
  }

  /**
   * Le réseau de CETTE exécution (`reseau-tache.ts`), ouvert sur l'arbre
   * fraîchement cloné — les registres du dépôt se lisent à la base, avant que
   * l'agent y écrive. Chaque refus part au journal de la tâche à l'instant où
   * le proxy le prononce.
   */
  private reseauTache(
    niveau: NiveauReseau,
    repoUrl: string | null,
    workspace: Workspace,
    progres: (p: AdapterProgress) => void,
  ): Promise<ReseauTache> {
    // Un bac sans mesure du réseau (un banc, un appelant d'avant la sonde) ne
    // filtre pas — et le dit ; sans bac, la sandbox de processus non plus.
    const capacite =
      this.opts.reseau ??
      (this.opts.bac
        ? { filtre: false, exige: false, motif: 'réseau du bac non éprouvé au démarrage' }
        : undefined);
    return ouvrirReseauTache({
      niveau,
      ...(capacite ? { capacite } : {}),
      agent: this.opts.agentType,
      repoUrl,
      cwd: workspace.cwd,
      env: workspace.env,
      reservation: this.rendezVous,
      surRefus: (r) => progres({ log: `[hive] réseau refusé — ${r.motif}` }),
    });
  }

  /** Les logs d'un résultat, précédés du bilan des refus du proxy s'il y en a eu. */
  private static logsAvecReseau(logs: string, reseau: ReseauTache | null): string {
    const bilan = reseau?.etat === 'filtre' ? bilanRefus(reseau.refus()) : null;
    return bilan ? `${bilan}\n${logs}` : logs;
  }

  /**
   * Politique Night Shift, parsée SANS jamais lever : une HIVE_SHIFT malformée
   * ne doit pas transformer une assignation en exception muette (tâche restée
   * « assigned » en otage côté hub) — on refuse proprement à la place.
   */
  private shiftPolicy(): NightShiftPolicy | 'invalide' {
    try {
      return nightShiftFromEnv();
    } catch (err) {
      if (!this.shiftWarned) {
        this.shiftWarned = true;
        // ─── ÉQUIVALENCE CONSIGNÉE : `instanceof Error` muté en
        //     `instanceof Object` ne change rien ICI ────────────────────────
        //
        // `nightShiftFromEnv` ne lève que par `parseWindows`, qui a trois
        // points de levée et les trois font `throw new Error(…)`. Sur ce
        // `catch`, les deux tests sont donc vrais ensemble, toujours : aucune
        // entrée ne distingue l'original du mutant (balayage élargi,
        // `LOUPE_CHEMINS=src/node-client`).
        //
        // On la garde quand même, et pas par superstition : `err` est typé
        // `unknown`, et le jour où une levée d'ailleurs remonte ici — un
        // rejet de chaîne, un objet nu — `instanceof Object` afficherait
        // « invalide (undefined) » là où `String(err)` dit encore quelque
        // chose. La garde est écrite pour ce jour-là.
        this.log(
          `⚠ HIVE_SHIFT invalide (${err instanceof Error ? err.message : String(err)}) — le nœud refuse le travail tant que la config n'est pas corrigée.`,
        );
      }
      return 'invalide';
    }
  }
  private shiftWarned = false;

  /** Motif de refus Night Shift à joindre à un task_reject, ou null si de service. */
  private offShiftReject(): { reason: string; retryAfterMs?: number } | null {
    const shift = this.shiftPolicy();
    // Config invalide = état durable (corrigée seulement par un redémarrage du
    // nœud, qui purge ses cooldowns à la ré-inscription) : cooldown long pour
    // ne pas réintroduire la boucle assignation/refus qui noie le journal.
    if (shift === 'invalide') return { reason: 'hive_shift_invalide', retryAfterMs: 10 * 60_000 };
    if (shift.windows.length === 0) return null;
    const now = new Date();
    if (isOnShift(shift, now)) return null;
    return {
      reason: 'hors_service_night_shift',
      retryAfterMs: minutesUntilOpen(shift, now) * 60_000,
    };
  }

  /**
   * Le caviardeur d'une exécution : les VALEURS des variables d'identification
   * transmises à l'agent (`keepEnv`), plus le jeton de ruche du nœud. Ce sont
   * exactement les secrets que l'agent peut avoir sous les yeux — et donc
   * recracher dans sa sortie, ses logs, son diff ou sa réponse.
   *
   * Lu de `process.env` au moment de l'exécution, comme `buildSandboxEnv` :
   * les deux voient les mêmes valeurs. Les secrets de la ruche que
   * `buildSandboxEnv` retire de `keepEnv` restent caviardés ici — en trop,
   * jamais en moins.
   */
  private caviardeurDuNoeud(): Caviardeur {
    const env = Object.fromEntries(
      (this.opts.keepEnv ?? []).map((nom): [string, string | undefined] => [nom, process.env[nom]]),
    );
    // Le jeton par défaut (`change-me`) ou trop court ne protège rien — le hub
    // le refuse hors développement — et `change-me` est écrit en clair dans
    // les sources de Hive : le caviarder réécrirait leurs diffs et leurs logs.
    const jeton = this.opts.token;
    const jetonReel = jeton !== DEFAULT_TOKEN && jeton.length >= MIN_TOKEN_LENGTH;
    return creerCaviardeur([...valeursSecretes(env), ...(jetonReel ? [jeton] : [])]);
  }

  /**
   * Ce que l'agent écrit lui-même et que le nœud relaie hors de la machine,
   * au-delà de sa sortie : les noms de ses sous-agents, et les demandes de
   * délégation (le hub en fait une tâche, affichée sur chaque écran). Le
   * prompt délégué sera EXÉCUTÉ par un autre agent : il ne perd que les
   * valeurs exactes et les jetons réels (`Caviardeur.code`), pas son code.
   */
  private static sousAgentsCaviardes(
    sousAgents: readonly SubAgent[],
    caviardeur: Caviardeur,
  ): SubAgent[] {
    return sousAgents.map((a) => ({
      ...a,
      name: borneApresCaviardage(caviardeur.texte(a.name), LIMITS.name),
    }));
  }

  private delegationCaviardee(
    taskId: string,
    input: WorkerDelegationInput,
    caviardeur: Caviardeur,
  ): Promise<WorkerDelegationOutcome> {
    // Reborné seulement si l'agent avait respecté la borne : une demande DÉJÀ
    // trop longue doit rester refusée (`invalid_request`), pas tronquée en douce.
    const champ = (v: string, max: number): string =>
      v.length <= max ? borneApresCaviardage(caviardeur.texte(v), max) : caviardeur.texte(v);
    return this.requestDelegation(taskId, {
      ...input,
      title: champ(input.title, LIMITS.title),
      reason: champ(input.reason, LIMITS.delegationReason),
      prompt: caviardeur.code(input.prompt),
    });
  }

  /**
   * La raison d'un refus pour agent en panne, AVEC la ligne où l'agent l'a dit
   * (`ligneDInfra`) : un refus n'emporte que sa raison, jamais les logs. Caviardée
   * et lavée ici — elle part à tout l'écran —, bornée comme toute raison.
   */
  private static raisonAgentIndisponible(
    prefixe: string,
    result: AdapterResult,
    caviardeur: Caviardeur,
  ): string {
    const dit = ligneDInfra(texteDEchec(result.logs, result.finalText));
    const cause = dit ? laverIdentifiantsDuTexte(caviardeur.texte(dit)).trim() : '';
    return (cause ? `${prefixe} : ${cause}` : prefixe).slice(0, LIMITS.name);
  }

  /**
   * Le progrès d'un adaptateur, tel qu'il part au hub : texte caviardé ici, sur
   * la machine qui porte les secrets — le hub, lui, relaie la sortie en direct
   * à chaque écran de la ruche.
   */
  private progresVersHub(
    taskId: string,
    ctrl: AbortController,
    caviardeur: Caviardeur,
  ): (p: AdapterProgress) => void {
    return (p) => {
      // Seule l'exécution EN COURS parle pour la tâche : un minuteur oublié
      // par un adaptateur fini écrirait sinon dans la console de la tentative
      // suivante (même tâche, même nœud — le hub ne peut pas les distinguer).
      if (this.active.get(taskId) !== ctrl) return;
      const sortie = p.sortie ? morceauCaviarde(caviardeur.texte(p.sortie)) : '';
      this.send({
        type: 'task_update',
        taskId,
        status: 'running',
        ...(p.subAgents
          ? { subAgents: HiveNodeClient.sousAgentsCaviardes(p.subAgents, caviardeur) }
          : {}),
        ...(p.presences ? { presences: p.presences } : {}),
        ...(p.log ? { log: caviardeur.texte(p.log).slice(0, LIMITS.log) } : {}),
        ...(sortie ? { sortie } : {}),
      });
    };
  }

  /**
   * Le plafond de coût que CETTE tentative passera à son agent : celui de la
   * Reine, si le CLI qui tournera le tient (`AgentAdapter.plafondCout`) —
   * sinon aucun, et le journal de la tâche dit pourquoi et quoi faire.
   * Interrogé AVANT le minuteur de durée de l'enfant : la sonde (un bac qui
   * démarre peut la faire attendre) ne se paie pas sur son budget.
   */
  private async plafondTenu(
    plafond: number | undefined,
    sonde: AdapterContext,
  ): Promise<number | undefined> {
    if (plafond === undefined) return undefined;
    const verdict = (await this.adapter.plafondCout?.(sonde)) ?? {
      tenu: false as const,
      motif: `l’adaptateur ${this.adapter.name} ne tient aucun plafond de coût`,
    };
    if (verdict.tenu) return plafond;
    sonde.onProgress({
      log:
        `plafond de ${usdDeMicros(plafond)} USD NON passé à l’agent : ${verdict.motif} — seule ` +
        'l’enveloppe de la racine le borne, après chaque tentative rendue',
    });
    return undefined;
  }

  // ─── Exécution d'une tâche ───────────────────────────────────────────────
  /** Le message entier : ses champs, nommés, plutôt que dix positions à tenir. */
  private async runTask(msg: AssignTaskMsg): Promise<void> {
    // Nœud arrêté : une assignation encore en vol ne démarre rien — elle
    // réserverait des ponts et lancerait un agent qu'aucun stop() n'abortera.
    if (this.closed) return;
    const { task, hiveContext, modele, delegationBudget, delegationRootTaskId, effort } = msg;
    const repoUrl = msg.repoUrl ?? null;
    const relecture = msg.relecture === true;
    const prolonger = msg.prolonger === true;
    // Absent (une Reine d'avant ce réglage) : le défaut, jamais `ouvert`.
    const reseau = msg.reseau ?? NIVEAU_RESEAU_DEFAUT;
    // Absent (hub plus ancien) : la lecture FERMÉE — comme `off`.
    const autonomie = msg.autonomie ?? 'off';
    // Défense en profondeur : l'id sert à construire des chemins locaux — on ne
    // fait pas confiance au hub (anti path-traversal si le hub était compromis).
    if (!ID_PATTERN.test(task.id)) {
      this.send({
        type: 'task_result',
        taskId: task.id.slice(0, 64),
        success: false,
        diff: '',
        logs: '[nœud] id de tâche invalide : refusé',
        durationMs: 0,
        subAgents: [],
      });
      return;
    }
    // « Présence sans production » : ce nœud s'est inscrit sans agent réel. Il
    // REFUSE poliment plutôt que de lancer son adaptateur simulé — un diff
    // inventé remonté comme du travail serait bien pire que le silence d'avant.
    //
    // `task_reject` et non `task_result` en échec : le refus ne brûle aucune
    // tentative, et le hub peut servir un autre nœud dans la seconde.
    if (refuseParPresence(this.opts.presenceSeule === true ? 'presence' : 'production')) {
      this.send({ type: 'task_reject', taskId: task.id, reason: motifRefusPresence() });
      return;
    }
    if (this.active.has(task.id)) return; // assignation dupliquée : déjà en cours
    // Un parent qui attend son enfant délégué a RELÂCHÉ sa place — pour SON
    // arbre seulement : la Reine ne le compte plus pour lui (`slotsOccupes`),
    // le guichet non plus — sinon ce nœud refuserait justement l'enfant que son
    // parent attend (`parentsEnAttente`). Toute autre tâche le voit occuper.
    const racine = delegationRootTaskId ?? task.id;
    if (this.active.size - this.parentsEnAttente(racine) >= this.opts.maxConcurrency) {
      // Nœud saturé : on REFUSE l'assignation (task_reject) plutôt que de la
      // marquer en échec — sinon on brûlerait une tentative sans rien exécuter,
      // ce qui pourrait faire échouer définitivement une tâche jamais lancée.
      this.send({ type: 'task_reject', taskId: task.id, reason: 'noeud_sature' });
      return;
    }
    // Night Shift : hors des heures de service du MEMBRE (HIVE_SHIFT, évalué
    // localement sur l'horloge de sa machine), le nœud refuse poliment —
    // aucune tentative brûlée, le hub requalifie et peut servir un autre nœud.
    // retryAfterMs = temps jusqu'à la réouverture : le hub ne re-sollicite pas
    // ce nœud en boucle pendant toute la fenêtre fermée.
    const offShift = this.offShiftReject();
    if (offShift) {
      this.send({ type: 'task_reject', taskId: task.id, ...offShift });
      this.log(`⏾ ${task.title} : ${offShift.reason} → refus`);
      return;
    }
    // `HIVE_ISOLEMENT=exige` : le membre a exigé un réseau filtré, un projet
    // `ouvert` ne tourne pas ici. Refus POLI (aucune tentative brûlée) et
    // durable : un autre nœud peut le prendre, celui-ci ne changera pas d'avis
    // avant qu'un humain change un des deux réglages.
    const exige = refusExige(reseau, this.opts.reseau);
    if (exige) {
      this.send({ type: 'task_reject', taskId: task.id, reason: exige, retryAfterMs: 10 * 60_000 });
      this.log(`🛡 ${task.title} : ${exige} → refus`);
      return;
    }

    const ctrl = new AbortController();
    this.active.set(task.id, ctrl);
    if (delegationRootTaskId) this.racines.set(task.id, delegationRootTaskId);
    const started = Date.now();
    const caviardeur = this.caviardeurDuNoeud();
    let budgetExceeded = false;
    let budgetTimer: NodeJS.Timeout | null = null;
    let usage: ExecutionUsage | undefined;
    let usageBefore: ReturnType<typeof capturerExecutionUsage> | null = null;
    this.send({ type: 'task_update', taskId: task.id, status: 'running' });
    this.log(`butinage : ${task.title} (tentative ${task.attempts + 1})`);

    let workspace: Workspace | null = null;
    let conserverWorkspace = false;
    let reseauOuvert: Exclude<ReseauTache, { etat: 'impossible' }> | null = null;
    try {
      try {
        await this.effacements.get(task.id);
        // L'attente ci-dessus rend la main : un arrêt ou une annulation qui a
        // tiré pendant elle ne doit pas voir la tentative repartir (effacer,
        // cloner, rouvrir un pont) derrière le nœud.
        if (ctrl.signal.aborted) return;
        workspace = await prepareWorkspace(
          this.workRoot,
          task,
          repoUrl,
          this.opts.keepEnv ?? [],
          // Isole le répertoire par nœud : deux drones d'une même course sur une
          // même machine (workRoot partagé) ne se marchent pas dessus.
          this.nodeId ? this.nodeId.slice(0, 8) : '',
          prolonger,
          this.adapter.configurationExecutee,
        );
      } catch (err) {
        // Le dépôt ne s'est pas cloné ICI (identifiants de ce nœud, réseau,
        // dépôt muet) : l'agent n'a pas tourné. Un `task_result` en échec
        // brûlait une tentative et écartait un modèle qui n'avait rien fait ;
        // c'est un refus d'infrastructure — un autre nœud peut réussir, et le
        // token-failover borne le cas où aucun n'y arrive. Lavé : la raison
        // cite l'URL du dépôt, et part à tout l'écran. La DERNIÈRE ligne :
        // celle où git dit pourquoi (`fatal: …`), dans les 120 caractères
        // d'une raison de refus.
        //
        // Même refus quand la configuration d'agent du dépôt n'a pas pu être
        // écartée (`configuration-inerte.ts`) : l'agent ne tourne pas avec des
        // hooks à moitié neutralisés, et la raison dit lesquels. Et quand le
        // dossier de la tentative précédente résiste à l'effacement : la
        // raison nomme le fichier tenu, pas un clone qui n'a pas eu lieu.
        const brut = err instanceof Error ? err.message : String(err);
        const cause = motifLave(brut.trim().split('\n').at(-1) ?? brut);
        const ditSaCause =
          err instanceof ConfigurationNonNeutralisable || err instanceof DossierDeTacheIneffacable;
        const raison = ditSaCause ? cause : `clone impossible : ${cause}`;
        this.send({
          type: 'task_reject',
          taskId: task.id,
          reason: raison.slice(0, LIMITS.name),
          infra: true,
          avantAgent: true,
        });
        this.log(`⇄ ${task.title} : ${raison} → réaffectation`);
        return;
      }
      // Annulée (cancel_task) ou nœud arrêté PENDANT la préparation : les
      // effacements asynchrones ci-dessus ont laissé la boucle traiter l'abort
      // avant que l'agent n'existe. On ne lance rien ; le finally nettoie.
      if (ctrl.signal.aborted) return;
      if (workspace.configurationEcartee.length > 0) {
        this.progresVersHub(
          task.id,
          ctrl,
          caviardeur,
        )({ log: noteConfigurationEcartee(workspace.configurationEcartee) });
      }
      // Le réseau AVANT l'agent : un proxy qui ne s'ouvre pas refuse la tâche
      // (un autre nœud peut réussir), jamais il ne la lance sans filtre.
      const progres = this.progresVersHub(task.id, ctrl, caviardeur);
      const reseauTache = await this.reseauTache(reseau, repoUrl, workspace, progres);
      if (reseauTache.etat === 'impossible') {
        this.send({
          type: 'task_reject',
          taskId: task.id,
          reason: motifLave(reseauTache.motif).slice(0, LIMITS.name),
          infra: true,
          avantAgent: true,
        });
        this.log(`⇄ ${task.title} : ${reseauTache.motif} → réaffectation`);
        return;
      }
      reseauOuvert = reseauTache;
      if (reseauTache.note) progres({ log: reseauTache.note });
      const reseauBac = reseauTache.etat === 'filtre' ? reseauTache.reseau : undefined;
      // Hive Mind : le contexte reçu du hub est préfixé au prompt pour l'agent.
      // On n'altère que la copie transmise à l'adaptateur (chemins/branche du
      // workspace restent construits sur la tâche d'origine).
      const taskForAgent = hiveContext
        ? { ...task, prompt: composeAgentPrompt(hiveContext, task.prompt) }
        : task;
      // La politique d'actions (G12) : les règles d'autorisation compilées
      // depuis le commit de BASE — AVANT l'agent, qui ne peut donc pas les
      // réécrire — et la capacité de décision reliée au niveau d'autonomie.
      const permissionsAllow = await reglesAutorisationDeBase(
        workspace.depot && workspace.baseSha
          ? { depot: workspace.depot, baseSha: workspace.baseSha }
          : null,
      );
      if (permissionsAllow.length > 0) {
        this.send({
          type: 'task_update',
          taskId: task.id,
          status: 'running',
          log: `politique d'actions : ${permissionsAllow.length} règles compilées depuis la base (${autonomie})`,
        });
      }
      // Le plafond de coût de CETTE tentative, si la Reine en a passé un et que
      // le CLI le tient — sondé avant que le minuteur de durée ne parte. La
      // sonde lance un processus DANS le bac : même environnement à leurres et
      // même réseau de tâche que l'agent, jamais les vraies clés ni le réseau
      // de l'hôte qu'un bac sans `reseau` rendrait (`--share-net`).
      const plafond = await this.plafondTenu(msg.plafondCoutMicros, {
        cwd: workspace.cwd,
        env: reseauTache.env,
        attempt: task.attempts + 1,
        signal: ctrl.signal,
        onProgress: progres,
        ...this.optionBacTache(task.id, reseauBac),
      });
      budgetTimer = this.startDelegationBudget(delegationBudget, ctrl, () => {
        budgetExceeded = true;
      });
      usageBefore = capturerExecutionUsage();
      const cwdTache = workspace.cwd;
      const rawResult = await this.adapter.run(taskForAgent, {
        cwd: cwdTache,
        // Filtré : les identifiants de la passerelle y sont des leurres.
        env: reseauTache.env,
        attempt: task.attempts + 1,
        signal: ctrl.signal,
        // Le modèle choisi par l'Aiguillage, s'il en a envoyé un : l'adaptateur
        // le passera à son CLI (`--model`). Absent ⇒ modèle par défaut de l'agent.
        ...(modele ? { modele } : {}),
        // L'effort, seulement si l'Aiguillage en a commandé un.
        ...(effort ? { effort } : {}),
        ...(plafond !== undefined ? { plafondCoutMicros: plafond } : {}),
        ...this.optionBacTache(task.id, reseauBac),
        ...(relecture ? { role: 'relecture' as const } : {}),
        delegate: (input) => this.delegationCaviardee(task.id, input, caviardeur),
        waitForDelegationResult: (childTaskId) =>
          this.waitForDelegationResult(task.id, childTaskId, ctrl.signal),
        rendezVous: this.rendezVous,
        ...(permissionsAllow.length > 0 ? { permissionsAllow } : {}),
        decideAction: (action, echeanceRun) =>
          this.deciderActionProposee(
            task.id,
            action,
            cwdTache,
            autonomie,
            ctrl.signal,
            echeanceRun,
          ),
        onProgress: progres,
      });
      // LE BUDGET COURT ENCORE : le minuteur n'est levé qu'au `finally`. Les
      // validations du bac comptent dans la durée d'un enfant délégué — son
      // parent ne l'attend que `durationMs` plus une grâce, et des
      // validations hors budget (jusqu'à une demi-heure) lui feraient lire
      // « résultat absent » pour un enfant qui a réussi. À l'échéance, le
      // signal arrête les validations en cours (`annule`) et le résultat part.
      const result =
        budgetExceeded && delegationBudget
          ? this.resultAfterDelegationBudget(rawResult, delegationBudget)
          : rawResult;
      usage = executionUsageDepuis(usageBefore, capturerExecutionUsage());
      // Échec d'INFRASTRUCTURE : réquisition mid-task si credentials, sinon failover.
      // Le genre se lit sur ce que l'échec DIT, pas sur les logs bruts : la
      // ligne `init` du stream-json porte `apiKeySource`, et un simple 429 y
      // ouvrait une réquisition d'identifiants (shared/texte-d-echec.ts).
      if (!result.success && result.infra) {
        const req = this.requisitionApresEchecInfra(
          texteDEchec(result.logs, result.finalText),
          task.title,
        );
        if (req && workspace && !this.attenteRequisition) {
          conserverWorkspace = true;
          this.attenteRequisition = {
            task,
            repoUrl,
            hiveContext,
            modele,
            effort,
            delegationBudget,
            // Le plafond DÉJÀ jugé tenu : la reprise ne le resonde pas.
            ...(plafond !== undefined ? { plafondCoutMicros: plafond } : {}),
            relecture,
            reseau,
            workspace,
            started,
            ctrl,
            genre: req.genre,
            libelle: req.libelle,
            detail: req.detail,
            autonomie,
            permissionsAllow,
          };
          this.ouvrirRequisition(req.genre, req.libelle, req.detail, task.id);
          this.send({
            type: 'task_update',
            taskId: task.id,
            status: 'running',
            log: '⏸ Réquisition ouverte — en attente de décision humaine (Chambre).',
          });
          this.log(`⏸ ${task.title} : réquisition ${req.genre} — pause`);
          return;
        }
        const raison = HiveNodeClient.raisonAgentIndisponible(
          req?.genre === 'binaire' ? 'agent indisponible (binaire absent)' : 'agent indisponible',
          result,
          caviardeur,
        );
        this.send({ type: 'task_reject', taskId: task.id, reason: raison, infra: true });
        this.log(`⇄ ${task.title} : ${raison} → réaffectation`);
        return;
      }
      // L'adaptateur peut fournir son diff ; sinon le workspace git le calcule.
      const diff = result.diff !== '' ? result.diff : await workspace.collectDiff();
      // La durée est celle de l'AGENT, mesurée avant les validations : elle
      // nourrit la Balance et la chronologie, qui comparent des agents — pas
      // la vitesse des tests du projet.
      const durationMs = Date.now() - started;
      const validations = await this.validerSiProduction(
        task.id,
        result,
        diff,
        workspace,
        ctrl,
        reseauBac,
      );
      // Tronquer aux limites du protocole : un diff/log surdimensionné ferait
      // rejeter le message par le hub (fermeture de connexion) et la tâche
      // bouclerait indéfiniment sans jamais aboutir.
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: result.success,
        // Caviardés AVANT d'être tronqués (voir `declarationsDuResultat`).
        diff: caviardeur.diff(diff).slice(0, LIMITS.diff),
        // Deux têtes, dans cet ordre : la ligne d'un arrêt budgétaire (celle
        // que le parent qui attend lit d'abord), puis le bilan des refus du
        // proxy, puis les logs de l'agent.
        logs: logsDuResultat(
          { ...result, logs: HiveNodeClient.logsAvecReseau(result.logs, reseauTache) },
          diff,
          plafond,
          caviardeur,
        ),
        durationMs,
        subAgents: HiveNodeClient.sousAgentsCaviardes(
          result.subAgents.slice(0, LIMITS.subAgents),
          caviardeur,
        ),
        ...(usage ? { usage } : {}),
        ...declarationsDuResultat(result, caviardeur),
        ...(validations ? { validations } : {}),
      });
      this.log(`${result.success ? '✔' : '✘'} ${task.title}`);
    } catch (err) {
      // Lavé : une exception de git ou d'un adaptateur peut citer une URL à
      // identifiants, et ces logs partent au hub, donc à tout l'écran.
      const message = laverIdentifiantsDuTexte(err instanceof Error ? err.message : String(err));
      usage = usageBefore ? executionUsageDepuis(usageBefore, capturerExecutionUsage()) : undefined;
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: false,
        diff: '',
        logs:
          budgetExceeded && delegationBudget
            ? `[nœud] budget de durée dépassé (${delegationBudget.durationMs} ms)`
            : caviardeur.texte(`[nœud] exception : ${message}`),
        durationMs: Date.now() - started,
        subAgents: [],
        ...(usage ? { usage } : {}),
      });
      this.log(`✘ ${task.title} : ${message}`);
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer);
      // Le proxy de la tâche se ferme avec elle, pause de réquisition
      // comprise : la reprise en rouvre un neuf (`reprendreApresRequisition`).
      await reseauOuvert?.fermer();
      if (!conserverWorkspace) {
        this.active.delete(task.id);
        this.clearDelegationsForParent(task.id);
        if (workspace) this.effacerEspace(task.id, workspace);
      }
    }
  }

  /**
   * Les validations du bac pour CETTE production, ou rien.
   *
   * Seulement quand le diff remis est celui du RÉPERTOIRE — l'adaptateur n'en a
   * pas fourni un à lui. L'adaptateur `shell` simulé rend un diff factice sans
   * rien écrire : valider son répertoire rendrait des verts à propos de la base,
   * attribués à une production qui n'existe pas. Rien non plus sans succès ni
   * diff : un échec est déjà un verdict, et une relecture n'écrit rien.
   */
  private async validerSiProduction(
    taskId: string,
    result: AdapterResult,
    diff: string,
    workspace: Workspace,
    ctrl: AbortController,
    /** Le réseau filtré de la tâche : ses validations tournent derrière le même proxy. */
    reseau?: ReseauBac,
  ): Promise<ValidationsBac | undefined> {
    if (!result.success || result.diff !== '' || diff.trim() === '') return undefined;
    const validations = await validerProduction({
      cwd: workspace.cwd,
      depot:
        workspace.depot && workspace.baseSha
          ? { depot: workspace.depot, baseSha: workspace.baseSha }
          : null,
      // Étiquetés comme la tâche : un nœud tué pendant ses validations laisse
      // des conteneurs que son redémarrage doit ramasser (`ramasserConteneurs`).
      // Le code que l'agent a écrit y tourne : derrière le même réseau que lui.
      ...this.optionBacTache(taskId, reseau),
      // Leurs extraits partent au hub comme les logs : caviardés au nœud (#489).
      caviarder: (texte) => this.caviardeurDuNoeud().texte(texte),
      signal: ctrl.signal,
      surEtape: (log) => this.send({ type: 'task_update', taskId, status: 'running', log }),
    });
    const etats = VALIDATION_KEYS.map((cle) => `${cle} ${validations.controles[cle].etat}`);
    this.log(`validations du bac : ${etats.join(' · ')}`);
    return validations;
  }

  /** Reprend une tâche après réquisition accordée — credentials / binaire prêts. */
  private async reprendreApresRequisition(): Promise<void> {
    const attente = this.attenteRequisition;
    if (!attente) return;
    const {
      task,
      hiveContext,
      modele,
      effort,
      delegationBudget,
      plafondCoutMicros,
      relecture,
      reseau,
      workspace,
      started,
      ctrl,
      genre,
      libelle,
      detail,
      autonomie,
      permissionsAllow,
    } = attente;

    if (genre === 'binaire') {
      const pret = this.opts.verifierBinaireAgent
        ? await this.opts.verifierBinaireAgent()
        : await agentBinairePresent(this.opts.agentType as AgentType);
      if (!pret) {
        // Garder la pause : Accorder ne veut pas dire « le CLI est là ».
        // Relancer tout de suite brûlerait la pause en task_reject ENOENT.
        this.log(`⏸ ${task.title} : binaire toujours absent après Accorder — nouvelle réquisition`);
        this.send({
          type: 'task_update',
          taskId: task.id,
          status: 'running',
          log: '⏸ Binaire toujours absent — installez-le, puis Accordez à nouveau.',
        });
        this.ouvrirRequisition(genre, libelle, detail, task.id);
        return;
      }
    }

    this.attenteRequisition = null;
    this.log(`↻ reprise de ${task.title} après réquisition accordée`);
    let caviardeur = this.caviardeurDuNoeud();
    let budgetExceeded = false;
    let budgetTimer: NodeJS.Timeout | null = null;
    let usage: ExecutionUsage | undefined;
    let usageBefore: ReturnType<typeof capturerExecutionUsage> | null = null;
    let reseauOuvert: Exclude<ReseauTache, { etat: 'impossible' }> | null = null;
    try {
      try {
        process.loadEnvFile('.env');
      } catch {
        /* pas de .env local */
      }
      workspace.env = buildSandboxEnv(workspace.cwd, this.opts.keepEnv ?? []);
      // Relu APRÈS le `.env` : la réquisition accordée vient peut-être d'y
      // poser la clé — c'est elle, désormais, qu'il faut taire.
      caviardeur = this.caviardeurDuNoeud();
      // Un proxy NEUF, qui connaît la clé que la réquisition vient de poser.
      const progres = this.progresVersHub(task.id, ctrl, caviardeur);
      const reseauTache = await this.reseauTache(reseau, attente.repoUrl, workspace, progres);
      if (reseauTache.etat === 'impossible') throw new Error(reseauTache.motif);
      reseauOuvert = reseauTache;
      if (reseauTache.note) progres({ log: reseauTache.note });
      const reseauBac = reseauTache.etat === 'filtre' ? reseauTache.reseau : undefined;
      const taskForAgent = hiveContext
        ? { ...task, prompt: composeAgentPrompt(hiveContext, task.prompt) }
        : task;
      budgetTimer = this.startDelegationBudget(delegationBudget, ctrl, () => {
        budgetExceeded = true;
      });
      usageBefore = capturerExecutionUsage();
      const cwdTache = workspace.cwd;
      const rawResult = await this.adapter.run(taskForAgent, {
        cwd: cwdTache,
        env: reseauTache.env,
        attempt: task.attempts + 1,
        signal: ctrl.signal,
        ...(modele ? { modele } : {}),
        ...(effort ? { effort } : {}),
        ...(plafondCoutMicros !== undefined ? { plafondCoutMicros } : {}),
        ...this.optionBacTache(task.id, reseauBac),
        ...(relecture ? { role: 'relecture' as const } : {}),
        delegate: (input) => this.delegationCaviardee(task.id, input, caviardeur),
        waitForDelegationResult: (childTaskId) =>
          this.waitForDelegationResult(task.id, childTaskId, ctrl.signal),
        rendezVous: this.rendezVous,
        // La politique d'actions (G12) reprend telle qu'à l'assignation.
        ...(permissionsAllow.length > 0 ? { permissionsAllow } : {}),
        decideAction: (action, echeanceRun) =>
          this.deciderActionProposee(
            task.id,
            action,
            cwdTache,
            autonomie,
            ctrl.signal,
            echeanceRun,
          ),
        onProgress: this.progresVersHub(task.id, ctrl, caviardeur),
      });
      // LE BUDGET COURT ENCORE : le minuteur n'est levé qu'au `finally`. Les
      // validations du bac comptent dans la durée d'un enfant délégué — son
      // parent ne l'attend que `durationMs` plus une grâce, et des
      // validations hors budget (jusqu'à une demi-heure) lui feraient lire
      // « résultat absent » pour un enfant qui a réussi. À l'échéance, le
      // signal arrête les validations en cours (`annule`) et le résultat part.
      const result =
        budgetExceeded && delegationBudget
          ? this.resultAfterDelegationBudget(rawResult, delegationBudget)
          : rawResult;
      usage = executionUsageDepuis(usageBefore, capturerExecutionUsage());
      if (!result.success && result.infra) {
        const encore = this.requisitionApresEchecInfra(
          texteDEchec(result.logs, result.finalText),
          task.title,
        );
        if (encore?.genre === 'binaire') {
          this.attenteRequisition = {
            ...attente,
            genre: encore.genre,
            libelle: encore.libelle,
            detail: encore.detail,
          };
          this.ouvrirRequisition(encore.genre, encore.libelle, encore.detail, task.id);
          this.send({
            type: 'task_update',
            taskId: task.id,
            status: 'running',
            log: '⏸ Binaire encore absent après reprise — nouvelle réquisition.',
          });
          this.log(`⏸ ${task.title} : ENOENT à la reprise — pause conservée`);
          return;
        }
        const raison = HiveNodeClient.raisonAgentIndisponible(
          'agent indisponible après réquisition',
          result,
          caviardeur,
        );
        this.send({ type: 'task_reject', taskId: task.id, reason: raison, infra: true });
        this.log(`⇄ ${task.title} : ${raison} → réaffectation`);
        return;
      }
      const diff = result.diff !== '' ? result.diff : await workspace.collectDiff();
      const durationMs = Date.now() - started;
      const validations = await this.validerSiProduction(
        task.id,
        result,
        diff,
        workspace,
        ctrl,
        reseauBac,
      );
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: result.success,
        // Caviardés AVANT d'être tronqués (voir `declarationsDuResultat`).
        diff: caviardeur.diff(diff).slice(0, LIMITS.diff),
        logs: logsDuResultat(
          { ...result, logs: HiveNodeClient.logsAvecReseau(result.logs, reseauTache) },
          diff,
          plafondCoutMicros,
          caviardeur,
        ),
        durationMs,
        subAgents: HiveNodeClient.sousAgentsCaviardes(
          result.subAgents.slice(0, LIMITS.subAgents),
          caviardeur,
        ),
        ...(usage ? { usage } : {}),
        ...declarationsDuResultat(result, caviardeur),
        ...(validations ? { validations } : {}),
      });
      this.log(`${result.success ? '✔' : '✘'} ${task.title} (reprise)`);
    } catch (err) {
      // Lavé : une exception de git ou d'un adaptateur peut citer une URL à
      // identifiants, et ces logs partent au hub, donc à tout l'écran.
      const message = laverIdentifiantsDuTexte(err instanceof Error ? err.message : String(err));
      usage = usageBefore ? executionUsageDepuis(usageBefore, capturerExecutionUsage()) : undefined;
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: false,
        diff: '',
        logs:
          budgetExceeded && delegationBudget
            ? `[nœud] budget de durée dépassé (${delegationBudget.durationMs} ms)`
            : caviardeur.texte(`[nœud] reprise après réquisition : ${message}`),
        durationMs: Date.now() - started,
        subAgents: [],
        ...(usage ? { usage } : {}),
      });
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer);
      await reseauOuvert?.fermer();
      if (!this.attenteRequisition) {
        this.active.delete(task.id);
        this.clearDelegationsForParent(task.id);
        this.effacerEspace(task.id, workspace);
      }
    }
  }

  /** Abandonne la tâche en pause quand la réquisition est refusée. */
  private async abandonnerApresRequisition(statut: string): Promise<void> {
    const attente = this.attenteRequisition;
    if (!attente) return;
    const { task, workspace, started, ctrl } = attente;
    this.attenteRequisition = null;
    ctrl.abort();
    this.send({
      type: 'task_result',
      taskId: task.id,
      success: false,
      diff: '',
      logs: `[nœud] réquisition ${statut} — tâche interrompue`,
      durationMs: Date.now() - started,
      subAgents: [],
    });
    this.log(`✘ ${task.title} : réquisition ${statut}`);
    this.active.delete(task.id);
    this.clearDelegationsForParent(task.id);
    this.effacerEspace(task.id, workspace);
  }

  /** Efface le dossier d'une tâche finie, en le disant à sa tentative suivante (`effacements`). */
  private effacerEspace(taskId: string, workspace: Workspace): void {
    const fini = workspace.cleanup().finally(() => {
      if (this.effacements.get(taskId) === fini) this.effacements.delete(taskId);
    });
    this.effacements.set(taskId, fini);
  }

  // ─── Merge (Honeycomb Merge, Palier 3) ───────────────────────────────────
  /** Consentement de l'opérateur à pousser (cf. `NodeClientOptions.pousseLivraisons`). */
  private pousseLivraisons(): boolean {
    return this.opts.pousseLivraisons ?? pousseeConsentie(process.env);
  }

  /**
   * Le dépôt DURABLE des livraisons d'un projet sur ce nœud.
   *
   * `projectId` est validé (ID_PATTERN) par le protocole ; le confinement sous
   * `<workRoot>/livraisons` est la seconde barrière, au plus près de l'écriture
   * — même règle que le répertoire d'une tâche (`prepareWorkspace`).
   */
  private depotDeLivraisons(projectId: string): string {
    const racine = path.resolve(this.workRoot, 'livraisons');
    const depot = path.resolve(racine, `${segmentSur(projectId)}.git`);
    if (!depot.startsWith(racine + path.sep)) {
      throw new Error(`projet hors du répertoire des livraisons : ${projectId}`);
    }
    return depot;
  }

  /**
   * Exécute un merge demandé par le hub : clone le dépôt, applique les diffs dans
   * l'ordre (conflits git réels détectés), lance éventuellement les tests, et
   * remonte le résultat. Sans demande de livraison, ne commit ni ne push
   * (revue humaine) ; avec, commite la mission sur sa branche et ne la pousse
   * que si l'opérateur de CE nœud y a consenti.
   */
  private async runMergeJob(msg: AssignMergeMsg): Promise<void> {
    // Anti-doublon : un hub qui réémet le même mergeId ne doit pas lancer deux
    // jobs concurrents sur le même répertoire (course effacement/clone).
    if (this.activeMerges.has(msg.mergeId)) return;
    // Night Shift : un merge (clone + application des diffs + tests) est du
    // travail au même titre qu'une tâche — refusé hors heures de service.
    const offShift = this.offShiftReject();
    if (offShift) {
      // `refused` : le hub le traite en merge_failed explicite — jamais en
      // succès vide qui écraserait le dernier vrai résultat.
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: `[nœud] ${offShift.reason} : merge refusé (Night Shift)`,
        refused: offShift.reason,
      });
      this.log(`⏾ merge ${msg.mergeId.slice(0, 8)}… : ${offShift.reason} → refus`);
      return;
    }
    // La commande de test s'exécute ICI, sur cette machine. `runMerge` la
    // refuse aussi (c'est la garde qui fait foi) ; on la juge en amont pour ne
    // pas cloner un dépôt pour rien et pour rendre le refus lisible à l'hôte —
    // un « échec du merge » générique ne lui dirait pas qu'on vient de lui
    // demander de lancer un binaire arbitraire.
    //
    // La préparation est jugée ici AUSSI, et pour la même raison : elle
    // s'exécute sur cette machine, et une installation exécute les scripts de
    // ce qu'elle installe.
    const refus = [
      msg.testCommand ? { quoi: 'commande de test', v: jugerCommandeTest(msg.testCommand) } : null,
      msg.prepareCommand ? { quoi: 'préparation', v: jugerPreparation(msg.prepareCommand) } : null,
    ].find((c) => c && !c.v.ok);
    if (refus && !refus.v.ok) {
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: `[nœud] ${refus.quoi} refusée : ${refus.v.motif}`,
        refused: `${refus.quoi} refusée`,
      });
      this.log(`✘ merge ${msg.mergeId.slice(0, 8)}… : ${refus.v.motif}`);
      return;
    }
    const annulation = new AbortController();
    this.activeMerges.set(msg.mergeId, annulation);
    // mergeId est validé (ID_PATTERN) par le protocole → sans séparateur ni
    // remontée ; `segmentSur` écarte les noms que Windows réserve (`aux`…).
    const dir = path.join(
      this.workRoot,
      'merges',
      segmentSur(this.nodeId ? `${msg.mergeId}-${this.nodeId.slice(0, 8)}` : msg.mergeId),
    );
    this.log(
      `merge ${msg.mergeId.slice(0, 8)}… : clone + intégration de ${msg.diffs.length} diff(s)`,
    );
    // Ce que le merge renvoie part au hub, donc à tout l'écran : caviardé ICI,
    // comme le chemin d'une tâche (#489) — la commande de test exécute le code
    // du dépôt, qui peut imprimer une clé lue sur cette machine.
    const caviardeur = this.caviardeurDuNoeud();
    try {
      await effacerDossier(dir);
      mkdirSync(path.dirname(dir), { recursive: true });
      await cloneRepo(dir, msg.repoUrl);
      const result = await runMerge({
        repoDir: dir,
        diffs: msg.diffs,
        ...(msg.prepareCommand ? { prepareCommand: msg.prepareCommand } : {}),
        ...(msg.testCommand ? { testCommand: msg.testCommand } : {}),
        // Le bac à sable du nœud suit le merge : la commande de test exécute du
        // code du dépôt, au même titre qu'un agent.
        ...this.optionBacTache(),
        caviarder: (texte) => caviardeur.texte(texte),
        signal: annulation.signal,
        ...(msg.livraison
          ? {
              livraison: {
                demande: msg.livraison,
                // L'adresse validée par le protocole, celle qu'on vient de
                // cloner : la seule vers laquelle la livraison liste et pousse.
                depotProjet: msg.repoUrl,
                depotLocal: this.depotDeLivraisons(msg.livraison.projectId),
                pousseeConsentie: this.pousseLivraisons(),
              },
            }
          : {}),
      });
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: result.applied,
        conflicts: result.conflicts,
        mergedDiff: caviardeur.diff(result.mergedDiff).slice(0, LIMITS.diff),
        testsRun: result.testsRun,
        testsPassed: result.testsPassed,
        preparedOk: result.preparedOk,
        logs: result.logs.slice(0, LIMITS.log),
        ...(result.livraison ? { livraison: result.livraison } : {}),
      });
      this.log(
        `merge ${msg.mergeId.slice(0, 8)} : ${result.applied.length} appliqué(s), ${result.conflicts.length} conflit(s)`,
      );
    } catch (err) {
      // `refused`, là aussi : ce merge n'a PAS EU LIEU (clone refusé —
      // identifiants, dépôt introuvable, réseau — ou `runMerge` qui a jeté).
      // Sans lui, le hub rangeait `applied: [], conflicts: []` en
      // `merge_completed`, et l'écran lisait « 0 diff(s) appliqué(s), 0
      // conflit(s) » : un succès vide, la cause enfouie dans un journal replié
      // (mesuré de bout en bout : tests/workflow-git.test.ts).
      //
      // LAVÉ : un clone refusé cite l'URL du dépôt, identifiants compris quand
      // ils y sont écrits — et ce texte part au hub, donc à tout l'écran.
      const brut = err instanceof Error ? err.message : String(err);
      const message = motifLave(brut);
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: caviardeur.texte(`[nœud] échec du merge : ${message}`),
        refused: 'échec du merge sur le nœud',
        ...(msg.livraison
          ? { livraison: { etat: 'non_commitee', motif: motifLave(`échec du merge : ${brut}`) } }
          : {}),
      });
      this.log(`✘ merge ${msg.mergeId.slice(0, 8)} : ${message}`);
    } finally {
      this.activeMerges.delete(msg.mergeId);
      await this.effacerReste(dir);
    }
  }

  /**
   * Un CHANTIER : cloner le dépôt, et lancer un travail qu'il DÉCLARE.
   *
   * ─── LA GARDE QUI COMPTE EST ICI, PAS DANS LE HUB ──────────────────────────
   *
   * Le hub a déjà jugé, et son verdict ne suffit pas. Un nœud ne doit pas tenir
   * pour acquis que le hub est bien celui qu'il croit : le jeton de ruche est
   * partagé, les anciennes invitations le portent en clair, et le transport
   * peut être un `ws://` de réseau local. C'est le raisonnement exact qui a
   * fait naître la double garde de `runMerge`, et il vaut à l'identique.
   *
   * Ce qui change tout, ici : le message ne porte AUCUNE commande. Il porte un
   * NOM, et c'est le `package.json` DU CLONE — donc le dépôt lui-même — qui dit
   * ce que ce nom exécute. Un hub compromis ne peut donc désigner que ce que le
   * dépôt déclare déjà. C'est une frontière plus solide que n'importe quelle
   * liste de binaires autorisés, parce qu'elle ne repose sur rien qu'on puisse
   * fournir.
   */
  private async runChantierJob(msg: AssignChantierMsg): Promise<void> {
    // Anti-doublon : un hub qui réémet le même id ne doit pas lancer deux
    // travaux concurrents dans le même répertoire (course effacement/clone).
    if (this.activeChantiers.has(msg.chantierId)) return;

    const refuser = (raison: string, sortie = ''): void => {
      this.send({
        type: 'chantier_result',
        chantierId: msg.chantierId,
        nom: msg.nom,
        code: null,
        sortie,
        ok: false,
        refused: raison,
      });
      this.log(`✘ chantier « ${msg.nom} » : ${raison}`);
    };

    // Night Shift : un chantier est du travail au même titre qu'un merge.
    const offShift = this.offShiftReject();
    if (offShift) {
      refuser(offShift.reason, `[nœud] ${offShift.reason} : chantier refusé (Night Shift)`);
      return;
    }
    // La préparation s'exécute ICI : une installation exécute les scripts de ce
    // qu'elle installe, et la juger en amont évite de cloner pour rien.
    if (msg.prepareCommand) {
      const v = jugerPreparation(msg.prepareCommand);
      if (!v.ok) {
        refuser('préparation refusée', `[nœud] préparation refusée : ${v.motif}`);
        return;
      }
    }

    const annulation = new AbortController();
    this.activeChantiers.set(msg.chantierId, annulation);
    // La sortie d'un chantier part au hub comme les logs d'une tâche : le
    // script déclaré exécute le code du dépôt. Caviardée ICI (#489), ENTIÈRE,
    // avant toute coupe — une coupe d'abord laisserait la moitié d'une clé.
    const caviardeur = this.caviardeurDuNoeud();
    // chantierId est validé (ID_PATTERN) par le protocole → sans séparateur
    // ni remontée ; `segmentSur` écarte les noms que Windows réserve.
    const dir = path.join(
      this.workRoot,
      'chantiers',
      segmentSur(this.nodeId ? `${msg.chantierId}-${this.nodeId.slice(0, 8)}` : msg.chantierId),
    );
    this.log(`chantier « ${msg.nom} » : clone puis lancement`);
    try {
      await effacerDossier(dir);
      mkdirSync(path.dirname(dir), { recursive: true });
      await cloneRepo(dir, msg.repoUrl);

      // ─── LE DÉPÔT DÉCIDE ────────────────────────────────────────────────
      let scripts: Record<string, string> = {};
      try {
        const brut: unknown = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
        // loupe : équivalent — && → ||. Le `catch` de ce bloc rend
        // `scripts = {}`, et la garde de la ligne suivante y mène aussi. Mué,
        // un `package.json` valant `null` lève à l'indexation et retombe dans
        // le même `{}`.
        const bloc =
          typeof brut === 'object' && brut !== null
            ? (brut as Record<string, unknown>).scripts
            : null;
        // loupe : équivalent — && → ||. Même raison : `Object.entries(null)`
        // lève, le `catch` rend `{}`, et c'est ce que la garde produisait.
        if (typeof bloc === 'object' && bloc !== null) {
          for (const [k, v] of Object.entries(bloc)) {
            if (typeof v === 'string') scripts[k] = v;
          }
        }
      } catch {
        // Pas de `package.json`, ou illisible : aucun script n'est déclaré.
        // `jugerChantier` le dira mieux que nous, avec le bon message.
        scripts = {};
      }

      const verdict = jugerChantier(scripts, msg.nom);
      if (!verdict.ok) {
        refuser('chantier non déclaré', `[nœud] ${verdict.motif}`);
        return;
      }

      const env = buildSandboxEnv(dir);
      const lancer = async (argv: string[], delaiMs: number) => {
        const r = await runProc(
          argv,
          dir,
          env,
          delaiMs,
          annulation.signal,
          this.optionBacTache().bac,
        );
        return { ...r, output: caviardeur.texte(r.output) };
      };
      if (msg.prepareCommand && msg.prepareCommand.length > 0) {
        const prep = await lancer(msg.prepareCommand, CHANTIER_PREPARATION_MS);
        // ET SI ELLE ÉCHOUE, ON NE LANCE PAS. Un `npm run test` sur un clone
        // sans `node_modules` échoue pour une raison qui n'a rien à voir avec
        // le code, et le remonter comme un échec de chantier enverrait l'hôte
        // chercher une régression qui n'existe pas.
        if (prep.code !== 0) {
          this.send({
            type: 'chantier_result',
            chantierId: msg.chantierId,
            nom: msg.nom,
            code: prep.code,
            sortie:
              `[nœud] l’environnement n’a pas pu être préparé (code ${prep.code}). Le code du ` +
              `dépôt n’est PAS en cause : vérifiez le réseau de ce nœud, puis son lockfile.\n` +
              prep.output.slice(0, LIMITS.log / 2),
            ok: false,
            refused: 'préparation en échec',
          });
          this.log(`✘ chantier « ${msg.nom} » : préparation en échec`);
          return;
        }
      }

      const { code, output } = await lancer(argvDe(msg.nom), CHANTIER_EXECUTION_MS);
      this.send({
        type: 'chantier_result',
        chantierId: msg.chantierId,
        nom: msg.nom,
        code,
        sortie: output.slice(0, LIMITS.log),
        ok: code === 0,
      });
      this.log(`chantier « ${msg.nom} » : code ${String(code)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        type: 'chantier_result',
        chantierId: msg.chantierId,
        nom: msg.nom,
        code: null,
        sortie: caviardeur.texte(`[nœud] échec du chantier : ${message}`),
        ok: false,
      });
      this.log(`✘ chantier « ${msg.nom} » : ${message}`);
    } finally {
      this.activeChantiers.delete(msg.chantierId);
      await this.effacerReste(dir);
    }
  }

  /**
   * Efface le clone d'un merge ou d'un chantier FINI. Son résultat est parti :
   * un dossier qui résiste ne le change pas — mais il est dit au journal du
   * nœud, au lieu de lever depuis un `finally` en rejet de promesse orphelin.
   */
  private async effacerReste(dir: string): Promise<void> {
    await effacerDossier(dir).catch((e: unknown) => {
      this.log(`dossier non effacé : ${dir} (${(e as NodeJS.ErrnoException).code ?? String(e)})`);
    });
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
    // Déconnecté : le message est perdu, mais l'orchestrateur réaffectera la
    // tâche (reap) et l'idempotence des résultats couvre le reste.
  }

  private log(message: string): void {
    if (!this.opts.quiet) console.log(`🐝 [${this.opts.name}] ${message}`);
  }
}
