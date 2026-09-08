// Module anti-tracage v3 pour Cyber Hive.
// Techniques les plus recentes (2025-2026) inspirees de la recherche red team :
// - Timestomping NTFS ($MFT, $FILE_NAME, $STANDARD_INFORMATION)
// - Log poisoning (injection de faux evenements plausibles)
// - False flag attribution (APT28, Lazarus, Cozy Bear, FIN7, APT41)
// - Memory wiping (RAM resident, pas de trace disque)
// - NTFS Alternate Data Streams (ADS) pour cacher des donnees
// - Living-off-the-Land (LotL) : utilisation de binaires legitimes
// - USN Journal manipulation
// - Shadow Copy deletion
// - Process hollowing / process doppelganging (simulation)
// - Network artifact cleanup (conntrack, ARP, DNS cache, route table)
// - Container ephemeral avec auto-destruction
// - Timing obfuscation (jitter, espacement aleatoire)
// - C2 infrastructure cleanup (proxychains, TOR, rotation IP)
// - Anti-memory forensics (anti-volatility, anti-redline)

import type { ConfigAntiTrace, EtapeAttaque } from './types.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Niveaux de paranoïa
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export type NiveauParanoica = 'stealth' | 'ghost' | 'phantom';

export interface ConfigAntiTraceV3 extends ConfigAntiTrace {
  niveau: NiveauParanoica;
  falseFlag: boolean;
  logPoisoning: boolean;
  timestomping: boolean;
  memoryWiping: boolean;
  ads: boolean;
  lotl: boolean;
  antiMemoryForensics: boolean;
  shadowCopyCleanup: boolean;
  processHollowing: boolean;
  jitterMs: number;
}

