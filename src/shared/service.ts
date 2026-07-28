// Le service : faire survivre la ruche à une déconnexion et à un redémarrage.
//
// ─── CE QUE L'ADR 0004 A TRANCHÉ, ET QUE CE MODULE EXÉCUTE ───────────────────
//
// Une ruche qui tient des semaines doit redémarrer toute seule. Mais
// l'installeur promet par ailleurs de ne rien poser sur la machine sans qu'on
// le lui demande. D'où :
//
//   · le service est OPT-IN. Rien ne s'installe à l'insu de personne ;
//   · le niveau UTILISATEUR est le défaut — `systemd --user`, un `LaunchAgent`,
//     une tâche planifiée à l'ouverture de session. Aucun droit administrateur ;
//   · le niveau SYSTÈME existe, il est documenté, et il n'est JAMAIS choisi à
//     la place de quelqu'un ;
//   · `service uninstall` retire EXACTEMENT ce que `service install` a posé.
//     Jamais le `.env`, jamais la base. Un outil d'installation n'est pas un
//     outil de destruction.
//
// ─── LE PIÈGE QUE CE MODULE EXISTE POUR FERMER ───────────────────────────────
//
// `src/orchestrator/main.ts` fait `process.loadEnvFile('.env')` — un chemin
// RELATIF — et avale l'échec dans un `catch`. Un service lancé depuis le
// mauvais répertoire démarre donc « avec succès », sans `HIVE_TOKEN`, sans
// `HIVE_JWT_SECRET`, sur des valeurs par défaut. Il tourne, il écoute, et il
// n'est la ruche de personne.
//
// Les trois plans posent donc un répertoire de travail EXPLICITE, et un test
// l'exige des trois — c'est la garde la plus importante de ce fichier.
//
// ─── PUR ─────────────────────────────────────────────────────────────────────
//
// Aucune écriture, aucun `spawn`, aucun `process.platform` lu au passage. La
// plateforme est un paramètre : c'est ce qui rend le plist de macOS et le XML
// de Windows vérifiables depuis Linux, à chaque CI (§ 6.3 de
// `docs/ERREURS.md`).

import path from 'node:path';

/** Où le service vit, et à quel prix. */
export type Niveau =
  /** Aucun droit administrateur. S'arrête à la fermeture de session (voir `AVERTISSEMENT_LINGER`). */
  | 'utilisateur'
  /** Survit à la déconnexion, réclame l'administrateur. Jamais un défaut. */
  | 'systeme';

/** Ce qu'on fait tourner. */
export type Cible =
  /** L'orchestrateur — la ruche elle-même. */
  | 'ruche'
  /** Un nœud qui prête du temps-machine à la ruche de quelqu'un d'autre. */
  | 'noeud';

/** Une commande à lancer, décomposée : jamais une chaîne à faire passer par un shell. */
export interface Commande {
  readonly bin: string;
  readonly args: readonly string[];
  /** Ce que ça fait, en français, pour l'afficher avant de le lancer. */
  readonly quoi: string;
}

/** Le fichier de service à poser. */
export interface Fichier {
  readonly chemin: string;
  readonly contenu: string;
  /**
   * `0o600` partout où le fichier peut porter un chemin d'environnement.
   *
   * Le contenu ne porte pas de secret — il DÉSIGNE le `.env`, il ne le recopie
   * pas. Mais un fichier de service lisible par tous annonce à qui veut où
   * vivent la base et les jetons, ce qui n'aide personne.
   */
  readonly mode: number;
}

export interface Plan {
  readonly genre: 'plan';
  /** L'identifiant du service sur cette plateforme. */
  readonly nom: string;
  readonly fichier: Fichier;
  /** À lancer APRÈS avoir écrit le fichier. */
  readonly installer: readonly Commande[];
  /** À lancer AVANT de supprimer le fichier — arrêter, puis désinscrire. */
  readonly desinstaller: readonly Commande[];
  readonly statut: Commande;
  readonly journal: Commande;
  /** Ce qu'il faut savoir AVANT, pas découvrir après. */
  readonly avertissements: readonly string[];
}

export interface Refus {
  readonly genre: 'refus';
  readonly motif: string;
}

