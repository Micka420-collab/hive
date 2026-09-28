// LE TRAJET D'UNE MISSION REJOUABLE — de bout en bout, contre la vraie Reine.
//
// Ce que ce fichier prouve, dans l'ordre où un humain le vit :
//
//   1. une mission s'OUVRE seule quand des tâches naissent, avec son instantané
//      de début ; elle se CLÔT seule quand plus rien n'y vole, avec son
//      instantané de fin — et une annulation y reste une annulation ;
//   2. on la REJOUE dans un projet neuf, modèle / routage / autonomie imposés,
//      et le modèle imposé n'est jamais remplacé en silence ;
//   3. AUCUNE action irréversible d'un rejeu ne part d'elle-même : livraison,
//      fusion, commit local, poussée, workflow, et la ruche autonome. Un faux
//      GitHub tient le compte de TOUT ce qu'on lui demande — c'est l'espion ;
//   4. un humain (un compte, jamais le jeton de ruche) peut valider, et alors
//      seulement l'effet part. Une simulation répond par un REFUS (409,
//      `rejeu_simule`) : un 2xx faisait croire aux clients que l'effet était
//      parti (un suivi de merge sans `mergeId`, une « PR #undefined ») ;
//   5. la comparaison se lit.

import { createServer as createHttp } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { ComparaisonMissions, InstantaneMission } from '../src/shared/mission-rejouable.js';

const TOKEN = 'jeton-missions-rejouables-assez-long';
const hive = { 'content-type': 'application/json', 'x-hive-token': TOKEN };
const DEPOT_URL = 'https://github.com/moi/site.git';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,1 @@',
  '-const a = 1;',
  '+const a = 2;',
].join('\n');

