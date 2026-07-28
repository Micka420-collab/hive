// Connecter ses dépôts GitHub — lister, choisir, importer.
//
// ─── OÙ VIT LE JETON, ET POURQUOI PAS EN BASE ────────────────────────────────
//
// Un jeton GitHub ouvre l'accès en lecture — souvent en écriture — à TOUS les
// dépôts de son propriétaire. C'est, de loin, le secret le plus puissant qui
// puisse approcher une ruche.
//
// Il n'est donc JAMAIS rangé en base. Il est lu de l'environnement au démarrage
// et vit en mémoire, point. Trois raisons, dans l'ordre d'importance :
//
//   1. Une base volée ne doit pas donner l'accès aux dépôts de l'hôte. Le reste
//      de Hive tient déjà cette promesse (billets et clés de nœud ne sont que
//      des empreintes) ; un jeton en clair dans `hive.db` la ruinerait d'un coup.
//   2. Les sauvegardes. Une base se copie, se synchronise, se joint à un rapport
//      de bogue. Un secret qui y vit finit par voyager.
//   3. La révocation. Un jeton en variable d'environnement se retire en
//      redémarrant ; un jeton en base survit à tout ce qu'on oublie de nettoyer.
//
// Le prix assumé : il faut le redonner à chaque démarrage. C'est le bon prix.
//
// ─── CE QUI VIENT DE GITHUB EST DONNÉE, PAS INSTRUCTION ──────────────────────
//
// Le nom et la DESCRIPTION d'un dépôt sont écrits par son propriétaire — qui
// n'est pas forcément l'hôte de la ruche. Or la description d'un projet Hive
// entre dans le prompt des éclaireuses du Conseil. Importer le dépôt de
// quelqu'un d'autre, c'est donc lui donner un canal vers les agents des membres.
// Tout ce qui vient d'ici est nettoyé à l'entrée, et le Conseil l'emballe
// ensuite dans son bloc de données non fiables.

import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import { lireIssue, pourChoisir as pourChoisirIssues } from '../shared/issue.js';
import type { IssueGithub } from '../shared/issue.js';

/** Base de l'API. Surchargée par HIVE_GITHUB_API (GitHub Enterprise). */
export const API_DEFAUT = 'https://api.github.com';

/** Dépôts demandés par page. 100 est le maximum autorisé par GitHub. */
export const PAR_PAGE = 100;

/** Pages au plus. 3 × 100 = 300 dépôts : au-delà, on filtre plutôt qu'on liste. */
export const PAGES_MAX = 3;

/** Longueurs retenues — ce sont des données d'affichage, pas des documents. */
export const MAX_NOM = 140;
export const MAX_DESCRIPTION = 300;

/** Un dépôt, réduit à ce qui sert à choisir. */
export interface DepotGithub {
  /** `owner/repo`, l'identifiant stable. */
  fullName: string;
  nom: string;
  description: string;
  prive: boolean;
  /** URL de clonage HTTPS. */
  cloneUrl: string;
  htmlUrl: string;
  langage: string;
  /** Dernier push, en ms. Sert au tri : le plus récent est le plus pertinent. */
  pousseA: number;
  archive: boolean;
}

/**
 * Nettoie une chaîne venue de GitHub avant qu'elle n'entre où que ce soit.
 *
 * Aplatie (un saut de ligne dans une description permettrait de fabriquer une
 * fausse consigne visuellement isolée dans un prompt) et bornée.
 */
function texte(v: unknown, max: number): string {
  return typeof v === 'string' ? champSurUneLigne(v, max) : '';
}

/**
 * Valide un dépôt tel que GitHub le rend. Rend `null` si l'objet ne porte pas
 * le minimum utilisable — un dépôt à moitié lu ne doit pas atterrir dans une
 * liste de choix, où l'humain croirait pouvoir le sélectionner.
 */
export function lireDepot(brut: unknown): DepotGithub | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const d = brut as Record<string, unknown>;
  const fullName = texte(d.full_name, MAX_NOM);
  const cloneUrl = typeof d.clone_url === 'string' ? d.clone_url : '';
  if (!fullName.includes('/') || !estUrlHttps(cloneUrl)) return null;

  const pousse = typeof d.pushed_at === 'string' ? Date.parse(d.pushed_at) : Number.NaN;
  return {
    fullName,
    nom: texte(d.name, MAX_NOM) || fullName,
    description: texte(d.description, MAX_DESCRIPTION),
    prive: d.private === true,
    cloneUrl,
    htmlUrl: estUrlHttps(d.html_url) ? (d.html_url as string) : `https://github.com/${fullName}`,
    langage: texte(d.language, 40),
    pousseA: Number.isFinite(pousse) ? pousse : 0,
    archive: d.archived === true,
  };
}

