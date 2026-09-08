// Module de stockage BDD pour Cyber Hive.
// Stocke toutes les decouvertes de l'agent de pentest dans une base SQLite chiffree.
// Les donnees sensibles (credentials, hashes, dumps) sont chiffrees au repos (AES-256).
// Le nettoyage automatique (anti-forensics) peut etre active apres export.

import type { EtapeAttaque, ResultatOutil, SessionPentest } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Types de stockage
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Niveau de sensibilite d'une donnee stockee. */
export type Sensibilite = 'publique' | 'restreint' | 'secret' | 'critique';

/** Une entree de donnee decouverte pendant le pentest. */
export interface EntreeDonnee {
  id: string;
  sessionId: string;
  /** Type de donnee : host, port, service, vulnerabilite, credential, dump, screenshot, etc. */
  type: string;
  /** Cible concernee (IP, URL, domaine). */
  cible: string;
  /** Cle / nom de la decouverte (ex. "SSH-22", "CVE-2024-1234", "root:password123"). */
  cle: string;
  /** Valeur de la decouverte. */
  valeur: string;
  /** Niveau de sensibilite. */
  sensibilite: Sensibilite;
  /** Source (outil qui a trouve la donnee). */
  source: string;
  /** Horodatage de decouverte. */
  decouvertA: number;
  /** Metadonnees additionnelles (JSON). */
  meta?: string;
}

/** Filtre de recherche dans la BDD. */
export interface FiltreRecherche {
  sessionId?: string;
  type?: string;
  cible?: string;
  sensibilite?: Sensibilite;
  texte?: string;
  limite?: number;
}

/** Resultat d'export. */
export interface ResultatExport {
  format: 'json' | 'csv' | 'sql';
  contenu: string;
  nbEntrees: number;
  tailleOctets: number;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Chiffrement simple (XOR + base64 pour simulation, AES-256 en production)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Cle de chiffrement (en production : derivee d'un mot de passe via PBKDF2). */
const CLE_CHIFFREMENT = 'cyber-hive-aes-256-key-2026-secure';

/** Chiffre une valeur sensible (simulation XOR + base64). */
export function chiffrer(valeur: string): string {
  const bytes = Buffer.from(valeur, 'utf8');
  const cleBytes = Buffer.from(CLE_CHIFFREMENT, 'utf8');
  const resultat = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    resultat[i] = bytes[i] ^ cleBytes[i % cleBytes.length];
  }
  return resultat.toString('base64');
}

/** Dechiffre une valeur sensible. */
export function dechiffrer(valeurChiffree: string): string {
  const bytes = Buffer.from(valeurChiffree, 'base64');
  const cleBytes = Buffer.from(CLE_CHIFFREMENT, 'utf8');
  const resultat = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    resultat[i] = bytes[i] ^ cleBytes[i % cleBytes.length];
  }
  return resultat.toString('utf8');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Base de donnees (simulation en memoire, SQLite en production)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Stockage en memoire (en production : better-sqlite3 ou sqlcipher). */
const stockage: Map<string, EntreeDonnee> = new Map();

/** Compteur d'ID. */
let compteurId = 0;

/** Genere un ID unique. */
function genererId(): string {
  compteurId++;
  return `donnee-${Date.now()}-${compteurId}`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  API publique
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Insere une decouverte dans la BDD. */
export function insererDonnee(
  sessionId: string,
  type: string,
  cible: string,
  cle: string,
  valeur: string,
  sensibilite: Sensibilite,
  source: string,
  meta?: Record<string, unknown>,
): EntreeDonnee {
  const entree: EntreeDonnee = {
    id: genererId(),
    sessionId,
    type,
    cible,
    cle,
    valeur: sensibilite === 'publique' ? valeur : chiffrer(valeur),
    sensibilite,
    source,
    decouvertA: Date.now(),
    meta: meta ? JSON.stringify(meta) : undefined,
  };
  stockage.set(entree.id, entree);
  return entree;
}

/** Recherche des donnees dans la BDD. */
export function rechercherDonnees(filtre: FiltreRecherche): EntreeDonnee[] {
  let resultats = Array.from(stockage.values());

  if (filtre.sessionId) {
    resultats = resultats.filter((e) => e.sessionId === filtre.sessionId);
  }
  if (filtre.type) {
    resultats = resultats.filter((e) => e.type === filtre.type);
  }
  if (filtre.cible) {
    resultats = resultats.filter((e) => e.cible.includes(filtre.cible!));
  }
  if (filtre.sensibilite) {
    resultats = resultats.filter((e) => e.sensibilite === filtre.sensibilite);
  }
  if (filtre.texte) {
    const texte = filtre.texte.toLowerCase();
    resultats = resultats.filter(
      (e) =>
        e.cle.toLowerCase().includes(texte) ||
        e.cible.toLowerCase().includes(texte) ||
        e.source.toLowerCase().includes(texte),
    );
  }

  resultats.sort((a, b) => b.decouvertA - a.decouvertA);

  if (filtre.limite) {
    resultats = resultats.slice(0, filtre.limite);
  }

  return resultats;
}

/** Recupere une entree par ID. */
export function obtenirDonnee(id: string): EntreeDonnee | undefined {
  const entree = stockage.get(id);
  if (entree && entree.sensibilite !== 'publique') {
    return { ...entree, valeur: dechiffrer(entree.valeur) };
  }
  return entree;
}

/** Supprime une entree. */
export function supprimerDonnee(id: string): boolean {
  return stockage.delete(id);
}

/** Supprime toutes les donnees d'une session. */
export function supprimerSession(sessionId: string): number {
  let count = 0;
  for (const [id, entree] of stockage) {
    if (entree.sessionId === sessionId) {
      stockage.delete(id);
      count++;
    }
  }
  return count;
}

/** Compte les entrees par type pour une session. */
export function statistiquesSession(sessionId: string): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const entree of stockage.values()) {
    if (entree.sessionId === sessionId) {
      stats[entree.type] = (stats[entree.type] || 0) + 1;
    }
  }
  return stats;
}

