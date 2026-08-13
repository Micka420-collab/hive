// Tests de l'invitation : encodage/décodage robustes, validation, et flux
// complet « génère une invitation → un nœud la décode et rejoint la ruche ».

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeInvite, encodeInvite, isWsUrl } from '../src/shared/invite.js';
import {
  agentCredentialEnv,
  detectAllAgents,
  detectBestAgent,
} from '../src/node-client/agent-detect.js';
import { buildSandboxEnv } from '../src/node-client/workspace.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, detectLanWsUrl } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-invitation-assez-long';

describe('invite (encode/décode)', () => {
  it('fait un aller-retour fidèle', () => {
    const inv = { url: 'ws://192.168.1.20:7777/ws', token: TOKEN, label: 'Ruche de Micka' };
    const encoded = encodeInvite(inv);
    expect(encoded.startsWith('hive1_')).toBe(true);
    expect(decodeInvite(encoded)).toEqual(inv);
  });

  it('tolère les espaces et un préfixe hive:// collé par erreur', () => {
    const encoded = encodeInvite({ url: 'wss://h/ws', token: TOKEN });
    expect(decodeInvite(`  ${encoded}  `)?.token).toBe(TOKEN);
    expect(decodeInvite(`hive://${encoded}`)?.token).toBe(TOKEN);
  });

  it('rejette les chaînes invalides', () => {
    expect(decodeInvite('')).toBeNull();
    expect(decodeInvite('nimporte quoi')).toBeNull();
    expect(decodeInvite('hive1_%%%')).toBeNull();
    expect(decodeInvite(42)).toBeNull();
    // URL non WebSocket refusée.
    expect(decodeInvite(encodeInvite({ url: 'http://h/ws', token: TOKEN } as never))).toBeNull();
  });

  it('valide les URL WebSocket', () => {
    expect(isWsUrl('ws://host:7777/ws')).toBe(true);
    expect(isWsUrl('wss://host/ws')).toBe(true);
    expect(isWsUrl('http://host')).toBe(false);
    expect(isWsUrl('pas une url')).toBe(false);
  });

  it('rejette un label contenant des caractères de contrôle (anti-injection ANSI)', () => {
    const encoded = encodeInvite({
      url: 'ws://h/ws',
      token: TOKEN,
      label: 'Ruche[2K\rMalveillante',
    });
    const decoded = decodeInvite(encoded);
    expect(decoded).not.toBeNull();
    // Le token/URL restent utilisables, mais le label piégé est écarté :
    // l'URL réelle ne peut donc pas être masquée par une réécriture de terminal.
    expect(decoded?.label).toBeUndefined();
    expect(decoded?.url).toBe('ws://h/ws');
  });

  it('detectLanWsUrl renvoie une URL WebSocket bien formée', () => {
    expect(isWsUrl(detectLanWsUrl(7777))).toBe(true);
  });
});

describe('détection d’agent', () => {
  const KNOWN = new Set(['claude-code', 'codex', 'shell']);

  it('propose toujours le shell simulé et ne retourne que des agents connus', async () => {
    const all = await detectAllAgents();
    expect(all).toContain('shell');
    for (const a of all) expect(KNOWN.has(a)).toBe(true);
  });

  it('choisit un agent connu (le shell au minimum)', async () => {
    const best = await detectBestAgent();
    expect(KNOWN.has(best.agent)).toBe(true);
    expect(typeof best.label).toBe('string');
  });

  it('agentCredentialEnv : rien pour shell, config + clé pour les agents réels', () => {
    expect(agentCredentialEnv('shell')).toEqual([]);
    expect(agentCredentialEnv('claude-code')).toContain('ANTHROPIC_API_KEY');
    expect(agentCredentialEnv('claude-code')).toContain('HOME');
    expect(agentCredentialEnv('codex')).toContain('OPENAI_API_KEY');
  });

  it('buildSandboxEnv transmet les identifiants d’un agent réel (et rien au shell)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-env-'));
    process.env.ANTHROPIC_API_KEY = 'cle-de-test';
    try {
      const realEnv = buildSandboxEnv(dir, agentCredentialEnv('claude-code'));
      expect(realEnv.ANTHROPIC_API_KEY).toBe('cle-de-test');
      // Le shell simulé reste totalement épuré (aucune clé transmise).
      const shellEnv = buildSandboxEnv(dir, agentCredentialEnv('shell'));
      expect(shellEnv.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      rmSync(dir, { recursive: true, force: true });
      rmSync(`${dir}.tmp`, { recursive: true, force: true });
    }
  });
});

