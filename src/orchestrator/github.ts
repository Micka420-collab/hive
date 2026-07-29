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
import {
  estIdWorkflow,
  estRefPlausible,
  jugerWorkflow,
  lireRun,
  lireWorkflow,
  pourAfficher as pourAfficherRuns,
  pourChoisir as pourChoisirWorkflows,
} from '../shared/workflow.js';
import type { RunWorkflow, Workflow } from '../shared/workflow.js';

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
 * `owner/repo` déduit de l'URL de clonage d'un projet, ou `null`.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 *
 * Un projet Hive ne garde qu'un `repoUrl` — c'est ce que l'humain a collé, et
 * c'est ce qui sert à cloner. L'API GitHub, elle, ne connaît que `owner/repo`.
 * Le pont entre les deux est exactement le genre d'endroit où l'on écrit un
 * `split('/')` en passant, et où les cas particuliers s'accumulent en silence.
 *
 * Ils sont donc énumérés ici, et testés :
 *
 *   · `https://github.com/o/r.git`  et sans `.git`
 *   · `git@github.com:o/r.git`      (SSH, deux-points au lieu d'une barre)
 *   · une barre finale, une URL de navigateur (`/o/r/tree/main`)
 *   · un CHEMIN LOCAL — le cas des tests et des démos — qui rend `null`, parce
 *     qu'un dossier sur un disque n'a pas de dépôt GitHub.
 *
 * L'hôte n'est PAS vérifié : `HIVE_GITHUB_API` existe pour GitHub Enterprise,
 * et exiger `github.com` fermerait la porte aux installations d'entreprise —
 * précisément celles qui ont des workflows.
 */
export function fullNameDepuisUrl(repoUrl: string): string | null {
  const brut = repoUrl.trim();
  if (brut === '') return null;

  // ─── `new URL` NORMALISE, ET C'EST UN PIÈGE ────────────────────────────────
  //
  // Trouvé par un test, pas par relecture. `new URL('https://github.com/../../
  // etc/passwd').pathname` rend `/etc/passwd` : les `..` sont RÉSOLUS, et le
  // chemin qu'on lit n'est plus celui qu'on nous a donné. La fonction rendait
  // donc `etc/passwd` — un `owner/repo` parfaitement bien formé, désignant un
  // dépôt que personne n'a nommé.
  //
  // Ce n'était pas une traversée de chemin (les segments finaux sont propres,
  // et l'appel aurait fini en 404). C'était pire à sa façon : une fonction qui
  // INVENTE un nom plausible à partir d'une entrée qui n'en contenait pas.
  //
  // On refuse donc avant de parser. Une URL de dépôt ne contient jamais `..` ;
  // celle qui en contient n'est pas une URL qu'on doit deviner.
  if (brut.includes('..')) return null;

  // SSH abrégé : `git@hote:owner/repo.git`. Ce n'est pas une URL au sens de
  // `new URL`, d'où le traitement séparé plutôt qu'un `try` optimiste.
  const ssh = /^[\w.-]+@[\w.-]+:(.+)$/.exec(brut);
  const chemin = ssh
    ? ssh[1]!
    : /^(https?|git|ssh):\/\//.test(brut)
      ? (() => {
          try {
            return new URL(brut).pathname;
          } catch {
            return '';
          }
        })()
      : ''; // chemin local, ou n'importe quoi d'autre : pas un dépôt GitHub

  const morceaux = chemin
    .replace(/\.git$/i, '')
    .split('/')
    .filter((x) => x !== '');
  if (morceaux.length < 2) return null;
  const nom = `${morceaux[0]}/${morceaux[1]}`;
  return estFullName(nom) ? nom : null;
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

// ─── LES WORKFLOWS ───────────────────────────────────────────────────────────
//
// Lister, lancer, relire. La frontière est écrite dans `shared/workflow.ts` et
// elle mérite d'être rappelée ici, parce que c'est en lisant CE fichier qu'on
// croira, un jour, pouvoir passer un nom de fichier :
//
//   POST /repos/{o}/{r}/actions/workflows/{id_OU_nom_de_fichier}/dispatches
//
// Ce segment accepte les deux. Accepter le nom laisserait un appelant écrire
// un morceau d'URL de l'API GitHub — avec le jeton de l'hôte, qui ouvre TOUS
// ses dépôts. On n'y met donc qu'un entier vérifié présent dans la liste que
// l'API vient de rendre.

/**
 * Les workflows déclarés par un dépôt.
 *
 * Pagination bornée, comme les dépôts et les issues : un monorepo à 400
 * workflows ne doit ni figer l'orchestrateur, ni rendre une liste que personne
 * ne parcourra.
 */
export async function listerWorkflows(
  opts: OptionsGithub,
  fullName: string,
): Promise<{ workflows: Workflow[]; tronque: boolean }> {
  if (!estFullName(fullName)) {
    throw new ErreurGithub(
      'nom de dépôt invalide',
      400,
      'Attendu : owner/repo — par exemple Micka420-collab/hive.',
    );
  }
  const f = opts.fetcheur ?? fetch;
  const base = (opts.api ?? API_DEFAUT).replace(/\/+$/, '');
  const workflows: Workflow[] = [];
  let tronque = false;

  for (let page = 1; page <= PAGES_MAX; page++) {
    const url = `${base}/repos/${fullName}/actions/workflows?per_page=${PAR_PAGE}&page=${page}`;
    const rep = await f(url, { headers: entetes(opts.jeton) });
    if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));

    const brut: unknown = await rep.json();
    // ⚠ CET ENDPOINT NE REND PAS UN TABLEAU. Il rend
    // `{ total_count, workflows: [...] }` — contrairement à `/user/repos` et
    // `/issues` juste au-dessus. Traiter la réponse comme un tableau rendrait
    // une liste VIDE sans erreur, et « ce dépôt n'a aucun workflow » est un
    // mensonge parfaitement crédible.
    const lot =
      typeof brut === 'object' &&
      brut !== null &&
      Array.isArray((brut as Record<string, unknown>).workflows)
        ? ((brut as Record<string, unknown>).workflows as unknown[])
        : null;
    if (!lot) break;
    for (const item of lot) {
      const w = lireWorkflow(item);
      if (w) workflows.push(w);
    }
    if (lot.length < PAR_PAGE) break;
    if (page === PAGES_MAX) tronque = true;
  }
  return { workflows: pourChoisirWorkflows(workflows), tronque };
}

