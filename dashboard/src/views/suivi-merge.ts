// LE SUIVI D'UN MERGE LANCÉ — un seul, pour les deux gestes qui en lancent un.
//
// Le merge d'essai (plan Honeycomb) et la livraison d'une mission partent tous
// deux vers une ouvrière et reviennent par `/merge/result`. La scrutation —
// relever, reconnaître SON résultat par `mergeId`, abandonner à l'échéance,
// ne jamais écrire dans un composant démonté — vivait dans le premier ; la
// recopier dans le second aurait fait deux endroits où l'oublier, et le jour
// où l'un change sa cadence l'autre dériverait en silence.
//
// Elle ne relit QUE la mémoire de la Reine, jamais GitHub : sonder ici ne
// coûte pas le quota de l'hôte (cf. `tests/issues-livraisons-ecran.test.ts`).

import { useEffect, useState } from 'react';
import { fetchMergeResult } from '../api';
import type { MergeRunResult } from '../api';

export type SuiviMerge =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'polling'; mergeId: string; since: number }
  | { phase: 'done'; result: MergeRunResult }
  | { phase: 'timeout' }
  /** `erreur` garde le rejet d'origine : un refus typé se LIT, pas seulement son texte. */
  | { phase: 'error'; message: string; erreur: unknown };

/** Relevé d'une action humaine : toutes les 3 s tant que le merge n'est pas rendu. */
const PAS_MS = 3_000;

/**
 * Une commande tapée dans un champ, en argv — ou `undefined` si le champ est
 * vide. Jamais interprétée par un shell : le nœud lance l'argv tel quel.
 */
export function argv(saisie: string): string[] | undefined {
  return saisie.trim() ? saisie.trim().split(/\s+/) : undefined;
}

export function useSuiviMerge(
  projectId: string,
  delaiMs: number,
): { suivi: SuiviMerge; lancer: (depart: () => Promise<{ mergeId: string }>) => void } {
  const [suivi, setSuivi] = useState<SuiviMerge>({ phase: 'idle' });

  const lancer = (depart: () => Promise<{ mergeId: string }>): void => {
    setSuivi({ phase: 'starting' });
    depart()
      .then((d) => setSuivi({ phase: 'polling', mergeId: d.mergeId, since: Date.now() }))
      .catch((e: unknown) =>
        setSuivi({
          phase: 'error',
          message: e instanceof Error ? e.message : String(e),
          erreur: e,
        }),
      );
  };

  useEffect(() => {
    if (suivi.phase !== 'polling') return;
    const { mergeId, since } = suivi;
    let alive = true;
    const id = window.setInterval(() => {
      if (Date.now() - since > delaiMs) {
        window.clearInterval(id);
        if (alive) setSuivi({ phase: 'timeout' });
        return;
      }
      fetchMergeResult(projectId)
        .then(({ result }) => {
          if (!alive || !result || result.mergeId !== mergeId) return;
          window.clearInterval(id);
          setSuivi({ phase: 'done', result });
        })
        .catch(() => {
          /* relevé raté : on retente au prochain battement */
        });
    }, PAS_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [suivi, projectId, delaiMs]);

  return { suivi, lancer };
}
