// Le runner d'essaim, branché sur un VRAI serveur.
//
// Le module pur sait cadencer ; ces tests-là répondent à la seule question qui
// reste : est-ce que la ruche AGIT vraiment, et est-ce qu'elle s'arrête quand
// on le lui demande ? Avant ce câblage, `deciderPas` affichait ce que la ruche
// ferait sans que rien ne le fasse jamais.
//
// Le test le plus important de ce fichier est celui qui vérifie que RIEN ne
// part quand l'hôte n'a pas allumé l'autonomie : c'est le seul garde-fou que
// l'utilisateur d'un projet ne peut pas contourner.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SEUIL_BUTINEUSE } from '../src/orchestrator/polyethisme.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-runner-assez-long-ok';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

interface VueEssaim {
  niveau: string;
  decision: { pas: string; motif: string };
  runner: { mode: string; enPause: boolean; echecs: number; dernierTourA: number };
}

describe('le runner d’essaim, câblé', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  let avant: string | undefined;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    if (avant === undefined) delete process.env.HIVE_RUNNER;
    else process.env.HIVE_RUNNER = avant;
  });

  async function demarrer(runner?: string): Promise<{ base: string; srv: HiveServer }> {
    avant = process.env.HIVE_RUNNER;
    if (runner) process.env.HIVE_RUNNER = runner;
    else delete process.env.HIVE_RUNNER;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-runner-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      // Un tick rapide : c'est le tick qui appelle le cadencier, et le
      // cadencier tient sa propre cadence d'une minute par projet.
      tickMs: 30,
    });
    return { base: `http://127.0.0.1:${server.port}`, srv: server };
  }

  /** Un projet gouvernable : deux ouvrières irréprochables et en ligne. */
  function rucheGouvernable(srv: HiveServer): string {
    const p = srv.store.createProject({ name: 'Ruche autonome' }).id;
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
    return p;
  }

  const regler = (base: string, id: string, niveau: string): Promise<Response> =>
    fetch(`${base}/api/projects/${id}/essaim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ niveau, depotInscrit: false }),
    });

  const lire = async (base: string, id: string): Promise<VueEssaim> =>
    (await (await fetch(`${base}/api/projects/${id}/essaim`, { headers })).json()) as VueEssaim;

  /** Attend qu'une condition devienne vraie, ou rend faux après `msMax`. */
  async function jusqua(cond: () => boolean, msMax = 3_000): Promise<boolean> {
    const fin = Date.now() + msMax;
    while (Date.now() < fin) {
      if (cond()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return cond();
  }

  it('LA RUCHE AGIT VRAIMENT : un cycle ouvre un conseil', async () => {
    // Le cœur de la tâche. Avant ce câblage, régler « plein essaim » affichait
    // « délibérer » et il ne se passait rien, jamais.
    const { base, srv } = await demarrer('on');
    const p = rucheGouvernable(srv);
    await regler(base, p, 'gouverne');

    const ouvert = await jusqua(() => srv.store.sessionsOuvertes().some((s) => s.projectId === p));
    expect(ouvert).toBe(true);
  });

  it('L’HÔTE A LE DERNIER MOT : sans HIVE_RUNNER, rien ne part', async () => {
    // Le niveau est le choix de l'utilisateur ; le commutateur est celui de
    // qui paie le temps-machine. C'est le seul garde-fou que l'utilisateur
    // d'un projet ne peut pas contourner depuis l'API.
    const { base, srv } = await demarrer(); // défaut = off
    const p = rucheGouvernable(srv);
    await regler(base, p, 'plein');

    // La décision est bien « délibérer »…
    expect((await lire(base, p)).decision.pas).toBe('deliberer');
    // …et pourtant rien ne se passe, quel que soit le temps qu'on attende.
    await new Promise((r) => setTimeout(r, 400));
    expect(srv.store.sessionsOuvertes()).toHaveLength(0);
  });

  it('un projet « off » ne tourne pas, même la ruche allumée', async () => {
    const { base, srv } = await demarrer('on');
    const p = rucheGouvernable(srv);
    await regler(base, p, 'off');
    await new Promise((r) => setTimeout(r, 400));
    expect(srv.store.sessionsOuvertes()).toHaveLength(0);
  });

  it('sans gouvernantes, la ruche allumée reste INERTE', async () => {
    // Le runner exécute la décision, il ne la contourne pas.
    const { base, srv } = await demarrer('on');
    const p = srv.store.createProject({ name: 'Sans ouvrières' }).id;
    await regler(base, p, 'plein');
    await new Promise((r) => setTimeout(r, 400));
    expect(srv.store.sessionsOuvertes()).toHaveLength(0);
    expect((await lire(base, p)).decision.pas).toBe('inerte');
  });

  it('UN SEUL CONSEIL, même après beaucoup de ticks', async () => {
    // Le tick tourne toutes les 30 ms dans ce test ; la cadence du cadencier
    // est d'une minute. Sans elle, la ruche ouvrirait des dizaines de conseils
    // en une seconde — et paierait chacun.
    const { base, srv } = await demarrer('on');
    const p = rucheGouvernable(srv);
    await regler(base, p, 'gouverne');
    await jusqua(() => srv.store.sessionsOuvertes().some((s) => s.projectId === p));
    await new Promise((r) => setTimeout(r, 500)); // ~16 ticks de plus
    expect(srv.store.sessionsOuvertes().filter((s) => s.projectId === p)).toHaveLength(1);
  });

  it('chaque cycle laisse une trace dans le Journal', async () => {
    // Une ruche autonome qui n'expliquerait pas ce qu'elle fait serait
    // impossible à auditer le lendemain matin.
    const { base, srv } = await demarrer('on');
    const p = rucheGouvernable(srv);
    await regler(base, p, 'gouverne');
    const trace = await jusqua(() =>
      srv.store.listEvents(0, 200).some((e) => e.type === 'essaim_cycle'),
    );
    expect(trace).toBe(true);
    const cycle = srv.store.listEvents(0, 200).find((e) => e.type === 'essaim_cycle');
    expect(cycle?.payload.projectId).toBe(p);
  });

  it('la vue d’essaim DIT que le runner est éteint', async () => {
    // Sans ce champ, l'écran montrerait une décision qui n'arrive jamais et
    // personne ne saurait pourquoi.
    const { base, srv } = await demarrer();
    const p = rucheGouvernable(srv);
    await regler(base, p, 'plein');
    const v = await lire(base, p);
    expect(v.runner.mode).toBe('off');
    expect(v.runner.enPause).toBe(false);
  });

  it('la vue d’essaim DIT que le runner est allumé, et quand il a tourné', async () => {
    const { base, srv } = await demarrer('on');
    const p = rucheGouvernable(srv);
    await regler(base, p, 'gouverne');
    await jusqua(() => srv.store.sessionsOuvertes().some((s) => s.projectId === p));
    const v = await lire(base, p);
    expect(v.runner.mode).toBe('on');
    expect(v.runner.dernierTourA).toBeGreaterThan(0);
  });

  it('un pas NON BRANCHÉ est dit, pas tu', async () => {
    // « corriger » n'a pas encore d'action : la ruche doit le journaliser
    // plutôt que de paraître au travail.
    const { base, srv } = await demarrer('on');
    const p = rucheGouvernable(srv);
    // Trois échecs de même signature sur trois nœuds distincts ⇒ leçon
    // systémique ⇒ la décision devient « corriger ».
    for (let i = 0; i < 3; i++) {
      const node = `boiteux-${i}`;
      srv.store.registerNode({
        nodeId: node,
        name: node,
        ownerName: 'test',
        agentType: 'shell',
        maxConcurrency: 1,
      });
      const t = srv.store.createTask({ projectId: p, title: `t${i}`, prompt: 'x' });
      srv.store.insertResult({
        taskId: t.id,
        nodeId: node,
        success: false,
        diff: '',
        logs: 'Error: ENOENT no such file or directory',
        durationMs: 10,
        subAgents: [],
      });
    }
    await regler(base, p, 'gouverne');

    const dit = await jusqua(() =>
      srv.store
        .listEvents(0, 200)
        .some((e) => e.type === 'essaim_cycle' && e.payload.issue === 'non_branche'),
    );
    expect(dit).toBe(true);
  });

  it('LE JOURNAL NE PORTE PAS LE CONTENU PRODUIT', async () => {
    // Le Journal est lisible par tout membre de la ruche : y déverser un diff
    // ou un log d'agent en ferait une fuite par inadvertance.
    const { base, srv } = await demarrer('on');
    const p = rucheGouvernable(srv);
    await regler(base, p, 'gouverne');
    await jusqua(() => srv.store.listEvents(0, 200).some((e) => e.type === 'essaim_cycle'));
    for (const e of srv.store.listEvents(0, 200).filter((x) => x.type === 'essaim_cycle')) {
      expect(Object.keys(e.payload).sort()).toEqual(
        expect.arrayContaining(['issue', 'motif', 'pas', 'projectId']),
      );
      expect(JSON.stringify(e.payload).length).toBeLessThan(600);
    }
  });
});
