// Cloudflare, en deux minutes — le module qui sait quoi faire sur CETTE machine.
//
// `npm run cli -- tunnel` sait DÉTECTER un `cloudflared` installé. Il ne sait
// pas aider quand il n'y en a pas, et surtout il ne règle pas le vrai défaut du
// tunnel rapide : SON URL CHANGE À CHAQUE REDÉMARRAGE.
//
// Ce détail a l'air mineur et ne l'est pas. Les nœuds mémorisent leur clé, donc
// ils survivent aux redémarrages — mais l'URL qu'ils ont apprise, elle, meurt
// avec le tunnel. Chaque relance de la ruche obligerait donc l'hôte à réémettre
// un billet pour CHAQUE membre. Une ruche communautaire ne tient pas à ce prix.
//
// D'où deux chemins, et la commande dit franchement lequel choisir :
//
//   • TUNNEL RAPIDE — aucun compte, aucune configuration, une URL en 5 s.
//     Parfait pour dépanner un ami cet après-midi. URL jetable.
//   • TUNNEL NOMMÉ — un compte Cloudflare et un domaine, dix minutes une fois,
//     puis une URL STABLE (wss://ruche.mondomaine.com/ws) que les invitations
//     peuvent contenir pour de bon.
//
// Module PUR : il ne fait que traduire une plateforme en commandes. Aucun
// téléchargement, aucun spawn, aucune écriture — l'exécution appartient à
// l'appelant, qui doit pouvoir la montrer avant de la lancer.

/** Ce qu'on sait de la machine, réduit à ce qui change les instructions. */
export interface Plateforme {
  os: NodeJS.Platform;
  arch: string;
}

/** Une façon d'installer `cloudflared`, avec ce qu'elle suppose. */
export interface MethodeInstallation {
  /** Identifiant court, pour les tests et l'affichage. */
  cle: string;
  /** Nom lisible. */
  nom: string;
  /** La commande à taper, telle quelle. */
  commande: string;
  /** Vrai si elle demande les droits administrateur. */
  privilegie: boolean;
  /** Vrai si Hive peut l'exécuter seul, sans interaction ni sudo. */
  automatisable: boolean;
}

const BASE_RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

/**
 * Nom de l'artefact publié par Cloudflare pour cette plateforme, ou `null` si
 * elle n'est pas couverte.
 *
 * `null` plutôt qu'une valeur approximative : proposer un binaire qui n'existe
 * pas produirait un 404 au téléchargement, et l'utilisateur croirait que Hive
 * est cassé alors que sa plateforme n'est simplement pas prévue.
 */
export function artefactCloudflared(p: Plateforme): string | null {
  const arch = p.arch === 'x64' ? 'amd64' : p.arch === 'arm64' ? 'arm64' : null;
  if (!arch) return null;
  if (p.os === 'linux') return `cloudflared-linux-${arch}`;
  if (p.os === 'win32') return `cloudflared-windows-${arch}.exe`;
  // macOS n'est publié qu'en archive .tgz — l'appelant doit la décompresser.
  if (p.os === 'darwin') return `cloudflared-darwin-${arch}.tgz`;
  return null;
}

/** URL de téléchargement direct, ou `null` si la plateforme n'est pas couverte. */
export function urlTelechargement(p: Plateforme): string | null {
  const artefact = artefactCloudflared(p);
  return artefact ? `${BASE_RELEASES}/${artefact}` : null;
}

/** Vrai si l'artefact de cette plateforme est une archive à décompresser. */
export function estArchive(p: Plateforme): boolean {
  return artefactCloudflared(p)?.endsWith('.tgz') ?? false;
}

/**
 * Méthodes d'installation, de la plus recommandée à la moins.
 *
 * Le TÉLÉCHARGEMENT LOCAL vient en tête sur Linux et Windows, avant les
 * gestionnaires de paquets, pour une raison précise : c'est la seule qui ne
 * demande PAS les droits administrateur. Demander un `sudo` pour « faire tourner
 * un agent avec un ami » est un obstacle sans rapport avec le besoin, et c'est
 * là que la plupart des gens abandonnent.
 *
 * Sur macOS, Homebrew passe devant : l'artefact y est une archive, donc
 * l'installation locale demande une étape de plus, et `brew` est quasi universel
 * sur cette plateforme.
 */
