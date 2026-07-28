// Le partage en lecture — montrer un projet sans donner la ruche.
//
// ─── LE BESOIN, ET LE PIÈGE QU'IL TEND ───────────────────────────────────────
//
// « Envoie-moi le lien, je veux voir où ça en est. » On veut montrer un projet
// à quelqu'un qui n'a pas de compte : un client, un ami, un collègue. Le tunnel
// rend déjà la ruche joignable en HTTPS ; il ne manque qu'un lien.
//
// Le piège est qu'un lien de partage ressemble à un jeton, et qu'un jeton finit
// toujours par être réutilisé ailleurs que là où on l'a prévu. Trois façons de
// se tromper, et les trois ont été des failles réelles dans de vrais produits :
//
//   1. RÉUTILISER LE JETON DE SESSION. « Je mets mon JWT dans l'URL. » Celui
//      qui reçoit le lien EST vous : il peut supprimer des projets, changer des
//      rôles, lire tous les autres dépôts. Et l'URL survit dans l'historique du
//      navigateur, le presse-papiers, le fil de discussion.
//   2. RÉUTILISER LE JETON DE RUCHE. Il est distribué à chaque nœud membre et
//      vaut participation à l'essaim. Le mettre dans un lien public revient à
//      inviter des inconnus à exécuter du code chez vos amis.
//   3. FAIRE UN JETON DÉDIÉ… QUI OUVRE TOUT. Un jeton en lecture seule qui lit
//      TOUS les projets est une fuite de tous les projets privés dès le premier
//      partage.
//
// D'où les trois propriétés de ce module, qui ne se négocient pas :
//
//   • UN SEUL PROJET. Le jeton porte l'identifiant du projet, et rien d'autre
//     ne s'ouvre avec.
//   • LECTURE SEULE, PAR LISTE BLANCHE D'ACTES. Pas « tout sauf les
//     écritures » — une nouvelle route d'écriture serait ouverte le jour de son
//     ajout, sans que personne ne l'ait décidé. La liste est fermée, et ce
//     qui n'y est pas est refusé.
//   • RÉVOCABLE ET EXPIRANT. Un lien qu'on ne peut pas reprendre est un lien
//     qu'on n'ose pas envoyer.
//
// ─── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
//
// Il ne range rien et ne vérifie aucune empreinte : `shared/acces.ts` sait déjà
// le faire (PBKDF2, comparaison en temps constant), et refaire cette
// mécanique une seconde fois serait la meilleure façon de la refaire moins
// bien.

/** Le préfixe d'un lien de partage. Distinct de `hive1_` et `hive2_`. */
export const PREFIXE_PARTAGE = 'hive3_';

/**
 * Les actes qu'un lien de partage autorise. **Liste blanche, jamais liste
 * noire.**
 *
 * Un « tout sauf les écritures » serait faux le jour où quelqu'un ajoute une
 * route : elle serait ouverte au public sans qu'aucune décision n'ait été
 * prise. Ici, ajouter un acte sans l'inscrire ici le REFUSE — le bon défaut,
 * et la même règle que la matrice des rôles.
 */
export const ACTES_PARTAGES = [
  /** Voir l'avancement : tâches, états, compteurs. */
  'voir_avancement',
  /** Lire l'arborescence et le contenu des fichiers du Rayon. */
  'lire_code',
] as const;
export type ActePartage = (typeof ACTES_PARTAGES)[number];

const ADMIS = new Set<string>(ACTES_PARTAGES);

/** Cet acte est-il permis à un porteur de lien de partage ? Fermé par défaut. */
export function actePartage(acte: string): acte is ActePartage {
  return ADMIS.has(acte);
}

/** Un partage tel qu'il est rangé — `secretHash` est une empreinte, jamais le secret. */
export interface Partage {
  id: string;
  projectId: string;
  secretHash: string;
  /** Ce que l'hôte a écrit pour se souvenir à qui il l'a envoyé. */
  label: string;
  creePar: string;
  creeA: number;
  expireA: number;
  revoqueA: number;
  /** Dernière fois que le lien a servi — pour voir ce qui dort. */
  vuA: number;
}

export type MotifRefus = 'inconnu' | 'revoque' | 'expire' | 'secret_invalide' | 'hors_projet';

export type VerdictPartage = { ok: true } | { ok: false; motif: MotifRefus };

