// Module de défense et durcissement pour Cyber Hive.
// Analyse les vulnérabilités trouvées et propose des correctifs.
// Évalue la posture de sécurité de la cible après attaque.

import type { EtapeAttaque, SessionPentest } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Types
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export interface RecommandationDefense {
  severite: 'critique' | 'eleve' | 'moyenne' | 'faible';
  titre: string;
  description: string;
  correctif: string;
  cve?: string;
  cvss?: number;
}

export interface PostureSecurite {
  score: number;
  niveau: 'A' | 'B' | 'C' | 'D' | 'F';
  forces: string[];
  faiblesses: string[];
  recommandations: RecommandationDefense[];
  resume: string;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Analyseur de défense
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class AnalyseurDefense {
  /** Analyse les étapes d'une session et produit la posture de sécurité. */
  analyserSession(session: SessionPentest): PostureSecurite {
    const recommandations: RecommandationDefense[] = [];
    const forces: string[] = [];
    const faiblesses: string[] = [];
    let score = 100;

    for (const etape of session.etapes) {
      this.analyserEtape(etape, recommandations, faiblesses, forces);
    }

    // Calcul du score
    for (const reco of recommandations) {
      switch (reco.severite) {
        case 'critique': score -= 25; break;
        case 'eleve': score -= 15; break;
        case 'moyenne': score -= 8; break;
        case 'faible': score -= 3; break;
      }
    }
    score = Math.max(0, Math.min(100, score));

    const niveau = this.scoreVersNiveau(score);
    const resume = this.genererResume(score, niveau, recommandations, forces, faiblesses);

    return { score, niveau, forces, faiblesses, recommandations, resume };
  }

  /** Analyse une étape individuelle. */
  private analyserEtape(
    etape: EtapeAttaque,
    recos: RecommandationDefense[],
    faiblesses: string[],
    forces: string[],
  ): void {
    if (!etape.resultat?.succes) {
      // Échec d'attaque = point fort potentiel
      if (etape.type === 'exploitation' || etape.type === 'post-exploitation') {
        forces.push(`${etape.description} : attaque bloquée.`);
      }
      return;
    }

    const stdout = etape.resultat.stdout.toLowerCase();

    switch (etape.outilId ?? etape.type) {
      case 'nmap':
        this.analyserNmap(stdout, recos, faiblesses);
        break;
      case 'nikto':
        this.analyserNikto(stdout, recos, faiblesses);
        break;
      case 'nuclei':
        this.analyserNuclei(stdout, recos, faiblesses);
        break;
      case 'hydra':
        this.analyserHydra(stdout, recos, faiblesses);
        break;
      case 'sqlmap':
        this.analyserSqlmap(stdout, recos, faiblesses);
        break;
      case 'ffuf':
        this.analyserFfuf(stdout, recos, faiblesses);
        break;
    }
  }

  private analyserNmap(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    // Ports ouverts non sécurisés
    if (stdout.includes('telnet') || stdout.includes('port 23')) {
      recos.push({
        severite: 'critique',
        titre: 'Telnet exposé',
        description: 'Le service Telnet est ouvert. Il transmet les credentials en clair.',
        correctif: 'Désactiver Telnet et utiliser SSH (port 22) à la place. Si indispensable, restreindre par firewall.',
      });
      faiblesses.push('Telnet exposé (credentials en clair).');
    }
    if (stdout.includes('ftp') && stdout.includes('port 21')) {
      recos.push({
        severite: 'eleve',
        titre: 'FTP non chiffré exposé',
        description: 'Le service FTP est ouvert sans chiffrement.',
        correctif: 'Remplacer FTP par SFTP ou FTPS. Restreindre l\'accès par IP.',
      });
      faiblesses.push('FTP non chiffré exposé.');
    }
    if (stdout.includes('smb') || stdout.includes('port 445')) {
      recos.push({
        severite: 'moyenne',
        titre: 'SMB exposé',
        description: 'Le service SMB est accessible. Risque de fuite d\'informations (Null Session, EternalBlue).',
        correctif: 'Restreindre SMB aux réseaux internes. Appliquer les derniers correctifs Windows. Désactiver SMBv1.',
      });
      faiblesses.push('SMB exposé.');
    }
    if (stdout.includes('rdp') || stdout.includes('port 3389')) {
      recos.push({
        severite: 'eleve',
        titre: 'RDP exposé',
        description: 'Le Bureau à distance est accessible depuis l\'extérieur.',
        correctif: 'Utiliser un VPN pour accéder au RDP. Activer NLA. Restreindre par firewall. Changer le port par défaut.',
      });
      faiblesses.push('RDP exposé publiquement.');
    }
  }

  private analyserNikto(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    if (stdout.includes('x-frame-options')) {
      recos.push({
        severite: 'moyenne',
        titre: 'En-tête X-Frame-Options manquant',
        description: 'Absence de protection contre le clickjacking.',
        correctif: 'Ajouter l\'en-tête X-Frame-Options: DENY ou SAMEORIGIN dans la configuration du serveur web.',
      });
      faiblesses.push('Clickjacking possible (X-Frame-Options manquant).');
    }
    if (stdout.includes('x-content-type-options')) {
      recos.push({
        severite: 'faible',
        titre: 'En-tête X-Content-Type-Options manquant',
        description: 'Risque de MIME sniffing.',
        correctif: 'Ajouter X-Content-Type-Options: nosniff.',
      });
    }
    if (stdout.includes('strict-transport-security')) {
      recos.push({
        severite: 'eleve',
        titre: 'HSTS manquant',
        description: 'Absence de Strict-Transport-Security. Vulnérable au downgrade HTTPS vers HTTP.',
        correctif: 'Ajouter Strict-Transport-Security: max-age=31536000; includeSubDomains; preload.',
      });
      faiblesses.push('Pas de HSTS (downgrade possible).');
    }
    if (stdout.includes('directory indexing')) {
      recos.push({
        severite: 'moyenne',
        titre: 'Directory listing activé',
        description: 'Le listing des répertoires est activé, exposant la structure des fichiers.',
        correctif: 'Désactiver autoindex (Apache) ou autoindex off (Nginx).',
      });
      faiblesses.push('Directory listing activé.');
    }
  }

  private analyserNuclei(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    const lignes = stdout.split('\n').filter((l) => l.includes('[') && l.includes(']'));
    for (const ligne of lignes) {
      if (ligne.includes('critical') || ligne.includes('cvss') && ligne.match(/cvss.*[89]\./)) {
        const match = ligne.match(/\[([^\]]+)\]/);
        const templateId = match?.[1] ?? 'unknown';
        recos.push({
          severite: 'critique',
          titre: `Vulnérabilité Nuclei critique : ${templateId}`,
          description: `Template Nuclei ${templateId} matché. Vulnérabilité critique détectée.`,
          correctif: 'Appliquer le correctif de l\'éditeur immédiatement. Restreindre l\'accès au service vulnérable.',
        });
        faiblesses.push(`Vulnérabilité critique : ${templateId}.`);
      } else if (ligne.includes('high')) {
        const match = ligne.match(/\[([^\]]+)\]/);
        const templateId = match?.[1] ?? 'unknown';
        recos.push({
          severite: 'eleve',
          titre: `Vulnérabilité Nuclei élevée : ${templateId}`,
          description: `Template Nuclei ${templateId} matché.`,
          correctif: 'Appliquer le correctif et vérifier les logs d\'accès.',
        });
        faiblesses.push(`Vulnérabilité élevée : ${templateId}.`);
      }
    }
  }

  private analyserHydra(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    if (stdout.includes('host: ') && stdout.includes('password:')) {
      recos.push({
        severite: 'critique',
        titre: 'Credentials faibles découverts',
        description: 'Des credentials ont été trouvés par brute-force. Les mots de passe sont trop faibles.',
        correctif: 'Imposer une politique de mots de passe complexes (12+ caractères, mix majuscules/minuscules/chiffres/symboles). Activer le verrouillage de compte après N tentatives. Activer 2FA.',
      });
      faiblesses.push('Credentials faibles (brute-force réussi).');
    }
  }

  private analyserSqlmap(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    if (stdout.includes('injectable') || stdout.includes('vulnerable')) {
      recos.push({
        severite: 'critique',
        titre: 'Injection SQL confirmée',
        description: 'Une injection SQL a été confirmée par SQLMap. La base de données est compromise.',
        correctif: 'Utiliser des requêtes paramétrées (prepared statements) partout. Valider toutes les entrées utilisateur. Appliquer le principe du moindre privilège au compte DB. Mettre à jour le SGBD.',
      });
      faiblesses.push('Injection SQL confirmée.');
    }
  }

  private analyserFfuf(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    if (stdout.includes('200') && stdout.includes('admin')) {
      recos.push({
        severite: 'eleve',
        titre: 'Interface d\'administration exposée',
        description: 'Une page d\'administration est accessible publiquement.',
        correctif: 'Restreindre l\'accès à /admin par IP, VPN ou authentification forte. Ajouter un WAF.',
      });
      faiblesses.push('Interface d\'administration exposée.');
    }
  }

  private scoreVersNiveau(score: number): PostureSecurite['niveau'] {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  private genererResume(
    score: number,
    niveau: string,
    recos: RecommandationDefense[],
    forces: string[],
    faiblesses: string[],
  ): string {
    const nbCritique = recos.filter((r) => r.severite === 'critique').length;
    const nbEleve = recos.filter((r) => r.severite === 'eleve').length;
    const lignes: string[] = [];

    lignes.push(`Posture de sécurité : ${niveau} (${score}/100)`);
    lignes.push(`${recos.length} recommandation(s) : ${nbCritique} critique(s), ${nbEleve} élevée(s).`);
    if (forces.length > 0) lignes.push(`Points forts : ${forces.length}.`);
    if (faiblesses.length > 0) lignes.push(`Faiblesses : ${faiblesses.length}.`);

    return lignes.join('\n');
  }
}

/** Crée une instance de l'analyseur de défense. */
export function creerAnalyseurDefense(): AnalyseurDefense {
  return new AnalyseurDefense();
}