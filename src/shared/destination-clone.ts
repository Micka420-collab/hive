// Les destinations de clonage — vers OÙ la Reine a le droit d'envoyer git.
//
// ─── LE TROU (#521) ──────────────────────────────────────────────────────────
//
// La Reine clone les dépôts des projets pour le Rayon (`orchestrator/miroir.ts`).
// `isValidRemoteRepoUrl` ne regardait que le SCHÉMA : en Cloud, tout compte
// authentifié pouvait faire émettre à la Reine une requête git vers l'adresse
// de son choix — un autre service du réseau Docker, `169.254.169.254` (les
// métadonnées d'un hébergeur), le `127.0.0.1` du serveur. Une SSRF aveugle,
// de forme git, mais une SSRF.
//
// ─── CE QUE CE MODULE FERME, ET COMMENT ──────────────────────────────────────
//
// Quatre portes, chacune pour un contournement connu :
//
//   1. LA FORME. On lit l'URL avec une grammaire FERMÉE, la plus petite qui
//      couvre les dépôts réels : un hôte en lettres, chiffres, `.`, `-`, `_`,
//      ou une IPv6 entre crochets. Tout ce sur quoi deux analyseurs
//      pourraient diverger est REFUSÉ, pas interprété : deux `@`, une
//      barre oblique inverse, un `%`, un point final, une IPv4 écrite en
//      octal ou en hexadécimal (`0x7f.1`, `2130706433`). Le classique de la
//      SSRF, c'est que le filtre et le client ne lisent pas le même hôte ;
//      ici, il n'y a qu'une lecture possible.
//   2. LA RÉSOLUTION. Le nom est résolu par `getaddrinfo` (`dns.lookup`) —
//      la fonction même qu'appellent curl et ssh — et TOUTES les adresses
//      rendues sont jugées : une seule interne refuse le dépôt. Juger la
//      première laisserait curl se connecter à la seconde.
//   3. L'ÉPINGLAGE. Entre notre résolution et celle de git, un nom à TTL nul
//      peut changer de réponse (« DNS rebinding ») : public pour le filtre,
//      `127.0.0.1` pour git. On ne laisse donc PAS git résoudre : en HTTP(S),
//      `http.curloptResolve` lui impose les adresses jugées ; en SSH,
//      `HostName` les impose à ssh, `HostKeyAlias` garde la vérification de
//      la clé d'hôte sur le NOM (le `known_hosts` du serveur reste valable).
//   4. LES REDIRECTIONS. git suit par défaut la redirection de sa première
//      requête : un dépôt public qui répond `302 → http://10.0.0.5/` mènerait
//      git là où le filtre n'a jamais regardé. `http.followRedirects=false`.
//
// `git://` est refusé en mode filtré : sans chiffrement ni vérification
// d'hôte, il n'apporte rien qu'HTTPS n'offre, et on ne peut pas l'épingler
// sans réécrire l'URL. GitHub l'a retiré en 2022.
//
// ─── CE QU'IL NE DÉCIDE PAS ──────────────────────────────────────────────────
//
// Ni QUI peut créer un projet (`server.ts`), ni le schéma admis
// (`isValidRepoUrl`). Les chemins locaux d'un administrateur ne passent pas
// par ici : ils ne quittent pas la machine. Et les CLONES DES NŒUDS non plus :
// une ouvrière clone sur la machine de son membre, dans SON réseau, avec SES
// identifiants — c'est un autre modèle de menace (voir docs/CLOUD.md).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// ─── La politique ────────────────────────────────────────────────────────────

/**
 * `libres` : l'ancien comportement — le schéma seul est vérifié. Défaut
 * Community : une ruche d'amis clone légitimement le Gitea du salon.
 * `filtrees` : formes ambiguës, adresses internes et redirections refusées,
 * destinations épinglées. Défaut Cloud.
 */
export type ModeDestinations = 'libres' | 'filtrees';

export interface PolitiqueDestinations {
  readonly mode: ModeDestinations;
  /**
   * `HIVE_CLONE_HOTES` : si non vide, SEULS ces hôtes se clonent, dans les
   * deux modes. `forge.exemple.org` désigne ce nom exact ; `*.exemple.org`
   * ses sous-domaines (pas `exemple.org` lui-même — écrivez les deux).
   */
  readonly hotes: readonly string[];
}

export const POLITIQUE_LIBRE: PolitiqueDestinations = { mode: 'libres', hotes: [] };

