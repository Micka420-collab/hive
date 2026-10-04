// LA BASE FORGÉE, DE BOUT EN BOUT : un vrai nœud (HiveNodeClient), une vraie
// Reine, un vrai dépôt git local cloné par le nœud — et un agent qui FORGE un
// objet git de la base dans le `.git` de sa tâche, comme la faille le permet
// (git ne vérifie pas l'empreinte d'un objet libre qu'il lit ; mesuré, 2.53).
//
// ─── LE CRITÈRE DE PREUVE DE LA CARTE ────────────────────────────────────────
//
//   · l'agent forge le `package.json` de base pour que le juge (le plan de
//     validation) le lise comme IDENTIQUE à ce qu'il a écrit, et laisse passer
//     un `npm test` trafiqué → aucune validation « passée » : la base est dite
//     FALSIFIÉE, et la production n'est pas acceptée ;
//   · l'agent introduit une dépendance vulnérable ET forge le lockfile de base
//     pour qu'elle paraisse « déjà là » → la vulnérabilité reste INTRODUITE, et
//     la falsification est un constat de la porte ;
//   · un dépôt SAIN se juge comme avant — aucune régression (les bancs
//     `validations-bac-bout-en-bout` et `porte-securite-bout-en-bout`, qui
//     passent par la même porte `fichierDeBase`, le tiennent pour le cas vert).
//
// Avant le correctif, `fichierDeBase` rendait le contenu FORGÉ sans un mot : la
// production passait (plan), ou la vulnérabilité était excusée (porte). Ces
// bancs échouent donc sur le code d'avant, pour cette raison exacte.
//
// POSIX seulement : le faux bac et les faux outils de la porte sont des scripts.

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { fauxBac } from './fixtures/faux-bac.js';
import { fauxOutilsPorte, type FauxOutils } from './fixtures/faux-outils-porte.js';

const JETON = 'jeton-base-forgee-suffisamment-long';
const POSIX = process.platform !== 'win32';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
const dossiers: string[] = [];
const PATH_AVANT = process.env.PATH;

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  process.env.PATH = PATH_AVANT;
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 30_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/**
 * FORGE l'objet git du fichier `rel` de la base : un objet valide d'un AUTRE
 * contenu, rangé sous le nom (l'empreinte) de l'original. C'est ce que fait un
 * agent dans le `.git` de sa tâche — git ne vérifie pas l'empreinte à la lecture.
 *
 * Le clone local relie ses objets au dépôt source (liens durs, 0444) : on
 * EFFACE d'abord le lien, puis on écrit — sans quoi on heurterait un fichier en
 * lecture seule, et on corromprait l'inode partagé du dépôt source.
 */
function forgerBaseDansLeClone(cwd: string, rel: string, contenuForge: string): void {
  const original = readFileSync(path.join(cwd, rel));
  const oid = createHash('sha1').update(`blob ${original.length}\0`).update(original).digest('hex');
  const brut = Buffer.concat([
    Buffer.from(`blob ${Buffer.byteLength(contenuForge)}\0`),
    Buffer.from(contenuForge),
  ]);
  const dossier = path.join(cwd, '.git', 'objects', oid.slice(0, 2));
  mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, oid.slice(2));
  rmSync(fichier, { force: true });
  writeFileSync(fichier, deflateSync(brut));
}

const verrou = (deps: Record<string, string>): string =>
  JSON.stringify(
    {
      name: 'projet-local',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'projet-local', version: '1.0.0', dependencies: deps },
        ...Object.fromEntries(
          Object.entries(deps).map(([nom, version]) => [
            `node_modules/${nom}`,
            { version, resolved: `https://registry.npmjs.org/${nom}/-/${nom}-${version}.tgz` },
          ]),
        ),
      },
    },
    null,
    2,
  ) + '\n';

/** Le `package.json` que l'agent FAIT PASSER pour juge en forgeant la base. */
const PKG_TRAFIQUE = `${JSON.stringify(
  { name: 'projet-local', version: '1.0.0', private: true, scripts: { test: 'node -e ""' } },
  null,
  2,
)}\n`;

