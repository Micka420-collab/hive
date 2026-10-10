// La porte de sécurité, volet dépendances — ce qu'elle lit, et ce qui en part
// à osv.dev. Module PUR : aucune I/O ; le nœud (`node-client/porte-securite.ts`)
// lance les outils et écrit le miroir avec ces fonctions.
//
// ─── CE QUI PARTAIT ──────────────────────────────────────────────────────────
//
// osv-scanner lisait chaque lockfile touché, base ET tête, et envoyait à
// osv.dev TOUS leurs paquets — mesuré par interception : le nom d'un paquet
// d'un registre PRIVÉ (`@acme-internal/secret-project`), le commit d'une
// dépendance git privée, le nom d'une dépendance locale `file:`, et les
// centaines de paquets que la production n'avait pas touchés.
//
// ─── DEUX PASSES, ET RIEN NE PART QUE HIVE N'AIT ÉCRIT ───────────────────────
//
//   1. EXTRACTION, hors ligne (`--experimental-disable-plugins vulnmatch/osvdev` :
//      aucune connexion, mesuré) : osv-scanner lit chaque lockfile, un par un,
//      et rend ses paquets. Un lockfile qu'il ne sait pas lire le dit (sortie
//      127, « could not extract ») — sans aveugler les autres.
//   2. INTERROGATION : Hive écrit un SBOM CycloneDX (`sbomDe`) des SEULS
//      paquets à interroger, et c'est lui qu'osv-scanner lit. Mesuré par
//      interception : il n'interroge que les composants du SBOM.
//
// Entre les deux, Hive choisit (`aInterroger`) : les paquets que la tête
// INTRODUIT (absents de la base à cette version), et seulement ceux que le
// lockfile résout depuis un registre PUBLIC connu (`paquetsPublics`) ; plus,
// pour comparer, les versions de la base de ces mêmes paquets. Le reste ne
// part pas — et n'est jamais vert : le verdict compte les paquets introduits
// qui n'ont pas pu être interrogés (`nonInterroges`).
//
// ─── « PUBLIC », FORMAT PAR FORMAT — ET CE QU'ON NE SAIT PAS VOIR ────────────
//
// Refusé par défaut : un paquet n'est interrogé que si son lockfile en DIT la
// source publique.
//   · npm (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock` v1) : un
//     `resolved` sur registry.npmjs.org ou registry.yarnpkg.com. `file:`,
//     `link:`, git, tarballs et registres privés n'en ont pas.
//     `pnpm-lock.yaml`, `bun.lock` et `yarn.lock` (berry) ne nomment pas le
//     registre de chaque paquet : rien n'en part.
//   · PyPI : l'index pypi.org (`uv.lock`, `Pipfile.lock`, `pylock.toml`), ou
//     l'absence de source (`poetry.lock`, `pdm.lock`) ; `requirements*.txt`,
//     ses seules versions épinglées `==` et sans index déclaré dans le
//     fichier — `flask>=0.1` y était lu « flask 0.1 ».
//   · crates.io, RubyGems, Packagist, Pub, Hex, CRAN : le registre public que
//     le lockfile nomme.
//   · LIMITE, dite : `go.mod`, NuGet (`packages.lock.json`, `packages.config`,
//     `*.csproj`…), Maven (`gradle.lockfile`, `pom.xml`) et Conan ne nomment
//     pas le registre. Leurs sources locales (remplacement par un chemin,
//     référence de projet, portée `system`) sont écartées ; un paquet d'un
//     registre privé y est indiscernable d'un public, et son nom part.
//   · Les sources git ne partent jamais (SwiftPM n'a qu'elles), ni Hackage,
//     qu'osv-scanner ne sait pas interroger depuis un SBOM.

/** Un paquet tel qu'osv-scanner l'extrait (passe 1, `--all-packages`). */
export interface PaquetExtrait {
  nom: string;
  version: string;
  ecosysteme: string;
}

// ─── Les fichiers lus ────────────────────────────────────────────────────────

/**
 * Les fichiers de dépendances qu'osv-scanner 2.6.0 lit À LEUR NOM — éprouvés un
 * par un, le 4 octobre : un nom hors de cette liste lui fait dire « could not
 * determine extractor ». La porte ne les examine pas tous de la même façon
 * (voir l'en-tête), mais elle les voit tous : un fichier lu par l'outil et
 * absent d'ici était un faux vert (`gradle.lockfile`, `uv.lock`, `pdm.lock`).
 */
