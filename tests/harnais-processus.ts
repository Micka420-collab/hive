/**
 * LES PROCESSUS QU'UN BANC LANCE, ET QU'IL DOIT REPRENDRE.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * Trois bancs lancent de VRAIS processus — la Reine, le lanceur complet, un
 * nœud qui rejoint. C'est leur qualité : ils éprouvent ce que la machine
 * exécute, pas une imitation. Ils avaient tous le même trou.
 *
 * Relevé pris cette nuit sur le conteneur, après quelques heures de balayages :
 *
 *     40 processus node survivants, jusqu'à 1 070 s d'âge — des
 *     `src/orchestrator/main.ts`, des `src/node-client/main`, des serveurs
 *     `vite` — plusieurs à 35-40 % de CPU chacun.
 *     Charge : 13,18 sur 4 cœurs.
 *
 * Personne ne les avait lancés depuis dix-sept minutes. Ils étaient orphelins.
 *
 * ─── LES DEUX CAUSES, ET ELLES SONT DISTINCTES ───────────────────────────────
 *
 *   1. TUER LE PÈRE N'ORPHELINE PAS SEULEMENT : ÇA LIBÈRE LES ENFANTS. Le
 *      lanceur `ruche.mjs` démarre lui-même un hub, un nœud et un `vite`. Le
 *      banc le tue en SIGKILL — précisément le signal qui ne lui laisse AUCUNE
 *      chance de reprendre sa descendance. Le lanceur meurt, ses trois enfants
 *      continuent, rattachés à l'init. Un `kill(pid)` ne parle qu'à un seul
 *      processus ; il faut parler au GROUPE.
 *
 *   2. UN CHIEN DE GARDE `unref()` NE GARDE RIEN. Les bancs bornaient leurs
 *      attentes par `setTimeout(...).unref()`. `unref` dit exactement ceci :
 *      « si plus rien d'autre ne retient la boucle, n'attends pas ce
 *      minuteur ». Quand le worker vitest se termine pendant qu'une attente
 *      est en cours, le boucher n'est donc jamais appelé — et l'enfant qu'il
 *      devait tuer survit à tout le monde. Le filet était posé à l'endroit
 *      exact où il ne pouvait pas servir.
 *
 * ─── CE QUE ÇA COÛTAIT ───────────────────────────────────────────────────────
 *
 * Une machine à 3,3 fois sa charge nominale. Sur quoi les mêmes bancs posent
 * des budgets en temps MURAL — « la bannière doit paraître en 30 s ». Un chien
 * de garde en temps mural ne distingue pas « en panne » de « occupé » : la
 * suite s'est mise à rougir au hasard, sur des enfants parfaitement sains,
 * tués par un budget que la fuite des exécutions PRÉCÉDENTES avait rendu
 * intenable. La fuite ne ralentissait pas seulement la suite : elle la faisait
 * MENTIR.
 *
 * ─── CE QUE CE HARNAIS GARANTIT ──────────────────────────────────────────────
 *
 *   · tout processus lancé par `lancerBorne` a son PROPRE groupe (`detached`) ;
 *   · `tuerGroupe` frappe le groupe entier, donc les petits-enfants ;
 *   · `reprendreTous`, appelé en `afterEach`, reprend ce qui vit encore, quelle
 *     que soit la façon dont le test s'est terminé — y compris s'il a échoué,
 *     expiré, ou n'a jamais résolu sa promesse.
 *
 * Le dernier point est le seul qui tienne vraiment : un nettoyage placé dans le
 * chemin nominal est un nettoyage qui saute exactement les jours où il compte.
 */

import {
  spawn,
  type ChildProcess,
  type ChildProcessByStdio,
  type SpawnOptions,
} from 'node:child_process';
import type { Readable } from 'node:stream';

/** Les groupes vivants, par identifiant de tête de groupe. */
const vivants = new Set<number>();

/** Windows n'a pas de groupes de processus POSIX — `detached` y signifie autre chose. */
const POSIX = process.platform !== 'win32';

/**
 * Lance un processus dans SON PROPRE groupe, et le retient pour le reprendre.
 *
 * Toutes les options d'appel sont respectées, sauf `detached` : elle est
 * imposée sur POSIX, parce que c'est elle qui rend le groupe adressable. Un
 * banc qui la désactiverait retrouverait le trou que ce fichier existe pour
 * boucher.
 */