/**
 * L'agent du banc, selon le titre :
 *   · « Forger le juge » : écrit un `package.json` dont `test` ne prouve rien
 *     (`node -e ""`, code 0), puis FORGE le `package.json` de base pour qu'il
 *     soit IDENTIQUE — le plan ne voit alors aucune réécriture, et lance le
 *     faux juge. Un fichier de code en plus, pour un diff non vide.
 *   · « Forger la base du lockfile » : ajoute minimist 1.2.0 (vulnérable) au
 *     lockfile livré, puis forge le lockfile de BASE pour qu'il porte DÉJÀ un
 *     minimist vulnérable (1.2.5) — même avis, « déjà là » avant le correctif.
 */
const agentForgeur: AgentAdapter = {
  name: 'forgeur',
  run(task, ctx) {
    if (task.title.startsWith('Forger le juge')) {
      // FORGER D'ABORD : l'empreinte de la base se calcule sur le fichier tel
      // qu'il est AVANT que l'agent ne l'écrase (le commit de base y est
      // extrait). On forge l'objet de base pour qu'il soit IDENTIQUE au juge
      // trafiqué, puis on écrit ce juge et un fichier de code (diff non vide).
      forgerBaseDansLeClone(ctx.cwd, 'package.json', PKG_TRAFIQUE);
      writeFileSync(path.join(ctx.cwd, 'package.json'), PKG_TRAFIQUE);
      writeFileSync(path.join(ctx.cwd, 'feature.js'), 'module.exports = 1;\n');
      return Promise.resolve({ success: true, diff: '', logs: 'juge forgé', subAgents: [] });
    }
    // La base est forgée pour PORTER DÉJÀ un minimist vulnérable (1.2.5, même
    // avis) : un contenu DIFFÉRENT de la tête, pour que le diff livre bien le
    // changement — mais « déjà vulnérable » aux yeux d'une porte non vérifiée.
    // D'abord, sur le lockfile de base tel qu'extrait ; puis la tête introduit
    // minimist 1.2.0 (vulnérable GHSA-xvch-5gv4-984h).
    forgerBaseDansLeClone(
      ctx.cwd,
      'package-lock.json',
      verrou({ lodash: '4.17.21', minimist: '1.2.5' }),
    );
    writeFileSync(
      path.join(ctx.cwd, 'package-lock.json'),
      verrou({ lodash: '4.17.21', minimist: '1.2.0' }),
    );
    return Promise.resolve({
      success: true,
      diff: '',
      logs: 'base du lockfile forgée',
      subAgents: [],
    });
  },
};

interface EvaluationLue {
  decision: string;
  reasons: string[];
  evidence: {
    tests: string;
    securite: { secrets: Record<string, unknown>; dependances: Record<string, unknown> };
    validationProvenance?: { details?: Record<string, { raison?: string }> };
  };
}

async function demarrer(opts: {
  base: Record<string, string>;
  avecBac: boolean;
  avecOutils: boolean;
}): Promise<{
  s: HiveServer;
  produire: (title: string) => Promise<{ tacheId: string; evaluation: EvaluationLue }>;
}> {
  if (opts.avecOutils) {
    const outils: FauxOutils = fauxOutilsPorte(dossiers);
    process.env.PATH = `${outils.dossier}${path.delimiter}${PATH_AVANT ?? ''}`;
  }
  const racine = mkdtempSync(path.join(os.tmpdir(), 'base-forgee-e2e-'));
  dossiers.push(racine);
  const depot = path.join(racine, 'depot');
  mkdirSync(depot, { recursive: true });
  for (const [nom, contenu] of Object.entries(opts.base)) {
    mkdirSync(path.dirname(path.join(depot, nom)), { recursive: true });
    writeFileSync(path.join(depot, nom), contenu);
  }
  const git = simpleGit({ baseDir: depot });
  await git.init();
  await git.addConfig('user.email', 'banc@hive.test');
  await git.addConfig('user.name', 'Banc Hive');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('base');

  serveur = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: JETON,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(racine, 'hive.db'),
    simulation: false,
    tickMs: 40,
  });
  const bac = opts.avecBac ? fauxBac(dossiers) : undefined;
  client = new HiveNodeClient({
    url: `ws://127.0.0.1:${serveur.port}/ws`,
    token: JETON,
    name: 'ouvriere-forge',
    ownerName: 'banc',
    agentType: 'claude-code',
    nodeId: 'noeud-forge',
    maxConcurrency: 1,
    workRoot: path.join(racine, 'travail'),
    adapter: agentForgeur,
    quiet: true,
    ...(bac ? { bac } : {}),
  });
  client.start();
  const s = serveur;
  await attendre(
    () => s.store.listNodes().some((n) => n.id === 'noeud-forge' && n.status === 'online'),
    'le nœud ne rejoint pas la ruche',
  );
  const projet = s.store.createProject({ name: 'Projet local', repoUrl: depot });
  const produire = async (title: string) => {
    const tache = s.store.createTask({ projectId: projet.id, title, prompt: 'forge' });
    s.store.patchTask(tache.id, { status: 'ready' });
    await attendre(() => s.store.resultsForTask(tache.id).length > 0, `${title} : pas de résultat`);
    const reponse = await fetch(`http://127.0.0.1:${s.port}/api/tasks/${tache.id}/evaluation`, {
      headers: { 'x-hive-token': JETON },
    });
    expect(reponse.status).toBe(200);
    return { tacheId: tache.id, evaluation: (await reponse.json()) as EvaluationLue };
  };
  return { s, produire };
}

