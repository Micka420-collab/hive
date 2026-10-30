// LA PORTE DE SÉCURITÉ, VOLET DÉPENDANCES — le module pur : quels fichiers
// elle examine, ce qu'elle tient pour PUBLIC, et ce qui part à osv.dev.
//
// Les fixtures (`fixtures/verrous-porte.ts`) mêlent dans chaque format un
// paquet d'un registre public, un d'un registre privé, une source git et une
// source locale ; leur `extraction` est ce que le VRAI osv-scanner 2.6.0 en a
// extrait. Le critère de la revue (#553), à cette frontière : rien de privé ne
// part — ni le nom d'un paquet d'un registre privé que le lockfile nomme, ni
// un commit, ni une dépendance locale — et ce qui ne part pas est COMPTÉ.

import { describe, expect, it } from 'vitest';
import {
  aInterroger,
  estFichierDeDependances,
  lireExtraction,
  paquetsPublics,
  purlDe,
  sbomDe,
  type PaquetExtrait,
} from '../src/shared/porte-securite-dependances.js';
import { VERROUS } from './fixtures/verrous-porte.js';

const extraits = (cle: string): PaquetExtrait[] =>
  (VERROUS[cle]?.extraction ?? []).map(([ecosysteme, nom, version]) => ({
    ecosysteme,
    nom,
    version,
  }));

/** Ce que la porte enverrait d'un fichier AJOUTÉ par la production (tout y est introduit). */
function envoye(cle: string): { interroges: string[]; nonInterroges: number } {
  const v = VERROUS[cle];
  if (!v) throw new Error(`fixture inconnue : ${cle}`);
  const choix = aInterroger([], extraits(cle), new Set(), paquetsPublics(v.nom, v.contenu));
  return {
    interroges: choix.tete.map((p) => `${p.ecosysteme} ${p.nom}@${p.version}`).sort(),
    nonInterroges: choix.nonInterroges,
  };
}

describe('les fichiers examinés — ceux qu’osv-scanner 2.6.0 lit, mesurés nom par nom', () => {
  it('CHAQUE NOM QUE L’OUTIL LIT est examiné — `gradle.lockfile`, `uv.lock`, `pdm.lock` passaient pour « aucun lockfile »', () => {
    for (const nom of [
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'bun.lock',
      'requirements.txt',
      'requirements-dev.txt',
      'dev-requirements.txt',
      'myrequirements.txt',
      'Pipfile.lock',
      'poetry.lock',
      'pdm.lock',
      'uv.lock',
      'pylock.toml',
      'pylock.dev.toml',
      'go.mod',
      'Cargo.lock',
      'Gemfile.lock',
      'gems.locked',
      'composer.lock',
      'packages.lock.json',
      'packages.config',
      'app.deps.json',
      'Projet.csproj',
      'Projet.fsproj',
      'Directory.Packages.props',
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
    ]) {
      expect(estFichierDeDependances(`un/dossier/${nom}`), nom).toBe(true);
    }
  });

  it('CE QU’IL NE LIT PAS n’est pas examiné (« could not determine extractor »)', () => {
    for (const nom of [
      'package.json',
      'Requirements.txt',
      'requirements.in',
      'constraints.txt',
      'requirements.txt.bak',
      'go.sum',
      'Cargo.toml',
      'Gemfile',
      'composer.json',
      'pubspec.yaml',
      'deps.json',
      'bun.lockb',
      'deno.lock',
      'Podfile.lock',
    ]) {
      expect(estFichierDeDependances(nom), nom).toBe(false);
    }
  });
});

