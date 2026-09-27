// Adaptateur Codex CLI (`codex exec`). Ossature du Palier 1, même contrat et
// mêmes garde-fous que claude-code : clés locales au nœud, token non-trivial.

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommandFlux } from './exec.js';
import {
  codexMcpOverrides,
  createDelegationBridge,
  resultatSansPont,
  type DelegationBridge,
} from './delegation-bridge.js';
import { createLecteurFluxCodex } from './flux-codex.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CODEX_TIMEOUT_MS = 15 * 60_000;

/**
 * Arguments `codex exec` avec le modèle aiguillé et le pont MCP optionnels.
 *
 * `--json` : la sortie est le flux d'événements que lit `flux-codex.ts` — la
 * réponse finale, les jetons déclarés, les erreurs à part de la narration.
 * Sans lui, `codex exec` répète la consigne sur stderr, et le nœud y classait
 * l'échec (voir l'en-tête de `flux-codex.ts`).
 */
export function argvCodex(prompt: string, modele?: string, bridge?: DelegationBridge): string[] {
  return [
    'exec',
    '--json',
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
        if (ctx.delegate && ctx.waitForDelegationResult && ctx.rendezVous) {
          bridge = await createDelegationBridge(ctx, task.id);
        }
        // `--` avant le prompt : sans lui, un prompt commençant par un tiret est
        // lu comme une option de `codex exec` (cf. src/adapters/prompt-argv.ts,
        // où l'injection est démontrée sur le binaire claude).
        //
        // La réponse, les jetons et les logs viennent du FLUX, lu en entier :
        // le dernier message de l'agent, jamais la consigne — que le mode
        // humain répétait sur stderr, « valide » ou « conteste » compris.
        const flux = createLecteurFluxCodex();
        const result = await runCommandFlux(
          'codex',
          argvCodex(task.prompt, ctx.modele, bridge),
          ctx,
          flux,
          CODEX_TIMEOUT_MS,
          // Le dossier du pont, que le bac éventuel monte en lecture seule.
          bridge?.dossier,
        );
        const fournisseur = flux.declaration();
        return { ...result, subAgents: [], ...(fournisseur ? { fournisseur } : {}) };
      } catch (error) {
        return resultatSansPont(error, []);
      } finally {
        await bridge?.close();
      }
    },
  };
}
