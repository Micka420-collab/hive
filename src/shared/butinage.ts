// LE BUTINAGE — où une abeille a le droit d'aller chercher du nectar, et à
// quelles conditions elle a le droit de le rapporter.
//
// MODULE PUR. Aucune requête réseau ici : ce fichier ne fait que JUGER. Ce qui
// va sur le réseau vit ailleurs, et ne part qu'après un verdict favorable.
//
// ─── CE QUI EST REPRIS DE COBALT.TOOLS, ET CE QUI NE L'EST PAS ───────────────
//
// `cobalt.tools` prend une URL et rend un média. Sa sûreté ne vient PAS d'un
// filtre sur ce qu'il télécharge : elle vient de trois refus posés AVANT la
// requête.
//
//   1. une liste FERMÉE de sources — jamais une URL libre ;
//   2. une FORME d'URL exigée par source — le reste est refusé sans être lu ;
//   3. le contenu rapporté n'est JAMAIS exécuté, seulement transporté.
//
// Ce squelette vaut ici. Ce qui ne vaut pas : cobalt rapporte un média, une
// donnée inerte. Nous rapportons du CODE, qui est une instruction. Le troisième
// point devient donc la règle la plus dure de ce module — voir « la butineuse
// propose, elle ne fusionne jamais », plus bas.
//
// ─── LES QUATRE FAÇONS DONT CETTE PORTE PEUT ÊTRE FORCÉE ─────────────────────
//
// 1. LA SOURCE MENT SUR ELLE-MÊME. `https://github.com.evil.tld/...` contient
//    « github.com » et n'est pas GitHub. On compare donc l'hôte ENTIER, jamais
//    par `includes`.
//
// 2. LA RUCHE SE PARLE À ELLE-MÊME (SSRF). Une URL qui pointe sur `localhost`,
//    sur une adresse privée, ou sur `169.254.169.254` fait sortir la requête
//    du réseau public pour la faire rentrer dans l'infrastructure. Le service
//    de métadonnées d'un hébergeur rend des identifiants à qui les demande
//    depuis l'intérieur. Refusé par forme, pas par résolution DNS — une
//    résolution peut changer entre la vérification et la requête.
//
// 3. LA RÉFÉRENCE BOUGE. `.../archive/main.tar.gz` ne désigne pas un contenu :
//    il désigne « ce qu'il y aura là quand on ira voir ». Deux butinages de la
//    même URL peuvent rendre deux codes différents, et celui qu'un humain a
//    relu n'est pas celui qui sera installé. On exige une référence IMMUABLE.
//
// 4. LES IDENTIFIANTS PARTENT AVEC LA REQUÊTE. `https://jeton@hôte/...` glisse
//    un secret dans une URL qui finira dans un journal. Refusé.

import { champSurUneLigne } from './donnees-non-fiables.js';

/** Taille maximale d'une charge butinée, avant décompression. 25 Mio. */
export const BUTIN_OCTETS_MAX = 25 * 1024 * 1024;

/** Longueur maximale d'une URL acceptée à l'entrée. */
export const URL_LONGUEUR_MAX = 2048;

/**
 * Les sources dont la ruche sait vérifier la FORME.
 *
 * Une source ne s'ajoute pas ici parce qu'elle est populaire : elle s'y ajoute
 * quand on sait écrire le motif de ses URL immuables. Sans ce motif, on ne
 * saurait pas distinguer une référence figée d'une référence mouvante — et
 * c'est toute la garantie du point 3.
 */
