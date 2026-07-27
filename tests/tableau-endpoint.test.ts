// Contrat HTTP du tableau de bord personnel.
//
// Le module pur sait classer des alertes ; il ne peut rien garantir sur la
// PORTÉE de ce qui lui est donné. Or c'est là qu'est le vrai risque de cette
// route : elle rassemble abonnements, dépenses et machines d'une personne, et
// une jointure trop large ferait fuiter la facture des autres.
//
// Trois choses sont donc vérifiées contre un vrai serveur :
//
//   1. la route exige un COMPTE (le jeton de ruche ne suffit pas) ;
//   2. elle ne rend QUE les projets dont la personne est membre ;
//   3. être administrateur de la ruche n'élargit pas cette vue.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-tableau-assez-long-ok';
const MDP = 'la ruche bourdonne au matin';
const JOUR = 86_400_000;
const HEURE = 3_600_000;

interface Reponse {
  projets: Array<{
    projectId: string;
    nom: string;
    role: string;
    plafondMs: number | null;
    partConsommee: number | null;
    serveursFacturables: number;
    autonomie: string;
  }>;
  alertes: Array<{ cle: string; projectId: string; jours: number }>;
  totaux: { projets: number; serveursActifs: number; heuresIncluses: number };
  balanceAJour: boolean;
}

