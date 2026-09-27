// Git CÔTÉ HÔTE — la seule porte par laquelle le nœud lance `git` hors du bac.
//
// ─── LE TROU QUE CE MODULE FERME ─────────────────────────────────────────────
//
// L'agent travaille DANS le répertoire de sa tâche, `.git` compris : il peut
// écrire `.git/config`, `.git/hooks/*`, `.gitattributes`. Après lui, le nœud
// lançait `git add` et `git diff` dans ce même répertoire, SUR L'HÔTE, hors du
// bac à sable — et git honorait tout ce que l'agent y avait écrit. Mesuré sur
// l'ancien `collectDiff` (tests/git-hote.test.ts) : un crochet
// `post-index-change`, un `core.fsmonitor`, un filtre `clean` désigné par
// `.gitattributes`, un `textconv`, un `diff.external` — chacun exécutait son
// programme sur la machine du membre, avec ses droits, sous
// `HIVE_ISOLEMENT=exige` compris. Le bac à sable ne valait plus que jusqu'à la
// fin de la tâche.
//
// ─── L'INVARIANT ─────────────────────────────────────────────────────────────
//
// **Aucune commande git lancée par l'hôte n'exécute quoi que ce soit que le
// dépôt de la tâche a configuré.** Ni crochet, ni moniteur, ni filtre, ni
// pilote de diff, ni commande ssh, ni pager, ni `include`.
//
// ─── POURQUOI UN GIT DIR À LA RUCHE, ET PAS UNE LISTE DE `-c` ────────────────
//
// La liste de `-c` qui neutraliserait la configuration de l'agent n'existe
// pas : un filtre s'appelle `filter.<nom>.clean` et c'est l'agent qui choisit
// `<nom>` ; `include.path` en tire d'autres fichiers ; chaque version de git
// ajoute ses clés. Une liste noire perd à la première clé oubliée. Et on ne
// peut pas dire à git d'ignorer la configuration d'un dépôt : elle vit dans
// son git dir, toujours lue.
//
// Donc on ne lit plus CE git dir. Juste après le clone — avant que l'agent ne
// tourne, quand tout y a été écrit par git lui-même — le nœud pose à CÔTÉ de
// la tâche (`<tâche>.git`, hors du montage du bac, comme `<tâche>.tmp`) un git
// dir qui appartient à la ruche (`poserRegistre`) : la configuration du clone
// copiée À CET INSTANT, son index, HEAD épinglée sur le commit de départ, AUCUN
// crochet, et les objets EMPRUNTÉS au dépôt de la tâche (`alternates` — des
// données adressées par leur empreinte, jamais du code). Toute commande d'après
// passe `--git-dir=<registre> --work-tree=<tâche>` : ce que l'agent a écrit
// dans `.git` n'est plus lu, et le dépôt ne peut plus être désigné AILLEURS
// (un `.git` retiré ou remplacé ne fait plus remonter git jusqu'au checkout du
// membre autour — le défaut que tests/workflow-git.test.ts avait consigné).
//
// Pourquoi ne pas simplement sortir `.git` du répertoire de la tâche ? Parce
// que l'agent en a besoin : `codex exec` refuse de tourner hors d'un dépôt git
// (`--skip-git-repo-check`, codex-rs/exec/src/cli.rs), et les autres CLI lisent
// `git status`/`git diff` pour s'orienter. Le bac ne monte que la tâche : un
// `.git` qui pointerait dehors y serait cassé.
//
// ─── CE QUI RESTE LU, ET POURQUOI C'EST ACCEPTABLE ───────────────────────────
//
//   · Les `.gitattributes` de l'arbre : l'agent les écrit, et ils NOMMENT des
//     pilotes. Nommer ne suffit pas — il faut une configuration pour définir
//     la commande, et celle du registre n'en définit aucune. Restent ceux que
//     la machine définit (Git for Windows inscrit `filter.lfs` dans sa
//     configuration système, et git-lfs lit le `.lfsconfig` de l'arbre) : le
//     registre porte `info/attributes` = `* -filter`, qui PRIME sur tout
//     `.gitattributes`. Pilotes de diff : `--no-ext-diff --no-textconv`.
//   · Les objets de la tâche, par `alternates` : des données, LUES seulement —
//     jamais sa configuration ni ses crochets, et rien n'est écrit hors du
//     registre. L'agent peut les corrompre ou les effacer (le diff ÉCHOUE
//     alors, visiblement), ou faire de `.git` un lien vers un autre dépôt qui
//     contient le commit de départ (le diff se calcule alors avec SES objets,
//     en lecture) ; il ne peut pas les faire exécuter.
//   · Les configurations SYSTÈME et GLOBALE : celles de la machine et du
//     membre, jamais montées dans le bac. On ne les coupe pas
//     (`GIT_CONFIG_NOSYSTEM` a déjà coûté `core.symlinks` au miroir — voir
//     `orchestrator/miroir.ts`) : elles portent ce dont le clone a besoin, les
//     assistants d'identifiants et les certificats du membre.
//
// Au niveau `processus` (aucun moteur de conteneurs), l'agent peut écrire
// partout sous l'utilisateur du membre, registre compris : il n'y a alors pas
// de bac dont sortir, et `constat()` le dit déjà (isolement.ts).

