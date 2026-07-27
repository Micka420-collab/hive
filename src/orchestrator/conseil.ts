// Le Conseil des Éclaireuses — la ruche se demande si elle va dans la bonne
// direction, et cherche mieux.
//
// ─── D'OÙ VIENT CE PROTOCOLE ─────────────────────────────────────────────────
//
// Quand une colonie essaime, elle doit choisir un nouveau site. Personne ne
// décide : des ÉCLAIREUSES partent explorer, reviennent DANSER avec une
// insistance proportionnelle à ce qu'elles ont trouvé, et — c'est le point
// crucial — les autres ne les croient pas sur parole : elles vont VÉRIFIER
// elles-mêmes. Une danse que personne ne reprend s'éteint. Une éclaireuse
// convaincue qu'un site est mauvais émet un SIGNAL D'ARRÊT contre sa danse. La
// colonie part quand un QUORUM d'éclaireuses a vérifié le même site.
//
// Ce n'est pas une jolie image : c'est un algorithme de consensus distribué,
// robuste au bruit, sans chef, et il évite précisément les quatre pièges qui
// ruinent une délibération d'agents :
//
//   1. LA PREMIÈRE IDÉE GAGNE. Sans décroissance, la proposition arrivée en
//      premier accumule du soutien par simple ancienneté. Ici une danse non
//      renforcée S'ÉTEINT.
//   2. L'UNANIMITÉ DE CLONES. Dix instances du même modèle qui s'accordent, ce
//      n'est pas dix avis : c'est un avis répété dix fois. Le quorum compte les
//      éclaireuses DISTINCTES, et la diversité départage.
//   3. L'AUTO-APPROBATION. Une éclaireuse qui soutient sa propre proposition
//      n'apporte aucune information. Son avis sur elle-même est IGNORÉ.
//   4. LE DÉBAT SANS FIN. Chaque tour coûte du temps-ouvrière réel (La Balance
//      le mesure). Un conseil qui ne converge pas doit le DIRE et s'arrêter,
//      pas tourner indéfiniment.
//
// ─── CE QUE LE CONSEIL NE FAIT PAS ───────────────────────────────────────────
//
// Il ne change RIEN. Son verdict est une PROPOSITION À UN HUMAIN — exactement
// comme la Miellerie propose un merge sans jamais le faire. Une ruche qui
// déciderait seule de sa propre direction serait un système sans propriétaire.
//
// Module PUR : aucune I/O, aucune horloge implicite (`maintenant` est toujours
// un paramètre), aucun aléa. Famille de balance.ts, thermo.ts, gardiennes.ts.

// ─── Réglages, et pourquoi ces valeurs ────────────────────────────────────────

/** Version du protocole, rangée avec chaque session (lecture d'archives). */
export const VERSION_CONSEIL = 1;

/**
 * Demi-vie de l'intensité d'une danse, en tours. Au bout d'un tour sans
 * soutien nouveau, une proposition perd la moitié de son intensité.
 *
 * Agressif, et c'est voulu : le piège n° 1 (« la première idée gagne ») est le
 * plus courant et le plus coûteux. Mieux vaut qu'une bonne idée doive être
 * re-défendue qu'une médiocre survive par inertie.
 */
export const DEMI_VIE_TOURS = 1;

/**
 * Nombre d'éclaireuses DISTINCTES qui doivent avoir vérifié une proposition
 * pour que le quorum soit atteint. Trois, pas deux : deux avis concordants
 * arrivent trop facilement par hasard ou par biais commun.
 */
export const QUORUM_ECLAIREUSES = 3;

/**
 * Nombre minimum de FAMILLES d'agent distinctes parmi les soutiens. Un accord
 * entre claude-code et codex vaut plus que trois claude-code : c'est le même
 * critère que le Parlement (parliament.ts), pour la même raison.
 */
export const DIVERSITE_MIN = 2;

/** Un signal d'arrêt pèse plus qu'un soutien : il est plus coûteux à émettre. */
export const POIDS_ARRET = 1.5;