export interface LectureDestinations {
  readonly valeur: PolitiqueDestinations;
  /** La raison d'un refus, à dire au démarrage ; `null` si la valeur est prise. */
  readonly refus: string | null;
}

const ALIAS_MODE: Record<string, ModeDestinations> = {
  filtrees: 'filtrees',
  filtrées: 'filtrees',
  filtre: 'filtrees',
  libres: 'libres',
  libre: 'libres',
};

/** Un nom d'hôte de la liste : un nom DNS, éventuellement précédé de `*.`. */
const MOTIF_HOTE_LISTE =
  /^(\*\.)?(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,62}[a-z0-9_])?)*$/;

/**
 * Lit `HIVE_CLONE_DESTINATIONS` et `HIVE_CLONE_HOTES`. Ne lève jamais.
 *
 * Une valeur inconnue est un REFUS (la Reine ne démarre pas), et non un retour
 * au défaut : en Community, le défaut est `libres` — une faute de frappe dans
 * `filtrees` ouvrirait donc la porte qu'on croyait fermer, sans un mot.
 */
export function lireDestinationsClone(
  env: NodeJS.ProcessEnv,
  edition: 'community' | 'cloud',
): LectureDestinations {
  const defaut: ModeDestinations = edition === 'cloud' ? 'filtrees' : 'libres';
  const brutMode = (env.HIVE_CLONE_DESTINATIONS ?? '').trim().toLowerCase();
  const mode = brutMode === '' ? defaut : ALIAS_MODE[brutMode];
  const hotes = (env.HIVE_CLONE_HOTES ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  const invalides = hotes.filter((h) => !MOTIF_HOTE_LISTE.test(h));
  const prudente: PolitiqueDestinations = { mode: 'filtrees', hotes: [] };
  if (mode === undefined) {
    return {
      valeur: prudente,
      refus:
        `HIVE_CLONE_DESTINATIONS=${env.HIVE_CLONE_DESTINATIONS?.trim()} : valeur inconnue. ` +
        'Valeurs acceptées : filtrees (adresses internes refusées, défaut Cloud) ou libres ' +
        '(schéma seul vérifié, défaut Community).',
    };
  }
  if (invalides.length > 0) {
    return {
      valeur: prudente,
      refus:
        `HIVE_CLONE_HOTES : « ${invalides.join(', ')} » n'est pas un nom d'hôte. ` +
        'Écrivez des noms séparés par des virgules (github.com, *.gitlab.com), sans schéma ni port.',
    };
  }
  return { valeur: { mode, hotes }, refus: null };
}

// ─── La forme ────────────────────────────────────────────────────────────────

export type Transport = 'https' | 'http' | 'git' | 'ssh';

export interface Destination {
  readonly transport: Transport;
  /** L'hôte tel qu'écrit, en minuscules, SANS crochets pour une IPv6. */
  readonly hote: string;
  readonly port: number;
}

const PORTS: Record<Transport, number> = { https: 443, http: 80, git: 9418, ssh: 22 };

/** Un nom d'hôte DNS : étiquettes de 1 à 63 caractères, ni tiret ni point aux bords. */
const NOM = String.raw`[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9_])?(?:\.[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9_])?)*`;
const IPV6 = String.raw`\[[0-9A-Fa-f:.]{2,45}\]`;

/**
 * `schéma://[utilisateur@]hôte[:port]` suivi de `/`, `?`, `#` ou de la fin.
 * Ni `@` ni `%` dans l'utilisateur : `https://a@b@c/` ou un hôte encodé sont
 * lus différemment selon l'analyseur. Le CHEMIN, lui, reste libre — Azure
 * DevOps y met des `%20`.
 */
const MOTIF_URL = new RegExp(
  String.raw`^(https?|git|ssh)://(?:[^@/?#%\\\s]*@)?(${NOM}|${IPV6})(?::(\d{1,5}))?(?:[/?#]|$)`,
);

/** Les écritures d'une IPv4 qu'accepte `inet_aton` : `0x7f.1`, `2130706433`, `0177.0.0.1`… */
const IPV4_EXOTIQUE = /^(?:0x[0-9a-f]*|\d+)(?:\.(?:0x[0-9a-f]*|\d+)){0,3}$/i;
/** La forme « scp » de git : `[utilisateur@]hôte:chemin`, sans `//` après le `:`. */
const MOTIF_SCP = new RegExp(String.raw`^(?:[A-Za-z0-9._-]+@)?(${NOM}|${IPV6}):(?!//)`);

/**
 * Lit la destination réseau d'une URL de dépôt, ou `null` si elle n'en a pas
 * de lisible SANS AMBIGUÏTÉ. `null` ne veut pas dire « locale » : l'appelant
 * sait si l'URL est un chemin (`estCheminLocalAbsolu`).
 */
export function lireDestination(repoUrl: string): Destination | null {
  // Ce sur quoi deux analyseurs divergent : on ne l'interprète pas. WHATWG lit
  // `\` comme `/` dans une URL http(s), curl comme un caractère du nom.
  // eslint-disable-next-line no-control-regex
  if (/[\\\s\u0000-\u001f\u007f]/.test(repoUrl)) return null;
  let transport: Transport;
  let hoteBrut: string;
  let portBrut: string | undefined;
  const url = MOTIF_URL.exec(repoUrl);
  if (url) {
    transport = url[1]!.toLowerCase() as Transport;
    hoteBrut = url[2]!;
    portBrut = url[3];
  } else {
    const scp = MOTIF_SCP.exec(repoUrl);
    if (!scp) return null;
    transport = 'ssh';
    hoteBrut = scp[1]!;
  }
  const hote = (hoteBrut.startsWith('[') ? hoteBrut.slice(1, -1) : hoteBrut).toLowerCase();
  if (hoteBrut.startsWith('[') && isIP(hote) !== 6) return null;
  // Une IPv4 se lit en quatre décimaux canoniques, et SEULEMENT ainsi :
  // `getaddrinfo` accepte aussi `0x7f.1` ou `2130706433` (inet_aton), et
  // chaque outil n'en fait pas la même chose.
  if (!hoteBrut.startsWith('[') && IPV4_EXOTIQUE.test(hote)) {
    const canonique = isIP(hote) === 4 && !hote.split('.').some((o) => /^0\d/.test(o));
    if (!canonique) return null;
  }
  const port = portBrut === undefined ? PORTS[transport] : Number(portBrut);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return { transport, hote, port };
}

// ─── Les adresses ────────────────────────────────────────────────────────────

/** Une plage : préfixe en octets, longueur en bits, et ce qu'elle est. */
type Plage = readonly [prefixe: readonly number[], bits: number, nom: string];

/**
 * Tout ce qui n'est pas l'Internet public, d'après le registre IANA des
 * adresses à usage spécial (RFC 6890 et suivantes). Les métadonnées des
 * hébergeurs y tombent toutes : AWS/GCP/Azure en `169.254.169.254`, Alibaba en
 * `100.100.100.200` (CGNAT), Oracle en `192.0.0.192`, AWS IPv6 en
 * `fd00:ec2::254` (ULA).
 */
const PLAGES_V4: readonly Plage[] = [
  [[0], 8, 'ce réseau'],
  [[10], 8, 'privée (RFC 1918)'],
  [[100, 64], 10, 'partagée (CGNAT)'],
  [[127], 8, 'bouclage'],
  [[169, 254], 16, 'lien local (métadonnées cloud)'],
  [[172, 16], 12, 'privée (RFC 1918)'],
  [[192, 0, 0], 24, 'réservée IETF'],
  [[192, 0, 2], 24, 'documentation'],
  [[192, 88, 99], 24, 'relais 6to4'],
  [[192, 168], 16, 'privée (RFC 1918)'],
  [[198, 18], 15, 'banc d’essai'],
  [[198, 51, 100], 24, 'documentation'],
  [[203, 0, 113], 24, 'documentation'],
  [[224], 4, 'multidiffusion'],
  [[240], 4, 'réservée (dont diffusion)'],
];

const PLAGES_V6: readonly Plage[] = [
  [[], 96, 'IPv4 compatible (obsolète, dont :: et ::1)'],
  [[0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48, 'NAT64 local'],
  [[0x01, 0x00, 0, 0, 0, 0, 0, 0], 64, 'poubelle'],
  [[0x20, 0x01, 0x00], 23, 'protocoles IETF (dont Teredo)'],
  [[0x20, 0x01, 0x0d, 0xb8], 32, 'documentation'],
  [[0x20, 0x02], 16, '6to4 (obsolète)'],
  [[0x3f, 0xff], 20, 'documentation'],
  [[0x5f, 0x00], 16, 'SRv6'],
  [[0xfc], 7, 'locale unique (ULA)'],
  [[0xfe, 0x80], 10, 'lien local'],
  [[0xfe, 0xc0], 10, 'site local (obsolète)'],
  [[0xff], 8, 'multidiffusion'],
];

function dansPlage(octets: readonly number[], [prefixe, bits]: Plage): boolean {
  for (let i = 0; i < bits; i += 8) {
    const reste = Math.min(8, bits - i);
    const masque = (0xff << (8 - reste)) & 0xff;
    if (((octets[i / 8] ?? 0) & masque) !== ((prefixe[i / 8] ?? 0) & masque)) return false;
  }
  return true;
}

/** Les 16 octets d'une IPv6 textuelle (déjà validée par `isIP`), zone retirée. */
export function octetsIPv6(texte: string): number[] {
  let t = texte.split('%')[0]!.toLowerCase();
  const queueV4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t)?.[1];
  if (queueV4 !== undefined) {
    const [a, b, c, d] = queueV4.split('.').map(Number) as [number, number, number, number];
    t = `${t.slice(0, -queueV4.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [tete, queue] = t.includes('::') ? (t.split('::') as [string, string]) : [t, undefined];
  const groupes = (s: string): string[] => (s === '' ? [] : s.split(':'));
  const debut = groupes(tete);
  const fin = queue === undefined ? [] : groupes(queue);
  const zeros = queue === undefined ? [] : Array<string>(8 - debut.length - fin.length).fill('0');
  return [...debut, ...zeros, ...fin].flatMap((g) => {
    const v = parseInt(g, 16);
    return [v >> 8, v & 0xff];
  });
}

/**
 * La plage interne où tombe une adresse, ou `null` si elle est publique.
 *
 * Une IPv6 qui PORTE une IPv4 est jugée sur l'IPv4 : `::ffff:127.0.0.1`
 * (mappée) et `64:ff9b::a00:1` (NAT64 de `10.0.0.1`) mènent au même endroit
 * que leur IPv4, et ne doivent pas passer là où elle ne passe pas.
 */
export function plageInterne(adresse: string): string | null {
  const famille = isIP(adresse.split('%')[0]!);
  if (famille === 4) {
    const octets = adresse.split('.').map(Number);
    return PLAGES_V4.find((p) => dansPlage(octets, p))?.[2] ?? null;
  }
  if (famille !== 6) return 'adresse illisible';
  const octets = octetsIPv6(adresse);
  const mappee = dansPlage(octets, [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96, '']);
  const nat64 = dansPlage(octets, [[0x00, 0x64, 0xff, 0x9b], 96, '']);
  if (mappee || nat64) {
    const v4 = octets.slice(12);
    return PLAGES_V4.find((p) => dansPlage(v4, p))?.[2] ?? null;
  }
  return PLAGES_V6.find((p) => dansPlage(octets, p))?.[2] ?? null;
}

// ─── Le jugement ─────────────────────────────────────────────────────────────

export type MotifRefus = 'illisible' | 'transport' | 'hote_hors_liste' | 'introuvable' | 'interne';

/**
 * Un refus. `message` se montre à celui qui a donné l'URL : il ne dit JAMAIS
 * l'adresse qu'un nom a résolue — ce serait une cartographie du réseau du
 * serveur offerte à qui demande. `detail` est pour le journal de l'hôte.
 */
export class DestinationRefusee extends Error {
  constructor(
    readonly motif: MotifRefus,
    readonly detail: string,
  ) {
    super(MESSAGES[motif]);
    this.name = 'DestinationRefusee';
  }
}

const MESSAGES: Record<MotifRefus, string> = {
  illisible:
    'destination de clonage refusée : URL ambiguë (écrivez https://hôte/chemin, sans encodage ni IP en notation exotique)',
  transport: 'destination de clonage refusée : git:// n’est pas accepté ici, utilisez https://',
  hote_hors_liste: 'destination de clonage refusée : cet hôte n’est pas dans la liste de la ruche',
  introuvable: 'destination de clonage refusée : ce nom d’hôte ne se résout pas',
  interne: 'destination de clonage refusée : adresse interne au réseau du serveur',
};

/**
 * Ce que git doit recevoir pour aller EXACTEMENT là où le filtre a regardé.
 * `configGit` : des `-c` à poser avant la sous-commande. `optionsSsh` : à
 * ajouter à la commande ssh — composées d'une IP et d'un nom validés, donc
 * sûres dans `GIT_SSH_COMMAND`, que git passe à un shell.
 */
export interface Epinglage {
  readonly configGit: readonly string[];
  readonly optionsSsh: string;
}

export const SANS_EPINGLAGE: Epinglage = { configGit: [], optionsSsh: '' };

/** Résout un nom en TOUTES ses adresses (`dns.lookup` par défaut). */
export type Resolveur = (hote: string) => Promise<readonly string[]>;

/** Au-delà, un DNS qui ne répond pas est un nom qui ne se résout pas. */
export const DELAI_RESOLUTION_MS = 10_000;

const resoudreParDefaut: Resolveur = async (hote) =>
  (await lookup(hote, { all: true, verbatim: true })).map((r) => r.address);

function hoteListe(hote: string, liste: readonly string[]): boolean {
  return liste.some((entree) =>
    entree.startsWith('*.') ? hote.endsWith(entree.slice(1)) : hote === entree,
  );
}

function resoudreBorne(
  resoudre: Resolveur,
  hote: string,
  delaiMs: number,
): Promise<readonly string[]> {
  let minuteur: NodeJS.Timeout | undefined;
  return Promise.race([
    resoudre(hote),
    new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error(`pas de réponse en ${delaiMs} ms`)), delaiMs);
      minuteur.unref();
    }),
  ]).finally(() => clearTimeout(minuteur));
}

/**
 * Juge une URL de dépôt DISTANTE et rend l'épinglage à appliquer à git.
 * Lève `DestinationRefusee` sinon. Les chemins locaux ne passent pas ici.
 *
 * En mode `libres` sans liste d'hôtes, rien n'est résolu ni épinglé : c'est
 * le comportement d'avant, à l'identique.
 */
export async function verifierDestination(
  repoUrl: string,
  politique: PolitiqueDestinations,
  {
    resoudre = resoudreParDefaut,
    delaiMs = DELAI_RESOLUTION_MS,
  }: { resoudre?: Resolveur; delaiMs?: number } = {},
): Promise<Epinglage> {
  if (politique.mode === 'libres' && politique.hotes.length === 0) return SANS_EPINGLAGE;
  const dest = lireDestination(repoUrl);
  if (dest === null) throw new DestinationRefusee('illisible', 'forme non reconnue');
  if (politique.hotes.length > 0 && !hoteListe(dest.hote, politique.hotes)) {
    throw new DestinationRefusee('hote_hors_liste', dest.hote);
  }
  if (politique.mode === 'libres') return SANS_EPINGLAGE;
  if (dest.transport === 'git') throw new DestinationRefusee('transport', 'git://');

  let adresses: readonly string[];
  if (isIP(dest.hote) !== 0) {
    adresses = [dest.hote];
  } else {
    try {
      adresses = await resoudreBorne(resoudre, dest.hote, delaiMs);
    } catch (e) {
      throw new DestinationRefusee('introuvable', `${dest.hote} : ${(e as Error).message}`);
    }
    if (adresses.length === 0)
      throw new DestinationRefusee('introuvable', `${dest.hote} : aucune adresse`);
  }
  for (const adresse of adresses) {
    const plage = plageInterne(adresse);
    if (plage !== null) {
      throw new DestinationRefusee('interne', `${dest.hote} → ${adresse} (${plage})`);
    }
  }
  // Une IPv6 zonée (`fe80::1%eth0`) est déjà refusée (lien local) ; on retire
  // toute zone par principe — elle n'a rien à faire dans une option.
  const propres = adresses.map((a) => a.split('%')[0]!);
  return epingler(dest, propres);
}

function epingler(dest: Destination, adresses: readonly string[]): Epinglage {
  if (dest.transport === 'ssh') {
    // Une IP littérale n'a rien à épingler ; un nom garde sa clé d'hôte.
    if (isIP(dest.hote) !== 0) return SANS_EPINGLAGE;
    return {
      configGit: [],
      optionsSsh: `-o HostName=${adresses[0]!} -o HostKeyAlias=${dest.hote}`,
    };
  }
  const configGit = ['-c', 'http.followRedirects=false'];
  if (isIP(dest.hote) === 0) {
    const liste = adresses.map((a) => (isIP(a) === 6 ? `[${a}]` : a)).join(',');
    configGit.push('-c', `http.curloptResolve=${dest.hote}:${dest.port}:${liste}`);
  }
  return { configGit, optionsSsh: '' };
}
