// Types communs au module Cyber Hive : orchestration d'agents de pentest,
// outils de sécurité via MCP, visualisation des attaques, anti-traçage.

import type { Task, SubAgent } from '../shared/types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Outils de sécurité
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Catégories d'outils de sécurité. */
export type CategorieOutil =
  | 'reconnaissance'
  | 'scan'
  | 'exploitation'
  | 'post-exploitation'
  | 'craquage'
  | 'web'
  | 'reseau'
  | 'forensic'
  | 'anti-tracage';

/** Niveau de risque associé à l'exécution d'un outil. */
export type NiveauRisque = 'faible' | 'moyen' | 'eleve' | 'critique';

/** Un outil de sécurité exposé via MCP. */
export interface OutilSecurite {
  /** Identifiant unique (ex. 'nmap', 'sqlmap'). */
  id: string;
  /** Nom affichable. */
  nom: string;
  /** Description courte. */
  description: string;
  /** Catégorie fonctionnelle. */
  categorie: CategorieOutil;
  /** Niveau de risque intrinsèque. */
  risque: NiveauRisque;
  /** Binaire ou commande à exécuter. */
  commande: string;
  /** Arguments par défaut. */
  argsDefaut?: string[];
  /** L'outil nécessite un conteneur Docker isolé. */
  conteneurRequis: boolean;
  /** L'outil nécessite des privilèges root. */
  rootRequis: boolean;
  /** Tags libres pour le filtrage. */
  tags?: string[];
}

