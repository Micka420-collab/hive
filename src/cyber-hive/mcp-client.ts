// Client MCP (Model Context Protocol) pour Cyber Hive.
// Permet de se connecter à des serveurs MCP externes (AutoPentest-MCP, HexStrike,
// Shannon, Zen-AI-Pentest, mcp-security-hub, mcp-for-security, Nemesis, LLM4Pentest).
// Supporte les transports: stdio, websocket, HTTP.
// Inspiré de GitHub MCP Server, AutoPentest-MCP, et la spec MCP 2025.

import type { ConfigMcpExterne, OutilMcpExterne } from './connection-types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Types MCP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Requête JSON-RPC 2.0. */
interface RequeteJsonRpc {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** Réponse JSON-RPC 2.0. */
interface ReponseJsonRpc {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Client MCP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class ClientMcp {
  private config: ConfigMcpExterne;
  private outils = new Map<string, OutilMcpExterne>();
  private connecte = false;
  private ws?: WebSocket;
  private compteurId = 0;

  constructor(config: ConfigMcpExterne) {
    this.config = config;
  }

  // ─── Connexion ──────────────────────────────────────────────────────────

  /**
   * Se connecte au serveur MCP.
   * Découvre automatiquement les outils exposés.
   */
  async connecter(): Promise<{ outils: OutilMcpExterne[] } | { erreur: string }> {
    try {
      if (this.config.transport === 'websocket') {
        return await this.connecterWebSocket();
      } else if (this.config.transport === 'http') {
        return await this.connecterHttp();
      } else {
        return { erreur: 'Transport stdio nécessite un processus local (non supporté en mode simulation)' };
      }
    } catch (err) {
      this.config.statut = 'erreur';
      return { erreur: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Connexion WebSocket. */
  private async connecterWebSocket(): Promise<{ outils: OutilMcpExterne[] } | { erreur: string }> {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.config.url);
        this.ws.onopen = async () => {
          this.connecte = true;
          this.config.statut = 'connecte';
          // Découvrir les outils
          const result = await this.envoyerRequete('tools/list', {});
          if (result && !result.error) {
            const outils = (result.result as { tools?: OutilMcpExterne[] }).tools ?? [];
            for (const o of outils) {
              this.outils.set(o.name, o);
            }
            this.config.outils = outils;
            resolve({ outils });
          } else {
            resolve({ outils: [] });
          }
        };
        this.ws.onerror = () => {
          this.config.statut = 'erreur';
          resolve({ erreur: 'Erreur WebSocket MCP' });
        };
        this.ws.onclose = () => {
          this.connecte = false;
          this.config.statut = 'deconnecte';
        };
      } catch (err) {
        resolve({ erreur: String(err) });
      }
    });
  }

  /** Connexion HTTP (MCP over HTTP). */
  private async connecterHttp(): Promise<{ outils: OutilMcpExterne[] } | { erreur: string }> {
    const resp = await fetch(this.config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.compteurId,
        method: 'tools/list',
        params: {},
      } satisfies RequeteJsonRpc),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      this.config.statut = 'erreur';
      return { erreur: `HTTP ${resp.status}: ${await resp.text()}` };
    }

    this.connecte = true;
    this.config.statut = 'connecte';

