// Adaptateur Codex CLI (`codex exec`). Ossature du Palier 1, même contrat et
// mêmes garde-fous que claude-code : clés locales au nœud, token non-trivial.

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import {
  codexMcpOverrides,
  createDelegationBridge,
  type DelegationBridge,
} from './delegation-bridge.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CODEX_TIMEOUT_MS = 15 * 60_000;

/** Arguments `codex exec` avec le modèle aiguillé et le pont MCP optionnels. */
export function argvCodex(prompt: string, modele?: string, bridge?: DelegationBridge): string[] {
  return [
    'exec',
    ...(modele ? ['--model', modele] : []),
    ...(bridge ? codexMcpOverrides(bridge) : []),
    '--',
    prompt,
  ];
}

export function createCodexAdapter(token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN): AgentAdapter {
  assertRealExecutionAllowed("L'adaptateur codex", token);
  return {
    name: 'codex',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      ctx.onProgress({ log: 'codex exec démarré' });
      let bridge: DelegationBridge | undefined;
      try {
        if (ctx.delegate && ctx.waitForDelegationResult) {
          bridge = await createDelegationBridge(ctx, task.id);
        }
        // `--` avant le prompt : sans lui, un prompt commençant par un tiret est
        // lu comme une option de `codex exec` (cf. src/adapters/prompt-argv.ts,
        // où l'injection est démontrée sur le binaire claude).
        const result = await runCommand(
          'codex',
          argvCodex(task.prompt, ctx.modele, bridge),
          ctx,
          CODEX_TIMEOUT_MS,
        );
        return { ...result, subAgents: [] };
      } catch (error) {
        return {
          success: false,
          diff: '',
          logs: `[hive] pont de délégation indisponible : ${error instanceof Error ? error.message : String(error)}`,
          subAgents: [],
          infra: true,
        };
      } finally {
        await bridge?.close();
      }
    },
  };
}
