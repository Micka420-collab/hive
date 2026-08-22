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
      simulation: true,
      tickMs: 60,
    });
    const base = `http://127.0.0.1:${server.port}`;

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
        return { success: true, diff: 'diff ok', logs: 'ok', subAgents: [] };
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
    await fetch(`${base}/api/requisitions/${reqId}/repondre`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'accordee' }),
    });

    const deadlineDone = Date.now() + 12_000;
    while (Date.now() < deadlineDone) {
      if (server.store.getTask(taskId)?.status === 'done') break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(server.store.getTask(taskId)?.status).toBe('done');
  });
});
