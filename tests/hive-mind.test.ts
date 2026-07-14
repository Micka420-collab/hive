// Tests unitaires pour Hive Mind — mémoire partagée de la ruche.

import Database from 'better-sqlite3';
import { describe, expect, test, beforeEach } from 'vitest';
import { HiveMind } from '../src/orchestrator/hive-mind.js';
import type { Task } from '../src/shared/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'T1',
    projectId: 'P1',
    title: 'Initialiser le projet',
    prompt: 'Cree une API REST avec Fastify',
    status: 'done',
    branch: 'hive/T1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    dependsOn: [],
    attempts: 1,
    ...overrides,
  } as Task;
}

describe('HiveMind', () => {
  let db: Database.Database;
  let hm: HiveMind;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    hm = new HiveMind(db);
  });

  test('insert et search par keywords', () => {
    hm.insert({
      projectId: 'P1',
      taskId: 'T1',
      taskTitle: 'API REST',
      kind: 'pattern',
      title: 'Toujours valider les entrees',
      content: 'Utiliser JSON Schema pour valider tous les endpoints.',
      keywords: 'validation, schema, fastify, api',
    });

    const results = hm.search('validation schema', 'P1', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.title).toBe('Toujours valider les entrees');
    expect(results[0]!.kind).toBe('pattern');
  });

  test('search respecte isolation projet', () => {
    hm.insert({
      projectId: 'P1',
      taskId: 'T1',
      taskTitle: 'Frontend',
      kind: 'lesson',
      title: 'Pas de CSS inline',
      content: 'Modules CSS plutot que style inline.',
      keywords: 'css, style',
    });
    hm.insert({
      projectId: 'P2',
      taskId: 'T10',
      taskTitle: 'Backend',
      kind: 'lesson',
      title: 'Toujours paginer',
      content: 'GET sans pagination explose en prod.',
      keywords: 'api, pagination',
    });

    const p1 = hm.search('css', 'P1', 10);
    expect(p1.length).toBeGreaterThanOrEqual(1);
    expect(p1[0]!.title).toBe('Pas de CSS inline');

    const p2 = hm.search('pagination', 'P2', 10);
    expect(p2.length).toBeGreaterThanOrEqual(1);
    expect(p2[0]!.title).toBe('Toujours paginer');

    const p2css = hm.search('css', 'P2', 10);
    expect(p2css.length).toBe(0);
  });

  test('buildContext injecte entete Hive Mind', () => {
    hm.insert({
      projectId: 'P1',
      taskId: 'T1',
      taskTitle: 'Auth JWT',
      kind: 'pattern',
      title: 'Secret dans .env',
      content: 'Jamais de secret en dur dans le code.',
      keywords: 'secret, env, jwt',
    });

    // Debug: verifier chaque etape
    const byKeyword = hm.search('secret', 'P1');
    expect(byKeyword.length, 'search secret').toBeGreaterThanOrEqual(1);

    const relevant = hm.relevantForTask({ projectId: 'P1', title: 'Gerer les secrets JWT', prompt: 'Configurer les secrets' });
    expect(relevant.length, 'relevantForTask').toBeGreaterThanOrEqual(1);

    const ctx = hm.buildContext({ projectId: 'P1', title: 'Gerer les secrets JWT', prompt: 'Configurer les secrets' }, 5);

    expect(ctx).not.toBeNull();
    expect(ctx!).toContain('Hive Mind');
    expect(ctx!).toContain('Secret dans .env');
  });

  test('buildContext retourne null si rien pertinent', () => {
    const task = makeTask({ projectId: 'P99', title: 'Faire le menage' });
    const ctx = hm.buildContext(task, 5);
    expect(ctx).toBeNull();
  });

  test('ingestFromTask extrait patterns de diff', () => {
    const task = makeTask({ projectId: 'P1' });
    const diff =
      '+const API_KEY=process.env.API_KEY;\n' +
      '+// Toujours utiliser .env pour les secrets\n' +
      '+import { validatePayload } from \'../shared/schema.js\';\n' +
      '-const dbPassword = \'admin123\';';

    const count = hm.ingestFromTask(task, diff, 'Build OK');
    expect(count).toBeGreaterThan(0);

    const results = hm.search('.env', 'P1', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.content.includes('secret'))).toBe(true);
  });

  test('ingestFromTask gere logs erreur', () => {
    const task = makeTask({ projectId: 'P1' });
    const logs =
      "Error: Cannot find module './database'\\n" +
      '  at install better-sqlite3\\n' +
      '  Fix: npm install --save better-sqlite3';

    const count = hm.ingestFromTask(task, '', logs);
    expect(count).toBeGreaterThan(0);

    const results = hm.search('module', 'P1', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.content.includes('Error'))).toBe(true);
  });

  test('count et listRecent', () => {
    hm.insert({ projectId: 'P1', taskId: 'T1', taskTitle: 't1', kind: 'pattern', title: 'a', content: 'aa', keywords: 'x' }, 1000);
    hm.insert({ projectId: 'P1', taskId: 'T2', taskTitle: 't2', kind: 'lesson', title: 'b', content: 'bb', keywords: 'y' }, 2000);
    hm.insert({ projectId: 'P1', taskId: 'T3', taskTitle: 't3', kind: 'snippet', title: 'c', content: 'cc', keywords: 'z' }, 3000);

    expect(hm.count('P1')).toBe(3);
    expect(hm.listRecent('P1', 10).length).toBe(3);
    // Plus recent (timestamp eleve) en premier
    expect(hm.listRecent('P1', 10)[0]!.kind).toBe('snippet');
  });

  test('rank plus eleve pour matchs exacts', () => {
    hm.insert({ projectId: 'P1', taskId: 'T1', taskTitle: 'Auth', kind: 'pattern', title: 'JWT', content: 'Utiliser JWT avec RS256.', keywords: 'jwt, auth, rs256' });
    hm.insert({ projectId: 'P1', taskId: 'T2', taskTitle: 'Config', kind: 'note', title: 'Docker', content: 'Exposer port 3000 dans Dockerfile.', keywords: 'docker, port' });

    const jwtR = hm.search('JWT', 'P1', 10);
    // FTS5 rank est negatif — plus proche de 0 = plus pertinent
    expect(jwtR[0]!.rank).toBeGreaterThan(-0.1);
    expect(jwtR[0]!.title).toBe('JWT');

    const dockerR = hm.search('Dockerfile port', 'P1', 10);
    expect(dockerR[0]!.title).toBe('Docker');
  });

  test('listRecent respecte limite', () => {
    for (let i = 0; i < 15; i++) {
      hm.insert({ projectId: 'P1', taskId: 'T1', taskTitle: 't', kind: 'note', title: `Memo ${i}`, content: `contenu ${i}`, keywords: 'test' });
    }
    expect(hm.listRecent('P1', 5).length).toBe(5);
    expect(hm.listRecent('P1', 20).length).toBe(15);
  });
});