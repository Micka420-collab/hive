// Contrat HTTP des abonnements.
//
// Un seul test justifie ce fichier, et tous les autres l'entourent :
//
//   ON NE S'OFFRE PAS UN ABONNEMENT EN POSTANT SUR LE WEBHOOK.
//
// Le module pur vérifie déjà la signature. Ici on vérifie que le CÂBLAGE ne
// l'a pas défaite — notamment que la vérification porte sur le corps BRUT et
// non sur un JSON re-sérialisé, piège classique qui fait passer des appels
// forgés quand l'ordre des clés change.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HEURE_MS, signer } from '../src/orchestrator/abonnement.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-abonnement-assez-long';
const SECRET = 'secret-webhook-de-test-bien-long';
const headers = { 'content-type': 'application/json', 'x-hive-token': TOKEN };

describe('endpoint des abonnements', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  let secretAvant: string | undefined;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    if (secretAvant === undefined) delete process.env.HIVE_WEBHOOK_SECRET;
    else process.env.HIVE_WEBHOOK_SECRET = secretAvant;
  });

  async function demarrer(
    secret: string | null = SECRET,
  ): Promise<{ base: string; srv: HiveServer }> {
    secretAvant = process.env.HIVE_WEBHOOK_SECRET;
    if (secret === null) delete process.env.HIVE_WEBHOOK_SECRET;
    else process.env.HIVE_WEBHOOK_SECRET = secret;

    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-abo-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    return { base: `http://127.0.0.1:${server.port}`, srv: server };
  }

  /** Poste une charge sur le webhook, signée (ou non) comme demandé. */
  async function poster(
    base: string,
    charge: Record<string, unknown>,
    opts: { secret?: string; entete?: string; now?: number } = {},
  ): Promise<Response> {
    const corps = JSON.stringify(charge);
    const entete = opts.entete ?? signer(corps, opts.secret ?? SECRET, opts.now ?? Date.now());
    return fetch(`${base}/api/webhooks/abonnement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-signature': entete },
      body: corps,
    });
  }

  const charge = (projectId: string, plan = 'essaim'): Record<string, unknown> => ({
    type: 'abonnement.actif',
    projectId,
    plan,
    refExterne: 'sub_test',
    finPeriode: Date.now() + 30 * 86_400_000,
    ts: Date.now(),
  });

  it('une signature authentique active l’abonnement ET pose le plafond', async () => {
    // Vendre n'ajoute aucun mécanisme d'exécution : cela alimente la porte que
    // le Scheduler applique déjà.
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;

    const rep = await poster(base, charge(p));
    expect(rep.status).toBe(200);
    expect(await rep.json()).toMatchObject({ applique: true, etat: 'actif', heures: 50 });

    const vue = (await (
      await fetch(`${base}/api/projects/${p}/abonnement`, { headers })
    ).json()) as { plan: string; etat: string; droits: { plafondMs: number } };
    expect(vue.plan).toBe('essaim');
    expect(vue.droits.plafondMs).toBe(50 * HEURE_MS);
    // Le plafond de La Balance suit réellement.
    expect(srv.store.getBudget(p)?.plafondMs).toBe(50 * HEURE_MS);
  });

  it('SANS SIGNATURE, rien ne passe', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const rep = await fetch(`${base}/api/webhooks/abonnement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(charge(p)),
    });
    expect(rep.status).toBe(401);
    expect(srv.store.getAbonnement(p)).toBeNull();
    expect(srv.store.getBudget(p)).toBeNull();
  });

  it('avec un MAUVAIS secret, rien ne passe', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const rep = await poster(base, charge(p), { secret: 'je-devine-le-secret' });
    expect(rep.status).toBe(401);
    expect(srv.store.getAbonnement(p)).toBeNull();
  });

  it('AUCUN secret configuré ⇒ la route refuse tout', async () => {
    // « Pas de secret donc on laisse passer » serait une porte grande ouverte.
    const { base, srv } = await demarrer(null);
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const rep = await poster(base, charge(p));
    expect(rep.status).toBe(401);
    expect(srv.store.getAbonnement(p)).toBeNull();
  });

  it('la charge MODIFIÉE après signature est refusée', async () => {
    // Le cœur du sujet : signer « eclaireuse » et livrer « colonie ».
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const honnete = JSON.stringify(charge(p, 'eclaireuse'));
    const entete = signer(honnete, SECRET, Date.now());
    const rep = await fetch(`${base}/api/webhooks/abonnement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-signature': entete },
      body: honnete.replace('eclaireuse', 'colonie'),
    });
    expect(rep.status).toBe(401);
    expect(srv.store.getAbonnement(p)).toBeNull();
  });

  it('un REJEU ancien est refusé', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const rep = await poster(base, charge(p), { now: Date.now() - 3_600_000 });
    expect(rep.status).toBe(401);
    expect(srv.store.getAbonnement(p)).toBeNull();
  });

  it('la vérification porte sur les octets REÇUS, pas sur un JSON re-sérialisé', async () => {
    // Piège classique : re-sérialiser change l'ordre des clés et les espaces,
    // donc la signature. Une charge volontairement espacée doit passer.
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const corps = JSON.stringify(charge(p), null, 4);
    const entete = signer(corps, SECRET, Date.now());
    const rep = await fetch(`${base}/api/webhooks/abonnement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hive-signature': entete },
      body: corps,
    });
    expect(rep.status, 'un corps authentique mais espacé a été refusé').toBe(200);
  });

  it('la réponse d’erreur ne dit pas comment forger la suivante', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const rep = await poster(base, charge(p), { secret: 'faux' });
    const corps = (await rep.json()) as { error: string };
    expect(corps.error).toBe('signature refusée');
    expect(JSON.stringify(corps)).not.toContain(SECRET);
    expect(JSON.stringify(corps).length).toBeLessThan(120);
  });

  it('un type d’événement hors liste blanche est refusé', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const rep = await poster(base, { ...charge(p), type: 'abonnement.tout_gratuit' });
    expect(rep.status).toBe(400);
    expect(srv.store.getAbonnement(p)).toBeNull();
  });

  it('un projet inconnu est refusé', async () => {
    const { base } = await demarrer();
    const rep = await poster(base, charge('projet-qui-nexiste-pas'));
    expect(rep.status).toBe(404);
  });

  it('un événement sans effet est ACQUITTÉ, pas rejeté', async () => {
    // Renvoyer une erreur ferait re-livrer le webhook en boucle par le
    // processeur — jusqu'à ce qu'il désactive l'endpoint.
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, charge(p));
    // Le même événement, mais antérieur : sans effet.
    const rep = await poster(base, { ...charge(p), ts: Date.now() - 60_000 });
    expect(rep.status).toBe(200);
    expect(await rep.json()).toMatchObject({ applique: false });
  });

  it('un impayé garde ses droits, une annulation les retire', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, charge(p));

    await poster(base, { ...charge(p), type: 'abonnement.paiement_echoue', ts: Date.now() + 1 });
    let vue = (await (await fetch(`${base}/api/projects/${p}/abonnement`, { headers })).json()) as {
      etat: string;
      droits: { actif: boolean };
    };
    expect(vue.etat).toBe('impaye');
    expect(vue.droits.actif, 'les droits doivent survivre au délai de grâce').toBe(true);

    await poster(base, { ...charge(p), type: 'abonnement.annule', ts: Date.now() + 2 });
    vue = (await (await fetch(`${base}/api/projects/${p}/abonnement`, { headers })).json()) as {
      etat: string;
      droits: { actif: boolean };
    };
    expect(vue.etat).toBe('annule');
    expect(vue.droits.actif).toBe(false);
    expect(srv.store.getBudget(p)?.plafondMs ?? null).toBeNull();
  });

  it('la lecture est protégée par le jeton, le webhook ne l’est pas', async () => {
    // Le processeur ne connaît pas le jeton de la ruche : c'est la SIGNATURE
    // qui l'authentifie, et elle seule.
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    expect((await fetch(`${base}/api/projects/${p}/abonnement`)).status).toBe(401);
    expect((await poster(base, charge(p))).status).toBe(200);
  });

  it('dit si le webhook est configuré, jamais le secret', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const brut = await (await fetch(`${base}/api/projects/${p}/abonnement`, { headers })).text();
    expect(JSON.parse(brut)).toMatchObject({ webhookConfigure: true });
    expect(brut).not.toContain(SECRET);
  });

  it('un webhook Stripe natif (en-tête Stripe-Signature) active un plan', async () => {
    const { base, srv } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    const nowSec = Math.floor(Date.now() / 1000);
    const corps = JSON.stringify({
      type: 'customer.subscription.created',
      created: nowSec,
      data: {
        object: {
          id: 'sub_stripe',
          current_period_end: nowSec + 30 * 86_400,
          metadata: { projectId: p, plan: 'essaim' },
        },
      },
    });
    const entete = signer(corps, SECRET, Date.now());
    const rep = await fetch(`${base}/api/webhooks/abonnement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': entete },
      body: corps,
    });
    expect(rep.status).toBe(200);
    expect(await rep.json()).toMatchObject({ applique: true, etat: 'actif', heures: 50 });
  });
});
