// `/api/tasks/:id/chronologie` sur une vraie Reine, après une vraie exécution :
// un vrai nœud (HiveNodeClient) reçoit la tâche, la démarre et la rend. Les
// phases viennent des événements réellement consignés, pas d'un journal fabriqué.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexAdapter } from '../src/adapters/codex.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import type { ChronologieTache } from '../src/shared/chronologie-tache.js';
import type { RegistreGenome } from '../src/shared/registre-genome.js';

const JETON = 'jeton-chronologie-suffisamment-long';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let dossier = '';

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

describe('la chronologie d’une tâche — sur une vraie Reine, après une vraie exécution', () => {
  it('LES PHASES SONT MESURÉES, LE MODÈLE ET LE COÛT FOURNISSEUR RESTENT INCONNUS', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'chronologie-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${serveur.port}/ws`,
      token: JETON,
      name: 'ouvriere-chrono',
      ownerName: 'banc',
      // Un nœud `shell` ne reçoit pas de travail de production hors simulation :
      // comme le scénario V2, on déclare un vrai type d'agent et on injecte
      // l'adaptateur.
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      adapter: {
        name: 'rapide',
        async run() {
          await new Promise((r) => setTimeout(r, 60));
          return { success: true, diff: '', logs: 'ok', subAgents: [] };
        },
      },
      quiet: true,
    });
    client.start();
    const s = serveur;
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({ projectId: p.id, title: 'Écrire le module', prompt: 'x' });
    s.store.patchTask(t.id, { status: 'ready' });
    await attendre(() => s.store.getTask(t.id)?.status === 'done', 'la tâche ne se termine pas');

    const base = `http://127.0.0.1:${s.port}`;
    const r = await fetch(`${base}/api/tasks/${t.id}/chronologie`, {
      headers: { 'x-hive-token': JETON },
    });
    expect(r.status).toBe(200);
    const { chronologie: c } = (await r.json()) as { chronologie: ChronologieTache };
    expect(c.terminee).toBe(true);
    expect(c.attenteWorkerMs, 'l’attente d’un Worker est mesurée').not.toBeNull();
    expect(c.demarrageMs, 'le démarrage réel est mesuré').not.toBeNull();
    expect(c.tentatives).toHaveLength(1);
    expect(c.tentatives[0]?.issue).toBe('reussie');
    expect(
      c.tentatives[0]?.dureeWorkerMs,
      'la durée rapportée par le Worker',
    ).toBeGreaterThanOrEqual(50);
    expect(c.totalMs, 'le total couvre au moins l’exécution').toBeGreaterThanOrEqual(
      c.tentatives[0]?.dureeWorkerMs ?? 0,
    );
    expect(c.reprises).toBe(0);
    expect(c.dureeModele).toBe('inconnu');
    expect(c.coutFournisseur).toBe('inconnu');

    expect((await fetch(`${base}/api/tasks/${t.id}/chronologie`)).status).toBe(401);
    const inconnue = await fetch(`${base}/api/tasks/pas-une-tache/chronologie`, {
      headers: { 'x-hive-token': JETON },
    });
    expect(inconnue.status).toBe(404);
  });

  it.skipIf(process.platform === 'win32')(
    'CODEX DÉCLARE SES JETONS : ils arrivent « déclarés » au panneau et au Genome, le coût reste inconnu',
    async () => {
      dossier = mkdtempSync(path.join(os.tmpdir(), 'chronologie-codex-'));
      // Un faux `codex` qui rejoue l'enregistrement du vrai binaire dans le
      // mode demandé — `--json` ou sortie humaine (tests/fixtures/flux-codex,
      // provenance dans flux-codex.test.ts).
      const bin = path.join(dossier, 'bin');
      const enregistrement = (nom: string) =>
        JSON.stringify(path.join(import.meta.dirname, 'fixtures', 'flux-codex', nom));
      mkdirSync(bin);
      writeFileSync(
        path.join(bin, 'codex'),
        [
          '#!/usr/bin/env node',
          "const json = process.argv.includes('--json');",
          `const stdout = json ? ${enregistrement('relecture-outil.json.stdout.jsonl')} : ${enregistrement('relecture-outil.humain.stdout.txt')};`,
          "process.stdout.write(require('node:fs').readFileSync(stdout));",
        ].join('\n'),
      );
      chmodSync(path.join(bin, 'codex'), 0o755);
      serveur = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: JETON,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(dossier, 'hive.db'),
        simulation: false,
        tickMs: 40,
      });
      const codex = createCodexAdapter(JETON);
      client = new HiveNodeClient({
        url: `ws://127.0.0.1:${serveur.port}/ws`,
        token: JETON,
        name: 'ouvriere-codex',
        ownerName: 'banc',
        agentType: 'codex',
        modeles: ['modele-de-test'],
        maxConcurrency: 1,
        workRoot: path.join(dossier, 'travail'),
        // Le VRAI adaptateur : seul le PATH mène au faux binaire, et la
        // délégation (hors sujet ici) n'est pas branchée.
        adapter: {
          name: 'codex',
          run: (tache, ctx) =>
            codex.run(tache, {
              ...ctx,
              delegate: undefined,
              waitForDelegationResult: undefined,
              env: { ...ctx.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
            }),
        },
        quiet: true,
      });
      client.start();
      const s = serveur;
      await attendre(
        () => s.store.listNodes().some((n) => n.status === 'online'),
        'le nœud ne rejoint pas la ruche',
      );
      const p = s.store.createProject({ name: 'P' });
      const t = s.store.createTask({ projectId: p.id, title: 'Relire la garde', prompt: 'x' });
      s.store.patchTask(t.id, { status: 'ready' });
      await attendre(() => s.store.getTask(t.id)?.status === 'done', 'la tâche ne se termine pas');

      const base = `http://127.0.0.1:${s.port}`;
      const entetes = { headers: { 'x-hive-token': JETON } };
      const r = await fetch(`${base}/api/tasks/${t.id}/chronologie`, entetes);
      const { chronologie: c } = (await r.json()) as { chronologie: ChronologieTache };
      expect(c.jetonsEntree).toEqual({ total: 4_448, declarees: 1, tentatives: 1 });
      expect(c.jetonsSortie).toEqual({ total: 104, declarees: 1, tentatives: 1 });
      expect(c.coutFournisseur, 'aucun coût tiré des jetons').toBe('inconnu');
      expect(c.dureeModele).toBe('inconnu');

      const g = (await (await fetch(`${base}/api/genome`, entetes)).json()) as RegistreGenome;
      expect(g.lignes[0]).toMatchObject({
        modele: 'modele-de-test',
        jetonsEntree: { total: 4_448, declarees: 1, tentatives: 1 },
        jetonsSortie: { total: 104, declarees: 1, tentatives: 1 },
        coutFournisseur: 'inconnu',
      });
    },
  );
});
