// La configuration initiale de la ruche — ce que l'hôte choisit à la première
// arrivée, rangé CHEZ LA REINE.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// Le seul « onboarding » du tableau de bord était `OnboardingEssaim` : une
// liste de prérequis vers le premier cycle autonome, montée DANS un projet. Il
// suppose donc un projet, et il ne demande rien. Personne ne disait à la
// personne qui ouvre Mission Control pour la première fois ce qu'elle
// installait : une ruche fermée sur sa machine, une ruche que d'autres postes
// rejoignent, ou une ruche exposée sur Internet derrière Caddy — trois
// installations dont la sécurité n'a rien à voir.
//
// Ces choix vivaient, au mieux, dans la tête de l'hôte. Les ranger dans le
// `localStorage` d'un navigateur aurait fait une ruche qui « oublie » sa
// configuration dès qu'on l'ouvre d'un autre poste, et un assistant qui se
// relance à chaque nouvel onglet. Ils vivent donc chez la Reine, une ligne
// unique en base, écrite par qui répond de la ruche.
//
// ─── CE QUE CES CHOIX FONT, ET CE QU'ILS NE FONT PAS ─────────────────────────
//
// Ils sont DÉCLARATIFS. Choisir « local » ne referme pas l'écoute de la Reine
// à chaud : l'hôte d'écoute se lit au démarrage (`HIVE_HOST`), et un bouton qui
// le changerait en silence déplacerait la frontière réseau de la ruche sans
// qu'un humain ait tapé la ligne. Ce que ce module fait, c'est CONFRONTER le
// choix à ce qui tourne (`coherenceDuMode`) : un mode « local » sur une Reine
// qui écoute `0.0.0.0` est dit, avec la ligne exacte à poser. C'est la règle du
// docteur (`doctor.ts`) : chaque verdict porte sa réparation, et ce qu'on n'a
// pas pu mesurer se lit `inconnu`, jamais `ok`.
//
// MODULE PUR — aucune I/O, aucune horloge. Le serveur relève les faits, le
// store range, l'écran rend.

import { boucleLocale } from './joignable.js';
import type { Diagnostic } from './doctor.js';

/**
 * Les trois installations.
 *
 * · `local`   — tout sur cette machine : la Reine n'écoute que la boucle
 *               locale, aucune ouvrière distante ne la rejoint ;
 * · `hybride` — la Reine reste chez soi, des postes du réseau (ou d'ailleurs)
 *               la rejoignent par billet (`hive invite`) ;
 * · `cloud`   — la Reine est exposée derrière Caddy, avec des comptes
 *               (docs/CLOUD.md).
 */
export const MODES_RUCHE = ['local', 'hybride', 'cloud'] as const;
export type ModeRuche = (typeof MODES_RUCHE)[number];

/**
 * Où vivent les secrets des agents.
 *
 * · `sessions_cli` — chaque agent utilise la connexion de son propre CLI
 *                    (`claude /login`, `codex login`) : Hive ne range aucune clé ;
 * · `cles_reine`   — les clés d'API sont posées chez la Reine et remises sur
 *                    réquisition (ADR 0010, la Chambre) ;
 * · `cles_noeud`   — chaque machine garde ses clés dans son propre `.env`.
 */
export const POLITIQUES_SECRETS = ['sessions_cli', 'cles_reine', 'cles_noeud'] as const;
export type PolitiqueSecrets = (typeof POLITIQUES_SECRETS)[number];

/**
 * Où la ruche livre le travail relu.
 *
 * · `local`   — une branche dans le dépôt de la machine, jamais poussée
 *               (`livraison-locale.ts`) ;
 * · `distant` — une pull request chez GitHub, avec le jeton de l'hôte.
 */
export const PREFERENCES_GIT = ['local', 'distant'] as const;
export type PreferenceGit = (typeof PREFERENCES_GIT)[number];