/** Au-delà, le conseil s'arrête et le dit. Chaque tour coûte du temps réel. */
export const TOURS_MAX = 5;

/** Tours consécutifs sans proposition neuve avant de déclarer l'exploration finie. */
export const TOURS_SECS = 2;

// ─── Le vocabulaire ───────────────────────────────────────────────────────────

/**
 * Une proposition, telle qu'une éclaireuse la rapporte.
 *
 * `qualite` est l'auto-évaluation de son autrice — l'équivalent de la vigueur
 * de sa danse. Elle NE compte PAS dans le quorum (piège n° 3) : elle sert
 * seulement à ordonner ce qu'on donne à vérifier en premier, quand il y a plus
 * de propositions que de vérificatrices disponibles.
 */
export interface Proposition {
  id: string;
  /** Éclaireuse qui l'a rapportée. */
  eclaireuse: string;
  /** Famille d'agent de l'éclaireuse (claude-code, codex…) — sert à la diversité. */
  famille: string;
  titre: string;
  /** Auto-évaluation de 0 à 10. Jamais comptée comme un soutien. */
  qualite: number;
  /** Tour où elle est apparue. */
  tour: number;
}

/** L'avis d'une éclaireuse sur la proposition d'une AUTRE, après vérification. */
export interface Avis {
  propositionId: string;
  eclaireuse: string;
  famille: string;
  /** `soutien` renforce la danse ; `arret` l'inhibe activement. */
  type: 'soutien' | 'arret';
  /** Force de l'avis, de 0 à 10. */
  force: number;
  tour: number;
}

export interface EtatConseil {
  propositions: Proposition[];
  avis: Avis[];
  /** Tour courant (le premier vaut 1). */
  tour: number;
}

/** Ce que devient une proposition une fois le conseil évalué. */
export interface Danse {
  proposition: Proposition;
  /** Intensité après décroissance : le soutien net, actualisé. */
  intensite: number;
  /** Éclaireuses DISTINCTES qui l'ont soutenue (l'autrice exclue). */
  soutiens: string[];
  /** Éclaireuses distinctes qui ont émis un signal d'arrêt. */
  arrets: string[];
  /** Familles d'agent distinctes parmi les soutiens. */
  familles: string[];
  /** Vrai si quorum ET diversité sont atteints. */
  quorum: boolean;
  /** Vrai si l'autrice a tenté de se soutenir elle-même (signalé, jamais compté). */
  autoSoutienIgnore: boolean;
}

export type Issue =
  | 'quorum' // une proposition a convergé : le conseil a une recommandation
  | 'depart' // plusieurs propositions à égalité au quorum : à l'humain de trancher
  | 'sans_quorum' // du débat, mais rien n'a convergé
  | 'epuise' // TOURS_MAX atteint sans convergence
  | 'vide'; // aucune proposition : personne n'a rien trouvé

export interface Verdict {
  version: number;
  issue: Issue;
  /** Danses classées, la plus intense en tête. */
  danses: Danse[];
  /** La recommandation, si et seulement si `issue === 'quorum'`. */
  retenue: Danse | null;
  /** Vrai si un tour de plus a des chances de servir. */
  continuer: boolean;
  /** Pourquoi le conseil s'arrête ou continue — affiché, jamais deviné. */
  motif: string;
}

// ─── L'évaluation ─────────────────────────────────────────────────────────────

/**
 * Facteur de décroissance d'un avis émis au tour `tourAvis`, vu depuis
 * `tourCourant`. Une danse doit être RE-défendue pour rester vive.
 */
export function decroissance(tourAvis: number, tourCourant: number): number {
  const age = Math.max(0, tourCourant - tourAvis);
  return Math.pow(0.5, age / DEMI_VIE_TOURS);
}

/**
 * Évalue l'état du conseil. Fonction PURE et déterministe : mêmes entrées,
 * même verdict — condition pour qu'un conseil soit rejouable et auditable.
 */
