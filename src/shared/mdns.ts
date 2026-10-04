// Le fil du réseau local — un codec DNS minimal pour mDNS / DNS-SD.
//
// ─── POURQUOI UN CODEC MAISON, ET PAS `multicast-dns` ────────────────────────
//
// La découverte du réseau local (`decouverte.ts`) a besoin de QUATRE types
// d'enregistrements — PTR, SRV, TXT, A — et de rien d'autre. La bibliothèque
// d'usage (`multicast-dns`) tire `dns-packet` et `thunky`, sait lire des
// dizaines de types dont on n'a que faire, et ferait entrer trois paquets dans
// les dépendances de PRODUCTION d'un projet qui n'en a qu'une (`ws`). Un nœud
// qu'on installe chez un ami (`--omit=optional`) les porterait tous.
//
// Surtout, ce qu'on lit ici vient de N'IMPORTE QUI : tout paquet émis sur
// 224.0.0.251:5353 par une imprimante, une télévision ou un voisin malveillant
// arrive dans ce décodeur. Ce qu'on veut en garantir tient en peu de lignes et
// se relit d'un coup d'œil — ce qui est le vrai argument :
//
//   · aucun paquet ne fait lever : tout défaut rend `null` ;
//   · aucune boucle de compression : chaque pointeur doit viser STRICTEMENT
//     plus bas que le précédent, donc la lecture termine toujours ;
//   · aucune amplification : taille, nombre d'enregistrements et longueur de
//     nom sont bornés avant d'allouer quoi que ce soit.
//
// ─── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
//
// Pas de compression À L'ÉCRITURE (nos paquets font quelques centaines
// d'octets, loin du plafond), pas d'IPv6, pas de sondage de conflit de nom : les
// noms d'instance de Hive sont tirés au sort (`hive-<8 hex>`), la collision est
// négligeable et n'aurait pour effet qu'une ligne en double à l'écran.
//
// Module PUR : aucune I/O. Le transport UDP vit dans `mdns-reseau.ts`.

/** Le groupe et le port de mDNS (RFC 6762 § 3). */
export const GROUPE_MDNS = '224.0.0.251';
export const PORT_MDNS = 5353;

/**
 * Taille maximale d'un paquet mDNS (RFC 6762 § 17). Au-delà, on ne lit pas : un
 * datagramme plus gros n'est pas un paquet mDNS, c'est une tentative.
 */
export const TAILLE_MAX_PAQUET = 9_000;

/** Codes des types d'enregistrement qu'on sait nommer (RFC 1035, 2782, 6763). */
export const TYPE_MDNS = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 } as const;

const CLASSE_IN = 1;
/**
 * Le bit haut de la classe. Dans une QUESTION il demande une réponse unicast
 * (« QU ») ; dans un ENREGISTREMENT il dit « videz votre cache pour ce nom »
 * (cache-flush, RFC 6762 § 10.2) — réservé aux enregistrements uniques.
 */
const BIT_HAUT = 0x8000;

/** Plafond d'enregistrements lus par paquet — bien au-delà de l'usage réel. */
const ENREGISTREMENTS_MAX = 256;
/** Plafond de sauts de compression par nom : la décroissance stricte suffit, ceci double la garde. */
const SAUTS_MAX = 64;

export interface QuestionMdns {
  nom: string;
  type: number;
  /** Bit « QU » : l'émetteur accepte une réponse unicast. */
  unicast: boolean;
}

interface EnTete {
  nom: string;
  /** Durée de vie, en secondes. `0` = adieu : l'enregistrement est retiré. */
  ttl: number;
  /** Bit cache-flush : cet enregistrement remplace tout ce qu'on savait de ce nom. */
  vidage: boolean;
}

