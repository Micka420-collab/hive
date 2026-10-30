// G18 — MESURER AVANT D'ACCÉLÉRER.
//
// Les espaces de travail rapides (le miroir du projet, le magasin de
// dépendances) promettent de faire tomber ce qu'une tentative paie avant et
// après son agent : un clone par l'amont, un `npm ci` complet. Une promesse de
// vitesse sans mesure ne se tient pas — ni ne se défait. Ce banc tient donc
// d'abord les INSTRUMENTS, contre un vrai git, un vrai serveur HTTP Git et un
// vrai `npm` :
//
//   1. le serveur du banc compte les packs qu'il sert (un `ls-remote` n'en
//      sert aucun) et sait retenir chacun — un amont lent ;
//   2. la préparation d'un espace rend sa durée phase par phase, et le clone y
//      porte bien la lenteur de l'amont ;
//   3. les validations disent ce que leur installation a coûté, puis le bilan
//      de chaque étape ;
//   4. le hub reçoit la ligne de l'espace prêt AVANT le résultat — par le vrai
//      client du nœud.

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleGit } from 'simple-git';
import { WebSocketServer } from 'ws';
import type { AgentAdapter } from '../src/adapters/index.js';
import { resoudreLanceur } from '../src/lanceur-reel.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { poserRegistre } from '../src/node-client/git-hote.js';
import { validerProduction } from '../src/node-client/validations-bac.js';
import { ligneEspacePret, prepareWorkspace } from '../src/node-client/workspace.js';
import type { Task } from '../src/shared/types.js';
import { ServeurGit } from './aide/serveur-git.js';
import { fauxBac } from './fixtures/faux-bac.js';

const POSIX = process.platform !== 'win32';
const REGLAGES = ['-c', 'user.email=banc@hive.local', '-c', 'user.name=Banc Hive'];
const REGLAGES_COMMIT = [...REGLAGES, '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];

let racine: string;
let serveur: ServeurGit;
const dossiers: string[] = [];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', [...REGLAGES_COMMIT, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * Un git qui parle au serveur du banc : ASYNCHRONE. Le serveur vit dans ce
 * processus — un `execFileSync` gèlerait la boucle qui doit lui répondre.
 */
const gitReseau = async (cwd: string, ...args: string[]): Promise<string> =>
  (await promisify(execFile)('git', [...REGLAGES_COMMIT, ...args], { cwd, encoding: 'utf8' }))
    .stdout;

const tache = (id: string): Task => ({ id, title: id, prompt: 'x', branch: null }) as Task;

beforeAll(async () => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-espaces-mesures-'));
  const projets = path.join(racine, 'projets');
  mkdirSync(projets);
  const copie = path.join(racine, 'copie');
  git(racine, 'init', '-q', copie);
  git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(path.join(copie, 'LISEZMOI.md'), '# Mesuré\n');
  git(copie, 'add', '--all');
  git(copie, 'commit', '-q', '-m', 'premier commit');
  git(racine, 'clone', '-q', '--bare', copie, path.join(projets, 'depot.git'));
  serveur = new ServeurGit(projets);
  await serveur.demarrer();
});

afterAll(async () => {
  await serveur.fermer();
  rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
});

