// Client de nœud membre : rejoint la ruche en WebSocket, reçoit des tâches
// poussées par l'orchestrateur, les exécute via un AgentAdapter dans un
// workspace isolé, remonte progrès et résultats. Reconnexion automatique
// avec backoff exponentiel ; heartbeat découplé de l'exécution.
// Consentement (§5.3) : rien ne s'exécute tant que le membre n'a pas lancé
// ce client lui-même.

import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket from 'ws';
import { getAdapter } from '../adapters/index.js';
import type { AdapterResult, AgentAdapter } from '../adapters/index.js';
import {
  agentBinairePresent,
  estAgentType,
  requisitionSiCredentialsManquantes,
} from './agent-detect.js';
import type { AgentType } from './agent-detect.js';
import { argvDe, jugerChantier } from '../shared/chantier.js';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { jugerPreparation } from '../shared/preparation.js';
import { isOnShift, minutesUntilOpen, nightShiftFromEnv } from '../shared/night-shift.js';
import type { NightShiftPolicy } from '../shared/night-shift.js';
import { plateformeDepuis } from '../shared/machine.js';
import { ID_PATTERN, LIMITS, parseServerMessage } from '../shared/protocol.js';
import type {
  AssignChantierMsg,
  AssignMergeMsg,
  ClientMessage,
  DelegationBudget,
  DelegationAcceptedMsg,
  DelegationRejectedMsg,
  DelegationResultMsg,
  OutilConstate,
  PoserOutilMsg,
} from '../shared/protocol.js';
import { HEARTBEAT_INTERVAL_MS, NODE_TIMEOUT_MS } from '../shared/types.js';
import type { ExecutionUsage, IsolementDeclare, Task } from '../shared/types.js';
import { runMerge, runProc } from './merge-runner.js';
import { lancerVraiment, poserOutil } from './pose-runner.js';
import { buildSandboxEnv, cloneRepo, prepareWorkspace } from './workspace.js';
import { requisitionDepuisEchecInfra } from '../shared/requisition-infra.js';
import { motifRefusPresence, refuseParPresence } from '../shared/presence-noeud.js';
import type { Fournisseur } from './isolement.js';
import type { Workspace } from './workspace.js';
import type {
  WorkerDelegationInput,
  WorkerDelegationOutcome,
  WorkerDelegationResult,
} from '../adapters/index.js';
import { capturerExecutionUsage, executionUsageDepuis } from './execution-usage.js';

const MAX_PENDING_DELEGATIONS = 32;
const MAX_ACCEPTED_DELEGATIONS = 128;
const DELEGATION_RESPONSE_TIMEOUT_MS = 15_000;
/**
 * La durée demandée est un budget de travail, pas une garantie de latence :
 * l'enfant peut attendre dans la file ou consommer des retries. On garde donc
 * une marge, tout en restant borné par le plafond de transport accepté.
 */
const DELEGATION_RESULT_GRACE_MS = 5 * 60_000;

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
  bac?: { fournisseur: Fournisseur; variables: readonly string[]; image: string };
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
}

/**
 * Préfixe le contexte Hive Mind au prompt d'une tâche, pour l'agent. Le prompt
 * d'origine n'est JAMAIS tronqué : ce prompt augmenté reste local (exécuté par
 * l'adaptateur), il ne repart pas au hub — aucune contrainte de taille protocole.
 */
