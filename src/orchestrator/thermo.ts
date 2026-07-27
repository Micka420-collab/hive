// Thermorégulation — la ruche ventile quand elle surchauffe.
//
// Quand la ruche réelle monte en température, les ouvrières battent des ailes
// pour la refroidir. Ici, la « chaleur » est la part d'issues défavorables
// (échecs, re-tentatives, refus) observée dans le journal récent : plus
// l'essaim accumule d'échecs, plus il chauffe, et plus l'orchestrateur réduit
// la concurrence effective par nœud pour laisser la ruche refroidir — puis la
// restaure quand ça va mieux. Comme pulse.ts et ghost.ts, ce module est PUR :
// aucune I/O, une vue dérivée du journal d'événements, déterministe.

/** Bandes de température, de la plus calme à la plus critique. */
export type BandeThermo = 'froide' | 'normale' | 'chaude' | 'surchauffe';

/** Fenêtre d'observation : seules les 10 dernières minutes du journal comptent. */
export const FENETRE_MS = 10 * 60 * 1_000;

/**
 * Les SEULS types d'événements que la température regarde. L'appelant lit le
 * journal avec ce filtre ET la fenêtre temporelle : borner la lecture à un LOT
 * (les N derniers événements, quel que soit leur type) rendait la fenêtre de
 * 10 minutes fictive — un flot de `task_progress`, de loin le type le plus
 * fréquent, évinçait les issues et aveuglait la ventilation.
 */
export const TYPES_THERMO = ['task_done', 'task_failed', 'task_retry', 'task_rejected'] as const;

/** En deçà de ce nombre d'issues, l'échantillon est trop maigre pour juger. */
const ECHANTILLON_MIN = 4;

/** Température de repos d'un échantillon maigre : jamais de panique à froid. */
const TEMPERATURE_REPOS = 20;

// Poids de chaque signal « chaud » : un échec pèse plein pot, un refus
// (souvent un agent en panne) presque autant, une re-tentative moitié plus —
// elle sera peut-être suivie d'un succès.
const POIDS_ECHEC = 1;
const POIDS_RETRY = 0.6;
const POIDS_REFUS = 0.8;

/** Frontières des bandes (température dans [0, 100]). */
const SEUIL_NORMALE = 25;
const SEUIL_CHAUDE = 50;
const SEUIL_SURCHAUFFE = 75;

/** Facteur de ventilation par bande : la part de concurrence conservée. */
const FACTEURS: Record<BandeThermo, number> = {
  froide: 1,
  normale: 1,
  chaude: 0.75,
  surchauffe: 0.5,
};

/** Une prise de température : la valeur, sa bande, et les signaux comptés. */
export interface LectureThermo {
  /** Température dans [0, 100] : 0 = tout réussit, 100 = tout échoue. */
  temperature: number;
  bande: BandeThermo;
  /** Facteur de ventilation associé à la bande (1 = pleine concurrence). */
  facteur: number;
  /**
   * Issues comptées dans la fenêtre d'observation (transparence). `echecs`
   * exclut les échecs en cascade, `refusInfra` ne compte que les refus
   * d'infrastructure — le nom du champ dit désormais ce qu'il compte.
   */
  signaux: { echecs: number; retries: number; refusInfra: number; succes: number; total: number };
}

/**
 * Prend la température de la ruche en repliant le journal récent : ratio
 * pondéré d'issues défavorables (task_failed, task_retry, task_rejected)
 * parmi toutes les issues (avec task_done) des 10 dernières minutes. Un
 * échantillon de moins de 4 issues est trop maigre pour juger : bande
 * 'froide' d'office.
 *
 * Le module reste PUR — il lit le payload, il ne l'interroge nulle part :
 *  - un `task_failed` de CASCADE (`reason: 'dependency_failed'`) n'est pas un
 *    échec d'agent : une seule vraie panne propage un échec à toutes ses
 *    dépendantes et ferait chauffer la ruche dix fois pour un seul incident ;
 *  - seul un `task_rejected` d'INFRASTRUCTURE (`infra: true` — agent
 *    injoignable, quota) compte : un refus de saturation ou de Night Shift
 *    (nœud hors service) vient d'une ruche parfaitement saine.
 */
export function lireTemperature(
  events: Array<{ type: string; ts: number; payload?: Record<string, unknown> }>,
  now: number,
): LectureThermo {
  const signaux = { echecs: 0, retries: 0, refusInfra: 0, succes: 0, total: 0 };
  const debut = now - FENETRE_MS;
  for (const e of events) {
    if (e.ts < debut) continue; // hors fenêtre : le passé lointain ne chauffe plus
    switch (e.type) {
      case 'task_done':
        signaux.succes += 1;
        break;
      case 'task_failed':
        if (e.payload?.reason !== 'dependency_failed') signaux.echecs += 1;
        break;
      case 'task_retry':
        signaux.retries += 1;
        break;
      case 'task_rejected':
        if (e.payload?.infra === true) signaux.refusInfra += 1;
        break;
      default:
        break;
    }
  }
  signaux.total = signaux.succes + signaux.echecs + signaux.retries + signaux.refusInfra;

  if (signaux.total < ECHANTILLON_MIN) {
    return { temperature: TEMPERATURE_REPOS, bande: 'froide', facteur: FACTEURS.froide, signaux };
  }

  const chaleur =
    signaux.echecs * POIDS_ECHEC + signaux.retries * POIDS_RETRY + signaux.refusInfra * POIDS_REFUS;
  const temperature = Math.min(100, Math.round((100 * chaleur) / signaux.total));
  const bande: BandeThermo =
    temperature < SEUIL_NORMALE
      ? 'froide'
      : temperature < SEUIL_CHAUDE
        ? 'normale'
        : temperature < SEUIL_SURCHAUFFE
          ? 'chaude'
          : 'surchauffe';
  return { temperature, bande, facteur: FACTEURS[bande], signaux };
}

/**
 * Concurrence réellement accordée à un nœud sous ventilation : plancher à 1 —
 * la ruche ne s'arrête jamais, elle ralentit.
 */
export function concurrenceEffective(maxConcurrency: number, facteur: number): number {
  return Math.max(1, Math.floor(maxConcurrency * facteur));
}