export function evaluerConseil(etat: EtatConseil): Verdict {
  if (etat.propositions.length === 0) {
    return {
      version: VERSION_CONSEIL,
      issue: 'vide',
      danses: [],
      retenue: null,
      continuer: etat.tour < TOURS_MAX,
      motif: 'aucune proposition — les éclaireuses n’ont rien rapporté',
    };
  }

  const danses = etat.propositions.map((p) => danserPour(p, etat.avis, etat.tour));
  // Tri stable et TOTAL : intensité, puis nombre de soutiens, puis diversité,
  // puis identifiant. Sans le dernier critère, deux danses parfaitement à
  // égalité s'ordonneraient selon l'ordre d'insertion — un verdict qui dépend
  // de l'ordre d'arrivée n'est pas auditable.
  danses.sort(
    (a, b) =>
      b.intensite - a.intensite ||
      b.soutiens.length - a.soutiens.length ||
      b.familles.length - a.familles.length ||
      a.proposition.id.localeCompare(b.proposition.id),
  );

  const auQuorum = danses.filter((d) => d.quorum);
  if (auQuorum.length === 1) {
    return {
      version: VERSION_CONSEIL,
      issue: 'quorum',
      danses,
      retenue: auQuorum[0]!,
      continuer: false,
      motif: `quorum atteint : ${auQuorum[0]!.soutiens.length} éclaireuses distinctes, ${auQuorum[0]!.familles.length} familles`,
    };
  }
  if (auQuorum.length > 1) {
    // Départage refusé DÉLIBÉRÉMENT. Deux propositions également vérifiées, ce
    // n'est pas une indécision de l'algorithme : c'est une information — il y a
    // deux bonnes directions, et le choix appartient à l'humain. Trancher au
    // hasard (ou sur l'intensité, qui les sépare de peu) donnerait l'illusion
    // d'une décision fondée.
    return {
      version: VERSION_CONSEIL,
      issue: 'depart',
      danses,
      retenue: null,
      continuer: false,
      motif: `${auQuorum.length} propositions atteignent le quorum — à l’humain de trancher`,
    };
  }
  if (etat.tour >= TOURS_MAX) {
    return {
      version: VERSION_CONSEIL,
      issue: 'epuise',
      danses,
      retenue: null,
      continuer: false,
      motif: `${TOURS_MAX} tours sans convergence — le conseil s’arrête plutôt que de brûler du temps-ouvrière`,
    };
  }
  return {
    version: VERSION_CONSEIL,
    issue: 'sans_quorum',
    danses,
    retenue: null,
    continuer: true,
    motif: 'aucune proposition n’a encore réuni le quorum',
  };
}

