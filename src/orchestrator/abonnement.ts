// Les abonnements — vendre des heures-ouvrières sans jamais toucher à l'argent.
//
// ─── CE QUE CE MODULE NE VOIT JAMAIS ─────────────────────────────────────────
//
// Aucun numéro de carte, aucun IBAN, aucune adresse de facturation, aucun nom
// de porteur. Rien de tout cela n'entre dans Hive, ni en base, ni en mémoire,
// ni dans un log. Le processeur de paiement (Stripe et ses semblables) détient
// ces données ; Hive n'en détient qu'un IDENTIFIANT opaque et un ÉTAT.
//
// Ce n'est pas de la prudence excessive, c'est la seule architecture tenable :
// détenir une donnée de carte, c'est entrer dans le périmètre PCI-DSS, et
// aucune ruche auto-hébergée par un particulier ne peut le tenir. Le jour où
// une seule colonne de ce module contient un numéro, tout le reste devient
// indéfendable.
//
// ─── LA VÉRIFICATION DE SIGNATURE N'EST PAS UNE FORMALITÉ ────────────────────
//
// Une route de webhook non vérifiée est une route par laquelle N'IMPORTE QUI
// s'offre un abonnement. C'est la vulnérabilité la plus banale de toute
// intégration de paiement, et elle est totale : pas d'escalade nécessaire, pas
// de conditions particulières — un POST bien formé suffit.
//
// D'où, ici : HMAC-SHA256 sur `timestamp.charge`, comparaison en TEMPS
// CONSTANT (une comparaison naïve fuit la signature octet par octet), et une
// FENÊTRE TEMPORELLE au-delà de laquelle une requête valide mais ancienne est
// refusée — sans quoi un appel capté une fois serait rejouable indéfiniment.
//
// Le secret de signature vit dans l'environnement, JAMAIS en base : même
// doctrine que le jeton GitHub (`github.ts`), et pour la même raison — une
// base se copie, se sauvegarde, se joint à un rapport de bogue.
//
// ─── CE QU'UN ABONNEMENT PRODUIT, CONCRÈTEMENT ───────────────────────────────
//
// Un plafond d'heures-ouvrières sur un projet, c'est-à-dire une ligne dans
// `budgets` — la table que La Balance lit déjà et que le Scheduler applique
// déjà. Vendre ne rajoute donc AUCUN mécanisme d'exécution : l'abonnement
// alimente une porte qui existait avant lui, et qui a ses propres tests.
//
// ⚠ LIMITE CONNUE, à lire avant d'encaisser le premier euro. Le plafond est
// consommé par `durationMs`, une donnée d'AGENT (voir l'avertissement en tête
// de `jugerPlafond`). Tant que les nœuds appartiennent au client, c'est sans
// conséquence : il ne se vole que lui-même. Le jour où des nœuds HÉBERGÉS
// existeront, ce compteur devra venir de l'horloge de l'hébergeur — c'est écrit
// dans docs/MODELE-ECONOMIQUE.md §3.1 et verrouillé par un test.
//
// MODULE PUR. Aucune I/O, aucun réseau. `now` est un paramètre : une fenêtre
// temporelle qui lirait l'horloge en cachette serait intestable.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Version du modèle d'abonnement. Motif VERSION_BALANCE. */
export const VERSION_ABONNEMENT = 1;

/** Une heure-ouvrière, en millisecondes — l'unité que La Balance compte. */
export const HEURE_MS = 3_600_000;

// ─── Les offres ──────────────────────────────────────────────────────────────

/**
 * Les plans, alignés sur docs/MODELE-ECONOMIQUE.md §5.
 *
 * `heures` est ce que le client achète ; `prixCentimes` sert UNIQUEMENT à
 * l'affichage et au rapprochement avec le processeur — Hive ne calcule aucun
 * montant et n'en encaisse aucun.
 */
export interface Plan {
  cle: string;
  nom: string;
  /** Heures-ouvrières incluses par période. */
  heures: number;
  prixCentimes: number;
  /** `null` pour un achat unique (un Rush), sinon la périodicité. */
  periode: 'mois' | null;
}

