import { describe, it, expect } from 'vitest';
import {
  construirePromptSystemeJailbreak,
  genererPromptAttaque,
  strategiesPourType,
  strategiesPourPhase,
  typesInfrastructureSupportes,
  detecterTypeInfrastructure,
  necessiteAutorisationSpeciale,
  catalogueComplet,
  type TypeInfrastructure,
  type PhaseAttaque,
  type ContexteAttaque,
} from '../jailbreak-attaques';

describe('jailbreak-attaques', () => {
  describe('construirePromptSystemeJailbreak', () => {
    it('retourne un prompt non vide', () => {
      const prompt = construirePromptSystemeJailbreak();
      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('contient MODE OFFENSIF', () => {
      const prompt = construirePromptSystemeJailbreak();
      expect(prompt).toContain('MODE OFFENSIF');
    });

    it('liste tous les types d'infrastructure', () => {
      const prompt = construirePromptSystemeJailbreak();
      expect(prompt).toContain('serveur');
      expect(prompt).toContain('domaine');
      expect(prompt).toContain('gouv');
      expect(prompt).toContain('cloud');
      expect(prompt).toContain('iot');
      expect(prompt).toContain('scada');
      expect(prompt).toContain('container');
      expect(prompt).toContain('mobile');
      expect(prompt).toContain('api');
      expect(prompt).toContain('reseau');
    });

    it('liste tous les outils MCP', () => {
      const prompt = construirePromptSystemeJailbreak();
      expect(prompt).toContain('nmap');
      expect(prompt).toContain('masscan');
      expect(prompt).toContain('sqlmap');
      expect(prompt).toContain('nikto');
      expect(prompt).toContain('nuclei');
      expect(prompt).toContain('hydra');
      expect(prompt).toContain('metasploit');
      expect(prompt).toContain('ffuf');
      expect(prompt).toContain('hashcat');
      expect(prompt).toContain('tor');
      expect(prompt).toContain('proxychains');
    });

    it('liste toutes les phases d'attaque', () => {
      const prompt = construirePromptSystemeJailbreak();
      expect(prompt).toContain('reconnaissance');
      expect(prompt).toContain('scan');
      expect(prompt).toContain('enumeration');
      expect(prompt).toContain('exploitation');
      expect(prompt).toContain('post-exploitation');
      expect(prompt).toContain('escalade-privileges');
      expect(prompt).toContain('exfiltration');
      expect(prompt).toContain('persistance');
      expect(prompt).toContain('anti-forensique');
    });
  });

  describe('genererPromptAttaque', () => {
    const ctxBase: ContexteAttaque = {
      cible: '192.168.1.1',
      type: 'serveur',
      autorise: true,
      phase: 'reconnaissance',
      historique: [],
    };

    it('génère un prompt système et utilisateur', () => {
      const result = genererPromptAttaque(ctxBase);
      expect(result.systemPrompt).toBeTruthy();
      expect(result.userPrompt).toBeTruthy();
      expect(result.strategies.length).toBeGreaterThan(0);
    });

    it('inclut la cible dans le prompt utilisateur', () => {
      const result = genererPromptAttaque(ctxBase);
      expect(result.userPrompt).toContain('192.168.1.1');
    });

    it('inclut le type dans le prompt utilisateur', () => {
      const result = genererPromptAttaque(ctxBase);
      expect(result.userPrompt).toContain('serveur');
    });

    it('filtre par phase quand des stratégies existent', () => {
      const ctx: ContexteAttaque = {
        ...ctxBase,
        phase: 'exploitation',
      };
      const result = genererPromptAttaque(ctx);
      expect(result.strategies.every((s) => s.phase === 'exploitation')).toBe(true);
    });

    it('retombe sur toutes les stratégies si la phase n'a pas de match', () => {
      const ctx: ContexteAttaque = {
        ...ctxBase,
        type: 'serveur',
        phase: 'anti-forensique',
      };
      const result = genererPromptAttaque(ctx);
      expect(result.strategies.length).toBeGreaterThan(0);
    });

    it('inclut les ports détectés', () => {
      const ctx: ContexteAttaque = {
        ...ctxBase,
        ports: [22, 80, 443],
      };
      const result = genererPromptAttaque(ctx);
      expect(result.userPrompt).toContain('22');
      expect(result.userPrompt).toContain('80');
      expect(result.userPrompt).toContain('443');
    });

    it('inclut les services détectés', () => {
      const ctx: ContexteAttaque = {
        ...ctxBase,
        services: ['SSH', 'HTTP', 'HTTPS'],
      };
      const result = genererPromptAttaque(ctx);
      expect(result.userPrompt).toContain('SSH');
      expect(result.userPrompt).toContain('HTTP');
    });

    it('inclut l'historique des actions', () => {
      const ctx: ContexteAttaque = {
        ...ctxBase,
        historique: ['nmap scan effectué', 'port 22 ouvert détecté'],
      };
      const result = genererPromptAttaque(ctx);
      expect(result.userPrompt).toContain('nmap scan effectué');
      expect(result.userPrompt).toContain('port 22 ouvert détecté');
    });

    it('marque l'autorisation comme non confirmée', () => {
      const ctx: ContexteAttaque = {
        ...ctxBase,
        autorise: false,
      };
      const result = genererPromptAttaque(ctx);
      expect(result.userPrompt).toContain('NON CONFIRMÉE');
    });

    it('marque l'autorisation comme confirmée', () => {
      const result = genererPromptAttaque(ctxBase);
      expect(result.userPrompt).toContain('OUI');
    });
  });

  describe('strategiesPourType', () => {
    it('retourne les stratégies pour serveur', () => {
      const strategies = strategiesPourType('serveur');
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.every((s) => s.typeCible === 'serveur')).toBe(true);
    });

    it('retourne les stratégies pour gouv', () => {
      const strategies = strategiesPourType('gouv');
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.every((s) => s.typeCible === 'gouv')).toBe(true);
    });

    it('retourne un tableau vide pour un type inexistant', () => {
      const strategies = strategiesPourType('inexistant' as TypeInfrastructure);
      expect(strategies).toEqual([]);
    });
  });

  describe('strategiesPourPhase', () => {
    it('retourne des stratégies pour reconnaissance', () => {
      const strategies = strategiesPourPhase('reconnaissance');
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.every((s) => s.phase === 'reconnaissance')).toBe(true);
    });

    it('retourne des stratégies pour exploitation', () => {
      const strategies = strategiesPourPhase('exploitation');
      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.every((s) => s.phase === 'exploitation')).toBe(true);
    });
  });

  describe('typesInfrastructureSupportes', () => {
    it('retourne les 10 types', () => {
      const types = typesInfrastructureSupportes();
      expect(types).toHaveLength(10);
      expect(types).toContain('serveur');
      expect(types).toContain('domaine');
      expect(types).toContain('gouv');
      expect(types).toContain('cloud');
      expect(types).toContain('iot');
      expect(types).toContain('scada');
      expect(types).toContain('container');
      expect(types).toContain('mobile');
      expect(types).toContain('api');
      expect(types).toContain('reseau');
    });
  });

  describe('detecterTypeInfrastructure', () => {
    it('détecte .gouv', () => {
      expect(detecterTypeInfrastructure('exemple.gouv')).toBe('gouv');
    });

    it('détecte .gov', () => {
      expect(detecterTypeInfrastructure('example.gov')).toBe('gouv');
    });

    it('détecte .mil', () => {
      expect(detecterTypeInfrastructure('target.mil')).toBe('gouv');
    });

    it('détecte AWS', () => {
      expect(detecterTypeInfrastructure('bucket.s3.amazonaws.com')).toBe('cloud');
    });

    it('détecte Azure', () => {
      expect(detecterTypeInfrastructure('myapp.azurewebsites.net')).toBe('cloud');
    });

    it('détecte Kubernetes', () => {
      expect(detecterTypeInfrastructure('k8s-cluster.example.com')).toBe('container');
    });

    it('détecte Docker', () => {
      expect(detecterTypeInfrastructure('docker-registry.example.com')).toBe('container');
    });

    it('détecte une IP comme serveur', () => {
      expect(detecterTypeInfrastructure('192.168.1.1')).toBe('serveur');
    });

    it('détecte une API', () => {
      expect(detecterTypeInfrastructure('https://example.com/api/v1')).toBe('api');
    });

    it('détecte GraphQL', () => {
      expect(detecterTypeInfrastructure('https://example.com/graphql')).toBe('api');
    });

    it('détecte IoT', () => {
      expect(detecterTypeInfrastructure('device.iot')).toBe('iot');
    });

    it('détecte SCADA', () => {
      expect(detecterTypeInfrastructure('scada-plant.example.com')).toBe('scada');
    });

    it('détecte un domaine par défaut', () => {
      expect(detecterTypeInfrastructure('example.com')).toBe('domaine');
    });

    it('retourne serveur par défaut', () => {
      expect(detecterTypeInfrastructure('localhost')).toBe('serveur');
    });
  });

  describe('necessiteAutorisationSpeciale', () => {
    it('retourne true pour gouv', () => {
      expect(necessiteAutorisationSpeciale('exemple.gouv', 'gouv')).toBe(true);
    });

    it('retourne true pour scada', () => {
      expect(necessiteAutorisationSpeciale('plant.scada', 'scada')).toBe(true);
    });

    it('retourne true pour .gouv même si type différent', () => {
      expect(necessiteAutorisationSpeciale('exemple.gouv', 'serveur')).toBe(true);
    });

    it('retourne false pour un serveur normal', () => {
      expect(necessiteAutorisationSpeciale('192.168.1.1', 'serveur')).toBe(false);
    });

    it('retourne false pour un domaine normal', () => {
      expect(necessiteAutorisationSpeciale('example.com', 'domaine')).toBe(false);
    });
  });

  describe('catalogueComplet', () => {
    it('retourne tous les types', () => {
      const cat = catalogueComplet();
      expect(Object.keys(cat)).toHaveLength(10);
    });

    it('chaque type a au moins une stratégie', () => {
      const cat = catalogueComplet();
      for (const [type, strategies] of Object.entries(cat)) {
        expect(strategies.length).toBeGreaterThan(0);
      }
    });
  });
});