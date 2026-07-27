// Contrat HTTP des serveurs, et surtout : le provisionnement automatique.
//
// LE test de ce fichier est celui du webhook rejoué. Un processeur de paiement
// re-livre un webhook qu'il croit perdu — c'est normal, documenté, et cela
// arrive vraiment. Sans idempotence, chaque re-livraison démarre une machine
// de plus : le client en paie une, on en facture dix, et personne ne s'en
// aperçoit avant la facture du fournisseur.
//
// Le module pur le garantit ; ici on vérifie que le câblage ne l'a pas défait.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planParCle, signer } from '../src/orchestrator/abonnement.js';
import { RETENTION_JOURS } from '../src/orchestrator/serveurs.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-serveurs-assez-long';
const SECRET = 'secret-webhook-serveurs-long';
const MDP = 'la ruche bourdonne au matin';

describe('serveurs — provisionnement automatique', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  let avant: string | undefined;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    if (avant === undefined) delete process.env.HIVE_WEBHOOK_SECRET;
    else process.env.HIVE_WEBHOOK_SECRET = avant;
  });

  async function demarrer(): Promise<{ base: string; srv: HiveServer; admin: string }> {
    avant = process.env.HIVE_WEBHOOK_SECRET;
    process.env.HIVE_WEBHOOK_SECRET = SECRET;
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-srv-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    const base = `http://127.0.0.1:${server.port}`;
    // Le premier compte est admin.
    const rep = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'chef@x.fr', password: MDP, displayName: 'Chef' }),
    });
    const { token } = (await rep.json()) as { token: string };
    return { base, srv: server, admin: token };
  }

  const poster = (base: string, charge: Record<string, unknown>): Promise<Response> => {
    const corps = JSON.stringify(charge);
    return fetch(`${base}/api/webhooks/abonnement`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hive-signature': signer(corps, SECRET, Date.now()),
      },
      body: corps,
    });
  };

  const achat = (projectId: string, plan = 'essaim', type = 'abonnement.actif') => ({
    type,
    projectId,
    plan,
    refExterne: 'sub_test',
    finPeriode: Date.now() + 30 * 86_400_000,
    ts: Date.now(),
  });

  const lireServeurs = async (
    base: string,
    admin: string,
  ): Promise<{
    vue: { total: number; facturables: number };
    serveurs: Array<{ id: string; etat: string; motif: string; joursAvantSuppression: number }>;
    fournisseur: string;
    retentionJours: number;
  }> =>
    (await (
      await fetch(`${base}/api/admin/serveurs`, { headers: { authorization: `Bearer ${admin}` } })
    ).json()) as never;

  it('UN ACHAT CRÉE LE SERVEUR TOUT SEUL', async () => {
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;

    expect((await poster(base, achat(p))).status).toBe(200);
    const vue = await lireServeurs(base, admin);
    expect(vue.serveurs).toHaveLength(planParCle('essaim')?.serveurs ?? 0);
    expect(vue.serveurs[0]?.etat).toBe('provisionnement');
    expect(vue.vue.facturables).toBe(1);
  });

  it('les instructions livrées contiennent un billet utilisable', async () => {
    // Toute la chaîne est réelle : achat → serveur → billet à usage unique →
    // machine rattachée. Seul « qui allume la machine » est remplaçable.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    const vue = await lireServeurs(base, admin);
    expect(vue.fournisseur).toBe('manuel');
    expect(vue.serveurs[0]?.motif).toMatch(/npm run join hive2_/);
    expect(vue.serveurs[0]?.motif).toMatch(/podman/);
  });

  it('REJOUER LE WEBHOOK NE FACTURE PAS DIX MACHINES', async () => {
    // Le test central du fichier.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;

    for (let i = 0; i < 10; i++) {
      const r = await poster(base, { ...achat(p), ts: Date.now() + i });
      expect(r.status, `rejeu ${i}`).toBe(200);
    }
    const vue = await lireServeurs(base, admin);
    expect(vue.serveurs, 'un webhook rejoué a démarré des machines en trop').toHaveLength(1);
  });

  it('deux événements distincts du MÊME abonnement ne font qu’un serveur', async () => {
    // « actif » puis « paiement_reussi » portent le même abonnement.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    await poster(base, { ...achat(p, 'essaim', 'abonnement.paiement_reussi'), ts: Date.now() + 1 });
    expect((await lireServeurs(base, admin)).serveurs).toHaveLength(1);
  });

  it('un plan SANS serveur n’en provisionne aucun', async () => {
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p, 'libre'));
    expect((await lireServeurs(base, admin)).serveurs).toHaveLength(0);
  });

  it('le plan Colonie en provisionne deux', async () => {
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p, 'colonie'));
    expect((await lireServeurs(base, admin)).serveurs).toHaveLength(2);
  });

  it('UNE ANNULATION ARRÊTE LA MACHINE — la facture cesse', async () => {
    // Un abonnement terminé sans arrêt, c'est une facture qui court pour un
    // client qui ne paie plus.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    await poster(base, { ...achat(p, 'essaim', 'abonnement.annule'), ts: Date.now() + 1 });

    const vue = await lireServeurs(base, admin);
    expect(vue.serveurs[0]?.etat).toBe('arrete');
    expect(vue.vue.facturables).toBe(0);
  });

  it('…mais les données restent, avec un compte à rebours visible', async () => {
    // Supprimer tout de suite détruirait le travail de quelqu'un. C'est
    // l'erreur la plus grave des trois : elle est irréversible.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    await poster(base, { ...achat(p, 'essaim', 'abonnement.annule'), ts: Date.now() + 1 });

    const vue = await lireServeurs(base, admin);
    expect(vue.serveurs[0]?.etat).not.toBe('supprime');
    expect(vue.serveurs[0]?.joursAvantSuppression).toBe(RETENTION_JOURS);
    expect(vue.retentionJours).toBe(RETENTION_JOURS);
  });

  it('un IMPAYÉ ne coupe pas la machine pendant la grâce', async () => {
    // Couper net quelqu'un dont la carte a expiré est un mauvais produit.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    await poster(base, {
      ...achat(p, 'essaim', 'abonnement.paiement_echoue'),
      ts: Date.now() + 1,
    });
    expect((await lireServeurs(base, admin)).vue.facturables).toBe(1);
  });
});

