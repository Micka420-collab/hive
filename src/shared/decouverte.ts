// La découverte du réseau local — le CONTRAT, écrit une fois pour les deux côtés.
//
// ─── LE GESTE QUE CE MODULE REND POSSIBLE ────────────────────────────────────
//
// Ajouter la machine d'à côté à sa ruche demandait de générer un billet, de le
// copier, de l'envoyer par une messagerie à… soi-même, de le coller sur l'autre
// poste. Ici, la machine qui le VEUT se signale sur le réseau local (mDNS /
// DNS-SD, `_hive._tcp`), la Reine qui l'ÉCOUTE la liste dans le tableau de
// bord, et un clic « Rejoindre » l'accueille.
//
// ─── TROIS CONSENTEMENTS, ET AUCUN N'EST SOUS-ENTENDU ────────────────────────
//
//   1. la MACHINE se signale seulement si on le lui demande (`HIVE_DECOUVRABLE`
//      ou `hive join --decouvrable`) — jamais par défaut ;
//   2. la REINE écoute seulement si on le lui demande (`HIVE_DECOUVERTE`) ;
//   3. l'ENTRÉE exige le CODE D'APPARIEMENT que la machine affiche, et que
//      l'administrateur recopie dans le tableau de bord. Sans lui, pas d'entrée.
//
// Le troisième est ce qui empêche l'« auto-join » dans les DEUX sens. Une ruche
// voisine qui entend la machine ne peut pas se l'approprier : elle n'a pas vu
// l'écran. Et une fausse annonce (quelqu'un qui se fait passer pour « le
// portable de Camille ») ne reçoit rien d'utilisable : l'offre qu'on lui envoie
// est scellée sous le code qu'elle n'a pas.
//
// ─── CE QUI PASSE SUR LE RÉSEAU, ET CE QUI N'Y PASSE JAMAIS ──────────────────
//
// L'annonce est diffusée à TOUT le segment. Elle porte EXACTEMENT : le nom
// d'affichage de la machine, la famille de son système, les familles d'agents
// connectés (#492 : un agent installé mais non connecté n'est pas annoncé), le
// nombre de places, l'état (libre / membre), et l'empreinte de la ruche d'un
// membre. Ni version, ni chemin, ni identifiant de nœud, ni jeton — et
// `textesAnnonce` est le SEUL chemin qui l'écrit : il ne sait pas écrire autre
// chose, même si on le lui donnait.
//
// Le billet, lui, ne circule que SCELLÉ : AES-256-GCM sous une clé tirée du
// code d'appariement (PBKDF2). Le code ne quitte jamais l'écran de la machine.
// Un témoin passif du réseau ne lit pas le billet ; un imposteur qui reçoit
// l'offre à la place de la vraie machine ne l'ouvre pas ; et l'étiquette GCM
// dit à la machine que l'offre vient bien de quelqu'un qui a lu SON code.
// Ensuite seulement vient l'échange habituel du billet contre une clé de nœud
// (`POST /api/rejoindre`, acces.ts) — la même porte que tout le monde.
//
// Module sans I/O ni horloge : le transport vit dans `mdns-reseau.ts`, la
// machine dans `node-client/decouverte-noeud.ts`, la Reine dans
// `orchestrator/decouverte-reseau.ts`.

import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, randomInt } from 'node:crypto';
import { promisify } from 'node:util';
import { AGENT_TYPES } from '../node-client/agent-detect.js';
import type { AgentType } from '../node-client/agent-detect.js';
import { CONCURRENCE_MAX, CONCURRENCE_MIN } from '../node-client/identite-noeud.js';
import { contientCaractereDeControle, decoderBillet, estReseauPrive } from './acces.js';
import { estEmpreinte } from './empreinte-ruche.js';
import { estPlateforme } from './machine.js';
import type { PlateformeNoeud } from './machine.js';
import { LIMITS } from './protocol.js';

const pbkdf2Async = promisify(pbkdf2);

/** Le type de service DNS-SD d'une machine Hive (RFC 6763 § 7). */
export const SERVICE_HIVE = '_hive._tcp.local';

