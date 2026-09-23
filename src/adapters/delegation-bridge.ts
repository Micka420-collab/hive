// Pont MCP éphémère entre un Worker Hive et le CLI lancé par l'adaptateur.
//
// Le CLI est un processus enfant : il ne peut pas recevoir directement les
// callbacks `AdapterContext`. Le pont lui expose deux outils MCP bornés et
// relaie leurs appels vers le Worker parent par un socket local authentifié.
// Le jeton de ce pont est aléatoire, valable pour une seule tentative et n'est
// jamais le HIVE_TOKEN.

import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import net, { type Server, type Socket } from 'node:net';
import path from 'node:path';
import { MONTAGE } from '../node-client/isolement.js';
import type {
  AdapterContext,
  WorkerDelegationInput,
  WorkerDelegationOutcome,
  WorkerDelegationResult,
} from './index.js';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 512 * 1024;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_REASON_LENGTH = 1_000;
const MAX_TITLE_LENGTH = 160;
const MAX_PROMPT_LENGTH = 16_000;
const MAX_TEXT_LENGTH = 8_192;
const MAX_RESULT_TEXT = 32 * 1024;

export const HIVE_DELEGATE_TOOL = 'hive_delegate';
export const HIVE_WAIT_TOOL = 'hive_wait_for_delegation_result';

type BridgeSuccess = {
  type: 'result';
  id: string;
  ok: true;
  value: WorkerDelegationOutcome | WorkerDelegationResult;
};

type BridgeFailure = {
  type: 'result';
  id: string;
  ok: false;
  code: string;
  message: string;
};

type BridgeHello = {
  type: 'hello';
  protocol: typeof PROTOCOL_VERSION;
  token: string;
  parentTaskId: string;
};

type BridgeCall =
  | {
      type: 'call';
      id: string;
      operation: 'delegate';
      input: WorkerDelegationInput;
    }
  | {
      type: 'call';
      id: string;
      operation: 'wait';
      childTaskId: string;
    };

type BridgeMessage = BridgeHello | BridgeCall;

interface BridgeConnectionState {
  authorized: boolean;
  inFlight: Set<string>;
  buffer: string;
}

export interface DelegationBridge {
  /** Chemin lu par le parent (hôte) pour le socket Unix ou le pipe Windows. */
  readonly endpoint: string;
  /** Chemin que le CLI voit depuis son bac éventuel. */
  readonly childEndpoint: string;
  readonly token: string;
  readonly parentTaskId: string;
  /** Nom unique pour éviter de fusionner avec un MCP Codex existant. */
  readonly mcpServerName: string;
  /** Commande MCP stdio : `node --eval <pont> <endpoint> <token> <parent>`. */
  readonly childCommand: string;
  readonly childArgs: readonly string[];
  /** Chemin de configuration MCP vu par le CLI. */
  readonly childConfigPath: string;
  /** Chemin hôte du même fichier, utilisé pour l'écrire et le supprimer. */
  readonly configPath: string;
  close(): Promise<void>;
}

