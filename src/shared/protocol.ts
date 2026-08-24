// Protocole WebSocket typé entre nœuds, dashboard et orchestrateur.
// Chaque message entrant est validé champ par champ — jamais de confiance aveugle.

import { nomDeChantierValide } from './chantier.js';
import { estPlateforme } from './machine.js';
import type { PlateformeNoeud } from './machine.js';
import type { PresenceFichier } from './presence.js';
import type { HiveEvent, StateSnapshot, SubAgent, Task } from './types.js';

// ─── Limites de taille (validation d'entrée) ─────────────────────────────────
export const LIMITS = {
  /** Taille max d'un message WS — alignée sur maxPayload du serveur ws. */
  message: 2 * 1024 * 1024,
  /**
   * Taille max d'un message WS **avant authentification**.
   *
   * 2 Mo est la bonne limite pour un nœud authentifié : il remonte des diffs.
   * C'était la mauvaise pour un inconnu. Le hub appelait `parseClientMessage`
   * — donc `toString()` puis `JSON.parse` sur 2 Mo — AVANT de savoir à qui il
   * parlait. Sans le moindre identifiant, à 100 messages par seconde et par
   * socket pendant les 5 s de la fenêtre d'authentification, cela faisait
   * 1 Go à analyser par connexion, et rien ne borne le nombre de connexions.
   *
   * Un message d'authentification est minuscule : un identifiant, un jeton, un
   * nom, un type d'agent. 8 Ko laissent une marge confortable et ferment
   * l'amplification.
   */
  messageAvantAuth: 8 * 1024,
  name: 120,
  token: 256,
  id: 64,
  title: 200,
  prompt: 100_000,
  log: 512 * 1024,
  diff: 1024 * 1024,
  subAgents: 32,
  /** Fichiers ouverts constatés (présence Rayon) dans un task_update. */
  presences: 16,
  maxConcurrency: 16,
  /** Nombre max de modèles qu'un nœud peut déclarer savoir faire tourner. */
  modeles: 16,
  /** Contexte Hive Mind joint à une assignation (borné : injecté dans le prompt). */
  hiveContext: 8_000,
  /** Genre / libellé / détail d'une réquisition ouverte par le nœud (ADR 0010). */
  requisitionGenre: 40,
  requisitionLibelle: 200,
  requisitionDetail: 2_000,
  /** Nombre max de diffs joints à un merge. */
  mergeDiffs: 200,
  /** Nombre max d'arguments d'une commande de test, et longueur de chaque. */
  testArgs: 32,
  arg: 1_000,
} as const;

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// ─── Messages client → orchestrateur ─────────────────────────────────────────
export interface RegisterMsg {
  type: 'register';
  token: string;
  name: string;
  ownerName: string;
  agentType: string;
  maxConcurrency: number;
  /** Présent lors d'une reconnexion, pour conserver l'identité du nœud. */
  nodeId?: string;
  /** Tâches réellement en cours côté nœud, pour réconciliation à la reconnexion. */
  activeTasks?: string[];
  /**
   * La machine du nœud (windows/macos/linux/autre), déclarée par lui. Optionnel :
   * un nœud d'une version antérieure n'en envoie pas, et le hub n'invente rien.
   */
  plateforme?: PlateformeNoeud;
  /**
   * Les modèles que ce nœud sait faire tourner (ex. `['claude-opus-5',
   * 'claude-fable-5']`). Déclarés par lui, pour que l'Aiguillage appris
   * (`aiguillage.ts`) puisse CHOISIR lequel employer sur un genre de tâche.
   *
   * Optionnel, et à dessein : un nœud d'une version antérieure — ou un agent
   * qui n'expose qu'un modèle — n'en envoie pas, et le hub retombe alors sur
   * son comportement d'avant (le nœud choisit lui-même). Aucun nœud n'est
   * forcé de le déclarer, et rien de sensible n'y transite : un nom de modèle
   * n'est pas un secret.
   */
  modeles?: string[];
  /**
   * Ce que le nœud a CONSTATÉ des outils IA installés sur sa machine.
   *
   * ─── POURQUOI DES FAITS, ET PAS UN VERDICT ──────────────────────────────
   *
   * Le nœud rend deux constats bruts par outil — le binaire est-il là, la clé
   * est-elle lisible — et RIEN d'autre. C'est le hub qui en tire un verdict,
   * en croisant avec son catalogue.
   *
   * Ce partage n'est pas cosmétique. Si le nœud envoyait « prêt », un nœud
   * menteur ou bogué imposerait sa conclusion. En n'envoyant que des faits, il
   * ne peut au pire que se tromper sur ce qu'il voit — et le hub garde la
   * décision, avec les mêmes règles pour tout le monde.
   *
   * ─── ET CE QUE ÇA N'AUTORISE PAS ────────────────────────────────────────
   *
   * Ce champ sert à l'AFFICHAGE et au conseil, jamais à l'assignation. Celle-ci
   * passe par `agentType` et `assignationProductionAutorisee`, inchangés : un
   * nœud qui prétendrait avoir Claude installé n'obtiendrait pas pour autant du
   * travail réservé à Claude. La doctrine du polyéthisme tient — une capacité
   * ne se déclare pas, elle se constate.
   */
  outils?: OutilConstate[];
}

