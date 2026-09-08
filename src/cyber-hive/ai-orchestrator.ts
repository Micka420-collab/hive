// Orchestrateur IA unifié pour Cyber Hive.
// Combine les LLMs connectés (Claude, GPT, Gemini, etc.) avec les serveurs MCP
// externes (AutoPentest, HexStrike, Shannon, etc.) pour créer un agent de
// pentest autonome qui peut utiliser n'importe quel outil.
// Inspiré de Zen-AI-Pentest (multi-agent state machine) et LLM4Pentest (scheduling).

import type { MessageIA, RequeteIA, ReponseIA } from './connection-types';
import { GestionnaireConnexions, creerGestionnaireConnexions } from './connection-manager';
import { GestionnaireMcp, creerGestionnaireMcp, SERVEURS_MCP_PREDEFINIS } from './mcp-client';
import type { OutilMcpExterne } from './connection-types';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Types de l'orchestrateur
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** État de l'orchestrateur IA. */
export type EtatOrchestrateur = 'inactif' | 'initialisation' | 'actif' | 'pause' | 'erreur';

/** Phase de pentest dans le workflow. */
export type PhasePentest =
  | 'reconnaissance'
  | 'scan'
  | 'enumeration'
  | 'exploitation'
  | 'post-exploitation'
  | 'analyse'
  | 'rapport';

/** Décision prise par l'IA. */
export interface DecisionIA {
  phase: PhasePentest;
  action: string;
  outil: string;
  arguments: Record<string, unknown>;
  raisonnement: string;
  priorite: 'basse' | 'normale' | 'haute' | 'critique';
}

/** Résultat d'une action d'outil. */
export interface ResultatAction {
  decision: DecisionIA;
  success: boolean;
  output?: unknown;
  erreur?: string;
  dureeMs: number;
}

