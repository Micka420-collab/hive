// Pont MCP éphémère entre un Worker Hive et le CLI lancé par l'adaptateur.
//
// Le CLI est un processus enfant : il ne peut pas recevoir directement les
// callbacks `AdapterContext`. Le pont lui expose trois outils MCP bornés et
// relaie leurs appels vers le Worker parent par un socket local authentifié.
// Le jeton de ce pont est aléatoire, valable pour une seule tentative et n'est
// jamais le HIVE_TOKEN.
//
// Le socket et la configuration MCP vivent dans le rendez-vous privé du NŒUD
// (`rendez-vous-pont.ts`), sous le dossier temporaire du système — jamais dans
// le répertoire de la tâche, dont la profondeur dépassait la limite d'un
// chemin de socket Unix et faisait échouer chaque tâche Claude Code ou Codex.

import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import net, { type Server, type Socket } from 'node:net';
import path from 'node:path';
import { SECRETS_JAMAIS_SONDES } from '../node-client/agent-detect.js';
import { MONTAGE_PONT } from '../node-client/isolement.js';
import { CheminSocketTropLong } from '../node-client/rendez-vous-pont.js';
import {
  COUT_MIN_MICROS,
  COUT_UNE_REPONSE_MICROS,
  FORMAT_ID_ENFANT,
  LIMITES_DELEGATION_DEFAUT,
} from '../shared/limites-delegation.js';
import type { DecisionAction } from '../shared/politique-actions.js';
import type { SubAgent } from '../shared/types.js';
import type {
  AdapterContext,
  AdapterResult,
  WorkerDelegationInput,
  WorkerDelegationOutcome,
  WorkerDelegationResult,
} from './index.js';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 512 * 1024;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_REASON_LENGTH = 1_000;
const MAX_TITLE_LENGTH = LIMITES_DELEGATION_DEFAUT.maxTitleChars;
const MAX_PROMPT_LENGTH = LIMITES_DELEGATION_DEFAUT.maxPromptChars;
const MAX_TEXT_LENGTH = 8_192;
const MAX_RESULT_TEXT = 32 * 1024;

export const HIVE_DELEGATE_TOOL = 'hive_delegate';
export const HIVE_WAIT_TOOL = 'hive_wait_for_delegation_result';
/**
 * L'outil de DÉCISION (G12) : branché par `--permission-prompt-tool`, appelé
 * par le CLI — pas par le modèle — quand une action n'est couverte ni par le
 * mode de permission ni par le `permissions.allow` compilé. Le pont relaie la
 * question au Worker, qui classe l'action (politique-actions.ts) et répond
 * `allow`/`deny` — après réquisition dans la Chambre pour l'irréversible.
 */
export const HIVE_APPROVE_TOOL = 'hive_approve_action';

/**
 * Les outils MCP tels que le modèle les LIT — la seule documentation de
 * la délégation qu'il verra jamais.
 *
 * ─── POURQUOI LES BORNES SONT DANS LE TEXTE ──────────────────────────────────
 *
 * L'ancienne description tenait en une phrase : ni la profondeur, ni les
 * quotas, ni le format de l'identifiant, ni ce que valent les budgets. Un
 * agent les découvrait en se les prenant, un refus après l'autre — et il
 * lisait `costMicros` « en micro-unités » sans savoir de quoi. Les bornes
 * viennent de `LIMITES_DELEGATION_DEFAUT`, celles que la Reine applique : le
 * texte ne peut pas dériver d'elles. Les préférences y sont dites pour ce
 * qu'elles sont — un départage —, pas pour un choix qu'elles ne font pas.
 *
 * Bornée : ≈ 1 900 caractères pour les trois outils, envoyés une fois par
 * session du CLI.
 */
