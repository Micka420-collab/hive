// L'isolement durci — faire tourner l'agent d'un inconnu sans lui donner la
// machine.
//
// ─── LA LIMITE QUE CE MODULE EXISTE POUR LEVER ───────────────────────────────
//
// La sandbox v0 (`workspace.ts`) donne un cwd dédié et un environnement épuré.
// C'est utile et c'est insuffisant, et le site le dit noir sur blanc : « un
// processus réel peut lire le disque et joindre le réseau ; n'utilisez Hive
// qu'entre membres de confiance ». Tant que cette phrase est vraie, un
// lancement public n'est pas défendable — pas parce que la fonctionnalité
// manque, mais parce qu'on demanderait à des inconnus d'exécuter le code
// d'autres inconnus sur leur machine personnelle.
//
// ─── CE QUE L'ISOLEMENT PROTÈGE, ET CE QU'IL NE PROTÈGE PAS ──────────────────
//
// IL PROTÈGE LE DISQUE ET LE RESTE DU SYSTÈME. Seul le répertoire de la tâche
// est monté, en écriture. Ni le HOME du membre, ni ses clés SSH, ni sa base
// Hive, ni la socket du démon de conteneurs. La racine est en lecture seule,
// toutes les capacités sont abandonnées, l'élévation de privilège est bloquée,
// et le processus tourne sous un utilisateur non privilégié.
//
// IL NE FERME PAS LE RÉSEAU, et c'est structurel : un agent de codage doit
// joindre l'API de son modèle. Un `--network none` rendrait Hive inutilisable.
// Écrire « isolé » sans cette phrase serait un mensonge par omission — la
// donnée que le conteneur ne protège pas est justement celle qui sort.
//
// Conséquence à assumer et à afficher : l'isolement empêche un agent hostile
// de LIRE votre machine, il ne l'empêche pas d'ENVOYER ce qu'il a produit.
//
// ─── AUCUNE DÉPENDANCE EMBARQUÉE ─────────────────────────────────────────────
//
// Même doctrine que `tunnel.ts` : Hive n'installe aucun moteur de conteneurs.
// Il détecte ce qui est déjà là et s'en sert. Imposer Docker à quelqu'un qui
// prête sa machine à des amis serait une exigence disproportionnée, et
// l'embarquer serait pire — un `npm install` ne doit pas décider d'installer
// un démon privilégié.
//
// MODULE PUR pour tout ce qui se calcule (les arguments, les garanties, le
// niveau) ; les impuretés sont la SONDE, qui lance `--version`, et, pour
// bubblewrap seul, la LECTURE du PATH de l'hôte (`installationHote`), qui ne
// lance rien et qu'un banc remplace par `OptionsEnveloppe.hote`.

import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { envSonde } from './agent-detect.js';

/** Les trois positions de l'interrupteur. */
export const MODES = ['off', 'auto', 'exige'] as const;
export type ModeIsolement = (typeof MODES)[number];

/**
 * Ce que le nœud obtient réellement.
 *
 * `processus` est le nom honnête de la sandbox v0 : un cwd et un environnement
 * épurés, rien de plus. Il ne se présente PAS comme une isolation.
 */
export const NIVEAUX = ['aucun', 'processus', 'conteneur'] as const;
export type NiveauIsolement = (typeof NIVEAUX)[number];

/** Limites de ressources d'une tâche isolée. */
export const MEMOIRE_MAX = '2g';
export const PROCESSUS_MAX = 512;
export const CPU_MAX = '2';

/** Point de montage du répertoire de tâche À L'INTÉRIEUR du bac. */
export const MONTAGE = '/hive/tache';
/** HOME éphémère du CLI dans un conteneur ; jamais le chemin de l'hôte. */
export const HOME_CONTENEUR = '/tmp/hive-home';

/**
 * Les variables qui portent un CHEMIN DE L'HÔTE, et qu'aucun bac ne transmet.
 *
 * Le HOME du membre, ses dossiers de configuration Windows, et `GROK_HOME` (la
 * session de navigateur de Grok) désignent des répertoires que le bac ne monte
 * JAMAIS. Les transmettre ne donnerait pas la session à l'agent : ça lui
 * donnerait un chemin mort, où il tenterait d'écrire sur une racine en lecture
 * seule. Dans le bac, l'agent reçoit `HOME_CONTENEUR` — et ses identifiants
 * par leur NOM (`CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`…),
 * jamais par un dossier de session.
 */
