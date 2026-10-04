// La porte de sécurité — ce qu'une production AJOUTE et qu'elle ne doit pas
// livrer : un secret, une dépendance vulnérable.
//
// ─── CE QUI SE PASSAIT EN SILENCE ────────────────────────────────────────────
//
// Le nœud caviardait déjà les lignes ajoutées du diff (`Caviardeur.diff`) :
// un jeton `ghp_…` écrit par l'agent devenait `[secret]`, et la production
// partait SANS verdict — livrée avec un trou à la place de la clé, sans que
// personne ne l'ait demandé. Les clés que les motifs de Hive ne connaissent
// pas (AWS, Stripe, Slack, Google, une clé PEM) passaient, elles, en clair
// jusqu'à la base du hub. Et aucune dépendance n'était lue.
//
// ─── UNE PORTE DISTINCTE, PAS UNE CINQUIÈME VALIDATION ───────────────────────
//
// `VALIDATION_KEYS` (tests, typecheck, build, lint) est un contrat entre les
// nœuds et la Reine : `validationsBacDepuis` exige les quatre clés, et une
// cinquième clé `missing` bloquerait tout le monde — les nœuds plus anciens,
// et les preuves de la CI GitHub, qui ne la porteraient jamais. La porte vit
// donc à côté : un rapport à elle (`PorteSecurite`), additif au protocole,
// rangé dans son propre fait (`security_gate_recorded`) — une CI ingérée
// ensuite remplace les validations du bac (`latestValidation`), jamais ce que
// la porte a vu dans le diff.
//
// ─── TROIS ÉTATS PAR VOLET ───────────────────────────────────────────────────
//
//   · `constat`     — la production ajoute un secret, ou une vulnérabilité que
//                     la base n'avait pas : l'Evaluator demande une correction ;
//   · `non_verifie` — l'outil est absent, en échec, hors délai, ou le nœud n'a
//                     rien rapporté (nœud antérieur à la porte). JAMAIS compté
//                     vert ; bloquant seulement en polyéthisme `strict`
//                     (evaluator.ts dit pourquoi, et ce que « bloquant » fait) ;
//   · `rien_trouve` — l'outil a tourné et n'a rien trouvé, ou il n'y avait rien
//                     à lire (aucune ligne ajoutée, aucun lockfile touché).
//
// Chaque état porte une RAISON typée (`ETATS_PAR_RAISON_PORTE`), jamais une
// phrase : même discipline que les validations du bac.
//
// ─── LES OUTILS, INVOQUÉS, JAMAIS LIÉS ───────────────────────────────────────
//
//   · secrets : Betterleaks (MIT), le successeur de Gitleaks par son auteur —
//     Gitleaks se déclare « feature complete », correctifs de sécurité
//     seulement. Lancé avec `--redact` : la VALEUR ne sort jamais de l'outil ;
//     le nœud la relit dans sa propre copie du diff, aux colonnes rapportées,
//     pour la caviarder partout où elle partirait au hub ;
//   · dépendances : osv-scanner (Apache-2.0), sur la BASE et sur la TÊTE des
//     lockfiles que la production touche. Seules les vulnérabilités
//     INTRODUITES comptent : un lockfile déjà vulnérable ferait sinon boucler
//     les corrections jusqu'à `MAX_ATTEMPTS`, pour une faute que l'agent n'a
//     pas commise.
//
// osv-scanner interroge osv.dev EN LIGNE, et c'est un choix (docs) : la base
// hors ligne de npm pèse 217 Mo (`npm/all.zip`, 217 394 349 octets le 4
// octobre), à retélécharger pour rester à jour, et le bac n'a ni disque
// persistant ni mémoire pour elle (racine en lecture seule, /tmp de 512 Mo,
// 2 Go). CE QUI PART À api.osv.dev, et seulement quand la production touche
// un fichier de dépendances (`porte-securite-dependances.ts`, qui le décide) :
// l'écosystème, le nom et la version des paquets qu'elle INTRODUIT, résolus
// depuis un registre public connu, et les versions de la base de ces mêmes
// paquets. Jamais un commit, un chemin, un paquet d'un registre privé que le
// lockfile nomme, ni un paquet que la production n'a pas changé. LIMITE :
// `go.mod`, NuGet, Maven et Conan ne nomment pas leur registre — un paquet
// privé y est indiscernable, et son nom part.
//
// Module PUR : aucune I/O. Le nœud (`node-client/porte-securite.ts`) écrit le
// miroir, lance les outils et lit leurs rapports avec ces fonctions ; la Reine
// revalide ce qui traverse le réseau et le journal (`porteSecuriteDepuis`).

import { champSurUneLigne } from './donnees-non-fiables.js';
import { nomDeFichier } from './porte-securite-dependances.js';

