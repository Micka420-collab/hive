// Aides communes aux adaptateurs qui lancent de vrais processus.
// Règle absolue (§5.1) : spawn(bin, argv, { shell: false }) — jamais shell:true.

import { spawn } from 'node:child_process';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from '../shared/types.js';
import type { AdapterContext, AdapterResult } from './index.js';

/** Toute exécution réelle exige un token non-trivial (contrainte §5.1). */
export function assertRealExecutionAllowed(kind: string, token: string): void {
  if (token === DEFAULT_TOKEN || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `${kind} refusé : HIVE_TOKEN est trivial (valeur par défaut ou < ${MIN_TOKEN_LENGTH} caractères). ` +
        'Configurez un vrai token partagé avant toute exécution réelle.',
    );
  }
}

const OUTPUT_CAP = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/**
 * Motifs signalant un échec d'INFRASTRUCTURE de l'agent (auth/quota/crédit) plutôt
 * qu'un échec de la tâche. Sert au token-failover : la tâche est réaffectée à un
 * autre nœud plutôt que de brûler une tentative. Volontairement large ; un faux
 * positif ne fait que déplacer la tâche (au pire elle échoue faute de nœud viable).
 */
const INFRA_FAILURE_RE =
  /unauthor|authentication|not logged in|forbidden|\b401\b|\b403\b|\b429\b|quota|rate.?limit|insufficient|out of credit|billing|api[_ -]?key|invalid.{0,12}key|login|sign in|subscription/i;

/**
 * Lance un binaire avec ses arguments dans le cwd isolé de la tâche.
 * Sortie plafonnée, timeout dur, annulation via le signal du contexte.
 */
export function runCommand(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AdapterResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: ctx.cwd,
      env: ctx.env,
      shell: false, // jamais d'interprétation shell (contrainte §5.1)
      windowsHide: true,
      signal: ctx.signal,
    });

    let output = '';
    const capture = (chunk: Buffer): void => {
      if (output.length < OUTPUT_CAP) output += chunk.toString();
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    const timeout = setTimeout(() => {
      output += `\n[hive] timeout après ${timeoutMs} ms — processus tué`;
      child.kill();
    }, timeoutMs);
    timeout.unref?.();

    child.on('error', (err) => {
      clearTimeout(timeout);
      // Le binaire n'a pas pu être lancé (absent, non exécutable) : échec d'infra.
      resolve({
        success: false,
        diff: '',
        logs: `${output}\n[hive] échec du lancement de « ${bin} » : ${err.message}`,
        subAgents: [],
        infra: true,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      // Échec dont la sortie évoque un problème d'auth/quota → infra (réaffectation).
      const infra = code !== 0 && INFRA_FAILURE_RE.test(output);
      resolve({
        success: code === 0,
        diff: '',
        logs: output,
        subAgents: [],
        ...(infra ? { infra: true } : {}),
      });
    });
  });
}

/**
 * Comme runCommand, mais invoque `onLine` pour CHAQUE ligne de stdout au fil de
 * l'eau (flux stream-json d'un agent). Sert au suivi des sous-agents en direct.
 * Le parseur `onLine` doit être tolérant ; toute exception y est absorbée.
 */
export function runCommandStreaming(
  bin: string,
  args: string[],
  ctx: AdapterContext,
  onLine: (line: string) => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<AdapterResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: ctx.cwd,
      env: ctx.env,
      shell: false, // jamais d'interprétation shell (contrainte §5.1)
      windowsHide: true,
      signal: ctx.signal,
    });

    let output = '';
    let buffer = '';
    const feed = (line: string): void => {
      try {
        onLine(line);
      } catch {
        /* parseur tolérant : on ignore */
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      if (output.length < OUTPUT_CAP) output += s;
      buffer += s;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        feed(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (output.length < OUTPUT_CAP) output += chunk.toString();
    });

    const timeout = setTimeout(() => {
      output += `\n[hive] timeout après ${timeoutMs} ms — processus tué`;
      child.kill();
    }, timeoutMs);
    timeout.unref?.();

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        diff: '',
        logs: `${output}\n[hive] échec du lancement de « ${bin} » : ${err.message}`,
        subAgents: [],
        infra: true,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (buffer.trim()) feed(buffer); // dernière ligne sans \n final
      const infra = code !== 0 && INFRA_FAILURE_RE.test(output);
      resolve({
        success: code === 0,
        diff: '',
        logs: output,
        subAgents: [],
        ...(infra ? { infra: true } : {}),
      });
    });
  });
}
