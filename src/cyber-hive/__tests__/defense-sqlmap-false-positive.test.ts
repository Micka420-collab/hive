// Tests pour le parsing des résultats SQLMap dans le module défense.
// Vérifie que les paramètres non injectables ne déclenchent pas de faux positifs.
import { describe, it, expect } from 'vitest';
import { creerAnalyseurDefense } from '../defense.js';
import { ANTI_TRACE_DEFAUT, type SessionPentest } from '../types.js';

function sessionSqlmap(stdout: string): SessionPentest {
  const now = Date.now();
  return {
    id: 'test',
    nom: 'test',
    cible: { hote: 'localhost', type: 'reseau', scopeAutorise: ['localhost'] },
    statut: 'termine',
    agents: [],
    etapes: [{
      id: 'e1',
      sessionId: 'test',
      agentId: 'a1',
      type: 'reconnaissance',
      severite: 'info',
      description: 'SQLMap scan',
      explication: 'Recherche d’injections SQL.',
      ts: now,
      dureeMs: 100,
      resultat: { outilId: 'sqlmap', succes: true, stdout, stderr: '', codeSortie: 0, dureeMs: 100, ts: now },
    }],
    antiTrace: ANTI_TRACE_DEFAUT,
    outilsDisponibles: ['sqlmap'],
    creeeAt: now,
    termineeAt: now,
  };
}

describe('AnalyseurDefense — parsing SQLMap', () => {
  it("ne déclenche pas d'alerte pour \"do not appear to be injectable\"", () => {
    const a = creerAnalyseurDefense();
    const session = sessionSqlmap('all tested parameters do not appear to be injectable');
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it("ne déclenche pas d'alerte pour \"not injectable\"", () => {
    const a = creerAnalyseurDefense();
    const session = sessionSqlmap('Parameter: id - Type: GET - not injectable');
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it("ne déclenche pas d'alerte pour \"not vulnerable\"", () => {
    const a = creerAnalyseurDefense();
    const session = sessionSqlmap('target is not vulnerable to SQL injection');
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('déclenche bien une alerte pour "is injectable" (non-régression)', () => {
    const a = creerAnalyseurDefense();
    const session = sessionSqlmap('Parameter: id - Type: GET - is injectable');
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('déclenche bien une alerte pour "is vulnerable" (non-régression)', () => {
    const a = creerAnalyseurDefense();
    const session = sessionSqlmap('target is vulnerable to SQL injection');
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('déclenche bien une alerte pour "est vulnérable" en français (non-régression)', () => {
    const a = creerAnalyseurDefense();
    const session = sessionSqlmap("la cible est vulnérable à l'injection SQL");
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });
});
