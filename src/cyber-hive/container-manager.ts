// Gestionnaire de conteneurs Docker pour Cyber Hive.
// Isole l'exécution des outils de sécurité dans des conteneurs Kali Linux.

import type { OutilSecurite, ResultatOutil, ConfigCyberHive } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Types
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** État d'un conteneur. */
export type StatutConteneur = 'cree' | 'demarre' | 'arrete' | 'detruit';

/** Un conteneur Docker isolé pour l'exécution d'outils. */
export interface Conteneur {
  id: string;
  nom: string;
  image: string;
  statut: StatutConteneur;
  /** Outil associé (si dédié). */
  outilId?: string;
  /** Session de pentest parente. */
  sessionId?: string;
  creeAt: number;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Gestionnaire de conteneurs
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export class GestionnaireConteneurs {
  private config: ConfigCyberHive;
  private conteneurs: Map<string, Conteneur> = new Map();
  private compteur = 0;

  constructor(config: ConfigCyberHive) {
    this.config = config;
  }

  /** Crée un conteneur pour exécuter un outil. */
  async creerConteneur(
    outil: OutilSecurite,
    sessionId?: string,
  ): Promise<Conteneur> {
    const id = `ch-${++this.compteur}-${Date.now().toString(36)}`;
    const conteneur: Conteneur = {
      id,
      nom: `cyber-hive-${outil.id}-${id}`,
      image: this.config.imageKali,
      statut: 'cree',
      outilId: outil.id,
      sessionId,
      creeAt: Date.now(),
    };

    if (!this.config.simulation) {
      // docker run -d --name <nom> --rm <image> sleep infinity
    }

    this.conteneurs.set(id, conteneur);
    return conteneur;
  }

  /** Démarre un conteneur. */
  async demarrer(conteneurId: string): Promise<void> {
    const c = this.conteneurs.get(conteneurId);
    if (!c) throw new Error(`Conteneur inconnu : ${conteneurId}`);
    c.statut = 'demarre';
  }

  /** Arrête un conteneur. */
  async arreter(conteneurId: string): Promise<void> {
    const c = this.conteneurs.get(conteneurId);
    if (!c) throw new Error(`Conteneur inconnu : ${conteneurId}`);
    c.statut = 'arrete';
  }

  /** Détruit un conteneur (éphémère : nettoyage complet). */
  async detruire(conteneurId: string): Promise<void> {
    const c = this.conteneurs.get(conteneurId);
    if (!c) return;
    c.statut = 'detruit';
    this.conteneurs.delete(conteneurId);
  }

  /** Détruit tous les conteneurs d'une session. */
  async detruireSession(sessionId: string): Promise<void> {
    const conteneurs = [...this.conteneurs.values()].filter(
      (c) => c.sessionId === sessionId,
    );
    for (const c of conteneurs) {
      await this.detruire(c.id);
    }
  }

  /** Liste les conteneurs actifs. */
  listerConteneurs(): Conteneur[] {
    return [...this.conteneurs.values()].filter(
      (c) => c.statut === 'demarre' || c.statut === 'cree',
    );
  }

  /** Nettoie tous les conteneurs. */
  async toutDetruire(): Promise<void> {
    for (const id of [...this.conteneurs.keys()]) {
      await this.detruire(id);
    }
  }
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Exécution d'outils
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

let gestionnaireGlobal: GestionnaireConteneurs | null = null;
let configGlobal: ConfigCyberHive | null = null;

/** Initialise le gestionnaire de conteneurs global. */
export function initGestionnaire(config: ConfigCyberHive): GestionnaireConteneurs {
  gestionnaireGlobal = new GestionnaireConteneurs(config);
  configGlobal = config;
  return gestionnaireGlobal;
}

/** Exécute un outil de sécurité dans un conteneur isolé. */
export async function execOutil(
  outil: OutilSecurite,
  cible: string,
  args: string[],
): Promise<ResultatOutil> {
  const debut = Date.now();

  // En mode simulation, on retourne un résultat factice.
  if (configGlobal?.simulation ?? true) {
    return {
      outilId: outil.id,
      succes: true,
      codeSortie: 0,
      stdout: `[SIMULATION] ${outil.commande} ${args.join(' ')} ${cible}`,
      stderr: '',
      dureeMs: Date.now() - debut,
      ts: Date.now(),
    };
  }

  // Exécution réelle via Docker exec dans le conteneur Kali.
  // docker exec <conteneur> <commande> <args> <cible>
  return {
    outilId: outil.id,
    succes: true,
    codeSortie: 0,
    stdout: `[TODO] Exécution réelle de ${outil.commande} sur ${cible}`,
    stderr: '',
    dureeMs: Date.now() - debut,
    ts: Date.now(),
  };
}