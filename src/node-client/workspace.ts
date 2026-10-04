// Préparation du répertoire de travail d'une tâche.
//
// Ce que CE fichier fournit : un cwd dédié par tâche, un environnement épuré
// (pas de HOME/USERPROFILE ni variables du membre), TEMP redirigé dans la
// tâche, une branche git `hive/<taskId>` quand le projet a un dépôt (ou, pour
// une reprise, la branche de la pull request qu'elle prolonge) — et le
// diff de revue, calculé par le git dir de la RUCHE, jamais par le `.git` que
// l'agent a eu entre les mains (`git-hote.ts`).
//
// ─── CE N'EST PAS TOUT L'ISOLEMENT, ET CE COMMENTAIRE L'A CRU LONGTEMPS ──────
//
// Il annonçait « pas encore de VM/conteneur » et promettait Firecracker « à
// l'itération suivante ». Les deux affirmations sont fausses aujourd'hui :
//
//   · `isolement.ts` EXISTE et enveloppe l'agent dans podman, docker ou
//     bubblewrap — au niveau `conteneur`, l'agent ne voit que le répertoire
//     préparé ici, ni le HOME du membre ni ses clés ;
//   · Firecracker est REFUSÉ, avec sa raison, par l'ADR 0009 (pas de KVM sur
//     macOS, Windows 11 + virtualisation imbriquée + droits admin contre
//     « aucun sudo, jamais »).
//
// Ce qui reste vrai : SANS moteur de conteneurs, il ne reste que ce
// répertoire-ci, et le disque entier demeure lisible sous l'utilisateur du
// membre. C'est le niveau `processus` de `constat()`, et c'est là — pas ici —
// que la vérité de l'isolement s'écrit.

import { mkdirSync, promises as fsp, rmSync } from 'node:fs';
import path from 'node:path';
import { CLONE_MS } from '../shared/butoirs-noeud.js';
import type { Task } from '../shared/types.js';
import { segmentSur } from '../shared/noms-windows.js';
import { EchecGitHote, commandeSshDuMembre, gitHote } from '../shared/git-protege.js';
import { estBrancheDeLivraison } from '../shared/protocol.js';
import type { DepotEpingle } from '../shared/git-protege.js';
import { commitDeDepart, diffContreBase, poserRegistre } from './git-hote.js';
import { ecarterConfiguration, reserveDeConfiguration } from './configuration-inerte.js';
import type { ConfigurationEcartee } from './configuration-inerte.js';

export interface Workspace {
  /** Répertoire de travail isolé de la tâche. */
  cwd: string;
  branch: string | null;
  /**
   * Le commit CLONÉ, épinglé avant que l'agent ne touche à rien ; `null` sans
   * dépôt, ou pour un dépôt sans commit.
   *
   * Pas « HEAD au moment où on le demande » : l'agent écrit dans ce dépôt, et
   * un `git commit` de sa part déplace HEAD. Relu après coup, HEAD nommerait
   * le commit de l'agent comme « base » — et ce qu'il y a committé
   * disparaîtrait du diff comme des déclarations que le bac compare.
   */
  baseSha: string | null;
  /**
   * Le dépôt ÉPINGLÉ sur le registre de la ruche (`git-hote.ts`) — la SEULE
   * porte par laquelle l'hôte relit ce dépôt après l'agent (diff, validations
   * du bac) ; `null` sans dépôt.
   */
  depot: DepotEpingle | null;
  /** Environnement épuré pour les processus enfants. */
  env: NodeJS.ProcessEnv;
  /**
   * La configuration d'agent du dépôt écartée de l'arbre pendant l'exécution
   * (`configuration-inerte.ts`), relative à sa racine — vide s'il n'y avait
   * rien à écarter. Le nœud le dit au journal de la tâche.
   */
  configurationEcartee: readonly string[];
  /**
   * Diff des modifications, pour revue humaine (vide sans dépôt git). Remet
   * d'abord en place la configuration écartée : elle n'y paraît pas comme une
   * suppression, et les validations qui suivent voient l'arbre entier.
   */
  collectDiff(): Promise<string>;
  /** Supprime le répertoire de la tâche. */
  cleanup(): void;
}

/** Secrets de la ruche qui ne doivent jamais devenir des variables d'agent. */
const SECRETS_INTERDITS_AGENT = new Set([
  'HIVE_TOKEN',
  'HIVE_JWT_SECRET',
  'HIVE_INVITE',
  'HIVE_GITHUB_TOKEN',
  'HIVE_WEBHOOK_SECRET',
  'GITHUB_TOKEN',
]);