export const VARIABLES_CHEMIN_HOTE: readonly string[] = [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'GROK_HOME',
];

/**
 * Image utilisée par les moteurs de conteneurs.
 *
 * Cette image de base ne contient pas les CLI d'agents. Le preflight doit
 * vérifier leur présence dans l'image choisie via HIVE_ISOLEMENT_IMAGE ;
 * seul le workspace est monté, jamais l'installation de l'agent sur l'hôte.
 */
export const IMAGE_DEFAUT = 'docker.io/library/node:20-slim';

/** Image réellement demandée par l'opérateur, sans valeur vide trompeuse. */
export function imageDepuisEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIVE_ISOLEMENT_IMAGE?.trim() || IMAGE_DEFAUT;
}

export interface Fournisseur {
  nom: string;
  bin: string;
  niveau: NiveauIsolement;
  /** Comment l'obtenir, dit en une ligne à un humain. */
  installation: string;
  /** Ce qu'il garantit réellement — jamais une promesse ronde. */
  garanties: string[];
}

/**
 * Les moteurs reconnus, du plus au moins souhaitable.
 *
 * Podman AVANT Docker, délibérément : il tourne sans démon privilégié et en
 * mode « rootless » par défaut. Docker exige un démon root, ce qui déplace le
 * risque plutôt que de le réduire — un conteneur Docker mal contraint donne la
 * machine entière.
 */
export const FOURNISSEURS: readonly Fournisseur[] = [
  {
    nom: 'podman',
    bin: 'podman',
    niveau: 'conteneur',
    installation: 'https://podman.io/docs/installation (sans démon, sans root)',
    garanties: [
      'seul le répertoire de la tâche est visible',
      'racine en lecture seule, capacités abandonnées',
      'sans démon privilégié : le conteneur tourne sous votre utilisateur',
      'mémoire, processus et CPU bornés',
    ],
  },
  {
    nom: 'docker',
    bin: 'docker',
    niveau: 'conteneur',
    installation: 'https://docs.docker.com/get-docker/',
    garanties: [
      'seul le répertoire de la tâche est visible',
      'racine en lecture seule, capacités abandonnées',
      'mémoire, processus et CPU bornés',
      '⚠ le démon Docker tourne en root : compromettre le démon, c’est la machine',
    ],
  },
  {
    nom: 'bubblewrap',
    bin: 'bwrap',
    niveau: 'conteneur',
    installation: 'apt install bubblewrap · dnf install bubblewrap (Linux uniquement)',
    garanties: [
      'seul le répertoire de la tâche est accessible en écriture',
      'sans démon, sans root, très léger',
      '⚠ ne borne NI la mémoire NI le CPU (pas de cgroups)',
    ],
  },
] as const;

export function fournisseurParNom(nom: string): Fournisseur | null {
  return FOURNISSEURS.find((f) => f.nom === nom || f.bin === nom) ?? null;
}

// ─── Ce que l'isolement dit de lui-même ──────────────────────────────────────

/** Ce que l'isolement protège et ce qu'il laisse passer, pour affichage. */
export interface Constat {
  niveau: NiveauIsolement;
  protege: string[];
  laissePasser: string[];
}

/**
 * L'état réel, énoncé sans arrondi.
 *
 * `laissePasser` n'est jamais vide, même au meilleur niveau. Une interface qui
 * afficherait « isolé ✓ » sans dire que le réseau reste ouvert ferait prendre
 * un risque à quelqu'un qui croit ne pas en prendre — et c'est exactement ce
 * qu'on reproche aux produits qui vendent de la sécurité.
 */
