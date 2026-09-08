// Module anti-traçage pour Cyber Hive.
// Gère l'anonymat, le nettoyage des traces et l'anti-forensics.

import type { ConfigAntiTrace, EtapeAttaque } from './types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Rotation d'identité
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** User-Agents pour la rotation. */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
];

/** Génère une adresse MAC aléatoire. */
export function genererMACAleatoire(): string {
  const octets = Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  );
  // Second bit du premier octet à 1 (locally administered).
  octets[0] = (parseInt(octets[0], 16) | 0x02).toString(16).padStart(2, '0');
  return octets.join(':');
}

/** Retourne un User-Agent aléatoire. */
export function userAgentAleatoire(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Identité pour la rotation. */
export interface Identite {
  userAgent: string;
  mac: string;
  timestamp: number;
}

/** Génère une nouvelle identité aléatoire. */
export function nouvelleIdentite(): Identite {
  return {
    userAgent: userAgentAleatoire(),
    mac: genererMACAleatoire(),
    timestamp: Date.now(),
  };
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Anti-forensics
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Logs à nettoyer (chemins standards Linux). */
const LOGS_A_NETTOYER = [
  '/var/log/auth.log',
  '/var/log/syslog',
  '/var/log/messages',
  '/var/log/secure',
  '/var/log/audit/audit.log',
  '/var/log/kern.log',
  '/var/log/cron',
  '~/.bash_history',
  '~/.zsh_history',
  '~/.python_history',
];

/** Nettoie les logs dans un conteneur. */
export async function nettoyerLogs(conteneurId: string): Promise<void> {
  // docker exec <conteneurId> sh -c 'echo > /var/log/auth.log'
  void conteneurId;
  void LOGS_A_NETTOYER;
}

/** Efface l'historique des commandes. */
export async function effacerHistorique(): Promise<void> {
  // unset HISTFILE; history -c; rm -f ~/.bash_history
}

/** Nettoyage complet anti-forensic d'une session. */
export async function nettoyageAntiForensic(
  config: ConfigAntiTrace,
  conteneurId: string,
): Promise<void> {
  if (config.nettoyageLogs) {
    await nettoyerLogs(conteneurId);
    await effacerHistorique();
  }
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Délai aléatoire
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Attend un délai aléatoire pour brouiller le timing. */
export function delaiAleatoire(config: ConfigAntiTrace): Promise<void> {
  if (config.delaiAleatoireMs <= 0) return Promise.resolve();
  const variance = config.delaiAleatoireMs * 0.5;
  const delai = config.delaiAleatoireMs + Math.random() * variance - variance / 2;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delai)));
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Configuration TOR / Proxychains
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Préfixe de commande pour le routage via proxychains. */
export function prefixeProxychains(config: ConfigAntiTrace): string {
  return config.proxychains ? 'proxychains ' : '';
}

/** Vérifie si TOR est actif. */
export function torActif(config: ConfigAntiTrace): boolean {
  return config.tor;
}

/** Construit la commande complète avec anti-traçage. */
export function construireCommande(
  commande: string,
  args: string[],
  config: ConfigAntiTrace,
): string {
  const prefixe = prefixeProxychains(config);
  return `${prefixe}${commande} ${args.join(' ')}`;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Trace des actions anti-traçage
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌�Construire ce système Ultra complet et complexe https://github.com/Micka420-collab/hive╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Génère une étape d'attaque de type anti-forensic. */
export function etapeAntiForensic(
  sessionId: string,
  agentId: string,
  description: string,
): EtapeAttaque {
  return {
    id: `etape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    agentId,
    type: 'anti-forensic',
    severite: 'info',
    description,
    explication: 'Action anti-traçage : nettoyage des traces et anonymat.',
    ts: Date.now(),
    dureeMs: 0,
  };
}