export const VOLETS_PORTE = ['secrets', 'dependances'] as const;
export type VoletPorte = (typeof VOLETS_PORTE)[number];

/** L'outil de chaque volet. */
export const OUTIL_DU_VOLET = {
  secrets: 'betterleaks',
  dependances: 'osv-scanner',
} as const satisfies Record<VoletPorte, string>;
export type OutilPorte = (typeof OUTIL_DU_VOLET)[VoletPorte];

/**
 * Les versions que `docker/agents/Dockerfile` épingle (version ET SHA-256 des
 * binaires officiels). Un banc relit le Dockerfile contre cette table : le
 * docteur ne conseille pas une version que l'image ne porte plus.
 */
export const VERSION_EPINGLEE: Readonly<Record<OutilPorte, string>> = {
  betterleaks: '1.9.0',
  'osv-scanner': '2.6.0',
};

/**
 * Où chaque outil publie ses binaires et le fichier de leurs empreintes
 * SHA-256 : ce que l'image télécharge et vérifie, et ce que `hive doctor`
 * conseille à un hôte qui les lance lui-même (bubblewrap, ou sans bac).
 */
export const PUBLICATION_OUTIL: Readonly<
  Record<OutilPorte, { depot: string; empreintes: string }>
> = {
  betterleaks: { depot: 'betterleaks/betterleaks', empreintes: 'checksums.txt' },
  'osv-scanner': { depot: 'google/osv-scanner', empreintes: 'osv-scanner_SHA256SUMS' },
};

/**
 * L'étiquette que `docker/agents/Dockerfile` pose sur l'image qui porte les
 * outils, après les avoir installés ET vérifiés : `hive doctor` la lit sans
 * rien lancer dans l'image. Absente, l'image a été construite avant eux.
 */
export const ETIQUETTE_PORTE = 'hive.porte-securite';
/** Sa valeur pour les versions épinglées : `betterleaks=1.9.0 osv-scanner=2.6.0`. */
export const VALEUR_ETIQUETTE_PORTE = Object.entries(VERSION_EPINGLEE)
  .map(([outil, version]) => `${outil}=${version}`)
  .join(' ');

export type EtatPorte = 'constat' | 'non_verifie' | 'rien_trouve';

/** Chaque raison, et l'état qu'elle autorise — un couple hors table est refusé. */
export const ETATS_PAR_RAISON_PORTE = {
  /** L'outil (ou les motifs du caviardage de Hive) a trouvé quelque chose. */
  trouve: ['constat'],
  /** Le diff n'ajoute aucune ligne : aucun secret ne peut y être entré. */
  aucun_ajout: ['rien_trouve'],
  /** Aucun lockfile touché : aucune dépendance n'a pu changer de version. */
  aucun_lockfile: ['rien_trouve'],
  /** L'outil a tourné jusqu'au bout et n'a rien trouvé d'introduit. */
  analyse_propre: ['rien_trouve'],
  /** Le binaire ne se lance pas là où la porte tourne (bac, ou hôte). */
  outil_absent: ['non_verifie'],
  /** Il s'est lancé et n'a pas rendu de rapport lisible (osv.dev injoignable…). */
  outil_en_echec: ['non_verifie'],
  delai: ['non_verifie'],
  annule: ['non_verifie'],
  /** Un lockfile touché, et pas de commit de base pour comparer. */
  sans_base: ['non_verifie'],
  /**
   * Le lockfile de la BASE ne se lit pas (absent du commit, mal formé) : rien à
   * quoi comparer. Celui de la TÊTE illisible, lui, est un défaut de la
   * production — un constat (`ConstatLockfileIllisible`).
   */
  lockfile_illisible: ['non_verifie'],
  /**
   * osv.dev injoignable : l'extraction a tourné, l'interrogation non (mesuré :
   * sortie 127, « api.osv.dev » dans l'erreur).
   */
  osv_injoignable: ['non_verifie'],
  /**
   * Des paquets introduits, et aucun d'interrogeable — source que le lockfile
   * ne dit pas publique, version non épinglée : rien n'est parti à osv.dev,
   * rien n'a été vérifié.
   */
  sources_non_publiques: ['non_verifie'],
  /** Une erreur inattendue du nœud a interrompu la porte. */
  interrompue: ['non_verifie'],
  /**
   * Non examinées : la production a ÉCHOUÉ. Ses secrets, si — son diff part
   * au hub comme un autre —, ses dépendances non : rien n'en sera livré.
   */
  production_en_echec: ['non_verifie'],
  /**
   * Non examinées : le diff n'est pas celui de l'arbre de la tâche (un
   * adaptateur qui rend le sien) — il n'y a aucun lockfile d'après à lire.
   */
  diff_hors_arbre: ['non_verifie'],
  /**
   * Le résultat n'a apporté AUCUN rapport — nœud antérieur à la porte, ou
   * production arrêtée avant elle. Posé par la Reine.
   */
  rapport_absent: ['non_verifie'],
  /**
   * Le volet que le nœud a envoyé est MAL FORMÉ : la Reine l'a refusé à la
   * réception — lui seul, pas l'autre volet — et l'a journalisé
   * (`security_gate_rejected`). Posé par la Reine.
   */
  rapport_rejete: ['non_verifie'],
} as const satisfies Record<string, readonly EtatPorte[]>;

