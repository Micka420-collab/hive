// Boucle d'agent autonome pour Cyber Hive.
// L'agent décide lui-même quoi faire ensuite selon les résultats précédents.
// C'est le cerveau du système : il analyse, planifie et agit en boucle.

import type {
  SessionPentest,
  EtapeAttaque,
  ResultatOutil,
  CiblePentest,
  TypeActionAttaque,
} from './types.js';
import { obtenirOutil } from './tool-registry.js';
import { execOutil } from './container-manager.js';
import { delaiAleatoire, construireCommande } from './anti-trace.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Contexte de décision
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Ce que l'agent sait de la cible à un instant T. */
export interface ContexteCible {
  hote: string;
  portsOuverts: PortDecouvert[];
  services: ServiceDecouvert[];
  vulnerabilites: VulnerabiliteDecouverte[];
  urlsDecouvertes: string[];
  credentialsTrouves: CredentialTrouve[];
  /** Étapes déjà effectuées (pour éviter les doublons). */
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

/** Décision prise par l'agent à chaque itération. */
export interface Decision {
  action: TypeActionAttaque;
  outilId: string;
  cible: string;
  args: string[];
  raison: string;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Moteur de décision autonome
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class MoteurAutonome {
  private contexte: ContexteCible;
  private session: SessionPentest;
  private agentId: string;
  private maxIterations: number;
  private iterationCourante = 0;

  constructor(session: SessionPentest, agentId: string, maxIterations = 20) {
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
      actionsEffectuees: new Set(),
    };
  }

