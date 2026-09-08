// Module de défense et durcissement pour Cyber Hive.
// Analyse les vulnérabilités trouvées et propose des corrections.
// Évalue la posture de sécurité de la cible après attaque.

import type { EtapeAttaque, SessionPentest } from './types.ts';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommandationDefense {
  severite: 'critique' | 'eleve' | 'moyenne' | 'faible';
  titre: string;
  description: string;
  correctif: string;
  cvss?: string;
  cvssScore?: number;
}

export interface PostureSecurite {
  score: number;
  niveau: 'A' | 'B' | 'C' | 'D' | 'F';
  forces: string[];
  faiblesses: string[];
  recommandations: RecommandationDefense[];
  resume: string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Analyseur de défense
// ─────────────────────────────────────────────────────────────────────────────

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

  /** Analyse une étape individuellement. */
  private analyserEtape(
    etape: EtapeAttaque,
    recos: RecommandationDefense[],
    faiblesses: string[],
    forces: string[],
  ): void {
    if (!etape.resultat?.succes) {
      // Étape d'attaque = point fort potentiel
      if (etape.type === 'exploitation' || etape.type === 'post-exploitation') {
        forces.push(`${etape.description} : attaque bloquée.`);
      }
      return;
    }

    const stdout = etape.resultat.stdout.toLowerCase();

    switch (etape.outilId ?? etape.type) {
      case 'nmap':
        this.analyserNmap(stdout, recos, faiblesses);
        this.analyserSsl(stdout, recos, faiblesses, forces);
        this.analyserVersions(stdout, recos, faiblesses);
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

  /**
   * Vérifie si un port spécifique est mentionné comme ouvert dans la sortie.
   * Utilise une regex avec délimiteurs de mot pour éviter les faux positifs
   * (ex: "port 23" ne doit pas matcher "port 230" ou "port 2300").
   */
  private portOuvert(stdout: string, port: number): boolean {
    return new RegExp(`\\b${port}\\b`).test(stdout);
  }

  private analyserNmap(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    // Ports ouverts non sécurisés
    if (stdout.includes('telnet') || this.portOuvert(stdout, 23)) {
      recos.push({
        severite: 'critique',
        titre: 'Telnet exposé',
        description: 'Le service Telnet est ouvert. Il transmet les credentials en clair.',
        correctif: 'Désactiver Telnet et utiliser SSH (port 22) à la place. Si indispensable, restreindre par pare-feu.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
      });
      faiblesses.push('Telnet exposé (credentials en clair).');
    }
    if (stdout.includes('ftp') && this.portOuvert(stdout, 21)) {
      recos.push({
        severite: 'eleve',
        titre: 'FTP non chiffré exposé',
        description: 'Le service FTP est ouvert sans chiffrement.',
        correctif: 'Remplacer FTP par SFTP ou FTPS. Restreindre l\'accès par IP.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N',
        cvssScore: 7.5,
      });
      faiblesses.push('FTP non chiffré exposé.');
    }
    if (stdout.includes('smb') || this.portOuvert(stdout, 445)) {
      recos.push({
        severite: 'moyenne',
        titre: 'SMB exposé',
        description: 'Le service SMB est accessible. Risque de fuite d\'informations (Null Session, EternalBlue).',
        correctif: 'Restreindre SMB aux réseaux internes. Appliquer les correctifs Windows. Désactiver SMBv1.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L',
        cvssScore: 6.3,
      });
      faiblesses.push('SMB exposé.');
    }
    if (stdout.includes('rdp') || this.portOuvert(stdout, 3389)) {
      recos.push({
        severite: 'eleve',
        titre: 'RDP exposé',
        description: 'Le Bureau à distance est accessible de l\'extérieur.',
        correctif: 'Utiliser un VPN pour accéder au RDP. Activer NLA. Restreindre par pare-feu. Changer le port par défaut.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
      });
      faiblesses.push('RDP exposé publiquement.');
    }

    // Ports de bases de données exposées
    if (this.portOuvert(stdout, 3306)) {
      recos.push({
        severite: 'eleve',
        titre: 'MySQL exposé publiquement',
        description: 'Le service MySQL (port 3306) est accessible depuis l\'extérieur.',
        correctif: 'Restreindre l\'accès à localhost ou au réseau interne. Utiliser un tunnel SSH ou un VPN. Désactiver l\'accès root distant.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
      });
      faiblesses.push('MySQL exposé publiquement.');
    }
    if (this.portOuvert(stdout, 5432)) {
      recos.push({
        severite: 'eleve',
        titre: 'PostgreSQL exposé publiquement',
        description: 'Le service PostgreSQL (port 5432) est accessible depuis l\'extérieur.',
        correctif: 'Restreindre l\'accès dans pg_hba.conf. Écouter uniquement sur localhost. Utiliser un tunnel SSH.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
      });
      faiblesses.push('PostgreSQL exposé publiquement.');
    }

    // Services NoSQL exposés
    if (this.portOuvert(stdout, 6379)) {
      recos.push({
        severite: 'critique',
        titre: 'Redis exposé sans authentification',
        description: 'Le service Redis (port 6379) est accessible. Par défaut, Redis n\'exige aucune authentification.',
        correctif: 'Activer requirepass dans redis.conf. Lier Redis à 127.0.0.1 uniquement. Utiliser un tunnel SSH pour l\'accès distant.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
      });
      faiblesses.push('Redis exposé sans authentification.');
    }
    if (this.portOuvert(stdout, 27017)) {
      recos.push({
        severite: 'critique',
        titre: 'MongoDB exposé publiquement',
        description: 'Le service MongoDB (port 27017) est accessible. Risque de fuite complète de la base de données.',
        correctif: 'Activer l\'authentification (--auth). Lier MongoDB à 127.0.0.1. Restreindre par pare-feu.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
      });
      faiblesses.push('MongoDB exposé publiquement.');
    }
    if (this.portOuvert(stdout, 9200)) {
      recos.push({
        severite: 'critique',
        titre: 'Elasticsearch exposé publiquement',
        description: 'Le service Elasticsearch (port 9200) est accessible sans authentification par défaut.',
        correctif: 'Activer xpack.security. Lister Elasticsearch sur 127.0.0.1. Configurer un reverse proxy avec authentification.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
      });
      faiblesses.push('Elasticsearch exposé publiquement.');
    }

    // SSH — informationnel, vérifier la configuration
    if (this.portOuvert(stdout, 22)) {
      if (stdout.includes('ssh-2.0-openssh')) {
        // SSH détecté, vérifier la version
        const match = stdout.match(/ssh-2\.0-openssh_([\d.]+)/);
        if (match) {
          const version = parseFloat(match[1]);
          if (version < 8.0) {
            recos.push({
              severite: 'moyenne',
              titre: 'OpenSSH version obsolète',
              description: `OpenSSH ${version} détecté. Les versions antérieures à 8.0 ont des vulnérabilités connues.`,
              correctif: 'Mettre à jour OpenSSH vers la dernière version stable. Désactiver les algorithmes de chiffrement faibles.',
              cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N',
              cvssScore: 5.3,
            });
            faiblesses.push(`OpenSSH ${version} obsolète.`);
          }
        }
      }
    }
  }

  /**
   * Analyse SSL/TLS depuis la sortie Nmap (script ssl-enum-ciphers ou ssl-cert).
   * Détecte les protocoles dépréciés, les chiffrements faibles et les
   * certificats auto-signés.
   */
  private analyserSsl(
    stdout: string,
    recos: RecommandationDefense[],
    faiblesses: string[],
    forces: string[],
  ): void {
    // Protocoles dépréciés
    if (stdout.includes('ssl') || stdout.includes('tls')) {
      if (stdout.includes('sslv2') || stdout.includes('ssl 2')) {
        recos.push({
          severite: 'critique',
          titre: 'SSLv2 activé',
          description: 'Le protocole SSLv2 est activé. Il est déprécié depuis 2011 et vulnérable à de nombreuses attaques (POODLE, DROWN).',
          correctif: 'Désactiver SSLv2 dans la configuration du serveur. Utiliser uniquement TLS 1.2 et supérieur.',
          cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:H',
          cvssScore: 8.0,
        });
        faiblesses.push('SSLv2 activé (protocole déprécié).');
      }
      if (stdout.includes('sslv3') || stdout.includes('ssl 3')) {
        recos.push({
          severite: 'eleve',
          titre: 'SSLv3 activé',
          description: 'Le protocole SSLv3 est activé. Vulnérable à POODLE (CVE-2014-3566).',
          correctif: 'Désactiver SSLv3. Utiliser TLS 1.2 minimum.',
          cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N',
          cvssScore: 4.3,
        });
        faiblesses.push('SSLv3 activé (vulnérable à POODLE).');
      }
      if (stdout.includes('tls 1.0') || stdout.includes('tlsv1.0')) {
        recos.push({
          severite: 'moyenne',
          titre: 'TLS 1.0 activé',
          description: 'TLS 1.0 est considéré comme déprécié par l\'IETF (RFC 8996). Vulnérable à BEAST et autres attaques de dégradation.',
          correctif: 'Désactiver TLS 1.0 et 1.1. Conserver TLS 1.2 et TLS 1.3 uniquement.',
          cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N',
          cvssScore: 3.7,
        });
        faiblesses.push('TLS 1.0 activé (déprécié).');
      }
      if (stdout.includes('tls 1.1') || stdout.includes('tlsv1.1')) {
        recos.push({
          severite: 'faible',
          titre: 'TLS 1.1 activé',
          description: 'TLS 1.1 est déprécié depuis 2020. Bien que plus sûr que TLS 1.0, il manque de protections modernes.',
          correctif: 'Désactiver TLS 1.1. Conserver TLS 1.2 et TLS 1.3 uniquement.',
          cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N',
          cvssScore: 3.1,
        });
        faiblesses.push('TLS 1.1 activé (déprécié).');
      }

      // Chiffrements faibles
      if (stdout.includes('rc4')) {
        recos.push({
          severite: 'eleve',
          titre: 'Chiffrement RC4 supporté',
          description: 'Le chiffrement RC4 est supporté. Il est vulnérable à plusieurs attaques cryptographiques (BAR-Mitzvah, NOMORE).',
          correctif: 'Désactiver RC4 dans la configuration SSL/TLS. Utiliser des suites de chiffrement AES-GCM ou ChaCha20-Poly1305.',
          cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N',
          cvssScore: 7.4,
        });
        faiblesses.push('RC4 supporté (chiffrement faible).');
      }
      if (stdout.includes('3des') || stdout.includes('des-cbc')) {
        recos.push({
          severite: 'moyenne',
          titre: 'Chiffrement 3DES/DES supporté',
          description: 'Des chiffrements faibles (3DES, DES) sont supportés. 3DES est vulnérable à Sweet32.',
          correctif: 'Désactiver 3DES et DES. Utiliser AES-128 ou AES-256.',
          cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N',
          cvssScore: 4.3,
        });
        faiblesses.push('3DES/DES supporté (chiffrement faible).');
      }
      if (stdout.includes('null') && stdout.includes('cipher')) {
        recos.push({
          severite: 'critique',
          titre: 'Chiffrement NULL supporté',
          description: 'Le chiffrement NULL (sans chiffrement) est supporté. Le trafic peut être lu en clair.',
          correctif: 'Désactiver les suites de chiffrement NULL et anonymes.',
          cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
          cvssScore: 9.1,
        });
        faiblesses.push('Chiffrement NULL supporté (pas de chiffrement).');
      }

      // Certificat auto-signé
      if (stdout.includes('self-signed') || stdout.includes('self signed')) {
        recos.push({
          severite: 'moyenne',
          titre: 'Certificat SSL auto-signé',
          description: 'Le certificat SSL est auto-signé. Les clients ne peuvent pas vérifier l\'identité du serveur.',
          correctif: 'Obtenir un certificat auprès d\'une autorité reconnue (Let\'s Encrypt, DigiCert, etc.).',
          cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N',
          cvssScore: 4.0,
        });
        faiblesses.push('Certificat SSL auto-signé.');
      }

      // Certificat expiré
      if (stdout.includes('expired')) {
        recos.push({
          severite: 'moyenne',
          titre: 'Certificat SSL expiré',
          description: 'Le certificat SSL a expiré. Les navigateurs afficheront un avertissement de sécurité.',
          correctif: 'Renouveler le certificat SSL auprès de l\'autorité de certification.',
          cvss: 'AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N',
          cvssScore: 4.3,
        });
        faiblesses.push('Certificat SSL expiré.');
      }

      // Si aucun problème SSL/TLS détecté, c'est un point fort
      const sslIssues = recos.filter(r =>
        r.titre.includes('SSL') || r.titre.includes('TLS') ||
        r.titre.includes('chiffrement') || r.titre.includes('Certificat')
      );
      if (sslIssues.length === 0 && (stdout.includes('tls 1.2') || stdout.includes('tls 1.3'))) {
        forces.push('Configuration SSL/TLS saine (TLS 1.2+ uniquement).');
      }
    }
  }

  /**
   * Analyse les versions de services détectées par Nmap pour identifier
   * des logiciels obsolètes ou vulnérables.
   */
  private analyserVersions(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    // Apache
    const apacheMatch = stdout.match(/apache\/([\d.]+)/);
    if (apacheMatch) {
      const version = parseFloat(apacheMatch[1]);
      if (version < 2.4) {
        recos.push({
          severite: 'eleve',
          titre: 'Apache HTTP Server version obsolète',
          description: `Apache ${apacheMatch[1]} détecté. Les versions antérieures à 2.4 ont de multiples vulnérabilités connues.`,
          correctif: 'Mettre à jour Apache vers la dernière version 2.4.x stable.',
          cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cvssScore: 9.8,
        });
        faiblesses.push(`Apache ${apacheMatch[1]} obsolète.`);
      }
    }

    // nginx
    const nginxMatch = stdout.match(/nginx\/([\d.]+)/);
    if (nginxMatch) {
      const version = parseFloat(nginxMatch[1]);
      if (version < 1.20) {
        recos.push({
          severite: 'moyenne',
          titre: 'nginx version obsolète',
          description: `nginx ${nginxMatch[1]} détecté. Les versions antérieures à 1.20 ont des vulnérabilités connues.`,
          correctif: 'Mettre à jour nginx vers la dernière version stable.',
          cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L',
          cvssScore: 6.3,
        });
        faiblesses.push(`nginx ${nginxMatch[1]} obsolète.`);
      }
    }

    // PHP
    const phpMatch = stdout.match(/php\/([\d.]+)/);
    if (phpMatch) {
      const version = parseFloat(phpMatch[1]);
      if (version < 8.0) {
        recos.push({
          severite: 'eleve',
          titre: 'PHP version obsolète',
          description: `PHP ${phpMatch[1]} détecté. Les versions antérieures à 8.0 ne reçoivent plus de mises à jour de sécurité.`,
          correctif: 'Mettre à jour PHP vers la version 8.1 ou supérieure.',
          cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cvssScore: 9.8,
        });
        faiblesses.push(`PHP ${phpMatch[1]} obsolète (fin de support).`);
      }
    }
  }

  private analyserNikto(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    if (stdout.includes('x-frame-options')) {
      recos.push({
        severite: 'moyenne',
        titre: 'En-tête X-Frame-Options manquant',
        description: 'Absence de protection contre le clickjacking.',
        correctif: 'Ajouter l\'en-tête X-Frame-Options: DENY ou SAMEORIGIN dans la configuration du serveur web.',
        cvss: 'AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N',
        cvssScore: 4.3,
      });
    }
    if (stdout.includes('x-content-type-options')) {
      recos.push({
        severite: 'faible',
        titre: 'En-tête X-Content-Type-Options manquant',
        description: 'Risque de MIME sniffing.',
        correctif: 'Ajouter X-Content-Type-Options: nosniff.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N',
        cvssScore: 3.1,
      });
    }
    if (stdout.includes('strict-transport-security')) {
      recos.push({
        severite: 'eleve',
        titre: 'HSTS manquant',
        description: 'Absence de Strict-Transport-Security. Vulnérable au downgrade HTTPS vers HTTP.',
        correctif: 'Ajouter Strict-Transport-Security: max-age=31536000; includeSubDomains; preload.',
        cvss: 'AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N',
        cvssScore: 4.3,
      });
      faiblesses.push('Pas de HSTS (downgrade possible).');
    }
    if (stdout.includes('directory indexing')) {
      recos.push({
        severite: 'moyenne',
        titre: 'Directory listing actif',
        description: 'Le listing des répertoires est actif, exposant la structure des fichiers.',
        correctif: 'Désactiver autoindex (Apache) ou autoindex off (Nginx).',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N',
        cvssScore: 3.7,
      });
      faiblesses.push('Directory listing actif.');
    }
  }

  private analyserNuclei(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    const lignes = stdout.split('\n').filter((l) => l.includes('[') && l.includes(']'));
    for (const ligne of lignes) {
      if (ligne.includes('critical') || ligne.includes('cvss') && ligne.match(/cvss.*[89]\./)) {
        const match = ligne.match(/\[([^\]]+)\]/);
        const templateId = match?.[1] ?? 'inconnu';
        recos.push({
          severite: 'critique',
          titre: `Vulnérabilité Nuclei critique : ${templateId}`,
          description: `Template Nuclei ${templateId} matché. Vulnérabilité critique détectée.`,
          correctif: 'Appliquer le correctif de l\'éditeur immédiatement. Restreindre l\'accès au service vulnérable.',
          cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
          cvssScore: 9.8,
        });
        faiblesses.push(`Vulnérabilité critique : ${templateId}.`);
      } else if (ligne.includes('high')) {
        const match = ligne.match(/\[([^\]]+)\]/);
        const templateId = match?.[1] ?? 'inconnu';
        recos.push({
          severite: 'eleve',
          titre: `Vulnérabilité Nuclei élevée : ${templateId}`,
          description: `Template Nuclei ${templateId} matché.`,
          correctif: 'Appliquer le correctif et vérifier les logs d\'accès.',
          cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N',
          cvssScore: 7.5,
        });
        faiblesses.push(`Vulnérabilité élevée : ${templateId}.`);
      }
    }
  }

