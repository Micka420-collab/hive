// LE COMPAGNON À SOI — l'image qu'une personne apporte, et où elle la range.
//
// ─── UNE IMAGE APPORTÉE EST UNE DONNÉE NON FIABLE ───────────────────────────
//
// Ce qui entre ici vient d'un fichier choisi par la personne, donc de
// n'importe où : une image « trouvée » peut être un SVG (du XML qui porte du
// script), une page HTML renommée en `.png`, ou un fichier de 40 Mo qui
// remplirait le stockage du navigateur. D'où trois règles, qui ne se
// contournent pas :
//
//   1. **Les OCTETS décident, pas l'étiquette.** `File.type` n'est que ce que
//      le système d'exploitation déduit de l'extension. Seules les signatures
//      PNG et WebP sont acceptées, lues dans le fichier lui-même — un SVG ou
//      une page HTML renommés échouent ici, quel que soit leur nom.
//   2. **Le type de l'URL vient de la signature.** La `data:` URL rangée est
//      reconstruite avec le type RECONNU, jamais avec celui qu'annonçait le
//      fichier : elle ne peut donc désigner qu'une image matricielle.
//   3. **L'affichage passe UNIQUEMENT par `<img src>`.** Jamais de SVG en
//      ligne, jamais de `innerHTML`, jamais d'URL en `background` : un `<img>`
//      n'exécute rien de ce qu'il affiche. Le nom, lui, est rendu comme TEXTE
//      par React.
//
// ─── RANGÉ DANS CE NAVIGATEUR, POUR CETTE PERSONNE ──────────────────────────
//
// Le compagnon est une préférence d'affichage : il ne quitte pas le poste, ne
// passe pas par la Reine, n'occupe aucune table. Une clé de `localStorage` par
// compte (`anonyme` sans session), plafonnée en taille et en nombre.
//
// Le stockage peut manquer (navigation privée, quota plein, accès bloqué) :
// CHAQUE lecture et écriture est sous `try/catch`, et un échec n'emporte rien —
// le compagnon choisi vit alors le temps de l'onglet, et l'écran le dit.
//
// Ce qu'on relit du stockage est RE-VALIDÉ comme une entrée : une autre
// version de cet écran, une extension ou une main dans les outils de
// développement a pu y écrire n'importe quoi.

/** Un fichier de plus ne sert pas un animal de 44 px — et le stockage est partagé. */
export const TAILLE_MAX_OCTETS = 150 * 1024;
/** Assez pour varier, trop peu pour saturer le stockage (3 × 150 Kio ≈ 600 Kio encodés). */
export const PERSO_MAX = 3;
export const NOM_MAX = 24;
/** Au-delà, chaque image d'une planche de 44 px devient illisible. */
export const IMAGES_MAX = 24;

export type TypeImage = 'image/png' | 'image/webp';

export const COMPAGNONS_INTEGRES = ['abeille', 'bourdon', 'osmie'] as const;
export type CompagnonIntegre = (typeof COMPAGNONS_INTEGRES)[number];

export interface CompagnonPerso {
  id: string;
  nom: string;
  /** `data:image/png;base64,…` ou `data:image/webp;base64,…` — rien d'autre. */
  image: string;
  /** Nombre d'images d'une planche horizontale ; 1 = image fixe. */
  images: number;
}

export interface ReglagesCompagnon {
  /** Un compagnon intégré, ou l'`id` d'un compagnon personnel. */
  choix: string;
  /** Rangé par la personne : seul le bouton pour le rappeler reste. */
  range: boolean;
  perso: CompagnonPerso[];
}

export const REGLAGES_PAR_DEFAUT: ReglagesCompagnon = { choix: 'abeille', range: false, perso: [] };

// ─── La validation d'un fichier apporté ──────────────────────────────────────

export type RefusImage = 'vide' | 'trop_lourd' | 'format';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Le type RÉEL d'une image, lu dans ses premiers octets — ou `null`.
 *
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  « RIFF » ···· « WEBP »
 *
 * Tout le reste est refusé, SVG et HTML compris : ce sont du texte, et leurs
 * premiers octets ne ressemblent à aucune des deux signatures.
 */
