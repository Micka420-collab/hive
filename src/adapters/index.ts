// Registre des adaptateurs d'agents. Toute IA de codage se branche dans la
// ruche via l'interface AgentAdapter — l'orchestrateur n'a jamais besoin de
// connaître l'outil qui exécute réellement la tâche (contrainte §5.4).

import type { SubAgent, Task } from '../shared/types.js';
import { createClaudeCodeAdapter } from './claude-code.js';
import { createCodexAdapter } from './codex.js';
import { createCustomAdapter } from './custom.js';
import { createGrokAdapter } from './grok.js';
import { createHermesAgentAdapter } from './hermes-agent.js';
import { createShellAdapter } from './shell.js';

export interface AdapterProgress {
  subAgents?: SubAgent[];
  log?: string;
}

import type { Fournisseur } from '../node-client/isolement.js';

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
  /** Remontée de progrès vers l'orchestrateur (sous-agents, logs). */
  onProgress: (progress: AdapterProgress) => void;
  /**
   * Bac à sable dans lequel envelopper la commande, s'il y en a un.
   *
   * Résolu UNE FOIS au démarrage du nœud, jamais par tâche : sonder un binaire
   * à chaque butinage coûterait un `spawn` de plus par tâche pour une réponse
   * qui ne change pas. Absent ⇒ la commande part telle quelle, avec la seule
   * sandbox de processus (voir `isolement.ts` pour ce que cela protège, et
   * surtout pour ce que cela ne protège pas).
   */
  bac?: {
    fournisseur: Fournisseur;
    /** Noms — jamais valeurs — des variables à transmettre dans le bac. */
    variables: readonly string[];
  };
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
}

export interface AgentAdapter {
  name: string;
  run(task: Task, ctx: AdapterContext): Promise<AdapterResult>;
}

/** Adaptateurs disponibles. `shell` est simulé par défaut (sûr). */
export function getAdapter(name: string): AgentAdapter {
  switch (name) {
    case 'shell':
      return createShellAdapter();
    case 'claude-code':
      return createClaudeCodeAdapter();
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
        `Adaptateur inconnu : ${name} (disponibles : shell, claude-code, codex, grok, custom, hermes-agent)`,
      );
  }
}