export function definitionsOutilsDelegation(
  limites = LIMITES_DELEGATION_DEFAUT,
): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  const { maxDurationMs, maxCostMicros, maxResourceUnits } = limites;
  return [
    {
      name: HIVE_DELEGATE_TOOL,
      description:
        'Délègue une sous-tâche bornée à un autre Worker Hive et rend son ADMISSION ' +
        `(identifiant, profondeur), pas son résultat : attends-le ensuite avec ${HIVE_WAIT_TOOL}. ` +
        `Bornes : au plus ${limites.maxDepth} niveaux sous la tâche racine, ` +
        `${limites.maxChildrenPerParent} enfants par parent et ${limites.maxDescendantsPerRoot} ` +
        'descendants par racine, enfants terminés compris. Budgets CUMULÉS par racine — chaque ' +
        `enfant réserve sa part, jamais rendue : durée ≤ ${maxDurationMs} ms, coût ≤ ` +
        `${maxCostMicros} micro-USD (coût DÉCLARÉ par le CLI de l’agent), ressources ≤ ` +
        `${maxResourceUnits} unités (compte abstrait, rien n’est mesuré). Quand la dépense ` +
        'déclarée de l’arbre atteint le budget coût, plus aucun enfant n’est admis et ceux en vol ' +
        'sont annulés. Ton propre budget de durée court pendant que tu attends. Un refus nomme ' +
        'la borne franchie et ce qui reste.',
      inputSchema: {
        type: 'object',
        properties: {
          childTaskId: {
            type: 'string',
            pattern: FORMAT_ID_ENFANT,
            description:
              'Identifiant stable, 1 à 64 caractères parmi A-Z a-z 0-9 _ - : le renvoyer rejoue ' +
              'la même sous-tâche au lieu d’en créer une autre.',
          },
          reason: {
            type: 'string',
            maxLength: MAX_REASON_LENGTH,
            description: 'Pourquoi tu délègues — journalisé pour l’opérateur.',
          },
          title: { type: 'string', maxLength: MAX_TITLE_LENGTH, description: 'Titre court.' },
          prompt: {
            type: 'string',
            maxLength: MAX_PROMPT_LENGTH,
            description: 'Instruction complète : l’enfant ne voit rien d’autre de ton contexte.',
          },
          durationMs: {
            type: 'integer',
            minimum: 0,
            maximum: maxDurationMs,
            description: `Durée réservée en ms, sur ${maxDurationMs} ms cumulées par racine.`,
          },
          costMicros: {
            type: 'integer',
            minimum: COUT_MIN_MICROS,
            maximum: maxCostMicros,
            description:
              `Coût réservé en micro-USD (1 000 000 = 1 USD), sur ${maxCostMicros} cumulés ` +
              'par racine. C’est aussi le plafond de l’enfant : un agent Claude Code s’arrête ' +
              'dans sa boucle quand sa dépense l’atteint, tentatives précédentes déduites. Une ' +
              `seule réponse coûte déjà ${COUT_UNE_REPONSE_MICROS.min} à ` +
              `${COUT_UNE_REPONSE_MICROS.max} µUSD sur le plus petit modèle : réserve moins, et ` +
              'l’enfant s’arrête après sa première réponse.',
          },
          resourceUnits: {
            type: 'integer',
            minimum: 0,
            maximum: maxResourceUnits,
            description: `Unités de ressources, compte abstrait : ${maxResourceUnits} cumulées par racine.`,
          },
          preferredAgent: {
            type: 'string',
            maxLength: MAX_NAME_LENGTH,
            description:
              'Famille d’agent préférée (ex. claude-code, codex) : départage seulement entre ' +
              'Workers à égalité, jamais une exclusion levée.',
          },
          preferredModel: {
            type: 'string',
            maxLength: MAX_NAME_LENGTH,
            description: 'Modèle préféré : départage seulement entre modèles à égalité de score.',
          },
        },
        required: [
          'childTaskId',
          'reason',
          'title',
          'prompt',
          'durationMs',
          'costMicros',
          'resourceUnits',
        ],
      },
    },
    {
      name: HIVE_WAIT_TOOL,
      description:
        'Attend le résultat terminal réel d’une sous-tâche Hive admise : réussie, échouée, ou ' +
        'annulée avec sa raison. Bloque au plus le budget de durée de l’enfant plus cinq minutes.',
      inputSchema: {
        type: 'object',
        properties: {
          childTaskId: {
            type: 'string',
            pattern: FORMAT_ID_ENFANT,
            description: 'Identifiant rendu par l’admission de la sous-tâche.',
          },
        },
        required: ['childTaskId'],
      },
    },
    {
      name: HIVE_APPROVE_TOOL,
      description:
        'Décision de permission Hive, appelée par le CLI quand une action n’est pas déjà ' +
        'autorisée. Hive classe l’action : une commande déclarée par le dépôt passe, une ' +
        'action irréversible (git push, publication, rm hors du répertoire, réseau non ' +
        'déclaré) ouvre une réquisition dans la Chambre et attend la décision humaine — ' +
        'avec expiration. Rend {behavior:"allow"|"deny"}.',
      inputSchema: {
        type: 'object',
        properties: {
          tool_name: { type: 'string', maxLength: MAX_NAME_LENGTH, description: 'Outil proposé.' },
          input: {
            type: 'object',
            description: 'Arguments proposés, rendus tels quels sur allow.',
          },
          tool_use_id: {
            type: 'string',
            maxLength: MAX_ID_LENGTH,
            description: 'Corrélation du CLI.',
          },
        },
        required: ['tool_name', 'input'],
      },
    },
  ];
}

