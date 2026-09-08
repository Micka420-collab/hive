// Serveur MCP (Model Context Protocol) pour Cyber Hive.
// Expose les outils de sécurité aux agents IA (Claude Code, Cursor, etc.)
// via une interface JSON-RPC sur WebSocket.

import type { ConfigMCP, OutilSecurite, ResultatOutil } from './types.js';
import { listerOutils, obtenirOutil } from './tool-registry.js';
import { execOutil } from './container-manager.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Types MCP
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Requête MCP reçue d'un agent IA. */
export interface RequeteMCP {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** Réponse MCP renvoyée à un agent IA. */
export interface ReponseMCP {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Définition d'un outil exposé via MCP. */
export interface DefinitionOutilMCP {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Serveur MCP
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class ServeurMCP {
  private config: ConfigMCP;
  private outils: Map<string, OutilSecurite> = new Map();
  private connexions: Set<WebSocket> = new Set();
  private enMarche = false;

  constructor(config: ConfigMCP) {
    this.config = config;
    this.chargerOutils();
  }

  /** Charge les outils autorisés dans le registre MCP. */
  private chargerOutils(): void {
    const tous = listerOutils();
    for (const outil of tous) {
      if (this.config.outilsExposes.includes(outil.id)) {
        this.outils.set(outil.id, outil);
      }
    }
  }

  /** Démarre le serveur MCP. */
  async demarrer(): Promise<void> {
    if (this.enMarche) return;
    this.enMarche = true;
    // Le serveur WebSocket réel sera branché ici.
    // Pour l'instant, on expose l'API de gestion des requêtes.
  }

  /** Arrête le serveur MCP. */
  async arreter(): Promise<void> {
    this.enMarche = false;
    this.connexions.clear();
  }

  /** Liste les outils exposés (méthode MCP `tools/list`). */
  listerOutilsMCP(): DefinitionOutilMCP[] {
    const definitions: DefinitionOutilMCP[] = [];
    for (const outil of this.outils.values()) {
      definitions.push({
        name: outil.id,
        description: outil.description,
        inputSchema: {
          type: 'object',
          properties: {
            cible: {
              type: 'string',
              description: 'Hôte, IP ou URL cible',
            },
            args: {
              type: 'array',
              description: 'Arguments supplémentaires pour l'outil',
              items: { type: 'string' },
            },
          },
          required: ['cible'],
        },
      });
    }
    return definitions;
  }

  /** Exécute un outil via MCP (méthode MCP `tools/call`). */
  async executerOutil(
    outilId: string,
    cible: string,
    args?: string[],
  ): Promise<ResultatOutil> {
    const outil = this.outils.get(outilId);
    if (!outil) {
      throw new Error(`Outil inconnu : ${outilId}`);
    }

    if (!this.config.agentsAutorises.length) {
      throw new Error('Aucun agent autorisé à exécuter des outils');
    }

    const argsComplets = [...(outil.argsDefaut ?? []), ...(args ?? [])];
    return execOutil(outil, cible, argsComplets);
  }

  /** Traite une requête MCP JSON-RPC. */
  async traiterRequete(req: RequeteMCP): Promise<ReponseMCP> {
    try {
      switch (req.method) {
        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: { tools: this.listerOutilsMCP() },
          };

        case 'tools/call': {
          const params = req.params ?? {};
          const name = params.name as string;
          const arguments_ = (params.arguments ?? {}) as {
            cible: string;
            args?: string[];
          };
          const resultat = await this.executerOutil(
            name,
            arguments_.cible,
            arguments_.args,
          );
          return {
            jsonrpc: '2.0',
            id: req.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(resultat, null, 2),
                },
              ],
            },
          };
        }

        case 'ping':
          return { jsonrpc: '2.0', id: req.id, result: { pong: true } };

        default:
          return {
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32601, message: `Méthode inconnue : ${req.method}` },
          };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Erreur interne',
        },
      };
    }
  }

  /** Retourne la liste des outils enregistrés. */
  getOutils(): OutilSecurite[] {
    return [...this.outils.values()];
  }

  /** Le serveur est-il en marche ? */
  estEnMarche(): boolean {
    return this.enMarche;
  }
}

/** Crée une instance du serveur MCP avec la configuration par défaut. */
export function creerServeurMCP(config: ConfigMCP): ServeurMCP {
  return new ServeurMCP(config);
}