const NOMS_LUS: ReadonlySet<string> = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'Pipfile.lock',
  'poetry.lock',
  'pdm.lock',
  'uv.lock',
  'go.mod',
  'Cargo.lock',
  'Gemfile.lock',
  'gems.locked',
  'composer.lock',
  'packages.lock.json',
  'packages.config',
  'Directory.Packages.props',
  'Directory.Build.props',
  'pubspec.lock',
  'mix.lock',
  'renv.lock',
  'conan.lock',
  'Package.resolved',
  'pom.xml',
  'gradle.lockfile',
  'buildscript-gradle.lockfile',
  'stack.yaml.lock',
  'cabal.project.freeze',
]);

/** Les familles que l'outil reconnaît à un motif (mesuré : `myrequirements.txt` oui, `Requirements.txt` non). */
const MOTIFS_LUS: readonly RegExp[] = [
  /requirements.*\.txt$/,
  /^pylock\.(?:[^.]+\.)?toml$/,
  /^.+\.deps\.json$/,
  /^.+\.(?:cs|vb|fs)proj$/,
];

/** Le dernier segment d'un chemin de dépôt (toujours en `/`). */
export function nomDeFichier(chemin: string): string {
  return chemin.slice(chemin.lastIndexOf('/') + 1);
}

/** Un fichier qu'osv-scanner 2.6.0 lit — donc que la porte examine quand la production le touche. */
export function estFichierDeDependances(chemin: string): boolean {
  const nom = nomDeFichier(chemin);
  return NOMS_LUS.has(nom) || MOTIFS_LUS.some((m) => m.test(nom));
}

// ─── La passe 1 : ce qu'osv-scanner a extrait ────────────────────────────────

/**
 * Le rapport d'extraction (`--format json --all-packages`, sans interrogation)
 * — `null` s'il n'en est pas un. Un lockfile sans paquet rend `results: []`.
 */
export function lireExtraction(texte: string): PaquetExtrait[] | null {
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  const resultats = (brut as Record<string, unknown> | null)?.results;
  if (!Array.isArray(resultats)) return null;
  const paquets: PaquetExtrait[] = [];
  for (const r of resultats as unknown[]) {
    const liste = (r as Record<string, unknown> | null)?.packages;
    if (!Array.isArray(liste)) return null;
    for (const p of liste as unknown[]) {
      const ident = (p as Record<string, unknown> | null)?.package as
        Record<string, unknown> | undefined;
      const { name, version, ecosystem } = ident ?? {};
      if (typeof name !== 'string' || typeof version !== 'string') return null;
      if (typeof ecosystem !== 'string') return null;
      paquets.push({ nom: name, version, ecosysteme: ecosystem });
    }
  }
  return paquets;
}

/** Ce qu'un lockfile mal formé fait dire à l'outil (mesuré sur JSON, TOML et YAML). */
export const LOCKFILE_MAL_FORME = /could not extract|extraction failed on specified lockfile/;

// ─── Les clés : un paquet, quel que soit le format qui le nomme ──────────────

/**
 * La clé d'un paquet : son écosystème, son nom et sa version, NORMALISÉS
 * comme l'extraction les rend — noms PyPI selon la PEP 503, NuGet sans
 * casse, versions Go et Packagist sans leur `v`.
 */
export function clePaquet(ecosysteme: string, nom: string, version: string): string {
  let n = nom;
  let v = version;
  if (ecosysteme === 'PyPI') n = nom.toLowerCase().replace(/[-_.]+/g, '-');
  if (ecosysteme === 'NuGet') n = nom.toLowerCase();
  if (ecosysteme === 'Go' || ecosysteme === 'Packagist') v = version.replace(/^v(?=\d)/, '');
  return `${ecosysteme}\u0000${n}\u0000${v}`;
}

const cleDe = (p: PaquetExtrait): string => clePaquet(p.ecosysteme, p.nom, p.version);
const nomDe = (p: PaquetExtrait): string => cleDe(p).split('\u0000').slice(0, 2).join('\u0000');

// ─── Les lecteurs : ce que le lockfile dit PUBLIC ────────────────────────────

