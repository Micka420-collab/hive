// SANDBOX LIVE À TRAVERS LA RUCHE — un vrai nœud, une vraie Reine, un vrai écran.
//
// ─── CE QUE CE FICHIER PROTÈGE, À LA FRONTIÈRE ───────────────────────────────
//
// · l'état en direct d'une exécution (phase, commande caviardée, pause
//   possible, mesure de l'arbre) arrive à l'écran PENDANT qu'elle tourne, et
//   n'entre JAMAIS au journal ;
// · « Pause » passe par la Reine jusqu'au nœud, qui gèle l'arbre de l'agent
//   (petit-enfant compris) ; l'écran lit ce que le nœud CONFIRME ;
// · un écran qui se RECONNECTE retrouve l'état — pause comprise —, que le
//   rattrapage du journal ne porte pas ;
// · le diff d'une exécution en cours se DEMANDE, caviardé au nœud ;
// · annuler un agent EN PAUSE l'arrête vraiment, petit-enfant compris : un
//   processus arrêté (SIGSTOP) ne traite pas le SIGTERM de l'annulation, et
//   des processus gelés survivraient à leur tâche ;
// · à la fin de l'exécution, l'état disparaît — de la Reine comme de l'écran.
//
// POSIX seulement pour la pause (SIGSTOP) ; la garde Windows est éprouvée par
// `pilote-execution.test.ts`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { runCommand } from '../src/adapters/exec.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const JETON = 'jeton-bac-direct-suffisamment-long';
const NOM_CLE = 'HIVE_BANC_BAC_API_KEY';
const CLE = 'cle-du-banc-bac-que-nul-ne-doit-lire-0123';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
const ecrans: WebSocket[] = [];
let dossier = '';

afterEach(async () => {
  for (const e of ecrans.splice(0)) e.close();
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  delete process.env[NOM_CLE];
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
});

async function attendre(condition: () => boolean, message: string, delai = 15_000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

type Msg = Record<string, unknown> & { type: string };

/** Un écran abonné à la Reine, qui retient tout ce qu'il reçoit. */
async function ecran(port: number): Promise<Msg[]> {
  const recus: Msg[] = [];
  const e = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ecrans.push(e);
  await new Promise<void>((ok, ko) => {
    e.once('open', () => ok());
    e.once('error', ko);
  });
  e.on('message', (brut: Buffer) => recus.push(JSON.parse(brut.toString()) as Msg));
  e.send(JSON.stringify({ type: 'subscribe', token: JETON }));
  await attendre(() => recus.some((m) => m.type === 'state'), 'l’écran n’est pas abonné');
  return recus;
}

/** Le dernier état en direct reçu pour une tâche (`null` : effacé). */
function dernierDirect(recus: Msg[], taskId: string): Record<string, unknown> | null | undefined {
  const m = recus.filter((x) => x.type === 'task_direct' && x.taskId === taskId).at(-1);
  return m === undefined ? undefined : (m.direct as Record<string, unknown> | null);
}

const lireBattement = (dir: string, qui: string): number => {
  try {
    return Number(readFileSync(path.join(dir, `hb-${qui}`), 'utf8')) || 0;
  } catch {
    return 0;
  }
};

/** Un dépôt git local, vrai : le diff se calcule contre son commit. */
function depotLocal(racine: string): string {
  const depot = path.join(racine, 'depot');
  execFileSync('git', ['init', '-q', depot]);
  writeFileSync(path.join(depot, 'LISEZMOI.md'), 'départ\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', depot, '-c', 'user.email=b@b', '-c', 'user.name=b', ...args]);
  git('add', '.');
  git('commit', '-q', '-m', 'départ');
  return depot;
}

