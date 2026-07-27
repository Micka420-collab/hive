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
  soldes: Solde[];
  fenetre: number;
}

/** Un solde tel que l'API le rend : la dépense ET l'intention qui la borne. */
interface Solde {
  projectId: string;
  depenseMs: number;
  tentatives: number;
  plafondMs: number | null;
  etat: 'passe' | 'alerte' | 'bloque';
  bloque: boolean;
}

/** Réponse de GET/PUT /api/projects/:id/balance. */
interface ReponseProjet extends Solde {
  version: number;
  mode: string;
  aJour: boolean;
  definiPar: string | null;
  updatedAt: number | null;
  compte?: { projectId: string; totalMs: number } | null;
  fenetre?: number;
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
    // Aucun plafond posé : le solde le DIT, plutôt que de laisser le lecteur
    // deviner qu'il n'y en a pas.
    expect(body.soldes).toEqual([
      {
        projectId,
        depenseMs: 6_000,
        tentatives: 3,
        plafondMs: null,
        etat: 'passe',
        bloque: false,
      },
    ]);
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
    // `insertResult` rend désormais le `results.id` inséré (les Gardiennes y
    // rattachent leur verdict) : l'aide locale le propage plutôt que de le taire.
    const poser = (taskId: string, success: boolean, durationMs: number): number =>
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

  // ─── Borner : GET / PUT /api/projects/:id/balance (lot 3) ─────────────────

