import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-atelier-suffisamment-long';

function cfg(dbPath: string) {
  return {
    port: 0,
    host: '127.0.0.1' as const,
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath,
    simulation: true,
  };
}

describe('GET /api/atelier', () => {
  let srv: HiveServer | undefined;

  afterEach(async () => {
    await srv?.stop();
    srv = undefined;
  });

  it('sans jeton : 401', async () => {
    srv = await createServer(cfg(':memory:'));
    const res = await fetch(`${srv.url}/api/atelier`);
    expect(res.status).toBe(401);
  });

  it('avec jeton : l’état, et le défaut est éteint', async () => {
    srv = await createServer(cfg(':memory:'));
    const res = await fetch(`${srv.url}/api/atelier`, {
      headers: { 'x-hive-token': TOKEN },
    });
    expect(res.status).toBe(200);
    const corps = (await res.json()) as { mode: string; actif: boolean };
    expect(corps.mode).toBe('off');
    expect(corps.actif).toBe(false);
  });

  it('POST refusé tant que HIVE_ATELIER=off — on n’allume pas Docker', async () => {
    srv = await createServer(cfg(':memory:'));
    const res = await fetch(`${srv.url}/api/atelier/demarrer`, {
      method: 'POST',
      headers: { 'x-hive-token': TOKEN, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });
});