describe.skipIf(process.platform === 'win32')('Sandbox Live — du nœud à l’écran', () => {
  it('ÉTAT EN DIRECT, PAUSE CONFIRMÉE, RECONNEXION, DIFF À LA DEMANDE, ANNULATION EN PAUSE', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'bac-direct-ruche-'));
    process.env[NOM_CLE] = CLE;
    const depot = depotLocal(dossier);
    const enfant = path.join(dossier, 'enfant.js');
    const agent = path.join(dossier, 'agent.js');
    const battement = (qui: string) =>
      `let n = 0; setInterval(() => require('node:fs').writeFileSync(` +
      `${JSON.stringify(path.join(dossier, `hb-${qui}`))}, String(++n)), 20);\n`;
    writeFileSync(enfant, battement('enfant'));
    // L'agent écrit dans le dépôt (sa clé comprise : le diff doit la taire),
    // lance un petit-enfant, bat, et ne finit que si on l'arrête.
    writeFileSync(
      agent,
      "const fs = require('node:fs');\nconst { spawn } = require('node:child_process');\n" +
        `fs.writeFileSync('nouveau.txt', 'ajout ' + process.env.${NOM_CLE} + '\\n');\n` +
        `const e = spawn(process.execPath, [${JSON.stringify(enfant)}], { stdio: 'ignore' });\n` +
        `fs.writeFileSync(${JSON.stringify(path.join(dossier, 'pids'))}, process.pid + ' ' + e.pid);\n` +
        "process.on('SIGTERM', () => { e.kill('SIGKILL'); process.exit(143); });\n" +
        battement('parent'),
    );

    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    const s = serveur;
    const base = `http://127.0.0.1:${s.port}`;
    const api = (chemin: string, methode = 'GET', entetes: Record<string, string> = {}) =>
      fetch(`${base}${chemin}`, {
        method: methode,
        headers: {
          'x-hive-token': JETON,
          ...(methode === 'POST' ? { 'content-type': 'application/json' } : {}),
          ...entetes,
        },
        ...(methode === 'POST' ? { body: '{}' } : {}),
      });
    const recus = await ecran(s.port);

    let fin: Awaited<ReturnType<typeof runCommand>> | null = null;
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${s.port}/ws`,
      token: JETON,
      name: 'ouvriere-bac',
      ownerName: 'banc',
      agentType: 'claude-code',
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      keepEnv: [NOM_CLE],
      adapter: {
        name: 'banc',
        async run(_task, ctx) {
          // La clé dans la commande : elle doit partir caviardée à l'écran.
          fin = await runCommand(process.execPath, [agent, `--cle=${CLE}`], ctx, 120_000);
          return fin;
        },
      },
      quiet: true,
    });
    client.start();
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    const p = s.store.createProject({ name: 'P', repoUrl: depot });
    const t = s.store.createTask({ projectId: p.id, title: 'Travailler', prompt: 'x' });
    s.store.patchTask(t.id, { status: 'ready' });

    // ── L'état en direct arrive pendant l'exécution ─────────────────────────
    await attendre(
      () => dernierDirect(recus, t.id)?.pausable === true && lireBattement(dossier, 'enfant') > 2,
      'aucun état en direct « pausable »',
    );
    const direct = dernierDirect(recus, t.id)!;
    expect(direct).toMatchObject({ taskId: t.id, phase: 'agent' });
    expect(String(direct.commande)).toContain('agent.js');
    expect(String(direct.commande)).toContain('[secret]');
    expect(JSON.stringify(recus)).not.toContain(CLE);
    await attendre(() => dernierDirect(recus, t.id)?.metriques !== undefined, 'aucune mesure');
    expect(dernierDirect(recus, t.id)?.metriques).toMatchObject({ source: 'arbre' });
    // Rien au journal : l'état est éphémère — aucune ligne ne porte ses champs.
    const journal = JSON.stringify(s.store.listEvents(0, 10_000));
    expect(journal).not.toMatch(/"pausable"|"metriques"|"enPause"/);

    // ── Le diff, demandé, caviardé au nœud ──────────────────────────────────
    const d = await api(`/api/tasks/${t.id}/diff-direct`);
    expect(d.status).toBe(200);
    const diff = (await d.json()) as { diff: string; tronque: boolean; erreur?: string };
    expect(diff.erreur).toBeUndefined();
    expect(diff.diff).toContain('nouveau.txt');
    expect(diff.diff).toContain('[secret]');
    expect(diff.diff).not.toContain(CLE);
    expect(diff.tronque).toBe(false);
    // Sans identité, la lecture est refusée comme toute lecture.
    expect((await fetch(`${base}/api/tasks/${t.id}/diff-direct`)).status).toBe(401);

    // ── La pause : transmise, puis CONFIRMÉE par le nœud ────────────────────
    expect((await api(`/api/tasks/${t.id}/pause`, 'POST')).status).toBe(202);
    await attendre(() => dernierDirect(recus, t.id)?.enPause === true, 'pause jamais confirmée');
    await new Promise((r) => setTimeout(r, 150));
    const gele = lireBattement(dossier, 'enfant');
    await new Promise((r) => setTimeout(r, 500));
    expect(lireBattement(dossier, 'enfant'), 'le petit-enfant bat en pause').toBe(gele);

    // ── Un écran qui revient retrouve la pause ──────────────────────────────
    const revenu = await ecran(s.port);
    await attendre(() => dernierDirect(revenu, t.id) !== undefined, 'état non rendu au retour');
    expect(dernierDirect(revenu, t.id)).toMatchObject({ enPause: true, phase: 'agent' });

    // ── Reprise, puis nouvelle pause et ANNULATION pendant celle-ci ─────────
    expect((await api(`/api/tasks/${t.id}/resume`, 'POST')).status).toBe(202);
    await attendre(() => dernierDirect(recus, t.id)?.enPause === false, 'reprise non confirmée');
    await attendre(() => lireBattement(dossier, 'enfant') > gele + 2, 'l’arbre ne repart pas');
    expect((await api(`/api/tasks/${t.id}/pause`, 'POST')).status).toBe(202);
    await attendre(() => dernierDirect(recus, t.id)?.enPause === true, 'seconde pause');
    expect((await api(`/api/tasks/${t.id}/cancel`, 'POST')).status).toBe(200);
    await attendre(() => fin !== null, 'l’agent en pause n’a jamais été arrêté', 10_000);
    const pids = readFileSync(path.join(dossier, 'pids'), 'utf8').split(' ').map(Number);
    const vivant = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await attendre(() => pids.every((pid) => !vivant(pid)), 'un processus gelé survit à sa tâche');

    // ── Fin d'exécution : l'état disparaît partout ──────────────────────────
    await attendre(() => dernierDirect(recus, t.id) === null, 'l’écran garde un état fini');
    const apres = await ecran(s.port);
    await new Promise((r) => setTimeout(r, 200));
    expect(dernierDirect(apres, t.id)).toBeUndefined();
    // Plus d'exécution : pause et diff le disent.
    expect((await api(`/api/tasks/${t.id}/pause`, 'POST')).status).toBe(409);
    expect((await api(`/api/tasks/${t.id}/diff-direct`)).status).toBe(409);
  });
});
