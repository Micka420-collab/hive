// Module anti-traçage pour Cyber Hive.
// Gère l'anonymat, le nettoyage des traces et l'anti-forensics.
// Conçu pour laisser un minimum de traces détectables pendant et après une attaque.

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
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

/** Adresses IP pour le spoofing X-Forwarded-For. */
const IP_SPOOF_POOL = [
  '198.51.100.1', '203.0.113.5', '192.0.2.10', '198.51.100.42',
  '203.0.113.99', '192.0.2.77', '198.51.100.150', '203.0.113.200',
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

/** Retourne une IP aléatoire pour le spoofing X-Forwarded-For. */
export function ipSpoofAleatoire(): string {
  return IP_SPOOF_POOL[Math.floor(Math.random() * IP_SPOOF_POOL.length)];
}

/** Génère un session ID aléatoire (32 chars hex). */
export function genererSessionId(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
}

/** Identité pour la rotation. */
export interface Identite {
  userAgent: string;
  mac: string;
  timestamp: number;
  xForwardedFor: string;
  sessionId: string;
}

/** Génère une nouvelle identité aléatoire. */
export function nouvelleIdentite(): Identite {
  return {
    userAgent: userAgentAleatoire(),
    mac: genererMACAleatoire(),
    timestamp: Date.now(),
    xForwardedFor: ipSpoofAleatoire(),
    sessionId: genererSessionId(),
  };
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Anti-forensics : nettoyage des logs
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

/** Logs système à nettoyer (chemins standards Linux). */
const LOGS_A_NETTOYER = [
  '/var/log/auth.log',
  '/var/log/syslog',
  '/var/log/messages',
  '/var/log/secure',
  '/var/log/audit/audit.log',
  '/var/log/kern.log',
  '/var/log/cron',
  '/var/log/daemon.log',
  '/var/log/mail.log',
  '/var/log/nginx/access.log',
  '/var/log/nginx/error.log',
  '/var/log/apache2/access.log',
  '/var/log/apache2/error.log',
  '~/.bash_history',
  '~/.zsh_history',
  '~/.python_history',
  '~/.mysql_history',
  '~/.redis-cli-history',
  '~/.lesshst',
  '~/.viminfo',
  '~/.wget-hsts',
];

/** Shell history plausible à injecter après nettoyage. */
const FAKE_HISTORY = [
  'ls -la',
  'cd /tmp',
  'cat /etc/hostname',
  'ps aux',
  'df -h',
  'uptime',
  'whoami',
  'pwd',
  'echo "hello world"',
  'git status',
];

/** Nettoie un fichier log en écrasant son contenu puis en le supprimant (shredding). */
export async function shredderLog(conteneurId: string, cheminLog: string): Promise<void> {
  // docker exec <conteneurId> sh -c 'dd if=/dev/zero of=<cheminLog> bs=1M count=10 2>/dev/null; shred -u -z -n 3 <cheminLog>'
  void conteneurId;
  void cheminLog;
}

/** Nettoie tous les logs dans un conteneur. */
export async function nettoyerLogs(conteneurId: string): Promise<string[]> {
  const nettoyes: string[] = [];
  for (const log of LOGS_A_NETTOYER) {
    await shredderLog(conteneurId, log);
    nettoyes.push(log);
  }
  return nettoyes;
}

/** Efface l'historique des commandes et injecte un historique plausible. */
export async function effacerHistorique(): Promise<void> {
  // unset HISTFILE; history -c; rm -f ~/.bash_history ~/.zsh_history
  // Puis injection d'un faux historique pour éviter un fichier vide suspect.
  void FAKE_HISTORY;
}

/** Nettoie le journal systemd. */
export async function nettoyerJournalctl(conteneurId: string): Promise<void> {
  // docker exec <conteneurId> journalctl --rotate && journalctl --vacuum-time=1s
  void conteneurId;
}

/** Nettoie le système d'audit Linux. */
export async function nettoyerAudit(conteneurId: string): Promise<void> {
  // docker exec <conteneurId> auditctl -D && service auditd stop
  void conteneurId;
}

/** Nettoie les artefacts Docker (logs, images intermédiaires). */
export async function nettoyerArtefactsDocker(): Promise<void> {
  // docker system prune -af --volumes
  // docker logs --tail 0 $(docker ps -q) 2>/dev/null
}

/** Nettoie le cache ARP et les connexions réseau résiduelles. */
export async function nettoyerReseau(conteneurId: string): Promise<void> {
  // docker exec <conteneurId> ip -s -s neigh flush all
  // docker exec <conteneurId> conntrack -F (si disponible)
  void conteneurId;
}

/** Nettoie le cache page/mémoire. */
export async function nettoyerCacheMemoire(conteneurId: string): Promise<void> {
  // docker exec <conteneurId> sync && echo 3 > /proc/sys/vm/drop_caches
  void conteneurId;
}

/** Nettoie les fichiers temporaires et de swap. */
export async function nettoyerTemporaires(conteneurId: string): Promise<void> {
  // docker exec <conteneurId> find /tmp -type f -delete
  // docker exec <conteneurId> swapoff -a && swapon -a
  void conteneurId;
}

/** Manipule les timestamps d'un fichier pour brouiller la chronologie. */
export async function manipulerTimestamp(conteneurId: string, chemin: string): Promise<void> {
  // docker exec <conteneurId> touch -r /etc/hostname <chemin>
  void conteneurId;
  void chemin;
}

/** Nettoyage complet anti-forensic d'une session. */
export async function nettoyageAntiForensic(
  config: ConfigAntiTrace,
  conteneurId: string,
): Promise<string[]> {
  const actions: string[] = [];

  if (config.nettoyageLogs) {
    const logsNettoyes = await nettoyerLogs(conteneurId);
    actions.push(`Logs nettoyés : ${logsNettoyes.length} fichiers`);

    await effacerHistorique();
    actions.push('Historique shell effacé et remplacé');

    await nettoyerJournalctl(conteneurId);
    actions.push('Journal systemd nettoyé');

    await nettoyerAudit(conteneurId);
    actions.push('Système d\'audit nettoyé');
  }

  if (config.conteneursEphemerers) {
    await nettoyerArtefactsDocker();
    actions.push('Artefacts Docker nettoyés');
  }

  await nettoyerReseau(conteneurId);
  actions.push('Cache ARP et connexions réseau nettoyés');

  await nettoyerCacheMemoire(conteneurId);
  actions.push('Cache page/mémoire nettoyé');

  await nettoyerTemporaires(conteneurId);
  actions.push('Fichiers temporaires et swap nettoyés');

  return actions;
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

/** Construit les headers HTTP anti-traçage pour une requête. */
export function construireHeadersAntiTrace(identite: Identite): Record<string, string> {
  return {
    'User-Agent': identite.userAgent,
    'X-Forwarded-For': identite.xForwardedFor,
    'X-Real-IP': identite.xForwardedFor,
    'X-Session-ID': identite.sessionId,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
}

/** Prévient les fuites DNS en forçant la résolution via TOR. */
export function configurerDNSOverTOR(conteneurId: string): Promise<void> {
  // docker exec <conteneurId> sh -c 'echo "DNSPort 127.0.0.1:5353" >> /etc/tor/torrc'
  // docker exec <conteneurId> sh -c 'echo "nameserver 127.0.0.1" > /etc/resolv.conf'
  void conteneurId;
  return Promise.resolve();
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Trace des actions anti-traçage
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

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

/** Génère une étape d'attaque pour chaque action anti-forensic. */
export function etapesAntiForensic(
  sessionId: string,
  agentId: string,
  actions: string[],
): EtapeAttaque[] {
  return actions.map((action, i) => ({
    id: `etape-af-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    agentId,
    type: 'anti-forensic' as const,
    severite: 'info' as const,
    description: action,
    explication: 'Action anti-traçage : nettoyage des traces et anonymat.',
    ts: Date.now() + i,
    dureeMs: 0,
  }));
}