export type EnregistrementMdns =
  | (EnTete & { type: 'PTR'; cible: string })
  | (EnTete & { type: 'SRV'; priorite: number; poids: number; port: number; cible: string })
  | (EnTete & { type: 'TXT'; textes: string[] })
  | (EnTete & { type: 'A'; adresse: string })
  /** Tout le reste : lu pour avancer dans le paquet, jamais interprété. */
  | (EnTete & { type: 'autre'; code: number });

export interface PaquetMdns {
  id: number;
  /** Bit QR : une réponse (vrai) ou une question (faux). */
  reponse: boolean;
  questions: QuestionMdns[];
  reponses: EnregistrementMdns[];
  /** Section additionnelle — là où un répondeur range SRV, TXT et A. */
  additionnels: EnregistrementMdns[];
}

// ─── Écriture ────────────────────────────────────────────────────────────────

/**
 * Un nom de domaine en étiquettes. LÈVE sur une étiquette vide, de plus de 63
 * octets, ou un nom de plus de 255 : ce sont nos propres noms, et un nom
 * invalide ici est une faute de programmation à voir tout de suite — pas un
 * paquet à émettre de travers.
 */
function ecrireNom(nom: string): Buffer {
  const morceaux: Buffer[] = [];
  let total = 1;
  for (const etiquette of nom.split('.')) {
    if (etiquette === '') continue;
    const octets = Buffer.from(etiquette, 'utf8');
    if (octets.length > 63) throw new Error(`étiquette DNS de plus de 63 octets : ${etiquette}`);
    morceaux.push(Buffer.from([octets.length]), octets);
    total += octets.length + 1;
  }
  if (total > 255) throw new Error(`nom DNS de plus de 255 octets : ${nom}`);
  morceaux.push(Buffer.from([0]));
  return Buffer.concat(morceaux);
}

function ecrireIpv4(adresse: string): Buffer {
  const parts = adresse.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`adresse IPv4 invalide : ${adresse}`);
  }
  return Buffer.from(parts);
}

/** Ce qu'on sait écrire : tout sauf `autre`, qu'on ne fait que traverser à la lecture. */
type EnregistrementEcrit = Exclude<EnregistrementMdns, { type: 'autre' }>;

function ecrireDonnees(e: EnregistrementEcrit): Buffer {
  switch (e.type) {
    case 'PTR':
      return ecrireNom(e.cible);
    case 'SRV': {
      const tete = Buffer.alloc(6);
      tete.writeUInt16BE(e.priorite, 0);
      tete.writeUInt16BE(e.poids, 2);
      tete.writeUInt16BE(e.port, 4);
      return Buffer.concat([tete, ecrireNom(e.cible)]);
    }
    case 'TXT': {
      // Un TXT vide s'écrit avec UNE chaîne vide (RFC 6763 § 6.1) : zéro octet
      // de données serait un enregistrement malformé.
      const textes = e.textes.length === 0 ? [''] : e.textes;
      return Buffer.concat(
        textes.flatMap((t) => {
          const octets = Buffer.from(t, 'utf8');
          if (octets.length > 255) throw new Error(`chaîne TXT de plus de 255 octets : ${t}`);
          return [Buffer.from([octets.length]), octets];
        }),
      );
    }
    case 'A':
      return ecrireIpv4(e.adresse);
  }
}

const CODE_DE: Record<EnregistrementEcrit['type'], number> = {
  A: TYPE_MDNS.A,
  PTR: TYPE_MDNS.PTR,
  TXT: TYPE_MDNS.TXT,
  SRV: TYPE_MDNS.SRV,
};

function ecrireEnregistrement(e: EnregistrementMdns): Buffer {
  if (e.type === 'autre') throw new Error(`type d'enregistrement ${e.code} : on ne l'écrit pas`);
  const donnees = ecrireDonnees(e);
  const tete = Buffer.alloc(10);
  tete.writeUInt16BE(CODE_DE[e.type], 0);
  tete.writeUInt16BE(CLASSE_IN | (e.vidage ? BIT_HAUT : 0), 2);
  tete.writeUInt32BE(e.ttl, 4);
  tete.writeUInt16BE(donnees.length, 8);
  return Buffer.concat([ecrireNom(e.nom), tete, donnees]);
}

