// Tests de durcissement issus de la revue multi-agents : validation REST
// (cycles, dépendances, repoUrl), surface WebSocket hostile, remplacement de
// socket (reprise d'identité), et résultat surdimensionné qui ne boucle pas.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, findCycle } from '../src/orchestrator/server.js';
import type { HiveServer, ServerConfig } from '../src/orchestrator/server.js';
import { LIMITS } from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-durcissement-assez-long';
const jsonHeaders = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

const config = (dbPath: string): ServerConfig => ({
  port: 0,
  host: '127.0.0.1',
  token: TOKEN,
  corsOrigins: ['http://localhost:5173'],
  dbPath,
  simulation: false,
  tickMs: 80,
});

// ─── Helpers WebSocket bruts ──────────────────────────────────────────────────
function rawConnect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/** Attend la fermeture du socket et renvoie le code de fermeture. */
function closeCode(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)));
}

function send(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

/** Collecte les messages JSON reçus sur un socket dans un tableau. */
function collect(ws: WebSocket): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [];
  ws.on('message', (data) => {
    try {
      msgs.push(JSON.parse(data.toString()) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  });
  return msgs;
}

async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`condition non atteinte en ${timeoutMs} ms`);
}

describe('findCycle (détection de cycle intra-lot)', () => {
  it('détecte une auto-dépendance et un cycle mutuel', () => {
    expect(findCycle([{ id: 'a', dependsOn: ['a'] }])).not.toBeNull();
    expect(
      findCycle([
        { id: 'a', dependsOn: ['b'] },
        { id: 'b', dependsOn: ['a'] },
      ]),
    ).not.toBeNull();
  });

  it('accepte un DAG acyclique', () => {
    expect(
      findCycle([
        { id: 'a', dependsOn: [] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['a', 'b'] },
      ]),
    ).toBeNull();
  });
});

