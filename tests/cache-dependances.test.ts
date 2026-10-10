// LE MAGASIN DE DÉPENDANCES — ce qui se décide sans disque (G18).
//
// L'éligibilité est la garde qui rend le magasin sûr : une entrée ne sert
// qu'un arbre dont l'installation ne lit RIEN d'autre que ce que la clé
// couvre. Chaque porte de sortie a son cas, et chaque champ de la clé le sien :
// un champ oublié dans la clé, c'est une entrée qui sert ce qu'elle ne devrait
// pas — les dépendances d'un autre projet, d'un autre Node, d'un autre réseau.

import { describe, expect, it } from 'vitest';
import {
  FICHIERS_ENTREE,
  SCRIPTS_RACINE,
  cleDuMagasin,
  direHorsMagasin,
  eligibilite,
} from '../src/shared/cache-dependances.js';
import type { EntreesNpm, FichierEntree } from '../src/shared/cache-dependances.js';

const AUCUN = Object.fromEntries(FICHIERS_ENTREE.map((f) => [f, null])) as Record<
  FichierEntree,
  string | null
>;

const LOCKFILE = (paquets: Record<string, unknown> = {}, version = 3): string =>
  JSON.stringify({
    name: 'projet',
    version: '1.0.0',
    lockfileVersion: version,
    requires: true,
    packages: {
      '': { name: 'projet', version: '1.0.0', dependencies: { 'dep-a': '1.0.0' } },
      'node_modules/dep-a': {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/dep-a/-/dep-a-1.0.0.tgz',
        integrity: 'sha512-AAAA',
      },
      ...paquets,
    },
  });

const MANIFESTE = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: 'projet',
    version: '1.0.0',
    scripts: { test: 'node --test' },
    dependencies: { 'dep-a': '1.0.0' },
    ...extra,
  });

const base = (fichiers: Partial<Record<FichierEntree, string | null>> = {}): EntreesNpm => ({
  ...AUCUN,
  'package.json': MANIFESTE(),
  'package-lock.json': LOCKFILE(),
  ...fichiers,
});

const juger = (
  entrees: EntreesNpm,
  extra: {
    argv?: readonly string[];
    modifies?: readonly FichierEntree[];
    nodeModules?: boolean;
  } = {},
) =>
  eligibilite({
    argv: extra.argv ?? ['npm', 'ci'],
    base: entrees,
    modifies: extra.modifies ?? [],
    nodeModules: extra.nodeModules ?? false,
  });