    const data = (await resp.json()) as ReponseJsonRpc;
    const outils = (data.result as { tools?: OutilMcpExterne[] })?.tools ?? [];
    for (const o of outils) {
      this.outils.set(o.name, o);
    }
    this.config.outils = outils;
    return { outils };
  }

  /** Déconnecte du serveur MCP. */
  deconnecter(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.connecte = false;
    this.config.statut = 'deconnecte';
  }

  // ─── Envoi de requêtes ──────────────────────────────────────────────────

  /** Envoie une requête JSON-RPC au serveur MCP. */
  private async envoyerRequete(
    method: string,
    params: Record<string, unknown>,
  ): Promise<ReponseJsonRpc | null> {
    const req: RequeteJsonRpc = {
      jsonrpc: '2.0',
      id: ++this.compteurId,
      method,
      params,
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return new Promise((resolve) => {
        const handler = (event: MessageEvent) => {
          this.ws?.removeEventListener('message', handler);
          try {
            resolve(JSON.parse(event.data) as ReponseJsonRpc);
          } catch {
            resolve(null);
          }
        };
        this.ws?.addEventListener('message', handler);
        this.ws?.send(JSON.stringify(req));
      });
    } else if (this.config.transport === 'http') {
      const resp = await fetch(this.config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) return null;
      return (await resp.json()) as ReponseJsonRpc;
    }
    return null;
  }

  // ─── Appel d'outils ─────────────────────────────────────────────────────

  /**
   * Appelle un outil exposé par le serveur MCP.
   */
  async appelerOutil(
    nom: string,
    args: Record<string, unknown>,
  ): Promise<{ success: boolean; result?: unknown; erreur?: string }> {
    if (!this.connecte) {
      return { success: false, erreur: 'Non connecté au serveur MCP' };
    }

    const outil = this.outils.get(nom);
    if (!outil) {
      return { success: false, erreur: `Outil inconnu: ${nom}` };
    }

    const resp = await this.envoyerRequete('tools/call', { name: nom, arguments: args });
    if (!resp) return { success: false, erreur: 'Pas de réponse du serveur MCP' };
    if (resp.error) {
      return { success: false, erreur: resp.error.message };
    }

    return { success: true, result: resp.result };
  }

  // ─── Découverte d'outils ────────────────────────────────────────────────

  /** Retourne la liste des outils découverts. */
  listerOutils(): OutilMcpExterne[] {
    return [...this.outils.values()];
  }

  /** Retourne un outil par son nom. */
  obtenirOutil(nom: string): OutilMcpExterne | undefined {
    return this.outils.get(nom);
  }

  /** Le client est-il connecté ? */
  estConnecte(): boolean {
    return this.connecte;
  }

  /** Statut de la connexion. */
  statut(): ConfigMcpExterne['statut'] {
    return this.config.statut;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Registre des serveurs MCP externes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Configurations pré-définies pour les serveurs MCP externes de sécurité. */
export const SERVEURS_MCP_PREDEFINIS: ConfigMcpExterne[] = [
  {
    id: 'autopentest-mcp',
    nom: 'AutoPentest-MCP (OWASP WSTG)',
    url: 'http://localhost:8000/mcp',
    transport: 'http',
    statut: 'deconnecte',
    commande: 'python -m autopentest_mcp',
    outils: [],
  },
  {
    id: 'hexstrike-mcp',
    nom: 'HexStrike AI (150+ tools)',
    url: 'ws://localhost:8001/mcp',
    transport: 'websocket',
    statut: 'deconnecte',
    commande: 'hexstrike-mcp',
    outils: [],
  },
  {
    id: 'shannon-mcp',
    nom: 'Shannon (Autonomous Pentest)',
    url: 'http://localhost:8002/mcp',
    transport: 'http',
    statut: 'deconnecte',
    commande: 'shannon --mcp',
    outils: [],
  },
  {
    id: 'zen-ai-pentest-mcp',
    nom: 'Zen-AI-Pentest (72+ tools)',
    url: 'http://localhost:8003/mcp',
    transport: 'http',
    statut: 'deconnecte',
    commande: 'zen-ai-pentest --mcp',
    outils: [],
  },
  {
    id: 'mcp-security-hub',
    nom: 'MCP Security Hub (36 MCP, 175+ tools)',
    url: 'ws://localhost:8004/mcp',
    transport: 'websocket',
    statut: 'deconnecte',
    commande: 'mcp-security-hub',
    outils: [],
  },
  {
    id: 'mcp-for-security',
    nom: 'MCP for Security (SQLMap, FFUF, Nmap)',
    url: 'http://localhost:8005/mcp',
    transport: 'http',
    statut: 'deconnecte',
    commande: 'mcp-for-security',
    outils: [],
  },
  {
    id: 'nemesis-mcp',
    nom: 'Nemesis (Autonomous Docker Agent)',
    url: 'http://localhost:8006/mcp',
    transport: 'http',
    statut: 'deconnecte',
    commande: 'nemesis --mcp',
    outils: [],
  },
  {
    id: 'llm4pentest-mcp',
    nom: 'LLM4Pentest (Multi-Agent Scheduler)',
    url: 'http://localhost:8007/mcp',
    transport: 'http',
    statut: 'deconnecte',
    commande: 'llm4pentest --mcp',
    outils: [],
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Gestionnaire multi-MCP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Gère plusieurs connexions MCP simultanées. */
export class GestionnaireMcp {
  private clients = new Map<string, ClientMcp>();

  /** Connecte un serveur MCP par sa config. */
  async connecterServeur(config: ConfigMcpExterne): Promise<ClientMcp | { erreur: string }> {
    const client = new ClientMcp(config);
    const result = await client.connecter();
    if ('erreur' in result) return result;
    this.clients.set(config.id, client);
    return client;
  }

  /** Déconnecte un serveur MCP. */
  deconnecterServeur(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.deconnecter();
      this.clients.delete(id);
    }
  }

  /** Retourne tous les clients connectés. */
  listerClients(): ClientMcp[] {
    return [...this.clients.values()];
  }

  /** Retourne un client par ID. */
  obtenirClient(id: string): ClientMcp | undefined {
    return this.clients.get(id);
  }

  /**
   * Cherche un outil parmi tous les serveurs MCP connectés.
   * Retourne le premier serveur qui expose cet outil.
   */
  chercherOutil(nom: string): { client: ClientMcp; outil: OutilMcpExterne } | null {
    for (const client of this.clients.values()) {
      const outil = client.obtenirOutil(nom);
      if (outil) return { client, outil };
    }
    return null;
  }

  /**
   * Appelle un outil sur le premier serveur qui l'expose.
   */
  async appelerOutilGlobal(
    nom: string,
    args: Record<string, unknown>,
  ): Promise<{ success: boolean; result?: unknown; erreur?: string; serveur?: string }> {
    const trouve = this.chercherOutil(nom);
    if (!trouve) {
      return { success: false, erreur: `Outil "${nom}" non trouvé dans les serveurs MCP connectés` };
    }
    const result = await trouve.client.appelerOutil(nom, args);
    return { ...result, serveur: trouve.client['config']?.id };
  }

  /**
   * Liste tous les outils de tous les serveurs connectés.
   */
  listerTousOutils(): { serveur: string; outils: OutilMcpExterne[] }[] {
    const result: { serveur: string; outils: OutilMcpExterne[] }[] = [];
    for (const [id, client] of this.clients) {
      result.push({ serveur: id, outils: client.listerOutils() });
    }
    return result;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Factory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Crée un gestionnaire MCP avec les serveurs pré-définis. */
export function creerGestionnaireMcp(): GestionnaireMcp {
  return new GestionnaireMcp();
}