export const SOURCES_CONNUES = [
  {
    hote: 'codeload.github.com',
    /** `/{owner}/{repo}/tar.gz/{sha40}` — une archive à un commit exact. */
    motif: /^\/[\w.-]{1,100}\/[\w.-]{1,100}\/tar\.gz\/[0-9a-f]{40}$/,
    quoi: 'archive GitHub épinglée à un commit',
  },
  {
    hote: 'registry.npmjs.org',
    /** `/{paquet}/-/{paquet}-{version}.tgz` — une version publiée est figée. */
    motif: /^\/(?:@[\w.-]{1,100}\/)?[\w.-]{1,100}\/-\/[\w.-]{1,140}\.tgz$/,
    quoi: 'tarball npm à une version publiée',
  },
  {
    hote: 'files.pythonhosted.org',
    /** Le chemin porte le condensat : le contenu ne peut pas changer sous lui. */
    motif: /^\/packages\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{60}\/[\w.+-]{1,180}$/,
    quoi: 'archive PyPI adressée par condensat',
  },
] as const satisfies readonly SourceConnue[];

export interface SourceConnue {
  readonly hote: string;
  readonly motif: RegExp;
  readonly quoi: string;
}

export type MotifRefusButinage =
  | 'url_illisible'
  | 'url_trop_longue'
  | 'schema_refuse'
  | 'identifiants_dans_url'
  | 'port_refuse'
  | 'hote_prive'
  | 'hote_inconnu'
  | 'forme_refusee'
  | 'reference_mouvante';

export type VerdictButinage =
  | { readonly ok: true; readonly url: string; readonly hote: string; readonly quoi: string }
  | { readonly ok: false; readonly motif: MotifRefusButinage; readonly detail: string };

/**
 * Les hôtes qu'une requête sortante ne doit JAMAIS atteindre, reconnus par
 * forme littérale.
 *
 * On ne résout pas le nom : entre la résolution et la requête, la réponse DNS
 * peut changer (rebinding). Ce n'est donc pas une garde suffisante à elle
 * seule — c'est pour cela que la liste blanche d'hôtes existe au-dessus.
 * Celle-ci attrape le cas grossier, et surtout elle DOCUMENTE la menace.
 */
const RE_HOTE_INTERDIT = new RegExp(
  [
    '^localhost$',
    '^.*\\.localhost$',
    '^\\[?::1\\]?$',
    '^127\\.',
    '^10\\.',
    '^192\\.168\\.',
    '^172\\.(?:1[6-9]|2\\d|3[01])\\.',
    // Le service de métadonnées des hébergeurs : il rend des identifiants à
    // qui les demande depuis l'intérieur du réseau. La cible SSRF classique.
    '^169\\.254\\.',
    '^0\\.',
    '^\\[?f[cd][0-9a-f]{2}:',
    '^\\[?fe80:',
  ].join('|'),
  'i',
);

/** Une référence git qui bouge : `main`, `HEAD`, `latest`, une branche. */
const RE_REFERENCE_MOUVANTE = /\/(?:main|master|head|latest|dev|develop|next)(?:\.|\/|$)/i;

/**
 * Cette URL est-elle une source où la ruche accepte d'aller butiner ?
 *
 * Rend l'URL NORMALISÉE en cas d'accord — pas celle qu'on lui a donnée. Deux
 * écritures de la même cible doivent rendre la même chaîne, sinon tout ce qui
 * compte des URL (une limite de débit, une liste de blocage, un journal)
 * compte des fantômes.
 */
