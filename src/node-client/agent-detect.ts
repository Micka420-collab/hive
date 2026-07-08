// Détection des agents IA de codage installés sur la machine du membre.
// Objectif : qu'un ami n'ait RIEN à configurer — on repère automatiquement son
// Claude Code ou son Codex et on choisit le bon adaptateur.
//
// Sécurité : sondage par spawn(bin, ['--version'], { shell:false }) — jamais
// d'interprétation shell. On ne fait que constater la présence du binaire.

import { spawn } from 'node:child_process';

export type AgentType = 'claude-code' | 'codex' | 'shell';

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

/** Variantes d'un binaire à essayer selon la plateforme (Windows : .cmd/.exe). */
function candidates(bin: string): string[] {
  if (process.platform === 'win32') return [`${bin}.cmd`, `${bin}.exe`, bin];
  return [bin];
}

/** Vrai si `bin --version` peut être lancé (le binaire existe sur le PATH). */
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
      finish(true); // il a démarré (donc présent) mais ne répond pas assez vite
    }, timeoutMs);
    timer.unref?.();
    // ENOENT = binaire introuvable ; toute autre issue = binaire présent.
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      finish(err.code !== 'ENOENT');
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish(true);
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
export async function detectBestAgent(): Promise<DetectedAgent> {
  for (const probe of PROBES) {
    if (await firstPresent(probe.bins)) {
      return { agent: probe.agent, label: probe.label };
    }
  }
  return { agent: 'shell', label: 'shell (simulé)' };
}

/** Liste tous les agents détectés (pour information / diagnostic). */
export async function detectAllAgents(): Promise<AgentType[]> {
  const found: AgentType[] = [];
  for (const probe of PROBES) {
    if (await firstPresent(probe.bins)) found.push(probe.agent);
  }
  found.push('shell');
  return found;
}
