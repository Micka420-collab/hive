// LES RESSOURCES D'UNE EXÉCUTION SONT CELLES DE L'AGENT — jamais celles du nœud.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// · deux agents qui tournent EN MÊME TEMPS sur le même nœud rendent chacun SA
//   mesure : l'un brûle 300 ms de CPU et tient 50 Mio, l'autre ne fait rien, et
//   le nœud (le processus de ce banc) n'y est pour rien. L'ancienne mesure —
//   `process.resourceUsage()` du NŒUD autour de l'adaptateur — ignorait le CPU
//   de l'agent, son enfant, et donnait aux deux le même pic : celui du nœud
//   depuis son démarrage ;
// · le nœud n'envoie plus `usage` : une Reine plus ancienne l'exige complet,
//   et rejetterait le résultat entier — une tâche pendue ;
// · la mesure rangée avec CE résultat se relit ; celle d'un nœud plus ancien
//   (`usage`, les compteurs du nœud) se relit `noeud_ancien`, jamais comme les
//   ressources de l'agent — au journal comme sur le résumé de la tâche.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { runCommand } from '../src/adapters/exec.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import { HiveStore } from '../src/orchestrator/store.js';
import type { RessourcesExecution, TaskResultSummary } from '../src/shared/types.js';
import { fenetreSeule } from './aide/journal-retenu.js';

const JETON = 'jeton-ressources-agent-suffisamment-long';
const MIO = 1024 * 1024;

/** Les compteurs qu'envoyait un nœud d'avant : ceux de SON processus Node. */
const USAGE_DU_NOEUD = {
  userCpuMicros: 1_200,
  systemCpuMicros: 300,
  maxRssBytes: 8 * MIO,
  rssBytes: 6 * MIO,
  heapUsedBytes: 3 * MIO,
};

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let dossier = '';

afterEach(async () => {
  vi.restoreAllMocks();
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
  dossier = '';
});

