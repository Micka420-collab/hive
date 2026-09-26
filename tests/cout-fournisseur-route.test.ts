// La déclaration fournisseur traverse la ruche : un vrai nœud (HiveNodeClient)
// rend deux tentatives dont l'adaptateur déclare coût et temps modèle ; la
// Reine les range dans les événements d'issue (`task_retry`, `task_done`),
// nettoyées — jamais estimées quand rien n'est déclaré.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';
import type { UsageFournisseur } from '../src/shared/types.js';

const JETON = 'jeton-cout-fournisseur-suffisamment-long';

let serveur: HiveServer | null = null;
let client: HiveNodeClient | null = null;
let dossier = '';

afterEach(async () => {
  client?.stop();
  client = null;
  await serveur?.stop();
  serveur = null;
  if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
});

async function attendre(condition: () => boolean, message: string): Promise<void> {
  const fin = Date.now() + 15_000;
  while (Date.now() < fin) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

describe('la déclaration fournisseur — d’un vrai nœud jusqu’au journal de la Reine', () => {
  it('RANGÉE DANS LES ISSUES, NETTOYÉE, ET ABSENTE QUAND RIEN N’EST DÉCLARÉ', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'cout-fournisseur-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dossier, 'hive.db'),
      simulation: false,
      tickMs: 40,
    });
    const declarations: Array<UsageFournisseur | undefined> = [
      { source: 'claude-code', coutUsd: 0.012, dureeApiMs: 900 },
      // Un nom de modèle illisible est abandonné par la Reine, le reste tient.
      {
        source: 'claude-code',
        coutUsd: 0.03,
        dureeApiMs: 2_100,
        modeles: ['claude-sonnet-4-5-20250929', 'nom illisible'],
      },
      undefined,
    ];
    let appels = 0;
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${serveur.port}/ws`,
      token: JETON,
      name: 'ouvriere-cout',
      ownerName: 'banc',
      agentType: 'claude-code',
      // Un modèle déclaré : le registre Genome range les faits sous lui.
      modeles: ['sonnet'],
      maxConcurrency: 1,
      workRoot: path.join(dossier, 'travail'),
      adapter: {
        name: 'banc',
        async run() {
          const declaration = declarations[appels];
          appels += 1;
          await new Promise((r) => setTimeout(r, 20));
          return {
            success: appels !== 1,
            diff: '',
            logs: 'ok',
            subAgents: [],
            ...(declaration ? { fournisseur: declaration } : {}),
          };
        },
      },
      quiet: true,
    });
    client.start();
    const s = serveur;
    await attendre(
      () => s.store.listNodes().some((n) => n.status === 'online'),
      'le nœud ne rejoint pas la ruche',
    );
    const p = s.store.createProject({ name: 'P' });
    const t = s.store.createTask({ projectId: p.id, title: 'Écrire le module', prompt: 'x' });
    s.store.patchTask(t.id, { status: 'ready' });
    await attendre(() => s.store.getTask(t.id)?.status === 'done', 'la tâche ne se termine pas');
    const sansDeclaration = s.store.createTask({
      projectId: p.id,
      title: 'Écrire un autre module',
      prompt: 'y',
    });
    s.store.patchTask(sansDeclaration.id, { status: 'ready' });
    await attendre(
      () => s.store.getTask(sansDeclaration.id)?.status === 'done',
      'la seconde tâche ne se termine pas',
    );

    const issues = s.store.evenementsDeTache(t.id, ['task_retry', 'task_done']);
    expect(issues.map((e) => e.type)).toEqual(['task_retry', 'task_done']);
    expect(issues[0]?.payload.fournisseur).toEqual({
      source: 'claude-code',
      coutUsd: 0.012,
      dureeApiMs: 900,
    });
    expect(issues[1]?.payload.fournisseur).toEqual({
      source: 'claude-code',
      coutUsd: 0.03,
      dureeApiMs: 2_100,
      modeles: ['claude-sonnet-4-5-20250929'],
    });

    const [fait] = s.store.evenementsDeTache(sansDeclaration.id, ['task_done']);
    expect(fait?.payload, 'rien de déclaré, rien d’inventé').not.toHaveProperty('fournisseur');

    // ─── ET L'ÉCRAN LE DIT : chronologie de la tâche, registre Genome ────────
    const base = `http://127.0.0.1:${s.port}`;
    const headers = { 'x-hive-token': JETON };
    const lire = async <T>(chemin: string): Promise<T> => {
      const r = await fetch(`${base}${chemin}`, { headers });
      expect(r.status, chemin).toBe(200);
      return (await r.json()) as T;
    };
    type Somme = { total: number; declarees: number; tentatives: number } | 'inconnu';

    const { chronologie } = await lire<{
      chronologie: { dureeModele: Somme; coutFournisseur: Somme };
    }>(`/api/tasks/${t.id}/chronologie`);
    expect(chronologie.dureeModele).toEqual({ total: 3_000, declarees: 2, tentatives: 2 });
    expect(chronologie.coutFournisseur).toMatchObject({ declarees: 2, tentatives: 2 });
    expect(
      chronologie.coutFournisseur !== 'inconnu' && chronologie.coutFournisseur.total,
    ).toBeCloseTo(0.042, 10);

    const { chronologie: muette } = await lire<{
      chronologie: { dureeModele: Somme; coutFournisseur: Somme };
    }>(`/api/tasks/${sansDeclaration.id}/chronologie`);
    expect(muette.coutFournisseur, 'rien de déclaré : inconnu, pas zéro').toBe('inconnu');

    const genome = await lire<{
      lignes: Array<{
        modele: string;
        coutFournisseur: Somme;
        dureeModele: Somme;
        modelesExacts: string[];
      }>;
    }>('/api/genome');
    const sonnet = genome.lignes.filter((l) => l.modele === 'sonnet');
    const couverture = sonnet.reduce(
      (n, l) => n + (l.coutFournisseur === 'inconnu' ? 0 : l.coutFournisseur.declarees),
      0,
    );
    const tentatives = sonnet.reduce(
      (n, l) => n + (l.coutFournisseur === 'inconnu' ? 0 : l.coutFournisseur.tentatives),
      0,
    );
    expect(couverture, 'deux tentatives déclarées').toBe(2);
    expect(tentatives, 'trois rendues, dont une muette').toBe(3);
    expect(sonnet.flatMap((l) => l.modelesExacts)).toContain('claude-sonnet-4-5-20250929');
  });
});