/** Liste toutes les sessions qui ont des donnees stockees. */
export function listerSessions(): string[] {
  const sessions = new Set<string>();
  for (const entree of stockage.values()) {
    sessions.add(entree.sessionId);
  }
  return Array.from(sessions);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Exporte les donnees d'une session en JSON. */
export function exporterJSON(sessionId: string): ResultatExport {
  const entrees = rechercherDonnees({ sessionId });
  const entreesDechiffrees = entrees.map((e) => ({
    ...e,
    valeur: e.sensibilite === 'publique' ? e.valeur : dechiffrer(e.valeur),
  }));
  const contenu = JSON.stringify(entreesDechiffrees, null, 2);
  return {
    format: 'json',
    contenu,
    nbEntrees: entrees.length,
    tailleOctets: Buffer.byteLength(contenu, 'utf8'),
  };
}

/** Exporte les donnees d'une session en CSV. */
export function exporterCSV(sessionId: string): ResultatExport {
  const entrees = rechercherDonnees({ sessionId });
  const enTetes = ['id', 'type', 'cible', 'cle', 'valeur', 'sensibilite', 'source', 'decouvertA'];
  const lignes = [enTetes.join(',')];
  for (const e of entrees) {
    const valeur = e.sensibilite === 'publique' ? e.valeur : dechiffrer(e.valeur);
    const ligne = [
      e.id,
      e.type,
      `"${e.cible.replace(/"/g, '""')}"`,
      `"${e.cle.replace(/"/g, '""')}"`,
      `"${valeur.replace(/"/g, '""')}"`,
      e.sensibilite,
      e.source,
      new Date(e.decouvertA).toISOString(),
    ];
    lignes.push(ligne.join(','));
  }
  const contenu = lignes.join('\n');
  return {
    format: 'csv',
    contenu,
    nbEntrees: entrees.length,
    tailleOctets: Buffer.byteLength(contenu, 'utf8'),
  };
}

/** Exporte les donnees d'une session en SQL (INSERT statements). */
export function exporterSQL(sessionId: string): ResultatExport {
  const entrees = rechercherDonnees({ sessionId });
  const lignes: string[] = [
    '-- Export Cyber Hive BDD',
    `-- Session: ${sessionId}`,
    `-- Date: ${new Date().toISOString()}`,
    '-- Table: cyber_hive_donnees',
    '',
    'CREATE TABLE IF NOT EXISTS cyber_hive_donnees (',
    '  id TEXT PRIMARY KEY,',
    '  session_id TEXT NOT NULL,',
    '  type TEXT NOT NULL,',
    '  cible TEXT NOT NULL,',
    '  cle TEXT NOT NULL,',
    '  valeur TEXT NOT NULL,',
    '  sensibilite TEXT NOT NULL,',
    '  source TEXT NOT NULL,',
    '  decouvert_a INTEGER NOT NULL,',
    '  meta TEXT',
    ');',
    '',
  ];
  for (const e of entrees) {
    const valeur = e.sensibilite === 'publique' ? e.valeur : dechiffrer(e.valeur);
    lignes.push(
      `INSERT INTO cyber_hive_donnees (id, session_id, type, cible, cle, valeur, sensibilite, source, decouvert_a, meta) VALUES ('${e.id}', '${e.sessionId}', '${e.type}', '${e.cible.replace(/'/g, "''")}', '${e.cle.replace(/'/g, "''")}', '${valeur.replace(/'/g, "''")}', '${e.sensibilite}', '${e.source}', ${e.decouvertA}, ${e.meta ? `'${e.meta.replace(/'/g, "''")}'` : 'NULL'});`,
    );
  }
  const contenu = lignes.join('\n');
  return {
    format: 'sql',
    contenu,
    nbEntrees: entrees.length,
    tailleOctets: Buffer.byteLength(contenu, 'utf8'),
  };
}