function estUrlHttps(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}

/** `owner/repo` bien formé — refusé tôt plutôt qu'en 404 de l'API. */
export function estFullName(v: string): boolean {
  return /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/.test(v) && !v.includes('..');
}

/**
 * Trie les dépôts pour un humain qui choisit : le plus récemment poussé en
 * tête, les archivés en queue.
 *
 * Un dépôt archivé n'est presque jamais celui qu'on veut ; le reléguer évite
 * qu'un vieux projet abandonné n'occupe les premières lignes d'une liste.
 */
export function pourChoisir(depots: readonly DepotGithub[]): DepotGithub[] {
  return [...depots].sort(
    (a, b) =>
      Number(a.archive) - Number(b.archive) ||
      b.pousseA - a.pousseA ||
      a.fullName.localeCompare(b.fullName),
  );
}

/** Filtre libre sur le nom complet, la description et le langage. */
export function filtrer(depots: readonly DepotGithub[], q: string): DepotGithub[] {
  const t = q.trim().toLowerCase();
  if (!t) return [...depots];
  return depots.filter((d) =>
    `${d.fullName} ${d.description} ${d.langage}`.toLowerCase().includes(t),
  );
}

// ─── L'appel réseau ───────────────────────────────────────────────────────────

/** `fetch`, injectable — les tests ne doivent jamais toucher au réseau. */
export type Fetcheur = (url: string, init?: RequestInit) => Promise<Response>;

export interface OptionsGithub {
  jeton: string;
  api?: string;
  fetcheur?: Fetcheur;
}

export class ErreurGithub extends Error {
  constructor(
    message: string,
    readonly statut: number,
    /** Message d'action pour l'humain — jamais le jeton, jamais l'URL brute. */
    readonly conseil: string,
  ) {
    super(message);
    this.name = 'ErreurGithub';
  }
}

/**
 * Traduit un statut HTTP en cause probable ET en geste à faire.
 *
 * Un « 401 » brut n'aide personne : c'est le moment exact où l'utilisateur
 * abandonne. Ici, chaque cas dit quoi faire.
 */
export function expliquerStatut(statut: number, reste: string | null): ErreurGithub {
  if (statut === 401) {
    return new ErreurGithub(
      'jeton refusé',
      401,
      'Le jeton est invalide ou expiré. Régénérez-en un sur https://github.com/settings/tokens (portée « repo » pour voir vos dépôts privés).',
    );
  }
  if (statut === 403 && reste === '0') {
    return new ErreurGithub(
      'quota GitHub épuisé',
      403,
      'Vous avez atteint la limite de requêtes GitHub. Réessayez dans quelques minutes.',
    );
  }
  if (statut === 403) {
    return new ErreurGithub(
      'accès refusé',
      403,
      'Le jeton n’a pas la portée nécessaire. Il lui faut « repo » pour lister vos dépôts privés.',
    );
  }
  if (statut === 404) {
    return new ErreurGithub('introuvable', 404, 'Dépôt inexistant, ou invisible pour ce jeton.');
  }
  return new ErreurGithub(
    `GitHub a répondu ${statut}`,
    statut,
    'Réessayez ; si cela persiste, vérifiez https://www.githubstatus.com/.',
  );
}

export function entetes(jeton: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${jeton}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'hive-orchestrator',
  };
}

/**
 * Liste les dépôts de l'utilisateur du jeton.
 *
 * Pagination BORNÉE : au-delà de PAGES_MAX, on s'arrête et on le dit plutôt que
 * de boucler. Un compte à 5 000 dépôts ne doit pas figer l'orchestrateur — et
 * une liste de 5 000 lignes n'aide personne à choisir de toute façon.
 */
export async function listerDepots(
  opts: OptionsGithub,
): Promise<{ depots: DepotGithub[]; tronque: boolean }> {
  const f = opts.fetcheur ?? fetch;
  const base = (opts.api ?? API_DEFAUT).replace(/\/+$/, '');
  const depots: DepotGithub[] = [];
  let tronque = false;

  for (let page = 1; page <= PAGES_MAX; page++) {
    const url = `${base}/user/repos?per_page=${PAR_PAGE}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`;
    const rep = await f(url, { headers: entetes(opts.jeton) });
    if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));

    const brut: unknown = await rep.json();
    if (!Array.isArray(brut)) break;
    for (const item of brut) {
      const d = lireDepot(item);
      if (d) depots.push(d);
    }
    if (brut.length < PAR_PAGE) break;
    if (page === PAGES_MAX) tronque = true;
  }
  return { depots: pourChoisir(depots), tronque };
}

