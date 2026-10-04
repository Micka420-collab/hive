// L'empreinte d'une ruche — de quoi la RECONNAÎTRE, sans rien en apprendre.
//
// ─── À QUOI ELLE SERT ────────────────────────────────────────────────────────
//
// Une machine qui se signale sur le réseau local (`decouverte.ts`) dit si elle
// est libre ou déjà membre, et DE QUELLE ruche. La Reine qui l'entend doit
// pouvoir trancher « dans ma ruche » / « dans une autre » sans qu'aucun secret
// ne passe sur le réseau : l'annonce est diffusée à TOUT le segment, imprimantes
// et voisins compris. La même empreinte est rappelée à la machine qui reçoit une
// offre, pour que l'humain la compare à celle qu'affiche le tableau de bord —
// le geste de l'empreinte d'hôte SSH.
//
// ─── POURQUOI TIRÉE AU SORT, ET JAMAIS DÉRIVÉE D'UN SECRET ───────────────────
//
// Il la faut STABLE d'un redémarrage à l'autre, sinon chaque relance de la
// Reine ferait passer ses propres membres pour étrangers : elle est tirée UNE
// fois (`tirerEmpreinte`) et rangée dans la base de la ruche
// (`HiveStore.empreinteRuche`). Même base, même ruche, même empreinte — une
// base restaurée garde la sienne, une démo en mémoire en change à chaque
// relance, ce qui est exact.
//
// Elle était d'abord DÉRIVÉE de `HIVE_JWT_SECRET` (PBKDF2, sel fixe). Mais elle
// est DIFFUSÉE — à chaque nœud inscrit, et par tout membre découvrable à tout
// le segment : c'était offrir de quoi vérifier HORS LIGNE une supposition du
// secret qui signe les sessions d'administration, et le sel commun à toutes
// les ruches faisait servir un seul dictionnaire précalculé contre toutes. Le
// secret n'exige que 24 caractères : une phrase choisie à la main y tombait.
// Tirée au sort, elle ne dit plus rien de rien.

// ─── ET CE QU'ELLE N'EST PAS ─────────────────────────────────────────────────
//
// Une preuve. Elle est publique : n'importe qui peut la recopier. Elle
// RECONNAÎT, elle n'authentifie pas — l'authentification reste le billet
// (`acces.ts`) et le code d'appariement (`decouverte.ts`).
//
// Module PUR, FEUILLE, et SANS MODULE DE NODE : `protocol.ts` le lit pour
// valider le champ `ruche` de `registered`, et le tableau de bord embarque
// `protocol.ts`. Un seul `import 'node:crypto'` ici partait dans le paquet du
// navigateur (`tests/paquet-navigateur.test.ts` l'a vu) : le tirage passe donc
// par `crypto.getRandomValues`, le hasard cryptographique que Node et le
// navigateur exposent tous deux sans import.

/** L'alphabet de Crockford en minuscules : ni i, ni l, ni o, ni u — rien qui se confonde à l'œil. */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** Douze caractères de cet alphabet : 60 bits. */
export const EMPREINTE_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;

/** Base32 de Crockford, sans bourrage. */
export function base32Crockford(octets: Uint8Array, alphabet: string = ALPHABET): string {
  let sortie = '';
  let tampon = 0;
  let bits = 0;
  for (const o of octets) {
    tampon = (tampon << 8) | o;
    bits += 8;
    while (bits >= 5) {
      sortie += alphabet[(tampon >>> (bits - 5)) & 31];
      bits -= 5;
    }
    tampon &= (1 << bits) - 1;
  }
  if (bits > 0) sortie += alphabet[(tampon << (5 - bits)) & 31];
  return sortie;
}

/**
 * Une empreinte neuve : 60 bits de hasard cryptographique. Appelée une fois
 * dans la vie d'une ruche (`HiveStore.empreinteRuche`) — et par les bancs,
 * qui en fabriquent pour d'autres ruches.
 */
export function tirerEmpreinte(): string {
  return base32Crockford(crypto.getRandomValues(new Uint8Array(8))).slice(0, 12);
}

/** `abcd-efgh-jkmn` : la forme qu'un humain compare d'un écran à l'autre. */
export function formaterEmpreinte(empreinte: string): string {
  return `${empreinte.slice(0, 4)}-${empreinte.slice(4, 8)}-${empreinte.slice(8)}`;
}

/** Garde de protocole : la valeur vient du réseau. */
export function estEmpreinte(v: unknown): v is string {
  return typeof v === 'string' && EMPREINTE_RE.test(v);
}