/**
 * Durée de vie des enregistrements annoncés, en secondes. Courte à dessein :
 * une machine éteinte sans adieu (courant coupé, `kill -9`) disparaît de
 * l'écran en deux minutes au plus, et la Reine réinterroge bien avant.
 */
export const TTL_ANNONCE_S = 120;

/** Le nom d'instance d'une machine : tiré au sort à chaque lancement, jamais son identité. */
export const INSTANCE_RE = /^hive-[0-9a-f]{8}$/;

/**
 * Un nom d'instance neuf. Aléatoire plutôt que dérivé du nœud : l'identifiant
 * stable d'un nœud (`identiteStable`) est ce qu'il présente à la Reine, et le
 * diffuser en ferait un traceur qui survit aux redémarrages.
 */
export function tirerInstance(): string {
  return `hive-${randomBytes(4).toString('hex')}`;
}

/**
 * L'adresse IPv4 PRIVÉE d'un pair, ou `null`.
 *
 * mDNS ne franchit pas un routeur : tout ce qu'on entend vient du segment. Une
 * source publique est donc une anomalie, et la Reine ne lui enverra jamais
 * d'offre — sans cette garde, une annonce forgée ferait d'elle un client HTTP
 * aux ordres de n'importe qui, vers n'importe quelle adresse. Même règle du
 * côté de la machine pour qui lui POSTE une offre. Les adresses IPv4 vues à
 * travers une prise IPv6 (`::ffff:192.168.1.20`) sont ramenées à leur forme
 * nue ; l'IPv6 lui-même n'est pas pris en charge par la découverte.
 */
export function ipv4Privee(adresse: string | undefined): string | null {
  const nue = (adresse ?? '').replace(/^::ffff:/i, '');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(nue)) return null;
  return estReseauPrive(nue) && nue !== '0.0.0.0' ? nue : null;
}

/** Libre : attend une ruche. Membre : en a une, et le dit. */
export const ETATS_ANNONCE = ['libre', 'membre'] as const;
export type EtatAnnonce = (typeof ETATS_ANNONCE)[number];

/** Les familles qu'on annonce : toutes, sauf le simulacre, qui n'est pas un agent. */
export type FamilleAnnoncee = Exclude<AgentType, 'shell'>;
const FAMILLES_ANNONCEES: readonly FamilleAnnoncee[] = AGENT_TYPES.filter(
  (a): a is FamilleAnnoncee => a !== 'shell',
);

function estFamilleAnnoncee(v: string): v is FamilleAnnoncee {
  return (FAMILLES_ANNONCEES as readonly string[]).includes(v);
}

/** Plafond du nom d'affichage annoncé : une étiquette DNS, pas davantage. */
export const NOM_ANNONCE_MAX = 63;

/** Ce qu'une machine dit d'elle-même sur le réseau — et RIEN d'autre. */
export interface Annonce {
  nom: string;
  os: PlateformeNoeud;
  agents: readonly FamilleAnnoncee[];
  places: number;
  etat: EtatAnnonce;
  /** L'empreinte de sa ruche (`empreinte-ruche.ts`) ; `null` si libre, ou si elle l'ignore encore. */
  ruche: string | null;
}

/**
 * Le nom d'affichage, rendu diffusable : sans caractère de contrôle, borné en
 * caractères ET en octets (une chaîne TXT fait au plus 255 octets, `nom=`
 * compris). Vide après nettoyage, il devient « machine » — un nom inventé qui
 * se DIT générique, plutôt qu'une ligne vide à l'écran.
 */
export function nomDiffusable(nom: string): string {
  let propre = [...nom]
    .filter((c) => !contientCaractereDeControle(c))
    .join('')
    .trim();
  propre = [...propre].slice(0, NOM_ANNONCE_MAX).join('');
  while (Buffer.byteLength(propre, 'utf8') > 200) propre = [...propre].slice(0, -1).join('');
  return propre === '' ? 'machine' : propre;
}

