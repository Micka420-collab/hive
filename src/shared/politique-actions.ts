// La politique d'actions compilée (G12) — qui a le droit de faire quoi, dit
// AVANT que l'agent ne le tente.
//
// ─── LE TROU QUE CE MODULE FERME ─────────────────────────────────────────────
//
// `claude -p` sous `acceptEdits` écrit des fichiers mais refuse chaque commande
// Bash non autorisée : le Worker rendait son diff SANS avoir lancé le
// `npm test` que le dépôt déclare. Et à l'autre bout du spectre, rien ne
// gardait les actions irréversibles — un `git push`, une publication, un `rm`
// hors du répertoire de travail ne passaient par AUCUNE décision.
//
// Deux réponses, dans ce module et ses consommateurs :
//
//   · un `permissions.allow` COMPILÉ depuis les déclarations du dépôt de BASE
//     (`reglesAutorisationDepot`, shared/validations-bac.ts) — le dépôt décide,
//     jamais Hive, et jamais l'arbre que l'agent a pu réécrire ;
//   · une CLASSE D'IRRÉVERSIBILITÉ par action proposée (taxonomie à la
//     magentic-ui : toujours / parfois / jamais), croisée avec le niveau
//     d'autonomie EXISTANT du projet pour rendre une décision : autoriser,
//     ouvrir une réquisition dans la Chambre, ou refuser.
//
// MODULE PUR : aucune I/O. Le pont MCP (`delegation-bridge.ts`) transporte la
// question, le nœud (`client.ts`) décide avec ce module, la Chambre tranche.

// ─── Les niveaux d'autonomie — le vocabulaire PARTAGÉ de la ruche ────────────
//
// Déplacés ici depuis `orchestrator/essaim.ts` (qui les ré-exporte) : le
// protocole, le nœud et cette politique les lisent tous, et un module pur sans
// import est le seul endroit qu'aucune frontière ne discute.
//
// - `off`      : la ruche attend qu'on lui dise quoi faire. Défaut.
// - `propose`  : elle décide seule quoi faire et crée les tâches. Elle ne
//                livre rien.
// - `gouverne` : elle décide, produit, se critique et OUVRE les pull requests.
//                Rien n'est fusionné.
// - `plein`    : tout ce qui précède, et elle fusionne — uniquement sur les
//                dépôts inscrits, et seulement quand la contre-visite conclut
//                « appliquer ».
//
// Le saut qui compte est `gouverne` → `plein`, et il est le seul qui demande
// une inscription explicite par dépôt.
export const NIVEAUX = ['off', 'propose', 'gouverne', 'plein'] as const;
export type NiveauAutonomie = (typeof NIVEAUX)[number];

/** Rang d'un niveau, pour comparer sans dépendre de l'ordre du tableau. */
export function rangNiveau(n: NiveauAutonomie): number {
  return NIVEAUX.indexOf(n);
}

export function estNiveauAutonomie(brut: unknown): brut is NiveauAutonomie {
  return typeof brut === 'string' && (NIVEAUX as readonly string[]).includes(brut);
}

// ─── Les classes d'irréversibilité ───────────────────────────────────────────

/**
 * `toujours` : réversible et locale, rien à demander. `parfois` : hors de la
 * liste d'autorisation compilée, mais rattrapable (le clone est jetable).
 * `jamais` : l'effet SORT du clone — push, publication, destruction hors du
 * répertoire, réseau vers un hôte que rien ne déclare — et aucune autonomie
 * ne l'auto-accorde : c'est une décision humaine, même au niveau `plein`.
 */
export const CLASSES_ACTION = ['toujours', 'parfois', 'jamais'] as const;
export type ClasseAction = (typeof CLASSES_ACTION)[number];

/** Ce que le CLI propose (relayé par `--permission-prompt-tool` via le pont). */
export interface ActionProposee {
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * La réponse que Claude Code attend de son outil de décision — le JSON du
 * `content[0].text` (code.claude.com/docs/en/headless, `--permission-prompt-tool`).
 * `updatedInput` est EXIGÉ sur `allow` : l'omettre vaut « exécute sans
 * arguments » chez certains outils, pas « exécute tel quel ».
 */
export type DecisionAction =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

/** Ce que le nœud fait d'une action proposée, le niveau d'autonomie entendu. */
export type SuiteAction = 'autoriser' | 'requisition' | 'refuser';

export const ACTION_LIBELLE_MAX = 200;

/** Les outils qui LISENT sans rien changer : toujours accordés. */
const OUTILS_LECTURE = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'TodoRead']);

/**
 * Les commandes dont l'effet traverse le réseau. L'allow-list compilée couvre
 * déjà les flux que le dépôt déclare (`npm ci`, `npm run test`…) — une
 * commande réseau qui arrive JUSQU'ICI vise donc un hôte que rien ne déclare.
 */
