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
//
// ─── CE QUE CE MODULE N'EST PAS : UNE ENCEINTE ───────────────────────────────
//
// La classification juge la FORME d'une commande pour décider QUI tranche —
// elle rend visibles les gestes irréversibles et arrête les maladroits. Elle
// ne contient pas un agent hostile : le `npm test` que l'allow-list accorde
// exécute des tests que l'agent a lui-même écrits, et un test peut pousser.
// L'enceinte est structurelle : un clone SANS identifiants de push (suite
// nommée de G12) et un réseau sortant filtré par tâche (G03). Toute règle
// ajoutée ici doit garder ce rôle — décider qui tranche, pas promettre
// l'impossible.

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
 * `toujours` : une LECTURE, jugeable sur la forme, rien à demander.
 * `parfois` : hors de la liste d'autorisation compilée, mais rattrapable (le
 * clone est jetable). `jamais` : l'effet SORT du clone — push, publication,
 * destruction hors du répertoire, réseau que rien ne déclare — OU l'effet est
 * INJUGEABLE sur la forme (interpréteur, indirection, substitution) : « code
 * arbitraire » peut viser n'importe lequel des effets d'avant. Le clone, lui,
 * n'embarque plus d'identifiants de push (`depotDistant`, git-protege.ts) :
 * c'est l'enceinte structurelle, que cette classification ne remplace pas.
 * Aucune autonomie n'auto-accorde un `jamais` : c'est une décision humaine,
 * même au niveau `plein`.
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
 * Les outils du CLI dont l'effet traverse le réseau sans commande shell :
 * la même classe que `curl` vers un hôte inconnu — rien ne déclare l'hôte
 * qu'ils visent, et les laisser « parfois » ouvrirait par WebFetch ce que la
 * classe réseau ferme à curl.
 */
const OUTILS_RESEAU = new Set(['WebFetch', 'WebSearch']);

/**
 * Les commandes dont l'effet traverse le réseau. L'allow-list compilée couvre
 * déjà les flux que le dépôt déclare (`npm ci`, `npm run test`…) — une
 * commande réseau qui arrive JUSQU'ICI vise donc un hôte que rien ne déclare.
 */
const COMMANDES_RESEAU = new Set(['curl', 'wget', 'ssh', 'scp', 'rsync', 'nc', 'ncat', 'telnet']);

const COMMANDES_PUBLICATION = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/**
 * Les têtes de segment dont l'effet réel est INJUGEABLE sur la forme : un
 * interpréteur (`sh -c "git push"`, `node -e 'fetch(…)'`), un relais
 * (`env git push`, `xargs`, `timeout`, `sudo`), un exécuteur de scripts de
 * l'ARBRE DE TRAVAIL que l'agent réécrit (`npm run`, `npx`, `make`). Classer
 * ces formes « parfois » ouvrirait l'auto-allow de gouverne/plein à n'importe
 * quelle action par simple indirection — le tri penche vers la classe la plus
 * stricte (`jamais`). La seule porte reste l'allow-list COMPILÉE depuis la
 * base, que le CLI applique AVANT d'appeler l'outil de décision : une commande
 * qui arrive ici est déjà hors liste. Assumé : `sed`/`awk` restent « parfois »
 * (leurs formes exécutantes sont niches, et les bannir casserait les
 * pipelines de lecture) — le chantier racine, le retrait des identifiants du
 * remote du clone, est fait (`cloneRepo`, workspace.ts) : un push qui
 * passerait par elles ne trouve plus le jeton du projet dans le clone.
 */
const COMMANDES_INDIRECTION = new Set([
  ...['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'],
  ...['env', 'xargs', 'command', 'eval', 'exec', 'source', '.'],
  ...['nohup', 'setsid', 'timeout', 'time', 'nice', 'ionice', 'stdbuf', 'script'],
  ...['su', 'sudo', 'doas'],
  ...['node', 'nodejs', 'deno', 'bun', 'npx', 'pnpx', 'npm', 'pnpm', 'yarn'],
  ...['python', 'python2', 'python3', 'perl', 'ruby', 'php', 'make'],
]);

/**
 * `$(…)`, backtick, substitution de processus, expansion `${…}` : du code qui
 * s'exécute À L'INTÉRIEUR d'un mot (`git commit -m "$(git push)"`,
 * `git${IFS}push`). Faux positifs assumés (un backtick cité en message de
 * commit coûte une décision de trop, jamais une action de trop).
 */