describe('ce qui part à osv.dev — refusé par défaut, format par format', () => {
  it.each([
    // [fixture, ce qui est interrogé, ce qui ne l'est pas (par nom)]
    ['npm-v3', ['npm minimist@1.2.0'], 3],
    ['shrinkwrap', ['npm minimist@1.2.0'], 3],
    ['npm-v1', ['npm minimist@0.0.8', 'npm minimist@1.2.0', 'npm parent@2.0.0'], 3],
    ['yarn-v1', ['npm minimist@1.2.0'], 3],
    // Ne nomment pas le registre de chaque paquet : rien ne part.
    ['yarn-berry', [], 4],
    ['pnpm', [], 4],
    ['bun', [], 3],
    ['cargo', ['crates.io smallvec@1.6.0'], 4],
    ['poetry', ['PyPI django@1.11.0'], 3],
    ['uv', ['PyPI django@1.11.0'], 4],
    ['pdm', ['PyPI django@1.11.0'], 3],
    ['pylock', ['PyPI django@1.11.0'], 3],
    ['pipenv', ['PyPI django@1.11.0'], 2],
    // `flask>=0.1` n'est pas une version (osv-scanner y lit « 0.1 ») ; un
    // `secret-lib==1.0.0` sans index déclaré est supposé venir de PyPI : limite dite.
    ['pip', ['PyPI django@1.11.0', 'PyPI requests@2.20.0', 'PyPI secret-lib@1.0.0'], 1],
    // Un index privé déclaré dans le fichier : n'importe quel paquet peut en venir.
    ['pip-index', [], 2],
    ['reqdev', ['PyPI django@1.11.0'], 0],
    ['gem', ['RubyGems rack@2.0.0'], 3],
    ['gemslocked', ['RubyGems rack@2.0.0'], 3],
    ['composer', ['Packagist guzzlehttp/guzzle@6.0.0'], 2],
    ['pub', ['Pub http@0.13.0'], 3],
    ['mix', ['Hex plug@1.0.0'], 2],
    ['renv', ['CRAN jsonlite@1.8.0'], 0],
    ['conan', ['ConanCenter zlib@1.2.11'], 1],
    // LIMITE : ces formats ne nomment pas leur registre. Les sources locales
    // sont écartées ; un paquet privé y est indiscernable — son nom part.
    ['gomod', ['Go github.com/acme-internal/secret@1.0.0', 'Go golang.org/x/text@0.3.0'], 1],
    ['nuget', ['NuGet Acme.Internal.Secret@1.0.0', 'NuGet Newtonsoft.Json@12.0.1'], 1],
    ['pkgconfig', ['NuGet Acme.Internal.Secret@1.0.0', 'NuGet Newtonsoft.Json@12.0.1'], 0],
    ['csproj', ['NuGet Acme.Internal.Secret@1.0.0', 'NuGet Newtonsoft.Json@12.0.1'], 0],
    ['depsjson', ['NuGet Newtonsoft.Json@12.0.1'], 2],
    // Un manifeste de versions centralisées sans projet : l'outil n'en extrait rien.
    ['cpm', [], 0],
    [
      'gradle',
      ['Maven com.acme.internal:secret@1.0.0', 'Maven org.apache.logging.log4j:log4j-core@2.14.1'],
      0,
    ],
    [
      'buildscript',
      ['Maven com.acme.internal:secret@1.0.0', 'Maven org.apache.logging.log4j:log4j-core@2.14.1'],
      0,
    ],
    [
      'pom',
      ['Maven com.acme.internal:secret@1.0.0', 'Maven org.apache.logging.log4j:log4j-core@2.14.1'],
      1,
    ],
    // Que des sources git (SwiftPM), ou un écosystème qu'un SBOM n'interroge pas.
    ['swift', [], 3],
    ['cabal', [], 2],
    ['stack', [], 1],
  ] as const)('%s', (cle, interroges, nonInterroges) => {
    expect(envoye(cle)).toEqual({ interroges: [...interroges].sort(), nonInterroges });
  });

  it('JAMAIS un commit, un registre privé que le lockfile nomme, une dépendance locale', () => {
    // Le critère, sur TOUTES les fixtures à source nommée : aucun nom
    // `acme-internal` (sauf les formats sans registre nommé, limite dite),
    // aucun écosystème GIT, aucune version vide.
    const sansRegistreNomme = new Set([
      'gomod',
      'nuget',
      'pkgconfig',
      'csproj',
      'gradle',
      'buildscript',
      'pom',
      'pip',
    ]);
    for (const cle of Object.keys(VERROUS)) {
      const v = VERROUS[cle]!;
      const { tete } = aInterroger([], extraits(cle), new Set(), paquetsPublics(v.nom, v.contenu));
      for (const p of tete) {
        expect(p.ecosysteme, cle).not.toBe('GIT');
        expect(p.version, cle).not.toBe('');
        expect(p.nom, cle).not.toMatch(/local/i);
        if (!sansRegistreNomme.has(cle)) expect(p.nom, cle).not.toMatch(/acme|secret/i);
      }
    }
  });

  it('SEUL CE QUE LA TÊTE INTRODUIT part — avec, pour comparer, la base de ces mêmes paquets', () => {
    const p = (nom: string, version: string): PaquetExtrait => ({
      ecosysteme: 'npm',
      nom,
      version,
    });
    const base = [p('lodash', '4.17.19'), p('minimist', '1.2.0'), p('express', '4.0.0')];
    const tete = [p('lodash', '4.17.20'), p('minimist', '1.2.0'), p('chalk', '5.0.0')];
    const publics = new Set(
      ['lodash@4.17.19', 'lodash@4.17.20', 'minimist@1.2.0', 'express@4.0.0', 'chalk@5.0.0'].map(
        (n) => `npm\u0000${n.split('@')[0]}\u0000${n.split('@')[1]}`,
      ),
    );
    const choix = aInterroger(base, tete, publics, publics);
    // minimist ne change pas : il ne part pas ; express n'est plus dans la tête.
    expect(choix.tete.map((x) => `${x.nom}@${x.version}`)).toEqual([
      'lodash@4.17.20',
      'chalk@5.0.0',
    ]);
    expect(choix.base.map((x) => `${x.nom}@${x.version}`)).toEqual(['lodash@4.17.19']);
    expect(choix.nonInterroges).toBe(0);
  });
});

