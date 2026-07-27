// Les comptes — qui entre dans la ruche, et ce qu'il a le droit d'y faire.
//
// ─── CE QUI MANQUAIT POUR UN LANCEMENT ───────────────────────────────────────
//
// L'authentification existait (`auth.ts` : PBKDF2, JWT). Trois choses
// manquaient, et chacune est bloquante dès que la ruche cesse d'être un cercle
// d'amis :
//
//   1. AUCUN RÔLE. Tout porteur du jeton de ruche pouvait tout faire. Une page
//      d'administration n'a aucun sens sans quelqu'un à qui la refuser.
//
//   2. AUCUNE PROTECTION DE LA PORTE D'ENTRÉE. `/api/auth/login` vérifie un
//      mot de passe par PBKDF2 — 100 000 itérations, ~50 ms de CPU — sous la
//      seule limite globale de 400 requêtes / 10 s. Deux conséquences, et la
//      seconde est pire que la première :
//        · 2 400 essais de mot de passe par minute : un mot de passe de huit
//          caractères tombe ;
//        · 400 × 50 ms = 20 SECONDES de CPU par fenêtre de 10 s — le hub cesse
//          de répondre sans qu'aucune faille ne soit exploitée.
//      C'est mot pour mot le déni de service que `/api/rejoindre` documente et
//      borne déjà. La même protection manquait sur la porte principale.
//
//   3. AUCUN CONTRÔLE DE L'INSCRIPTION. Ouverte à tous, pour toujours. Sur une
//      ruche exposée, c'est un compte pour quiconque trouve l'URL.
//
// ─── POURQUOI COMPTER SUR DEUX CLÉS, ET PAS UNE ──────────────────────────────
//
// Les échecs sont comptés PAR COMPTE et PAR IP, séparément. Ce n'est pas de la
// ceinture-et-bretelles : les deux compteurs attrapent des attaques
// différentes, et chacun seul laisse passer l'autre.
//
//   · Par IP seule : une attaque distribuée (mille machines, un compte) passe
//     sous le seuil de chaque IP tout en martelant le même mot de passe.
//   · Par compte seul : une IP qui essaie « motdepasse123 » sur mille comptes
//     différents ne déclenche jamais le compteur d'aucun d'eux — et c'est
//     l'attaque qui réussit le plus souvent en pratique.
//
// ─── NE JAMAIS DIRE SI LE COMPTE EXISTE ──────────────────────────────────────
//
// « Email inconnu » et « mot de passe incorrect » doivent être LE MÊME message,
// avec LE MÊME délai. Distinguer les deux offre un annuaire : on découvre qui
// est inscrit sans jamais deviner un mot de passe — et sur une ruche
// communautaire, savoir qui participe est déjà une information.
//
// MODULE PUR. Aucune I/O. `now` est un paramètre : un verrouillage qui lirait
// l'horloge en cachette serait intestable, et un test qui attend une vraie
// minute n'est pas un test qu'on garde.

/** Version du modèle de comptes. Motif VERSION_BALANCE. */
export const VERSION_COMPTES = 1;

// ─── Les rôles ───────────────────────────────────────────────────────────────

/**
 * Deux rôles, et pas cinq.
 *
 * Chaque rôle supplémentaire est une matrice de permissions de plus à tenir
 * juste, et un tableau de bord d'administration où l'on se trompe. On en
 * ajoutera quand un besoin réel le demandera, pas avant.
 */
