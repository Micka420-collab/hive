// Les validations du bac, côté nœud — de vrais dépôts git, de vrais `npm run`.
//
// Ce que ce banc tient pour acquis n'est RIEN : chaque cas construit un dépôt,
// le « produit » (modifie l'arbre comme le ferait un agent), puis lance
// `validerProduction` et regarde ce qui a réellement tourné — un fichier
// marqueur écrit par le script dit s'il a été lancé ou non.
//
// Les cas qui comptent le plus sont ceux où RIEN ne doit tourner : une
// production qui réécrit son script de test, ou `.npmrc`, ne se juge pas
// elle-même ; un bac où npm ne se lance pas ne rend pas quatre faux échecs ;
// un nœud SANS bac ne lance pas sur l'hôte nu du code écrit par l'agent.
//
// ─── LE BAC DE CE BANC ───────────────────────────────────────────────────────
//
// Les validations ne tournent que dans un bac : ce banc passe par le faux
// moteur de `fixtures/faux-bac.ts` (POSIX), tout le reste est réel.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { resoudreLanceur } from '../src/lanceur-reel.js';
import { GRACE_ARRET_MS } from '../src/shared/arbre-processus.js';
import { poserRegistre } from '../src/node-client/git-hote.js';
import type { DepotEpingle } from '../src/shared/git-protege.js';
import { validerProduction } from '../src/node-client/validations-bac.js';
import { prepareWorkspace } from '../src/node-client/workspace.js';
import type { Fournisseur } from '../src/node-client/isolement.js';
import { creerCaviardeur } from '../src/shared/caviardage.js';
import { fauxBac as fauxBacDe } from './fixtures/faux-bac.js';
import type { Task } from '../src/shared/types.js';

const dossiers: string[] = [];

/**
 * `runProc` réel, sauf quand un cas pose `piege.erreur` : le lancement jette
 * alors — la panne du NŒUD que `validerProduction` rend en `interrompue`.
 */
const piege = vi.hoisted(() => ({ erreur: null as Error | null }));
vi.mock('../src/node-client/merge-runner.js', async (original) => {
  const vrai = await original<typeof import('../src/node-client/merge-runner.js')>();
  return {
    ...vrai,
    runProc: (...args: Parameters<typeof vrai.runProc>) =>
      piege.erreur ? Promise.reject(piege.erreur) : vrai.runProc(...args),
  };
});

afterEach(() => {
  piege.erreur = null;
});

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

const POSIX = process.platform !== 'win32';

const fauxBac = () => fauxBacDe(dossiers);

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

const baseDe = async (dir: string): Promise<string> =>
  (await simpleGit({ baseDir: dir }).revparse(['HEAD'])).trim();

/**
 * Le registre de la ruche sur `dir`, comme `prepareWorkspace` le pose
 * (`git-hote.ts`) : les validations relisent le dépôt par LUI, jamais par le
 * `.git` de la tâche. Posé ici au moment de valider — les dépôts du banc
 * n'ont ni crochet ni filtre à tenir à l'écart.
 */
const registreDe = async (dir: string, base: string): Promise<DepotEpingle> => {
  const registre = mkdtempSync(`${dir}.registre-`);
  dossiers.push(registre);
  return poserRegistre(dir, registre, base);
};

/**
 * Valide `dir` comme le nœud : base ÉPINGLÉE avant que l'agent ne touche à
 * rien (`baseSha`, sinon HEAD maintenant), dans le faux bac sauf avis contraire.
 */
const valider = async (
  dir: string,
  extra: Partial<Parameters<typeof validerProduction>[0]> & { baseSha?: string } = {},
) => {
  const { baseSha, ...reste } = extra;
  const base = baseSha ?? (await baseDe(dir));
  return validerProduction({
    cwd: dir,
    depot: { depot: await registreDe(dir, base), baseSha: base },
    bac: fauxBac(),
    ...reste,
  });
};

