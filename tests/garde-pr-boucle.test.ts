// LE GARDE DE PR, DE BOUT EN BOUT — la vraie Reine, un faux GitHub injecté.
//
// ─── CE QUI MANQUAIT ─────────────────────────────────────────────────────────
//
// Une PR livrée par la ruche dont la CI cassait restait rouge jusqu'à ce qu'un
// humain ouvre l'écran et clique « reprendre ». Ce banc joue le garde (une
// passe à la fois, `server.gardePr.passe`) contre un GitHub qui répond ce
// qu'on lui dit, et lit ce que la ruche a VRAIMENT fait : les tâches de
// reprise créées, leur lignée, les événements, les jobs relancés.
//
// Les règles prouvées ici, chacune sur sa propre PR :
//
//   · `gouverne` + runner allumé : une reprise par tête rouge NEUVE, jamais
//     deux sur la même, jusqu'au plafond — et le vert remet le compteur à
//     zéro, pour le garde comme pour le bouton ;
//   · `propose`, ou runner éteint : la ruche prévient, une fois par tête ;
//   · un job relancé comme instable l'est avec la preuve de la base, une fois ;
//     sans cette preuve, on corrige ;
//   · fusionnée : le garde lâche la PR et ne la relit plus ;
//   · un refus de GitHub (limite secondaire) met TOUT le garde en pause.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import type { Fetcheur } from '../src/orchestrator/github.js';

const TOKEN = 'jeton-garde-pr-boucle-assez-long';
const DEPOT = 'micka/ruche';

// ─── LE FAUX GITHUB ──────────────────────────────────────────────────────────

interface FauxPr {
  tete: string;
  ouverte: boolean;
  fusionnee: boolean;
}

const gh = {
  prs: new Map<number, FauxPr>(),
  /** Check-runs par SHA, au format de l'API. */
  controles: new Map<string, unknown[]>(),
  /** Les derniers commits de `main`, du plus récent au plus ancien (des SHA hexadécimaux). */
  base: [] as string[],
  relances: [] as number[],
  lectures: [] as string[],
  /** Statut forcé sur toutes les réponses (limite secondaire simulée). */
  refus: 0,
};

const repondre = (code: number, corps: unknown): Response =>
  new Response(JSON.stringify(corps), {
    status: code,
    headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4000' },
  });

