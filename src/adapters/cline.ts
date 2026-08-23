// Adaptateur Cline — agent de codage headless en ligne de commande.
//
// Docs : https://docs.cline.bot/cline-cli/getting-started
// Binaire : `cline` (installé par `npm i -g cline`).
//
// ─── CE QUI EST VÉRIFIÉ, ET CE QUI NE L'EST PAS ──────────────────────────────
//
// Vérifié sur la documentation officielle :
//   · `cline --json "tâche"` — mode sans interface, sortie JSON par lignes ;
//   · `--auto-approve <booléen>` — exécution sans confirmation ;
//   · le mode sans interface s'enclenche aussi sur une entrée redirigée.
//
// NON vérifié, et donc NON supposé : que `cline` comprenne le terminateur
// POSIX `--`. Les adaptateurs `claude-code` et `cursor` s'en servent parce que
// leur binaire a été éprouvé ; ici, lui en injecter un casserait peut-être la
// commande. On emploie `texteNonOption()`, qui ne suppose rien de la CLI et
// protège du même défaut — un prompt commençant par un tiret ne doit jamais
// devenir une OPTION de l'agent (voir `prompt-argv.ts` pour la mesure).
//
// Les clés restent locales au nœud : Cline lit sa propre configuration de
// fournisseur, et rien de tout cela ne transite par le hub.

import { existsSync } from 'node:fs';
import { DEFAULT_TOKEN } from '../shared/types.js';
import type { Task } from '../shared/types.js';
import { cheminsNatifs } from '../node-client/agent-detect.js';
import { assertRealExecutionAllowed, runCommand } from './exec.js';
import { texteNonOption } from './prompt-argv.js';
import type { AdapterContext, AdapterResult, AgentAdapter } from './index.js';

const CLINE_TIMEOUT_MS = 30 * 60_000;

/**
 * Les arguments de `cline`.
 *
 * `--auto-approve true` est ce qui rend l'exécution possible sans humain devant
 * l'écran — et c'est un choix de sécurité, pas une commodité. Ce qui le rend
 * acceptable ici : le nœud lance déjà tout agent dans un répertoire isolé avec
 * un environnement épuré, et dans un bac à sable quand la machine en offre un
 * (`isolement.ts`, `bac.ts`). Sans cette isolation, ce drapeau ne devrait pas
 * exister.
 *
 * Le prompt est le DERNIER argument, et passe par `texteNonOption`.
 */
export function argvCline(prompt: string): string[] {
  return ['--json', '--auto-approve', 'true', texteNonOption(prompt)];
}

/**
 * Quel binaire Cline lancer : `HIVE_CLINE_BIN`, sinon un chemin natif connu,
 * sinon `cline` sur le PATH.
 */
export function binaireCline(
  env: NodeJS.ProcessEnv = process.env,
  plateforme: string = process.platform,
  existe: (chemin: string) => boolean = existsSync,
): string {
  const force = (env.HIVE_CLINE_BIN ?? '').trim();
  if (force) return force;
  for (const chemin of cheminsNatifs('cline', env, plateforme)) {
    if (existe(chemin)) return chemin;
  }
  return 'cline';
}

export function createClineAdapter(token = process.env.HIVE_TOKEN ?? DEFAULT_TOKEN): AgentAdapter {
  assertRealExecutionAllowed("L'adaptateur cline", token);
  return {
    name: 'cline',
    async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
      const bin = binaireCline(process.env, process.platform, existsSync);
      ctx.onProgress({ log: `${bin} --json --auto-approve démarré` });
      const result = await runCommand(bin, argvCline(task.prompt), ctx, CLINE_TIMEOUT_MS);
      // `subAgents: []` : Cline rend bien du JSON par lignes, mais rien dans sa
      // documentation ne décrit un événement de sous-agent qu'on saurait lire.
      // En annoncer serait en inventer — le catalogue déclare donc
      // `sousAgents: false`, et un banc vérifie que les deux se répondent.
      return { ...result, subAgents: [] };
    },
  };
}