export function composeAgentPrompt(hiveContext: string | undefined, prompt: string): string {
  return hiveContext ? `${hiveContext}\n\n${prompt}` : prompt;
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
  /** Merges en cours (par mergeId) — anti-doublon si le hub réémet le même id. */
  private readonly activeMerges = new Set<string>();
  private readonly activeChantiers = new Set<string>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  /** Évite de spammer la Chambre à chaque reconnexion WebSocket. */
  private requisitionCredentialEnvoyee = false;
  /** Tâche en pause le temps qu'un humain tranche une réquisition (boucle B/C/D). */
  private attenteRequisition: {
    task: Task;
    repoUrl: string | null;
    hiveContext?: string;
    modele?: string;
    delegationBudget?: DelegationBudget;
    workspace: Workspace;
    started: number;
    ctrl: AbortController;
    /** Genre de la réquisition qui a mis en pause (cle_api | binaire | …). */
    genre: string;
    libelle: string;
    detail?: string;
  } | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1_000;
  private closed = false;
  /** Veille de la connexion : pings de vie et constat du silence du hub. */
  private vigieTimer: NodeJS.Timeout | null = null;
  /** Dernière fois que le hub a donné signe de vie (message ou pong). */
  private derniereNouvelle = 0;
  private readonly adapter: AgentAdapter;
  private readonly workRoot: string;

  /**
   * Arma la seule limite d'exécution actuellement consommée côté Worker.
   * `costMicros` et `resourceUnits` restent transportés comme faits demandés
   * jusqu'à ce que les adaptateurs sachent les mesurer réellement.
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
    this.workRoot =
      opts.workRoot ?? path.join('.hive-work', opts.name.replace(/[^A-Za-z0-9_-]+/g, '_'));
  }

  /** Rejoint la ruche (et retente sans fin tant que stop() n'est pas appelé). */
  start(): void {
    this.closed = false;
    this.warnIfInsecureTransport();
    this.connect();
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
    this.rejectPendingDelegations('client arrêté');
    this.stopHeartbeat();
    this.arreterVeille();
    this.ws?.close(1000, 'arrêt du nœud');
    this.ws = null;
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

  private clearAcceptedDelegation(childTaskId: string): void {
    const accepted = this.acceptedDelegations.get(childTaskId);
    if (!accepted) return;
    clearTimeout(accepted.timer);
    this.acceptedDelegations.delete(childTaskId);
  }

  /**
   * Nettoie les enfants d'un parent qui vient de quitter son tour. Un Worker
   * qui choisit de ne pas attendre un enfant ne doit pas laisser une entrée
   * vivre jusqu'à la prochaine reconnexion du nœud.
   */
  private clearDelegationsForParent(parentTaskId: string): void {
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
        // Les modèles déclarés, s'il y en a. Absents : le hub n'invente rien et
        // ordonnance comme avant l'Aiguillage (même règle que la plateforme).
        ...(this.opts.modeles && this.opts.modeles.length > 0
          ? { modeles: this.opts.modeles }
          : {}),
        // Ce que ce poste porte réellement — des CONSTATS, pas un verdict. Le
        // hub en tire sa conclusion avec son catalogue ; ici on ne fait que
        // rapporter ce qu'on a vu. Absent tant que le diagnostic n'a pas
        // tourné : un tableau vide se lirait comme « rien d'installé ».
        ...(this.outilsConstates ? { outils: this.outilsConstates } : {}),
        // Le bac à sable où les tâches tourneront — redit à CHAQUE inscription :
        // le hub efface une déclaration qui n'est pas répétée.
        ...(this.opts.isolement ? { isolement: this.opts.isolement } : {}),
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
        break;
      case 'assign_task':
        void this.runTask(
          msg.task,
          msg.repoUrl ?? null,
          msg.hiveContext,
          msg.modele,
          msg.delegationBudget,
        );
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
      case 'requisition_ack':
        this.log(`réquisition ouverte (${msg.id.slice(0, 8)}…) — ${msg.genre} : ${msg.libelle}`);
        break;
      case 'requisition_result':
        this.log(`réquisition ${msg.id.slice(0, 8)}… : ${msg.statut}`);
        if (this.attenteRequisition) {
          if (msg.statut === 'accordee') void this.reprendreApresRequisition();
          else void this.abandonnerApresRequisition(msg.statut);
        }
        break;
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
    const req = requisitionSiCredentialsManquantes(agent);
    if (!req) return;
    this.requisitionCredentialEnvoyee = true;
    this.ouvrirRequisition(req.genre, req.libelle, req.detail);
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

  // ─── Exécution d'une tâche ───────────────────────────────────────────────
  private async runTask(
    task: Task,
    repoUrl: string | null,
    hiveContext?: string,
    modele?: string,
    delegationBudget?: DelegationBudget,
  ): Promise<void> {
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
    if (this.active.size >= this.opts.maxConcurrency) {
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

    const ctrl = new AbortController();
    this.active.set(task.id, ctrl);
    const started = Date.now();
    let budgetExceeded = false;
    let budgetTimer: NodeJS.Timeout | null = null;
    let usage: ExecutionUsage | undefined;
    let usageBefore: ReturnType<typeof capturerExecutionUsage> | null = null;
    this.send({ type: 'task_update', taskId: task.id, status: 'running' });
    this.log(`butinage : ${task.title} (tentative ${task.attempts + 1})`);

    let workspace: Workspace | null = null;
    let conserverWorkspace = false;
    try {
      workspace = await prepareWorkspace(
        this.workRoot,
        task,
        repoUrl,
        this.opts.keepEnv ?? [],
        // Isole le répertoire par nœud : deux drones d'une même course sur une
        // même machine (workRoot partagé) ne se marchent pas dessus.
        this.nodeId ? this.nodeId.slice(0, 8) : '',
      );
      // Hive Mind : le contexte reçu du hub est préfixé au prompt pour l'agent.
      // On n'altère que la copie transmise à l'adaptateur (chemins/branche du
      // workspace restent construits sur la tâche d'origine).
      const taskForAgent = hiveContext
        ? { ...task, prompt: composeAgentPrompt(hiveContext, task.prompt) }
        : task;
      budgetTimer = this.startDelegationBudget(delegationBudget, ctrl, () => {
        budgetExceeded = true;
      });
      usageBefore = capturerExecutionUsage();
      const rawResult = await this.adapter.run(taskForAgent, {
        cwd: workspace.cwd,
        env: workspace.env,
        attempt: task.attempts + 1,
        signal: ctrl.signal,
        // Le modèle choisi par l'Aiguillage, s'il en a envoyé un : l'adaptateur
        // le passera à son CLI (`--model`). Absent ⇒ modèle par défaut de l'agent.
        ...(modele ? { modele } : {}),
        ...(this.opts.bac ? { bac: this.opts.bac } : {}),
        delegate: (input) => this.requestDelegation(task.id, input),
        waitForDelegationResult: (childTaskId) =>
          this.waitForDelegationResult(task.id, childTaskId, ctrl.signal),
        onProgress: (p) => {
          this.send({
            type: 'task_update',
            taskId: task.id,
            status: 'running',
            ...(p.subAgents ? { subAgents: p.subAgents } : {}),
            ...(p.presences ? { presences: p.presences } : {}),
            ...(p.log ? { log: p.log } : {}),
          });
        },
      });
      if (budgetTimer) {
        clearTimeout(budgetTimer);
        budgetTimer = null;
      }
      const result =
        budgetExceeded && delegationBudget
          ? this.resultAfterDelegationBudget(rawResult, delegationBudget)
          : rawResult;
      usage = executionUsageDepuis(usageBefore, capturerExecutionUsage());
      // Échec d'INFRASTRUCTURE : réquisition mid-task si credentials, sinon failover.
      if (!result.success && result.infra) {
        const req = requisitionDepuisEchecInfra(this.opts.agentType, result.logs, task.title);
        if (req && workspace && !this.attenteRequisition) {
          conserverWorkspace = true;
          this.attenteRequisition = {
            task,
            repoUrl,
            hiveContext,
            modele,
            delegationBudget,
            workspace,
            started,
            ctrl,
            genre: req.genre,
            libelle: req.libelle,
            detail: req.detail,
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
        this.send({
          type: 'task_reject',
          taskId: task.id,
          reason:
            req?.genre === 'binaire'
              ? 'agent indisponible (binaire absent)'
              : 'agent indisponible (auth/quota)',
          infra: true,
        });
        this.log(`⇄ ${task.title} : agent indisponible → réaffectation`);
        return;
      }
      // L'adaptateur peut fournir son diff ; sinon le workspace git le calcule.
      const diff = result.diff !== '' ? result.diff : await workspace.collectDiff();
      // Tronquer aux limites du protocole : un diff/log surdimensionné ferait
      // rejeter le message par le hub (fermeture de connexion) et la tâche
      // bouclerait indéfiniment sans jamais aboutir.
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: result.success,
        diff: diff.slice(0, LIMITS.diff),
        logs: result.logs.slice(0, LIMITS.log),
        durationMs: Date.now() - started,
        subAgents: result.subAgents.slice(0, LIMITS.subAgents),
        ...(usage ? { usage } : {}),
        ...(result.fournisseur ? { fournisseur: result.fournisseur } : {}),
      });
      this.log(`${result.success ? '✔' : '✘'} ${task.title}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      usage = usageBefore ? executionUsageDepuis(usageBefore, capturerExecutionUsage()) : undefined;
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: false,
        diff: '',
        logs:
          budgetExceeded && delegationBudget
            ? `[nœud] budget de durée dépassé (${delegationBudget.durationMs} ms)`
            : `[nœud] exception : ${message}`,
        durationMs: Date.now() - started,
        subAgents: [],
        ...(usage ? { usage } : {}),
      });
      this.log(`✘ ${task.title} : ${message}`);
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer);
      if (!conserverWorkspace) {
        this.active.delete(task.id);
        this.clearDelegationsForParent(task.id);
        workspace?.cleanup();
      }
    }
  }

  /** Reprend une tâche après réquisition accordée — credentials / binaire prêts. */
  private async reprendreApresRequisition(): Promise<void> {
    const attente = this.attenteRequisition;
    if (!attente) return;
    const {
      task,
      hiveContext,
      modele,
      delegationBudget,
      workspace,
      started,
      ctrl,
      genre,
      libelle,
      detail,
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
    let budgetExceeded = false;
    let budgetTimer: NodeJS.Timeout | null = null;
    let usage: ExecutionUsage | undefined;
    let usageBefore: ReturnType<typeof capturerExecutionUsage> | null = null;
    try {
      try {
        process.loadEnvFile('.env');
      } catch {
        /* pas de .env local */
      }
      workspace.env = buildSandboxEnv(workspace.cwd, this.opts.keepEnv ?? []);
      const taskForAgent = hiveContext
        ? { ...task, prompt: composeAgentPrompt(hiveContext, task.prompt) }
        : task;
      budgetTimer = this.startDelegationBudget(delegationBudget, ctrl, () => {
        budgetExceeded = true;
      });
      usageBefore = capturerExecutionUsage();
      const rawResult = await this.adapter.run(taskForAgent, {
        cwd: workspace.cwd,
        env: workspace.env,
        attempt: task.attempts + 1,
        signal: ctrl.signal,
        ...(modele ? { modele } : {}),
        ...(this.opts.bac ? { bac: this.opts.bac } : {}),
        delegate: (input) => this.requestDelegation(task.id, input),
        waitForDelegationResult: (childTaskId) =>
          this.waitForDelegationResult(task.id, childTaskId, ctrl.signal),
        onProgress: (p) => {
          this.send({
            type: 'task_update',
            taskId: task.id,
            status: 'running',
            ...(p.subAgents ? { subAgents: p.subAgents } : {}),
            ...(p.presences ? { presences: p.presences } : {}),
            ...(p.log ? { log: p.log } : {}),
          });
        },
      });
      if (budgetTimer) {
        clearTimeout(budgetTimer);
        budgetTimer = null;
      }
      const result =
        budgetExceeded && delegationBudget
          ? this.resultAfterDelegationBudget(rawResult, delegationBudget)
          : rawResult;
      usage = executionUsageDepuis(usageBefore, capturerExecutionUsage());
      if (!result.success && result.infra) {
        const encore = requisitionDepuisEchecInfra(this.opts.agentType, result.logs, task.title);
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
        this.send({
          type: 'task_reject',
          taskId: task.id,
          reason: 'agent indisponible après réquisition',
          infra: true,
        });
        return;
      }
      const diff = result.diff !== '' ? result.diff : await workspace.collectDiff();
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: result.success,
        diff: diff.slice(0, LIMITS.diff),
        logs: result.logs.slice(0, LIMITS.log),
        durationMs: Date.now() - started,
        subAgents: result.subAgents.slice(0, LIMITS.subAgents),
        ...(usage ? { usage } : {}),
      });
      this.log(`${result.success ? '✔' : '✘'} ${task.title} (reprise)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      usage = usageBefore ? executionUsageDepuis(usageBefore, capturerExecutionUsage()) : undefined;
      this.send({
        type: 'task_result',
        taskId: task.id,
        success: false,
        diff: '',
        logs:
          budgetExceeded && delegationBudget
            ? `[nœud] budget de durée dépassé (${delegationBudget.durationMs} ms)`
            : `[nœud] reprise après réquisition : ${message}`,
        durationMs: Date.now() - started,
        subAgents: [],
        ...(usage ? { usage } : {}),
      });
    } finally {
      if (budgetTimer) clearTimeout(budgetTimer);
      if (!this.attenteRequisition) {
        this.active.delete(task.id);
        this.clearDelegationsForParent(task.id);
        workspace.cleanup();
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
    workspace.cleanup();
  }

  // ─── Merge (Honeycomb Merge, Palier 3) ───────────────────────────────────
  /**
   * Exécute un merge demandé par le hub : clone le dépôt, applique les diffs dans
   * l'ordre (conflits git réels détectés), lance éventuellement les tests, et
   * remonte le résultat. Ne commit ni ne push jamais (revue humaine).
   */
  private async runMergeJob(msg: AssignMergeMsg): Promise<void> {
    // Anti-doublon : un hub qui réémet le même mergeId ne doit pas lancer deux
    // jobs concurrents sur le même répertoire (course rmSync/clone).
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
    this.activeMerges.add(msg.mergeId);
    // mergeId est validé (ID_PATTERN) par le protocole → sûr comme composant de chemin.
    const dir = path.join(
      this.workRoot,
      'merges',
      this.nodeId ? `${msg.mergeId}-${this.nodeId.slice(0, 8)}` : msg.mergeId,
    );
    const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
    this.log(
      `merge ${msg.mergeId.slice(0, 8)}… : clone + intégration de ${msg.diffs.length} diff(s)`,
    );
    try {
      rmSync(dir, rmOpts);
      mkdirSync(path.dirname(dir), { recursive: true });
      await cloneRepo(dir, msg.repoUrl);
      const result = await runMerge({
        repoDir: dir,
        diffs: msg.diffs,
        ...(msg.prepareCommand ? { prepareCommand: msg.prepareCommand } : {}),
        ...(msg.testCommand ? { testCommand: msg.testCommand } : {}),
        // Le bac à sable du nœud suit le merge : la commande de test exécute du
        // code du dépôt, au même titre qu'un agent.
        ...(this.opts.bac ? { bac: this.opts.bac } : {}),
      });
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: result.applied,
        conflicts: result.conflicts,
        mergedDiff: result.mergedDiff.slice(0, LIMITS.diff),
        testsRun: result.testsRun,
        testsPassed: result.testsPassed,
        preparedOk: result.preparedOk,
        logs: result.logs.slice(0, LIMITS.log),
      });
      this.log(
        `merge ${msg.mergeId.slice(0, 8)} : ${result.applied.length} appliqué(s), ${result.conflicts.length} conflit(s)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        type: 'merge_result',
        mergeId: msg.mergeId,
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: `[nœud] échec du merge : ${message}`,
      });
      this.log(`✘ merge ${msg.mergeId.slice(0, 8)} : ${message}`);
    } finally {
      this.activeMerges.delete(msg.mergeId);
      rmSync(dir, rmOpts);
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
    // travaux concurrents dans le même répertoire (course rmSync/clone).
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

    this.activeChantiers.add(msg.chantierId);
    // chantierId est validé (ID_PATTERN) par le protocole → sûr en chemin.
    const dir = path.join(
      this.workRoot,
      'chantiers',
      this.nodeId ? `${msg.chantierId}-${this.nodeId.slice(0, 8)}` : msg.chantierId,
    );
    const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
    this.log(`chantier « ${msg.nom} » : clone puis lancement`);
    try {
      rmSync(dir, rmOpts);
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
      if (msg.prepareCommand && msg.prepareCommand.length > 0) {
        const prep = await runProc(
          msg.prepareCommand,
          dir,
          env,
          10 * 60_000,
          undefined,
          this.opts.bac ? this.opts.bac : undefined,
        );
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

      const { code, output } = await runProc(
        argvDe(msg.nom),
        dir,
        env,
        15 * 60_000,
        undefined,
        this.opts.bac ? this.opts.bac : undefined,
      );
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
        sortie: `[nœud] échec du chantier : ${message}`,
        ok: false,
      });
      this.log(`✘ chantier « ${msg.nom} » : ${message}`);
    } finally {
      this.activeChantiers.delete(msg.chantierId);
      rmSync(dir, rmOpts);
    }
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
