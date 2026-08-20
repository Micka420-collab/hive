// Test d'intégration de POST /api/chat (la Reine répond) : serveur réel sur
// port éphémère, réponses live multilingues depuis l'état réel, validation du
// body et exigence de token.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-chat-suffisamment-long';

interface ChatResponse {
  reply: string;
  source: 'live' | 'llm';
  lang: string;
  suggestions: string[];
}

describe('POST /api/chat — la Reine répond', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-chat-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 1_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    // Un projet réel pour que la Reine ait quelque chose à raconter.
    const res = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Projet Chat' }),
    });
    const project = (await res.json()) as { id: string };
    await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tasks: [{ title: 'construire la landing', prompt: 'faire' }] }),
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('répond en français depuis l état réel (source live)', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'Ou en est le projet ? merci' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(body.source).toBe('live');
    expect(body.lang).toBe('fr');
    expect(body.reply).toContain('Projet Chat');
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it('répond en anglais à un message anglais (projet mondial)', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'What is the status of the project? thanks' }),
    });
    const body = (await res.json()) as ChatResponse;
    expect(body.lang).toBe('en');
    expect(body.reply).toContain('Projet Chat');
    expect(body.reply).toContain('tasks');
  });

  it('refuse un message vide ou trop long (validation de schéma)', async () => {
    const empty = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: '' }),
    });
    expect(empty.status).toBe(400);
    const long = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'x'.repeat(2001) }),
    });
    expect(long.status).toBe(400);
  });

  it('exige le token de la ruche', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'coucou' }),
    });
    expect(res.status).toBe(401);
  });

  it('SSE : Accept text/event-stream → done live sans LLM', async () => {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: {
        ...headers,
        accept: 'text/event-stream',
      },
      body: JSON.stringify({ message: 'Ou en est le projet ? merci', stream: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
    const texte = await res.text();
    const lignes = texte
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map(
        (l) => JSON.parse(l.slice(5).trim()) as { type: string; reply?: string; source?: string },
      );
    expect(lignes.length).toBeGreaterThanOrEqual(1);
    const done = lignes.find((l) => l.type === 'done');
    expect(done?.source).toBe('live');
    expect(done?.reply ?? '').toContain('Projet Chat');
  });
});
