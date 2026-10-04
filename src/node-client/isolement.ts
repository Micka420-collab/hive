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
// LE RÉSEAU : FILTRÉ, PAS FERMÉ. Un agent de codage doit joindre l'API de son
// modèle — un réseau coupé rendrait Hive inutilisable —, mais c'est tout ce
// qu'il doit joindre. Quand le projet ne dit pas `ouvert` (`shared/reseau.ts`),
// le bac n'a QUE sa boucle locale (`--unshare-net`, `--network=none`) : tout ce
// qui sort passe par le proxy de la tâche, ouvert par le nœud HORS du bac
// (`proxy-egress.ts`), qui ne laisse passer que la liste blanche du projet
// (`politique-reseau.ts`) et garde les vrais identifiants dehors — le bac n'en
// voit que des leurres.
//
// Ce qui reste à assumer et à afficher (`constat`) : un hôte PERMIS reçoit ce
// que l'agent lui envoie. L'isolement empêche un agent hostile de LIRE votre
// machine et de joindre n'importe quoi ; il ne l'empêche pas d'envoyer ce qu'il
// a lu du dépôt vers l'API de son propre modèle ou un registre déclaré. Et un
// projet réglé `ouvert` retrouve le réseau entier, comme avant.

// ─── AUCUNE DÉPENDANCE EMBARQUÉE ─────────────────────────────────────────────
//
// Même doctrine que `tunnel.ts` : Hive n'installe aucun moteur de conteneurs.
// Il détecte ce qui est déjà là et s'en sert. Imposer Docker à quelqu'un qui
// prête sa machine à des amis serait une exigence disproportionnée, et
// l'embarquer serait pire — un `npm install` ne doit pas décider d'installer
// un démon privilégié.
//
// MODULE PUR pour tout ce qui se calcule (les arguments, les garanties, le
// niveau) ; les impuretés sont les SONDES — `--version`, et la question qui
// dit si un moteur répond (`questionAuMoteur`) —, et, pour
// bubblewrap seul, la LECTURE du PATH de l'hôte (`installationHote`), qui ne
// lance rien et qu'un banc remplace par `OptionsEnveloppe.hote`.

import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { envSonde } from './agent-detect.js';
import {
  ENTETE_REFUS,
  NOM_RELAIS,
  PORT_RELAIS,
  ecrireRelais,
  ouvrirSessionReseau,
} from './proxy-egress.js';
import { RendezVousPont } from './rendez-vous-pont.js';
import { PREFIXE_PREFLIGHT_AGENT } from '../shared/empreinte.js';

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
/**
 * Point de montage, dans le bac, du dossier du pont de délégation de la tâche
 * (`rendez-vous-pont.ts`) : son socket et sa configuration MCP, en LECTURE
 * SEULE. Hors de `MONTAGE` : le socket ne vit plus dans le répertoire de la
 * tâche, dont la profondeur dépassait la limite d'un chemin de socket Unix.
 */
export const MONTAGE_PONT = '/hive/pont';
/**
 * Point de montage, dans le bac, du dossier RÉSEAU de la tâche : le socket de
 * son proxy et le relais (`proxy-egress.ts`), en LECTURE SEULE — comme le pont,
 * se connecter à un socket n'écrit rien.
 */
export const MONTAGE_RESEAU = '/hive/reseau';
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
 * Image utilisée par les moteurs de conteneurs quand l'opérateur n'en nomme pas.
 *
 * ─── UNE IMAGE PAR DÉFAUT QUI NE PORTAIT AUCUN AGENT ─────────────────────────
 *
 * Le défaut était `docker.io/library/node:20-slim` : Node 20 en fin de vie, et
 * AUCUNE CLI d'agent dedans. Le preflight de `claude` ou `codex` y échouait
 * donc toujours ; le niveau conteneur était inatteignable pour un vrai agent
 * sur le chemin par défaut, et le message disait « agent absent » — l'humain
 * réinstallait un agent bien présent sur sa machine.
 *
 * Le défaut est désormais l'image que le dépôt sait construire
 * (`docker/agents/Dockerfile` : Node 24, Claude Code, Codex, Cline, uid 1000),
 * construite SUR LE NŒUD par `COMMANDE_IMAGE`. Rien n'est publié ni signé par
 * Hive : aucun registre tiers n'entre dans la chaîne de confiance par défaut.
 *
 * Le préfixe `localhost/` n'est pas décoratif. Sans lui, Docker lirait
 * `hive-agent:local` comme `docker.io/library/hive-agent:local` et irait le
 * chercher sur le Hub ; avec lui, les deux moteurs rangent et retrouvent l'image
 * sous le même nom, et une image absente n'est JAMAIS téléchargée d'ailleurs
 * (voir `preparerImage`, qui la fait construire au lieu de la tirer).
 */
export const IMAGE_DEFAUT = 'localhost/hive-agent:local';