import { execFile, type ExecFileException } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * L'environnement de TOUT git lancé par le nœud sur l'hôte.
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
 *     et ouvrait sa propre fenêtre — mesuré sur la CI Windows : toujours en
 *     attente au bout de 10 s (même leçon que `miroir.ts`) ;
 *   · `GIT_SSH_COMMAND` en mode lot : par SSH, c'est `ssh` qui demande, pas
 *     git — clé d'hôte inconnue, phrase de passe — et il lit le TERMINAL
 *     lui-même. `BatchMode=yes` rend un refus lisible au lieu d'une attente.
 *     Revers assumé : un `core.sshCommand` du membre est remplacé ; le choix
 *     d'une clé par hôte reste possible par `~/.ssh/config`, que `ssh` lit
 *     toujours (HOME passe) ;
 *   · `SSH_AUTH_SOCK` passe, lui, vers GIT et jamais vers l'agent
 *     (`buildSandboxEnv` ne le transmet pas) : c'est ce qui permet à une clé
 *     à phrase de passe, déverrouillée dans l'agent ssh du membre, de servir
 *     en mode lot. Le transfert d'agent reste coupé (`ssh` sans `-A`) : le
 *     serveur distant ne peut pas s'en servir ;
 *   · `GIT_NO_LAZY_FETCH=1` : un objet manquant ne déclenche jamais de
 *     téléchargement depuis une commande locale (diff, add, apply).
 */
export function envGitHote(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    SYSTEMROOT: process.env.SYSTEMROOT,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    GIT_ALLOW_PROTOCOL: 'http:https:git:ssh:file',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
    GIT_NO_LAZY_FETCH: '1',
  };
  if (process.env.SSH_AUTH_SOCK !== undefined) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  return env;
}

/**
 * Posé devant CHAQUE commande, quel que soit le dépôt. Ce n'est pas la
 * défense (le registre l'est) : c'est ce qui ne dépend d'aucun nom choisi par
 * l'agent, et qu'une configuration système ou globale pourrait aussi porter.
 * `--no-pager` : jamais de programme d'affichage, même sous un terminal.
 * `gc.auto`/`maintenance.auto` : aucune tâche de fond lancée par un `add`.
 *
 * `core.hooksPath` : AUCUN crochet, d'où qu'il vienne. Le registre n'en a
 * pas, mais un `core.hooksPath` RELATIF de la configuration globale
 * (`.githooks`, `.husky` — un réglage courant) se résout contre l'ARBRE de la
 * tâche : `add` y lançait le `post-index-change` que l'agent avait posé, et
 * `git apply` celui qu'un diff apportait à la fusion. Il désigne ici un
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
 * un très gros arbre prend des secondes, pas des minutes. Le clone (réseau,
 * taille inconnue) n'est pas borné ici.
 */
const DELAI_GIT_LOCAL_MS = 5 * 60_000;

/**
 * Un échec de git, avec son code de sortie (`null` : git n'a pas démarré, ou
 * a été tué — délai dépassé, signal).
 * Le code est ce qui permet de distinguer « pas de commit » (`rev-parse -q`
 * rend 1, sans un mot) d'une vraie panne, sans lire du texte.
 */
export class EchecGitHote extends Error {
  constructor(
    message: string,
    readonly code: number | null,
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
 * ci-dessus. `ou` : le répertoire d'un git SANS dépôt (clone, init), ou le
 * dépôt ÉPINGLÉ sur lequel travailler.
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
export function gitHote(
  args: readonly string[],
  ou: string | DepotEpingle,
  delaiMs = DELAI_GIT_LOCAL_MS,
): Promise<string> {
  const local = typeof ou !== 'string';
  // `-C` : git, lui, travaille DANS l'arbre — `apply` résout les chemins du
  // patch contre son répertoire courant, pas contre `--work-tree`.
  const epingle = local
    ? ['-C', ou.workTree, `--git-dir=${ou.gitDir}`, `--work-tree=${ou.workTree}`]
    : [];
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...PROTECTIONS, ...epingle, ...args],
      {
        cwd: local ? path.dirname(ou.workTree) : ou,
        env: envGitHote(),
        shell: false, // jamais d'interprétation shell (contrainte §5.1)
        windowsHide: true,
        encoding: 'utf8',
        // Un diff de revue peut être gros ; il est plafonné plus loin (LIMITS).
        maxBuffer: 256 * 1024 * 1024,
        timeout: local ? delaiMs : 0,
        killSignal: 'SIGKILL',
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve(stdout);
          return;
        }
        const code = typeof err.code === 'number' ? err.code : null;
        reject(new EchecGitHote(`git ${args[0] ?? ''} : ${raisonEchec(err, code, stderr)}`, code));
      },
    );
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
  if (err.signal) {
    const cause = err.killed ? 'délai dépassé ou arrêt du nœud' : 'tué de l’extérieur';
    return `interrompu (${err.signal}, ${cause})${sortie ? ` : ${sortie}` : ''}`;
  }
  return typeof err.code === 'string' ? err.message : 'échec sans code de sortie';
}

