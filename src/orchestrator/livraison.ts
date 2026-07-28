// La livraison — de la production d'une ouvrière à une pull request sur le
// dépôt de l'utilisateur.
//
// ─── LA CHAÎNE, ET SES PORTES ────────────────────────────────────────────────
//
//   production d'une ouvrière
//        │
//        ├─ 1. Les Gardiennes            un succès à diff vide n'entre pas
//        ├─ 2. Le polyéthisme            une nourrice est relue avant tout
//        ├─ 3. La rustine                contexte exact, ou refus net
//        ├─ 4. GitHub : branche + PR     ← ce module
//        └─ 5. LE MERGE, PAR UN HUMAIN   jamais ici, jamais automatique
//
// Les quatre premières portes sont mécaniques et se ferment toutes seules. La
// cinquième ne l'est pas, et ce module ne la franchit JAMAIS de lui-même.
// `fusionner()` existe — l'utilisateur veut pouvoir merger depuis la ruche —
// mais elle n'est appelée que par un geste explicite, et le module ne
// l'enchaîne à rien. Un `livrer()` qui mergerait « si tout est vert »
// retirerait la seule garantie que Hive donne depuis le premier jour.
//
// ─── POURQUOI L'API GIT DATA, ET PAS UN PUSH ─────────────────────────────────
//
// Pousser supposerait un clone côté hub, donc un checkout du code de
// l'utilisateur sur la machine de la Queen — exactement ce que l'architecture
// refuse. L'API Git Data permet d'écrire un commit sans jamais avoir le dépôt :
// on téléverse des blobs, on compose un arbre à partir de l'arbre existant, on
// crée un commit, on pointe une branche dessus. Rien n'est cloné, rien n'est
// écrit sur disque.
//
// ─── LE JETON ────────────────────────────────────────────────────────────────
//
// Même règle que `github.ts`, et elle est plus grave ici : ce module ÉCRIT. Le
// jeton est lu de l'environnement, vit en mémoire, n'entre jamais en base et
// n'apparaît dans aucun message d'erreur. Une portée `repo` suffit ; une
// portée `workflow` n'est PAS demandée, et c'est délibéré — la ruche n'a pas à
// pouvoir modifier les workflows CI du dépôt qu'elle sert.
//
// ─── CE QUI VIENT D'UNE OUVRIÈRE EST DONNÉE, PAS INSTRUCTION ─────────────────
//
// Le titre d'une tâche et le corps d'une PR sont écrits, in fine, par un agent.
// Ils atterrissent sur une page que des humains liront et où d'autres agents
// (relecteurs automatiques, bots) passeront. Tout est aplati et borné avant
// d'être envoyé — un titre de PR ne doit pas pouvoir contenir de saut de ligne,
// et le corps annonce explicitement d'où il vient.

import { champSurUneLigne } from '../shared/donnees-non-fiables.js';
import { API_DEFAUT, ErreurGithub, entetes, estFullName, expliquerStatut } from './github.js';
import type { Fetcheur } from './github.js';
import { analyserRustine, appliquerRustine, cheminsDe } from './rustine.js';
import type { Ecriture } from './rustine.js';

/** Préfixe des branches ouvertes par la ruche. Reconnaissable d'un coup d'œil. */
export const PREFIXE_BRANCHE = 'hive/';

/** Mode d'un fichier ordinaire dans un arbre git. */
const MODE_FICHIER = '100644';

/** Longueurs retenues pour ce qui part sur GitHub. */
export const MAX_TITRE_PR = 200;
export const MAX_CORPS_PR = 8_000;

export interface OptionsLivraison {
  jeton: string;
  api?: string;
  fetcheur?: Fetcheur;
}

/** Ce qu'il faut savoir pour livrer. */
export interface Livraison {
  /** `owner/repo`. */
  depot: string;
  /** Branche de départ ET cible de la PR. */
  base: string;
  /** Nom de la branche à créer, sans le préfixe `refs/heads/`. */
  branche: string;
  diff: string;
  titre: string;
  /** Corps de la PR, déjà composé par l'appelant. */
  corps: string;
  /** Message de commit. À défaut, le titre. */
  messageCommit?: string;
}

export interface ResultatLivraison {
  branche: string;
  commitSha: string;
  /** Numéro de la pull request ouverte. */
  pr: number;
  urlPr: string;
  fichiers: string[];
}

/**
 * Extrait `owner/repo` d'une URL de clone GitHub. `null` si ce n'en est pas une.
 *
 * Les projets rangent une `repoUrl` (c'est ce que `github-import` y met) ; la
 * livraison, elle, raisonne en `owner/repo`. La conversion vit ici plutôt que
 * dans le serveur pour être testable — et parce qu'elle doit REFUSER tout ce
 * qui n'est pas GitHub, faute de quoi une URL de dépôt maison enverrait des
 * requêtes authentifiées vers un hôte quelconque.
 */