export type RaisonPorte = keyof typeof ETATS_PAR_RAISON_PORTE;

/** Une raison, dite dans les deux langues — un seul endroit pour ses mots. */
export const DIRE_RAISON_PORTE: Readonly<Record<RaisonPorte, readonly [string, string]>> = {
  trouve: ['constat', 'finding'],
  aucun_ajout: ['aucune ligne ajoutée', 'no added line'],
  aucun_lockfile: ['aucun lockfile touché', 'no lockfile touched'],
  analyse_propre: ['rien trouvé', 'nothing found'],
  outil_absent: ['outil absent', 'tool missing'],
  outil_en_echec: ['outil en échec, aucun rapport lisible', 'tool failed, no readable report'],
  delai: ['délai dépassé', 'timed out'],
  annule: ['annulée', 'cancelled'],
  sans_base: ['aucun commit de base pour comparer', 'no base commit to compare with'],
  lockfile_illisible: [
    'lockfile de la base illisible — rien à quoi comparer',
    'base lockfile unreadable — nothing to compare with',
  ],
  osv_injoignable: [
    'api.osv.dev injoignable depuis le nœud — ouvrez-lui la sortie HTTPS vers api.osv.dev:443, ou posez HTTPS_PROXY (`hive doctor` l’éprouve)',
    'api.osv.dev unreachable from the node — allow outbound HTTPS to api.osv.dev:443, or set HTTPS_PROXY (`hive doctor` checks it)',
  ],
  sources_non_publiques: [
    'aucun paquet introduit n’est interrogeable (source non publique, ou version non épinglée) — rien n’a été vérifié',
    'no introduced package can be queried (non-public source, or unpinned version) — nothing was verified',
  ],
  interrompue: ['erreur du nœud', 'node error'],
  production_en_echec: [
    'non examinées : la production a échoué',
    'not examined: the production failed',
  ],
  diff_hors_arbre: [
    'non examinées : le diff ne vient pas de l’arbre de la tâche',
    'not examined: the diff does not come from the task tree',
  ],
  rapport_absent: [
    'aucun rapport du nœud (nœud antérieur à la porte, ou production arrêtée avant elle)',
    'no report from the node (node older than the gate, or production stopped before it)',
  ],
  rapport_rejete: [
    'rapport du nœud refusé à la réception, mal formé — voir le journal',
    'node report refused on receipt, malformed — see the journal',
  ],
};

/** La règle des constats que le caviardage du nœud aurait réécrits EN SILENCE. */
export const REGLE_CAVIARDAGE_HIVE = 'hive-caviardage';

export interface ConstatSecret {
  /** La règle qui l'a reconnu (`aws-access-token`, `hive-caviardage`…). Jamais la valeur. */
  regle: string;
  /** Le fichier d'après, tel que le diff le nomme. */
  fichier: string;
  /** La ligne, dans le fichier d'après. */
  ligne: number;
}

/** Une vulnérabilité que la tête introduit. */
export interface ConstatVulnerabilite {
  genre: 'vulnerabilite';
  paquet: string;
  version: string;
  ecosysteme: string;
  /** L'avis OSV (`GHSA-…`, `PYSEC-…`, `MAL-…`). */
  avis: string;
  /** Ses alias (`CVE-…`), bornés. */
  alias: string[];
  /** `CRITICAL`, `HIGH`… ou un score CVSS ; `null` quand la base n'en dit rien. */
  gravite: string | null;
  /** Le résumé de l'avis — un texte TIERS, borné, sur une ligne. */
  resume: string;
  /** Le lockfile d'après qui l'introduit. */
  fichier: string;
}

/**
 * Un lockfile que la production laisse ILLISIBLE : remplacé par un lien ou
 * par autre chose qu'un fichier (`pas_un_fichier`), ou qu'osv-scanner ne sait
 * plus lire (`mal_forme`). Un défaut de la production — `npm ci` le refuserait
 * aussi —, pas une panne d'outil : il ne doit plus aveugler tout le volet.
 */
export interface ConstatLockfileIllisible {
  genre: 'lockfile_illisible';
  fichier: string;
  motif: 'pas_un_fichier' | 'mal_forme';
}

export type ConstatDependance = ConstatVulnerabilite | ConstatLockfileIllisible;

