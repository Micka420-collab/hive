// Le dossier d'une tâche que la tentative précédente a laissé, et qu'on ne peut
// plus effacer : la tâche doit finir en échec VISIBLE, avec la vraie cause.
//
// ─── LA PANNE QUE CE BANC TIENT FERMÉE ───────────────────────────────────────
//
// Hive 0.5.0, application de bureau sous Windows : la ruche redémarre pendant
// qu'une ouvrière travaille, et le dossier de la tâche reste, clone compris.
// À la tentative suivante, `prepareWorkspace` ne pouvait plus l'effacer
// (`effacerDossier`, workspace.ts, dit pourquoi) et le refus partait sous
// « clone impossible : EPERM … » — une panne de dépôt ou d'identifiants qui
// n'existait pas. Le compte des refus concluait bien, mais en « aucun agent
// qui fonctionne — réparez l'agent » : deux fausses pistes pour l'opérateur.
//
// Ici le dossier est TENU pour de vrai, par le moyen que chaque système offre :
// un processus vivant dont c'est le répertoire courant sous Windows (un tel
// dossier ne s'efface pas), un sous-dossier sans droit d'écriture ailleurs
// (hors root, qui passe outre). Puis le vrai chemin : une Reine réelle, un
// `HiveNodeClient`, et la mesure de ce que l'écran reçoit — le refus, puis
// l'échec borné et l'alerte de l'accueil (`/api/cockpit`).

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-dossier-tache-tenu-long';
const WINDOWS = process.platform === 'win32';
const RACINE = typeof process.getuid === 'function' && process.getuid() === 0;

const aNettoyer: (() => void)[] = [];
afterEach(() => {
  for (const f of aNettoyer.splice(0).reverse()) f();
});

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=banc@hive.local', '-c', 'user.name=Banc Hive', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

/** Tient `dossier` jusqu'au nettoyage du banc. */
function tenir(dossier: string): void {
  const objets = path.join(dossier, '.git', 'objects', 'pack');
  mkdirSync(objets, { recursive: true });
  writeFileSync(path.join(objets, 'pack-banc.pack'), 'objet\n');
  if (WINDOWS) {
    const garde: ChildProcess = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: objets,
      stdio: 'ignore',
    });
    aNettoyer.push(() => garde.kill());
    return;
  }
  chmodSync(objets, 0o555);
  aNettoyer.push(() => chmodSync(objets, 0o755));
}

describe.skipIf(RACINE)('un dossier de tâche qui ne s’efface plus', () => {
  it(
    'refus qui nomme le dossier tenu, puis échec borné que l’accueil DIT — sans parler de clone',
    { timeout: 90_000 },
    async () => {
      const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-dossier-tenu-'));
      aNettoyer.push(() => rmSync(racine, { recursive: true, force: true, maxRetries: 5 }));
      const amont = path.join(racine, 'amont');
      mkdirSync(amont);
      git(amont, 'init', '-q', '-b', 'main');
      writeFileSync(path.join(amont, 'a.txt'), 'base\n');
      git(amont, 'add', '-A');
      git(amont, 'commit', '-q', '-m', 'base');

      let lance = false;
      const adapter: AgentAdapter = {
        name: 'jamais-lance',
        async run() {
          lance = true;
          return { success: true, diff: '', logs: '', subAgents: [] };
        },
      };
      const server = await createServer({
        port: 0,
        host: '127.0.0.1',
        token: TOKEN,
        corsOrigins: ['http://localhost:5173'],
        dbPath: path.join(racine, 'hive.db'),
        simulation: false,
        tickMs: 20,
      });
      const work = path.join(racine, 'work');
      const client = new HiveNodeClient({
        url: `ws://127.0.0.1:${server.port}/ws`,
        token: TOKEN,
        name: 'noeud-tenu',
        ownerName: 'banc',
        agentType: 'custom',
        nodeId: 'noeud-tenu',
        maxConcurrency: 1,
        workRoot: work,
        adapter,
        quiet: true,
      });
      client.start();
      const attendre = async (condition: () => boolean, message: string): Promise<void> => {
        const limite = Date.now() + 75_000;
        while (Date.now() < limite) {
          if (condition()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(message);
      };
      try {
        await attendre(
          () => server.store.listNodes().some((n) => n.status === 'online'),
          'le nœud ne rejoint pas la ruche',
        );
        const nodeId = server.store.listNodes()[0]!.id;
        const projet = server.store.createProject({ name: 'Dossier tenu', repoUrl: amont });
        const t = server.store.createTask({
          projectId: projet.id,
          title: 'Ligne',
          prompt: 'ligne',
        });
        // Le reste de la tentative tuée : `<work>/tasks/<tâche>-<nœud court>`.
        tenir(path.join(work, 'tasks', `${t.id}-${nodeId.slice(0, 8)}`));
        server.store.patchTask(t.id, { status: 'ready' });

        const refus = () =>
          server.store
            .listEvents(0, 1000)
            .filter((e) => e.type === 'task_rejected' && e.payload.taskId === t.id);
        await attendre(() => refus().length > 0, 'la tâche n’est jamais refusée');
        const premier = refus()[0]!.payload;
        expect(premier).toMatchObject({ infra: true, avantAgent: true });
        expect(String(premier.reason)).toMatch(
          /^dossier de la tâche impossible à vider — un processus le tient-il encore \? \((EBUSY|EPERM|EACCES|ENOTEMPTY) : \.git/,
        );

        // Un seul nœud : le compte des refus conclut (`rejectTask`), et l'échec
        // se lit à l'accueil avec la vraie cause — une préparation, pas un agent.
        await attendre(() => server.store.getTask(t.id)?.status === 'failed', 'jamais échouée');
        const reponse = await fetch(`http://127.0.0.1:${server.port}/api/cockpit`, {
          headers: { 'x-hive-token': TOKEN },
        });
        const { alertes } = (await reponse.json()) as { alertes: Record<string, unknown>[] };
        expect(alertes.find((a) => a.taskId === t.id)).toMatchObject({
          genre: 'refus',
          definitif: true,
          avantAgent: true,
          raison: expect.stringMatching(/^dossier de la tâche impossible à vider/),
        });
        expect(lance).toBe(false);
      } finally {
        client.stop();
        await server.stop();
      }
    },
  );
});
