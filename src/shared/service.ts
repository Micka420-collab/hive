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
  /**
   * L'encodage des octets à écrire.
   *
   * ─── POURQUOI CE CHAMP EXISTE, ET CE QU'IL RÉPARE ──────────────────────────
   *
   * Le plan Windows déclare `<?xml version="1.0" encoding="UTF-16"?>` — c'est ce
   * que le planificateur de tâches attend de `schtasks /Create /XML`. L'écriture
   * réelle, elle, faisait `writeFileSync(chemin, contenu)`, donc de l'UTF-8 sans
   * marque d'ordre. Un analyseur XML conforme REFUSE un flux dont les octets
   * contredisent la déclaration : la commande sortait en erreur, aucune tâche
   * n'était inscrite, et la ruche ne redémarrait jamais à l'ouverture de session.
   *
   * C'était la seule des trois plateformes touchée — le plist macOS et l'unité
   * systemd sont de l'UTF-8, et se portaient bien.
   *
   * L'encodage voyage donc DANS LE PLAN, au lieu d'être une convention tacite
   * entre deux fichiers qui ne se lisent pas. Un plan pur porte tout ce qu'il
   * faut pour être exécuté — c'est la raison d'être de ce module.
   */
  readonly encodage: 'utf8' | 'utf16le';
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
 * Le `%` de systemd, doublé — la seule règle COMMUNE à toutes ses directives.
 *
 * `%` est le caractère de SPÉCIFICATEUR : `%h` devient le home, `%i` le nom
 * d'instance… Un chemin contenant un `%` ne planterait pas — il serait
 * silencieusement réécrit en autre chose. C'est le piège qu'on ne voit pas
 * venir, parce qu'il n'échoue pas : il remplace.
 *
 * Mesuré : `WorkingDirectory=/tmp/p%c` fait dire à `systemd-analyze verify`
 * « Specifier '%c' used in unit configuration, which is deprecated » ; la forme
 * doublée passe sans un mot. Sur les quatre directives que ce module écrit.
 */
function doublerPourCent(valeur: string): string {
  return valeur.replace(/%/g, '%%');
}

/**
 * Un ARGUMENT dans une directive que systemd DÉCOUPE SUR LES ESPACES.
 *
 * Deux directives seulement, dans ce module : `ExecStart=` (une ligne de
 * commande) et `ReadWritePaths=` (une liste). Là, un chemin contenant une
 * espace donnerait deux arguments — donc on cite en `"…"`, en échappant `\` et
 * `"` à l'intérieur, et on double le `%`.
 *
 * ─── POURQUOI CE NOM EST SI LONG ─────────────────────────────────────────────
 *
 * Il s'appelait `citerSystemd`. Un nom qui n'annonce aucun domaine a l'air
 * juste partout : il a donc été employé sur les quatre directives que ce module
 * écrit, dont deux qui REFUSENT les guillemets. Le fichier produit était rejeté
 * par systemd depuis le premier jour, et les tests étaient verts — ils
 * comparaient le fichier à lui-même, jamais à son consommateur (§ 6.6 de
 * `docs/ERREURS.md`).
 */
