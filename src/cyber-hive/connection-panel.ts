// Panneau de connexion IA pour le dashboard Cyber Hive.
// Interface moderne pour connecter, gérer et visualiser toutes les IA et serveurs MCP.
// Affiche le statut de chaque connexion, permet d'ajouter des clés API, lancer OAuth, etc.

import type { ConnexionIA, ProviderIA } from './connection-types';
import { listerProviders, providersParType } from './provider-registry';
import { SERVEURS_MCP_PREDEFINIS } from './mcp-client';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Génération du HTML du panneau de connexion
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Génère le HTML du panneau de connexion IA. */
export function genererPanneauConnexion(connexions: ConnexionIA[]): string {
  const providers = listerProviders();
  const llms = providersParType('llm');
  const agents = providersParType('coding-agent');
  const locaux = providersParType('local');
  const mcps = providersParType('mcp-server');

  return `
<section id="ai-connections" class="ai-connection-panel">
  <header class="panel-header">
    <h2>🤖 Connexions IA</h2>
    <p class="subtitle">Connectez et orchestrez tous vos agents IA et serveurs MCP</p>
  </header>

  <div class="connection-stats">
    <div class="stat-card">
      <span class="stat-value">${connexions.filter((c) => c.statut === 'connecte').length}</span>
      <span class="stat-label">Connectés</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${providers.length}</span>
      <span class="stat-label">Providers</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${SERVEURS_MCP_PREDEFINIS.length}</span>
      <span class="stat-label">Serveurs MCP</span>
    </div>
  </div>

  <!-- LLMs Cloud -->
  <div class="provider-section">
    <h3>☁️ Modèles de langage (LLM)</h3>
    <div class="provider-grid">
      ${llms.map((p) => genererCarteProvider(p, connexions)).join('')}
    </div>
  </div>

  <!-- Agents de code -->
  <div class="provider-section">
    <h3>💻 Agents de code</h3>
    <div class="provider-grid">
      ${agents.map((p) => genererCarteProvider(p, connexions)).join('')}
    </div>
  </div>

  <!-- Modèles locaux -->
  <div class="provider-section">
    <h3>🏠 Modèles locaux</h3>
    <div class="provider-grid">
      ${locaux.map((p) => genererCarteProvider(p, connexions)).join('')}
    </div>
  </div>

  <!-- Serveurs MCP externes -->
  <div class="provider-section">
    <h3>🔌 Serveurs MCP externes (sécurité)</h3>
    <div class="provider-grid">
      ${mcps.map((p) => genererCarteProvider(p, connexions)).join('')}
    </div>
  </div>

  <!-- Méthodes de connexion -->
  <div class="connection-methods">
    <h3>🔐 Méthodes de connexion supportées</h3>
    <div class="method-badges">
      <span class="method-badge oauth">OAuth 2.1 + PKCE</span>
      <span class="method-badge api-key">Clé API</span>
      <span class="method-badge bearer">Bearer Token</span>
      <span class="method-badge mcp">MCP (Model Context Protocol)</span>
      <span class="method-badge none">Sans auth (local)</span>
    </div>
  </div>
</section>

<style>
.ai-connection-panel {
  background: #0d1117;
  color: #e6edf3;
  padding: 24px;
  border-radius: 12px;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
.panel-header h2 { margin: 0 0 4px; font-size: 24px; }
.panel-header .subtitle { margin: 0 0 20px; color: #8b949e; font-size: 14px; }
.connection-stats { display: flex; gap: 12px; margin-bottom: 24px; }
.stat-card {
  flex: 1; background: #161b22; border-radius: 8px; padding: 16px;
  text-align: center; border: 1px solid #30363d;
}
.stat-value { display: block; font-size: 28px; font-weight: 700; color: #58a6ff; }
.stat-label { font-size: 12px; color: #8b949e; text-transform: uppercase; }
.provider-section { margin-bottom: 28px; }
.provider-section h3 { font-size: 16px; margin-bottom: 12px; color: #c9d1d9; }
.provider-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.provider-card {
  background: #161b22; border: 1px solid #30363d; border-radius: 8px;
  padding: 16px; transition: border-color 0.2s;
}
.provider-card:hover { border-color: #58a6ff; }
.provider-card.connected { border-color: #3fb950; }
.provider-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.provider-icon { font-size: 24px; }
.provider-name { font-weight: 600; font-size: 14px; }
.provider-status {
  margin-left: auto; width: 10px; height: 10px; border-radius: 50%;
  background: #484f58;
}
.provider-status.connected { background: #3fb950; box-shadow: 0 0 8px #3fb950; }
.provider-status.error { background: #f85149; }
.provider-desc { font-size: 12px; color: #8b949e; margin-bottom: 8px; }
.provider-methods { display: flex; gap: 4px; flex-wrap: wrap; }
.method-badge {
  font-size: 10px; padding: 2px 8px; border-radius: 12px;
  background: #21262d; color: #8b949e; border: 1px solid #30363d;
}
.method-badge.oauth { color: #58a6ff; border-color: #58a6ff; }
.method-badge.api-key { color: #d29922; border-color: #d29922; }
.method-badge.mcp { color: #3fb950; border-color: #3fb950; }
.provider-actions { margin-top: 12px; display: flex; gap: 8px; }
.btn-connect {
  padding: 6px 12px; border-radius: 6px; border: 1px solid #30363d;
  background: #21262d; color: #e6edf3; font-size: 12px; cursor: pointer;
  transition: background 0.2s;
}
.btn-connect:hover { background: #30363d; }
.btn-connect.oauth { border-color: #58a6ff; color: #58a6ff; }
.btn-connect.api-key { border-color: #d29922; color: #d29922; }
.btn-connect.mcp { border-color: #3fb950; color: #3fb950; }
.btn-connect.connected { border-color: #3fb950; color: #3fb950; background: transparent; }
.connection-methods { margin-top: 24px; padding-top: 20px; border-top: 1px solid #30363d; }
.connection-methods h3 { font-size: 14px; margin-bottom: 12px; }
.connection-methods .method-badges { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
`;
}

