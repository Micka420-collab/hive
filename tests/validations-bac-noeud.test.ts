// Les validations du bac, côté nœud — de vrais dépôts git, de vrais `npm run`.
//
// Ce que ce banc tient pour acquis n'est RIEN : chaque cas construit un dépôt,
// le « produit » (modifie l'arbre comme le ferait un agent), puis lance
// `validerProduction` et regarde ce qui a réellement tourné — un fichier
// marqueur écrit par le script dit s'il a été lancé ou non.
//
// Les cas qui comptent le plus sont ceux où RIEN ne doit tourner : une
// production qui réécrit son script de test, ou `.npmrc`, ne se juge pas
// elle-même ; un bac où npm ne se lance pas ne rend pas quatre faux échecs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import { resoudreLanceur } from '../src/lanceur-reel.js';
import { validerProduction } from '../src/node-client/validations-bac.js';
import type { Fournisseur } from '../src/node-client/isolement.js';

const dossiers: string[] = [];

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

/** Une commande `node -e` qui laisse une trace, puis sort avec `code`. */
const marque = (nom: string, code = 0): string =>
  `node -e "require('node:fs').writeFileSync('${nom}.ran','');process.exit(${code})"`;

async function depot(fichiers: Record<string, string>): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-validations-'));
  dossiers.push(dir);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    mkdirSync(path.dirname(path.join(dir, nom)), { recursive: true });
    writeFileSync(path.join(dir, nom), contenu);
  }
  const git = simpleGit({ baseDir: dir });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');
  return dir;
}

const manifeste = (scripts: Record<string, string>, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, scripts, ...extra });

const valider = (dir: string, extra: Partial<Parameters<typeof validerProduction>[0]> = {}) =>
  validerProduction({ cwd: dir, git: simpleGit({ baseDir: dir }), ...extra });

