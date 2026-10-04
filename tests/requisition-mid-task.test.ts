import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-requisition-midtask-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

describe('réquisition mid-task — boucle B/C/D', () => {
  let server: HiveServer;
  let dir: string;
  let client: HiveNodeClient;

  afterEach(async () => {
    client?.stop();
    await server?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('infra auth → réquisition avec taskId ; accordee → tâche done', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-req-mid-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      envPath: path.join(dir, '.env'),
      simulation: true,
      tickMs: 60,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const auth = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({
        email: 'admin@hive.test',
        password: 'mot-de-passe-test',
        displayName: 'Admin',
      }),
    });
    const { token: adminToken } = (await auth.json()) as { token: string };
    const adminHeaders = { ...headers, authorization: `Bearer ${adminToken}` };

    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Req mid' }),
      })
    ).json()) as { id: string };
    const tasks = (await (
      await fetch(`${base}/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: [{ title: 'Auth test', prompt: 'work' }] }),
      })
    ).json()) as Task[];
    const taskId = tasks[0]!.id;

    let phase: 'fail' | 'ok' = 'fail';
    const adapter: AgentAdapter = {
      name: 'fail-auth',
      async run() {
        if (phase === 'fail') {
          return {
            success: false,
            diff: '',
            logs: 'Error 401 Unauthorized — api key invalid',
            subAgents: [],
            infra: true,
          };
        }
        // La reprise rend ce que l'adaptateur a DÉCLARÉ, comme une exécution
        // ordinaire : elle recopiait les champs à la main, et en perdait.
        return {
          success: true,
          diff: 'diff ok',
          logs: 'ok',
          subAgents: [],
          fournisseur: { source: 'codex', coutUsd: 0.25 },
          finalText: 'Garde ajoutée après la reprise',
        };
      },
    };

    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'mid-req-node',
      ownerName: 'test',
      agentType: 'codex',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    client.start();

    const deadlineReq = Date.now() + 12_000;
    let reqId: string | undefined;
    while (Date.now() < deadlineReq) {
      const rows = server.store.listerRequisitions({ statut: 'ouverte' });
      const hit = rows.find((r) => r.taskId === taskId);
      if (hit) {
        reqId = hit.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(reqId, 'réquisition ouverte liée à la tâche').toBeTruthy();

    phase = 'ok';
    const rep = await fetch(`${base}/api/requisitions/${reqId}/repondre`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ decision: 'accordee', secret: 'sk-midtask-test' }),
    });
    expect(rep.status).toBe(200);
    const repBody = (await rep.json()) as { envVar?: string };
    // La seule variable que `codex exec` lit : la Chambre pose CELLE-LÀ.
    expect(repBody.envVar).toBe('CODEX_API_KEY');
    delete process.env.CODEX_API_KEY;

    const deadlineDone = Date.now() + 12_000;
    while (Date.now() < deadlineDone) {
      if (server.store.getTask(taskId)?.status === 'done') break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(server.store.getTask(taskId)?.status).toBe('done');
    const fait = server.store
      .listEvents(0, 500)
      .find((e) => e.type === 'task_done' && e.payload.taskId === taskId);
    expect(fait?.payload.fournisseur, 'coût déclaré perdu à la reprise').toEqual({
      source: 'codex',
      coutUsd: 0.25,
    });
    // Le texte final a voyagé lui aussi : le souvenir Hive Mind en est fait —
    // proposé à la réussite, il entre en mémoire à l'approbation humaine.
    const revue = await fetch(`${base}/api/tasks/${taskId}/review`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state: 'approved' }),
    });
    expect(revue.status).toBe(200);
    expect(server.store.listMemories().find((m) => m.taskId === taskId)?.content).toContain(
      'Garde ajoutée après la reprise',
    );
  });

  it('infra ENOENT → réquisition binaire avec taskId ; accordee → tâche done', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-req-bin-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      envPath: path.join(dir, '.env'),
      simulation: true,
      tickMs: 60,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const auth = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
      body: JSON.stringify({
        email: 'admin@hive.test',
        password: 'mot-de-passe-test',
        displayName: 'Admin',
      }),
    });
    const { token: adminToken } = (await auth.json()) as { token: string };
    const adminHeaders = { ...headers, authorization: `Bearer ${adminToken}` };

    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Req binaire' }),
      })
    ).json()) as { id: string };
    const tasks = (await (
      await fetch(`${base}/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: [{ title: 'Spawn test', prompt: 'work' }] }),
      })
    ).json()) as Task[];
    const taskId = tasks[0]!.id;

    let phase: 'fail' | 'ok' = 'fail';
    let binOk = false;
    const adapter: AgentAdapter = {
      name: 'fail-enoent',
      async run() {
        if (phase === 'fail') {
          return {
            success: false,
            diff: '',
            logs: '[hive] échec du lancement de « claude » : spawn claude ENOENT',
            subAgents: [],
            infra: true,
          };
        }
        return { success: true, diff: 'diff ok', logs: 'ok', subAgents: [] };
      },
    };

    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'mid-bin-node',
      ownerName: 'test',
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
      verifierBinaireAgent: async () => binOk,
    });
    client.start();

    const deadlineReq = Date.now() + 12_000;
    let reqId: string | undefined;
    let genre: string | undefined;
    while (Date.now() < deadlineReq) {
      const rows = server.store.listerRequisitions({ statut: 'ouverte' });
      const hit = rows.find((r) => r.taskId === taskId);
      if (hit) {
        reqId = hit.id;
        genre = hit.genre;
        break;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(reqId, 'réquisition binaire ouverte').toBeTruthy();
    expect(genre).toBe('binaire');

    // Accorder alors que le CLI manque encore → pause conservée, nouvelle req.
    const repTropTot = await fetch(`${base}/api/requisitions/${reqId}/repondre`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ decision: 'accordee' }),
    });
    expect(repTropTot.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(server.store.getTask(taskId)?.status).not.toBe('done');

    const deadlineReq2 = Date.now() + 12_000;
    let reqId2: string | undefined;
    while (Date.now() < deadlineReq2) {
      const rows = server.store.listerRequisitions({ statut: 'ouverte' });
      const hit = rows.find((r) => r.taskId === taskId && r.genre === 'binaire');
      if (hit) {
        reqId2 = hit.id;
        break;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    expect(reqId2, 'seconde réquisition binaire (CLI encore absent)').toBeTruthy();

    phase = 'ok';
    binOk = true;
    const rep = await fetch(`${base}/api/requisitions/${reqId2}/repondre`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ decision: 'accordee' }),
    });
    expect(rep.status).toBe(200);

    const deadlineDone = Date.now() + 12_000;
    while (Date.now() < deadlineDone) {
      if (server.store.getTask(taskId)?.status === 'done') break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(server.store.getTask(taskId)?.status).toBe('done');
  });

  it('un 429 de Claude Code n’ouvre PAS de réquisition d’identifiants : réaffectation', async () => {
    // La ligne `init` du stream-json porte `"apiKeySource"` à chaque exécution.
    // Lu sur les logs bruts, `ECHEC_CREDENTIAL_RE` y voyait une clé en cause :
    // une limite de débit ouvrait une réquisition d'identifiants, et la tâche
    // restait en pause devant un humain qui n'avait rien à accorder. Le genre se
    // lit sur ce que l'échec DIT (shared/texte-d-echec.ts).
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-req-429-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      envPath: path.join(dir, '.env'),
      simulation: true,
      tickMs: 60,
    });
    const projet = server.store.createProject({ name: 'Req 429' });
    const taskId = server.store.createTask({
      projectId: projet.id,
      title: 'Débit',
      prompt: 'w',
    }).id;

    const init = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 's',
      apiKeySource: 'ANTHROPIC_API_KEY',
    });
    const adapter: AgentAdapter = {
      name: 'claude-429',
      async run() {
        return {
          success: false,
          diff: '',
          logs: `${init}\n${JSON.stringify({ type: 'result', is_error: true, result: 'API Error: 429' })}`,
          finalText: 'API Error: 429 rate_limit_error',
          subAgents: [],
          infra: true,
        };
      },
    };
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'noeud-429',
      ownerName: 'test',
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    client.start();
    server.store.patchTask(taskId, { status: 'ready' });

    const deadline = Date.now() + 12_000;
    let rejet: unknown;
    while (Date.now() < deadline && rejet === undefined) {
      rejet = server.store
        .listEvents(0, 500)
        .find((e) => e.type === 'task_rejected' && e.payload.taskId === taskId)?.payload;
      if (rejet === undefined) await new Promise((r) => setTimeout(r, 60));
    }
    expect(rejet, 'la tâche doit être réaffectée').toMatchObject({ infra: true });
    // Et le refus DIT ce que l'agent a dit : il part sans les logs, et
    // « agent indisponible (auth/quota) » seul ne laissait rien à lire à
    // l'opérateur (Hive 0.5.0 : l'ouvrière Codex réaffectée sans un mot).
    expect(rejet).toMatchObject({
      reason: 'agent indisponible : API Error: 429 rate_limit_error',
    });
    expect(
      server.store.listerRequisitions({ statut: 'ouverte' }).filter((r) => r.taskId === taskId),
    ).toEqual([]);
  });
});
