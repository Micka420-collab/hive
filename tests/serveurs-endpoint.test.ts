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

  it('LE BILLET N’EST PLUS RANGÉ DANS LE MOTIF — il y était en clair', async () => {
    // Ce test affirmait l'inverse : il vérifiait que `motif` contenait
    // « npm run join hive2_… ». C'était la fuite, prise pour une
    // fonctionnalité. Un billet porte le secret EN CLAIR (base64url lisible),
    // et `serveurs.motif` est durable, exporté par l'API d'administration, et
    // sans borne liée à la péremption du billet — pendant que la table
    // `billets` juste à côté ne range, elle, qu'une empreinte PBKDF2.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    const vue = await lireServeurs(base, admin);
    expect(vue.fournisseur).toBe('manuel');
    expect(vue.serveurs[0]?.motif, 'le billet est encore rangé en clair').not.toMatch(/hive2_/);
    // …et le motif reste utile : c'est encore ce que l'administrateur lit.
    expect(vue.serveurs[0]?.motif).toMatch(/npm run join/);
    expect(vue.serveurs[0]?.motif).toMatch(/podman/);
  });

  it('LE BILLET EST REMIS UNE FOIS, PUIS OUBLIÉ', async () => {
    // Toute la chaîne reste réelle : achat → serveur → billet à usage unique →
    // machine rattachée. Ce qui change, c'est le canal : la mémoire du hub,
    // une seule lecture, plutôt qu'une colonne de base de données.
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    const vue = await lireServeurs(base, admin);
    const id = vue.serveurs[0]!.id;

    const remise = await fetch(`${base}/api/admin/serveurs/${id}/billet`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(remise.status).toBe(200);
    const corps = (await remise.json()) as { billet: string; commande: string };
    expect(corps.billet).toMatch(/^hive2_/);
    expect(corps.commande).toBe(`npm run join ${corps.billet}`);

    // La seconde lecture ne rend rien : le laisser consultable indéfiniment
    // recréerait ce qu'on vient de retirer, en mémoire au lieu du disque.
    const seconde = await fetch(`${base}/api/admin/serveurs/${id}/billet`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(seconde.status).toBe(404);
  });

  it('la remise du billet exige le droit d’administrer les serveurs', async () => {
    const { base, srv, admin } = await demarrer();
    const p = srv.store.createProject({ name: 'Ruche' }).id;
    await poster(base, achat(p));
    const id = (await lireServeurs(base, admin)).serveurs[0]!.id;
    // Sans jeton du tout : la route ne doit pas être une porte de service.
    const sans = await fetch(`${base}/api/admin/serveurs/${id}/billet`);
    expect(sans.status).toBeGreaterThanOrEqual(401);
    expect(sans.status).toBeLessThan(404);
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

  // ─── Ce que l'écran d'intendance reçoit pour dessiner ses boutons ─────────
  //
  // La matrice de transitions ne doit exister QU'UNE fois. Si le navigateur en
  // gardait une copie, les deux dériveraient au premier ajout d'état : un
  // bouton proposé ici, refusé là-bas, sans que rien ne signale l'écart avant
  // le clic. Le serveur envoie donc les gestes permis avec chaque machine.

  const poser = (srv: HiveServer, id: string, etat: string, projectId = 'p'): void => {
    const now = Date.now();
    srv.store.setServeur({
      id,
      projectId,
      refAbonnement: `sub-${id}`,
      etat,
      fournisseur: 'manuel',
      refMachine: '',
      gabarit: '2 vCPU / 4 Go',
      motif: '',
      creeA: now,
      majA: now,
      arreteA: 0,
    });
  };

  interface VueAdmin {
    serveurs: Array<{
      id: string;
      etat: string;
      projet: string;
      transitions: string[];
      joursAvantSuppression: number;
    }>;
  }

  const lire = async (base: string, admin: string): Promise<VueAdmin> =>
    (await (
      await fetch(`${base}/api/admin/serveurs`, { headers: { authorization: `Bearer ${admin}` } })
    ).json()) as VueAdmin;

  it('LES GESTES PROPOSÉS SONT CEUX QUE LE SERVEUR ACCEPTE', async () => {
    // Le contrat qui interdit la copie de la matrice côté navigateur : ce que
    // la vue liste, le PUT le prend.
    const { base, srv, admin } = await demarrer();
    poser(srv, 'srv-pret', 'pret');
    const { serveurs } = await lire(base, admin);
    const s = serveurs.find((x) => x.id === 'srv-pret');
    expect(s?.transitions.length).toBeGreaterThan(0);

    for (const vers of s!.transitions) {
      // Chaque geste annoncé est rejoué depuis « prêt » sur une machine neuve.
      const id = `essai-${vers}`;
      poser(srv, id, 'pret');
      const r = await fetch(`${base}/api/admin/serveurs/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
        body: JSON.stringify({ etat: vers }),
      });
      expect(r.status, `${'pret'} → ${vers}`).toBe(200);
    }
  });

  it('un serveur supprimé n’offre AUCUN geste', async () => {
    // Terminal veut dire terminal : l'écran ne doit pas montrer un bouton qui
    // laisserait croire qu'on peut ressusciter la machine — et ses données.
    const { base, srv, admin } = await demarrer();
    poser(srv, 'srv-mort', 'supprime');
    const { serveurs } = await lire(base, admin);
    expect(serveurs.find((s) => s.id === 'srv-mort')?.transitions).toEqual([]);
  });

  it('la ligne porte le NOM du projet, pas seulement son identifiant', async () => {
    // « hive-a3f2 » ne dit à personne quelle machine il s'apprête à éteindre.
    const { base, srv, admin } = await demarrer();
    const projet = srv.store.createProject({ name: 'Ruche des voisins' });
    poser(srv, 'srv-nom', 'pret', projet.id);
    const { serveurs } = await lire(base, admin);
    expect(serveurs.find((s) => s.id === 'srv-nom')?.projet).toBe('Ruche des voisins');
  });

  it('un projet effacé ne casse pas la ligne', async () => {
    // Le nom manque ; la machine, elle, existe encore et coûte de l'argent.
    const { base, srv, admin } = await demarrer();
    poser(srv, 'srv-orphelin', 'pret', 'projet-disparu');
    const { serveurs } = await lire(base, admin);
    const s = serveurs.find((x) => x.id === 'srv-orphelin');
    expect(s?.projet).toBe('');
    expect(s?.etat).toBe('pret');
  });

  it('/api/auth/me PORTE le rôle — sans lui l’écran d’intendance reste caché', async () => {
    // Le dashboard décide d'afficher la case « Intendance » sur ce champ. S'il
    // disparaissait, un administrateur ne verrait plus jamais ses machines.
    const { base, admin, membre } = await demarrer();
    const roleDe = async (jeton: string): Promise<string | undefined> =>
      (
        (await (
          await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${jeton}` } })
        ).json()) as { role?: string }
      ).role;
    expect(await roleDe(admin)).toBe('admin');
    expect(await roleDe(membre)).toBe('membre');
  });
});