/** Génère une carte provider. */
function genererCarteProvider(provider: ProviderIA, connexions: ConnexionIA[]): string {
  const connexion = connexions.find((c) => c.providerId === provider.id);
  const connecte = connexion?.statut === 'connecte';

  return `
<div class="provider-card ${connecte ? 'connected' : ''}">
  <div class="provider-card-header">
    <span class="provider-icon">${provider.icone ?? '🔌'}</span>
    <span class="provider-name">${provider.nom}</span>
    <span class="provider-status ${connecte ? 'connected' : ''}"></span>
  </div>
  <div class="provider-desc">${provider.capacites.generation ? 'Génération' : ''}${provider.capacites.vision ? ' + Vision' : ''}${provider.capacites.codeExecution ? ' + Code' : ''}${provider.capacites.mcp ? ' + MCP' : ''}</div>
  <div class="provider-methods">
    ${provider.methodesAuth.map((m) => `<span class="method-badge ${m}">${m}</span>`).join('')}
  </div>
  <div class="provider-actions">
    ${provider.methodesAuth.includes('oauth2') ? `<button class="btn-connect oauth" onclick="connectOAuth('${provider.id}')">OAuth</button>` : ''}
    ${provider.methodesAuth.includes('api-key') ? `<button class="btn-connect api-key" onclick="connectApiKey('${provider.id}')">Clé API</button>` : ''}
    ${provider.methodesAuth.includes('mcp') ? `<button class="btn-connect mcp" onclick="connectMcp('${provider.id}')">MCP</button>` : ''}
    ${provider.methodesAuth.includes('none') ? `<button class="btn-connect" onclick="connectLocal('${provider.id}')">Connecter</button>` : ''}
    ${connecte ? `<button class="btn-connect connected" onclick="disconnect('${connexion?.id}')">✓ Connecté</button>` : ''}
  </div>
</div>`;
}