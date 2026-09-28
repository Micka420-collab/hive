// UNE REPRISE CLONE LA BRANCHE DE SA PULL REQUEST — côté ouvrière, contre un
// vrai `git`.
//
// ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
//
// `prepareWorkspace` clonait TOUJOURS la branche par défaut, puis faisait
// `checkout -b hive/<tâche>`. L'ouvrière d'une reprise — « corrigez la CI
// rouge de la PR #N, sur la MÊME branche » — n'avait donc pas le travail de la
// PR sous les yeux : elle corrigeait du code qu'elle ne voyait pas, et son diff
// ne pouvait devenir qu'une seconde pull request, sans le travail d'origine.
//
// Ce banc prouve le contrat inverse : avec `prolonger`, le clone EST la branche
// de la PR, la base épinglée est SA tête, et le diff rendu ne contient que la
// correction — exactement ce que la livraison posera par-dessus
// (`livraison.test.ts`, « une reprise AVANCE la pull request »).
//
// L'amont est cloné par `file://`, pas par son chemin : un chemin nu prend le
// transport LOCAL, qui ignore `--depth 1` (cf. `workflow-git.test.ts`).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareWorkspace } from '../src/node-client/workspace.js';
import { parseServerMessage } from '../src/shared/protocol.js';
import type { Task } from '../src/shared/types.js';

/** Identité et réglages des commits FABRIQUÉS par le banc — rien de la personne. */
const REGLAGES = [
  '-c',
  'user.email=banc@hive.local',
  '-c',
  'user.name=Banc Hive',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
];

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', [...REGLAGES, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

let racine: string;
let url: string;
let teteBranche: string;

/** Une tâche de reprise telle que le Scheduler la réclame : `branch` = la branche de la PR. */
const reprise = (branch: string | null): Task =>
  ({ id: 'r7-banc', title: 'Reprise PR #7', prompt: 'x', branch }) as Task;

beforeAll(() => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-reprise-noeud-'));
  const depot = path.join(racine, 'amont.git');
  const copie = path.join(racine, 'copie');
  git(racine, 'init', '-q', '--bare', depot);
  git(racine, 'init', '-q', copie);
  git(copie, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFileSync(path.join(copie, 'app.txt'), 'socle\n');
  git(copie, 'add', '--all');
  git(copie, 'commit', '-q', '-m', 'socle');
  git(copie, 'push', '-q', depot, 'main');
  // La branche de la PR livrée : le travail d'origine, qui n'est PAS sur main.
  git(copie, 'checkout', '-q', '-b', 'hive/t-origine');
  writeFileSync(path.join(copie, 'travail.txt'), 'travail d’origine\n');
  git(copie, 'add', '--all');
  git(copie, 'commit', '-q', '-m', 'travail d’origine');
  git(copie, 'push', '-q', depot, 'hive/t-origine');
  teteBranche = git(copie, 'rev-parse', 'HEAD').trim();
  url = pathToFileURL(depot).href;
});

afterAll(() => {
  rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('une reprise travaille sur la branche de sa pull request', () => {
  it(
    'LE CLONE EST LA BRANCHE DE LA PR, À SA TÊTE — et le diff ne rend que la correction',
    { timeout: 60_000 },
    async () => {
      const travail = path.join(racine, 'travail');
      mkdirSync(travail, { recursive: true });
      const ws = await prepareWorkspace(travail, reprise('hive/t-origine'), url, [], '', true);
      try {
        expect(ws.branch).toBe('hive/t-origine');
        expect(
          readFileSync(path.join(ws.cwd, 'travail.txt'), 'utf8').replace(/\r\n/g, '\n'),
          'le travail d’origine est sous les yeux de l’ouvrière',
        ).toBe('travail d’origine\n');
        expect(ws.baseSha, 'la base épinglée est la tête de la PR').toBe(teteBranche);

        // La correction, par-dessus le travail d'origine.
        writeFileSync(path.join(ws.cwd, 'travail.txt'), 'travail d’origine\ncorrigé\n');
        const diff = await ws.collectDiff();
        expect(diff).toContain('+corrigé');
        expect(diff, 'le travail d’origine n’est pas rejoué dans le diff').not.toContain(
          '+travail d’origine',
        );
      } finally {
        ws.cleanup();
      }
    },
  );

  it(
    'sans `prolonger`, rien ne change : branche par défaut, puis branche neuve',
    { timeout: 60_000 },
    async () => {
      const travail = path.join(racine, 'travail-ordinaire');
      const tache = { id: 't-ordinaire', title: 't', prompt: 'x', branch: null } as Task;
      const ws = await prepareWorkspace(travail, tache, url);
      try {
        expect(ws.branch).toBe('hive/t-ordinaire');
        expect(existsSync(path.join(ws.cwd, 'travail.txt'))).toBe(false);
      } finally {
        ws.cleanup();
      }
    },
  );

  it('une branche qui n’est pas une branche de la ruche est refusée AVANT tout clone', async () => {
    const travail = path.join(racine, 'travail-refus');
    for (const branche of ['main', '--upload-pack=touch pwned', 'hive/../main', null]) {
      await expect(
        prepareWorkspace(travail, reprise(branche), url, [], '', true),
        String(branche),
      ).rejects.toThrow(/branche de livraison invalide/);
    }
  });

  it('le protocole refuse d’office un `prolonger` qui ne vise pas une branche hive/', () => {
    const message = (branch: string | null, prolonger: unknown): string =>
      JSON.stringify({
        type: 'assign_task',
        task: {
          id: 'r7-banc',
          projectId: 'p',
          title: 't',
          prompt: 'x',
          status: 'assigned',
          dependsOn: [],
          assignedNodeId: 'n',
          result: null,
          branch,
          attempts: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        prolonger,
      });
    expect(parseServerMessage(message('hive/t-origine', true))).toMatchObject({
      prolonger: true,
    });
    expect(parseServerMessage(message('main', true))).toBeNull();
    expect(parseServerMessage(message('-x', true))).toBeNull();
    expect(parseServerMessage(message(null, true))).toBeNull();
    expect(parseServerMessage(message('hive/t-origine', 'oui'))).toBeNull();
    // Sans le drapeau, une tâche ordinaire garde sa forme d'avant.
    expect(parseServerMessage(message('hive/t-origine', undefined))).not.toHaveProperty(
      'prolonger',
    );
  });
});