export function constat(niveau: NiveauIsolement, fournisseur: Fournisseur | null): Constat {
  if (niveau === 'conteneur' && fournisseur) {
    return {
      niveau,
      protege: fournisseur.garanties,
      laissePasser: [
        'le réseau — un agent de codage doit joindre l’API de son modèle',
        'ce que l’agent produit : il peut envoyer ailleurs ce qu’il a lu du dépôt',
      ],
    };
  }
  if (niveau === 'processus') {
    return {
      niveau,
      protege: [
        'un répertoire de travail dédié par tâche',
        'un environnement épuré (ni HOME, ni variables du membre)',
      ],
      laissePasser: [
        'LE DISQUE ENTIER — le processus tourne sous votre utilisateur',
        'le réseau',
        'vos clés SSH, votre base Hive, vos autres projets',
      ],
    };
  }
  return {
    niveau: 'aucun',
    protege: [],
    laissePasser: ['tout ce que votre utilisateur peut faire'],
  };
}

// ─── Construire la commande isolée ───────────────────────────────────────────

export interface OptionsEnveloppe {
  fournisseur: Fournisseur;
  /** Répertoire de tâche sur l'HÔTE. Monté seul, en écriture. */
  cwdHote: string;
  /**
   * Noms des variables d'environnement à transmettre.
   *
   * DES NOMS, JAMAIS DES VALEURS : `-e CLE=valeur` écrirait le secret dans la
   * ligne de commande, donc dans la table des processus, donc lisible par
   * `ps` pour tout utilisateur de la machine. `-e CLE` (nom seul) le fait
   * hériter de l'environnement de l'appelant sans jamais l'exposer.
   */
  variables: readonly string[];
  image?: string;
  /** Identifiant numérique sous lequel exécuter. Défaut : non privilégié. */
  uid?: number;
  /**
   * Bubblewrap seulement : où l'hôte cherche les commandes (voir
   * `installationHote`). Défaut : l'hôte réel. Un banc le fixe pour que les
   * arguments ne dépendent pas des agents installés sur sa machine.
   */
  hote?: ContexteHote;
}

/**
 * L'atelier créé par Hive appartient à l'utilisateur qui a lancé le nœud.
 * Reprendre systématiquement 1000 casse donc l'écriture dans le volume sur les
 * runners et les postes où cet utilisateur a un autre UID. On reprend son UID
 * quand il est non privilégié ; un nœud lancé en root reste explicitement
 * abaissé à 1000.
 */
function uidNonPrivilegie(): number {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return typeof uid === 'number' && uid > 0 ? uid : 1000;
}

export interface Enveloppe {
  bin: string;
  args: string[];
}

/**
 * Enveloppe une commande dans son bac à sable.
 *
 * Rend `{ bin, args }` prêts pour `spawn(bin, args, { shell: false })` — la
 * contrainte §5.1 du dépôt s'applique inchangée, et c'est précisément pour ça
 * qu'on rend un TABLEAU d'arguments plutôt qu'une chaîne : une chaîne
 * exigerait un shell pour être découpée, et rouvrirait l'injection qu'on
 * ferme par ailleurs.
 */
export function envelopper(
  bin: string,
  argsAgent: readonly string[],
  opts: OptionsEnveloppe,
): Enveloppe {
  const { fournisseur } = opts;
  if (fournisseur.bin === 'bwrap') return enveloppeBwrap(bin, argsAgent, opts);
  return enveloppeConteneur(bin, argsAgent, opts);
}