const REGISTRE_NPM = /^https?:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)\//;
const INDEX_PYPI = /^https?:\/\/(?:pypi\.org|pypi\.python\.org)\/simple\/?$/;
const SOURCES_CRATES = new Set([
  'registry+https://github.com/rust-lang/crates.io-index',
  'sparse+https://index.crates.io/',
]);
const REMOTE_RUBYGEMS = /^https?:\/\/rubygems\.org\/?$/;
const HOTES_PUB = /^https:\/\/(?:pub\.dev|pub\.dartlang\.org)\/?$/;
/** Une version exacte — ni plage, ni joker, ni propriété à résoudre. */
const VERSION_EXACTE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

const objet = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function json(contenu: string): Record<string, unknown> | null {
  try {
    return objet(JSON.parse(contenu));
  } catch {
    return null;
  }
}

/** Les blocs `[[table]]` d'un fichier TOML de verrou, ligne par ligne, sous-tables comprises. */
function blocsToml(contenu: string, table: string): string[][] {
  const blocs: string[][] = [];
  let courant: string[] | null = null;
  for (const ligne of contenu.split(/\r?\n/)) {
    const entete = /^\s*\[\[?\s*([^\]\s]+)\s*\]\]?\s*$/.exec(ligne)?.[1];
    if (entete !== undefined) {
      if (entete === table && /^\s*\[\[/.test(ligne)) {
        courant = [];
        blocs.push(courant);
        continue;
      }
      // Une sous-table du bloc (`[package.source]`) en fait partie ; une autre
      // table (`[metadata]`) le ferme.
      if (!entete.startsWith(`${table}.`)) courant = null;
    }
    courant?.push(ligne);
  }
  return blocs;
}

/** La valeur d'une clé `cle = "valeur"` d'un bloc TOML, au niveau du bloc. */
function chaineToml(bloc: readonly string[], cle: string): string | null {
  for (const ligne of bloc) {
    if (/^\s*\[/.test(ligne)) return null;
    const m = new RegExp(`^\\s*${cle.replace(/[-.]/g, '\\$&')}\\s*=\\s*"([^"]*)"`).exec(ligne);
    if (m) return m[1] ?? null;
  }
  return null;
}

/** Le bloc porte-t-il une de ces clés, à son niveau ? */
function aUneCle(bloc: readonly string[], cles: readonly string[]): boolean {
  for (const ligne of bloc) {
    if (/^\s*\[/.test(ligne)) return false;
    const cle = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(ligne)?.[1];
    if (cle !== undefined && cles.includes(cle)) return true;
  }
  return false;
}

/** `package-lock.json`, `npm-shrinkwrap.json` : v1 (arbre `dependencies`) et v2/v3 (`packages`). */
function publicsNpmJson(contenu: string, cles: Set<string>): void {
  const racine = json(contenu);
  if (!racine) return;
  for (const [chemin, brut] of Object.entries(objet(racine.packages) ?? {})) {
    const p = objet(brut);
    if (!p || chemin === '' || p.link === true) continue;
    const nom =
      typeof p.name === 'string'
        ? p.name
        : chemin.slice(chemin.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (typeof p.version === 'string' && typeof p.resolved === 'string') {
      if (REGISTRE_NPM.test(p.resolved)) cles.add(clePaquet('npm', nom, p.version));
    }
  }
  const parcourir = (dependances: unknown): void => {
    for (const [nom, brut] of Object.entries(objet(dependances) ?? {})) {
      const d = objet(brut);
      if (!d) continue;
      if (typeof d.version === 'string' && typeof d.resolved === 'string') {
        if (REGISTRE_NPM.test(d.resolved)) cles.add(clePaquet('npm', nom, d.version));
      }
      parcourir(d.dependencies);
    }
  };
  parcourir(racine.dependencies);
}

/** `yarn.lock` v1 ; berry (`__metadata:`) ne nomme pas son registre — rien. */
function publicsYarn(contenu: string, cles: Set<string>): void {
  if (/^__metadata:/m.test(contenu)) return;
  for (const bloc of contenu.split(/\r?\n(?=\S)/)) {
    const [entete = '', ...corps] = bloc.split(/\r?\n/);
    if (entete.startsWith('#') || !entete.endsWith(':')) continue;
    // `"@scope/nom@^1.0.0", nom@1.0.0:` : le nom est avant le DERNIER `@` de la première spécification.
    const spec = entete.slice(0, -1).split(',')[0]?.trim().replace(/^"|"$/g, '') ?? '';
    const nom = spec.slice(0, spec.lastIndexOf('@'));
    const champ = (cle: string): string | undefined =>
      corps
        .map((l) => new RegExp(`^\\s+${cle}:?\\s+"?([^"\\s]+)"?\\s*$`).exec(l)?.[1])
        .find((v) => v !== undefined);
    const version = champ('version');
    const resolu = champ('resolved');
    if (nom && version && resolu && REGISTRE_NPM.test(resolu)) {
      cles.add(clePaquet('npm', nom, version));
    }
  }
}

/** `requirements*.txt` : les seules versions épinglées `==`, et aucun index déclaré ailleurs que PyPI. */
function publicsRequirements(contenu: string, cles: Set<string>): void {
  const lignes = contenu
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*$/, '').trim());
  for (const ligne of lignes) {
    const option = /^(?:-i|--index-url|--extra-index-url|-f|--find-links)(?:\s+|=)(\S+)/.exec(
      ligne,
    );
    // Un autre index que PyPI : n'importe quel paquet peut en venir.
    if (option && !INDEX_PYPI.test(option[1] ?? '')) return;
  }
  for (const ligne of lignes) {
    const m =
      /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*==\s*([0-9A-Za-z][0-9A-Za-z.+!_-]*)\s*(?:;[^#]*)?(?:\s+--hash[=\s]\S+)*$/.exec(
        ligne,
      );
    if (m?.[1] && m[2]) cles.add(clePaquet('PyPI', m[1], m[2]));
  }
}

/** `Pipfile.lock` : l'index nommé par chaque paquet, relu dans `_meta.sources`. */
function publicsPipfile(contenu: string, cles: Set<string>): void {
  const racine = json(contenu);
  if (!racine) return;
  const sources = objet(racine._meta)?.sources;
  const publics = new Set<string>();
  let toutPublic = Array.isArray(sources) && sources.length > 0;
  for (const s of Array.isArray(sources) ? (sources as unknown[]) : []) {
    const source = objet(s);
    if (
      typeof source?.name === 'string' &&
      typeof source.url === 'string' &&
      INDEX_PYPI.test(source.url)
    ) {
      publics.add(source.name);
    } else toutPublic = false;
  }
  for (const section of ['default', 'develop']) {
    for (const [nom, brut] of Object.entries(objet(racine[section]) ?? {})) {
      const d = objet(brut);
      const version =
        typeof d?.version === 'string' ? /^==([^=,;\s]+)$/.exec(d.version)?.[1] : undefined;
      if (!d || !version) continue;
      if (['git', 'path', 'file', 'editable', 'ref'].some((k) => k in d)) continue;
      const index = d.index;
      if (typeof index === 'string' ? publics.has(index) : toutPublic) {
        cles.add(clePaquet('PyPI', nom, version));
      }
    }
  }
}

/** `poetry.lock` : un paquet sans `[package.source]` vient de PyPI. */
function publicsPoetry(contenu: string, cles: Set<string>): void {
  for (const bloc of blocsToml(contenu, 'package')) {
    const nom = chaineToml(bloc, 'name');
    const version = chaineToml(bloc, 'version');
    const debutSource = bloc.findIndex((l) => /^\s*\[\s*package\.source\s*\]\s*$/.test(l));
    if (!nom || !version) continue;
    if (debutSource >= 0) {
      const url = chaineToml(bloc.slice(debutSource + 1), 'url');
      if (!url || !INDEX_PYPI.test(url)) continue;
    }
    cles.add(clePaquet('PyPI', nom, version));
  }
}

/** `uv.lock` : `source = { registry = "https://pypi.org/simple" }`. */
function publicsUv(contenu: string, cles: Set<string>): void {
  for (const bloc of blocsToml(contenu, 'package')) {
    const nom = chaineToml(bloc, 'name');
    const version = chaineToml(bloc, 'version');
    const source = bloc.find((l) => /^\s*source\s*=/.test(l));
    const registre =
      source && /^\s*source\s*=\s*\{\s*registry\s*=\s*"([^"]+)"\s*\}\s*$/.exec(source)?.[1];
    if (nom && version && registre && INDEX_PYPI.test(registre)) {
      cles.add(clePaquet('PyPI', nom, version));
    }
  }
}

/** `pdm.lock` : ni git, ni chemin, ni URL — un paquet d'index (PyPI, ou l'index du projet : limite dite). */
function publicsPdm(contenu: string, cles: Set<string>): void {
  for (const bloc of blocsToml(contenu, 'package')) {
    const nom = chaineToml(bloc, 'name');
    const version = chaineToml(bloc, 'version');
    if (!nom || !version) continue;
    if (aUneCle(bloc, ['git', 'path', 'url', 'editable', 'revision', 'ref'])) continue;
    // Des fichiers servis ailleurs que par PyPI : un index privé.
    const urls = bloc.join('\n').match(/url\s*=\s*"([^"]+)"/g) ?? [];
    if (urls.some((u) => !/"https:\/\/files\.pythonhosted\.org\//.test(u))) continue;
    cles.add(clePaquet('PyPI', nom, version));
  }
}

/** `pylock.toml` (PEP 751) : `index = "https://pypi.org/simple"`. */
function publicsPylock(contenu: string, cles: Set<string>): void {
  for (const bloc of blocsToml(contenu, 'packages')) {
    const nom = chaineToml(bloc, 'name');
    const version = chaineToml(bloc, 'version');
    const index = chaineToml(bloc, 'index');
    if (nom && version && index && INDEX_PYPI.test(index)) {
      cles.add(clePaquet('PyPI', nom, version));
    }
  }
}

/** `Cargo.lock` : la source crates.io. */
function publicsCargo(contenu: string, cles: Set<string>): void {
  for (const bloc of blocsToml(contenu, 'package')) {
    const nom = chaineToml(bloc, 'name');
    const version = chaineToml(bloc, 'version');
    const source = chaineToml(bloc, 'source');
    if (nom && version && source && SOURCES_CRATES.has(source)) {
      cles.add(clePaquet('crates.io', nom, version));
    }
  }
}

/** `Gemfile.lock`, `gems.locked` : les `specs` d'une section `GEM` dont le `remote` est rubygems.org. */
function publicsGems(contenu: string, cles: Set<string>): void {
  for (const section of contenu.split(/\r?\n(?=\S)/)) {
    const [titre = '', ...lignes] = section.split(/\r?\n/);
    if (titre.trim() !== 'GEM') continue;
    const remotes = lignes.flatMap((l) => /^ {2}remote:\s*(\S+)\s*$/.exec(l)?.[1] ?? []);
    if (remotes.length === 0 || !remotes.every((r) => REMOTE_RUBYGEMS.test(r))) continue;
    for (const ligne of lignes) {
      const m = /^ {4}([A-Za-z0-9._-]+) \(([^)\s]+)\)\s*$/.exec(ligne);
      if (!m?.[1] || !m[2]) continue;
      cles.add(clePaquet('RubyGems', m[1], m[2]));
      // `nokogiri (1.16.0-x86_64-linux)` : la version sans sa plateforme aussi.
      cles.add(clePaquet('RubyGems', m[1], m[2].replace(/-[a-z].*$/, '')));
    }
  }
}

/** `composer.lock` : servi par packagist.org (`notification-url`). */
function publicsComposer(contenu: string, cles: Set<string>): void {
  const racine = json(contenu);
  for (const section of ['packages', 'packages-dev']) {
    const liste = racine?.[section];
    for (const brut of Array.isArray(liste) ? (liste as unknown[]) : []) {
      const p = objet(brut);
      const notification = p?.['notification-url'];
      if (typeof p?.name !== 'string' || typeof p.version !== 'string') continue;
      if (typeof notification === 'string' && notification.startsWith('https://packagist.org/')) {
        cles.add(clePaquet('Packagist', p.name, p.version));
      }
    }
  }
}

/** `go.mod` : chaque `require`, sauf un module remplacé par un CHEMIN (`replace x => ../x`). */
function publicsGoMod(contenu: string, cles: Set<string>): void {
  const sansCommentaires = contenu.replace(/\/\/.*$/gm, '');
  const directives = (mot: string): string[] => {
    const lignes: string[] = [];
    const bloc = new RegExp(`^${mot}\\s*\\(([\\s\\S]*?)^\\)`, 'gm');
    for (const m of sansCommentaires.matchAll(bloc)) lignes.push(...(m[1] ?? '').split(/\r?\n/));
    for (const m of sansCommentaires.matchAll(new RegExp(`^${mot}\\s+([^(\\s].*)$`, 'gm'))) {
      lignes.push(m[1] ?? '');
    }
    return lignes.map((l) => l.trim()).filter(Boolean);
  };
  const remplaces = new Set<string>();
  for (const r of directives('replace')) {
    const [gauche = '', droite = ''] = r.split('=>').map((x) => x.trim());
    const [module = ''] = gauche.split(/\s+/);
    remplaces.add(module);
    const [cible = '', version] = droite.split(/\s+/);
    // Remplacé par un autre MODULE, versionné : c'est lui qui sera téléchargé.
    if (version && !/^(?:\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])/.test(cible)) {
      cles.add(clePaquet('Go', cible, version));
    }
  }
  for (const r of directives('require')) {
    const [module = '', version = ''] = r.split(/\s+/);
    if (module && version && !remplaces.has(module)) cles.add(clePaquet('Go', module, version));
  }
}

/** `packages.lock.json` (NuGet) : tout ce qui n'est pas une référence de PROJET. */
function publicsNugetLock(contenu: string, cles: Set<string>): void {
  for (const cible of Object.values(objet(json(contenu)?.dependencies) ?? {})) {
    for (const [nom, brut] of Object.entries(objet(cible) ?? {})) {
      const d = objet(brut);
      if (d && d.type !== 'Project' && typeof d.resolved === 'string') {
        cles.add(clePaquet('NuGet', nom, d.resolved));
      }
    }
  }
}

/** Les attributs d'une balise XML (`Include="x" Version="1.0"`), sans casse. */
function attributs(balise: string): Map<string, string> {
  const a = new Map<string, string>();
  for (const m of balise.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    a.set((m[1] ?? '').toLowerCase(), m[2] ?? '');
  }
  return a;
}

/** `packages.config`, `*.csproj`/`*.vbproj`/`*.fsproj`, `Directory.*.props` : les versions EXACTES. */
function publicsNugetXml(contenu: string, cles: Set<string>): void {
  const xml = contenu.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of xml.matchAll(/<(package|PackageReference|PackageVersion)\b([^>]*?)(\/?)>/g)) {
    const a = attributs(m[2] ?? '');
    const nom = a.get('id') ?? a.get('include');
    let version = a.get('version');
    // `<PackageReference Include="x"><Version>1.0</Version></PackageReference>`
    if (version === undefined && m[3] !== '/') {
      const suite = xml.slice((m.index ?? 0) + m[0].length);
      version = /^\s*<Version>([^<]*)<\/Version>/.exec(suite)?.[1];
    }
    if (nom && version && VERSION_EXACTE.test(version)) cles.add(clePaquet('NuGet', nom, version));
  }
}

