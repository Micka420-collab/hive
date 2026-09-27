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
// ─── POURQUOI DÉRIVÉE DU SECRET DE SESSION, ET POURQUOI LENTEMENT ────────────
//
// Il la faut STABLE d'un redémarrage à l'autre, sinon chaque relance de la
// Reine ferait passer ses propres membres pour étrangers. Aucune table ne la
// range ; `HIVE_JWT_SECRET` est déjà le secret propre à cette ruche, stable, et
// exigé hors simulation (`amorce.ts`).
//
// Mais elle est DIFFUSÉE : un HMAC rapide du secret offrirait à tout le segment
// de quoi le chercher hors ligne, à la vitesse d'un GPU, et ce secret signe les
// sessions d'administration. D'où PBKDF2, 100 000 itérations — le coût des mots
// de passe (auth.ts) — et une sortie tronquée à 60 bits : assez pour que deux
// ruches ne se confondent pas, trop peu pour servir à autre chose.
//
// ─── ET CE QU'ELLE N'EST PAS ─────────────────────────────────────────────────
//
// Une preuve. Elle est publique : n'importe qui peut la recopier. Elle
// RECONNAÎT, elle n'authentifie pas — l'authentification reste le billet
// (`acces.ts`) et le code d'appariement (`decouverte.ts`).
//
// Module PUR, FEUILLE, et SANS MODULE DE NODE : `protocol.ts` le lit pour
// valider le champ `ruche` de `registered`, et le tableau de bord embarque
// `protocol.ts`. Un seul `import 'node:crypto'` ici partait dans le paquet du
// navigateur (`tests/paquet-navigateur.test.ts` l'a vu) ; la DÉRIVATION vit
// donc chez le seul qui détient le secret, `orchestrator/auth.ts`.

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

/** `abcd-efgh-jkmn` : la forme qu'un humain compare d'un écran à l'autre. */
export function formaterEmpreinte(empreinte: string): string {
  return `${empreinte.slice(0, 4)}-${empreinte.slice(4, 8)}-${empreinte.slice(8)}`;
}

/** Garde de protocole : la valeur vient du réseau. */
export function estEmpreinte(v: unknown): v is string {
  return typeof v === 'string' && EMPREINTE_RE.test(v);
}
