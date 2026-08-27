// LE TRANSPORT DU BUTINAGE — ce qui se décide AVANT et PENDANT le
// téléchargement, sans jamais toucher au réseau.
//
// Les deux portes existantes jugent l'ADRESSE (`butinage.ts`) et le CONTENU
// une fois lu (`nectar-suspect.ts`). Entre les deux, il y a le trajet — et
// c'est là que vivent les défauts qu'aucune des deux ne peut voir, parce
// qu'ils naissent de la conversation avec un serveur qu'on ne contrôle pas.
//
// ═══ CE QUE CE MODULE REFUSE, ET POURQUOI CHAQUE REFUS EST NÉCESSAIRE ═══════
//
// ─── 1. AUCUNE REDIRECTION N'EST SUIVIE ──────────────────────────────────────
//
// Une redirection rend une adresse qui n'est PAS passée par la porte 1. Un
// hôte de la liste blanche peut répondre « 302 → http://169.254.169.254/… » et
// toute la liste blanche devient décorative. C'est la forme canonique du SSRF,
// et la seule défense qui tienne est de traiter la redirection comme une
// ERREUR, jamais comme une étape.
//
// Re-soumettre l'adresse de destination à la porte 1 serait tentant et
// insuffisant : entre le contrôle et la requête suivante, le DNS peut changer
// (rebinding). On refuse.
//
// ─── 2. `Content-Length` EST UNE DÉCLARATION, PAS UN FAIT ────────────────────
//
// C'est une valeur envoyée par le serveur d'en face. Il peut l'omettre, mentir,
// ou annoncer 1 Kio et servir 40 Gio. Le plafond doit donc être appliqué DEUX
// fois : sur l'annonce (pour refuser sans rien lire quand elle est franche),
// et sur le flux OCTET PAR OCTET (parce que l'annonce ne prouve rien).
//
// Un plafond qui ne s'applique qu'à l'annonce est pire qu'aucun plafond : il
// donne l'impression que la question est traitée.
//
// ─── 3. LE PLAFOND SE COMPTE APRÈS DÉCOMPRESSION ─────────────────────────────
//
// `fetch` décompresse `Content-Encoding: gzip` tout seul. Un fichier de 40 Kio
// sur le fil peut en rendre 4 Gio à la lecture — la bombe de décompression.
// Compter les octets du FIL laisserait passer exactement l'attaque que le
// plafond existe pour arrêter. On compte ce qu'on lit, jamais ce qui a voyagé.
//
// ─── 4. LE NOM DU FICHIER NE VIENT JAMAIS D'EN FACE ──────────────────────────
//
// Ni de `Content-Disposition`, ni du chemin de l'URL. Les deux sont écrits par
// l'autre bout, et un nom comme `../../.ssh/authorized_keys` ou `C:\…` sort de
// la quarantaine au moment même où on croit y écrire. Le nom est DÉRIVÉ du
// condensat de l'URL normalisée : impossible à influencer, stable d'une fois
// sur l'autre, et il ne dit rien de ce que le serveur voulait qu'on croie.
//
// ─── 5. UN DÉLAI MAXIMAL ─────────────────────────────────────────────────────
//
// Un serveur qui envoie un octet toutes les trente secondes ne dépasse aucun
// plafond de taille et retient une ouvrière pour toujours. Le plafond de temps
// est la seule borne qui l'arrête.

/** Au-delà, on cesse de lire — que le serveur ait annoncé ou non. */
export const BUTIN_DELAI_MS = 60_000;

/**
 * Les seuls types que la ruche accepte de RECEVOIR.
 *
 * Volontairement court : on butine des archives, pas des pages. Un `text/html`
 * là où on attend un tarball est le signe d'un portail captif, d'une page
 * d'erreur, ou d'une redirection déguisée en 200 — trois choses qu'il vaut
 * mieux voir refusées que déballées.
 */
export const TYPES_ACCEPTES = [
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/octet-stream',
  'application/zip',
] as const;

export type MotifRefusTransport =
  | 'statut_refuse'
  | 'redirection'
  | 'type_refuse'
  | 'annonce_trop_grosse'
  | 'trop_gros'
  | 'condensat_absent'
  | 'condensat_faux'
  | 'delai_depasse'
  | 'transport_casse';

export interface RefusTransport {
  readonly ok: false;
  readonly motif: MotifRefusTransport;
  readonly detail: string;
}

/**
 * Le jugement des en-têtes, AVANT de lire le premier octet du corps.
 *
 * Pur : on lui donne ce que la réponse a dit, il rend un verdict. Ce qui rend
 * la partie la plus délicate du transport éprouvable sans réseau.
 *
 * @param statut       le code HTTP rendu
 * @param contentType  l'en-tête `Content-Type`, tel quel (peut porter `; charset=`)
 * @param contentLength l'en-tête `Content-Length`, tel quel (souvent absent)
 * @param plafondOctets le plafond de taille en vigueur
 */