/** Source autonome exécutée par le `node --eval` du serveur MCP stdio. */
export const DELEGATION_BRIDGE_SOURCE = String.raw`
const net = require('node:net');

// Le serveur MCP local n'appelle aucun fournisseur et ne reçoit donc aucun
// secret Hive ou de modèle, même si le CLI parent a dû les garder dans son env.
for (const secret of [
  'HIVE_TOKEN', 'HIVE_JWT_SECRET', 'HIVE_INVITE', 'HIVE_GITHUB_TOKEN',
  'HIVE_WEBHOOK_SECRET', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'XAI_API_KEY', 'CURSOR_API_KEY',
  'QUEEN_BEE_API_KEY', 'OPENROUTER_API_KEY',
]) delete process.env[secret];

const endpoint = process.argv[1];
const token = process.argv[2];
const parentTaskId = process.argv[3];
const MAX_FRAME_BYTES = 524288;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_REASON_LENGTH = 1000;
const MAX_TITLE_LENGTH = 160;
const MAX_PROMPT_LENGTH = 16000;
const MAX_TEXT_LENGTH = 8192;
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const HIVE_DELEGATE_TOOL = 'hive_delegate';
const HIVE_WAIT_TOOL = 'hive_wait_for_delegation_result';

if (!endpoint || !token || !parentTaskId) {
  process.exitCode = 2;
  process.stderr.write('hive delegation bridge: arguments manquants\n');
} else {
  let parentBuffer = '';
  let mcpBuffer = '';
  let parentSocket;
  let parentReadyResolve;
  let parentReadyReject;
  const parentReady = new Promise((resolve, reject) => {
    parentReadyResolve = resolve;
    parentReadyReject = reject;
  });
  const pending = new Map();
  let nextId = 0;

  const sendMcp = (value) => {
    process.stdout.write(JSON.stringify(value) + '\n');
  };

  const sendParent = (value) => {
    if (!parentSocket || parentSocket.destroyed) {
      throw new Error('pont Hive indisponible');
    }
    parentSocket.write(JSON.stringify(value) + '\n');
  };

  const failPending = (message) => {
    for (const pendingCall of pending.values()) pendingCall.reject(new Error(message));
    pending.clear();
    if (parentReadyReject) parentReadyReject(new Error(message));
  };

  const consumeParentLine = (line) => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value && value.type === 'hello' && value.ok === true) {
      if (parentReadyResolve) parentReadyResolve();
      return;
    }
    if (!value || value.type !== 'result' || typeof value.id !== 'string') return;
    const call = pending.get(value.id);
    if (!call) return;
    pending.delete(value.id);
    if (value.ok === true) call.resolve(value.value);
    else call.resolve({ ok: false, code: String(value.code || 'bridge_error'), message: String(value.message || 'Erreur du pont') });
  };

  const consumeParent = (chunk) => {
    parentBuffer += chunk.toString();
    if (Buffer.byteLength(parentBuffer, 'utf8') > MAX_FRAME_BYTES * 2) {
      failPending('réponse du pont trop volumineuse');
      parentSocket.destroy();
      return;
    }
    let index;
    while ((index = parentBuffer.indexOf('\n')) >= 0) {
      const line = parentBuffer.slice(0, index);
      parentBuffer = parentBuffer.slice(index + 1);
      if (Buffer.byteLength(line, 'utf8') <= MAX_FRAME_BYTES) consumeParentLine(line);
    }
  };

  const connectParent = () => {
    const options = endpoint.startsWith('tcp://')
      ? (() => { const parsed = new URL(endpoint); return { host: parsed.hostname, port: Number(parsed.port) }; })()
      : endpoint;
    parentSocket = net.connect(options);
    parentSocket.setEncoding('utf8');
    parentSocket.on('data', consumeParent);
    parentSocket.on('error', (error) => failPending(error.message));
    parentSocket.on('close', () => failPending('connexion du pont fermée'));
    parentSocket.on('connect', () => {
      sendParent({ type: 'hello', protocol: 1, token, parentTaskId });
    });
  };

  const callParent = (operation, payload) => {
    const id = 'mcp-' + (++nextId);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { sendParent({ type: 'call', id, operation, ...payload }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  };

  const text = (value, max = MAX_TEXT_LENGTH) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
  const id = (value) => text(value);

  const definitions = [
    {
      name: HIVE_DELEGATE_TOOL,
      description: 'Délègue une sous-tâche bornée à un Worker Hive et renvoie son admission.',
      inputSchema: {
        type: 'object',
        properties: {
          childTaskId: { type: 'string', description: 'Identifiant stable de la sous-tâche.' },
          reason: { type: 'string', description: 'Raison opérationnelle de la délégation.' },
          title: { type: 'string', description: 'Titre court de la sous-tâche.' },
          prompt: { type: 'string', description: 'Instruction de la sous-tâche.' },
          durationMs: { type: 'number', description: 'Budget de durée en millisecondes.' },
          costMicros: { type: 'number', description: 'Budget de coût en micro-unités.' },
          resourceUnits: { type: 'number', description: 'Budget de ressources.' },
          preferredAgent: { type: 'string', description: 'Agent préféré, si pertinent.' },
          preferredModel: { type: 'string', description: 'Modèle préféré, si pertinent.' },
        },
        required: ['childTaskId', 'reason', 'title', 'prompt', 'durationMs', 'costMicros', 'resourceUnits'],
      },
    },
    {
      name: HIVE_WAIT_TOOL,
      description: 'Attend le résultat terminal réel d’une sous-tâche Hive admise.',
      inputSchema: {
        type: 'object',
        properties: { childTaskId: { type: 'string', description: 'Identifiant de la sous-tâche.' } },
        required: ['childTaskId'],
      },
    },
  ];

  const result = (requestId, value, isError) => ({
    jsonrpc: '2.0',
    id: requestId,
    result: { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) },
  });

  const callTool = async (requestId, name, args) => {
    if (name === HIVE_DELEGATE_TOOL) {
      if (!args || typeof args !== 'object') return result(requestId, { ok: false, code: 'arguments_invalid', message: 'arguments invalides' }, true);
      const input = {
        childTaskId: id(args.childTaskId), reason: text(args.reason, MAX_REASON_LENGTH), title: text(args.title, MAX_TITLE_LENGTH), prompt: text(args.prompt, MAX_PROMPT_LENGTH),
        durationMs: args.durationMs, costMicros: args.costMicros, resourceUnits: args.resourceUnits,
        ...(args.preferredAgent === undefined ? {} : { preferredAgent: text(args.preferredAgent, MAX_NAME_LENGTH) }),
        ...(args.preferredModel === undefined ? {} : { preferredModel: text(args.preferredModel, MAX_NAME_LENGTH) }),
      };
      if (!input.childTaskId || !input.reason || !input.title || !input.prompt ||
          !Number.isSafeInteger(input.durationMs) || input.durationMs < 0 ||
          !Number.isSafeInteger(input.costMicros) || input.costMicros < 0 ||
          !Number.isSafeInteger(input.resourceUnits) || input.resourceUnits < 0 ||
          (args.preferredAgent !== undefined && !input.preferredAgent) ||
          (args.preferredModel !== undefined && !input.preferredModel)) {
        return result(requestId, { ok: false, code: 'arguments_invalid', message: 'arguments de délégation invalides' }, true);
      }
      try {
        const value = await callParent('delegate', { input });
        return result(requestId, value, value && value.ok === false);
      } catch (error) {
        return result(
          requestId,
          {
            ok: false,
            code: 'bridge_error',
            message: error instanceof Error ? error.message : String(error),
          },
          true,
        );
      }
    }
    if (name === HIVE_WAIT_TOOL) {
      const childTaskId = id(args && args.childTaskId);
      if (!childTaskId) return result(requestId, { ok: false, code: 'arguments_invalid', message: 'childTaskId invalide' }, true);
      try {
        const value = await callParent('wait', { childTaskId });
        return result(requestId, value, value && value.ok === false);
      } catch (error) {
        return result(
          requestId,
          {
            ok: false,
            code: 'bridge_error',
            message: error instanceof Error ? error.message : String(error),
          },
          true,
        );
      }
    }
    return { jsonrpc: '2.0', id: requestId, error: { code: -32601, message: 'outil MCP inconnu' } };
  };

  const consumeMcpLine = async (line) => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (!request || request.jsonrpc !== '2.0' || request.id === undefined) {
      if (request && request.method === 'notifications/initialized') return;
      return;
    }
    try { await parentReady; } catch (error) {
      sendMcp({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message } });
      return;
    }
    if (request.method === 'initialize') {
      const requested = request.params && request.params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requested)
        ? requested
        : '2024-11-05';
      sendMcp({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'hive-delegation', version: '1' },
      } });
      return;
    }
    if (request.method === 'ping') { sendMcp({ jsonrpc: '2.0', id: request.id, result: {} }); return; }
    if (request.method === 'tools/list') { sendMcp({ jsonrpc: '2.0', id: request.id, result: { tools: definitions } }); return; }
    if (request.method === 'tools/call') {
      const params = request.params || {};
      sendMcp(await callTool(request.id, params.name, params.arguments || {}));
    } else {
      sendMcp({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'méthode MCP inconnue' } });
    }
  };

  process.stdin.on('data', (chunk) => {
    mcpBuffer += chunk.toString();
    if (Buffer.byteLength(mcpBuffer, 'utf8') > MAX_FRAME_BYTES * 2) {
      process.exitCode = 2;
      process.stdin.destroy();
      return;
    }
    let index;
    while ((index = mcpBuffer.indexOf('\n')) >= 0) {
      const line = mcpBuffer.slice(0, index);
      mcpBuffer = mcpBuffer.slice(index + 1);
      if (Buffer.byteLength(line, 'utf8') <= MAX_FRAME_BYTES) void consumeMcpLine(line);
    }
  });
  process.stdin.on('close', () => { if (parentSocket) parentSocket.destroy(); });
  connectParent();
}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function boundedMessage(value: unknown): string {
  const message = typeof value === 'string' && value.length > 0 ? value : 'erreur du pont';
  return message.slice(0, MAX_TEXT_LENGTH);
}

function boundedResultText(value: string): string {
  if (value.length <= MAX_RESULT_TEXT) return value;
  return `${value.slice(0, MAX_RESULT_TEXT)}\n[hive] résultat tronqué par le pont MCP`;
}

function boundedDelegationValue(
  value: WorkerDelegationOutcome | WorkerDelegationResult,
): WorkerDelegationOutcome | WorkerDelegationResult {
  if (value.ok !== true || !('success' in value)) return value;
  return {
    ...value,
    diff: boundedResultText(value.diff),
    logs: boundedResultText(value.logs),
  };
}

function finiteBudget(value: unknown, allowZero = false): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
  );
}

function validDelegationInput(value: unknown): value is WorkerDelegationInput {
  if (!isRecord(value)) return false;
  if (
    !text(value.childTaskId, MAX_ID_LENGTH) ||
    !text(value.reason, MAX_REASON_LENGTH) ||
    !text(value.title, MAX_TITLE_LENGTH) ||
    !text(value.prompt, MAX_PROMPT_LENGTH) ||
    !finiteBudget(value.durationMs, true) ||
    !finiteBudget(value.costMicros, true) ||
    !finiteBudget(value.resourceUnits, true)
  ) {
    return false;
  }
  return (
    (value.preferredAgent === undefined || text(value.preferredAgent, MAX_NAME_LENGTH)) &&
    (value.preferredModel === undefined || text(value.preferredModel, MAX_NAME_LENGTH))
  );
}

function jsonFrame(value: unknown): string {
  const frame = JSON.stringify(value);
  if (Buffer.byteLength(frame, 'utf8') > MAX_FRAME_BYTES) {
    throw new Error('trame du pont trop volumineuse');
  }
  return `${frame}\n`;
}

function endpointForChild(hostEndpoint: string, sandboxed: boolean): string {
  if (!sandboxed || hostEndpoint.startsWith('tcp://')) return hostEndpoint;
  return path.join(MONTAGE, '.hive', path.basename(hostEndpoint));
}

function mcpConfig(
  handle: Pick<DelegationBridge, 'childCommand' | 'childArgs' | 'mcpServerName'>,
): Record<string, unknown> {
  return {
    mcpServers: {
      [handle.mcpServerName]: {
        type: 'stdio',
        command: handle.childCommand,
        args: [...handle.childArgs],
      },
    },
  };
}

/** Écrit le fichier Claude dans le workspace, puis sera supprimé avec le pont. */
export function writeClaudeMcpConfig(bridge: DelegationBridge): void {
  writeFileSync(bridge.configPath, JSON.stringify(mcpConfig(bridge), null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/** Overrides TOML `-c` consommés par Codex pour le même serveur stdio. */
export function codexMcpOverrides(bridge: DelegationBridge): string[] {
  const toml = (value: unknown): string => JSON.stringify(value);
  const prefix = `mcp_servers.${bridge.mcpServerName}`;
  return [
    '-c',
    `${prefix}.command=${toml(bridge.childCommand)}`,
    '-c',
    `${prefix}.args=${toml([...bridge.childArgs])}`,
    '-c',
    `${prefix}.required=true`,
    '-c',
    `${prefix}.enabled=true`,
    '-c',
    `${prefix}.enabled_tools=${toml([HIVE_DELEGATE_TOOL, HIVE_WAIT_TOOL])}`,
  ];
}

/**
 * Démarre le serveur hôte du pont. Le CLI ne reçoit qu'un endpoint local, un
 * jeton éphémère et l'identifiant exact du parent ; HIVE_TOKEN reste absent.
 */
export async function createDelegationBridge(
  ctx: Pick<AdapterContext, 'cwd' | 'bac' | 'delegate' | 'waitForDelegationResult'>,
  parentTaskId: string,
): Promise<DelegationBridge> {
  if (!text(parentTaskId, MAX_ID_LENGTH)) throw new Error('identifiant parent invalide');
  if (!ctx.delegate || !ctx.waitForDelegationResult) {
    throw new Error('capacités de délégation absentes');
  }
  const delegate = ctx.delegate;
  const waitForDelegationResult = ctx.waitForDelegationResult;
  if (process.platform === 'win32' && ctx.bac) {
    throw new Error('pont MCP sandboxé indisponible sous Windows : transport local non partagé');
  }

  const bridgeId = randomUUID();
  const dir = path.join(ctx.cwd, '.hive');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const socketName = `d-${randomBytes(8).toString('hex')}.sock`;
  const mcpServerName = `hive_${randomBytes(8).toString('hex')}`;
  let endpoint = '';
  let childEndpoint: string;
  const token = randomBytes(24).toString('base64url');
  const sockets = new Set<Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const state: BridgeConnectionState = { authorized: false, inFlight: new Set(), buffer: '' };
    const send = (value: unknown): void => {
      try {
        socket.write(jsonFrame(value));
      } catch {
        socket.destroy();
      }
    };
    const reject = (id: string, code: string, message: string): void =>
      send({
        type: 'result',
        id,
        ok: false,
        code,
        message: boundedMessage(message),
      } satisfies BridgeFailure);
    const onMessage = async (message: BridgeMessage): Promise<void> => {
      if (!state.authorized) {
        if (
          message.type !== 'hello' ||
          message.protocol !== PROTOCOL_VERSION ||
          message.token !== token ||
          message.parentTaskId !== parentTaskId
        ) {
          socket.destroy();
          return;
        }
        state.authorized = true;
        send({ type: 'hello', ok: true, protocol: PROTOCOL_VERSION });
        return;
      }
      if (message.type !== 'call' || !text(message.id, MAX_ID_LENGTH)) {
        socket.destroy();
        return;
      }
      if (state.inFlight.has(message.id)) {
        reject(message.id, 'requete_dupliquee', 'identifiant de requête déjà en cours');
        return;
      }
      if (state.inFlight.size >= 8) {
        reject(message.id, 'pont_sature', 'trop de requêtes simultanées');
        return;
      }
      state.inFlight.add(message.id);
      try {
        if (message.operation === 'delegate') {
          if (!validDelegationInput(message.input)) {
            reject(message.id, 'arguments_invalides', 'arguments de délégation invalides');
            return;
          }
          const value = await delegate(message.input);
          send({
            type: 'result',
            id: message.id,
            ok: true,
            value: boundedDelegationValue(value),
          } satisfies BridgeSuccess);
        } else if (message.operation === 'wait' && text(message.childTaskId, MAX_ID_LENGTH)) {
          const value = await waitForDelegationResult(message.childTaskId);
          send({
            type: 'result',
            id: message.id,
            ok: true,
            value: boundedDelegationValue(value),
          } satisfies BridgeSuccess);
        } else {
          reject(message.id, 'operation_invalide', 'opération du pont invalide');
        }
      } catch (error) {
        reject(
          message.id,
          'bridge_error',
          boundedMessage(error instanceof Error ? error.message : error),
        );
      } finally {
        state.inFlight.delete(message.id);
      }
    };
    socket.on('data', (chunk: Buffer) => {
      state.buffer += chunk.toString('utf8');
      if (Buffer.byteLength(state.buffer, 'utf8') > MAX_FRAME_BYTES * 2) {
        socket.destroy();
        return;
      }
      let index: number;
      while ((index = state.buffer.indexOf('\n')) >= 0) {
        const line = state.buffer.slice(0, index);
        state.buffer = state.buffer.slice(index + 1);
        if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
          socket.destroy();
          return;
        }
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          socket.destroy();
          return;
        }
        if (isRecord(message)) void onMessage(message as unknown as BridgeMessage);
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });

  const closeServer = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    if (endpoint && !endpoint.startsWith('tcp://')) rmSync(endpoint, { force: true });
  };

  try {
    if (process.platform === 'win32') {
      // Bind port 0 and publish the assigned port. Probing then binding would
      // leave a race where another local process can squat on the endpoint.
      await listen(server, { host: '127.0.0.1', port: 0 });
      const address = server.address();
      if (!address || typeof address === 'string' || !address.port) {
        throw new Error('port local indisponible pour le pont MCP');
      }
      endpoint = `tcp://127.0.0.1:${address.port}`;
      childEndpoint = endpoint;
    } else {
      endpoint = path.join(dir, socketName);
      if (endpoint.length > 100) throw new Error('chemin du socket MCP trop long');
      rmSync(endpoint, { force: true });
      await listen(server, endpoint);
      chmodSync(endpoint, 0o600);
      childEndpoint = endpointForChild(endpoint, Boolean(ctx.bac));
    }
  } catch (error) {
    await closeServer();
    throw error;
  }

  const childCommand = ctx.bac ? 'node' : process.execPath;
  const childArgs = ['--eval', DELEGATION_BRIDGE_SOURCE, childEndpoint, token, parentTaskId];
  const childConfigPath = path.join(ctx.bac ? MONTAGE : ctx.cwd, '.hive', `mcp-${bridgeId}.json`);
  const configPath = path.join(dir, `mcp-${bridgeId}.json`);

  return {
    endpoint,
    childEndpoint,
    token,
    parentTaskId,
    mcpServerName,
    childCommand,
    childArgs,
    childConfigPath,
    configPath,
    close: async () => {
      await closeServer();
      rmSync(configPath, { force: true });
      // Les fichiers temporaires restent dans le workspace mais sont toujours
      // supprimés avant que le nœud ne calcule son diff.
    },
  };
}

function listen(server: Server, options: net.ListenOptions | string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    if (typeof options === 'string') server.listen(options);
    else server.listen(options);
  });
}