type BridgeSuccess = {
  type: 'result';
  id: string;
  ok: true;
  value: WorkerDelegationOutcome | WorkerDelegationResult | DecisionAction;
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
    }
  | {
      type: 'call';
      id: string;
      operation: 'approve';
      toolName: string;
      input: Record<string, unknown>;
    };

type BridgeMessage = BridgeHello | BridgeCall;

interface BridgeConnectionState {
  authorized: boolean;
  inFlight: Set<string>;
  buffer: string;
}

export interface DelegationBridge {
  /** Où le parent (hôte) écoute : socket Unix du rendez-vous, ou pipe nommé Windows. */
  readonly endpoint: string;
  /** Chemin que le CLI voit depuis son bac éventuel. */
  readonly childEndpoint: string;
  /**
   * Dossier HÔTE du pont (socket et configuration) : le bac le monte seul, en
   * lecture seule, à `MONTAGE_PONT` — voir `runCommand(…, pont)`.
   */
  readonly dossier: string;
  readonly token: string;
  readonly parentTaskId: string;
  /** Nom unique pour éviter de fusionner avec un MCP Codex existant. */
  readonly mcpServerName: string;
  /** Commande MCP stdio : `node --eval <pont> <endpoint> <token> <parent>`. */
  readonly childCommand: string;
  readonly childArgs: readonly string[];
  /**
   * Variables posées pour le serveur MCP par la configuration de l'agent
   * (`envDuPont`) ; absent quand `childCommand` est un vrai Node.
   */
  readonly childEnv?: Readonly<Record<string, string>>;
  /** Chemin de configuration MCP vu par le CLI. */
  readonly childConfigPath: string;
  /** Chemin hôte du même fichier, utilisé pour l'écrire et le supprimer. */
  readonly configPath: string;
  close(): Promise<void>;
}

/**
 * Source autonome exécutée par le `node --eval` du serveur MCP stdio.
 *
 * Le serveur MCP local n'appelle aucun fournisseur : il ne garde AUCUN secret
 * Hive ou de modèle, même si le CLI parent a dû les garder dans son env. Sa
 * liste est `SECRETS_JAMAIS_SONDES` elle-même, injectée ici — elle en était une
 * copie à la main, et une copie se laisse distancer : `CLAUDE_CODE_OAUTH_TOKEN`
 * et `CODEX_API_KEY`, les jetons qu'un bac reçoit, n'y étaient pas.
 */