// Le git du nœud lit le HOME du processus : un HOME vide, sans configuration
// du poste qui changerait ce qu'on mesure.
beforeEach(() => {
  const maison = path.join(racine, 'maison');
  mkdirSync(maison, { recursive: true });
  vi.stubEnv('HOME', maison);
  vi.stubEnv('USERPROFILE', maison);
  serveur.packsServis = 0;
  serveur.latencePackMs = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

describe('le serveur du banc compte les packs servis, et sait être lent', () => {
  it('un clone reçoit UN pack ; un ls-remote, aucun', async () => {
    const cible = path.join(racine, 'clone-compte');
    dossiers.push(cible);
    await gitReseau(racine, 'ls-remote', serveur.url('depot'));
    expect(serveur.packsServis).toBe(0);
    await gitReseau(racine, 'clone', '-q', '--depth', '1', serveur.url('depot'), cible);
    expect(serveur.packsServis).toBe(1);
  }, 30_000);

  it('la latence retient le pack, jamais la négociation', async () => {
    serveur.latencePackMs = 1_500;
    const cible = path.join(racine, 'clone-lent');
    dossiers.push(cible);
    let debut = Date.now();
    await gitReseau(racine, 'ls-remote', serveur.url('depot'));
    expect(Date.now() - debut).toBeLessThan(1_500);
    debut = Date.now();
    await gitReseau(racine, 'clone', '-q', '--depth', '1', serveur.url('depot'), cible);
    expect(Date.now() - debut).toBeGreaterThanOrEqual(1_500);
    expect(git(cible, 'log', '--format=%s')).toBe('premier commit\n');
  }, 30_000);
});

describe('l’espace de travail dit ce qu’il a coûté, phase par phase', () => {
  it('effacement, clone, registre — et le clone porte la lenteur de l’amont', async () => {
    serveur.latencePackMs = 600;
    const travail = path.join(racine, 'travail-phases');
    dossiers.push(travail);

    const espace = await prepareWorkspace(travail, tache('t-phases'), serveur.url('depot'));
    try {
      const { phases, totalMs } = espace.durees;
      expect(Object.keys(phases)).toEqual(['effacement', 'clone', 'registre']);
      expect(phases.clone).toBeGreaterThanOrEqual(600);
      const somme = (phases.effacement ?? 0) + (phases.clone ?? 0) + (phases.registre ?? 0);
      // Chaque phase est arrondie à la milliseconde ; le total, mesuré d'un trait.
      expect(totalMs).toBeGreaterThanOrEqual(somme - 3);
      expect(ligneEspacePret(espace.durees)).toMatch(
        /^espace de travail prêt en \d+,\d s \(effacement \d+,\d s · clone \d+,\d s · registre \d+,\d s\)$/,
      );
    } finally {
      await espace.cleanup();
    }
  }, 30_000);

  it('sans dépôt, l’effacement seul', async () => {
    const travail = path.join(racine, 'travail-sans-depot');
    dossiers.push(travail);

    const espace = await prepareWorkspace(travail, tache('t-vide'), null);
    try {
      expect(Object.keys(espace.durees.phases)).toEqual(['effacement']);
      expect(ligneEspacePret(espace.durees)).toMatch(
        /^espace de travail prêt en \d+,\d s \(effacement \d+,\d s\)$/,
      );
    } finally {
      await espace.cleanup();
    }
  });
});

describe.runIf(POSIX)('les validations disent ce que chaque étape a coûté', () => {
  it('l’installation dit sa durée, et un bilan clôt les validations', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-espaces-validations-'));
    const registre = mkdtempSync(`${dir}.registre-`);
    dossiers.push(dir, registre, `${dir}.tmp`);
    const fichiers = {
      'dep-locale/package.json': JSON.stringify({ name: 'dep-locale', version: '1.0.0' }),
      'dep-locale/index.js': 'module.exports = "vraie";\n',
      'package.json': JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        private: true,
        scripts: { test: `node -e "process.exit(require('dep-locale') === 'vraie' ? 0 : 1)"` },
        dependencies: { 'dep-locale': 'file:./dep-locale' },
      }),
      '.gitignore': 'node_modules\n',
    };
    for (const [nom, contenu] of Object.entries(fichiers)) {
      mkdirSync(path.dirname(path.join(dir, nom)), { recursive: true });
      writeFileSync(path.join(dir, nom), contenu);
    }
    // Une dépendance locale : `npm ci` l'installe sans réseau.
    const npm = resoudreLanceur('npm', ['install', '--no-audit', '--no-fund', '--offline']);
    execFileSync(npm.bin, npm.args, { cwd: dir, stdio: 'ignore' });
    const depot = simpleGit({ baseDir: dir });
    await depot.init();
    for (const [cle, valeur] of [
      ['user.email', 'banc@hive.local'],
      ['user.name', 'Banc Hive'],
      ['commit.gpgsign', 'false'],
    ] as const) {
      await depot.addConfig(cle, valeur);
    }
    await depot.add('.');
    await depot.commit('base');
    const base = (await depot.revparse(['HEAD'])).trim();
    writeFileSync(path.join(dir, 'feature.js'), 'module.exports = 2;\n');
    const etapes: string[] = [];

    const rapport = await validerProduction({
      cwd: dir,
      depot: { depot: await poserRegistre(dir, registre, base), baseSha: base },
      bac: fauxBac(dossiers),
      surEtape: (l) => etapes.push(l),
    });

    expect(rapport.controles.tests).toMatchObject({ etat: 'passed', code: 0 });
    expect(etapes).toContainEqual(
      expect.stringMatching(/^validations : préparation « npm ci » faite en \d+(,\d)? s$/),
    );
    // Le bilan est la DERNIÈRE ligne, et nomme chaque étape dans son ordre.
    expect(etapes.at(-1)).toMatch(
      /^validations : faites en \S+ s \(nettoyage \S+ s · sonde \S+ s · préparation \S+ s · tests \S+ s\)$/,
    );
  }, 60_000);
});