export function depotDepuisUrl(url: string | null): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const segments = u.pathname
    .replace(/^\/+/, '')
    .replace(/\.git$/, '')
    .split('/');
  if (segments.length !== 2) return null;
  const plein = segments.join('/');
  return estFullName(plein) ? plein : null;
}

/** Nom de branche sûr, dérivé d'un identifiant de tâche. */
export function nomBranche(taskId: string): string {
  const propre = taskId.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 60);
  return `${PREFIXE_BRANCHE}${propre || 'tache'}`;
}

/**
 * Une référence de branche acceptable.
 *
 * SÉCURITÉ : le nom de branche part dans une URL d'API. Les caractères refusés
 * ici sont ceux qui permettraient d'en sortir (`..`, `//`) ou de fabriquer une
 * référence git valide mais inattendue (`~`, `^`, `:`, `?`, `*`, `[`, espace).
 */
export function refValide(ref: string): boolean {
  if (ref === '' || ref.length > 200) return false;
  if (/[\s~^:?*[\\]/.test(ref)) return false;
  if (ref.includes('..') || ref.includes('//')) return false;
  if (ref.startsWith('/') || ref.endsWith('/') || ref.endsWith('.lock')) return false;
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(ref);
}

// ─── L'appel réseau ──────────────────────────────────────────────────────────

interface Contexte {
  f: Fetcheur;
  base: string;
  jeton: string;
  depot: string;
}

function contexte(opts: OptionsLivraison, depot: string): Contexte {
  if (!estFullName(depot)) {
    throw new ErreurGithub(
      'nom de dépôt invalide',
      400,
      'Attendu : owner/repo — par exemple Micka420-collab/hive.',
    );
  }
  return {
    f: opts.fetcheur ?? fetch,
    base: (opts.api ?? API_DEFAUT).replace(/\/+$/, ''),
    jeton: opts.jeton,
    depot,
  };
}

/** GET qui rend `null` sur 404 — l'absence est une réponse, pas une panne. */
async function lireOuNull(ctx: Contexte, chemin: string): Promise<unknown | null> {
  const rep = await ctx.f(`${ctx.base}${chemin}`, { headers: entetes(ctx.jeton) });
  if (rep.status === 404) return null;
  if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));
  return rep.json();
}

async function lire(ctx: Contexte, chemin: string): Promise<unknown> {
  const v = await lireOuNull(ctx, chemin);
  if (v === null) throw expliquerStatut(404, null);
  return v;
}

async function ecrire(
  ctx: Contexte,
  chemin: string,
  corps: unknown,
  methode = 'POST',
): Promise<unknown> {
  const rep = await ctx.f(`${ctx.base}${chemin}`, {
    method: methode,
    headers: { ...entetes(ctx.jeton), 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  });
  if (!rep.ok) {
    const e = expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));
    // 422 sur une écriture git veut presque toujours dire « la référence existe
    // déjà » ou « rien à commiter » : le message générique n'aiderait personne.
    if (rep.status === 422) {
      throw new ErreurGithub(
        'GitHub a refusé l’écriture',
        422,
        'La branche existe peut-être déjà, ou le commit ne change rien. Supprimez la branche ou refaites la tâche.',
      );
    }
    throw e;
  }
  return rep.json();
}

function champ(o: unknown, cle: string): unknown {
  return typeof o === 'object' && o !== null ? (o as Record<string, unknown>)[cle] : undefined;
}

function chaine(o: unknown, cle: string): string {
  const v = champ(o, cle);
  return typeof v === 'string' ? v : '';
}

/**
 * Lit le contenu actuel d'un fichier sur une branche. `null` s'il n'y est pas.
 *
 * Passe par l'API `contents`, qui rend le blob en base64 jusqu'à 1 Mo — la même
 * borne que `MAX_FICHIER` de la rustine. Au-delà, on refuse plutôt que de
 * bricoler : un fichier d'un mégaoctet n'est pas ce qu'une ouvrière modifie.
 */
