// Honeycomb Merge — exécution réelle côté nœud (Palier 3).
//
// Applique les diffs des tâches terminées, DANS L'ORDRE du plan de merge, sur un
// dépôt git local (un clone jetable à la base d'intégration). Chaque diff est
// d'abord vérifié (`git apply --check`) : s'il ne s'applique pas proprement sur
// l'état accumulé, c'est un CONFLIT réel (pas seulement l'heuristique de lignes) —
// on l'écarte et on continue. En l'absence de conflit, l'environnement est
// préparé si on l'a demandé (`npm ci`…), puis une commande de test optionnelle
// est lancée (`spawn`, shell:false — contrainte §5.1).
//
// L'ORDRE COMPTE, et pas seulement pour que les tests trouvent leurs
// dépendances : le diff cumulé est calculé AVANT la préparation, sinon les
// `node_modules` que celle-ci installe se retrouveraient dans ce qu'on soumet à
// la revue humaine.
//
// Sans demande de livraison : ne fait NI commit NI push (jamais de merge auto
// sur main). Le résultat (diff cumulé + verdict tests) remonte pour revue
// humaine, et le clone est jeté.
//
// AVEC une demande de livraison (`livraison`, décidée par un humain au hub,
// Evaluator écouté) : l'arbre intégré est capturé et son commit COMPOSÉ AVANT
// la préparation — avant que le code du dépôt ne tourne dans le clone —, puis
// gardé sur `hive/mission-<projectId>-<n>` si — et seulement si — tout s'est
// appliqué et que ni la préparation ni les tests n'ont échoué. Après eux, plus
// aucune commande git dans le clone. Jamais sur la branche principale, jamais
// de poussée forcée (`livraison-locale.ts`).

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { ENTREE_FERMEE } from '../adapters/exec.js';
import { MERGE_PREPARATION_MS, MERGE_TESTS_MS } from '../shared/butoirs-noeud.js';
import { jugerCommandeTest } from '../shared/commande-test.js';
import { jugerPreparation } from '../shared/preparation.js';
import type { Arret } from '../shared/validations-bac.js';
import { LanceurIndisponible, resoudreLanceur } from '../lanceur-reel.js';
import { envelopper } from './isolement.js';
import type { Fournisseur } from './isolement.js';
import { composerMission, garderMission } from './livraison-locale.js';
import type { LivraisonDuNoeud, MissionComposee } from './livraison-locale.js';
import type { RapportDuNoeud } from '../shared/livraison-locale.js';
import { buildSandboxEnv } from './workspace.js';

export interface MergeDiff {
  taskId: string;
  diff: string;
}

export interface MergeRunOptions {
  /** Dépôt git local (working copy positionné à la base d'intégration). */
  repoDir: string;
  /** Diffs des tâches, dans l'ordre de merge. */
  diffs: MergeDiff[];
  /**
   * Préparation de l'environnement, lancée AVANT les tests.
   *
   * `npm test` sur un clone frais échoue faute de `node_modules`, et le verdict
   * qui remonte dit alors « tests en échec » là où il fallait lire
   * « environnement absent ». C'est cette confusion-là que la préparation
   * supprime — et si elle échoue, les tests ne sont PAS lancés : un verdict de
   * test sans dépendances ne vaut rien et se lirait comme une régression.
   */
  prepareCommand?: string[];
  /** Commande de test à lancer si aucun conflit (argv, jamais interprétée par un shell). */
  testCommand?: string[];
  /**
   * Le bac à sable du nœud, s'il en a un.
   *
   * IL MANQUAIT ICI, ET C'ÉTAIT LE TROU LE PLUS EMBARRASSANT DU LOT : les
   * adaptateurs de tâches passent tous par `runCommand`, qui enveloppe. Ce
   * chemin-ci ne passait par rien. Autrement dit `HIVE_ISOLEMENT=exige` — le
   * réglage qu'on pose précisément quand on prête sa machine à des inconnus —
   * empêchait bien un agent de sortir de son bac, pendant que la commande de
   * test d'un merge s'exécutait à côté, sur l'hôte nu.
   */
  bac?: { fournisseur: Fournisseur; variables: readonly string[]; image: string };
  /** Délai max de la commande de test (défaut 5 min). */
  timeoutMs?: number;
  /**
   * Délai max de la préparation (défaut 10 min).
   *
   * Plus large que celui des tests, et pour une raison bête : une installation
   * complète télécharge, et une machine de membre n'est pas une machine
   * d'intégration continue. Trop court, la garde qui protège devient la panne
   * qu'on ne comprend pas.
   */
  prepareTimeoutMs?: number;
  signal?: AbortSignal;
  /** Commiter le résultat intégré sur une branche de mission (cf. en-tête). */
  livraison?: LivraisonDuNoeud;
}

