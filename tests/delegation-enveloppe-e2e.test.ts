// L'ENVELOPPE D'UN ARBRE DÉLÉGUÉ, EN CONDITIONS RÉELLES : une vraie Reine, de
// vrais nœuds (`HiveNodeClient`) et le chemin WebSocket complet.
//
// Ce que les bancs de l'ordonnanceur ne peuvent pas prouver seuls :
//
//   · le GUICHET du nœud applique la même règle de places que la Reine — sans
//     quoi l'ouvrière refuserait (`noeud_sature`) l'enfant que la Reine lui
//     confie, précisément parce que son parent l'attend — et cette place
//     relâchée ne sert qu'à l'arbre qui attend, jamais à une autre racine ;
//   · un enfant ANNULÉ par l'enveloppe coût — ou ÉCHOUÉ sans rien rendre —
//     prévient tout de suite le parent qui l'attend, avec la raison — au lieu
//     d'une attente muette jusqu'à l'échéance du budget ;
//   · le refus suivant arrive à l'agent avec la borne nommée ;
//   · la consigne de routage se pose par la route gardée, et se relit.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import type {
  AgentAdapter,
  WorkerDelegationOutcome,
  WorkerDelegationResult,
} from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { LIMITES_DELEGATION_DEFAUT } from '../src/shared/limites-delegation.js';

const TOKEN = 'enveloppe-e2e-jeton-suffisant';

async function attendre(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
}

const demande = (childTaskId: string, costMicros = 1) => ({
  childTaskId,
  reason: 'confier un lot borné',
  title: `Lot ${childTaskId}`,
  prompt: 'Fais ce lot et rends les preuves.',
  durationMs: 60_000,
  costMicros,
  resourceUnits: 1,
});

const reussite = { success: true, diff: '', logs: 'ok', subAgents: [] };

