// L'état de l'app, en un seul endroit : la barre système, l'accueil, la
// fenêtre et le diagnostic le LISENT ; seuls le superviseur et les choix de
// l'accueil l'écrivent. Un fait par champ, posé là où il naît.

import type { SourceReprise } from './reprise.js';

export type EtatReine = 'demarrage' | 'en-ligne' | 'relance' | 'arretee' | 'externe';

export interface AgentVu {
  readonly agent: string;
  readonly libelle: string;
  /** `null` : connecté ; sinon ce que son CLI demande (`inventaireAgents`). */
  readonly nonConnecte: string | null;
}

export interface Etat {
  readonly reine: EtatReine;
  /** `http://127.0.0.1:<port>` une fois la Reine annoncée (ou la ruche externe ouverte). */
  readonly origine: string | null;
  readonly jeton: string | null;
  readonly ouvrieres: number;
  readonly agents: readonly AgentVu[] | null;
  /** Le port a changé depuis le dernier lancement : l'écran perd sa mémoire, on le dit. */
  readonly portChange: number | null;
  /** Une ruche installée par git attend une décision (premier lancement). */
  readonly reprise: (SourceReprise & { readonly repond: boolean }) | null;
  /** Un import est en cours. */
  readonly importEnCours: boolean;
  /** L'écran d'erreur : pourquoi, et les dernières lignes de la Reine. */
  readonly erreur: { readonly titre: string; readonly lignes: readonly string[] } | null;
  readonly session: boolean;
  readonly cspViolations: readonly string[];
}

const INITIAL: Etat = {
  reine: 'demarrage',
  origine: null,
  jeton: null,
  ouvrieres: 0,
  agents: null,
  portChange: null,
  reprise: null,
  importEnCours: false,
  erreur: null,
  session: false,
  cspViolations: [],
};

type Ecouteur = (e: Etat) => void;

let courant: Etat = INITIAL;
const ecouteurs = new Set<Ecouteur>();

export function etat(): Etat {
  return courant;
}

export function majEtat(partiel: Partial<Etat>): void {
  courant = { ...courant, ...partiel };
  for (const f of ecouteurs) f(courant);
}

export function surEtat(f: Ecouteur): () => void {
  ecouteurs.add(f);
  return () => ecouteurs.delete(f);
}

/** Ce que l'accueil a le droit de voir : tout, sauf le jeton. */
export function etatPourAccueil(e: Etat): Omit<Etat, 'jeton' | 'reprise'> & {
  readonly reprise: { dossier: string; port: number; repond: boolean } | null;
} {
  const { jeton: _jeton, reprise, ...reste } = e;
  return {
    ...reste,
    reprise: reprise
      ? { dossier: reprise.dossier, port: reprise.port, repond: reprise.repond }
      : null,
  };
}
