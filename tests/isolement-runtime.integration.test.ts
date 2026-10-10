import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { HIVE_DELEGATE_TOOL, HIVE_WAIT_TOOL } from '../src/adapters/delegation-bridge.js';
import type { AgentAdapter } from '../src/adapters/index.js';
import { runCommand } from '../src/adapters/exec.js';
import { agentCredentialEnv } from '../src/node-client/agent-detect.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import {
  COMMANDE_IMAGE,
  envelopper,
  ETIQUETTE_NOEUD,
  fournisseurParNom,
  IMAGE_DEFAUT,
  preparerImage,
  ramasserConteneurs,
  sonderAgentDansBac,
  type Fournisseur,
} from '../src/node-client/isolement.js';
import { buildSandboxEnv } from '../src/node-client/workspace.js';
import { preparerBac } from '../src/node-client/bac.js';
import { poserRegistre } from '../src/node-client/git-hote.js';
import { validerProduction } from '../src/node-client/validations-bac.js';
import { createServer } from '../src/orchestrator/server.js';
import { FAUX_CLAUDE_MCP } from './aide/faux-claude-mcp.js';

const imageDemandee = process.env.HIVE_ISOLEMENT_IMAGE?.trim() || '';
/**
 * Sélecteur RÉSERVÉ AUX BANCS : le job image de la CI passe ce fichier une fois
 * par moteur (`HIVE_TEST_MOTEUR=docker`, puis `podman`). Sans lui, un runner qui
 * a l'image dans les deux magasins n'exercerait jamais que le premier — c'est
 * ainsi que Podman n'avait jamais tourné. La production, elle, choisit par
 * preflight (`preparerBac`).
 */
const moteurImpose = process.env.HIVE_TEST_MOTEUR?.trim() || '';