export const ROLES = ['membre', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Ce qu'on peut demander à faire.
 *
 * Nommées par l'ACTE, pas par la route : une permission attachée à une URL
 * devient fausse au premier renommage, et personne ne s'en aperçoit.
 */
export const ACTIONS = [
  'voir_ses_projets',
  'creer_projet',
  'regler_autonomie',
  'voir_tous_les_projets',
  'gerer_membres',
  'gerer_abonnements',
  'gerer_serveurs',
  'changer_role',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * La matrice, écrite en entier plutôt que par différence.
 *
 * Un `admin: tout sauf…` se lit vite et se relit mal : le jour où l'on ajoute
 * une action, elle est accordée à l'admin sans que personne ne l'ait décidé.
 * Ici, ajouter une action sans la déclarer la refuse à tout le monde — le bon
 * défaut.
 */
const MATRICE: Record<Role, readonly Action[]> = {
  membre: ['voir_ses_projets', 'creer_projet', 'regler_autonomie'],
  admin: [
    'voir_ses_projets',
    'creer_projet',
    'regler_autonomie',
    'voir_tous_les_projets',
    'gerer_membres',
    'gerer_abonnements',
    'gerer_serveurs',
    'changer_role',
  ],
};

/** Ce rôle peut-il faire cet acte ? Fermé par défaut. */
export function peut(role: Role, action: Action): boolean {
  return MATRICE[role]?.includes(action) ?? false;
}

/**
 * Le rôle du compte qu'on est en train de créer.
 *
 * LE PREMIER COMPTE EST ADMIN, les suivants sont membres. C'est la seule
 * amorce qui ne demande ni mot de passe par défaut (qu'on oublie de changer),
 * ni variable d'environnement (qu'on copie d'un tutoriel), ni route secrète
 * (qu'on découvre). Celui qui installe la ruche est celui qui l'administre.
 *
 * Il n'existe volontairement AUCUN chemin par lequel un compte se promeut
 * lui-même : `changer_role` est réservé aux admins, et un admin ne peut pas
 * se retirer son propre rôle (`peutChangerRole`) — sinon une ruche pourrait se
 * retrouver sans personne pour l'administrer, sans moyen de revenir en arrière.
 */
export function roleALaCreation(nombreDeComptesExistants: number): Role {
  return nombreDeComptesExistants === 0 ? 'admin' : 'membre';
}

/**
 * Un admin peut-il appliquer ce changement de rôle ?
 *
 * Deux refus, et le second est celui qu'on oublie :
 *   · un non-admin ne change aucun rôle ;
 *   · un admin ne se rétrograde pas LUI-MÊME s'il est le dernier. Une ruche
 *     sans admin est une ruche qu'on ne peut plus administrer, et il n'y a pas
 *     de « mot de passe root » pour s'en sortir.
 */
export function peutChangerRole(opts: {
  auteur: Role;
  auteurId: string;
  cibleId: string;
  nouveauRole: Role;
  admins: number;
}): { autorise: boolean; motif: string } {
  if (!peut(opts.auteur, 'changer_role')) {
    return { autorise: false, motif: 'seul un administrateur change les rôles' };
  }
  const seDegrade =
    opts.auteurId === opts.cibleId && opts.auteur === 'admin' && opts.nouveauRole !== 'admin';
  if (seDegrade && opts.admins <= 1) {
    return {
      autorise: false,
      motif: 'vous êtes le dernier administrateur : nommez quelqu’un d’autre avant de vous retirer',
    };
  }
  return { autorise: true, motif: '' };
}

// ─── L'inscription ───────────────────────────────────────────────────────────

/**
 * Trois positions.
 *
 * `ouverte` par défaut : une ruche qui démarre est vide, et le premier geste
 * est de créer le compte de l'hôte. Fermer par défaut ferait échouer
 * l'installation de tout le monde pour protéger les rares ruches exposées.
 *
 * En revanche, dès qu'un compte existe, une ruche publique devrait passer à
 * `sur_invitation` — et `etatInscription` le DIT plutôt que de l'espérer.
 */
export const INSCRIPTIONS = ['ouverte', 'sur_invitation', 'fermee'] as const;
export type ModeInscription = (typeof INSCRIPTIONS)[number];

export function modeInscriptionDepuisEnv(env: NodeJS.ProcessEnv = process.env): ModeInscription {
  const v = (env.HIVE_INSCRIPTION ?? '').trim();
  return INSCRIPTIONS.includes(v as ModeInscription) ? (v as ModeInscription) : 'ouverte';
}

/**
 * Cette inscription est-elle permise ?
 *
 * Le PREMIER compte passe toujours, quel que soit le mode : sans cela, une
 * ruche installée avec `HIVE_INSCRIPTION=fermee` serait définitivement
 * inutilisable, sans aucun moyen de créer son premier administrateur.
 */
export function inscriptionPermise(opts: {
  mode: ModeInscription;
  comptesExistants: number;
  billetValide?: boolean;
}): { permise: boolean; motif: string } {
  if (opts.comptesExistants === 0) {
    return { permise: true, motif: 'premier compte de la ruche' };
  }
  if (opts.mode === 'ouverte') return { permise: true, motif: 'inscriptions ouvertes' };
  if (opts.mode === 'sur_invitation') {
    return opts.billetValide === true
      ? { permise: true, motif: 'billet d’invitation valide' }
      : { permise: false, motif: 'cette ruche est sur invitation — demandez un billet à l’hôte' };
  }
  return { permise: false, motif: 'les inscriptions sont fermées sur cette ruche' };
}

/** Ce qu'il faut afficher à l'hôte sur l'état de sa porte d'entrée. */
export function etatInscription(
  mode: ModeInscription,
  comptesExistants: number,
): { mode: ModeInscription; avertissement: string } {
  if (mode === 'ouverte' && comptesExistants > 0) {
    return {
      mode,
      avertissement:
        'Les inscriptions sont OUVERTES : quiconque atteint cette ruche peut s’y créer un compte. ' +
        'Passez HIVE_INSCRIPTION=sur_invitation si elle est exposée sur Internet.',
    };
  }
  return { mode, avertissement: '' };
}

// ─── La porte d'entrée ───────────────────────────────────────────────────────

/**
 * Échecs tolérés avant verrouillage, par compte.
 *
 * Cinq : au-delà, ce n'est plus quelqu'un qui se trompe de mot de passe, c'est
 * quelqu'un qui en essaie. En dessous, on verrouille des gens qui reviennent
 * de vacances.
 */
export const ECHECS_COMPTE = 5;

/**
 * Échecs tolérés par IP, tous comptes confondus.
 *
 * Plus haut que le seuil par compte (une famille, un bureau, un atelier
 * partagent une IP publique), mais borné : c'est ce qui attrape la
 * pulvérisation d'un même mot de passe sur mille comptes.
 */
export const ECHECS_IP = 20;

/** Fenêtre d'observation des échecs. */
export const FENETRE_MS = 15 * 60_000;

/** Durée du verrouillage une fois le seuil franchi. */
export const VERROU_MS = 15 * 60_000;

export interface Compteur {
  echecs: number;
  /** Début de la fenêtre courante. */
  depuis: number;
  /** Verrouillé jusqu'à cet instant, ou 0. */
  verrouJusqua: number;
}

export function compteurVide(): Compteur {
  return { echecs: 0, depuis: 0, verrouJusqua: 0 };
}

/**
 * Le compteur, vu à l'instant `now` : la fenêtre expirée est remise à zéro.
 *
 * PURE : ne mute pas l'entrée. L'appelant décide s'il range le résultat.
 */
export function rafraichir(c: Compteur, now: number): Compteur {
  if (c.verrouJusqua > now) return c; // un verrou en cours ne s'efface pas
  if (c.depuis !== 0 && now - c.depuis >= FENETRE_MS) return compteurVide();
  return c.verrouJusqua !== 0 ? { ...c, verrouJusqua: 0 } : c;
}

/** Enregistre un échec et rend le compteur suivant. */
export function echec(c: Compteur, now: number, seuil: number): Compteur {
  const base = rafraichir(c, now);
  if (base.verrouJusqua > now) return base;
  const echecs = base.echecs + 1;
  const depuis = base.depuis === 0 ? now : base.depuis;
  return echecs >= seuil
    ? { echecs, depuis, verrouJusqua: now + VERROU_MS }
    : { echecs, depuis, verrouJusqua: 0 };
}

/**
 * Décide si une tentative peut seulement ÊTRE ESSAYÉE.
 *
 * Appelé AVANT le PBKDF2 — c'est tout l'intérêt : un verrou qui ne s'appliquerait
 * qu'après le calcul ne protégerait ni le mot de passe ni le CPU du hub.
 */
export function tentativeAutorisee(
  parCompte: Compteur,
  parIp: Compteur,
  now: number,
): { autorisee: boolean; attendreMs: number; motif: string } {
  const c = rafraichir(parCompte, now);
  const i = rafraichir(parIp, now);
  const jusqua = Math.max(c.verrouJusqua, i.verrouJusqua);
  if (jusqua > now) {
    return {
      autorisee: false,
      attendreMs: jusqua - now,
      // Le motif ne dit PAS lequel des deux compteurs a mordu : le savoir
      // apprendrait à l'attaquant s'il a trouvé un compte existant.
      motif: 'trop de tentatives, réessayez plus tard',
    };
  }
  return { autorisee: true, attendreMs: 0, motif: '' };
}

/**
 * Normalise un email pour servir de clé de compteur.
 *
 * Sans ça, « Alice@X.COM » et « alice@x.com » auraient deux compteurs
 * distincts, et il suffirait d'alterner la casse pour doubler son quota — une
 * évasion triviale que la validation de forme ne rattrape pas.
 */
export function cleCompte(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

/**
 * Force d'un mot de passe, refusée ou acceptée.
 *
 * On ne mesure PAS l'entropie : les scores de force apprennent surtout aux
 * gens à ajouter « ! » à la fin. Deux règles simples et défendables — une
 * longueur qui rend la force brute inutile, et le refus des quelques mots de
 * passe qui sont dans toutes les listes.
 */
export const LONGUEUR_MIN = 12;

/**
 * Longueur à partir de laquelle on cesse de chercher des mots communs.
 *
 * Une phrase de vingt caractères tire sa force de sa longueur, pas de son
 * vocabulaire. Continuer à la refuser parce qu'elle contient « admin »
 * n'apprendrait rien à personne, sinon à écrire « adm1n ».
 */
export const PHRASE_SUFFISANTE = 20;

const TROP_COMMUNS = [
  'password',
  'motdepasse',
  '123456',
  'azerty',
  'qwerty',
  'changeme',
  'change-me',
  'hive',
  'admin',
  'letmein',
];

export function jugerMotDePasse(mdp: string): { accepte: boolean; motif: string } {
  if (mdp.length < LONGUEUR_MIN) {
    return {
      accepte: false,
      motif: `${LONGUEUR_MIN} caractères minimum — une phrase de trois mots fait un très bon mot de passe`,
    };
  }
  const bas = mdp.toLowerCase();
  // Un mot commun disqualifie un mot de passe COURT — « motdepasse » rallongé
  // en « motdepassemm » est exactement ce que font les gens quand un
  // formulaire exige douze caractères, et c'est aussi faible qu'avant.
  //
  // Au-delà de PHRASE_SUFFISANTE, on n'y regarde plus : « je suis admin de
  // cette ruche » n'a rien de faible, et le refuser apprendrait à contourner
  // la règle plutôt qu'à choisir un bon mot de passe.
  if (mdp.length < PHRASE_SUFFISANTE && TROP_COMMUNS.some((m) => bas.includes(m))) {
    return { accepte: false, motif: 'ce mot de passe est dans toutes les listes d’attaque' };
  }
  // Un mot de passe fait d'un seul caractère répété passe la longueur sans
  // rien valoir : « aaaaaaaaaaaa » est deviné avant « password ».
  if (new Set(bas).size <= 3) {
    return { accepte: false, motif: 'trop peu de caractères différents' };
  }
  return { accepte: true, motif: '' };
}
