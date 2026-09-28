// MESURER UN AGENT QUI TOURNE — l'arbre de ses processus, ou son conteneur.
//
// ─── CE QU'ON MESURE, ET D'OÙ ÇA VIENT ───────────────────────────────────────
//
// Un agent n'est pas UN processus : Claude Code lance ses shells et ses
// serveurs MCP, `npm test` lance un runner. Mesurer le seul enfant direct
// dirait « 40 Mo » pour un arbre qui en occupe deux gigas. On mesure donc
// l'ARBRE : l'enfant et toute sa descendance, retrouvée par les liens
// parent → enfant de la table des processus.
//
//   · Linux : `/proc` — lu directement, sans lancer quoi que ce soit ;
//   · macOS et autres POSIX : `ps -A -o pid=,ppid=,rss=,time=`, un seul
//     processus par mesure ;
//   · Windows (mode processus) : RIEN. Il n'y a pas de table lisible sans
//     outil tiers, et un nombre inventé serait pire que « inconnu ».
//   · Un conteneur (Podman, Docker) : ce que SON MOTEUR en dit (`stats`) —
//     l'arbre de l'hôte n'y voit que le client `docker run`.
//
// Bubblewrap n'est pas un conteneur au sens du moteur : ses processus sont
// ceux de l'hôte (dans un espace de noms que l'hôte voit), l'arbre les mesure.
//
// ─── CE QU'UNE MESURE NE DIT PAS ─────────────────────────────────────────────
//
// Le CPU se mesure sur une FENÊTRE : il faut deux relevés. Le premier relevé
// d'une exécution ne porte donc pas de CPU — l'écran dit « inconnu », pas 0 %.
// Et seuls comptent les processus présents aux DEUX relevés : un processus né
// ou mort entre les deux n'a pas de différence mesurable (son temps partirait
// en négatif, ou compterait toute sa vie en cinq secondes).
//
// Module sans état global ; la table et le lanceur sont injectables.

import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import type { MetriquesDirect } from '../shared/bac-direct.js';

/** Une ligne de la table des processus : ce dont une mesure a besoin. */
export interface ProcessusVu {
  pid: number;
  ppid: number;
  /** Temps CPU cumulé (utilisateur + système), en millisecondes. */
  cpuMs: number;
  /** Mémoire résidente, en octets. */
  rssOctets: number;
}

/**
 * Les « tics » de `/proc/<pid>/stat` par seconde (`USER_HZ`). Node n'expose pas
 * `sysconf(_SC_CLK_TCK)` ; le noyau Linux fixe USER_HZ à 100 sur toutes les
 * architectures qu'il publie vers l'espace utilisateur (le HZ interne, lui,
 * varie — c'est précisément pour cela que USER_HZ existe).
 */
const TICS_PAR_SECONDE = 100;
/** Taille de page pour le champ `rss` de `/proc/<pid>/stat` (x86-64, arm64 4K). */
const TAILLE_PAGE = 4096;

/**
 * Une ligne de `/proc/<pid>/stat`. Le nom de commande est entre parenthèses et
 * peut en contenir d'autres, et des espaces : on coupe à la DERNIÈRE `)`.
 * `null` sur une ligne qui ne suit pas proc(5).
 */
