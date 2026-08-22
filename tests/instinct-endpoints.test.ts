// Contrats HTTP et livraison de l'« instinct de ruche » : /api/thermo (deux
// sémantiques, deux noms), /api/pheromones (chemin borné + mémoïsation à TTL
// court) et la re-livraison de secours d'assign_task, qui doit porter le MÊME
// contexte (Couveuse + Hive Mind) que l'assignation initiale.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { LectureThermo } from '../src/orchestrator/thermo.js';
import type { TraceePheromone } from '../src/orchestrator/pheromones.js';

const TOKEN = 'jeton-instinct-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

describe('endpoints de l’instinct de ruche', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-instinct-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 80,
      // ─── POURQUOI CE TEST DÉBRIDE L'ESPACEMENT ───────────────────────────
      //
      // Il prouve que le contexte d'une tâche muette est MÉMOÏSÉ : beaucoup de
      // re-livraisons, au plus deux calculs. Il lui faut donc beaucoup de
      // re-livraisons — or le filet en espace désormais quinze secondes.
      //
      // Le régler ici est préférable à baisser l'assertion : sans plusieurs
      // livraisons, « au plus deux calculs » serait vrai sans rien prouver.
      relivraisonMinMs: 0,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('/api/thermo distingue la lecture INSTANTANÉE de l’état APPLIQUÉ', async () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) server.store.appendEvent('task_failed', { taskId: `f${i}` }, now);
    for (let i = 0; i < 4; i++) server.store.appendEvent('task_retry', { taskId: `r${i}` }, now);

    const res = (await (await fetch(`${base}/api/thermo`, { headers })).json()) as {
      instantane: LectureThermo;
      applique: { bande: string; facteur: number };
    };
    // Deux clés, deux sémantiques — `bande` ne figure plus deux fois avec deux
    // sens différents dans la même réponse.
    expect(Object.keys(res).sort()).toEqual(['applique', 'instantane']);
    expect(res.instantane.bande).toBe('surchauffe');
    expect(res.instantane.signaux.echecs).toBe(6);
    // L'hystérésis n'a pas encore basculé : la ruche applique toujours le froid.
    expect(res.applique).toEqual({ bande: 'froide', facteur: 1 });
  });

  it('/api/thermo ne compte ni les cascades ni les refus sains', async () => {
    const now = Date.now();
    server.store.appendEvent('task_failed', { reason: 'boom' }, now);
    for (let i = 0; i < 9; i++) {
      server.store.appendEvent('task_failed', { reason: 'dependency_failed' }, now);
    }
    server.store.appendEvent('task_rejected', { reason: 'hors_service_night_shift' }, now);
    for (let i = 0; i < 5; i++) server.store.appendEvent('task_done', { taskId: `d${i}` }, now);

    const res = (await (await fetch(`${base}/api/thermo`, { headers })).json()) as {
      instantane: LectureThermo;
    };
    expect(res.instantane.signaux).toEqual({
      echecs: 1,
      retries: 0,
      refusInfra: 0,
      succes: 5,
      total: 6,
    });
    expect(res.instantane.bande).toBe('froide');
  });

  it('/api/pheromones : chemin borné et mémoïsé (N requêtes = 1 calcul)', async () => {
    const now = Date.now();
    const projet = server.store.createProject({ name: 'P' });
    // 300 tâches dont 2 seulement sont citées par des résultats : la route ne
    // doit jamais déplier la table tasks pour n'en garder que 0,7 %.
    for (let i = 0; i < 300; i++) {
      server.store.createTask({ projectId: projet.id, title: `bruit ${i}`, prompt: 'blabla' });
    }
    const citees = [0, 1].map((i) =>
      server.store.createTask({
        projectId: projet.id,
        title: `endpoint rest ${i}`,
        prompt: 'creer une route api',
      }),
    );
    for (const t of citees) {
      server.store.insertResult(
        {
          taskId: t.id,
          nodeId: 'n1',
          success: true,
          diff: '',
          logs: '',
          durationMs: 1,
          subAgents: [],
        },
        now,
      );
    }

    let dépliages = 0;
    const idsLus: string[] = [];
    const vraiListTasks = server.store.listTasks.bind(server.store);
    server.store.listTasks = (projectId?: string) => {
      dépliages += 1;
      return vraiListTasks(projectId);
    };
    const vraisTextes = server.store.listTaskTexts.bind(server.store);
    server.store.listTaskTexts = (ids: readonly string[]) => {
      idsLus.push(...ids);
      return vraisTextes(ids);
    };

    const lire = async (): Promise<TraceePheromone[]> =>
      (
        (await (await fetch(`${base}/api/pheromones`, { headers })).json()) as {
          traces: TraceePheromone[];
        }
      ).traces;

    const premier = await lire();
    expect(premier).toHaveLength(1);
    expect(premier[0]).toMatchObject({ nodeId: 'n1', domaine: 'api', reussites: 2 });
    expect(dépliages).toBe(0);
    expect(idsLus).toHaveLength(2);

    // Un troisième résultat arrive, puis deux requêtes immédiates : servies par
    // la mémoïsation (TTL 3 s) — donc identiques, et sans nouvelle lecture.
    const troisieme = server.store.createTask({
      projectId: projet.id,
      title: 'encore une route api',
      prompt: 'endpoint rest',
    });
    server.store.insertResult(
      {
        taskId: troisieme.id,
        nodeId: 'n2',
        success: true,
        diff: '',
        logs: '',
        durationMs: 1,
        subAgents: [],
      },
      now,
    );
    expect(await lire()).toEqual(premier);
    expect(await lire()).toEqual(premier);
    expect(idsLus).toHaveLength(2); // aucune relecture : un seul calcul
    expect(dépliages).toBe(0);
  });

  // ─── Le filet de re-livraison ne doit RIEN recalculer pour rien ──────────
  //
  // Le contexte (Couveuse + Hive Mind) coûte un BM25 sur toute la mémoire —
  // ~37 ms mesurées sur 500 souvenirs — et il était payé PAR TÂCHE MUETTE ET
  // PAR TICK, dans le corps SYNCHRONE du setInterval, AVANT même de savoir si
  // une socket était ouverte. À 2 s de tick, c'est la boucle d'événements de la
  // ruche qui s'arrête, en boucle, pour rien.

  it(
    'aucune socket ouverte ⇒ AUCUN contexte calculé pour une tâche muette',
    { timeout: 10_000 },
    async () => {
      const projet = server.store.createProject({ name: 'Ruche' });
      const task = server.store.createTask({
        projectId: projet.id,
        title: 'Tâche orpheline',
        prompt: 'personne au bout du fil',
      });
      // `assigned` à un nœud qui n'a jamais eu de socket, et muette depuis
      // longtemps : le filet la voit à chaque tick.
      server.store.patchTask(
        task.id,
        { status: 'assigned', assignedNodeId: 'noeud-jamais-connecte' },
        Date.now() - 60_000,
      );

      let recherches = 0;
      const vraie = server.store.searchMemories.bind(server.store);
      server.store.searchMemories = (q: string, n?: number) => {
        recherches += 1;
        return n === undefined ? vraie(q) : vraie(q, n);
      };
      // Plusieurs ticks (tickMs = 80 ms) : le filet passe et repasse.
      await new Promise((r) => setTimeout(r, 600));
      expect(recherches).toBe(0);
      // La tâche est bien restée muette : le filet la voyait à chaque passe.
      expect(server.scheduler.staleAssignedTasks(5_000).map((t) => t.id)).toEqual([task.id]);
    },
  );

  it(
    'la re-livraison de secours porte le contexte de la Couveuse',
    { timeout: 20_000 },
    async () => {
      // Un nœud brut qui reçoit assign_task et ne répond JAMAIS : au bout de
      // 5 s, le serveur re-livre le message (filet anti-perte en vol).
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const assignations: Array<Record<string, unknown>> = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === 'assign_task') assignations.push(msg);
      });
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });
      try {
        ws.send(
          JSON.stringify({
            type: 'register',
            token: TOKEN,
            name: 'ouvriere-muette',
            ownerName: 'test',
            agentType: 'shell',
            maxConcurrency: 1,
            nodeId: 'noeud-muet',
          }),
        );

        // Une tâche qui a DÉJÀ échoué une fois, avec des logs exploitables.
        const projet = server.store.createProject({ name: 'Ruche' });
        const task = server.store.createTask({
          projectId: projet.id,
          title: 'Tâche fragile',
          prompt: 'faire quelque chose de délicat',
        });
        server.store.insertResult({
          taskId: task.id,
          nodeId: 'noeud-muet',
          success: false,
          diff: '',
          logs: 'TypeError: x is not a function',
          durationMs: 1,
          subAgents: [],
        });
        server.store.patchTask(task.id, { status: 'ready', attempts: 1 });

        // Compté à partir d'ici : combien de fois le contexte est RECALCULÉ.
        let recherches = 0;
        const vraie = server.store.searchMemories.bind(server.store);
        server.store.searchMemories = (q: string, n?: number) => {
          recherches += 1;
          return n === undefined ? vraie(q) : vraie(q, n);
        };

        const deadline = Date.now() + 15_000;
        while (assignations.length < 4 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(assignations.length).toBeGreaterThanOrEqual(2);

        // Le contexte d'une tâche muette ne change pas d'un tick à l'autre : au
        // plus deux calculs (l'assignation initiale, puis la première
        // re-livraison), quel que soit le nombre de re-livraisons.
        expect(assignations.length).toBeGreaterThanOrEqual(4);
        expect(recherches).toBeLessThanOrEqual(2);

        // Les DEUX chemins servent le même contexte : sans cela, la leçon
        // annoncée par brood_context n'arrivait jamais à l'ouvrière re-servie.
        for (const msg of assignations.slice(0, 2)) {
          expect(String(msg.hiveContext)).toContain('Couveuse');
          expect(String(msg.hiveContext)).toContain('TypeError: x is not a function');
          expect(String(msg.hiveContext)).toContain('<<<HIVE_DATA');
        }
        // Et brood_context n'est journalisé QU'À l'assignation, pas à chaque
        // re-livraison (sinon le journal serait noyé toutes les 2 secondes).
        const brood = server.store.listEvents(0, 1_000).filter((e) => e.type === 'brood_context');
        expect(brood).toHaveLength(1);
      } finally {
        ws.close();
      }
    },
  );
});
