// Une configuration d'agent que le nœud ne PEUT PAS écarter refuse la tâche —
// par le vrai nœud, avec une raison lisible, et sans jamais lancer l'agent.
//
// `tests/configuration-inerte.test.ts` tient la panne au niveau de
// `ecarterConfiguration`. Ce banc tient le CÂBLAGE dans `client.ts` : si
// l'erreur perdait sa classe (`ConfigurationNonNeutralisable`) en route, la
// raison redevenait « clone impossible : … » — un mensonge sur la cause — sans
// qu'aucun autre test ne rougisse.
//
// La panne est RÉELLE : l'écartement tourne tel quel, sur un `.cursor` que l'on
// vient de passer en lecture seule dans le clone de la tâche — le seul moyen de
// le faire échouer après un clone frais (les droits de l'amont ne suivent pas).
// Fichier à part : `vi.mock` vaut pour tout le fichier. POSIX, hors root (root
// passe outre les droits).

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCursorAdapter } from '../src/adapters/cursor.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';

vi.mock('../src/node-client/configuration-inerte.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../src/node-client/configuration-inerte.js')>();
  const fs = await import('node:fs');
  const chemins = await import('node:path');
  return {
    ...reel,
    ecarterConfiguration: async (
      depot: { gitDir: string; workTree: string },
      declares: readonly string[],
    ) => {
      const cursor = chemins.join(depot.workTree, '.cursor');
      fs.chmodSync(cursor, 0o555);
      try {
        return await reel.ecarterConfiguration(depot, declares);
      } finally {
        fs.chmodSync(cursor, 0o755);
      }
    },
  };
});

const TOKEN = 'jeton-configuration-inerte-refus';
const POSIX = process.platform !== 'win32';
const RACINE = typeof process.getuid === 'function' && process.getuid() === 0;

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    [
      '-c',
      'user.email=banc@hive.local',
      '-c',
      'user.name=Banc Hive',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, stdio: 'ignore' },
  );
}

describe.runIf(POSIX && !RACINE)('une configuration non écartable refuse la tâche', () => {
  it(
    'refus d’infrastructure avant l’agent, la raison dit quoi et où, le CLI ne tourne pas',
    { timeout: 60_000 },
    async () => {
      const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-config-refus-'));
      aNettoyer.push(racine);
      const amont = path.join(racine, 'amont');
      mkdirSync(path.join(amont, '.cursor'), { recursive: true });
      git(amont, 'init', '-q', '-b', 'main');
      writeFileSync(path.join(amont, '.cursor', 'hooks.json'), '{"version":1,"hooks":{}}\n');
      writeFileSync(path.join(amont, 'a.txt'), 'base\n');
      git(amont, 'add', '-A');
      git(amont, 'commit', '-q', '-m', 'base');

      // Le faux CLI laisse une trace s'il est lancé : il ne doit jamais l'être.
      const trace = path.join(racine, 'cli-lance');
      const faux = path.join(racine, 'faux-cursor');
      writeFileSync(faux, `#!/bin/sh\ntouch '${trace}'\n`);
      chmodSync(faux, 0o755);
      const avant = process.env.HIVE_CURSOR_BIN;
      process.env.HIVE_CURSOR_BIN = faux;
      const server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(racine, 'hive.db'),
        simulation: false,
        tickMs: 20,
      });
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token: TOKEN,
        name: 'noeud-refus',
        ownerName: 'banc',
        agentType: 'custom',
        nodeId: 'noeud-refus',
        maxConcurrency: 1,
        workRoot: path.join(racine, 'work'),
        adapter: createCursorAdapter(TOKEN),
        quiet: true,
      });
      client.start();
      const attendre = async (condition: () => boolean, message: string): Promise<void> => {
        const limite = Date.now() + 30_000;
        while (Date.now() < limite) {
          if (condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(message);
      };
      try {
        await attendre(
          () => server.store.listNodes().some((n) => n.id === 'noeud-refus'),
          'le nœud ne rejoint pas la ruche',
        );
        const projet = server.store.createProject({ name: 'Dépôt à hooks', repoUrl: amont });
        const t = server.store.createTask({
          projectId: projet.id,
          title: 'Ajouter une ligne',
          prompt: 'ajouter une ligne à a.txt',
        });
        server.store.patchTask(t.id, { status: 'ready' });
        const refus = () =>
          server.store
            .listEvents(0, 1000)
            .filter((e) => e.type === 'task_rejected' && e.payload.taskId === t.id);
        await attendre(() => refus().length > 0, 'la tâche n’est jamais refusée');
        expect(refus()[0]?.payload).toMatchObject({
          infra: true,
          avantAgent: true,
          reason: 'hooks du dépôt non neutralisables : EACCES (.cursor/hooks.json)',
        });
        expect(server.store.resultsForTask(t.id)).toEqual([]);
        expect(existsSync(trace)).toBe(false);
        // Rien ne reste écarté à côté de la tâche.
        const taches = path.join(racine, 'work', 'tasks');
        expect(readdirSync(taches).filter((n) => n.endsWith('.inerte'))).toEqual([]);
      } finally {
        client.stop();
        await server.stop();
        if (avant === undefined) delete process.env.HIVE_CURSOR_BIN;
        else process.env.HIVE_CURSOR_BIN = avant;
      }
    },
  );
});