function runtimeDisponible(): Fournisseur | null {
  // Docker Desktop on the hosted Windows runner exposes the CLI but does not
  // provide a bind mount compatible with this Linux-container probe. Keep the
  // real integration lane active on Unix hosts and report Windows as
  // unavailable instead of turning infrastructure limits into a false failure.
  if (process.platform === 'win32') return null;
  for (const nom of moteurImpose ? [moteurImpose] : ['podman', 'docker']) {
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

/**
 * Le job image de la CI construit l'image par défaut par `npm run bac:image`
 * et pose ce drapeau : le chemin de l'opérateur — construire, puis démarrer
 * SANS HIVE_ISOLEMENT_IMAGE — y est alors éprouvé par la vraie décision de
 * production (`preparerBac`), avec les vrais moteurs du runner.
 */
const imageDefautConstruite = process.env.HIVE_TEST_IMAGE_DEFAUT === '1';

describe('isolement — intégration runtime réel', () => {
  it.skipIf(!imageDefautConstruite || !moteurImpose)(
    'la production retient le moteur qui a l’image par défaut, par son preflight',
    async () => {
      // L'environnement du NŒUD, sans HIVE_ISOLEMENT_IMAGE : l'image par
      // défaut. Une clé factice nommée suffit (elle n'est jamais utilisée :
      // `--version` ne parle à aucun modèle) ; `exige` fait d'un repli un échec.
      const bac = await preparerBac(
        { PATH: process.env.PATH, HIVE_ISOLEMENT: 'exige', ANTHROPIC_API_KEY: 'sk-ci-factice' },
        'claude-code',
        { informer: () => {} },
      );
      expect(bac.image).toBe(IMAGE_DEFAUT);
      expect(bac.refuse, bac.lignes.join('\n')).toBe(false);
      // Sur la jambe Docker, Podman (installé sur le runner) n'a pas encore
      // l'image : il est écarté, et c'est Docker qui isole. Sur la jambe
      // Podman, il l'a reçue, et il passe en premier.
      expect(bac.fournisseur?.nom, bac.lignes.join('\n')).toBe(moteurImpose);
    },
    300_000,
  );

  it.skipIf(!runtime && !imageDemandee && !moteurImpose)(
    'exécute réellement le preflight dans Docker/Podman',
    async () => {
      expect(
        runtime,
        'HIVE_ISOLEMENT_IMAGE ou HIVE_TEST_MOTEUR exige un runtime Docker/Podman actif',
      ).not.toBeNull();

      // La jambe CI qui construit l’image agent-aware pose HIVE_ISOLEMENT_IMAGE :
      // elle exerce alors les vrais binaires que le Worker lancera, pas une
      // simple commande `docker run` indépendante de Hive. Chaque CLI intégré
      // à `docker/agents/Dockerfile` doit figurer ici : c'est ce preflight
      // durci (racine en lecture seule, /tmp noexec, uid non privilégié) qui
      // prouve qu'un Worker pourra réellement le lancer.
      const image = imageDemandee || IMAGE_DEFAUT;
      const pret = await preparerImage(runtime!, image, { informer: () => {} });
      if (!imageDemandee && !pret.executable) {
        // Sans image demandée, l'image PAR DÉFAUT est celle que le nœud
        // construit (`npm run bac:image`) : absente ici, le vrai moteur doit le
        // DIRE — pas « agent absent », pas un téléchargement tenté.
        expect(pret.motif).toContain(`image absente de ${runtime!.nom}`);
        expect(pret.motif).toContain(COMMANDE_IMAGE);
        return;
      }
      expect(pret.executable, `${image} dans ${runtime!.nom}: ${pret.motif}`).toBe(true);
      // Le vrai Podman du runner (rootless) le dit de lui-même, et c'est ce
      // moteur appris — pas l'UID de l'hôte — qui décide de `keep-id` ensuite.
      if (runtime!.nom === 'podman') expect(pret.fournisseur?.rootless).toBe(true);
      const moteur = pret.fournisseur ?? runtime!;
      const binaires = imageDemandee ? ['claude', 'codex', 'cline'] : ['node'];
      for (const binaire of binaires) {
        const resultat = await sonderAgentDansBac(moteur, binaire, image);
        expect(resultat.executable, `${binaire} dans ${image}: ${resultat.motif}`).toBe(true);
      }

      const absent = await sonderAgentDansBac(moteur, 'hive-agent-inexistant', image);
      expect(absent.executable).toBe(false);
    },
    // Sous Podman rootless, le premier `keep-id` copie l'image (`preparerImage`).
    300_000,
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
    'les validations du nœud installent les devDependencies : le `test` du projet trouve son outil',
    async () => {
      // Presque tout projet lance son `test` par un outil de ses devDependencies
      // (vitest, jest, eslint). Le VRAI chemin des validations — `npm ci`, puis
      // `npm run test`, dans le conteneur de l'image — doit donc les installer :
      // un environnement qui les omet (npm `omit=dev`, ce que `NODE_ENV=production`
      // implique) rend 127, `outil_introuvable`, et aucune production n'est jugée.
      if (!runtime || !imageDemandee) return;
      const root = mkdtempSync(path.join(os.tmpdir(), 'hive-validations-conteneur-'));
      const projet = path.join(root, 'projet');
      const outil = path.join(root, 'outil-dev');
      mkdirSync(projet);
      mkdirSync(outil);
      try {
        // L'outil : un paquet minuscule, emballé en tarball DANS le dépôt —
        // installé comme une dépendance du registre (extrait, binaire lié dans
        // `node_modules/.bin`), sans aucun accès réseau.
        writeFileSync(
          path.join(outil, 'package.json'),
          JSON.stringify({ name: 'outil-dev', version: '1.0.0', bin: { 'outil-dev': 'bin.js' } }),
        );
        writeFileSync(
          path.join(outil, 'bin.js'),
          "#!/usr/bin/env node\nconsole.log('outil-dev présent');\n",
        );
        execFileSync('npm', ['pack', '--pack-destination', projet], {
          cwd: outil,
          stdio: 'ignore',
        });
        writeFileSync(
          path.join(projet, 'package.json'),
          JSON.stringify({
            name: 'projet',
            version: '1.0.0',
            private: true,
            scripts: { test: 'outil-dev' },
            devDependencies: { 'outil-dev': 'file:outil-dev-1.0.0.tgz' },
          }),
        );
        writeFileSync(path.join(projet, '.gitignore'), 'node_modules\n');
        execFileSync(
          'npm',
          ['install', '--package-lock-only', '--offline', '--no-audit', '--no-fund'],
          { cwd: projet, stdio: 'ignore' },
        );
        const git = (...args: string[]): string =>
          execFileSync(
            'git',
            [
              '-c',
              'user.email=banc@hive.test',
              '-c',
              'user.name=Banc Hive',
              '-c',
              'commit.gpgsign=false',
              ...args,
            ],
            { cwd: projet, encoding: 'utf8' },
          ).trim();
        git('init', '--quiet');
        git('add', '.');
        git('commit', '--quiet', '-m', 'base');
        const baseSha = git('rev-parse', 'HEAD');
        // La production de l'agent : un fichier, rien qui touche à son juge.
        writeFileSync(path.join(projet, 'feature.js'), 'module.exports = 1;\n');

        const rapport = await validerProduction({
          cwd: projet,
          depot: {
            depot: await poserRegistre(projet, path.join(root, 'registre'), baseSha),
            baseSha,
          },
          bac: { fournisseur: runtime, image: imageDemandee, variables: [] },
        });

        const tests = rapport.controles.tests;
        expect(tests, JSON.stringify(tests)).toMatchObject({
          etat: 'passed',
          raison: 'termine',
          code: 0,
        });
        expect(tests.extrait).toContain('outil-dev présent');
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      }
    },
    // Podman rootless : un `keep-id` froid peut encore copier l'image.
    300_000,
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

  it.skipIf(!runtime || !imageDemandee)(
    'un nœud tué laisse son conteneur ; relancé, il le retrouve par son étiquette et le supprime',
    async () => {
      // Le trou exact : `--rm` meurt avec le client `docker run`. On lance donc
      // un vrai conteneur étiqueté, on tue son client comme un nœud tué net
      // (SIGKILL : aucun relais de signal possible), on constate que le
      // conteneur SURVIT — sans quoi ce banc ne prouverait rien —, puis le
      // ramassage du démarrage le supprime.
      if (!runtime || !imageDemandee) return;
      const noeud = `node-ramassage-${process.pid}-${Date.now()}`;
      const atelier = mkdtempSync(path.join(os.tmpdir(), 'hive-ramassage-'));
      const lance = envelopper('sleep', ['300'], {
        fournisseur: runtime,
        cwdHote: atelier,
        variables: [],
        image: imageDemandee,
        noeud,
        tache: 'tache-orpheline',
      });
      const client = spawn(lance.bin, lance.args, { stdio: 'ignore' });
      const etiquetes = (...filtres: string[]): string[] =>
        execFileSync(
          runtime.bin,
          ['ps', '--all', '--quiet', `--filter=label=${ETIQUETTE_NOEUD}=${noeud}`, ...filtres],
          { encoding: 'utf8', timeout: 15_000 },
        )
          .split(/\s+/)
          .filter(Boolean);
      try {
        // EN MARCHE, pas seulement CRÉÉ : `ps --all` liste le conteneur dès sa
        // création, avant que le client l'ait démarré. Tué dans cette fenêtre,
        // le client coupe sa requête de démarrage ; le démon Docker la tient
        // pour un démarrage raté et, `--rm` oblige, SUPPRIME le conteneur
        // (moby, `daemon/start.go`). Run 36327132854 : vu ~0,1 s après le
        // lancement, disparu une seconde plus tard. Ce qu'un nœud tué laisse
        // derrière lui, c'est un agent AU TRAVAIL : c'est lui qu'on attend.
        const limite = Date.now() + 60_000;
        while (etiquetes('--filter=status=running').length === 0) {
          if (Date.now() > limite) throw new Error('le conteneur étiqueté ne démarre pas');
          await new Promise((r) => setTimeout(r, 250));
        }
        client.kill('SIGKILL');
        await new Promise((r) => client.once('close', r));
        await new Promise((r) => setTimeout(r, 1_000));
        expect(etiquetes(), 'le conteneur doit survivre à son client tué').toHaveLength(1);

        const r = await ramasserConteneurs(runtime, noeud);
        expect(r).toMatchObject({ supprimes: [expect.any(String)] });
        expect(etiquetes(), 'plus rien ne porte l’étiquette de ce nœud').toEqual([]);
      } finally {
        client.kill('SIGKILL');
        try {
          for (const id of etiquetes()) execFileSync(runtime.bin, ['rm', '--force', id]);
        } catch {
          // déjà supprimé
        }
        rmSync(atelier, { recursive: true, force: true, maxRetries: 3 });
      }
    },
    120_000,
  );
});

// ─── BUBBLEWRAP : LE BAC SANS DÉMON, SUR L'AGENT QUE LE MEMBRE A INSTALLÉ ───
//
// Mesuré sur un hôte Linux réel (bubblewrap seul, ni Docker ni Podman) : le
// preflight passait pour `git` et échouait pour `claude`, `codex`,
// `cursor-agent` et `node` — tous installés sous `$HOME`, que le bac ne montait
// pas. Le nœud retombait en sandbox de processus. Et dans le bac, `TMPDIR`
// pointait vers un chemin de l'hôte absent (`mktemp` rendait 1), `HOME` aussi.
//
// Ces bancs lancent le VRAI bubblewrap sur une VRAIE installation fabriquée
// sous un HOME : un agent `#!/usr/bin/env node` (comme Codex, comme `npm`),
// atteint par un lien du PATH (comme `~/.local/bin/claude`). La CI Linux
// installe bubblewrap et pose `HIVE_BWRAP_REQUIS=1` : là, un bubblewrap absent
// ou bloqué fait ÉCHOUER le banc au lieu de le sauter en silence.

const bwrapRequis = process.env.HIVE_BWRAP_REQUIS === '1';

function bwrapDisponible(): Fournisseur | null {
  if (process.platform !== 'linux') return null;
  try {
    // `--version` répond même quand les espaces de noms utilisateur sont
    // refusés (AppArmor d'Ubuntu 24.04) : on éprouve un vrai lancement.
    execFileSync('bwrap', ['--ro-bind', '/', '/', '--unshare-all', '--', 'true'], {
      stdio: 'ignore',
      timeout: 8_000,
    });
    return fournisseurParNom('bubblewrap');
  } catch {
    return null;
  }
}

const bwrap = bwrapDisponible();

/** Ce que l'agent factice constate, de l'intérieur du bac. */
interface Constat {
  cwd: string;
  home: string | null;
  homeInscriptible: boolean;
  tmpdir: string | null;
  mktemp: boolean;
  tache: string | null;
  temp: string | null;
  maisonVisible: boolean;
  jeton: string | null;
  hive: string | null;
}

/**
 * Installe un agent comme le fait un installeur natif : la version réelle sous
 * `~/.local/share`, un lien dans `~/.local/bin`. Il écrit son constat dans la
 * tâche, et le HOME porte un secret qui ne doit JAMAIS être visible.
 */
function installerAgentFactice(racine: string): { maison: string; bin: string } {
  const maison = path.join(racine, 'maison');
  const version = path.join(maison, '.local/share/agent-factice/versions/1.0.0/agent-factice');
  mkdirSync(path.dirname(version), { recursive: true });
  writeFileSync(
    version,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const os = require('node:os');",
      "const path = require('node:path');",
      'const e = process.env;',
      'let homeInscriptible = false;',
      "try { fs.writeFileSync(path.join(e.HOME, '.session'), 'x'); homeInscriptible = true; } catch {}",
      'let mktemp = false;',
      "try { fs.rmSync(fs.mkdtempSync(path.join(os.tmpdir(), 'x-')), { recursive: true }); mktemp = true; } catch {}",
      'const constat = {',
      '  cwd: process.cwd(), home: e.HOME ?? null, homeInscriptible,',
      '  tmpdir: e.TMPDIR ?? null, mktemp, tache: e.HIVE_TASK_CWD ?? null, temp: e.TEMP ?? null,',
      `  maisonVisible: fs.existsSync(${JSON.stringify(path.join(maison, 'secret-du-membre'))}),`,
      '  jeton: e.CLAUDE_CODE_OAUTH_TOKEN ?? null, hive: e.HIVE_TOKEN ?? null,',
      '};',
      "fs.writeFileSync('/hive/tache/constat.json', JSON.stringify(constat));",
      "console.log('agent-factice ' + (process.argv[2] ?? 'a travaillé'));",
    ].join('\n'),
  );
  chmodSync(version, 0o755);
  writeFileSync(path.join(maison, 'secret-du-membre'), 'clé SSH, session, .env…\n');
  const bin = path.join(maison, '.local/bin');
  mkdirSync(bin, { recursive: true });
  symlinkSync(version, path.join(bin, 'agent-factice'));
  return { maison, bin };
}

const constatAttendu: Constat = {
  cwd: '/hive/tache',
  home: '/tmp/hive-home',
  homeInscriptible: true,
  tmpdir: '/tmp',
  mktemp: true,
  tache: '/hive/tache',
  temp: null,
  maisonVisible: false,
  jeton: 'sk-ant-oat01-jeton-factice',
  hive: null,
};

describe('isolement — intégration bubblewrap réelle', () => {
  let racine = '';
  afterEach(() => {
    vi.unstubAllEnvs();
    if (racine) rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
    racine = '';
  });

  /** Un hôte dont le HOME porte l'agent, sur le PATH par son lien. */
  function hote(): { maison: string } {
    // `realpath` : le preflight compare des chemins réels.
    racine = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hive-bwrap-')));
    const { maison, bin } = installerAgentFactice(racine);
    vi.stubEnv('HOME', maison);
    vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH ?? ''}`);
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', constatAttendu.jeton ?? '');
    vi.stubEnv('HIVE_TOKEN', 'jeton-de-ruche-qui-ne-doit-jamais-entrer');
    return { maison };
  }

  it.skipIf(!bwrap && !bwrapRequis)(
    'le preflight trouve l’agent installé dans le HOME, et le Node du pont MCP',
    async () => {
      expect(bwrap, 'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui démarre').not.toBeNull();
      hote();
      for (const binaire of ['agent-factice', 'node']) {
        const r = await sonderAgentDansBac(bwrap!, binaire);
        expect(r.executable, `${binaire} : ${r.motif}`).toBe(true);
      }
      const absent = await sonderAgentDansBac(bwrap!, 'hive-agent-inexistant');
      expect(absent.executable).toBe(false);
    },
    60_000,
  );

  it.skipIf(!bwrap && !bwrapRequis)(
    'l’agent s’exécute dans le seul workspace, avec un HOME, un TMPDIR et son jeton — rien de l’hôte',
    async () => {
      expect(bwrap, 'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui démarre').not.toBeNull();
      hote();
      const workspace = path.join(racine, 'travail/tasks/t-1');
      mkdirSync(workspace, { recursive: true });
      // L'environnement RÉEL d'une tâche Claude Code : `HOME` de l'hôte compris,
      // que le bac doit remplacer, et le jeton, qu'il doit laisser passer.
      const variables = agentCredentialEnv('claude-code');
      const r = await runCommand(
        'agent-factice',
        ['dans le bac'],
        {
          cwd: workspace,
          env: buildSandboxEnv(workspace, variables),
          attempt: 1,
          signal: new AbortController().signal,
          onProgress: () => {},
          bac: { fournisseur: bwrap!, image: 'sans objet pour bubblewrap', variables },
        },
        30_000,
      );
      expect(r.success, r.logs).toBe(true);
      expect(r.logs.trim()).toBe('agent-factice dans le bac');
      const constat = JSON.parse(
        readFileSync(path.join(workspace, 'constat.json'), 'utf8'),
      ) as Constat;
      expect(constat).toEqual(constatAttendu);
    },
    60_000,
  );

  it.skipIf(!bwrap && !bwrapRequis)(
    'fait traverser bubblewrap au chemin Worker → tâche, avec les variables du nœud',
    async () => {
      // Le banc précédent éprouve `runCommand` seul. Celui-ci passe par un
      // orchestrateur réel et `HiveNodeClient` : `keepEnv` et `bac` sont ceux
      // que `main.ts` transmet, et `runTask` construit l'environnement.
      expect(bwrap, 'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui démarre').not.toBeNull();
      hote();
      const token = 'jeton-sandbox-worker-bwrap-long';
      const server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(racine, 'hive.db'),
        simulation: false,
        tickMs: 20,
      });
      // Le constat est lu DEUX fois : sur le nœud, tel que l'agent l'a écrit
      // (le jeton exact a bien traversé le bac), puis à la Reine, tel que le
      // nœud l'a laissé partir (caviardé : le jeton ne quitte pas la machine).
      let constatAuNoeud: Constat | null = null;
      const adapter: AgentAdapter = {
        name: 'agent-factice',
        async run(_task, ctx) {
          const r = await runCommand('agent-factice', [], ctx, 30_000);
          if (!r.success) return r;
          const constat = readFileSync(path.join(ctx.cwd, 'constat.json'), 'utf8');
          constatAuNoeud = JSON.parse(constat) as Constat;
          return { ...r, logs: constat, subAgents: [] };
        },
      };
      const variables = agentCredentialEnv('claude-code');
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token,
        name: 'worker-bwrap-reel',
        ownerName: 'integration',
        agentType: 'custom',
        nodeId: 'worker-bwrap-reel',
        maxConcurrency: 1,
        workRoot: path.join(racine, 'work'),
        adapter,
        quiet: true,
        keepEnv: variables,
        bac: { fournisseur: bwrap!, image: 'sans objet pour bubblewrap', variables },
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
          () => server.store.listNodes().some((n) => n.id === 'worker-bwrap-reel'),
          'le Worker ne rejoint pas la ruche',
        );
        const projet = server.store.createProject({ name: 'Mission bubblewrap' });
        const tache = server.store.createTask({
          projectId: projet.id,
          title: 'Prouver le bac bubblewrap du Worker',
          prompt: 'écrire le constat du contexte d’exécution',
        });
        server.store.patchTask(tache.id, { status: 'ready' });
        await attendre(
          () => server.store.getTask(tache.id)?.status === 'done',
          'la tâche bubblewrap ne se termine pas',
        );
        const resultat = server.store.resultsForTask(tache.id).at(-1);
        expect(resultat?.success, resultat?.logs).toBe(true);
        expect(constatAuNoeud).toEqual(constatAttendu);
        expect(JSON.parse(resultat?.logs ?? '{}')).toEqual({
          ...constatAttendu,
          jeton: '[secret]',
        });
      } finally {
        client.stop();
        await server.stop();
      }
    },
    60_000,
  );
  it.skipIf(!bwrap && !bwrapRequis)(
    'dans bubblewrap, un CLI parti d’une racine profonde joint le pont de délégation du nœud',
    async () => {
      // Le socket du pont vit sous le dossier temporaire de l'HÔTE, que le bac
      // recouvre d'un tmpfs : seul le montage en lecture seule de son dossier
      // (`MONTAGE_PONT`) le rend joignable. Ce banc passe par le vrai nœud, le
      // vrai adaptateur Claude Code et un faux `claude` installé sous le HOME,
      // depuis une racine de travail délibérément plus longue que `sun_path`.
      expect(bwrap, 'HIVE_BWRAP_REQUIS=1 exige un bubblewrap qui démarre').not.toBeNull();
      const { maison } = hote();
      const version = path.join(maison, '.local/share/claude/versions/1.0.0/claude');
      mkdirSync(path.dirname(version), { recursive: true });
      writeFileSync(version, FAUX_CLAUDE_MCP);
      chmodSync(version, 0o755);
      symlinkSync(version, path.join(maison, '.local/bin/claude'));
      const token = 'jeton-pont-bwrap-profond-long';
      const server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(racine, 'hive.db'),
        simulation: false,
        tickMs: 20,
      });
      const variables = agentCredentialEnv('claude-code');
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token,
        name: 'worker-bwrap-pont',
        ownerName: 'integration',
        agentType: 'claude-code',
        nodeId: 'worker-bwrap-pont',
        maxConcurrency: 1,
        workRoot: path.join(racine, 'projets-du-membre-'.padEnd(130, 'x')),
        adapter: createClaudeCodeAdapter(token),
        quiet: true,
        keepEnv: variables,
        bac: { fournisseur: bwrap!, image: 'sans objet pour bubblewrap', variables },
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
          () => server.store.listNodes().some((n) => n.id === 'worker-bwrap-pont'),
          'le Worker ne rejoint pas la ruche',
        );
        const projet = server.store.createProject({ name: 'Pont dans bubblewrap' });
        const tache = server.store.createTask({
          projectId: projet.id,
          title: 'Joindre le pont depuis le bac',
          prompt: 'délègue si besoin',
        });
        server.store.patchTask(tache.id, { status: 'ready' });
        await attendre(
          () => server.store.resultsForTask(tache.id).length > 0,
          'aucun résultat : la tâche a été rejetée ou réaffectée au lieu d’aboutir',
        );
        const resultat = server.store.resultsForTask(tache.id).at(0);
        expect(resultat?.success, resultat?.logs).toBe(true);
        expect(resultat?.logs).toContain(
          `outils du pont : ${HIVE_DELEGATE_TOOL},${HIVE_WAIT_TOOL}`,
        );
      } finally {
        client.stop();
        await server.stop();
      }
    },
    60_000,
  );
});