export function typeReconnu(octets: Uint8Array): TypeImage | null {
  if (PNG.every((b, i) => octets[i] === b)) return 'image/png';
  const ascii = (debut: number, fin: number) => String.fromCharCode(...octets.subarray(debut, fin));
  if (octets.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Le verdict sur un fichier : son type reconnu, ou la raison du refus. */
export function verifierImage(
  octets: Uint8Array,
): { ok: true; type: TypeImage } | { ok: false; refus: RefusImage } {
  if (octets.length === 0) return { ok: false, refus: 'vide' };
  if (octets.length > TAILLE_MAX_OCTETS) return { ok: false, refus: 'trop_lourd' };
  const type = typeReconnu(octets);
  return type ? { ok: true, type } : { ok: false, refus: 'format' };
}

/** Des octets déjà vérifiés → une `data:` URL au type RECONNU. */
export function urlDeDonnees(octets: Uint8Array, type: TypeImage): string {
  let binaire = '';
  // Par tranches : `String.fromCharCode(...tout)` dépasse la pile d'appel
  // bien avant 150 Kio.
  for (let i = 0; i < octets.length; i += 0x8000) {
    binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(binaire)}`;
}

/** Une `data:` URL acceptable à l'affichage : PNG ou WebP en base64, et bornée. */
const URL_IMAGE = /^data:image\/(png|webp);base64,[A-Za-z0-9+/]+=*$/;
const URL_MAX = Math.ceil((TAILLE_MAX_OCTETS * 4) / 3) + 40;
export function urlImageSure(url: unknown): url is string {
  return typeof url === 'string' && url.length <= URL_MAX && URL_IMAGE.test(url);
}

/** Le nom, nettoyé : caractères de contrôle retirés, espaces resserrés, borné. */
export function nomPropre(brut: string): string {
  return (
    brut
      // Les blancs D'ABORD : un retour à la ligne est aussi un caractère de
      // contrôle, et le retirer avant collerait les deux mots qu'il séparait.
      .replace(/\s+/g, ' ')
      // eslint-disable-next-line no-control-regex -- c'est précisément ce qu'on retire
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
      .trim()
      .slice(0, NOM_MAX)
  );
}

/** Le nombre d'images d'une planche : entier de 1 à `IMAGES_MAX`, sinon `null`. */
export function nombreImages(brut: unknown): number | null {
  const n = typeof brut === 'string' && brut.trim() === '' ? 1 : Number(brut);
  return Number.isInteger(n) && n >= 1 && n <= IMAGES_MAX ? n : null;
}

// ─── Le rangement dans le navigateur ─────────────────────────────────────────

const PREFIXE_CLE = 'hive.compagnon.v1.';

/** La clé d'une personne ; `anonyme` sans session. L'id vient de la Reine. */
export function cleDuCompagnon(userId: string | null | undefined): string {
  return PREFIXE_CLE + (userId && userId.length <= 128 ? userId : 'anonyme');
}

function relirePerso(brut: unknown): CompagnonPerso | null {
  if (!brut || typeof brut !== 'object') return null;
  const { id, nom, image, images } = brut as Record<string, unknown>;
  if (typeof id !== 'string' || !/^perso-[\w-]{1,40}$/.test(id)) return null;
  if (typeof nom !== 'string' || nomPropre(nom) === '' || !urlImageSure(image)) return null;
  const n = nombreImages(images);
  return n === null ? null : { id, nom: nomPropre(nom), image, images: n };
}

/**
 * Les réglages d'une personne. Rien, illisible ou inaccessible → les réglages
 * par défaut : un compagnon perdu n'est jamais une panne de l'écran.
 */
export function lireReglages(
  cle: string,
  stockage: Storage | null = stockageLocal(),
): ReglagesCompagnon {
  try {
    const brut = stockage?.getItem(cle);
    if (!brut) return REGLAGES_PAR_DEFAUT;
    const lu = JSON.parse(brut) as Record<string, unknown>;
    const perso = (Array.isArray(lu.perso) ? lu.perso : [])
      .map(relirePerso)
      .filter((p): p is CompagnonPerso => p !== null)
      .slice(0, PERSO_MAX);
    const choix =
      typeof lu.choix === 'string' &&
      ((COMPAGNONS_INTEGRES as readonly string[]).includes(lu.choix) ||
        perso.some((p) => p.id === lu.choix))
        ? lu.choix
        : REGLAGES_PAR_DEFAUT.choix;
    return { choix, range: lu.range === true, perso };
  } catch {
    return REGLAGES_PAR_DEFAUT;
  }
}

/**
 * Range les réglages. `false` si le navigateur a refusé (quota, accès bloqué,
 * navigation privée) : l'appelant garde les réglages en mémoire et le DIT —
 * jamais d'exception qui remonterait jusqu'au filet de l'écran.
 */
export function ecrireReglages(
  cle: string,
  r: ReglagesCompagnon,
  stockage: Storage | null = stockageLocal(),
): boolean {
  try {
    if (!stockage) return false;
    stockage.setItem(cle, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

/** `localStorage` lui-même peut lever à l'ACCÈS (cookies bloqués). */
function stockageLocal(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