  it('T5 — projet inconnu : 404 en lecture comme en écriture', async () => {
    const lecture = await fetch(`${base}/api/projects/fantome/balance`, { headers });
    expect(lecture.status).toBe(404);
    const ecriture = await fetch(`${base}/api/projects/fantome/balance`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ plafondMs: 60_000 }),
    });
    expect(ecriture.status).toBe(404);
    // Et rien n'a été écrit au passage : un projet inconnu ne crée pas de ligne.
    expect(server.store.listBudgets()).toEqual([]);
  });

  it('sans token, la Balance d’un projet ne se lit ni ne s’écrit', async () => {
    const projet = server.store.createProject({ name: 'P' });
    expect((await fetch(`${base}/api/projects/${projet.id}/balance`)).status).toBe(401);
    const ecriture = await fetch(`${base}/api/projects/${projet.id}/balance`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plafondMs: 1 }),
    });
    expect(ecriture.status).toBe(401);
    expect(server.store.listBudgets()).toEqual([]);
  });

  it('T3 — PUT pose le plafond, journalise un fait, et `definiPar` reste null sans JWT', async () => {
    const projectId = semer('route api', 'creer un endpoint rest', [1_000, 2_000, 3_000]);
    server.scheduler.tick();

    const res = await fetch(`${base}/api/projects/${projectId}/balance`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ plafondMs: 60_000 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReponseProjet;
    expect(body).toMatchObject({
      projectId,
      plafondMs: 60_000,
      depenseMs: 6_000,
      etat: 'passe',
      bloque: false,
      definiPar: null, // le token du hub ne dit pas QUI : c'est un cas normal
    });
    expect(typeof body.updatedAt).toBe('number');
    expect(server.store.getBudget(projectId)).toMatchObject({ plafondMs: 60_000 });

    // Un fait typé, journalisé : aucune phrase, aucun texte d'affichage figé.
    const journal = server.store.listEvents(0, 1_000).filter((e) => e.type === 'balance_cap_set');
    expect(journal).toHaveLength(1);
    expect(journal[0]?.payload).toEqual({ projectId, plafondMs: 60_000 });
    for (const valeur of Object.values(journal[0]?.payload ?? {})) {
      if (typeof valeur === 'string') expect(valeur).not.toMatch(/\s/);
    }
  });

  it('T3 — avec un Bearer JWT valide, `definiPar` porte la trace de l’opérateur', async () => {
    const inscription = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'apicultrice@ruche.test',
        password: 'motdepasse-assez-long',
        displayName: 'Apicultrice',
      }),
    });
    const { token } = (await inscription.json()) as { token: string };
    const projet = server.store.createProject({ name: 'P' });

    const res = await fetch(`${base}/api/projects/${projet.id}/balance`, {
      method: 'PUT',
      headers: { ...headers, authorization: `Bearer ${token}` },
      body: JSON.stringify({ plafondMs: 1_000 }),
    });
    expect(res.status).toBe(200);
    const definiPar = server.store.getBudget(projet.id)?.definiPar;
    expect(typeof definiPar).toBe('string');
    expect(definiPar).not.toBe('');
    // `definiPar` est une TRACE, pas une autorisation : la garde reste le token
    // du hub, et un JWT seul ne suffit pas.
    const sansJeton = await fetch(`${base}/api/projects/${projet.id}/balance`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ plafondMs: 2_000 }),
    });
    expect(sansJeton.status).toBe(401);
    expect(server.store.getBudget(projet.id)?.plafondMs).toBe(1_000);
  });

  it('T4 — plafond négatif : 400 ; plafond null : 200 et la ligne disparaît', async () => {
    const projet = server.store.createProject({ name: 'P' });
    const envoyer = (corps: unknown): Promise<Response> =>
      fetch(`${base}/api/projects/${projet.id}/balance`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(corps),
      });

    expect((await envoyer({ plafondMs: -1 })).status).toBe(400);
    expect((await envoyer({ plafondMs: 1.5 })).status).toBe(400);
    expect((await envoyer({ plafondMs: 'beaucoup' })).status).toBe(400);
    expect((await envoyer({})).status).toBe(400);
    expect(server.store.listBudgets()).toEqual([]);

    // Champ inconnu : `additionalProperties: false` le FILTRE (convention
    // Fastify du dépôt, `removeAdditional` par défaut) — il n'entre jamais en
    // base, et le plafond est posé tel qu'il a été validé.
    expect((await envoyer({ plafondMs: 1_000, autre: 'chose' })).status).toBe(200);
    expect(server.store.getBudget(projet.id)).toMatchObject({ plafondMs: 1_000 });

    // 0 est un plafond légitime : « ce projet ne dépense plus rien ».
    expect((await envoyer({ plafondMs: 0 })).status).toBe(200);
    expect(server.store.getBudget(projet.id)?.plafondMs).toBe(0);

    // …et `null` le retire : la ligne disparaît, l'état « éteint » est l'absence.
    const retrait = await envoyer({ plafondMs: null });
    expect(retrait.status).toBe(200);
    expect((await retrait.json()) as ReponseProjet).toMatchObject({ plafondMs: null });
    expect(server.store.getBudget(projet.id)).toBeNull();
  });

  it('T4bis — la COERCITION d’AJV ne peut plus fabriquer un plafond', async () => {
    // Fastify active `coerceTypes` par défaut. Contre un schéma
    // `type: ['integer', 'null']`, cela transformait silencieusement :
    //   false → 0    (un projet ARRÊTÉ NET, personne ne l'a demandé)
    //   ""    → null (le plafond RETIRÉ, personne ne l'a demandé)
    // Le schéma croyait borner une valeur que la coercition avait déjà
    // remplacée. On refuse donc la valeur BRUTE, avant la validation.
    const projet = server.store.createProject({ name: 'P' });
    const envoyer = (corps: unknown): Promise<Response> =>
      fetch(`${base}/api/projects/${projet.id}/balance`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(corps),
      });

    // Un plafond légitime est posé d'abord : ce qui suit ne doit RIEN changer.
    expect((await envoyer({ plafondMs: 60_000 })).status).toBe(200);

    for (const valeur of [false, true, '', '0', '60000', [], {}, [60_000]]) {
      const res = await envoyer({ plafondMs: valeur });
      expect({ valeur, status: res.status }).toEqual({ valeur, status: 400 });
      // Et surtout : le plafond en vigueur n'a pas bougé d'un millième.
      expect(server.store.getBudget(projet.id)?.plafondMs).toBe(60_000);
    }

    // Aucun fait n'a été journalisé pour ces refus : la Chronique ne raconte
    // pas des plafonds qui n'ont pas été posés.
    const poses = server.store.listEvents(0, 1_000).filter((e) => e.type === 'balance_cap_set');
    expect(poses).toHaveLength(1);

    // Les deux seules valeurs acceptables le restent.
    expect((await envoyer({ plafondMs: 0 })).status).toBe(200);
    expect((await envoyer({ plafondMs: null })).status).toBe(200);
    expect(server.store.getBudget(projet.id)).toBeNull();
  });

  it('mode `off` : aucun solde inventé, mais le PLAFOND reste lisible', async () => {
    // `GET /api/balance` ne doit plus fabriquer un `depenseMs: 0` pour un
    // projet plafonné alors que le livre ne tourne pas — un solde inconnu n'est
    // pas un solde nul. Mais l'intention humaine, elle, doit rester visible :
    // un plafond qui disparaît de l'affichage parce que la Balance est éteinte
    // serait un mensonge, au pire endroit pour en faire un.
    const eteinte = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'eteinte.db'),
      simulation: false,
      tickMs: 10_000,
      balance: 'off',
    });
    try {
      const url = `http://127.0.0.1:${eteinte.port}`;
      const projet = eteinte.store.createProject({ name: 'P' });
      const tache = eteinte.store.createTask({ projectId: projet.id, title: 'T', prompt: 'x' });
      eteinte.store.insertResult({
        taskId: tache.id,
        nodeId: 'n1',
        success: true,
        diff: '',
        logs: '',
        durationMs: 30_000,
        subAgents: [],
      });
      await fetch(`${url}/api/projects/${projet.id}/balance`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ plafondMs: 60_000 }),
      });
      eteinte.scheduler.tick();

      const global = (await (await fetch(`${url}/api/balance`, { headers })).json()) as {
        mode: string;
        soldes: Solde[];
      };
      expect(global.mode).toBe('off');
      expect(global.soldes).toEqual([]);

      const parProjet = (await (
        await fetch(`${url}/api/projects/${projet.id}/balance`, { headers })
      ).json()) as ReponseProjet;
      expect(parProjet.mode).toBe('off');
      expect(parProjet.plafondMs).toBe(60_000);
      expect(parProjet.bloque).toBe(false); // en `off`, rien ne bloque jamais
    } finally {
      await eteinte.stop();
    }
  });

  it('le socle ne déplie JAMAIS la table `reviews` (lecture ciblée par clé primaire)', async () => {
    // `reviews` n'est jamais élaguée : la lire en entier toutes les 3 s, dans
    // la boucle d'événements, coûtait 159,8 ms mesurées à 100 000 revues.
    const projectId = semer('route api', 'creer un endpoint rest', [1_000, 2_000]);
    // Des revues sur des tâches ÉTRANGÈRES au corpus : elles ne doivent jamais
    // être lues, et encore moins entrer dans la pesée.
    for (let i = 0; i < 50; i++) server.store.setTaskReview(`hors-corpus-${i}`, 'rejected');
    server.scheduler.tick();

    let deplie = 0;
    const vraie = server.store.listReviews.bind(server.store);
    server.store.listReviews = () => {
      deplie += 1;
      return vraie();
    };
    const res = await fetch(`${base}/api/balance`, { headers });
    expect(res.status).toBe(200);
    expect(deplie).toBe(0);

    // Et le verdict des tâches DU corpus, lui, est bien pris en compte.
    const tache = server.store.listTasks(projectId)[0];
    expect(tache).toBeDefined();
    server.store.setTaskReview(tache?.id ?? '', 'rejected');
    const verdicts = server.store.listReviewsFor([tache?.id ?? '']);
    expect(verdicts[tache?.id ?? '']).toBe('rejected');
  });

  it('GET /api/projects/:id/balance dit pourquoi un projet est bloqué, durablement', async () => {
    const projectId = semer('route api', 'creer un endpoint rest', [1_000, 2_000, 3_000]);
    server.scheduler.tick();
    await fetch(`${base}/api/projects/${projectId}/balance`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ plafondMs: 1_000 }),
    });

    const body = (await (
      await fetch(`${base}/api/projects/${projectId}/balance`, { headers })
    ).json()) as ReponseProjet;
    expect(body).toMatchObject({
      version: VERSION_BALANCE,
      projectId,
      depenseMs: 6_000,
      plafondMs: 1_000,
      etat: 'bloque',
      aJour: true,
      fenetre: CORPUS_BALANCE,
    });
    // Mode `observation` par défaut : le verdict est « bloque », mais rien
    // n'est réellement arrêté — et la réponse le dit sans ambiguïté.
    expect(body.mode).toBe('observation');
    expect(body.bloque).toBe(false);
    // La tranche d'imputation du projet accompagne le solde.
    expect(body.compte).toMatchObject({ projectId, totalMs: 6_000 });
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
