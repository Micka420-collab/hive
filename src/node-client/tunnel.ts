// Le tunnel — comment un ami se connecte depuis l'autre bout du monde sans que
// personne n'ouvre un port.
//
// Le problème que ça résout : l'orchestrateur écoute sur localhost:7777. Une
// invitation ne peut donc annoncer qu'une IP de réseau local, et un ami hors du
// LAN ne peut pas rejoindre. Les issues classiques sont mauvaises :
//
//   • ouvrir un port sur la box — expose la ruche à l'Internet entier, en clair,
//     et suppose un accès à la configuration du routeur ;
//   • un VPN — lourd à mettre en place pour « juste faire tourner un agent » ;
//   • un reverse proxy — suppose un serveur et un nom de domaine.
//
// Un tunnel sortant règle les trois : c'est la MACHINE HÔTE qui se connecte au
// fournisseur, donc aucun port entrant, aucune configuration de routeur, et
// l'URL obtenue est en HTTPS — donc `wss://` pour le WebSocket, chiffré de bout
// en bout.
//
// AUCUNE DÉPENDANCE NPM AJOUTÉE. On ne fait que DÉTECTER un binaire déjà
// installé et le lancer. C'est délibéré : ajouter une dépendance de tunnel
// signifierait faire transiter le code source de tous les membres par un tiers
// que personne n'a choisi. Ici, l'hôte choisit son fournisseur, l'installe
// lui-même, et sait ce qu'il fait.

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { envSonde } from './agent-detect.js';

/** Fournisseurs connus, dans l'ordre de préférence. */
export interface Fournisseur {
  /** Binaire à chercher dans le PATH. */
  bin: string;
  /** Nom lisible. */
  nom: string;
  /** Arguments pour ouvrir un tunnel rapide vers un port local. */
  args: (port: number) => string[];
  /** Extrait l'URL publique d'une ligne de sortie, ou `null`. */
  extraireUrl: (ligne: string) => string | null;
  /** Comment l'installer, si absent. */
  installation: string;
}

/**
 * `cloudflared` en premier : son mode « quick tunnel » ne demande AUCUN compte,
 * AUCUNE configuration, et rend une URL HTTPS en quelques secondes. C'est le
 * seul qui tienne la promesse « facile à mettre en place ».
 */
export const FOURNISSEURS: readonly Fournisseur[] = [
  {
    bin: 'cloudflared',
    nom: 'Cloudflare Quick Tunnel',
    args: (port) => ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'],
    // cloudflared annonce son URL sur stderr, encadrée de bordures ASCII.
    extraireUrl: (l) => l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] ?? null,
    installation:
      'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
  },
  {
    bin: 'localtunnel',
    nom: 'localtunnel',
    args: (port) => ['--port', String(port)],
    extraireUrl: (l) => l.match(/https:\/\/[a-z0-9-]+\.loca\.lt/i)?.[0] ?? null,
    installation: 'npm i -g localtunnel',
  },
];

/**
 * Convertit une URL HTTPS de tunnel en URL WebSocket de ruche.
 * `https://x.trycloudflare.com` → `wss://x.trycloudflare.com/ws`
 *
 * Rend `null` sur une URL non HTTPS : un tunnel en clair n'aurait aucun intérêt
 * ici, puisque tout l'objet de cette commande est d'obtenir du chiffré.
 */
export function urlRucheDepuisTunnel(urlHttps: string): string | null {
  let u: URL;
  try {
    u = new URL(urlHttps);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  return `wss://${u.host}/ws`;
}

export interface TunnelOuvert {
  url: string;
  fournisseur: string;
  process: ChildProcess;
}

/**
 * Cherche un fournisseur installé. Rend `null` si aucun — l'appelant explique
 * alors comment en installer un, plutôt que d'échouer sur un « ENOENT » brut.
 */
export async function trouverFournisseur(): Promise<Fournisseur | null> {
  for (const f of FOURNISSEURS) {
    if (await binairePresent(f.bin)) return f;
  }
  return null;
}

function binairePresent(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    // `spawn` sans shell : jamais d'interpolation dans une commande.
    // `shell: false` EXPLICITE : verrouillé par tests/security-invariants.test.ts
    // (§5.1). Un shell ici ferait interpréter le nom du binaire par l'interpréteur.
    // ─── LE MÊME SOIN QUE LA SONDE D'AGENT, ET POUR LA MÊME RAISON ────────
    //
    // `main.ts` charge `.env` AVANT de préparer le bac. Sans `env`, l'enfant
    // hérite de tout `process.env` : HIVE_TOKEN, HIVE_JWT_SECRET et la clé
    // d'API partaient à un binaire nommé `docker`, `podman` ou `bwrap`
    // trouvé dans le PATH — c'est-à-dire à n'importe quel homonyme déposé
    // en tête de PATH.
    //
    // La garde existait déjà, pure et testée, pour la sonde d'agent ; elle
    // n'avait simplement pas été portée ici. C'est le § 9 bis du journal :
    // deux chemins pour un même geste, dont l'un est soigné et l'autre non.
    const p = spawn(bin, ['--version'], {
      stdio: 'ignore',
      shell: false,
      env: envSonde(process.env),
    });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0 || code === 1));
    setTimeout(() => {
      p.kill();
      resolve(false);
    }, 5_000).unref?.();
  });
}

/**
 * Ouvre un tunnel vers `port` et attend son URL publique.
 *
 * Le délai d'attente est une vraie garde : sans lui, un fournisseur qui démarre
 * sans jamais annoncer d'URL laisserait l'hôte devant un terminal muet, sans
 * savoir s'il faut attendre ou abandonner.
 */
export function ouvrirTunnel(
  fournisseur: Fournisseur,
  port: number,
  timeoutMs = 30_000,
): Promise<TunnelOuvert> {
  return new Promise((resolve, reject) => {
    const proc = spawn(fournisseur.bin, fournisseur.args(port), {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false, // idem §5.1 : jamais d'interpolation dans une commande
    });
    let fini = false;

    const minuteur = setTimeout(() => {
      if (fini) return;
      fini = true;
      proc.kill();
      reject(
        new Error(
          `${fournisseur.nom} n'a annoncé aucune URL en ${Math.round(timeoutMs / 1000)} s. ` +
            'Vérifiez votre connexion, ou lancez-le à la main pour voir son message.',
        ),
      );
    }, timeoutMs);
    minuteur.unref?.();

    const lire = (buf: Buffer): void => {
      if (fini) return;
      for (const ligne of buf.toString().split('\n')) {
        const trouvee = fournisseur.extraireUrl(ligne);
        if (!trouvee) continue;
        fini = true;
        clearTimeout(minuteur);
        resolve({ url: trouvee, fournisseur: fournisseur.nom, process: proc });
        return;
      }
    };
    proc.stdout?.on('data', lire);
    proc.stderr?.on('data', lire); // cloudflared annonce sur stderr

    proc.on('error', (err) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      reject(err);
    });
    proc.on('close', (code) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      reject(new Error(`${fournisseur.nom} s'est arrêté (code ${code}) sans annoncer d'URL.`));
    });
  });
}
