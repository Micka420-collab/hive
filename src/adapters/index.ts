// Registre des adaptateurs d'agents. Toute IA de codage se branche dans la
// ruche via l'interface AgentAdapter — l'orchestrateur n'a jamais besoin de
// connaître l'outil qui exécute réellement la tâche (contrainte §5.4).

import type { SubAgent, Task } from '../shared/types.js';
import { createClaudeCodeAdapter } from './claude-code.js';
import { createCodexAdapter } from './codex.js';
import { createHermesAgentAdapter } from './hermes-agent.js';
import { createShellAdapter } from './shell.js';

export interface AdapterProgress {
  subAgents?: SubAgent[];
  log?: string;
}

export interface AdapterContext {
  /** Répertoire de travail isolé de la tâche (sandbox v0). */
  cwd: string;
  /** Environnement épuré transmis aux processus enfants — jamais celui du membre. */
  env: NodeJS.ProcessEnv;
  /** Numéro de tentative (1 = premier essai). */
  attempt: number;
  /** Annulation coopérative (cancel_task, arrêt du nœud). */
  signal: AbortSignal;
  /** Remontée de progrès vers l'orchestrateur (sous-agents, logs). */
  onProgress: (progress: AdapterProgress) => void;
}

export interface AdapterResult {
  success: boolean;
  /** Diff des changements — laisser vide si le workspace git doit le calculer. */
  diff: string;
  logs: string;
  subAgents: SubAgent[];
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
    case 'hermes-agent':
      return createHermesAgentAdapter();
    default:
      throw new Error(`Adaptateur inconnu : ${name} (disponibles : shell, claude-code, codex, hermes-agent)`);
  }
}