/** Un constat brut sur un outil, tel que le nœud le voit. */
export interface OutilConstate {
  /** L'identifiant du catalogue (`claude-code`, `cline`…). */
  agent: string;
  /** Le binaire a été trouvé sur cette machine. */
  binaire: boolean;
  /**
   * Ce que le nœud a pu dire des identifiants. `inconnue` n'est PAS un défaut :
   * c'est le cas de Cline, dont Hive ne sait pas lire la configuration.
   */
  cle: 'presente' | 'absente' | 'inconnue';
}

const ETATS_CLE = new Set(['presente', 'absente', 'inconnue']);

/**
 * Le champ vient du RÉSEAU : mal formé, le message entier est refusé, jamais
 * rafistolé. Même règle que `plateforme` et `modeles`.
 *
 * Le plafond n'est pas décoratif : sans lui, un client pourrait pousser une
 * liste arbitrairement longue que le hub garderait en mémoire par nœud.
 */
export function estOutilsConstates(v: unknown): v is OutilConstate[] {
  if (!Array.isArray(v) || v.length > 32) return false;
  return v.every((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const o = e as Record<string, unknown>;
    return (
      typeof o.agent === 'string' &&
      o.agent.length > 0 &&
      o.agent.length <= 64 &&
      typeof o.binaire === 'boolean' &&
      typeof o.cle === 'string' &&
      ETATS_CLE.has(o.cle)
    );
  });
}

export interface HeartbeatMsg {
  type: 'heartbeat';
  /** Nombre de tâches en cours côté nœud (informatif). */
  running: number;
  /**
   * Le nœud est-il de service (Night Shift) ? Absent = disponible. Le hub s'en
   * sert pour éviter d'office les nœuds hors service à la sélection d'un merge.
   */
  onShift?: boolean;
}

export interface TaskUpdateMsg {
  type: 'task_update';
  taskId: string;
  status: 'running';
  subAgents?: SubAgent[];
  /**
   * Snapshot des fichiers ouverts constatés (Read/Edit/Write) — ADR 0010.
   * Absent ou `[]` = rien d'ouvert (ne pas inventer à l'écran).
   */
  presences?: PresenceFichier[];
  log?: string;
}

export interface TaskResultMsg {
  type: 'task_result';
  taskId: string;
  success: boolean;
  diff: string;
  logs: string;
  durationMs: number;
  subAgents: SubAgent[];
}

/**
 * Refus d'une assignation (nœud saturé, id invalide) : la tâche est requalifiée
 * SANS consommer de tentative — contrairement à un task_result en échec.
 */
export interface TaskRejectMsg {
  type: 'task_reject';
  taskId: string;
  reason: string;
  /**
   * Refus dû à un échec d'INFRASTRUCTURE de l'agent (auth/quota) et non à une
   * simple saturation : le hub tente un AUTRE nœud, et n'échoue la tâche que si
   * aucun nœud n'a d'agent fonctionnel (token-failover).
   */
  infra?: boolean;
  /**
   * Indisponibilité PRÉVISIBLE (ex. Night Shift : fenêtre fermée) : durée en ms
   * avant laquelle il est inutile de représenter cette tâche à CE nœud. Le hub
   * l'utilise comme cooldown (borné) au lieu du cooldown court par défaut —
   * sans ce champ, un nœud hors service serait re-sollicité en boucle.
   */
  retryAfterMs?: number;
}

export interface SubscribeMsg {
  type: 'subscribe';
  token: string;
}

/**
 * Réquisition ouverte par une ouvrière connectée (ADR 0010 lot 7).
 *
 * Le `nodeId` vient de la connexion authentifiée — jamais du message. Aucun
 * secret ne transite : seulement genre + libellé + détail optionnel.
 */
export interface RequisitionOpenMsg {
  type: 'requisition_open';
  genre: string;
  libelle: string;
  detail?: string;
  /** Tâche bloquée en attente de décision humaine (mid-task, ADR 0010). */
  taskId?: string;
}

/** Conflit signalé lors d'un merge (un diff qui ne s'applique pas proprement). */
export interface MergeConflictReport {
  taskId: string;
  reason: string;
}