export interface MergeRunResult {
  /** taskIds appliqués proprement, dans l'ordre. */
  applied: string[];
  /** taskIds dont le diff n'a pas pu s'appliquer (conflit réel). */
  conflicts: { taskId: string; reason: string }[];
  /** Diff cumulé après application des diffs propres (pour revue humaine). */
  mergedDiff: string;
  /** Commande de test lancée ? (non lancée s'il y a des conflits ou pas de commande). */
  testsRun: boolean;
  /** Résultat des tests (null si non lancés). */
  testsPassed: boolean | null;
  /**
   * Verdict de la préparation : `null` si aucune n'a été demandée ou lancée.
   *
   * Distinct de `testsPassed` exprès. « L'environnement ne s'installe pas » et
   * « les tests échouent » demandent deux gestes différents de l'hôte, et les
   * confondre en un seul booléen l'enverrait corriger du code qui va bien.
   */
  preparedOk: boolean | null;
  logs: string;
  /** Ce qu'est devenue la livraison demandée ; absent si aucune ne l'était. */
  livraison?: RapportDuNoeud;
}

const OUTPUT_CAP = 512 * 1024;

/**
 * Le temps laissé à une commande ARRÊTÉE pour mourir, puis à ses tubes pour se
 * fermer une fois qu'elle est sortie.
 *
 * Deux secondes : assez pour que `docker run` relaie un SIGTERM à son
 * conteneur, trop peu pour qu'un orphelin tienne une tâche. Au-delà, la
 * commande est tenue pour finie, que ses descendants aient lâché la sortie ou
 * non — c'est ce qui fait de `timeoutMs` une BORNE, et pas un souhait.
 */
export const GRACE_ARRET_MS = 2_000;

/**
 * La sortie d'une commande, bornée : son DÉBUT et sa FIN, jamais le milieu.
 *
 * Garder seulement le début, comme avant, perdait ce qui compte le plus dans
 * une suite bavarde : le résumé des échecs, que les runners impriment en
 * DERNIER. Les validations du bac n'en remontent que la fin (`extraitDe`), les
 * merges que le début (`slice(0, 4000)`) — chacun trouve ici ce qu'il lit.
 */
function sortieBornee(moitie = OUTPUT_CAP / 2): {
  ajouter: (morceau: string) => void;
  texte: () => string;
} {
  let debut = '';
  let fin = '';
  let omis = 0;
  return {
    ajouter(morceau) {
      const place = moitie - debut.length;
      if (place > 0) {
        debut += morceau.slice(0, place);
        morceau = morceau.slice(place);
      }
      fin += morceau;
      // Élaguer par paliers, pas à chaque morceau : une recopie de la fin par
      // morceau coûterait O(taille × morceaux) sur une sortie de centaines de Mo.
      if (fin.length > 2 * moitie) {
        omis += fin.length - moitie;
        fin = fin.slice(-moitie);
      }
    },
    texte() {
      const queue = fin.slice(-moitie);
      const total = omis + fin.length - queue.length;
      return total > 0 ? `${debut}\n[hive] … ${total} caractères omis …\n${queue}` : debut + queue;
    },
  };
}

