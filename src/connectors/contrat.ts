// Le contrat d'un connecteur externe — ce qu'une intégration DÉCLARE avant de
// toucher au monde extérieur, et les portées qu'un projet peut lui accorder.
//
// ─── POURQUOI UN CONTRAT, ET PAS UN APPEL `fetch` DE-CI DE-LÀ ────────────────
//
// Le seul « connecteur » qui existait était l'importeur de dépôt GitHub
// (`orchestrator/github.ts`), un cas unique, sans portée déclarée, sans journal,
// sans autorisation par projet. Chaque intégration suivante — Slack, un webhook,
// demain autre chose — aurait recopié sa propre poignée de `fetch`, son propre
// secret, sa propre idée de « ce que j'ai le droit de faire ». Trois copies, et
// la quatrième oublie le caviardage.
//
// Ce module PUR fixe le vocabulaire une fois : une intégration déclare son
// identité, son MODE (lit-elle seulement, ou agit-elle ?), les PORTÉES qu'elle
// peut offrir, et les secrets dont elle a besoin. L'humain accorde ensuite un
// sous-ensemble de ces portées, projet par projet. Rien ici ne fait d'I/O :
// le registre référence, le store persiste, le serveur pose la garde.
//
// ─── DEUX AXES ORTHOGONAUX : LE MODE ET LES PORTÉES ─────────────────────────
//
//   • le MODE est une propriété du CONNECTEUR, immuable : un connecteur
//     `lecture_seule` ne peut structurellement rien changer dans la ruche —
//     il ne recevra jamais d'interaction qui approuve ou agit, quoi qu'un
//     projet lui accorde. Un connecteur `action` le peut, SI on le lui accorde.
//   • les PORTÉES sont ce qu'un PROJET accorde, dans les limites du mode. Elles
//     répondent à « ce connecteur, sur CE projet, a le droit de… ».
//
// Confondre les deux — « il peut agir donc il agit partout » — est exactement
// le trou qu'un connecteur d'approbation ne doit pas ouvrir.

/**
 * L'ensemble FERMÉ des portées. Fermé au sens propre : une portée qui n'est pas
 * dans cette liste n'existe pas, et une valeur inconnue est refusée plutôt que
 * tolérée. Ajouter une capacité, c'est ajouter un mot ici — un geste visible,
 * relu, pas une chaîne libre qui se glisse dans un corps de requête.
 *
 *   · `lecture`      — observer sans jamais écrire (état, avancement).
 *   · `notification` — pousser vers l'extérieur : décisions, blocages, résumés.
 *   · `approbation`  — pousser une demande d'approbation ET recevoir la réponse
 *                      humaine, qui rejoint la revue existante (jamais une
 *                      nouvelle autorité : la revue reste la revue).
 *   · `action`       — déclencher un acte réservé au connecteur (aucun connecteur
 *                      livré ne l'offre ; le mot existe pour le jour où l'un le
 *                      demandera, sciemment).
 */
export const PORTEES = ['lecture', 'notification', 'approbation', 'action'] as const;

export type Portee = (typeof PORTEES)[number];

const PORTEES_SET = new Set<string>(PORTEES);

/**
 * Le mode d'un connecteur. `lecture_seule` interdit STRUCTURELLEMENT les portées
 * qui changent la ruche (`approbation`, `action`) : un tel connecteur ne se voit
 * jamais offrir ces portées, et sa boucle entrante — s'il en a une — ne peut
 * pas appliquer de décision. `action` les autorise, sous réserve d'accord.
 */
export type ModeConnecteur = 'lecture_seule' | 'action';

/** Les portées qu'un connecteur `lecture_seule` ne peut JAMAIS porter. */
const PORTEES_ACTION: ReadonlySet<Portee> = new Set<Portee>(['approbation', 'action']);

