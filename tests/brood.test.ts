// Tests de la Couveuse (Brood Chamber) : module pur (formatage des leçons,
// extraction des lignes d'erreur, nettoyage ANSI, budget) et câblage
// bout-en-bout — une tâche qui échoue puis est ré-assignée repart avec les
// leçons de son échec dans le hiveContext.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { extraitDesLogs, leconsDesEchecs } from '../src/orchestrator/brood.js';
import type { EchecPrecedent } from '../src/orchestrator/brood.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Task } from '../src/shared/types.js';

const TOKEN = 'jeton-couveuse-assez-long';

const PIED = 'Ne répète pas ces erreurs ; corrige la cause avant tout.';

const echec = (
  attempt: number,
  nodeName: string,
  logs: string,
  createdAt = attempt,
): EchecPrecedent => ({ attempt, nodeName, logs, createdAt });

describe('leconsDesEchecs (module pur)', () => {
  it('retourne un bloc vide sans échec', () => {
    expect(leconsDesEchecs([], 3_000)).toBe('');
  });

  it('formate deux échecs : en-tête, tentatives nommées, consigne finale', () => {
    const bloc = leconsDesEchecs(
      [
        echec(1, 'ruche-alpha', 'Error: fichier manquant'),
        echec(2, 'ruche-beta', 'TypeError: x is not a function'),
      ],
      3_000,
    );
    expect(bloc).toContain('⚠️ Couveuse — cette tâche a déjà échoué 2 fois');
    expect(bloc).toContain('— Tentative 1 (ruche-alpha) : Error: fichier manquant');
    expect(bloc).toContain('— Tentative 2 (ruche-beta) : TypeError: x is not a function');
    expect(bloc.endsWith(PIED)).toBe(true);
  });

  it("privilégie les lignes d'erreur au milieu du bruit", () => {
    const logs = [
      'installation des dépendances…',
      'compilation ok',
      'Error: module introuvable',
      'ligne intermédiaire quelconque',
      'AssertionError: attendu 2, reçu 3',
      'nettoyage du cache terminé',
    ].join('\n');
    const extrait = extraitDesLogs(logs);
    expect(extrait).toContain('Error: module introuvable');
    expect(extrait).toContain('AssertionError: attendu 2, reçu 3');
    expect(extrait).not.toContain('compilation ok');
    expect(extrait).not.toContain('nettoyage du cache');
  });

  it("retient au plus les 6 DERNIÈRES lignes d'erreur (sinon les 6 dernières tout court)", () => {
    const erreurs = Array.from({ length: 8 }, (_, i) => `erreur numéro ${i + 1}`).join('\n');
    const extrait = extraitDesLogs(erreurs);
    expect(extrait).not.toContain('erreur numéro 1 ');
    expect(extrait).not.toContain('erreur numéro 2');
    expect(extrait).toContain('erreur numéro 3');
    expect(extrait).toContain('erreur numéro 8');

    // Aucune ligne « erreur » : les 6 dernières lignes non vides, simplement.
    const neutre = Array.from({ length: 10 }, (_, i) => `ligne ${i + 1}`).join('\n\n');
    const extraitNeutre = extraitDesLogs(neutre);
    expect(extraitNeutre).not.toContain('ligne 4');
    expect(extraitNeutre).toContain('ligne 5');
    expect(extraitNeutre).toContain('ligne 10');
  });

  it("retire les séquences d'échappement ANSI", () => {
    const extrait = extraitDesLogs('\u001B[31mErreur: explosion\u001B[0m\n\u001B[2K\u001B[1Aok');
    expect(extrait).toContain('Erreur: explosion');
    expect(extrait).not.toContain('\u001B');
    expect(extrait).not.toContain('[31m');
  });

  it('borne le bloc au budget en retirant les tentatives les plus ANCIENNES', () => {
    const verbeux = (n: number) => `échec verbeux ${n} : ${'x'.repeat(400)}`;
    const bloc = leconsDesEchecs(
      [echec(1, 'a', verbeux(1)), echec(2, 'b', verbeux(2)), echec(3, 'c', verbeux(3))],
      600,
    );
    expect(bloc.length).toBeLessThanOrEqual(600);
    expect(bloc).not.toContain('Tentative 1');
    expect(bloc).toContain('Tentative 2');
    expect(bloc).toContain('Tentative 3');
    // L'en-tête annonce toujours le nombre TOTAL d'échecs, et la consigne survit.
    expect(bloc).toContain('échoué 3 fois');
    expect(bloc.endsWith(PIED)).toBe(true);
  });

  it('tronque le dernier extrait avec une ellipse quand une seule tentative déborde', () => {
    const bloc = leconsDesEchecs([echec(1, 'ruche-alpha', `Error: ${'y'.repeat(300)}`)], 260);
    expect(bloc.length).toBeLessThanOrEqual(260);
    expect(bloc).toContain('— Tentative 1 (ruche-alpha)');
    expect(bloc).toContain('…');
    expect(bloc.endsWith(PIED)).toBe(true);
  });

  it('tronque les lignes de plus de 200 caractères', () => {
    const extrait = extraitDesLogs(`Error: ${'z'.repeat(500)}`);
    expect(extrait.length).toBe(200);
    expect(extrait.endsWith('…')).toBe(true);
  });
});

