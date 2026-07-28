// Tests du Honeycomb Merge v0 (Palier 3) : parsing de diffs unifiés, détection
// de conflits de lignes, plan de merge (ordre topologique + intégrabilité), et
// endpoint REST bout-en-bout (deux tâches aux diffs conflictuels).

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildMergePlan,
  conflictingFiles,
  parseDiff,
  type MergePlan,
} from '../src/orchestrator/honeycomb.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-honeycomb-assez-long';

const diffOn = (file: string, start: number, count: number): string =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${start},${count} +${start},${count + 1} @@\n context\n+ajout\n`;

const task = (id: string, status: Task['status'], dependsOn: string[] = []): Task => ({
  id,
  projectId: 'p',
  title: id,
  prompt: 'p',
  status,
  dependsOn,
  assignedNodeId: null,
  result: null,
  branch: null,
  attempts: 0,
  createdAt: 1,
  updatedAt: 1,
});

describe('parseDiff', () => {
  it('extrait fichiers et plages de lignes de base', () => {
    const d = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -10,6 +10,7 @@\n ctx\n-a\n+b\n@@ -30,2 +31,3 @@\n c\n`;
    const p = parseDiff(d);
    expect([...p.keys()]).toEqual(['x.ts']);
    expect(p.get('x.ts')).toEqual([
      { start: 10, end: 15 },
      { start: 30, end: 31 },
    ]);
  });

  it('gère un nouveau fichier (/dev/null) et un hunk sans compteur', () => {
    const d = `--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,3 @@\n+x\n@@ -5 +8 @@\n y\n`;
    const p = parseDiff(d);
    expect(p.has('new.ts')).toBe(true);
    // hunk « @@ -5 +8 @@ » : compteur omis → 1 ligne.
    expect(p.get('new.ts')).toEqual([
      { start: 0, end: 0 },
      { start: 5, end: 5 },
    ]);
  });
});

describe('conflictingFiles', () => {
  it('détecte le chevauchement de lignes sur un même fichier', () => {
    expect(conflictingFiles(diffOn('src/app.ts', 10, 6), diffOn('src/app.ts', 12, 9))).toEqual([
      'src/app.ts',
    ]);
  });
  it('ignore des plages disjointes du même fichier', () => {
    expect(conflictingFiles(diffOn('src/app.ts', 10, 3), diffOn('src/app.ts', 40, 3))).toEqual([]);
  });
  it('ignore des fichiers différents', () => {
    expect(conflictingFiles(diffOn('a.ts', 1, 5), diffOn('b.ts', 1, 5))).toEqual([]);
  });

  it('LE CHEVAUCHEMENT EST SYMÉTRIQUE — l’ordre des deux diffs ne décide de rien', () => {
    // Trouvé en MUTANT : remplacer `a.start <= b.end` par `a.start <= b.start`
    // ne rougissait aucun test. Tous les cas de chevauchement couverts font
    // commencer A avant B ; le cas miroir — celui où le SECOND diff commence
    // en premier — n'était nulle part.
    //
    // La symétrie n'est pas une élégance : `conflictingFiles(a, b)` est
    // appelée dans un ordre que personne ne choisit (celui des tâches dans le
    // plan de merge). Un conflit vu dans un sens et pas dans l'autre, c'est un
    // merge annoncé sans risque qui écrase du travail.
    const tot = diffOn('src/app.ts', 5, 10); // lignes 5 → 14
    const tard = diffOn('src/app.ts', 10, 10); // lignes 10 → 19
    expect(conflictingFiles(tot, tard), 'A avant B').toEqual(['src/app.ts']);
    expect(conflictingFiles(tard, tot), 'B avant A').toEqual(['src/app.ts']);

    // Et l'INCLUSION, dans les deux sens : une plage entièrement contenue dans
    // l'autre est le cas où une comparaison de bornes bancale passe le plus
    // facilement inaperçue.
    const large = diffOn('src/app.ts', 1, 100);
    const etroit = diffOn('src/app.ts', 50, 2);
    expect(conflictingFiles(large, etroit), 'large englobe étroit').toEqual(['src/app.ts']);
    expect(conflictingFiles(etroit, large), 'étroit dans large').toEqual(['src/app.ts']);
  });
});