describe.runIf(POSIX)('la base forgée — la porte de lecture vérifiée la rejette', () => {
  it(
    'LE PLAN : un package.json de base forgé ne rend aucune validation « passée » — la base est dite falsifiée',
    { timeout: 120_000 },
    async () => {
      const { produire } = await demarrer({
        base: {
          'package.json': `${JSON.stringify({
            name: 'projet-local',
            version: '1.0.0',
            private: true,
            scripts: { test: 'node -e "process.exit(1)"' },
          })}\n`,
        },
        avecBac: true,
        avecOutils: false,
      });

      const { evaluation } = await produire('Forger le juge');

      // Le juge forgé n'a RIEN rendu de vert : les tests ne sont pas « passed ».
      expect(evaluation.evidence.tests).not.toBe('passed');
      expect(evaluation.evidence.validationProvenance?.details?.tests?.raison).toBe(
        'base_falsifiee',
      );
      // La production n'est pas acceptée, et la cause est dite.
      expect(evaluation.decision).not.toBe('accepted');
      expect(evaluation.reasons.join(' · ')).toContain('falsifiée');
      expect(evaluation.reasons.join(' · ')).toContain('ne correspond pas à son empreinte');
    },
  );

  it(
    'LA PORTE : un lockfile de base forgé n’excuse pas la vulnérabilité introduite',
    { timeout: 120_000 },
    async () => {
      const { s, produire } = await demarrer({
        base: {
          'package.json': `${JSON.stringify({
            name: 'projet-local',
            version: '1.0.0',
            private: true,
            dependencies: { lodash: '4.17.21' },
          })}\n`,
          // Base saine : minimist 1.2.6 est la version corrigée (hors de l’avis).
          'package-lock.json': verrou({ lodash: '4.17.21', minimist: '1.2.6' }),
        },
        avecBac: false,
        avecOutils: true,
      });

      const { tacheId, evaluation } = await produire('Forger la base du lockfile');

      const dependances = evaluation.evidence.securite.dependances;
      expect(dependances.etat).toBe('constat');
      // La vulnérabilité de minimist reste INTRODUITE malgré la base forgée.
      expect(JSON.stringify(dependances)).toContain('minimist');
      expect(JSON.stringify(dependances)).toContain('GHSA-xvch-5gv4-984h');
      // La falsification est un constat nommé, journalisé avec le rapport.
      expect(JSON.stringify(dependances)).toContain('base_falsifiee');
      expect(evaluation.decision).toBe('correction_required');
      expect(evaluation.reasons.join(' · ')).toContain('base(s) falsifiée(s)');

      const [fait] = s.store.evenementsDeTache(tacheId, ['security_gate_recorded']);
      expect(JSON.stringify(fait?.payload)).toContain('base_falsifiee');
    },
  );
});