/** Contexte de pentest partagé entre les agents. */
export interface ContextePentest {
  /** Cible actuelle. */
  cible: string;
  /** Phase actuelle. */
  phase: PhasePentest;
  /** Données collectées (ports, services, vulnérabilités, credentials). */
  donnees: {
    ports?: number[];
    services?: { port: number; service: string; version?: string }[];
    vulnerabilites?: { id: string; severite: string; description: string }[];
    credentials?: { utilisateur: string; motDePasse: string; source: string }[];
    technologies?: string[];
    sousDomaines?: string[];
    urls?: string[];
  };
  /** Historique des décisions. */
  historique: DecisionIA[];
  /** Historique des résultats. */
  resultats: ResultatAction[];
  /** Outils MCP disponibles. */
  outilsDisponibles: OutilMcpExterne[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Orchestrateur IA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export class OrchestrateurIA {
  private gestionnaireConnexions: GestionnaireConnexions;
  private gestionnaireMcp: GestionnaireMcp;
  private etat: EtatOrchestrateur = 'inactif';
  private contexte: ContextePentest | null = null;
  private providerLLM: string = 'claude';
  private onDecision?: (d: DecisionIA) => void;
  private onResultat?: (r: ResultatAction) => void;
  private onPhaseChange?: (p: PhasePentest) => void;

  constructor(opts?: {
    gestionnaireConnexions?: GestionnaireConnexions;
    gestionnaireMcp?: GestionnaireMcp;
    providerLLM?: string;
  }) {
    this.gestionnaireConnexions = opts?.gestionnaireConnexions ?? creerGestionnaireConnexions();
    this.gestionnaireMcp = opts?.gestionnaireMcp ?? creerGestionnaireMcp();
    this.providerLLM = opts?.providerLLM ?? 'claude';
  }

  // ─── Configuration ──────────────────────────────────────────────────────

  /** Définit le provider LLM à utiliser pour les décisions. */
  definirProviderLLM(providerId: string): void {
    this.providerLLM = providerId;
  }

  /** Définit les callbacks pour le streaming temps réel. */
  definirCallbacks(callbacks: {
    onDecision?: (d: DecisionIA) => void;
    onResultat?: (r: ResultatAction) => void;
    onPhaseChange?: (p: PhasePentest) => void;
  }): void {
    this.onDecision = callbacks.onDecision;
    this.onResultat = callbacks.onResultat;
    this.onPhaseChange = callbacks.onPhaseChange;
  }

  /** Retourne le gestionnaire de connexions. */
  obtenirConnexions(): GestionnaireConnexions {
    return this.gestionnaireConnexions;
  }

  /** Retourne le gestionnaire MCP. */
  obtenirMcp(): GestionnaireMcp {
    return this.gestionnaireMcp;
  }

  /** Retourne l'état actuel. */
  obtenirEtat(): EtatOrchestrateur {
    return this.etat;
  }

  /** Retourne le contexte de pentest. */
  obtenirContexte(): ContextePentest | null {
    return this.contexte;
  }

  // ─── Initialisation ─────────────────────────────────────────────────────

  /**
   * Initialise l'orchestrateur avec une cible.
   * Connecte les serveurs MCP disponibles et prépare le contexte.
   */
  async initialiser(cible: string): Promise<{ erreur?: string }> {
    this.etat = 'initialisation';
    this.contexte = {
      cible,
      phase: 'reconnaissance',
      donnees: {},
      historique: [],
      resultats: [],
      outilsDisponibles: [],
    };

    // Découvrir les outils MCP disponibles
    const tousOutils = this.gestionnaireMcp.listerTousOutils();
    const outils: OutilMcpExterne[] = [];
    for (const groupe of tousOutils) {
      outils.push(...groupe.outils);
    }
    this.contexte.outilsDisponibles = outils;

    this.etat = 'actif';
    return {};
  }

  // ─── Boucle autonome ────────────────────────────────────────────────────

  /**
   * Demande à l'IA de prendre une décision sur la prochaine action.
   */
  async prendreDecision(): Promise<DecisionIA | { erreur: string }> {
    if (!this.contexte || this.etat !== 'actif') {
      return { erreur: 'Orchestrateur non initialisé' };
    }

    const prompt = this.construirePromptDecision(this.contexte);

    const requete: RequeteIA = {
      providerId: this.providerLLM,
      messages: [
        {
          role: 'system',
          content: `Tu es un agent de pentest autonome dans Cyber Hive. Tu analyses le contexte et décides de la prochaine action à exécuter.

Phases disponibles: reconnaissance, scan, enumeration, exploitation, post-exploitation, analyse, rapport.

Outils disponibles via MCP: ${this.contexte.outilsDisponibles.map((o) => o.name).join(', ')}

Réponds en JSON avec: phase, action, outil, arguments, raisonnement, priorite.`,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 1024,
    };

    const reponse = await this.gestionnaireConnexions.envoyerRequete(requete);
    if (reponse.erreur) {
      return { erreur: reponse.erreur };
    }

    try {
      // Parser la décision JSON
      const json = this.extraireJson(reponse.content);
      if (!json) return { erreur: 'Réponse IA non parsable' };

      const decision: DecisionIA = {
        phase: json.phase ?? this.contexte.phase,
        action: json.action ?? 'unknown',
        outil: json.outil ?? '',
        arguments: json.arguments ?? {},
        raisonnement: json.raisonnement ?? '',
        priorite: json.priorite ?? 'normale',
      };

      // Changer de phase si nécessaire
      if (decision.phase !== this.contexte.phase) {
        this.contexte.phase = decision.phase;
        this.onPhaseChange?.(decision.phase);
      }

      this.contexte.historique.push(decision);
      this.onDecision?.(decision);

      return decision;
    } catch {
      return { erreur: 'Erreur de parsing de la décision IA' };
    }
  }

  /**
   * Exécute une décision (appelle l'outil MCP ou l'outil interne).
   */
  async executerDecision(decision: DecisionIA): Promise<ResultatAction> {
    const debut = Date.now();

    if (!this.contexte) {
      return { decision, success: false, erreur: 'Pas de contexte', dureeMs: 0 };
    }

    // Essayer d'appeler l'outil via MCP
    const result = await this.gestionnaireMcp.appelerOutilGlobal(
      decision.outil,
      decision.arguments,
    );

    const resultat: ResultatAction = {
      decision,
      success: result.success,
      output: result.result,
      erreur: result.erreur,
      dureeMs: Date.now() - debut,
    };

    this.contexte.resultats.push(resultat);
    this.onResultat?.(resultat);

    // Mettre à jour le contexte avec les résultats
    this.mettreAJourContexte(resultat);

    return resultat;
  }

  /**
   * Boucle autonome: prend des décisions et exécute jusqu'à la phase rapport.
   */
  async boucleAutonome(maxIterations = 50): Promise<ResultatAction[]> {
    if (!this.contexte || this.etat !== 'actif') {
      return [];
    }

    const tousResultats: ResultatAction[] = [];

    for (let i = 0; i < maxIterations; i++) {
      if (this.etat !== 'actif') break;
      if (this.contexte.phase === 'rapport') break;

      const decision = await this.prendreDecision();
      if ('erreur' in decision) {
        this.etat = 'erreur';
        break;
      }

      const resultat = await this.executerDecision(decision);
      tousResultats.push(resultat);

      // Si l'outil a échoué, on continue quand même
      if (!resultat.success && resultat.erreur?.includes('non trouvé')) {
        // Outil MCP non disponible, essayer un outil interne
        continue;
      }
    }

    return tousResultats;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Construit le prompt pour l'IA basé sur le contexte actuel. */
  private construirePromptDecision(ctx: ContextePentest): string {
    const lignes: string[] = [
      `Cible: ${ctx.cible}`,
      `Phase actuelle: ${ctx.phase}`,
      '',
      'Données collectées:',
    ];

    if (ctx.donnees.ports?.length) {
      lignes.push(`  Ports: ${ctx.donnees.ports.join(', ')}`);
    }
    if (ctx.donnees.services?.length) {
      lignes.push(`  Services: ${ctx.donnees.services.map((s) => `${s.port}/${s.service}`).join(', ')}`);
    }
    if (ctx.donnees.vulnerabilites?.length) {
      lignes.push(`  Vulnérabilités: ${ctx.donnees.vulnerabilites.length} trouvées`);
    }
    if (ctx.donnees.credentials?.length) {
      lignes.push(`  Credentials: ${ctx.donnees.credentials.length} trouvés`);
    }
    if (ctx.donnees.technologies?.length) {
      lignes.push(`  Technologies: ${ctx.donnees.technologies.join(', ')}`);
    }

    lignes.push('', 'Actions précédentes:');
    const recentes = ctx.historique.slice(-5);
    for (const h of recentes) {
      lignes.push(`  - ${h.outil} (${h.phase}): ${h.action}`);
    }

    lignes.push('', 'Outils MCP disponibles:');
    for (const o of ctx.outilsDisponibles) {
      lignes.push(`  - ${o.name}: ${o.description}`);
    }

    lignes.push('', 'Quelle est la prochaine action à exécuter ?');

    return lignes.join('\n');
  }

  /** Extrait le JSON d'une réponse IA (gère le markdown code blocks). */
  private extraireJson(text: string): Record<string, unknown> | null {
    // Essayer de parser directement
    try {
      return JSON.parse(text);
    } catch {
      // Ignorer
    }

    // Chercher un bloc ```json
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Ignorer
      }
    }

    // Chercher le premier { ... }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Ignorer
      }
    }

    return null;
  }

  /** Met à jour le contexte avec les résultats d'une action. */
  private mettreAJourContexte(resultat: ResultatAction): void {
    if (!this.contexte || !resultat.output) return;

    const output = resultat.output as Record<string, unknown>;

    // Détecter des ports
    if (Array.isArray(output.ports)) {
      this.contexte.donnees.ports ??= [];
      for (const p of output.ports as number[]) {
        if (!this.contexte.donnees.ports.includes(p)) {
          this.contexte.donnees.ports.push(p);
        }
      }
    }

    // Détecter des services
    if (Array.isArray(output.services)) {
      this.contexte.donnees.services ??= [];
      this.contexte.donnees.services.push(...(output.services as typeof this.contexte.donnees.services));
    }

    // Détecter des vulnérabilités
    if (Array.isArray(output.vulnerabilites)) {
      this.contexte.donnees.vulnerabilites ??= [];
      this.contexte.donnees.vulnerabilites.push(
        ...(output.vulnerabilites as typeof this.contexte.donnees.vulnerabilites),
      );
    }

    // Détecter des credentials
    if (Array.isArray(output.credentials)) {
      this.contexte.donnees.credentials ??= [];
      this.contexte.donnees.credentials.push(
        ...(output.credentials as typeof this.contexte.donnees.credentials),
      );
    }

    // Détecter des technologies
    if (Array.isArray(output.technologies)) {
      this.contexte.donnees.technologies ??= [];
      for (const t of output.technologies as string[]) {
        if (!this.contexte.donnees.technologies.includes(t)) {
          this.contexte.donnees.technologies.push(t);
        }
      }
    }
  }

  /** Met en pause l'orchestrateur. */
  pause(): void {
    this.etat = 'pause';
  }

  **Reprend l'orchestrateur.*/
  reprendre(): void {
    if (this.etat === 'pause') this.etat = 'actif';
  }

  /** Arrête l'orchestrateur. */
  arreter(): void {
    this.etat = 'inactif';
    this.contexte = null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Factory
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Crée un orchestrateur IA avec configuration par défaut. */
export function creerOrchestrateurIA(opts?: {
  providerLLM?: string;
}): OrchestrateurIA {
  return new OrchestrateurIA(opts);
}