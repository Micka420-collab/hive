// Le pont de délégation d'un nœud, quel que soit le dossier d'où il part.
//
// ─── LA PANNE QUE CE BANC TIENT FERMÉE ───────────────────────────────────────
//
// Le pont MCP ouvrait son socket Unix DANS le dossier de la tâche
// (`<workRoot>/tasks/<task-id>-<nœud>/.hive/s`) et refusait un chemin de plus
// de 100 caractères. Or la racine de travail par défaut est `./.hive-work/<nom>`,
// relative au dossier d'où l'on lance le nœud : depuis un projet un peu
// profond, CHAQUE tâche Claude Code ou Codex échouait avant même de lancer le
// CLI — en « échec d'infrastructure », réaffectée avec le motif « agent
// indisponible (auth/quota) », qui ne disait rien de la cause. La CI l'a
// trouvé sous macOS (`/var/folders/…`) ; seul le banc avait été raccourci.
//
// Ces bancs passent par le VRAI chemin : un orchestrateur réel, `HiveNodeClient`,
// le vrai adaptateur `claude-code`, et un faux `claude` qui, comme le vrai, lit
// `--mcp-config` et lance le serveur MCP qui s'y trouve. Sa réponse
// `initialize` n'arrive qu'une fois le pont joint et authentifié : c'est elle
// qui prouve que le socket est atteignable.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { HIVE_DELEGATE_TOOL, HIVE_WAIT_TOOL } from '../src/adapters/delegation-bridge.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { PREFIXE_PONT } from '../src/shared/empreinte.js';
import { FAUX_CLAUDE_MCP } from './aide/faux-claude-mcp.js';

const TOKEN = 'jeton-pont-racine-profonde-long';

let server: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let racine = '';

afterEach(async () => {
  client?.stop();
  client = null;
  await server?.stop();
  server = null;
  vi.unstubAllEnvs();
  if (racine) rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
  racine = '';
});

/** Une ruche réelle, un faux `claude` en tête de PATH, et un nœud Claude Code. */
async function noeudClaude(workRoot: string): Promise<HiveServer> {
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(racine, 'hive.db'),
    simulation: false,
    tickMs: 20,
  });
  const bin = path.join(racine, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'claude'), FAUX_CLAUDE_MCP);
  chmodSync(path.join(bin, 'claude'), 0o755);
  vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
  client = new HiveNodeClient({
    url: `ws://127.0.0.1:${server.port}/ws`,
    token: TOKEN,
    name: 'ouvriere-profonde',
    ownerName: 'test',
    agentType: 'claude-code',
    nodeId: 'ouvriere-profonde',
    maxConcurrency: 1,
    workRoot,
    adapter: createClaudeCodeAdapter(TOKEN),
    quiet: true,
  });
  client.start();
  return server;
}

async function attendre<T>(lire: () => T | undefined, message: string): Promise<T> {
  const limite = Date.now() + 20_000;
  while (Date.now() < limite) {
    const v = lire();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/** Pose une tâche prête et rend le premier résultat que le nœud en rapporte. */
async function premierResultat(srv: HiveServer) {
  await attendre(
    () => (srv.store.listNodes().some((n) => n.id === 'ouvriere-profonde') ? true : undefined),
    'le nœud ne rejoint pas la ruche',
  );
  const projet = srv.store.createProject({ name: 'Pont profond' });
  const tache = srv.store.createTask({
    projectId: projet.id,
    title: 'Joindre le pont',
    prompt: 'délègue si besoin',
  });
  srv.store.patchTask(tache.id, { status: 'ready' });
  const resultat = await attendre(
    () => srv.store.resultsForTask(tache.id).at(0),
    'aucun résultat : la tâche a été rejetée ou réaffectée au lieu d’aboutir',
  );
  return { tache, resultat };
}

/** Les dossiers de pont de CE processus, dans le dossier temporaire donné. */
function pontsDuProcessus(tmp: string): string[] {
  return readdirSync(tmp).filter((n) => n.startsWith(`${PREFIXE_PONT}${process.pid}-`));
}

describe.skipIf(process.platform === 'win32')(
  'le pont de délégation d’un nœud ne dépend pas de sa racine de travail',
  () => {
    it('une racine de plus de 120 caractères mène une tâche Claude Code jusqu’au pont', async () => {
      racine = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hive-pont-profond-')));
      // Délibérément PROFONDE : la tâche vivra sous
      // `<racine>/<130 car.>/tasks/<id>-<nœud>`, bien au-delà de tout sun_path.
      const workRoot = path.join(racine, 'projets-du-membre-'.padEnd(130, 'x'));
      expect(workRoot.length).toBeGreaterThan(120);
      const avant = new Set(pontsDuProcessus(os.tmpdir()));

      const srv = await noeudClaude(workRoot);
      const { resultat } = await premierResultat(srv);

      expect(resultat.success, resultat.logs).toBe(true);
      // La ligne `result` du faux CLI (la ruche ne garde `finalText` que d'un
      // échec) : le pont a répondu à `initialize` puis listé ses outils.
      expect(resultat.logs).toContain(`outils du pont : ${HIVE_DELEGATE_TOOL},${HIVE_WAIT_TOOL}`);

      // Le rendez-vous du nœud vit sous le dossier temporaire du système, hors
      // de la racine de travail — et l'arrêt du nœud l'emporte.
      const crees = pontsDuProcessus(os.tmpdir()).filter((n) => !avant.has(n));
      expect(crees, 'un dossier de pont pour ce nœud').toHaveLength(1);
      client!.stop();
      expect(pontsDuProcessus(os.tmpdir())).not.toContain(crees[0]);
    }, 40_000);

    it('un TMPDIR trop profond fait échouer la tâche EN LE DISANT — jamais en panne d’agent', async () => {
      racine = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hive-pont-tmpdir-')));
      // Le seul cas où le chemin du socket peut encore dépasser la limite
      // AF_UNIX : c'est le dossier temporaire lui-même qui est trop long.
      const tmpProfond = path.join(racine, 'tmp-du-membre-'.padEnd(120, 't'));
      mkdirSync(tmpProfond, { recursive: true });
      vi.stubEnv('TMPDIR', tmpProfond);

      const srv = await noeudClaude(path.join(racine, 'work'));
      const { tache, resultat } = await premierResultat(srv);

      // Un RÉSULTAT d'échec, pas un `task_reject` : la tâche n'est pas
      // réaffectée en boucle sous un motif « auth/quota » qui mentirait.
      expect(resultat.success).toBe(false);
      expect(resultat.logs).toMatch(/socket du pont de délégation trop long/);
      expect(resultat.logs).toContain('TMPDIR');
      expect(resultat.logs).toContain(tmpProfond);
      expect(
        srv.store.listerRequisitions({ statut: 'ouverte' }).filter((r) => r.taskId === tache.id),
        'un chemin trop long n’est pas une panne d’identifiants',
      ).toEqual([]);
    }, 40_000);
  },
);