/** Podman et Docker partagent la même grammaire d'arguments. */
function enveloppeConteneur(
  bin: string,
  argsAgent: readonly string[],
  opts: OptionsEnveloppe,
): Enveloppe {
  // Docker Desktop parses bind sources as POSIX-like paths even when its
  // caller is Windows; a raw `C:\\…` source is otherwise split at the drive
  // colon and the agent preflight fails before the container starts.
  const volumeSource = /^[A-Za-z]:[\\/]/.test(opts.cwdHote)
    ? opts.cwdHote.replaceAll('\\', '/')
    : opts.cwdHote;
  const uid = opts.uid ?? uidNonPrivilegie();
  const args = [
    'run',
    '--rm',
    // Pas de TTY, pas d'entrée interactive : l'agent est piloté par argv.
    '--interactive=false',

    // ── Ce qui est visible ─────────────────────────────────────────────────
    // LE SEUL montage. Pas de $HOME, pas de ~/.ssh, pas de socket de démon.
    `--volume=${volumeSource}:${MONTAGE}:rw`,
    `--workdir=${MONTAGE}`,
    // Racine en lecture seule : un agent ne réécrit pas son propre système.
    '--read-only',
    // …mais /tmp doit exister et être inscriptible, sinon la moitié des
    // outils échouent. En tmpfs, donc en mémoire, donc effacé à l'arrêt.
    '--tmpfs=/tmp:rw,noexec,nosuid,size=512m',

    // ── Ce qui est interdit ────────────────────────────────────────────────
    '--cap-drop=ALL',
    // Bloque setuid : même en trouvant un binaire privilégié, pas d'élévation.
    '--security-opt=no-new-privileges',
    `--user=${uid}:${uid}`,

    // ── Ce qui est borné ───────────────────────────────────────────────────
    // Une bombe à fork n'emporte pas la machine du membre.
    `--pids-limit=${PROCESSUS_MAX}`,
    `--memory=${MEMOIRE_MAX}`,
    `--cpus=${CPU_MAX}`,
  ];

  // Le HOME de l'hôte peut contenir une session et un chemin Windows que
  // l'invité Linux ne peut ni lire ni interpréter. Le CLI reçoit un HOME
  // éphémère dans le tmpfs ; seules les clés explicitement autorisées traversent
  // la frontière. Les variables de configuration hôte ne sont jamais montées.
  args.push(`--env=HOME=${HOME_CONTENEUR}`);
  // Les secrets passent par leur NOM seul : jamais dans la ligne de commande.
  for (const nom of opts.variables) {
    if (!VARIABLES_CHEMIN_HOTE.includes(nom)) args.push(`--env=${nom}`);
  }

  args.push(opts.image ?? IMAGE_DEFAUT, bin, ...argsAgent);
  return { bin: opts.fournisseur.bin, args };
}

/**
 * Le système de l'hôte que bubblewrap monte en entier, en lecture seule. Une
 * installation qui vit dessous est déjà visible : la remonter serait du bruit.
 */
const SYSTEME_MONTE: readonly string[] = ['/usr', '/bin', '/lib', '/lib64'];

/**
 * Les fichiers de `/etc` sans lesquels un outil ordinaire casse dans le bac —
 * aucun ne porte de secret (`/etc/shadow` n'y est pas, et n'y sera jamais).
 *
 * Mesuré dans le bac, sur un hôte Ubuntu : sans `passwd` ni `group`, `whoami`
 * rend « No such id: 1000 » ; et `/usr/bin/awk` n'est qu'un lien vers
 * `/etc/alternatives/awk` — sans ce dossier, `execvp` ne le trouve pas. `hosts`
 * et `nsswitch.conf` portent les noms que l'hôte déclare et l'ordre dans lequel
 * il les résout. `--ro-bind-try` : absents, ils ne font pas échouer le
 * lancement.
 */
const ETC_ORDINAIRE: readonly string[] = [
  '/etc/ssl',
  '/etc/resolv.conf',
  '/etc/passwd',
  '/etc/group',
  '/etc/hosts',
  '/etc/nsswitch.conf',
  '/etc/alternatives',
];

/**
 * Bubblewrap : pas de démon, pas d'image, pas de cgroups.
 *
 * On reconstruit un système minimal en LECTURE SEULE à partir de celui de
 * l'hôte (l'agent a besoin de son interpréteur et de ses bibliothèques), et on
 * n'ouvre en écriture que le répertoire de la tâche.
 *
 * ─── L'AGENT DU MEMBRE VIT DANS SON HOME, ET LE BAC NE LE VOYAIT PAS ─────────
 *
 * Ce bac ne montait que `/usr`, `/bin` et `/lib`. Or Claude Code (installeur
 * natif), Codex et Cursor (npm ou installeur) et Node lui-même (nvm, archive)
 * s'installent sous `$HOME` : mesuré sur un hôte réel, le preflight passait
 * pour `git` et échouait pour `claude`, `codex`, `cursor-agent` et `node`. Le
 * nœud retombait alors en sandbox de processus — en annonçant, en plus, une
 * image Docker que bubblewrap n'a jamais eue.
 *
 * On monte donc, EN LECTURE SEULE et au MÊME chemin, l'installation réelle de
 * la commande et celle du `node` du PATH (voir `installationHote`) — jamais le
 * HOME lui-même. Et l'environnement dit au processus où il est : son HOME est
 * éphémère, son `TMPDIR` existe, sa tâche est au point de montage. Avant, ces
 * trois variables pointaient vers des chemins de l'hôte absents du bac —
 * `mktemp` y rendait 1.
 */