export const PLANS: readonly Plan[] = [
  { cle: 'libre', nom: 'Ruche libre', heures: 0, prixCentimes: 0, periode: null },
  { cle: 'eclaireuse', nom: 'Rush Éclaireuse', heures: 10, prixCentimes: 7_900, periode: null },
  { cle: 'essaim', nom: 'Rush Essaim', heures: 50, prixCentimes: 29_900, periode: null },
  { cle: 'colonie', nom: 'Rush Colonie', heures: 200, prixCentimes: 99_000, periode: 'mois' },
  { cle: 'queen', nom: 'Queen hébergée', heures: 0, prixCentimes: 4_900, periode: 'mois' },
] as const;

export function planParCle(cle: string): Plan | null {
  return PLANS.find((p) => p.cle === cle) ?? null;
}

// ─── L'état d'un abonnement ──────────────────────────────────────────────────

/**
 * Les états, et un seul d'entre eux donne des droits.
 *
 * `impaye` mérite son existence propre : couper net un client dont la carte a
 * expiré est à la fois un mauvais produit et un mauvais geste. Il garde ses
 * droits pendant le délai de grâce, puis passe `expire`.
 */
export const ETATS = ['aucun', 'actif', 'impaye', 'annule', 'expire'] as const;
export type EtatAbonnement = (typeof ETATS)[number];

/**
 * Délai de grâce après un échec de paiement.
 *
 * Sept jours : le temps qu'un humain voie le courriel de sa banque, trouve sa
 * nouvelle carte, et la saisisse. En dessous, on coupe des gens qui allaient
 * payer ; au-dessus, on offre un mois à qui ne paiera jamais.
 */
export const GRACE_JOURS = 7;
const JOUR_MS = 86_400_000;

export interface Abonnement {
  projectId: string;
  /** Clé de plan. Voir PLANS. */
  plan: string;
  etat: EtatAbonnement;
  /**
   * Identifiant OPAQUE chez le processeur. C'est la seule chose qui relie une
   * ruche à un paiement, et elle ne dit rien de la personne.
   */
  refExterne: string;
  /** Fin de la période payée, en ms. `null` pour un achat unique consommable. */
  finPeriode: number | null;
  /** Début du délai de grâce, posé au premier échec de paiement. */
  impayeDepuis: number | null;
  majA: number;
}

/**
 * Un abonnement absent — l'état par défaut de tout projet.
 *
 * `majA` vaut ZÉRO, et c'est important : un abonnement qui n'existe pas n'a
 * jamais été mis à jour. Le dater à « maintenant » le ferait paraître plus
 * récent que le premier webhook reçu, qui serait alors écarté comme arrivé
 * dans le désordre — et un projet neuf ne pourrait JAMAIS être activé.
 */
export function aucunAbonnement(projectId: string): Abonnement {
  return {
    projectId,
    plan: 'libre',
    etat: 'aucun',
    refExterne: '',
    finPeriode: null,
    impayeDepuis: null,
    majA: 0,
  };
}

/**
 * Les droits en vigueur, à cet instant.
 *
 * FERMÉ PAR DÉFAUT : tout ce qui n'est pas explicitement actif ne donne rien.
 * Et un abonnement dont la période est passée ne donne rien non plus, même si
 * sa ligne dit encore `actif` — un webhook peut se perdre, l'horloge fait foi.
 */