/**
 * Les connecteurs qu'on peut cocher dès la première arrivée — ceux qui
 * EXISTENT dans cette version, et rien d'autre : proposer une case pour un
 * connecteur absent serait promettre un geste qu'aucun écran ne tient.
 *
 * · `github`   — importer un dépôt, ouvrir les pull requests (Projets) ;
 * · `openalex` — la veille de littérature ouverte (Intendance).
 */
export const CONNECTEURS_INITIAUX = ['github', 'openalex'] as const;
export type ConnecteurInitial = (typeof CONNECTEURS_INITIAUX)[number];

/**
 * Les étapes de l'assistant, DANS L'ORDRE où on les franchit.
 *
 * L'étape courante est rangée avec le brouillon : un onglet fermé au milieu,
 * une coupure de courant, un autre poste — l'assistant reprend là où la
 * personne s'était arrêtée, pas à l'accueil.
 */
export const ETAPES_ASSISTANT = [
  'accueil',
  'mode',
  'agents',
  'stockage',
  'git',
  'secrets',
  'connecteurs',
  'projet',
  'sante',
  'recap',
] as const;
export type EtapeAssistant = (typeof ETAPES_ASSISTANT)[number];

/** Qui a écrit en dernier. Même aveu que la War Room : le jeton ne désigne personne. */
export type AuteurConfiguration = { genre: 'compte'; userId: string } | { genre: 'jeton_de_ruche' };

/** Les choix eux-mêmes — `null` : pas encore choisi, jamais un défaut deviné. */
export interface ChoixInitiaux {
  mode: ModeRuche | null;
  secrets: PolitiqueSecrets | null;
  git: PreferenceGit | null;
  connecteurs: ConnecteurInitial[];
  etape: EtapeAssistant;
}

/** La ligne rangée : les choix, et ce qui dit s'ils sont arrêtés. */
export interface ConfigurationInitiale extends ChoixInitiaux {
  /** `null` : l'assistant n'a jamais été mené au bout — la porte de la première arrivée. */
  termineeA: number | null;
  majA: number;
  majPar: AuteurConfiguration;
}

/** Ce qu'un PUT peut changer : chaque champ est facultatif, aucun n'est deviné. */
export type ModificationConfiguration = Partial<ChoixInitiaux>;

/** Le brouillon d'une ruche qui n'a encore rien choisi. */
export const CHOIX_VIERGES: Readonly<ChoixInitiaux> = {
  mode: null,
  secrets: null,
  git: null,
  connecteurs: [],
  etape: 'accueil',
};

