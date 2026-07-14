// Adaptateur Claude Code en mode headless (`claude -p`). Le flux stream-json est
// lu au fil de l'eau : les sous-agents (outil Task) engendrés par l'agent sont
// remontés EN DIRECT au hub (« reines & abeilles » — visibles sur le Swarm View).
// Les clés API de l'agent restent locales au nœud : rien n'est transmis au hub
// (contrainte §5.1). Le diff est calculé par le workspace git du nœud, pas par stdout.

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommandStreaming } from './exec.js';
import { createSubAgentTracker } from './subagent-parser.js';
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
      ctx.onProgress({ log: 'claude -p (stream-json) démarré' });
      const tracker = createSubAgentTracker();
      // --verbose est requis par Claude Code pour stream-json en mode -p.
      const result = await runCommandStreaming(
        'claude',
        ['-p', task.prompt, '--output-format', 'stream-json', '--verbose'],
        ctx,
        (line) => {
          const subAgents = tracker.feed(line);
          // Remonter dès qu'un sous-agent apparaît/évolue → butineuses en direct.
          if (subAgents) ctx.onProgress({ subAgents });
        },
        CLAUDE_TIMEOUT_MS,
      );
      // La liste finale accompagne le résultat (dernier état des sous-agents).
      return { ...result, subAgents: tracker.list() };
    },
  };
}