function enveloppeBwrap(
  bin: string,
  argsAgent: readonly string[],
  opts: OptionsEnveloppe,
): Enveloppe {
  const hote = opts.hote ?? contexteHote();
  const installation = installationHote(bin, {
    ...hote,
    // Le workRoot d'où vient la tâche contient les AUTRES tâches : aucune
    // racine montée ne doit l'englober.
    interdits: [...hote.interdits, opts.cwdHote],
  });
  const args = [
    // Le système de l'hôte, en LECTURE SEULE.
    '--ro-bind',
    '/usr',
    '/usr',
    '--ro-bind',
    '/bin',
    '/bin',
    '--ro-bind',
    '/lib',
    '/lib',
    // Présent sur les systèmes 64 bits, absent ailleurs : `--ro-bind-try` ne
    // fait pas échouer le lancement si le chemin n'existe pas.
    '--ro-bind-try',
    '/lib64',
    '/lib64',
    ...ETC_ORDINAIRE.flatMap((f) => ['--ro-bind-try', f, f]),
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    // Le HOME éphémère, créé dans le tmpfs : effacé à l'arrêt comme le reste.
    '--dir',
    HOME_CONTENEUR,

    // L'installation de l'agent et de son Node, en LECTURE SEULE. APRÈS le
    // tmpfs : une installation rangée sous `/tmp` serait sinon recouverte.
    ...installation.racines.flatMap((r) => ['--ro-bind', r, r]),
    // Le lien par lequel le PATH de l'hôte atteint la commande (`~/.local/bin/
    // claude` → la version installée) : le nom logique se résout dans le bac
    // comme sur l'hôte, sans monter le reste de `~/.local/bin`.
    ...installation.liens.flatMap(({ lien, cible }) => ['--symlink', cible, lien]),

    // LE SEUL chemin inscriptible.
    '--bind',
    opts.cwdHote,
    MONTAGE,
    '--chdir',
    MONTAGE,

    // ─── L'ENVIRONNEMENT : DES CHEMINS DU BAC, JAMAIS DE VALEUR SECRÈTE ─────
    //
    // bubblewrap transmet l'environnement de son appelant — l'environnement
    // épuré de la tâche (`buildSandboxEnv`), c'est-à-dire les seules variables
    // nommées par l'agent : ses clés y passent par HÉRITAGE, jamais par argv.
    // `--setenv` ne porte donc ici que des chemins du bac, qui ne sont pas des
    // secrets ; une clé écrite ici serait lisible par `ps` pour toute la machine.
    '--setenv',
    'HOME',
    HOME_CONTENEUR,
    '--setenv',
    'TMPDIR',
    '/tmp',
    '--setenv',
    'HIVE_TASK_CWD',
    MONTAGE,
    // TEMP et TMP pointaient vers `<tâche>.tmp` sur l'hôte, absent du bac ; les
    // chemins de configuration de l'hôte n'y mèneraient nulle part.
    ...['TEMP', 'TMP', ...VARIABLES_CHEMIN_HOTE.filter((v) => v !== 'HOME')].flatMap((v) => [
      '--unsetenv',
      v,
    ]),

    // Pas d'élévation, pas de session partagée, et le processus meurt avec Hive.
    '--unshare-all',
    // …sauf le réseau : l'agent doit joindre son modèle. C'est la même
    // concession que pour les conteneurs, et elle est dite au même endroit.
    '--share-net',
    '--new-session',
    '--die-with-parent',
    '--',
    bin,
    ...argsAgent,
  ];
  return { bin: opts.fournisseur.bin, args };
}

// ─── Ce que bubblewrap doit rendre visible de l'hôte ─────────────────────────

/** Où l'hôte cherche une commande, et ce qu'aucune racine montée n'englobe. */
export interface ContexteHote {
  /** Le PATH que l'enfant hérite — celui où son nom nu se résout. */
  chemin: string | undefined;
  /**
   * Répertoires qu'aucune racine montée ne doit englober : le HOME du membre
   * (clés SSH, sessions, `.env` d'autres outils) et l'installation de Hive
   * (sa base, son `.env`, les répertoires des autres tâches).
   */
  interdits: readonly string[];
}

