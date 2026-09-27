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
// La confiance se donne donc à des ADRESSES — celles du proxy. `true` est
// refusé, et un refus ne relâche rien : on retombe sur « aucune confiance ».
//
// ─── POURQUOI UN NOMBRE DE SAUTS EST REFUSÉ LUI AUSSI ────────────────────────
//
// « Croire les n premiers sauts » ne regarde jamais QUI parle : le premier saut
// est la socket, et la socket d'un client joignable en direct est le client
// lui-même. Avec `1`, il suffisait donc d'écrire `X-Forwarded-For` pour changer
// de compteur à chaque requête. Mesuré sur une Reine liée à une adresse LAN :
// 60 connexions ratées, un X-Forwarded-For tournant — jamais de 429 avec `1`,
// un 429 à la 21e sans réglage ou avec `loopback`. Fastify (5.12) ferme lui-même
// ce chemin pour la même raison : un nombre n'y fait plus confiance à personne.
// Seule une confiance par ADRESSE vérifie que le pair est bien le proxy.
//
// ─── CE QUI EST ACCEPTÉ ──────────────────────────────────────────────────────
//
//   (vide), 0, false, off, non   → aucune confiance (défaut : exposition directe)
//   liste séparée par virgules   → IP, CIDR, ou plages nommées de proxy-addr :
//                                  loopback, linklocal, uniquelocal
//
// Exemples : `loopback` (Caddy sur la même machine), `uniquelocal` (Caddy dans
// le réseau Docker du compose), `172.18.0.0/16`.

import { isIP } from 'node:net';

export type ConfianceProxy = false | string;

export interface LectureConfianceProxy {
  /** Ce que Fastify recevra en `trustProxy`. `false` quand rien n'est accordé. */
  readonly valeur: ConfianceProxy;
  /** La raison d'un refus, à dire au démarrage ; `null` si la valeur est prise. */
  readonly refus: string | null;
}

const AUCUNE = new Set(['', '0', 'false', 'off', 'non', 'no']);
const TOUT = new Set(['true', 'yes', 'oui', 'on', '*', 'all', 'tout']);
const PLAGES_NOMMEES = new Set(['loopback', 'linklocal', 'uniquelocal']);

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
        'client : nommez le proxy (loopback, uniquelocal, une IP ou un CIDR). Aucune confiance ' +
        'accordée en attendant.',
    };
  }
  if (/^\d+$/.test(texte)) {
    return {
      valeur: false,
      refus:
        `HIVE_TRUST_PROXY=${texte} : un nombre de sauts n'est plus accepté — il ferait croire le ` +
        'X-Forwarded-For de tout client joignable en direct. Valeurs acceptées : loopback (proxy ' +
        'sur la même machine), uniquelocal (réseau privé, Docker), linklocal, une IP ou un CIDR ' +
        '(plusieurs séparés par des virgules), ou vide. Aucune confiance accordée en attendant.',
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