export function methodesInstallation(p: Plateforme): MethodeInstallation[] {
  const url = urlTelechargement(p);
  const local: MethodeInstallation | null = url
    ? {
        cle: 'local',
        nom: 'Binaire local (aucun droit administrateur)',
        commande: `npm run cli -- cloudflare --install`,
        privilegie: false,
        automatisable: !estArchive(p),
      }
    : null;

  const gestionnaires: MethodeInstallation[] = [];
  if (p.os === 'darwin') {
    gestionnaires.push({
      cle: 'brew',
      nom: 'Homebrew',
      commande: 'brew install cloudflared',
      privilegie: false,
      automatisable: false,
    });
  } else if (p.os === 'win32') {
    gestionnaires.push({
      cle: 'winget',
      nom: 'winget',
      commande: 'winget install --id Cloudflare.cloudflared',
      privilegie: true,
      automatisable: false,
    });
  } else if (p.os === 'linux') {
    gestionnaires.push({
      cle: 'apt',
      nom: 'Debian / Ubuntu (paquet .deb)',
      commande:
        `curl -fsSLO ${BASE_RELEASES}/cloudflared-linux-${p.arch === 'arm64' ? 'arm64' : 'amd64'}.deb` +
        ` && sudo dpkg -i cloudflared-linux-${p.arch === 'arm64' ? 'arm64' : 'amd64'}.deb`,
      privilegie: true,
      automatisable: false,
    });
  }

  const ordre =
    p.os === 'darwin'
      ? [...gestionnaires, ...(local ? [local] : [])]
      : [...(local ? [local] : []), ...gestionnaires];
  return ordre;
}

// ─── Le tunnel nommé (URL stable) ─────────────────────────────────────────────

/** Une étape de la mise en place, avec ce qu'elle fait et ce qu'elle suppose. */
export interface EtapeSetup {
  cle: string;
  titre: string;
  commande: string;
  /** Vrai si l'étape ouvre un navigateur / attend une action humaine. */
  interactive: boolean;
  /** Pourquoi cette étape existe — affiché, pas seulement commenté. */
  pourquoi: string;
}

/**
 * Vrai si `hote` ressemble à un nom d'hôte qualifié utilisable pour un tunnel.
 *
 * Volontairement STRICT : une faute ici ne se voit qu'à l'étape DNS, plusieurs
 * commandes plus loin, avec un message de Cloudflare que personne ne relie à sa
 * frappe. Mieux vaut refuser tout de suite et dire quoi écrire.
 */
export function hoteValide(hote: string): boolean {
  if (hote.length === 0 || hote.length > 253) return false;
  if (hote.includes('://') || hote.includes('/') || hote.includes(' ')) return false;
  const labels = hote.split('.');
  if (labels.length < 2) return false; // il faut au moins un domaine et un TLD
  return labels.every((l) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(l) && l.length <= 63);
}

/**
 * Les étapes d'un tunnel nommé, dans l'ordre. Fonction PURE : elle décrit, elle
 * n'exécute pas — l'hôte doit pouvoir lire ce qu'on s'apprête à faire sur son
 * compte Cloudflare avant que ça arrive.
 */
export function etapesTunnelNomme(nom: string, hote: string, port: number): EtapeSetup[] {
  return [
    {
      cle: 'login',
      titre: 'Autoriser Hive sur votre compte Cloudflare',
      commande: 'cloudflared tunnel login',
      interactive: true,
      pourquoi:
        'Ouvre votre navigateur pour choisir le domaine à utiliser. Cloudflare dépose un\n' +
        '     certificat dans ~/.cloudflared/ — il reste sur votre machine.',
    },
    {
      cle: 'create',
      titre: `Créer le tunnel « ${nom} »`,
      commande: `cloudflared tunnel create ${nom}`,
      interactive: false,
      pourquoi:
        'Génère un identifiant de tunnel et ses identifiants de connexion (fichier JSON\n' +
        '     local). Une seule fois : le tunnel survit aux redémarrages.',
    },
    {
      cle: 'dns',
      titre: `Router ${hote} vers ce tunnel`,
      commande: `cloudflared tunnel route dns ${nom} ${hote}`,
      interactive: false,
      pourquoi:
        'Crée l’enregistrement DNS chez Cloudflare. C’EST CE QUI REND L’URL STABLE :\n' +
        '     vos invitations pourront la contenir pour de bon.',
    },
    {
      cle: 'run',
      titre: 'Lancer le tunnel',
      commande: `cloudflared tunnel run --url http://127.0.0.1:${port} ${nom}`,
      interactive: false,
      pourquoi:
        'À relancer à chaque démarrage de la ruche (ou à installer en service avec\n' +
        '     `cloudflared service install`).',
    },
  ];
}

/** L'URL WebSocket stable qu'un tunnel nommé rend disponible. */
export function urlStable(hote: string): string {
  return `wss://${hote}/ws`;
}