/** L'hôte réel, lu à l'instant de l'appel. */
export function contexteHote(env: NodeJS.ProcessEnv = process.env): ContexteHote {
  return { chemin: env.PATH, interdits: [homedir(), process.cwd()] };
}

/** Ce qu'il faut monter pour qu'une commande existe dans le bac. */
export interface InstallationHote {
  /** Répertoires réels de l'hôte, montés en LECTURE SEULE au même chemin. */
  racines: string[];
  /** Liens à recréer dans le bac pour que le nom se résolve comme sur l'hôte. */
  liens: Array<{ lien: string; cible: string }>;
}

/** `chemin` est-il `dossier` lui-même, ou dessous ? */
function sousOuEgal(chemin: string, dossier: string): boolean {
  return chemin === dossier || chemin.startsWith(dossier.endsWith('/') ? dossier : `${dossier}/`);
}

function reel(chemin: string): string | null {
  try {
    return realpathSync(chemin);
  } catch {
    return null;
  }
}

/**
 * Le chemin où `execvp` trouverait `bin` — sans rien lancer.
 *
 * Une entrée RELATIVE du PATH (`.`, ou vide) est ignorée : elle se résoudrait
 * contre le cwd de Hive, pas contre un répertoire d'installation. Un `bin` qui
 * contient `/` n'est pas cherché ; relatif, il vise le répertoire de la tâche,
 * qui est déjà monté.
 */
function surLePath(bin: string, chemin: string | undefined): string | null {
  if (bin.includes('/')) return path.isAbsolute(bin) ? bin : null;
  for (const dossier of (chemin ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(dossier)) continue;
    const candidat = path.join(dossier, bin);
    try {
      accessSync(candidat, constants.X_OK);
      if (statSync(candidat).isFile()) return candidat;
    } catch {
      // absent ou non exécutable : l'entrée suivante du PATH
    }
  }
  return null;
}

/**
 * Le répertoire qui porte TOUT ce dont un exécutable a besoin.
 *
 * Sous `node_modules`, c'est le paquet entier (`@openai/codex`, pas son seul
 * `bin/`) : le lanceur y cherche son binaire natif et ses dépendances, et une
 * installation globale npm les range DANS le paquet. Ailleurs — installeur
 * natif de Claude Code, version de Cursor —, c'est le dossier du fichier réel.
 */
export function racineDePaquet(fichier: string): string {
  const morceaux = fichier.split('/');
  const i = morceaux.lastIndexOf('node_modules');
  if (i >= 0) {
    const taille = morceaux[i + 1]?.startsWith('@') ? 2 : 1;
    if (i + taille < morceaux.length - 1) return morceaux.slice(0, i + 1 + taille).join('/');
  }
  return path.dirname(fichier);
}

/**
 * Node se range en préfixe : `bin/node`, et `lib/node_modules` pour npm, npx et
 * les CLI installés globalement. Monter le seul `bin/` laisserait `npm` en lien
 * mort. On ne monte pas le préfixe entier : `etc/npmrc` peut porter un jeton de
 * registre, et aucun outil du bac n'en a besoin.
 */
function racinesDeNode(noeud: string): string[] {
  const bin = path.dirname(noeud);
  if (path.basename(bin) !== 'bin') return [bin];
  return [bin, path.join(path.dirname(bin), 'lib')];
}

/**
 * Ce que bubblewrap doit monter pour que `bin` s'exécute dans le bac — et le
 * `node` du PATH avec lui.
 *
 * `node` n'est pas un invité de circonstance : le pont MCP de délégation est un
 * `node --eval` que le CLI lance PAR SON NOM, et Codex (comme `npm`) est un
 * script `#!/usr/bin/env node`. Le `node` qui compte est donc celui que le PATH
 * désigne — c'est aussi celui que le preflight du pont éprouve.
 *
 * ─── CE QUI N'EST JAMAIS MONTÉ ───────────────────────────────────────────────
 *
 * Une racine qui englobe un `interdit` (le HOME, l'installation de Hive, le
 * répertoire des tâches) ou qui vaut `/` est écartée. La commande est alors
 * introuvable dans le bac, le preflight échoue, et le nœud le dit : mieux vaut
 * un repli annoncé qu'un HOME monté en silence. Sous `/usr`, rien à monter,
 * c'est déjà visible.
 */
