// La liste blanche d'une tâche : l'API de la famille de l'agent, puis ce que
// le DÉPÔT déclare (lockfiles, lu à la base), puis son hôte git — selon le
// niveau du projet. Éprouvée sur de vrais fichiers dans un vrai dossier.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HOTES_API,
  HOTES_DEPOT_MAX,
  hoteGit,
  politiqueTache,
  registresDuDepot,
} from '../src/node-client/politique-reseau.js';

let depot: string;
beforeEach(() => {
  depot = mkdtempSync(path.join(os.tmpdir(), 'hive-politique-'));
});
afterEach(() => rmSync(depot, { recursive: true, force: true }));

describe('les registres que le dépôt déclare', () => {
  it('un projet sans fichier déclaratif n’ouvre AUCUN registre', () => {
    expect(registresDuDepot(depot)).toEqual([]);
  });

  it('npm : le registre par défaut, plus chaque hôte `resolved` du lockfile — jamais une IP', () => {
    writeFileSync(
      path.join(depot, 'package-lock.json'),
      JSON.stringify({
        packages: {
          'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz' },
          'node_modules/b': { resolved: 'https://npm.pkg.github.com/b/-/b-2.0.0.tgz' },
          'node_modules/c': { resolved: 'git+https://github.com/org/c.git#abc' },
          'node_modules/d': { resolved: 'http://10.0.0.5:4873/d/-/d.tgz' },
        },
      }),
    );
    expect(registresDuDepot(depot)).toEqual([
      'github.com',
      'npm.pkg.github.com',
      'registry.npmjs.org',
    ]);
  });

  it('Rust, Go, Python : les registres de chaque écosystème présent, et eux seuls', () => {
    writeFileSync(path.join(depot, 'Cargo.lock'), '# rien');
    writeFileSync(path.join(depot, 'go.sum'), '');
    writeFileSync(
      path.join(depot, 'uv.lock'),
      'source = { registry = "https://pypi.miroir.example.org/simple" }',
    );
    expect(registresDuDepot(depot)).toEqual([
      'crates.io',
      'files.pythonhosted.org',
      'index.crates.io',
      'proxy.golang.org',
      'pypi.miroir.example.org',
      'pypi.org',
      'static.crates.io',
      'sum.golang.org',
    ]);
  });

  it(`une déclaration est BORNÉE : au plus ${HOTES_DEPOT_MAX} hôtes`, () => {
    const paquets = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `node_modules/p${i}`,
        { resolved: `https://r${i}.example.org/p.tgz` },
      ]),
    );
    writeFileSync(path.join(depot, 'package-lock.json'), JSON.stringify({ packages: paquets }));
    expect(registresDuDepot(depot)).toHaveLength(HOTES_DEPOT_MAX);
  });
});

describe('l’hôte git du projet', () => {
  it.each([
    ['https://github.com/org/depot.git', 'github.com'],
    ['git@gitlab.example.org:org/depot.git', 'gitlab.example.org'],
    ['ssh://git@codeberg.org/org/depot.git', 'codeberg.org'],
    ['/home/membre/depot', null],
    ['file:///home/membre/depot', null],
    ['https://192.168.1.4/org/depot.git', null],
    [null, null],
  ])('%s → %s', (url, hote) => {
    expect(hoteGit(url)).toBe(hote);
  });
});

describe('la politique d’une tâche, selon le niveau du projet', () => {
  it('« integrations » : l’API du modèle, ni registre ni hôte git', () => {
    writeFileSync(path.join(depot, 'package.json'), '{}');
    const p = politiqueTache({
      niveau: 'integrations',
      agent: 'claude-code',
      repoUrl: 'https://github.com/org/depot.git',
      cwd: depot,
    });
    expect(p.hotes).toEqual(['api.anthropic.com']);
  });

  it('« dependances » : plus les registres déclarés et l’hôte git', () => {
    writeFileSync(path.join(depot, 'package.json'), '{}');
    const p = politiqueTache({
      niveau: 'dependances',
      agent: 'codex',
      repoUrl: 'https://github.com/org/depot.git',
      cwd: depot,
    });
    expect(p.hotes).toEqual(['api.openai.com', 'github.com', 'registry.npmjs.org']);
  });

  it('un agent sans hôte connu n’ouvre rien de lui-même', () => {
    expect(HOTES_API.custom).toEqual([]);
    expect(HOTES_API.shell).toEqual([]);
  });
});