describe('l’éligibilité au magasin', () => {
  it('un projet npm ordinaire — un lockfile, des paquets du registre — est éligible', () => {
    expect(juger(base())).toEqual({ eligible: true });
    expect(juger(base({ 'package-lock.json': null, 'npm-shrinkwrap.json': LOCKFILE() }))).toEqual({
      eligible: true,
    });
  });

  it.each([
    ['pnpm', { argv: ['pnpm', 'install', '--frozen-lockfile'] }, 'pas_npm_ci'],
    [
      'un lockfile changé par la production',
      { modifies: ['package-lock.json'] },
      'entree_modifiee',
    ],
    ['un .npmrc ajouté', { modifies: ['.npmrc'] }, 'entree_modifiee'],
    ['un node_modules resté', { nodeModules: true }, 'node_modules'],
  ] as const)('%s : hors du magasin', (_cas, extra, raison) => {
    expect(juger(base(), extra)).toMatchObject({ eligible: false, raison });
  });

  it('le fichier modifié est NOMMÉ : la ligne de progrès dit lequel', () => {
    expect(juger(base(), { modifies: ['package.json'] })).toEqual({
      eligible: false,
      raison: 'entree_modifiee',
      detail: 'package.json',
    });
  });

  it.each([
    ['deux lockfiles', { 'npm-shrinkwrap.json': LOCKFILE() }, 'deux_lockfiles'],
    ['un manifeste illisible', { 'package.json': '{ pas du json' }, 'manifeste_illisible'],
    ['des workspaces', { 'package.json': MANIFESTE({ workspaces: ['paquets/*'] }) }, 'workspaces'],
    [
      'des patches (npm 12 lit leurs fichiers dans l’arbre)',
      { 'package.json': MANIFESTE({ patchedDependencies: { 'dep-a@1.0.0': 'patches/a.patch' } }) },
      'patches',
    ],
    ['un binding.gyp (node-gyp rebuild)', { 'binding.gyp': '{}' }, 'binding_gyp'],
    ['un .npm-extension.mjs', { '.npm-extension.mjs': 'export {}' }, 'extension_npm'],
    ['un .npm-extension.cjs', { '.npm-extension.cjs': '' }, 'extension_npm'],
    ['un lockfile de version 1', { 'package-lock.json': LOCKFILE({}, 1) }, 'lockfile_ancien'],
    ['un lockfile illisible', { 'package-lock.json': 'pas du json' }, 'lockfile_illisible'],
    [
      'un lockfile sans paquets',
      { 'package-lock.json': JSON.stringify({ lockfileVersion: 3 }) },
      'lockfile_illisible',
    ],
  ] as const)('%s : hors du magasin', (_cas, fichiers, raison) => {
    expect(juger(base(fichiers))).toMatchObject({ eligible: false, raison });
  });

  it.each(SCRIPTS_RACINE)('le script racine « %s » : hors du magasin, et nommé', (script) => {
    const manifeste = MANIFESTE({ scripts: { test: 'node --test', [script]: 'node -e 0' } });
    expect(juger(base({ 'package.json': manifeste }))).toEqual({
      eligible: false,
      raison: 'script_racine',
      detail: script,
    });
  });

  it.each([
    ['file:', { resolved: 'file:../dep-b', integrity: 'sha512-BBBB' }],
    ['git', { resolved: 'git+ssh://git@github.com/x/dep-b.git#abc', integrity: 'sha512-BBBB' }],
    ['un lien', { resolved: 'https://registry.npmjs.org/b.tgz', integrity: 'x', link: true }],
    ['sans integrity', { resolved: 'https://registry.npmjs.org/dep-b/-/dep-b-1.0.0.tgz' }],
    ['sans resolved', { integrity: 'sha512-BBBB' }],
  ])('un paquet %s : hors du magasin, et nommé', (_cas, paquet) => {
    const lock = LOCKFILE({ 'node_modules/dep-b': { version: '1.0.0', ...paquet } });
    expect(juger(base({ 'package-lock.json': lock }))).toEqual({
      eligible: false,
      raison: 'paquet_hors_registre',
      detail: 'node_modules/dep-b',
    });
  });

  it.each([
    'registry=https://registry.npmjs.org/',
    '@entreprise:registry=https://npm.entreprise.example/',
    '//npm.entreprise.example/:_authToken=${NPM_TOKEN}',
    '# un commentaire\n; un autre\naudit=false\nfund=false\n',
    'allow-scripts[]=esbuild',
  ])('un .npmrc qui ne désigne aucun fichier reste éligible : %j', (npmrc) => {
    expect(juger(base({ '.npmrc': npmrc }))).toEqual({ eligible: true });
  });

  it.each([
    ['script-shell=./outils/sh', 'script-shell'],
    ['cafile=./certs/ca.pem', 'cafile'],
    ['//npm.entreprise.example/:certfile=./c.pem', '//npm.entreprise.example/:certfile'],
    ['extension-file=./ext.mjs', 'extension-file'],
    ['node-options=--require ./piege.js', 'node-options'],
    ['[section]', '[section]'],
  ])('un réglage de .npmrc qui désigne un fichier : hors du magasin (%s)', (npmrc, cle) => {
    expect(juger(base({ '.npmrc': npmrc }))).toEqual({
      eligible: false,
      raison: 'reglage_npmrc',
      detail: cle,
    });
  });

  it('une raison se dit, son détail borné', () => {
    expect(direHorsMagasin('script_racine', 'prepare')).toBe(
      'un script d’installation à la racine (prepare)',
    );
    expect(direHorsMagasin('paquet_hors_registre', 'x'.repeat(500)).length).toBeLessThan(220);
  });
});

describe('la clé du magasin', () => {
  const p = {
    projet: 'p1',
    reseau: 'dependances:filtre',
    argv: ['npm', 'ci'],
    bac: {
      fournisseur: 'podman',
      image: 'localhost/hive-agent:local',
      node: '["v24"]',
      npm: '12.2.0',
    },
    entrees: base(),
  };

  it('stable pour les mêmes entrées, 32 caractères hexadécimaux', () => {
    expect(cleDuMagasin(p)).toBe(cleDuMagasin({ ...p, entrees: { ...p.entrees } }));
    expect(cleDuMagasin(p)).toMatch(/^[0-9a-f]{32}$/);
  });

  it.each([
    ['le projet', { projet: 'p2' }],
    ['le réseau', { reseau: 'dependances:libre' }],
    ['l’argv', { argv: ['npm', 'ci', '--omit=dev'] }],
    ['le moteur', { bac: { ...p.bac, fournisseur: 'docker' } }],
    ['l’image', { bac: { ...p.bac, image: 'hive-agent:ci' } }],
    ['Node dans le bac', { bac: { ...p.bac, node: '["v26"]' } }],
    ['npm dans le bac', { bac: { ...p.bac, npm: '11.19.0' } }],
  ])('change avec %s', (_champ, change) => {
    expect(cleDuMagasin({ ...p, ...change })).not.toBe(cleDuMagasin(p));
  });

  it.each(FICHIERS_ENTREE)('change avec les octets de %s', (fichier) => {
    const autre = { ...p.entrees, [fichier]: `${p.entrees[fichier] ?? ''} ` };
    expect(cleDuMagasin({ ...p, entrees: autre })).not.toBe(cleDuMagasin(p));
  });

  it('deux champs ne se déplacent pas l’un dans l’autre', () => {
    expect(cleDuMagasin({ ...p, projet: 'p1', reseau: 'x:y' })).not.toBe(
      cleDuMagasin({ ...p, projet: 'p1x', reseau: ':y' }),
    );
  });
});