/** Résultat d'exécution d'un outil de sécurité. */
export interface ResultatOutil {
  outilId: string;
  succes: boolean;
  codeSortie: number;
  /** Sortie stdout brute. */
  stdout: string;
  /** Sortie stderr brute. */
  stderr: string;
  /** Durée d'exécution en ms. */
  dureeMs: number;
  /** Horodatage de fin. */
  ts: number;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Agents de pentest
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Rôle d'un agent de pentest dans l'essaim. */
export type RoleAgentPentest =
  | 'reconnaissance' // Éclaireuse : scan initial, découverte
  | 'exploitation'   // Butineuse : exploitation des vulnérabilités
  | 'post-exploitation' // Gardienne : maintien d'accès, escalade
  | 'analyse'        // Concierge : analyse des résultats, synthèse
  | 'coordinatrice'; // Reine : orchestration globale

/** État d'un agent de pentest. */
export type StatutAgentPentest = 'inactif' | 'pret' | 'en-cours' | 'pause' | 'termine' | 'echec';

/** Un agent de pentest autonome. */
export interface AgentPentest {
  id: string;
  nom: string;
  role: RoleAgentPentest;
  statut: StatutAgentPentest;
  /** Agent IA sous-jacent (Claude Code, Cursor, etc.). */
  agentType: string;
  /** Outils assignés à cet agent. */
  outilsAssignes: string[];
  /** Tâche courante. */
  tacheCourante: string | null;
  /** Sous-agents (pour le suivi d'exécution). */
  sousAgents?: SubAgent[];
  /** Nombre d'actions effectuées. */
  actionsEffectuees: number;
  /** Dernière activité (timestamp). */
  derniereActivite: number | null;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Étapes d'attaque et visualisation
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Type d'action lors d'une étape d'attaque. */
export type TypeActionAttaque =
  | 'reconnaissance'
  | 'scan'
  | 'enumeration'
  | 'exploitation'
  | 'post-exploitation'
  | 'escalade-privileges'
  | 'exfiltration'
  | 'anti-forensic'
  | 'rapport';

/** Sévérité d'une étape d'attaque. */
export type SeveriteEtape = 'info' | 'remarque' | 'avertissement' | 'critique';

/** Une étape dans le déroulement d'une attaque. */
export interface EtapeAttaque {
  id: string;
  /** Session de pentest parente. */
  sessionId: string;
  /** Agent qui a effectué l'action. */
  agentId: string;
  /** Type d'action. */
  type: TypeActionAttaque;
  /** Sévérité. */
  severite: SeveriteEtape;
  /** Description humaine de l'action. */
  description: string;
  /** Explication contextuelle (pour la visualisation). */
  explication: string;
  /** Commande exécutée (si applicable). */
  commande?: string;
  /** Résultat de l'outil (si applicable). */
  resultat?: ResultatOutil;
  /** Horodatage. */
  ts: number;
  /** Durée en ms. */
  dureeMs: number;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Sessions de pentest
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** État d'une session de pentest. */
export type StatutSession = 'initialisation' | 'reconnaissance' | 'exploitation' | 'post-exploitation' | 'rapport' | 'termine' | 'echec';

/** Cible d'une session de pentest. */
export interface CiblePentest {
  /** Hôte ou plage d'IPs. */
  hote: string;
  /** Ports spécifiques (optionnel). */
  ports?: number[];
  /** Domaine ou URL (pour les tests web). */
  url?: string;
  /** Type de cible. */
  type: 'reseau' | 'web' | 'api' | 'mobile' | 'interne';
  /** Authorization scope (pour bug bounty). */
  scopeAutorise: string[];
}

/** Configuration anti-traçage pour une session. */
export interface ConfigAntiTrace {
  /** Activer le routage via TOR. */
  tor: boolean;
  /** Activer proxychains. */
  proxychains: boolean;
  /** Rotation d'identité (User-Agent, MAC). */
  rotationIdentite: boolean;
  /** Nettoyage des logs à la fin. */
  nettoyageLogs: boolean;
  /** Conteneurs éphémères (jetables). */
  conteneursEphemerers: boolean;
  /** Délai aléatoire entre les actions (ms). */
  delaiAleatoireMs: number;
}

/** Une session de pentest complète. */
export interface SessionPentest {
  id: string;
  /** Nom de la session. */
  nom: string;
  /** Cible de l'audit. */
  cible: CiblePentest;
  /** État courant. */
  statut: StatutSession;
  /** Agents assignés. */
  agents: AgentPentest[];
  /** Étapes d'attaque (timeline). */
  etapes: EtapeAttaque[];
  /** Configuration anti-traçage. */
  antiTrace: ConfigAntiTrace;
  /** Outils disponibles pour cette session. */
  outilsDisponibles: string[];
  /** Date de création. */
  creeeAt: number;
  /** Date de fin (si terminée). */
  termineeAt: number | null;
  /** Tâche Hive liée (si applicable). */
  tacheLiee?: Task;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Configuration MCP
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Configuration du serveur MCP pour Cyber Hive. */
export interface ConfigMCP {
  /** Port d'écoute du serveur MCP. */
  port: number;
  /** Outils à exposer via MCP. */
  outilsExposes: string[];
  /** Agents IA autorisés à se connecter. */
  agentsAutorises: string[];
  /** Timeout d'exécution des outils (ms). */
  timeoutMs: number;
  /** Nombre maximum d'outils simultanés. */
  maxOutilsSimultanes: number;
}

/** Configuration globale de Cyber Hive. */
export interface ConfigCyberHive {
  mcp: ConfigMCP;
  /** Image Docker Kali à utiliser. */
  imageKali: string;
  /** Répertoire de travail pour les conteneurs. */
  repertoireTravail: string;
  /** Niveau de verbosité des logs. */
  verbosite: 'minimal' | 'normal' | 'verbose';
  /** Mode simulation (sans exécution réelle). */
  simulation: boolean;
}

/** Configuration par défaut de Cyber Hive. */
export const CONFIG_DEFAUT: ConfigCyberHive = {
  mcp: {
    port: 8765,
    outilsExposes: [
      'nmap', 'sqlmap', 'nuclei', 'hydra', 'hashcat',
      'metasploit', 'ffuf', 'masscan', 'nikto',
    ],
    agentsAutorises: ['claude-code', 'cursor', 'cline', 'codex', 'grok'],
    timeoutMs: 120_000,
    maxOutilsSimultanes: 5,
  },
  imageKali: 'kalilinux/kali-rolling:latest',
  repertoireTravail: '/tmp/cyber-hive',
  verbosite: 'normal',
  simulation: true,
};

/** Configuration anti-traçage par défaut. */
export const ANTI_TRACE_DEFAUT: ConfigAntiTrace = {
  tor: false,
  proxychains: false,
  rotationIdentite: true,
  nettoyageLogs: true,
  conteneursEphemerers: true,
  delaiAleatoireMs: 500,
};