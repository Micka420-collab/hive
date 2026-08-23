// L'HORLOGE DU CHANTIER — combien de temps une ouvrière va-t-elle vraiment
// mettre, et qu'a-t-on le droit d'en annoncer.
//
// MODULE PUR. Il ne lit ni base ni horloge système : on lui DONNE l'historique
// et l'instant. C'est ce qui le rend éprouvable, et c'est aussi ce qui permet
// de le rejouer sur des mois de données réelles sans rien simuler.
//
// ═══ LA PROMESSE QU'IL NE FAUT PAS FAIRE ═══════════════════════════════════
//
// « Un temps qui reflète à la perfection la réalité » n'existe pas. La durée
// d'une tâche de codage dépend de ce qu'on découvre EN LA FAISANT — un test qui
// révèle un défaut voisin, une dépendance qui ne compile pas, un modèle qui
// part en boucle. Une prédiction exacte demanderait de connaître le futur du
// travail avant de l'avoir fait.
//
// Et viser cette perfection produit toujours la même chose : un chiffre unique,
// faux, que plus personne ne croit au bout de trois fois. Le pire des mondes —
// on a payé le coût de l'annonce sans en tirer le bénéfice.
//
// ═══ CE QUE CE MODULE PROMET À LA PLACE ════════════════════════════════════
//
// Trois choses, et chacune est mesurable :
//
//   1. Il prédit à partir de ce qui S'EST RÉELLEMENT PASSÉ — les `durationMs`
//      que la ruche enregistre —, jamais à partir de ce qu'un agent CROIT.
//      Un modèle qui s'auto-estime est le plus mauvais estimateur du lot : il
//      décrit son intention, pas son historique.
//
//   2. Il annonce un INTERVALLE avec sa confiance, jamais un point. « entre
//      4 et 21 minutes, 8 fois sur 10 » se planifie ; « 12 minutes » ne se
//      planifie pas, parce que c'est faux presque à coup sûr.
//
//   3. Il SE NOTE. `calibrer()` compare les annonces passées à ce qui est
//      arrivé : si 80 % des annonces à 80 % sont tombées dedans, l'horloge est
//      honnête ; si 40 % le sont, elle ment et le dit elle-même.
//
// Une horloge qui affiche sa propre erreur est utilisable. Une horloge
// faussement précise ne l'est pas — c'est toute la différence, et c'est la
// seule forme de « réalisme » qu'on puisse tenir.

/** En dessous, on n'a pas de quoi parler de quantiles. */
export const OBSERVATIONS_MIN = 5;

/** Le lot d'observations dans lequel une annonce a puisé. */
export type Socle =
  | 'exact' // même caste ET même genre de tâche
  | 'caste' // même caste, genres confondus
  | 'global' // tout l'historique du projet
  | 'aucun'; // rien d'assez fourni : on ne chiffre pas

export interface Observation {
  readonly dureeMs: number;
  readonly caste?: string;
  readonly genre?: string;
  /** Une tâche qui a ÉCHOUÉ n'a pas la durée d'une tâche qui a réussi. */
  readonly reussie?: boolean;
}

export interface Annonce {
  readonly socle: Socle;
  /** Nombre d'observations qui ont servi. Sans lui, un quantile ne veut rien dire. */
  readonly n: number;
  readonly p50Ms: number;
  readonly p80Ms: number;
  readonly p95Ms: number;
}

/**
 * Le quantile empirique, par interpolation linéaire entre rangs.
 *
 * ─── POURQUOI PAS UNE MOYENNE, NI UN ÉCART-TYPE ──────────────────────────────
 *
 * Les durées de tâches ne sont pas symétriques : on ne peut pas finir en moins
 * de zéro, mais on peut toujours rater plus longtemps. La distribution traîne
 * à droite, souvent d'un facteur dix. Une moyenne y est tirée par les queues et
 * décrit une tâche qui n'existe pas ; un écart-type suppose une symétrie qui
 * n'est pas là.
 *
 * Le quantile empirique ne suppose RIEN sur la forme. Il dit exactement ce
 * qu'on a vu, et c'est tout ce qu'on peut honnêtement dire.
 */
export function quantile(echantillon: readonly number[], p: number): number {
  if (echantillon.length === 0) return 0;
  const tries = [...echantillon].sort((a, b) => a - b);
  if (tries.length === 1) return tries[0]!;
  const borne = Math.min(1, Math.max(0, p));
  const rang = borne * (tries.length - 1);
  const bas = Math.floor(rang);
  const haut = Math.ceil(rang);
  if (bas === haut) return tries[bas]!;
  return tries[bas]! + (rang - bas) * (tries[haut]! - tries[bas]!);
}

