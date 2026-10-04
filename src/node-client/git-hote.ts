// Git CÔTÉ HÔTE, côté nœud — le registre que le nœud lit à la place du git dir
// de la tâche. Chaque commande passe par `gitHote` (`shared/git-protege.ts`),
// qui porte l'environnement et les protections communs au nœud et à la Reine.
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
//     registre porte un `info/attributes` qui PRIME sur tout `.gitattributes`
//     — `* -filter`, puis les SEULES affectations de filtre que le commit de
//     départ déclarait (`figerFiltres`). Le LFS du projet reste appliqué ;
//     ce que l'agent ajoute ne choisit plus aucun filtre. Pilotes de diff :
//     `--no-ext-diff --no-textconv`.
//   · Les objets de la tâche, par `alternates` : des données, LUES seulement —
//     jamais sa configuration ni ses crochets, et rien n'est écrit hors du
//     registre. L'agent peut les corrompre ou les effacer (le diff ÉCHOUE
//     alors, visiblement), ou faire de `.git` un lien vers un autre dépôt qui
//     contient le commit de départ (le diff se calcule alors avec SES objets,
//     en lecture) ; il ne peut pas les faire exécuter. Il peut aussi en
//     FORGER un — un objet valide rangé sous le nom d'un autre : git ne
//     vérifie pas l'empreinte de ce qu'il lit (mesuré, git 2.53), et une
//     lecture de la base par le registre rend alors le contenu forgé, sans un
//     mot. Ce qui doit être la base À COUP SÛR passe donc par `extraireBase`
//     (un `fetch`, qui renomme chaque objet par son contenu) ; les lectures
//     directes de la base (`fichierDeBase`) y restent exposées — suite nommée.
//   · Les configurations SYSTÈME et GLOBALE : celles de la machine et du
//     membre, jamais montées dans le bac. On ne les coupe pas
//     (`shared/git-protege.ts`) : elles portent ce dont le clone a besoin, les
//     assistants d'identifiants et les certificats du membre.
//
// Au niveau `processus` (aucun moteur de conteneurs), l'agent peut écrire
// partout sous l'utilisateur du membre, registre compris : il n'y a alors pas
// de bac dont sortir, et `constat()` le dit déjà (isolement.ts).

import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { effacerDossier } from '../shared/effacement.js';
import { EchecGitHote, gitHote, type DepotEpingle } from '../shared/git-protege.js';

/**
 * `info/attributes` : ce fichier du git dir PRIME sur tous les `.gitattributes`
 * de l'arbre (gitattributes(5)). Il porte `* -filter` — aucun filtre
 * `clean`/`smudge`/`process` ne s'applique, quel que soit le `.gitattributes`
 * qui le demande — PUIS les affectations de filtre du commit de départ, lues
 * dans l'index que seul git a écrit : la dernière ligne qui correspond gagne,
 * donc le filtre que le PROJET déclare (Git LFS) s'applique encore.
 *
 * Sans cette seconde partie, un fichier LFS intact sortait modifié de chaque
 * diff (l'arbre porte le contenu, la base le pointeur), `git apply` refusait
 * la fusion : toute tâche d'un projet LFS finissait en faux conflit.
 *
 * Un `.gitattributes` de sous-dossier se réécrit contre la racine : un motif
 * sans `/` vaut à toute profondeur SOUS son dossier (préfixe `d/**`), un
 * motif avec `/` est relatif à ce dossier. Écarts assumés, faute de cas
 * réels : un motif entre guillemets et une macro (`[attr]`) qui porterait
 * `filter` ne sont pas repris — ces fichiers restent alors sans filtre, et
 * sortent modifiés du diff : visiblement.
 */
