// LE HUB SAVAIT DIRE NON, ET NE LE DISAIT JAMAIS.
//
// ─── LA BOUCHE QU'IL N'OUVRAIT PAS ───────────────────────────────────────────
//
// `ErrorMsg` — `{ type: 'error', message: string }` — est dans le protocole
// depuis le début. Le client de nœud le PARSE et le JOURNALISE
// (`erreur du hub : …`, client.ts). L'orchestrateur ne l'émettait NULLE PART.
//
// Le hub avait donc une bouche et ne s'en servait pas, alors qu'il écarte du
// travail sur trois chemins :
//
//   · un `task_result` pour une tâche INCONNUE ;
//   · un `task_result` pour une assignation PÉRIMÉE — tâche réaffectée,
//     annulée, ou déjà close ;
//   · un `merge_result` dont le `mergeId` ne lui dit plus rien.
//
// Dans les deux premiers cas il journalise (`result_ignored`) : un humain peut
// voir. Le NŒUD, lui, n'apprenait rien — son agent avait tourné, il avait
// remonté un diff, et il repartait convaincu d'avoir livré.
//
// ─── LE TROISIÈME CAS ÉTAIT PIRE : PERSONNE NE VOYAIT RIEN ───────────────────
//
// Un `merge_result` orphelin était ignoré sans réponse ET SANS ÉVÉNEMENT. Or ce
// nœud vient de faire tourner un VRAI merge sur le dépôt de quelqu'un : il a pu
// appliquer des diffs, lancer des tests, pousser des commits.
//
// Et le cas arrive tout seul : le hub déclare orphelin un merge dont le nœud
// s'est tu trop longtemps, le nœud finit quand même, son résultat tombe dans le
// vide. De son côté : « merge terminé ». Du côté humain : rien, jamais.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import { brancherFauxNoeud } from './aide/faux-noeud.js';

const TOKEN = 'jeton-de-test-suffisamment-long-42';

