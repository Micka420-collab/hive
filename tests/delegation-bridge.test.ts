import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codexMcpOverrides,
  createDelegationBridge,
  HIVE_DELEGATE_TOOL,
  HIVE_WAIT_TOOL,
  writeClaudeMcpConfig,
  type DelegationBridge,
} from '../src/adapters/delegation-bridge.js';

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

describe('pont MCP de délégation Worker → CLI', () => {
  let tempDir: string | undefined;
  let bridge: DelegationBridge | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;

  afterEach(async () => {
    const runningChild = child;
    child = undefined;
    if (runningChild) {
      if (runningChild.exitCode === null && runningChild.signalCode === null) {
        runningChild.kill('SIGTERM');
        await once(runningChild, 'close');
      }
    }
    await bridge?.close();
    bridge = undefined;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('expose les deux outils, relaie l admission et attend le résultat terminal', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-bridge-'));
    let delegatedChild = '';
    bridge = await createDelegationBridge(
      {
        cwd: tempDir,
        delegate: async (input) => {
          delegatedChild = input.childTaskId;
          return { ok: true, parentTaskId: 'parent', childTaskId: input.childTaskId, depth: 1 };
        },
        waitForDelegationResult: async (childTaskId) => ({
          ok: true,
          parentTaskId: 'parent',
          childTaskId,
          success: true,
          diff: 'diff enfant',
          logs: 'tests verts',
          durationMs: 12,
          resultId: 7,
        }),
      },
      'parent',
    );
    writeClaudeMcpConfig(bridge);
    const claudeConfig = JSON.parse(readFileSync(bridge.configPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const hiveConfig = claudeConfig.mcpServers[bridge.mcpServerName];
    expect(hiveConfig).toBeDefined();
    expect(hiveConfig!.command).toBe(bridge.childCommand);
    expect(hiveConfig!.args).toEqual([...bridge.childArgs]);
    const codexArgs = codexMcpOverrides(bridge);
    expect(codexArgs).toContain(`mcp_servers.${bridge.mcpServerName}.required=true`);
    expect(codexArgs.some((arg) => arg.includes('HIVE_TOKEN='))).toBe(false);
    child = spawn(bridge.childCommand, bridge.childArgs, {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH },
    });

    sendMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    });
    const initialized = await mcpResponseLine(child);
    expect(initialized).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'hive-delegation' },
      },
    });

    sendMcp(child, { jsonrpc: '2.0', method: 'notifications/initialized' });
    sendMcp(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await mcpResponseLine(child);
    const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual([HIVE_DELEGATE_TOOL, HIVE_WAIT_TOOL]);

    sendMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: HIVE_DELEGATE_TOOL,
        arguments: {
          childTaskId: 'child',
          reason: 'revue indépendante',
          title: 'Revue',
          prompt: 'Vérifie le changement',
          durationMs: 0,
          costMicros: 0,
          resourceUnits: 0,
        },
      },
    });
    expect(contentValue(await mcpResponseLine(child))).toMatchObject({
      ok: true,
      childTaskId: 'child',
    });
    expect(delegatedChild).toBe('child');

    sendMcp(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: HIVE_WAIT_TOOL, arguments: { childTaskId: 'child' } },
    });
    expect(contentValue(await mcpResponseLine(child))).toMatchObject({
      ok: true,
      success: true,
      resultId: 7,
    });
  }, 15_000);

  it('refuse une délégation dont le budget ou le texte dépasse les limites', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-bridge-invalid-'));
    bridge = await createDelegationBridge(
      {
        cwd: tempDir,
        delegate: async () => {
          throw new Error('ne doit pas être appelé');
        },
        waitForDelegationResult: async () => {
          throw new Error('ne doit pas être appelé');
        },
      },
      'parent',
    );
    child = spawn(bridge.childCommand, bridge.childArgs, {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH },
    });
    sendMcp(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await mcpResponseLine(child);
    sendMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: HIVE_DELEGATE_TOOL,
        arguments: {
          childTaskId: 'child',
          reason: 'x',
          title: 'x',
          prompt: 'x',
          durationMs: -1,
          costMicros: 0,
          resourceUnits: 1,
        },
      },
    });
    expect(contentValue(await mcpResponseLine(child))).toMatchObject({
      ok: false,
      code: 'arguments_invalid',
    });
  });

  it('nettoie le fichier de configuration et le socket', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-bridge-cleanup-'));
    bridge = await createDelegationBridge(
      {
        cwd: tempDir,
        delegate: async () => ({ ok: false, code: 'x', message: 'x' }),
        waitForDelegationResult: async () => ({ ok: false, code: 'x', message: 'x' }),
      },
      'parent',
    );
    writeClaudeMcpConfig(bridge);
    const configPath = bridge.configPath;
    const endpoint = bridge.endpoint;
    await bridge.close();
    bridge = undefined;
    expect(existsSync(configPath)).toBe(false);
    expect(endpoint.startsWith('tcp://')).toBe(process.platform === 'win32');
  });

  it('borne le diff et les logs avant de les rendre visibles au CLI', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-bridge-bounds-'));
    bridge = await createDelegationBridge(
      {
        cwd: tempDir,
        delegate: async (input) => ({
          ok: true,
          parentTaskId: 'parent',
          childTaskId: input.childTaskId,
          depth: 1,
        }),
        waitForDelegationResult: async (childTaskId) => ({
          ok: true,
          parentTaskId: 'parent',
          childTaskId,
          success: true,
          diff: 'd'.repeat(100_000),
          logs: 'l'.repeat(100_000),
          durationMs: 1,
        }),
      },
      'parent',
    );
    child = spawn(bridge.childCommand, bridge.childArgs, {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH },
    });
    sendMcp(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await mcpResponseLine(child);
    sendMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: HIVE_WAIT_TOOL, arguments: { childTaskId: 'child' } },
    });
    const value = contentValue(await mcpResponseLine(child));
    expect(value).toMatchObject({ ok: true, success: true });
    expect(String(value.diff).length).toBeLessThan(40_000);
    expect(String(value.logs).length).toBeLessThan(40_000);
  }, 15_000);
});