describe('parsing robuste (revue Palier 3)', () => {
  it('détecte suppression vs modification du même fichier', () => {
    const del = `diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ /dev/null\n@@ -1,20 +0,0 @@\n-x\n`;
    const mod = diffOn('src/foo.ts', 5, 6);
    // La suppression est indexée sous le chemin de base → conflit visible.
    expect(parseDiff(del).get('src/foo.ts')).toEqual([{ start: 1, end: 20 }]);
    expect(conflictingFiles(del, mod)).toEqual(['src/foo.ts']);
  });

  it('détecte un renommage-avec-édition vs modification (clé = chemin de base)', () => {
    const rename = `diff --git a/src/old.ts b/src/new.ts\n--- a/src/old.ts\n+++ b/src/new.ts\n@@ -10,3 +10,3 @@\n ctx\n-a\n+b\n`;
    const mod = diffOn('src/old.ts', 10, 3);
    expect(parseDiff(rename).has('src/old.ts')).toBe(true);
    expect(conflictingFiles(rename, mod)).toEqual(['src/old.ts']);
  });

  it('N’EST PAS TROMPÉ PAR UNE PAIRE DE COMMENTAIRES SQL — la conscience de section', () => {
    // En SQL, un commentaire commence par « -- ». Remplacer
    // `-- table des abeilles` par `-- table des ouvrières` produit dans le
    // diff la PAIRE `---` / `+++`, en plein milieu d'un hunk. Sans la
    // conscience de section, le parseur y voit un en-tête de fichier : il
    // ouvre un fichier fantôme et lui rattache tous les hunks suivants. Le
    // conflit sur le vrai fichier devient invisible — un merge annoncé propre.
    //
    // ─── CE QUE LA MUTATION A APPRIS, ET QUI N'ÉTAIT PAS CE QUE JE CHERCHAIS ──
    //
    // Les deux gardes `inHeader` sont MUTUELLEMENT REDONDANTES : retirer celle
    // du « --- » seule, ou celle du « +++ » seule, ne rougit rien — l'autre
    // rattrape, parce que `oldPath` n'est jamais relu ailleurs qu'à un `+++`
    // et que `inHeader` ne redevient vrai qu'à un `diff --git`, qui remet
    // `oldPath` à null. Aucune des deux ne peut donc être défendue seule.
    //
    // Ce qui n'était défendu par RIEN, c'est la paire : retirer les deux
    // survivait à la suite entière (vérifié). C'est cela que ce test tient.
    const d =
      'diff --git a/db/schema.sql b/db/schema.sql\n' +
      '--- a/db/schema.sql\n' +
      '+++ b/db/schema.sql\n' +
      '@@ -10,4 +10,4 @@\n' +
      ' CREATE TABLE abeilles (\n' +
      '--- table des abeilles\n' +
      '+++ table des ouvrières\n' +
      ' );\n' +
      '@@ -40,2 +40,2 @@\n' +
      ' ctx\n';
    const p = parseDiff(d);
    expect([...p.keys()], 'un fichier fantôme est apparu').toEqual(['db/schema.sql']);
    expect(p.get('db/schema.sql')).toEqual([
      { start: 10, end: 13 },
      { start: 40, end: 41 },
    ]);
  });

  it("n'est pas trompé par une ligne de contenu commençant par « ++ »", () => {
    const d = `diff --git a/z.ts b/z.ts\n--- a/z.ts\n+++ b/z.ts\n@@ -1,2 +1,3 @@\n ctx\n+++ build flags\n@@ -20,2 +21,3 @@\n ctx2\n+more\n`;
    const p = parseDiff(d);
    // Aucun fichier fantôme « build flags » ; les deux hunks sous z.ts.
    expect([...p.keys()]).toEqual(['z.ts']);
    expect(p.get('z.ts')).toEqual([
      { start: 1, end: 2 },
      { start: 20, end: 21 },
    ]);
  });
});

describe('buildMergePlan', () => {
  it('ordonne par dépendances et détecte un conflit entre tâches terminées', () => {
    const tasks = [task('a', 'done'), task('b', 'done', ['a'])];
    const diffs = new Map([
      ['a', diffOn('src/app.ts', 10, 6)],
      ['b', diffOn('src/app.ts', 12, 9)],
    ]);
    const plan = buildMergePlan(tasks, diffs);
    expect(plan.order).toEqual(['a', 'b']); // dépendance d'abord
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.file).toBe('src/app.ts');
    expect(plan.mergeable).toBe(false); // conflit
    expect(plan.testsRun).toBe(false);
  });

  it('est intégrable quand tout est terminé et sans conflit', () => {
    const tasks = [task('a', 'done'), task('b', 'done')];
    const diffs = new Map([
      ['a', diffOn('src/a.ts', 1, 3)],
      ['b', diffOn('src/b.ts', 1, 3)],
    ]);
    const plan = buildMergePlan(tasks, diffs);
    expect(plan.conflicts).toEqual([]);
    expect(plan.mergeable).toBe(true);
  });

  it('n’est pas intégrable si des tâches ne sont pas terminées', () => {
    const plan = buildMergePlan([task('a', 'done'), task('b', 'running')], new Map());
    expect(plan.done).toBe(1);
    expect(plan.total).toBe(2);
    expect(plan.mergeable).toBe(false);
  });
});

describe('GET /api/projects/:id/merge (intégration)', () => {
  let server: HiveServer;
  let dir: string;
  let client: HiveNodeClient;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-hc-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 80,
    });
    // Adaptateur qui renvoie un diff conflictuel selon la tâche.
    const adapter: AgentAdapter = {
      name: 'diff',
      async run(t) {
        const diff = t.id === 'hb' ? diffOn('src/app.ts', 12, 9) : diffOn('src/app.ts', 10, 6);
        return { success: true, diff, logs: 'ok', subAgents: [] };
      },
    };
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'ouvriere-hc',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 2,
      workRoot: path.join(dir, 'work'),
      adapter,
      quiet: true,
    });
    client.start();
  });

  afterAll(async () => {
    client.stop();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

  it('remonte le plan de merge avec les conflits réels (et exige le token)', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Merge' }),
      })
    ).json()) as { id: string };
    await fetch(`${base}/api/projects/${project.id}/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tasks: [
          { id: 'ha', title: 'A', prompt: 'p' },
          { id: 'hb', title: 'B', prompt: 'p' },
        ],
      }),
    });

    // Attendre que les deux tâches soient terminées.
    const deadline = Date.now() + 8_000;
    let plan: MergePlan | undefined;
    while (Date.now() < deadline) {
      plan = (await (
        await fetch(`${base}/api/projects/${project.id}/merge`, { headers })
      ).json()) as MergePlan;
      if (plan.done === 2) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(plan?.done).toBe(2);
    expect(plan?.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(plan?.conflicts[0]?.file).toBe('src/app.ts');
    expect(plan?.mergeable).toBe(false);

    const noAuth = await fetch(`${base}/api/projects/${project.id}/merge`, {
      headers: { 'content-type': 'application/json' },
    });
    expect(noAuth.status).toBe(401);
  });
});
