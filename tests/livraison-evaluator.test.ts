// L'EVALUATOR EST ÉCOUTÉ AU MOMENT DE LIVRER — et passer outre se signe.
//
// ─── LE DÉFAUT QUE CES BANCS FERMENT ─────────────────────────────────────────
//
// `POST /api/livraison` ouvrait une pull request pour tout dernier résultat
// réussi, et `POST /api/livraison/fusion` fusionnait sans lire l'évaluation.
// Une production que les Gardiennes jugeaient creuse ou suspecte, qu'une revue
// humaine avait rejetée, partait sur le dépôt du propriétaire exactement comme
// une production acceptée : l'Evaluator rendait un verdict que personne
// n'écoutait au seul moment où il comptait.
//
// ─── CE QUI EST DÉCIDÉ ───────────────────────────────────────────────────────
//
//   · `correction_required` et `rejected` ARRÊTENT le geste (409) — ce sont les
//     deux verdicts où une preuve indépendante a dit non ;
//   · une preuve qui MANQUE (`human_review_required`, `additional_test_required`)
//     n'arrête rien : l'humain qui livre est justement celui qui relit ;
//   · passer outre est un RÉGLAGE du projet : propriétaire ou administrateur
//     (ou le jeton sur un projet orphelin), une raison obligatoire, et
//     `evaluator_overridden` garde qui, pourquoi, contre quel verdict.
//
// Le faux GitHub est celui de `livraison-parcours.test.ts` : `HIVE_GITHUB_API`
// pointe sur un serveur local, rien ne part sur le réseau.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as creerHttp } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-livraison-evaluator-long';
const DEPOT = 'micka/ruche-evaluee';

const DIFF = [
  'diff --git a/note.txt b/note.txt',
  'index 0000000..1111111 100644',
  '--- a/note.txt',
  '+++ b/note.txt',
  '@@ -1 +1 @@',
  '-avant',
  '+après',
  '',
].join('\n');