/** Une variable d'environnement Queen que ce connecteur exige (jeton, secret). */
export interface SpecSecret {
  /** Le nom d'env, posé dans le `.env` Queen — jamais en base, jamais au nœud. */
  readonly envVar: string;
  readonly libelleFr: string;
  readonly libelleEn: string;
  readonly hintFr: string;
  readonly hintEn: string;
  /** Faux : facultatif (une capacité entrante qu'on n'active pas forcément). */
  readonly requis: boolean;
}

/**
 * La définition d'un connecteur : ce qu'il déclare, immuable, avant toute I/O.
 * Le registre en tient la liste ; ni le store ni la base n'en gardent copie —
 * c'est du code, pas de la donnée d'exécution.
 */
export interface DefinitionConnecteur {
  readonly id: string;
  readonly libelleFr: string;
  readonly libelleEn: string;
  readonly hintFr: string;
  readonly hintEn: string;
  readonly mode: ModeConnecteur;
  /** Les portées que CE connecteur sait offrir (sous-ensemble de `PORTEES`). */
  readonly porteesPossibles: readonly Portee[];
  /** Les secrets Queen à poser pour l'activer. */
  readonly secrets: readonly SpecSecret[];
}

export type MotifPorteeRefus =
  | 'portee_inconnue'
  | 'portee_non_offerte'
  | 'portee_hors_mode'
  | 'aucune_portee'
  | 'trop_de_portees';

/** Une portée à la fois, verdict en CHAÎNE (jamais un booléen) : le refus se journalise. */
export type VerdictPortee =
  | { readonly ok: true; readonly portee: Portee }
  | { readonly ok: false; readonly motif: MotifPorteeRefus };

/** Est-ce un mot de portée connu ? (garde de type, pas la garde d'accord.) */
export function estPortee(brut: string): brut is Portee {
  return PORTEES_SET.has(brut);
}

/**
 * Une portée est-elle accordable à CE connecteur ? Trois refus distincts, pour
 * que le journal dise POURQUOI et pas seulement « non » :
 *   · le mot n'existe pas (`portee_inconnue`) ;
 *   · le connecteur ne sait pas l'offrir (`portee_non_offerte`) ;
 *   · le connecteur est en lecture seule et la portée changerait la ruche
 *     (`portee_hors_mode`).
 */
export function validerPortee(def: DefinitionConnecteur, brut: string): VerdictPortee {
  if (typeof brut !== 'string' || !estPortee(brut.trim())) {
    return { ok: false, motif: 'portee_inconnue' };
  }
  const portee = brut.trim() as Portee;
  if (def.mode === 'lecture_seule' && PORTEES_ACTION.has(portee)) {
    return { ok: false, motif: 'portee_hors_mode' };
  }
  if (!def.porteesPossibles.includes(portee)) {
    return { ok: false, motif: 'portee_non_offerte' };
  }
  return { ok: true, portee };
}

/** Plafond dur du nombre de portées accordées d'un coup — quatre existent. */
export const PORTEES_MAX = PORTEES.length;

export type VerdictPortees =
  | { readonly ok: true; readonly portees: Portee[] }
  | { readonly ok: false; readonly motif: MotifPorteeRefus };

/**
 * Valide un jeu de portées demandées pour un projet : chacune accordable, au
 * moins une, sans doublon, dans la borne. Les doublons sont repliés (accorder
 * deux fois `notification` n'est pas une erreur, mais n'en fait qu'une).
 */
export function validerPorteesDemandees(
  def: DefinitionConnecteur,
  brutes: unknown,
): VerdictPortees {
  if (!Array.isArray(brutes) || brutes.length === 0) {
    return { ok: false, motif: 'aucune_portee' };
  }
  if (brutes.length > PORTEES_MAX) return { ok: false, motif: 'trop_de_portees' };
  const gardees: Portee[] = [];
  for (const brut of brutes) {
    if (typeof brut !== 'string') return { ok: false, motif: 'portee_inconnue' };
    const v = validerPortee(def, brut);
    if (!v.ok) return v;
    if (!gardees.includes(v.portee)) gardees.push(v.portee);
  }
  return { ok: true, portees: gardees };
}

