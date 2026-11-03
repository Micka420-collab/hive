// LA PORTE — rejoindre une ruche en ouvrant UN lien.
//
// ─── CE QU'UN INVITÉ VIVAIT ──────────────────────────────────────────────────
//
// Celui qui invite remettait une COMMANDE : soixante caractères de `curl`,
// un `sh -s --`, et un billet de deux cents signes à ne pas couper. L'invité
// devait savoir ce qu'est un terminal, lequel ouvrir sous Windows, et pourquoi
// la commande n'est pas la même que celle de sa collègue sous macOS. Celui
// qui invite devait l'expliquer. Et c'est exactement ce qui fait qu'on
// n'invite personne.
//
// ─── CE QUE LA PORTE REMET À LA PLACE ────────────────────────────────────────
//
// Un LIEN : `https://ruche.exemple.org/r/bil-…#hive2_…`. L'invité l'ouvre, et
// la page — servie par la ruche elle-même — fait le reste :
//
//   · elle reconnaît son système et lui propose UN geste : « Rejoindre avec
//     l'application » (le lien `hive://rejoindre/…` ouvre l'app de bureau, qui
//     installe l'ouvrière) ; sans l'app, le téléchargement de l'installeur de
//     son système, puis le même geste ;
//   · pour qui préfère un terminal, la commande de son système, déjà composée,
//     à copier d'un clic ;
//   · et elle lui dit, en direct, quand sa machine est entrée.
//
// Celui qui invite, lui, voit dans Mission Control le lien OUVERT, puis la
// machine ARRIVÉE — sans un message échangé.
//
// ─── LE SECRET NE QUITTE JAMAIS LE NAVIGATEUR ────────────────────────────────
//
// Le billet entier est dans le FRAGMENT (`#hive2_…`). Un fragment n'est jamais
// envoyé au serveur : ni la ruche, ni un proxy, ni un journal d'accès ne le
// voient. La ruche ne reçoit que l'identifiant public du billet (`/r/bil-…`),
// qui lui suffit pour dire « ce lien est encore valable » et pour journaliser
// « le lien a été ouvert ». Le billet, lui, ne sert que depuis la machine de
// l'invité, exactement comme la commande d'avant — et il est échangé contre
// une clé de nœud à la première connexion (`shared/acces.ts`).
//
// Module PUR : aucune I/O. La ruche s'en sert pour composer le lien et la
// page, la CLI et l'app pour le relire. Un seul endroit sait ce qu'est un lien
// de porte.

import { PREFIXE_BILLET, decoderBillet, encoderBillet, urlHttpDeRuche } from './acces.js';
import type { Billet } from './acces.js';
import { billetCollable } from './commande-entree.js';

/** Le chemin de la porte sur la ruche : `/r/<id du billet>`. Court, car il se partage. */
export const CHEMIN_PORTE = '/r/';

/** L'hôte du lien profond que l'app de bureau reconnaît : `hive://rejoindre/<billet>`. */
export const HOTE_LIEN_PROFOND = 'rejoindre';

/** Un identifiant de billet tel que `/api/billets` les engendre (`bil-<uuid>`), borné. */
const ID_BILLET = /^[A-Za-z0-9_-]{1,80}$/;

// ─── Le lien ─────────────────────────────────────────────────────────────────

/**
 * Le lien de porte d'un billet, ou `null` si le billet n'a pas d'adresse HTTP
 * lisible. `base` : l'adresse HTTP(S) publique de la ruche (celle que
 * `urlHttpDeRuche` tire de l'URL WebSocket du billet, par défaut).
 */
export function lienDePorte(billet: Billet, base = urlHttpDeRuche(billet.url)): string | null {
  if (base === null || !ID_BILLET.test(billet.id)) return null;
  const encode = encoderBillet(billet);
  if (!billetCollable(encode)) return null;
  return `${base.replace(/\/+$/, '')}${CHEMIN_PORTE}${billet.id}#${encode}`;
}

/** Vrai si la chaîne a la forme d'un lien de porte (`http(s)://…/r/<id>#hive2_…`). */
export function estLienDePorte(brut: unknown): brut is string {
  return typeof brut === 'string' && billetDuLien(brut, { id: 80, nom: 500 }) !== null;
}

/**
 * Le billet porté par un lien de porte, ou `null`. Le fragment fait foi ; le
 * chemin doit le CONFIRMER (même identifiant) — un lien bricolé dont le chemin
 * et le fragment désignent deux billets n'est pas un lien, c'est une erreur,
 * et on ne devine pas lequel des deux l'invité voulait.
 */
export function billetDuLien(brut: unknown, limites: { id: number; nom: number }): Billet | null {
  if (typeof brut !== 'string' || brut.length > 4_500) return null;
  let u: URL;
  try {
    u = new URL(brut.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.pathname.startsWith(CHEMIN_PORTE)) return null;
  const id = u.pathname.slice(CHEMIN_PORTE.length);
  if (!ID_BILLET.test(id)) return null;
  const fragment = u.hash.startsWith('#') ? u.hash.slice(1) : '';
  if (!fragment.startsWith(PREFIXE_BILLET)) return null;
  const billet = decoderBillet(fragment, limites);
  if (billet === null || billet.id !== id) return null;
  return billet;
}

// ─── Le lien profond ─────────────────────────────────────────────────────────

/** `hive://rejoindre/<billet>` — ce que la page remet à l'app de bureau. */
export function lienProfond(billet: Billet): string | null {
  const encode = encoderBillet(billet);
  return billetCollable(encode) ? `hive://${HOTE_LIEN_PROFOND}/${encode}` : null;
}

/**
 * Le billet d'un lien profond `hive://rejoindre/<billet>`, ou `null`. Tout
 * autre hôte (`hive://ouvrir/…` reste à la navigation de l'app), un paramètre,
 * un fragment, un identifiant : refusé.
 */
export function billetDuLienProfond(
  brut: unknown,
  limites: { id: number; nom: number },
): Billet | null {
  if (typeof brut !== 'string' || brut.length > 4_500) return null;
  let u: URL;
  try {
    u = new URL(brut.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'hive:' || u.hostname !== HOTE_LIEN_PROFOND) return null;
  if (u.search !== '' || u.hash !== '' || u.username !== '' || u.password !== '' || u.port !== '') {
    return null;
  }
  const encode = u.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!billetCollable(encode)) return null;
  return decoderBillet(encode, limites);
}

// ─── Ce que la page lit du navigateur ────────────────────────────────────────

export type SystemeInvite = 'windows' | 'macos' | 'linux' | 'autre';

/**
 * Le système de l'invité d'après son `User-Agent`, pour proposer d'emblée le
 * bon installeur et la bonne commande. Un téléphone est `autre` : on ne
 * rejoint pas une ruche depuis un téléphone, la page le dit et propose de
 * s'envoyer le lien.
 */
export function systemeDepuisUserAgent(ua: string | undefined): SystemeInvite {
  const s = (ua ?? '').toLowerCase();
  if (/android|iphone|ipad|ipod|mobile/.test(s)) return 'autre';
  if (/windows/.test(s)) return 'windows';
  if (/mac os x|macintosh/.test(s)) return 'macos';
  if (/linux|x11|cros/.test(s)) return 'linux';
  return 'autre';
}

/** Les libellés qu'une page ou un écran montre pour un système. */
export const LIBELLES_SYSTEME: Readonly<Record<SystemeInvite, string>> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  autre: 'votre ordinateur',
};
