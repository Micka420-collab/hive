// Types pour le système de connexion IA de Cyber Hive.
// Supporte OAuth 2.1 + PKCE, clés API, MCP servers, et connexions directes.

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Types de connexion
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Méthode d'authentification supportée par un provider IA. */
export type AuthMethod = 'oauth2' | 'api-key' | 'bearer' | 'none' | 'mcp';

/** Statut d'une connexion IA. */
export type StatutConnexion = 'deconnecte' | 'connexion' | 'connecte' | 'erreur' | 'expire';

/** Type de provider IA. */
export type TypeProvider =
  | 'llm'           // Modèle de langage (Claude, GPT, Gemini, etc.)
  | 'coding-agent'  // Agent de code (Cursor, Cline, Codex)
  | 'mcp-server'    // Serveur MCP externe
  | 'security-tool' // Outil de sécurité via MCP
  | 'local';        // Modèle local (Ollama)

/** Capacités d'un provider IA. */
export interface CapacitesProvider {
  /** Peut générer du texte. */
  generation: boolean;
  /** Peut analyser des images. */
  vision: boolean;
  /** Peut exécuter du code. */
  codeExecution: boolean;
  /** Supporte le streaming. */
  streaming: boolean;
  /** Supporte les function calls / tool use. */
  toolUse: boolean;
  /** Supporte MCP. */
  mcp: boolean;
  /** Context window size (tokens). */
  contextWindow: number;
  /** Coût par 1M tokens input (USD). */
  coutInput?: number;
  /** Coût par 1M tokens output (USD). */
  coutOutput?: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Provider IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Définition d'un provider IA. */
export interface ProviderIA {
  /** Identifiant unique. */
  id: string;
  /** Nom affichable. */
  nom: string;
  /** Type de provider. */
  type: TypeProvider;
  /** Méthodes d'authentification supportées. */
  methodesAuth: AuthMethod[];
  /** Capacités du provider. */
  capacites: CapacitesProvider;
  /** URL de base de l'API. */
  urlBase?: string;
  /** URL d'autorisation OAuth (si applicable). */
  urlOAuth?: string;
  /** URL d'échange de token OAuth. */
  urlToken?: string;
  /** Scope OAuth requis. */
  scopes?: string[];
  /** Client ID OAuth (à configurer par l'utilisateur). */
  clientId?: string;
  /** Redirect URI pour OAuth. */
  redirectUri?: string;
  /** Documentation ou lien d'inscription. */
  docUrl?: string;
  /** Icône / emoji. */
  icone?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Connexion active
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Token OAuth 2.1. */
export interface TokenOAuth {
  accessToken: string;
  refreshToken?: string;
  tokenType: 'Bearer';
  expireLe: number; // timestamp ms
  scope?: string;
}

/** Connexion IA active. */
export interface ConnexionIA {
  id: string;
  providerId: string;
  statut: StatutConnexion;
  methode: AuthMethod;
  /** Token OAuth (si oauth2). */
  token?: TokenOAuth;
  /** Clé API (si api-key / bearer). */
  cleApi?: string;
  /** URL du serveur MCP (si mcp). */
  urlMcp?: string;
  /** Métadonnées de connexion. */
  connecteAt?: number;
  derniereErreur?: string;
  /** Nombre de requêtes effectuées. */
  requetes: number;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Requête / Réponse IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Rôle d'un message. */
export type RoleMessage = 'system' | 'user' | 'assistant' | 'tool';

/** Message dans une conversation IA. */
export interface MessageIA {
  role: RoleMessage;
  content: string;
  /** Nom de l'outil appelé (si role=tool). */
  toolName?: string;
  /** ID de l'appel d'outil. */
  toolCallId?: string;
}

/** Requête vers un provider IA. */
export interface RequeteIA {
  providerId: string;
  messages: MessageIA[];
  /** Température (0-2). */
  temperature?: number;
  /** Max tokens. */
  maxTokens?: number;
  /** Outils disponibles (function calling). */
  outils?: OutilFunctionCall[];
  /** Forcer le streaming. */
  stream?: boolean;
}

/** Définition d'un outil pour function calling. */
export interface OutilFunctionCall {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Réponse d'un provider IA. */
export interface ReponseIA {
  providerId: string;
  content: string;
  /** Appels d'outils demandés par l'IA. */
  toolCalls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }[];
  /** Tokens utilisés. */
  tokensInput?: number;
  tokensOutput?: number;
  /** Latence en ms. */
  latenceMs?: number;
  /** Erreur éventuelle. */
  erreur?: string;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Serveur MCP externe
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Configuration d'un serveur MCP externe. */
export interface ConfigMcpExterne {
  id: string;
  nom: string;
  url: string;
  /** Transport: stdio ou websocket. */
  transport: 'stdio' | 'websocket' | 'http';
  /** Commande à exécuter (si stdio). */
  commande?: string;
  /** Arguments (si stdio). */
  args?: string[];
  /** Variables d'environnement. */
  env?: Record<string, string>;
  /** Outils exposés (découverts au runtime). */
  outils?: OutilMcpExterne[];
  /** Statut de connexion. */
  statut: StatutConnexion;
}

/** Outil exposé par un serveur MCP externe. */
export interface OutilMcpExterne {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Configuration globale
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Configuration du système de connexion IA. */
export interface ConfigConnexionIA {
  /** Port du serveur OAuth callback. */
  portCallback: number;
  /** URL de redirection. */
  redirectUri: string;
  /** Stocker les tokens chiffrés. */
  stockageChiffre: boolean;
  /** Auto-refresh des tokens. */
  autoRefresh: boolean;
  /** Timeout des requêtes (ms). */
  timeoutMs: number;
  /** Retry count. */
  retries: number;
}

export const CONFIG_CONNEXION_DEFAUT: ConfigConnexionIA = {
  portCallback: 8766,
  redirectUri: 'http://localhost:8766/callback',
  stockageChiffre: true,
  autoRefresh: true,
  timeoutMs: 30_000,
  retries: 3,
};