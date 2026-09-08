// Tests pour le matching de ports dans le module défense.
// Vérifie que les faux positifs de substring sont éliminés.
import { describe, it, expect } from 'vitest';
import { creerAnalyseurDefense } from '../defense.ts';
import type { SessionPentest } from '../types.ts';

describe('AnalyseurDefense — matching de ports', () => {
  it('ne déclenche pas Telnet pour le port 230', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'nmap',
      resultat: { succes: true, stdout: '230/tcp open unknown', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const telnet = p.recommandations.find((r) => r.titre === 'Telnet exposé');
    expect(telnet).toBeUndefined();
  });

  it('ne déclenche pas FTP pour le port 210', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'nmap',
      resultat: { succes: true, stdout: '210/tcp open unknown', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const ftp = p.recommandations.find((r) => r.titre === 'FTP non chiffré exposé');
    expect(ftp).toBeUndefined();
  });

  it('ne déclenche pas SMB pour le port 4450', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'nmap',
      resultat: { succes: true, stdout: '4450/tcp open unknown', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const smb = p.recommandations.find((r) => r.titre === 'SMB exposé');
    expect(smb).toBeUndefined();
  });

  it('ne déclenche pas RDP pour le port 33890', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'nmap',
      resultat: { succes: true, stdout: '33890/tcp open unknown', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const rdp = p.recommandations.find((r) => r.titre === 'RDP exposé');
    expect(rdp).toBeUndefined();
  });

  it('déclenche bien Telnet pour le port 23', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'nmap',
      resultat: { succes: true, stdout: '23/tcp open telnet', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const telnet = p.recommandations.find((r) => r.titre === 'Telnet exposé');
    expect(telnet).toBeDefined();
  });

  it('déclenche bien FTP pour le port 21', () => {
    const a = creerAnalyseurDefense();
    const session: SessionPentest = {
      id: 'test', nom: 'test', cible: { hote: 'localhost', type: 'reseau' },
      statut: 'termine', etapes: [], creeA: Date.now(), antiTrace: {} as any,
    };
    session.etapes.push({
      id: 'e1', sessionId: 'test', agentId: 'a1', type: 'reconnaissance',
      severite: 'info', description: 'Nmap scan', ts: Date.now(), dureeMs: 100,
      outilId: 'nmap',
      resultat: { succes: true, stdout: '21/tcp open ftp', stderr: '', codeRetour: 0, dureeMs: 100 },
    });
    const p = a.analyserSession(session);
    const ftp = p.recommandations.find((r) => r.titre === 'FTP non chiffré exposé');
    expect(ftp).toBeDefined();
  });
});