export interface Volet<C> {
  etat: EtatPorte;
  raison: RaisonPorte;
  /** L'outil qui a tourné, et la version qu'il a dite. Absent : il n'a pas tourné. */
  outil?: { nom: OutilPorte; version: string };
  /** Non vides si et seulement si `constat` ; au plus `MAX_CONSTATS_PORTE`. */
  constats: C[];
  /** Combien il y en avait avant la borne. */
  total: number;
  /**
   * Volet dépendances : les paquets introduits qui ne sont PAS partis à
   * osv.dev — source locale, git, registre privé ou non nommé par le
   * lockfile, version non épinglée. Jamais comptés verts. Absent : zéro.
   */
  nonInterroges?: number;
}

/** Le rapport qu'un nœud joint à son `task_result`. */
export interface PorteSecurite {
  secrets: Volet<ConstatSecret>;
  dependances: Volet<ConstatDependance>;
}

/** Ce qui traverse le réseau, au plus, par volet : le compte dit le reste. */
export const MAX_CONSTATS_PORTE = 20;

export const BORNES_PORTE = {
  fichier: 300,
  paquet: 214,
  version: 128,
  resume: 200,
  alias: 5,
} as const;

/** Les deux volets, sans rapport : jamais vert. */
export const PORTE_SANS_RAPPORT: PorteSecurite = {
  secrets: { etat: 'non_verifie', raison: 'rapport_absent', constats: [], total: 0 },
  dependances: { etat: 'non_verifie', raison: 'rapport_absent', constats: [], total: 0 },
};

/** Un volet sans constat, dans l'état que sa raison impose. */
export function voletSans<C>(
  raison: Exclude<RaisonPorte, 'trouve'>,
  outil?: { nom: OutilPorte; version: string },
): Volet<C> {
  return {
    etat: ETATS_PAR_RAISON_PORTE[raison][0],
    raison,
    ...(outil ? { outil } : {}),
    constats: [],
    total: 0,
  };
}

/** Un volet qui a trouvé — borné, le compte gardé. */
export function voletAvec<C>(
  constats: readonly C[],
  outil?: { nom: OutilPorte; version: string },
): Volet<C> {
  return {
    etat: 'constat',
    raison: 'trouve',
    ...(outil ? { outil } : {}),
    constats: constats.slice(0, MAX_CONSTATS_PORTE),
    total: constats.length,
  };
}

// ─── Les fichiers que la porte lit ───────────────────────────────────────────

/**
 * Le nom sous lequel un fichier du diff est écrit dans le miroir : son seul
 * dernier segment, réduit à des caractères sûrs. Jamais son chemin : un nom
 * choisi par l'agent ne décide pas où l'on écrit, et un `.gitleaks.toml`
 * ajouté par lui reste un fichier comme un autre, dans un dossier à lui.
 */
export function nomDansLeMiroir(chemin: string): string {
  const nom = nomDeFichier(chemin)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(-100);
  return nom === '' || /^\.+$/.test(nom) ? 'fichier' : nom;
}

/** Un texte tiers, sur une ligne, sans caractère de contrôle, borné. */
export function texteAffichable(texte: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return champSurUneLigne(texte.replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, '?'), max);
}

/** La version que `<outil> --version` imprime (« betterleaks version 1.9.0 », « osv-scanner version: 2.6.0 »). */
export function versionDeSortie(sortie: string): string | null {
  return /\bversion:?\s+v?(\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,24})/.exec(sortie)?.[1] ?? null;
}

// ─── Le rapport de Betterleaks ───────────────────────────────────────────────

/**
 * La configuration que la porte IMPOSE à Betterleaks (`--config`) : ses
 * règles par défaut, nommées (`useDefault`), SANS leur préfiltre.
 *
 * MESURÉ sur 1.9.0 : le préfiltre par défaut écarte d'office, par leur NOM, les
 * lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
 * `npm-shrinkwrap.json`, `Pipfile.lock`, `poetry.lock`, `gradle.lockfile`),
 * `go.mod` et `go.sum`, les images (`*.svg`), les `*.min.js` des bibliothèques
 * connues… Le miroir garde le nom de chaque fichier : une clé ajoutée là n'était
 * jamais lue, et partait au hub en clair. Sur un corpus de 20 clés réparties
 * dans ces fichiers : 12 constats avec le préfiltre, 20 sans. La porte ne lit
 * que les lignes AJOUTÉES — aucun fichier n'y est trop gros pour être lu.
 */
export const CONFIG_BETTERLEAKS = "prefilter = '''false'''\n\n[extend]\nuseDefault = true\n";