describe('serveurs — l’administration', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(): Promise<{
    base: string;
    srv: HiveServer;
    admin: string;
    membre: string;
  }> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-srv-adm-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 10_000,
    });
    const base = `http://127.0.0.1:${server.port}`;
    const creer = async (email: string): Promise<string> => {
      const r = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: MDP, displayName: 'Testeur' }),
      });
      return ((await r.json()) as { token: string }).token;
    };
    return {
      base,
      srv: server,
      admin: await creer('chef@x.fr'),
      membre: await creer('simple@x.fr'),
    };
  }

  it('un membre ne voit PAS les serveurs', async () => {
    const { base, membre } = await demarrer();
    const r = await fetch(`${base}/api/admin/serveurs`, {
      headers: { authorization: `Bearer ${membre}` },
    });
    expect(r.status).toBe(403);
  });

  it('le jeton de ruche ne suffit pas non plus', async () => {
    const { base } = await demarrer();
    const r = await fetch(`${base}/api/admin/serveurs`, { headers: { 'x-hive-token': TOKEN } });
    expect(r.status).toBe(401);
  });

  it('un admin voit une ruche vide sans trous', async () => {
    const { base, admin } = await demarrer();
    const vue = (await (
      await fetch(`${base}/api/admin/serveurs`, { headers: { authorization: `Bearer ${admin}` } })
    ).json()) as { vue: { total: number; facturables: number }; serveurs: unknown[] };
    expect(vue.vue.total).toBe(0);
    expect(vue.vue.facturables).toBe(0);
    expect(vue.serveurs).toEqual([]);
  });

  it('une transition INTERDITE est refusée, pas appliquée en silence', async () => {
    const { base, srv, admin } = await demarrer();
    const now = Date.now();
    srv.store.setServeur({
      id: 'srv-1',
      projectId: 'p',
      refAbonnement: 'sub',
      etat: 'supprime',
      fournisseur: 'manuel',
      refMachine: '',
      gabarit: 'x',
      motif: '',
      creeA: now,
      majA: now,
      arreteA: 0,
    });
    const r = await fetch(`${base}/api/admin/serveurs/srv-1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: JSON.stringify({ etat: 'pret' }),
    });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/supprime → pret/);
  });

  it('un serveur inconnu rend 404', async () => {
    const { base, admin } = await demarrer();
    const r = await fetch(`${base}/api/admin/serveurs/nexiste-pas`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: JSON.stringify({ etat: 'arrete' }),
    });
    expect(r.status).toBe(404);
  });

  it('un état inconnu est refusé par le schéma', async () => {
    const { base, admin } = await demarrer();
    const r = await fetch(`${base}/api/admin/serveurs/x`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: JSON.stringify({ etat: 'gratuit-pour-toujours' }),
    });
    expect(r.status).toBe(400);
  });
});
