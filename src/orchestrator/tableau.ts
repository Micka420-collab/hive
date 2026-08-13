// Le tableau de bord d'une personne — ce qu'elle doit savoir sur SES projets,
// et dans quel ordre.
//
// ─── POURQUOI UN MODULE, ET PAS UNE ROUTE QUI ASSEMBLE ───────────────────────
//
// Assembler des chiffres est facile ; les CLASSER est la vraie décision, et
// c'est elle qu'on veut pouvoir tester. Un tableau de bord qui affiche tout au
// même niveau n'informe personne : la question à laquelle il doit répondre
// n'est pas « quel est l'état de mes projets » mais « qu'est-ce qui va me
// coûter quelque chose si je ne fais rien aujourd'hui ».
//
// ─── L'ORDRE DES ALERTES EST UNE PRISE DE POSITION ───────────────────────────
//
// Trois natures d'ennui, et elles ne se valent pas :
//
//   1. IRRÉVERSIBLE — des données vont être effacées. Aucune action ultérieure
//      ne les ramène. Passe toujours en premier, même si l'échéance est plus
//      lointaine qu'une autre : une semaine pour sauver son travail vaut mieux
//      qu'un jour pour payer une facture qu'on peut régler après coup.
//   2. LE SERVICE S'ARRÊTE — impayé, période échue. Ennuyeux, réparable.
//   3. LE QUOTA SE VIDE — le travail s'arrêtera bientôt, mais rien n'est perdu.
//
// À nature égale, le plus urgent d'abord. Cet ordre est testé : c'est la seule
// façon d'empêcher qu'une alerte ajoutée demain se glisse au mauvais rang.
//
// ─── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
//
// Il ne décide d'aucun droit. Les droits se calculent dans `abonnement.ts` et
// s'appliquent au serveur ; ici on ne fait que les RACONTER. Un tableau de bord
// qui accorderait quoi que ce soit serait une seconde autorité, et deux
// autorités finissent toujours par diverger.
//
// MODULE PUR. Aucune I/O, aucune horloge implicite.

/** Version de la forme du tableau. Motif VERSION_BALANCE. */
export const VERSION_TABLEAU = 1;

const JOUR_MS = 86_400_000;
const HEURE_MS = 3_600_000;

/**
 * Seuil d'alerte sur le quota.
 *
 * 90 %, et pas 100 : prévenir quand tout est déjà consommé n'est pas prévenir,
 * c'est constater. Il reste alors de quoi finir ce qui tourne et décider.
 */
export const PART_QUOTA_ALERTE = 0.9;

/** En deçà, la fin de période mérite d'être annoncée. */
export const JOURS_FIN_PROCHE = 7;

/** En deçà, l'effacement définitif d'un serveur arrêté mérite d'être crié. */
export const JOURS_EFFACEMENT_PROCHE = 7;

export type Gravite = 'critique' | 'attention' | 'info';

export const CLES_ALERTE = [
  'effacement_imminent',
  'impaye',
  'periode_echue',
  'fin_de_periode',
  'quota_presque_epuise',
  'quota_epuise',
] as const;
export type CleAlerte = (typeof CLES_ALERTE)[number];

/**
 * De quoi RECOMPOSER la phrase ailleurs.
 *
 * Le serveur ne connaît pas la langue de qui regarde : la ruche est bilingue,
 * et une alerte rendue en français sur une interface anglaise serait la seule
 * chose de tout l'écran à ne pas se traduire. La clé et ces quelques valeurs
 * suffisent à l'écrire dans n'importe quelle langue ; `message` reste comme
 * REPLI — un client plus ancien que le serveur rencontrera un jour une clé
 * qu'il ne sait pas rendre, et il vaut mieux qu'il affiche une phrase en
 * français qu'une ligne vide.
 */
export interface DetailsAlerte {
  /** Identifiant de la machine concernée (`effacement_imminent`). */
  serveur?: string;
  /** Motif rendu par `droits()` (`periode_echue`). */
  motif?: string;
  /** Heures de quota restantes (`quota_presque_epuise`). */
  heuresRestantes?: number;
  /** L'impayé est-il encore dans le délai de grâce ? (`impaye`) */
  enGrace?: boolean;
}

