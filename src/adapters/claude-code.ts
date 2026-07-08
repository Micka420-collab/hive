// Adaptateur Claude Code en mode headless (`claude -p`). Ossature du Palier 1 :
// fonctionnelle mais minimale — le pilotage fin (sous-agents réels, streaming)
// viendra aux paliers suivants. Les clés API de l'agent restent locales au
// nœud : rien n'est jamais transmis au hub (contrainte §5.1).

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CLAUDE_TIMEOUT_MS = 15 * 60_000;

export function createClaudeCodeAdapter(
  token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN,
): AgentAdapter {
  // Un agent réel modifie de vrais fichiers : mêmes exigences que le shell réel.
  assertRealExecutionAllowed("L'adaptateur claude-code", token);
  return {
    name: 'claude-code',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      ctx.onProgress({ log: 'claude -p (headless) démarré' });
      // Sortie texte brute ; le diff est calculé par le workspace git du nœud.
      const result = await runCommand(
        'claude',
        ['-p', task.prompt, '--output-format', 'text'],
        ctx,
        CLAUDE_TIMEOUT_MS,
      );
      return { ...result, subAgents: [] };
    },
  };
}
