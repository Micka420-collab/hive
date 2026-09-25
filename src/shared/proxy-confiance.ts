// À qui la Reine fait-elle confiance pour lui dire l'IP d'un client ?
//
// ─── LE DÉFAUT QUE CE MODULE RETIRE ──────────────────────────────────────────
//
// Fastify était créé sans `trustProxy`. Derrière Caddy — la topologie que
// `docker-compose.cloud.yml` déploie —, `req.ip` valait donc l'adresse de CADDY
// pour tous les clients. Tous les compteurs anti-abus rangés par IP (débit
// REST, échecs de connexion, inscriptions, `/api/rejoindre`) devenaient UN
// SEUL compteur partagé : un client qui s'acharne verrouillait tout le monde,
// et la protection contre la force brute comptait ensemble des inconnus.
//
// ─── POURQUOI ON NE PEUT PAS SIMPLEMENT DIRE « true » ────────────────────────
//
// `trustProxy: true` croit N'IMPORTE QUEL `X-Forwarded-For`. Sur une Reine
// joignable en direct, un client écrirait l'IP qu'il veut dans cet en-tête et
// changerait de compteur à chaque requête : le limiteur deviendrait décoratif.
// La confiance se donne donc à des ADRESSES — celles du proxy —, ou à un
// nombre de sauts quand on sait exactement combien il y en a. `true` est
// refusé, et un refus ne relâche rien : on retombe sur « aucune confiance ».
//
// ─── CE QUI EST ACCEPTÉ ──────────────────────────────────────────────────────
//
//   (vide), 0, false, off, non   → aucune confiance (défaut : exposition directe)
//   1 … 10                       → ce nombre de sauts de proxy
//   liste séparée par virgules   → IP, CIDR, ou plages nommées de proxy-addr :
//                                  loopback, linklocal, uniquelocal
//
// Exemples : `loopback` (Caddy sur la même machine), `uniquelocal` (Caddy dans
// le réseau Docker du compose), `172.18.0.0/16`.

import { isIP } from 'node:net';

export type ConfianceProxy = false | number | string;

export interface LectureConfianceProxy {
  /** Ce que Fastify recevra en `trustProxy`. `false` quand rien n'est accordé. */
  readonly valeur: ConfianceProxy;
  /** La raison d'un refus, à dire au démarrage ; `null` si la valeur est prise. */
  readonly refus: string | null;
}

const AUCUNE = new Set(['', '0', 'false', 'off', 'non', 'no']);
const TOUT = new Set(['true', 'yes', 'oui', 'on', '*', 'all', 'tout']);
const PLAGES_NOMMEES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const SAUTS_MAX = 10;

function jetonValide(jeton: string): boolean {
  if (PLAGES_NOMMEES.has(jeton)) return true;
  const barre = jeton.indexOf('/');
  if (barre === -1) return isIP(jeton) !== 0;
  const ip = jeton.slice(0, barre);
  const prefixe = jeton.slice(barre + 1);
  const famille = isIP(ip);
  if (famille === 0 || !/^\d{1,3}$/.test(prefixe)) return false;
  return Number(prefixe) <= (famille === 4 ? 32 : 128);
}

/** Lit `HIVE_TRUST_PROXY`. Ne lève jamais : un refus retombe sur `false`. */
export function lireConfianceProxy(brut: string | undefined): LectureConfianceProxy {
  const texte = (brut ?? '').trim().toLowerCase();
  if (AUCUNE.has(texte)) return { valeur: false, refus: null };
  if (TOUT.has(texte)) {
    return {
      valeur: false,
      refus:
        `HIVE_TRUST_PROXY=${brut?.trim()} ferait croire le X-Forwarded-For de n'importe quel ` +
        'client : nommez le proxy (loopback, uniquelocal, une IP ou un CIDR) ou son nombre de ' +
        'sauts. Aucune confiance accordée en attendant.',
    };
  }
  if (/^\d+$/.test(texte)) {
    const sauts = Number(texte);
    if (sauts >= 1 && sauts <= SAUTS_MAX) return { valeur: sauts, refus: null };
    return {
      valeur: false,
      refus: `HIVE_TRUST_PROXY=${texte} : un nombre de sauts va de 1 à ${SAUTS_MAX}. Aucune confiance accordée.`,
    };
  }
  const jetons = texte
    .split(',')
    .map((j) => j.trim())
    .filter((j) => j !== '');
  const invalides = jetons.filter((j) => !jetonValide(j));
  if (jetons.length === 0 || invalides.length > 0) {
    return {
      valeur: false,
      refus:
        `HIVE_TRUST_PROXY : ${invalides.length > 0 ? `« ${invalides.join(', ')} » n'est ni une IP, ni un CIDR, ni loopback / linklocal / uniquelocal` : 'valeur illisible'}. ` +
        'Aucune confiance accordée.',
    };
  }
  return { valeur: jetons.join(','), refus: null };
}

/**
 * La forme que Fastify accepte. Un nombre de sauts devient la fonction
 * qu'emploie `proxy-addr` pour un nombre : on croit les `n` premiers sauts
 * comptés depuis la socket. (Les types de Fastify n'acceptent pas le nombre
 * directement.)
 */
export function confiancePourFastify(
  valeur: ConfianceProxy,
): boolean | string | ((adresse: string, saut: number) => boolean) {
  if (typeof valeur === 'number') return (_adresse: string, saut: number) => saut < valeur;
  return valeur;
}
