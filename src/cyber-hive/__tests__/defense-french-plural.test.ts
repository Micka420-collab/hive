// Tests pour la détection des formes plurielles françaises dans le parsing SQLMap.
// Vérifie que "injectables" et "vulnérables" (pluriels) sont correctement détectés.
import { describe, it, expect } from 'vitest';
import { creerAnalyseurDefense } from '../defense.js';
import type { SessionPentest } from '../types.js';

function sessionSqlmap(stdout: string): SessionPentest {
  const session: SessionPentest = {
    id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
    statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
  };
  session.etapes.push({
    id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
    severite: 'info', description: 'SQLMap scan', ts: Date.now(), dureeMs: 100,
    outilId: 'sqlmap',
    resultat: { succes: true, stdout, stderr: '', codeRetour: 0, dureeMs: 100 },
  });
  return session;
}

describe('AnalyseurDefense — SQLMap formes plurielles françaises', () => {
  it('détecte "sont injectables" (pluriel FR)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('les paramètres id et name sont injectables'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('détecte "sont vulnérables" (pluriel FR)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('les paramètres sont vulnérables à l\'injection SQL'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('détecte "est injectables" (grammaire incorrecte mais matchée)', () => {
    // "est injectables" est grammaticalement incorrect mais la regex le matche
    // car SQLMap génère du texte machine qui n'est pas toujours parfait.
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('le paramètre est injectables'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
  });

  it('ne détecte pas "ne sont pas injectables" (négation FR)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('les paramètres ne sont pas injectables'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('détecte toujours "est injectable" (singulier FR, non-régression)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('le paramètre id est injectable'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('détecte toujours "est vulnérable" (singulier FR, non-régression)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('la cible est vulnérable à l\'injection SQL'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('détecte "are injectable" (EN, non-régression)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('the parameters are injectable'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
  });

  it('détecte "is vulnerable" (EN, non-régression)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('the parameter is vulnerable'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
  });

  it('ne détecte pas "do not appear to be injectable" (négation EN)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('all tested parameters do not appear to be injectable'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('ne détecte pas "not vulnerable" (négation EN)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('the target is not vulnerable'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('ne détecte pas une sortie sans injection', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('scan terminé, aucun paramètre testé'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeUndefined();
  });

  it('détecte "sont vulnerable" sans accent (non-régression regex [eé])', () => {
    // Le regex [eé] doit matcher "vulnerable" (sans accent) ET "vulnérable" (avec accent)
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('les paramètres sont vulnerable a injection SQL'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
    expect(sqli?.severite).toBe('critique');
  });

  it('détecte "are injectables" (EN pluriel)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('the parameters are injectables'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
  });

  it('détecte "are vulnerables" (EN pluriel sans accent)', () => {
    const a = creerAnalyseurDefense();
    const p = a.analyserSession(sessionSqlmap('the parameters are vulnerables'));
    const sqli = p.recommandations.find((r) => r.titre === 'Injection SQL confirmée');
    expect(sqli).toBeDefined();
  });
});