export function lireStatProc(pid: number, texte: string): ProcessusVu | null {
  const fin = texte.lastIndexOf(')');
  if (fin < 0) return null;
  // Après « ) » : état (champ 3), ppid (4)… utime (14), stime (15)… rss (24).
  const champs = texte
    .slice(fin + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number(champs[1]);
  const utime = Number(champs[11]);
  const stime = Number(champs[12]);
  const rss = Number(champs[21]);
  if (![ppid, utime, stime, rss].every(Number.isFinite)) return null;
  return {
    pid,
    ppid,
    cpuMs: ((utime + stime) * 1000) / TICS_PAR_SECONDE,
    rssOctets: Math.max(0, rss) * TAILLE_PAGE,
  };
}

/** `[[jj-]hh:]mm:ss[.cc]` (colonne `time` de `ps`) en millisecondes ; `null` sinon. */
export function dureePs(texte: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(texte.trim());
  if (!m) return null;
  const [, j, h, min, s] = m;
  const secondes = Number(j ?? 0) * 86_400 + Number(h ?? 0) * 3_600 + Number(min) * 60 + Number(s);
  return Math.round(secondes * 1000);
}

/** La sortie de `ps -A -o pid=,ppid=,rss=,time=` (rss en Kio). */
export function lireSortiePs(sortie: string): ProcessusVu[] {
  const table: ProcessusVu[] = [];
  for (const ligne of sortie.split('\n')) {
    const [pid, ppid, rss, time] = ligne.trim().split(/\s+/);
    const cpuMs = time === undefined ? null : dureePs(time);
    if (cpuMs === null || ![pid, ppid, rss].every((c) => /^\d+$/.test(c ?? ''))) continue;
    table.push({ pid: Number(pid), ppid: Number(ppid), cpuMs, rssOctets: Number(rss) * 1024 });
  }
  return table;
}

/** La racine et toute sa descendance, racine en tête ; vide si la racine est absente. */
export function descendance(table: readonly ProcessusVu[], racine: number): ProcessusVu[] {
  const parPid = new Map(table.map((p) => [p.pid, p]));
  const tete = parPid.get(racine);
  if (!tete) return [];
  const enfants = new Map<number, ProcessusVu[]>();
  for (const p of table) {
    if (p.pid === racine) continue;
    const liste = enfants.get(p.ppid) ?? [];
    liste.push(p);
    enfants.set(p.ppid, liste);
  }
  const arbre: ProcessusVu[] = [];
  const vus = new Set<number>();
  const file = [tete];
  // En largeur : les parents avant leurs enfants — l'ordre que la pause suit.
  while (file.length > 0) {
    const p = file.shift()!;
    if (vus.has(p.pid)) continue;
    vus.add(p.pid);
    arbre.push(p);
    file.push(...(enfants.get(p.pid) ?? []));
  }
  return arbre;
}

/** Lance une commande sans shell, bornée ; rend son code et sa sortie standard. */
export function lancerBorne(
  bin: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  delaiMs: number,
): Promise<{ code: number | null; sortie: string }> {
  return new Promise((resolve) => {
    let sortie = '';
    let fini = false;
    const conclure = (code: number | null): void => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      resolve({ code, sortie });
    };
    const enfant = spawn(bin, [...args], {
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const minuteur = setTimeout(() => {
      enfant.kill('SIGKILL');
      conclure(null);
    }, delaiMs);
    minuteur.unref?.();
    enfant.stdout?.setEncoding('utf8');
    enfant.stdout?.on('data', (s: string) => {
      // Une mesure tient en une ligne : on ne garde pas davantage.
      if (sortie.length < 64 * 1024) sortie += s;
    });
    enfant.on('error', () => conclure(null));
    enfant.on('close', (code) => conclure(code));
  });
}

/** Linux : toute la table, lue dans `/proc`. Un processus qui disparaît en cours de lecture est sauté. */
async function tableProc(): Promise<ProcessusVu[]> {
  const entrees = await readdir('/proc');
  const table: ProcessusVu[] = [];
  await Promise.all(
    entrees
      .filter((e) => /^\d+$/.test(e))
      .map(async (e) => {
        try {
          const p = lireStatProc(Number(e), await readFile(`/proc/${e}/stat`, 'utf8'));
          if (p) table.push(p);
        } catch {
          /* sorti entre la liste et la lecture */
        }
      }),
  );
  return table;
}

/**
 * La table des processus de CETTE machine, ou `null` quand on ne sait pas la
 * lire ici (Windows) — l'appelant dit alors « inconnu ».
 */
export async function tableDesProcessus(
  plateforme: NodeJS.Platform = process.platform,
): Promise<ProcessusVu[] | null> {
  if (plateforme === 'win32') return null;
  try {
    if (plateforme === 'linux') return await tableProc();
    const r = await lancerBorne(
      'ps',
      ['-A', '-o', 'pid=,ppid=,rss=,time='],
      { PATH: process.env.PATH },
      10_000,
    );
    return r.code === 0 ? lireSortiePs(r.sortie) : null;
  } catch {
    return null;
  }
}

/**
 * Mesure un arbre au fil des relevés : le CPU d'un relevé est la différence
 * avec le précédent, sur les seuls processus présents aux deux.
 */
export class MesureArbre {
  private precedent: { a: number; cpu: Map<number, number> } | null = null;

  constructor(private readonly racine: number) {}

  /** `null` : la racine n'est plus dans la table (sortie, ou pas encore visible). */
  relever(table: readonly ProcessusVu[], maintenant: number): MetriquesDirect | null {
    const arbre = descendance(table, this.racine);
    if (arbre.length === 0) return null;
    const cpu = new Map(arbre.map((p) => [p.pid, p.cpuMs]));
    let cpuPct: number | undefined;
    if (this.precedent && maintenant > this.precedent.a) {
      let consomme = 0;
      for (const [pid, ms] of cpu) {
        const avant = this.precedent.cpu.get(pid);
        if (avant !== undefined && ms >= avant) consomme += ms - avant;
      }
      cpuPct = Math.round((consomme / (maintenant - this.precedent.a)) * 1000) / 10;
    }
    this.precedent = { a: maintenant, cpu };
    return {
      source: 'arbre',
      ...(cpuPct !== undefined ? { cpuPct } : {}),
      rssOctets: arbre.reduce((s, p) => s + p.rssOctets, 0),
      processus: arbre.length,
    };
  }
}

/**
 * Le format que Podman ET Docker comprennent tous deux pour `stats` : des
 * champs nommés du gabarit Go, séparés par `|`. Le JSON diffère entre eux ;
 * ces trois champs-là, non.
 */
export const FORMAT_STATS_MOTEUR = '{{.CPUPerc}}|{{.MemUsage}}|{{.PIDs}}';

const UNITES: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1e3,
  kib: 1024,
  mb: 1e6,
  mib: 1024 ** 2,
  gb: 1e9,
  gib: 1024 ** 3,
  tb: 1e12,
  tib: 1024 ** 4,
};

/** « 10.5MiB », « 312.4kB » en octets ; `undefined` si illisible. */
function octetsDe(texte: string): number | undefined {
  const m = /^([\d.]+)\s*([a-z]+)$/i.exec(texte.trim());
  const facteur = m ? UNITES[m[2]!.toLowerCase()] : undefined;
  const valeur = m ? Number(m[1]) : NaN;
  return facteur !== undefined && Number.isFinite(valeur)
    ? Math.round(valeur * facteur)
    : undefined;
}

/**
 * Une ligne `stats` du moteur (`FORMAT_STATS_MOTEUR`) : « 12.34%|10.5MiB / 2GiB|7 ».
 * Chaque champ illisible reste absent ; `null` si la ligne n'a pas la forme.
 */
export function lireStatsMoteur(ligne: string): MetriquesDirect | null {
  const [cpu, memoire, pids] = ligne.trim().split('\n')[0]!.split('|');
  if (cpu === undefined || memoire === undefined || pids === undefined) return null;
  const pct = /^([\d.]+)%$/.exec(cpu.trim());
  const cpuPct = pct ? Number(pct[1]) : undefined;
  const rssOctets = octetsDe(memoire.split('/')[0] ?? '');
  const processus = /^\d+$/.test(pids.trim()) ? Number(pids.trim()) : undefined;
  return {
    source: 'conteneur',
    ...(cpuPct !== undefined && Number.isFinite(cpuPct) ? { cpuPct } : {}),
    ...(rssOctets !== undefined ? { rssOctets } : {}),
    ...(processus !== undefined ? { processus } : {}),
  };
}