/**
 * Lance un workflow — par son ID, et seulement s'il est DÉCLARÉ.
 *
 * La liste est relue ici, à chaque appel, et n'est jamais prise de l'appelant :
 * c'est la même règle que `lireUneIssue`, qui relit l'issue plutôt que de
 * croire un objet fourni par le client. Un appelant qui fournirait la liste
 * fournirait aussi l'autorisation.
 *
 * ⚠ Un dispatch réussi rend **204 sans corps** : GitHub ne dit PAS quel run il
 * vient de créer. Le run n'existe d'ailleurs pas encore au retour de l'appel.
 * D'où le contrat de cette fonction : elle rend ce qu'elle a lancé, pas un
 * identifiant de run — c'est `lireRuns` qui le trouvera ensuite.
 */
export async function lancerWorkflow(
  opts: OptionsGithub,
  fullName: string,
  id: number,
  ref: string,
): Promise<{ workflow: Workflow; ref: string }> {
  if (!estRefPlausible(ref)) {
    throw new ErreurGithub(
      'référence git invalide',
      400,
      'Attendu : un nom de branche ou de tag — par exemple `main` ou `v1.2.0`.',
    );
  }

  const { workflows } = await listerWorkflows(opts, fullName);
  const verdict = jugerWorkflow(workflows, id);
  if (!verdict.ok) throw new ErreurGithub('workflow refusé', 400, verdict.motif);

  const f = opts.fetcheur ?? fetch;
  const base = (opts.api ?? API_DEFAUT).replace(/\/+$/, '');
  const rep = await f(
    `${base}/repos/${fullName}/actions/workflows/${verdict.workflow.id}/dispatches`,
    {
      method: 'POST',
      headers: { ...entetes(opts.jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ ref }),
    },
  );
  if (!rep.ok) {
    // 422 sur CE endpoint a une cause quasi unique, et elle est PERMANENTE :
    // le workflow ne déclare pas `workflow_dispatch:`. Le message générique
    // (« réessayez ») serait un mauvais conseil — réessayer ne changera rien,
    // et rien dans la liste des workflows ne permet de le savoir d'avance :
    // l'API ne dit pas quels déclencheurs un workflow porte.
    if (rep.status === 422) {
      throw new ErreurGithub(
        'ce workflow ne se lance pas à la demande',
        422,
        `« ${verdict.workflow.nom} » (${verdict.workflow.chemin}) ne déclare pas « workflow_dispatch ». ` +
          'Ajoutez-le à ses `on:` dans le dépôt, sur la branche par défaut — GitHub ne lit ce déclencheur que là.',
      );
    }
    throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));
  }
  return { workflow: verdict.workflow, ref };
}

/**
 * Les runs récents d'un dépôt, ou d'un seul workflow.
 *
 * UNE SEULE PAGE, et c'est délibéré : on regarde « ce qui vient de se passer »,
 * pas l'historique. Un dépôt actif produit des dizaines de milliers de runs ;
 * en paginer trois pages coûterait trois appels pour une information que
 * personne ne lit au-delà des dix premières lignes.
 */
export async function lireRuns(
  opts: OptionsGithub,
  fullName: string,
  o: { workflowId?: number; limite?: number } = {},
): Promise<RunWorkflow[]> {
  if (!estFullName(fullName)) {
    throw new ErreurGithub(
      'nom de dépôt invalide',
      400,
      'Attendu : owner/repo — par exemple Micka420-collab/hive.',
    );
  }
  if (o.workflowId !== undefined && !estIdWorkflow(o.workflowId)) {
    throw new ErreurGithub(
      'identifiant de workflow invalide',
      400,
      'Un identifiant de workflow est un entier > 0 — jamais un nom de fichier.',
    );
  }
  const limite = Math.max(1, Math.min(PAR_PAGE, o.limite ?? 20));
  const f = opts.fetcheur ?? fetch;
  const base = (opts.api ?? API_DEFAUT).replace(/\/+$/, '');
  // L'id est un entier vérifié : il ne peut pas porter de segment d'URL.
  const chemin =
    o.workflowId === undefined
      ? `${base}/repos/${fullName}/actions/runs?per_page=${limite}`
      : `${base}/repos/${fullName}/actions/workflows/${o.workflowId}/runs?per_page=${limite}`;

  const rep = await f(chemin, { headers: entetes(opts.jeton) });
  if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));

  const brut: unknown = await rep.json();
  // Même forme enveloppée que les workflows : `{ total_count, workflow_runs }`.
  const lot =
    typeof brut === 'object' &&
    brut !== null &&
    Array.isArray((brut as Record<string, unknown>).workflow_runs)
      ? ((brut as Record<string, unknown>).workflow_runs as unknown[])
      : [];
  const runs: RunWorkflow[] = [];
  for (const item of lot) {
    const r = lireRun(item);
    if (r) runs.push(r);
  }
  return pourAfficherRuns(runs);
}