/**
 * Les chaînes TXT d'une annonce — le SEUL chemin d'écriture.
 *
 * `v=1` est la version du format (la convention « txtvers » de RFC 6763
 * § 6.7) : ce n'est pas une information sur la machine, c'est ce qui permettra
 * de changer le format sans qu'une vieille Reine lise de travers.
 *
 * L'empreinte n'est écrite que pour un MEMBRE qui la connaît : une machine
 * libre n'a pas de ruche, et une empreinte mal formée ne part pas.
 */
export function textesAnnonce(a: Annonce): string[] {
  const agents = [...new Set(a.agents.filter((f) => estFamilleAnnoncee(f)))];
  const places = Math.min(
    Math.max(Math.trunc(a.places) || CONCURRENCE_MIN, CONCURRENCE_MIN),
    CONCURRENCE_MAX,
  );
  const textes = [
    'v=1',
    `nom=${nomDiffusable(a.nom)}`,
    `os=${estPlateforme(a.os) ? a.os : 'autre'}`,
    `agents=${agents.join(',')}`,
    `places=${places}`,
    `etat=${a.etat}`,
  ];
  if (a.etat === 'membre' && estEmpreinte(a.ruche)) textes.push(`ruche=${a.ruche}`);
  return textes;
}

/**
 * Relit une annonce reçue. Rend `null` au moindre défaut : ce qu'on lit ici a
 * été émis par n'importe qui sur le segment.
 *
 * Une famille d'agents INCONNUE est écartée, pas refusée : une machine d'une
 * version plus récente annoncera des familles que cette Reine ne connaît pas
 * encore, et elle doit rester visible avec celles qu'on sait nommer. Pour tout
 * le reste, le doute refuse.
 */
export function lireAnnonce(textes: readonly string[]): Annonce | null {
  // RFC 6763 § 6.4 : la PREMIÈRE occurrence d'une clé fait foi, la casse de la
  // clé ne compte pas.
  const champs = new Map<string, string>();
  for (const t of textes) {
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const cle = t.slice(0, i).toLowerCase();
    if (!champs.has(cle)) champs.set(cle, t.slice(i + 1));
  }
  if (champs.get('v') !== '1') return null;

  const nom = champs.get('nom') ?? '';
  if (nom.trim() === '' || [...nom].length > NOM_ANNONCE_MAX || contientCaractereDeControle(nom))
    return null;

  const os = champs.get('os');
  if (!estPlateforme(os)) return null;

  const brutAgents = champs.get('agents');
  if (brutAgents === undefined || brutAgents.length > 200) return null;
  const agents = [
    ...new Set(brutAgents === '' ? [] : brutAgents.split(',').filter((f) => estFamilleAnnoncee(f))),
  ] as FamilleAnnoncee[];

  const brutPlaces = champs.get('places') ?? '';
  if (!/^\d{1,2}$/.test(brutPlaces)) return null;
  const places = Number(brutPlaces);
  if (places < CONCURRENCE_MIN || places > CONCURRENCE_MAX) return null;

  const etat = champs.get('etat');
  if (etat !== 'libre' && etat !== 'membre') return null;

  // Une empreinte PRÉSENTE mais mal formée n'est pas « inconnue » : c'est une
  // annonce fausse, et on ne l'affiche pas.
  const brutRuche = champs.get('ruche');
  if (brutRuche !== undefined && !estEmpreinte(brutRuche)) return null;
  const ruche = etat === 'membre' && brutRuche !== undefined ? brutRuche : null;

  return { nom, os, agents, places, etat, ruche };
}

// ─── Le code d'appariement ───────────────────────────────────────────────────
//
// Huit caractères de l'alphabet de Crockford — 40 bits. Pourquoi assez :
//
//   · EN LIGNE, la machine ne laisse que cinq essais par code, puis en tire un
//     autre (`decouverte-noeud.ts`) : 5 chances sur 10¹², par code affiché ;
//   · HORS LIGNE, sur une offre interceptée, chaque essai coûte 100 000
//     itérations de PBKDF2 — et ce qu'on y trouverait est un billet à usage
//     unique, qui expire en dix minutes (`TTL_OFFRE_MS`).
//
// Huit caractères se recopient d'un écran à l'autre sans se tromper : pas de
// I/1, pas de O/0, pas de U, et la saisie pardonne l'un pour l'autre.

