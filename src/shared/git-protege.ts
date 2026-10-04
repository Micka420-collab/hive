// Git CÔTÉ HÔTE — la seule porte par laquelle la ruche lance `git` sur une
// machine : celle d'un membre (le nœud, hors du bac) comme celle de la Reine
// (le miroir du Rayon, `orchestrator/miroir.ts`).
//
// ─── L'INVARIANT ─────────────────────────────────────────────────────────────
//
// **Aucun git lancé par la ruche n'exécute ce qu'un dépôt apporte** : ni
// crochet (d'où que vienne `core.hooksPath`), ni moniteur, ni pager, ni tâche
// de fond, ni transport `ext::`, ni attente d'identifiants que personne ne
// saisira. Ce module porte cette politique UNE fois — l'environnement et les
// protections ci-dessous — avec le lanceur qui l'applique à chaque commande.
// Deux copies divergeaient : le miroir clonait sans les protections du nœud,
// et un `core.hooksPath` global relatif y lançait le `post-checkout` que le
// dépôt apportait, sur la machine de la Reine (git 2.53, tests/miroir.test.ts).
//
// Ce que chaque appelant ajoute, parce que lui seul sait quel git dir est de
// confiance : le nœud épingle un registre à lui (`node-client/git-hote.ts`),
// le miroir clone sans gabarit et coupe les filtres de son git dir.
//
// Les configurations SYSTÈME et GLOBALE restent lues, à dessein :
// `GIT_CONFIG_NOSYSTEM=1` a déjà emporté `core.symlinks=true`, que Git for
// Windows y règle — le miroir aplatissait alors les liens symboliques, et ses
// gardes contre l'évasion par lien ne vérifiaient plus rien. Elles portent les
// assistants d'identifiants, les certificats et `core.sshCommand` ; ce
// qu'elles pourraient faire exécuter à cause d'un dépôt est coupé ici.
//
// ─── LE SECOND INVARIANT : AUCUN IDENTIFIANT EN ARGUMENT ─────────────────────
//
// Un dépôt privé arrive du hub avec ses identifiants DANS l'URL
// (`https://user:ghp_…@github.com/…`). Passée telle quelle à git, l'URL allait
// là où personne ne l'avait décidé : dans le `.git/config` du clone — celui
// d'une tâche est entre les mains de l'agent, qui y lisait le jeton de push —,
// dans l'assistant d'identifiants du membre, auquel git CONFIE ce qui a
// marché, et dans l'argv de l'assistant de transport (`git-remote-http`),
// que toute la machine lit (`depotDistant`). Désormais une adresse avec
// identifiants ne franchit plus cette porte : git ne connaît que l'adresse
// NUE, le compte du projet voyage dans l'environnement du seul git qui parle
// au dépôt, et un argument qui en porterait encore est refusé (`gitHote`).

import { execFile, type ExecFileException } from 'node:child_process';
import path from 'node:path';
import { laverIdentifiantsDuTexte } from './projet-public.js';