export interface Contexte {
  readonly plateforme: NodeJS.Platform;
  readonly niveau: Niveau;
  readonly cible: Cible;
  /** La racine de l'installation. Absolue. */
  readonly racine: string;
  /** `process.execPath` — le vrai binaire Node, jamais « node » tout court. */
  readonly execNode: string;
  /** `os.homedir()`. */
  readonly home: string;
}

/**
 * La limite de `systemd --user` qu'il faut dire À L'INSTALLATION.
 *
 * Sans `enable-linger`, l'unité s'arrête à la fermeture de session. C'est le
 * comportement documenté de systemd, et c'est quand même un bug d'accueil :
 * une ruche qui s'éteint sans raison apparente, la nuit, chez quelqu'un qui
 * croyait l'avoir installée pour de bon.
 */
export const AVERTISSEMENT_LINGER =
  'Un service `systemd --user` s’arrête à la fermeture de votre session. ' +
  'Pour qu’il survive :\n    loginctl enable-linger $USER';

/**
 * La grammaire de chemins de la plateforme VISÉE, pas de celle qui exécute.
 *
 * Sans ça, le plist de macOS et le XML de Windows calculés depuis Linux
 * porteraient des `/` — et un test qui les vérifie croirait vérifier la forme
 * Windows en vérifiant la sienne. C'est le § 6.3, et c'est exactement ce que
 * `empreinte.ts` fait déjà.
 */
function chemins(plateforme: NodeJS.Platform): typeof path.posix {
  return plateforme === 'win32' ? path.win32 : path.posix;
}

/** Le point d'entrée à lancer, selon ce qu'on fait tourner. */
export function scriptDe(cible: Cible): string {
  return cible === 'ruche'
    ? path.posix.join('dist', 'orchestrator', 'main.js')
    : path.posix.join('dist', 'node-client', 'main.js');
}

/**
 * Une valeur dans un fichier d'unité systemd.
 *
 * ─── DEUX PIÈGES, ET LE SECOND N'EST PAS CONNU ───────────────────────────────
 *
 * 1. systemd DÉCOUPE `ExecStart` sur les espaces. Un chemin d'installation
 *    contenant une espace donnerait deux arguments. On cite donc en `"…"`, en
 *    échappant `\` et `"` à l'intérieur.
 *
 * 2. `%` est le caractère de SPÉCIFICATEUR de systemd : `%h` devient le home,
 *    `%i` le nom d'instance… Un chemin contenant un `%` serait silencieusement
 *    réécrit en autre chose. Il se double.
 *
 * Le second est celui qu'on ne voit pas venir, parce qu'il n'échoue pas : il
 * remplace.
 */
export function citerSystemd(valeur: string): string {
  const echappe = valeur.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
  return `"${echappe}"`;
}

/**
 * Un texte dans un document XML — plist de launchd, tâche planifiée de Windows.
 *
 * Le chemin d'installation vient de l'utilisateur. Un `&` ou un `<` dedans
 * casse le document ; une balise entière dedans le RÉÉCRIT. C'est une
 * injection, pas une coquille : ce document décrit ce que la machine lancera
 * au démarrage.
 */