describe('tableau de bord personnel', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  async function demarrer(): Promise<{ base: string; srv: HiveServer }> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-tableau-'));
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

  const json = { 'content-type': 'application/json' };

  const inscrire = async (base: string, email: string): Promise<string> => {
    const r = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email, password: MDP, displayName: 'Testeur' }),
    });
    return ((await r.json()) as { token: string }).token;
  };

  const creerProjet = async (base: string, jeton: string, name: string): Promise<string> => {
    const r = await fetch(`${base}/api/projects/user`, {
      method: 'POST',
      headers: { ...json, authorization: `Bearer ${jeton}` },
      body: JSON.stringify({ name }),
    });
    return ((await r.json()) as { id: string }).id;
  };

  const lire = async (base: string, jeton: string): Promise<Reponse> =>
    (await (
      await fetch(`${base}/api/moi/tableau`, { headers: { authorization: `Bearer ${jeton}` } })
    ).json()) as Reponse;

  it('sans compte, la route refuse', async () => {
    const { base } = await demarrer();
    expect((await fetch(`${base}/api/moi/tableau`)).status).toBe(401);
  });

  it('LE JETON DE RUCHE NE SUFFIT PAS', async () => {
    // Il est partagé avec chaque nœud membre : s'en servir ici donnerait à
    // toute machine qui butine le tableau de bord de quelqu'un.
    const { base } = await demarrer();
    const r = await fetch(`${base}/api/moi/tableau`, { headers: { 'x-hive-token': TOKEN } });
    expect(r.status).toBe(401);
  });

  it('une personne sans projet obtient un tableau vide, pas une erreur', async () => {
    const { base } = await demarrer();
    const jeton = await inscrire(base, 'seule@x.fr');
    const t = await lire(base, jeton);
    expect(t.projets).toEqual([]);
    expect(t.alertes).toEqual([]);
    expect(t.totaux.projets).toBe(0);
  });

  it('ON NE VOIT QUE SES PROPRES PROJETS', async () => {
    // Le risque central de cette route : elle rassemble des dépenses et des
    // machines, donc une facture. Une jointure trop large la ferait fuiter.
    const { base } = await demarrer();
    const chef = await inscrire(base, 'chef@x.fr');
    const autre = await inscrire(base, 'autre@x.fr');
    await creerProjet(base, chef, 'Le projet du chef');
    const sien = await creerProjet(base, autre, 'Le projet de l’autre');

    const vu = await lire(base, chef);
    expect(vu.projets.map((p) => p.nom)).toEqual(['Le projet du chef']);
    expect(vu.projets.some((p) => p.projectId === sien)).toBe(false);
  });

  it('ÊTRE ADMINISTRATEUR DE LA RUCHE N’ÉLARGIT PAS CETTE VUE', async () => {
    // Le premier inscrit est admin. S'il voyait ici tous les projets, il ne
    // verrait plus jamais ce que voient ses utilisateurs — et le tableau
    // cesserait d'être un tableau de bord personnel.
    const { base } = await demarrer();
    const admin = await inscrire(base, 'chef@x.fr');
    const membre = await inscrire(base, 'simple@x.fr');
    await creerProjet(base, membre, 'Projet du membre');

    const vu = await lire(base, admin);
    expect(vu.projets).toEqual([]);
  });

  it('le rôle DANS le projet est rendu', async () => {
    const { base } = await demarrer();
    const jeton = await inscrire(base, 'chef@x.fr');
    await creerProjet(base, jeton, 'Mien');
    expect((await lire(base, jeton)).projets[0]?.role).toBe('owner');
  });

  it('un projet neuf n’a NI plafond NI part consommée', async () => {
    // `null` et pas `0` : sans plafond, il n'y a rien à consommer, et une
    // jauge à zéro raconterait qu'on n'a rien dépensé — ce n'est pas pareil.
    const { base } = await demarrer();
    const jeton = await inscrire(base, 'chef@x.fr');
    await creerProjet(base, jeton, 'Neuf');
    const p = (await lire(base, jeton)).projets[0];
    expect(p?.plafondMs).toBeNull();
    expect(p?.partConsommee).toBeNull();
  });

  it('un plafond posé fait apparaître la jauge', async () => {
    const { base, srv } = await demarrer();
    const jeton = await inscrire(base, 'chef@x.fr');
    const id = await creerProjet(base, jeton, 'Borné');
    srv.store.setBudget(id, 10 * HEURE);
    const p = (await lire(base, jeton)).projets[0];
    expect(p?.plafondMs).toBe(10 * HEURE);
    expect(p?.partConsommee).toBe(0);
  });

  it('UNE MACHINE BIENTÔT EFFACÉE REMONTE EN TÊTE DES ALERTES', async () => {
    // Le seul ennui dont on ne revient pas doit se voir en premier.
    const { base, srv } = await demarrer();
    const jeton = await inscrire(base, 'chef@x.fr');
    const id = await creerProjet(base, jeton, 'Menacé');
    const now = Date.now();
    srv.store.setServeur({
      id: 'srv-menace',
      projectId: id,
      refAbonnement: 'sub-1',
      etat: 'arrete',
      fournisseur: 'manuel',
      refMachine: 'vm-1',
      gabarit: '2 vCPU / 4 Go',
      motif: 'abonnement sans droits',
      creeA: now - 60 * JOUR,
      majA: now - 27 * JOUR,
      arreteA: now - 27 * JOUR,
    });

    const t = await lire(base, jeton);
    expect(t.alertes[0]?.cle).toBe('effacement_imminent');
    expect(t.alertes[0]?.jours).toBeLessThanOrEqual(3);
    // …et elle ne compte pas comme facturable : elle est éteinte.
    expect(t.projets[0]?.serveursFacturables).toBe(0);
    expect(t.totaux.serveursActifs).toBe(0);
  });

  it('une machine PRÊTE compte comme facturable', async () => {
    const { base, srv } = await demarrer();
    const jeton = await inscrire(base, 'chef@x.fr');
    const id = await creerProjet(base, jeton, 'Qui tourne');
    const now = Date.now();
    srv.store.setServeur({
      id: 'srv-vif',
      projectId: id,
      refAbonnement: 'sub-2',
      etat: 'pret',
      fournisseur: 'manuel',
      refMachine: 'vm-2',
      gabarit: '2 vCPU / 4 Go',
      motif: '',
      creeA: now,
      majA: now,
      arreteA: 0,
    });
    const t = await lire(base, jeton);
    expect(t.totaux.serveursActifs).toBe(1);
    expect(t.alertes).toEqual([]);
  });

  it('la fraîcheur du grand livre est DITE, pas masquée', async () => {
    // Une dépense affichée alors que le rattrapage n'est pas fini sous-estime
    // et rassure à tort.
    const { base } = await demarrer();
    const jeton = await inscrire(base, 'chef@x.fr');
    expect(typeof (await lire(base, jeton)).balanceAJour).toBe('boolean');
  });

  it('une adhésion orpheline ne casse pas le tableau', async () => {
    // Un projet effacé dont l'adhésion subsiste : la route saute la ligne au
    // lieu de rendre 500 — le reste du tableau reste lisible.
    const { base, srv } = await demarrer();
    const jeton = await inscrire(base, 'chef@x.fr');
    const vivant = await creerProjet(base, jeton, 'Vivant');
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${jeton}` } })
    ).json()) as { id: string };
    srv.store.addMember('projet-qui-n-existe-pas', moi.id, 'owner');

    const t = await lire(base, jeton);
    expect(t.projets.map((p) => p.projectId)).toEqual([vivant]);
  });
});
