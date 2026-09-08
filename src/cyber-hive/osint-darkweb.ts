// Module OSINT + Dark Web pour Cyber-Hive
// Accès au dark web (Tor, .onion) et outils OSINT pour l'IA autonome.
// L'IA peut analyser sites, infrastructures et informations sur le dark web,
// collecter du renseignement en source ouverte, et tracer des personnes/entités.

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

/** Catégorie d'outil OSINT / dark web. */
export type CategorieOutilOSINT =
  | 'darkweb'
  | 'osint-reseau'
  | 'osint-social'
  | 'osint-email'
  | 'osint-domaine'
  | 'osint-personne'
  | 'osint-breach'
  | 'osint-crypto'
  | 'osint-geo'
  | 'osint-entreprise';

/** Niveau de risque d'un outil (pour l'orchestrateur). */
export type RisqueOutil = 'faible' | 'moyen' | 'eleve' | 'critique';

/** Un outil OSINT ou dark web disponible dans Cyber-Hive. */
export interface OutilOSINT {
  id: string;
  nom: string;
  description: string;
  categorie: CategorieOutilOSINT;
  risque: RisqueOutil;
  commande: string;
  argsDefaut: string[];
  containerRequis: boolean;
  torRequis: boolean;
  tags: string[];
  /** Source : natif, MCP server, ou API externe. */
  source: 'natif' | 'mcp' | 'api';
  /** URL ou référence du MCP server si applicable. */
  mcpRef?: string;
}

/** Type d'entité traçable sur le dark web / OSINT. */
export type TypeEntite =
  | 'personne'
  | 'entreprise'
  | 'domaine'
  | 'ip'
  | 'email'
  | 'username'
  | 'crypto'
  | 'onion'
  | 'ransomware'
  | 'breach';

/** Résultat d'une analyse OSINT / dark web. */
export interface ResultatOSINT {
  entite: string;
  typeEntite: TypeEntite;
  source: string;
  donnees: Record<string, unknown>;
  confiance: number; // 0-100
  timestamp: string;
}

/** Stratégie d'investigation OSINT. */
export interface StrategieOSINT {
  id: string;
  nom: string;
  description: string;
  typeEntite: TypeEntite;
  phases: PhaseOSINT[];
  outilsRequis: string[];
}

/** Phase d'une stratégie OSINT. */
export interface PhaseOSINT {
  id: number;
  nom: string;
  description: string;
  outils: string[];
  objectif: string;
}