export function echapperXml(valeur: string): string {
  return valeur
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const LIBELLE: Record<Cible, string> = {
  ruche: 'Hive — la ruche',
  noeud: 'Hive — un nœud',
};

/**
 * Le nom du service, sans caractère qui demanderait une citation quelque part.
 *
 * macOS veut un identifiant en domaine inversé ; Linux et Windows prennent le
 * nom nu. (La loupe a fait survivre un `if (plateforme === 'win32') return
 * base;` ici : ses deux branches rendaient la même chose. Une variante qui ne
 * peut pas se distinguer se RETIRE, elle ne se teste pas — § 6.2.)
 */
export function nomDe(cible: Cible, plateforme: NodeJS.Platform): string {
  if (plateforme === 'darwin') return `fr.hive.${cible}`;
  return cible === 'ruche' ? 'hive-ruche' : 'hive-noeud';
}

/**
 * Le rendu d'une suite de gestes, pour un humain.
 *
 * Pur, et à part, parce que la branche « cette commande a échoué » ne peut pas
 * s'exercer depuis un test : lancer un vrai `service uninstall` DÉSINSTALLERAIT
 * le service de qui fait tourner la suite. Extraire le rendu est la seule façon
 * de le couvrir sans toucher à la machine de quelqu'un.
 */
/**
 * Ce que `hive service logs` doit rendre comme code de sortie.
 *
 * ─── POURQUOI UNE FONCTION POUR UNE COMPARAISON ─────────────────────────────
 *
 * Les codes de sortie de ce projet sont une INTERFACE PUBLIQUE
 * (`src/codes-sortie.ts`) : un script de supervision s'en sert pour distinguer
 * « le journal est vide » de « je n'ai pas pu lire le journal ».
 *
 * Et cette ligne-là ne s'éprouve pas de bout en bout : selon la machine,
 * `journalctl` réussit, échoue faute de bus de session, ou n'existe pas. Un
 * test qui fixerait un code serait vrai ici et faux ailleurs. La loupe l'a
 * signalé, à raison ; la sortir du câblage est la seule façon de la couvrir
 * sans mentir sur ce qu'on vérifie.
 */
export function codeJournal(codeDuJournal: number, codeErreur: number): number {
  return codeDuJournal === 0 ? 0 : codeErreur;
}

export function rendreGestes(issues: readonly { code: number; quoi: string }[]): string[] {
  return issues.map((i) => `  ${i.code === 0 ? '✔' : '·'} ${i.quoi}`);
}

function planLinux(ctx: Contexte): Plan | Refus {
  const p = chemins('linux');
  const nom = nomDe(ctx.cible, 'linux');
  const script = p.join(ctx.racine, ...scriptDe(ctx.cible).split('/'));
  const utilisateur = ctx.niveau === 'utilisateur';

  const chemin = utilisateur
    ? p.join(ctx.home, '.config', 'systemd', 'user', `${nom}.service`)
    : p.join('/etc', 'systemd', 'system', `${nom}.service`);

  // Le durcissement du § 7.3.2 de la mission. `ProtectSystem=strict` rend TOUT
  // le système de fichiers en lecture seule ; `ReadWritePaths` rouvre la seule
  // chose qui doit être inscriptible — le dossier de l'installation, où vivent
  // la base, les miroirs et les espaces de travail.
  const contenu = [
    '[Unit]',
    `Description=${LIBELLE[ctx.cible]}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${citerSystemd(ctx.racine)}`,
    `ExecStart=${citerSystemd(ctx.execNode)} ${citerSystemd(script)}`,
    // `-` en tête : le service démarre même sans `.env`. C'est délibéré — la
    // ruche sait se plaindre elle-même, mieux que systemd ne le ferait.
    `EnvironmentFile=-${citerSystemd(p.join(ctx.racine, '.env'))}`,
    'Restart=on-failure',
    'RestartSec=5',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'ProtectSystem=strict',
    'ProtectHome=read-only',
    `ReadWritePaths=${citerSystemd(ctx.racine)}`,
    'ProtectKernelTunables=true',
    'ProtectKernelModules=true',
    'ProtectControlGroups=true',
    'RestrictSUIDSGID=true',
    'LockPersonality=true',
    '',
    '[Install]',
    utilisateur ? 'WantedBy=default.target' : 'WantedBy=multi-user.target',
    '',
  ].join('\n');

  const sc = (...args: string[]): Commande => ({
    bin: 'systemctl',
    args: utilisateur ? ['--user', ...args] : ['--system', ...args],
    quoi: `systemctl ${utilisateur ? '--user ' : ''}${args.join(' ')}`,
  });

  return {
    genre: 'plan',
    nom,
    fichier: { chemin, contenu, mode: 0o600 },
    installer: [sc('daemon-reload'), sc('enable', '--now', `${nom}.service`)],
    desinstaller: [sc('disable', '--now', `${nom}.service`)],
    statut: sc('status', '--no-pager', `${nom}.service`),
    journal: {
      bin: 'journalctl',
      args: utilisateur
        ? ['--user', '-u', `${nom}.service`, '-n', '200', '--no-pager']
        : ['-u', `${nom}.service`, '-n', '200', '--no-pager'],
      quoi: 'journalctl',
    },
    avertissements: utilisateur
      ? [AVERTISSEMENT_LINGER]
      : [
          'Ce niveau réclame l’administrateur : les commandes ci-dessous sont à lancer avec `sudo`.',
        ],
  };
}

function planMacos(ctx: Contexte): Plan | Refus {
  const p = chemins('darwin');
  const nom = nomDe(ctx.cible, 'darwin');
  const script = p.join(ctx.racine, ...scriptDe(ctx.cible).split('/'));
  const utilisateur = ctx.niveau === 'utilisateur';

  const chemin = utilisateur
    ? p.join(ctx.home, 'Library', 'LaunchAgents', `${nom}.plist`)
    : p.join('/Library', 'LaunchDaemons', `${nom}.plist`);

  const journaux = p.join(ctx.racine, 'data', 'service.log');

  // `KeepAlive`/`SuccessfulExit=false` est l'équivalent launchd de
  // `Restart=on-failure` : on relance si le processus meurt mal, PAS s'il
  // s'arrête proprement — sans quoi un `hive` arrêté à la main repartirait
  // aussitôt, ce qui donne l'impression d'un logiciel qu'on ne peut pas éteindre.
  const contenu = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
      '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${echapperXml(nom)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${echapperXml(ctx.execNode)}</string>`,
    `    <string>${echapperXml(script)}</string>`,
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${echapperXml(ctx.racine)}</string>`,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>StandardOutPath</key>',
    `  <string>${echapperXml(journaux)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${echapperXml(journaux)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');

  const lc = (...args: string[]): Commande => ({
    bin: 'launchctl',
    args,
    quoi: `launchctl ${args.join(' ')}`,
  });

  return {
    genre: 'plan',
    nom,
    fichier: { chemin, contenu, mode: 0o600 },
    installer: [lc('load', '-w', chemin)],
    desinstaller: [lc('unload', '-w', chemin)],
    statut: lc('list', nom),
    journal: {
      bin: 'tail',
      args: ['-n', '200', journaux],
      quoi: `tail ${journaux}`,
    },
    avertissements: utilisateur
      ? [
          'Un `LaunchAgent` tourne quand vous êtes connecté. Pour un service qui ' +
            'tourne sans session ouverte, il faut un `LaunchDaemon` — niveau système.',
        ]
      : [
          'Ce niveau réclame l’administrateur : les commandes ci-dessous sont à lancer avec `sudo`.',
        ],
  };
}

function planWindows(ctx: Contexte): Plan | Refus {
  if (ctx.niveau === 'systeme') {
    return {
      genre: 'refus',
      motif:
        'Un vrai service Windows (`sc.exe`, NSSM) réclame l’administrateur et une ' +
        'enveloppe que Hive ne fournit pas. Restez sur le niveau utilisateur : la ' +
        'tâche planifiée à l’ouverture de session ne demande aucun droit, et c’est ' +
        'ce que veut la quasi-totalité des installations.',
    };
  }

  const p = chemins('win32');
  const nom = nomDe(ctx.cible, 'win32');
  const script = p.join(ctx.racine, ...scriptDe(ctx.cible).split('/'));
  const chemin = p.join(ctx.racine, 'data', `${nom}.xml`);

  // ─── POURQUOI DU XML ET PAS `schtasks /SC ONLOGON /TR "…"` ─────────────────
  //
  // `/TR` prend UNE chaîne, que le planificateur redécoupe avec ses propres
  // règles. Un chemin d'installation avec une espace y devient deux arguments,
  // et il n'existe pas de citation qui marche dans tous les cas.
  //
  // Le XML sépare l'exécutable de ses arguments par CONSTRUCTION. Il reste à
  // l'échapper — c'est ce que `echapperXml` fait, et un test lui donne des
  // chemins hostiles.
  const contenu = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${echapperXml(LIBELLE[ctx.cible])}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <LogonTrigger>',
    '      <Enabled>true</Enabled>',
    '    </LogonTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <LogonType>InteractiveToken</LogonType>',
    // JAMAIS `HighestAvailable` : la tâche tourne avec les droits ordinaires
    // de la personne. Une ruche n'a aucune raison d'être administrateur.
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <RestartOnFailure>',
    '      <Interval>PT1M</Interval>',
    '      <Count>3</Count>',
    '    </RestartOnFailure>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${echapperXml(ctx.execNode)}</Command>`,
    `      <Arguments>${echapperXml(script)}</Arguments>`,
    `      <WorkingDirectory>${echapperXml(ctx.racine)}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
    '',
  ].join('\r\n');

  const st = (...args: string[]): Commande => ({
    bin: 'schtasks',
    args,
    quoi: `schtasks ${args.join(' ')}`,
  });

  return {
    genre: 'plan',
    nom,
    fichier: { chemin, contenu, mode: 0o600 },
    installer: [st('/Create', '/TN', nom, '/XML', chemin, '/F'), st('/Run', '/TN', nom)],
    desinstaller: [st('/End', '/TN', nom), st('/Delete', '/TN', nom, '/F')],
    statut: st('/Query', '/TN', nom, '/V', '/FO', 'LIST'),
    journal: {
      bin: 'powershell',
      args: [
        '-NoProfile',
        '-Command',
        `Get-WinEvent -LogName Microsoft-Windows-TaskScheduler/Operational -MaxEvents 200`,
      ],
      quoi: 'Get-WinEvent (journal du planificateur)',
    },
    avertissements: [
      'La tâche démarre à VOTRE ouverture de session : elle ne tourne pas tant que ' +
        'personne ne s’est connecté après un redémarrage. Un vrai service Windows le ' +
        'ferait, au prix des droits administrateur — et Hive ne le pose pas à votre place.',
    ],
  };
}

/**
 * Ce qu'il faudrait faire pour installer le service — sans rien faire.
 *
 * Le fichier, les commandes, et ce qu'il faut savoir avant. La moitié impure
 * (`src/service-reel.ts`) se contente d'exécuter ce plan.
 */
export function planifier(ctx: Contexte): Plan | Refus {
  // ─── ON REFUSE PLUTÔT QUE D'ÉCHAPPER L'INÉCHAPPABLE ────────────────────────
  //
  // Un retour à la ligne dans le chemin d'installation AJOUTE UNE DIRECTIVE à
  // l'unité systemd. La citation n'y peut rien : le format d'unité termine une
  // directive à la fin de ligne, guillemets ou pas.
  //
  // Trouvé par le test qui donne des chemins hostiles au planificateur — pas
  // par relecture. La bonne réponse n'est pas un échappement plus malin, c'est
  // un refus : aucun chemin légitime ne contient un caractère de contrôle, et
  // prétendre les gérer donnerait une garde qu'on croit tenue.
  for (const [nom, valeur] of [
    ['la racine', ctx.racine],
    ['le dossier personnel', ctx.home],
    ['le chemin de Node', ctx.execNode],
  ] as const) {
    // eslint-disable-next-line no-control-regex
    if (/[ -]/.test(valeur)) {
      return {
        genre: 'refus',
        motif:
          `${nom} contient un caractère de contrôle. Hive refuse d’écrire un ` +
          'fichier de service à partir de cette valeur : selon le format, elle y ' +
          'ajouterait une directive ou une balise. Installez ailleurs.',
      };
    }
  }

  if (!chemins(ctx.plateforme).isAbsolute(ctx.racine)) {
    return {
      genre: 'refus',
      motif:
        `La racine « ${ctx.racine} » est relative. Un service démarre depuis un ` +
        'répertoire courant qui n’est pas le vôtre : tous les chemins qu’il porte ' +
        'doivent être absolus, sans quoi il chercherait son `.env` ailleurs et ' +
        'démarrerait sur des valeurs par défaut, en silence.',
    };
  }
  if (ctx.plateforme === 'linux') return planLinux(ctx);
  if (ctx.plateforme === 'darwin') return planMacos(ctx);
  if (ctx.plateforme === 'win32') return planWindows(ctx);
  return {
    genre: 'refus',
    motif:
      `Hive ne sait pas installer de service sur « ${ctx.plateforme} ». ` +
      'Lancez la ruche à la main, ou sous un superviseur de votre choix : ' +
      `${ctx.execNode} ${chemins(ctx.plateforme).join(ctx.racine, scriptDe(ctx.cible))}`,
  };
}
