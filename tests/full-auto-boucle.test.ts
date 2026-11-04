// LE FULL AUTO DE BOUT EN BOUT : une vraie Reine, un nœud qui répond, et
// personne pour valider.
//
// Ce que le propriétaire demande en l'allumant — « les agents valident tout
// eux-mêmes, et ils se corrigent » — se mesure ici sur le trajet réel : le
// résultat reçu par la socket, l'inspection des Gardiennes, l'Evaluator, puis
// le verdict canonique (`appliquerRevueHumaine`) et la relance du scheduler.
//
//   · une production propre est APPROUVÉE, sans un clic, et l'approbation dit
//     qui l'a donnée (`source: 'full_auto'`, jamais un compte humain) ;
//   · une production CREUSE repart en correction, avec la critique, et la
//     tentative suivante, propre, est approuvée à son tour ;
//   · éteint, rien ne se passe : la production attend un humain, comme avant ;
//   · allumé après coup, il tranche aussi ce qui attendait déjà ;
//   · le régler est un geste du propriétaire : sans jeton, refusé.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { brancherFauxNoeud, type FauxNoeud } from './aide/faux-noeud.js';

const TOKEN = 'jeton-full-auto-suffisamment-long-7';
const NOEUD = 'noeud-full-auto';

/**
 * Un diff réel sur le fichier que la tâche promet de modifier : un diff qui
 * toucherait un autre fichier serait « suspect » pour les Gardiennes — et le
 * full auto, à raison, renverrait la tâche en correction.
 */
const diffDe = (fichier: string): string =>
  [
    `diff --git a/${fichier} b/${fichier}`,
    `--- a/${fichier}`,
    `+++ b/${fichier}`,
    '@@ -1 +1,2 @@',
    ' const a = 1;',
    '+export const b = 2;',
    '',
  ].join('\n');