const fauxGithub: Fetcheur = (url, init) => {
  const u = new URL(url);
  const p = u.pathname.replace(`/repos/${DEPOT}`, '');
  const m = init?.method ?? 'GET';
  gh.lectures.push(`${m} ${p}`);
  if (gh.refus !== 0) return Promise.resolve(repondre(gh.refus, { message: 'secondary rate' }));
  let r: RegExpExecArray | null;
  if (m === 'GET' && (r = /^\/pulls\/(\d+)$/.exec(p))) {
    const pr = gh.prs.get(Number(r[1]));
    if (!pr) return Promise.resolve(repondre(404, { message: 'Not Found' }));
    return Promise.resolve(
      repondre(200, {
        number: Number(r[1]),
        state: pr.ouverte ? 'open' : 'closed',
        merged: pr.fusionnee,
        mergeable: true,
        head: { ref: `hive/t${r[1]}`, sha: pr.tete },
        base: { ref: 'main' },
      }),
    );
  }
  if (m === 'GET' && /^\/pulls\/\d+\/reviews$/.test(p)) return Promise.resolve(repondre(200, []));
  if (m === 'GET' && (r = /^\/commits\/([^/]+)\/check-runs$/.exec(p))) {
    return Promise.resolve(repondre(200, { check_runs: gh.controles.get(r[1]!) ?? [] }));
  }
  if (m === 'GET' && p === '/commits' && u.searchParams.get('sha') === 'main') {
    return Promise.resolve(
      repondre(
        200,
        gh.base.map((sha) => ({ sha })),
      ),
    );
  }
  if (m === 'POST' && (r = /^\/actions\/jobs\/(\d+)\/rerun$/.exec(p))) {
    if (Number(r[1]) === JOB_INTERDIT) return Promise.resolve(repondre(403, { message: 'no' }));
    gh.relances.push(Number(r[1]));
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  return Promise.resolve(repondre(404, { message: `non servi : ${m} ${p}` }));
};

/** Un job dont la relance est refusée (jeton sans droit sur Actions). */
const JOB_INTERDIT = 9003;

/** Un check-run au format GitHub. `job` : un job Actions relançable. */
const run = (name: string, conclusion: string, job?: number): Record<string, unknown> => ({
  name,
  status: 'completed',
  conclusion,
  html_url: `https://github.com/${DEPOT}/runs/${name}`,
  ...(job !== undefined
    ? {
        app: { slug: 'github-actions' },
        details_url: `https://github.com/${DEPOT}/actions/runs/77/job/${job}`,
      }
    : {}),
});

// ─── LE BANC ─────────────────────────────────────────────────────────────────

describe('le garde de PR, contre un faux GitHub', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  const avant: Record<string, string | undefined> = {};
  const CLES = ['HIVE_GITHUB_TOKEN', 'HIVE_GITHUB_API', 'HIVE_RUNNER', 'HIVE_GARDE_PR_PLAFOND'];

  beforeAll(async () => {
    for (const k of CLES) avant[k] = process.env[k];
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-de-test';
    delete process.env.HIVE_GITHUB_API;
    // Plafond de 2 : le banc atteint la borne en deux reprises au lieu de trois.
    process.env.HIVE_GARDE_PR_PLAFOND = '2';
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-garde-pr-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
      githubFetcher: fauxGithub,
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(() => {
    gh.refus = 0;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    for (const k of CLES) {
      if (avant[k] === undefined) delete process.env[k];
      else process.env[k] = avant[k];
    }
  });

  /** Un projet à un niveau d'autonomie, et une PR `ouverte` livrée par la ruche. */
  const livree = (pr: number, niveau: string, tete: string): { projet: string; tache: string } => {
    const projet = server.store.createProject({
      name: `Ruche ${pr}`,
      repoUrl: `https://github.com/${DEPOT}.git`,
      ownerId: null,
    }).id;
    server.store.setEssaim(projet, { niveau, depotInscrit: false });
    const tache = server.store.createTask({
      id: `t${pr}`,
      projectId: projet,
      title: `travail ${pr}`,
      prompt: 'x',
    }).id;
    server.store.patchTask(tache, { status: 'done' });
    server.store.setLivraison({
      taskId: tache,
      projectId: projet,
      depot: DEPOT,
      pr,
      branche: `hive/t${pr}`,
      etat: 'ouverte',
    });
    gh.prs.set(pr, { tete, ouverte: true, fusionnee: false });
    return { projet, tache };
  };

  /** Rend la PR `pr` échue, comme si son délai de sondage était passé. */
  const echoir = (pr: number): void => {
    const g = server.store.getGardePr(DEPOT, pr);
    if (g) server.store.poserGardePr({ ...g, prochainA: 0 });
  };

  /** Pousse une tête sur la PR, avec ses contrôles. */
  const pousser = (pr: number, tete: string, controles: unknown[]): void => {
    gh.prs.get(pr)!.tete = tete;
    gh.controles.set(tete, controles);
    echoir(pr);
  };

  const reprisesDe = (origine: string) => server.store.reprisesDeLivraison(origine);
  const evenements = (type: string, pr: number) =>
    server.store.listEvents(0, 5_000).filter((e) => e.type === type && e.payload.pr === pr);

  it('gouverne : une reprise par tête rouge NEUVE, jusqu’au plafond ; le vert remet à zéro', async () => {
    process.env.HIVE_RUNNER = 'on';
    const { projet, tache } = livree(1, 'gouverne', 'a1');
    gh.controles.set('a1', [run('tests', 'failure')]);

    await server.gardePr.passe();
    expect(reprisesDe(tache)).toHaveLength(1);
    const premiere = reprisesDe(tache)[0]!;
    // La reprise est ordinaire : même lignée, même branche, même tête lue.
    expect(premiere).toMatchObject({ parent: tache, branche: 'hive/t1', tete: 'a1', pr: 1 });
    expect(server.store.getTask(premiere.taskId)?.prompt).toContain('pull request #1');
    expect(evenements('livraison_reprise', 1).at(-1)?.payload.par).toBe('garde');
    expect(server.store.getGardePr(DEPOT, 1)).toMatchObject({
      teteTraitee: 'a1',
      geste: 'reprise',
    });

    // Même tête, sondée encore et encore : jamais une seconde reprise.
    for (let i = 0; i < 3; i++) {
      echoir(1);
      await server.gardePr.passe();
    }
    expect(reprisesDe(tache)).toHaveLength(1);

    // La reprise échoue sans rien pousser ; un humain pousse une tête rouge.
    server.store.patchTask(premiere.taskId, { status: 'failed' });
    pousser(1, 'a2', [run('tests', 'failure')]);
    await server.gardePr.passe();
    expect(reprisesDe(tache)).toHaveLength(2);

    // Plafond (2) atteint : la tête suivante n'ouvre rien — elle PRÉVIENT.
    server.store.patchTask(reprisesDe(tache)[1]!.taskId, { status: 'failed' });
    pousser(1, 'a3', [run('tests', 'failure')]);
    await server.gardePr.passe();
    expect(reprisesDe(tache)).toHaveLength(2);
    expect(evenements('garde_pr_alerte', 1).at(-1)?.payload).toMatchObject({
      motif: 'plafond_reprises',
      tete: 'a3',
    });
    // Le bouton dit la même chose que le garde : un seul plafond.
    const refus = await fetch(`${base}/api/projects/${projet}/livraisons/${tache}/reprendre`, {
      method: 'POST',
      headers: { 'x-hive-token': TOKEN },
    });
    expect(refus.status).toBe(409);
    expect(((await refus.json()) as { code: string }).code).toBe('plafond_reprises');

    // La CI repasse au VERT : le compteur retombe à zéro…
    pousser(1, 'a4', [run('tests', 'success')]);
    await server.gardePr.passe();
    expect(server.store.getGardePr(DEPOT, 1)?.geste).toBe('vert');
    const ligne = await fetch(`${base}/api/projects/${projet}/livraisons`, {
      headers: { 'x-hive-token': TOKEN },
    });
    const { livraisons } = (await ligne.json()) as {
      livraisons: Array<{ taskId: string; garde?: Record<string, unknown> }>;
    };
    expect(livraisons.find((l) => l.taskId === tache)?.garde).toMatchObject({
      actif: true,
      geste: 'vert',
      tentatives: 0,
      plafond: 2,
    });

    // … et une casse NEUVE retrouve tout son crédit.
    pousser(1, 'a5', [run('tests', 'failure')]);
    await server.gardePr.passe();
    expect(reprisesDe(tache)).toHaveLength(3);
  });

  it('propose : la ruche prévient une fois par tête, et ne dépense rien', async () => {
    process.env.HIVE_RUNNER = 'on';
    const { tache } = livree(2, 'propose', 'b1');
    gh.controles.set('b1', [run('tests', 'failure')]);

    await server.gardePr.passe();
    echoir(2);
    await server.gardePr.passe();
    expect(reprisesDe(tache)).toHaveLength(0);
    const alertes = evenements('garde_pr_alerte', 2);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]!.payload).toMatchObject({ motif: 'autonomie', controles: ['tests'] });
  });

  it('gouverne, runner de l’hôte éteint : la reprise attend son accord, et le dit', async () => {
    process.env.HIVE_RUNNER = 'off';
    const { tache } = livree(3, 'gouverne', 'c1');
    gh.controles.set('c1', [run('tests', 'failure')]);

    await server.gardePr.passe();
    expect(reprisesDe(tache)).toHaveLength(0);
    expect(evenements('garde_pr_alerte', 3).at(-1)?.payload.motif).toBe('runner_eteint');
  });

  it('un job instable n’est relancé qu’avec la preuve de la base, et une seule fois', async () => {
    process.env.HIVE_RUNNER = 'on';
    const { tache } = livree(4, 'gouverne', 'd1');
    gh.base = ['ba5e003', 'ba5e002', 'ba5e001'];
    for (const sha of gh.base) gh.controles.set(sha, [run('tests', 'success', 1)]);
    gh.controles.set('d1', [run('tests', 'failure', 9001)]);

    await server.gardePr.passe();
    expect(gh.relances).toEqual([9001]);
    expect(reprisesDe(tache)).toHaveLength(0);
    // La preuve est au journal : les passages de la base qui ont convaincu.
    expect(evenements('garde_pr_relance', 4).at(-1)?.payload).toMatchObject({
      tete: 'd1',
      base: 'main',
      preuves: [
        {
          nom: 'tests',
          jobId: 9001,
          base: [
            { commit: 'ba5e003', conclusion: 'success' },
            { commit: 'ba5e002', conclusion: 'success' },
            { commit: 'ba5e001', conclusion: 'success' },
          ],
        },
      ],
    });

    // Le job rejoué échoue ENCORE sur la même tête : c'est un vrai échec.
    echoir(4);
    await server.gardePr.passe();
    expect(gh.relances).toEqual([9001]);
    expect(reprisesDe(tache)).toHaveLength(1);
  });

  it('sans preuve de la base, rien n’est relancé : on corrige', async () => {
    process.env.HIVE_RUNNER = 'on';
    const { tache } = livree(5, 'gouverne', 'e1');
    gh.base = ['ba5e013', 'ba5e012', 'ba5e011'];
    gh.controles.set('ba5e013', [run('e2e', 'success', 1)]);
    gh.controles.set('ba5e012', [run('e2e', 'failure', 1)]);
    gh.controles.set('ba5e011', [run('e2e', 'success', 1)]);
    gh.controles.set('e1', [run('e2e', 'failure', 9002)]);
    gh.relances.length = 0;

    await server.gardePr.passe();
    expect(gh.relances).toEqual([]);
    expect(reprisesDe(tache)).toHaveLength(1);
  });

  it('une relance refusée ne met pas le garde en pause : on corrige, et on le dit', async () => {
    process.env.HIVE_RUNNER = 'on';
    const { tache } = livree(8, 'gouverne', 'h1');
    gh.base = ['ba5e023', 'ba5e022', 'ba5e021'];
    for (const sha of gh.base) gh.controles.set(sha, [run('lint', 'success', 1)]);
    gh.controles.set('h1', [run('lint', 'failure', JOB_INTERDIT)]);

    await server.gardePr.passe();
    expect(reprisesDe(tache)).toHaveLength(1);
    expect(server.store.getGardePr(DEPOT, 8)).toMatchObject({
      geste: 'reprise',
      teteRelancee: 'h1',
      echecs: 0,
    });
    expect(server.store.getGardePr(DEPOT, 8)?.dit).toContain('Relance refusée');
    // Aucune pause : une PR neuve est lue à la passe suivante.
    livree(9, 'propose', 'i1');
    gh.controles.set('i1', [run('tests', 'success')]);
    expect(await server.gardePr.passe()).toBeGreaterThan(0);
  });

  it('fusionnée : le garde la lâche et ne la relit plus', async () => {
    livree(6, 'gouverne', 'f1');
    gh.controles.set('f1', [run('tests', 'success')]);
    gh.prs.get(6)!.fusionnee = true;
    gh.prs.get(6)!.ouverte = false;

    await server.gardePr.passe();
    expect(server.store.getGardePr(DEPOT, 6)?.statut).toBe('retiree');
    const lues = gh.lectures.length;
    echoir(6);
    await server.gardePr.passe();
    expect(gh.lectures.slice(lues).filter((l) => l === 'GET /pulls/6')).toEqual([]);
  });

  it('un refus de GitHub met TOUT le garde en pause', async () => {
    livree(7, 'gouverne', 'g1');
    gh.controles.set('g1', [run('tests', 'failure')]);
    gh.refus = 403;

    expect(await server.gardePr.passe()).toBe(1);
    expect(server.store.getGardePr(DEPOT, 7)).toMatchObject({ geste: 'illisible', echecs: 1 });
    gh.refus = 0;
    echoir(7);
    // La limite vise le jeton : la passe suivante ne lit RIEN, même échue.
    expect(await server.gardePr.passe()).toBe(0);
  });
});
