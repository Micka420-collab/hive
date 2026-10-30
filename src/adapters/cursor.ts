// Adaptateur Cursor CLI en mode headless (`agent -p --force`).
// Docs : https://cursor.com/docs/cli/headless
// Binaire : `agent` (installeur officiel) ou `cursor-agent` (alias historique).
// Les clés restent locales au nœud (CURSOR_API_KEY / session ~/.cursor) — §5.1.

import { existsSync } from 'node:fs';
import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { cheminsNatifs } from '../node-client/agent-detect.js';
import { assertRealExecutionAllowed, runCommandStreaming } from './exec.js';
import { graviteStreamJson, lecteurCursor } from './texte-final.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CURSOR_TIMEOUT_MS = 15 * 60_000;

/**
 * Ce que Cursor EXÉCUTE du dépôt, sans drapeau pour l'en empêcher : en mode
 * print, `--force` vaut confiance du dossier, et « les hooks du projet
 * tournent dans tout espace de confiance » (cursor.com/docs/hooks). Lu dans le
 * paquet 2026.09.02 : `.cursor/hooks.json`, et au format Claude les hooks (et
 * `enabledPlugins`) de `.claude/settings.json` / `.claude/settings.local.json`.
 * Les serveurs de `.cursor/mcp.json` attendent une approbation que Hive ne
 * donne pas (`--approve-mcps` absent). Écartés par le nœud :
 * `node-client/configuration-inerte.ts`.
 */
export const CONFIGURATION_EXECUTEE_CURSOR: readonly string[] = [
  '.cursor/hooks.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
];

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
    configurationExecutee: CONFIGURATION_EXECUTEE_CURSOR,
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      const bin = binaireCursor(process.env, process.platform, existsSync);
      ctx.onProgress({ log: `${bin} -p --force (stream-json) démarré` });
      // Même flux que Claude Code, mais PAS la même ligne `result` : chez
      // Cursor, elle recolle toute la narration de l'exécution. La réponse est
      // le texte depuis le dernier outil — un lecteur neuf par exécution.
      // Ses événements d'erreur, eux, ont la forme de Claude Code (`result` à
      // `is_error`) : sans `graviteStreamJson`, ils partaient à l'écran en
      // simple stdout, et la console n'avait aucune erreur de Cursor à filtrer.
      const result = await runCommandStreaming(
        bin,
        argvCursor(task.prompt, ctx.modele),
        ctx,
        graviteStreamJson,
        CURSOR_TIMEOUT_MS,
        lecteurCursor(),
      );
      return { ...result, subAgents: [] };
    },
  };
}