/** `*.deps.json` (.NET) : les bibliothèques de type `package` — pas les projets. */
function publicsDepsJson(contenu: string, cles: Set<string>): void {
  for (const [cle, brut] of Object.entries(objet(json(contenu)?.libraries) ?? {})) {
    const [nom, version] = cle.split('/');
    if (objet(brut)?.type === 'package' && nom && version)
      cles.add(clePaquet('NuGet', nom, version));
  }
}

/** `pubspec.lock` : `source: hosted` sur pub.dev. */
function publicsPubspec(contenu: string, cles: Set<string>): void {
  const debut = contenu.search(/^packages:\s*$/m);
  if (debut < 0) return;
  for (const bloc of contenu
    .slice(debut)
    .split(/\r?\n(?= {2}\S)/)
    .slice(1)) {
    const nom = /^ {2}([^\s:]+):\s*$/m.exec(bloc)?.[1];
    const version = /^ {4}version:\s*"?([^"\s]+)"?\s*$/m.exec(bloc)?.[1];
    const source = /^ {4}source:\s*(\S+)\s*$/m.exec(bloc)?.[1];
    const url = /^ {6}url:\s*"?([^"\s]+)"?\s*$/m.exec(bloc)?.[1];
    if (nom && version && source === 'hosted' && url && HOTES_PUB.test(url)) {
      cles.add(clePaquet('Pub', nom, version));
    }
  }
}