/**
 * Emporte une commande ET sa descendance.
 *
 * Tuer le seul enfant direct ne suffit pas, et c'était une borne qui n'en
 * était pas une : `npm run test` lance un shell, qui lance le runner, qui
 * lance parfois un serveur. `child.kill()` n'atteint que npm ; le reste
 * survit, garde les tubes de sortie ouverts, et `close` n'arrive jamais — la
 * tâche qui attend ce `close` pour rendre son résultat reste pendue, et le
 * nœud finit saturé (`noeud_sature`) sans plus rien prendre.
 *
 *   · POSIX : l'enfant est lancé `detached`, donc chef de son GROUPE de
 *     processus ; `kill(-pid)` atteint tout le groupe d'un coup ;
 *   · Windows : `taskkill /T` suit l'arbre des parents. SYNCHRONE, parce que
 *     le répertoire de la tâche est effacé juste après, et qu'un dossier qui
 *     est le `cwd` d'un processus vivant ne s'efface pas (même leçon que
 *     `scripts/essai-entree.mjs`).
 *
 * Un descendant qui quitte le groupe (`setsid`) échappe à ceci ; la grâce de
 * `runProc` borne quand même l'attente.
 */
function emporterArbre(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    // Déjà mort, ou groupe déjà vide : il n'y a rien à arrêter.
  }
}

/**
 * Lance une commande (argv) dans un cwd, sans shell, sortie plafonnée, timeout dur.
 * L'environnement est ÉPURÉ (aucun secret du nœud transmis à l'enfant — cf. revue
 * sécurité Palier 3) : seuls PATH/variables système + un TEMP dédié passent.
 *
 * EXPORTÉ pour les Chantiers (lot 14), qui lancent une commande déclarée par le
 * dépôt dans un clone frais — même besoin exactement, y compris la résolution
 * de `npm` en `npm.cmd` sous Windows et l'enveloppe de bac à sable. En écrire
 * une seconde version aurait fait deux endroits où oublier l'isolement, et le
 * premier oubli de ce genre est déjà raconté trois lignes plus bas.
 *
 * `arret` dit quand le code ne vient PAS de la commande — délai dépassé,
 * lancement impossible, annulation. Les validations du bac en ont besoin :
 * un `code: 1` fabriqué ici n'est pas un verdict sur la production, et le
 * confondre avec un vrai échec enverrait corriger du code qui va bien.
 *
 * ─── LA BORNE TIENT, MÊME CONTRE LES DESCENDANTS ─────────────────────────────
 *
 * La promesse se résout au plus tard `timeoutMs + 2 × GRACE_ARRET_MS` après le
 * lancement, quoi que fasse la commande : au délai (ou à l'annulation), tout
 * son ARBRE reçoit SIGTERM, puis SIGKILL après la grâce ; et une commande
 * sortie dont un descendant tient encore la sortie est tenue pour finie après
 * la grâce. Attendre `close` seul pendait sans fin sur un `serveur &` oublié,
 * un runner qui ignore SIGTERM, ou — sous Windows — n'importe quel script.
 */
