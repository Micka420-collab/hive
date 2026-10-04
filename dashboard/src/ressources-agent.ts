// LES RESSOURCES DE L'AGENT, DITES D'UNE SEULE FAÇON — le tiroir d'une tâche
// (ressources observées, dernière exécution d'une délégation) et la fiche d'un
// Worker (ses missions). Deux écrans qui diraient la même mesure de deux façons
// finiraient par se contredire ; le second qui a existé disait encore les
// compteurs du processus du NŒUD.

import type { RaisonSansMesure, RessourcesExecution } from '../../src/shared/types';
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

/**
 * Les ressources de l'AGENT, telles que son nœud les a relevées : l'arbre de
 * ses processus ou son conteneur — la mesure de Sandbox Live, cumulée. Le CPU
 * est un plancher (« au moins ») : ce qui a suivi le dernier relevé n'y est
 * pas. Un pic échantillonné est dit tel ; celui du noyau aussi. Ce qui ne se
 * mesure pas est dit avec sa raison, jamais remplacé par un autre chiffre.
 */
export function direRessources(r: RessourcesExecution | undefined, t: Translate): string {
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
  const cpu =
    r.cpuMs !== undefined
      ? t(`au moins ${formatMs(r.cpuMs)} CPU`, `at least ${formatMs(r.cpuMs)} CPU`)
      : t(
          'CPU non mesuré (le moteur n’en tient pas le cumul)',
          'CPU not measured (the engine keeps no total)',
        );
  const pic = r.picOctets !== undefined ? octetsLisibles(r.picOctets) : null;
  const memoire =
    pic === null
      ? t('mémoire non mesurée', 'memory not measured')
      : r.picNoyau
        ? t(`pic mémoire ${pic} (noyau)`, `memory peak ${pic} (kernel)`)
        : r.portee === 'arbre'
          ? t(`pic RSS échantillonné ${pic}`, `sampled RSS peak ${pic}`)
          : t(`pic mémoire échantillonné ${pic}`, `sampled memory peak ${pic}`);
  const s = INTERVALLE_METRIQUES_MS / 1000;
  const releves = t(
    `${r.releves} relevé${r.releves > 1 ? 's' : ''} toutes les ${s} s`,
    `${r.releves} sample${r.releves > 1 ? 's' : ''} every ${s} s`,
  );
  return `${sujet} : ${cpu} · ${memoire} · ${releves}`;
}