export const DELEGATION_BRIDGE_SOURCE = String.raw`
const net = require('node:net');

for (const secret of [${SECRETS_JAMAIS_SONDES.map((nom) => `'${nom}'`).join(', ')}]) {
  delete process.env[secret];
}

const endpoint = process.argv[1];
const token = process.argv[2];
const parentTaskId = process.argv[3];
const MAX_FRAME_BYTES = 524288;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_REASON_LENGTH = 1000;
const MAX_TITLE_LENGTH = ${MAX_TITLE_LENGTH};
const MAX_PROMPT_LENGTH = ${MAX_PROMPT_LENGTH};
const MAX_TEXT_LENGTH = 8192;
const MIN_BUDGET = ${JSON.stringify({ durationMs: 0, costMicros: COUT_MIN_MICROS, resourceUnits: 0 })};
const MAX_BUDGET = ${JSON.stringify({
  durationMs: LIMITES_DELEGATION_DEFAUT.maxDurationMs,
  costMicros: LIMITES_DELEGATION_DEFAUT.maxCostMicros,
  resourceUnits: LIMITES_DELEGATION_DEFAUT.maxResourceUnits,
})};
const ID_ENFANT = new RegExp(${JSON.stringify(FORMAT_ID_ENFANT)});
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const HIVE_DELEGATE_TOOL = 'hive_delegate';
const HIVE_WAIT_TOOL = 'hive_wait_for_delegation_result';
const HIVE_APPROVE_TOOL = 'hive_approve_action';

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
    parentSocket = net.connect(endpoint);
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
  const id = (value) => typeof value === 'string' && ID_ENFANT.test(value) ? value : null;
  const entier = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  // Le PREMIER champ fautif, nommé avec sa borne : « arguments invalides » ne
  // disait pas lequel, et le modèle recommençait à l'aveugle.
  const fauteDelegation = (args, input) => {
    if (!input.childTaskId) return 'childTaskId : 1 à 64 caractères parmi A-Z a-z 0-9 _ -';
    if (!input.reason) return 'reason : texte non vide de ' + MAX_REASON_LENGTH + ' caractères au plus';
    if (!input.title) return 'title : texte non vide de ' + MAX_TITLE_LENGTH + ' caractères au plus';
    if (!input.prompt) return 'prompt : texte non vide de ' + MAX_PROMPT_LENGTH + ' caractères au plus';
    // La même borne que l'inputSchema annonce : au-delà, le guichet du nœud ne
    // rendait qu'un « demande mal formée » sans champ ni borne.
    for (const champ of ['durationMs', 'costMicros', 'resourceUnits']) {
      if (!entier(input[champ], MIN_BUDGET[champ], MAX_BUDGET[champ])) {
        return champ + ' : entier de ' + MIN_BUDGET[champ] + ' à ' + MAX_BUDGET[champ] + ' (plafond cumulé par racine)';
      }
    }
    if (args.preferredAgent !== undefined && !input.preferredAgent) return 'preferredAgent : texte non vide de ' + MAX_NAME_LENGTH + ' caractères au plus';
    if (args.preferredModel !== undefined && !input.preferredModel) return 'preferredModel : texte non vide de ' + MAX_NAME_LENGTH + ' caractères au plus';
    return null;
  };

  const definitions = ${JSON.stringify(definitionsOutilsDelegation())};

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
      const faute = fauteDelegation(args, input);
      if (faute) {
        return result(requestId, { ok: false, code: 'arguments_invalid', message: 'argument invalide — ' + faute }, true);
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
      if (!childTaskId) return result(requestId, { ok: false, code: 'arguments_invalid', message: 'childTaskId : 1 à 64 caractères parmi A-Z a-z 0-9 _ -' }, true);
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
    if (name === HIVE_APPROVE_TOOL) {
      // FERMÉ PAR DÉFAUT : quoi qu'il arrive — arguments mal formés, pont
      // tombé, parent en erreur — le CLI reçoit une DÉCISION deny lisible,
      // jamais une erreur d'outil qu'il traduirait en panne opaque.
      const refus = (message) => result(requestId, { behavior: 'deny', message });
      const toolName = text(args && args.tool_name, MAX_NAME_LENGTH);
      const input = args && typeof args.input === 'object' && args.input !== null && !Array.isArray(args.input) ? args.input : null;
      if (!toolName || !input) return refus('demande d’approbation mal formée — tool_name (texte) et input (objet) requis');
      try {
        const value = await callParent('approve', { toolName, input });
        if (value && (value.behavior === 'allow' || value.behavior === 'deny')) return result(requestId, value);
        return refus('décision du pont illisible' + (value && value.message ? ' : ' + value.message : ''));
      } catch (error) {
        return refus('pont Hive indisponible : ' + (error instanceof Error ? error.message : String(error)));
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

/**
 * La décision du Worker, revalidée AVANT de traverser le pont : un callback qui
 * rendrait autre chose qu'une décision fermée devient un deny dit — jamais un
 * allow par accident, jamais une trame illisible pour le CLI.
 */
function decisionBornee(value: DecisionAction): DecisionAction {
  if (isRecord(value) && value.behavior === 'allow' && isRecord(value.updatedInput)) return value;
  if (isRecord(value) && value.behavior === 'deny' && typeof value.message === 'string') {
    return { behavior: 'deny', message: boundedMessage(value.message) };
  }
  return { behavior: 'deny', message: 'décision du nœud illisible — refus par défaut' };
}

function validDelegationInput(value: unknown): value is WorkerDelegationInput {
  if (!isRecord(value)) return false;
  if (
    !text(value.childTaskId, MAX_ID_LENGTH) ||
    !text(value.reason, MAX_REASON_LENGTH) ||
    !text(value.title, MAX_TITLE_LENGTH) ||
    !text(value.prompt, MAX_PROMPT_LENGTH) ||
    !finiteBudget(value.durationMs, true) ||
    !finiteBudget(value.costMicros) ||
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

/**
 * L'environnement que la configuration MCP doit poser pour le pont.
 *
 * ─── DANS L'APPLICATION DE BUREAU, `process.execPath` N'EST PAS NODE ────────
 *
 * Le pont se lance par `process.execPath --eval …` : le binaire qui fait
 * tourner l'ouvrière. Dans l'app (ADR 0013 § 2), c'est Electron, que
 * l'ouvrière elle-même n'a reçu qu'en mode Node (`ELECTRON_RUN_AS_NODE=1`,
 * retiré de son environnement avant qu'elle ne lance quoi que ce soit). Sans
 * la variable, l'agent qui démarre le pont ouvrirait… une seconde fenêtre de
 * l'app, et la délégation n'aurait jamais de serveur MCP. On la pose donc là
 * où l'agent la lira : dans la configuration de CE serveur, et nulle part
 * ailleurs.
 *
 * Dans le bac, le pont est lancé par le `node` de l'image : rien à poser.
 */
export function envDuPont(
  versions: NodeJS.ProcessVersions,
  bac: boolean,
): Readonly<Record<string, string>> | undefined {
  return !bac && typeof versions.electron === 'string' ? { ELECTRON_RUN_AS_NODE: '1' } : undefined;
}

function mcpConfig(
  handle: Pick<DelegationBridge, 'childCommand' | 'childArgs' | 'childEnv' | 'mcpServerName'>,
): Record<string, unknown> {
  return {
    mcpServers: {
      [handle.mcpServerName]: {
        type: 'stdio',
        command: handle.childCommand,
        args: [...handle.childArgs],
        ...(handle.childEnv ? { env: { ...handle.childEnv } } : {}),
      },
    },
  };
}

/** Écrit le fichier Claude dans le dossier du pont, effacé avec lui. */
export function writeClaudeMcpConfig(bridge: DelegationBridge): void {
  writeFileSync(bridge.configPath, JSON.stringify(mcpConfig(bridge), null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/**
 * Écrit les consignes du dépôt (`consignes-depot.ts`) à côté de la
 * configuration MCP : même dossier privé, même effacement, même montage en
 * lecture seule dans le bac. Rend le chemin tel que le CLI le voit.
 */
export function writeClaudeConsignes(bridge: DelegationBridge, texte: string): string {
  const nom = 'consignes.md';
  writeFileSync(path.join(bridge.dossier, nom), texte, { encoding: 'utf8', mode: 0o600 });
  return path.join(path.dirname(bridge.childConfigPath), nom);
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
    `${prefix}.enabled_tools=${toml([HIVE_DELEGATE_TOOL, HIVE_WAIT_TOOL, HIVE_APPROVE_TOOL])}`,
    // Une clé POINTÉE par variable, pas une table : `-c` lit sa valeur en TOML,
    // où `{"A":"1"}` n'est pas une table en ligne (`{ A = "1" }` l'est) — la
    // forme JSON y serait lue comme une simple chaîne.
    ...Object.entries(bridge.childEnv ?? {}).flatMap(([cle, valeur]) => [
      '-c',
      `${prefix}.env.${cle}=${toml(valeur)}`,
    ]),
  ];
}

/**
 * Ce que rend un adaptateur quand son pont n'a pas pu s'ouvrir.
 *
 * ─── UN SOCKET TROP LONG N'EST PAS UNE PANNE D'AGENT ─────────────────────────
 *
 * Toute panne du pont partait en échec d'INFRASTRUCTURE : le nœud rejetait la
 * tâche sous « agent indisponible (auth/quota) », la ruche la réaffectait, et
 * rien ne disait pourquoi. Pour un dossier temporaire trop profond
 * (`CheminSocketTropLong`), c'est faux deux fois : l'agent va bien, et le même
 * poste échouera à chaque tentative. C'est donc un échec de la TÂCHE, dont les
 * logs portent la cause et le remède. Les autres pannes du pont restent propres
 * à ce nœud : un autre peut reprendre la tâche.
 */
export function resultatSansPont(error: unknown, subAgents: SubAgent[]): AdapterResult {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CheminSocketTropLong) {
    return {
      success: false,
      diff: '',
      logs: `[hive] ${message}`,
      subAgents,
    };
  }
  return {
    success: false,
    diff: '',
    logs: `[hive] pont de délégation indisponible : ${message}`,
    subAgents,
    infra: true,
  };
}

/**
 * Démarre le serveur hôte du pont. Le CLI ne reçoit qu'un endpoint local, un
 * jeton éphémère et l'identifiant exact du parent ; HIVE_TOKEN reste absent.
 */
export async function createDelegationBridge(
  ctx: Pick<
    AdapterContext,
    'bac' | 'delegate' | 'waitForDelegationResult' | 'rendezVous' | 'decideAction'
  >,
  parentTaskId: string,
): Promise<DelegationBridge> {
  if (!text(parentTaskId, MAX_ID_LENGTH)) throw new Error('identifiant parent invalide');
  if (!ctx.delegate || !ctx.waitForDelegationResult || !ctx.rendezVous) {
    throw new Error('capacités de délégation absentes');
  }
  const delegate = ctx.delegate;
  const waitForDelegationResult = ctx.waitForDelegationResult;
  const decideAction = ctx.decideAction;
  if (process.platform === 'win32' && ctx.bac) {
    throw new Error('pont MCP sandboxé indisponible sous Windows : transport local non partagé');
  }

  // Un dossier privé par pont, dans le rendez-vous du nœud : court quel que
  // soit le répertoire de la tâche. Lève `CheminSocketTropLong` AVANT toute
  // création si le dossier temporaire du système est lui-même trop profond.
  const { dossier, extremite: endpoint } = ctx.rendezVous.reserver();
  const mcpServerName = `hive_${randomBytes(8).toString('hex')}`;
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
        } else if (message.operation === 'approve') {
          if (!text(message.toolName, MAX_NAME_LENGTH) || !isRecord(message.input)) {
            reject(message.id, 'arguments_invalides', 'demande d’approbation invalide');
            return;
          }
          // Sans capacité de décision (adaptateur appelé seul), FERMÉ : un
          // deny dit, jamais un allow implicite ni une erreur muette.
          const value = decideAction
            ? decisionBornee(
                await decideAction({ toolName: message.toolName, input: message.input }),
              )
            : { behavior: 'deny' as const, message: 'capacité de décision absente sur ce nœud' };
          send({ type: 'result', id: message.id, ok: true, value } satisfies BridgeSuccess);
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

  // Le socket ET la configuration MCP partent avec le dossier du pont : rien
  // de ce pont ne survit à sa tentative, et rien n'a jamais touché le
  // répertoire de la tâche — donc rien ne peut entrer dans son diff.
  const closeServer = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  };

  try {
    // Sous Windows, un pipe nommé : ni chemin de fichier ni limite `sun_path`,
    // et sa liste de contrôle par défaut ne laisse aucun autre compte y écrire
    // — là où le port TCP local d'avant s'ouvrait à tout processus du poste.
    // Son nom porte les suffixes aléatoires du rendez-vous, et libuv crée la
    // première instance avec FILE_FLAG_FIRST_PIPE_INSTANCE : un pipe occupé
    // d'avance sous ce nom fait échouer l'écoute (EADDRINUSE), jamais l'inverse.
    await listen(server, endpoint);
    if (process.platform !== 'win32') chmodSync(endpoint, 0o600);
  } catch (error) {
    await closeServer();
    throw error;
  }

  // Dans le bac, le dossier du pont est monté seul à `MONTAGE_PONT` : le CLI y
  // voit le même socket et la même configuration, sous un chemin du bac.
  const dansLeBac = (fichier: string): string =>
    ctx.bac ? path.posix.join(MONTAGE_PONT, path.basename(fichier)) : fichier;
  const configPath = path.join(dossier, 'mcp.json');
  const childCommand = ctx.bac ? 'node' : process.execPath;
  const childArgs = ['--eval', DELEGATION_BRIDGE_SOURCE, dansLeBac(endpoint), token, parentTaskId];
  const childEnv = envDuPont(process.versions, ctx.bac !== undefined);

  return {
    endpoint,
    childEndpoint: dansLeBac(endpoint),
    dossier,
    token,
    parentTaskId,
    mcpServerName,
    childCommand,
    childArgs,
    ...(childEnv ? { childEnv } : {}),
    childConfigPath: dansLeBac(configPath),
    configPath,
    close: closeServer,
  };
}

function listen(server: Server, endpoint: string): Promise<void> {
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
    server.listen(endpoint);
  });
}
