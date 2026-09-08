// Tests pour les améliorations du module défense.
// Couvre la détection étendue de ports, SSL/TLS, versions et CVSS.
import { describe, it, expect } from 'vitest';
import { creerAnalyseurDefense } from '../defense.ts';
import type { SessionPentest } from '../types.ts';

/** Crée une session de test avec une étape Nmap. */
function sessionNmap(stdout: string): SessionPentest {
  return {
    id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
    statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    outilsDisponibles: [],
    agents: [],
  };
}

/** Ajoute une étape Nmap à une session. */
function avecEtapeNmap(session: SessionPentest, stdout: string): SessionPentest {
  session.etapes.push({
    id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
    severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
    outilId: 'nmap',
    resultat: { succes: true, stdout, stderr: '', codeRetour: 0, dureeMs: 100 },
  });
  return session;
}

describe('AnalyseurDefense — détection étendue de ports', () => {
  it('détecte MySQL exposé (port 3306)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('3306/tcp open mysql'), '3306/tcp open mysql');
    const p = a.analyserSession(session);
    const mysql = p.recommandations.find((r) => r.titre === 'MySQL exposé publiquement');
    expect(mysql).toBeDefined();
    expect(mysql?.severite).toBe('eleve');
    expect(mysql?.cvssScore).toBe(9.8);
  });

  it('détecte PostgreSQL exposé (port 5432)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('5432/tcp open postgresql'), '5432/tcp open postgresql');
    const p = a.analyserSession(session);
    const pg = p.recommandations.find((r) => r.titre === 'PostgreSQL exposé publiquement');
    expect(pg).toBeDefined();
    expect(pg?.severite).toBe('eleve');
  });

  it('détecte Redis exposé (port 6379)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('6379/tcp open redis'), '6379/tcp open redis');
    const p = a.analyserSession(session);
    const redis = p.recommandations.find((r) => r.titre === 'Redis exposé sans authentification');
    expect(redis).toBeDefined();
    expect(redis?.severite).toBe('critique');
  });

  it('détecte MongoDB exposé (port 27017)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('27017/tcp open mongodb'), '27017/tcp open mongodb');
    const p = a.analyserSession(session);
    const mongo = p.recommandations.find((r) => r.titre === 'MongoDB exposé publiquement');
    expect(mongo).toBeDefined();
    expect(mongo?.severite).toBe('critique');
  });

  it('détecte Elasticsearch exposé (port 9200)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('9200/tcp open http'), '9200/tcp open http');
    const p = a.analyserSession(session);
    const es = p.recommandations.find((r) => r.titre === 'Elasticsearch exposé publiquement');
    expect(es).toBeDefined();
    expect(es?.severite).toBe('critique');
  });

  it('ne déclenche pas de faux positif pour le port 33060 au lieu de 3306', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('33060/tcp open mysqlx'), '33060/tcp open mysqlx');
    const p = a.analyserSession(session);
    const mysql = p.recommandations.find((r) => r.titre === 'MySQL exposé publiquement');
    expect(mysql).toBeUndefined();
  });
});

describe('AnalyseurDefense — SSL/TLS', () => {
  it('détecte SSLv2 activé', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('SSLv2 enabled'), 'SSLv2 enabled');
    const p = a.analyserSession(session);
    const sslv2 = p.recommandations.find((r) => r.titre === 'SSLv2 activé');
    expect(sslv2).toBeDefined();
    expect(sslv2?.severite).toBe('critique');
  });

  it('détecte SSLv3 activé', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('SSLv3 enabled'), 'SSLv3 enabled');
    const p = a.analyserSession(session);
    const sslv3 = p.recommandations.find((r) => r.titre === 'SSLv3 activé');
    expect(sslv3).toBeDefined();
    expect(sslv3?.severite).toBe('eleve');
  });

  it('détecte TLS 1.0 activé', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('TLS 1.0 enabled'), 'TLS 1.0 enabled');
    const p = a.analyserSession(session);
    const tls10 = p.recommandations.find((r) => r.titre === 'TLS 1.0 activé');
    expect(tls10).toBeDefined();
    expect(tls10?.severite).toBe('moyenne');
  });

  it('détecte TLS 1.1 activé', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('TLS 1.1 enabled'), 'TLS 1.1 enabled');
    const p = a.analyserSession(session);
    const tls11 = p.recommandations.find((r) => r.titre === 'TLS 1.1 activé');
    expect(tls11).toBeDefined();
    expect(tls11?.severite).toBe('faible');
  });

  it('détecte le chiffrement RC4', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('TLS RC4-SHA'), 'TLS RC4-SHA');
    const p = a.analyserSession(session);
    const rc4 = p.recommandations.find((r) => r.titre === 'Chiffrement RC4 supporté');
    expect(rc4).toBeDefined();
    expect(rc4?.severite).toBe('eleve');
  });

  it('détecte le chiffrement 3DES', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('TLS 3DES-EDE-CBC'), 'TLS 3DES-EDE-CBC');
    const p = a.analyserSession(session);
    const des = p.recommandations.find((r) => r.titre === 'Chiffrement 3DES/DES supporté');
    expect(des).toBeDefined();
  });

  it('détecte le chiffrement NULL', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('TLS NULL cipher'), 'TLS NULL cipher');
    const p = a.analyserSession(session);
    const nullCipher = p.recommandations.find((r) => r.titre === 'Chiffrement NULL supporté');
    expect(nullCipher).toBeDefined();
    expect(nullCipher?.severite).toBe('critique');
  });

  it('détecte un certificat auto-signé', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('self-signed certificate'), 'self-signed certificate');
    const p = a.analyserSession(session);
    const selfSigned = p.recommandations.find((r) => r.titre === 'Certificat SSL auto-signé');
    expect(selfSigned).toBeDefined();
  });

  it('détecte un certificat expiré', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('certificate expired'), 'certificate expired');
    const p = a.analyserSession(session);
    const expired = p.recommandations.find((r) => r.titre === 'Certificat SSL expiré');
    expect(expired).toBeDefined();
  });

  it('marque la config SSL/TLS comme point fort si TLS 1.2+ uniquement', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('TLS 1.2 enabled, TLS 1.3 enabled'), 'TLS 1.2 enabled, TLS 1.3 enabled');
    const p = a.analyserSession(session);
    const sslForce = p.forces.find((f) => f.includes('SSL/TLS'));
    expect(sslForce).toBeDefined();
  });
});