describe("flux complet d'invitation", () => {
  let server: HiveServer;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-invite-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 80,
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it("l'endpoint /api/invite renvoie une invitation décodable vers cette ruche", async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const url = `ws://127.0.0.1:${server.port}/ws`;
    const res = await fetch(`${base}/api/invite?url=${encodeURIComponent(url)}`, {
      headers: { 'x-hive-token': TOKEN },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invite: string; joinCommand: string };
    const decoded = decodeInvite(body.invite);
    expect(decoded?.url).toBe(url);
    expect(decoded?.token).toBe(TOKEN);
    expect(body.joinCommand).toContain('npm run join');
  });

  it('UNE INVITATION VERS UNE ADRESSE OÙ L’ON N’ÉCOUTE PAS SE DÉNONCE', async () => {
    // La ruche de ce test n'écoute que sur `127.0.0.1` — le défaut, et le cas
    // de tout le monde tant que `HIVE_HOST` n'est pas posé. Demander une
    // invitation vers l'IP du réseau local produit une commande PARFAITE et
    // inutilisable : l'ami la colle, sa connexion expire, et rien ne dit
    // pourquoi. C'est ce silence-là qu'on ferme.
    const base = `http://127.0.0.1:${server.port}`;
    const lan = `ws://192.168.1.20:${server.port}/ws`;
    const res = await fetch(`${base}/api/invite?url=${encodeURIComponent(lan)}`, {
      headers: { 'x-hive-token': TOKEN },
    });
    const body = (await res.json()) as { invite: string; injoignable?: string };
    expect(body.invite, 'on fabrique quand même l’invitation').toBeTruthy();
    expect(body.injoignable, 'le piège doit être nommé').toBeTruthy();
    expect(body.injoignable, 'et le remède donné').toContain('HIVE_HOST=0.0.0.0');

    // L'autre moitié : une invitation vers la machine elle-même est un usage
    // normal (travail solo), et ne doit déclencher aucune alarme.
    const local = `ws://127.0.0.1:${server.port}/ws`;
    const sain = await fetch(`${base}/api/invite?url=${encodeURIComponent(local)}`, {
      headers: { 'x-hive-token': TOKEN },
    });
    expect(((await sain.json()) as { injoignable?: string }).injoignable).toBeUndefined();
  });

  it('un nœud construit depuis une invitation rejoint et exécute une tâche', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const url = `ws://127.0.0.1:${server.port}/ws`;

    // L'hôte génère l'invitation.
    const inviteRes = await fetch(`${base}/api/invite?url=${encodeURIComponent(url)}`, {
      headers: { 'x-hive-token': TOKEN },
    });
    const invite = decodeInvite(((await inviteRes.json()) as { invite: string }).invite);
    expect(invite).not.toBeNull();

    // L'ami « colle » l'invitation : un client se construit uniquement à partir d'elle.
    const adapter: AgentAdapter = {
      name: 'ami',
      async run() {
        return { success: true, diff: '', logs: 'ok', subAgents: [] };
      },
    };
    const client = new HiveNodeClient({
      url: invite!.url,
      token: invite!.token,
      name: 'machine-ami',
      ownerName: 'ami',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'ami'),
      adapter,
      quiet: true,
    });
    client.start();

    try {
      const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
      const project = (await (
        await fetch(`${base}/api/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Via invitation' }),
        })
      ).json()) as { id: string };
      const tasks = (await (
        await fetch(`${base}/api/projects/${project.id}/tasks`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ tasks: [{ id: 'tinv', title: 'T', prompt: 'p' }] }),
        })
      ).json()) as Task[];
      const taskId = tasks[0]!.id;

      const deadline = Date.now() + 8_000;
      let status: string | undefined;
      while (Date.now() < deadline) {
        const snap = (await (await fetch(`${base}/api/state`, { headers })).json()) as {
          tasks: Task[];
        };
        status = snap.tasks.find((t) => t.id === taskId)?.status;
        if (status === 'done') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(status).toBe('done');
    } finally {
      client.stop();
    }
  });
});