/** Un GitHub simulé qui NOTE chaque appel : l'espion des effets irréversibles. */
async function fauxGithub(): Promise<{
  url: string;
  appels: Array<{ methode: string; chemin: string }>;
  fermer: () => Promise<void>;
}> {
  const appels: Array<{ methode: string; chemin: string }> = [];
  let prochainePr = 41;
  const srv: Server = createHttp((req, rep) => {
    const chemin = req.url ?? '';
    appels.push({ methode: req.method ?? 'GET', chemin });
    const envoyer = (code: number, corps: unknown): void => {
      rep.writeHead(code, { 'content-type': 'application/json' });
      rep.end(JSON.stringify(corps));
    };
    req.on('data', () => undefined);
    req.on('end', () => {
      if (chemin.includes('/git/ref/heads/')) return envoyer(200, { object: { sha: 'base' } });
      if (chemin.includes('/contents/')) {
        return envoyer(200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('const a = 1;\n', 'utf8').toString('base64'),
        });
      }
      if (chemin.endsWith('/git/blobs')) return envoyer(201, { sha: 'blob' });
      if (chemin.endsWith('/git/trees')) return envoyer(201, { sha: 'tree' });
      if (chemin.endsWith('/git/commits')) return envoyer(201, { sha: 'commit' });
      if (chemin.endsWith('/git/refs')) return envoyer(201, { ref: 'refs/heads/hive/x' });
      if (chemin.endsWith('/merge')) return envoyer(200, { merged: true, sha: 'merge' });
      if (chemin.endsWith('/pulls')) return envoyer(201, { number: ++prochainePr });
      envoyer(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`,
    appels,
    fermer: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

async function jusqua(cond: () => boolean, msMax = 5_000): Promise<boolean> {
  const fin = Date.now() + msMax;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return cond();
}

const ENV = ['HIVE_RUNNER', 'HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API'] as const;

describe('les missions rejouables, de bout en bout', () => {
  let server: HiveServer | null = null;
  let gh: Awaited<ReturnType<typeof fauxGithub>> | null = null;
  let dir: string | null = null;
  const avant: Partial<Record<(typeof ENV)[number], string | undefined>> = {};

  afterEach(async () => {
    await server?.stop();
    server = null;
    await gh?.fermer();
    gh = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    for (const cle of ENV) {
      if (avant[cle] === undefined) delete process.env[cle];
      else process.env[cle] = avant[cle];
    }
  });

  async function demarrer(opts: { runner?: boolean } = {}) {
    for (const cle of ENV) avant[cle] = process.env[cle];
    gh = await fauxGithub();
    if (opts.runner) process.env.HIVE_RUNNER = 'on';
    else delete process.env.HIVE_RUNNER;
    process.env.HIVE_GITHUB_API = `${gh.url}/api`;
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-simule';
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-rejeu-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 30,
      trustProxy: 'loopback',
    });
    return { base: `http://127.0.0.1:${server.port}`, srv: server, faux: gh };
  }

  /** Une production livrable (terminée, avec son diff) sur une tâche existante. */
  function rendreLivrable(srv: HiveServer, taskId: string): void {
    srv.store.patchTask(taskId, { status: 'done', assignedNodeId: 'noeud-1' });
    srv.store.insertResult({
      taskId,
      nodeId: 'noeud-1',
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
  }

  it('une mission s’ouvre et se clôt seule, se rejoue sous surcharges, et se compare', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Site', repoUrl: DEPOT_URL }).id;
    srv.store.setEssaim(p, { niveau: 'propose', depotInscrit: false }, 'humain');
    srv.store.setGardeFou(p, { actif: true, borneMin: 'leger', borneMax: 'standard' }, 'humain');

    const creees = await fetch(`${base}/api/projects/${p}/tasks`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({
        tasks: [
          { id: 'ta', title: 'Écrire la page', prompt: 'Écris la page d’accueil.' },
          { id: 'tb', title: 'Tester la page', prompt: 'Teste-la.', dependsOn: ['ta'] },
        ],
      }),
    });
    expect(creees.status).toBe(201);

    // 1. L'OUVERTURE : une mission, un instantané de début complet.
    expect(await jusqua(() => srv.store.listMissions(p).length === 1)).toBe(true);
    const mission = srv.store.listMissions(p)[0]!;
    const detail = (await (
      await fetch(`${base}/api/projects/${p}/missions/${mission.id}`, { headers: hive })
    ).json()) as { debut: InstantaneMission; fin: InstantaneMission | null };
    expect(detail.fin).toBeNull();
    expect(detail.debut.plan.taches.map((t) => [t.ref, t.prompt, t.dependsOn])).toEqual([
      ['ta', 'Écris la page d’accueil.', []],
      ['tb', 'Teste-la.', ['ta']],
    ]);
    expect(detail.debut.autonomie.niveau).toBe('propose');
    expect(detail.debut.gardeFous).toEqual({
      actif: true,
      borneMin: 'leger',
      borneMax: 'standard',
    });
    expect(detail.debut.projet.depot).toBe('https://github.com/moi/site.git');

    // 2. LA CLÔTURE : plus rien ne vole — deux annulations humaines.
    for (const id of ['tb', 'ta']) {
      const r = await fetch(`${base}/api/tasks/${id}/cancel`, { method: 'POST', headers: hive });
      expect(r.status).toBe(200);
    }
    expect(await jusqua(() => srv.store.getMission(mission.id)?.closeA !== null)).toBe(true);
    const liste = (await (
      await fetch(`${base}/api/projects/${p}/missions`, { headers: hive })
    ).json()) as {
      missions: Array<{ resume: { taches: Record<string, number>; reussie: unknown } }>;
    };
    // La table les range « failed » ; le journal dit « annulées » — l'audit aussi.
    expect(liste.missions[0]?.resume.taches).toMatchObject({ cancelled: 2, failed: 0 });
    expect(liste.missions[0]?.resume.reussie).toBe(false);

    // 3. LE REJEU : modèle imposé, Genome figé, autonomie coupée.
    const rejouer = await fetch(`${base}/api/projects/${p}/missions/${mission.id}/rejouer`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({
        modele: 'modele-impose',
        politiqueRoutage: 'figee',
        autonomie: 'off',
      }),
    });
    expect(rejouer.status, await rejouer.clone().text()).toBe(201);
    const { projet, taches } = (await rejouer.json()) as {
      projet: { id: string; repoUrl: string };
      taches: Array<{ id: string; prompt: string; dependsOn: string[] }>;
    };
    expect(projet.repoUrl).toBe(DEPOT_URL);
    expect(taches.map((t) => t.prompt)).toEqual(['Écris la page d’accueil.', 'Teste-la.']);
    expect(taches[1]?.dependsOn).toEqual([taches[0]?.id]);
    expect(srv.store.rejeuDuProjet(projet.id)).toMatchObject({
      missionSource: mission.id,
      projetSource: p,
      surcharges: { modele: 'modele-impose', politiqueRoutage: 'figee', autonomie: 'off' },
    });
    expect(Array.isArray(srv.store.rejeuDuProjet(projet.id)?.genomeFige)).toBe(true);
    expect(srv.store.getGardeFou(projet.id)).toMatchObject({ actif: true, borneMax: 'standard' });
    expect(srv.store.getEssaim(projet.id)).toBeNull();

    // Le modèle imposé n'est offert par personne : les tâches ATTENDENT, et
    // la ruche le dit — elles ne partent pas sur le modèle d'une autre ouvrière.
    srv.store.registerNode({
      nodeId: 'n-autre',
      name: 'autre',
      ownerName: 'test',
      agentType: 'claude-code',
      maxConcurrency: 2,
      modeles: ['un-autre-modele'],
    });
    srv.store.setNodeStatus('n-autre', 'online');
    srv.scheduler.tick();
    expect(
      await jusqua(() =>
        srv.store.listEvents(0, 1000).some((e) => e.type === 'rejeu_modele_absent'),
      ),
    ).toBe(true);
    expect(srv.store.listTasks(projet.id).every((t) => t.assignedNodeId === null)).toBe(true);
    // Le témoin : ce même nœud PREND le travail d'un projet ordinaire — c'est
    // bien le modèle imposé qui retient le rejeu, pas un nœud inutilisable.
    const temoin = srv.store.createProject({ name: 'Témoin' }).id;
    const tt = srv.store.createTask({ projectId: temoin, title: 'Témoin', prompt: 'x' });
    srv.scheduler.tick();
    expect(await jusqua(() => srv.store.getTask(tt.id)?.assignedNodeId === 'n-autre')).toBe(true);
    expect(srv.store.listTasks(projet.id).every((t) => t.assignedNodeId === null)).toBe(true);

    // 4. LA COMPARAISON : l'original clos, le rejeu en vol (provisoire).
    expect(await jusqua(() => srv.store.listMissions(projet.id).length === 1)).toBe(true);
    const cmp = await fetch(`${base}/api/projects/${projet.id}/rejeu/comparaison`, {
      headers: hive,
    });
    expect(cmp.status, await cmp.clone().text()).toBe(200);
    const c = (await cmp.json()) as ComparaisonMissions;
    expect(c.original.taches.cancelled).toBe(2);
    expect(c.rejeu.provisoire).toBe(true);
    expect(c.ecarts.cout.ecart).toBe('inconnu');
    // Un projet ordinaire n'a rien à comparer, et le dit.
    const pasUnRejeu = await fetch(`${base}/api/projects/${p}/rejeu/comparaison`, {
      headers: hive,
    });
    expect(pasUnRejeu.status).toBe(404);
  });

  it('UNE TÂCHE NÉE SANS `task_created` (la Fabrique) ouvre sa mission à son affectation — et un Genome figé illisible SE DIT', async () => {
    const { base, srv } = await demarrer();
    srv.store.registerNode({
      nodeId: 'n1',
      name: 'n1',
      ownerName: 'test',
      agentType: 'claude-code',
      maxConcurrency: 4,
    });
    srv.store.setNodeStatus('n1', 'online');

    // La Fabrique crée sa tâche sans aucune naissance au journal.
    const p = srv.store.createProject({ name: 'Outillage' }).id;
    const f = await fetch(`${base}/api/projects/${p}/fabriques`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ genre: 'script_npm', libelle: 'Outillage' }),
    });
    expect(f.status, await f.clone().text()).toBe(200);
    const { taskId } = (await f.json()) as { taskId: string };
    srv.scheduler.tick();
    expect(await jusqua(() => srv.store.listMissions(p).length === 1)).toBe(true);
    expect(srv.store.membresDeMission(srv.store.listMissions(p)[0]!.id)).toEqual([taskId]);

    // Un rejeu « figé » dont le Genome recopié est illisible : ses tâches
    // attendent, et le journal le dit — une fois, pas à chaque passe.
    const r = srv.store.createProject({ name: 'Rejeu figé' }).id;
    srv.store.inscrireRejeu({
      projectId: r,
      missionSource: 'source',
      projetSource: p,
      surcharges: { politiqueRoutage: 'figee' },
      genomeFige: null,
      creePar: null,
      creeA: Date.now(),
    });
    const t = srv.store.createTask({ projectId: r, title: 'Attendre', prompt: 'x' });
    srv.store.patchTask(t.id, { status: 'ready' });
    for (let i = 0; i < 3; i++) srv.scheduler.tick();
    const dits = () =>
      srv.store.listEvents(0, 1000).filter((e) => e.type === 'rejeu_genome_illisible');
    expect(await jusqua(() => dits().length > 0)).toBe(true);
    expect(dits()).toHaveLength(1);
    expect(srv.store.getTask(t.id)?.assignedNodeId).toBeNull();
  });

  it('AUCUNE action irréversible d’un rejeu ne part sans un humain — l’espion GitHub n’entend rien', async () => {
    const { base, srv, faux } = await demarrer();
    // L'administratrice : le premier compte inscrit avec le jeton de ruche.
    const inscription = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({
        email: 'reine@ruche.test',
        password: 'motdepasse-assez-long-42',
        displayName: 'Reine',
      }),
    });
    const compte = {
      'content-type': 'application/json',
      authorization: `Bearer ${((await inscription.json()) as { token: string }).token}`,
    };

    const p = srv.store.createProject({ name: 'Site', repoUrl: DEPOT_URL }).id;
    await fetch(`${base}/api/projects/${p}/tasks`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ tasks: [{ id: 'orig', title: 'Faire', prompt: 'Fais-le.' }] }),
    });
    expect(await jusqua(() => srv.store.listMissions(p).length === 1)).toBe(true);
    const mission = srv.store.listMissions(p)[0]!;
    const rejouer = await fetch(`${base}/api/projects/${p}/missions/${mission.id}/rejouer`, {
      method: 'POST',
      headers: hive,
      body: '{}',
    });
    expect(rejouer.status).toBe(201);
    const { projet, taches } = (await rejouer.json()) as {
      projet: { id: string };
      taches: Array<{ id: string }>;
    };
    const tache = taches[0]!.id;
    rendreLivrable(srv, tache);

    // LIVRER : simulée, rangée, rien de réservé — et le jeton ne valide pas.
    for (const corps of [{ taskId: tache }, { taskId: tache, validerRejeu: true }]) {
      const r = await fetch(`${base}/api/livraison`, {
        method: 'POST',
        headers: hive,
        body: JSON.stringify(corps),
      });
      expect(r.status, await r.clone().text()).toBe(409);
      expect(await r.json()).toMatchObject({ code: 'rejeu_simule', simule: true });
    }
    expect(srv.store.getLivraison(tache)).toBeNull();

    // LE COMMIT LOCAL et LA POUSSÉE : simulés avant qu'aucun nœud ne soit choisi.
    for (const pousser of [false, true]) {
      const r = await fetch(`${base}/api/projects/${projet.id}/livraison-locale`, {
        method: 'POST',
        headers: hive,
        body: JSON.stringify({ pousser, forcer: { raison: 'banc de rejeu' } }),
      });
      expect(r.status, await r.clone().text()).toBe(409);
      expect(await r.json()).toMatchObject({
        code: 'rejeu_simule',
        simule: true,
        genre: pousser ? 'poussee' : 'livraison_locale',
      });
    }

    // LE WORKFLOW (un connecteur qui tourne chez GitHub, avec ses secrets).
    const wf = await fetch(`${base}/api/projects/${projet.id}/workflows/123/run`, {
      method: 'POST',
      headers: hive,
      body: '{}',
    });
    expect(wf.status, await wf.clone().text()).toBe(409);
    expect(await wf.json()).toMatchObject({ code: 'rejeu_simule', genre: 'workflow' });

    // L'ESPION : pas un seul appel au dépôt.
    expect(faux.appels).toEqual([]);
    expect(
      srv.store.actionsDuRejeu(projet.id).map((a) => [a.genre, a.issue]),
      'chaque action demandée est rangée, une fois',
    ).toEqual([
      ['livraison_pr', 'simulee'],
      ['livraison_locale', 'simulee'],
      ['poussee', 'simulee'],
      ['workflow', 'simulee'],
    ]);

    // UN HUMAIN VALIDE (un compte) : alors, et alors seulement, la PR s'ouvre.
    const validee = await fetch(`${base}/api/livraison`, {
      method: 'POST',
      headers: compte,
      body: JSON.stringify({ taskId: tache, validerRejeu: true }),
    });
    expect(validee.status, await validee.clone().text()).toBe(201);
    expect(faux.appels.some((a) => a.methode === 'POST' && a.chemin.endsWith('/pulls'))).toBe(true);
    const pr = srv.store.getLivraison(tache)?.pr ?? 0;
    expect(pr).toBeGreaterThan(0);

    // LA FUSION de cette PR, elle, reste simulée tant qu'on ne la valide pas.
    const avantFusion = faux.appels.length;
    const fusion = await fetch(`${base}/api/livraison/fusion`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ projectId: projet.id, pr, forcer: { raison: 'banc' } }),
    });
    expect(fusion.status, await fusion.clone().text()).toBe(409);
    expect(await fusion.json()).toMatchObject({ code: 'rejeu_simule', genre: 'fusion_pr' });
    expect(faux.appels.slice(avantFusion)).toEqual([]);
    expect(srv.store.actionsDuRejeu(projet.id).map((a) => [a.genre, a.issue])).toContainEqual([
      'livraison_pr',
      'validee',
    ]);

    // Et sur le projet SOURCE, rien n'a changé : la porte ne mord que les rejeux.
    expect(srv.store.actionsDuRejeu(p)).toEqual([]);
  });

  it('LA RUCHE AUTONOME D’UN REJEU NE LIVRE JAMAIS : elle simule, une fois, et GitHub n’entend rien', async () => {
    const { base, srv, faux } = await demarrer({ runner: true });
    // Même décor que tests/essaim-livraison.test.ts : deux gouvernantes, une
    // production relue et approuvée — la ruche ordinaire l'aurait livrée.
    const source = srv.store.createProject({ name: 'Source', repoUrl: DEPOT_URL }).id;
    const p = srv.store.createProject({ name: 'Rejeu', repoUrl: DEPOT_URL }).id;
    srv.store.inscrireRejeu({
      projectId: p,
      missionSource: 'mission-source',
      projetSource: source,
      surcharges: {},
      genomeFige: null,
      creePar: null,
      creeA: Date.now(),
    });
    for (let i = 0; i < 2; i++) {
      const id = `gouv-${i}`;
      srv.store.registerNode({
        nodeId: id,
        name: id,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
      });
      srv.store.setNodeStatus(id, 'online');
      for (let k = 0; k < SEUIL_BUTINEUSE; k++) {
        srv.store.enregistrerInspection({
          resultId: i * 1000 + k + 1,
          taskId: `T${i}-${k}`,
          nodeId: id,
          verdict: 'clean',
          score: 0,
          applique: false,
          griefs: [],
        });
      }
    }
    const t = srv.store.createTask({ projectId: p, title: 'Passer a à 2', prompt: 'fais-le' });
    srv.store.patchTask(t.id, { status: 'done' });
    srv.store.insertResult({
      taskId: t.id,
      nodeId: 'gouv-0',
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
    srv.store.setTaskReview(t.id, 'approved');

    const reglage = await fetch(`${base}/api/projects/${p}/essaim`, {
      method: 'POST',
      headers: hive,
      body: JSON.stringify({ niveau: 'gouverne', depotInscrit: false }),
    });
    expect(reglage.status).toBe(200);

    expect(await jusqua(() => srv.store.actionsDuRejeu(p).length > 0)).toBe(true);
    expect(srv.store.actionsDuRejeu(p)).toMatchObject([
      { genre: 'livraison_pr', issue: 'simulee' },
    ]);
    expect(srv.store.listLivraisons(p)).toEqual([]);
    expect(faux.appels.filter((a) => a.chemin.endsWith('/pulls'))).toEqual([]);
    expect(
      srv.store.listEvents(0, 1000).filter((e) => e.type === 'rejeu_action_simulee'),
      'la simulation est journalisée une fois, pas à chaque cycle',
    ).toHaveLength(1);
    // Et la ruche PASSE À AUTRE CHOSE : la livraison simulée ne compte plus
    // parmi « les productions à livrer » — sinon chaque cycle rechoisirait
    // `livrer` et la ruche d'un rejeu ne butinerait, ne planifierait ni ne
    // délibérerait plus jamais.
    const essaim = (await (
      await fetch(`${base}/api/projects/${p}/essaim`, { headers: hive })
    ).json()) as { decision: { pas: string } };
    expect(essaim.decision.pas).not.toBe('livrer');
  });
});
