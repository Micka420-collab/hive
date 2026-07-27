// Le trou de vol — comment on entre dans la ruche, et comment on en sort.
//
// AVANT ce module, une invitation contenait le TOKEN DE LA RUCHE en clair.
// Trois conséquences, toutes vécues par quiconque a déjà partagé un projet :
//
//   1. Qui reçoit une invitation a un accès TOTAL et DÉFINITIF. Pas
//      d'expiration, pas d'usage unique. Une invitation collée dans un salon
//      de discussion reste une clé valide trois ans plus tard.
//   2. Un seul secret pour tout le monde : on ne peut pas exclure UNE personne.
//      Changer le token éjecte l'essaim entier — donc, en pratique, personne ne
//      le change jamais.
//   3. Aucune trace : impossible de dire QUI a rejoint avec QUELLE invitation.
//
// Le modèle ici sépare deux choses que l'ancien format confondait :
//
//   • le BILLET (`hive2_…`) — ce qu'on envoie à un ami. Éphémère, à usage
//     compté, révocable, et sans aucun pouvoir sur la ruche : il ne sert QU'À
//     demander une clé.
//   • la CLÉ DE NŒUD — ce que le nœud obtient en échangeant son billet, et
//     qu'il garde. Propre à lui, révocable individuellement.
//
// Le serveur ne stocke JAMAIS le secret d'un billet ni la clé d'un nœud : il
// n'en garde qu'une empreinte PBKDF2 salée. Une base volée ne donne aucun
// accès — c'est le même contrat que les mots de passe (auth.ts), appliqué aux
// machines.
//
// Module PUR : aucune I/O, aucune horloge implicite (`maintenant` est toujours
// un paramètre), aucun accès base. Comme balance.ts, thermo.ts et gardiennes.ts.

import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Préfixe du billet d'invitation. `hive1_` reste lisible (ancien format). */
export const PREFIXE_BILLET = 'hive2_';

/**
 * Longueur du secret tiré au sort, en octets. 32 octets = 256 bits d'entropie
 * réelle issue de `randomBytes` : hors de portée d'une attaque en force brute,
 * y compris en ligne sans limitation de débit.
 */
export const OCTETS_SECRET = 32;

/**
 * Durée de vie par défaut d'un billet : 24 h. Assez pour qu'un ami dans un
 * autre fuseau ait le temps de le voir passer, assez court pour qu'un billet
 * oublié dans un historique de conversation ne soit plus une clé demain.
 */
export const TTL_BILLET_MS = 24 * 60 * 60 * 1000;

/** Plafond dur du TTL demandé à la création : 30 jours. */
export const TTL_BILLET_MAX_MS = 30 * 24 * 60 * 60 * 1000;

/** Nombre d'usages par défaut : UN. Un billet = une machine. */
export const USAGES_DEFAUT = 1;

/** Plafond dur du nombre d'usages (une invitation d'atelier, par exemple). */
export const USAGES_MAX = 50;

// ─── Empreintes ───────────────────────────────────────────────────────────────
// Mêmes paramètres qu'auth.ts, et pour la même raison : le format porte son
// nombre d'itérations, donc on pourra le relever sans invalider l'existant.

const ITERATIONS = 100_000;
const LONGUEUR_CLE = 32;
const DIGEST = 'sha256';

/** Tire un secret aléatoire, en base64url (sûr en URL, en JSON et en terminal). */
export function tirerSecret(): string {
  return randomBytes(OCTETS_SECRET).toString('base64url');
}

/** Empreinte salée d'un secret. Le secret lui-même n'est jamais rangé. */
export function empreinte(secret: string): string {
  const sel = randomBytes(16).toString('base64url');
  const cle = pbkdf2Sync(secret, sel, ITERATIONS, LONGUEUR_CLE, DIGEST).toString('base64url');
  return `${ITERATIONS}$${sel}$${cle}`;
}