/**
 * Résultat d'un chantier exécuté par un nœud (lot 14).
 *
 * `refused` distingue « le chantier a tourné et a échoué » de « le nœud n'a pas
 * voulu le lancer » — deux choses qu'un code de sortie non nul confondrait, et
 * qui appellent deux gestes opposés : corriger le code, ou corriger la demande.
 */
export interface ChantierResultMsg {
  type: 'chantier_result';
  chantierId: string;
  /** Le nom relayé, pour que le hub retrouve de quoi il s'agit. */
  nom: string;
  /** Code de sortie du processus. `null` s'il n'a jamais démarré. */
  code: number | null;
  /** Sortie standard et d'erreur, bornée. C'est une DONNÉE : elle vient du dépôt. */
  sortie: string;
  /** Vrai seulement si le chantier a tourné ET rendu 0. */
  ok: boolean;
  /** Non vide quand le nœud a REFUSÉ — hors service, nom non déclaré, sortant. */
  refused?: string;
}

/** Résultat d'un merge exécuté par un nœud (Honeycomb Merge, Palier 3). */
export interface MergeResultMsg {
  type: 'merge_result';
  mergeId: string;
  applied: string[];
  conflicts: MergeConflictReport[];
  mergedDiff: string;
  testsRun: boolean;
  testsPassed: boolean | null;
  /**
   * Verdict de la préparation de l'environnement : `null`/absent si aucune.
   *
   * Séparé de `testsPassed` exprès, et ce n'est pas de la coquetterie :
   * « l'environnement ne s'installe pas » et « les tests échouent » appellent
   * deux gestes différents, et les confondre enverrait l'hôte chercher une
   * régression dans du code qui va très bien. Optionnel, parce qu'un nœud d'une
   * version antérieure n'en envoie pas.
   */
  preparedOk?: boolean | null;
  logs: string;
  /**
   * Merge REFUSÉ par le nœud (ex. Night Shift : hors heures de service) : le
   * hub le traite en échec explicite (merge_failed), jamais en succès vide.
   */
  refused?: string;
}

/** Ce que le nœud a fait de la demande de pose. */
export interface PoseResultMsg {
  type: 'pose_result';
  poseId: string;
  outilId: string;
  /** Code de sortie. `null` si le processus n'a jamais démarré. */
  code: number | null;
  /** Sortie standard et d'erreur, bornée. C'est une DONNÉE, pas du code. */
  sortie: string;
  /** Vrai seulement si la pose a tourné ET rendu 0. */
  ok: boolean;
  /** Non vide quand le nœud a REFUSÉ — outil inconnu, sans commande, déjà là. */
  refuse?: string;
}

export type ClientMessage =
  | RegisterMsg
  | HeartbeatMsg
  | TaskUpdateMsg
  | TaskResultMsg
  | TaskRejectMsg
  | SubscribeMsg
  | RequisitionOpenMsg
  | MergeResultMsg
  | ChantierResultMsg
  | PoseResultMsg;

// ─── Messages orchestrateur → client ─────────────────────────────────────────
export interface RegisteredMsg {
  type: 'registered';
  nodeId: string;
}

export interface AssignTaskMsg {
  type: 'assign_task';
  task: Task;
  /** Dépôt du projet à cloner côté nœud (null : workspace vierge sans git). */
  repoUrl?: string | null;
  /** Contexte Hive Mind (souvenirs pertinents) à préfixer au prompt de la tâche. */
  hiveContext?: string;
  /**
   * Le modèle que l'Aiguillage appris a choisi pour cette tâche, que le nœud
   * passera à son adaptateur (`--model`). Absent : le nœud emploie son modèle
   * par défaut. Un nom de modèle n'est PAS un secret ; il voyage en clair.
   */
  modele?: string;
}

export interface CancelTaskMsg {
  type: 'cancel_task';
  taskId: string;
  reason: string;
}

export interface StateMsg {
  type: 'state';
  snapshot: StateSnapshot;
}

export interface EventMsg {
  type: 'event';
  event: HiveEvent;
}

export interface ErrorMsg {
  type: 'error';
  message: string;
}

/** Accusé de réception d'une réquisition ouverte via le protocole nœud. */
export interface RequisitionAckMsg {
  type: 'requisition_ack';
  id: string;
  genre: string;
  libelle: string;
}

/**
 * Décision humaine relayée au nœud — jamais le secret (clé chez la Queen).
 */
export interface RequisitionResultMsg {
  type: 'requisition_result';
  id: string;
  statut: 'accordee' | 'refusee';
}

/** Un diff de tâche à intégrer lors d'un merge. */
export interface MergeDiffInput {
  taskId: string;
  diff: string;
}