  /** Lance la boucle d'exploration autonome. */
  async lancer(): Promise<EtapeAttaque[]> {
    const etapes: EtapeAttaque[] = [];

    while (this.iterationCourante < this.maxIterations) {
      this.iterationCourante++;
      const decision = this.prendreDecision();

      if (!decision) {
        // L'agent n'a plus rien à faire : il a exploré tout ce qu'il pouvait.
        etapes.push(this.creerEtape('rapport', 'info',
          'Exploration terminée',
          `L'agent a exploré ${this.contexte.actionsEffectuees.size} actions. ${this.contexte.vulnerabilites.length} vulnérabilité(s) trouvée(s).`,
        ));
        break;
      }

      // Vérifier qu'on n'a pas déjà fait cette action.
      const cleAction = `${decision.outilId}:${decision.cible}:${decision.args.join(',')}`;
      if (this.contexte.actionsEffectuees.has(cleAction)) {
        continue;
      }
      this.contexte.actionsEffectuees.add(cleAction);

      // Exécuter l'outil.
      await delaiAleatoire(this.session.antiTrace);
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

      // Analyser les résultats pour mettre à jour le contexte.
      this.analyserResultat(decision, resultat);
    }

    return etapes;
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Logique de décision
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  /** Prend une décision selon l'état courant du contexte. */
  private prendreDecision(): Decision | null {
    // Phase 1 : si on n'a aucun port découvert, on commence par Nmap.
    if (this.contexte.portsOuverts.length === 0) {
      return {
        action: 'reconnaissance',
        outilId: 'nmap',
        cible: this.contexte.hote,
        args: ['-sV', '-sC', '-p-'],
        raison: 'Aucun port découvert. Scan Nmap complet pour identifier les services.',
      };
    }

    // Phase 2 : si on a des services web (80/443), on lance Nikto + Nuclei.
    const servicesWeb = this.contexte.services.filter(
      (s) => s.port === 80 || s.port === 443 || s.service.includes('http'),
    );
    if (servicesWeb.length > 0 && !this.contexte.urlsDecouvertes.length) {
      const svc = servicesWeb[0];
      const url = svc.port === 443 ? `https://${this.contexte.hote}` : `http://${this.contexte.hote}`;
      return {
        action: 'scan',
        outilId: 'nikto',
        cible: url,
        args: ['-h', url],
        raison: `Service web détecté sur le port ${svc.port}. Scan Nikto pour les vulnérabilités web.`,
      };
    }

    // Phase 3 : si on a des URLs découvertes, on lance Nuclei.
    if (this.contexte.urlsDecouvertes.length > 0 && this.contexte.vulnerabilites.length === 0) {
      const url = this.contexte.urlsDecouvertes[0];
      return {
        action: 'exploitation',
        outilId: 'nuclei',
        cible: url,
        args: ['-u', url, '-silent'],
        raison: 'URLs découvertes. Scan Nuclei pour identifier des vulnérabilités connues.',
      };
    }

    // Phase 4 : si on a des services SSH/FTP, on tente Hydra.
    const servicesAuth = this.contexte.services.filter(
      (s) => s.service.includes('ssh') || s.service.includes('ftp') || s.service.includes('smtp'),
    );
    if (servicesAuth.length > 0 && this.contexte.credentialsTrouves.length === 0) {
      const svc = servicesAuth[0];
      return {
        action: 'exploitation',
        outilId: 'hydra',
        cible: this.contexte.hote,
        args: ['-s', String(svc.port), svc.service, '-L', '/usr/share/wordlists/usernames.txt', '-P', '/usr/share/wordlists/passwords.txt'],
        raison: `Service ${svc.service} sur le port ${svc.port}. Tentative de brute force avec Hydra.`,
      };
    }

    // Phase 5 : si on a des vulnérabilités SQLi, on lance SQLMap.
    const sqliVulns = this.contexte.vulnerabilites.filter(
      (v) => v.type.includes('sqli') || v.type.includes('sql'),
    );
    if (sqliVulns.length > 0) {
      const vuln = sqliVulns[0];
      return {
        action: 'exploitation',
        outilId: 'sqlmap',
        cible: vuln.cible,
        args: ['-u', vuln.cible, '--batch', '--dbs'],
        raison: `Vulnérabilité SQLi détectée sur ${vuln.cible}. Exploitation avec SQLMap pour énumérer les bases.`,
      };
    }

    // Phase 6 : si on a des URLs mais pas encore fuzzé, on lance FFUF.
    if (this.contexte.urlsDecouvertes.length > 0 && this.contexte.vulnerabilites.length === 0) {
      const url = this.contexte.urlsDecouvertes[0];
      const baseUrl = url.split('?')[0];
      return {
        action: 'enumeration',
        outilId: 'ffuf',
        cible: baseUrl,
        args: ['-u', `${baseUrl}/FUZZ`, '-w', '/usr/share/wordlists/dirb/common.txt', '-ac'],
        raison: 'Découverte de contenu caché avec FFUF sur les URLs découvertes.',
      };
    }

    // Phase 7 : si on a des credentials, on tente une post-exploitation.
    if (this.contexte.credentialsTrouves.length > 0) {
      return {
        action: 'post-exploitation',
        outilId: 'metasploit',
        cible: this.contexte.hote,
        args: ['-q', '-x', `use auxiliary/scanner/ssh/ssh_login; set RHOSTS ${this.contexte.hote}; run`],
        raison: 'Credentials trouvés. Tentative de connexion et post-exploitation via Metasploit.',
      };
    }

    // Rien à faire : l'exploration est complète.
    return null;
  }

  /** Analyse le résultat d'un outil pour mettre à jour le contexte. */
  private analyserResultat(decision: Decision, resultat: ResultatOutil): void {
    if (!resultat.succes) return;
    const stdout = resultat.stdout.toLowerCase();

    switch (decision.outilId) {
      case 'nmap':
        this.analyserNmap(stdout);
        break;
      case 'nikto':
        this.analyserNikto(stdout, decision.cible);
        break;
      case 'nuclei':
        this.analyserNuclei(stdout, decision.cible);
        break;
      case 'hydra':
        this.analyserHydra(stdout);
        break;
      case 'ffuf':
        this.analyserFfuf(stdout, decision.cible);
        break;
      case 'sqlmap':
        this.analyserSqlmap(stdout, decision.cible);
        break;
    }
  }

  /** Extrait les ports et services d'une sortie Nmap. */
  private analyserNmap(stdout: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      // Format : 80/tcp open http Apache 2.4.41
      const match = ligne.match(/(\d+)\/(tcp|udp)\s+(\w+)\s+(\S+)(?:\s+(.+))?/);
      if (match) {
        const port = parseInt(match[1]);
        const protocole = match[2];
        const etat = match[3];
        const service = match[4] ?? 'unknown';
        const version = match[5] ?? '';

        if (etat === 'open') {
          this.contexte.portsOuverts.push({ port, protocole, etat });
          this.contexte.services.push({ port, service, version });
        }
      }
    }
  }

