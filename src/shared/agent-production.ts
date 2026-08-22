// Règles agents — production vs simulation.
//
// MODULE PUR. La ruche ne doit pas assigner de vrai travail à un adaptateur
// simulé, sauf mode démo explicite (HIVE_SIMULATION=1 ou HIVE_AGENT=shell).

/** Types d'agent qui ne produisent pas de code réel. */
export const AGENTS_SIMULES = ['shell', 'sim'] as const;

export type AgentSimule = (typeof AGENTS_SIMULES)[number];

export function estAgentSimule(agentType: string): boolean {
  return (AGENTS_SIMULES as readonly string[]).includes(agentType);
}

/** Mode démo orchestrateur (token trivial, shell toléré). */
export function modeSimulationOrchestrateur(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HIVE_SIMULATION === '1';
}

/** Shell explicitement imposé (tests, démo locale). */
export function shellForce(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.HIVE_AGENT ?? '').trim() === 'shell';
}

/**
 * Un nœud peut recevoir du travail de production ?
 * Orchestrateur : `simulation` vient de la config serveur.
 * Nœud : `modeSimulationOrchestrateur()` ou `shellForce()`.
 */
export function assignationProductionAutorisee(
  agentType: string,
  opts: { simulation?: boolean } = {},
): boolean {
  if (!estAgentSimule(agentType)) return true;
  return opts.simulation === true;
}

/**
 * Le processus nœud (`main.ts`) peut démarrer avec cet agent ?
 * Refus si shell détecté sans opt-in explicite.
 */
export function demarrageNoeudAutorise(
  agentType: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!estAgentSimule(agentType)) return true;
  return modeSimulationOrchestrateur(env) || shellForce(env);
}

/** Message d'erreur standard quand aucun agent réel n'est disponible. */
export function messageRefusShellProduction(lang: 'fr' | 'en' = 'fr'): string {
  const fr =
    'Aucun agent de codage détecté. Installez Claude Code (`npm i -g @anthropic-ai/claude-code`) ' +
    'ou Codex, puis relancez. Pour une démo simulée uniquement : HIVE_SIMULATION=1 ou HIVE_AGENT=shell.';
  const en =
    'No coding agent detected. Install Claude Code (`npm i -g @anthropic-ai/claude-code`) ' +
    'or Codex, then restart. For simulation demo only: HIVE_SIMULATION=1 or HIVE_AGENT=shell.';
  return lang === 'en' ? en : fr;
}
