// Ce qu'une tâche a le droit de joindre depuis son bac — dérivé de ce que le
// DÉPÔT déclare, pas d'une liste écrite à la main.
//
// ─── TROIS SOURCES, ET UNE SEULE MAIN POUR LES LIRE ──────────────────────────
//
//   · l'hôte d'API de la FAMILLE de l'agent du nœud (`HOTES_API`) — le seul
//     trafic sans lequel un agent de codage ne fait rien ;
//   · les registres que le dépôt DÉCLARE dans ses fichiers de verrouillage et
//     de dépendances (`registresDuDepot`), lus à la BASE : le nœud les lit
//     juste après le clone, AVANT que l'agent ait écrit quoi que ce soit — un
//     agent qui ajouterait `resolved: https://exfil.example/…` à un lockfile ne
//     s'ouvre rien pour cette tâche ;
//   · l'hôte git du projet (`hoteGit`), celui de son `repoUrl`.
//
// Ce que les concurrents font avec une liste statique (« registres courants »),
// Hive le déduit : un projet Rust n'ouvre pas npm, un projet sans dépendances
// n'ouvre rien d'autre que son modèle.
//
// ─── CE QU'UNE DÉCLARATION DU DÉPÔT PEUT, ET NE PEUT PAS ─────────────────────
//
// Le dépôt est une donnée NON FIABLE (une PR, une issue peuvent venir de
// n'importe qui). Ce qu'il déclare ouvre un NOM d'hôte, jamais une adresse
// IP littérale, jamais un port (80 et 443 seulement, `proxy-egress.ts`), et
// la garde anti-rebond refuse tout nom qui se résout vers le réseau local, la
// boucle ou les métadonnées. Au pire, un dépôt hostile s'ouvre un hôte public
// de son choix pour y envoyer… son propre contenu — pas les identifiants du
// membre (des leurres dans le bac), pas son disque (le bac). La liste est
// bornée (`HOTES_DEPOT_MAX`).

import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import type { NiveauReseau } from '../shared/reseau.js';
import type { AgentType } from './agent-detect.js';
import { hoteCanonique } from './proxy-egress.js';

/**
 * Les hôtes d'API de chaque famille d'agent. `claude-code` et `codex`
 * passent AUSSI par leur passerelle (`PASSERELLES`) : l'hôte reste permis
 * pour ce que le CLI joindrait sans elle — il n'y porterait qu'un leurre.
 */
export const HOTES_API: Readonly<Record<AgentType, readonly string[]>> = {
  'claude-code': ['api.anthropic.com'],
  codex: ['api.openai.com'],
  cursor: ['cursor.com', '*.cursor.com', '*.cursor.sh'],
  // Cline suit le fournisseur configuré chez le membre : les deux API de
  // modèle qu'un nœud Hive lui confie, et son propre service.
  cline: ['api.anthropic.com', 'api.openai.com', 'openrouter.ai', 'api.cline.bot'],
  grok: ['api.x.ai'],
  // Un agent inconnu de Hive n'a pas d'hôte connu : `ouvert` est le réglage
  // du projet qui le lui donnerait.
  custom: [],
  shell: [],
};

/**
 * Les passerelles d'API : la famille dont le nœud sait viser une base locale,
 * les variables d'identification qu'elle remplace par des leurres, et la base
 * réelle vers laquelle le NŒUD relaie.
 *
 * `ANTHROPIC_BASE_URL` du membre, s'il en pose une (sa propre passerelle),
 * reste l'amont : le bac vise Hive, Hive vise ce que le membre visait. Codex,
 * lui, ne lit pas `OPENAI_BASE_URL` (codex-rs/core/src/config : seule la clé
 * `openai_base_url` de sa configuration compte) : son amont est l'API publique,
 * et l'adaptateur lui passe la base locale par `-c openai_base_url=…`.
 */
export const PASSERELLES: Partial<
  Record<
    AgentType,
    {
      nom: string;
      identifiants: readonly string[];
      amont: (env: NodeJS.ProcessEnv) => string;
      /** La variable (non secrète) qui dit au bac où est la passerelle. */
      variable: string;
    }
  >
> = {
  'claude-code': {
    nom: 'anthropic',
    identifiants: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
    amont: (env) => urlHttp(env.ANTHROPIC_BASE_URL) ?? 'https://api.anthropic.com',
    variable: 'ANTHROPIC_BASE_URL',
  },
  codex: {
    nom: 'openai',
    identifiants: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
    amont: () => 'https://api.openai.com/v1',
    variable: 'OPENAI_BASE_URL',
  },
};

