// LES DEUX ISSUES D'UNE EXÉCUTION QUE SA VIGIE RANGE (G13) — un fait, une phrase.
//
// La vigie du nœud (`adapters/vigie-enlisement.ts`) lit le flux d'outils que
// l'adaptateur analyse déjà, et rend l'une de deux issues, DISTINCTES parce
// qu'elles n'accusent pas la même chose :
//
//   · `enlisement` — l'agent tourne en rond (même appel, même retour ; même
//     appel rejeté par le cadre du CLI ; deux appels alternés sans progrès).
//     C'est le MODÈLE qui s'est enlisé : la tentative est un échec ordinaire,
//     compté comme tel (reprise, Génome, modèle écarté des reprises) — mais il
//     dit sa cause, au lieu d'un « délai dépassé » muet un quart d'heure plus
//     tard ;
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
 * sa SURCHARGE (529, 500, 503, « high demand »), ou plus de réponse du tout
 * (réseau coupé, 502/504 d'une passerelle qui ne joint pas l'amont).
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

/** Un jour : au-delà, une remise à zéro se dit avec sa DATE — « 15:45 » seul mentirait. */
export const UN_JOUR_MS = 86_400_000;

/**
 * La plus lointaine remise à zéro crue : la plus longue fenêtre qu'un CLI
 * déclare est hebdomadaire (`seven_day` chez Claude Code, la limite d'usage
 * hebdomadaire de Codex), plus un jour. Au-delà, la valeur est aberrante
 * (`resetsAt` forgé, corrompu) : elle est IGNORÉE, jamais crue ni affichée —
 * 9e18 rendait une date invalide, et son formatage levait.
 */
export const REMISE_MAX_MS = 8 * UN_JOUR_MS;

/** Une remise à zéro crédible à l'instant `maintenant` : un instant à venir, sous 8 jours. */
export function remiseCredible(remiseA: unknown, maintenant: number): remiseA is number {
  return (
    typeof remiseA === 'number' &&
    Number.isSafeInteger(remiseA) &&
    remiseA > maintenant &&
    remiseA - maintenant <= REMISE_MAX_MS
  );
}

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

/**
 * L'épuisement LU ; une remise à zéro hors du crédible tombe seule. Relu sur un
 * fait ANCIEN (le Journal, la chronologie), sa remise est passée : elle
 * garde sa place jusqu'à un jour en arrière, pour être dite telle qu'elle fut.
 */
export function epuisementDepuis(
  v: unknown,
  maintenant = Date.now(),
): EpuisementFournisseur | undefined {
  if (!estObjet(v)) return undefined;
  const cause = CAUSES_EPUISEMENT.find((c) => c === v.cause);
  if (!cause) return undefined;
  const remise = v.remiseA;
  const lisible =
    typeof remise === 'number' &&
    Number.isSafeInteger(remise) &&
    remise > maintenant - UN_JOUR_MS &&
    remise <= maintenant + REMISE_MAX_MS;
  return lisible ? { cause, remiseA: remise } : { cause };
}

/**
 * Une heure de remise à zéro, dite par `heure` sous un jour, par `dateHeure`
 * au-delà — jamais une exception : une date que le moteur ne sait pas écrire
 * n'est pas dite.
 */
export function direRemise(
  remiseA: number,
  maintenant: number,
  heure: (d: Date) => string,
  dateHeure: (d: Date) => string,
): string {
  const d = new Date(remiseA);
  if (!Number.isFinite(d.getTime())) return '?';
  return Math.abs(remiseA - maintenant) < UN_JOUR_MS ? heure(d) : dateHeure(d);
}

/** Une traduction à la manière de l'écran : la phrase française, puis l'anglaise. */
export type DireFrEn = (fr: string, en: string) => string;

/**
 * La phrase d'une issue — au journal du nœud (`[hive] …`), dans le Journal et
 * le tiroir. `heure` formate la remise à zéro déclarée : à l'heure de qui
 * regarde à l'écran, en UTC au nœud, qui ne sait pas qui le lira ; avec sa
 * date au-delà d'un jour (`UN_JOUR_MS`).
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
          `enlisé : même appel d’outil rejeté par le CLI ${fois} fois de suite (${outil})`,
          `stuck: same tool call rejected by the CLI ${fois} times in a row (${outil})`,
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
        `fournisseur injoignable : son API ne répond pas${remise}`,
        `provider unreachable: its API does not answer${remise}`,
      );
  }
}