/**
 * `* -filter` : aucun filtre `clean`/`smudge`/`process` ne s'applique, quel
 * que soit le `.gitattributes` qui le demande. Ce fichier du git dir PRIME sur
 * tous ceux de l'arbre (gitattributes(5)).
 */
function neutraliserFiltres(gitDir: string): void {
  mkdirSync(path.join(gitDir, 'info'), { recursive: true });
  writeFileSync(path.join(gitDir, 'info', 'attributes'), '* -filter\n');
}

/**
 * Le commit de départ d'un dépôt FRAIS — `null` s'il n'en a aucun (dépôt
 * vide : le premier commit reste à faire, et c'est un cas légitime).
 */
export async function commitDeDepart(depot: DepotEpingle): Promise<string | null> {
  try {
    return (await gitHote(['rev-parse', '--verify', '-q', 'HEAD'], depot)).trim();
  } catch (e) {
    // Toute AUTRE panne remonte : la prendre pour un dépôt vide ferait
    // calculer le diff contre l'index, et les suppressions disparaîtraient.
    if (e instanceof EchecGitHote && e.code === 1) return null;
    throw e;
  }
}

/**
 * Pose le registre de la ruche pour la tâche clonée dans `workTree`, AVANT que
 * l'agent ne tourne (voir l'en-tête : ce qui est copié ici est de confiance
 * parce que seul git l'a écrit).
 *
 * `base` : le commit de départ, sur lequel HEAD du registre reste épinglée —
 * l'agent peut committer, indexer, changer de branche dans SON dépôt, le diff
 * se calcule toujours contre le point de départ.
 */
export async function poserRegistre(
  workTree: string,
  registre: string,
  base: string | null,
): Promise<DepotEpingle> {
  const source = path.join(workTree, '.git');
  // `--template=` vide : aucun crochet, aucun fichier d'exemple — pas même
  // ceux d'un `init.templateDir` du membre.
  await gitHote(['init', '-q', '--bare', '--template=', registre], path.dirname(registre));
  // La configuration du clone telle que git l'a écrite : `core.symlinks`,
  // `core.ignorecase`, le format d'objets… — ce que git a SONDÉ sur ce disque,
  // et sans quoi le diff ne relirait pas l'arbre comme le clone l'a écrit.
  copyFileSync(path.join(source, 'config'), path.join(registre, 'config'));
  // Les objets sont empruntés, pas copiés : un clone superficiel reste un
  // seul exemplaire sur le disque. Barres obliques : acceptées partout.
  mkdirSync(path.join(registre, 'objects', 'info'), { recursive: true });
  writeFileSync(
    path.join(registre, 'objects', 'info', 'alternates'),
    `${path.join(source, 'objects').split(path.sep).join('/')}\n`,
  );
  // Un clone `--depth 1` n'a pas le parent de son commit : sans `shallow`,
  // git le chercherait.
  for (const fichier of ['shallow', 'index']) {
    const chemin = path.join(source, fichier);
    if (existsSync(chemin)) copyFileSync(chemin, path.join(registre, fichier));
  }
  neutraliserFiltres(registre);
  const depot = { gitDir: registre, workTree };
  if (base !== null) await gitHote(['update-ref', '--no-deref', 'HEAD', base], depot);
  return depot;
}

/**
 * Le diff de l'arbre de travail CONTRE LE COMMIT DE DÉPART — nouveaux fichiers
 * compris (`--intent-to-add`), suppressions comprises.
 *
 * Contre `base`, pas contre l'index : avec `add --all`, un fichier supprimé
 * sort de l'index, et un `git diff` index↔arbre ne le montrait plus — la
 * suppression disparaissait de la revue, en silence. Sans commit de départ
 * (dépôt vide), l'index ne contient que les intentions d'ajout, et le diff
 * index↔arbre est exact.
 */
export async function diffContreBase(depot: DepotEpingle, base: string | null): Promise<string> {
  await gitHote(['add', '--all', '--intent-to-add'], depot);
  return gitHote(
    [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      // Un dépôt IMBRIQUÉ dans l'arbre est un sous-module aux yeux de git, et
      // en juger l'état lancerait un `git status` DANS ce dépôt — avec SA
      // configuration, que l'agent a écrite.
      '--ignore-submodules=all',
      ...(base !== null ? [base] : []),
    ],
    depot,
  );
}

/**
 * Épingle un dépôt que le NŒUD a cloné et où aucun code étranger n'a encore
 * tourné (le clone d'un merge) : son git dir est de confiance, on le garde, et
 * on y neutralise les filtres que des `.gitattributes` appliqués feraient
 * sinon tourner.
 */
export function epinglerClone(repoDir: string): DepotEpingle {
  // Absolus : `-C <arbre>` passe AVANT `--git-dir` (gitHote).
  const workTree = path.resolve(repoDir);
  const depot = { gitDir: path.join(workTree, '.git'), workTree };
  neutraliserFiltres(depot.gitDir);
  return depot;
}