async function attendre(condition: () => boolean, message: string, delai = 25_000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

/**
 * L'agent du banc. `lourd` : 300 ms de CPU À LUI (mesurées par son propre
 * compteur — une machine chargée ne les raccourcit pas), puis 50 Mio écrits,
 * donc résidents. Les deux tiennent ensuite jusqu'au SIGNAL du banc (un
 * fichier) : donné quand la Reine a vu un relevé de ce travail, il ne dépend
 * ni de l'intervalle des relevés ni de la vitesse de la machine.
 */
const AGENT = [
  "const fs = require('node:fs');",
  "if (process.argv[2] === 'lourd') {",
  '  const debut = process.cpuUsage();',
  '  const cpuMs = () => { const u = process.cpuUsage(debut); return (u.user + u.system) / 1000; };',
  '  while (cpuMs() < 300) {}',
  `  globalThis.tas = Buffer.alloc(${50 * MIO}, 1);`,
  '}',
  'setInterval(() => { if (fs.existsSync(process.argv[3])) process.exit(0); }, 50);',
  'setTimeout(() => process.exit(3), 120_000);',
].join('\n');

type Msg = Record<string, unknown> & { type: string };

/** Un écran abonné à la Reine, qui retient tout ce qu'il reçoit. */
async function ecran(port: number): Promise<{ recus: Msg[]; fermer: () => void }> {
  const recus: Msg[] = [];
  const e = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((ok, ko) => {
    e.once('open', () => ok());
    e.once('error', ko);
  });
  e.on('message', (brut: Buffer) => recus.push(JSON.parse(brut.toString()) as Msg));
  e.send(JSON.stringify({ type: 'subscribe', token: JETON }));
  await attendre(() => recus.some((m) => m.type === 'state'), 'l’écran n’est pas abonné');
  return { recus, fermer: () => e.close() };
}

/** La dernière mesure EN DIRECT d'une tâche, telle que la Reine la diffuse. */
function mesureDirecte(recus: Msg[], taskId: string): Record<string, unknown> | undefined {
  const m = recus.filter((x) => x.type === 'task_direct' && x.taskId === taskId).at(-1);
  const direct = m?.direct as { metriques?: Record<string, unknown> } | null | undefined;
  return direct?.metriques;
}

describe.skipIf(process.platform === 'win32')(
  'les ressources mesurées sont celles de l’agent',
  () => {
    it('DEUX AGENTS EN MÊME TEMPS SUR UN NŒUD : chacun SA mesure — et jamais `usage` sur le fil', async () => {
      dossier = mkdtempSync(path.join(os.tmpdir(), 'ressources-agent-'));
      const agent = path.join(dossier, 'agent.js');
      const signal = path.join(dossier, 'fin');
      writeFileSync(agent, AGENT);
      // Ce que le nœud envoie à la Reine, tel quel : le fil, pas le parseur.
      const envoyes = vi.spyOn(WebSocket.prototype, 'send');

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
      client = new HiveNodeClient({
        url: `ws://127.0.0.1:${s.port}/ws`,
        token: JETON,
        name: 'ouvriere-ressources',
        ownerName: 'banc',
        agentType: 'custom',
        maxConcurrency: 2,
        workRoot: path.join(dossier, 'travail'),
        adapter: {
          name: 'banc',
          run: (task, ctx) =>
            runCommand(process.execPath, [agent, task.title, signal], ctx, 120_000),
        },
        quiet: true,
      });
      client.start();
      await attendre(
        () => s.store.listNodes().some((n) => n.status === 'online'),
        'le nœud ne rejoint pas la ruche',
      );
      const vue = await ecran(s.port);
      const p = s.store.createProject({ name: 'P' });
      const lourd = s.store.createTask({ projectId: p.id, title: 'lourd', prompt: 'x' });
      const leger = s.store.createTask({ projectId: p.id, title: 'leger', prompt: 'x' });
      s.store.patchTask(lourd.id, { status: 'ready' });
      s.store.patchTask(leger.id, { status: 'ready' });
      // Les deux agents tournent ; le lourd a fini son travail QUAND un relevé
      // voit ses 50 Mio. Alors seulement, le signal de fin.
      await attendre(
        () =>
          Number(mesureDirecte(vue.recus, lourd.id)?.rssOctets ?? 0) >= 70 * MIO &&
          mesureDirecte(vue.recus, leger.id) !== undefined,
        'aucun relevé ne voit le travail de l’agent lourd',
        60_000,
      );
      writeFileSync(signal, '');
      vue.fermer();
      await attendre(
        () => [lourd.id, leger.id].every((id) => s.store.getTask(id)?.status === 'done'),
        'les deux agents ne finissent pas',
      );

      /** Le résultat rangé, sans diff ni logs : ce que le nœud a rendu de l'exécution. */
      const rendu = (taskId: string) => {
        const r = s.store.resultsForTask(taskId).at(-1);
        if (!r) return undefined;
        const { diff: _d, logs: _l, ...reste } = r;
        return reste;
      };
      const l = rendu(lourd.id)?.ressources;
      const g = rendu(leger.id)?.ressources;
      if (l?.portee !== 'arbre' || g?.portee !== 'arbre') {
        // Le résultat ENTIER : ce que le nœud a rendu à la place de la mesure de l'agent.
        const recu = JSON.stringify([rendu(lourd.id), rendu(leger.id)]);
        throw new Error(`mesures de l’arbre de l’agent attendues, reçu : ${recu}`);
      }
      // Le CPU est celui de l'agent : le lourd a brûlé 300 ms, le léger rien.
      expect(l.cpuMs).toBeGreaterThanOrEqual(280);
      expect(g.cpuMs).toBeLessThan(l.cpuMs! - 200);
      // Le pic est celui de SON arbre — pas celui du nœud, le même pour les deux.
      expect(l.picOctets).toBeGreaterThanOrEqual(g.picOctets! + 35 * MIO);
      expect(l.picNoyau, 'un arbre n’a pas de pic tenu par le noyau').toBeUndefined();
      // Le résumé de la tâche porte la même mesure que son résultat.
      expect(s.store.getTask(lourd.id)?.result?.ressources).toEqual(l);

      const resultats = envoyes.mock.calls
        .map(([brut]) => JSON.parse(String(brut)) as Record<string, unknown>)
        .filter((m) => m.type === 'task_result');
      expect(resultats).toHaveLength(2);
      for (const m of resultats) {
        expect(m.ressources).toMatchObject({ portee: 'arbre' });
        expect('usage' in m, 'une Reine plus ancienne rejetterait le résultat entier').toBe(false);
      }
    }, 90_000);
  },
);

describe('la mesure rangée avec son résultat', () => {
  it('se relit avec CE résultat ; celle d’un nœud plus ancien se relit `noeud_ancien`', () => {
    const store = new HiveStore(':memory:');
    try {
      // Une vraie tâche : la mesure est une preuve que la rétention du journal
      // garde AVEC sa tâche — un résultat d'une tâche inconnue n'en a pas.
      const projet = store.createProject({ name: 'P' });
      store.createTask({ id: 'task-usage', projectId: projet.id, title: 'Mesurer', prompt: 'p' });
      const ressources: RessourcesExecution = {
        portee: 'conteneur',
        releves: 3,
        cpuMs: 1_234,
        picOctets: 300 * MIO,
        picNoyau: true,
      };
      const resultat = (extra: object) =>
        store.insertResult({
          taskId: 'task-usage',
          nodeId: 'worker-usage',
          success: true,
          diff: '',
          logs: '',
          durationMs: 42,
          subAgents: [],
          ...extra,
        });
      const neuf = resultat({ ressources });
      // Un résultat rangé par une Reine d'avant : sa mesure était `usage`.
      const ancien = resultat({});
      store.appendEvent('worker_usage', {
        resultId: ancien,
        taskId: 'task-usage',
        nodeId: 'worker-usage',
        ...USAGE_DU_NOEUD,
      });

      const relus = store.resultsForTask('task-usage');
      expect(relus.find((r) => r.resultId === neuf)?.ressources).toEqual(ressources);
      expect(relus.find((r) => r.resultId === ancien)?.ressources).toEqual({
        portee: 'aucune',
        raison: 'noeud_ancien',
      });

      store.appendEvent('after_usage', { taskId: 'other' });
      store.pruneEvents(fenetreSeule(1));
      expect(store.resultsForTask('task-usage')[0]?.ressources).toEqual(ressources);
    } finally {
      store.close();
    }
  });

  it('le résumé rangé sur une tâche par une Reine d’avant ne passe pas pour la mesure de l’agent', () => {
    const store = new HiveStore(':memory:');
    try {
      const projet = store.createProject({ name: 'P' });
      const tache = store.createTask({ projectId: projet.id, title: 'T', prompt: 'p' });
      const resume = { success: true, nodeId: 'n', durationMs: 5, usage: USAGE_DU_NOEUD };
      store.patchTask(tache.id, {
        status: 'done',
        result: resume as unknown as TaskResultSummary,
      });
      expect(store.getTask(tache.id)?.result).toEqual({
        success: true,
        nodeId: 'n',
        durationMs: 5,
        ressources: { portee: 'aucune', raison: 'noeud_ancien' },
      });
    } finally {
      store.close();
    }
  });
});