/** Un paquet complet, prêt à partir sur le fil. */
export function encoderPaquet(p: PaquetMdns): Buffer {
  const tete = Buffer.alloc(12);
  tete.writeUInt16BE(p.id, 0);
  // Réponse : QR=1 et AA=1 (0x8400) — un répondeur mDNS fait toujours autorité
  // sur ses propres noms (RFC 6762 § 18.4). Question : tout à zéro.
  tete.writeUInt16BE(p.reponse ? 0x8400 : 0, 2);
  tete.writeUInt16BE(p.questions.length, 4);
  tete.writeUInt16BE(p.reponses.length, 6);
  tete.writeUInt16BE(0, 8);
  tete.writeUInt16BE(p.additionnels.length, 10);
  const questions = p.questions.map((q) => {
    const fin = Buffer.alloc(4);
    fin.writeUInt16BE(q.type, 0);
    fin.writeUInt16BE(CLASSE_IN | (q.unicast ? BIT_HAUT : 0), 2);
    return Buffer.concat([ecrireNom(q.nom), fin]);
  });
  return Buffer.concat([
    tete,
    ...questions,
    ...p.reponses.map(ecrireEnregistrement),
    ...p.additionnels.map(ecrireEnregistrement),
  ]);
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

/**
 * Lit un nom à `debut`, compression comprise. Rend le nom et la position qui
 * SUIT le nom dans le flux (après le premier pointeur s'il y en a un), ou
 * `null` sur tout défaut.
 *
 * LA GARDE ANTI-BOUCLE : chaque pointeur doit viser strictement plus bas que la
 * cible du pointeur précédent. La suite des cibles décroît donc strictement, et
 * la lecture termine en au plus N sauts sur un paquet de N octets — un pointeur
 * qui vise vers l'avant, ou vers lui-même, est refusé sur-le-champ. C'est ce
 * que tout encodeur honnête produit : il ne peut désigner qu'un nom déjà écrit.
 */
function lireNom(buf: Buffer, debut: number): { nom: string; suite: number } | null {
  const etiquettes: string[] = [];
  let pos = debut;
  let plancher = debut;
  let suite = -1;
  let longueur = 1;
  let sauts = 0;
  for (;;) {
    if (pos >= buf.length) return null;
    const octet = buf[pos]!;
    if (octet === 0) {
      if (suite < 0) suite = pos + 1;
      break;
    }
    if ((octet & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) return null;
      const cible = ((octet & 0x3f) << 8) | buf[pos + 1]!;
      if (cible >= plancher || ++sauts > SAUTS_MAX) return null;
      if (suite < 0) suite = pos + 2;
      plancher = cible;
      pos = cible;
      continue;
    }
    // 0x40 et 0x80 : types d'étiquettes étendus (RFC 6891), jamais utilisés par
    // mDNS. On refuse plutôt que de deviner.
    if ((octet & 0xc0) !== 0) return null;
    if (pos + 1 + octet > buf.length) return null;
    longueur += octet + 1;
    if (longueur > 255) return null;
    etiquettes.push(buf.toString('utf8', pos + 1, pos + 1 + octet));
    pos += 1 + octet;
  }
  return { nom: etiquettes.join('.'), suite };
}

function lireEnregistrement(
  buf: Buffer,
  debut: number,
): { e: EnregistrementMdns; suite: number } | null {
  const n = lireNom(buf, debut);
  if (!n || n.suite + 10 > buf.length) return null;
  const p = n.suite;
  const code = buf.readUInt16BE(p);
  const classe = buf.readUInt16BE(p + 2);
  const ttl = buf.readUInt32BE(p + 4);
  const longueur = buf.readUInt16BE(p + 8);
  const donnees = p + 10;
  const fin = donnees + longueur;
  if (fin > buf.length) return null;
  const tete: EnTete = { nom: n.nom, ttl, vidage: (classe & BIT_HAUT) !== 0 };
  const suite = { suite: fin };

  // Hors classe IN, on n'interprète rien : on avance.
  if ((classe & ~BIT_HAUT) !== CLASSE_IN) return { e: { ...tete, type: 'autre', code }, ...suite };

  switch (code) {
    case TYPE_MDNS.PTR: {
      const cible = lireNom(buf, donnees);
      if (!cible || cible.suite > fin) return null;
      return { e: { ...tete, type: 'PTR', cible: cible.nom }, ...suite };
    }
    case TYPE_MDNS.SRV: {
      if (longueur < 7) return null;
      const cible = lireNom(buf, donnees + 6);
      if (!cible || cible.suite > fin) return null;
      return {
        e: {
          ...tete,
          type: 'SRV',
          priorite: buf.readUInt16BE(donnees),
          poids: buf.readUInt16BE(donnees + 2),
          port: buf.readUInt16BE(donnees + 4),
          cible: cible.nom,
        },
        ...suite,
      };
    }
    case TYPE_MDNS.TXT: {
      const textes: string[] = [];
      let q = donnees;
      while (q < fin) {
        const l = buf[q]!;
        if (q + 1 + l > fin) return null;
        textes.push(buf.toString('utf8', q + 1, q + 1 + l));
        q += 1 + l;
      }
      return { e: { ...tete, type: 'TXT', textes }, ...suite };
    }
    case TYPE_MDNS.A:
      if (longueur !== 4) return null;
      return {
        e: { ...tete, type: 'A', adresse: [...buf.subarray(donnees, fin)].join('.') },
        ...suite,
      };
    default:
      return { e: { ...tete, type: 'autre', code }, ...suite };
  }
}

/**
 * Lit un paquet reçu. Rend `null` sur TOUT défaut — un paquet à moitié lu ne
 * doit jamais produire une liste à moitié remplie qu'un appelant prendrait
 * pour complète.
 *
 * La section d'autorité est lue (il faut bien avancer) puis écartée : elle ne
 * sert qu'au sondage de conflit de nom, que Hive ne pratique pas.
 */
export function decoderPaquet(buf: Buffer): PaquetMdns | null {
  if (buf.length < 12 || buf.length > TAILLE_MAX_PAQUET) return null;
  const id = buf.readUInt16BE(0);
  const drapeaux = buf.readUInt16BE(2);
  const nq = buf.readUInt16BE(4);
  const nr = buf.readUInt16BE(6);
  const na = buf.readUInt16BE(8);
  const nx = buf.readUInt16BE(10);
  if (nq + nr + na + nx > ENREGISTREMENTS_MAX) return null;

  let pos = 12;
  const questions: QuestionMdns[] = [];
  for (let i = 0; i < nq; i++) {
    const n = lireNom(buf, pos);
    if (!n || n.suite + 4 > buf.length) return null;
    const classe = buf.readUInt16BE(n.suite + 2);
    questions.push({
      nom: n.nom,
      type: buf.readUInt16BE(n.suite),
      unicast: (classe & BIT_HAUT) !== 0,
    });
    pos = n.suite + 4;
  }
  const sections: EnregistrementMdns[][] = [[], [], []];
  const comptes = [nr, na, nx];
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < comptes[s]!; i++) {
      const r = lireEnregistrement(buf, pos);
      if (!r) return null;
      sections[s]!.push(r.e);
      pos = r.suite;
    }
  }
  return {
    id,
    reponse: (drapeaux & 0x8000) !== 0,
    questions,
    reponses: sections[0]!,
    additionnels: sections[2]!,
  };
}

/** Deux noms DNS désignent-ils la même chose ? La casse ASCII ne compte pas (RFC 1035 § 2.3.3). */
export function memeNom(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