export interface Alerte {
  /** Identifie la NATURE, pas l'occurrence — deux projets peuvent la partager. */
  cle: CleAlerte;
  gravite: Gravite;
  projectId: string;
  projet: string;
  /** Phrase française de repli, pour un client qui ne connaît pas la clé. */
  message: string;
  /** Jours avant l'échéance. `-1` quand l'échéance est déjà passée ou sans date. */
  jours: number;
  details: DetailsAlerte;
}

/** Ce qu'on sait d'un serveur, vu du tableau de bord. */
export interface ServeurVu {
  id: string;
  etat: string;
  /** `-1` si la machine n'est pas sur le chemin de l'effacement. */
  joursAvantSuppression: number;
}

/** Un projet et tout ce qui s'y rattache, tel que la route le rassemble. */
export interface ProjetVu {
  projectId: string;
  nom: string;
  /** `owner` / `member` — le rôle DANS le projet, pas dans la ruche. */
  role: string;
  plan: string;
  etatAbonnement: string;
  /** Fin de la période payée, ou `null` pour un plan sans échéance. */
  finPeriode: number | null;
  actif: boolean;
  /** Motif rendu par `droits()` — déjà écrit pour être lu. */
  motifDroits: string;
  heures: number;
  /** Plafond de dépense en ms, ou `null` si aucun. */
  plafondMs: number | null;
  depenseMs: number;
  serveurs: ServeurVu[];
  /** Niveau d'autonomie du projet (`off` … `plein`). */
  autonomie: string;
}

export interface Tableau {
  version: number;
  projets: ProjetRendu[];
  alertes: Alerte[];
  /**
   * La gravité la plus haute des alertes, ou `null` s'il n'y en a aucune.
   *
   * Sert la pastille de navigation, qui doit annoncer l'URGENCE sans ouvrir
   * l'écran. Ce n'est PAS `alertes[0].gravite` : le tri classe par nature
   * d'abord (voir `graviteLaPlusHaute`). Champ AJOUTÉ, jamais requis d'un
   * client ancien — le contrat porte déjà `version` pour ça.
   */
  graviteMax: Gravite | null;
  /** Totaux de la personne, tous projets confondus. */
  totaux: {
    projets: number;
    serveursActifs: number;
    heuresIncluses: number;
    depenseMs: number;
  };
}

/** Un projet, enrichi des lectures dérivées que l'écran affiche. */
export interface ProjetRendu extends ProjetVu {
  /**
   * Part du plafond consommée, entre 0 et 1. `null` SANS PLAFOND — et pas `0` :
   * « rien consommé » et « rien à consommer » sont deux affirmations
   * différentes, et une jauge à zéro raconterait la première alors que c'est la
   * seconde qui est vraie.
   */
  partConsommee: number | null;
  /** Jours avant la fin de période. `-1` sans échéance, `0` si déjà passée. */
  joursRestants: number;
  /** Machines qui coûtent de l'argent en ce moment. */
  serveursFacturables: number;
}

/** États d'un serveur qui coûtent de l'argent. Même liste que `serveurs.ts`. */
const FACTURABLES = ['provisionnement', 'pret'];

function joursRestantsDe(finPeriode: number | null, now: number): number {
  if (finPeriode === null) return -1;
  return Math.max(0, Math.ceil((finPeriode - now) / JOUR_MS));
}

function partDe(depenseMs: number, plafondMs: number | null): number | null {
  if (plafondMs === null) return null;
  // Plafond à zéro : tout est consommé par construction. Diviser donnerait
  // l'infini, et « 0 % » serait exactement l'inverse de la vérité.
  if (plafondMs <= 0) return 1;
  return Math.min(1, depenseMs / plafondMs);
}

export function rendreProjet(p: ProjetVu, now: number): ProjetRendu {
  return {
    ...p,
    partConsommee: partDe(p.depenseMs, p.plafondMs),
    joursRestants: joursRestantsDe(p.finPeriode, now),
    serveursFacturables: p.serveurs.filter((s) => FACTURABLES.includes(s.etat)).length,
  };
}

