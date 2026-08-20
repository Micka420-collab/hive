// Le démon d'outils de l'Atelier — canal SYSTÈME (REST).
//
// L'agent n'a pas le shell de l'hôte. Il frappe ce démon, qui n'exécute qu'une
// LISTE D'AUTORISATION, dans `/workspace`, sans les secrets de la ruche.
// MODULE PUR pour le jugement ; le serveur HTTP est une enveloppe mince.

import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

/** Port interne du démon. Compose le publie sur 127.0.0.1 seulement. */
export const PORT_OUTIL = 8765;

/** Racine unique du travail. Rien n'existe hors de là pour l'agent. */
export const RACINE_TRAVAIL = '/workspace';

/**
 * Binaires autorisés. Pas de `bash -c`, pas de `sudo`, pas de client Docker :
 * un interpréteur libre serait le shell de l'hôte avec un détour.
 */
export const COMMANDES = [
  'ls',
  'cat',
  'head',
  'mkdir',
  'python3',
  'python',
  'node',
  'npm',
  'npx',
  'tesseract',
  'soffice',
  'libreoffice',
] as const;

export type CommandeOk = (typeof COMMANDES)[number];

const SECRETS =
  /^(HIVE_|ANTHROPIC_|OPENAI_|XAI_|AWS_|GITHUB_|STRIPE_|QUEEN_|OPENROUTER_).*|.*(_TOKEN|_SECRET|_KEY|_PASSWORD)$/;

export interface Ordre {
  readonly argv: readonly string[];
  readonly cwd?: string;
}

export type JugementOrdre =
  | { readonly ok: true; readonly argv: readonly string[]; readonly cwd: string }
  | { readonly ok: false; readonly raison: string };

export function commandeConnue(nom: string): nom is CommandeOk {
  return (COMMANDES as readonly string[]).includes(nom);
}

/** Un cwd sous `/workspace`, sans `..` qui en sortirait. */
export function cwdSousWorkspace(demande: string | undefined): string | null {
  const brut = demande && demande !== '' ? demande : RACINE_TRAVAIL;
  const resolu = path.posix.normalize(brut.replaceAll('\\', '/'));
  if (resolu !== RACINE_TRAVAIL && !resolu.startsWith(`${RACINE_TRAVAIL}/`)) return null;
  if (resolu.includes('/..') || resolu === '..') return null;
  return resolu;
}

export function jugerOrdre(ordre: Ordre): JugementOrdre {
  if (!Array.isArray(ordre.argv) || ordre.argv.length === 0) {
    return { ok: false, raison: 'ordre vide' };
  }
  const bin = ordre.argv[0];
  if (typeof bin !== 'string' || !commandeConnue(bin)) {
    return { ok: false, raison: `commande refusée : « ${String(bin)} ».` };
  }
  if (ordre.argv.some((a) => typeof a !== 'string' || a === '')) {
    return { ok: false, raison: 'argument vide ou non-texte' };
  }
  // Un `-c` transformerait python/node en interpréteur d'une chaîne libre.
  // On veut des FICHIERS sous /workspace, pas une porte dérobée.
  if (bin === 'python' || bin === 'python3' || bin === 'node') {
    if (ordre.argv.slice(1).includes('-c') || ordre.argv.slice(1).includes('--eval')) {
      return { ok: false, raison: 'évaluation en ligne refusée — passez un fichier du workspace.' };
    }
  }
  const cwd = cwdSousWorkspace(ordre.cwd);
  if (cwd === null) {
    return { ok: false, raison: 'cwd hors /workspace' };
  }
  return { ok: true, argv: ordre.argv, cwd };
}

/**
 * Liste d'AUTORISATION. L'inverse de « on retire les secrets connus » : un
 * secret qu'on n'a pas listé ne passe pas non plus. PATH est posé par l'image.
 */