export function runProc(
  cmd: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
  bac?: { fournisseur: Fournisseur; variables: readonly string[]; image: string },
): Promise<{ code: number | null; output: string; arret?: Arret }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd;
    const sortie = sortieBornee();
    // ISOLEMENT — même enveloppe que les adaptateurs de tâches. Ce chemin n'y
    // passait pas, et c'était le trou le plus embarrassant : la commande de
    // test d'un merge exécute du code fourni par le dépôt, exactement comme un
    // agent, mais tournait sur l'hôte nu même sous `HIVE_ISOLEMENT=exige`.
    //
    // `cwdHote` est le clone : c'est lui qu'on monte, `.git` compris — d'où
    // la règle de `livraison-locale.ts` : git n'y relit PLUS RIEN après. Ce
    // que le code testé y a écrit ne gouverne aucune commande de l'hôte.
    // L'enveloppe ne déplace rien, elle restreint ce que le processus voit.
    // SOUS BAC À SABLE, ON NE TOUCHE À RIEN : l'enveloppe lance `docker` (un
    // vrai binaire partout) et la commande s'exécute DANS le conteneur, donc
    // sous Linux. Y appliquer une résolution Windows viserait la mauvaise
    // plateforme — c'est l'hôte qui est Windows, pas l'invité.
    let lance: { bin: string; args: string[] };
    if (bac) {
      lance = envelopper(bin ?? '', args, {
        fournisseur: bac.fournisseur,
        cwdHote: cwd,
        variables: bac.variables,
        image: bac.image,
      });
    } else {
      try {
        lance = resoudreLanceur(bin ?? '', args);
      } catch (e) {
        // Un refus MOTIVÉ vaut mieux qu'un `spawn ENOENT` : c'est la même
        // panne, mais celle-ci se lit.
        //
        // ÉQUIVALENCE CONSIGNÉE : muté en `instanceof Object`, rien ne bouge —
        // `resoudreLanceur` n'a que deux points de levée et les deux font
        // `throw new LanceurIndisponible(…)`. Il n'existe donc, par la surface
        // publique, aucune entrée qui produise ici une erreur d'un autre genre,
        // et le `throw e` d'en dessous n'est atteignable par aucun banc.
        //
        // La garde reste, et elle n'est pas décorative : sans elle, une panne
        // étrangère — un défaut de programmation, demain — serait avalée en
        // `{ code: 1, output: '[hive] undefined' }`, c'est-à-dire maquillée en
        // verdict de test. Un bug qui se présente comme un résultat est le pire
        // des deux.
        if (e instanceof LanceurIndisponible) {
          resolve({ code: 1, output: `\n[hive] ${e.motif}`, arret: 'lancement' });
          return;
        }
        throw e;
      }
    }
    if (signal?.aborted) {
      resolve({ code: 1, output: '\n[hive] annulée avant le lancement', arret: 'annule' });
      return;
    }
    const child = spawn(lance.bin, lance.args, {
      cwd,
      env,
      shell: false, // jamais d'interprétation shell (contrainte §5.1)
      windowsHide: true,
      // Chef de son groupe de processus, pour que `emporterArbre` atteigne
      // toute la descendance d'un seul `kill(-pid)`. Sans objet sous Windows,
      // où `detached` ouvrirait une console à part.
      detached: process.platform !== 'win32',
      // Personne n'écrit sur l'entrée d'une commande de test : ouverte, un
      // outil qui la lit jusqu'au bout attendrait le délai dur (voir exec.ts).
      // Et pas de `signal` ici : l'annulation passe par `arreter('annule')`,
      // qui emporte tout l'arbre — celui de `spawn` ne tuerait que l'enfant.
      stdio: ENTREE_FERMEE,
    });
    let fini = false;
    let sortiLe = false;
    let arret: Arret | undefined;
    const minuteurs: NodeJS.Timeout[] = [];
    const plus = (ms: number, geste: () => void): void => {
      const m = setTimeout(geste, ms);
      m.unref?.();
      minuteurs.push(m);
    };
    const terminer = (code: number | null, note = ''): void => {
      if (fini) return;
      fini = true;
      for (const m of minuteurs) clearTimeout(m);
      signal?.removeEventListener('abort', surAnnulation);
      // Un orphelin peut encore écrire : on ne l'écoute plus, et les tubes ne
      // retiennent plus la boucle d'événements du nœud.
      child.stdout?.destroy();
      child.stderr?.destroy();
      const fin = arret === 'delai' ? `\n[hive] timeout après ${timeoutMs} ms — processus tué` : '';
      resolve({ code, output: sortie.texte() + note + fin, ...(arret ? { arret } : {}) });
    };
    const arreter = (motif: Arret): void => {
      if (fini || arret) return;
      // Déjà sortie d'elle-même : son code est un vrai verdict, on le garde.
      if (sortiLe) {
        terminer(child.exitCode);
        return;
      }
      arret = motif;
      // SIGTERM d'abord : `docker run` le relaie à son conteneur, un runner
      // propre se ferme. Ce qui l'ignore est tué à la fin de la grâce, et la
      // promesse se résout de toute façon une grâce plus tard.
      emporterArbre(child, 'SIGTERM');
      plus(GRACE_ARRET_MS, () => {
        emporterArbre(child, 'SIGKILL');
        plus(GRACE_ARRET_MS, () => terminer(child.exitCode));
      });
    };
    const surAnnulation = (): void => arreter('annule');
    signal?.addEventListener('abort', surAnnulation, { once: true });
    plus(timeoutMs, () => arreter('delai'));
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', sortie.ajouter);
    child.stderr?.on('data', sortie.ajouter);
    child.on('error', (e) => {
      arret ??= signal?.aborted ? 'annule' : 'lancement';
      terminer(1, `\n[hive] échec du lancement : ${e.message}`);
    });
    child.on('exit', () => {
      sortiLe = true;
      // La commande est finie ; ce qu'elle a laissé tourner derrière elle n'a
      // plus de propriétaire. Sous POSIX, son groupe l'identifie encore — sous
      // Windows, son pid est libéré et pourrait déjà nommer un inconnu : on
      // n'y tue rien, on cesse seulement d'attendre.
      if (process.platform !== 'win32') emporterArbre(child, 'SIGKILL');
      plus(GRACE_ARRET_MS, () =>
        terminer(
          child.exitCode,
          '\n[hive] la sortie est restée ouverte après la fin de la commande : ' +
            'un processus qu’elle a lancé la tenait',
        ),
      );
    });
    child.on('close', (code) => terminer(code));
  });
}