export function droits(
  a: Abonnement,
  now: number,
): { actif: boolean; heures: number; plafondMs: number | null; motif: string } {
  const rien = (motif: string): ReturnType<typeof droits> => ({
    actif: false,
    heures: 0,
    plafondMs: null,
    motif,
  });

  if (a.etat === 'aucun') return rien('aucun abonnement');
  if (a.etat === 'annule') return rien('abonnement annulé');
  if (a.etat === 'expire') return rien('abonnement expiré');

  if (a.etat === 'impaye') {
    if (a.impayeDepuis === null) return rien('impayé sans date — état incohérent');
    const fin = a.impayeDepuis + GRACE_JOURS * JOUR_MS;
    if (now >= fin) return rien(`délai de grâce de ${GRACE_JOURS} jours dépassé`);
  }

  // La période fait foi, même sur un état `actif` : un webhook de
  // renouvellement peut se perdre, et l'horloge, elle, ne ment pas.
  if (a.finPeriode !== null && now >= a.finPeriode) return rien('période échue');

  const plan = planParCle(a.plan);
  if (!plan) return rien(`plan inconnu : ${a.plan}`);
  if (plan.heures <= 0) return rien(`le plan « ${plan.nom} » n’inclut pas d’heures-ouvrières`);

  return {
    actif: true,
    heures: plan.heures,
    plafondMs: plan.heures * HEURE_MS,
    motif: a.etat === 'impaye' ? 'droits maintenus pendant le délai de grâce' : plan.nom,
  };
}

// ─── Ce que le processeur nous dit ───────────────────────────────────────────

/**
 * Les événements retenus, et RIEN d'autre.
 *
 * Une liste blanche, jamais un `switch` avec `default`. Un processeur émet des
 * dizaines de types ; en accepter un qu'on n'a pas lu, c'est laisser un
 * inconnu décider d'un état.
 */
export const EVENEMENTS = [
  'abonnement.actif',
  'abonnement.paiement_echoue',
  'abonnement.paiement_reussi',
  'abonnement.annule',
] as const;
export type TypeEvenement = (typeof EVENEMENTS)[number];

export interface EvenementAbonnement {
  type: TypeEvenement;
  projectId: string;
  plan: string;
  refExterne: string;
  /** Fin de période annoncée par le processeur, si l'événement en porte une. */
  finPeriode: number | null;
  ts: number;
}

/**
 * Applique un événement. PURE : rend un nouvel abonnement, ne mute rien.
 *
 * `null` si l'événement ne doit rien changer — le plan est inconnu, ou
 * l'événement est plus ancien que l'état courant. Ce dernier cas compte : les
 * webhooks arrivent DANS LE DÉSORDRE, et un « paiement_echoue » retardataire
 * ne doit pas défaire un « actif » plus récent.
 */
export function appliquerEvenement(courant: Abonnement, e: EvenementAbonnement): Abonnement | null {
  if (!planParCle(e.plan)) return null;
  if (e.ts < courant.majA) return null; // arrivé dans le désordre : ignoré

  const base = { ...courant, plan: e.plan, refExterne: e.refExterne, majA: e.ts };
  switch (e.type) {
    case 'abonnement.actif':
    case 'abonnement.paiement_reussi':
      return { ...base, etat: 'actif', finPeriode: e.finPeriode, impayeDepuis: null };
    case 'abonnement.paiement_echoue':
      // On NE coupe PAS : le délai de grâce commence. Couper net un client
      // dont la carte a expiré est un mauvais produit et un mauvais geste.
      return {
        ...base,
        etat: 'impaye',
        finPeriode: courant.finPeriode,
        impayeDepuis: courant.impayeDepuis ?? e.ts,
      };
    case 'abonnement.annule':
      return { ...base, etat: 'annule', finPeriode: courant.finPeriode, impayeDepuis: null };
  }
}

// ─── La signature ────────────────────────────────────────────────────────────

/**
 * Fenêtre d'acceptation d'un webhook.
 *
 * Cinq minutes. Sans elle, une requête valide captée une fois serait rejouable
 * indéfiniment — et rejouer « abonnement.actif » est exactement l'attaque qu'on
 * cherche à empêcher.
 */
export const TOLERANCE_MS = 5 * 60_000;

export interface VerdictSignature {
  valide: boolean;
  /** Pourquoi, en clair. Jamais la signature attendue — ce serait l'offrir. */
  motif: string;
}