export function envOutil(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const ok = new Set(['PATH', 'LANG', 'TZ', 'HOME', 'USER', 'DISPLAY', 'TERM', 'LC_ALL']);
  const out: Record<string, string> = {};
  for (const [cle, val] of Object.entries(env)) {
    if (val === undefined || val === '') continue;
    if (SECRETS.test(cle)) continue;
    if (ok.has(cle)) out[cle] = val;
  }
  return out;
}

export interface ResultatOutil {
  readonly ok: boolean;
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type SpawnFn = typeof spawn;

const MAX_SORTIE = 64 * 1024;

export async function executerOrdre(
  juge: Extract<JugementOrdre, { ok: true }>,
  opts: { spawnFn?: SpawnFn; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ResultatOutil> {
  const spawnFn = opts.spawnFn ?? spawn;
  const env = envOutil(opts.env ?? {});
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return await new Promise((resolve) => {
    const enfant = spawnFn(juge.argv[0]!, juge.argv.slice(1), {
      cwd: juge.cwd,
      env,
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const horloge = setTimeout(() => {
      enfant.kill('SIGKILL');
    }, timeoutMs);
    enfant.stdout?.on('data', (b: Buffer) => {
      if (stdout.length < MAX_SORTIE) stdout += b.toString('utf8').slice(0, MAX_SORTIE);
    });
    enfant.stderr?.on('data', (b: Buffer) => {
      if (stderr.length < MAX_SORTIE) stderr += b.toString('utf8').slice(0, MAX_SORTIE);
    });
    enfant.on('error', (err) => {
      clearTimeout(horloge);
      resolve({ ok: false, code: 127, stdout, stderr: err.message });
    });
    enfant.on('close', (code) => {
      clearTimeout(horloge);
      const c = code ?? 1;
      resolve({ ok: c === 0, code: c, stdout, stderr });
    });
  });
}

async function lireJson(req: IncomingMessage): Promise<unknown> {
  const morceaux: Buffer[] = [];
  let n = 0;
  for await (const chunk of req) {
    n += chunk.length;
    if (n > 32 * 1024) throw new Error('corps trop grand');
    morceaux.push(chunk as Buffer);
  }
  const brut = Buffer.concat(morceaux).toString('utf8');
  if (brut.trim() === '') return {};
  return JSON.parse(brut) as unknown;
}

export async function traiterRequete(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { spawnFn?: SpawnFn; env?: NodeJS.ProcessEnv; reveil?: () => Promise<unknown> } = {},
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/sante') {
    res.end(JSON.stringify({ ok: true, canal: 'outil' }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/reveil') {
    const rapport = opts.reveil ? await opts.reveil() : { ok: true, lances: 0 };
    res.end(JSON.stringify(rapport));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/exec') {
    let corps: unknown;
    try {
      corps = await lireJson(req);
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'json invalide' }));
      return;
    }
    const argv = Array.isArray((corps as { argv?: unknown }).argv)
      ? ((corps as { argv: unknown[] }).argv as string[])
      : [];
    const cwd = (corps as { cwd?: string }).cwd;
    const juge = jugerOrdre({ argv, cwd });
    if (!juge.ok) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: juge.raison }));
      return;
    }
    const out = await executerOrdre(juge, { spawnFn: opts.spawnFn, env: opts.env });
    res.statusCode = out.ok ? 200 : 422;
    res.end(JSON.stringify(out));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'inconnu' }));
}

/** Écoute 0.0.0.0 DANS le conteneur ; compose publie 127.0.0.1 sur l'hôte. */
export function demarrerOutil(opts: {
  port?: number;
  spawnFn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  reveil?: () => Promise<unknown>;
}): ReturnType<typeof createServer> {
  const port = opts.port ?? PORT_OUTIL;
  const serveur = createServer((req, res) => {
    void traiterRequete(req, res, opts);
  });
  serveur.listen(port, '0.0.0.0');
  return serveur;
}

if (process.argv.includes('--serveur')) {
  demarrerOutil({ env: process.env });
}