/**
 * Retire du répertoire d'une tâche tout ce que git IGNORE — `node_modules`,
 * sorties de build, `.env`. Par le registre (`git-hote.ts`) : un
 * `.git/info/exclude` que l'agent aurait écrit n'y est pas lu, et ce qu'il
 * cacherait reste donc dans le diff, sous les yeux de la revue.
 *
 * Les validations du bac jugent la BASE plus le DIFF, exactement ce qu'une
 * livraison ou un merge appliquera. Un fichier ignoré n'est dans aucun des
 * deux : c'est l'environnement que l'agent s'est fabriqué, hors de la vue de
 * tout relecteur. Un `node_modules/.bin/node` qui rend 0, laissé par l'agent
 * dans un projet sans dépendances, faisait passer des tests qui échouent
 * partout ailleurs — `npm run` met ce dossier en tête du PATH.
 *
 * Les fichiers SUIVIS ne bougent pas (`-X` ne vise que les ignorés), et le
 * diff a déjà été calculé : rien de ce qui est livré ne change. L'écriture vit
 * ICI parce que ce fichier possède le répertoire de tâche : l'inventaire de ce
 * que Hive écrit sur la machine d'un membre (`empreinte.ts`) reste vrai.
 */
export async function retirerFichiersIgnores(depot: DepotEpingle): Promise<void> {
  // `-ff` : aussi les dépôts imbriqués ignorés ; `-d` : les dossiers entiers.
  await gitHote(['clean', '-ffdX'], depot);
}

/**
 * Où un côté d'une tâche est REJOUÉ à part pour comparer ses tests (G11b,
 * `node-client/validations-bac.ts`) — sa base, et l'arbre que la production
 * livre : À CÔTÉ de la tâche, comme son TEMP et son registre, hors de ce que
 * le bac de la tâche monte. Effacés par les validations dès la comparaison
 * faite, et ici avec le reste si un nœud tué les a laissés.
 */
export const dossierDeBase = (cwd: string): string => `${cwd}.base`;
export const dossierDeTete = (cwd: string): string => `${cwd}.tete`;

/**
 * Efface un rejeu à part, et son TEMP (`buildSandboxEnv`). Ici, parce que ce
 * fichier possède le répertoire de tâche et ses voisins : l'inventaire de ce
 * que Hive écrit chez le membre (`empreinte.ts`) reste vrai.
 *
 * ASYNCHRONE, en UNE passe : un rejeu porte un `node_modules` complet, et
 * l'effacer en synchrone, en pleine tâche, gelait la boucle du nœud — sans
 * battement au-delà de `NODE_TIMEOUT_MS` (15 s), la Reine le déclare hors
 * ligne. Pas de `maxRetries` : l'option multiplie les reprises par niveau de
 * dossier (le piège de #538/#552). Ce qui reste (un fichier verrouillé sous
 * Windows), le prochain `prepareWorkspace` de la tâche, ou son `cleanup`, le
 * reprendra. Ne lève jamais : rien ne doit emporter le résultat de la tâche.
 */
export async function effacerRejeu(dossier: string): Promise<void> {
  const options = { recursive: true, force: true } as const;
  await Promise.all([fsp.rm(dossier, options), fsp.rm(`${dossier}.tmp`, options)]).catch(
    () => undefined,
  );
}

/** Les deux rejeux d'une tâche — sa base, sa tête. */
async function effacerRejeux(cwd: string): Promise<void> {
  await Promise.all([effacerRejeu(dossierDeBase(cwd)), effacerRejeu(dossierDeTete(cwd))]);
}

export function variablesAgentSansSecrets(variables: readonly string[]): string[] {
  return variables.filter((name) => !SECRETS_INTERDITS_AGENT.has(name));
}

/**
 * Environnement minimal pour la sandbox v0. Seuls PATH et les variables
 * système indispensables passent ; `keepEnv` permet d'ajouter explicitement
 * des variables nécessaires à un agent réel (ex. ANTHROPIC_API_KEY). Les
 * secrets de la ruche restent exclus même si `keepEnv` les nomme ; ils restent
 * locaux au nœud, jamais transmis au CLI ni au hub.
 */