/**
 * La seule confiance que la porte retient (`--confidence high`).
 *
 * MESURÉ sur 1.9.0, sur l'arbre de Hive lui-même : 90 constats, dont 88 des
 * règles génériques de confiance basse ou moyenne (`generic-password`,
 * `generic-credential-uri`, `generic-api-key`) — l'`autoComplete={… :
 * 'new-password'}` d'un formulaire, les mots de passe de fixtures. Chacun
 * demandait une correction que le producteur ne pouvait pas faire, en boucle,
 * qu'aucune approbation ne levait. En confiance haute : 2 (deux jetons de
 * fixtures à la forme réelle), et les 20 clés du corpus toutes trouvées. Les
 * règles de confiance moyenne propres à un fournisseur (Discord, Dropbox,
 * Sentry…) ne sont plus lues : c'est le prix, dit dans la documentation.
 */
export const CONFIANCE_BETTERLEAKS = 'high';

/**
 * Une forme de secret que le nœud peut réécrire PARTOUT — diff, logs, texte
 * final — sans toucher une ligne légitime : un jeton (au moins 16 caractères,
 * aucun blanc), jamais un mot ni une phrase. L'en-tête `-----BEGIN … KEY-----`
 * d'une clé PEM, un `new-password` lu comme un mot de passe : réécrits, ils
 * corrompraient chaque ligne qui les porte, et un `forcer` livrerait la
 * corruption. Une clé PEM se caviarde par ses lignes de base64 ; une fin de
 * moins de 16 caractères reste, et c'est le prix de cette garantie.
 */
export function formeCaviardable(forme: string): boolean {
  return forme.length >= 16 && !/\s/.test(forme);
}

/** Où une correspondance se tient dans le fichier scanné, et sous quelle règle. */
export interface PositionSecret {
  regle: string;
  debutLigne: number;
  finLigne: number;
  /** Colonnes en OCTETS UTF-8, base 1, fin incluse (mesuré sur 1.9.0). */
  debutColonne: number;
  finColonne: number;
  /** La correspondance caviardée par l'outil : `REDACTED` y tient la place du secret. */
  correspondance: string;
}

/** Ce que la porte garde d'un constat de Betterleaks (`--redact`). */
export interface TrouvailleSecret extends PositionSecret {
  /** Le fichier, tel que l'outil le nomme (un chemin du miroir). */
  fichier: string;
  /**
   * La confiance de sa règle (`Attributes.confidence` : `high`, `medium`,
   * `low`), ou `null` si le rapport ne la dit pas. Ses composants en héritent :
   * ils n'en portent pas (mesuré).
   */
  confiance: string | null;
  /**
   * Les COMPOSANTS d'une règle composite (`ComponentSets`), chacun à sa place.
   * MESURÉ sur 1.9.0 : `aws-access-token` ne signale l'identifiant `AKIA…`
   * qu'apparié à sa clé secrète, et c'est le composant `aws-secret-access-key`
   * — sur sa propre ligne — qui la situe. Les ignorer laissait partir au hub,
   * en clair, la seule moitié qui soit vraiment secrète.
   */
  composants: PositionSecret[];
}

const REGLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const entier = (v: unknown, min: number, max = 100_000_000): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;

/** Une correspondance du rapport (constat ou composant), relue champ par champ. */
function positionDepuis(v: unknown): PositionSecret | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const { RuleID: regle, StartLine: debut, EndLine: fin, StartColumn: de, EndColumn: a } = o;
  if (typeof regle !== 'string' || !REGLE.test(regle) || typeof o.Match !== 'string') return null;
  if (!entier(debut, 1) || !entier(fin, debut) || !entier(de, 1) || !entier(a, 0)) return null;
  return {
    regle,
    debutLigne: debut,
    finLigne: fin,
    debutColonne: de,
    finColonne: a,
    correspondance: o.Match,
  };
}

/**
 * Le rapport JSON de Betterleaks (`--report-format json`), relu champ par
 * champ ; `null` s'il n'en est pas un. Un tableau vide est un rapport — c'est
 * « rien trouvé » (1.9.0 l'écrit `[]`, plus `null`). Un composant illisible
 * rend le rapport entier illisible : un secret qu'on ne sait pas situer est un
 * secret qu'on ne saurait pas caviarder.
 */
export function lireRapportBetterleaks(texte: string): TrouvailleSecret[] | null {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!Array.isArray(brut)) return null;
  const trouvailles: TrouvailleSecret[] = [];
  for (const b of brut as unknown[]) {
    const position = positionDepuis(b);
    const {
      File: fichier,
      ComponentSets: ensembles,
      Attributes: attributs,
    } = b as Record<string, unknown>;
    if (!position || typeof fichier !== 'string') return null;
    const confidence = (attributs as Record<string, unknown> | null | undefined)?.confidence;
    const confiance = typeof confidence === 'string' ? confidence : null;
    if (ensembles !== undefined && ensembles !== null && !Array.isArray(ensembles)) return null;
    const composants: PositionSecret[] = [];
    for (const ensemble of (ensembles ?? []) as unknown[]) {
      const membres = (ensemble as Record<string, unknown> | null)?.components;
      if (!Array.isArray(membres)) return null;
      for (const membre of membres as unknown[]) {
        const composant = positionDepuis(membre);
        if (!composant) return null;
        composants.push(composant);
      }
    }
    trouvailles.push({ ...position, fichier, confiance, composants });
  }
  return trouvailles;
}

