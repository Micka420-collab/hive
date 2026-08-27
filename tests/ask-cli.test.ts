// `hive ask` — la Reine répond, et le badge dit D'OÙ vient la réponse.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage loupe du 3 août a rendu SANS TEST le badge de provenance :
//
//     const badge = res.source === 'llm' ? '✨ IA' : '📡 état réel';
//
// Muté en `!==`, chaque réponse du concierge — calculée depuis l'état RÉEL de
// la ruche, déterministe, vérifiable — s'afficherait « ✨ IA », et une réponse
// générée s'afficherait « 📡 état réel ». Le badge existe précisément pour que
// l'hôte sache s'il lit un fait ou une plausibilité ; inversé, il enseignerait
// la méfiance des faits et la confiance des inventions.
//
// Même harnais que `mode-cli.test.ts` : une VRAIE ruche dans ce processus, la
// VRAIE CLI en sous-processus (`execFile` asynchrone — `execFileSync`
// bloquerait le serveur qui doit répondre : interblocage parfait).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-ask-suffisamment-long-ici';
const RACINE = fileURLToPath(new URL('..', import.meta.url));

describe('la commande `hive ask` — source', () => {
  it('cmdAsk branche SIGINT → AbortController (miroir Reine UI)', () => {
    // Sans exécuter un Ctrl+C réel : la garde refuse de retirer le filet
    // que la vue Reine a déjà (Effacer / démontage).
    const src = readFileSync(path.join(RACINE, 'src/cli.ts'), 'utf8');
    const bloc = src.slice(
      src.indexOf('async function cmdAsk'),
      src.indexOf('async function cmdRace'),
    );
    expect(bloc).toContain('AbortController');
    expect(bloc).toContain('SIGINT');
    expect(bloc).toContain('(interrompu)');
    expect(bloc).toContain('signal: ac.signal');
  });
});

describe('la commande `hive ask`', () => {
  let server: HiveServer;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-ask-cli-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    server.store.createProject({ name: 'Projet d’essai' });
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const execFileAsync = promisify(execFile);
  const lancer = async (...args: string[]): Promise<{ code: number; sortie: string }> => {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'src/cli.ts', 'ask', ...args],
        {
          cwd: RACINE,
          encoding: 'utf8',
          env: {
            ...process.env,
            NO_COLOR: '1',
            HIVE_TOKEN: TOKEN,
            HIVE_HTTP: `http://127.0.0.1:${server.port}`,
          },
        },
      );
      return { code: 0, sortie: `${stdout}${stderr}` };
    } catch (e) {
      const err = e as { code?: number; stdout?: string; stderr?: string };
      return { code: err.code ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('UNE RÉPONSE DEPUIS L’ÉTAT RÉEL PORTE LE BADGE 📡 — jamais ✨ IA', async () => {
    // La prémisse d'abord : sans clé de modèle dans l'environnement du test,
    // le concierge répond depuis l'état réel (`source: 'live'`) — c'est la
    // réponse qu'on juge. La question est une intention que `detectIntent`
    // reconnaît sans ambiguïté (les nœuds).
    const r = await lancer('quelles ouvrières sont connectées ?');
    expect(r.code, r.sortie).toBe(0);
    expect(r.sortie).toContain('👑 La Reine');
    expect(r.sortie, 'l’état réel se présente comme tel').toContain('📡 état réel');
    expect(r.sortie, 'un fait ne se déguise pas en génération').not.toContain('✨ IA');
  }, 30_000);

  it('LE CHEMIN SSE : en-tête sans badge, puis (📡 état réel) en bas', async () => {
    // `cmdAsk` demande Accept: text/event-stream. Le chemin JSON imprimerait
    // `👑 La Reine (📡 état réel) :` d’un coup ; le flux écrit d’abord
    // `👑 La Reine :`, puis le badge après les deltas. Muter le Accept ou
    // sauter le lecteur SSE basculerait sur le rendu JSON et ferait rougir.
    const r = await lancer('quelles ouvrières sont connectées ?');
    expect(r.code, r.sortie).toBe(0);
    expect(r.sortie, 'en-tête du flux, badge pas encore collé').toMatch(/👑 La Reine :\s*\n/);
    expect(r.sortie, 'pas le rendu JSON d’un coup').not.toMatch(/👑 La Reine \(📡 état réel\) :/);
    expect(r.sortie).toMatch(/\(📡 état réel\)/);
  }, 30_000);
});