describe('LE HUB DIT NON QUAND IL ÉCARTE DU TRAVAIL', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let dir: string;
  const ouverts: WebSocket[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-non-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
  });

  afterAll(async () => {
    for (const ws of ouverts) ws.close();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Un nœud enregistré (qui bat, `aide/faux-noeud`), avec la file de ce que le hub lui a dit. */
  async function noeud(nodeId: string): Promise<{ ws: WebSocket; recus: string[] }> {
    const recus: string[] = [];
    const { ws } = await brancherFauxNoeud<{ type: string; message?: string }>(
      server.port,
      {
        token: TOKEN,
        nodeId,
        name: nodeId,
        ownerName: 'testeur',
        agentType: 'shell',
        maxConcurrency: 1,
      },
      (m) => {
        if (m.type === 'error') recus.push(m.message ?? '');
      },
    );
    ouverts.push(ws);
    return { ws, recus };
  }

  /**
   * Attend que le hub ait traité le message — la réponse est un aller-retour
   * réel. Sur une CONDITION, pas un délai fixe : 120 ms ne suffisaient pas à
   * une suite chargée (jambe Windows), et le banc concluait « le hub n'a rien
   * dit » sur une réponse simplement en route.
   */
  const souffler = async (fait: () => boolean): Promise<void> => {
    const fin = Date.now() + 10_000;
    while (!fait() && Date.now() < fin) await new Promise((r) => setTimeout(r, 20));
  };

  it('UNE TÂCHE INCONNUE : le nœud est PRÉVENU, il ne repart pas rassuré', async () => {
    const { ws, recus } = await noeud('n-inconnu');
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: 'tache-qui-n-existe-pas',
        success: true,
        diff: 'diff --git a/x b/x',
        logs: '',
        durationMs: 10,
        subAgents: [],
      }),
    );
    await souffler(() => recus.length > 0);

    expect(recus, 'LE HUB N’A RIEN DIT — le nœud croit avoir livré').toHaveLength(1);
    expect(recus[0], 'le message doit nommer la tâche écartée').toContain('tache-qui-n-existe-pas');
    expect(recus[0]).toMatch(/écarté/);
  });

  it('UNE ASSIGNATION PÉRIMÉE : même traitement', async () => {
    // La tâche existe, mais elle n'est pas à ce nœud-là. Sans réponse, deux
    // nœuds peuvent croire simultanément avoir livré la même tâche.
    const projet = server.store.createProject({ name: 'Ruche', repoUrl: null, ownerId: null });
    server.store.createTask({ id: 't-a-autrui', projectId: projet.id, title: 'x', prompt: 'y' });
    // ELLE EST À QUELQU'UN D'AUTRE, ET ON LE DIT.
    //
    // La tâche restait libre, et le test comptait sur un nœud d'un test voisin
    // pour la rafler avant `n-perime` — l'arrivée d'un nœud déclenche une
    // distribution. Passé EN PREMIER, `n-perime` était le seul candidat : il
    // recevait la tâche, son résultat devenait légitime, et le hub se taisait
    // à juste titre. Le test échouait en accusant le silence du hub, alors que
    // c'était sa propre prémisse qui manquait.
    server.store.patchTask('t-a-autrui', { status: 'running', assignedNodeId: 'n-un-autre' });

    const { ws, recus } = await noeud('n-perime');
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: 't-a-autrui',
        success: true,
        diff: 'diff --git a/x b/x',
        logs: '',
        durationMs: 10,
        subAgents: [],
      }),
    );
    await souffler(() => recus.length > 0);

    expect(recus, 'un résultat écarté doit être dit').toHaveLength(1);
    expect(recus[0]).toContain('t-a-autrui');
  });

  it('UN MERGE ORPHELIN : le nœud est prévenu ET le journal en garde trace', async () => {
    // Le pire des trois : ce nœud vient de faire tourner un vrai merge sur le
    // dépôt de quelqu'un. Avant, son résultat disparaissait sans réponse et
    // SANS ÉVÉNEMENT — personne, des deux côtés, ne pouvait le savoir.
    const avant = server.store.listEvents(0).length;
    const { ws, recus } = await noeud('n-merge');
    ws.send(
      JSON.stringify({
        type: 'merge_result',
        mergeId: 'merge-oublie',
        applied: [],
        conflicts: [],
        mergedDiff: '',
        testsRun: false,
        testsPassed: null,
        logs: 'tout est passé',
      }),
    );
    await souffler(() => recus.length > 0);

    expect(recus, 'le nœud doit apprendre que son merge est tombé dans le vide').toHaveLength(1);
    expect(recus[0]).toContain('merge-oublie');

    const nouveaux = server.store.listEvents(avant);
    expect(
      nouveaux.some((e) => e.type === 'merge_result_ignored'),
      'LE JOURNAL DOIT EN GARDER TRACE — sinon l’humain ne peut relier ' +
        '« j’ai vu le merge tourner » à « la ruche n’en a pas voulu »',
    ).toBe(true);
  });

  it('UN RÉSULTAT ACCEPTÉ NE DÉCLENCHE AUCUNE ERREUR — sinon la garde est du bruit', async () => {
    // Une garde qui crie aussi sur le chemin normal apprend à ignorer ses cris.
    // C'est la moitié du lot qu'on oublie le plus facilement.
    const projet = server.store.createProject({ name: 'Ruche 2', repoUrl: null, ownerId: null });
    server.store.createTask({ id: 't-a-moi', projectId: projet.id, title: 'x', prompt: 'y' });

    const { ws, recus } = await noeud('n-ok');
    // On l'assigne vraiment à ce nœud : c'est le chemin nominal.
    server.store.patchTask('t-a-moi', { status: 'running', assignedNodeId: 'n-ok' });
    ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId: 't-a-moi',
        success: true,
        diff: 'diff --git a/x b/x\n+ligne',
        logs: '',
        durationMs: 10,
        subAgents: [],
      }),
    );
    // Le résultat est PRIS EN COMPTE — puis un court délai pour qu'un refus
    // éventuel, écrit par le même traitement, ait traversé la socket (un
    // silence ne s'attend pas sur une condition).
    await souffler(() => server.store.getTask('t-a-moi')?.status === 'done');
    await new Promise((r) => setTimeout(r, 120));

    expect(recus, 'le chemin normal doit être MUET').toEqual([]);
    expect(server.store.getTask('t-a-moi')?.status, 'et le résultat pris en compte').toBe('done');
  });
});
