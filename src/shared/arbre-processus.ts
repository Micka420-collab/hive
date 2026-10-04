// L'ARBRE D'UN PROCESSUS — lancé, arrêté et repris EN ENTIER.
//
// ─── POURQUOI TUER L'ENFANT NE SUFFIT PAS ────────────────────────────────────
//
// Un agent, une commande de test, un chantier : le nœud lance UN processus, qui
// en lance d'autres. `npm run test` lance un shell, qui lance le runner, qui
// lance parfois un serveur ; Claude Code lance ses serveurs MCP et ses shells.
// `child.kill()` n'atteint que le premier. Le reste survivait à la tâche
// annulée ou expirée — mesuré sous #468 : `npm run` arrêté, son `sh` et son
// `node` tournaient encore —, gardait les tubes de sortie ouverts, et `close`
// n'arrivait jamais : la tâche qui l'attendait restait pendue, et le nœud
// finissait saturé (`noeud_sature`) sans plus rien prendre.
//
//   · POSIX : l'enfant est lancé `detached`, donc chef d'une nouvelle session
//     et de son GROUPE de processus ; `kill(-pid)` atteint tout le groupe ;
//   · Windows : `taskkill /T /F` suit l'arbre des parents — il n'y a pas de
//     groupe à viser, et `kill()` y est un `TerminateProcess` du seul enfant.
//     SYNCHRONE, parce que le répertoire de la tâche est effacé juste après
//     et qu'un dossier qui est le `cwd` d'un processus vivant ne s'efface pas
//     (même leçon que `scripts/essai-entree.mjs`).
//
// ─── UNE BORNE, PAS UN SOUHAIT ───────────────────────────────────────────────
//
// `lancerArbre` rend son issue au plus tard `délai + 2 × GRACE_ARRET_MS` après
// le lancement, quoi que fasse la commande : au délai (ou à l'annulation), tout
// l'arbre reçoit SIGTERM, puis SIGKILL après la grâce ; une commande SORTIE
// dont un descendant tient encore la sortie est tenue pour finie après la
// grâce. Attendre `close` seul pendait sans fin sur un `serveur &` oublié, un
// runner qui ignore SIGTERM, ou — sous Windows — n'importe quel script.
//
// ─── CE QUE LE PROCESSUS POSSÈDE, IL LE REPREND EN SORTANT ───────────────────
//
// Chaque arbre est RETENU tant que son chef vit. À la sortie du processus qui
// l'a lancé (`exit` : `process.exit`, fin naturelle), ceux qui restent sont
// abattus. C'est ce qui rend vrai l'arrêt d'un nœud : `stop()` annule, et les
// arbres reçoivent SIGTERM ; `arbresEteints` leur laisse la grâce de finir
// d'eux-mêmes (`docker run` relaie l'arrêt à son conteneur) ; ce qui l'a
// ignorée tombe avec le nœud, au lieu de lui survivre.
//
// ─── CE QUE ÇA NE COUVRE PAS, ET IL FAUT LE SAVOIR ───────────────────────────
//
//   · un `kill -9` du nœud : aucun code ne tourne plus. Les conteneurs sont
//     repris par étiquette au démarrage suivant (`ramasserConteneurs`) ; un
//     agent hors bac tourne jusqu'à sa propre fin ;
//   · un conteneur qui ne s'arrête pas dans la grâce : son client `docker run`
//     est abattu, le conteneur lui survit jusqu'au démarrage suivant du nœud
//     (`ramasserConteneurs`, par étiquette) ;
//   · un descendant qui quitte le groupe (`setsid`, un démon) : hors
//     d'atteinte — la borne tient quand même, on cesse de l'attendre ;
//   · sous Windows, les descendants d'une commande sortie d'ELLE-MÊME : son pid
//     est libéré, et peut déjà nommer un inconnu. On n'y tue rien.

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, StdioOptions } from 'node:child_process';
import path from 'node:path';

/**
 * Le temps laissé à un arbre ARRÊTÉ pour mourir, puis à ses tubes pour se
 * fermer une fois son chef sorti.
 *
 * Deux secondes : assez pour que `docker run` relaie un SIGTERM à son
 * conteneur, trop peu pour qu'un orphelin tienne une tâche.
 */
export const GRACE_ARRET_MS = 2_000;

