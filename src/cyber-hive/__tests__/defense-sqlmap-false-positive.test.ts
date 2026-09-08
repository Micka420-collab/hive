// Tests pour le parsing des résultats SQLMap dans le module défense.
// Vérifie que les paramètres non injectables ne déclenchent pas de faux positifs.
import { describe, it, expect } from 'vitest';
import { creerAnalyseurDefense } from '../defense.ts';
import type { SessionPentest } from '../types.ts';

describe('AnalyseurDefense — parsing SQLMap', () => {
  it('ne déclenche pas d'alerte pour "do not appear to be injectable"', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'SQLMap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'sqlmap',
      resultat: { succes: true, stdout: 'all tested parameters do not appear to be injectable', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('ne déclenche pas d'alerte pour "not injectable"', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'SQLMap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'sqlmap',
      resultat: { succes: true, stdout: 'Parameter: id - Type: GET - not injectable', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('ne déclenche pas d'alerte pour "not vulnerable"', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'SQLMap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'sqlmap',
      resultat: { succes: true, stdout: 'target is not vulnerable to SQL injection', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('déclenche bien une alerte pour "is injectable" (non-régression)', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'SQLMap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'sqlmap',
      resultat: { succes: true, stdout: 'Parameter: id - Type: GET - is injectable', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('déclenche bien une alerte pour "is vulnerable" (non-régression)', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'SQLMap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'sqlmap',
      resultat: { succes: true, stdout: 'target is vulnerable to SQL injection', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('déclenche bien une alerte pour "est vulnérable" en français (non-régression)', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'SQLMap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'sqlmap',
      resultat: { succes: true, stdout: 'la cible est vulnérable à l\'injection SQL', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });
});