export function lancerBorne(
  commande: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const proc = spawn(commande, [...args], { ...options, shell: false, detached: POSIX });
  if (typeof proc.pid === 'number') vivants.add(proc.pid);
  // ─── `exit`, SURTOUT PAS `close` ───────────────────────────────────────────
  //
  // `close` attend que les FLUX soient fermés, pas que le processus meure. Or
  // un enfant lancé en `stdio: 'inherit'` tient les tuyaux de son père ouverts
  // aussi longtemps qu'il vit. Sur `close`, le nettoyage n'arriverait donc
  // JAMAIS dans le seul cas qui compte — « le père est mort, son fils tourne
  // encore » —, et le banc qui attend `close` resterait suspendu jusqu'à son
  // échéance. Mesuré : le test du père fugace expirait à 30 010 ms.
  //
  // `exit` parle du processus. C'est ce qu'on veut savoir.
  proc.on('exit', () => {
    const pid = proc.pid;
    if (typeof pid !== 'number') return;
    // ─── LA MORT DU PÈRE N'EST PAS LA FIN DU GROUPE ──────────────────────────
    //
    // Oublier le groupe ici serait refaire le trou que ce fichier bouche : la
    // panne qu'on chasse est EXACTEMENT « le père est mort, ses enfants
    // tournent encore ». On balaie donc le groupe une dernière fois avant de
    // le lâcher.
    //
    // Un groupe déjà vide lève `ESRCH`, ce qui est le résultat recherché. Et
    // l'oubli reste indispensable : sans lui, `reprendreTous` finirait par
    // signaler des pid recyclés par le système, c'est-à-dire par tuer des
    // processus étrangers — un remède pire que la fuite.
    if (POSIX) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // le groupe s'est éteint avec son chef : rien à reprendre
      }
    }
    vivants.delete(pid);
  });
  return proc;
}

/**
 * Le même, pour les bancs qui LISENT la sortie de leur processus.
 *
 * `spawn` ne rend des tuyaux non nuls que si TypeScript voit le `stdio` en
 * clair à l'appel ; passer par une fonction efface ce savoir, et les trois
 * bancs se retrouveraient à écrire `proc.stdout?.on(…)` — c'est-à-dire à
 * attacher leur lecteur « si possible », et à attendre en silence un marqueur
 * qui ne viendrait jamais s'il ne l'était pas.
 *
 * Le `stdio` est donc imposé ici, une fois, avec l'assertion qui va avec.
 */
export function lancerBorneTuyaute(
  commande: string,
  args: readonly string[],
  options: Omit<SpawnOptions, 'stdio' | 'detached' | 'shell'> = {},
): ChildProcessAvecTuyaux {
  return lancerBorne(commande, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as ChildProcessAvecTuyaux;
}

/** Un processus dont on sait que la sortie et l'erreur sont lisibles. */
export type ChildProcessAvecTuyaux = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Tue le GROUPE d'un processus — lui ET sa descendance.
 *
 * Le `-pid` de POSIX désigne le groupe entier. C'est la seule façon d'atteindre
 * les petits-enfants d'un lanceur qu'on abat en SIGKILL, puisque lui n'aura
 * jamais l'occasion de les reprendre.
 *
 * Le repli sur `proc.kill` couvre Windows et le cas où le processus n'a pas de
 * pid (échec de lancement) : mieux vaut tuer l'enfant seul que rien du tout.
 */
export function tuerGroupe(proc: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
  const pid = proc.pid;
  if (typeof pid !== 'number') return;
  if (POSIX) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Le groupe n'existe déjà plus, ou le processus n'en menait pas un :
      // on retombe sur l'enfant seul, ci-dessous.
    }
  }
  try {
    proc.kill(signal);
  } catch {
    // déjà mort — c'est le résultat recherché
  }
}

/**
 * Reprend tout ce qui vit encore. À appeler en `afterEach`, sans condition.
 *
 * Ne demande pas si le test a réussi : c'est quand il échoue, expire, ou laisse
 * une promesse pendante que des processus restent — donc exactement quand un
 * nettoyage conditionnel ne s'exécuterait pas.
 */
export function reprendreTous(): void {
  for (const pid of vivants) {
    if (POSIX) {
      try {
        process.kill(-pid, 'SIGKILL');
        continue;
      } catch {
        // groupe déjà éteint ; on tente le processus seul
      }
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // déjà mort
    }
  }
  vivants.clear();
}

/** Combien de groupes ce harnais retient encore — pour qu'un banc puisse le JUGER. */
export function groupesRetenus(): number {
  return vivants.size;
}