async function figerFiltres(depot: DepotEpingle): Promise<void> {
  const lignes = ['* -filter'];
  // `-s` : le mode — un `.gitattributes` lien symbolique n'est pas lu par git.
  const entrees = await gitHote(['ls-files', '-s', '-z', '--', ':(glob)**/.gitattributes'], depot);
  const fichiers: { blob: string; dossier: string }[] = [];
  for (const entree of entrees.split('\0')) {
    const m = /^100\d{3} ([0-9a-f]+) 0\t(.+)$/.exec(entree);
    if (m?.[1] && m[2]) fichiers.push({ blob: m[1], dossier: path.posix.dirname(m[2]) });
  }
  // Du moins profond au plus profond : le plus profond gagne, comme dans l'arbre.
  const profondeur = (d: string): number => (d === '.' ? 0 : d.split('/').length);
  fichiers.sort((a, b) => profondeur(a.dossier) - profondeur(b.dossier));
  for (const { blob, dossier } of fichiers) {
    for (const ligne of (await gitHote(['cat-file', 'blob', blob], depot)).split(/\r?\n/)) {
      const [motif, ...attributs] = ligne.trim().split(/\s+/);
      const filtres = attributs.filter((a) => /^[-!]?filter(=|$)/.test(a));
      if (!motif || filtres.length === 0 || /^([#!"]|\[attr\])/.test(motif)) continue;
      lignes.push(`${relatifALaRacine(dossier, motif)} ${filtres.join(' ')}`);
    }
  }
  mkdirSync(path.join(depot.gitDir, 'info'), { recursive: true });
  writeFileSync(path.join(depot.gitDir, 'info', 'attributes'), `${lignes.join('\n')}\n`);
}

/** Un motif du `.gitattributes` de `dossier`, réécrit pour la racine. */
function relatifALaRacine(dossier: string, motif: string): string {
  if (dossier === '.') return motif;
  const sansFinale = motif.replace(/\/$/, '');
  return sansFinale.includes('/')
    ? `${dossier}/${motif.replace(/^\//, '')}`
    : `${dossier}/**/${motif}`;
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
  // git le chercherait. L'index vient avec son cache de dates : sans lui,
  // chaque fichier serait relu. Et avec ses `sharedindex.*` : sous un
  // `core.splitIndex=true` du membre, l'index n'est qu'un renvoi vers eux, et
  // sans eux chaque diff échouait (« index file open failed »).
  const aCopier = readdirSync(source).filter(
    (f) => f === 'shallow' || f === 'index' || f.startsWith('sharedindex.'),
  );
  for (const fichier of aCopier) {
    copyFileSync(path.join(source, fichier), path.join(registre, fichier));
  }
  const depot = { gitDir: registre, workTree };
  await figerFiltres(depot);
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
export async function diffContreBase(
  depot: DepotEpingle,
  base: string | null,
  exclus: readonly string[] = [],
): Promise<string> {
  // `exclus` : des chemins (relatifs à la racine) tenus HORS du diff et de
  // l'index — la configuration d'agent écartée pendant qu'il tourne
  // (`Workspace.diffEnCours`). Littéraux : un nom de fichier n'est pas un motif.
  const chemins =
    exclus.length > 0 ? ['--', '.', ...exclus.map((c) => `:(top,literal,exclude)${c}`)] : [];
  await gitHote(['add', '--all', '--intent-to-add', ...chemins], depot);
  return gitHote(
    [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      // Un dépôt IMBRIQUÉ dans l'arbre est un sous-module aux yeux de git, et
      // juger s'il est « sale » lancerait un `git status` DANS ce dépôt — avec
      // SA configuration, que l'agent a écrite. `dirty` coupe CE jugement-là
      // (aucun processus lancé, vérifié sous GIT_TRACE) mais garde la ligne
      // `Subproject commit` : le dépôt imbriqué reste VISIBLE à la revue — son
      // contenu n'y est pas, et `all` le faisait disparaître sans un mot.
      '--ignore-submodules=dirty',
      ...(base !== null ? [base] : []),
      ...chemins,
    ],
    depot,
  );
}

/**
 * Un commit du registre, extrait dans `dossier` — un dépôt NEUF, détaché —,
 * pour y rejouer les tests que le projet déclare (G11b) : la BASE
 * (`extraireBase`), ou l'arbre que la production LIVRE (`extraireLivre`).
 *
 * ─── PAR UN `fetch` DEPUIS LE REGISTRE, JAMAIS EN LISANT SES OBJETS ─────────
 *
 * Le registre emprunte les objets de la tâche (`alternates`), et l'agent a pu
 * les réécrire. Or git ne vérifie pas l'empreinte d'un objet qu'il LIT —
 * mesuré (git 2.53) : un objet libre forgé sous le nom d'un blob de la base
 * est rendu tel quel par `cat-file` comme par `checkout`. Une base extraite
 * ainsi pourrait faire échouer à la base un test que la production a cassé :
 * « déjà rouge à la base », excusé — exactement ce que la comparaison doit
 * rendre impossible, et sans une ligne dans le diff. Une tête extraite ainsi
 * pourrait passer là où la première exécution a échoué : « instable ».
 *
 * Un `fetch`, lui, RENOMME chaque objet reçu d'après son contenu
 * (`index-pack`, `unpack-objects`), puis vérifie que le commit reçu est
 * complet. Un objet forgé n'arrive donc jamais sous le nom qu'il usurpe :
 * mesuré, quand seule la copie forgée existe, le `fetch` échoue (« remote did
 * not send all necessary objects ») — et le rejeu avec lui, sans rien excuser.
 *
 * Le dépôt reçu a SES objets et son `.git` dans `dossier` : les tests y voient
 * un dépôt git, comme ceux de la tâche, et le bac ne monte que `dossier`. Rien
 * de la tâche n'y entre, rien de ce qu'il contient ne gouverne un git de
 * l'hôte après coup — on n'y relance plus rien, on l'efface.
 *
 * BORNÉE EN TOUT : `delaiMs` couvre l'effacement d'un reste, l'`init`, le
 * `fetch`, la vérification et le `checkout` — c'est ce que la ligne de
 * progression annonce (`node-client/validations-bac.ts`). L'effacement d'un
 * reste passe par la porte unique (`effacerDossier`) : ASYNCHRONE — un rejeu
 * laissé par un nœud tué porte un `node_modules` entier, et `rmSync` gèlerait
 * la boucle du nœud —, ses reprises au sommet seulement (5,5 s au plus).
 */
async function extraireCommit(
  depot: DepotEpingle,
  ref: string,
  attendu: string,
  dossier: string,
  delaiMs: number,
): Promise<void> {
  const echeance = Date.now() + delaiMs;
  const reste = (): { delaiMs: number } => {
    const ms = echeance - Date.now();
    if (ms <= 0)
      throw new Error(`extraction abandonnée au-delà de ${Math.round(delaiMs / 1000)} s`);
    return { delaiMs: ms };
  };
  await effacerDossier(dossier);
  mkdirSync(dossier, { recursive: true });
  // `--template=` vide : aucun crochet — pas même ceux d'un `init.templateDir`
  // du membre. Un commit de 64 caractères vient d'un dépôt SHA-256.
  const format = attendu.length === 64 ? ['--object-format=sha256'] : [];
  await gitHote(['init', '-q', '--template=', ...format, dossier], path.dirname(dossier), reste());
  const recu = { gitDir: path.join(dossier, '.git'), workTree: dossier };
  await gitHote(['fetch', '-q', '--no-tags', '--depth=1', '--', depot.gitDir, ref], recu, reste());
  const tete = (
    await gitHote(['rev-parse', '--verify', '-q', 'FETCH_HEAD^{commit}'], recu, reste())
  ).trim();
  if (tete !== attendu) throw new Error(`commit reçu ${tete}, attendu ${attendu}`);
  await gitHote(['checkout', '-q', '--detach', attendu], recu, reste());
}

/** Le délai d'une extraction à part, en tout (`extraireCommit`). */
export const DELAI_EXTRACTION_MS = 5 * 60_000;

/** La BASE d'une tâche, extraite à part (`extraireCommit`). */
export async function extraireBase(
  depot: DepotEpingle,
  base: string,
  dossier: string,
  delaiMs = DELAI_EXTRACTION_MS,
): Promise<void> {
  // HEAD du registre est épinglée sur la base (`poserRegistre`) — hors du bac,
  // l'agent ne l'a pas déplacée ; le commit reçu est revérifié quand même.
  await extraireCommit(depot, 'HEAD', base, dossier, delaiMs);
}

/**
 * Fige l'arbre que la production LIVRE — tout ce que git n'ignore pas, tel
 * qu'il est avant que la moindre validation ne tourne — et rend son
 * empreinte. Les validations exécutent du code que l'agent a écrit, dans ce
 * même répertoire : ce qu'une exécution y laisse (un marqueur, un cache, un
 * fichier réécrit) changerait la suivante. C'est cet arbre-ci, et lui seul,
 * qu'une seconde exécution de la tête rejoue (`extraireLivre`) — comme la
 * livraison, qui n'applique que lui.
 *
 * Par le registre, comme le diff : l'index de la tâche, que l'agent a eu entre
 * les mains, n'est pas lu. L'index du REGISTRE, lui, en sort rempli : rien ne
 * le relit après les validations.
 */
export async function figerArbreLivre(depot: DepotEpingle): Promise<string> {
  await gitHote(['add', '--all'], depot);
  return (await gitHote(['write-tree'], depot)).trim();
}

/** La référence, dans le registre, du commit qui porte l'arbre livré. */
const REF_LIVRE = 'refs/hive/livre';

/**
 * L'auteur de ce commit-là, posé dans l'environnement comme celui d'une
 * livraison locale (`livraison-locale.ts`) : il ne quitte jamais le nœud.
 */
const AUTEUR_ARBRE_LIVRE = {
  GIT_AUTHOR_NAME: 'Hive',
  GIT_AUTHOR_EMAIL: 'hive@hive.invalid',
  GIT_COMMITTER_NAME: 'Hive',
  GIT_COMMITTER_EMAIL: 'hive@hive.invalid',
} as const;

/**
 * L'arbre LIVRÉ (`figerArbreLivre`), extrait à part comme la base : un commit
 * sans parent qui le porte, une référence du registre, puis le même `fetch`
 * (`extraireCommit`) — un objet que l'agent aurait forgé sous le nom d'un
 * fichier livré n'y arrive pas plus que sous celui d'un fichier de la base.
 */
export async function extraireLivre(
  depot: DepotEpingle,
  arbre: string,
  dossier: string,
  delaiMs = DELAI_EXTRACTION_MS,
): Promise<void> {
  const debut = Date.now();
  const bornes = { delaiMs, identite: AUTEUR_ARBRE_LIVRE };
  const commit = (
    await gitHote(['commit-tree', '-m', 'arbre livré (validations du bac)', arbre], depot, bornes)
  ).trim();
  await gitHote(['update-ref', REF_LIVRE, commit], depot, { delaiMs });
  await extraireCommit(depot, REF_LIVRE, commit, dossier, delaiMs - (Date.now() - debut));
}

/**
 * Épingle un dépôt que le NŒUD a cloné et où aucun code étranger n'a encore
 * tourné (le clone d'un merge) : son git dir est de confiance, on le garde, et
 * on y fige les filtres du commit cloné — un `.gitattributes` qu'un diff
 * appliquerait ensuite n'en choisit aucun (`figerFiltres`).
 */
export async function epinglerClone(repoDir: string): Promise<DepotEpingle> {
  // Absolus : `-C <arbre>` passe AVANT `--git-dir` (gitHote).
  const workTree = path.resolve(repoDir);
  const depot = { gitDir: path.join(workTree, '.git'), workTree };
  await figerFiltres(depot);
  return depot;
}