/** Ce que `--redact` met à la place du secret dans `Match`. */
const MARQUE_REDACT = 'REDACTED';

/**
 * La VALEUR d'un secret trouvé, relue dans les lignes que le nœud a lui-même
 * écrites — `null` si elles ne la contiennent pas.
 *
 * L'outil tourne avec `--redact` : son rapport ne porte jamais la valeur, et
 * c'est voulu (il est écrit dans le répertoire de la tâche). Mais le nœud doit
 * la connaître pour la caviarder là où elle partirait au hub : le diff, les
 * logs, le texte final. Il la relit donc aux colonnes rapportées — en octets
 * UTF-8 —, puis retire ce que `Match` garde autour de `REDACTED` (le guillemet
 * fermant d'une clé Stripe, le `SecretAccessKey = '` d'une clé AWS).
 */
export function valeurDuSecret(
  lignes: ReadonlyMap<number, string>,
  t: PositionSecret,
): string | null {
  const encodeur = new TextEncoder();
  const morceaux: string[] = [];
  for (let n = t.debutLigne; n <= t.finLigne; n++) {
    const ligne = lignes.get(n);
    if (ligne === undefined) return null;
    const octets = encodeur.encode(ligne);
    const debut = n === t.debutLigne ? t.debutColonne - 1 : 0;
    const fin = n === t.finLigne ? t.finColonne : octets.length;
    if (debut > octets.length || fin > octets.length || fin < debut) return null;
    morceaux.push(new TextDecoder().decode(octets.slice(debut, fin)));
  }
  let valeur = morceaux.join('\n');
  const [avant, apres, ...reste] = t.correspondance.split(MARQUE_REDACT);
  if (avant !== undefined && apres !== undefined && reste.length === 0) {
    if (
      valeur.startsWith(avant) &&
      valeur.endsWith(apres) &&
      valeur.length > avant.length + apres.length
    ) {
      valeur = valeur.slice(avant.length, valeur.length - apres.length);
    }
  }
  return valeur === '' ? null : valeur;
}

// ─── Le rapport d'osv-scanner ────────────────────────────────────────────────

export interface VulnerabiliteLue {
  id: string;
  alias: string[];
  resume: string;
  gravite: string | null;
}

export interface PaquetLu {
  nom: string;
  version: string;
  ecosysteme: string;
  vulnerabilites: VulnerabiliteLue[];
}

export interface SourceLue {
  /** Le chemin que l'outil donne : absolu, de l'hôte ou du bac. */
  chemin: string;
  paquets: PaquetLu[];
}

const AVIS = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const GRAVITE = /^(?:[A-Za-z]{1,16}|\d{1,2}(?:\.\d{1,2})?)$/;
const ECOSYSTEME = /^[A-Za-z0-9][A-Za-z0-9.:_ -]{0,63}$/;

/** La gravité qu'un avis déclare, ou le pire score de son groupe d'alias. */
function graviteDe(v: Record<string, unknown>, groupes: unknown): string | null {
  const specifique = (v.database_specific as Record<string, unknown> | undefined)?.severity;
  if (typeof specifique === 'string' && GRAVITE.test(specifique)) return specifique;
  if (!Array.isArray(groupes)) return null;
  for (const g of groupes as unknown[]) {
    const groupe = g as Record<string, unknown> | null;
    const ids = groupe?.ids;
    const score = groupe?.max_severity;
    if (
      Array.isArray(ids) &&
      ids.includes(v.id) &&
      typeof score === 'string' &&
      GRAVITE.test(score)
    ) {
      return score;
    }
  }
  return null;
}

/**
 * Le rapport JSON d'osv-scanner (`--format json`), réduit à ce que la porte
 * compare ; `null` s'il n'en est pas un.
 *
 * ATTENTION, ET C'EST MESURÉ : osv.dev injoignable, osv-scanner sort en 127 et
 * écrit quand même un rapport VALIDE, `{"results": []}`. Lu seul, il dirait
 * « rien trouvé ». C'est le CODE DE SORTIE qui décide (`node-client/porte-
 * securite.ts`) ; ce lecteur ne dit que la forme.
 */
