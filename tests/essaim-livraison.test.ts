// La ruche livre et fusionne toute seule — les deux pas qui ÉCRIVENT.
//
// Ces tests tournent contre un GitHub SIMULÉ servi en local et désigné par
// `HIVE_GITHUB_API` : rien ne part sur le réseau, et surtout rien ne part sur
// un vrai dépôt. Ce qu'ils vérifient n'est pas « ça marche » mais ce qui
// PART — et surtout ce qui NE PART PAS :
//
//   · une production non relue ne devient jamais une pull request ;
//   · une PR déjà ouverte n'est pas rouverte à chaque cycle ;
//   · sans jeton, rien n'est tenté ;
//   · un refus de GitHub est rangé avec son motif, pas retenté en boucle.

import { createServer as createHttp } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import {
  LIVRAISONS_RETENTION,
  RESULT_RETENTION,
  createServer,
} from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-livraison-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,1 @@',
  '-const a = 1;',
  '+const a = 2;',
].join('\n');

/** Un GitHub simulé, servi en HTTP. Note tout ce qu'on lui demande. */
interface FauxGithub {
  url: string;
  appels: Array<{ methode: string; chemin: string }>;
  fermer(): Promise<void>;
  /** Statut rendu par l'endpoint de fusion. 200 = fusionne. */
  statutFusion: number;
}

