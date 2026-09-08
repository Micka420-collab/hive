// Tests pour le système de connexion IA de Cyber Hive.
import { describe, it, expect } from 'vitest';
import { genererCodeVerifier, genererState } from '../connection-manager';
import { creerGestionnaireConnexions } from '../connection-manager';
import { listerProviders, obtenirProvider, providersParType, providersMcp } from '../provider-registry';
import { creerGestionnaireMcp, SERVEURS_MCP_PREDEFINIS } from '../mcp-client';
import { creerOrchestrateurIA } from '../ai-orchestrator';

describe('connection-types', () => {
  it('génère un code verifier PKCE valide', () => {
    const verifier = genererCodeVerifier();
    expect(verifier).toBeTruthy();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it('génère un state CSRF unique', () => {
    const state1 = genererState();
    const state2 = genererState();
    expect(state1).toBeTruthy();
    expect(state2).toBeTruthy();
    expect(state1).not.toBe(state2);
  });
});

describe('provider-registry', () => {
  it('liste tous les providers', () => {
    const providers = listerProviders();
    expect(providers.length).toBeGreaterThanOrEqual(15);
  });

  it('trouve un provider par ID', () => {
    const claude = obtenirProvider('claude');
    expect(claude).toBeDefined();
    expect(claude?.nom).toContain('Claude');
  });

  it('filtre par type LLM', () => {
    const llms = providersParType('llm');
    expect(llms.length).toBeGreaterThanOrEqual(5);
    expect(llms.some((p) => p.id === 'claude')).toBe(true);
    expect(llms.some((p) => p.id === 'openai')).toBe(true);
  });

  it('filtre les providers MCP', () => {
    const mcps = providersMcp();
    expect(mcps.length).toBeGreaterThanOrEqual(5);
    expect(mcps.some((p) => p.id === 'claude')).toBe(true);
  });

  it('inclut les serveurs MCP externes', () => {
    const autopentest = obtenirProvider('autopentest-mcp');
    expect(autopentest).toBeDefined();
    expect(autopentest?.type).toBe('mcp-server');
  });

  it('inclut Ollama comme provider local', () => {
    const ollama = obtenirProvider('ollama');
    expect(ollama).toBeDefined();
    expect(ollama?.type).toBe('local');
    expect(ollama?.methodesAuth).toContain('none');
  });
});

describe('connection-manager', () => {
  it('crée un gestionnaire de connexions', () => {
    const gm = creerGestionnaireConnexions();
    expect(gm).toBeDefined();
    expect(gm.listerConnexions()).toHaveLength(0);
  });

  it('connecte un provider via clé API', () => {
    const gm = creerGestionnaireConnexions();
    const result = gm.connecterCleApi('claude', 'sk-test-key');
    expect('id' in result).toBe(true);
    expect(gm.estConnecte('claude')).toBe(true);
  });

  it('connecte un provider local', () => {
    const gm = creerGestionnaireConnexions();
    const result = gm.connecterLocal('ollama');
    expect('id' in result).toBe(true);
    expect(gm.estConnecte('ollama')).toBe(true);
  });

  it('refuse un provider inexistant', () => {
    const gm = creerGestionnaireConnexions();
    const result = gm.connecterCleApi('inexistant', 'key');
    expect('erreur' in result).toBe(true);
  });

  it('déconnecte une connexion', () => {
    const gm = creerGestionnaireConnexions();
    const result = gm.connecterCleApi('openai', 'sk-test');
    if ('id' in result) {
      gm.deconnecter(result.id);
      expect(gm.estConnecte('openai')).toBe(false);
    }
  });
});

describe('mcp-client', () => {
  it('crée un gestionnaire MCP', () => {
    const gm = creerGestionnaireMcp();
    expect(gm).toBeDefined();
    expect(gm.listerClients()).toHaveLength(0);
  });

  it('a des serveurs MCP pré-définis', () => {
    expect(SERVEURS_MCP_PREDEFINIS.length).toBeGreaterThanOrEqual(8);
    expect(SERVEURS_MCP_PREDEFINIS.some((s) => s.id === 'autopentest-mcp')).toBe(true);
    expect(SERVEURS_MCP_PREDEFINIS.some((s) => s.id === 'hexstrike-mcp')).toBe(true);
    expect(SERVEURS_MCP_PREDEFINIS.some((s) => s.id === 'shannon-mcp')).toBe(true);
    expect(SERVEURS_MCP_PREDEFINIS.some((s) => s.id === 'zen-ai-pentest-mcp')).toBe(true);
  });

  it('cherche un outil dans aucun serveur connecté', async () => {
    const gm = creerGestionnaireMcp();
    const result = await gm.appelerOutilGlobal('nmap', { cible: '127.0.0.1' });
    expect(result.success).toBe(false);
    expect(result.erreur).toContain('non trouvé');
  });
});

describe('ai-orchestrator', () => {
  it('crée un orchestrateur', () => {
    const orch = creerOrchestrateurIA();
    expect(orch).toBeDefined();
    expect(orch.obtenirEtat()).toBe('inactif');
  });

  it('définit le provider LLM', () => {
    const orch = creerOrchestrateurIA();
    orch.definirProviderLLM('openai');
    expect(orch.obtenirConnexions()).toBeDefined();
  });

  it('initialise avec une cible', async () => {
    const orch = creerOrchestrateurIA();
    const result = await orch.initialiser('192.168.1.1');
    expect(result.erreur).toBeUndefined();
    expect(orch.obtenirEtat()).toBe('actif');
    expect(orch.obtenirContexte()?.cible).toBe('192.168.1.1');
    expect(orch.obtenirContexte()?.phase).toBe('reconnaissance');
  });

  it('met en pause et reprend', async () => {
    const orch = creerOrchestrateurIA();
    await orch.initialiser('example.com');
    orch.pause();
    expect(orch.obtenirEtat()).toBe('pause');
    orch.reprendre();
    expect(orch.obtenirEtat()).toBe('actif');
  });

  it('arrête l\'orchestrateur', async () => {
    const orch = creerOrchestrateurIA();
    await orch.initialiser('example.com');
    orch.arreter();
    expect(orch.obtenirEtat()).toBe('inactif');
    expect(orch.obtenirContexte()).toBeNull();
  });
});