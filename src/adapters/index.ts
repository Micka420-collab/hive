// Registre des adaptateurs d'agents. Toute IA de codage se branche dans la
// ruche via l'interface AgentAdapter — l'orchestrateur n'a jamais besoin de
// connaître l'outil qui exécute réellement la tâche (contrainte §5.4).

import type { PresenceFichier } from '../shared/presence.js';
import type { Effort } from '../shared/effort.js';
import type {
  ArretBudgetaire,
  ExecutionUsage,
  SubAgent,
  Task,
  UsageFournisseur,
} from '../shared/types.js';
import { createClaudeCodeAdapter } from './claude-code.js';
import { createClineAdapter } from './cline.js';
import { createCodexAdapter } from './codex.js';
import { createCursorAdapter } from './cursor.js';
import { createCustomAdapter } from './custom.js';
import { createGrokAdapter } from './grok.js';
import { createHermesAgentAdapter } from './hermes-agent.js';
import { createShellAdapter } from './shell.js';

export interface AdapterProgress {
  subAgents?: SubAgent[];
  /** Snapshot des fichiers ouverts constatés (ADR 0010). */
  presences?: PresenceFichier[];
  /** Jalon lisible (« claude -p démarré ») : journalisé par le hub. */
  log?: string;
  /**
   * Un morceau de la sortie de l'agent (stdout, stderr), EN DIRECT (sortie-directe.ts :
   * ≤ 4 Kio, ≤ 4 par seconde). Éphémère : le hub le relaie aux écrans sans le
   * journaliser — voir `TaskUpdateMsg.sortie`.
   */
  sortie?: string;
}

/** Demande bornée qu'un Worker peut transmettre à la Queen pour un enfant. */
export interface WorkerDelegationInput {
  /** Identifiant stable de la sous-tâche, réutilisé si le Worker réessaie. */
  childTaskId: string;
  reason: string;
  title: string;
  prompt: string;
  durationMs: number;
  costMicros: number;
  resourceUnits: number;
  preferredAgent?: string;
  preferredModel?: string;
}

export type WorkerDelegationOutcome =
  | { ok: true; parentTaskId: string; childTaskId: string; depth: number }
  | { ok: false; code: string; message: string };

/** Résultat terminal borné d'un enfant déjà admis par la Queen. */
export type WorkerDelegationResult =
  | {
      ok: true;
      parentTaskId: string;
      childTaskId: string;
      success: boolean;
      diff: string;
      logs: string;
      durationMs: number;
      usage?: ExecutionUsage;
      resultId?: number;
    }
  | { ok: false; code: string; message: string };

import type { BacExecution } from '../node-client/isolement.js';
import type { ReservationPont } from '../node-client/rendez-vous-pont.js';

export interface AdapterContext {
  /** Répertoire de travail isolé de la tâche (sandbox v0). */
  cwd: string;
  /** Environnement épuré transmis aux processus enfants — jamais celui du membre. */
  env: NodeJS.ProcessEnv;
  /** Numéro de tentative (1 = premier essai). */
  attempt: number;
  /** Annulation coopérative (cancel_task, arrêt du nœud). */
  signal: AbortSignal;
  /**
   * Le modèle choisi par l'Aiguillage appris (ex. `claude-opus-5`), à passer au
   * CLI de l'agent (`--model`). Absent : l'agent emploie son modèle par défaut.
   * Ce n'est PAS un secret — il peut voyager en argument de commande.
   */
  modele?: string;
  /**
   * L'effort élu avec le modèle (`--effort` chez Claude Code). Absent : le CLI
   * garde son défaut. N'arrive qu'à un adaptateur qui déclare `efforts`.
   */
  effort?: Effort;
  /** Remontée de progrès vers l'orchestrateur (sous-agents, logs). */
  onProgress: (progress: AdapterProgress) => void;
  /**
   * Délégation contrôlée vers un enfant : l'adaptateur ne reçoit jamais un
   * accès à SQLite ni un socket, seulement cette capacité bornée et traçable.
   */
  delegate?: (input: WorkerDelegationInput) => Promise<WorkerDelegationOutcome>;
  /** Attend le résultat terminal d'un enfant admis, sans exposer le socket. */
  waitForDelegationResult?: (childTaskId: string) => Promise<WorkerDelegationResult>;
  /**
   * Où le pont de délégation de la tâche ouvre son socket : le rendez-vous
   * privé du NŒUD sous le dossier temporaire du système, jamais le répertoire
   * de la tâche, dont la profondeur dépassait la limite d'un socket Unix (voir
   * `rendez-vous-pont.ts`). Fourni avec `delegate` et `waitForDelegationResult`.
   */
  rendezVous?: ReservationPont;
  /**
   * Bac à sable dans lequel envelopper la commande, s'il y en a un.
   *
   * Résolu UNE FOIS au démarrage du nœud, jamais par tâche : sonder un binaire
   * à chaque butinage coûterait un `spawn` de plus par tâche pour une réponse
   * qui ne change pas. Absent ⇒ la commande part telle quelle, avec la seule
   * sandbox de processus (voir `isolement.ts` pour ce que cela protège, et
   * surtout pour ce que cela ne protège pas).
   */
  bac?: BacExecution;
  /**
   * `'relecture'` : la tâche est une contre-expertise — l'agent LIT une
   * production, il n'a rien à écrire. Un adaptateur peut alors réduire ses
   * droits (Codex : `--sandbox read-only`). Absent : une production. Dit par
   * le hub (`AssignTaskMsg.relecture`), jamais deviné du prompt.
   */
  role?: 'relecture';
  /**
   * Ce que cette tentative peut encore dépenser, en micro-USD (≥ 1), dit par
   * la Reine (`AssignTaskMsg.plafondCoutMicros`). Un adaptateur qui sait le
   * tenir dans la boucle de son agent le lui passe (Claude Code :
   * `--max-budget-usd`), et le DIT quand il ne le peut pas. Absent : aucun.
   */
  plafondCoutMicros?: number;
}

