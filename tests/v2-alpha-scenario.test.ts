// Scénario V2 Alpha : mission → Workers → contre-revue → retry → Evaluator.
//
// Ce banc protège un contrat d'intégration observable, pas une forme de code :
// une mission doit traverser les mêmes portes qu'en production. Le scénario
// utilise trois HiveNodeClient réels, un clone Git local et les routes REST de
// l'Evaluator. Une régression qui laisse verts l'e2e DAG (adaptateur simulé),
// la contre-revue (WebSocket nu) et la livraison (résultat injecté) séparément
// mais casse leur enchaînement doit rougir ici.
//
// Le faux GitHub est volontairement réduit aux appels de la livraison et de la
// lecture CI. Le scénario vérifie que la production réelle du Worker alimente
// la PR, que la preuve CI vise le résultat exact, et que le merge reste humain.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { simpleGit } from 'simple-git';
import type { AgentAdapter } from '../src/adapters/index.js';
import { runCommand } from '../src/adapters/exec.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Fetcheur } from '../src/orchestrator/github.js';
import { fournisseurParNom, type Fournisseur } from '../src/node-client/isolement.js';

const TOKEN = 'jeton-v2-alpha-suffisamment-long';
const GITHUB_TOKEN = 'jeton-github-v2-alpha-suffisant';
const imageDemandee = process.env.HIVE_ISOLEMENT_IMAGE?.trim() ?? '';

function bacDepuisEnv():
  { fournisseur: Fournisseur; image: string; variables: string[] } | undefined {
  if (!imageDemandee || process.platform === 'win32') return undefined;
  for (const nom of ['podman', 'docker']) {
    try {
      execFileSync(nom, ['--version'], { stdio: 'ignore', timeout: 4_000 });
      execFileSync(nom, ['info'], { stdio: 'ignore', timeout: 8_000 });
      execFileSync(nom, ['image', 'inspect', imageDemandee], {
        stdio: 'ignore',
        timeout: 8_000,
      });
      const fournisseur = fournisseurParNom(nom);
      if (!fournisseur) continue;
      return { fournisseur, image: imageDemandee, variables: [] };
    } catch {
      // L'image est un prérequis explicite du job sandbox ; les jobs ordinaires
      // n'en déclarent pas et continuent donc d'exercer le même scénario hors bac.
    }
  }
  return undefined;
}

type GithubFixture = {
  requests: string[];
  branch: string | null;
  commitSha: string;
};

type Scenario = {
  server: HiveServer;
  clients: HiveNodeClient[];
  githubApi: HttpServer;
  root: string;
  repo: string;
};

async function attendre(
  predicate: () => boolean,
  message: string,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  expect(predicate(), message).toBe(true);
}

async function depotFixture(root: string): Promise<string> {
  const repo = path.join(root, 'repo');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'feature.js'), 'export const secure = false;\n');
  writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify(
      {
        name: 'hive-v2-alpha-fixture',
        scripts: {
          test: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  );
  const git = simpleGit({ baseDir: repo });
  await git.init();
  await git.addConfig('user.email', 'hive-v2-alpha@example.test');
  await git.addConfig('user.name', 'Hive V2 Alpha');
  await git.addConfig('commit.gpgsign', 'false');
  await git.add('.');
  await git.commit('fixture');
  return repo;
}

function githubFixture(): { fixture: GithubFixture; fetcher: Fetcheur } {
  const fixture: GithubFixture = { requests: [], branch: null, commitSha: 'commit-v2-alpha' };
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const fetcher: Fetcheur = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    const method = String(init?.method ?? 'GET').toUpperCase();
    fixture.requests.push(`${method} ${url.pathname}${url.search}`);
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
      return json({ object: { sha: 'base-v2-alpha' } });
    }
    if (method === 'GET' && url.pathname.includes('/contents/')) {
      if (url.pathname.endsWith('/src/feature.js')) {
        return json({
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('export const secure = false;\n').toString('base64'),
        });
      }
      return json({ message: 'Not Found' }, 404);
    }
    if (method === 'POST' && url.pathname.endsWith('/git/blobs'))
      return json({ sha: 'blob-v2-alpha' }, 201);
    if (method === 'POST' && url.pathname.endsWith('/git/trees'))
      return json({ sha: 'tree-v2-alpha' }, 201);
    if (method === 'POST' && url.pathname.endsWith('/git/commits')) {
      fixture.commitSha = 'commit-v2-alpha';
      return json({ sha: fixture.commitSha }, 201);
    }
    if (method === 'POST' && url.pathname.endsWith('/git/refs')) {
      const ref = typeof body.ref === 'string' ? body.ref : '';
      fixture.branch = ref.replace(/^refs\/heads\//, '') || null;
      return json({ ref });
    }
    if (method === 'POST' && url.pathname.endsWith('/pulls')) {
      fixture.branch = typeof body.head === 'string' ? body.head : fixture.branch;
      return json({ number: 7, html_url: 'https://github.com/demo/hive/pull/7' }, 201);
    }
    if (method === 'GET' && /\/pulls\/7$/.test(url.pathname)) {
      return json({
        state: 'open',
        merged: false,
        mergeable: true,
        head: { ref: fixture.branch, sha: fixture.commitSha },
      });
    }
    if (method === 'GET' && url.pathname.endsWith(`/commits/${fixture.commitSha}/check-runs`)) {
      return json({
        check_runs: ['Tests', 'Typecheck', 'Build', 'Lint'].map((name) => ({
          name,
          status: 'completed',
          conclusion: 'success',
          html_url: `https://github.com/demo/hive/actions/${name.toLowerCase()}`,
        })),
      });
    }
    if (method === 'GET' && /\/pulls\/7\/reviews$/.test(url.pathname)) return json([]);
    return json({ message: `Unhandled fake GitHub request: ${method} ${url.pathname}` }, 404);
  };
  return { fixture, fetcher };
}