describe('le hub lit la ligne de l’espace prêt, avant le résultat', () => {
  it('par le vrai client du nœud', async () => {
    const recus: Record<string, unknown>[] = [];
    const hub = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    const resultat = new Promise<void>((resolve) => {
      hub.on('connection', (ws) => {
        ws.on('message', (brut) => {
          const msg = JSON.parse(String(brut)) as Record<string, unknown>;
          recus.push(msg);
          if (msg.type === 'register') {
            ws.send(JSON.stringify({ type: 'registered', nodeId: 'n-mesure' }));
            const t = {
              ...tache('t-hub'),
              projectId: 'p',
              status: 'assigned',
              dependsOn: [],
              attempts: 0,
              createdAt: 1,
              updatedAt: 1,
              assignedNodeId: 'n-mesure',
            };
            ws.send(
              JSON.stringify({ type: 'assign_task', task: t, repoUrl: serveur.url('depot') }),
            );
          }
          if (msg.type === 'task_result') resolve();
        });
      });
    });
    await new Promise<void>((resolve) => hub.once('listening', () => resolve()));
    const { port } = hub.address() as { port: number };
    const adapter: AgentAdapter = {
      name: 'shell',
      run: async () => ({ success: true, diff: '', logs: '', subAgents: [] }),
    };
    const travail = path.join(racine, 'travail-hub');
    dossiers.push(travail);
    const client = new HiveNodeClient({
      url: `ws://127.0.0.1:${port}/ws`,
      token: 'jeton-de-ruche-suffisamment-long',
      name: 'poste-mesure',
      ownerName: 'membre',
      agentType: 'shell',
      nodeId: 'n-mesure',
      maxConcurrency: 1,
      workRoot: travail,
      adapter,
      quiet: true,
    });
    try {
      client.start();
      await resultat;
    } finally {
      client.stop();
      await new Promise<void>((resolve) => hub.close(() => resolve()));
    }
    const ligne = recus.findIndex(
      (m) =>
        m.type === 'task_update' &&
        typeof m.log === 'string' &&
        /^espace de travail prêt en .* \(effacement .* · clone .* · registre .*\)$/.test(m.log),
    );
    expect(ligne, JSON.stringify(recus.map((m) => m.log ?? m.type))).toBeGreaterThanOrEqual(0);
    expect(ligne).toBeLessThan(recus.findIndex((m) => m.type === 'task_result'));
  }, 30_000);
});