/** `gradle.lockfile` : `groupe:artefact:version=configurations` (registre non nommé : limite dite). */
function publicsGradle(contenu: string, cles: Set<string>): void {
  for (const m of contenu.matchAll(/^([^#\s:=]+):([^\s:=]+):([^\s:=]+)=/gm)) {
    if (m[1] && m[2] && m[3]) cles.add(clePaquet('Maven', `${m[1]}:${m[2]}`, m[3]));
  }
}

/** `pom.xml` : les dépendances à version littérale exacte, hors portée `system` (un jar local). */
function publicsPom(contenu: string, cles: Set<string>): void {
  const xml = contenu.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const champ = (nom: string): string | undefined =>
      new RegExp(`<${nom}>\\s*([^<]*?)\\s*</${nom}>`).exec(m[1] ?? '')?.[1];
    const groupe = champ('groupId');
    const artefact = champ('artifactId');
    const version = champ('version');
    if (champ('scope') === 'system' || !groupe || !artefact || !version) continue;
    if (VERSION_EXACTE.test(version))
      cles.add(clePaquet('Maven', `${groupe}:${artefact}`, version));
  }
}

/**
 * `mix.lock` : une entrée par ligne, `{:hex, :nom, "version", …, "hexpm", "<somme>"}` —
 * l'avant-dernier champ nomme le dépôt ; `hexpm` est le public.
 */
function publicsMix(contenu: string, cles: Set<string>): void {
  for (const ligne of contenu.split(/\r?\n/)) {
    const m =
      /^\s*"[^"]+":\s*\{:hex,\s*:"?([\w-]+)"?,\s*"([^"]+)",.*,\s*"([^"]+)",\s*"[0-9a-f]*"\},?\s*$/.exec(
        ligne,
      );
    if (m?.[1] && m[2] && m[3] === 'hexpm') cles.add(clePaquet('Hex', m[1], m[2]));
  }
}

