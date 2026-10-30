// Les routes des Routines, à travers une VRAIE Reine.
//
// Ce que ce banc tient au bord HTTP, là où un émetteur extérieur frappe :
//   · la clé HMAC d'un webhook n'est remise qu'UNE fois, et aucune lecture ne
//     la rend ;
//   · une signature juste lance ; une livraison rejouée (même identifiant) ne
//     relance pas ; une signature fausse, une routine inconnue et une clé
//     RÉVOQUÉE rendent le même 401, octet pour octet ;
//   · une routine en pause range le webhook reçu au lieu de l'avaler ;
//   · le moteur câblé à la Reine lance un créneau cron comme une tâche du
//     projet, visible dans la liste des runs.
// Les portes (qui peut créer, régler, lancer) : tests/engagement-projet.test.ts.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signer } from '../src/orchestrator/abonnement.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-de-ruche-suffisamment-long-42';

interface VueRoutine {
  id: string;
  actif: boolean;
  webhook: string | null;
  prochaineA: number | null;
  autorite: 'jeton' | 'compte';
  runs: { statut: string; source: string; taches: string[] }[];
}

describe('les routes des Routines', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let projet: string;

  const jeton = { 'x-hive-token': TOKEN, 'content-type': 'application/json' };
  const appeler = (methode: string, url: string, corps?: unknown) =>
    fetch(`${base}${url}`, {
      method: methode,
      headers: corps === undefined ? { 'x-hive-token': TOKEN } : jeton,
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
  const lister = async (): Promise<VueRoutine[]> =>
    (
      (await (await appeler('GET', `/api/projects/${projet}/routines`)).json()) as {
        routines: VueRoutine[];
      }
    ).routines;

  /** Une livraison signée, comme l'envoie l'Action d'exemple. */
  const livrer = (
    url: string,
    secret: string,
    corps: unknown,
    livraison?: string,
    now = Date.now(),
  ) => {
    const brut = JSON.stringify(corps);
    return fetch(`${base}${url}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hive-signature': signer(brut, secret, now),
        ...(livraison ? { 'x-hive-delivery': livraison } : {}),
      },
      body: brut,
    });
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-routines-api-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
      // Le tour automatique ne doit pas courir pendant le banc : c'est le
      // banc qui choisit l'instant (`server.routines.tick`).
      routinesTickMs: 3_600_000,
    });
    base = `http://127.0.0.1:${server.port}`;
    projet = server.store.createProject({ name: 'Projet de la ruche', ownerId: null }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('WEBHOOK : clé remise une fois, livraison signée lancée, rejouée NON relancée', async () => {
    // Projet DÉDIÉ : le banc compte TOUTES les tâches du projet (`toHaveLength(1)`),
    // et les voisins du describe en créent aussi — sur le projet partagé, le
    // compte dépendrait de l'ordre d'exécution (ERREURS.md § 2.14, le vert
    // emprunté au voisin).
    const abri = server.store.createProject({ name: 'Projet du webhook', ownerId: null }).id;
    const listerAbri = async (): Promise<VueRoutine[]> =>
      (
        (await (await appeler('GET', `/api/projects/${abri}/routines`)).json()) as {
          routines: VueRoutine[];
        }
      ).routines;

    const cree = await appeler('POST', `/api/projects/${abri}/routines`, {
      nom: 'Tri des issues étiquetées',
      consigne: 'Trier l’issue et proposer un correctif.',
      declencheur: 'webhook',
    });
    expect(cree.status).toBe(201);
    const { routine, secret } = (await cree.json()) as { routine: VueRoutine; secret: string };
    expect(secret).toMatch(/^rtn_/);
    expect(routine.autorite).toBe('jeton');
    expect(JSON.stringify(await listerAbri()), 'une lecture ne rend jamais la clé').not.toContain(
      secret,
    );

    const url = routine.webhook!;
    const corps = { contexte: { issue: '#42 — la page d’accueil plante' } };
    const r1 = await livrer(url, secret, corps, 'livraison-1');
    expect(r1.status).toBe(202);
    expect(((await r1.json()) as { statut: string }).statut).toBe('lancee');
    const r2 = await livrer(url, secret, corps, 'livraison-1');
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ doublon: true });

    const taches = server.store.listTasks(abri);
    expect(taches).toHaveLength(1);
    expect(taches[0]?.prompt).toContain('#42 — la page d’accueil plante');
    const vue = (await listerAbri()).find((x) => x.id === routine.id);
    expect(vue?.runs.map((x) => `${x.source}:${x.statut}`)).toEqual(['webhook:lancee']);
  });

  it('SIGNATURE FAUSSE, ROUTINE INCONNUE, CLÉ RÉVOQUÉE : le même 401, octet pour octet', async () => {
    const { routine, secret } = (await (
      await appeler('POST', `/api/projects/${projet}/routines`, {
        nom: 'Révocable',
        consigne: 'Faire quelque chose.',
        declencheur: 'webhook',
      })
    ).json()) as { routine: VueRoutine; secret: string };
    const url = routine.webhook!;

    const fausse = await livrer(url, 'rtn_pas-la-bonne-cle', {}, 'l-a');
    const inconnue = await livrer(
      `/api/projects/${projet}/routines/nexiste-pas/webhook`,
      secret,
      {},
    );
    const perimee = await livrer(url, secret, {}, 'l-b', Date.now() - 10 * 60_000);
    const corpsRefus = await fausse.text();
    for (const r of [fausse, inconnue, perimee]) expect(r.status).toBe(401);
    expect(await inconnue.text()).toBe(corpsRefus);
    expect(await perimee.text()).toBe(corpsRefus);

    // Régénérer la clé RÉVOQUE l'ancienne, sans fenêtre où les deux signent.
    const rot = await appeler('POST', `/api/projects/${projet}/routines/${routine.id}/secret`);
    const { secret: neuve } = (await rot.json()) as { secret: string };
    expect(neuve).not.toBe(secret);
    const ancienne = await livrer(url, secret, {}, 'l-c');
    expect(ancienne.status, 'la clé révoquée signe encore').toBe(401);
    expect(await ancienne.text()).toBe(corpsRefus);
    expect((await livrer(url, neuve, {}, 'l-d')).status).toBe(202);
  });

  it('EN PAUSE : le webhook reçu est rangé `ignoree` ; reprendre relance', async () => {
    const { routine, secret } = (await (
      await appeler('POST', `/api/projects/${projet}/routines`, {
        nom: 'En pause',
        consigne: 'Faire quelque chose.',
        declencheur: 'webhook',
        concurrence: 'always_enqueue',
      })
    ).json()) as { routine: VueRoutine; secret: string };
    const pause = await appeler('PUT', `/api/projects/${projet}/routines/${routine.id}`, {
      actif: false,
    });
    expect(((await pause.json()) as { routine: VueRoutine }).routine.actif).toBe(false);
    const r = await livrer(routine.webhook!, secret, {}, 'pendant-la-pause');
    expect(((await r.json()) as { statut: string }).statut).toBe('ignoree');
    await appeler('PUT', `/api/projects/${projet}/routines/${routine.id}`, { actif: true });
    const apres = await livrer(routine.webhook!, secret, {}, 'apres-la-pause');
    expect(((await apres.json()) as { statut: string }).statut).toBe('lancee');
  });

  it('CRON : le moteur câblé à la Reine lance le créneau comme une tâche du projet', async () => {
    const cree = await appeler('POST', `/api/projects/${projet}/routines`, {
      nom: 'Chaque minute',
      consigne: 'Surveiller.',
      declencheur: 'cron',
      expression: '* * * * *',
      fuseau: 'Europe/Paris',
    });
    const { routine } = (await cree.json()) as { routine: VueRoutine };
    expect(routine.prochaineA).toBeGreaterThan(Date.now() - 1);
    await server.routines.tick(routine.prochaineA! + 1_000);
    const vue = (await lister()).find((x) => x.id === routine.id);
    expect(vue?.runs.map((x) => x.statut)).toEqual(['lancee']);
    const tache = server.store.getTask(vue!.runs[0]!.taches[0]!);
    expect(tache?.projectId).toBe(projet);
    expect(tache?.title).toBe('⟳ Chaque minute');
  });

  it('les refus de définition nomment le champ — « CI rouge » exige un dépôt GitHub', async () => {
    const ci = await appeler('POST', `/api/projects/${projet}/routines`, {
      nom: 'CI rouge',
      consigne: 'Réparer main.',
      declencheur: 'ci_rouge',
    });
    expect(ci.status).toBe(400);
    expect(((await ci.json()) as { error: string }).error).toMatch(/dépôt/);
    const fuseau = await appeler('POST', `/api/projects/${projet}/routines`, {
      nom: 'x',
      consigne: 'y',
      declencheur: 'cron',
      expression: '0 9 * * 1-5',
      fuseau: 'Europe/Atlantide',
    });
    expect(fuseau.status).toBe(400);
    expect(((await fuseau.json()) as { error: string }).error).toMatch(/fuseau/);
  });

  it('SUPPRIMER est idempotent, et emporte l’historique', async () => {
    const { routine } = (await (
      await appeler('POST', `/api/projects/${projet}/routines`, {
        nom: 'Éphémère',
        consigne: 'Rien.',
        declencheur: 'webhook',
      })
    ).json()) as { routine: VueRoutine };
    await appeler('POST', `/api/projects/${projet}/routines/${routine.id}/declencher`);
    const url = `/api/projects/${projet}/routines/${routine.id}`;
    expect(await (await appeler('DELETE', url)).json()).toEqual({ supprimee: true });
    expect(await (await appeler('DELETE', url)).json()).toEqual({ supprimee: false });
    expect(server.store.runsDeRoutine(routine.id, 10)).toEqual([]);
  });
});
