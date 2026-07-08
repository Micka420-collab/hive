// Adaptateur par défaut. Deux modes :
// - simulé (défaut) : aucun processus lancé, travail factice réaliste — sûr,
//   utilisé par la démo et les tests.
// - réel (HIVE_REAL_SHELL=1) : exécute le prompt comme une commande via
//   spawn(bin, argv, { shell: false }). REFUSÉ si HIVE_TOKEN est trivial.

import { randomUUID } from 'node:crypto';
import { DEFAULT_TOKEN } from '../shared/types.js';
import type { SubAgent, Task } from '../shared/types.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

export interface ShellAdapterOptions {
  /** Autorise l'exécution réelle (HIVE_REAL_SHELL=1). */
  realShell?: boolean;
  /** Token courant — sert au garde-fou anti-RCE. */
  token?: string;
}

export function createShellAdapter(options: ShellAdapterOptions = {}): AgentAdapter {
  const realShell = options.realShell ?? process.env.HIVE_REAL_SHELL === '1';
  const token = options.token ?? process.env.HIVE_TOKEN ?? DEFAULT_TOKEN;
  if (realShell) {
    // Refus immédiat au démarrage du nœud, pas au moment d'exécuter.
    assertRealExecutionAllowed('Le mode HIVE_REAL_SHELL=1', token);
  }
  return {
    name: realShell ? 'shell' : 'shell (simulé)',
    run: (task, ctx) => (realShell ? runReal(task, ctx) : runSimulated(task, ctx)),
  };
}

// ─── Mode simulé ─────────────────────────────────────────────────────────────

/** Petit hachage déterministe : la simulation est stable pour une même tâche. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('tâche annulée'));
      },
      { once: true },
    );
  });
}

function fakeDiff(task: Task): string {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return [
    `--- /dev/null`,
    `+++ b/src/${slug}.ts`,
    `@@ -0,0 +1,4 @@`,
    `+// ${task.title}`,
    `+export function run() {`,
    `+  return 'butiné par la ruche (tâche ${task.id.slice(0, 8)})';`,
    `+}`,
    ``,
  ].join('\n');
}

/**
 * Simulation : 3 à 5 étapes de ~350-750 ms, 1 à 2 sous-agents qui pulsent.
 * Le marqueur [flaky] dans le prompt fait échouer la première tentative —
 * pratique pour démontrer le mécanisme de retry en démo.
 */
async function runSimulated(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
  const logs: string[] = [`[sim] butinage de « ${task.title} » (tentative ${ctx.attempt})`];
  const workers = ['exploratrice', 'butineuse', 'architecte'];
  const subAgents: SubAgent[] = Array.from({ length: 1 + (hash(task.id) % 2) }, (_, i) => ({
    id: randomUUID(),
    name: workers[i % workers.length] as string,
    status: 'running',
  }));

  const steps = 3 + (hash(`${task.id}:steps`) % 3);
  for (let s = 1; s <= steps; s++) {
    await sleep(350 + (hash(`${task.id}:${s}`) % 400), ctx.signal);
    logs.push(`[sim] étape ${s}/${steps}`);
    ctx.onProgress({ subAgents, log: `étape ${s}/${steps}` });
  }

  if (task.prompt.includes('[flaky]') && ctx.attempt === 1) {
    for (const sa of subAgents) sa.status = 'failed';
    logs.push('[sim] échec simulé (marqueur [flaky], tentative 1) — la ruche va réessayer');
    return { success: false, diff: '', logs: logs.join('\n'), subAgents };
  }

  for (const sa of subAgents) sa.status = 'done';
  logs.push('[sim] terminé');
  return { success: true, diff: fakeDiff(task), logs: logs.join('\n'), subAgents };
}

// ─── Mode réel (opt-in explicite) ────────────────────────────────────────────

/**
 * Le prompt est interprété comme UNE commande : soit un tableau JSON
 * (`["npm", "run", "build"]`), soit une découpe naïve sur les espaces.
 * Aucune substitution, aucun pipe, aucun shell.
 */
function parseArgv(prompt: string): string[] | null {
  const trimmed = prompt.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string' && x.length > 0)) {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

async function runReal(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
  const argv = parseArgv(task.prompt);
  if (!argv || argv.length === 0) {
    return {
      success: false,
      diff: '',
      logs: '[hive] prompt vide ou invalide pour le mode shell réel',
      subAgents: [],
    };
  }
  ctx.onProgress({ log: `exécution : ${argv.join(' ')}` });
  return runCommand(argv[0] as string, argv.slice(1), ctx);
}
