// Test d'intégration du contrat Drone Wars consommé par le dashboard :
// POST /api/tasks/:id/race (lancement), GET /api/races (courses en vol,
// badge ⚔ + carte Essaim), GET /api/tasks/:id/race (course en vol puis
// victoire retrouvée au journal une fois la course tranchée).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { DroneRace } from '../src/orchestrator/drone-wars.js';

const TOKEN = 'jeton-courses-suffisamment-long';

interface RaceGet {
  race: DroneRace | null;
  victory: { nodeId: string; cancelled: number } | null;
}

describe('Drone Wars — contrat HTTP races/victory', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projetId: string;
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  // Chaque test lance SA course, sur SA tâche.
  //
  // Les deux tests du milieu se passaient auparavant `taskId` et `drones` par
  // des variables de suite : « après la victoire » ne gagnait que parce que
  // « POST race » avait couru juste avant. Sous `--sequence.shuffle`, il
  // plantait sur `drones[1]` — et, plus grave, son vert ne prouvait rien tout
  // seul. Le scénario reste lisible, mais chacun pose désormais sa propre
  // prémisse.
  async function lancerCourse(): Promise<{ taskId: string; drones: string[] }> {
    const created = await fetch(`${base}/api/projects/${projetId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: [{ title: 'tâche critique', prompt: 'faire vite' }] }),
    });
    const [task] = (await created.json()) as { id: string }[];
    server.store.patchTask(task!.id, { status: 'ready' });

    const started = await fetch(`${base}/api/tasks/${task!.id}/race`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ factor: 2 }),
    });
    expect(started.status).toBe(202);
    const body = (await started.json()) as { taskId: string; drones: string[] };
    expect(body.taskId).toBe(task!.id);
    expect(body.drones).toHaveLength(2);
    return { taskId: task!.id, drones: body.drones };
  }

  async function coursesEnVol(): Promise<DroneRace[]> {
    const list = await fetch(`${base}/api/races`, { headers });
    return ((await list.json()) as { races: DroneRace[] }).races;
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-races-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000, // pas de tick pendant le test : la course reste sous contrôle
    });
    base = `http://127.0.0.1:${server.port}`;

    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Projet Courses' }),
    });
    projetId = ((await res.json()) as { id: string }).id;
    // 2 nœuds en ligne, sans passer par le WS : le scheduler est exposé par le
    // serveur (même approche que la démo).
    //
    // AGENTS RÉELS, et ce n'est pas un détail de décor. Ce banc montait des
    // nœuds `shell` sur un serveur `simulation: false` — une configuration que
    // la ruche REFUSE désormais d'enrôler dans une course, comme elle la
    // refusait déjà à l'assignation automatique. Ces nœuds n'exécutent rien ici
    // (aucun client WS n'est branché) : leur type n'était qu'un remplissage, et
    // il contredisait la politique du serveur qu'on leur donne.
    //
    // Le rendre cohérent, plutôt qu'assouplir la garde : ce fichier éprouve le
    // CONTRAT HTTP des courses (routes, codes, formes), pas la politique
    // d'agent — celle-ci a ses propres bancs dans `course-sans-simule`.
    for (const [name, agentType] of [
      ['course-alpha', 'claude-code'],
      ['course-beta', 'codex'],
    ] as const) {
      server.scheduler.registerNode({
        name,
        ownerName: 'test',
        agentType,
        maxConcurrency: 2,
      });
    }
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('exige le token sur GET /api/races', async () => {
    const res = await fetch(`${base}/api/races`);
    expect(res.status).toBe(401);
  });

  it('POST race lance la course, GET /api/races la liste, GET race la détaille', async () => {
    const { taskId } = await lancerCourse();

    // « la sienne », pas « la seule » : un voisin peut avoir laissé une course
    // en vol, et la propriété testée — la course lancée apparaît dans la liste
    // — ne dit rien du nombre total.
    const sienne = (await coursesEnVol()).find((c) => c.taskId === taskId);
    expect(sienne).toBeDefined();
    expect(sienne?.drones.map((d) => d.status)).toEqual(['running', 'running']);

    const one = (await (
      await fetch(`${base}/api/tasks/${taskId}/race`, { headers })
    ).json()) as RaceGet;
    expect(one.race?.taskId).toBe(taskId);
    expect(one.victory).toBeNull();
  });

  it('après la victoire : race null, victory reconstruite du journal, liste vide', async () => {
    const { taskId, drones } = await lancerCourse();

    // Le 2e drone gagne (résultat injecté au scheduler, comme un task_result WS).
    const winner = drones[1]!;
    server.scheduler.handleTaskResult(winner, {
      taskId,
      success: true,
      diff: 'diff:course',
      logs: 'ok',
      durationMs: 7,
      subAgents: [],
    });

    const one = (await (
      await fetch(`${base}/api/tasks/${taskId}/race`, { headers })
    ).json()) as RaceGet;
    expect(one.race).toBeNull();
    expect(one.victory).toEqual({ nodeId: winner, cancelled: 1 });

    // Une course TRANCHÉE quitte la liste des courses en vol. Là encore on
    // interroge la sienne : la liste peut contenir celle d'un voisin.
    expect((await coursesEnVol()).map((c) => c.taskId)).not.toContain(taskId);
  });

  it('une tâche terminée sans course n a pas de victoire fantôme', async () => {
    // Nouvelle tâche passée done par le circuit mono-nœud classique.
    const created = await fetch(`${base}/api/projects/${projetId}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: [{ title: 'tâche mono', prompt: 'faire' }] }),
    });
    const [mono] = (await created.json()) as { id: string }[];
    server.store.patchTask(mono!.id, { status: 'done' });

    const one = (await (
      await fetch(`${base}/api/tasks/${mono!.id}/race`, { headers })
    ).json()) as RaceGet;
    expect(one.race).toBeNull();
    expect(one.victory).toBeNull();
  });
});
