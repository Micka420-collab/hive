// Adaptateur Codex CLI (`codex exec`). Ossature du Palier 1, même contrat et
// mêmes garde-fous que claude-code : clés locales au nœud, token non-trivial.

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CODEX_TIMEOUT_MS = 15 * 60_000;

export function createCodexAdapter(token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN): AgentAdapter {
  assertRealExecutionAllowed("L'adaptateur codex", token);
  return {
    name: 'codex',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      ctx.onProgress({ log: 'codex exec démarré' });
      // `--` avant le prompt : sans lui, un prompt commençant par un tiret est
      // lu comme une option de `codex exec` (cf. src/adapters/prompt-argv.ts,
      // où l'injection est démontrée sur le binaire claude).
      const result = await runCommand('codex', ['exec', '--', task.prompt], ctx, CODEX_TIMEOUT_MS);
      return { ...result, subAgents: [] };
    },
  };
}
