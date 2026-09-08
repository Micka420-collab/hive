// Visualiseur d'attaques en temps réel pour Cyber Hive.
// Construit la timeline des étapes, génère des résumés et des exports.

import type { EtapeAttaque, SessionPentest, AgentPentest } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Types de visualisation
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Nœud d'une timeline visuelle. */
export interface NoeudTimeline {
  etape: EtapeAttaque;
  agent: AgentPentest | undefined;
  profondeur: number;
  enfants: NoeudTimeline[];
}

/** Résumé d'une session pour le dashboard. */
export interface ResumeSession {
  sessionId: string;
  nom: string;
  statut: string;
  cible: string;
  nbAgents: number;
  nbEtapes: number;
  nbActionsTotal: number;
  dureeMs: number;
  etapesParSeverite: Record<string, number>;
  etapesParType: Record<string, number>;
}

/** Rapport de pentest formaté. */
export interface RapportPentest {
  session: ResumeSession;
  timeline: NoeudTimeline[];
  resume: string;
  recommandations: string[];
  dateGeneration: number;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Visualiseur
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class VisualiseurAttaques {
  /** Construit la timeline arborescente d'une session. */
  construireTimeline(session: SessionPentest): NoeudTimeline[] {
    const racines: NoeudTimeline[] = [];
    const parAgent = new Map<string, NoeudTimeline[]>();

    for (const etape of session.etapes) {
      const agent = session.agents.find((a) => a.id === etape.agentId);
      const noeud: NoeudTimeline = {
        etape,
        agent,
        profondeur: 0,
        enfants: [],
      };

      const liste = parAgent.get(etape.agentId) ?? [];
      if (liste.length > 0) {
        liste[liste.length - 1].enfants.push(noeud);
        noeud.profondeur = liste[liste.length - 1].profondeur + 1;
      } else {
        racines.push(noeud);
      }
      liste.push(noeud);
      parAgent.set(etape.agentId, liste);
    }

    return racines;
  }

  /** Génère un résumé statistique d'une session. */
  genererResume(session: SessionPentest): ResumeSession {
    const etapesParSeverite: Record<string, number> = {};
    const etapesParType: Record<string, number> = {};

    for (const etape of session.etapes) {
      etapesParSeverite[etape.severite] = (etapesParSeverite[etape.severite] ?? 0) + 1;
      etapesParType[etape.type] = (etapesParType[etape.type] ?? 0) + 1;
    }

    const nbActionsTotal = session.agents.reduce(
      (sum, a) => sum + a.actionsEffectuees,
      0,
    );

    const dureeMs = session.termineeAt
      ? session.termineeAt - session.creeeAt
      : Date.now() - session.creeeAt;

    return {
      sessionId: session.id,
      nom: session.nom,
      statut: session.statut,
      cible: session.cible.hote,
      nbAgents: session.agents.length,
      nbEtapes: session.etapes.length,
      nbActionsTotal,
      dureeMs,
      etapesParSeverite,
      etapesParType,
    };
  }

  /** Génère un rapport de pentest complet. */
  genererRapport(session: SessionPentest): RapportPentest {
    const resume = this.genererResume(session);
    const timeline = this.construireTimeline(session);

    const lignes: string[] = [];
    lignes.push(`# Rapport de pentest : ${session.nom}`);
    lignes.push(`\n**Cible** : ${session.cible.hote}`);
    lignes.push(`**Statut** : ${session.statut}`);
    lignes.push(`**Agents** : ${session.agents.length}`);
    lignes.push(`**Étapes** : ${session.etapes.length}`);
    lignes.push(`**Durée** : ${resume.dureeMs} ms`);
    lignes.push('\n## Timeline\n');

    for (const racine of timeline) {
      this.renderNoeud(racine, lignes, 0);
    }

    const recommandations = this.genererRecommandations(session);

    return {
      session: resume,
      timeline,
      resume: lignes.join('\n'),
      recommandations,
      dateGeneration: Date.now(),
    };
  }

  /** Formate la timeline en texte pour l'affichage. */
  formaterTimeline(session: SessionPentest): string {
    const lignes: string[] = [];
    const timeline = this.construireTimeline(session);

    for (const racine of timeline) {
      this.renderNoeud(racine, lignes, 0);
    }

    return lignes.join('\n');
  }

  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  //  Helpers privés
  // ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

  private renderNoeud(noeud: NoeudTimeline, lignes: string[], profondeur: number): void {
    const indent = '  '.repeat(profondeur);
    const icone = this.iconeSeverite(noeud.etape.severite);
    const agent = noeud.agent ? `[${noeud.agent.nom}]` : '[system]';
    lignes.push(
      `${indent}${icone} ${agent} ${noeud.etape.description}`,
    );
    if (noeud.etape.explication) {
      lignes.push(`${indent}   → ${noeud.etape.explication}`);
    }
    for (const enfant of noeud.enfants) {
      this.renderNoeud(enfant, lignes, profondeur + 1);
    }
  }

  private iconeSeverite(severite: string): string {
    switch (severite) {
      case 'info': return 'ℹ️';
      case 'remarque': return '✓';
      case 'avertissement': return '⚠';
      case 'critique': return '✗';
      default: return '•';
    }
  }

  private genererRecommandations(session: SessionPentest): string[] {
    const recos: string[] = [];

    const nbCritique = session.etapes.filter((e) => e.severite === 'critique').length;
    if (nbCritique > 0) {
      recos.push(`${nbCritique} vulnérabilité(s) critique(s) détectée(s) : correction urgente requise.`);
    }

    const nbAvertissement = session.etapes.filter((e) => e.severite === 'avertissement').length;
    if (nbAvertissement > 0) {
      recos.push(`${nbAvertissement} avertissement(s) : planifier des correctifs.`);
    }

    if (session.antiTrace.nettoyageLogs) {
      recos.push('Nettoyage anti-forensic effectué en fin de session.');
    }

    if (recos.length === 0) {
      recos.push('Aucune vulnérabilité critique détectée. Audit de conformité recommandé.');
    }

    return recos;
  }
}

/** Crée une instance du visualiseur. */
export function creerVisualiseur(): VisualiseurAttaques {
  return new VisualiseurAttaques();
}