// Chaque cas règle le mode qu'il éprouve et répond à chaque tâche qu'il lance :
// la suite tourne dans un ordre tiré au sort (« La suite tient dans plusieurs
// ordres de tests »), aucun cas ne compte sur son voisin.
describe('le full auto, sur une vraie Reine', () => {
  let server: HiveServer;
  let dir: string;
  let noeud: FauxNoeud;
  let projet = '';
  const assignations: string[] = [];

  const jusqua = async (quoi: string, cond: () => boolean, ms = 10_000): Promise<void> => {
    const fin = Date.now() + ms;
    while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 30));
    expect(cond(), `jamais advenu : ${quoi}`).toBe(true);
  };

  const appel = (
    methode: 'GET' | 'POST',
    corps?: unknown,
    { jeton = TOKEN, id = projet }: { jeton?: string | null; id?: string } = {},
  ) =>
    fetch(`http://127.0.0.1:${server.port}/api/projects/${id}/full-auto`, {
      method: methode,
      headers: {
        ...(jeton ? { 'x-hive-token': jeton } : {}),
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });

  const regler = async (actif: boolean): Promise<void> => {
    const r = await appel('POST', { actif });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { actif: boolean }).actif).toBe(actif);
  };

  const fois = (taskId: string): number => assignations.filter((x) => x === taskId).length;

  /** Le fichier qu'une tâche promet de modifier. */
  const fichierDe = (titre: string): string => `src/${titre.replace(/[^a-z]/gi, '')}.ts`;

  /** Crée une tâche prête, attend qu'elle parte vers le nœud, et rend son identifiant. */
  const lancer = async (titre: string): Promise<string> => {
    const t = server.store.createTask({
      projectId: projet,
      title: titre,
      prompt: `modifier ${fichierDe(titre)}`,
    });
    server.store.patchTask(t.id, { status: 'ready' });
    await jusqua(`assignation de « ${titre} »`, () => fois(t.id) > 0);
    return t.id;
  };

  const repondre = (taskId: string, diff: string): void => {
    noeud.ws.send(
      JSON.stringify({
        type: 'task_result',
        taskId,
        success: true,
        diff,
        logs: 'terminé',
        durationMs: 100,
        subAgents: [],
      }),
    );
  };

  const revues = (taskId: string) =>
    server.store
      .evenementsParTypes(['task_reviewed'], 500)
      .filter((e) => e.payload.taskId === taskId);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-full-auto-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: true,
      tickMs: 60,
      gardiennes: 'consultatif',
    });
    // Un dépôt : sans lui, les Gardiennes jugent tout « propre » et la
    // production creuse ne serait jamais vue.
    projet = server.store.createProject({
      name: 'Projet en full auto',
      repoUrl: 'https://github.com/micka/full-auto.git',
    }).id;
    noeud = await brancherFauxNoeud<{ type: string; task?: { id: string } }>(
      server.port,
      {
        token: TOKEN,
        name: NOEUD,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
        nodeId: NOEUD,
      },
      (m) => {
        if (m.type === 'assign_task' && m.task) assignations.push(m.task.id);
      },
    );
  });

  afterAll(async () => {
    await noeud.arreter();
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  it('ÉTEINT PAR DÉFAUT, ET RÉGLÉ PAR LE SEUL PROPRIÉTAIRE', async () => {
    const vierge = server.store.createProject({ name: 'Jamais réglé' }).id;
    const lu = (await (await appel('GET', undefined, { id: vierge })).json()) as {
      actif: boolean;
      tentativesMax: number;
    };
    expect(lu.actif).toBe(false);
    expect(lu.tentativesMax).toBeGreaterThanOrEqual(2);
    const refus = await appel('POST', { actif: true }, { jeton: null, id: vierge });
    expect(refus.status).toBeGreaterThanOrEqual(400);
    expect(server.store.getFullAuto(vierge)?.actif ?? false).toBe(false);
  });

  it('ÉTEINT, UNE PRODUCTION ATTEND UN HUMAIN — allumé ensuite, la file est tranchée', async () => {
    await regler(false);
    const id = await lancer('attend un humain');
    repondre(id, diffDe(fichierDe('attend un humain')));
    await jusqua('la production terminée', () => server.store.getTask(id)?.status === 'done');
    await new Promise((r) => setTimeout(r, 300));
    expect(server.store.getTaskReview(id)).toBeNull();

    await regler(true);
    await jusqua(
      'la production en attente approuvée',
      () => server.store.getTaskReview(id)?.state === 'approved',
    );
  }, 30_000);

  it('UNE PRODUCTION PROPRE EST APPROUVÉE SANS UN CLIC — et dit par qui', async () => {
    await regler(true);
    const id = await lancer('propre');
    repondre(id, diffDe(fichierDe('propre')));
    await jusqua(
      'approbation par le full auto',
      () => server.store.getTaskReview(id)?.state === 'approved',
    );
    const [revue] = revues(id);
    expect(revue?.payload.source).toBe('full_auto');
    expect(
      revue?.payload.parUserId,
      'une approbation du full auto n’est pas celle d’un compte',
    ).toBeNull();
  }, 30_000);

  it('UNE PRODUCTION CREUSE REPART EN CORRECTION, PUIS LA SUIVANTE EST APPROUVÉE', async () => {
    await regler(true);
    const id = await lancer('creuse puis corrigée');
    const essais = server.store.getTask(id)?.attempts ?? 0;
    repondre(id, '');
    // La correction : la MÊME tâche repart vers le nœud, une tentative de plus.
    await jusqua('la tâche renvoyée au nœud', () => fois(id) > 1);
    const reprise = server.store
      .evenementsParTypes(['task_retry'], 200)
      .find((e) => e.payload.taskId === id);
    expect(reprise?.payload.source).toBe('evaluator');
    expect(reprise?.payload.attempt).toBe(essais + 1);
    expect(JSON.stringify(reprise?.payload.critique ?? {})).toMatch(/creuse/);
    expect(server.store.getTask(id)?.attempts).toBe(essais + 1);

    repondre(id, diffDe(fichierDe('creuse puis corrigée')));
    await jusqua(
      'la tentative corrigée approuvée',
      () => server.store.getTaskReview(id)?.state === 'approved',
    );
    const gestes = revues(id).map((e) => e.payload.state);
    expect(gestes).toContain('rejected');
    expect(gestes).toContain('approved');

    const etat = (await (await appel('GET')).json()) as {
      bilan: {
        validees: number;
        corrigees: number;
        derniers: { taskId: string; titre: string | null; geste: string }[];
      };
      enAttente: number;
    };
    expect(etat.bilan.validees).toBeGreaterThanOrEqual(1);
    expect(etat.bilan.corrigees).toBeGreaterThanOrEqual(1);
    expect(etat.enAttente).toBe(0);
    const miennes = etat.bilan.derniers.filter((d) => d.taskId === id);
    expect(miennes.map((d) => d.geste).sort()).toEqual(['approuver', 'corriger']);
    expect(miennes[0]?.titre).toBe('creuse puis corrigée');
  }, 40_000);

  it('ÉTEINT : plus rien n’est tranché', async () => {
    await regler(false);
    const id = await lancer('après l’arrêt');
    repondre(id, diffDe(fichierDe('après l’arrêt')));
    await jusqua('la production terminée', () => server.store.getTask(id)?.status === 'done');
    await new Promise((r) => setTimeout(r, 300));
    expect(server.store.getTaskReview(id)).toBeNull();
    // Rendue à un humain : la file la garde pour lui.
    const etat = (await (await appel('GET')).json()) as { actif: boolean; enAttente: number };
    expect(etat.actif).toBe(false);
    expect(etat.enAttente).toBeGreaterThanOrEqual(1);
  }, 30_000);
});