const ALPHABET_CODE = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LONGUEUR_CODE = 8;

/** Un code neuf, tiré au sort. */
export function tirerCode(): string {
  let code = '';
  for (let i = 0; i < LONGUEUR_CODE; i++) code += ALPHABET_CODE[randomInt(ALPHABET_CODE.length)];
  return code;
}

/** `K7Q2-9XMP` : la forme qu'on lit à voix haute. */
export function formaterCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Ce qu'un humain a TAPÉ, ramené au code — ou `null` s'il ne peut pas en être
 * un. Tirets et espaces ignorés, casse indifférente, O lu 0, I et L lus 1 (la
 * règle de Crockford) : on pardonne la confusion à l'œil, jamais une longueur
 * fausse.
 */
export function normaliserCode(saisie: unknown): string | null {
  if (typeof saisie !== 'string' || saisie.length > 32) return null;
  const s = saisie.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== LONGUEUR_CODE) return null;
  return [...s].every((c) => ALPHABET_CODE.includes(c)) ? s : null;
}

// ─── L'offre scellée ─────────────────────────────────────────────────────────

/** Durée de vie du billet d'une offre : le temps d'aller d'un écran à l'autre, pas plus. */
export const TTL_OFFRE_MS = 10 * 60 * 1000;

/**
 * Espacement minimal entre deux offres qu'une porte accepte d'OUVRIR : chaque
 * ouverture coûte un PBKDF2 à la machine (`decouverte-noeud.ts`). La Reine le
 * lit aussi : à une porte qui répond « trop tôt », elle repasse une fois après
 * ce délai plutôt que de conclure à une machine étrangère.
 */
export const INTERVALLE_OFFRES_MS = 500;

/** Ce qui voyage sur le fil. Tout en base64url ; rien de lisible. */
export interface OffreScellee {
  v: 1;
  sel: string;
  iv: string;
  charge: string;
}

/** Ce que l'offre contient, une fois ouverte. */
export interface ContenuOffre {
  /** Le billet `hive2_…`, à échanger par `POST /api/rejoindre`. */
  billet: string;
  /** L'empreinte de la ruche qui accueille — à comparer à son tableau de bord. */
  ruche: string;
}

export type OuvertureOffre =
  | { issue: 'ouverte'; contenu: ContenuOffre }
  /** Mal formée : rien n'a été essayé, et ça ne compte pas comme un essai de code. */
  | { issue: 'illisible' }
  /** Bien formée, mais le code ne l'ouvre pas — ou elle a été altérée. */
  | { issue: 'refusee' };

const ITERATIONS_OFFRE = 100_000;
const OCTETS_SEL = 16;
const OCTETS_IV = 12;
const OCTETS_ETIQUETTE = 16;
/** Plafond de la charge chiffrée : un billet fait moins de 1 Ko. */
export const CHARGE_MAX = 4_096;

function cleOffre(code: string, sel: Buffer): Promise<Buffer> {
  return pbkdf2Async(code, sel, ITERATIONS_OFFRE, 32, 'sha256');
}

/**
 * Les données authentifiées sans être chiffrées : la version ET l'instance
 * visée. Une offre scellée pour une machine ne s'ouvre pas chez une autre, même
 * si, par extraordinaire, elles affichaient le même code.
 */
function contexte(instance: string): Buffer {
  return Buffer.from(`hive/offre/v1\n${instance}`, 'utf8');
}

