// Le catalogue des outils IA que la ruche sait accueillir.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Ajouter un outil demandait de toucher SIX endroits — l'adaptateur, la branche
// du `switch`, la table de sonde, l'union des types, les variables
// d'identifiants, le nom lisible — dont une seule paire était gardée. Les
// autres pouvaient diverger en silence, et c'est ce qui rendait coûteux ce qui
// devrait être trivial : accueillir un outil de plus.
//
// Ce module ne remplace encore aucun des six. Il DÉCLARE, en un endroit, ce que
// chacun est ; les six deviendront ses vues, un par un, chaque migration gardée
// par un banc. Commencer par tout réécrire aurait cassé six choses qui marchent
// pour un gain qu'on ne saurait pas mesurer.
//
// ─── LA RÈGLE QUI GOUVERNE CE FICHIER ────────────────────────────────────────
//
// **Une capacité déclarée ici est une capacité CONSTATÉE dans le code de
// l'adaptateur, jamais une capacité du produit.**
//
// La nuance décide de tout. « Cursor sait lire des fichiers » est vrai du
// produit et ne dit RIEN de ce que la ruche peut lui demander. Ce qui compte
// pour la Reine, c'est ce que l'adaptateur fait réellement passer — et cela se
// vérifie en lisant `src/adapters/`. `tests/catalogue-outils.test.ts` tient
// cette correspondance : déclarer `modeleChoisi: true` pour un adaptateur qui
// ne lit jamais `ctx.modele` fait rougir la suite.
//
// MODULE PUR — aucune I/O, aucune horloge.

/**
 * Ce qu'un outil sait faire, du point de vue de la ruche.
 *
 * Chaque champ répond à une question que la Reine se pose avant d'assigner.
 * Aucun n'est optionnel : un « peut-être » se lirait comme un « oui ».
 */
export interface Capacites {
  /** Peut recevoir une tâche et la mener sans interface humaine. */
  readonly executionTache: boolean;
  /** Produit du code réel — `false` pour un adaptateur simulé. */
  readonly productionReelle: boolean;
  /** Remonte des sous-agents pendant qu'il travaille. */
  readonly sousAgents: boolean;
  /** Remonte les fichiers qu'il a ouverts (présences du Rayon). */
  readonly presences: boolean;
  /** Honore l'annulation coopérative (`AbortSignal`). */
  readonly annulation: boolean;
  /** Accepte le modèle choisi par l'Aiguillage (`--model`). */
  readonly modeleChoisi: boolean;
}

/**
 * Le niveau d'intégration — l'échelle demandée pour que la ruche reste HONNÊTE
 * sur ce qu'elle sait faire de chaque outil.
 *
 * Elle est ORDONNÉE et cumulative : un niveau 3 tient tout ce que tient un
 * niveau 2. Afficher un outil sans son niveau, c'est laisser croire que tous
 * se valent — et c'est le premier mensonge qu'un tableau de bord puisse faire.
 */
export const NIVEAUX = [
  'detecte', // 0 — on sait qu'il est là
  'configure', // 1 — on sait le configurer
  'connecte', // 2 — on connaît son état
  'execute', // 3 — il prend des tâches
  'contexte', // 4 — il reçoit du contexte choisi
  'orchestre', // 5 — la Reine le dirige de bout en bout
] as const;

export type Niveau = (typeof NIVEAUX)[number];

export function rangNiveau(n: Niveau): number {
  return NIVEAUX.indexOf(n);
}

export interface OutilIA {
  /** L'identifiant de protocole — la clé, jamais affichée telle quelle. */
  readonly id: string;
  /** Le nom lisible. Identique dans les deux langues pour une marque. */
  readonly nom: string;
  /**
   * Les binaires à sonder, par ordre de préférence. Vide : rien à détecter sur
   * le PATH (`shell` est interne, `custom` vient d'une variable).
   */
  readonly bins: readonly string[];
  /** Chaîne exigée dans `--version` pour lever une homonymie. */
  readonly signature?: string;
  /**
   * Le paquet npm qui l'installe, en ARGUMENTS SÉPARÉS — ou `null` quand la
   * ruche ne sait pas l'installer. `null` n'est pas un manque : c'est le refus
   * de deviner un nom de paquet, qui ferait installer n'importe quoi.
   */
  readonly installation: readonly string[] | null;
  readonly capacites: Capacites;
  readonly niveau: Niveau;
  /** Ce qui limite cet outil, dit à l'humain plutôt que caché. */
  readonly limite?: string;
}

/** Un outil qui exécute vraiment, avec toutes les capacités mesurées. */
function executant(over: Partial<Capacites> = {}): Capacites {
  return {
    executionTache: true,
    productionReelle: true,
    sousAgents: false,
    presences: false,
    // `runCommand` (adapters/exec.ts) transmet `signal: ctx.signal` à `spawn` :
    // tout adaptateur qui passe par lui honore l'annulation. Mesuré, pas supposé.
    annulation: true,
    modeleChoisi: false,
    ...over,
  };
}

/**
 * Le catalogue. Ordonné par niveau décroissant puis par nom — ordre TOTAL, pour
 * qu'un écran qui l'affiche ne se réordonne pas d'un rafraîchissement à l'autre.
 */
