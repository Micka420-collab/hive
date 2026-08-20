// Allumer / éteindre le bureau de RECETTE — profil compose `atelier`.
//
// L'isolement des TÂCHES (`src/node-client/isolement.ts`) n'est pas remplacé :
// l'Atelier est l'écran où l'agent VOIT son travail. Sans moteur, pas de
// simulacre (ADR 0008, décision 5). MODULE PUR pour le plan ; le spawn est
// injecté.

import { spawn } from 'node:child_process';
import { adresseEcran, nomValide, type Moteur, type Plan } from '../shared/atelier.js';
import { PORT_CDP } from './cdp.js';
import { PORT_OUTIL } from './outil.js';

export const MODES_ATELIER = ['off', 'auto', 'on'] as const;
export type ModeAtelier = (typeof MODES_ATELIER)[number];

export const MODE_ATELIER_DEFAUT: ModeAtelier = 'off';

export const PORT_NOVNC = 6080;
export const PROFIL_COMPOSE = 'atelier';

/** Une faute de frappe retombe sur off : on n'allume pas un bureau par accident. */
export function atelierDepuisEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ModeAtelier {
  const brut = env.HIVE_ATELIER;
  return brut === 'auto' || brut === 'on' ? brut : MODE_ATELIER_DEFAUT;
}

export function portVueDepuisEnv(env: Readonly<Record<string, string | undefined>>): number {
  const n = Number(env.HIVE_ATELIER_PORT);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : PORT_NOVNC;
}

export function portCdpDepuisEnv(env: Readonly<Record<string, string | undefined>>): number {
  const n = Number(env.HIVE_ATELIER_CDP);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : PORT_CDP;
}

export function portOutilDepuisEnv(env: Readonly<Record<string, string | undefined>>): number {
  const n = Number(env.HIVE_ATELIER_OUTIL);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : PORT_OUTIL;
}

/**
 * L'environnement passé au CLI `docker compose` (sur l'HÔTE).
 *
 * Ce n'est PAS une liste d'autorisation : le client Docker sous Windows a
 * besoin de `SystemRoot` / `PATHEXT`. C'est une liste de REFUS des secrets
 * Hive et des clés d'API. Le conteneur atelier, lui, n'a pas d'`env_file`.
 */
export function envComposeAtelier(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const secret = /^(HIVE_|ANTHROPIC_|OPENAI_|XAI_|AWS_|GITHUB_|STRIPE_|QUEEN_|OPENROUTER_)/u;
  const suffixe = /(_TOKEN|_SECRET|_KEY|_PASSWORD)$/u;
  for (const [cle, val] of Object.entries(env)) {
    if (!val) continue;
    if (secret.test(cle) || suffixe.test(cle)) continue;
    out[cle] = val;
  }
  return out;
}

export function moteurAtelier(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Moteur {
  return env.HIVE_ATELIER_MOTEUR === 'podman' ? 'podman' : 'docker';
}

export function planComposeAtelier(moteur: Moteur | null): Plan {
  if (moteur === null) {
    return {
      ok: false,
      raison:
        'Atelier indisponible : aucun moteur de conteneur (docker ou podman). ' +
        "L'agent travaillera sans bureau — il n'y a pas de bureau simulé.",
    };
  }
  return {
    ok: true,
    bin: moteur,
    argv: ['compose', '--profile', PROFIL_COMPOSE, 'up', '-d', 'atelier'],
  };
}

export function planComposeArret(moteur: Moteur | null): Plan {
  if (moteur === null) return { ok: false, raison: 'Aucun moteur de conteneur.' };
  return {
    ok: true,
    bin: moteur,
    argv: ['compose', '--profile', PROFIL_COMPOSE, 'stop', 'atelier'],
  };
}

export type SpawnFn = (
  bin: string,
  argv: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean },
) => ReturnType<typeof spawn>;

export async function executerPlan(
  plan: Plan,
  opts: { spawnFn?: SpawnFn; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ ok: boolean; code: number; stderr: string }> {
  if (!plan.ok) return { ok: false, code: 1, stderr: plan.raison };
  const spawnFn = opts.spawnFn ?? spawn;
  return await new Promise((resolve) => {
    const enfant = spawnFn(plan.bin, [...plan.argv], {
      cwd: opts.cwd,
      env: envComposeAtelier(opts.env ?? {}),
      shell: false,
    });
    let stderr = '';
    enfant.stderr?.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    enfant.on('error', (err) => resolve({ ok: false, code: 127, stderr: err.message }));
    enfant.on('close', (code) => resolve({ ok: (code ?? 1) === 0, code: code ?? 1, stderr }));
  });
}

export interface EtatAtelier {
  readonly mode: ModeAtelier;
  readonly actif: boolean;
  readonly ecran: string;
  readonly cdp: string;
  readonly outil: string;
  readonly raison?: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function etatAtelier(opts: {
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}): Promise<EtatAtelier> {
  const env = opts.env ?? process.env;
  const mode = atelierDepuisEnv(env);
  const portVue = portVueDepuisEnv(env);
  const portCdp = portCdpDepuisEnv(env);
  const portOutil = portOutilDepuisEnv(env);
  const ecran = adresseEcran(portVue);
  const cdp = `http://127.0.0.1:${String(portCdp)}`;
  const outil = `http://127.0.0.1:${String(portOutil)}`;
  if (mode === 'off') {
    return { mode, actif: false, ecran, cdp, outil, raison: 'HIVE_ATELIER=off' };
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const ms = opts.timeoutMs ?? 250;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetchFn(`${outil}/sante`, { signal: ctrl.signal });
    clearTimeout(t);
    return { mode, actif: res.ok, ecran, cdp, outil };
  } catch {
    return {
      mode,
      actif: false,
      ecran,
      cdp,
      outil,
      raison: 'bureau injoignable — lancez le profil compose atelier',
    };
  }
}

export function nomConteneurRecette(): string {
  const nom = 'hive-atelier-recette';
  return nomValide(nom) ? nom : 'hive-atelier';
}