/**
 * L'environnement de TOUT git lancé par la ruche sur l'hôte — nœud ou Reine.
 *
 * Épuré — ni secret de la ruche, ni variable d'éditeur. Chaque ligne ferme
 * une attente sans fin ou un transport dangereux :
 *
 *   · `GIT_ALLOW_PROTOCOL` neutralise le transport `ext::` (exécution de
 *     commande arbitraire), en plus de la validation du repoUrl côté hub ;
 *   · `GIT_TERMINAL_PROMPT=0` : sans lui, un dépôt privé sans identifiants
 *     fait ATTENDRE git sur une invite que personne ne lira ;
 *   · `GCM_INTERACTIVE=Never` : Git Credential Manager (inscrit par Git for
 *     Windows dans sa configuration système) n'obéit pas à la ligne d'au-dessus
 *     et ouvrait sa propre fenêtre — mesuré sur la CI Windows : trois
 *     lectures du miroir bloquées au plafond de 30 s, au millième près, et un
 *     clone du nœud toujours en attente au bout de 10 s. On ne le remplace pas
 *     par `credential.helper=` : on coupe l'interaction, pas l'assistant ;
 *   · `GIT_SSH_COMMAND` en mode lot : par SSH, c'est `ssh` qui demande, pas
 *     git — clé d'hôte inconnue, phrase de passe — et il lit le TERMINAL
 *     lui-même. `BatchMode=yes` rend un refus lisible au lieu d'une attente.
 *     `ssh` : la commande à laquelle on l'ajoute — celle du MEMBRE quand il en
 *     a une (`commandeSshDuMembre`), sinon `ssh`. `ConnectTimeout` et
 *     `ServerAlive*` bornent le TRANSPORT lui-même : le butoir de `gitHote`
 *     ne tue que git, et un `ssh` orphelin restait accroché à un hôte qui ne
 *     répond plus (voir `transportBorne`) ;
 *   · `SSH_AUTH_SOCK` passe, lui, vers GIT et jamais vers l'agent
 *     (`buildSandboxEnv` ne le transmet pas) : c'est ce qui permet à une clé
 *     à phrase de passe, déverrouillée dans l'agent ssh du membre, de servir
 *     en mode lot. Le transfert d'agent reste coupé (`ssh` sans `-A`) : le
 *     serveur distant ne peut pas s'en servir ;
 *   · `GIT_NO_LAZY_FETCH=1` : un objet manquant ne déclenche jamais de
 *     téléchargement depuis une commande locale (diff, add, apply).
 */
export function envGitHote(ssh = 'ssh', identite?: IdentiteCommit): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...identite,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    GIT_ALLOW_PROTOCOL: 'http:https:git:ssh:file',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4`,
    GIT_NO_LAZY_FETCH: '1',
  };
  if (process.env.SSH_AUTH_SOCK !== undefined) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  return env;
}

/**
 * L'`userinfo` d'une adresse HTTP(S), jusqu'au DERNIER arobase avant le
 * chemin — un mot de passe peut en contenir un. C'est le seul transport où
 * git envoie ce qu'une URL porte : par SSH, `git@` nomme un compte et c'est
 * la clé du membre qui ouvre ; `git://` est anonyme.
 */
