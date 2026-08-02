// LA PROMESSE FAITE AUX JEUNES OUVRIÈRES EST ENFIN TENUE.
//
// ─── LE DÉFAUT QUI A MOTIVÉ CE FICHIER ───────────────────────────────────────
//
// Le cadre de travail envoyé à chaque nourrice dit, mot pour mot :
//
//     « TA PRODUCTION SERA RELUE par une ouvrière plus expérimentée avant
//       d'être appliquée. »
//
// `exigeContreVisite` et `trancher` savaient depuis toujours quoi en faire.
// Elles n'avaient AUCUN appelant. `HIVE_POLYETHISME=strict` ne changeait donc
// rien à rien, et la phrase était fausse — de la pire espèce : celle qui
// rassure celui qu'elle vise.
//
// ─── CE QUE CETTE PORTE NE FAIT PAS ──────────────────────────────────────────
//
// Elle ne remplace la revue humaine par rien. `aLivrer` exige déjà `approved` ;
// la contre-visite s'AJOUTE. La ruche peut refuser de livrer ce qu'un humain a
// approuvé — jamais l'inverse. C'est le sens de `attendre` : pas un échec, mais
// « la ruche ne peut pas juger seule, ça reste devant l'humain ».
//
// Les tests ci-dessous ne vérifient donc pas « ça marche ». Ils vérifient CE
// QUI NE PART PAS.

import { createServer as createHttp } from 'node:http';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-polyethisme-assez-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,1 @@',
  '-const a = 1;',
  '+const a = 2;',
].join('\n');

