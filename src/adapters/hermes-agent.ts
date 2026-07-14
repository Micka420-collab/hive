// Adaptateur Hermes Agent (https://github.com/NousResearch/hermes-agent).
// L'agent Hermes tourne comme un agent de codage headless, similaire à
// Claude Code (`claude -p`). Les clés API restent locales au nœud.
//
// Utilise `hermes run --prompt` ou, si disponible, le mode headless via
// `hermes agent run --prompt <task.prompt>`.
//
// Config nœud : HERMES_PATH (chemin vers le binaire, défaut : hermes)
//               HERMES_MODEL (modèle à utiliser, défaut : configuré dans le profil)

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const HERMES_TIMEOUT_MS = 30 * 60_000; // 30 min : les tâches de codage peuvent être longues

export function createHermesAgentAdapter(
  token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN,
): AgentAdapter {
  assertRealExecutionAllowed("L'adaptateur hermes-agent", token);
  return {
    name: 'hermes-agent',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      ctx.onProgress({ log: 'hermes agent démarré' });

      const hermesPath = process.env.HERMES_PATH ?? 'hermes';
      const model = process.env.HERMES_MODEL;
      const args = ['agent', 'run', '--prompt', task.prompt];
      if (model) args.push('--model', model);

      const result = await runCommand(hermesPath, args, ctx, HERMES_TIMEOUT_MS);
      return { ...result, subAgents: [] };
    },
  };
}