describe('le SBOM que lit l’interrogation — exactement ces paquets', () => {
  it('UN PURL PAR ÉCOSYSTÈME, tel qu’osv-scanner le convertit (mesuré par interception)', () => {
    const cas: [string, string, string, string][] = [
      ['npm', '@acme/scoped', '1.0.0', 'pkg:npm/%40acme/scoped@1.0.0'],
      ['npm', 'x', '1.0.0+build.5', 'pkg:npm/x@1.0.0%2Bbuild.5'],
      ['PyPI', 'django', '1.11.0', 'pkg:pypi/django@1.11.0'],
      [
        'Maven',
        'org.apache.logging.log4j:log4j-core',
        '2.14.1',
        'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1',
      ],
      ['Go', 'golang.org/x/text', '0.3.0', 'pkg:golang/golang.org/x/text@0.3.0'],
      ['crates.io', 'smallvec', '1.6.0', 'pkg:cargo/smallvec@1.6.0'],
      ['RubyGems', 'rack', '2.0.0', 'pkg:gem/rack@2.0.0'],
      ['Packagist', 'guzzlehttp/guzzle', '6.0.0', 'pkg:composer/guzzlehttp/guzzle@6.0.0'],
      ['NuGet', 'Newtonsoft.Json', '12.0.1', 'pkg:nuget/Newtonsoft.Json@12.0.1'],
      ['Pub', 'http', '0.13.0', 'pkg:pub/http@0.13.0'],
      ['Hex', 'plug', '1.0.0', 'pkg:hex/plug@1.0.0'],
      ['CRAN', 'jsonlite', '1.8.0', 'pkg:cran/jsonlite@1.8.0'],
      ['ConanCenter', 'zlib', '1.2.11', 'pkg:conan/zlib@1.2.11'],
    ];
    for (const [ecosysteme, nom, version, purl] of cas) {
      expect(purlDe({ ecosysteme, nom, version }), nom).toBe(purl);
    }
    // Ni git, ni Hackage, ni version vide : pas de purl, donc rien ne part.
    expect(
      purlDe({ ecosysteme: 'GIT', nom: 'https://github.com/a/b', version: '1.0.0' }),
    ).toBeNull();
    expect(purlDe({ ecosysteme: 'Hackage', nom: 'aeson', version: '1.0.0.0' })).toBeNull();
    expect(purlDe({ ecosysteme: 'npm', nom: 'local-lib', version: '' })).toBeNull();
  });

  it('LE NOM DU COMPOSANT EST LE NOM COMPLET — c’est lui que le rapport cite', () => {
    const sbom = JSON.parse(
      sbomDe([
        { ecosysteme: 'Maven', nom: 'org.apache.logging.log4j:log4j-core', version: '2.14.1' },
        { ecosysteme: 'GIT', nom: 'https://github.com/a/b', version: '1.0.0' },
      ]),
    ) as { bomFormat: string; components: Record<string, string>[] };
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.components).toEqual([
      {
        type: 'library',
        name: 'org.apache.logging.log4j:log4j-core',
        version: '2.14.1',
        purl: 'pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1',
      },
    ]);
  });

  it('LE RAPPORT D’EXTRACTION se lit champ par champ ; un fichier sans paquet rend une liste vide', () => {
    const rapport = (results: unknown[]): string =>
      JSON.stringify({ results, experimental_config: { licenses: { summary: false } } });
    expect(lireExtraction(rapport([]))).toEqual([]);
    expect(
      lireExtraction(
        rapport([
          {
            source: { path: '/t/package-lock.json', type: 'lockfile' },
            packages: [{ package: { name: 'minimist', version: '1.2.0', ecosystem: 'npm' } }],
          },
        ]),
      ),
    ).toEqual([{ nom: 'minimist', version: '1.2.0', ecosysteme: 'npm' }]);
    for (const casse of ['{}', 'pas du json', rapport([{ packages: [{ package: {} }] }])]) {
      expect(lireExtraction(casse), casse.slice(0, 40)).toBeNull();
    }
  });
});
