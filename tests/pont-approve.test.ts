// L'outil MCP d'approbation (G12) — le VRAI serveur enfant du pont, dialogué en
// JSON-RPC brut comme le fait le CLI, et la capacité `decideAction` côté hôte.
// Fermé par défaut : toute panne, absence ou malformation rend un DENY dit.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDelegationBridge,
  definitionsOutilsDelegation,
  HIVE_APPROVE_TOOL,
  type DelegationBridge,
} from '../src/adapters/delegation-bridge.js';
import { RendezVousPont } from '../src/node-client/rendez-vous-pont.js';
import type { ActionProposee, DecisionAction } from '../src/shared/politique-actions.js';

function mcpResponseLine(child: ChildProcessWithoutNullStreams): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      child.stdout.off('data', onData);
      try {
        resolve(JSON.parse(line) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    };
    child.stdout.on('data', onData);
  });
}

function sendMcp(child: ChildProcessWithoutNullStreams, value: unknown): void {
  child.stdin.write(`${JSON.stringify(value)}\n`);
}

function contentValue(response: Record<string, unknown>): Record<string, unknown> {
  const result = response.result as { content?: Array<{ text?: string }> };
  return JSON.parse(result.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

const delegationInerte = {
  delegate: async () => ({ ok: false as const, code: 'x', message: 'x' }),
  waitForDelegationResult: async () => ({ ok: false as const, code: 'x', message: 'x' }),
};

describe('pont MCP — outil hive_approve_action (G12)', () => {
  let tempDir: string | undefined;
  let bridge: DelegationBridge | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  let rendezVous = new RendezVousPont();

  afterEach(async () => {
    const runningChild = child;
    child = undefined;
    if (runningChild && runningChild.exitCode === null && runningChild.signalCode === null) {
      runningChild.kill('SIGTERM');
      await once(runningChild, 'close');
    }
    await bridge?.close();
    bridge = undefined;
    rendezVous.fermer();
    rendezVous = new RendezVousPont();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function demarrer(decideAction?: (a: ActionProposee) => Promise<DecisionAction>) {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-approve-'));
    bridge = await createDelegationBridge(
      { rendezVous, ...delegationInerte, ...(decideAction ? { decideAction } : {}) },
      'parent',
    );
    child = spawn(bridge.childCommand, bridge.childArgs, {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH },
    });
    sendMcp(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await mcpResponseLine(child);
    return child;
  }

  function approuver(cli: ChildProcessWithoutNullStreams, id: number, args: unknown): void {
    sendMcp(cli, {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: HIVE_APPROVE_TOOL, arguments: args },
    });
  }

  it('la définition annonce l’outil et son contrat {behavior}', () => {
    const defs = definitionsOutilsDelegation();
    const approve = defs.find((d) => d.name === HIVE_APPROVE_TOOL);
    expect(approve).toBeDefined();
    expect(approve!.description).toContain('réquisition');
    expect(approve!.description).toContain('behavior');
    expect((approve!.inputSchema as { required: string[] }).required).toEqual([
      'tool_name',
      'input',
    ]);
  });

  it('un git push proposé atteint decideAction, et le deny revient TEL QUEL au CLI', async () => {
    const vues: ActionProposee[] = [];
    const cli = await demarrer(async (action) => {
      vues.push(action);
      return { behavior: 'deny', message: 'réquisition refusée depuis la Chambre' };
    });
    approuver(cli, 2, { tool_name: 'Bash', input: { command: 'git push origin main' } });
    const reponse = await mcpResponseLine(cli);
    // Un deny est une DÉCISION valide, pas une erreur d'outil : le CLI doit la lire.
    expect((reponse.result as { isError?: boolean }).isError).toBeUndefined();
    expect(contentValue(reponse)).toEqual({
      behavior: 'deny',
      message: 'réquisition refusée depuis la Chambre',
    });
    expect(vues).toEqual([{ toolName: 'Bash', input: { command: 'git push origin main' } }]);
  }, 15_000);

  it('un allow rend updatedInput tel que le nœud l’a décidé', async () => {
    const cli = await demarrer(async (action) => ({
      behavior: 'allow',
      updatedInput: action.input,
    }));
    approuver(cli, 2, { tool_name: 'Bash', input: { command: 'npm run test' } });
    expect(contentValue(await mcpResponseLine(cli))).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'npm run test' },
    });
  }, 15_000);

  it('sans capacité de décision sur le nœud : FERMÉ — deny dit, jamais un allow implicite', async () => {
    const cli = await demarrer(undefined);
    approuver(cli, 2, { tool_name: 'Bash', input: { command: 'git push' } });
    expect(contentValue(await mcpResponseLine(cli))).toEqual({
      behavior: 'deny',
      message: 'capacité de décision absente sur ce nœud',
    });
  }, 15_000);

  it('arguments mal formés : deny qui NOMME ce qui manque, sans toucher au parent', async () => {
    const cli = await demarrer(async () => {
      throw new Error('ne doit pas être appelé');
    });
    approuver(cli, 2, { tool_name: 'Bash' });
    const sansInput = contentValue(await mcpResponseLine(cli));
    expect(sansInput.behavior).toBe('deny');
    expect(String(sansInput.message)).toContain('input');
    approuver(cli, 3, { input: { command: 'x' } });
    expect(contentValue(await mcpResponseLine(cli)).behavior).toBe('deny');
  }, 15_000);

  it('une décision illisible du nœud devient un deny — jamais une trame cassée', async () => {
    const cli = await demarrer(async () => ({ behavior: 'allow' }) as unknown as DecisionAction);
    approuver(cli, 2, { tool_name: 'Bash', input: { command: 'x' } });
    expect(contentValue(await mcpResponseLine(cli))).toEqual({
      behavior: 'deny',
      message: 'décision du nœud illisible — refus par défaut',
    });
  }, 15_000);
});
