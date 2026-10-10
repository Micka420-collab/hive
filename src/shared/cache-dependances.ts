// LE MAGASIN DE DÉPENDANCES — ce qui se décide sans toucher au disque (G18).
//
// ─── CE QU'IL ÉVITE, ET À QUELLE CONDITION ───────────────────────────────────
//
// Chaque validation d'une production réinstalle ses dépendances depuis le
// lockfile (`npm ci`), dans le bac, et chaque rejeu G11b de sa base et de sa
// tête recommence : le même `npm ci`, tentative après tentative, tant que le
// lockfile ne bouge pas — le coût dominant d'une validation derrière un vrai
// registre. Le magasin du nœud (`node-client/cache-dependances.ts`) garde le
// `node_modules` que ce `npm ci` produit À LA BASE, et le restaure par copie.
//
// LE VERDICT NE DOIT JAMAIS DÉPENDRE DU MAGASIN. Une entrée ne sert donc qu'un
// arbre dont l'installation ne lit RIEN d'autre que ce que la clé couvre, et
// dont la production n'a pas touché ces entrées-là (`eligibilite`) :
//
//   · l'installation est `npm ci`, d'un SEUL lockfile npm, de version 2 ou
//     plus, dont chaque paquet est désigné par une URL http(s) et une empreinte
//     `integrity` — ni `file:`, ni lien, ni git : leur contenu vient de l'arbre
//     ou d'ailleurs, hors de la clé ;
//   · `package.json` ne déclare ni `workspaces`, ni `patchedDependencies` (npm
//     12 lit les fichiers de patch DANS l'arbre, `arborist/patched-
//     dependencies.js`), ni script d'installation à la racine : `npm ci` lance
//     `preinstall` avant l'installation puis `install`, `postinstall`,
//     `prepublish`, `preprepare`, `prepare`, `postprepare`
//     (`npm/lib/commands/ci.js`), et `predependencies`, `dependencies`,
//     `postdependencies` quand l'arbre a changé (`arborist/reify.js`) — ils
//     lisent l'arbre ;
//   · ni `binding.gyp` à la racine (`@npmcli/run-script` en fait un `node-gyp
//     rebuild`), ni `.npm-extension.mjs`/`.cjs` (npm 12 en compare l'empreinte
//     au lockfile, `arborist/npm-extension.js`) ;
//   · `.npmrc` ne porte que des réglages qui ne désignent aucun fichier
//     (`REGLAGE_NPMRC`) : un `script-shell`, un `cafile`, un `extension-file`
//     feraient lire à npm un fichier de l'arbre ;
//   · la tête porte ces fichiers IDENTIQUES, octet pour octet, à ceux de la base
//     relue par la porte vérifiée ; et rien ne reste de `node_modules`.
//
// Sinon — et c'est le cas d'une production qui change ses dépendances —
// l'arbre s'installe comme avant, et la ligne de progrès dit pourquoi.
//
// ─── LA CLÉ ──────────────────────────────────────────────────────────────────
//
// Tout ce qui fait le résultat de `npm ci` : la version du magasin, le PROJET
// (un projet sans accès à un registre privé ne reçoit jamais les paquets
// privés d'un autre au lockfile identique), le réseau de ses validations,
// l'argv, l'empreinte du bac (Node — version, ABI, N-API, plateforme,
// architecture, glibc —, la configuration globale de npm, npm, le moteur et
// l'image) et les octets des fichiers d'entrée. Pas le commit de base :
// l'entrée resert tant que les dépendances ne bougent pas.
//
// Module PUR, sauf l'empreinte SHA-256 de la clé.

import { createHash } from 'node:crypto';

/** La version du FORMAT du magasin : la changer rend toutes les entrées étrangères. */
export const VERSION_MAGASIN = 1;

/** Les fichiers de la racine que `npm ci` lit — comparés de la base à la tête. */
export const FICHIERS_ENTREE = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  '.npmrc',
  '.npm-extension.mjs',
  '.npm-extension.cjs',
  'binding.gyp',
] as const;
export type FichierEntree = (typeof FICHIERS_ENTREE)[number];

/** Les fichiers d'entrée d'un arbre ; `null` : absent. */
export type EntreesNpm = Readonly<Record<FichierEntree, string | null>>;