export function lireRapportOsv(texte: string): SourceLue[] | null {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  const resultats = (brut as Record<string, unknown> | null)?.results;
  if (!Array.isArray(resultats)) return null;
  const sources: SourceLue[] = [];
  for (const r of resultats as unknown[]) {
    const resultat = r as Record<string, unknown> | null;
    const chemin = (resultat?.source as Record<string, unknown> | undefined)?.path;
    const paquets = resultat?.packages;
    if (typeof chemin !== 'string' || !Array.isArray(paquets)) return null;
    const lus: PaquetLu[] = [];
    for (const p of paquets as unknown[]) {
      const paquet = p as Record<string, unknown> | null;
      const ident = paquet?.package as Record<string, unknown> | undefined;
      const vulns = paquet?.vulnerabilities ?? [];
      if (
        typeof ident?.name !== 'string' ||
        typeof ident.version !== 'string' ||
        typeof ident.ecosystem !== 'string' ||
        !Array.isArray(vulns)
      ) {
        return null;
      }
      const vulnerabilites: VulnerabiliteLue[] = [];
      for (const v of vulns as unknown[]) {
        const vuln = v as Record<string, unknown> | null;
        if (typeof vuln?.id !== 'string' || !AVIS.test(vuln.id)) return null;
        const alias = Array.isArray(vuln.aliases)
          ? (vuln.aliases as unknown[]).filter(
              (a): a is string => typeof a === 'string' && AVIS.test(a),
            )
          : [];
        vulnerabilites.push({
          id: vuln.id,
          alias: alias.slice(0, BORNES_PORTE.alias),
          resume:
            typeof vuln.summary === 'string'
              ? texteAffichable(vuln.summary, BORNES_PORTE.resume)
              : '',
          gravite: graviteDe(vuln, paquet?.groups),
        });
      }
      lus.push({
        nom: ident.name,
        version: ident.version,
        ecosysteme: ident.ecosystem,
        vulnerabilites,
      });
    }
    sources.push({ chemin, paquets: lus });
  }
  return sources;
}

/**
 * Les vulnérabilités que la TÊTE introduit : présentes dans un lockfile
 * d'après, absentes — pour le même paquet du même écosystème — de TOUS les
 * lockfiles d'avant que la production a touchés.
 *
 * Sans la version dans la clé : passer lodash de 4.17.15 à 4.17.20 sans
 * corriger un avis qu'il portait déjà n'introduit rien ; un lockfile renommé
 * non plus. Une vulnérabilité NOUVELLE pour ce paquet — une montée qui en
 * apporte une, un paquet ajouté — est introduite.
 */
export function vulnerabilitesIntroduites(
  base: readonly SourceLue[],
  tete: readonly { fichier: string; source: SourceLue }[],
): ConstatVulnerabilite[] {
  const cle = (p: PaquetLu, id: string): string => `${p.ecosysteme}\u0000${p.nom}\u0000${id}`;
  const connues = new Set(
    base.flatMap((s) => s.paquets.flatMap((p) => p.vulnerabilites.map((v) => cle(p, v.id)))),
  );
  const introduites: ConstatVulnerabilite[] = [];
  for (const { fichier, source } of tete) {
    for (const p of source.paquets) {
      for (const v of p.vulnerabilites) {
        const k = cle(p, v.id);
        if (connues.has(k)) continue;
        connues.add(k);
        introduites.push({
          genre: 'vulnerabilite',
          // Jamais vides : la Reine refuserait le volet entier (`texteBorne`).
          paquet: texteAffichable(p.nom, BORNES_PORTE.paquet) || '?',
          version: texteAffichable(p.version, BORNES_PORTE.version) || '?',
          ecosysteme: ECOSYSTEME.test(p.ecosysteme) ? p.ecosysteme : '?',
          avis: v.id,
          alias: v.alias,
          gravite: v.gravite,
          resume: v.resume,
          fichier: texteAffichable(fichier, BORNES_PORTE.fichier) || '(sans nom)',
        });
      }
    }
  }
  return introduites;
}

// ─── Ce qui traverse le réseau et le journal ─────────────────────────────────

const VERSION_OUTIL = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,24}$/;

/** Un texte déjà mis en forme par `texteAffichable` — rien d'autre ne passe. */
const texteBorne = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v !== '' && texteAffichable(v, max) === v;

const enregistrement = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function constatSecretDepuis(v: unknown): ConstatSecret | null {
  const c = enregistrement(v);
  if (!c || typeof c.regle !== 'string' || !REGLE.test(c.regle)) return null;
  if (!texteBorne(c.fichier, BORNES_PORTE.fichier) || !entier(c.ligne, 1)) return null;
  return { regle: c.regle, fichier: c.fichier, ligne: c.ligne };
}

