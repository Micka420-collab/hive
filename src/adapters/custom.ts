// Adaptateur « commande libre » : branche N'IMPORTE QUELLE IA de codage en CLI
// dans la ruche, sans code dédié. Le membre définit HIVE_AGENT_CMD (ex.
// « aider --yes --message {prompt} ») ; la commande est découpée sur les espaces
// (argv — JAMAIS de shell, contrainte §5.1) et exécutée dans le workspace isolé.
// Le prompt de la tâche remplace le jeton {prompt} s'il est présent, sinon il est
// ajouté en dernier argument. Le diff est calculé par le workspace git du nœud.
// La commande vient de l'environnement DU MEMBRE (consentement) ; les secrets
// restent locaux au nœud.

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CUSTOM_TIMEOUT_MS = 15 * 60_000;
const PROMPT_PLACEHOLDER = '{prompt}';

export function createCustomAdapter(
  cmd = process.env.HIVE_AGENT_CMD ?? '',
  token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN,
): AgentAdapter {
  // Une commande libre lance un vrai processus : mêmes exigences que le shell réel.
  assertRealExecutionAllowed("L'adaptateur custom", token);
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(
      'Adaptateur custom : définissez HIVE_AGENT_CMD, ex. « aider --yes --message {prompt} ».',
    );
  }
  const [bin, ...rest] = parts as [string, ...string[]];

  return {
    name: 'custom',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      const argv = rest.includes(PROMPT_PLACEHOLDER)
        ? rest.map((a) => (a === PROMPT_PLACEHOLDER ? task.prompt : a))
        : [...rest, task.prompt];
      ctx.onProgress({ log: `commande libre : ${bin}` });
      const result = await runCommand(bin, argv, ctx, CUSTOM_TIMEOUT_MS);
      return { ...result, subAgents: [] };
    },
  };
}