/** Les scripts de la RACINE que `npm ci` lance (voir l'en-tête). */
export const SCRIPTS_RACINE = [
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'preprepare',
  'prepare',
  'postprepare',
  'predependencies',
  'dependencies',
  'postdependencies',
] as const;

/**
 * Les réglages de `.npmrc` qui ne désignent AUCUN fichier — registres, jetons
 * par hôte, drapeaux. Tout autre réglage (`script-shell`, `cafile`,
 * `//hôte/:certfile`, `extension-file`, `node-options`…) écarte le projet du
 * magasin : il ferait lire à npm un fichier de l'arbre, hors de la clé.
 */
const REGLAGE_NPMRC =
  /^(?:(?:@[^\s:=]+:)?registry|\/\/\S+:(?:_authToken|_auth|username|_password|always-auth|email)|always-auth|audit|audit-level|fund|loglevel|progress|update-notifier|strict-ssl|engine-strict|legacy-peer-deps|strict-peer-deps|save-exact|save-prefix|package-lock|allow-scripts|allow-remote|allow-git|ignore-scripts|omit|include|optional|fetch-retries|fetch-retry-factor|fetch-retry-mintimeout|fetch-retry-maxtimeout|fetch-timeout|prefer-offline|prefer-online|offline|maxsockets|noproxy|proxy|https-proxy|replace-registry-host|install-strategy|foreground-scripts|os|cpu|libc|before)$/;

/** Pourquoi un arbre ne passe pas par le magasin — un code, dit par `direHorsMagasin`. */
export const RAISONS_HORS_MAGASIN = {
  pas_npm_ci: 'l’installation déclarée n’est pas `npm ci`',
  deux_lockfiles: 'deux lockfiles npm',
  entree_modifiee: 'la production change un fichier que l’installation lit',
  node_modules: 'un `node_modules` est resté dans l’arbre',
  manifeste_illisible: '`package.json` illisible',
  workspaces: 'des `workspaces`',
  patches: 'des `patchedDependencies`',
  script_racine: 'un script d’installation à la racine',
  binding_gyp: 'un `binding.gyp` à la racine',
  extension_npm: 'un `.npm-extension`',
  reglage_npmrc: 'un réglage de `.npmrc` qui désigne un fichier',
  lockfile_illisible: 'lockfile illisible',
  lockfile_ancien: 'lockfile de version 1',
  paquet_hors_registre: 'un paquet sans URL http(s) ni `integrity`',
  base_illisible: 'base illisible',
  empreinte_bac: 'empreinte du bac illisible',
  delai: 'délai de préparation épuisé',
  peuplement: 'peuplement depuis la base impossible',
  entree_refusee: 'entrée refusée',
  copie: 'copie interrompue',
} as const;
export type RaisonHorsMagasin = keyof typeof RAISONS_HORS_MAGASIN;

/** Une raison, dite pour la ligne de progrès — son détail est une donnée du dépôt, bornée. */
export function direHorsMagasin(raison: RaisonHorsMagasin, detail?: string): string {
  const borne = detail && detail.length > 120 ? `${detail.slice(0, 119)}…` : detail;
  return borne ? `${RAISONS_HORS_MAGASIN[raison]} (${borne})` : RAISONS_HORS_MAGASIN[raison];
}

export type Eligibilite =
  { eligible: true } | { eligible: false; raison: RaisonHorsMagasin; detail?: string };

const non = (raison: RaisonHorsMagasin, detail?: string): Eligibilite => ({
  eligible: false,
  raison,
  ...(detail ? { detail } : {}),
});

