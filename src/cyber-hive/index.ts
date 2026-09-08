// Point d'entrée du module Cyber Hive.
// Exporte l'API publique pour l'intégration avec l'orchestrateur Hive principal.

export * from './types.js';
export * from './tool-registry.js';
export * from './mcp-server.js';
export * from './container-manager.js';
export * from './anti-trace.js';
export * from './pentest-orchestrator.js';
export * from './attack-visualizer.js';
export * from './autonomous-agent.js';

import { creerOrchestrateur } from './pentest-orchestrator.js';
import { creerServeurMCP } from './mcp-server.js';
import { creerVisualiseur } from './attack-visualizer.js';
import { CONFIG_DEFAUT } from './types.js';
import type { ConfigCyberHive } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Initialisation de Cyber Hive
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export interface CyberHive {
  orchestrateur: ReturnType<typeof creerOrchestrateur>;
  serveurMCP: ReturnType<typeof creerServeurMCP>;
  visualiseur: ReturnType<typeof creerVisualiseur>;
  config: ConfigCyberHive;
}

/** Initialise Cyber Hive avec la configuration donnée (ou par défaut). */
export function initCyberHive(config?: Partial<ConfigCyberHive>): CyberHive {
  const configFinale = { ...CONFIG_DEFAUT, ...config, mcp: { ...CONFIG_DEFAUT.mcp, ...config?.mcp } };

  return {
    orchestrateur: creerOrchestrateur(configFinale),
    serveurMCP: creerServeurMCP(configFinale.mcp),
    visualiseur: creerVisualiseur(),
    config: configFinale,
  };
}