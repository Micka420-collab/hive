import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { runCommand } from '../src/adapters/exec.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import {
  fournisseurParNom,
  IMAGE_DEFAUT,
  sonderAgentDansBac,
  type Fournisseur,
} from '../src/node-client/isolement.js';
import { createServer } from '../src/orchestrator/server.js';

const imageDemandee = process.env.HIVE_ISOLEMENT_IMAGE?.trim() || '';

function runtimeDisponible(): Fournisseur | null {
  // Docker Desktop on the hosted Windows runner exposes the CLI but does not
  // provide a bind mount compatible with this Linux-container probe. Keep the
  // real integration lane active on Unix hosts and report Windows as
  // unavailable instead of turning infrastructure limits into a false failure.
  if (process.platform === 'win32') return null;
  for (const nom of ['podman', 'docker']) {
    try {
      execFileSync(nom, ['--version'], { stdio: 'ignore', timeout: 4_000 });
      execFileSync(nom, ['info'], { stdio: 'ignore', timeout: 8_000 });
      if (imageDemandee) {
        // Docker et Podman ont généralement des magasins distincts. Quand la
        // CI fournit une image déjà construite, retenir un moteur qui ne la
        // possède pas transformerait un problème de sélection en faux échec
        // « agent absent ».
        execFileSync(nom, ['image', 'inspect', imageDemandee], {
          stdio: 'ignore',
          timeout: 8_000,
        });
      }
      return fournisseurParNom(nom);
    } catch {
      // Le test reste conditionnel : une CI sans runtime ne doit pas inventer
      // un résultat d'intégration qu'elle n'a pas exécuté.
    }
  }
  return null;
}

const runtime = runtimeDisponible();