/** Calcule la danse d'une proposition : soutiens actualisés, arrêts, quorum. */
function danserPour(p: Proposition, tousAvis: Avis[], tour: number): Danse {
  const siens = tousAvis.filter((a) => a.propositionId === p.id);

  // PIÈGE N° 3 — l'auto-approbation. Une éclaireuse qui soutient sa propre
  // proposition n'apporte aucune information : elle répète ce qu'elle a déjà
  // dit en la proposant. On le SIGNALE (c'est un comportement notable) et on
  // l'ignore dans tous les calculs.
  const auto = siens.some((a) => a.eclaireuse === p.eclaireuse);
  const valides = siens.filter((a) => a.eclaireuse !== p.eclaireuse);

  // Un avis par éclaireuse et par proposition : le plus RÉCENT fait foi. Sans
  // cette règle, une éclaireuse insistante pèserait autant que plusieurs.
  const dernierPar = new Map<string, Avis>();
  for (const a of valides) {
    const precedent = dernierPar.get(a.eclaireuse);
    if (!precedent || a.tour >= precedent.tour) dernierPar.set(a.eclaireuse, a);
  }
  const retenus = [...dernierPar.values()];

  let intensite = 0;
  const soutiens: string[] = [];
  const arrets: string[] = [];
  const familles = new Set<string>();
  for (const a of retenus) {
    const poids = a.force * decroissance(a.tour, tour);
    if (a.type === 'soutien') {
      intensite += poids;
      soutiens.push(a.eclaireuse);
      familles.add(a.famille);
    } else {
      intensite -= poids * POIDS_ARRET;
      arrets.push(a.eclaireuse);
    }
  }

  return {
    proposition: p,
    // Une intensité négative n'a pas de sens comme « force de danse » : une
    // proposition abattue vaut zéro, pas moins que rien. La borner évite aussi
    // qu'un classement mette une proposition très critiquée sous une
    // proposition simplement ignorée — alors qu'avoir été examinée et rejetée
    // n'est pas pire que n'avoir intéressé personne.
    intensite: Math.max(0, Number(intensite.toFixed(6))),
    soutiens: soutiens.sort(),
    arrets: arrets.sort(),
    familles: [...familles].sort(),
    // QUORUM, pas majorité : on ne compare pas les propositions entre elles, on
    // exige un nombre absolu de vérifications indépendantes. Une proposition
    // seule en lice ne gagne donc pas par défaut — elle doit être vérifiée.
    quorum:
      soutiens.length >= QUORUM_ECLAIREUSES &&
      familles.size >= DIVERSITE_MIN &&
      arrets.length === 0 &&
      intensite > 0,
    autoSoutienIgnore: auto,
  };
}

// ─── L'exploration ────────────────────────────────────────────────────────────

/**
 * Faut-il un tour de plus ? Vrai tant qu'on n'a pas atteint le plafond ET que
 * l'exploration rapporte encore du neuf.
 *
 * `toursSecs` compte les tours consécutifs SANS proposition nouvelle. Un
 * conseil qui tourne à vide coûte du temps-ouvrière pour rien — et La Balance
 * le compte en `utile`, ce qui fausserait le rendement de la ruche.
 */
export function encoreUnTour(tour: number, toursSecs: number): boolean {
  return tour < TOURS_MAX && toursSecs < TOURS_SECS;
}

/**
 * Les angles d'attaque donnés aux éclaireuses.
 *
 * La DIVERSITÉ DES LENTILLES est ce qui empêche le conseil de tourner en rond :
 * cinq agents à qui l'on pose la même question rendent cinq variantes de la
 * même réponse. On leur donne donc des points de vue explicitement différents,
 * dont deux ADVERSES — sans quoi un conseil ne produit que des encouragements.
 */
export const LENTILLES: readonly { cle: string; angle: string }[] = [
  {
    cle: 'utilite',
    angle:
      'À QUI ce projet sert-il réellement, et pour quoi faire ? Cherche des usages concrets, ' +
      'des utilisateurs plausibles, et ce qui manque pour qu’ils l’adoptent.',
  },
  {
    cle: 'concurrence',
    angle:
      'Que font les projets comparables ? Cherche sur le web ce qui existe déjà, ' +
      'et dis franchement ce qu’ils font MIEUX. Nomme-les.',
  },
  {
    cle: 'faiblesse',
    angle:
      'Attaque le projet. Quelle est la raison la plus solide de croire qu’il ne tiendra pas ? ' +
      'Ne cherche pas à être encourageant.',
  },
  {
    cle: 'levier',
    angle:
      'Quel changement, le plus PETIT possible, augmenterait le plus la valeur du projet ? ' +
      'Cherche le rapport effet/effort, pas la grande idée.',
  },
  {
    cle: 'abandon',
    angle:
      'Que faudrait-il RETIRER ? Quelle partie coûte plus qu’elle ne rapporte ? ' +
      'Un projet grandit aussi en se délestant.',
  },
];

/** Question par défaut posée au conseil, si l'humain n'en pose pas d'autre. */
export const QUESTION_DEFAUT =
  'Ce projet est-il viable, et que faudrait-il changer pour qu’il le soit davantage ?';