/**
 * Vérifie la signature d'un webhook.
 *
 * En-tête attendu : `t=<secondes>,v1=<hex>`, avec la signature calculée sur
 * `${t}.${charge}`. C'est la forme de Stripe, adoptée telle quelle : ce n'est
 * pas de l'imitation, c'est le format que les intégrateurs connaissent, et
 * s'en écarter n'apporterait aucune sécurité supplémentaire.
 *
 * TROIS PROPRIÉTÉS, chacune indispensable :
 *
 *   · le HMAC porte sur l'HORODATAGE ET la charge — signer la charge seule
 *     rendrait l'appel rejouable pour toujours ;
 *   · la comparaison est en TEMPS CONSTANT — une comparaison naïve s'arrête au
 *     premier octet différent, ce qui laisse deviner la signature octet par
 *     octet ;
 *   · un secret absent REFUSE tout, sans exception. « Pas de secret configuré
 *     donc on laisse passer » est la porte dérobée la plus fréquente de toutes.
 */
export function verifierSignature(opts: {
  charge: string;
  entete: string;
  secret: string;
  now: number;
  toleranceMs?: number;
}): VerdictSignature {
  if (!opts.secret) {
    return { valide: false, motif: 'aucun secret de webhook configuré — tout est refusé' };
  }
  const champs = new Map<string, string>();
  for (const part of opts.entete.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) champs.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  const t = Number(champs.get('t'));
  const fournie = champs.get('v1') ?? '';
  if (!Number.isFinite(t) || fournie === '') {
    return { valide: false, motif: 'en-tête de signature malformé' };
  }

  const tolerance = opts.toleranceMs ?? TOLERANCE_MS;
  const ecart = Math.abs(opts.now - t * 1000);
  if (ecart > tolerance) {
    return {
      valide: false,
      motif: `horodatage hors fenêtre (${Math.round(ecart / 1000)} s, tolérance ${Math.round(tolerance / 1000)} s)`,
    };
  }

  const attendue = createHmac('sha256', opts.secret)
    .update(`${t}.${opts.charge}`, 'utf8')
    .digest('hex');

  // `timingSafeEqual` exige des longueurs égales et lève sinon : on compare
  // d'abord les longueurs, ce qui ne fuit rien (la longueur d'un HMAC-SHA256
  // est publique et constante).
  const a = Buffer.from(attendue, 'utf8');
  const b = Buffer.from(fournie, 'utf8');
  if (a.length !== b.length) return { valide: false, motif: 'signature invalide' };
  return timingSafeEqual(a, b)
    ? { valide: true, motif: 'signature vérifiée' }
    : { valide: false, motif: 'signature invalide' };
}

/**
 * Fabrique une signature. Sert aux TESTS et à un éventuel émetteur maison.
 *
 * Exportée délibérément : une vérification qu'on ne peut pas exercer avec une
 * signature authentique n'est pas testable, et une garde non testée finit par
 * ne plus garder.
 */
export function signer(charge: string, secret: string, now: number): string {
  const t = Math.floor(now / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${charge}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * Lit une charge de webhook déjà VÉRIFIÉE. `null` si elle n'est pas
 * exploitable.
 *
 * La vérification de signature dit que l'expéditeur détient le secret ; elle ne
 * dit RIEN de la forme de ce qu'il envoie. Les deux contrôles sont distincts et
 * les confondre est une erreur classique.
 */
export function lireCharge(brut: unknown): EvenementAbonnement | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;

  const type = o.type;
  if (typeof type !== 'string' || !EVENEMENTS.includes(type as TypeEvenement)) return null;

  const projectId = typeof o.projectId === 'string' ? o.projectId.slice(0, 200) : '';
  const plan = typeof o.plan === 'string' ? o.plan.slice(0, 60) : '';
  const refExterne = typeof o.refExterne === 'string' ? o.refExterne.slice(0, 200) : '';
  if (!projectId || !plan) return null;

  const finBrute = o.finPeriode;
  const finPeriode =
    typeof finBrute === 'number' && Number.isFinite(finBrute) && finBrute > 0
      ? Math.trunc(finBrute)
      : null;
  const tsBrut = o.ts;
  const ts = typeof tsBrut === 'number' && Number.isFinite(tsBrut) ? Math.trunc(tsBrut) : 0;
  if (ts <= 0) return null;

  return { type: type as TypeEvenement, projectId, plan, refExterne, finPeriode, ts };
}