/**
 * Les alertes d'UN projet, sans tri — le classement est global (`trier`).
 *
 * Un projet peut en porter plusieurs : un abonnement impayé dont le quota est
 * aussi épuisé mérite les deux phrases, parce que payer ne réglera pas le
 * second problème et que le taire ferait croire le contraire.
 */
export function alertesDe(p: ProjetRendu): Alerte[] {
  const out: Alerte[] = [];
  const base = { projectId: p.projectId, projet: p.nom };

  // 1. IRRÉVERSIBLE. Une machine arrêtée dont la rétention s'achève.
  for (const s of p.serveurs) {
    if (s.joursAvantSuppression < 0 || s.joursAvantSuppression > JOURS_EFFACEMENT_PROCHE) continue;
    out.push({
      ...base,
      cle: 'effacement_imminent',
      gravite: 'critique',
      jours: s.joursAvantSuppression,
      message:
        s.joursAvantSuppression === 0
          ? `La machine ${s.id} va être effacée aujourd’hui, avec tout ce qu’elle contient. Réactivez l’abonnement pour la garder.`
          : `La machine ${s.id} sera effacée dans ${s.joursAvantSuppression} jour(s), avec tout ce qu’elle contient. Réactivez l’abonnement pour la garder.`,
      details: { serveur: s.id },
    });
  }

  // 2. LE SERVICE S'ARRÊTE.
  if (p.etatAbonnement === 'impaye') {
    out.push({
      ...base,
      cle: 'impaye',
      gravite: p.actif ? 'attention' : 'critique',
      jours: -1,
      message: p.actif
        ? `Le dernier paiement n’est pas passé. Le projet continue pendant le délai de grâce, puis s’arrêtera.`
        : `Le délai de grâce est écoulé : le projet est arrêté faute de paiement.`,
      details: { enGrace: p.actif },
    });
  } else if (!p.actif && p.etatAbonnement !== 'aucun') {
    out.push({
      ...base,
      cle: 'periode_echue',
      gravite: 'critique',
      jours: -1,
      message: `Le projet ne butine plus : ${p.motifDroits}.`,
      details: { motif: p.motifDroits },
    });
  } else if (p.actif && p.joursRestants >= 0 && p.joursRestants <= JOURS_FIN_PROCHE) {
    out.push({
      ...base,
      cle: 'fin_de_periode',
      gravite: 'attention',
      jours: p.joursRestants,
      message:
        p.joursRestants === 0
          ? `La période payée se termine aujourd’hui.`
          : `La période payée se termine dans ${p.joursRestants} jour(s).`,
      details: {},
    });
  }

  // 3. LE QUOTA SE VIDE. Silencieux sans plafond : il n'y a rien à vider.
  if (p.partConsommee !== null) {
    if (p.partConsommee >= 1) {
      out.push({
        ...base,
        cle: 'quota_epuise',
        gravite: 'critique',
        jours: -1,
        message: `Le quota de ce projet est entièrement consommé — la ruche n’assigne plus de tâches.`,
        details: {},
      });
    } else if (p.partConsommee >= PART_QUOTA_ALERTE) {
      const reste = Math.max(0, (p.plafondMs ?? 0) - p.depenseMs);
      out.push({
        ...base,
        cle: 'quota_presque_epuise',
        gravite: 'attention',
        jours: -1,
        message: `Il reste environ ${(reste / HEURE_MS).toFixed(1)} h de quota sur ce projet.`,
        details: { heuresRestantes: reste / HEURE_MS },
      });
    }
  }

  return out;
}

/** Rang d'une gravité. Plus petit = plus haut dans la liste. */
const RANG: Record<Gravite, number> = { critique: 0, attention: 1, info: 2 };

/**
 * Rang de nature. L'irréversible passe AVANT le réversible, même quand son
 * échéance est plus lointaine — c'est tout l'objet de ce classement.
 */
const RANG_CLE: Record<CleAlerte, number> = {
  effacement_imminent: 0,
  impaye: 1,
  periode_echue: 1,
  fin_de_periode: 2,
  quota_epuise: 3,
  quota_presque_epuise: 4,
};