function objet(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function lireJson(texte: string): Record<string, unknown> | null {
  try {
    return objet(JSON.parse(texte));
  } catch {
    return null;
  }
}

/** Le premier réglage de `.npmrc` qui n'est pas sûr, ou `null`. */
function reglageNonSur(npmrc: string): string | null {
  for (const brute of npmrc.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (ligne === '' || ligne.startsWith('#') || ligne.startsWith(';')) continue;
    const egal = ligne.indexOf('=');
    const cle = (egal < 0 ? ligne : ligne.slice(0, egal)).trim().replace(/\[\]$/, '');
    if (!REGLAGE_NPMRC.test(cle)) return cle;
  }
  return null;
}

/** Le premier paquet du lockfile qui n'est pas un tarball http(s) à empreinte, ou `null`. */
function paquetHorsRegistre(paquets: Record<string, unknown>): string | null {
  for (const [chemin, brut] of Object.entries(paquets)) {
    if (chemin === '') continue;
    const p = objet(brut);
    const resolu = p?.resolved;
    const integrite = p?.integrity;
    const sur =
      p !== null &&
      p.link !== true &&
      typeof resolu === 'string' &&
      /^https?:\/\//i.test(resolu) &&
      typeof integrite === 'string' &&
      integrite.trim() !== '';
    if (!sur) return chemin;
  }
  return null;
}

/**
 * L'arbre peut-il recevoir ses dépendances du magasin ? (Voir l'en-tête.)
 *
 * `base` : les fichiers d'entrée du commit de BASE, lus par la porte
 * vérifiée. `modifies` : ceux que l'arbre ne porte pas à l'identique.
 */
export function eligibilite(p: {
  argv: readonly string[];
  base: EntreesNpm;
  modifies: readonly FichierEntree[];
  nodeModules: boolean;
}): Eligibilite {
  const { base } = p;
  if (p.argv.length !== 2 || p.argv[0] !== 'npm' || p.argv[1] !== 'ci') return non('pas_npm_ci');
  if (base['package-lock.json'] !== null && base['npm-shrinkwrap.json'] !== null) {
    return non('deux_lockfiles');
  }
  const [modifie] = p.modifies;
  if (modifie !== undefined) return non('entree_modifiee', modifie);
  if (p.nodeModules) return non('node_modules');
  const manifeste = base['package.json'] === null ? null : lireJson(base['package.json']);
  if (!manifeste) return non('manifeste_illisible');
  if (manifeste.workspaces !== undefined) return non('workspaces');
  const patches = objet(manifeste.patchedDependencies);
  if (patches && Object.keys(patches).length > 0) return non('patches');
  const scripts = objet(manifeste.scripts) ?? {};
  const script = SCRIPTS_RACINE.find((s) => Object.hasOwn(scripts, s));
  if (script !== undefined) return non('script_racine', script);
  if (base['binding.gyp'] !== null) return non('binding_gyp');
  if (base['.npm-extension.mjs'] !== null || base['.npm-extension.cjs'] !== null) {
    return non('extension_npm');
  }
  const reglage = base['.npmrc'] === null ? null : reglageNonSur(base['.npmrc']);
  if (reglage !== null) return non('reglage_npmrc', reglage);
  const texte = base['package-lock.json'] ?? base['npm-shrinkwrap.json'];
  const lockfile = texte === null ? null : lireJson(texte);
  if (!lockfile) return non('lockfile_illisible');
  const version = lockfile.lockfileVersion;
  if (typeof version !== 'number' || version < 2) return non('lockfile_ancien');
  const paquets = objet(lockfile.packages);
  if (!paquets) return non('lockfile_illisible');
  const horsRegistre = paquetHorsRegistre(paquets);
  if (horsRegistre !== null) return non('paquet_hors_registre', horsRegistre);
  return { eligible: true };
}

/** Ce que le bac apporte au résultat d'une installation (voir l'en-tête). */
export interface EmpreinteBac {
  /** Le moteur (`podman`, `docker`, `bubblewrap`). */
  fournisseur: string;
  image: string;
  /** Ce que la sonde a lu de Node DANS le bac — et la configuration globale de npm. */
  node: string;
  /** `npm --version`, dans le bac. */
  npm: string;
}

/**
 * La clé d'une entrée : 32 caractères hexadécimaux (128 bits de SHA-256). Un
 * tableau JSON, pas une concaténation : deux champs ne peuvent pas se
 * déplacer l'un dans l'autre.
 */
export function cleDuMagasin(p: {
  projet: string;
  reseau: string;
  argv: readonly string[];
  bac: EmpreinteBac;
  entrees: EntreesNpm;
}): string {
  const champs = [
    VERSION_MAGASIN,
    p.projet,
    p.reseau,
    p.argv,
    p.bac.fournisseur,
    p.bac.image,
    p.bac.node,
    p.bac.npm,
    FICHIERS_ENTREE.map((f) => [f, p.entrees[f]]),
  ];
  return createHash('sha256').update(JSON.stringify(champs)).digest('hex').slice(0, 32);
}
