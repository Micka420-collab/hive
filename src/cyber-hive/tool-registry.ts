// Registre des outils de sécurité disponibles dans Cyber Hive.
// Chaque outil est décrit de façon statique ; l'exécution réelle se fait
// via les adaptateurs (src/adapters/security/) ou dans un conteneur Docker.

import type { OutilSecurite } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Catalogue d'outils
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

const CATALOGUE: OutilSecurite[] = [
  // ── Reconnaissance & Scan ──────────────────────────────────────────
  {
    id: 'nmap',
    nom: 'Nmap',
    description: 'Scanner réseau : découverte d'hôtes, scan de ports, détection de services.',
    categorie: 'scan',
    risque: 'moyen',
    commande: 'nmap',
    argsDefaut: ['-sV', '-sC'],
    conteneurRequis: true,
    rootRequis: false,
    tags: ['reseau', 'ports', 'services'],
  },
  {
    id: 'masscan',
    nom: 'Masscan',
    description: 'Scanner de ports ultra-rapide pour de larges plages d'IPs.',
    categorie: 'scan',
    risque: 'moyen',
    commande: 'masscan',
    argsDefaut: ['--rate=1000'],
    conteneurRequis: true,
    rootRequis: true,
    tags: ['reseau', 'ports', 'rapide'],
  },
  {
    id: 'nikto',
    nom: 'Nikto',
    description: 'Scanner de vulnérabilités web : headers, fichiers, configurations.',
    categorie: 'web',
    risque: 'moyen',
    commande: 'nikto',
    argsDefaut: ['-h'],
    conteneurRequis: true,
    rootRequis: false,
    tags: ['web', 'http', 'vulnerabilites'],
  },

  // ── Exploitation ───────────────────────────────────────────────────
  {
    id: 'sqlmap',
    nom: 'SQLMap',
    description: 'Détection et exploitation automatique d'injections SQL.',
    categorie: 'exploitation',
    risque: 'eleve',
    commande: 'sqlmap',
    argsDefaut: ['--batch'],
    conteneurRequis: true,
    rootRequis: false,
    tags: ['web', 'sqli', 'injection'],
  },
  {
    id: 'metasploit',
    nom: 'Metasploit Framework',
    description: 'Framework d'exploitation : payloads, modules, sessions.',
    categorie: 'exploitation',
    risque: 'critique',
    commande: 'msfconsole',
    argsDefaut: ['-q'],
    conteneurRequis: true,
    rootRequis: true,
    tags: ['exploit', 'payload', 'post-exploitation'],
  },
  {
    id: 'nuclei',
    nom: 'Nuclei',
    description: 'Scanner de vulnérabilités basé sur des templates YAML.',
    categorie: 'web',
    risque: 'moyen',
    commande: 'nuclei',
    argsDefaut: ['-silent'],
    conteneurRequis: true,
    rootRequis: false,
    tags: ['web', 'templates', 'cve'],
  },

  // ── Craquage de mots de passe ──────────────────────────────────────
  {
    id: 'hydra',
    nom: 'Hydra',
    description: 'Attaque par force brute sur protocoles (SSH, FTP, HTTP, etc.).',
    categorie: 'craquage',
    risque: 'eleve',
    commande: 'hydra',
    argsDefaut: [],
    conteneurRequis: true,
    rootRequis: false,
    tags: ['brute-force', 'auth', 'password'],
  },
  {
    id: 'hashcat',
    nom: 'Hashcat',
    description: 'Craquage de hashes par GPU/CPU (MD5, SHA, NTLM, etc.).',
    categorie: 'craquage',
    risque: 'moyen',
    commande: 'hashcat',
    argsDefaut: [],
    conteneurRequis: true,
    rootRequis: false,
    tags: ['hash', 'gpu', 'password'],
  },

  // ── Web & Fuzzing ──────────────────────────────────────────────────
  {
    id: 'ffuf',
    nom: 'FFUF',
    description: 'Fuzzer web : découverte de contenu, paramètres, vhosts.',
    categorie: 'web',
    risque: 'moyen',
    commande: 'ffuf',
    argsDefaut: ['-ac'],
    conteneurRequis: true,
    rootRequis: false,
    tags: ['fuzzing', 'web', 'enumeration'],
  },

  // ── Anti-traçage ───────────────────────────────────────────────────
  {
    id: 'proxychains',
    nom: 'Proxychains',
    description: 'Routage du trafic via proxies chaînés (TOR, SOCKS).',
    categorie: 'anti-tracage',
    risque: 'faible',
    commande: 'proxychains',
    argsDefaut: [],
    conteneurRequis: false,
    rootRequis: false,
    tags: ['proxy', 'tor', 'anonymat'],
  },
  {
    id: 'tor',
    nom: 'TOR',
    description: 'Routage anonyme du trafic réseau via le réseau TOR.',
    categorie: 'anti-tracage',
    risque: 'faible',
    commande: 'tor',
    argsDefaut: [],
    conteneurRequis: false,
    rootRequis: false,
    tags: ['anonymat', 'reseau'],
  },
];

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  API du registre
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

const registre = new Map<string, OutilSecurite>();
for (const outil of CATALOGUE) {
  registre.set(outil.id, outil);
}

/** Retourne tous les outils enregistrés. */
export function listerOutils(): OutilSecurite[] {
  return [...registre.values()];
}

/** Retourne un outil par son identifiant. */
export function obtenirOutil(id: string): OutilSecurite | undefined {
  return registre.get(id);
}

/** Filtre les outils par catégorie. */
export function outilsParCategorie(categorie: OutilSecurite['categorie']): OutilSecurite[] {
  return CATALOGUE.filter((o) => o.categorie === categorie);
}

/** Filtre les outils par tag. */
export function outilsParTag(tag: string): OutilSecurite[] {
  return CATALOGUE.filter((o) => o.tags?.includes(tag) ?? false);
}

/** Enregistre un outil supplémentaire (extension dynamique). */
export function enregistrerOutil(outil: OutilSecurite): void {
  registre.set(outil.id, outil);
}

/** Vérifie qu'un outil existe dans le registre. */
export function outilExiste(id: string): boolean {
  return registre.has(id);
}