export async function lireContenu(
  ctx: Contexte,
  chemin: string,
  ref: string,
): Promise<string | null> {
  const brut = await lireOuNull(
    ctx,
    `/repos/${ctx.depot}/contents/${chemin.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
  );
  if (brut === null) return null;
  if (champ(brut, 'type') !== 'file') {
    throw new ErreurGithub(
      `« ${chemin} » n’est pas un fichier`,
      409,
      'Le diff vise un chemin qui est un dossier ou un lien symbolique sur la branche cible.',
    );
  }
  const encodage = chaine(brut, 'encoding');
  if (encodage !== 'base64') {
    throw new ErreurGithub(
      `contenu de « ${chemin} » illisible`,
      413,
      'Le fichier est trop volumineux pour être lu par l’API contents. Modifiez-le à la main.',
    );
  }
  return Buffer.from(chaine(brut, 'content'), 'base64').toString('utf8');
}

/**
 * Livre une production : lit la base, applique le diff, crée la branche et
 * ouvre la pull request.
 *
 * NE MERGE RIEN. Une PR ouverte est un objet inerte : elle attend un humain.
 */
export async function livrer(opts: OptionsLivraison, l: Livraison): Promise<ResultatLivraison> {
  const ctx = contexte(opts, l.depot);
  if (!refValide(l.base) || !refValide(l.branche)) {
    throw new ErreurGithub(
      'nom de branche invalide',
      400,
      'Un nom de branche ne peut pas contenir d’espace, de « .. », ni de caractère de contrôle.',
    );
  }

  // 1. La rustine, AVANT tout appel d'écriture : un diff inapplicable ne doit
  //    pas laisser une branche orpheline derrière lui.
  const rustine = analyserRustine(l.diff);
  const chemins = cheminsDe(rustine);

  // 2. La base. On lit la référence, puis le contenu de chaque fichier visé —
  //    séquentiellement : une rafale de requêtes sur un dépôt à 100 fichiers
  //    déclencherait la limite secondaire de GitHub, qui est un bannissement
  //    temporaire et non un simple 429.
  const ref = await lire(ctx, `/repos/${ctx.depot}/git/ref/heads/${encodeURIComponent(l.base)}`);
  const baseSha = chaine(champ(ref, 'object'), 'sha');
  if (!baseSha) {
    throw new ErreurGithub(
      `branche « ${l.base} » introuvable`,
      404,
      'Vérifiez le nom de la branche de base du dépôt.',
    );
  }
  const bases = new Map<string, string | null>();
  for (const chemin of chemins) bases.set(chemin, await lireContenu(ctx, chemin, l.base));

  // 3. Application — tout ou rien. Lève avant la moindre écriture.
  const ecritures = appliquerRustine(rustine, bases);

  // 4. Blobs, puis arbre, puis commit. Un blob téléversé et jamais référencé
  //    est ramassé par GitHub : une erreur en cours de route ne laisse rien.
  const entrees: Array<Record<string, unknown>> = [];
  for (const e of ecritures) {
    if (e.contenu === null) {
      // `sha: null` dans un arbre = suppression du chemin.
      entrees.push({ path: e.chemin, mode: MODE_FICHIER, type: 'blob', sha: null });
      continue;
    }
    const blob = await ecrire(ctx, `/repos/${ctx.depot}/git/blobs`, {
      content: Buffer.from(e.contenu, 'utf8').toString('base64'),
      encoding: 'base64',
    });
    entrees.push({
      path: e.chemin,
      mode: MODE_FICHIER,
      type: 'blob',
      sha: chaine(blob, 'sha'),
    });
  }

  const arbre = await ecrire(ctx, `/repos/${ctx.depot}/git/trees`, {
    base_tree: baseSha,
    tree: entrees,
  });
  const commit = await ecrire(ctx, `/repos/${ctx.depot}/git/commits`, {
    message: champSurUneLigne(l.messageCommit || l.titre, MAX_TITRE_PR),
    tree: chaine(arbre, 'sha'),
    parents: [baseSha],
  });
  const commitSha = chaine(commit, 'sha');

  // 5. La branche. `POST refs` échoue si elle existe : c'est voulu, on ne
  //    réécrit jamais une branche par surprise.
  await ecrire(ctx, `/repos/${ctx.depot}/git/refs`, {
    ref: `refs/heads/${l.branche}`,
    sha: commitSha,
  });

  // 6. La pull request.
  const pr = await ecrire(ctx, `/repos/${ctx.depot}/pulls`, {
    title: champSurUneLigne(l.titre, MAX_TITRE_PR),
    head: l.branche,
    base: l.base,
    body: l.corps.slice(0, MAX_CORPS_PR),
    maintainer_can_modify: true,
  });

  return {
    branche: l.branche,
    commitSha,
    pr: typeof champ(pr, 'number') === 'number' ? (champ(pr, 'number') as number) : 0,
    urlPr: chaine(pr, 'html_url'),
    fichiers: ecritures.map((e: Ecriture) => e.chemin),
  };
}

/**
 * Fusionne une pull request. GESTE HUMAIN EXPLICITE, jamais enchaîné.
 *
 * Cette fonction n'est appelée par aucune autre de ce module, et ce n'est pas
 * un oubli : c'est la garantie centrale de Hive. Elle existe parce qu'un humain
 * qui a relu doit pouvoir conclure depuis la ruche, pas pour qu'une chaîne
 * automatique conclue à sa place.
 */
export async function fusionner(
  opts: OptionsLivraison,
  depot: string,
  pr: number,
  methode: 'merge' | 'squash' | 'rebase' = 'squash',
): Promise<{ fusionnee: boolean; sha: string }> {
  const ctx = contexte(opts, depot);
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new ErreurGithub('numéro de PR invalide', 400, 'Attendu : un entier positif.');
  }
  const rep = await ctx.f(`${ctx.base}/repos/${depot}/pulls/${pr}/merge`, {
    method: 'PUT',
    headers: { ...entetes(ctx.jeton), 'content-type': 'application/json' },
    body: JSON.stringify({ merge_method: methode }),
  });
  if (rep.status === 405) {
    throw new ErreurGithub(
      'fusion refusée par GitHub',
      405,
      'La PR n’est pas fusionnable : conflit, vérification en échec, ou revue requise. Réglez-le sur GitHub.',
    );
  }
  if (rep.status === 409) {
    throw new ErreurGithub(
      'la branche a bougé',
      409,
      'Un commit est arrivé depuis la lecture. Rechargez la PR et réessayez.',
    );
  }
  if (!rep.ok) throw expliquerStatut(rep.status, rep.headers.get('x-ratelimit-remaining'));
  const corps: unknown = await rep.json();
  return { fusionnee: champ(corps, 'merged') === true, sha: chaine(corps, 'sha') };
}

/**
 * Compose le corps d'une pull request ouverte par la ruche.
 *
 * Il dit trois choses, dans cet ordre : d'où vient ce code, ce que la ruche a
 * vérifié, et ce qu'elle n'a PAS vérifié. La troisième est la plus importante —
 * une PR qui n'énonce que ses contrôles réussis se fait relire moins bien.
 */
export function corpsPr(opts: {
  tache: string;
  nodeName: string;
  caste?: string;
  verdictGardiennes?: string;
  contreVisite?: { suite: string; raison: string } | null;
  fichiers: readonly string[];
  /**
   * L'issue à l'origine de la tâche, s'il y en a une.
   *
   * ⚠ CE NUMÉRO VIENT DE L'API, JAMAIS DU TEXTE DE L'ISSUE. Un corps d'issue
   * qui contiendrait « Closes #7 » ne doit pas pouvoir faire refermer l'issue
   * de quelqu'un d'autre : c'est le lien rangé par la ruche qui décide, et lui
   * seul. D'où un `number`, et pas une chaîne libre.
   */
  issue?: number;
}): string {
  const lignes: string[] = [
    '## 🐝 Ouvert par une ruche Hive',
    '',
    ...(typeof opts.issue === 'number' && Number.isInteger(opts.issue) && opts.issue > 0
      ? [`Closes #${opts.issue}`, '']
      : []),
    `**Tâche** — ${champSurUneLigne(opts.tache, 300)}`,
    `**Ouvrière** — ${champSurUneLigne(opts.nodeName, 80)}${opts.caste ? ` (${opts.caste})` : ''}`,
    '',
    '### Ce que la ruche a vérifié',
    '',
  ];
  if (opts.verdictGardiennes) {
    lignes.push(
      `- **Gardiennes** — verdict \`${champSurUneLigne(opts.verdictGardiennes, 40)}\` : la production n’est pas un succès déclaré à diff vide.`,
    );
  }
  if (opts.contreVisite) {
    lignes.push(
      `- **Contre-visite** — \`${champSurUneLigne(opts.contreVisite.suite, 40)}\` : ${champSurUneLigne(opts.contreVisite.raison, 300)}`,
    );
  }
  lignes.push(
    "- **Rustine** — le diff s'applique au contexte exact de cette branche ; aucun bloc n'a été décalé.",
    '',
    '### Ce que la ruche n’a PAS vérifié',
    '',
    '- Que ce code soit **une bonne idée**. Aucun contrôle automatique ne répond à ça.',
    '- Qu’il n’introduise pas de régression que les tests ne couvrent pas.',
    '',
    `### Fichiers (${opts.fichiers.length})`,
    '',
    ...opts.fichiers.slice(0, 50).map((f) => `- \`${champSurUneLigne(f, 200)}\``),
  );
  if (opts.fichiers.length > 50) lignes.push(`- … et ${opts.fichiers.length - 50} de plus`);
  lignes.push(
    '',
    '---',
    '',
    '**Aucun merge n’est automatique.** Cette pull request attend une relecture humaine — c’est la seule garantie que Hive donne, et elle n’a pas d’exception.',
  );
  return lignes.join('\n').slice(0, MAX_CORPS_PR);
}