/**
 * Ce partage est-il recevable, maintenant, pour ce projet ?
 *
 * L'ORDRE DES REFUS EST DÉLIBÉRÉ, et repris de `jugerBillet` : révoqué avant
 * expiré. Quelqu'un qui vient de révoquer un lien veut lire « révoqué » — lui
 * dire « expiré » lui ferait croire que sa révocation n'a pas pris, et il
 * chercherait le problème ailleurs.
 *
 * Le secret n'est PAS vérifié ici : cette fonction est pure, et PBKDF2 ne l'est
 * pas. L'appelant le vérifie, et il doit le faire **au même coût quel que soit
 * le résultat** — c'est la leçon de l'ADR 0005, où un identifiant inconnu
 * répondait 9,8 fois plus vite qu'un secret erroné.
 */
export function jugerPartage(
  partage: Partage | undefined,
  projectId: string,
  maintenant: number,
): VerdictPartage {
  if (!partage) return { ok: false, motif: 'inconnu' };
  if (partage.revoqueA > 0) return { ok: false, motif: 'revoque' };
  if (partage.expireA <= maintenant) return { ok: false, motif: 'expire' };
  // LE JETON EST LIÉ À UN SEUL PROJET. Sans cette ligne, un lien donné pour
  // montrer un projet ouvrirait tous les autres, privés compris — c'est la
  // troisième des trois façons de se tromper décrites en tête de fichier.
  if (partage.projectId !== projectId) return { ok: false, motif: 'hors_projet' };
  return { ok: true };
}

/** Un partage est-il encore vivant ? Sert à l'affichage et à l'élagage. */
export function partageVivant(p: Partage, maintenant: number): boolean {
  return p.revoqueA === 0 && p.expireA > maintenant;
}

/** Durée de vie par défaut d'un lien : sept jours. */
export const TTL_PARTAGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Au-delà, on refuse : un lien de trois ans n'est plus un partage, c'est un accès. */
export const TTL_PARTAGE_MAX_MS = 90 * 24 * 60 * 60 * 1000;

/** Ramène une durée demandée dans les bornes, sans jamais lever. */
export function bornerTtlPartage(demande: number | undefined): number {
  if (demande === undefined || !Number.isFinite(demande) || demande <= 0) return TTL_PARTAGE_MS;
  return Math.min(Math.floor(demande), TTL_PARTAGE_MAX_MS);
}

/**
 * Encode un lien de partage.
 *
 * `id` ET secret, comme un billet : l'identifiant permet de retrouver la ligne
 * sans parcourir la table, et le secret seul ne dit pas laquelle chercher.
 */
export function encoderPartage(p: { id: string; secret: string }): string {
  const charge = JSON.stringify({ v: 3, id: p.id, s: p.secret });
  return PREFIXE_PARTAGE + Buffer.from(charge, 'utf8').toString('base64url');
}

/** Décode un lien. Rend `null` sur toute anomalie — jamais un objet à moitié rempli. */
export function decoderPartage(brut: string): { id: string; secret: string } | null {
  let s = brut.trim();
  if (!s.startsWith(PREFIXE_PARTAGE)) return null;
  s = s.slice(PREFIXE_PARTAGE.length);
  // Un jeton démesuré n'est pas un jeton : on refuse AVANT de décoder, pour ne
  // pas allouer un mégaoctet sur la foi d'une chaîne qu'on n'a pas encore lue.
  if (s.length === 0 || s.length > 4096) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (typeof data !== 'object' || data === null) return null;
    const o = data as Record<string, unknown>;
    if (o.v !== 3) return null;
    if (typeof o.id !== 'string' || o.id === '' || o.id.length > 64) return null;
    if (typeof o.s !== 'string' || o.s === '' || o.s.length > 512) return null;
    const decode = { id: o.id, secret: o.s };

    // UNE SEULE ÉCRITURE PAR JETON.
    //
    // Le décodage base64url est laxiste : selon la longueur de la chaîne, des
    // caractères ajoutés à la fin sont purement ignorés, et `hive3_XXXX` et
    // `hive3_XXXXy` rendent alors le MÊME identifiant et le MÊME secret.
    //
    // Ce n'est pas une faille — il faut déjà détenir un jeton valide pour en
    // fabriquer une variante, et la variante n'accorde rien de plus. Mais un
    // même droit qui s'écrit d'une infinité de façons est un piège pour tout
    // ce qui compte les chaînes plutôt que les identités : une limitation de
    // débit par jeton, une liste de blocage, une corrélation de journaux.
    //
    // On exige donc que le jeton soit ÉGAL à son propre ré-encodage. La forme
    // canonique est unique, et l'espace blanc reste toléré puisqu'on a coupé
    // avant — un jeton collé avec un retour à la ligne continue de marcher.
    if (encoderPartage(decode) !== brut.trim()) return null;

    return decode;
  } catch {
    return null;
  }
}