/** Demande de merge envoyée à un nœud (Honeycomb Merge, Palier 3). */
export interface AssignMergeMsg {
  type: 'assign_merge';
  mergeId: string;
  /** Dépôt à cloner pour l'intégration. */
  repoUrl: string;
  /** Diffs des tâches, dans l'ordre de merge. */
  diffs: MergeDiffInput[];
  /**
   * Préparation optionnelle de l'environnement, avant les tests (`npm ci`…).
   *
   * Sans elle, `npm test` sur un clone frais échoue faute de dépendances, et le
   * verdict qui remonte dit « tests en échec » là où il fallait lire
   * « environnement absent ». Bornée par `jugerPreparation` aux deux bouts :
   * elle installe ce que le DÉPÔT déclare, jamais ce que la commande nomme.
   */
  prepareCommand?: string[];
  /** Commande de test optionnelle (argv, jamais interprétée par un shell). */
  testCommand?: string[];
}

/**
 * Demande de CHANTIER envoyée à un nœud (lot 14) — lancer un travail que le
 * dépôt DÉCLARE.
 *
 * ─── POURQUOI CE MESSAGE PORTE UN NOM ET PAS UNE COMMANDE ────────────────────
 *
 * C'est toute la différence avec `assign_merge`, qui porte un `testCommand`.
 * Ici le hub n'envoie **aucune commande** : il envoie le NOM d'un script, et le
 * nœud relit lui-même le `package.json` du clone qu'il vient de faire, vérifie
 * que le nom y figure, puis compose l'argv.
 *
 * La raison est la même que celle qui a fait naître `jugerCommandeTest` : un
 * nœud ne doit pas tenir pour acquis que le hub est bien celui qu'il croit. Le
 * jeton de ruche est partagé, les anciennes invitations le portent en clair, et
 * le transport peut être un `ws://` de réseau local. Un hub compromis qui
 * enverrait une commande la ferait exécuter ; un hub compromis qui envoie un
 * nom ne peut désigner que ce que le dépôt déclare déjà.
 *
 * **Le hub propose un nom. Le dépôt décide de ce que ce nom exécute.**
 */
export interface AssignChantierMsg {
  type: 'assign_chantier';
  chantierId: string;
  /** Dépôt à cloner. */
  repoUrl: string;
  /** Le NOM du script — jamais une commande. Voir ci-dessus. */
  nom: string;
  /** Préparation optionnelle (`npm ci`…), bornée par `jugerPreparation`. */
  prepareCommand?: string[];
}

/**
 * Le hub demande à un nœud de POSER un outil sur sa machine.
 *
 * ─── LE MESSAGE PORTE UN IDENTIFIANT, JAMAIS UNE COMMANDE ────────────────────
 *
 * Même règle que `assign_chantier`, et pour la même raison : ce message
 * déclenche une exécution sur la machine d'un membre. S'il portait la commande,
 * un hub compromis — ou une requête bricolée depuis un navigateur — ferait
 * exécuter n'importe quoi. Portant `outilId`, il ne peut déclencher que ce que
 * le CATALOGUE DU NŒUD contient déjà.
 *
 * `outilId` n'est validé ici que dans sa FORME. Savoir si l'outil existe et
 * s'installe demande le catalogue, et c'est le nœud qui pose cette question —
 * lui seul sait ce que SA version connaît.
 */
export interface PoserOutilMsg {
  type: 'poser_outil';
  /** Pour que le hub relie la réponse à la demande. */
  poseId: string;
  /** L'identifiant catalogue de l'outil. Jamais une commande. */
  outilId: string;
}

export type ServerMessage =
  | RegisteredMsg
  | AssignTaskMsg
  | CancelTaskMsg
  | StateMsg
  | EventMsg
  | ErrorMsg
  | RequisitionAckMsg
  | RequisitionResultMsg
  | AssignMergeMsg
  | AssignChantierMsg
  | PoserOutilMsg;

const SERVER_MESSAGE_TYPES = new Set([
  'registered',
  'assign_task',
  'cancel_task',
  'state',
  'event',
  'error',
  'requisition_ack',
  'requisition_result',
  'assign_merge',
  'assign_chantier',
  'poser_outil',
]);

// ─── Validation ──────────────────────────────────────────────────────────────
function isStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function isStrAllowEmpty(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

export function isId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

function isSubAgents(v: unknown): v is SubAgent[] {
  if (!Array.isArray(v) || v.length > LIMITS.subAgents) return false;
  return v.every((s) => {
    if (typeof s !== 'object' || s === null) return false;
    const sa = s as Record<string, unknown>;
    return (
      isId(sa.id) &&
      isStr(sa.name, LIMITS.name) &&
      (sa.status === 'running' || sa.status === 'done' || sa.status === 'failed')
    );
  });
}

/** Snapshot présence Rayon — toolUseId Claude peut dépasser ID_PATTERN. */
function isPresences(v: unknown): v is PresenceFichier[] {
  if (!Array.isArray(v) || v.length > LIMITS.presences) return false;
  return v.every((p) => {
    if (typeof p !== 'object' || p === null) return false;
    const r = p as Record<string, unknown>;
    return (
      typeof r.toolUseId === 'string' &&
      r.toolUseId.length >= 1 &&
      r.toolUseId.length <= 128 &&
      typeof r.chemin === 'string' &&
      r.chemin.length >= 1 &&
      r.chemin.length <= 500 &&
      (r.outil === 'Read' || r.outil === 'Edit' || r.outil === 'Write')
    );
  });
}

/** Liste d'identifiants de tâches (bornée), tolérant l'absence. */
function isIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 1000 && v.every((x) => isId(x));
}

