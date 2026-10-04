// Ce que l'app appelle du code de Hive — et d'où elle le charge.
//
// ─── UN CONTRAT, PAS UNE COPIE ───────────────────────────────────────────────
//
// La coquille ne compile pas Hive : elle charge au démarrage les modules
// COMPILÉS de `RACINE_HIVE/dist` — `resources/hive/` dans l'app installée, la
// racine du dépôt en développement (ADR 0013 § 3). Elle n'en connaît que les
// signatures ci-dessous. Une signature qui divergerait du vrai module ne se
// verrait qu'à l'exécution, dans l'app — là où aucun banc ne passe. D'où
// `tests/bureau-contrat.test.ts` : la vérification de types du DÉPÔT assigne
// chaque vrai module à son contrat, et rougit au premier écart.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RecetteReglages } from './reglages.js';

/** Une pièce de la ruche (`Piece`, `src/shared/demarrage.ts`). */
export interface PieceHive {
  readonly nom: string;
  readonly bin: string;
  readonly argv: readonly string[];
  readonly role: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly ouvriere?: true;
  readonly reine?: 'annonce' | 'HIVE_URL' | 'HIVE_HTTP';
}

/** `SuiteDUneMort`. */
export type SuiteMortHive =
  | { readonly arreter: false; readonly message: string }
  | { readonly arreter: true; readonly code: number; readonly message: string };

/** `src/shared/demarrage.ts` — `Plan` est le `PlanOuvrieres` du module, opaque ici. */
export interface ModuleDemarrage<Plan> {
  readonly pieces: (
    noeud: string,
    voeu: { readonly hub?: boolean; readonly noeud?: boolean; readonly ecran?: boolean },
    port: number,
    plan: Plan | undefined,
    entrees: 'source' | 'compile',
  ) => PieceHive[];
  readonly planOuvrieres: (entree: {
    readonly argv: readonly string[];
    readonly env: NodeJS.ProcessEnv;
    readonly hote: string;
    readonly detecter: () => Promise<readonly string[]>;
  }) => Promise<Plan>;
}

/** `src/ruche-superviseur.ts`. */
export interface ModuleSuperviseur {
  readonly lancerRuche: (o: {
    readonly liste: readonly PieceHive[];
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly ligne: (l: {
      readonly piece: PieceHive | null;
      readonly flux: 'stdout' | 'stderr';
      readonly etiquette: string;
      readonly texte: string;
    }) => void;
    readonly adresse?: (a: { readonly http: string; readonly ws: string }) => void;
    readonly mort?: (piece: PieceHive, suite: SuiteMortHive) => void;
  }) => {
    readonly arreter: (code: number) => void;
    readonly fini: Promise<number>;
  };
}

/** `src/node-client/agent-detect.ts`. */
export interface ModuleAgents {
  readonly inventaireAgents: (env: NodeJS.ProcessEnv) => Promise<{
    readonly tous: readonly string[];
    readonly nonConnectes: readonly { readonly agent: string; readonly detail: string }[];
  }>;
}

/** `src/shared/agent-libelle.ts`. */
export interface ModuleLibelles {
  readonly libelleAgent: (agentType: string, anglais?: boolean) => string;
}

/** `src/ecriture-atomique.ts`. */
export interface ModuleEcriture {
  readonly ecrireAtomique: (chemin: string, contenu: string, mode?: number) => void;
  readonly MODE_SECRET: number;
}

/** Un plan d'ouvrières, que l'app transmet sans le lire. */
export type PlanOpaque = { readonly __plan: unique symbol };

export interface Hive {
  readonly racine: string;
  readonly demarrage: ModuleDemarrage<PlanOpaque>;
  readonly superviseur: ModuleSuperviseur;
  readonly agents: ModuleAgents;
  readonly libelles: ModuleLibelles;
  readonly installeur: RecetteReglages;
  readonly ecriture: ModuleEcriture;
  /** Les fichiers que l'app lance en mode Node. */
  readonly fichiers: { readonly cli: string };
}

/** Les modules, relatifs à la racine — la table que le banc du contrat relit. */
export const MODULES_HIVE = {
  demarrage: 'dist/shared/demarrage.js',
  superviseur: 'dist/ruche-superviseur.js',
  agents: 'dist/node-client/agent-detect.js',
  libelles: 'dist/shared/agent-libelle.js',
  installeur: 'dist/installer.js',
  ecriture: 'dist/ecriture-atomique.js',
} as const;

export async function chargerHive(racine: string): Promise<Hive> {
  const charger = async <T>(rel: string): Promise<T> =>
    (await import(pathToFileURL(path.join(racine, rel)).href)) as T;
  const [demarrage, superviseur, agents, libelles, installeur, ecriture] = await Promise.all([
    charger<ModuleDemarrage<PlanOpaque>>(MODULES_HIVE.demarrage),
    charger<ModuleSuperviseur>(MODULES_HIVE.superviseur),
    charger<ModuleAgents>(MODULES_HIVE.agents),
    charger<ModuleLibelles>(MODULES_HIVE.libelles),
    charger<RecetteReglages>(MODULES_HIVE.installeur),
    charger<ModuleEcriture>(MODULES_HIVE.ecriture),
  ]);
  return {
    racine,
    demarrage,
    superviseur,
    agents,
    libelles,
    installeur,
    ecriture,
    fichiers: { cli: path.join(racine, 'dist', 'cli.js') },
  };
}
