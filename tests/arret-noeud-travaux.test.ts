// UN NŒUD QUI S'ARRÊTE EMPORTE SES MERGES ET SES CHANTIERS — descendance comprise.
//
// ─── LE DÉFAUT QUE CE BANC FERME ─────────────────────────────────────────────
//
// `stop()` n'annulait que les TÂCHES. Un merge lance la commande de test du
// dépôt (`npm test`), un chantier son script déclaré (`npm run …`) : le chantier
// passait `undefined` pour signal à `runProc`, le merge ne recevait aucun
// signal. Arrêté pendant l'un d'eux, le nœud sortait, et `npm`, son shell et
// ce que le script avait lancé continuaient sur la machine du membre — pour un
// résultat que plus personne n'attendait. L'en-tête d'`arreterSurSignaux` le
// disait (« les merges et chantiers, que `stop()` n'annule pas »).
//
// ─── CE QUE LE BANC FAIT ─────────────────────────────────────────────────────
//
// Une ruche réelle, un `HiveNodeClient` réel, un dépôt git réel dont le script
// `test` lance un travail qui IGNORE SIGTERM et qui lance à son tour un
// petit-enfant — exactement la forme `npm → sh → node → serveur`. Le banc
// déclenche le chantier, puis le merge, par les vraies routes, attend que tout
// l'arbre tourne, appelle `stop()`, et exige que l'arbre entier soit mort.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { GRACE_ARRET_MS } from '../src/shared/arbre-processus.js';
import { processusVivant, reprendreTous, retenirPid } from './harnais-processus.js';

const TOKEN = 'jeton-arret-travaux-suffisamment-long-pour-passer';

let dir: string | null = null;
let server: HiveServer | null = null;
let client: HiveNodeClient | null = null;

afterEach(async () => {
  client?.stop();
  client = null;
  // Le filet avant le ménage : un survivant tient ouvert le dossier qu'on
  // s'apprête à effacer (et sous Windows, l'en empêche).
  if (dir) pids(path.join(dir, 'pids'));
  reprendreTous();
  await server?.stop();
  server = null;
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  dir = null;
});

/** Les pid écrits par le travail et son petit-enfant, retenus pour le filet. */
function pids(dossier: string): number[] {
  let noms: string[];
  try {
    noms = readdirSync(dossier);
  } catch {
    return [];
  }
  const tous = noms.map((n) => Number(n.split('-')[1])).filter(Number.isInteger);
  for (const pid of tous) retenirPid(pid);
  return tous;
}

async function jusqua(condition: () => boolean, msMax: number): Promise<boolean> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return condition();
}

/**
 * Le dépôt : `test` lance `dort.js`, qui écrit son pid, lance un petit-enfant
 * qui écrit le sien, ignore SIGTERM et ne finit jamais. Le dossier des pid est
 * écrit EN DUR dans le script : l'environnement de `runProc` est épuré, aucune
 * variable du banc n'y passerait.
 */
async function preparer(): Promise<{ depot: string; dossierPids: string }> {
  const { simpleGit } = await import('simple-git');
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-arret-travaux-'));
  const dossierPids = path.join(dir, 'pids');
  mkdirSync(dossierPids);
  const depot = path.join(dir, 'origine');
  mkdirSync(depot);
  const trace = (prefixe: string): string =>
    `require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(dossierPids)}, ` +
    `'${prefixe}-' + process.pid), '');`;
  const petit = `${trace('petit')} setInterval(() => {}, 1000);`;
  writeFileSync(
    path.join(depot, 'dort.js'),
    `${trace('travail')}\n` +
      `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(petit)}], ` +
      `{ stdio: 'inherit' });\n` +
      "process.on('SIGTERM', () => {});\n" +
      'setInterval(() => {}, 1000);\n',
  );
  writeFileSync(
    path.join(depot, 'package.json'),
    JSON.stringify({ name: 'depot-qui-dort', scripts: { test: 'node dort.js' } }),
  );
  writeFileSync(path.join(depot, 'LISEZMOI.md'), 'ligne 1\n');
  const g = simpleGit({ baseDir: depot });
  await g.init();
  await g.addConfig('user.email', 't@example.com');
  await g.addConfig('user.name', 'T');
  await g.addConfig('commit.gpgsign', 'false');
  await g.add('.');
  await g.commit('initial');

  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'hive.db'),
    simulation: false,
    tickMs: 60,
  });
  client = new HiveNodeClient({
    url: `ws://127.0.0.1:${server.port}/ws`,
    token: TOKEN,
    name: 'ouvriere-arret',
    ownerName: 'test',
    agentType: 'shell',
    maxConcurrency: 1,
    workRoot: path.join(dir, 'travail'),
    adapter: {
      name: 'noop',
      async run() {
        return { success: true, diff: '', logs: '', subAgents: [] };
      },
    },
    quiet: true,
  });
  client.start();
  const srv = server;
  const enLigne = await jusqua(
    () => srv.store.listNodes().some((n) => n.status === 'online'),
    15_000,
  );
  expect(enLigne, 'le nœud ne s’est pas inscrit').toBe(true);
  return { depot, dossierPids };
}

