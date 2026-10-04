// La livraison d'un merge ou d'un chantier appartient au NŒUD ASSIGNÉ.
//
// `task_result` ignore depuis toujours un résultat dont `assignedNodeId !==
// nodeId` (scheduler.ts). Les deux AUTRES handlers de résultat — `merge_result`
// et `chantier_result` — ne le faisaient pas : ils résolvaient le `pending` par
// son identifiant et agissaient, sans vérifier que l'expéditeur était le nœud à
// qui le travail avait été confié. La seule défense était le SECRET de
// l'identifiant (un `randomUUID` envoyé au seul socket assigné, jamais diffusé
// aux nœuds). C'est vrai aujourd'hui — un nœud admis par billet n'a pas de quoi
// deviner l'ID d'un autre —, mais un invariant d'appartenance qui tient par le
// secret d'un ID, là où le reste de la ruche le VÉRIFIE, tient par accident.
// L'audit adversarial de nuit (#62) l'a relevé ; ces bancs rendent l'invariant
// uniforme et rougissent le jour où l'un des deux gardes tombe.
//
// LE POINT QUI PORTE CHAQUE BANC : le résultat forgé par un nœud non assigné ne
// doit ni s'afficher, ni CONSOMMER le pending — le vrai assigné doit encore
// pouvoir livrer APRÈS coup. Un garde qui refuserait la forge mais mangerait le
// pending laisserait le travail réel tomber dans le vide.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { brancherFauxNoeud } from './aide/faux-noeud.js';

const TOKEN = 'jeton-appartenance-livraison-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer | null = null;
const dirs: string[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await server?.stop();
  server = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

async function ruche(): Promise<HiveServer> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-appart-'));
  dirs.push(dir);
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'hive.db'),
    simulation: false,
    tickMs: 60,
  });
  return server;
}

/** Un dépôt git local, vrai, avec un `package.json` déclarant des chantiers. */
async function depotLocal(): Promise<string> {
  const { simpleGit } = await import('simple-git');
  const depot = mkdtempSync(path.join(os.tmpdir(), 'hive-depot-appart-'));
  dirs.push(depot);
  writeFileSync(
    path.join(depot, 'package.json'),
    JSON.stringify({ name: 'depot-appart', scripts: { test: 'vitest run', lint: 'eslint .' } }),
  );
  const g = simpleGit({ baseDir: depot });
  await g.init();
  await g.addConfig('user.email', 't@example.com');
  await g.addConfig('user.name', 'T');
  await g.addConfig('commit.gpgsign', 'false');
  await g.add('.');
  await g.commit('initial');
  return depot;
}

interface Noeud {
  ws: WebSocket;
  recus: Record<string, unknown>[];
}

/** Un nœud authentifié (token maître), qui bat et retient ses messages. */
async function noeud(srv: HiveServer, nodeId: string): Promise<Noeud> {
  const recus: Record<string, unknown>[] = [];
  const { ws } = await brancherFauxNoeud<{ type: string } & Record<string, unknown>>(
    srv.port,
    { token: TOKEN, name: nodeId, ownerName: 't', agentType: 'shell', maxConcurrency: 1, nodeId },
    (m) => recus.push(m),
  );
  sockets.push(ws);
  return { ws, recus };
}

async function attendre(cond: () => boolean | Promise<boolean>, msMax = 8_000): Promise<void> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('condition jamais atteinte');
}

async function lire<T>(srv: HiveServer, chemin: string): Promise<T> {
  return (await (await fetch(`http://127.0.0.1:${srv.port}${chemin}`, { headers })).json()) as T;
}