/**
 * Applique les diffs dans l'ordre sur le dépôt local, détecte les conflits réels
 * (git), puis lance éventuellement les tests. Ne commit ni ne push — sauf
 * livraison demandée, et alors jamais ailleurs que sur une branche de mission.
 */
export async function runMerge(opts: MergeRunOptions): Promise<MergeRunResult> {
  // LA GARDE QUI COMPTE. Le hub refuse déjà les commandes hors liste, mais un
  // nœud ne doit pas tenir pour acquis que le hub est bien celui qu'il croit :
  // le jeton de ruche est partagé, les anciennes invitations le portent en
  // clair, et le transport peut être un ws:// de réseau local. On vérifie donc
  // AVANT toute écriture — `spawn(argv[0])` sans shell exécute quand même le
  // binaire qu'on lui nomme.
  if (opts.testCommand && opts.testCommand.length > 0) {
    const verdict = jugerCommandeTest(opts.testCommand);
    if (!verdict.ok) throw new Error(`commande de test refusée : ${verdict.motif}`);
  }
  // Même raisonnement pour la préparation, et il porte plus loin : une
  // installation exécute les scripts du dépôt, et `pip install <ce que le hub
  // nomme>` exécuterait ceux d'un paquet que PERSONNE n'a choisi de connecter.
  if (opts.prepareCommand && opts.prepareCommand.length > 0) {
    const verdict = jugerPreparation(opts.prepareCommand);
    if (!verdict.ok) throw new Error(`préparation refusée : ${verdict.motif}`);
  }
  const git = simpleGit({ baseDir: opts.repoDir });
  const applied: string[] = [];
  const conflicts: { taskId: string; reason: string }[] = [];
  const logs: string[] = [];
  const patchDir = mkdtempSync(path.join(os.tmpdir(), 'hive-merge-'));
  // Le dépôt de TRANSIT d'une livraison : À CÔTÉ du clone, comme son `.tmp`,
  // parce que le bac à sable ne monte que le clone. Effacé en `finally` ; la
  // branche gardée, elle, vit dans le dépôt durable.
  const transit = `${opts.repoDir}.livraison.git`;

  try {
    for (const { taskId, diff } of opts.diffs) {
      if (!diff.trim()) {
        applied.push(taskId); // rien à appliquer (diff vide) : non bloquant
        continue;
      }
      const patchFile = path.join(patchDir, `${taskId}.patch`);
      writeFileSync(patchFile, diff.endsWith('\n') ? diff : `${diff}\n`);
      try {
        // Vérifie AVANT d'appliquer : échoue si le patch ne colle pas à l'état accumulé.
        await git.raw(['apply', '--check', patchFile]);
      } catch {
        conflicts.push({ taskId, reason: "le diff ne s'applique pas proprement (conflit)" });
        logs.push(`✘ ${taskId} : conflit d'application`);
        continue;
      }
      await git.raw(['apply', patchFile]);
      applied.push(taskId);
      logs.push(`✔ ${taskId} appliqué`);
    }

    // Diff cumulé (nouveaux fichiers rendus visibles via --intent-to-add).
    await git.raw(['add', '--all', '--intent-to-add']);
    const mergedDiff = await git.diff();

    // L'ARBRE À LIVRER, figé MAINTENANT : après, la préparation installe ses
    // dépendances et les tests écrivent leurs traces dans cette même copie.
    // Capturé plus tard, le commit livrerait `node_modules` — ou le fichier
    // qu'un test aurait réécrit — sous le nom de la mission.
    let arbre: string | null = null;
    if (opts.livraison && conflicts.length === 0 && mergedDiff.trim()) {
      await git.raw(['add', '--all']);
      arbre = (await git.raw(['write-tree'])).trim();
    }
    // LA MISSION SE COMPOSE ICI, pas après les tests : la préparation et les
    // tests exécutent le code du dépôt DANS ce clone, `.git` compris. Tout ce
    // que git doit y lire — le parent, le commit — se lit tant que seuls
    // `clone` et `apply` y sont passés (en-tête de `livraison-locale.ts`).
    const composee = opts.livraison
      ? await composerSiIntegrable(opts.livraison, opts.repoDir, transit, opts.testCommand, {
          applied,
          conflicts,
          arbre,
        })
      : undefined;

    let testsRun = false;
    let testsPassed: boolean | null = null;
    let preparedOk: boolean | null = null;
    if (conflicts.length === 0 && (opts.prepareCommand?.length || opts.testCommand?.length)) {
      // Environnement épuré : le hub n'accède à AUCUN secret local du nœud.
      const env = buildSandboxEnv(opts.repoDir);
      try {
        // LA PRÉPARATION D'ABORD — c'est tout l'intérêt : sans elle, `npm test`
        // sur un clone frais échoue faute de `node_modules`.
        if (opts.prepareCommand && opts.prepareCommand.length > 0) {
          const { code, output } = await runProc(
            opts.prepareCommand,
            opts.repoDir,
            env,
            opts.prepareTimeoutMs ?? MERGE_PREPARATION_MS,
            opts.signal,
            opts.bac,
          );
          preparedOk = code === 0;
          logs.push(
            `environnement : ${preparedOk ? '✔ préparé' : `✘ préparation en échec (code ${code})`}`,
          );
          logs.push(output.slice(0, 4000));
        }

        // ET SI ELLE ÉCHOUE, ON NE TESTE PAS. Une installation qui n'aboutit
        // pas — hors ligne, registre injoignable, lockfile désaccordé — donne
        // ensuite un `npm test` qui échoue pour une raison qui n'a rien à voir
        // avec le code. Remonter ça comme « tests en échec » enverrait l'hôte
        // chercher une régression qui n'existe pas. On le dit à la place.
        if (preparedOk === false) {
          logs.push(
            'tests : non lancés — l’environnement n’a pas pu être préparé. Le code n’est PAS ' +
              'en cause : vérifiez le réseau de ce nœud, puis le lockfile du dépôt.',
          );
        } else if (opts.testCommand && opts.testCommand.length > 0) {
          testsRun = true;
          const { code, output } = await runProc(
            opts.testCommand,
            opts.repoDir,
            env,
            opts.timeoutMs ?? MERGE_TESTS_MS,
            opts.signal,
            opts.bac,
          );
          testsPassed = code === 0;
          logs.push(`tests : ${testsPassed ? '✔ OK' : `✘ échec (code ${code})`}`);
          logs.push(output.slice(0, 4000));
        }
      } finally {
        rmSync(`${opts.repoDir}.tmp`, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    }

    const livraison =
      opts.livraison && composee
        ? await garderSiRienNeContredit(composee, opts.livraison, { preparedOk, testsPassed })
        : undefined;
    if (livraison) logs.push(ligneDeLivraison(livraison));

    return {
      applied,
      conflicts,
      mergedDiff,
      testsRun,
      testsPassed,
      preparedOk,
      logs: logs.join('\n'),
      ...(livraison ? { livraison } : {}),
    };
  } finally {
    rmSync(patchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(transit, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/**
 * AVANT les tests : la mission ne se compose que sur une intégration COMPLÈTE.
 *
 * Chaque refus porte son motif : un merge demandé « avec livraison » qui
 * rendrait un simple « appliqué » laisserait croire qu'une branche existe.
 */
async function composerSiIntegrable(
  livraison: LivraisonDuNoeud,
  repoDir: string,
  transit: string,
  testCommand: readonly string[] | undefined,
  etat: {
    applied: readonly string[];
    conflicts: readonly { taskId: string }[];
    arbre: string | null;
  },
): Promise<MissionComposee | RapportDuNoeud> {
  const refus = (motif: string): RapportDuNoeud => ({ etat: 'non_commitee', motif });
  // Une branche de mission ne livre pas une intégration PARTIELLE : elle se
  // lirait comme « la mission », il y manquerait des tâches.
  if (etat.conflicts.length > 0) {
    return refus(
      `${etat.conflicts.length} tâche(s) en conflit : une intégration partielle n’est pas livrée`,
    );
  }
  if (etat.arbre === null) return refus('rien à livrer : les diffs intégrés sont vides');
  // Les trailers diront « ces tâches, ces résultats » : ils doivent nommer
  // EXACTEMENT ce qui a été appliqué, ni plus ni moins.
  const annoncees = livraison.demande.provenance.map((p) => p.taskId);
  const memes =
    annoncees.length === etat.applied.length &&
    new Set(annoncees).size === annoncees.length &&
    annoncees.every((id) => etat.applied.includes(id));
  if (!memes) {
    return refus('provenance incomplète : elle ne nomme pas exactement les tâches intégrées');
  }
  return composerMission({
    cloneDir: repoDir,
    arbre: etat.arbre,
    transit,
    livraison,
    // Sans conflit, la commande de test tourne dès que la préparation passe —
    // et si elle ne passe pas, rien n'est gardé. « ok » est donc le seul
    // verdict qu'un commit GARDÉ puisse porter quand une commande existe.
    tests: testCommand?.length ? { lances: true, commande: testCommand } : { lances: false },
  });
}

/**
 * APRÈS les tests : la mission composée n'est gardée que si ni la préparation
 * ni les tests ne l'ont contredite. Aucun de ces refus ne touche le clone.
 */
async function garderSiRienNeContredit(
  composee: MissionComposee | RapportDuNoeud,
  livraison: LivraisonDuNoeud,
  etat: { preparedOk: boolean | null; testsPassed: boolean | null },
): Promise<RapportDuNoeud> {
  if (composee.etat !== 'composee') return composee;
  const refus = (motif: string): RapportDuNoeud => ({ etat: 'non_commitee', motif });
  if (etat.preparedOk === false) {
    return refus('environnement non préparé, tests non lancés : rien n’est commité');
  }
  if (etat.testsPassed === false) return refus('tests en échec : rien n’est commité');
  return garderMission(composee, livraison);
}

/** La ligne du journal de merge qui dit ce qu'est devenue la livraison. */
function ligneDeLivraison(r: RapportDuNoeud): string {
  if (r.etat === 'non_commitee') return `livraison : ✘ non commitée — ${r.motif}`;
  const poussee: Record<typeof r.poussee, string> = {
    non_demandee: 'gardée sur ce nœud',
    poussee: 'poussée vers le dépôt',
    refusee: `non poussée — ${r.motif ?? ''}`,
    echec: `poussée en échec — ${r.motif ?? ''}`,
  };
  return `livraison : ✔ ${r.branche} (${r.commit.slice(0, 12)}), ${poussee[r.poussee]}`;
}
