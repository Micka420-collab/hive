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

/**
 * Les arguments de `claude -p`, avec le modèle de l'Aiguillage en option s'il y
 * en a un.
 *
 * `--permission-mode acceptEdits` : SANS lui, `claude -p` sans terminal refuse
 * silencieusement chaque `Edit`/`Write` (« you haven't granted it yet »,
 * `is_error: true`) — l'agent tourne, propose de vraies corrections, le process
 * sort en code 0, et le nœud calcule un diff VIDE. `success: true` masquait la
 * panne : mesuré en double sur ce dépôt (deux tâches, 0 octet de diff malgré 8
 * `Edit` tentés sur la seconde). `acceptEdits` — pas `bypassPermissions` — reste
 * scopé aux fichiers : la tâche s'exécute déjà dans un clone jetable, un
 * répertoire dédié, un environnement épuré (`buildSandboxEnv`, ni HOME ni
 * variables du membre), donc autoriser l'écriture n'ouvre rien de plus large.
 *
 * `--model <nom>` va AVANT le `--` : c'est une OPTION, et tout ce qui suit `--`
 * est du texte de prompt (cf. l'injection démontrée dans `prompt-argv.ts`). Le
 * prompt reste donc en TOUT DERNIER, derrière `--`. Un nom de modèle n'est pas un
 * secret ; il part en clair, comme `--verbose`. `spawn` reçoit ce tableau tel
 * quel (`shell: false`), donc aucun de ces mots ne passe par un shell.
 */
export function argvClaude(prompt: string, modele?: string): string[] {
  const drapeauxModele = modele ? ['--model', modele] : [];
  const drapeauxPermission = ['--permission-mode', 'acceptEdits'];
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    ...drapeauxPermission,
    ...drapeauxModele,
    '--',
    prompt,
  ];
}

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
      //
      // LE PROMPT EST EN DERNIER, DERRIÈRE `--`, ET CE N'EST PAS COSMÉTIQUE :
      // il était auparavant collé après `-p`, où un prompt commençant par un
      // tiret était lu comme une OPTION. Vérifié sur le binaire réel —
      // `claude -p '--version' …` imprimait la version sans jamais voir de
      // prompt. Le hub pouvait ainsi choisir les options de l'agent sur la
      // machine du membre, donc désarmer les garde-fous que celui-ci y a posés.
      // Tout ce qui suit `--` est du texte. Cf. src/adapters/prompt-argv.ts.
      const result = await runCommandStreaming(
        'claude',
        argvClaude(task.prompt, ctx.modele),
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