async function fauxGithub(): Promise<FauxGithub> {
  const appels: Array<{ methode: string; chemin: string }> = [];
  const etat = { statutFusion: 200 };
  let prochainePr = 41;

  const srv: Server = createHttp((req, rep) => {
    const chemin = req.url ?? '';
    appels.push({ methode: req.method ?? 'GET', chemin });
    const envoyer = (code: number, corps: unknown): void => {
      rep.writeHead(code, { 'content-type': 'application/json' });
      rep.end(JSON.stringify(corps));
    };
    // On consomme le corps : sans cela, Node garde la connexion en attente.
    req.resume();
    req.on('end', () => {
      if (chemin.includes('/git/ref/heads/')) return envoyer(200, { object: { sha: 'base-sha' } });
      if (chemin.includes('/contents/')) {
        return envoyer(200, {
          type: 'file',
          encoding: 'base64',
          content: Buffer.from('const a = 1;\n', 'utf8').toString('base64'),
        });
      }
      if (chemin.endsWith('/git/blobs')) return envoyer(201, { sha: 'blob-sha' });
      if (chemin.endsWith('/git/trees')) return envoyer(201, { sha: 'tree-sha' });
      if (chemin.endsWith('/git/commits')) return envoyer(201, { sha: 'commit-sha' });
      if (chemin.endsWith('/git/refs')) return envoyer(201, { ref: 'refs/heads/hive/x' });
      if (chemin.endsWith('/merge')) {
        return etat.statutFusion === 200
          ? envoyer(200, { merged: true, sha: 'merge-sha' })
          : envoyer(etat.statutFusion, { message: 'not mergeable' });
      }
      if (chemin.endsWith('/pulls')) return envoyer(201, { number: ++prochainePr });
      envoyer(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    appels,
    get statutFusion() {
      return etat.statutFusion;
    },
    set statutFusion(v: number) {
      etat.statutFusion = v;
    },
    fermer: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

describe('la ruche livre toute seule', () => {
  let server: HiveServer | null = null;
  let gh: FauxGithub | null = null;
  let dir: string | null = null;
  const avant: Record<string, string | undefined> = {};

  afterEach(async () => {
    await server?.stop();
    server = null;
    await gh?.fermer();
    gh = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    for (const cle of ['HIVE_RUNNER', 'HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API']) {
      if (avant[cle] === undefined) delete process.env[cle];
      else process.env[cle] = avant[cle];
    }
  });

  async function demarrer(opts: { jeton?: boolean } = {}): Promise<{
    base: string;
    srv: HiveServer;
    faux: FauxGithub;
  }> {
    for (const cle of ['HIVE_RUNNER', 'HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API']) {
      avant[cle] = process.env[cle];
    }
    gh = await fauxGithub();
    process.env.HIVE_RUNNER = 'on';
    process.env.HIVE_GITHUB_API = `${gh.url}/api`;
    if (opts.jeton === false) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = 'jeton-github-simule';

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-livr-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 30,
    });
    return { base: `http://127.0.0.1:${server.port}`, srv: server, faux: gh };
  }

  /** Un projet gouvernable, avec dépôt connu et une production RELUE. */
  function projetLivrable(srv: HiveServer, opts: { approuvee?: boolean } = {}): string {
    const p = srv.store.createProject({
      name: 'Ruche autonome',
      repoUrl: 'https://github.com/moi/projet.git',
    }).id;
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
    if (opts.approuvee !== false) srv.store.setTaskReview(t.id, 'approved');
    return p;
  }

  const regler = (
    base: string,
    id: string,
    niveau: string,
    depotInscrit = false,
  ): Promise<Response> =>
    fetch(`${base}/api/projects/${id}/essaim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ niveau, depotInscrit }),
    });

  async function jusqua(cond: () => boolean, msMax = 4_000): Promise<boolean> {
    const fin = Date.now() + msMax;
    while (Date.now() < fin) {
      if (cond()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return cond();
  }

  it('LA RUCHE OUVRE VRAIMENT UNE PULL REQUEST', async () => {
    // Avant ce câblage, `productionsALivrer` valait 0 en dur : la porte
    // « livrer » de `deciderPas` était inatteignable.
    const { base, srv, faux } = await demarrer();
    const p = projetLivrable(srv);
    await regler(base, p, 'gouverne');

    const ouverte = await jusqua(() => srv.store.listLivraisons(p, 'ouverte').length > 0);
    expect(ouverte).toBe(true);
    expect(faux.appels.some((a) => a.methode === 'POST' && a.chemin.endsWith('/pulls'))).toBe(true);
    expect(srv.store.listLivraisons(p, 'ouverte')[0]?.pr).toBeGreaterThan(0);
  });

  it('UNE PRODUCTION NON RELUE NE PART PAS', async () => {
    // La ruche autonome ouvre des pull requests ; elle ne décide pas seule de
    // ce qui mérite d'en être une.
    const { base, srv, faux } = await demarrer();
    const p = projetLivrable(srv, { approuvee: false });
    await regler(base, p, 'gouverne');
    await new Promise((r) => setTimeout(r, 600));
    expect(srv.store.listLivraisons(p)).toEqual([]);
    expect(faux.appels.some((a) => a.chemin.endsWith('/pulls'))).toBe(false);
  });

  it('UNE PR DÉJÀ OUVERTE N’EST PAS ROUVERTE', async () => {
    // Sans la trace en base, la ruche rouvrirait une pull request par minute
    // sur le dépôt de quelqu'un — la faute la plus visible qu'elle puisse
    // commettre. On l'observe dès le PREMIER cycle : la production disparaît
    // de la file, sans quoi la cadence d'une minute masquerait tout.
    const { base, srv } = await demarrer();
    const p = projetLivrable(srv);
    await regler(base, p, 'gouverne');
    await jusqua(() => srv.store.listLivraisons(p, 'ouverte').length > 0);

    const vue = (await (await fetch(`${base}/api/projects/${p}/essaim`, { headers })).json()) as {
      decision: { pas: string };
    };
    // Plus rien à livrer : la ruche est passée à autre chose.
    expect(vue.decision.pas).not.toBe('livrer');
    expect(srv.store.listLivraisons(p)).toHaveLength(1);
  });

  it('SANS JETON, RIEN N’EST TENTÉ', async () => {
    // Un refus net vaut mieux qu'une tentative qui échoue plus loin avec un
    // message obscur — et qui aurait fait reculer puis mettre en pause.
    const { base, srv, faux } = await demarrer({ jeton: false });
    const p = projetLivrable(srv);
    await regler(base, p, 'gouverne');
    await new Promise((r) => setTimeout(r, 600));
    expect(faux.appels).toEqual([]);
    expect(srv.store.listLivraisons(p)).toEqual([]);
  });

  it('FUSIONNER EXIGE « PLEIN » ET LE DÉPÔT INSCRIT', async () => {
    // Le geste le plus engageant du dépôt. En « gouverne », la PR reste
    // ouverte et attend l'humain : ce n'est pas un arrêt, c'est une file.
    const { base, srv, faux } = await demarrer();
    const p = projetLivrable(srv);
    prOuverte(srv, p);
    await regler(base, p, 'gouverne');
    await new Promise((r) => setTimeout(r, 600));
    expect(faux.appels.some((a) => a.chemin.endsWith('/merge'))).toBe(false);
    expect(srv.store.listLivraisons(p, 'ouverte').length).toBeGreaterThan(0);
  });

  /**
   * Une pull request DÉJÀ ouverte par la ruche.
   *
   * Posée avant le premier cycle, et c'est nécessaire : `livrer` et
   * `fusionner` sont deux pas, donc deux cycles, donc deux minutes. Attendre
   * le second dans un test le mettrait hors de sa fenêtre — et le test ne
   * prouverait plus rien.
   */
  function prOuverte(srv: HiveServer, p: string, pr = 7): void {
    const t = srv.store.createTask({ projectId: p, title: 'déjà livrée', prompt: 'x' });
    srv.store.setLivraison({
      taskId: t.id,
      projectId: p,
      depot: 'moi/projet',
      pr,
      branche: `hive/${t.id}`,
      etat: 'ouverte',
    });
  }

  it('EN PLEIN ESSAIM AVEC DÉPÔT INSCRIT, LA RUCHE FUSIONNE', async () => {
    const { base, srv, faux } = await demarrer();
    const p = projetLivrable(srv);
    prOuverte(srv, p);
    await regler(base, p, 'plein', true);
    const fusionnee = await jusqua(() => srv.store.listLivraisons(p, 'fusionnee').length > 0);
    expect(fusionnee).toBe(true);
    expect(faux.appels.some((a) => a.methode === 'PUT' && a.chemin.endsWith('/merge'))).toBe(true);
  });

  it('SANS INSCRIPTION DU DÉPÔT, « plein » NE FUSIONNE PAS', async () => {
    // Le niveau seul ne suffit jamais : l'inscription est une autorisation
    // donnée UNE fois, à la main, pour ce dépôt-là.
    const { base, srv, faux } = await demarrer();
    const p = projetLivrable(srv);
    prOuverte(srv, p);
    await regler(base, p, 'plein', false);
    await new Promise((r) => setTimeout(r, 600));
    expect(faux.appels.some((a) => a.chemin.endsWith('/merge'))).toBe(false);
  });

  it('UN REFUS DE GITHUB EST RANGÉ, PAS RETENTÉ EN BOUCLE', async () => {
    // 405 = conflit, CI rouge, ou revue exigée par le dépôt. Ce n'est pas une
    // panne de la ruche : c'est le propriétaire qui protège sa branche, et la
    // ruche ne cherche pas à contourner.
    const { base, srv, faux } = await demarrer();
    faux.statutFusion = 405;
    const p = projetLivrable(srv);
    prOuverte(srv, p);
    await regler(base, p, 'plein', true);

    const rangee = await jusqua(() => srv.store.listLivraisons(p, 'echouee').length > 0);
    expect(rangee).toBe(true);
    const l = srv.store.listLivraisons(p, 'echouee')[0];
    expect(l?.motif).toMatch(/fusion refusée/i);
    // …et elle ne se représente plus comme « à fusionner ».
    expect(srv.store.listLivraisons(p, 'ouverte')).toEqual([]);
  });

  it('un projet SANS dépôt ne livre pas', async () => {
    const { base, srv, faux } = await demarrer();
    const p = srv.store.createProject({ name: 'Sans dépôt' }).id;
    const t = srv.store.createTask({ projectId: p, title: 'x', prompt: 'y' });
    srv.store.insertResult({
      taskId: t.id,
      nodeId: 'n',
      success: true,
      diff: DIFF,
      logs: '',
      durationMs: 1,
      subAgents: [],
    });
    srv.store.setTaskReview(t.id, 'approved');
    await regler(base, p, 'gouverne');
    await new Promise((r) => setTimeout(r, 400));
    expect(faux.appels.some((a) => a.chemin.endsWith('/pulls'))).toBe(false);
  });
});

describe('la ruche fusionne — le geste le plus engageant', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  it('LA BORNE D’ÉLAGAGE DES LIVRAISONS DÉPASSE CELLE DES RÉSULTATS', () => {
    // L'inégalité N'EST PAS cosmétique : une production n'est livrable que
    // tant que son résultat porte encore son diff. Élaguer les livraisons
    // AVANT les résultats ressusciterait une tâche déjà livrée, et la ruche
    // rouvrirait sa pull request. Verrouillé ici parce que cet écart se
    // perdrait au premier ajustement distrait.
    expect(LIVRAISONS_RETENTION).toBeGreaterThan(RESULT_RETENTION);
  });

  it('l’élagage garde les récentes et balaye les orphelines', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-livr-prune-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    const p = server.store.createProject({ name: 'P' }).id;
    const t = server.store.createTask({ projectId: p, title: 'vraie', prompt: 'x' });
    server.store.setLivraison({
      taskId: t.id,
      projectId: p,
      depot: 'moi/projet',
      pr: 1,
      branche: 'hive/a',
      etat: 'ouverte',
    });
    // Une livraison dont la tâche n'existe pas : plus rien à protéger.
    server.store.setLivraison({
      taskId: 'tache-fantome',
      projectId: p,
      depot: 'moi/projet',
      pr: 2,
      branche: 'hive/b',
      etat: 'ouverte',
    });

    server.store.pruneLivraisons(1_000);
    expect(server.store.getLivraison(t.id)).not.toBeNull();
    expect(server.store.getLivraison('tache-fantome')).toBeNull();
  });
});