/** Configuration du module OSINT. */
export interface ConfigOSINT {
  tor: {
    enabled: boolean;
    proxyHost: string;
    proxyPort: number;
    socksPort: number;
    controlPort: number;
  };
  darkweb: {
    onionScanEnabled: boolean;
    torBotEnabled: boolean;
    ahmiaSearchEnabled: boolean;
    timeoutOnion: number; // secondes
    maxOnionSites: number;
  };
  osint: {
    shodanApiKey?: string;
    intelxApiKey?: string;
    hibpApiKey?: string;
    virusTotalApiKey?: string;
    spiderfootEnabled: boolean;
    sherlockEnabled: boolean;
    maigretEnabled: boolean;
    theHarvesterEnabled: boolean;
  };
  mcp: {
    darknetMcpEnabled: boolean;
    contrastApiEnabled: boolean;
    openOsintEnabled: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Configuration par défaut
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG_OSINT_DEFAUT: ConfigOSINT = {
  tor: {
    enabled: true,
    proxyHost: '127.0.0.1',
    proxyPort: 9050,
    socksPort: 9050,
    controlPort: 9051,
  },
  darkweb: {
    onionScanEnabled: true,
    torBotEnabled: true,
    ahmiaSearchEnabled: true,
    timeoutOnion: 30,
    maxOnionSites: 50,
  },
  osint: {
    spiderfootEnabled: true,
    sherlockEnabled: true,
    maigretEnabled: true,
    theHarvesterEnabled: true,
  },
  mcp: {
    darknetMcpEnabled: true,
    contrastApiEnabled: true,
    openOsintEnabled: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Catalogue d'outils OSINT + Dark Web
// ─────────────────────────────────────────────────────────────────────────────

const CATALOGUE_OUTILS: OutilOSINT[] = [
  // ── Dark Web ──────────────────────────────────────────────────────────────
  {
    id: 'onionscan',
    nom: 'OnionScan',
    description: 'Audit et exploration de services cachés Tor (.onion). Détecte les fuites d\'identité, les serveurs mal configurés, les liens entre sites.',
    categorie: 'darkweb',
    risque: 'moyen',
    commande: 'onionscan',
    argsDefaut: ['--verbose', '--reportHiddenService'],
    containerRequis: true,
    torRequis: true,
    tags: ['tor', 'onion', 'audit', 'fingerprint'],
    source: 'natif',
  },
  {
    id: 'torbot',
    nom: 'TorBot',
    description: 'Crawler dark web : indexation automatique de sites .onion, collecte de données, scraping de contenu.',
    categorie: 'darkweb',
    risque: 'eleve',
    commande: 'torbot',
    argsDefaut: ['--crawl', '--depth=3'],
    containerRequis: true,
    torRequis: true,
    tags: ['tor', 'crawl', 'scraping', 'indexation'],
    source: 'natif',
  },
  {
    id: 'ahmia',
    nom: 'Ahmia Search',
    description: 'Moteur de recherche de services .onion. Recherche par mots-clés sur le dark web via l\'index Ahmia.',
    categorie: 'darkweb',
    risque: 'faible',
    commande: 'curl',
    argsDefaut: ['--socks5-hostname', '127.0.0.1:9050'],
    containerRequis: false,
    torRequis: true,
    tags: ['tor', 'search', 'onion', 'index'],
    source: 'api',
    mcpRef: 'https://ahmia.fi/search',
  },
  {
    id: 'tor-proxy',
    nom: 'Tor Proxy',
    description: 'Proxy SOCKS5 Tor pour router tout le trafic OSINT à travers le réseau Tor. Anonymat garanti.',
    categorie: 'darkweb',
    risque: 'faible',
    commande: 'tor',
    argsDefaut: ['--SocksPort', '9050', '--ControlPort', '9051'],
    containerRequis: false,
    torRequis: false,
    tags: ['tor', 'proxy', 'socks5', 'anonymat'],
    source: 'natif',
  },
  {
    id: 'darknet-mcp',
    nom: 'Darknet MCP Server',
    description: '66 outils dark web et breach intelligence : tracking ransomware, stealer logs, HIBP, IntelX, Tor .onion fetch, MalwareBazaar, ThreatFox, URLhaus, Bitcoin address intel.',
    categorie: 'darkweb',
    risque: 'critique',
    commande: 'npx',
    argsDefaut: ['darknet-mcp-server'],
    containerRequis: true,
    torRequis: true,
    tags: ['mcp', 'ransomware', 'stealer', 'breach', 'bitcoin', 'threat-intel'],
    source: 'mcp',
    mcpRef: 'npx darknet-mcp-server',
  },
  {
    id: 'exiftool',
    nom: 'ExifTool',
    description: 'Extraction de métadonnées EXIF/GPS depuis images trouvées sur le dark web. Géolocalisation de photos.',
    categorie: 'darkweb',
    risque: 'faible',
    commande: 'exiftool',
    argsDefaut: ['-j', '-G'],
    containerRequis: false,
    torRequis: false,
    tags: ['exif', 'gps', 'metadata', 'images'],
    source: 'natif',
  },
  {
    id: 'oniondump',
    nom: 'Onion Dump Analyzer',
    description: 'Analyse de dumps de données trouvés sur le dark web. Extraction et corrélation de credentials leakés.',
    categorie: 'darkweb',
    risque: 'critique',
    commande: 'python3',
    argsDefaut: ['/opt/oniondump/analyzer.py'],
    containerRequis: true,
    torRequis: true,
    tags: ['dump', 'credentials', 'leak', 'correlation'],
    source: 'natif',
  },
  {
    id: 'bitcoin-tracer',
    nom: 'Bitcoin Tracer',
    description: 'Tracing d\'adresses Bitcoin trouvées sur le dark web. Suivi des transactions, wallet clustering, heuristiques.',
    categorie: 'osint-crypto',
    risque: 'moyen',
    commande: 'python3',
    argsDefaut: ['/opt/btc-tracer/trace.py'],
    containerRequis: true,
    torRequis: false,
    tags: ['bitcoin', 'crypto', 'tracing', 'wallet', 'clustering'],
    source: 'api',
    mcpRef: 'https://www.blockchain.com/explorer',
  },

  // ── OSINT Réseau ──────────────────────────────────────────────────────────
  {
    id: 'shodan',
    nom: 'Shodan',
    description: 'Recherche d'appareils connectés à Internet. IP reconnaissance, DNS, vulnérabilités, dispositifs IoT.',
    categorie: 'osint-reseau',
    risque: 'moyen',
    commande: 'shodan',
    argsDefaut: ['search'],
    containerRequis: false,
    torRequis: false,
    tags: ['ip', 'iot', 'dns', 'vulnerabilities', 'recon'],
    source: 'api',
    mcpRef: 'Shodan MCP server',
  },
  {
    id: 'theharvester',
    nom: 'theHarvester',
    description: 'Collecte d'emails, sous-domaines, hôtes, noms d'employés depuis des sources publiques (Google, Bing, LinkedIn, etc.).',
    categorie: 'osint-domaine',
    risque: 'faible',
    commande: 'theHarvester',
    argsDefaut: ['-d', '-b', 'all'],
    containerRequis: true,
    torRequis: false,
    tags: ['email', 'subdomain', 'harvesting', 'recon'],
    source: 'natif',
  },
  {
    id: 'spiderfoot',
    nom: 'SpiderFoot',
    description: 'Framework OSINT automatisé : 200+ modules, scan de surface d'attaque, corrélation de données, reporting.',
    categorie: 'osint-reseau',
    risque: 'moyen',
    commande: 'spiderfoot',
    argsDefaut: ['-s'],
    containerRequis: true,
    torRequis: false,
    tags: ['osint', 'automation', 'correlation', '200-modules'],
    source: 'natif',
  },
  {
    id: 'dnstwist',
    nom: 'DNSTwist',
    description: 'DNS fuzzing : détection de typosquatting, phishing, cybersquatting sur un domaine.',
    categorie: 'osint-domaine',
    risque: 'faible',
    commande: 'dnstwist',
    argsDefaut: ['--registered'],
    containerRequis: false,
    torRequis: false,
    tags: ['dns', 'typosquatting', 'phishing', 'domain'],
    source: 'natif',
  },

  // ── OSINT Social / Personne ───────────────────────────────────────────────
  {
    id: 'sherlock',
    nom: 'Sherlock',
    description: 'Recherche de comptes sur 400+ réseaux sociaux par username. Énumération de présence en ligne.',
    categorie: 'osint-personne',
    risque: 'faible',
    commande: 'sherlock',
    argsDefaut: ['--timeout', '15'],
    containerRequis: true,
    torRequis: false,
    tags: ['username', 'social', 'enumeration', '400-sites'],
    source: 'natif',
  },
  {
    id: 'maigret',
    nom: 'Maigret',
    description: 'Collecte d'informations sur un compte utilisateur depuis diverses sources publiques. Profilage OSINT.',
    categorie: 'osint-personne',
    risque: 'faible',
    commande: 'maigret',
    argsDefaut: ['--html'],
    containerRequis: true,
    torRequis: false,
    tags: ['username', 'profiling', 'social', 'accounts'],
    source: 'natif',
  },
  {
    id: 'holehe',
    nom: 'Holehe',
    description: 'Vérification d'existence d'un compte email sur 120+ sites web sans alerter la cible.',
    categorie: 'osint-email',
    risque: 'faible',
    commande: 'holehe',
    argsDefaut: [],
    containerRequis: true,
    torRequis: false,
    tags: ['email', 'verification', 'accounts', 'passive'],
    source: 'natif',
  },
  {
    id: 'ghunt',
    nom: 'GHunt',
    description: 'OSINT Google : extraction d'informations depuis un email Google (ID, photos, reviews, YouTube, Maps).',
    categorie: 'osint-email',
    risque: 'moyen',
    commande: 'ghunt',
    argsDefaut: ['email'],
    containerRequis: true,
    torRequis: false,
    tags: ['google', 'email', 'osint', 'gmail'],
    source: 'natif',
  },

  // ── OSINT Breach / Threat Intel ────────────────────────────────────────────
  {
    id: 'hibp',
    nom: 'Have I Been Pwned',
    description: 'Vérification de fuites de données : un email a-t-il été compromis dans une breach connue ?',
    categorie: 'osint-breach',
    risque: 'faible',
    commande: 'curl',
    argsDefaut: ['-s'],
    containerRequis: false,
    torRequis: false,
    tags: ['breach', 'leak', 'email', 'credentials'],
    source: 'api',
    mcpRef: 'https://haveibeenpwned.com/api/v3',
  },
  {
    id: 'virustotal',
    nom: 'VirusTotal',
    description: 'Analyse d'URLs, fichiers (hash), IPs et domaines. Mapping de relations détaillé.',
    categorie: 'osint-reseau',
    risque: 'faible',
    commande: 'curl',
    argsDefaut: ['-s'],
    containerRequis: false,
    torRequis: false,
    tags: ['malware', 'url', 'ip', 'domain', 'hash'],
    source: 'api',
    mcpRef: 'VirusTotal MCP server',
  },
  {
    id: 'intelx',
    nom: 'Intelligence X',
    description: 'Moteur de recherche de fuites : dark web, pastes, breaches, données historiques. Archivage de sources publiques.',
    categorie: 'osint-breach',
    risque: 'moyen',
    commande: 'curl',
    argsDefaut: ['-s'],
    containerRequis: false,
    torRequis: true,
    tags: ['breach', 'leak', 'darkweb', 'archive', 'paste'],
    source: 'api',
    mcpRef: 'https://intelx.io',
  },

  // ── OSINT Entreprise ──────────────────────────────────────────────────────
  {
    id: 'recon-ng',
    nom: 'Recon-ng',
    description: 'Framework de reconnaissance web : modules pour OSINT entreprise, domaine, email, contacts.',
    categorie: 'osint-entreprise',
    risque: 'moyen',
    commande: 'recon-ng',
    argsDefaut: ['-r'],
    containerRequis: true,
    torRequis: false,
    tags: ['recon', 'framework', 'modules', 'company'],
    source: 'natif',
  },

  // ── OSINT Géospatial ──────────────────────────────────────────────────────
  {
    id: 'ipinfo',
    nom: 'IPInfo',
    description: 'Géolocalisation IP, ASN, détails réseau, détection de nœuds de sortie Tor, cartes interactives.',
    categorie: 'osint-geo',
    risque: 'faible',
    commande: 'curl',
    argsDefaut: ['-s'],
    containerRequis: false,
    torRequis: false,
    tags: ['ip', 'geo', 'asn', 'tor-exit'],
    source: 'api',
    mcpRef: 'IPInfo MCP server',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Stratégies d'investigation OSINT
// ─────────────────────────────────────────────────────────────────────────────

const STRATEGIES: StrategieOSINT[] = [
  {
    id: 'osint-personne-complete',
    nom: 'Investigation complète d\'une personne',
    description: 'Trouver et profiler une personne à partir d\'informations partielles (nom, email, username, téléphone).',
    typeEntite: 'personne',
    phases: [
      {
        id: 1,
        nom: 'Collecte initiale',
        description: 'Recueillir les informations de base sur la cible.',
        outils: ['theharvester', 'sherlock', 'maigret'],
        objectif: 'Énumérer les comptes en ligne, emails, usernames associés.',
      },
      {
        id: 2,
        nom: 'Vérification email',
        description: 'Vérifier les adresses email trouvées sur les réseaux et dans les breaches.',
        outils: ['holehe', 'hibp', 'ghunt'],
        objectif: 'Confirmer les emails actifs, détecter les fuites de données.',
      },
      {
        id: 3,
        nom: 'Corrélation',
        description: 'Croiser les données collectées pour établir un profil complet.',
        outils: ['spiderfoot', 'recon-ng'],
        objectif: 'Corréler emails, usernames, téléphones, adresses, photos.',
      },
      {
        id: 4,
        nom: 'Dark web check',
        description: 'Vérifier la présence de la cible sur le dark web (credentials leakés, mentions).',
        outils: ['darknet-mcp', 'intelx', 'onionscan'],
        objectif: 'Détecter credentials leakés, mentions dans forums dark web, dumps.',
      },
      {
        id: 5,
        nom: 'Géolocalisation',
        description: 'Déterminer la localisation probable de la cible.',
        outils: ['ipinfo', 'exiftool'],
        objectif: 'Géolocaliser via IP, métadonnées EXIF de photos publiées.',
      },
    ],
    outilsRequis: ['theharvester', 'sherlock', 'maigret', 'holehe', 'hibp', 'spiderfoot', 'darknet-mcp', 'intelx'],
  },
  {
    id: 'osint-domaine-complete',
    nom: 'Investigation complète d\'un domaine',
    description: 'Reconnaissance OSINT sur un domaine : sous-domaines, emails, technologies, vulnérabilités.',
    typeEntite: 'domaine',
    phases: [
      {
        id: 1,
        nom: 'Énumération DNS',
        description: 'Découvrir tous les sous-domaines et enregistrements DNS.',
        outils: ['theharvester', 'dnstwist'],
        objectif: 'Cartographier la surface d'attaque du domaine.',
      },
      {
        id: 2,
        nom: 'Reconnaissance infrastructure',
        description: 'Identifier les technologies, serveurs, et services exposés.',
        outils: ['shodan', 'spiderfoot'],
        objectif: 'Identifier IPs, ports ouverts, technologies, vulnérabilités.',
      },
      {
        id: 3,
        nom: 'Dark web monitoring',
        description: 'Vérifier si le domaine ou ses données apparaissent sur le dark web.',
        outils: ['darknet-mcp', 'intelx', 'ahmia'],
        objectif: 'Détecter credentials, dumps, mentions sur forums dark web.',
      },
    ],
    outilsRequis: ['theharvester', 'dnstwist', 'shodan', 'spiderfoot', 'darknet-mcp', 'intelx', 'ahmia'],
  },
  {
    id: 'osint-onion-audit',
    nom: 'Audit d\'un site .onion',
    description: 'Analyser un service caché Tor : fingerprinting, vulnérabilités, fuites d\'identité, liens.',
    typeEntite: 'onion',
    phases: [
      {
        id: 1,
        nom: 'Scan OnionScan',
        description: 'Audit complet du service caché avec OnionScan.',
        outils: ['onionscan'],
        objectif: 'Détecter les fuites d\'identité, serveurs mal configurés, liens.',
      },
      {
        id: 2,
        nom: 'Crawling',
        description: 'Crawler le site .onion pour collecter le contenu.',
        outils: ['torbot'],
        objectif: 'Indexer les pages, extraire les liens et données.',
      },
      {
        id: 3,
        nom: 'Analyse du contenu',
        description: 'Analyser le contenu crawlé pour identifier le type de site.',
        outils: ['exiftool', 'oniondump'],
        objectif: 'Déterminer si c\'est un marché, un forum, un service, etc.',
      },
      {
        id: 4,
        nom: 'Corrélation dark web',
        description: 'Corréler avec d\'autres sources dark web.',
        outils: ['darknet-mcp', 'intelx', 'ahmia'],
        objectif: 'Identifier des liens avec d\'autres sites, groupes ransomware, etc.',
      },
    ],
    outilsRequis: ['onionscan', 'torbot', 'exiftool', 'oniondump', 'darknet-mcp', 'intelx', 'ahmia'],
  },
  {
    id: 'osint-ransomware-track',
    nom: 'Tracking d\'un groupe ransomware',
    description: 'Suivre l\'activité d\'un groupe ransomware sur le dark web : victimes, leaks, techniques.',
    typeEntite: 'ransomware',
    phases: [
      {
        id: 1,
        nom: 'Identification du groupe',
        description: 'Identifier le groupe ransomware et son site de leak .onion.',
        outils: ['ahmia', 'darknet-mcp'],
        objectif: 'Trouver le site .onion du groupe, lister les victimes.',
      },
      {
        id: 2,
        nom: 'Audit du site de leak',
        description: 'Analyser le site .onion du groupe.',
        outils: ['onionscan', 'torbot'],
        objectif: 'Fingerprinting, extraction de la liste des victimes.',
      },
      {
        id: 3,
        nom: 'Corrélation threat intel',
        description: 'Corréler avec les bases de threat intelligence.',
        outils: ['darknet-mcp', 'virustotal', 'intelx'],
        objectif: 'Identifier les TTPs, les IOCs, les affiliés.',
      },
      {
        id: 4,
        nom: 'Bitcoin tracing',
        description: 'Tracer les paiements de rançon en Bitcoin.',
        outils: ['bitcoin-tracer'],
        objectif: 'Suivre les transactions, identifier les wallets, clustering.',
      },
    ],
    outilsRequis: ['ahmia', 'darknet-mcp', 'onionscan', 'torbot', 'virustotal', 'intelx', 'bitcoin-tracer'],
  },
  {
    id: 'osint-breach-check',
    nom: 'Vérification de fuite de données',
    description: 'Vérifier si une entité (email, domaine, personne) a été compromise dans une breach.',
    typeEntite: 'breach',
    phases: [
      {
        id: 1,
        nom: 'Check HIBP',
        description: 'Vérifier les fuites connues via Have I Been Pwned.',
        outils: ['hibp'],
        objectif: 'Lister les breaches où l\'email apparaît.',
      },
      {
        id: 2,
        nom: 'Dark web search',
        description: 'Rechercher les credentials sur le dark web.',
        outils: ['darknet-mcp', 'intelx', 'ahmia'],
        objectif: 'Trouver les credentials leakés, dumps, stealer logs.',
      },
      {
        id: 3,
        nom: 'Corrélation',
        description: 'Corréler les résultats avec d\'autres sources.',
        outils: ['spiderfoot', 'virustotal'],
        objectif: 'Évaluer l\'impact, identifier les données exposées.',
      },
    ],
    outilsRequis: ['hibp', 'darknet-mcp', 'intelx', 'ahmia', 'spiderfoot', 'virustotal'],
  },
  {
    id: 'osint-entreprise-recon',
    nom: 'Reconnaissance d\'entreprise',
    description: 'OSINT sur une entreprise : employés, infrastructure, présence en ligne, dark web.',
    typeEntite: 'entreprise',
    phases: [
      {
        id: 1,
        nom: 'Collecte employés',
        description: 'Identifier les employés et leurs rôles.',
        outils: ['theharvester', 'sherlock', 'maigret'],
        objectif: 'Lister les emails, noms, comptes sociaux des employés.',
      },
      {
        id: 2,
        nom: 'Infrastructure',
        description: 'Cartographier l\'infrastructure technique.',
        outils: ['shodan', 'spiderfoot', 'dnstwist'],
        objectif: 'IPs, sous-domaines, technologies, vulnérabilités.',
      },
      {
        id: 3,
        nom: 'Dark web',
        description: 'Vérifier la présence sur le dark web.',
        outils: ['darknet-mcp', 'intelx', 'hibp'],
        objectif: 'Credentials leakés, mentions, attaques subies.',
      },
    ],
    outilsRequis: ['theharvester', 'sherlock', 'maigret', 'shodan', 'spiderfoot', 'dnstwist', 'darknet-mcp', 'intelx', 'hibp'],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Prompt système IA pour l'analyse OSINT + dark web
// ─────────────────────────────────────────────────────────────────────────────

export function genererPromptSystemeOSINT(config?: ConfigOSINT): string {
  const c = config ?? CONFIG_OSINT_DEFAUT;
  const outilsDisponibles = listerOutils()
    .map((o) => `  - ${o.nom} (${o.id}) : ${o.description}`)
    .join('\n');

  const strategiesDisponibles = STRATEGIES.map(
    (s) => `  - ${s.nom} (${s.id}) : ${s.description} [${s.phases.length} phases]`,
  ).join('\n');

  return `Tu es l'IA OSINT de Cyber-Hive. Ton rôle est de collecter du renseignement en source ouverte (OSINT) et d'analyser le dark web.

## Tes capacités

### Outils OSINT disponibles
${outilsDisponibles}

### Stratégies d'investigation
${strategiesDisponibles}

### Accès dark web
${c.tor.enabled ? `- Tor proxy actif : ${c.tor.proxyHost}:${c.tor.socksPort} (SOCKS5)
- OnionScan : ${c.darkweb.onionScanEnabled ? 'activé' : 'désactivé'}
- TorBot : ${c.darkweb.torBotEnabled ? 'activé' : 'désactivé'}
- Ahmia : ${c.darkweb.ahmiaSearchEnabled ? 'activé' : 'désactivé'}
- Timeout .onion : ${c.darkweb.timeoutOnion}s
- Max sites .onion : ${c.darkweb.maxOnionSites}` : '- Tor DÉSACTIVÉ'}

### MCP servers
${c.mcp.darknetMcpEnabled ? '- Darknet MCP (66 outils) : activé' : '- Darknet MCP : désactivé'}
${c.mcp.contrastApiEnabled ? '- ContrastAPI (49 outils) : activé' : '- ContrastAPI : désactivé'}
${c.mcp.openOsintEnabled ? '- OpenOSINT : activé' : '- OpenOSINT : désactivé'}

## Comment tu fonctionnes

1. **Analyse la demande** : identifie le type d'entité (personne, domaine, IP, email, username, .onion, ransomware, breach, entreprise).
2. **Choisis une stratégie** : sélectionne la stratégie d'investigation la plus appropriée.
3. **Exécute les phases** : lance les outils dans l'ordre des phases, collecte les résultats.
4. **Corrèle** : croise les données de plusieurs sources pour établir des liens.
5. **Rapporte** : synthétise les findings avec un niveau de confiance pour chaque résultat.

## Règles

- Tu es autonome : tu choisis les outils et les enchaînes sans intervention humaine.
- Tu adaptes ta stratégie en fonction des résultats : si un outil ne donne rien, tu pivotes.
- Tu privilégies la corrélation multi-source : un finding confirmé par 2+ sources a un score de confiance plus élevé.
- Sur le dark web, tu utilises Tor pour tout le trafic. Tu ne révèles jamais l'IP réelle.
- Tu traces les adresses Bitcoin trouvées pour identifier les flux financiers.
- Tu détectes les marchés illicites, forums, et sites de leak sur le dark web.
- Tu peux demander des informations supplémentaires à l'utilisateur si nécessaire (email, username, domaine, etc.).
- Tu ne stockes pas de données personnelles au-delà de la session d'analyse.

## Types d'analyses supportées

- **Personne** : trouver et profiler une personne à partir d'un nom, email, username ou téléphone.
- **Domaine** : reconnaissance complète d'un domaine (sous-domaines, emails, technologies, vulnérabilités).
- **.onion** : audit d'un service caché Tor (fingerprinting, vulnérabilités, contenu, liens).
- **Ransomware** : tracking d'un groupe ransomware (victimes, leaks, Bitcoin, TTPs).
- **Breach** : vérification de fuite de données (HIBP, dark web, stealer logs).
- **Entreprise** : reconnaissance d'entreprise (employés, infrastructure, dark web).
- **IP** : géolocalisation, ASN, services exposés, réputation.
- **Email** : vérification de comptes, breaches, Google OSINT.
- **Crypto** : tracing d'adresses Bitcoin, wallet clustering, flux financiers.`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  API du module
// ─────────────────────────────────────────────────────────────────────────────

const registreOutils = new Map<string, OutilOSINT>();
for (const outil of CATALOGUE_OUTILS) {
  registreOutils.set(outil.id, outil);
}

/** Retourne tous les outils OSINT + dark web disponibles. */
export function listerOutils(): OutilOSINT[] {
  return [...registreOutils.values()];
}

/** Retourne un outil par son ID. */
export function obtenirOutil(id: string): OutilOSINT | undefined {
  return registreOutils.get(id);
}

/** Filtre les outils par catégorie. */
export function outilsParCategorie(categorie: CategorieOutilOSINT): OutilOSINT[] {
  return CATALOGUE_OUTILS.filter((o) => o.categorie === categorie);
}

/** Filtre les outils par tag. */
export function outilsParTag(tag: string): OutilOSINT[] {
  return CATALOGUE_OUTILS.filter((o) => o.tags?.includes(tag) ?? false);
}

/** Retourne les outils nécessitant Tor. */
export function outilsTorRequis(): OutilOSINT[] {
  return CATALOGUE_OUTILS.filter((o) => o.torRequis);
}

/** Retourne les outils disponibles via MCP. */
export function outilsMCP(): OutilOSINT[] {
  return CATALOGUE_OUTILS.filter((o) => o.source === 'mcp');
}

/** Retourne toutes les stratégies d'investigation. */
export function listerStrategies(): StrategieOSINT[] {
  return STRATEGIES;
}

/** Retourne une stratégie par son ID. */
export function obtenirStrategie(id: string): StrategieOSINT | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

/** Sélectionne automatiquement la meilleure stratégie pour un type d'entité. */
export function selectionnerStrategie(typeEntite: TypeEntite): StrategieOSINT | undefined {
  return STRATEGIES.find((s) => s.typeEntite === typeEntite);
}

/** Détecte automatiquement le type d'entité depuis une entrée utilisateur. */
export function detecterTypeEntite(entree: string): TypeEntite {
  const lower = entree.toLowerCase().trim();

  // .onion
  if (lower.endsWith('.onion') || lower.includes('.onion')) {
    return 'onion';
  }

  // Email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
    return 'email';
  }

  // IP
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(lower)) {
    return 'ip';
  }

  // Adresse Bitcoin (BTC)
  if (/^(bc1|[13])[a-z0-9]{25,62}$/i.test(lower)) {
    return 'crypto';
  }

  // Domaine
  if (/^[a-z0-9-]+\.[a-z]{2,}$/i.test(lower)) {
    return 'domaine';
  }

  // Ransomware (mots-clés)
  const ransomwareKeywords = ['lockbit', 'conti', 'blackcat', 'alphv', 'cl0p', 'play', 'akira', 'royal', 'hive', 'blackmatter', 'revil', 'sodinokibi', 'darkside', 'babuk', 'avaddon'];
  if (ransomwareKeywords.some((kw) => lower.includes(kw))) {
    return 'ransomware';
  }

  // Username (commence par @ ou un seul mot sans espace)
  if (lower.startsWith('@') || (/^[a-z0-9_.-]+$/.test(lower) && !lower.includes('.'))) {
    return 'username';
  }

  // Entreprise (mots-clés)
  const entrepriseKeywords = ['sarl', 'sas', 'sasu', 'sa ', 'inc', 'ltd', 'gmbh', 'corp', 'llc'];
  if (entrepriseKeywords.some((kw) => lower.includes(kw))) {
    return 'entreprise';
  }

  // Par défaut : personne
  return 'personne';
}

/** Génère un plan d'investigation pour une entité donnée. */
export function genererPlanInvestigation(entree: string): {
  typeEntite: TypeEntite;
  strategie: StrategieOSINT | undefined;
  phases: PhaseOSINT[];
} {
  const typeEntite = detecterTypeEntite(entree);
  const strategie = selectionnerStrategie(typeEntite);
  return {
    typeEntite,
    strategie,
    phases: strategie?.phases ?? [],
  };
}

/** Génère la commande shell pour un outil avec des arguments personnalisés. */
export function genererCommande(outilId: string, args?: string[]): string {
  const outil = obtenirOutil(outilId);
  if (!outil) {
    throw new Error(`Outil inconnu : ${outilId}`);
  }
  const argsFinaux = args ?? outil.argsDefaut;
  const torPrefix = outil.torRequis ? 'torsocks ' : '';
  return `${torPrefix}${outil.commande} ${argsFinaux.join(' ')}`;
}

/** Vérifie si Tor est accessible. */
export function verifierTor(config?: ConfigOSINT): boolean {
  const c = config ?? CONFIG_OSINT_DEFAUT;
  return c.tor.enabled;
}

/** Génère la configuration proxy Tor pour les outils. */
export function configProxyTor(config?: ConfigOSINT): string {
  const c = config ?? CONFIG_OSINT_DEFAUT;
  if (!c.tor.enabled) return '';
  return `socks5://${c.tor.proxyHost}:${c.tor.socksPort}`;
}

/** Liste les MCP servers OSINT recommandés et leur statut. */
export function listerMCPServers(config?: ConfigOSINT): Array<{
  nom: string;
  description: string;
  active: boolean;
  ref: string;
}> {
  const c = config ?? CONFIG_OSINT_DEFAUT;
  return [
    {
      nom: 'Darknet MCP',
      description: '66 outils dark web et breach intelligence : ransomware tracking, stealer logs, HIBP, IntelX, Tor .onion, MalwareBazaar, ThreatFox, URLhaus, Bitcoin intel.',
      active: c.mcp.darknetMcpEnabled,
      ref: 'npx darknet-mcp-server',
    },
    {
      nom: 'ContrastAPI',
      description: '49 outils : domain recon, IP reputation, CVE/EPSS/KEV, IOC enrichment, MITRE ATLAS, D3FEND, web intelligence.',
      active: c.mcp.contrastApiEnabled,
      ref: 'ContrastAPI MCP server',
    },
    {
      nom: 'OpenOSINT',
      description: 'Agent OSINT IA avec REPL interactif, MCP server et CLI. 9 outils d'intelligence.',
      active: c.mcp.openOsintEnabled,
      ref: 'OpenOSINT MCP server',
    },
    {
      nom: 'OSINT Tools MCP',
      description: '7 outils OSINT classiques : Sherlock, Blackbird, Maigret, Holehe, GHunt, theHarvester, SpiderFoot.',
      active: true,
      ref: 'OSINT Tools MCP server',
    },
    {
      nom: 'Clearfront',
      description: '30 outils self-OSINT : username enum, email/breach checks, domain/IP recon, EXIF/GPS extraction. Graphe de preuves.',
      active: true,
      ref: 'pip install clearfront',
    },
    {
      nom: 'VulneraMCP',
      description: 'Bug bounty MCP : recon (subfinder, httpx, gau, ffuf), vuln testing (XSS/SQLi/IDOR/CSRF), API/auth/cloud scanning.',
      active: true,
      ref: 'VulneraMCP server',
    },
    {
      nom: 'ScanMalware',
      description: '128 outils : analyse sandboxed de URLs, pivots par domaine/IP/ASN/JARM/favicon hash, YARA, TLS/RDAP, Certificate Transparency.',
      active: true,
      ref: 'https://mcp.scanmalware.com/mcp',
    },
    {
      nom: 'Voidly',
      description: '116 outils de censure internet sur 119+ pays : OONI, IODA, CensoredPlanet, prédictions ML de shutdowns.',
      active: true,
      ref: 'npx @voidly/mcp-server',
    },
    {
      nom: 'World Intel MCP',
      description: '120 outils : GDELT, 119 flux RSS, ACLED conflits, tracking avions militaires, avertissements maritimes, sanctions OFAC.',
      active: true,
      ref: 'World Intel MCP server',
    },
    {
      nom: 'Satellite MCP',
      description: '171 outils géospatiaux : Sentinel-2, Landsat, NASA FIRMS, night-lights change detection, tracking avions/navires.',
      active: true,
      ref: 'npx satellite-mcp',
    },
  ];
}

/** Génère un rapport de synthèse des résultats OSINT. */
export function synthetiserRapport(resultats: ResultatOSINT[]): string {
  if (resultats.length === 0) {
    return 'Aucun résultat OSINT trouvé.';
  }

  const parSource = new Map<string, ResultatOSINT[]>();
  for (const r of resultats) {
    if (!parSource.has(r.source)) {
      parSource.set(r.source, []);
    }
    parSource.get(r.source)!.push(r);
  }

  let rapport = `# Rapport OSINT\n\n`;
  rapport += `**Entités analysées** : ${resultats.length}\n`;
  rapport += `**Sources** : ${parSource.size}\n\n`;

  for (const [source, items] of parSource) {
    rapport += `## ${source} (${items.length} résultats)\n\n`;
    for (const item of items) {
      rapport += `### ${item.entite} [${item.typeEntite}]\n`;
      rapport += `- Confiance : ${item.confiance}%\n`;
      rapport += `- Timestamp : ${item.timestamp}\n`;
      const keys = Object.keys(item.donnees);
      if (keys.length > 0) {
        rapport += `- Données : ${keys.join(', ')}\n`;
      }
      rapport += '\n';
    }
  }

  const confianceMoyenne = resultats.reduce((sum, r) => sum + r.confiance, 0) / resultats.length;
  rapport += `---\n**Confiance moyenne** : ${confianceMoyenne.toFixed(1)}%\n`;

  return rapport;
}