/** Attend l'arbre complet, arrête le nœud, exige que l'arbre soit mort. */
async function arreterPendantLeTravail(dossierPids: string): Promise<void> {
  const tourne = await jusqua(() => {
    const noms = readdirSync(dossierPids);
    return noms.some((n) => n.startsWith('travail-')) && noms.some((n) => n.startsWith('petit-'));
  }, 90_000);
  expect(tourne, 'le travail et son petit-enfant n’ont jamais démarré').toBe(true);
  const arbre = pids(dossierPids);
  expect(arbre.filter(processusVivant), 'l’arbre doit tourner avant l’arrêt').toEqual(arbre);

  client?.stop();
  // SIGTERM ignoré, puis SIGKILL au bout de la grâce : l'arbre entier part.
  const morts = await jusqua(() => !arbre.some(processusVivant), 2 * GRACE_ARRET_MS + 8_000);
  expect(
    morts,
    `survivants après stop() : ${arbre.filter(processusVivant).join(', ')} — orphelins sur la ` +
      'machine du membre',
  ).toBe(true);
}

describe('stop() — les merges et les chantiers en cours partent avec le nœud', () => {
  it('un CHANTIER en cours est arrêté, descendance comprise', { timeout: 180_000 }, async () => {
    const { depot, dossierPids } = await preparer();
    const srv = server as HiveServer;
    const projet = srv.store.createProject({ name: 'Chantier', repoUrl: depot });
    const rep = await fetch(
      `http://127.0.0.1:${srv.port}/api/projects/${projet.id}/chantiers/test/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
        body: '{}',
      },
    );
    expect(rep.status, await rep.clone().text()).toBe(202);
    await arreterPendantLeTravail(dossierPids);
  });

  it(
    'la commande de test d’un MERGE en cours est arrêtée, descendance comprise',
    { timeout: 180_000 },
    async () => {
      const { depot, dossierPids } = await preparer();
      const srv = server as HiveServer;
      const projet = srv.store.createProject({ name: 'Merge', repoUrl: depot });
      // Une tâche terminée et son diff, rangés directement — comme `merge-wiring`.
      srv.store.createTask({ id: 'ta', projectId: projet.id, title: 'ta', prompt: 'p' });
      srv.store.patchTask('ta', { status: 'done' });
      srv.store.insertResult({
        taskId: 'ta',
        nodeId: 'seed',
        success: true,
        diff:
          'diff --git a/LISEZMOI.md b/LISEZMOI.md\n' +
          '--- a/LISEZMOI.md\n' +
          '+++ b/LISEZMOI.md\n' +
          '@@ -1 +1,2 @@\n' +
          ' ligne 1\n' +
          '+ligne 2\n',
        logs: '',
        durationMs: 1,
        subAgents: [],
      });
      const rep = await fetch(`http://127.0.0.1:${srv.port}/api/projects/${projet.id}/merge/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
        body: JSON.stringify({ testCommand: ['npm', 'test'] }),
      });
      expect(rep.status, await rep.clone().text()).toBe(202);
      await arreterPendantLeTravail(dossierPids);
    },
  );
});
