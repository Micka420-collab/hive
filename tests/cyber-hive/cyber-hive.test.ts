// Tests pour le module Cyber Hive.
// Valide les types, le registre d'outils, le serveur MCP, l'anti-traçage,
// l'orchestrateur, le visualiseur et le moteur autonome.

import { describe, it, expect } from 'vitest';
import {
  listerOutils,
  obtenirOutil,
  outilsParCategorie,
  outilsParTag,
  outilExiste,
} from '../tool-registry.js';
import { creerServeurMCP } from '../mcp-server.js';
import { CONFIG_DEFAUT, ANTI_TRACE_DEFAUT } from '../types.js';
import { creerOrchestrateur } from '../pentest-orchestrator.js';
import { creerVisualiseur } from '../attack-visualizer.js';
import {
  genererMACAleatoire,
  userAgentAleatoire,
  nouvelleIdentite,
  construireCommande,
  prefixeProxychains,
} from '../anti-trace.js';
import { MoteurAutonome } from '../autonomous-agent.js';
import type { SessionPentest, CiblePentest, ConfigAntiTrace } from '../types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Registre d'outils
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('Registre d'outils', () => {
  it('liste au moins 9 outils', () => {
    const outils = listerOutils();
    expect(outils.length).toBeGreaterThanOrEqual(9);
  });

  it('trouve nmap par son id', () => {
    const nmap = obtenirOutil('nmap');
    expect(nmap).toBeDefined();
    expect(nmap?.nom).toBe('Nmap');
    expect(nmap?.categorie).toBe('scan');
  });

  it('filtre par catégorie scan', () => {
    const scans = outilsParCategorie('scan');
    expect(scans.length).toBeGreaterThanOrEqual(2);
    expect(scans.every((o) => o.categorie === 'scan')).toBe(true);
  });

  it('filtre par tag reseau', () => {
    const reseaux = outilsParTag('reseau');
    expect(reseaux.length).toBeGreaterThanOrEqual(2);
  });

  it('outilExiste retourne true pour nmap, false pour inexistant', () => {
    expect(outilExiste('nmap')).toBe(true);
    expect(outilExiste('inexistant')).toBe(false);
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Serveur MCP
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('Serveur MCP', () => {
  it('crée un serveur avec la config par défaut', () => {
    const serveur = creerServeurMCP(CONFIG_DEFAUT.mcp);
    expect(serveur.estEnMarche()).toBe(false);
    expect(serveur.getOutils().length).toBeGreaterThan(0);
  });

  it('liste les outils au format MCP', () => {
    const serveur = creerServeurMCP(CONFIG_DEFAUT.mcp);
    const defs = serveur.listerOutilsMCP();
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].name).toBeDefined();
    expect(defs[0].inputSchema.required).toContain('cible');
  });

  it('répond au ping', async () => {
    const serveur = creerServeurMCP(CONFIG_DEFAUT.mcp);
    const reponse = await serveur.traiterRequete({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
    });
    expect(reponse.result).toEqual({ pong: true });
  });

  it('retourne une erreur pour une méthode inconnue', async () => {
    const serveur = creerServeurMCP(CONFIG_DEFAUT.mcp);
    const reponse = await serveur.traiterRequete({
      jsonrpc: '2.0',
      id: 2,
      method: 'methode_inexistante',
    });
    expect(reponse.error).toBeDefined();
    expect(reponse.error?.code).toBe(-32601);
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Anti-traçage
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('Anti-traçage', () => {
  it('génère une MAC aléatoire valide', () => {
    const mac = genererMACAleatoire();
    expect(mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  });

  it('génère un User-Agent non vide', () => {
    const ua = userAgentAleatoire();
    expect(ua.length).toBeGreaterThan(10);
    expect(ua).toContain('Mozilla');
  });

  it('crée une nouvelle identité avec tous les champs', () => {
    const identite = nouvelleIdentite();
    expect(identite.userAgent).toBeDefined();
    expect(identite.mac).toBeDefined();
    expect(identite.timestamp).toBeGreaterThan(0);
  });

  it('construit une commande avec proxychains quand activé', () => {
    const config: ConfigAntiTrace = { ...ANTI_TRACE_DEFAUT, proxychains: true };
    const cmd = construireCommande('nmap', ['-sV'], config);
    expect(cmd).toContain('proxychains');
    expect(cmd).toContain('nmap');
  });

  it('ne préfixe pas sans proxychains', () => {
    const config: ConfigAntiTrace = { ...ANTI_TRACE_DEFAUT, proxychains: false };
    const cmd = construireCommande('nmap', ['-sV'], config);
    expect(cmd).not.toContain('proxychains');
    expect(cmd).toContain('nmap');
  });

  it('prefixeProxychains retourne la chaîne correcte', () => {
    expect(prefixeProxychains({ ...ANTI_TRACE_DEFAUT, proxychains: true })).toBe('proxychains ');
    expect(prefixeProxychains({ ...ANTI_TRACE_DEFAUT, proxychains: false })).toBe('');
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Orchestrateur
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('Orchestrateur de pentest', () => {
  it('crée une session', () => {
    const orch = creerOrchestrateur(CONFIG_DEFAUT);
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session = orch.creerSession('Test', cible);
    expect(session.id).toBeDefined();
    expect(session.statut).toBe('initialisation');
    expect(session.cible.hote).toBe('127.0.0.1');
  });

  it('assigne des agents', () => {
    const orch = creerOrchestrateur(CONFIG_DEFAUT);
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session = orch.creerSession('Test', cible);
    const agents = orch.assignerAgents(session.id, ['reconnaissance', 'exploitation']);
    expect(agents.length).toBe(2);
    expect(agents[0].role).toBe('reconnaissance');
    expect(agents[1].role).toBe('exploitation');
  });

  it('lance la phase de reconnaissance', async () => {
    const orch = creerOrchestrateur(CONFIG_DEFAUT);
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session = orch.creerSession('Test', cible);
    orch.assignerAgents(session.id, ['reconnaissance']);
    const etapes = await orch.phaseReconnaissance(session.id);
    expect(etapes.length).toBeGreaterThan(0);
    expect(etapes[0].type).toBe('reconnaissance');
  });

  it('termine une session', async () => {
    const orch = creerOrchestrateur(CONFIG_DEFAUT);
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session = orch.creerSession('Test', cible);
    orch.assignerAgents(session.id, ['reconnaissance']);
    await orch.phaseReconnaissance(session.id);
    const finale = await orch.terminerSession(session.id);
    expect(finale.statut).toBe('termine');
    expect(finale.termineeAt).not.toBeNull();
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Visualiseur
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('Visualiseur d'attaques', () => {
  it('génère un résumé de session', () => {
    const orch = creerOrchestrateur(CONFIG_DEFAUT);
    const vis = creerVisualiseur();
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session = orch.creerSession('Test', cible);
    orch.assignerAgents(session.id, ['reconnaissance']);
    const resume = vis.genererResume(session);
    expect(resume.sessionId).toBe(session.id);
    expect(resume.cible).toBe('127.0.0.1');
    expect(resume.nbAgents).toBe(1);
  });

  it('génère un rapport complet', async () => {
    const orch = creerOrchestrateur(CONFIG_DEFAUT);
    const vis = creerVisualiseur();
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session = orch.creerSession('Test', cible);
    orch.assignerAgents(session.id, ['reconnaissance']);
    await orch.phaseReconnaissance(session.id);
    await orch.terminerSession(session.id);
    const rapport = vis.genererRapport(session);
    expect(rapport.resume).toContain('Rapport de pentest');
    expect(rapport.recommandations.length).toBeGreaterThan(0);
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Moteur autonome
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('Moteur autonome', () => {
  it('lance la boucle et génère des étapes', async () => {
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session: SessionPentest = {
      id: 'test-session',
      nom: 'Test autonome',
      cible,
      statut: 'reconnaissance',
      agents: [],
      etapes: [],
      antiTrace: ANTI_TRACE_DEFAUT,
      outilsDisponibles: ['nmap', 'nikto', 'nuclei', 'hydra', 'ffuf', 'sqlmap'],
      creeeAt: Date.now(),
      termineeAt: null,
    };

    const moteur = new MoteurAutonome(session, 'agent-test', 5);
    const etapes = await moteur.lancer();
    expect(etapes.length).toBeGreaterThan(0);
    expect(moteur.getIterations()).toBeGreaterThan(0);
  });

  it('s'arrête quand il n'y a plus rien à faire', async () => {
    const cible: CiblePentest = {
      hote: '127.0.0.1',
      type: 'reseau',
      scopeAutorise: ['127.0.0.1'],
    };
    const session: SessionPentest = {
      id: 'test-session-2',
      nom: 'Test arrêt',
      cible,
      statut: 'reconnaissance',
      agents: [],
      etapes: [],
      antiTrace: { ...ANTI_TRACE_DEFAUT, delaiAleatoireMs: 0 },
      outilsDisponibles: ['nmap'],
      creeeAt: Date.now(),
      termineeAt: null,
    };

    const moteur = new MoteurAutonome(session, 'agent-test', 3);
    const etapes = await moteur.lancer();
    // En mode simulation, le moteur fait au moins une action (Nmap)
    expect(etapes.length).toBeGreaterThanOrEqual(1);
  });

  it('maintient un contexte de cible', async () => {
    const cible: CiblePentest = {
      hote: '10.0.0.1',
      type: 'reseau',
      scopeAutorise: ['10.0.0.1'],
    };
    const session: SessionPentest = {
      id: 'test-session-3',
      nom: 'Test contexte',
      cible,
      statut: 'reconnaissance',
      agents: [],
      etapes: [],
      antiTrace: { ...ANTI_TRACE_DEFAUT, delaiAleatoireMs: 0 },
      outilsDisponibles: ['nmap', 'nikto', 'nuclei'],
      creeeAt: Date.now(),
      termineeAt: null,
    };

    const moteur = new MoteurAutonome(session, 'agent-test', 3);
    await moteur.lancer();
    const ctx = moteur.getContexte();
    expect(ctx.hote).toBe('10.0.0.1');
    expect(ctx.actionsEffectuees.size).toBeGreaterThan(0);
  });
});