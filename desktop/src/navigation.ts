// Où la fenêtre a le droit d'aller — et ce qu'un lien `hive://` peut ouvrir.
//
// La fenêtre de l'app porte le jeton maître de la ruche (dans le
// `localStorage` de l'origine de la Reine). Elle ne navigue donc QUE vers
// cette origine et vers l'accueil local ; tout autre lien part au navigateur
// (`https:` seulement) ou nulle part. Un lien `hive://` n'ouvre qu'une ROUTE
// de l'écran — jamais une URL, jamais un chemin de fichier (ADR 0013 § 9, § 13).

/**
 * Le schéma des pages de la coquille (l'accueil) : un protocole PROPRE plutôt
 * que `file://` — le fusible `grantFileProtocolExtraPrivileges` éteint (ADR
 * 0013 § 13) refuse à `file://` la lecture de l'asar, et c'est la pratique que
 * recommande Electron. `bureau://app/<chemin>` sert `<coquille>/<chemin>`.
 */
export const SCHEMA_COQUILLE = 'bureau';
export const URL_ACCUEIL = `${SCHEMA_COQUILLE}://app/accueil/index.html`;
/**
 * Le schéma de l'Aperçu du Rayon dans l'app : un document servi par la
 * coquille (`protocole.ts`) plutôt qu'un `srcdoc`, qui hériterait la CSP de
 * l'écran et y perdrait ses scripts (csp.ts).
 */
export const SCHEMA_APERCU = 'apercu';
/** Les seuls dossiers de la coquille qu'une page peut lire. */
const DOSSIERS_SERVIS = new Set(['accueil', 'marque']);

/**
 * Le fichier de la coquille qu'une URL `bureau://app/…` désigne, en segments
 * relatifs — ou `null` : autre hôte, dossier non servi, `..`, encodage hostile.
 */
export function fichierDeCoquille(url: string): string[] | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEMA_COQUILLE}:` || u.hostname !== 'app') return null;
  let chemin: string;
  try {
    chemin = decodeURIComponent(u.pathname);
  } catch {
    return null;
  }
  const segments = chemin.split('/').filter((s) => s !== '');
  if (segments.some((s) => s === '..' || s === '.' || s.includes('\\') || s.includes('\0')))
    return null;
  if (segments.length < 2 || !DOSSIERS_SERVIS.has(segments[0] ?? '')) return null;
  return segments;
}

/** La fenêtre peut-elle charger cette URL ? */
export function navigationPermise(url: string, origineReine: string | null): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (origineReine !== null && u.origin === new URL(origineReine).origin) return true;
  // L'accueil : la page exacte, pas la coquille entière.
  return `${u.protocol}//${u.host}${u.pathname}` === URL_ACCUEIL;
}

/** Les hôtes de la boucle locale — `URL.hostname` garde les crochets d'IPv6. */
const BOUCLE_LOCALE = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Un lien que l'on confie au navigateur du système : `https:`, ou `http:` sur
 * la boucle locale — le « Plein écran » de l'atelier (noVNC, un autre port de
 * `127.0.0.1`). Le navigateur n'a pas le jeton : ouvrir une adresse locale
 * n'y expose rien.
 */
export function lienExterne(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && BOUCLE_LOCALE.has(u.hostname));
  } catch {
    return false;
  }
}

/** Ce qui compte pour choisir la page de la fenêtre (`Etat`, `etat.ts`). */
interface EtatPourPage {
  readonly erreur: object | null;
  readonly origine: string | null;
  readonly portChange: number | null;
  readonly agents: readonly { readonly nonConnecte: string | null }[] | null;
}

/**
 * L'accueil a-t-il quelque chose à dire AVANT Mission Control ? Aucun agent
 * connecté (la commande qui connecte chacun, la démo simulée) ou un port
 * changé. Montré une seconde puis remplacé, il ne disait rien (#532).
 */
export function accueilADire(s: EtatPourPage): boolean {
  return (
    s.portChange !== null || (s.agents !== null && s.agents.every((a) => a.nonConnecte !== null))
  );
}

/**
 * Où la fenêtre doit aller après un changement d'état — `null` : elle reste.
 *
 * Décidé sur les FAITS de l'état, pas sur les transitions : une erreur montre
 * l'accueil quelle que soit la route qui y a mené. La règle d'avant (« l'origine
 * vient de disparaître ET il y a une erreur ») ratait la mort qui suit une
 * relance — l'origine était déjà nulle, et la fenêtre restait sur une Reine
 * morte, sans « Réessayer » (#532).
 *
 * `origineMontree` : l'origine que la fenêtre affiche déjà. `accueilLu` : la
 * personne a quitté l'accueil d'elle-même (« Ouvrir Mission Control »).
 */
export function pageVoulue(
  s: EtatPourPage,
  origineMontree: string | null,
  accueilLu: boolean,
): 'accueil' | 'ecran' | null {
  if (s.erreur !== null) return 'accueil';
  if (s.origine === null || s.origine === origineMontree) return null;
  return accueilLu || !accueilADire(s) ? 'ecran' : null;
}

/** Une route de l'écran : segments `[a-z0-9-]`, sans `..`, sans encodage. */
const ROUTE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/i;

/**
 * La route (`#/…`) qu'ouvre un lien `hive://ouvrir/<route>`, ou `null`.
 *
 * `hive://ouvrir` ou `hive://ouvrir/` : l'accueil de l'écran (`#/`). Tout
 * autre hôte, un paramètre, un fragment, un caractère hors de la grammaire
 * d'une route : refusé.
 */
export function routeDepuisLien(lien: string): string | null {
  let u: URL;
  try {
    u = new URL(lien);
  } catch {
    return null;
  }
  if (u.protocol !== 'hive:' || u.hostname !== 'ouvrir') return null;
  if (u.search !== '' || u.hash !== '' || u.username !== '' || u.password !== '' || u.port !== '') {
    return null;
  }
  const route = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (route === '') return '#/';
  return ROUTE.test(route) ? `#/${route}` : null;
}

/** Le lien `hive://` d'une ligne de commande (second lancement, Windows/Linux). */
export function lienDansArgv(argv: readonly string[]): string | null {
  return argv.find((a) => a.startsWith('hive://')) ?? null;
}
