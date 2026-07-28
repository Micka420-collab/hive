// Les serveurs — provisionner une machine quand quelqu'un paie, et l'arrêter
// quand il cesse.
//
// ─── CE QUE CE MODULE FAIT VRAIMENT, ET CE QU'IL DÉLÈGUE ─────────────────────
//
// Il tient le CYCLE DE VIE : ce qui est demandé, ce qui tourne, ce qui doit
// s'arrêter, et surtout ce qui ne doit PAS être provisionné deux fois. Il ne
// démarre aucune machine lui-même — cela appartient à un `Fournisseur`
// injecté, exactement comme `Fetcheur` dans `github.ts`.
//
// Ce découpage n'est pas de la coquetterie architecturale. Une machine
// démarrée coûte de l'argent à quelqu'un toutes les heures ; la logique qui
// décide QUAND en démarrer une doit être testable sans jamais toucher à une
// API de cloud, et sans qu'un test oublié laisse une facture derrière lui.
//
// ─── LE PIÈGE PRINCIPAL : LE WEBHOOK REJOUÉ ──────────────────────────────────
//
// Un processeur de paiement re-livre un webhook qu'il croit perdu. C'est
// normal, documenté, et cela arrive vraiment. Sans idempotence, chaque
// re-livraison démarre une machine de plus : le client en paie une, on en
// facture dix, et personne ne s'en aperçoit avant la facture du fournisseur.
//
// La clé d'idempotence est la RÉFÉRENCE D'ABONNEMENT, pas l'identifiant de
// l'événement : deux événements distincts (« actif » puis « paiement_reussi »)
// portent le même abonnement et ne doivent produire qu'un seul serveur.
//
// ─── L'ARRÊT EST AUSSI IMPORTANT QUE LE DÉMARRAGE ────────────────────────────
//
// Un abonnement qui se termine sans que la machine s'arrête, c'est une
// facture qui court pour un client qui ne paie plus. Mais la SUPPRIMER
// immédiatement détruirait le travail en cours. D'où deux gestes distincts :
// `arreter` (la machine s'éteint, les données restent) puis, seulement après
// un délai, `supprimer`.
//
// MODULE PUR. Aucune I/O, aucune horloge implicite.

/** Version du modèle de serveurs. Motif VERSION_BALANCE. */
export const VERSION_SERVEURS = 1;

/**
 * Le cycle de vie, du plus jeune au plus vieux.
 *
 * `echoue` est un état à part entière et pas une absence : une demande qui
 * n'aboutit pas doit rester VISIBLE, avec son motif. Un provisionnement raté
 * qui disparaît silencieusement, c'est un client qui a payé et qui attend.
 */
export const ETATS = [
  'demande',
  'provisionnement',
  'pret',
  'arrete',
  'supprime',
  'echoue',
] as const;
export type EtatServeur = (typeof ETATS)[number];

/** États depuis lesquels la machine coûte encore de l'argent. */
const FACTURABLES: readonly EtatServeur[] = ['provisionnement', 'pret'];

export function coute(etat: EtatServeur): boolean {
  return FACTURABLES.includes(etat);
}

/**
 * Délai entre l'arrêt et la suppression définitive.
 *
 * Trente jours. Assez pour qu'un client qui revient retrouve son travail,
 * assez court pour qu'on ne stocke pas indéfiniment les données de gens
 * partis. C'est un compromis, et il doit être affiché au client au moment où
 * son abonnement s'arrête — pas découvert le jour où il revient.
 */
export const RETENTION_JOURS = 30;
const JOUR_MS = 86_400_000;

/**
 * Serveurs au plus par abonnement.
 *
 * BORNE DURE, indépendante du plan. Elle n'est pas là pour vendre moins :
 * elle est là pour qu'un bogue dans la logique de plan ne puisse pas
 * provisionner mille machines. Une borne qui dépend de la donnée qu'elle
 * borne n'est pas une borne.
 */
export const SERVEURS_MAX = 8;

