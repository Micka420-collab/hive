// `hive mode` — la commande, contre une VRAIE ruche.
//
// ─── CE QUE CE FICHIER AJOUTE AUX TESTS PURS ─────────────────────────────────
//
// `tests/mode.test.ts` verrouille la décision : quand confirmer, quand refuser,
// quand se taire. Il ne peut pas dire si la commande LIT le bon niveau ni si
// elle le POSE réellement — et c'est là qu'était le vrai piège : la première
// version lisait `/api/state`, qui ne porte pas le niveau. Elle aurait affiché
// « off » pour tous les projets, en silence, indéfiniment.
//
// Un réglage qui gouverne ce qu'une IA fait sans demander, montré faux, est
// pire que pas montré du tout : il invite à le reposer par-dessus.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-mode-suffisamment-long-ici';
const RACINE = fileURLToPath(new URL('..', import.meta.url));

describe('la commande `hive mode`', () => {
  let server: HiveServer;
  let dir: string;
  let projectId: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-mode-cli-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    projectId = server.store.createProject({ name: 'Projet d’essai' }).id;
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  // ─── `execFile` ASYNCHRONE, ET SURTOUT PAS `execFileSync` ──────────────────
  //
  // Les autres tests de CLI de ce dépôt utilisent `execFileSync` — et ils ont
  // raison : ils travaillent sur des fichiers, sans serveur.
  //
  // Ici la ruche tourne DANS CE PROCESSUS. `execFileSync` bloque le fil
  // synchroniquement : le serveur ne peut plus répondre, la CLI attend sa
  // réponse pour toujours, et `execFileSync` attend la CLI. Interblocage
  // parfait — la suite ne rougit pas, elle ne finit jamais, ce qui est la
  // panne la plus coûteuse à diagnostiquer.
  //
  // `process.execPath` plutôt que `npx` reste valable : sous Windows `npx` est
  // `npx.cmd`, que Node refuse de lancer sans shell (§ 6.2).
  const execFileAsync = promisify(execFile);
  const lancer = async (...args: string[]): Promise<{ code: number; sortie: string }> => {
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', 'src/cli.ts', 'mode', ...args],
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

  it(
    'SANS ARGUMENT, elle montre les quatre modes ET l’état réel du projet',
    { timeout: 60_000 },
    async () => {
      // Le test qui aurait attrapé le défaut de la première version : elle lisait
      // `/api/state`, qui ne porte pas le niveau, et affichait « off » pour tout.
      server.store.setEssaim(projectId, { niveau: 'gouverne', depotInscrit: false });
      const r = await lancer();
      expect(r.code).toBe(0);
      for (const m of ['off', 'propose', 'gouverne', 'plein']) {
        expect(r.sortie, `le mode ${m} doit être listé`).toContain(m);
      }
      // Chaque palier annonce aussi ce qu'il NE fait pas.
      expect(r.sortie).toMatch(/ne fait pas/);
      expect(r.sortie, 'le niveau réellement posé doit apparaître').toMatch(
        /Projet d’essai\s+→\s+gouverne/,
      );
    },
  );

  it('MONTER SANS ACCORD N’ÉCRIT RIEN et le dit', { timeout: 60_000 }, async () => {
    server.store.setEssaim(projectId, { niveau: 'off', depotInscrit: false });
    const r = await lancer('gouverne', projectId);
    // Code 3 = RÉPONSE MANQUANTE : ce n'est pas une erreur d'usage, c'est un
    // accord qui manque. Un script peut distinguer les deux.
    expect(r.code, 'il manque une réponse, pas un argument').toBe(3);
    expect(r.sortie).toMatch(/--oui/);
    expect(server.store.getEssaim(projectId)?.niveau ?? 'off', 'RIEN ne doit avoir été posé').toBe(
      'off',
    );
  });

  it('AVEC `--oui`, LE NIVEAU EST RÉELLEMENT POSÉ', { timeout: 60_000 }, async () => {
    server.store.setEssaim(projectId, { niveau: 'off', depotInscrit: false });
    const r = await lancer('gouverne', projectId, '--oui');
    expect(r.code).toBe(0);
    expect(server.store.getEssaim(projectId)?.niveau, 'le niveau doit être écrit').toBe('gouverne');
    // Et le second interrupteur est rappelé : le niveau seul ne lance rien.
    expect(r.sortie).toMatch(/HIVE_RUNNER/);
  });

  it('REDESCENDRE NE DEMANDE RIEN', { timeout: 60_000 }, async () => {
    server.store.setEssaim(projectId, { niveau: 'plein', depotInscrit: false });
    const r = await lancer('off', projectId);
    expect(r.code, 'reprendre la main est toujours sûr').toBe(0);
    expect(r.sortie).not.toMatch(/--oui/);
    expect(server.store.getEssaim(projectId)?.niveau).toBe('off');
  });

  it('un mode inconnu est refusé, sans rien écrire', { timeout: 60_000 }, async () => {
    server.store.setEssaim(projectId, { niveau: 'propose', depotInscrit: false });
    const r = await lancer('autonome', projectId);
    expect(r.code).toBe(1);
    expect(r.sortie).toMatch(/n’est pas un mode/);
    expect(server.store.getEssaim(projectId)?.niveau).toBe('propose');
  });
});
