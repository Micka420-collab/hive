// Une RELECTURE le dit jusqu'à l'adaptateur : `AdapterContext.role`.
//
// Le hub sait qu'une tâche est une contre-expertise (`store.relectureDe`) ; le
// nœud ne le savait pas, et Codex relisait avec les droits d'une production
// (`--sandbox workspace-write`). Le hub le dit dans `assign_task`
// (`relecture: true`), le nœud le passe à son adaptateur (`role:
// 'relecture'`), et Codex relit en `read-only` (codex-ecriture.test.ts).
//
// Une vraie Reine, deux vrais nœuds (HiveNodeClient) de familles différentes :
// le producteur ne reçoit AUCUN rôle, le relecteur reçoit `relecture`.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdapterContext, AdapterResult, AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { parseServerMessage } from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

const JETON = 'jeton-relecture-role-suffisamment-long';
const DIFF =
  'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+export const a = 1;\n';

let serveur: HiveServer | null = null;
const clients: HiveNodeClient[] = [];
let dossier = '';

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 15_000;
  while (!condition() && Date.now() < fin) await new Promise((r) => setTimeout(r, 30));
  expect(condition(), message).toBe(true);
}

describe('assign_task : le champ `relecture`', () => {
  const tache = { id: 't', projectId: 'p', title: 'x', prompt: 'x', status: 'assigned' };
  const brut = (extra: Record<string, unknown>) =>
    JSON.stringify({
      type: 'assign_task',
      task: {
        ...tache,
        dependsOn: [],
        assignedNodeId: null,
        result: null,
        branch: null,
        attempts: 0,
        createdAt: 0,
        updatedAt: 0,
      },
      ...extra,
    });

  it('`true` passe ; toute autre valeur fait tomber le message ; absent, rien', () => {
    expect(parseServerMessage(brut({ relecture: true }))).toMatchObject({ relecture: true });
    expect(parseServerMessage(brut({}))).not.toHaveProperty('relecture');
    expect(parseServerMessage(brut({ relecture: false }))).toBeNull();
    expect(parseServerMessage(brut({ relecture: 'oui' }))).toBeNull();
  });
});

describe('une vraie ruche : le rôle arrive à l’adaptateur du relecteur, et à lui seul', () => {
  it('production sans rôle, relecture avec `role: relecture`', { timeout: 30_000 }, async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-relecture-role-'));
    const srv = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    serveur = srv;

    const vus: { agent: string; taskId: string; role: AdapterContext['role'] }[] = [];
    let relecteurEnLigne = false;
    const adaptateur = (agent: string): AgentAdapter => ({
      name: agent,
      async run(task: Task, ctx: AdapterContext): Promise<AdapterResult> {
        vus.push({ agent, taskId: task.id, role: ctx.role });
        if (ctx.role === 'relecture') {
          return { success: true, diff: '', logs: 'valide', finalText: 'valide', subAgents: [] };
        }
        // La relecture exige une AUTRE famille en ligne au moment du résultat.
        await attendre(() => relecteurEnLigne, 'le relecteur ne rejoint pas la ruche');
        return { success: true, diff: DIFF, logs: 'ok', subAgents: [] };
      },
    });
    const noeud = (agent: string): HiveNodeClient => {
      const c = new HiveNodeClient({
        url: `ws://127.0.0.1:${srv.port}/ws`,
        token: JETON,
        name: `ouvriere-${agent}`,
        ownerName: 'banc',
        agentType: agent,
        maxConcurrency: 1,
        workRoot: path.join(dossier, agent),
        adapter: adaptateur(agent),
        quiet: true,
      });
      clients.push(c);
      c.start();
      return c;
    };

    noeud('claude-code');
    await attendre(
      () => srv.store.listNodes().some((n) => n.status === 'online'),
      'le producteur ne rejoint pas la ruche',
    );
    const p = srv.store.createProject({ name: 'P' });
    const t = srv.store.createTask({ projectId: p.id, title: 'Produire', prompt: 'x' });
    srv.store.patchTask(t.id, { status: 'ready' });
    await attendre(() => vus.some((v) => v.taskId === t.id), 'la production ne part pas');
    noeud('codex');
    await attendre(
      () => srv.store.listNodes().filter((n) => n.status === 'online').length === 2,
      'le relecteur ne rejoint pas la ruche',
    );
    relecteurEnLigne = true;

    await attendre(
      () => vus.some((v) => v.agent === 'codex' && srv.store.relectureDe(v.taskId) !== null),
      'la relecture n’arrive pas au nœud codex',
    );
    expect(vus.find((v) => v.taskId === t.id)?.role).toBeUndefined();
    const relecture = vus.find((v) => v.agent === 'codex');
    expect(relecture?.role).toBe('relecture');
  });
});