export interface Serveur {
  id: string;
  /** Projet servi. */
  projectId: string;
  /** Référence d'abonnement chez le processeur — LA clé d'idempotence. */
  refAbonnement: string;
  etat: EtatServeur;
  /** Nom du fournisseur qui l'a démarré (« manuel » compris). */
  fournisseur: string;
  /** Identifiant de la machine chez le fournisseur, vide tant qu'elle n'existe pas. */
  refMachine: string;
  /** Gabarit demandé (2 vCPU / 4 Go…), tel que le fournisseur le nomme. */
  gabarit: string;
  /** Motif du dernier changement d'état. Toujours renseigné sur `echoue`. */
  motif: string;
  creeA: number;
  majA: number;
  /** Arrêté à cet instant, ou 0. Décompte de la rétention. */
  arreteA: number;
}

// ─── Décider : provisionner, ou pas ──────────────────────────────────────────

export interface DemandeProvision {
  projectId: string;
  refAbonnement: string;
  /** Serveurs inclus par le plan acheté. */
  serveursInclus: number;
  gabarit: string;
}

export type Verdict =
  { action: 'provisionner'; combien: number; motif: string } | { action: 'rien'; motif: string };

/**
 * Faut-il démarrer des machines pour cette demande ?
 *
 * IDEMPOTENT PAR CONSTRUCTION : on compte ce qui existe DÉJÀ pour cette
 * référence d'abonnement, et on ne complète que la différence. Rejouer le même
 * webhook dix fois rend « rien » neuf fois — sans quoi le client en paierait
 * une et on en facturerait dix.
 *
 * Les serveurs `arrete` comptent : un abonnement réactivé doit RALLUMER ce qui
 * existe, pas empiler une machine neuve à côté de l'ancienne en laissant les
 * données de l'utilisateur dans une machine éteinte qu'il ne retrouvera jamais.
 */
export function decider(demande: DemandeProvision, existants: readonly Serveur[]): Verdict {
  const miens = existants.filter(
    (s) => s.refAbonnement === demande.refAbonnement && s.etat !== 'supprime',
  );
  const vivants = miens.filter((s) => s.etat !== 'echoue').length;

  if (demande.serveursInclus <= 0) {
    return { action: 'rien', motif: 'ce plan n’inclut aucun serveur' };
  }
  const voulus = Math.min(demande.serveursInclus, SERVEURS_MAX);
  if (vivants >= voulus) {
    return {
      action: 'rien',
      motif: `déjà ${vivants} serveur(s) pour cet abonnement`,
    };
  }
  return {
    action: 'provisionner',
    combien: voulus - vivants,
    motif: `${voulus - vivants} serveur(s) à démarrer`,
  };
}

/**
 * Ce qu'il faut faire des serveurs d'un abonnement qui n'a plus de droits.
 *
 * Deux gestes SÉPARÉS, et l'ordre compte. Arrêter d'abord : la facture cesse
 * immédiatement. Supprimer seulement après la rétention : le travail du client
 * survit à un oubli de paiement, et un retour est possible.
 */
export function aArreter(serveurs: readonly Serveur[]): Serveur[] {
  return serveurs.filter((s) => coute(s.etat));
}

export function aSupprimer(serveurs: readonly Serveur[], now: number): Serveur[] {
  return serveurs.filter(
    (s) => s.etat === 'arrete' && s.arreteA > 0 && now - s.arreteA >= RETENTION_JOURS * JOUR_MS,
  );
}

/** Jours restants avant suppression définitive. `-1` si non concerné. */
export function joursAvantSuppression(s: Serveur, now: number): number {
  if (s.etat !== 'arrete' || s.arreteA <= 0) return -1;
  const reste = s.arreteA + RETENTION_JOURS * JOUR_MS - now;
  return Math.max(0, Math.ceil(reste / JOUR_MS));
}

// ─── Le fournisseur, injecté ─────────────────────────────────────────────────

export interface Machine {
  /** Identifiant chez le fournisseur. */
  ref: string;
  /** Ce qu'il faut dire à l'humain pour finir, si quelque chose reste à faire. */
  instructions: string[];
}

/**
 * Ce qu'un fournisseur doit savoir faire. Trois verbes, pas un de plus.
 *
 * Aucun `lister` : la vérité de ce qui existe est la BASE de la ruche, pas
 * l'API du fournisseur. Se fier au fournisseur ferait dépendre l'idempotence
 * de sa disponibilité — et un appel qui échoue deviendrait « aucune machine
 * n'existe », donc « provisionne ».
 */