export function jugerEnTetes(
  statut: number,
  contentType: string | null,
  contentLength: string | null,
  plafondOctets: number,
): { readonly ok: true } | RefusTransport {
  // La redirection AVANT le reste : elle n'est pas une erreur de plus, c'est
  // la seule qui contourne la porte 1. Elle mérite son propre motif pour que
  // le journal la distingue d'un 404.
  if (statut >= 300 && statut < 400) {
    return {
      ok: false,
      motif: 'redirection',
      detail:
        `Le serveur redirige (${statut}). Une redirection rend une adresse qui n'est PAS ` +
        'passée par la porte du butinage — elle est refusée, jamais suivie.',
    };
  }
  if (statut !== 200) {
    return { ok: false, motif: 'statut_refuse', detail: `Réponse ${statut}, seul 200 est lu.` };
  }

  // `Content-Type: application/gzip; charset=binary` — le paramètre après le
  // point-virgule ne fait pas partie du type. Le comparer entier refuserait
  // des réponses parfaitement valides.
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!(TYPES_ACCEPTES as readonly string[]).includes(type)) {
    return {
      ok: false,
      motif: 'type_refuse',
      detail:
        `Type « ${type === '' ? 'absent' : type} » là où une archive est attendue. ` +
        'Une page HTML à cette place est un portail captif ou une erreur déguisée en 200.',
    };
  }

  // Absent : ce n'est PAS un refus. Beaucoup de serveurs légitimes n'annoncent
  // rien en `chunked`. Le plafond du flux fait le travail — et c'est lui qui
  // compte de toute façon, l'annonce n'étant qu'une politesse.
  if (contentLength !== null && contentLength.trim() !== '') {
    const annonce = Number(contentLength);
    if (Number.isFinite(annonce) && annonce > plafondOctets) {
      return {
        ok: false,
        motif: 'annonce_trop_grosse',
        detail: `Le serveur annonce ${annonce} octets, le plafond est ${plafondOctets}.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Le compteur du flux : a-t-on dépassé en lisant ce morceau ?
 *
 * Trivial, et c'est le point : la garde qui compte n'est pas compliquée, elle
 * est SYSTÉMATIQUE. Elle existe séparément pour être éprouvée sans réseau, et
 * pour qu'on ne puisse pas la « simplifier » en la fondant dans la boucle de
 * lecture, où plus personne ne la relit.
 */
export function depasseLePlafond(dejaLus: number, morceau: number, plafond: number): boolean {
  return dejaLus + morceau > plafond;
}

/**
 * Le nom sous lequel un butin est mis en quarantaine.
 *
 * Dérivé du condensat de l'URL normalisée, JAMAIS d'un nom fourni par le
 * serveur (voir l'en-tête, § 4). Il ne contient que des chiffres hexadécimaux :
 * aucun séparateur de chemin, aucun point d'échappement, aucun nom réservé de
 * Windows ne peut en sortir.
 *
 * @param condensatUrl condensat hexadécimal de l'URL normalisée
 */
export function nomDeQuarantaine(condensatUrl: string): string {
  const propre = condensatUrl.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (propre.length < 16) {
    throw new Error('nomDeQuarantaine : condensat trop court pour nommer un butin.');
  }
  return `butin-${propre.slice(0, 32)}.bin`;
}

/**
 * Le condensat reçu est-il celui qu'on attendait ?
 *
 * ─── POURQUOI C'EST OBLIGATOIRE, ET PAS UNE OPTION ───────────────────────────
 *
 * Sans condensat attendu, « la même URL » ne veut rien dire dans le temps : un
 * dépôt peut republier une version sous le même nom, un miroir peut servir
 * autre chose, un intermédiaire peut substituer. L'adresse dit OÙ ; seul le
 * condensat dit QUOI.
 *
 * La comparaison n'est pas à temps constant, et c'est délibéré : il ne s'agit
 * pas d'un secret. Un attaquant qui peut mesurer ce temps connaît déjà le
 * condensat attendu — il est public, il vient de la demande.
 */
export function verifierCondensat(
  attendu: unknown,
  obtenu: string,
): { readonly ok: true } | RefusTransport {
  if (typeof attendu !== 'string' || !/^[0-9a-f]{64}$/i.test(attendu.trim())) {
    return {
      ok: false,
      motif: 'condensat_absent',
      detail:
        'Aucun condensat SHA-256 attendu. L’adresse dit OÙ, le condensat dit QUOI — ' +
        'sans lui, rien ne distingue le paquet demandé de celui qui a pris sa place.',
    };
  }
  if (attendu.trim().toLowerCase() !== obtenu.toLowerCase()) {
    return {
      ok: false,
      motif: 'condensat_faux',
      detail: `Condensat attendu ${attendu.trim().toLowerCase()}, reçu ${obtenu.toLowerCase()}.`,
    };
  }
  return { ok: true };
}

/** Le refus, dit à un humain. */
export function expliquerRefusTransport(r: RefusTransport): string {
  return `Butinage interrompu (${r.motif}) : ${r.detail}`;
}