export function jugerSourceButinage(brut: unknown): VerdictButinage {
  if (typeof brut !== 'string' || brut.trim() === '') {
    return { ok: false, motif: 'url_illisible', detail: 'Aucune adresse fournie.' };
  }
  const texte = brut.trim();
  if (texte.length > URL_LONGUEUR_MAX) {
    return {
      ok: false,
      motif: 'url_trop_longue',
      detail: `Une adresse dépasse ${URL_LONGUEUR_MAX} caractères — refusée avant d'être analysée.`,
    };
  }

  let url: URL;
  try {
    url = new URL(texte);
  } catch {
    return { ok: false, motif: 'url_illisible', detail: 'Adresse que le format URL ne lit pas.' };
  }

  if (url.protocol !== 'https:') {
    return {
      ok: false,
      motif: 'schema_refuse',
      detail: `Seul « https: » est accepté ; reçu « ${champSurUneLigne(url.protocol, 20)} ».`,
    };
  }
  // `https://jeton@hôte/` : un secret glissé dans une adresse qui finira dans
  // un journal, un cache, ou un message d'erreur.
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      motif: 'identifiants_dans_url',
      detail: 'Une adresse ne porte pas d’identifiants — ils finiraient dans les journaux.',
    };
  }
  if (url.port !== '' && url.port !== '443') {
    return {
      ok: false,
      motif: 'port_refuse',
      detail: `Port « ${champSurUneLigne(url.port, 10)} » refusé : le butinage passe par 443.`,
    };
  }
  if (RE_HOTE_INTERDIT.test(url.hostname)) {
    return {
      ok: false,
      motif: 'hote_prive',
      detail:
        'Cette adresse pointe vers le réseau interne. Une requête sortante ne doit pas rentrer.',
    };
  }

  // L'hôte se compare EN ENTIER. `github.com.evil.tld` contient « github.com »
  // et n'est pas GitHub ; un `includes` ouvrirait la porte à qui sait acheter
  // un nom de domaine.
  const source = SOURCES_CONNUES.find((s) => s.hote === url.hostname.toLowerCase());
  if (!source) {
    return {
      ok: false,
      motif: 'hote_inconnu',
      detail: `« ${champSurUneLigne(url.hostname, 120)} » n’est pas une source déclarée.`,
    };
  }

  if (RE_REFERENCE_MOUVANTE.test(url.pathname)) {
    return {
      ok: false,
      motif: 'reference_mouvante',
      detail:
        'Cette référence désigne « ce qu’il y aura là plus tard », pas un contenu. ' +
        'Épinglez un commit ou une version.',
    };
  }
  if (!source.motif.test(url.pathname)) {
    return {
      ok: false,
      motif: 'forme_refusee',
      detail: `Chemin hors de la forme attendue pour ${source.quoi}.`,
    };
  }

  // Normalisation : hôte en minuscules, ni requête ni fragment — ils ne
  // désignent rien pour une archive, et deux écritures d'une même cible
  // doivent rendre la même chaîne.
  const normalisee = `https://${url.hostname.toLowerCase()}${url.pathname}`;
  return { ok: true, url: normalisee, hote: url.hostname.toLowerCase(), quoi: source.quoi };
}

/** Ce qu'un humain doit lire quand la porte s'est fermée. */
export function expliquerRefusButinage(
  motif: MotifRefusButinage,
  lang: 'fr' | 'en' = 'fr',
): string {
  const fr: Record<MotifRefusButinage, string> = {
    url_illisible: 'Adresse illisible.',
    url_trop_longue: 'Adresse trop longue.',
    schema_refuse: 'Seul https est accepté.',
    identifiants_dans_url: 'Une adresse ne porte pas d’identifiants.',
    port_refuse: 'Port non autorisé.',
    hote_prive: 'Adresse du réseau interne refusée.',
    hote_inconnu: 'Source non déclarée.',
    forme_refusee: 'Forme d’adresse inattendue pour cette source.',
    reference_mouvante: 'Référence mouvante : épinglez un commit ou une version.',
  };
  const en: Record<MotifRefusButinage, string> = {
    url_illisible: 'Unreadable address.',
    url_trop_longue: 'Address too long.',
    schema_refuse: 'Only https is accepted.',
    identifiants_dans_url: 'An address must not carry credentials.',
    port_refuse: 'Port not allowed.',
    hote_prive: 'Internal-network address refused.',
    hote_inconnu: 'Source not declared.',
    forme_refusee: 'Unexpected address shape for this source.',
    reference_mouvante: 'Moving reference: pin a commit or a version.',
  };
  return (lang === 'en' ? en : fr)[motif];
}
