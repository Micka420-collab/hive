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
// niveau) ; la seule impureté est la SONDE, qui lance `--version`.

import { spawn } from 'node:child_process';

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
 * Image utilisée par les moteurs de conteneurs.
 *
 * Volontairement une image de base Node officielle et rien de plus : une image
 * maison serait un artefact de plus à construire, publier, signer et tenir à
 * jour — c'est-à-dire trois occasions supplémentaires de livrer une faille.
 * L'agent lui-même est monté depuis l'hôte, pas cuit dans l'image.
 */
export const IMAGE_DEFAUT = 'docker.io/library/node:20-slim';

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
  const args = [
    'run',
    '--rm',
    // Pas de TTY, pas d'entrée interactive : l'agent est piloté par argv.
    '--interactive=false',

    // ── Ce qui est visible ─────────────────────────────────────────────────
    // LE SEUL montage. Pas de $HOME, pas de ~/.ssh, pas de socket de démon.
    `--volume=${opts.cwdHote}:${MONTAGE}:rw`,
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
    `--user=${opts.uid ?? 1000}:${opts.uid ?? 1000}`,

    // ── Ce qui est borné ───────────────────────────────────────────────────
    // Une bombe à fork n'emporte pas la machine du membre.
    `--pids-limit=${PROCESSUS_MAX}`,
    `--memory=${MEMOIRE_MAX}`,
    `--cpus=${CPU_MAX}`,
  ];

  // Les secrets passent par leur NOM seul : jamais dans la ligne de commande.
  for (const nom of opts.variables) args.push(`--env=${nom}`);

  args.push(opts.image ?? IMAGE_DEFAUT, bin, ...argsAgent);
  return { bin: opts.fournisseur.bin, args };
}

/**
 * Bubblewrap : pas de démon, pas d'image, pas de cgroups.
 *
 * On reconstruit un système minimal en LECTURE SEULE à partir de celui de
 * l'hôte (l'agent a besoin de son interpréteur et de ses bibliothèques), et on
 * n'ouvre en écriture que le répertoire de la tâche.
 */
function enveloppeBwrap(
  bin: string,
  argsAgent: readonly string[],
  opts: OptionsEnveloppe,
): Enveloppe {
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
    '--ro-bind-try',
    '/etc/ssl',
    '/etc/ssl',
    '--ro-bind-try',
    '/etc/resolv.conf',
    '/etc/resolv.conf',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',

    // LE SEUL chemin inscriptible.
    '--bind',
    opts.cwdHote,
    MONTAGE,
    '--chdir',
    MONTAGE,

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
      enfant = spawn(bin, ['--version'], { shell: false, windowsHide: true, stdio: 'ignore' });
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