describe('AnalyseurDefense — détection de versions', () => {
  it('détecte Apache < 2.4', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('Apache/2.2.15'), 'Apache/2.2.15');
    const p = a.analyserSession(session);
    const apache = p.recommandations.find((r) => r.titre === 'Apache HTTP Server version obsolète');
    expect(apache).toBeDefined();
    expect(apache?.severite).toBe('eleve');
  });

  it('ne signale pas Apache 2.4.x comme obsolète', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('Apache/2.4.58'), 'Apache/2.4.58');
    const p = a.analyserSession(session);
    const apache = p.recommandations.find((r) => r.titre === 'Apache HTTP Server version obsolète');
    expect(apache).toBeUndefined();
  });

  it('détecte nginx < 1.20', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('nginx/1.18.0'), 'nginx/1.18.0');
    const p = a.analyserSession(session);
    const nginx = p.recommandations.find((r) => r.titre === 'nginx version obsolète');
    expect(nginx).toBeDefined();
  });

  it('détecte PHP < 8.0', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('PHP/7.4.3'), 'PHP/7.4.3');
    const p = a.analyserSession(session);
    const php = p.recommandations.find((r) => r.titre === 'PHP version obsolète');
    expect(php).toBeDefined();
    expect(php?.severite).toBe('eleve');
  });

  it('détecte OpenSSH < 8.0', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('22/tcp open ssh  SSH-2.0-OpenSSH_7.4'), '22/tcp open ssh  SSH-2.0-OpenSSH_7.4');
    const p = a.analyserSession(session);
    const ssh = p.recommandations.find((r) => r.titre === 'OpenSSH version obsolète');
    expect(ssh).toBeDefined();
  });
});

describe('AnalyseurDefense — CVSS scores', () => {
  it('toutes les recommandations critiques ont un cvssScore >= 8.0', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(
      sessionNmap('23/tcp open telnet  6379/tcp open redis  SSLv2 enabled'),
      '23/tcp open telnet  6379/tcp open redis  SSLv2 enabled',
    );
    const p = a.analyserSession(session);
    const critiques = p.recommandations.filter((r) => r.severite === 'critique');
    for (const r of critiques) {
      expect(r.cvssScore).toBeDefined();
      expect(r.cvssScore!).toBeGreaterThanOrEqual(8.0);
      expect(r.cvss).toBeDefined();
    }
  });

  it('toutes les recommandations ont un vecteur CVSS', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(
      sessionNmap('21/tcp open ftp  445/tcp open smb  3389/tcp open rdp'),
      '21/tcp open ftp  445/tcp open smb  3389/tcp open rdp',
    );
    const p = a.analyserSession(session);
    for (const r of p.recommandations) {
      expect(r.cvss).toBeDefined();
      expect(r.cvssScore).toBeDefined();
    }
  });
});

describe('AnalyseurDefense — non-régressions', () => {
  it('Port 230 ne déclenche pas Telnet (hérité de #371)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('230/tcp open unknown'), '230/tcp open unknown');
    const p = a.analyserSession(session);
    const telnet = p.recommandations.find((r) => r.titre === 'Telnet exposé');
    expect(telnet).toBeUndefined();
  });

  it('Port 23 déclenche bien Telnet (hérité de #371)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('23/tcp open telnet'), '23/tcp open telnet');
    const p = a.analyserSession(session);
    const telnet = p.recommandations.find((r) => r.titre === 'Telnet exposé');
    expect(telnet).toBeDefined();
  });

  it('Port 4450 ne déclenche pas SMB (hérité de #371)', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(sessionNmap('4450/tcp open unknown'), '4450/tcp open unknown');
    const p = a.analyserSession(session);
    const smb = p.recommandations.find((r) => r.titre === 'SMB exposé');
    expect(smb).toBeUndefined();
  });

  it('le score reste borné entre 0 et 100', () => {
    const a = creerAnalyseurDefense();
    const session = avecEtapeNmap(
      sessionNmap('23/tcp open telnet  21/tcp open ftp  445/tcp open smb  3389/tcp open rdp  6379/tcp open redis  27017/tcp open mongodb  9200/tcp open http  3306/tcp open mysql  SSLv2 enabled  RC4-SHA'),
      '23/tcp open telnet  21/tcp open ftp  445/tcp open smb  3389/tcp open rdp  6379/tcp open redis  27017/tcp open mongodb  9200/tcp open http  3306/tcp open mysql  SSLv2 enabled  RC4-SHA',
    );
    const p = a.analyserSession(session);
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.score).toBeLessThanOrEqual(100);
  });
});