const USERINFO_HTTP = /^(https?:\/\/)([^/?#]*)@/i;

/**
 * Ce qu'un argument de git ne porte JAMAIS (`gitHote`), et ce que la
 * configuration du miroir ne garde jamais :
 *   · une adresse HTTP(S) avec un `userinfo`, quel qu'il soit — c'est l'accès
 *     du projet (`depotDistant`) ;
 *   · une adresse de n'importe quel schéma avec un MOT DE PASSE (`ssh://u:p@`) :
 *     un compte seul (`ssh://git@…`, `git@hôte:`) passe, c'est la clé du
 *     membre qui ouvre ;
 *   · un en-tête `http.extraHeader`, ou un `Authorization:` — un jeton qui
 *     ne passe pas par l'URL est tout aussi lisible dans l'argv.
 */
const IDENTIFIANTS_DANS = [
  /\bhttps?:\/\/[^/?#\s]*@/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/?#\s@:]*:[^/?#\s]*@/i,
  /\bhttp\.(?:\S*\.)?extraheader\b/i,
  /^\s*authorization\s*:/i,
];

/** Ce texte — un argument, une configuration — porte-t-il des identifiants ? */
export function porteDesIdentifiants(texte: string): boolean {
  return IDENTIFIANTS_DANS.some((motif) => motif.test(texte));
}

/** Un dépôt DISTANT tel que la ruche lui parle (`depotDistant`). */
export interface DepotDistant {
  /**
   * L'adresse SANS identifiants : la seule que git connaisse — dans son
   * argv, dans celui de son assistant de transport, dans la configuration
   * d'un clone et dans ses messages.
   */
  readonly nue: string;
  /**
   * Ce qui ouvre le dépôt : une configuration git ÉPHÉMÈRE et le compte du
   * projet, que porte l'environnement du seul git qui parle au distant
   * (`gitHote`). Vide quand l'adresse ne portait rien.
   */
  readonly acces: Readonly<Record<string, string>>;
}

/**
 * L'assistant d'identifiants de la ruche, tel que git le lance : `!`, donc
 * par le shell — `sh` de Git for Windows sous Windows, comme tout assistant
 * qui prend un argument (Git Credential Manager y passe aussi : `git
 * credential-manager get`) et comme `GIT_SSH_COMMAND`. Deux commandes
 * INTERNES du shell, `test` et `printf` : rien n'est cherché dans le PATH,
 * rien n'est lu sur le disque. Il ne répond qu'à `get` — `store` et `erase`
 * ne rangent ni n'effacent rien. Son texte finit dans l'argv de `sh` : il ne
 * porte que des NOMS de variables, les valeurs sont dans l'environnement.
 */
const ASSISTANT_DU_DEPOT =
  '!f() { test "$1" != get || printf \'username=%s\\npassword=%s\\n\' "$HIVE_DEPOT_NOM" "$HIVE_DEPOT_SECRET"; }; f';

/**
 * Le remède quand le compte d'un projet ne passe plus : son URL ne se change
 * pas encore — aucune route ne la modifie (`store.ts` ne touche que
 * `ownerId`). Dit tel quel, plutôt qu'un « mettez l'URL à jour » que personne
 * ne pourrait suivre.
 */
export const URL_DU_PROJET_FIGEE =
  'l’URL d’un projet ne se change pas encore : recréez le projet avec la bonne';

/** Ce que git fait d'un `userinfo` (`url_decode`) : les `%XX` décodés, le reste tel quel. */
function decoderPourcents(texte: string): string {
  return texte.replace(/(?:%[0-9a-f]{2})+/gi, (suite) => {
    try {
      return decodeURIComponent(suite);
    } catch {
      return suite; // des octets qui ne font pas de l'UTF-8 : laissés tels quels
    }
  });
}

/**
 * Sépare l'adresse d'un dépôt de ses identifiants.
 *
 * ─── CE QUE L'URL AUTHENTIFIÉE FAISAIT, MESURÉ (git 2.53) ────────────────────
 *
 *   · `git clone` l'écrivait en `remote.origin.url` : le clone d'une tâche
 *     donnait à l'agent le jeton de push du projet (`cat .git/config`), que
 *     le registre de la ruche recopiait en plus à côté (`poserRegistre`) ;
 *   · git confie à CHAQUE assistant configuré les identifiants qui ont
 *     marché : avec `credential.helper=store`, le jeton finissait en clair
 *     dans `~/.git-credentials` du membre ; sous Windows, dans son
 *     gestionnaire d'identifiants (Git for Windows y inscrit Git Credential
 *     Manager) — à portée de tout processus du membre, et à la place de SES
 *     identifiants pour cet hôte. Un refus y EFFAÇAIT au passage l'entrée du
 *     membre ;
 *   · dans l'argv, elle se lit de toute la machine (`/proc/<pid>/cmdline`,
 *     mode 444) — même cachée au git lancé derrière une règle `insteadOf` :
 *     git passe l'adresse RÉÉCRITE à son assistant de transport, lu pendant
 *     un clone (`git-remote-http origin http://marie:…@…`).
 *
 * ─── CE QUE GIT REÇOIT DÉSORMAIS ─────────────────────────────────────────────
 *
 * L'adresse NUE — git n'en connaît pas d'autre, ni lui ni son assistant de
 * transport — et une configuration d'environnement (`GIT_CONFIG_COUNT`,
 * git ≥ 2.31, vérifié par `gitHote`) qui ne vit que le temps de CE git :
 *
 *   · `url.<nue>.insteadOf = <nue>`, et `pushInsteadOf` : l'IDENTITÉ. La règle
 *     la plus longue gagne, et celle-ci nomme le dépôt entier : une
 *     réécriture du membre qui vise l'hôte (`url.git@github.com:.insteadOf`,
 *     un réglage courant) ne l'emmène pas ailleurs — sans elle, mesuré, la
 *     poussée partait vers SA réécriture SSH, sous SON identité ;
 *   · `credential.helper` VIDE : la liste des assistants repart de zéro — ni
 *     dépôt du jeton chez le membre, ni effacement du sien, ni question à
 *     ses assistants quand le dépôt refuse le jeton ;
 *   · `credential.<schéma://hôte>.helper` : `ASSISTANT_DU_DEPOT`, qui rend le
 *     compte du projet depuis l'environnement (`HIVE_DEPOT_NOM`,
 *     `HIVE_DEPOT_SECRET`), pour CET hôte seulement — un amont qui redirige
 *     vers un autre hôte n'obtient rien.
 *
 * TOUT `userinfo` est l'accès du PROJET : son URL est la même pour chaque
 * membre, un nom n'y peut pas choisir le compte de chacun. Un nom seul
 * (`https://<jeton>@github.com/…`, la forme de GitHub) est donc un jeton au
 * mot de passe vide — mesuré : traité comme un nom, le jeton partait à chaque
 * assistant du membre dès que le dépôt le refusait.
 *
 * Pourquoi un assistant et pas `http.<nue>.extraHeader` (mesuré, git 2.53) :
 * l'en-tête part avec CHAQUE requête du processus, et après une redirection
 * vers un autre hôte, git y envoyait le compte du projet (curl, lui, le
 * retire) ; et un jeton refusé faisait appeler l'`askPass` du membre.
 * L'assistant ne répond qu'à une question de git, sur l'hôte du projet.
 *
 * Ce qui reste lisible : l'environnement de ce git et de ses enfants
 * (`/proc/<pid>/environ`, mode 400) — par le compte qui fait tourner le nœud,
 * donc par un agent au niveau `processus`, qui lit déjà le disque entier
 * (`constat`, isolement.ts). C'est la règle des clés du bac : des noms dans
 * l'argv, les valeurs dans l'environnement.
 *
 * Lève, sans citer l'adresse, quand le compte ne peut pas passer : un
 * caractère de contrôle une fois décodé (`printf` le couperait en deux lignes
 * du protocole des assistants), ou un mot de passe sans nom (`https://:…@` —
 * mesuré : git n'envoie pas de compte au nom vide ; curl le faisait, quand
 * l'adresse authentifiée lui arrivait entière).
 */
export function depotDistant(repoUrl: string): DepotDistant {
  const m = USERINFO_HTTP.exec(repoUrl);
  if (!m) return { nue: repoUrl, acces: {} };
  const nue = `${m[1]}${repoUrl.slice(m[0].length)}`;
  const userinfo = m[2] ?? '';
  if (userinfo === '') return { nue, acces: {} };
  const deuxPoints = userinfo.indexOf(':');
  const nom = decoderPourcents(deuxPoints < 0 ? userinfo : userinfo.slice(0, deuxPoints));
  const secret = deuxPoints < 0 ? '' : decoderPourcents(userinfo.slice(deuxPoints + 1));
  // eslint-disable-next-line no-control-regex -- c'est précisément ce qu'on refuse
  if (/[\u0000-\u001f\u007f]/.test(nom + secret)) {
    throw new Error(
      'l’URL du dépôt porte un caractère de contrôle dans ses identifiants : git ne peut ' +
        `pas s’en servir — ${URL_DU_PROJET_FIGEE}`,
    );
  }
  if (nom === '') {
    throw new Error(
      'l’URL du dépôt porte un mot de passe sans nom de compte (`https://:…@`) : git ' +
        'n’envoie pas de compte au nom vide — il lui faut `https://<jeton>@…` ou ' +
        `\`https://<compte>:<jeton>@…\` ; ${URL_DU_PROJET_FIGEE}`,
    );
  }
  const hote = /^https?:\/\/[^/?#]*/i.exec(nue)?.[0] ?? nue;
  const reglages: [cle: string, valeur: string][] = [
    [`url.${nue}.insteadOf`, nue],
    [`url.${nue}.pushInsteadOf`, nue],
    ['credential.helper', ''],
    [`credential.${hote}.helper`, ASSISTANT_DU_DEPOT],
  ];
  const acces: Record<string, string> = {
    GIT_CONFIG_COUNT: String(reglages.length),
    HIVE_DEPOT_NOM: nom,
    HIVE_DEPOT_SECRET: secret,
  };
  reglages.forEach(([cle, valeur], i) => {
    acces[`GIT_CONFIG_KEY_${i}`] = cle;
    acces[`GIT_CONFIG_VALUE_${i}`] = valeur;
  });
  return { nue, acces };
}

/**
 * Le git qui lit sa configuration dans l'environnement (`GIT_CONFIG_COUNT`) :
 * en dessous, `acces` est IGNORÉ — sans un mot, git parle à l'adresse nue
 * avec les assistants du membre, sous SON identité.
 */
export const GIT_ACCES_MINIMUM = '2.31';

/** La version que dit `git --version` (« 2.45.1 » de « git version 2.45.1.windows.1 »), ou `null`. */
export function versionDeGit(sortie: string): string | null {
  return /\bgit version (\d+\.\d+(?:\.\d+)?)/.exec(sortie)?.[1] ?? null;
}

/** Ce git (`versionDeGit`) lit-il l'accès d'un dépôt dans l'environnement ? */
export function gitPorteLAcces(version: string): boolean {
  const [majeur = 0, mineur = 0] = version.split('.').map(Number);
  const [majeurMin = 0, mineurMin = 0] = GIT_ACCES_MINIMUM.split('.').map(Number);
  return majeur !== majeurMin ? majeur > majeurMin : mineur >= mineurMin;
}

/**
 * `git --version`, une fois par PATH — le git qui tournera est celui que le
 * PATH désigne —, depuis le répertoire de la commande qu'il précède (sous
 * Windows, `execFile` cherche d'abord dans le cwd). Par la porte elle-même,
 * sans accès : son environnement est construit de rien (`envGitHote`), comme
 * celui d'une sonde (`envSonde`) — aucun secret de la ruche n'y passe. Une
 * sonde muette (`null`) n'est pas retenue : la commande elle-même dira ce qui
 * ne va pas, et la suivante sondera de nouveau.
 */
const versionsDeGit = new Map<string, Promise<string | null>>();
function versionDuGit(cwd: string): Promise<string | null> {
  const cle = process.env.PATH ?? '';
  const connue = versionsDeGit.get(cle);
  if (connue) return connue;
  const sonde = gitHote(['--version'], cwd, { delaiMs: 30_000 })
    .then(versionDeGit, () => null)
    .then((version) => {
      if (version === null) versionsDeGit.delete(cle);
      return version;
    });
  versionsDeGit.set(cle, sonde);
  return sonde;
}

/**
 * L'auteur d'un commit composé par le nœud (la livraison locale) : posé dans
 * l'environnement, jamais lu d'une configuration — pas même celle du membre.
 */
export interface IdentiteCommit {
  readonly GIT_AUTHOR_NAME: string;
  readonly GIT_AUTHOR_EMAIL: string;
  readonly GIT_COMMITTER_NAME: string;
  readonly GIT_COMMITTER_EMAIL: string;
}

/**
 * La commande ssh du MEMBRE : son `core.sshCommand` global, sinon système —
 * `--global`/`--system` ne lisent QUE ces fichiers, jamais la configuration
 * d'un dépôt, et un clone n'en a pas encore. On y AJOUTE le mode lot au lieu
 * de la remplacer : sous Windows, `core.sshCommand =
 * C:/Windows/System32/OpenSSH/ssh.exe` est ce qui fait parler git à l'agent
 * ssh de Windows ; remplacé par le `ssh` de Git for Windows, une clé à phrase
 * de passe cessait de servir. Illisible (HOME absent, fichier cassé) : `ssh`,
 * et le clone dira lui-même ce qui ne va pas.
 */
export async function commandeSshDuMembre(ou: string): Promise<string> {
  for (const portee of ['--global', '--system']) {
    const valeur = await gitHote(['config', portee, '--includes', '--get', 'core.sshCommand'], ou)
      .then((v) => v.trim())
      .catch(() => '');
    if (valeur !== '') return valeur;
  }
  return 'ssh';
}

/**
 * Posé devant CHAQUE commande, quel que soit le dépôt. Côté nœud, ce n'est
 * pas toute la défense (le registre l'est) : c'est ce qui ne dépend d'aucun
 * nom choisi par le dépôt, et qu'une configuration système ou globale
 * pourrait aussi porter — donc aussi ce qui protège le miroir de la Reine.
 * `--no-pager` : jamais de programme d'affichage, même sous un terminal.
 * `gc.auto`/`maintenance.auto` : aucune tâche de fond lancée par un `add`.
 *
 * `core.hooksPath` : AUCUN crochet, d'où qu'il vienne. Le registre n'en a
 * pas, mais un `core.hooksPath` RELATIF de la configuration globale
 * (`.githooks`, `.husky` — un réglage courant) se résout contre l'ARBRE : `add`
 * y lançait le `post-index-change` que l'agent avait posé, `git apply` celui
 * qu'un diff apportait à la fusion, et le clone du miroir le `post-checkout`
 * du dépôt. Il désigne ici un
 * chemin SOUS un fichier ordinaire — l'exécutable de node : aucun crochet ne
 * peut y exister, il n'y a rien à créer ni à nettoyer, personne ne peut y
 * déposer quoi que ce soit (`/dev/null` n'existe pas sous Windows).
 */
const PROTECTIONS = [
  '--no-pager',
  '-c',
  'core.fsmonitor=false',
  '-c',
  `core.hooksPath=${path.join(process.execPath, 'aucun-crochet')}`,
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
] as const;

/**
 * Le délai d'une commande LOCALE (dépôt épinglé : diff, add, apply…). Le
 * registre lit les objets de la tâche : un FIFO que l'agent pose en guise
 * d'index de pack bloquait l'`open()` de git, et `collectDiff` ne rendait
 * jamais la main — la place de la tâche restait prise. Large : un `add` sur
 * un très gros arbre prend des secondes, pas des minutes. Le clone et les
 * appels au dépôt distant ne sont pas bornés ICI : chacun passe son butoir
 * (`CLONE_MS`, `DELAI_RESEAU_MS` — `butoirs-noeud.ts`).
 */
const DELAI_GIT_LOCAL_MS = 5 * 60_000;

/**
 * Le butoir du TRANSPORT HTTP, calé sur celui de la commande. `execFile` ne
 * tue que `git` : son `git-remote-http(s)` survivait, rattaché à init, et
 * gardait ouverte la prise d'un serveur muet — curl n'a pas de délai de
 * lecture par défaut. Chaque tentative du miroir sur un amont muet laissait
 * donc un processus et une prise de plus sur la machine de la Reine. Moins
 * d'un octet par seconde pendant tout le butoir : curl abandonne de lui-même,
 * et l'assistant sort. Un vrai transfert lent n'est pas touché.
 */
function transportBorne(delai: number): string[] {
  if (delai <= 0) return [];
  return ['-c', 'http.lowSpeedLimit=1', '-c', `http.lowSpeedTime=${Math.ceil(delai / 1000)}`];
}

/** La sortie la plus grande gardée d'un git (voir `gitHote`). */
const SORTIE_MAX_OCTETS = 256 * 1024 * 1024;

/**
 * Un échec de git, avec son code de sortie (`null` : git n'a pas démarré, ou
 * a été tué — délai dépassé, signal).
 * Le code est ce qui permet de distinguer « pas de commit » (`rev-parse -q`
 * rend 1, sans un mot) d'une vraie panne, sans lire du texte.
 * `delaiDepasse` : git a été TUÉ par son délai — c'est ce qui permet à un
 * appel réseau de dire « dépôt muet » au lieu d'un signal.
 */
export class EchecGitHote extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly delaiDepasse = false,
  ) {
    super(message);
    this.name = 'EchecGitHote';
  }
}

/** Un dépôt ÉPINGLÉ : git ne cherche rien, on lui dit où est chaque chose. */
export interface DepotEpingle {
  gitDir: string;
  workTree: string;
}

/**
 * Lance `git` sur l'hôte, sans shell, avec l'environnement et les protections
 * ci-dessus. `ou` : le répertoire d'un git SANS dépôt (clone, init), un dépôt
 * nu que SEUL le nœud a écrit (la livraison locale), ou le dépôt ÉPINGLÉ sur
 * lequel travailler.
 *
 * `delaiMs` : par défaut `DELAI_GIT_LOCAL_MS` pour un dépôt épinglé, aucun
 * sinon — un appel réseau (clone, `ls-remote`, poussée) nomme SON butoir
 * (`butoirs-noeud.ts`), que le hub compte.
 *
 * Un dépôt épinglé ne se lance JAMAIS depuis son arbre, mais depuis le
 * répertoire qui le CONTIENT : sous Windows, `execFile` cherche `git.exe` dans
 * le cwd AVANT le PATH (libuv, `search_path`) — depuis l'arbre de la tâche,
 * c'est le `git.exe` de l'agent qui tournait. Le parent, lui, n'est ni monté
 * dans le bac ni écrit par un `git apply`. C'est git qui entre ensuite dans
 * l'arbre (`-C`), une fois SON binaire choisi.
 *
 * `acces` : l'accès éphémère d'un dépôt distant (`depotDistant`), ajouté à
 * l'environnement de CE git seulement — après avoir vérifié que ce git le lit
 * (`versionDuGit`). Un argument qui porte des identifiants est REFUSÉ avant
 * tout lancement (`porteDesIdentifiants`) : c'est ce qui les écrivait dans la
 * configuration d'un clone, dans l'assistant du membre et dans l'argv.
 *
 * La raison d'échec est le stderr de git, et SEULEMENT lui : le message
 * d'`execFile` recopie la ligne de commande. Lavé, en plus (`raisonEchec`) :
 * git anonymise les adresses qu'il cite, pas dans toutes ses versions, et un
 * serveur peut renvoyer la sienne — ou le jeton nu — dans ses lignes `remote:`.
 */
export function gitHote(
  args: readonly string[],
  ou: string | DepotEpingle,
  {
    delaiMs,
    ssh,
    identite,
    acces = {},
  }: {
    delaiMs?: number;
    ssh?: string;
    identite?: IdentiteCommit;
    acces?: DepotDistant['acces'];
  } = {},
): Promise<string> {
  // Un rejet, pas une exception : `commandeSshDuMembre` enchaîne `.catch`.
  // Le message ne cite AUCUN argument — c'est l'un d'eux qui porte le secret.
  if (args.some(porteDesIdentifiants)) {
    return Promise.reject(
      new EchecGitHote(
        `git ${args[0] ?? ''} : refusé — des identifiants en argument ` +
          '(l’accès d’un dépôt distant passe par `depotDistant`)',
        null,
      ),
    );
  }
  const local = typeof ou !== 'string';
  const delai = delaiMs ?? (local ? DELAI_GIT_LOCAL_MS : 0);
  const cwd = local ? path.dirname(ou.workTree) : ou;
  // `-C` : git, lui, travaille DANS l'arbre — `apply` résout les chemins du
  // patch contre son répertoire courant, pas contre `--work-tree`.
  const epingle = local
    ? ['-C', ou.workTree, `--git-dir=${ou.gitDir}`, `--work-tree=${ou.workTree}`]
    : [];
  const lancer = (): Promise<string> =>
    new Promise((resolve, reject) => {
      execFile(
        'git',
        [...PROTECTIONS, ...transportBorne(delai), ...epingle, ...args],
        {
          cwd,
          env: { ...envGitHote(ssh, identite), ...acces },
          shell: false, // jamais d'interprétation shell (contrainte §5.1)
          windowsHide: true,
          encoding: 'utf8',
          // Un diff de revue peut être gros ; il est plafonné plus loin (LIMITS).
          // Au-delà, la tâche ÉCHOUE, message à l'appui (`raisonEchec`) : c'est
          // voulu — tout garder en mémoire pour en jeter l'essentiel exposerait
          // le nœud à un arbre de plusieurs Gio non ignoré.
          maxBuffer: SORTIE_MAX_OCTETS,
          timeout: delai,
          killSignal: 'SIGKILL',
        },
        (err, stdout, stderr) => {
          if (!err) {
            resolve(stdout);
            return;
          }
          const code = typeof err.code === 'number' ? err.code : null;
          // Sans `signal` d'annulation, seul le délai fait tuer git par node.
          const delaiDepasse = delai > 0 && err.killed === true && code === null;
          const raison = raisonEchec(err, code, stderr, acces);
          reject(new EchecGitHote(`git ${args[0] ?? ''} : ${raison}`, code, delaiDepasse));
        },
      );
    });
  if (Object.keys(acces).length === 0) return lancer();
  return versionDuGit(cwd).then((version) => {
    if (version !== null && !gitPorteLAcces(version)) {
      throw new EchecGitHote(
        `git ${args[0] ?? ''} : refusé — git ${version} ignore l’accès que la ruche lui passe ` +
          `par l’environnement (git ≥ ${GIT_ACCES_MINIMUM}) : il parlerait au dépôt sous ` +
          'l’identité du membre, sans le compte du projet — mettez git à jour',
        null,
      );
    }
    return lancer();
  });
}

/**
 * Un dépôt qui refuse le compte du projet : git dit « Authentication failed »
 * (401, jeton expiré ou révoqué) ou rend le code de curl (403, jeton sans le
 * droit demandé — une poussée avec un jeton de lecture). Le message de git ne
 * dit pas d'où vient le compte : c'est l'URL du projet, et c'est elle qu'il
 * faut changer — pas l'assistant du membre, que la ruche n'interroge plus.
 */
const REFUS_DU_COMPTE = /Authentication failed|\b(?:HTTP|error:) 40[13]\b/i;

/**
 * Jamais `err.message` pour un git qui a TOURNÉ : pour un processus sorti en
 * erreur OU tué par un signal (délai, arrêt du nœud, OOM), c'est
 * `Command failed: git … <URL>` — l'argv entier. Il n'est lu que quand git
 * n'a pas démarré ou que node l'a coupé (`err.code` textuel : `ENOENT`,
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) — des messages sans argv.
 *
 * Le stderr est lavé deux fois : des adresses avec identifiants
 * (`laverIdentifiantsDuTexte`), et des VALEURS du compte du projet, mot pour
 * mot — un serveur peut renvoyer le jeton nu dans ses lignes `remote:`. Comme
 * le caviardage des journaux (`VALEUR_SECRETE_MIN`), une valeur de moins de
 * huit caractères reste : masquer `git` ou `main` partout rendrait le
 * message illisible sans rien protéger.
 */
function raisonEchec(
  err: ExecFileException,
  code: number | null,
  stderr: string,
  acces: DepotDistant['acces'],
): string {
  const secrets = [acces.HIVE_DEPOT_SECRET, acces.HIVE_DEPOT_NOM]
    .filter((v): v is string => v !== undefined && v.length >= 8)
    .sort((a, b) => b.length - a.length);
  const sortie = secrets
    .reduce((texte, secret) => texte.split(secret).join('***'), laverIdentifiantsDuTexte(stderr))
    .trim();
  if (code !== null) {
    if (Object.keys(acces).length === 0 || !REFUS_DU_COMPTE.test(sortie)) {
      return sortie || `code de sortie ${code}`;
    }
    // Le remède D'ABORD : le motif d'une livraison est coupé à `LIMITS.arg`,
    // et une longue sortie de git ne doit pas le faire tomber.
    return (
      'le dépôt refuse le jeton de l’URL du projet (expiré, révoqué, ou en lecture seule ' +
      `pour une poussée) — il en faut un valide, et ${URL_DU_PROJET_FIGEE} — ${sortie}`
    );
  }
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return (
      `sortie au-delà de ${SORTIE_MAX_OCTETS / 1024 / 1024} Mio — un gros fichier ` +
      'que le `.gitignore` du projet devrait exclure ?'
    );
  }
  if (err.signal) {
    const cause = err.killed ? 'délai dépassé ou arrêt du nœud' : 'tué de l’extérieur';
    return `interrompu (${err.signal}, ${cause})${sortie ? ` : ${sortie}` : ''}`;
  }
  return typeof err.code === 'string' ? err.message : 'échec sans code de sortie';
}