function urlHttp(v: string | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** L'hôte git d'un `repoUrl` (https, ssh, `git@hôte:chemin`) — `null` pour un chemin local. */
export function hoteGit(repoUrl: string | null | undefined): string | null {
  if (!repoUrl) return null;
  const scp = /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(?!\/\/)/.exec(repoUrl);
  if (scp) return nomPermis(scp[1] ?? '');
  try {
    const u = new URL(repoUrl);
    if (u.protocol === 'file:') return null;
    return nomPermis(u.hostname);
  } catch {
    return null;
  }
}

/** Un NOM d'hôte, jamais une IP ni `localhost` : ce qu'une déclaration peut ouvrir. */
function nomPermis(brut: string): string | null {
  const hote = hoteCanonique(brut);
  if (!hote || isIP(hote) || !hote.includes('.') || hote.endsWith('.localhost')) return null;
  return hote;
}

/** Au-delà, le dépôt ne s'ouvre plus rien : une déclaration n'est pas une liste sans fin. */
export const HOTES_DEPOT_MAX = 24;
/** Ce qu'on lit d'un fichier déclaratif : un lockfile géant ne coûte pas plus. */
const LECTURE_MAX = 4 * 1024 * 1024;

function lireDebut(fichier: string): string | null {
  try {
    if (!statSync(fichier).isFile()) return null;
    const fd = openSync(fichier, 'r');
    try {
      const tampon = Buffer.alloc(LECTURE_MAX);
      const lus = readSync(fd, tampon, 0, LECTURE_MAX, 0);
      return tampon.subarray(0, lus).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** Les hôtes des URL `http(s)://…` d'un texte qui suivent un marqueur. */
function hotesDesUrl(texte: string, marqueur: RegExp): string[] {
  const hotes: string[] = [];
  for (const m of texte.matchAll(marqueur)) {
    const hote = nomPermis(m[1] ?? '');
    if (hote) hotes.push(hote);
  }
  return hotes;
}

/**
 * Chaque écosystème : les fichiers qui le révèlent, les registres qu'il
 * emploie par défaut, et ce qu'on relit dedans pour y trouver ceux que le
 * dépôt déclare lui-même (un registre privé, un miroir).
 */
const ECOSYSTEMES: ReadonlyArray<{
  fichiers: readonly string[];
  defauts: readonly string[];
  declares?: RegExp;
}> = [
  {
    fichiers: ['package-lock.json', 'npm-shrinkwrap.json'],
    defauts: ['registry.npmjs.org'],
    declares: /"resolved":\s*"(?:git\+)?https?:\/\/([^/":]+)/g,
  },
  {
    fichiers: ['yarn.lock'],
    defauts: ['registry.yarnpkg.com', 'registry.npmjs.org'],
    declares: /resolved\s+"?https?:\/\/([^/":]+)/g,
  },
  {
    fichiers: ['pnpm-lock.yaml'],
    defauts: ['registry.npmjs.org'],
    declares: /tarball:\s*'?https?:\/\/([^/'":]+)/g,
  },
  { fichiers: ['bun.lock', 'bun.lockb', 'package.json'], defauts: ['registry.npmjs.org'] },
  {
    fichiers: ['.npmrc', '.yarnrc.yml', '.yarnrc'],
    defauts: [],
    declares: /registry\S*\s*[=:]\s*"?https?:\/\/([^/"':\s]+)/gi,
  },
  {
    fichiers: ['requirements.txt', 'Pipfile.lock', 'poetry.lock', 'uv.lock', 'pyproject.toml'],
    defauts: ['pypi.org', 'files.pythonhosted.org'],
    declares: /(?:index-url|registry|url)\s*=\s*"?https?:\/\/([^/"':\s]+)/gi,
  },
  {
    fichiers: ['Cargo.lock', 'Cargo.toml'],
    defauts: ['crates.io', 'index.crates.io', 'static.crates.io'],
  },
  { fichiers: ['go.sum', 'go.mod'], defauts: ['proxy.golang.org', 'sum.golang.org'] },
  {
    fichiers: ['Gemfile.lock', 'Gemfile'],
    defauts: ['rubygems.org', 'index.rubygems.org'],
    declares: /(?:remote:|source)\s*['"]?https?:\/\/([^/'":\s]+)/g,
  },
  {
    fichiers: ['composer.lock', 'composer.json'],
    defauts: ['repo.packagist.org', 'packagist.org'],
  },
];

/**
 * Les registres que le dépôt de `cwd` déclare, à sa RACINE — bornés, triés,
 * sans doublon. Rien de lu hors de la racine : c'est là qu'un dépôt range ses
 * verrous, et parcourir l'arbre coûterait sur un monorepo géant.
 */
export function registresDuDepot(cwd: string): string[] {
  const hotes = new Set<string>();
  for (const eco of ECOSYSTEMES) {
    for (const nom of eco.fichiers) {
      const fichier = path.join(cwd, nom);
      if (!existsSync(fichier)) continue;
      for (const d of eco.defauts) hotes.add(d);
      if (!eco.declares) continue;
      const texte = lireDebut(fichier);
      if (texte) for (const h of hotesDesUrl(texte, eco.declares)) hotes.add(h);
    }
  }
  return [...hotes].sort().slice(0, HOTES_DEPOT_MAX);
}

/** Ce que la politique d'une tâche permet — sans les identifiants, qui restent au nœud. */
export interface PolitiqueTache {
  niveau: Exclude<NiveauReseau, 'ouvert'>;
  hotes: string[];
}

/** La liste blanche d'une tâche, selon le niveau de son projet. */
export function politiqueTache(opts: {
  niveau: Exclude<NiveauReseau, 'ouvert'>;
  agent: AgentType;
  repoUrl: string | null;
  cwd: string;
}): PolitiqueTache {
  const hotes = new Set<string>(HOTES_API[opts.agent]);
  if (opts.niveau === 'dependances') {
    for (const h of registresDuDepot(opts.cwd)) hotes.add(h);
    const git = hoteGit(opts.repoUrl);
    if (git) hotes.add(git);
  }
  return { niveau: opts.niveau, hotes: [...hotes].sort() };
}