const poster = async (srv: HiveServer, chemin: string, corps: unknown = {}): Promise<Response> =>
  fetch(`http://127.0.0.1:${srv.port}${chemin}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(corps),
  });

/** Un imposteur a reçu la porte fermée (« non assigné »)… ou la garde est tombée. */
function refusee(n: Noeud): boolean {
  return n.recus.some((m) => m.type === 'error' && String(m.message ?? '').includes('non assigné'));
}

describe('la livraison appartient au nœud assigné', () => {
  it('MERGE : un nœud non assigné ne pose pas le résultat d’un autre, et ne consomme pas le pending', async () => {
    const srv = await ruche();
    // Seul A est en ligne au déclenchement : le merge lui est confié.
    const a = await noeud(srv, 'node-a');
    await attendre(async () =>
      (await lire<{ nodes: { status: string }[] }>(srv, '/api/state')).nodes.some(
        (n) => n.status === 'online',
      ),
    );

    const projet = srv.store.createProject({
      name: 'Intégration',
      repoUrl: 'file:///tmp/depot-fantome',
    });
    srv.store.createTask({ id: 'w1', projectId: projet.id, title: 'w1', prompt: 'p' });
    srv.store.patchTask('w1', { status: 'done' });
    srv.store.insertResult({
      taskId: 'w1',
      nodeId: 'seed',
      success: true,
      diff: 'diff --git a/x b/x',
      logs: '',
      durationMs: 1,
      subAgents: [],
    });

    const run = await poster(srv, `/api/projects/${projet.id}/merge/run`);
    expect(run.status).toBe(202);
    const { mergeId, nodeId } = (await run.json()) as { mergeId: string; nodeId: string };
    expect(nodeId, 'le merge est bien confié à A').toBe('node-a');

    // B arrive APRÈS l'assignation : il n'est pas l'assigné.
    const b = await noeud(srv, 'node-b');
    const forge = (applied: string[], mergedDiff: string) => ({
      type: 'merge_result',
      mergeId,
      applied,
      conflicts: [],
      mergedDiff,
      testsRun: false,
      testsPassed: null,
      logs: '',
    });
    const resultat = () =>
      lire<{ result: { applied: string[]; mergedDiff: string } | null }>(
        srv,
        `/api/projects/${projet.id}/merge/result`,
      );

    b.ws.send(JSON.stringify(forge(['forge'], 'IMPOSTEUR')));
    // Attendre que la forge de B soit TRAITÉE : refusée (garde) OU — garde
    // tombée — stockée (résultat non nul).
    await attendre(async () => refusee(b) || (await resultat()).result !== null);

    // Le VRAI assigné livre après coup : il doit encore le pouvoir.
    a.ws.send(JSON.stringify(forge(['w1'], 'VRAI')));
    await attendre(async () => (await resultat()).result !== null);
    const { result } = await resultat();
    expect(
      result?.applied,
      'le résultat affiché est celui de l’assigné, pas de l’imposteur',
    ).toEqual(['w1']);
    expect(result?.mergedDiff).toBe('VRAI');
  });

  it('MERGE : un REFUS forgé par un nœud non assigné ne clôt pas en échec le merge d’un autre', async () => {
    // Le refus (`refused`) était jugé AVANT la garde d'appartenance : n'importe
    // quel nœud qui connaissait le `mergeId` pouvait clore le merge d'un autre
    // en `merge_failed`, et le vrai résultat tombait ensuite dans le vide
    // (« inconnu du hub »). Depuis qu'un clone refusé passe lui aussi par
    // `refused`, ce chemin porte de vrais échecs : il suit la même garde.
    const srv = await ruche();
    const a = await noeud(srv, 'node-a');
    await attendre(async () =>
      (await lire<{ nodes: { status: string }[] }>(srv, '/api/state')).nodes.some(
        (n) => n.status === 'online',
      ),
    );
    const projet = srv.store.createProject({
      name: 'Intégration',
      repoUrl: 'file:///tmp/depot-fantome',
    });
    srv.store.createTask({ id: 'w1', projectId: projet.id, title: 'w1', prompt: 'p' });
    srv.store.patchTask('w1', { status: 'done' });
    srv.store.insertResult({
      taskId: 'w1',
      nodeId: 'seed',
      success: true,
      diff: 'diff --git a/x b/x',
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    const run = await poster(srv, `/api/projects/${projet.id}/merge/run`);
    expect(run.status).toBe(202);
    const { mergeId } = (await run.json()) as { mergeId: string };

    const b = await noeud(srv, 'node-b');
    const vide = {
      type: 'merge_result',
      mergeId,
      applied: [],
      conflicts: [],
      mergedDiff: '',
      testsRun: false,
      testsPassed: null,
      logs: '',
    };
    b.ws.send(JSON.stringify({ ...vide, refused: 'échec forgé' }));
    await attendre(() => refusee(b));
    const resultat = () =>
      lire<{ result: { applied: string[]; refused?: string } | null }>(
        srv,
        `/api/projects/${projet.id}/merge/result`,
      );
    expect((await resultat()).result, 'le refus de l’imposteur ne clôt rien').toBeNull();

    a.ws.send(JSON.stringify({ ...vide, applied: ['w1'], mergedDiff: 'VRAI' }));
    await attendre(async () => (await resultat()).result !== null);
    const { result } = await resultat();
    expect(result?.applied, 'le vrai assigné livre encore').toEqual(['w1']);
    expect(result?.refused).toBeUndefined();
  });

  it('CHANTIER : un nœud non assigné ne pose pas le résultat d’un autre, et ne consomme pas le pending', async () => {
    const srv = await ruche();
    const depot = await depotLocal();
    const a = await noeud(srv, 'node-a');
    await attendre(async () =>
      (await lire<{ nodes: { status: string }[] }>(srv, '/api/state')).nodes.some(
        (n) => n.status === 'online',
      ),
    );

    const projet = srv.store.createProject({ name: 'Chantiers', repoUrl: depot });
    const run = await poster(srv, `/api/projects/${projet.id}/chantiers/test/run`);
    expect(run.status).toBe(202);
    const { chantierId, nodeId } = (await run.json()) as { chantierId: string; nodeId: string };
    expect(nodeId, 'le chantier est bien confié à A').toBe('node-a');

    const b = await noeud(srv, 'node-b');
    const forge = (code: number, sortie: string, ok: boolean) => ({
      type: 'chantier_result',
      chantierId,
      nom: 'test',
      code,
      sortie,
      ok,
    });
    const resultat = () =>
      lire<{ resultat: { sortie: string; ok: boolean } | null }>(
        srv,
        `/api/projects/${projet.id}/chantiers/result`,
      );

    b.ws.send(JSON.stringify(forge(1, 'IMPOSTEUR', false)));
    await attendre(async () => refusee(b) || (await resultat()).resultat !== null);

    a.ws.send(JSON.stringify(forge(0, 'VRAI', true)));
    await attendre(async () => (await resultat()).resultat !== null);
    const { resultat: vu } = await resultat();
    expect(vu?.sortie, 'le résultat affiché est celui de l’assigné, pas de l’imposteur').toBe(
      'VRAI',
    );
    expect(vu?.ok).toBe(true);
  });
});