describe('isolement — intégration runtime réel', () => {
  it.skipIf(!runtime && !imageDemandee)(
    'exécute réellement le preflight dans Docker/Podman',
    async () => {
      expect(runtime, 'HIVE_ISOLEMENT_IMAGE exige un runtime Docker/Podman actif').not.toBeNull();

      // Le chemin par défaut vérifie le contrat minimal de l’image Node. La
      // jambe CI qui construit l’image agent-aware pose HIVE_ISOLEMENT_IMAGE :
      // elle exerce alors les vrais binaires que le Worker lancera, pas une
      // simple commande `docker run` indépendante de Hive. Chaque CLI intégré
      // à `docker/agents/Dockerfile` doit figurer ici : c'est ce preflight
      // durci (racine en lecture seule, /tmp noexec, uid non privilégié) qui
      // prouve qu'un Worker pourra réellement le lancer.
      const image = imageDemandee || IMAGE_DEFAUT;
      const binaires = imageDemandee ? ['claude', 'codex', 'cline'] : ['node'];
      for (const binaire of binaires) {
        const resultat = await sonderAgentDansBac(runtime!, binaire, image);
        expect(resultat.executable, `${binaire} dans ${image}: ${resultat.motif}`).toBe(true);
      }

      const absent = await sonderAgentDansBac(runtime!, 'hive-agent-inexistant', image);
      expect(absent.executable).toBe(false);
    },
    120_000,
  );

  it.skipIf(!runtime || !imageDemandee)(
    'exécute une commande réelle dans le seul workspace monté',
    async () => {
      // Ce test ne lance pas un modèle payant : il exerce le même chemin
      // d'exécution avec Node présent dans l'image agent-aware. La preuve
      // utile est l'enveloppe réelle (volume unique, HOME éphémère, aucune
      // variable de secret implicite), pas un faux résultat d'adaptateur.
      if (!runtime || !imageDemandee) return;
      const root = mkdtempSync(path.join(os.tmpdir(), 'hive-sandbox-runtime-'));
      const workspace = path.join(root, 'workspace');
      const secretPath = path.join(root, 'outside-secret.txt');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(secretPath, 'ne doit jamais être visible dans le conteneur\n');
      try {
        const probe = await runCommand(
          'node',
          [
            '-e',
            [
              "const fs = require('node:fs');",
              "const result = { cwd: process.cwd(), home: process.env.HOME, outside: fs.existsSync(process.env.HOST_SECRET_PATH ?? ''), token: process.env.HIVE_TOKEN ?? null };",
              "fs.writeFileSync('/hive/tache/probe.json', JSON.stringify(result));",
            ].join(''),
          ],
          {
            cwd: workspace,
            env: { PATH: process.env.PATH, HOST_SECRET_PATH: secretPath },
            attempt: 1,
            signal: new AbortController().signal,
            onProgress: () => {},
            bac: {
              fournisseur: runtime,
              image: imageDemandee,
              variables: ['HOST_SECRET_PATH'],
            },
          },
        );
        expect(probe.success, probe.logs).toBe(true);
        const result = JSON.parse(readFileSync(path.join(workspace, 'probe.json'), 'utf8')) as {
          cwd: string;
          home: string;
          outside: boolean;
          token: string | null;
        };
        expect(result).toEqual({
          cwd: '/hive/tache',
          home: '/tmp/hive-home',
          outside: false,
          token: null,
        });
        expect(readFileSync(secretPath, 'utf8')).toContain('ne doit jamais être visible');
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      }
    },
    120_000,
  );

  it.skipIf(!runtime || !imageDemandee)(
    'fait traverser le bac réel au chemin Worker → tâche',
    async () => {
      // Le test précédent prouve l'enveloppe `runCommand` seule. Celui-ci
      // garde une frontière supplémentaire : la tâche est assignée par un
      // orchestrateur réel à un `HiveNodeClient`, puis l'adaptateur reçoit le
      // contexte préparé par `runTask`. Une régression qui oublierait de
      // transmettre `opts.bac` au chemin Worker resterait verte autrement.
      if (!runtime || !imageDemandee) return;
      const root = mkdtempSync(path.join(os.tmpdir(), 'hive-sandbox-worker-'));
      const secretPath = path.join(root, 'outside-secret.txt');
      writeFileSync(secretPath, 'ne doit jamais être visible dans le conteneur\n');
      const token = 'jeton-sandbox-worker-suffisamment-long';
      const server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(root, 'hive.db'),
        simulation: false,
        tickMs: 20,
      });

      const adapter: AgentAdapter = {
        name: 'sandbox-worker-probe',
        async run(_task, ctx) {
          // Cette variable est ajoutée au contexte déjà épuré du Worker. Le
          // bac ne transmet que son NOM, puis le conteneur résout la valeur
          // depuis l'environnement du processus parent.
          ctx.env.HOST_SECRET_PATH = secretPath;
          const probe = await runCommand(
            'node',
            [
              '-e',
              [
                "const fs = require('node:fs');",
                "const result = { cwd: process.cwd(), home: process.env.HOME, outside: fs.existsSync(process.env.HOST_SECRET_PATH ?? ''), token: process.env.HIVE_TOKEN ?? null };",
                "fs.writeFileSync('/hive/tache/worker-proof.json', JSON.stringify(result));",
              ].join(''),
            ],
            ctx,
            30_000,
          );
          if (!probe.success) return probe;
          const preuve = JSON.parse(
            readFileSync(path.join(ctx.cwd, 'worker-proof.json'), 'utf8'),
          ) as {
            cwd: string;
            home: string;
            outside: boolean;
            token: string | null;
          };
          return { ...probe, logs: JSON.stringify(preuve), subAgents: [] };
        },
      };
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token,
        name: 'worker-sandbox-reel',
        ownerName: 'integration',
        agentType: 'custom',
        nodeId: 'worker-sandbox-reel',
        maxConcurrency: 1,
        workRoot: path.join(root, 'work'),
        adapter,
        quiet: true,
        bac: { fournisseur: runtime, image: imageDemandee, variables: ['HOST_SECRET_PATH'] },
      });
      client.start();

      const attendre = async (condition: () => boolean, message: string): Promise<void> => {
        const limite = Date.now() + 30_000;
        while (Date.now() < limite) {
          if (condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(message);
      };

      try {
        await attendre(
          () => server.store.listNodes().some((node) => node.id === 'worker-sandbox-reel'),
          'le Worker réel ne rejoint pas la ruche',
        );
        const project = server.store.createProject({ name: 'Mission sandbox réelle' });
        const task = server.store.createTask({
          projectId: project.id,
          title: 'Prouver le bac du Worker',
          prompt: 'écrire la preuve du contexte d’exécution',
        });
        server.store.patchTask(task.id, { status: 'ready' });
        await attendre(
          () => server.store.getTask(task.id)?.status === 'done',
          'la tâche Worker sandbox ne se termine pas',
        );

        const result = server.store.resultsForTask(task.id).at(-1);
        expect(result?.success, result?.logs).toBe(true);
        const preuve = JSON.parse(result?.logs ?? '{}') as {
          cwd: string;
          home: string;
          outside: boolean;
          token: string | null;
        };
        expect(preuve).toEqual({
          cwd: '/hive/tache',
          home: '/tmp/hive-home',
          outside: false,
          token: null,
        });
        expect(readFileSync(secretPath, 'utf8')).toContain('ne doit jamais être visible');

        // Le verdict doit relire la production réellement persistée, tout en
        // refusant honnêtement de l'accepter tant que les preuves
        // indépendantes (tests, quorum et contre-revue) n'existent pas.
        const evaluationResponse = await fetch(
          `http://127.0.0.1:${server.port}/api/tasks/${task.id}/evaluation`,
          { headers: { 'x-hive-token': token } },
        );
        expect(evaluationResponse.status).toBe(200);
        const evaluation = (await evaluationResponse.json()) as {
          taskId: string;
          decision: string;
          canMerge: boolean;
          retryRecommended: boolean;
          evidence: {
            result: string;
            gardiennes: string;
            consensus: string;
            tests: string;
            crossReview: { status: string; resultId: number | null };
          };
        };
        expect(evaluation).toMatchObject({
          taskId: task.id,
          decision: 'additional_test_required',
          canMerge: false,
          retryRecommended: false,
        });
        expect(evaluation.evidence).toMatchObject({
          result: 'passed',
          gardiennes: 'clean',
          consensus: 'no_quorum',
          tests: 'missing',
          crossReview: { status: 'missing', resultId: result?.resultId },
        });
      } finally {
        client.stop();
        await server.stop();
        rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      }
    },
    120_000,
  );
});
