// Détection des agents IA de codage installés sur la machine du membre.
// Objectif : qu'un ami n'ait RIEN à configurer — on repère automatiquement son
// Claude Code ou son Codex et on choisit le bon adaptateur.
//
// Sécurité : sondage par spawn(bin, ['--version'], { shell:false }) — jamais
// d'interprétation shell. On ne fait que constater la présence du binaire.

import { spawn } from 'node:child_process';

export type AgentType = 'claude-code' | 'codex' | 'custom' | 'shell';

interface AgentProbe {
  agent: Exclude<AgentType, 'shell'>;
  /** Binaires candidats (Windows ajoute .cmd/.exe automatiquement via la sonde). */
  bins: string[];
  label: string;
}

const PROBES: AgentProbe[] = [
  { agent: 'claude-code', bins: ['claude'], label: 'Claude Code' },
  { agent: 'codex', bins: ['codex'], label: 'Codex' },
];

/**
 * Variantes d'un binaire à essayer, selon la plateforme.
 *
 * ─── POURQUOI `.cmd` N'Y EST PAS, ALORS QU'IL Y ÉTAIT ────────────────────────
 *
 * La version précédente rendait `[bin.cmd, bin.exe, bin]` sous Windows, et
 * `.cmd` venait EN PREMIER. C'était une ligne qui ne pouvait pas fonctionner :
 * la sonde lance `spawn(bin, ['--version'], { shell: false })`, et Node refuse
 * d'exécuter un `.cmd` ou un `.bat` sans interpréteur de commandes — c'est
 * documenté, et durci depuis la CVE-2024-27980. Le candidat `.cmd` échouait
 * donc TOUJOURS, quelle que soit la machine.
 *
 * On ne garde pas une variante qui ne peut pas aboutir : elle donne l'illusion
 * d'une couverture. Restent `.exe`, la seule que `spawn` sait lancer sous
 * Windows, et le nom nu pour les rares binaires sans extension.
 *
 * ─── CE QUE ÇA IMPLIQUE, ET QU'IL FAUT DIRE ──────────────────────────────────
 *
 * Un agent installé par npm — c'est le cas de Claude Code — n'expose sous
 * Windows qu'un shim `claude.cmd`. Il est donc INDÉTECTABLE ici, et le nœud
 * retombe sur l'adaptateur `shell`, qui est simulé.
 *
 * Ce n'est pas silencieux : `hive doctor` affiche « aucun agent détecté » avec
 * la marche à suivre. Mais ce n'est pas satisfaisant non plus, et le corriger
 * demande de lancer autre chose que le shim — ce que la contrainte §5.1
 * (jamais `shell: true`) rend délibérément difficile. C'est écrit ici pour que
 * la prochaine personne parte de ce constat plutôt que de le redécouvrir.
 *
 * La plateforme est un PARAMÈTRE : sans ça, la branche Windows ne serait
 * vérifiable que sur une machine Windows, c'est-à-dire jamais. C'est exactement
 * ce qui a laissé la variante `.cmd` en place sans que personne la mette en
 * doute.
 */
export function candidates(bin: string, plateforme: string = process.platform): string[] {
  if (plateforme === 'win32') return [`${bin}.exe`, bin];
  return [bin];
}

/**
 * Vrai si `bin --version` s'exécute et retourne le code 0 — un signal POSITIF
 * de présence d'un vrai agent. On refuse volontairement les faux positifs :
 *  - timeout → « incertain », traité comme absent (on ne route pas de vraies
 *    tâches vers un binaire qui se bloque) ;
 *  - code de sortie ≠ 0, ou erreur de lancement (ENOENT, EACCES…) → absent.
 * Un environnement cassé retombe ainsi sur le shell simulé (sûr) plutôt que
 * d'envoyer du travail — et le token — à un binaire douteux.
 */
function probeBin(bin: string, timeoutMs = 4_000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (found: boolean): void => {
      if (done) return;
      done = true;
      resolve(found);
    };
    let child;
    try {
      child = spawn(bin, ['--version'], { shell: false, windowsHide: true, stdio: 'ignore' });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(false); // bloqué : incertain → considéré absent
    }, timeoutMs);
    timer.unref?.();
    child.on('error', () => {
      clearTimeout(timer);
      finish(false); // ENOENT / EACCES / etc. → absent
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0); // signal positif : le binaire a répondu correctement
    });
  });
}

/** Résout le premier binaire présent parmi les candidats d'un agent. */
async function firstPresent(bins: string[]): Promise<boolean> {
  for (const bin of bins) {
    for (const candidate of candidates(bin)) {
      if (await probeBin(candidate)) return true;
    }
  }
  return false;
}

export interface DetectedAgent {
  agent: AgentType;
  label: string;
}

/**
 * Détecte le meilleur agent disponible, dans l'ordre : Claude Code, puis Codex,
 * sinon l'adaptateur `shell` simulé (toujours disponible, sûr).
 */
export async function detectBestAgent(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DetectedAgent> {
  // Choix explicite du membre : une commande libre (n'importe quelle IA CLI) via
  // HIVE_AGENT_CMD prime sur la détection automatique.
  if ((env.HIVE_AGENT_CMD ?? '').trim()) {
    return { agent: 'custom', label: 'commande personnalisée (HIVE_AGENT_CMD)' };
  }
  for (const probe of PROBES) {
    if (await firstPresent(probe.bins)) {
      return { agent: probe.agent, label: probe.label };
    }
  }
  return { agent: 'shell', label: 'shell (simulé)' };
}

/**
 * Variables d'environnement qu'un agent RÉEL doit retrouver dans la sandbox
 * pour fonctionner : ses répertoires de config (HOME/…) et ses identifiants
 * (clé API). Sans elles, la sandbox épurée empêcherait `claude`/`codex` de
 * s'authentifier. L'adaptateur `shell` simulé ne reçoit rien (isolation totale).
 * Les secrets restent locaux au nœud — jamais transmis au hub.
 */
export function agentCredentialEnv(agent: AgentType): string[] {
  if (agent === 'shell') return [];
  const configDirs = ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'];
  if (agent === 'claude-code') {
    return [...configDirs, 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'];
  }
  if (agent === 'codex') {
    return [...configDirs, 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];
  }
  return configDirs;
}

/** Liste tous les agents détectés (pour information / diagnostic). */
export async function detectAllAgents(env: NodeJS.ProcessEnv = process.env): Promise<AgentType[]> {
  const found: AgentType[] = [];
  if ((env.HIVE_AGENT_CMD ?? '').trim()) found.push('custom');
  for (const probe of PROBES) {
    if (await firstPresent(probe.bins)) found.push(probe.agent);
  }
  found.push('shell');
  return found;
}