const COMMANDES_RESEAU = new Set(['curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'ncat', 'telnet']);

const COMMANDES_PUBLICATION = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** Le premier mot « commande » d'un segment shell, env-assignements sautés. */
function motsDeCommande(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter((mot) => mot !== '' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(mot));
}

/**
 * Un chemin cité par `rm` sort-il du répertoire de travail ? Jugé sur la FORME
 * (module pur, pas de système de fichiers) : absolu hors de `cwd`, remontée
 * `..`, ou `~` — tout le reste est relatif au clone jetable.
 */
function rmHorsDuCwd(mots: readonly string[], cwd: string): boolean {
  const racine = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return mots.slice(1).some((mot) => {
    if (mot.startsWith('-')) return false;
    if (mot.startsWith('~')) return true;
    if (mot.split(/[\\/]/).includes('..')) return true;
    if (mot.startsWith('/') || /^[A-Za-z]:[\\/]/.test(mot)) {
      return !(mot === cwd || mot.startsWith(racine));
    }
    return false;
  });
}

export interface ClassementAction {
  classe: ClasseAction;
  /** Libellé borné pour la réquisition / le journal — jamais la commande entière. */
  libelle: string;
}

const borne = (texte: string): string =>
  texte.replace(/\s+/g, ' ').trim().slice(0, ACTION_LIBELLE_MAX);

/**
 * Classe une action proposée. La taxonomie est FERMÉE et assumée simple : les
 * quatre classes irréversibles de la carte (push, publication, rm hors cwd,
 * hôte inconnu), tout le reste des Bash en `parfois`, les lectures en
 * `toujours`. Un faux `parfois` coûte une décision de trop ; un faux
 * `toujours` ouvrirait une action irréversible sans décision — le tri penche
 * donc toujours vers la classe la plus stricte.
 */
export function classerActionProposee(action: ActionProposee, cwd: string): ClassementAction {
  if (OUTILS_LECTURE.has(action.toolName)) {
    return { classe: 'toujours', libelle: borne(`Lecture (${action.toolName})`) };
  }
  if (action.toolName !== 'Bash') {
    return { classe: 'parfois', libelle: borne(`Outil ${action.toolName}`) };
  }
  const commande = typeof action.input.command === 'string' ? action.input.command : '';
  // Chaque segment d'un enchaînement est classé : `cd x && git push` pousse.
  const segments = commande.split(/&&|\|\||;|\||\n/);
  let libelleParfois = borne(`Commande « ${commande} »`) || 'Commande shell';
  for (const segment of segments) {
    const mots = motsDeCommande(segment);
    const [tete, second] = mots;
    if (!tete) continue;
    if (tete === 'git' && mots.includes('push')) {
      return { classe: 'jamais', libelle: borne(`git push (« ${commande} »)`) };
    }
    if (COMMANDES_PUBLICATION.has(tete) && second === 'publish') {
      return { classe: 'jamais', libelle: borne(`Publication ${tete} publish (« ${commande} »)`) };
    }
    if (COMMANDES_RESEAU.has(tete)) {
      return {
        classe: 'jamais',
        libelle: borne(`Réseau vers un hôte non déclaré : ${tete} (« ${commande} »)`),
      };
    }
    if (tete === 'rm' && rmHorsDuCwd(mots, cwd)) {
      return {
        classe: 'jamais',
        libelle: borne(`rm hors du répertoire de travail (« ${commande} »)`),
      };
    }
    libelleParfois = borne(`Commande « ${commande} »`);
  }
  return { classe: 'parfois', libelle: libelleParfois };
}

/**
 * La décision PAR DÉFAUT, croisée classe × niveau d'autonomie existant — aucun
 * niveau n'est inventé, et `jamais` reste gardé MÊME en `plein` (le saut
 * gouverne → plein autorise la fusion sur dépôt inscrit, pas un push libre
 * depuis n'importe quel Worker).
 *
 *   · `toujours` → autorisée à tout niveau ;
 *   · `parfois`  → `off`/`propose` : réquisition (un humain tient la barre) ;
 *                  `gouverne`/`plein` : autorisée — le clone est jetable, et
 *                  la contre-expertise relit le diff ;
 *   · `jamais`   → réquisition à tout niveau — sauf `off`, où la ruche est
 *                  inerte : refus direct, dit et journalisé.
 */
export function decisionActionParNiveau(
  classe: ClasseAction,
  niveau: NiveauAutonomie,
): SuiteAction {
  if (classe === 'toujours') return 'autoriser';
  if (classe === 'jamais') return niveau === 'off' ? 'refuser' : 'requisition';
  return rangNiveau(niveau) >= rangNiveau('gouverne') ? 'autoriser' : 'requisition';
}