/**
 * Une liste de modèles déclarés : bornée en nombre, chacun une chaîne non vide
 * et courte. On refuse le vide et le démesuré comme partout ailleurs — un champ
 * optionnel mal formé est un client qui ment ou qui bogue, et les deux se
 * disent (même règle que `plateforme`).
 */
function isModeleList(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= LIMITS.modeles &&
    v.every((x) => isStr(x, LIMITS.name))
  );
}

/** Diffs joints à un merge : liste non vide bornée de { taskId, diff }. */
function isMergeDiffs(v: unknown): v is MergeDiffInput[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > LIMITS.mergeDiffs) return false;
  return v.every((d) => {
    if (typeof d !== 'object' || d === null) return false;
    const dd = d as Record<string, unknown>;
    return isId(dd.taskId) && isStrAllowEmpty(dd.diff, LIMITS.diff);
  });
}

/** Rapports de conflits d'un merge : liste bornée de { taskId, reason }. */
function isMergeConflicts(v: unknown): v is MergeConflictReport[] {
  if (!Array.isArray(v) || v.length > LIMITS.mergeDiffs) return false;
  return v.every((c) => {
    if (typeof c !== 'object' || c === null) return false;
    const cc = c as Record<string, unknown>;
    return isId(cc.taskId) && isStrAllowEmpty(cc.reason, LIMITS.arg);
  });
}

/** Commande (argv) : liste non vide et bornée de chaînes courtes non vides. */
function isArgv(v: unknown): v is string[] {
  return (
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= LIMITS.testArgs &&
    v.every((s) => isStr(s, LIMITS.arg))
  );
}

/** Statut de tâche connu — utilisé pour valider un objet Task reçu du hub. */
const TASK_STATUSES = new Set(['pending', 'ready', 'assigned', 'running', 'done', 'failed']);

/**
 * Valide un objet Task reçu du hub avant de l'utiliser côté nœud. Le nœud ne
 * fait PAS confiance aveuglément à l'orchestrateur : task.id sert à construire
 * des chemins locaux (anti path-traversal), et branch/prompt/title sont bornés.
 */
export function isValidTask(v: unknown): v is Task {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    isId(t.id) &&
    isId(t.projectId) &&
    isStr(t.title, LIMITS.title) &&
    isStrAllowEmpty(t.prompt, LIMITS.prompt) &&
    typeof t.status === 'string' &&
    TASK_STATUSES.has(t.status) &&
    isIdList(t.dependsOn) &&
    (t.assignedNodeId === null || isId(t.assignedNodeId)) &&
    (t.branch === null || (typeof t.branch === 'string' && t.branch.length <= LIMITS.name)) &&
    isInt(t.attempts, 0, 1_000_000)
  );
}