async function startGithubApi(fetcher: Fetcheur): Promise<{ server: HttpServer; url: string }> {
  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', async () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const result = await fetcher(`http://github-fixture${request.url ?? '/'}`, {
          method: request.method ?? 'GET',
          ...(body ? { body } : {}),
        });
        response.writeHead(result.status, {
          'content-type': result.headers.get('content-type') ?? 'application/json',
        });
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('faux GitHub sans port');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function workerAdapter(reviews: Map<string, number>, agentType: string): AgentAdapter {
  return {
    name: 'v2-alpha-fixture-worker',
    async run(task, ctx) {
      if (task.title === 'Sécuriser feature.js' && ctx.delegate && ctx.waitForDelegationResult) {
        const childTaskId = `${task.id}-delegated-security`;
        const admitted = await ctx.delegate({
          childTaskId,
          reason: 'faire vérifier la sécurité par un Worker indépendant',
          title: 'Vérification sécurité déléguée',
          prompt: 'Vérifie les chemins sensibles et rends un résultat terminal.',
          durationMs: 60_000,
          costMicros: 100_000,
          resourceUnits: 1,
          preferredAgent: 'codex',
          preferredModel: 'codex-review-model',
        });
        if (!admitted.ok) {
          return {
            success: false,
            diff: '',
            logs: `delegation refused: ${admitted.code}`,
            subAgents: [],
          };
        }
        const child = await ctx.waitForDelegationResult(childTaskId);
        if (!child.ok || !child.success) {
          return {
            success: false,
            diff: '',
            logs: child.ok ? 'delegated security check failed' : `delegation failed: ${child.code}`,
            subAgents: [],
          };
        }
      }
      if (task.title.startsWith('Contre-expertise —')) {
        const reviewKey = `${agentType}:${task.title}`;
        const calls = (reviews.get(reviewKey) ?? 0) + 1;
        reviews.set(reviewKey, calls);
        // Un premier avis conteste la production. Les avis de la seconde
        // production sont favorables : c'est le trajet correction → retry.
        const avis =
          calls === 1 && agentType === 'hermes-agent'
            ? 'conteste\n- ajoute un test du chemin sécurisé'
            : 'valide';
        const execution = await runCommand('node', ['-e', 'process.exit(0)'], ctx, 30_000);
        return { ...execution, logs: avis, subAgents: [] };
      }

      const body = 'export const secure = true;\n';
      if (agentType === 'claude-code') {
        // Laisser le temps aux deux relecteurs de rejoindre la ruche après que
        // le producteur a été choisi, sans dépendre de l'ordre des sockets.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const test =
        "import { secure } from './feature.js';\nif (!secure) throw new Error('insecure');\n";
      const script = [
        "const fs = require('node:fs');",
        `fs.writeFileSync('src/feature.js', ${JSON.stringify(body)});`,
        ...(ctx.attempt > 1
          ? [`fs.writeFileSync('src/feature.test.js', ${JSON.stringify(test)});`]
          : []),
      ].join('');
      const execution = await runCommand('node', ['-e', script], ctx, 30_000);
      return { ...execution, logs: `production attempt ${ctx.attempt}`, subAgents: [] };
    },
  };
}

describe('V2 Alpha — mission locale vérifiable', () => {
  let scenario: Scenario | null = null;
  let previousHome: string | undefined;
  let previousGitConfigGlobal: string | undefined;
  let previousGithubToken: string | undefined;
  let previousGithubApi: string | undefined;

  afterEach(async () => {
    for (const client of scenario?.clients ?? []) client.stop();
    await scenario?.server.stop();
    await new Promise<void>((resolve) => {
      if (!scenario?.githubApi) {
        resolve();
        return;
      }
      scenario.githubApi.close(() => resolve());
    });
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal;
    if (previousGithubToken === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = previousGithubToken;
    if (previousGithubApi === undefined) delete process.env.HIVE_GITHUB_API;
    else process.env.HIVE_GITHUB_API = previousGithubApi;
    if (scenario) rmSync(scenario.root, { recursive: true, force: true, maxRetries: 3 });
    scenario = null;
    previousHome = undefined;
    previousGitConfigGlobal = undefined;
    previousGithubToken = undefined;
    previousGithubApi = undefined;
  });

  it(
    'exécute une production réelle, corrige après contre-revue et rend les preuves Git/CI lisibles',
    { timeout: 90_000 },
    async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'hive-v2-alpha-'));
      const repo = await depotFixture(root);
      const gitHome = path.join(root, 'git-home');
      mkdirSync(gitHome, { recursive: true });
      writeFileSync(
        path.join(gitHome, '.gitconfig'),
        `[url "${pathToFileURL(repo).href}"]\n\tinsteadOf = https://github.com/demo/hive.git\n`,
      );
      previousHome = process.env.HOME;
      previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
      previousGithubToken = process.env.HIVE_GITHUB_TOKEN;
      process.env.HOME = gitHome;
      // Git for Windows may resolve the global config from USERPROFILE even
      // when HOME is overridden. Pinning the fixture config makes the local
      // URL rewrite deterministic on every runner without changing production
      // process environment handling.
      process.env.GIT_CONFIG_GLOBAL = path.join(gitHome, '.gitconfig');
      process.env.HIVE_GITHUB_TOKEN = GITHUB_TOKEN;
      const reviews = new Map<string, number>();
      const bac = bacDepuisEnv();
      if (imageDemandee && !bac) {
        throw new Error(`HIVE_ISOLEMENT_IMAGE=${imageDemandee} exige un runtime Docker/Podman`);
      }
      const github = githubFixture();
      const githubApi = await startGithubApi(github.fetcher);
      previousGithubApi = process.env.HIVE_GITHUB_API;
      process.env.HIVE_GITHUB_API = githubApi.url;
      const server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(root, 'hive.db'),
        simulation: false,
        tickMs: 20,
        githubFetcher: github.fetcher,
      });
      const runningClients: HiveNodeClient[] = [];
      const startClient = (name: string, agentType: string): void => {
        const client = new HiveNodeClient({
          url: `ws://127.0.0.1:${server.port}/ws`,
          token: TOKEN,
          name,
          ownerName: 'v2-alpha',
          agentType,
          nodeId: `v2-${agentType}`,
          modeles: [`${agentType}-model`],
          maxConcurrency: 2,
          workRoot: path.join(root, name),
          adapter: workerAdapter(reviews, agentType),
          quiet: true,
          ...(bac ? { bac } : {}),
        });
        client.start();
        runningClients.push(client);
      };
      scenario = { server, clients: runningClients, githubApi: githubApi.server, root, repo };
      startClient('producteur', 'claude-code');

      await attendre(
        () => server.store.listNodes().some((node) => node.id === 'v2-claude-code'),
        'le Worker producteur ne rejoint pas la ruche',
      );

      const project = server.store.createProject({
        name: 'V2 Alpha',
        repoUrl: 'https://github.com/demo/hive.git',
      });
      const task = server.store.createTask({
        projectId: project.id,
        title: 'Sécuriser feature.js',
        prompt: 'remplacer le garde insecure et ajouter le test correspondant',
      });
      server.store.patchTask(task.id, { status: 'ready' });

      await attendre(
        () => server.store.getTask(task.id)?.assignedNodeId === 'v2-claude-code',
        'la tâche n’est pas affectée au Worker producteur',
      );
      startClient('relecteur-codex', 'codex');
      startClient('relecteur-hermes', 'hermes-agent');
      await attendre(
        () => server.store.listNodes().filter((node) => node.status === 'online').length === 3,
        'les trois Workers ne sont pas en ligne',
      );

      await attendre(
        () => server.store.getTask(task.id)?.status === 'done',
        'la production Worker n’est pas terminée',
      );
      const first = server.store.resultsForTask(task.id).at(-1);
      expect(first?.success).toBe(true);
      expect(first?.diff).toContain('secure = true');
      expect(first?.diff).toContain('secure = false');
      expect(first?.nodeId).toBeTruthy();
      expect(first?.usage).toMatchObject({
        userCpuMicros: expect.any(Number),
        systemCpuMicros: expect.any(Number),
        maxRssBytes: expect.any(Number),
        rssBytes: expect.any(Number),
        heapUsedBytes: expect.any(Number),
      });
      expect(
        server.store
          .listEvents()
          .some(
            (event) => event.type === 'worker_usage' && event.payload.resultId === first?.resultId,
          ),
      ).toBe(true);

      await attendre(
        () =>
          server.store
            .listEvents()
            .filter(
              (event) =>
                event.type === 'contre_expertise_verdict' && event.payload.taskId === task.id,
            ).length >= 2,
        'les deux modèles de contre-revue n’ont pas répondu',
      );
      const firstReview = server.store.crossReviewForResult(task.id, first?.resultId ?? -1);
      expect(firstReview).toMatchObject({
        status: 'improvement_required',
        contestingReviewers: 1,
        approvingReviewers: 1,
      });

      const base = `http://127.0.0.1:${server.port}`;
      const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
      const firstEvaluation = await fetch(`${base}/api/tasks/${task.id}/evaluation`, { headers });
      expect(firstEvaluation.status).toBe(200);
      expect((await firstEvaluation.json()).decision).toBe('correction_required');

      // La contre-revue complète déclenche elle-même le retry borné. La revue
      // humaine reste réservée à la production suivante : une fois la tâche
      // réenfilée, le serveur refuse naturellement un verdict sur le travail
      // encore en cours.
      await attendre(
        () =>
          server.store
            .listEvents()
            .some(
              (event) =>
                event.type === 'task_retry' &&
                event.payload.source === 'evaluator' &&
                event.payload.taskId === task.id &&
                event.payload.resultId === first?.resultId,
            ),
        'la contre-revue insuffisante n’a pas déclenché le retry automatique',
      );

      await attendre(
        () => server.store.resultsForTask(task.id).length >= 2,
        'le retry Evaluator n’a pas produit une seconde tentative',
      );
      const second = server.store.resultsForTask(task.id).at(-1);
      expect(second?.resultId).not.toBe(first?.resultId);
      expect(second?.diff, second?.logs).toContain('secure = true');

      await attendre(
        () =>
          server.store
            .listEvents()
            .filter(
              (event) =>
                event.type === 'contre_expertise_verdict' &&
                event.payload.taskId === task.id &&
                event.payload.resultId === second?.resultId,
            ).length >= 2,
        'la seconde production n’a pas reçu ses contre-revues exactes',
      );
      const secondReview = server.store.crossReviewForResult(task.id, second?.resultId ?? -1);
      expect(secondReview).toMatchObject({
        status: 'applied',
        contestingReviewers: 0,
        approvingReviewers: 2,
      });

      const secondBeforeApproval = await fetch(`${base}/api/tasks/${task.id}/evaluation`, {
        headers,
      });
      expect(secondBeforeApproval.status).toBe(200);
      expect((await secondBeforeApproval.json()).evidence.humanReview).toBe('missing');
      expect(
        server.store
          .listEvents()
          .filter(
            (event) =>
              event.type === 'task_retry' &&
              event.payload.source === 'evaluator' &&
              event.payload.taskId === task.id &&
              event.payload.resultId === second?.resultId,
          ),
      ).toHaveLength(0);

      const approved = await fetch(`${base}/api/tasks/${task.id}/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ state: 'approved', clientId: 'v2-alpha' }),
      });
      expect(approved.status).toBe(200);

      const delivery = await fetch(`${base}/api/livraison`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId: task.id }),
      });
      expect(delivery.status, await delivery.clone().text()).toBe(201);
      expect(await delivery.json()).toMatchObject({
        pr: 7,
        branche: `hive/${task.id}`,
        commitSha: 'commit-v2-alpha',
      });

      const ci = await fetch(`${base}/api/tasks/${task.id}/evaluation/ci`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ resultId: second?.resultId }),
      });
      expect(ci.status).toBe(200);
      expect(await ci.json()).toMatchObject({
        resultId: second?.resultId,
        validation: { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
        provenance: {
          source: 'github_pull_request',
          branch: `hive/${task.id}`,
          commitSha: 'commit-v2-alpha',
        },
      });

      const final = await fetch(`${base}/api/tasks/${task.id}/evaluation`, { headers });
      expect(final.status).toBe(200);
      const evaluation = (await final.json()) as {
        decision: string;
        canMerge: boolean;
        evidence: {
          result: string;
          consensus: string;
          crossReview: { resultId: number | null; status: string };
          humanReview: string;
          tests: string;
          typecheck: string;
          build: string;
          lint: string;
          validationProvenance: {
            source: string;
            resultId: number | null;
            branch: string | null;
            commitSha: string | null;
          };
        };
      };
      expect(evaluation).toMatchObject({
        decision: 'human_review_required',
        canMerge: false,
      });
      expect(evaluation.evidence.crossReview).toMatchObject({
        resultId: second?.resultId,
        status: 'applied',
      });
      expect(evaluation.evidence.humanReview).toBe('approved');
      expect(evaluation.evidence).toMatchObject({
        tests: 'passed',
        typecheck: 'passed',
        build: 'passed',
        lint: 'passed',
      });
      expect(evaluation.evidence.validationProvenance).toMatchObject({
        source: 'github_pull_request',
        resultId: second?.resultId,
        branch: `hive/${task.id}`,
        commitSha: 'commit-v2-alpha',
      });
      // Le Parlement garde un quorum de deux sorties identiques. Après un
      // retry correctif, deux diffs différents restent honnêtement sans
      // quorum : l'Evaluator demande donc encore les contrôles externes.
      expect(evaluation.evidence.consensus).toBe('no_quorum');
      expect(evaluation.evidence.result).toBe('passed');

      expect(
        github.fixture.requests.some((request) =>
          request.startsWith('POST /repos/demo/hive/pulls'),
        ),
      ).toBe(true);
      expect(
        github.fixture.requests.some((request) =>
          request.startsWith('GET /repos/demo/hive/commits/commit-v2-alpha/check-runs'),
        ),
      ).toBe(true);

      const delegationResponse = await fetch(`${base}/api/tasks/${task.id}/delegation`, {
        headers,
      });
      expect(delegationResponse.status).toBe(200);
      const delegation = (await delegationResponse.json()) as {
        graph: Array<{
          taskId: string;
          parentTaskId: string | null;
          depth: number;
          status: string;
        }>;
        events: Array<{ type: string; payload: Record<string, unknown> }>;
      };
      const delegatedTaskId = `${task.id}-delegated-security`;
      expect(delegation.graph).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taskId: task.id,
            parentTaskId: null,
            depth: 0,
          }),
          expect.objectContaining({
            taskId: delegatedTaskId,
            parentTaskId: task.id,
            depth: 1,
            status: 'done',
          }),
        ]),
      );
      expect(delegation.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'delegation_created',
            payload: expect.objectContaining({
              parentTaskId: task.id,
              childTaskId: delegatedTaskId,
              reason: 'faire vérifier la sécurité par un Worker indépendant',
            }),
          }),
          expect.objectContaining({
            type: 'delegation_result',
            payload: expect.objectContaining({
              parentTaskId: task.id,
              childTaskId: delegatedTaskId,
              success: true,
              durationMs: expect.any(Number),
            }),
          }),
        ]),
      );
      // Une PR ouverte et validée reste en attente du geste humain explicite.
      expect(github.fixture.requests.some((request) => request.startsWith('PUT '))).toBe(false);

      // Le dépôt original reste inchangé : la production vit dans le clone
      // isolé du Worker. Le scénario n'affirme pas une sandbox conteneur : ce
      // niveau est couvert séparément par les tests d'isolement Docker/Podman.
      expect(readFileSync(path.join(repo, 'src', 'feature.js'), 'utf8')).toContain(
        'secure = false',
      );
    },
  );
});
