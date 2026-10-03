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
// sous Windows, un handle ouvert SANS AUCUN PARTAGE (`FileShare.None`) sur un
// fichier du dossier — la seule tenue qui bloque l'effacement POSIX de libuv
// comme l'effacement classique (un cwd tenu s'efface sur les runners CI, et
// l'image d'un exécutable qui tourne aussi, par POSIX delete) ; ailleurs, un
// sous-dossier sans droit d'écriture (hors root, qui passe outre). Puis le
// vrai chemin : une Reine réelle, un `HiveNodeClient`, et la mesure de ce que
// l'écran reçoit — le refus, puis l'échec borné et l'alerte de l'accueil
// (`/api/cockpit`).

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
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
async function tenir(dossier: string): Promise<void> {
  const objets = path.join(dossier, '.git', 'objects', 'pack');
  mkdirSync(objets, { recursive: true });
  writeFileSync(path.join(objets, 'pack-banc.pack'), 'objet\n');
  if (WINDOWS) {
    // Un handle OUVERT sans partage (`FileShare.None`) : ouvrir-pour-effacer
    // est un contrôle de PARTAGE, donc ce handle bloque l'unlink POSIX de
    // libuv (`fs.promises.rm`, le moteur du nœud) comme l'effacement
    // classique. Les tenues précédentes ne tenaient pas contre le nœud : un
    // cwd tenu s'efface en POSIX delete, et l'image d'un garde-banc.exe
    // vivant aussi (`rmSync` — remove_all C++, suppression classique — la
    // croyait tenue ; le nœud, sur libuv, l'effaçait).
    //
    // La prise se SIGNALE (« TENU » sur stdout, émis seulement après un Open
    // revenu) ; en échec, le diagnostic (.NET : type + message) part sur
    // STDOUT — le stderr de PowerShell 5.1 redirigé s'enrobe de CLIXML.
    const verrou = path.join(objets, 'pack-verrou.pack');
    const script = [
      `$d='?'`,
      // Le dossier se RECRÉE à chaque essai : si quelque chose l'efface
      // pendant que le garde s'installe, le garde regagne — et dès qu'un
      // handle vit, l'arborescence qui le porte ne s'efface plus.
      `$f=$null; for($i=0;$i -lt 200;$i++){ try{ [void][IO.Directory]::CreateDirectory('${objets.replace(/'/g, "''")}'); $f=[IO.File]::Open('${verrou.replace(/'/g, "''")}','CreateNew','ReadWrite','None'); break }catch{ $e=$_.Exception; if($e.InnerException){ $e=$e.InnerException }; $d=$e.GetType().Name+' : '+$e.Message; Start-Sleep -Milliseconds 50 } }`,
      `if($null -eq $f){ [Console]::Out.WriteLine('ECHEC '+$d); exit 1 }`,
      `[Console]::Out.WriteLine('TENU')`,
      `Start-Sleep -Seconds 3600`,
    ].join('; ');
    const garde: ChildProcess = spawn(
      'PowerShell',
      // -EncodedCommand : le script passe en base64, hors de portée des
      // règles de guillemets que spawn et PowerShell empilent chacun.
      ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    aNettoyer.push(() => garde.kill());
    let sortie = '';
    let erreurs = '';
    garde.stdout?.on('data', (d: Buffer) => (sortie += String(d)));
    garde.stderr?.on('data', (d: Buffer) => (erreurs += String(d)));
    const limite = Date.now() + 60_000;
    while (!sortie.includes('TENU')) {
      // Un garde mort ou muet est un banc cassé : on le dit tout de suite,
      // au lieu de libérer une tâche que rien ne refusera jamais.
      if (garde.exitCode !== null || Date.now() > limite) {
        throw new Error(
          `le verrou PowerShell ne prend pas (code ${garde.exitCode}) : ${sortie} ${erreurs}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // La tenue se PROUVE avant de rendre la main, avec le MÊME moteur que le
    // nœud (`fs.promises.rm`/libuv, POSIX delete) : l'essai doit échouer
    // comme l'effacement du nœud échouera — `rmSync` (moteur C++ classique)
    // a déjà « prouvé » une tenue que le nœud traversait.
    try {
      await rm(verrou);
    } catch {
      return;
    }
    throw new Error('« TENU » reçu mais le fichier s’est effacé : le verrou ne verrouille pas');
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
        // Le reste de la tentative tuée : `<work>/tasks/<tâche>-<nœud court>`,
        // TENU AVANT que la tâche n'existe. `createTask` range en `pending`,
        // que le scheduler promeut et assigne dès le tick suivant (20 ms) :
        // tenu après coup, le nœud vidait le dossier pendant que le garde
        // s'installait (`tenir` est async — en CI, les 200 retentes d'une
        // version précédente mouraient toutes en DirectoryNotFoundException).
        // Sous POSIX, le chmod synchrone fermait cette fenêtre par accident ;
        // l'ordre la ferme par construction, sur tous les systèmes.
        const tacheId = 'tache-tenue';
        await tenir(path.join(work, 'tasks', `${tacheId}-${nodeId.slice(0, 8)}`));
        const t = server.store.createTask({
          id: tacheId,
          projectId: projet.id,
          title: 'Ligne',
          prompt: 'ligne',
        });
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