describe('câblage bout-en-bout : la 2e ouvrière hérite des leçons', () => {
  let server: HiveServer;
  let dir: string;
  let client: HiveNodeClient;
  // Le hiveContext n'arrive pas tel quel à l'adaptateur : le client le préfixe
  // au prompt (composeAgentPrompt) avant d'appeler run(). On capture donc
  // task.prompt par tentative — c'est là que les leçons doivent apparaître.
  const promptsRecus = new Map<number, string>();

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-brood-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 80,
    });

    // Adaptateur qui ÉCHOUE à la 1re exécution (logs avec un TypeError) puis
    // RÉUSSIT à la 2e.
    const adapter: AgentAdapter = {
      name: 'echoue-puis-reussit',
      async run(task, ctx) {
        promptsRecus.set(ctx.attempt, task.prompt);
        if (ctx.attempt === 1) {
          return {
            success: false,
            diff: '',
            logs: 'démarrage du build\nTypeError: x is not a function\n    at main.js:3',
            subAgents: [],
          };
        }
        return { success: true, diff: '', logs: 'corrigé', subAgents: [] };
      },
    };
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${server.port}/ws`,
      token: TOKEN,
      name: 'ouvriere-couveuse',
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
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

  it(
    'injecte les leçons à la ré-assignation et journalise brood_context',
    { timeout: 20_000 },
    async () => {
      const base = `http://127.0.0.1:${server.port}`;
      const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

      const project = (await (
        await fetch(`${base}/api/projects`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: 'Ruche Couveuse' }),
        })
      ).json()) as { id: string };
      const tasksRes = await fetch(`${base}/api/projects/${project.id}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tasks: [
            { id: 'larve-1', title: 'Tâche fragile', prompt: 'faire quelque chose de délicat' },
          ],
        }),
      });
      expect(tasksRes.status).toBe(201);

      // Attendre échec → re-tentative → succès, comme un vrai client.
      const deadline = Date.now() + 15_000;
      let task: Task | undefined;
      while (Date.now() < deadline) {
        const snap = (await (await fetch(`${base}/api/state`, { headers })).json()) as {
          tasks: Task[];
        };
        task = snap.tasks.find((t) => t.id === 'larve-1');
        if (task?.status === 'done') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(task?.status).toBe('done');
      expect(task?.attempts).toBe(1); // une tentative brûlée par le premier échec

      // 1re tentative : la tâche n'avait jamais échoué → aucune leçon.
      expect(promptsRecus.get(1)).toBeDefined();
      expect(promptsRecus.get(1)).not.toContain('Couveuse');

      // 2e tentative : les leçons de la Couveuse, avec l'erreur d'origine et
      // le nom du nœud fautif — et le prompt d'origine préservé à la fin.
      const prompt2 = promptsRecus.get(2);
      expect(prompt2).toBeDefined();
      expect(prompt2).toContain('Couveuse');
      expect(prompt2).toContain('TypeError: x is not a function');
      expect(prompt2).toContain('ouvriere-couveuse');
      expect(prompt2?.endsWith('faire quelque chose de délicat')).toBe(true);

      // L'événement brood_context est journalisé, une seule fois, avec le compte.
      const events = (await (await fetch(`${base}/api/events?limit=1000`, { headers })).json()) as {
        type: string;
        payload: Record<string, unknown>;
      }[];
      const brood = events.filter((e) => e.type === 'brood_context');
      expect(brood).toHaveLength(1);
      expect(brood[0]?.payload.taskId).toBe('larve-1');
      expect(brood[0]?.payload.echecs).toBe(1);
      expect(String(brood[0]?.payload.message)).toContain('👶 Couveuse');
      expect(String(brood[0]?.payload.message)).toContain('Tâche fragile');
    },
  );
});
