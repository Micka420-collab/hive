// Choix d'agent au démarrage du nœud : détecter, puis demander si plusieurs.
//
// MODULE majoritairement pur — la seule I/O est `demander` injectée (readline),
// pour que la règle « quand demander / quoi retenir » s'éprouve sans terminal.

import { choisirDansListe } from '../choix-cli.js';
import { libelleAgent } from '../shared/agent-libelle.js';
import { direNiveau, outil } from '../shared/catalogue-outils.js';
import {
  type AgentType,
  type DetectedAgent,
  type Sonde,
  detectAllAgents,
  labelPour,
} from './agent-detect.js';

/** Agents réels (tout sauf le simulateur `shell`). */
export function agentsReels(tous: readonly AgentType[]): AgentType[] {
  return tous.filter((a) => a !== 'shell');
}

/**
 * Faut-il poser la question à l'humain ?
 *
 * `HIVE_AGENT` / `HIVE_AGENT_CMD` = choix déjà fait. Un seul agent réel = rien
 * à trancher. Hors TTY (CI, service) = on garde l'ordre de préférence, sans
 * bloquer sur une saisie impossible.
 */
export function fautDemanderChoixAgent(opts: {
  forceAgent: string;
  agentCmd: string;
  reels: readonly AgentType[];
  stdinEstTty: boolean;
}): boolean {
  if (opts.forceAgent.trim()) return false;
  if (opts.agentCmd.trim()) return false;
  if (!opts.stdinEstTty) return false;
  return opts.reels.length > 1;
}

/** Texte du menu numéroté (sans la question finale). */
export function menuChoixAgent(reels: readonly AgentType[]): string {
  const lignes = reels.map((a, i) => {
    const niveau = outil(a)?.niveau;
    return `  ${i + 1}. ${libelleAgent(a)}${niveau ? ` — ${direNiveau(niveau)}` : ''}`;
  });
  return `Applications IA détectées sur ce poste :\n${lignes.join('\n')}`;
}

/**
 * Interprète la saisie : numéro valide → cet agent ; Entrée / blanc → `defaut` ;
 * autre chose → `null` (à redemander).
 */
export function interpreterChoixAgent(
  saisie: string,
  reels: readonly AgentType[],
  defaut: AgentType,
): AgentType | null {
  if (saisie.trim() === '') return defaut;
  return choisirDansListe(saisie, reels) ?? null;
}

/**
 * Résout l'agent au démarrage : force env → détection → question si plusieurs.
 */
export async function resoudreAgentAuDemarrage(opts: {
  env?: NodeJS.ProcessEnv;
  sonder?: Sonde;
  plateforme?: string;
  existe?: (chemin: string) => boolean;
  stdinEstTty?: boolean;
  /** Pose une question et rend la saisie (readline). Absente hors TTY. */
  demander?: (question: string) => Promise<string>;
  /** Inventaire déjà sondé : évite de relancer tous les binaires au démarrage. */
  agentsDetectes?: readonly AgentType[];
  /** Choix mémorisé localement sur ce poste. Les variables env restent prioritaires. */
  preferenceAgent?: AgentType;
  /** Ignore la préférence pour rouvrir le choix. */
  reconfigurer?: boolean;
}): Promise<DetectedAgent> {
  const env = opts.env ?? process.env;
  const force = (env.HIVE_AGENT ?? '').trim();
  if (force) {
    const agent = force as AgentType;
    return { agent, label: labelPour(agent) };
  }

  const tous = opts.agentsDetectes
    ? [...opts.agentsDetectes]
    : await detectAllAgents(env, opts.sonder, opts.plateforme, opts.existe);
  const reels = agentsReels(tous);
  if (!opts.reconfigurer && opts.preferenceAgent && tous.includes(opts.preferenceAgent)) {
    return {
      agent: opts.preferenceAgent,
      label: labelPour(opts.preferenceAgent),
    };
  }

  if (
    !fautDemanderChoixAgent({
      forceAgent: force,
      agentCmd: env.HIVE_AGENT_CMD ?? '',
      reels,
      stdinEstTty: opts.stdinEstTty ?? false,
    }) ||
    !opts.demander
  ) {
    const agent = reels[0] ?? 'shell';
    return { agent, label: labelPour(agent) };
  }

  const defautReel = reels[0]!;
  const indexDefaut = reels.indexOf(defautReel) + 1;

  console.log(`\n${menuChoixAgent(reels)}`);
  for (;;) {
    const saisie = await opts.demander(
      `Quelle application utiliser ? [1-${reels.length}] (Entrée = ${indexDefaut} · ${libelleAgent(defautReel)}) : `,
    );
    const choisi = interpreterChoixAgent(saisie, reels, defautReel);
    if (choisi) {
      console.log(`   → ${libelleAgent(choisi)} retenu.\n`);
      return { agent: choisi, label: labelPour(choisi) };
    }
    console.log(`   Saisie invalide — choisissez un numéro entre 1 et ${reels.length}.`);
  }
}
