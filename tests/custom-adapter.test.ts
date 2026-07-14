// Tests de la connexion multi-IA : adaptateur « commande libre » (HIVE_AGENT_CMD)
// et détection du choix explicite du membre.

import { describe, expect, it } from 'vitest';
import { createCustomAdapter } from '../src/adapters/custom.js';
import { detectAllAgents, detectBestAgent } from '../src/node-client/agent-detect.js';
import type { AdapterContext } from '../src/adapters/index.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-custom-adapter-assez-long';

const ctx = (): AdapterContext => ({
  cwd: process.cwd(),
  env: { PATH: process.env.PATH },
  attempt: 1,
  signal: new AbortController().signal,
  onProgress: () => {},
});

const task = (prompt: string): Task => ({
  id: 't',
  projectId: 'p',
  title: 'T',
  prompt,
  status: 'assigned',
  dependsOn: [],
  assignedNodeId: null,
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 1,
  updatedAt: 1,
});

// La commande vérifie que le prompt lui est bien parvenu (exit 0 si oui).
const CHECK = "process.exit(process.argv[1]==='MARK'?0:1)";

describe('adaptateur commande libre', () => {
  it('substitue le jeton {prompt} par le prompt de la tâche', async () => {
    const a = createCustomAdapter(`node -e ${CHECK} {prompt}`, TOKEN);
    const r = await a.run(task('MARK'), ctx());
    expect(r.success).toBe(true);
  });

  it('ajoute le prompt en dernier argument si pas de jeton {prompt}', async () => {
    const a = createCustomAdapter(`node -e ${CHECK}`, TOKEN);
    const r = await a.run(task('MARK'), ctx());
    expect(r.success).toBe(true);
  });

  it('échec si le prompt n’est pas transmis (garde-fou du test)', async () => {
    // Commande qui ignore le prompt → argv[1] ≠ 'MARK' → exit 1.
    const a = createCustomAdapter(`node -e process.exit(2)`, TOKEN);
    const r = await a.run(task('MARK'), ctx());
    expect(r.success).toBe(false);
  });

  it('exige HIVE_AGENT_CMD (commande vide → erreur)', () => {
    expect(() => createCustomAdapter('', TOKEN)).toThrow();
    expect(() => createCustomAdapter('   ', TOKEN)).toThrow();
  });

  it('refuse un token trivial (contrainte §5.1)', () => {
    expect(() => createCustomAdapter('aider --message {prompt}', 'change-me')).toThrow();
  });
});

describe('détection : commande libre explicite', () => {
  it('detectBestAgent privilégie « custom » quand HIVE_AGENT_CMD est défini', async () => {
    const best = await detectBestAgent({ HIVE_AGENT_CMD: 'aider --yes' } as NodeJS.ProcessEnv);
    expect(best.agent).toBe('custom');
  });

  it('detectAllAgents inclut custom (+ shell) quand HIVE_AGENT_CMD est défini', async () => {
    const all = await detectAllAgents({ HIVE_AGENT_CMD: 'aider' } as NodeJS.ProcessEnv);
    expect(all).toContain('custom');
    expect(all).toContain('shell');
  });

  it('sans HIVE_AGENT_CMD, retombe sur le shell simulé (env de test sans agent réel)', async () => {
    const best = await detectBestAgent({} as NodeJS.ProcessEnv);
    expect(['shell', 'claude-code', 'codex']).toContain(best.agent);
  });
});
