import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter, WorkerDelegationResult } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { parseServerMessage } from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'delegation-e2e-token-suffisant';

describe('délégation Worker → enfant en conditions réelles', () => {
  let server: HiveServer | null = null;
  let tempDir: string | null = null;
  const clients: HiveNodeClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.stop();
    if (server) await server.stop();
    server = null;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  it(
    'crée un enfant borné, rejoue la même clé et expose le résultat dans le graphe',
    { timeout: 30_000 },
    async () => {
      tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-delegation-e2e-'));
      server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: [],
        dbPath: path.join(tempDir, 'hive.db'),
        simulation: true,
        tickMs: 40,
      });
      const base = `http://127.0.0.1:${server.port}`;
      const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
      const projectResponse = await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Délégation e2e' }),
      });
      expect(projectResponse.status).toBe(201);
      const project = (await projectResponse.json()) as { id: string };
      const taskResponse = await fetch(`${base}/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tasks: [{ id: 'parent', title: 'Mission parent', prompt: 'délègue la vérification' }],
        }),
      });
      expect(taskResponse.status).toBe(201);

      const outcomes: Array<{ ok: boolean; childTaskId?: string }> = [];
      let childOutcome: {
        ok: boolean;
        parentTaskId?: string;
        childTaskId?: string;
        success?: boolean;
        diff?: string;
        logs?: string;
        durationMs?: number;
        resultId?: number;
      } | null = null;
      let replayAfterCompletionOutcome: WorkerDelegationResult | null = null;
      let releaseParent!: () => void;
      const parentReleased = new Promise<void>((resolve) => {
        releaseParent = resolve;
      });
      const parentAdapter: AgentAdapter = {
        name: 'parent-e2e',
        async run(task, ctx) {
          if (!ctx.delegate) throw new Error('capacité de délégation absente');
          const request = {
            childTaskId: 'child',
            reason: 'faire vérifier la sécurité par un Worker indépendant',
            title: 'Vérification sécurité',
            prompt: 'Analyse les chemins sensibles et rends les preuves.',
            durationMs: 60_000,
            costMicros: 100_000,
            resourceUnits: 1,
            preferredAgent: 'shell',
            preferredModel: 'modele-test',
          };
          const first = await ctx.delegate(request);
          outcomes.push({ ok: first.ok, ...(first.ok ? { childTaskId: first.childTaskId } : {}) });
          const replay = await ctx.delegate(request);
          outcomes.push({
            ok: replay.ok,
            ...(replay.ok ? { childTaskId: replay.childTaskId } : {}),
          });
          if (!ctx.waitForDelegationResult) {
            throw new Error('capacité de résultat de délégation absente');
          }
          childOutcome = await ctx.waitForDelegationResult('child');
          const replayAfterCompletion = await ctx.delegate(request);
          outcomes.push({
            ok: replayAfterCompletion.ok,
            ...(replayAfterCompletion.ok ? { childTaskId: replayAfterCompletion.childTaskId } : {}),
          });
          replayAfterCompletionOutcome = await ctx.waitForDelegationResult('child');
          await parentReleased;
          return {
            success: task.id === 'parent',
            diff: 'diff parent',
            logs: 'parent terminé',
            subAgents: [],
          };
        },
      };
      const childAdapter: AgentAdapter = {
        name: 'child-e2e',
        async run(task: Task) {
          return {
            success: task.id === 'child',
            diff: 'diff enfant',
            logs: 'tests enfant verts',
            subAgents: [],
          };
        },
      };

      const parentClient = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token: TOKEN,
        name: 'parent-node',
        ownerName: 'e2e',
        agentType: 'shell',
        maxConcurrency: 1,
        workRoot: path.join(tempDir, 'parent'),
        adapter: parentAdapter,
        quiet: true,
      });
      const childClient = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token: TOKEN,
        name: 'child-node',
        ownerName: 'e2e',
        agentType: 'shell',
        maxConcurrency: 1,
        workRoot: path.join(tempDir, 'child'),
        adapter: childAdapter,
        quiet: true,
      });
      clients.push(parentClient, childClient);
      parentClient.start();
      childClient.start();

      const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        while (!predicate() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(predicate()).toBe(true);
      };
      await waitFor(() => outcomes.length >= 2);
      expect(outcomes.slice(0, 2)).toEqual([
        { ok: true, childTaskId: 'child' },
        { ok: true, childTaskId: 'child' },
      ]);

      // Un autre nœud authentifié ne peut pas usurper le parent en cours.
      const intruder = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const rejection = new Promise<ReturnType<typeof parseServerMessage> | null>((resolve) => {
        intruder.on('message', (data) => {
          const parsed = parseServerMessage(data.toString());
          if (parsed?.type === 'delegation_rejected' && parsed.requestId === 'intruder-request') {
            resolve(parsed);
          }
        });
      });
      const nestedRejection = new Promise<ReturnType<typeof parseServerMessage> | null>(
        (resolve) => {
          intruder.on('message', (data) => {
            const parsed = parseServerMessage(data.toString());
            if (
              parsed?.type === 'delegation_rejected' &&
              parsed.requestId === 'intruder-deep-request'
            ) {
              resolve(parsed);
            }
          });
        },
      );
      await new Promise<void>((resolve, reject) => {
        intruder.once('open', () => resolve());
        intruder.once('error', reject);
      });
      intruder.send(
        JSON.stringify({
          type: 'register',
          token: TOKEN,
          name: 'intruder-node',
          ownerName: 'e2e',
          agentType: 'shell',
          maxConcurrency: 1,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      intruder.send(
        JSON.stringify({
          type: 'delegate_task',
          requestId: 'intruder-request',
          childTaskId: 'intruder-child',
          parentTaskId: 'parent',
          reason: 'usurpation',
          title: 'Ne doit pas exister',
          prompt: 'ne doit pas exister',
          durationMs: 1,
          costMicros: 1,
          resourceUnits: 1,
        }),
      );
      const rejected = await Promise.race([
        rejection,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      expect(rejected).toMatchObject({
        type: 'delegation_rejected',
        code: 'parent_non_attribue',
      });
      // Un rejet depuis un enfant doit rester visible dans le graphe de sa
      // racine, même lorsque l'enfant est déjà terminé.
      intruder.send(
        JSON.stringify({
          type: 'delegate_task',
          requestId: 'intruder-deep-request',
          childTaskId: 'intruder-deep-child',
          parentTaskId: 'child',
          reason: 'usurpation profonde',
          title: 'Ne doit pas exister',
          prompt: 'ne doit pas exister',
          durationMs: 1,
          costMicros: 1,
          resourceUnits: 1,
        }),
      );
      const nestedRejected = await Promise.race([
        nestedRejection,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      expect(nestedRejected).toMatchObject({
        type: 'delegation_rejected',
        requestId: 'intruder-deep-request',
      });
      intruder.close();

      releaseParent();
      await waitFor(() => {
        const parent = server!.store.getTask('parent');
        const child = server!.store.getTask('child');
        return parent?.status === 'done' && child?.status === 'done';
      });
      expect(childOutcome).toMatchObject({
        ok: true,
        parentTaskId: 'parent',
        childTaskId: 'child',
        success: true,
        diff: 'diff enfant',
        logs: 'tests enfant verts',
        durationMs: expect.any(Number),
        resultId: expect.any(Number),
      });
      expect(replayAfterCompletionOutcome).toMatchObject({
        ok: true,
        parentTaskId: 'parent',
        childTaskId: 'child',
        success: true,
        diff: 'diff enfant',
        logs: 'tests enfant verts',
        durationMs: expect.any(Number),
        resultId: expect.any(Number),
      });

      const graphResponse = await fetch(`${base}/api/tasks/parent/delegation`, { headers });
      expect(graphResponse.status).toBe(200);
      const graph = (await graphResponse.json()) as {
        graph: Array<{
          taskId: string;
          parentTaskId: string | null;
          depth: number;
          status: string;
        }>;
        events: Array<{ type: string; payload: Record<string, unknown> }>;
      };
      expect(graph.graph).toEqual([
        expect.objectContaining({ taskId: 'parent', parentTaskId: null, depth: 0, status: 'done' }),
        expect.objectContaining({
          taskId: 'child',
          parentTaskId: 'parent',
          depth: 1,
          status: 'done',
        }),
      ]);
      expect(graph.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'delegation_created',
            payload: expect.objectContaining({
              parentTaskId: 'parent',
              childTaskId: 'child',
              reason: 'faire vérifier la sécurité par un Worker indépendant',
            }),
          }),
          expect.objectContaining({
            type: 'delegation_replayed',
            payload: expect.objectContaining({ childTaskId: 'child' }),
          }),
          expect.objectContaining({
            type: 'delegation_result',
            payload: expect.objectContaining({
              parentTaskId: 'parent',
              childTaskId: 'child',
              success: true,
            }),
          }),
          expect.objectContaining({
            type: 'delegation_rejected',
            payload: expect.objectContaining({
              rootTaskId: 'parent',
              parentTaskId: 'child',
              childTaskId: 'intruder-deep-child',
            }),
          }),
        ]),
      );
      expect(server.store.getTask('intruder-child')).toBeUndefined();
    },
  );

  it(
    'interrompt un enfant quand son budget de durée est dépassé',
    { timeout: 30_000 },
    async () => {
      tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-delegation-budget-'));
      server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: [],
        dbPath: path.join(tempDir, 'hive.db'),
        simulation: true,
        tickMs: 20,
      });
      const project = server.store.createProject({ name: 'Budget délégation' });
      server.store.createTask({
        id: 'budget-parent',
        projectId: project.id,
        title: 'Parent budget',
        prompt: 'attendre le contrôle enfant',
      });
      server.store.patchTask('budget-parent', { status: 'ready' });

      let childOutcome: WorkerDelegationResult | null = null;
      const parentAdapter: AgentAdapter = {
        name: 'budget-parent',
        async run(task, ctx) {
          if (!ctx.delegate || !ctx.waitForDelegationResult) {
            throw new Error('capacités de délégation absentes');
          }
          const admitted = await ctx.delegate({
            childTaskId: 'budget-child',
            reason: 'borner le contrôle sécurité enfant',
            title: 'Contrôle enfant borné',
            prompt: 'attendre puis répondre',
            durationMs: 20,
            costMicros: 1,
            resourceUnits: 1,
          });
          if (!admitted.ok) {
            return { success: false, diff: '', logs: admitted.message, subAgents: [] };
          }
          childOutcome = await ctx.waitForDelegationResult('budget-child');
          return {
            success: childOutcome.ok && childOutcome.success,
            diff: '',
            logs: childOutcome.ok ? childOutcome.logs : childOutcome.message,
            subAgents: [],
          };
        },
      };
      const childAdapter: AgentAdapter = {
        name: 'budget-child',
        async run(_task, ctx) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 250);
            ctx.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
          // Le Worker ignore volontairement le signal et annonce un succès :
          // le nœud doit encore transformer cette réponse en échec de budget.
          return {
            success: true,
            diff: 'diff abandonné',
            logs: 'le Worker a ignoré le signal',
            subAgents: [],
          };
        },
      };
      const parentClient = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token: TOKEN,
        name: 'budget-parent-node',
        ownerName: 'e2e',
        agentType: 'shell',
        maxConcurrency: 1,
        workRoot: path.join(tempDir, 'parent'),
        adapter: parentAdapter,
        quiet: true,
      });
      const childClient = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token: TOKEN,
        name: 'budget-child-node',
        ownerName: 'e2e',
        agentType: 'shell',
        maxConcurrency: 1,
        workRoot: path.join(tempDir, 'child'),
        adapter: childAdapter,
        quiet: true,
      });
      clients.push(parentClient, childClient);
      parentClient.start();
      childClient.start();

      const deadline = Date.now() + 12_000;
      while (childOutcome === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const outcome = childOutcome as WorkerDelegationResult | null;
      if (outcome === null) throw new Error('le résultat enfant n’est jamais devenu terminal');
      expect(outcome).toMatchObject({ ok: true, success: false });
      if (outcome.ok) {
        expect(outcome.logs).toContain('budget de durée dépassé (20 ms)');
      }
      const child = server.store.getTask('budget-child');
      expect(child?.status).toBe('failed');
      expect(server.store.resultsForTask('budget-child').at(-1)?.success).toBe(false);
    },
  );
});