const SUBSTITUTION_SHELL = /\$\(|`|<\(|>\(|\$\{/;

const LECTURES_GIT = new Set(['status', 'log', 'diff', 'show']);
const COMMANDES_LECTURE = new Set([
  ...['ls', 'cat', 'pwd', 'head', 'tail', 'wc'],
  ...['grep', 'rg', 'which'],
]);

/**
 * Les mots « commande » d'un segment shell, env-assignements sautés et quotes/
 * échappements retirés : `git "pu"sh` et `git \push` poussent autant que
 * `git push`, et le classement ne doit pas se laisser citer hors de la classe.
 */
function motsDeCommande(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter((mot) => mot !== '' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(mot))
    .map((mot) => mot.replace(/["'\\]/g, ''))
    .filter((mot) => mot !== '');
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
 * Un segment est-il une LECTURE jugeable sur la forme ? Liste FERMÉE (revue
 * G12) : `git status/log/diff/show`, les lectures simples, la sonde
 * `<cmd> --version`. Toute redirection `>` écrit ; `$` rend la cible
 * injugeable ; `--output`/`--pre` sont les options d'écriture/exécution des
 * lecteurs eux-mêmes (`git log --output=…`, `rg --pre …`). Assumé : `cat`
 * peut lire hors du clone — sans réseau, la fuite reste dans le journal de
 * la tâche, et refuser la lecture casserait le chemin par défaut.
 */
function segmentLectureSeule(segment: string, mots: readonly string[]): boolean {
  if (segment.includes('>')) return false;
  if (mots.some((m) => m.includes('$') || m.startsWith('--output') || m.startsWith('--pre'))) {
    return false;
  }
  const [tete, second] = mots;
  if (!tete) return true;
  if (mots.length === 2 && second === '--version') return true;
  if (tete === 'git') return second !== undefined && LECTURES_GIT.has(second);
  return COMMANDES_LECTURE.has(tete);
}

/**
 * Classe une action proposée. La taxonomie est FERMÉE et assumée simple : les
 * irréversibles de la carte (push, publication, rm hors cwd, hôte inconnu) ET
 * les formes injugeables (interpréteur, indirection, substitution — un
 * `sh -c "git push"` pousse autant qu'un `git push`) en `jamais` ; la liste
 * fermée des lectures en `toujours` ; le reste des Bash en `parfois`. Un faux
 * `parfois`/`jamais` coûte une décision de trop ; un faux `toujours` ouvrirait
 * une action irréversible sans décision — le tri penche donc toujours vers la
 * classe la plus stricte.
 */
export function classerActionProposee(action: ActionProposee, cwd: string): ClassementAction {
  if (OUTILS_LECTURE.has(action.toolName)) {
    return { classe: 'toujours', libelle: borne(`Lecture (${action.toolName})`) };
  }
  if (OUTILS_RESEAU.has(action.toolName)) {
    return {
      classe: 'jamais',
      libelle: borne(`Réseau vers un hôte non déclaré : outil ${action.toolName}`),
    };
  }
  if (action.toolName !== 'Bash') {
    return { classe: 'parfois', libelle: borne(`Outil ${action.toolName}`) };
  }
  const commande = typeof action.input.command === 'string' ? action.input.command : '';
  if (commande.trim() === '') {
    // Pas de texte à juger : fermé, jamais « parfois » par défaut.
    return { classe: 'jamais', libelle: 'Commande shell illisible (vide)' };
  }
  if (SUBSTITUTION_SHELL.test(commande)) {
    return {
      classe: 'jamais',
      libelle: borne(`Substitution de commande — effet injugeable (« ${commande} »)`),
    };
  }
  // Chaque segment d'un enchaînement est classé : `cd x && git push` pousse.
  // La classe finale est la PIRE des segments.
  const segments = commande.split(/&&|\|\||;|\||&|\n/);
  let lectureSeule = true;
  for (const segment of segments) {
    // Une assignation CITÉE (`A="x y" sh -c …`) fausse le découpage par
    // espaces : la tête réelle devient invisible — injugeable, donc fermé.
    if (segment.split(/\s+/).some((brut) => /^[A-Za-z_][A-Za-z0-9_]*=.*["']/.test(brut))) {
      return {
        classe: 'jamais',
        libelle: borne(`Assignation citée — effet injugeable (« ${commande} »)`),
      };
    }
    const mots = motsDeCommande(segment);
    const [tete, second] = mots;
    if (!tete) continue;
    if (mots.includes('git') && mots.includes('push')) {
      return { classe: 'jamais', libelle: borne(`git push (« ${commande} »)`) };
    }
    if (COMMANDES_PUBLICATION.has(tete) && second === 'publish') {
      return { classe: 'jamais', libelle: borne(`Publication ${tete} publish (« ${commande} »)`) };
    }
    if (mots.some((mot) => COMMANDES_RESEAU.has(mot))) {
      return {
        classe: 'jamais',
        libelle: borne(`Réseau vers un hôte non déclaré (« ${commande} »)`),
      };
    }
    if (tete === 'rm' && rmHorsDuCwd(mots, cwd)) {
      return {
        classe: 'jamais',
        libelle: borne(`rm hors du répertoire de travail (« ${commande} »)`),
      };
    }
    if (tete.startsWith('$')) {
      return {
        classe: 'jamais',
        libelle: borne(`Commande portée par une variable — effet injugeable (« ${commande} »)`),
      };
    }
    // Un chemin exécuté (`./pousse.sh`, `node_modules/.bin/…`, `/usr/bin/git`)
    // lance du code que l'agent a pu écrire, et masque la tête aux règles
    // nommées (`/usr/bin/git push` n'est pas `git push` pour `mots.includes`).
    if (tete.includes('/')) {
      return {
        classe: 'jamais',
        libelle: borne(`Exécutable par chemin (${tete}) — effet injugeable (« ${commande} »)`),
      };
    }
    // Seule exception d'un interpréteur : la sonde `<cmd> --version`, deux
    // mots exactement — elle n'exécute rien de l'arbre.
    const sondeVersion = mots.length === 2 && second === '--version';
    if (!sondeVersion && COMMANDES_INDIRECTION.has(tete)) {
      return {
        classe: 'jamais',
        libelle: borne(`Indirection (${tete}) — effet injugeable (« ${commande} »)`),
      };
    }
    if (tete === 'git' && mots.some((mot) => mot.includes('$'))) {
      return {
        classe: 'jamais',
        libelle: borne(`git à arguments variables — effet injugeable (« ${commande} »)`),
      };
    }
    if (tete === 'find' && mots.some((m) => /^-(exec|execdir|ok|okdir|delete)$/.test(m))) {
      return {
        classe: 'jamais',
        libelle: borne(`find exécutant/destructeur — effet injugeable (« ${commande} »)`),
      };
    }
    // `rg --pre <cmd>` exécute <cmd> sur chaque fichier : un lecteur devenu
    // interpréteur — la même classe que lui.
    if ((tete === 'rg' || tete === 'grep') && mots.some((m) => m.startsWith('--pre'))) {
      return {
        classe: 'jamais',
        libelle: borne(`${tete} --pre — effet injugeable (« ${commande} »)`),
      };
    }
    if (!segmentLectureSeule(segment, mots)) lectureSeule = false;
  }
  if (lectureSeule) {
    return { classe: 'toujours', libelle: borne(`Lecture seule (« ${commande} »)`) };
  }
  return { classe: 'parfois', libelle: borne(`Commande « ${commande} »`) };
}

/**
 * La décision PAR DÉFAUT, croisée classe × niveau d'autonomie existant — aucun
 * niveau n'est inventé, et `jamais` reste gardé MÊME en `plein` (le saut
 * gouverne → plein autorise la fusion sur dépôt inscrit, pas un push libre
 * depuis n'importe quel Worker).
 *
 *   · `toujours` → autorisée à tout niveau ;
 *   · `parfois`  → `gouverne`/`plein` : autorisée — le clone est jetable, et
 *                  la contre-expertise relit le diff ;
 *                  `off`/`propose` : REFUS immédiat, dit et journalisé — une
 *                  réquisition suspendante de dix minutes par `mkdir` rendrait
 *                  le niveau PAR DÉFAUT insupportable ; le refus nomme la
 *                  Chambre et le niveau, l'agent continue autrement ;
 *   · `jamais`   → réquisition à tout niveau — sauf `off`, où la ruche est
 *                  inerte : refus direct, dit et journalisé.
 */
export function decisionActionParNiveau(
  classe: ClasseAction,
  niveau: NiveauAutonomie,
): SuiteAction {
  if (classe === 'toujours') return 'autoriser';
  if (classe === 'jamais') return niveau === 'off' ? 'refuser' : 'requisition';
  return rangNiveau(niveau) >= rangNiveau('gouverne') ? 'autoriser' : 'refuser';
}