/**
 * Vérifie un secret contre son empreinte, en temps constant.
 *
 * Bornes dures sur le nombre d'itérations relu : une valeur folle serait soit
 * un contournement du coût (0 itération), soit un déni de service par calcul
 * interminable (des milliards). Même garde qu'auth.ts:33.
 */
export function empreinteValide(secret: string, stockee: string): boolean {
  const parts = stockee.split('$');
  if (parts.length !== 3) return false;
  const iterations = Number(parts[0]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
  const sel = parts[1]!;
  const attendue = parts[2]!;
  const cle = pbkdf2Sync(secret, sel, iterations, LONGUEUR_CLE, DIGEST).toString('base64url');
  try {
    const a = Buffer.from(cle);
    const b = Buffer.from(attendue);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Le billet ────────────────────────────────────────────────────────────────

export interface Billet {
  /** URL WebSocket de la ruche, ex. wss://ruche.exemple.com/ws */
  url: string;
  /** Identifiant public du billet — sert à le retrouver en base sans le secret. */
  id: string;
  /** Secret du billet (jamais rangé côté serveur, seulement son empreinte). */
  secret: string;
  /** Libellé lisible affiché à l'invité (ex. « Ruche de Micka »). */
  label?: string;
}

/**
 * Vrai si la chaîne contient un caractère de contrôle. Interdits dans un
 * libellé affiché en terminal : ESC permettrait une injection ANSI capable de
 * réécrire les lignes déjà affichées — donc de MASQUER l'URL réelle de
 * connexion et d'hameçonner l'invité. Même garde que l'ancien format.
 */
export function contientCaractereDeControle(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function encoderBillet(billet: Billet): string {
  const charge = JSON.stringify({
    v: 2,
    url: billet.url,
    id: billet.id,
    s: billet.secret,
    ...(billet.label ? { label: billet.label } : {}),
  });
  return PREFIXE_BILLET + Buffer.from(charge, 'utf8').toString('base64url');
}

/**
 * Décode et valide un billet. Rend `null` sur toute anomalie — un billet
 * difforme ne doit jamais produire un objet à moitié rempli qu'un appelant
 * distrait utiliserait quand même.
 */
export function decoderBillet(brut: unknown, limites: { id: number; nom: number }): Billet | null {
  if (typeof brut !== 'string') return null;
  let s = brut.trim();
  if (s.startsWith('hive://')) s = s.slice('hive://'.length);
  if (!s.startsWith(PREFIXE_BILLET)) return null;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(s.slice(PREFIXE_BILLET.length), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  const { url, id } = d;
  const secret = d.s;
  if (typeof url !== 'string' || !estUrlWs(url)) return null;
  if (typeof id !== 'string' || id.length === 0 || id.length > limites.id) return null;
  // Le secret fait 32 octets en base64url (43 caractères) ; on tolère une marge
  // pour un futur relèvement, mais jamais une chaîne vide ou démesurée.
  if (typeof secret !== 'string' || secret.length < 20 || secret.length > 256) return null;
  const label =
    typeof d.label === 'string' &&
    d.label.length > 0 &&
    d.label.length <= limites.nom &&
    !contientCaractereDeControle(d.label)
      ? d.label
      : undefined;

  return { url, id, secret, ...(label ? { label } : {}) };
}

/** Une URL de ruche est un WebSocket `ws://` ou `wss://` bien formé. */
export function estUrlWs(v: string): boolean {
  try {
    const u = new URL(v);
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * L'URL HTTP(S) correspondante, pour échanger le billet contre une clé AVANT
 * d'ouvrir le WebSocket. `wss://h/ws` → `https://h`. Rend `null` si l'URL n'est
 * pas une URL de ruche valide — l'appelant doit traiter le cas plutôt que de
 * fabriquer une URL approximative.
 */
export function urlHttpDeRuche(urlWs: string): string | null {
  if (!estUrlWs(urlWs)) return null;
  const u = new URL(urlWs);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = '/';
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

// ─── Le garde-fou du transport ────────────────────────────────────────────────

/**
 * Vrai si l'hôte est une boucle locale ou une adresse de réseau privé (RFC 1918,
 * RFC 4193, lien-local). Sur ces réseaux, `ws://` en clair est un risque accepté
 * et documenté ; sur l'Internet public, non.
 *
 * Volontairement CONSERVATEUR : tout ce qui n'est pas manifestement privé est
 * traité comme public. Se tromper dans ce sens fait afficher un avertissement de
 * trop ; se tromper dans l'autre laisse partir un secret en clair sur Internet.
 */
export function estReseauPrive(hote: string): boolean {
  const h = hote.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  // IPv6 : locales uniques (fc00::/7) et lien-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a > 255 || b > 255 || Number(v4[3]) > 255 || Number(v4[4]) > 255) return false;
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // lien-local
  return false;
}

export type VerdictTransport = 'sur' | 'clair_prive' | 'clair_public';

/**
 * Juge le transport d'une URL de ruche.
 *
 *   • `sur`           — wss://, chiffré de bout en bout.
 *   • `clair_prive`   — ws:// sur une adresse privée : risque accepté, on le dit.
 *   • `clair_public`  — ws:// vers l'Internet : le billet ET tout le trafic
 *                       (donc le CODE SOURCE des tâches et les diffs) passent en
 *                       clair. Refusé par défaut ; il faut le demander deux fois.
 */
export function jugerTransport(urlWs: string): VerdictTransport | null {
  if (!estUrlWs(urlWs)) return null;
  const u = new URL(urlWs);
  if (u.protocol === 'wss:') return 'sur';
  return estReseauPrive(u.hostname) ? 'clair_prive' : 'clair_public';
}

// ─── L'état d'un billet ───────────────────────────────────────────────────────

export interface EtatBillet {
  expireA: number;
  usagesRestants: number;
  revoqueA: number | null;
}

export type RefusBillet = 'inconnu' | 'revoque' | 'expire' | 'epuise' | 'secret_invalide';

/**
 * Décide si un billet peut être échangé, à `maintenant`. L'ORDRE des refus est
 * délibéré : révoqué avant expiré avant épuisé. Un opérateur qui a révoqué un
 * billet veut lire « révoqué », pas « expiré » — le second lui ferait croire
 * que sa révocation n'a pas pris.
 *
 * Le secret est vérifié EN DERNIER, une fois seulement que le billet est par
 * ailleurs recevable : inutile de payer 100 000 itérations de PBKDF2 pour un
 * billet expiré, et cela borne le coût qu'un inconnu peut infliger au hub en
 * rejouant un vieux billet en boucle.
 */
export function jugerBillet(
  etat: EtatBillet | null,
  maintenant: number,
): { ok: true } | { ok: false; refus: RefusBillet } {
  if (!etat) return { ok: false, refus: 'inconnu' };
  if (etat.revoqueA !== null) return { ok: false, refus: 'revoque' };
  if (etat.expireA <= maintenant) return { ok: false, refus: 'expire' };
  if (etat.usagesRestants <= 0) return { ok: false, refus: 'epuise' };
  return { ok: true };
}

/** Borne le TTL demandé dans [1 min, TTL_BILLET_MAX_MS]. */
export function bornerTtl(demande: number | undefined): number {
  if (typeof demande !== 'number' || !Number.isFinite(demande)) return TTL_BILLET_MS;
  return Math.min(Math.max(Math.floor(demande), 60_000), TTL_BILLET_MAX_MS);
}

/** Borne le nombre d'usages demandé dans [1, USAGES_MAX]. */
export function bornerUsages(demande: number | undefined): number {
  if (typeof demande !== 'number' || !Number.isFinite(demande)) return USAGES_DEFAUT;
  return Math.min(Math.max(Math.floor(demande), 1), USAGES_MAX);
}