describe('livrer et fusionner sous le verdict de l’Evaluator', () => {
  let faux: Server;
  let server: HiveServer;
  let dir: string;
  let base: string;
  let orphelin = '';
  let possede = '';
  let idProprio = '';
  let jetonProprio = '';
  let jetonMembre = '';
  let prochainePr = 500;
  /** Les pull requests que le faux GitHub a ouvertes, puis fusionnées. */
  const ouvertes: number[] = [];
  const fusionnees: number[] = [];
  let avantJeton: string | undefined;
  let avantApi: string | undefined;

  const jeton = { 'x-hive-token': TOKEN };
  const compte = (t: string) => ({ authorization: `Bearer ${t}` });

  const poster = (chemin: string, corps: unknown, entetes: Record<string, string>) =>
    fetch(`${base}${chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify(corps),
    });

  const inscrire = async (email: string, entetes: Record<string, string> = {}) => {
    const r = await poster(
      '/api/auth/register',
      { email, password: 'motdepasse-assez-long-42', displayName: email },
      entetes,
    );
    const { token } = (await r.json()) as { token: string };
    const moi = (await (await fetch(`${base}/api/auth/me`, { headers: compte(token) })).json()) as {
      id: string;
    };
    return { token, id: moi.id };
  };

  /**
   * Une tâche terminée, sa production, et le verdict des Gardiennes sur CETTE
   * production — c'est lui que l'Evaluator lit : `suspect` → correction,
   * `hollow` → rejet, `clean` → rien qui arrête.
   */
  const production = (projet: string, verdict: 'clean' | 'suspect' | 'hollow'): string => {
    const s = server.store;
    const t = s.createTask({ projectId: projet, title: `Production ${verdict}`, prompt: 'x' });
    s.patchTask(t.id, { status: 'done', assignedNodeId: 'noeud-1' });
    const resultId = s.insertResult({
      taskId: t.id,
      nodeId: 'noeud-1',
      success: true,
      diff: DIFF,
      logs: 'ok',
      durationMs: 10,
      subAgents: [],
    });
    s.enregistrerInspection({
      resultId: typeof resultId === 'number' ? resultId : 0,
      taskId: t.id,
      nodeId: 'noeud-1',
      verdict,
      score: verdict === 'clean' ? 0 : 80,
      applique: true,
      griefs: [],
    });
    return t.id;
  };

  /**
   * Les forçages journalisés pour CETTE tâche. Filtrer par tâche n'est pas un
   * confort : les tests de ce fichier se rejouent dans n'importe quel ordre
   * (`tamis-ordres`), et le forçage d'un voisin ne doit rien dire ici.
   */
  const forcages = (taskId: string) =>
    server.store
      .listEvents(0, 1000)
      .filter((e) => e.type === 'evaluator_overridden' && e.payload.taskId === taskId);

  beforeAll(async () => {
    faux = creerHttp((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      const repondre = (code: number, corps: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corps));
      };
      if (u.pathname === `/repos/${DEPOT}`) {
        return repondre(200, { full_name: DEPOT, default_branch: 'main' });
      }
      if (u.pathname === `/repos/${DEPOT}/git/ref/heads/main`) {
        return repondre(200, { object: { sha: 'base-sha' } });
      }
      if (u.pathname.startsWith(`/repos/${DEPOT}/contents/`)) {
        return repondre(200, {
          type: 'file',
          sha: 'ancien-sha',
          encoding: 'base64',
          content: Buffer.from('avant\n').toString('base64'),
        });
      }
      if (u.pathname === `/repos/${DEPOT}/git/blobs`) return repondre(201, { sha: 'blob-sha' });
      if (u.pathname === `/repos/${DEPOT}/git/trees`) return repondre(201, { sha: 'arbre-sha' });
      if (u.pathname === `/repos/${DEPOT}/git/commits`) {
        return repondre(201, { sha: 'commit-sha' });
      }
      if (u.pathname === `/repos/${DEPOT}/git/refs`) return repondre(201, { ref: 'ok' });
      if (u.pathname === `/repos/${DEPOT}/pulls` && req.method === 'POST') {
        const numero = prochainePr++;
        ouvertes.push(numero);
        return repondre(201, {
          number: numero,
          html_url: `https://github.com/${DEPOT}/pull/${numero}`,
        });
      }
      const m = /^\/repos\/(.+)\/pulls\/(\d+)\/merge$/.exec(u.pathname);
      if (m && req.method === 'PUT') {
        fusionnees.push(Number(m[2]));
        return repondre(200, { merged: true, sha: `sha-de-${m[2]}` });
      }
      repondre(404, { message: 'Not Found' });
    });
    await new Promise<void>((r) => faux.listen(0, '127.0.0.1', r));
    const port = (faux.address() as { port: number }).port;

    avantJeton = process.env.HIVE_GITHUB_TOKEN;
    avantApi = process.env.HIVE_GITHUB_API;
    process.env.HIVE_GITHUB_TOKEN = 'jeton-github-de-test-evaluator';
    process.env.HIVE_GITHUB_API = `http://127.0.0.1:${port}`;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-livr-eval-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    base = `http://127.0.0.1:${server.port}`;

    await inscrire('la-reine@ruche.test', jeton);
    const proprio = await inscrire('proprio@ruche.test');
    idProprio = proprio.id;
    jetonProprio = proprio.token;
    const membre = await inscrire('membre@ruche.test');
    jetonMembre = membre.token;

    const repoUrl = `https://github.com/${DEPOT}.git`;
    orphelin = server.store.createProject({ name: 'Orphelin', repoUrl, ownerId: null }).id;
    possede = server.store.createProject({
      name: 'Possédé',
      repoUrl,
      visibility: 'private',
      ownerId: proprio.id,
    }).id;
    server.store.addMember(possede, proprio.id, 'owner');
    server.store.addMember(possede, membre.id);
  });

  afterAll(async () => {
    await server.stop();
    await new Promise<void>((r) => faux.close(() => r()));
    if (avantJeton === undefined) delete process.env.HIVE_GITHUB_TOKEN;
    else process.env.HIVE_GITHUB_TOKEN = avantJeton;
    if (avantApi === undefined) delete process.env.HIVE_GITHUB_API;
    else process.env.HIVE_GITHUB_API = avantApi;
    rmSync(dir, { recursive: true, force: true });
  });

  it('UNE PRODUCTION RENVOYÉE EN CORRECTION NE PART PAS — et le refus dit pourquoi et quoi faire', async () => {
    const tache = production(orphelin, 'suspect');
    const avant = ouvertes.length;
    const r = await poster('/api/livraison', { taskId: tache }, jeton);
    expect(r.status).toBe(409);
    const corps = (await r.json()) as {
      code: string;
      decision: string;
      raisons: string[];
      conseil: string;
    };
    expect(corps.code).toBe('evaluator_blocks');
    expect(corps.decision).toBe('correction_required');
    expect(corps.raisons.join(' ')).toMatch(/Gardiennes/);
    expect(corps.conseil, 'le refus nomme la sortie').toMatch(/forcer/);
    expect(ouvertes.length, 'une pull request est partie malgré le verdict').toBe(avant);
    expect(server.store.getLivraison(tache), 'une livraison a été réservée').toBeFalsy();
  });

  it('UNE PRODUCTION REJETÉE NE PART PAS NON PLUS', async () => {
    const r = await poster('/api/livraison', { taskId: production(orphelin, 'hollow') }, jeton);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { decision: string }).decision).toBe('rejected');
  });

  it('UNE PREUVE QUI MANQUE N’EST PAS UN REFUS — l’humain qui livre est celui qui relit', async () => {
    // Gardiennes propres, aucune CI, aucune contre-revue : l'Evaluator demande
    // davantage de preuves, il ne dit pas non.
    const tache = production(orphelin, 'clean');
    const evaluation = (await (
      await fetch(`${base}/api/tasks/${tache}/evaluation`, { headers: jeton })
    ).json()) as { decision: string };
    expect(['human_review_required', 'additional_test_required']).toContain(evaluation.decision);
    const r = await poster('/api/livraison', { taskId: tache }, jeton);
    expect(r.status).toBe(201);
  });

  it('PASSER OUTRE : le propriétaire, avec une raison — pas un membre, et jamais sans trace', async () => {
    const tache = production(possede, 'suspect');

    // Un membre ENGAGE le projet (il atteint le verdict)…
    const sansForcer = await poster('/api/livraison', { taskId: tache }, compte(jetonMembre));
    expect(sansForcer.status).toBe(409);
    // …mais passer outre est un réglage : 403, qui dit à qui s'adresser.
    const parMembre = await poster(
      '/api/livraison',
      { taskId: tache, forcer: { raison: 'je suis pressé' } },
      compte(jetonMembre),
    );
    expect(parMembre.status).toBe(403);
    // Le jeton de ruche n'engage même pas le projet d'autrui.
    const parJeton = await poster(
      '/api/livraison',
      { taskId: tache, forcer: { raison: 'je suis la ruche' } },
      jeton,
    );
    expect(parJeton.status).toBe(404);
    // Une raison vide n'en est pas une.
    const muet = await poster(
      '/api/livraison',
      { taskId: tache, forcer: { raison: '   ' } },
      compte(jetonProprio),
    );
    expect(muet.status).toBe(400);
    expect(forcages(tache), 'aucun refus ne doit laisser de trace de forçage').toHaveLength(0);

    const r = await poster(
      '/api/livraison',
      { taskId: tache, forcer: { raison: 'faux positif des Gardiennes, relu à la main' } },
      compte(jetonProprio),
    );
    expect(r.status).toBe(201);
    const [trace] = forcages(tache);
    expect(trace?.payload).toMatchObject({
      taskId: tache,
      projectId: possede,
      geste: 'livraison',
      decision: 'correction_required',
      raison: 'faux positif des Gardiennes, relu à la main',
      parUserId: idProprio,
    });
  });

  it('LA FUSION RELIT LE VERDICT AU MOMENT DE FUSIONNER', async () => {
    // Livrée propre, puis rejetée par la revue humaine : la fusion l'apprend.
    const tache = production(orphelin, 'clean');
    const livree = await poster('/api/livraison', { taskId: tache }, jeton);
    expect(livree.status).toBe(201);
    const { pr } = (await livree.json()) as { pr: number };
    server.store.setTaskReview(tache, 'rejected');

    const refus = await poster('/api/livraison/fusion', { projectId: orphelin, pr }, jeton);
    expect(refus.status).toBe(409);
    expect(((await refus.json()) as { decision: string }).decision).toBe('correction_required');
    expect(fusionnees, 'la PR a été fusionnée malgré le verdict').not.toContain(pr);

    // Sur un projet orphelin, le jeton de ruche EST le propriétaire (ADR 0007).
    const forcee = await poster(
      '/api/livraison/fusion',
      { projectId: orphelin, pr, forcer: { raison: 'rejet levé à l’oral, on fusionne' } },
      jeton,
    );
    expect(forcee.status).toBe(200);
    expect(fusionnees).toContain(pr);
    const trace = forcages(tache).find((e) => e.payload.geste === 'fusion');
    expect(trace?.payload).toMatchObject({
      taskId: tache,
      decision: 'correction_required',
      raison: 'rejet levé à l’oral, on fusionne',
      parUserId: null,
    });
  });
});