describe('l’enveloppe d’un arbre délégué, de la Reine au nœud', () => {
  let server: HiveServer | null = null;
  let tempDir: string | null = null;
  const clients: HiveNodeClient[] = [];
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  afterEach(async () => {
    for (const client of clients.splice(0)) client.stop();
    if (server) await server.stop();
    server = null;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  /** Une Reine, un projet et sa tâche racine `root`. */
  async function monterRuche(): Promise<{ base: string }> {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-enveloppe-e2e-'));
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
    const projet = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Enveloppe' }),
      })
    ).json()) as { id: string };
    const creees = await fetch(`${base}/api/projects/${projet.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: [{ id: 'root', title: 'Racine', prompt: 'délègue' }] }),
    });
    expect(creees.status).toBe(201);
    return { base };
  }

  function lancerNoeud(nom: string, adapter: AgentAdapter, maxConcurrency: number): void {
    const client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server!.port}/ws`,
      token: TOKEN,
      name: nom,
      ownerName: 'e2e',
      agentType: 'shell',
      maxConcurrency,
      workRoot: path.join(tempDir!, nom),
      adapter,
      quiet: true,
    });
    clients.push(client);
    client.start();
  }

  it(
    'une ouvrière à UNE place porte un arbre à deux niveaux jusqu’au bout',
    { timeout: 30_000 },
    async () => {
      await monterRuche();
      const fins: string[] = [];
      const deleguerPuisAttendre = async (
        ctx: Parameters<AgentAdapter['run']>[1],
        enfant: string,
      ): Promise<WorkerDelegationResult> => {
        const admis = await ctx.delegate!(demande(enfant));
        expect(admis.ok).toBe(true);
        return ctx.waitForDelegationResult!(enfant);
      };
      lancerNoeud(
        'seule',
        {
          name: 'arbre',
          async run(task, ctx) {
            if (task.id === 'root') await deleguerPuisAttendre(ctx, 'enfant');
            if (task.id === 'enfant') await deleguerPuisAttendre(ctx, 'petit-enfant');
            fins.push(task.id);
            return reussite;
          },
        },
        1,
      );
      // Avant : l'enfant restait en file derrière son propre parent, et le
      // parent attendait l'échéance de son budget plus cinq minutes.
      await attendre(() => fins.length === 3);
      expect(fins).toEqual(['petit-enfant', 'enfant', 'root']);
      await attendre(() => server!.store.getTask('root')?.status === 'done');
    },
  );

  it(
    'le guichet ne rend la place d’un parent qui attend qu’à SON arbre',
    { timeout: 15_000 },
    async () => {
      tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-guichet-arbre-'));
      const hub = new WebSocketServer({ port: 0, host: '127.0.0.1' });
      const recus: Record<string, unknown>[] = [];
      let envoyer: (msg: unknown) => void = () => {};
      hub.on('connection', (ws) => {
        envoyer = (msg) => ws.send(JSON.stringify(msg));
        ws.on('message', (brut) => {
          const msg = JSON.parse(String(brut)) as Record<string, unknown>;
          recus.push(msg);
          if (msg.type === 'register') envoyer({ type: 'registered', nodeId: 'n-guichet' });
          if (msg.type === 'delegate_task') {
            envoyer({
              type: 'delegation_accepted',
              requestId: msg.requestId,
              parentTaskId: msg.parentTaskId,
              childTaskId: msg.childTaskId,
              depth: 1,
            });
          }
        });
      });
      await new Promise<void>((resolve) => hub.once('listening', () => resolve()));
      const tache = (id: string) => ({
        id,
        projectId: 'p',
        title: `Tâche ${id}`,
        prompt: 'travaille',
        status: 'assigned',
        dependsOn: [],
        attempts: 0,
        createdAt: 1,
        updatedAt: 1,
        assignedNodeId: 'n-guichet',
        branch: null,
      });
      const lancees: string[] = [];
      let admis = false;
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${(hub.address() as { port: number }).port}/ws`,
        token: TOKEN,
        name: 'guichet',
        ownerName: 'e2e',
        agentType: 'shell',
        nodeId: 'n-guichet',
        maxConcurrency: 1,
        workRoot: path.join(tempDir, 'guichet'),
        adapter: {
          name: 'guichet',
          async run(task, ctx) {
            lancees.push(task.id);
            if (task.id === 'root') {
              admis = (await ctx.delegate!(demande('enfant'))).ok;
              await ctx.waitForDelegationResult!('enfant');
            }
            return reussite;
          },
        },
        quiet: true,
      });
      try {
        client.start();
        await attendre(() => recus.some((m) => m.type === 'register'));
        envoyer({ type: 'assign_task', task: tache('root'), repoUrl: null });
        await attendre(() => admis);

        // Une AUTRE racine : la place de `root` ne lui est pas rendue.
        envoyer({ type: 'assign_task', task: tache('autre'), repoUrl: null });
        await attendre(() => recus.some((m) => m.type === 'task_reject' && m.taskId === 'autre'));
        expect(recus.find((m) => m.type === 'task_reject')).toMatchObject({
          reason: 'noeud_sature',
        });

        // L'enfant que `root` attend, lui, la reprend.
        envoyer({
          type: 'assign_task',
          task: tache('enfant'),
          repoUrl: null,
          delegationBudget: { durationMs: 60_000, costMicros: 1, resourceUnits: 1 },
          delegationRootTaskId: 'root',
        });
        await attendre(() => lancees.includes('enfant'));
        expect(lancees).toEqual(['root', 'enfant']);
      } finally {
        client.stop();
        await new Promise<void>((resolve) => hub.close(() => resolve()));
      }
    },
  );

  it(
    'l’enveloppe coût atteinte : le parent apprend l’annulation tout de suite, et le refus suivant nomme la borne',
    { timeout: 30_000 },
    async () => {
      const { base } = await monterRuche();
      const plafondUsd = LIMITES_DELEGATION_DEFAUT.maxCostMicros / 1_000_000;
      // Ce que l'agent racine a VU : l'issue de `lent`, puis le refus de `tard`.
      const vu: { lent?: WorkerDelegationResult; tard?: WorkerDelegationOutcome } = {};
      const adapter: AgentAdapter = {
        name: 'enveloppe',
        async run(task, ctx) {
          if (task.id === 'root') {
            for (const id of ['lent', 'cher'])
              expect((await ctx.delegate!(demande(id))).ok).toBe(true);
            await ctx.waitForDelegationResult!('cher');
            vu.lent = await ctx.waitForDelegationResult!('lent');
            vu.tard = await ctx.delegate!(demande('tard', 0));
            return reussite;
          }
          if (task.id === 'cher') {
            return { ...reussite, fournisseur: { source: 'claude-code', coutUsd: plafondUsd } };
          }
          // `lent` travaille jusqu'à ce que la Reine l'arrête.
          await new Promise<void>((resolve) =>
            ctx.signal.aborted
              ? resolve()
              : ctx.signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          return { ...reussite, success: false };
        },
      };
      lancerNoeud('a', adapter, 1);
      lancerNoeud('b', adapter, 1);

      await attendre(() => vu.tard !== undefined);
      if (!vu.lent?.ok || vu.tard?.ok !== false) throw new Error('issues inattendues');
      expect(vu.lent).toMatchObject({ childTaskId: 'lent', success: false });
      expect(vu.lent.logs).toContain('budget coût de la racine épuisé');
      expect(vu.tard.code).toBe('cout');
      expect(vu.tard.message).toContain(`${LIMITES_DELEGATION_DEFAUT.maxCostMicros} µUSD déclarés`);

      const graphe = (await (
        await fetch(`${base}/api/tasks/root/delegation`, { headers })
      ).json()) as {
        enveloppe: { coutEpuise: boolean; depense: { micros: number; sansCout: number } };
      };
      expect(graphe.enveloppe.coutEpuise).toBe(true);
      expect(graphe.enveloppe.depense.micros).toBe(LIMITES_DELEGATION_DEFAUT.maxCostMicros);
    },
  );

  it(
    'un enfant ÉCHOUÉ sans résultat (aucun agent fonctionnel) prévient son parent tout de suite',
    { timeout: 30_000 },
    async () => {
      await monterRuche();
      let vu: WorkerDelegationResult | undefined;
      lancerNoeud(
        'panne',
        {
          name: 'panne',
          async run(task, ctx) {
            if (task.id === 'root') {
              expect((await ctx.delegate!(demande('enfant'))).ok).toBe(true);
              vu = await ctx.waitForDelegationResult!('enfant');
              return reussite;
            }
            // L'agent de l'enfant est en panne : refus d'infrastructure, jusqu'à
            // ce que la Reine conclue qu'aucun agent ne fonctionne.
            return { success: false, diff: '', logs: 'agent en panne', subAgents: [], infra: true };
          },
        },
        1,
      );
      // Avant : aucun `delegation_result` — le parent attendait le budget de
      // l'enfant plus cinq minutes de grâce, pour lire « résultat absent ».
      await attendre(() => vu !== undefined, 25_000);
      if (!vu?.ok) throw new Error('issue inattendue');
      expect(vu).toMatchObject({ childTaskId: 'enfant', success: false });
      expect(vu.logs).toContain('échouée sans résultat');
      expect(vu.logs).toContain('aucun agent fonctionnel');
      expect(server!.store.getTask('enfant')?.status).toBe('failed');
    },
  );

  it('la consigne de routage se pose par la route gardée, refuse ce qui est mal formé, et se relit', async () => {
    const { base } = await monterRuche();
    const url = `${base}/api/tasks/root/consigne-routage`;
    const poser = (consigne: unknown) =>
      fetch(url, { method: 'PUT', headers, body: JSON.stringify({ consigne }) });

    const contradictoire = await poser({ agent: 'codex', sansAgents: ['codex'] });
    expect(contradictoire.status).toBe(400);
    expect(((await contradictoire.json()) as { error: string }).error).toContain(
      'à la fois imposé et exclu',
    );

    const posee = await poser({ sansModeles: ['m2', 'm1', 'm1'] });
    expect(posee.status).toBe(200);
    expect(await posee.json()).toMatchObject({
      consigne: { sansModeles: ['m1', 'm2'] },
      effet: 'immediat',
    });
    expect(await (await fetch(url, { headers })).json()).toMatchObject({
      taskId: 'root',
      consigne: { sansModeles: ['m1', 'm2'] },
    });

    expect((await poser(null)).status).toBe(200);
    expect(await (await fetch(url, { headers })).json()).toMatchObject({ consigne: null });
  });
});
