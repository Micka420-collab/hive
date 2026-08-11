// LE HUB NE CONFIE RIEN À UNE OUVRIÈRE QUI S'EST DÉCLARÉE HORS SERVICE.
//
// ─── CE QUI EXISTAIT DÉJÀ, ET CE QUI MANQUAIT ────────────────────────────────
//
// `night-shift-wiring.test.ts` éprouve le côté NŒUD : hors de ses heures, il
// REFUSE l'assignation sans brûler de tentative. C'est le filet de sécurité.
//
// Le côté HUB — ne rien lui proposer du tout — n'était éprouvé nulle part. Il
// tient sur un repli d'une ligne, répété deux fois (merge, chantier) :
//
//     (n) => n.status === 'online' && nodeSockets.has(n.id) && (nodeOnShift.get(n.id) ?? true)
//
// Le `??` y est essentiel : un nœud qui n'a jamais dit s'il était de service est
// réputé disponible (c'est le défaut, et les nœuds anciens ne disent rien). Mais
// celui qui a dit `false` doit être écarté.
//
// ─── CE QUI A ÉTÉ MESURÉ AVANT D'ÉCRIRE CE FICHIER ───────────────────────────
//
// `?? true` muté en `|| true` rend l'expression TOUJOURS vraie — `false || true`
// vaut `true`. La suite entière est restée verte : 244 fichiers, 3 559 tests.
// Le hub confiait donc des merges à une ouvrière qui avait explicitement posé
// son tablier ; elle les refusait, et le travail repartait au tour suivant.
//
// La loupe ne pouvait pas le voir : elle ne mute que les lignes AJOUTÉES d'un
// diff, et ces deux-là sont bien plus anciennes que sa base.
//
// ─── LE POINT DE SYNCHRONISATION, ET POURQUOI IL N'EST PAS UN DÉLAI ──────────
//
// Le message `heartbeat` ne porte AUCUN accusé de réception : rien ne dit quand
// le hub l'a pris en compte. Un banc qui attendrait « un peu » mesurerait la
// vitesse de la machine (leçon déjà payée cette nuit : 503 sur un nœud remis en
// service à l'instant).
//
// Mais le même gestionnaire fait DEUX choses, dans cet ordre et sans frontière
// asynchrone entre elles : `scheduler.heartbeat()` — qui écrit `lastSeen` — puis
// `nodeOnShift.set()`. Node est mono-thread : voir `lastSeen` avancer PROUVE que
// le bloc entier a tourné, donc que le service est posé. On attend ce fait-là,
// pas une durée.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { StateSnapshot } from '../src/shared/types.js';

const TOKEN = 'jeton-service-hub-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

let server: HiveServer;
let dir: string;
let base: string;
const ouverts: WebSocket[] = [];

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-service-'));
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'service.db'),
    simulation: false,
    tickMs: 10_000,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  for (const ws of ouverts.splice(0)) ws.close();
  await server.stop();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function envoyer(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

/** Inscrit une ouvrière et rend son socket, une fois l'accusé reçu. */
function inscrire(nom: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    ouverts.push(ws);
    ws.on('open', () =>
      envoyer(ws, {
        type: 'register',
        token: TOKEN,
        nodeId: nom,
        name: nom,
        ownerName: 'testeur',
        agentType: 'shell',
        maxConcurrency: 1,
      }),
    );
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string };
      if (m.type === 'registered') resolve(ws);
    });
    ws.on('close', () => reject(new Error(`${nom} fermé avant son accusé`)));
    ws.on('error', reject);
  });
}

async function dernierSigne(nom: string): Promise<number | null> {
  const s = (await (await fetch(`${base}/api/state`, { headers })).json()) as StateSnapshot;
  return s.nodes.find((n) => n.id === nom)?.lastSeen ?? null;
}

/**
 * Pose l'état de service et n'en revient QUE lorsque le hub l'a traité.
 *
 * On répète le heartbeat jusqu'à voir `lastSeen` avancer : le temps réel
 * s'écoulant, la valeur finit toujours par changer, et son changement prouve
 * que le bloc du gestionnaire est allé jusqu'au bout — `nodeOnShift` compris.
 */