export interface FournisseurServeur {
  nom: string;
  demarrer(opts: {
    gabarit: string;
    /** Billet d'invitation à usage unique pour rejoindre la ruche. */
    billet: string;
    /** URL WebSocket de la ruche. */
    urlRuche: string;
  }): Promise<Machine>;
  arreter(ref: string): Promise<void>;
  supprimer(ref: string): Promise<void>;
}

/**
 * Le fournisseur MANUEL — celui qui est livré, et qui marche aujourd'hui.
 *
 * Il ne démarre aucune machine : il produit les instructions exactes, billet
 * d'invitation compris, pour que l'humain les colle sur n'importe quel VPS.
 * Le serveur passe donc en `provisionnement` et attend que la machine se
 * connecte pour devenir `pret`.
 *
 * POURQUOI LIVRER ÇA PLUTÔT QU'UNE INTÉGRATION DE CLOUD. Parce qu'une
 * intégration exige un compte, une clé d'API, une facturation et une région —
 * quatre choses qu'on ne peut pas inventer à la place de l'utilisateur. Le
 * chemin manuel, lui, fonctionne sans rien, et la chaîne complète (achat →
 * serveur créé → billet émis → machine rattachée) est la MÊME. Brancher un
 * vrai fournisseur ensuite ne change qu'un objet.
 */
export const FOURNISSEUR_MANUEL: FournisseurServeur = {
  nom: 'manuel',
  demarrer: ({ gabarit, billet, urlRuche }) =>
    Promise.resolve({
      ref: '',
      instructions: [
        `Louez un VPS (${gabarit}) chez l’hébergeur de votre choix.`,
        'Installez Node 20 puis clonez Hive :',
        '  git clone https://github.com/Micka420-collab/hive && cd hive && npm run setup',
        'Installez podman pour que les agents tournent en bac à sable :',
        '  https://podman.io/docs/installation',
        'Puis rattachez la machine à la ruche avec ce billet à usage unique :',
        `  npm run join ${billet}`,
        `(la ruche est joignable sur ${urlRuche})`,
      ],
    }),
  arreter: () => Promise.resolve(),
  supprimer: () => Promise.resolve(),
};

/**
 * Ce qu'on écrit à la place du billet quand on RANGE des instructions.
 *
 * ─── LA FUITE QUE CETTE FONCTION FERME ──────────────────────────────────────
 *
 * Les instructions du fournisseur manuel contiennent, par construction, le
 * billet de rattachement — c'est leur raison d'être. Et elles étaient rangées
 * telles quelles dans `serveurs.motif` :
 *
 *     transiter(base, 'provisionnement', machine.instructions.join(' ⏎ '), now)
 *
 * Or un billet porte le SECRET EN CLAIR (`hive2_…` est un base64url lisible,
 * pas un chiffrement). Toute la précaution prise à côté — ne ranger que
 * `secretHash`, une empreinte PBKDF2, jamais le secret — était donc annulée par
 * cette ligne : l'empreinte dans `billets`, et le secret en clair juste à côté
 * dans `serveurs`, durablement, sans borne liée à sa péremption. Un billet à
 * usage unique consommé il y a trois mois y dormait encore.
 *
 * `motif` est un champ d'ÉTAT. Personne ne s'attend à y trouver un
 * identifiant : il s'affiche dans une page d'administration, se copie dans un
 * fil de support, se lit dans une sauvegarde.
 *
 * Le billet reste évidemment nécessaire à l'humain qui doit coller la
 * commande : il lui est remis autrement, une seule fois, et jamais rangé.
 */
export const BILLET_CAVIARDE = '<billet remis une seule fois — voir la page serveurs>';

/** Remplace le billet par sa mention, pour tout ce qui sera RANGÉ ou affiché. */
export function caviarderBillet(instructions: readonly string[], billet: string): string[] {
  // Un billet vide remplacerait chaque chaîne vide de la liste : ce serait
  // remplacer partout plutôt que nulle part, exactement le mauvais sens.
  if (billet === '') return [...instructions];
  return instructions.map((l) => l.split(billet).join(BILLET_CAVIARDE));
}