export function buildSandboxEnv(cwd: string, keepEnv: string[] = []): NodeJS.ProcessEnv {
  // TEMP vit À CÔTÉ du workspace, pas dedans : le clone git exige un répertoire
  // vide et le diff de revue ne doit pas être pollué par des fichiers temporaires.
  const tmp = `${cwd}.tmp`;
  mkdirSync(tmp, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    // Indispensables à beaucoup d'outils Windows ; inoffensifs ailleurs.
    SYSTEMROOT: process.env.SYSTEMROOT,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    TEMP: tmp,
    TMP: tmp,
    TMPDIR: tmp,
    HIVE_TASK_CWD: cwd,
  };
  for (const name of variablesAgentSansSecrets(keepEnv)) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * Clone superficiel d'un dépôt dans `dir` (vide ou inexistant) — la même porte
 * que le clone d'une tâche : environnement épuré, `ext::` neutralisé, aucune
 * invite (ni de git, ni de GCM, ni de `ssh`). Voir `git-hote.ts` : c'est aussi
 * l'environnement de la livraison locale, qui POUSSE avec exactement les
 * identifiants qui ont servi au clone (`livraison-locale.ts`).
 *
 * ─── BORNÉ, PARCE QUE LE HUB COMPTE DESSUS ─────────────────────────────────
 *
 * Ce clone ouvre chaque merge, chaque chantier et chaque tâche, et il n'avait
 * aucun butoir : un dépôt qui accepte la connexion puis se tait laissait le
 * travail pendre chez le nœud, sans résultat, pendant que le hub — qui dérive
 * ses délais des butoirs du nœud (`butoirs-noeud.ts`) — ne pouvait que DEVINER
 * sa durée. Au-delà de `delaiMs`, git est TUÉ (le `timeout` d'`execFile`,
 * `gitHote`), et le travail échoue en le disant. Un `Promise.race` rendrait la
 * main en laissant le processus pendre derrière.
 *
 * Limite, dite : c'est le processus LANCÉ qui est tué. Sous Windows, où le `git`
 * du PATH est d'ordinaire un lanceur, le vrai git peut lui survivre jusqu'à ce
 * que le dépôt ferme (mesuré, `tests/clone-borne.test.ts`) — `gitHote` tue son
 * processus, pas son arbre (les agents et les commandes du dépôt, eux, partent
 * en entier : `arbre-processus.ts`). Le travail échoue à l'heure partout.
 */
export async function cloneRepo(
  dir: string,
  repoUrl: string,
  delaiMs = CLONE_MS,
  /** Cloner CETTE branche plutôt que la branche par défaut (une reprise). */
  branche?: string,
): Promise<void> {
  const parent = path.dirname(path.resolve(dir));
  // git crée lui-même les dossiers de `dir`, mais il se LANCE depuis `parent`
  // (`gitHote`) : absent, le clone mourait en « spawn git ENOENT ».
  mkdirSync(parent, { recursive: true });
  const ssh = await commandeSshDuMembre(parent);
  try {
    // `--` : une URL qui commencerait par un tiret ne devient pas une option.
    // `--branch=` d'un seul tenant, pour la même raison : la valeur ne peut
    // pas être relue comme une option (`estBrancheDeLivraison` l'interdit déjà).
    await gitHote(
      ['clone', '--depth', '1', ...(branche ? [`--branch=${branche}`] : []), '--', repoUrl, dir],
      parent,
      { ssh, delaiMs },
    );
  } catch (err) {
    if (!(err instanceof EchecGitHote && err.delaiDepasse)) throw err;
    const duree =
      delaiMs >= 60_000 ? `${Math.round(delaiMs / 60_000)} min` : `${Math.ceil(delaiMs / 1000)} s`;
    throw new Error(`clone abandonné après ${duree} — dépôt injoignable ou muet`, { cause: err });
  }
}

export async function prepareWorkspace(
  workRoot: string,
  task: Task,
  repoUrl: string | null,
  keepEnv: string[] = [],
  // Suffixe d'instance (nodeId court) : deux nœuds partageant le même workRoot
  // (démo/tests locaux) peuvent exécuter la MÊME tâche en parallèle (Drone
  // Wars) sans se détruire mutuellement le répertoire.
  instanceId = '',
  /**
   * La tâche PROLONGE une livraison (`assign_task.prolonger`) : `task.branch`
   * est la branche de sa pull request. On la clone et on travaille sur SA tête
   * — le travail d'origine y est, et le diff rendu ne contient que la
   * correction, exactement ce que la livraison posera par-dessus.
   */
  prolonger = false,
  // Les chemins du dépôt que le CLI de l'agent EXÉCUTERAIT sans interrupteur
  // pour l'en empêcher (`AgentAdapter.configurationExecutee`).
  configurationAgent: readonly string[] = [],
): Promise<Workspace> {
  const tasksRoot = path.resolve(workRoot, 'tasks');
  // `segmentSur` : un id valide peut être un nom que Windows réserve (`aux`,
  // `nul`…), et `mkdir` y viserait un périphérique (`shared/noms-windows.ts`).
  const dirName = segmentSur(instanceId ? `${task.id}-${instanceId}` : task.id);
  const cwd = path.resolve(tasksRoot, dirName);
  // Confinement strict : le cwd DOIT rester sous <workRoot>/tasks. Défense en
  // profondeur contre un task.id malveillant (« ../… » ou chemin absolu) qui
  // ferait pointer rmSync/clone hors du répertoire de travail. La validation
  // de task.id (ID_PATTERN) côté client et protocole est la première barrière ;
  // ceci en est la seconde, au plus près du sink destructeur.
  if (cwd !== tasksRoot && !cwd.startsWith(tasksRoot + path.sep)) {
    throw new Error(`chemin de tâche hors du répertoire de travail : ${task.id}`);
  }
  // Le REGISTRE de la ruche (`git-hote.ts`) : le git dir que l'hôte lit, À
  // CÔTÉ de la tâche comme son TEMP — hors de ce que le bac monte.
  const registre = `${cwd}.git`;
  // Repartir d'un répertoire vierge à chaque tentative. maxRetries absorbe les
  // verrous transitoires de fichiers sous Windows (antivirus, handle git résiduel)
  // qui, sinon, feraient échouer la tâche à durée nulle et brûleraient un essai.
  const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;
  rmSync(cwd, rmOpts);
  rmSync(`${cwd}.tmp`, rmOpts);
  rmSync(registre, rmOpts);
  rmSync(reserveDeConfiguration(cwd), rmOpts);
  await effacerRejeux(cwd);
  mkdirSync(cwd, { recursive: true });

  let branch: string | null = null;
  let baseSha: string | null = null;
  let depot: DepotEpingle | null = null;
  // Revalidé ICI, au plus près du clone, comme le chemin de la tâche : le
  // protocole l'a déjà refusé, mais c'est ce nom qui part à `git clone`.
  if (prolonger && !estBrancheDeLivraison(task.branch)) {
    throw new Error(`branche de livraison invalide pour une reprise : ${task.id}`);
  }
  let ecartee: ConfigurationEcartee | null = null;
  if (repoUrl) {
    // Le clone exige un répertoire vide : il précède toute écriture dans cwd.
    // Tout ce qui suit, jusqu'à `poserRegistre`, se passe AVANT l'agent, dans
    // un dépôt que seul git a écrit.
    const depotDuClone = { gitDir: path.join(cwd, '.git'), workTree: cwd };
    if (prolonger && task.branch) {
      // ─── UNE REPRISE CONTINUE LA BRANCHE DE SA PR ─────────────────────────
      // Le clone était celui de la branche par défaut, suivi d'un `checkout
      // -b` : l'ouvrière d'une reprise n'avait PAS le travail de la PR qu'on
      // lui demandait de corriger, et son diff ne pouvait devenir qu'une
      // seconde PR. Cloner la branche la laisse extraite à sa tête ; la base
      // épinglée est cette tête.
      await cloneRepo(cwd, repoUrl, CLONE_MS, task.branch);
      branch = task.branch;
    } else {
      await cloneRepo(cwd, repoUrl);
      // Une tâche = une branche isolée. Jamais de travail direct sur main (§5.2).
      branch = task.branch ?? `hive/${task.id}`;
      await gitHote(['checkout', '-q', '-b', branch], depotDuClone);
    }
    baseSha = await commitDeDepart(depotDuClone);
    depot = await poserRegistre(cwd, registre, baseSha);
    // APRÈS le registre, qui copie index et configuration sans l'extraction
    // clairsemée ; AVANT l'agent, tant que le `.git` de la tâche n'a été écrit
    // que par git.
    ecartee = await ecarterConfiguration(depotDuClone, configurationAgent);
  }

  const env = buildSandboxEnv(cwd, keepEnv);

  return {
    cwd,
    branch,
    baseSha,
    depot,
    env,
    configurationEcartee: ecartee?.chemins ?? [],
    async collectDiff(): Promise<string> {
      ecartee?.remettre();
      // Par le registre, jamais par le `.git` de la tâche : c'est l'agent qui
      // l'a eu entre les mains (git-hote.ts). CONTRE LA BASE ÉPINGLÉE, pas
      // contre l'index : ce que l'agent a `git add` ou committé reste dans la
      // revue, la livraison et le merge.
      return depot ? diffContreBase(depot, baseSha) : '';
    },
    cleanup(): void {
      try {
        rmSync(cwd, rmOpts);
        rmSync(`${cwd}.tmp`, rmOpts);
        rmSync(registre, rmOpts);
        rmSync(reserveDeConfiguration(cwd), rmOpts);
        // Les rejeux sont déjà effacés par les validations : ceci rattrape un
        // reste, sans retenir le nœud.
        void effacerRejeux(cwd);
      } catch {
        // Fichier verrouillé (Windows) : le prochain run de la tâche nettoiera.
      }
    },
  };
}
