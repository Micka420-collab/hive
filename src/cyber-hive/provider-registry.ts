// Registre des providers IA supportés par Cyber Hive.
// Chaque provider peut être connecté via OAuth 2.1, clé API, ou MCP.
// Inspiré de AutoPentest-MCP, Zen-AI-Pentest, HexStrike, Shannon.

import type { ProviderIA } from './connection-types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Catalogue des providers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const PROVIDERS_IA: ProviderIA[] = [
  // ─── LLMs cloud ──────────────────────────────────────────────────────────
  {
    id: 'claude',
    nom: 'Claude (Anthropic)',
    type: 'llm',
    methodesAuth: ['api-key', 'oauth2'],
    capacites: {
      generation: true,
      vision: true,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 200_000,
      coutInput: 3,
      coutOutput: 15,
    },
    urlBase: 'https://api.anthropic.com/v1',
    urlOAuth: 'https://console.anthropic.com/oauth/authorize',
    urlToken: 'https://console.anthropic.com/oauth/token',
    scopes: ['completions', 'messages'],
    docUrl: 'https://docs.anthropic.com',
    icone: '🧠',
  },
  {
    id: 'openai',
    nom: 'OpenAI GPT-4 / GPT-5',
    type: 'llm',
    methodesAuth: ['api-key', 'oauth2'],
    capacites: {
      generation: true,
      vision: true,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: false,
      contextWindow: 128_000,
      coutInput: 2.5,
      coutOutput: 10,
    },
    urlBase: 'https://api.openai.com/v1',
    urlOAuth: 'https://platform.openai.com/oauth/authorize',
    urlToken: 'https://platform.openai.com/oauth/token',
    scopes: ['openid', 'profile', 'email'],
    docUrl: 'https://platform.openai.com/docs',
    icone: '🤖',
  },
  {
    id: 'gemini',
    nom: 'Gemini (Google)',
    type: 'llm',
    methodesAuth: ['api-key', 'oauth2'],
    capacites: {
      generation: true,
      vision: true,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 1_000_000,
      coutInput: 1.25,
      coutOutput: 5,
    },
    urlBase: 'https://generativelanguage.googleapis.com/v1beta',
    urlOAuth: 'https://accounts.google.com/o/oauth2/v2/auth',
    urlToken: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/generative-language'],
    docUrl: 'https://ai.google.dev/docs',
    icone: '✨',
  },
  {
    id: 'deepseek',
    nom: 'DeepSeek',
    type: 'llm',
    methodesAuth: ['api-key'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: false,
      contextWindow: 64_000,
      coutInput: 0.14,
      coutOutput: 0.28,
    },
    urlBase: 'https://api.deepseek.com/v1',
    docUrl: 'https://api-docs.deepseek.com',
    icone: '🔍',
  },
  {
    id: 'grok',
    nom: 'Grok (xAI)',
    type: 'llm',
    methodesAuth: ['api-key'],
    capacites: {
      generation: true,
      vision: true,
      codeExecution: false,
      streaming: true,
      toolUse: true,
      mcp: false,
      contextWindow: 131_072,
      coutInput: 5,
      coutOutput: 15,
    },
    urlBase: 'https://api.x.ai/v1',
    docUrl: 'https://docs.x.ai',
    icone: '🫡',
  },

  // ─── Agents de code ─────────────────────────────────────────────────────
  {
    id: 'claude-code',
    nom: 'Claude Code',
    type: 'coding-agent',
    methodesAuth: ['api-key', 'oauth2'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 200_000,
    },
    urlBase: 'https://api.anthropic.com/v1',
    docUrl: 'https://docs.anthropic.com/claude-code',
    icone: '💻',
  },
  {
    id: 'cursor',
    nom: 'Cursor AI',
    type: 'coding-agent',
    methodesAuth: ['api-key'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 128_000,
    },
    docUrl: 'https://docs.cursor.com',
    icone: '🖱️',
  },
  {
    id: 'cline',
    nom: 'Cline (VS Code)',
    type: 'coding-agent',
    methodesAuth: ['api-key', 'oauth2'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 200_000,
    },
    docUrl: 'https://cline.bot/docs',
    icone: '📋',
  },
  {
    id: 'codex',
    nom: 'Codex CLI (OpenAI)',
    type: 'coding-agent',
    methodesAuth: ['api-key'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: false,
      contextWindow: 128_000,
    },
    urlBase: 'https://api.openai.com/v1',
    docUrl: 'https://github.com/openai/codex',
    icone: '⚡',
  },

  // ─── Modèles locaux ─────────────────────────────────────────────────────
  {
    id: 'ollama',
    nom: 'Ollama (Local)',
    type: 'local',
    methodesAuth: ['none'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: false,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 32_000,
    },
    urlBase: 'http://localhost:11434',
    docUrl: 'https://ollama.com',
    icone: '🦙',
  },

  // ─── Serveurs MCP externes (sécurité) ───────────────────────────────────
  {
    id: 'autopentest-mcp',
    nom: 'AutoPentest-MCP',
    type: 'mcp-server',
    methodesAuth: ['mcp'],
    capacites: {
      generation: false,
      vision: false,
      codeExecution: true,
      streaming: false,
      toolUse: true,
      mcp: true,
      contextWindow: 0,
    },
    urlBase: 'https://github.com/bhavsec/autopentest-ai',
    docUrl: 'https://github.com/bhavsec/autopentest-ai',
    icone: '🎯',
  },
  {
    id: 'hexstrike-mcp',
    nom: 'HexStrike AI MCP',
    type: 'mcp-server',
    methodesAuth: ['mcp'],
    capacites: {
      generation: false,
      vision: false,
      codeExecution: true,
      streaming: false,
      toolUse: true,
      mcp: true,
      contextWindow: 0,
    },
    urlBase: 'https://github.com/StackStrikeAI/hexstrike-ai',
    docUrl: 'https://github.com/StackStrikeAI/hexstrike-ai',
    icone: '⚔️',
  },
  {
    id: 'shannon',
    nom: 'Shannon (Autonomous Pentest)',
    type: 'mcp-server',
    methodesAuth: ['mcp', 'api-key'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 200_000,
    },
    urlBase: 'https://github.com/keygraph/shannon',
    docUrl: 'https://github.com/keygraph/shannon',
    icone: '🦈',
  },
  {
    id: 'zen-ai-pentest',
    nom: 'Zen-AI-Pentest',
    type: 'mcp-server',
    methodesAuth: ['mcp', 'api-key'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 128_000,
    },
    urlBase: 'https://github.com/SHAdd0WTAka/Zen-Ai-Pentest',
    docUrl: 'https://github.com/SHAdd0WTAka/Zen-Ai-Pentest',
    icone: '🛡️',
  },
  {
    id: 'mcp-security-hub',
    nom: 'MCP Security Hub',
    type: 'mcp-server',
    methodesAuth: ['mcp'],
    capacites: {
      generation: false,
      vision: false,
      codeExecution: true,
      streaming: false,
      toolUse: true,
      mcp: true,
      contextWindow: 0,
    },
    urlBase: 'https://github.com/mcp-security/mcp-security-hub',
    docUrl: 'https://github.com/mcp-security/mcp-security-hub',
    icone: '🔐',
  },
  {
    id: 'mcp-for-security',
    nom: 'MCP for Security',
    type: 'mcp-server',
    methodesAuth: ['mcp'],
    capacites: {
      generation: false,
      vision: false,
      codeExecution: true,
      streaming: false,
      toolUse: true,
      mcp: true,
      contextWindow: 0,
    },
    urlBase: 'https://github.com/mcp-security/mcp-for-security',
    docUrl: 'https://github.com/mcp-security/mcp-for-security',
    icone: '🧩',
  },
  {
    id: 'nemesis',
    nom: 'Nemesis (Autonomous Agent)',
    type: 'mcp-server',
    methodesAuth: ['mcp', 'api-key'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 128_000,
    },
    urlBase: 'https://github.com/Archsec-Emman/Nemesis',
    docUrl: 'https://github.com/Archsec-Emman/Nemesis',
    icone: '💀',
  },
  {
    id: 'llm4pentest',
    nom: 'LLM4Pentest (Multi-Agent)',
    type: 'mcp-server',
    methodesAuth: ['mcp', 'api-key'],
    capacites: {
      generation: true,
      vision: false,
      codeExecution: true,
      streaming: true,
      toolUse: true,
      mcp: true,
      contextWindow: 64_000,
    },
    urlBase: 'https://github.com/simon-p-j-r/LLM4Pentest',
    docUrl: 'https://github.com/simon-p-j-r/LLM4Pentest',
    icone: '🧠',
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  API du registre
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const registre = new Map<string, ProviderIA>();
for (const p of PROVIDERS_IA) {
  registre.set(p.id, p);
}

/** Retourne tous les providers enregistrés. */
export function listerProviders(): ProviderIA[] {
  return [...registre.values()];
}

/** Retourne un provider par son ID. */
export function obtenirProvider(id: string): ProviderIA | undefined {
  return registre.get(id);
}

/** Filtre les providers par type. */
export function providersParType(type: ProviderIA['type']): ProviderIA[] {
  return PROVIDERS_IA.filter((p) => p.type === type);
}

/** Filtre les providers par méthode d'authentification. */
export function providersParMethode(methode: ProviderIA['methodesAuth'][number]): ProviderIA[] {
  return PROVIDERS_IA.filter((p) => p.methodesAuth.includes(methode));
}

/** Filtre les providers qui supportent MCP. */
export function providersMcp(): ProviderIA[] {
  return PROVIDERS_IA.filter((p) => p.capacites.mcp);
}

/** Enregistre un provider supplémentaire (extension dynamique). */
export function enregistrerProvider(provider: ProviderIA): void {
  registre.set(provider.id, provider);
}

/** Vérifie qu'un provider existe. */
export function providerExiste(id: string): boolean {
  return registre.has(id);
}