async function deService(ws: WebSocket, nom: string, onShift: boolean): Promise<void> {
  const avant = await dernierSigne(nom);
  const fin = Date.now() + 5_000;
  while (Date.now() < fin) {
    // `running` est OBLIGATOIRE (`protocol.ts`) : sans lui le message est refusé
    // par la validation et jeté SANS UN MOT. Le premier jet de ce banc l'avait
    // oublié — et c'est ce point de synchronisation qui l'a dit, là où une
    // attente « d'un peu » aurait rendu un vert de hasard.
    envoyer(ws, { type: 'heartbeat', running: 0, onShift });
    await new Promise((r) => setTimeout(r, 20));
    if ((await dernierSigne(nom)) !== avant) return;
  }
  throw new Error('le hub n’a jamais accusé le heartbeat');
}

/** Un projet prêt à fusionner : un dépôt, une tâche terminée, un diff. */
function projetFusionnable(nom: string): string {
  const p = server.store.createProject({ name: nom, repoUrl: '/depot/inexistant' });
  const idTache = `t-${nom}`;
  server.store.createTask({ id: idTache, projectId: p.id, title: idTache, prompt: 'p' });
  server.store.patchTask(idTache, { status: 'done' });
  server.store.insertResult({
    taskId: idTache,
    nodeId: 'graine',
    success: true,
    diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-un\n+deux\n',
    logs: '',
    durationMs: 1,
    subAgents: [],
  });
  return p.id;
}

async function lancerFusion(projectId: string): Promise<{ code: number; nodeId?: string }> {
  const res = await fetch(`${base}/api/projects/${projectId}/merge/run`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const corps = (await res.json()) as { nodeId?: string };
  return { code: res.status, ...(corps.nodeId !== undefined ? { nodeId: corps.nodeId } : {}) };
}

describe('une ouvrière HORS SERVICE ne reçoit pas de fusion', () => {
  it('LA SEULE OUVRIÈRE HORS SERVICE ⇒ le hub refuse, il n’insiste pas', async () => {
    const ws = await inscrire('ouvriere-au-repos');
    await deService(ws, 'ouvriere-au-repos', false);

    const r = await lancerFusion(projetFusionnable('alpha'));
    expect(r.code, 'le hub a confié un merge à une ouvrière au repos').toBe(503);
    expect(r.nodeId).toBeUndefined();
  });

  it('DE SERVICE, elle le reçoit — la contre-épreuve', async () => {
    // Sans elle, un hub qui refuserait TOUJOURS satisferait le banc du dessus.
    const ws = await inscrire('ouvriere-au-travail');
    await deService(ws, 'ouvriere-au-travail', true);

    const r = await lancerFusion(projetFusionnable('beta'));
    expect(r.code).toBe(202);
    expect(r.nodeId).toBe('ouvriere-au-travail');
  });

  it('QUI N’A RIEN DIT est réputée disponible — le défaut des nœuds anciens', async () => {
    // C'est tout l'objet du `??` plutôt qu'un `Map` initialisée à `false` : un
    // nœud d'avant Night Shift ne déclare rien, et doit continuer à travailler.
    await inscrire('ouvriere-muette');

    const r = await lancerFusion(projetFusionnable('gamma'));
    expect(r.code).toBe(202);
    expect(r.nodeId).toBe('ouvriere-muette');
  });

  it('LE HUB CHOISIT CELLE QUI EST DE SERVICE, pas la première venue', async () => {
    // Le cas qui compte vraiment : il y a du monde, mais tout le monde n'est pas
    // disponible. `listNodes()` trie par nom, donc `a-` passerait d'abord.
    const repos = await inscrire('a-au-repos');
    const travail = await inscrire('z-au-travail');
    await deService(repos, 'a-au-repos', false);
    await deService(travail, 'z-au-travail', true);

    const r = await lancerFusion(projetFusionnable('delta'));
    expect(r.code).toBe(202);
    expect(r.nodeId, 'le hub a pris la première par le nom, pas la disponible').toBe(
      'z-au-travail',
    );
  });
});
