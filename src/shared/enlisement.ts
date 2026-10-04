// LES DEUX ISSUES D'UNE EXÉCUTION QUE SA VIGIE ARRÊTE (G13) — un fait, une phrase.
//
// La vigie du nœud (`adapters/vigie-enlisement.ts`) lit le flux d'outils que
// l'adaptateur analyse déjà, et rend l'une de deux issues, DISTINCTES parce
// qu'elles n'accusent pas la même chose :
//
//   · `enlisement` — l'agent tourne en rond (même appel, même retour ; même
//     appel en échec ; deux appels alternés sans progrès). C'est le MODÈLE qui
//     s'est enlisé : la tentative est un échec ordinaire, compté comme tel
//     (reprise, Génome, modèle écarté des reprises) — mais il dit sa cause, au
//     lieu d'un « délai dépassé » muet un quart d'heure plus tard ;
//   · `epuisement_fournisseur` — le fournisseur ne sert plus (limite de débit,
//     quota d'abonnement, surcharge, plus de réponse). Rien à reprocher au
//     modèle : l'issue prend le chemin des pannes d'INFRASTRUCTURE qui existe
//     déjà (`AdapterResult.infra` → `task_reject` → `Scheduler.rejectTask`),
//     sans brûler de tentative, hors de toute note de qualité.
//
// Ce module porte leur forme sur le fil — validée à la réception, comme
// `arret-budgetaire.ts` — et la phrase qui les dit, au nœud comme à l'écran.

/** Ce que la vigie a vu se répéter (motifs portés du StuckDetector d'OpenHands). */
export const MOTIFS_ENLISEMENT = ['repetition', 'erreurs', 'oscillation'] as const;
export type MotifEnlisement = (typeof MOTIFS_ENLISEMENT)[number];

/** L'agent tournait en rond : un échec du modèle, qui dit sa cause. */
export interface Enlisement {
  motif: MotifEnlisement;
  /** Combien d'appels d'affilée la boucle a pris avant l'arrêt. */
  fois: number;
  /** L'outil du dernier appel de la boucle, tel que le CLI le nomme. */
  outil: string;
}

/**
 * Pourquoi le fournisseur ne sert plus : sa LIMITE (débit, quota, crédits),
 * sa SURCHARGE (529, 5xx, « high demand »), ou plus de réponse du tout.
 */
export const CAUSES_EPUISEMENT = ['limite', 'surcharge', 'injoignable'] as const;
export type CauseEpuisement = (typeof CAUSES_EPUISEMENT)[number];

/** Le fournisseur était épuisé : une panne d'infrastructure, jamais un échec du modèle. */
export interface EpuisementFournisseur {
  cause: CauseEpuisement;
  /** La remise à zéro que le CLI a DÉCLARÉE (ms epoch) ; absente s'il n'en a rien dit. */
  remiseA?: number;
}

/** Le verdict de la vigie : l'issue, et ce qui la décrit. */
export type ArretVigie =
  | ({ issue: 'enlisement' } & Enlisement)
  | ({ issue: 'epuisement_fournisseur' } & EpuisementFournisseur);

/** Un nom d'outil sur le fil : court, sur une ligne. */
const OUTIL_MAX = 80;

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** L'enlisement LU d'un message ou d'un événement ; mal formé : absent, jamais inventé. */
export function enlisementDepuis(v: unknown): Enlisement | undefined {
  if (!estObjet(v)) return undefined;
  const { motif, fois, outil } = v;
  const motifLu = MOTIFS_ENLISEMENT.find((m) => m === motif);
  if (!motifLu || typeof fois !== 'number' || !Number.isSafeInteger(fois)) return undefined;
  if (fois < 2 || fois > 1_000 || typeof outil !== 'string') return undefined;
  const nom = outil.replace(/\s+/g, ' ').trim().slice(0, OUTIL_MAX);
  return nom === '' ? undefined : { motif: motifLu, fois, outil: nom };
}

/** L'épuisement LU ; une remise à zéro hors du raisonnable tombe seule. */
export function epuisementDepuis(v: unknown): EpuisementFournisseur | undefined {
  if (!estObjet(v)) return undefined;
  const cause = CAUSES_EPUISEMENT.find((c) => c === v.cause);
  if (!cause) return undefined;
  const remise = v.remiseA;
  const lisible = typeof remise === 'number' && Number.isSafeInteger(remise) && remise > 0;
  return lisible ? { cause, remiseA: remise } : { cause };
}

/** Une traduction à la manière de l'écran : la phrase française, puis l'anglaise. */
export type DireFrEn = (fr: string, en: string) => string;

/**
 * La phrase d'un arrêt — au journal du nœud (`[hive] …`), dans le Journal et
 * le tiroir. `heure` formate la remise à zéro déclarée : à l'heure de qui
 * regarde à l'écran, en UTC au nœud, qui ne sait pas qui le lira.
 */
export function direArret(arret: ArretVigie, t: DireFrEn, heure: (ms: number) => string): string {
  if (arret.issue === 'enlisement') {
    const { fois, outil } = arret;
    switch (arret.motif) {
      case 'repetition':
        return t(
          `enlisé : même appel d’outil répété ${fois} fois, même résultat (${outil})`,
          `stuck: same tool call repeated ${fois} times, same result (${outil})`,
        );
      case 'erreurs':
        return t(
          `enlisé : même appel d’outil en échec ${fois} fois de suite (${outil})`,
          `stuck: same tool call failed ${fois} times in a row (${outil})`,
        );
      case 'oscillation':
        return t(
          `enlisé : deux appels d’outil alternés sans progrès, ${fois} appels (${outil})`,
          `stuck: two tool calls alternating with no progress, ${fois} calls (${outil})`,
        );
    }
  }
  const remise =
    arret.remiseA === undefined
      ? ''
      : t(`, remise à zéro à ${heure(arret.remiseA)}`, `, resets at ${heure(arret.remiseA)}`);
  switch (arret.cause) {
    case 'limite':
      return t(
        `fournisseur épuisé : limite atteinte${remise}`,
        `provider exhausted: limit reached${remise}`,
      );
    case 'surcharge':
      return t(
        `fournisseur épuisé : surchargé${remise}`,
        `provider exhausted: overloaded${remise}`,
      );
    case 'injoignable':
      return t(
        `fournisseur injoignable : relances sans réponse${remise}`,
        `provider unreachable: retries without an answer${remise}`,
      );
  }
}