/**
 * Analyse et valide un message entrant côté orchestrateur.
 * Retourne null si le message est invalide (il sera ignoré et la connexion fermée).
 */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.message) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;

  switch (m.type) {
    case 'register': {
      if (
        isStr(m.token, LIMITS.token) &&
        isStr(m.name, LIMITS.name) &&
        isStr(m.ownerName, LIMITS.name) &&
        isStr(m.agentType, LIMITS.name) &&
        isInt(m.maxConcurrency, 1, LIMITS.maxConcurrency) &&
        (m.nodeId === undefined || isId(m.nodeId))
      ) {
        const msg: RegisterMsg = {
          type: 'register',
          token: m.token,
          name: m.name,
          ownerName: m.ownerName,
          agentType: m.agentType,
          maxConcurrency: m.maxConcurrency,
        };
        if (m.nodeId !== undefined) msg.nodeId = m.nodeId as string;
        if (m.activeTasks !== undefined) {
          if (!isIdList(m.activeTasks)) return null;
          msg.activeTasks = m.activeTasks;
        }
        // La plateforme vient du réseau : hors liste, le message est REFUSÉ —
        // pas corrigé en douce. Un champ optionnel mal formé est un client
        // qui ment ou qui bogue, et les deux se disent.
        if (m.plateforme !== undefined) {
          if (!estPlateforme(m.plateforme)) return null;
          msg.plateforme = m.plateforme;
        }
        // Les modèles déclarés viennent aussi du réseau : mal formés, le message
        // entier est REFUSÉ, pas rafistolé. L'Aiguillage n'aura que des noms
        // valides à départager.
        if (m.modeles !== undefined) {
          if (!isModeleList(m.modeles)) return null;
          msg.modeles = m.modeles;
        }
        // Les constats d'outils : mêmes règles que les deux champs au-dessus.
        // Une liste mal formée est un client qui ment ou qui bogue, et les deux
        // se disent plutôt que de se corriger en douce.
        if (m.outils !== undefined) {
          if (!estOutilsConstates(m.outils)) return null;
          // RECONSTRUIT champ par champ, jamais recopié tel quel.
          //
          // La validation dit que les trois champs attendus sont là et bien
          // typés ; elle ne dit RIEN des autres. Recopier l'objet laisserait
          // passer tout ce qu'un nœud y aurait glissé — un `verdict`, par
          // exemple, que le hub rangerait et qu'un écran finirait par afficher
          // comme s'il l'avait calculé.
          //
          // Mon propre banc l'a trouvé : `expect(outils[0].verdict).toBeUndefined()`
          // rougissait. C'est la discipline du reste de ce parseur — il
          // reconstruit `msg` champ par champ — appliquée ici aussi.
          msg.outils = m.outils.map((o) => ({
            agent: o.agent,
            binaire: o.binaire,
            cle: o.cle,
          }));
        }
        return msg;
      }
      return null;
    }
    case 'heartbeat': {
      if (
        isInt(m.running, 0, 10_000) &&
        (m.onShift === undefined || typeof m.onShift === 'boolean')
      ) {
        const msg: HeartbeatMsg = { type: 'heartbeat', running: m.running };
        if (typeof m.onShift === 'boolean') msg.onShift = m.onShift;
        return msg;
      }
      return null;
    }
    case 'task_update': {
      if (
        isId(m.taskId) &&
        m.status === 'running' &&
        (m.subAgents === undefined || isSubAgents(m.subAgents)) &&
        (m.presences === undefined || isPresences(m.presences)) &&
        (m.log === undefined || isStrAllowEmpty(m.log, LIMITS.log))
      ) {
        const msg: TaskUpdateMsg = { type: 'task_update', taskId: m.taskId, status: 'running' };
        if (m.subAgents !== undefined) msg.subAgents = m.subAgents as SubAgent[];
        if (m.presences !== undefined) msg.presences = m.presences as PresenceFichier[];
        if (m.log !== undefined) msg.log = m.log as string;
        return msg;
      }
      return null;
    }
    case 'task_result': {
      if (
        isId(m.taskId) &&
        typeof m.success === 'boolean' &&
        isStrAllowEmpty(m.diff, LIMITS.diff) &&
        isStrAllowEmpty(m.logs, LIMITS.log) &&
        isInt(m.durationMs, 0, 86_400_000) &&
        isSubAgents(m.subAgents)
      ) {
        return {
          type: 'task_result',
          taskId: m.taskId,
          success: m.success,
          diff: m.diff,
          logs: m.logs,
          durationMs: m.durationMs,
          subAgents: m.subAgents,
        };
      }
      return null;
    }
    case 'task_reject': {
      if (
        isId(m.taskId) &&
        isStr(m.reason, LIMITS.name) &&
        (m.infra === undefined || typeof m.infra === 'boolean') &&
        (m.retryAfterMs === undefined || isInt(m.retryAfterMs, 0, 24 * 60 * 60 * 1000))
      ) {
        const msg: TaskRejectMsg = { type: 'task_reject', taskId: m.taskId, reason: m.reason };
        if (m.infra === true) msg.infra = true;
        if (typeof m.retryAfterMs === 'number') msg.retryAfterMs = m.retryAfterMs;
        return msg;
      }
      return null;
    }
    case 'subscribe': {
      if (isStr(m.token, LIMITS.token)) return { type: 'subscribe', token: m.token };
      return null;
    }
    case 'requisition_open': {
      if (
        isStr(m.genre, LIMITS.requisitionGenre) &&
        isStr(m.libelle, LIMITS.requisitionLibelle) &&
        (m.detail === undefined || isStrAllowEmpty(m.detail, LIMITS.requisitionDetail)) &&
        (m.taskId === undefined || isId(m.taskId))
      ) {
        const msg: RequisitionOpenMsg = {
          type: 'requisition_open',
          genre: m.genre,
          libelle: m.libelle,
        };
        if (m.detail !== undefined) msg.detail = m.detail as string;
        if (m.taskId !== undefined) msg.taskId = m.taskId as string;
        return msg;
      }
      return null;
    }
    case 'merge_result': {
      if (
        isId(m.mergeId) &&
        isIdList(m.applied) &&
        isMergeConflicts(m.conflicts) &&
        isStrAllowEmpty(m.mergedDiff, LIMITS.diff) &&
        typeof m.testsRun === 'boolean' &&
        (m.testsPassed === null || typeof m.testsPassed === 'boolean') &&
        (m.preparedOk === undefined ||
          m.preparedOk === null ||
          typeof m.preparedOk === 'boolean') &&
        isStrAllowEmpty(m.logs, LIMITS.log) &&
        (m.refused === undefined || isStr(m.refused, LIMITS.name))
      ) {
        const msg: MergeResultMsg = {
          type: 'merge_result',
          mergeId: m.mergeId,
          applied: m.applied,
          conflicts: m.conflicts as MergeConflictReport[],
          mergedDiff: m.mergedDiff,
          testsRun: m.testsRun,
          testsPassed: m.testsPassed as boolean | null,
          logs: m.logs,
        };
        if (m.preparedOk !== undefined) msg.preparedOk = m.preparedOk as boolean | null;
        if (typeof m.refused === 'string') msg.refused = m.refused;
        return msg;
      }
      return null;
    }
    case 'chantier_result': {
      if (
        isId(m.chantierId) &&
        nomDeChantierValide(m.nom) &&
        (m.code === null || (typeof m.code === 'number' && Number.isSafeInteger(m.code))) &&
        isStrAllowEmpty(m.sortie, LIMITS.log) &&
        typeof m.ok === 'boolean' &&
        (m.refused === undefined || isStr(m.refused, LIMITS.name))
      ) {
        const msg: ChantierResultMsg = {
          type: 'chantier_result',
          chantierId: m.chantierId,
          nom: m.nom,
          code: m.code as number | null,
          sortie: m.sortie,
          ok: m.ok,
        };
        if (typeof m.refused === 'string') msg.refused = m.refused;
        return msg;
      }
      return null;
    }
    case 'pose_result': {
      if (
        isId(m.poseId) &&
        isId(m.outilId) &&
        (m.code === null || (typeof m.code === 'number' && Number.isSafeInteger(m.code))) &&
        isStrAllowEmpty(m.sortie, LIMITS.log) &&
        typeof m.ok === 'boolean' &&
        (m.refuse === undefined || isStr(m.refuse, LIMITS.name))
      ) {
        const msg: PoseResultMsg = {
          type: 'pose_result',
          poseId: m.poseId,
          outilId: m.outilId,
          code: m.code as number | null,
          sortie: m.sortie,
          ok: m.ok,
        };
        if (typeof m.refuse === 'string') msg.refuse = m.refuse;
        return msg;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Analyse et valide un message venant de l'orchestrateur (côté nœud ou dashboard).
 *
 * Le nœud ne fait PAS confiance aveuglément au hub : le token authentifie le
 * client VERS le hub, pas l'inverse, et le transport peut être un ws:// en clair
 * (MITM possible). Les messages `assign_task`/`cancel_task` — qui pilotent la
 * création de répertoires et le clonage de dépôts — sont donc validés champ par
 * champ, symétriquement à parseClientMessage. `state`/`event` (dashboard, lecture
 * seule) ne sont pas déstructurés en profondeur.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.message) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  if (typeof m.type !== 'string' || !SERVER_MESSAGE_TYPES.has(m.type)) return null;

  switch (m.type) {
    case 'registered':
      return isId(m.nodeId) ? { type: 'registered', nodeId: m.nodeId } : null;
    case 'assign_task': {
      if (!isValidTask(m.task)) return null;
      if (m.repoUrl !== undefined && m.repoUrl !== null && !isValidRepoUrl(m.repoUrl)) return null;
      if (m.hiveContext !== undefined && !isStrAllowEmpty(m.hiveContext, LIMITS.hiveContext)) {
        return null;
      }
      // Le modèle choisi, s'il est présent : un nom court et non vide, validé
      // comme un nom de nœud. Mal formé ⇒ tout le message tombe (même sévérité
      // que le reste — un hub qui ment sur un champ ment peut-être sur les autres).
      if (m.modele !== undefined && !isStr(m.modele, LIMITS.name)) return null;
      const msg: AssignTaskMsg = { type: 'assign_task', task: m.task };
      if (m.repoUrl !== undefined) msg.repoUrl = (m.repoUrl as string | null) ?? null;
      if (m.hiveContext !== undefined) msg.hiveContext = m.hiveContext;
      if (m.modele !== undefined) msg.modele = m.modele;
      return msg;
    }
    case 'cancel_task':
      return isId(m.taskId) && isStrAllowEmpty(m.reason, LIMITS.name)
        ? { type: 'cancel_task', taskId: m.taskId, reason: m.reason }
        : null;
    case 'requisition_ack':
      return isId(m.id) &&
        isStr(m.genre, LIMITS.requisitionGenre) &&
        isStr(m.libelle, LIMITS.requisitionLibelle)
        ? {
            type: 'requisition_ack',
            id: m.id,
            genre: m.genre,
            libelle: m.libelle,
          }
        : null;
    case 'requisition_result':
      return isId(m.id) && (m.statut === 'accordee' || m.statut === 'refusee')
        ? { type: 'requisition_result', id: m.id, statut: m.statut }
        : null;
    case 'assign_merge': {
      // Sensible côté nœud : déclenche un clone + application de patches + tests.
      // Validé champ par champ, comme assign_task.
      if (
        isId(m.mergeId) &&
        isValidRepoUrl(m.repoUrl) &&
        isMergeDiffs(m.diffs) &&
        (m.prepareCommand === undefined || isArgv(m.prepareCommand)) &&
        (m.testCommand === undefined || isArgv(m.testCommand))
      ) {
        const msg: AssignMergeMsg = {
          type: 'assign_merge',
          mergeId: m.mergeId,
          repoUrl: m.repoUrl,
          diffs: m.diffs as MergeDiffInput[],
        };
        if (m.prepareCommand !== undefined) msg.prepareCommand = m.prepareCommand as string[];
        if (m.testCommand !== undefined) msg.testCommand = m.testCommand as string[];
        return msg;
      }
      return null;
    }
    case 'assign_chantier': {
      // Aussi sensible qu'un merge : déclenche un clone puis un `npm run` sur
      // la machine d'un membre. Validé champ par champ.
      //
      // `nom` n'est validé QUE dans sa forme ici. Savoir si le dépôt le
      // déclare demande le `package.json`, que personne n'a encore à cet
      // instant — c'est le nœud qui posera cette question, après son clone.
      if (
        isId(m.chantierId) &&
        isValidRepoUrl(m.repoUrl) &&
        nomDeChantierValide(m.nom) &&
        (m.prepareCommand === undefined || isArgv(m.prepareCommand))
      ) {
        const msg: AssignChantierMsg = {
          type: 'assign_chantier',
          chantierId: m.chantierId,
          repoUrl: m.repoUrl,
          nom: m.nom,
        };
        if (m.prepareCommand !== undefined) msg.prepareCommand = m.prepareCommand as string[];
        return msg;
      }
      return null;
    }
    case 'poser_outil': {
      // Aussi sensible qu'un chantier : déclenche une installation sur la
      // machine d'un membre. Deux identifiants, rien d'autre — et surtout
      // AUCUNE commande, qui viendrait d'ailleurs que du catalogue du nœud.
      if (isId(m.poseId) && isId(m.outilId)) {
        const msg: PoserOutilMsg = {
          type: 'poser_outil',
          poseId: m.poseId,
          outilId: m.outilId,
        };
        return msg;
      }
      return null;
    }
    default:
      // state / event / error : destinés au dashboard, non sensibles côté nœud.
      return data as ServerMessage;
  }
}

/**
 * Valide un repoUrl : uniquement des schémas de transport sûrs. Bloque le
 * transport `ext::` de git (exécution de commande arbitraire = RCE) et les URL
 * commençant par « - » (injection d'argument dans git clone).
 */
/**
 * Taille en octets d'une trame WebSocket, sans la convertir en chaîne.
 *
 * `ws` livre trois formes selon la configuration et la fragmentation :
 * `Buffer`, `ArrayBuffer`, ou `Buffer[]` quand la trame arrive en morceaux.
 * N'en traiter que la première laisserait passer, par la voie des trames
 * fragmentées, exactement ce qu'on cherche à borner — et un attaquant choisit
 * sa fragmentation.
 *
 * On mesure sans `toString()` : convertir 2 Mo en chaîne est déjà une partie
 * du coût qu'on refuse de payer pour un inconnu.
 */
export function octetsDe(data: unknown): number {
  if (Array.isArray(data)) return data.reduce((n: number, part) => n + octetsDe(part), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (typeof data === 'string') return Buffer.byteLength(data);
  return 0;
}

export function isValidRepoUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 500) return false;
  if (v.startsWith('-')) return false;
  // http(s), git, ssh, ou chemin local absolu (démo/tests) — jamais ext::, file::, etc.
  return (
    /^https?:\/\//.test(v) ||
    /^git:\/\//.test(v) ||
    /^ssh:\/\//.test(v) ||
    /^git@[\w.-]+:/.test(v) ||
    /^[A-Za-z]:[\\/]/.test(v) || // chemin Windows (C:\...)
    /^\//.test(v) // chemin POSIX absolu
  );
}