export const OUTILS: readonly OutilIA[] = Object.freeze([
  {
    id: 'claude-code',
    nom: 'Claude Code',
    bins: ['claude'],
    installation: Object.freeze(['npm', 'install', '-g', '@anthropic-ai/claude-code']),
    // Le seul adaptateur qui remonte de vrais sous-agents ET les fichiers
    // ouverts : les autres rendent `subAgents: []` en dur. Le choix de modèle,
    // lui, est aussi câblé sur Cursor, Codex et Grok.
    capacites: executant({ sousAgents: true, presences: true, modeleChoisi: true }),
    niveau: 'contexte',
  },
  {
    id: 'cursor',
    nom: 'Cursor',
    // `cursor-agent` : nom historique. `agent` : binaire actuel — d'où la
    // signature, sans quoi n'importe quel autre `agent` du PATH passerait.
    bins: ['cursor-agent', 'agent'],
    signature: 'cursor',
    // Cursor s'installe par un script officiel, pas par npm. Rien à déclarer
    // ici plutôt qu'un paquet inventé.
    installation: null,
    capacites: executant({ modeleChoisi: true }),
    niveau: 'execute',
  },
  {
    id: 'cline',
    nom: 'Cline',
    bins: ['cline'],
    // `null`, ET LE PAQUET EXISTE POURTANT.
    //
    // J'avais écrit `npm install -g cline`. Le registre confirme que ce paquet
    // existe, qu'il s'annonce « Autonomous coding agent CLI », et que son `bin`
    // est bien `cline`. J'ai donc vérifié — et vérifié la mauvaise chose.
    //
    // La règle du dépôt ne demande pas « ce paquet existe-t-il ? » mais « son
    // nom porte-t-il une PORTÉE npm ? ». `connexion-agent.test.ts` la tient
    // depuis longtemps : un nom sans portée (`cline`, pas `@qqch/cline`) est
    // exposé au typosquat du registre public, et un `npm install -g` est
    // exactement l'endroit où cette erreur ne se fait qu'une fois.
    //
    // `@cline/cli` est bien porté, lui — mais son binaire s'appelle `clite`,
    // que `bins` ne cherche pas : la ruche installerait quelque chose qu'elle
    // ne saurait pas détecter ensuite. Deux mauvaises réponses valent `null`.
    //
    // `null` ne veut donc pas dire « on ne peut pas l'installer » : il veut
    // dire « la ruche ne le fait pas à votre place ». Cline s'installe très
    // bien à la main, et la fiche le détectera dès qu'il sera sur le PATH.
    installation: null,
    capacites: executant(),
    niveau: 'execute',
  },
  {
    id: 'codex',
    nom: 'Codex',
    bins: ['codex'],
    installation: Object.freeze(['npm', 'install', '-g', '@openai/codex']),
    capacites: executant({ modeleChoisi: true }),
    niveau: 'execute',
  },
  {
    id: 'grok',
    nom: 'Grok Build',
    bins: ['grok'],
    installation: null,
    capacites: executant({ modeleChoisi: true }),
    niveau: 'execute',
  },
  {
    id: 'hermes-agent',
    nom: 'Hermes Agent',
    bins: ['hermes'],
    installation: null,
    capacites: executant(),
    niveau: 'execute',
    limite: 'Hors de l’union `AgentType` : atteignable par `HIVE_AGENT`, sans réquisition de clé.',
  },
  {
    id: 'windsurf',
    nom: 'Windsurf',
    bins: ['windsurf'],
    installation: null,
    // TOUT est à false, et c'est le cas le plus important du catalogue. Windsurf
    // n'expose aucun moyen documenté de recevoir une tâche de l'extérieur.
    // Déclarer autre chose serait promettre une orchestration qui échouerait à
    // la première tâche — et la ruche a pour règle de ne pas mentir sur ce
    // qu'elle sait faire.
    capacites: {
      executionTache: false,
      productionReelle: false,
      sousAgents: false,
      presences: false,
      annulation: false,
      modeleChoisi: false,
    },
    niveau: 'detecte',
    limite:
      'Aucune API publique de pilotage. Intégration possible en SENS INVERSE : ' +
      'Cascade sait appeler un serveur MCP (~/.codeium/mcp_config.json).',
  },
  {
    id: 'custom',
    nom: 'Commande personnalisée',
    bins: [],
    installation: null,
    capacites: executant(),
    niveau: 'execute',
    limite: 'Vient de `HIVE_AGENT_CMD` — la ruche ne sait rien de ce qu’elle lance.',
  },
  {
    id: 'shell',
    nom: 'Shell (simulé)',
    bins: [],
    installation: null,
    // Il exécute, mais ne produit RIEN de réel. Les deux champs séparés existent
    // pour ce cas précis : un `shell` en ligne remplit toutes les conditions
    // d'un voyant vert naïf, et ne code pas une ligne.
    capacites: executant({ productionReelle: false }),
    niveau: 'connecte',
    limite: 'Diffs SIMULÉS. Réservé à la démonstration.',
  },
]);

const PAR_ID = new Map(OUTILS.map((o) => [o.id, o]));

export function outil(id: string): OutilIA | undefined {
  return PAR_ID.get(id);
}

/** Les outils que la Reine peut réellement charger d'une tâche. */
export function outilsExecutants(): OutilIA[] {
  return OUTILS.filter((o) => o.capacites.executionTache);
}

/** Ce que la ruche sait installer elle-même. */
export function outilsInstallables(): OutilIA[] {
  return OUTILS.filter((o) => o.installation !== null);
}

export function direNiveau(n: Niveau, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<Niveau, string> = {
    detecte: 'détecté seulement',
    configure: 'configurable',
    connecte: 'connecté',
    execute: 'exécute des tâches',
    contexte: 'reçoit du contexte',
    orchestre: 'orchestré de bout en bout',
  };
  const en: Record<Niveau, string> = {
    detecte: 'detected only',
    configure: 'configurable',
    connecte: 'connected',
    execute: 'runs tasks',
    contexte: 'receives context',
    orchestre: 'fully orchestrated',
  };
  return (lang === 'en' ? en : fr)[n];
}