/** Le lot le plus SPÉCIFIQUE qui atteigne le seuil, sinon on élargit. */
function socleRetenu(
  historique: readonly Observation[],
  caste?: string,
  genre?: string,
): { socle: Socle; lot: readonly Observation[] } {
  const reussies = historique.filter((o) => o.reussie !== false);
  const exact =
    caste !== undefined && genre !== undefined
      ? reussies.filter((o) => o.caste === caste && o.genre === genre)
      : [];
  if (exact.length >= OBSERVATIONS_MIN) return { socle: 'exact', lot: exact };

  const parCaste = caste !== undefined ? reussies.filter((o) => o.caste === caste) : [];
  if (parCaste.length >= OBSERVATIONS_MIN) return { socle: 'caste', lot: parCaste };

  if (reussies.length >= OBSERVATIONS_MIN) return { socle: 'global', lot: reussies };
  return { socle: 'aucun', lot: [] };
}

/**
 * Ce qu'on a le droit d'annoncer AVANT de commencer.
 *
 * `socle: 'aucun'` n'est pas une panne : c'est la réponse juste quand la ruche
 * n'a pas encore assez travaillé pour savoir. Une horloge neuve qui invente un
 * chiffre est pire qu'une horloge neuve qui dit « je ne sais pas encore ».
 */
export function estimerDuree(
  historique: readonly Observation[],
  cible: { caste?: string; genre?: string } = {},
): Annonce {
  const { socle, lot } = socleRetenu(historique, cible.caste, cible.genre);
  if (socle === 'aucun') {
    return {
      socle,
      n: historique.filter((o) => o.reussie !== false).length,
      p50Ms: 0,
      p80Ms: 0,
      p95Ms: 0,
    };
  }
  const durees = lot.map((o) => o.dureeMs);
  return {
    socle,
    n: durees.length,
    p50Ms: Math.round(quantile(durees, 0.5)),
    p80Ms: Math.round(quantile(durees, 0.8)),
    p95Ms: Math.round(quantile(durees, 0.95)),
  };
}

export type EtatReste =
  | { readonly connu: true; readonly p50Ms: number; readonly p80Ms: number; readonly n: number }
  /**
   * La tâche court depuis plus longtemps que TOUT ce qu'on a observé. Ce n'est
   * pas « bientôt fini » — c'est qu'on est sorti du domaine où l'historique
   * dit quelque chose.
   */
  | { readonly connu: false; readonly motif: 'hors_domaine'; readonly recordMs: number }
  | { readonly connu: false; readonly motif: 'trop_peu'; readonly n: number };

/**
 * Combien de temps ENCORE, sachant qu'on court déjà depuis `ecouleMs`.
 *
 * ─── CE QUI SÉPARE UNE VRAIE ESTIMATION D'UN COMPTE À REBOURS ────────────────
 *
 * Un compte à rebours naïf annonce « 12 min », puis 11, puis 10, et reste
 * bloqué sur « bientôt » pendant une heure. Il traite le temps écoulé comme une
 * DÉDUCTION, alors que c'est une INFORMATION.
 *
 * Le temps déjà passé est la meilleure nouvelle donnée qu'on ait : une tâche
 * qui dure depuis 30 minutes n'est plus une tâche moyenne, c'est une tâche
 * DIFFICILE. On ne garde donc que les observations qui ont, elles aussi,
 * dépassé `ecouleMs` — et on regarde combien de temps il leur restait à ce
 * moment-là.
 *
 * C'est ce conditionnement qui fait qu'une estimation peut AUGMENTER, et c'est
 * juste qu'elle le puisse : dans la vraie vie, plus ça traîne, plus il en
 * reste.
 *
 * ─── ET LE CAS QU'IL NE FAUT SURTOUT PAS ARRONDIR À ZÉRO ─────────────────────
 *
 * Quand `ecouleMs` dépasse la plus longue durée jamais vue, il ne reste AUCUNE
 * observation comparable. Répondre « 0 » serait le mensonge le plus coûteux du
 * module : il ferait croire à une fin imminente au moment précis où la tâche
 * est en train de partir en vrille. On rend `hors_domaine`, avec le record —
 * c'est un signal, pas une estimation.
 */