const WINDOWS = process.platform === 'win32';

/**
 * Comment un arbre a fini — la seule chose que ses appelants ont à trancher.
 *
 *   · `sortie` : le chef est sorti DE LUI-MÊME, `code` est son verdict.
 *     `tenue` : un descendant gardait la sortie après lui, et on a cessé
 *     d'attendre au bout de la grâce ;
 *   · `arret` : Hive l'a arrêté — délai dépassé ou annulation. Aucun code
 *     n'est alors un verdict : un runner qui répond à SIGTERM par `exit 0`
 *     n'a pas réussi ses tests ;
 *   · `lancement` : il n'a jamais tourné (binaire absent, non exécutable).
 */
export type IssueArbre =
  | { readonly issue: 'sortie'; readonly code: number | null; readonly tenue: boolean }
  | { readonly issue: 'arret'; readonly motif: 'delai' | 'annule' }
  | { readonly issue: 'lancement'; readonly erreur: Error };

export interface LancementArbre {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: StdioOptions;
}

export interface GardeArbre {
  /** Au-delà, l'arbre est arrêté (`arret`, motif `delai`). */
  readonly delaiMs: number;
  /** Son `abort` arrête l'arbre (`arret`, motif `annule`). */
  readonly signal?: AbortSignal;
}

/** Les chefs d'arbre vivants de CE processus. */
const vivants = new Set<ChildProcess>();
/** Ceux qui attendent que `vivants` se vide (`arbresEteints`). */
const attentes = new Set<() => void>();
let repriseALaSortie = false;

/**
 * `taskkill` par son chemin SYSTÈME, avec un environnement réduit à ce qu'il
 * lui faut : un `taskkill.exe` déposé en tête de PATH recevrait sinon le jeton
 * de ruche et les clés d'API du nœud (même garde que `envSonde`).
 */
function abattreSousWindows(pid: number): void {
  const racine = process.env.SystemRoot ?? 'C:\\Windows';
  spawnSync(
    path.win32.join(racine, 'System32', 'taskkill.exe'),
    ['/PID', String(pid), '/T', '/F'],
    {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
      env: { SystemRoot: racine },
      // SYNCHRONE, donc borné : un `taskkill` pendu figerait tout le nœud.
      timeout: 10_000,
    },
  );
}

/**
 * Emporte un arbre : le groupe entier sous POSIX, l'arbre des parents sous
 * Windows (où `signal` est sans objet — `taskkill /F` ne connaît que la force).
 *
 * Sous Windows, seulement un chef VIVANT : le pid d'un processus sorti est
 * libéré, et `taskkill /T` abattrait l'arbre d'un inconnu. Sous POSIX, le
 * groupe survit à son chef — c'est même tout son intérêt : la commande est
 * finie, ce qu'elle a laissé tourner n'a plus de propriétaire.
 */
export function emporterArbre(enfant: ChildProcess, signal: NodeJS.Signals): void {
  const pid = enfant.pid;
  if (pid === undefined) return;
  try {
    if (WINDOWS) {
      if (enfant.exitCode === null && enfant.signalCode === null) abattreSousWindows(pid);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // Groupe déjà vide, processus déjà parti : il n'y a rien à arrêter.
  }
}

function oublier(enfant: ChildProcess): void {
  vivants.delete(enfant);
  if (vivants.size > 0) return;
  for (const fini of [...attentes]) fini();
}

/**
 * À la sortie du processus, ce qui vit encore tombe avec lui. `exit` n'admet
 * que du synchrone : `process.kill` et `spawnSync` le sont.
 */
function reprendreALaSortie(): void {
  for (const enfant of vivants) emporterArbre(enfant, 'SIGKILL');
  vivants.clear();
}

/**
 * Résout quand plus aucun arbre ne vit — ou au bout de `delaiMs`, qui BORNE
 * l'attente : ce qui reste alors est abattu à la sortie du processus.
 */
export function arbresEteints(delaiMs: number): Promise<void> {
  if (vivants.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const fini = (): void => {
      clearTimeout(minuteur);
      attentes.delete(fini);
      resolve();
    };
    // `fini` ne s'exécute qu'après : le minuteur existe quand il le lit.
    const minuteur = setTimeout(fini, delaiMs);
    attentes.add(fini);
  });
}

