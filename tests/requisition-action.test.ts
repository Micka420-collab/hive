// Réquisition d'ACTION (G12) — vrai serveur + vrai Worker, comme
// requisition-mid-task : un `git push` proposé par l'agent crée une réquisition
// dans la Chambre, la décision humaine revient au Worker SUSPENDU, et une
// réquisition expirée remonte en escalade au journal.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { resumerEvenementChambre } from '../src/orchestrator/chambre-journal.js';
import { projeterEvenementOuvriere } from '../src/orchestrator/journal-ouvriere.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { DecisionAction } from '../src/shared/politique-actions.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-requisition-action-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

describe('réquisition d’action (G12) — push gardé, décision relayée, échéance escaladée', () => {
  let server: HiveServer;
  let dir: string;
  let client: HiveNodeClient;

  afterEach(async () => {
    client?.stop();
    await server?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function demarrer(prefixe: string, requisitionActionTtlMs?: number) {
    dir = mkdtempSync(path.join(os.tmpdir(), prefixe));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      envPath: path.join(dir, '.env'),
      simulation: true,
      tickMs: 60,
      ...(requisitionActionTtlMs !== undefined ? { requisitionActionTtlMs } : {}),
    });
    const base = `http://127.0.0.1:${server.port}`;
    const auth = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: 'admin@hive.test',
        password: 'mot-de-passe-test',
        displayName: 'Admin',
      }),
    });
    const { token: adminToken } = (await auth.json()) as { token: string };
    return { base, adminHeaders: { ...headers, authorization: `Bearer ${adminToken}` } };
  }

  async function creerTache(base: string, niveau: 'off' | 'gouverne'): Promise<string> {
    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: `Action ${niveau}` }),
      })
    ).json()) as { id: string };
    // Le niveau d'autonomie EXISTANT du projet : c'est lui que l'assign_task
    // transporte, et lui que la politique d'actions lit côté Worker.
    if (niveau !== 'off') {
      server.store.setEssaim(project.id, { niveau, depotInscrit: false }, 'banc');
    }
    const tasks = (await (
      await fetch(`${base}/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tasks: [{ title: 'Pousser', prompt: 'work' }] }),
      })
    ).json()) as Task[];
    return tasks[0]!.id;
  }

  function adaptateurPush(surDecision: (d: DecisionAction) => void): AgentAdapter {
    return {
      name: 'push-action',
      async run(_task, ctx) {
        // Le même chemin que le CLI réel : le pont relaie la proposition à
        // `ctx.decideAction`, qui classe `git push` en irréversible.
        const decision = await ctx.decideAction!({
          toolName: 'Bash',
          input: { command: 'git push origin main' },
        });
        surDecision(decision);
        return {
          success: true,
          diff: 'diff ok',
          logs: `décision reçue : ${decision.behavior}`,
          subAgents: [],
        };
      },
    };
  }

  function brancherNoeud(nom: string, adapter: AgentAdapter): void {
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: nom,
      ownerName: 'test',
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    client.start();
  }

  async function attendre<T>(lire: () => T | undefined, duree = 12_000): Promise<T | undefined> {
    const limite = Date.now() + duree;
    while (Date.now() < limite) {
      const vu = lire();
      if (vu !== undefined) return vu;
      await new Promise((r) => setTimeout(r, 60));
    }
    return undefined;
  }

  it('un git push crée une réquisition « action » ; Accorder revient en allow au Worker', async () => {
    const { base, adminHeaders } = await demarrer('hive-action-grant-');
    const taskId = await creerTache(base, 'gouverne');
    let decision: DecisionAction | undefined;
    brancherNoeud(
      'noeud-action',
      adaptateurPush((d) => (decision = d)),
    );

    const req = await attendre(() =>
      server.store
        .listerRequisitions({ statut: 'ouverte' })
        .find((r) => r.taskId === taskId && r.genre === 'action'),
    );
    expect(req, 'réquisition d’action ouverte, liée à la tâche').toBeTruthy();
    expect(req!.libelle).toContain('git push');
    // Le bandeau « À trancher » de la Chambre lit ces mêmes réquisitions
    // ouvertes par nœud : l'événement journalisé porte la tâche bloquée.
    const ouverte = server.store
      .listEvents(0, 500)
      .find((e) => e.type === 'requisition_ouverte' && e.payload.id === req!.id);
    expect(ouverte?.payload).toMatchObject({ genre: 'action', taskId });

    const rep = await fetch(`${base}/api/requisitions/${req!.id}/repondre`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ decision: 'accordee' }),
    });
    expect(rep.status).toBe(200);

    await attendre(() => (server.store.getTask(taskId)?.status === 'done' ? true : undefined));
    expect(server.store.getTask(taskId)?.status).toBe('done');
    expect(decision).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'git push origin main' },
    });
  });

  it('refusée depuis la Chambre : le Worker reçoit un deny motivé, la tâche continue', async () => {
    const { base, adminHeaders } = await demarrer('hive-action-deny-');
    const taskId = await creerTache(base, 'gouverne');
    let decision: DecisionAction | undefined;
    brancherNoeud(
      'noeud-refus',
      adaptateurPush((d) => (decision = d)),
    );

    const req = await attendre(() =>
      server.store
        .listerRequisitions({ statut: 'ouverte' })
        .find((r) => r.taskId === taskId && r.genre === 'action'),
    );
    expect(req).toBeTruthy();
    const rep = await fetch(`${base}/api/requisitions/${req!.id}/repondre`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ decision: 'refusee' }),
    });
    expect(rep.status).toBe(200);

    await attendre(() => (server.store.getTask(taskId)?.status === 'done' ? true : undefined));
    expect(decision?.behavior).toBe('deny');
    expect((decision as { message: string }).message).toContain('refusée');
    // Un refus d'action n'est NI un échec d'infra NI une tâche perdue : le
    // Worker a reçu une décision dite et a rendu son travail.
    expect(server.store.getTask(taskId)?.status).toBe('done');
  });

  it('expirée sans décision : deny au Worker, statut expiree, escalade au journal (critère c)', async () => {
    const { base, adminHeaders } = await demarrer('hive-action-expire-', 150);
    const taskId = await creerTache(base, 'gouverne');
    let decision: DecisionAction | undefined;
    brancherNoeud(
      'noeud-echeance',
      adaptateurPush((d) => (decision = d)),
    );

    // Personne ne tranche : l'échéance (150 ms) passe, le tick (60 ms) escalade.
    await attendre(() => (decision !== undefined ? true : undefined));
    expect(decision?.behavior).toBe('deny');
    expect((decision as { message: string }).message).toContain('expirée');

    const expiree = server.store.listerRequisitions({ statut: 'expiree' })[0];
    expect(expiree, 'la réquisition est close par expiration').toBeTruthy();
    expect(expiree!.taskId).toBe(taskId);
    // Une expirée est CLOSE : répondre après coup est refusé, pas rejoué.
    const tard = await fetch(`${base}/api/requisitions/${expiree!.id}/repondre`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ decision: 'accordee' }),
    });
    expect(tard.status).toBe(409);

    const evenement = await attendre(() =>
      server.store
        .listEvents(0, 500)
        .find((e) => e.type === 'requisition_expiree' && e.payload.id === expiree!.id),
    );
    expect(evenement, 'l’escalade est journalisée').toBeTruthy();
    expect(evenement!.payload).toMatchObject({ taskId, genre: 'action' });

    // Le journal de la Chambre PORTE l'escalade : projection bornée (poste
    // ouvrière) puis résumé timeline — libellé et motif, badge EXPIRÉ.
    const projete = projeterEvenementOuvriere(evenement!);
    expect(projete.payload.libelle).toContain('git push');
    expect(projete.payload.genre).toBe('action');
    const ligne = resumerEvenementChambre(projete.type, projete.payload);
    expect(ligne.badge).toBe('EXPIRÉ');
    expect(ligne.resume).toContain('git push');
    expect(ligne.detail).toContain('échéance');

    await attendre(() => (server.store.getTask(taskId)?.status === 'done' ? true : undefined));
    expect(server.store.getTask(taskId)?.status).toBe('done');
  }, 20_000);

  it('projet sans autonomie (off) : l’irréversible est refusé NET, sans réquisition', async () => {
    const { base } = await demarrer('hive-action-off-');
    const taskId = await creerTache(base, 'off');
    let decision: DecisionAction | undefined;
    brancherNoeud(
      'noeud-off',
      adaptateurPush((d) => (decision = d)),
    );

    await attendre(() => (decision !== undefined ? true : undefined));
    expect(decision?.behavior).toBe('deny');
    expect((decision as { message: string }).message).toContain('politique Hive');
    expect(server.store.listerRequisitions({}).filter((r) => r.taskId === taskId)).toEqual([]);
    await attendre(() => (server.store.getTask(taskId)?.status === 'done' ? true : undefined));
    expect(server.store.getTask(taskId)?.status).toBe('done');
  });
});
