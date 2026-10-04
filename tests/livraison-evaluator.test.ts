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
//   · livrer et fusionner ÉCRIVENT avec la clé GitHub de l'hôte : il faut
//     répondre du projet (propriétaire, administrateur, ou le jeton sur un
//     orphelin), parler au nom de l'hôte (le jeton de ruche ou un compte
//     administrateur), et répondre de CHAQUE projet qui tient le même dépôt ;
//   · qui peut livrer peut passer outre, avec une raison obligatoire, et
//     `evaluator_overridden` garde qui, pourquoi, contre quel verdict — en faits
//     typés seulement.
//
// Le faux GitHub est celui de `livraison-parcours.test.ts` : `HIVE_GITHUB_API`
// pointe sur un serveur local, rien ne part sur le réseau. Il sert N'IMPORTE
// QUEL dépôt `micka/…` : chaque projet du banc a le sien, sauf quand un test
// éprouve justement deux projets sur le même dépôt.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as creerHttp } from 'node:http';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-livraison-evaluator-long';
/** Le dépôt du projet POSSÉDÉ ; l'orphelin a le sien (cf. `beforeAll`). */
const DEPOT = 'micka/ruche-evaluee';
const DEPOT_ORPHELIN = 'micka/ruche-orpheline';

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
  let jetonInconnu = '';
  let prochainePr = 500;
  /** Les pull requests que le faux GitHub a ouvertes, puis fusionnées. */
  const ouvertes: number[] = [];
  const fusionnees: number[] = [];
  let avantJeton: string | undefined;
  let avantApi: string | undefined;

  const jeton = { 'x-hive-token': TOKEN };
  const compte = (t: string) => ({ authorization: `Bearer ${t}` });
  /** Ce que le tableau de bord envoie à un propriétaire connecté : les deux. */
  const proprioConnecte = () => ({ ...compte(jetonProprio), ...jeton });

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
      const [, depot = '', suite = ''] = /^\/repos\/(micka\/[^/]+)(.*)$/.exec(u.pathname) ?? [];
      if (depot === '') return repondre(404, { message: 'Not Found' });
      if (suite === '') return repondre(200, { full_name: depot, default_branch: 'main' });
      if (suite === '/git/ref/heads/main') return repondre(200, { object: { sha: 'base-sha' } });
      if (suite.startsWith('/contents/')) {
        return repondre(200, {
          type: 'file',
          sha: 'ancien-sha',
          encoding: 'base64',
          content: Buffer.from('avant\n').toString('base64'),
        });
      }
      if (suite === '/git/blobs') return repondre(201, { sha: 'blob-sha' });
      if (suite === '/git/trees') return repondre(201, { sha: 'arbre-sha' });
      if (suite === '/git/commits') return repondre(201, { sha: 'commit-sha' });
      if (suite === '/git/refs') return repondre(201, { ref: 'ok' });
      if (suite === '/pulls' && req.method === 'POST') {
        const numero = prochainePr++;
        ouvertes.push(numero);
        return repondre(201, {
          number: numero,
          html_url: `https://github.com/${depot}/pull/${numero}`,
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
    jetonInconnu = (await inscrire('inconnu@ailleurs.test')).token;

    orphelin = server.store.createProject({
      name: 'Orphelin',
      repoUrl: `https://github.com/${DEPOT_ORPHELIN}.git`,
      ownerId: null,
    }).id;
    possede = server.store.createProject({
      name: 'Possédé',
      repoUrl: `https://github.com/${DEPOT}.git`,
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
    // Avant la livraison, la production se fait encore corriger.
    expect(corps.conseil).toContain(`/api/tasks/${tache}/evaluation/retry`);
    expect(ouvertes.length, 'une pull request est partie malgré le verdict').toBe(avant);
    expect(server.store.getLivraison(tache), 'une livraison a été réservée').toBeFalsy();
  });

  it('LA PRODUCTION JUGÉE, OU RIEN : un `resultId` périmé ne livre pas la suivante', async () => {
    // Qui a jugé une production précise (la porte de la boucle V3) la désigne ;
    // une production arrivée entre-temps ne part pas à sa place.
    const tache = production(orphelin, 'clean');
    const jugee = server.store.resultsForTask(tache).at(-1)?.resultId ?? 0;
    server.store.insertResult({
      taskId: tache,
      nodeId: 'noeud-1',
      success: true,
      diff: DIFF,
      logs: 'une tentative de plus',
      durationMs: 10,
      subAgents: [],
    });
    const avant = ouvertes.length;
    const perimee = await poster('/api/livraison', { taskId: tache, resultId: jugee }, jeton);
    expect(perimee.status).toBe(409);
    expect(await perimee.json()).toMatchObject({
      code: 'stale_result',
      currentResultId: jugee + 1,
    });
    expect(ouvertes.length, 'une pull request est partie sur une production non jugée').toBe(avant);
    expect(server.store.getLivraison(tache), 'une livraison a été réservée').toBeFalsy();

    const courante = await poster('/api/livraison', { taskId: tache, resultId: jugee + 1 }, jeton);
    expect(courante.status).toBe(201);
  });

  it('UN `resultId` PÉRIMÉ se dit AVANT l’Evaluator : `stale_result`, pas `evaluator_blocks`', async () => {
    // L'Evaluator juge la DERNIÈRE production ; son refus porterait sur une
    // production que l'appelant n'a pas désignée, et « forcer » la livrerait.
    const tache = production(orphelin, 'suspect');
    const courante = server.store.resultsForTask(tache).at(-1)?.resultId ?? 0;
    const r = await poster('/api/livraison', { taskId: tache, resultId: courante + 1_000 }, jeton);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'stale_result', currentResultId: courante });
  });

  it('UN `resultId` PÉRIMÉ sur un REJEU se dit tel quel — aucune livraison simulée n’est rangée', async () => {
    // Simuler (et ranger) la livraison d'une production que l'appelant n'a
    // pas désignée ferait croire à la ruche autonome qu'elle est traitée.
    const rejeu = server.store.createProject({
      name: 'Rejeu périmé',
      repoUrl: 'https://github.com/micka/rejeu-perime.git',
      ownerId: null,
    }).id;
    server.store.inscrireRejeu({
      projectId: rejeu,
      missionSource: 'mission-source',
      projetSource: orphelin,
      surcharges: {},
      genomeFige: null,
      creePar: null,
      creeA: Date.now(),
    });
    const tache = production(rejeu, 'clean');
    const courante = server.store.resultsForTask(tache).at(-1)?.resultId ?? 0;
    const r = await poster('/api/livraison', { taskId: tache, resultId: courante + 1_000 }, jeton);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'stale_result' });
    expect(server.store.actionsDuRejeu(rejeu)).toEqual([]);
    expect(
      server.store
        .listEvents(0, 1000)
        .filter((e) => e.type === 'rejeu_action_simulee' && e.payload.projectId === rejeu),
    ).toEqual([]);
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

  it('PASSER OUTRE : qui peut livrer, avec une raison — et une trace en faits typés', async () => {
    const tache = production(possede, 'suspect');

    // Un membre ENGAGE le projet ; il ne décide pas de ce qui part chez GitHub,
    // forcé ou non : 403, qui dit à qui s'adresser.
    for (const corps of [{ taskId: tache }, { taskId: tache, forcer: { raison: 'pressé' } }]) {
      const parMembre = await poster('/api/livraison', corps, compte(jetonMembre));
      expect(parMembre.status).toBe(403);
      expect(((await parMembre.json()) as { error: string }).error).toMatch(/propriétaire/);
    }
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
      proprioConnecte(),
    );
    expect(muet.status).toBe(400);
    expect(forcages(tache), 'aucun refus ne doit laisser de trace de forçage').toHaveLength(0);

    const r = await poster(
      '/api/livraison',
      { taskId: tache, forcer: { raison: 'faux positif des Gardiennes, relu à la main' } },
      proprioConnecte(),
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
    // Faits TYPÉS seulement : les raisons de l'Evaluator peuvent citer le texte
    // d'un agent, et ce journal part à tout le tableau de bord.
    expect(trace?.payload, 'le journal recopie les raisons de l’Evaluator').not.toHaveProperty(
      'raisons',
    );

    // Un second forçage sur une tâche DÉJÀ livrée est refusé (409) — et ne
    // laisse pas de trace : il n'a rien forcé.
    const encore = await poster(
      '/api/livraison',
      { taskId: tache, forcer: { raison: 'une deuxième fois' } },
      proprioConnecte(),
    );
    expect(encore.status).toBe(409);
    expect(forcages(tache), 'un forçage refusé a laissé une trace').toHaveLength(1);
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
    const corps = (await refus.json()) as { decision: string; conseil: string };
    expect(corps.decision).toBe('correction_required');
    expect(fusionnees, 'la PR a été fusionnée malgré le verdict').not.toContain(pr);
    // Après la livraison, relancer la tâche est FERMÉ (`delivery_exists`) : le
    // conseil nomme la reprise de la pull request, pas un second refus.
    expect(corps.conseil).toContain(`/api/projects/${orphelin}/livraisons/${tache}/reprendre`);
    expect(corps.conseil).not.toContain('evaluation/retry');

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

  it('UNE PULL REQUEST DONT LA TÂCHE A DISPARU NE SE FUSIONNE PAS EN SILENCE', async () => {
    // L'élagage des livraisons passe AVANT celui des tâches : une livraison
    // ouverte peut survivre à sa tâche. Sans verdict, pas de feu vert.
    const pr = prochainePr++;
    server.store.setLivraison({
      taskId: 'tache-elaguee',
      projectId: orphelin,
      depot: DEPOT_ORPHELIN,
      pr,
      branche: 'hive/tache-elaguee',
      etat: 'ouverte',
    });
    const refus = await poster('/api/livraison/fusion', { projectId: orphelin, pr }, jeton);
    expect(refus.status).toBe(409);
    expect(((await refus.json()) as { code: string }).code).toBe('evaluation_indisponible');
    expect(fusionnees).not.toContain(pr);

    const forcee = await poster(
      '/api/livraison/fusion',
      { projectId: orphelin, pr, forcer: { raison: 'relue sur GitHub, tâche élaguée' } },
      jeton,
    );
    expect(forcee.status).toBe(200);
    expect(fusionnees).toContain(pr);
    expect(forcages('tache-elaguee')[0]?.payload).toMatchObject({
      geste: 'fusion',
      decision: null,
      raison: 'relue sur GitHub, tâche élaguée',
    });
  });

  it('LA CLÉ GITHUB DE L’HÔTE N’OBÉIT PAS AU PREMIER INSCRIT VENU', async () => {
    // L'inscription est ouverte par défaut. Un inconnu, sans le jeton de ruche,
    // crée SON projet sur un dépôt que la clé de l'hôte atteint : il en est le
    // propriétaire. Il ne livre pas, ne fusionne pas, et ne règle pas la ruche
    // pour qu'elle le fasse à sa place.
    const creation = await poster(
      '/api/projects/user',
      { name: 'Le mien', repoUrl: 'https://github.com/micka/depot-de-l-hote' },
      compte(jetonInconnu),
    );
    expect(creation.status).toBe(201);
    const { id: sien } = (await creation.json()) as { id: string };
    const tache = production(sien, 'clean');
    const avant = ouvertes.length;

    const livraison = await poster('/api/livraison', { taskId: tache }, compte(jetonInconnu));
    expect(livraison.status).toBe(403);
    expect(((await livraison.json()) as { code: string }).code).toBe('jeton_hote_requis');
    server.store.setLivraison({
      taskId: tache,
      projectId: sien,
      depot: 'micka/depot-de-l-hote',
      pr: 4242,
      branche: `hive/${tache}`,
      etat: 'ouverte',
    });
    const fusion = await poster(
      '/api/livraison/fusion',
      { projectId: sien, pr: 4242 },
      compte(jetonInconnu),
    );
    expect(fusion.status).toBe(403);
    const essaim = await poster(
      `/api/projects/${sien}/essaim`,
      { niveau: 'gouverne' },
      compte(jetonInconnu),
    );
    expect(essaim.status, 'régler « gouverne », c’est livrer plus tard').toBe(403);
    // Ce qui n'écrit pas chez GitHub reste à lui : il règle « propose ».
    const propose = await poster(
      `/api/projects/${sien}/essaim`,
      { niveau: 'propose' },
      compte(jetonInconnu),
    );
    expect(propose.status).toBe(200);
    expect(ouvertes.length, 'une pull request est partie').toBe(avant);
    expect(fusionnees).not.toContain(4242);

    // Le propriétaire d'un projet sur SON dépôt, connecté comme le tableau de
    // bord le connecte (compte + jeton), livre ; son compte seul ne suffit pas.
    const autre = production(possede, 'clean');
    const compteSeul = await poster('/api/livraison', { taskId: autre }, compte(jetonProprio));
    expect(compteSeul.status).toBe(403);
    expect((await poster('/api/livraison', { taskId: autre }, proprioConnecte())).status).toBe(201);
  });

  it('UN SECOND PROJET SUR LE MÊME DÉPÔT NE ROUVRE PAS AU JETON LE DÉPÔT D’UN PROPRIÉTAIRE', async () => {
    // Le jeton ne livre plus sur le projet possédé. Il créait alors un projet
    // ORPHELIN sur le même dépôt — `.git` en moins, casse changée : rien ne le
    // dédoublonne —, qui lui était ouvert, et livrait puis fusionnait de là.
    for (const repoUrl of [
      `https://github.com/${DEPOT}`,
      `https://github.com/${DEPOT.toUpperCase()}.git`,
    ]) {
      const cree = await poster('/api/projects', { name: 'Alias', repoUrl }, jeton);
      expect(cree.status).toBe(201);
      const { id: alias } = (await cree.json()) as { id: string };
      const tache = production(alias, 'clean');
      const avant = ouvertes.length;

      const livraison = await poster('/api/livraison', { taskId: tache }, jeton);
      expect(livraison.status, repoUrl).toBe(403);
      expect(((await livraison.json()) as { code: string }).code).toBe('depot_tenu_ailleurs');
      server.store.setLivraison({
        taskId: tache,
        projectId: alias,
        depot: DEPOT,
        pr: 4343,
        branche: `hive/${tache}`,
        etat: 'ouverte',
      });
      const fusion = await poster('/api/livraison/fusion', { projectId: alias, pr: 4343 }, jeton);
      expect(fusion.status, repoUrl).toBe(403);
      const plein = await poster(
        `/api/projects/${alias}/essaim`,
        { niveau: 'plein', depotInscrit: true },
        jeton,
      );
      expect(plein.status, `${repoUrl} : plein + dépôt inscrit`).toBe(403);
      expect(ouvertes.length, 'une pull request est partie de l’alias').toBe(avant);
      expect(fusionnees).not.toContain(4343);
    }
  });
});
