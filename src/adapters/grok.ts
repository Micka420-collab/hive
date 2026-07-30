// Adaptateur Grok Build (`grok -p`) — l'agent de codage en CLI de xAI.
//
// ─── CE QUE C'EST, ET CE QUE CE N'EST PAS ────────────────────────────────────
//
// `grok-build` est un agent de codage en terminal, écrit en Rust, publié sous
// Apache 2.0 (github.com/xai-org/grok-build). Même forme que Claude Code et
// Codex : un binaire qui lit un prompt, modifie des fichiers, et sort. La ruche
// n'a donc rien de spécial à faire — c'est le contrat `AgentAdapter`, et le diff
// est calculé par le workspace git du nœud, comme pour les autres.
//
// **Le CODE est libre ; le MODÈLE ne l'est pas.** `grok` s'authentifie auprès de
// xAI — par `XAI_API_KEY`, ou par une session de navigateur rangée dans
// `~/.grok`. Ce n'est donc pas un agent local : c'est un agent dont l'outil est
// ouvert et le service payant. La distinction mérite d'être dite, parce que
// « open source » laisse croire le contraire.
//
// ─── POURQUOI PAS DE VARIANTE WINDOWS ICI ────────────────────────────────────
//
// `grok` est un binaire natif, installé par le script de xAI — pas un paquet
// npm. Il n'y a donc AUCUN shim `.cmd` à contourner, et rien à ajouter dans
// `shared/agent-windows.ts` : `spawn` sait lancer un `.exe`. C'est exactement
// pour ça que ce module est court là où Claude Code a demandé un module entier.

import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const GROK_TIMEOUT_MS = 15 * 60_000;

/**
 * Les drapeaux du mode sans écran, et pourquoi chacun est là.
 *
 * · `-p` met `grok` en mode non interactif : un prompt, une réponse, il sort.
 *   Sans lui, il ouvre son interface plein écran et attend une touche — le nœud
 *   resterait bloqué jusqu'au délai de garde, sans rien produire.
 *
 * · `--yolo` approuve automatiquement les outils. Le nom est de xAI, pas de
 *   nous, et il dit vrai : c'est un blanc-seing. On l'assume ICI parce qu'un
 *   nœud n'a personne pour répondre à une demande d'approbation — et parce que
 *   l'agent tourne dans le BAC À SABLE du nœud, avec le seul répertoire de la
 *   tâche visible. C'est l'isolement qui rend ce drapeau acceptable, pas la
 *   confiance.
 */
const DRAPEAUX_SANS_ECRAN = ['-p', '--yolo'] as const;

export function createGrokAdapter(token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN): AgentAdapter {
  assertRealExecutionAllowed("L'adaptateur grok", token);
  return {
    name: 'grok',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      ctx.onProgress({ log: 'grok -p démarré' });
      // ─── `--` AVANT LE PROMPT ────────────────────────────────────────────
      //
      // Sans lui, un prompt qui commence par un tiret est lu comme une option
      // de `grok`. C'est la même injection que `prompt-argv.ts` démontre sur le
      // binaire `claude`, et elle ne dépend pas de l'agent : elle dépend de la
      // façon dont TOUT analyseur d'arguments traite un tiret en tête.
      const result = await runCommand(
        'grok',
        [...DRAPEAUX_SANS_ECRAN, '--', task.prompt],
        ctx,
        GROK_TIMEOUT_MS,
      );
      return { ...result, subAgents: [] };
    },
  };
}
