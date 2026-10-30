// LES RESSOURCES DE L'AGENT, DITES D'UNE SEULE FAÇON — le tiroir d'une tâche
// (ressources observées, dernière exécution d'une délégation) et la fiche d'un
// Worker (ses missions). Deux écrans qui diraient la même mesure de deux façons
// finiraient par se contredire ; le second qui a existé disait encore les
// compteurs du processus du NŒUD.

import type { MemoireMesuree, RaisonSansMesure, RessourcesExecution } from '../../src/shared/types';
import { INTERVALLE_METRIQUES_MS } from '../../src/shared/bac-direct';
import type { Translate } from './i18n';
import { formatMs } from './ui';
import { octetsLisibles } from './views/bac-direct-rendu';

const RAISON_SANS_MESURE: Record<RaisonSansMesure, readonly [string, string]> = {
  plateforme: [
    'Windows hors conteneur, sans table des processus lisible',
    'Windows without a container has no readable process table',
  ],
  aucun_processus: ['aucun processus d’agent lancé', 'no agent process was started'],
  aucun_releve: ['aucun relevé de l’agent n’a abouti', 'no sample of the agent succeeded'],
  noeud_ancien: [
    'nœud d’une version antérieure, qui ne mesurait que lui-même',
    'node from an earlier version, which only measured itself',
  ],
};

/** Le pic de mémoire, et QUELLE mémoire c'est — un fait de la mesure (`MemoireMesuree`). */
const PIC_MEMOIRE: Record<MemoireMesuree, (pic: string) => readonly [string, string]> = {
  pss: (pic) => [
    `pic mémoire échantillonné ${pic} (Pss — pages partagées réparties)`,
    `sampled memory peak ${pic} (PSS — shared pages split)`,
  ],
  somme_rss: (pic) => [
    `pic échantillonné de la somme des RSS de l’arbre ${pic} (pages partagées comptées par processus)`,
    `sampled peak of the tree’s summed RSS ${pic} (shared pages counted per process)`,
  ],
  noyau: (pic) => [
    `pic mémoire du conteneur ${pic} (tenu par le noyau)`,
    `container memory peak ${pic} (kernel-held)`,
  ],
  moteur: (pic) => [
    `pic mémoire échantillonné ${pic} (selon le moteur)`,
    `sampled memory peak ${pic} (as reported by the engine)`,
  ],
};

/**
 * Les ressources de l'AGENT, telles que son nœud les a relevées : l'arbre de
 * ses processus ou son conteneur — la mesure de Sandbox Live, cumulée. Le CPU
 * est un plancher (« au moins ») : ce qui a suivi le dernier relevé n'y est
 * pas. La mémoire dit laquelle elle est. Sans deux relevés, il n'y a pas de
 * fenêtre : « trop bref », jamais « au moins 0 ms ». Ce qui ne se mesure pas
 * est dit avec sa raison, jamais remplacé par un autre chiffre.
 */
export function direRessources(
  r: RessourcesExecution | undefined,
  t: Translate,
  lang: 'fr' | 'en',
): string {
  if (!r) return t('ressources de l’agent non mesurées', 'agent’s resources not measured');
  if (r.portee === 'aucune') {
    const [fr, en] = RAISON_SANS_MESURE[r.raison];
    return t(
      `ressources de l’agent non mesurées — ${fr}`,
      `agent’s resources not measured — ${en}`,
    );
  }
  const sujet =
    r.portee === 'arbre'
      ? t('arbre de processus de l’agent', 'agent’s process tree')
      : t('conteneur de l’agent', 'agent’s container');
  if (r.releves < 2) {
    return `${sujet} : ${t(
      'trop bref pour être mesuré (un seul relevé)',
      'too brief to be measured (a single sample)',
    )}`;
  }
  const cpu =
    r.cpuMs !== undefined
      ? t(`au moins ${formatMs(r.cpuMs)} CPU`, `at least ${formatMs(r.cpuMs)} CPU`)
      : t(
          'CPU non mesuré (cgroup illisible ici, pas de cumul dans le `stats` du moteur)',
          'CPU not measured (cgroup unreadable here, no total in the engine’s `stats`)',
        );
  const memoire =
    r.picOctets !== undefined && r.memoire !== undefined
      ? t(...PIC_MEMOIRE[r.memoire](octetsLisibles(r.picOctets, lang)))
      : t('mémoire non mesurée', 'memory not measured');
  const s = INTERVALLE_METRIQUES_MS / 1000;
  const releves = t(`${r.releves} relevés toutes les ${s} s`, `${r.releves} samples every ${s} s`);
  return `${sujet} : ${cpu} · ${memoire} · ${releves}`;
}