export function installationHote(
  bin: string,
  contexte: ContexteHote = contexteHote(),
): InstallationHote {
  const candidates: string[] = [];
  const liens: Array<{ lien: string; cible: string }> = [];
  for (const commande of new Set([bin, 'node'])) {
    const trouve = surLePath(commande, contexte.chemin);
    const fichier = trouve ? reel(trouve) : null;
    if (!trouve || !fichier) continue;
    candidates.push(...(commande === 'node' ? racinesDeNode(fichier) : [racineDePaquet(fichier)]));
    if (trouve !== fichier) liens.push({ lien: trouve, cible: fichier });
  }

  const interdits = contexte.interdits.flatMap((d) => [d, reel(d) ?? d]);
  const racines: string[] = [];
  // Du plus court au plus long : un parent déjà retenu couvre ses enfants, et
  // l'ordre des arguments ne dépend pas de celui du PATH.
  for (const racine of [...new Set(candidates)].sort(
    (a, b) => a.length - b.length || (a < b ? -1 : 1),
  )) {
    if (racine === '/' || !existsSync(racine)) continue;
    if (SYSTEME_MONTE.some((s) => sousOuEgal(racine, s))) continue;
    if (interdits.some((d) => sousOuEgal(d, racine))) continue;
    if (racines.some((r) => sousOuEgal(racine, r))) continue;
    racines.push(racine);
  }
  // Un lien posé dans un dossier déjà monté y est déjà — et bubblewrap ne
  // saurait pas l'écrire sur un montage en lecture seule.
  const visibles = [...SYSTEME_MONTE, ...racines];
  return {
    racines,
    liens: liens.filter(({ lien }) => !visibles.some((v) => sousOuEgal(path.dirname(lien), v))),
  };
}

// ─── Trouver ce qui est installé ─────────────────────────────────────────────

/** Vrai si `bin --version` s'exécute et rend 0. Motif de `agent-detect.ts`. */
export function sonder(bin: string, timeoutMs = 4_000): Promise<boolean> {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (ok: boolean): void => {
      if (fini) return;
      fini = true;
      resolve(ok);
    };
    let enfant;
    try {
      // ─── LE MÊME SOIN QUE LA SONDE D'AGENT, ET POUR LA MÊME RAISON ────────
      //
      // `main.ts` charge `.env` AVANT de préparer le bac. Sans `env`, l'enfant
      // hérite de tout `process.env` : HIVE_TOKEN, HIVE_JWT_SECRET et la clé
      // d'API partaient à un binaire nommé `docker`, `podman` ou `bwrap` trouvé
      // dans le PATH — c'est-à-dire à n'importe quel homonyme déposé en tête
      // de PATH.
      //
      // La garde existait déjà, pure et testée, pour la sonde d'agent ; elle
      // n'avait simplement pas été portée ici. C'est le § 9 bis du journal :
      // deux chemins pour un même geste, dont l'un est soigné et l'autre non.
      enfant = spawn(bin, ['--version'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
        env: envSonde(process.env),
      });
    } catch {
      finir(false);
      return;
    }
    const minuteur = setTimeout(() => {
      enfant.kill();
      // Un binaire qui se bloque est traité comme ABSENT : on ne confie pas
      // l'isolement à un outil qui ne répond pas.
      finir(false);
    }, timeoutMs);
    minuteur.unref?.();
    enfant.on('error', () => {
      clearTimeout(minuteur);
      finir(false);
    });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      finir(code === 0);
    });
  });
}

/** Le premier fournisseur disponible, dans l'ordre de préférence. */
export async function trouverFournisseur(): Promise<Fournisseur | null> {
  for (const f of FOURNISSEURS) {
    if (await sonder(f.bin)) return f;
  }
  return null;
}

export interface ResultatPreflightAgent {
  executable: boolean;
  motif: string;
}