export function resteEstime(
  historique: readonly Observation[],
  ecouleMs: number,
  cible: { caste?: string; genre?: string } = {},
): EtatReste {
  const { socle, lot } = socleRetenu(historique, cible.caste, cible.genre);
  if (socle === 'aucun') {
    return { connu: false, motif: 'trop_peu', n: lot.length };
  }
  const durees = lot.map((o) => o.dureeMs);
  const encore = durees.filter((d) => d > ecouleMs).map((d) => d - ecouleMs);
  if (encore.length === 0) {
    return { connu: false, motif: 'hors_domaine', recordMs: Math.max(...durees) };
  }
  return {
    connu: true,
    n: encore.length,
    p50Ms: Math.round(quantile(encore, 0.5)),
    p80Ms: Math.round(quantile(encore, 0.8)),
  };
}

export interface AnnoncePassee {
  readonly p80Ms: number;
  readonly reelMs: number;
}

export interface Calibration {
  readonly n: number;
  /** Part des annonces à 80 % que le réel n'a pas dépassées. Vise 0,8. */
  readonly partTenue: number;
  /** `partTenue - 0.8`. Négatif : l'horloge est OPTIMISTE (elle sous-estime). */
  readonly ecart: number;
  readonly verdict: 'honnete' | 'optimiste' | 'pessimiste' | 'trop_peu';
}

/** Tolérance autour de 0,8 en deçà de laquelle on ne crie pas au loup. */
export const MARGE_CALIBRATION = 0.1;

/**
 * L'horloge se note elle-même.
 *
 * C'est la pièce qui rend tout le reste utilisable. Sans elle, un intervalle
 * n'est qu'un chiffre plus large — donc plus difficile à prendre en défaut, ce
 * qui n'est pas la même chose qu'être juste.
 *
 * On mesure la seule chose qui compte pour qui planifie : parmi les annonces
 * « 8 fois sur 10 », combien sont effectivement tombées dedans ? Un écart
 * NÉGATIF est le plus coûteux — l'horloge promet plus court que la réalité, et
 * tout ce qui s'appuie dessus déborde.
 */
export function calibrer(annonces: readonly AnnoncePassee[]): Calibration {
  if (annonces.length < OBSERVATIONS_MIN) {
    return { n: annonces.length, partTenue: 0, ecart: 0, verdict: 'trop_peu' };
  }
  const tenues = annonces.filter((a) => a.reelMs <= a.p80Ms).length;
  const partTenue = tenues / annonces.length;
  const ecart = partTenue - 0.8;
  // loupe : équivalent — <= → <. Le mutant ne diffère QUE si `|ecart|` vaut
  // EXACTEMENT `MARGE_CALIBRATION`. Or `ecart` vaut `tenues / total - 0.8`, et
  // aucun couple d'entiers ne rend 0,1 exactement en binaire : `90/100 - 0.8`
  // donne `0.09999999999999998`. Mesuré sur tous les dénominateurs jusqu'à
  // 2000 : ZÉRO couple atteint la borne. Aucune entrée ne sépare les deux
  // mondes — un banc sur cette borne serait du décor.
  const verdict =
    Math.abs(ecart) <= MARGE_CALIBRATION ? 'honnete' : ecart < 0 ? 'optimiste' : 'pessimiste';
  return { n: annonces.length, partTenue, ecart, verdict };
}

/** Une durée, dite comme un humain la lit. */
export function direDuree(ms: number): string {
  if (ms < 1000) return 'moins d’une seconde';
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  return reste === 0 ? `${h} h` : `${h} h ${String(reste).padStart(2, '0')}`;
}

/**
 * L'annonce, telle qu'elle s'affiche. Elle porte TOUJOURS son incertitude et
 * la taille de son socle : un intervalle sans son `n` invite à lui faire une
 * confiance qu'il n'a pas méritée.
 */
export function direAnnonce(a: Annonce, lang: 'fr' | 'en' = 'fr'): string {
  if (a.socle === 'aucun') {
    return lang === 'en'
      ? `no estimate yet — ${a.n} observation(s), ${OBSERVATIONS_MIN} needed`
      : `pas encore d’estimation — ${a.n} observation(s), il en faut ${OBSERVATIONS_MIN}`;
  }
  return lang === 'en'
    ? `${direDuree(a.p50Ms)}–${direDuree(a.p80Ms)} (8 times out of 10, ${a.n} obs.)`
    : `${direDuree(a.p50Ms)} à ${direDuree(a.p80Ms)} — 8 fois sur 10 (${a.n} obs.)`;
}