/**
 * Lance `bin args` comme chef d'un arbre que ce processus POSSÈDE, et rend son
 * issue UNE fois, par `fin` (voir `IssueArbre` et l'en-tête).
 *
 * `shell: false` toujours (contrainte §5.1), jamais de console à part sous
 * Windows. Pas de `signal` passé à `spawn` : il ne tuerait que l'enfant — et
 * son annulation arrivait en `error`, qu'un appelant lisait comme un binaire
 * introuvable. L'annulation passe ici par l'arbre entier.
 *
 * L'appelant vérifie `signal.aborted` AVANT : un travail déjà annulé ne se
 * lance pas.
 */
export function lancerArbre(
  bin: string,
  args: readonly string[],
  options: LancementArbre,
  garde: GardeArbre,
  fin: (issue: IssueArbre) => void,
): ChildProcess {
  const enfant = spawn(bin, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    shell: false,
    windowsHide: true,
    // Chef de son groupe (POSIX), pour que `emporterArbre` atteigne toute la
    // descendance d'un seul `kill(-pid)`. Sans objet sous Windows, où
    // `detached` ouvrirait une console à part.
    detached: !WINDOWS,
  });
  if (enfant.pid !== undefined) {
    vivants.add(enfant);
    if (!repriseALaSortie) {
      repriseALaSortie = true;
      process.on('exit', reprendreALaSortie);
    }
  }

  let fini = false;
  let sorti = false;
  let arret: 'delai' | 'annule' | undefined;
  const minuteurs: NodeJS.Timeout[] = [];
  const plus = (ms: number, geste: () => void): void => {
    const m = setTimeout(geste, ms);
    m.unref?.();
    minuteurs.push(m);
  };
  const terminer = (issue: IssueArbre): void => {
    if (fini) return;
    fini = true;
    for (const m of minuteurs) clearTimeout(m);
    garde.signal?.removeEventListener('abort', surAnnulation);
    // Un orphelin peut encore écrire : on ne l'écoute plus, et les tubes ne
    // retiennent plus la boucle d'événements.
    enfant.stdout?.destroy();
    enfant.stderr?.destroy();
    fin(issue);
  };
  const arreter = (motif: 'delai' | 'annule'): void => {
    if (fini || arret) return;
    // Déjà sorti de lui-même : son code est un vrai verdict, on le garde.
    if (sorti) {
      terminer({ issue: 'sortie', code: enfant.exitCode, tenue: false });
      return;
    }
    arret = motif;
    // SIGTERM d'abord : `docker run` le relaie à son conteneur, un runner
    // propre se ferme. Ce qui l'ignore est tué à la fin de la grâce, et
    // l'issue tombe de toute façon une grâce plus tard.
    emporterArbre(enfant, 'SIGTERM');
    plus(GRACE_ARRET_MS, () => {
      // Sorti entre-temps : son groupe a déjà été balayé à sa sortie, et son
      // pid, libéré, pourrait nommer un inconnu.
      if (!sorti) emporterArbre(enfant, 'SIGKILL');
      plus(GRACE_ARRET_MS, () => terminer({ issue: 'arret', motif }));
    });
  };
  const surAnnulation = (): void => arreter('annule');
  garde.signal?.addEventListener('abort', surAnnulation, { once: true });
  plus(garde.delaiMs, () => arreter('delai'));

  enfant.on('error', (erreur) => {
    oublier(enfant);
    terminer({ issue: 'lancement', erreur });
  });
  enfant.on('exit', () => {
    sorti = true;
    // Ce qui reste du groupe n'a plus de propriétaire (voir `emporterArbre`).
    if (!WINDOWS) emporterArbre(enfant, 'SIGKILL');
    oublier(enfant);
    // Arrêté : les minuteurs de l'arrêt concluent. Sinon, la grâce borne
    // l'attente des tubes qu'un descendant hors d'atteinte tiendrait encore.
    if (arret === undefined) {
      plus(GRACE_ARRET_MS, () => terminer({ issue: 'sortie', code: enfant.exitCode, tenue: true }));
    }
  });
  enfant.on('close', (code) =>
    terminer(arret ? { issue: 'arret', motif: arret } : { issue: 'sortie', code, tenue: false }),
  );
  return enfant;
}
