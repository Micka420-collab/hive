// Tests pour les nouveaux modules Cyber Hive v2.
import { describe, it, expect } from 'vitest';
import { parserCibleNaturelle, validerCible } from './natural-language.js';
import { creerAnalyseurDefense } from './defense.js';
import { creerGenerateurRapport } from './report-generator.js';
import { creerGestionnaireAntiTraceV2 } from './anti-trace-v2.js';
import type { SessionPentest } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Parseur langage naturel
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('parserCibleNaturelle', () => {
  it('parse une IP simple', () => {
    const r = parserCibleNaturelle('192.168.1.1');
    expect(r.cible.hote).toBe('192.168.1.1');
    expect(r.cible.type).toBe('reseau');
    expect(r.confiance).toBeGreaterThan(0.8);
  });

  it('parse une IP avec port', () => {
    const r = parserCibleNaturelle('192.168.1.1:8080');
    expect(r.cible.hote).toBe('192.168.1.1');
    expect(r.cible.ports).toEqual([8080]);
  });

  it('parse une URL complète', () => {
    const r = parserCibleNaturelle('https://example.com');
    expect(r.cible.hote).toBe('example.com');
    expect(r.cible.type).toBe('web');
    expect(r.cible.url).toBe('https://example.com');
  });

  it('parse un domaine avec ports', () => {
    const r = parserCibleNaturelle('test example.com ports 80,443');
    expect(r.cible.hote).toBe('example.com');
    expect(r.cible.ports).toEqual([80, 443]);
  });

  it('parse un CIDR', () => {
    const r = parserCibleNaturelle('scan 192.168.1.0/24');
    expect(r.cible.hote).toBe('192.168.1.0');
    expect(r.cible.scopeAutorise).toContain('192.168.1.0/24');
  });

  it('détecte le type API', () => {
    const r = parserCibleNaturelle('test https://api.example.com');
    expect(r.cible.type).toBe('api');
  });

  it('retourne faible confiance pour entrée inconnue', () => {
    const r = parserCibleNaturelle('xyzabc123');
    expect(r.confiance).toBeLessThan(0.5);
  });
});

describe('validerCible', () => {
  it('valide une cible correcte', () => {
    const r = validerCible({ hote: '192.168.1.1', type: 'reseau' });
    expect(r.valide).toBe(true);
  });

  it('rejette un port invalide', () => {
    const r = validerCible({ hote: '192.168.1.1', type: 'reseau', ports: [99999] });
    expect(r.valide).toBe(false);
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Module défense
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('AnalyseurDefense', () => {
  it('analyse une session vide', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'terminee', etapes: [], creeeAt: Date.now(), antiTrace: {} as any,
    };
    const p = a.analyserSession(session);
    expect(p.score).toBe(100);
    expect(p.niveau).toBe('A');
  });

  it('déduit des points pour des vulnérabilités', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'terminee', etapes: [], creeeAt: Date.now(), antiTrace: {} as any,
    };
    // Simuler une étape avec telnet détecté
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'nmap',
      resultat: { succes: true, stdout: '23/tcp open telnet', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    expect(p.score).toBeLessThan(100);
    expect(p.recommandations.length).toBeGreaterThan(0);
    expect(p.faiblesses.length).toBeGreaterThan(0);
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Générateur de rapport
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

describe('GenerateurRapport', () => {
  it('génère un rapport Markdown', () => {
    const g = creerGenerateurRapport();
    const rapport = {
      session: {
        id: 'test', nom: 'Test Pentest', cible: { hote: 'localhost', type: 'reseau' },
        statut: 'terminee', etapes: [], creeeAt: Date.now(), antiTrace: {} as any,
      },
      posture: { score: 75, niveau: 'B' as const, forces: [], faiblesses: ['Test'], recommandations: [], resume: 'Test' },
      tracesAntiForensics: [],
      dateGeneration: Date.now(),
    };
    const md = g.genererMarkdown(rapport);
    expect(md).toContain('# Rapport de Pentest');
    expect(md).toContain('Posture de sécurité');
    expect(md).toContain('75/100');
  });

  it('génère un rapport HTML', () => {
    const g = creerGenerateurRapport();
    const rapport = {
      session: {
        id: 'test', nom: 'Test Pentest', cible: { hote: 'localhost', type: 'reseau' },
        statut: 'terminee', etapes: [], creeeAt: Date.now(), antiTrace: {} as any,
      },
      posture: { score: 50, niveau: 'C' as const, forces: [], faiblesses: [], recommandations: [], resume: 'Test' },
      tracesAntiForensics: [],
      dateGeneration: Date.now(),
    };
    const html = g.genererHTML(rapport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Rapport de Pentest');
    expect(html).toContain('50');
  });

  it('génère un rapport JSON', () => {
    const g = creerGenerateurRapport();
    const rapport = {
      session: {
        id: 'test', nom: 'Test', cible: { hote: 'localhost', type: 'reseau' },
        statut: 'terminee', etapes: [], creeeAt: Date.now(), antiTrace: {} as any,
      },
      posture: { score: 100, niveau: 'A' as const, forces: [], faiblesses: [], recommandations: [], resume: 'OK' },
      tracesAntiForensics: [],
      dateGeneration: Date.now(),
    };
    const json = g.genererJSON(rapport);
    const parsed = JSON.parse(json);
    expect(parsed.session.id).toBe('test');
  });
});

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Anti-trace v2
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌�iche', () => {
  it('exécute la séquence complète en mode simulation', async () => {
    const m = creerGestionnaireAntiTraceV2({ modeSimulation: true });
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'en_cours', etapes: [], creeeAt: Date.now(), antiTrace: {} as any,
    };
    const actions = await m.executerSequenceComplete(session);
    expect(actions.length).toBeGreaterThan(10);
    expect(actions.every(a => a.statut === 'simule')).toBe(true);
  });

  it('génère une identité spoofée', () => {
    const m = creerGestionnaireAntiTraceV2();
    const id = m.getIdentiteCourante();
    expect(id.userAgent).toBeTruthy();
    expect(id.mac).toMatch(/^[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}$/);
    expect(id.sessionId).toHaveLength(32);
  });

  it('injecte un faux drapeau', async () => {
    const m = creerGestionnaireAntiTraceV2({ modeSimulation: true, fauxDrapeau: true });
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'en_cours', etapes: [], creeeAt: Date.now(), antiTrace: {} as any,
    };
    await m.executerSequenceComplete(session);
    const actions = m.getActions();
    const fauxDrapeau = actions.find(a => a.nom === 'faux-drapeau');
    expect(fauxDrapeau).toBeDefined();
    expect(fauxDrapeau?.details).toContain('APT');
  });
});