describe('validerProduction — sans bac, rien ne tourne sur l’hôte', () => {
  it('le code de l’agent ne s’exécute pas hors d’un bac : sans_bac, et rien n’a tourné', async () => {
    const dir = await depot({
      'package.json': manifeste({ test: marque('test'), lint: marque('lint') }),
    });
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 1;\n');

    const rapport = await validerProduction({
      cwd: dir,
      depot: { depot: await registreDe(dir, await baseDe(dir)), baseSha: await baseDe(dir) },
    });

    expect(rapport.controles.tests).toEqual({
      etat: 'missing',
      raison: 'sans_bac',
      script: 'test',
    });
    expect(rapport.controles.lint).toEqual({ etat: 'missing', raison: 'sans_bac', script: 'lint' });
    expect(rapport.controles.build).toEqual({ etat: 'not_applicable', raison: 'non_declare' });
    expect(existsSync(path.join(dir, 'test.ran'))).toBe(false);
    expect(existsSync(path.join(dir, 'lint.ran'))).toBe(false);
  }, 30_000);
});

describe.runIf(POSIX)('validerProduction — ce que la base déclare, lancé dans le bac', () => {
  it('lance les scripts déclarés et rend un constat par validation', async () => {
    const dir = await depot({
      'package.json': manifeste({
        test: marque('test'),
        lint: marque('lint', 2),
        build: marque('build'),
      }),
    });
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 1;\n');
    const sha = await baseDe(dir);
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

  // Trois façons de réécrire son juge. La deuxième et la troisième passaient :
  // le garde ne comparait que le script choisi et ses crochets pre/post, alors
  // que `test` peut appeler `npm run unit`, et que `npm ci` lance `prepare`
  // avant tout — après le calcul du diff, qui n'en montre qu'une ligne.
  it.each<[string, Record<string, string>, Record<string, string>]>([
    ['le script lui-même', { test: marque('base', 1) }, { test: marque('reecrit', 0) }],
    [
      'un script qu’il appelle',
      { test: 'npm run unit', unit: marque('base', 1) },
      { test: 'npm run unit', unit: marque('reecrit', 0) },
    ],
    [
      'un script de cycle de vie ajouté',
      { test: marque('base', 1) },
      { test: marque('base', 1), prepare: marque('reecrit', 0) },
    ],
  ])(
    'ne lance rien quand la production a réécrit %s',
    async (_cas, avant, apres) => {
      const dir = await depot({ 'package.json': manifeste(avant) });
      writeFileSync(path.join(dir, 'package.json'), manifeste(apres));

      const rapport = await valider(dir);

      expect(rapport.controles.tests).toEqual({
        etat: 'missing',
        raison: 'declaration_reecrite',
        script: 'test',
      });
      expect(existsSync(path.join(dir, 'reecrit.ran'))).toBe(false);
      expect(existsSync(path.join(dir, 'base.ran'))).toBe(false);
    },
    30_000,
  );

  it('une réécriture COMMITTÉE par l’agent reste une réécriture — la base est celle du clone', async () => {
    // L'agent committe : HEAD bouge. Relue à HEAD, la « base » était le commit
    // de l'agent, son script réécrit passait pour la déclaration du projet,
    // et `baseSha` nommait ce commit-là.
    const dir = await depot({ 'package.json': manifeste({ test: marque('base', 1) }) });
    const base = await baseDe(dir);
    const git = simpleGit({ baseDir: dir });
    writeFileSync(path.join(dir, 'package.json'), manifeste({ test: marque('reecrit', 0) }));
    await git.add('package.json');
    await git.commit('agent');
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 1;\n');

    const rapport = await valider(dir, { baseSha: base });

    expect(rapport.baseSha).toBe(base);
    expect(rapport.controles.tests).toMatchObject({
      etat: 'missing',
      raison: 'declaration_reecrite',
    });
    expect(existsSync(path.join(dir, 'reecrit.ran'))).toBe(false);
  }, 30_000);

  it('ce que git ignore ne juge pas : un node_modules/.bin planté par l’agent est retiré', async () => {
    // Projet SANS dépendances : aucune réinstallation n'aurait remplacé ce
    // dossier, et `npm run` met `node_modules/.bin` en tête du PATH — le
    // `node` de l'agent rendait 0 à la place du vrai.
    const dir = await depot({
      'package.json': manifeste({ test: 'node test.js' }),
      'test.js': 'process.exit(1)\n',
      '.gitignore': 'node_modules\n',
    });
    const cale = path.join(dir, 'node_modules', '.bin', 'node');
    mkdirSync(path.dirname(cale), { recursive: true });
    writeFileSync(cale, '#!/bin/sh\nexit 0\n');
    chmodSync(cale, 0o755);
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 1;\n');

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toMatchObject({ etat: 'failed', raison: 'termine', code: 1 });
    expect(existsSync(cale)).toBe(false);
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

  it('.npmrc intact mais extrait en CRLF (autocrlf) : pas une réécriture', async () => {
    // Le défaut de Git pour Windows : `core.autocrlf=true` extrait en CRLF un
    // blob en LF. La comparaison d'octets accusait CHAQUE production d'un
    // dépôt à `.npmrc` d'avoir réécrit celui-ci.
    const origine = await depot({
      'package.json': manifeste({ test: marque('test') }),
      '.npmrc': 'engine-strict=true\nfund=false\n',
    });
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-validations-crlf-'));
    dossiers.push(racine);
    const dir = path.join(racine, 'clone');
    await simpleGit().clone(origine, dir, ['--depth', '1', '-c', 'core.autocrlf=true']);
    expect(readFileSync(path.join(dir, '.npmrc'), 'utf8')).toContain('\r\n');
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 1;\n');

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toMatchObject({ etat: 'passed', raison: 'termine' });
  }, 30_000);

  it('127 : un outil introuvable n’est pas un verdict sur la production', async () => {
    const dir = await depot({
      'package.json': manifeste({ test: 'outil-que-personne-n-a-installe --run' }),
    });

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toMatchObject({
      etat: 'missing',
      raison: 'outil_introuvable',
      code: 127,
    });
  }, 30_000);

  // G11a, sur un vrai `npm run` : la sortie que lit la table est celle du
  // runner ET de npm, telle que `runProc` la rend.
  it('le tueur d’OOM (137 + « Killed ») : missing/environnement, pas un échec de la production', async () => {
    const dir = await depot({
      'package.json': manifeste({
        test: `node -e "console.log('Killed');process.exit(137)"`,
      }),
    });

    const etapes: string[] = [];
    const rapport = await valider(dir, { surEtape: (l) => etapes.push(l) });

    expect(rapport.controles.tests).toMatchObject({
      etat: 'missing',
      raison: 'environnement',
      panne: 'memoire',
      code: 137,
    });
    // La ligne de progression nomme la panne : l'opérateur regarde le nœud.
    expect(etapes).toContain('validation tests : missing (environnement : memoire, code 137)');
  }, 30_000);

  it('un test qui imprime « Cannot allocate memory » puis rate son assertion reste failed', async () => {
    const dir = await depot({
      'package.json': manifeste({
        test: `node -e "console.log('Cannot allocate memory');require('node:assert').strictEqual(1,2)"`,
      }),
    });

    const rapport = await valider(dir);

    expect(rapport.controles.tests).toMatchObject({ etat: 'failed', raison: 'termine', code: 1 });
    expect(rapport.controles.tests.extrait).toContain('Cannot allocate memory');
  }, 30_000);

  it('délai dépassé : missing — la commande est arrêtée, son verdict reste inconnu', async () => {
    const dir = await depot({
      'package.json': manifeste({ lint: 'node -e "setTimeout(() => {}, 5000)"' }),
    });

    const rapport = await valider(dir, { delaiMs: 1_500 });

    expect(rapport.controles.lint).toMatchObject({ etat: 'missing', raison: 'delai' });
  }, 30_000);

  it('le délai TIENT contre ce que le script laisse tourner derrière lui', async () => {
    // `serveur &` : npm sort, le serveur garde la sortie ouverte. L'ancien
    // code attendait sa mort — ici 30 s, ailleurs jamais — avant de rendre le
    // résultat de la tâche.
    const dir = await depot({
      'package.json': manifeste({
        test: 'node -e "setTimeout(() => {}, 30000)" & node -e "process.exit(0)"',
      }),
    });
    const debut = Date.now();

    const rapport = await valider(dir, { delaiMs: 1_500 });

    expect(Date.now() - debut).toBeLessThan(1_500 + 2 * GRACE_ARRET_MS + 8_000);
    expect(rapport.controles.tests).toMatchObject({ etat: 'passed', code: 0 });
  }, 60_000);

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

    const rapport = await valider(dir, { bac: { fournisseur, variables: [], image: 'hive-banc' } });

    expect(rapport.controles.tests).toMatchObject({ etat: 'missing', raison: 'npm_indisponible' });
    expect(rapport.controles.lint).toMatchObject({ etat: 'missing', raison: 'npm_indisponible' });
    expect(rapport.controles.build).toEqual({ etat: 'not_applicable', raison: 'non_declare' });
  }, 30_000);

  it('sans dépôt, rien n’est déclaré : tout est non applicable, rien ne tourne', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-validations-sans-depot-'));
    dossiers.push(dir);
    writeFileSync(path.join(dir, 'package.json'), manifeste({ test: marque('test') }));

    const rapport = await validerProduction({ cwd: dir, depot: null, bac: fauxBac() });

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

describe('validerProduction — une panne du nœud se dit, caviardée', () => {
  it('le message d’une exception part au hub sans le jeton de ruche qu’il cite', async () => {
    // L'extrait `interrompue` recopie le message tel quel « pour qu'on le
    // trouve » — et il part au hub comme les logs (#489). Un message de
    // lancement peut citer un chemin ou un argument qui porte un secret.
    const JETON = 'jeton-de-ruche-du-banc-assez-long-0123456789';
    const dir = await depot({ 'package.json': manifeste({ test: marque('test') }) });
    piege.erreur = new Error(`spawn refusé : /srv/${JETON}/npm`);

    const rapport = await valider(dir, { caviarder: creerCaviardeur([JETON]).texte });

    expect(rapport.controles.tests).toMatchObject({ etat: 'missing', raison: 'interrompue' });
    expect(rapport.controles.tests.extrait).toContain('spawn refusé : /srv/[secret]/npm');
    expect(JSON.stringify(rapport)).not.toContain(JETON);
    expect(existsSync(path.join(dir, 'test.ran'))).toBe(false);
  }, 30_000);
});

describe('prepareWorkspace — la base épinglée, et le diff qui en part', () => {
  it('ce que l’agent committe ou indexe reste dans le diff, et la base ne bouge pas', async () => {
    // `git diff` nu compare l'arbre à l'INDEX : un fichier que l'agent avait
    // `git add` ou committé disparaissait du diff — de la revue, de la
    // livraison et du merge —, et HEAD relu après coup nommait son commit.
    const origine = await depot({ 'README.md': '# projet\n' });
    const base = await baseDe(origine);
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-validations-ws-'));
    dossiers.push(racine);
    const tache: Task = {
      id: 'tache-base',
      projectId: 'p',
      title: 'Base épinglée',
      prompt: 'x',
      status: 'assigned',
      dependsOn: [],
      assignedNodeId: 'n',
      result: null,
      branch: null,
      attempts: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const ws = await prepareWorkspace(racine, tache, origine);
    try {
      const git = simpleGit({ baseDir: ws.cwd });
      await git.addConfig('user.email', 'agent@hive.test');
      await git.addConfig('user.name', 'Agent');
      await git.addConfig('commit.gpgsign', 'false');
      writeFileSync(path.join(ws.cwd, 'committe.js'), 'module.exports = 1;\n');
      await git.add('committe.js');
      await git.commit('agent');
      writeFileSync(path.join(ws.cwd, 'indexe.js'), 'module.exports = 2;\n');
      await git.add('indexe.js');
      writeFileSync(path.join(ws.cwd, 'nouveau.js'), 'module.exports = 3;\n');

      const diff = await ws.collectDiff();

      expect(ws.baseSha).toBe(base);
      for (const f of ['committe.js', 'indexe.js', 'nouveau.js']) expect(diff).toContain(f);
    } finally {
      await ws.cleanup();
    }
  }, 30_000);
});