/**
 * Les événements SORTANTS qu'un connecteur pousse. Fermé, comme les portées :
 * un connecteur ne poste pas « n'importe quoi », il poste un de ces faits.
 *
 *   · `resume_mission`      — l'état d'une mission, en clair.
 *   · `decision`            — une décision a été prise (revue, fusion).
 *   · `blocage`             — un travail est bloqué et attend un humain.
 *   · `demande_approbation` — une approbation est demandée (boutons côté Slack).
 */
export const EVENEMENTS_CONNECTEUR = [
  'resume_mission',
  'decision',
  'blocage',
  'demande_approbation',
] as const;

export type EvenementConnecteurKind = (typeof EVENEMENTS_CONNECTEUR)[number];

/**
 * La portée qu'un événement sortant EXIGE de CE connecteur. Une demande
 * d'approbation postée par un connecteur `action` (Slack, boutons) ouvre une
 * boucle qui peut changer la ruche : elle exige `approbation`, pas la simple
 * `notification`. Postée par un connecteur `lecture_seule` (le webhook), elle
 * n'ouvre RIEN — aucune voie de retour n'existe, la réponse passera par la
 * Miellerie — : c'est alors une notification comme les trois autres.
 *
 * Sans le mode, le webhook (qui ne peut porter que `notification`) ne pouvait
 * JAMAIS pousser une demande d'approbation, alors que sa définition l'annonce.
 *
 * Un seul point de vérité : la garde d'émission et le bouton « tester » lisent
 * cette table, jamais leur propre idée de « quelle portée pour quoi ».
 */
export function porteePourEvenement(kind: EvenementConnecteurKind, mode: ModeConnecteur): Portee {
  return kind === 'demande_approbation' && mode === 'action' ? 'approbation' : 'notification';
}

/** Le fait typé qu'un connecteur reçoit à émettre. Le texte reste bilingue en aval. */
export interface EvenementConnecteur {
  readonly kind: EvenementConnecteurKind;
  readonly projectId: string;
  /** Titre court, déjà lisible par un humain. */
  readonly titre: string;
  /** Corps facultatif (résumé, motif de blocage, diff résumé…). */
  readonly corps?: string;
  /** La tâche concernée, quand il y en a une (approbation, décision). */
  readonly taskId?: string;
  /** Le verdict d'une décision, quand l'événement en porte un. */
  readonly etat?: 'approved' | 'rejected' | null;
}

export function libellePortee(portee: Portee, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<Portee, string> = {
    lecture: 'Lecture seule',
    notification: 'Notifications',
    approbation: 'Approbations',
    action: 'Actions',
  };
  const en: Record<Portee, string> = {
    lecture: 'Read-only',
    notification: 'Notifications',
    approbation: 'Approvals',
    action: 'Actions',
  };
  return (lang === 'en' ? en : fr)[portee];
}

export function expliquerRefusPortee(motif: MotifPorteeRefus, lang: 'fr' | 'en' = 'fr'): string {
  const fr: Record<MotifPorteeRefus, string> = {
    portee_inconnue: `Portée inconnue — choisissez parmi : ${PORTEES.join(', ')}.`,
    portee_non_offerte: 'Ce connecteur ne sait pas offrir cette portée.',
    portee_hors_mode: 'Ce connecteur est en lecture seule : il ne peut ni approuver ni agir.',
    aucune_portee: 'Accordez au moins une portée.',
    trop_de_portees: `Au plus ${PORTEES_MAX} portées.`,
  };
  const en: Record<MotifPorteeRefus, string> = {
    portee_inconnue: `Unknown scope — pick one of: ${PORTEES.join(', ')}.`,
    portee_non_offerte: 'This connector cannot offer that scope.',
    portee_hors_mode: 'This connector is read-only: it can neither approve nor act.',
    aucune_portee: 'Grant at least one scope.',
    trop_de_portees: `At most ${PORTEES_MAX} scopes.`,
  };
  return (lang === 'en' ? en : fr)[motif];
}