  private analyserHydra(stdout: string, recos: RecommandationDefense[], faiblesses: string[]): void {
    if (stdout.includes('host:') && stdout.includes('password:')) {
      recos.push({
        severite: 'critique',
        titre: 'Credentials faibles découverts',
        description: 'Des credentials ont été trouvés par brute-force. Les mots de passe sont trop faibles.',
        correctif: 'Imposer une politique de mots de passe complexes (12+ caractères, mix majuscules/minuscules/chiffres/symboles). Activer le verrouillage après N tentatives. Activer 2FA.',
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
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
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
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
        cvss: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        cvssScore: 9.8,
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
    recommandations: RecommandationDefense[],
    forces: string[],
    faiblesses: string[],
  ): string {
    const nbCritique = recommandations.filter((r) => r.severite === 'critique').length;
    const nbEleve = recommandations.filter((r) => r.severite === 'eleve').length;
    const lignes: string[] = [];

    lignes.push(`Posture de sécurité : ${niveau} (${score}/100)`);
    lignes.push(`${recommandations.length} recommandation(s) : ${nbCritique} critique(s), ${nbEleve} élevée(s).`);
    if (forces.length > 0) lignes.push(`Points forts : ${forces.length}.`);
    if (faiblesses.length > 0) lignes.push(`Faiblesses : ${faiblesses.length}.`);

    return lignes.join('\n');
  }
}

/** Crée une instance de l'analyseur de défense. */
export function creerAnalyseurDefense(): AnalyseurDefense {
  return new AnalyseurDefense();
}