describe('durcissement du serveur', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-hard-'));
    server = await createServer(config(path.join(dir, 'hive.db')));
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  async function newProject(name = 'P'): Promise<string> {
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name }),
    });
    return ((await res.json()) as { id: string }).id;
  }

  // ─── Validation REST ────────────────────────────────────────────────────────
  it('refuse une auto-dépendance et un cycle de tâches (sinon bloquées à vie)', async () => {
    const projectId = await newProject();
    const self = await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ tasks: [{ id: 'a', title: 'A', prompt: 'a', dependsOn: ['a'] }] }),
    });
    expect(self.status).toBe(400);

    const cycle = await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        tasks: [
          { id: 'a', title: 'A', prompt: 'a', dependsOn: ['b'] },
          { id: 'b', title: 'B', prompt: 'b', dependsOn: ['a'] },
        ],
      }),
    });
    expect(cycle.status).toBe(400);
  });

  it('refuse un repoUrl à transport dangereux et accepte un https', async () => {
    const bad = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'X', repoUrl: "ext::sh -c 'id'" }),
    });
    expect(bad.status).toBe(400);

    const good = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name: 'Y', repoUrl: 'https://example.com/x.git' }),
    });
    expect(good.status).toBe(201);
  });

  it('limite le débit REST : au-delà du plafond, renvoie 429', async () => {
    // ─── POURQUOI UN DÉLAI EXPLICITE, ET POURQUOI CELUI-CI ───────────────────
    //
    // Ce test tombait à 5 000 ms — le défaut de vitest — sur la CI Windows, et
    // NULLE PART ailleurs. Ce n'est pas une lenteur inventée : il enchaîne 430 requêtes HTTP séquentielles, et l'établissement de socket est plus coûteux sous Windows. Les tests voisins de ce fichier s'accordent déjà 8 à 10 s.
    //
    // 30 secondes n'est pas « une marge confortable », c'est une HYPOTHÈSE
    // VÉRIFIABLE : si le test passe désormais, le diagnostic « plus lent sous
    // Windows » était juste. S'il retombe à 30 s, ce n'est plus de la lenteur
    // mais un blocage, et il faudra le CORRIGER, pas rallonger encore.
    // Le plafond est de 400 requêtes /api par IP et par fenêtre de 10 s.
    // On enchaîne 430 requêtes health : les premières passent, les suivantes 429.
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 430; i++) {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) ok++;
      else if (res.status === 429) limited++;
    }
    expect(ok).toBeGreaterThanOrEqual(400);
    expect(limited).toBeGreaterThan(0);
  }, 30_000);

  it('refuse un prompt qui dépasse la limite et un lot trop grand', async () => {
    const projectId = await newProject();
    const tooLong = await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ tasks: [{ title: 'T', prompt: 'x'.repeat(LIMITS.prompt + 1) }] }),
    });
    expect(tooLong.status).toBe(400);

    const tooMany = await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        tasks: Array.from({ length: 101 }, (_, i) => ({ title: `T${i}`, prompt: 'p' })),
      }),
    });
    expect(tooMany.status).toBe(400);
  });

  // ─── Surface WebSocket hostile ────────────────────────────────────────────────
  it('ferme une frame binaire (4400)', async () => {
    const ws = await rawConnect(server.port);
    const closed = closeCode(ws);
    ws.send(Buffer.from([1, 2, 3]));
    expect(await closed).toBe(4400);
  });

  it('ferme un premier message non authentifié (4401)', async () => {
    const ws = await rawConnect(server.port);
    const closed = closeCode(ws);
    send(ws, { type: 'heartbeat', running: 0 });
    expect(await closed).toBe(4401);
  });

  it('ferme un register au token invalide (4401)', async () => {
    const ws = await rawConnect(server.port);
    const closed = closeCode(ws);
    send(ws, {
      type: 'register',
      token: 'mauvais',
      name: 'n',
      ownerName: 'o',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    expect(await closed).toBe(4401);
  });

  it('un dashboard authentifié ne peut PAS écrire (task_result ignoré)', async () => {
    // Un vrai nœud prend une tâche et la met en cours.
    const client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'lente',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      nodeId: 'n-lente',
      workRoot: path.join(dir, 'lente'),
      adapter: {
        name: 'lent',
        run: () => new Promise(() => {}), // ne se termine jamais
      },
      quiet: true,
    });
    client.start();
    try {
      const projectId = await newProject('Dash');
      const tRes = await fetch(`${base}/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ tasks: [{ id: 'tdash', title: 'T', prompt: 'p' }] }),
      });
      const taskId = ((await tRes.json()) as Task[])[0]!.id;
      await waitFor(async () => {
        const s = (await (await fetch(`${base}/api/state`, { headers: jsonHeaders })).json()) as {
          tasks: Task[];
        };
        return s.tasks.find((t) => t.id === taskId)?.status === 'running';
      }, 8_000);

      // Un dashboard (spectateur) tente de marquer la tâche done : doit être ignoré.
      const dash = await rawConnect(server.port);
      send(dash, { type: 'subscribe', token: TOKEN });
      await new Promise((r) => setTimeout(r, 200));
      send(dash, {
        type: 'task_result',
        taskId,
        success: true,
        diff: 'faux',
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
      await new Promise((r) => setTimeout(r, 400));
      const s = (await (await fetch(`${base}/api/state`, { headers: jsonHeaders })).json()) as {
        tasks: Task[];
      };
      expect(s.tasks.find((t) => t.id === taskId)?.status).toBe('running');
      dash.close();
    } finally {
      client.stop();
    }
  });

  // ─── Résultat surdimensionné ─────────────────────────────────────────────────
  it('un diff surdimensionné est tronqué côté nœud et la tâche aboutit (pas de boucle)', async () => {
    const bigDiffAdapter: AgentAdapter = {
      name: 'gros-diff',
      async run() {
        return {
          success: true,
          diff: 'x'.repeat(Math.floor(LIMITS.diff * 1.5)),
          logs: 'y'.repeat(LIMITS.log + 1000),
          subAgents: [],
        };
      },
    };
    const client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'gros',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      nodeId: 'n-gros',
      workRoot: path.join(dir, 'gros'),
      adapter: bigDiffAdapter,
      quiet: true,
    });
    client.start();
    try {
      const projectId = await newProject('Gros');
      const tRes = await fetch(`${base}/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ tasks: [{ id: 'tgros', title: 'T', prompt: 'p' }] }),
      });
      const taskId = ((await tRes.json()) as Task[])[0]!.id;
      await waitFor(async () => {
        const s = (await (await fetch(`${base}/api/state`, { headers: jsonHeaders })).json()) as {
          tasks: Task[];
        };
        return s.tasks.find((t) => t.id === taskId)?.status === 'done';
      }, 10_000);
    } finally {
      client.stop();
    }
  });

  // ─── Ré-adoption après blip WS (verrou anti-régression) ───────────────────────
  it('un nœud qui blip puis se reconnecte en déclarant sa tâche la RÉ-ADOPTE (pas d’annulation)', async () => {
    const NODE = 'n-blip';
    const register = (activeTasks: string[]) => ({
      type: 'register',
      token: TOKEN,
      name: 'blip',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
      nodeId: NODE,
      activeTasks,
    });
    const taskOf = async (id: string): Promise<Task | undefined> => {
      const s = (await (await fetch(`${base}/api/state`, { headers: jsonHeaders })).json()) as {
        tasks: Task[];
      };
      return s.tasks.find((t) => t.id === id);
    };

    const projectId = await newProject('Blip');
    await fetch(`${base}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ tasks: [{ id: 'tblip', title: 'T', prompt: 'p' }] }),
    });

    // 1) Le nœud rejoint, reçoit la tâche et la déclare en cours.
    const ws1 = await rawConnect(server.port);
    const in1 = collect(ws1);
    send(ws1, register([]));
    await waitFor(() => in1.some((m) => m.type === 'assign_task'), 8_000);
    send(ws1, { type: 'task_update', taskId: 'tblip', status: 'running' });
    await waitFor(async () => (await taskOf('tblip'))?.status === 'running', 8_000);

    // 2) Blip : la socket se ferme → la tâche est requalifiée (ready), mais le
    //    processus du nœud « continue » (il ne l'a pas abandonnée).
    ws1.close();
    await waitFor(async () => (await taskOf('tblip'))?.assignedNodeId === null, 8_000);

    // 3) Reconnexion : le nœud déclare qu'il exécute toujours tblip.
    const ws2 = await rawConnect(server.port);
    const in2 = collect(ws2);
    send(ws2, register(['tblip']));
    await waitFor(() => in2.some((m) => m.type === 'registered'), 8_000);

    // 4) La tâche est RÉ-ADOPTÉE : running sur le nœud, aucune tentative brûlée,
    //    et aucun cancel_task ne lui a été envoyé (pas de zombie).
    await waitFor(async () => {
      const t = await taskOf('tblip');
      return t?.status === 'running' && t?.assignedNodeId === NODE;
    }, 8_000);
    const t = await taskOf('tblip');
    expect(t?.attempts).toBe(0);
    expect(in2.some((m) => m.type === 'cancel_task')).toBe(false);

    const evRes = await fetch(`${base}/api/events?limit=1000`, { headers: jsonHeaders });
    const events = (await evRes.json()) as { type: string }[];
    expect(events.map((e) => e.type)).toContain('task_readopted');

    ws2.close();
  });
});