export interface AdapterResult {
  success: boolean;
  /** Diff des changements — laisser vide si le workspace git doit le calculer. */
  diff: string;
  logs: string;
  subAgents: SubAgent[];
  /**
   * Échec d'INFRASTRUCTURE (agent injoignable, non authentifié, quota/crédit
   * épuisé) — par opposition à un échec de la tâche elle-même. Dans ce cas le
   * nœud ne « brûle » pas une tentative : il demande une réaffectation
   * (task_reject) pour qu'un AUTRE nœud, dont l'agent fonctionne, reprenne la tâche.
   */
  infra?: boolean;
  /**
   * Ce que le CLI de l'agent a DÉCLARÉ (coût, temps modèle, modèles exacts).
   * Absent quand il ne déclare rien — jamais estimé par Hive.
   */
  fournisseur?: UsageFournisseur;
  /**
   * La réponse FINALE de l'agent, lue là où SON CLI la déclare (ligne
   * `result` du stream-json, `run_result` de Cline, sortie standard de Codex) —
   * jamais un extrait de `logs`. Bornée par `borneTexteFinal`. Absente quand le
   * CLI n'en rend pas, ou quand le processus a été tué avant de conclure.
   * Voir `texte-final.ts`.
   */
  finalText?: string;
  /**
   * Le CLI s'est arrêté sur son plafond de coût ou de tours — ce qu'IL a
   * déclaré (le `subtype` de son résultat), jamais déduit des logs.
   */
  arretBudgetaire?: ArretBudgetaire;
}

export interface AgentAdapter {
  name: string;
  /**
   * Les efforts que le CLI INSTALLÉ documente, sondés une fois au démarrage du
   * nœud, qui les déclare à la ruche. Absent (ou liste vide) : l'Aiguillage ne
   * lui en commande jamais (`shared/effort.ts`).
   */
  effortsDocumentes?: () => Promise<readonly Effort[]>;
  /**
   * Les chemins du dépôt (relatifs à sa racine, séparés par `/`) dont ce CLI
   * EXÉCUTE le contenu — hooks, plugins — sans option pour l'en empêcher. Le
   * nœud les écarte de l'arbre avant l'agent et les remet avant le diff
   * (`node-client/configuration-inerte.ts`). Absent : le CLI n'en exécute
   * aucun, ou des drapeaux le lui interdisent (Claude Code, `claude-code.ts`).
   */
  configurationExecutee?: readonly string[];
  run(task: Task, ctx: AdapterContext): Promise<AdapterResult>;
}

/** Adaptateurs disponibles. `shell` est simulé par défaut (sûr). */
export function getAdapter(name: string): AgentAdapter {
  switch (name) {
    case 'shell':
      return createShellAdapter();
    case 'claude-code':
      return createClaudeCodeAdapter();
    case 'cursor':
      return createCursorAdapter();
    case 'cline':
      return createClineAdapter();
    case 'codex':
      return createCodexAdapter();
    case 'custom':
      return createCustomAdapter();
    case 'grok':
      return createGrokAdapter();
    case 'hermes-agent':
      return createHermesAgentAdapter();
    default:
      throw new Error(
        `Adaptateur inconnu : ${name} (disponibles : shell, claude-code, cursor, cline, codex, grok, custom, hermes-agent)`,
      );
  }
}
