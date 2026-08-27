// Adaptateur Cursor CLI en mode headless (`agent -p --force`).
// Docs : https://cursor.com/docs/cli/headless
// Binaire : `agent` (installeur officiel) ou `cursor-agent` (alias historique).
// Les clés restent locales au nœud (CURSOR_API_KEY / session ~/.cursor) — §5.1.

import { existsSync } from 'node:fs';
import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { cheminsNatifs } from '../node-client/agent-detect.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CURSOR_TIMEOUT_MS = 15 * 60_000;

/**
 * Arguments de `agent -p` : `--force` applique les edits (sans lui, print mode
 * propose seulement) ; le prompt reste DERNIER derrière `--` (cf. prompt-argv).
 */
export function argvCursor(prompt: string, modele?: string): string[] {
  const drapeauxModele = modele ? ['--model', modele] : [];
  // Même mise en forme que `argvClaude` : Prettier n'aplatit pas ce tableau
  // (print width), et le test `prompt-argv` ancre l'ordre `--` puis prompt.
  return ['-p', '--force', '--output-format', 'stream-json', ...drapeauxModele, '--', prompt];
}

/**
 * Quel binaire Cursor lancer : `HIVE_CURSOR_BIN`, sinon un chemin natif connu
 * (`~/.local/bin/cursor-agent` / `agent`), sinon `agent` sur le PATH.
 */
export function binaireCursor(
  env: NodeJS.ProcessEnv = process.env,
  plateforme: string = process.platform,
  existe: (chemin: string) => boolean = existsSync,
): string {
  const force = (env.HIVE_CURSOR_BIN ?? '').trim();
  if (force) return force;
  for (const nom of ['cursor-agent', 'agent'] as const) {
    for (const chemin of cheminsNatifs(nom, env, plateforme)) {
      if (existe(chemin)) return chemin;
    }
  }
  return 'agent';
}

export function createCursorAdapter(token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN): AgentAdapter {
  assertRealExecutionAllowed("L'adaptateur cursor", token);
  return {
    name: 'cursor',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      const bin = binaireCursor(process.env, process.platform, existsSync);
      ctx.onProgress({ log: `${bin} -p --force (stream-json) démarré` });
      const result = await runCommand(
        bin,
        argvCursor(task.prompt, ctx.modele),
        ctx,
        CURSOR_TIMEOUT_MS,
      );
      return { ...result, subAgents: [] };
    },
  };
}