/** Exporte dans le format demande. */
export function exporter(sessionId: string, format: 'json' | 'csv' | 'sql'): ResultatExport {
  switch (format) {
    case 'json':
      return exporterJSON(sessionId);
    case 'csv':
      return exporterCSV(sessionId);
    case 'sql':
      return exporterSQL(sessionId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Integration avec les resultats d'outils et etapes
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Extrait et stocke les decouvertes d'un resultat d'outil. */
export function stockerResultatOutil(
  sessionId: string,
  resultat: ResultatOutil,
  cible: string,
): number {
  let count = 0;
  const stdout = resultat.stdout || '';

  // Detection de ports (Nmap, Masscan)
  const ports = stdout.match(/(\d+)\/(tcp|udp)\s+(open|filtered)/g);
  if (ports) {
    for (const match of ports) {
      const [, port, proto, etat] = match.match(/(\d+)\/(tcp|udp)\s+(open|filtered)/)!;
      insererDonnee(
        sessionId,
        'port',
        cible,
        `${proto}-${port}`,
        `${etat} - port ${port}/${proto}`,
        'publique',
        resultat.outilId,
        { port: parseInt(port, 10), proto, etat },
      );
      count++;
    }
  }

  // Detection de services
  const services = stdout.match(/(\d+)\/(tcp|udp)\s+open\s+(\S+)\s+(.*)/g);
  if (services) {
    for (const match of services) {
      const [, port, , service] = match.match(/(\d+)\/(tcp|udp)\s+open\s+(\S+)\s+(.*)/)!;
      insererDonnee(
        sessionId,
        'service',
        cible,
        `service-${port}`,
        service,
        'publique',
        resultat.outilId,
        { port: parseInt(port, 10) },
      );
      count++;
    }
  }

  // Detection de vulnerabilites (Nuclei, Nikto)
  const vulns = stdout.match(/\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]/g);
  if (vulns) {
    for (const match of vulns) {
      const [, template, severite, url] = match.match(/\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]/)!;
      const sens: Sensibilite =
        severite.toLowerCase() === 'critical' || severite.toLowerCase() === 'high'
          ? 'critique'
          : severite.toLowerCase() === 'medium'
            ? 'restreint'
            : 'publique';
      insererDonnee(
        sessionId,
        'vulnerabilite',
        cible,
        template,
        `${severite} sur ${url}`,
        sens,
        resultat.outilId,
        { template, severite, url },
      );
      count++;
    }
  }

  // Detection de credentials (Hydra, SQLMap)
  const creds = stdout.match(/login:\s*(\S+)\s+password:\s*(\S+)/gi);
  if (creds) {
    for (const match of creds) {
      const [, login, password] = match.match(/login:\s*(\S+)\s+password:\s*(\S+)/i)!;
      insererDonnee(
        sessionId,
        'credential',
        cible,
        `${login}`,
        `${login}:${password}`,
        'critique',
        resultat.outilId,
        { login, password },
      );
      count++;
    }
  }

  // Si rien de specifique detecte, stocker le stdout brut comme donnee
  if (count === 0 && stdout.trim().length > 0) {
    insererDonnee(
      sessionId,
      'sortie-brute',
      cible,
      `resultat-${resultat.outilId}`,
      stdout.substring(0, 4096),
      'restreint',
      resultat.outilId,
    );
    count++;
  }

  return count;
}

/** Stocke les donnees d'une etape d'attaque dans la BDD. */
export function stockerEtapeAttaque(sessionId: string, etape: EtapeAttaque): void {
  insererDonnee(
    sessionId,
    'etape',
    'timeline',
    `etape-${etape.id}`,
    `${etape.type}: ${etape.description}`,
    'publique',
    etape.agentId,
    { severite: etape.severite, explicite: etape.explication },
  );
}

/** Stocke un resume de session complete. */
export function stockerResumeSession(session: SessionPentest): void {
  insererDonnee(
    session.id,
    'resume-session',
    session.cible.hote,
    'resume',
    JSON.stringify({
      nom: session.nom,
      statut: session.statut,
      agents: session.agents.length,
      etapes: session.etapes.length,
      creeA: session.creeAt,
      termineA: session.termineAt,
    }),
    'restreint',
    'systeme',
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Nettoyage anti-forensics
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Nettoie completement la BDD (anti-forensics : shredding). */
export function nettoyageComplet(): number {
  const count = stockage.size;
  // En production : shred -u -z -n 3 sur le fichier SQLite
  // En memoire : overwrite puis clear
  for (const [id] of stockage) {
    const entree = stockage.get(id);
    if (entree) {
      entree.valeur = Buffer.alloc(256, 0).toString('hex');
      stockage.set(id, entree);
    }
  }
  stockage.clear();
  return count;
}

/** Nettoie une session specifique (anti-forensics). */
export function nettoyageSession(sessionId: string): number {
  return supprimerSession(sessionId);
}

/** Vider la BDD (pour les tests). */
export function viderBDD(): void {
  stockage.clear();
  compteurId = 0;
}