/** Scelle une offre sous le code d'appariement de `instance`. */
export async function scellerOffre(
  contenu: ContenuOffre,
  code: string,
  instance: string,
): Promise<OffreScellee> {
  const sel = randomBytes(OCTETS_SEL);
  const iv = randomBytes(OCTETS_IV);
  const chiffreur = createCipheriv('aes-256-gcm', await cleOffre(code, sel), iv);
  chiffreur.setAAD(contexte(instance));
  const clair = Buffer.from(JSON.stringify({ v: 1, billet: contenu.billet, ruche: contenu.ruche }));
  const charge = Buffer.concat([
    chiffreur.update(clair),
    chiffreur.final(),
    chiffreur.getAuthTag(),
  ]);
  return {
    v: 1,
    sel: sel.toString('base64url'),
    iv: iv.toString('base64url'),
    charge: charge.toString('base64url'),
  };
}

/** Du base64url STRICT : `Buffer.from` accepte n'importe quoi, on exige l'aller-retour exact. */
function octets(v: unknown, min: number, max: number): Buffer | null {
  if (typeof v !== 'string' || v.length > Math.ceil((max * 4) / 3) + 4) return null;
  const b = Buffer.from(v, 'base64url');
  if (b.length < min || b.length > max || b.toString('base64url') !== v) return null;
  return b;
}

/** Les pièces d'une offre bien formée, décodées. */
interface PiecesOffre {
  sel: Buffer;
  iv: Buffer;
  charge: Buffer;
}

/**
 * La FORME d'une offre, jugée sans rien payer : `null` si ce n'en est pas une.
 *
 * Exportée pour la porte d'offre (`decouverte-noeud.ts`), qui la juge AVANT de
 * céder son tour de PBKDF2 : sinon un voisin qui poste `{}` deux fois par
 * seconde prendrait ce tour à chaque fois, et l'offre de la vraie Reine
 * repartirait « trop tôt » indéfiniment.
 */
export function formeOffre(brut: unknown): PiecesOffre | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const o = brut as Record<string, unknown>;
  const sel = octets(o.sel, OCTETS_SEL, OCTETS_SEL);
  const iv = octets(o.iv, OCTETS_IV, OCTETS_IV);
  const charge = octets(o.charge, OCTETS_ETIQUETTE + 1, CHARGE_MAX);
  if (o.v !== 1 || !sel || !iv || !charge) return null;
  return { sel, iv, charge };
}

/**
 * Ouvre une offre reçue. Ne lève jamais.
 *
 * La forme est jugée AVANT de payer PBKDF2 (`formeOffre`) : une requête mal
 * formée ne coûte rien à la machine, et ne compte pas comme un essai de code.
 */
export async function ouvrirOffre(
  brut: unknown,
  code: string,
  instance: string,
): Promise<OuvertureOffre> {
  const pieces = formeOffre(brut);
  if (!pieces) return { issue: 'illisible' };
  const { sel, iv, charge } = pieces;

  let clair: Buffer;
  try {
    const dechiffreur = createDecipheriv('aes-256-gcm', await cleOffre(code, sel), iv);
    dechiffreur.setAAD(contexte(instance));
    dechiffreur.setAuthTag(charge.subarray(charge.length - OCTETS_ETIQUETTE));
    clair = Buffer.concat([
      dechiffreur.update(charge.subarray(0, charge.length - OCTETS_ETIQUETTE)),
      dechiffreur.final(),
    ]);
  } catch {
    // Mauvais code, ou charge altérée : l'étiquette GCM ne distingue pas les
    // deux, et c'est très bien — ni l'un ni l'autre n'entre.
    return { issue: 'refusee' };
  }

  let data: unknown;
  try {
    data = JSON.parse(clair.toString('utf8'));
  } catch {
    return { issue: 'illisible' };
  }
  if (typeof data !== 'object' || data === null) return { issue: 'illisible' };
  const d = data as Record<string, unknown>;
  // Authentique, mais inutilisable : un billet que `join` refuserait ne doit
  // pas être accusé réception comme une entrée réussie.
  if (
    d.v !== 1 ||
    typeof d.billet !== 'string' ||
    decoderBillet(d.billet, { id: LIMITS.id, nom: LIMITS.name }) === null ||
    !estEmpreinte(d.ruche)
  ) {
    return { issue: 'illisible' };
  }
  return { issue: 'ouverte', contenu: { billet: d.billet, ruche: d.ruche } };
}