const dans =
  <T extends string>(valeurs: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (valeurs as readonly string[]).includes(v);

export const estModeRuche = dans(MODES_RUCHE);
export const estPolitiqueSecrets = dans(POLITIQUES_SECRETS);
export const estPreferenceGit = dans(PREFERENCES_GIT);
export const estConnecteurInitial = dans(CONNECTEURS_INITIAUX);
export const estEtapeAssistant = dans(ETAPES_ASSISTANT);

/**
 * Relit une ligne de la base. Une valeur que cette version ne connaît pas
 * (base écrite par une version plus récente, ligne abîmée) redevient « pas
 * encore choisi » — jamais un choix voisin qu'on aurait deviné.
 */
export function relireChoix(brut: {
  mode: unknown;
  secrets: unknown;
  git: unknown;
  connecteurs: unknown;
  etape: unknown;
}): ChoixInitiaux {
  let connecteurs: unknown = [];
  if (typeof brut.connecteurs === 'string') {
    try {
      connecteurs = JSON.parse(brut.connecteurs);
    } catch {
      connecteurs = [];
    }
  }
  return {
    mode: estModeRuche(brut.mode) ? brut.mode : null,
    secrets: estPolitiqueSecrets(brut.secrets) ? brut.secrets : null,
    git: estPreferenceGit(brut.git) ? brut.git : null,
    connecteurs: Array.isArray(connecteurs) ? dedoublonner(connecteurs) : [],
    etape: estEtapeAssistant(brut.etape) ? brut.etape : 'accueil',
  };
}

/** Connecteurs connus, sans doublon, dans l'ordre du catalogue (deux lectures, un même rendu). */
function dedoublonner(liste: readonly unknown[]): ConnecteurInitial[] {
  return CONNECTEURS_INITIAUX.filter((c) => liste.includes(c));
}

/** Applique une modification à un brouillon — ce qui n'est pas dans le corps ne bouge pas. */
export function fusionnerChoix(
  courant: ChoixInitiaux | null,
  modif: ModificationConfiguration,
): ChoixInitiaux {
  const base = courant ?? CHOIX_VIERGES;
  return {
    mode: modif.mode !== undefined ? modif.mode : base.mode,
    secrets: modif.secrets !== undefined ? modif.secrets : base.secrets,
    git: modif.git !== undefined ? modif.git : base.git,
    connecteurs:
      modif.connecteurs !== undefined ? dedoublonner(modif.connecteurs) : [...base.connecteurs],
    etape: modif.etape ?? base.etape,
  };
}

/** Ce qui manque encore pour arrêter la configuration — vide : on peut terminer. */
export function choixManquants(c: ChoixInitiaux): Array<'mode' | 'secrets' | 'git'> {
  const manque: Array<'mode' | 'secrets' | 'git'> = [];
  if (c.mode === null) manque.push('mode');
  if (c.secrets === null) manque.push('secrets');
  if (c.git === null) manque.push('git');
  return manque;
}

// ─── La porte ────────────────────────────────────────────────────────────────

/**
 * Qui peut ÉCRIRE la configuration de la ruche ?
 *
 * Un VERDICT, pas un booléen (#467) : `reserve` et `anonyme` ne se répondent
 * pas de la même façon, et un `!verdict` qui les confondrait ouvrirait la porte
 * à qui n'a rien présenté.
 *
 * ─── LA RÈGLE ────────────────────────────────────────────────────────────────
 *
 *   · un compte ADMINISTRATEUR — celui qui répond de la ruche ;
 *   · OU le jeton de ruche, TANT QU'AUCUN COMPTE N'EXISTE.
 *
 * La seconde voie n'est pas une faiblesse, c'est l'amorce : sur une ruche neuve,
 * le porteur du jeton peut DÉJÀ créer le premier compte, qui devient
 * administrateur (`roleALaCreation`, et l'inscription du premier compte exige ce
 * même jeton). Lui refuser la configuration ne protégerait rien, et ferait de
 * l'assistant de première arrivée un écran qui commence par un refus. C'est le
 * raisonnement d'`ouvertAuJetonDeRuche` pour un projet orphelin : ce qui
 * n'appartient à personne appartient à la ruche, et le jeton EST la ruche.
 *
 * Dès qu'un compte existe, la ruche a quelqu'un qui en répond : le jeton —
 * recopié sur chaque machine membre — ne règle plus rien. Un membre non
 * administrateur reçoit `reserve` (403) : il sait que la ruche existe.
 */
export type VerdictConfiguration = 'permis' | 'reserve' | 'anonyme';

export function porteConfiguration(o: {
  /** L'appelant présente un compte valide ; `admin` dit s'il administre. */
  compte: { admin: boolean } | null;
  /** L'appelant présente le jeton de ruche valide. */
  jetonValide: boolean;
  /** Comptes existants dans la ruche. */
  comptes: number;
}): VerdictConfiguration {
  if (o.compte?.admin) return 'permis';
  if (o.compte === null && !o.jetonValide) return 'anonyme';
  if (o.jetonValide && o.comptes === 0) return 'permis';
  return 'reserve';
}

// ─── La cohérence du choix avec ce qui tourne ────────────────────────────────

/** Les faits du déploiement, relevés par le serveur à la lecture. */
export interface FaitsDeploiement {
  /** L'hôte d'écoute de la Reine (`HIVE_HOST`). */
  hote: string;
  /** `HIVE_PUBLIC_URL`, `null` s'il n'est pas posé. */
  urlPublique: string | null;
  /** `HIVE_TRUST_PROXY`, `false` s'il n'est pas posé. */
  confianceProxy: false | string;
  /** Comptes existants, et administrateurs parmi eux. */
  comptes: number;
  admins: number;
  /** `HIVE_INSCRIPTION`. */
  inscription: 'ouverte' | 'sur_invitation' | 'fermee';
}

const ok = (cle: string, constat: string): Diagnostic => ({
  cle,
  gravite: 'ok',
  constat,
  reparation: null,
});

/**
 * Le mode choisi, confronté à la Reine qui tourne.
 *
 * Aucun verdict n'est `bloquant` : la ruche fonctionne dans tous ces cas. Ce
 * qui est dit, c'est l'écart entre ce que l'hôte a DÉCLARÉ et ce qu'il a
 * installé — un « local » ouvert au réseau, un « cloud » sans comptes —, avec
 * la ligne exacte qui referme l'écart. Un mode pas encore choisi ne juge rien :
 * `[]`, jamais un « tout va bien ».
 */
export function coherenceDuMode(mode: ModeRuche | null, f: FaitsDeploiement): Diagnostic[] {
  if (mode === null) return [];
  const locale = boucleLocale(f.hote);
  if (mode === 'local') {
    return [
      locale
        ? ok('mode_ecoute', `La Reine n'écoute que cette machine (${f.hote}).`)
        : {
            cle: 'mode_ecoute',
            gravite: 'risque',
            constat:
              `Mode local choisi, mais la Reine écoute ${f.hote} : ` +
              "d'autres machines du réseau peuvent la joindre.",
            reparation: 'HIVE_HOST=127.0.0.1 dans le .env de la Reine, puis redémarrez-la',
          },
    ];
  }
  if (mode === 'hybride') {
    return [
      locale
        ? {
            cle: 'mode_ecoute',
            gravite: 'risque',
            constat:
              `Mode hybride choisi, mais la Reine n'écoute que ${f.hote} : ` +
              'aucun autre poste ne pourra la rejoindre.',
            reparation:
              "HIVE_HOST=0.0.0.0 dans le .env de la Reine (ou l'adresse du réseau local), " +
              'redémarrez-la, puis « hive invite » pour chaque poste',
          }
        : ok('mode_ecoute', `La Reine écoute ${f.hote} : les postes du réseau peuvent la joindre.`),
      f.urlPublique
        ? ok('mode_adresse', `Les billets annoncent ${f.urlPublique}.`)
        : {
            cle: 'mode_adresse',
            gravite: 'inconnu',
            constat:
              "HIVE_PUBLIC_URL n'est pas posé : les billets annoncent l'adresse " +
              'devinée sur le réseau local, que la ruche ne peut pas vérifier.',
            reparation: 'HIVE_PUBLIC_URL=ws://<adresse-de-la-reine>:7777/ws dans le .env',
          },
    ];
  }
  // cloud — docs/CLOUD.md : Caddy devant, des comptes, une inscription tenue.
  const securisee = f.urlPublique !== null && /^wss:\/\//i.test(f.urlPublique);
  return [
    securisee
      ? ok('mode_adresse', `Adresse publique chiffrée : ${f.urlPublique}.`)
      : {
          cle: 'mode_adresse',
          gravite: 'risque',
          constat:
            f.urlPublique === null
              ? "Mode cloud choisi, mais HIVE_PUBLIC_URL n'est pas posé."
              : `Mode cloud choisi, mais l'adresse publique n'est pas chiffrée (${f.urlPublique}).`,
          reparation: 'HIVE_PUBLIC_URL=wss://<votre-domaine>/ws derrière Caddy (docs/CLOUD.md)',
        },
    f.confianceProxy !== false
      ? ok('mode_proxy', `La Reine croit le proxy « ${f.confianceProxy} ».`)
      : {
          cle: 'mode_proxy',
          gravite: 'risque',
          constat:
            'Mode cloud choisi, mais HIVE_TRUST_PROXY est absent : derrière Caddy, ' +
            "tous les clients partageraient l'adresse du proxy et un seul compteur anti-abus.",
          reparation: 'HIVE_TRUST_PROXY=uniquelocal (Docker) ou loopback (proxy sur la machine)',
        },
    f.admins > 0
      ? ok('mode_comptes', `${f.admins} administrateur(s) pour ${f.comptes} compte(s).`)
      : {
          cle: 'mode_comptes',
          gravite: 'risque',
          constat:
            "Mode cloud choisi, mais aucun compte n'existe : le jeton de ruche " +
            'reste la seule clé de la Reine exposée.',
          reparation: "Créez le compte de l'hôte (« Se connecter » en haut à droite)",
        },
    f.inscription === 'ouverte'
      ? {
          cle: 'mode_inscription',
          gravite: 'risque',
          constat: "L'inscription est ouverte : n'importe qui peut créer un compte.",
          reparation: 'HIVE_INSCRIPTION=sur_invitation dans le .env de la Reine',
        }
      : ok('mode_inscription', `Inscription « ${f.inscription} ».`),
  ];
}

// ─── Le bilan de santé de l'assistant ────────────────────────────────────────

/** Ce qu'une sonde de session a dit d'un agent installé (`inventaireAgents`). */
export type SessionAgent = 'connectee' | 'non_connectee' | 'inconnue';

/** Un agent installé sur la machine de la Reine, et s'il aura une ouvrière. */
export interface AgentDetecte {
  agent: string;
  session: SessionAgent;
  /**
   * `true` : `npm run ruche` lui donnera une ouvrière. Un agent dont la session
   * est `inconnue` (statut muet ou trop lent) TRAVAILLE — c'est la règle de
   * `nonConnecte` : seul un « non connecté » dit par le CLI, sans clé qui en
   * dispense, est écarté.
   */
  travaille: boolean;
  /** Ce qu'il faut faire quand il ne travaille pas ; `null` sinon. */
  remede: string | null;
}

/**
 * Les agents détectés, dans l'ordre de l'inventaire. Le simulé `shell` n'y
 * figure jamais : l'inventaire le range en dernier recours, et le montrer comme
 * « détecté » dirait à qui n'a rien installé que tout va bien.
 */
export function agentsDetectes(inv: {
  presents: readonly { agent: string; session: SessionAgent }[];
  nonConnectes: readonly { agent: string; detail: string }[];
}): AgentDetecte[] {
  return inv.presents
    .filter((p) => p.agent !== 'shell')
    .map((p) => {
      const ecarte = inv.nonConnectes.find((n) => n.agent === p.agent);
      return {
        agent: p.agent,
        session: p.session,
        travaille: !ecarte,
        remede: ecarte?.detail ?? null,
      };
    });
}

/** La réponse de `GET /api/configuration-initiale/sante`. */
export interface SanteInitiale {
  /** Le pire des diagnostics du docteur (`pire`). */
  verdict: Diagnostic['gravite'];
  diagnostics: Diagnostic[];
  agents: AgentDetecte[];
  /** Le moteur d'isolement qui répond (`podman`, `docker`, `bubblewrap`), ou `null`. */
  isolement: string | null;
  stockage: {
    /** Le fichier SQLite de la Reine, tel qu'elle l'a ouvert. */
    chemin: string;
    integre: boolean | null;
    inscriptible: boolean;
    octetsLibres: number | null;
  };
  noeuds: { inscrits: number; enLigne: number };
  coherence: Diagnostic[];
  /** Horodatage du relevé : il date de quelques secondes au plus (voir le cache). */
  releveA: number;
}