  /** Extrait les vulnérabilités d'une sortie Nikto. */
  private analyserNikto(stdout: string, cible: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      if (ligne.includes('osvdb') || ligne.includes('vulnerability') || ligne.includes('xss') || ligne.includes('sql')) {
        this.contexte.vulnerabilites.push({
          id: `nikto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: ligne.includes('sql') ? 'sqli' : 'web',
          severite: ligne.includes('xss') ? 'moyen' : 'eleve',
          cible,
          description: ligne.trim(),
        });
      }
    }
    this.contexte.urlsDecouvertes.push(cible);
  }

  /** Extrait les vulnérabilités d'une sortie Nuclei. */
  private analyserNuclei(stdout: string, cible: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      if (ligne.includes('[') && ligne.includes(']')) {
        const match = ligne.match(/\[(\w+)\]/);
        const templateId = match?.[1] ?? 'unknown';
        this.contexte.vulnerabilites.push({
          id: `nuclei-${templateId}-${Date.now()}`,
          type: templateId,
          severite: ligne.includes('critical') ? 'critique' : ligne.includes('high') ? 'eleve' : 'moyen',
          cible,
          description: ligne.trim(),
        });
      }
    }
  }

  /** Extrait les credentials d'une sortie Hydra. */
  private analyserHydra(stdout: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      // Format : login: password
      const match = ligne.match(/(\S+):\s+(\S+)/);
      if (match && ligne.includes('host:')) {
        this.contexte.credentialsTrouves.push({
          utilisateur: match[1],
          motDePasse: match[2],
          service: 'ssh',
        });
      }
    }
  }

  /** Extrait les URLs découvertes d'une sortie FFUF. */
  private analyserFfuf(stdout: string, baseUrl: string): void {
    const lignes = stdout.split('\n');
    for (const ligne of lignes) {
      if (ligne.includes('status') && ligne.includes('200')) {
        const match = ligne.match(/FUZZ.*?->\s*(\S+)/);
        if (match) {
          this.contexte.urlsDecouvertes.push(`${baseUrl}${match[1]}`);
        }
      }
    }
  }

  /** Extrait les infos d'une sortie SQLMap. */
  private analyserSqlmap(stdout: string, cible: string): void {
    if (stdout.includes('injectable') || stdout.includes('vulnerable')) {
      this.contexte.vulnerabilites.push({
        id: `sqlmap-${Date.now()}`,
        type: 'sqli',
        severite: 'critique',
        cible,
        description: 'Injection SQL confirmée par SQLMap.',
      });
    }
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Helpers
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

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
      case 'anti-forensic': return 'info';
      case 'rapport': return 'info';
      default: return 'info';
    }
  }

  /** Retourne le contexte courant (pour inspection). */
  getContexte(): ContexteCible {
    return this.contexte;
  }

  /** Retourne le nombre d'itérations effectuées. */
  getIterations(): number {
    return this.iterationCourante;
  }
}

/** Crée et lance un agent autonome pour une session. */
export async function lancerAgentAutonome(
  session: SessionPentest,
  agentId: string,
  maxIterations?: number,
): Promise<EtapeAttaque[]> {
  const moteur = new MoteurAutonome(session, agentId, maxIterations);
  return moteur.lancer();
}