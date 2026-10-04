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

import { execFile, type ExecFileException } from 'node:child_process';
import path from 'node:path';

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
 * La raison d'échec est le stderr de git, et SEULEMENT lui : le message
 * d'`execFile` recopie la ligne de commande, donc l'URL de clone — et une URL
 * peut porter un jeton (`https://x:jeton@…`). Git, lui, l'anonymise.
 */
export async function gitHote(
  args: readonly string[],
  ou: string | DepotEpingle,
  options: OptionsGitHote = {},
): Promise<string> {
  return (await gitHoteOctets(args, ou, options)).toString('utf8');
}

export interface OptionsGitHote {
  delaiMs?: number;
  ssh?: string;
  identite?: IdentiteCommit;
  /** Écrit sur l'entrée standard de git, puis fermée (`cat-file --batch`). */
  entree?: string;
}

/**
 * `gitHote`, sortie rendue telle quelle, en octets : un objet git se relit
 * octet pour octet quand on recalcule son empreinte (`base-verifiee.ts`) —
 * décodé en UTF-8, un arbre (des empreintes BRUTES) ne se relirait plus.
 */
export function gitHoteOctets(
  args: readonly string[],
  ou: string | DepotEpingle,
  { delaiMs, ssh, identite, entree }: OptionsGitHote = {},
): Promise<Buffer> {
  const local = typeof ou !== 'string';
  const delai = delaiMs ?? (local ? DELAI_GIT_LOCAL_MS : 0);
  // `-C` : git, lui, travaille DANS l'arbre — `apply` résout les chemins du
  // patch contre son répertoire courant, pas contre `--work-tree`.
  const epingle = local
    ? ['-C', ou.workTree, `--git-dir=${ou.gitDir}`, `--work-tree=${ou.workTree}`]
    : [];
  return new Promise((resolve, reject) => {
    const enfant = execFile(
      'git',
      [...PROTECTIONS, ...transportBorne(delai), ...epingle, ...args],
      {
        cwd: local ? path.dirname(ou.workTree) : ou,
        env: envGitHote(ssh, identite),
        shell: false, // jamais d'interprétation shell (contrainte §5.1)
        windowsHide: true,
        encoding: 'buffer',
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
        const raison = raisonEchec(err, code, stderr.toString('utf8'));
        reject(new EchecGitHote(`git ${args[0] ?? ''} : ${raison}`, code, delaiDepasse));
      },
    );
    if (entree !== undefined) {
      // Un git qui sort avant d'avoir tout lu (`EPIPE`) dit déjà pourquoi par
      // son code de sortie : l'erreur du tube n'apprend rien de plus.
      enfant.stdin?.on('error', () => undefined);
      enfant.stdin?.end(entree);
    }
  });
}

/**
 * Jamais `err.message` pour un git qui a TOURNÉ : pour un processus sorti en
 * erreur OU tué par un signal (délai, arrêt du nœud, OOM), c'est
 * `Command failed: git … <URL>` — l'argv entier. Il n'est lu que quand git
 * n'a pas démarré ou que node l'a coupé (`err.code` textuel : `ENOENT`,
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) — des messages sans argv.
 */
function raisonEchec(err: ExecFileException, code: number | null, stderr: string): string {
  const sortie = stderr.trim();
  if (code !== null) return sortie || `code de sortie ${code}`;
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