/** Un GitHub simulé : rien ne part sur le réseau, et surtout pas sur un dépôt. */
async function fauxGithub(): Promise<{
  url: string;
  appels: string[];
  fermer(): Promise<void>;
}> {
  const appels: string[] = [];
  let pr = 41;
  const srv: Server = createHttp((req, rep) => {
    const chemin = req.url ?? '';
    appels.push(chemin);
    req.resume();
    req.on('end', () => {
      const envoyer = (code: number, corps: unknown): void => {
        rep.writeHead(code, { 'content-type': 'application/json' });
        rep.end(JSON.stringify(corps));
      };
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
      if (chemin.endsWith('/pulls')) return envoyer(201, { number: ++pr });
      return envoyer(200, {});
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    appels,
    fermer: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

describe('LE POLYÉTHISME STRICT TIENT SA PROMESSE', () => {
  let server: HiveServer | null = null;
  let gh: Awaited<ReturnType<typeof fauxGithub>> | null = null;
  let dir: string | null = null;
  const CLES = ['HIVE_RUNNER', 'HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API'] as const;
  const avant: Record<string, string | undefined> = {};

  afterEach(async () => {
    await server?.stop();
    server = null;
    await gh?.fermer();
    gh = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    for (const cle of CLES) {
      if (avant[cle] === undefined) delete process.env[cle];
      else process.env[cle] = avant[cle];
    }
  });

  async function demarrer(mode: 'strict' | 'consignes'): Promise<{
    base: string;
    srv: HiveServer;
    faux: NonNullable<typeof gh>;
  }> {
    for (const cle of CLES) avant[cle] = process.env[cle];
    gh = await fauxGithub();
    process.env.HIVE_RUNNER = 'on';
    process.env.HIVE_GITHUB_API = `${gh.url}/api`;
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-simule';

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-poly-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 30,
      // ─── LE MODE PASSE PAR LA CONFIG, PAS PAR L'ENVIRONNEMENT ─────────────
      //
      // `HIVE_POLYETHISME` n'est lu que par la fabrique de configuration ;
      // `createServer` reçoit, lui, un objet déjà construit. Poser la variable
      // avant l'appel ne changeait donc RIEN, et mes trois cas « ne doit pas
      // partir » restaient verts en ne testant rien du tout.
      polyethisme: mode,
    });
    return { base: `http://127.0.0.1:${server.port}`, srv: server, faux: gh };
  }

  /** Un nœud avec assez d'antécédents propres pour être BUTINEUSE — donc relectrice. */
  function butineuse(srv: HiveServer, id: string, depart: number): void {
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
        resultId: depart + k,
        taskId: `hist-${id}-${k}`,
        nodeId: id,
        verdict: 'clean',
        score: 0,
        applique: false,
        griefs: [],
      });
    }
  }

  /**
   * Les DEUX butineuses que l'essaim exige pour se gouverner.
   *
   * ─── CE QUE J'AI APPRIS EN VOYANT CES TESTS ÉCHOUER ────────────────────────
   *
   * Mes trois cas « la production DOIT partir » sont d'abord tombés, tous les
   * trois. La cause n'était pas la porte du polyéthisme : la ruche répondait
   * « inerte — 0 ouvrière(s) de caste gouvernante, 2 requises ». Rien ne
   * partait, pour une raison qui n'avait rien à voir.
   *
   * C'est le rappel qui compte : mes trois cas « ne DOIT pas partir » passaient
   * pendant ce temps — au vert, et pour la mauvaise raison. Sans les cas
   * positifs en face, j'aurais livré une porte dont je n'aurais rien su.
   */
  function essaimGouvernable(srv: HiveServer): void {
    butineuse(srv, 'gouvernante-1', 10_000);
    butineuse(srv, 'gouvernante-2', 20_000);
  }

  /** Un nœud SANS aucun antécédent — donc nourrice, l'inconnu étant le cas dangereux. */
  function nourrice(srv: HiveServer, id: string): void {
    srv.store.registerNode({
      nodeId: id,
      name: id,
      ownerName: 'test',
      agentType: 'shell',
      maxConcurrency: 1,
    });
    srv.store.setNodeStatus(id, 'online');
  }

  /**
   * Un projet dont la seule production est écrite par `auteur`, réussie,
   * porteuse d'un diff, et APPROUVÉE PAR UN HUMAIN.
   *
   * Tout ce qui suit ne dépend donc que de la contre-visite : la revue humaine
   * est acquise dans chacun des cas.
   */
  function projetAvecProduction(
    srv: HiveServer,
    auteur: string,
  ): { projet: string; tache: string } {
    const p = srv.store.createProject({
      name: 'Ruche autonome',
      repoUrl: 'https://github.com/moi/projet.git',
    }).id;
    const t = srv.store.createTask({ projectId: p, title: 'Passer a à 2', prompt: 'fais-le' });
    srv.store.patchTask(t.id, { status: 'done', assignedNodeId: auteur });
    srv.store.insertResult({
      taskId: t.id,
      nodeId: auteur,
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
    srv.store.setTaskReview(t.id, 'approved');
    return { projet: p, tache: t.id };
  }

  const regler = (base: string, id: string): Promise<Response> =>
    fetch(`${base}/api/projects/${id}/essaim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ niveau: 'gouverne', depotInscrit: false }),
    });

  async function jusqua(cond: () => boolean, msMax = 3_000): Promise<boolean> {
    const fin = Date.now() + msMax;
    while (Date.now() < fin) {
      if (cond()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return cond();
  }

  it('LA PRODUCTION D’UNE NOURRICE NON CONTRE-VISITÉE NE PART PAS', async () => {
    // Le cœur du lot. Un humain a approuvé ; la ruche refuse quand même, parce
    // que la relecture PROMISE à l'ouvrière n'a pas eu lieu.
    const { base, srv, faux } = await demarrer('strict');
    essaimGouvernable(srv);
    butineuse(srv, 'relectrice', 1_000);
    nourrice(srv, 'jeune');
    const { projet } = projetAvecProduction(srv, 'jeune');
    await regler(base, projet);

    await new Promise((r) => setTimeout(r, 700));
    expect(srv.store.listLivraisons(projet), 'une production non relue est partie').toEqual([]);
    expect(
      faux.appels.some((c) => c.endsWith('/pulls')),
      'une pull request a été ouverte sur le dépôt de quelqu’un',
    ).toBe(false);
  });

  it('LA MÊME PRODUCTION PART une fois contre-visitée « appliquer »', async () => {
    // Le pendant du test précédent, et il est indispensable : une porte qui
    // refuse TOUT est indiscernable d'une porte qui marche, et c'est comme ça
    // qu'on livre une fonctionnalité qui bloque tout le monde.
    const { base, srv } = await demarrer('strict');
    essaimGouvernable(srv);
    butineuse(srv, 'relectrice', 2_000);
    nourrice(srv, 'jeune');
    const { projet, tache } = projetAvecProduction(srv, 'jeune');
    srv.store.enregistrerContreVisite({
      productionTaskId: tache,
      suite: 'appliquer',
      raison: '',
      visiteurNodeId: 'relectrice',
      visiteurAgent: 'shell',
    });
    await regler(base, projet);

    expect(
      await jusqua(() => srv.store.listLivraisons(projet, 'ouverte').length > 0),
      'une production contre-visitée « appliquer » n’est pas partie',
    ).toBe(true);
  });

  it('une contre-visite « ameliorer » RETIENT la production', async () => {
    // `trancher` rend la suite telle quelle : une relectrice qui objecte n'est
    // pas une relectrice qui approuve.
    const { base, srv } = await demarrer('strict');
    essaimGouvernable(srv);
    butineuse(srv, 'relectrice', 3_000);
    nourrice(srv, 'jeune');
    const { projet, tache } = projetAvecProduction(srv, 'jeune');
    srv.store.enregistrerContreVisite({
      productionTaskId: tache,
      suite: 'ameliorer',
      raison: 'le test manquant',
      visiteurNodeId: 'relectrice',
      visiteurAgent: 'shell',
    });
    await regler(base, projet);

    await new Promise((r) => setTimeout(r, 700));
    expect(srv.store.listLivraisons(projet), 'une production contestée est partie').toEqual([]);
  });

  it('UNE RELECTRICE DE CASTE INSUFFISANTE NE SUFFIT PAS', async () => {
    // Règle 4 du module : STRICTEMENT supérieure. Deux nourrices qui se
    // relisent l'une l'autre entretiennent un plafond au lieu de le lever — et
    // la promesse dit « une ouvrière PLUS EXPÉRIMENTÉE ».
    const { base, srv } = await demarrer('strict');
    essaimGouvernable(srv);
    nourrice(srv, 'jeune');
    nourrice(srv, 'autre-jeune');
    const { projet, tache } = projetAvecProduction(srv, 'jeune');
    srv.store.enregistrerContreVisite({
      productionTaskId: tache,
      suite: 'appliquer',
      raison: '',
      visiteurNodeId: 'autre-jeune',
      visiteurAgent: 'shell',
    });
    await regler(base, projet);

    await new Promise((r) => setTimeout(r, 700));
    expect(
      srv.store.listLivraisons(projet),
      'une nourrice a validé une nourrice, et ça a suffi',
    ).toEqual([]);
  });

  it('EN MODE `consignes` — le défaut — la porte ne mord pas', async () => {
    // Faire mordre la porte partout changerait le comportement de toutes les
    // ruches installées, sur une décision que personne n'a prise. Le
    // polyéthisme guide par défaut ; il ne contraint que si on le demande.
    const { base, srv } = await demarrer('consignes');
    essaimGouvernable(srv);
    nourrice(srv, 'jeune');
    const { projet } = projetAvecProduction(srv, 'jeune');
    await regler(base, projet);

    expect(
      await jusqua(() => srv.store.listLivraisons(projet, 'ouverte').length > 0),
      'le mode par défaut s’est mis à retenir des productions',
    ).toBe(true);
  });

  it('UNE BUTINEUSE JUGÉE `hollow` SUR CETTE TÂCHE-CI est retenue', async () => {
    // ─── LE VERDICT LU DOIT ÊTRE CELUI DE LA BONNE TÂCHE ───────────────────
    //
    // `exigeContreVisite` suit les Gardiennes au-delà de la caste : une
    // butineuse dont la production est `hollow` — un diff qui n'a pas tenu ses
    // promesses — est relue comme une autre.
    //
    // Ce test existe pour une raison précise : la loupe a fait survivre
    // `inspections.find((i) => i.taskId === task.id)` muté en `!==`. Tous mes
    // autres cas n'ont que des antécédents `clean`, donc lire l'inspection
    // d'une AUTRE tâche donnait le même résultat. Il fallait une tâche dont le
    // verdict propre diffère de celui de ses voisines.
    const { base, srv } = await demarrer('strict');
    essaimGouvernable(srv);
    butineuse(srv, 'chevronnee', 5_000);
    const { projet, tache } = projetAvecProduction(srv, 'chevronnee');
    srv.store.enregistrerInspection({
      resultId: 6_000,
      taskId: tache,
      nodeId: 'chevronnee',
      verdict: 'hollow',
      score: 0,
      applique: false,
      griefs: [],
    });
    await regler(base, projet);

    await new Promise((r) => setTimeout(r, 700));
    expect(
      srv.store.listLivraisons(projet),
      'une production jugée creuse est partie sans être relue',
    ).toEqual([]);
  });

  it('la production d’une BUTINEUSE part sans contre-visite', async () => {
    // La porte vise les jeunes ouvrières, pas tout le monde. Une butineuse dont
    // le verdict est `clean` n'a rien à faire relire — sinon `strict` voudrait
    // dire « tout est relu deux fois », ce qui n'est ni la règle écrite ni ce
    // que la ruche peut se payer.
    const { base, srv } = await demarrer('strict');
    essaimGouvernable(srv);
    butineuse(srv, 'chevronnee', 4_000);
    const { projet } = projetAvecProduction(srv, 'chevronnee');
    await regler(base, projet);

    expect(
      await jusqua(() => srv.store.listLivraisons(projet, 'ouverte').length > 0),
      'une butineuse propre a été retenue sans raison',
    ).toBe(true);
  });
});