/** Ce qui construit `IMAGE_DEFAUT` depuis un clone du dépôt. */
export const COMMANDE_IMAGE = 'npm run bac:image';

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
  /**
   * Podman : le MOTEUR tourne-t-il sans root ? Appris au preflight de lui-même
   * (`podman info`, voir `preparerIdentite`), pas de l'UID de l'hôte : un
   * podman-remote vers une machine rootful (`podman machine set --rootful`,
   * `CONTAINER_HOST`) refuse `--userns=keep-id`, quel que soit l'UID du nœud.
   * Absent : le moteur n'a pas été interrogé, ou n'a rien dit — l'UID de l'hôte
   * en décide, comme pour un Podman local.
   */
  rootless?: boolean;
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
export function constat(
  niveau: NiveauIsolement,
  fournisseur: Fournisseur | null,
  /** Le bac sait-il filtrer le réseau (`sonderReseauFiltre`) ? */
  reseauFiltre = false,
): Constat {
  if (niveau === 'conteneur' && fournisseur && reseauFiltre) {
    return {
      niveau,
      protege: [
        ...fournisseur.garanties,
        'réseau sortant filtré hors du bac : l’API du modèle, et selon le projet ses registres et son hôte git',
        'le réseau local, la machine hôte et les métadonnées de nuage restent injoignables',
        'les clés du modèle (Claude Code, Codex) restent au nœud : le bac n’en voit que des leurres',
      ],
      laissePasser: [
        'ce que l’agent envoie aux hôtes permis : il peut y écrire ce qu’il a lu du dépôt',
        'le réseau entier pour un projet réglé « ouvert » par son propriétaire',
      ],
    };
  }
  if (niveau === 'conteneur' && fournisseur) {
    return {
      niveau,
      protege: fournisseur.garanties,
      laissePasser: [
        'le réseau — ce bac ne sait pas le filtrer ici : un agent peut joindre n’importe quel hôte',
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
  /** Groupe numérique sous lequel exécuter. Défaut : celui du nœud (voir `identiteNonPrivilegiee`). */
  gid?: number;
  /**
   * Le nœud et la tâche qui possèdent le conteneur, posés en ÉTIQUETTES
   * (`ETIQUETTE_NOEUD`, `ETIQUETTE_TACHE`). Ce ne sont pas des secrets : ce sont
   * des identifiants que le hub affiche déjà. Voir `ramasserConteneurs`.
   */
  noeud?: string;
  tache?: string;
  /**
   * Bubblewrap seulement : où l'hôte cherche les commandes (voir
   * `installationHote`). Défaut : l'hôte réel. Un banc le fixe pour que les
   * arguments ne dépendent pas des agents installés sur sa machine.
   */
  hote?: ContexteHote;
  /**
   * Dossier HÔTE du pont de délégation de CETTE tâche, monté seul et en
   * LECTURE SEULE à `MONTAGE_PONT`. Se connecter à un socket n'écrit rien sur
   * le système de fichiers : la lecture seule suffit (mesuré sous bubblewrap),
   * et l'agent ne peut ni effacer ni remplacer le socket. Absent : la commande
   * n'a pas de pont, rien n'est monté.
   */
  pont?: string;
  /** Le réseau FILTRÉ de la tâche (voir `ReseauBac`). Absent : le réseau de l'hôte. */
  reseau?: ReseauBac;
}

/**
 * Le réseau filtré d'UNE tâche, tel que l'enveloppe le câble : réseau coupé,
 * dossier de la session monté en lecture seule, relais devant l'agent.
 *
 * ─── RIEN DE SECRET ICI ──────────────────────────────────────────────────────
 *
 * `variables` passent en ARGUMENTS (`--setenv`, `--env=NOM=valeur`), donc dans
 * la table des processus : ce sont l'adresse du proxy et des passerelles, pas
 * des identifiants. Les leurres voyagent comme les vraies clés avant eux, par
 * l'environnement hérité (`OptionsEnveloppe.variables`) — et la vraie valeur
 * ne quitte jamais le nœud (`masquerIdentifiants`).
 */
export interface ReseauBac {
  /** Dossier HÔTE de la session (0700) : le socket et `NOM_RELAIS`. */
  dossier: string;
  /** Le socket du proxy, DANS `dossier`. */
  socket: string;
  /**
   * L'interpréteur du relais sous bubblewrap : le `node` de l'hôte, monté seul
   * en lecture seule. Un conteneur prend le `node` de son image.
   */
  interprete: string;
  /** Variables NON secrètes posées dans le bac : proxy et bases d'API. */
  variables: Readonly<Record<string, string>>;
}

/** La commande que le bac lance : l'agent, derrière le relais quand le réseau est filtré. */
function commandeDansBac(
  bin: string,
  argsAgent: readonly string[],
  reseau: ReseauBac | undefined,
  interprete: string,
): string[] {
  if (!reseau) return [bin, ...argsAgent];
  return [
    interprete,
    `${MONTAGE_RESEAU}/${NOM_RELAIS}`,
    String(PORT_RELAIS),
    `${MONTAGE_RESEAU}/${path.basename(reseau.socket)}`,
    '--',
    bin,
    ...argsAgent,
  ];
}

/**
 * L'atelier créé par Hive appartient à l'utilisateur qui a lancé le nœud.
 * Reprendre systématiquement 1000 casse donc l'écriture dans le volume sur les
 * runners et les postes où cet utilisateur a un autre UID. On reprend son UID
 * — et son GID, pas une copie de l'UID : sur un runner GitHub, `runner` est
 * 1001 dans un groupe primaire qui n'est pas 1001 — quand il est non
 * privilégié ; un nœud lancé en root reste explicitement abaissé à 1000:1000.
 */
function identiteNonPrivilegiee(): { uid: number; gid: number; rootless: boolean } {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const gid = typeof process.getgid === 'function' ? process.getgid() : undefined;
  if (typeof uid === 'number' && uid > 0) {
    return { uid, gid: typeof gid === 'number' && gid > 0 ? gid : uid, rootless: true };
  }
  return { uid: 1000, gid: 1000, rootless: false };
}

/** Podman rootless — selon le moteur s'il l'a dit, sinon selon l'UID du nœud. */
function keepId(fournisseur: Fournisseur): boolean {
  return (
    fournisseur.nom === 'podman' && (fournisseur.rootless ?? identiteNonPrivilegiee().rootless)
  );
}

/** Étiquette de conteneur : le nœud qui l'a lancé. Voir `ramasserConteneurs`. */
export const ETIQUETTE_NOEUD = 'hive.noeud';
/** Étiquette de conteneur : la tâche qu'il exécute, pour qui inspecte à la main. */
export const ETIQUETTE_TACHE = 'hive.tache';

/**
 * Tout ce que le bac d'un nœud transmet à une exécution — une seule forme,
 * partagée par les adaptateurs, le merge et le client. Elle était recopiée en
 * quatre endroits sous la forme `{ fournisseur; variables; image }`, et
 * l'ajout des étiquettes aurait fait quatre endroits où en oublier une.
 */
export interface BacExecution {
  fournisseur: Fournisseur;
  /** Image ayant passé le preflight agent-aware. */
  image: string;
  /** Noms — jamais valeurs — des variables à transmettre dans le bac. */
  variables: readonly string[];
  /** Le nœud propriétaire (étiquette `ETIQUETTE_NOEUD`). */
  noeud?: string;
  /** La tâche en cours (étiquette `ETIQUETTE_TACHE`). */
  tache?: string;
  /** Le réseau filtré de la tâche, ouvert par le nœud pour elle seule. */
  reseau?: ReseauBac;
}

/** Les options d'enveloppe d'une exécution dans le bac, sur le répertoire `cwdHote`. */
export function optionsEnveloppe(bac: BacExecution, cwdHote: string): OptionsEnveloppe {
  return {
    fournisseur: bac.fournisseur,
    cwdHote,
    variables: bac.variables,
    image: bac.image,
    ...(bac.noeud ? { noeud: bac.noeud } : {}),
    ...(bac.tache ? { tache: bac.tache } : {}),
    ...(bac.reseau ? { reseau: bac.reseau } : {}),
  };
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
  const hote = identiteNonPrivilegiee();
  const uid = opts.uid ?? hote.uid;
  const gid = opts.gid ?? hote.gid;
  const args = [
    'run',
    '--rm',
    // Pas de TTY, pas d'entrée interactive : l'agent est piloté par argv.
    '--interactive=false',
    // ─── UN VRAI PID 1, QUI RELAIE LES SIGNAUX ET RAMASSE LES ZOMBIES ───────
    //
    // Sans `--init`, l'agent EST le PID 1 du conteneur, et le noyau n'y livre
    // aucun signal que le processus n'a pas explicitement capté : le SIGTERM
    // qu'un délai ou une annulation envoie au client `docker run` (qui le
    // relaie) ne tuait pas un `node` qui ne l'écoute pas. Le conteneur survivait
    // à sa tâche.
    '--init',
    // L'image a été vérifiée présente au démarrage (`preparerImage`). Une image
    // retirée depuis fait échouer la tâche net, au lieu d'un téléchargement
    // silencieux pris sur son délai — ou tiré d'un registre que personne n'a
    // choisi.
    '--pull=never',
    // Le propriétaire, lisible par le moteur : un nœud tué (kill -9, panne)
    // laisse un conteneur que `docker run --rm` ne supprimera jamais, puisque
    // son client est mort. Le nœud relancé le retrouve par cette étiquette.
    ...(opts.noeud ? [`--label=${ETIQUETTE_NOEUD}=${opts.noeud}`] : []),
    ...(opts.tache ? [`--label=${ETIQUETTE_TACHE}=${opts.tache}`] : []),

    // ── Ce qui est visible ─────────────────────────────────────────────────
    // LE SEUL montage inscriptible. Pas de $HOME, pas de ~/.ssh, pas de socket
    // de démon — seulement, en lecture seule, le pont de la tâche s'il y en a
    // un (jamais sous Windows : `raisonPontMcpDansBac` y écarte le bac).
    `--volume=${volumeSource}:${MONTAGE}:rw`,
    ...(opts.pont ? [`--volume=${opts.pont}:${MONTAGE_PONT}:ro`] : []),
    // ─── RÉSEAU FILTRÉ : AUCUNE INTERFACE, SAUF LA BOUCLE ─────────────────
    //
    // `--network=none` : le conteneur n'a que `lo`. Tout ce qui sort passe par
    // le relais, vers le socket du proxy de la tâche monté en lecture seule
    // (conception Linux de srt). Sans `reseau`, le réseau du moteur, comme
    // avant — le niveau `ouvert` d'un projet.
    ...(opts.reseau
      ? ['--network=none', `--volume=${opts.reseau.dossier}:${MONTAGE_RESEAU}:ro`]
      : []),
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
    // ─── PODMAN ROOTLESS : L'UID DU NŒUD, PAS UN SUBUID ─────────────────────
    //
    // Sans `--userns=keep-id`, Podman rootless mappe l'UID 0 du conteneur sur
    // l'utilisateur et tout autre UID sur une plage subordonnée : `--user=1001`
    // y devient un subuid étranger, qui ne peut écrire ni dans le répertoire de
    // la tâche ni sur la socket du pont MCP (0600). `keep-id` fait coïncider
    // l'UID du conteneur avec celui du nœud. Un nœud root, lui, n'a aucune
    // identité non privilégiée à garder : il garde l'abaissement explicite à
    // 1000:1000, sans `keep-id`.
    ...(keepId(opts.fournisseur) ? ['--userns=keep-id'] : []),
    `--user=${uid}:${gid}`,

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
  // Les variables du réseau (proxy, bases d'API) ne sont PAS des secrets :
  // elles passent par valeur, et priment sur un nom homonyme de l'hôte — un
  // `ANTHROPIC_BASE_URL` du membre viserait l'API en direct, que le bac ne
  // joint plus (la passerelle, elle, relaie vers cette base).
  const reseau = opts.reseau?.variables ?? {};
  // Les secrets passent par leur NOM seul : jamais dans la ligne de commande.
  for (const nom of opts.variables) {
    if (!VARIABLES_CHEMIN_HOTE.includes(nom) && !(nom in reseau)) args.push(`--env=${nom}`);
  }
  for (const [nom, valeur] of Object.entries(reseau)) args.push(`--env=${nom}=${valeur}`);

  args.push(opts.image ?? IMAGE_DEFAUT, ...commandeDansBac(bin, argsAgent, opts.reseau, 'node'));
  return { bin: opts.fournisseur.bin, args };
}

/**
 * Ce que le CLIENT d'un moteur lit de l'hôte pour joindre son moteur.
 *
 * ─── L'ENVIRONNEMENT ÉPURÉ DE LA TÂCHE EST CELUI DE L'AGENT, PAS DU MOTEUR ───
 *
 * `podman run` recevait l'environnement épuré de la tâche (`buildSandboxEnv` :
 * ni HOME, ni session). Or Podman rootless range ses images sous le HOME et sa
 * session sous `XDG_RUNTIME_DIR`, et Docker suit `DOCKER_HOST` (Docker rootless,
 * Colima, contexte) : le preflight, lancé avec l'environnement du nœud, trouvait
 * le moteur ; la tâche, lancée sans, pouvait ne pas le trouver. Un bac annoncé,
 * puis chaque tâche en échec d'infra.
 *
 * `XDG_DATA_HOME` et `XDG_CONFIG_HOME` déplacent ce magasin et sa
 * configuration quand ils sont posés : sans eux, la tâche cherchait les images
 * ailleurs que le preflight.
 *
 * Ces variables vont au CLIENT, jamais au conteneur : seule `--env=NOM` fait
 * traverser une variable, pour les noms que le bac autorise, et `HOME` y est
 * posé explicitement sur `HOME_CONTENEUR` (voir `VARIABLES_CHEMIN_HOTE`).
 * Bubblewrap, lui, TRANSMET son environnement à l'agent : il n'en reçoit rien
 * de plus.
 */
const VARIABLES_MOTEUR: readonly string[] = [
  'HOME',
  'XDG_RUNTIME_DIR',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'DBUS_SESSION_BUS_ADDRESS',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  // Un `DOCKER_HOST=tcp://…:2376` ne se joint qu'avec ses certificats.
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
  'CONTAINER_HOST',
  'CONTAINER_CONNECTION',
  'CONTAINERS_CONF',
  'CONTAINERS_STORAGE_CONF',
  // Sous Windows, le client Docker et la connexion de la machine Podman se
  // rangent sous le profil : sans eux, le client ne trouve pas son moteur.
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
];

/**
 * Ce que le client d'un moteur lit pour TÉLÉCHARGER une image : le proxy
 * d'entreprise, le fichier d'authentification du registre, les autorités de
 * certification. Podman rootless tire l'image dans le processus client : sans
 * eux, une image nommée ne se téléchargeait plus derrière un proxy.
 *
 * AU `pull` SEULEMENT, ni à la tâche ni aux preflights : une tâche ne
 * télécharge rien (`--pull=never`), et Podman fait traverser par défaut les
 * variables de proxy de son client jusque dans le conteneur (`--http-proxy`) —
 * un proxy à identifiants aurait rejoint l'environnement de l'agent sans que
 * le bac l'ait autorisé. Un `pull` ne lance aucun conteneur.
 */
const VARIABLES_TELECHARGEMENT: readonly string[] = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'REGISTRY_AUTH_FILE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

/**
 * L'environnement du client d'un moteur de conteneurs pour les ÉPREUVES du
 * démarrage (inspection, téléchargement, preflight, ramassage).
 *
 * ─── LE PREFLIGHT VOYAIT PLUS QUE LA TÂCHE ───────────────────────────────────
 *
 * Les épreuves lançaient le client avec presque tout l'environnement de l'hôte
 * (`envSonde` ne retire que les secrets) ; la tâche, avec la liste
 * `VARIABLES_MOTEUR`. Tout réglage du moteur hors de cette liste faisait
 * passer le preflight et échouer chaque tâche. Les deux partent maintenant de
 * la MÊME règle, `envDuLanceur`, sur la même base système que
 * `buildSandboxEnv` : ce que le preflight trouve, la tâche le trouve. Seul le
 * `pull` en reçoit plus (`envTelechargement`), qu'aucune tâche ne fait.
 */
export function envMoteur(
  fournisseur: Fournisseur,
  envHote: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const nom of ['PATH', 'SYSTEMROOT', 'SYSTEMDRIVE']) {
    if (envHote[nom] !== undefined) base[nom] = envHote[nom];
  }
  return envDuLanceur(fournisseur, base, envHote);
}

/** `envMoteur`, plus ce que lit un téléchargement (`VARIABLES_TELECHARGEMENT`). */
export function envTelechargement(
  fournisseur: Fournisseur,
  envHote: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = envMoteur(fournisseur, envHote);
  for (const nom of VARIABLES_TELECHARGEMENT) {
    if (envHote[nom] !== undefined) env[nom] = envHote[nom];
  }
  return env;
}

/** L'environnement du processus qui lance le bac : celui de la tâche, plus ce que le moteur lit. */
export function envDuLanceur(
  fournisseur: Fournisseur,
  envTache: NodeJS.ProcessEnv,
  envHote: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (fournisseur.bin === 'bwrap') return envTache;
  const env: NodeJS.ProcessEnv = { ...envTache };
  for (const nom of VARIABLES_MOTEUR) {
    const valeur = envHote[nom];
    if (valeur !== undefined) env[nom] = valeur;
  }
  return env;
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
  // Le relais du réseau filtré tourne sous le `node` de l'hôte — celui qui fait
  // tourner Hive —, monté SEUL en lecture seule quand il n'est pas déjà visible
  // (sous `/usr`, ou dans une installation montée) : jamais son dossier.
  const relais = opts.reseau ? (reel(opts.reseau.interprete) ?? opts.reseau.interprete) : null;
  const visibles = [...SYSTEME_MONTE, ...installation.racines];
  const montageRelais =
    relais && !visibles.some((v) => sousOuEgal(relais, v)) ? ['--ro-bind', relais, relais] : [];
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
    ...montageRelais,

    // LE SEUL chemin inscriptible.
    '--bind',
    opts.cwdHote,
    MONTAGE,
    // Le pont de la tâche, en LECTURE SEULE (voir `OptionsEnveloppe.pont`).
    ...(opts.pont ? ['--ro-bind', opts.pont, MONTAGE_PONT] : []),
    // Le dossier réseau de la tâche, en LECTURE SEULE (voir `ReseauBac`).
    ...(opts.reseau ? ['--ro-bind', opts.reseau.dossier, MONTAGE_RESEAU] : []),
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
    // Le proxy et les bases d'API du réseau filtré : des adresses, pas des
    // secrets (voir `ReseauBac`).
    ...Object.entries(opts.reseau?.variables ?? {}).flatMap(([nom, valeur]) => [
      '--setenv',
      nom,
      valeur,
    ]),

    // Pas d'élévation, pas de session partagée, et le processus meurt avec Hive.
    '--unshare-all',
    // ─── LE RÉSEAU : LA BOUCLE SEULE, OU CELUI DE L'HÔTE ───────────────────
    //
    // `--unshare-all` coupe aussi le réseau : le bac n'a que `lo`, que
    // bubblewrap monte, et le relais y écoute. Seul un projet `ouvert` (pas de
    // `reseau`) rend le réseau de l'hôte, par `--share-net` — la concession
    // d'avant, désormais choisie par le propriétaire du projet.
    ...(opts.reseau ? [] : ['--share-net']),
    '--new-session',
    '--die-with-parent',
    '--',
    ...commandeDansBac(bin, argsAgent, opts.reseau, relais ?? 'node'),
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
 * les CLI installés globalement, que `bin/` atteint par des liens.
 *
 * ─── LE FICHIER `node`, JAMAIS SON DOSSIER ───────────────────────────────────
 *
 * Monter `bin/` et `lib/` entiers supposait un préfixe DÉDIÉ à Node (nvm, une
 * archive). Or `n` avec `N_PREFIX=~/.local`, ou une archive dépliée dans
 * `~/.local`, range `node` dans `~/.local/bin` — à côté de tous les scripts
 * personnels du membre —, et `lib/` à côté de ses paquets Python : les deux
 * entraient dans le bac.
 *
 * On monte donc le fichier `node` seul, `lib/node_modules` seul, et on recrée
 * dans le bac les seuls liens de `bin/` qui pointent DEDANS : `npm`, `npx`,
 * `corepack`, les CLI globaux. Un autre fichier de `bin/` n'y entre pas, pas
 * même son nom. Jamais le préfixe entier : `etc/npmrc` peut porter un jeton de
 * registre, et aucun outil du bac n'en a besoin.
 */
function installationDeNode(noeud: string): InstallationHote {
  const bin = path.dirname(noeud);
  const modules =
    path.basename(bin) === 'bin' ? reel(path.join(path.dirname(bin), 'lib', 'node_modules')) : null;
  if (!modules) return { racines: [noeud], liens: [] };
  let noms: string[] = [];
  try {
    // Trié : l'ordre des arguments ne dépend pas de celui du système de fichiers.
    noms = readdirSync(bin).sort();
  } catch {
    // `bin/` illisible : `node` seul, sans npm — le preflight dira le reste.
  }
  const liens: InstallationHote['liens'] = [];
  for (const nom of noms) {
    const lien = path.join(bin, nom);
    const cible = reel(lien);
    if (cible && cible !== lien && sousOuEgal(cible, modules)) liens.push({ lien, cible });
  }
  return { racines: [noeud, modules], liens };
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
    if (commande === 'node') {
      const node = installationDeNode(fichier);
      candidates.push(...node.racines);
      liens.push(...node.liens);
    } else {
      candidates.push(racineDePaquet(fichier));
    }
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
  // saurait pas l'écrire sur un montage en lecture seule. Un même lien (celui
  // d'un CLI global, vu par l'agent ET par Node) n'est écrit qu'une fois :
  // bubblewrap refuserait de le recréer.
  const visibles = [...SYSTEME_MONTE, ...racines];
  const poses = new Set<string>();
  return {
    racines,
    liens: liens.filter(({ lien }) => {
      if (poses.has(lien) || visibles.some((v) => sousOuEgal(path.dirname(lien), v))) return false;
      poses.add(lien);
      return true;
    }),
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

/**
 * TOUS les moteurs qui répondent à `--version`, dans l'ordre de préférence.
 *
 * Répondre à `--version` ne prouve pas grand-chose : `docker --version` réussit
 * démon arrêté, et masquait alors un bubblewrap parfaitement utilisable. Le
 * nœud éprouve donc chaque candidat, dans l'ordre, et garde le premier dont le
 * preflight passe (`preparerBac`) — pas le premier qui répond.
 */
export async function trouverFournisseurs(): Promise<Fournisseur[]> {
  const presents: Fournisseur[] = [];
  for (const f of FOURNISSEURS) {
    if (await sonder(f.bin)) presents.push(f);
  }
  return presents;
}

/**
 * La question qui dit si un moteur RÉPOND sur cet hôte — une par moteur, parce
 * qu'ils ne se questionnent pas de la même façon.
 *
 * ─── « AUCUN BAC À SABLE NE RÉPOND », SUR UN BUBBLEWRAP QUI MARCHAIT ────────
 *
 * Le docteur posait `<moteur> info` à tous. C'est juste pour Docker et Podman
 * (voir `SONDE_ISOLEMENT`) ; bubblewrap, lui, n'a pas de sous-commande : il
 * prend `info` pour le programme à lancer. Mesuré sur un Ubuntu où le nœud
 * isolait très bien ses tâches par bubblewrap 0.11.1 :
 *
 *     bwrap info  → code=1   bwrap: execvp info: No such file or directory
 *
 * et `hive doctor` concluait « aucun bac à sable ne répond », puis envoyait
 * installer Docker ou Podman. Le docteur et le nœud répondaient à deux
 * questions différentes.
 *
 * Pour bubblewrap, la question est donc celle du NŒUD : ouvrir un bac VIDE
 * (`true`, pris dans le système monté), exactement celui de `bacVideRefuse` —
 * un seul propriétaire, le docteur ne peut plus dire autre chose que le
 * preflight. Et elle vaut mieux que `--version`, qui répond même quand le
 * noyau refuse les espaces de noms utilisateur.
 */
export function questionAuMoteur(fournisseur: Fournisseur, cwdVide: string): Enveloppe {
  if (fournisseur.bin !== 'bwrap') return { bin: fournisseur.bin, args: [SONDE_ISOLEMENT] };
  return envelopper('true', [], {
    fournisseur,
    cwdHote: cwdVide,
    variables: [],
    image: IMAGE_DEFAUT,
  });
}

/**
 * L'argument qui touche le SERVICE d'un moteur de conteneurs, et non seulement
 * son client.
 *
 * `docker --version` répond 0 SANS JAMAIS PARLER AU DÉMON — mesuré dans le
 * conteneur où le défaut a été trouvé : `--version` → 0, `info` → 1 « failed
 * to connect to the docker API ». Le docteur affichait alors « ✔ docker » sur
 * un démon arrêté, et la première tâche ratait trois fois. `info` interroge le
 * service ; Podman, sans démon, y répond aussi.
 */
export const SONDE_ISOLEMENT = 'info';

/** Le délai d'une sonde de moteur : il penche du bon côté — trop lent vaut absent. */
export const SONDE_MOTEUR_MS = 5_000;

/** Ce qu'une sonde de moteur sait faire : lancer la question, et dire si elle a réussi. */
export type LanceurDeSonde = (lance: Enveloppe, fournisseur: Fournisseur) => Promise<boolean>;

/**
 * Le lanceur réel : sans aucun secret (`eprouver`), avec, pour un moteur de
 * conteneurs, ce que son client lit (`envMoteur`) — le même environnement que
 * le nœud lui donne.
 */
const lanceurDeSonde: LanceurDeSonde = async (lance, fournisseur) => {
  const r = await eprouver(lance, {
    cwd: tmpdir(),
    timeoutMs: SONDE_MOTEUR_MS,
    ...(fournisseur.bin === 'bwrap' ? {} : { env: envMoteur(fournisseur) }),
  });
  return r.issue === 'sortie' && r.code === 0;
};

/**
 * Tous les moteurs RÉELLEMENT joignables, dans l'ordre de préférence — ce que
 * le docteur et l'installeur annoncent. Le lanceur est injectable pour qu'un
 * banc joue « le client est là, le service ne répond pas » sans démon.
 */
export async function moteursJoignables(
  lancer: LanceurDeSonde = lanceurDeSonde,
): Promise<Fournisseur[]> {
  // Un dossier vide et jetable : c'est le seul que le bac vide de bubblewrap monte.
  const vide = mkdtempSync(join(tmpdir(), 'hive-sonde-moteur-'));
  try {
    const joignables: Fournisseur[] = [];
    for (const f of FOURNISSEURS) {
      if (await lancer(questionAuMoteur(f, vide), f)) joignables.push(f);
    }
    return joignables;
  } finally {
    rmSync(vide, { recursive: true, force: true });
  }
}

export interface ResultatPreflightAgent {
  executable: boolean;
  motif: string;
  /** Une image nommée absente, non téléchargée (`preparerImage` avec `tirer: false`). */
  imageAbsente?: true;
  /** Le moteur tel que l'épreuve l'a appris (`Fournisseur.rootless`), à garder pour la suite. */
  fournisseur?: Fournisseur;
}

/** Ce qu'a rendu une commande d'épreuve lancée dans le bac. */
type IssueEpreuve =
  | { issue: 'impossible' | 'erreur' | 'expiree' }
  | { issue: 'sortie'; code: number | null; erreurs: string; sortie: string };

/** Ce qu'une épreuve garde de ses flux, borné : 2 Kio d'erreurs, 64 Kio de sortie. */
const ERREURS_MAX = 2_048;
const SORTIE_MAX = 64 * 1024;

/**
 * Lance une commande — sans aucun secret dans l'environnement — et rend son
 * issue. `garderErreurs` garde le début de la sortie d'erreur : c'est là que le
 * moteur dit pourquoi il n'a pas pu ouvrir le bac. `garderSortie` garde la
 * sortie standard (les identifiants que rend `ps -q`). Pour un agent sous
 * bubblewrap, les deux restent ignorées : un petit-enfant qui garderait un tube
 * ouvert retiendrait la fin. Sous un moteur de conteneurs, l'arrêt du conteneur
 * emporte tout son espace de processus, et le client ferme ses flux avec lui.
 */
function eprouver(
  lance: Enveloppe,
  opts: {
    cwd: string;
    timeoutMs: number;
    garderErreurs?: boolean;
    garderSortie?: boolean;
    /** Défaut : l'hôte sans ses secrets. Un moteur de conteneurs reçoit `envMoteur`. */
    env?: NodeJS.ProcessEnv;
  },
): Promise<IssueEpreuve> {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (issue: IssueEpreuve): void => {
      if (fini) return;
      fini = true;
      resolve(issue);
    };
    let enfant;
    try {
      enfant = spawn(lance.bin, lance.args, {
        cwd: opts.cwd,
        shell: false,
        windowsHide: true,
        stdio: [
          'ignore',
          opts.garderSortie ? 'pipe' : 'ignore',
          opts.garderErreurs ? 'pipe' : 'ignore',
        ],
        env: opts.env ?? envSonde(process.env),
      });
    } catch {
      finir({ issue: 'impossible' });
      return;
    }
    let erreurs = '';
    let sortie = '';
    enfant.stderr?.on('data', (c: Buffer) => {
      if (erreurs.length < ERREURS_MAX) erreurs += c.toString();
    });
    enfant.stdout?.on('data', (c: Buffer) => {
      if (sortie.length < SORTIE_MAX) sortie += c.toString();
    });
    const minuteur = setTimeout(() => {
      enfant.kill();
      finir({ issue: 'expiree' });
    }, opts.timeoutMs);
    minuteur.unref?.();
    enfant.on('error', () => {
      clearTimeout(minuteur);
      finir({ issue: 'erreur' });
    });
    enfant.on('close', (code) => {
      clearTimeout(minuteur);
      finir({ issue: 'sortie', code, erreurs, sortie });
    });
  });
}

/** La première ligne non vide d'une sortie d'erreur, bornée, pour la citer. */
function premiereLigne(erreurs: string): string {
  return (
    erreurs
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  ).slice(0, 200);
}

/** « (« … ») » quand le moteur a dit quelque chose, rien sinon. */
function citation(erreurs: string): string {
  const dit = premiereLigne(erreurs);
  return dit ? ` (« ${dit} »)` : '';
}

/**
 * Bubblewrap ouvre-t-il un bac VIDE ici ? Rend le motif s'il ne le peut pas.
 *
 * ─── « AGENT ABSENT », QUAND C'ÉTAIT BUBBLEWRAP QUI NE DÉMARRAIT PAS ─────────
 *
 * `trouverFournisseurs` retient bubblewrap sur `bwrap --version`, qui répond
 * même quand le noyau lui refuse les espaces de noms utilisateur — le cas
 * d'Ubuntu 24.04 d'origine (`kernel.apparmor_restrict_unprivileged_userns=1`),
 * mesuré sur le runner `ubuntu-latest` de la CI. Le preflight de l'agent
 * échouait alors, et le nœud disait « agent absent » : l'humain réinstallait
 * un agent bien présent, et `exige` refusait pour une cause fausse.
 *
 * On relance donc le MÊME bac avec `true`, que le système monté fournit :
 * s'il échoue aussi, c'est le bac et non l'agent — et bubblewrap dit lui-même
 * pourquoi sur sa sortie d'erreur, qu'on cite plutôt que de la deviner.
 */
async function bacVideRefuse(
  fournisseur: Fournisseur,
  cwd: string,
  timeoutMs: number,
): Promise<string | null> {
  const r = await eprouver(questionAuMoteur(fournisseur, cwd), {
    cwd,
    timeoutMs,
    garderErreurs: true,
  });
  if (r.issue === 'sortie' && r.code === 0) return null;
  return (
    `bubblewrap n'ouvre pas même un bac vide sur cet hôte${r.issue === 'sortie' ? citation(r.erreurs) : ''} — ` +
    'sous Ubuntu, la cause habituelle est la restriction des espaces de noms utilisateur ' +
    '(kernel.apparmor_restrict_unprivileged_userns=1)'
  );
}

/** Vérifie le nom logique de l'agent dans le bac qui exécutera les tâches. */
export async function sonderAgentDansBac(
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
  const options: OptionsEnveloppe = { fournisseur, cwdHote: probeCwd, variables: [], image };
  const echec = (motif: string): ResultatPreflightAgent => ({ executable: false, motif });
  try {
    let lance: Enveloppe;
    try {
      lance = envelopper(binAgent, ['--version'], options);
    } catch {
      return echec(`preflight impossible via ${fournisseur.nom}`);
    }
    // Un conteneur dit sur sa sortie d'erreur pourquoi il n'a pas démarré
    // (`--init` sans binaire d'init, montage refusé, exécutable introuvable) :
    // la citer vaut mieux que « absent », qui envoyait réinstaller l'agent.
    const conteneur = fournisseur.bin !== 'bwrap';
    const r = await eprouver(lance, {
      cwd: probeCwd,
      timeoutMs,
      garderErreurs: conteneur,
      // Le client du moteur voit ICI ce qu'il verra pour la tâche.
      ...(conteneur ? { env: envMoteur(fournisseur) } : {}),
    });
    if (r.issue === 'impossible') return echec(`preflight impossible via ${fournisseur.nom}`);
    if (r.issue === 'expiree') return echec(`preflight de l'agent expiré via ${fournisseur.nom}`);
    if (r.issue !== 'sortie') {
      return echec(`agent « ${binAgent} » non exécutable via ${fournisseur.nom}`);
    }
    if (r.code === 0)
      return { executable: true, motif: `agent « ${binAgent} » exécutable dans le bac` };
    const bac = conteneur ? null : await bacVideRefuse(fournisseur, probeCwd, timeoutMs);
    return echec(
      bac ?? `agent « ${binAgent} » absent ou non exécutable dans le bac${citation(r.erreurs)}`,
    );
  } finally {
    if (cwdHote === undefined) rmSync(probeCwd, { recursive: true, force: true });
  }
}

/** Le délai de la sonde du réseau : un bac, un relais, une requête locale. */
export const SONDE_RESEAU_MS = 30_000;

/**
 * Ce que la sonde exécute DANS le bac, derrière le relais : aucune interface
 * hors de la boucle (sinon le bac joindrait le réseau sans le proxy), puis une
 * requête au proxy par le relais, qui doit répondre par SON refus — la preuve
 * que le socket a traversé jusqu'au bac. Aucun paquet ne sort de la machine.
 */
const SONDE_RESEAU_JS =
  "const os=require('node:os'),http=require('node:http');" +
  "const autres=Object.keys(os.networkInterfaces()).filter((n)=>n!=='lo');" +
  "if(autres.length>0){process.stderr.write('interfaces '+autres.join(',')+'\\n');process.exit(3);}" +
  'const t=setTimeout(()=>process.exit(6),10000);' +
  `http.get({host:'127.0.0.1',port:${PORT_RELAIS},path:'http://sonde.hive.invalid/',headers:{host:'sonde.hive.invalid'}},` +
  `(r)=>{clearTimeout(t);r.resume();process.exit(r.headers['${ENTETE_REFUS}']==='refus'?0:4);})` +
  ".on('error',(e)=>{process.stderr.write(e.message+'\\n');process.exit(5);});";

/** Ce que la sonde du réseau a établi. */
export interface ResultatSondeReseau {
  filtre: boolean;
  motif: string;
}

/**
 * Le bac de CE moteur sait-il filtrer le réseau ? Éprouvé une fois au
 * démarrage, avec le vrai relais, le vrai proxy et la vraie enveloppe — pas
 * déduit du nom du moteur.
 *
 * ─── POURQUOI UNE SONDE ET NON UNE RÈGLE ────────────────────────────────────
 *
 * Un moteur dans une machine virtuelle (Docker Desktop, `podman machine`, un
 * `DOCKER_HOST` distant) monte le dossier, mais un socket Unix ne traverse pas
 * la VM — le même mur que le pont MCP. Le deviner d'après la plateforme
 * ferait mentir l'annonce dans un sens ou dans l'autre ; le mesurer, non. Et
 * un bubblewrap que le noyau prive d'espaces de noms échoue ici comme au
 * preflight de l'agent, avec les mots du moteur.
 */
export async function sonderReseauFiltre(
  fournisseur: Fournisseur,
  image = IMAGE_DEFAUT,
  timeoutMs = SONDE_RESEAU_MS,
): Promise<ResultatSondeReseau> {
  const rendezVous = new RendezVousPont();
  const tropLong = rendezVous.alerte();
  if (tropLong) return { filtre: false, motif: tropLong };
  // Un preflight comme les autres : même préfixe, donc dans l'inventaire (`empreinte.ts`).
  const vide = mkdtempSync(join(tmpdir(), PREFIXE_PREFLIGHT_AGENT));
  let fermer: (() => Promise<void>) | null = null;
  try {
    const { dossier, extremite } = rendezVous.reserver();
    ecrireRelais(dossier);
    const session = await ouvrirSessionReseau({
      socket: extremite,
      politique: { niveau: 'integrations', hotes: [], passerelles: [] },
    });
    fermer = session.fermer;
    const conteneur = fournisseur.bin !== 'bwrap';
    const node = reel(process.execPath) ?? process.execPath;
    const lance = envelopper(conteneur ? 'node' : node, ['-e', SONDE_RESEAU_JS], {
      fournisseur,
      cwdHote: vide,
      variables: [],
      image,
      reseau: { dossier, socket: extremite, interprete: node, variables: {} },
    });
    const r = await eprouver(lance, {
      cwd: vide,
      timeoutMs,
      garderErreurs: true,
      ...(conteneur ? { env: envMoteur(fournisseur) } : {}),
    });
    if (r.issue === 'sortie' && r.code === 0) {
      return { filtre: true, motif: `réseau filtré par le proxy du nœud via ${fournisseur.nom}` };
    }
    if (r.issue !== 'sortie') {
      return { filtre: false, motif: `sonde du réseau filtré ${r.issue} via ${fournisseur.nom}` };
    }
    const cause =
      r.code === 3
        ? 'le bac garde des interfaces réseau hors de la boucle'
        : r.code === 5 || r.code === 125
          ? 'le socket du proxy ne traverse pas jusqu’au bac (moteur dans une machine virtuelle ?)'
          : r.code === 4
            ? 'le proxy n’a pas répondu par son refus'
            : `la sonde est sortie en ${r.code}`;
    return {
      filtre: false,
      motif: `réseau NON filtrable via ${fournisseur.nom} : ${cause}${citation(r.erreurs)}`,
    };
  } catch (err) {
    return {
      filtre: false,
      motif: `proxy du nœud impossible à ouvrir (${err instanceof Error ? err.message : String(err)})`,
    };
  } finally {
    await fermer?.();
    rendezVous.fermer();
    rmSync(vide, { recursive: true, force: true });
  }
}

/** Le délai d'un `image inspect` : une lecture locale, que seul un moteur injoignable fait durer. */
export const INSPECTION_MAX_MS = 15_000;
/** Le délai d'un téléchargement d'image : quelques centaines de Mo, sur une ligne ordinaire. */
export const TELECHARGEMENT_MAX_MS = 10 * 60_000;

/**
 * Ce que disent Docker (« No such image », « No such object » avant la 20.10)
 * et Podman (« image not known », « failed to find image ») d'une image absente.
 *
 * ─── PAS DE « NOT FOUND » NU ─────────────────────────────────────────────────
 *
 * `not found` et `does not exist` figuraient ici. Or un moteur qui ne se joint
 * pas le dit souvent avec ces mots — `context "typo": context not found`, une
 * couche introuvable du stockage — et le nœud envoyait alors RECONSTRUIRE une
 * image peut-être présente (ou en tirait une), en taisant la vraie panne. Tout
 * ce qui n'est pas l'absence de l'image va à la branche « injoignable », qui
 * cite le moteur.
 */
const IMAGE_ABSENTE_RE = /no such image|no such object|image not known|failed to find image/i;

/** La commande qui construit `IMAGE_DEFAUT` dans CE moteur. */
export function commandeImage(fournisseur: Fournisseur): string {
  return `${COMMANDE_IMAGE}${fournisseur.nom === 'docker' ? ' -- --moteur docker' : ''}`;
}

/** Ce qu'un moteur dit d'une image : là, absente, ou rien d'exploitable. */
export type EtatImage =
  { etat: 'presente' } | { etat: 'absente' } | { etat: 'injoignable'; motif: string };

/**
 * `image inspect`, sans rien lancer ni télécharger. Partagé par le nœud
 * (`preparerImage`), le docteur et l'installeur : les trois jugent l'image par
 * la même question, et un « prêt » affiché ne peut plus contredire le nœud.
 */
export async function inspecterImage(
  fournisseur: Fournisseur,
  image: string,
  timeoutMs = INSPECTION_MAX_MS,
): Promise<EtatImage> {
  const r = await eprouver(
    { bin: fournisseur.bin, args: ['image', 'inspect', '--format', '{{.Id}}', image] },
    { cwd: tmpdir(), timeoutMs, garderErreurs: true, env: envMoteur(fournisseur) },
  );
  if (r.issue === 'sortie' && r.code === 0) return { etat: 'presente' };
  if (r.issue !== 'sortie') {
    return {
      etat: 'injoignable',
      motif: `${fournisseur.nom} ne répond pas (inspection de l'image ${r.issue})`,
    };
  }
  // Démon arrêté, socket refusée, contexte inconnu, stockage illisible : le
  // moteur répond à `--version` mais ne sait rien dire de ses images.
  if (!IMAGE_ABSENTE_RE.test(r.erreurs)) {
    return { etat: 'injoignable', motif: `${fournisseur.nom} injoignable${citation(r.erreurs)}` };
  }
  return { etat: 'absente' };
}

/**
 * Le premier moteur PRÊT pour `image`, dans l'ordre donné — bubblewrap n'a pas
 * d'image, il l'est d'office — et le premier où elle est absente.
 *
 * C'est la règle du nœud (`choisirMoteur`) sans le preflight de l'agent : le
 * docteur et l'installeur ne peuvent plus annoncer « ✔ docker » sur la seule
 * foi d'un `--version` ou d'un `info`, quand le nœud écartera ce moteur faute
 * d'image et se repliera en processus.
 */
export async function moteurPret(
  moteurs: readonly Fournisseur[],
  image: string,
  inspecter: typeof inspecterImage = inspecterImage,
): Promise<{ pret: Fournisseur | null; absente: Fournisseur | null }> {
  let absente: Fournisseur | null = null;
  for (const f of moteurs) {
    if (f.bin === 'bwrap') return { pret: f, absente };
    const r = await inspecter(f, image);
    if (r.etat === 'presente') return { pret: f, absente };
    if (r.etat === 'absente') absente ??= f;
  }
  return { pret: null, absente };
}

/**
 * L'image est-elle là, dans CE moteur — et sinon, pourquoi ? Rend un motif qui
 * distingue les trois pannes que le preflight confondait.
 *
 * ─── « AGENT ABSENT », QUAND C'ÉTAIT L'IMAGE — OU LE MOTEUR ─────────────────
 *
 * Le preflight lançait directement `<moteur> run <image> <agent> --version`
 * sous 30 s. Une image absente déclenchait alors un téléchargement COMPRIS dans
 * ces 30 s : au premier démarrage, il expirait, et le nœud disait « agent
 * absent ». Un démon Docker arrêté donnait le même message. Et chaque moteur a
 * son propre magasin d'images : l'image construite par Docker n'existe pas pour
 * Podman.
 *
 * On inspecte donc d'abord, sans rien lancer. Absente, l'image par défaut
 * n'est JAMAIS tirée d'un registre (voir `IMAGE_DEFAUT`) : le motif donne la
 * commande qui la construit. Une image nommée par l'opérateur est téléchargée
 * sous son PROPRE délai, annoncé à l'humain avant de commencer — sauf
 * `tirer: false`, qui rend `imageAbsente` : le nœud cherche d'abord si un
 * AUTRE moteur l'a déjà (`choisirMoteur`) avant d'en tirer une copie. L'épreuve
 * de l'agent qui suit (`--pull=never`) ne mesure plus que l'agent.
 */
export async function preparerImage(
  fournisseur: Fournisseur,
  image: string,
  opts: {
    informer?: (ligne: string) => void;
    inspectionMs?: number;
    telechargementMs?: number;
    /** Défaut : oui. `false` : une image nommée absente n'est pas téléchargée. */
    tirer?: boolean;
  } = {},
): Promise<ResultatPreflightAgent> {
  const echec = (motif: string): ResultatPreflightAgent => ({ executable: false, motif });
  const inspection = await inspecterImage(fournisseur, image, opts.inspectionMs);
  if (inspection.etat === 'presente') {
    return preparerIdentite(fournisseur, image, opts, `image présente dans ${fournisseur.nom}`);
  }
  if (inspection.etat === 'injoignable') return echec(inspection.motif);
  if (image === IMAGE_DEFAUT) {
    return echec(
      `image absente de ${fournisseur.nom} — construisez-la depuis un clone du dépôt : ` +
        commandeImage(fournisseur),
    );
  }
  if (opts.tirer === false) {
    return {
      executable: false,
      motif: `image ${image} absente de ${fournisseur.nom}`,
      imageAbsente: true,
    };
  }
  const delai = opts.telechargementMs ?? TELECHARGEMENT_MAX_MS;
  (opts.informer ?? console.log)(
    `   Téléchargement de l'image ${image} via ${fournisseur.nom} ` +
      `(jusqu'à ${Math.round(delai / 60_000)} min)…`,
  );
  const tirage = await eprouver(
    { bin: fournisseur.bin, args: ['pull', image] },
    { cwd: tmpdir(), timeoutMs: delai, garderErreurs: true, env: envTelechargement(fournisseur) },
  );
  if (tirage.issue === 'sortie' && tirage.code === 0) {
    return preparerIdentite(fournisseur, image, opts, `image téléchargée dans ${fournisseur.nom}`);
  }
  if (tirage.issue === 'expiree') {
    return echec(
      `téléchargement de l'image toujours en cours après ${Math.round(delai / 60_000)} min — ` +
        `terminez-le (${fournisseur.bin} pull ${image}) puis relancez le nœud`,
    );
  }
  return echec(
    `image introuvable pour ${fournisseur.nom}${tirage.issue === 'sortie' ? citation(tirage.erreurs) : ''}`,
  );
}

/** Au-delà de ce délai, une préparation silencieuse se dit : l'humain ne voit plus un nœud figé. */
const PREPARATION_ANNONCEE_MS = 3_000;

/**
 * Podman rootless : prépare, UNE fois par image, la copie de ses couches à
 * l'UID du nœud — hors du délai du preflight de l'agent.
 *
 * ─── LE PREMIER `--userns=keep-id` COPIE L'IMAGE ─────────────────────────────
 *
 * Sans montages à identifiants traduits, Podman rootless réécrit la propriété
 * de chaque couche pour l'espace de noms de `keep-id` au premier lancement,
 * puis la garde en cache. Mesuré en CI (Podman 4.9, image des agents) : plus
 * que les 30 s du preflight de l'agent, qui expirait — « preflight expiré »,
 * repli en processus, et un nœud qui ne s'isolait qu'au démarrage SUIVANT. La
 * préparation se fait donc ici, sous le délai d'un téléchargement ; elle est
 * annoncée si elle dure. Une autre panne que l'expiration n'est pas jugée ici :
 * le preflight de l'agent, qui suit, la dira avec les mots du moteur.
 *
 * ─── LE MÊME BAC QUE LA TÂCHE, PAS UN `run` NU ───────────────────────────────
 *
 * La préparation lançait `run --rm --userns=keep-id <image> true` : l'image —
 * nommée par l'opérateur, pas encore jugée — tournait une fois avec les
 * capacités, sans `no-new-privileges` ni racine en lecture seule. Elle passe
 * maintenant par `envelopper`, comme le preflight et la tâche : le seul
 * lancement qui précède le preflight a exactement les murs du bac. *
 * ─── ROOTLESS SELON LE MOTEUR, PAS SELON L'HÔTE ──────────────────────────────
 *
 * `keep-id` suivait l'UID du nœud. Or un podman-remote vers une machine
 * rootful (macOS, Windows, `CONTAINER_HOST`) le refuse — « keep-id is only
 * supported in rootless mode » : chaque preflight échouait, et un poste qui
 * s'isolait avant retombait en processus. Le moteur est interrogé ici, une
 * fois ; ce qu'il dit voyage avec le moteur retenu (`fournisseur` du résultat)
 * jusqu'aux preflights et aux tâches.
 */
async function preparerIdentite(
  moteur: Fournisseur,
  image: string,
  opts: { informer?: (ligne: string) => void; telechargementMs?: number },
  motif: string,
): Promise<ResultatPreflightAgent> {
  if (moteur.nom !== 'podman') return { executable: true, motif };
  const rootless = await moteurRootless(moteur);
  const fournisseur = rootless === null ? moteur : { ...moteur, rootless };
  const appris = rootless === null ? {} : { fournisseur };
  if (!keepId(fournisseur)) return { executable: true, motif, ...appris };
  const delai = opts.telechargementMs ?? TELECHARGEMENT_MAX_MS;
  const annonce = setTimeout(
    () =>
      (opts.informer ?? console.log)(
        `   Préparation de l'image ${image} pour l'UID de ce nœud (podman --userns=keep-id, ` +
          `une fois par image, jusqu'à ${Math.round(delai / 60_000)} min)…`,
      ),
    PREPARATION_ANNONCEE_MS,
  );
  annonce.unref?.();
  // Un dossier vide et jetable : rien de l'hôte n'a à être visible.
  const vide = mkdtempSync(join(tmpdir(), 'hive-keep-id-'));
  try {
    const r = await eprouver(
      envelopper('true', [], { fournisseur, cwdHote: vide, variables: [], image }),
      { cwd: vide, timeoutMs: delai, env: envMoteur(fournisseur) },
    );
    if (r.issue === 'expiree') {
      return {
        executable: false,
        motif:
          `préparation de l'image pour l'UID de ce nœud toujours en cours après ` +
          `${Math.round(delai / 60_000)} min (podman --userns=keep-id) — relancez le nœud`,
      };
    }
    return { executable: true, motif, ...appris };
  } finally {
    clearTimeout(annonce);
    rmSync(vide, { recursive: true, force: true });
  }
}

/**
 * Le moteur Podman tourne-t-il sans root ? Sa propre réponse
 * (`podman info`) — `null` s'il ne la donne pas : on ne l'invente pas.
 */
async function moteurRootless(fournisseur: Fournisseur): Promise<boolean | null> {
  const r = await eprouver(
    {
      bin: fournisseur.bin,
      args: ['info', '--format', '{{.Host.Security.Rootless}}'],
    },
    {
      cwd: tmpdir(),
      timeoutMs: INSPECTION_MAX_MS,
      garderSortie: true,
      env: envMoteur(fournisseur),
    },
  );
  if (r.issue !== 'sortie' || r.code !== 0) return null;
  const dit = r.sortie.trim();
  return dit === 'true' ? true : dit === 'false' ? false : null;
}

/**
 * Supprime les conteneurs qu'un lancement PRÉCÉDENT de ce nœud a laissés.
 *
 * ─── UN NŒUD TUÉ LAISSAIT SON AGENT TOURNER ──────────────────────────────────
 *
 * `--rm` ne supprime un conteneur qu'à la fin de son client `docker run`. Un
 * nœud tué net (kill -9, panne de courant, OOM) emporte le client, pas le
 * conteneur : l'agent continuait d'écrire dans l'atelier et de dépenser des
 * crédits, pendant que la Reine rendait la tâche à un autre nœud. Deux agents
 * sur une tâche, dont un que plus personne ne regarde.
 *
 * Chaque conteneur porte l'étiquette de son nœud (`ETIQUETTE_NOEUD`) ; l'identité
 * d'un nœud survit à son redémarrage (`identiteStable`). Au démarrage, AVANT de
 * prendre du travail, le nœud supprime donc tout conteneur qui porte la sienne :
 * aucun ne peut être à lui et légitime, puisqu'il n'a encore rien lancé.
 *
 * Les lancements du démarrage lui-même — la préparation `keep-id` (`true`),
 * les preflights (`--version`) — ne portent pas d'étiquette, et c'est voulu :
 * ils finissent d'eux-mêmes, et `--rm` est tenu par le moteur (démon Docker,
 * `conmon` de Podman), pas par le client qu'un kill -9 emporterait. Seul un
 * agent au travail survit à son nœud.
 *
 * Rend les identifiants supprimés, `injoignable` quand le client répond mais
 * pas son moteur, ou un motif quand le moteur n'a pas pu dire ou supprimer.
 */
export async function ramasserConteneurs(
  fournisseur: Fournisseur,
  noeud: string,
  timeoutMs = INSPECTION_MAX_MS,
): Promise<{ supprimes: string[] } | { injoignable: string } | { motif: string }> {
  if (fournisseur.bin === 'bwrap') return { supprimes: [] }; // `--die-with-parent`
  const cwd = tmpdir();
  const liste = await eprouver(
    {
      bin: fournisseur.bin,
      args: ['ps', '--all', '--quiet', `--filter=label=${ETIQUETTE_NOEUD}=${noeud}`],
    },
    { cwd, timeoutMs, garderErreurs: true, garderSortie: true, env: envMoteur(fournisseur) },
  );
  if (liste.issue !== 'sortie') {
    return {
      motif: `${fournisseur.nom} n'a pas listé les conteneurs de ce nœud (${liste.issue})`,
    };
  }
  if (liste.code !== 0) {
    // Le client a répondu, son moteur non (démon arrêté, Docker Desktop
    // éteint) : pas une panne à signaler en rouge à chaque démarrage.
    return { injoignable: `${fournisseur.nom} injoignable${citation(liste.erreurs)}` };
  }
  const ids = [...new Set(liste.sortie.split(/\s+/).filter((id) => /^[0-9a-f]{12,64}$/.test(id)))];
  if (ids.length === 0) return { supprimes: [] };
  const rm = await eprouver(
    { bin: fournisseur.bin, args: ['rm', '--force', ...ids] },
    { cwd, timeoutMs, garderErreurs: true, env: envMoteur(fournisseur) },
  );
  if (rm.issue !== 'sortie' || rm.code !== 0) {
    const dit = rm.issue === 'sortie' ? citation(rm.erreurs) : ` (${rm.issue})`;
    return {
      motif: `${fournisseur.nom} n'a pas supprimé ${ids.length} conteneur(s) orphelin(s)${dit}`,
    };
  }
  return { supprimes: ids };
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