/** `renv.lock` : le dépôt CRAN. */
function publicsRenv(contenu: string, cles: Set<string>): void {
  for (const brut of Object.values(objet(json(contenu)?.Packages) ?? {})) {
    const p = objet(brut);
    if (p?.Source === 'Repository' && p.Repository === 'CRAN') {
      if (typeof p.Package === 'string' && typeof p.Version === 'string') {
        cles.add(clePaquet('CRAN', p.Package, p.Version));
      }
    }
  }
}

/** `conan.lock` : une référence sans `@user/channel` (ConanCenter ; un remote privé : limite dite). */
function publicsConan(contenu: string, cles: Set<string>): void {
  const requires = json(contenu)?.requires;
  for (const r of Array.isArray(requires) ? (requires as unknown[]) : []) {
    const m = typeof r === 'string' ? /^([^/@#\s]+)\/([^/@#\s]+)(?:#|$)/.exec(r) : null;
    if (m?.[1] && m[2]) cles.add(clePaquet('ConanCenter', m[1], m[2]));
  }
}

const LECTEURS: readonly [RegExp, (contenu: string, cles: Set<string>) => void][] = [
  [/^(?:package-lock|npm-shrinkwrap)\.json$/, publicsNpmJson],
  [/^yarn\.lock$/, publicsYarn],
  [/requirements.*\.txt$/, publicsRequirements],
  [/^Pipfile\.lock$/, publicsPipfile],
  [/^poetry\.lock$/, publicsPoetry],
  [/^uv\.lock$/, publicsUv],
  [/^pdm\.lock$/, publicsPdm],
  [/^pylock\.(?:[^.]+\.)?toml$/, publicsPylock],
  [/^Cargo\.lock$/, publicsCargo],
  [/^(?:Gemfile\.lock|gems\.locked)$/, publicsGems],
  [/^composer\.lock$/, publicsComposer],
  [/^go\.mod$/, publicsGoMod],
  [/^packages\.lock\.json$/, publicsNugetLock],
  [
    /^(?:packages\.config|Directory\.(?:Packages|Build)\.props|.+\.(?:cs|vb|fs)proj)$/,
    publicsNugetXml,
  ],
  [/^.+\.deps\.json$/, publicsDepsJson],
  [/^pubspec\.lock$/, publicsPubspec],
  [/^(?:buildscript-)?gradle\.lockfile$/, publicsGradle],
  [/^pom\.xml$/, publicsPom],
  [/^mix\.lock$/, publicsMix],
  [/^renv\.lock$/, publicsRenv],
  [/^conan\.lock$/, publicsConan],
  // `pnpm-lock.yaml`, `bun.lock`, `Package.resolved`, `stack.yaml.lock`,
  // `cabal.project.freeze` : aucun — voir l'en-tête.
];

/**
 * Les paquets que ce lockfile résout depuis un registre PUBLIC connu, en clés
 * (`clePaquet`). Refusé par défaut : un format inconnu, une ligne qui ne se
 * lit pas, une source que le fichier ne nomme pas — rien.
 */
export function paquetsPublics(chemin: string, contenu: string): Set<string> {
  const nom = nomDeFichier(chemin);
  const cles = new Set<string>();
  for (const [motif, lire] of LECTEURS) if (motif.test(nom)) lire(contenu, cles);
  return cles;
}

// ─── Ce qui part ─────────────────────────────────────────────────────────────

/**
 * Ce qu'une paire base/tête envoie à osv.dev : les paquets que la tête
 * INTRODUIT (absents de la base à cette version) et dont la source est
 * publique, plus les versions de la base de ces mêmes paquets — de quoi dire
 * qu'une vulnérabilité était déjà là. Un paquet à la même version des deux
 * côtés n'introduit rien : il ne part pas.
 *
 * `nonInterroges` : les paquets introduits qui ne partent pas, comptés par NOM
 * (une dépendance `file:` apparaît deux fois dans un package-lock) — jamais
 * comptés verts.
 */
export function aInterroger(
  base: readonly PaquetExtrait[],
  tete: readonly PaquetExtrait[],
  publicsBase: ReadonlySet<string>,
  publicsTete: ReadonlySet<string>,
): { base: PaquetExtrait[]; tete: PaquetExtrait[]; nonInterroges: number } {
  const dejaLa = new Set(base.map(cleDe));
  const introduits = new Map<string, PaquetExtrait>();
  for (const p of tete) if (!dejaLa.has(cleDe(p))) introduits.set(cleDe(p), p);
  const versLaTete = [...introduits.values()].filter(
    (p) => p.version !== '' && p.ecosysteme in PURL && publicsTete.has(cleDe(p)),
  );
  const noms = new Set(versLaTete.map(nomDe));
  const versLaBase = new Map<string, PaquetExtrait>();
  for (const p of base) {
    if (noms.has(nomDe(p)) && p.version !== '' && publicsBase.has(cleDe(p))) {
      versLaBase.set(cleDe(p), p);
    }
  }
  const interroges = new Set(versLaTete.map(cleDe));
  const exclus = new Set(
    [...introduits.values()].filter((p) => !interroges.has(cleDe(p))).map(nomDe),
  );
  return { base: [...versLaBase.values()], tete: versLaTete, nonInterroges: exclus.size };
}

/**
 * Le type PURL de chaque écosystème qu'osv-scanner sait interroger depuis un
 * SBOM — mesuré par interception, écosystème par écosystème. Hackage n'y est
 * pas : osv-scanner ne l'interroge pas depuis un SBOM.
 */
const PURL: Readonly<Record<string, string>> = {
  npm: 'npm',
  PyPI: 'pypi',
  'crates.io': 'cargo',
  RubyGems: 'gem',
  Packagist: 'composer',
  Go: 'golang',
  NuGet: 'nuget',
  Pub: 'pub',
  Maven: 'maven',
  Hex: 'hex',
  CRAN: 'cran',
  ConanCenter: 'conan',
};

/** L'URL de paquet (purl) d'un paquet extrait, ou `null` s'il n'en a pas. */
export function purlDe(p: PaquetExtrait): string | null {
  const type = PURL[p.ecosysteme];
  if (!type || p.nom === '' || p.version === '') return null;
  const code = (s: string): string => encodeURIComponent(s);
  let espace = '';
  let nom = p.nom;
  if (p.ecosysteme === 'Maven') {
    const i = p.nom.indexOf(':');
    if (i <= 0) return null;
    espace = p.nom.slice(0, i);
    nom = p.nom.slice(i + 1);
  } else if (['npm', 'Packagist', 'Go'].includes(p.ecosysteme) && p.nom.includes('/')) {
    espace = p.nom.slice(0, p.nom.lastIndexOf('/'));
    nom = p.nom.slice(p.nom.lastIndexOf('/') + 1);
  }
  const prefixe = espace === '' ? '' : `${espace.split('/').map(code).join('/')}/`;
  return `pkg:${type}/${prefixe}${code(nom)}@${code(p.version)}`;
}

/**
 * Le SBOM CycloneDX que lit la passe 2 : EXACTEMENT ces paquets. Le nom du
 * composant est le nom complet que l'extraction a rendu — c'est lui que le
 * rapport cite (mesuré : sans lui, `log4j-core` au lieu de
 * `org.apache.logging.log4j:log4j-core`) ; la requête, elle, vient du purl.
 */
export function sbomDe(paquets: readonly PaquetExtrait[]): string {
  const composants = paquets.flatMap((p) => {
    const purl = purlDe(p);
    return purl ? [{ type: 'library', name: p.nom, version: p.version, purl }] : [];
  });
  return `${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, components: composants }, null, 1)}\n`;
}