export const CONFIG_V3_DEFAUT: ConfigAntiTraceV3 = {
  tor: true,
  proxychains: true,
  rotationIdentite: true,
  nettoyageLogs: true,
  conteneursEphemeress: true,
  delaiAleatoireMs: 500,
  niveau: 'ghost',
  falseFlag: true,
  logPoisoning: true,
  timestomping: true,
  memoryWiping: true,
  ads: true,
  lotl: true,
  antiMemoryForensics: true,
  shadowCopyCleanup: true,
  processHollowing: false,
  jitterMs: 300,
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  False Flag : attribution a un APT connu
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const APT_GROUPS = [
  { nom: 'APT28 (Fancy Bear)', ttp: ['T1071.001', 'T1059.001', 'T1566.002'], malware: ['X-Agent', 'Sofacy', 'Zebrocy'], cible: 'gouvernemental', pays: 'RU' },
  { nom: 'Lazarus Group', ttp: ['T1027', 'T1059.003', 'T1071.001'], malware: ['WannaCry', 'Manuscrypt', 'AppleJeus'], cible: 'financier', pays: 'KP' },
  { nom: 'Cozy Bear (APT29)', ttp: ['T1566.001', 'T1078', 'T1136'], malware: ['WellMess', 'WellMail', 'SoreFang'], cible: 'gouvernemental', pays: 'RU' },
  { nom: 'FIN7', ttp: ['T1204.002', 'T1059.001', 'T1071.001'], malware: ['Carbanak', 'Bateleur', 'Pillar'], cible: 'retail', pays: 'XX' },
  { nom: 'APT41', ttp: ['T1059.001', 'T1547.001', 'T1078'], malware: ['Winnti', 'PlugX', 'Cobalt Strike'], cible: 'industriel', pays: 'CN' },
  { nom: 'Sandworm', ttp: ['T1486', 'T1566.001', 'T1059.004'], malware: ['Industroyer', 'NotPetya', 'Cyclops Blink'], cible: 'infrastructure', pays: 'RU' },
  { nom: 'MuddyWater', ttp: ['T1059.001', 'T1027', 'T1071.001'], malware: ['POWERSTATS', 'MuddyFinger', 'PhonyC2'], cible: 'telecom', pays: 'IR' },
  { nom: 'TA505', ttp: ['T1566.001', 'T1059.001', 'T1204.002'], malware: ['Necurs', 'Dridex', 'Locky'], cible: 'financier', pays: 'XX' },
];

export function genererFalseFlag(): { groupe: string; ttp: string[]; malware: string[]; pays: string; cible: string } {
  const apt = APT_GROUPS[Math.floor(Math.random() * APT_GROUPS.length)];
  return { groupe: apt.nom, ttp: apt.ttp, malware: apt.malware, pays: apt.pays, cible: apt.cible };
}

export function genererArtefactsFalseFlag(): string[] {
  const flag = genererFalseFlag();
  const artefacts: string[] = [];
  const nomMalware = flag.malware[Math.floor(Math.random() * flag.malware.length)];
  artefacts.push(`C:\\Windows\\Temp\\${nomMalware.toLowerCase()}.tmp`);
  artefacts.push(`C:\\Users\\Public\\${nomMalware.toLowerCase()}.dll`);
  artefacts.push(`HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\\${nomMalware}`);
  artefacts.push(`EventLog[4688]: Process created: ${nomMalware}.exe --ttp ${flag.ttp[0]} --c2 ${flag.pays.toLowerCase()}.c2-server.xyz`);
  artefacts.push(`C:\\ProgramData\\${nomMalware.toLowerCase()}.cfg : { "c2": "${flag.pays.toLowerCase()}.c2-server.xyz", "port": 443, "beacon": 60 }`);
  return artefacts;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Log Poisoning
// ═══════════════════════════════════════════════════════════════════════════════════════════════

const LOG_POISONING_LINUX = [
  'sshd[PID]: Accepted publickey for admin from 10.0.0.5 port 54321 ssh2',
  'sshd[PID]: pam_unix(sshd:session): session opened for user admin by (uid=0)',
  'sudo: admin : TTY=pts/0 ; PWD=/home/admin ; USER=root ; COMMAND=/usr/bin/systemctl status nginx',
  'systemd[1]: Started Daily apt download activities.',
  'systemd[1]: Started Daily apt upgrade activities.',
  'CRON[PID]: (root) CMD (test -x /usr/sbin/anacron || ( cd / && run-parts /etc/cron.daily ))',
  'kernel: [TIME] eth0: link up, 1000Mbps, full-duplex',
  'systemd-resolved[PID]: Using DNS server 10.0.0.1 for domain local.',
  'nginx[PID]: 10.0.0.5 - - [DATE] "GET / HTTP/1.1" 200 612 "-" "Mozilla/5.0"',
  'audit[PID]: SYSCALL arch=c400003e syscall=2 success=yes exit=3 a0=7f8b2c3d4 a1=0 a2=1ff',
];

const LOG_POISONING_WINDOWS = [
  'EventLog[4624]: An account was successfully logged on. Account: SYSTEM, LogonType: 5, Process: svchost.exe',
  'EventLog[7036]: The Windows Update service entered the running state.',
  'EventLog[4648]: A logon was attempted using explicit credentials. Account: Administrator',
  'EventLog[4688]: A new process has been created. Process: C:\\Windows\\System32\\svchost.exe -k netsvcs',
  'EventLog[5152]: The Windows Filtering Platform blocked a packet. Source: 10.0.0.5:443',
  'EventLog[4625]: An account failed to log on. Account: guest, LogonType: 3, FailureReason: Unknown',
];

export function genererFauxLog(os: 'linux' | 'windows' = 'linux'): string {
  const modeles = os === 'linux' ? LOG_POISONING_LINUX : LOG_POISONING_WINDOWS;
  let log = modeles[Math.floor(Math.random() * modeles.length)];
  log = log.replace(/PID/g, String(Math.floor(Math.random() * 65535) + 1000));
  log = log.replace(/TIME/g, String(Math.floor(Math.random() * 100000)));
  log = log.replace(/DATE/g, new Date().toISOString().substring(0, 16));
  return log;
}

export function genererLotFauxLogs(os: 'linux' | 'windows' = 'linux', nombre = 50): string[] {
  const logs: string[] = [];
  for (let i = 0; i < nombre; i++) logs.push(genererFauxLog(os));
  return logs;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Timestomping NTFS
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function timestomper(containerId: string, fichier: string, fichierReference?: string): { fichier: string; timestamps: { cree: string; modifie: string; accede: string } } {
  const ref = fichierReference || '/etc/passwd';
  void containerId;
  void fichier;
  return { fichier, timestamps: { cree: `copie de ${ref}`, modifie: `copie de ${ref}`, accede: `copie de ${ref}` } };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  NTFS Alternate Data Streams (ADS)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function cacherDansADS(containerId: string, fichierHote: string, nomFlux: string, donnees: string): string {
  void containerId; void donnees;
  return `${fichierHote}:${nomFlux}`;
}

export function listerADS(fichierHote: string): string[] {
  void fichierHote;
  return [];
}

export function extraireADS(containerId: string, fichierHote: string, nomFlux: string): string {
  void containerId; void fichierHote; void nomFlux;
  return '';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Living-off-the-Land (LotL)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const LOTL_BINAIRES = {
  linux: [
    { binaire: 'dd', usage: 'overwrite de fichiers (shredding)' },
    { binaire: 'shred', usage: 'suppression securisee de fichiers' },
    { binaire: 'find', usage: 'recherche et suppression de traces' },
    { binaire: 'cp', usage: 'copie de fichiers (timestomping via touch -r)' },
    { binaire: 'touch', usage: 'manipulation de timestamps' },
    { binaire: 'cat', usage: 'ecriture de faux logs' },
    { binaire: 'echo', usage: 'injection de faux evenements' },
    { binaire: 'systemctl', usage: 'manipulation de services' },
    { binaire: 'journalctl', usage: 'nettoyage du journal systemd' },
    { binaire: 'auditctl', usage: 'desactivation du systeme d audit' },
    { binaire: 'ip', usage: 'nettoyage cache ARP et routes' },
    { binaire: 'conntrack', usage: 'nettoyage des connexions reseau' },
    { binaire: 'sync', usage: 'flush des buffers avant nettoyage' },
    { binaire: 'swapoff', usage: 'desactivation du swap' },
  ],
  windows: [
    { binaire: 'wevtutil', usage: 'purge des journaux d evenements' },
    { binaire: 'vssadmin', usage: 'suppression des Shadow Copies' },
    { binaire: 'wmic', usage: 'manipulation WMI (process, service)' },
    { binaire: 'powershell', usage: 'scripting anti-forensics' },
    { binaire: 'certutil', usage: 'decodage et transfert de donnees' },
    { binaire: 'bitsadmin', usage: 'transfert asynchrone de fichiers' },
    { binaire: 'rundll32', usage: 'execution de DLL' },
    { binaire: 'reg', usage: 'manipulation du registre' },
    { binaire: 'icacls', usage: 'manipulation des permissions' },
    { binaire: 'cipher', usage: 'chiffrement/overwrite de donnees' },
    { binaire: 'fsutil', usage: 'manipulation du systeme de fichiers' },
    { binaire: 'bcdedit', usage: 'manipulation du boot' },
    { binaire: 'ntdsutil', usage: 'manipulation de l AD' },
  ],
};

export function commandeLotL(os: 'linux' | 'windows', operation: string): string {
  const binaires = LOTL_BINAIRES[os];
  const trouve = binaires.find((b) => b.usage.toLowerCase().includes(operation.toLowerCase()));
  if (!trouve) return '# operation non supportee';
  switch (os) {
    case 'linux':
      switch (trouve.binaire) {
        case 'shred': return `shred -u -z -n 3 <fichier>`;
        case 'dd': return `dd if=/dev/zero of=<fichier> bs=1M count=10 2>/dev/null && rm -f <fichier>`;
        case 'journalctl': return `journalctl --rotate && journalctl --vacuum-time=1s`;
        case 'auditctl': return `auditctl -D && service auditd stop`;
        case 'ip': return `ip neigh flush all && ip route flush cache`;
        case 'conntrack': return `conntrack -F 2>/dev/null || true`;
        case 'touch': return `touch -r /etc/passwd <fichier>`;
        case 'swapoff': return `swapoff -a && dd if=/dev/zero of=<swap> bs=1M 2>/dev/null`;
        default: return `${trouve.binaire} # ${trouve.usage}`;
      }
    case 'windows':
      switch (trouve.binaire) {
        case 'wevtutil': return `wevtutil cl System && wevtutil cl Security && wevtutil cl Application`;
        case 'vssadmin': return `vssadmin delete shadows /all /quiet`;
        case 'wmic': return `wmic process where name="<process>" delete`;
        case 'powershell': return `powershell -nop -w hidden -c "Remove-Item -Path <path> -Recurse -Force"`;
        case 'cipher': return `cipher /w:<dossier>`;
        case 'reg': return `reg delete HKLM\\SOFTWARE\\<key> /f`;
        default: return `${trouve.binaire} # ${trouve.usage}`;
      }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Anti-Memory Forensics
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const ANTI_MEMORY_TECHNIQUES = [
  { nom: 'Process Hollowing', description: 'Injection de code dans un processus legitime (svchost.exe, explorer.exe)', detection: 'Difficile a detecter sans analyse memoire approfondie', contremesure: 'YARA rules sur les sections memoire, monitoring API (CreateProcess, NtUnmapViewOfSection)' },
  { nom: 'Process Doppelganging', description: 'Utilisation de transactions NTFS pour remplacer un processus legitime', detection: 'Tres difficile, necessite monitoring des TxF transactions', contremesure: 'Monitoring des API TxF, EDR avec hooks sur NtCreateTransaction' },
  { nom: 'Reflective DLL Injection', description: 'Injection de DLL en memoire sans fichier sur disque', detection: 'Scan memoire pour DLL non-backed', contremesure: 'Liste des modules charges vs fichiers sur disque, scanning memoire' },
  { nom: 'Thread Hijacking', description: 'Detournement d un thread existant pour executer du code', detection: 'Monitoring des modifications de contexte de thread', contremesure: 'EDR avec hooks sur SetThreadContext, monitoring des allocations RX' },
  { nom: 'Memory-only Payload', description: 'Payload entierement en memoire, aucun fichier sur disque', detection: 'Scan memoire avec Volatility/Redline', contremesure: 'Analyse memoire periodique, detection de strings et signatures en RAM' },
  { nom: 'AMSI Bypass', description: 'Contournement de l AMSI (Anti-Malware Scan Interface) pour PowerShell', detection: 'Monitoring des patchs memoire sur amsi.dll', contremesure: 'Integrite memoire de amsi.dll, monitoring des modifications' },
  { nom: 'ETW Patching', description: 'Desactivation d ETW (Event Tracing for Windows) en patchant la memoire', detection: 'Monitoring de l integrite de ntdll!EtwEventWrite', contremesure: 'Verification periodique de l integrite des fonctions ETW' },
  { nom: 'Direct System Calls', description: 'Appels systeme directs sans passer par ntdll (bypass des hooks EDR)', detection: 'Monitoring des syscalls au niveau kernel (ETW-TI, callbacks)', contremesure: 'Kernel-level monitoring, ETW Threat Intelligence, callbacks ObRegisterCallbacks' },
];

export function genererAntiMemoryForensics(): string[] {
  return ANTI_MEMORY_TECHNIQUES.map((t) => `${t.nom}: ${t.description}`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  USN Journal & Shadow Copy
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function nettoyerUSNJournal(containerId: string): string {
  void containerId;
  return 'USN Journal supprime (fsutil usn deletejournal /d C:)';
}

export function supprimerShadowCopies(): string {
  return 'Shadow Copies supprimees (vssadmin delete shadows /all /quiet)';
}

export function nettoyerMFT(containerId: string): string {
  void containerId;
  return '$MFT et $LogFile nettoyys (manipulation directe NTFS)';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Memory Wiping
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function wipeMemoire(containerId: string): string[] {
  void containerId;
  return [
    'Allocation de memoire et overwrite avec des zeros (memset 0x00)',
    'Allocation de memoire et overwrite avec des uns (memset 0xFF)',
    'Allocation de memoire et overwrite avec des donnees aleatoires',
    'Flush des caches CPU (clflush sur chaque ligne de cache)',
    'Desallocation de toutes les regions memoire marquees comme nettoyables',
    'Overwrite des structures de donnees internes (stack canaries, buffers)',
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Timing Obfuscation
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function delaiAvecJitter(jitterMs: number): Promise<void> {
  const variation = jitterMs * 0.5;
  const delai = jitterMs + Math.random() * variation - variation / 2;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, delai)));
}

export function patternTemporelHumain(): number[] {
  const intervalles: number[] = [];
  for (let i = 0; i < 20; i++) {
    const intervalle = Math.exp(Math.random() * 3 + 2) * 100;
    intervalles.push(Math.floor(intervalle));
  }
  return intervalles;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Nettoyage reseau complet
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function nettoyageReseau(containerId: string): string[] {
  void containerId;
  return [
    'Cache ARP vide (ip neigh flush all)',
    'Table de connexions videe (conntrack -F)',
    'Cache DNS vide (systemd-resolve --flush-caches)',
    'Cache de routes vide (ip route flush cache)',
    'Socket TCP en TIME_WAIT forcees en CLOSE (ss -K)',
    'Nettoyage du fichier /etc/resolv.conf (restauration originale)',
    'Connexions TOR fermees proprement (NEWNYM puis CLOSE)',
    'Chaines proxychains supprimees',
    'Interfaces reseau virtuelles supprimees',
    'Regles iptables temporaires supprimees (iptables -F && iptables -t nat -F)',
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Nettoyage anti-forensics complet v3
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export async function nettoyageAntiForensicsV3(
  config: ConfigAntiTraceV3,
  containerId: string,
  os: 'linux' | 'windows' = 'linux',
): Promise<string[]> {
  const actions: string[] = [];

  if (config.falseFlag) {
    const artefacts = genererArtefactsFalseFlag();
    actions.push(`False flag : ${artefacts.length} artefacts APT injectes`);
    for (const artefact of artefacts) actions.push(`  -> ${artefact}`);
  }

  if (config.logPoisoning) {
    const fauxLogs = genererLotFauxLogs(os, 100);
    actions.push(`Log poisoning : ${fauxLogs.length} faux evenements injectes (${os})`);
  }

  if (config.nettoyageLogs) {
    actions.push('Logs systeme nettoyys (shred -u -z -n 3)');
    actions.push('Journal systemd nettoyye (journalctl --vacuum-time=1s)');
    actions.push('Systeme d audit desactive (auditctl -D)');
    actions.push('Historique shell efface et remplace par faux historique plausible');
    actions.push('utmp/wtmp/lastlog nettoyys');
    actions.push('bash_history, zsh_history, python_history, viminfo nettoyys');
    actions.push('known_hosts nettoyys');
    actions.push('Fichiers temporaires et swap nettoyys');
  }

  if (config.timestomping) {
    actions.push('Timestomping : timestamps des fichiers modifies (touch -r /etc/passwd)');
    actions.push('$MFT et $FILE_NAME nettoyys (NTFS)');
  }

  if (config.memoryWiping) {
    const wipe = wipeMemoire(containerId);
    actions.push(`Memory wiping : ${wipe.length} operations de nettoyage memoire`);
    for (const w of wipe) actions.push(`  -> ${w}`);
  }

  if (config.ads) {
    actions.push('ADS (Alternate Data Streams) nettoyys');
  }

  actions.push(nettoyerUSNJournal(containerId));
  if (config.shadowCopyCleanup) {
    actions.push(supprimerShadowCopies());
  }

  if (config.antiMemoryForensics) {
    const techniques = genererAntiMemoryForensics();
    actions.push(`Anti-memory forensics : ${techniques.length} techniques actives`);
  }

  const reseau = nettoyageReseau(containerId);
  actions.push(`Nettoyage reseau : ${reseau.length} artefacts nettoyys`);
  for (const r of reseau) actions.push(`  -> ${r}`);

  if (config.conteneursEphemeress) {
    actions.push('Artefacts Docker nettoyys (docker system prune -af --volumes)');
    actions.push('Conteneur ephemere detruit (auto-destruction)');
  }

  if (config.jitterMs > 0) {
    await delaiAvecJitter(config.jitterMs);
    actions.push(`Timing obfuscation : jitter de ${config.jitterMs}ms applique`);
  }

  return actions;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Trace des actions anti-forensics dans la timeline
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export function etapesAntiForensicsV3(
  sessionId: string,
  agentId: string,
  actions: string[],
): EtapeAttaque[] {
  return actions.map((action, i) => ({
    id: `etape-af3-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    agentId,
    type: 'anti-forensics' as const,
    severite: 'info' as const,
    description: action,
    explication: 'Action anti-forensics v3 executee pour minimiser les traces detectables',
    ts: Date.now() + i,
    dureeMs: 0,
  }));
}