/**
 * Liste les issues OUVERTES d'un dépôt.
 *
 * ⚠ `?pulls=false` N'EXISTE PAS dans l'API GitHub : cet endpoint rend les pull
 * requests avec les issues, et aucun paramètre ne les écarte. Le filtre vit
 * donc dans `lireIssue`, qui refuse tout objet portant une clé `pull_request`.
 * On le rappelle ici parce que c'est en lisant CE code qu'on croira, un jour,
 * pouvoir se passer du filtre.
 *
 * Pagination bornée comme pour les dépôts : un dépôt à 4 000 issues ne doit ni
 * figer l'orchestrateur, ni rendre une liste que personne ne parcourra.
 */
export async function listerIssues(
  opts: OptionsGithub,
  fullName: string,
): Promise<{ issues: IssueGithub[]; tronque: boolean }> {
  if (!estFullName(fullName)) {
    throw new ErreurGithub(
      'nom de dépôt invalide',
      400,
      'Attendu : owner/repo — par exemple Micka420-collab/hive.',
    );
  }
  const f = opts.fetcheur ?? fetch;
  const base = (opts.api ?? API_DEFAUT).replace(/\/+$/, '');
  const issues: IssueGithub[] = [];
  let tronque = false;

  for (let page = 1; page <= PAGES_MAX; page++) {
    const url = `${base}/repos/${fullName}/issues?state=open&per_page=${PAR_PAGE}&page=${page}&sort=updated&direction=desc`;
    const rep = await f(url, { headers: entetes(opts.jeton) });
    if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));

    const brut: unknown = await rep.json();
    if (!Array.isArray(brut)) break;
    for (const item of brut) {
      const i = lireIssue(item);
      if (i) issues.push(i);
    }
    // La page COMPLÈTE compte pour la pagination, pas seulement ce qu'on en a
    // retenu : une page de 100 entrées dont 100 sont des PR est pleine, et
    // s'arrêter là ferait manquer les issues de la page suivante.
    if (brut.length < PAR_PAGE) break;
    if (page === PAGES_MAX) tronque = true;
  }
  return { issues: pourChoisirIssues(issues), tronque };
}

/**
 * Récupère UNE issue par son numéro.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE PLUTÔT QUE DE FILTRER LA LISTE ───────────
 *
 * Prendre une issue est un ACTE : ce qui part en planification doit être ce que
 * GitHub dit MAINTENANT, pas une entrée d'une liste chargée il y a dix minutes,
 * et surtout pas un objet fourni par le client. Sans cette relecture,
 * n'importe quel appelant fabriquerait le « contenu d'une issue » et la ruche
 * le découperait en tâches.
 *
 * Le filtre des pull requests s'applique ici aussi : `/issues/{n}` répond pour
 * une PR, avec sa clé `pull_request`.
 */
export async function lireUneIssue(
  opts: OptionsGithub,
  fullName: string,
  numero: number,
): Promise<IssueGithub> {
  if (!estFullName(fullName)) {
    throw new ErreurGithub(
      'nom de dépôt invalide',
      400,
      'Attendu : owner/repo — par exemple Micka420-collab/hive.',
    );
  }
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new ErreurGithub('numéro d’issue invalide', 400, 'Un numéro d’issue est un entier > 0.');
  }
  const f = opts.fetcheur ?? fetch;
  const base = (opts.api ?? API_DEFAUT).replace(/\/+$/, '');
  const rep = await f(`${base}/repos/${fullName}/issues/${numero}`, {
    headers: entetes(opts.jeton),
  });
  if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));

  const i = lireIssue(await rep.json());
  if (!i) {
    // Le cas le plus probable n'est pas une réponse illisible : c'est une PULL
    // REQUEST. Le dire évite une demi-heure de recherche sur un « 502 » muet.
    throw new ErreurGithub(
      'ce numéro ne désigne pas une issue',
      409,
      `#${numero} est une pull request, ou une issue sans titre exploitable. Chez GitHub, une pull request EST une issue : seul son contenu les distingue.`,
    );
  }
  return i;
}

/** Récupère UN dépôt par `owner/repo`. */
export async function lireUnDepot(opts: OptionsGithub, fullName: string): Promise<DepotGithub> {
  if (!estFullName(fullName)) {
    throw new ErreurGithub(
      'nom de dépôt invalide',
      400,
      'Attendu : owner/repo — par exemple Micka420-collab/hive.',
    );
  }
  const f = opts.fetcheur ?? fetch;
  const base = (opts.api ?? API_DEFAUT).replace(/\/+$/, '');
  const rep = await f(`${base}/repos/${fullName}`, { headers: entetes(opts.jeton) });
  if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));
  const d = lireDepot(await rep.json());
  if (!d)
    throw new ErreurGithub('réponse illisible', 502, 'GitHub a répondu quelque chose d’inattendu.');
  return d;
}
