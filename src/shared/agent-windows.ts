// Lancer un agent installé par npm, sur Windows, sans interpréteur de commandes.
//
// ─── LE DÉFAUT, MESURÉ ───────────────────────────────────────────────────────
//
// Sur une machine Windows où Claude Code est installé par npm, la ruche ne s'en
// sert PAS. Elle retombe sur l'adaptateur `shell`, qui est simulé : la ruche a
// l'air de tourner et produit de faux diffs.
//
// La cause est connue et documentée dans `agent-detect.ts` : npm n'y installe
// qu'un shim `claude.cmd`, et `spawn(…, { shell: false })` ne peut pas lancer un
// `.cmd` — c'est documenté par Node, et durci depuis la CVE-2024-27980. La sonde
// échoue donc toujours, quelle que soit la machine.
//
// Le constat s'arrêtait là : « corriger demanderait de lancer autre chose que le
// shim, ce que la contrainte §5.1 rend délibérément difficile ».
//
// ─── CE QU'ON FAIT À LA PLACE, ET POURQUOI C'EST PLUS STRICT, PAS MOINS ──────
//
// Exactement ce que `lanceur.ts` fait déjà pour `npm` : **on vise le script
// JavaScript réel, et on lance Node**, qui est un vrai binaire. Aucun shell
// n'intervient, à aucun moment — et l'on sait précisément quel fichier on
// exécute, au lieu de déléguer la résolution à `cmd.exe`.
//
// Un paquet npm installé globalement expose son code à un endroit DÉDUCTIBLE :
//
//     <préfixe npm>/node_modules/<paquet>/<entrée>
//
// C'est l'agencement d'une installation npm standard — vérifié sur une
// installation réelle de Claude Code, dont le `cli.js` vit bien sous
// `node_modules/@anthropic-ai/claude-code/`.
//
// ─── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
//
// Il ne touche pas au disque : il CALCULE un chemin. C'est l'appelant qui
// vérifie que le fichier existe, et qui décide quoi faire s'il n'existe pas.
// Cette séparation est ce qui rend la branche Windows vérifiable depuis Linux —
// sans quoi elle ne serait éprouvée que sur la machine où l'on ne teste jamais,
// et c'est précisément ce qui a laissé la variante `.cmd` en place pendant des
// mois sans que personne la mette en doute.

import path from 'node:path';

/** Un agent distribué comme paquet npm, et où trouver son point d'entrée. */
export interface PaquetAgent {
  /** Le nom npm, `@portée/nom` compris. */
  readonly paquet: string;
  /** Le fichier à donner à Node, relatif à la racine du paquet. */
  readonly entree: string;
}

/**
 * Les agents qu'on sait retrouver quand leur shim n'est pas lançable.
 *
 * Liste explicite, et courte. On ne devine pas le point d'entrée d'un paquet
 * inconnu : se tromper de fichier lancerait autre chose que ce qu'on croit, et
 * `HIVE_AGENT_CMD` reste la porte de sortie pour tout le reste.
 */
export const PAQUETS_AGENTS: Readonly<Record<string, PaquetAgent>> = {
  claude: { paquet: '@anthropic-ai/claude-code', entree: 'cli.js' },
};

/**
 * Le préfixe global de npm, tel que Windows l'agence.
 *
 * `npm_config_prefix` d'abord : il est posé quand on tourne DANS un script npm,
 * et il porte le préfixe réel — y compris quand quelqu'un l'a déplacé, ce que
 * `npm config set prefix` permet et que rien d'autre ne trahirait.
 *
 * `APPDATA\npm` ensuite, qui est le défaut de l'installeur Node sous Windows.
 */
export function prefixeNpmWindows(env: NodeJS.ProcessEnv): string | null {
  const explicite = env.npm_config_prefix?.trim();
  if (explicite) return explicite;
  const appdata = env.APPDATA?.trim();
  return appdata ? path.win32.join(appdata, 'npm') : null;
}

/**
 * Où vit le script d'un agent npm global — ou `null` si on ne peut pas le dire.
 *
 * Rend `null` hors Windows : ailleurs, les scripts portent un shebang et
 * `spawn` les exécute sans intermédiaire. Le problème n'existe que là.
 */
export function scriptAgentWindows(
  bin: string,
  env: NodeJS.ProcessEnv,
  plateforme: string,
): string | null {
  if (plateforme !== 'win32') return null;
  const paquet = PAQUETS_AGENTS[bin];
  if (!paquet) return null;
  const prefixe = prefixeNpmWindows(env);
  if (!prefixe) return null;
  // `path.win32.join` normalise les barres : `@anthropic-ai/claude-code` devient
  // `@anthropic-ai\claude-code` sans qu'on ait à le découper.
  //
  // Une première version le découpait « pour être sûr ». La loupe l'a montré
  // ÉQUIVALENT — les deux formes rendent la même chaîne — et une précaution qui
  // ne change rien n'est pas une précaution : c'est une ligne de plus à lire,
  // qui se fait passer pour de la rigueur.
  return path.win32.join(prefixe, 'node_modules', paquet.paquet, paquet.entree);
}

/**
 * L'argv à lancer pour un agent — un TABLEAU, jamais une chaîne.
 *
 * `existe` est injecté : ce module ne touche pas au disque, et c'est ce qui
 * rend la branche Windows vérifiable depuis Linux.
 *
 * Hors Windows, et sur Windows quand rien n'est déductible, on rend `[bin]` —
 * c'est-à-dire exactement le comportement d'avant. **Cette fonction ne peut pas
 * dégrader une machine qui marchait** : elle ajoute un chemin là où il n'y en
 * avait aucun.
 */
export function argvAgent(
  bin: string,
  env: NodeJS.ProcessEnv,
  plateforme: string,
  existe: (chemin: string) => boolean,
): string[] {
  const script = scriptAgentWindows(bin, env, plateforme);
  if (script !== null && existe(script)) {
    // `process.execPath` serait plus précis, mais il pointe vers le Node qui
    // fait tourner le NŒUD — pas forcément celui du PATH. `node` est un vrai
    // `.exe` sous Windows, donc lançable sans shell, et c'est celui que
    // l'utilisateur a installé.
    return ['node', script];
  }
  return [bin];
}
