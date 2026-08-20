// Les paliers — ce que chaque plan ouvre AU-DELÀ du cœur, jamais à sa place.
//
// La règle qui gouverne ce fichier est écrite
// dans docs/MODELE-ECONOMIQUE.md : le cœur de Hive n'est JAMAIS bridé pour
// vendre un palier. Aucune capacité listée ici n'existe en Community sous une
// forme dégradée — elles n'existent pas du tout dans le noyau, parce que ce
// sont des besoins d'ORGANISATION (rôles fins, SSO, audit exportable), pas
// des besoins de ruche. Le jour où une entrée de ce fichier retire quelque
// chose que Community avait, ce module a changé de nature et il faut le dire.
//
// MODULE PUR. Aucune I/O, aucun réseau, aucune lecture d'environnement : une
// porte qu'on ne peut pas exercer en test finit par ne plus garder.
//
// FERMÉ PAR DÉFAUT : un plan inconnu n'ouvre RIEN. C'est le même principe que
// `droits()` dans abonnement.ts — tout ce qui n'est pas explicitement accordé
// est refusé, et le motif dit pourquoi en clair.
//
// TODO(sso) : la porte `sso` existe, l'implémentation SAML/OIDC n'existe PAS
// encore. Elle viendra derrière cette porte, jamais à côté — sinon la porte
// ment. Même chose pour `audit_export` et `retention_personnalisee` : le
// journal existe (store), l'export contractuel reste à brancher.

/**
 * Les capacités d'équipe, et RIEN d'autre.
 *
 * Une liste blanche fermée, comme EVENEMENTS dans abonnement.ts : accepter une
 * capacité qu'on n'a pas déclarée, c'est laisser une faute de frappe ouvrir
 * une porte.
 */
export const CAPACITES_EQUIPE = [
  /** Rôles au-delà d'admin/membre : lecteur, approbateur, gestion par projet. */
  'roles_fins',
  /** Plafonds d'heures par MEMBRE, en plus du plafond par projet. */
  'quotas_par_membre',
  /** Projets rattachés à une organisation, pas à un compte individuel. */
  'projets_organisation',
  /** SSO / SAML — la porte existe, l'implémentation est à venir (TODO en tête). */
  'sso',
  /** Export du journal d'audit dans un format contractuel. */
  'audit_export',
  /** Durée de rétention des données négociée au contrat. */
  'retention_personnalisee',
  /** Support prioritaire et SLA. */
  'support_prioritaire',
] as const;
export type CapaciteEquipe = (typeof CAPACITES_EQUIPE)[number];

/**
 * Sièges inclus dans les plans Cloud individuels (queen, rushes).
 *
 * Ce nombre ne s'applique JAMAIS à Community : une ruche auto-hébergée invite
 * qui elle veut, c'est le cœur et il ne se bride pas. Il ne borne que ce que
 * l'OPÉRATEUR héberge — au-delà, c'est Team, dont c'est précisément l'objet.
 */
export const SIEGES_INCLUS_CLOUD = 5;

export interface Palier {
  /** Capacités d'équipe ouvertes par le plan. Vide pour tout ce qui n'est pas Team/Enterprise. */
  capacites: readonly CapaciteEquipe[];
  /** Sièges membres inclus. `null` = illimité. */
  siegesMax: number | null;
}

const AUCUNE: Palier = { capacites: [], siegesMax: SIEGES_INCLUS_CLOUD };

const TEAM: Palier = {
  capacites: ['roles_fins', 'quotas_par_membre', 'projets_organisation'],
  siegesMax: null,
};

const ENTERPRISE: Palier = {
  // Tout Team, plus ce qui n'a de sens qu'au contrat : SSO, audit, rétention, SLA.
  capacites: [
    ...TEAM.capacites,
    'sso',
    'audit_export',
    'retention_personnalisee',
    'support_prioritaire',
  ],
  siegesMax: null,
};

/**
 * Le palier d'un plan, par sa clé (voir PLANS dans abonnement.ts).
 *
 * `libre` rend des sièges ILLIMITÉS : ce n'est pas un cadeau, c'est la
 * définition de Community — l'opérateur n'héberge rien, donc rien à compter.
 * Les plans Cloud individuels rendent SIEGES_INCLUS_CLOUD ; Team et
 * Enterprise, l'illimité et leurs capacités. Tout plan inconnu ne rend RIEN.
 */
export function palierDuPlan(planCle: string): Palier {
  switch (planCle) {
    case 'libre':
      return { capacites: [], siegesMax: null };
    case 'team':
      return TEAM;
    case 'enterprise':
      return ENTERPRISE;
    case 'queen':
    case 'eclaireuse':
    case 'essaim':
    case 'colonie':
      return AUCUNE;
    default:
      // Fermé par défaut : même les sièges Cloud ne sont pas offerts à un
      // plan que personne n'a déclaré.
      return { capacites: [], siegesMax: 0 };
  }
}

/**
 * La porte que le serveur appelle avant d'ouvrir une fonction d'équipe.
 *
 * Rend un verdict motivé plutôt qu'un booléen nu : un refus sans motif fait
 * chercher la panne au mauvais endroit, exactement comme pour la signature de
 * webhook.
 */
export function capaciteOuverte(
  planCle: string,
  capacite: CapaciteEquipe,
): { ouverte: boolean; motif: string } {
  const palier = palierDuPlan(planCle);
  if (palier.capacites.includes(capacite)) {
    return { ouverte: true, motif: `« ${capacite} » incluse dans le plan « ${planCle} »` };
  }
  return {
    ouverte: false,
    motif: `« ${capacite} » exige le palier Team ou Enterprise — plan actuel : « ${planCle} »`,
  };
}