export function citerArgumentSystemd(valeur: string): string {
  const echappe = doublerPourCent(valeur.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  return `"${echappe}"`;
}

/**
 * Une valeur dans une directive qui prend LA LIGNE ENTIÈRE — donc SANS
 * guillemets.
 *
 * `WorkingDirectory=` et `EnvironmentFile=` ne découpent rien : la valeur est le
 * reste de la ligne, espaces comprises. Les guillemets n'y sont pas de la
 * syntaxe, ce sont des CARACTÈRES DU CHEMIN. Mesuré, sur systemd 255 :
 *
 *   · `WorkingDirectory="/home/moi/hive"` →
 *     « path is not absolute » + « unit will not be started ». FATAL.
 *   · `EnvironmentFile=-"/home/moi/hive/.env"` →
 *     « path is not absolute, IGNORING ». Aucune erreur, aucun démarrage
 *     manqué : le `.env` n'est simplement jamais lu.
 *
 * Le second est exactement la panne que l'en-tête de ce fichier dit exister pour
 * fermer — une ruche qui démarre « avec succès », sans `HIVE_TOKEN`, sans
 * `HIVE_JWT_SECRET`, et qui n'est la ruche de personne.
 *
 * Il n'y a rien à échapper ici : ni `\` ni `"` n'ont de sens dans une valeur qui
 * n'est pas découpée. Seul le `%` en garde un. Le `\` FINAL, lui, est refusé en
 * amont — voir `RISQUE_LIGNE_SUIVANTE`.
 */
export function valeurSystemd(valeur: string): string {
  return doublerPourCent(valeur);
}

/**
 * Le `\` final, qui n'est pas un caractère mais une CONTINUATION DE LIGNE.
 *
 * Le lexer de systemd recolle la ligne suivante avant que la directive ne soit
 * lue. Mesuré : une unité dont le `WorkingDirectory` finit par un `\` unique se
 * fait répondre « Service has no ExecStart= » — la ligne `ExecStart` avait été
 * AVALÉE dans la valeur du répertoire.
 *
 * Un nombre PAIR d'antislashes, lui, ne continue pas — mesuré aussi. J'avais
 * donc écrit une expression qui ne refusait que les impairs. Elle était plus
 * fine, et pas plus juste : je ne peux pas observer d'ici ce que la valeur VAUT
 * ensuite. Il faudrait un gestionnaire systemd vivant, et
 * `systemd-analyze verify` ne rend que la syntaxe.
 *
 * Laisser passer `…\\` aurait donc été autoriser un chemin dont je ne sais pas
 * s'il désigne le bon dossier. On refuse TOUT antislash final : aucun chemin
 * d'installation légitime n'en porte, et c'est la seule des deux règles dont je
 * peux démontrer la correction.
 */
export const RISQUE_LIGNE_SUIVANTE = /\\$/;

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

  // Le `\` final avale la ligne suivante. Il se refuse ici, et pas dans
  // `planifier`, parce qu'un chemin Windows en est PLEIN — la règle est propre à
  // la grammaire de systemd, pas au projet.
  for (const [quoi, valeur] of [
    ['la racine', ctx.racine],
    ['le chemin de Node', ctx.execNode],
  ] as const) {
    if (RISQUE_LIGNE_SUIVANTE.test(valeur)) {
      return {
        genre: 'refus',
        motif:
          `${quoi} finit par un antislash. Dans un fichier d’unité systemd, un ` +
          'antislash en fin de ligne RECOLLE la ligne suivante : la directive ' +
          'd’après serait avalée dans le chemin, et le service démarrerait ' +
          'amputé — ou pas du tout. Installez ailleurs.',
      };
    }
  }

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
    // Prend la ligne entière : PAS de guillemets, sans quoi systemd répond
    // « path is not absolute » et refuse de démarrer l'unité.
    `WorkingDirectory=${valeurSystemd(ctx.racine)}`,
    // Découpé sur les espaces : les guillemets sont obligatoires ici.
    `ExecStart=${citerArgumentSystemd(ctx.execNode)} ${citerArgumentSystemd(script)}`,
    // `-` en tête : le service démarre même sans `.env`. C'est délibéré — la
    // ruche sait se plaindre elle-même, mieux que systemd ne le ferait.
    //
    // Et PAS de guillemets non plus : cités, systemd les garde pour des
    // caractères du chemin, ne trouve pas le fichier, et passe son chemin SANS
    // RIEN DIRE. Le service démarre alors sans aucun secret.
    `EnvironmentFile=-${valeurSystemd(p.join(ctx.racine, '.env'))}`,
    'Restart=on-failure',
    'RestartSec=5',
    'NoNewPrivileges=true',
    'PrivateTmp=true',
    'ProtectSystem=strict',
    'ProtectHome=read-only',
    // Une LISTE séparée par des espaces : citée, comme `ExecStart`.
    `ReadWritePaths=${citerArgumentSystemd(ctx.racine)}`,
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
    fichier: { chemin, contenu, mode: 0o600, encodage: 'utf8' },
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
    fichier: { chemin, contenu, mode: 0o600, encodage: 'utf8' },
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
    fichier: { chemin, contenu, mode: 0o600, encodage: 'utf16le' },
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
/**
 * Ce qu'il faut faire d'un plan AVANT de poser quoi que ce soit sur la machine.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 *
 * `planifier` est pure et éprouvée. Son EMPLOI ne l'était pas : la commande de
 * service décidait sur place, dans `src/cli.ts`, un fichier qui n'exporte rien.
 * Un balayage élargi y a montré `avant.genre === 'refus'` muté en `!==` sans
 * qu'une seule assertion bouge — et c'est le survivant le plus lourd des neuf :
 *
 *   · un plan VALIDE serait pris pour un refus, et `dire(avant)` afficherait
 *     `undefined` en guise de motif ;
 *   · un REFUS traverserait, et `installer()` poserait sur la machine un
 *     fichier de service que le plan venait d'interdire — celui-là même dont le
 *     motif est « selon le format, cette valeur y ajouterait une directive ».
 *
 * L'invariant tient en une phrase, et c'est elle qu'on éprouve : **on ne pose
 * rien quand le plan refuse, et les avertissements précèdent l'action.**
 *
 * Les avertissements viennent AVANT parce que les afficher après reviendrait à
 * prévenir quelqu'un d'une conséquence qu'il vient de subir : que le niveau
 * système réclame l'administrateur, que `systemd --user` s'arrête à la
 * fermeture de session.
 */
export type AvantDePoser =
  | { readonly poser: false; readonly motif: string }
  | { readonly poser: true; readonly avertissements: readonly string[] };

export function avantDePoser(plan: Plan | Refus): AvantDePoser {
  if (plan.genre === 'refus') return { poser: false, motif: plan.motif };
  return { poser: true, avertissements: plan.avertissements };
}

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