/** Les fournisseurs connus. Un seul aujourd'hui, et il est honnête sur ce qu'il fait. */
export const FOURNISSEURS: readonly FournisseurServeur[] = [FOURNISSEUR_MANUEL];

export function fournisseurParNom(nom: string): FournisseurServeur | null {
  return FOURNISSEURS.find((f) => f.nom === nom) ?? null;
}

// ─── Transitions ─────────────────────────────────────────────────────────────

/**
 * Les transitions permises. Écrites en entier, comme la matrice de rôles :
 * un état non déclaré ne mène nulle part, ce qui est le bon défaut.
 *
 * `supprime` est TERMINAL. Une machine supprimée ne se rallume pas — la
 * ressusciter donnerait un serveur au même identifiant sans les données qu'il
 * avait, ce qui est pire que de refuser.
 */
const TRANSITIONS: Record<EtatServeur, readonly EtatServeur[]> = {
  demande: ['provisionnement', 'echoue'],
  provisionnement: ['pret', 'echoue', 'arrete'],
  pret: ['arrete', 'echoue'],
  arrete: ['provisionnement', 'supprime'],
  echoue: ['provisionnement', 'supprime'],
  supprime: [],
};

export function transitionPermise(de: EtatServeur, vers: EtatServeur): boolean {
  return TRANSITIONS[de]?.includes(vers) ?? false;
}

/**
 * Les états atteignables depuis celui-ci.
 *
 * Sert au tableau d'administration : l'écran n'affiche QUE les gestes que le
 * serveur acceptera. Sans cela, la même matrice serait recopiée côté navigateur
 * et les deux dériveraient — un bouton proposé ici, refusé là-bas, sans que
 * rien ne signale la contradiction avant le clic.
 */
export function transitionsDepuis(de: EtatServeur): readonly EtatServeur[] {
  return TRANSITIONS[de] ?? [];
}

/** Applique une transition, ou explique pourquoi elle est refusée. */
export function transiter(
  s: Serveur,
  vers: EtatServeur,
  motif: string,
  now: number,
): { serveur: Serveur; applique: boolean; refus: string } {
  if (s.etat === vers) {
    // Idempotent : re-demander l'état courant n'est pas une erreur, c'est un
    // webhook rejoué ou un bouton cliqué deux fois.
    return { serveur: s, applique: false, refus: '' };
  }
  if (!transitionPermise(s.etat, vers)) {
    return {
      serveur: s,
      applique: false,
      refus: `transition refusée : ${s.etat} → ${vers}`,
    };
  }
  return {
    serveur: {
      ...s,
      etat: vers,
      motif,
      majA: now,
      arreteA: vers === 'arrete' ? now : s.arreteA,
    },
    applique: true,
    refus: '',
  };
}

// ─── Ce qu'on montre à l'administrateur ──────────────────────────────────────

export interface VueServeurs {
  total: number;
  /** Machines qui coûtent de l'argent en ce moment. */
  facturables: number;
  parEtat: Record<EtatServeur, number>;
  /** Serveurs arrêtés dont les données seront bientôt effacées. */
  bientotSupprimes: Array<{ id: string; jours: number }>;
}

/**
 * Vue dérivée PURE — recalculée, jamais rangée (règle 1 de la doctrine).
 *
 * `facturables` est le chiffre qui compte pour l'hôte : c'est ce qu'il paie
 * en ce moment, et c'est le seul qu'on ne veut jamais découvrir en retard.
 */
export function replierServeurs(serveurs: readonly Serveur[], now: number): VueServeurs {
  const parEtat = Object.fromEntries(ETATS.map((e) => [e, 0])) as Record<EtatServeur, number>;
  for (const s of serveurs) parEtat[s.etat] += 1;

  const bientot = serveurs
    .map((s) => ({ id: s.id, jours: joursAvantSuppression(s, now) }))
    .filter((x) => x.jours >= 0 && x.jours <= 7)
    .sort((a, b) => a.jours - b.jours || a.id.localeCompare(b.id));

  return {
    total: serveurs.length,
    facturables: serveurs.filter((s) => coute(s.etat)).length,
    parEtat,
    bientotSupprimes: bientot,
  };
}