describe('validerProduction — ce que la base déclare, lancé dans le répertoire produit', () => {
  it('lance les scripts déclarés et rend un constat par validation', async () => {
    const dir = await depot({
      'package.json': manifeste({
        test: marque('test'),
        lint: marque('lint', 2),
        build: marque('build'),
      }),
    });
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 1;\n');
    const sha = (await simpleGit({ baseDir: dir }).revparse(['HEAD'])).trim();
    const etapes: string[] = [];

    const rapport = await valider(dir, { surEtape: (l) => etapes.push(l) });

    expect(rapport.baseSha).toBe(sha);
    expect(rapport.controles.tests).toMatchObject({
      etat: 'passed',
      raison: 'termine',
      script: 'test',
      code: 0,
    });
    expect(rapport.controles.lint).toMatchObject({ etat: 'failed', raison: 'termine', code: 2 });
    expect(rapport.controles.lint.extrait).toContain('fixture@1.0.0 lint');
    expect(rapport.controles.build).toMatchObject({ etat: 'passed' });
    expect(rapport.controles.typecheck).toEqual({ etat: 'not_applicable', raison: 'non_declare' });
    for (const nom of ['test', 'lint', 'build'])
      expect(existsSync(path.join(dir, `${nom}.ran`))).toBe(true);
    // Le hub voit ce qui tourne : une ligne avant, une ligne après chaque commande.
    expect(etapes).toContain('validation lint : npm run lint…');
    expect(etapes.some((l) => l.startsWith('validation tests : passed'))).toBe(true);
  }, 30_000);

  it('ne lance pas un script de test que la production a réécrit', async () => {
    const dir = await depot({ 'package.json': manifeste({ test: marque('base', 1) }) });
    writeFileSync(path.join(dir, 'package.json'), manifeste({ test: marque('reecrit', 0) }));

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toEqual({
      etat: 'missing',
      raison: 'declaration_reecrite',
      script: 'test',
    });
    expect(existsSync(path.join(dir, 'reecrit.ran'))).toBe(false);
    expect(existsSync(path.join(dir, 'base.ran'))).toBe(false);
  }, 30_000);

  it('ne lance rien quand la production réécrit .npmrc', async () => {
    const dir = await depot({ 'package.json': manifeste({ test: marque('test') }) });
    writeFileSync(path.join(dir, '.npmrc'), 'script-shell=/bin/true\n');

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toEqual({
      etat: 'missing',
      raison: 'npmrc_reecrit',
      script: 'test',
    });
    expect(existsSync(path.join(dir, 'test.ran'))).toBe(false);
  }, 30_000);

  // POSIX seulement : sous Windows, `cmd.exe` rend 1 pour une commande
  // inconnue — limite consignée sur `controleApresLancement`.
  it.skipIf(process.platform === 'win32')(
    '127 : un outil introuvable n’est pas un verdict sur la production',
    async () => {
      const dir = await depot({
        'package.json': manifeste({ test: 'outil-que-personne-n-a-installe --run' }),
      });

      const rapport = await valider(dir);

      expect(rapport.controles.tests).toMatchObject({
        etat: 'missing',
        raison: 'outil_introuvable',
        code: 127,
      });
    },
    30_000,
  );

  it('délai dépassé : missing — la commande est arrêtée, son verdict reste inconnu', async () => {
    // Une attente courte : sous Windows, tuer npm ne tue pas le script qu'il a
    // lancé, et la sortie ne se ferme qu'avec lui.
    const dir = await depot({
      'package.json': manifeste({ lint: 'node -e "setTimeout(() => {}, 5000)"' }),
    });

    const rapport = await valider(dir, { delaiMs: 1_500 });

    expect(rapport.controles.lint).toMatchObject({ etat: 'missing', raison: 'delai' });
  }, 30_000);

  it('des dépendances sans lockfile : rien ne tourne, et le node_modules de l’agent n’est pas cru', async () => {
    const dir = await depot({
      'package.json': manifeste(
        { test: marque('test') },
        { devDependencies: { vitest: '^3.0.0' } },
      ),
    });
    mkdirSync(path.join(dir, 'node_modules', 'vitest'), { recursive: true });

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toEqual({
      etat: 'missing',
      raison: 'sans_lockfile',
      script: 'test',
    });
    expect(existsSync(path.join(dir, 'test.ran'))).toBe(false);
  }, 30_000);

  it('avec un lockfile, repart de lui : l’environnement laissé par l’agent est remplacé', async () => {
    // Une dépendance locale (`file:`) : `npm ci` l'installe sans réseau.
    const dir = await depot({
      'dep-locale/package.json': JSON.stringify({ name: 'dep-locale', version: '1.0.0' }),
      'dep-locale/index.js': 'module.exports = "vraie";\n',
      'package.json': manifeste(
        { test: `node -e "process.exit(require('dep-locale') === 'vraie' ? 0 : 1)"` },
        { dependencies: { 'dep-locale': 'file:./dep-locale' } },
      ),
      '.gitignore': 'node_modules\n',
    });
    // `resoudreLanceur` : sous Windows, `npm` est un script, pas un exécutable.
    const npm = resoudreLanceur('npm', ['install', '--no-audit', '--no-fund', '--offline']);
    execFileSync(npm.bin, npm.args, {
      cwd: dir,
      stdio: 'ignore',
    });
    const git = simpleGit({ baseDir: dir });
    await git.add('package-lock.json');
    await git.commit('lockfile');
    // L'agent a « trafiqué » la dépendance installée : hors du diff, invisible
    // à toute relecture. Le bac ne doit pas la croire.
    rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
    mkdirSync(path.join(dir, 'node_modules', 'dep-locale'), { recursive: true });
    writeFileSync(
      path.join(dir, 'node_modules', 'dep-locale', 'index.js'),
      'module.exports = "trafiquee";\n',
    );
    writeFileSync(
      path.join(dir, 'node_modules', 'dep-locale', 'package.json'),
      '{"name":"dep-locale"}',
    );
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 2;\n');

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toMatchObject({ etat: 'passed', code: 0 });
  }, 60_000);

  it('une préparation qui échoue laisse les validations missing, sortie à l’appui', async () => {
    const dir = await depot({
      'package.json': manifeste({ test: marque('test') }, { dependencies: { absente: '1.0.0' } }),
      'package-lock.json': '{ ceci n’est pas du json',
    });

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toMatchObject({
      etat: 'missing',
      raison: 'preparation_echouee',
      script: 'test',
    });
    expect(rapport.controles.tests.extrait).toMatch(/\[hive\] npm ci → code \d+$/);
    expect(existsSync(path.join(dir, 'test.ran'))).toBe(false);
  }, 60_000);

  it('un bac où npm ne se lance pas ne rend pas de faux échecs', async () => {
    const dir = await depot({
      'package.json': manifeste({ test: marque('test'), lint: marque('lint') }),
    });
    // Un « moteur » qui échoue toujours : l'enveloppe est bien prise, et rien
    // ne se lance à travers elle.
    const fournisseur: Fournisseur = {
      nom: 'banc',
      bin: 'false',
      niveau: 'conteneur',
      installation: '',
      garanties: [],
    };

    const rapport = await valider(dir, { bac: { fournisseur, variables: [], image: 'aucune' } });

    expect(rapport.controles.tests).toMatchObject({ etat: 'missing', raison: 'npm_indisponible' });
    expect(rapport.controles.lint).toMatchObject({ etat: 'missing', raison: 'npm_indisponible' });
    expect(rapport.controles.build).toEqual({ etat: 'not_applicable', raison: 'non_declare' });
  }, 30_000);

  it('sans dépôt, rien n’est déclaré : tout est non applicable, rien ne tourne', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-validations-sans-depot-'));
    dossiers.push(dir);
    writeFileSync(path.join(dir, 'package.json'), manifeste({ test: marque('test') }));

    const rapport = await validerProduction({ cwd: dir, git: null });

    expect(rapport.baseSha).toBeUndefined();
    for (const controle of Object.values(rapport.controles)) {
      expect(controle).toEqual({ etat: 'not_applicable', raison: 'sans_manifeste' });
    }
    expect(existsSync(path.join(dir, 'test.ran'))).toBe(false);
  });

  it('une tâche annulée n’exécute pas ses validations', async () => {
    const dir = await depot({ 'package.json': manifeste({ test: marque('test') }) });
    const ctrl = new AbortController();
    ctrl.abort();

    const rapport = await valider(dir, { signal: ctrl.signal });

    expect(rapport.controles.tests).toMatchObject({ etat: 'missing', raison: 'annule' });
    expect(existsSync(path.join(dir, 'test.ran'))).toBe(false);
  }, 30_000);
});