/**
 * Classe les alertes. Tri TOTAL et déterministe : à égalité partout, le nom du
 * projet puis le message tranchent, pour que deux relevés successifs sans
 * changement rendent exactement la même liste — sinon l'écran se réordonne tout
 * seul sous les yeux de la personne à chaque rafraîchissement.
 */
export function trier(alertes: readonly Alerte[]): Alerte[] {
  const sansEcheance = Number.MAX_SAFE_INTEGER;
  return [...alertes].sort((a, b) => {
    const parNature = RANG_CLE[a.cle] - RANG_CLE[b.cle];
    if (parNature !== 0) return parNature;
    const parGravite = RANG[a.gravite] - RANG[b.gravite];
    if (parGravite !== 0) return parGravite;
    const ja = a.jours < 0 ? sansEcheance : a.jours;
    const jb = b.jours < 0 ? sansEcheance : b.jours;
    if (ja !== jb) return ja - jb;
    return a.projet.localeCompare(b.projet) || a.message.localeCompare(b.message);
  });
}

/**
 * La gravité la plus haute d'une liste — et POURQUOI elle est calculée ici.
 *
 * ─── CE N'EST PAS `alertes[0].gravite` ───────────────────────────────────────
 *
 * `trier()` classe par NATURE d'abord (`RANG_CLE`), la gravité ne départageant
 * qu'à nature égale : l'irréversible passe avant le réversible, même moins
 * grave. Une `fin_de_periode` en « attention » peut donc précéder un
 * `quota_epuise` « critique », et prendre la tête de liste annoncerait la
 * mauvaise couleur.
 *
 * ─── ET POURQUOI PAS DANS L'ÉCRAN ────────────────────────────────────────────
 *
 * La calculer côté client demanderait d'y recopier `RANG` — une SECONDE
 * décision de classement, qui divergera de celle-ci le jour où l'une des deux
 * bougera. C'est exactement ce que l'écran s'interdit (« l'écran ne reclasse
 * RIEN », `dashboard/src/views/MonEspace.tsx`). Le rang est une décision : elle
 * se prend une fois, au serveur, là où elle est éprouvée.
 */
export function graviteLaPlusHaute(alertes: readonly Alerte[]): Gravite | null {
  let pire: Gravite | null = null;
  // loupe : équivalent — < → <=
  // `<` et `<=` sont ICI un mutant ÉQUIVALENT, et c'est CONSIGNÉ, pas un test qui
  // manque : `RANG` est injectif (0, 1, 2 sur trois gravités distinctes), donc
  // RANG[a] == RANG[pire] ⟹ a == pire, et la réaffectation ne change rien.
  // Mesuré plutôt que raisonné — les 364 suites de gravités de longueur ≤ 5
  // rendent le même verdict avec l'une ou l'autre comparaison. La loupe le
  // re-signalera « sans test » à chaque passe : elle ne sait pas lire ceci.
  for (const a of alertes) if (pire === null || RANG[a.gravite] < RANG[pire]) pire = a.gravite;
  return pire;
}

/** Assemble le tableau complet d'une personne. */
export function composerTableau(projets: readonly ProjetVu[], now: number): Tableau {
  const rendus = projets.map((p) => rendreProjet(p, now));
  const alertes = trier(rendus.flatMap((p) => alertesDe(p)));

  return {
    version: VERSION_TABLEAU,
    projets: rendus,
    alertes,
    graviteMax: graviteLaPlusHaute(alertes),
    totaux: {
      projets: rendus.length,
      serveursActifs: rendus.reduce((n, p) => n + p.serveursFacturables, 0),
      // Seuls les projets aux droits ACTIFS comptent leurs heures : additionner
      // celles d'un abonnement expiré annoncerait un crédit qui n'existe pas.
      heuresIncluses: rendus.reduce((n, p) => n + (p.actif ? p.heures : 0), 0),
      depenseMs: rendus.reduce((n, p) => n + p.depenseMs, 0),
    },
  };
}
