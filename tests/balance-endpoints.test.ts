// Contrats HTTP de la Balance : GET /api/balance (garde, forme, mémoïsation) et
// le devis non bloquant greffé sur POST /api/plan. Un devis qui échoue ne doit
// JAMAIS casser un plan — la Balance est une lecture, elle n'a le droit de
// faire échouer aucune route.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CORPUS_BALANCE, VERSION_BALANCE } from '../src/orchestrator/balance.js';
import type { Devis, Pesee } from '../src/orchestrator/balance.js';
import { domaineDeTache } from '../src/orchestrator/pheromones.js';
import type { Domaine } from '../src/orchestrator/pheromones.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { PlannedTask } from '../src/orchestrator/planner.js';

const TOKEN = 'jeton-balance-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

interface ReponseBalance {
  version: number;
  mode: string;
  aJour: boolean;
  pesee: Pesee;
  soldes: Array<{ projectId: string; depenseMs: number; tentatives: number }>;
  fenetre: number;
}

interface DevisPlan {
  parTache: Array<{ title: string; domaine: Domaine } & Devis>;
  totalMedianeMs: number;
  totalP90Ms: number;
}

describe('endpoints de la Balance', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-balance-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000, // les ticks sont déclenchés à la main : rien d'implicite
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  });

  /** Sème `n` tâches terminées d'un domaine donné, chacune avec sa dépense. */
  function semer(titre: string, prompt: string, durees: number[]): string {
    const projet = server.store.createProject({ name: `P-${titre}` });
    durees.forEach((durationMs, i) => {
      const tache = server.store.createTask({
        projectId: projet.id,
        title: `${titre} ${i}`,
        prompt,
      });
      server.store.patchTask(tache.id, { status: 'done' });
      server.store.insertResult({
        taskId: tache.id,
        nodeId: `n${i % 2}`,
        success: true,
        diff: '',
        logs: '',
        durationMs,
        subAgents: [],
      });
    });
    return projet.id;
  }

  it('T1 — GET /api/balance sans token : 401', async () => {
    const res = await fetch(`${base}/api/balance`);
    expect(res.status).toBe(401);
    const mauvais = await fetch(`${base}/api/balance`, {
      headers: { 'x-hive-token': 'pas-le-bon-jeton-du-tout' },
    });
    expect(mauvais.status).toBe(401);
  });

  it('T2 — GET /api/balance rend la version, le mode, l’état du livre, la pesée et les soldes', async () => {
    const projectId = semer('route api', 'creer un endpoint rest', [1_000, 2_000, 3_000]);
    server.scheduler.tick(); // le grand livre rattrape avant qu'on l'interroge

    const res = await fetch(`${base}/api/balance`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReponseBalance;

    expect(Object.keys(body).sort()).toEqual([
      'aJour',
      'fenetre',
      'mode',
      'pesee',
      'soldes',
      'version',
    ]);
    expect(body.version).toBe(VERSION_BALANCE);
    expect(body.mode).toBe('observation'); // défaut : on pèse, on ne bloque rien
    expect(body.aJour).toBe(true);
    expect(body.fenetre).toBe(CORPUS_BALANCE);
    expect(body.soldes).toEqual([{ projectId, depenseMs: 6_000, tentatives: 3 }]);
    // Trois tâches abouties du premier coup : tout le temps a servi.
    expect(body.pesee.global).toMatchObject({
      utileMs: 6_000,
      repriseMs: 0,
      echecMs: 0,
      rebuteMs: 0,
      totalMs: 6_000,
      tentatives: 3,
      rendement: 1,
    });
    expect(body.pesee.version).toBe(VERSION_BALANCE);
    expect(body.pesee.corpus).toEqual({ tentatives: 3, taches: 3, ignorees: 0 });
    expect(body.pesee.parProjet).toEqual([expect.objectContaining({ projectId })]);
  });

  it('la pesée impute les reprises, les échecs et le travail rebuté par la Miellerie', async () => {
    const projet = server.store.createProject({ name: 'P' });
    const creer = (titre: string, status: 'done' | 'failed'): string => {
      const t = server.store.createTask({ projectId: projet.id, title: titre, prompt: 'x' });
      server.store.patchTask(t.id, { status });
      return t.id;
    };
    const reussie = creer('reussie', 'done');
    const rejetee = creer('rejetee', 'done');
    const echouee = creer('echouee', 'failed');
    server.store.setTaskReview(rejetee, 'rejected');
    const poser = (taskId: string, success: boolean, durationMs: number): void =>
      server.store.insertResult({
        taskId,
        nodeId: 'n1',
        success,
        diff: '',
        logs: '',
        durationMs,
        subAgents: [],
      });
    poser(reussie, false, 300); // reprise
    poser(reussie, true, 700); // utile
    poser(rejetee, true, 400); // rebuté (verdict humain)
    poser(echouee, false, 600); // échec

    const body = (await (await fetch(`${base}/api/balance`, { headers })).json()) as ReponseBalance;
    expect(body.pesee.global).toMatchObject({
      utileMs: 700,
      repriseMs: 300,
      rebuteMs: 400,
      echecMs: 600,
      totalMs: 2_000,
      rendement: 0.35,
    });
    expect(body.pesee.reprises).toEqual({ taches: 1, tentatives: 1 });
  });

  it('T7 — deux requêtes rapprochées : une seule lecture du corpus (mémoïsation)', async () => {
    semer('route api', 'creer un endpoint rest', [1_000, 2_000, 3_000]);
    let lectures = 0;
    const vraie = server.store.listResultsForBalance.bind(server.store);
    server.store.listResultsForBalance = (limit?: number) => {
      lectures += 1;
      return limit === undefined ? vraie() : vraie(limit);
    };

    const premier = (await (
      await fetch(`${base}/api/balance`, { headers })
    ).json()) as ReponseBalance;
    const second = (await (
      await fetch(`${base}/api/balance`, { headers })
    ).json()) as ReponseBalance;
    expect(lectures).toBe(1);
    expect(second.pesee).toEqual(premier.pesee);
  });

  it('T6 — POST /api/plan : devis null tant que l’échantillon est maigre', async () => {
    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ brief: 'creer une api rest avec des tests et de la documentation' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: PlannedTask[]; devis: DevisPlan | null };
    expect(body.tasks.length).toBeGreaterThan(0);
    // Aucune tâche comparable terminée : la ruche se tait plutôt que de mentir.
    expect(body.devis).toBeNull();
  });

  it('T6 — POST /api/plan : devis chiffré dès que des tâches comparables sont terminées', async () => {
    // Trois tâches abouties dans CHAQUE domaine, aux mêmes durées : quel que
    // soit le découpage proposé, chaque tâche du plan a son échantillon.
    const modeles: Array<[string, string]> = [
      ['route api rest', 'creer un endpoint serveur'],
      ['interface react', 'composant ui bouton'],
      ['schema sqlite', 'migration base de donnees'],
      ['tests vitest', 'couverture unitaire e2e'],
      ['documentation readme', 'guide et changelog'],
      ['pipeline ci', 'docker deploiement k8s'],
      ['travail divers', 'sans mot cle particulier'],
    ];
    for (const [titre, prompt] of modeles) semer(titre, prompt, [1_000, 2_000, 3_000]);

    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ brief: 'creer une api rest avec des tests et de la documentation' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: PlannedTask[]; devis: DevisPlan | null };
    const devis = body.devis;
    expect(devis).not.toBeNull();
    if (!devis) return;

    // Un devis par tâche proposée, dans l'ordre, avec le domaine deviné.
    expect(devis.parTache).toHaveLength(body.tasks.length);
    expect(devis.parTache.map((d) => d.title)).toEqual(body.tasks.map((t) => t.title));
    expect(devis.parTache.map((d) => d.domaine)).toEqual(
      body.tasks.map((t) => domaineDeTache(t.title, t.prompt)),
    );
    // Échantillon [1 000, 2 000, 3 000] : médiane 2 000, p90 = rang ceil(0,9×3) = 3.
    for (const d of devis.parTache) {
      expect(d).toMatchObject({ echantillon: 3, medianeMs: 2_000, p90Ms: 3_000 });
    }
    expect(devis.totalMedianeMs).toBe(2_000 * body.tasks.length);
    expect(devis.totalP90Ms).toBe(3_000 * body.tasks.length);
  });

  it('T6 — un devis qui LÈVE ne casse jamais le plan (try/catch prouvé)', async () => {
    server.store.listResultsForBalance = () => {
      throw new Error('corpus indisponible');
    };
    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ brief: 'creer une api rest avec des tests et de la documentation' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: PlannedTask[]; devis: DevisPlan | null };
    expect(body.tasks.length).toBeGreaterThan(0); // le plan, lui, est intact
    expect(body.devis).toBeNull();
  });

  it('les tâches encore EN VOL n’entrent pas dans l’échantillon d’un devis', async () => {
    // Trois tâches 'api' dont deux seulement sont terminées : sous le seuil,
    // donc aucun devis — une tâche qui n'a pas fini de dépenser ne peut pas
    // servir de référence.
    const projet = server.store.createProject({ name: 'P' });
    ['done', 'done', 'running'].forEach((status, i) => {
      const t = server.store.createTask({
        projectId: projet.id,
        title: `route api ${i}`,
        prompt: 'creer un endpoint rest serveur',
      });
      server.store.patchTask(t.id, { status: status as 'done' | 'running' });
      server.store.insertResult({
        taskId: t.id,
        nodeId: 'n1',
        success: status === 'done',
        diff: '',
        logs: '',
        durationMs: 1_000,
        subAgents: [],
      });
    });
    const res = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ brief: 'creer une api rest : endpoint serveur et route backend' }),
    });
    const body = (await res.json()) as { tasks: PlannedTask[]; devis: DevisPlan | null };
    const domaines = body.tasks.map((t) => domaineDeTache(t.title, t.prompt));
    expect(domaines).toContain('api');
    expect(body.devis?.parTache.some((d) => d.domaine === 'api') ?? false).toBe(false);
  });
});
