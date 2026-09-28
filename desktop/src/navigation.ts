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

/** Un lien que l'on confie au navigateur du système — `https:` seulement. */
export function lienExterne(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
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
