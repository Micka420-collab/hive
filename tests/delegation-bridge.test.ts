import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  codexMcpOverrides,
  createDelegationBridge,
  definitionsOutilsDelegation,
  envDuPont,
  HIVE_APPROVE_TOOL,
  HIVE_DELEGATE_TOOL,
  HIVE_WAIT_TOOL,
  writeClaudeMcpConfig,
  type DelegationBridge,
} from '../src/adapters/delegation-bridge.js';
import { fournisseurParNom } from '../src/node-client/isolement.js';
import { RendezVousPont } from '../src/node-client/rendez-vous-pont.js';
import { LIMITES_DELEGATION_DEFAUT } from '../src/shared/limites-delegation.js';

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
  // Le rendez-vous d'un nœud, comme `HiveNodeClient` le fournit à l'adaptateur.
  let rendezVous = new RendezVousPont();

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
    rendezVous.fermer();
    rendezVous = new RendezVousPont();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('expose les trois outils, relaie l admission et attend le résultat terminal', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-bridge-'));
    let delegatedChild = '';
    bridge = await createDelegationBridge(
      {
        rendezVous,
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
    expect(tools.map((tool) => tool.name)).toEqual([
      HIVE_DELEGATE_TOOL,
      HIVE_WAIT_TOOL,
      HIVE_APPROVE_TOOL,
    ]);
    // Le serveur MCP autonome sert la définition canonique, octet pour octet :
    // le texte que lit le modèle ne peut pas dériver des bornes appliquées.
    expect(tools).toEqual(definitionsOutilsDelegation());

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
          costMicros: 1,
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
        rendezVous,
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
      // Le champ fautif, nommé : « arguments invalides » ne disait pas lequel.
      message: expect.stringContaining('durationMs'),
    });
    // Au-delà du plafond que l'outil annonce : refusé ICI, borne nommée — au
    // guichet du nœud, ce n'était plus qu'une « demande mal formée ».
    sendMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: HIVE_DELEGATE_TOOL,
        arguments: {
          childTaskId: 'child',
          reason: 'x',
          title: 'x',
          prompt: 'x',
          durationMs: 0,
          costMicros: LIMITES_DELEGATION_DEFAUT.maxCostMicros + 1,
          resourceUnits: 1,
        },
      },
    });
    expect(contentValue(await mcpResponseLine(child))).toMatchObject({
      ok: false,
      code: 'arguments_invalid',
      message: expect.stringContaining(
        `costMicros : entier de 1 à ${LIMITES_DELEGATION_DEFAUT.maxCostMicros}`,
      ),
    });
  });

  it('l’outil dit ses bornes, le format de l’identifiant et ce que valent les préférences', () => {
    const L = LIMITES_DELEGATION_DEFAUT;
    const [delegue] = definitionsOutilsDelegation();
    const schema = delegue!.inputSchema as {
      properties: Record<string, { pattern?: string; maximum?: number; description: string }>;
    };
    for (const borne of [
      `au plus ${L.maxDepth} niveaux`,
      `${L.maxChildrenPerParent} enfants par parent`,
      `${L.maxDescendantsPerRoot} descendants par racine`,
      `durée ≤ ${L.maxDurationMs} ms`,
      `coût ≤ ${L.maxCostMicros} micro-USD`,
      `ressources ≤ ${L.maxResourceUnits} unités (compte abstrait`,
      'CUMULÉS par racine',
    ]) {
      expect(delegue!.description).toContain(borne);
    }
    expect(schema.properties.childTaskId!.pattern).toBe('^[A-Za-z0-9_-]{1,64}$');
    expect(schema.properties.durationMs!.maximum).toBe(L.maxDurationMs);
    expect(schema.properties.costMicros!.description).toContain('micro-USD');
    expect(schema.properties.preferredModel!.description).toContain('départage seulement');
  });

  it('vit dans le rendez-vous privé du nœud, et le quitte sans rien laisser', async () => {
    bridge = await createDelegationBridge(
      {
        rendezVous,
        delegate: async () => ({ ok: false, code: 'x', message: 'x' }),
        waitForDelegationResult: async () => ({ ok: false, code: 'x', message: 'x' }),
      },
      'parent',
    );
    writeClaudeMcpConfig(bridge);
    const { configPath, dossier, endpoint } = bridge;
    // Sous le dossier temporaire du système, jamais sous le répertoire d'une
    // tâche : c'est ce qui garde le socket sous la limite de `sun_path`.
    expect(dossier.startsWith(os.tmpdir())).toBe(true);
    expect(path.dirname(configPath)).toBe(dossier);
    if (process.platform === 'win32') {
      // Un pipe nommé, pas un port TCP ouvert à tout le poste.
      expect(endpoint.startsWith('\\\\.\\pipe\\hive-pont-')).toBe(true);
    } else {
      expect(path.dirname(endpoint)).toBe(dossier);
      expect(Buffer.byteLength(endpoint)).toBeLessThanOrEqual(
        process.platform === 'linux' ? 108 : 104,
      );
      // Privé : ni le dossier ni le socket ne s'ouvrent aux autres comptes.
      expect(statSync(dossier).mode & 0o777).toBe(0o700);
      expect(statSync(endpoint).mode & 0o777).toBe(0o600);
    }
    await bridge.close();
    bridge = undefined;
    expect(existsSync(dossier), 'socket et configuration partent avec le pont').toBe(false);
  });

  // Sous Windows, aucun bac ne reçoit de pont (`raisonPontMcpDansBac`).
  it.skipIf(process.platform === 'win32')(
    'dans un bac, le CLI atteint le pont par son montage, jamais par un chemin de l’hôte',
    async () => {
      bridge = await createDelegationBridge(
        {
          rendezVous,
          bac: {
            fournisseur: fournisseurParNom('bubblewrap')!,
            image: 'sans objet',
            variables: [],
          },
          delegate: async () => ({ ok: false, code: 'x', message: 'x' }),
          waitForDelegationResult: async () => ({ ok: false, code: 'x', message: 'x' }),
        },
        'parent',
      );
      expect(bridge.childEndpoint).toBe('/hive/pont/s');
      expect(bridge.childConfigPath).toBe('/hive/pont/mcp.json');
      expect(bridge.childCommand).toBe('node');
      expect(bridge.childArgs).toContain('/hive/pont/s');
      expect(bridge.childArgs.join(' ')).not.toContain(os.tmpdir());
    },
  );

  it('borne le diff et les logs avant de les rendre visibles au CLI', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'hive-bridge-bounds-'));
    bridge = await createDelegationBridge(
      {
        rendezVous,
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

// ─── DANS L'APPLICATION DE BUREAU, LE PONT REÇOIT LE MODE NODE ───────────────
//
// `process.execPath` y est Electron (ADR 0013 § 2) : sans
// `ELECTRON_RUN_AS_NODE=1` dans la configuration MCP, l'agent qui démarre le
// pont ouvrirait une seconde fenêtre de l'app au lieu d'un serveur MCP.
describe('le pont lancé par un binaire Electron', () => {
  const versionsElectron = { ...process.versions, electron: '44.4.5' } as NodeJS.ProcessVersions;
  const versionsNode = {
    ...process.versions,
    electron: undefined,
  } as unknown as NodeJS.ProcessVersions;

  it('Electron hors du bac : le mode Node est posé ; Node, ou le bac (son `node`) : rien', () => {
    expect(envDuPont(versionsElectron, false)).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(envDuPont(versionsElectron, true)).toBeUndefined();
    expect(envDuPont(versionsNode, false)).toBeUndefined();
  });

  it('la variable atteint les DEUX configurations — Claude (`env`) et Codex (clé pointée TOML)', () => {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-pont-electron-'));
    try {
      const pont = {
        mcpServerName: 'hive_x',
        childCommand: '/opt/Hive/hive',
        childArgs: ['--eval', 'source'],
        childEnv: { ELECTRON_RUN_AS_NODE: '1' },
        configPath: path.join(dossier, 'mcp.json'),
      } as unknown as DelegationBridge;
      writeClaudeMcpConfig(pont);
      const config = JSON.parse(readFileSync(pont.configPath, 'utf8')) as {
        mcpServers: Record<string, { env?: Record<string, string> }>;
      };
      expect(config.mcpServers.hive_x?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
      // `-c` lit la valeur en TOML : une clé pointée par variable, jamais un
      // objet JSON (qui y serait une simple chaîne). Relu tel quel par
      // `codex mcp list --json` 0.156 : `"env": { "ELECTRON_RUN_AS_NODE": "1" }`.
      expect(codexMcpOverrides(pont)).toEqual(
        expect.arrayContaining(['-c', 'mcp_servers.hive_x.env.ELECTRON_RUN_AS_NODE="1"']),
      );
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('hors d’Electron, les configurations restent celles d’avant : aucune clé `env`', () => {
    const pont = {
      mcpServerName: 'hive_y',
      childCommand: process.execPath,
      childArgs: [],
    } as unknown as DelegationBridge;
    expect(codexMcpOverrides(pont).some((a) => a.includes('.env.'))).toBe(false);
  });
});
