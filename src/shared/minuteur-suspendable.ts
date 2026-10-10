// Un minuteur qu'on peut SUSPENDRE — l'horloge d'une tâche mise en pause.
//
// ─── POURQUOI UN `setTimeout` NE SUFFIT PLUS ─────────────────────────────────
//
// Le délai dur d'un agent (`exec.ts`, quinze minutes) et le budget de durée
// d'un enfant délégué (`client.ts`) couraient en temps MUR. Une pause de
// l'agent (Sandbox Live : SIGSTOP de son arbre, `pause` de son conteneur)
// laissait donc tourner l'horloge : dix minutes de pause, et l'agent repris
// n'avait plus que cinq minutes — ou était tué pendant qu'il dormait, au
// délai, pour un temps qu'il n'avait pas consommé.
//
// Ce minuteur retient ce qui RESTE à courir au moment de la suspension, et le
// réarme à la reprise. Il ne mesure que le temps où l'on court : c'est la
// seule horloge juste pour un budget de travail.
//
// Pur de toute I/O ; l'horloge et les minuteurs sont injectables pour les bancs.

export interface MinuteurSuspendable {
  /** Arrête de compter ; le temps restant est retenu. Sans effet s'il est fini. */
  suspendre(): void;
  /** Reprend le compte là où il s'était arrêté. */
  reprendre(): void;
  /** Abandonne sans jamais déclencher. */
  annuler(): void;
  /** Le temps qui reste à courir (ms), `0` une fois déclenché ou annulé. */
  restant(): number;
}

export interface HorlogeMinuteur {
  maintenant(): number;
  armer(fn: () => void, ms: number): unknown;
  desarmer(poignee: unknown): void;
}

const HORLOGE_REELLE: HorlogeMinuteur = {
  // L'horloge MONOTONE, celle où tire `setTimeout` : ce qui reste se mesure sur
  // la même que le tir. En temps mur, une veille, une VM reprise ou un pas de
  // NTP faisaient lire « épuisé » un délai qui courait encore — ou l'inverse.
  maintenant: () => performance.now(),
  armer: (fn, ms) => {
    const m = setTimeout(fn, ms);
    // Un délai de garde ne retient pas le processus : un nœud qui s'arrête
    // n'attend pas quinze minutes le délai d'une tâche qu'il a annulée.
    m.unref?.();
    return m;
  },
  desarmer: (poignee) => clearTimeout(poignee as NodeJS.Timeout),
};

export function creerMinuteurSuspendable(
  delaiMs: number,
  declencher: () => void,
  horloge: HorlogeMinuteur = HORLOGE_REELLE,
): MinuteurSuspendable {
  let restant = Math.max(0, delaiMs);
  let depuis = horloge.maintenant();
  let poignee: unknown = null;
  let fini = false;

  const armer = (): void => {
    depuis = horloge.maintenant();
    poignee = horloge.armer(() => {
      poignee = null;
      fini = true;
      restant = 0;
      declencher();
    }, restant);
  };
  armer();

  return {
    suspendre() {
      if (fini || poignee === null) return;
      horloge.desarmer(poignee);
      poignee = null;
      restant = Math.max(0, restant - (horloge.maintenant() - depuis));
    },
    reprendre() {
      if (fini || poignee !== null) return;
      armer();
    },
    annuler() {
      if (poignee !== null) horloge.desarmer(poignee);
      poignee = null;
      fini = true;
      restant = 0;
    },
    restant() {
      if (fini) return 0;
      return poignee === null ? restant : Math.max(0, restant - (horloge.maintenant() - depuis));
    },
  };
}