function constatDependanceDepuis(v: unknown): ConstatDependance | null {
  const c = enregistrement(v);
  if (!c) return null;
  if (c.genre === 'lockfile_illisible') {
    const { fichier, motif } = c;
    if (!texteBorne(fichier, BORNES_PORTE.fichier)) return null;
    if (motif !== 'pas_un_fichier' && motif !== 'mal_forme') return null;
    return { genre: 'lockfile_illisible', fichier, motif };
  }
  if (c.genre !== 'vulnerabilite') return null;
  const { paquet, version, ecosysteme, avis, alias, gravite, resume, fichier } = c;
  if (
    !texteBorne(paquet, BORNES_PORTE.paquet) ||
    !texteBorne(version, BORNES_PORTE.version) ||
    typeof ecosysteme !== 'string' ||
    !(ECOSYSTEME.test(ecosysteme) || ecosysteme === '?') ||
    typeof avis !== 'string' ||
    !AVIS.test(avis) ||
    !Array.isArray(alias) ||
    alias.length > BORNES_PORTE.alias ||
    !(alias as unknown[]).every((a) => typeof a === 'string' && AVIS.test(a)) ||
    !(gravite === null || (typeof gravite === 'string' && GRAVITE.test(gravite))) ||
    !(resume === '' || texteBorne(resume, BORNES_PORTE.resume)) ||
    !texteBorne(fichier, BORNES_PORTE.fichier)
  ) {
    return null;
  }
  return {
    genre: 'vulnerabilite',
    paquet,
    version,
    ecosysteme,
    avis,
    alias: [...(alias as string[])],
    gravite,
    resume,
    fichier,
  };
}

function estRaison(v: unknown): v is RaisonPorte {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ETATS_PAR_RAISON_PORTE, v);
}

function voletDepuis<C>(
  v: unknown,
  volet: VoletPorte,
  constatDepuis: (c: unknown) => C | null,
): Volet<C> | null {
  const o = enregistrement(v);
  if (!o || !estRaison(o.raison)) return null;
  const { raison, total } = o;
  const etat = ETATS_PAR_RAISON_PORTE[raison][0];
  if (o.etat !== etat || !Array.isArray(o.constats)) return null;
  if (o.constats.length > MAX_CONSTATS_PORTE) return null;
  const constats: C[] = [];
  for (const brut of o.constats as unknown[]) {
    const c = constatDepuis(brut);
    if (!c) return null;
    constats.push(c);
  }
  // Un constat sans rien de trouvé, ou des trouvailles sous un « rien » : un
  // nœud qui enverrait l'un ou l'autre ment ou bogue — refusé en entier.
  if ((etat === 'constat') !== constats.length > 0) return null;
  if (!entier(total, constats.length, 1_000_000)) return null;
  // Un compte de paquets non interrogés : volet dépendances seulement, jamais zéro écrit.
  const { nonInterroges } = o;
  if (
    nonInterroges !== undefined &&
    (volet !== 'dependances' || !entier(nonInterroges, 1, 1_000_000))
  ) {
    return null;
  }
  const outil = o.outil === undefined ? undefined : enregistrement(o.outil);
  if (
    outil === null ||
    (outil !== undefined &&
      (outil.nom !== OUTIL_DU_VOLET[volet] ||
        typeof outil.version !== 'string' ||
        !VERSION_OUTIL.test(outil.version)))
  ) {
    return null;
  }
  return {
    etat,
    raison,
    ...(outil ? { outil: { nom: OUTIL_DU_VOLET[volet], version: String(outil.version) } } : {}),
    constats,
    total,
    ...(typeof nonInterroges === 'number' ? { nonInterroges } : {}),
  };
}

/** Ce que la Reine relit d'un rapport : chaque volet reconstruit, ou refusé. */
export interface PorteRelue {
  porte: PorteSecurite;
  /** Les volets refusés — devenus `rapport_rejete`, et à journaliser. */
  rejetes: VoletPorte[];
}

/**
 * Le rapport d'un nœud, reconstruit champ par champ, VOLET PAR VOLET. Un volet
 * mal formé est refusé seul — il devient `rapport_rejete`, jamais un vert — et
 * l'autre volet tient : une dépendance mal écrite effaçait sinon le constat
 * d'un secret, et la production passait `accepted` hors de `strict`. Le
 * résultat qui le porte, lui, n'est jamais abandonné.
 */
export function porteSecuriteDepuis(v: unknown): PorteRelue {
  const o = enregistrement(v);
  const secrets = o ? voletDepuis(o.secrets, 'secrets', constatSecretDepuis) : null;
  const dependances = o ? voletDepuis(o.dependances, 'dependances', constatDependanceDepuis) : null;
  return {
    porte: {
      secrets: secrets ?? voletSans('rapport_rejete'),
      dependances: dependances ?? voletSans('rapport_rejete'),
    },
    rejetes: [
      ...(secrets ? [] : ['secrets' as const]),
      ...(dependances ? [] : ['dependances' as const]),
    ],
  };
}