/** Vérifie le nom logique de l'agent dans le bac qui exécutera les tâches. */
export function sonderAgentDansBac(
  fournisseur: Fournisseur,
  binAgent: string,
  image = IMAGE_DEFAUT,
  cwdHote?: string,
  timeoutMs = 30_000,
): Promise<ResultatPreflightAgent> {
  // A preflight only proves image contents. Mounting the caller's workspace
  // would expose `.env`, state, and source files to an agent probe that never
  // needs them; use an empty disposable directory by default.
  const probeCwd = cwdHote ?? mkdtempSync(join(tmpdir(), 'hive-agent-preflight-'));
  const ownedCwd = cwdHote === undefined;
  let lance: Enveloppe;
  try {
    lance = envelopper(binAgent, ['--version'], {
      fournisseur,
      cwdHote: probeCwd,
      variables: [],
      image,
    });
  } catch {
    if (ownedCwd) rmSync(probeCwd, { recursive: true, force: true });
    return Promise.resolve({
      executable: false,
      motif: `preflight impossible via ${fournisseur.nom}`,
    });
  }

  return new Promise((resolve) => {
    let fini = false;
    const finir = (executable: boolean, motif: string): void => {
      if (fini) return;
      fini = true;
      if (ownedCwd) rmSync(probeCwd, { recursive: true, force: true });
      resolve({ executable, motif });
    };
    let enfant;
    try {
      enfant = spawn(lance.bin, lance.args, {
        cwd: probeCwd,
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
        env: envSonde(process.env),
      });
    } catch {
      finir(false, `preflight impossible via ${fournisseur.nom}`);
      return;
    }
    const minuteur = setTimeout(() => {
      enfant.kill();
      finir(false, `preflight de l'agent expiré via ${fournisseur.nom}`);
    }, timeoutMs);
    minuteur.unref?.();
    enfant.on('error', () => {
      clearTimeout(minuteur);
      finir(false, `agent « ${binAgent} » non exécutable via ${fournisseur.nom}`);
    });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      finir(
        code === 0,
        code === 0
          ? `agent « ${binAgent} » exécutable dans le bac`
          : `agent « ${binAgent} » absent ou non exécutable dans le bac`,
      );
    });
  });
}

/**
 * Ce que le nœud doit faire, compte tenu de son mode et de ce qu'il a trouvé.
 *
 * FERMÉ PAR DÉFAUT en `exige` : pas de moteur ⇒ le nœud REFUSE de travailler.
 * C'est le mode que doit choisir quiconque prête sa machine à des inconnus, et
 * il vaut mieux un nœud qui ne prend pas de tâche qu'un nœud qui en prend une
 * sans bac à sable en croyant le contraire.
 */
export function decider(
  mode: ModeIsolement,
  fournisseur: Fournisseur | null,
): { isole: boolean; niveau: NiveauIsolement; refuse: boolean; motif: string } {
  if (mode === 'off') {
    return {
      isole: false,
      niveau: 'processus',
      refuse: false,
      motif: 'isolement désactivé (HIVE_ISOLEMENT=off) — sandbox de processus seule',
    };
  }
  if (fournisseur) {
    return {
      isole: true,
      niveau: 'conteneur',
      refuse: false,
      motif: `isolement par ${fournisseur.nom}`,
    };
  }
  if (mode === 'exige') {
    return {
      isole: false,
      niveau: 'aucun',
      refuse: true,
      motif:
        'HIVE_ISOLEMENT=exige et aucun moteur de conteneurs trouvé : ce nœud refuse de travailler. ' +
        FOURNISSEURS.map((f) => `${f.nom} → ${f.installation}`).join(' · '),
    };
  }
  return {
    isole: false,
    niveau: 'processus',
    refuse: false,
    motif:
      'aucun moteur de conteneurs trouvé — sandbox de processus seule. ' +
      'Installez podman pour un vrai bac à sable, ou passez HIVE_ISOLEMENT=exige pour refuser le travail sans lui.',
  };
}

/** Lit le mode depuis l'environnement. Défaut `auto` : améliore sans bloquer. */
export function modeDepuisEnv(env: NodeJS.ProcessEnv = process.env): ModeIsolement {
  const v = (env.HIVE_ISOLEMENT ?? '').trim();
  return MODES.includes(v as ModeIsolement) ? (v as ModeIsolement) : 'auto';
}
